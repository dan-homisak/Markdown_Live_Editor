import {
  CharCategory,
  Compartment,
  EditorState,
  Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import {
  affectsCellHighlights,
  CellRing,
  cellHighlightRegistry,
  cellRingsVisible,
  collectCellRings,
  syncCellRings,
} from "./cellHighlight";
import { concealedTaskMarkerAt, isTaskCheckLetterAt } from "./markdown/markdownRendering";
import { findCell, getCellSelectionOffsets, readCellDisplayValue } from "./table/cellSelection";

/**
 * VS Code-style occurrence highlighting.
 *
 * - Caret inside a word (no selection): every whole-word, case-sensitive
 *   occurrence of that word is highlighted, like VS Code's textual
 *   `editor.occurrencesHighlight`.
 * - Single-line selection: every other case-insensitive occurrence of the
 *   selected text is highlighted, like VS Code's `editor.selectionHighlight`.
 *
 * The query follows whichever editing surface owns the caret: the source
 * editor or a rendered table cell. Matches are painted in prose with
 * CodeMirror mark decorations and inside rendered table cells with the CSS
 * Custom Highlight API, so cell DOM (and the user's caret in it) is never
 * modified. Both use the theme's `editor.selectionHighlightBackground`, and
 * both get the border `editor.selectionHighlightBorder` asks for: the prose
 * mark carries it, and a cell match gets a box with the same rule over it.
 *
 * A cell highlight follows the text in the same frame. The query is read from
 * the focused cell itself, and cells are repainted in a microtask after the
 * change that moved them, never a frame later.
 */
export const occurrenceHighlightCompartment = new Compartment();

export function createOccurrenceHighlight(enabled: boolean): Extension {
  return enabled ? [occurrenceQueryField, occurrencePlugin] : [];
}

export interface OccurrenceQuery {
  text: string;
  wholeWord: boolean;
  matchCase: boolean;
  /** Document range of the selection that produced the query (not repainted). */
  exclude?: { from: number; to: number };
}

const MAX_QUERY_LENGTH = 200;
const MAX_MATCHES = 2000;
const CELL_HIGHLIGHT_NAME = "mlrt-occurrence";
const occurrenceMark = Decoration.mark({ class: "mlrt-occurrence" });
const cellWordCharacter = /[\p{L}\p{N}_]/u;

/** Query taken from a focused table cell, which CodeMirror cannot observe. */
const setCellOccurrenceQuery = StateEffect.define<OccurrenceQuery | null>();
const occurrenceQueryField = StateField.define<OccurrenceQuery | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCellOccurrenceQuery)) return effect.value;
    }
    // Any source-editor selection change hands the query back to CodeMirror.
    return transaction.selection ? null : value;
  },
});

/** Pure: the query for a CodeMirror selection, or null for none. */
export function occurrenceQueryForState(state: EditorState): OccurrenceQuery | null {
  const range = state.selection.main;
  if (state.selection.ranges.length !== 1) {
    return null;
  }
  if (range.empty) {
    const word = state.wordAt(range.head);
    if (!word || word.empty) return null;
    // The x of a rendered task marker is syntax, not a word the reader is
    // looking at. With rendering off the marker is ordinary source text.
    if (word.to - word.from === 1 && isTaskCheckLetterAt(state, word.from)) return null;
    return { text: state.sliceDoc(word.from, word.to), wholeWord: true, matchCase: true };
  }
  return selectionQuery(state.sliceDoc(range.from, range.to), { from: range.from, to: range.to });
}

/**
 * Whether a match lies wholly inside the hidden marker of a rendered task.
 * Such a match has no width; its border would still paint, as a stray line
 * beside the checkbox.
 */
function hiddenInTaskMarker(state: EditorState, from: number, to: number): boolean {
  const marker = concealedTaskMarkerAt(state, from);
  return marker !== null && to <= marker.to;
}

/** Pure: the query for a caret/selection inside a table cell's text. */
export function occurrenceQueryForCellText(
  value: string,
  anchor: number,
  head: number,
): OccurrenceQuery | null {
  if (anchor !== head) {
    return selectionQuery(value.slice(Math.min(anchor, head), Math.max(anchor, head)));
  }
  let from = head, to = head;
  while (from > 0 && cellWordCharacter.test(value[from - 1])) from--;
  while (to < value.length && cellWordCharacter.test(value[to])) to++;
  return from === to ? null : { text: value.slice(from, to), wholeWord: true, matchCase: true };
}

function selectionQuery(text: string, exclude?: { from: number; to: number }): OccurrenceQuery | null {
  if (text.length === 0 || text.length > MAX_QUERY_LENGTH || /[\r\n]/.test(text) || text.trim().length === 0) {
    return null;
  }
  return { text, wholeWord: false, matchCase: false, exclude };
}

/**
 * Pure: start offsets of every occurrence of `query` in `text`. `isWordChar`
 * decides whole-word boundaries; `offset` is added to each result.
 */
export function findOccurrences(
  text: string,
  query: OccurrenceQuery,
  isWordChar: (character: string, position: number) => boolean,
  offset = 0,
  limit = MAX_MATCHES,
): number[] {
  const haystack = query.matchCase ? text : text.toLowerCase();
  const needle = query.matchCase ? query.text : query.text.toLowerCase();
  // Case folding can change string length for a few characters; fall back to
  // an exact search rather than reporting misaligned ranges.
  const exact = haystack.length !== text.length || needle.length !== query.text.length;
  const source = exact ? text : haystack;
  const target = exact ? query.text : needle;
  const results: number[] = [];
  for (let index = source.indexOf(target); index !== -1 && results.length < limit; index = source.indexOf(target, index + 1)) {
    if (query.wholeWord) {
      const before = index > 0 ? text[index - 1] : "";
      const after = text[index + target.length] ?? "";
      if ((before && isWordChar(before, offset + index - 1)) || (after && isWordChar(after, offset + index + target.length))) {
        continue;
      }
    }
    results.push(offset + index);
  }
  return results;
}

const occurrencePlugin = ViewPlugin.fromClass(
  class {
    public decorations: DecorationSet = Decoration.none;
    private query: OccurrenceQuery | null = null;
    private paintPending = false;
    private destroyed = false;
    private readonly mutationObserver: MutationObserver | null;
    private readonly onSelectionChange = (): void => this.syncCellQuery();

    public constructor(private readonly view: EditorView) {
      this.query = this.currentQuery(view.state);
      this.decorations = this.build(view);
      const MutationObserverCtor = view.dom.ownerDocument.defaultView?.MutationObserver;
      // Table cells re-render outside CodeMirror transactions (presentation,
      // focus changes), and a keystroke replaces the text the ranges were
      // attached to. The callback is a microtask: it runs after the change and
      // before the browser paints, so no frame shows a cell without its
      // highlight.
      this.mutationObserver = MutationObserverCtor
        ? new MutationObserverCtor((records) => {
          if (this.destroyed || !records.some(affectsCellHighlights)) return;
          this.syncCellQuery();
          this.paintCellHighlights();
        })
        : null;
      this.mutationObserver?.observe(view.contentDOM, {
        childList: true,
        characterData: true,
        subtree: true,
        // A column width moves the text a border ring was measured around.
        attributes: true,
        attributeFilter: ["style"],
      });
      view.dom.ownerDocument.addEventListener("selectionchange", this.onSelectionChange);
      this.requestCellPaint();
    }

    public update(update: ViewUpdate): void {
      const query = this.currentQuery(update.state);
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        !sameQuery(query, this.query)
      ) {
        this.query = query;
        this.decorations = this.build(update.view);
        this.requestCellPaint();
      }
    }

    public destroy(): void {
      this.destroyed = true;
      this.mutationObserver?.disconnect();
      this.view.dom.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange);
      cellHighlightRegistry(this.view)?.delete(CELL_HIGHLIGHT_NAME);
      syncCellRings(this.view, new Map(), RING_LAYER_CLASS, RING_CLASS);
    }

    /** The focused cell of this editor, which owns the caret while it has focus. */
    private focusedCell(): HTMLElement | null {
      const cell = findCell(this.view.dom.ownerDocument.activeElement);
      return cell && this.view.dom.contains(cell) ? cell : null;
    }

    private currentQuery(state: EditorState): OccurrenceQuery | null {
      const cell = this.focusedCell();
      if (cell) {
        // Read the word from the cell as it is now. A keystroke writes the cell
        // and its caret before the transaction that reaches this plugin, while
        // the selectionchange event that used to carry the new word arrives a
        // frame or two later. Waiting for it left the old word, which no
        // longer matches anything, as the query in between.
        return cellQuery(cell);
      }
      const stored = state.field(occurrenceQueryField, false);
      if (stored !== undefined && stored !== null) return stored;
      if (this.view.compositionStarted) return null;
      return occurrenceQueryForState(state);
    }

    /**
     * Brings the stored cell query in line with the focused cell. A caret that
     * moves inside a cell is not a CodeMirror transaction, so this dispatch is
     * what makes the plugin update. Never called during an update.
     */
    private syncCellQuery(): void {
      if (this.destroyed) return;
      const stored = this.view.state.field(occurrenceQueryField, false) ?? null;
      const cell = this.focusedCell();
      const query = cell ? cellQuery(cell) : null;
      if (!sameQuery(query, stored)) {
        this.view.dispatch({ effects: setCellOccurrenceQuery.of(query) });
      }
    }

    private build(view: EditorView): DecorationSet {
      const query = this.query;
      if (!query) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      const categorize = view.state.charCategorizer(0);
      const isWordChar = (character: string): boolean => categorize(character) === CharCategory.Word;
      let count = 0;
      let lastEnd = -1;
      for (const { from, to } of view.visibleRanges) {
        // Visible ranges are sorted and disjoint; matches are searched within
        // each one so builder input stays strictly ordered.
        const text = view.state.sliceDoc(from, to);
        for (const start of findOccurrences(text, query, (character) => isWordChar(character), from, MAX_MATCHES - count)) {
          const end = start + query.text.length;
          if (start < lastEnd) continue;
          if (query.exclude && start === query.exclude.from && end === query.exclude.to) continue;
          if (hiddenInTaskMarker(view.state, start, end)) continue;
          builder.add(start, end, occurrenceMark);
          lastEnd = end;
          count++;
        }
        if (count >= MAX_MATCHES) break;
      }
      return builder.finish();
    }

    /**
     * Paints after the current task, once CodeMirror has written the widget
     * DOM this update calls for, and still before the browser paints.
     */
    private requestCellPaint(): void {
      if (this.paintPending) return;
      this.paintPending = true;
      queueMicrotask(() => {
        if (this.paintPending && !this.destroyed) this.paintCellHighlights();
      });
    }

    private paintCellHighlights(): void {
      this.paintPending = false;
      const registry = cellHighlightRegistry(this.view);
      const win = this.view.dom.ownerDocument.defaultView as (Window & { Highlight?: new (...ranges: Range[]) => object }) | null;
      const HighlightCtor = win?.Highlight;
      const rings = new Map<HTMLElement, CellRing[]>();
      const query = this.query;
      if (!registry || !HighlightCtor || !query) {
        registry?.delete(CELL_HIGHLIGHT_NAME);
        syncCellRings(this.view, rings, RING_LAYER_CLASS, RING_CLASS);
        return;
      }
      const ranges: Range[] = [];
      const doc = this.view.dom.ownerDocument;
      const isWordChar = (character: string): boolean => cellWordCharacter.test(character);
      const ringed = cellRingsVisible(this.view, "--vscode-editor-selectionHighlightBorder");
      for (const cell of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(".mlrt-table-cell"))) {
        const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && ranges.length < MAX_MATCHES; node = walker.nextNode()) {
          const text = (node as Text).data;
          for (const start of findOccurrences(text, query, isWordChar, 0, MAX_MATCHES - ranges.length)) {
            const range = doc.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + query.text.length);
            ranges.push(range);
            if (ringed) collectCellRings(cell, range, rings);
          }
        }
      }
      if (ranges.length === 0) {
        registry.delete(CELL_HIGHLIGHT_NAME);
      } else {
        registry.set(CELL_HIGHLIGHT_NAME, new HighlightCtor(...ranges));
      }
      syncCellRings(this.view, rings, RING_LAYER_CLASS, RING_CLASS);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The query a cell's own caret or selection asks for; none while composing. */
function cellQuery(cell: HTMLElement): OccurrenceQuery | null {
  if (cell.dataset.composing === "true") return null;
  const selection = getCellSelectionOffsets(cell);
  return selection
    ? occurrenceQueryForCellText(readCellDisplayValue(cell), selection.anchor, selection.head)
    : null;
}

/**
 * The border around an occurrence inside a table cell: one positioned box per
 * match (see cellHighlight.ts), carrying the same rule as the border of a
 * prose occurrence. `editor.selectionHighlightBorder` is the only mark a
 * high-contrast theme draws.
 */
const RING_LAYER_CLASS = "mlrt-table-occurrence-rings";
const RING_CLASS = "mlrt-table-occurrence-ring";

function sameQuery(left: OccurrenceQuery | null, right: OccurrenceQuery | null): boolean {
  return left === right || Boolean(
    left && right &&
    left.text === right.text &&
    left.wholeWord === right.wholeWord &&
    left.matchCase === right.matchCase &&
    left.exclude?.from === right.exclude?.from &&
    left.exclude?.to === right.exclude?.to,
  );
}

