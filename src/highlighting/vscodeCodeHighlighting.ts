import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parse } from "jsonc-parser/lib/esm/main.js";
import { IRawTheme, parseRawGrammar } from "vscode-textmate";
import * as vscode from "vscode";
import { CodeHighlightRange, CodeHighlightToken } from "../shared/codeHighlighting";
import { GrammarFile, TextmateCodeHighlighter } from "./textmateHighlighting";

type ThemeRule = IRawTheme["settings"][number];
interface ThemeFile {
  include?: string;
  colors?: Record<string, string>;
  tokenColors?: ThemeRule[] | string;
}
interface ThemeContribution { id?: string; label?: string; path: string; uiTheme: string }
interface TokenCustomizations {
  textMateRules?: ThemeRule[];
  [name: string]: unknown;
}

async function readTheme(file: string, visited = new Set<string>()): Promise<{ colors: Record<string, string>; rules: ThemeRule[] }> {
  if (visited.has(file)) throw new Error(`Circular color theme include: ${file}`);
  visited.add(file);
  const contents = await readFile(file, "utf8");
  if (/\.tmTheme$/iu.test(file)) {
    const raw = parseRawGrammar(contents, file) as unknown as IRawTheme;
    return { colors: {}, rules: raw.settings };
  }
  const theme = parse(contents) as ThemeFile;
  const base = theme.include ? await readTheme(path.resolve(path.dirname(file), theme.include), visited)
    : { colors: {}, rules: [] };
  const tokens = typeof theme.tokenColors === "string"
    ? (await readTheme(path.resolve(path.dirname(file), theme.tokenColors), visited)).rules
    : theme.tokenColors ?? [];
  return { colors: { ...base.colors, ...theme.colors }, rules: [...base.rules, ...tokens] };
}

const tokenScopes: Record<string, string[]> = {
  comments: ["comment", "punctuation.definition.comment"],
  strings: ["string", "meta.embedded.assembly"],
  keywords: ["keyword - keyword.operator", "keyword.control", "storage", "storage.type"],
  numbers: ["constant.numeric"],
  types: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
  functions: ["entity.name.function", "support.function"],
  variables: ["variable", "entity.name.variable"],
};

/** VS Code applies global overrides first, followed by matching theme blocks. */
export function themeCustomizations<T extends Record<string, unknown>>(input: T, theme: string): T[] {
  const result = [input];
  for (const [selector, value] of Object.entries(input)) {
    if (!selector.startsWith("[") || !value || typeof value !== "object") continue;
    const matches = [...selector.matchAll(/\[([^\]]+)\]/gu)].some(([, pattern]) => {
      const expression = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join(".*");
      return new RegExp(`^${expression}$`, "u").test(theme);
    });
    if (matches) result.push(value as T);
  }
  return result;
}

export class VscodeCodeHighlighting implements vscode.Disposable {
  private engine: Promise<TextmateCodeHighlighter> | undefined;
  private generation = 0;
  private themeName: string | undefined;
  constructor(private readonly context: vscode.ExtensionContext, private readonly uri: vscode.Uri) {}

  invalidate(): void {
    this.generation++;
    const old = this.engine;
    this.engine = undefined;
    void old?.then(engine => engine.dispose(), () => {});
  }
  dispose(): void { this.invalidate(); }

  async highlight(source: string, ranges: readonly CodeHighlightRange[], themeName?: string): Promise<CodeHighlightToken[] | null> {
    if (themeName !== this.themeName) { this.invalidate(); this.themeName = themeName; }
    const generation = this.generation;
    this.engine ??= this.createEngine();
    const tokens = await (await this.engine).highlight(source, ranges);
    return generation === this.generation ? tokens : null;
  }

  private async createEngine(): Promise<TextmateCodeHighlighter> {
    const files: GrammarFile[] = [];
    const themeName = this.themeName ?? vscode.workspace.getConfiguration("workbench", this.uri).get<string>("colorTheme", "Dark Modern");
    let selected: { contribution: ThemeContribution; extension: vscode.Extension<unknown> } | undefined;
    for (const extension of vscode.extensions.all) {
      for (const grammar of extension.packageJSON.contributes?.grammars ?? []) {
        if (typeof grammar.scopeName === "string" && typeof grammar.path === "string") {
          files.push({ ...grammar, path: path.resolve(extension.extensionPath, grammar.path) });
        }
      }
      const themes: ThemeContribution[] = extension.packageJSON.contributes?.themes ?? [];
      let labels: Record<string, string> = {};
      if (themes.some(theme => theme.label?.startsWith("%"))) {
        try { labels = parse(await readFile(path.join(extension.extensionPath, "package.nls.json"), "utf8")); } catch { /* Optional localization file. */ }
      }
      for (const contribution of themes) {
        const label = contribution.label?.replace(/^%(.+)%$/u, (_match, key: string) => labels[key] ?? key);
        if (contribution.id === themeName || label === themeName) selected = { contribution, extension };
      }
    }
    if (!selected) throw new Error(`Active VS Code color theme was not found: ${themeName}`);
    const loaded = await readTheme(path.resolve(selected.extension.extensionPath, selected.contribution.path));
    const scope = { uri: this.uri, languageId: "markdown" };
    const editor = vscode.workspace.getConfiguration("editor", scope);
    const colorSettings = vscode.workspace.getConfiguration("workbench", this.uri).get<Record<string, unknown>>("colorCustomizations", {});
    const settingsId = selected.contribution.id ?? themeName;
    for (const settings of themeCustomizations(colorSettings, settingsId)) {
      for (const [name, value] of Object.entries(settings)) if (typeof value === "string") loaded.colors[name] = value;
    }
    const dark = ["vs-dark", "hc-black"].includes(selected.contribution.uiTheme);
    const rules: ThemeRule[] = [{ settings: {
      foreground: loaded.colors["editor.foreground"] ?? (dark ? "#D4D4D4" : "#000000"),
      background: loaded.colors["editor.background"] ?? (dark ? "#1E1E1E" : "#FFFFFF"),
    } }, ...loaded.rules];
    for (const settings of themeCustomizations(editor.get<TokenCustomizations>("tokenColorCustomizations", {}), settingsId)) {
      for (const [name, scopes] of Object.entries(tokenScopes)) {
        const value = settings[name];
        if (typeof value === "string") rules.push({ scope: scopes, settings: { foreground: value } });
        else if (value && typeof value === "object") rules.push({ scope: scopes, settings: value });
      }
      if (Array.isArray(settings.textMateRules)) rules.push(...settings.textMateRules);
    }
    return new TextmateCodeHighlighter(files, { settings: rules }, this.context.asAbsolutePath("dist/onig.wasm"));
  }
}
