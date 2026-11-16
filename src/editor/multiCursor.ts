import {
  Annotation,
  EditorSelection,
  EditorState,
  Extension,
  Facet,
  Prec,
  StateEffect,
  StateField,
  TransactionSpec,
} from "@codemirror/state";
import { completionStatus } from "@codemirror/autocomplete";
import { Command, EditorView, KeyBinding, keymap, rectangularSelection } from "@codemirror/view";
import {
  addCursorAbove,
  addCursorBelow,
  cursorCharLeft,
  cursorCharRight,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineDown,
  cursorLineUp,
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
  deleteGroupForward,
  insertNewline,
  selectCharLeft,
  selectCharRight,
  selectGroupLeft,
  selectGroupRight,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineDown,
  selectLineUp,
} from "@codemirror/commands";
import { compileFindQuery, createFindScan, FindOptions, UsableFindQuery } from "../shared/findModel";
import { getParsedTables } from "../shared/tableModel";
import { findStateField } from "./find/findState";

/**
 * Multiple cursors, as in the stock editor.
 *
 * Cursors live in prose. A rendered table cell is its own editing surface and
 * holds none of the editor's cursors: the table source guard removes a caret
 * that lands in table source, and the occurrence commands leave out matches
 * inside cells and say how many there were.
 *
 * With one cursor nothing here acts: the arrow keys, Backspace and Enter stay
 * with the browser and with the editor's own list and table handling. With
 * several, those keys are bound to commands that move or edit every cursor,
 * because the browser knows only one caret. Typing at several cursors is one
 * transaction, so it reaches the document as one edit and one Undo step.
 */
export interface MultiCursorConfig {
  /** The mouse modifier that adds a cursor: Alt, unless the host's setting gives it to Ctrl or Cmd. */
  clickModifier?: () => "alt" | "ctrlCmd";
  mac?: boolean;
  announce?: (message: string) => void;
}

const multiCursorConfig = Facet.define<MultiCursorConfig, MultiCursorConfig>({
  combine: values => values[0] ?? {},
});

/** The stock editor's limit on the number of cursors. */
export const MULTI_CURSOR_LIMIT = 10000;

/**
 * How the occurrence commands match while they extend one selection. A search
 * that began from a caret matches the whole word with its case; one that began
 * from selected text follows the find options instead, so no session is kept.
 */
export interface OccurrenceSession {
  wholeWord: boolean;
  matchCase: boolean;
}

const setOccurrenceSession = StateEffect.define<OccurrenceSession | null>();
/** A selection the occurrence commands made, which keeps their session alive. */
const occurrenceSelection = Annotation.define<boolean>();

export const occurrenceSessionField = StateField.define<OccurrenceSession | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setOccurrenceSession)) return effect.value;
    }
    const moved = transaction.selection !== undefined && !transaction.annotation(occurrenceSelection);
    return moved || transaction.docChanged ? null : value;
  },
});

export interface OccurrencePlan {
  /** The selection to make, or null when there is nothing to add. */
  spec: TransactionSpec | null;
  /** Occurrences in prose that are selected after the plan. */
  selected: number;
  /** Occurrences inside table cells, which take no cursor. */
  inCells: number;
  /** More occurrences exist than the cursor limit allows. */
  capped: boolean;
}

function matchOptions(state: EditorState): OccurrenceSession {
  const session = state.field(occurrenceSessionField, false);
  if (session) return session;
  const find = state.field(findStateField, false);
  return { wholeWord: find?.options.wholeWord ?? false, matchCase: find?.options.matchCase ?? false };
}

function literalQuery(text: string, options: Pick<FindOptions, "matchCase" | "wholeWord">): UsableFindQuery | null {
  const compiled = compileFindQuery(text, { ...options, regex: false });
  return compiled.ok ? compiled : null;
}

function occurrences(state: EditorState, query: UsableFindQuery): { prose: { from: number; to: number }[]; inCells: number; capped: boolean } {
  const scan = createFindScan(state.doc, getParsedTables(state.doc), query, MULTI_CURSOR_LIMIT);
  scan.run();
  const prose: { from: number; to: number }[] = [];
  let inCells = 0;
  for (const match of scan.matches) {
    if (match.kind === "cell") inCells++;
    else if (match.to > match.from) prose.push({ from: match.from, to: match.to });
  }
  return { prose, inCells, capped: scan.truncated };
}

/**
 * Add Selection To Next Find Match. With a caret, the first use selects the
 * word under it; after that each use adds the next occurrence of the selected
 * text after the newest selection, wrapping at the end of the document.
 */
export function planAddNextOccurrence(state: EditorState): OccurrencePlan {
  const { ranges, main, mainIndex } = state.selection;
  const nothing: OccurrencePlan = { spec: null, selected: ranges.length, inCells: 0, capped: false };
  if (ranges.some(range => range.empty)) {
    const words = ranges.map(range => (range.empty ? state.wordAt(range.head) ?? range : range));
    if (words.every((range, index) => range === ranges[index])) return nothing;
    return {
      ...nothing,
      spec: {
        selection: EditorSelection.create(words, mainIndex),
        effects: setOccurrenceSession.of({ wholeWord: true, matchCase: true }),
        annotations: occurrenceSelection.of(true),
        scrollIntoView: true,
      },
    };
  }
  const query = literalQuery(state.sliceDoc(main.from, main.to), matchOptions(state));
  if (!query || ranges.length >= MULTI_CURSOR_LIMIT) return nothing;
  const found = occurrences(state, query);
  const free = (match: { from: number; to: number }): boolean =>
    !ranges.some(range => range.from < match.to && range.to > match.from);
  const start = found.prose.findIndex(match => match.from >= main.to);
  const ordered = start === -1 ? found.prose : [...found.prose.slice(start), ...found.prose.slice(0, start)];
  const next = ordered.find(free);
  if (!next) return { ...nothing, inCells: found.inCells };
  return {
    spec: {
      // The new selection becomes the main one, so the view follows it.
      selection: EditorSelection.create([...ranges, EditorSelection.range(next.from, next.to)], ranges.length),
      annotations: occurrenceSelection.of(true),
      scrollIntoView: true,
    },
    selected: ranges.length + 1,
    inCells: found.inCells,
    capped: false,
  };
}

/**
 * Select All Occurrences of Find Match and Change All Occurrences: every
 * occurrence in prose of the find query when the widget is open and
 * `useFindQuery` is set, otherwise of the selected text or the word at the caret.
 */
export function planSelectAllOccurrences(state: EditorState, useFindQuery: boolean): OccurrencePlan {
  const main = state.selection.main;
  const find = state.field(findStateField, false);
  const nothing: OccurrencePlan = { spec: null, selected: 0, inCells: 0, capped: false };
  let query: UsableFindQuery | null = null;
  let session: OccurrenceSession | null = state.field(occurrenceSessionField, false) ?? null;
  if (useFindQuery && find?.open && find.compiled.ok) {
    query = find.compiled;
  } else if (main.empty) {
    const word = state.wordAt(main.head);
    if (!word) return nothing;
    session = { wholeWord: true, matchCase: true };
    query = literalQuery(state.sliceDoc(word.from, word.to), session);
  } else {
    query = literalQuery(state.sliceDoc(main.from, main.to), matchOptions(state));
  }
  if (!query) return nothing;
  const found = occurrences(state, query);
  if (found.prose.length === 0) return { ...nothing, inCells: found.inCells };
  const containing = found.prose.findIndex(match => match.from <= main.head && main.head <= match.to);
  const following = found.prose.findIndex(match => match.from >= main.head);
  return {
    spec: {
      selection: EditorSelection.create(
        found.prose.map(match => EditorSelection.range(match.from, match.to)),
        containing >= 0 ? containing : Math.max(0, following),
      ),
      effects: setOccurrenceSession.of(session),
      annotations: occurrenceSelection.of(true),
      scrollIntoView: true,
    },
    selected: found.prose.length,
    inCells: found.inCells,
    capped: found.capped,
  };
}

/** Pure: what to tell the user after an occurrence command, or null for nothing. */
export function occurrenceMessage(plan: OccurrencePlan, all: boolean): string | null {
  const cells = plan.inCells === 0
    ? ""
    : ` ${plan.inCells} more ${plan.inCells === 1 ? "is" : "are"} in table cells, which take no cursor; Replace All changes those too.`;
  if (!plan.spec) {
    return plan.inCells > 0 ? `No occurrence in the text to select.${cells}` : null;
  }
  if (!all) return cells ? cells.trim() : null;
  const limit = plan.capped ? ` The first ${MULTI_CURSOR_LIMIT} are selected.` : "";
  return `Selected ${plan.selected} ${plan.selected === 1 ? "occurrence" : "occurrences"}.${limit}${cells}`;
}

function run(view: EditorView, plan: OccurrencePlan, all: boolean): boolean {
  if (plan.spec) view.dispatch(plan.spec);
  const message = occurrenceMessage(plan, all);
  if (message) view.state.facet(multiCursorConfig).announce?.(message);
  return true;
}

export const addNextOccurrence: Command = view => run(view, planAddNextOccurrence(view.state), false);

/** Select All Occurrences of Find Match: the find query while the widget is open. */
export const selectAllFindMatches: Command = view => {
  const done = run(view, planSelectAllOccurrences(view.state, true), true);
  if (!view.hasFocus) view.focus();
  return done;
};

/** Change All Occurrences: the word at the caret or the selected text. */
export const changeAllOccurrences: Command = view => run(view, planSelectAllOccurrences(view.state, false), true);

/** Back to one cursor: the main selection, as it is. */
export const collapseToMainSelection: Command = view => {
  const selection = view.state.selection;
  if (selection.ranges.length < 2 || completionStatus(view.state) === "active") return false;
  view.dispatch({ selection: EditorSelection.create([selection.main]), scrollIntoView: true });
  return true;
};

/**
 * A completion list that is open uses the arrows, Enter and Escape itself. One
 * that is only being looked up shows nothing yet and must not hold the keys back.
 */
const whenSeveral = (command: Command): Command => view =>
  view.state.selection.ranges.length > 1 && completionStatus(view.state) !== "active" && command(view);

/**
 * Keys that act only while several cursors exist. They take precedence over
 * the editor's table boundary and list keys, which read one selection.
 */
const severalCursorKeys: KeyBinding[] = [
  { key: "ArrowLeft", run: whenSeveral(cursorCharLeft), shift: whenSeveral(selectCharLeft) },
  { key: "ArrowRight", run: whenSeveral(cursorCharRight), shift: whenSeveral(selectCharRight) },
  { key: "ArrowUp", run: whenSeveral(cursorLineUp), shift: whenSeveral(selectLineUp) },
  { key: "ArrowDown", run: whenSeveral(cursorLineDown), shift: whenSeveral(selectLineDown) },
  { key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: whenSeveral(cursorGroupLeft), shift: whenSeveral(selectGroupLeft) },
  { key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: whenSeveral(cursorGroupRight), shift: whenSeveral(selectGroupRight) },
  { key: "Home", run: whenSeveral(cursorLineBoundaryBackward), shift: whenSeveral(selectLineBoundaryBackward) },
  { key: "End", run: whenSeveral(cursorLineBoundaryForward), shift: whenSeveral(selectLineBoundaryForward) },
  { key: "Backspace", run: whenSeveral(deleteCharBackward), shift: whenSeveral(deleteCharBackward) },
  { key: "Delete", run: whenSeveral(deleteCharForward) },
  { key: "Mod-Backspace", mac: "Alt-Backspace", run: whenSeveral(deleteGroupBackward) },
  { key: "Mod-Delete", mac: "Alt-Delete", run: whenSeveral(deleteGroupForward) },
  { key: "Enter", run: whenSeveral(insertNewline) },
  { key: "Escape", run: collapseToMainSelection },
];

const cursorCommandKeys: KeyBinding[] = [
  { key: "Mod-Alt-ArrowUp", linux: "Shift-Alt-ArrowUp", run: addCursorAbove, preventDefault: true },
  { key: "Mod-Alt-ArrowDown", linux: "Shift-Alt-ArrowDown", run: addCursorBelow, preventDefault: true },
  { key: "Mod-d", run: addNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-l", run: selectAllFindMatches, preventDefault: true },
  { key: "Mod-F2", run: changeAllOccurrences, preventDefault: true },
];

export function createMultiCursorExtension(config: MultiCursorConfig = {}): Extension {
  const addsCursor = (event: MouseEvent): boolean => {
    const modifier = config.clickModifier?.() ?? "alt";
    if (modifier === "alt") return event.altKey && !event.shiftKey;
    return config.mac ? event.metaKey : event.ctrlKey;
  };
  return [
    multiCursorConfig.of(config),
    EditorState.allowMultipleSelections.of(true),
    occurrenceSessionField,
    // Without this, the editor's default would add a cursor on the click that
    // opens a link.
    EditorView.clickAddsSelectionRange.of(addsCursor),
    // Column selection: Shift+Alt+drag, the stock editor's gesture.
    rectangularSelection({ eventFilter: event => event.shiftKey && event.altKey && event.button === 0 }),
    Prec.highest(keymap.of(severalCursorKeys)),
    keymap.of(cursorCommandKeys),
  ];
}
