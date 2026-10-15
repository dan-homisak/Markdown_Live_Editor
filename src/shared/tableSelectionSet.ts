import { buildTableCellsClearEdit, CellRectangle } from "./clipboardModel";
import { ensureTableCellSeparatorSafe, markdownCellToDisplayText, ParsedTable, TableCellSourceEdit } from "./tableModel";
import type { TableDeletionBehavior } from "./tableDeletion";

export interface SelectedTableCell { row: number; column: number }
export const tableCellKey = (cell: SelectedTableCell): string => `${cell.row}:${cell.column}`;

export function rectangleCells(rectangle: CellRectangle): SelectedTableCell[] {
  return Array.from({ length: rectangle.bottom - rectangle.top + 1 }, (_, row) =>
    Array.from({ length: rectangle.right - rectangle.left + 1 }, (_, column) =>
      ({ row: rectangle.top + row, column: rectangle.left + column }))).flat();
}

export function selectedCellsBounds(cells: readonly SelectedTableCell[]): CellRectangle {
  return { top: Math.min(...cells.map(cell => cell.row)), bottom: Math.max(...cells.map(cell => cell.row)),
    left: Math.min(...cells.map(cell => cell.column)), right: Math.max(...cells.map(cell => cell.column)) };
}

export function toggleSelectedCells(current: readonly SelectedTableCell[], target: readonly SelectedTableCell[]): SelectedTableCell[] {
  const selected = new Map(current.map(cell => [tableCellKey(cell), cell]));
  const remove = target.every(cell => selected.has(tableCellKey(cell)));
  for (const cell of target) {
    if (remove) selected.delete(tableCellKey(cell));
    else selected.set(tableCellKey(cell), cell);
  }
  return [...selected.values()].sort((a, b) => a.row - b.row || a.column - b.column);
}

export function inspectTableCellSet(table: ParsedTable, cells: readonly SelectedTableCell[]) {
  const keys = new Set(cells.map(tableCellKey));
  const rows = [...new Set(cells.map(cell => cell.row))].sort((a, b) => a - b);
  const columns = [...new Set(cells.map(cell => cell.column))].sort((a, b) => a - b);
  const fullRows = rows.filter(row => Array.from({ length: table.columnCount }, (_, column) => keys.has(`${row}:${column}`)).every(Boolean));
  const fullColumns = columns.filter(column => Array.from({ length: table.body.length + 1 }, (_, row) => keys.has(`${row}:${column}`)).every(Boolean));
  const data = [table.header, ...table.body];
  const empty = cells.every(cell => markdownCellToDisplayText(data[cell.row]?.cells[cell.column]?.raw ?? "").trim().length === 0);
  return { rows, columns, fullRows, fullColumns, empty, wholeTable: keys.size === (table.body.length + 1) * table.columnCount };
}

/** A single atomic edit clears the union, or removes only its complete empty axes. */
export function planTableCellSetDeletion(table: ParsedTable, cells: readonly SelectedTableCell[], behavior: TableDeletionBehavior) {
  const info = inspectTableCellSet(table, cells);
  if (behavior === "clear" || (!info.empty && behavior === "clear-first") || (!info.fullRows.length && !info.fullColumns.length)) {
    return { edit: buildTableCellsClearEdit(table, cells), removed: false, wholeTable: info.wholeTable };
  }
  if (info.wholeTable) return { edit: { from: table.from, to: table.to, insert: "" }, removed: true, wholeTable: true };
  const rows = [table.header, ...table.body].filter((_, index) => !info.fullRows.includes(index));
  const line = (row: typeof table.header): string => `|${Array.from({ length: table.columnCount }, (_, column) => row.cells[column]?.raw ?? "  ")
    .filter((_, column) => !info.fullColumns.includes(column)).map(ensureTableCellSeparatorSafe).join("|")}|`;
  const edit: TableCellSourceEdit = { from: table.from, to: table.to,
    insert: [line(rows[0]), line(table.delimiter), ...rows.slice(1).map(line)].join(table.delimiter.from - table.header.to === 2 ? "\r\n" : "\n") };
  return { edit, removed: true, wholeTable: false };
}
