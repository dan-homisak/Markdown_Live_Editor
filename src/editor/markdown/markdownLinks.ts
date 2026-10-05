import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Compartment, Extension, Facet } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getParsedTables } from "../../shared/tableModel";
import { findMarkdownLinkAt, MarkdownSourceLink, resolveMarkdownSourceLink } from "../../shared/markdownLinkValidation";
import { isMarkdownPreviewActive } from "./markdownLivePreview";
import { getDocumentSelectionProjection } from "../documentSelectionState";

export interface MarkdownLinkOptions {
  enabled: boolean;
  documentUri: string | null;
  multiCursorModifier: "alt" | "ctrlCmd";
  isMac: boolean;
}
export interface MarkdownLinkIntent {
  from: number;
  to: number;
  activation: "command" | "pointer";
}
interface LinkConfiguration {
  options: MarkdownLinkOptions;
  post: (intent: MarkdownLinkIntent) => void;
}
const configuration = Facet.define<LinkConfiguration, LinkConfiguration | null>({ combine: values => values[0] ?? null });
// Compartments recreate their ViewPlugin while the palette owns focus. Keep
// the intentional owner keyed by the retained view rather than plugin life.
const sourceEditingOwners = new WeakMap<EditorView, boolean>();
export const markdownLinksCompartment = new Compartment();

export function isMarkdownLinkModifier(
  event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; getModifierState?: (key: string) => boolean },
  options: Pick<MarkdownLinkOptions, "isMac" | "multiCursorModifier">,
): boolean {
  if (event.shiftKey || event.getModifierState?.("AltGraph")) return false;
  if (options.multiCursorModifier === "ctrlCmd") return event.altKey && !event.ctrlKey && !event.metaKey;
  return options.isMac ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.metaKey && !event.altKey;
}

function safeSelection(view: EditorView): boolean {
  const selection = view.state.selection;
  const projection = getDocumentSelectionProjection(view.dom.ownerDocument, selection.main);
  return selection.ranges.length === 1 && selection.main.empty &&
    (!projection || projection.anchor === projection.head) &&
    view.plugin(linkPlugin)?.sourceOwnsContext !== false &&
    !view.dom.ownerDocument.activeElement?.closest(".mlrt-table-cell, .mlrt-markdown-task-control");
}

function available(view: EditorView): boolean {
  return configurationValue(view)?.options.enabled === true && safeSelection(view) &&
    !view.compositionStarted && !view.composing && !view.plugin(linkPlugin)?.composing;
}
const configurationValue = (view: EditorView): LinkConfiguration | null => view.state.facet(configuration);

function sourceLink(view: EditorView, position: number): MarkdownSourceLink | null {
  const link = findMarkdownLinkAt(view.state.doc, syntaxTree(view.state), position, getParsedTables(view.state.doc));
  return link && syntaxTreeAvailable(view.state, link.to) ? link : null;
}

export function markdownLinkDiagnostics(view: EditorView, x: number, y: number): unknown {
  const position = view.posAtCoords({ x, y });
  const link = position === null ? null : sourceLink(view, position);
  return { available: available(view), owner: view.plugin(linkPlugin)?.sourceOwnsContext, position, link,
    resting: link ? isMarkdownPreviewActive(view, link) : null };
}

/** The palette may own focus; the invoking view retains its intentional caret. */
export function openMarkdownLinkAtCaret(view: EditorView): boolean {
  if (!available(view)) return false;
  const link = sourceLink(view, view.state.selection.main.head);
  if (!link) return false;
  // An explicit command also submits recognized-but-unsupported destinations;
  // the host derives it again and explains its bounded opening policy.
  configurationValue(view)?.post({ from: link.from, to: link.to, activation: "command" });
  return true;
}

class LinkInteraction {
  decorations: DecorationSet = Decoration.none;
  composing = false;
  sourceOwnsContext = true;
  private hover: MarkdownSourceLink | null = null;
  private pointer: { id: number; x: number; y: number; link: MarkdownSourceLink; doc: unknown; selection: unknown; dragged: boolean } | null = null;
  private lastPoint: { x: number; y: number; target: EventTarget | null } | null = null;
  private readonly onFocus = (event: FocusEvent): void => this.recordEditingOwner(event.target);

  constructor(readonly view: EditorView) {
    this.sourceOwnsContext = sourceEditingOwners.get(view) ?? true;
    this.recordEditingOwner(view.dom.ownerDocument.activeElement);
    view.dom.ownerDocument.addEventListener("focusin", this.onFocus, true);
  }

  private recordEditingOwner(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    if (target.closest(".mlrt-table-widget, .mlrt-markdown-task-control")) this.sourceOwnsContext = false;
    else if (this.view.contentDOM.contains(target)) this.sourceOwnsContext = true;
    else return;
    sourceEditingOwners.set(this.view, this.sourceOwnsContext);
    // Workbench/palette focus must preserve the last intentional editing owner.
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged ||
        update.startState.facet(configuration) !== update.state.facet(configuration) ||
        !configurationValue(this.view)?.options.enabled) {
      this.pointer = null;
      this.hover = null;
    }
    this.decorations = this.hover
      ? Decoration.set([Decoration.mark({ class: "mlrt-markdown-link-actionable-hover" }).range(this.hover.from, this.hover.to)])
      : Decoration.none;
  }

  private atPoint(
    event: Parameters<typeof isMarkdownLinkModifier>[0],
    point: { x: number; y: number; target: EventTarget | null },
  ): MarkdownSourceLink | null {
    if (!available(this.view) || !(point.target instanceof Element) || !this.view.dom.contains(point.target) ||
        point.target.closest(".mlrt-table-widget, .mlrt-markdown-task-control")) return null;
    const settings = configurationValue(this.view)?.options;
    if (!settings) return null;
    const position = this.view.posAtCoords(point);
    if (position === null) return null;
    const link = sourceLink(this.view, position);
    if (!link || !resolveMarkdownSourceLink(link, settings.documentUri).ok) return null;
    const unmodified = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.getModifierState?.("AltGraph");
    if (!isMarkdownLinkModifier(event, settings) && !(unmodified && isMarkdownPreviewActive(this.view, link))) return null;
    // posAtCoords returns the nearest text position even beyond a line's ink.
    // A modifier click in trailing whitespace must not open the preceding link.
    const start = this.view.domAtPos(link.from);
    const end = this.view.domAtPos(link.to);
    const range = this.view.dom.ownerDocument.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0 &&
        point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) ? link : null;
    } catch { return null; }
  }

  private setHover(link: MarkdownSourceLink | null): void {
    if (this.hover?.from === link?.from && this.hover?.to === link?.to) return;
    this.hover = link;
    this.view.dispatch({});
  }

  move(event: PointerEvent): boolean {
    this.lastPoint = { x: event.clientX, y: event.clientY, target: event.target };
    if (this.pointer && (Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 3 || event.buttons !== 1)) {
      this.pointer.dragged = true;
    }
    this.setHover(this.atPoint(event, this.lastPoint));
    return false;
  }

  down(event: PointerEvent): boolean {
    this.pointer = null;
    this.recordEditingOwner(event.target);
    if (event.button !== 0 || !event.isPrimary) return false;
    const link = this.atPoint(event, { x: event.clientX, y: event.clientY, target: event.target });
    if (!link) return false;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, link, doc: this.view.state.doc,
      selection: this.view.state.selection, dragged: false };
    // Preserve the source caret; regular/selection clicks remain native.
    event.preventDefault();
    return true;
  }

  up(event: PointerEvent): boolean {
    const pointer = this.pointer;
    this.pointer = null;
    if (!pointer || pointer.dragged || event.button !== 0 || !event.isPrimary || event.pointerId !== pointer.id ||
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3 ||
        pointer.doc !== this.view.state.doc || pointer.selection !== this.view.state.selection) return false;
    const link = this.atPoint(event, { x: event.clientX, y: event.clientY, target: event.target });
    if (!link || link.from !== pointer.link.from || link.to !== pointer.link.to || link.destination !== pointer.link.destination) return false;
    event.preventDefault();
    configurationValue(this.view)?.post({ from: link.from, to: link.to, activation: "pointer" });
    return true;
  }

  cancel(): void { this.pointer = null; this.setHover(null); }
  modifier(event: KeyboardEvent): void {
    this.pointer = null;
    this.setHover(this.lastPoint ? this.atPoint(event, this.lastPoint) : null);
  }
  leave(): void { this.lastPoint = null; this.cancel(); }
  destroy(): void {
    this.pointer = null; this.hover = null;
    this.view.dom.ownerDocument.removeEventListener("focusin", this.onFocus, true);
  }
}

const linkPlugin = ViewPlugin.fromClass(LinkInteraction, {
  decorations: plugin => plugin.decorations,
  eventHandlers: {
    pointermove(event) { return this.move(event); },
    pointerdown(event) { return this.down(event); },
    pointerup(event) { return this.up(event); },
    pointercancel() { this.cancel(); },
    pointerleave() { this.leave(); },
    keydown(event) { this.modifier(event); },
    keyup(event) { this.modifier(event); },
    compositionstart() { this.composing = true; this.cancel(); },
    compositionend() { this.composing = false; },
  },
});

export function createMarkdownLinkExtensions(
  options: MarkdownLinkOptions,
  post: (intent: MarkdownLinkIntent) => void,
): Extension {
  // Keep passive focus ownership while rendering is disabled. A table may gain
  // focus during that period and the palette may own focus when it is enabled.
  // Every hover and activation path remains gated by the enabled option.
  return [configuration.of({ options, post }), linkPlugin];
}
