import assert from "node:assert/strict";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import {
  canonicalTableCellValue,
  formatMarkdownCell,
  formatTableCellSourceEdit,
  getCellPaddingWhitespace,
  markdownCellToDisplayText,
  parseMarkdownTables,
  ParsedTable,
  rowToDisplayValues,
  TableCellSourceEdit,
} from "../shared/tableModel";
import {
  allowTableSourceChange,
  createTableSourceChangeFilter,
  recentBlockedTableEdits,
  tableEditIntent,
  TableEditIntent,
  validateTableEditIntent,
} from "../shared/tableSourceProtection";
import { joinTablesAcrossDeletion } from "../shared/tableStructureEdits";
import { getTrackedTables, tableTrackingField } from "../editor/table/tableTracking";

const backslash = "\\";
// The guard reports blocked edits on the console; keep the test output quiet.
const warnings: string[] = [];
console.warn = (message: unknown) => { warnings.push(String(message)); };
const grid = (table: ParsedTable): string[][] =>
  [table.header, ...table.body].map((row) => rowToDisplayValues(row, table.columnCount));

// --- Cell encoding ---------------------------------------------------------

// An escaped pipe revealed by the cell editor is written back unchanged.
// Previously `\|` became `\&#124;`, which renders a literal "&#124;".
assert.equal(formatMarkdownCell(`a ${backslash}| b`), `a ${backslash}| b`);
assert.equal(formatMarkdownCell("a | b"), "a &#124; b");
assert.equal(formatMarkdownCell(`a${backslash}${backslash}|b`), `a${backslash}${backslash}&#124;b`,
  "a pipe after an even backslash run is bare and must be encoded");
assert.equal(markdownCellToDisplayText(formatMarkdownCell(`x ${backslash}| y`)), `x ${backslash}| y`);

// Horizontal trimming drops typed edge spaces but keeps deliberate breaks.
assert.equal(formatMarkdownCell("abc  ", { trim: "horizontal" }), "abc");
assert.equal(formatMarkdownCell("\tabc", { trim: "horizontal" }), "abc");
assert.equal(formatMarkdownCell("abc\n", { trim: "horizontal" }), "abc<br>");
assert.equal(formatMarkdownCell("\nabc", { trim: "horizontal" }), "<br>abc");
assert.equal(canonicalTableCellValue("abc "), "abc");
assert.equal(canonicalTableCellValue("a\nb"), "a\nb");
assert.equal(canonicalTableCellValue("a | b"), "a | b");
for (const value of ["", "plain", "with | pipe", "line\nbreak", "trailing break\n", `esc ${backslash}| pipe`,
  "ends with slash\\", "😀 emoji", "non-breaking space", "<br>literal"]) {
  const encoded = formatMarkdownCell(value, { trim: "horizontal" });
  assert.ok(!encoded.includes("\n"), `encoded cell stays on one line: ${JSON.stringify(value)}`);
  assert.equal(canonicalTableCellValue(markdownCellToDisplayText(encoded)), markdownCellToDisplayText(encoded),
    `canonical form is stable: ${JSON.stringify(value)}`);
}

// Typing at the end of a cell, one keystroke at a time and always against a
// fresh parse (as the live editor does), must never grow the cell padding.
{
  let source = "| A | B |\n| --- | --- |\n| one | The new tips are installed. |";
  let value = "The new tips are installed.";
  for (const character of " Edited once.") {
    value += character;
    const table = parseMarkdownTables(source)[0];
    const edit = formatTableCellSourceEdit(table.body[0], table.columnCount, 1, value, { trim: "horizontal" });
    source = source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
  }
  const table = parseMarkdownTables(source)[0];
  assert.equal(rowToDisplayValues(table.body[0], 2)[1], "The new tips are installed. Edited once.");
  assert.deepEqual(getCellPaddingWhitespace(table.body[0].cells[1].raw),
    { leadingWhitespace: " ", trailingWhitespace: " " }, "padding is unchanged after typing spaces");
}

// A ragged row is padded without rewriting its existing cells.
{
  const source = `| A | B | C |\n| --- | --- | --- |\n| a<br/>b |`;
  const table = parseMarkdownTables(source)[0];
  const edit = formatTableCellSourceEdit(table.body[0], table.columnCount, 2, "z", { trim: "horizontal" });
  const result = parseMarkdownTables(source.slice(0, edit.from) + edit.insert + source.slice(edit.to))[0];
  assert.equal(result.body[0].cells[0].raw, " a<br/>b ", "existing raw cell source is preserved");
  assert.deepEqual(grid(result)[1], ["a\nb", "", "z"]);
}

// --- Table identity tracking ------------------------------------------------

const twoTables = [
  "intro",
  "",
  "| A | B |",
  "| --- | --- |",
  "| a | b |",
  "",
  "| C | D |",
  "| --- | --- |",
  "| c | d |",
  "",
  "outro",
].join("\n");

function trackedIds(state: EditorState): number[] {
  return getTrackedTables(state).map((entry) => entry.id);
}

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [tableTrackingField] });
}

{
  const state = makeState(twoTables);
  const [first, second] = trackedIds(state);
  assert.notEqual(first, second);
  const tables = getTrackedTables(state);

  // Typing inside the first table keeps both identities.
  const cellEnd = tables[0].table.body[0].cells[0].end;
  const typed = state.update({ changes: { from: cellEnd - 1, insert: "xyz" } }).state;
  assert.deepEqual(trackedIds(typed), [first, second]);
  assert.equal(getTrackedTables(typed)[1].table.from, tables[1].table.from + 3,
    "the second table's offsets are re-derived from the new document");

  // Text inserted directly before a table moves it but keeps its identity.
  const before = state.update({ changes: { from: tables[0].table.from, insert: "lead\n\n" } }).state;
  assert.deepEqual(trackedIds(before), [first, second]);

  // Deleting the first table never hands its identity to the second.
  const deleted = state.update({ changes: { from: tables[0].table.from, to: tables[1].table.from } }).state;
  assert.deepEqual(trackedIds(deleted), [second]);

  // A newly inserted table gets a fresh identity; neighbours keep theirs.
  const inserted = state.update({
    changes: { from: tables[1].table.from, insert: "| N |\n| --- |\n| n |\n\n" },
  }).state;
  const insertedIds = trackedIds(inserted);
  assert.equal(insertedIds.length, 3);
  assert.equal(insertedIds[0], first);
  assert.equal(insertedIds[2], second);
  assert.ok(!([first, second] as number[]).includes(insertedIds[1]));

  // Splitting a table: the leading part keeps the identity.
  const split = state.update({ changes: { from: tables[0].table.delimiter.to, insert: "\n" } }).state;
  assert.equal(trackedIds(split)[0], first);

  // Merging two tables leaves exactly one tracked table.
  const merged = makeState(twoTables.replace("| a | b |\n\n| C", "| a | b |\n| C"));
  assert.equal(trackedIds(merged).length, 1);
}

// --- Transaction guard -------------------------------------------------------

function apply(doc: string, change: TableCellSourceEdit | TableCellSourceEdit[], intent?: TableEditIntent): string {
  const state = EditorState.create({ doc, extensions: [createTableSourceChangeFilter()] });
  const edits = Array.isArray(change) ? change : [change];
  if (edits.some((edit) => edit.to > doc.length)) {
    // CodeMirror itself rejects offsets past the end of the document.
    return doc;
  }
  return state.update({
    changes: change,
    annotations: [allowTableSourceChange.of(true), ...(intent ? [tableEditIntent.of(intent)] : [])],
  }).newDoc.toString();
}

{
  const doc = twoTables;
  const [first, second] = parseMarkdownTables(doc);
  const cell = first.body[0].cells[1];
  const valid = formatTableCellSourceEdit(first.body[0], first.columnCount, 1, "B value", { trim: "horizontal" });
  const intent: TableEditIntent = { kind: "cell", tableFrom: first.from, row: 1, column: 1 };
  assert.equal(validateTableEditIntent(Text.of(doc.split("\n")), ChangeSet.of(valid, doc.length), intent), null);
  assert.equal(grid(parseMarkdownTables(apply(doc, valid, intent))[0])[1][1], "B value");

  // Offsets that are off by even one character are refused outright.
  const shifted = { from: cell.start + 1, to: cell.end + 1, insert: valid.insert };
  assert.equal(apply(doc, shifted, intent), doc, "misaligned cell edit is blocked");
  assert.match(recentBlockedTableEdits().at(-1)!.reason, /not the declared cell/);

  // A stale edit computed for the second table before the first one grew.
  const grown = apply(doc, formatTableCellSourceEdit(first.body[0], 2, 0, "a much longer value", { trim: "horizontal" }),
    { kind: "cell", tableFrom: first.from, row: 1, column: 0 });
  const staleEdit = formatTableCellSourceEdit(second.body[0], 2, 1, "stale", { trim: "horizontal" });
  assert.equal(apply(grown, staleEdit, { kind: "cell", tableFrom: second.from, row: 1, column: 1 }), grown,
    "an edit addressed with pre-edit offsets cannot land");

  // Text that would add a cell or break the row is refused.
  assert.equal(apply(doc, { from: cell.start, to: cell.end, insert: " x | y " }, intent), doc);
  assert.equal(apply(doc, { from: cell.start, to: cell.end, insert: " x\ny " }, intent), doc);
  // A different cell than the one declared is refused.
  const other = first.body[0].cells[0];
  assert.equal(apply(doc, { from: other.start, to: other.end, insert: " z " }, intent), doc);

  // Structural edits must stay inside the declared table.
  const tablesIntent: TableEditIntent = { kind: "tables", tableFroms: [first.from] };
  assert.equal(apply(doc, { from: first.from, to: first.to, insert: "| A |\n| --- |" }, tablesIntent),
    doc.replace("| A | B |\n| --- | --- |\n| a | b |", "| A |\n| --- |"));
  assert.equal(apply(doc, { from: first.from, to: first.to + 3, insert: "" }, tablesIntent), doc,
    "a structural edit that reaches past its table is blocked");

  // Merging needs both tables and the explicit spanning claim.
  const mergeDoc = twoTables.replace("| a | b |\n\n| C", "| a | b |\n\n| C");
  const blankLine = mergeDoc.indexOf("\n\n| C") + 1;
  const join = joinTablesAcrossDeletion(Text.of(mergeDoc.split("\n")), parseMarkdownTables(mergeDoc), blankLine, blankLine + 1)!;
  assert.ok(join);
  assert.equal(apply(mergeDoc, join.edit, { kind: "tables", tableFroms: [join.table.from, join.merged.from] }), mergeDoc,
    "a merge without the spanning claim is blocked");
  const mergedDoc = apply(mergeDoc, join.edit, { kind: "tables", tableFroms: [join.table.from, join.merged.from], spanning: true });
  assert.deepEqual(grid(parseMarkdownTables(mergedDoc)[0]), [["A", "B"], ["a", "b"], ["C", "D"], ["c", "d"]]);
}

// --- Fuzz: fresh writes always land, stale writes never corrupt --------------

{
  let seed = 7;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const values = ["", "x", "longer text here", "with | pipe", "two\nlines", "trailing ", " leading", `esc ${backslash}| pipe`, "😀"];
  const section = (n: number): string => [
    `Heading ${n}`,
    "",
    `| K${n} | V${n} | C${n} |`,
    "| --- | --- | --- |",
    `| r1 | v1 | c1 |`,
    `| r2 | v2 | c2 |`,
    "",
  ].join("\n");
  for (let round = 0; round < 40; round++) {
    let doc = [section(1), section(2), section(3), section(4)].join("\n");
    const shadow = parseMarkdownTables(doc).map(grid);
    let previous = doc;
    for (let step = 0; step < 60; step++) {
      const tables = parseMarkdownTables(doc);
      const tableIndex = Math.floor(random() * tables.length);
      const table = tables[tableIndex];
      const row = Math.floor(random() * (table.body.length + 1));
      const column = Math.floor(random() * table.columnCount);
      const value = pick(values);
      const sourceRow = row === 0 ? table.header : table.body[row - 1];
      const intent: TableEditIntent = { kind: "cell", tableFrom: table.from, row, column };
      if (random() < 0.25) {
        // Replay an edit computed from the previous document version.
        const staleTables = parseMarkdownTables(previous);
        const staleTable = staleTables[tableIndex];
        const staleRow = row === 0 ? staleTable.header : staleTable.body[row - 1];
        const stale = formatTableCellSourceEdit(staleRow, staleTable.columnCount, column, value, { trim: "horizontal" });
        const result = apply(doc, stale, { kind: "cell", tableFrom: staleTable.from, row, column });
        const resultTables = parseMarkdownTables(result);
        assert.equal(resultTables.length, shadow.length, "a stale edit never changes the table count");
        resultTables.forEach((candidate, index) => {
          const expected = shadow[index].map((cells) => [...cells]);
          if (result !== doc && index === tableIndex) expected[row][column] = canonicalTableCellValue(value);
          assert.deepEqual(grid(candidate), expected, "a stale edit lands in its declared cell or nowhere");
        });
        if (result !== doc) {
          shadow[tableIndex][row][column] = canonicalTableCellValue(value);
          previous = doc;
          doc = result;
        }
        continue;
      }
      const edit = formatTableCellSourceEdit(sourceRow, table.columnCount, column, value, { trim: "horizontal" });
      const result = apply(doc, edit, intent);
      shadow[tableIndex][row][column] = canonicalTableCellValue(value);
      if (doc.slice(edit.from, edit.to) !== edit.insert) {
        assert.notEqual(result, doc, "a fresh edit is never blocked");
      }
      previous = doc;
      doc = result;
      assert.deepEqual(parseMarkdownTables(doc).map(grid), shadow, `round ${round} step ${step}`);
    }
    assert.ok(doc.includes("Heading 4"), "prose outside the tables survives");
  }
}

assert.ok(warnings.every((warning) => warning.startsWith("Markdown Live Editor blocked a table edit")));
console.log(`Table integrity guard, identity tracking, and cell encoding tests passed (${warnings.length} stale or invalid edits blocked)`);
