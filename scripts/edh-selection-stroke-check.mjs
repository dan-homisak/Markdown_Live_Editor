import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

// Measure the actual composited screenshot, rather than accepting a nominal
// SVG stroke-width that can rasterize to alternating one/two-pixel lines.
export async function runSelectionStrokeCheck({ liveClient, wb, evaluateJson, qaDir }) {
  const evaluate = body => evaluateJson(liveClient, `(async () => {
    const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => {
      try { return frame.contentDocument; } catch { return null; }
    }).filter(Boolean)];
    const root = roots.find(doc => doc.defaultView?.__MLRT_EDITOR_VIEW__);
    const view = root.defaultView.__MLRT_EDITOR_VIEW__;
    ${body}
  })()`);
  const fixture = 'before\n\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| alpha | beta | 100 |\n|  |  |  |\n| short | x | 3 |\n\nafter';
  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true);
    root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(fixture)}, revision: 999500, debug: false }
    }));
    await new Promise(done => root.defaultView.requestAnimationFrame(() => root.defaultView.requestAnimationFrame(done)));
    return JSON.stringify(true);`);

  const outer = await evaluateJson(wb, `JSON.stringify((() => {
    const frame = [...document.querySelectorAll('iframe')].find(frame => frame.src.startsWith('vscode-webview:') && frame.getBoundingClientRect().width > 0);
    const rect = frame.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: innerWidth, height: innerHeight };
  })())`);
  const cases = [
    ['stepped-hole', [[1, 0], [1, 1], [1, 2], [2, 0], [2, 2], [3, 0], [3, 1]]],
    ['rectangle', [[1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]],
  ];
  let previous = [];
  for (const [name, cells] of cases) {
    // Toggle the previous set off using the same trusted Ctrl+click path.
    for (const [row, column] of [...previous, ...cells]) {
      const point = await evaluate(`const cell = root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-row-index="${row - 1}"][data-column="${column}"]');
        const rect = cell.getBoundingClientRect(); return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });`);
      await liveClient.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', modifiers: 2, clickCount: 1 });
      await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', modifiers: 2, clickCount: 1 });
    }
    previous = cells;
    // Move away to leave the selection free of proximity controls.
    await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 15, y: 15 });
    await new Promise(done => setTimeout(done, 150));
    const geometry = await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget');
      const selected = [...wrapper.querySelectorAll('.mlrt-table-cell-selected')];
      const keys = new Set(selected.map(cell => (Number(cell.dataset.rowIndex) + 1) + ':' + cell.dataset.column));
      const inner = root.defaultView.frameElement?.getBoundingClientRect();
      const points = [];
      for (const cell of selected) {
        const row = Number(cell.dataset.rowIndex) + 1, column = Number(cell.dataset.column), rect = cell.getBoundingClientRect();
        const sides = [
          { side: 'top', row: row - 1, column, axis: 'y', x: rect.left + rect.width / 2, y: rect.top },
          { side: 'right', row, column: column + 1, axis: 'x', x: rect.right, y: rect.top + rect.height / 2 },
          { side: 'bottom', row: row + 1, column, axis: 'y', x: rect.left + rect.width / 2, y: rect.bottom },
          { side: 'left', row, column: column - 1, axis: 'x', x: rect.left, y: rect.top + rect.height / 2 },
        ];
        for (const side of sides) if (!keys.has(side.row + ':' + side.column)) points.push({
          axis: side.axis, x: side.x + (inner?.left ?? 0), y: side.y + (inner?.top ?? 0), label: row + ':' + column + ':' + side.side });
      }
      return JSON.stringify({ selected: selected.length, dpr: root.defaultView.devicePixelRatio, points,
        borderWidth: parseFloat(root.defaultView.getComputedStyle(selected[0]).borderRightWidth),
        color: root.defaultView.getComputedStyle(wrapper.querySelector('.mlrt-table-selection-frame')).stroke });`);
    assert.equal(geometry.selected, cells.length);
    const capture = await wb.send('Page.captureScreenshot', { format: 'png' });
    const png = capture.result.data;
    const scale = String(geometry.dpr).replaceAll('.', '-');
    const basename = `edh-selection-stroke-${name}-dpr-${scale}`;
    await writeFile(path.join(qaDir, basename + '.png'), Buffer.from(png, 'base64'));
    const pixels = await evaluate(`
      const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), character => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const sx = bitmap.width / ${outer.width}, sy = bitmap.height / ${outer.height};
      const points = ${JSON.stringify(geometry.points)};
      const measured = points.map(point => {
        const x = Math.round((point.x + ${outer.x}) * sx), y = Math.round((point.y + ${outer.y}) * sy);
        const samples = [];
        for (let offset = -5; offset <= 5; offset++) {
          const px = point.axis === 'x' ? x + offset : x, py = point.axis === 'y' ? y + offset : y;
          const index = (py * bitmap.width + px) * 4;
          // The theme uses a translucent color(srgb ...) stroke. Count its
          // composited blue pixels, excluding dark selection fill and text.
          const [red, green, blue] = data.slice(index, index + 3);
          if (blue > 140 && green > 80 && blue - red > 80 && blue - green > 30) samples.push(offset);
        }
        const runs = [];
        for (const offset of samples) {
          const last = runs.at(-1);
          if (last && last.at(-1) === offset - 1) last.push(offset);
          else runs.push([offset]);
        }
        const stroke = runs.sort((a, b) => Math.min(...a.map(Math.abs)) - Math.min(...b.map(Math.abs)))[0] ?? [];
        return { label: point.label, x, y, thickness: stroke.length, samples: stroke };
      });
      bitmap.close();
      return JSON.stringify({ sx, sy, measured });`);
    const result = { name, geometry, outer, dpr: geometry.dpr, expectedPixels: Math.round(geometry.borderWidth * geometry.dpr), ...pixels };
    await writeFile(path.join(qaDir, basename + '.json'), JSON.stringify(result, null, 2));
    console.log('SELECTION STROKE PIXELS:', { name, dpr: result.dpr, expectedPixels: result.expectedPixels, measured: pixels.measured });
    assert.ok(pixels.measured.every(edge => edge.thickness === result.expectedPixels), `Uneven painted border: ${JSON.stringify(result)}`);
  }
}
