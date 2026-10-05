import { Language, StreamLanguage, StreamParser, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { pythonLanguage } from "@codemirror/lang-python";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { Extension, Range, StateEffect, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { parseMixed, SyntaxNode, Tree } from "@lezer/common";
import { highlightTree, styleTags, Tag, tagHighlighter, tags } from "@lezer/highlight";
import { MarkdownExtension } from "@lezer/markdown";
import { getParsedTables } from "../../shared/tableModel";
import type { MarkdownRange } from "./markdownSyntax";
import { markdownAlertForQuote, MarkdownAlertType } from "./markdownBlockSyntax";

// legacy-modes publishes a CJS runtime with ESM-only declaration identity.
// Use its documented require export with this editor's StreamParser type.
const { shell } = require("@codemirror/legacy-modes/mode/shell") as { shell: StreamParser<unknown> };
const shellLanguage = StreamLanguage.define(shell);
// The YAML grammar intentionally tags every plain scalar as generic content.
// Preserve its structural/key recognition and classify only parsed value nodes.
const yamlScalar = Tag.define();
const yamlCodeLanguage = yamlLanguage.configure({ props: [styleTags({
  Literal: yamlScalar,
  "Key/Literal": tags.definition(tags.propertyName),
})] });
const codeLanguageAliases: Readonly<Record<string, Language>> = {
  javascript: javascriptLanguage, js: javascriptLanguage, nodejs: javascriptLanguage,
  typescript: typescriptLanguage, ts: typescriptLanguage,
  json: jsonLanguage, bash: shellLanguage, sh: shellLanguage, shell: shellLanguage,
  python: pythonLanguage, py: pythonLanguage, yaml: yamlCodeLanguage, yml: yamlCodeLanguage,
};

/** Statically bundled parsers only. Empty/unknown info never guesses a language. */
export function markdownCodeLanguages(info: string): Language | null {
  return codeLanguageAliases[info.trim().split(/\s/u, 1)[0].toLowerCase()] ?? null;
}

/** The structural frontmatter extension is shared separately with host actions. */
export const markdownBlockLanguageExtensions: MarkdownExtension = {
  wrap: parseMixed(node => node.name === "MarkdownFrontmatter" ? {
    parser: yamlCodeLanguage.parser,
    overlay: child => child.name === "MarkdownFrontmatterContent",
    bracketed: true,
  } : null),
};

export interface MarkdownBlockRow {
  readonly from: number;
  readonly classes: string;
}
export interface MarkdownBlockMark extends MarkdownRange {
  readonly classes: string;
}
export interface MarkdownBlockProjection {
  readonly rows: readonly MarkdownBlockRow[];
  readonly marks: readonly MarkdownBlockMark[];
}

const codeHighlighter = tagHighlighter([
  { tag: yamlScalar, class: "mlrt-markdown-block-token-scalar" },
  { tag: tags.comment, class: "mlrt-markdown-block-token-comment" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "mlrt-markdown-block-token-constant" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.definitionKeyword], class: "mlrt-markdown-block-token-declaration" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], class: "mlrt-markdown-block-token-keyword" },
  { tag: [tags.string, tags.special(tags.string)], class: "mlrt-markdown-block-token-string" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName, tags.function(tags.variableName)], class: "mlrt-markdown-block-token-variable" },
  { tag: [tags.tagName, tags.regexp], class: "mlrt-markdown-block-token-tag" },
  { tag: [tags.punctuation, tags.meta], class: "mlrt-markdown-block-token-punctuation" },
]);

function overlaps(a: MarkdownRange, b: MarkdownRange): boolean {
  return a.from < b.to && a.to > b.from;
}

/** Every passive path is clipped after semantic classification. */
function unprotected(range: MarkdownRange, protectedRanges: readonly MarkdownRange[]): MarkdownRange[] {
  let result = [range];
  for (const protectedRange of protectedRanges) {
    const next: MarkdownRange[] = [];
    for (const item of result) {
      if (!overlaps(item, protectedRange)) next.push(item);
      else {
        if (item.from < protectedRange.from) next.push({ from: item.from, to: protectedRange.from });
        if (item.to > protectedRange.to) next.push({ from: protectedRange.to, to: item.to });
      }
    }
    result = next;
  }
  return result;
}

interface RowState {
  quote: boolean;
  alert?: MarkdownAlertType;
  alertDepth: number;
  code?: "code" | "frontmatter";
  start: boolean;
  end: boolean;
}

/**
 * Project only ready visible windows from the editor's configured Markdown tree.
 * Ancestor nodes supply offscreen openers/quote extent. There is no parse call,
 * document-wide text materialization, source replacement, or layout measurement.
 */
export function classifyMarkdownBlocks(
  source: Text,
  tree: Tree,
  protectedRanges: readonly MarkdownRange[] = [],
  visibleRanges: readonly MarkdownRange[] = [{ from: 0, to: source.length }],
): MarkdownBlockProjection {
  const rows = new Map<number, RowState>();
  const marks: MarkdownBlockMark[] = [];
  const markKeys = new Set<string>();
  const codeContents: MarkdownRange[] = [];
  const seenBlocks = new Set<string>();
  const addMark = (range: MarkdownRange, classes: string): void => {
    for (const window of visibleRanges) {
      const visible = { from: Math.max(range.from, window.from), to: Math.min(range.to, window.to) };
      if (visible.from >= visible.to) continue;
      for (const safe of unprotected(visible, protectedRanges)) {
        // Keep every passive wrapper inside a source row. In the installed CM
        // tile renderer a mark spanning a newline can cause an incrementally
        // reused row to lose its line attributes (confirmed in the real host).
        // Newlines remain ordinary source, and empty code rows use line paint.
        for (let from = safe.from; from < safe.to;) {
          const line = source.lineAt(from);
          const to = Math.min(line.to, safe.to);
          const key = `${from}:${to}:${classes}`;
          if (from < to && !markKeys.has(key)) { markKeys.add(key); marks.push({ from, to, classes }); }
          from = line.to + 1;
        }
      }
    }
  };
  const addRows = (node: SyntaxNode, visit: (row: RowState, lineFrom: number) => void): void => {
    const firstLine = source.lineAt(node.from).from;
    const lastLine = source.lineAt(Math.max(node.from, node.to - 1)).from;
    for (const window of visibleRanges) {
      if (!overlaps(node, window)) continue;
      const first = source.lineAt(Math.max(node.from, window.from)).number;
      const last = source.lineAt(Math.max(node.from, Math.min(node.to, window.to) - 1)).number;
      for (let number = first; number <= last; number++) {
        const line = source.line(number);
        // A line decoration is indivisible: any table ownership suppresses it.
        if (protectedRanges.some(range => range.from <= line.to && range.to > line.from)) continue;
        let row = rows.get(line.from);
        if (!row) rows.set(line.from, row = { quote: false, alertDepth: -1, start: false, end: false });
        visit(row, line.from);
        if (node.name === "FencedCode" || node.name === "MarkdownFrontmatter") {
          if (line.from === firstLine) row.start = true;
          // Only a real closing marker earns the bottom inset edge.
          const closing = node.lastChild;
          if (closing && /^(CodeMark|MarkdownFrontmatterMark)$/u.test(closing.name) &&
              closing.from > node.from && line.from === lastLine) row.end = true;
        }
      }
    }
  };
  for (const window of visibleRanges) {
    if (window.from >= window.to) continue;
    tree.iterate({ from: window.from, to: window.to, enter(reference) {
      const node = reference.node;
      if (node.name === "Blockquote") {
        const key = `quote:${node.from}:${node.to}`;
        if (seenBlocks.has(key)) return;
        seenBlocks.add(key);
        const alert = markdownAlertForQuote(source, node);
        let depth = 0;
        for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === "Blockquote") depth++;
        addRows(node, row => {
          row.quote = true;
          if (alert && depth >= row.alertDepth) { row.alert = alert.type; row.alertDepth = depth; }
        });
        if (alert) addMark(alert, `mlrt-markdown-block-alert-label mlrt-markdown-block-alert-${alert.type}`);
      } else if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "MarkdownFrontmatter") {
        const key = `code:${node.from}:${node.to}`;
        if (seenBlocks.has(key)) return false;
        seenBlocks.add(key);
        const kind = node.name === "MarkdownFrontmatter" ? "frontmatter" : "code";
        addRows(node, row => { row.code = kind; });
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (child.name === "CodeText" || child.name === "MarkdownFrontmatterContent") {
            codeContents.push({ from: child.from, to: child.to });
            addMark(child, "mlrt-markdown-block-code-source");
          } else if (child.name === "CodeMark" || child.name === "MarkdownFrontmatterMark") {
            addMark(child, "mlrt-markdown-block-delimiter");
          } else if (child.name === "CodeInfo") {
            addMark(child, "mlrt-markdown-block-info");
          }
        }
        return false;
      }
    } });
  }
  // The nested parsers are mounted on the same editor tree. Highlight only its
  // visible code content, then apply table clipping again to every token.
  for (const window of visibleRanges) {
    if (!codeContents.some(range => overlaps(range, window))) continue;
    highlightTree(tree, codeHighlighter, (from, to, classes) => {
      if (classes === "mlrt-markdown-block-token-scalar") {
        const node = tree.resolveInner(from, 1);
        const value = node.from === from && node.to === to ? source.sliceString(from, to).trim() : "";
        const constant = /^(?:~|null|true|false|[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[-+]?[0-9]+)?|[-+]?0o[0-7]+|[-+]?0x[\da-f]+|[-+]?\.inf|\.nan)$/iu.test(value);
        classes = `mlrt-markdown-block-token-${constant ? "constant" : "string"}`;
      }
      for (const content of codeContents) {
        const range = { from: Math.max(from, content.from), to: Math.min(to, content.to) };
        if (range.from < range.to) addMark(range, classes);
      }
    }, window.from, window.to);
  }
  return {
    rows: Array.from(rows, ([from, row]) => {
      const classes: string[] = [];
      if (row.quote) classes.push("mlrt-markdown-block-quote");
      if (row.alert) classes.push("mlrt-markdown-block-alert", `mlrt-markdown-block-alert-${row.alert}`);
      if (row.code) classes.push("mlrt-markdown-block-code", ...(row.code === "frontmatter" ? ["mlrt-markdown-block-frontmatter"] : []));
      if (row.start) classes.push("mlrt-markdown-block-start");
      if (row.end) classes.push("mlrt-markdown-block-end");
      return { from, classes: classes.join(" ") };
    }).sort((a, b) => a.from - b.from),
    marks: marks.sort((a, b) => a.from - b.from || a.to - b.to),
  };
}

const refreshBlocks = StateEffect.define<null>();
class MarkdownBlockView {
  decorations: DecorationSet = Decoration.none;
  private tree: Tree | null = null;
  private windows = "";
  private composing = false;
  private destroyed = false;
  private failed = false;
  private dirty = true;
  private readonly visibilityChanged = (): void => {
    if (!this.view.dom.ownerDocument.hidden) this.refresh();
  };
  constructor(readonly view: EditorView) {
    view.dom.ownerDocument.addEventListener("visibilitychange", this.visibilityChanged);
    this.rebuild();
    queueMicrotask(() => this.refresh());
  }
  private refresh(): void {
    if (this.destroyed || this.failed || this.view.dom.ownerDocument.hidden) return;
    this.view.dispatch({ effects: refreshBlocks.of(null) });
  }
  update(update: ViewUpdate): void {
    if (this.failed) return;
    if (this.composing || this.view.compositionStarted || this.view.dom.ownerDocument.hidden) {
      this.decorations = this.decorations.map(update.changes);
      this.dirty ||= update.docChanged || update.viewportChanged;
      return;
    }
    const windows = this.readyWindows().map(range => `${range.from}:${range.to}`).join(",");
    if (this.dirty || update.docChanged || update.viewportChanged ||
        this.tree !== syntaxTree(update.state) || this.windows !== windows ||
        update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshBlocks)))) {
      this.rebuild();
    }
  }
  private readyWindows(): readonly MarkdownRange[] {
    return this.view.visibleRanges.filter(range => syntaxTreeAvailable(this.view.state, range.to));
  }
  private rebuild(): void {
    if (this.destroyed || this.failed || this.view.dom.ownerDocument.hidden) return;
    try {
      this.tree = syntaxTree(this.view.state);
      const windows = this.readyWindows();
      this.windows = windows.map(range => `${range.from}:${range.to}`).join(",");
      const projection = classifyMarkdownBlocks(this.view.state.doc, this.tree, getParsedTables(this.view.state.doc), windows);
      const ranges: Range<Decoration>[] = projection.rows.map(row => Decoration.line({ class: row.classes }).range(row.from));
      ranges.push(...projection.marks.map(mark => Decoration.mark({ class: mark.classes }).range(mark.from, mark.to)));
      this.decorations = Decoration.set(ranges, true);
      this.dirty = false;
    } catch {
      this.failed = true;
      this.decorations = Decoration.none;
      console.warn("Markdown block rendering disabled for this view after a presentation failure.");
    }
  }
  compositionStart(): void { this.composing = true; }
  compositionEnd(): void { this.composing = false; this.dirty = true; queueMicrotask(() => this.refresh()); }
  destroy(): void {
    this.destroyed = true;
    this.view.dom.ownerDocument.removeEventListener("visibilitychange", this.visibilityChanged);
  }
}

const blockPlugin = ViewPlugin.fromClass(MarkdownBlockView, {
  decorations: plugin => plugin.decorations,
  eventHandlers: {
    compositionstart() { this.compositionStart(); return false; },
    compositionend() { this.compositionEnd(); return false; },
  },
});

/** Installed only inside the enabled Markdown rendering compartment. */
export function createMarkdownBlockExtensions(): Extension { return blockPlugin; }
