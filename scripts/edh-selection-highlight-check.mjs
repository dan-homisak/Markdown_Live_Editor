import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Pixel-level check of prose selection painting in the real VS Code webview.
 *
 * A multi-line selection must read as one continuous VS Code-style region:
 *  - no unpainted pixel rows between consecutive selected lines,
 *  - lines that are selected from their start (including bulleted, nested,
 *    numbered, and task list rows) are painted from the page's left text edge,
 *    not from the indented list text,
 *  - the fill uses the active theme's editor.selectionBackground.
 *
 * The workbench screenshot is decoded inside the webview so pixels are the
 * composited result the user sees, not CSS values.
 */
export async function runSelectionHighlightCheck({ liveClient, wb, evaluateJson, qaDir, label = "selection-highlight" }) {
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
    ${body}
  })()`);
  const fixture = [
    "# Selection Highlight",
    "",
    "First paragraph line with some words.",
    "Second paragraph line, with **bold**, `code`, and a [link](https://example.com).",
    "- Bullet item one",
    "- Bullet item two",
    "  - Nested bullet three",
    "    - Deep nested four",
    "- Bullet item five",
    "1. Numbered one",
    "2. Numbered two",
    "- [ ] Task item",
    "Plain line after the list.",
    "A long paragraph that keeps going so that it wraps onto a second visual row inside the editor viewport, which exercises the wrapped-row seam as well as ordinary line seams between rows.",
    "Final line of the selection.",
    "",
    "after",
  ].join("\n");
  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true);
    root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(fixture)}, revision: 999700, debug: false }
    }));
    await frames(3);
    const text = view.state.doc.toString();
    const anchor = text.indexOf('paragraph line with');
    const head = text.indexOf('of the selection.');
    view.focus();
    view.dispatch({ selection: { anchor, head } });
    view.scrollDOM.scrollTop = 0;
    await frames(4);
    return JSON.stringify(true);`);
  await liveClient.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await new Promise(done => setTimeout(done, 250));
  // What the user sees, for review; the measured capture below hides ink.
  const visible = await wb.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(qaDir, `edh-${label}-visible.png`), Buffer.from(visible.result.data, "base64"));

  const outer = await evaluateJson(wb, `JSON.stringify((() => {
    const frame = [...document.querySelectorAll('iframe')].find(frame => frame.src.startsWith('vscode-webview:') && frame.getBoundingClientRect().width > 0);
    const rect = frame.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: innerWidth, height: innerHeight };
  })())`);
  const geometry = await evaluate(`
    const inner = root.defaultView.frameElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const text = view.state.doc.toString();
    const firstSelected = view.state.doc.lineAt(text.indexOf('paragraph line with')).number;
    const lastSelected = view.state.doc.lineAt(text.indexOf('of the selection.')).number;
    const plain = [...view.contentDOM.querySelectorAll('.cm-line')].find(line => line.textContent.startsWith('Plain line'));
    const plainStyle = root.defaultView.getComputedStyle(plain);
    const leftEdge = plain.getBoundingClientRect().left + parseFloat(plainStyle.paddingLeft);
    // A probe filled exactly like a selected row gives the composited target color.
    const probe = root.createElement('div');
    probe.className = 'mlrt-selection-color-probe';
    probe.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:99999;pointer-events:none;background:var(--vscode-editor-background);';
    const fill = root.createElement('div');
    fill.style.cssText = 'width:100%;height:100%;background:var(--mlrt-text-selection-fill);';
    probe.append(fill);
    view.dom.append(probe);
    // Measure paint, not glyphs: hide text ink and marker drawings for the
    // capture so every sampled pixel is either selection fill or background.
    const inkless = root.createElement('style');
    inkless.className = 'mlrt-selection-inkless';
    inkless.textContent = [
      '.cm-content, .cm-content * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }',
      '.cm-content *::before, .cm-content *::after { visibility: hidden !important; }',
      '.cm-content .mlrt-list-fold-control, .cm-content [class*="mlrt-markdown-task"], .cm-content .mlrt-markdown-inline-code { visibility: hidden !important; box-shadow: none !important; }',
      '.cm-cursorLayer { visibility: hidden !important; }',
    ].join(' ');
    root.head.append(inkless);
    await frames(2);
    const rows = [];
    for (let number = firstSelected + 1; number < lastSelected; number++) {
      const line = view.state.doc.line(number);
      const element = view.domAtPos(line.from).node;
      const lineElement = (element.nodeType === 1 ? element : element.parentElement).closest('.cm-line');
      const rect = lineElement.getBoundingClientRect();
      rows.push({ number, text: line.text.slice(0, 24), list: lineElement.classList.contains('mlrt-list-row'),
        top: rect.top + inner.top, bottom: rect.bottom + inner.top });
    }
    return JSON.stringify({ dpr: root.defaultView.devicePixelRatio, x: leftEdge + inner.left + 2,
      probe: { x: inner.left + 12, y: inner.top + 12 }, rows });`);
  const capture = await wb.send("Page.captureScreenshot", { format: "png" });
  const png = capture.result.data;
  await evaluate(`view.dom.querySelector('.mlrt-selection-color-probe')?.remove(); root.head.querySelector('.mlrt-selection-inkless')?.remove(); return JSON.stringify(true);`);
  await writeFile(path.join(qaDir, `edh-${label}.png`), Buffer.from(png, "base64"));
  const pixels = await evaluate(`
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const sx = bitmap.width / ${outer.width}, sy = bitmap.height / ${outer.height};
    const at = (x, y) => { const index = (Math.round(y) * bitmap.width + Math.round(x)) * 4; return [data[index], data[index + 1], data[index + 2]]; };
    const geometry = ${JSON.stringify(geometry)};
    const target = at((geometry.probe.x + ${outer.x}) * sx, (geometry.probe.y + ${outer.y}) * sy);
    const matches = color => color.every((channel, index) => Math.abs(channel - target[index]) <= 14);
    const x = (geometry.x + ${outer.x}) * sx;
    const rows = geometry.rows.map(row => {
      const top = (row.top + ${outer.y}) * sy, bottom = (row.bottom + ${outer.y}) * sy;
      const unpainted = [];
      for (let y = Math.ceil(top); y < Math.floor(bottom); y++) if (!matches(at(x, y))) unpainted.push(y - Math.ceil(top));
      return { ...row, unpainted: unpainted.length, firstUnpainted: unpainted.slice(0, 6) };
    });
    // Seams: the device pixels straddling each boundary between selected rows.
    const seams = geometry.rows.slice(1).map((row, index) => {
      const boundary = (row.top + ${outer.y}) * sy;
      const samples = [Math.floor(boundary) - 1, Math.floor(boundary), Math.ceil(boundary)].map(y => matches(at(x, y)));
      return { between: [geometry.rows[index].number, row.number], painted: samples.every(Boolean) };
    });
    bitmap.close();
    return JSON.stringify({ target, rows, seams });`);
  const result = { dpr: geometry.dpr, ...pixels };
  await writeFile(path.join(qaDir, `edh-${label}.json`), JSON.stringify(result, null, 2));
  const failures = [
    ...result.rows.filter(row => row.unpainted > 0).map(row => `line ${row.number} "${row.text}"${row.list ? " (list)" : ""}: ${row.unpainted} unpainted px at the left text edge (offsets ${row.firstUnpainted.join(",")})`),
    ...result.seams.filter(seam => !seam.painted).map(seam => `gap between lines ${seam.between.join(" and ")}`),
  ];
  console.log("SELECTION HIGHLIGHT:", { dpr: result.dpr, target: result.target, rows: result.rows.length, failures: failures.length });
  assert.deepEqual(failures, [], `Selection highlight is not continuous:\n${failures.join("\n")}`);
  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(false); return JSON.stringify(true);`);
}
