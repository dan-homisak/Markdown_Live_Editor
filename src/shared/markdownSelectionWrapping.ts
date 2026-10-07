import { MarkdownSource } from "../editor/markdown/markdownSyntax";

export interface MarkdownWrapSelection { anchor: number; head: number }
export interface MarkdownWrapEdit {
  from: number;
  to: number;
  insert: string;
  selection: MarkdownWrapSelection;
}

function slice(source: MarkdownSource, from: number, to: number): string {
  return typeof source === "string" ? source.slice(from, to) : source.sliceString(from, to);
}

const pairs: Readonly<Record<string, string>> = {
  "*": "*", "_": "_", "~": "~", "=": "=", "^": "^", "$": "$",
  "(": ")", "{": "}", "<": ">", '"': '"', "'": "'",
};

/** Wrap only the selected payload, retaining its selection and direction. */
export function planMarkdownSelectionWrap(
  source: MarkdownSource,
  selection: MarkdownWrapSelection,
  character: string,
  options: { inlineOnly?: boolean } = {},
): MarkdownWrapEdit | null {
  if (character.length !== 1 ||
      (character !== "`" && character !== "[" && character !== "!" && !pairs[character])) return null;
  const { anchor, head } = selection;
  if (!Number.isInteger(anchor) || !Number.isInteger(head) ||
      anchor < 0 || head < 0 || anchor > source.length || head > source.length || anchor === head) return null;
  const start = Math.min(anchor, head), end = Math.max(anchor, head);
  const payload = slice(source, start, end);
  const at = (from: number, to: number): string => slice(source, Math.max(0, from), Math.min(source.length, to));
  const edit = (from: number, to: number, prefix: string, suffix: string): MarkdownWrapEdit => {
    const selectedFrom = from + prefix.length, selectedTo = selectedFrom + payload.length;
    return { from, to, insert: prefix + payload + suffix,
      selection: anchor < head ? { anchor: selectedFrom, head: selectedTo } : { anchor: selectedTo, head: selectedFrom } };
  };

  if (character === "[") {
    if (at(start - 1, start) === "[" && at(end, end + 3) === "]()") {
      return edit(start - 1, end + 3, "[[", "]]");
    }
    // Existing brackets (including wikilinks) grow symmetrically without
    // consuming a nonempty link destination authored by the user.
    if (at(start - 1, start) === "[" && at(end, end + 1) === "]") {
      return edit(start, end, "[", "]");
    }
    return edit(start, end, "[", "]()");
  }
  if (character === "!") {
    if (at(start - 2, start) === "[[" && at(end, end + 2) === "]]") {
      return edit(start - 2, end + 2, "![[", "]]");
    }
    if (at(start - 1, start) === "[" && at(end, end + 1) === "]") {
      return edit(start - 1, end + 1, "![", "]");
    }
    return edit(start, end, "![", "]()");
  }
  if (character !== "`") {
    return pairs[character] ? edit(start, end, character, pairs[character]) : null;
  }

  let left = start, right = end, surrounding = 0;
  // Retained payload selections may be separated from their delimiters by
  // CommonMark padding or by the two line breaks of a fenced block.
  for (const gap of ["", " ", "\n"]) {
    if (gap && (at(start - 1, start) !== gap || at(end, end + 1) !== gap)) continue;
    const before = start - gap.length, after = end + gap.length;
    let opening = before, closing = after;
    while (opening > 0 && at(opening - 1, opening) === "`") opening--;
    while (closing < source.length && at(closing, closing + 1) === "`") closing++;
    const width = before - opening;
    if (width && width === closing - after && (gap !== "\n" ||
        (!options.inlineOnly && width >= 3 && (!opening || at(opening - 1, opening) === "\n") &&
          (closing === source.length || at(closing, closing + 1) === "\n")))) {
      left = opening; right = closing; surrounding = width;
      break;
    }
  }
  const longestRun = Array.from(payload.matchAll(/`+/g), match => match[0].length)
    .reduce((longest, length) => Math.max(longest, length), 0);
  let width = Math.max(surrounding + 1, longestRun + 1);
  if (!options.inlineOnly && (width >= 3 || payload.includes("\n"))) {
    width = Math.max(3, width);
    const fence = "`".repeat(width);
    // Mid-paragraph selections need standalone fences on both sides.
    const before = left > 0 && at(left - 1, left) !== "\n" ? "\n" : "";
    const after = right < source.length && at(right, right + 1) !== "\n" ? "\n" : "";
    return edit(left, right, before + fence + "\n", "\n" + fence + after);
  }
  const ticks = "`".repeat(width);
  // CommonMark strips one padding space; add it when the payload touches a
  // backtick or has significant spaces at both edges.
  const padding = payload.startsWith("`") || payload.endsWith("`") ||
    (payload.startsWith(" ") && payload.endsWith(" ") && /[^ ]/.test(payload)) ? " " : "";
  return edit(left, right, ticks + padding, padding + ticks);
}
