import { Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { findCell } from "./table/cellSelection";
import {
  getTableRangeSelection,
  TABLE_SELECTION_CHANGE_EVENT,
} from "./table/tableRangeSelection";

export const TABLE_CELL_FOCUSED_CLASS = "mlrt-table-cell-focused";
export const SELECTION_ACTIVE_CLASS = "mlrt-selection-active";
export const EMPTY_LINE_CURSOR_CLASS = "mlrt-empty-line-cursor";
export const PROSE_CURSOR_FOCUSED_CLASS = "mlrt-prose-cursor-focused";

/**
 * Single owner of the editor-root classes derived from focus and selection
 * state. Keeping those visual states in CodeMirror state avoids CSS selectors
 * that infer cursor state from browser-generated DOM, which can vary between
 * Electron/Chromium versions and operating systems.
 *
 * Syncing is deferred to a microtask so focus changes settle before the
 * class is read/written (focusout fires before the next element focuses).
 */
export function createTableCellFocusClassSync(): Extension {
  return ViewPlugin.fromClass(
    class {
      public decorations: DecorationSet;
      private readonly syncFocusClass: () => void;
      private readonly restoreClickFocus: (event: MouseEvent) => void;
      private recheckScheduled = false;
      private focusRepairTimer: number | undefined;
      private focusRepairFrame: number | undefined;
      private clickGeneration = 0;
      private readonly cancelClickRepair = (): void => {
        this.clickGeneration++;
        const win = this.view.dom.ownerDocument.defaultView;
        win?.clearTimeout(this.focusRepairTimer);
        if (this.focusRepairFrame !== undefined) win?.cancelAnimationFrame(this.focusRepairFrame);
      };

      public constructor(private readonly view: EditorView) {
        this.decorations = createProseActiveLineDecoration(view);
        this.syncFocusClass = () => this.sync();
        const doc = view.dom.ownerDocument;
        this.restoreClickFocus = (event) => {
          const target = event.target as Element | null;
          if (event.button !== 0 || !target?.closest ||
              !target.closest(".cm-line, .cm-content, .cm-scroller, .mlrt-table-cell") ||
              target.closest('button, a, input, textarea, select, .mlrt-clipboard-menu, .mlrt-table-structure-menu')) return;
          const cell = findCell(target);
          if (!cell && target.closest('.mlrt-table-widget, [contenteditable="false"]')) return;
          const generation = ++this.clickGeneration;
          const win = doc.defaultView;
          // Electron can activate the webview after click's microtask, or briefly
          // blur its editable during activation. Repair after both boundaries.
          // A newer gesture or a different focused control cancels the handoff.
          const repair = (): void => {
            if (generation !== this.clickGeneration || !view.dom.isConnected || !doc.hasFocus()) return;
            const active = doc.activeElement;
            if (active !== doc.body && active !== doc.documentElement && active !== view.contentDOM && active !== cell) return;
            if (cell?.isConnected) cell.focus({ preventScroll: true });
            else view.focus();
            this.sync();
          };
          queueMicrotask(repair);
          this.focusRepairFrame = win?.requestAnimationFrame(repair);
          this.focusRepairTimer = win?.setTimeout(repair, 80);
        };
        view.dom.addEventListener("click", this.restoreClickFocus);
        doc.addEventListener("pointerdown", this.cancelClickRepair, true);
        doc.addEventListener("keydown", this.cancelClickRepair, true);
        doc.defaultView?.addEventListener("focus", this.syncFocusClass);
        doc.defaultView?.addEventListener("blur", this.syncFocusClass);
        doc.addEventListener("focusin", this.syncFocusClass, true);
        doc.addEventListener("focusout", this.syncFocusClass, true);
        doc.addEventListener(
          TABLE_SELECTION_CHANGE_EVENT,
          this.syncFocusClass,
          true,
        );
        this.sync();
      }

      public update(update: ViewUpdate): void {
        if (update.selectionSet || update.docChanged) {
          this.decorations = createProseActiveLineDecoration(update.view);
        }
        if (update.focusChanged || update.selectionSet || update.docChanged) {
          this.sync();
        }
      }

      public destroy(): void {
        const doc = this.view.dom.ownerDocument;
        this.view.dom.removeEventListener("click", this.restoreClickFocus);
        this.cancelClickRepair();
        doc.removeEventListener("pointerdown", this.cancelClickRepair, true);
        doc.removeEventListener("keydown", this.cancelClickRepair, true);
        doc.defaultView?.removeEventListener("focus", this.syncFocusClass);
        doc.defaultView?.removeEventListener("blur", this.syncFocusClass);
        doc.removeEventListener("focusin", this.syncFocusClass, true);
        doc.removeEventListener("focusout", this.syncFocusClass, true);
        doc.removeEventListener(
          TABLE_SELECTION_CHANGE_EVENT,
          this.syncFocusClass,
          true,
        );
      }

      private sync(): void {
        queueMicrotask(() => {
          const ownerDocument = this.view.dom.ownerDocument;
          const hasTableCellFocus = Boolean(
            findCell(ownerDocument.activeElement),
          );
          if (
            !hasTableCellFocus &&
            ownerDocument.documentElement.dataset.mlrtApplyingHostDocument ===
              "true"
          ) {
            // A host document apply blurs the cell briefly and refocuses it
            // right after rendering. Keep the class on for now so the editor
            // cursor and active-line highlight do not flash between undo
            // steps, then re-check once the apply window has passed.
            this.scheduleRecheck();
            return;
          }
          this.view.dom.classList.toggle(
            TABLE_CELL_FOCUSED_CLASS,
            hasTableCellFocus,
          );
          this.view.dom.classList.toggle(
            SELECTION_ACTIVE_CLASS,
            !this.view.state.selection.main.empty ||
              Boolean(getTableRangeSelection(ownerDocument)),
          );
          const mainSelection = this.view.state.selection.main;
          const proseCursorFocused =
            ownerDocument.activeElement === this.view.contentDOM &&
            mainSelection.empty;
          this.view.dom.classList.toggle(
            EMPTY_LINE_CURSOR_CLASS,
            mainSelection.empty &&
              this.view.state.doc.lineAt(mainSelection.head).length === 0,
          );
          this.view.dom.classList.toggle(
            PROSE_CURSOR_FOCUSED_CLASS,
            proseCursorFocused,
          );
        });
      }

      private scheduleRecheck(): void {
        if (this.recheckScheduled) {
          return;
        }
        this.recheckScheduled = true;
        const ownerWindow = this.view.dom.ownerDocument.defaultView;
        const raf = ownerWindow
          ? ownerWindow.requestAnimationFrame.bind(ownerWindow)
          : requestAnimationFrame;
        raf(() => {
          raf(() => {
            this.recheckScheduled = false;
            this.sync();
          });
        });
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

/**
 * Own active-line marker derived directly from the editor state. CodeMirror's
 * built-in marker remains enabled, but prose highlighting no longer depends
 * on that separate plugin producing `.cm-activeLine` in a particular host.
 */
function createProseActiveLineDecoration(view: EditorView): DecorationSet {
  const mainSelection = view.state.selection.main;
  if (!mainSelection.empty) {
    return Decoration.none;
  }
  const line = view.state.doc.lineAt(mainSelection.head);
  return Decoration.set([
    Decoration.line({ class: "mlrt-prose-active-line" }).range(line.from),
  ]);
}
