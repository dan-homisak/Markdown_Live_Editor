import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ParsedTable, positionBeforeTable, TableCellSourceEdit } from "../../shared/tableModel";
import { tableStructureUndoFocusAnnotation } from "../tableEditAnnotations";
import { findCell, getCellCaretOffset } from "./cellSelection";
import { dispatchTableSourceEdit } from "./tableSourceWrite";

/**
 * Applies a structural edit computed from `table`, which must be the current
 * parse of the document (resolved via `getTableWidgetTable` or the table
 * tracking field just before calling). The edit is refused, and the table
 * re-rendered, if it was computed from anything else.
 *
 * Keeps the widget replacement and its focus handoff from revealing a stale
 * source caret. Returns true when the document changed.
 */
export function applyTableMutation(
  view: EditorView,
  table: ParsedTable,
  edit: TableCellSourceEdit,
  restoreFocus: () => void,
  /** A following table this edit merges into `table`; also must be current. */
  mergedTable?: ParsedTable,
): boolean {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop, left = scroller.scrollLeft;
  const cell = findCell(view.dom.ownerDocument.activeElement);
  const focus = cell ? { tableFrom: Number(cell.dataset.tableFrom), rowKind: cell.dataset.rowKind ?? "body",
    rowIndex: Number(cell.dataset.rowIndex), column: Number(cell.dataset.column),
    from: Number(cell.dataset.sourceFrom), to: Number(cell.dataset.sourceTo), restoreCaretOffset: getCellCaretOffset(cell) } : null;
  const changed = dispatchTableSourceEdit(view, {
    tables: mergedTable ? [table, mergedTable] : [table],
    spanning: Boolean(mergedTable),
    edits: [edit],
    selection: EditorSelection.cursor(positionBeforeTable(table)),
    effects: [view.scrollSnapshot()],
    annotations: focus ? [tableStructureUndoFocusAnnotation.of(focus)] : [],
    userEvent: "input.table",
  });
  if (!changed) {
    return false;
  }
  // Mount/focus synchronously, before the source-selection guard's microtask.
  restoreFocus();
  scroller.scrollTop = top;
  scroller.scrollLeft = left;
  return true;
}
