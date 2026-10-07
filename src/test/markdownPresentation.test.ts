import assert from "node:assert/strict";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { classifyMarkdownPresentation, markdownPresentationDecorations, markdownInlineCodeDecorations, MarkdownPresentationRun } from "../editor/markdown/markdownPresentation";
import { markdownFrontmatterParserExtension } from "../editor/markdown/markdownBlockSyntax";
import { markdownParserExtensions, markdownRenderingParser } from "../editor/markdown/markdownSyntax";
import { compositeMarkdownColor, markdownContrast, parseMarkdownColor, resolveMarkdownTheme } from "../editor/markdown/presentationTheme";
import { parseMarkdownTables } from "../shared/tableModel";

function classify(source: string) {
  return classifyMarkdownPresentation(source, markdownRenderingParser.parse(source), parseMarkdownTables(source));
}
function classesAt(runs: readonly MarkdownPresentationRun[], position: number): string {
  return runs.find(run => run.from <= position && run.to > position)?.className ?? "";
}
function has(runs: readonly MarkdownPresentationRun[], position: number, role: string): boolean {
  return classesAt(runs, position).split(" ").includes(`mlrt-markdown-${role}`);
}

const mixed = "## **Important** [deployment](./deploy.md \"title\") `settings` ##";
const mixedRuns = classify(mixed);
for (let level = 1; level <= 6; level++) {
  const heading = '#'.repeat(level) + ' Heading';
  const runs = classify(heading);
  assert(has(runs, 0, `heading-${level}`) && has(runs, heading.indexOf('Heading'), `heading-${level}`));
}
const headingColors = resolveMarkdownTheme({ colors: { 'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4' }, dark: true, highContrast: false });
assert.equal(new Set(Array.from({ length: 6 }, (_, index) => headingColors[`--mlrt-markdown-heading-${index + 1}`])).size, 6, 'Dark+ heading levels have distinct colors');
assert.ok(has(mixedRuns, 0, "bold") && has(mixedRuns, 0, "role-heading"));
assert.ok(has(mixedRuns, mixed.indexOf("Important"), "bold"));
assert.ok(has(mixedRuns, mixed.indexOf("deployment"), "bold") && has(mixedRuns, mixed.indexOf("deployment"), "role-link"));
assert.ok(has(mixedRuns, mixed.indexOf("./deploy"), "role-destination"));
assert.ok(has(mixedRuns, mixed.indexOf("title"), "role-title"));
assert.ok(has(mixedRuns, mixed.indexOf("**"), "role-punctuation"));
assert.ok(has(mixedRuns, mixed.indexOf("settings"), "role-code"));
assert.ok(!has(mixedRuns, mixed.indexOf("settings"), "bold"), "code resets heading weight explicitly");
assert.ok(has(mixedRuns, mixed.indexOf("`"), "role-punctuation") && has(mixedRuns, mixed.indexOf("`"), "inline-code"));
assert.ok(mixedRuns.every((run, index) => index === 0 || mixedRuns[index - 1].to <= run.from), "runs must be disjoint");
assert.equal(mixed, "## **Important** [deployment](./deploy.md \"title\") `settings` ##", "classification retains literal source");

const codeSurfaces: { from: number; to: number }[] = [];
markdownInlineCodeDecorations(Text.of([mixed]), mixedRuns).between(0, mixed.length, (from, to) => { codeSurfaces.push({ from, to }); });
assert.deepEqual(codeSurfaces, [{ from: mixed.indexOf("`settings`"), to: mixed.indexOf("`settings`") + 10 }],
  "one surface includes the content and both independently styled source backticks");

const nested = "***all*** ~~strike *italic*~~ and `  exact  ` unmatched **";
const nestedRuns = classify(nested);
assert.ok(has(nestedRuns, nested.indexOf("all"), "bold") && has(nestedRuns, nested.indexOf("all"), "italic"));
assert.ok(has(nestedRuns, nested.indexOf("italic"), "italic") && has(nestedRuns, nested.indexOf("italic"), "strike"));
assert.ok(!has(nestedRuns, 0, "bold") && !has(nestedRuns, 0, "italic"), "outer delimiters do not acquire their own style");
assert.ok(has(nestedRuns, nested.indexOf("  exact  "), "inline-code"), "code fill includes exact leading spaces");
assert.equal(classesAt(nestedRuns, nested.length - 1), "", "unmatched punctuation stays ordinary editable source");
const setext = "Title *words*\n===\n\nOther\n---\n";
const setextRuns = classify(setext);
assert.ok(has(setextRuns, setext.indexOf("==="), "role-heading") && has(setextRuns, setext.indexOf("==="), "bold"));
assert.ok(has(setextRuns, setext.indexOf("---"), "role-heading"), "Setext underline keeps heading styling");
assert.ok(has(setextRuns, setext.indexOf("words"), "italic") && has(setextRuns, setext.indexOf("words"), "bold"));
const multiline = Text.of(["Heading **bold", "continuation**", "===", "", "`first", "second`"]);
const multilineRuns = classifyMarkdownPresentation(multiline, markdownRenderingParser.parse(multiline.toString()));
const rowMarks = markdownPresentationDecorations(multiline, multilineRuns);
assert(rowMarks.size > 0);
rowMarks.between(0, multiline.length, (from, to) => {
  assert.equal(multiline.lineAt(from).number, multiline.lineAt(Math.max(from, to - 1)).number,
    "DOM marks never cross source newlines or interfere with CodeMirror line attributes");
  assert(!multiline.sliceString(from, to).includes("\n"));
});

const links = '[label][ref] ![alt](image.png "title") <https://example.com> <a@example.com> https://example.com\n\n[ref]: <./target> "Title"';
const linkRuns = classify(links);
for (const text of ["label", "ref", "alt", "https://", "a@example"]) assert.ok(has(linkRuns, links.indexOf(text), "role-link"));
assert.ok(has(linkRuns, links.indexOf("image.png"), "role-destination"));
assert.ok(has(linkRuns, links.indexOf("./target"), "role-destination"));
assert.ok(has(linkRuns, links.indexOf("<./target>"), "role-punctuation"));
assert.ok(linkRuns.every(run => !run.className.includes("actionable")), "readable syntax never implies an opening action");

const literal = "```markdown\n# **fenced**\n```\n\n    # **indented**\n\n\\*escaped\\* &copy;\n";
assert.deepEqual(classify(literal), [], "code blocks belong to the block owner; escapes/entities preserve spelling");
const frontmatter = "---\nkey: '**literal**'\n---\n\n# Heading";
const fmTree = markdownRenderingParser.configure(markdownFrontmatterParserExtension).parse(frontmatter);
const fmRuns = classifyMarkdownPresentation(frontmatter, fmTree);
assert.ok(fmRuns.length > 0 && fmRuns.every(run => run.from >= frontmatter.indexOf("# Heading")), "frontmatter is exclusively block-owned");
const alerts = "> [!NOTE]\n> body\n\n> [!TIP]\n> tip\n\n> [!unknown]\n> plain";
const alertRuns = classify(alerts);
assert.equal(classesAt(alertRuns, alerts.indexOf("NOTE")), "", "valid alert labels belong to the block owner despite Lezer shortcut Link nodes");
assert.equal(classesAt(alertRuns, alerts.indexOf("TIP")), "");
assert.equal(classesAt(alertRuns, alerts.indexOf("unknown")), "", "custom Obsidian callouts use the block owner and default note styling");

const html = '## <span title="x">**bold**</span> <!-- note -->\n\n<div a="b">\n# literal\n</div>\n';
const htmlState = EditorState.create({ doc: html, extensions: markdown({ extensions: markdownParserExtensions }) });
const htmlTree = ensureSyntaxTree(htmlState, html.length, 1000)!;
assert.ok(htmlTree);
const htmlRuns = classifyMarkdownPresentation(htmlState.doc, htmlTree);
assert.ok(has(htmlRuns, html.indexOf("span"), "role-tag"), "literal HTML reuses installed mounted token tree");
assert.ok(has(htmlRuns, html.indexOf("title"), "role-variable"));
assert.ok(has(htmlRuns, html.indexOf('"x"'), "role-string"));
assert.ok(has(htmlRuns, html.indexOf("bold"), "bold"), "inline closing/opening HTML does not suppress following prose");
assert.ok(has(htmlRuns, html.indexOf("note"), "role-comment"));
assert.ok(!has(htmlRuns, html.indexOf("# literal"), "role-heading"), "HTML block prose remains literal");

const tables = "# before\n\n| **header** | `code` |\n| --- | --- |\n| [label](x) | <b>html</b> |\n\n# after";
const protectedRanges = parseMarkdownTables(tables);
const tableRuns = classify(tables);
assert.ok(protectedRanges.length);
assert.ok(tableRuns.every(run => protectedRanges.every(table => run.to <= table.from || run.from >= table.to)), "every decoration path excludes table source");
const ancestor = "# abc **def** ghi";
const clipped = classifyMarkdownPresentation(ancestor, markdownRenderingParser.parse(ancestor), [{ from: 5, to: 12 }]);
assert.ok(clipped.every(run => run.to <= 5 || run.from >= 12), "ancestor style is split around protected source");

const huge = `${"ordinary\n".repeat(10000)}## **visible** tail\n${"ordinary\n".repeat(10000)}`;
const hugeTree = markdownRenderingParser.parse(huge);
const from = huge.indexOf("visible"), to = from + 7;
let readCount = 0, totalRead = 0;
const reader = { length: huge.length, sliceString(start: number, end = huge.length) { readCount++; totalRead += end - start; return huge.slice(start, end); } };
const bounded = classifyMarkdownPresentation(reader, hugeTree, [], [{ from, to }, { from: from + 1, to }]);
assert.ok(bounded.length && bounded.every(run => run.from >= from && run.to <= to));
assert.ok(has(bounded, from, "bold") && has(bounded, from, "role-heading"), "offscreen enclosing styles survive viewport clipping");
assert.ok(readCount < 10 && totalRead < 30, "viewport classification does not materialize distant document source");
assert.deepEqual(classifyMarkdownPresentation(Text.of(ancestor.split("\n")), markdownRenderingParser.parse(ancestor)), classify(ancestor));

assert.deepEqual(parseMarkdownColor("#abc8"), { r: 170, g: 187, b: 204, a: 136 / 255 });
assert.deepEqual(parseMarkdownColor("rgb(100% 0% 0% / 25%)"), { r: 254.99999999999997, g: 0, b: 0, a: 0.25 });
assert.equal(parseMarkdownColor("color(display-p3 1 0 0)"), null);
assert.equal(parseMarkdownColor("rgba(nope)"), null);
assert.equal(markdownContrast(parseMarkdownColor("#fff")!, parseMarkdownColor("#000")!), 21);
const textRoles = ["foreground", "heading", "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6", "link", "destination", "title", "punctuation", "inline-code-foreground",
  "code-foreground", "code-comment", "code-constant", "code-declaration", "code-keyword", "code-string", "code-variable", "code-tag",
  "alert-note", "alert-tip", "alert-important", "alert-warning", "alert-caution"];
for (const background of ["#0d1117", "#ffffff", "#1e1e1e", "#777777", "#7e7770", "#ffccdd", "#003300"]) {
  for (const highContrast of [false, true]) {
    const colors = {
      "editor.background": background, "editor.foreground": "#787878", "textLink.foreground": "rgba(240, 10, 10, 0.2)",
      "descriptionForeground": "transparent", "textPreformat.foreground": "#888888",
      "textPreformat.background": "#000000", "textCodeBlock.background": "#ffffff", "checkbox.background": "#ffffff",
    };
    const roles = resolveMarkdownTheme({ colors, dark: true, highContrast });
    const canvas = parseMarkdownColor(background)!;
    const surfaces = [canvas, compositeMarkdownColor(parseMarkdownColor(roles["--mlrt-markdown-background"])!, canvas),
      compositeMarkdownColor(parseMarkdownColor(roles["--mlrt-markdown-inline-code-background"])!, canvas)];
    for (const role of textRoles) {
      const color = parseMarkdownColor(roles[`--mlrt-markdown-${role}`])!;
      assert.ok(color, `parse emitted ${role}`);
      for (const surface of surfaces) assert.ok(markdownContrast(color, surface) >= 4.499,
        `${background} highContrast=${highContrast}: ${role} must reach 4.5:1 on its composited surface`);
    }
    if (highContrast) {
      assert.equal(parseMarkdownColor(roles["--mlrt-markdown-background"])!.a, 0);
      assert.equal(parseMarkdownColor(roles["--mlrt-markdown-inline-code-background"])!.a, 0);
      assert.match(roles["--mlrt-markdown-inline-code-outline"], /^inset/);
    }
    assert.ok(markdownContrast(parseMarkdownColor(roles["--mlrt-markdown-task-mark"])!,
      compositeMarkdownColor(parseMarkdownColor(roles["--mlrt-markdown-task-fill"])!, canvas)) >= 4.499);
  }
}
console.log("Markdown readable-source presentation tests passed.");
