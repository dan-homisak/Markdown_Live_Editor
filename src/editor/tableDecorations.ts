import {
  Extension,
  EditorState,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";
import { RenderedTableWidget } from "./table/TableWidget";
import {
  getTrackedTables,
  tableRenderGeneration,
  tableResyncEffect,
  tableTrackingField,
} from "./table/tableTracking";
import { markdownListField, markdownListRangeHidden } from "./markdown/markdownListStructure";
import { markdownRenderingOptionsFacet } from "./markdown/markdownRendering";
import { tableCellPreviewEnabledForState } from "./table/tableCellPresentation";
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
 * Source integrity: the decoration set is rebuilt from the tracked tables of
 * the *current* document on every document change, including keystrokes in a
 * cell. Widgets are never carried forward by position mapping, because a
 * mapped widget keeps the parse it was created with: remounting it after a
 * scroll, or editing another table while it is mounted, would then compute
 * source edits from offsets that no longer exist. Widget equality is exact
 * source identity, so unchanged tables keep their DOM untouched, tables that
 * merely moved get their source metadata patched in place, and only edited
 * tables re-render their changed cells.
 */
export function createTableDecorations(
  heightEstimateMetrics: TableHeightEstimateMetrics =
    createTableHeightEstimateMetrics(),
): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildTableDecorations(state, heightEstimateMetrics);
    },
    update(value, transaction) {
      const hidden = transaction.state.field(markdownListField, false)?.hidden ?? [];
      const previous = transaction.startState.field(markdownListField, false)?.hidden ?? [];
      const foldsChanged = hidden.length !== previous.length || hidden.some((range, index) =>
        range.from !== transaction.changes.mapPos(previous[index].from) || range.to !== transaction.changes.mapPos(previous[index].to));
      const options = transaction.state.facet(markdownRenderingOptionsFacet), previousOptions = transaction.startState.facet(markdownRenderingOptionsFacet);
      const presentationChanged = options.enabled !== previousOptions.enabled || options.screenReaderOptimized !== previousOptions.screenReaderOptimized;
      const resync = transaction.effects.some((effect) => effect.is(tableResyncEffect));
      if (!transaction.docChanged && !foldsChanged && !presentationChanged && !resync) {
        return value;
      }
      return buildTableDecorations(
        transaction.state,
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

  return [tableTrackingField, field];
}

function buildTableDecorations(
  state: EditorState,
  heightEstimateMetrics: TableHeightEstimateMetrics,
): DecorationSet {
  const preview = tableCellPreviewEnabledForState(state);
  const generation = tableRenderGeneration(state);
  return Decoration.set(
    getTrackedTables(state).filter(({ table }) => !markdownListRangeHidden(state, table)).map(({ id, table }) =>
      Decoration.replace({
        widget: new RenderedTableWidget(table, id, heightEstimateMetrics, preview, generation),
        block: true,
      }).range(table.from, table.to),
    ),
    true,
  );
}
