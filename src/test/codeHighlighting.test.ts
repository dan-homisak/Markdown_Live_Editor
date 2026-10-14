import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TextmateCodeHighlighter } from "../highlighting/textmateHighlighting";
import { codeTokenStyle, createVscodeCodeHighlighting } from "../editor/markdown/vscodeCodeHighlighting";
import { CodeHighlightRange, isCodeHighlightRequest } from "../shared/codeHighlighting";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createMarkdownRenderingExtensions } from "../editor/markdown/markdownRendering";
import { createBrowserCodeHighlighter } from "../editor/markdown/browserCodeHighlighting";

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
    const browser = await createBrowserCodeHighlighter(await highlighter.configuration(),
      (await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"))).toString("base64"));
    try {
      for (const snapshot of [source, changed, unknown, source]) {
        const requested = [range(snapshot, "const value"), range(snapshot, "const commented = 1;"), range(snapshot, "const after")];
        const actual = browser.highlight(Text.of(snapshot.split("\n")), requested);
        assert.deepEqual(actual, await highlighter.highlight(snapshot, requested),
          "synchronous browser tokens match host scopes on first visit, opener edits, language changes and undo");
      }
    } finally { browser.dispose(); }
    const native = createVscodeCodeHighlighting(() => { throw new Error("Rendering must not request viewport tokens"); });
    await native.initialize({ configuration: await highlighter.configuration(),
      wasm: (await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"))).toString("base64") });
    const distant = "Resting caret.\n\n" + "Prose without code.\n\n".repeat(900) + source;
    let state = EditorState.create({ doc: distant, extensions: [
      createMarkdownRenderingExtensions({ enabled: true, screenReaderOptimized: false, readOnly: false }), native.extension,
    ] });
    const colorAt = (snapshot: EditorState, needle: string): string | undefined => {
      const position = snapshot.doc.toString().indexOf(needle);
      let color: string | undefined;
      for (const set of snapshot.facet(EditorView.decorations)) if (typeof set !== "function") set.between(position, position + 1, (_from, _to, decoration) => {
        if (decoration.spec.class === "mlrt-vscode-code-token") color = decoration.spec.attributes.style;
      });
      return color;
    };
    assert.match(colorAt(state, "const commented")!, /#008000/, "distant code has final tokens in document state before a viewport exists");
    const start = distant.indexOf("/* offscreen opener");
    state = state.update({ changes: { from: start, to: start + 2, insert: "  " } }).state;
    assert.match(colorAt(state, "const commented")!, /#AA00AA/, "editing an offscreen opener changes downstream tokens in the same transaction");
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
