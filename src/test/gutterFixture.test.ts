import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ParsedRow,
  parseMarkdownTables,
  rowToDisplayValues,
} from "../shared/tableModel";

const fixturePath = path.resolve(__dirname, "..", "..", "GutterStressTest.md");
const fixture = fs
  .readFileSync(fixturePath, "utf8")
  .replace(/\r\n?/g, "\n")
  .replace(/\n$/, "");
const sourceLines = fixture.split("\n");
const tables = parseMarkdownTables(fixture);

assert.ok(
  sourceLines.length >= 10_000,
  "gutter fixture must remain a five-digit deep-scroll document",
);
assert.ok(tables.length >= 100, "gutter fixture must retain broad table coverage");

// A bracketed case ID at the start of a source row is the fixture's explicit
// promise that the row is a live-table header. Comparing source promises with
// parser output prevents cases from silently becoming prose while the fixture
// still looks superficially comprehensive.
const promisedIds = sourceLines
  .map((line) => /^\s*\|?\s*\[(G[A-Z]\d{3,4})\]/.exec(line)?.[1])
  .filter((id): id is string => Boolean(id));
const parsedIds = tables.map((table) => {
  const firstHeader = rowToDisplayValues(table.header, table.columnCount)[0];
  const match = /^\[(G[A-Z]\d{3,4})\]/.exec(firstHeader);
  assert.ok(
    match,
    `every parsed table must have a bracketed fixture ID; got ${JSON.stringify(firstHeader)}`,
  );
  return match[1];
});

assert.equal(new Set(promisedIds).size, promisedIds.length, "promised case IDs must be unique");
assert.equal(new Set(parsedIds).size, parsedIds.length, "parsed case IDs must be unique");
assert.deepEqual(parsedIds, promisedIds, "every promised case must parse once and in source order");
assert.equal(
  parsedIds.some((id) => id.startsWith("NEG")),
  false,
  "negative controls must never become live tables",
);

const lineStarts: number[] = [];
let lineStart = 0;
for (const line of sourceLines) {
  lineStarts.push(lineStart);
  lineStart += line.length + 1;
}

function assertRowSourceMapping(row: ParsedRow): void {
  assert.equal(row.from, lineStarts[row.lineIndex]);
  assert.equal(row.to, lineStarts[row.lineIndex] + sourceLines[row.lineIndex].length);
  assert.equal(row.text, sourceLines[row.lineIndex]);
}

let previousEndLine = -1;
for (const table of tables) {
  assert.ok(table.startLine > previousEndLine, "live tables must not overlap");
  assert.equal(table.header.lineIndex, table.startLine);
  assert.equal(
    table.delimiter.lineIndex,
    table.header.lineIndex + 1,
    "the hidden delimiter must consume exactly one source line",
  );
  assertRowSourceMapping(table.header);
  assertRowSourceMapping(table.delimiter);

  table.body.forEach((row, index) => {
    assert.equal(
      row.lineIndex,
      table.header.lineIndex + index + 2,
      "rendered body gutter rows must map consecutively after the hidden delimiter",
    );
    assertRowSourceMapping(row);
  });

  const finalRow = table.body.at(-1) ?? table.delimiter;
  assert.equal(table.endLine, finalRow.lineIndex);
  previousEndLine = table.endLine;
}

function tableById(id: string) {
  const index = parsedIds.indexOf(id);
  assert.notEqual(index, -1, `missing required gutter case ${id}`);
  return tables[index];
}

assert.equal(tableById("GB099").startLine + 1, 99);
assert.equal(tableById("GB099").delimiter.lineIndex + 1, 100);
assert.equal(tableById("GB099").body[0].lineIndex + 1, 101);

const thousandBoundary = tableById("GB995");
assert.equal(thousandBoundary.startLine + 1, 995);
assert.equal(thousandBoundary.delimiter.lineIndex + 1, 996);
assert.equal(thousandBoundary.body.length, 60);
assert.ok(
  thousandBoundary.body.some((row) => row.lineIndex + 1 === 999),
  "the long table must own source line 999",
);
assert.ok(
  thousandBoundary.body.some((row) => row.lineIndex + 1 === 1_000),
  "the long table must own source line 1000",
);

const secondBoundary = tableById("GB1995");
assert.equal(secondBoundary.startLine + 1, 1_995);
assert.equal(secondBoundary.body[3].lineIndex + 1, 2_000);

const fiveDigitBoundary = tableById("GB9995");
assert.equal(fiveDigitBoundary.startLine + 1, 9_995);
assert.equal(fiveDigitBoundary.delimiter.lineIndex + 1, 9_996);
assert.deepEqual(
  fiveDigitBoundary.body.map((row) => row.lineIndex + 1),
  [9_997, 9_998, 9_999, 10_000],
  "the rendered table must own both sides of the 9,999/10,000 boundary",
);
assert.equal(
  sourceLines[fiveDigitBoundary.endLine + 1],
  "GB9995-AFTER: the first prose gutter number after the table must be 10001.",
);

assert.equal(tableById("GS006").columnCount, 1, "single-column coverage disappeared");
assert.equal(tableById("GS007").body.length, 0, "header-only coverage disappeared");
assert.ok(tableById("GS034").columnCount >= 24, "wide-table coverage disappeared");
assert.ok(tableById("GS026").body.length >= 3, "tall-row coverage disappeared");
assert.ok(tableById("GS033").body.length >= 24, "many-row coverage disappeared");
assert.ok(tableById("GV002").columnCount >= 20, "deep wide-table coverage disappeared");

for (const [prefix, minimum] of [
  ["GS", 40],
  ["GM", 40],
  ["GC", 4],
  ["GE", 12],
  ["GV", 3],
] as const) {
  assert.ok(
    parsedIds.filter((id) => id.startsWith(prefix)).length >= minimum,
    `${prefix} coverage fell below ${minimum} cases`,
  );
}

const eofTable = tableById("GF999");
assert.equal(
  eofTable.endLine,
  sourceLines.length - 1,
  "the EOF table's final body row must remain the fixture's final source line",
);

console.log(
  `Gutter fixture contract passed: ${sourceLines.length} lines, ${tables.length} live tables.`,
);
