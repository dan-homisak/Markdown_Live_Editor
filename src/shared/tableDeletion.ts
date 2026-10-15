import { buildGridClearEdit, CellRectangle } from "./clipboardModel";
import { ensureTableCellSeparatorSafe, markdownCellToDisplayText, ParsedTable, TableCellSourceEdit } from "./tableModel";

export type TableSelectionKind = "cells" | "rows" | "columns";
export type TableDeletionBehavior = "clear-first" | "clear" | "remove";

export function classifyTableSelection(
  table: ParsedTable,
  rectangle: CellRectangle,
  kind: TableSelectionKind = "cells",
): TableSelectionKind | "table" {
  if (rectangle.top === 0 && rectangle.bottom === table.body.length &&
    rectangle.left === 0 && rectangle.right === table.columnCount - 1) return "table";
  if (rectangle.left === 0 && rectangle.right === table.columnCount - 1) return "rows";
  if (rectangle.top === 0 && rectangle.bottom === table.body.length) return "columns";
  return kind;
}

/** A handle uses a matching structural selection only when it includes that handle. */
export function tableStructureSelection(
  table: ParsedTable,
  kind: "rows" | "columns",
  index: number,
  selection?: { rectangle: CellRectangle; kind?: TableSelectionKind },
): CellRectangle {
  const rectangle = selection?.rectangle;
  const selectedKind = rectangle ? classifyTableSelection(table, rectangle, selection?.kind) : undefined;
  if ((selectedKind === kind || selectedKind === "table") && rectangle && (kind === "rows"
    ? index >= rectangle.top && index <= rectangle.bottom
    : index >= rectangle.left && index <= rectangle.right)) return { ...rectangle };
  return kind === "rows"
    ? { top: index, bottom: index, left: 0, right: table.columnCount - 1 }
    : { top: 0, bottom: table.body.length, left: index, right: index };
}

/** Backspace always clears. Delete removes only an already-empty structural selection. */
export function planTableDeletion(
  table: ParsedTable,
  rectangle: CellRectangle,
  kind: TableSelectionKind = "cells",
  behavior: TableDeletionBehavior = "clear-first",
): { edit: TableCellSourceEdit; removed: boolean; wholeTable: boolean } {
  // Structural actions always include every cell in their rows/columns.
  rectangle = kind === "rows" ? { ...rectangle, left: 0, right: table.columnCount - 1 }
    : kind === "columns" ? { ...rectangle, top: 0, bottom: table.body.length } : rectangle;
  const target = classifyTableSelection(table, rectangle, kind);
  if (target === "rows" || target === "columns") kind = target;
  const wholeTable = rectangle.top === 0 && rectangle.bottom === table.body.length &&
    rectangle.left === 0 && rectangle.right === table.columnCount - 1;
  const rows = [table.header, ...table.body];
  const hasContent = rows.some((row, index) => index >= rectangle.top && index <= rectangle.bottom &&
    row.cells.some((cell, column) => column >= rectangle.left && column <= rectangle.right &&
      markdownCellToDisplayText(cell.raw).trim().length > 0));
  if (behavior === "clear" || (hasContent && behavior === "clear-first") || (!wholeTable && kind === "cells")) {
    return { edit: buildGridClearEdit(table, rectangle), removed: false, wholeTable };
  }
  if (wholeTable) {
    return { edit: { from: table.from, to: table.to, insert: "" }, removed: true, wholeTable };
  }
  const separator = table.delimiter.from - table.header.to === 2 ? "\r\n" : "\n";
  let lines: string[];
  if (kind === "rows") {
    const remaining = rows.filter((_, index) => index < rectangle.top || index > rectangle.bottom);
    // The first remaining data row becomes the header if the old header was selected.
    lines = [remaining[0].text, table.delimiter.text, ...remaining.slice(1).map(row => row.text)];
  } else {
    lines = [table.header, table.delimiter, ...table.body].map(row =>
      `|${Array.from({ length: table.columnCount }, (_, column) => row.cells[column]?.raw ?? "  ")
        .filter((_, column) => column < rectangle.left || column > rectangle.right).map(ensureTableCellSeparatorSafe).join("|")}|`);
  }
  return { edit: { from: table.from, to: table.to, insert: lines.join(separator) }, removed: true, wholeTable };
}
