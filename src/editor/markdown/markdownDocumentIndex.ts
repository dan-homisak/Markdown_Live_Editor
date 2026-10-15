import MarkdownIt from "markdown-it";
import { SyntaxNode, Tree } from "@lezer/common";
import type { MarkdownRange, MarkdownSource } from "./markdownSyntax";

const utils = new MarkdownIt("zero").utils;
export const decodeMarkdownEntity = (value: string): string => utils.unescapeAll(value);
const read = (source: MarkdownSource, from: number, to: number): string =>
  typeof source === "string" ? source.slice(from, to) : source.sliceString(from, to);
const labelKey = (label: string): string => label.trim().toLowerCase();

/** Plain heading labels without interpreting HTML or fetching images. */
export function markdownNodeText(source: MarkdownSource, node: SyntaxNode): string {
  if (["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark", "LinkLabel", "URL", "LinkTitle", "WikiMark"].includes(node.name)) return "";
  if (node.name === "Entity" || node.name === "Escape") return utils.unescapeAll(read(source, node.from, node.to));
  if (node.name === "WikiLink") {
    const label = node.getChild("WikiLabel") ?? node.getChild("WikiTarget");
    return label ? read(source, label.from, label.to) : "";
  }
  let value = "", from = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    value += read(source, from, child.from) + markdownNodeText(source, child);
    from = child.to;
  }
  return value + read(source, from, node.to);
}

export interface MarkdownHeading extends MarkdownRange { level: number; label: string }
export interface MarkdownFootnote extends MarkdownRange {
  number: number;
  labelFrom: number;
  labelTo: number;
  firstReference?: number;
}
export interface MarkdownDocumentIndex {
  headings: MarkdownHeading[];
  footnotes: Map<string, MarkdownFootnote>;
  orderedNumbers: Map<number, string>;
  referenceSignature: string;
}
const indexes = new WeakMap<Tree, { source: MarkdownSource; tables: readonly MarkdownRange[]; value: MarkdownDocumentIndex }>();

/** Cache source positions, never a rendered whole-document copy. References
 * and the TOC update together when distant definitions/headings change. */
export function markdownDocumentIndex(source: MarkdownSource, tree: Tree, tables: readonly MarkdownRange[]): MarkdownDocumentIndex {
  const cached = indexes.get(tree);
  if (cached?.source === source && cached.tables === tables) return cached.value;
  const value: MarkdownDocumentIndex = { headings: [], footnotes: new Map(), orderedNumbers: new Map(), referenceSignature: "" }, references: { label: string; from: number }[] = [];
  tree.iterate({ enter({ node }) {
    if (["FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "Comment", "MarkdownFrontmatter", "Image", "WikiEmbed"].includes(node.name) ||
        tables.some(table => node.from >= table.from && node.to <= table.to)) return false;
    if (/^(?:ATX|Setext)Heading[1-6]$/u.test(node.name)) value.headings.push({ from: node.from, to: node.to,
      level: Number(node.name.slice(-1)), label: markdownNodeText(source, node).trim() });
    if (node.name === "LinkReference") value.referenceSignature += JSON.stringify(read(source, node.from, node.to));
    if (node.name === "OrderedList") {
      let number: number | undefined;
      for (let item = node.firstChild; item; item = item.nextSibling) {
        const mark = item.name === "ListItem" ? item.getChild("ListMark") : null;
        if (!mark) continue;
        if (number === undefined) number = Number(read(source, mark.from, mark.to - 1));
        value.orderedNumbers.set(item.from, String(number++));
      }
    }
    if (node.name === "FootnoteDefinition") {
      const label = node.getChild("FootnoteLabel");
      if (label) {
        const key = labelKey(read(source, label.from + 2, label.to).split("]:", 1)[0]);
        if (!value.footnotes.has(key)) value.footnotes.set(key, { from: node.from, to: node.to, labelFrom: label.from, labelTo: label.to, number: 0 });
      }
    } else if (node.name === "FootnoteReference") references.push({ from: node.from, label: labelKey(read(source, node.from + 2, node.to - 1)) });
  } });
  let number = 0;
  for (const reference of references) {
    const note = value.footnotes.get(reference.label);
    if (note && !note.number) { note.number = ++number; note.firstReference = reference.from; }
  }
  for (const note of value.footnotes.values()) if (!note.number) note.number = ++number;
  indexes.set(tree, { source, tables, value });
  return value;
}

export function footnoteForReference(source: MarkdownSource, node: SyntaxNode, index: MarkdownDocumentIndex): MarkdownFootnote | undefined {
  return index.footnotes.get(labelKey(read(source, node.from + 2, node.to - 1)));
}
