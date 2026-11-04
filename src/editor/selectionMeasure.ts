import { EditorView, LayerMarker } from "@codemirror/view";
import { SelectionPiece, snapToDevicePixel } from "./selectionGeometry";

/**
 * DOM measurement for the selection painter. Everything
 * here runs in CodeMirror's measure phase (layer `markers`), where layout reads
 * are allowed. Coordinates are client pixels unless noted.
 */

export interface VisualRow {
  top: number;
  bottom: number;
}

export interface MeasureContext {
  view: EditorView;
  /** Layer origin: client position of document coordinate (0, 0). */
  base: { left: number; top: number };
  /** Client x where unindented text starts ("the side of the page"). */
  pageLeft: number;
  /** One typical character advance, in client pixels. */
  charWidth: number;
  devicePixelRatio: number;
}

export function createMeasureContext(view: EditorView): MeasureContext {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const paddingLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft || "0") || 0;
  return {
    view,
    base: {
      left: scroller.left - view.scrollDOM.scrollLeft * view.scaleX,
      top: scroller.top - view.scrollDOM.scrollTop * view.scaleY,
    },
    pageLeft: content.left + paddingLeft * view.scaleX,
    charWidth: view.defaultCharacterWidth * view.scaleX,
    devicePixelRatio: view.dom.ownerDocument.defaultView?.devicePixelRatio ?? 1,
  };
}

/** The rendered `.cm-line` for a document position, if it is in the DOM. */
export function lineElementAt(view: EditorView, position: number): HTMLElement | null {
  let node: Node | null;
  try {
    node = view.domAtPos(position).node;
  } catch {
    return null;
  }
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const line = element?.closest<HTMLElement>(".cm-line") ?? null;
  return line && view.contentDOM.contains(line) ? line : null;
}

/**
 * Visual rows of a line element. The first row starts at the line box top and
 * the last ends at its bottom, so rows of adjacent lines share an edge.
 * Interior boundaries follow the measured text rows.
 */
export function visualRows(view: EditorView, lineElement: HTMLElement, lineRect: DOMRect): VisualRow[] {
  const style = lineElement.ownerDocument.defaultView!.getComputedStyle(lineElement);
  const rowHeight = (parseFloat(style.lineHeight) || view.defaultLineHeight) * view.scaleY;
  // Use actual glyph row centers, not an equal partition of the block box.
  // Inline superscripts, headings and padding can otherwise move the seam
  // through text. The midpoint between baselines belongs to both neighbors.
  const centers: number[] = [];
  const walker = lineElement.ownerDocument.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
  const range = lineElement.ownerDocument.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isRowText(node, lineElement)) continue;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height <= 0 || rect.width <= 0) continue;
      const center = rect.top + rect.height / 2;
      if (!centers.some(value => Math.abs(value - center) < rowHeight / 2)) centers.push(center);
    }
  }
  centers.sort((a, b) => a - b);
  const count = Math.max(1, centers.length);
  return Array.from({ length: count }, (_, index) => ({
    top: index === 0 ? lineRect.top : (centers[index - 1] + centers[index]) / 2,
    bottom: index === count - 1 ? lineRect.bottom : (centers[index] + centers[index + 1]) / 2,
  }));
}

function isRowText(node: Node, line: HTMLElement): boolean {
  const parent = node.parentElement;
  return !!node.textContent && !!parent && parent.closest(".cm-line") === line &&
    !parent.closest('[aria-hidden="true"], button, .mlrt-preview-code-header, .mlrt-list-fold-control');
}

export function rowIndexAt(rows: readonly VisualRow[], y: number): number {
  for (let index = 0; index < rows.length; index++) {
    if (y >= rows[index].top && y < rows[index].bottom) return index;
  }
  return -1;
}

/**
 * Left/right client extent of the rendered content of [from, to] on each
 * visual row. Positioned decorations outside every text row (fold controls,
 * toolbars) are ignored.
 */
export function extentsByRow(
  view: EditorView,
  from: number,
  to: number,
  rows: readonly VisualRow[],
): Map<number, Array<{ left: number; right: number }>> {
  const extents = new Map<number, Array<{ left: number; right: number }>>();
  if (from >= to) return extents;
  let start: { node: Node; offset: number };
  let end: { node: Node; offset: number };
  try {
    start = view.domAtPos(from, 1);
    end = view.domAtPos(to, -1);
  } catch {
    return extents;
  }
  const range = view.contentDOM.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return extents;
  }
  // Element rectangles include an inline parent's unselected padding and can
  // span multiple bidi runs. Measure the selected text fragments themselves.
  const line = lineElementAt(view, from);
  if (!line) return extents;
  const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isRowText(node, line) || !range.intersectsNode(node)) continue;
    const fragment = line.ownerDocument.createRange();
    fragment.setStart(node, node === start.node ? start.offset : 0);
    fragment.setEnd(node, node === end.node ? end.offset : node.textContent!.length);
    rects.push(...Array.from(fragment.getClientRects()));
  }
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const row = rowIndexAt(rows, rect.top + rect.height / 2);
    if (row === -1) continue;
    const spans = extents.get(row) ?? [];
    spans.push({ left: rect.left, right: rect.right });
    extents.set(row, spans);
  }
  for (const [row, spans] of extents) {
    spans.sort((a, b) => a.left - b.left);
    const merged: Array<{ left: number; right: number }> = [];
    for (const span of spans) {
      const previous = merged.at(-1);
      // Join touching syntax fragments, but retain real bidi gaps.
      if (previous && span.left <= previous.right + 0.5) previous.right = Math.max(previous.right, span.right);
      else merged.push({ ...span });
    }
    extents.set(row, merged);
  }
  return extents;
}

/** Client x of a caret position, or null when it is not rendered. */
export function caretX(view: EditorView, position: number, side: -1 | 1): { x: number; y: number } | null {
  const coords = view.coordsAtPos(position, side);
  return coords ? { x: coords.left, y: (coords.top + coords.bottom) / 2 } : null;
}

/** A positioned div in a CodeMirror layer. */
export class PieceMarker implements LayerMarker {
  public constructor(
    private readonly className: string,
    private readonly left: number,
    private readonly top: number,
    private readonly width: number,
    private readonly height: number,
    private readonly radius: string,
    private readonly clipPath = "",
  ) {}

  public draw(): HTMLElement {
    const element = document.createElement("div");
    element.className = this.className;
    this.adjust(element);
    return element;
  }

  public update(element: HTMLElement, previous: PieceMarker): boolean {
    if (previous.className !== this.className) return false;
    this.adjust(element);
    return true;
  }

  public eq(other: LayerMarker): boolean {
    return other instanceof PieceMarker && other.className === this.className &&
      other.left === this.left && other.top === this.top && other.width === this.width &&
      other.height === this.height && other.radius === this.radius && other.clipPath === this.clipPath;
  }

  private adjust(element: HTMLElement): void {
    element.style.left = `${this.left}px`;
    element.style.top = `${this.top}px`;
    element.style.width = `${this.width}px`;
    element.style.height = `${this.height}px`;
    element.style.borderRadius = this.radius;
    element.style.clipPath = this.clipPath ? `path('${this.clipPath}')` : "";
  }
}

/** Converts client-space pieces into device-pixel-snapped layer markers. */
export function piecesToMarkers(
  context: MeasureContext,
  pieces: readonly SelectionPiece[],
  className: (piece: SelectionPiece) => string,
  radiusPx: number,
): PieceMarker[] {
  // Snap in client space so edges land on device pixels on screen; equal
  // edges of neighboring rows therefore snap identically and never leave a
  // hairline seam or a 1px step.
  const snap = (value: number): number => snapToDevicePixel(value, context.devicePixelRatio);
  return pieces.map((piece) => {
    // Fillets are derived from already snapped row edges. Snapping their
    // other edge changes their width without changing the clipping path,
    // which creates hairlines at fractional display scales.
    const align = piece.role === "fillet" ? (value: number) => value : snap;
    const left = align(piece.left) - context.base.left;
    const top = align(piece.top) - context.base.top;
    const right = align(piece.left + piece.width) - context.base.left;
    const bottom = align(piece.top + piece.height) - context.base.top;
    const radius = [piece.topLeft, piece.topRight, piece.bottomRight, piece.bottomLeft]
      .map((rounded) => (rounded ? `${radiusPx}px` : "0px")).join(" ");
    return new PieceMarker(className(piece), left, top, Math.max(0, right - left), Math.max(0, bottom - top), radius, piece.clipPath);
  });
}
