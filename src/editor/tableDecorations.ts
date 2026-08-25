import {
  Extension,
  StateField,
  Text,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";
import { getParsedTables } from "../shared/tableModel";
import { tableCellLiveEditAnnotation } from "./tableEditAnnotations";
import { RenderedTableWidget } from "./table/TableWidget";
import {
  createTableHeightEstimateMetrics,
  TableHeightEstimateMetrics,
} from "./table/tableHeightEstimate";

/**
 * Replaces each complete Markdown table source range with one rendered block.
 *
 * This must be a real block replacement rather than a zero-length widget plus
 * CSS-hidden source lines. CodeMirror's height map and virtual gutter are
 * driven by document blocks. Collapsing individual lines with `display:none`
 * leaves those lines in that model and, after enough scrolling, can cause a
 * later table widget to be mounted ahead of earlier prose gutter rows. A
 * replacement range gives CodeMirror one source-ordered, height-aware block
 * for the table and removes the replaced lines from the native gutter by
 * construction.
 *
 * Live cell edits (annotated transactions) map the existing sets through the
 * change instead of rebuilding, which keeps the mounted widget DOM stable
 * while typing.
 */
export function createTableDecorations(
  heightEstimateMetrics: TableHeightEstimateMetrics =
    createTableHeightEstimateMetrics(),
): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildTableDecorations(state.doc, heightEstimateMetrics);
    },
    update(value, transaction) {
      if (!transaction.docChanged) {
        return value;
      }
      if (transaction.annotation(tableCellLiveEditAnnotation)) {
        return value.map(transaction.changes);
      }
      return buildTableDecorations(
        transaction.state.doc,
        heightEstimateMetrics,
      );
    },
    provide(field) {
      return [
        EditorView.decorations.from(field),
        EditorView.atomicRanges.of((view) => view.state.field(field)),
      ];
    },
  });

  return field;
}

function buildTableDecorations(
  doc: Text,
  heightEstimateMetrics: TableHeightEstimateMetrics,
): DecorationSet {
  return Decoration.set(
    getParsedTables(doc).map((table) =>
      Decoration.replace({
        widget: new RenderedTableWidget(table, heightEstimateMetrics),
        block: true,
      }).range(table.from, table.to),
    ),
    true,
  );
}
