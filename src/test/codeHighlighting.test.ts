import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TextmateCodeHighlighter } from "../highlighting/textmateHighlighting";
import { codeTokenStyle } from "../editor/markdown/vscodeCodeHighlighting";
import { CodeHighlightRange, isCodeHighlightRequest } from "../shared/codeHighlighting";

function range(source: string, needle: string): CodeHighlightRange {
  const from = source.indexOf(needle);
  assert(from >= 0);
  return { from, to: from + needle.length, text: needle };
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mlrt-textmate-test-"));
  let highlighter: TextmateCodeHighlighter | undefined;
  try {
    const markdown = path.join(directory, "markdown.json"), code = path.join(directory, "code.json");
    await writeFile(markdown, JSON.stringify({ scopeName: "text.html.markdown", patterns: [
      { begin: "^```js$", end: "^```$", contentName: "meta.embedded.block.javascript", patterns: [{ include: "source.test" }] },
    ] }));
    await writeFile(code, JSON.stringify({ scopeName: "source.test", patterns: [
      { begin: "/\\*", end: "\\*/", name: "comment.block.test" },
      { match: "\\bconst\\b", name: "keyword.control.test" },
      { begin: '"', end: '"', name: "string.quoted.test" },
    ] }));
    highlighter = new TextmateCodeHighlighter([
      { scopeName: "text.html.markdown", path: markdown, language: "markdown" },
      { scopeName: "source.test", path: code },
    ], { settings: [
      { settings: { foreground: "#111111", background: "#FFFFFF" } },
      { scope: "keyword.control", settings: { foreground: "#0000FF" } },
      { scope: "text.html.markdown keyword.control", settings: { foreground: "#AA00AA", fontStyle: "bold" } },
      { scope: "comment", settings: { foreground: "#008000", fontStyle: "italic" } },
      { scope: "string", settings: { foreground: "#A31515", fontStyle: "underline strikethrough" } },
    ] }, require.resolve("vscode-oniguruma/release/onig.wasm"));
    const source = 'Intro\n```js\nconst value = "string";\n/* offscreen opener\nconst commented = 1;\n*/\nconst after = 2;\n```\nconst prose';
    const comment = range(source, "const commented = 1;");
    assert.deepEqual(await highlighter.highlight(source, [comment]), [
      { from: comment.from, to: comment.to, color: "#008000", fontStyle: 1 },
    ], "offscreen multiline comment context is preserved");
    const first = range(source, "const value"), after = range(source, "const after");
    const tokens = await highlighter.highlight(source, [first, after]);
    assert.equal(tokens[0].color, "#AA00AA", "outer Markdown scopes participate in the theme match");
    assert.equal(tokens[0].fontStyle, 2);
    assert(tokens.some(token => token.from === after.from && token.color === "#AA00AA"));
    assert(tokens.every(token => [first, after].some(range => token.from >= range.from && token.to <= range.to)), "tokens are clipped to requested windows");
    const changed = source.replace("/* offscreen opener", "plain changed opener");
    const changedComment = range(changed, "const commented = 1;");
    assert.equal((await highlighter.highlight(changed, [changedComment]))[0].color, "#AA00AA", "an offscreen edit invalidates cached downstream grammar states");
    assert.equal((await highlighter.highlight(source, [comment]))[0].color, "#008000", "undo restores grammar state");
    const unknown = source.replace("```js", "```unknown");
    assert.equal((await highlighter.highlight(unknown, [range(unknown, "const value")]))[0].color, "#111111", "unknown fence languages follow the Markdown grammar");
    const prose = range(source, "const prose");
    assert.equal((await highlighter.highlight(source, [prose]))[0].color, "#111111", "embedded language stops at the closing fence");
    assert.deepEqual(await highlighter.highlight(source, []), []);
    const style = codeTokenStyle({ from: 0, to: 1, color: "#A31515", fontStyle: 15 });
    assert.match(style, /font-style:italic/); assert.match(style, /font-weight:bold/);
    assert.match(style, /text-decoration:underline line-through/);
    const request = { type: "requestCodeHighlighting", id: 1, ranges: [first] };
    assert(isCodeHighlightRequest(request));
    for (const override of [{ id: 0 }, { id: 0.5 }, { ranges: [{ ...first, to: first.to + 1 }] },
      { ranges: [{ from: -1, to: 1, text: "xx" }] }, { themeName: {} }]) {
      assert.equal(isCodeHighlightRequest({ ...request, ...override }), false);
    }
    console.log("Native TextMate code highlighting tests passed: embedded scopes, multiline state, edits/undo, clipping, unknown languages, font styles, and message validation.");
  } finally {
    highlighter?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
