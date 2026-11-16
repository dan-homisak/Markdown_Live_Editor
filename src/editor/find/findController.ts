import { EditorSelection, EditorState, RangeSetBuilder, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
  createFindScan,
  escapeFindRegex,
  findInText,
  FindLocation,
  findLocationStart,
  findLowerBound,
  FindOptions,
  FindScan,
  nextFindIndex,
  planReplaceAll,
  planReplaceAt,
  previousFindIndex,
  proseRangesWithin,
  ReplacePlan,
  UsableFindQuery,
} from "../../shared/findModel";
import { keyboardBindingMatches } from "../../shared/keyboardBinding";
import { getParsedTables } from "../../shared/tableModel";
import {
  affectsCellHighlights,
  CellRing,
  cellRingsVisible,
  collectCellRings,
  setCellHighlight,
  syncCellRings,
} from "../cellHighlight";
import { selectAllFindMatches } from "../multiCursor";
import { occurrenceQueryForCellText, occurrenceQueryForState } from "../occurrenceHighlight";
import {
  cellRangeForOffsets,
  findCell,
  getCellSelectionOffsets,
  readCellDisplayValue,
  setCellSelectionOffsets,
  TABLE_CELL_SELECTOR,
} from "../table/cellSelection";
import { readRenderedCellAddress, refuseTableEdit } from "../table/tableSourceWrite";
import { tableNavigationModifierFacet, tableShortcutsFacet } from "../tableNavigation";
import { findOwnTransaction, planReplaceTransactions } from "./findReplace";
import { findConfig, FindQueryChange, findStateField, refreshFind, ResolvedFindConfig, setFindState } from "./findState";
import { FindWidget } from "./findWidget";

/**
 * Find and replace in the live editor: searching, highlighting, moving between
 * matches and replacing them.
 *
 * - The whole document is searched only while the widget is open, when the
 *   query or the document changes: at once for a query, after a pause for a
 *   document edit, and a slice at a time when the document is large. Caret
 *   movement and scrolling never search.
 * - Highlights cover what is on screen only: the visible lines of prose and
 *   the table cells that are mounted, each searched as the text it shows.
 * - The current match in prose is the editor's selection, which also reveals
 *   concealed syntax around it. A table cell is its own editing surface, so a
 *   current match in a cell is painted there and becomes the cell's selection
 *   when the widget gives up focus.
 * - A replacement is an ordinary document edit. Table cells are written as
 *   declared table edits, which the table guard verifies like any other.
 */
const matchMark = Decoration.mark({ class: "mlrt-find-match" });
const currentMark = Decoration.mark({ class: "mlrt-find-match mlrt-find-current" });

/** Search time allowed inside one editor update, and per later slice. */
const UPDATE_BUDGET_MS = 4;
const SLICE_BUDGET_MS = 8;
/** How long a document edit waits before the document is searched again. */
const RESEARCH_DELAY_MS = 150;
/** Keeps a revealed match clear of the widget at the top of the editor. */
const REVEAL_MARGIN_PX = 72;
const VISIBLE_MATCH_LIMIT = 2000;
const RING_LAYER_CLASS = "mlrt-table-find-rings";
const RING_CLASS = "mlrt-table-find-ring";
const CURRENT_RING_CLASS = "mlrt-table-find-ring mlrt-table-find-ring-current";

type CellLocation = Extract<FindLocation, { kind: "cell" }>;

export interface OpenFindOptions {
  /** Show the replace row as well. */
  replace?: boolean;
  /** Search for this text instead of the selection or the word at the caret. */
  query?: string;
  /** Leave keyboard focus where it is. */
  keepFocus?: boolean;
}

export class FindController {
  public decorations: DecorationSet = Decoration.none;
  private readonly config: ResolvedFindConfig | null;
  private readonly widget: FindWidget | null;
  private readonly mac: boolean;
  private scan: FindScan | null = null;
  private scanDoc: Text | null = null;
  private scanQuery: UsableFindQuery | null = null;
  private matches: readonly FindLocation[] = [];
  private matchesDoc: Text | null = null;
  private matchesQuery: UsableFindQuery | null = null;
  private truncated = false;
  private current = -1;
  /** The current match while it is in a table cell. */
  private cellCurrent: CellLocation | null = null;
  /** Where a search starts from while the caret that opened find was in a table cell. */
  private cellOrigin: { cellFrom: number; from: number; to: number } | null = null;
  private timer: number | null = null;
  /** The query whose first match is to become current once its search finishes. */
  private revealFor: UsableFindQuery | null = null;
  private paintPending = false;
  private destroyed = false;
  private readonly mutationObserver: MutationObserver | null;
  private readonly onKeydown = (event: KeyboardEvent): void => this.handleKeydown(event);

  public constructor(private readonly view: EditorView) {
    this.config = view.state.facet(findConfig);
    const win = view.dom.ownerDocument.defaultView;
    this.mac = /Mac|iPhone|iPad/.test(win?.navigator.platform ?? "");
    this.widget = this.config
      ? new FindWidget(this.config.mount, {
          queryChanged: query => this.changeQuery({ query }),
          replacementChanged: replacement => this.view.dispatch({ effects: setFindState.of({ replacement }) }),
          optionToggled: option => this.toggleOption(option),
          next: () => { this.step(true); },
          previous: () => { this.step(false); },
          replace: () => { this.replace(); },
          replaceAll: () => { this.replaceAll(); },
          selectAll: () => { selectAllFindMatches(this.view); },
          toggleReplace: () => this.view.dispatch({
            effects: setFindState.of({ replaceOpen: !this.view.state.field(findStateField).replaceOpen }),
          }),
          close: () => { this.close(); },
        }, this.mac)
      : null;
    view.dom.ownerDocument.addEventListener("keydown", this.onKeydown, true);
    // Table cells re-render outside editor transactions, on focus and while
    // typing. The callback is a microtask, so it runs before the next paint.
    const MutationObserverCtor = win?.MutationObserver;
    this.mutationObserver = MutationObserverCtor
      ? new MutationObserverCtor(records => {
          if (!this.destroyed && this.isSearching() && records.some(affectsCellHighlights)) this.paintCells();
        })
      : null;
    this.mutationObserver?.observe(view.contentDOM, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    this.syncWidget(view.state);
  }

  public update(update: ViewUpdate): void {
    const find = update.state.field(findStateField);
    const before = update.startState.field(findStateField);
    const active = find.open && find.compiled.ok;
    const queryChanged = find.compiled !== before.compiled || find.open !== before.open;
    const refreshed = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshFind)));
    const own = update.transactions.some(transaction => transaction.annotation(findOwnTransaction));
    if (update.docChanged) {
      // A cell keeps its place while the text around its table changes.
      const shift = (position: number): number => update.changes.mapPos(position, -1);
      if (this.cellCurrent) {
        this.cellCurrent = { ...this.cellCurrent, tableFrom: shift(this.cellCurrent.tableFrom), cellFrom: shift(this.cellCurrent.cellFrom) };
      }
      if (this.cellOrigin) this.cellOrigin = { ...this.cellOrigin, cellFrom: shift(this.cellOrigin.cellFrom) };
    }
    if (update.selectionSet && !own) {
      // The caret went somewhere on its own account: the search starts from it.
      this.cellCurrent = null;
      this.cellOrigin = null;
    }
    if (!active) {
      this.cancelTimer();
      this.scan = null;
      if (!find.compiled.ok) this.forget();
    } else if (queryChanged) {
      this.forget();
      this.search(update.state, UPDATE_BUDGET_MS);
    } else if (update.docChanged) {
      this.searchLater();
    }
    const current = this.currentIndex(update.state);
    const changed = queryChanged || refreshed || update.docChanged || current !== this.current;
    if (changed || update.viewportChanged) {
      this.current = current;
      this.decorations = this.build(update.view);
    }
    // Nothing is painted in cells while find is closed, so nothing needs clearing either.
    if ((find.open || before.open) && (changed || update.viewportChanged || update.geometryChanged)) {
      this.requestCellPaint();
    }
    this.syncWidget(update.state);
  }

  public destroy(): void {
    this.destroyed = true;
    this.cancelTimer();
    this.mutationObserver?.disconnect();
    this.view.dom.ownerDocument.removeEventListener("keydown", this.onKeydown, true);
    this.clearCellPaint();
    this.widget?.destroy();
  }

  // --- Commands ----------------------------------------------------------------

  public open(options: OpenFindOptions = {}): void {
    const find = this.view.state.field(findStateField);
    const cell = this.focusedCell();
    const seed = options.query ?? this.seed(cell);
    const change: FindQueryChange = { open: true };
    if (options.replace) change.replaceOpen = true;
    if (seed !== null) change.query = find.options.regex && options.query === undefined ? escapeFindRegex(seed) : seed;
    const origin = cell ? this.originOf(cell) : null;
    this.view.dispatch({ effects: setFindState.of(change) });
    if (origin) this.cellOrigin = origin;
    if (options.keepFocus || !this.widget) return;
    if (options.replace && this.view.state.field(findStateField).query.length > 0) this.widget.focusReplace();
    else this.widget.focusFind();
  }

  public close(): boolean {
    if (!this.view.state.field(findStateField).open) return false;
    const hadFocus = this.widget?.hasFocus() ?? false;
    const cellMatch = this.cellCurrent;
    this.revealFor = null;
    this.view.dispatch({ effects: setFindState.of({ open: false }), annotations: findOwnTransaction.of(true) });
    if (hadFocus) this.focusDocument(cellMatch);
    return true;
  }

  /** Moves to the next or the previous match; false when there is none. */
  public step(forward: boolean): boolean {
    const focused = this.focusedCell();
    if (this.inputUnsettled(focused)) return false;
    if (focused) this.cellOrigin = this.originOf(focused);
    if (this.view.state.field(findStateField).query.length === 0) {
      const seed = this.seed(focused);
      if (seed === null) return false;
      const regex = this.view.state.field(findStateField).options.regex;
      this.view.dispatch({
        effects: setFindState.of({ query: regex ? escapeFindRegex(seed) : seed }),
        annotations: findOwnTransaction.of(true),
      });
    }
    if (!this.searchNow()) return false;
    const count = this.matches.length;
    if (count === 0) {
      this.config?.announce?.("No results");
      return false;
    }
    const main = this.view.state.selection.main;
    const origin = this.cellOrigin;
    // While a table cell holds the caret, the search goes on from that caret,
    // not from a match the editor's own selection may still be resting on.
    const index = this.current >= 0 && !focused
      ? (this.current + (forward ? 1 : count - 1)) % count
      : forward
        ? nextFindIndex(this.matches, origin ? [origin.cellFrom, origin.to] : [main.to, 0])
        : previousFindIndex(this.matches, origin ? [origin.cellFrom, origin.from] : [main.from, 0]);
    this.reveal(index);
    return true;
  }

  /** Replaces the current match and moves on; with no current match, moves to the next one. */
  public replace(): boolean {
    if (!this.mayReplace() || !this.searchNow()) return false;
    const match = this.matches[this.current];
    if (!match) return this.step(true);
    const state = this.view.state;
    const find = state.field(findStateField);
    if (!find.compiled.ok) return false;
    const plan = planReplaceAt(state.doc, getParsedTables(state.doc), find.compiled, find.replacement, match);
    if (!plan || plan.count === 0) return this.step(true);
    if (!this.apply(plan)) return false;
    // Carry on from the end of what was written, in the document as it is now.
    const written = plan.inserted?.length ?? 0;
    const after: [number, number] = match.kind === "prose"
      ? [match.from + written, 0]
      : [this.cellCurrent?.cellFrom ?? match.cellFrom, match.from + written];
    if (!this.searchNow()) return true;
    if (this.matches.length > 0) this.reveal(nextFindIndex(this.matches, after));
    else this.config?.announce?.("No results");
    return true;
  }

  /** Replaces every match as one edit and one Undo step. */
  public replaceAll(): boolean {
    if (!this.mayReplace()) return false;
    const state = this.view.state;
    const find = state.field(findStateField);
    if (!find.compiled.ok) return false;
    const plan = planReplaceAll(state.doc, getParsedTables(state.doc), find.compiled, find.replacement);
    if (plan.count === 0) {
      this.config?.announce?.("Nothing to replace");
      return false;
    }
    if (!this.apply(plan)) return false;
    this.config?.announce?.(`Replaced ${plan.count} ${plan.count === 1 ? "occurrence" : "occurrences"}`);
    this.searchNow();
    return true;
  }

  // --- Replacing -----------------------------------------------------------------

  private mayReplace(): boolean {
    if (this.config?.isReadOnly?.() ?? this.view.state.readOnly) {
      this.config?.announce?.("This document is read-only");
      return false;
    }
    // A replacement computed while text is being composed would be built on
    // text the input method has not finished.
    if (this.inputUnsettled(this.focusedCell())) {
      this.config?.announce?.("Finish typing before replacing");
      return false;
    }
    return true;
  }

  /**
   * Writes a plan as one editor update: one change message to the host and one
   * Undo step. Nothing is written unless every part of the plan is accepted.
   */
  private apply(plan: ReplacePlan): boolean {
    const planned = planReplaceTransactions(this.view.state, plan);
    if (!planned.ok) {
      if (planned.table) refuseTableEdit(this.view, planned.reason);
      else this.config?.announce?.(planned.reason);
      return false;
    }
    this.view.dispatch(planned.transactions);
    return this.view.state === planned.transactions[planned.transactions.length - 1].state;
  }

  // --- Searching ---------------------------------------------------------------

  private isSearching(): boolean {
    const find = this.view.state.field(findStateField);
    return find.open && find.compiled.ok;
  }

  private isCurrent(state: EditorState): boolean {
    const compiled = state.field(findStateField).compiled;
    return compiled.ok && this.matchesDoc === state.doc && this.matchesQuery === compiled;
  }

  private forget(): void {
    this.matches = [];
    this.matchesDoc = null;
    this.matchesQuery = null;
    this.truncated = false;
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.view.dom.ownerDocument.defaultView?.clearTimeout(this.timer);
    this.timer = null;
  }

  private later(run: () => void, delay: number): void {
    this.cancelTimer();
    const win = this.view.dom.ownerDocument.defaultView;
    if (!win) return;
    this.timer = win.setTimeout(() => {
      this.timer = null;
      if (!this.destroyed) run();
    }, delay);
  }

  /** Starts a search of `state`'s document and runs it for `budget` ms; true when it finished. */
  private search(state: EditorState, budget: number): boolean {
    this.cancelTimer();
    const compiled = state.field(findStateField).compiled;
    if (!compiled.ok) return false;
    if (!(this.scan && this.scanDoc === state.doc && this.scanQuery === compiled)) {
      this.scan = createFindScan(state.doc, getParsedTables(state.doc), compiled);
      this.scanDoc = state.doc;
      this.scanQuery = compiled;
    }
    return this.advance(budget);
  }

  private advance(budget: number): boolean {
    const scan = this.scan;
    if (!scan) return false;
    const now = (): number => this.view.dom.ownerDocument.defaultView?.performance.now() ?? Date.now();
    const deadline = now() + budget;
    if (!scan.run(() => now() >= deadline)) {
      this.later(() => this.resume(), 0);
      return false;
    }
    this.matches = scan.matches;
    this.matchesDoc = this.scanDoc;
    this.matchesQuery = this.scanQuery;
    this.truncated = scan.truncated;
    this.scan = null;
    return true;
  }

  /** A later slice of a search that did not fit in one. */
  private resume(): void {
    const state = this.view.state;
    const find = state.field(findStateField);
    if (!find.open || this.scanDoc !== state.doc || this.scanQuery !== find.compiled) return;
    if (this.advance(SLICE_BUDGET_MS)) this.found(true);
  }

  private searchLater(): void {
    // The document was edited: whoever edited it has the caret, and a match
    // that turns up later must not take it.
    this.revealFor = null;
    this.later(() => {
      const find = this.view.state.field(findStateField);
      if (find.open && this.search(this.view.state, SLICE_BUDGET_MS)) this.found(false);
    }, RESEARCH_DELAY_MS);
  }

  /** Results arrived outside an editor update: show them. */
  private found(queryScan: boolean): void {
    this.view.dispatch({ effects: refreshFind.of(null), annotations: findOwnTransaction.of(true) });
    // Only the search of a query that was just typed moves the current match,
    // and only while that query is still the one being searched for.
    const wanted = this.revealFor;
    this.revealFor = null;
    if (queryScan && wanted && wanted === this.matchesQuery) this.revealFromOrigin();
  }

  /** Finishes the search of the current document now, for a command that needs its matches. */
  private searchNow(): boolean {
    const state = this.view.state;
    const compiled = state.field(findStateField).compiled;
    if (!compiled.ok) return false;
    // A command that needs the matches now decides for itself where to go.
    this.revealFor = null;
    if (!this.isCurrent(state)) {
      this.search(state, Infinity);
      this.view.dispatch({ effects: refreshFind.of(null), annotations: findOwnTransaction.of(true) });
    }
    return this.isCurrent(this.view.state);
  }

  // --- The current match -----------------------------------------------------------

  private currentIndex(state: EditorState): number {
    if (!this.isCurrent(state)) return -1;
    const wanted = this.cellCurrent;
    if (wanted) {
      const match = this.matches[findLowerBound(this.matches, findLocationStart(wanted))];
      const same = match && match.kind === "cell" && match.cellFrom === wanted.cellFrom &&
        match.from === wanted.from && match.to === wanted.to;
      return same ? this.matches.indexOf(match) : -1;
    }
    if (state.selection.ranges.length !== 1) return -1;
    const main = state.selection.main;
    const index = findLowerBound(this.matches, [main.from, 0]);
    const match = this.matches[index];
    return match && match.kind === "prose" && match.from === main.from && match.to === main.to ? index : -1;
  }

  private reveal(index: number): void {
    const match = this.matches[index];
    if (!match || this.inputUnsettled(this.focusedCell())) return;
    const keepFocus = this.widget?.hasFocus() ?? false;
    if (match.kind === "prose") {
      const range = EditorSelection.range(match.from, match.to);
      this.cellCurrent = null;
      this.cellOrigin = null;
      this.view.dispatch({
        selection: range,
        effects: EditorView.scrollIntoView(range, { y: "nearest", yMargin: REVEAL_MARGIN_PX }),
        annotations: findOwnTransaction.of(true),
        userEvent: "select.search",
      });
      if (!keepFocus && !this.view.hasFocus) this.view.focus();
      return;
    }
    this.cellCurrent = match;
    this.cellOrigin = null;
    const main = this.view.state.selection.main;
    this.view.dispatch({
      // The match that was current in prose is current no longer.
      selection: main.empty ? undefined : EditorSelection.cursor(main.head),
      effects: [refreshFind.of(null), EditorView.scrollIntoView(match.cellFrom, { y: "nearest", yMargin: REVEAL_MARGIN_PX })],
      annotations: findOwnTransaction.of(true),
    });
    this.showCell(match, 8, !keepFocus, this.view.dom.ownerDocument.activeElement);
  }

  /**
   * Brings a cell match into view once its table is mounted, and gives the
   * cell the caret when the widget is not holding the focus.
   */
  private showCell(match: CellLocation, attempts: number, focus: boolean, focusedAtStart: Element | null): void {
    if (this.destroyed || this.cellCurrent !== match) return;
    const cell = this.cellElement(match);
    const win = this.view.dom.ownerDocument.defaultView;
    if (!cell) {
      if (attempts > 0) win?.requestAnimationFrame(() => this.showCell(match, attempts - 1, focus, focusedAtStart));
      return;
    }
    // The table may have taken a few frames to mount. If the focus went
    // somewhere else in that time, it stays where the user put it.
    if (this.view.dom.ownerDocument.activeElement !== focusedAtStart) focus = false;
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    const scroller = this.view.scrollDOM.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    if (box.top < scroller.top + REVEAL_MARGIN_PX) {
      this.view.scrollDOM.scrollTop -= scroller.top + REVEAL_MARGIN_PX - box.top;
    }
    if (focus) this.focusCell(cell, match);
    this.requestCellPaint();
  }

  private cellElement(match: CellLocation): HTMLElement | null {
    const wrappers = Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(".mlrt-table-widget"));
    const wrapper = wrappers.find(candidate => Number(candidate.dataset.srcFrom ?? "-1") === match.tableFrom);
    if (!wrapper) return null;
    const row = match.row === 0
      ? '[data-row-kind="header"]'
      : `[data-row-kind="body"][data-row-index="${match.row - 1}"]`;
    return wrapper.querySelector<HTMLElement>(`${TABLE_CELL_SELECTOR}${row}[data-column="${match.column}"]`);
  }

  private focusCell(cell: HTMLElement, match: CellLocation): void {
    cell.focus({ preventScroll: true });
    setCellSelectionOffsets(cell, match.from, match.to);
  }

  /** Gives the focus back to the document, at the current match when it is in a cell. */
  private focusDocument(cellMatch: CellLocation | null): void {
    const cell = cellMatch && this.cellElement(cellMatch);
    if (cell && cellMatch) this.focusCell(cell, cellMatch);
    else this.view.focus();
  }

  /** As the query is typed, the match at or after the place find was opened from becomes current. */
  private revealFromOrigin(): void {
    const state = this.view.state;
    const find = state.field(findStateField);
    this.revealFor = null;
    if (!find.open || !find.compiled.ok) return;
    if (!this.isCurrent(state)) {
      this.revealFor = find.compiled;
      return;
    }
    if (this.matches.length === 0) return;
    const start: [number, number] = this.cellCurrent
      ? findLocationStart(this.cellCurrent)
      : this.cellOrigin
        ? [this.cellOrigin.cellFrom, this.cellOrigin.from]
        : [state.selection.main.from, 0];
    // Revealing clears the origin; typing on must still start from the same place.
    const origin = this.cellOrigin;
    this.reveal(nextFindIndex(this.matches, start));
    if (origin && !this.cellCurrent) this.cellOrigin = origin;
  }

  private changeQuery(change: FindQueryChange): void {
    this.view.dispatch({ effects: setFindState.of(change), annotations: findOwnTransaction.of(true) });
    this.revealFromOrigin();
  }

  private toggleOption(option: keyof FindOptions): void {
    const options = this.view.state.field(findStateField).options;
    this.changeQuery({ options: { [option]: !options[option] } });
  }

  /**
   * Whether text is still being composed, in the editor or in a table cell,
   * or has not yet reached the document's owner. Find moves no caret and
   * writes nothing until it has.
   */
  private inputUnsettled(cell: HTMLElement | null): boolean {
    return this.view.composing || this.view.compositionStarted || cell?.dataset.composing === "true" ||
      this.config?.isInputSettled?.() === false;
  }

  private focusedCell(): HTMLElement | null {
    const cell = findCell(this.view.dom.ownerDocument.activeElement);
    return cell && this.view.dom.contains(cell) ? cell : null;
  }

  private originOf(cell: HTMLElement): { cellFrom: number; from: number; to: number } | null {
    const cellFrom = Number(cell.dataset.sourceFrom ?? "NaN");
    const selection = getCellSelectionOffsets(cell);
    if (!Number.isFinite(cellFrom) || !selection) return null;
    return { cellFrom, from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
  }

  /** The selected text, or the word at the caret, in whichever surface holds the caret. */
  private seed(cell: HTMLElement | null): string | null {
    if (cell) {
      const selection = getCellSelectionOffsets(cell);
      return selection
        ? occurrenceQueryForCellText(readCellDisplayValue(cell), selection.anchor, selection.head)?.text ?? null
        : null;
    }
    return occurrenceQueryForState(this.view.state)?.text ?? null;
  }

  // --- Presentation ----------------------------------------------------------------

  private build(view: EditorView): DecorationSet {
    const state = view.state;
    const find = state.field(findStateField);
    if (!find.open || !find.compiled.ok) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    const main = state.selection.main;
    let lastEnd = -1;
    let count = 0;
    const add = (from: number, to: number, current: boolean): void => {
      if (to <= from || from < lastEnd || count >= VISIBLE_MATCH_LIMIT) return;
      builder.add(from, to, current ? currentMark : matchMark);
      lastEnd = to;
      count++;
    };
    const lines = visibleLines(view);
    if (this.isCurrent(state)) {
      for (const { from, to } of lines) {
        for (let index = findLowerBound(this.matches, [from, 0]); index < this.matches.length; index++) {
          const match = this.matches[index];
          if (findLocationStart(match)[0] >= to) break;
          if (match.kind === "prose") add(match.from, match.to, index === this.current);
        }
      }
    } else {
      // The document changed and has not been searched again yet.
      const tables = getParsedTables(state.doc);
      for (const { from, to } of lines) {
        for (const prose of proseRangesWithin(state.doc, tables, from, to)) {
          const text = state.sliceDoc(prose.from, prose.to);
          for (const match of findInText(text, find.compiled, { limit: VISIBLE_MATCH_LIMIT })) {
            const start = prose.from + match.from;
            const end = prose.from + match.to;
            add(start, end, !this.cellCurrent && start === main.from && end === main.to);
          }
        }
      }
    }
    return builder.finish();
  }

  /** Paints after the current task, once CodeMirror has written the table DOM this update calls for. */
  private requestCellPaint(): void {
    if (this.paintPending) return;
    this.paintPending = true;
    queueMicrotask(() => {
      if (this.paintPending && !this.destroyed) this.paintCells();
    });
  }

  private clearCellPaint(): void {
    if (!this.config) return;
    setCellHighlight(this.view, this.config.highlightNames.match, []);
    setCellHighlight(this.view, this.config.highlightNames.current, []);
    syncCellRings(this.view, new Map(), RING_LAYER_CLASS, RING_CLASS);
  }

  /**
   * Highlights the matches inside the mounted table cells. Each cell is
   * searched as the text it shows, so a cell being typed in is right in the
   * frame its text changes.
   */
  private paintCells(): void {
    this.paintPending = false;
    const config = this.config;
    const find = this.view.state.field(findStateField);
    if (!config) return;
    if (!find.open || !find.compiled.ok) {
      this.clearCellPaint();
      return;
    }
    const ranges: Range[] = [];
    const currentRanges: Range[] = [];
    const rings = new Map<HTMLElement, CellRing[]>();
    const ringed = cellRingsVisible(this.view, "--vscode-editor-findMatchHighlightBorder") ||
      cellRingsVisible(this.view, "--vscode-editor-findMatchBorder");
    const wanted = this.cellCurrent;
    for (const cell of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(TABLE_CELL_SELECTOR))) {
      if (cell.dataset.composing === "true" || ranges.length + currentRanges.length >= VISIBLE_MATCH_LIMIT) continue;
      const value = readCellDisplayValue(cell);
      if (value.length === 0) continue;
      const matches = findInText(value, find.compiled, { limit: VISIBLE_MATCH_LIMIT });
      if (matches.length === 0) continue;
      const address = wanted ? readRenderedCellAddress(cell) : null;
      const isWanted = !!wanted && !!address && address.row === wanted.row && address.column === wanted.column &&
        Number(cell.dataset.tableFrom ?? "-1") === wanted.tableFrom;
      for (const match of matches) {
        const range = cellRangeForOffsets(cell, match.from, match.to);
        if (!range || range.collapsed) continue;
        const current = isWanted && match.from === wanted.from && match.to === wanted.to;
        (current ? currentRanges : ranges).push(range);
        if (ringed) collectCellRings(cell, range, rings, current ? CURRENT_RING_CLASS : RING_CLASS);
      }
    }
    // Under the occurrence highlight, as in prose, where the occurrence mark is
    // the inner one and so paints last; the current match above the others.
    setCellHighlight(this.view, config.highlightNames.match, ranges, -2);
    setCellHighlight(this.view, config.highlightNames.current, currentRanges, -1);
    syncCellRings(this.view, rings, RING_LAYER_CLASS, RING_CLASS);
  }

  private syncWidget(state: EditorState): void {
    if (!this.widget) return;
    const find = state.field(findStateField);
    const invalid = !find.compiled.ok && find.compiled.reason === "invalid" ? find.compiled.message : null;
    this.widget.update({
      open: find.open,
      replaceOpen: find.replaceOpen,
      query: find.query,
      replacement: find.replacement,
      options: find.options,
      count: !find.compiled.ok ? (find.query.length > 0 ? 0 : null) : this.matchesQuery === find.compiled ? this.matches.length : null,
      truncated: this.truncated,
      current: this.current + 1,
      invalid,
      readOnly: this.config?.isReadOnly?.() ?? state.readOnly,
    });
  }

  // --- Keys --------------------------------------------------------------------

  /** Whether the press is the table navigation key or one of the table shortcuts, as configured. */
  private isTableKey(event: KeyboardEvent): boolean {
    const state = this.view.state;
    const configured = [state.facet(tableNavigationModifierFacet), ...Object.values(state.facet(tableShortcutsFacet))];
    return configured.some(binding => binding.length > 0 && keyboardBindingMatches(binding, event));
  }

  /**
   * Shortcuts that work anywhere in this editor: in prose, in a table cell and
   * in the widget. Listening on the document in the capture phase is what lets
   * a table cell, which CodeMirror does not hear, open find.
   */
  private handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing || !this.config) return;
    const target = event.target;
    if (!(target instanceof Node) || !(this.view.dom.contains(target) || this.widget?.contains(target))) return;
    // Inside a table cell, a key the user gave to the table stays the table's.
    if (target instanceof Element && findCell(target) && this.isTableKey(event)) return;
    const primary = this.mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const key = event.key.toLowerCase();
    let run: (() => void) | null = null;
    if (primary && !event.shiftKey && !event.altKey && key === "f") {
      run = () => this.open();
    } else if (this.mac ? primary && event.altKey && !event.shiftKey && event.code === "KeyF"
      : primary && !event.shiftKey && !event.altKey && key === "h") {
      run = () => this.open({ replace: true });
    } else if (event.key === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      run = () => { this.step(!event.shiftKey); };
    } else if (this.mac && primary && !event.altKey && key === "g") {
      run = () => { this.step(!event.shiftKey); };
    }
    if (!run) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    run();
  }
}

/** The visible ranges widened to whole lines and merged, in document order. */
function visibleLines(view: EditorView): { from: number; to: number }[] {
  const lines: { from: number; to: number }[] = [];
  for (const range of view.visibleRanges) {
    const from = view.state.doc.lineAt(range.from).from;
    const to = view.state.doc.lineAt(range.to).to;
    const last = lines[lines.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else lines.push({ from, to });
  }
  return lines;
}

export const findController = ViewPlugin.fromClass(FindController, {
  decorations: plugin => plugin.decorations,
});
