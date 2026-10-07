import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { markdownSelectionWrapTransaction } from "../editor/markdown/markdownSelectionWrapping";
import { markdownRenderingParser } from "../editor/markdown/markdownSyntax";
import { planMarkdownSelectionWrap } from "../shared/markdownSelectionWrapping";

function press(value: string, anchor: number, head: number, key: string, inlineOnly = false) {
  const edit = planMarkdownSelectionWrap(value, { anchor, head }, key, { inlineOnly });
  assert.ok(edit);
  return { value: value.slice(0, edit.from) + edit.insert + value.slice(edit.to), ...edit.selection };
}
function repeat(key: string, expected: string[], inlineOnly = false) {
  let result = { value: "word", anchor: 0, head: 4 };
  for (const value of expected) {
    result = press(result.value, result.anchor, result.head, key, inlineOnly);
    assert.equal(result.value, value);
    assert.equal(result.value.slice(result.anchor, result.head), "word", "only the payload stays selected");
  }
}
repeat("*", ["*word*", "**word**", "***word***"]);
repeat("_", ["_word_", "__word__", "___word___"]);
repeat("~", ["~word~", "~~word~~"]);
repeat("=", ["=word=", "==word=="]);
repeat("$", ["$word$", "$$word$$"]);
repeat("`", ["`word`", "``word``", "```\nword\n```", "````\nword\n````"]);
repeat("`", ["`word`", "``word``", "```word```"], true);
repeat("[", ["[word]()", "[[word]]"]);
repeat("!", ["![word]()"]);
for (const [key, value] of [["(", "(word)"], ["{", "{word}"], ["<", "<word>"],
  ['"', '"word"'], ["'", "'word'"], ["^", "^word^"]]) repeat(key, [value]);

assert.equal(press("[[word]]", 2, 6, "!").value, "![[word]]");
assert.equal(press("[word](target.md)", 1, 5, "!").value, "![word](target.md)");
assert.equal(press("[word](target.md)", 1, 5, "[").value, "[[word]](target.md)", "destinations are never deleted");
let middle = { value: "before word after", anchor: 7, head: 11 };
for (let n = 0; n < 3; n++) middle = press(middle.value, middle.anchor, middle.head, "`");
assert.equal(middle.value, "before \n```\nword\n```\n after");
assert.equal(middle.value.slice(middle.anchor, middle.head), "word");
assert.equal(markdownRenderingParser.parse(middle.value).topNode.getChild("FencedCode")?.name, "FencedCode");
assert.equal(press("one\ntwo", 0, 7, "`").value, "```\none\ntwo\n```");
const backward = press("a word z", 6, 2, "*");
assert.deepEqual(backward, { value: "a *word* z", anchor: 7, head: 3 });
let literal = press("`word`", 0, 6, "`");
assert.equal(literal.value, "`` `word` ``");
literal = press(literal.value, literal.anchor, literal.head, "`");
assert.equal(literal.value, "```\n`word`\n```");
for (const selection of [{ anchor: 1, head: 1 }, { anchor: -1, head: 3 }, { anchor: 0, head: 99 },
  { anchor: 0.5, head: 3 }, { anchor: NaN, head: 3 }]) {
  assert.equal(planMarkdownSelectionWrap("word", selection, "*"), null);
}
for (const key of ["a", "Enter", "]", "**", "", "#", ">", "\\", "constructor", "toString", "__proto__"]) {
  assert.equal(planMarkdownSelectionWrap("word", { anchor: 0, head: 4 }, key), null);
}

let state = EditorState.create({ doc: "word next", selection: EditorSelection.create([
  EditorSelection.range(4, 0), EditorSelection.range(5, 9),
], 1), extensions: [EditorState.allowMultipleSelections.of(true), history()] });
const transaction = markdownSelectionWrapTransaction(state, "*");
assert.ok(transaction);
state = state.update(transaction).state;
assert.equal(state.doc.toString(), "*word* *next*");
assert.equal(state.selection.mainIndex, 1);
assert.deepEqual(state.selection.ranges.map(range => [range.anchor, range.head]), [[5, 1], [8, 12]]);
assert.equal(undo({ state, dispatch: tr => { state = tr.state; } }), true);
assert.equal(state.doc.toString(), "word next", "one undo restores the whole wrapping operation");
assert.deepEqual(state.selection.ranges.map(range => [range.anchor, range.head]), [[4, 0], [5, 9]]);
const readonly = EditorState.create({ doc: "word", selection: { anchor: 0, head: 4 }, extensions: EditorState.readOnly.of(true) });
assert.equal(markdownSelectionWrapTransaction(readonly, "*"), null);
const table = "| Key | Value |\n| --- | --- |\n| word | keep |";
assert.equal(markdownSelectionWrapTransaction(EditorState.create({ doc: table,
  selection: { anchor: table.indexOf("word"), head: table.indexOf("word") + 4 } }), "*"), null,
  "source wrapping must not mutate hidden table source");
console.log("Markdown selection wrapping tests passed.");
