import { MarkdownExtension } from "@lezer/markdown";

/** Wikilinks participate in the same inline parser, so code/HTML escaping wins. */
export const markdownWikiExtension: MarkdownExtension = {
  defineNodes: ["WikiLink", "WikiEmbed", "WikiMark", "WikiTarget", "WikiLabel"],
  parseInline: [{
    name: "WikiLink", before: "Link",
    parse(context, next, position) {
      const embed = next === 33 && context.char(position + 1) === 91;
      const start = position + (embed ? 1 : 0);
      if (context.char(start) !== 91 || context.char(start + 1) !== 91) return -1;
      let separator = -1, end = -1;
      for (let i = start + 2; i < context.end; i++) {
        const ch = context.char(i);
        if (ch === 10 || ch === 13 || ch === 91) return -1;
        if (ch === 92) { i++; continue; }
        if (ch === 124 && separator < 0) separator = i;
        if (ch === 93 && context.char(i + 1) === 93) { end = i; break; }
      }
      if (end < 0 || !context.slice(start + 2, separator < 0 ? end : separator).trim()) return -1;
      const children = [context.elt("WikiMark", position, start + 2),
        context.elt("WikiTarget", start + 2, separator < 0 ? end : separator)];
      if (separator >= 0) children.push(context.elt("WikiMark", separator, separator + 1),
        context.elt("WikiLabel", separator + 1, end));
      children.push(context.elt("WikiMark", end, end + 2));
      return context.addElement(context.elt(embed ? "WikiEmbed" : "WikiLink", position, end + 2, children));
    },
  }],
};
