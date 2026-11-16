import { Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { findController, OpenFindOptions } from "./findController";
import { FindConfig, findConfig, FindHighlightNames, findStateField } from "./findState";

export type { FindConfig } from "./findState";
export type { OpenFindOptions } from "./findController";

/**
 * Find and replace for the live editor.
 *
 * Nothing in this folder knows which application hosts the editor. The host
 * supplies an element for the widget and may call the functions below; the
 * editor's own shortcuts work without it.
 */
let instances = 0;

export function createFindExtension(config: FindConfig): Extension {
  const id = ++instances;
  const highlightNames: FindHighlightNames = { match: `mlrt-find-${id}`, current: `mlrt-find-current-${id}` };
  const match = `.mlrt-table-cell::highlight(${highlightNames.match})`;
  const current = `.mlrt-table-cell::highlight(${highlightNames.current})`;
  return [
    findConfig.of({ ...config, highlightNames }),
    findStateField,
    findController,
    // The fill of a match inside a table cell. The names are this editor's
    // own, so the rules are generated here, not kept in the shared stylesheet.
    EditorView.theme({
      [match]: { backgroundColor: "var(--mlrt-find-match-fill)" },
      [current]: { backgroundColor: "var(--mlrt-find-current-fill)" },
      "@media (forced-colors: active)": {
        [match]: { backgroundColor: "transparent" },
        [current]: { backgroundColor: "transparent" },
      },
    }),
    // Escape closes the widget from prose only when nothing else wanted the key.
    Prec.lowest(keymap.of([{ key: "Escape", run: closeFind }])),
  ];
}

export function openFind(view: EditorView, options: OpenFindOptions = {}): void {
  view.plugin(findController)?.open(options);
}

export function closeFind(view: EditorView): boolean {
  return view.plugin(findController)?.close() ?? false;
}

export function findNext(view: EditorView): boolean {
  return view.plugin(findController)?.step(true) ?? false;
}

export function findPrevious(view: EditorView): boolean {
  return view.plugin(findController)?.step(false) ?? false;
}

export function replaceCurrentMatch(view: EditorView): boolean {
  return view.plugin(findController)?.replace() ?? false;
}

export function replaceAllMatches(view: EditorView): boolean {
  return view.plugin(findController)?.replaceAll() ?? false;
}
