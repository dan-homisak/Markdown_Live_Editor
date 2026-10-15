import { EditorView } from "@codemirror/view";
import { CellRectangle } from "../../shared/clipboardModel";
import { planTableDeletion, TableDeletionBehavior, TableSelectionKind } from "../../shared/tableDeletion";
import { getParsedTables, ParsedTable } from "../../shared/tableModel";
import { cellFromAddress, clearTableRangeSelection, setTableRangeSelection } from "./tableRangeSelection";
import { focusCellAtEnd } from "./cellSelection";
import { applyTableMutation } from "./tableMutation";
import { planTableCellSetDeletion, SelectedTableCell } from "../../shared/tableSelectionSet";

export function deleteTableSelection(
  view: EditorView,
  table: ParsedTable,
  rectangle: CellRectangle,
  kind: TableSelectionKind = "cells",
  behavior: TableDeletionBehavior = "clear-first",
  cells?: SelectedTableCell[],
): void {
  if (view.state.readOnly) return;
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
    const current = getParsedTables(view.state.doc).find(candidate => candidate.from === table.from);
    const wrapper = doc.querySelector<HTMLElement>(`.mlrt-table-widget[data-src-from="${table.from}"]`);
    if (!current || !wrapper) return;
    const top = Math.min(rectangle.top, current.body.length);
    const left = Math.min(rectangle.left, current.columnCount - 1);
    if (plan.removed) {
      const cell = cellFromAddress(wrapper, { row: top, column: left });
      if (cell) focusCellAtEnd(cell, true);
      return;
    }
    setTableRangeSelection(wrapper, table.from,
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
