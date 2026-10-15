import { EditorView } from "@codemirror/view";
import { markdownRenderingOptionsFacet } from "../markdown/markdownRendering";
import { findCell, getCellSelectionOffsets, readCellDisplayValue, setCellPlainText, setCellPreviewSourceRange, setCellSelectionOffsets } from "./cellSelection";
import { markdownCellPresentation } from "./markdownCellPresentation";

export function tableCellPreviewEnabled(view: EditorView): boolean {
  const options = view.state.facet(markdownRenderingOptionsFacet);
  return options.enabled && !options.screenReaderOptimized;
}

export function presentTableCell(cell: HTMLElement, value: string, enabled: boolean): void {
  if (!enabled) { setCellPlainText(cell, value); return; }
  if (cell.dataset.markdownPreview === "true" && cell.dataset.previewValue === value) return;
  const runs = markdownCellPresentation(value);
  if (runs.every(run => !run.className) && runs.map(run => run.text).join("") === value) {
    setCellPlainText(cell, value);
    return;
  }
  const doc = cell.ownerDocument, fragment = doc.createDocumentFragment();
  for (const run of runs) {
    const text = doc.createTextNode(run.text);
    setCellPreviewSourceRange(text, { from: run.from, to: run.to });
    if (run.className) {
      const span = doc.createElement("span"); span.className = run.className; span.append(text); fragment.append(span);
    } else fragment.append(text);
  }
  if (!fragment.childNodes.length) fragment.append(doc.createElement("br"));
  cell.replaceChildren(fragment);
  cell.dataset.previewValue = value;
  cell.dataset.markdownPreview = "true";
}

/** Always restore the exact editable value before native input/history reads.
 * Inactive DOM formatting must never be mistaken for a source mutation. */
export function revealTableCell(cell: HTMLElement): void {
  if (cell.dataset.markdownPreview !== "true") return;
  const selection = getCellSelectionOffsets(cell);
  const value = readCellDisplayValue(cell);
  setCellPlainText(cell, value);
  if (selection) setCellSelectionOffsets(cell, selection.anchor, selection.head);
}

export function bindTableCellPresentation(wrapper: HTMLElement, view: EditorView, scheduleLayout: () => void): () => void {
  let pointerCell: HTMLElement | null = null;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  const doc = wrapper.ownerDocument;
  const finishPointer = (): void => {
    const cell = pointerCell; pointerCell = null;
    doc.removeEventListener("pointerup", finishPointer, true);
    doc.removeEventListener("pointercancel", finishPointer, true);
    // Let Chromium finish click/drag selection against the rendered glyphs.
    // Map both native endpoints back to source before revealing delimiters.
    revealTimer = setTimeout(() => {
      if (cell?.isConnected && doc.activeElement === cell) { revealTableCell(cell); scheduleLayout(); }
    }, 0);
  };
  wrapper.addEventListener("pointerdown", event => {
    const cell = findCell(event.target);
    if (!cell || event.button !== 0 || event.shiftKey || cell.dataset.markdownPreview !== "true") return;
    pointerCell = cell;
    doc.addEventListener("pointerup", finishPointer, true);
    doc.addEventListener("pointercancel", finishPointer, true);
  }, true);
  wrapper.addEventListener("focusin", event => {
    const cell = findCell(event.target);
    if (cell && pointerCell !== cell) revealTableCell(cell);
  }, true);
  const beforeInput = (event: Event): void => {
    const cell = findCell(event.target);
    if (cell) revealTableCell(cell);
  };
  wrapper.addEventListener("keydown", beforeInput, true);
  wrapper.addEventListener("beforeinput", beforeInput, true);
  wrapper.addEventListener("focusout", event => {
    const cell = findCell(event.target);
    if (!cell) return;
    // The editing owner commits before this presentation-only task executes.
    setTimeout(() => {
      if (!cell.isConnected || cell.ownerDocument.activeElement === cell) return;
      const selection = doc.defaultView?.getSelection();
      if (selection && !selection.isCollapsed && cell.contains(selection.anchorNode) && cell.contains(selection.focusNode)) return;
      presentTableCell(cell, readCellDisplayValue(cell), tableCellPreviewEnabled(view));
      scheduleLayout();
    }, 0);
  });
  return () => {
    clearTimeout(revealTimer);
    doc.removeEventListener("pointerup", finishPointer, true);
    doc.removeEventListener("pointercancel", finishPointer, true);
  };
}
