import assert from "node:assert/strict";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection, EditorState, Text } from "@codemirror/state";
import { markdownParserExtensions, markdownRenderingParser } from "../editor/markdown/markdownSyntax";
import { classifyMarkdownPreview, createMarkdownLivePreviewExtensions, markdownPreviewField, previewOwnerActive, frontmatterPropertyRows, codeBlockText, PreviewPart } from "../editor/markdown/markdownLivePreview";
import { markdownListLine, planMarkdownListEdit } from "../editor/markdown/markdownListEditing";
import { getParsedTables } from "../shared/tableModel";

const text = (source: string): Text => Text.of(source.split("\n"));
const project = (source: string, showHeadingMarkers = true) => { const doc = text(source); return classifyMarkdownPreview(doc, markdownRenderingParser.parse(source), getParsedTables(doc), [{ from: 0, to: doc.length }], showHeadingMarkers); };
const source = '# Header\n\n**bold *nested*** ` code ` [label](file.md "title") [[Note|Alias]]\n\n```js\nconst n = 1;\n```\n\n> [!INFO]- Title\n> body\n';
const parts = project(source);
for (const syntax of ["**", "`", '[', '](file.md "title")', '[[Note|', ']]']) {
  assert(parts.some(part => part.kind === "hide" && source.slice(part.from, part.to) === syntax), syntax);
}
const copied = (source: string, part?: PreviewPart): string => { assert(part?.copy); return codeBlockText(text(source), part.copy.from, part.copy.to, part.copy.prefix, part.copy.indented); };
const code = parts.find(part => part.kind === "code-header"); assert(code); assert.equal(code.label, "js"); assert.equal(copied(source, code), "const n = 1;\n");
assert.equal(code.block, undefined, "opening fence stays an ordinary numbered row");
assert.equal(parts.find(part => part.kind === "code-end")?.block, undefined, "closing fence keeps its padding row");
assert(!project('# Heading ##').some(part => part.kind === 'hide'), 'both heading markers remain visible by default');
assert.equal(project('# Heading ##', false).filter(part => part.kind === 'hide').length, 2);
const headingCompartment = new Compartment();
let headingState = EditorState.create({ doc: '# Heading', extensions: [markdown({ extensions: markdownParserExtensions }), headingCompartment.of(createMarkdownLivePreviewExtensions(false))] });
assert.equal(headingState.field(markdownPreviewField).parts.length, 0);
headingState = headingState.update({ effects: headingCompartment.reconfigure(createMarkdownLivePreviewExtensions(false, false)) }).state;
assert.equal(headingState.field(markdownPreviewField).parts.length, 1, 'changing the setting updates an existing preview field');
headingState = headingState.update({ effects: headingCompartment.reconfigure(createMarkdownLivePreviewExtensions(false, true)) }).state;
assert.equal(headingState.field(markdownPreviewField).parts.length, 0);
const fenceState = EditorState.create({ doc: '```ts\nconst n = 1;\n```', extensions: [markdown({ extensions: markdownParserExtensions }), createMarkdownLivePreviewExtensions(false)] });
const fenceDecorations: { from: number; to: number; spec: Record<string, unknown> }[] = [];
fenceState.field(markdownPreviewField).decorations.between(0, fenceState.doc.length, (from, to, decoration) => { fenceDecorations.push({ from, to, spec: decoration.spec }); });
assert(fenceDecorations.every(decoration => !decoration.spec.block), 'fence decorations never insert or replace block rows');
assert.deepEqual(fenceDecorations.filter(decoration => decoration.spec.class === 'mlrt-preview-code-fence-hidden').map(({ from, to }) => fenceState.doc.sliceString(from, to)), ['```ts', '```'], 'the complete opening fence, including its language, hides without removing source columns');
const callout = parts.find(part => part.kind === "callout"); assert(callout); assert.equal(callout.label, "Title"); assert.equal(callout.collapsed, true);
const owner = { from: 10, to: 20 };
assert(previewOwnerActive(owner, EditorSelection.single(15), true));
assert(previewOwnerActive(owner, EditorSelection.single(10), true));
assert(!previewOwnerActive(owner, EditorSelection.single(15), false));
assert(previewOwnerActive(owner, EditorSelection.single(8, 12), false));
assert(!previewOwnerActive(owner, EditorSelection.single(1), true));
assert(previewOwnerActive(owner, EditorSelection.single(1), true, { from: 12, to: 25 }));
assert.equal(project('`**literal** [[No]]`').filter(part => part.kind === "hide").length, 2);
assert.equal(project('**unclosed').length, 0);
assert.equal(project('<!-- **literal** -->').length, 0);
const table = '| A | B |\n| --- | --- |\n| **bold** | [[Note]] |'; assert.equal(project(table).length, 0);
const yaml = '---\ntitle: "A note"\ntags:\n  - one\n  - two\n---';
assert.equal(project(yaml)[0]?.kind, "properties");
assert.deepEqual(frontmatterPropertyRows(yaml).map(row => [row.key, row.value]), [["title", "A note"], ["tags", "one · two"]]);
const nestedCode = '> ```js\n> const n = 1;\n> ```'; assert.equal(copied(nestedCode,project(nestedCode).find(part => part.kind === "code-header")), 'const n = 1;\n');
assert(!project(nestedCode).some(part => part.kind === 'hide'), 'quoted fence prefixes retain their source columns in preview');
const quotedEnd = project(nestedCode).find(part => part.kind === 'code-end'); assert(quotedEnd?.fence);
assert.equal(nestedCode.slice(quotedEnd.fence.from, quotedEnd.fence.to), '> ```', 'closing preview row is blank even inside a quote');
const indented = 'Before\n\n    first\n    second\n'; assert.equal(copied(indented,project(indented).find(part => part.kind === "code-header")), 'first\nsecond');
for (const [source, expected] of [
  ['- ```js\n  first\n    nested\n  ```', 'first\n  nested\n'],
  ['> - ```js\n>   first\n>     nested\n>   ```', 'first\n  nested\n'],
  ['  ```js\n  first\n    nested\n x\n  ```', 'first\n  nested\nx\n'],
  ['- item\n\n      first\n        nested', 'first\n  nested'],
  ['>     first\n>       nested', 'first\n  nested'],
]) assert.equal(copied(source, project(source).find(part => part.kind === 'code-header')), expected, source);
const huge = '```\n'+'line\n'.repeat(10000)+'```';
const hugeDoc = text(huge), window = {from:hugeDoc.line(7000).from,to:hugeDoc.line(7005).to};
assert.equal(classifyMarkdownPreview(hugeDoc,markdownRenderingParser.parse(huge),[],[window]).length,0,'offscreen code toolbar does not copy or retain a full block');

function state(source: string, position = source.length): EditorState {
  return EditorState.create({ doc: source, selection: { anchor: position }, extensions: markdown({ extensions: markdownParserExtensions }) });
}
function apply(source: string, action: Parameters<typeof planMarkdownListEdit>[1], position = source.length): string {
  const before = state(source, position), plan = planMarkdownListEdit(before, action); assert(plan, `${action} for ${source}`); return before.update(plan).state.doc.toString();
}
assert.equal(apply('- hello', 'enter'), '- hello\n- ');
assert.equal(apply('9. hello', 'enter'), '9. hello\n10. ');
assert.equal(apply('- [x] done', 'enter'), '- [x] done\n- [ ] ');
assert.equal(apply('- ', 'enter'), '');
assert.equal(apply('- parent\n  - ', 'enter'), '- parent\n- ');
assert.equal(apply('- parent\n  - child\n    - grandchild', 'indent', 17), '- parent\n    - child\n      - grandchild');
assert.equal(apply('- parent\n  - child\n    - grandchild', 'outdent', 17), '- parent\n- child\n  - grandchild');
assert.equal(apply('- text', 'backspace', 2), 'text');
assert.equal(planMarkdownListEdit(state('```\n- literal\n```', 12), 'enter'), null);
assert.equal(planMarkdownListEdit(state('text'), 'indent'), null);
const listSource = '- parent\n  - child'; const doc = text(listSource);
assert.equal(markdownListLine(doc, markdownRenderingParser.parse(listSource), 13)?.contentFrom, 13);
assert.equal(markdownListLine(doc, markdownRenderingParser.parse(listSource), 9)?.contentFrom, 13);
console.log('Live Preview projection, reveal, properties, code copy, and list edit plans passed.');
