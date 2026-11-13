import assert from "node:assert/strict";
import {
  MAX_TABLE_RESIZE_DELAY_MS,
  normalizeTableResizeDelay,
  tableResizeHeld,
  tableResizeHoldKey,
} from "../shared/tableResizeDelay";

// --- The setting's value ------------------------------------------------------

assert.equal(normalizeTableResizeDelay(0), 0);
assert.equal(normalizeTableResizeDelay(750), 750);
assert.equal(normalizeTableResizeDelay(749.6), 750, "a whole number of milliseconds");
assert.equal(normalizeTableResizeDelay(-20), 0, "never negative");
assert.equal(normalizeTableResizeDelay(60_000), MAX_TABLE_RESIZE_DELAY_MS, "capped");
assert.equal(normalizeTableResizeDelay("500"), 0, "only numbers are accepted");
assert.equal(normalizeTableResizeDelay(undefined), 0);
assert.equal(normalizeTableResizeDelay(Number.NaN), 0);
assert.equal(normalizeTableResizeDelay(undefined, 300), 300, "the fallback is used for a missing value");

// --- When the widths are held -------------------------------------------------

const layout = { columnCount: 3, rowCount: 4, availableWidthCh: 96.04, cell: { rowKind: "body", rowIndex: 1, column: 2 } };
const key = tableResizeHoldKey(layout);
const hold = { until: 1000, key };

assert.equal(tableResizeHeld(hold, 400, key), true, "typing in the same cell before the delay has run");
assert.equal(tableResizeHeld(hold, 1000, key), false, "the delay has run");
assert.equal(tableResizeHeld(undefined, 400, key), false, "nothing is held");
assert.equal(tableResizeHeld(hold, 400, null), false, "no cell is being edited");

// Anything but the typed text releases the widths at once.
assert.equal(tableResizeHeld(hold, 400, tableResizeHoldKey({ ...layout, cell: { ...layout.cell, column: 1 } })), false,
  "another cell has the caret");
assert.equal(tableResizeHeld(hold, 400, tableResizeHoldKey({ ...layout, cell: { ...layout.cell, rowKind: "header" } })), false);
assert.equal(tableResizeHeld(hold, 400, tableResizeHoldKey({ ...layout, columnCount: 4 })), false, "a column was added");
assert.equal(tableResizeHeld(hold, 400, tableResizeHoldKey({ ...layout, rowCount: 5 })), false, "a row was added");
assert.equal(tableResizeHeld(hold, 400, tableResizeHoldKey({ ...layout, availableWidthCh: 80 })), false,
  "the editor was resized");
assert.equal(tableResizeHeld(hold, 400, tableResizeHoldKey({ ...layout, availableWidthCh: 96.01 })), true,
  "sub-character jitter in the measured width is not a resize");
assert.equal(tableResizeHeld({ until: 1000, key: tableResizeHoldKey({ ...layout, availableWidthCh: undefined }) }, 400,
  tableResizeHoldKey({ ...layout, availableWidthCh: undefined })), true, "an editor with no measurable width still holds");

console.log("Table resize delay tests passed");
