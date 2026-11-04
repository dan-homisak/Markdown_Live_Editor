import assert from "node:assert/strict";
import TurndownService from "turndown";
import MarkdownIt from "markdown-it";
import { escapeMarkdownText, underscoreRunCanDelimit } from "../shared/markdownEscape";

const turndown = new TurndownService();
const markdown = new MarkdownIt();

// Without underscores the escaping is exactly turndown's.
for (const text of ["plain", "a * b", "- item", "+ plus", "== title", "## heading", "`code`", "~~~", "[link]", "> quote",
  "1. number", "back\\slash", "mixed *a* [b] `c` \\d"]) {
  assert.equal(escapeMarkdownText(text), turndown.escape(text), JSON.stringify(text));
}

// Underscore runs that cannot delimit emphasis are kept as written.
for (const text of ["Work order: ____", "____", "Attachment ____ and Form ____", "snake_case_name", "a__b", "x _ y", "ΔOEE_new: ____ pp"]) {
  assert.equal(escapeMarkdownText(text), text, JSON.stringify(text));
}
// Runs that could open or close emphasis stay escaped.
assert.equal(escapeMarkdownText("_emphasis_"), "\\_emphasis\\_");
assert.equal(escapeMarkdownText("a _b_ c"), "a \\_b\\_ c");
assert.equal(escapeMarkdownText("__init__"), "\\_\\_init\\_\\_");
assert.equal(escapeMarkdownText("(_x_)"), "(\\_x\\_)");
assert.equal(escapeMarkdownText("*_both_*"), "\\*\\_both\\_\\*");

// Round trip: every escaped text renders back to exactly its original text.
for (const text of ["Work order: ____", "snake_case", "_emphasis_", "a _b_ c", "__init__", "x__y__z", "(_x_)",
  "foo_ bar", "_foo bar", "ΔOEE_control: ____ pp", "1. ____", "* not a list"]) {
  const html = markdown.renderInline(escapeMarkdownText(text));
  const visible = html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  assert.equal(visible, text, `renders literally: ${JSON.stringify(text)} -> ${html}`);
  assert.ok(!/<(em|strong)>/.test(html), `no accidental emphasis: ${JSON.stringify(text)} -> ${html}`);
}

assert.equal(underscoreRunCanDelimit(" ", " "), false);
assert.equal(underscoreRunCanDelimit(undefined, undefined), false);
assert.equal(underscoreRunCanDelimit("a", "b"), false, "intraword underscores never delimit");
assert.equal(underscoreRunCanDelimit(" ", "a"), true);
assert.equal(underscoreRunCanDelimit("a", " "), true);

console.log("Markdown paste escaping tests passed");
