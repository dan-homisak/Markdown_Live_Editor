/**
 * Markdown text escaping for HTML-to-Markdown paste (turndown).
 *
 * Identical to turndown's default escaping except for underscores. Turndown
 * escapes every `_`, so pasted fill-in blanks (`Work order: ____`) and
 * identifiers (`snake_case`) arrive as `\_\_\_\_` and `snake\_case`. An
 * underscore run only needs escaping when CommonMark could treat it as an
 * emphasis delimiter: left-flanking and able to open, or right-flanking and
 * able to close. Runs that can do neither are left as written.
 *
 * Text boundaries count as whitespace, as the start and end of a line do in
 * CommonMark.
 */

// Turndown 7's escapes, in order, minus its unconditional underscore rule.
const ESCAPES: ReadonlyArray<[RegExp, string]> = [
  [/\\/g, "\\\\"],
  [/\*/g, "\\*"],
  [/^-/g, "\\-"],
  [/^\+ /g, "\\+ "],
  [/^(=+)/g, "\\$1"],
  [/^(#{1,6}) /g, "\\$1 "],
  [/`/g, "\\`"],
  [/^~~~/g, "\\~~~"],
  [/\[/g, "\\["],
  [/\]/g, "\\]"],
  [/^>/g, "\\>"],
  [/^(\d+)\. /g, "$1\\. "],
];

const whitespace = /^\s$/u;
const punctuation = /^[\p{P}\p{S}]$/u;

export function escapeMarkdownText(text: string): string {
  // None of the rules above touches an underscore, so the k-th underscore run
  // of the escaped text is exactly the k-th run of the original text.
  const decisions = Array.from(text.matchAll(/_+/g), (match) =>
    underscoreRunCanDelimit(text[match.index - 1], text[match.index + match[0].length]));
  const escaped = ESCAPES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
  let run = 0;
  return escaped.replace(/_+/g, (underscores) =>
    decisions[run++] ? underscores.replace(/_/g, "\\_") : underscores);
}

/** CommonMark: whether an underscore run can open or close emphasis. */
export function underscoreRunCanDelimit(before: string | undefined, after: string | undefined): boolean {
  const beforeSpace = before === undefined || whitespace.test(before);
  const afterSpace = after === undefined || whitespace.test(after);
  const beforePunctuation = before !== undefined && punctuation.test(before);
  const afterPunctuation = after !== undefined && punctuation.test(after);
  const leftFlanking = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
  const rightFlanking = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
  const canOpen = leftFlanking && (!rightFlanking || beforePunctuation);
  const canClose = rightFlanking && (!leftFlanking || afterPunctuation);
  return canOpen || canClose;
}
