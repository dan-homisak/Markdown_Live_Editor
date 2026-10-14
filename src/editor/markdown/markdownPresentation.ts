import { markdownRenderTree as syntaxTree } from "./markdownRenderTree";
import { EditorState, Extension, Range, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { NodeProp, SyntaxNode, Tree } from "@lezer/common";
import { getParsedTables } from "../../shared/tableModel";
import { MarkdownRange, MarkdownSource } from "./markdownSyntax";
import { markdownAlertForQuote } from "./markdownBlockSyntax";
import { markdownChangedWindows, markdownComposing, updateMarkdownDecorations } from "./markdownRenderTree";
import { MarkdownThemeAdapter } from "./presentationTheme";

type Foreground = "heading" | "punctuation" | "link" | "destination" | "title" |
  "code" | "comment" | "tag" | "variable" | "string" | "keyword";
interface Style {
  headingLevel?: number;
  foreground?: Foreground;
  priority?: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  inlineCode?: boolean;
  codeFont?: boolean;
}
interface Span extends MarkdownRange { style: Style }
export interface MarkdownPresentationRun extends MarkdownRange { readonly className: string }

function mergeRanges(ranges: readonly MarkdownRange[], length: number): MarkdownRange[] {
  const result: { from: number; to: number }[] = [];
  for (const range of ranges.map(({ from, to }) => ({ from: Math.max(0, from), to: Math.min(length, to) }))
    .filter(range => range.from < range.to).sort((a, b) => a.from - b.from)) {
    const previous = result[result.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else result.push(range);
  }
  return result;
}

/** Passive, literal-source ranges. The caller supplies the editor's current tree,
 * and only parser-complete windows. This never parses, rewrites, or expands source. */
export function classifyMarkdownPresentation(
  source: MarkdownSource,
  tree: Tree,
  protectedRanges: readonly MarkdownRange[] = [],
  visibleRanges: readonly MarkdownRange[] = [{ from: 0, to: source.length }],
): MarkdownPresentationRun[] {
  const windows = mergeRanges(visibleRanges, Math.min(source.length, tree.length));
  const protectedWindows = mergeRanges(protectedRanges, source.length);
  const spans: Span[] = [];
  const read = (from: number, to: number): string => typeof source === "string"
    ? source.slice(from, to) : source.sliceString(from, to);

  for (const window of windows) {
    // Clip every path, including styles inherited from an offscreen ancestor.
    const add = (from: number, to: number, style: Style): void => {
      from = Math.max(from, window.from);
      to = Math.min(to, window.to);
      if (from >= to) return;
      for (const protectedRange of protectedWindows) {
        if (protectedRange.to <= from) continue;
        if (protectedRange.from >= to) break;
        if (protectedRange.from > from) spans.push({ from, to: protectedRange.from, style });
        from = Math.max(from, protectedRange.to);
        if (from >= to) return;
      }
      spans.push({ from, to, style });
    };
    const role = (from: number, to: number, foreground: Foreground, priority: number): void =>
      add(from, to, { foreground, priority });
    const punctuation = (from: number, to: number): void => role(from, to, "punctuation", 100);
    const content = (node: SyntaxNode, mark: string, style: Style): void => {
      const first = node.firstChild;
      const last = node.lastChild;
      add(first?.name === mark ? first.to : node.from, last?.name === mark ? last.from : node.to, style);
    };
    const html = (node: SyntaxNode): void => {
      add(node.from, node.to, { foreground: "code", priority: 70, codeFont: true });
      // lang-markdown already mounts the HTML grammar. Reuse its token tree;
      // never turn document HTML into DOM or run a second parser here.
      const mounted = node.prop(NodeProp.mounted);
      if (!mounted) return;
      mounted.tree.iterate({
        from: Math.max(0, window.from - node.from), to: window.to - node.from,
        enter(token) {
          const from = token.from + node.from, to = token.to + node.from;
          switch (token.name) {
            case "TagName": role(from, to, "tag", 80); break;
            case "AttributeName": role(from, to, "variable", 80); break;
            case "AttributeValue": role(from, to, "string", 80); break;
            case "Comment": role(from, to, "comment", 90); return false;
            case "DoctypeDecl": case "ProcessingInst": role(from, to, "keyword", 80); break;
            case "StartTag": case "StartCloseTag": case "EndTag": case "SelfCloseEndTag":
            case "Is": punctuation(from, to); break;
          }
        },
      });
    };
    tree.iterate({
      from: window.from, to: window.to,
      enter(ref) {
        const node = ref.node;
        const { name, from, to } = node;
        if (to <= window.from || from >= window.to) return false;
        // These owners also perform final table clipping for all nested tokens.
        if (name === "FencedCode" || name === "CodeBlock" || name === "MarkdownFrontmatter" ||
            name === "Frontmatter") return false;
        if (/^(?:ATX|Setext)Heading[1-6]$/.test(name)) {
          add(from, to, { foreground: "heading", headingLevel: Number(name.slice(-1)), priority: 20, bold: true });
        } else switch (name) {
          case "StrongEmphasis": content(node, "EmphasisMark", { bold: true }); break;
          case "Emphasis": content(node, "EmphasisMark", { italic: true }); break;
          case "Strikethrough": content(node, "StrikethroughMark", { strike: true }); break;
          case "EmphasisMark": case "StrikethroughMark": case "LinkMark": case "WikiMark":
            punctuation(from, to); break;
          case "WikiLink":
            role(from, to, "link", 60); break;
          case "InlineCode":
            add(from, to, { foreground: "code", priority: 70, inlineCode: true, codeFont: true }); break;
          case "CodeMark": punctuation(from, to); break;
          case "Link": {
            const paragraph = node.parent, quote = paragraph?.parent;
            const alert = paragraph?.name === "Paragraph" && quote?.name === "Blockquote"
              ? markdownAlertForQuote(source, quote) : null;
            // Lezer also parses unresolved alert labels as shortcut links.
            // The structural alert owner supplies their foreground and weight.
            if (alert?.from === from && alert.to === to) return false;
            role(from, to, "link", 50); break;
          }
          case "Image": case "Autolink": role(from, to, "link", 50); break;
          case "LinkLabel":
            role(from, to, "link", 50);
            // These are parser-defined labels; only their literal delimiters
            // are split, including labels on reference definitions.
            if (read(from, from + 1) === "[") punctuation(from, from + 1);
            if (read(to - 1, to) === "]") punctuation(to - 1, to);
            break;
          case "URL": {
            const destination = node.parent?.name === "Link" || node.parent?.name === "Image" ||
              node.parent?.name === "LinkReference";
            role(from, to, destination ? "destination" : "link", 60);
            if (read(from, from + 1) === "<" && read(to - 1, to) === ">") {
              punctuation(from, from + 1); punctuation(to - 1, to);
            }
            break;
          }
          case "LinkTitle":
            role(from, to, "title", 60);
            punctuation(from, from + 1); punctuation(to - 1, to); break;
          case "HTMLTag": case "HTMLBlock": html(node); return false;
          case "Comment": case "CommentBlock":
            role(from, to, "comment", 90); return false;
        }
      },
    });
  }

  // Resolve properties before creating DOM marks. Disjoint runs avoid relying
  // on incidental nesting order when links/code/emphasis occur in headings.
  const events = spans.flatMap((span, id) => [
    { position: span.from, id, add: true }, { position: span.to, id, add: false },
  ]).sort((a, b) => a.position - b.position);
  const active = new Set<number>();
  const result: { from: number; to: number; className: string }[] = [];
  let index = 0;
  while (index < events.length) {
    const from = events[index].position;
    while (index < events.length && events[index].position === from) {
      const event = events[index++];
      if (event.add) active.add(event.id); else active.delete(event.id);
    }
    const to = events[index]?.position ?? from;
    if (!active.size || from === to) continue;
    let foreground: Foreground | undefined, priority = -1;
    const flags = { bold: false, italic: false, strike: false, inlineCode: false, codeFont: false };
    let headingLevel: number | undefined;
    for (const id of active) {
      const style = spans[id].style;
      if (style.headingLevel) headingLevel = style.headingLevel;
      if (style.foreground && (style.priority ?? 0) > priority) {
        foreground = style.foreground; priority = style.priority ?? 0;
      }
      for (const key of Object.keys(flags) as (keyof typeof flags)[]) flags[key] ||= !!style[key];
    }
    const classes = ["mlrt-markdown-source"];
    if (foreground) classes.push(`mlrt-markdown-role-${foreground}`);
    if (headingLevel) classes.push(`mlrt-markdown-heading-${headingLevel}`);
    if (flags.bold && !flags.codeFont) classes.push("mlrt-markdown-bold");
    if (flags.italic && !flags.codeFont) classes.push("mlrt-markdown-italic");
    if (flags.strike) classes.push("mlrt-markdown-strike");
    if (flags.codeFont) classes.push("mlrt-markdown-code-font");
    if (flags.inlineCode) classes.push("mlrt-markdown-inline-code");
    const className = classes.join(" ");
    const previous = result[result.length - 1];
    if (previous?.to === from && previous.className === className) previous.to = to;
    else result.push({ from, to, className });
  }
  return result;
}

/** Keep each DOM mark on one source row. In the installed CodeMirror release,
 * reusing a cross-newline mark can drop line attributes (including active-line
 * and block guides) on its continuation. Splitting preserves all source text. */
export function markdownPresentationDecorations(document: Text, runs: readonly MarkdownPresentationRun[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const run of runs) {
    const mark = Decoration.mark({ class: run.className.split(" ").filter(name => name !== "mlrt-markdown-inline-code").join(" ") });
    for (let from = run.from; from < run.to;) {
      const line = document.lineAt(from), to = Math.min(run.to, line.to);
      if (from < to) ranges.push(mark.range(from, to));
      from = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/** One outer mark owns the surface, including the independently colored backticks. */
export function markdownInlineCodeDecorations(document: Text, runs: readonly MarkdownPresentationRun[]): DecorationSet {
  const groups: { from: number; to: number }[] = [];
  for (const run of runs) {
    if (!run.className.split(" ").includes("mlrt-markdown-inline-code")) continue;
    const previous = groups[groups.length - 1];
    if (previous?.to === run.from) previous.to = run.to;
    else groups.push({ from: run.from, to: run.to });
  }
  const ranges: Range<Decoration>[] = [];
  const mark = Decoration.mark({ class: "mlrt-markdown-inline-code" });
  for (const group of groups) {
    for (let from = group.from; from < group.to;) {
      const line = document.lineAt(from), to = Math.min(group.to, line.to);
      if (from < to) ranges.push(mark.range(from, to));
      from = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}


interface PresentationState {
  decorations: DecorationSet;
  inlineCodeDecorations: DecorationSet;
  composing: boolean;
}
function presentation(state: EditorState, windows?: readonly MarkdownRange[]): PresentationState {
  const runs = classifyMarkdownPresentation(state.doc, syntaxTree(state), getParsedTables(state.doc), windows);
  return { decorations: markdownPresentationDecorations(state.doc, runs),
    inlineCodeDecorations: markdownInlineCodeDecorations(state.doc, runs), composing: false };
}

/** Complete document decorations, like tables. CodeMirror can build its height
 * map and mount a row with every font and inline surface already attached. */
export const markdownPresentationField = StateField.define<PresentationState>({
  create: presentation,
  update(value, transaction) {
    const composing = markdownComposing(transaction, value.composing);
    if (composing) return { composing, decorations: value.decorations.map(transaction.changes),
      inlineCodeDecorations: value.inlineCodeDecorations.map(transaction.changes) };
    if (transaction.docChanged && !value.composing) {
      const windows = markdownChangedWindows(transaction), changed = presentation(transaction.state, windows);
      return { composing: false,
        decorations: updateMarkdownDecorations(value.decorations, transaction, changed.decorations, windows),
        inlineCodeDecorations: updateMarkdownDecorations(value.inlineCodeDecorations, transaction, changed.inlineCodeDecorations, windows) };
    }
    if (transaction.docChanged || value.composing || syntaxTree(transaction.state) !== syntaxTree(transaction.startState))
      return presentation(transaction.state);
    return value;
  },
  provide: field => [EditorView.decorations.from(field, value => value.decorations),
    EditorView.outerDecorations.from(field, value => value.inlineCodeDecorations)],
});

export function createMarkdownPresentationExtensions(): Extension {
  return [markdownPresentationField, ViewPlugin.fromClass(class {
    private readonly theme: MarkdownThemeAdapter;
    constructor(view: EditorView) { this.theme = new MarkdownThemeAdapter(view); }
    destroy(): void { this.theme.destroy(); }
  })];
}
