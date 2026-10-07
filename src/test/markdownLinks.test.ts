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

async function host(initialText = "[site](https://example.test)") {
  let text = initialText;
  let renderingEnabled = true;
  let provider: any;
  const messages: any[] = [];
  const external: string[] = [];
  const openedDocuments: string[] = [];
  const shownDocuments: any[] = [];
  const errors: string[] = [];
  const received = hub();
  const closed = hub();
  const changes = hub();
  const viewState = hub();
  const commands = new Map<string, () => Promise<void>>();
  const makeUri = (value: string): any => ({ scheme: new URL(value).protocol.slice(0, -1), fsPath: new URL(value).pathname,
    toString: () => value });
  const document = { uri: makeUri("test:///work/readme.md"), fileName: "readme.md", isClosed: false, isUntitled: false,
    eol: 1, version: 1, getText: () => text };
  const panel: any = { active: true, viewColumn: 1, onDidDispose: closed.event, onDidChangeViewState: viewState.event,
    webview: { cspSource: "test:", onDidReceiveMessage: received.event,
      postMessage: (message: unknown) => { messages.push(message); return Promise.resolve(true); }, html: "" } };
  class TabInputCustom { constructor(public uri: any, public viewType: string) {} }
  class WorkspaceEdit {
    entries: any[] = [];
    replace(uri: any, range: any, insert: string) { this.entries.push({ uri, range, insert }); }
  }
  let readTarget: () => Promise<any> = () => Promise.resolve({ uri: makeUri("test:///work/other.md") });
  const api: any = {
    Disposable, TabInputCustom, FilePermission: { Readonly: 1 }, EndOfLine: { LF: 1, CRLF: 2 }, WorkspaceEdit,
    Uri: { parse: makeUri, joinPath: (base: any, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }) },
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
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return new Disposable(); }, executeCommand: async () => {} },
    extensions: { onDidChange: () => new Disposable() },
    workspace: {
      fs: { isWritableFileSystem: () => true, stat: async () => ({ permissions: 0 }) },
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === "markdownRendering.enabled" ? renderingEnabled : fallback }),
      onDidChangeTextDocument: changes.event, onDidChangeConfiguration: hub().event,
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
    console, process, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout }, { filename: entry });
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
  return { panel, messages, external, openedDocuments, shownDocuments, errors, document, commands,
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
    value.deferTarget(async () => ({ getText: () => '# Heading\nbody\n' }));
    value.send(value.request()); await flush();
    assert.deepEqual(value.openedDocuments, ['test:///work/other.md']);
    assert.equal(value.shownDocuments.length, 1); assert.equal(value.messages.at(-1).ok, true); value.close();
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
    assert.equal(value.shownDocuments.length, 1); assert.equal(value.external.length, 0); value.close();
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
    assert.equal(value.shownDocuments.length, 0, `${change} during remote read must not steal focus`);
    if (change !== "dispose") value.close();
  }
  console.log("Markdown link checks passed: parser/reference resolution, URI allowlist, modifiers, originating session, queued edits, and async focus ownership.");
}
void hostChecks().catch(error => { console.error(error); process.exitCode = 1; });
