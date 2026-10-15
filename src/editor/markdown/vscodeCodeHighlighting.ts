import { EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { CodeHighlightingConfiguration, CodeHighlightToken, InitialCodeHighlighting } from "../../shared/codeHighlighting";
import { getParsedTables } from "../../shared/tableModel";
import { BrowserCodeHighlighter, createBrowserCodeHighlighter } from "./browserCodeHighlighting";
import { markdownComposing, markdownRenderTree } from "./markdownRenderTree";

export const nativeCodeHighlightingFacet = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });
const refreshCodeHighlighting = StateEffect.define<null>();

export function codeTokenStyle(token: CodeHighlightToken): string {
  const decoration = [token.fontStyle & 4 ? "underline" : "", token.fontStyle & 8 ? "line-through" : ""].filter(Boolean).join(" ") || "none";
  return `color:${token.color};font-style:${token.fontStyle & 1 ? "italic" : "normal"};` +
    `font-weight:${token.fontStyle & 2 ? "bold" : "var(--mlrt-editor-font-weight, normal)"};text-decoration:${decoration}`;
}

function codeRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [], protectedRanges = getParsedTables(state.doc);
  markdownRenderTree(state).iterate({ enter(reference) {
    const node = reference.node;
    if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
    for (const child of node.getChildren("CodeText")) {
      const from = child.from, to = child.to;
      if (from < to && !protectedRanges.some(range => range.from < to && range.to > from)) ranges.push({ from, to });
    }
    return false;
  } });
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && last.to >= range.from) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

export function createVscodeCodeHighlighting(post: (message: { type: "requestCodeHighlightingConfiguration"; themeName?: string }) => void) {
  let engine: BrowserCodeHighlighter | undefined;
  const highlight = (state: EditorState): DecorationSet => Decoration.set(
    (engine?.highlight(state.doc, codeRanges(state)) ?? []).map(token => Decoration.mark({ class: "mlrt-vscode-code-token",
      attributes: { style: codeTokenStyle(token) } }).range(token.from, token.to)), true);
  // Native scrolling can reveal mounted/overscan rows before a ViewPlugin
  // receives its viewport update. Prepare colors for the complete document in
  // state, so entering the viewport never triggers first-time code coloring.
  const field = StateField.define<{ decorations: DecorationSet; composing: boolean }>({
    create: state => ({ decorations: highlight(state), composing: false }),
    update(value, transaction) {
      const composing = markdownComposing(transaction, value.composing);
      if (composing) return { composing, decorations: value.decorations.map(transaction.changes) };
      if (transaction.docChanged || value.composing || markdownRenderTree(transaction.state) !== markdownRenderTree(transaction.startState) ||
          transaction.effects.some(effect => effect.is(refreshCodeHighlighting)))
        return { composing: false, decorations: highlight(transaction.state) };
      return value;
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
  class NativeCodeHighlighting {
    private destroyed = false;
    private generation = 0;
    private readonly themeObserver: MutationObserver;
    constructor(readonly view: EditorView) {
      this.themeObserver = new MutationObserver(() => this.requestConfiguration());
      this.themeObserver.observe(view.dom.ownerDocument.body, { attributes: true,
        attributeFilter: ["data-vscode-theme-id", "data-vscode-theme-name"] });
    }
    requestConfiguration(): void {
      if (!this.destroyed) post({ type: "requestCodeHighlightingConfiguration",
        themeName: this.view.dom.ownerDocument.body.dataset.vscodeThemeId ?? this.view.dom.ownerDocument.body.dataset.vscodeThemeName });
    }
    accept(message: unknown): boolean {
      if (!message || typeof message !== "object" || !("type" in message)) return false;
      if (message.type === "refreshCodeHighlighting") { this.requestConfiguration(); return true; }
      if (message.type !== "codeHighlightingConfiguration" || !("configuration" in message)) return false;
      const generation = ++this.generation;
      // Keep the current colors while a theme loads, then replace them in one
      // update. Edits and scrolls continue using synchronous tokenization.
      void createBrowserCodeHighlighter(message.configuration as CodeHighlightingConfiguration).then(next => {
        if (this.destroyed || generation !== this.generation) { next.dispose(); return; }
        engine?.dispose(); engine = next;
        this.view.dispatch({ effects: refreshCodeHighlighting.of(null) });
      }).catch(error => console.warn(`Code highlighting theme reload failed: ${String(error)}`));
      return true;
    }
    destroy(): void { this.destroyed = true; this.themeObserver.disconnect(); engine?.dispose(); engine = undefined; }
  }
  const plugin = ViewPlugin.fromClass(NativeCodeHighlighting);
  return {
    async initialize(initial?: InitialCodeHighlighting): Promise<void> {
      if (initial) engine = await createBrowserCodeHighlighter(initial.configuration, initial.wasm);
    },
    get extension() { return [nativeCodeHighlightingFacet.of(!!engine), field, plugin]; },
    accept: (view: EditorView, message: unknown): boolean => view.plugin(plugin)?.accept(message) ?? false,
  };
}
