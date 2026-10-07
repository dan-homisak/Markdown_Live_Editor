import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Facet, Range, StateEffect, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { CodeHighlightRange, CodeHighlightRequest, CodeHighlightResponse, CodeHighlightToken } from "../../shared/codeHighlighting";
import { getParsedTables } from "../../shared/tableModel";

export const nativeCodeHighlightingFacet = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });
const refreshCodeHighlighting = StateEffect.define<null>();

export function codeTokenStyle(token: CodeHighlightToken): string {
  const decoration = [token.fontStyle & 4 ? "underline" : "", token.fontStyle & 8 ? "line-through" : ""].filter(Boolean).join(" ") || "none";
  return `color:${token.color};font-style:${token.fontStyle & 1 ? "italic" : "normal"};` +
    `font-weight:${token.fontStyle & 2 ? "bold" : "var(--mlrt-editor-font-weight, normal)"};text-decoration:${decoration}`;
}

/** Only ready, visible code text is sent to the host. The full Markdown context
 * stays in the authoritative VS Code document and its incremental token cache. */
function visibleCodeRanges(view: EditorView): CodeHighlightRange[] {
  const ranges: { from: number; to: number }[] = [];
  const protectedRanges = getParsedTables(view.state.doc);
  for (const window of view.visibleRanges) {
    if (!syntaxTreeAvailable(view.state, window.to)) continue;
    syntaxTree(view.state).iterate({ from: window.from, to: window.to, enter(reference) {
      const node = reference.node;
      if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
      for (const child of node.getChildren("CodeText")) {
        const from = Math.max(child.from, window.from), to = Math.min(child.to, window.to);
        if (from < to && !protectedRanges.some(range => range.from < to && range.to > from)) ranges.push({ from, to });
      }
      return false;
    } });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && last.to >= range.from) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged.map(range => ({ ...range, text: view.state.doc.sliceString(range.from, range.to) }));
}

export function createVscodeCodeHighlighting(post: (message: CodeHighlightRequest) => void) {
  class NativeCodeHighlighting {
    decorations: DecorationSet = Decoration.none;
    private id = 0;
    private snapshot: Text | null = null;
    private requested: readonly CodeHighlightRange[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    private tree: ReturnType<typeof syntaxTree>;
    private destroyed = false;
    private readonly themeObserver: MutationObserver;
    constructor(readonly view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.themeObserver = new MutationObserver(() => { this.id++; this.schedule(); });
      this.themeObserver.observe(view.dom.ownerDocument.body, { attributes: true,
        attributeFilter: ["data-vscode-theme-id", "data-vscode-theme-name"] });
      this.schedule();
    }
    schedule(): void {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (this.destroyed || this.view.compositionStarted || this.view.composing) return;
        this.snapshot = this.view.state.doc;
        this.requested = visibleCodeRanges(this.view);
        this.id++;
        if (this.requested.length) post({ type: "requestCodeHighlighting", id: this.id, ranges: this.requested,
          themeName: this.view.dom.ownerDocument.body.dataset.vscodeThemeId ??
            this.view.dom.ownerDocument.body.dataset.vscodeThemeName });
      }, 40);
    }
    update(update: ViewUpdate): void {
      const tree = syntaxTree(update.state);
      if (update.docChanged) {
        this.id++;
        this.snapshot = null;
        this.decorations = Decoration.none;
      }
      if (update.docChanged || update.viewportChanged || tree !== this.tree) this.schedule();
      this.tree = tree;
    }
    accept(message: unknown): boolean {
      if (!message || typeof message !== "object" || !("type" in message)) return false;
      if (message.type === "refreshCodeHighlighting") { this.id++; this.schedule(); return true; }
      if (message.type !== "codeHighlighting") return false;
      const response = message as CodeHighlightResponse;
      if (this.destroyed || response.id !== this.id || this.snapshot !== this.view.state.doc || !Array.isArray(response.tokens)) return true;
      const ranges: Range<Decoration>[] = [];
      for (const token of response.tokens) {
        if (!token || !Number.isInteger(token.from) || !Number.isInteger(token.to) || token.from >= token.to ||
            !/^#[\da-f]{6}(?:[\da-f]{2})?$/iu.test(token.color) || !Number.isInteger(token.fontStyle) || token.fontStyle < 0 || token.fontStyle > 15 ||
            !this.requested.some(range => token.from >= range.from && token.to <= range.to)) continue;
        ranges.push(Decoration.mark({ class: "mlrt-vscode-code-token", attributes: { style: codeTokenStyle(token) } }).range(token.from, token.to));
      }
      this.decorations = Decoration.set(ranges, true);
      this.view.dispatch({ effects: refreshCodeHighlighting.of(null) });
      return true;
    }
    destroy(): void { this.destroyed = true; this.themeObserver.disconnect(); if (this.timer) clearTimeout(this.timer); }
  }
  const plugin = ViewPlugin.fromClass(NativeCodeHighlighting, {
    decorations: value => value.decorations,
    eventHandlers: { compositionend() { this.schedule(); return false; } },
  });
  return {
    extension: [nativeCodeHighlightingFacet.of(true), plugin],
    accept: (view: EditorView, message: unknown): boolean => view.plugin(plugin)?.accept(message) ?? false,
  };
}
