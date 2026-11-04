import {
  Compartment,
  EditorState,
  Extension,
  Facet,
  Range,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  layer,
  LayerMarker,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { getParsedTables } from "../shared/tableModel";
import { markdownPresentationField } from "./markdown/markdownPresentation";
import {
  SELECTION_CORNER_RADIUS_PX,
  SelectionPiece,
  SelectionRow,
  selectionPieces,
  snapToDevicePixel,
  styleSelectionRows,
} from "./selectionGeometry";
import {
  caretX,
  createMeasureContext,
  extentsByRow,
  lineElementAt,
  MeasureContext,
  piecesToMarkers,
  rowIndexAt,
  visualRows,
} from "./selectionMeasure";

/**
 * Prose selection painting, modeled on VS Code's editor
 * (`SelectionsOverlay` and `editor.renderWhitespace: "selection"`).
 *
 * - Each selection is painted in a layer behind the text as one piece per
 *   visual row. Every piece spans its row's full line box and its edges are
 *   snapped to device pixels, so rows meet without seams.
 * - A row ends at its last selected character; when the selection continues
 *   past the end of the line, the line break is shown as one character width,
 *   so an empty line in a selection reads as a one-character box.
 * - Corners follow VS Code: exposed corners are rounded, aligned corners are
 *   square, and inward steps get concave fillets.
 * - A row selected from its start begins at the page's text edge (including
 *   indented, bulleted, and quoted rows), matching how VS Code paints the
 *   leading whitespace of those lines.
 * - Focused selections use `editor.selectionBackground`; when the editor
 *   loses focus they use `editor.inactiveSelectionBackground`.
 * - Inline-code chrome under the selection is dropped so selected text reads
 *   as one surface, and selected whitespace shows VS Code's faint dots when
 *   `editor.renderWhitespace` allows it.
 *
 * Rendered tables own their selection presentation and are skipped here.
 */
export function createDocumentSelectionDecorations(showWhitespace = true, rounded = true): Extension {
  return [
    selectionWhitespaceCompartment.of(selectionWhitespaceFacet.of(showWhitespace)),
    roundedSelectionCompartment.of(roundedSelectionFacet.of(rounded)),
    selectionTextDecorations,
    proseSelectionLayer,
  ];
}

export const roundedSelectionCompartment = new Compartment();
export const roundedSelectionFacet = Facet.define<boolean, boolean>({ combine: values => values.at(-1) ?? true });

export const selectionWhitespaceCompartment = new Compartment();
export const selectionWhitespaceFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.at(-1) ?? true,
});

export interface SelectedLineSegment {
  /** Selected part of the line (document offsets; equal when empty). */
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  /** The selection includes the start of this line. */
  fromLineStart: boolean;
  /** The selection continues past this line's break. */
  continues: boolean;
}

/**
 * Pure: the per-line pieces of one selection range, like VS Code's
 * `linesVisibleRangesForRange(range, includeNewLines)`. Every line from the
 * range start to its end is listed, including a final line that the range
 * only touches at its start (a zero-width piece that still shapes its
 * neighbor's corners). Rendered table source is skipped.
 */
export function selectedLineSegments(
  state: EditorState,
  range: { from: number; to: number },
  viewport: { from: number; to: number } = { from: 0, to: state.doc.length },
): SelectedLineSegment[] {
  if (range.from >= range.to || range.to < viewport.from || range.from > viewport.to) return [];
  const tables = getParsedTables(state.doc).filter((table) => range.from <= table.to && range.to >= table.from);
  const segments: SelectedLineSegment[] = [];
  for (let line = state.doc.lineAt(Math.max(range.from, viewport.from)); ; line = state.doc.line(line.number + 1)) {
    if (!tables.some((table) => line.from >= table.from && line.to <= table.to)) {
      segments.push({
        from: Math.max(range.from, line.from),
        to: Math.min(range.to, line.to),
        lineFrom: line.from,
        lineTo: line.to,
        fromLineStart: range.from <= line.from,
        continues: range.to > line.to,
      });
    }
    if (line.to >= Math.min(range.to, viewport.to) || line.number >= state.doc.lines) break;
  }
  return segments;
}

interface MeasuredRow extends SelectionRow {
  empty: boolean;
}

const proseSelectionLayer = layer({
  above: false,
  class: "mlrt-prose-selection-layer",
  update: (update) =>
    update.selectionSet || update.docChanged || update.viewportChanged || update.geometryChanged ||
    update.startState.facet(roundedSelectionFacet) !== update.state.facet(roundedSelectionFacet),
  markers: (view) => measureSelection(view),
});

function measureSelection(view: EditorView): LayerMarker[] {
  const ranges = view.state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length === 0) return [];
  const context = createMeasureContext(view);
  const rounded = view.state.facet(roundedSelectionFacet) &&
    !view.dom.ownerDocument.body.matches('.vscode-high-contrast, .vscode-high-contrast-light') &&
    !view.dom.ownerDocument.defaultView?.matchMedia('(forced-colors: active)').matches;
  const markers: LayerMarker[] = [];
  for (const range of ranges) {
    const rows = measureRows(context, selectedLineSegments(view.state, range, view.viewport));
    const hasGaps = rows.some((row, index) => index > 0 && row.top === rows[index - 1].top);
    const pieces = selectionPieces(styleSelectionRows(rows, context.charWidth / 4), rounded && !hasGaps);
    markers.push(...piecesToMarkers(context, pieces, (piece) => pieceClass(piece, rows), SELECTION_CORNER_RADIUS_PX));
  }
  return markers;
}

function pieceClass(piece: SelectionPiece, rows: readonly MeasuredRow[]): string {
  if (piece.role === "fillet") {
    return "mlrt-selection-fillet mlrt-selection-fill";
  }
  const empty = rows.some((row) => row.empty && row.top === piece.top && row.left === piece.left);
  return `mlrt-prose-selection mlrt-prose-selection-rect mlrt-selection-fill${empty ? " mlrt-prose-selection-empty-line" : ""}`;
}

/** Visible client-space rows for one range, top to bottom, device-snapped. */
function measureRows(context: MeasureContext, segments: readonly SelectedLineSegment[]): MeasuredRow[] {
  const { view } = context;
  const snap = (value: number): number => snapToDevicePixel(value, context.devicePixelRatio);
  const rows: MeasuredRow[] = [];
  for (const segment of segments) {
    if (segment.lineTo < view.viewport.from || segment.lineFrom > view.viewport.to) continue;
    const lineElement = lineElementAt(view, segment.lineFrom);
    if (!lineElement) continue;
    // Collapsed source positions can map to the preceding visible line.
    if (view.posAtDOM(lineElement) !== segment.lineFrom) continue;
    const lineRect = lineElement.getBoundingClientRect();
    if (lineRect.height <= 0) continue;
    const visual = visualRows(view, lineElement, lineRect);
    const lineRows: Array<{ row: number; left: number; right: number }> = [];
    const extents = extentsByRow(view, segment.from, segment.to, visual);
    if (extents.size > 0) {
      const firstRow = Math.min(...extents.keys());
      for (const [row, spans] of [...extents.entries()].sort((left, right) => left[0] - right[0])) {
        const fromRowStart = segment.fromLineStart || row > firstRow;
        // In LTR text a logical selection is contiguous, including inline
        // padding/hidden syntax. Bidi selections can have unselected islands.
        const bidi = view.bidiSpans(view.state.doc.lineAt(segment.lineFrom)).length > 1;
        const extents = bidi ? spans : [{ left: spans[0].left, right: spans.at(-1)!.right }];
        for (const [index, extent] of extents.entries()) {
          lineRows.push({ row, left: fromRowStart && index === 0 ? Math.min(context.pageLeft, extent.left) : extent.left, right: extent.right });
        }
      }
    } else if (segment.fromLineStart) {
      // Empty line, a selection that ends at this line's start, or text that
      // is entirely hidden: a zero-width piece at the line's start.
      lineRows.push({ row: 0, left: context.pageLeft, right: context.pageLeft });
    } else {
      const caret = caretX(view, segment.from, segment.from === segment.lineTo ? -1 : 1);
      if (!caret) continue;
      lineRows.push({ row: Math.max(0, rowIndexAt(visual, caret.y)), left: caret.x, right: caret.x });
    }
    if (segment.continues) {
      // VS Code shows a selected line break as one character width.
      lineRows[lineRows.length - 1].right += context.charWidth;
    }
    const empty = segment.lineFrom === segment.lineTo;
    for (const row of lineRows) {
      rows.push({
        left: snap(row.left),
        right: snap(Math.max(row.left, row.right)),
        top: snap(visual[row.row].top),
        bottom: snap(visual[row.row].bottom),
        empty,
      });
    }
  }
  return rows;
}

const selectedWhitespace = Decoration.mark({ class: "mlrt-selection-whitespace" });
const selectedInlineCode = Decoration.mark({ class: "mlrt-selection-inline-code" });

/**
 * Text-level selection decorations: inline-code chrome suppression and
 * selected-whitespace dots. Only visible text is decorated.
 */
const selectionTextDecorations = ViewPlugin.fromClass(
  class {
    public decorations: DecorationSet;

    public constructor(view: EditorView) {
      this.decorations = buildSelectionTextDecorations(view);
    }

    public update(update: ViewUpdate): void {
      if (
        update.selectionSet || update.docChanged || update.viewportChanged ||
        update.startState.facet(selectionWhitespaceFacet) !== update.state.facet(selectionWhitespaceFacet) ||
        update.startState.field(markdownPresentationField, false) !== update.state.field(markdownPresentationField, false)
      ) {
        this.decorations = buildSelectionTextDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function buildSelectionTextDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length === 0) return Decoration.none;
  const marks: Range<Decoration>[] = [];
  const inlineCode = state.field(markdownPresentationField, false)?.inlineCodeDecorations;
  const showWhitespace = state.facet(selectionWhitespaceFacet);
  const tables = getParsedTables(state.doc);
  for (const range of ranges) {
    inlineCode?.between(range.from, range.to, (from, to) => {
      const start = Math.max(from, range.from), end = Math.min(to, range.to);
      if (start < end) marks.push(selectedInlineCode.range(start, end));
    });
    if (!showWhitespace) continue;
    for (const visible of view.visibleRanges) {
      const from = Math.max(range.from, visible.from), to = Math.min(range.to, visible.to);
      if (from >= to) continue;
      const text = state.sliceDoc(from, to);
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character !== " " && character !== "\t" && character !== " ") continue;
        const position = from + index;
        if (tables.some((table) => position >= table.from && position < table.to)) continue;
        marks.push(selectedWhitespace.range(position, position + 1));
      }
    }
  }
  return Decoration.set(marks, true);
}
