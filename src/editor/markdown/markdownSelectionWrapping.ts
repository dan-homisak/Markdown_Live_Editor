import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, EditorState, Extension, Prec, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { planMarkdownSelectionWrap } from "../../shared/markdownSelectionWrapping";
import { getParsedTables } from "../../shared/tableModel";
import { getDocumentSelectionProjection } from "../documentSelectionState";
import { findCell } from "../table/cellSelection";

/** One source transaction per key, including multiple disjoint selections. */
export function markdownSelectionWrapTransaction(state: EditorState, character: string): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.some(range => range.empty)) return null;
  const edits = state.selection.ranges.map(range => planMarkdownSelectionWrap(state.doc, range, character));
  if (edits.some(edit => !edit)) return null;
  const plans = edits.filter(edit => edit !== null);
  const tables = getParsedTables(state.doc);
  if (plans.some((edit, index) =>
    tables.some(table => edit.from < table.to && edit.to > table.from) ||
    (index > 0 && plans[index - 1].to > edit.from))) return null;
  const changes = state.changes(plans.map(({ from, to, insert }) => ({ from, to, insert })));
  const ranges = plans.map(edit => {
    const offset = changes.mapPos(edit.from, -1) - edit.from;
    return EditorSelection.range(edit.selection.anchor + offset, edit.selection.head + offset);
  });
  return { changes, selection: EditorSelection.create(ranges, state.selection.mainIndex),
    annotations: isolateHistory.of("full"), userEvent: "input.type.markdown-wrap", scrollIntoView: true };
}

export function createMarkdownSelectionWrapping(readOnly = false): Extension {
  const wrap = (view: EditorView, character: string): boolean => {
    if (readOnly || view.composing || view.compositionStarted ||
        !view.state.facet(EditorView.editable) || findCell(view.dom.ownerDocument.activeElement) ||
        getDocumentSelectionProjection(view.dom.ownerDocument, view.state.selection.main)) return false;
    const transaction = markdownSelectionWrapTransaction(view.state, character);
    if (!transaction) return false;
    view.dispatch(transaction);
    return true;
  };
  return Prec.high([
    EditorView.domEventHandlers({ keydown(event, view) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
          !(event.target instanceof Node) || !view.contentDOM.contains(event.target) || findCell(event.target)) return false;
      return wrap(view, event.key);
    } }),
    // Text input from virtual/alternate-layout keyboards has the same behavior;
    // paste, replacement text, and IME composition retain their normal routes.
    EditorView.inputHandler.of((view, _from, _to, text, insert) => {
      if (insert().isUserEvent("input.type.compose")) return false;
      return wrap(view, text);
    }),
  ]);
}
