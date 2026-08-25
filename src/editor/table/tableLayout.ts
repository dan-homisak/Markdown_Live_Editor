import {
  measureTableColumnSizing,
  TableColumnSizing,
} from "../../shared/tableColumnSizing";
import { EditorView } from "@codemirror/view";
import { ParsedTable } from "../../shared/tableModel";
import { screenPixelsToCssPixels } from "./tableHeightEstimate";
import {
  cancelElementAnimationFrame,
  requestElementAnimationFrame,
} from "./cellSelection";
import {
  getTableWidgetTable,
  readActiveCellSizingOverride,
  setTableWidgetCleanup,
} from "./tableWidgetState";
import { syncTableSelectionOverlay } from "./tableSelectionOverlay";

/** Per-element cache of the measured width of one `ch`, keyed by font style. */
const chWidthCache = new WeakMap<HTMLElement, { key: string; width: number }>();

/**
 * Per-element cache of resolved CSS length values (e.g. custom properties
 * that reference other custom properties). Avoids inserting a probe element
 * and forcing layout on every table patch.
 */
const cssLengthCache = new WeakMap<HTMLElement, Map<string, number>>();

/**
 * Builds the `<colgroup>` that pins the line-number column to the gutter
 * width and gives each data column its measured `ch` width. Combined with
 * `table-layout: fixed`, column widths never depend on incremental content
 * layout, which keeps rendering stable while typing.
 */
export function appendColumnSizing(
  tableElement: HTMLTableElement,
  table: ParsedTable,
  columnSizing: TableColumnSizing,
): void {
  const colgroup = document.createElement("colgroup");

  const lineNumberCol = document.createElement("col");
  lineNumberCol.className = "mlrt-table-source-line-col";
  colgroup.append(lineNumberCol);

  for (let column = 0; column < table.columnCount; column++) {
    const col = document.createElement("col");
    col.className = "mlrt-table-sized-col";
    col.style.width = `${columnSizing.columns[column].widthCh.toFixed(4)}ch`;
    colgroup.append(col);
  }

  tableElement.append(colgroup);
}

/** Applies measured column widths to the existing `<col>` elements. */
export function applyColumnSizing(
  wrapper: HTMLElement,
  columnSizing: TableColumnSizing,
): void {
  wrapper.style.setProperty(
    "--mlrt-table-data-width",
    `${columnSizing.dataWidthCh.toFixed(4)}ch`,
  );
  wrapper
    .querySelectorAll<HTMLTableColElement>(".mlrt-table-sized-col")
    .forEach((col, column) => {
      col.style.width = `${(columnSizing.columns[column]?.widthCh ?? 1).toFixed(
        4,
      )}ch`;
    });
}

/** Re-measures column sizing for the widget's current table and applies it. */
export function applyCurrentColumnSizing(
  wrapper: HTMLElement,
  table: ParsedTable,
): void {
  applyColumnSizing(
    wrapper,
    measureTableColumnSizing(
      table,
      measureAvailableDataWidthCh(wrapper),
      readActiveCellSizingOverride(wrapper),
    ),
  );
}

/**
 * Wires the widget's self-managed layout: column sizing, wrapper height, and
 * the custom horizontal scrollbar. Layout runs at most once per animation
 * frame and re-runs whenever the table or its scroll container resizes.
 *
 * Returns the scheduler so editing code can request a layout pass after
 * content changes.
 */
export function bindTableLayout(
  wrapper: HTMLElement,
  tableScroll: HTMLElement,
  tableElement: HTMLTableElement,
  scrollbar: HTMLElement,
  scrollbarThumb: HTMLElement,
  table: ParsedTable,
  view: EditorView,
): () => void {
  const syncScrollbar = () =>
    syncTableScrollbar(tableScroll, scrollbar, scrollbarThumb);
  let pendingAnimationFrame = 0;
  const syncLayout = () => {
    pendingAnimationFrame = 0;
    synchronizeTableLayoutElements(
      wrapper,
      tableScroll,
      tableElement,
      scrollbar,
      scrollbarThumb,
      getTableWidgetTable(wrapper) ?? table,
      view,
    );
  };
  const scheduleDeferredLayout = () => {
    if (pendingAnimationFrame !== 0) {
      return;
    }

    pendingAnimationFrame = requestElementAnimationFrame(wrapper, syncLayout);
  };
  const synchronizeNow = () => {
    if (pendingAnimationFrame !== 0) {
      cancelElementAnimationFrame(wrapper, pendingAnimationFrame);
      pendingAnimationFrame = 0;
    }
    syncLayout();
  };

  const ResizeObserverCtor = wrapper.ownerDocument.defaultView?.ResizeObserver;
  const resizeObserver = ResizeObserverCtor
    ? new ResizeObserverCtor(scheduleDeferredLayout)
    : undefined;
  resizeObserver?.observe(tableElement);
  resizeObserver?.observe(tableScroll);
  tableScroll.addEventListener("scroll", syncScrollbar);

  scheduleDeferredLayout();
  setTableWidgetCleanup(wrapper, () => {
    if (pendingAnimationFrame !== 0) {
      cancelElementAnimationFrame(wrapper, pendingAnimationFrame);
      pendingAnimationFrame = 0;
    }
    resizeObserver?.disconnect();
    tableScroll.removeEventListener("scroll", syncScrollbar);
  });
  // Direct table edits call this returned function after mutating cell text.
  // Resolve their wrapping height in the same event turn so native prose
  // below the widget and the table-owned gutter can never diverge for a
  // frame. External width/font changes remain coalesced by ResizeObserver.
  return synchronizeNow;
}

/** Immediately reconciles a connected widget after CodeMirror reuses its DOM. */
export function synchronizeTableLayoutNow(
  wrapper: HTMLElement,
  table: ParsedTable,
  view: EditorView,
): boolean {
  const tableScroll = wrapper.querySelector<HTMLElement>(".mlrt-table-scroll");
  const tableElement = wrapper.querySelector<HTMLTableElement>(".mlrt-table");
  const scrollbar = wrapper.querySelector<HTMLElement>(".mlrt-table-scrollbar");
  const scrollbarThumb = wrapper.querySelector<HTMLElement>(
    ".mlrt-table-scrollbar-thumb",
  );
  if (!tableScroll || !tableElement || !scrollbar || !scrollbarThumb) {
    return false;
  }

  synchronizeTableLayoutElements(
    wrapper,
    tableScroll,
    tableElement,
    scrollbar,
    scrollbarThumb,
    table,
    view,
  );
  return true;
}

/**
 * Width available for table data columns, in `ch` units of the widget font:
 * the scroller width minus the line-number gutter, editor right padding, and
 * an allowance for cell border pixels plus fractional-`ch` rounding. Without
 * the allowance a fitting table lands 1-3px over the scroll area, which arms
 * the horizontal scrollbar with a useless couple of pixels of travel.
 */
export function measureAvailableDataWidthCh(
  wrapper: HTMLElement,
): number | undefined {
  const scroller = wrapper.closest<HTMLElement>(".cm-scroller");
  if (!scroller) {
    return undefined;
  }

  return measureAvailableDataWidthChFromEditor(
    scroller,
    wrapper,
    getTableWidgetTable(wrapper)?.columnCount ?? 1,
  );
}

/**
 * Gives a new widget its final browser-measured height before CodeMirror puts
 * it into visible document flow.
 *
 * The widget is briefly connected as an invisible absolutely positioned
 * child of the real scroller. That supplies the exact inherited font, zoom,
 * gutter, and viewport custom properties without affecting scroll layout.
 * Consequently the later animation-frame layout pass is a no-op instead of
 * moving table content one frame ahead of CodeMirror's virtual gutter.
 */
export function primeTableLayoutForMount(
  wrapper: HTMLElement,
  tableScroll: HTMLElement,
  tableElement: HTMLTableElement,
  scrollbar: HTMLElement,
  scrollbarThumb: HTMLElement,
  table: ParsedTable,
  view: EditorView,
): void {
  const previousInlineStyle = {
    position: wrapper.style.position,
    left: wrapper.style.left,
    top: wrapper.style.top,
    visibility: wrapper.style.visibility,
    pointerEvents: wrapper.style.pointerEvents,
  };
  wrapper.style.position = "absolute";
  wrapper.style.left = "0";
  wrapper.style.top = "0";
  wrapper.style.visibility = "hidden";
  wrapper.style.pointerEvents = "none";
  view.scrollDOM.append(wrapper);
  try {
    synchronizeTableLayoutElements(
      wrapper,
      tableScroll,
      tableElement,
      scrollbar,
      scrollbarThumb,
      table,
      view,
    );
  } finally {
    wrapper.remove();
    wrapper.style.position = previousInlineStyle.position;
    wrapper.style.left = previousInlineStyle.left;
    wrapper.style.top = previousInlineStyle.top;
    wrapper.style.visibility = previousInlineStyle.visibility;
    wrapper.style.pointerEvents = previousInlineStyle.pointerEvents;
  }
}

function synchronizeTableLayoutElements(
  wrapper: HTMLElement,
  tableScroll: HTMLElement,
  tableElement: HTMLTableElement,
  scrollbar: HTMLElement,
  scrollbarThumb: HTMLElement,
  table: ParsedTable,
  view: EditorView,
): void {
  applyCurrentColumnSizing(wrapper, table);
  syncTableScrollbar(tableScroll, scrollbar, scrollbarThumb);
  const tableHeight = tableElement.getBoundingClientRect().height;
  const scrollbarHeight = scrollbar.hidden
    ? 0
    : scrollbar.getBoundingClientRect().height;
  const synchronizedHeightPx = screenPixelsToCssPixels(
    tableHeight + scrollbarHeight,
    view.scaleY,
  );
  wrapper.style.height = `${synchronizedHeightPx}px`;
  wrapper.dataset.primedHeightPx = String(synchronizedHeightPx);
  // Column sizing and wrapping are now committed. Synchronize selection
  // geometry here so the overlay can never measure the previous layout.
  syncTableSelectionOverlay(wrapper);
}

/**
 * Resolves the same available width before a new widget is connected, so its
 * first browser layout already uses the final viewport-aware column sizing.
 */
export function measureAvailableDataWidthChForView(
  view: EditorView,
  columnCount: number,
): number | undefined {
  const viewport = measureTableEstimateViewportForView(view);
  const borderAllowancePx = columnCount + 2;
  const availablePx = Math.max(
    0,
    viewport.availableDataWidthPx - borderAllowancePx,
  );
  return viewport.chWidthPx > 0
    ? availablePx / viewport.chWidthPx
    : undefined;
}

export interface TableEstimateViewport {
  /** Width after the actual native gutter and editor right padding. */
  availableDataWidthPx: number;
  chWidthPx: number;
}

/** Browser measurements shared by first DOM layout and off-screen estimates. */
export function measureTableEstimateViewportForView(
  view: EditorView,
): TableEstimateViewport {
  const scroller = view.scrollDOM;
  const styles = getComputedStyle(scroller);
  const gutterWidth =
    view.dom.querySelector<HTMLElement>(".cm-gutters")?.getBoundingClientRect()
      .width ??
    resolveCssLengthPx(
      scroller,
      styles.getPropertyValue("--mlrt-live-gutter-width"),
    );
  const rightPadding = resolveCssLengthPx(
    scroller,
    styles.getPropertyValue("--mlrt-editor-right-padding"),
  );
  return {
    availableDataWidthPx: Math.max(
      0,
      scroller.clientWidth - gutterWidth - rightPadding,
    ),
    chWidthPx: measureChWidth(view.contentDOM),
  };
}

/** Whether the sized data columns require the custom horizontal scrollbar. */
export function tableSizingOverflowsAvailableWidth(
  columnSizing: TableColumnSizing,
  availableDataWidthCh: number | undefined,
): boolean {
  return (
    availableDataWidthCh !== undefined &&
    columnSizing.dataWidthCh > availableDataWidthCh + 0.01
  );
}

function measureAvailableDataWidthChFromEditor(
  scroller: HTMLElement,
  fontElement: HTMLElement,
  columnCount: number,
): number | undefined {
  const styles = getComputedStyle(scroller);
  const gutterWidth = resolveCssLengthPx(
    scroller,
    styles.getPropertyValue("--mlrt-live-gutter-width"),
  );
  const rightPadding = resolveCssLengthPx(
    scroller,
    styles.getPropertyValue("--mlrt-editor-right-padding"),
  );
  const chWidth = measureChWidth(fontElement);
  const borderAllowancePx = columnCount + 2;
  const availablePx = Math.max(
    0,
    scroller.clientWidth - gutterWidth - rightPadding - borderAllowancePx,
  );
  return chWidth > 0 ? availablePx / chWidth : undefined;
}

function syncTableScrollbar(
  tableScroll: HTMLElement,
  scrollbar: HTMLElement,
  scrollbarThumb: HTMLElement,
): void {
  const maxScrollLeft = Math.max(
    0,
    tableScroll.scrollWidth - tableScroll.clientWidth,
  );
  const hasOverflow = maxScrollLeft > 1;
  scrollbar.hidden = !hasOverflow;
  if (!hasOverflow) {
    if (tableScroll.scrollLeft !== 0) {
      tableScroll.scrollLeft = 0;
    }
    scrollbarThumb.style.width = "0px";
    scrollbarThumb.style.transform = "translateX(0px)";
    return;
  }

  const trackWidth = Math.max(0, scrollbar.clientWidth);
  const thumbWidth = Math.max(
    24,
    (tableScroll.clientWidth / tableScroll.scrollWidth) * trackWidth,
  );
  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
  const thumbLeft =
    maxScrollLeft > 0
      ? (tableScroll.scrollLeft / maxScrollLeft) * maxThumbLeft
      : 0;
  scrollbarThumb.style.width = `${thumbWidth}px`;
  scrollbarThumb.style.transform = `translateX(${thumbLeft}px)`;
}

/** Measured pixel width of one `ch` in the element's font, cached per font. */
export function measureChWidth(element: HTMLElement): number {
  const styles = getComputedStyle(element);
  const cacheKey = [
    styles.fontFamily,
    styles.fontSize,
    styles.fontWeight,
    styles.fontStretch,
    styles.fontStyle,
    styles.letterSpacing,
    styles.fontFeatureSettings,
    styles.fontVariationSettings,
  ].join("|");
  const cached = chWidthCache.get(element);
  if (cached?.key === cacheKey) {
    return cached.width;
  }

  const probe = element.ownerDocument.createElement("span");
  probe.textContent = "0";
  probe.style.position = "absolute";
  probe.style.left = "-10000px";
  probe.style.top = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.fontFamily = styles.fontFamily;
  probe.style.fontSize = styles.fontSize;
  probe.style.fontWeight = styles.fontWeight;
  probe.style.fontStretch = styles.fontStretch;
  probe.style.fontStyle = styles.fontStyle;
  probe.style.letterSpacing = styles.letterSpacing;
  probe.style.fontFeatureSettings = styles.fontFeatureSettings;
  probe.style.fontVariationSettings = styles.fontVariationSettings;
  const host =
    element.ownerDocument.body ?? element.ownerDocument.documentElement;
  host.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  chWidthCache.set(element, { key: cacheKey, width });
  return width;
}

function resolveCssLengthPx(element: HTMLElement, value: string): number {
  const direct = Number.parseFloat(value);
  if (Number.isFinite(direct) && value.trim().endsWith("px")) {
    return direct;
  }

  const cachedLengths = cssLengthCache.get(element);
  const cached = cachedLengths?.get(value);
  if (cached !== undefined) {
    return cached;
  }

  const probe = element.ownerDocument.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = value.trim() || "0px";
  element.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  const resolved = Number.isFinite(width) ? width : 0;

  if (cachedLengths) {
    cachedLengths.set(value, resolved);
  } else {
    cssLengthCache.set(element, new Map([[value, resolved]]));
  }
  return resolved;
}
