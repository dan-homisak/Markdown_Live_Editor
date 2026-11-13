import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseMarkdownTables, rowToDisplayValues } from "../shared/tableModel";

// Test fixtures are purpose-built, frozen inputs. This file guards three things:
//   1. nothing in test/fixtures changed without its manifest entry;
//   2. each fixture still provides what the checks that read it rely on (its contract);
//   3. no test or script reads the sample documents, which people edit freely.
// See test/fixtures/README.md.
const root = path.resolve(__dirname, "..", "..");
const fixturesDir = path.join(root, "test", "fixtures");
const read = (name: string) =>
  fs.readFileSync(path.join(fixturesDir, name), "utf8").replace(/\r\n?/g, "\n");

// ---------- 1. Manifest ----------

const manifest = JSON.parse(read("manifest.json")) as { files: Record<string, string> };
const present = fs
  .readdirSync(fixturesDir)
  .filter((name) => name !== "manifest.json" && name !== "README.md")
  .sort();

assert.deepEqual(
  present,
  Object.keys(manifest.files).sort(),
  "test/fixtures and its manifest list different files; run `npm run fixtures:manifest` after adding or removing a fixture on purpose",
);
for (const name of present) {
  assert.equal(
    createHash("sha256").update(read(name), "utf8").digest("hex"),
    manifest.files[name],
    `test fixture ${name} changed. Fixtures are frozen: restore it, or, if the change is deliberate, update the tests that depend on it and run \`npm run fixtures:manifest\``,
  );
}

// ---------- 2. Contracts ----------

// markdown-constructs.md: one section per construct, found by heading or by identifier.
{
  const text = read("markdown-constructs.md");
  const headings = text.split("\n").filter((line) => /^## [A-Z]/.test(line) && !/^## MC-/.test(line));
  assert.deepEqual(headings, [
    "## Headings", "## Paragraphs", "## Emphasis", "## Inline Code", "## Links", "## Images",
    "## Blockquotes", "## Callouts", "## Lists", "## Task Lists", "## Tables", "## Code Blocks",
    "## Horizontal Rules", "## Escapes And Entities", "## HTML", "## Math", "## Footnotes", "## End",
  ], "markdown-constructs.md must keep its section headings; host checks scroll to them by name");
  assert.ok(text.startsWith("---\ntitle: Markdown constructs\n"), "frontmatter opens the constructs fixture");
  assert.ok(text.includes("\n# Markdown constructs\n"), "host checks scroll to the title heading");
  assert.equal(text.split("\n").filter((line) => line === "[TOC]").length, 1, "exactly one generated contents marker");
  assert.ok(text.includes("\n> [!NOTE]\n"), "host checks scroll to the first callout");
  assert.equal([...text.matchAll(/^\[\^[a-z]+\]: /gm)].length, 2, "exactly two footnote definitions");
  assert.ok(text.includes("\n    Indented continuation text"), "a footnote keeps an indented continuation paragraph");
  assert.ok(/ {2}\n/.test(text), "a hard line break written with two trailing spaces must survive editing tools");
  const ids = [...text.matchAll(/\bMC-[A-Z]+-\d{2}\b/g)].map((match) => match[0]);
  assert.ok(ids.length >= 60, "the constructs fixture keeps its cases");
  assert.equal(new Set(ids).size, ids.length, "every constructs case identifier appears exactly once");
}

// code-languages.md: nine fenced blocks in a fixed order, JavaScript first.
{
  const text = read("code-languages.md");
  const languages = [...text.matchAll(/^```([a-z]+)\n/gm)].map((match) => match[1]);
  assert.deepEqual(languages, ["js", "ts", "html", "css", "json", "sh", "python", "md", "diff", "txt"],
    "code-languages.md must keep its ten fences in order; the highlighting check compares the first nine");
  const firstBody = /^```js\n([^\n]*)\n/m.exec(text)?.[1] ?? "";
  assert.ok(firstBody.startsWith("// "), "the JavaScript block starts with a line comment; the check types a comment there");
  for (const [, language, body] of text.matchAll(/^```([a-z]+)\n([\s\S]*?)^```$/gm)) {
    assert.ok(body.trim().length > 0, `the ${language} block is not empty`);
    assert.ok(!/[ \t]+$/m.test(body), `the ${language} block has no trailing whitespace to confuse per-character comparison`);
  }
}

// table-cells.md: every table has four columns and every row carries its identifier.
{
  const text = read("table-cells.md");
  const tables = parseMarkdownTables(text);
  assert.ok(tables.length >= 6, "table-cells.md keeps its tables");
  const ids: string[] = [];
  for (const table of tables) {
    assert.equal(table.columnCount, 4, "every table in table-cells.md has four columns, so the cell under test is column index 2");
    for (const row of table.body) {
      const id = rowToDisplayValues(row, table.columnCount)[0];
      assert.match(id, /^TC-[A-Z]+-\d{2}$/, `row ${JSON.stringify(id)} must start with its case identifier`);
      ids.push(id);
    }
  }
  assert.equal(new Set(ids).size, ids.length, "every table-cells case identifier is defined once");
  const lines = text.split("\n");
  const deep = lines.findIndex((line) => line.startsWith("| TC-NAV-01 |"));
  const wrapping = lines.findIndex((line) => line.startsWith("| TC-NAV-02 |"));
  assert.ok(deep > 0 && wrapping === deep + 1, "TC-NAV-01 and TC-NAV-02 are adjacent rows");
  assert.ok(lines[deep].includes("<li>Level 6</li>"), "TC-NAV-01 ends in a six-level nested list");
  const wrapCell = lines[wrapping].split(" | ")[2];
  assert.equal(wrapCell.indexOf(" **bold text**"), 35, "TC-NAV-02 has exactly 35 characters before its bold text; the arrow regression lands there");
}

// ---------- 3. Samples are not test inputs ----------

const sampleReference = new RegExp(`["'\`/\\\\]${"sam" + "ples"}["'\`/\\\\]`);
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}
for (const file of [...sources(path.join(root, "src", "test")), ...sources(path.join(root, "scripts"))]) {
  assert.ok(
    !sampleReference.test(fs.readFileSync(file, "utf8")),
    `${path.relative(root, file)} refers to the sample documents. Samples are edited freely and are never test input; use or add a fixture in test/fixtures instead`,
  );
}

console.log(`Fixtures intact: ${present.length} frozen fixtures match their manifest and keep their contracts; no test reads the samples.`);
