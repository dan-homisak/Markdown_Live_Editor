import * as fs from "fs";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import {
  mapNormalizedDocumentChangesToHost,
  normalizeDocumentText,
} from "./shared/documentChangeMapping";
import { validateDocumentChangeClaim } from "./shared/documentChangeValidation";
import { parseMarkdownTables } from "./shared/tableModel";
import {
  findMarkdownLinkAt,
  isMarkdownOpenLinkRequest,
  MarkdownLinkResult,
  MarkdownOpenLinkRequest,
  resolveMarkdownSourceLink,
  markdownFragmentOffset,
} from "./shared/markdownLinkValidation";
import {
  markdownRenderingParser,
  planTaskToggle,
} from "./editor/markdown/markdownSyntax";
import {
  DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY,
  normalizeTableNavigationModifierKey,
  TableNavigationModifierKey,
} from "./shared/tableKeyboardNavigation";

const LIVE_EDITOR_VIEW_TYPE = "markdownLiveRenderTables.liveEditor";
const DEBUG_SETTING = "debug";
const DEFAULT_COPY_MODE_SETTING = "clipboard.defaultCopyMode";
const DEFAULT_PASTE_MODE_SETTING = "clipboard.defaultPasteMode";
const TABLE_NAVIGATION_MODIFIER_KEY_SETTING =
  "tableNavigation.modifierKey";
const MARKDOWN_RENDERING_ENABLED_SETTING = "markdownRendering.enabled";
const REOPEN_ACTIVE_EDITOR_WITH_COMMAND = "reopenActiveEditorWith";
const DEFAULT_EDITOR_ID = "default";

let debugOutputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MarkdownLiveEditorProvider(context);
  debugOutputChannel = vscode.window.createOutputChannel(
    "Markdown Live Editor",
  );

  context.subscriptions.push(
    debugOutputChannel,
    vscode.window.registerCustomEditorProvider(
      LIVE_EDITOR_VIEW_TYPE,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
    vscode.commands.registerCommand(
      "markdownLiveRenderTables.toggleEditor",
      async (uri?: vscode.Uri) => {
        await toggleEditor(uri, provider);
      },
    ),
    vscode.commands.registerCommand(
      "markdownLiveRenderTables.showDebugLog",
      () => {
        debugOutputChannel?.show(true);
      },
    ),
    vscode.commands.registerCommand(
      "markdownLiveRenderTables.toggleTaskCheckbox",
      () => provider.runMarkdownTaskCommand("toggle"),
    ),
    vscode.commands.registerCommand(
      "markdownLiveRenderTables.focusTaskCheckbox",
      () => provider.runMarkdownTaskCommand("focus"),
    ),
    vscode.commands.registerCommand(
      "markdownLiveRenderTables.openMarkdownLinkAtCaret",
      () => provider.runMarkdownLinkCommand(),
    ),
  );
}

export function deactivate(): void {}

class MarkdownLiveEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly panelsByDocument = new Map<string, vscode.WebviewPanel>();
  private readonly mediaTextByFileName = new Map<string, string>();
  private activeLiveDocumentUri: vscode.Uri | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public getActiveDocumentUri(): vscode.Uri | undefined {
    return this.activeLiveDocumentUri;
  }

  public getViewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
    return this.panelsByDocument.get(uri.toString())?.viewColumn;
  }

  public async runMarkdownTaskCommand(
    action: HostMarkdownTaskCommandMessage["action"],
  ): Promise<void> {
    // The palette temporarily takes keyboard focus. The selected custom tab
    // and its active panel still identify the invoking editing context; a
    // previously active document alone is never enough to route an action.
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (
      !(input instanceof vscode.TabInputCustom) ||
      input.viewType !== LIVE_EDITOR_VIEW_TYPE
    ) {
      return;
    }
    const panel = this.panelsByDocument.get(input.uri.toString());
    if (
      !panel?.active ||
      this.activeLiveDocumentUri?.toString() !== input.uri.toString()
    ) {
      return;
    }
    await panel.webview.postMessage({
      type: "markdownTaskCommand",
      action,
    } satisfies HostMarkdownTaskCommandMessage);
  }

  public async runMarkdownLinkCommand(): Promise<void> {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputCustom) || input.viewType !== LIVE_EDITOR_VIEW_TYPE) return;
    const panel = this.panelsByDocument.get(input.uri.toString());
    if (!panel?.active || this.activeLiveDocumentUri?.toString() !== input.uri.toString()) return;
    await panel.webview.postMessage({ type: "markdownLinkCommand", action: "open" });
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const scriptText = this.readMediaText("liveEditor.js");
    const styleText = ["liveEditor.css", "markdownPresentation.css", "markdownBlocks.css"]
      .filter(fileName => fs.existsSync(vscode.Uri.joinPath(this.context.extensionUri, "media", fileName).fsPath))
      .map(fileName => this.readMediaText(fileName)).join("\n");
    const documentKey = document.uri.toString();
    const clipboardDocumentToken = randomUUID();
    const disposables: vscode.Disposable[] = [];
    let disposed = false;
    let readOnlyQueryGeneration = 0;
    // Remote/filesystem permission queries can outlive an editor opened and
    // immediately closed. Install disposal before the first asynchronous read.
    disposables.push(webviewPanel.onDidDispose(() => {
      disposed = true;
      readOnlyQueryGeneration++;
      if (this.panelsByDocument.get(documentKey) === webviewPanel) {
        this.panelsByDocument.delete(documentKey);
        if (this.activeLiveDocumentUri?.toString() === documentKey) {
          this.activeLiveDocumentUri = undefined;
        }
      }
      vscode.Disposable.from(...disposables).dispose();
    }));
    let knownReadOnly = await isDocumentKnownReadOnly(document.uri);
    if (disposed || document.isClosed) return;

    this.panelsByDocument.set(documentKey, webviewPanel);
    if (webviewPanel.active) {
      this.activeLiveDocumentUri = document.uri;
    }

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    webviewPanel.title = document.fileName.split(/[\\/]/).pop() ?? "Markdown";

    let applyingFromWebview = false;
    let applyQueue: Promise<void> = Promise.resolve();
    let documentRevision = 0;
    let lastMarkdownLinkRequestId = 0;
    // Once a claim is rejected, every message sent before the webview receives
    // that rejection belongs to the invalidated optimistic branch. The
    // webview intentionally clears all of those pending echoes; this floor
    // guarantees the host cannot later apply one of them and diverge silently.
    let minimumWebviewBaseRevision = 0;

    const postDocument = (
      source: HostSetDocumentMessage["source"] = "host",
      ackId?: number,
    ): number => {
      if (disposed || document.isClosed) return documentRevision;
      documentRevision++;
      const text = normalizeDocumentText(document.getText());
      void webview.postMessage({
        type: "setDocument",
        text,
        revision: documentRevision,
        debug: isDebugEnabled(),
        editorOptions: getEditorOptions(
          document.uri,
          clipboardDocumentToken,
          knownReadOnly,
        ),
        source,
        ackId,
      } satisfies HostSetDocumentMessage);
      return documentRevision;
    };

    const rejectWebviewChange = (changeId?: number): void => {
      minimumWebviewBaseRevision = Math.max(
        minimumWebviewBaseRevision,
        postDocument("webviewReject", changeId),
      );
    };

    const postEditorOptions = (): void => {
      if (disposed || document.isClosed) return;
      void webview.postMessage({
        type: "setEditorOptions",
        editorOptions: getEditorOptions(
          document.uri,
          clipboardDocumentToken,
          knownReadOnly,
        ),
      } satisfies HostSetEditorOptionsMessage);
    };

    const refreshReadOnly = async (): Promise<boolean> => {
      const generation = ++readOnlyQueryGeneration;
      const nextReadOnly = await isDocumentKnownReadOnly(document.uri);
      if (!disposed && !document.isClosed && generation === readOnlyQueryGeneration && nextReadOnly !== knownReadOnly) {
        knownReadOnly = nextReadOnly;
        postEditorOptions();
      }
      // A queued action validates its own query result. A concurrent older
      // ready/activation query must not change that decision via shared state.
      return nextReadOnly;
    };

    const applyFromWebview = (message: ChangeMessage): void => {
      applyQueue = applyQueue
        .then(async () => {
          if (message.baseRevision < minimumWebviewBaseRevision) {
            logDebug(
              `drop invalidated webview change ${message.changeId ?? "unknown"}: base revision ${message.baseRevision} predates conflict floor ${minimumWebviewBaseRevision}`,
            );
            // The rejection that established the floor already cleared every
            // optimistic echo posted on the older revision. Do not emit a new
            // rejection here: doing so would raise the floor again and could
            // invalidate the first legitimate edit sent after the resync.
            return;
          }
          if (message.baseRevision > documentRevision) {
            logDebug(
              `reject webview change ${message.changeId ?? "unknown"}: future base revision ${message.baseRevision} > ${documentRevision}`,
            );
            rejectWebviewChange(message.changeId);
            return;
          }
          if (message.sourceAction === "markdownTaskToggle") {
            if (disposed || document.isClosed) return;
            const taskReadOnly = await refreshReadOnly();
            if (disposed || document.isClosed) return;
            if (taskReadOnly || !isSingleTaskToggleClaim(message)) {
              logDebug(
                `reject task change ${message.changeId ?? "unknown"}: ${taskReadOnly ? "read-only document" : "invalid task edit"}`,
              );
              rejectWebviewChange(message.changeId);
              return;
            }
          }
          const authoritativeBeforeText = normalizeDocumentText(
            document.getText(),
          );
          const validation = validateDocumentChangeClaim(
            authoritativeBeforeText,
            message.changeGroups !== undefined
              ? {
                  beforeText: normalizeDocumentText(message.beforeText),
                  finalText: normalizeDocumentText(message.text),
                  changeGroups: message.changeGroups,
                }
              : {
                  beforeText: normalizeDocumentText(message.beforeText),
                  finalText: normalizeDocumentText(message.text),
                  changes: message.changes ?? [],
                },
          );
          if (!validation.ok) {
            logDebug(
              `reject webview change ${message.changeId ?? "unknown"}: ${validation.code}`,
            );
            vscode.window.showWarningMessage(
              "Markdown live editor stopped a conflicting edit and refreshed from the saved document.",
            );
            rejectWebviewChange(message.changeId);
            return;
          }

          applyingFromWebview = true;
          try {
            if (message.changeGroups !== undefined) {
              logDebug(
                `apply ${message.changeGroups.length} sequential change group(s) from webview at revision ${message.baseRevision}`,
              );
              let expectedBeforeGroup = authoritativeBeforeText;
              for (
                let groupIndex = 0;
                groupIndex < message.changeGroups.length;
                groupIndex++
              ) {
                const changeGroup = message.changeGroups[groupIndex];
                if (
                  normalizeDocumentText(document.getText()) !==
                  expectedBeforeGroup
                ) {
                  logDebug(
                    `stop webview change ${message.changeId ?? "unknown"}: document changed before sequential group ${groupIndex + 1}`,
                  );
                  vscode.window.showWarningMessage(
                    "Markdown live editor stopped a conflicting edit and refreshed from the saved document.",
                  );
                  rejectWebviewChange(message.changeId);
                  return;
                }
                const expectedAfterGroup = applyNormalizedChangeGroupToText(
                  expectedBeforeGroup,
                  changeGroup,
                );
                await applyDocumentChanges(document, changeGroup);
                if (
                  normalizeDocumentText(document.getText()) !==
                  expectedAfterGroup
                ) {
                  logDebug(
                    `stop webview change ${message.changeId ?? "unknown"}: document diverged after sequential group ${groupIndex + 1}`,
                  );
                  vscode.window.showWarningMessage(
                    "Markdown live editor detected a conflicting document update and refreshed safely.",
                  );
                  rejectWebviewChange(message.changeId);
                  return;
                }
                expectedBeforeGroup = expectedAfterGroup;
              }
            } else if (message.changes?.length) {
              logDebug(
                `apply ${message.changes.length} change(s) from webview at revision ${message.baseRevision}`,
              );
              await applyDocumentChanges(document, message.changes);
            } else {
              vscode.window.showWarningMessage(
                "Markdown live editor ignored a change without source ranges.",
              );
              logDebug("ignored change message without source ranges");
            }
          } finally {
            applyingFromWebview = false;
          }

          if (
            normalizeDocumentText(document.getText()) !==
            normalizeDocumentText(message.text)
          ) {
            vscode.window.showWarningMessage(
              "Markdown live editor detected a conflicting document update and refreshed safely.",
            );
            rejectWebviewChange(message.changeId);
            return;
          }
          postDocument("webviewAck", message.changeId);
        })
        .catch((error: unknown) => {
          applyingFromWebview = false;
          vscode.window.showErrorMessage(
            `Markdown live editor could not apply changes: ${String(error)}`,
          );
          // Resync the webview with the authoritative document state so an
          // apply failure cannot leave the two sides silently diverged.
          rejectWebviewChange(message.changeId);
        });
    };

    const isInvokingPanelActive = (): boolean => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return !disposed && !document.isClosed && webviewPanel.active &&
        this.panelsByDocument.get(documentKey) === webviewPanel &&
        this.activeLiveDocumentUri?.toString() === documentKey &&
        input instanceof vscode.TabInputCustom && input.viewType === LIVE_EDITOR_VIEW_TYPE &&
        input.uri.toString() === documentKey;
    };

    const openLinkFromWebview = (message: MarkdownOpenLinkRequest): void => {
      let settled = false;
      const finish = (ok: boolean, explanation?: string): void => {
        if (settled) return;
        settled = true;
        if (disposed) return;
        void webview.postMessage({ type: "markdownLinkResult", requestId: message.requestId,
          ok, message: explanation } satisfies MarkdownLinkResult);
        if (!ok && explanation && isInvokingPanelActive()) {
          void vscode.window.showInformationMessage(explanation);
        }
      };
      if (message.sessionToken !== clipboardDocumentToken || message.requestId <= lastMarkdownLinkRequestId) {
        finish(false, "This link request is no longer current.");
        return;
      }
      lastMarkdownLinkRequestId = message.requestId;
      applyQueue = applyQueue.then(async () => {
        if (!isInvokingPanelActive()) { finish(false); return; }
        if (!vscode.workspace.getConfiguration("markdownLiveRenderTables", document.uri)
          .get<boolean>(MARKDOWN_RENDERING_ENABLED_SETTING, true)) {
          finish(false, "Markdown link actions are disabled."); return;
        }
        const currentText = normalizeDocumentText(document.getText());
        const currentVersion = document.version;
        if (message.baseRevision < minimumWebviewBaseRevision || message.baseRevision > documentRevision ||
            normalizeDocumentText(message.beforeText) !== currentText || message.to > currentText.length) {
          finish(false, "The document changed before this link could be opened. Try again."); return;
        }
        const link = findMarkdownLinkAt(currentText, markdownRenderingParser.parse(currentText),
          message.from, parseMarkdownTables(currentText));
        if (!link || link.from !== message.from || link.to !== message.to) {
          finish(false, "There is no current Markdown link at this source range."); return;
        }
        const target = resolveMarkdownSourceLink(link,
          document.isUntitled ? null : document.uri.toString());
        if (!target.ok) { finish(false, target.reason); return; }
        let uri = vscode.Uri.parse(target.uri, true);
        if (target.kind === "external") {
          const opened = await vscode.env.openExternal(uri);
          finish(opened, opened ? undefined : "VS Code could not open this link.");
          return;
        }
        let targetDocument: vscode.TextDocument;
        try { targetDocument = await vscode.workspace.openTextDocument(uri); }
        catch (error) {
          if (link.kind !== "wiki") throw error;
          // A vault-style short name first resolves beside this note, then in
          // the containing workspace. Never pick an ambiguous basename silently.
          const folder = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!folder || !isInvokingPanelActive()) throw error;
          const basename = uri.path.slice(uri.path.lastIndexOf("/") + 1);
          const escaped = basename.replace(/[?*{}[\]]/gu, char => `[${char}]`);
          const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/${escaped}`), "**/{node_modules,.git}/**", 100);
          if (!isInvokingPanelActive() || !matches.length) throw error;
          if (matches.length === 1) uri = matches[0];
          else {
            const selected = await vscode.window.showQuickPick(matches.map(candidate => ({ label: vscode.workspace.asRelativePath(candidate), uri: candidate })), { placeHolder: "Choose the note for this wikilink" });
            if (!selected || !isInvokingPanelActive()) { finish(false); return; }
            uri = selected.uri;
          }
          targetDocument = await vscode.workspace.openTextDocument(uri);
        }
        // A slow remote provider may resolve after the user switches editors.
        // Reading may finish, but the obsolete request must not steal focus.
        if (!isInvokingPanelActive() || document.version !== currentVersion ||
            normalizeDocumentText(document.getText()) !== currentText ||
            !vscode.workspace.getConfiguration("markdownLiveRenderTables", document.uri)
              .get<boolean>(MARKDOWN_RENDERING_ENABLED_SETTING, true)) {
          finish(false); return;
        }
        let selection: vscode.Range | undefined;
        if (target.fragment) {
          const targetText = normalizeDocumentText(targetDocument.getText());
          const offset = markdownFragmentOffset(targetText, markdownRenderingParser.parse(targetText), target.fragment);
          if (offset === null) { finish(false, `The heading or block “${target.fragment}” was not found.`); return; }
          const before = targetText.slice(0, offset).split("\n");
          const position = new vscode.Position(before.length - 1, before[before.length - 1].length);
          selection = new vscode.Range(position, position);
        }
        await vscode.window.showTextDocument(targetDocument, {
          viewColumn: webviewPanel.viewColumn,
          preserveFocus: false,
          preview: true,
          ...(selection ? { selection } : {}),
        });
        finish(true);
      }).catch(() => finish(false, "VS Code could not open this Markdown link."));
    };

    disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          event.document.uri.toString() === documentKey &&
          !applyingFromWebview
        ) {
          postDocument();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const markdownEditorScope = {
          uri: document.uri,
          languageId: "markdown",
        };
        if (
          event.affectsConfiguration(
            "markdownLiveRenderTables.clipboard",
            document.uri,
          ) ||
          event.affectsConfiguration(
            "markdownLiveRenderTables.tableNavigation",
            document.uri,
          ) ||
          event.affectsConfiguration(
            "markdownLiveRenderTables.markdownRendering",
            document.uri,
          ) ||
          event.affectsConfiguration(
            "editor.accessibilitySupport",
            markdownEditorScope,
          ) ||
          event.affectsConfiguration("editor.multiCursorModifier", markdownEditorScope) ||
          event.affectsConfiguration("editor.wordWrap", markdownEditorScope) ||
          event.affectsConfiguration(
            "editor.scrollBeyondLastLine",
            markdownEditorScope,
          )
        ) {
          postEditorOptions();
        }
      }),
      webviewPanel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
          this.activeLiveDocumentUri = document.uri;
          void refreshReadOnly();
        }
      }),
      webview.onDidReceiveMessage((message: unknown) => {
        if (isReadyMessage(message)) {
          postDocument();
          void refreshReadOnly();
          return;
        }

        if (isDebugMessage(message)) {
          logDebug(`${message.event}: ${JSON.stringify(message.details)}`);
          return;
        }

        if (isMarkdownOpenLinkRequest(message)) {
          openLinkFromWebview(message);
          return;
        }

        if (isEditorCommandMessage(message)) {
          logDebug(`editor command requested: ${message.command}`);
          applyQueue = applyQueue
            .then(async () => {
              if (message.baseRevision < minimumWebviewBaseRevision) {
                logDebug(
                  `drop invalidated ${message.command}: base revision ${message.baseRevision} predates conflict floor ${minimumWebviewBaseRevision}`,
                );
                return;
              }
              if (
                message.baseRevision > documentRevision ||
                normalizeDocumentText(message.beforeText) !==
                  normalizeDocumentText(document.getText())
              ) {
                logDebug(
                  `reject ${message.command}: command snapshot does not match revision ${documentRevision}`,
                );
                rejectWebviewChange();
                return;
              }
              if (
                !webviewPanel.active ||
                this.activeLiveDocumentUri?.toString() !== documentKey
              ) {
                logDebug(
                  `drop ${message.command}: the requesting live editor is no longer active`,
                );
                return;
              }
              await vscode.commands.executeCommand(message.command);
            })
            .catch((error: unknown) => {
              vscode.window.showErrorMessage(
                `Markdown live editor could not run ${message.command}: ${String(error)}`,
              );
            });
          return;
        }

        if (isOpenClipboardSettingsMessage(message)) {
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:dan-homisak.markdown-live-render-tables clipboard",
          );
          return;
        }

        if (isChangeMessage(message)) {
          // Always serialize the claim through the apply queue, even when its
          // final text happens to match the document *right now*. An earlier
          // queued edit may still be about to change the authoritative text;
          // bypassing the queue here would lose a rapid edit that restores an
          // older value (for example, type and immediately Backspace).
          applyFromWebview(message);
        }
      }),
    );

    webview.html = getEditorHtml(
      webview,
      scriptText,
      styleText,
      normalizeDocumentText(document.getText()),
      document.uri,
      clipboardDocumentToken,
      knownReadOnly,
    );

  }

  private readMediaText(fileName: string): string {
    const cached = this.mediaTextByFileName.get(fileName);
    if (cached !== undefined) {
      return cached;
    }

    const fileUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      fileName,
    );
    const text = fs.readFileSync(fileUri.fsPath, "utf8");
    this.mediaTextByFileName.set(fileName, text);
    return text;
  }
}

async function toggleEditor(
  uri: vscode.Uri | undefined,
  provider: MarkdownLiveEditorProvider,
): Promise<void> {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const activeInput = activeTab?.input;

  if (
    activeInput instanceof vscode.TabInputCustom &&
    isLiveEditorViewType(activeInput.viewType)
  ) {
    await openSourceEditor(uri ?? activeInput.uri, provider, activeTab);
    return;
  }

  if (activeInput instanceof vscode.TabInputText) {
    await openLiveEditor(uri ?? activeInput.uri, provider, activeTab);
    return;
  }

  const activeTextUri = vscode.window.activeTextEditor?.document.uri;
  const activeLiveUri = provider.getActiveDocumentUri();
  if (activeTextUri) {
    await openLiveEditor(
      uri ?? activeTextUri,
      provider,
      vscode.window.tabGroups.activeTabGroup.activeTab,
    );
    return;
  }
  await openSourceEditor(
    uri ?? activeLiveUri,
    provider,
    vscode.window.tabGroups.activeTabGroup.activeTab,
  );
}

function isLiveEditorViewType(viewType: string): boolean {
  return viewType === LIVE_EDITOR_VIEW_TYPE;
}

async function openLiveEditor(
  uri: vscode.Uri | undefined,
  provider: MarkdownLiveEditorProvider,
  tabToClose?: vscode.Tab,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showWarningMessage(
      "Open a markdown file before opening the live editor.",
    );
    return;
  }

  const viewColumn =
    vscode.window.activeTextEditor?.viewColumn ??
    provider.getViewColumn(targetUri) ??
    vscode.ViewColumn.Active;

  if (tabToClose && tabMatchesUri(tabToClose, targetUri)) {
    await reopenActiveEditorWith(LIVE_EDITOR_VIEW_TYPE);
    return;
  }

  await vscode.commands.executeCommand(
    "vscode.openWith",
    targetUri,
    LIVE_EDITOR_VIEW_TYPE,
    {
      viewColumn,
      preserveFocus: false,
    },
  );
}

async function openSourceEditor(
  uri: vscode.Uri | undefined,
  provider: MarkdownLiveEditorProvider,
  tabToClose?: vscode.Tab,
): Promise<void> {
  const targetUri =
    uri ??
    provider.getActiveDocumentUri() ??
    vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showWarningMessage(
      "Open a live markdown editor before returning to source.",
    );
    return;
  }

  if (tabToClose && tabMatchesUri(tabToClose, targetUri)) {
    await reopenActiveEditorWith(DEFAULT_EDITOR_ID);
    return;
  }

  await vscode.window.showTextDocument(targetUri, {
    viewColumn: provider.getViewColumn(targetUri) ?? vscode.ViewColumn.Active,
    preview: false,
    preserveFocus: false,
  });
}

function tabMatchesUri(tab: vscode.Tab, uri: vscode.Uri): boolean {
  const input = tab.input;
  return (
    (input instanceof vscode.TabInputText &&
      input.uri.toString() === uri.toString()) ||
    (input instanceof vscode.TabInputCustom &&
      input.uri.toString() === uri.toString())
  );
}

async function applyDocumentChanges(
  document: vscode.TextDocument,
  changes: readonly DocumentChange[],
): Promise<void> {
  if (changes.length === 0) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const change of mapNormalizedDocumentChangesToHost(
    document.getText(),
    changes,
    document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
  )) {
    edit.replace(
      document.uri,
      new vscode.Range(
        new vscode.Position(change.from.line, change.from.character),
        new vscode.Position(change.to.line, change.to.character),
      ),
      change.text,
    );
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    throw new Error("VS Code rejected the document edit.");
  }
}

/**
 * Replays one already-validated simultaneous change group. The host uses the
 * intermediate result as a versionless precondition between sequential
 * workspace edits, preventing a later group from applying stale offsets after
 * an intervening formatter, extension, or source-editor edit.
 */
function applyNormalizedChangeGroupToText(
  source: string,
  changes: readonly DocumentChange[],
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const change of changes) {
    parts.push(source.slice(cursor, change.from), change.text);
    cursor = change.to;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

interface ReadyMessage {
  type: "ready";
}

interface DocumentChange {
  from: number;
  to: number;
  text: string;
}

interface ChangeMessage {
  type: "change";
  changeId?: number;
  beforeText: string;
  text: string;
  changes?: DocumentChange[];
  changeGroups?: DocumentChange[][];
  baseRevision: number;
  sourceAction?: "markdownTaskToggle";
}

interface DebugMessage {
  type: "debug";
  event: string;
  details: unknown;
}

interface EditorCommandMessage {
  type: "editorCommand";
  command: "undo" | "redo";
  beforeText: string;
  baseRevision: number;
}

interface HostSetDocumentMessage {
  type: "setDocument";
  text: string;
  revision: number;
  debug: boolean;
  source?: "host" | "webviewAck" | "webviewReject";
  ackId?: number;
  editorOptions: ReturnType<typeof getEditorOptions>;
}

interface HostSetEditorOptionsMessage {
  type: "setEditorOptions";
  editorOptions: ReturnType<typeof getEditorOptions>;
}

interface HostMarkdownTaskCommandMessage {
  type: "markdownTaskCommand";
  action: "toggle" | "focus";
}

interface OpenClipboardSettingsMessage {
  type: "openClipboardSettings";
}

function isReadyMessage(message: unknown): message is ReadyMessage {
  return isMessageRecord(message) && message.type === "ready";
}

function isChangeMessage(message: unknown): message is ChangeMessage {
  return (
    isMessageRecord(message) &&
    message.type === "change" &&
    (message.changeId === undefined ||
      (typeof message.changeId === "number" &&
        Number.isInteger(message.changeId) &&
        message.changeId > 0)) &&
    typeof message.beforeText === "string" &&
    typeof message.text === "string" &&
    (message.sourceAction === undefined ||
      message.sourceAction === "markdownTaskToggle") &&
    (message.changes === undefined ||
      (Array.isArray(message.changes) &&
        message.changes.every(isDocumentChange))) &&
    (message.changeGroups === undefined ||
      (Array.isArray(message.changeGroups) &&
        message.changeGroups.every(
          (changeGroup) =>
            Array.isArray(changeGroup) && changeGroup.every(isDocumentChange),
        ))) &&
    typeof message.baseRevision === "number" &&
    Number.isInteger(message.baseRevision) &&
    message.baseRevision >= 0
  );
}

function isDocumentChange(change: unknown): change is DocumentChange {
  if (!isMessageRecord(change)) {
    return false;
  }

  const from = change.from;
  const to = change.to;
  return (
    typeof from === "number" &&
    Number.isInteger(from) &&
    from >= 0 &&
    typeof to === "number" &&
    Number.isInteger(to) &&
    to >= from &&
    typeof change.text === "string"
  );
}

function isDebugMessage(message: unknown): message is DebugMessage {
  return (
    isMessageRecord(message) &&
    message.type === "debug" &&
    typeof message.event === "string" &&
    "details" in message
  );
}

function isEditorCommandMessage(
  message: unknown,
): message is EditorCommandMessage {
  return (
    isMessageRecord(message) &&
    message.type === "editorCommand" &&
    (message.command === "undo" || message.command === "redo") &&
    typeof message.beforeText === "string" &&
    typeof message.baseRevision === "number" &&
    Number.isInteger(message.baseRevision) &&
    message.baseRevision >= 0
  );
}

function isOpenClipboardSettingsMessage(
  message: unknown,
): message is OpenClipboardSettingsMessage {
  return isMessageRecord(message) && message.type === "openClipboardSettings";
}

function isMessageRecord(message: unknown): message is Record<string, unknown> {
  return Boolean(message) && typeof message === "object";
}

function isDebugEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("markdownLiveRenderTables")
    .get<boolean>(DEBUG_SETTING, false);
}

function logDebug(message: string): void {
  if (!isDebugEnabled()) {
    return;
  }

  debugOutputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

async function reopenActiveEditorWith(editorId: string): Promise<void> {
  await vscode.commands.executeCommand(
    REOPEN_ACTIVE_EDITOR_WITH_COMMAND,
    editorId,
  );
}

function getEditorHtml(
  webview: vscode.Webview,
  scriptText: string,
  styleText: string,
  initialText: string,
  documentUri: vscode.Uri,
  clipboardDocumentToken: string,
  readOnly: boolean,
): string {
  const nonce = getNonce();
  const initialDocumentScript = JSON.stringify(initialText).replace(
    /<\/script/gi,
    "<\\/script",
  );
  const editorMetricsCss = getEditorMetricsCss(documentUri);
  const editorOptionsScript = JSON.stringify(
    getEditorOptions(documentUri, clipboardDocumentToken, readOnly),
  );
  const inlineScript = scriptText.replace(/<\/script/gi, "<\\/script");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
${editorMetricsCss}
    }
${styleText}
  </style>
  <title>Markdown Live Editor</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__MLRT_INITIAL_DOCUMENT__ = ${initialDocumentScript};
    window.__MLRT_EDITOR_OPTIONS__ = ${editorOptionsScript};
  </script>
  <script nonce="${nonce}">
${inlineScript}
  </script>
</body>
</html>`;
}

function getEditorMetricsCss(documentUri: vscode.Uri): string {
  const editorConfig = vscode.workspace.getConfiguration("editor", documentUri);
  const fontSize = clampNumber(
    editorConfig.get<number>("fontSize", 14),
    6,
    100,
  );
  const configuredLineHeight = clampNumber(
    editorConfig.get<number>("lineHeight", 0),
    0,
    300,
  );
  const cursorWidth = clampNumber(
    editorConfig.get<number>("cursorWidth", 1),
    1,
    10,
  );
  const letterSpacing = clampNumber(
    editorConfig.get<number>("letterSpacing", 0),
    -10,
    20,
  );
  const padding = editorConfig.get<{ top?: number; bottom?: number }>(
    "padding",
    {},
  );
  const paddingTop = clampNumber(padding.top ?? 0, 0, 200);
  const paddingBottom = clampNumber(padding.bottom ?? 0, 0, 200);
  const fontFamily = sanitizeCssValue(
    editorConfig.get<string>("fontFamily", "monospace"),
    "monospace",
  );
  const fontWeight = sanitizeCssValue(
    editorConfig.get<string>("fontWeight", "normal"),
    "normal",
  );
  const fontFeatureSettings = getFontFeatureSettings(editorConfig);
  const fontVariationSettings = getFontVariationSettings(editorConfig);
  // Match Monaco's BareFontInfo calculation. VS Code intentionally uses a
  // taller default on macOS and a denser default on Windows/Linux; values
  // below its 8px minimum are interpreted as em multipliers.
  const defaultLineHeightRatio = process.platform === "darwin" ? 1.5 : 1.35;
  const lineHeightRatio =
    configuredLineHeight === 0
      ? defaultLineHeightRatio
      : configuredLineHeight < 8
        ? configuredLineHeight
        : configuredLineHeight / fontSize;

  return [
    `      --mlrt-editor-font-family: var(--vscode-editor-font-family, ${fontFamily});`,
    `      --mlrt-editor-font-size: var(--vscode-editor-font-size, ${fontSize}px);`,
    `      --mlrt-editor-font-weight: var(--vscode-editor-font-weight, ${fontWeight});`,
    `      --mlrt-editor-line-height: calc(var(--mlrt-editor-font-size) * ${lineHeightRatio.toFixed(4)});`,
    `      --mlrt-editor-letter-spacing: ${letterSpacing}px;`,
    `      --mlrt-editor-font-feature-settings: ${fontFeatureSettings};`,
    `      --mlrt-editor-font-variation-settings: ${fontVariationSettings};`,
    `      --mlrt-editor-cursor-width: ${cursorWidth}px;`,
    `      --mlrt-editor-top-padding: ${paddingTop}px;`,
    `      --mlrt-editor-bottom-padding: ${paddingBottom}px;`,
    `      --mlrt-editor-gutter-left-padding: 2.5ch;`,
    `      --mlrt-editor-line-number-width: 3ch;`,
    `      --mlrt-editor-gutter-right-padding: 26px;`,
    `      --mlrt-editor-right-padding: var(--mlrt-editor-gutter-right-padding);`,
    `      --mlrt-editor-gutter-width: calc(var(--mlrt-editor-gutter-left-padding) + var(--mlrt-editor-line-number-width) + var(--mlrt-editor-gutter-right-padding));`,
    `      --mlrt-live-content-width: calc(100vw - var(--mlrt-editor-right-padding));`,
    `      --mlrt-live-gutter-width: var(--mlrt-editor-gutter-width);`,
  ].join("\n");
}

/**
 * Line wrapping in the live editor follows the effective `editor.wordWrap`
 * for markdown files (VS Code defaults markdown to "on"), so the webview
 * matches what the stock editor would do for the same document.
 */
function getEditorOptions(
  documentUri: vscode.Uri,
  clipboardDocumentToken: string,
  readOnly: boolean,
): {
  lineWrapping: boolean;
  scrollBeyondLastLine: boolean;
  clipboardDocumentToken: string;
  defaultCopyMode: "smart" | "rich" | "plain" | "markdown";
  defaultPasteMode: "auto" | "rich" | "plain" | "markdown";
  tableNavigationModifierKey: TableNavigationModifierKey;
  markdownRendering: {
    enabled: boolean;
    screenReaderOptimized: boolean;
    readOnly: boolean;
  };
  markdownLinks: {
    documentUri: string | null;
    multiCursorModifier: "alt" | "ctrlCmd";
    isMac: boolean;
  };
} {
  const editorConfig = vscode.workspace.getConfiguration("editor", {
    uri: documentUri,
    languageId: "markdown",
  });
  const wordWrap = editorConfig.get<string>("wordWrap", "on");
  const extensionConfig = vscode.workspace.getConfiguration(
    "markdownLiveRenderTables",
    documentUri,
  );
  return {
    lineWrapping: wordWrap !== "off",
    scrollBeyondLastLine: editorConfig.get<boolean>(
      "scrollBeyondLastLine",
      true,
    ),
    clipboardDocumentToken,
    markdownLinks: {
      documentUri: documentUri.scheme === "untitled" ? null : documentUri.toString(),
      multiCursorModifier: editorConfig.get<string>("multiCursorModifier", "alt") === "ctrlCmd" ? "ctrlCmd" : "alt",
      isMac: process.platform === "darwin",
    },
    markdownRendering: {
      enabled: extensionConfig.get<boolean>(
        MARKDOWN_RENDERING_ENABLED_SETTING,
        true,
      ),
      // Auto-detected accessibility is exposed to webviews through VS Code's
      // injected body class. This covers the explicit host preference too.
      screenReaderOptimized:
        editorConfig.get<string>("accessibilitySupport", "auto") === "on",
      readOnly,
    },
    tableNavigationModifierKey: normalizeTableNavigationModifierKey(
      extensionConfig.get<string>(
        TABLE_NAVIGATION_MODIFIER_KEY_SETTING,
        DEFAULT_TABLE_NAVIGATION_MODIFIER_KEY,
      ),
    ),
    defaultCopyMode: readEnumSetting(
      extensionConfig.get<string>(DEFAULT_COPY_MODE_SETTING, "smart"),
      ["smart", "rich", "plain", "markdown"] as const,
      "smart",
    ),
    defaultPasteMode: readEnumSetting(
      extensionConfig.get<string>(DEFAULT_PASTE_MODE_SETTING, "auto"),
      ["auto", "rich", "plain", "markdown"] as const,
      "auto",
    ),
  };
}

async function isDocumentKnownReadOnly(uri: vscode.Uri): Promise<boolean> {
  if (vscode.workspace.fs.isWritableFileSystem(uri.scheme) === false) {
    return true;
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (
      stat.permissions !== undefined &&
      (stat.permissions & vscode.FilePermission.Readonly) !== 0
    ) {
      return true;
    }
  } catch {
    // Untitled and provider-backed documents may not expose a FileStat.
    // Unknown permission is left to the authoritative WorkspaceEdit result.
  }
  if (uri.scheme === "file") {
    try {
      await fs.promises.access(uri.fsPath, fs.constants.W_OK);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
        return true;
      }
    }
  }
  return false;
}

function isSingleTaskToggleClaim(message: ChangeMessage): boolean {
  if (message.changeGroups !== undefined || message.changes?.length !== 1) {
    return false;
  }
  const change = message.changes[0];
  const source = normalizeDocumentText(message.beforeText);
  const planned = planTaskToggle(
    source,
    markdownRenderingParser.parse(source),
    change.from - 1,
    parseMarkdownTables(source),
  );
  return (
    planned !== null &&
    planned.from === change.from &&
    planned.to === change.to &&
    planned.insert === change.text
  );
}

function readEnumSetting<const T extends readonly string[]>(
  value: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  return allowed.includes(value) ? (value as T[number]) : fallback;
}

function getFontFeatureSettings(
  editorConfig: vscode.WorkspaceConfiguration,
): string {
  const fontLigatures = editorConfig.get<boolean | string>(
    "fontLigatures",
    false,
  );
  if (typeof fontLigatures === "string") {
    return sanitizeCssValue(fontLigatures, "normal");
  }

  return fontLigatures ? '"liga" on, "calt" on' : "normal";
}

function getFontVariationSettings(
  editorConfig: vscode.WorkspaceConfiguration,
): string {
  const fontVariations = editorConfig.get<boolean | string>(
    "fontVariations",
    false,
  );
  if (typeof fontVariations === "string") {
    return sanitizeCssValue(fontVariations, "normal");
  }

  return fontVariations ? "normal" : "normal";
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeCssValue(value: string, fallback: string): string {
  const cleaned = value.replace(/[;{}<>]/g, "").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
