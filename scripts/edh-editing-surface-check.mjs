// Verify in a real, isolated VS Code window the parts of the editing surface that
// sit around the text:
//  - the line-number gutter is never selected; a click or drag there selects document text,
//  - a context menu shows no browser focus ring,
//  - the occurrence highlight inside a table cell follows the typed word in every frame,
//  - an occurrence looks the same in a table cell as in prose, border included,
//  - the typing resize delay keeps column widths still while typing,
//  - Automatic paste keeps Markdown and code-editor text as copied, and converts a web
//    page's HTML with `#` headings and tight list markers.
// Every section runs; the failures of all of them are reported together.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";
import { edhLaunchFlags, edhSettings, resolveEdhExecutable } from "./edh-isolation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-surface-"));
const qa = path.join(repo, "qa");
const port = 9600 + Math.floor(Math.random() * 100);
// A strong fill and a border no stock theme has, so both can be told apart in pixels.
const FILL = "#ff3030a0", BORDER = "#30ff30";
await mkdir(path.join(profile, "User"), { recursive: true });
await mkdir(qa, { recursive: true });
const settingsPath = path.join(profile, "User/settings.json");
const settings = { ...edhSettings,
  "workbench.startupEditor": "none", "window.restoreWindows": "none",
  "security.workspace.trust.enabled": false, "editor.wordWrap": "on", "files.autoSave": "off",
  "workbench.colorCustomizations": { "editor.selectionHighlightBackground": FILL, "editor.selectionHighlightBorder": BORDER },
};
await writeFile(settingsPath, JSON.stringify(settings));
const file = path.join(profile, "EditingSurface.md");
const source = [
  "# Editing surface",
  "",
  "The tracker records every tracker event in this paragraph of ordinary text.",
  "Second line of ordinary prose for dragging a selection across lines.",
  "Third line of ordinary prose.",
  "",
  "| Name | Notes |",
  "| --- | --- |",
  "| tracker | the tracker cell |",
  "| other | no match here |",
  "",
  "Final tracker line.",
  "",
  "- [ ] open task item",
  "- [x] checked task item x done",
  "  - [x] nested checked item",
  "",
  "A sentence with x in it.",
  "",
  "PASTE-HERE",
  "",
].join("\n");
await writeFile(file, source);
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
  const sleep = ms => new Promise(resolve => win.setTimeout(resolve, ms));
  const frames = (count = 2) => new Promise(done => {
    const step = left => left <= 0 ? done() : win.requestAnimationFrame(() => step(left - 1));
    step(count);
  });
  const text = () => view.state.doc.toString();
  const lineFrom = start => view.state.doc.lineAt(text().indexOf(start)).from;
  const bodyCell = (row, column) => doc.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="' + row + '"][data-column="' + column + '"]');
  const columnWidths = () => [...doc.querySelectorAll('.mlrt-table-sized-col')].map(col => col.style.width);
  const inGutter = node => !!(node && (node.nodeType === 1 ? node : node.parentElement).closest('.cm-gutters'));
  ${body}
})()`;

const results = {};
const failures = [];
async function section(name, run) {
  try { await run(); console.log(`ok   ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
let wb;
try {
  const target = await until(async () => (await targets().catch(() => [])).find(t => /workbench\.html/.test(t.url)), "workbench");
  wb = await connect(target);
  await until(() => evaluate(wb, "!!document.querySelector('.monaco-editor .view-lines .view-line')"), "source editor");
  await sleep(2200);
  await evaluate(wb, `(() => { const dialog = document.querySelector('.monaco-dialog-box .monaco-button'); dialog?.click(); })()`);
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
  const mouse = (type, x, y, extra = {}) => live.send("Input.dispatchMouseEvent", {
    type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const pressKey = async (key, code, vk, text) => {
    await live.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, ...(text ? { text, unmodifiedText: text } : {}) });
    await live.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  };
  const typeText = async (value, gap = 110) => {
    for (const ch of value) {
      await pressKey(ch, ch === " " ? "Space" : "Key" + ch.toUpperCase(), ch === " " ? 32 : ch.toUpperCase().charCodeAt(0), ch);
      await sleep(gap);
    }
  };
  const screenshot = async name => {
    const shot = await wb.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(qa, name), Buffer.from(shot.result.data, "base64"));
    return shot.result.data;
  };
  await run("view.focus(); return true;");

  // 1. The gutter. Line numbers are never selected; the gesture selects document text from
  // the text edge of the row it starts on.
  await section("gutter selects document text", async () => {
    const gutter = await run(`
      const number = [...doc.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(e => e.textContent === '3').getBoundingClientRect();
      return { x: number.left + number.width / 2, y: number.top + number.height / 2, row: number.height,
        contentLeft: view.contentDOM.getBoundingClientRect().left,
        userSelect: win.getComputedStyle(doc.querySelector('.cm-gutters')).userSelect };`);
    const read = `(() => { const s = win.getSelection(), m = view.state.selection.main;
      return { native: s.toString(), anchorInGutter: inGutter(s.anchorNode), focusInGutter: inGutter(s.focusNode),
        from: m.from, to: m.to, anchor: m.anchor, head: m.head, focused: view.hasFocus,
        line3: lineFrom('The tracker records'), line4: lineFrom('Second line'), line5: lineFrom('Third line') }; })()`;
    await mouse("mousePressed", gutter.x, gutter.y);
    for (let step = 1; step <= 6; step++) { await mouse("mouseMoved", gutter.x + step, gutter.y + step * gutter.row * 2 / 6); await sleep(25); }
    const inGutterDrag = await run(`await frames(2); return ${read};`);
    await screenshot("edh-surface-gutter-drag.png");
    for (let step = 1; step <= 6; step++) { await mouse("mouseMoved", gutter.contentLeft + step * 30, gutter.y + gutter.row * 2); await sleep(25); }
    const intoText = await run(`await frames(2); return ${read};`);
    await mouse("mouseReleased", gutter.contentLeft + 180, gutter.y + gutter.row * 2);
    const released = await run(`await frames(3); return ${read};`);
    await mouse("mousePressed", gutter.x, gutter.y + gutter.row);
    await mouse("mouseReleased", gutter.x, gutter.y + gutter.row);
    const click = await run(`await frames(3); return ${read};`);
    await mouse("mousePressed", gutter.x, gutter.y + gutter.row * 2, { modifiers: 8 });
    await mouse("mouseReleased", gutter.x, gutter.y + gutter.row * 2, { modifiers: 8 });
    const shiftClick = await run(`await frames(3); return ${read};`);
    results.gutter = { userSelect: gutter.userSelect, inGutterDrag, intoText, released, click, shiftClick };
    assert.equal(gutter.userSelect, "none", "line numbers cannot be selected");
    assert.equal(inGutterDrag.anchorInGutter || inGutterDrag.focusInGutter, false, "the browser selection is not in the gutter");
    assert.doesNotMatch(inGutterDrag.native, /^\s*\d+\s*$/m, "no line number is selected");
    assert.deepEqual([inGutterDrag.from, inGutterDrag.to], [inGutterDrag.line3, inGutterDrag.line5],
      "a drag down the gutter selects the rows it passes, from the first row's text edge");
    assert.equal(intoText.from, intoText.line3, "the selection still starts at the first row");
    assert.ok(intoText.to > intoText.line5, "the drag continues into the text");
    assert.deepEqual([released.from, released.to], [intoText.from, intoText.to], "the selection stays after release");
    assert.equal(released.focused, true, "the editor has focus");
    assert.deepEqual([click.from, click.to], [click.line4, click.line4], "a click on a line number puts the caret at that line's start");
    assert.deepEqual([shiftClick.anchor, shiftClick.head], [shiftClick.line4, shiftClick.line5], "Shift+click extends to the clicked line");
  });

  // 2. Context menus. A menu takes focus when it opens; that must not draw the browser's
  // focus ring around it. Whether the browser treats that focus as one to mark depends on
  // what the person did last, so the check puts the menu in that state itself.
  await section("context menus have no focus ring", async () => {
    await live.send("DOM.enable");
    await live.send("CSS.enable");
    const menuState = `(() => { const menu = doc.querySelector('.mlrt-clipboard-menu');
      if (!menu) return null; const style = win.getComputedStyle(menu);
      return { focused: doc.activeElement === menu, focusVisible: menu.matches(':focus-visible'), outline: style.outlineStyle,
        width: style.outlineWidth, color: style.outlineColor }; })()`;
    const markFocusVisible = async () => {
      await live.send("DOM.getDocument", { depth: 0 });
      const menu = await live.send("Runtime.evaluate", { expression: liveExpression("return doc.querySelector('.mlrt-clipboard-menu');"), awaitPromise: true });
      const node = await live.send("DOM.requestNode", { objectId: menu.result?.result?.objectId });
      await live.send("CSS.forcePseudoState", { nodeId: node.result?.nodeId, forcedPseudoClasses: ["focus", "focus-visible"] });
    };
    const rightClick = async point => {
      await live.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "right", buttons: 2, clickCount: 1 });
      await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "right", buttons: 0, clickCount: 1 });
      await sleep(250);
    };
    const selected = await run(`const from = text().indexOf('Second line'); view.focus();
      view.dispatch({ selection: { anchor: from, head: from + 11 } }); await frames(3);
      const at = view.coordsAtPos(from + 4); return { x: at.left, y: (at.top + at.bottom) / 2 };`);
    await rightClick(selected);
    const opened = await run(`return ${menuState};`);
    await markFocusVisible();
    const documentMenu = await run(`await frames(2); return ${menuState};`);
    await screenshot("edh-surface-menu-document.png");
    await pressKey("Escape", "Escape", 27);
    await sleep(150);
    const cellPoint = await run(`const box = bodyCell(1, 1).getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 };`);
    await mouse("mousePressed", cellPoint.x, cellPoint.y);
    await mouse("mouseReleased", cellPoint.x, cellPoint.y);
    await sleep(300);
    await rightClick(cellPoint);
    await markFocusVisible();
    const tableMenu = await run(`await frames(2); return ${menuState};`);
    await screenshot("edh-surface-menu-table.png");
    await pressKey("Escape", "Escape", 27);
    await sleep(200);
    results.menus = { opened, documentMenu, tableMenu };
    assert.ok(opened && documentMenu && tableMenu, "both menus opened");
    assert.equal(opened.focused, true, "the document menu took focus");
    assert.equal(documentMenu.focusVisible, true, "the document menu is in the state that draws a focus ring");
    assert.equal(tableMenu.focusVisible, true, "the table menu is in the state that draws a focus ring");
    assert.equal(documentMenu.outline, "none", `the document menu draws no outline (${documentMenu.width} ${documentMenu.color})`);
    assert.equal(tableMenu.outline, "none", `the table menu draws no outline (${tableMenu.width} ${tableMenu.color})`);
  });

  // 3. Typing in a cell. In every frame the word at the caret is highlighted as it stands:
  // no frame without a highlight, none with the previous word.
  await section("cell highlight follows typing in every frame", async () => {
    await run(`const cell = bodyCell(1, 1); cell.focus();
      const end = doc.createRange(); end.selectNodeContents(cell); end.collapse(false);
      win.getSelection().removeAllRanges(); win.getSelection().addRange(end);
      await sleep(300);
      win.__MLRT_SURFACE_SAMPLES__ = []; win.__MLRT_SURFACE_SAMPLING__ = true;
      const sample = () => {
        if (!win.__MLRT_SURFACE_SAMPLING__) return;
        const active = doc.activeElement, highlight = win.CSS.highlights.get('mlrt-occurrence');
        const own = highlight ? [...highlight].filter(range => active.contains(range.startContainer))
          .map(range => ({ text: range.toString(), width: range.getBoundingClientRect().width })) : [];
        win.__MLRT_SURFACE_SAMPLES__.push({ cell: active.textContent, own });
        win.requestAnimationFrame(sample);
      };
      win.requestAnimationFrame(sample);
      return true;`);
    await typeText(" tracker trackers");
    await sleep(300);
    const samples = await run(`win.__MLRT_SURFACE_SAMPLING__ = false; return win.__MLRT_SURFACE_SAMPLES__;`);
    const typed = samples.at(-1)?.cell ?? "";
    const wrong = samples.filter(sample => {
      const word = /[\p{L}\p{N}_]+$/u.exec(sample.cell)?.[0];
      // The caret is at the end of the cell: with a word there, a range of exactly that
      // word must end the cell's highlights; with none, the cell has no caret word.
      return word
        ? !sample.own.some(range => range.text === word && range.width > 0)
        : sample.own.some(range => range.width === 0);
    });
    results.typing = { frames: samples.length, typed, wrongFrames: wrong.length, firstWrong: wrong.slice(0, 3) };
    assert.equal(typed, "no match here tracker trackers", "the typed text reached the cell");
    assert.ok(samples.length > 60, `frames were sampled (${samples.length})`);
    assert.equal(wrong.length, 0, `frames without the caret word's highlight: ${JSON.stringify(wrong.slice(0, 3))}`);
  });

  // 4. An occurrence looks the same in a table cell as in prose: the same square fill and
  // the same border. Computed styles first, then the composited pixels with the ink hidden.
  await section("cell and prose occurrences look the same", async () => {
    const style = await run(`view.focus();
      view.dispatch({ selection: { anchor: text().indexOf('tracker') + 3 } });
      await frames(4);
      const box = rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      const marks = [...doc.querySelectorAll('.mlrt-occurrence')];
      const highlight = win.CSS.highlights.get('mlrt-occurrence');
      // The first cell of the first body row holds only the word; it has no focus.
      const cell = bodyCell(0, 0);
      const cellRanges = highlight ? [...highlight].filter(range => cell.contains(range.startContainer)) : [];
      const allRanges = highlight ? [...highlight].map(range => box(range.getBoundingClientRect())) : [];
      const rings = [...doc.querySelectorAll('.mlrt-table-occurrence-ring')];
      const markStyle = marks[0] ? win.getComputedStyle(marks[0]) : null;
      const ringStyle = rings[0] ? win.getComputedStyle(rings[0]) : null;
      return { marks: marks.map(mark => box(mark.getBoundingClientRect())), cell: cellRanges.map(range => box(range.getBoundingClientRect())),
        ranges: allRanges, rings: rings.map(ring => box(ring.getBoundingClientRect())),
        markRadius: markStyle?.borderRadius ?? null, markShadow: markStyle?.boxShadow ?? null, markFill: markStyle?.backgroundColor ?? null,
        ringShadow: ringStyle?.boxShadow ?? null, ringFill: ringStyle?.backgroundColor ?? null,
        frame: (() => { const f = win.frameElement?.getBoundingClientRect(); return f ? { x: f.left, y: f.top } : { x: 0, y: 0 }; })() };`);
    const outer = await evaluate(wb, `(() => { const frame = [...document.querySelectorAll('iframe')].find(f => f.src.startsWith('vscode-webview:') && f.getBoundingClientRect().width > 0).getBoundingClientRect();
      return { x: frame.x, y: frame.y, width: innerWidth, height: innerHeight }; })()`);
    await screenshot("edh-surface-occurrence.png");
    // Hide the ink so a glyph cannot stand in for a missing fill.
    await run(`const hide = doc.createElement('style'); hide.id = 'mlrt-surface-ink';
      hide.textContent = '.cm-content,.cm-content *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}.cm-cursorLayer{visibility:hidden!important}';
      doc.head.append(hide); await frames(3); return true;`);
    const capture = await screenshot("edh-surface-occurrence-ink-hidden.png");
    const pixels = await run(`const bytes = Uint8Array.from(atob(${JSON.stringify(capture)}), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const sx = bitmap.width / ${outer.width}, sy = bitmap.height / ${outer.height};
      const at = (x, y) => { const i = (Math.floor((y + ${outer.y + style.frame.y}) * sy) * bitmap.width + Math.floor((x + ${outer.x + style.frame.x}) * sx)) * 4; return Array.from(data.slice(i, i + 3)); };
      const measure = box => {
        const middle = box.top + box.height / 2;
        // Walk across the left edge in device pixels and keep the greenest one: the border.
        let border = [0, 0, 0];
        for (let x = box.left - 3; x <= box.left + 3; x += 1 / sx) { const pixel = at(x, middle); if (pixel[1] > border[1]) border = pixel; }
        return { fill: at(box.left + box.width / 2, middle), border, outside: at(box.left - 8, middle) };
      };
      const result = { prose: ${JSON.stringify(style.marks[0] ?? null)} ? measure(${JSON.stringify(style.marks[0] ?? null)}) : null,
        cell: ${JSON.stringify(style.cell[0] ?? null)} ? measure(${JSON.stringify(style.cell[0] ?? null)}) : null };
      bitmap.close(); doc.getElementById('mlrt-surface-ink').remove();
      return result;`);
    results.occurrence = { style, pixels };
    const near = (a, b, tolerance) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
    assert.ok(style.marks.length >= 3 && style.cell.length === 1, "the word is highlighted in prose and in the cell");
    assert.equal(style.markRadius, "0px", "a prose occurrence has square corners, as a cell occurrence has");
    assert.equal(style.rings.length, style.ranges.length, "every cell occurrence has a border box");
    for (const [index, ring] of style.rings.entries()) {
      const range = style.ranges[index];
      assert.ok(["left", "top", "width", "height"].every(key => Math.abs(ring[key] - range[key]) <= 0.5),
        `border box ${index} sits on its match: ${JSON.stringify({ ring, range })}`);
    }
    assert.equal(style.ringShadow, style.markShadow, "the cell border is the prose border");
    assert.ok(Math.abs(style.cell[0].height - style.marks[0].height) <= 0.5, "the same height");
    assert.ok(pixels.prose && pixels.cell, "both occurrences were measured");
    assert.ok(!near(pixels.prose.fill, pixels.prose.outside, 30), `the prose fill is painted: ${JSON.stringify(pixels.prose)}`);
    assert.ok(near(pixels.cell.fill, pixels.prose.fill, 3), `the same fill: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.prose.border[1] >= 110, `the prose border is painted: ${JSON.stringify(pixels.prose)}`);
    assert.ok(pixels.cell.border[1] >= 110, `the cell border is painted: ${JSON.stringify(pixels.cell)}`);
  });

  // 5. The typing resize delay. Without it the columns follow every keystroke; with it
  // they keep their widths until typing pauses, and moving to another cell resizes at once.
  await section("typing resize delay holds column widths", async () => {
    // Change the real setting and wait for the open editor to receive it.
    const setDelay = async delay => {
      await writeFile(settingsPath, JSON.stringify({ ...settings, "markdownLiveRenderTables.tableLayout.typingResizeDelay": delay }));
      for (let attempt = 0; attempt < 80; attempt++) {
        const applied = await run(`return doc.documentElement.dataset.mlrtTableResizeDelay ?? null;`);
        if (applied === String(delay)) return applied;
        await sleep(100);
      }
      return run(`return doc.documentElement.dataset.mlrtTableResizeDelay ?? null;`);
    };
    const focusCellEnd = (row, column) => run(`const cell = bodyCell(${row}, ${column}); cell.focus();
      const end = doc.createRange(); end.selectNodeContents(cell); end.collapse(false);
      win.getSelection().removeAllRanges(); win.getSelection().addRange(end);
      await sleep(250); return columnWidths();`);
    const typeAndWatch = async value => {
      const seen = [];
      for (const ch of value) {
        await pressKey(ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), ch);
        await sleep(70);
        seen.push(await run(`return columnWidths();`));
      }
      return seen;
    };
    // The second body row holds the longest text of its column, so every key widens it.
    const immediateStart = await focusCellEnd(1, 1);
    const before = await run(`return doc.activeElement.textContent;`);
    const immediate = await typeAndWatch("abcdef");
    const applied = await setDelay(900);
    const heldStart = await focusCellEnd(1, 1);
    const held = await typeAndWatch("ghijkl");
    const cellText = await run(`return doc.activeElement.textContent;`);
    await sleep(1300);
    const afterPause = await run(`return columnWidths();`);
    const heldAgain = await typeAndWatch("mnopqr");
    // Move to another cell while the delay is still running.
    const moved = await run(`const cell = bodyCell(0, 0); cell.focus(); await frames(3); return columnWidths();`);
    await setDelay(0);
    results.resizeDelay = { immediateStart, immediate, applied, heldStart, held, before, cellText, afterPause, heldAgain, moved };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    assert.ok(immediate.every((widths, index) => !same(widths, index === 0 ? immediateStart : immediate[index - 1])),
      `with no delay the columns resize on every key: ${JSON.stringify({ immediateStart, immediate })}`);
    assert.equal(applied, "900", "the delay reached the editor");
    assert.equal(cellText, before + "abcdefghijkl", "typing reached the cell while the widths were held");
    assert.ok(held.every(widths => same(widths, heldStart)), `the columns keep their widths while typing: ${JSON.stringify({ heldStart, held })}`);
    assert.ok(!same(afterPause, heldStart), "the columns resize once typing has paused for the delay");
    assert.ok(heldAgain.every(widths => same(widths, afterPause)), "a new run of typing is held again");
    assert.ok(!same(moved, afterPause), "moving to another cell resizes at once");
  });

  // 6. Task lists. A click beside a checkbox puts the caret at the task's text, not on a
  // hidden character of its marker, and the check letter of a marker is never highlighted.
  await section("task markers take no caret from a click and no highlight", async () => {
    const read = `(() => { const m = view.state.selection.main, line = view.state.doc.lineAt(m.head);
      const row = [...view.contentDOM.querySelectorAll('.cm-line')].find(element => element.textContent.includes('checked task item'));
      return { column: m.head - line.from, empty: m.empty, lineText: line.text, rendered: !!row.querySelector('.mlrt-markdown-task-control'),
        marks: [...doc.querySelectorAll('.mlrt-occurrence')].map(mark => ({ text: mark.textContent, width: mark.getBoundingClientRect().width,
          shadow: win.getComputedStyle(mark).boxShadow })) }; })()`;
    const row = await run(`view.focus(); view.dispatch({ selection: { anchor: 0 } }); await frames(3);
      const at = text().indexOf('checked task item x done'), start = view.coordsAtPos(at);
      const element = [...view.contentDOM.querySelectorAll('.cm-line')].find(candidate => candidate.textContent.includes('checked task item'));
      const control = element.querySelector('.mlrt-markdown-task-control').getBoundingClientRect();
      return { textLeft: start.left, y: (start.top + start.bottom) / 2, controlRight: control.right, column: at - view.state.doc.lineAt(at).from };`);
    // Every point of the gap between the checkbox and the text.
    const clicks = [];
    for (let x = row.controlRight + 0.5; x < row.textLeft; x += 1) {
      await mouse("mousePressed", x, row.y);
      await mouse("mouseReleased", x, row.y);
      clicks.push({ x: Math.round(x * 10) / 10, ...(await run(`await frames(3); return ${read};`)) });
      // Leave the row before the next click, so each one meets a concealed marker.
      await run(`view.dispatch({ selection: { anchor: 0 } }); await frames(2); return true;`);
    }
    // The keyboard still walks into the marker and reveals it; nothing is highlighted there.
    await run(`view.dispatch({ selection: { anchor: text().indexOf('checked task item x done') } }); await frames(3); return true;`);
    const keyboard = [];
    for (let step = 0; step < 4; step++) {
      await live.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
      await live.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
      await sleep(80);
      keyboard.push(await run(`await frames(3); return ${read};`));
    }
    // A word x in a sentence highlights the other words x, and no hidden check letter.
    const word = await run(`view.dispatch({ selection: { anchor: text().indexOf('with x in it') + 5 } }); await frames(4); return ${read};`);
    await screenshot("edh-surface-task-word.png");
    // Selected marker syntax matches the hidden markers of the other tasks. Those matches
    // have no width, and must not paint the border around nothing.
    const syntax = await run(`const from = lineFrom('- [x] checked task item');
      view.dispatch({ selection: { anchor: from, head: from + 3 } }); await frames(4); return ${read};`);
    await run(`view.dispatch({ selection: { anchor: 0 } }); await frames(2); return true;`);
    results.tasks = { row, clicks, keyboard, word, syntax };
    assert.equal(syntax.rendered, false, "the selected marker is showing its source");
    assert.deepEqual(syntax.marks.filter(mark => mark.width === 0), [], "no highlight is drawn for a match that is hidden");
    assert.ok(clicks.length >= 4, `the gap was clicked point by point (${clicks.length})`);
    for (const click of clicks) {
      assert.equal(click.column, row.column, `a click at x=${click.x} puts the caret at the start of the task's text`);
      assert.equal(click.rendered, true, `a click at x=${click.x} leaves the checkbox rendered`);
      assert.deepEqual(click.marks.filter(mark => mark.text.toLowerCase() === "x"), [], `a click at x=${click.x} highlights no x`);
    }
    assert.deepEqual(keyboard.map(step => step.column), [row.column - 1, row.column - 2, row.column - 3, row.column - 4],
      "the left arrow walks through the marker");
    assert.ok(keyboard.every(step => step.rendered === false), "the marker's source is revealed while the caret is in it");
    assert.ok(keyboard.every(step => step.marks.length === 0), `nothing is highlighted while the caret is in the marker: ${JSON.stringify(keyboard.map(step => step.marks))}`);
    assert.deepEqual(word.marks.map(mark => mark.text), ["x", "x"], "the word x is highlighted where it is a word");
    assert.ok(word.marks.every(mark => mark.width > 0), "no highlight sits on a hidden character");
  });

  // 7. Automatic paste. Each case replaces the marker line and is undone afterwards.
  await section("automatic paste keeps source text and converts a web page", async () => {
    const paste = data => run(`const at = text().indexOf('PASTE-HERE'); view.focus();
      view.dispatch({ selection: { anchor: at, head: at + 'PASTE-HERE'.length } });
      await frames(2);
      const before = text(), transfer = new win.DataTransfer();
      for (const [type, value] of Object.entries(${JSON.stringify(data)})) transfer.setData(type, value);
      view.contentDOM.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      await frames(3);
      const after = text(), tail = before.length - (at + 'PASTE-HERE'.length);
      const inserted = after.slice(at, after.length - tail);
      view.dispatch({ changes: { from: at, to: after.length - tail, insert: 'PASTE-HERE' } });
      await frames(2);
      return inserted;`);
    const escapeHtml = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const tasks = "- [ ] Sign up for next week's CRB **[Betty]**\n- **CR-0000641 – TM Gripper Tips**\n  - **Overview tab**\n    - [ ] Complete change details (What / Why / How) **[CR]**";
    // What a VS Code text editor copies: one styled block that keeps white space, one row
    // per line, indentation as no-break spaces.
    const editorRows = tasks.split("\n").map(line => {
      const indent = line.match(/^ */)[0].length;
      return `<div><span style="color: #cccccc;">${"&#160;".repeat(indent)}${escapeHtml(line.slice(indent))}</span></div>`;
    }).join("");
    const editorHtml = `<meta charset='utf-8'><div style="color: #cccccc;background-color: #1f1f1f;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;">${editorRows}</div>`;
    const note = "## Heading two\n\n- item one\n    - nested item\nplain text after\n\n# Heading one\nparagraph";
    const noteHtml = `<h2 data-heading="Heading two">Heading two</h2>\n<ul>\n<li data-line="0">item one\n<ul>\n<li data-line="1">nested item<br>\nplain text after</li>\n</ul>\n</li>\n</ul>\n<h1 data-heading="Heading one">Heading one</h1>\n<p>paragraph</p>\n`;
    const pasted = {
      codeEditor: await paste({ "text/plain": tasks, "text/html": editorHtml, "vscode-editor-data": JSON.stringify({ version: 1, mode: "markdown" }) }),
      codeEditorWithoutType: await paste({ "text/plain": tasks, "text/html": editorHtml }),
      preformatted: await paste({ "text/plain": tasks, "text/html": `<pre style="font-family:monospace"><span style="color:#888">${escapeHtml(tasks)}</span></pre>` }),
      markdownEditor: await paste({ "text/plain": note, "text/html": noteHtml }),
      webPage: await paste({ "text/plain": "Title\n\nitem a\nitem b\n\nBold text and link",
        "text/html": `<h2>Title</h2><ul><li>item a</li><li>item b</li></ul><p><strong>Bold</strong> text and <a href="https://example.com/">link</a></p>` }),
      webLists: await paste({ "text/plain": "one\ntwo\nfirst\nsecond",
        "text/html": `<ul><li>one<ul><li>two</li></ul></li></ul><ol><li>first</li><li>second</li></ol>` }),
      webCode: await paste({ "text/plain": "const a = 1;\n    indented();", "text/html": `<pre><code class="language-js">const a = 1;\n    indented();\n</code></pre>` }),
      webWords: await paste({ "text/plain": "use the * operator on a_b", "text/html": `<p>use the * operator on a_b</p>` }),
    };
    results.paste = pasted;
    assert.equal(pasted.codeEditor, tasks, "text copied in a VS Code editor is pasted as it is");
    assert.equal(pasted.codeEditorWithoutType, tasks, "the same when only the HTML shows it is preformatted source");
    assert.equal(pasted.preformatted, tasks, "a bare preformatted block is source text");
    assert.equal(pasted.markdownEditor, note, "Markdown copied beside its rendering is pasted as the source");
    assert.equal(pasted.webPage, "## Title\n\n- item a\n- item b\n\n**Bold** text and [link](https://example.com/)",
      "a web page is converted, with # headings and one space after a list marker");
    assert.equal(pasted.webLists, "- one\n  - two\n\n1. first\n2. second", "nested and numbered lists keep their shape");
    assert.equal(pasted.webCode, "```js\nconst a = 1;\n    indented();\n```", "a code block from a web page is still fenced");
    assert.equal(pasted.webWords, "use the \\* operator on a_b", "plain words from a web page are still escaped");
  });

  results.warnings = await evaluate(wb, `[...document.querySelectorAll('.notification-list-item-message')].map(node => node.textContent)`);
  results.failures = failures;
  await writeFile(path.join(qa, "editing-surface-results.json"), JSON.stringify(results, null, 2));
  assert.deepEqual(results.warnings.filter(message => /conflicting|could not apply/.test(message)), [], "no edit warning was shown");
  if (failures.length > 0) {
    throw new Error(`${failures.length} section(s) failed:\n- ${failures.join("\n- ")}`);
  }
  console.log("Editing surface checks passed: gutter selection, menu focus ring, cell highlight while typing, occurrence style, typing resize delay, task markers, automatic paste.");
} finally {
  if (wb) void evaluate(wb, "window.close()").catch(() => {});
  for (const ws of sockets) ws.close();
  child.kill();
}
