/**
 * Pure rules for copying from and pasting into several selections at once,
 * as the stock editor does it.
 */

/** Several selections are copied one to a line, in document order. */
export function joinCopiedSelections(texts: readonly string[]): string {
  return texts.join("\n");
}

/**
 * What each of `count` selections receives from pasted text: one line each when
 * the text has exactly as many lines as there are selections, otherwise the
 * whole text. A single trailing line break does not count as a line.
 */
export function distributePaste(text: string, count: number): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
  if (count > 1 && lines.length === count) return lines;
  return Array.from({ length: Math.max(0, count) }, () => normalized);
}
