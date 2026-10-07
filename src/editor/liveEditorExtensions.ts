import { history } from "@codemirror/commands";
import { Compartment, Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import {
  createTableSourceChangeFilter,
  createTableSourceSelectionGuard,
} from "../shared/tableSourceProtection";
import {
  TableNavigationModifierKey,
} from "../shared/tableKeyboardNavigation";
import { createEditorGeometrySync } from "./editorGeometrySync";
import { createEditorTheme } from "./editorTheme";
import {
  createMarkdownRenderingExtensions,
  markdownRenderingCompartment,
  MarkdownRenderingOptions,
} from "./markdown/markdownRendering";
import { createDocumentSelectionInputHandler } from "./documentClipboard";
import { createDocumentSelectionDecorations } from "./documentSelectionDecorations";
import { TABLE_CELL_SELECTOR } from "./table/cellSelection";
import { createTableBoundaryArrowNavigation } from "./tableBoundaryNavigation";
import { createTableBoundaryInputHandler } from "./tableBoundaryInput";
import { createTableCellFocusClassSync } from "./tableCellFocus";
import { createTableDecorations } from "./tableDecorations";
import { createTableHeightEstimateMetrics } from "./table/tableHeightEstimate";
import {
  createTableNavigationKeyTracker,
  tableNavigationModifierCompartment,
  tableNavigationModifierFacet,
} from "./tableNavigation";

export interface LiveEditorOptions {
  lineWrapping: boolean;
  lineHighlight?: boolean;
  tableNavigationModifierKey: TableNavigationModifierKey;
  markdownRendering?: MarkdownRenderingOptions;
}

export const lineWrappingCompartment = new Compartment();
export const lineHighlightCompartment = new Compartment();

export function createLineHighlightAttributes(enabled: boolean): Extension {
  return EditorView.editorAttributes.of({
    class: enabled ? "mlrt-line-highlight-enabled" : "",
  });
}

/**
 * Assembles the complete CodeMirror extension set for the live markdown
 * editor:
 *
 * - VS Code-parity theme, line numbers, and active-line highlighting,
 * - rendered table widgets with source-line hiding and gutter suppression,
 * - protection that keeps the cursor and direct edits out of hidden table
 *   source (cell edits go through annotated transactions instead),
 * - geometry sync for table wrapping width and gutter alignment,
 * - arrow-key navigation across the source/table boundary.
 */
export function createLiveEditorExtensions(
  options: LiveEditorOptions,
): Extension[] {
  const tableHeightEstimateMetrics = createTableHeightEstimateMetrics();
  return [
    // Keep CodeMirror history mapping available; the webview command bridge
    // routes undo/redo through the authoritative VS Code document history.
    history(),
    createEditorTheme(),
    lineHighlightCompartment.of(createLineHighlightAttributes(options.lineHighlight ?? false)),
    createTableBoundaryArrowNavigation(),
    createTableBoundaryInputHandler(),
    createDocumentSelectionInputHandler(),
    drawSelection(),
    createDocumentSelectionDecorations(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    lineNumbers(),
    createEditorGeometrySync(tableHeightEstimateMetrics),
    createTableCellFocusClassSync(),
    createTableNavigationKeyTracker(),
    createTableSourceChangeFilter(),
    createTableSourceSelectionGuard({
      tableCellSelector: TABLE_CELL_SELECTOR,
    }),
    markdownRenderingCompartment.of(createMarkdownRenderingExtensions(
      options.markdownRendering ?? { enabled: true, screenReaderOptimized: false, readOnly: false },
    )),
    lineWrappingCompartment.of(
      options.lineWrapping ? EditorView.lineWrapping : [],
    ),
    tableNavigationModifierCompartment.of(
      tableNavigationModifierFacet.of(options.tableNavigationModifierKey),
    ),
    createTableDecorations(tableHeightEstimateMetrics),
  ];
}
