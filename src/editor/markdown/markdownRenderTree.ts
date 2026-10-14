import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, Range, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, ViewPlugin, EditorView } from "@codemirror/view";
import { Tree } from "@lezer/common";
import { MarkdownRange } from "./markdownSyntax";

// A partial Markdown tree cannot decide whether a distant row is code, prose,
// or part of a replacement that changes document height. Finish the incremental
// parse in the state update, before any presentation consumer paints that state.
// Lezer reuses unchanged fragments; scrolling never reparses the document.
export const markdownRenderTreeField = StateField.define<Tree>({
  create: state => ensureSyntaxTree(state, state.doc.length, Infinity) ?? syntaxTree(state),
  update: (tree, transaction) => transaction.docChanged ||
    syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
    ? ensureSyntaxTree(transaction.state, transaction.state.doc.length, Infinity) ?? syntaxTree(transaction.state) : tree,
});

export function markdownRenderTree(state: EditorState): Tree {
  return state.field(markdownRenderTreeField, false) ?? syntaxTree(state);
}

interface Block extends MarkdownRange { tree: Tree }
const blocksByTree = new WeakMap<Tree, readonly Block[]>();
const windowsByTransaction = new WeakMap<Transaction, readonly MarkdownRange[]>();
function blocks(tree: Tree): readonly Block[] {
  let known = blocksByTree.get(tree);
  if (!known) {
    const result: Block[] = [];
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) result.push({ from: node.from, to: node.to, tree: node.toTree() });
    blocksByTree.set(tree, known = result);
  }
  return known;
}

/** Reused Lezer block trees retain their mapped decorations after edits. Only
 * changed owners are projected again; a changed fence/reference can still
 * invalidate distant blocks because their tree identity changes too. */
export function markdownChangedWindows(transaction: Transaction): readonly MarkdownRange[] {
  const cached = windowsByTransaction.get(transaction);
  if (cached) return cached;
  const oldBlocks = blocks(markdownRenderTree(transaction.startState)), newBlocks = blocks(markdownRenderTree(transaction.state));
  const byStart = new Map(newBlocks.map(block => [block.from, block]));
  const touched: MarkdownRange[] = [], dirty: MarkdownRange[] = [], retained = new Set<Block>();
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => { touched.push({ from: fromA, to: toA }); dirty.push({ from: fromB, to: toB }); });
  for (const block of oldBlocks) {
    const from = transaction.changes.mapPos(block.from, 1), to = transaction.changes.mapPos(block.to, -1), next = byStart.get(from);
    if (next?.to === to && next.tree === block.tree && !touched.some(range => range.from <= block.to && range.to >= block.from)) retained.add(next);
    else dirty.push({ from: Math.min(from, to), to: Math.max(from, to) });
  }
  for (const block of newBlocks) if (!retained.has(block)) dirty.push(block);
  const doc = transaction.state.doc, windows: { from: number; to: number }[] = [];
  for (const range of dirty.sort((a, b) => a.from - b.from)) {
    const from = doc.lineAt(range.from).from, to = Math.min(doc.length, doc.lineAt(range.to).to + 1);
    const previous = windows.at(-1);
    if (previous && previous.to >= from) previous.to = Math.max(previous.to, to);
    else windows.push({ from, to });
  }
  windowsByTransaction.set(transaction, windows);
  return windows;
}

export function updateMarkdownDecorations(previous: DecorationSet, transaction: Transaction,
  replacement: DecorationSet, windows: readonly MarkdownRange[]): DecorationSet {
  const add: Range<Decoration>[] = [];
  for (let cursor = replacement.iter(); cursor.value; cursor.next()) add.push(cursor.value.range(cursor.from, cursor.to));
  return previous.map(transaction.changes).update({ add, sort: true,
    filter: (from, to) => !windows.some(window => from < window.to && to >= window.from) });
}

export const markdownCompositionEffect = StateEffect.define<boolean>();
export function markdownComposing(transaction: Transaction, previous: boolean): boolean {
  for (const effect of transaction.effects) if (effect.is(markdownCompositionEffect)) previous = effect.value;
  return previous;
}

// Freeze presentation during native IME mutations, then rebuild after the DOM
// observer has imported the final input. No viewport changes are involved.
export function createMarkdownCompositionTracking() {
  return ViewPlugin.fromClass(class {
    constructor(readonly view: EditorView) {}
  }, { eventHandlers: {
    compositionstart() { this.view.dispatch({ effects: markdownCompositionEffect.of(true) }); return false; },
    compositionend() {
      queueMicrotask(() => { if (this.view.dom.isConnected) this.view.dispatch({ effects: markdownCompositionEffect.of(false) }); });
      return false;
    },
  } });
}
