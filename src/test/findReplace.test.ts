import assert from "node:assert/strict";
import { EditorState, Transaction } from "@codemirror/state";
import { planReplaceTransactions, REPLACE_USER_EVENT } from "../editor/find/findReplace";
import { FieldHistory } from "../editor/find/findWidget";
import { compileFindQuery, FindOptions, planReplaceAll, planReplaceAt, ReplacePlan, UsableFindQuery } from "../shared/findModel";
import { getParsedTables, parseMarkdownTables } from "../shared/tableModel";
import { createTableSourceChangeFilter, recentBlockedTableEdits, tableEditIntent } from "../shared/tableSourceProtection";

const compile = (text: string, options: Partial<FindOptions> = {}): UsableFindQuery => {
  const compiled = compileFindQuery(text, { matchCase: false, wholeWord: false, regex: false, ...options });
  assert.equal(compiled.ok, true);
  return compiled as UsableFindQuery;
};
// The editor's own table guard judges every transaction built here.
const stateOf = (text: string): EditorState => EditorState.create({ doc: text, extensions: createTableSourceChangeFilter() });
/** The plan's edits applied straight to the text: what the transactions must add up to. */
const reference = (text: string, plan: ReplacePlan): string => {
  let result = text;
  for (const edit of [...plan.prose, ...plan.cells.map(cell => cell.edit)].sort((left, right) => right.from - left.from)) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
};
const replaceAll = (text: string, query: UsableFindQuery, template: string) => {
  const state = stateOf(text);
  const plan = planReplaceAll(state.doc, getParsedTables(state.doc), query, template);
  return { state, plan, planned: planReplaceTransactions(state, plan) };
};
const written = (transactions: readonly Transaction[]): string => transactions[transactions.length - 1].state.doc.toString();
const blockedBefore = recentBlockedTableEdits().length;

const mixed = [
  "Alpha beta.",
  "",
  "| Name | Note |",
  "| --- | --- |",
  "| beta | one |",
  "",
  "Between beta.",
  "",
  "| beta | beta |",
  "| --- | --- |",
  "| x | y |",
  "",
  "Last beta.",
].join("\n");

// --- Prose alone, and one cell alone ---------------------------------------------------

{
  const { state, plan, planned } = replaceAll("beta and Beta", compile("beta"), "delta");
  assert.ok(planned.ok);
  assert.equal(planned.transactions.length, 1, "prose alone is one transaction");
  assert.equal(written(planned.transactions), "delta and delta");
  assert.equal(planned.transactions[0].annotation(Transaction.userEvent), REPLACE_USER_EVENT);
  assert.equal(planned.transactions[0].annotation(tableEditIntent), undefined, "an edit outside tables declares no table");
  assert.equal(planned.transactions[0].startState, state);
  assert.equal(plan.count, 2);
}

{
  const text = "| a | b |\n| --- | --- |\n| beta | c |";
  const { planned } = replaceAll(text, compile("beta"), "x|y");
  assert.ok(planned.ok);
  assert.equal(planned.transactions.length, 1);
  assert.deepEqual(planned.transactions[0].annotation(tableEditIntent), { kind: "cell", tableFrom: 0, row: 1, column: 0 },
    "one cell is declared as that cell, which the guard checks down to the row's cell count");
  assert.equal(written(planned.transactions), "| a | b |\n| --- | --- |\n| x&#124;y | c |");
}

// --- Prose and tables together -----------------------------------------------------------

{
  // Longer replacements before each table move every later position.
  const { state, plan, planned } = replaceAll(mixed, compile("beta"), "much longer text");
  assert.ok(planned.ok);
  const [prose, tables] = planned.transactions;
  assert.equal(planned.transactions.length, 2, "prose and tables are two transactions");
  assert.equal(tables.startState, prose.state, "the second built on the state the first produces");
  assert.equal(written(planned.transactions), reference(mixed, plan), "together they write exactly the plan");
  assert.equal(written(planned.transactions), mixed.replaceAll("beta", "much longer text"));
  const intent = tables.annotation(tableEditIntent);
  assert.ok(intent && intent.kind === "tables", "several cells are declared by their tables");
  assert.deepEqual(intent.kind === "tables" && [...intent.tableFroms].sort((left, right) => left - right),
    getParsedTables(prose.state.doc).map(table => table.from),
    "at the positions the tables have once the prose changes are in");
  // What the editor publishes for one update is the composition of its transactions.
  assert.equal(prose.changes.compose(tables.changes).apply(state.doc).toString(), written(planned.transactions),
    "as one change set against the original document, it is the same edit");
  assert.equal(parseMarkdownTables(written(planned.transactions)).length, 2);
}

{
  // One cell with prose: the stricter declaration, at the cell's moved position.
  const text = "beta first\n\n| beta | keep |\n| --- | --- |\n| x | y |";
  const state = stateOf(text);
  const query = compile("beta", { matchCase: true });
  const plan = planReplaceAll(state.doc, getParsedTables(state.doc), query, "B");
  const planned = planReplaceTransactions(state, plan);
  assert.ok(planned.ok);
  assert.equal(planned.transactions.length, 2);
  const moved = getParsedTables(planned.transactions[0].state.doc)[0].from;
  assert.deepEqual(planned.transactions[1].annotation(tableEditIntent), { kind: "cell", tableFrom: moved, row: 0, column: 0 });
  assert.equal(written(planned.transactions), "B first\n\n| B | keep |\n| --- | --- |\n| x | y |");

  const one = planReplaceAt(state.doc, getParsedTables(state.doc), query, "B",
    { kind: "cell", tableFrom: 12, row: 0, column: 0, cellFrom: 13, from: 0, to: 4 });
  assert.ok(one);
  const single = planReplaceTransactions(state, one!);
  assert.ok(single.ok);
  assert.equal(written(single.transactions), "beta first\n\n| B | keep |\n| --- | --- |\n| x | y |", "replace one in a cell");
}

// --- The edges of tables -------------------------------------------------------------------

{
  // An insertion on every prose line, the blank ones beside a table included.
  const text = "one\n\n| a |\n| --- |\n| b |\n\ntwo";
  const { plan, planned } = replaceAll(text, compile("^", { regex: true }), "> ");
  assert.ok(planned.ok, "insertions beside a table pass the guard");
  assert.equal(written(planned.transactions), "> one\n> \n| a |\n| --- |\n| b |\n> \n> two");
  assert.equal(written(planned.transactions), reference(text, plan));
  assert.equal(plan.cells.length, 0);

  const ends = replaceAll(text, compile("$", { regex: true }), "!");
  assert.ok(ends.planned.ok);
  assert.equal(written(ends.planned.transactions), "one!\n!\n| a |\n| --- |\n| b |\n!\ntwo!");
}

{
  // Tables at the very start and the very end of the document.
  const text = "| a |\n| --- |\n| x |\n\nmid x\n\n| b |\n| --- |\n| x |";
  const { plan, planned } = replaceAll(text, compile("x"), "yy");
  assert.ok(planned.ok);
  assert.equal(written(planned.transactions), "| a |\n| --- |\n| yy |\n\nmid yy\n\n| b |\n| --- |\n| yy |");
  assert.equal(plan.count, 3);

  const lines = replaceAll(text, compile("$", { regex: true }), "!");
  assert.ok(lines.planned.ok);
  assert.equal(written(lines.planned.transactions), "| a |\n| --- |\n| x |\n!\nmid x!\n!\n| b |\n| --- |\n| x |",
    "nothing is inserted at the end of a document that ends in a table");
  assert.equal(parseMarkdownTables(written(lines.planned.transactions)).length, 2);
}

assert.equal(recentBlockedTableEdits().length, blockedBefore, "the guard refused none of these edits");

// --- All or nothing ----------------------------------------------------------------------

{
  const state = stateOf(mixed);
  const plan = planReplaceAll(state.doc, getParsedTables(state.doc), compile("beta"), "delta");
  const refused = planReplaceTransactions(state, { ...plan, refused: "a replacement would break a table row" });
  assert.deepEqual(refused, { ok: false, reason: "a replacement would break a table row", table: true },
    "a plan that failed its own table check writes nothing");

  // A plan made for another document: its prose part would apply, its table
  // part cannot, so neither is returned.
  const other = stateOf(`X${mixed}`);
  const stale = planReplaceTransactions(other, plan);
  assert.equal(stale.ok, false, "when the guard refuses the table part, the prose part is not written either");
  assert.equal(stale.ok === false && stale.table, true);
  assert.ok(recentBlockedTableEdits().length > blockedBefore, "that refusal came from the table guard");

  const nothing = planReplaceTransactions(state, { prose: [], cells: [], count: 0, refused: null });
  assert.equal(nothing.ok, false);
}

// A cell that a replacement touches is written the way an edit typed into it
// would be written: its other text is encoded again too.
{
  const text = "| one<br/>two &vert; x |\n| --- |\n| nbsp here x |";
  const { planned } = replaceAll(text, compile("x"), "y");
  assert.ok(planned.ok);
  assert.equal(written(planned.transactions), "| one<br>two &#124; y |\n| --- |\n| nbsp here y |");
}

// --- The widget's own Undo ---------------------------------------------------------------

{
  const field = { value: "seed" };
  const history = new FieldHistory(field, 3);
  assert.equal(history.step(true), false, "a box that was not typed in has nothing to undo");
  for (const value of ["a", "ab", "abc"]) { field.value = value; history.typed(); }
  history.typed();
  assert.equal(history.step(true), true);
  assert.equal(field.value, "ab", "Undo takes back the last thing typed");
  assert.equal(history.step(false), true);
  assert.equal(field.value, "abc", "Redo brings it back");
  history.step(true);
  history.step(true);
  history.step(true);
  assert.equal(field.value, "seed", "back to what the box held before the typing");
  assert.equal(history.step(true), false, "and no further");
  history.step(false);
  field.value = "ax";
  history.typed();
  assert.equal(history.step(false), false, "typing after an Undo drops what was undone");
  for (const value of ["1", "2", "3", "4", "5"]) { field.value = value; history.typed(); }
  let steps = 0;
  while (history.step(true)) steps++;
  assert.equal(steps, 3, "the history is bounded");
  field.value = "from outside";
  history.reset();
  assert.equal(history.step(true), false, "a value set from outside starts a new history");
}

console.log("findReplace tests passed");
