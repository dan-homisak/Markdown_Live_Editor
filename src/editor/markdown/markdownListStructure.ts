import { EditorSelection, EditorState, Extension, Range, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { Tree } from "@lezer/common";
import { getParsedTables } from "../../shared/tableModel";
import { markdownComposing, markdownRenderTree } from "./markdownRenderTree";
import { MarkdownRange } from "./markdownSyntax";

export interface MarkdownListItem {
  from: number;
  lineFrom: number;
  foldFrom: number;
  to: number;
  parent: number | null;
  columns: number;
  contentColumns: number;
  renderColumns: number;
  renderedPrefixColumns: number;
}

/** Parsed ownership includes continuation paragraphs and every nested block,
 * but never mistakes literal code, HTML, or table-cell text for a list. */
export function classifyMarkdownLists(doc: Text, tree: Tree, tabSize = 4): MarkdownListItem[] {
  const items: MarkdownListItem[] = [], tables = getParsedTables(doc);
  tree.iterate({ enter(ref) {
    const node = ref.node;
    if (["FencedCode", "CodeBlock", "HTMLBlock", "MarkdownFrontmatter"].includes(node.name) ||
        tables.some(table => node.from >= table.from && node.to <= table.to)) return false;
    if (node.name !== "ListItem") return;
    const mark = node.getChild("ListMark");
    if (!mark) return;
    let parent = node.parent;
    while (parent && parent.name !== "ListItem") parent = parent.parent;
    const line = doc.lineAt(mark.from);
    const width = (to: number): number => {
      let columns = 0;
      for (const character of doc.sliceString(line.from, to)) columns += character === "\t" ? tabSize - columns % tabSize : 1;
      return columns;
    };
    const prefix = /^[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?/u.exec(doc.sliceString(mark.to, line.to))?.[0] ?? "";
    const columns = width(mark.from), contentColumns = width(mark.to + prefix.length);
    const parentFrom = parent?.getChild("ListMark")?.from ?? null;
    const parentItem = items.find(item => item.from === parentFrom);
    const task = /\[[ xX]\]/u.test(prefix);
    const taskEnd = task ? mark.to + prefix.indexOf("]") + 1 : mark.to;
    const renderedPrefixColumns = task ? 2 + contentColumns - width(taskEnd)
      : contentColumns - columns + (mark.to - mark.from === 1 ? 1 : 0);
    items.push({ from: mark.from, lineFrom: line.from, foldFrom: line.to,
      to: doc.lineAt(node.to).to, parent: parentFrom, columns, contentColumns, renderedPrefixColumns,
      renderColumns: parentItem ? parentItem.renderColumns + Math.max(4, columns - parentItem.columns) : columns });
  } });
  return items;
}

export const markdownListFoldEffect = StateEffect.define<{ from: number; collapsed: boolean }>({
  map: (value, changes) => ({ ...value, from: changes.mapPos(value.from, 1) }),
});

interface ListState {
  items: readonly MarkdownListItem[];
  collapsed: ReadonlySet<number>;
  hidden: readonly MarkdownRange[];
  decorations: DecorationSet;
  composing: boolean;
}

class CollapsedListHint extends WidgetType {
  eq(): boolean { return true; }
  toDOM(view: EditorView): HTMLElement {
    const hint = view.dom.ownerDocument.createElement("span");
    hint.className = "mlrt-list-fold-hint";
    hint.textContent = " ...";
    hint.title = "Nested content is collapsed";
    hint.setAttribute("aria-label", "Collapsed nested content");
    return hint;
  }
}

function listState(items: readonly MarkdownListItem[], collapsed: ReadonlySet<number>): ListState {
  const hidden: MarkdownRange[] = [], ranges: Range<Decoration>[] = [];
  for (const item of items) {
    if (!collapsed.has(item.from) || item.to <= item.foldFrom || hidden.some(range => range.from < item.from && range.to >= item.to)) continue;
    hidden.push({ from: item.foldFrom, to: item.to });
    // One replacement removes source rows from both the height map and gutter.
    // Nested widgets are filtered by their owners before the view is laid out.
    ranges.push(Decoration.replace({ inclusive: false, widget: new CollapsedListHint() }).range(item.foldFrom, item.to));
  }
  return { items, collapsed, hidden, decorations: Decoration.set(ranges, true), composing: false };
}

export const markdownListField = StateField.define<ListState>({
  create: state => listState(classifyMarkdownLists(state.doc, markdownRenderTree(state), state.tabSize), new Set()),
  update(value, transaction) {
    const composing = markdownComposing(transaction, value.composing);
    if (composing) {
      const map = (position: number): number => transaction.changes.mapPos(position);
      return { ...value, composing, decorations: value.decorations.map(transaction.changes),
        items: value.items.map(item => ({ ...item, from: map(item.from), lineFrom: map(item.lineFrom),
          foldFrom: map(item.foldFrom), to: map(item.to), parent: item.parent === null ? null : map(item.parent) })),
        collapsed: new Set([...value.collapsed].map(map)),
        hidden: value.hidden.map(range => ({ from: map(range.from), to: map(range.to) })) };
    }
    const changed = transaction.docChanged || value.composing || markdownRenderTree(transaction.state) !== markdownRenderTree(transaction.startState);
    const items = changed ? classifyMarkdownLists(transaction.state.doc, markdownRenderTree(transaction.state), transaction.state.tabSize) : value.items;
    const removed = new Set<number>();
    transaction.changes.iterChangedRanges((from, to) => {
      for (const position of value.collapsed) if (from <= position && to > position) removed.add(position);
    });
    let collapsed = new Set([...value.collapsed].filter(from => !removed.has(from)).map(from => transaction.changes.mapPos(from, 1)));
    collapsed = new Set([...collapsed].filter(from => items.some(item => item.from === from && item.to > item.foldFrom)));
    let folded = false;
    for (const effect of transaction.effects) if (effect.is(markdownListFoldEffect)) {
      if (effect.value.collapsed) collapsed.add(effect.value.from);
      else collapsed.delete(effect.value.from);
      folded = true;
    }
    // Explicit navigation/search into hidden content reveals its ancestors.
    // Arrow movement skips atomic folds and therefore does not open them.
    if (transaction.selection && !folded) for (const item of items) {
      if (transaction.state.selection.ranges.some(range => range.head > item.foldFrom && range.head < item.to)) collapsed.delete(item.from);
    }
    if (!changed && collapsed.size === value.collapsed.size && [...collapsed].every(from => value.collapsed.has(from))) return value;
    return listState(items, collapsed);
  },
  provide: field => [EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).decorations)],
});

export function markdownListRangeHidden(state: EditorState, range: MarkdownRange): boolean {
  return state.field(markdownListField, false)?.hidden.some(hidden => range.from > hidden.from && range.to <= hidden.to) ?? false;
}

function toggleList(view: EditorView, from: number): void {
  if (view.composing || view.compositionStarted) return;
  const value = view.state.field(markdownListField), item = value.items.find(item => item.from === from);
  if (!item || item.to <= item.foldFrom) return;
  const collapsed = !value.collapsed.has(from);
  const inside = collapsed && view.state.selection.ranges.some(range => range.from <= item.to && range.to > item.foldFrom);
  view.dispatch({ effects: markdownListFoldEffect.of({ from, collapsed }),
    ...(inside ? { selection: EditorSelection.cursor(item.foldFrom) } : {}) });
  view.focus();
}

class ListFoldControl extends WidgetType {
  constructor(readonly from: number, readonly collapsed: boolean) { super(); }
  eq(other: ListFoldControl): boolean { return other.from === this.from && other.collapsed === this.collapsed; }
  toDOM(view: EditorView): HTMLElement {
    const anchor = view.dom.ownerDocument.createElement("span");
    anchor.className = "mlrt-list-fold-anchor";
    const button = view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "mlrt-list-fold-control";
    button.dataset.listFrom = String(this.from);
    button.setAttribute("aria-expanded", String(!this.collapsed));
    button.setAttribute("aria-label", `${this.collapsed ? "Expand" : "Collapse"} nested list content`);
    button.title = `${this.collapsed ? "Expand" : "Collapse"} nested content`;
    button.addEventListener("pointerdown", event => { if (event.button === 0) event.preventDefault(); });
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); toggleList(view, this.from); });
    button.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggleList(view, this.from); }
    });
    anchor.append(button);
    return anchor;
  }
  ignoreEvent(): boolean { return true; }
}

/** Controls occupy no source columns. Guides are a passive overlay measured
 * from CodeMirror's block geometry, including wrapped rows and table widgets. */
class ListView {
  decorations = Decoration.none;
  private readonly guides: HTMLElement;
  private hover: number | null = null;
  private destroyed = false;
  private readonly move = (event: PointerEvent): void => this.pointerMove(event);
  private readonly leave = (): void => this.pointerLeave();
  constructor(readonly view: EditorView) {
    this.guides = view.dom.ownerDocument.createElement("div");
    this.guides.className = "mlrt-list-guides";
    this.guides.setAttribute("aria-hidden", "true");
    view.scrollDOM.append(this.guides);
    view.dom.addEventListener("pointermove", this.move);
    view.dom.addEventListener("pointerleave", this.leave);
    this.build();
  }
  update(update: ViewUpdate): void {
    if (update.state.field(markdownListField).composing) {
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    if (update.docChanged) this.hover = null;
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged ||
        update.state.field(markdownListField) !== update.startState.field(markdownListField)) this.build();
  }
  private build(): void {
    const view = this.view, value = view.state.field(markdownListField), ranges: Range<Decoration>[] = [];
    const activeLine = view.state.doc.lineAt(view.state.selection.main.head).from;
    for (const item of value.items) {
      if (!view.visibleRanges.some(range => item.from >= range.from && item.from <= range.to) || markdownListRangeHidden(view.state, item)) continue;
      const collapsed = value.collapsed.has(item.from);
      ranges.push(Decoration.line({ class: `mlrt-list-row${activeLine === item.lineFrom ? " mlrt-list-caret-row" : ""}${collapsed ? " mlrt-list-collapsed" : ""}`,
        attributes: { style: `--mlrt-list-source-column:calc(${item.columns} * var(--mlrt-list-column-width));--mlrt-list-render-column:calc(${item.renderColumns} * var(--mlrt-list-column-width));--mlrt-list-source-prefix:calc(${item.contentColumns-item.columns} * var(--mlrt-list-column-width));--mlrt-list-render-prefix:calc(${item.renderedPrefixColumns} * var(--mlrt-list-column-width))` } }).range(item.lineFrom));
      // Keep tab stops independent of the changing hanging-prefix width.
      // The original whitespace stays navigable inside a fixed source slot.
      const leading = view.state.doc.sliceString(item.lineFrom, item.from);
      if (leading.includes("\t") && /^[ \t]+$/u.test(leading))
        ranges.push(Decoration.mark({ class: "mlrt-list-leading-space" }).range(item.lineFrom, item.from));
      if (item.to > item.foldFrom) ranges.push(Decoration.widget({ widget: new ListFoldControl(item.from, collapsed), side: -1 }).range(item.from));
    }
    this.decorations = Decoration.set(ranges, true);
    this.measure();
  }
  pointerMove(event: PointerEvent): void {
    if (event.buttons) return;
    const control = (event.target as Element).closest<HTMLElement>("[data-list-from]");
    const position = control ? Number(control.dataset.listFrom) : this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position !== this.hover) { this.hover = position; this.measure(); }
  }
  pointerLeave(): void { this.hover = null; this.measure(); }
  private measure(): void {
    this.view.requestMeasure({ key: this,
      read: () => {
        const view = this.view, value = view.state.field(markdownListField);
        const scroller = view.scrollDOM.getBoundingClientRect(), content = view.contentDOM.getBoundingClientRect();
        const guideAt = (position: number | null): number | undefined => {
          if (position === null) return;
          const current = value.items.filter(item => position >= item.lineFrom && position <= item.to).at(-1);
          // Each guide starts beneath its owning marker. Highlight that row's
          // guide, rather than the ancestor guide one indentation level left.
          return current?.from;
        };
        // Hover adds feedback without masking the caret's nesting level when
        // the pointer rests elsewhere or keyboard navigation changes rows.
        const active = new Set([guideAt(view.state.selection.main.head), guideAt(this.hover)]);
        return value.items.filter(item => item.to > item.foldFrom && !value.collapsed.has(item.from) && !markdownListRangeHidden(view.state, item))
          .map(item => {
            const start = view.lineBlockAt(item.lineFrom), end = view.lineBlockAt(item.to);
            const top = view.documentTop + start.bottom, bottom = view.documentTop + end.bottom;
            // A task's compact widget and literal prefix share a source offset.
            // The fold anchor precedes both and is the stable marker origin.
            const marker = view.dom.querySelector<HTMLElement>(`[data-list-from="${item.from}"]`)?.parentElement?.getBoundingClientRect();
            return { from: item.from, active: active.has(item.from),
              left: (marker?.left ?? content.left + item.renderColumns * view.defaultCharacterWidth) + view.defaultCharacterWidth - scroller.left + view.scrollDOM.scrollLeft,
              top: Math.max(top, scroller.top) - scroller.top + view.scrollDOM.scrollTop,
              height: Math.min(bottom, scroller.bottom) - Math.max(top, scroller.top) };
          }).filter(guide => guide.height > 0);
      },
      write: guides => {
        if (this.destroyed) return;
        this.guides.replaceChildren(...guides.map(guide => {
          const element = this.view.dom.ownerDocument.createElement("div");
          element.className = `mlrt-list-guide${guide.active ? " mlrt-list-guide-active" : ""}`;
          element.dataset.listFrom = String(guide.from);
          element.style.cssText = `left:${guide.left}px;top:${guide.top}px;height:${guide.height}px`;
          return element;
        }));
      },
    });
  }
  destroy(): void {
    this.destroyed = true; this.guides.remove();
    this.view.dom.removeEventListener("pointermove", this.move);
    this.view.dom.removeEventListener("pointerleave", this.leave);
  }
}

export function createMarkdownListStructure(screenReaderOptimized: boolean): Extension {
  return screenReaderOptimized ? [] : [markdownListField, ViewPlugin.fromClass(ListView, {
    decorations: value => value.decorations,
    eventHandlers: {
      scroll() { this.pointerLeave(); },
    },
  })];
}
