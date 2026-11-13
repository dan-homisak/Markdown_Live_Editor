/**
 * Delayed column resizing while typing in a table cell.
 *
 * Column widths normally follow the text on every keystroke. With a delay set
 * (`markdownLiveRenderTables.tableLayout.typingResizeDelay`), the widths a
 * table had when a run of typing began stay in place until typing has paused
 * for that long; text that outgrows its cell wraps inside it meanwhile. The
 * widths are released at once when anything but the typed text changes: the
 * focused cell, the table's shape or the width available to the table.
 */

/** Longest delay the setting accepts, in milliseconds. */
export const MAX_TABLE_RESIZE_DELAY_MS = 5000;

/** A usable delay in milliseconds: a whole number from 0 to the maximum. */
export function normalizeTableResizeDelay(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(MAX_TABLE_RESIZE_DELAY_MS, Math.round(value)));
}

/** What a table's column widths were held for. */
export interface TableResizeHold {
  /** Time, on the clock `now` is read from, at which the hold ends. */
  until: number;
  /** The layout the widths were kept for; see `tableResizeHoldKey`. */
  key: string;
}

/**
 * Identifies everything the held widths depend on except the typed text.
 * Widths are kept only while this stays the same.
 */
export function tableResizeHoldKey(layout: {
  columnCount: number;
  rowCount: number;
  availableWidthCh: number | undefined;
  cell: { rowKind: string; rowIndex: number; column: number };
}): string {
  const width = layout.availableWidthCh === undefined ? "auto" : layout.availableWidthCh.toFixed(1);
  return [layout.columnCount, layout.rowCount, width, layout.cell.rowKind, layout.cell.rowIndex, layout.cell.column].join(":");
}

/** Whether a layout pass at `now` must leave the column widths as they are. */
export function tableResizeHeld(hold: TableResizeHold | undefined, now: number, key: string | null): boolean {
  return hold !== undefined && key !== null && now < hold.until && hold.key === key;
}
