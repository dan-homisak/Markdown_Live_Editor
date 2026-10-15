import { TABLE_CELL_SELECTOR } from "./cellSelection";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const OVERLAY_SELECTOR = ":scope > .mlrt-table-selection-overlay";
const LEGACY_OUTLINE_SELECTOR = ":scope > .mlrt-table-selection-outline";
const COORDINATE_TOLERANCE = 0.25;

interface SelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Renders every solid selection line in one SVG coordinate space.
 *
 * Cells own only the selection fill. The SVG owns both the interior rails and
 * the perimeter, which prevents independently clipped cell shadows from
 * leaving gaps or crossing the blue frame at grid intersections.
 */
export function syncTableSelectionOverlay(wrapper: HTMLElement): void {
  const scroll = wrapper.querySelector<HTMLElement>(".mlrt-table-scroll");
  const existing = scroll?.querySelector<SVGSVGElement>(OVERLAY_SELECTOR);
  // Remove an outline created by builds that predate the unified SVG overlay.
  scroll
    ?.querySelector<HTMLElement>(LEGACY_OUTLINE_SELECTOR)
    ?.remove();

  if (!scroll) {
    existing?.remove();
    return;
  }

  const selected = Array.from(
    wrapper.querySelectorAll<HTMLElement>(
      `${TABLE_CELL_SELECTOR}.mlrt-table-cell-selected, ` +
        `${TABLE_CELL_SELECTOR}.mlrt-document-range-selected`,
    ),
  );
  if (selected.length === 0) {
    existing?.remove();
    return;
  }

  // CSS borders quantize their used width to whole device pixels. Match that
  // width: a nominal 1px SVG stroke can alternate between one and two painted
  // pixels at fractional display scales, even with crispEdges enabled.
  const win = wrapper.ownerDocument.defaultView;
  const borderWidth = Number.parseFloat(win?.getComputedStyle(selected[0]).borderRightWidth ?? "1");
  const strokeWidth = borderWidth > 0 ? borderWidth : 1 / (win?.devicePixelRatio || 1);
  const rectangles = selected.map((cell) => cell.getBoundingClientRect());
  const bounds: SelectionBounds = {
    left: Math.min(...rectangles.map((rect) => rect.left)),
    top: Math.min(...rectangles.map((rect) => rect.top)),
    right: Math.max(...rectangles.map((rect) => rect.right)),
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
  };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (width <= 0 || height <= 0) {
    existing?.remove();
    return;
  }
  const addresses = selected.map(cell => ({ row: cell.dataset.rowKind === "header" ? 0 : Number(cell.dataset.rowIndex) + 1,
    column: Number(cell.dataset.column) }));
  const rows = addresses.map(cell => cell.row), columns = addresses.map(cell => cell.column);
  const rectangular = selected.length === (Math.max(...rows) - Math.min(...rows) + 1) * (Math.max(...columns) - Math.min(...columns) + 1);
  if (!rectangular) {
    const overlay = existing ?? wrapper.ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
    overlay.style.setProperty("--mlrt-selection-stroke-width", `${strokeWidth}px`);
    overlay.classList.add("mlrt-table-selection-overlay");
    overlay.classList.toggle("mlrt-table-selection-overlay-cut-pending", wrapper.classList.contains("mlrt-table-cut-pending"));
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("focusable", "false");
    overlay.setAttribute("width", formatCoordinate(width));
    overlay.setAttribute("height", formatCoordinate(height));
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const scrollRect = scroll.getBoundingClientRect();
    overlay.style.left = `${bounds.left - scrollRect.left + scroll.scrollLeft}px`;
    overlay.style.top = `${bounds.top - scrollRect.top + scroll.scrollTop}px`;
    overlay.style.width = `${width}px`; overlay.style.height = `${height}px`;
    const { grid, frame } = connectedSelectionPaths(addresses, rectangles, bounds);
    const gridPath = wrapper.ownerDocument.createElementNS(SVG_NAMESPACE, "path");
    gridPath.classList.add("mlrt-table-selection-grid"); gridPath.setAttribute("d", grid);
    const framePath = wrapper.ownerDocument.createElementNS(SVG_NAMESPACE, "path");
    framePath.classList.add("mlrt-table-selection-frame"); framePath.setAttribute("d", frame);
    overlay.replaceChildren(gridPath, framePath);
    overlay.dataset.geometrySignature = "sparse";
    if (!existing) scroll.append(overlay);
    return;
  }

  const verticalRails = uniqueInteriorCoordinates(
    rectangles.map((rect) => rect.left),
    bounds.left,
    bounds.right,
  ).map((coordinate) => coordinate - bounds.left);
  const horizontalRails = uniqueInteriorCoordinates(
    rectangles.map((rect) => rect.top),
    bounds.top,
    bounds.bottom,
  ).map((coordinate) => coordinate - bounds.top);

  const overlay =
    existing ??
    wrapper.ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  overlay.style.setProperty("--mlrt-selection-stroke-width", `${strokeWidth}px`);
  overlay.classList.add("mlrt-table-selection-overlay");
  overlay.classList.toggle(
    "mlrt-table-selection-overlay-cut-pending",
    wrapper.classList.contains("mlrt-table-cut-pending"),
  );
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("focusable", "false");
  const formattedWidth = formatCoordinate(width);
  const formattedHeight = formatCoordinate(height);
  overlay.setAttribute("width", formattedWidth);
  overlay.setAttribute("height", formattedHeight);
  overlay.setAttribute(
    "viewBox",
    `0 0 ${formattedWidth} ${formattedHeight}`,
  );
  overlay.dataset.verticalRailCount = String(verticalRails.length);
  overlay.dataset.horizontalRailCount = String(horizontalRails.length);
  overlay.dataset.verticalRails = verticalRails.map(formatCoordinate).join(",");
  overlay.dataset.horizontalRails = horizontalRails
    .map(formatCoordinate)
    .join(",");

  const scrollRect = scroll.getBoundingClientRect();
  overlay.style.left = `${bounds.left - scrollRect.left + scroll.scrollLeft}px`;
  overlay.style.top = `${bounds.top - scrollRect.top + scroll.scrollTop}px`;
  overlay.style.width = `${formattedWidth}px`;
  overlay.style.height = `${formattedHeight}px`;

  const inset = Math.min(1, width / 2, height / 2);
  const gridCommands = [
    ...verticalRails.map(
      (x) =>
        `M ${formatCoordinate(x)} ${formatCoordinate(inset)} ` +
        `V ${formatCoordinate(height - inset)}`,
    ),
    ...horizontalRails.map(
      (y) =>
        `M ${formatCoordinate(inset)} ${formatCoordinate(y)} ` +
        `H ${formatCoordinate(width - inset)}`,
    ),
  ];
  const gridPath = gridCommands.join(" ");
  const frameWidth = formatCoordinate(Math.max(0, width - 1));
  // Horizontal scrolling also clips vertical overflow in Chromium. Keep the
  // bottom stroke's outer half-pixel inside that boundary so Windows always
  // rasterizes it, including at fractional device scales.
  const frameHeight = formatCoordinate(Math.max(0, height - 1.5));
  const geometrySignature = [
    formattedWidth,
    formattedHeight,
    gridPath,
  ].join("|");
  const currentGrid = overlay.querySelector<SVGPathElement>(
    ":scope > .mlrt-table-selection-grid",
  );
  const currentFrame = overlay.querySelector<SVGRectElement>(
    ":scope > .mlrt-table-selection-frame",
  );
  if (
    overlay.dataset.geometrySignature !== geometrySignature ||
    !currentGrid ||
    !currentFrame ||
    overlay.lastElementChild !== currentFrame
  ) {
    const grid = wrapper.ownerDocument.createElementNS(SVG_NAMESPACE, "path");
    grid.classList.add("mlrt-table-selection-grid");
    grid.setAttribute("d", gridPath);

    // Paint the frame last. Its stroke therefore wins at every rail endpoint,
    // The top/sides use the normal half-pixel inset. The bottom has the extra
    // half-pixel clip clearance encoded in frameHeight above.
    const frame = wrapper.ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
    frame.classList.add("mlrt-table-selection-frame");
    frame.setAttribute("x", "0.5");
    frame.setAttribute("y", "0.5");
    frame.setAttribute("width", frameWidth);
    frame.setAttribute("height", frameHeight);

    overlay.replaceChildren(grid, frame);
    overlay.dataset.geometrySignature = geometrySignature;
  }
  if (!existing) {
    scroll.append(overlay);
  }
}

interface GridVertex { row: number; column: number }
interface ContourEdge { start: GridVertex; end: GridVertex; direction: number }

/** Trace the union on shared grid vertices, then inset each closed contour.
 * Independent cell insets leave gaps at straight joins and concave corners. */
function connectedSelectionPaths(
  cells: readonly GridVertex[],
  rectangles: readonly SelectionBounds[],
  bounds: SelectionBounds,
): { grid: string; frame: string } {
  const key = (vertex: GridVertex): string => `${vertex.row}:${vertex.column}`;
  const selected = new Set(cells.map(key));
  const columns = new Map<number, number>();
  const rows = new Map<number, number>();
  const edges: ContourEdge[] = [];
  const grid: string[] = [];
  const bottomRow = Math.max(...cells.map(cell => cell.row)) + 1;
  for (let index = 0; index < cells.length; index++) {
    const { row, column } = cells[index];
    const rect = rectangles[index];
    columns.set(column, rect.left - bounds.left);
    columns.set(column + 1, rect.right - bounds.left);
    rows.set(row, rect.top - bounds.top);
    rows.set(row + 1, rect.bottom - bounds.top);
    // Clockwise edges keep the selected area on their right, including holes.
    const candidates: ContourEdge[] = [
      { start: { row, column }, end: { row, column: column + 1 }, direction: 0 },
      { start: { row, column: column + 1 }, end: { row: row + 1, column: column + 1 }, direction: 1 },
      { start: { row: row + 1, column: column + 1 }, end: { row: row + 1, column }, direction: 2 },
      { start: { row: row + 1, column }, end: { row, column }, direction: 3 },
    ];
    const neighbors = [
      { row: row - 1, column }, { row, column: column + 1 },
      { row: row + 1, column }, { row, column: column - 1 },
    ];
    candidates.forEach((edge, side) => {
      if (!selected.has(key(neighbors[side]))) edges.push(edge);
      else if (side === 1 || side === 2) {
        // Draw each interior rail once, all the way to its shared endpoints.
        grid.push(`M ${formatCoordinate(rect.right - bounds.left)} ${formatCoordinate(rect.bottom - bounds.top)} ` +
          (side === 1 ? `V ${formatCoordinate(rect.top - bounds.top)}` : `H ${formatCoordinate(rect.left - bounds.left)}`));
      }
    });
  }

  const outgoing = new Map<string, ContourEdge[]>();
  for (const edge of edges) {
    const start = key(edge.start);
    outgoing.set(start, [...(outgoing.get(start) ?? []), edge]);
  }
  const visited = new Set<ContourEdge>();
  const frame: string[] = [];
  const offset = (edge: ContourEdge): number => edge.direction % 2 === 0
    ? rows.get(edge.start.row)! + (edge.direction === 0 ? 0.5 : edge.start.row === bottomRow ? -1 : -0.5)
    : columns.get(edge.start.column)! + (edge.direction === 3 ? 0.5 : -0.5);

  for (const first of edges) {
    if (visited.has(first)) continue;
    const contour: ContourEdge[] = [];
    let edge: ContourEdge | undefined = first;
    while (edge && !visited.has(edge)) {
      visited.add(edge);
      contour.push(edge);
      const direction: number = edge.direction;
      const candidates: ContourEdge[] = outgoing.get(key(edge.end)) ?? [];
      // At a diagonal contact, turn right to keep the two groups separate.
      edge = [1, 0, 3, 2].map(turn => candidates.find(next => next.direction === (direction + turn) % 4)).find(Boolean);
    }
    const points = contour.map((current, index) => {
      const previous = contour[(index + contour.length - 1) % contour.length];
      const horizontal = current.direction % 2 === 0;
      const x = horizontal ? previous.direction % 2 === 1 ? offset(previous) : columns.get(current.start.column)! : offset(current);
      const y = horizontal ? offset(current) : previous.direction % 2 === 0 ? offset(previous) : rows.get(current.start.row)!;
      return `${formatCoordinate(x)} ${formatCoordinate(y)}`;
    });
    frame.push(`M ${points.join(" L ")} Z`);
  }
  return { grid: grid.join(" "), frame: frame.join(" ") };
}

function uniqueInteriorCoordinates(
  values: readonly number[],
  minimum: number,
  maximum: number,
): number[] {
  const sorted = values
    .filter(
      (value) =>
        value > minimum + COORDINATE_TOLERANCE &&
        value < maximum - COORDINATE_TOLERANCE,
    )
    .sort((left, right) => left - right);
  const groups: Array<{ sum: number; count: number }> = [];
  for (const value of sorted) {
    const group = groups.at(-1);
    if (
      !group ||
      Math.abs(value - group.sum / group.count) >
        COORDINATE_TOLERANCE
    ) {
      groups.push({ sum: value, count: 1 });
    } else {
      group.sum += value;
      group.count += 1;
    }
  }
  return groups.map((group) => group.sum / group.count);
}

function formatCoordinate(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
