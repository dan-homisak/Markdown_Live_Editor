import { EditorView, WidgetType } from "@codemirror/view";
import {
  canonicalTableCellValue,
  ParsedRow,
  ParsedTable,
  rowToDisplayValues,
  sameTableContent,
  sameTableSource,
} from "../../shared/tableModel";
import { measureTableColumnSizing } from "../../shared/tableColumnSizing";
import {
  getCellSelectionOffsets,
  readCellDisplayValue,
  setCellPlainText,
  setCellSelectionOffsets,
} from "./cellSelection";
import { bindTableCellPresentation, presentTableCell } from "./tableCellPresentation";
import { bindTableEditing } from "./tableCellEditing";
import { queryCell, syncCellSourceMetadata } from "./tableCellMetadata";
import {
  appendColumnSizing,
  applyColumnSizing,
  bindTableLayout,
  measureAvailableDataWidthChForView,
  primeTableLayoutForMount,
  synchronizeTableLayoutNow,
  tableSizingOverflowsAvailableWidth,
} from "./tableLayout";
import { bindTableStructureControls } from "./tableStructureControls";
import { bindTableRangeSelection } from "./tableRangeSelection";
import {
  estimateRenderedTableHeight,
  TableHeightEstimateMetrics,
} from "./tableHeightEstimate";
import { bindTableClipboard } from "./tableClipboard";
import {
  getRenderedTableModel,
  getTableWidgetCleanup,
  getTableWidgetId,
  setRenderedTableModel,
  setTableWidgetCleanup,
  setTableWidgetIdentity,
} from "./tableWidgetState";

/**
 * Block widget that replaces a markdown table's source lines with a rendered,
 * editable grid.
 *
 * Identity and freshness:
 * - Each widget carries the stable id of its table (`tableTrackingField`) and
 *   the exact parse of the current document. Decorations are rebuilt on every
 *   document change, so no widget ever outlives the source it describes.
 * - `eq` is exact source identity (same id, same position, same text). An
 *   unchanged table keeps its DOM with no work at all.
 * - `updateDOM` only adopts DOM that was rendered for the *same* table id.
 *   CodeMirror otherwise offers any same-class widget DOM for reuse, which
 *   would carry focus, a caret, or a range selection over to a different
 *   table of the same shape.
 * - A patch always rewrites every cell's source metadata; inactive cells
 *   re-render their value, and the focused cell converges to the source
 *   whenever the source no longer matches what the user is looking at
 *   (undo, a host update, or a rejected edit).
 */
export class RenderedTableWidget extends WidgetType {
  public constructor(
    public readonly table: ParsedTable,
    public readonly id: number,
    private readonly heightEstimateMetrics: TableHeightEstimateMetrics,
    private readonly preview: boolean,
    private readonly generation = 0,
  ) {
    super();
  }

  /**
   * Gives CodeMirror's off-screen height map a source-derived table estimate.
   *
   * Without this, a replacement widget is initially estimated as roughly one
   * text line. Mounting even a two-row table while scrolling then changes the
   * height map underneath the viewport; a run of tables can briefly put the
   * widget DOM ahead of the preceding native gutter line. Explicit `<br>`
   * rows are especially disruptive. The real DOM is still measured after
   * mounting, but this estimate keeps the virtual layout close enough that
   * scroll anchoring never has to recover from a one-line-versus-many-lines
   * discontinuity.
   */
  public override get estimatedHeight(): number {
    return estimateRenderedTableHeight(
      this.table,
      this.heightEstimateMetrics,
    );
  }

  public eq(widget: WidgetType): boolean {
    return (
      widget instanceof RenderedTableWidget &&
      widget.id === this.id &&
      widget.preview === this.preview &&
      widget.generation === this.generation &&
      sameTableSource(widget.table, this.table)
    );
  }

  public updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (
      getTableWidgetId(dom) !== this.id ||
      !canPatchTableDOM(dom, this.table)
    ) {
      return false;
    }

    const rendered = getRenderedTableModel(dom);
    const contentChanged =
      !rendered ||
      !sameTableContent(rendered, this.table) ||
      dom.dataset.markdownPreviewEnabled !== String(this.preview);
    setTableWidgetIdentity(dom, view, this.id);
    patchTableDOM(dom, this.table, this.preview);
    setDataValue(dom, "heightEstimateRevision", String(this.heightEstimateMetrics.revision));
    setDataValue(dom, "estimatedHeightPx", String(this.estimatedHeight));
    // A table that only moved keeps its layout; its rows and wrapping are
    // unchanged. Content changes resolve height in the same update.
    return contentChanged
      ? synchronizeTableLayoutNow(dom, this.table, view)
      : true;
  }

  public toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("section");
    wrapper.className = "mlrt-table-widget";
    wrapper.dataset.srcFrom = String(this.table.from);
    wrapper.dataset.srcTo = String(this.table.to);
    wrapper.dataset.heightEstimateRevision = String(
      this.heightEstimateMetrics.revision,
    );
    wrapper.dataset.estimatedHeightPx = String(this.estimatedHeight);
    wrapper.contentEditable = "false";
    wrapper.dataset.markdownPreviewEnabled = String(this.preview);
    setTableWidgetIdentity(wrapper, view, this.id);
    setRenderedTableModel(wrapper, this.table);

    const availableDataWidthCh = measureAvailableDataWidthChForView(
      view,
      this.table.columnCount,
    );
    const columnSizing = measureTableColumnSizing(
      this.table,
      availableDataWidthCh,
    );
    applyColumnSizing(wrapper, columnSizing);

    const tableElement = document.createElement("table");
    tableElement.className = "mlrt-table";
    appendColumnSizing(tableElement, this.table, columnSizing);

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    appendCells({
      table: this.table,
      sourceRow: this.table.header,
      tableRow: headerRow,
      tagName: "th",
      rowKind: "header",
      rowIndex: 0,
    });
    thead.append(headerRow);
    tableElement.append(thead);

    const tbody = document.createElement("tbody");
    this.table.body.forEach((sourceRow, rowIndex) => {
      const tableRow = document.createElement("tr");
      appendCells({
        table: this.table,
        sourceRow,
        tableRow,
        tagName: "td",
        rowKind: "body",
        rowIndex,
      });
      tbody.append(tableRow);
    });
    tableElement.append(tbody);

    const tableScroll = document.createElement("div");
    tableScroll.className = "mlrt-table-scroll";
    tableScroll.append(tableElement);

    const scrollbar = document.createElement("div");
    scrollbar.className = "mlrt-table-scrollbar";
    scrollbar.hidden = !tableSizingOverflowsAvailableWidth(
      columnSizing,
      availableDataWidthCh,
    );
    const scrollbarThumb = document.createElement("div");
    scrollbarThumb.className = "mlrt-table-scrollbar-thumb";
    scrollbar.append(scrollbarThumb);

    wrapper.append(tableScroll, scrollbar);
    primeTableLayoutForMount(
      wrapper,
      tableScroll,
      tableElement,
      scrollbar,
      scrollbarThumb,
      this.table,
      view,
    );
    const scheduleTableLayout = bindTableLayout(
      wrapper,
      tableScroll,
      tableElement,
      scrollbar,
      scrollbarThumb,
      view,
    );
    bindTableEditing(wrapper, view, scheduleTableLayout);
    for (const cell of Array.from(wrapper.querySelectorAll<HTMLElement>(".mlrt-table-cell")))
      presentTableCell(cell, cell.dataset.sourceValue ?? "", this.preview);
    const presentationCleanup = bindTableCellPresentation(wrapper, view, scheduleTableLayout);
    const rangeSelectionCleanup = bindTableRangeSelection(wrapper, view);
    const clipboardCleanup = bindTableClipboard(wrapper, view, this.table);
    const layoutCleanup = getTableWidgetCleanup(wrapper);
    const structureControlsCleanup = bindTableStructureControls({
      wrapper,
      view,
      tableScroll,
      tableElement,
    });
    setTableWidgetCleanup(wrapper, () => {
      layoutCleanup?.();
      presentationCleanup();
      rangeSelectionCleanup();
      clipboardCleanup();
      structureControlsCleanup();
    });
    return wrapper;
  }

  public destroy(dom: HTMLElement): void {
    getTableWidgetCleanup(dom)?.();
  }

  public ignoreEvent(): boolean {
    return true;
  }
}

interface AppendCellsOptions {
  table: ParsedTable;
  sourceRow: ParsedRow;
  tableRow: HTMLTableRowElement;
  tagName: "th" | "td";
  rowKind: "header" | "body";
  rowIndex: number;
}

/**
 * Whether the mounted widget DOM has the same rendered shape as the parsed
 * table: one header row, matching body row count, matching column count, and
 * a full set of editable cells in every row. A shape change (rows or columns
 * inserted/removed) is rebuilt instead of patched.
 */
function canPatchTableDOM(dom: HTMLElement, table: ParsedTable): boolean {
  if (!dom.classList.contains("mlrt-table-widget")) {
    return false;
  }

  const headerRows = dom.querySelectorAll("thead tr");
  const bodyRows = dom.querySelectorAll("tbody tr");
  if (headerRows.length !== 1 || bodyRows.length !== table.body.length) {
    return false;
  }

  const sizedColumns = dom.querySelectorAll(".mlrt-table-sized-col");
  if (sizedColumns.length !== table.columnCount) {
    return false;
  }

  const rows = [...Array.from(headerRows), ...Array.from(bodyRows)];
  return rows.every(
    (row) => row.querySelectorAll(".mlrt-table-cell").length === table.columnCount,
  );
}

function patchTableDOM(dom: HTMLElement, table: ParsedTable, preview: boolean): void {
  setRenderedTableModel(dom, table);
  setDataValue(dom, "srcFrom", String(table.from));
  setDataValue(dom, "srcTo", String(table.to));
  setDataValue(dom, "markdownPreviewEnabled", String(preview));
  patchTableRowDOM(dom, table, table.header, "header", 0, preview);
  table.body.forEach((row, rowIndex) => {
    patchTableRowDOM(dom, table, row, "body", rowIndex, preview);
  });
}

function patchTableRowDOM(
  dom: HTMLElement,
  table: ParsedTable,
  sourceRow: ParsedRow,
  rowKind: "header" | "body",
  rowIndex: number,
  preview: boolean,
): void {
  const tableRow =
    rowKind === "header"
      ? dom.querySelector<HTMLTableRowElement>("thead tr")
      : dom.querySelectorAll<HTMLTableRowElement>("tbody tr")[rowIndex];
  const lineCell = tableRow?.querySelector<HTMLElement>(
    ".mlrt-table-source-line",
  );
  if (lineCell) {
    const sourceLineText = String(sourceRow.lineIndex + 1);
    setDataValue(lineCell, "sourceLine", sourceLineText);
    if (lineCell.textContent !== sourceLineText) {
      lineCell.textContent = sourceLineText;
    }
  }

  const values = rowToDisplayValues(sourceRow, table.columnCount);
  for (let column = 0; column < table.columnCount; column++) {
    const cell = queryCell(dom, rowKind, rowIndex, column);
    if (!cell) {
      continue;
    }

    const value = values[column] ?? "";
    syncCellSourceMetadata(cell, table, sourceRow, column, value);
    if (cell.ownerDocument.activeElement === cell) {
      convergeActiveCell(cell, value);
    } else {
      presentTableCell(cell, value, preview);
    }
  }
}

/**
 * The focused cell shows the user's in-progress text, which the live write
 * path has already stored in the source. When the source value differs from
 * what that text would produce, something else changed this cell (host undo,
 * an external edit, or a rejected write): the source wins, so the user never
 * keeps typing on top of text the document no longer contains.
 */
function convergeActiveCell(cell: HTMLElement, value: string): void {
  if (
    cell.dataset.composing === "true" ||
    canonicalTableCellValue(readCellDisplayValue(cell)) === value
  ) {
    return;
  }
  const selection = getCellSelectionOffsets(cell);
  setCellPlainText(cell, value);
  if (selection) {
    setCellSelectionOffsets(
      cell,
      Math.min(selection.anchor, value.length),
      Math.min(selection.head, value.length),
    );
  }
}

function setDataValue(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
}

function appendCells(options: AppendCellsOptions): void {
  appendSourceLineCell(options);

  const values = rowToDisplayValues(
    options.sourceRow,
    options.table.columnCount,
  );
  values.forEach((value, column) => {
    const cell = document.createElement(options.tagName);
    cell.className = "mlrt-table-cell";
    cell.contentEditable = "true";
    cell.spellcheck = false;
    setCellPlainText(cell, value);
    cell.dataset.rowKind = options.rowKind;
    cell.dataset.rowIndex = String(options.rowIndex);
    cell.dataset.column = String(column);
    syncCellSourceMetadata(
      cell,
      options.table,
      options.sourceRow,
      column,
      value,
    );
    options.tableRow.append(cell);
  });
}

/**
 * Leading non-editable cell that renders the row's source line number inside
 * the table itself, so row height and line-number height are resolved by a
 * single layout (see gutter strategy notes in the stylesheet).
 */
function appendSourceLineCell(options: AppendCellsOptions): void {
  const cell = document.createElement(options.tagName);
  cell.className = "mlrt-table-source-line";
  cell.contentEditable = "false";
  cell.dataset.sourceLine = String(options.sourceRow.lineIndex + 1);
  cell.textContent = String(options.sourceRow.lineIndex + 1);
  cell.setAttribute("aria-hidden", "true");
  options.tableRow.append(cell);
}
