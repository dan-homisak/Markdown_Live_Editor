import assert from "node:assert/strict";
import { EditorSelection, EditorState, TransactionSpec } from "@codemirror/state";
import { findStateField, setFindState } from "../editor/find/findState";
import {
  occurrenceMessage,
  occurrenceSessionField,
  planAddNextOccurrence,
  planSelectAllOccurrences,
} from "../editor/multiCursor";
import { distributePaste, joinCopiedSelections } from "../shared/multiCursorModel";
import { parseMarkdownTables } from "../shared/tableModel";
import { createTableSourceChangeFilter, tableSafeSelection } from "../shared/tableSourceProtection";

const text = [
  "tracker Tracker trackers tracker",
  "",
  "| a |",
  "| --- |",
  "| tracker |",
  "",
  "last tracker",
].join("\n");
const table = parseMarkdownTables(text)[0];
const extensions = [
  EditorState.allowMultipleSelections.of(true),
  occurrenceSessionField,
  findStateField,
  createTableSourceChangeFilter(),
];
const stateWith = (selection: EditorSelection | { anchor: number; head?: number }): EditorState =>
  EditorState.create({ doc: text, selection, extensions });
const apply = (state: EditorState, spec: TransactionSpec | null): EditorState => {
  assert.ok(spec, "the plan has something to do");
  return state.update(spec).state;
};
const selected = (state: EditorState): string[] =>
  state.selection.ranges.map(range => `${range.from}-${range.to}`);
const lastTracker = text.lastIndexOf("tracker");

// --- Copy and paste with several selections ------------------------------------------

{
  assert.equal(joinCopiedSelections(["one", "two", "three"]), "one\ntwo\nthree", "several selections are copied one to a line");
  assert.deepEqual(distributePaste("a\nb\nc", 3), ["a", "b", "c"], "as many lines as selections: one line each");
  assert.deepEqual(distributePaste("a\r\nb\r\nc\r\n", 3), ["a", "b", "c"], "line endings and one trailing break do not count");
  assert.deepEqual(distributePaste("a\nb", 3), ["a\nb", "a\nb", "a\nb"], "any other number of lines: the whole text for each");
  assert.deepEqual(distributePaste("word", 2), ["word", "word"]);
  assert.deepEqual(distributePaste("a\nb", 1), ["a\nb"], "one selection takes the text as it is");
}

// --- The table source guard --------------------------------------------------------

{
  const inTable = table.header.cells[0].start + 1;
  const several = stateWith(EditorSelection.create([
    EditorSelection.cursor(3),
    EditorSelection.cursor(inTable),
    EditorSelection.cursor(lastTracker),
  ], 2));
  const safe = tableSafeSelection(several);
  assert.ok(safe, "a caret in table source is not left there");
  assert.deepEqual(safe!.ranges.map(range => range.head), [3, lastTracker], "that caret is removed and the others stay");
  assert.equal(safe!.main.head, lastTracker, "the main cursor stays the main cursor");

  const mainInTable = stateWith(EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(inTable)], 1));
  assert.deepEqual(tableSafeSelection(mainInTable)!.ranges.map(range => range.head), [3], "also when it was the main cursor");

  const allInTable = stateWith(EditorSelection.create([EditorSelection.cursor(inTable), EditorSelection.cursor(inTable + 8)], 0));
  const moved = tableSafeSelection(allInTable)!;
  assert.equal(moved.ranges.length, 1, "with every cursor in a table, one cursor is moved out");
  assert.ok(moved.main.head < table.from || moved.main.head > table.to, "to a place beside the table");

  assert.equal(tableSafeSelection(stateWith(EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(20)]))), undefined,
    "cursors in prose are left alone");
  const crossing = stateWith(EditorSelection.create([EditorSelection.cursor(3), EditorSelection.range(30, lastTracker)], 0));
  assert.equal(tableSafeSelection(crossing), undefined, "a selection that spans a table is not a caret in it");
  const single = tableSafeSelection(stateWith({ anchor: inTable }));
  assert.ok(single && single.ranges.length === 1 && (single.main.head < table.from || single.main.head > table.to),
    "a single caret is still moved beside its table");
  assert.equal(tableSafeSelection(stateWith({ anchor: 3 })), undefined);
}

// The end of a document that ends in a table is the end of the table's last
// row: text typed there is refused unless it starts a new line, and with
// several cursors that refusal would take the typing at every cursor with it.
{
  const ending = "above\n\n| a |\n| --- |\n| b |";
  const several = EditorState.create({
    doc: ending,
    selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(ending.length)], 1),
    extensions,
  });
  const safe = tableSafeSelection(several);
  assert.ok(safe, "a caret at the end of a final table is not left among several cursors");
  assert.deepEqual(safe!.ranges.map(range => range.head), [2]);
  const typed = several.update({ selection: safe }).state;
  assert.equal(typed.update(typed.replaceSelection("x")).state.doc.toString(), `abxove${ending.slice(5)}`,
    "so typing at the cursors that remain is not refused");
  const lone = EditorState.create({ doc: ending, selection: { anchor: ending.length }, extensions });
  assert.equal(tableSafeSelection(lone), undefined, "a lone caret may rest there: typing starts a new line for it");
}

// --- Typing at several cursors -------------------------------------------------------

{
  const state = stateWith(EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(8), EditorSelection.cursor(lastTracker)]));
  const transaction = state.update(state.replaceSelection("x"));
  let changes = 0;
  transaction.changes.iterChanges(() => { changes++; });
  assert.equal(changes, 3, "typing at three cursors is one transaction with three changes");
  assert.equal(transaction.state.doc.toString(), `x${text.slice(0, 8)}x${text.slice(8, lastTracker)}x${text.slice(lastTracker)}`);
  assert.deepEqual(selected(transaction.state), ["1-1", "10-10", `${lastTracker + 3}-${lastTracker + 3}`], "every cursor follows its text");

  // A cursor in table source would make the table guard refuse the whole edit.
  const withTable = stateWith(EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(table.header.cells[0].start + 1)]));
  assert.equal(withTable.update(withTable.replaceSelection("x")).state.doc.toString(), text,
    "an edit that would write into table source writes nothing at all");
}

// --- Add the next occurrence -----------------------------------------------------------

{
  // From a caret: the word, then whole-word matches with the same case.
  let state = stateWith({ anchor: 2 });
  let plan = planAddNextOccurrence(state);
  state = apply(state, plan.spec);
  assert.deepEqual(selected(state), ["0-7"], "the first use selects the word at the caret");
  assert.deepEqual(state.field(occurrenceSessionField), { wholeWord: true, matchCase: true });

  plan = planAddNextOccurrence(state);
  state = apply(state, plan.spec);
  assert.deepEqual(selected(state), ["0-7", "25-32"], "the next whole word with the same case, past Tracker and trackers");
  assert.equal(state.selection.main.from, 25, "the newest selection is the main one");
  assert.deepEqual(state.field(occurrenceSessionField), { wholeWord: true, matchCase: true }, "the search keeps its rules");

  plan = planAddNextOccurrence(state);
  state = apply(state, plan.spec);
  assert.deepEqual(selected(state), ["0-7", "25-32", `${lastTracker}-${lastTracker + 7}`], "the match in the table cell is passed over");
  assert.equal(plan.inCells, 1, "and counted");

  plan = planAddNextOccurrence(state);
  assert.equal(plan.spec, null, "with every occurrence selected there is nothing to add");

  // Any other selection change ends the search's rules.
  const elsewhere = state.update({ selection: { anchor: 0, head: 7 } }).state;
  assert.equal(elsewhere.field(occurrenceSessionField), null);
  assert.equal(state.update({ changes: { from: 0, insert: "x" } }).state.field(occurrenceSessionField), null, "so does an edit");
}

{
  // From selected text: any occurrence, whatever its case, until find says otherwise.
  let state = stateWith({ anchor: 0, head: 7 });
  state = apply(state, planAddNextOccurrence(state).spec);
  assert.deepEqual(selected(state), ["0-7", "8-15"], "Tracker matches tracker");
  state = apply(state, planAddNextOccurrence(state).spec);
  assert.deepEqual(selected(state), ["0-7", "8-15", "16-23"], "and so does the start of trackers");
  assert.equal(state.field(occurrenceSessionField), null);

  let strict = stateWith({ anchor: 0, head: 7 });
  strict = strict.update({ effects: setFindState.of({ options: { matchCase: true, wholeWord: true } }) }).state;
  strict = apply(strict, planAddNextOccurrence(strict).spec);
  assert.deepEqual(selected(strict), ["0-7", "25-32"], "the find options decide how selected text is matched");

  // Wrapping: from the last occurrence the search continues at the top.
  let wrapped = stateWith({ anchor: lastTracker, head: lastTracker + 7 });
  wrapped = apply(wrapped, planAddNextOccurrence(wrapped).spec);
  assert.deepEqual(selected(wrapped), ["0-7", `${lastTracker}-${lastTracker + 7}`]);
  assert.equal(wrapped.selection.main.from, 0);

  assert.equal(planAddNextOccurrence(stateWith({ anchor: 7 + 26 })).spec, null, "a caret on no word selects nothing");
}

// --- Select every occurrence -----------------------------------------------------------

{
  const fromCaret = stateWith({ anchor: 27 });
  const plan = planSelectAllOccurrences(fromCaret, false);
  const state = apply(fromCaret, plan.spec);
  assert.deepEqual(selected(state), ["0-7", "25-32", `${lastTracker}-${lastTracker + 7}`], "every whole-word occurrence in prose");
  assert.equal(state.selection.main.from, 25, "the occurrence at the caret stays the main one");
  assert.deepEqual([plan.selected, plan.inCells, plan.capped], [3, 1, false]);
  assert.equal(occurrenceMessage(plan, true),
    "Selected 3 occurrences. 1 more is in table cells, which take no cursor; Replace All changes those too.");

  const fromSelection = planSelectAllOccurrences(stateWith({ anchor: 8, head: 15 }), false);
  assert.equal(fromSelection.selected, 5, "selected text matches every occurrence, whatever its case");

  // With the find widget open, its query is what gets selected, pattern and all.
  let finding = stateWith({ anchor: 0 });
  finding = finding.update({ effects: setFindState.of({ open: true, query: "tr\\w+s", options: { regex: true } }) }).state;
  const viaFind = planSelectAllOccurrences(finding, true);
  assert.deepEqual(selected(apply(finding, viaFind.spec)), ["16-24"]);
  assert.equal(planSelectAllOccurrences(finding, false).selected, 3, "Change All Occurrences uses the word at the caret all the same");

  const onlyCells = EditorState.create({ doc: "| word |\n| --- |\n| word |\n\nother", selection: { anchor: 0 }, extensions });
  const none = planSelectAllOccurrences(onlyCells.update({ effects: setFindState.of({ open: true, query: "word" }) }).state, true);
  assert.equal(none.spec, null);
  assert.equal(occurrenceMessage(none, true),
    "No occurrence in the text to select. 2 more are in table cells, which take no cursor; Replace All changes those too.");
  assert.equal(occurrenceMessage({ spec: null, selected: 0, inCells: 0, capped: false }, true), null);
}

console.log("multiCursor tests passed");
