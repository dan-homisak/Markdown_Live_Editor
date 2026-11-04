import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { parseMarkdownTables, rowToDisplayValues } = require(path.join(repoRoot, "dist", "shared", "tableModel.js"));

/**
 * Real-input regression suite for table source integrity.
 *
 * Every scenario drives Chromium input (mouse, key, and text events) into the
 * live editor webview and then proves three invariants:
 *   1. every Markdown table in the source has exactly the expected cell grid,
 *   2. every non-table line of the document is untouched, and
 *   3. every mounted table widget renders exactly what its source contains.
 *
 * The scenarios reproduce the 2026-11-03 corruption reports: edits in one
 * table followed by edits, row deletion, or paste in another table; scrolling
 * a recently edited table out of the viewport and back; multi-line cells; and
 * an authoritative host rejection that arrives mid-edit.
 *
 * Widgets are located through CodeMirror's own position mapping
 * (`view.posAtDOM`) rather than through the extension's `data-*` metadata, so
 * the suite remains meaningful even when that metadata is what went stale.
 */
export async function runTableIntegrityCheck({ liveClient, wb, evaluateJson, captureWorkbenchScreenshot, qaDir, fixturePath }) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = body => evaluateJson(liveClient, `(async () => {
    const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => {
      try { return frame.contentDocument; } catch { return null; }
    }).filter(Boolean)];
    const root = roots.find(doc => doc.defaultView?.__MLRT_EDITOR_VIEW__);
    const view = root?.defaultView.__MLRT_EDITOR_VIEW__;
    if (!view) throw new Error('Live editor missing');
    const frames = (count = 2) => new Promise(done => {
      const step = n => n <= 0 ? done() : root.defaultView.requestAnimationFrame(() => step(n - 1));
      step(count);
    });
    const widgetAt = from => [...root.querySelectorAll('.mlrt-table-widget')]
      .find(wrapper => wrapper.isConnected && view.contentDOM.contains(wrapper) && view.posAtDOM(wrapper) === from);
    ${body}
  })()`);
  const primary = process.platform === "darwin" ? 4 : 2;
  const shift = 8;
  const virtualKeyCodes = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
  const key = async (name, modifiers = 0) => {
    await liveClient.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name, modifiers,
      windowsVirtualKeyCode: virtualKeyCodes[name] ?? 0 });
    await liveClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, modifiers,
      windowsVirtualKeyCode: virtualKeyCodes[name] ?? 0 });
    await sleep(60);
  };
  const type = async text => {
    for (const character of text) {
      await liveClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character,
        unmodifiedText: character });
      await liveClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
      await sleep(15);
    }
    await sleep(60);
  };
  const mouse = async (point, button = "left") => {
    await liveClient.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await liveClient.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, clickCount: 1 });
    await liveClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, clickCount: 1 });
    await sleep(120);
  };
  const currentText = () => evaluate(`return JSON.stringify(view.state.doc.toString());`);
  const tableStart = async tableIndex => {
    const table = parseMarkdownTables(await currentText())[tableIndex];
    assert.ok(table, `table ${tableIndex} exists in the source`);
    return table.from;
  };
  /** Viewport point inside a source-addressed cell, scrolling it into view first. */
  const cellPoint = async (tableIndex, row, column) => {
    const from = await tableStart(tableIndex);
    return evaluate(`
      let wrapper = widgetAt(${from});
      if (!wrapper) {
        // Mount the table by scrolling its source position into view.
        const block = view.lineBlockAt(${from});
        view.scrollDOM.scrollTop = Math.max(0, block.top - 40);
        await frames(4);
        wrapper = widgetAt(${from});
      }
      if (!wrapper) throw new Error('Table at ${from} is not mounted');
      const cell = wrapper.querySelector('.mlrt-table-cell[data-row-kind="' + (${row} === 0 ? 'header' : 'body') + '"][data-row-index="' + Math.max(0, ${row} - 1) + '"][data-column="${column}"]');
      if (!cell) throw new Error('Cell ${row}:${column} missing in table at ${from}');
      cell.scrollIntoView({ block: 'center' });
      await frames(3);
      const rect = cell.getBoundingClientRect();
      return JSON.stringify({ x: rect.right - 6, y: rect.top + Math.min(rect.height / 2, 10) });`);
  };
  /** Click into a cell and put the caret at the end of its whole value. */
  const editCell = async (tableIndex, row, column) => {
    await mouse(await cellPoint(tableIndex, row, column));
    await key("End", primary);
    const from = await tableStart(tableIndex);
    const focused = await evaluate(`const cell = root.activeElement;
      if (!cell?.classList.contains('mlrt-table-cell')) return JSON.stringify(null);
      return JSON.stringify({ table: view.posAtDOM(cell.closest('.mlrt-table-widget')),
        row: cell.dataset.rowKind === 'header' ? 0 : Number(cell.dataset.rowIndex) + 1,
        column: Number(cell.dataset.column) });`);
    assert.deepEqual(focused, { table: from, row, column }, `focus landed in table ${tableIndex} cell ${row}:${column}`);
  };
  const clickProse = async lineText => {
    const point = await evaluate(`const line = [...root.querySelectorAll('.cm-line')].find(line => line.textContent.includes(${JSON.stringify(lineText)}));
      if (!line) throw new Error('Prose line missing');
      line.scrollIntoView({ block: 'center' }); await frames(3);
      const rect = line.getBoundingClientRect(); return JSON.stringify({ x: rect.left + 4, y: rect.top + rect.height / 2 });`);
    await mouse(point);
  };
  const pasteIntoActiveCell = async plain => evaluate(`const cell = root.activeElement;
    if (!cell?.classList.contains('mlrt-table-cell')) throw new Error('No active cell for paste');
    const data = new root.defaultView.DataTransfer();
    data.setData('text/plain', ${JSON.stringify(plain)});
    cell.dispatchEvent(new root.defaultView.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await frames(2); return JSON.stringify(true);`);

  let revision = 997000;
  const setup = async text => {
    await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(text)}, revision: ${++revision}, debug: false }
    })); await frames(2);
    view.focus(); view.dispatch({ selection: { anchor: 0 } }); view.scrollDOM.scrollTop = 0; await frames(2);
    return JSON.stringify(true);`);
    await sleep(150);
  };
  const snapshot = () => evaluate(`await frames(2);
    return JSON.stringify({ text: view.state.doc.toString(),
      widgets: [...root.querySelectorAll('.mlrt-table-widget')].filter(wrapper => view.contentDOM.contains(wrapper)).map(wrapper => ({
        from: view.posAtDOM(wrapper),
        cells: [...wrapper.querySelectorAll('.mlrt-table-cell')].map(cell => ({
          row: cell.dataset.rowKind === 'header' ? 0 : Number(cell.dataset.rowIndex) + 1,
          column: Number(cell.dataset.column),
          sourceValue: cell.dataset.sourceValue ?? null,
          active: root.activeElement === cell,
          shown: cell.dataset.markdownPreview === 'true' ? (cell.dataset.previewValue ?? '') : cell.innerText.replace(/\\u00a0/g, ' ').replace(/\\n$/, ''),
        })),
      })) });`);

  const gridOf = table => [table.header, ...table.body].map(row => rowToDisplayValues(row, table.columnCount));
  const proseLines = text => {
    const tables = parseMarkdownTables(text);
    return text.split("\n").filter((_, index) => !tables.some(table => index >= table.startLine && index <= table.endLine));
  };
  const assertIntegrity = async (label, expected, originalProse) => {
    const state = await snapshot();
    const tables = parseMarkdownTables(state.text);
    assert.equal(tables.length, expected.length, `${label}: table count\n${state.text}`);
    tables.forEach((table, index) => assert.deepEqual(gridOf(table), expected[index], `${label}: table ${index} cells\n${state.text}`));
    assert.deepEqual(proseLines(state.text), originalProse, `${label}: prose outside tables is unchanged`);
    for (const widget of state.widgets) {
      const table = tables.find(candidate => candidate.from === widget.from);
      assert.ok(table, `${label}: mounted widget at ${widget.from} matches a source table`);
      const grid = gridOf(table);
      for (const cell of widget.cells) {
        const sourceValue = grid[cell.row]?.[cell.column];
        assert.equal(cell.sourceValue, sourceValue, `${label}: widget ${widget.from} cell ${cell.row}:${cell.column} metadata`);
        if (!cell.active) {
          assert.equal(cell.shown.trim(), sourceValue.trim(), `${label}: widget ${widget.from} cell ${cell.row}:${cell.column} renders its source`);
        }
      }
    }
    return state;
  };

  const section = number => [
    `###### 12.${number} Installation And Study Start`,
    "**Test Information**",
    "",
    "| Test Case Number | Test Case Title |",
    "| --- | --- |",
    `| TC-12.${number} | Installation And Study Start |`,
    "",
    "| Purpose | Procedure | Acceptance Criteria |",
    "| --- | --- | --- |",
    "| Document the study configuration. | Verify each Section 6.2 step as it is completed. | The new tips are installed and set up as assigned. |",
    "**Test Execution**",
    "",
    "| Test ID | User Requirements Tested | Verification Method | Expected Results | Actual Results | Pass/Fail | Signature | Comments |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    `| 12.${number}.1 | N/A | Record the line and base curve. | Line:<br>Base curve:<br>Track 1: |  |  |  |  |`,
    `| 12.${number}.2 | N/A | Verify a lot change was completed | A lot change was completed |  |  |  |  |`,
    `| 12.${number}.3 |  | Verify the form was attached | Posted on red paper<br>Evidence:   |  |  |  |  |`,
    `| 12.${number}.4 | N/A | Verify the tips before installation. | The tips were cleaned. |  |  |  |  |`,
    "**Test Conclusion**",
    "",
    "| Test Case Comments | Section Pass/Fail | Are all Deviations Closed? | Signature |",
    "| --- | --- | --- | --- |",
    "|  |  |  |  |",
    ...Array.from({ length: 40 }, (_, line) => `Narrative ${number}.${line} keeps the next section below the viewport.`),
    "",
  ];
  const fixture = ["# Integrity", "", "Intro paragraph.", "", ...section(2), ...section(3), ...section(4)].join("\n");
  const fresh = () => ({ expected: parseMarkdownTables(fixture).map(gridOf), prose: proseLines(fixture) });
  // Table indexes within one section: 0 info, 1 purpose, 2 execution, 3 conclusion.
  const T = (sectionIndex, table) => sectionIndex * 4 + table;
  const results = [];

  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true); return JSON.stringify(true);`);
  try {
    // 1. Typing in one table must not leave a later table's source map stale.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(0, 1), 1, 2);
      await type(" Edited once.");
      expected[T(0, 1)][1][2] += " Edited once.";
      await assertIntegrity("cross-table first edit", expected, prose);
      await editCell(T(0, 2), 2, 4);
      await type("Actual result 2");
      expected[T(0, 2)][2][4] = "Actual result 2";
      await assertIntegrity("cross-table second edit", expected, prose);
      await editCell(T(0, 3), 1, 0);
      await type("Conclusion");
      expected[T(0, 3)][1][0] = "Conclusion";
      await assertIntegrity("cross-table third edit", expected, prose);
      results.push("cross-table edits");
    }

    // 2. A table edited, scrolled out of the viewport, and remounted must show
    //    and edit its current source rather than its first parse.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(0, 2), 1, 3);
      await key("Enter", shift);
      await type("Track 2:");
      expected[T(0, 2)][1][3] += "\nTrack 2:";
      await editCell(T(0, 2), 3, 4);
      await type("Recorded");
      expected[T(0, 2)][3][4] = "Recorded";
      await assertIntegrity("before scroll", expected, prose);
      await evaluate(`view.contentDOM.blur(); view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight; await frames(4);
        view.scrollDOM.scrollTop = 0; await frames(4); return JSON.stringify(true);`);
      await assertIntegrity("after remount", expected, prose);
      await editCell(T(0, 2), 4, 4);
      await type("After remount");
      expected[T(0, 2)][4][4] = "After remount";
      await editCell(T(0, 2), 2, 7);
      await type("Comment");
      expected[T(0, 2)][2][7] = "Comment";
      await assertIntegrity("edit after remount", expected, prose);
      results.push("scroll remount");
    }

    // 3. Row deletion after typing in an earlier table removes only that row.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(1, 1), 1, 2);
      await type(" QA Operations is notified of the first full lot.");
      expected[T(1, 1)][1][2] += " QA Operations is notified of the first full lot.";
      await mouse(await cellPoint(T(1, 2), 3, 2), "right");
      const menu = await evaluate(`const item = [...root.querySelectorAll('.mlrt-clipboard-menu button')].find(button => button.dataset.action === 'delete-rows');
        if (!item) throw new Error('Delete row menu item missing');
        const rect = item.getBoundingClientRect(); return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });`);
      await mouse(menu);
      expected[T(1, 2)].splice(3, 1);
      await assertIntegrity("delete row after edit", expected, prose);
      results.push("row deletion");
    }

    // 4. Grid and single-cell paste after typing in an earlier table land in
    //    the target cells.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(0, 1), 1, 1);
      await type(" Extra procedure words.");
      expected[T(0, 1)][1][1] += " Extra procedure words.";
      await editCell(T(0, 2), 1, 4);
      await pasteIntoActiveCell("Pasted A\tPasted B");
      expected[T(0, 2)][1][4] = "Pasted A";
      expected[T(0, 2)][1][5] = "Pasted B";
      await assertIntegrity("grid paste after edit", expected, prose);
      await editCell(T(0, 2), 2, 4);
      await pasteIntoActiveCell("Single value");
      expected[T(0, 2)][2][4] = "Single value";
      await assertIntegrity("cell paste after edit", expected, prose);
      results.push("paste");
    }

    // 5. Selecting and deleting text at the end of a line inside a multi-line
    //    cell edits only that cell.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(2, 1), 1, 1);
      await type(" More.");
      expected[T(2, 1)][1][1] += " More.";
      await editCell(T(2, 2), 1, 3);
      await key("Home", shift);
      await key("Backspace");
      expected[T(2, 2)][1][3] = expected[T(2, 2)][1][3].replace(/Track 1:$/, "");
      await type("Replaced line");
      expected[T(2, 2)][1][3] += "Replaced line";
      await assertIntegrity("multi-line selection delete", expected, prose);
      await editCell(T(2, 1), 1, 1);
      await key("ArrowLeft", shift);
      await key("ArrowLeft", shift);
      await key("Delete");
      expected[T(2, 1)][1][1] = expected[T(2, 1)][1][1].slice(0, -2);
      await assertIntegrity("selection delete at end", expected, prose);
      results.push("multi-line cells");
    }

    // 6. Structure shortcuts after an edit elsewhere target the right table.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(0, 1), 1, 0);
      await type(" Purpose words.");
      expected[T(0, 1)][1][0] += " Purpose words.";
      await editCell(T(0, 2), 2, 0);
      await key("Enter", 2);
      expected[T(0, 2)].splice(3, 0, Array(8).fill(""));
      await type("new row");
      expected[T(0, 2)][3][0] = "new row";
      await assertIntegrity("insert row after edit", expected, prose);
      results.push("structure shortcuts");
    }

    // 7. Prose edits between table edits keep every table addressable.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      await editCell(T(0, 2), 1, 7);
      await type("first");
      expected[T(0, 2)][1][7] = "first";
      await clickProse("Intro paragraph.");
      await key("End");
      await type(" More intro.");
      prose[prose.indexOf("Intro paragraph.")] = "Intro paragraph. More intro.";
      await editCell(T(0, 2), 2, 7);
      await type("second");
      expected[T(0, 2)][2][7] = "second";
      await editCell(T(1, 2), 1, 7);
      await type("third");
      expected[T(1, 2)][1][7] = "third";
      await assertIntegrity("prose between table edits", expected, prose);
      results.push("prose interleaving");
    }

    // 8. An authoritative host rejection that arrives mid-edit resynchronizes
    //    the widget before the next keystroke is written.
    {
      await setup(fixture);
      const { expected, prose } = fresh();
      const base = await currentText();
      await editCell(T(0, 2), 1, 4);
      await type("lost");
      await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
        data: { type: 'setDocument', source: 'webviewReject', text: ${JSON.stringify(base)}, revision: ${++revision}, debug: false }
      })); await frames(3); return JSON.stringify(true);`);
      await assertIntegrity("after host rejection", expected, prose);
      await editCell(T(0, 2), 3, 4);
      await type("kept");
      expected[T(0, 2)][3][4] = "kept";
      await editCell(T(0, 2), 1, 4);
      await type("again");
      expected[T(0, 2)][1][4] = "again";
      await assertIntegrity("edits after host rejection", expected, prose);
      results.push("host rejection");
    }
    await captureWorkbenchScreenshot(wb, path.join(qaDir, "edh-table-integrity-final.png"));
  } finally {
    await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(false); return JSON.stringify(true);`).catch(() => undefined);
  }

  // 9. Real host round trip: edits in two tables go through VS Code's
  //    TextDocument, are saved, and the file on disk equals the editor.
  if (fixturePath) {
    const disk = async () => (await readFile(fixturePath, "utf8")).replace(/\r\n/g, "\n");
    const original = await disk();
    for (let attempt = 0; attempt < 50 && (await currentText()) !== original; attempt++) await sleep(100);
    assert.equal(await currentText(), original, "the live editor resynchronized with the real document");
    const expected = parseMarkdownTables(original).map(gridOf);
    const prose = proseLines(original);
    await editCell(0, 1, 0);
    await type(" A1");
    expected[0][1][0] += " A1";
    await editCell(1, 2, 1);
    await type(" B2");
    expected[1][2][1] += " B2";
    await editCell(0, 1, 1);
    await key("Enter", shift);
    await type("line two");
    expected[0][1][1] += "\nline two";
    await assertIntegrity("real host edits", expected, prose);
    await mouse(await evaluate(`const line = [...root.querySelectorAll('.cm-line')].find(line => line.textContent.trim());
      const rect = line.getBoundingClientRect(); return JSON.stringify({ x: rect.left + 4, y: rect.top + rect.height / 2 });`));
    const save = { type: "rawKeyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: primary };
    await liveClient.send("Input.dispatchKeyEvent", save);
    await liveClient.send("Input.dispatchKeyEvent", { ...save, type: "keyUp" });
    let saved = await disk();
    for (let attempt = 0; attempt < 50 && saved === original; attempt++) {
      await sleep(100);
      saved = await disk();
    }
    assert.equal(saved, await currentText(), "the saved file is exactly what the live editor shows");
    assert.deepEqual(parseMarkdownTables(saved).map(gridOf), expected, "saved tables hold every edit in the right cell");
    assert.deepEqual(proseLines(saved), prose, "saved prose is untouched");
    results.push("real host round trip");
  }
  console.log("TABLE INTEGRITY CHECK:", results);
}
