import { autocompletion, completionKeymap, completionStatus, CompletionContext, CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { Diagnostic, linter } from "@codemirror/lint";
import { ChangeSpec, EditorState, Extension, Prec, Text, Transaction, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { isAlias, isCollection, isMap, isNode, isScalar, parseDocument, visit } from "yaml";
import { findMarkdownFrontmatter, MarkdownFrontmatterBounds } from "./markdownBlockSyntax";

const boundsCache = new WeakMap<Text, MarkdownFrontmatterBounds | null>();
export function propertyBounds(doc: Text): MarkdownFrontmatterBounds | null {
  if (!boundsCache.has(doc)) boundsCache.set(doc, findMarkdownFrontmatter({ length: doc.length, read: (a, b) => doc.sliceString(a, b) }));
  return boundsCache.get(doc)!;
}

function parse(source: string) {
  return parseDocument(source, { prettyErrors: false, strict: true, uniqueKeys: true });
}

/** Validate YAML itself, rather than a regex approximation of property values. */
export function propertyDiagnostics(doc: Text): Diagnostic[] {
  const bounds = propertyBounds(doc);
  if (!bounds) return [];
  const body = doc.sliceString(bounds.contentFrom, bounds.contentTo), yaml = parse(body);
  const diagnostics: Diagnostic[] = [...yaml.errors, ...yaml.warnings].map(error => ({
    from: Math.min(bounds.contentTo, bounds.contentFrom + error.pos[0]),
    to: Math.min(bounds.contentTo, bounds.contentFrom + Math.max(error.pos[0] + 1, error.pos[1])),
    severity: yaml.errors.includes(error) ? "error" : "warning", source: "YAML", message: error.message,
  }));
  if (!yaml.errors.length && yaml.contents && !isMap(yaml.contents)) diagnostics.push({
    from: bounds.contentFrom, to: Math.max(bounds.contentFrom, bounds.contentTo - 1), severity: "error", source: "YAML",
    message: "Properties must be a mapping: write each property as key: value, with a space after the colon.",
  });
  if (isMap(yaml.contents)) for (const pair of yaml.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !pair.key.value.trim()) {
      const from = isScalar(pair.key) ? bounds.contentFrom + (pair.key.range?.[0] ?? 0) : bounds.contentFrom;
      diagnostics.push({ from, to: Math.min(bounds.contentTo, from + 1), severity: "error", source: "YAML",
        message: "A property name must be a non-empty string." });
    }
  }
  visit(yaml, (_key, node) => {
    if (isAlias(node) && !node.resolve(yaml)) diagnostics.push({
      from: bounds.contentFrom + (node.range?.[0] ?? 0), to: bounds.contentFrom + (node.range?.[1] ?? 0),
      severity: "error", source: "YAML", message: `Unknown YAML anchor: ${node.source}.`,
    });
  });
  return diagnostics;
}

/** Only serialize valid mappings. The YAML document retains quotes, comments,
 * anchors and block scalars; ambiguous input remains editable with diagnostics. */
export function formattedPropertyBody(body: string): string | null {
  const yaml = parse(body);
  if (yaml.errors.length || yaml.warnings.length || yaml.contents && !isMap(yaml.contents)) return null;
  if (!body.trim()) return body;
  try { return yaml.toString({ indent: 2, indentSeq: true, lineWidth: 0 }); }
  catch { return null; }
}

/** Do not treat a line inside quoted/block/multiline scalars or flow collections
 * as a property, even when it happens to contain a colon. */
function literalLine(doc: Text, bounds: MarkdownFrontmatterBounds, from: number): boolean {
  const offset = from - bounds.contentFrom, yaml = parse(doc.sliceString(bounds.contentFrom, bounds.contentTo));
  let literal = false;
  visit(yaml, (_key, node) => {
    if (isNode(node) && node.range && node.range[0] < offset && node.range[1] > offset &&
        (isScalar(node) || isCollection(node) && node.flow)) literal = true;
  });
  return literal;
}

const suggestions = [
  { key: "tags", detail: "List of tags", list: true },
  { key: "aliases", detail: "Alternative note names", list: true },
  { key: "title", detail: "Note title" },
  { key: "description", detail: "Short summary" },
  { key: "created", detail: "Creation date" },
  { key: "updated", detail: "Last edited date" },
  { key: "cssclasses", detail: "CSS class names", list: true },
];

export function propertyCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context, bounds = propertyBounds(state.doc), line = state.doc.lineAt(pos);
  if (state.readOnly || !bounds || line.from < bounds.contentFrom || line.from >= bounds.contentTo ||
      !/^[\w-]*$/u.test(line.text) || literalLine(state.doc, bounds, line.from)) return null;
  const yaml = parse(state.doc.sliceString(bounds.contentFrom, bounds.contentTo));
  const existing = new Set(isMap(yaml.contents) ? yaml.contents.items.map(pair => isScalar(pair.key) ? pair.key.value : null) : []);
  return { from: line.from, to: line.to, options: suggestions.filter(item => !existing.has(item.key)).map((item, index) => ({
    label: item.key, detail: item.detail, type: "property", boost: 100 - index,
    apply(view, _completion, from, to) {
      const insert = item.list ? `${item.key}:\n  - ` : `${item.key}: `;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.complete" });
    },
  })) };
}

/** This filter only handles local typing/paste, never file loads or host undo.
 * A newly typed opener always closes before the old body, even if the body
 * contains a later thematic break that looks like a YAML closer. */
export const propertyInputFilter = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.startState.readOnly || !tr.isUserEvent("input") || tr.isUserEvent("input.type.compose")) return tr;
  const first = tr.newDoc.line(1), oldFirst = tr.startState.doc.line(1);
  let singleLineInsert = false;
  tr.changes.iterChanges((from, to, _a, _b, inserted) => {
    if (from <= oldFirst.to && to <= oldFirst.to && inserted.lines === 1) singleLineInsert = true;
  });
  if (/^\uFEFF?---$/u.test(first.text) && !/^\uFEFF?---[ \t]*$/u.test(oldFirst.text) && singleLineInsert &&
      tr.newSelection.main.empty && tr.newSelection.main.head === first.to) {
    const insert = tr.newDoc.length === first.to ? "\n\n---\n\n" : "\n\n---\n";
    return [tr, { changes: { from: first.to, insert }, selection: { anchor: first.to + 1 }, sequential: true }];
  }
  // Add separator whitespace at the moment a simple property colon is typed.
  const bounds = propertyBounds(tr.startState.doc);
  if (!bounds || tr.startState.selection.ranges.length !== 1) return tr;
  const extra: ChangeSpec[] = [];
  tr.changes.iterChanges((from, to, _a, b, inserted) => {
    const line = tr.startState.doc.lineAt(from);
    if (from !== to || inserted.toString() !== ":" || from !== line.to || line.from < bounds.contentFrom ||
        line.from >= bounds.contentTo || !/^ *[\w-]+$/u.test(line.text) || literalLine(tr.startState.doc, bounds, line.from)) return;
    extra.push({ from: b, insert: " " });
  });
  return extra.length ? [tr, { changes: extra, selection: { anchor: tr.newSelection.main.head + 1 }, sequential: true }] : tr;
});

export function planPropertyEnter(state: EditorState): TransactionSpec | null {
  const bounds = propertyBounds(state.doc), selection = state.selection.main;
  if (state.readOnly || !bounds || state.selection.ranges.length !== 1 || !selection.empty || selection.head > bounds.to) return null;
  const line = state.doc.lineAt(selection.head);
  if (line.number === 1) return { selection: { anchor: bounds.contentFrom }, userEvent: "select" };
  if (line.from === bounds.closingFrom) {
    const after = state.doc.sliceString(bounds.to, Math.min(state.doc.length, bounds.to + 2));
    const insert = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    return { changes: { from: bounds.to, insert }, selection: { anchor: bounds.to + 2 }, userEvent: "input.properties" };
  }
  const literal = literalLine(state.doc, bounds, line.from), atEnd = selection.head === line.to;
  let text = line.text, indent = /^ */u.exec(text)![0], suffix = indent;
  if (!literal) {
    const property = /^([\w-]+)[ \t]*:[ \t]*(.*)$/u.exec(text);
    if (property && atEnd) text = `${property[1]}:${property[2] ? " " + property[2] : ""}`;
    if (/^[\w-]+$/u.test(text) && atEnd) {
      const insert = `${text}: `;
      return { changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, userEvent: "input.properties" };
    }
    const item = /^( *)- (.*)$/u.exec(text);
    if (item && atEnd && !item[2].trim()) {
      const insert = indent.slice(0, -2);
      return { changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, userEvent: "input.properties" };
    }
    if (item) suffix = `${indent}- `;
    else if (/:[ \t]*(?:#.*)?$/u.test(text) && atEnd) suffix = `${indent}  ${/^ *(?:tags|aliases|cssclasses):/u.test(text) ? "- " : ""}`;
    else if (/:[ \t]*[|>][+-]?[1-9]?[ \t]*(?:#.*)?$/u.test(text) && atEnd) suffix = `${indent}  `;
  }
  const from = atEnd ? line.from : selection.head, insert = `${atEnd ? text : ""}\n${suffix}`;
  return { changes: { from, to: selection.head, insert }, selection: { anchor: from + insert.length }, userEvent: "input.properties" };
}

export function planPropertyIndent(state: EditorState, outdent: boolean): TransactionSpec | null {
  const bounds = propertyBounds(state.doc), selection = state.selection.main;
  if (state.readOnly || !bounds || state.selection.ranges.length !== 1 || selection.from < bounds.contentFrom || selection.to >= bounds.contentTo) return null;
  const changes: ChangeSpec[] = [];
  const first = state.doc.lineAt(selection.from), last = state.doc.lineAt(selection.to > selection.from ? selection.to - 1 : selection.to);
  for (let number = first.number; number <= last.number; number++) {
    const line = state.doc.line(number), remove = /^ {1,2}|^\t/u.exec(line.text)?.[0].length ?? 0;
    if (outdent) { if (remove) changes.push({ from: line.from, to: line.from + remove, insert: "" }); }
    else changes.push({ from: line.from, insert: "  " });
  }
  const set = state.changes(changes);
  return { changes: set, selection: selection.empty ? { anchor: set.mapPos(selection.head, 1) } : state.selection.map(set), userEvent: "input.properties" };
}

function formatProperties(view: EditorView): void {
  const bounds = propertyBounds(view.state.doc);
  if (!bounds || view.state.readOnly || view.composing || view.compositionStarted) return;
  const body = view.state.doc.sliceString(bounds.contentFrom, bounds.contentTo), formatted = formattedPropertyBody(body);
  if (formatted === null || formatted === body) return;
  // A minimal replacement keeps bookmarks and the caret in the body mapped.
  let start = 0, end = body.length, nextEnd = formatted.length;
  while (start < end && start < nextEnd && body[start] === formatted[start]) start++;
  while (end > start && nextEnd > start && body[end - 1] === formatted[nextEnd - 1]) { end--; nextEnd--; }
  view.dispatch({ changes: { from: bounds.contentFrom + start, to: bounds.contentFrom + end, insert: formatted.slice(start, nextEnd) }, userEvent: "input.properties.format" });
}

class PropertyEditing {
  private dirty = false;
  private destroyed = false;
  private timer: number | undefined;
  constructor(readonly view: EditorView) { this.suggest(); }
  update(update: ViewUpdate): void {
    const oldBounds = propertyBounds(update.startState.doc);
    for (const tr of update.transactions) if (tr.docChanged) {
      if (tr.annotation(Transaction.addToHistory) === false || tr.isUserEvent("undo") || tr.isUserEvent("redo")) this.dirty = false;
      else if (!tr.isUserEvent("input.properties.format")) tr.changes.iterChangedRanges((from) => {
        if (from <= (oldBounds?.to ?? 3)) this.dirty = true;
      });
    }
    if (update.docChanged || update.selectionSet) {
      const bounds = propertyBounds(update.state.doc);
      if (this.dirty && (!bounds || update.state.selection.main.head >= bounds.closingFrom)) this.finish();
      this.suggest();
    }
  }
  finish(): void {
    if (!this.dirty) return;
    this.dirty = false;
    queueMicrotask(() => { if (!this.destroyed) formatProperties(this.view); });
  }
  suggest(): void {
    const win = this.view.dom.ownerDocument.defaultView!;
    win.clearTimeout(this.timer);
    this.timer = win.setTimeout(() => {
      if (this.destroyed || !this.view.hasFocus || this.view.composing || this.view.compositionStarted || completionStatus(this.view.state)) return;
      const state = this.view.state, selection = state.selection.main;
      if (selection.empty && state.doc.lineAt(selection.head).text === "" && propertyCompletions(new CompletionContext(state, selection.head, false))) startCompletion(this.view);
    }, 80);
  }
  destroy(): void { this.destroyed = true; this.view.dom.ownerDocument.defaultView!.clearTimeout(this.timer); }
}

export function createMarkdownProperties(readOnly = false): Extension {
  return [linter(view => propertyDiagnostics(view.state.doc), { delay: 250 }), readOnly ? [] : [
    propertyInputFilter,
    autocompletion({ override: [propertyCompletions], defaultKeymap: false, icons: false,
      tooltipClass: () => "mlrt-property-suggestions", optionClass: () => "mlrt-property-option",
      activateOnTypingDelay: 80, interactionDelay: 0 }),
    Prec.highest(keymap.of(completionKeymap)),
    Prec.high(keymap.of([
      { key: "Enter", run(view) { if (view.composing || view.compositionStarted) return false; const plan = planPropertyEnter(view.state); if (!plan) return false; view.dispatch(plan); return true; } },
      { key: "Tab", run: view => indent(view, false), shift: view => indent(view, true) },
    ])),
    ViewPlugin.fromClass(PropertyEditing, { eventHandlers: {
      blur() { this.finish(); }, focus() { this.suggest(); }, compositionend() { this.suggest(); },
    } }),
  ]];
}

function indent(view: EditorView, outdent: boolean): boolean {
  if (view.composing || view.compositionStarted) return false;
  const plan = planPropertyIndent(view.state, outdent);
  if (!plan) return false;
  view.dispatch(plan); return true;
}
