import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ParsedTable, positionBeforeTable, TableCellSourceEdit } from "../../shared/tableModel";
import { allowTableSourceChange } from "../../shared/tableSourceProtection";

/** Keep a widget replacement and its focus handoff from revealing a stale source caret. */
export function applyTableMutation(
  view: EditorView,
  table: ParsedTable,
  edit: TableCellSourceEdit,
  restoreFocus: () => void,
): void {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop, left = scroller.scrollLeft;
  view.dispatch({
    changes: edit,
    selection: EditorSelection.cursor(positionBeforeTable(table)),
    effects: view.scrollSnapshot(),
    annotations: allowTableSourceChange.of(true),
    userEvent: "input.table",
  });
  // Mount/focus synchronously, before the source-selection guard's microtask.
  restoreFocus();
  scroller.scrollTop = top;
  scroller.scrollLeft = left;
}
