import { markdownChangedWindows, markdownRenderTree as syntaxTree } from "./markdownRenderTree";
import { ChangeDesc, EditorSelection, EditorState, Extension, Facet, Range, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { SyntaxNode, Tree } from "@lezer/common";
import { getParsedTables } from "../../shared/tableModel";
import { getDocumentSelectionProjection } from "../documentSelectionState";
import { isTablePointerSelectionActive } from "../table/tableRangeSelection";
import { MarkdownRange } from "./markdownSyntax";
import { markdownAlertForQuote } from "./markdownBlockSyntax";
import { markdownListField, markdownListRangeHidden } from "./markdownListStructure";
import { findMarkdownLinkAt } from "../../shared/markdownLinkValidation";
import { decodeMarkdownEntity, footnoteForReference, markdownDocumentIndex, MarkdownHeading } from "./markdownDocumentIndex";

export interface PreviewPart extends MarkdownRange {
  owner: MarkdownRange;
  kind: "hide" | "conceal" | "code-header" | "code-end" | "callout" | "text" | "toc" | "footnote";
  target?: number;
  superscript?: boolean;
  headings?: readonly MarkdownHeading[];
  fence?: MarkdownRange;
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
const layoutNodes = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem",
  "FootnoteDefinition", "MarkdownTOC", "MarkdownFrontmatter", "FencedCode", "CodeBlock", "SetextHeading1", "SetextHeading2"]);

/** Recognition uses the configured tree. Only the requested windows are visited. */
export function classifyMarkdownPreview(doc: Text, tree: Tree, tables: readonly MarkdownRange[], windows: readonly MarkdownRange[], showHeadingMarkers = true, layoutOnly = false): PreviewPart[] {
  const parts: PreviewPart[] = [], seen = new Set<string>();
  const protectedTables = [...tables].sort((a, b) => a.from - b.from);
  const index = markdownDocumentIndex(doc, tree, tables);
  const tableAt = (position: number): MarkdownRange | undefined => {
    let from = 0, to = protectedTables.length;
    while (from < to) {
      const middle = (from + to) >>> 1;
      if (protectedTables[middle].to <= position) from = middle + 1;
      else to = middle;
    }
    return protectedTables[from];
  };
  const overlapsTable = (range: MarkdownRange): boolean => {
    const table = tableAt(range.from);
    return !!table && table.from < range.to;
  };
  const read = (from: number, to: number): string => doc.sliceString(from, to);
  const add = (part: PreviewPart): void => {
    if (part.from >= part.to || overlapsTable(part)) return;
    const key = `${part.kind}:${part.from}:${part.to}`;
    if (!seen.has(key)) { seen.add(key); parts.push(part); }
  };
  const hide = (from: number, to: number, owner: MarkdownRange, block = false): void => add({ from, to, owner, kind: "hide", block });
  const whitespaceAfter = (to: number): number => to + (/^[ \t]*/u.exec(read(to, doc.lineAt(to).to))?.[0].length ?? 0);
  for (const window of windows) tree.iterate({ from: window.from, to: window.to, enter(ref) {
    const node = ref.node;
    if (layoutOnly && !layoutNodes.has(node.name)) return false;
    const table = tableAt(node.from);
    if (node.to <= window.from || node.from >= window.to || table && table.from <= node.from && table.to >= node.to) return false;
    const owner = { from: node.from, to: node.to };
    if (["HTMLBlock", "HTMLTag", "Comment", "WikiEmbed"].includes(node.name)) return false;
    if (node.name === "MarkdownTOC") {
      const line = doc.lineAt(node.from), row = { from: line.from, to: line.to };
      add({ ...row, owner: row, kind: "toc", block: true, headings: index.headings });
      return false;
    }
    if (node.name === "FootnoteReference") {
      const note = footnoteForReference(doc, node, index);
      if (note) add({ ...owner, owner, kind: "footnote", label: String(note.number), target: note.labelTo, superscript: true });
      return false;
    }
    if (node.name === "FootnoteDefinition") {
      const note = [...index.footnotes.values()].find(note => note.from === node.from);
      if (note) {
        if (!layoutOnly) add({ from: note.labelFrom, to: note.labelTo, owner, kind: "footnote", label: `${note.number}. `, target: note.firstReference });
        for (let from = doc.lineAt(node.from).to + 1; !layoutOnly && from < node.to;) {
          const line = doc.lineAt(from), indent = /^(?: {4}|\t)/u.exec(line.text);
          if (indent) hide(line.from, line.from + indent[0].length, owner);
          from = line.to + 1;
        }
      }
    }
    if (!layoutOnly && node.name === "ListItem") {
      const number = index.orderedNumbers.get(node.from), mark = node.getChild("ListMark");
      if (mark && number !== undefined && read(mark.from, mark.to - 1) !== number)
        add({ from: mark.from, to: mark.to - 1, owner: { from: mark.from, to: mark.to }, kind: "text", label: number });
    }
    if (node.name === "MarkdownFrontmatter") {
      // Properties always retain their source rows and normal editor geometry.
      return false;
    }
    if (node.name === "FencedCode" || node.name === "CodeBlock") {
      if (layoutOnly && node.name === "FencedCode") return false;
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
        // The parser emits opening quote marks outside the fenced owner.
        // Keep those columns too, just like prefixes on the body/closing rows.
        for (const part of parts) if (part.kind === "hide" && part.from >= first.from && part.to <= node.from) {
          part.kind = "conceal"; part.owner = owner;
        }
        if (first.from <= window.to && first.to >= window.from) add({ from: first.from, to: first.to, owner, kind: "code-header", fence: { from: marks[0].from, to: first.to }, label: language, copy, editAt: Math.min(node.to, start) });
        if (marks.length > 1 && last.from <= window.to && last.to >= window.from) add({ from: last.from, to: last.to, owner, kind: "code-end", fence: { from: last.from, to: marks[marks.length - 1].to } });
      } else {
        // Indented code keeps its source rows but removes the structural indent.
        if (first.from <= window.to && first.to >= window.from) add({ from: first.from, to: first.to, owner, kind: "code-header", block: true, insertion: true, label: "text", copy, editAt: node.from });
      }
      if (layoutOnly) return false;
      // Strip enclosing quote prefixes/structural indentation from body rows only.
      for (let from = Math.max(start, doc.lineAt(window.from).from); from < Math.min(end, window.to);) {
        const line = doc.lineAt(from);
        const structural = codeStructuralPrefixLength(line.text, prefix);
        if (structural) add({ from: line.from, to: line.from + structural, owner, kind: node.name === "FencedCode" ? "conceal" : "hide" });
        from = line.to + 1;
      }
      return false;
    }
    if (node.name === "Blockquote") {
      const alert = markdownAlertForQuote(doc, node);
      if (alert) add({ from: alert.from, to: alert.headerTo ?? alert.to, owner, kind: "callout",
        label: alert.title || (alert.name ?? alert.type).replace(/^./u, char => char.toUpperCase()),
        accent: alert.type, editAt: alert.from, foldTo: overlapsTable(node) ? undefined : node.to,
        collapsed: overlapsTable(node) ? undefined : alert.collapsed });
    }
    if (node.name === "QuoteMark") {
      const line = doc.lineAt(node.from);
      // Reveal quote syntax for its active source row, not the entire long quote.
      hide(node.from, Math.min(node.to + (read(node.to, node.to + 1) === " " ? 1 : 0), line.to), { from: line.from, to: line.to });
    } else if (/^(?:ATX|Setext)Heading[1-6]$/u.test(node.name)) {
      for (const mark of node.getChildren("HeaderMark")) {
        if (showHeadingMarkers && node.name.startsWith("ATX")) continue;
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
      // Lezer also emits Link for unresolved shortcut labels such as [TOC].
      // Keep unsupported/unresolved source intact rather than implying a link.
      if (node.name === "Link" && !findMarkdownLinkAt(doc, tree, node.from + 1, tables)) return false;
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
    else if (node.name === "Entity") {
      const literal = read(node.from, node.to), label = decodeMarkdownEntity(literal);
      if (literal !== label) add({ ...owner, owner, kind: "text", label });
    }
  } });
  return parts.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** Like tables, height-changing preview decorations must exist independently
 * of DOM visibility. Visit only structural owners in the incremental tree;
 * retain one small descriptor per block, never its code body or inline marks. */
export function classifyMarkdownPreviewLayout(doc: Text, tree: Tree, tables: readonly MarkdownRange[]): PreviewPart[] {
  return classifyMarkdownPreview(doc, tree, tables, [{ from: 0, to: tree.length }], true, true);
}

function previewParts(state: EditorState, windows: readonly MarkdownRange[]): PreviewPart[] {
  return classifyMarkdownPreview(state.doc, syntaxTree(state), getParsedTables(state.doc), windows, state.facet(headingMarkersFacet));
}

function mapPreviewPart(part: PreviewPart, changes: ChangeDesc): PreviewPart {
  const range = (value: MarkdownRange): MarkdownRange => ({ from: changes.mapPos(value.from, 1), to: changes.mapPos(value.to, -1) });
  return { ...part, ...range(part), owner: range(part.owner),
    fence: part.fence && range(part.fence), copy: part.copy && { ...part.copy, ...range(part.copy) },
    editAt: part.editAt === undefined ? undefined : changes.mapPos(part.editAt),
    foldTo: part.foldTo === undefined ? undefined : changes.mapPos(part.foldTo) };
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

const activityEffect = StateEffect.define<{ focused: boolean; composing: boolean; projected: MarkdownRange | null }>();
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
    if (part.fence) wrapper.classList.add("mlrt-preview-code-header-inline");
    wrapper.dataset.previewFrom = String(part.from);
    wrapper.contentEditable = "false";
    const current = (): boolean => view.state.doc.sliceString(part.from, part.to) === this.source;
    const edit = (position = part.editAt ?? part.from): void => {
      if (!current()) return;
      view.dispatch({ selection: EditorSelection.cursor(Math.min(view.state.doc.length, position)), effects: activityEffect.of({ focused: true, composing: false, projected: null }), scrollIntoView: true });
      view.focus();
    };
    if (part.kind === "text") { wrapper.textContent = part.label ?? ""; return wrapper; }
    if (part.kind === "footnote") {
      if (part.superscript) wrapper.classList.add("mlrt-preview-footnote-reference");
      const button = doc.createElement("button");
      button.type = "button"; button.textContent = part.label ?? "";
      button.setAttribute("aria-label", part.superscript ? `Go to footnote ${part.label}` : `Return to reference for footnote ${part.label}`);
      button.addEventListener("click", () => edit(part.target ?? part.from));
      wrapper.append(button);
      return wrapper;
    }
    if (part.kind === "toc") {
      const nav = doc.createElement("nav"); nav.setAttribute("aria-label", "Table of contents");
      for (const heading of part.headings ?? []) {
        const button = doc.createElement("button"); button.type = "button"; button.textContent = heading.label;
        button.style.paddingLeft = `${(heading.level - 1) * 16}px`;
        button.addEventListener("click", () => edit(heading.from));
        nav.append(button);
      }
      if (!nav.childNodes.length) nav.textContent = "Table of contents";
      wrapper.append(nav);
      wrapper.addEventListener("dblclick", event => { if (!(event.target instanceof HTMLButtonElement)) edit(); });
      return wrapper;
    }
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
      const language = part.label || "text";
      const copy = doc.createElement("button"); copy.type = "button"; copy.className = "mlrt-preview-code-copy";
      copy.setAttribute("aria-label", `Copy ${language} code`);
      copy.title = `Copy ${language} code`;
      const size = doc.createElement("span"); size.className = "mlrt-preview-code-copy-size";
      size.setAttribute("aria-hidden", "true"); size.textContent = "Copied";
      const label = doc.createElement("span"); label.className = "mlrt-preview-code-copy-label";
      label.setAttribute("aria-hidden", "true"); label.textContent = language;
      const action = doc.createElement("span"); action.className = "mlrt-preview-code-copy-action";
      action.setAttribute("aria-hidden", "true"); action.textContent = "Copy";
      const feedback = doc.createElement("span"); feedback.className = "mlrt-preview-code-copy-status";
      feedback.setAttribute("role", "status");
      let hovered = false, status: string | null = null;
      // Persistent layers share one centered grid cell, so label changes can
      // crossfade without replacing glyphs or resizing the pointer target.
      const refreshLabel = (): void => {
        copy.dataset.copyState = status ? "status" : hovered || doc.activeElement === copy ? "action" : "language";
        if (status) feedback.textContent = status;
        feedback.setAttribute("aria-hidden", String(!status));
      };
      copy.addEventListener("pointerenter", () => { hovered = true; refreshLabel(); });
      copy.addEventListener("pointerleave", () => { hovered = false; refreshLabel(); });
      copy.addEventListener("focus", refreshLabel);
      copy.addEventListener("blur", refreshLabel);
      copy.append(size, label, action, feedback); refreshLabel();
      copy.addEventListener("click", async () => {
        if (!current()) return;
        const range = part.copy;
        const content = range ? codeBlockText(view.state.doc, range.from, range.to, range.prefix, range.indented) : "";
        try { await doc.defaultView!.navigator.clipboard.writeText(content); status = "Copied"; }
        catch { status = "Failed"; }
        refreshLabel();
        doc.defaultView!.setTimeout(() => { if (copy.isConnected) { status = null; refreshLabel(); } }, 1800);
      });
      wrapper.append(copy);
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
  get estimatedHeight(): number { return this.part.kind === "code-header" && this.part.block ? 28 : -1; }
}

function decorations(state: EditorState, value: Omit<PreviewState, "decorations">): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  // Parts are source ordered. A single endpoint handles nested replacements
  // without rescanning every earlier block on each selection/scroll update.
  let coveredTo = -1;
  for (const part of value.parts) {
    if (markdownListRangeHidden(state, part)) continue;
    const active = previewOwnerActive(part.owner, state.selection, value.focused, value.projected);
    // Fence rows belong to the document and gutter in both modes. Concealing
    // their glyphs keeps wrapping, line height, and the closing padding row fixed.
    if (part.fence) {
      if (part.kind === "code-header") ranges.push(Decoration.widget({ side: 1,
        widget: new PreviewWidget(part, state.doc.sliceString(part.from, part.to)) }).range(part.to));
      if (!active) ranges.push(Decoration.mark({ class: "mlrt-preview-code-fence-hidden" }).range(part.fence.from, part.fence.to));
      continue;
    }
    if (part.kind === "conceal") {
      if (!active) ranges.push(Decoration.mark({ class: "mlrt-preview-code-fence-hidden" }).range(part.from, part.to));
      continue;
    }
    if (part.kind === "code-header" && (active || part.insertion)) {
      ranges.push(Decoration.widget({ block: true, side: -1, widget: new PreviewWidget(part, state.doc.sliceString(part.from, part.to)) }).range(part.from));
      continue;
    }
    if (active || part.from < coveredTo) continue;
    const collapsed = value.folds.get(part.from) ?? part.collapsed ?? false;
    ranges.push(Decoration.replace({ block: part.block, inclusive: part.block === true,
      ...(part.kind !== "hide" ? { widget: new PreviewWidget(part, state.doc.sliceString(part.from, part.to), collapsed) } : {}) }).range(part.from, part.to));
    coveredTo = Math.max(coveredTo, part.to);
    if (part.kind === "callout" && collapsed && part.foldTo && part.foldTo > part.to) {
      const from = state.doc.lineAt(part.to).to;
      ranges.push(Decoration.replace({ inclusive: false }).range(from, part.foldTo));
      coveredTo = Math.max(coveredTo, part.foldTo);
    }
  }
  return Decoration.set(ranges, true);
}

const headingMarkersFacet = Facet.define<boolean, boolean>({ combine: values => values[0] ?? true });

export const markdownPreviewField = StateField.define<PreviewState>({
  create(state) {
    const windows = [{ from: 0, to: state.doc.length }];
    const value = { parts: previewParts(state, windows),
      windows, focused: false, composing: false, projected: null, folds: new Map<number, boolean>() };
    return { ...value, decorations: decorations(state, value) };
  },
  update(value, transaction) {
    let { focused, composing, projected, windows } = value;
    let folds = value.folds;
    for (const effect of transaction.effects) {
      if (effect.is(activityEffect)) ({ focused, composing, projected } = effect.value);
      if (effect.is(foldEffect)) { folds = new Map(folds); (folds as Map<number, boolean>).set(effect.value.from, effect.value.collapsed); }
    }
    if (transaction.docChanged) {
      windows = [{ from: 0, to: transaction.state.doc.length }];
      folds = new Map([...folds].map(([from, folded]) => [transaction.changes.mapPos(from), folded]));
    }
    if (composing) return { ...value, focused, composing, projected, folds, windows, decorations: value.decorations.map(transaction.changes) };
    const syntaxChanged = transaction.docChanged || value.composing && !composing || syntaxTree(transaction.state) !== syntaxTree(transaction.startState);
    const changed = syntaxChanged || windows !== value.windows || transaction.state.facet(headingMarkersFacet) !== transaction.startState.facet(headingMarkersFacet);
    if (!changed && !transaction.selection && focused === value.focused && composing === value.composing &&
        projected === value.projected && folds === value.folds &&
        transaction.state.field(markdownListField, false) === transaction.startState.field(markdownListField, false)) return value;
    let parts = value.parts;
    if (transaction.docChanged && !value.composing) {
      // Generated content can depend on an offscreen heading, footnote, or
      // reference definition. Reproject dependencies with the same ready tree.
      const before = markdownDocumentIndex(transaction.startState.doc, syntaxTree(transaction.startState), getParsedTables(transaction.startState.doc));
      const after = markdownDocumentIndex(transaction.state.doc, syntaxTree(transaction.state), getParsedTables(transaction.state.doc));
      const dependent = value.parts.some(part => part.kind === "toc" || part.kind === "footnote") ||
        after.footnotes.size > 0 || before.referenceSignature !== after.referenceSignature;
      const changedWindows = dependent ? [{ from: 0, to: transaction.state.doc.length }] : markdownChangedWindows(transaction);
      parts = [...parts.map(part => mapPreviewPart(part, transaction.changes)).filter(part =>
        part.from < part.to && part.owner.from < part.owner.to && !changedWindows.some(window => overlaps(part.owner, window))),
        ...previewParts(transaction.state, changedWindows)]
        .sort((a, b) => a.from - b.from || b.to - a.to);
    } else if (changed) parts = previewParts(transaction.state, windows);
    const next = { parts, windows, focused, composing, projected, folds };
    return { ...next, decorations: decorations(transaction.state, next) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

export function isMarkdownPreviewActive(view: EditorView, range: MarkdownRange): boolean {
  const value = view.state.field(markdownPreviewField, false);
  return !!value && !previewOwnerActive(range, view.state.selection, view.hasFocus, value.projected);
}

/** Land on fence source rows before browser hit testing can skip glyphs or hit the toolbar. */
export function markdownFenceEntry(state: EditorState, forward: boolean, nextHead: number): number | null {
  const current = state.doc.lineAt(state.selection.main.head);
  const number = current.number + (forward ? 1 : -1);
  if (number < 1 || number > state.doc.lines) return null;
  const line = state.doc.line(number);
  if (markdownListRangeHidden(state, line)) return null;
  // A wrapped visual row still belongs to the current source line.
  if (forward ? nextHead < line.from : nextHead > line.to) return null;
  const part = state.field(markdownPreviewField, false)?.parts.find(part =>
    part.from === line.from && part.fence &&
    (part.kind === "code-header" || !forward && part.kind === "code-end"));
  return part?.fence?.to ?? null;
}

function enterMarkdownFence(view: EditorView, forward: boolean): boolean {
  const selection = view.state.selection;
  const projection = getDocumentSelectionProjection(view.dom.ownerDocument, selection.main);
  if (!view.hasFocus || view.compositionStarted || view.composing || selection.ranges.length !== 1 ||
      !selection.main.empty || view.dom.ownerDocument.activeElement?.closest(".mlrt-table-widget") ||
      (projection && projection.tableRegions.length > 0)) return false;
  const next = view.moveVertically(selection.main, forward);
  const head = markdownFenceEntry(view.state, forward, next.head);
  if (head === null) return false;
  // At the opening line end, -1 keeps the caret beside the last source glyph,
  // before the absolutely positioned copy widget anchored at the same offset.
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(head, -1)]),
    effects: activityEffect.of({ focused: true, composing: false, projected: null }),
    scrollIntoView: true, userEvent: "select" });
  return true;
}

/** Direct field decorations may collapse block rows. Viewport discovery itself never supplies block decorations. */
export function createMarkdownLivePreviewExtensions(screenReaderOptimized: boolean, showHeadingMarkers = true): Extension {
  if (screenReaderOptimized) return [];
  return [headingMarkersFacet.of(showHeadingMarkers), markdownPreviewField, keymap.of([
    { key: "ArrowDown", run: view => enterMarkdownFence(view, true) },
    { key: "ArrowUp", run: view => enterMarkdownFence(view, false) },
  ]), ViewPlugin.fromClass(class {
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
        const effects = [];
        const focused = view.hasFocus || !!view.dom.ownerDocument.activeElement?.closest(".mlrt-preview-code-header");
        // Mixed table/prose selections already publish their exact linear
        // envelope in state.selection. Do not mirror that range with a later
        // presentation transaction: it would recreate a native browser range
        // after the table's pointer controller deliberately cleared it.
        if (field.focused !== focused || field.composing !== this.composing) effects.push(activityEffect.of({ focused, composing: this.composing, projected: null }));
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
