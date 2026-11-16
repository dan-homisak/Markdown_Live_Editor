import assert from "node:assert/strict";
import {
  compareFindPositions,
  compileFindQuery,
  createFindScan,
  expandFindReplacement,
  findInText,
  FindLocation,
  findLocationEnd,
  findLocationStart,
  FindOptions,
  nextFindIndex,
  planFindSegments,
  planReplaceAll,
  planReplaceAt,
  previousFindIndex,
  ReplacePlan,
  UsableFindQuery,
} from "../shared/findModel";
import { parseMarkdownTables, parseMarkdownTableRow } from "../shared/tableModel";

const plain: FindOptions = { matchCase: false, wholeWord: false, regex: false };
const docOf = (text: string) => ({ length: text.length, sliceString: (from: number, to: number) => text.slice(from, to), toString: () => text });
const compile = (text: string, options: Partial<FindOptions> = {}): UsableFindQuery => {
  const compiled = compileFindQuery(text, { ...plain, ...options });
  assert.equal(compiled.ok, true, `query ${JSON.stringify(text)} compiles`);
  return compiled as UsableFindQuery;
};
const spans = (text: string, query: UsableFindQuery, options?: { limit?: number; allowEmpty?: boolean }): string[] =>
  findInText(text, query, options).map(match => `${match.from}-${match.to}`);
const scanAll = (text: string, query: UsableFindQuery, limit?: number): FindLocation[] => {
  const scan = createFindScan(docOf(text), parseMarkdownTables(text), query, limit);
  assert.equal(scan.run(), true, "an unpaused scan finishes");
  return scan.matches;
};
/** Applies a plan the way the editor does: every edit against the same document. */
const applyPlan = (text: string, plan: ReplacePlan): string => {
  const edits = [...plan.prose, ...plan.cells.map(cell => cell.edit)].sort((left, right) => right.from - left.from);
  let result = text;
  for (const edit of edits) result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  return result;
};

// --- Compiling a query ---------------------------------------------------------

{
  assert.deepEqual(compileFindQuery("", plain), { ok: false, reason: "empty" }, "an empty query finds nothing");
  const invalid = compileFindQuery("(unclosed", { ...plain, regex: true });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok === false && invalid.reason, "invalid", "a bad pattern is reported, not thrown");
  assert.ok(invalid.ok === false && invalid.reason === "invalid" && invalid.message.length > 0);
  assert.equal(compileFindQuery("(unclosed", plain).ok, true, "the same text is fine as a literal");
}

// Literal text is never read as a pattern, whatever punctuation it holds.
{
  const text = "a.b a*b **bold [link](x) a|b a\\b a-b {x} a+b? ^$";
  for (const literal of ["a.b", "**", "](", "a|b", "a\\b", "a-b", "{x}", "a+b?", "^$", "[link]"]) {
    const found = findInText(text, compile(literal));
    assert.equal(found.length, 1, `${literal} is found once`);
    assert.equal(text.slice(found[0].from, found[0].to), literal);
  }
  assert.deepEqual(spans("axb a.b", compile("a.b")), ["4-7"], "a dot matches only a dot");
}

// Case.
{
  const text = "Tracker tracker TRACKER";
  assert.deepEqual(spans(text, compile("tracker")), ["0-7", "8-15", "16-23"], "case is ignored by default");
  assert.deepEqual(spans(text, compile("tracker", { matchCase: true })), ["8-15"]);
  assert.deepEqual(spans("ÉCOLE école", compile("école")), ["0-5", "6-11"], "case folding is Unicode-aware");
}

// Whole word: the characters around a match decide, as in the stock editor.
{
  const text = "cat concat cat_ cat. (cat) catalog";
  assert.deepEqual(spans(text, compile("cat", { wholeWord: true })), ["0-3", "16-19", "22-25"]);
  assert.deepEqual(spans("café caf", compile("caf", { wholeWord: true })), ["5-8"], "an accented letter is a word character");
  assert.deepEqual(spans("a-b a-bc", compile("a-b", { wholeWord: true })), ["0-3"]);
  assert.deepEqual(spans("x ** y**z", compile("**", { wholeWord: true })), ["2-4", "6-8"],
    "a query of punctuation has no word edge to check");
  assert.deepEqual(spans("one two", compile("\\w+", { regex: true, wholeWord: true })), ["0-3", "4-7"]);
}

// Regular expressions, line anchors and matches that span lines.
{
  const text = "id 12 and 345\nnext 6";
  assert.deepEqual(spans(text, compile("\\d+", { regex: true })), ["3-5", "10-13", "19-20"]);
  assert.deepEqual(spans(text, compile("^\\w+", { regex: true })), ["0-2", "14-18"], "^ matches at every line start");
  assert.deepEqual(spans(text, compile("\\d+$", { regex: true })), ["10-13", "19-20"], "$ matches at every line end");
  assert.deepEqual(spans("a\nb a\nb", compile("a\\nb", { regex: true })), ["0-3", "4-7"], "a pattern may span lines");
  assert.deepEqual(spans("a\nb", compile("a.b", { regex: true })), [], "a dot does not match a line break");
  assert.deepEqual(spans("one\ntwo one\ntwo", compile("one\ntwo")), ["0-7", "8-15"], "literal text may span lines");
  assert.deepEqual(spans("one\ntwo", compile("one\r\ntwo")), ["0-7"], "a pasted CRLF query matches LF text");
}

// Empty matches are found only where the caller allows them, and never loop.
{
  const text = "ab\ncd";
  assert.deepEqual(spans(text, compile("^", { regex: true }), { allowEmpty: true }), ["0-0", "3-3"]);
  assert.deepEqual(spans(text, compile("^", { regex: true })), [], "empty matches are skipped by default");
  assert.deepEqual(spans("aXbX", compile("X*", { regex: true }), { allowEmpty: true }), ["0-0", "1-2", "2-2", "3-4", "4-4"]);
  assert.deepEqual(spans("😀a", compile("(?:)", { regex: true }), { allowEmpty: true }), ["0-0", "2-2", "3-3"],
    "an empty match never lands inside a surrogate pair");
}

// Overlap and the limit.
{
  assert.deepEqual(spans("aaaa", compile("aa")), ["0-2", "2-4"], "matches do not overlap");
  assert.deepEqual(spans("a a a a a", compile("a"), { limit: 3 }), ["0-1", "2-3", "4-5"]);
}

// --- The search domain -----------------------------------------------------------

const mixed = [
  "Alpha beta.",                    // 0-11
  "",
  "| Name | Note |",
  "| --- | --- |",
  "| beta | one<br>two |",
  "| a &#124; b |  |",
  "",
  "Gamma beta.",
].join("\n");

{
  const tables = parseMarkdownTables(mixed);
  assert.equal(tables.length, 1);
  const segments = planFindSegments(docOf(mixed), tables);
  const table = tables[0];
  const described = segments.map(segment => segment.kind === "prose"
    ? `prose:${JSON.stringify(mixed.slice(segment.from, segment.to))}`
    : `cell:${segment.row},${segment.column}:${JSON.stringify(segment.value)}`);
  assert.deepEqual(described, [
    'prose:"Alpha beta.\\n"',
    'cell:0,0:"Name"',
    'cell:0,1:"Note"',
    'cell:1,0:"beta"',
    'cell:1,1:"one\\ntwo"',
    'cell:2,0:"a | b"',
    'prose:"\\nGamma beta."',
  ], "prose around the table, then its cells in row order, as edited text; empty cells and the delimiter row are left out");
  const prose = segments.filter(segment => segment.kind === "prose");
  assert.equal(prose[0].to, table.from - 1, "the line break that separates prose from a table is not searched");
  assert.equal(prose[1].from, table.to + 1, "nor is the one that ends the table");
  for (const segment of segments) {
    if (segment.kind === "cell") {
      assert.equal(segment.tableFrom, table.from);
      assert.ok(segment.cellFrom > table.from && segment.cellFrom < table.to);
    }
  }
}

// A table at the very start or the very end leaves no stray prose segment.
{
  const text = "| a |\n| --- |\n| b |";
  assert.deepEqual(planFindSegments(docOf(text), parseMarkdownTables(text)).map(segment => segment.kind), ["cell", "cell"]);
  const trailing = `${text}\n`;
  const segments = planFindSegments(docOf(trailing), parseMarkdownTables(trailing));
  assert.deepEqual(segments.map(segment => segment.kind), ["cell", "cell", "prose"]);
  assert.deepEqual(segments[2], { kind: "prose", from: trailing.length, to: trailing.length }, "the empty last line is prose");
  assert.deepEqual(planFindSegments(docOf(""), []), [{ kind: "prose", from: 0, to: 0 }]);
  assert.deepEqual(planFindSegments(docOf("plain"), []), [{ kind: "prose", from: 0, to: 5 }]);
}

// --- Scanning a document ---------------------------------------------------------

{
  const matches = scanAll(mixed, compile("beta"));
  assert.deepEqual(matches.map(match => match.kind), ["prose", "cell", "prose"], "matches come in document order");
  const [first, cell, last] = matches;
  assert.equal(mixed.slice(first.from, first.to), "beta");
  assert.ok(cell.kind === "cell" && cell.row === 1 && cell.column === 0 && cell.from === 0 && cell.to === 4,
    "a cell match is addressed by cell and by offsets in the cell's text");
  assert.equal(mixed.slice(last.from, last.to), "beta");
  assert.ok(first.from < (cell.kind === "cell" ? cell.cellFrom : -1) && (cell.kind === "cell" ? cell.cellFrom : Infinity) < last.from);
}

// Table structure is not searched, and nothing matches across cells.
{
  assert.deepEqual(scanAll(mixed, compile("---")), [], "the delimiter row is not searched");
  assert.deepEqual(scanAll(mixed, compile("Name | Note")), [], "no match spans two cells");
  assert.deepEqual(scanAll(mixed, compile("<br>")), [], "a cell is searched as edited text, where <br> is a line break");
  const pipes = scanAll(mixed, compile("|"));
  assert.equal(pipes.length, 1, "only a pipe that is cell text is found");
  assert.ok(pipes[0].kind === "cell" && pipes[0].row === 2 && pipes[0].from === 2);
  const breaks = scanAll(mixed, compile("one\\ntwo", { regex: true }));
  assert.equal(breaks.length, 1);
  assert.ok(breaks[0].kind === "cell" && breaks[0].row === 1 && breaks[0].column === 1);
  assert.deepEqual(scanAll(mixed, compile("^", { regex: true })).map(match => match.kind),
    ["prose", "prose", "prose", "prose"], "empty matches are prose only: one per prose line, blank ones included");
  assert.deepEqual(scanAll(mixed, compile("\\n\\n", { regex: true })), [],
    "a prose match cannot take the line break that belongs to a table");
}

// A scan can be paused and resumed, and stops at its limit.
{
  const text = Array.from({ length: 400 }, (_, index) => `line ${index} word`).join("\n");
  const whole = scanAll(text, compile("word"));
  assert.equal(whole.length, 400);
  const scan = createFindScan(docOf(text), [], compile("word"));
  let asked = 0;
  assert.equal(scan.run(() => ++asked > 0), false, "a scan asked to pause stops before it is done");
  assert.equal(scan.done, false);
  assert.ok(scan.matches.length < 400);
  let rounds = 0;
  while (!scan.run(() => true)) assert.ok(++rounds < 1000, "a paused scan still makes progress each round");
  assert.deepEqual(scan.matches, whole, "a resumed scan finds what an unpaused one finds");
  assert.equal(scan.truncated, false);
  const limited = createFindScan(docOf(text), [], compile("word"), 25);
  assert.equal(limited.run(), true);
  assert.equal(limited.matches.length, 25);
  assert.equal(limited.truncated, true);
  const exact = createFindScan(docOf("word word"), [], compile("word"), 2);
  exact.run();
  assert.equal(exact.truncated, false, "reaching the limit exactly is not a truncation");
}

// A long single-line literal scan is cut into pieces without losing matches.
{
  const line = `${"x".repeat(90)} needle`;
  const text = Array.from({ length: 6000 }, () => line).join("\n");
  const scan = createFindScan(docOf(text), [], compile("needle"), 100000);
  let pauses = 0;
  while (!scan.run(() => { pauses++; return true; })) { /* resumed */ }
  assert.equal(scan.matches.length, 6000);
  assert.ok(pauses > 2, "a document with no tables still offers places to pause");
  assert.ok(scan.matches.every(match => text.slice(match.from, match.to) === "needle"));
}

// --- Moving between matches --------------------------------------------------------

{
  const matches = scanAll(mixed, compile("beta"));
  assert.ok(compareFindPositions([1, 0], [2, 0]) < 0 && compareFindPositions([2, 5], [2, 1]) > 0 && compareFindPositions([3, 3], [3, 3]) === 0);
  assert.equal(nextFindIndex(matches, [0, 0]), 0);
  assert.equal(nextFindIndex(matches, findLocationStart(matches[0])), 0, "a match that starts at the position is the next one");
  assert.equal(nextFindIndex(matches, findLocationEnd(matches[0])), 1, "from the end of a match the next one follows");
  assert.equal(nextFindIndex(matches, findLocationEnd(matches[1])), 2);
  assert.equal(nextFindIndex(matches, findLocationEnd(matches[2])), 0, "next wraps to the first match");
  assert.equal(previousFindIndex(matches, findLocationStart(matches[2])), 1);
  assert.equal(previousFindIndex(matches, findLocationStart(matches[1])), 0);
  assert.equal(previousFindIndex(matches, findLocationStart(matches[0])), 2, "previous wraps to the last match");
  assert.equal(nextFindIndex([], [0, 0]), -1);
  assert.equal(previousFindIndex([], [0, 0]), -1);
}

// --- Replacement text ------------------------------------------------------------

{
  const match = ["2026-11", "2026", "11"];
  assert.equal(expandFindReplacement("$2/$1 $& $0 $$ $3", true, match), "11/2026 2026-11 2026-11 $ $3",
    "groups, the whole match and a literal dollar; a group that does not exist stays as written");
  assert.equal(expandFindReplacement("a\\nb\\tc\\\\d", true, match), "a\nb\tc\\d", "escapes for a line break, a tab and a backslash");
  assert.equal(expandFindReplacement("$1 \\n $&", false, match), "$1 \\n $&", "a literal replacement is used as written");
  assert.equal(expandFindReplacement("$10", true, ["x", "A"]), "A0", "a second digit is a group only when that group exists");
  assert.equal(expandFindReplacement("[$1]", true, ["x", undefined]), "[]", "a group that did not take part is empty");
}

// --- Planning a replace ----------------------------------------------------------

{
  const tables = parseMarkdownTables(mixed);
  const plan = planReplaceAll(docOf(mixed), tables, compile("beta"), "delta");
  assert.equal(plan.refused, null);
  assert.equal(plan.count, 3);
  assert.equal(plan.prose.length, 2);
  assert.equal(plan.cells.length, 1);
  assert.equal(applyPlan(mixed, plan), mixed.replaceAll("beta", "delta"));
  assert.ok(plan.prose[0].from < plan.prose[1].from, "prose changes are in document order");
  const cell = plan.cells[0];
  assert.deepEqual([cell.row, cell.column, cell.value], [1, 0, "delta"]);
  assert.equal(mixed.slice(cell.edit.from, cell.edit.to), " beta ", "a cell edit replaces exactly the cell's source");
  assert.equal(cell.edit.insert, " delta ", "and keeps its padding");
}

// A replacement that would break a row is encoded the way typing it would be.
{
  const tables = parseMarkdownTables(mixed);
  const piped = planReplaceAll(docOf(mixed), tables, compile("beta", { matchCase: true }), "x | y");
  assert.equal(piped.refused, null);
  const after = applyPlan(mixed, piped);
  assert.ok(after.includes("| x &#124; y | one<br>two |"), "a pipe in a cell is written as an entity");
  assert.ok(after.includes("Alpha x | y."), "and as itself in prose");
  const reparsed = parseMarkdownTables(after);
  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].columnCount, 2);
  assert.equal(reparsed[0].body.length, 2);

  const broken = planReplaceAll(docOf(mixed), tables, compile("(one)\\n(two)", { regex: true }), "$2\\n$1\\nthree");
  assert.equal(broken.count, 1);
  assert.equal(broken.cells[0].value, "two\none\nthree");
  assert.ok(applyPlan(mixed, broken).includes("| beta | two<br>one<br>three |"), "a line break in a cell is written as <br>");
  for (const planned of [...piped.cells, ...broken.cells]) {
    assert.ok(!/[\r\n]/.test(planned.edit.insert), "a cell edit is one line");
  }
  const row = tables[0].body[0];
  const edit = piped.cells[0].edit;
  const rowAfter = mixed.slice(row.from, edit.from) + edit.insert + mixed.slice(edit.to, row.to);
  assert.equal(parseMarkdownTableRow(row.lineIndex, row.from, rowAfter).cells.length, row.cells.length, "the row keeps its cells");
}

// Two cells of one row, a regular expression with groups, and no-op replacements.
{
  const text = "| k1 | k2 |\n| --- | --- |\n| k3 | plain |\n\nk4 and K5";
  const tables = parseMarkdownTables(text);
  const plan = planReplaceAll(docOf(text), tables, compile("k(\\d)", { regex: true }), "<$1>");
  assert.equal(plan.count, 5);
  assert.equal(applyPlan(text, plan), "| <1> | <2> |\n| --- | --- |\n| <3> | plain |\n\n<4> and <5>");
  const same = planReplaceAll(docOf(text), tables, compile("k1", { matchCase: true }), "k1");
  assert.deepEqual([same.count, same.prose.length, same.cells.length], [0, 0, 0], "a replacement that changes nothing is no edit");
  const literal = planReplaceAll(docOf(text), tables, compile("k4"), "$1\\n");
  assert.equal(applyPlan(text, literal), text.replace("k4", "$1\\n"), "a literal replacement is not expanded");
}

// Empty matches can be replaced in prose: every prose line gets a prefix, table rows do not.
{
  const text = "one\ntwo\n\n| a |\n| --- |\n| b |\n\nthree";
  const plan = planReplaceAll(docOf(text), parseMarkdownTables(text), compile("^(?=.)", { regex: true }), "> ");
  assert.equal(applyPlan(text, plan), "> one\n> two\n\n| a |\n| --- |\n| b |\n\n> three");
  assert.equal(plan.cells.length, 0);
}

// Replacing one match: the location must still be a match of the query.
{
  const tables = parseMarkdownTables(mixed);
  const matches = scanAll(mixed, compile("beta"));
  const prose = planReplaceAt(docOf(mixed), tables, compile("beta"), "B", matches[0]);
  assert.ok(prose && prose.count === 1 && prose.prose.length === 1 && prose.cells.length === 0);
  assert.equal(applyPlan(mixed, prose!), mixed.replace("beta", "B"));
  const cell = planReplaceAt(docOf(mixed), tables, compile("beta"), "B", matches[1]);
  assert.ok(cell && cell.count === 1 && cell.prose.length === 0 && cell.cells.length === 1);
  assert.ok(applyPlan(mixed, cell!).includes("| B | one<br>two |"));
  const grouped = planReplaceAt(docOf(mixed), tables, compile("(b)(eta)", { regex: true }), "$2$1", matches[2]);
  assert.equal(applyPlan(mixed, grouped!), mixed.replace("Gamma beta", "Gamma etab"));

  const shifted: FindLocation = { kind: "prose", from: matches[0].from + 1, to: matches[0].to + 1 };
  assert.equal(planReplaceAt(docOf(mixed), tables, compile("beta"), "B", shifted), null, "a stale location replaces nothing");
  const wrongCell: FindLocation = { kind: "cell", tableFrom: tables[0].from, row: 1, column: 1, cellFrom: 0, from: 0, to: 4 };
  assert.equal(planReplaceAt(docOf(mixed), tables, compile("beta"), "B", wrongCell), null);
  const noTable: FindLocation = { kind: "cell", tableFrom: 999, row: 1, column: 0, cellFrom: 0, from: 0, to: 4 };
  assert.equal(planReplaceAt(docOf(mixed), tables, compile("beta"), "B", noTable), null);
}

// Whole-word and case options carry into a replace.
{
  const text = "cat concat Cat";
  const plan = planReplaceAll(docOf(text), [], compile("cat", { wholeWord: true, matchCase: true }), "dog");
  assert.equal(applyPlan(text, plan), "dog concat Cat");
}

console.log("findModel tests passed");
