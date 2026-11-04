import { keyboardBindingMatches, TableShortcuts } from "../../shared/keyboardBinding";
import { insertTableRowEdit, insertTableColumnEdit, prependTableHeaderRowEdit } from "../../shared/tableStructureEdits";
import { applyTableMutation } from "./tableMutation";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { planMarkdownSelectionWrap } from "../../shared/markdownSelectionWrapping";
import { markdownRenderingOptionsFacet } from "../markdown/markdownRendering";
import { ParsedTable } from "../../shared/tableModel";
import {
  CellTextEditSnapshot,
  CellTextSelection,
  computeCellBeforeInputDecision,
} from "../../shared/tableCellInput";
import {
  adjacentTableCell,
  TableCellArrowDirection,
} from "../../shared/tableKeyboardNavigation";
import { selectVisibleTableBoundary } from "../tableBoundaryInput";
import {
  extendCellSelectionVertically,
  findCell,
  focusCellAtEnd,
  focusCellAtStart,
  focusCellAtVerticalEdge,
  getCellCaretOffset,
  getCellSelectionOffsets,
  moveCellCaretVertically,
  moveCellSelectionToLineBoundary,
  readCellDisplayValue,
  setCellCaretOffset,
  setCellSelectionOffsets,
  setCellPlainText,
  TABLE_CELL_SELECTOR,
} from "./cellSelection";
import {
  findTableWidgetById,
  getRenderedTableModel,
  getTableWidgetId,
  getTableWidgetTable,
} from "./tableWidgetState";
import {
  isTableNavigationModifierHeld,
  tableNavigationModifierFacet,
  tableShortcutsFacet,
} from "../tableNavigation";
import { TABLE_CELL_COMMIT_EVENT, writeCellValue } from "./tableSourceWrite";

export { TABLE_CELL_COMMIT_EVENT };

type CellEditSnapshot = CellTextEditSnapshot;

interface CellTarget {
  rowKind: string;
  rowIndex: string;
  column: string;
}

type VerticalCellTarget = CellTarget | "before-table" | "after-table";

/**
 * Attaches all editing behavior to a rendered table widget.
 *
 * Every keystroke is written straight through to the Markdown source by
 * `writeCellValue`, which recomputes the target cell from the editor's
 * current state and refuses (re-rendering from source) whenever the cell's
 * source no longer matches what the user was editing. The widget therefore
 * never holds unsaved or misaddressed text.
 *
 * - `beforeinput` turns keystrokes into plain-text snapshots of the cell,
 * - native input (IME composition, spellcheck) is written on `input`,
 * - Enter commits and moves down the column, Shift+Enter inserts a line break,
 * - Tab/Shift+Tab and boundary arrow keys commit and move between cells,
 * - Undo/redo are owned by the VS Code document history (see liveEditor.ts).
 */
export function bindTableEditing(
  wrapper: HTMLElement,
  view: EditorView,
  scheduleTableLayout: () => void,
): void {
  const write = (cell: HTMLElement, scrollSnapshot?: StateEffect<unknown>): void => {
    const caretOffset = getCellCaretOffset(cell);
    writeCellValue(view, wrapper, cell, { scrollSnapshot });
    restoreFocusAfterWrite(view, wrapper, cell, caretOffset);
  };

  const wrapCellSelection = (cell: HTMLElement, character: string): boolean => {
    if (view.state.readOnly || view.state.facet(markdownRenderingOptionsFacet).readOnly) return false;
    const selection = getCellSelectionOffsets(cell);
    if (!selection) return false;
    const value = readCellDisplayValue(cell);
    // Table cell content is inline Markdown. Even long backtick delimiters
    // stay inline rather than introducing block fences into a table row.
    const edit = planMarkdownSelectionWrap(value, selection, character, { inlineOnly: true });
    if (!edit) return false;
    setCellPlainText(cell, value.slice(0, edit.from) + edit.insert + value.slice(edit.to));
    setCellSelectionOffsets(cell, edit.selection.anchor, edit.selection.head);
    write(cell);
    scheduleTableLayout();
    return true;
  };

  wrapper.addEventListener("focusin", (event) => {
    if (findCell(event.target)) {
      scheduleTableLayout();
    }
  });

  wrapper.addEventListener("compositionstart", (event) => {
    const cell = findCell(event.target);
    if (cell) cell.dataset.composing = "true";
  });

  wrapper.addEventListener("compositionend", (event) => {
    const cell = findCell(event.target);
    if (!cell) return;
    delete cell.dataset.composing;
    write(cell);
    scheduleTableLayout();
  });

  wrapper.addEventListener("beforeinput", (event) => {
    const cell = findCell(event.target);
    if (!cell || !(event instanceof InputEvent)) {
      return;
    }
    if (
      event.inputType === "historyUndo" ||
      event.inputType === "historyRedo"
    ) {
      // The document-level command bridge routes undo/redo to VS Code's
      // authoritative history. A cell must never apply Chromium's own
      // contenteditable history, which knows nothing about the source.
      event.preventDefault();
      return;
    }

    const cellSelection = getCellSelectionOffsets(cell);
    if (event.inputType === "insertText" && !event.isComposing && event.data !== null &&
        cellSelection && getCellInputTargetSelection(cell, event) !== null &&
        wrapCellSelection(cell, event.data)) {
      event.preventDefault();
      return;
    }
    const inputDecision = computeCellBeforeInputDecision({
      value: readCellDisplayValue(cell),
      selection: cellSelection,
      // A target range confined to this editing host cannot make a DOM
      // selection that visibly crosses sibling cells safe. Fail closed when
      // the live selection itself is not wholly owned by the target cell.
      targetSelection:
        cellSelection === null
          ? null
          : getCellInputTargetSelection(cell, event),
      inputType: event.inputType,
      data: getCellInputData(event),
    });
    if (inputDecision.kind === "native") {
      return;
    }

    event.preventDefault();
    if (inputDecision.kind === "block") {
      return;
    }
    applyCellEditSnapshotChange(
      view,
      cell,
      inputDecision.snapshot,
      write,
      scheduleTableLayout,
      event.inputType === "insertLineBreak" || event.inputType === "insertParagraph",
    );
  });

  wrapper.addEventListener("input", (event) => {
    const cell = findCell(event.target);
    if (!cell || cell.dataset.composing === "true") {
      // Composition text is provisional; it is written once on compositionend.
      return;
    }
    write(cell);
    scheduleTableLayout();
  });

  wrapper.addEventListener("focusout", (event) => {
    const cell = findCell(event.target);
    if (cell) {
      setTimeout(() => {
        if (
          wrapper.ownerDocument.documentElement.dataset
            .mlrtApplyingHostDocument === "true"
        ) {
          return;
        }
        if (cell.isConnected) {
          delete cell.dataset.composing;
          writeCellValue(view, wrapper, cell);
        }
      }, 0);
    }
  });

  wrapper.addEventListener("keydown", (event) => {
    const cell = findCell(event.target);
    if (!cell) {
      return;
    }

    // Enter accepts an IME candidate and arrow keys navigate candidate lists.
    // None of the table-level shortcuts may run until composition has ended.
    if (event.isComposing || event.key === "Process") {
      return;
    }

    const tableNavigationModifier = view.state.facet(
      tableNavigationModifierFacet,
    );
    if (keyboardBindingMatches(tableNavigationModifier, event)) {
      // The document-level tracker has already recorded the key in capture
      // phase. Keep its ordinary VS Code command from stealing focus while it
      // is acting as a held cell-navigation modifier.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const directCellDirection = tableCellArrowDirection(event.key);
    if (
      directCellDirection &&
      isTableNavigationModifierHeld(
        wrapper.ownerDocument,
        tableNavigationModifier,
        event,
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      const target = resolveAdjacentGridCell(
        cell,
        getRenderedTableModel(wrapper),
        directCellDirection,
      );
      if (!target) {
        // Grid arrows do not wrap. With no destination, preserve the current
        // caret or selection exactly as a standard directional no-op would.
        return;
      }
      commitCellEdit(view, wrapper, cell);
      focusCellAfterRender(view, wrapper, target);
      return;
    }

    const shortcuts = view.state.facet(tableShortcutsFacet);
    const insertion = (Object.keys(shortcuts) as (keyof TableShortcuts)[]).find(action => keyboardBindingMatches(shortcuts[action], event));
    if (insertion) {
      event.preventDefault();
      event.stopPropagation();
      if (view.state.readOnly) return;
      commitCellEdit(view, wrapper, cell);
      const table = getTableWidgetTable(wrapper);
      if (!table) return;
      const rowIndex = Number(cell.dataset.rowIndex ?? 0), column = Number(cell.dataset.column ?? 0);
      const header = cell.dataset.rowKind === "header";
      const rowAction = insertion === "insertRowBelow" || insertion === "insertRowAbove";
      const aboveHeader = header && insertion === "insertRowAbove";
      const nextRow = header ? 0 : rowIndex + (insertion === "insertRowBelow" ? 1 : 0);
      const nextColumn = column + (insertion === "insertColumnRight" ? 1 : 0);
      const change = aboveHeader ? prependTableHeaderRowEdit(table)
        : rowAction ? insertTableRowEdit(table, nextRow) : insertTableColumnEdit(table, nextColumn);
      if (change) applyTableMutation(view, table, change, () => focusCellAfterRender(view, wrapper, {
        rowKind: aboveHeader ? "header" : rowAction ? "body" : header ? "header" : "body",
        rowIndex: String(rowAction ? nextRow : rowIndex), column: String(rowAction ? column : nextColumn),
      }));
      return;
    }

    if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey &&
        wrapCellSelection(cell, event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const verticalArrow = isUnmodifiedVerticalArrow(event);
    const selectingVerticalArrow = isCellSelectionVerticalArrow(event);
    const horizontalArrow = isUnmodifiedHorizontalArrow(event);
    const selectingHorizontalArrow = isCellSelectionHorizontalArrow(event);
    // Let unhandled keys continue through the webview. VS Code's keyboard
    // command relay relies on that path for workbench commands such as Save,
    // Find, and user-defined keybindings. Stop propagation only when this
    // handler replaces the key's native behavior below.

    if (isMetaOnlyCellArrow(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        moveCellSelectionToLineBoundary(
          cell,
          event.key === "ArrowLeft" ? "start" : "end",
          event.shiftKey,
        );
      } else {
        const selection = getCellSelectionOffsets(cell);
        if (selection) {
          const target = event.key === "ArrowUp"
            ? 0
            : readCellDisplayValue(cell).length;
          setCellSelectionOffsets(
            cell,
            event.shiftKey ? selection.anchor : target,
            target,
          );
        }
      }
      return;
    }

    if (isModifiedCellArrow(event)) {
      const selection = getCellSelectionOffsets(cell);
      if (!selection) {
        return;
      }
      const valueLength = readCellDisplayValue(cell).length;
      const movingOutward =
        ((event.key === "ArrowLeft" || event.key === "ArrowUp") &&
          selection.head === 0) ||
        ((event.key === "ArrowRight" || event.key === "ArrowDown") &&
          selection.head === valueLength);
      if (movingOutward) {
        event.preventDefault();
        event.stopPropagation();
        if (selection.anchor !== selection.head && !event.shiftKey) {
          setCellCaretOffset(cell, selection.head);
        }
      }
      return;
    }

    if (isPrimaryModifiedCellHomeEnd(event)) {
      const selection = getCellSelectionOffsets(cell);
      if (!selection) {
        return;
      }
      const target = event.key === "Home"
        ? 0
        : readCellDisplayValue(cell).length;
      event.preventDefault();
      event.stopPropagation();
      setCellSelectionOffsets(
        cell,
        event.shiftKey ? selection.anchor : target,
        target,
      );
      return;
    }

    if (event.key === "Enter" && isPlainKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      const target = resolveVerticalCell(cell, 1);
      if (target === "after-table" || target === "before-table") exitCellToBoundary(view, wrapper, cell, "after");
      else {
        commitCellEdit(view, wrapper, cell);
        focusCellAfterRender(view, wrapper, target);
      }
      return;
    }

    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      if (!getCellSelectionOffsets(cell)) {
        focusCellAtEnd(cell, true);
      }
      const nextSnapshot = computeCellTextInsertionSnapshot(cell, "\n");
      if (!nextSnapshot) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyCellEditSnapshotChange(
        view,
        cell,
        nextSnapshot,
        write,
        scheduleTableLayout,
        true,
      );
      return;
    }

    if (selectingVerticalArrow) {
      event.preventDefault();
      event.stopPropagation();
      extendCellSelectionVertically(
        cell,
        event.key === "ArrowUp" ? -1 : 1,
      );
      return;
    }

    if (verticalArrow) {
      const rowDelta = event.key === "ArrowUp" ? -1 : 1;
      event.preventDefault();
      event.stopPropagation();
      const verticalMove = moveCellCaretVertically(cell, rowDelta);
      if (verticalMove.movedWithinCell) {
        return;
      }

      const target = resolveVerticalCell(cell, rowDelta);
      if (target === "before-table") {
        exitCellToBoundary(view, wrapper, cell, "before");
        return;
      }
      if (target === "after-table") {
        exitCellToBoundary(view, wrapper, cell, "after");
        return;
      }

      commitCellEdit(view, wrapper, cell);
      focusCellAfterRender(view, wrapper, target, {
        rowDelta,
        preferredX: verticalMove.preferredX,
      });
      return;
    }

    if (selectingHorizontalArrow) {
      const selection = getCellSelectionOffsets(cell);
      const valueLength = readCellDisplayValue(cell).length;
      const extendingPastCell = Boolean(
        selection &&
          ((event.key === "ArrowLeft" && selection.head === 0) ||
            (event.key === "ArrowRight" && selection.head === valueLength)),
      );
      if (extendingPastCell) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (horizontalArrow) {
      const selection = getCellSelectionOffsets(cell);
      const valueLength = readCellDisplayValue(cell).length;
      const movingAcrossBoundary = Boolean(
        selection &&
          selection.anchor === selection.head &&
          ((event.key === "ArrowLeft" && selection.head === 0) ||
            (event.key === "ArrowRight" && selection.head === valueLength)),
      );
      if (movingAcrossBoundary) {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        const target = resolveRelativeCell(cell, delta);
        if (target === "before-table") {
          exitCellToBoundary(view, wrapper, cell, "before");
          return;
        }
        if (target === "after-table") {
          exitCellToBoundary(view, wrapper, cell, "after");
          return;
        }
        commitCellEdit(view, wrapper, cell);
        focusCellAfterRender(
          view,
          wrapper,
          target,
          undefined,
          event.key === "ArrowRight" ? "start" : "end",
        );
        return;
      }
    }

    if (
      event.key === "Tab" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      const target = resolveRelativeCell(cell, event.shiftKey ? -1 : 1);
      if (target === "before-table") {
        exitCellToBoundary(view, wrapper, cell, "before");
        return;
      }
      if (target === "after-table") {
        exitCellToBoundary(view, wrapper, cell, "after");
        return;
      }
      commitCellEdit(view, wrapper, cell);
      focusCellAfterRender(view, wrapper, target);
    }
  });

}

function resolveAdjacentGridCell(
  cell: HTMLElement,
  table: ParsedTable | undefined,
  direction: TableCellArrowDirection,
): CellTarget | null {
  const rowKind = cell.dataset.rowKind;
  const rowIndex = Number(cell.dataset.rowIndex ?? "0");
  const column = Number(cell.dataset.column ?? "0");
  if (
    !table ||
    (rowKind !== "header" && rowKind !== "body") ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    !Number.isInteger(column) ||
    column < 0
  ) {
    return null;
  }

  const target = adjacentTableCell(
    { row: rowKind === "header" ? 0 : rowIndex + 1, column },
    direction,
    { rowCount: table.body.length + 1, columnCount: table.columnCount },
  );
  if (!target) {
    return null;
  }
  return {
    rowKind: target.row === 0 ? "header" : "body",
    rowIndex: String(target.row === 0 ? 0 : target.row - 1),
    column: String(target.column),
  };
}

function tableCellArrowDirection(
  key: string,
): TableCellArrowDirection | null {
  if (key === "ArrowUp") {
    return "up";
  }
  if (key === "ArrowDown") {
    return "down";
  }
  if (key === "ArrowLeft") {
    return "left";
  }
  return key === "ArrowRight" ? "right" : null;
}

/**
 * Saves anything the cell shows that the live write path has not stored yet
 * (normally nothing: every keystroke is written as it happens).
 */
function commitCellEdit(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
): void {
  delete cell.dataset.composing;
  writeCellValue(view, wrapper, cell);
}

/**
 * A write normally patches the mounted widget in place. If the widget had to
 * be rebuilt instead, move focus to the same cell of the new DOM.
 */
function restoreFocusAfterWrite(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
  caretOffset: number,
): void {
  if (cell.isConnected && cell.ownerDocument.activeElement === cell) {
    return;
  }
  const target = {
    rowKind: cell.dataset.rowKind ?? "body",
    rowIndex: cell.dataset.rowIndex ?? "0",
    column: cell.dataset.column ?? "0",
  };
  const replacement = queryCellInTable(view, wrapper, target);
  if (!replacement || replacement === cell) {
    return;
  }
  replacement.focus({ preventScroll: true });
  setCellCaretOffset(replacement, caretOffset);
}

function resolveRelativeCell(
  cell: HTMLElement,
  delta: number,
): VerticalCellTarget {
  const cells = Array.from(
    cell
      .closest(".mlrt-table")
      ?.querySelectorAll<HTMLElement>(TABLE_CELL_SELECTOR) ?? [],
  );
  const index = cells.indexOf(cell);
  const next = cells[index + delta];
  if (!next) {
    return delta < 0 ? "before-table" : "after-table";
  }
  return {
    rowKind: next.dataset.rowKind ?? "body",
    rowIndex: next.dataset.rowIndex ?? "0",
    column: next.dataset.column ?? "0",
  };
}

function resolveVerticalCell(
  cell: HTMLElement,
  rowDelta: -1 | 1,
): VerticalCellTarget {
  const column = cell.dataset.column ?? "0";
  const columnCells = Array.from(
    cell
      .closest(".mlrt-table")
      ?.querySelectorAll<HTMLElement>(
        `${TABLE_CELL_SELECTOR}[data-column="${column}"]`,
      ) ?? [],
  );
  const index = columnCells.indexOf(cell);
  const next = columnCells[index + rowDelta];
  if (!next) {
    return rowDelta < 0 ? "before-table" : "after-table";
  }

  return {
    rowKind: next.dataset.rowKind ?? "body",
    rowIndex: next.dataset.rowIndex ?? "0",
    column: next.dataset.column ?? "0",
  };
}

function focusCellAfterRender(
  view: EditorView,
  wrapper: HTMLElement,
  target: CellTarget,
  vertical?: { rowDelta: -1 | 1; preferredX: number | null },
  horizontalPlacement: "start" | "end" = "end",
): void {
  // CodeMirror dispatch is synchronous. A missing destination must not leave
  // behind a delayed focus write that can override a later user action.
  const cell = queryCellInTable(view, wrapper, target);
  if (!cell) {
    return;
  }

  if (vertical) {
    focusCellAtVerticalEdge(
      cell,
      vertical.rowDelta,
      vertical.preferredX,
    );
  } else if (horizontalPlacement === "start") {
    focusCellAtStart(cell);
  } else {
    focusCellAtEnd(cell);
  }
}

function exitCellToBoundary(
  view: EditorView,
  wrapper: HTMLElement,
  cell: HTMLElement,
  side: "before" | "after",
): void {
  commitCellEdit(view, wrapper, cell);
  const table = getTableWidgetTable(currentWrapper(view, wrapper));
  cell.blur();
  view.focus();
  if (table) {
    selectVisibleTableBoundary(view, table, side);
  }
}

/**
 * The widget root for this table: the same element unless a structural edit
 * rebuilt it, in which case the replacement is found by stable table id.
 */
function currentWrapper(view: EditorView, wrapper: HTMLElement): HTMLElement {
  if (wrapper.isConnected) {
    return wrapper;
  }
  const id = getTableWidgetId(wrapper);
  return (id === undefined ? null : findTableWidgetById(view, id)) ?? wrapper;
}

function queryCellInTable(
  view: EditorView,
  wrapper: HTMLElement,
  target: CellTarget,
): HTMLElement | null {
  return currentWrapper(view, wrapper).querySelector<HTMLElement>(
    [
      `${TABLE_CELL_SELECTOR}[data-row-kind="${target.rowKind}"]`,
      `[data-row-index="${target.rowIndex}"]`,
      `[data-column="${target.column}"]`,
    ].join(""),
  );
}

/**
 * Converts Chromium's platform-native target range to display-text offsets.
 * A non-empty range that crosses a cell boundary is reported as unsafe so the
 * pure input decision blocks it instead of allowing the browser to merge DOM
 * cells or rows.
 */
function getCellInputTargetSelection(
  cell: HTMLElement,
  event: InputEvent,
): CellTextSelection | null | undefined {
  let ranges: StaticRange[];
  try {
    ranges = event.getTargetRanges();
  } catch {
    return undefined;
  }
  if (ranges.length === 0) {
    return undefined;
  }
  if (ranges.length !== 1) {
    return null;
  }

  const [range] = ranges;
  if (
    !isNodeInsideCell(range.startContainer, cell) ||
    !isNodeInsideCell(range.endContainer, cell)
  ) {
    return null;
  }

  try {
    return {
      anchor: getCellDomPointOffset(
        cell,
        range.startContainer,
        range.startOffset,
      ),
      head: getCellDomPointOffset(
        cell,
        range.endContainer,
        range.endOffset,
      ),
    };
  } catch {
    return null;
  }
}

function getCellInputData(event: InputEvent): string | null {
  if (
    event.inputType === "insertFromPaste" ||
    event.inputType === "insertFromPasteAsQuotation" ||
    event.inputType === "insertFromDrop" ||
    event.inputType === "insertReplacementText" ||
    event.inputType === "insertFromYank" ||
    event.inputType === "insertTranspose"
  ) {
    const transferred = event.dataTransfer?.getData("text/plain");
    // Chromium can expose the transfer object while keeping its plain-text
    // slot empty for replacement-style events. Preserve a populated `data`
    // fallback instead of accidentally turning that replacement into delete.
    return transferred || event.data || null;
  }
  return event.data;
}

function getCellDomPointOffset(
  cell: HTMLElement,
  node: Node,
  offset: number,
): number {
  const range = cell.ownerDocument.createRange();
  range.selectNodeContents(cell);
  range.setEnd(node, offset);
  const measured = range.toString().replace(/ /g, " ").length;
  range.detach();
  return measured;
}

function isNodeInsideCell(node: Node, cell: HTMLElement): boolean {
  return node === cell || cell.contains(node);
}

function computeCellTextInsertionSnapshot(
  cell: HTMLElement,
  insert: string,
): CellEditSnapshot | null {
  const selection = getCellSelectionOffsets(cell);
  if (!selection) {
    return null;
  }

  const value = readCellDisplayValue(cell);
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  return {
    value: `${value.slice(0, from)}${insert}${value.slice(to)}`,
    caretOffset: from + insert.length,
  };
}

function applyCellEditSnapshotChange(
  view: EditorView,
  cell: HTMLElement,
  snapshot: CellEditSnapshot,
  write: (cell: HTMLElement, scrollSnapshot?: StateEffect<unknown>) => void,
  scheduleTableLayout: () => void,
  preserveScroll = false,
): void {
  // Capture before changing the DOM: a taller table must not make CodeMirror
  // anchor to the document bottom or reveal its inactive source selection.
  const scrollSnapshot = preserveScroll ? view.scrollSnapshot() : undefined;
  const top = view.scrollDOM.scrollTop, left = view.scrollDOM.scrollLeft;
  setCellPlainText(cell, snapshot.value);
  setCellCaretOffset(cell, snapshot.caretOffset);
  write(cell, scrollSnapshot);
  scheduleTableLayout();
  if (preserveScroll) {
    view.scrollDOM.scrollTop = top;
    view.scrollDOM.scrollLeft = left;
  }
}

function isPlainKey(event: KeyboardEvent): boolean {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function isUnmodifiedVerticalArrow(event: KeyboardEvent): boolean {
  return (
    (event.key === "ArrowUp" || event.key === "ArrowDown") && isPlainKey(event)
  );
}

function isUnmodifiedHorizontalArrow(event: KeyboardEvent): boolean {
  return (
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    isPlainKey(event)
  );
}

function isModifiedCellArrow(event: KeyboardEvent): boolean {
  return (
    (event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight") &&
    (event.altKey || event.ctrlKey || event.metaKey)
  );
}

function isMetaOnlyCellArrow(event: KeyboardEvent): boolean {
  return (
    (event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight") &&
    event.metaKey &&
    !event.altKey &&
    !event.ctrlKey
  );
}

function isPrimaryModifiedCellHomeEnd(event: KeyboardEvent): boolean {
  return (
    (event.key === "Home" || event.key === "End") &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey
  );
}

function isCellSelectionVerticalArrow(event: KeyboardEvent): boolean {
  return (
    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

function isCellSelectionHorizontalArrow(event: KeyboardEvent): boolean {
  return (
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}
