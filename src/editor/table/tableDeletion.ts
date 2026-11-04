import { EditorView } from "@codemirror/view";
import { CellRectangle } from "../../shared/clipboardModel";
import { planTableDeletion, TableDeletionBehavior, TableSelectionKind } from "../../shared/tableDeletion";
import { cellFromAddress, clearTableRangeSelection, setTableRangeSelection } from "./tableRangeSelection";
import { focusCellAtEnd } from "./cellSelection";
import { applyTableMutation } from "./tableMutation";
import { planTableCellSetDeletion, SelectedTableCell } from "../../shared/tableSelectionSet";
import { findTableWidgetById, getTableWidgetId, getTableWidgetTable } from "./tableWidgetState";
import { refuseTableEdit } from "./tableSourceWrite";

/**
 * Clears or removes a selection in the table rendered by `wrapper`. The table
 * is resolved from the current document at the moment of the action, so a
 * plan can never be computed from offsets that an earlier edit moved.
 */
export function deleteTableSelection(
  view: EditorView,
  wrapper: HTMLElement,
  rectangle: CellRectangle,
  kind: TableSelectionKind = "cells",
  behavior: TableDeletionBehavior = "clear-first",
  cells?: SelectedTableCell[],
): void {
  if (view.state.readOnly) return;
  const table = getTableWidgetTable(wrapper);
  if (!table) {
    refuseTableEdit(view, "the table changed before the deletion could be applied");
    return;
  }
  const tableId = getTableWidgetId(wrapper);
  const doc = view.dom.ownerDocument;
  const plan = cells ? planTableCellSetDeletion(table, cells, behavior) : planTableDeletion(table, rectangle, kind, behavior);
  // A rebuilt widget must not inherit a selection that referred to removed cells.
  if (plan.removed) clearTableRangeSelection(doc);
  const restore = (): void => {
    if (plan.removed && plan.wholeTable) {
      clearTableRangeSelection(doc);
      view.focus();
      return;
    }
    const target = tableId === undefined ? null : findTableWidgetById(view, tableId);
    const current = target ? getTableWidgetTable(target) : undefined;
    if (!target || !current) return;
    const top = Math.min(rectangle.top, current.body.length);
    const left = Math.min(rectangle.left, current.columnCount - 1);
    if (plan.removed) {
      const cell = cellFromAddress(target, { row: top, column: left });
      if (cell) focusCellAtEnd(cell, true);
      return;
    }
    setTableRangeSelection(target, current.from,
      { row: kind === "columns" ? 0 : top, column: kind === "rows" ? 0 : left },
      { row: kind === "columns" ? current.body.length : Math.min(rectangle.bottom, current.body.length),
        column: kind === "rows" ? current.columnCount - 1 : Math.min(rectangle.right, current.columnCount - 1) },
      true, kind, cells);
  };
  if (view.state.doc.sliceString(plan.edit.from, plan.edit.to) === plan.edit.insert) {
    restore();
    return;
  }
  applyTableMutation(view, table, plan.edit, restore);
}
