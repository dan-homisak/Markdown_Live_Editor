import assert from "node:assert/strict";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { markdownParserExtensions } from "../editor/markdown/markdownSyntax";
import { markdownRenderTreeField } from "../editor/markdown/markdownRenderTree";
import { markdownListField, markdownListFoldEffect, markdownListRangeHidden } from "../editor/markdown/markdownListStructure";

const source = ['- Parent', '  - Child', '    - Grandchild', '  - Sibling', '- Next', '  - Last', '',
  '```md', '- Literal', '  - Not a child', '```'].join('\n');
const create = (doc = source) => EditorState.create({ doc, extensions: [markdown({ extensions: markdownParserExtensions }), markdownRenderTreeField, markdownListField] });
const fold = (state: EditorState, from: number, collapsed = true) => state.update({ effects: markdownListFoldEffect.of({ from, collapsed }) }).state;
let state = create();
assert.equal(state.field(markdownListField).items.length, 6, 'code-like bullets are not list owners');
state = fold(state, source.indexOf('- Child'));
assert(markdownListRangeHidden(state, { from: source.indexOf('- Grandchild'), to: source.indexOf('- Grandchild') + 1 }));
assert(!markdownListRangeHidden(state, { from: source.indexOf('- Sibling'), to: source.indexOf('- Sibling') + 1 }));
state = fold(state, 0);
assert.equal(state.field(markdownListField).hidden.length, 1, 'only outermost replacement is emitted');
state = fold(state, 0, false);
assert.equal(state.field(markdownListField).hidden[0].from, source.indexOf('\n', source.indexOf('- Child')), 'child state survives parent expansion');
const hidden = state.field(markdownListField).hidden[0];
state = state.update({ selection: { anchor: hidden.to } }).state;
assert.equal(state.field(markdownListField).hidden.length, 1, 'atomic arrow boundary does not expand a fold');
state = state.update({ selection: { anchor: hidden.from + 2 } }).state;
assert.equal(state.field(markdownListField).hidden.length, 0, 'explicit navigation inside content reveals it');
state = fold(create(), 0);
state = state.update({ changes: { from: 0, insert: 'Before\n\n' } }).state;
assert(state.field(markdownListField).collapsed.has(8), 'fold tracks preceding edits');
state = fold(create(), 0);
state = state.update({ changes: { from: 0, to: source.indexOf('- Next') } }).state;
assert.equal(state.field(markdownListField).collapsed.size, 0, 'deleting a folded parent never transfers its state to the next item');
const blocks = '- Parent\n\n  Paragraph\n\n  > Quote\n\n  ```js\n  const x = 1;\n  ```\n\n  | A | B |\n  | --- | --- |\n  | cell | cell |\n\n- Next';
state = fold(create(blocks), 0);
for (const label of ['Paragraph', '> Quote', 'const x', '| cell']) {
  const from = blocks.indexOf(label);
  assert(markdownListRangeHidden(state, { from, to: from + label.length }), label);
}
for (const doc of ['1. Parent\n   - Mixed\n     - Deep', '- [ ] Parent\n  - [x] Child', '- Parent\n\t- Child', '- Empty\n  -']) {
  state = fold(create(doc), doc.indexOf(doc.trimStart()));
  assert.equal(state.field(markdownListField).hidden[0].to, doc.length, 'ordered, task, tab and empty descendants fold through EOF');
}
for (const marker of ['-', '+', '*', '2.', '12)', '- [ ]', '- [x]']) {
  for (const after of ['ordinary text', '**bold**', '*italic*', '`code`', '[link](./target.md)', '# Heading', '> Quote', '- next']) {
    const doc = `Before\n${marker} item\n${after}`;
    state = fold(create(doc), doc.indexOf(marker));
    assert.equal(state.field(markdownListField).items[0].to, doc.indexOf('\n', doc.indexOf(marker)),
      `${after} begins its own row after ${marker} without a blank separator`);
    assert.equal(state.field(markdownListField).hidden.length, 0, 'a following independent row cannot be folded into the list');
  }
}
for (const doc of ['- Parent\n  - Child\nAfter', '- Parent\n\t- Child\nAfter', '10. Parent\n    - Child\nAfter', '> - Parent\n>   - Child\n> After']) {
  state = fold(create(doc), doc.startsWith('>') ? 2 : 0);
  assert.equal(state.field(markdownListField).hidden[0].to, doc.lastIndexOf('\n'), 'folding stops before an unindented row, including quoted and tab-indented lists');
}
state = create('- Parent\n  - Child\n  Parent continuation\nAfter');
assert.deepEqual(state.field(markdownListField).items.map(item => item.to), [state.doc.line(3).to, state.doc.line(2).to],
  'dedenting a child restores parent ownership without requiring a blank row');
console.log('Markdown list structure tests passed.');
