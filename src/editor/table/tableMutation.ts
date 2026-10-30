import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ParsedTable, positionBeforeTable, TableCellSourceEdit } from "../../shared/tableModel";
import { allowTableSourceChange } from "../../shared/tableSourceProtection";
import { tableStructureUndoFocusAnnotation } from "../tableEditAnnotations";
import { findCell, getCellCaretOffset } from "./cellSelection";

/** Keep a widget replacement and its focus handoff from revealing a stale source caret. */
export function applyTableMutation(
  view: EditorView,
  table: ParsedTable,
  edit: TableCellSourceEdit,
  restoreFocus: () => void,
): void {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop, left = scroller.scrollLeft;
  const cell = findCell(view.dom.ownerDocument.activeElement);
  const focus = cell ? { tableFrom: Number(cell.dataset.tableFrom), rowKind: cell.dataset.rowKind ?? "body",
    rowIndex: Number(cell.dataset.rowIndex), column: Number(cell.dataset.column),
    from: Number(cell.dataset.sourceFrom), to: Number(cell.dataset.sourceTo), restoreCaretOffset: getCellCaretOffset(cell) } : null;
  view.dispatch({
    changes: edit,
    selection: EditorSelection.cursor(positionBeforeTable(table)),
    effects: view.scrollSnapshot(),
    annotations: [allowTableSourceChange.of(true), ...(focus ? [tableStructureUndoFocusAnnotation.of(focus)] : [])],
    userEvent: "input.table",
  });
  // Mount/focus synchronously, before the source-selection guard's microtask.
  restoreFocus();
  scroller.scrollTop = top;
  scroller.scrollLeft = left;
}
