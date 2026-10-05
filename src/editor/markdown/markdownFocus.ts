import { EditorSelection, Text } from "@codemirror/state";
import { MarkdownRange } from "./markdownSyntax";

/**
 * A released checkbox returns to the latest source selection. The bookmark is
 * eligible only when that selection is still the one captured at release.
 * Host replacements can map it before the queued focus return runs.
 */
export function taskFocusReturnSelection(
  doc: Pick<Text, "length" | "sliceString">,
  selectionAtRelease: EditorSelection,
  currentSelection: EditorSelection,
  bookmark: number | null,
  tables: readonly MarkdownRange[],
): EditorSelection {
  const useBookmark = currentSelection === selectionAtRelease &&
    currentSelection.ranges.length === 1 && currentSelection.main.empty;
  // Include the newline consumed by the existing table replacement. Merge
  // adjacent spans so a fallback never lands in another protected table.
  const protectedRanges: { from: number; to: number }[] = [];
  for (const table of tables) {
    const to = table.to < doc.length && doc.sliceString(table.to, table.to + 1) === "\n"
      ? table.to + 1 : table.to;
    const previous = protectedRanges[protectedRanges.length - 1];
    if (previous && table.from <= previous.to) previous.to = Math.max(previous.to, to);
    else protectedRanges.push({ from: table.from, to });
  }
  const ranges = currentSelection.ranges.map(range => {
    // Nonempty selections, including mixed table/prose envelopes, remain exact.
    if (!range.empty) return range;
    let head = Math.max(0, Math.min(doc.length, useBookmark ? bookmark ?? range.head : range.head));
    const table = protectedRanges.find(candidate => head >= candidate.from && head < candidate.to);
    if (table) {
      const before = table.from - 1;
      head = before >= 0 && head - before <= table.to - head ? before : table.to;
    }
    return head === range.head ? range : EditorSelection.cursor(head, 1);
  });
  return ranges.every((range, index) => range === currentSelection.ranges[index])
    ? currentSelection
    : EditorSelection.create(ranges, currentSelection.mainIndex);
}
