import {
  getCellPaddingWhitespace,
  ParsedRow,
  ParsedTable,
  rowToDisplayValues,
} from "../../shared/tableModel";
import { setRenderedTableModel } from "./tableWidgetState";

/**
 * Keeps `data-*` source metadata on the widget and its cells aligned with a
 * parsed table, without touching cell text content. The metadata is
 * descriptive (tests, selection restore, debugging); source edits always
 * resolve the authoritative table through `getTableWidgetTable`.
 */
export function syncTableSourceMetadata(
  dom: HTMLElement,
  table: ParsedTable,
): void {
  setRenderedTableModel(dom, table);
  dom.dataset.srcFrom = String(table.from);
  dom.dataset.srcTo = String(table.to);
  syncTableRowSourceMetadata(dom, table, table.header, "header", 0);
  table.body.forEach((row, rowIndex) => {
    syncTableRowSourceMetadata(dom, table, row, "body", rowIndex);
  });
}

export function syncTableRowSourceMetadata(
  dom: HTMLElement,
  table: ParsedTable,
  sourceRow: ParsedRow,
  rowKind: "header" | "body",
  rowIndex: number,
): void {
  const values = rowToDisplayValues(sourceRow, table.columnCount);
  for (let column = 0; column < table.columnCount; column++) {
    const cell = queryCell(dom, rowKind, rowIndex, column);
    if (!cell) {
      continue;
    }

    syncCellSourceMetadata(
      cell,
      table,
      sourceRow,
      column,
      values[column] ?? "",
    );
  }
}

/**
 * Writes one cell's source metadata: value, source span, preserved padding
 * whitespace, and column alignment.
 */
export function syncCellSourceMetadata(
  cell: HTMLElement,
  table: ParsedTable,
  sourceRow: ParsedRow,
  column: number,
  value: string,
): void {
  setData(cell, "tableFrom", String(table.from));
  setData(cell, "sourceValue", value);
  const alignment = table.alignments[column] ?? "left";
  if (cell.style.textAlign !== alignment) {
    cell.style.textAlign = alignment;
  }
  const sourceCell = sourceRow.cells[column];
  if (!sourceCell) {
    delete cell.dataset.sourceFrom;
    delete cell.dataset.sourceTo;
    delete cell.dataset.sourceLeadingWhitespace;
    delete cell.dataset.sourceTrailingWhitespace;
    return;
  }

  const { leadingWhitespace, trailingWhitespace } = getCellPaddingWhitespace(
    sourceCell.raw,
  );
  setData(cell, "sourceFrom", String(sourceCell.start));
  setData(cell, "sourceTo", String(sourceCell.end));
  setData(cell, "sourceLeadingWhitespace", leadingWhitespace);
  setData(cell, "sourceTrailingWhitespace", trailingWhitespace);
}

function setData(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
}

export function queryCell(
  dom: HTMLElement,
  rowKind: "header" | "body",
  rowIndex: number,
  column: number,
): HTMLElement | null {
  return dom.querySelector<HTMLElement>(
    [
      `.mlrt-table-cell[data-row-kind="${rowKind}"]`,
      `[data-row-index="${rowIndex}"]`,
      `[data-column="${column}"]`,
    ].join(""),
  );
}
