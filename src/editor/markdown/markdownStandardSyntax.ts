import { MarkdownExtension } from "@lezer/markdown";

/** These constructs belong to the editor's incremental tree, including their
 * continuation rows. They must never fall through to reference links/code. */
export const markdownStandardSyntax: MarkdownExtension = {
  defineNodes: [
    { name: "MarkdownTOC", block: true },
    { name: "FootnoteDefinition", block: true, composite(_context, line) {
      if (line.pos === line.text.length) return true;
      if (line.indent < line.baseIndent + 4) return false;
      line.moveBaseColumn(line.baseIndent + 4);
      return true;
    } },
    "FootnoteLabel", "FootnoteReference",
  ],
  parseBlock: [{
    name: "MarkdownStandard", before: "LinkReference",
    parse(context, line) {
      if (line.indent >= line.baseIndent + 4) return false;
      const tail = line.text.slice(line.pos), from = context.lineStart + line.pos;
      if (/^\[toc\][ \t]*$/iu.test(tail)) {
        context.addElement(context.elt("MarkdownTOC", from, context.lineStart + line.text.length));
        context.nextLine();
        return true;
      }
      const match = /^\[\^([^\]\s]+)\]:[ \t]*/u.exec(tail);
      if (!match) return false;
      context.startComposite("FootnoteDefinition", line.pos);
      context.addElement(context.elt("FootnoteLabel", from, from + match[0].length));
      line.moveBase(line.pos + match[0].length);
      return null;
    },
  }],
  parseInline: [{
    name: "FootnoteReference", before: "Link",
    parse(context, next, from) {
      if (next !== 91 || context.char(from + 1) !== 94) return -1;
      const match = /^\[\^([^\]\s]+)\]/u.exec(context.slice(from, context.end));
      return match ? context.addElement(context.elt("FootnoteReference", from, from + match[0].length)) : -1;
    },
  }],
};
