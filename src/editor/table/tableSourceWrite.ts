import {
  Annotation,
  ChangeSpec,
  SelectionRange,
  StateEffect,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  canonicalTableCellValue,
  formatTableCellSourceEdit,
  getParsedTables,
  ParsedRow,
  ParsedTable,
  rowToDisplayValues,
  sameTableSource,
  TableCellSourceEdit,
} from "../../shared/tableModel";
import {
  allowTableSourceChange,
  tableEditIntent,
} from "../../shared/tableSourceProtection";
import { announceEditorStatus } from "../editorStatus";
import {
  TableCellCommitRestore,
  tableCellLiveEditAnnotation,
} from "../tableEditAnnotations";
import { getCellCaretOffset, readCellDisplayValue } from "./cellSelection";
import { tableResyncEffect } from "./tableTracking";
import { getTableWidgetTable } from "./tableWidgetState";

/** Event dispatched (on the editor DOM) whenever a cell edit writes source. */
export const TABLE_CELL_COMMIT_EVENT = "mlrt:table-cell-commit";

/** Event dispatched when a table edit is refused to protect the document. */
export const TABLE_INTEGRITY_EVENT = "mlrt:table-integrity";

export interface RenderedCellAddress {
  rowKind: "header" | "body";
  rowIndex: number;
  column: number;
  /** Row in grid order: 0 is the header, 1 the first body row. */
  row: number;
}

export type CellWriteResult = "written" | "unchanged" | "refused";

/** Parses a rendered cell's address attributes, or null when malformed. */
export function readRenderedCellAddress(
  cell: HTMLElement,
): RenderedCellAddress | null {
  const rowKind = cell.dataset.rowKind;
  const rowIndex = Number(cell.dataset.rowIndex ?? "NaN");
  const column = Number(cell.dataset.column ?? "NaN");
  if (
    (rowKind !== "header" && rowKind !== "body") ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    (rowKind === "header" && rowIndex !== 0) ||
    !Number.isInteger(column) ||
    column < 0
  ) {
    return null;
  }
  return { rowKind, rowIndex, column, row: rowKind === "header" ? 0 : rowIndex + 1 };
}

export function sourceRowForAddress(
  table: ParsedTable,
  address: RenderedCellAddress,
): ParsedRow | undefined {
  return address.rowKind === "header" ? table.header : table.body[address.rowIndex];
}

/**
 * Writes a rendered cell's current text to the Markdown source.
 *
 * The write is computed from scratch against the editor's current state:
 * 1. the widget's table is resolved by identity and cross-checked against
 *    CodeMirror's own mapping of the widget (`getTableWidgetTable`);
 * 2. the target cell's source must still be the value this cell was showing
 *    (`data-source-value`); if anything else changed it, the DOM is stale and
 *    writing would overwrite text the user never saw;
 * 3. the edit replaces exactly that cell's source span, and the transaction
 *    declares so, letting the change filter verify the claim once more.
 *
 * Any failed check refuses the write and re-renders the table from source.
 */
export function writeCellValue(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
  options: { scrollSnapshot?: StateEffect<unknown> } = {},
): CellWriteResult {
  const address = readRenderedCellAddress(cell);
  if (!address || !wrapper.contains(cell)) {
    return "refused";
  }
  const table = getTableWidgetTable(wrapper);
  if (!table) {
    refuseTableEdit(view, "the table moved or was replaced before the edit was saved");
    return "refused";
  }
  const sourceRow = sourceRowForAddress(table, address);
  if (!sourceRow || address.column >= table.columnCount) {
    refuseTableEdit(view, "the edited cell no longer exists");
    return "refused";
  }
  const currentSourceValue = rowToDisplayValues(sourceRow, table.columnCount)[address.column] ?? "";
  if ((cell.dataset.sourceValue ?? "") !== currentSourceValue) {
    refuseTableEdit(view, "the cell changed in the document while it was being edited");
    return "refused";
  }

  const value = readCellDisplayValue(cell);
  if (canonicalTableCellValue(value) === currentSourceValue) {
    return "unchanged";
  }
  const edit = formatTableCellSourceEdit(
    sourceRow,
    table.columnCount,
    address.column,
    value,
    { trim: "horizontal" },
  );
  if (view.state.doc.sliceString(edit.from, edit.to) === edit.insert) {
    return "unchanged";
  }

  const caretOffset = getCellCaretOffset(cell);
  const restore: TableCellCommitRestore = {
    tableFrom: table.from,
    rowKind: address.rowKind,
    rowIndex: address.rowIndex,
    column: address.column,
    from: edit.from,
    to: edit.to,
    restoreCaretOffset: Math.min(
      currentSourceValue.length,
      caretOffset + Math.max(0, currentSourceValue.length - value.length),
    ),
  };
  view.dom.dispatchEvent(
    new CustomEvent(TABLE_CELL_COMMIT_EVENT, {
      bubbles: true,
      detail: {
        ...restore,
        insertLength: edit.insert.length,
        valueLength: value.length,
      },
    }),
  );

  const before = view.state.doc;
  const changes = view.state.changes({ from: edit.from, to: edit.to, insert: edit.insert });
  view.dispatch({
    changes,
    effects: options.scrollSnapshot?.map(changes),
    annotations: [
      allowTableSourceChange.of(true),
      tableEditIntent.of({ kind: "cell", tableFrom: table.from, row: address.row, column: address.column }),
      tableCellLiveEditAnnotation.of({
        change: { from: edit.from, to: edit.to, text: edit.insert },
        restore,
      }),
    ],
    userEvent: "input",
  });
  if (view.state.doc === before) {
    refuseTableEdit(view, "the edit did not match the cell it was meant for");
    return "refused";
  }
  if (cell.isConnected && (cell.dataset.sourceValue ?? "") !== canonicalTableCellValue(value)) {
    // The widget did not re-render from the written source. Never leave the
    // DOM describing a document state that does not exist.
    refuseTableEdit(view, "the table did not refresh after an edit");
    return "refused";
  }
  return "written";
}

/** Whether `table` is an exact parse of the editor's current document. */
export function isCurrentTable(view: EditorView, table: ParsedTable): boolean {
  return getParsedTables(view.state.doc).some((candidate) => sameTableSource(candidate, table));
}

export interface TableSourceEditOptions {
  /** Tables the edits were computed from; each must be current. */
  tables: readonly ParsedTable[];
  /** Permit edits in the text between the declared tables (merging them). */
  spanning?: boolean;
  edits: readonly TableCellSourceEdit[];
  selection?: SelectionRange | { anchor: number; head?: number };
  effects?: readonly StateEffect<unknown>[];
  annotations?: readonly Annotation<unknown>[];
  userEvent?: string;
  scrollIntoView?: boolean;
}

/**
 * Dispatches structural or multi-cell table edits (row/column insertion and
 * deletion, paste, clear, move) after proving they were computed from the
 * current document and stay inside the declared tables. Identical
 * replacements are skipped so VS Code never sees a no-op edit.
 *
 * Returns true when the document changed.
 */
export function dispatchTableSourceEdit(
  view: EditorView,
  options: TableSourceEditOptions,
): boolean {
  if (options.tables.length === 0 || !options.tables.every((table) => isCurrentTable(view, table))) {
    refuseTableEdit(view, "the table changed before the edit could be applied");
    return false;
  }
  const doc = view.state.doc;
  const edits = options.edits.filter((edit) => doc.sliceString(edit.from, edit.to) !== edit.insert);
  if (edits.length === 0) {
    return false;
  }
  const spanFrom = Math.min(...options.tables.map((table) => table.from));
  const spanTo = Math.max(...options.tables.map((table) => table.to));
  const inside = (edit: TableCellSourceEdit): boolean => options.spanning
    ? edit.from >= spanFrom && edit.to <= spanTo
    : options.tables.some((table) => edit.from >= table.from && edit.to <= table.to);
  if (!edits.every(inside)) {
    refuseTableEdit(view, "the edit reached outside its table");
    return false;
  }
  const changes = view.state.changes(
    [...edits]
      .sort((left, right) => left.from - right.from)
      .map((edit): ChangeSpec => ({ from: edit.from, to: edit.to, insert: edit.insert })),
  );
  const spec: TransactionSpec = {
    changes,
    selection: options.selection,
    effects: options.effects ? [...options.effects] : undefined,
    annotations: [
      allowTableSourceChange.of(true),
      tableEditIntent.of({
        kind: "tables",
        tableFroms: options.tables.map((table) => table.from),
        spanning: options.spanning,
      }),
      ...(options.annotations ?? []),
    ],
    userEvent: options.userEvent ?? "input.table",
    scrollIntoView: options.scrollIntoView,
  };
  view.dispatch(spec);
  if (view.state.doc === doc) {
    refuseTableEdit(view, "the edit did not match the table it was meant for");
    return false;
  }
  return true;
}

/**
 * Re-renders every mounted table from the current source and tells the user
 * why their last table action did not apply. Deferred to a microtask so it is
 * safe to call from inside an event handler that is itself mid-dispatch.
 */
export function refuseTableEdit(view: EditorView, reason: string): void {
  view.dom.dispatchEvent(new CustomEvent(TABLE_INTEGRITY_EVENT, { bubbles: true, detail: { reason } }));
  announceEditorStatus(view.dom.ownerDocument, `Table refreshed from the document: ${reason}.`);
  queueMicrotask(() => {
    if (view.dom.isConnected) {
      view.dispatch({ effects: tableResyncEffect.of(null) });
    }
  });
}
