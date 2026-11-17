import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { markdownRenderingParser } from "../editor/markdown/markdownSyntax";
import { isMarkdownLinkModifier } from "../editor/markdown/markdownLinks";
import { collectMarkdownLinks, findMarkdownLinkAt, isMarkdownOpenLinkRequest, resolveMarkdownLinkDestination, resolveMarkdownSourceLink, markdownFragmentOffset } from "../shared/markdownLinkValidation";
import { parseMarkdownTables } from "../shared/tableModel";

function link(source: string, position = 2) {
  return findMarkdownLinkAt(source, markdownRenderingParser.parse(source), position, parseMarkdownTables(source));
}
assert.equal(link('[hi](https://example.test/a?x=1&amp;y=2 "title")')?.destination, "https://example.test/a?x=1&y=2");
assert.equal(link("[hi](a\\(b\\).md)")?.destination, "a(b).md");
assert.equal(link("[hi](<a path.md>)")?.destination, "a path.md");
assert.equal(link("[hi](https://example.test/a(b)c)")?.destination, "https://example.test/a(b)c");
assert.equal(link("<https://example.test/?x=&amp;y=2>")?.destination, "https://example.test/?x=&amp;y=2");
assert.equal(link("<https://example.test/a\\b>")?.destination, "https://example.test/a\\b");
assert.equal(link("[hi][LaBel]\n\n[label]: first.md\n[LABEL]: second.md")?.destination, "first.md");
assert.equal(link("[foo][]\n\n[FOO]: <../other.md> \"title\"")?.destination, "../other.md");
assert.equal(link("[foo]\n\n[foo]: ../other.md")?.destination, "../other.md");
assert.equal(link("[a   b]\n\n[A B]: /absolute.md")?.destination, "/absolute.md");
assert.equal(link("[Straße]\n\n[STRASSE]: one.md")?.destination, "one.md");
assert.equal(link("[foo]\n\n[foo]:\n  <https://example.test>\n  'title'")?.destination, "https://example.test");
assert.equal(link("[foo]\n\n[foo]: command:bad\n[foo]: https://safe.test")?.destination, "command:bad");
assert.equal(link("[unresolved]"), null);
assert.equal(link("![image](./file.png)", 5), null);
const linkedImage = "[![image](./file.png)](https://outer.test)";
assert.equal(link(linkedImage, linkedImage.indexOf("image") + 1)?.destination, "https://outer.test");
assert.equal(link(linkedImage, linkedImage.indexOf("file.png") + 1)?.destination, "https://outer.test");
assert.equal(link("`[literal](https://example.test)`", 8), null);
assert.equal(link("```\n[x](https://example.test)\n```", 8), null);
assert.equal(link("<!-- [x](https://example.test) -->", 9), null);
assert.equal(link("<div>\n[x](https://example.test)\n</div>", 10), null);
const table = "| A | B |\n| --- | --- |\n| [x](https://example.test) | value |";
assert.equal(link(table, table.indexOf("[x]") + 1), null);
const inline = "<https://example.test/#part> <a@b.test> www.example.test https://other.test a@b.test";
const links = collectMarkdownLinks(inline, markdownRenderingParser.parse(inline));
assert.deepEqual(links.map(value => value.destination), ["https://example.test/#part", "mailto:a@b.test", "http://www.example.test", "https://other.test", "mailto:a@b.test"]);
const frontmatter = "---\nurl: [x](https://example.test)\n---\n\n[x](safe.md)";
assert.equal(link(frontmatter, frontmatter.indexOf("[x]") + 1), null);
assert.equal(link(frontmatter, frontmatter.lastIndexOf("[x]") + 1)?.destination, "safe.md");

const local = "file:///C:/workspace/docs/readme.md";
const remote = "vscode-remote://ssh-remote+example/work/docs/readme.md";
function uri(destination: string, base: string | null = local): string {
  const result = resolveMarkdownLinkDestination(destination, base);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.uri : "";
}
assert.equal(uri("../other.md"), "file:///C:/workspace/other.md");
assert.equal(uri("a%20b.md"), "file:///C:/workspace/docs/a%20b.md");
assert.equal(uri("a%2520b.md"), "file:///C:/workspace/docs/a%2520b.md");
assert.equal(uri("a%23b.md"), "file:///C:/workspace/docs/a%23b.md");
assert.equal(uri("a path/世界.md"), "file:///C:/workspace/docs/a%20path/%E4%B8%96%E7%95%8C.md");
assert.equal(uri("/work/other.md", remote), "vscode-remote://ssh-remote+example/work/other.md");
assert.equal(uri("../other.md", remote), "vscode-remote://ssh-remote+example/work/other.md");
assert.equal(uri("C:\\elsewhere\\file.md"), "file:///C:/elsewhere/file.md");
assert.equal(uri("https://example.test/#heading", null), "https://example.test/#heading");
assert.equal(uri("https://example.test/a\\b", null), "https://example.test/a%5Cb");
assert.equal(uri("mailto:a@b.test?subject=Hello", null), "mailto:a@b.test?subject=Hello");
for (const destination of ["command:bad", "javascript:alert(1)", "data:text/plain,hello", "custom:handler", "file:///other.md", "//other/path.md", "\\\\other\\file.md", "java\nscript:bad"]) {
  assert.equal(resolveMarkdownLinkDestination(destination, local).ok, false, destination);
}
assert.equal(resolveMarkdownLinkDestination("../file.md", null).ok, false);
assert.equal(resolveMarkdownLinkDestination("../file.md", "untitled:Untitled-1").ok, false);
assert.equal(resolveMarkdownLinkDestination("C:\\elsewhere\\file.md", remote).ok, false);
assert.equal(link('[[Note|Alias]]')?.destination, 'Note');
assert.equal(link('![[Embed]]'), null);
assert.equal(link('`[[literal]]`'), null);
assert.equal(link('[[unclosed'), null);
assert.equal(link('\\[[escaped]]'), null);
const wiki = link('[[Note#Heading|Alias]]'); assert(wiki);
assert.deepEqual(resolveMarkdownSourceLink(wiki, local), { ok: true, kind: 'document', uri: 'file:///C:/workspace/docs/Note.md', fragment: 'Heading' });
assert.equal(resolveMarkdownSourceLink({ ...wiki, destination: 'javascript:bad' }, local).ok, false);
assert.deepEqual(resolveMarkdownLinkDestination('#headings', local), { ok: true, kind: 'document', uri: local, fragment: 'headings' });
const headings = '# Top\n\n## A **Heading**\n\nText ^block-id\n';
assert.equal(markdownFragmentOffset(headings, markdownRenderingParser.parse(headings), 'a-heading'), headings.indexOf('##'));
assert.equal(markdownFragmentOffset(headings, markdownRenderingParser.parse(headings), '^block-id'), headings.indexOf('Text'));
assert.equal(markdownFragmentOffset(headings, markdownRenderingParser.parse(headings), 'missing'), null);

const modifier = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
assert.equal(isMarkdownLinkModifier({ ...modifier, ctrlKey: true }, { isMac: false, multiCursorModifier: "alt" }), true);
assert.equal(isMarkdownLinkModifier({ ...modifier, metaKey: true }, { isMac: true, multiCursorModifier: "alt" }), true);
assert.equal(isMarkdownLinkModifier({ ...modifier, ctrlKey: true }, { isMac: true, multiCursorModifier: "alt" }), false);
assert.equal(isMarkdownLinkModifier({ ...modifier, altKey: true }, { isMac: false, multiCursorModifier: "ctrlCmd" }), true);
assert.equal(isMarkdownLinkModifier({ ...modifier, ctrlKey: true, altKey: true }, { isMac: false, multiCursorModifier: "alt" }), false);
assert.equal(isMarkdownLinkModifier({ ...modifier, ctrlKey: true, shiftKey: true }, { isMac: false, multiCursorModifier: "alt" }), false);
assert.equal(isMarkdownLinkModifier({ ...modifier, ctrlKey: true, getModifierState: key => key === "AltGraph" }, { isMac: false, multiCursorModifier: "alt" }), false);

// Intercept only the public ViewPlugin factory to instantiate the real client
// class against a tiny focus surface. This checks retained-view ownership
// across compartment/plugin recreation without claiming rendered UI coverage.
{
  const entry = path.join(process.cwd(), "dist/editor/markdown/markdownLinks.js");
  const localRequire = createRequire(entry);
  let Client: any;
  class Surface {
    constructor(readonly owner: "source" | "table" | "body") {}
    closest() { return this.owner === "table" ? this : null; }
  }
  const source = new Surface("source");
  let focusListener: ((event: unknown) => void) | null = null;
  const ownerDocument = { activeElement: new Surface("table"),
    addEventListener: (_name: string, listener: (event: unknown) => void) => { focusListener = listener; },
    removeEventListener: () => { focusListener = null; } };
  const view = { dom: { ownerDocument }, contentDOM: { contains: (target: unknown) => target === source } };
  const instanceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(entry, "utf8"), { module: instanceModule, exports: instanceModule.exports,
    Element: Surface, require: (name: string) => name === "@codemirror/view"
      ? { ...localRequire(name), ViewPlugin: { fromClass: (type: unknown) => { Client = type; return {}; } } }
      : localRequire(name) });
  const first = new Client(view); assert.equal(first.sourceOwnsContext, false); first.destroy();
  ownerDocument.activeElement = new Surface("body");
  const reconfigured = new Client(view);
  assert.equal(reconfigured.sourceOwnsContext, false, "palette focus must not reset retained table ownership on reconfigure");
  (focusListener as unknown as (event: unknown) => void)({ target: source });
  assert.equal(reconfigured.sourceOwnsContext, true); reconfigured.destroy();
  const sourceReconfigured = new Client(view); assert.equal(sourceReconfigured.sourceOwnsContext, true); sourceReconfigured.destroy();

  const clientExports = instanceModule.exports as typeof import("../editor/markdown/markdownLinks");
  const disabledOptions = { enabled: false, documentUri: local, multiCursorModifier: "alt" as const, isMac: false };
  const disabledExtensions = clientExports.createMarkdownLinkExtensions(disabledOptions, () => {}) as unknown[];
  const enabledExtensions = clientExports.createMarkdownLinkExtensions({ ...disabledOptions, enabled: true }, () => {}) as unknown[];
  assert.equal(disabledExtensions[1], enabledExtensions[1], "passive focus tracking must remain installed while disabled");
  assert.ok(disabledExtensions[1] && !Array.isArray(disabledExtensions[1]));
  const disabledClient = new Client(view);
  (focusListener as unknown as (event: unknown) => void)({ target: new Surface("table") });
  (focusListener as unknown as (event: unknown) => void)({ target: new Surface("body") });
  assert.equal(disabledClient.sourceOwnsContext, false, "a table selected while disabled retains ownership during palette re-enable");
  disabledClient.destroy();

  const intents: unknown[] = [];
  const pointerView: any = { ...view, dispatch() {}, state: { doc: {}, selection: {},
    facet: () => ({ options: { enabled: true }, post: (intent: unknown) => intents.push(intent) }) } };
  const pointerClient = new Client(pointerView);
  // Isolate gesture validation from the separately tested source resolver.
  pointerClient.atPoint = () => ({ from: 0, to: 8, destination: "https://example.test", kind: "link" });
  const event = (extra: Record<string, unknown> = {}) => ({ target: source, button: 0, buttons: 1,
    isPrimary: true, pointerId: 7, clientX: 20, clientY: 20, preventDefault() {}, ...extra });
  assert.equal(pointerClient.down(event({ isPrimary: false })), false);
  pointerClient.down(event()); assert.equal(pointerClient.up(event({ pointerId: 8 })), false);
  pointerClient.down(event()); pointerClient.move(event({ clientX: 40 })); assert.equal(pointerClient.up(event()), false);
  pointerClient.down(event()); pointerView.state.doc = {}; assert.equal(pointerClient.up(event()), false);
  pointerClient.down(event()); pointerView.state.selection = {}; assert.equal(pointerClient.up(event()), false);
  assert.equal(intents.length, 0, "secondary, mismatched, dragged and stale pointer gestures cannot open");
  pointerClient.down(event()); assert.equal(pointerClient.up(event()), true);
  assert.equal(intents.length, 1);
  pointerClient.down(event()); pointerClient.move(event());
  const previousConfiguration = pointerView.state.facet();
  const nextConfiguration = { options: { enabled: false }, post: previousConfiguration.post };
  pointerView.state.facet = () => nextConfiguration;
  pointerClient.update({ startState: { facet: () => previousConfiguration }, state: pointerView.state });
  assert.equal(pointerClient.up(event()), false, "disabling must discard an unsent pointer intent");
  assert.equal(pointerClient.decorations.size, 0, "disabling must remove actionable hover");
  pointerClient.destroy();
}

// Exercise the actual bundled provider in an isolated VM. All open APIs are
// mocks: this test never launches an external application or reads a target.
class Disposable {
  constructor(private callback = () => {}) {}
  dispose() { const callback = this.callback; this.callback = () => {}; callback(); }
  static from(...values: Disposable[]) { return new Disposable(() => values.forEach(value => value.dispose())); }
}
function hub() {
  const listeners = new Set<(value: any) => void>();
  return { event: (listener: (value: any) => void) => { listeners.add(listener); return new Disposable(() => { listeners.delete(listener); }); },
    fire: (value: any) => { for (const listener of listeners) listener(value); } };
}
const flush = async () => { for (let count = 0; count < 40; count++) await Promise.resolve(); };

/** `files`: the workspace folder `test:///work` exists and lists these paths. */
async function host(initialText = "[site](https://example.test)", files?: string[]) {
  let text = initialText;
  let renderingEnabled = true;
  let provider: any;
  const messages: any[] = [];
  const external: string[] = [];
  const openedDocuments: string[] = [];
  const shownDocuments: any[] = [];
  const errors: string[] = [];
  const executed: any[][] = [];
  let listings = 0, watchers = 0, failingListings = 0, hangingListings = false;
  const created = hub(), deleted = hub();
  // The host's timers run only when a check advances them.
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const received = hub();
  const closed = hub();
  const changes = hub();
  const viewState = hub();
  const commands = new Map<string, () => Promise<void>>();
  const makeUri = (value: string): any => ({ scheme: new URL(value).protocol.slice(0, -1), fsPath: new URL(value).pathname,
    path: decodeURIComponent(new URL(value).pathname), toString: () => value });
  const workFolder = { uri: makeUri("test:///work"), name: "work", index: 0 };
  const document = { uri: makeUri("test:///work/readme.md"), fileName: "readme.md", isClosed: false, isUntitled: false,
    eol: 1, version: 1, getText: () => text };
  const panel: any = { active: true, viewColumn: 1, onDidDispose: closed.event, onDidChangeViewState: viewState.event,
    webview: { cspSource: "test:", asWebviewUri: (uri: { fsPath: string }) => uri.fsPath, onDidReceiveMessage: received.event,
      postMessage: (message: unknown) => { messages.push(message); return Promise.resolve(true); }, html: "" } };
  class TabInputCustom { constructor(public uri: any, public viewType: string) {} }
  class WorkspaceEdit {
    entries: any[] = [];
    replace(uri: any, range: any, insert: string) { this.entries.push({ uri, range, insert }); }
  }
  let readTarget: () => Promise<any> = () => Promise.resolve({ uri: makeUri("test:///work/other.md") });
  const api: any = {
    Disposable, TabInputCustom, FilePermission: { Readonly: 1 }, EndOfLine: { LF: 1, CRLF: 2 }, WorkspaceEdit,
    Uri: { parse: makeUri, joinPath: (base: any, ...parts: string[]) => base.path === undefined
      ? { fsPath: path.join(base.fsPath, ...parts) }
      : makeUri(`${base.toString()}/${parts.map(part => encodeURIComponent(part)).join("/")}`) },
    RelativePattern: class { constructor(public base: any, public pattern: string) {} },
    Position: class { constructor(public line: number, public character: number) {} },
    Range: class { constructor(public start: any, public end: any) {} },
    env: { openExternal: async (target: any) => { external.push(target.toString()); return true; } },
    window: {
      onDidChangeActiveColorTheme: () => new Disposable(),
      createOutputChannel: () => ({ dispose() {}, appendLine() {}, show() {} }),
      registerCustomEditorProvider: (_id: string, value: any) => { provider = value; return new Disposable(); },
      showWarningMessage: (message: string) => errors.push(message), showErrorMessage: (message: string) => errors.push(message),
      showInformationMessage: (message: string) => errors.push(message),
      showTextDocument: async (target: any) => { shownDocuments.push(target); },
      tabGroups: { activeTabGroup: { activeTab: { input: new TabInputCustom(document.uri, "markdownLiveRenderTables.liveEditor") } } },
    },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return new Disposable(); },
      executeCommand: async (...args: any[]) => { executed.push(args); } },
    extensions: { onDidChange: () => new Disposable() },
    workspace: {
      fs: { isWritableFileSystem: () => true, stat: async () => ({ permissions: 0 }) },
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === "markdownRendering.enabled" ? renderingEnabled : fallback }),
      onDidChangeTextDocument: changes.event, onDidChangeConfiguration: hub().event,
      workspaceFolders: files ? [workFolder] : undefined, onDidChangeWorkspaceFolders: hub().event,
      getWorkspaceFolder: (uri: any) => files && uri.toString().startsWith("test:///work/") ? workFolder : undefined,
      findFiles: async () => {
        listings++;
        if (hangingListings) return new Promise(() => {});
        if (failingListings > 0) { failingListings--; throw new Error("listing failed"); }
        return (files ?? []).map(file => { const value = `test:///work/${file.split("/").map(encodeURIComponent).join("/")}`;
          return { path: `/work/${file}`, toString: () => value }; });
      },
      createFileSystemWatcher: () => { watchers++; return { onDidCreate: created.event, onDidDelete: deleted.event, dispose: () => { watchers--; } }; },
      openTextDocument: (target: any) => { openedDocuments.push(target.toString()); return readTarget(); },
      applyEdit: async (edit: WorkspaceEdit) => {
        const offset = (point: any) => text.split("\n").slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) + point.character;
        for (const entry of [...edit.entries].reverse()) text = text.slice(0, offset(entry.range.start)) + entry.insert + text.slice(offset(entry.range.end));
        document.version++; changes.fire({ document }); return true;
      },
    },
  };
  const entry = path.join(process.cwd(), "dist", "extension.js");
  const hostModule = { exports: {} as any };
  vm.runInNewContext(fs.readFileSync(entry, "utf8"), { module: hostModule, exports: hostModule.exports,
    __filename: entry, __dirname: path.dirname(entry), require: (name: string) => name === "vscode" ? api : require(name),
    console, process, Buffer, URL, TextEncoder, TextDecoder,
    setTimeout: (callback: () => void) => { timers.set(nextTimer, callback); return nextTimer++; },
    clearTimeout: (id: number) => { timers.delete(id); } }, { filename: entry });
  hostModule.exports.activate({ extensionUri: { fsPath: process.cwd() }, subscriptions: [] });
  await provider.resolveCustomTextEditor(document, panel);
  received.fire({ type: "ready" }); await flush();
  const initial = messages.find(message => message.type === "setDocument");
  assert.ok(initial?.editorOptions?.clipboardDocumentToken);
  const request = (overrides: Record<string, unknown> = {}) => {
    const target = link(text, text.indexOf("[") + 1);
    assert.ok(target);
    return { type: "openMarkdownLink", sessionToken: initial.editorOptions.clipboardDocumentToken,
      requestId: 1, baseRevision: initial.revision, beforeText: text, from: target.from, to: target.to,
      activation: "command", ...overrides };
  };
  /** The live editors a link opened, as the URIs passed to `vscode.openWith`. */
  const liveOpened = (): string[] => executed.filter(call => call[0] === "vscode.openWith").map(call => {
    assert.equal(call[2], "markdownLiveRenderTables.liveEditor"); return call[1].toString();
  });
  const status = async (targets: string[], overrides: Record<string, unknown> = {}): Promise<any> => {
    const requestId = 100 + messages.length;
    received.fire({ type: "resolveWikiLinks", sessionToken: initial.editorOptions.clipboardDocumentToken, requestId, targets, ...overrides });
    await flush();
    return messages.find(message => message.type === "wikiLinkStatus" && message.requestId === requestId)?.statuses;
  };
  /** A second live editor of the same provider: for a note that is already open, or for this document again. */
  const openSecond = async (uri: string, secondText: string) => {
    const secondMessages: any[] = [], revealed: unknown[] = [];
    const secondReceived = hub(), secondClosed = hub();
    const secondDocument = uri === document.uri.toString() ? document
      : { uri: makeUri(uri), fileName: uri, isClosed: false, isUntitled: false, eol: 1, version: 1, getText: () => secondText };
    const secondPanel: any = { active: false, viewColumn: 2, onDidDispose: secondClosed.event, onDidChangeViewState: hub().event,
      reveal: (...args: unknown[]) => { revealed.push(args); },
      webview: { cspSource: "test:", asWebviewUri: (value: { fsPath: string }) => value.fsPath, onDidReceiveMessage: secondReceived.event,
        postMessage: (message: unknown) => { secondMessages.push(message); return Promise.resolve(true); }, html: "" } };
    await provider.resolveCustomTextEditor(secondDocument, secondPanel);
    const html: string = secondPanel.webview.html;
    return { document: secondDocument, messages: secondMessages, revealed, html, send: secondReceived.fire,
      close: () => secondClosed.fire(undefined), token: /"clipboardDocumentToken":"([^"]+)"/.exec(html)?.[1] };
  };
  return { panel, messages, external, openedDocuments, shownDocuments, errors, document, commands, liveOpened, status, openSecond,
    listings: () => listings, watchers: () => watchers, fileCreated: () => created.fire(undefined), fileDeleted: () => deleted.fire(undefined),
    addFile: (file: string) => { files?.push(file); }, failListings: (count: number) => { failingListings = count; },
    hangListings: (value: boolean) => { hangingListings = value; },
    runTimers: async () => { for (const [id, callback] of Array.from(timers)) { timers.delete(id); callback(); } await flush(); },
    send: received.fire, request, close: () => closed.fire(undefined),
    setText: (value: string) => { text = value; document.version++; changes.fire({ document }); },
    setRenderingEnabled: (value: boolean) => { renderingEnabled = value; },
    deferTarget: (value: () => Promise<any>) => { readTarget = value; } };
}

async function hostChecks() {
  {
    const value = await host();
    assert.ok(isMarkdownOpenLinkRequest(value.request()));
    assert.equal(isMarkdownOpenLinkRequest(value.request({ from: 1.5 })), false);
    await value.commands.get("markdownLiveRenderTables.openMarkdownLinkAtCaret")?.();
    assert.equal(value.messages.at(-1).type, "markdownLinkCommand");
    value.send(value.request()); await flush();
    assert.deepEqual(value.external, ["https://example.test/"]);
    assert.equal(value.messages.at(-1).ok, true); value.close();
  }
  for (const override of [{ sessionToken: "foreign" }, { beforeText: "stale" }, { baseRevision: 999 }, { to: 2 }]) {
    const value = await host(); value.send(value.request(override)); await flush();
    assert.equal(value.external.length, 0); assert.equal(value.messages.at(-1).ok, false); value.close();
  }
  for (const destination of ["command:evil", "javascript:alert(1)", "data:text/plain,bad"]) {
    const value = await host(`[site](${destination})`); value.send(value.request()); await flush();
    assert.equal(value.external.length, 0); assert.equal(value.openedDocuments.length, 0);
    assert.equal(value.messages.at(-1).ok, false); value.close();
  }
  for (const source of ['[[other#Heading|Alias]]', '[heading](other.md#heading)']) {
    const value = await host(source);
    value.deferTarget(async () => ({ uri: { toString: () => 'test:///work/other.md' }, getText: () => 'intro\n\n# Heading\nbody\n' }));
    value.send(value.request()); await flush();
    assert.deepEqual(value.openedDocuments, ['test:///work/other.md']);
    assert.deepEqual(value.liveOpened(), ['test:///work/other.md'], "a note opens in the live editor");
    assert.equal(value.shownDocuments.length, 0); assert.equal(value.messages.at(-1).ok, true); value.close();
  }
  {
    const value = await host('[[other#Missing heading]]');
    value.deferTarget(async () => ({ uri: { toString: () => 'test:///work/other.md' }, getText: () => '# Heading\n' }));
    value.send(value.request()); await flush();
    assert.equal(value.liveOpened().length, 0, "a note is not opened for a heading it does not have");
    assert.equal(value.messages.at(-1).ok, false); assert.match(value.errors.at(-1) ?? "", /Missing heading/); value.close();
  }
  {
    // Text and other files keep opening in the ordinary editor.
    const value = await host("[settings](settings.json)");
    value.deferTarget(async () => ({ uri: { toString: () => "test:///work/settings.json" } }));
    value.send(value.request()); await flush();
    assert.equal(value.liveOpened().length, 0); assert.equal(value.shownDocuments.length, 1); value.close();
  }
  {
    const value = await host(); const request = value.request(); value.send(request); value.send(request); await flush();
    assert.equal(value.external.length, 1, "replayed request cannot open twice"); value.close();
  }
  {
    const value = await host(); value.send(value.request()); value.panel.active = false; await flush();
    assert.equal(value.external.length, 0, "queued request cannot open from a hidden panel"); value.close();
  }
  {
    const value = await host(); const beforeText = value.document.getText(); const after = `prefix ${beforeText}`;
    const request = value.request({ beforeText: after, from: 7, to: after.length });
    value.send({ type: "change", changeId: 1, beforeText, text: after, changes: [{ from: 0, to: 0, text: "prefix " }], baseRevision: request.baseRevision });
    value.send(request); await flush();
    assert.equal(value.external.length, 1, "queued preceding edit may advance revision while exact link snapshot stays valid"); value.close();
  }
  {
    const value = await host("[other](other.md)"); value.send(value.request()); await flush();
    assert.deepEqual(value.openedDocuments, ["test:///work/other.md"]);
    assert.deepEqual(value.liveOpened(), ["test:///work/other.md"]);
    assert.equal(value.shownDocuments.length, 0); assert.equal(value.external.length, 0); value.close();
  }
  for (const change of ["hide", "dispose", "source", "sourceRoundtrip", "disable"] as const) {
    const value = await host("[other](other.md)"); let release!: (document: unknown) => void;
    value.deferTarget(() => new Promise(resolve => { release = resolve; }));
    value.send(value.request()); await flush(); assert.equal(value.openedDocuments.length, 1);
    if (change === "hide") value.panel.active = false;
    else if (change === "dispose") value.close();
    else if (change === "sourceRoundtrip") { const previous = value.document.getText(); value.setText("new source"); value.setText(previous); }
    else if (change === "disable") value.setRenderingEnabled(false);
    else value.setText("new source");
    release({ uri: "mock" }); await flush();
    assert.equal(value.shownDocuments.length + value.liveOpened().length, 0, `${change} during remote read must not steal focus`);
    if (change !== "dispose") value.close();
  }
  await wikiVaultChecks();
  console.log("Markdown link checks passed: parser/reference resolution, URI allowlist, modifiers, originating session, queued edits, async focus ownership, and wikilinks in a workspace folder.");
}
/** Wikilinks in a workspace folder: the folder's listing decides the file. */
async function wikiVaultChecks() {
  // Messages are built in the host's own context; compare them as data.
  const reveals = (messages: any[]): unknown => JSON.parse(JSON.stringify(messages.filter(message => message.type === "revealSourcePosition")));
  const vault = (): string[] => ["readme.md", "Alpha.md", "sub/Alpha.md", "sub/Deep Note.md", "sub/Beta.md", "other/Beta.md", "pic.png"];
  // An editor showing wikilinks has asked about them, so the folder is listed
  // before a link is followed. `listed` stands for that.
  const listed = async (source: string, files = vault()) => { const value = await host(source, files); await value.status(["readme"]); return value; };
  for (const [source, expected] of [
    ["[[deep note]]", "test:///work/sub/Deep%20Note.md"],
    ["[[Alpha]]", "test:///work/Alpha.md"],
    ["[[sub/Alpha|the other one]]", "test:///work/sub/Alpha.md"],
    ["[[Beta]]", "test:///work/other/Beta.md"],
  ] as const) {
    // No picker exists in this mock: a link that asked would throw.
    const value = await listed(source);
    value.deferTarget(async () => ({ uri: { toString: () => expected } }));
    value.send(value.request()); await flush();
    assert.deepEqual(value.openedDocuments, [expected], source);
    assert.deepEqual(value.liveOpened(), [expected], source);
    assert.equal(value.messages.at(-1).ok, true); value.close();
  }
  {
    const value = await listed("[[Nope#Heading]]"); value.send(value.request()); await flush();
    assert.equal(value.openedDocuments.length, 0, "a missing note is reported, and nothing is opened or created");
    assert.equal(value.liveOpened().length, 0); assert.equal(value.messages.at(-1).ok, false);
    assert.match(value.errors.at(-1) ?? "", /“Nope” was not found in this workspace folder/); value.close();
  }
  for (const source of ["[[../readme]]", "[[/sub/readme]]", "[[javascript:alert(1)]]"]) {
    const value = await listed(source); value.send(value.request()); await flush();
    assert.equal(value.openedDocuments.length + value.liveOpened().length + value.external.length, 0, source);
    assert.equal(value.messages.at(-1).ok, false, source); value.close();
  }
  // VS Code turns [label](command:...) in a notification into a link that
  // runs the command. Text from the document must never form one there.
  for (const [source, words] of [
    ["[[\\[Create this note](command:workbench.action.terminal.new)|Meeting notes]]", "Create this note"],
    ["[[readme#\\[Run](command:workbench.action.terminal.new)]]\n\n# One\n", "Run"],
    ["[[#\\[Run](https://example.test/x)]]\n\n# One\n", "Run"],
  ] as const) {
    const value = await listed(source); value.send(value.request()); await flush();
    assert.equal(value.messages.at(-1).ok, false, source);
    const shown = value.errors.at(-1) ?? "";
    assert.ok(shown.includes(words), `the message carries the document's words: ${shown}`);
    assert.doesNotMatch(shown, /[\[\]]/, `no link can form in: ${shown}`);
    assert.equal(value.openedDocuments.length + value.liveOpened().length + value.external.length, 0, source); value.close();
  }
  {
    // A very long name is not a very long notification.
    const value = await listed(`[[${"long name ".repeat(40)}]]`); value.send(value.request()); await flush();
    assert.ok((value.errors.at(-1) ?? "").length < 200); value.close();
  }
  for (const source of ["[[#Two]]\n\n# One\n\n## Two\n", "[down](#two)\n\n# One\n\n## Two\n", "[[readme#Two]]\n\n# One\n\n## Two\n"]) {
    // A link into the note it is written in moves the caret; no editor opens.
    const value = await listed(source); value.send(value.request()); await flush();
    assert.deepEqual(reveals(value.messages), [{ type: "revealSourcePosition", position: { line: 4, character: 0 } }], source);
    assert.equal(value.openedDocuments.length + value.liveOpened().length + value.shownDocuments.length, 0, source);
    assert.equal(value.messages.at(-1).ok, true); value.close();
  }
  {
    const value = await listed("[[#Absent]]\n\n# One\n"); value.send(value.request()); await flush();
    assert.equal(value.messages.some(message => message.type === "revealSourcePosition"), false);
    assert.equal(value.messages.at(-1).ok, false); value.close();
  }
  {
    // A link to a heading of this note names no file: the folder is not listed for it.
    const value = await host("[[#Two]]\n\n# One\n\n## Two\n", vault()); value.send(value.request()); await flush();
    assert.equal(value.listings(), 0);
    assert.deepEqual(reveals(value.messages), [{ type: "revealSourcePosition", position: { line: 4, character: 0 } }]);
    assert.equal(value.messages.at(-1).ok, true); value.close();
  }
  {
    // Nothing waits for the first listing: edits queue behind a link request.
    // A note that is not beside the linking one cannot be found yet, and says so.
    const value = await host("[[deep note]]", vault());
    let reads = 0;
    value.deferTarget(() => reads++ === 0 ? Promise.reject(new Error("no such file"))
      : Promise.resolve({ uri: { toString: () => "test:///work/sub/Deep%20Note.md" } }));
    value.send(value.request());
    const beforeText = value.document.getText();
    value.send({ type: "change", changeId: 1, beforeText, text: `x${beforeText}`, changes: [{ from: 0, to: 0, text: "x" }], baseRevision: value.request().baseRevision });
    await flush();
    assert.equal(value.liveOpened().length, 0, "the link is not followed before the folder is listed");
    assert.match(value.errors.at(-1) ?? "", /still being listed/);
    assert.equal(value.document.getText(), `x${beforeText}`, "the edit behind the request was applied");
    value.send(value.request({ requestId: 2, beforeText: value.document.getText() })); await flush();
    assert.deepEqual(value.liveOpened(), ["test:///work/sub/Deep%20Note.md"], "the same link opens once the folder is listed"); value.close();
  }
  {
    // A note beside the linking one opens before the folder is listed, as it does outside a folder.
    const value = await host("[[Alpha]]", vault());
    value.deferTarget(async () => ({ uri: { toString: () => "test:///work/Alpha.md" } }));
    value.send(value.request()); await flush();
    assert.deepEqual(value.openedDocuments, ["test:///work/Alpha.md"]);
    assert.deepEqual(value.liveOpened(), ["test:///work/Alpha.md"]); value.close();
  }
  {
    // A file search that never answers parks nothing: links beside the note
    // open, edits apply, the search is given up and tried again, and when one
    // works the editor is told to ask about its links again.
    const value = await host("[[Alpha]]", vault());
    value.hangListings(true);
    assert.equal(await value.status(["Alpha"]), undefined, "no answer while the search hangs");
    value.deferTarget(async () => ({ uri: { toString: () => "test:///work/Alpha.md" } }));
    value.send(value.request());
    const beforeText = value.document.getText();
    value.send({ type: "change", changeId: 1, beforeText, text: `x${beforeText}`, changes: [{ from: 0, to: 0, text: "x" }], baseRevision: value.request().baseRevision });
    await flush();
    assert.deepEqual(value.liveOpened(), ["test:///work/Alpha.md"]);
    assert.equal(value.document.getText(), `x${beforeText}`, "the edit behind the request was applied");
    const answers = (): unknown[] => value.messages.filter(message => message.type === "wikiLinkStatus").map(message => Array.from(message.statuses));
    const notices = (): number => value.messages.filter(message => message.type === "wikiLinksChanged").length;
    await value.runTimers();
    assert.deepEqual(answers(), [[null]], "giving up on the search answers: not known");
    assert.equal(notices(), 0);
    value.hangListings(false);
    await value.runTimers();
    assert.equal(notices(), 1, "a listing that works after one that did not is news");
    assert.deepEqual(Array.from(await value.status(["Alpha", "Nope"])), [true, false]); value.close();
  }
  {
    // A note that is already open in a live editor is shown, at the heading.
    const value = await listed("[[Alpha#Two]]");
    const open = await value.openSecond("test:///work/Alpha.md", "# One\n\n## Two\n");
    value.deferTarget(async () => open.document);
    value.send(value.request()); await flush();
    assert.equal(open.revealed.length, 1); assert.equal(value.liveOpened().length, 0);
    assert.deepEqual(reveals(open.messages), [{ type: "revealSourcePosition", position: { line: 2, character: 0 } }]);
    assert.equal(value.messages.at(-1).ok, true); value.close();
  }
  {
    // A note that was not open is told where to start: the editor that opens for it begins at the heading.
    const value = await listed("[[Alpha#Two]]");
    value.deferTarget(async () => ({ uri: { toString: () => "test:///work/Alpha.md" }, getText: () => "# One\n\ntext\n\n## Two\n" }));
    value.send(value.request()); await flush();
    assert.deepEqual(value.liveOpened(), ["test:///work/Alpha.md"]);
    const opened = await value.openSecond("test:///work/Alpha.md", "# One\n\ntext\n\n## Two\n");
    assert.ok(opened.html.includes('window.__MLRT_INITIAL_VIEW_STATE__ = {"top":{"line":4,"character":0},"anchor":{"line":4,"character":0},"head":{"line":4,"character":0}}'),
      "the opened editor starts at the heading");
    value.close();
  }
  {
    const value = await host("[[Alpha]]", vault());
    const bystander = await value.openSecond("test:///work/sub/Beta.md", "# Beta\n");
    assert.equal(value.listings(), 0, "the folder is not listed until a wikilink needs it");
    assert.deepEqual(Array.from(await value.status(["Alpha", "ALPHA#Any heading", "Nope", "sub/Deep Note", "pic.png", "pic", "New note"])),
      [true, true, false, true, true, false, false]);
    assert.equal(await value.status(["Alpha"], { sessionToken: "foreign" }), undefined, "another session gets no answer");
    assert.equal(await value.status([]), undefined); assert.equal(value.listings(), 1); assert.equal(value.watchers(), 1);
    const notices = (): number => value.messages.filter(message => message.type === "wikiLinksChanged").length;
    // File events that leave the names as they were are not news.
    value.fileCreated(); value.fileDeleted(); await value.runTimers();
    assert.equal(value.listings(), 2); assert.equal(notices(), 0, "an unchanged listing tells the editor nothing");
    // A created file is seen after one more listing, and the editor is told once.
    value.addFile("notes/New note.md"); value.fileCreated(); value.fileCreated(); value.fileDeleted();
    assert.equal(notices(), 0);
    await value.runTimers();
    assert.equal(value.listings(), 3, "several file events are one listing");
    assert.equal(notices(), 1);
    assert.equal(bystander.messages.some(message => message.type === "wikiLinksChanged"), false, "an editor that never asked is not told");
    assert.deepEqual(Array.from(await value.status(["New note"])), [true]);
    value.close(); assert.equal(value.watchers(), 0, "a folder no editor uses is no longer watched");
    value.fileCreated(); await value.runTimers(); assert.equal(value.listings(), 3);
  }
  {
    // Two editors of one document: closing the older one keeps the folder watched for the newer.
    const value = await listed("[[Alpha]]");
    const newer = await value.openSecond("test:///work/readme.md", "");
    assert.ok(newer.token);
    newer.send({ type: "resolveWikiLinks", sessionToken: newer.token, requestId: 1, targets: ["Alpha"] }); await flush();
    assert.equal(newer.messages.filter(message => message.type === "wikiLinkStatus").length, 1);
    value.close();
    assert.equal(value.watchers(), 1, "the newer editor still uses the folder");
    newer.close(); assert.equal(value.watchers(), 0);
  }
  {
    // A listing that was cut off cannot say a note is missing: the link is
    // looked up beside the note instead, and its link is not dimmed.
    const many = Array.from({ length: 50_001 }, (_, index) => `bulk/f${index}.txt`).concat("Sibling.md");
    const value = await host("[[Sibling]]", many);
    assert.deepEqual(Array.from(await value.status(["Sibling", "bulk/f1.txt"])), [null, true]);
    value.deferTarget(async () => ({ uri: { toString: () => "test:///work/Sibling.md" } }));
    value.send(value.request()); await flush();
    assert.deepEqual(value.openedDocuments, ["test:///work/Sibling.md"]);
    assert.deepEqual(value.liveOpened(), ["test:///work/Sibling.md"]);
    // A note that is neither listed nor beside the linking one is reported for what is known.
    value.deferTarget(() => Promise.reject(new Error("no such file")));
    value.send(value.request({ requestId: 2 })); await flush();
    assert.match(value.errors.at(-1) ?? "", /“Sibling” was not found beside this note or among the files/); value.close();
  }
  {
    // A listing that fails says so, is tried again by itself, and then tells
    // the editor to ask about its links again.
    const value = await host("[[deep note]]", vault());
    value.failListings(1);
    assert.deepEqual(Array.from(await value.status(["deep note"])), [null]);
    value.deferTarget(() => Promise.reject(new Error("no such file")));
    value.send(value.request()); await flush();
    assert.match(value.errors.at(-1) ?? "", /still being listed/);
    const notices = (): number => value.messages.filter(message => message.type === "wikiLinksChanged").length;
    assert.equal(notices(), 0);
    await value.runTimers();
    assert.equal(value.listings(), 2, "the failed listing was tried again");
    assert.equal(notices(), 1, "an editor that was answered: not known, is told when a listing works");
    assert.deepEqual(Array.from(await value.status(["deep note"])), [true]);
    value.close();
  }
  {
    // Outside a workspace folder nothing is listed and nothing is known.
    const value = await host("[[other]]");
    assert.deepEqual(Array.from(await value.status(["other", "Nope"])), [null, null]);
    assert.equal(value.listings(), 0); assert.equal(value.watchers(), 0); value.close();
  }
}

void hostChecks().catch(error => { console.error(error); process.exitCode = 1; });
