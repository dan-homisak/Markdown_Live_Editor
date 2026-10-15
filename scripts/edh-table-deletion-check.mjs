import assert from "node:assert/strict";
import path from "node:path";

export async function runTableDeletionCheck({ liveClient, wb, evaluateJson, captureWorkbenchScreenshot, qaDir }) {
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
    const codes = { Delete: 46, Backspace: 8, Escape: 27, ArrowDown: 40, ArrowRight: 39, a: 65, z: 90 };
    await liveClient.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, modifiers,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: codes[key] });
    await liveClient.send("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers });
    await sleep(180);
  };
  const state = () => evaluate(`return JSON.stringify({ text: view.state.doc.toString(),
    tables: [...root.querySelectorAll('.mlrt-table-widget')].map(wrapper => ({
      from: Number(wrapper.dataset.srcFrom), to: Number(wrapper.dataset.srcTo),
      rows: [...wrapper.querySelectorAll('tr')].map(row => [...row.querySelectorAll('.mlrt-table-cell')].map(cell => cell.innerText.trim())) })),
    selected: root.querySelectorAll('.mlrt-table-cell-selected').length,
    selectedAddresses: [...root.querySelectorAll('.mlrt-table-cell-selected')].map(cell => [cell.dataset.rowKind, cell.dataset.rowIndex, cell.dataset.column].join(':')),
    feedback: root.querySelector('.mlrt-clipboard-status[data-visible="true"]')?.textContent,
    top: view.scrollDOM.scrollTop, tableTop: root.querySelector('.mlrt-table')?.getBoundingClientRect().top,
    active: root.activeElement?.className, anchor: view.state.selection.main.anchor, head: view.state.selection.main.head });`);
  const shot = name => captureWorkbenchScreenshot(wb, path.join(qaDir, `edh-table-${name}.png`));
  const click = async (selector, button = 'left', modifiers = 0) => {
    const point = await evaluate(`const element = root.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Click target missing: ' + ${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect(); return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });`);
    await liveClient.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, modifiers, clickCount: 1 });
    await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, modifiers, clickCount: 1 });
    await sleep(80);
  };
  const context = async (selector, action) => {
    await click(selector, 'right');
    if (action) {
      const point = await evaluate(`const buttons = [...root.querySelectorAll('.mlrt-clipboard-menu button')];
      const item = buttons.find(item => item.dataset.action === ${JSON.stringify(action)} || item.textContent === ${JSON.stringify(action)});
      if (!item) throw new Error('Menu action missing: ' + ${JSON.stringify(action)});
      const rect = item.getBoundingClientRect(); return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });`);
      await liveClient.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
    await sleep(180);
  };

  // Exercise the authoritative host undo history before fixture isolation.
  const original = await state();
  await context('.cm-line');
  const documentMenuNeutral = await evaluate(`const menu = root.querySelector('.mlrt-document-clipboard-menu');
    return JSON.stringify(root.activeElement === menu && getComputedStyle(menu.querySelector('button')).backgroundColor === 'rgba(0, 0, 0, 0)');`);
  assert.equal(documentMenuNeutral, true, 'document menus also open without a highlighted first item');
  await key('Escape');
  await context('.cm-line', 'Insert table (2 × 2)');
  assert.equal((await state()).tables.length, original.tables.length + 1);
  await key('z', process.platform === 'darwin' ? 4 : 2);
  for (let n = 0; n < 40 && (await state()).text !== original.text; n++) await sleep(100);
  assert.equal((await state()).text, original.text, 'inserting a table is one host Undo');
  await click('.mlrt-table-cell');
  await key('Escape');
  await key('a', process.platform === 'darwin' ? 4 : 2);
  await context('.mlrt-table-cell', 'delete-table');
  const hostCleared = await state();
  assert.equal(hostCleared.tables.length, original.tables.length);
  assert.ok(hostCleared.tables[0].rows.flat().every(value => value === ''));
  await key('Delete');
  assert.equal((await state()).tables.length, original.tables.length - 1);
  await key('z', process.platform === 'darwin' ? 4 : 2);
  for (let n = 0; n < 40 && (await state()).text !== hostCleared.text; n++) await sleep(100);
  assert.equal((await state()).text, hostCleared.text, 'first Undo restores the empty table');
  await key('z', process.platform === 'darwin' ? 4 : 2);
  for (let n = 0; n < 40 && (await state()).text !== original.text; n++) await sleep(100);
  assert.equal((await state()).text, original.text, 'second Undo restores the table contents');

  await evaluate(`root.defaultView.__MLRT_TEST_SET_HOST_ISOLATION__(true); return JSON.stringify(true);`);
  let revision = 998000;
  const setup = async text => {
    await evaluate(`root.defaultView.dispatchEvent(new root.defaultView.MessageEvent('message', {
      data: { type: 'setDocument', text: ${JSON.stringify(text)}, revision: ${++revision}, debug: false }
    })); await new Promise(done => root.defaultView.requestAnimationFrame(() => root.defaultView.requestAnimationFrame(done)));
    view.focus(); view.dispatch({ selection: { anchor: 0 } }); view.scrollDOM.scrollTop = 0; return JSON.stringify(true);`);
    await sleep(100);
  };
  const table = '| A | B | C |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n| g | h | i |';
  const twoTables = 'before\n\n| A | B |\n| --- | --- |\n| a | b |\n\n| C | D |\n| --- | --- |\n| c | d |\n\nafter';
  for (const deletionKey of ['Delete', 'Backspace']) {
    await setup(twoTables);
    await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget'); view.focus();
      view.dispatch({ selection: { anchor: Number(wrapper.dataset.srcTo) + 1 } }); return JSON.stringify(true);`);
    await key(deletionKey);
    const result = await state();
    assert.equal(result.tables.length, 1, `${deletionKey} merges adjacent tables`);
    assert.deepEqual(result.tables[0].rows, [['A', 'B'], ['a', 'b'], ['C', 'D'], ['c', 'd']]);
    assert.ok(result.text.startsWith('before\n\n') && result.text.endsWith('\n\nafter'));
    assert.ok(result.active.includes('mlrt-table-cell'), 'caret stays in the merged table');
  }
  await shot('merged');

  for (const deletionKey of ['Delete', 'Backspace']) {
    await setup(twoTables.replace('\n\n| C', '\n\n\n\n| C'));
    await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget'); view.focus();
      view.dispatch({ selection: { anchor: Number(wrapper.dataset.srcTo) + 1 } }); return JSON.stringify(true);`);
    await key(deletionKey);
    assert.equal((await state()).text, twoTables.replace('\n\n| C', '\n\n\n| C'), 'one key removes exactly one blank line');
    await key(deletionKey);
    assert.equal((await state()).text, twoTables, 'second key removes exactly one more blank line');
    await key(deletionKey);
    assert.equal((await state()).tables.length, 1, 'consecutive blank-line deletion eventually merges');
    assert.deepEqual((await state()).tables[0].rows, [['A', 'B'], ['a', 'b'], ['C', 'D'], ['c', 'd']]);
  }
  await setup(twoTables.replace('| C | D |\n| --- | --- |\n| c | d |', '| C | D | E |\n| --- | --- | --- |\n| c | d | e |'));
  await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget'); view.focus();
    view.dispatch({ selection: { anchor: Number(wrapper.dataset.srcTo) + 1 } }); return JSON.stringify(true);`);
  const differentWidth = await state();
  await key('Delete');
  await key('Backspace');
  assert.equal((await state()).text, differentWidth.text, 'different-width tables retain a safe separator');
  assert.equal((await state()).head, differentWidth.head, 'protected boundary keeps the caret in place');
  assert.match((await state()).feedback, /Cannot merge tables.*2 columns.*3/);
  await shot('merge-blocked');

  await setup('before\n\nafter');
  await context('.cm-line', 'Insert table (2 × 2)');
  assert.deepEqual((await state()).tables[0].rows, [['', ''], ['', '']]);
  await shot('inserted');
  assert.ok((await state()).text.startsWith('before\n\n'), 'insertion preserves the clicked paragraph');

  const structureAction = async (kind, row = 0, column = 0, action = `select-${kind}`) => {
    await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget');
      const cell = wrapper.querySelector('.mlrt-table-cell[data-row-kind="${row === 0 ? 'header' : 'body'}"][data-row-index="${Math.max(0, row - 1)}"][data-column="${column}"]');
      const rect = cell.getBoundingClientRect(), tableRect = wrapper.querySelector('table').getBoundingClientRect();
      view.scrollDOM.dispatchEvent(new root.defaultView.MouseEvent('mousemove', { bubbles: true,
        clientX: ${kind === 'column' ? 'rect.left + rect.width / 2' : 'wrapper.getBoundingClientRect().left + 3'},
        clientY: ${kind === 'column' ? 'tableRect.top + 3' : 'rect.top + rect.height / 2'} }));
      await new Promise(done => root.defaultView.requestAnimationFrame(done));
      wrapper.querySelector('.mlrt-table-${kind === 'column' ? 'col' : 'row'}-indicator').click();
      return JSON.stringify(true);`);
    await click(`.mlrt-table-structure-menu [data-action="${action}"]`);
    await sleep(80);
  };
  const selectStructure = (kind, row = 0, column = 0) => structureAction(kind, row, column);
  const cellSelector = (row, column) => `.mlrt-table-cell[data-row-kind="${row === 0 ? 'header' : 'body'}"][data-row-index="${Math.max(0, row - 1)}"][data-column="${column}"]`;
  const menuActions = () => evaluate(`return JSON.stringify([...root.querySelectorAll('.mlrt-clipboard-menu button')].map(button => ({ action: button.dataset.action, label: button.textContent })));`);
  const dragCells = async (from, to) => {
    const points = await evaluate(`return JSON.stringify(${JSON.stringify([from, to])}.map(selector => {
      const rect = root.querySelector(selector).getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }));`);
    await liveClient.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', clickCount: 1 });
    for (let step = 1; step <= 4; step++) await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1,
      x: points[0].x + (points[1].x - points[0].x) * step / 4, y: points[0].y + (points[1].y - points[0].y) * step / 4 });
    await liveClient.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[1], button: 'left', clickCount: 1 });
    await sleep(100);
  };

  const multiTable = '| A | B | C | D |\n| --- | --- | --- | --- |\n| a | b | c | d |\n| e | f | g | h |\n| i | j | k | l |';
  const toggleCell = (row, column) => click(cellSelector(row, column), 'left', 2);
  const toggleAxis = async (kind, index) => {
    await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget');
      const cell = wrapper.querySelector(${JSON.stringify(kind === 'row' ? '.mlrt-table-cell[data-row-kind="body"]' : '.mlrt-table-cell[data-row-kind="header"]')});
      const target = ${kind === 'row' ? `wrapper.querySelector(${JSON.stringify(cellSelector(index, 0))})` : `wrapper.querySelector(${JSON.stringify(cellSelector(0, index))})`};
      const rect = target.getBoundingClientRect(), tableRect = wrapper.querySelector('table').getBoundingClientRect();
      view.scrollDOM.dispatchEvent(new root.defaultView.MouseEvent('mousemove', { bubbles: true, ctrlKey: true,
        clientX: ${kind === 'column' ? 'rect.left + rect.width / 2' : 'wrapper.getBoundingClientRect().left + 3'},
        clientY: ${kind === 'column' ? 'tableRect.top + 3' : 'rect.top + rect.height / 2'} }));
      await new Promise(done => root.defaultView.requestAnimationFrame(done)); return JSON.stringify(true);`);
    await sleep(120); // Let the proximity handle finish its position transition.
    await click(`.mlrt-table-${kind === 'column' ? 'col' : 'row'}-indicator`, 'left', 2);
  };

  // Shared straight edges and reentrant corners must be one continuous stroke.
  const setupOutline = async () => {
    await setup('before\n\n' + multiTable + '\n\nafter');
    // Reusing identical source can preserve the previous table DOM selection.
    await click('.cm-line');
    assert.equal((await state()).selected, 0);
  };
  await setupOutline();
  for (const [row, column] of [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]]) await toggleCell(row, column);
  assert.equal((await state()).selected, 5);
  const steppedOutline = await evaluate(`
    const wrapper = root.querySelector('.mlrt-table-widget');
    const overlay = wrapper.querySelector('.mlrt-table-selection-overlay');
    const frame = overlay.querySelector('.mlrt-table-selection-frame');
    const origin = overlay.getBoundingClientRect();
    const cellRect = (row, column) => wrapper.querySelector('.mlrt-table-cell[data-row-kind="' + (row ? 'body' : 'header') + '"][data-row-index="' + Math.max(0, row - 1) + '"][data-column="' + column + '"]').getBoundingClientRect();
    const a = cellRect(0, 0), b = cellRect(0, 1), c = cellRect(1, 2);
    const strokeAt = (x, y) => frame.isPointInStroke(new root.defaultView.DOMPoint(x - origin.left, y - origin.top));
    const joins = [
      [a.right, a.top + 0.5], [a.left + 0.5, a.bottom],
      [a.right, c.bottom - 1], [b.right, c.bottom - 1],
      [b.right - 0.5, c.top + 0.5], [b.right, c.top + 0.5],
      [c.right - 0.5, c.top + 0.5], [c.right - 0.5, c.bottom - 1],
    ];
    return JSON.stringify({ path: frame.getAttribute('d'), joins: joins.map(([x, y]) => strokeAt(x, y)),
      interiorBlue: strokeAt(a.right, (a.top + a.bottom) / 2) });`);
  assert.equal((steppedOutline.path.match(/M/g) ?? []).length, 1, 'a stepped selection has one perimeter');
  assert.equal((steppedOutline.path.match(/Z/g) ?? []).length, 1, 'the perimeter is a closed contour');
  assert.ok(steppedOutline.joins.every(Boolean), `outline joins leave no gaps: ${JSON.stringify(steppedOutline)}`);
  assert.equal(steppedOutline.interiorBlue, false, 'shared interior rails do not become blue borders');
  await shot('connected-stepped-outline');

  for (const [name, cells, contours] of [
    ['diagonal', [[0, 0], [1, 1]], 2],
    ['hole', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]], 2],
  ]) {
    await setupOutline();
    for (const [row, column] of cells) await toggleCell(row, column);
    assert.equal((await state()).selected, cells.length);
    const path = await evaluate(`return JSON.stringify(root.querySelector('.mlrt-table-selection-frame').getAttribute('d'));`);
    assert.equal((path.match(/M/g) ?? []).length, contours, `${name}: each boundary has its own contour`);
    assert.equal((path.match(/Z/g) ?? []).length, contours, `${name}: all contours close cleanly`);
    await shot('connected-' + name + '-outline');
  }

  await setupOutline();
  await toggleCell(1, 0); await toggleCell(3, 3);
  assert.equal((await state()).selected, 2, 'Ctrl+click selects separate cells without the gap');
  await toggleCell(1, 0); assert.equal((await state()).selected, 1, 'Ctrl+click toggles an existing cell off');
  await toggleCell(1, 0);
  await context(cellSelector(1, 0));
  const menuFocus = await evaluate(`const menu = root.querySelector('.mlrt-clipboard-menu');
    return JSON.stringify({ container: root.activeElement === menu, first: root.activeElement === menu.querySelector('button'),
      color: getComputedStyle(menu.querySelector('button')).backgroundColor });`);
  assert.equal(menuFocus.container, true); assert.equal(menuFocus.first, false);
  assert.equal(menuFocus.color, 'rgba(0, 0, 0, 0)', 'opening a pointer menu does not highlight its first result');
  assert.ok((await menuActions()).some(item => item.label === 'Clear 2 selected cells'));
  await shot('ctrl-cells-menu');
  await key('ArrowDown');
  assert.equal(await evaluate(`return JSON.stringify(root.activeElement === root.querySelector('.mlrt-clipboard-menu button'));`), true, 'keyboard navigation still focuses the first item');
  await click('.mlrt-clipboard-menu [data-action="delete-selection"]');
  assert.deepEqual((await state()).tables[0].rows[2], ['e', 'f', 'g', 'h']);
  assert.deepEqual((await state()).tables[0].rows[1], ['', 'b', 'c', 'd']);
  assert.deepEqual((await state()).tables[0].rows[3], ['i', 'j', 'k', '']);
  await key('Delete');
  assert.equal((await state()).tables[0].rows.length, 4, 'isolated cells never delete their partially selected rows');
  await shot('ctrl-cells-cleared');

  await setup(multiTable);
  await toggleCell(1, 0); await toggleCell(3, 3); await key('Backspace');
  const beforeEdgeMenu = await state();
  await context(cellSelector(1, 0));
  assert.equal((await state()).anchor, beforeEdgeMenu.anchor, 'a menu on a table at the document edge does not bounce the source caret');
  assert.equal((await state()).top, beforeEdgeMenu.top);
  await key('Escape');

  await setup('before\n\n' + multiTable + '\n\nafter');
  await click('.mlrt-table tbody tr:nth-child(1) .mlrt-table-source-line', 'left', 2);
  await click('.mlrt-table tbody tr:nth-child(3) .mlrt-table-source-line', 'left', 2);
  assert.equal((await state()).selected, 8, 'Ctrl+click in the gutter selects separate whole rows');
  await context(cellSelector(1, 0), 'delete-rows');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C', 'D'], ['e', 'f', 'g', 'h']], 'menu deletion also preserves rows in selection gaps');

  await setup('before\n\n' + multiTable + '\n\nafter');
  await toggleAxis('row', 1); await toggleAxis('row', 3);
  assert.equal((await state()).selected, 8);
  await key('Backspace'); await key('Backspace');
  assert.deepEqual((await state()).tables[0].rows[2], ['e', 'f', 'g', 'h']);
  await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C', 'D'], ['e', 'f', 'g', 'h']], 'Delete removes nonadjacent rows once and preserves the middle row');

  await setup('before\n\n' + multiTable + '\n\nafter');
  await toggleAxis('column', 0); await toggleAxis('column', 3);
  assert.equal((await state()).selected, 8);
  await key('Delete'); await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['B', 'C'], ['b', 'c'], ['f', 'g'], ['j', 'k']], 'Delete preserves columns between separate selections');

  await setup('before\n\n' + multiTable + '\n\nafter');
  await toggleCell(2, 2); await toggleAxis('row', 1); await toggleAxis('row', 3);
  await toggleAxis('column', 0); await toggleAxis('column', 3);
  assert.equal((await state()).selected, 13, 'cell/row/column combinations share one exact union');
  await shot('ctrl-mixed-selection');
  await key('Delete'); await key('Backspace');
  assert.deepEqual((await state()).tables[0].rows[2], ['', 'f', '', '']);
  await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['B', 'C'], ['f', '']], 'mixed Delete removes only complete empty axes and preserves other cells');
  await shot('ctrl-mixed-deleted');

  await setup('before\n\n' + multiTable + '\n\n' + multiTable + '\n\nafter');
  await toggleCell(1, 0); await toggleCell(3, 3);
  const copied = await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget');
    const transfer = new root.defaultView.DataTransfer(); wrapper.dispatchEvent(new root.defaultView.ClipboardEvent('cut', { clipboardData: transfer, bubbles: true, cancelable: true }));
    root.defaultView.__MLRT_MULTI_CUT__ = transfer;
    return JSON.stringify(JSON.parse(transfer.getData('application/x-markdown-live-editor+json')));`);
  assert.equal(copied.rows[1][1].text, '', 'sparse copy masks source gaps');
  await click(`.mlrt-table-widget:nth-of-type(2) ${cellSelector(0, 0)}`);
  await key('Escape');
  await evaluate(`const wrappers = root.querySelectorAll('.mlrt-table-widget');
    wrappers[1].dispatchEvent(new root.defaultView.ClipboardEvent('paste', { clipboardData: root.defaultView.__MLRT_MULTI_CUT__, bubbles: true, cancelable: true }));
    return JSON.stringify(true);`);
  await sleep(180);
  assert.deepEqual((await state()).tables[0].rows[2], ['e', 'f', 'g', 'h'], 'moving a multi-selection does not clear source gaps');
  assert.equal((await state()).tables[0].rows[1][0], '');
  assert.equal((await state()).tables[0].rows[3][3], '');

  // Real pointer/menu sequences reproduce the selection bugs missed by programmatic clicks.
  await setup('before\n\n' + table + '\n\nafter');
  await structureAction('row', 1, 0, 'delete-row');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
  assert.equal((await state()).selected, 0);
  await structureAction('row', 1, 0, 'delete-row');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['g', 'h', 'i']], 'consecutive menu deletion targets the next row once');
  assert.equal((await state()).selected, 0);
  await shot('consecutive-menu-deletion');

  await setup('before\n\n' + table + '\n\nafter');
  await structureAction('column', 0, 0, 'delete-column');
  assert.deepEqual((await state()).tables[0].rows, [['B', 'C'], ['b', 'c'], ['e', 'f'], ['h', 'i']]);
  assert.equal((await state()).selected, 0);
  await structureAction('column', 0, 0, 'delete-column');
  assert.deepEqual((await state()).tables[0].rows, [['C'], ['c'], ['f'], ['i']]);
  assert.equal((await state()).selected, 0, 'consecutive column deletion does not leave a structural selection');

  await setup('before\n\n' + table + '\n\nafter');
  await selectStructure('row', 1);
  await key('ArrowDown', 8);
  await context(cellSelector(1, 1));
  assert.ok((await menuActions()).some(item => item.label === 'Delete 2 selected rows'));
  for (const action of ['delete-selection', 'delete-rows', 'delete-columns', 'clear-table', 'delete-table']) {
    assert.ok((await menuActions()).some(item => item.action === action), `row selection retains ${action}`);
  }
  assert.equal((await state()).selected, 6, 'focusing the menu preserves the highlighted rows');
  await shot('selected-rows-menu');
  await click('.mlrt-clipboard-menu [data-action="delete-rows"]');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['g', 'h', 'i']]);
  assert.equal((await state()).selected, 0);

  await setup('before\n\n' + table + '\n\nafter');
  await selectStructure('column', 0, 0);
  await key('ArrowRight', 8);
  await context(cellSelector(1, 1));
  assert.ok((await menuActions()).some(item => item.label === 'Delete 2 selected columns'));
  for (const action of ['delete-selection', 'delete-rows', 'delete-columns', 'clear-table', 'delete-table']) {
    assert.ok((await menuActions()).some(item => item.action === action), `column selection retains ${action}`);
  }
  await shot('selected-columns-menu');
  await click('.mlrt-clipboard-menu [data-action="delete-columns"]');
  assert.deepEqual((await state()).tables[0].rows, [['C'], ['c'], ['f'], ['i']]);
  assert.equal((await state()).selected, 0);

  await setup('before\n\n' + table + '\n\nafter');
  await dragCells(cellSelector(1, 0), cellSelector(2, 2));
  assert.equal((await state()).selected, 6);
  await context(cellSelector(1, 1));
  const cellActions = await menuActions();
  assert.ok(cellActions.some(item => item.label === 'Clear 6 selected cells'));
  assert.ok(cellActions.some(item => item.action === 'delete-rows') && cellActions.some(item => item.action === 'delete-columns'), 'explicit row/column actions remain available');
  await shot('selected-cells-menu');
  await click('.mlrt-clipboard-menu [data-action="delete-selection"]');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['', '', ''], ['', '', ''], ['g', 'h', 'i']]);
  await context(cellSelector(3, 1), 'delete-selection');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['', '', ''], ['', '', ''], ['g', '', 'i']], 'right-click outside the selection targets only that cell');

  await setup('before\n\n' + table + '\n\nafter');
  await selectStructure('row', 1);
  await key('ArrowDown', 8);
  await structureAction('row', 3, 0, 'delete-row');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['a', 'b', 'c'], ['d', 'e', 'f']], 'an outside handle targets its own row');
  assert.equal((await state()).selected, 0);

  await setup('before\n\n' + table + '\n\nafter');
  await context('.mlrt-table tbody tr:nth-child(2) .mlrt-table-source-line');
  assert.ok((await menuActions()).some(item => item.action === 'delete-rows' && item.label === 'Delete row'), 'gutter right-click opens table row actions');
  assert.ok(!(await menuActions()).some(item => item.label?.startsWith('Insert table')));
  await click('.mlrt-clipboard-menu [data-action="delete-rows"]');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['a', 'b', 'c'], ['g', 'h', 'i']]);

  await setup('before\n\n' + table.replace('| a |', '| alpha beta |') + '\n\nafter');
  await evaluate(`const cell = root.querySelector(${JSON.stringify(cellSelector(1, 0))}); cell.focus();
    const range = root.createRange(); range.setStart(cell.firstChild, 0); range.setEnd(cell.firstChild, 5);
    const selection = root.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range); return JSON.stringify(true);`);
  await context(cellSelector(1, 0));
  assert.ok((await menuActions()).some(item => item.action === 'delete-text'));
  assert.ok(!(await menuActions()).some(item => ['delete-rows', 'delete-columns', 'delete-table'].includes(item.action)));
  await click('.mlrt-clipboard-menu [data-action="delete-text"]');
  assert.equal((await state()).tables[0].rows[1][0], 'beta', 'native text deletion removes just the highlighted substring');

  // Keyboard intent is independent of gesture: Backspace only clears; Delete removes empty full spans.
  for (const [name, first, last, afterRemoval] of [
    ['dragged-rows', cellSelector(1, 0), cellSelector(2, 2), [['A', 'B', 'C'], ['g', 'h', 'i']]],
    ['dragged-columns', cellSelector(0, 0), cellSelector(3, 1), [['C'], ['c'], ['f'], ['i']]],
    ['whole-table', cellSelector(0, 0), cellSelector(3, 2), null],
  ]) {
    await setup('before\n\n' + table + '\n\nafter');
    await dragCells(first, last);
    await key('Backspace');
    const cleared = await state();
    assert.equal(cleared.tables[0].rows.length, 4, `${name}: Backspace preserves rows`);
    assert.equal(cleared.tables[0].rows[0].length, 3, `${name}: Backspace preserves columns`);
    await key('Backspace');
    await key('Backspace');
    assert.equal((await state()).text, cleared.text, `${name}: repeated Backspace does not remove structure or change source`);
    await shot(`${name}-backspace`);
    await key('Delete');
    if (afterRemoval) assert.deepEqual((await state()).tables[0].rows, afterRemoval, `${name}: Delete immediately removes the empty selection`);
    else assert.equal((await state()).tables.length, 0, `${name}: only Delete removes the table`);
  }

  for (const method of ['handle', 'drag']) {
    await setup('before\n\n' + table.replace('| a | b | c |', '|  |  |  |') + '\n\nafter');
    if (method === 'handle') await selectStructure('row', 1);
    else await dragCells(cellSelector(1, 0), cellSelector(1, 2));
    await key('Delete');
    assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['d', 'e', 'f'], ['g', 'h', 'i']], `${method}: pre-existing empty row deletes on the first Delete`);
    const emptyColumn = table.split('\n').map((line, index) => index === 1 ? line : line.replace(/^\|[^|]*\|/, '|  |')).join('\n');
    await setup('before\n\n' + emptyColumn + '\n\nafter');
    if (method === 'handle') await selectStructure('column', 0, 0);
    else await dragCells(cellSelector(0, 0), cellSelector(3, 0));
    await key('Delete');
    assert.deepEqual((await state()).tables[0].rows, [['B', 'C'], ['b', 'c'], ['e', 'f'], ['h', 'i']], `${method}: pre-existing empty column deletes on the first Delete`);
  }

  await setup('before\n\n' + table + '\n\nafter');
  await selectStructure('row', 1);
  await key('ArrowDown', 8);
  await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['', '', ''], ['', '', ''], ['g', 'h', 'i']]);
  await shot('rows-cleared');
  await key('Backspace');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['', '', ''], ['', '', ''], ['g', 'h', 'i']], 'Backspace does not remove empty rows');
  await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['g', 'h', 'i']]);
  assert.equal((await state()).selected, 0, 'removing rows does not select the next row');

  const longText = Array.from({ length: 100 }, (_, n) => `prefix ${n}`).join('\n') + '\n\n' + table + '\n\n' + 'after\n'.repeat(100);
  await setup(longText);
  await evaluate(`view.scrollDOM.scrollTop = 101 * view.defaultLineHeight - 200;
    await new Promise(done => root.defaultView.requestAnimationFrame(() => root.defaultView.requestAnimationFrame(done)));
    root.defaultView.__MLRT_DELETE_SCROLLS__ = [];
    view.scrollDOM.addEventListener('scroll', () => root.defaultView.__MLRT_DELETE_SCROLLS__.push(view.scrollDOM.scrollTop));
    return JSON.stringify(true);`);
  await selectStructure('column', 0, 0);
  await key('ArrowRight', 8);
  const beforeColumns = await state();
  await key('Delete');
  const clearedColumns = await state();
  assert.deepEqual(clearedColumns.tables[0].rows, [['', '', 'C'], ['', '', 'c'], ['', '', 'f'], ['', '', 'i']]);
  assert.ok(Math.abs(clearedColumns.top - beforeColumns.top) <= 1, 'clearing columns preserves scroll');
  await key('Backspace');
  assert.deepEqual((await state()).tables[0].rows, clearedColumns.tables[0].rows, 'Backspace does not remove empty columns');
  await key('Delete');
  const removedColumns = await state();
  assert.deepEqual(removedColumns.tables[0].rows, [['C'], ['c'], ['f'], ['i']]);
  assert.ok(Math.abs(removedColumns.top - beforeColumns.top) <= 1, 'removing columns preserves scroll');
  const scrolls = await evaluate(`return JSON.stringify(root.defaultView.__MLRT_DELETE_SCROLLS__);`);
  assert.ok(scrolls.every(top => Math.abs(top - beforeColumns.top) <= 1), `no transient scroll jumps: ${scrolls}`);
  await shot('columns-removed');

  // A partial cell rectangle only clears cells, even after repeated Delete.
  await setup('before\n\n' + table + '\n\nafter');
  await context('.mlrt-table-cell[data-row-kind="body"][data-row-index="0"][data-column="0"]');
  await evaluate(`root.querySelector('.mlrt-clipboard-menu').dispatchEvent(new root.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return JSON.stringify(true);`);
  await key('ArrowDown', 8);
  await key('ArrowRight', 8);
  await key('Delete');
  await key('Backspace');
  await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['A', 'B', 'C'], ['', '', 'c'], ['', '', 'f'], ['g', 'h', 'i']]);
  await key('a', process.platform === 'darwin' ? 4 : 2);
  await key('Delete');
  assert.deepEqual((await state()).tables[0].rows, [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']]);
  await shot('table-cleared');
  await key('Delete');
  assert.equal((await state()).tables.length, 0, 'second Delete removes the selected table');
  assert.ok((await state()).text.includes('before') && (await state()).text.includes('after'));

  await setup('before\n\n' + table + '\n\nafter');
  await evaluate(`const wrapper = root.querySelector('.mlrt-table-widget'); view.focus();
    view.dispatch({ selection: { anchor: Number(wrapper.dataset.srcFrom), head: Number(wrapper.dataset.srcTo) } }); return JSON.stringify(true);`);
  await key('Delete');
  assert.equal((await state()).tables.length, 1, 'document table selection clears before removing');
  const emptyDocumentTable = await state();
  await key('Backspace');
  await key('Backspace');
  assert.equal((await state()).text, emptyDocumentTable.text, 'document table selection also preserves empty tables on Backspace');
  await key('Delete');
  assert.equal((await state()).tables.length, 0);

  console.log('TABLE DELETION CHECK: merge via Delete/Backspace, 2x2 insertion + host Undo, multi-row/column clear/remove, stable scroll, cell-only clear, full-table clear/remove, document selection passed.');
}
