import assert from "node:assert/strict";
import path from "node:path";

/**
 * VS Code-style occurrence highlighting in the real webview:
 *  - caret in a prose word highlights every whole-word occurrence in prose
 *    and inside rendered table cells,
 *  - a selection highlights its other (case-insensitive) occurrences,
 *  - a caret inside a table cell drives the same highlighting,
 *  - the setting turns it off live.
 */
export async function runOccurrenceHighlightCheck({ liveClient, wb, evaluateJson, captureWorkbenchScreenshot, qaDir }) {
  const evaluate = body => evaluateJson(liveClient, `(async () => {
    const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => {
      try { return frame.contentDocument; } catch { return null; }
    }).filter(Boolean)];
    const root = roots.find(doc => doc.defaultView?.__MLRT_EDITOR_VIEW__);
    const view = root.defaultView.__MLRT_EDITOR_VIEW__;
    const frames = (count = 2) => new Promise(done => {
      const step = n => n <= 0 ? done() : root.defaultView.requestAnimationFrame(() => step(n - 1));
      step(count);
    });
    const report = () => JSON.stringify({
      prose: [...view.contentDOM.querySelectorAll('.mlrt-occurrence')].map(mark => mark.textContent),
      cells: root.defaultView.CSS.highlights.get('mlrt-occurrence')
        ? [...root.defaultView.CSS.highlights.get('mlrt-occurrence')].map(range => range.toString())
        : [],
      fill: (() => {
        const mark = view.contentDOM.querySelector('.mlrt-occurrence');
        return mark ? root.defaultView.getComputedStyle(mark).backgroundColor : null;
      })(),
      theme: (() => {
        const probe = root.createElement('span');
        probe.style.backgroundColor = 'var(--vscode-editor-selectionHighlightBackground)';
        view.dom.append(probe);
        const color = root.defaultView.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      })(),
    });
    ${body}
  })()`);
  const fixture = [
    "The tracker records every tracker event.",
    "Trackers are not the same word, but TRACKER matches a selection.",
    "",
    "| Name | Notes |",
    "| --- | --- |",
    "| tracker | the tracker cell |",
    "| other | no match here |",
    "",
    "Final tracker line.",
  ].join("\n");
  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true);
    root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(fixture)}, revision: 999760, debug: false }
    }));
    await frames(3);
    return JSON.stringify(true);`);

  // 1. Caret inside a prose word.
  const caret = await evaluate(`const text = view.state.doc.toString();
    view.focus();
    view.dispatch({ selection: { anchor: text.indexOf('tracker') + 3 } });
    await frames(4);
    return report();`);
  assert.deepEqual(caret.prose, ["tracker", "tracker", "tracker"], "whole-word, case-sensitive prose matches");
  assert.deepEqual(caret.cells, ["tracker", "tracker"], "matches inside rendered table cells");
  assert.equal(caret.fill, caret.theme, "occurrences use editor.selectionHighlightBackground");
  await captureWorkbenchScreenshot(wb, path.join(qaDir, "edh-occurrence-caret.png"));

  // 2. A selection highlights its other case-insensitive occurrences.
  const selected = await evaluate(`const text = view.state.doc.toString();
    const from = text.indexOf('tracker');
    view.dispatch({ selection: { anchor: from, head: from + 'tracker'.length } });
    await frames(4);
    return report();`);
  assert.deepEqual(selected.prose, ["tracker", "Tracker", "TRACKER", "tracker"],
    "other occurrences of the selection, excluding the selection itself");
  assert.deepEqual(selected.cells, ["tracker", "tracker"]);
  await captureWorkbenchScreenshot(wb, path.join(qaDir, "edh-occurrence-selection.png"));

  // 3. Caret inside a table cell.
  const point = await evaluate(`const cell = root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="0"][data-column="1"]');
    // Aim at the middle of "tracker" inside "the tracker cell".
    const walker = root.createTreeWalker(cell, root.defaultView.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.data.includes('tracker')) node = walker.nextNode();
    const range = root.createRange();
    const index = node.data.indexOf('tracker');
    range.setStart(node, index + 3);
    range.setEnd(node, index + 4);
    const rect = range.getBoundingClientRect();
    return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });`);
  await liveClient.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await liveClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await new Promise(done => setTimeout(done, 250));
  const inCell = await evaluate(`await frames(4); return report();`);
  assert.deepEqual(inCell.prose, ["tracker", "tracker", "tracker"],
    `a caret in a cell word drives prose highlighting: ${JSON.stringify(inCell)}`);
  assert.deepEqual(inCell.cells, ["tracker", "tracker"], "and highlights the same word in every cell");

  // 4. The setting turns highlighting off immediately.
  const off = await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setEditorOptions', editorOptions: { lineWrapping: true, scrollBeyondLastLine: true,
        clipboardDocumentToken: root.documentElement.dataset.mlrtDocumentToken, defaultCopyMode: 'smart',
        defaultPasteMode: 'auto', tableNavigationModifierKey: 'F2', occurrenceHighlight: false } }
    }));
    view.focus();
    const text = view.state.doc.toString();
    view.dispatch({ selection: { anchor: text.indexOf('tracker') + 3 } });
    await frames(4);
    return report();`);
  assert.deepEqual(off.prose, [], "disabled: no prose highlights");
  assert.deepEqual(off.cells, [], "disabled: no cell highlights");
  await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setEditorOptions', editorOptions: { lineWrapping: true, scrollBeyondLastLine: true,
        clipboardDocumentToken: root.documentElement.dataset.mlrtDocumentToken, defaultCopyMode: 'smart',
        defaultPasteMode: 'auto', tableNavigationModifierKey: 'F2', occurrenceHighlight: true } }
    }));
    root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(false);
    return JSON.stringify(true);`);
  console.log("OCCURRENCE HIGHLIGHT CHECK:", { caret: caret.prose.length + caret.cells.length, selected: selected.prose.length, inCell: inCell.prose.length });
}
