/**
 * Deciding what to paste when the clipboard holds both HTML and plain text.
 *
 * Many applications put the same content on the clipboard twice: rendered as
 * HTML, and as plain text. Converting the HTML back to Markdown is right when
 * the plain text is only the visible words of a web page or a word processor.
 * It is wrong when the plain text is already the source:
 *
 * - A Markdown editor or a chat assistant copies its Markdown as the plain
 *   text and a rendering of it as the HTML. Converting the rendering back
 *   loses the author's syntax: a heading comes back in another style, and a
 *   line that follows a list comes back inside the list item.
 * - A code editor copies its text as the plain text and the same text with
 *   colors as the HTML. Converting that escapes every `*`, `[` and leading `-`.
 *
 * In both cases the plain text is pasted unchanged. Everything here is pure;
 * the caller summarizes the sanitized HTML into `HtmlClipboardStructure`.
 */

export interface HtmlClipboardStructure {
  /** The HTML's text content in document order. */
  text: string;
  /**
   * How strongly the HTML says it is source text with colors:
   * - `block`: it holds a `<pre>` that is not a rendered code block (its first
   *   child is not a `<code>`), as code editors write;
   * - `style`: an inline style keeps white space or names a monospace font, as
   *   VS Code's editors write, and as a browser writes for text it copies
   *   from such an element;
   * - `none`: neither.
   */
  preformatted: "block" | "style" | "none";
  headings: number;
  listItems: number;
  tables: number;
  /** Pairs of paragraphs that follow each other directly. */
  paragraphBreaks: number;
  links: number;
  images: number;
  /** `<pre>` elements whose first child is a `<code>`: rendered code blocks. */
  codeBlocks: number;
  inlineCode: number;
  quotes: number;
  strong: number;
  emphasis: number;
  strike: number;
  rules: number;
}

export type PlainTextPasteReason = "source-text" | "markdown-source";

/**
 * Whether to paste the plain text as it is, and why; null to convert the HTML.
 *
 * - `source-text`: the HTML is preformatted, has no block structure, and its
 *   text is the plain text. Inside a `<pre>`, bold and italic are a code
 *   editor's token styling; where only a style marks the text as preformatted
 *   they may be a message's formatting, so they rule this answer out, as do
 *   paragraphs that follow each other.
 * - `markdown-source`: the HTML has structure, the plain text contains all of
 *   the HTML's text, and it writes every kind of structure the HTML has in
 *   Markdown syntax.
 *
 * The answer is null whenever that cannot be shown, so a web page or a word
 * processor, whose plain text has no syntax, is converted as before.
 */
export function plainTextPasteReason(
  plain: string,
  html: HtmlClipboardStructure,
): PlainTextPasteReason | null {
  const htmlText = withoutWhiteSpace(html.text);
  const plainText = withoutWhiteSpace(plain);
  if (htmlText.length === 0 || plainText.length === 0) {
    return null;
  }
  const blocks = html.headings + html.listItems + html.tables + html.links + html.images +
    html.codeBlocks + html.quotes + html.rules;
  const inline = html.inlineCode + html.strong + html.emphasis + html.strike;
  if (
    blocks === 0 && htmlText === plainText &&
    (html.preformatted === "block" ||
      // A style alone is weaker evidence: word processors and chat messages
      // keep white space too. Paragraphs or inline formatting rule it out.
      (html.preformatted === "style" && inline === 0 && html.paragraphBreaks === 0))
  ) {
    return "source-text";
  }
  if (blocks + inline === 0) {
    // Without structure the HTML adds nothing, but converting it still escapes
    // Markdown characters, which is right for words copied from a web page.
    return null;
  }
  if (!isSubsequence(htmlText, plainText)) {
    return null;
  }
  const lines = plain.split(/\r\n?|\n/);
  const written =
    countMatching(lines, /^ {0,3}#{1,6}(?:[ \t]|$)/) + countSetextUnderlines(lines) >= html.headings &&
    countMatching(lines, /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/) >= html.listItems &&
    countMatching(lines, /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/) -
      countMatching(lines, /^[ \t]*-+[ \t]*$/) >= html.tables &&
    (plain.match(/\n[ \t]*\n/g)?.length ?? 0) >= html.paragraphBreaks &&
    (html.links === 0 || /\]\(|\]\[|\]:|\[\[|<[a-z][a-z0-9+.-]*:[^\s>]*>|\bhttps?:\/\/|\bwww\.|(?:^|\s)#[\p{L}\p{N}_/-]+/iu.test(plain)) &&
    (html.images === 0 || /!\[/.test(plain)) &&
    // A fence opens and closes each block. Indented code is not accepted: the
    // text of a code block copied from a web page is indented too.
    countMatching(lines, /^ {0,3}(?:>[ \t]*)*(?:```|~~~)/) >= 2 * html.codeBlocks &&
    (html.inlineCode === 0 || plain.includes("`")) &&
    (html.quotes === 0 || lines.some((line) => /^ {0,3}>/.test(line))) &&
    (html.strong === 0 || /\*\*|__/.test(plain)) &&
    (html.emphasis === 0 || /[*_]/.test(plain)) &&
    (html.strike === 0 || plain.includes("~~")) &&
    (html.rules === 0 || lines.some((line) => /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)));
  return written ? "markdown-source" : null;
}

function withoutWhiteSpace(value: string): string {
  return value.replace(/[\s ​‌‍﻿]+/g, "");
}

/** Whether every character of `needle` occurs in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (let index = 0; index < haystack.length && at < needle.length; index++) {
    if (haystack[index] === needle[at]) at++;
  }
  return at === needle.length;
}

function countMatching(lines: readonly string[], pattern: RegExp): number {
  return lines.reduce((count, line) => count + (pattern.test(line) ? 1 : 0), 0);
}

/** Lines of `=` or `-` directly under a line of text: setext headings. */
function countSetextUnderlines(lines: readonly string[]): number {
  let count = 0;
  for (let index = 1; index < lines.length; index++) {
    if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index]) && lines[index - 1].trim().length > 0 &&
        !/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index - 1])) {
      count++;
    }
  }
  return count;
}
