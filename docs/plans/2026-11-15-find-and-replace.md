# Find, replace and multiple cursors in the live editor

Status: complete. Owner approval: A28, A29, A30.

## Outcome and acceptance

- `Ctrl+F` and `Ctrl+H` open a find and replace widget that looks and behaves like the stock
  editor's: match case, whole word, regular expression, a match count, next and previous,
  replace and replace all. Documented in the README and the design spec when each slice lands.
- Find covers the whole Markdown source, table cells included. Every replacement goes through
  the existing edit path, and each action is one Undo step.
- The stock editor's multiple cursors work in prose: add the next occurrence, select all
  occurrences, change all occurrences, cursors above and below, mouse cursors and column
  selection.

## Decisions and open questions

- A28: find is local and exact, searches the source, and adds no dependency.
- A29: multiple cursors live in prose; occurrences in table cells are reported, and Replace All
  changes them.
- A30: new editor code stays independent of the VS Code host, because the editor is to be
  reusable outside VS Code. The larger extraction is P11 and is not part of this plan.
- Not selected: an external search server, and `@codemirror/search`; reasons in DECISIONS.
- Not in this plan: find in selection, preserve case, search history, scrollbar marks, the
  `editor.find.*` settings, undoing the last cursor.

## Affected surfaces

- **Shared, new:** `src/shared/findModel.ts`. Compiles a query to one regular expression, finds
  matches in a string with a limit, expands a replacement, plans the search domain from a
  document and its parsed tables (prose segments, then cells in row order), and plans a
  replace: prose changes, and per-cell values checked to keep each row's cell count.
- **Webview, new:** `src/editor/find/`: a state field, a highlight plugin modelled on the
  occurrence highlight, the commands, and the widget. The cell-painting helpers of the
  occurrence highlight move to a module both plugins share. The widget is an overlay mounted in
  an element the entry file passes in, outside the element the editor's pointer and clipboard
  handlers are bound to. Icons are inline SVG; the security policy is untouched.
- **Webview entry:** key handling, a relay for the host command, and the Undo listeners skip
  events from the widget.
- **Host:** Find and Replace commands for the Command Palette, posting one message. No default
  keybindings and no settings.
- **Tables:** one cell is replaced as a `cell` intent; replace all in tables uses the `tables`
  intent. A replace all across prose and tables is two transactions in one editor update, so it
  is one change message and one Undo step. The table change filter, the intent rules and the
  host's change validation are not modified.
- **Selection, for multiple cursors:** selection painting, copy, cut and paste, the pointer
  gestures of the document clipboard, table boundary arrows, and the table source selection
  guard, which must keep every caret out of table source.
- **Styles:** `--mlrt-find-*` tokens defaulting to the stock find colors.
- **Package, fixtures, settings:** none.

Rules for the new code (A30): no VS Code API and no import from the webview entry file; entry
points are exported functions; highlight names are scoped to the editor instance.

## Test cases

- Unit, `src/test/findModel.test.ts`, written failing first: literal, case, whole word, regex,
  invalid regex, empty and multi-line matches, the limit, replacement expansion, segmentation
  around tables, cell values with `<br>` and escaped pipes, a replacement containing a pipe or a
  line break keeping the row's cell count, LF and CRLF.
- Host, new `scripts/edh-find-check.mjs` as `npm run test:host:find`, added to `test:all`: the
  key opens the widget from prose and from a cell; count and order across prose and cells; a
  match in hidden syntax is revealed; a match in a folded callout; a table off screen; Undo in
  the find box leaves the document alone; replace one in prose and in a cell; replace all
  across prose and two tables is undone by one Undo and blocks no table edit; no edit on a
  read-only document; finding never marks the document edited. For multiple cursors: typing at
  three cursors is one Undo step; no caret lands in table source; copy and paste with several
  ranges; every range is painted.
- Screenshots beside the stock editor in dark, light and high-contrast themes, opened and
  compared.
- Measured: scan time and added typing cost with the widget open at 10,000 and 100,000 lines.

## Steps

1. The pure model with its unit tests.
2. Find in prose: widget, keys, commands, highlights, count, next and previous.
3. Find in table cells, including tables that are off screen.
4. Replace and replace all in prose.
5. Replace in cells, then replace all across prose and tables.
6. Multiple selections with painting, the guard and the clipboard, reachable by the cursor
   above and below commands.
7. The three occurrence commands.
8. Mouse cursors and column selection, held back if they fight the editor's own drag handling.

Each step is tested and installed before the next. The documents change with the step that
changes behavior.

## Risks

- **Table source.** A replace that changed a row's cell count would corrupt a table. The planner
  checks the count, the `cell` intent checks it again, and a refused edit refreshes the table.
- **One Undo step for a mixed replace all.** If the two-transaction update does not reach the
  host as one change, the work stops for a decision; the filter is not widened.
- **Multiple selections reach code written for one.** Step 6 starts with a review of every use
  of the main selection and turns the feature on only when the selection, clipboard and table
  gates pass.
- **Slow patterns.** A pathological regular expression can block one scan, as in the stock
  editor.
- **Not covered by automation:** input methods in the find box and with several cursors, screen
  readers, macOS keys.

## Evidence so far

- 2026-11-15: plan accepted, and all eight steps carried out the same day. Results and what
  was not exercised are in milestone 7 of [PROGRESS](../PROGRESS.md). Two things differ from
  the plan as written. The editor code is `findState.ts`, `findController.ts`,
  `findWidget.ts` and `find.ts` under `src/editor/find/`, with multiple cursors in
  `src/editor/multiCursor.ts`. And a table does not stop the cursor above and below
  commands: they step over it.
- 2026-11-16: reviewed, and the findings fixed: the Review section of milestone 7. Three
  statements above are corrected by it. The widget does not hand Undo to the page; it keeps a
  history for each of its boxes. The unit cases cover a CRLF query; documents are LF inside
  the editor, and a CRLF document is covered by the host check's `--crlf` run. And for
  several cells the planner's row check is the only check of a row's cell count: the guard
  checks the count for one cell, and containment for several.
