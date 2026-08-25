import { measureTableColumnSizing } from "../../shared/tableColumnSizing";
import {
  ParsedTable,
  rowToDisplayValues,
} from "../../shared/tableModel";

/**
 * Mutable per-editor geometry used by off-screen table widgets.
 *
 * CodeMirror asks a widget for a pixel height before creating its DOM. Keeping
 * these values in one editor-owned object lets every existing widget answer
 * with the latest font/zoom/viewport metrics without rebuilding its source
 * model. The geometry plugin refreshes CodeMirror's height map after updating
 * this object.
 */
export interface TableHeightEstimateMetrics {
  lineHeightPx: number;
  chWidthPx: number;
  /** Width left after the native gutter and editor right padding. */
  availableDataWidthPx: number | undefined;
  revision: number;
}

export interface MeasuredTableHeightEstimateMetrics {
  lineHeightPx: number;
  chWidthPx: number;
  availableDataWidthPx: number | undefined;
}

const DEFAULT_EDITOR_LINE_HEIGHT_PX = 19;
const DEFAULT_CH_WIDTH_PX = 8;
const TABLE_ROW_VERTICAL_CHROME_PX = 2;
const TABLE_SCROLLBAR_HEIGHT_PX = 8;
const CELL_HORIZONTAL_PADDING_CH = 2;
const METRIC_EPSILON_PX = 0.01;

export function createTableHeightEstimateMetrics(): TableHeightEstimateMetrics {
  return {
    lineHeightPx: DEFAULT_EDITOR_LINE_HEIGHT_PX,
    chWidthPx: DEFAULT_CH_WIDTH_PX,
    availableDataWidthPx: undefined,
    revision: 0,
  };
}

/** Applies browser-measured values and reports whether estimates changed. */
export function updateTableHeightEstimateMetrics(
  metrics: TableHeightEstimateMetrics,
  measured: MeasuredTableHeightEstimateMetrics,
): boolean {
  const lineHeightPx = positiveOrFallback(
    measured.lineHeightPx,
    metrics.lineHeightPx,
  );
  const chWidthPx = positiveOrFallback(measured.chWidthPx, metrics.chWidthPx);
  const availableDataWidthPx =
    measured.availableDataWidthPx === undefined
      ? undefined
      : Math.max(0, measured.availableDataWidthPx);
  const changed =
    Math.abs(metrics.lineHeightPx - lineHeightPx) > METRIC_EPSILON_PX ||
    Math.abs(metrics.chWidthPx - chWidthPx) > METRIC_EPSILON_PX ||
    optionalNumberChanged(
      metrics.availableDataWidthPx,
      availableDataWidthPx,
    );
  if (!changed) {
    return false;
  }

  metrics.lineHeightPx = lineHeightPx;
  metrics.chWidthPx = chWidthPx;
  metrics.availableDataWidthPx = availableDataWidthPx;
  metrics.revision++;
  return true;
}

/**
 * Estimates the final rendered height using current font and viewport data.
 * This includes wrapping, explicit cell line breaks, row borders, and the
 * custom scrollbar used when a table cannot fit its viewport.
 */
export function estimateRenderedTableHeight(
  table: ParsedTable,
  metrics: TableHeightEstimateMetrics,
): number {
  const availableDataWidthCh = estimateAvailableDataWidthCh(
    metrics,
    table.columnCount,
  );
  const columnSizing = measureTableColumnSizing(
    table,
    availableDataWidthCh,
  );
  const rows = [table.header, ...table.body];
  const rowsHeight = rows.reduce((height, row) => {
    const values = rowToDisplayValues(row, table.columnCount);
    const visualLineCount = Math.max(
      1,
      ...values.map((value, column) =>
        estimateCellVisualLineCount(
          value,
          columnSizing.columns[column]?.widthCh ?? 1,
        ),
      ),
    );
    return (
      height +
      visualLineCount * metrics.lineHeightPx +
      TABLE_ROW_VERTICAL_CHROME_PX
    );
  }, 0);
  const scrollbarHeight =
    availableDataWidthCh !== undefined &&
    columnSizing.dataWidthCh > availableDataWidthCh + METRIC_EPSILON_PX
      ? TABLE_SCROLLBAR_HEIGHT_PX
      : 0;
  return rowsHeight + scrollbarHeight;
}

export function estimateAvailableDataWidthCh(
  metrics: TableHeightEstimateMetrics,
  columnCount: number,
): number | undefined {
  if (
    metrics.availableDataWidthPx === undefined ||
    metrics.chWidthPx <= 0
  ) {
    return undefined;
  }

  // Match tableLayout's allowance for cell borders and fractional-ch
  // rounding so the estimate and first DOM layout choose the same columns.
  const borderAllowancePx = columnCount + 2;
  return (
    Math.max(0, metrics.availableDataWidthPx - borderAllowancePx) /
    metrics.chWidthPx
  );
}

/** Converts a measured screen-space rectangle back to CodeMirror CSS pixels. */
export function screenPixelsToCssPixels(
  value: number,
  scaleY: number,
): number {
  const safeScale = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  return Math.max(0, value / safeScale);
}

function estimateCellVisualLineCount(
  value: string,
  columnWidthCh: number,
): number {
  const contentWidthCh = Math.max(
    1,
    columnWidthCh - CELL_HORIZONTAL_PADDING_CH,
  );
  return value.split("\n").reduce(
    (count, line) =>
      count + Math.max(1, Math.ceil(estimateTextWidthCh(line) / contentWidthCh)),
    0,
  );
}

function estimateTextWidthCh(value: string): number {
  // Table text uses a monospace editor font. Code points are a closer width
  // proxy than UTF-16 code units for emoji, while tabs follow a four-column
  // editor convention. Browser measurement remains authoritative on mount.
  return Array.from(value).reduce(
    (width, character) => width + (character === "\t" ? 4 : 1),
    0,
  );
}

function optionalNumberChanged(
  previous: number | undefined,
  next: number | undefined,
): boolean {
  return previous === undefined || next === undefined
    ? previous !== next
    : Math.abs(previous - next) > METRIC_EPSILON_PX;
}

function positiveOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
