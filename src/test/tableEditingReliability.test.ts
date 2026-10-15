import assert from "node:assert/strict";
import {
  formatMarkdownCell,
  formatTableCellSourceEdit,
  markdownCellToDisplayText,
  parseMarkdownTables,
  rowToDisplayValues,
} from "../shared/tableModel";
import {
  deleteTableColumnEdit,
  deleteTableRowEdit,
  insertTableColumnEdit,
  insertTableRowEdit,
  joinTablesAcrossDeletion,
} from "../shared/tableStructureEdits";
import { classifyTableSelection, planTableDeletion, tableStructureSelection } from "../shared/tableDeletion";
import { Text } from "@codemirror/state";
import { inspectTableCellSet, planTableCellSetDeletion, rectangleCells, toggleSelectedCells } from "../shared/tableSelectionSet";
import { buildGridPasteEdit, tableRectanglePayload } from "../shared/clipboardModel";

interface ShadowTable {
  header: string[];
  body: string[][];
}

interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}

const prefix = "RELIABILITY_PREFIX\n\n";
const suffix = "\n\nRELIABILITY_SUFFIX";
const initialHeader = ["Key", "Value", "Notes"];
const initialBody = [
  ["row 0", "alpha", "keep 0"],
  ["row 1", "beta", "keep 1"],
  ["row 2", "gamma", "keep 2"],
];
const bodyValuePool = [
  "",
  "plain",
  "with | pipe",
  "line\nbreak",
  "😀",
  "👩‍💻",
  "🇺🇸",
  "e\u0301",
  "ends with slash\\",
  "two slashes\\\\",
  "---",
  ":---:",
  "<br>literal",
  "non-breaking\u00a0space",
];
const headerValuePool = bodyValuePool;

for (let seed = 1; seed <= 40; seed++) {
  let randomState = seed >>> 0;
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  const integer = (limit: number): number => Math.floor(random() * limit);

  let source = `${prefix}| ${initialHeader.join(" | ")} |\n| --- | --- | --- |\n${initialBody
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n")}${suffix}`;
  const shadow: ShadowTable = {
    header: [...initialHeader],
    body: initialBody.map((row) => [...row]),
  };

  for (let step = 0; step < 250; step++) {
    const table = parseMarkdownTables(source)[0];
    assert.ok(table, `seed ${seed} step ${step}: table disappeared before edit`);
    const operation = integer(5);

    if (operation === 0 || shadow.body.length === 0) {
      const editHeader = shadow.body.length === 0 || integer(5) === 0;
      const rowIndex = editHeader ? -1 : integer(shadow.body.length);
      const column = integer(shadow.header.length);
      const pool = editHeader ? headerValuePool : bodyValuePool;
      const input = `${pool[integer(pool.length)]}${step % 7 === 0 ? ` ${seed}:${step}` : ""}`;
      const sourceRow = editHeader ? table.header : table.body[rowIndex];
      source = applyEdit(
        source,
        formatTableCellSourceEdit(
          sourceRow,
          table.columnCount,
          column,
          input,
        ),
      );
      const expected = displayValueAfterCellFormat(input);
      if (editHeader) {
        shadow.header[column] = expected;
      } else {
        shadow.body[rowIndex][column] = expected;
      }
    } else if (operation === 1 && shadow.body.length < 8) {
      const rowIndex = integer(shadow.body.length + 1);
      source = applyEdit(source, insertTableRowEdit(table, rowIndex));
      shadow.body.splice(
        rowIndex,
        0,
        Array.from({ length: shadow.header.length }, () => ""),
      );
    } else if (operation === 2 && shadow.body.length > 0) {
      const rowIndex = integer(shadow.body.length);
      source = applyEdit(source, deleteTableRowEdit(table, rowIndex));
      shadow.body.splice(rowIndex, 1);
    } else if (operation === 3 && shadow.header.length < 7) {
      const column = integer(shadow.header.length + 1);
      source = applyEdit(source, insertTableColumnEdit(table, column));
      shadow.header.splice(column, 0, "");
      shadow.body.forEach((row) => row.splice(column, 0, ""));
    } else if (shadow.header.length > 1) {
      const column = integer(shadow.header.length);
      source = applyEdit(source, deleteTableColumnEdit(table, column));
      shadow.header.splice(column, 1);
      shadow.body.forEach((row) => row.splice(column, 1));
    }

    assertTableMatchesShadow(source, shadow, seed, step);
  }
}

function applyEdit(source: string, edit: SourceEdit | null): string {
  assert.ok(edit, "expected a valid table edit");
  return `${source.slice(0, edit.from)}${edit.insert}${source.slice(edit.to)}`;
}

function displayValueAfterCellFormat(value: string): string {
  return markdownCellToDisplayText(formatMarkdownCell(value));
}

function assertTableMatchesShadow(
  source: string,
  shadow: ShadowTable,
  seed: number,
  step: number,
): void {
  const label = `seed ${seed} step ${step}`;
  assert.ok(source.startsWith(prefix), `${label}: prefix changed`);
  assert.ok(source.endsWith(suffix), `${label}: suffix changed`);
  assert.equal(hasUnpairedSurrogate(source), false, `${label}: invalid Unicode`);

  const tables = parseMarkdownTables(source);
  assert.equal(tables.length, 1, `${label}: expected one parseable table`);
  const table = tables[0];
  assert.equal(table.columnCount, shadow.header.length, `${label}: columns`);
  assert.equal(table.body.length, shadow.body.length, `${label}: rows`);
  assert.deepEqual(
    rowToDisplayValues(table.header, table.columnCount),
    shadow.header,
    `${label}: header values`,
  );
  assert.deepEqual(
    table.body.map((row) => rowToDisplayValues(row, table.columnCount)),
    shadow.body,
    `${label}: body values`,
  );
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

console.log("10,000-operation table editing reliability fuzz passed");

// Structural deletion is a content-clear followed by removal, in one edit per step.
for (const separator of ["\n", "\r\n"]) {
  const original = ["before", "", "| A | B | C |", "| :--- | ---: | --- |",
    "| a | b | c |", "| d | e | f |", "| g | h | i |", "", "after"].join(separator);
  const first = parseMarkdownTables(original)[0];
  const selectedRows = { top: 1, bottom: 2, left: 0, right: 2 };
  assert.equal(classifyTableSelection(first, selectedRows, "cells"), "rows", "full-width rectangles are rows regardless of selection gesture");
  assert.equal(classifyTableSelection(first, selectedRows, "rows"), "rows");
  assert.deepEqual(tableStructureSelection(first, "rows", 1, { rectangle: selectedRows, kind: "cells" }),
    selectedRows, "row handles recognize a dragged selection of complete rows");
  assert.deepEqual(tableStructureSelection(first, "rows", 3, { rectangle: selectedRows, kind: "rows" }),
    { top: 3, bottom: 3, left: 0, right: 2 }, "a handle outside a selection targets only its own row");
  const immediate = planTableDeletion(first, selectedRows, "rows", "remove");
  assert.equal(immediate.removed, true);
  assert.deepEqual(parseMarkdownTables(applyEdit(original, immediate.edit))[0].body.map(row => rowToDisplayValues(row, 3)), [["g", "h", "i"]]);
  const full = { top: 0, bottom: 3, left: 0, right: 2 };
  for (const [kind, rectangle] of [
    ["cells", full],
    ["rows", { top: 1, bottom: 2, left: 0, right: 2 }],
    ["columns", { top: 0, bottom: 3, left: 0, right: 1 }],
  ] as const) {
    const clear = planTableDeletion(first, rectangle, kind);
    assert.equal(clear.removed, false);
    const clearedSource = applyEdit(original, clear.edit);
    const clearedTable = parseMarkdownTables(clearedSource)[0];
    assert.equal(clearedTable.columnCount, 3);
    assert.equal(clearedTable.body.length, 3);
    for (let press = 0; press < 3; press++) {
      const backspace = planTableDeletion(clearedTable, rectangle, kind, "clear");
      assert.equal(backspace.removed, false, "Backspace never removes table structure");
      assert.equal(applyEdit(clearedSource, backspace.edit), clearedSource, "Backspace on an empty selection stays a no-op");
    }
    const remove = planTableDeletion(clearedTable, rectangle, kind);
    assert.equal(remove.removed, true);
    const nextSource = applyEdit(clearedSource, remove.edit);
    assert.ok(nextSource.startsWith(`before${separator}${separator}`));
    assert.ok(nextSource.endsWith(`${separator}${separator}after`));
    const nextTable = parseMarkdownTables(nextSource)[0];
    if (kind === "cells") assert.equal(nextTable, undefined);
    else if (kind === "rows") assert.deepEqual(nextTable.body.map(row => rowToDisplayValues(row, 3)), [["g", "h", "i"]]);
    else assert.deepEqual(rowToDisplayValues(nextTable.header, 1), ["C"]);
  }
  // A partial cell rectangle stays a content-only operation after repeated Delete.
  const partial = { top: 1, bottom: 2, left: 0, right: 1 };
  const cleared = applyEdit(original, planTableDeletion(first, partial).edit);
  assert.equal(planTableDeletion(parseMarkdownTables(cleared)[0], partial).removed, false);
  for (const [rectangle, expectedKind] of [
    [{ top: 1, bottom: 2, left: 0, right: 2 }, "rows"],
    [{ top: 0, bottom: 3, left: 0, right: 1 }, "columns"],
  ] as const) {
    const clear = planTableDeletion(first, rectangle, "cells", "clear");
    const empty = parseMarkdownTables(applyEdit(original, clear.edit))[0];
    assert.equal(classifyTableSelection(empty, rectangle), expectedKind);
    assert.equal(planTableDeletion(empty, rectangle).removed, true, "Delete immediately removes an already-empty dragged row/column selection");
  }
  const headerClear = planTableDeletion(first, { top: 0, bottom: 0, left: 0, right: 2 }, "rows");
  const withoutHeader = applyEdit(applyEdit(original, headerClear.edit), planTableDeletion(
    parseMarkdownTables(applyEdit(original, headerClear.edit))[0], { top: 0, bottom: 0, left: 0, right: 2 }, "rows").edit);
  assert.deepEqual(rowToDisplayValues(parseMarkdownTables(withoutHeader)[0].header, 3), ["a", "b", "c"]);
}

for (const key of ["Delete", "Backspace"]) {
  const source = "prefix\n\n| A | B |\n| --- | --- |\n| a | b |\n\n| C | D |\n| --- | --- |\n| c | d |\n\nsuffix";
  const tables = parseMarkdownTables(source);
  const caret = tables[0].to + 1;
  const join = joinTablesAcrossDeletion(Text.of(source.split("\n")), tables,
    key === "Delete" ? caret : caret - 1, key === "Delete" ? caret + 1 : caret);
  assert.ok(join);
  const joined = applyEdit(source, join.edit);
  assert.equal(parseMarkdownTables(joined).length, 1);
  assert.deepEqual(parseMarkdownTables(joined)[0].body.map(row => rowToDisplayValues(row, 2)), [["a", "b"], ["C", "D"], ["c", "d"]]);
  assert.ok(joined.startsWith("prefix\n\n"));
  assert.ok(joined.endsWith("\n\nsuffix"));
}
console.log("Two-step table/row/column deletion and table merge regressions passed");

const multiSource = "| A | B | C | D |\n| --- | --- | --- | --- |\n| a | b | c | d |\n| e | f | g | h |\n| i | j | k | l |";
const multiTable = parseMarkdownTables(multiSource)[0];
let cells = [{ row: 2, column: 2 }];
for (const row of [1, 3]) cells = toggleSelectedCells(cells, rectangleCells({ top: row, bottom: row, left: 0, right: 3 }));
for (const column of [0, 3]) cells = toggleSelectedCells(cells, rectangleCells({ top: 0, bottom: 3, left: column, right: column }));
assert.deepEqual(inspectTableCellSet(multiTable, cells).fullRows, [1, 3]);
assert.deepEqual(inspectTableCellSet(multiTable, cells).fullColumns, [0, 3]);
const multiClear = planTableCellSetDeletion(multiTable, cells, "clear-first");
assert.equal(multiClear.removed, false);
const multiClearedSource = applyEdit(multiSource, multiClear.edit);
const multiCleared = parseMarkdownTables(multiClearedSource)[0];
assert.deepEqual(rowToDisplayValues(multiCleared.body[1], 4), ["", "f", "", ""]);
assert.equal(planTableCellSetDeletion(multiCleared, cells, "clear").removed, false);
const multiDelete = planTableCellSetDeletion(multiCleared, cells, "clear-first");
assert.equal(multiDelete.removed, true);
const multiResult = parseMarkdownTables(applyEdit(multiClearedSource, multiDelete.edit))[0];
assert.deepEqual([multiResult.header, ...multiResult.body].map(row => rowToDisplayValues(row, 2)), [["B", "C"], ["f", ""]]);
const diagonal = [{ row: 1, column: 0 }, { row: 3, column: 3 }];
const diagonalClear = planTableCellSetDeletion(multiTable, diagonal, "clear");
assert.deepEqual(rowToDisplayValues(parseMarkdownTables(applyEdit(multiSource, diagonalClear.edit))[0].body[1], 4), ["e", "f", "g", "h"]);
assert.equal(planTableCellSetDeletion(multiTable, diagonal, "remove").removed, false);
assert.deepEqual(toggleSelectedCells(diagonal, [diagonal[0]]), [diagonal[1]]);
const sparseCopy = tableRectanglePayload(multiTable, { top: 0, bottom: 3, left: 0, right: 3 }, "test", undefined, diagonal);
assert.equal(sparseCopy.exactMarkdown, undefined);
assert.equal(sparseCopy.rows[1][0].text, "a");
assert.equal(sparseCopy.rows[2][1].text, "", "copy never exposes cells in selection gaps");
const sparsePaste = buildGridPasteEdit(multiTable, { rows: [[{ text: "x" }, { text: "y" }], [{ text: "z" }, { text: "w" }]],
  destination: { top: 1, bottom: 2, left: 1, right: 2 }, destinationCells: [{ row: 1, column: 1 }, { row: 2, column: 2 }] });
const pastedTable = parseMarkdownTables(applyEdit(multiSource, sparsePaste))[0];
assert.deepEqual(rowToDisplayValues(pastedTable.body[0], 4), ["a", "x", "c", "d"]);
assert.deepEqual(rowToDisplayValues(pastedTable.body[1], 4), ["e", "f", "w", "h"]);
console.log("Disjoint and mixed table selection, exact clearing, deletion, copy and paste tests passed");
