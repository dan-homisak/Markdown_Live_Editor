import { SyntaxNode, Tree } from "@lezer/common";
import {
  Autolink,
  MarkdownExtension,
  parser,
  Strikethrough,
  TaskList,
} from "@lezer/markdown";
import { markdownFrontmatterParserExtension } from "./markdownBlockSyntax";
import { markdownWikiExtension } from "./markdownWikiSyntax";

/** Tables deliberately keep their existing parser and interaction owner. */
export const markdownParserExtensions: readonly MarkdownExtension[] = [
  Strikethrough,
  TaskList,
  Autolink,
  markdownFrontmatterParserExtension,
  markdownWikiExtension,
];

/** For on-demand source actions and tests; the view uses its own syntaxTree. */
export const markdownRenderingParser = parser.configure(markdownParserExtensions);

/** Accept CodeMirror Text without materializing the entire document. */
export type MarkdownSource = string | {
  readonly length: number;
  sliceString(from: number, to?: number): string;
};

export interface MarkdownRange {
  readonly from: number;
  readonly to: number;
}

interface MarkdownMarkerBase extends MarkdownRange {
  /** Exact characters covered, excluding surrounding whitespace. */
  readonly source: string;
}

export interface MarkdownBulletMarker extends MarkdownMarkerBase {
  readonly kind: "bullet";
}

export interface MarkdownRuleMarker extends MarkdownMarkerBase {
  readonly kind: "rule";
}

export interface MarkdownTaskMarker extends MarkdownMarkerBase {
  readonly kind: "task";
  readonly checkFrom: number;
  readonly checked: boolean;
  readonly itemFrom: number;
  readonly itemTo: number;
  /** A bounded source-derived label, to be assigned as text/ARIA, never HTML. */
  readonly label: string;
}

export type MarkdownMarker =
  | MarkdownBulletMarker
  | MarkdownRuleMarker
  | MarkdownTaskMarker;

export interface MarkdownTaskEdit extends MarkdownRange {
  readonly insert: "x" | " ";
}

function slice(source: MarkdownSource, from: number, to: number): string {
  return typeof source === "string"
    ? source.slice(from, to)
    : source.sliceString(from, to);
}

export function markdownRangesOverlap(a: MarkdownRange, b: MarkdownRange): boolean {
  return a.from < b.to && a.to > b.from;
}

function protectedMarker(
  marker: MarkdownRange,
  protectedRanges: readonly MarkdownRange[],
): boolean {
  return protectedRanges.some((range) => markdownRangesOverlap(marker, range));
}

function protectedPosition(position: number, protectedRanges: readonly MarkdownRange[]): boolean {
  return protectedRanges.some((range) => range.from <= position && position < range.to);
}

/** A task belongs to the first paragraph directly owned by this list item. */
function taskForItem(source: MarkdownSource, item: SyntaxNode): MarkdownTaskMarker | null {
  let paragraph: SyntaxNode | null = null;
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "Paragraph" || child.name === "Task") {
      paragraph = child;
      break;
    }
  }
  if (!paragraph || paragraph.to - paragraph.from < 3) {
    return null;
  }
  const from = paragraph.from;
  const token = slice(source, from, from + 3);
  // Lezer's TaskList also recognizes later paragraphs and excludes markers at
  // EOL. Validate this product's narrower character subset and EOL extension
  // against the first parsed paragraph, not just a TaskMarker node.
  if (token !== "[ ]" && token !== "[x]" && token !== "[X]") {
    return null;
  }
  const following = slice(source, from + 3, Math.min(source.length, from + 4));
  if (following && !/\s/u.test(following)) {
    return null;
  }
  return {
    kind: "task",
    from,
    to: from + 3,
    source: token,
    checkFrom: from + 1,
    checked: token !== "[ ]",
    itemFrom: item.from,
    itemTo: item.to,
    label: slice(source, from + 3, Math.min(paragraph.to, from + 163))
      .split(/\r?\n/u, 1)[0]
      .trim() || "Task",
  };
}

/**
 * Classify only the requested source windows using the configured editor tree.
 * Enclosing list nodes supply task ownership even when their starts are outside
 * a window. Callers must supply a tree for this exact document and only windows
 * whose parse is ready. No parsing, mutations, DOM reads, or history are used.
 */
export function classifyMarkdownMarkers(
  source: MarkdownSource,
  tree: Tree,
  protectedRanges: readonly MarkdownRange[] = [],
  visibleRanges: readonly MarkdownRange[] = [{ from: 0, to: source.length }],
): MarkdownMarker[] {
  const markers: MarkdownMarker[] = [];
  const seen = new Set<string>();
  const add = (marker: MarkdownMarker, window: MarkdownRange): void => {
    if (
      !markdownRangesOverlap(marker, window) ||
      protectedMarker(marker, protectedRanges)
    ) {
      return;
    }
    const key = `${marker.kind}:${marker.from}`;
    if (!seen.has(key)) {
      seen.add(key);
      markers.push(marker);
    }
  };
  for (const window of visibleRanges) {
    if (window.from >= window.to) {
      continue;
    }
    tree.iterate({
      from: Math.max(0, window.from),
      to: Math.min(source.length, window.to),
      enter(reference) {
        const node = reference.node;
        if (literalNodeNames.has(node.name)) {
          return false;
        }
        if (node.name === "ListItem") {
          const task = taskForItem(source, node);
          if (task) {
            add(task, window);
          }
        } else if (
          node.name === "ListMark" &&
          node.parent?.parent?.name === "BulletList"
        ) {
          const token = slice(source, node.from, node.to);
          if (token === "-" || token === "+" || token === "*") {
            add({ kind: "bullet", from: node.from, to: node.to, source: token }, window);
          }
        } else if (node.name === "HorizontalRule") {
          const token = slice(source, node.from, node.to).replace(/[\t ]+$/u, "");
          if (token && !/[\r\n]/u.test(token)) {
            add({
              kind: "rule",
              from: node.from,
              to: node.from + token.length,
              source: token,
            }, window);
          }
        }
      },
    });
  }
  return markers.sort((a, b) => a.from - b.from || a.to - b.to);
}

const literalNodeNames = new Set([
  "FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "HTMLTag", "Comment", "MarkdownFrontmatter",
]);

function positionAfterLeadingIndent(source: MarkdownSource, position: number): number {
  // Block nodes exclude their leading indentation. Associate that indentation
  // with its own row's construct so a caret before nested ordinary-list/code
  // content cannot accidentally operate on an enclosing parent task.
  for (let offset = position - 1; offset >= 0; offset--) {
    const character = slice(source, offset, offset + 1);
    if (character === "\n" || character === "\r") break;
    if (character !== " " && character !== "\t") return position;
  }
  let next = position;
  while (next < source.length && /[\t ]/u.test(slice(source, next, next + 1))) next++;
  const character = slice(source, next, next + 1);
  return character && character !== "\n" && character !== "\r" ? next : position;
}

function enclosingItem(tree: Tree, position: number): SyntaxNode | null {
  // Prefer a construct beginning at the caret. At a construct's trailing edge,
  // the left association retains ordinary end-of-line caret targeting.
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(position, side); node; node = node.parent) {
      if (literalNodeNames.has(node.name)) {
        return null;
      }
      if (node.name === "ListItem") {
        return node;
      }
    }
  }
  return null;
}

/** The nearest list item must itself be a task; never climb to a parent task. */
export function findTaskAtCaret(
  source: MarkdownSource,
  tree: Tree,
  position: number,
  protectedRanges: readonly MarkdownRange[] = [],
): MarkdownTaskMarker | null {
  if (
    !Number.isInteger(position) || position < 0 || position > source.length ||
    position > tree.length || protectedPosition(position, protectedRanges)
  ) {
    return null;
  }
  const syntaxPosition = positionAfterLeadingIndent(source, position);
  if (protectedPosition(syntaxPosition, protectedRanges)) return null;
  const item = enclosingItem(tree, syntaxPosition);
  const task = item && taskForItem(source, item);
  return task && !protectedMarker(task, protectedRanges) ? task : null;
}

/**
 * Revalidate a marker against the current source/tree before constructing the
 * smallest edit. The caller must also check composition, effective selection,
 * enablement, and host read-only state, then use the existing mutation queue.
 */
export function planTaskToggle(
  source: MarkdownSource,
  tree: Tree,
  markerFrom: number,
  protectedRanges: readonly MarkdownRange[] = [],
): MarkdownTaskEdit | null {
  const task = findTaskAtCaret(source, tree, markerFrom, protectedRanges);
  if (!task || task.from !== markerFrom) {
    return null;
  }
  return {
    from: task.checkFrom,
    to: task.checkFrom + 1,
    insert: task.checked ? " " : "x",
  };
}
