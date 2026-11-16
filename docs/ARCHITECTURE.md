# Architecture

Updated: 2026-11-16. A map for finding code and for knowing which side owns what. When it
disagrees with the code, the code is right and this file needs fixing. Behavior is described in
the [README](../README.md) and the [design spec](DESIGN_SPEC.md).

## Repository layout

| Path | Holds |
| --- | --- |
| `src/` | Extension source and unit tests |
| `media/` | Stylesheets and the generated webview bundle; shipped |
| `scripts/` | Build, install, host-check and benchmark scripts, and the two repository checkers |
| `test/fixtures/` | Frozen test inputs with a hash manifest |
| `samples/` | Documents for trying the editor by hand; read by no test |
| `docs/` | Design spec, decisions, architecture, testing, workflow, progress, session journals, plans and dated reports |
| `.claude/` | Agent skills, hooks and the reviewer subagent |
| `qa/` | Local output of host checks and benchmarks; ignored by git |
| `dist/` | Compiler and bundler output; ignored by git |

## Two processes, one document

```text
VS Code extension host (Node)                  Webview (browser sandbox)
src/extension.ts  ->  dist/extension.js        src/webview/liveEditor.ts  ->  media/liveEditor.js
  CustomTextEditorProvider                       CodeMirror 6 EditorView
  owns the TextDocument, Undo, files, links      owns presentation, input and table widgets
            |                                              |
            +--------------- postMessage -----------------+
```

- The **VS Code `TextDocument` is the only content model**. The webview holds a working copy and
  proposes changes; the host decides.
- The live editor is a custom text editor with view type `markdownLiveRenderTables.liveEditor`
  and priority `option`, so the stock editor stays the default and
  `markdownLiveRenderTables.toggleEditor` switches between the two for the same file.
- One live editor per document (`supportsMultipleEditorsPerDocument: false`); its webview keeps
  its state while hidden (`retainContextWhenHidden: true`).

## Where code lives

| Path | Role |
| --- | --- |
| `src/extension.ts` | The whole host side: activation, commands, the editor provider, the edit queue, link opening, settings, and the HTML shell with its Content Security Policy |
| `src/webview/liveEditor.ts` | Webview entry: creates the editor, talks to the host, tracks pending edits and acknowledgements |
| `src/editor/liveEditorExtensions.ts` | Assembles the CodeMirror extension set; the best single file for seeing what is installed and in which order |
| `src/editor/table/` | Rendered table widgets: cell editing, range and multi-selection, clipboard, structure controls, layout, source writes |
| `src/editor/markdown/` | Live Preview: syntax classification, concealment and reveal, blocks, lists, links, properties, code highlighting in the webview |
| `src/editor/` (top level) | Document clipboard and selection painting, geometry sync, theme, table boundary navigation, occurrence highlight, and what cell highlights share (`src/editor/cellHighlight.ts`) |
| `src/editor/find/` | Find and replace: the query state, the controller that searches, highlights, navigates and replaces, and the widget |
| `src/editor/multiCursor.ts` | Multiple cursors: turning them on, the keys that act while several exist, the occurrence commands, mouse cursors and column selection |
| `src/shared/` | Logic used by both sides and by tests: the table parser (`src/shared/tableModel.ts`), table source protection, change validation and mapping, clipboard model, what Automatic paste takes (`src/shared/clipboardPasteSource.ts`), link validation, column sizing and its typing delay (`src/shared/tableResizeDelay.ts`), key bindings, the find model (`src/shared/findModel.ts`), and how several selections are copied and pasted (`src/shared/multiCursorModel.ts`) |
| `src/highlighting/` | Host-side grammar and theme collection for code blocks |
| `src/test/` | Node tests, one file per area, run with plain `node` after compilation |
| `media/` | Stylesheets and the bundled webview script. `media/liveEditor.js` is generated and tracked |
| `scripts/` | Build, install, host-check and benchmark scripts; see [TESTING](TESTING.md#suites) |

## Messages

There is no single protocol file. Most message shapes are declared in the two entry files; the
code-highlighting and link requests are declared in `src/shared/`. Search for a message's `type`
string on both sides before changing it.

| Host to webview | Purpose |
| --- | --- |
| `setDocument` | Authoritative text with a revision number, editor options, and a `source` of `host`, `webviewAck` or `webviewReject` (with the change it answers). A `host` snapshot answers `ready` and follows a content change that did not come from a webview edit; a save that leaves the text as it is sends none |
| `setEditorOptions` | Settings, read-only state and metrics changed |
| `captureViewState` | Ask for scroll and caret state before the editor is swapped |
| `historyCommand` | Undo or redo from the title-bar buttons |
| `markdownTaskCommand`, `markdownLinkCommand` | Command Palette actions aimed at the caret |
| `findCommand` | Open find, or find and replace, from the Command Palette |
| `markdownLinkResult` | Outcome of a link request |
| `codeHighlightingConfiguration`, `codeHighlighting`, `refreshCodeHighlighting` | Grammar and theme data, tokens, and invalidation |

| Webview to host | Purpose |
| --- | --- |
| `ready` | The webview can receive the document |
| `change` | An edit claim (next section) |
| `editorCommand` | Undo or Redo, which must run against the host document; carries the text and revision it was issued on |
| `viewState` | Reply to `captureViewState`, sent after pending edits are flushed |
| `openMarkdownLink` | Request to open a link; the host derives the target from source again |
| `requestCodeHighlightingConfiguration`, `requestCodeHighlighting` | Ask for grammar data or tokens |
| `openClipboardSettings`, `debug` | Open the settings page; diagnostics for the output channel |

## The edit path

Every change to the file follows the same route. This is the part of the system that keeps
documents from being corrupted; read it in `src/extension.ts` (`applyFromWebview`) before
touching anything near it.

1. The webview applies the edit optimistically and sends `change` with the full text before and
   after, the source ranges (one group, or several groups applied in sequence), a `changeId` and
   the `baseRevision` it was computed on.
2. The host handles changes one at a time on a promise queue. It drops a change whose base
   revision predates the **conflict floor**, and rejects one from a revision it never sent.
3. `validateDocumentChangeClaim` (`src/shared/documentChangeValidation.ts`) checks the claim
   against the live document text. A task toggle is additionally checked to be one character and
   the document writable.
4. The host applies the ranges with a `WorkspaceEdit`, so the edit enters VS Code's Undo stack,
   and compares the result with the claimed final text. Sequential groups are verified between
   steps.
5. On success the host sends `setDocument` with `webviewAck`. On any mismatch it sends
   `webviewReject`, raises the conflict floor to that revision and shows a warning: the webview
   discards its optimistic state and everything it sent earlier is void.
6. After the snapshot that answers `ready`, the host sends a `host` snapshot only for a change
   event that carries content changes: an external edit, Undo or Redo. A save that leaves the
   text as it is changes only the dirty state and sends nothing; a snapshot of unchanged text
   could cross an edit that is on its way and roll it back. A save that changes the text, by
   trimming or formatting, is a content change like any other.
7. When an acknowledgement leaves no edit unanswered, the webview compares its text with the
   acknowledged text and applies that text if they differ. This restores an edit that a crossing
   snapshot rolled back while the host went on to accept it. In a table cell that still has
   focus the caret is placed at once, and the focus request the rollback left waiting for a
   render is dropped. During a source-editor composition nothing is applied: if a snapshot is
   waiting for the composition to end, the acknowledged text replaces it; a composition that
   began on rolled-back text is sent as it is, and the host rejects it.

Text is normalized to LF between the two sides (`normalizeDocumentText`) and mapped back to the
document's own line endings on apply (`mapNormalizedDocumentChangesToHost`), in one pass over the
text however many changes an edit carries: a replace all or many cursors send thousands.

Undo and Redo run in the host against the real document. CodeMirror's own history is installed
only so positions map correctly; it is not a second Undo stack.

## Tables

`src/shared/tableModel.ts` recognizes tables in the source. Each one is replaced in the editor by
a widget that draws real table DOM, including its row line numbers (decision A07). The source
lines stay in the document but are hidden and protected:

- A transaction that touches table source must carry an intent (`tableEditIntent` in
  `src/shared/tableSourceProtection.ts`): one cell, or a set of whole tables. The change is
  verified against the state it was computed from and dropped if it does not match.
- A change filter and a selection guard keep ordinary typing and the caret out of hidden table
  source. Cell edits go through annotated transactions written by
  `src/editor/table/tableSourceWrite.ts`.
- Refused edits raise an event the editor reports to the user; recent ones are kept for
  diagnostics and tests.
- Live Preview code asks the table model for protected ranges and leaves them alone.

Column widths are computed from the text (`src/shared/tableColumnSizing.ts`) on every layout
pass. While a typing resize delay is set, each edit typed into a cell holds the widths the table
has; the hold ends when typing pauses for the delay, or at once when the focused cell, the
table's shape or the width available to it changes (`src/editor/table/tableLayout.ts`). The
setting reaches the layout as a data attribute on the document element, like the clipboard modes.

## Pointer gestures and selection

CodeMirror owns a pointer selection that starts in its content. Two places adjust that:

- The line-number gutter is outside the content, so `src/editor/documentClipboard.ts` owns a
  gesture that starts there, with the drag model it uses for selections that cross tables: the
  selection begins at the text edge of the row under the pointer. Line numbers cannot be selected.
- A transaction filter in `src/editor/markdown/markdownRendering.ts` moves a pointer selection
  that would end inside a concealed task marker to the start of the task's text.

## Occurrence highlight

`src/editor/occurrenceHighlight.ts` highlights the word at the caret or the selected text. In
prose the matches are mark decorations. Inside table cells the DOM must not change under the
caret, so the fill is painted through the CSS Custom Highlight API and the border by one
positioned box per match in a layer over the table; that layer exists only while the theme draws
a border. Find paints its matches in cells the same way; the shared parts are in
`src/editor/cellHighlight.ts`. The query for a focused cell is read from the cell itself, and cells are repainted in a
microtask after the change that moved them, so the highlight is right in the frame the text
changes.

## Find and replace

Decision A28; behavior in section 11 of the [design spec](DESIGN_SPEC.md).

- `src/shared/findModel.ts` is pure. It compiles a query, finds matches in a string, plans the
  search domain of a document (prose segments between tables, then cells in row order), scans
  it in pieces that can pause, and plans a replacement: prose changes, and one edit per changed
  cell, each proved to keep its row's cells.
- `src/editor/find/findState.ts` keeps what was asked (query, options, replacement, whether the
  widget is open) in the editor state. What was found lives in the controller, tied to one
  exact document and one compiled query.
- `src/editor/find/findController.ts` is the view plugin. It searches while the widget is
  open, paints matches on the visible lines and in the mounted cells, moves the current match,
  and writes replacements. A replacement that touches prose and tables is two transactions
  dispatched as one editor update, so the edit path sees one change.
- `src/editor/find/findWidget.ts` is DOM only. The webview entry file mounts it in an element
  beside the editor's root, so the pointer and clipboard handlers bound to that root never see
  it. The Undo listeners there leave the widget's key presses to the widget and cancel the page's
  own Undo when it starts there; the widget keeps a history for each of its boxes.
- `src/editor/find/findReplace.ts` turns a replace plan into its transactions without a view,
  so what the table guard makes of them is unit tested.
- Keys are handled by a capture listener on the document, scoped to events from this editor or
  its widget. That is what lets a table cell, which CodeMirror does not hear, open find.

Nothing in `src/editor/find/` or `src/shared/findModel.ts` refers to VS Code (decision A30).
The host's part is two commands that post `findCommand`.

## Multiple cursors

Decision A29; behavior in section 12 of the [design spec](DESIGN_SPEC.md).

- `src/editor/multiCursor.ts` allows several selections and adds two keymaps. One, at the
  highest precedence, binds the arrow keys, Home, End, Backspace, Delete, Enter and Escape to
  CodeMirror's commands, and each binding declines unless several cursors exist; so with one
  cursor every existing key path is untouched. The other holds the commands that create
  cursors. The occurrence commands are planned by pure functions over the editor state, using
  the find model, and say how many matches lay in table cells.
- `tableSafeSelection` in `src/shared/tableSourceProtection.ts` is what the selection guard
  dispatches: among several cursors it removes any caret in table source; a lone caret is moved
  beside its table as before.
- `src/editor/documentClipboard.ts` branches at the top of copy, cut and paste when several
  selections exist and handles them as plain text; everything below those branches still reads
  one selection.
- Selection painting and the reveal rules already walked every range.

## Live Preview

The CodeMirror Markdown tree (GFM, frontmatter and wikilinks enabled) classifies the document;
there is no second parser. Inline styling uses marks, concealment uses replacement decorations
bound to source ranges, and anything that changes layout is provided by a state field. Reveal
depends on the caret, the selection, focus and composition, in the order the spec's section 3
gives. `markdownRendering.enabled` reconfigures the editor in place through a compartment.

## Paste

`src/editor/documentClipboard.ts` turns the clipboard into Markdown. Rich content is sanitized
and converted. Automatic paste first asks whether the plain text is the source of that content:
text a VS Code editor copied, preformatted text with colors, or Markdown beside its rendering.
The rule is pure and lives in `src/shared/clipboardPasteSource.ts`; the clipboard module only
counts the structure of the sanitized content for it. When the rule says yes, the plain text is
pasted unchanged.

## Code highlighting

Code blocks are colored with VS Code's own grammars and the active theme. The host collects
grammar and theme data (`src/highlighting/`) and hands it to the webview with the Oniguruma
WebAssembly binary from `dist/onig.wasm`; the webview tokenizes
(`src/editor/markdown/browserCodeHighlighting.ts`). The host can also tokenize on request. Nothing
is downloaded. Until that engine is ready, and whenever it is unavailable, the six CodeMirror
grammars bundled in `src/editor/markdown/markdownBlocks.ts` color the code instead.

## Build and package

- `npm run compile` type-checks with `tsc` into `dist/` (tests included), bundles the webview with
  esbuild as one IIFE script, bundles the host as CommonJS with `vscode` external, and copies the
  WebAssembly asset.
- The package holds ten files: the manifest, README, license, third-party notices, the host
  bundle and WebAssembly binary from `dist/`, and the four files in `media/`. `.vscodeignore`
  excludes everything and then lets exactly those back in, so a new file ships only when it is
  added there on purpose.
- `scripts/build-and-install.mjs` bumps the version, installs from the lockfile, packages,
  reinstalls into the local VS Code and then looks for a fixed list of marker strings in the
  installed files. Renaming one of those symbols or CSS classes means updating that list.
