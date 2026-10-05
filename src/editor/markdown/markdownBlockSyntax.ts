import { Input, PartialParse, SyntaxNode } from "@lezer/common";
import { MarkdownExtension } from "@lezer/markdown";
import type { MarkdownSource } from "./markdownSyntax";

export type MarkdownAlertType = "note" | "tip" | "important" | "warning" | "caution";
export interface MarkdownAlertLabel {
  readonly type: MarkdownAlertType;
  readonly from: number;
  readonly to: number;
  readonly title?: string;
  readonly name?: string;
  readonly headerTo?: number;
  readonly collapsed?: boolean;
}

/** One shared quote-leading alert policy for passive inline and block owners. */
export function markdownAlertForQuote(source: MarkdownSource, quote: SyntaxNode): MarkdownAlertLabel | null {
  const first = quote.firstChild;
  const paragraph = first?.name === "QuoteMark" ? first.nextSibling : first;
  if (paragraph?.name !== "Paragraph") return null;
  const read = (from: number, to: number): string => typeof source === "string" ? source.slice(from, to) : source.sliceString(from, to);
  if (read(quote.from, paragraph.from).includes("\n")) return null;
  let header = "";
  for (let position = paragraph.from; position < paragraph.to;) {
    const chunk = read(position, Math.min(paragraph.to, position + 4096));
    const newline = chunk.search(/[\r\n]/u);
    header += newline < 0 ? chunk : chunk.slice(0, newline);
    if (newline >= 0 || !chunk) break;
    position += chunk.length;
  }
  const match = /^\[!([a-z]+)\]([+-])?(?:[ \t]+(.*))?$/iu.exec(header.trimEnd());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const aliases: Record<string, MarkdownAlertType> = {
    note: "note", info: "note", todo: "note", abstract: "note", summary: "note", tldr: "note",
    tip: "tip", hint: "tip", success: "tip", check: "tip", done: "tip",
    important: "important", example: "important", quote: "note", cite: "note",
    question: "warning", help: "warning", faq: "warning", warning: "warning", attention: "warning",
    caution: "caution", failure: "caution", fail: "caution", missing: "caution", danger: "caution", error: "caution", bug: "caution",
  };
  return { type: aliases[name] ?? "note", from: paragraph.from, to: paragraph.from + match[1].length + 3,
    name, title: match[3]?.trim(), headerTo: paragraph.from + header.length,
    ...(match[2] ? { collapsed: match[2] === "-" } : {}) };
}

export interface MarkdownFrontmatterBounds {
  readonly from: number;
  readonly openingTo: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly closingFrom: number;
  readonly to: number;
}

interface SourceReader {
  readonly length: number;
  read(from: number, to: number): string;
}

/** A delimiter recognizer with constant retained memory, even for long lines. */
function delimiterLine(source: SourceReader, chunkAt: (position: number) => string, from: number, opening: boolean) {
  let position = from, dashes = 0, valid = true, first = true, end = from, carriageReturn = false;
  while (position < source.length) {
    const chunk = chunkAt(position);
    for (let index = 0; index < chunk.length; index++, position++) {
      const ch = chunk.charCodeAt(index);
      if (ch === 10) return { valid: valid && dashes === 3, end, next: position + 1 };
      if (carriageReturn) valid = false;
      if (first && opening && ch === 0xfeff) { first = false; end = position + 1; continue; }
      first = false;
      if (dashes < 3) {
        if (ch === 45) dashes++;
        else valid = false;
      } else if (ch !== 32 && ch !== 9 && ch !== 13) valid = false;
      // The source model normally uses LF. Exclude a CR from a CRLF delimiter.
      if (ch !== 13) end = position + 1;
      carriageReturn = ch === 13;
      if (opening && !valid) return { valid: false, end, next: position + 1 };
    }
    if (!chunk.length) break;
  }
  return { valid: valid && dashes === 3, end, next: source.length };
}

/**
 * Look ahead only for the optional first-document frontmatter candidate. No
 * closer means ordinary Markdown, not an unterminated custom literal block.
 * The first parse may inspect the candidate extent; callers never run this on
 * selection/theme updates, and no complete document string is materialized.
 */
export function findMarkdownFrontmatter(source: SourceReader): MarkdownFrontmatterBounds | null {
  // Reuse a chunk across short lines, avoiding a 4096-character copy for every
  // line of a long candidate. Each source chunk is read at most once per scan.
  let cachedFrom = -1, cached = "";
  const chunkAt = (position: number): string => {
    if (position < cachedFrom || position >= cachedFrom + cached.length) {
      cachedFrom = position;
      cached = source.read(position, Math.min(source.length, position + 4096));
    }
    return cached.slice(position - cachedFrom);
  };
  const opening = delimiterLine(source, chunkAt, 0, true);
  if (!opening.valid || opening.next >= source.length) return null;
  for (let start = opening.next; start < source.length;) {
    const closing = delimiterLine(source, chunkAt, start, false);
    if (closing.valid) return {
      from: 0, openingTo: opening.end, contentFrom: opening.next,
      contentTo: start, closingFrom: start, to: closing.end,
    };
    if (closing.next <= start) break;
    start = closing.next;
  }
  return null;
}

interface ParseInputContext {
  readonly input: Input;
  bounds?: MarkdownFrontmatterBounds | null;
}

// Public Markdown BlockContext exposes only one-line lookahead. A public parse
// wrapper supplies its Input for the synchronous advance containing parseBlock.
// The stack discipline also supports interleaved/reentrant independent parses;
// it does not inspect private parser fields or retain documents after parsing.
let activeInput: ParseInputContext | undefined;

export const markdownFrontmatterParserExtension: MarkdownExtension = {
  defineNodes: [
    { name: "MarkdownFrontmatter", block: true },
    "MarkdownFrontmatterMark",
    "MarkdownFrontmatterContent",
  ],
  parseBlock: [{
    name: "MarkdownFrontmatter",
    before: "HorizontalRule",
    parse(context, line) {
      if (context.lineStart !== 0 || !activeInput) return false;
      const bounds = activeInput.bounds === undefined
        ? (activeInput.bounds = findMarkdownFrontmatter(activeInput.input))
        : activeInput.bounds;
      if (!bounds) return false;
      const children = [context.elt("MarkdownFrontmatterMark", bounds.from, bounds.openingTo)];
      if (bounds.contentFrom < bounds.contentTo) {
        children.push(context.elt("MarkdownFrontmatterContent", bounds.contentFrom, bounds.contentTo));
      }
      children.push(context.elt("MarkdownFrontmatterMark", bounds.closingFrom, bounds.to));
      // The closer was established without consuming parser state. Consume the
      // exact leaf now, including its closing delimiter, then resume Markdown.
      while (context.lineStart < bounds.closingFrom && context.nextLine()) { /* advance */ }
      context.nextLine();
      context.addElement(context.elt("MarkdownFrontmatter", 0, bounds.to, children));
      return true;
    },
  }],
  wrap(inner, input): PartialParse {
    const current: ParseInputContext = { input };
    return {
      get parsedPos() { return inner.parsedPos; },
      get stoppedAt() { return inner.stoppedAt; },
      stopAt(position) { inner.stopAt(position); },
      advance() {
        const previous = activeInput;
        activeInput = current;
        try { return inner.advance(); }
        finally { activeInput = previous; }
      },
    };
  },
};
