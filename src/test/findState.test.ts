import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { applyFindChange, findStateField, setFindState } from "../editor/find/findState";
import { countLabel } from "../editor/find/findWidget";

// --- The query state -------------------------------------------------------------

{
  const initial = EditorState.create({ extensions: findStateField }).field(findStateField);
  assert.deepEqual(
    [initial.open, initial.replaceOpen, initial.query, initial.replacement, initial.compiled.ok],
    [false, false, "", "", false],
    "find starts closed, with nothing to search for",
  );

  const opened = applyFindChange(initial, { open: true, query: "tracker" });
  assert.equal(opened.open, true);
  assert.equal(opened.compiled.ok, true, "a query is compiled when it is set");
  assert.notEqual(opened.compiled, initial.compiled);

  // What was found belongs to one compiled query: its identity changes only
  // when the query could match differently.
  assert.equal(applyFindChange(opened, { replacement: "x" }).compiled, opened.compiled, "typing a replacement searches nothing again");
  assert.equal(applyFindChange(opened, { replaceOpen: true }).compiled, opened.compiled);
  assert.equal(applyFindChange(opened, { open: false }).compiled, opened.compiled, "closing keeps the query");
  assert.equal(applyFindChange(opened, { query: "tracker" }), opened, "a change that changes nothing returns the same state");
  assert.equal(applyFindChange(opened, { options: { matchCase: false } }), opened);
  assert.notEqual(applyFindChange(opened, { query: "tracke" }).compiled, opened.compiled);

  const matchCase = applyFindChange(opened, { options: { matchCase: true } });
  assert.notEqual(matchCase.compiled, opened.compiled, "an option recompiles the query");
  assert.deepEqual(matchCase.options, { matchCase: true, wholeWord: false, regex: false }, "other options keep their values");

  const literal = applyFindChange(opened, { query: "(open" });
  assert.equal(literal.compiled.ok, true, "text is not a pattern until the option says so");
  const pattern = applyFindChange(literal, { options: { regex: true } });
  assert.equal(pattern.compiled.ok, false);
  assert.equal(pattern.compiled.ok === false && pattern.compiled.reason, "invalid");
  assert.equal(applyFindChange(opened, { query: "" }).compiled.ok, false, "an emptied box searches for nothing");
}

// The state lives in the editor state and changes only through its effect.
{
  let state = EditorState.create({ doc: "one two", extensions: findStateField });
  state = state.update({ effects: setFindState.of({ open: true, query: "two" }) }).state;
  const afterEffect = state.field(findStateField);
  state = state.update({ changes: { from: 0, insert: "zero " } }).state;
  assert.equal(state.field(findStateField), afterEffect, "editing the document does not touch the query");
  state = state.update({ effects: [setFindState.of({ query: "one" }), setFindState.of({ replacement: "1" })] }).state;
  assert.deepEqual([state.field(findStateField).query, state.field(findStateField).replacement], ["one", "1"]);
}

// --- The match counter -----------------------------------------------------------

{
  const label = (count: number | null, current: number, truncated = false, invalid: string | null = null): string =>
    countLabel({ count, current, truncated, invalid });
  assert.equal(label(null, 0), "No results", "nothing to search for");
  assert.equal(label(0, 0), "No results");
  assert.equal(label(12, 0), "? of 12", "matches exist, and the caret is on none");
  assert.equal(label(12, 3), "3 of 12");
  assert.equal(label(20000, 1, true), "1 of 20000+", "more matches exist than were counted");
  assert.equal(label(5, 2, false, "Unterminated group"), "No results", "a bad pattern has no results");
}

console.log("findState tests passed");
