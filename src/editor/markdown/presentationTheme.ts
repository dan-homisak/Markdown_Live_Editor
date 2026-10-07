import { EditorView } from "@codemirror/view";

export interface MarkdownColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
const black: MarkdownColor = { r: 0, g: 0, b: 0, a: 1 };
const white: MarkdownColor = { r: 255, g: 255, b: 255, a: 1 };
const clamp = (value: number, maximum: number): number => Math.max(0, Math.min(maximum, value));

/** Deliberately narrow CSS-color support. Unknown user values fall back to a
 * measured host color rather than making assumptions about an exotic space. */
export function parseMarkdownColor(value: string | undefined): MarkdownColor | null {
  if (!value) return null;
  value = value.trim().toLowerCase();
  if (value === "transparent") return { ...black, a: 0 };
  if (value === "black") return black;
  if (value === "white") return white;
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map(character => character + character).join("") : hex;
    return { r: parseInt(expanded.slice(0, 2), 16), g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16), a: expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([^()]+)\s*\)$/.exec(value)?.[1];
  if (!rgb) return null;
  const parts = rgb.replace(/,/g, " ").replace(/\//g, " ").trim().split(/\s+/);
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts.some(part => !/^[+-]?(?:\d*\.)?\d+%?$/.test(part))) return null;
  const channel = (part: string): number => clamp(parseFloat(part) * (part.endsWith("%") ? 2.55 : 1), 255);
  const alpha = parts[3] ? clamp(parseFloat(parts[3]) / (parts[3].endsWith("%") ? 100 : 1), 1) : 1;
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
}

export function compositeMarkdownColor(foreground: MarkdownColor, background: MarkdownColor): MarkdownColor {
  const a = foreground.a + background.a * (1 - foreground.a);
  if (!a) return { ...black, a: 0 };
  const channel = (key: "r" | "g" | "b"): number =>
    (foreground[key] * foreground.a + background[key] * background.a * (1 - foreground.a)) / a;
  return { r: channel("r"), g: channel("g"), b: channel("b"), a };
}

function luminance(color: MarkdownColor): number {
  const channel = (value: number): number => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return channel(color.r) * 0.2126 + channel(color.g) * 0.7152 + channel(color.b) * 0.0722;
}

export function markdownContrast(foreground: MarkdownColor, background: MarkdownColor): number {
  const first = luminance(compositeMarkdownColor(foreground, background)), second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function cssColor(color: MarkdownColor): string {
  const channel = (value: number): number => Math.round(value * 1000) / 1000;
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${channel(color.a)})`;
}

export interface MarkdownThemeInput {
  /** Documented VS Code color identifiers, e.g. editor.background. */
  readonly colors: Readonly<Record<string, string | undefined>>;
  readonly dark: boolean;
  readonly highContrast: boolean;
}

export const markdownCodePalettes = {
  dark: { comment: "#9198a1", constant: "#79c0ff", declaration: "#d2a8ff", keyword: "#ff7b72",
    string: "#a5d6ff", variable: "#ffa657", tag: "#7ee787" },
  light: { comment: "#57606a", constant: "#0550ae", declaration: "#6639ba", keyword: "#cf222e",
    string: "#0a3069", variable: "#953800", tag: "#116329" },
} as const;

// VS Code Dark+ has one markup.heading color. Distinguish the six levels with
// its heading, type, function, keyword, string, and variable token colors.
// Source: microsoft/vscode extensions/theme-defaults/themes/{dark,light}_plus.json
export const markdownHeadingPalettes = {
  dark: ["#569CD6", "#4EC9B0", "#DCDCAA", "#C586C0", "#CE9178", "#9CDCFE"],
  light: ["#800000", "#267F99", "#795E26", "#AF00DB", "#A31515", "#001080"],
} as const;

/** Only new semantic roles are adjusted. Existing canvas, ordinary text,
 * selection, gutters, and all table colors remain host-owned. */
export function resolveMarkdownTheme(input: MarkdownThemeInput): Record<string, string> {
  const read = (name: string): MarkdownColor | null => parseMarkdownColor(input.colors[name]);
  const canvas = compositeMarkdownColor(read("editor.background") ?? (input.dark ? black : white), input.dark ? black : white);
  const host = compositeMarkdownColor(read("editor.foreground") ?? (input.dark ? white : black), canvas);
  const transparent = { ...canvas, a: 0 };
  const quietFill = (name: string, maxAlpha: number): MarkdownColor => {
    const color = read(name);
    return input.highContrast || !color ? transparent : { ...color, a: Math.min(color.a, maxAlpha) };
  };
  // Translucent treatments preserve host selection/active-line layers below.
  let inlineFill = quietFill("textPreformat.background", 0.18);
  let codeFill = quietFill("textCodeBlock.background", 0.22);
  let surfaces = [canvas, compositeMarkdownColor(inlineFill, canvas), compositeMarkdownColor(codeFill, canvas)];
  // Near the light/dark contrast crossover, even a subtle fill can prevent one
  // text color from meeting the target on every surface. Optional fills yield.
  if ([black, white].every(color => surfaces.some(surface => markdownContrast(color, surface) < 4.5))) {
    inlineFill = codeFill = transparent;
    surfaces = [canvas];
  }
  const safe = (candidate: MarkdownColor | null, backgrounds = surfaces, minimum = 4.5): string => {
    const choices = [input.highContrast ? host : candidate, host].filter((color): color is MarkdownColor => !!color && color.a > 0);
    for (const choice of choices) {
      // Preserve alpha only after checking its appearance on every relevant surface.
      if (backgrounds.every(background => markdownContrast(choice, background) >= minimum)) return cssColor(choice);
    }
    const score = (color: MarkdownColor): number => Math.min(...backgrounds.map(background => markdownContrast(color, background)));
    return cssColor(score(black) >= score(white) ? black : white);
  };
  const link = safe(read("textLink.foreground"));
  const punctuation = safe(read("descriptionForeground"));
  const codeForeground = safe(read("textPreformat.foreground"));
  const configuredEdge = read("textBlockQuote.border") ?? read("contrastBorder");
  // These are decorative guides; interactive boundaries are resolved below.
  const edge = input.highContrast ? safe(host, [canvas], 3)
    : cssColor(configuredEdge && configuredEdge.a > 0 ? configuredEdge : { ...host, a: 0.28 });
  const result: Record<string, string> = {
    "foreground": safe(host), "background": cssColor(codeFill), "heading": link, "link": link,
    "destination": link, "title": punctuation, "punctuation": punctuation,
    "inline-code-foreground": codeForeground, "inline-code-background": cssColor(inlineFill),
    "code-foreground": codeForeground, "code-background": cssColor(codeFill), "edge": edge,
    "marker": punctuation, "focus": safe(read("focusBorder") ?? read("contrastActiveBorder"), [canvas], 3),
    "inline-code-outline": input.highContrast ? `inset 0 0 0 1px ${edge}` : "none",
  };
  const taskFill = input.highContrast ? canvas : read("checkbox.background") ?? canvas;
  const headingPalette = markdownHeadingPalettes[luminance(canvas) < 0.4 ? "dark" : "light"];
  headingPalette.forEach((color, index) => { result[`heading-${index + 1}`] = safe(parseMarkdownColor(color)); });
  const taskSurface = compositeMarkdownColor(taskFill, canvas);
  result["task-fill"] = cssColor(taskFill);
  result["task-mark"] = safe(read("checkbox.foreground"), [taskSurface]);
  result["task-border"] = safe(read("checkbox.border"), [canvas], 3);
  const palette = markdownCodePalettes[luminance(canvas) < 0.4 ? "dark" : "light"];
  for (const [role, color] of Object.entries(palette)) result[`code-${role}`] = safe(parseMarkdownColor(color));
  for (const [kind, name] of Object.entries({ note: "editorInfo.foreground", tip: "testing.iconPassed",
    important: "textLink.foreground", warning: "editorWarning.foreground", caution: "editorError.foreground" })) {
    result[`alert-${kind}`] = safe(read(name));
  }
  return Object.fromEntries(Object.entries(result).map(([name, value]) => [`--mlrt-markdown-${name}`, value]));
}

const themeColorNames = ["editor.background", "editor.foreground", "textLink.foreground", "descriptionForeground",
  "textPreformat.foreground", "textPreformat.background", "textCodeBlock.background", "textBlockQuote.border",
  "contrastBorder", "focusBorder", "contrastActiveBorder", "checkbox.background", "checkbox.foreground",
  "checkbox.border", "editorInfo.foreground", "testing.iconPassed", "editorWarning.foreground", "editorError.foreground"];

export class MarkdownThemeAdapter {
  private destroyed = false;
  private scheduled = false;
  private pending = true;
  private observer: MutationObserver | null = null;
  private readonly applied = new Map<string, string>();
  constructor(private readonly view: EditorView) {
    this.observer = new MutationObserver(() => this.schedule());
    const document = view.dom.ownerDocument;
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    this.observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    this.schedule();
  }
  private schedule(): void {
    this.pending = true;
    if (this.destroyed || this.scheduled || !this.view.inView) return;
    this.scheduled = true;
    this.pending = false;
    this.view.requestMeasure({
      key: this,
      read: () => {
        if (this.destroyed) return null;
        const document = this.view.dom.ownerDocument;
        const style = document.defaultView!.getComputedStyle(this.view.dom);
        const classes = document.body.classList;
        const colors = Object.fromEntries(themeColorNames.map(name =>
          [name, style.getPropertyValue(`--vscode-${name.replace(/\./g, "-")}`).trim()]));
        return resolveMarkdownTheme({ colors, dark: !classes.contains("vscode-light"),
          highContrast: classes.contains("vscode-high-contrast") || classes.contains("vscode-high-contrast-light") });
      },
      write: roles => {
        this.scheduled = false;
        if (this.destroyed || !roles) return;
        for (const [name, value] of Object.entries(roles)) {
          if (this.applied.get(name) === value) continue;
          this.view.dom.style.setProperty(name, value);
          this.applied.set(name, value);
        }
      },
    });
  }
  resume(): void { if (this.pending) this.schedule(); }
  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect(); this.observer = null;
    for (const [name, value] of this.applied) {
      if (this.view.dom.style.getPropertyValue(name) === value) this.view.dom.style.removeProperty(name);
    }
    this.applied.clear();
  }
}
