import { readFile } from "node:fs/promises";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { IGrammar, IRawTheme, parseRawGrammar, Registry, StateStack } from "vscode-textmate";
import { CodeHighlightRange, CodeHighlightToken } from "../shared/codeHighlighting";

export interface GrammarFile {
  readonly scopeName: string;
  readonly path: string;
  readonly language?: string;
  readonly injectTo?: readonly string[];
}

let oniguruma: Promise<void> | undefined;
interface CachedLine {
  text: string;
  tokens: Uint32Array;
  stack: StateStack;
}

/** Tokenize the Markdown document, including its embedded-language context,
 * with the same TextMate engine as Monaco. Never tokenize fences in isolation:
 * themes can match both the outer Markdown scope and the embedded language. */
export class TextmateCodeHighlighter {
  private readonly registry: Registry;
  private readonly grammar: Promise<IGrammar | null>;
  private lines: CachedLine[] = [];
  constructor(files: readonly GrammarFile[], theme: IRawTheme, wasmPath: string) {
    const byScope = new Map(files.map(file => [file.scopeName, file]));
    oniguruma ??= readFile(wasmPath).then(bytes => loadWASM(bytes));
    this.registry = new Registry({
      theme,
      onigLib: oniguruma.then(() => ({ createOnigScanner, createOnigString })),
      loadGrammar: async scope => {
        const file = byScope.get(scope);
        return file ? parseRawGrammar(await readFile(file.path, "utf8"), file.path) : null;
      },
      getInjections: scope => files.filter(file => file.injectTo?.some(target =>
        scope === target || scope.startsWith(`${target}.`))).map(file => file.scopeName),
    });
    const markdown = files.find(file => file.language === "markdown");
    this.grammar = markdown ? this.registry.loadGrammar(markdown.scopeName) : Promise.resolve(null);
  }

  async highlight(source: string, ranges: readonly CodeHighlightRange[]): Promise<CodeHighlightToken[]> {
    const grammar = await this.grammar;
    if (!grammar || !ranges.length) return [];
    const textLines = source.split("\n");
    let unchanged = 0;
    while (unchanged < this.lines.length && this.lines[unchanged].text === textLines[unchanged]) unchanged++;
    this.lines.length = unchanged;
    const lastOffset = Math.max(...ranges.map(range => range.to));
    const colors = this.registry.getColorMap();
    const result: CodeHighlightToken[] = [];
    let offset = 0;
    for (let line = 0; line < textLines.length && offset < lastOffset; line++) {
      const text = textLines[line];
      let cached = this.lines[line];
      if (!cached) {
        const parsed = grammar.tokenizeLine2(text, line ? this.lines[line - 1].stack : null);
        cached = { text, tokens: parsed.tokens, stack: parsed.ruleStack };
        this.lines.push(cached);
      }
      const end = offset + text.length;
      for (const range of ranges) {
        if (range.to <= offset || range.from >= end) continue;
        for (let token = 0; token < cached.tokens.length; token += 2) {
          const from = Math.max(range.from, offset + cached.tokens[token]);
          const to = Math.min(range.to, token + 2 < cached.tokens.length
            ? offset + cached.tokens[token + 2] : end);
          if (from >= to) continue;
          const metadata = cached.tokens[token + 1];
          result.push({ from, to, color: colors[(metadata >>> 15) & 0x1ff],
            fontStyle: (metadata >>> 11) & 0xf });
        }
      }
      offset = end + 1;
      // Keep editing responsive when a visible fence has a long offscreen prefix.
      if (line % 100 === 99) await new Promise<void>(resolve => setImmediate(resolve));
    }
    return result;
  }

  dispose(): void { this.registry.dispose(); this.lines = []; }
}
