import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";

export async function runTableLineBreakScrollCheck({ liveClient, wb, evaluateJson, captureWorkbenchScreenshot, qaDir }) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = body => evaluateJson(liveClient, `(async () => {
    const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => {
      try { return frame.contentDocument; } catch { return null; }
    }).filter(Boolean)];
    const root = roots.find(doc => doc.defaultView?.__MLRT_EDITOR_VIEW__);
    const view = root?.defaultView.__MLRT_EDITOR_VIEW__;
    if (!view) throw new Error('Live editor missing');
    ${body}
  })()`);
  const key = async (key, modifiers = 0) => {
    await liveClient.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, modifiers,
      code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 8 });
    await liveClient.send("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers });
    await sleep(250);
  };
  const state = () => evaluate(`const cell = root.activeElement;
    const selection = root.defaultView.getSelection();
    const caret = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    return JSON.stringify({ top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft,
      pageTop: root.defaultView.scrollY, height: view.scrollDOM.scrollHeight,
      viewportTop: view.scrollDOM.getBoundingClientRect().top,
      viewportBottom: view.scrollDOM.getBoundingClientRect().bottom,
      text: cell?.textContent, source: view.state.doc.toString(),
      activeCell: cell?.classList.contains('mlrt-table-cell'),
      cellTop: cell?.getBoundingClientRect().top, caretTop: caret?.top,
      caretOffset: selection?.focusOffset, selectionCollapsed: selection?.isCollapsed });`);
  const shot = name => captureWorkbenchScreenshot(wb, path.join(qaDir, `edh-table-line-break-${name}.png`));
  const results = [];

  // Keep the real host connected for the ordinary edit/echo path.
  await evaluate(`const cell = root.querySelector('.mlrt-table-cell');
    cell.focus({ preventScroll: true });
    const range = root.createRange(); range.selectNodeContents(cell); range.collapse(false);
    const selection = root.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return JSON.stringify(true);`);
  const hostBefore = await state();
  await key("Enter", 8);
  const hostAfter = await state();
  results.push({ name: "connected-host", before: hostBefore, after: hostAfter });

  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true); return JSON.stringify(true);`);
  let revision = 999500;
  for (const scenario of [
    { name: "middle-of-document", rows: 6, row: 1, after: 40 },
    { name: "middle-of-tall-table", rows: 65, row: 32, after: 10 },
    { name: "viewport-bottom", rows: 40, row: 32, after: 10, edge: true },
    { name: "document-bottom", rows: 35, row: 34, after: 0, bottom: true },
    { name: "beforeinput-line-break", rows: 35, row: 34, after: 0, bottom: true, inputType: "insertLineBreak" },
    { name: "beforeinput-paragraph", rows: 35, row: 34, after: 0, bottom: true, inputType: "insertParagraph" },
  ]) {
    const text = [
      ...Array.from({ length: 35 }, (_, n) => `Before ${n}`), "",
      "| Key | Value |", "| --- | --- |",
      ...Array.from({ length: scenario.rows }, (_, n) => `| Row ${n} | value ${n} |`), "",
      ...Array.from({ length: scenario.after }, (_, n) => `After ${n}`),
    ].join("\n");
    await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(text)}, revision: ${++revision}, debug: false }
    })); return JSON.stringify(true);`);
    await sleep(300);
    await evaluate(`view.scrollDOM.scrollTop = 35 * view.defaultLineHeight; return JSON.stringify(true);`);
    await sleep(200);
    await evaluate(`const cell = root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="${scenario.row}"][data-column="1"]');
      if (!cell) throw new Error('Target row missing');
      cell.focus({ preventScroll: true });
      const range = root.createRange(); range.selectNodeContents(cell); range.collapse(false);
      const selection = root.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const viewport = view.scrollDOM.getBoundingClientRect();
      const inset = ${Boolean(scenario.edge)} ? viewport.height - 80 : 150;
      view.scrollDOM.scrollTop += (cell.getBoundingClientRect().top - viewport.top - inset) / view.scaleY;
      if (${Boolean(scenario.bottom)}) view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      return JSON.stringify(true);`);
    await sleep(300);
    const before = await state();
    assert.ok(before.cellTop >= before.viewportTop && before.cellTop < before.viewportBottom,
      `${scenario.name}: target cell is visible before editing`);
    await shot(`${scenario.name}-before`);
    for (let n = 0; n < 3; n++) {
      if (scenario.inputType) {
        const prevented = await evaluate(`return JSON.stringify(!root.activeElement.dispatchEvent(new root.defaultView.InputEvent('beforeinput', {
          bubbles: true, cancelable: true, inputType: ${JSON.stringify(scenario.inputType)}, data: null
        })));`);
        assert.equal(prevented, true, `${scenario.name}: handles beforeinput`);
        await sleep(250);
      } else {
        await key("Enter", 8);
      }
    }
    const after = await state();
    await shot(`${scenario.name}-after`);
    results.push({ name: scenario.name, before, after });
    console.log("TABLE LINE BREAK SCROLL:", scenario.name, { before: before.top, after: after.top,
      beforeCellTop: before.cellTop, afterCellTop: after.cellTop, text: after.text });
  }
  await writeFile(path.join(qaDir, "edh-table-line-break-scroll.json"), JSON.stringify(results.map(({ name, before, after }) => ({
    name, before: { ...before, source: undefined }, after: { ...after, source: undefined },
    scrollDelta: after.top - before.top, lineBreakStored: after.source.includes('<br>'),
  })), null, 2));
  for (const { name, before, after } of results) {
    assert.equal(after.text, before.text + (name === "connected-host" ? "\n" : "\n\n\n"), `${name}: inserts the requested cell line breaks`);
    assert.equal(after.activeCell, true, `${name}: keeps cell focus`);
    assert.equal(after.selectionCollapsed, true, `${name}: keeps a collapsed caret`);
    assert.ok(Math.abs(after.top - before.top) <= 0.5, `${name}: vertical scroll changed from ${before.top} to ${after.top}`);
    assert.ok(Math.abs(after.cellTop - before.cellTop) <= 0.5, `${name}: edited cell stays in place`);
    assert.equal(after.left, before.left, `${name}: horizontal scroll stays put`);
    assert.equal(after.pageTop, before.pageTop, `${name}: outer page stays put`);
    assert.ok(after.source.includes('<br>'), `${name}: persists the line break in Markdown`);
  }
  console.log("TABLE LINE BREAK SCROLL CHECK: connected host, middle of document, tall table, viewport/document bottom, and beforeinput paths passed.");
}
