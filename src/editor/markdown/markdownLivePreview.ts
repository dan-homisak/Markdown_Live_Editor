import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection, EditorState, Extension, Range, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { SyntaxNode, Tree } from "@lezer/common";
import { getParsedTables } from "../../shared/tableModel";
import { isTablePointerSelectionActive } from "../table/tableRangeSelection";
import { MarkdownRange } from "./markdownSyntax";
import { markdownAlertForQuote } from "./markdownBlockSyntax";

export interface PreviewPart extends MarkdownRange {
  owner: MarkdownRange;
  kind: "hide" | "code-header" | "code-end" | "properties" | "callout";
  block?: boolean;
  label?: string;
  content?: string;
  accent?: string;
  editAt?: number;
  foldTo?: number;
  collapsed?: boolean;
  insertion?: boolean;
  copy?: { from: number; to: number; prefix: string; indented: boolean };
}
const overlaps = (a: MarkdownRange, b: MarkdownRange): boolean => a.from < b.to && b.from < a.to;

/** Recognition uses the configured tree. Only the requested windows are visited. */
export function classifyMarkdownPreview(doc: Text, tree: Tree, tables: readonly MarkdownRange[], windows: readonly MarkdownRange[]): PreviewPart[] {
  const parts: PreviewPart[] = [], seen = new Set<string>();
  const read = (from: number, to: number): string => doc.sliceString(from, to);
  const add = (part: PreviewPart): void => {
    if (part.from >= part.to || tables.some(table => overlaps(part, table))) return;
    const key = `${part.kind}:${part.from}:${part.to}`;
    if (!seen.has(key)) { seen.add(key); parts.push(part); }
  };
  const hide = (from: number, to: number, owner: MarkdownRange, block = false): void => add({ from, to, owner, kind: "hide", block });
  const whitespaceAfter = (to: number): number => to + (/^[ \t]*/u.exec(read(to, doc.lineAt(to).to))?.[0].length ?? 0);
  for (const window of windows) tree.iterate({ from: window.from, to: window.to, enter(ref) {
    const node = ref.node;
    if (node.to <= window.from || node.from >= window.to || tables.some(table => table.from <= node.from && table.to >= node.to)) return false;
    const owner = { from: node.from, to: node.to };
    if (["HTMLBlock", "HTMLTag", "Comment", "WikiEmbed"].includes(node.name)) return false;
    if (node.name === "MarkdownFrontmatter") {
      if (!tables.some(table => overlaps(node, table))) add({ ...owner, owner, kind: "properties", block: true,
        content: read(node.from, node.to), editAt: node.firstChild?.to ? node.firstChild.to + 1 : node.from });
      return false;
    }
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      const marks = node.getChildren("CodeMark"), info = node.getChild("CodeInfo");
      const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
      // A list marker on the opening row becomes continuation whitespace on
      // body rows. The prefix also includes quote marks and code indentation.
      const prefix = read(first.from, node.from).replace(/(?:[-+*]|\d+[.)])(?=[ \t])/gu, marker => " ".repeat(marker.length));
      const language = info ? read(info.from, info.to).trim().split(/\s/u)[0] : "text";
      const start = node.name === "FencedCode" ? first.to + 1 : first.from;
      const end = marks.length > 1 ? doc.lineAt(marks[marks.length - 1].from).from : node.to;
      const copy = { from: start, to: Math.max(start, end), prefix, indented: node.name === "CodeBlock" };
      if (node.name === "FencedCode") {
        if (first.from <= window.to && first.to >= window.from) add({ from: first.from, to: first.to, owner, kind: "code-header", block: true, label: language, copy, editAt: Math.min(node.to, start) });
        if (marks.length > 1 && last.from <= window.to && last.to >= window.from) add({ from: last.from, to: last.to, owner, kind: "code-end", block: true });
      } else {
        // Indented code keeps its source rows but removes the structural indent.
        if (first.from <= window.to && first.to >= window.from) add({ from: first.from, to: first.to, owner, kind: "code-header", block: true, insertion: true, label: "text", copy, editAt: node.from });
      }
      // Strip enclosing quote prefixes/structural indentation from body rows only.
      for (let from = Math.max(start, doc.lineAt(window.from).from); from < Math.min(end, window.to);) {
        const line = doc.lineAt(from);
        const structural = codeStructuralPrefixLength(line.text, prefix);
        if (structural) hide(line.from, line.from + structural, owner);
        from = line.to + 1;
      }
      return false;
    }
    if (node.name === "Blockquote") {
      const alert = markdownAlertForQuote(doc, node);
      if (alert) add({ from: alert.from, to: alert.headerTo ?? alert.to, owner, kind: "callout",
        label: alert.title || (alert.name ?? alert.type).replace(/^./u, char => char.toUpperCase()),
        accent: alert.type, editAt: alert.from, foldTo: tables.some(table => overlaps(table, node)) ? undefined : node.to,
        collapsed: tables.some(table => overlaps(table, node)) ? undefined : alert.collapsed });
    }
    if (node.name === "QuoteMark") {
      const line = doc.lineAt(node.from);
      // Reveal quote syntax for its active source row, not the entire long quote.
      hide(node.from, Math.min(node.to + (read(node.to, node.to + 1) === " " ? 1 : 0), line.to), { from: line.from, to: line.to });
    } else if (/^(?:ATX|Setext)Heading[1-6]$/u.test(node.name)) {
      for (const mark of node.getChildren("HeaderMark")) {
        const line = doc.lineAt(mark.from);
        if (node.name.startsWith("Setext")) hide(line.from, line.to, owner, true);
        else hide(mark.from === node.from ? mark.from : Math.max(node.from, mark.from - 1), whitespaceAfter(mark.to), owner);
      }
    } else if (["StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode"].includes(node.name)) {
      const markName = node.name === "InlineCode" ? "CodeMark" : node.name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
      for (const mark of node.getChildren(markName)) hide(mark.from, mark.to, owner);
      if (node.name === "InlineCode") return false;
    } else if (node.name === "Link" || node.name === "Image") {
      const paragraph = node.parent, quote = paragraph?.parent;
      const alert = paragraph?.name === "Paragraph" && quote?.name === "Blockquote" ? markdownAlertForQuote(doc, quote) : null;
      if (alert && node.from >= alert.from && node.to <= alert.to) return false;
      const marks = node.getChildren("LinkMark");
      const first = marks[0], close = marks.find(mark => read(mark.from, mark.to) === "]");
      if (first && close) { hide(first.from, first.to, owner); hide(close.from, node.to, owner); }
    } else if (node.name === "WikiLink") {
      const label = node.getChild("WikiLabel") ?? node.getChild("WikiTarget");
      if (label) { hide(node.from, label.from, owner); hide(label.to, node.to, owner); }
    } else if (node.name === "Autolink") {
      for (const mark of node.getChildren("LinkMark")) hide(mark.from, mark.to, owner);
    } else if (node.name === "LinkReference") {
      // Definitions are metadata. Keep an unobtrusive editable summary row.
      const label = node.getChild("LinkLabel");
      if (label) { hide(node.from, label.from + 1, owner); hide(label.to - 1, node.to, owner); }
      return false;
    } else if (node.name === "Escape") hide(node.from, node.from + 1, owner);
  } });
  return parts.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** Remove only structural columns, retaining any additional code indentation. */
function codeStructuralPrefixLength(line: string, prefix: string): number {
  let offset = 0;
  for (const character of prefix) {
    if (line[offset] === character) offset++;
    else if (character !== " " && character !== "\t") break;
  }
  return offset;
}

export function codeBlockText(doc: Text, from: number, to: number, prefix = "", indented = false): string {
  const body = doc.sliceString(from, Math.min(to, doc.length));
  return body.split("\n").map(line => !prefix && indented ? line.replace(/^(?: {4}|\t)/u, "")
    : line.slice(codeStructuralPrefixLength(line, prefix))).join("\n");
}

export function previewOwnerActive(owner: MarkdownRange, selection: EditorSelection, focused: boolean, projected?: MarkdownRange | null): boolean {
  return !!projected && overlaps(owner, projected) || selection.ranges.some(range => range.empty
    ? focused && range.head >= owner.from && range.head <= owner.to : overlaps(owner, range));
}

export interface PropertyRow { key: string; value: string; offset: number; }
export function frontmatterPropertyRows(source: string): PropertyRow[] {
  const rows: PropertyRow[] = [];
  const lines = source.split("\n"); let offset = lines[0].length + 1;
  const scalar = (value: string): string => {
    if (value.startsWith('"') && value.endsWith('"')) { try { return JSON.parse(value) as string; } catch { return value; } }
    return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
  };
  for (const line of lines.slice(1, -1)) {
    const key = /^([^\s:#][^:]*):(?:[ \t]+(.*))?\s*$/u.exec(line);
    if (key) rows.push({ key: scalar(key[1].trim()), value: scalar(key[2]?.trim() ?? ""), offset: offset + line.indexOf(":") + 1 });
    else if (line.trim() && !line.trimStart().startsWith("#")) {
      const previous = rows[rows.length - 1];
      const value = scalar(line.trim().replace(/^-\s+/u, ""));
      if (previous) previous.value += `${previous.value ? " · " : ""}${value}`;
      else rows.push({ key: "Value", value, offset });
    }
    offset += line.length + 1;
  }
  return rows;
}

const activityEffect = StateEffect.define<{ focused: boolean; composing: boolean; projected: MarkdownRange | null }>();
const windowEffect = StateEffect.define<readonly MarkdownRange[]>();
const foldEffect = StateEffect.define<{ from: number; collapsed: boolean }>();
interface PreviewState {
  decorations: DecorationSet;
  parts: readonly PreviewPart[];
  windows: readonly MarkdownRange[];
  focused: boolean;
  composing: boolean;
  projected: MarkdownRange | null;
  folds: ReadonlyMap<number, boolean>;
}

class PreviewWidget extends WidgetType {
  constructor(readonly part: PreviewPart, readonly source: string, readonly collapsed = false) { super(); }
  eq(other: PreviewWidget): boolean { return this.source === other.source && JSON.stringify(this.part) === JSON.stringify(other.part) && this.collapsed === other.collapsed; }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument, part = this.part;
    const wrapper = doc.createElement(part.block ? "div" : "span");
    wrapper.className = `mlrt-preview-${part.kind}`;
    wrapper.dataset.previewFrom = String(part.from);
    wrapper.contentEditable = "false";
    const current = (): boolean => view.state.doc.sliceString(part.from, part.to) === this.source;
    const edit = (position = part.editAt ?? part.from): void => {
      if (!current()) return;
      view.dispatch({ selection: EditorSelection.cursor(Math.min(view.state.doc.length, position)), effects: activityEffect.of({ focused: true, composing: false, projected: null }), scrollIntoView: true });
      view.focus();
    };
    wrapper.addEventListener("pointerdown", event => { if ((event as PointerEvent).button === 0) event.preventDefault(); });
    wrapper.addEventListener("keydown", event => {
      const keyboard = event as KeyboardEvent;
      if ((keyboard.key === "Enter" || keyboard.key === " ") && keyboard.target instanceof HTMLButtonElement &&
          !keyboard.ctrlKey && !keyboard.metaKey && !keyboard.altKey && !keyboard.shiftKey) {
        keyboard.preventDefault(); keyboard.stopPropagation(); keyboard.target.click();
      }
    });
    if (part.kind === "code-end") return wrapper;
    if (part.kind === "code-header") {
      const language = doc.createElement("button"); language.type = "button"; language.className = "mlrt-preview-code-language";
      language.textContent = part.label || "text"; language.title = "Edit code block"; language.addEventListener("click", () => edit());
      const copy = doc.createElement("button"); copy.type = "button"; copy.className = "mlrt-preview-code-copy";
      copy.textContent = "Copy"; copy.setAttribute("aria-label", `Copy ${part.label || "text"} code`);
      copy.addEventListener("click", async () => {
        if (!current()) return;
        const range = part.copy;
        const content = range ? codeBlockText(view.state.doc, range.from, range.to, range.prefix, range.indented) : "";
        try { await doc.defaultView!.navigator.clipboard.writeText(content); copy.textContent = "Copied"; }
        catch { copy.textContent = "Copy failed"; }
        doc.defaultView!.setTimeout(() => { if (copy.isConnected) copy.textContent = "Copy"; }, 1800);
      });
      wrapper.append(language, copy);
    } else if (part.kind === "properties") {
      const title = doc.createElement("button"); title.type = "button"; title.className = "mlrt-preview-properties-title";
      title.textContent = "Properties"; title.title = "Edit YAML properties"; title.addEventListener("click", () => edit()); wrapper.append(title);
      for (const row of frontmatterPropertyRows(part.content ?? "")) {
        const button = doc.createElement("button"); button.type = "button"; button.className = "mlrt-preview-property";
        const key = doc.createElement("span"), value = doc.createElement("span"); key.className = "mlrt-preview-property-key"; value.className = "mlrt-preview-property-value";
        key.textContent = row.key; value.textContent = row.value || "Empty";
        button.append(key, value); button.setAttribute("aria-label", `Edit property ${row.key}`);
        button.addEventListener("click", () => edit(part.from + row.offset)); wrapper.append(button);
      }
    } else if (part.kind === "callout") {
      wrapper.classList.add(`mlrt-preview-callout-${part.accent}`);
      if (part.collapsed !== undefined) {
        const fold = doc.createElement("button"); fold.type = "button"; fold.className = "mlrt-preview-callout-fold";
        fold.textContent = this.collapsed ? "▸" : "▾"; fold.setAttribute("aria-label", `${this.collapsed ? "Expand" : "Collapse"} ${part.label}`); fold.setAttribute("aria-expanded", String(!this.collapsed));
        fold.addEventListener("click", () => { if (current()) view.dispatch({ effects: foldEffect.of({ from: part.from, collapsed: !this.collapsed }) }); }); wrapper.append(fold);
      }
      const label = doc.createElement("button"); label.type = "button"; label.className = "mlrt-preview-callout-title";
      const icon = doc.createElement("span"); icon.setAttribute("aria-hidden", "true"); icon.textContent = ({ note: "ⓘ", tip: "✓", important: "✦", warning: "⚠", caution: "!" } as Record<string, string>)[part.accent ?? "note"];
      label.append(icon, doc.createTextNode(` ${part.label}`)); label.title = "Edit callout"; label.addEventListener("click", () => edit()); wrapper.append(label);
    }
    return wrapper;
  }
  ignoreEvent(): boolean { return true; }
  get estimatedHeight(): number { return this.part.kind === "code-end" ? 0 : this.part.kind === "properties" ? 30 + frontmatterPropertyRows(this.part.content ?? "").length * 28 : -1; }
}

function decorations(state: EditorState, value: Omit<PreviewState, "decorations">): DecorationSet {
  const ranges: Range<Decoration>[] = [], covered: MarkdownRange[] = [];
  for (const part of value.parts) {
    const active = previewOwnerActive(part.owner, state.selection, value.focused, value.projected);
    if (part.kind === "code-header" && (active || part.insertion)) {
      ranges.push(Decoration.widget({ block: true, side: -1, widget: new PreviewWidget(part, state.doc.sliceString(part.from, part.to)) }).range(part.from));
      continue;
    }
    if (active || covered.some(range => overlaps(range, part))) continue;
    const collapsed = value.folds.get(part.from) ?? part.collapsed ?? false;
    ranges.push(Decoration.replace({ block: part.block, inclusive: part.block === true,
      ...(part.kind !== "hide" ? { widget: new PreviewWidget(part, state.doc.sliceString(part.from, part.to), collapsed) } : {}) }).range(part.from, part.to));
    covered.push(part);
    if (part.kind === "callout" && collapsed && part.foldTo && part.foldTo > part.to) {
      const from = state.doc.lineAt(part.to).to;
      ranges.push(Decoration.replace({ inclusive: false }).range(from, part.foldTo));
      covered.push({ from, to: part.foldTo });
    }
  }
  return Decoration.set(ranges, true);
}

export const markdownPreviewField = StateField.define<PreviewState>({
  create(state) {
    const windows = [{ from: 0, to: Math.min(state.doc.length, 12000) }];
    const value = { parts: classifyMarkdownPreview(state.doc, syntaxTree(state), getParsedTables(state.doc), windows),
      windows, focused: false, composing: false, projected: null, folds: new Map<number, boolean>() };
    return { ...value, decorations: decorations(state, value) };
  },
  update(value, transaction) {
    let { focused, composing, projected, windows } = value;
    let folds = value.folds;
    for (const effect of transaction.effects) {
      if (effect.is(activityEffect)) ({ focused, composing, projected } = effect.value);
      if (effect.is(windowEffect)) windows = effect.value;
      if (effect.is(foldEffect)) { folds = new Map(folds); (folds as Map<number, boolean>).set(effect.value.from, effect.value.collapsed); }
    }
    if (transaction.docChanged) {
      windows = windows.map(range => ({ from: transaction.changes.mapPos(range.from), to: transaction.changes.mapPos(range.to) }));
      folds = new Map([...folds].map(([from, folded]) => [transaction.changes.mapPos(from), folded]));
    }
    if (composing) return { ...value, focused, composing, projected, folds, windows, decorations: value.decorations.map(transaction.changes) };
    const changed = transaction.docChanged || syntaxTree(transaction.state) !== syntaxTree(transaction.startState) || windows !== value.windows;
    const parts = changed ? classifyMarkdownPreview(transaction.state.doc, syntaxTree(transaction.state), getParsedTables(transaction.state.doc), windows) : value.parts;
    const next = { parts, windows, focused, composing, projected, folds };
    return { ...next, decorations: decorations(transaction.state, next) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

export function isMarkdownPreviewActive(view: EditorView, range: MarkdownRange): boolean {
  const value = view.state.field(markdownPreviewField, false);
  return !!value && !previewOwnerActive(range, view.state.selection, view.hasFocus, value.projected);
}

/** Direct field decorations may collapse block rows. Viewport discovery itself never supplies block decorations. */
export function createMarkdownLivePreviewExtensions(screenReaderOptimized: boolean): Extension {
  if (screenReaderOptimized) return [];
  return [markdownPreviewField, ViewPlugin.fromClass(class {
    private queued = false;
    private frame: number | null = null;
    private destroyed = false;
    private composing = false;
    constructor(readonly view: EditorView) { this.schedule(); }
    update(_update: ViewUpdate): void { this.schedule(); }
    schedule(): void {
      if (this.queued || this.destroyed) return;
      this.queued = true;
      // Native contenteditable edits are read by CM's DOM observer at the end
      // of the input task. A presentation dispatch in a focus microtask can
      // reconcile DOM before that edit is imported. Adopt view-only context
      // on the next frame, after those input mutations have settled.
      this.frame = this.view.dom.ownerDocument.defaultView!.requestAnimationFrame(() => {
        this.frame = null;
        this.queued = false;
        if (this.destroyed || this.view.dom.ownerDocument.hidden || isTablePointerSelectionActive(this.view.dom.ownerDocument)) return;
        const view = this.view, field = view.state.field(markdownPreviewField);
        // Overscan by source lines, so hiding/revealing a delimiter never oscillates the viewport boundary.
        const windows = [{ from: view.state.doc.line(Math.max(1, view.state.doc.lineAt(view.viewport.from).number - 30)).from,
          to: view.state.doc.line(Math.min(view.state.doc.lines, view.state.doc.lineAt(view.viewport.to).number + 30)).to }]
          .filter(range => syntaxTreeAvailable(view.state, Math.min(range.to, view.viewport.to)));
        const effects = [];
        const focused = view.hasFocus || !!view.dom.ownerDocument.activeElement?.closest(".mlrt-preview-code-header");
        // Mixed table/prose selections already publish their exact linear
        // envelope in state.selection. Do not mirror that range with a later
        // presentation transaction: it would recreate a native browser range
        // after the table's pointer controller deliberately cleared it.
        if (field.focused !== focused || field.composing !== this.composing) effects.push(activityEffect.of({ focused, composing: this.composing, projected: null }));
        if (JSON.stringify(field.windows) !== JSON.stringify(windows)) effects.push(windowEffect.of(windows));
        if (effects.length) view.dispatch({ effects });
      });
    }
    destroy(): void {
      this.destroyed = true;
      if (this.frame !== null) this.view.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
    }
    compositionStart(): void { this.composing = true; this.view.dispatch({ effects: activityEffect.of({ focused: this.view.hasFocus, composing: true, projected: null }) }); }
    compositionEnd(): void { this.composing = false; this.schedule(); }
  }, { eventHandlers: {
    focus() { this.schedule(); }, blur() { this.schedule(); },
    compositionstart() { this.compositionStart(); }, compositionend() { this.compositionEnd(); },
  } })];
}
