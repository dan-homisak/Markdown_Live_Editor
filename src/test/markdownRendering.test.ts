import assert from "node:assert/strict";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Text } from "@codemirror/state";
import {
  createMarkdownRenderingExtensions,
  markdownRenderingCompartment,
} from "../editor/markdown/markdownRendering";
import { isMarkdownTaskPointerActivation } from "../editor/markdown/markdownPointer";
import { taskFocusReturnSelection } from "../editor/markdown/markdownFocus";
import {
  classifyMarkdownMarkers,
  findTaskAtCaret,
  markdownRenderingParser,
  planTaskToggle,
} from "../editor/markdown/markdownSyntax";
import { parseMarkdownTables } from "../shared/tableModel";

function markers(source: string) {
  return classifyMarkdownMarkers(source, markdownRenderingParser.parse(source));
}

function taskAt(source: string, position: number) {
  return findTaskAtCaret(source, markdownRenderingParser.parse(source), position);
}

const basic = "- item\n+ [ ] next\n* [X] done\n1. [x] numbered\n\n  * * *  \t";
assert.deepEqual(markers(basic).map(({ kind, source }) => [kind, source]), [
  ["bullet", "-"], ["bullet", "+"], ["task", "[ ]"],
  ["bullet", "*"], ["task", "[X]"], ["task", "[x]"], ["rule", "* * *"],
]);
const markerDocument = Text.of(basic.split("\n"));
assert.deepEqual(
  classifyMarkdownMarkers(markerDocument, markdownRenderingParser.parse(basic)),
  markers(basic),
  "CodeMirror Text must preserve UTF-16 coordinates without a full source copy",
);

for (const spelling of ["[ ]", "[x]", "[X]"]) {
  for (const suffix of ["", "\n", "\ttext", " text", "\n  continuation"]) {
    const source = `- ${spelling}${suffix}`;
    assert.equal(markers(source).filter((marker) => marker.kind === "task").length, 1, source);
  }
}
for (const spelling of ["[\t] text", "[  ] text", "[y] text", "[x]joined", "\\[ ] text", "&#91; ] text"]) {
  assert.equal(markers(`- ${spelling}`).filter((marker) => marker.kind === "task").length, 0, spelling);
}

assert.equal(
  markers("- first\n\n  [x] later").filter((marker) => marker.kind === "task").length,
  0,
  "TaskList's later-paragraph node is not an interactive task",
);
assert.equal(markers("-\n\n  [x] later").filter((marker) => marker.kind === "task").length, 0);

const nested = "- [ ] parent\n  - child\n  - [X] nested\n\n  continuation";
assert.equal(taskAt(nested, nested.indexOf("parent"))?.from, 2);
assert.equal(taskAt(nested, nested.indexOf("child")), null, "ordinary nested items must not toggle the parent");
assert.equal(taskAt(nested, nested.indexOf("  - child")), null, "nested ordinary item indentation belongs to that item");
assert.equal(taskAt(nested, nested.indexOf("nested"))?.from, nested.indexOf("[X]"));
assert.equal(taskAt(nested, nested.indexOf("continuation"))?.from, 2);
assert.equal(taskAt("- [ ] task", 10)?.from, 2, "end-of-item caret remains actionable");

const literal = [
  "heading", "---", "", "```md", "- [ ] code", "***", "```", "",
  "    - [ ] indented", "", "<!--", "- [ ] comment", "***", "-->", "",
  "<div>", "- [ ] html", "***", "</div>", "", "\\- [ ] escaped", "",
  "> - [x] quoted", "", "---",
].join("\n");
assert.deepEqual(markers(literal).map(({ kind, source }) => [kind, source]), [
  ["bullet", "-"], ["task", "[x]"], ["rule", "---"],
]);
assert.deepEqual(markers("```\n- [ ] unclosed\n***"), [], "unclosed fenced content stays source");

const literalInTask = "- [ ] task `inline` <span title='tag'>text</span>\n\n      indented\n\n  ```\n  fenced\n  ```";
for (const content of ["inline", "title", "indented", "fenced"]) {
  assert.equal(taskAt(literalInTask, literalInTask.indexOf(content)), null, content);
}
for (const content of ["      indented", "  ```"]) {
  assert.equal(taskAt(literalInTask, literalInTask.indexOf(content)), null, "literal block indentation is not a parent task context");
}
assert.equal(taskAt(literalInTask, literalInTask.indexOf("text"))?.from, 2, "inline HTML does not consume following prose");

const withTable = "- [ ] outside\n\n| - [ ] cell | Other |\n| --- | --- |\n| *** | - [x] cell |\n\n- [X] after";
const tableTree = markdownRenderingParser.parse(withTable);
const tables = parseMarkdownTables(withTable);
assert.equal(tables.length, 1);
assert.deepEqual(
  classifyMarkdownMarkers(withTable, tableTree, tables).map(({ kind, source }) => [kind, source]),
  [["bullet", "-"], ["task", "[ ]"], ["bullet", "-"], ["task", "[X]"]],
);
assert.equal(findTaskAtCaret(withTable, tableTree, withTable.indexOf("cell"), tables), null);
const artificialProtection = [{ from: 3, to: 4 }];
assert.equal(classifyMarkdownMarkers("- [ ] task", markdownRenderingParser.parse("- [ ] task"), artificialProtection).length, 1);
assert.equal(planTaskToggle("- [ ] task", markdownRenderingParser.parse("- [ ] task"), 2, artificialProtection), null);

for (const token of ["[ ]", "[x]", "[X]"]) {
  for (const newline of ["\n", "\r\n"]) {
    const source = `\uFEFFprefix 😀${newline}\t${newline}> - ${token} café\t ${newline}`;
    const from = source.indexOf(token);
    const edit = planTaskToggle(source, markdownRenderingParser.parse(source), from);
    assert.deepEqual(edit, { from: from + 1, to: from + 2, insert: token === "[ ]" ? "x" : " " });
    assert.ok(edit);
    const changed = source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
    assert.equal(changed.length, source.length);
    assert.equal(changed.slice(0, edit.from), source.slice(0, edit.from));
    assert.equal(changed.slice(edit.to), source.slice(edit.to));
    const next = planTaskToggle(changed, markdownRenderingParser.parse(changed), from);
    assert.equal(next?.insert, token === "[ ]" ? " " : "x", "rapid actions use successive source state");
  }
}

const stale = "- [y] task";
assert.equal(planTaskToggle(stale, markdownRenderingParser.parse(stale), 2), null);
assert.equal(planTaskToggle("- [ ] task", markdownRenderingParser.parse("- [ ] task"), 3), null, "arbitrary offsets are not marker identities");
assert.equal(taskAt("- [ ] task", -1), null);
assert.equal(taskAt("- [ ] task", 11), null);

const windowSource = "- [ ] first\n\n- [x] second\n\n***";
const windowTree = markdownRenderingParser.parse(windowSource);
const second = windowSource.indexOf("[x]");
const windows = [{ from: second, to: second + 3 }, { from: second + 1, to: second + 3 }];
assert.deepEqual(
  classifyMarkdownMarkers(windowSource, windowTree, [], windows).map(({ kind, from }) => [kind, from]),
  [["task", second]],
  "viewport windows deduplicate markers and use enclosing offscreen list context",
);
const dialect = markdownRenderingParser.parse("~~strike~~ https://example.com\n\n| A | B |\n| --- | --- |").toString();
assert.match(dialect, /Strikethrough/);
assert.match(dialect, /URL/);
assert.doesNotMatch(dialect, /Table/);

// The recovery switch must restore the input parser, not merely hide marks.
const switchSource = "- [x] task\n\n~~strike~~";
const options = { enabled: false, readOnly: false, screenReaderOptimized: false };
let switchState = EditorState.create({
  doc: switchSource,
  selection: { anchor: 7 },
  extensions: markdownRenderingCompartment.of(createMarkdownRenderingExtensions(options)),
});
function parsedState(state: EditorState): string {
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  assert.ok(tree, "small switch fixture must complete parsing");
  return tree.toString();
}
const disabledTree = parsedState(switchState);
assert.doesNotMatch(disabledTree, /TaskMarker|Strikethrough/);
for (const enabled of [true, false, true, false]) {
  const previousDocument = switchState.doc;
  const previousSelection = switchState.selection;
  const transaction = switchState.update({
    effects: markdownRenderingCompartment.reconfigure(createMarkdownRenderingExtensions({ ...options, enabled })),
  });
  assert.equal(transaction.docChanged, false);
  switchState = transaction.state;
  assert.equal(switchState.doc, previousDocument);
  assert.equal(switchState.selection, previousSelection);
  const tree = parsedState(switchState);
  if (enabled) {
    assert.match(tree, /TaskMarker/);
    assert.match(tree, /Strikethrough/);
  } else {
    assert.equal(tree, disabledTree);
  }
}

function enterResult(enabled: boolean): string {
  const source = "- [x] task";
  let state = EditorState.create({
    doc: source,
    selection: { anchor: source.length },
    extensions: createMarkdownRenderingExtensions({ ...options, enabled }),
  });
  parsedState(state);
  assert.equal(insertNewlineContinueMarkup({ state, dispatch: transaction => { state = transaction.state; } }), true);
  return state.doc.toString();
}
assert.equal(enterResult(false), "- [x] task\n- [ ] ");
assert.equal(enterResult(true), "- [x] task\n- [ ] ");
assert.equal(enterResult(false), "- [x] task\n- [ ] ", "disabled recovery retains original CommonMark Enter behavior");

const taskPointer = {
  button: 0, isPrimary: true,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  target: { closest: (selector: string) => selector === ".mlrt-markdown-task-control" ? {} : null } as unknown as EventTarget,
};
assert.equal(isMarkdownTaskPointerActivation(taskPointer), true);
for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
  assert.equal(isMarkdownTaskPointerActivation({ ...taskPointer, [modifier]: true }), false,
    "modified gestures must remain with existing selection handlers");
}
assert.equal(isMarkdownTaskPointerActivation({ ...taskPointer, isPrimary: false }), false);
assert.equal(isMarkdownTaskPointerActivation({ ...taskPointer, button: 2 }), false);
assert.equal(isMarkdownTaskPointerActivation({ ...taskPointer, target: null }), false);
assert.equal(isMarkdownTaskPointerActivation({ ...taskPointer, target: { closest: () => null } as unknown as EventTarget }), false);

const focusSource = "before\n\n| A |\n| --- |\n| B |\n\nafter";
const focusDoc = Text.of(focusSource.split("\n"));
const focusTables = parseMarkdownTables(focusSource);
const releasedSelection = EditorSelection.single(3);
assert.equal(taskFocusReturnSelection(focusDoc, releasedSelection, releasedSelection, 5, focusTables).main.head, 5);
const mappedSelection = EditorSelection.single(focusSource.indexOf("after"));
assert.equal(taskFocusReturnSelection(focusDoc, releasedSelection, mappedSelection, 5, focusTables), mappedSelection,
  "an authoritative replacement's mapped caret supersedes the old bookmark");
const newerRange = EditorSelection.single(1, focusSource.indexOf("after"));
assert.equal(taskFocusReturnSelection(focusDoc, releasedSelection, newerRange, 5, focusTables), newerRange,
  "a newer nonempty source/table envelope must keep its exact selection identity");
assert.equal(taskFocusReturnSelection(focusDoc, newerRange, newerRange, 5, focusTables), newerRange,
  "selection reveal must return focus without replacing the selected range with a bookmark");
for (const position of [focusTables[0].from, focusTables[0].to, focusTables[0].to - 1]) {
  const selection = EditorSelection.single(position);
  const restored = taskFocusReturnSelection(focusDoc, selection, selection, position, focusTables);
  assert.ok(restored.main.head < focusTables[0].from || restored.main.head > focusTables[0].to,
    "focus never restores inside table source or the newline consumed by its replacement");
}
const replacedWithTable = Text.of(["| A |", "| --- |", "| B |"]);
const onlyTable = parseMarkdownTables(replacedWithTable.toString());
const replacedSelection = EditorSelection.single(2);
assert.equal(taskFocusReturnSelection(replacedWithTable, releasedSelection, replacedSelection, 3, onlyTable).main.head,
  replacedWithTable.length, "a document replaced entirely by a table has a safe EOF boundary");
const shortDoc = Text.of(["short"]);
assert.equal(taskFocusReturnSelection(shortDoc, releasedSelection, releasedSelection, 50, []).main.head, 5,
  "a vanished task's bookmark is bounded by the current document");

console.log("Markdown marker classification and task edit tests passed.");
