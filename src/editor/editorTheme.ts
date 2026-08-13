import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * CodeMirror theme that mirrors the stock VS Code editor: fonts, gutter
 * geometry, active-line and cursor colors all come from the VS Code webview
 * CSS variables plus the per-document metrics injected by the host.
 *
 * Gutter geometry is expressed with the same custom properties the rendered
 * table uses for its own line-number column, so the two stay aligned by
 * construction. Keep this in sync with media/liveEditor.css.
 */
export function createEditorTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      color: "var(--vscode-editor-foreground, #d4d4d4)",
      backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
    },
    ".cm-scroller": {
      overflowX: "hidden !important",
      overflowY: "auto !important",
      height: "100%",
      fontFamily:
        "var(--mlrt-editor-font-family, var(--vscode-editor-font-family, monospace))",
      fontSize:
        "var(--mlrt-editor-font-size, var(--vscode-editor-font-size, 13px))",
      fontWeight: "var(--mlrt-editor-font-weight, normal)",
      lineHeight: "var(--mlrt-editor-line-height, normal)",
      letterSpacing: "var(--mlrt-editor-letter-spacing, normal)",
      fontFeatureSettings: "var(--mlrt-editor-font-feature-settings, normal)",
      fontVariationSettings:
        "var(--mlrt-editor-font-variation-settings, normal)",
    },
    ".cm-gutters": {
      backgroundColor:
        "var(--vscode-editorGutter-background, var(--vscode-editor-background, #1e1e1e))",
      color: "var(--vscode-editorLineNumber-foreground, #858585)",
      borderRight: "none",
      boxSizing: "border-box",
      paddingLeft: "var(--mlrt-editor-gutter-left-padding, 2.5ch)",
      fontFamily:
        "var(--mlrt-editor-font-family, var(--vscode-editor-font-family, monospace))",
      fontSize:
        "var(--mlrt-editor-font-size, var(--vscode-editor-font-size, 13px))",
      fontWeight: "var(--mlrt-editor-font-weight, normal)",
      lineHeight: "var(--mlrt-editor-line-height, normal)",
      letterSpacing: "var(--mlrt-editor-letter-spacing, normal)",
      fontFeatureSettings: "var(--mlrt-editor-font-feature-settings, normal)",
      fontVariationSettings:
        "var(--mlrt-editor-font-variation-settings, normal)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--vscode-editorLineNumber-activeForeground, #c6c6c6)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      boxSizing: "border-box",
      width:
        "calc(var(--mlrt-editor-line-number-width, 3ch) + var(--mlrt-editor-gutter-right-padding, 26px))",
      minHeight: "var(--mlrt-editor-line-height, 1.5em)",
      minWidth:
        "calc(var(--mlrt-editor-line-number-width, 3ch) + var(--mlrt-editor-gutter-right-padding, 26px))",
      maxWidth:
        "calc(var(--mlrt-editor-line-number-width, 3ch) + var(--mlrt-editor-gutter-right-padding, 26px))",
      padding: "0 var(--mlrt-editor-gutter-right-padding, 26px) 0 0",
    },
    '.cm-lineNumbers .cm-gutterElement[style*="visibility: hidden"]': {
      minHeight: "0",
    },
    ".cm-content": {
      minHeight: "100%",
      boxSizing: "border-box",
      padding:
        "var(--mlrt-editor-top-padding, 0px) var(--mlrt-editor-right-padding, var(--mlrt-editor-gutter-right-padding, 26px)) calc(var(--mlrt-editor-bottom-padding, 0px) + var(--mlrt-editor-scroll-beyond-last-line, 0px)) 0",
      caretColor: "var(--vscode-editorCursor-foreground, #aeafad)",
    },
    ".cm-line": {
      color: "var(--vscode-editor-foreground, #d4d4d4)",
      padding: "0",
    },
    ".cm-activeLine, .mlrt-prose-active-line": {
      // The lower layer is a guaranteed, theme-derived contrast fallback.
      // The VS Code token paints over it when supplied, preserving exact
      // stock-editor color while remaining visible if a host injects an
      // absent or transparent token.
      backgroundColor:
        "color-mix(in srgb, var(--vscode-editor-foreground, #d4d4d4) 7%, var(--vscode-editor-background, #1e1e1e))",
      backgroundImage:
        "linear-gradient(var(--vscode-editor-lineHighlightBackground, transparent), var(--vscode-editor-lineHighlightBackground, transparent))",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--vscode-editorCursor-foreground, #aeafad)",
      borderLeftWidth: "var(--mlrt-editor-cursor-width, 1px)",
    },
    // CodeMirror normally centers its border cursor with a negative margin.
    // At column zero that puts part of the cursor beneath the sticky gutter,
    // whose layer is above the cursor layer. The state-sync plugin supplies
    // this class directly from the selection/document model, avoiding a
    // focus-sensitive :has() query over browser-generated line DOM.
    "&.mlrt-empty-line-cursor:not(.mlrt-table-cell-focused):not(.mlrt-selection-active) .cm-cursor-primary":
      {
        marginLeft: "0",
      },
    "&.mlrt-table-cell-focused :is(.cm-activeLine, .mlrt-prose-active-line)": {
      backgroundColor: "transparent",
      backgroundImage: "none",
    },
    "&.mlrt-selection-active :is(.cm-activeLine, .mlrt-prose-active-line)": {
      backgroundColor: "transparent",
      backgroundImage: "none",
    },
    // A positive focus state wins over any stale negative class left behind
    // by a long-lived webview focus transition. This is intentionally after
    // the suppression rules: when the editable CodeMirror content itself
    // owns an empty cursor, its line highlight is authoritative.
    "&:is(.cm-focused, .mlrt-prose-cursor-focused) :is(.cm-activeLine, .mlrt-prose-active-line)": {
      backgroundColor:
        "color-mix(in srgb, var(--vscode-editor-foreground, #d4d4d4) 7%, var(--vscode-editor-background, #1e1e1e))",
      backgroundImage:
        "linear-gradient(var(--vscode-editor-lineHighlightBackground, transparent), var(--vscode-editor-lineHighlightBackground, transparent))",
    },
    "&.mlrt-table-cell-focused .cm-cursor": {
      display: "none",
    },
    // While a rendered table cell has focus, the editor selection is parked
    // on some unrelated line; do not let the native gutter highlight it.
    "&.mlrt-table-cell-focused .cm-activeLineGutter": {
      color: "var(--vscode-editorLineNumber-foreground, #858585)",
    },
    // A selection already communicates the active range. Keeping a second
    // active-line marker on its moving head (or its parked table-source
    // cursor) leaves a misleading grey line number behind.
    "&.mlrt-selection-active .cm-activeLineGutter": {
      color: "var(--vscode-editorLineNumber-foreground, #858585)",
    },
  });
}
