import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Extension,
  SelectionRange,
  Text,
  Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
  getParsedTables,
  ParsedTable,
  parseMarkdownTableRow,
  positionAfterTable,
  positionBeforeTable,
} from "./tableModel";

export const allowTableSourceChange = Annotation.define<boolean>();

/**
 * What a table edit claims to change, verified against the transaction's
 * start state before the change is allowed into the document.
 *
 * - `cell`: exactly one change replacing exactly the declared cell's source
 *   span (or, for a ragged row missing that cell, the row), with single-line
 *   text that keeps the row's cell count.
 * - `tables`: every change lies inside one of the declared tables.
 *
 * Table positions are the start offsets in the *start* state, i.e. the state
 * the edit was computed from. If an edit was computed from anything else, it
 * cannot satisfy its own claim and is dropped instead of corrupting text.
 */
export type TableEditIntent =
  | { kind: "cell"; tableFrom: number; row: number; column: number }
  | {
      kind: "tables";
      tableFroms: readonly number[];
      /** Also allow the text between the declared tables (merging them). */
      spanning?: boolean;
    };

export const tableEditIntent = Annotation.define<TableEditIntent>();

export interface BlockedTableEdit {
  reason: string;
  intent: TableEditIntent;
  timestamp: number;
}

const blockedTableEdits: BlockedTableEdit[] = [];

/** Recent edits refused by the integrity guard (diagnostics and tests). */
export function recentBlockedTableEdits(): readonly BlockedTableEdit[] {
  return blockedTableEdits;
}

/**
 * Returns null when `changes` (relative to `doc`) satisfy `intent`, otherwise
 * a human-readable reason. Pure: depends only on its arguments.
 */
export function validateTableEditIntent(
  doc: Text,
  changes: ChangeSet,
  intent: TableEditIntent,
): string | null {
  const tables = getParsedTables(doc);
  if (intent.kind === "tables") {
    const targets = intent.tableFroms.map((from) => tables.find((table) => table.from === from));
    if (targets.length === 0 || targets.some((table) => !table)) {
      return "a declared table does not exist at its position";
    }
    const spanFrom = Math.min(...targets.map((table) => table!.from));
    const spanTo = Math.max(...targets.map((table) => table!.to));
    let problem: string | null = null;
    changes.iterChangedRanges((from, to) => {
      const inside = intent.spanning
        ? from >= spanFrom && to <= spanTo
        : targets.some((table) => from >= table!.from && to <= table!.to);
      if (!inside) {
        problem ??= `change ${from}-${to} is outside the declared table`;
      }
    });
    return problem;
  }

  const table = tables.find((candidate) => candidate.from === intent.tableFrom);
  if (!table) {
    return "no table starts at the declared position";
  }
  const row = intent.row === 0 ? table.header : table.body[intent.row - 1];
  if (!row || !Number.isInteger(intent.column) || intent.column < 0 || intent.column >= table.columnCount) {
    return "the declared cell does not exist";
  }
  const cell = row.cells[intent.column];
  const span = cell ? { from: cell.start, to: cell.end } : { from: row.from, to: row.to };
  const expectedCells = cell ? row.cells.length : table.columnCount;
  let count = 0;
  let problem: string | null = null;
  const inspect = (from: number, to: number, inserted: string): void => {
    count++;
    if (from !== span.from || to !== span.to) {
      problem ??= `change ${from}-${to} is not the declared cell ${span.from}-${span.to}`;
      return;
    }
    if (/[\r\n]/.test(inserted)) {
      problem ??= "cell text contains a line break";
      return;
    }
    const nextRowText = doc.sliceString(row.from, from) + inserted + doc.sliceString(to, row.to);
    const nextCells = parseMarkdownTableRow(row.lineIndex, row.from, nextRowText).cells.length;
    if (nextCells !== expectedCells) {
      problem ??= `cell text changes the row from ${expectedCells} to ${nextCells} cells`;
    }
  };
  changes.iterChanges((from, to, _fromB, _toB, inserted) => inspect(from, to, inserted.toString()));
  if (count !== 1) {
    return `a cell edit must be exactly one change (got ${count})`;
  }
  return problem;
}

export interface TableSourceSelectionGuardOptions {
  tableCellSelector: string;
}

export function createTableSourceChangeFilter(): Extension {
  return EditorState.changeFilter.of((transaction) => {
    if (!transaction.docChanged) {
      return true;
    }
    const intent = transaction.annotation(tableEditIntent);
    if (intent) {
      const reason = validateTableEditIntent(
        transaction.startState.doc,
        transaction.changes,
        intent,
      );
      if (reason) {
        blockedTableEdits.push({ reason, intent, timestamp: Date.now() });
        if (blockedTableEdits.length > 20) {
          blockedTableEdits.splice(0, blockedTableEdits.length - 20);
        }
        console.warn(`Markdown Live Editor blocked a table edit: ${reason}`);
        return false;
      }
      return true;
    }
    if (
      transaction.annotation(allowTableSourceChange) ||
      isUndoRedo(transaction)
    ) {
      return true;
    }

    const tables = getParsedTables(transaction.startState.doc);
    if (tables.length === 0) {
      return true;
    }

    let changeTouchesTable = false;
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      if (
        tables.some((table) =>
          changeTouchesTableSource(
            transaction.startState,
            from,
            to,
            inserted.toString(),
            table,
          ),
        )
      ) {
        changeTouchesTable = true;
      }
    });

    return !changeTouchesTable;
  });
}

export function createTableSourceSelectionGuard(
  options: TableSourceSelectionGuardOptions,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private scheduled = false;

      public constructor(view: EditorView) {
        this.scheduleIfNeeded(view);
      }

      public update(update: ViewUpdate): void {
        if (update.selectionSet || update.docChanged || update.focusChanged) {
          this.scheduleIfNeeded(
            update.view,
            update.startState.selection.main.head,
          );
        }
      }

      private scheduleIfNeeded(
        view: EditorView,
        previousHead: number | undefined = undefined,
      ): void {
        if (
          this.scheduled ||
          isTableCellFocused(view, options.tableCellSelector) ||
          isApplyingHostDocument(view)
        ) {
          return;
        }

        if (tableSafeSelection(view.state, previousHead) === undefined) {
          return;
        }

        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          if (
            isTableCellFocused(view, options.tableCellSelector) ||
            isApplyingHostDocument(view)
          ) {
            return;
          }

          const safe = tableSafeSelection(view.state, previousHead);
          if (safe === undefined) {
            return;
          }

          view.dispatch({
            selection: safe,
            scrollIntoView: safe.ranges.length === 1,
          });
        });
      }
    },
  );
}

/**
 * The selection to move to when a caret sits in hidden table source, or
 * undefined when the selection may stay. A single caret is moved beside its
 * table. Among several cursors, a caret in table source is removed and the
 * others stay where they are: a table cell is its own editing surface and
 * holds none of the editor's cursors.
 */
export function tableSafeSelection(
  state: EditorState,
  previousHead?: number,
): EditorSelection | undefined {
  const selection = state.selection;
  if (selection.ranges.length > 1) {
    const tables = getParsedTables(state.doc);
    // The end of a document that ends in a table is the end of the table's
    // last row. A lone caret may rest there, because typing starts a new line
    // for it; among several cursors the refusal of that one insertion would
    // take the typing at every cursor with it.
    const kept = selection.ranges.filter(
      (range) =>
        !range.empty ||
        !tables.some(
          (table) =>
            isPositionInTableSource(state, range.head, table) ||
            (range.head === table.to && table.to === state.doc.length),
        ),
    );
    if (kept.length === selection.ranges.length) {
      return undefined;
    }
    if (kept.length > 0) {
      const main = kept.indexOf(selection.main);
      return EditorSelection.create(
        kept,
        main >= 0 ? main : Math.min(selection.mainIndex, kept.length - 1),
      );
    }
    // Every cursor was in a table: the main one is moved out, as a single caret is.
  }
  const target = findSafeSelectionAnchor(state, previousHead);
  return target === undefined
    ? undefined
    : EditorSelection.create([EditorSelection.cursor(target, 1)]);
}

function isUndoRedo(transaction: Transaction): boolean {
  return transaction.isUserEvent("undo") || transaction.isUserEvent("redo");
}

function findSafeSelectionAnchor(
  state: EditorState,
  previousHead: number | undefined,
): number | undefined {
  const tables = getParsedTables(state.doc);
  const range = state.selection.main;
  // Non-empty selections are allowed to cross hidden table source. Clipboard
  // handling serializes those ranges explicitly, and document edits still go
  // through the change filter below. Only collapsed cursors must be bounced
  // out of replacement widgets.
  if (!range.empty) {
    return undefined;
  }
  const table = tables.find((candidate) =>
    rangeTouchesTableSource(state, range, candidate),
  );
  if (!table) {
    return undefined;
  }

  return resolveOutsideTableSource(state, table, range.head, previousHead);
}

function rangeTouchesTableSource(
  state: EditorState,
  range: SelectionRange,
  table: ParsedTable,
): boolean {
  if (range.empty) {
    return isPositionInTableSource(state, range.head, table);
  }

  return (
    range.from < getTableReplacementTo(state, table) && range.to > table.from
  );
}

function changeTouchesTableSource(
  state: EditorState,
  from: number,
  to: number,
  inserted: string,
  table: ParsedTable,
): boolean {
  if (from === to) {
    // At EOF, the position immediately after the table is also the end of its
    // final source row. Plain text inserted there silently becomes another
    // cell value. Starting the insertion with a newline is the safe way to
    // create prose after an EOF table, so retain that normal editing path.
    if (from === table.to && table.to === state.doc.length) {
      return !inserted.startsWith("\n");
    }
    return isPositionInTableSource(state, from, table);
  }

  return (
    from < getTableReplacementTo(state, table) &&
    to > getTableReplacementFrom(state, table)
  );
}

/**
 * The newline immediately before a table is structural even though it sits
 * just outside the parsed table span. Removing it joins the preceding prose
 * to the header row and changes the table's cells/column count.
 */
function getTableReplacementFrom(
  state: EditorState,
  table: ParsedTable,
): number {
  return table.from > 0 &&
    state.doc.sliceString(table.from - 1, table.from) === "\n"
    ? table.from - 1
    : table.from;
}

function isPositionInTableSource(
  state: EditorState,
  position: number,
  table: ParsedTable,
): boolean {
  return (
    position >= table.from && position < getTableReplacementTo(state, table)
  );
}

function resolveOutsideTableSource(
  state: EditorState,
  table: ParsedTable,
  position: number,
  previousHead: number | undefined,
): number {
  const before = positionBeforeTable(table);
  const after = positionAfterTable(state.doc, table);
  const hasBefore = before < table.from;
  const hasAfter = after >= table.to && after <= state.doc.length;

  if (position >= table.to && hasAfter) {
    return after;
  }
  if (previousHead !== undefined && previousHead < table.from && hasAfter) {
    return after;
  }
  if (previousHead !== undefined && previousHead >= after && hasBefore) {
    return before;
  }

  const midpoint = table.from + (table.to - table.from) / 2;
  if (position <= midpoint && hasBefore) {
    return before;
  }
  if (hasAfter) {
    return after;
  }
  if (hasBefore) {
    return before;
  }

  return Math.min(state.doc.length, Math.max(0, table.to));
}

function getTableReplacementTo(state: EditorState, table: ParsedTable): number {
  return positionAfterTable(state.doc, table);
}

function isTableCellFocused(
  view: EditorView,
  tableCellSelector: string,
): boolean {
  const activeElement = view.dom.ownerDocument.activeElement;
  return (
    activeElement instanceof HTMLElement &&
    (Boolean(activeElement.closest(`${tableCellSelector}, .mlrt-table-widget`)) ||
      Boolean(activeElement.closest(".mlrt-clipboard-menu") && view.dom.querySelector(".mlrt-table-selection-mode")))
  );
}

/**
 * A host document apply blurs and refocuses table cells across a couple of
 * animation frames. Guarding mid-apply would fight the pending focus restore
 * and visibly bounce the cursor, so corrections wait until the next update.
 */
function isApplyingHostDocument(view: EditorView): boolean {
  return (
    view.dom.ownerDocument.documentElement.dataset.mlrtApplyingHostDocument ===
    "true"
  );
}
