import assert from "node:assert/strict";
import { EditorState, Text, Transaction } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { parseDocument } from "yaml";
import { formattedPropertyBody, planPropertyEnter, planPropertyIndent, propertyCompletions, propertyDiagnostics, propertyInputFilter } from "../editor/markdown/markdownProperties";

const state = (doc: string, anchor = doc.length, readOnly = false) => EditorState.create({
  doc, selection: { anchor }, extensions: [propertyInputFilter, EditorState.readOnly.of(readOnly)],
});
const type = (doc: string, anchor: number, insert: string, userEvent = "input.type") => state(doc, anchor).update({
  changes: { from: anchor, insert }, selection: { anchor: anchor + insert.length }, userEvent,
}).state;
const enter = (doc: string, anchor: number) => {
  const s = state(doc, anchor), plan = planPropertyEnter(s); assert(plan); return s.update(plan).state;
};
const source = (s: EditorState) => s.doc.toString();
const diagnostics = (body: string) => propertyDiagnostics(Text.of((`---\n${body}\n---\n\nBody`).split("\n")));

assert.equal(source(type("--\n# Keep this\n\n---\nBody", 2, "-")), "---\n\n---\n\n# Keep this\n\n---\nBody", "a later thematic break must not swallow the existing body");
assert.equal(type("--\nBody", 2, "-").selection.main.head, 4);
assert.equal(source(type("", 0, "---", "input.paste")), "---\n\n---\n\n");
assert.equal(source(type("", 0, "---\ntitle: Existing\n---\nBody", "input.paste")), "---\ntitle: Existing\n---\nBody", "complete pasted frontmatter stays exact");
assert.equal(source(type("Body\n--", 7, "-")), "Body\n---");
assert.equal(source(type("--suffix", 2, "-")), "---suffix");
assert.equal(source(type("--", 2, "-", "undo")), "---");
assert.equal(source(state("--").update({ changes: { from: 2, insert: "-" }, annotations: Transaction.addToHistory.of(false) }).state), "---", "host synchronization is never auto-edited");
assert.equal(source(type("---\ntitle\n---", 9, ":")), "---\ntitle: \n---");
assert.equal(type("---\ntitle\n---", 9, ":").selection.main.head, 11, "caret follows the inserted separator space");
assert.equal(source(type("---\ntext: |\n  title\n---", 19, ":")), "---\ntext: |\n  title:\n---", "literal contents stay exact");

assert.equal(source(enter("---\ntitle:Hello\n---\nBody", 15)), "---\ntitle: Hello\n\n---\nBody");
assert.equal(source(enter("---\ntags:\n---", 9)), "---\ntags:\n  - \n---");
assert.equal(source(enter("---\ntags:\n  - one\n---", 17)), "---\ntags:\n  - one\n  - \n---");
assert.equal(source(enter("---\ntags:\n  - \n---", 14)), "---\ntags:\n\n---");
assert.equal(source(enter("---\ncustom\n---", 10)), "---\ncustom: \n---");
assert.equal(source(enter("---\ndetails: |\n---", 14)), "---\ndetails: |\n  \n---");
assert.equal(source(enter("---\ntext: |\n  title:literal\n---", 27)), "---\ntext: |\n  title:literal\n  \n---");
assert.equal(enter("---\n\n---\nBody", 8).selection.main.head, 10, "closing fence Enter lands in the body");
assert.equal(source(enter("---\n\n---\nBody", 8)), "---\n\n---\n\nBody");
assert.equal(planPropertyEnter(state("Text", 4)), null);
assert.equal(planPropertyEnter(state("---\nkey: value\n---", 8, true)), null);
const indentState = state("---\n  child: value\n---", 8), outdent = planPropertyIndent(indentState, true); assert(outdent);
assert.equal(source(indentState.update(outdent).state), "---\nchild: value\n---");
const tabState = state("---\nchild: value\n---", 8), tab = planPropertyIndent(tabState, false); assert(tab);
assert.equal(source(tabState.update(tab).state), "---\n  child: value\n---");
const blank = state("---\n\n---", 4), blankTab = planPropertyIndent(blank, false); assert(blankTab);
assert.equal(blank.update(blankTab).state.selection.main.head, 6, "Tab puts the caret after its spaces on an empty row");

const suggest = (doc: string, pos: number) => propertyCompletions(new CompletionContext(state(doc, pos), pos, true));
assert.equal(suggest("---\n\n---", 4)?.options[0].label, "tags");
assert(!suggest("---\ntags: []\n\n---", 13)?.options.some(item => item.label === "tags"));
assert.equal(suggest("---\ntitle: value\n---", 12), null);
assert.equal(suggest("---\ntext: |\n  tags\n---", 17), null);
assert.equal(suggest("Body\n", 5), null);

assert.equal(diagnostics("title: Valid\ntags:\n  - one\nenabled: true").length, 0);
assert(diagnostics("title: One\ntitle: Two").some(d => d.message.includes("unique")));
assert(diagnostics("title:Hello").some(d => d.message.includes("mapping")));
assert(diagnostics("title: [unfinished").some(d => d.severity === "error"));
assert(diagnostics("tags:\n\t- one").some(d => d.severity === "error"));
assert(diagnostics("true: value").some(d => d.message.includes("property name")));
assert(diagnostics("ref: *missing").some(d => d.message.includes("Unknown YAML anchor")));
assert.equal(formattedPropertyBody("title: One\ntitle: Two\n"), null);
assert.equal(formattedPropertyBody("title:Hello\n"), null);
const complex = '# keep comment\ntitle:    "001" # keep inline\ntags:\n    - one\n    - two\ntext: |\n    literal:unchanged\n    next line\nbase: &base {a: 1}\nref: *base\nurl: https://example.test/a:b\n';
const formatted = formattedPropertyBody(complex); assert(formatted);
assert.deepEqual(parseDocument(formatted).toJS(), parseDocument(complex).toJS(), "formatting preserves scalar types, multiline contents and aliases");
assert(formatted.includes('# keep comment') && formatted.includes('# keep inline') && formatted.includes('"001"'));
assert(formatted.includes('tags:\n  - one\n  - two\n'));
console.log("YAML properties creation, formatting, validation and keyboard plans passed.");
