import { Text } from "@codemirror/state";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { IGrammar, Registry, StateStack } from "vscode-textmate";
import { CodeHighlightingConfiguration, CodeHighlightToken } from "../../shared/codeHighlighting";

let oniguruma: Promise<void> | undefined;

/** Grammars and WASM are ready before the editor mounts. Tokenization itself
 * is synchronous: first visits, scrollbar jumps and edits have no host round trip. */
export async function createBrowserCodeHighlighter(configuration: CodeHighlightingConfiguration, wasm?: string): Promise<BrowserCodeHighlighter> {
  if (!oniguruma) {
    if (!wasm) throw new Error("Missing initial syntax highlighting WASM.");
    const bytes = Uint8Array.from(atob(wasm), character => character.charCodeAt(0));
    oniguruma = loadWASM(bytes.buffer);
  }
  await oniguruma;
  const grammars = new Map(configuration.grammars.map(grammar => [grammar.scopeName, grammar]));
  const registry = new Registry({ theme: configuration.theme,
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async scope => grammars.get(scope) ?? null,
    getInjections: scope => [...configuration.injections[scope] ?? []],
  });
  try {
    const grammar = await registry.loadGrammar(configuration.scopeName);
    if (!grammar) throw new Error("Missing Markdown syntax grammar.");
    return new BrowserCodeHighlighter(registry, grammar);
  } catch (error) { registry.dispose(); throw error; }
}

interface CachedLine { text: string; tokens: Uint32Array; stack: StateStack; before: StateStack | null }
export class BrowserCodeHighlighter {
  private lines: CachedLine[] = [];
  private document: Text | undefined;
  private previousLines: CachedLine[] = [];
  private lineShift = 0;
  constructor(private readonly registry: Registry, private readonly grammar: IGrammar) {}

  highlight(doc: Text, ranges: readonly { from: number; to: number }[]): CodeHighlightToken[] {
    if (this.document !== doc) {
      let unchanged = 0;
      while (unchanged < this.lines.length && unchanged < doc.lines && this.lines[unchanged].text === doc.line(unchanged + 1).text) unchanged++;
      this.previousLines = this.lines;
      this.lineShift = this.document ? doc.lines - this.document.lines : 0;
      this.lines = this.lines.slice(0, unchanged);
      this.document = doc;
    }
    if (!ranges.length) return [];
    const last = doc.lineAt(ranges.reduce((to, range) => Math.max(to, range.to), 0)).number;
    const colors = this.registry.getColorMap(), result: CodeHighlightToken[] = [];
    // Complete only the missing grammar prefix. Revisiting distant rows does
    // not walk thousands of cached offscreen lines just to collect their paint.
    for (let number = this.lines.length + 1; number <= last; number++) {
      const line = doc.line(number);
      const before = number > 1 ? this.lines[number - 2].stack : null;
      const previous = this.previousLines[number - 1 - this.lineShift];
      // Preserve downstream tokens once their text AND entering grammar state
      // match. An edited multiline opener cannot reuse tokens until it closes.
      if (previous?.text === line.text && (before === previous.before || before && previous.before && before.equals(previous.before))) {
        this.lines.push(previous);
      } else {
        const parsed = this.grammar.tokenizeLine2(line.text, before);
        this.lines.push({ text: line.text, tokens: parsed.tokens, stack: parsed.ruleStack, before });
      }
    }
    let rangeIndex = 0;
    const first = doc.lineAt(ranges.reduce((from, range) => Math.min(from, range.from), doc.length)).number;
    for (let number = first; number <= last; number++) {
      const line = doc.line(number), cached = this.lines[number - 1];
      while (rangeIndex < ranges.length && ranges[rangeIndex].to <= line.from) rangeIndex++;
      for (let index = rangeIndex; index < ranges.length && ranges[index].from < line.to; index++) {
        const range = ranges[index];
        for (let token = 0; token < cached.tokens.length; token += 2) {
          const from = Math.max(range.from, line.from + cached.tokens[token]);
          const to = Math.min(range.to, token + 2 < cached.tokens.length ? line.from + cached.tokens[token + 2] : line.to);
          if (from >= to) continue;
          const metadata = cached.tokens[token + 1];
          result.push({ from, to, color: colors[(metadata >>> 15) & 0x1ff], fontStyle: (metadata >>> 11) & 0xf });
        }
      }
    }
    return result;
  }
  dispose(): void { this.registry.dispose(); this.lines = []; this.previousLines = []; }
}
