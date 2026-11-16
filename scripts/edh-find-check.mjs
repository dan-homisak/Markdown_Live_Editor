// Verify find, replace and multiple cursors in a real, isolated VS Code window:
//  - the keys open the widget, seeded from the word at the caret, from prose and from a cell,
//  - matches are counted and visited in document order through prose and table cells,
//  - a match inside hidden syntax or a folded callout is revealed when it becomes current,
//  - a match in a table that is off screen is scrolled into view,
//  - typing a query keeps the focus in the find box and moves to the first match,
//  - the options, an invalid pattern, Undo inside the find box, and Escape,
//  - replace one in prose and in a cell, and replace all across prose and tables as one
//    Undo step, with no table edit refused and no conflict reported,
//  - nothing is replaced in a read-only document, and finding never edits the document,
//  - cursors added above and below type, delete and move together, and one Undo takes back
//    what they typed; no cursor lands in table source,
//  - the occurrence commands select the next and every occurrence in prose and report the
//    ones in table cells; copy and paste with several selections; cursors and a column
//    selection made with the mouse.
// Every section runs; the failures of all of them are reported together.
//
// --theme=<name> runs under that color theme, for the screenshots.
// --crlf writes the document with CRLF line endings, which the host maps edits back to.
// --measure adds timings on generated documents of 10,000 and 100,000 lines: how long a
// search takes, and what an open widget adds to each keystroke typed into the document.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";
import { edhLaunchFlags, edhSettings, resolveEdhExecutable } from "./edh-isolation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-find-"));
const qa = path.join(repo, "qa");
const port = 9700 + Math.floor(Math.random() * 100);
const theme = process.argv.find(argument => argument.startsWith("--theme="))?.slice("--theme=".length);
const measure = process.argv.includes("--measure");
const crlf = process.argv.includes("--crlf");
await mkdir(path.join(profile, "User"), { recursive: true });
await mkdir(qa, { recursive: true });
const settings = { ...edhSettings,
  "workbench.startupEditor": "none", "window.restoreWindows": "none",
  "security.workspace.trust.enabled": false, "editor.wordWrap": "on", "files.autoSave": "off",
  ...(theme ? { "workbench.colorTheme": theme } : {}),
};
await writeFile(path.join(profile, "User/settings.json"), JSON.stringify(settings));
const file = path.join(profile, "FindCheck.md");
const filler = Array.from({ length: 60 }, (_, index) => `Filler line ${index + 1} of plain text.`);
const source = [
  "# Find check",
  "",
  "Alpha tracker one. The Tracker again, and tracker.",
  "A [link text](https://example.com/tracker-page) and **bold tracker** here.",
  "",
  "| Name | Notes |",
  "| --- | --- |",
  "| tracker | the tracker cell |",
  "| other | **bold tracker** in a cell |",
  "",
  "Final tracker line.",
  "",
  "> [!NOTE]- Folded",
  "> hidden tracker inside",
  "",
  ...filler,
  "",
  "| Far | Table |",
  "| --- | --- |",
  "| x | far tracker cell |",
  "",
  "Last tracker line.",
  "",
].join("\n");
const TOTAL = 12;
await writeFile(file, crlf ? source.replace(/\n/g, "\r\n") : source);
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
// `body` runs inside the live editor's frame.
const liveExpression = body => `(async () => {
  const roots = [window, ...Array.from(document.querySelectorAll('iframe')).flatMap(f => {
    try { return f.contentWindow ? [f.contentWindow] : []; } catch { return []; }
  })];
  const win = roots.find(w => { try { return w.__MLRT_EDITOR_VIEW__; } catch { return false; } });
  if (!win) return null;
  const view = win.__MLRT_EDITOR_VIEW__, doc = win.document;
  const frames = (count = 2) => new Promise(done => {
    const step = left => left <= 0 ? done() : win.requestAnimationFrame(() => step(left - 1));
    step(count);
  });
  const text = () => view.state.doc.toString();
  const widget = () => doc.querySelector('.mlrt-find-widget');
  const fields = () => [...doc.querySelectorAll('.mlrt-find-field')];
  const bodyCell = (row, column, table = 0) => [...doc.querySelectorAll('.mlrt-table-widget')][table]
    ?.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="' + row + '"][data-column="' + column + '"]');
  const highlights = prefix => { const out = [];
    for (const [name, highlight] of win.CSS.highlights) if (name.startsWith(prefix) && (prefix !== 'mlrt-find-' || !name.startsWith('mlrt-find-current'))) out.push(...[...highlight].map(range => range.toString()));
    return out; };
  const cellSelection = () => { const cell = doc.activeElement?.closest?.('.mlrt-table-cell'); const s = win.getSelection();
    return cell ? { row: cell.dataset.rowIndex, column: cell.dataset.column, kind: cell.dataset.rowKind, selected: s.toString(), value: cell.innerText } : null; };
  const state = () => { const main = view.state.selection.main, active = doc.activeElement;
    return { open: !widget().hidden, replaceOpen: !doc.querySelector('.mlrt-find-replace-row').hidden,
      query: fields()[0].value, replacement: fields()[1].value, count: doc.querySelector('.mlrt-find-count').textContent,
      empty: doc.querySelector('.mlrt-find-count').classList.contains('mlrt-find-count-empty'),
      invalid: doc.querySelector('.mlrt-find-box').classList.contains('mlrt-find-box-invalid'),
      invalidTitle: doc.querySelector('.mlrt-find-count').title,
      focus: active === fields()[0] ? 'find' : active === fields()[1] ? 'replace' : active?.closest?.('.mlrt-table-cell') ? 'cell' : view.hasFocus ? 'editor' : 'other',
      selected: view.state.sliceDoc(main.from, main.to), from: main.from, to: main.to,
      marks: [...doc.querySelectorAll('.cm-content .mlrt-find-match')].length,
      currentMark: [...doc.querySelectorAll('.cm-content .mlrt-find-current')].map(mark => mark.textContent).join(''),
      cellMatches: highlights('mlrt-find-'), cellCurrent: highlights('mlrt-find-current'),
      cell: cellSelection(), shown: view.contentDOM.innerText,
      ranges: view.state.selection.ranges.map(range => [range.from, range.to]),
      rangeTexts: view.state.selection.ranges.map(range => view.state.sliceDoc(range.from, range.to)),
      heads: view.state.selection.ranges.map(range => view.state.doc.lineAt(range.head).text),
      cursors: doc.querySelectorAll('.cm-cursorLayer .cm-cursor').length,
      pressed: [...doc.querySelectorAll('.mlrt-find-option')].map(option => option.getAttribute('aria-pressed')),
      replaceDisabled: doc.querySelector('.mlrt-find-replace-all').disabled,
      status: doc.querySelector('.mlrt-clipboard-status')?.textContent ?? '' }; };
  ${body}
})()`;

const results = {};
const failures = [];
// Set once the editor is reachable: puts the document back after a section, so a section
// that failed halfway cannot fail the ones after it.
let restoreDocument = async () => {};
async function section(name, run) {
  try { await run(); console.log(`ok   ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
  try { await restoreDocument(); }
  catch (error) { failures.push(`${name}: the document was not restored: ${error.message}`); console.log(`FAIL ${name}: the document was not restored`); }
}
const CTRL = 2, SHIFT = 8, ALT = 1;
let wb;
try {
  const target = await until(async () => (await targets().catch(() => [])).find(t => /workbench\.html/.test(t.url)), "workbench");
  wb = await connect(target);
  await until(() => evaluate(wb, "!!document.querySelector('.monaco-editor .view-lines .view-line')"), "source editor");
  await sleep(2200);
  await evaluate(wb, `(() => { const dialog = document.querySelector('.monaco-dialog-box .monaco-button'); dialog?.click(); })()`);
  const press = async (client, key, code, vk, modifiers = 0) => {
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const screenshot = async name => {
    const shot = await wb.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(qa, name), Buffer.from(shot.result.data, "base64"));
  };
  const dirty = () => evaluate(wb, `!!document.querySelector('.tabs-container .tab.active.dirty')`);

  // The stock editor's own widget, with the same query, to compare the two by eye.
  await evaluate(wb, `document.querySelector('.monaco-editor textarea, .monaco-editor .native-edit-context')?.focus()`);
  await press(wb, "f", "KeyF", 70, CTRL);
  await sleep(400);
  await wb.send("Input.insertText", { text: "tracker" });
  await sleep(500);
  await screenshot("edh-find-stock.png");
  await press(wb, "Escape", "Escape", 27);
  await sleep(200);

  for (const type of ["keyDown", "keyUp"]) {
    await wb.send("Input.dispatchKeyEvent", { type, key: "m", code: "KeyM", windowsVirtualKeyCode: 77, modifiers: process.platform === "darwin" ? 6 : 3 });
  }
  const clients = new Map();
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
  const run = body => evaluate(live, liveExpression(body));
  const key = (name, code, vk, modifiers = 0) => press(live, name, code, vk, modifiers);
  const enter = (modifiers = 0) => key("Enter", "Enter", 13, modifiers);
  const escape = () => key("Escape", "Escape", 27);
  const read = async (wait = 3) => run(`await frames(${wait}); return state();`);
  const typeInto = async (field, value) => {
    await run(`fields()[${field}].focus(); fields()[${field}].select(); return true;`);
    if (value.length === 0) await key("Delete", "Delete", 46);
    else await live.send("Input.insertText", { text: value });
    await sleep(120);
  };
  const caretAt = needle => run(`view.focus(); view.dispatch({ selection: { anchor: text().indexOf(${JSON.stringify(needle)}) }, scrollIntoView: true }); await frames(2); return true;`);
  const closeWidget = async () => { if ((await read(1)).open) { await run(`fields()[0].focus(); return true;`); await escape(); await sleep(80); } };
  const original = await run(`return text();`);
  assert.equal(original, source, "the live editor shows the document as written");

  await section("Ctrl+F opens find with the word at the caret", async () => {
    await caretAt("tracker one");
    await key("f", "KeyF", 70, CTRL);
    const opened = await read(4);
    await screenshot("edh-find-live.png");
    results.opened = opened;
    assert.equal(opened.open, true, "the widget is shown");
    assert.equal(opened.focus, "find", "the find box has the focus");
    assert.equal(opened.query, "tracker", "the word at the caret is the query");
    assert.equal(opened.count, `? of ${TOTAL}`, "every match is counted, and the caret is on none yet");
    assert.ok(opened.marks >= 5, "matches in prose are highlighted");
    assert.deepEqual(opened.cellMatches, ["tracker", "tracker", "tracker"], "matches in the mounted table cells are highlighted");
    assert.equal(opened.replaceOpen, false, "the replace row stays closed");
    assert.equal(await run(`return text();`), source, "opening find does not edit the document");
  });

  await section("Enter visits prose and cells in document order", async () => {
    const steps = [];
    for (let index = 0; index < TOTAL + 1; index++) { await enter(); steps.push(await read(index === 10 ? 8 : 4)); }
    steps.push((await (async () => { await enter(SHIFT); return read(4); })()));
    results.steps = steps.map(step => ({ count: step.count, selected: step.selected, currentMark: step.currentMark, cellCurrent: step.cellCurrent, focus: step.focus }));
    assert.deepEqual(steps.slice(0, TOTAL).map(step => step.count), Array.from({ length: TOTAL }, (_, index) => `${index + 1} of ${TOTAL}`),
      "each Enter makes the next match current, through prose and cells");
    assert.ok(steps.every(step => step.focus === "find"), "the focus stays in the find box");
    assert.deepEqual([0, 1, 2].map(index => steps[index].selected), ["tracker", "Tracker", "tracker"], "prose matches become the selection");
    assert.equal(steps[0].currentMark, "tracker", "the current match is marked");
    assert.ok(!steps[2].shown.includes("tracker-page"), "a link address is hidden at rest");
    assert.ok(steps[3].shown.includes("https://example.com/tracker-page"), "a match in a hidden link address reveals the link");
    assert.equal(steps[3].selected, "tracker");
    for (const index of [5, 6, 7, 10]) {
      assert.deepEqual(steps[index].cellCurrent, ["tracker"], `match ${index + 1} is current inside its cell`);
      assert.equal(steps[index].selected, "", "a cell match leaves no prose selection behind");
      assert.equal(steps[index].currentMark, "", "and no prose match stays marked current");
    }
    assert.equal(steps[9].selected, "tracker", "the match in the folded callout is selected");
    assert.ok(steps[9].shown.includes("hidden tracker inside"), "and the folded text is shown");
    assert.equal(steps[11].selected, "tracker");
    assert.equal(steps[TOTAL].count, `1 of ${TOTAL}`, "after the last match Enter wraps to the first");
    assert.equal(steps[TOTAL + 1].count, `${TOTAL} of ${TOTAL}`, "Shift+Enter goes back, wrapping to the last");
    await screenshot("edh-find-last-match.png");
  });

  await section("a match in a table that was off screen is brought into view", async () => {
    await closeWidget();
    await caretAt("tracker one");
    await key("f", "KeyF", 70, CTRL);
    for (let index = 0; index < 11; index++) { await enter(); await sleep(30); }
    const far = await run(`await frames(10);
      // Tables that scrolled away are unmounted, so the cell is found by what it says.
      const cell = [...doc.querySelectorAll('.mlrt-table-cell')].find(candidate => candidate.innerText.trim() === 'far tracker cell');
      const box = cell?.getBoundingClientRect(), scroller = view.scrollDOM.getBoundingClientRect();
      return { state: state(), mounted: !!cell, top: box?.top, bottom: box?.bottom, viewTop: scroller.top, viewBottom: scroller.bottom };`);
    await screenshot("edh-find-far-cell.png");
    results.far = { count: far.state.count, cellCurrent: far.state.cellCurrent, mounted: far.mounted, top: far.top, viewTop: far.viewTop, viewBottom: far.viewBottom };
    assert.equal(far.state.count, `11 of ${TOTAL}`);
    assert.equal(far.mounted, true, "the far table is mounted");
    assert.ok(far.top >= far.viewTop && far.bottom <= far.viewBottom, "its cell is inside the viewport");
    assert.deepEqual(far.state.cellCurrent, ["tracker"], "and its match is painted current");
  });

  await section("Escape gives the focus to the current match", async () => {
    await escape();
    const inCell = await read(4);
    results.escapeCell = { open: inCell.open, focus: inCell.focus, cell: inCell.cell };
    assert.equal(inCell.open, false, "Escape closes the widget");
    assert.equal(inCell.focus, "cell", "a current match in a cell takes the caret into the cell");
    assert.equal(inCell.cell.selected, "tracker", "with the match selected");
    assert.equal(inCell.cell.value.trim(), "far tracker cell", "in the cell's own text");
    await caretAt("tracker one");
    await key("f", "KeyF", 70, CTRL);
    await enter();
    await escape();
    const inProse = await read(4);
    assert.equal(inProse.open, false);
    assert.equal(inProse.focus, "editor", "a current match in prose gives the focus back to the editor");
    assert.equal(inProse.selected, "tracker", "with the match selected");
    await key("f", "KeyF", 70, CTRL);
    await run(`view.focus(); return true;`);
    await escape();
    assert.equal((await read(3)).open, false, "Escape in the text closes the widget too");
  });

  await section("typing a query keeps the focus and moves to the first match", async () => {
    await caretAt("# Find check");
    await key("f", "KeyF", 70, CTRL);
    await run(`fields()[0].select(); return true;`);
    const seen = [];
    for (const letter of "final") {
      await live.send("Input.insertText", { text: letter });
      seen.push(await read(3));
    }
    results.typing = seen.map(step => ({ query: step.query, count: step.count, focus: step.focus, selected: step.selected }));
    assert.deepEqual(seen.map(step => step.query), ["f", "fi", "fin", "fina", "final"]);
    assert.ok(seen.every(step => step.focus === "find"), "the find box keeps the focus while a query is typed");
    assert.equal(seen[4].count, "1 of 1");
    assert.equal(seen[4].selected, "Final", "the first match from the caret is selected, whatever its case");
    assert.match(seen[0].count, /^1 of \d+$/, "every keystroke moves to a match");
  });

  await section("match case, whole word, regular expressions and a bad pattern", async () => {
    await typeInto(0, "tracker");
    await key("c", "KeyC", 67, ALT);
    const matchCase = await read();
    await key("c", "KeyC", 67, ALT);
    await typeInto(0, "track");
    const partial = await read();
    await key("w", "KeyW", 87, ALT);
    const wholeWord = await read();
    await key("w", "KeyW", 87, ALT);
    await typeInto(0, "tr\\w+r\\b");
    const literal = await read();
    await key("r", "KeyR", 82, ALT);
    const regex = await read();
    await typeInto(0, "(tracker");
    const invalid = await read();
    await key("r", "KeyR", 82, ALT);
    const asText = await read();
    results.options = { matchCase: matchCase.count, partial: partial.count, wholeWord: wholeWord.count, literal: literal.count, regex: regex.count, invalid: invalid.count, invalidTitle: invalid.invalidTitle, asText: asText.count };
    assert.match(matchCase.count, new RegExp(` of ${TOTAL - 1}$`), "Match Case leaves out the capitalized word");
    assert.deepEqual(matchCase.pressed, ["true", "false", "false"]);
    assert.match(partial.count, new RegExp(` of ${TOTAL}$`));
    assert.equal(wholeWord.count, "No results", "Whole Word finds no part of a word");
    assert.equal(wholeWord.empty, true, "and says so in the error color");
    assert.equal(literal.count, "No results", "a pattern typed as text is searched as text");
    assert.match(regex.count, new RegExp(` of ${TOTAL}$`), "the same text as a regular expression matches");
    assert.equal(invalid.count, "No results");
    assert.equal(invalid.invalid, true, "a bad pattern marks the find box");
    assert.ok(invalid.invalidTitle.length > 0, "and explains itself");
    assert.equal(asText.count, "No results");
    assert.equal(asText.invalid, false, "the same text is a valid literal query");
    assert.deepEqual(asText.pressed, ["false", "false", "false"]);
  });

  const waitForText = (expected, description) => until(async () => (await run(`return text();`)) === expected, description, 8000);
  const undo = async () => { await run(`view.focus(); return true;`); await key("z", "KeyZ", 90, CTRL); };
  restoreDocument = async () => {
    for (let index = 0; index < 8 && (await run(`return text();`)) !== source; index++) { await undo(); await sleep(400); }
    assert.equal(await run(`return text();`), source);
  };

  await section("Undo in the find box never reaches the document", async () => {
    assert.equal(await dirty(), false, "finding never marks the document edited");
    // Text typed into the document first: the browser keeps one history for the whole
    // page, and the find box must not be a way to reach into it.
    await closeWidget();
    await caretAt("Final tracker line.");
    await live.send("Input.insertText", { text: "typed " });
    const withTyping = source.replace("Final tracker line.", "typed Final tracker line.");
    await waitForText(withTyping, "text typed into the document");
    await key("f", "KeyF", 70, CTRL);
    await run(`fields()[0].select(); return true;`);
    for (const letter of "abc") { await live.send("Input.insertText", { text: letter }); await sleep(60); }
    const typed = await read(2);
    // A raw key press does not run the browser's own editing command, which a real key
    // press does unless a handler cancels it. These presses carry the command.
    const editKey = async (name, code, vk, command) => {
      await live.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code, windowsVirtualKeyCode: vk, modifiers: CTRL, commands: [command] });
      await live.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: vk, modifiers: CTRL });
    };
    await editKey("z", "KeyZ", 90, "undo");
    const undone = await read(2);
    await editKey("y", "KeyY", 89, "redo");
    const redone = await read(2);
    for (let index = 0; index < 8; index++) { await editKey("z", "KeyZ", 90, "undo"); await sleep(50); }
    await sleep(500);
    const afterMany = await read(2);
    results.undoInBox = { typed: typed.query, undone: undone.query, redone: redone.query, afterMany: afterMany.query };
    assert.equal(typed.query, "abc");
    assert.equal(undone.query, "ab", "Undo in the find box takes back the last thing typed there");
    assert.equal(redone.query, "abc", "and Redo brings it back");
    assert.equal(await run(`return text();`), withTyping, "however often Undo is pressed there, the document keeps what was typed into it");
    assert.equal(afterMany.focus, "find");
    await closeWidget();
    await undo();
    await waitForText(source, "Undo in the document, of the text typed into it");
  });

  await section("a key press that belongs to a composition does nothing in the widget", async () => {
    await caretAt("# Find check");
    await key("h", "KeyH", 72, CTRL);
    await typeInto(0, "Alpha");
    await typeInto(1, "Beta");
    const current = await read(3);
    // The Enter that confirms an input method's candidate arrives as a key press too.
    await run(`fields()[1].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true })); await frames(3); return true;`);
    await sleep(300);
    assert.equal(current.count, "1 of 1", "the match is current, so a real Enter would replace it");
    assert.equal(await run(`return text();`), source, "the composing Enter replaced nothing");
    await closeWidget();
  });

  await section("find opened from a table cell starts from that cell", async () => {
    await closeWidget();
    const opened = await run(`const cell = bodyCell(0, 1, 0); cell.focus(); await frames(2);
      const node = [...cell.childNodes].find(child => child.nodeType === 3), at = node.data.indexOf('tracker') + 2;
      win.getSelection().setBaseAndExtent(node, at, node, at); await frames(2); return state().focus;`);
    assert.equal(opened, "cell");
    await key("f", "KeyF", 70, CTRL);
    const seeded = await read(4);
    await enter();
    const next = await read(4);
    results.fromCell = { query: seeded.query, focus: seeded.focus, first: next.count };
    assert.equal(seeded.query, "tracker", "the word at the cell's caret is the query");
    assert.equal(seeded.focus, "find");
    assert.equal(next.count, `8 of ${TOTAL}`, "the next match is the one after the caret's cell");
    // With the widget closed, F3 and Shift+F3 carry the caret itself from match to match.
    await run(`fields()[0].focus(); return true;`);
    await escape();
    const closedOnCell = await read(4);
    await key("F3", "F3", 114);
    const onward = await read(5);
    await key("F3", "F3", 114, SHIFT);
    const back = await read(6);
    results.fromCell.f3 = { closed: closedOnCell.focus, onward: onward.focus, back: back.focus };
    assert.equal(closedOnCell.focus, "cell", "Escape leaves the caret in the cell of the current match");
    assert.equal(onward.focus, "editor", "F3 in a cell goes on to the next match, here in the text");
    assert.equal(onward.from, source.indexOf("Final tracker") + 6);
    assert.equal(back.focus, "cell", "Shift+F3 goes back into the cell");
    assert.equal(back.cell.selected, "tracker", "with its match selected");
    assert.equal(await run(`return text();`), source, "leaving the cell wrote nothing");
  });

  await section("the Replace command opens the replace row", async () => {
    await closeWidget();
    await run(`view.focus(); win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'findCommand', action: 'replace' } })); await frames(3); return true;`);
    const opened = await read();
    assert.equal(opened.open, true);
    assert.equal(opened.replaceOpen, true, "the replace row is shown");
    await closeWidget();
    await key("h", "KeyH", 72, CTRL);
    assert.equal((await read(3)).replaceOpen, true, "Ctrl+H shows it too");
  });

  await section("the widget's buttons work by mouse", async () => {
    await caretAt("tracker one");
    await key("f", "KeyF", 70, CTRL);
    const click = async selector => {
      const point = await run(`const box = doc.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 };`);
      await live.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
      await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
      return read(3);
    };
    const next = await click(".mlrt-find-next");
    const again = await click(".mlrt-find-next");
    const previous = await click(".mlrt-find-previous");
    const option = await click(".mlrt-find-option");
    const before = await click(".mlrt-find-option");
    const toggled = await click(".mlrt-find-toggle");
    const closed = await click(".mlrt-find-close");
    results.buttons = { next: next.count, again: again.count, previous: previous.count, focus: again.focus };
    assert.deepEqual([next.count, again.count, previous.count], [`1 of ${TOTAL}`, `2 of ${TOTAL}`, `1 of ${TOTAL}`], "Next and Previous move the current match");
    assert.equal(again.focus, "find", "a click on a button leaves the caret in the find box");
    assert.equal(option.pressed[0], "true", "an option button toggles its option");
    assert.equal(toggled.replaceOpen, !before.replaceOpen, "the chevron shows or hides the replace row");
    assert.equal(closed.open, false, "the close button closes the widget");
    assert.equal(await run(`return text();`), source);
  });

  await section("replace one in prose, undone by one Undo", async () => {
    await caretAt("# Find check");
    await key("h", "KeyH", 72, CTRL);
    await typeInto(0, "Alpha");
    await typeInto(1, "Beta");
    await enter();
    await sleep(250);
    const replaced = await read();
    results.replaceProse = { count: replaced.count, status: replaced.status };
    await waitForText(source.replace("Alpha", "Beta"), "the prose replacement");
    assert.equal(replaced.count, "No results", "nothing is left to find");
    assert.equal(await dirty(), true, "a replacement edits the document");
    await undo();
    await waitForText(source, "Undo of the prose replacement");
  });

  await section("replace one in a table cell", async () => {
    await caretAt("# Find check");
    await key("h", "KeyH", 72, CTRL);
    await typeInto(0, "other");
    await typeInto(1, "an|other");
    const found = await read();
    await enter();
    await sleep(250);
    const expected = source.replace("| other |", "| an&#124;other |");
    await waitForText(expected, "the cell replacement");
    const after = await read();
    results.replaceCell = { before: found.count, after: after.count, status: after.status };
    assert.equal(found.count, "1 of 1", "the match in the cell is current");
    assert.equal(after.status.includes("Table refreshed"), false, "the table guard accepted the edit");
    assert.equal(await run(`return bodyCell(1, 0, 0).innerText.trim();`), "an|other", "the cell shows the new text, pipe included");
    await undo();
    await waitForText(source, "Undo of the cell replacement");
  });

  await section("replace all across prose and tables is one Undo step", async () => {
    await caretAt("# Find check");
    await key("h", "KeyH", 72, CTRL);
    await typeInto(0, "tracker");
    await typeInto(1, "T|X");
    assert.match((await read()).count, new RegExp(` of ${TOTAL}$`));
    await enter(CTRL | ALT);
    const expected = source.split("\n").map(line => line.replace(/tracker/gi, line.startsWith("|") ? "T&#124;X" : "T|X")).join("\n");
    await waitForText(expected, "replace all");
    const after = await read(4);
    await screenshot("edh-find-replace-all.png");
    results.replaceAll = { count: after.count, status: after.status, tables: await run(`return doc.querySelectorAll('.mlrt-table-widget').length;`) };
    assert.equal(after.count, "No results");
    assert.equal(after.status.includes("Table refreshed"), false, "no table edit was refused");
    assert.match(after.status, /Replaced 12 occurrences/, "the count is announced");
    assert.equal(await run(`return bodyCell(0, 0, 0).innerText.trim();`), "T|X", "cells show the replacement");
    await sleep(500);
    assert.equal(await run(`return text();`), expected, "the host kept the edit");
    await undo();
    await waitForText(source, "one Undo restores prose and tables together");
    await sleep(300);
    assert.equal(await run(`return text();`), source);
  });

  const down = (modifiers = 0) => key("ArrowDown", "ArrowDown", 40, modifiers);
  const threeCursors = async () => {
    await closeWidget();
    await caretAt("Filler line 1 of");
    await down(CTRL | ALT);
    await down(CTRL | ALT);
    return read(3);
  };
  const withX = source.replace("Filler line 1 of", "XFiller line 1 of").replace("Filler line 2 of", "XFiller line 2 of").replace("Filler line 3 of", "XFiller line 3 of");

  await section("cursors added below type together, and one Undo takes it back", async () => {
    const three = await threeCursors();
    await live.send("Input.insertText", { text: "X" });
    await waitForText(withX, "typing at three cursors");
    const typed = await read(3);
    await screenshot("edh-find-three-cursors.png");
    results.cursors = { ranges: three.ranges.length, drawn: three.cursors, heads: three.heads, afterTyping: typed.ranges };
    assert.equal(three.ranges.length, 3, "two uses of Add Cursor Below make three cursors");
    assert.equal(three.cursors, 3, "and all three are drawn");
    assert.deepEqual(three.heads, ["Filler line 1 of plain text.", "Filler line 2 of plain text.", "Filler line 3 of plain text."]);
    assert.equal(typed.ranges.length, 3, "the cursors stay after typing");
    await sleep(400);
    await undo();
    await waitForText(source, "one Undo for what three cursors typed");
  });

  await section("several cursors delete, move and collapse together", async () => {
    await threeCursors();
    await live.send("Input.insertText", { text: "X" });
    await waitForText(withX, "typing at three cursors");
    await key("Backspace", "Backspace", 8);
    await waitForText(source, "Backspace at three cursors");
    const before = await read(3);
    await key("ArrowRight", "ArrowRight", 39);
    await key("ArrowRight", "ArrowRight", 39);
    const moved = await read(3);
    await key("End", "End", 35, SHIFT);
    const extended = await read(3);
    await escape();
    const collapsed = await read(3);
    results.cursorKeys = { before: before.ranges, moved: moved.ranges, extended: extended.rangeTexts, collapsed: collapsed.ranges.length };
    assert.deepEqual(moved.ranges.map(range => range[0]), before.ranges.map(range => range[0] + 2), "an arrow key moves every cursor");
    assert.deepEqual(extended.rangeTexts, ["ller line 1 of plain text.", "ller line 2 of plain text.", "ller line 3 of plain text."], "Shift+End extends every cursor");
    assert.equal(collapsed.ranges.length, 1, "Escape returns to one cursor");
    assert.equal(collapsed.open, false);
    await sleep(300);
    await undo(); await sleep(300); await undo();
    await waitForText(source, "the document as it was");
  });

  await section("no cursor lands in table source", async () => {
    await closeWidget();
    await caretAt("A [link text]");
    for (let index = 0; index < 5; index++) { await down(CTRL | ALT); await sleep(60); }
    const cursors = await read(4);
    results.tableGuard = { heads: cursors.heads };
    assert.ok(cursors.heads.every(line => !line.startsWith("|")), "every cursor is on a line of prose");
    assert.equal(cursors.ranges.length, 6, "Add Cursor Below steps over the table: five uses, five more cursors");
    assert.ok(cursors.heads.includes("Final tracker line."), "and carries on below it");
    await live.send("Input.insertText", { text: "Z" });
    await sleep(300);
    const after = await run(`return text();`);
    assert.equal(after.split("Z").length - 1, 6, "the typed letter arrives at every cursor");
    assert.ok(after.includes("\nZA [link text]") && after.includes("\nZFinal tracker line."), "above and below the table");
    assert.ok(after.includes("| Name | Notes |") && after.includes("| tracker | the tracker cell |"), "and the table is as it was");
    await undo();
    await waitForText(source, "Undo of that typing");
    // A caret put into table source among several cursors is taken out again by the guard.
    const guarded = await run(`const Selection = view.state.selection.constructor, inTable = text().indexOf('| tracker | the') + 4, inProse = text().indexOf('Final tracker');
      view.focus(); view.dispatch({ selection: Selection.create([Selection.cursor(inProse), Selection.cursor(inTable)], 1) }); await frames(4);
      return { heads: view.state.selection.ranges.map(range => range.head), inProse };`);
    assert.deepEqual(guarded.heads, [guarded.inProse], "the caret in table source is removed and the other cursor stays");
    await key("ArrowUp", "ArrowUp", 38, CTRL | ALT);
    const above = await read(3);
    assert.equal(above.ranges.length, 2, "Add Cursor Above adds one too");
  });

  await section("Ctrl+D adds the next occurrence", async () => {
    await closeWidget();
    await run(`view.focus(); view.dispatch({ selection: { anchor: text().indexOf('tracker one') + 2 } }); await frames(2); return true;`);
    const steps = [];
    for (let index = 0; index < 3; index++) { await key("d", "KeyD", 68, CTRL); steps.push(await read(3)); }
    results.addNext = steps.map(step => step.rangeTexts);
    assert.deepEqual(steps[0].rangeTexts, ["tracker"], "the first use selects the word at the caret");
    assert.deepEqual(steps[1].rangeTexts, ["tracker", "tracker"], "the second adds the next occurrence of that word");
    assert.equal(steps[1].ranges[1][0], source.indexOf("tracker."), "past the capitalized one");
    assert.equal(steps[2].ranges.length, 3);
    await live.send("Input.insertText", { text: "unit" });
    await sleep(300);
    const typed = await run(`return text();`);
    assert.ok(typed.includes("Alpha unit one. The Tracker again, and unit."), "typing replaces each selected occurrence");
    await sleep(400);
    await undo();
    await waitForText(source, "one Undo for the word typed over three selections");
    await run(`view.focus(); view.dispatch({ selection: { anchor: text().indexOf('tracker one') + 2 } }); await frames(2); return true;`);
    await key("L", "KeyL", 76, CTRL | SHIFT);
    const everyWord = await read(4);
    assert.equal(everyWord.ranges.length, 7, "Ctrl+Shift+L selects every occurrence of the word at the caret in the text, with its case");
    await escape();
    // A cell that is composing text is left alone by F3.
    const composing = await run(`const cell = bodyCell(0, 1, 0); cell.focus(); await frames(2); cell.dataset.composing = 'true'; return state().focus;`);
    await key("F3", "F3", 114);
    const held = await read(4);
    await run(`delete bodyCell(0, 1, 0).dataset.composing; view.focus(); return true;`);
    assert.equal(composing, "cell");
    assert.equal(held.focus, "cell", "F3 does not take the caret out of a cell that is composing text");
  });

  await section("every match becomes a selection, and the ones in cells are reported", async () => {
    await caretAt("tracker one");
    await key("f", "KeyF", 70, CTRL);
    await typeInto(0, "tracker");
    await enter(ALT);
    const all = await read(4);
    await screenshot("edh-find-select-all.png");
    results.selectAll = { ranges: all.ranges.length, focus: all.focus, status: all.status };
    assert.equal(all.ranges.length, 8, "the eight matches in prose are selected");
    assert.equal(all.focus, "editor", "and the editor takes the focus");
    assert.match(all.status, /Selected 8 occurrences\. 4 more are in table cells/, "the four in table cells are reported");
    await live.send("Input.insertText", { text: "Q" });
    await sleep(400);
    const typed = await run(`return text();`);
    assert.equal((typed.match(/tracker/gi) ?? []).length, 4, "typing replaces the eight and leaves the cells");
    assert.ok(typed.includes("| tracker | the tracker cell |"));
    await undo();
    await waitForText(source, "one Undo for eight replacements");
    await closeWidget();
    await run(`view.focus(); view.dispatch({ selection: { anchor: text().indexOf('Filler line 7') + 2 } }); await frames(2); return true;`);
    await key("F2", "F2", 113, CTRL);
    const filler = await read(4);
    assert.equal(filler.ranges.length, 60, "Change All Occurrences selects the word at the caret everywhere");
    await escape();
  });

  await section("copy and paste with several selections", async () => {
    await threeCursors();
    await key("End", "End", 35, SHIFT);
    const copied = await run(`const data = new win.DataTransfer();
      view.contentDOM.dispatchEvent(new win.ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
      return data.getData('text/plain');`);
    await run(`const data = new win.DataTransfer(); data.setData('text/plain', 'first\\nsecond\\nthird');
      view.contentDOM.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frames(2); return true;`);
    await sleep(300);
    const pasted = await run(`return text();`);
    results.multiClipboard = { copied };
    assert.equal(copied, "Filler line 1 of plain text.\nFiller line 2 of plain text.\nFiller line 3 of plain text.", "several selections are copied one to a line");
    assert.ok(pasted.includes("\nfirst\nsecond\nthird\nFiller line 4"), "three pasted lines go one to each selection");
    await undo();
    await waitForText(source, "Undo of the paste");
    await threeCursors();
    await key("End", "End", 35, SHIFT);
    const cut = await run(`const data = new win.DataTransfer();
      view.contentDOM.dispatchEvent(new win.ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true })); await frames(2);
      return { clipboard: data.getData('text/plain'), text: text() };`);
    assert.equal(cut.clipboard, copied, "cut puts the same three lines on the clipboard");
    assert.ok(cut.text.includes("\n\n\n\nFiller line 4"), "and removes them from the document");
    await sleep(300);
    await undo();
    await waitForText(source, "one Undo for the cut");
  });

  await section("the mouse adds a cursor and selects a column", async () => {
    await closeWidget();
    const points = await run(`view.focus(); view.dispatch({ selection: { anchor: text().indexOf('Filler line 5 ') }, scrollIntoView: true }); await frames(3);
      const at = needle => { const box = view.coordsAtPos(text().indexOf(needle)); return { x: box.left + 1, y: (box.top + box.bottom) / 2 }; };
      return { five: at('Filler line 5 '), seven: at('line 7 of'), ten: at('Filler line 10 '), thirteen: at('13 of plain') };`);
    const click = async (point, modifiers) => {
      await live.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1, modifiers });
      await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1, modifiers });
    };
    await click(points.five, 0);
    const one = await read(3);
    await click(points.seven, ALT);
    const two = await read(3);
    await click(points.five, CTRL);
    const afterCtrl = await read(3);
    results.mouse = { one: one.ranges.length, two: two.ranges.length, afterCtrl: afterCtrl.ranges.length };
    assert.equal(one.ranges.length, 1);
    assert.equal(two.ranges.length, 2, "Alt+click adds a cursor");
    assert.equal(afterCtrl.ranges.length, 1, "Ctrl+click adds none: that click belongs to links");
    await live.send("Input.dispatchMouseEvent", { type: "mousePressed", x: points.ten.x, y: points.ten.y, button: "left", buttons: 1, clickCount: 1, modifiers: ALT | SHIFT });
    for (let step = 1; step <= 6; step++) {
      await live.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.ten.x + (points.thirteen.x - points.ten.x) * step / 6, y: points.ten.y + (points.thirteen.y - points.ten.y) * step / 6, button: "left", buttons: 1, modifiers: ALT | SHIFT });
      await sleep(25);
    }
    await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: points.thirteen.x, y: points.thirteen.y, button: "left", buttons: 0, clickCount: 1, modifiers: ALT | SHIFT });
    const column = await read(4);
    await screenshot("edh-find-column-selection.png");
    results.mouse.column = column.rangeTexts;
    assert.equal(column.ranges.length, 4, "Shift+Alt+drag selects a column over four lines");
    assert.ok(column.rangeTexts.every(value => value.length > 0 && value.length === column.rangeTexts[0].length), "the same columns on every line");
    await escape();
    assert.equal(await run(`return text();`), source, "none of this edited the document");
  });

  await section("nothing is replaced in a read-only document", async () => {
    await run(`const options = JSON.parse(JSON.stringify(win.__MLRT_EDITOR_OPTIONS__));
      options.markdownRendering = { ...options.markdownRendering, readOnly: true };
      win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'setEditorOptions', editorOptions: options } })); await frames(3); return true;`);
    await caretAt("# Find check");
    await key("h", "KeyH", 72, CTRL);
    await typeInto(0, "tracker");
    const readOnly = await read();
    await enter(CTRL | ALT);
    await sleep(300);
    results.readOnly = { disabled: readOnly.replaceDisabled, count: readOnly.count };
    assert.equal(readOnly.replaceDisabled, true, "the replace buttons are disabled");
    assert.equal(await run(`return text();`), source, "and the shortcut replaces nothing");
    await run(`win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'setEditorOptions', editorOptions: win.__MLRT_EDITOR_OPTIONS__ } })); await frames(3); return true;`);
    await closeWidget();
  });

  if (measure) {
    // First through the real host: a replace all of one match on each of 10,000 lines, timed
    // from the key press to the host's answer. The host maps every change back to a line
    // and a column, so this is where a cost that grows with the number of changes shows.
    // The lines are added after the document's own, so the tables above are replaced in too.
    const hostLines = Array.from({ length: 10000 }, (_, index) => "Line " + index + " mentions the tracker among other ordinary words.").join("\n");
    const hostDocument = source + hostLines;
    const hostExpected = hostDocument.replace(/tracker/gi, "t");
    const answered = length => until(async () =>
      new RegExp("^" + length + " characters loaded from host revision \\d+ acknowledged$").test(await run(`return doc.documentElement.dataset.mlrtDocumentStatus ?? '';`)),
      "the host's answer", 180000);
    await closeWidget();
    await run(`view.focus(); view.dispatch({ changes: { from: view.state.doc.length, insert: ${JSON.stringify(hostLines)} }, selection: { anchor: 0 } }); await frames(3); return true;`);
    await answered(hostDocument.length);
    await key("h", "KeyH", 72, CTRL);
    await typeInto(0, "tracker");
    await typeInto(1, "t");
    const started = performance.now();
    await enter(CTRL | ALT);
    await answered(hostExpected.length);
    const hostMs = Math.round(performance.now() - started);
    const hostText = await run(`return text();`);
    results.hostReplaceAll = { changes: TOTAL + 10000, characters: hostDocument.length, ms: hostMs, kept: hostText === hostExpected };
    console.log(`measure host replace all: ${JSON.stringify(results.hostReplaceAll)}`);
    assert.equal(hostText, hostExpected, "the host kept a replace all of ten thousand matches");
    await closeWidget();
    await undo();
    await answered(hostDocument.length).catch(() => {});
    await waitForText(hostDocument, "Undo of the large replace all");
    await undo();
    await waitForText(source, "Undo of the added lines");

    // Generated documents never reach the host: the webview is isolated for the measurement.
    results.measurements = [];
    for (const lines of [10000, 100000]) {
      const big = Array.from({ length: lines }, (_, index) => index % 2000 === 1000
        ? "\n| Key | Value |\n| --- | --- |\n| tracker | cell " + index + " |\n"
        : "Line " + index + " mentions the tracker among other ordinary words.").join("\n");
      const measured = await run(`
        win.__MLRT_TEST_SET_HOST_ISOLATION__(true);
        win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'setDocument', text: ${JSON.stringify(big)}, revision: 990000 + ${lines}, debug: false } }));
        await frames(6);
        const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
        const typing = async () => { const samples = [], at = text().indexOf('Line 40 ');
          for (let index = 0; index < 60; index++) { const start = win.performance.now();
            view.dispatch({ changes: { from: at, insert: 'x' }, userEvent: 'input.type' });
            samples.push(win.performance.now() - start); await frames(1); }
          return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95), samples: samples.length }; };
        if (!widget().hidden) { fields()[0].focus(); fields()[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames(2); }
        const closed = await typing();
        view.focus(); view.dispatch({ selection: { anchor: 0 } });
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true }));
        view.contentDOM.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true }));
        await frames(2);
        fields()[0].value = 'tracker';
        const started = win.performance.now();
        fields()[0].dispatchEvent(new win.Event('input', { bubbles: true }));
        const inKeystroke = win.performance.now() - started;
        while (!/ of /.test(doc.querySelector('.mlrt-find-count').textContent) && win.performance.now() - started < 20000) await new Promise(resolve => win.setTimeout(resolve, 4));
        const searched = win.performance.now() - started;
        const label = doc.querySelector('.mlrt-find-count').textContent;
        const open = await typing();
        // A query whose only match is on the last line, so the whole document is searched.
        fields()[0].value = 'Line ' + (${lines} - 1) + ' ';
        const rareStarted = win.performance.now();
        fields()[0].dispatchEvent(new win.Event('input', { bubbles: true }));
        const rareInKeystroke = win.performance.now() - rareStarted;
        while (!/ of 1$/.test(doc.querySelector('.mlrt-find-count').textContent) && win.performance.now() - rareStarted < 20000) await new Promise(resolve => win.setTimeout(resolve, 4));
        const rareSearched = win.performance.now() - rareStarted;
        const rareLabel = doc.querySelector('.mlrt-find-count').textContent;
        fields()[0].focus(); fields()[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames(2);
        return { characters: text().length, label, inKeystrokeMs: inKeystroke, searchedMs: searched,
          wholeDocument: { label: rareLabel, inKeystrokeMs: rareInKeystroke, searchedMs: rareSearched },
          typingClosed: closed, typingOpen: open };`);
      results.measurements.push({ lines, ...measured });
      console.log(`measure ${lines} lines: ${JSON.stringify(measured)}`);
    }
    await run(`win.__MLRT_TEST_SET_HOST_ISOLATION__(false); await frames(6); return true;`);
    await sleep(600);
  }

  results.warnings = await evaluate(wb, `[...document.querySelectorAll('.notification-list-item-message')].map(node => node.textContent)`);
  results.failures = failures;
  await writeFile(path.join(qa, "find-results.json"), JSON.stringify(results, null, 2));
  assert.deepEqual(results.warnings.filter(message => /conflicting|could not apply/.test(message)), [], "no edit warning was shown");
  if (failures.length > 0) {
    throw new Error(`${failures.length} section(s) failed:\n- ${failures.join("\n- ")}`);
  }
  console.log("Find checks passed: opening, order through prose and cells, reveal, far tables, Escape, typing, options, Undo in the box, cells, commands, replace one, replace all, the widget's buttons, composition, several cursors, the table guard, occurrence commands, clipboard, mouse cursors, read-only.");
} finally {
  if (wb) void evaluate(wb, "window.close()").catch(() => {});
  for (const ws of sockets) ws.close();
  child.kill();
}
