/**
 * Selection shape geometry, ported from VS Code's own selection renderer
 * (microsoft/vscode src/vs/editor/browser/viewParts/selections/selections.ts,
 * `SelectionsOverlay`). Pure: DOM measurement lives in the painters.
 *
 * VS Code paints a selection as one piece per visual row, each spanning the
 * row's full line height. With `editor.roundedSelection` (the default):
 * - an exposed ("external") corner is rounded,
 * - a corner that lines up with the row above or below ("flat") is square,
 * - where a row steps inside its neighbor ("internal"), a concave fillet is
 *   drawn just outside the row. Unlike Monaco's opaque background cutouts,
 *   our fillets are clipped directly, preserving Markdown block surfaces.
 */

export const SELECTION_CORNER_RADIUS_PX = 3;

export enum CornerStyle {
  External = 0,
  Internal = 1,
  Flat = 2,
}

/** One visual row of a selection, in any consistent coordinate space. */
export interface SelectionRow {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface StyledSelectionRow extends SelectionRow {
  startTop: CornerStyle;
  startBottom: CornerStyle;
  endTop: CornerStyle;
  endBottom: CornerStyle;
}

export interface SelectionPiece {
  kind: "selection";
  /** Main pieces carry the row; fillet pieces sit just outside it. */
  role: "row" | "fillet";
  left: number;
  top: number;
  width: number;
  height: number;
  topLeft: boolean;
  topRight: boolean;
  bottomRight: boolean;
  bottomLeft: boolean;
  /** A concave corner fill, without an editor-colored rectangle over it. */
  clipPath?: string;
}

/**
 * Port of `SelectionsOverlay._enrichVisibleRangesWithStyle`. Rows must be in
 * top-to-bottom order; rows that do not share an edge (for example across a
 * rendered table) are treated as having no neighbor, like the first and last
 * rows of a selection.
 */
export function styleSelectionRows(
  rows: readonly SelectionRow[],
  epsilon: number,
): StyledSelectionRow[] {
  const adjacent = (above: SelectionRow | undefined, below: SelectionRow | undefined): boolean =>
    Boolean(above && below && Math.abs(above.bottom - below.top) < 0.5);
  return rows.map((row, index) => {
    const styled: StyledSelectionRow = {
      ...row,
      startTop: CornerStyle.External,
      startBottom: CornerStyle.External,
      endTop: CornerStyle.External,
      endBottom: CornerStyle.External,
    };
    const previous = rows[index - 1];
    if (previous && adjacent(previous, row)) {
      if (Math.abs(row.left - previous.left) < epsilon) {
        styled.startTop = CornerStyle.Flat;
      } else if (row.left > previous.left) {
        styled.startTop = CornerStyle.Internal;
      }
      if (Math.abs(row.right - previous.right) < epsilon) {
        styled.endTop = CornerStyle.Flat;
      } else if (previous.left < row.right && row.right < previous.right) {
        styled.endTop = CornerStyle.Internal;
      }
    }
    const next = rows[index + 1];
    if (next && adjacent(row, next)) {
      if (Math.abs(row.left - next.left) < epsilon) {
        styled.startBottom = CornerStyle.Flat;
      } else if (next.left < row.left && row.left < next.right) {
        styled.startBottom = CornerStyle.Internal;
      }
      if (Math.abs(row.right - next.right) < epsilon) {
        styled.endBottom = CornerStyle.Flat;
      } else if (row.right < next.right) {
        styled.endBottom = CornerStyle.Internal;
      }
    }
    return styled;
  });
}

/**
 * Port of `SelectionsOverlay._actualRenderOneSelection`: the pieces to paint
 * for styled rows, fillets first. Zero-width rows (a selection ending at a
 * line start) still shape their neighbors' corners but paint nothing.
 */
export function selectionPieces(
  rows: readonly StyledSelectionRow[],
  rounded = true,
  filletWidth = SELECTION_CORNER_RADIUS_PX,
): SelectionPiece[] {
  const pieces: SelectionPiece[] = [];
  const square = { topLeft: false, topRight: false, bottomRight: false, bottomLeft: false };
  for (const row of rows) {
    const height = row.bottom - row.top;
    const width = row.right - row.left;
    if (height <= 0) {
      continue;
    }
    if (rounded && (row.startTop === CornerStyle.Internal || row.startBottom === CornerStyle.Internal)) {
      const radius = Math.min(filletWidth, height / 2);
      const path = [
        row.startTop === CornerStyle.Internal ? `M${radius} 0H0A${radius} ${radius} 0 0 1 ${radius} ${radius}Z` : "",
        row.startBottom === CornerStyle.Internal ? `M${radius} ${height}H0A${radius} ${radius} 0 0 0 ${radius} ${height - radius}Z` : "",
      ].join(" ");
      pieces.push({ kind: "selection", role: "fillet", left: row.left - radius, top: row.top,
        width: radius, height, ...square, clipPath: path });
    }
    if (rounded && (row.endTop === CornerStyle.Internal || row.endBottom === CornerStyle.Internal)) {
      const radius = Math.min(filletWidth, height / 2);
      const path = [
        row.endTop === CornerStyle.Internal ? `M0 0H${radius}A${radius} ${radius} 0 0 0 0 ${radius}Z` : "",
        row.endBottom === CornerStyle.Internal ? `M0 ${height}H${radius}A${radius} ${radius} 0 0 1 0 ${height - radius}Z` : "",
      ].join(" ");
      pieces.push({ kind: "selection", role: "fillet", left: row.right, top: row.top,
        width: radius, height, ...square, clipPath: path });
    }
    if (width > 0) {
      pieces.push({
        kind: "selection", role: "row", left: row.left, top: row.top, width, height,
        topLeft: rounded && row.startTop === CornerStyle.External,
        bottomLeft: rounded && row.startBottom === CornerStyle.External,
        topRight: rounded && row.endTop === CornerStyle.External,
        bottomRight: rounded && row.endBottom === CornerStyle.External,
      });
    }
  }
  return pieces;
}

/** Snaps a CSS-pixel coordinate to the device pixel grid. */
export function snapToDevicePixel(value: number, devicePixelRatio: number): number {
  const ratio = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  // DOMRect arithmetic can land a few millionths either side of the same
  // half-pixel. Stabilize that tie so reversing/scrolling a selection doesn't
  // randomly change a shared edge by one physical pixel.
  return Math.round(value * ratio + 0.0001) / ratio;
}
