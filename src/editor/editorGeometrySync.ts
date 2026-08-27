import { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { tableCellLiveEditAnnotation } from "./tableEditAnnotations";
import { syncTableSelectionOverlay } from "./table/tableSelectionOverlay";
import { TABLE_WIDGET_SELECTOR } from "./table/tableWidgetState";
import {
  createTableHeightEstimateMetrics,
  TableHeightEstimateMetrics,
  updateTableHeightEstimateMetrics,
} from "./table/tableHeightEstimate";
import { measureTableEstimateViewportForView } from "./table/tableLayout";

/**
 * Publishes the real editor geometry as CSS custom properties on the
 * scroller:
 *
 * - `--mlrt-live-gutter-width`: the measured `.cm-gutters` width, so the
 *   table's per-row line numbers track the native gutter even when the digit
 *   count grows.
 * - `--mlrt-live-content-width`: the scroller's client width (minus editor
 *   right padding), giving the rendered table a definite wrapping width that
 *   works regardless of the word-wrap setting.
 * - `--mlrt-prose-selection-padding-block-*`: the measured space between a
 *   prose text box and its CodeMirror line box. Selection paint uses these
 *   asymmetric insets so neighboring rows meet without gaps or overlap.
 *
 * Also observes the editor and every table widget with a ResizeObserver and
 * forces CodeMirror to re-measure replaced block heights when width changes
 * re-wrap table cell text (e.g. sidebar drag).
 */
export function createEditorGeometrySync(
  tableHeightEstimateMetrics: TableHeightEstimateMetrics =
    createTableHeightEstimateMetrics(),
): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly measureKey = {};
      private lastGutterWidth = -1;
      private lastContentWidth = -1;
      private lastSelectionPaddingBlockStart = -1;
      private lastSelectionPaddingBlockEnd = -1;
      private lastObservedScrollerWidth = -1;
      private resizeObserver: ResizeObserver | undefined;
      private selectionOutlineFrame: number | undefined;
      private readonly observedTableWidgets = new Set<Element>();
      private readonly observedWidgetHeights = new WeakMap<Element, number>();

      public constructor(private readonly view: EditorView) {
        const ResizeObserverCtor =
          view.dom.ownerDocument.defaultView?.ResizeObserver;
        if (ResizeObserverCtor) {
          this.lastObservedScrollerWidth = view.scrollDOM.clientWidth;
          this.resizeObserver = new ResizeObserverCtor((entries) => {
            // A full CodeMirror content re-measure is only forced when block
            // geometry is actually invalidated: the scroller width changed
            // (re-wraps table cell text) or a table widget's height changed
            // (CodeMirror must re-reserve the replaced block's height).
            // Anything else schedules a plain custom-property sync, which
            // keeps rapid same-height edits (held Cmd+Z) redraw-free.
            let forceContentRemeasure = false;
            for (const entry of entries) {
              if (
                entry.target === view.dom ||
                entry.target === view.scrollDOM
              ) {
                const scrollerWidth = view.scrollDOM.clientWidth;
                if (scrollerWidth !== this.lastObservedScrollerWidth) {
                  this.lastObservedScrollerWidth = scrollerWidth;
                  forceContentRemeasure = true;
                }
                continue;
              }

              const height = entry.contentRect.height;
              const previousHeight = this.observedWidgetHeights.get(
                entry.target,
              );
              if (
                previousHeight === undefined ||
                Math.abs(previousHeight - height) > 0.5
              ) {
                this.observedWidgetHeights.set(entry.target, height);
                forceContentRemeasure = true;
              }
            }
            this.schedule(view, forceContentRemeasure);
          });
          this.resizeObserver.observe(view.dom);
          this.resizeObserver.observe(view.scrollDOM);
        }
        this.schedule(view);
      }

      public update(update: ViewUpdate): void {
        this.syncObservedTableWidgets(update.view);
        if (
          update.transactions.some((transaction) =>
            transaction.annotation(tableCellLiveEditAnnotation),
          )
        ) {
          return;
        }
        if (
          update.geometryChanged ||
          update.viewportChanged ||
          update.docChanged
        ) {
          this.schedule(update.view);
        }
      }

      public destroy(): void {
        this.resizeObserver?.disconnect();
        const win = viewWindow(this.view);
        if (this.selectionOutlineFrame !== undefined && win) {
          win.cancelAnimationFrame(this.selectionOutlineFrame);
        }
        this.observedTableWidgets.clear();
      }

      private schedule(view: EditorView, forceContentRemeasure = false): void {
        if (forceContentRemeasure) {
          forceCodeMirrorContentRemeasure(view);
        }

        view.requestMeasure({
          key: this.measureKey,
          read: (measuredView) => ({
            gutterWidth:
              measuredView.dom.querySelector<HTMLElement>(".cm-gutters")
                ?.offsetWidth ?? 0,
            contentWidth: measuredView.scrollDOM.clientWidth,
            lineHeightPx: readEditorLineHeight(measuredView),
            proseSelectionPadding: readProseSelectionPadding(measuredView),
            tableViewport: measureTableEstimateViewportForView(measuredView),
          }),
          write: (metrics, measuredView) => {
            this.syncObservedTableWidgets(measuredView);
            const scrollerStyle = measuredView.scrollDOM.style;
            if (
              metrics.gutterWidth > 0 &&
              metrics.gutterWidth !== this.lastGutterWidth
            ) {
              this.lastGutterWidth = metrics.gutterWidth;
              scrollerStyle.setProperty(
                "--mlrt-live-gutter-width",
                `${metrics.gutterWidth}px`,
              );
            }
            if (
              metrics.contentWidth > 0 &&
              metrics.contentWidth !== this.lastContentWidth
            ) {
              this.lastContentWidth = metrics.contentWidth;
              scrollerStyle.setProperty(
                "--mlrt-live-content-width",
                `calc(${metrics.contentWidth}px - var(--mlrt-editor-right-padding, 26px))`,
              );
            }
            if (metrics.proseSelectionPadding) {
              const { blockStart, blockEnd } = metrics.proseSelectionPadding;
              if (blockStart !== this.lastSelectionPaddingBlockStart) {
                this.lastSelectionPaddingBlockStart = blockStart;
                scrollerStyle.setProperty(
                  "--mlrt-prose-selection-padding-block-start",
                  `${blockStart}px`,
                );
              }
              if (blockEnd !== this.lastSelectionPaddingBlockEnd) {
                this.lastSelectionPaddingBlockEnd = blockEnd;
                scrollerStyle.setProperty(
                  "--mlrt-prose-selection-padding-block-end",
                  `${blockEnd}px`,
                );
              }
            }
            const estimateMetricsChanged =
              updateTableHeightEstimateMetrics(tableHeightEstimateMetrics, {
                lineHeightPx: metrics.lineHeightPx,
                chWidthPx: metrics.tableViewport.chWidthPx,
                availableDataWidthPx:
                  metrics.tableViewport.availableDataWidthPx,
              });
            if (estimateMetricsChanged) {
              // Rebuild off-screen block estimates with the newly measured
              // font/zoom/viewport metrics. Visible widget DOM stays mounted;
              // the following measure pass reconciles the refreshed height
              // map with its already-authoritative browser rectangles.
              forceCodeMirrorContentRemeasure(measuredView);
              measuredView.requestMeasure();
            }
            this.scheduleSelectionOutlineSync(measuredView);
          },
        });
      }

      /**
       * Table cells can reflow one frame after the scroller width changes.
       * The selection frame uses cell rectangles, so refresh it after that
       * layout is committed rather than leaving it at the pre-resize width.
       */
      private scheduleSelectionOutlineSync(view: EditorView): void {
        const win = viewWindow(view);
        if (!win || this.selectionOutlineFrame !== undefined) {
          return;
        }
        this.selectionOutlineFrame = win.requestAnimationFrame(() => {
          this.selectionOutlineFrame = undefined;
          for (const widget of this.observedTableWidgets) {
            if (widget instanceof HTMLElement && widget.isConnected) {
              syncTableSelectionOverlay(widget);
            }
          }
        });
      }

      private syncObservedTableWidgets(view: EditorView): void {
        if (!this.resizeObserver) {
          return;
        }

        const widgets = new Set(
          Array.from(view.dom.querySelectorAll(TABLE_WIDGET_SELECTOR)),
        );
        for (const widget of widgets) {
          if (!this.observedTableWidgets.has(widget)) {
            this.resizeObserver.observe(widget);
          }
        }
        for (const widget of this.observedTableWidgets) {
          if (!widgets.has(widget)) {
            this.resizeObserver.unobserve(widget);
          }
        }
        this.observedTableWidgets.clear();
        for (const widget of widgets) {
          this.observedTableWidgets.add(widget);
        }
      }
    },
  );
}

function viewWindow(view: EditorView): Window | null {
  return view.dom.ownerDocument.defaultView;
}

function readEditorLineHeight(view: EditorView): number {
  const line = view.dom.querySelector<HTMLElement>(".cm-line");
  const styles = getComputedStyle(line ?? view.contentDOM);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  return Number.isFinite(lineHeight) && lineHeight > 0
    ? lineHeight
    : view.defaultLineHeight;
}

/**
 * Measures the actual inline text box instead of deriving it from font-size.
 * Browser font metrics are not vertically symmetric: for example, a 14px
 * Consolas glyph box in a 19px CodeMirror row starts at the row top and leaves
 * nearly 2px below it. Symmetric padding therefore shifts the selection paint
 * upward, creating a gap beside exact-height blank-row markers and an overlap
 * between adjacent non-empty rows.
 */
function readProseSelectionPadding(
  view: EditorView,
): { blockStart: number; blockEnd: number } | null {
  const lineHeight = readEditorLineHeight(view);
  const scaleY = Number.isFinite(view.scaleY) && view.scaleY > 0
    ? view.scaleY
    : 1;

  for (const line of Array.from(
    view.dom.querySelectorAll<HTMLElement>(".cm-line"),
  )) {
    const lineRect = line.getBoundingClientRect();
    const localLineHeight = lineRect.height / scaleY;
    // A wrapped source line spans several visual rows. An ordinary one-row
    // sample gives us exact first-row edges without having to infer wrap count.
    if (
      localLineHeight <= 0 ||
      Math.abs(localLineHeight - lineHeight) > 0.5
    ) {
      continue;
    }

    const textNode = firstNonEmptyTextNode(line);
    if (!textNode) {
      continue;
    }
    const range = line.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    const textRect = range.getBoundingClientRect();
    if (textRect.height <= 0) {
      continue;
    }

    return {
      blockStart: normalizeSelectionInset(
        (textRect.top - lineRect.top) / scaleY,
        lineHeight,
      ),
      blockEnd: normalizeSelectionInset(
        (lineRect.bottom - textRect.bottom) / scaleY,
        lineHeight,
      ),
    };
  }
  return null;
}

function firstNonEmptyTextNode(root: Node): Text | null {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === child.TEXT_NODE && child.textContent) {
      return child as Text;
    }
    const nested = firstNonEmptyTextNode(child);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeSelectionInset(value: number, lineHeight: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  // Discard sub-layout noise while retaining 1/64px browser precision. The
  // upper clamp prevents a malformed/offscreen rectangle from painting far
  // outside the line if a browser returns transient geometry.
  return Math.round(Math.min(lineHeight, Math.max(0, value)) * 64) / 64;
}

/**
 * Flags CodeMirror's internal view state so the next measure pass re-reads
 * content heights. Required when an outside layout change (window or sidebar
 * resize) re-wraps text inside replaced block widgets.
 */
function forceCodeMirrorContentRemeasure(view: EditorView): void {
  const viewState = (
    view as unknown as {
      viewState?: { mustMeasureContent?: boolean | "refresh" };
    }
  ).viewState;
  if (viewState) {
    viewState.mustMeasureContent = "refresh";
  }
}
