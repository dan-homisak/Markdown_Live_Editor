import assert from "node:assert/strict";
import { HtmlClipboardStructure, plainTextPasteReason } from "../shared/clipboardPasteSource";

function structure(text: string, counts: Partial<HtmlClipboardStructure> = {}): HtmlClipboardStructure {
  return {
    text,
    preformatted: "none",
    headings: 0,
    listItems: 0,
    tables: 0,
    paragraphBreaks: 0,
    links: 0,
    images: 0,
    codeBlocks: 0,
    inlineCode: 0,
    quotes: 0,
    strong: 0,
    emphasis: 0,
    strike: 0,
    rules: 0,
    ...counts,
  };
}

// --- A Markdown editor: the plain text is the source of the rendered HTML ------

// A heading, a nested list and a line that follows the list without a blank
// line. The rendering puts that line inside the last list item; the source
// does not indent it.
const note = "## Heading two\n\n- item one\n    - nested item\nplain text after\n\n# Heading one\nparagraph";
assert.equal(
  plainTextPasteReason(note, structure("Heading two\nitem one\nnested item\nplain text after\nHeading one\nparagraph",
    { headings: 2, listItems: 2 })),
  "markdown-source",
  "headings and list items written in Markdown: paste the source",
);

// Task lists, wikilinks, tags, emphasis and a fenced block.
const rich = [
  "- [ ] open task with **bold** and *emphasis*",
  "- [x] done task, see [[Other note]] and #project/tag",
  "",
  "```js",
  "const value = 1;",
  "```",
  "",
  "> quoted `code` and ~~struck~~ text",
  "",
  "---",
  "",
  "![diagram](diagram.png) and [a link](https://example.com/)",
].join("\n");
assert.equal(
  plainTextPasteReason(rich, structure(
    "open task with bold and emphasis done task, see Other note and #project/tag const value = 1; quoted code and struck text and a link",
    { listItems: 2, strong: 1, emphasis: 1, links: 3, codeBlocks: 1, inlineCode: 1, quotes: 1, strike: 1, rules: 1, images: 1 })),
  "markdown-source",
);

// A pipe table needs its delimiter row; a rule is not one.
const tableSource = "| Name | Value |\n| --- | ---: |\n| a | 1 |";
assert.equal(plainTextPasteReason(tableSource, structure("Name Value a 1", { tables: 1 })), "markdown-source");
assert.equal(plainTextPasteReason("Name\tValue\n---\na\t1", structure("Name Value a 1", { tables: 1 })), null,
  "tab-separated rows under a rule are not a Markdown table");

// Setext headings are Markdown headings too.
assert.equal(plainTextPasteReason("Title\n=====\n\nbody", structure("Title body", { headings: 1 })), "markdown-source");

// --- A web page or a word processor: the plain text has no syntax -------------

assert.equal(
  plainTextPasteReason("Title\n\nitem a\nitem b\n\nBold text and link",
    structure("Title item a item b Bold text and link", { headings: 1, listItems: 2, strong: 1, links: 1, paragraphBreaks: 0 })),
  null,
  "structure the plain text does not write: convert the HTML",
);
assert.equal(plainTextPasteReason("Title\n\n* item a\n* item b", structure("Title item a item b", { headings: 1, listItems: 2 })), null,
  "list markers alone do not account for a heading");
assert.equal(plainTextPasteReason("one\ntwo", structure("one two", { paragraphBreaks: 1, strong: 1 })), null,
  "two paragraphs on adjacent lines would merge");
assert.equal(plainTextPasteReason("use the * operator", structure("use the * operator")), null,
  "plain words keep the converter's escaping");
assert.equal(plainTextPasteReason("some bold text", structure("some bold text", { strong: 1 })), null);
assert.equal(plainTextPasteReason("see the docs", structure("see the docs", { links: 1 })), null);

// A code block copied from a web page is fenced by the converter. Its plain
// text has no fence, even when its lines are indented.
assert.equal(
  plainTextPasteReason("function f() {\n    return 1;\n}", structure("function f() {\n    return 1;\n}", { codeBlocks: 1 })),
  null,
);

// The plain text must hold all of the HTML's text.
assert.equal(plainTextPasteReason("## Heading", structure("Heading and more", { headings: 1 })), null);
assert.equal(plainTextPasteReason("", structure("Heading", { headings: 1 })), null);
assert.equal(plainTextPasteReason("## Heading", structure("", { headings: 1 })), null);

// --- A code editor: the HTML is the plain text with colors --------------------

const tasks = "- [ ] Sign up **[Betty]**\n- **CR-0000641**\n  - **Overview tab**\n    - [ ] Complete details **[CR]**";
// Leading spaces arrive as no-break spaces in the HTML.
const coloured = tasks.replace(/^ +/gm, (spaces) => " ".repeat(spaces.length));
assert.equal(plainTextPasteReason(tasks, structure(coloured, { preformatted: "style" })), "source-text");
assert.equal(plainTextPasteReason(tasks, structure(coloured, { preformatted: "block" })), "source-text");
assert.equal(plainTextPasteReason(tasks, structure(coloured, { preformatted: "block", strong: 4 })), "source-text",
  "bold tokens are styling in a code editor");
assert.equal(plainTextPasteReason("plain words in a chat message", structure("plain words in a chat message", { preformatted: "style", strong: 1 })), null,
  "bold beside a white-space style may be a message's formatting");
assert.equal(plainTextPasteReason("first paragraph\n\nsecond paragraph",
  structure("first paragraph second paragraph", { preformatted: "style", paragraphBreaks: 1 })), null,
  "paragraphs beside a white-space style are a word processor's or a message's");
assert.equal(plainTextPasteReason(tasks, structure(coloured)), null,
  "the same text without the preformatted mark is ordinary text");
assert.equal(plainTextPasteReason(tasks + " and more", structure(coloured, { preformatted: "block" })), null,
  "source text must be the same text");
assert.equal(plainTextPasteReason("a\nb", structure("a\nb", { preformatted: "block", listItems: 1 })), null,
  "block structure beside preformatted text is not a code editor's copy");

console.log("Clipboard paste source tests passed");
