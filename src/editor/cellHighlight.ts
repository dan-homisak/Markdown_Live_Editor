import { EditorView } from "@codemirror/view";

/**
 * Painting text highlights inside rendered table cells.
 *
 * A cell's DOM must not change under the caret, so a highlight in a cell is
 * never a wrapper element. Its fill is painted through the CSS Custom Highlight
 * API. That API can only fill, so the border a theme asks for comes from one
 * positioned box per match, in a layer over the table. The occurrence highlight
 * and find both paint this way and share what is here.
 */
export interface CellRing {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Class of the ring's box; the layer's default when left out. */
  className?: string;
}

/** On every ring layer, whichever feature owns it. */
export const CELL_RING_LAYER_CLASS = "mlrt-table-highlight-rings";

export interface CellHighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

export function cellHighlightRegistry(view: EditorView): CellHighlightRegistry | null {
  const css = (view.dom.ownerDocument.defaultView as (Window & { CSS?: { highlights?: unknown } }) | null)?.CSS;
  return (css?.highlights as CellHighlightRegistry | undefined) ?? null;
}

/** Registers `ranges` under `name`, or removes the name when there are none. */
export function setCellHighlight(view: EditorView, name: string, ranges: readonly Range[], priority = 0): void {
  const registry = cellHighlightRegistry(view);
  if (!registry) return;
  const win = view.dom.ownerDocument.defaultView as (Window & { Highlight?: new (...ranges: Range[]) => { priority: number } }) | null;
  if (ranges.length === 0 || !win?.Highlight) {
    registry.delete(name);
    return;
  }
  const highlight = new win.Highlight(...ranges);
  highlight.priority = priority;
  registry.set(name, highlight);
}

/**
 * Whether the theme draws a border from `variable`, so ring boxes are needed.
 * No layer exists while it draws none.
 */
export function cellRingsVisible(view: EditorView, variable: string): boolean {
  const win = view.dom.ownerDocument.defaultView;
  if (!win) return false;
  if (win.matchMedia?.("(forced-colors: active)").matches) return true;
  const border = win.getComputedStyle(view.dom).getPropertyValue(variable).trim();
  return border !== "" && border !== "transparent" && !/^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i.test(border);
}

/** Adds one ring per line box of `range`, positioned in its table's scroll container. */
export function collectCellRings(
  cell: HTMLElement,
  range: Range,
  rings: Map<HTMLElement, CellRing[]>,
  className?: string,
): void {
  const scroll = cell.closest<HTMLElement>(".mlrt-table-scroll");
  if (!scroll) return;
  const origin = scroll.getBoundingClientRect();
  let list = rings.get(scroll);
  if (!list) {
    list = [];
    rings.set(scroll, list);
  }
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    list.push({
      left: rect.left - origin.left + scroll.scrollLeft,
      top: rect.top - origin.top + scroll.scrollTop,
      width: rect.width,
      height: rect.height,
      className,
    });
  }
}

/** Writes one feature's ring layers, touching the DOM only where a ring moved. */
export function syncCellRings(
  view: EditorView,
  rings: Map<HTMLElement, CellRing[]>,
  layerClass: string,
  ringClass: string,
): void {
  for (const layer of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(`.${layerClass}`))) {
    const scroll = layer.parentElement;
    if (!scroll || !rings.get(scroll)?.length) layer.remove();
  }
  rings.forEach((list, scroll) => {
    if (list.length === 0) return;
    const signature = list
      .map(ring => `${ring.left.toFixed(2)},${ring.top.toFixed(2)},${ring.width.toFixed(2)},${ring.height.toFixed(2)},${ring.className ?? ""}`)
      .join(";");
    let layer = scroll.querySelector<HTMLElement>(`:scope > .${layerClass}`);
    if (layer?.dataset.signature === signature) return;
    if (!layer) {
      layer = scroll.ownerDocument.createElement("div");
      layer.className = `${CELL_RING_LAYER_CLASS} ${layerClass}`;
      layer.setAttribute("aria-hidden", "true");
      scroll.append(layer);
    }
    const host = layer;
    while (host.childElementCount > list.length) host.lastElementChild?.remove();
    list.forEach((ring, index) => {
      let box = host.children[index] as HTMLElement | undefined;
      if (!box) {
        box = scroll.ownerDocument.createElement("div");
        host.append(box);
      }
      const className = ring.className ?? ringClass;
      if (box.className !== className) box.className = className;
      box.style.left = `${ring.left}px`;
      box.style.top = `${ring.top}px`;
      box.style.width = `${ring.width}px`;
      box.style.height = `${ring.height}px`;
    });
    host.dataset.signature = signature;
  });
}

/**
 * Whether a mutation can change what cell highlights should show: text or
 * structure inside a table widget, or a column width. A ring layer's own
 * writes are not such a change, whichever feature made them.
 */
export function affectsCellHighlights(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (!target || target.closest(`.${CELL_RING_LAYER_CLASS}`)) return false;
  if (record.type === "attributes") return target.classList.contains("mlrt-table-sized-col");
  if (!target.closest(".mlrt-table-cell, .mlrt-table-widget")) return false;
  if (record.type !== "childList") return true;
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return nodes.some(node => !(node instanceof Element && node.classList.contains(CELL_RING_LAYER_CLASS)));
}
