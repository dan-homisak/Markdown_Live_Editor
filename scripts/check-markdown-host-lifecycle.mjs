// Exercise real bundled provider callbacks with deliberately reordered permission
// queries. No VS Code process, file mutation, or timing-dependent sleep is used.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const realRequire = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const entry = fileURLToPath(new URL("../dist/extension.js", import.meta.url));

class Disposable {
  constructor(fn = () => {}) { this.fn = fn; }
  dispose() { const fn = this.fn; this.fn = () => {}; fn(); }
  static from(...items) { return new Disposable(() => items.forEach(item => item.dispose())); }
}

function eventHub() {
  const listeners = new Set();
  return {
    event(fn) { listeners.add(fn); return new Disposable(() => listeners.delete(fn)); },
    fire(value) { for (const fn of [...listeners]) fn(value); },
    get size() { return listeners.size; },
  };
}

const queries = [];
const errors = [];
const workspaceChanges = eventHub();
const configChanges = eventHub();
let provider;
let applied = 0;
const vscode = {
  Disposable,
  FilePermission: { Readonly: 1 },
  EndOfLine: { LF: 1, CRLF: 2 },
  Uri: { joinPath(base, ...parts) { return { fsPath: path.join(base.fsPath, ...parts) }; } },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class { constructor(start, end) { this.start = start; this.end = end; } },
  WorkspaceEdit: class { replace() {} },
  window: {
    createOutputChannel() { return { dispose() {}, appendLine() {}, show() {} }; },
    registerCustomEditorProvider(_id, value) { provider = value; return new Disposable(); },
    showWarningMessage() {},
    showErrorMessage(message) { errors.push(message); },
    tabGroups: { activeTabGroup: {} },
  },
  commands: {
    registerCommand() { return new Disposable(); },
    executeCommand() { return Promise.resolve(); },
  },
  workspace: {
    fs: {
      isWritableFileSystem() { return true; },
      stat() { return new Promise(resolve => queries.push({ resolve })); },
    },
    getConfiguration() { return { get(_key, fallback) { return fallback; } }; },
    onDidChangeTextDocument: workspaceChanges.event,
    onDidChangeConfiguration: configChanges.event,
    applyEdit() { applied++; return Promise.resolve(true); },
  },
};

const hostModule = { exports: {} };
vm.runInNewContext(await readFile(entry, "utf8"), {
  module: hostModule,
  exports: hostModule.exports,
  __filename: entry,
  __dirname: path.dirname(entry),
  require(name) {
    if (name === "vscode") return vscode;
    if (builtinModules.includes(name.replace(/^node:/, ""))) return realRequire(name);
    throw new Error(`Unbundled extension-host dependency: ${name}`);
  },
  console, Buffer, process, TextEncoder, TextDecoder, setTimeout, clearTimeout,
}, { filename: entry });
hostModule.exports.activate({ extensionUri: { fsPath: projectRoot }, subscriptions: [] });
assert.ok(provider, "activation registered the actual custom-editor provider");

let fixtureId = 0;
function fixture() {
  const name = `fixture-${++fixtureId}`;
  // A writable non-file scheme reaches deferred workspace.fs.stat without
  // touching host filesystem permissions or requiring a real Markdown file.
  const uri = { scheme: "test", fsPath: `/test/${name}.md`, toString: () => `test:///${name}.md` };
  const document = { uri, fileName: `${name}.md`, isClosed: false, getText: () => "- [ ] task", eol: 1 };
  return { uri, document };
}

function panel(column = 1) {
  const closed = eventHub();
  const viewState = eventHub();
  const received = eventHub();
  const messages = [];
  let htmlWrites = 0;
  return {
    active: true, viewColumn: column, closed, viewState, received, messages,
    get htmlWrites() { return htmlWrites; },
    onDidDispose: closed.event,
    onDidChangeViewState: viewState.event,
    webview: {
      cspSource: "test:",
      onDidReceiveMessage: received.event,
      postMessage(message) { messages.push(message); return Promise.resolve(true); },
      set html(_value) { htmlWrites++; },
    },
  };
}

async function flushMicrotasks() {
  // stat -> capability result -> refresh -> serialized task -> rejection/post.
  // Drain these finite promise continuations without platform timer races.
  for (let index = 0; index < 16; index++) await Promise.resolve();
}

async function open(fix, target) {
  const pending = provider.resolveCustomTextEditor(fix.document, target);
  assert.equal(queries.length, 1);
  queries.shift().resolve({ permissions: 0 });
  await pending;
}

function task(target, baseRevision = 0) {
  target.received.fire({
    type: "change", changeId: 1,
    beforeText: "- [ ] task", text: "- [x] task",
    changes: [{ from: 3, to: 4, text: "x" }],
    baseRevision, sourceAction: "markdownTaskToggle",
  });
}

const early = fixture();
const earlyPanel = panel();
const initial = provider.resolveCustomTextEditor(early.document, earlyPanel);
assert.equal(earlyPanel.closed.size, 1, "disposal is installed before initial stat settles");
earlyPanel.closed.fire();
queries.shift().resolve({ permissions: 0 });
await initial;
assert.equal(earlyPanel.htmlWrites, 0, "a disposed panel never receives late initial HTML");
assert.equal(provider.getViewColumn(early.uri), undefined);

const same = fixture();
const olderPanel = panel(1);
const newerPanel = panel(2);
await open(same, olderPanel);
await open(same, newerPanel);
olderPanel.closed.fire();
assert.equal(provider.getViewColumn(same.uri), 2, "old disposal cannot remove a newer same-document panel");
newerPanel.closed.fire();

const race = fixture();
const racePanel = panel();
await open(race, racePanel);
racePanel.received.fire({ type: "ready" });
racePanel.viewState.fire({ webviewPanel: racePanel });
assert.equal(queries.length, 2);
const olderQuery = queries.shift();
const newerQuery = queries.shift();
newerQuery.resolve({ permissions: 1 });
await flushMicrotasks();
olderQuery.resolve({ permissions: 0 });
await flushMicrotasks();
const options = racePanel.messages.filter(message => message.type === "setEditorOptions");
assert.equal(options.length, 1, "older capability results must not overwrite newer UI state");
assert.equal(options[0].editorOptions.markdownRendering.readOnly, true);

task(racePanel, 1);
await flushMicrotasks();
const actionQuery = queries.shift();
racePanel.viewState.fire({ webviewPanel: racePanel });
const displayQuery = queries.shift();
actionQuery.resolve({ permissions: 1 });
displayQuery.resolve({ permissions: 0 });
await flushMicrotasks();
assert.equal(applied, 0, "task must use its readonly result despite a concurrent writable UI result");
assert.equal(racePanel.messages.at(-1).source, "webviewReject");
racePanel.closed.fire();

for (const closeDocument of [false, true]) {
  for (const permissions of [0, 1]) {
    const closed = fixture();
    const closedPanel = panel();
    await open(closed, closedPanel);
    task(closedPanel);
    await flushMicrotasks();
    const query = queries.shift();
    assert.ok(query, "task permission query started before closure");
    if (closeDocument) closed.document.isClosed = true;
    else closedPanel.closed.fire();
    query.resolve({ permissions });
    await flushMicrotasks();
    assert.equal(applied, 0, "no task WorkspaceEdit after panel/document closes during permission query");
    assert.equal(closedPanel.messages.length, 0, "closed action produces no late webview posts");
    if (closeDocument) closedPanel.closed.fire();
  }
}
assert.equal(queries.length, 0);
assert.equal(workspaceChanges.size, 0, "all document listeners are disposed");
assert.equal(configChanges.size, 0, "all configuration listeners are disposed");
assert.deepEqual(errors, []);
console.log("Markdown host lifecycle checks passed: disposal, panel identity, permission ordering, and task query isolation.");
