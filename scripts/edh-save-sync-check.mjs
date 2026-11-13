// Verify in a real, isolated VS Code window that a save which changes no text
// cannot cost a keystroke: the host sends no document snapshot for it, an
// acknowledgement restores an edit that a crossing snapshot rolled back, and
// typing through repeated saves loses nothing. The saves here change no text:
// the settings below turn off everything that would.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";
import { edhLaunchFlags, edhSettings, resolveEdhExecutable } from "./edh-isolation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-save-sync-"));
const qa = path.join(repo, "qa");
const port = 9700 + Math.floor(Math.random() * 100);
const crlf = process.argv.includes("--crlf");
const edits = 300;
await mkdir(path.join(profile, "User"), { recursive: true });
await mkdir(qa, { recursive: true });
await writeFile(path.join(profile, "User/settings.json"), JSON.stringify({ ...edhSettings,
  "workbench.startupEditor": "none", "window.restoreWindows": "none",
  "security.workspace.trust.enabled": false, "editor.wordWrap": "on",
  // Only the saves this check sends happen, and none of them changes the text.
  "files.autoSave": "off", "files.trimTrailingWhitespace": false,
  "files.insertFinalNewline": false, "files.trimFinalNewlines": false, "editor.formatOnSave": false,
}));
const file = path.join(profile, "SaveSync.md");
const source = "# Saving while typing\n\n| Name | Note |\n| --- | --- |\n| a | b |\n\nA paragraph of ordinary text.\n\n";
await writeFile(file, crlf ? source.replace(/\n/g, "\r\n") : source);
const normalize = text => text.replace(/\r\n?/g, "\n");
const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: "1" };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(resolveEdhExecutable(repo), [...edhLaunchFlags,
  `--extensionDevelopmentPath=${repo}`, `--user-data-dir=${profile}`,
  `--extensions-dir=${path.join(profile, "extensions")}`, `--remote-debugging-port=${port}`,
  "--new-window", "--disable-workspace-trust", "--skip-release-notes", "--skip-welcome", file,
], { env, stdio: "ignore", windowsHide: true });
const sockets = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.add(ws);
  let id = 0; const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  return { ws, send(method, params = {}) { return new Promise(resolve => {
    pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params }));
  }); } };
}
async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
}
async function until(action, description, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { const value = await action(); if (value) return value; await sleep(40); }
  throw new Error(`Timed out: ${description}`);
}
// `body` runs inside the live editor's frame. `log` holds every document message the host
// sent since this check attached, in order; `type` appends one edit at the end of the document.
const liveExpression = body => `(async () => {
  const roots = [window, ...Array.from(document.querySelectorAll('iframe')).flatMap(f => {
    try { return f.contentWindow ? [f.contentWindow] : []; } catch { return []; }
  })];
  const win = roots.find(w => { try { return w.__MLRT_EDITOR_VIEW__; } catch { return false; } });
  if (!win) return null;
  const view = win.__MLRT_EDITOR_VIEW__;
  if (!win.__MLRT_SAVE_SYNC_LOG__) {
    win.__MLRT_SAVE_SYNC_LOG__ = [];
    win.addEventListener('message', event => {
      const message = event.data;
      if (message && message.type === 'setDocument') win.__MLRT_SAVE_SYNC_LOG__.push({
        source: message.source || 'host', revision: message.revision, text: message.text.replace(/\\r\\n?/g, '\\n') });
    });
  }
  const log = win.__MLRT_SAVE_SYNC_LOG__;
  const sleep = ms => new Promise(resolve => win.setTimeout(resolve, ms));
  const waitFor = async (test, timeout = 8000) => {
    const end = win.performance.now() + timeout;
    while (win.performance.now() < end) { if (test()) return true; await sleep(10); }
    return false;
  };
  const answers = from => log.slice(from).filter(entry => entry.source !== 'host');
  const sources = from => answers(from).map(entry => entry.source);
  const type = text => { const at = view.state.doc.length;
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' }); };
  // The host sends a snapshot like this one when the document changes away and back to
  // \`text\` while an edit is on its way. This check cannot make the host do that at the
  // right moment, so it delivers the message itself, through the editor's own listener.
  const snapshot = text => win.dispatchEvent(new win.MessageEvent('message', {
    data: { type: 'setDocument', text, revision: log.at(-1).revision, debug: false } }));
  ${body}
})()`;

const results = {};
let wb;
try {
  const target = await until(async () => (await targets().catch(() => [])).find(t => /workbench\.html/.test(t.url)), "workbench");
  wb = await connect(target);
  await until(() => evaluate(wb, "!!document.querySelector('.monaco-editor .view-lines .view-line')"), "source editor");
  await sleep(2200);
  await evaluate(wb, `(() => { const dialog = document.querySelector('.monaco-dialog-box .monaco-button'); dialog?.click(); })()`);
  async function key(key, code, vk, modifiers = 0) {
    for (const type of ["keyDown", "keyUp"]) await wb.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers });
  }
  const toggle = () => key("m", "KeyM", 77, process.platform === "darwin" ? 6 : 3);
  const save = () => key("s", "KeyS", 83, process.platform === "darwin" ? 4 : 2);
  const onDisk = async () => normalize(await readFile(file, "utf8"));
  const clients = new Map();
  await toggle();
  const live = await until(async () => {
    for (const t of await targets()) {
      if (t.type !== "iframe") continue;
      let c = clients.get(t.id);
      if (!c) { c = await connect(t); clients.set(t.id, c); }
      if (await evaluate(c, liveExpression("return !!view.dom.offsetHeight;")).catch(() => false)) return c;
    }
    return null;
  }, "live editor mounted");
  await sleep(600);
  await evaluate(live, liveExpression("view.focus(); return true;"));

  // 1. A save changes no text, so the host sends nothing for it.
  const typed = await evaluate(live, liveExpression(`
    const from = log.length;
    type('q');
    await waitFor(() => answers(from).length > 0);
    return { answer: sources(from), messages: log.length, text: view.state.doc.toString() };`));
  assert.deepEqual(typed.answer, ["webviewAck"], "the first edit is acknowledged");
  await save();
  await until(async () => (await onDisk()) === typed.text, "the save reached the disk");
  await sleep(500);
  results.afterSave = await evaluate(live, liveExpression(`return log.slice(${typed.messages}).map(entry => entry.source);`));
  assert.deepEqual(results.afterSave, [], "a save sends no document snapshot");

  // 2. A snapshot of the text before an edit arrives while that edit is unanswered. The edit
  // is still valid, so the host acknowledges it, and the editor must end up holding it. The
  // state is read as soon as the answer is in: the restore happens with it, not later.
  results.crossing = await evaluate(live, liveExpression(`
    const base = view.state.doc.toString();
    const from = log.length;
    type('r');
    snapshot(base);
    const rolledBack = view.state.doc.toString() === base;
    await waitFor(() => answers(from).length > 0);
    const afterAnswer = view.state.doc.toString();
    const caret = view.state.selection.main.head;
    const next = log.length;
    type('s');
    await waitFor(() => answers(next).length > 0);
    return { rolledBack, answer: sources(from).slice(0, 1),
      restored: afterAnswer === base + 'r', caretAfterEdit: caret === base.length + 1,
      nextAnswer: sources(next), kept: view.state.doc.toString() === base + 'rs' };`));
  assert.equal(results.crossing.rolledBack, true, "the crossing snapshot rolled the edit back, as set up");
  assert.deepEqual(results.crossing.answer, ["webviewAck"], "the host accepted the edit");
  assert.equal(results.crossing.restored, true, "the acknowledgement restores the edit in the editor");
  assert.equal(results.crossing.caretAfterEdit, true, "the caret is after the restored edit");
  assert.deepEqual(results.crossing.nextAnswer, ["webviewAck"], "the next keystroke is accepted, not rejected");
  assert.equal(results.crossing.kept, true, "both edits are in the editor");

  // The same with two edits unanswered. The first acknowledgement leaves one edit open, so
  // the editor waits; the second restores both.
  results.crossingTwo = await evaluate(live, liveExpression(`
    const base = view.state.doc.toString();
    const from = log.length;
    type('t'); type('u');
    snapshot(base);
    const rolledBack = view.state.doc.toString() === base;
    await waitFor(() => answers(from).length >= 2);
    const afterAnswers = view.state.doc.toString();
    const caret = view.state.selection.main.head;
    const next = log.length;
    type('v');
    await waitFor(() => answers(next).length > 0);
    return { rolledBack, answer: sources(from).slice(0, 2),
      restored: afterAnswers === base + 'tu', caretAfterEdits: caret === base.length + 2,
      nextAnswer: sources(next), kept: view.state.doc.toString() === base + 'tuv' };`));
  assert.equal(results.crossingTwo.rolledBack, true, "the crossing snapshot rolled both edits back, as set up");
  assert.deepEqual(results.crossingTwo.answer, ["webviewAck", "webviewAck"], "the host accepted both edits");
  assert.equal(results.crossingTwo.restored, true, "the last acknowledgement restores both edits");
  assert.equal(results.crossingTwo.caretAfterEdits, true, "the caret is after both restored edits");
  assert.deepEqual(results.crossingTwo.nextAnswer, ["webviewAck"], "the next keystroke is accepted after two restored edits");
  assert.equal(results.crossingTwo.kept, true, "all three edits are in the editor");

  // The same while a composition is active. The snapshot waits for the composition to end;
  // the acknowledgement arrives before that and is the newer text, so it is what the editor
  // must hold afterwards. The composition is simulated with its two events: this covers the
  // editor's handling of the state, not a real input method.
  results.crossingComposition = await evaluate(live, liveExpression(`
    const replays = () => (win.__MLRT_DEBUG_EVENTS__ || [])
      .filter(entry => entry.event === 'reapply-host-document-after-canceled-composition').length;
    const compose = name => view.contentDOM.dispatchEvent(new win.CompositionEvent(name, { bubbles: true }));
    const base = view.state.doc.toString();
    const from = log.length, replaysBefore = replays();
    type('w');
    compose('compositionstart');
    snapshot(base);
    const heldBack = view.state.doc.toString() === base + 'w';
    await waitFor(() => answers(from).length > 0);
    compose('compositionend');
    const replayed = await waitFor(() => replays() > replaysBefore);
    const afterComposition = view.state.doc.toString();
    const next = log.length;
    type('x');
    await waitFor(() => answers(next).length > 0);
    return { heldBack, answer: sources(from).slice(0, 1), replayed,
      restored: afterComposition === base + 'w',
      nextAnswer: sources(next), kept: view.state.doc.toString() === base + 'wx' };`));
  assert.equal(results.crossingComposition.heldBack, true, "the snapshot waits while the composition is active, as set up");
  assert.deepEqual(results.crossingComposition.answer, ["webviewAck"], "the host accepted the edit sent before the composition");
  assert.equal(results.crossingComposition.replayed, true, "the waiting text was applied when the composition ended");
  assert.equal(results.crossingComposition.restored, true, "after the composition the editor holds the acknowledged text");
  assert.deepEqual(results.crossingComposition.nextAnswer, ["webviewAck"], "the next keystroke after the composition is accepted");
  assert.equal(results.crossingComposition.kept, true, "both edits around the composition are in the editor");

  // 3. Typing through repeated saves loses nothing and is never rejected.
  await evaluate(live, liveExpression("win.__MLRT_SAVE_SYNC_DONE__ = false; return true;"));
  let finished = false;
  const typing = evaluate(live, liveExpression(`
    const from = log.length, base = view.state.doc.toString();
    let expected = base;
    for (let index = 0; index < ${edits}; index++) { type('<' + index + '>'); expected += '<' + index + '>'; await sleep(6); }
    await waitFor(() => answers(from).length >= ${edits});
    await sleep(300);
    win.__MLRT_SAVE_SYNC_DONE__ = true;
    const entries = log.slice(from), text = view.state.doc.toString();
    return { acknowledged: entries.filter(entry => entry.source === 'webviewAck').length,
      rejected: entries.filter(entry => entry.source === 'webviewReject').length,
      snapshots: entries.filter(entry => entry.source === 'host').length,
      everyEditKept: text === expected, hostHasEveryEdit: entries.at(-1)?.text === expected, text };`))
    .finally(() => { finished = true; });
  // A save counts when the file on disk grew by it. The edits only append, so each save that
  // lands while typing leaves a longer file that starts with the one before.
  let saves = 0, savesOnDisk = 0, lastOnDisk = await onDisk();
  await sleep(120);
  while (!finished && !(await evaluate(live, liveExpression("return win.__MLRT_SAVE_SYNC_DONE__;")))) {
    await save(); saves++;
    await sleep(90);
    const disk = await onDisk().catch(() => lastOnDisk);
    if (disk.length > lastOnDisk.length && disk.startsWith(lastOnDisk)) { savesOnDisk++; lastOnDisk = disk; }
  }
  const { text, ...typingResult } = await typing;
  results.typing = { edits, saves, savesOnDisk, ...typingResult };
  assert.ok(savesOnDisk >= 10, `saves reached the disk while typing (${savesOnDisk} of ${saves} sent)`);
  assert.equal(results.typing.rejected, 0, "no edit is rejected while saves happen");
  assert.equal(results.typing.acknowledged, edits, "every edit is acknowledged");
  assert.equal(results.typing.snapshots, 0, "saves send no document snapshots while typing");
  assert.equal(results.typing.everyEditKept, true, "the editor holds every edit in order");
  assert.equal(results.typing.hostHasEveryEdit, true, "the host document holds every edit in order");
  await save();
  await until(async () => (await onDisk()) === text, "the final save reached the disk");

  // 4. The crossing snapshot with the caret in a table cell. The cell gets its text back with
  // the acknowledgement, and the caret is after it at once. The state is read in the same task
  // as the answer, a key is pressed right there, and the cell is read again on each of the
  // next four frames: nothing that was waiting for a render may move the caret back.
  results.crossingCell = await evaluate(live, liveExpression(`
    const cell = () => win.document.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="0"][data-column="0"]');
    const caretIn = element => { const selection = win.getSelection();
      if (!element || !selection.rangeCount || !element.contains(selection.focusNode)) return null;
      const range = win.document.createRange(); range.selectNodeContents(element);
      range.setEnd(selection.focusNode, selection.focusOffset); return range.toString().length; };
    const insert = text => win.document.execCommand('insertText', false, text);
    const first = cell();
    if (!first) return { found: false };
    first.focus();
    const end = win.document.createRange(); end.selectNodeContents(first); end.collapse(false);
    win.getSelection().removeAllRanges(); win.getSelection().addRange(end);
    await sleep(300);
    const settle = log.length;
    insert('x');
    await waitFor(() => answers(settle).length > 0);
    await sleep(200);
    const base = view.state.doc.toString(), before = cell().textContent;
    const from = log.length;
    const read = () => { const active = win.document.activeElement;
      return { inCell: active === cell(), text: active ? active.textContent : null, caret: caretIn(active) }; };
    const state = text => ({ inCell: true, text, caret: text.length });
    let atAnswer = null, next = -1, watched = false;
    const frames = [];
    const watch = left => win.requestAnimationFrame(() => {
      frames.push(read()); if (left > 1) watch(left - 1); else watched = true; });
    const onAnswer = event => { if (atAnswer || !event.data || event.data.source !== 'webviewAck') return;
      atAnswer = read();
      next = log.length;
      insert('z');
      watch(4); };
    win.addEventListener('message', onAnswer);
    insert('y');
    const typed = view.state.doc.toString() !== base;
    snapshot(base);
    const rolledBack = view.state.doc.toString() === base && cell().textContent === before;
    await waitFor(() => watched && answers(next).length > 0);
    win.removeEventListener('message', onAnswer);
    return { found: true, typed, rolledBack, answer: sources(from).slice(0, 1),
      atAnswer, expectedAtAnswer: state(before + 'y'),
      frames, expectedFrames: [1, 2, 3, 4].map(() => state(before + 'yz')),
      nextAnswer: next < 0 ? [] : sources(next) };`));
  assert.equal(results.crossingCell.found, true, "the table cell is rendered");
  assert.equal(results.crossingCell.typed, true, "the cell edit reached the document with the key");
  assert.equal(results.crossingCell.rolledBack, true, "the crossing snapshot rolled the cell edit back, as set up");
  assert.deepEqual(results.crossingCell.answer, ["webviewAck"], "the host accepted the cell edit");
  assert.deepEqual(results.crossingCell.atAnswer, results.crossingCell.expectedAtAnswer, "the cell holds the edit and the caret is after it as soon as the answer is in");
  assert.deepEqual(results.crossingCell.frames, results.crossingCell.expectedFrames, "a key pressed at the answer lands after the restored text, and the caret stays after it");
  assert.deepEqual(results.crossingCell.nextAnswer, ["webviewAck"], "the next key in the cell is accepted");
  results.warnings =await evaluate(wb, `[...document.querySelectorAll('.notification-list-item-message')].map(node => node.textContent)`);
  assert.deepEqual(results.warnings.filter(message => /conflicting/.test(message)), [], "no conflict warning was shown");

  await writeFile(path.join(qa, "save-sync-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  console.log(`Save and typing checks passed${crlf ? " (CRLF)" : ""}: no snapshot for a save, an acknowledgement restores a rolled-back edit (also two edits, during a composition, and in a table cell), ${edits} edits kept through ${savesOnDisk} saves.`);
} catch (error) {
  console.log(JSON.stringify(results));
  throw error;
} finally {
  if (wb) void evaluate(wb, "window.close()").catch(() => {});
  for (const ws of sockets) ws.close();
  child.kill();
}
