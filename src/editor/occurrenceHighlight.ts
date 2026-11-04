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
 * modified. Both use the theme's `editor.selectionHighlightBackground`.
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
    return { text: state.sliceDoc(word.from, word.to), wholeWord: true, matchCase: true };
  }
  return selectionQuery(state.sliceDoc(range.from, range.to), { from: range.from, to: range.to });
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
    private cellFrame = 0;
    private readonly mutationObserver: MutationObserver | null;
    private readonly onSelectionChange = (): void => this.readCellQuery();

    public constructor(private readonly view: EditorView) {
      this.query = this.currentQuery(view.state);
      this.decorations = this.build(view);
      const MutationObserverCtor = view.dom.ownerDocument.defaultView?.MutationObserver;
      // Table cells re-render outside CodeMirror transactions (presentation,
      // focus changes). Keep their highlight ranges attached to live text.
      this.mutationObserver = MutationObserverCtor
        ? new MutationObserverCtor((records) => {
          if (records.some((record) => record.target instanceof Node && findCellOrWidget(record.target))) {
            this.scheduleCellHighlights();
          }
        })
        : null;
      this.mutationObserver?.observe(view.contentDOM, { childList: true, characterData: true, subtree: true });
      view.dom.ownerDocument.addEventListener("selectionchange", this.onSelectionChange);
      this.scheduleCellHighlights();
    }

    public update(update: ViewUpdate): void {
      const query = this.currentQuery(update.state);
      if (
        update.docChanged ||
        update.viewportChanged ||
        !sameQuery(query, this.query)
      ) {
        this.query = query;
        this.decorations = this.build(update.view);
        this.scheduleCellHighlights();
      }
    }

    public destroy(): void {
      this.mutationObserver?.disconnect();
      this.view.dom.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange);
      const win = this.view.dom.ownerDocument.defaultView;
      if (this.cellFrame) win?.cancelAnimationFrame(this.cellFrame);
      cellHighlightRegistry(this.view)?.delete(CELL_HIGHLIGHT_NAME);
    }

    private currentQuery(state: EditorState): OccurrenceQuery | null {
      const cellQuery = state.field(occurrenceQueryField, false);
      if (cellQuery !== undefined && cellQuery !== null) return cellQuery;
      const active = this.view.dom.ownerDocument.activeElement;
      // A focused cell owns the caret; the parked source selection is not a
      // user intent and must not drive highlighting.
      if (findCell(active)) return null;
      if (this.view.compositionStarted) return null;
      return occurrenceQueryForState(state);
    }

    private readCellQuery(): void {
      const cell = findCell(this.view.dom.ownerDocument.activeElement);
      if (!cell || !this.view.dom.contains(cell)) {
        if (this.view.state.field(occurrenceQueryField, false)) {
          this.view.dispatch({ effects: setCellOccurrenceQuery.of(null) });
        }
        return;
      }
      const selection = getCellSelectionOffsets(cell);
      const query = selection && cell.dataset.composing !== "true"
        ? occurrenceQueryForCellText(readCellDisplayValue(cell), selection.anchor, selection.head)
        : null;
      if (!sameQuery(query, this.view.state.field(occurrenceQueryField, false) ?? null)) {
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
          builder.add(start, end, occurrenceMark);
          lastEnd = end;
          count++;
        }
        if (count >= MAX_MATCHES) break;
      }
      return builder.finish();
    }

    private scheduleCellHighlights(): void {
      const win = this.view.dom.ownerDocument.defaultView;
      if (!win || this.cellFrame) return;
      this.cellFrame = win.requestAnimationFrame(() => {
        this.cellFrame = 0;
        this.paintCellHighlights();
      });
    }

    private paintCellHighlights(): void {
      const registry = cellHighlightRegistry(this.view);
      const HighlightCtor = (this.view.dom.ownerDocument.defaultView as (Window & { Highlight?: new (...ranges: Range[]) => object }) | null)?.Highlight;
      if (!registry || !HighlightCtor) return;
      const query = this.query;
      if (!query) {
        registry.delete(CELL_HIGHLIGHT_NAME);
        return;
      }
      const ranges: Range[] = [];
      const doc = this.view.dom.ownerDocument;
      const isWordChar = (character: string): boolean => cellWordCharacter.test(character);
      for (const cell of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(".mlrt-table-cell"))) {
        const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && ranges.length < MAX_MATCHES; node = walker.nextNode()) {
          const text = (node as Text).data;
          for (const start of findOccurrences(text, query, isWordChar, 0, MAX_MATCHES - ranges.length)) {
            const range = doc.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + query.text.length);
            ranges.push(range);
          }
        }
      }
      if (ranges.length === 0) {
        registry.delete(CELL_HIGHLIGHT_NAME);
      } else {
        registry.set(CELL_HIGHLIGHT_NAME, new HighlightCtor(...ranges));
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

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

function findCellOrWidget(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(".mlrt-table-cell, .mlrt-table-widget") ?? null;
}

function cellHighlightRegistry(view: EditorView): { set(name: string, highlight: object): void; delete(name: string): void } | null {
  const css = (view.dom.ownerDocument.defaultView as (Window & { CSS?: { highlights?: unknown } }) | null)?.CSS;
  const registry = css?.highlights as { set(name: string, highlight: object): void; delete(name: string): void } | undefined;
  return registry ?? null;
}
