import { BlockContext, LeafBlock, MarkdownExtension } from "@lezer/markdown";

const baseIndents = new WeakMap<BlockContext, number>();
const listIndents = new WeakMap<LeafBlock, number>();

/** Live editing accepts a new list before it has content, and ends a list
 * when the next row no longer carries its indentation. Keep these decisions
 * in the shared parser so styling, preview, folding and keyboard edits agree. */
export const markdownLineBoundaries: MarkdownExtension = {
  parseBlock: [{
    name: "MarkdownLineBoundaries",
    before: "SetextHeading",
    parse(context, line) {
      // This runs after composite markers have established the content column.
      // Use columns, rather than source offsets, to handle tabs and quotes.
      baseIndents.set(context, line.baseIndent);
      return false;
    },
    leaf(context, leaf) {
      for (let depth = context.depth - 1; depth > 0; depth--) {
        if (context.parentType(depth).name === "ListItem") {
          listIndents.set(leaf, baseIndents.get(context) ?? 0);
          break;
        }
      }
      return null;
    },
    endLeaf(_context, line, leaf) {
      const indent = listIndents.get(leaf);
      if (indent !== undefined && line.baseIndent < indent) return true;
      // CommonMark excludes empty bullets and non-1 ordered markers from
      // paragraph interruptions. In an editor those are valid in-progress
      // lists. In particular, a lone '-' must not become a Setext underline.
      return /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/u.test(line.text.slice(line.pos));
    },
  }],
};
