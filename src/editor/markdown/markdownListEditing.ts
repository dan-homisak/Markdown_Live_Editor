import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Extension, Prec, Text, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { SyntaxNode, Tree } from "@lezer/common";
import { getParsedTables } from "../../shared/tableModel";
import { getDocumentSelectionProjection } from "../documentSelectionState";
import { MarkdownRange } from "./markdownSyntax";

export interface ListLine {
  from: number; to: number; itemTo: number;
  prefix: string; indent: string; marker: string; task: string; contentFrom: number;
}

/** The parser supplies ownership; the prefix pattern only locates editable source. */
export function markdownListLine(doc: Text, tree: Tree, position: number, tables: readonly MarkdownRange[] = []): ListLine | null {
  if (tables.some(table => table.from <= position && position < table.to)) return null;
  const line = doc.lineAt(position);
  let item: SyntaxNode | null = null;
  const markerPosition = line.from + Math.max(0, line.text.search(/\S/u)) + 1;
  for (const at of [position, Math.min(line.to, markerPosition)]) {
    for (const side of [-1, 1] as const) {
      for (let node: SyntaxNode | null = tree.resolveInner(at, side); node; node = node.parent) {
        if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "MarkdownFrontmatter"].includes(node.name)) return null;
        if (node.name === "ListItem" && !item && doc.lineAt(node.from).number === line.number) item = node;
      }
    }
    if (item) break;
  }
  if (!item || doc.lineAt(item.from).number !== line.number) return null;
  const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/u.exec(line.text);
  if (!match) return null;
  return { from: line.from, to: line.to, itemTo: item.to, prefix: match[1], indent: match[2], marker: match[3],
    task: match[5] ?? "", contentFrom: line.from + match[0].length };
}

export function planMarkdownListEdit(state: EditorState, action: "enter" | "indent" | "outdent" | "backspace"): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  const selection = state.selection.main, doc = state.doc, tree = syntaxTree(state), tables = getParsedTables(doc);
  const item = markdownListLine(doc, tree, selection.head, tables);
  if (!item) return null;
  if (action === "enter") {
    if (!selection.empty || selection.head < item.contentFrom) return null;
    if (!doc.sliceString(item.contentFrom, item.to).trim()) {
      if (item.indent) return planMarkdownListEdit(state, "outdent");
      return { changes: { from: item.from + item.prefix.length, to: item.contentFrom, insert: "" },
        selection: { anchor: item.from + item.prefix.length }, userEvent: "input.list" };
    }
    const number = /^(\d+)([.)])$/u.exec(item.marker);
    const next = number ? `${Number(number[1]) + 1}${number[2]}` : item.marker;
    const insert = `\n${item.prefix}${item.indent}${next} ${item.task ? "[ ] " : ""}`;
    return { changes: { from: selection.head, insert }, selection: { anchor: selection.head + insert.length }, userEvent: "input.list" };
  }
  if (action === "backspace" && (!selection.empty || selection.head !== item.contentFrom)) return null;
  const outdent = action === "outdent" || action === "backspace";
  // At an unindented item start Backspace removes its structural prefix once.
  if (outdent && !item.indent) return action === "backspace" ? {
    changes: { from: item.from + item.prefix.length, to: item.contentFrom, insert: "" },
    selection: { anchor: item.from + item.prefix.length }, userEvent: "input.list",
  } : null;
  let firstLine = doc.lineAt(item.from).number, lastLine = doc.lineAt(item.itemTo).number;
  if (!selection.empty) {
    firstLine = doc.lineAt(selection.from).number;
    lastLine = doc.lineAt(selection.to > selection.from && doc.lineAt(selection.to).from === selection.to ? selection.to - 1 : selection.to).number;
    for (let number = firstLine; number <= lastLine; number++) {
      const line = doc.line(number);
      if (line.text.trim() && !markdownListLine(doc, tree, line.from + line.text.length, tables)) return null;
    }
  }
  const unit = item.indent.includes("\t") ? "\t" : "  ";
  const remove = item.indent.startsWith("\t") ? 1 : Math.min(2, item.indent.length);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let number = firstLine; number <= lastLine; number++) {
    const line = doc.line(number);
    if (tables.some(table => table.from < line.to && table.to > line.from)) return null;
    const quote = /^(?:[ \t]*>[ \t]?)*/u.exec(line.text)?.[0] ?? "";
    const from = line.from + quote.length;
    const available = /^[ \t]*/u.exec(line.text.slice(quote.length))?.[0].length ?? 0;
    if (!outdent) changes.push({ from, to: from, insert: unit });
    else if (available) changes.push({ from, to: from + Math.min(remove, available), insert: "" });
  }
  const set = state.changes(changes);
  return { changes: set, selection: state.selection.map(set), userEvent: "input.list" };
}

function ownsSource(view: EditorView): boolean {
  const projection = getDocumentSelectionProjection(view.dom.ownerDocument, view.state.selection.main);
  return view.hasFocus && !view.compositionStarted && !view.composing &&
    !view.dom.ownerDocument.activeElement?.closest(".mlrt-table-widget") &&
    (!projection || projection.tableRegions.length === 0);
}
function edit(action: Parameters<typeof planMarkdownListEdit>[1]): (view: EditorView) => boolean {
  return view => {
    if (!ownsSource(view)) return false;
    const transaction = planMarkdownListEdit(view.state, action);
    if (!transaction) return false;
    view.dispatch({ ...transaction, scrollIntoView: true }); return true;
  };
}
function vertical(view: EditorView, forward: boolean): boolean {
  if (!ownsSource(view) || !view.state.selection.main.empty || view.state.selection.ranges.length !== 1) return false;
  const current = view.state.selection.main, next = view.moveVertically(current, forward);
  const list = markdownListLine(view.state.doc, syntaxTree(view.state), next.head, getParsedTables(view.state.doc));
  if (!list || next.head >= list.contentFrom) return false;
  // Clamp only when vertical motion would land in indentation/markers. Preserve
  // the preferred visual column for the following movement and wrapped rows.
  view.dispatch({ selection: EditorSelection.cursor(list.contentFrom, next.assoc, next.bidiLevel ?? undefined, next.goalColumn),
    scrollIntoView: true, userEvent: "select" }); return true;
}
function home(view: EditorView): boolean {
  if (!ownsSource(view) || !view.state.selection.main.empty) return false;
  const head = view.state.selection.main.head;
  const list = markdownListLine(view.state.doc, syntaxTree(view.state), head, getParsedTables(view.state.doc));
  if (!list) return false;
  view.dispatch({ selection: { anchor: head === list.contentFrom ? list.from : list.contentFrom }, scrollIntoView: true }); return true;
}
/** Table boundary keymaps are installed first and retain first refusal. */
export function createMarkdownListEditing(readOnly = false): Extension {
  const mutate = (action: Parameters<typeof planMarkdownListEdit>[1]) => readOnly ? () => false : edit(action);
  return [keymap.of([
    { key: "ArrowUp", run: view => vertical(view, false) },
    { key: "ArrowDown", run: view => vertical(view, true) },
    { key: "Home", run: home },
  ]), Prec.high(keymap.of([
    { key: "Enter", run: mutate("enter") },
    { key: "Tab", run: mutate("indent"), shift: mutate("outdent") },
    { key: "Mod-[", run: mutate("outdent") }, { key: "Mod-]", run: mutate("indent") },
    { key: "Backspace", run: mutate("backspace") },
  ]))];
}
