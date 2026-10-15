import { Text } from "@codemirror/state";
import { markdownRenderingParser } from "../markdown/markdownSyntax";
import { classifyMarkdownPresentation } from "../markdown/markdownPresentation";
import { classifyMarkdownPreview } from "../markdown/markdownLivePreview";

export interface MarkdownCellRun { from: number; to: number; text: string; className: string }

/** The table remains the sole owner of its source. Parse only this cell, on
 * mount/blur, using the same grammar and semantic styles as ordinary prose. */
export function markdownCellPresentation(value: string): MarkdownCellRun[] {
  const doc = Text.of(value.split("\n")), tree = markdownRenderingParser.parse(value);
  const styles = classifyMarkdownPresentation(value, tree);
  const parts = classifyMarkdownPreview(doc, tree, [], [{ from: 0, to: value.length }])
    .filter(part => {
      if (part.kind !== "hide" && part.kind !== "text") return false;
      const owner = tree.resolveInner(part.owner.from, 1);
      for (let node = owner; node; node = node.parent!) {
        if (["FencedCode", "CodeBlock", "Blockquote", "ListItem", "MarkdownTOC", "FootnoteDefinition"].includes(node.name)) return false;
      }
      return true;
    });
  const cuts = new Set([0, value.length]);
  for (const range of [...styles, ...parts]) { cuts.add(range.from); cuts.add(range.to); }
  const positions = [...cuts].sort((a, b) => a - b), runs: MarkdownCellRun[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const from = positions[i], to = positions[i + 1], part = parts.find(part => part.from <= from && part.to >= to);
    if (part?.kind === "hide") continue;
    // An entity is an indivisible source-to-glyph replacement.
    if (part?.kind === "text" && part.from !== from) continue;
    runs.push({ from, to: part?.kind === "text" ? part.to : to,
      text: part?.kind === "text" ? part.label ?? "" : value.slice(from, to),
      className: styles.find(style => style.from <= from && style.to >= to)?.className ?? "" });
  }
  return runs;
}
