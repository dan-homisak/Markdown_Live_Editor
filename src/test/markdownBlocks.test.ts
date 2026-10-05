import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { Tree, TreeFragment } from "@lezer/common";
import {
  classifyMarkdownBlocks, markdownBlockLanguageExtensions, markdownCodeLanguages,
  MarkdownBlockProjection,
} from "../editor/markdown/markdownBlocks";
import { findMarkdownFrontmatter, markdownFrontmatterParserExtension } from "../editor/markdown/markdownBlockSyntax";
import { getParsedTables } from "../shared/tableModel";

const support = markdown({
  extensions: [markdownFrontmatterParserExtension, markdownBlockLanguageExtensions],
  codeLanguages: markdownCodeLanguages,
});
const parser = support.language.parser;
const doc = (source: string): Text => Text.of(source.split("\n"));
function project(source: string): MarkdownBlockProjection {
  const text = doc(source);
  return classifyMarkdownBlocks(text, parser.parse(source), getParsedTables(text));
}
function rowClasses(projection: MarkdownBlockProjection, source: string, line: number): string {
  return projection.rows.find(row => row.from === doc(source).line(line).from)?.classes ?? "";
}
function tokens(projection: MarkdownBlockProjection, source: string, role: string): string[] {
  return projection.marks.filter(mark => mark.classes.includes(`block-token-${role}`))
    .map(mark => source.slice(mark.from, mark.to));
}

for (const aliases of [
  ["javascript", "js", "nodejs"], ["typescript", "ts"], ["json"],
  ["bash", "sh", "shell"], ["python", "py"], ["yaml", "yml"],
]) {
  const language = markdownCodeLanguages(aliases[0]);
  assert(language, `bundled language ${aliases[0]}`);
  for (const alias of aliases) assert.equal(markdownCodeLanguages(` ${alias.toUpperCase()} more-info`), language);
}
for (const unsupported of ["", "unknown", "jsx", "tsx", "toml", "js{meta}"]) {
  assert.equal(markdownCodeLanguages(unsupported), null, `no implicit language for ${unsupported}`);
}
assert.notEqual(markdownCodeLanguages("js"), markdownCodeLanguages("ts"));

for (const source of ["---\na: 1\n---", "\ufeff--- \t\na: 1\n---\t \nrest", "---\n---\n"]) {
  assert.match(parser.parse(source).toString(), /MarkdownFrontmatter\(/);
}
for (const source of ["---\na: 1", "\n---\na: 1\n---", " ---\na: 1\n---", "+++\na: 1\n+++", "---\na: 1\n ---", "---\r \na: 1\n---"]) {
  assert.doesNotMatch(parser.parse(source).toString(), /MarkdownFrontmatter\(/);
}
assert.match(parser.parse("---\nkey: value").toString(), /HorizontalRule/,
  "unterminated frontmatter retains ordinary Markdown interpretation");

const longCandidate = "---\n" + "x".repeat(150_000) + "\n---\nend";
let maxRead = 0;
let reads = 0;
const bounded = findMarkdownFrontmatter({ length: longCandidate.length, read(from, to) {
  reads++;maxRead = Math.max(maxRead, to - from); return longCandidate.slice(from, to);
} });
assert(bounded);assert.equal(bounded.closingFrom, 150_005);assert(maxRead <= 4096);
assert(reads <= Math.ceil(longCandidate.length / 4096));

const parseA = parser.startParse("---\na: 1\n---\nA");
const parseB = parser.startParse("B\n---\nC");
let treeA: Tree | null = null, treeB: Tree | null = null;
while (!treeA || !treeB) { if (!treeA) treeA = parseA.advance(); if (!treeB) treeB = parseB.advance(); }
assert.match(treeA.toString(), /MarkdownFrontmatter/);assert.doesNotMatch(treeB.toString(), /MarkdownFrontmatter/);

const code = "before\n\n```JS extra\nconst answer = 42;\n\n// note\n```\n\nafter\n";
const codeProjection = project(code);
for (const number of [3, 4, 5, 6, 7]) assert.match(rowClasses(codeProjection, code, number), /block-code/);
for (const number of [1, 2, 8, 9]) assert.equal(rowClasses(codeProjection, code, number), "");
assert.match(rowClasses(codeProjection, code, 3), /block-start/);
assert.match(rowClasses(codeProjection, code, 7), /block-end/);
assert(tokens(codeProjection, code, "declaration").includes("const"));
assert(tokens(codeProjection, code, "constant").includes("42"));
assert(tokens(codeProjection, code, "comment").includes("// note"));
for (const mark of codeProjection.marks) {
  assert.equal(doc(code).lineAt(mark.from).number, doc(code).lineAt(mark.to).number,
    "passive code wrappers never cross source newlines or consume the next line's attributes");
}
const multilineShell = '```bash\n# shell comment\necho "$HOME"\n```';
const shellProjection = project(multilineShell);
assert.match(rowClasses(shellProjection, multilineShell, 3), /block-code/);
assert(shellProjection.marks.some(mark => multilineShell.slice(mark.from, mark.to) === 'echo "$HOME"' && mark.classes === "mlrt-markdown-block-code-source"));
assert(shellProjection.marks.every(mark => !multilineShell.slice(mark.from, mark.to).includes("\n")));
const unclosed = "```js\nconst x = 1;\n";
assert(!project(unclosed).rows.some(row => row.classes.includes("block-end")), "no invented closing edge");
const unknown = "```not-a-language\nconst answer = 42;\n```";
assert(project(unknown).rows.every(row => row.classes.includes("block-code")));
assert(!project(unknown).marks.some(mark => mark.classes.includes("block-token-")));
const indented = "before\n\n    const answer = 42;\n\n    another line\n\nafter";
const indentProjection = project(indented);
assert.match(rowClasses(indentProjection, indented, 4), /block-code/, "blank indented-code row retains band");
assert(!indentProjection.marks.some(mark => mark.classes.includes("block-token-")), "indented code never guesses JavaScript");
assert(!indentProjection.rows.some(row => /block-(start|end)/u.test(row.classes)));

for (const [language, body, expectedRole, expectedText] of [
  ["ts", "const answer: number = 42", "declaration", "const"],
  ["json", '{"answer": 42, "ok": true}', "constant", "42"],
  ["shell", 'if true; then echo "hello"; fi', "keyword", "if"],
  ["py", "def answer():\n    return 42", "declaration", "def"],
  ["yml", "answer: 42\nflag: true", "constant", "42"],
]) {
  const source = `\`\`\`${language}\n${body}\n\`\`\``;
  assert(tokens(project(source), source, expectedRole).includes(expectedText), `${language} bundled token highlighting`);
}

const yaml = '---\nanswer: 42\nflag: true\nempty: null\ntext: "hello"\n# comment\n---\n';
const yamlProjection = project(yaml);
assert(yamlProjection.rows.every(row => row.classes.includes("block-frontmatter")));
assert(tokens(yamlProjection, yaml, "variable").includes("answer"), "YAML keys have variable role");
assert(tokens(yamlProjection, yaml, "constant").includes("42"));
assert(tokens(yamlProjection, yaml, "constant").includes("true"));
assert(tokens(yamlProjection, yaml, "constant").includes("null"));
assert(tokens(yamlProjection, yaml, "string").some(value => value.includes("hello")));
assert(tokens(yamlProjection, yaml, "comment").includes("# comment"));

for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
  const source = `> [!${type}]\n> text\nlazy continuation\n\nafter`;
  const projection = project(source);
  for (const number of [1, 2, 3]) assert.match(rowClasses(projection, source, number), new RegExp(`block-alert-${type.toLowerCase()}`));
  assert.equal(rowClasses(projection, source, 5), "");
  assert(projection.marks.some(mark => source.slice(mark.from, mark.to) === `[!${type}]` && mark.classes.includes("alert-label")));
}
for (const label of ["`[!NOTE]`", "prefix [!NOTE]"]) {
  const source = `> ${label}\n> text`;
  assert(project(source).rows.every(row => !row.classes.includes("block-alert")), label);
}
const delayed = "> before\n>\n> [!NOTE]\n> text";
assert(project(delayed).rows.every(row => !row.classes.includes("block-alert")), "alert must lead the quote");
const nested = "> [!WARNING]\n> outer\n>\n> > [!TIP]\n> > inner\n>\n> ```js\n> const x = 1;\n> ```";
const nestedProjection = project(nested);
assert.match(rowClasses(nestedProjection, nested, 1), /block-alert-warning/);
assert.match(rowClasses(nestedProjection, nested, 4), /block-alert-tip/);
assert.doesNotMatch(rowClasses(nestedProjection, nested, 4), /block-alert-warning/);
assert.match(rowClasses(nestedProjection, nested, 8), /block-code/, "code band owns fill within alert extent");
assert.match(rowClasses(nestedProjection, nested, 8), /block-quote/, "code rows retain enclosing quote ownership");
assert.match(rowClasses(nestedProjection, nested, 8), /block-alert-warning/, "code rows retain the enclosing alert guide role");

const tableFrontmatter = "---\nkey: 1\n\n| A | B |\n| --- | --- |\n| x | y |\n\nlast: true\n---\n";
const tableDoc = doc(tableFrontmatter), tables = getParsedTables(tableDoc);
assert.equal(tables.length, 1, "existing table ownership wins inside frontmatter");
const tableProjection = classifyMarkdownBlocks(tableDoc, parser.parse(tableFrontmatter), tables);
for (const row of tableProjection.rows) assert(!tables.some(table => row.from >= table.from && row.from < table.to));
for (const mark of tableProjection.marks) assert(!tables.some(table => mark.from < table.to && mark.to > table.from));
assert(tableProjection.rows.length > 0);assert(tableProjection.marks.length > 0);

const longCode = "```js\n" + Array.from({ length: 3000 }, (_, index) => `const item${index} = ${index};`).join("\n") + "\n```\nafter";
const longDoc = doc(longCode), longTree = parser.parse(longCode), first = longDoc.line(2500), last = longDoc.line(2503);
const visible = classifyMarkdownBlocks(longDoc, longTree, [], [{ from: first.from, to: last.to }]);
assert.equal(visible.rows.length, 4);assert(visible.rows.every(row => row.classes.includes("block-code")));
assert(!visible.rows.some(row => /block-(start|end)/u.test(row.classes)));
assert(visible.marks.every(mark => mark.from >= first.from && mark.to <= last.to));
const alertSource = "> [!NOTE]\n" + Array.from({ length: 1000 }, () => "lazy continuation").join("\n");
const alertDoc = doc(alertSource), alertFrom = alertDoc.line(900).from, alertTo = alertDoc.line(902).to;
const alertVisible = classifyMarkdownBlocks(alertDoc, parser.parse(alertSource), [], [{ from: alertFrom, to: alertTo }]);
assert.equal(alertVisible.rows.length, 3);assert(alertVisible.rows.every(row => row.classes.includes("block-alert-note")));

const closed = "---\nkey: value\n---\nafter", prior = parser.parse(closed), at = closed.lastIndexOf("---");
const opened = closed.slice(0, at) + "..." + closed.slice(at + 3);
const fragments = TreeFragment.applyChanges(TreeFragment.addTree(prior), [{ fromA: at, toA: at + 3, fromB: at, toB: at + 3 }]);
assert.doesNotMatch(parser.parse(opened, fragments).toString(), /MarkdownFrontmatter/, "closing delimiter edits invalidate the enclosing frontmatter");
const state = EditorState.create({ doc: code, extensions: [support] });
assert.equal(syntaxTree(state.update({ selection: { anchor: 2 } }).state), syntaxTree(state), "caret updates do not reparse syntax");

const css = fs.readFileSync(path.join(__dirname, "../../media/markdownBlocks.css"), "utf8");
// Live Preview intentionally reflows semantic blocks; table selectors remain isolated.
assert.doesNotMatch(css, /(?:^|\})\s*(?:table|thead|tbody|tr|th|td)(?:\s|[.{:#])/mu);
console.log("Markdown block rendering tests passed.");
