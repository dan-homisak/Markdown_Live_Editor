import type { EditorView } from "@codemirror/view";
import { ParsedTable } from "../../shared/tableModel";
import { TableCellSizingOverride } from "../../shared/tableColumnSizing";
import { findCell, readCellDisplayValue } from "./cellSelection";
import { findTrackedTable } from "./tableTracking";

export const TABLE_WIDGET_SELECTOR = ".mlrt-table-widget";

interface TableWidgetElement extends HTMLElement {
  __mlrtTableWidgetCleanup?: () => void;
  /** The parse this DOM currently renders. Display/layout only. */
  __mlrtRenderedTable?: ParsedTable;
  /** Stable table identity from `tableTrackingField`. */
  __mlrtTableId?: number;
  __mlrtView?: EditorView;
}

export function setTableWidgetCleanup(
  wrapper: HTMLElement,
  cleanup: () => void,
): void {
  (wrapper as TableWidgetElement).__mlrtTableWidgetCleanup = cleanup;
}

export function getTableWidgetCleanup(
  wrapper: HTMLElement,
): (() => void) | undefined {
  return (wrapper as TableWidgetElement).__mlrtTableWidgetCleanup;
}

/** Binds a widget root to its editor and stable table identity. */
export function setTableWidgetIdentity(
  wrapper: HTMLElement,
  view: EditorView,
  id: number,
): void {
  const element = wrapper as TableWidgetElement;
  element.__mlrtView = view;
  element.__mlrtTableId = id;
  wrapper.dataset.tableId = String(id);
}

export function getTableWidgetId(wrapper: HTMLElement): number | undefined {
  return (wrapper as TableWidgetElement).__mlrtTableId;
}

/**
 * Records the parse the widget DOM was last rendered or patched from. Parsed
 * tables are immutable memoized values, so no copy is needed.
 */
export function setRenderedTableModel(
  wrapper: HTMLElement,
  table: ParsedTable,
): void {
  (wrapper as TableWidgetElement).__mlrtRenderedTable = table;
}

/**
 * What the widget DOM currently shows. Use only for presentation and layout
 * (row/column counts, sizing). Never compute a source edit from it: use
 * `getTableWidgetTable`, which proves the table is current.
 */
export function getRenderedTableModel(
  wrapper: HTMLElement,
): ParsedTable | undefined {
  return (wrapper as TableWidgetElement).__mlrtRenderedTable;
}

/**
 * The authoritative table for a mounted widget, or undefined.
 *
 * The table is looked up by the widget's stable identity in the editor's
 * *current* state, then cross-checked against CodeMirror's own position for
 * the widget DOM. Both must agree. Every offset in the returned table is
 * valid for `view.state.doc` at the moment of the call, so an edit computed
 * from it and dispatched synchronously cannot land anywhere else.
 *
 * Callers must treat undefined as "refuse to edit": the widget is detached,
 * being replaced, or out of sync, and a fresh render is on its way.
 */
export function getTableWidgetTable(
  wrapper: HTMLElement,
): ParsedTable | undefined {
  const element = wrapper as TableWidgetElement;
  const view = element.__mlrtView;
  const id = element.__mlrtTableId;
  if (!view || id === undefined) {
    return undefined;
  }
  const tracked = findTrackedTable(view.state, id);
  if (!tracked || !wrapper.isConnected || !view.contentDOM.contains(wrapper)) {
    return undefined;
  }
  let position: number;
  try {
    position = view.posAtDOM(wrapper);
  } catch {
    return undefined;
  }
  return position === tracked.table.from ? tracked.table : undefined;
}

/** Mounted widget root for a stable table identity, if it is rendered. */
export function findTableWidgetById(
  view: EditorView,
  id: number,
): HTMLElement | null {
  return view.contentDOM.querySelector<HTMLElement>(
    `${TABLE_WIDGET_SELECTOR}[data-table-id="${id}"]`,
  );
}

/**
 * Sizing override for the focused cell so column widths track the text the
 * user is currently typing before it is committed to the parsed model.
 */
export function readActiveCellSizingOverride(
  wrapper: HTMLElement,
): TableCellSizingOverride | undefined {
  const activeElement = wrapper.ownerDocument.activeElement;
  const cell = findCell(activeElement);
  if (!cell || !wrapper.contains(cell)) {
    return undefined;
  }

  const rowKind = cell.dataset.rowKind;
  const rowIndex = Number(cell.dataset.rowIndex ?? "0");
  const column = Number(cell.dataset.column ?? "0");
  if (
    (rowKind !== "header" && rowKind !== "body") ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    !Number.isInteger(column) ||
    column < 0
  ) {
    return undefined;
  }

  return {
    rowKind,
    rowIndex,
    column,
    value: readCellDisplayValue(cell),
  };
}
