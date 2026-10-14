import { markdown } from "@codemirror/lang-markdown";
import { syntaxTreeAvailable } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Extension, Facet, Prec, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { getParsedTables } from "../../shared/tableModel";
import { documentSelectionProjectionTransaction, getDocumentSelectionProjection } from "../documentSelectionState";
import { isMarkdownTaskPointerActivation, MARKDOWN_MARKER_DRAG_EVENT } from "./markdownPointer";
import { taskFocusReturnSelection } from "./markdownFocus";
import { createMarkdownPresentationExtensions } from "./markdownPresentation";
import { createMarkdownLivePreviewExtensions } from "./markdownLivePreview";
import { createMarkdownListEditing } from "./markdownListEditing";
import { createMarkdownProperties } from "./markdownProperties";
import { createMarkdownListStructure } from "./markdownListStructure";
import { createMarkdownSelectionWrapping } from "./markdownSelectionWrapping";
import { createMarkdownCompositionTracking, markdownComposing, markdownRenderTreeField, markdownRenderTree as syntaxTree } from "./markdownRenderTree";
import { createMarkdownBlockExtensions, markdownBlockLanguageExtensions, markdownCodeLanguages } from "./markdownBlocks";
import {
  classifyMarkdownMarkers, findTaskAtCaret, markdownParserExtensions,
  MarkdownMarker, MarkdownTaskMarker, planTaskToggle,
} from "./markdownSyntax";

export interface MarkdownRenderingOptions {
  enabled: boolean;
  showHeadingMarkers?: boolean;
  screenReaderOptimized: boolean;
  readOnly: boolean;
}

export const markdownRenderingCompartment = new Compartment();
export const markdownTaskChangeAnnotation = Annotation.define<boolean>();
const taskActionGuards = new WeakMap<EditorView, () => boolean>();
const actionNotifiers = new WeakMap<EditorView, (message: string) => void>();

export function setMarkdownActionNotifier(view: EditorView, notify: (message: string) => void): void {
  actionNotifiers.set(view, notify);
}

/** The synchronization owner includes composition settlement in availability. */
export function setMarkdownTaskActionGuard(view: EditorView, guard: () => boolean): void {
  taskActionGuards.set(view, guard);
}

export function refreshMarkdownTaskAvailability(view: EditorView): void {
  view.plugin(markerPlugin)?.refresh();
}
const optionsFacet = Facet.define<MarkdownRenderingOptions, MarkdownRenderingOptions>({
  combine: values => values[0] ?? { enabled: false, screenReaderOptimized: false, readOnly: false },
});
export const markdownRenderingOptionsFacet = optionsFacet;

const editingOwners = new WeakMap<EditorView, "source" | "table">();
// Keep only passive ownership tracking while rendering is disabled. A palette
// command must never act on a source caret parked by a table editor, including
// after settings reconfigure the rendering compartment.
const editingOwnerTracker = ViewPlugin.fromClass(class {
  private readonly record = (event: FocusEvent): void => this.recordTarget(event.target);
  constructor(readonly view: EditorView) {
    this.recordTarget(view.dom.ownerDocument.activeElement);
    view.dom.addEventListener("focusin", this.record, true);
  }
  private recordTarget(target: EventTarget | null): void {
    if (!(target instanceof Element) || !this.view.dom.contains(target)) return;
    if (target.closest(".mlrt-table-widget")) editingOwners.set(this.view, "table");
    else if (target === this.view.contentDOM || target.closest(".mlrt-markdown-task-control")) {
      editingOwners.set(this.view, "source");
    }
  }
  destroy(): void {
    this.view.dom.removeEventListener("focusin", this.record, true);
    editingOwners.delete(this.view);
  }
});

/** Recovery restores the original parser/input configuration as well as appearance. */
export function createMarkdownRenderingExtensions(options: MarkdownRenderingOptions): Extension {
  return [optionsFacet.of(options), editingOwnerTracker, createMarkdownCompositionTracking(), createMarkdownSelectionWrapping(options.readOnly), options.enabled
    ? [createMarkdownProperties(options.readOnly), createMarkdownListEditing(options.readOnly),
      markdown({ extensions: [markdownParserExtensions, markdownBlockLanguageExtensions], codeLanguages: markdownCodeLanguages }),
      markdownRenderTreeField,
      createMarkdownListStructure(options.screenReaderOptimized),
      createMarkdownPresentationExtensions(), createMarkdownBlockExtensions(),
      createMarkdownLivePreviewExtensions(options.screenReaderOptimized, options.showHeadingMarkers), markdownMarkerField, markerPlugin]
    : markdown()];
}

function canAct(view: EditorView): boolean {
  const options = view.state.facet(optionsFacet);
  const plugin = view.plugin(markerPlugin);
  return options.enabled && !options.readOnly && !view.state.readOnly &&
    !!plugin && !plugin.failed && !view.compositionStarted && !view.composing && !plugin.composing &&
    (taskActionGuards.get(view)?.() ?? true);
}

function taskAtContext(view: EditorView): MarkdownTaskMarker | null {
  const selection = view.state.selection;
  const projection = getDocumentSelectionProjection(view.dom.ownerDocument, selection.main);
  if (selection.ranges.length !== 1 || !selection.main.empty ||
      (projection && projection.anchor !== projection.head)) return null;
  // A source caret parked by a table editor is not an intentional prose context.
  if (view.dom.ownerDocument.activeElement?.closest(".mlrt-table-cell") ||
      view.plugin(markerPlugin)?.lastEditingOwner === "table") return null;
  const focused = view.plugin(markerPlugin)?.focusedFrom;
  if (!syntaxTreeAvailable(view.state, focused ?? selection.main.head)) return null;
  return findTaskAtCaret(view.state.doc, syntaxTree(view.state), focused ?? selection.main.head,
    getParsedTables(view.state.doc));
}

export function toggleMarkdownTask(view: EditorView): boolean {
  if (!canAct(view)) return false;
  const marker = taskAtContext(view);
  return marker ? toggleAt(view, marker.from) : false;
}

export function canToggleMarkdownTask(view: EditorView): boolean {
  return canAct(view) && taskAtContext(view) !== null;
}

/** Extend the existing source context menu only for an intentional task hit. */
export function markdownTaskContextActions(view: EditorView, event: MouseEvent): readonly { label: string; run: () => void }[] {
  if (!canAct(view) || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty ||
      (event.target instanceof Element && event.target.closest(".mlrt-table-widget"))) return [];
  const projection = getDocumentSelectionProjection(view.dom.ownerDocument);
  if (projection && (projection.anchor !== projection.head || projection.tableRegions.length > 0)) return [];
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null || !syntaxTreeAvailable(view.state, position) ||
      !findTaskAtCaret(view.state.doc, syntaxTree(view.state), position, getParsedTables(view.state.doc))) return [];
  view.dispatch({ selection: EditorSelection.cursor(position) });
  view.focus();
  return [
    { label: "Toggle Task Checkbox", run: () => { toggleMarkdownTask(view); } },
    { label: "Focus Task Checkbox", run: () => { if (!focusMarkdownTask(view)) explainTaskFocusFallback(view); } },
  ];
}

export function explainTaskFocusFallback(view: EditorView): void {
  actionNotifiers.get(view)?.(canToggleMarkdownTask(view)
    ? "A checkbox cannot be focused here. Use Toggle Task Checkbox at Caret."
    : "Place a single caret in an editable task to focus its checkbox.");
}

function toggleAt(view: EditorView, from: number): boolean {
  if (!canAct(view)) return false;
  const edit = planTaskToggle(view.state.doc, syntaxTree(view.state), from, getParsedTables(view.state.doc));
  if (!edit) return false;
  const projection = getDocumentSelectionProjection(view.dom.ownerDocument, view.state.selection.main);
  view.dispatch({
    changes: edit,
    selection: view.state.selection,
    annotations: [markdownTaskChangeAnnotation.of(true),
      ...(projection ? [documentSelectionProjectionTransaction.of(true)] : [])],
    userEvent: "input.task",
  });
  return true;
}

export function focusMarkdownTask(view: EditorView): boolean {
  if (!canAct(view)) return false;
  const marker = taskAtContext(view);
  const plugin = view.plugin(markerPlugin);
  if (!marker || !plugin || view.state.facet(optionsFacet).screenReaderOptimized) return false;
  plugin.bookmark = view.state.selection.main.head;
  plugin.focusedFrom = marker.from;
  plugin.wantsFocus = true;
  view.dispatch({ effects: EditorView.scrollIntoView(marker.from) });
  plugin.refresh();
  return true;
}

/** Authoritative replacement/rejection cancels source-dependent control intent. */
export function invalidateMarkdownTaskContext(view: EditorView): void {
  view.plugin(markerPlugin)?.invalidateContext();
}

interface MarkerSize { width: number; height: number }

/** A compact two-column marker slot. Source glyphs remain in the document and
 * reappear together when the caret enters any part of the task prefix. */
class TaskControl extends WidgetType {
  constructor(readonly marker: MarkdownTaskMarker, readonly disabled: boolean, readonly visible: boolean) { super(); }
  eq(other: TaskControl): boolean {
    return this.marker.from === other.marker.from && this.marker.checked === other.marker.checked &&
      this.marker.label === other.marker.label && this.marker.source === other.marker.source && this.disabled === other.disabled && this.visible === other.visible;
  }
  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "mlrt-markdown-task-anchor";
    if (!this.visible) return element;
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = "mlrt-markdown-task-control";
    button.setAttribute("role", "checkbox");
    element.append(button);
    this.updateDOM(element);
    return element;
  }
  updateDOM(element: HTMLElement): boolean {
    if (this.visible !== !!element.firstElementChild) return false;
    if (!this.visible) return true;
    const button = element.firstElementChild as HTMLButtonElement;
    // A control's identity belongs to one source task. Reusing its DOM for a
    // different viewport row can carry old focus/pointer ownership with it.
    if (button.dataset.markdownTaskFrom !== undefined && Number(button.dataset.markdownTaskFrom) !== this.marker.from) return false;
    button.dataset.markdownTaskFrom = String(this.marker.from);
    button.setAttribute("aria-label", this.marker.label || "Task");
    button.setAttribute("aria-checked", String(this.marker.checked));
    button.setAttribute("aria-disabled", String(this.disabled));
    button.title = "Toggle task · Command Palette: Toggle Task Checkbox at Caret";
    return true;
  }
  ignoreEvent(event: Event): boolean { return event.type === "selectionchange"; }
}

interface MarkerContext {
  focused: boolean;
  focusedFrom: number | null;
  disabled: boolean;
  projected: { from: number; to: number } | null;
  windows: readonly { from: number; to: number }[] | null;
  failed: boolean;
}
const sameWindows = (a: MarkerContext["windows"], b: MarkerContext["windows"]): boolean =>
  a === b || !!a && !!b && a.length === b.length && a.every((range, i) => range.from === b[i].from && range.to === b[i].to);
const markerContextEffect = StateEffect.define<MarkerContext>();
interface MarkerState extends MarkerContext {
  markers: readonly MarkdownMarker[];
  decorations: DecorationSet;
  composing: boolean;
}

function markerDecorations(state: EditorState, value: Omit<MarkerState, "decorations">): DecorationSet {
  const ranges: Range<Decoration>[] = [], tasks = new Map(value.markers.filter((marker): marker is MarkdownTaskMarker => marker.kind === "task")
    .map(marker => [state.doc.lineAt(marker.from).number, marker]));
  if (value.failed || state.facet(optionsFacet).screenReaderOptimized) return Decoration.none;
  for (const marker of value.markers) {
    const line = state.doc.lineAt(marker.from);
    const task = tasks.get(line.number);
    const reveal = task ? { from: task.itemFrom, to: task.to } : marker;
    // Keep complex bidi source literal; compact controls cannot safely share
    // a marker position across reordered text runs.
    const literal = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(line.text) ||
        value.projected && value.projected.from < marker.to && value.projected.to > marker.from ||
        state.selection.ranges.some(range => range.empty
          ? value.focused && range.head >= reveal.from && range.head <= reveal.to && value.focusedFrom !== task?.from
          : range.from < reveal.to && range.to > reveal.from);
    if (marker.kind === "bullet" && !task) {
      // Revealing a bullet changes its glyph, not its marker or label column.
      // Only task prefixes need extra room for their editable source syntax.
      ranges.push(Decoration.mark({ class: `mlrt-list-bullet-slot${literal ? "" : " mlrt-markdown-marker mlrt-markdown-bullet"}`,
        ...(literal ? {} : { attributes: { "aria-hidden": "true" } }) }).range(marker.from, marker.to));
      if (state.doc.sliceString(marker.to, marker.to + 1) === " ")
        ranges.push(Decoration.mark({ class: "mlrt-list-bullet-gap" }).range(marker.to, marker.to + 1));
      ranges.push(Decoration.line({ class: "mlrt-list-bullet-row" }).range(line.from));
      continue;
    }
    if (literal) continue;
    if (marker.kind === "bullet" && tasks.has(line.number)) {
      continue;
    }
    if (marker.kind === "rule") ranges.push(Decoration.line({ class: "mlrt-markdown-rule-row" }).range(line.from));
    ranges.push(Decoration.mark({ class: `mlrt-markdown-marker mlrt-markdown-${marker.kind}`,
      attributes: { "aria-hidden": "true" } }).range(marker.kind === "task" ? marker.itemFrom : marker.from, marker.to));
    if (marker.kind !== "rule") ranges.push(Decoration.line({ class: `mlrt-list-${marker.kind}-rendered` }).range(line.from));
    if (marker.kind === "task") {
      if (marker.checked && marker.to < line.to) ranges.push(Decoration.mark({ class: "mlrt-markdown-task-complete" }).range(marker.to, line.to));
      ranges.push(Decoration.widget({ widget: new TaskControl(marker, value.disabled || state.readOnly ||
        state.facet(optionsFacet).readOnly, !value.windows || value.windows.some(range => marker.from >= range.from && marker.from <= range.to)), side: 0 }).range(marker.itemFrom));
    }
  }
  return Decoration.set(ranges, true);
}

/** Source-ordered decorations exist before rows enter CodeMirror's height map,
 * just as table decorations do. The view plugin only owns input and hit testing. */
export const markdownMarkerField = StateField.define<MarkerState>({
  create(state) {
    const value = { markers: classifyMarkdownMarkers(state.doc, syntaxTree(state), getParsedTables(state.doc)),
      focused: false, focusedFrom: null, disabled: false, projected: null, composing: false, windows: null, failed: false };
    return { ...value, decorations: markerDecorations(state, value) };
  },
  update(value, transaction) {
    let context: MarkerContext = value;
    if (transaction.docChanged) context = { ...context,
      focusedFrom: context.focusedFrom === null ? null : transaction.changes.mapPos(context.focusedFrom),
      windows: context.windows?.map(range => ({ from: transaction.changes.mapPos(range.from), to: transaction.changes.mapPos(range.to) })) ?? null,
      projected: context.projected && { from: transaction.changes.mapPos(context.projected.from), to: transaction.changes.mapPos(context.projected.to) } };
    for (const effect of transaction.effects) if (effect.is(markerContextEffect)) context = effect.value;
    const composing = markdownComposing(transaction, value.composing);
    if (composing) return { ...value, ...context, composing, decorations: value.decorations.map(transaction.changes) };
    const sourceChanged = transaction.docChanged || value.composing || syntaxTree(transaction.state) !== syntaxTree(transaction.startState);
    if (!sourceChanged && !transaction.selection && context.focused === value.focused && context.focusedFrom === value.focusedFrom &&
        context.disabled === value.disabled && context.projected?.from === value.projected?.from && context.projected?.to === value.projected?.to &&
        context.failed === value.failed && sameWindows(context.windows, value.windows) &&
        transaction.state.readOnly === transaction.startState.readOnly &&
        transaction.state.facet(optionsFacet) === transaction.startState.facet(optionsFacet)) return value;
    const markers = sourceChanged ? classifyMarkdownMarkers(transaction.state.doc, syntaxTree(transaction.state), getParsedTables(transaction.state.doc)) : value.markers;
    const next = { ...context, markers, composing: false };
    return { ...next, decorations: markerDecorations(transaction.state, next) };
  },
  // Marker slots nest inside the continuous selection paint for the whole row.
  provide: field => Prec.high(EditorView.decorations.from(field, value => value.decorations)),
});

class MarkerView {
  decorations: DecorationSet = Decoration.none;
  markers: MarkdownMarker[] = [];
  sizes = new Map<string, MarkerSize>();
  private rejectedSizes = new Set<string>();
  tree: ReturnType<typeof syntaxTree>;
  focusedFrom: number | null = null;
  bookmark: number | null = null;
  wantsFocus = false;
  composing = false;
  failed = false;
  destroyed = false;
  get lastEditingOwner(): "source" | "table" { return editingOwners.get(this.view) ?? "source"; }
  private scheduled = false;
  private classifiedWindows = "";
  private metricSignature = "";
  private observer: ResizeObserver | null = null;
  private metricObserver: MutationObserver | null = null;
  private focusedControl: HTMLElement | null = null;
  private pointer: { from: number; pointerId: number; x: number; y: number; owner: Element | null; selection: EditorSelection; dragged: boolean } | null = null;
  private readonly preserveControlSelection = (event: Event): void => {
    // Chromium can collapse its native range on a noneditable control press
    // even when pointerdown is canceled. During that exact activation only,
    // retain the existing source/table projection instead of importing it as
    // a new source selection. Confirmed drags return to the existing owner.
    if (this.pointer && !this.pointer.dragged && !this.composing &&
        this.view.state.selection === this.pointer.selection) event.stopImmediatePropagation();
  };

  constructor(readonly view: EditorView) {
    this.tree = syntaxTree(view.state);
    try {
      view.dom.ownerDocument.addEventListener("selectionchange", this.preserveControlSelection, true);
      this.observer = new ResizeObserver(() => this.invalidateMetrics());
      this.observer.observe(view.scrollDOM);
      this.metricObserver = new MutationObserver(() => this.invalidateMetrics());
      this.metricObserver.observe(view.dom.ownerDocument.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
      this.metricObserver.observe(view.dom.ownerDocument.body, { attributes: true, attributeFilter: ["style", "class"] });
      this.classify();
      this.schedule();
      // A newly reconfigured plugin is constructed before the view has finished
      // publishing its visible ranges. Revisit them once that update is complete.
      queueMicrotask(() => {
        if (this.destroyed || this.failed) return;
        try { this.classify(); this.refresh(); } catch { this.fail(); this.refresh(); }
      });
    } catch { this.fail(); }
  }

  update(update: ViewUpdate): void {
    if (this.failed) return;
    try {
      if (update.docChanged) {
        this.pointer = null;
        if (this.focusedFrom !== null) this.focusedFrom = update.changes.mapPos(this.focusedFrom);
        if (this.bookmark !== null) this.bookmark = update.changes.mapPos(this.bookmark);
      }
      // Never replace composing DOM; mark spans have no atomic source ranges.
      if (this.composing || update.view.compositionStarted) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (!update.view.inView || update.view.dom.ownerDocument.hidden) {
        this.decorations = this.decorations.map(update.changes);
        this.classifiedWindows = "hidden";
        return;
      }
      const nextTree = syntaxTree(update.state);
      if (update.docChanged || update.viewportChanged || nextTree !== this.tree ||
          this.classifiedWindows !== this.readyWindows().map(range => `${range.from}:${range.to}`).join(",")) {
        this.tree = nextTree;
        this.sizes.clear();
        this.rejectedSizes.clear();
        this.classify();
      }
      if (update.selectionSet && this.focusedFrom !== null && !this.ownsControlFocus()) {
        this.focusedFrom = null;
        this.bookmark = null;
      }
      this.build();
      this.schedule();
    } catch { this.fail(); }
  }

  private classify(): void {
    const windows = this.readyWindows();
    this.classifiedWindows = windows.map(range => `${range.from}:${range.to}`).join(",");
    this.markers = classifyMarkdownMarkers(this.view.state.doc, this.tree,
      getParsedTables(this.view.state.doc), windows);
  }

  private readyWindows(): readonly { from: number; to: number }[] {
    // CodeMirror may also mount a parked selection row far outside its actual
    // viewport. Keep that row's compact slot, but do not retain a live control.
    const viewport = this.view.viewport;
    return this.view.visibleRanges.map(range => ({ from: Math.max(range.from, viewport.from), to: Math.min(range.to, viewport.to) }))
      .filter(range => range.from < range.to);
  }

  private key(marker: MarkdownMarker): string { return `${marker.from}:${marker.to}:${marker.source}`; }

  private literal(marker: MarkdownMarker): boolean {
    const view = this.view;
    if (view.state.facet(optionsFacet).screenReaderOptimized) return true;
    const selection = view.state.selection;
    const reveal = marker.kind === "task" ? { from: marker.itemFrom, to: marker.to } : marker;
    const projected = getDocumentSelectionProjection(view.dom.ownerDocument, selection.main);
    if (projected && projected.anchor !== projected.head &&
        Math.min(projected.anchor, projected.head) < marker.to && Math.max(projected.anchor, projected.head) > marker.from) return true;
    for (const range of selection.ranges) {
      if (!range.empty && range.from < marker.to && range.to > marker.from) return true;
      if (range.empty && view.hasFocus && range.head >= reveal.from && range.head <= reveal.to && this.focusedFrom !== marker.from) return true;
    }
    return false;
  }

  private build(): void {
    if (this.focusedFrom !== null && !this.wantsFocus && !this.markers.some(marker =>
        marker.kind === "task" && marker.from === this.focusedFrom && !this.literal(marker) && !this.rejectedSizes.has(this.key(marker)) &&
        !this.view.bidiSpans(this.view.state.doc.lineAt(marker.from)).some(span => span.level % 2)))
      this.releaseFocus();
  }

  private invalidateMetrics(): void {
    if (this.destroyed || this.composing || this.view.compositionStarted) return;
    // Theme notifications also change colors. Verify actual geometry in the
    // scheduled read phase before discarding useful marker measurements.
    this.schedule();
  }

  refresh(): void {
    if (this.destroyed) return;
    const projected = getDocumentSelectionProjection(this.view.dom.ownerDocument, this.view.state.selection.main);
    this.view.dispatch({ effects: markerContextEffect.of({ focused: this.view.hasFocus, focusedFrom: this.focusedFrom,
      windows: this.readyWindows(), failed: this.failed,
      disabled: !canAct(this.view), projected: projected && projected.anchor !== projected.head
        ? { from: Math.min(projected.anchor, projected.head), to: Math.max(projected.anchor, projected.head) } : null }) });
    this.schedule();
  }

  schedule(): void {
    if (this.scheduled || this.failed || this.destroyed || this.composing || this.view.compositionStarted ||
        !this.view.inView || this.view.dom.ownerDocument.hidden) return;
    this.scheduled = true;
    this.view.requestMeasure({
      key: this,
      read: () => {
        try {
        const style = this.view.dom.ownerDocument.defaultView!.getComputedStyle(this.view.contentDOM);
        const metricSignature = [style.fontFamily, style.fontSize, style.fontWeight,
          style.fontStyle, style.lineHeight, style.letterSpacing, style.fontFeatureSettings,
          style.fontVariationSettings, style.whiteSpace, style.direction,
          this.view.scrollDOM.clientWidth, this.view.dom.ownerDocument.defaultView!.devicePixelRatio].join("|");
        const sameMetrics = metricSignature === this.metricSignature;
        const result = new Map<string, MarkerSize>();
        for (const marker of this.markers) {
          const cached = sameMetrics ? this.sizes.get(this.key(marker)) : undefined;
          if (cached) { result.set(this.key(marker), cached); continue; }
          const line = this.view.state.doc.lineAt(marker.from);
          if (marker.to > line.to || this.view.bidiSpans(line).some(span => span.level % 2)) continue;
          if (marker.kind === "task" && !this.literal(marker)) {
            const control = this.view.dom.querySelector<HTMLElement>(`[data-markdown-task-from="${marker.from}"]`);
            const box = control?.getBoundingClientRect();
            if (box && box.width > 0) result.set(this.key(marker), { width: box.width, height: box.height });
            continue;
          }
          const start = this.view.domAtPos(marker.from, 1);
          const end = this.view.domAtPos(marker.to, -1);
          const range = this.view.dom.ownerDocument.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          const boxes = Array.from(range.getClientRects()).filter(box => box.width > 0);
          const a = this.view.coordsAtPos(marker.from, 1);
          const b = this.view.coordsAtPos(marker.to, -1);
          if (!a || !b || boxes.length === 0 || boxes.some(box => Math.abs(box.top - boxes[0].top) > 0.5) || Math.abs(a.top - b.top) > 0.5) continue;
          const width = b.left - a.left;
          if (width > 0 && Number.isFinite(width)) result.set(this.key(marker), { width, height: this.view.defaultLineHeight });
        }
        return { sizes: result, metricSignature };
        } catch { return null; }
      },
      write: measurement => {
        this.scheduled = false;
        if (this.destroyed || this.composing || this.view.compositionStarted) return;
        if (!measurement) {
          this.fail();
          queueMicrotask(() => { if (!this.destroyed) this.view.dispatch({}); });
          return;
        }
        const { sizes, metricSignature } = measurement;
        this.rejectedSizes = new Set(this.markers.filter(marker => {
          const line = this.view.state.doc.lineAt(marker.from);
          return line.from >= this.view.viewport.from && line.to <= this.view.viewport.to && !sizes.has(this.key(marker));
        }).map(marker => this.key(marker)));
        this.metricSignature = metricSignature;
        const changed = sizes.size !== this.sizes.size || [...sizes].some(([key, size]) => {
          const previous = this.sizes.get(key);
          return !previous || Math.abs(previous.width - size.width) > 0.01 || Math.abs(previous.height - size.height) > 0.01;
        });
        this.sizes = sizes;
        const focused = this.markers.find(marker => marker.from === this.focusedFrom && marker.kind === "task");
        const focusedGeometryRejected = !!focused && !sizes.has(this.key(focused));
        // CodeMirror runs measurement writes inside its update phase. Dispatch
        // only after that phase, then focus the freshly projected control.
        if (changed || this.wantsFocus || focusedGeometryRejected || this.view.state.field(markdownMarkerField).focused !== this.view.hasFocus ||
            !sameWindows(this.view.state.field(markdownMarkerField).windows, this.readyWindows())) queueMicrotask(() => {
          if (this.destroyed || this.failed || this.composing || this.view.compositionStarted) return;
          this.refresh();
          if (this.wantsFocus) {
            const control = this.view.dom.querySelector<HTMLButtonElement>(`[data-markdown-task-from="${this.focusedFrom}"]`);
            this.wantsFocus = false;
            if (control) { control.focus({ preventScroll: true }); this.focusedControl = control; }
            else { this.focusedFrom = null; this.bookmark = null; explainTaskFocusFallback(this.view); }
          }
        });
      },
    });
  }

  private ownsControlFocus(): boolean {
    const active = this.view.dom.ownerDocument.activeElement;
    return !!active && this.view.dom.contains(active) && active.matches(".mlrt-markdown-task-control");
  }

  releaseFocus(): void {
    const owned = this.ownsControlFocus() || !!this.focusedControl && !this.focusedControl.isConnected &&
      this.view.dom.ownerDocument.activeElement === this.view.dom.ownerDocument.body;
    const originalOwner = this.view.dom.ownerDocument.activeElement;
    const bookmark = this.bookmark;
    const selection = this.view.state.selection;
    this.focusedFrom = null;
    this.bookmark = null;
    this.wantsFocus = false;
    this.focusedControl = null;
    if (owned) queueMicrotask(() => {
      const doc = this.view.dom.ownerDocument;
      if (!this.view.dom.isConnected || !doc.hasFocus() ||
          (doc.activeElement !== originalOwner && doc.activeElement !== doc.body)) return;
      // A newer focus command supersedes this queued return. A newer source
      // selection or host-mapped selection is retained, but still needs owned
      // focus returned when its checkbox was removed from the DOM.
      const plugin = this.view.plugin(markerPlugin);
      if (plugin?.focusedFrom !== null && plugin?.focusedFrom !== undefined) return;
      const currentSelection = this.view.state.selection;
      const restoredSelection = taskFocusReturnSelection(
        this.view.state.doc, selection, currentSelection, bookmark,
        getParsedTables(this.view.state.doc),
      );
      if (restoredSelection !== currentSelection) this.view.dispatch({ selection: restoredSelection });
      this.view.focus();
    });
  }

  pointerDown(event: PointerEvent): boolean {
    const control = (event.target as Element).closest<HTMLButtonElement>(".mlrt-markdown-task-control");
    if (!control || !isMarkdownTaskPointerActivation(event)) return false;
    event.preventDefault();
    this.pointer = { from: Number(control.dataset.markdownTaskFrom), pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      owner: this.view.dom.ownerDocument.activeElement, selection: this.view.state.selection, dragged: false };
    control.setPointerCapture(event.pointerId);
    return true;
  }

  pointerMove(event: PointerEvent): boolean {
    const pointer = this.pointer;
    if (!pointer || pointer.pointerId !== event.pointerId || !event.isPrimary ||
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) <= 3) return false;
    if (!pointer.dragged) {
      const handoff = new CustomEvent(MARKDOWN_MARKER_DRAG_EVENT, {
        bubbles: true, cancelable: true,
        detail: { anchor: pointer.from, pointerEvent: event },
      });
      if (!this.view.dom.dispatchEvent(handoff)) {
        this.pointer = null;
        return true;
      }
    }
    pointer.dragged = true;
    const head = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (head !== null) this.view.dispatch({ selection: { anchor: pointer.from, head } });
    this.view.focus();
    return true;
  }

  pointerUp(event: PointerEvent): boolean {
    const pointer = this.pointer;
    if (!pointer || pointer.pointerId !== event.pointerId || !event.isPrimary) return false;
    this.pointer = null;
    event.preventDefault();
    if (!pointer.dragged && pointer.selection === this.view.state.selection &&
        this.controlGeometryReady(pointer.from) &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) <= 3) {
      toggleAt(this.view, pointer.from);
      if (pointer.owner instanceof HTMLElement && pointer.owner.isConnected) pointer.owner.focus({ preventScroll: true });
    }
    return true;
  }

  invalidateContext(): void {
    this.pointer = null;
    this.releaseFocus();
  }

  cancelPointer(): void { this.pointer = null; }

  private controlGeometryReady(from: number): boolean {
    const marker = this.markers.find(candidate => candidate.kind === "task" && candidate.from === from);
    return !!marker && !this.rejectedSizes.has(this.key(marker)) &&
      !this.view.bidiSpans(this.view.state.doc.lineAt(marker.from)).some(span => span.level % 2);
  }

  compositionStart(): void {
    this.composing = true;
    this.pointer = null;
    for (const control of Array.from(this.view.dom.querySelectorAll(".mlrt-markdown-task-control"))) {
      control.setAttribute("aria-disabled", "true");
    }
  }

  keyDown(event: KeyboardEvent): boolean {
    const control = (event.target as Element).closest<HTMLButtonElement>(".mlrt-markdown-task-control");
    if (!control) return false;
    if (event.key === "Escape") { event.preventDefault(); this.releaseFocus(); return true; }
    if (event.key === " " && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      const from = Number(control.dataset.markdownTaskFrom);
      if (this.controlGeometryReady(from)) toggleAt(this.view, from);
      return true;
    }
    return false;
  }

  fail(): void {
    this.failed = true;
    this.releaseFocus();
    this.decorations = Decoration.none;
    this.markers = [];
    this.sizes.clear();
    queueMicrotask(() => { if (!this.destroyed) this.refresh(); });
    console.warn("Markdown rendering disabled for this view after a presentation failure.");
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.metricObserver?.disconnect();
    this.view.dom.ownerDocument.removeEventListener("selectionchange", this.preserveControlSelection, true);
    this.releaseFocus();
    this.sizes.clear();
    this.markers = [];
  }
}

const markerPlugin = ViewPlugin.fromClass(MarkerView, {
  eventHandlers: {
    focus() { this.schedule(); return false; },
    pointerdown(event) { return this.pointerDown(event); },
    pointermove(event) { return this.pointerMove(event); },
    pointerup(event) { return this.pointerUp(event); },
    pointercancel() { this.cancelPointer(); return false; },
    lostpointercapture() { this.cancelPointer(); return false; },
    keydown(event) { return this.keyDown(event); },
    compositionstart() { this.compositionStart(); return false; },
    compositionend() { this.composing = false; queueMicrotask(() => this.refresh()); return false; },
    focusout() {
      queueMicrotask(() => {
        if (!this.destroyed && !this.view.dom.ownerDocument.activeElement?.matches(".mlrt-markdown-task-control")) {
          this.focusedFrom = null;
          this.bookmark = null;
          this.refresh();
        }
      });
      return false;
    },
  },
});
