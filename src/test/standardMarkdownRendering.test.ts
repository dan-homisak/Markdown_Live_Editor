import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Text } from "@codemirror/state";
import { classifyMarkdownBlocks } from "../editor/markdown/markdownBlocks";
import { markdownDocumentIndex } from "../editor/markdown/markdownDocumentIndex";
import { classifyMarkdownPresentation } from "../editor/markdown/markdownPresentation";
import { classifyMarkdownPreview, createMarkdownLivePreviewExtensions, markdownPreviewField } from "../editor/markdown/markdownLivePreview";
import { markdownRenderTreeField } from "../editor/markdown/markdownRenderTree";
import { markdownParserExtensions, markdownRenderingParser } from "../editor/markdown/markdownSyntax";
import { markdownCellPresentation } from "../editor/table/markdownCellPresentation";
import { getParsedTables } from "../shared/tableModel";
import { classifyMarkdownLists } from "../editor/markdown/markdownListStructure";

const project = (source: string) => {
  const doc = Text.of(source.split("\n")), tree = markdownRenderingParser.parse(source), tables = getParsedTables(doc);
  return { doc, tree, index: markdownDocumentIndex(doc, tree, tables),
    parts: classifyMarkdownPreview(doc, tree, tables, [{ from: 0, to: doc.length }]) };
};
const fixture = readFileSync("standard-markdown-fixture.md", "utf8").replace(/\r\n/g, "\n");
const actual = project(fixture);
assert.equal(actual.doc.toString(), fixture, "rendering never rewrites fixture source");
const toc = actual.parts.find(part => part.kind === "toc");
assert(toc?.block && toc.headings?.some(heading => heading.label === "Footnotes"));
assert.equal(actual.index.footnotes.size, 2);
assert.deepEqual(actual.parts.filter(part => part.kind === "footnote").map(part => part.label), ["1", "2", "1. ", "2. "]);
const continuation = fixture.indexOf("Indented continuation text");
assert.equal(actual.tree.resolveInner(continuation, 1).parent?.name, "FootnoteDefinition", "continuation is prose owned by the note, never an indented code block");

const quotes = project("> one\n> > two\n> > > three");
assert.deepEqual(classifyMarkdownBlocks(quotes.doc, quotes.tree).rows.map(row => row.quoteDepth), [1, 2, 3]);
const numbered = "5. five\n1. six\n   1. child one\n   1. child two\n1. seven";
assert.deepEqual(project(numbered).parts.filter(part => part.kind === "text").map(part => part.label), ["6", "2", "7"], "numbering starts at the list's first number and counts siblings independently");
const widerNumber = project("9. nine\n1. ten");
assert.deepEqual(classifyMarkdownLists(widerNumber.doc, widerNumber.tree).map(item => item.renderedPrefixColumns), [3, 4], "wrapped item text accounts for the displayed number width");

const entities = project("&amp; &lt; &#39; &#x1f600; &copy; &bogus; `&copy;` \\&copy;");
assert.deepEqual(entities.parts.filter(part => part.kind === "text").map(part => part.label), ["&", "<", "'", "😀", "©"]);
const missing = "A [missing] label and [^missing].";
assert(!project(missing).parts.some(part => part.kind === "hide" || part.kind === "footnote"));
assert(!classifyMarkdownPresentation(missing, markdownRenderingParser.parse(missing)).some(run => run.className.includes("role-link")));

const notes = project("First[^b], again[^b], then[^a].\n\n[^a]: Second\n\n[^b]: First\n\n    **continued**\n\nAfter.");
assert.deepEqual(notes.parts.filter(part => part.kind === "footnote" && part.superscript).map(part => part.label), ["1", "1", "2"]);
assert.equal(notes.index.footnotes.get("b")?.number, 1);
assert.equal(notes.index.footnotes.get("a")?.number, 2);
assert(notes.parts.filter(part => part.kind === "footnote" && part.superscript).every(part => part.target !== undefined));
const literal = project("```md\n[TOC]\n[^a]: literal\n```\n\n    [^b]: literal\n\n<!-- [^c] -->\n\n# **Actual** &amp; `code`\n\n[TOC]");
assert.equal(literal.index.footnotes.size, 0);
assert.deepEqual(literal.index.headings.map(heading => heading.label), ["Actual & code"]);
assert.equal(literal.parts.filter(part => part.kind === "toc").length, 1);
const nested = project("> [^a]: quote note\n>\n>     continuation\n\nAfter [^a].");
assert.equal(nested.index.footnotes.size, 1, "composite definitions retain enclosing block ownership");

const cell = "**bold**, *italic*, ***both***, ~~strike~~, `code`, &copy;, [link](https://example.com)";
const runs = markdownCellPresentation(cell);
assert.equal(runs.map(run => run.text).join(""), "bold, italic, both, strike, code, ©, link");
assert(runs.some(run => run.text === "both" && run.className.includes("bold") && run.className.includes("italic")));
assert(runs.some(run => run.text === "code" && run.className.includes("inline-code")));
assert(runs.every(run => run.from >= 0 && run.to <= cell.length && run.from < run.to));
assert.equal(markdownCellPresentation("`&amp;` <script>alert(1)</script>").map(run => run.text).join(""), "&amp; <script>alert(1)</script>", "code and HTML stay literal; no document HTML is executed");
assert.equal(markdownCellPresentation("[unresolved] \\*literal\\*").map(run => run.text).join(""), "[unresolved] *literal*");

let state = EditorState.create({ doc: "[TOC]\n\n# Old\n\nReference[^a].\n\n[^a]: Body", extensions: [
  markdown({ extensions: markdownParserExtensions }), markdownRenderTreeField, createMarkdownLivePreviewExtensions(false),
] });
state = state.update({ changes: { from: state.doc.toString().indexOf("Old"), to: state.doc.toString().indexOf("Old") + 3, insert: "New" } }).state;
assert.equal(state.field(markdownPreviewField).parts.find(part => part.kind === "toc")?.headings?.[0].label, "New", "offscreen heading edits refresh the TOC");
const definition = state.doc.toString().indexOf("[^a]:");
state = state.update({ changes: { from: definition, to: state.doc.length, insert: "" } }).state;
assert(!state.field(markdownPreviewField).parts.some(part => part.kind === "footnote"), "removing a definition restores its reference source");
let referenceState = EditorState.create({ doc: "[label][ref]\n\nOther text.", extensions: [
  markdown({ extensions: markdownParserExtensions }), markdownRenderTreeField, createMarkdownLivePreviewExtensions(false),
] });
assert.equal(referenceState.field(markdownPreviewField).parts.length, 0);
referenceState = referenceState.update({ changes: { from: referenceState.doc.length, insert: "\n\n[ref]: https://example.com" } }).state;
assert(referenceState.field(markdownPreviewField).parts.some(part => part.kind === "hide" && part.from === 0), "adding a distant reference definition updates its resting label");
console.log("Standard Markdown fixture rendering checks passed: nested quotes, inline tables, TOC, footnotes, numbering, entities, and source preservation.");
