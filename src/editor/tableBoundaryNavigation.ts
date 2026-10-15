import { EditorSelection, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  getParsedTables,
  ParsedTable,
  positionAfterTable,
} from "../shared/tableModel";
import { findCell, focusCellAtVerticalEdge } from "./table/cellSelection";
import { TABLE_CELL_SELECTOR } from "./table/cellSelection";
import { TABLE_WIDGET_SELECTOR } from "./table/tableWidgetState";
import { selectVisibleTableBoundary } from "./tableBoundaryInput";
import { markdownListRangeHidden } from "./markdown/markdownListStructure";
import { joinTablesAcrossDeletion } from "../shared/tableStructureEdits";
import { applyTableMutation } from "./table/tableMutation";
import { focusCellAtEnd } from "./table/cellSelection";
import { allowTableSourceChange } from "../shared/tableSourceProtection";
import { announceEditorStatus } from "./editorStatus";

/**
 * Arrow-key handoff between the source editor and rendered tables.
 *
 * Table source lines are atomic/replaced, so the editor cursor can never sit
 * on them. Pressing ArrowDown on the line above a table (or ArrowUp on the
 * line below) moves focus into the nearest rendered cell instead of skipping
 * the whole block.
 */
export function createTableBoundaryArrowNavigation(): Extension {
  return keymap.of([
    { key: "Delete", run: view => deleteBetweenTables(view, 1) },
    { key: "Backspace", run: view => deleteBetweenTables(view, -1) },
    {
      key: "ArrowDown",
      run: (view) => focusTableAcrossBoundary(view, "down"),
    },
    {
      key: "ArrowUp",
      run: (view) => focusTableAcrossBoundary(view, "up"),
    },
  ]);
}

export function deleteBetweenTables(view: EditorView, direction: -1 | 1): boolean {
  if (view.state.readOnly || isRenderedTableCellFocused(view)) return false;
  const selected = view.state.selection.main;
  const from = selected.empty ? selected.head - (direction === -1 ? 1 : 0) : selected.from;
  const to = selected.empty ? selected.head + (direction === 1 ? 1 : 0) : selected.to;
  if (from < 0 || to > view.state.doc.length) return false;
  const tables = getParsedTables(view.state.doc);
  const join = joinTablesAcrossDeletion(view.state.doc, tables, from, to);
  if (!join) {
    for (let index = 0; index + 1 < tables.length; index++) {
      const first = tables[index], second = tables[index + 1];
      if (from < first.to || to > second.from) continue;
      const remaining = view.state.doc.sliceString(first.to, from) + view.state.doc.sliceString(to, second.from);
      if (remaining.trim().length > 0) return false;
      // Ordinary blank-line deletion is safe while a blank line still separates the widgets.
      // A different-width table keeps its final separator rather than corrupting either grid.
      if ((remaining.match(/\n/g)?.length ?? 0) >= 2) {
        view.dispatch({ changes: { from, to, insert: "" },
          selection: EditorSelection.cursor(Math.max(first.to + 1, Math.min(from, second.from - (to - from) - 1))),
          annotations: allowTableSourceChange.of(true), userEvent: "delete" });
      } else if (first.columnCount !== second.columnCount) {
        announceEditorStatus(view.dom.ownerDocument,
          `Cannot merge tables: the first has ${first.columnCount} columns and the second has ${second.columnCount}. Make their column counts match first.`);
      }
      return true;
    }
    return false;
  }
  applyTableMutation(view, join.table, join.edit, () => {
    const cell = view.dom.querySelector<HTMLElement>(`${TABLE_CELL_SELECTOR}[data-table-from="${join.table.from}"][data-row-kind="body"][data-row-index="${join.table.body.length}"][data-column="0"]`);
    if (cell) focusCellAtEnd(cell, true);
  });
  return true;
}

function focusTableAcrossBoundary(
  view: EditorView,
  direction: "up" | "down",
): boolean {
  if (!view.state.selection.main.empty || isRenderedTableCellFocused(view)) {
    return false;
  }

  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const tables = getParsedTables(view.state.doc);
  for (const table of tables) {
    if (markdownListRangeHidden(view.state, table)) continue;
    if (direction === "down" && head === table.to) {
      selectVisibleTableBoundary(view, table, "after");
      return true;
    }
    if (direction === "up" && head === table.from) {
      selectVisibleTableBoundary(view, table, "before");
      return true;
    }
    // table.startLine is 0-based, line.number is 1-based, so the line
    // directly above the table has line.number === table.startLine.
    const lineNumberAboveTable = table.startLine;
    const afterTable = positionAfterTable(view.state.doc, table);
    if (direction === "down" && line.number === lineNumberAboveTable) {
      return focusRenderedTableCell(view, table, "first");
    }
    if (direction === "up" && line.from === afterTable && head >= afterTable) {
      return focusRenderedTableCell(view, table, "last");
    }
    if (head >= table.from && head <= table.to) {
      return focusRenderedTableCell(
        view,
        table,
        direction === "down" ? "first" : "last",
      );
    }
  }

  return false;
}

function focusRenderedTableCell(
  view: EditorView,
  table: ParsedTable,
  target: "first" | "last",
): boolean {
  const wrapper = view.dom.querySelector<HTMLElement>(
    `${TABLE_WIDGET_SELECTOR}[data-src-from="${table.from}"]`,
  );
  const cells = Array.from(
    wrapper?.querySelectorAll<HTMLElement>(TABLE_CELL_SELECTOR) ?? [],
  );
  const cell = target === "first" ? cells[0] : cells[cells.length - 1];
  if (!cell) {
    return false;
  }

  const caret = view.coordsAtPos(view.state.selection.main.head);
  focusCellAtVerticalEdge(
    cell,
    target === "first" ? 1 : -1,
    caret?.left ?? null,
  );
  return true;
}

function isRenderedTableCellFocused(view: EditorView): boolean {
  return Boolean(findCell(view.dom.ownerDocument.activeElement));
}
