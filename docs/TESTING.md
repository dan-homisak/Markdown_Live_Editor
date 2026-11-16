# Test plan

Updated: 2026-11-16. What is tested, by which suite, when each suite runs, and whether it passes
today. [AGENTS.md](../AGENTS.md) names the commands; this document says which ones a change
needs. Results of the last full run are in [PROGRESS](PROGRESS.md).

## Principles

- **Test at the lowest level that can show the behavior.** Logic that needs no editor goes in a
  unit test. Anything a person sees or does in the editor is proved in a real VS Code window.
- **A gate is a suite that passes, runs on every relevant change, and blocks when it fails.** A
  suite that fails today is listed below as not yet a gate, with what is wrong. It is never
  quietly skipped and never "fixed" by loosening it.
- **Fixtures are frozen and separate from working documents** (decision A21).
- **Red first.** For a defect or a defined behavior, see the test fail for the right reason
  before making it pass.
- **Evidence is what ran.** Report commands, counts and exit codes. A screenshot is evidence only
  after it has been opened and looked at.

## Tiers

| Tier | Command | Proves | Time | Gate |
| --- | --- | --- | --- | --- |
| Static | `npm run typecheck` | The code type-checks under strict TypeScript | seconds | Yes; `npm test` and every host script compile first |
| Unit | `npm test` | Pure logic: table model and edits, change validation, clipboard, links, rendering classification, lists, properties, highlighting, fixtures intact; then that the host bundle loads without `node_modules` and survives reordered lifecycle events | about 5 s | Yes |
| Host, core | `npm run test:host` | Stock-versus-live geometry within 0.5 px, then table editing, selection, clipboard, Undo and navigation regressions in a real window | about 35 s | Yes |
| Host, features | `npm run test:host:structure`, `npm run test:host:toggle`, `npm run test:host:sync`, `npm run test:host:surface`, `npm run test:host:find` | Table structure controls; switching editors keeps the viewport; a save that changes no text costs no input while typing; the editing surface around the text: gutter, menus, occurrence highlight, typing resize delay, task markers, automatic paste; find and replace | 10 to 60 s each | Yes |
| Host, code colors | `npm run test:host:highlighting` | Code colors match the stock editor | about 30 s | **Not yet**: times out on some runs, see [Suite status](#suite-status) |
| Host, Live Preview | `npm run test:host:rendering`, `npm run test:host:release` | Marker interactions; the rendering surface: properties, code, tables inside rendering, themes, links, scrolling | about 1 min each | Yes, since 2026-11-13 |
| Host, Live Preview interactions | `npm run test:host:preview` | Concealment and reveal, lists, links, properties, callouts | about 2 min | **Not yet**: every check passes, but the run reports a console warning, see [Suite status](#suite-status) |
| Repository | `npm run check:docs`, `npm run check:privacy`, `npm run test:agent` | Agent documents are consistent and name real commands and paths; nothing private would be committed; the hooks and checkers work | seconds | Yes |
| Install | `./Build_and_Install` | The package builds, installs, and the installed files contain what the build produced | about 15 s | Yes (decision A02) |
| Manual | none | OS input methods, screen readers, macOS | | Not automated; say so when a change touches input, focus or accessibility |
| Performance | benchmark scripts | Typing and scrolling cost on large documents | minutes | No. Last measured on version 0.1.174 |

`npm run test:all` runs every gate above except the install, in order, and stops at the first
failure. Run it before a commit and before anything is released.

## What a change needs

| Change | Run |
| --- | --- |
| Any TypeScript | `npm test` |
| Pure logic under `src/shared/`, parsers, planners | A failing unit test first in the matching file under `src/test/`; then `npm test` |
| The edit path, revisions, acknowledgements, Undo | `npm test`; `npm run test:host`; `npm run test:host:sync`; while iterating, `node scripts/edh-visual-check.mjs --global-undo-only` and `--editing-reliability-only` |
| Table rendering, layout, borders, gutter, line numbers | `npm run test:host` and both screenshots opened; for borders and strokes also `node scripts/edh-visual-check.mjs --device-scale=1.25`, `1.5` and `2` |
| Table editing, selection, clipboard, deletion, navigation | `npm run test:host`; `npm run test:host:structure` for row and column controls |
| Live Preview: concealment, reveal, lists, links, properties, callouts | Unit tests for the plan or classification; `npm run test:host` because preview changes have broken tables before; `npm run test:host:rendering` and `npm run test:host:release`; then `npm run test:host:preview`, where all 15 checks must pass and the only console entry allowed is the known warning in the status below |
| Selection painting | `node scripts/edh-visual-check.mjs --selection-rendering-only` (composited pixels); `node scripts/edh-selection-parity.mjs` and its screenshots; repeat with `--device-scale=1.5` |
| Code highlighting | `npm run test:host:highlighting`. A run that ends in "token colors timed out" is the known intermittent failure: run it again. A run that reports mismatches is a real failure |
| Switching between stock and live editors | `npm run test:host:toggle` |
| Themes, font size, zoom, narrow windows | `node scripts/edh-visual-check.mjs --theme=<name>`; `node scripts/edh-markdown-rendering-check.mjs` with `--light`, `--high-contrast`, `--zoom-one`, `--narrow` |
| Performance claims | Numbers from `scripts/benchmark-markdown-rendering.mjs` (CPU only) or the in-webview paint benchmark, with sample counts and cold or warm conditions. No claim without numbers |
| Dependencies and the bundle | `npm ci`; `npm test`; `node scripts/record-markdown-bundle-impact.mjs` |
| The occurrence highlight | `src/test/highlighting.test.ts`; `npm run test:host:surface` and its two occurrence screenshots opened; `node scripts/edh-visual-check.mjs --occurrence-highlight-only`; `npm run test:host:find`, because find paints cells with the same helpers |
| Multiple cursors, and anything that reads the selection | A failing case first in `src/test/multiCursor.test.ts` for the table source guard, the occurrence commands or how several selections are pasted; `npm run test:host:find`, whose later sections drive several cursors with real keys and the mouse; `npm run test:host`, because the guard and the clipboard are shared with tables; the selection checks in the row above when painting changes |
| Find and replace | A failing case first in `src/test/findModel.test.ts` for matching, the search domain or a replace plan, or in `src/test/findState.test.ts` for the query state and the counter; `npm run test:host:find` and its screenshots opened beside the stock widget's; for replace also `npm run test:host` and `npm run test:host:sync`, because it writes through the edit path and the table guard. Under another theme: `node scripts/edh-find-check.mjs "--theme=Default High Contrast"`. For a performance claim: `node scripts/edh-find-check.mjs --measure` |
| The line-number gutter, context menus, pointer placement beside task checkboxes, the typing resize delay | `npm run test:host:surface` |
| What Automatic paste takes, and how rich content converts | A failing case first in `src/test/clipboardPasteSource.test.ts` for the rule, or in the paste section of `scripts/edh-editing-surface-check.mjs` for the conversion; then `npm run test:host:surface` |
| Settings and the manifest | `npm test`; each state exercised in the host; README updated |
| What the package contains | `./Build_and_Install`, then the package listing checked against the allowlist in `.vscodeignore` |
| A fixture | The steps in `test/fixtures/README.md` |
| Agent documentation | `npm run check:docs` and `npm run check:privacy` |
| Hooks and checkers | `npm run test:agent`; the changed hook run by hand with sample JSON on stdin |
| Every change, last | `./Build_and_Install` (decision A02; Q02 asks whether documentation is exempt) |

## Suites

All host checks compile first when started through `npm run`, open their own VS Code window with
a temporary profile, and write screenshots and results to `qa/`, which is local and ignored.
They take the foreground while they run. Run one at a time.

| Script | What it checks | Status 2026-11-13 |
| --- | --- | --- |
| `scripts/edh-visual-check.mjs` | Stock Monaco against the live editor in one window, with a 0.5 px gate, then 69 named regressions over tables, clipboard, selection, Undo and navigation. Focused runs: `--border-only`, `--table-integrity-only`, `--table-deletion-only`, `--keyboard-navigation-only`, `--arrow-navigation-only`, `--mixed-input-only`, `--editing-reliability-only`, `--global-undo-only`, `--gutter-scroll-only`, `--selection-rendering-only`, `--selection-stroke-only`, `--selection-highlight-only`, `--selection-wrapping-only`, `--occurrence-highlight-only`, `--line-highlight-only`, `--table-line-break-scroll-only` | Passes |
| `scripts/edh-code-highlighting-check.mjs` | Rendered token styles in stock and live across themes and nine languages | **Intermittent**, see below |
| `scripts/edh-structure-controls-check.mjs` | The proximity-driven table structure controls and their menus | Passes |
| `scripts/edh-toggle-check.mjs` | Viewport handoff when switching editors; `--crlf` for CRLF documents | Passes |
| `scripts/edh-save-sync-check.mjs` | A save that changes no text sends no document snapshot; an acknowledgement restores an edit that a crossing snapshot rolled back, with the caret after it: one edit, two edits, during a simulated composition, and in a table cell with a key pressed at the answer; 300 edits typed through saves that reach the disk are all kept and none is rejected. The check delivers the crossing snapshot to the webview itself, and its settings turn off everything that changes text on save. `--crlf` for CRLF documents | Passes |
| `scripts/edh-editing-surface-check.mjs` | Seven sections in one window, all run and reported together. Line numbers cannot be selected, and a click, a drag and a Shift+click in the gutter select document text. A context menu in the state that draws a focus ring draws none; the check forces that state. The word at the caret of a table cell is highlighted in every frame while typing. An occurrence in a cell has the fill, the height and the border of one in prose, in computed styles and in composited pixels with the ink hidden, under a theme color no stock theme has. With the real setting changed, columns keep their widths while typing, resize after the pause, and resize at once when another cell takes the caret. A click at every point between a checkbox and its text puts the caret at the task's text; the keyboard still reveals the marker; no check letter and no hidden match is highlighted. Automatic paste, through paste events the check builds: code-editor and Markdown-editor text arrive as copied, a web page converts with `#` headings and tight list markers, a web code block is still fenced and plain words still escaped | Passes |
| `scripts/edh-find-check.mjs` | Twenty-two sections in one window, all run and reported together; each restores the document, so one failure cannot fail the next. The key opens the widget with the word at the caret, from prose and from a table cell. Twelve matches are counted and visited in document order through prose and cells. A match in a hidden link address reveals the link, one in a folded callout shows the folded text, and one in a table that was off screen is scrolled into view and painted current. Escape gives the caret to the current match, in the editor or in its cell. A typed query keeps the focus in the find box and moves to the first match. Match case, whole word, a regular expression and an invalid pattern. Finding never marks the document edited. With text typed into the document first, Undo and Redo in the find box step through what was typed in the box, and Undo pressed there eight more times leaves the document as it was. An Enter marked as part of a composition replaces nothing. The widget's buttons work by mouse and leave the caret in the find box. The Replace command and its key. Replace one in prose and in a cell, each undone by one Undo; a replacement with a pipe is written into a cell as an entity. Replace all across prose and two tables reaches the host as one edit and is undone by one Undo, with no table edit refused and no conflict reported. Nothing is replaced in a read-only document. Multiple cursors: two uses of Add Cursor Below give three drawn cursors, what they type is one Undo step, and Backspace, an arrow key, Shift+End and Escape act on all of them; Add Cursor Below steps over a table, the typed letter arrives at all six cursors, and a caret put into table source among several cursors is removed by the guard; Add Cursor Above; Ctrl+Shift+L by key; F3 leaves a cell that is composing alone; cut with several selections; Ctrl+D selects the word and then adds occurrences; Alt+Enter in the find box selects the eight matches in prose and reports the four in cells, and typing replaces only those eight; Change All Occurrences selects a word sixty times; three selections are copied one to a line and three pasted lines go one to each; Alt+click adds a cursor, Ctrl+click does not, and Shift+Alt+drag selects a column. It also saves the stock editor's widget for comparison. `--theme=<name>` runs under another theme; `--crlf` writes the document with CRLF line endings; `--measure` adds timings: a replace all of ten thousand matches through the real host, then searching and typing on generated documents of 10,000 and 100,000 lines with the host isolated | Passes |
| `scripts/edh-selection-parity.mjs` | Captures stock and live selection screenshots side by side, made with trusted mouse input. It asserts nothing: the screenshots are the result | Runs |
| `scripts/edh-markdown-release-check.mjs --live-preview-only` | Live Preview interactions. Add `--case=<part of a check name>` to run one check | Checks pass; console warning, see below |
| `scripts/edh-markdown-release-check.mjs` | The whole rendering surface. Focused runs: `--properties-only`, `--code-only`, `--lists-only`, `--scroll-only`, `--fence-navigation-only`, `--interaction-bugs-only`, `--paint-only` | Passes |
| `scripts/edh-markdown-rendering-check.mjs` | Marker interactions. Focused runs: `--geometry-only`, `--mixed-only`, `--lifecycle-only` | Passes |
| `scripts/render-live-editor-harness.mjs` | The standalone browser harness (`npm run harness`). Obvious regressions only; never evidence of parity | Not a test |
| `scripts/check-extension-bundle.mjs` | The host bundle loads with only `vscode` and Node built-ins | Passes, in `npm test` |
| `scripts/check-markdown-host-lifecycle.mjs` | Provider callbacks under reordered permission queries, and no document snapshot for a change event without content changes, without a VS Code process | Passes, in `npm test` |
| `scripts/record-markdown-bundle-impact.mjs` | Inventories what esbuild bundled, preserves license notices, records sizes locally | Tool |
| `scripts/benchmark-markdown-rendering.mjs`, `scripts/benchmark-markdown-release.mjs` | CPU cost of classification, without an editor | Not run since 0.1.174 |

`scripts/edh-isolation.mjs` holds what every host check shares. It finds the VS Code executable:
`MLRT_CODE_BIN` if set, then a copy under `.vscode-test/isolated-code`, then the standard install
locations, and it turns updates off so a test window never starts an installer.
`MLRT_EDH_SOFTWARE_RENDERING=1` runs the visual check without the GPU.

## Suite status

Recorded on 2026-11-13 on Windows.

| Suite | Status | Evidence |
| --- | --- | --- |
| Visual check | Gate. Passes | Every run that day |
| Structure controls | Gate. Passes | Every run |
| Toggle | Gate. Passes | Every run with the committed launch settings |
| Save and typing | Gate since 2026-11-13. Passes | Failed on the unfixed build, first on the snapshot a save sent, then on the edit left rolled back; the composition and table cell cases, added after a review, each failed before their fix. Passes since, also with `--crlf` |
| Editing surface | Gate since 2026-11-13. Passes, 7 of 7 sections | All seven sections failed on the build without the corrections, each on the defect it covers; they pass with them |
| Find and replace, multiple cursors | Gate since 2026-11-15. Passes, 22 of 22 sections since the review of 2026-11-16, also with `--crlf`. The sections added for the review failed on the build before its fixes: Undo in the find box, the composing Enter, and the host's answer to a large replace all, which took 4.5 s | Written with the features. The thirteen find sections passed three consecutive runs, one under the high-contrast theme; all twenty passed six runs, two of them inside `npm run test:all` and two under the light theme |
| Rendering check | Gate since 2026-11-13. Passes, 25 of 25 | Three consecutive runs after the repair |
| Release check, whole surface | Gate since 2026-11-13. Passes, 17 of 17 | Three consecutive runs after the repair |
| Release check, Live Preview only | Not a gate. All 15 checks pass, but the run exits 1 | It reports one console warning from the editor (question Q10) |
| Code highlighting | Not a gate. Intermittent | Passed 4 of 6 runs; the others timed out. The same on the last commit: 4 of 5 |

### What was repaired on 2026-11-13

Before the repair the three Live Preview suites failed, on the last commit as well: 24 of 25,
16 of 20, and between 7 and 10 of 16. Under decision A24:

- **An editor defect was fixed.** Tab on a list item that is its parent's first child adds
  indentation; Shift+Tab then moved the item to its parent's level instead of undoing the Tab.
  Shift+Tab now removes indentation beyond the parent's content column first. Unit tests cover
  bullets, numbers, quotes and tasks. This was the root failure of the preview-only run.
- **A failed check no longer fails the checks after it.** The release check reverts the document
  to its saved state after a failure. Three checks used to time out for that reason alone.
- **Two expectations were out of date and were corrected**, each traced to a deliberate later
  change: the code-block language control is one pixel smaller than the code, and a bullet or
  rule keeps its text in place when its source is revealed. A third now states its intent
  directly: no block or preview decoration may appear inside a table, while cells keep their own
  inline formatting.

### Removed checks

Three checks were removed from the whole-surface release check, not repaired:

- quote guides and alert labels occupy source rows;
- code token foreground wins over identical-range source wrappers;
- nested quote and alert code retain guides without horizontal borders.

Each asserted how the stylesheet drew something: the text of a `box-shadow` value, or one exact
color. The stylesheet has since been rewritten to draw quote guides with background gradients
and to restyle properties, so the checks failed while the editor looked right. A check like
that cannot tell a regression from a refactoring. What they were meant to protect, visible
guides and correct colors, should be measured in pixels; that is proposal P10. Until then, quote
guides and callout accents are covered by screenshots a person looks at, not by an assertion.

### Still open

- **Question Q10.** Rendering the constructs fixture logs CodeMirror's "Measure loop restarted
  more than 5 times" once. It needs the fixture's Tables section, and the larger sample document
  does not trigger it. The preview-only run fails on any console warning, which is the right
  policy, so that run stays out of the gates until the cause is found.
- **One unexplained failure of the visual check.** On 2026-11-16 its reverse drag from the
  text up across a table selected six cells where fifteen are expected, in one run of four on
  the same tree; the other three passed. It has not been run on the tree before find and
  multiple cursors were added, so it is not known whether that work made it possible.
- **Intermittent timeouts.** The code-highlighting check sometimes times out waiting for the
  live webview or for token colors; when it does not, every language in every theme matches with
  zero mismatches. Before the repair, several Live Preview checks also failed on some runs only.
  The cause is not established. One guess was tested and rejected: turning off background
  throttling and Command Palette closing in the shared launch settings did not stop the timeouts
  and made the toggle check fail, so it was reverted.

## Fixtures and samples

| Folder | Purpose | Rule |
| --- | --- | --- |
| `test/fixtures/` | Documents written only to be test input | Purpose-built and frozen (decision A23). Each fixture has case identifiers and a stated contract; `src/test/fixtures.test.ts` asserts the contract and compares every file with its hash in `test/fixtures/manifest.json`. Change one only together with the tests that depend on it, then run `npm run fixtures:manifest`. The stress document is generated: `npm run fixtures:gutter` |
| `samples/` | Documents to open and edit while trying the editor by hand | Free to change at any time. They are never test input: the fixtures test fails if a test or script refers to this folder |

The four fixtures and what reads each are listed in `test/fixtures/README.md`. Checks find their
input by case identifier or section heading, never by line number.

Host checks never open a fixture in place. They copy its text into a document in a temporary
profile, so a check that edits its document cannot damage the fixture.

## Unit tests

Plain Node scripts under `src/test/`, one file per area, compiled to `dist/test/` and run by
Node's test runner, which reports each file as passed or failed and continues after a failure.
A file fails when any top-level assertion throws.

| Area | Files |
| --- | --- |
| Table model, structure edits, column sizing, manifest and source contracts | `src/test/smoke.test.ts` |
| Table parsing, editing and integrity | `src/test/tableParserReliability.test.ts`, `src/test/tableEditingReliability.test.ts` (10,000-operation fuzz, deletion, mixed selections), `src/test/tableIntegrity.test.ts`, `src/test/tableCellInput.test.ts`, `src/test/sourceProtection.test.ts` |
| Table keyboard navigation | `src/test/tableKeyboardNavigation.test.ts` |
| Host edit validation and history | `src/test/documentChangeValidation.test.ts`, `src/test/historyAvailability.test.ts` |
| Clipboard, paste escaping and what Automatic paste takes | `src/test/clipboard.test.ts`, `src/test/markdownEscape.test.ts`, `src/test/clipboardPasteSource.test.ts` |
| The typing resize delay | `src/test/tableResizeDelay.test.ts` |
| Selection state, painting and occurrence highlight | `src/test/selection.test.ts`, `src/test/highlighting.test.ts`, `src/test/markdownSelectionWrapping.test.ts` |
| Find and replace: matching, the search domain, scans that pause, replace plans; the query state and the match counter | `src/test/findModel.test.ts`, `src/test/findState.test.ts` |
| Multiple cursors: the table source guard with several cursors, typing as one transaction, the occurrence commands, copy and paste | `src/test/multiCursor.test.ts` |
| The transactions of a replace, judged by the table guard: one cell, several cells, prose with tables, insertions beside a table, tables at the ends of a document, a refused or stale plan; the find widget's own Undo history | `src/test/findReplace.test.ts` |
| Mapping an edit's changes to lines and columns for the host, also with CRLF, and that 20,000 changes do not cost one pass over the text each | `src/test/documentChangeMapping.test.ts` |
| Live Preview classification and plans | `src/test/markdownRendering.test.ts`, `src/test/markdownPresentation.test.ts`, `src/test/markdownBlocks.test.ts`, `src/test/markdownLivePreview.test.ts`, `src/test/markdownConstructs.test.ts` |
| Lists, properties, links | `src/test/markdownListStructure.test.ts`, `src/test/markdownProperties.test.ts`, `src/test/markdownLinks.test.ts` |
| Code highlighting | `src/test/codeHighlighting.test.ts` |
| Fixtures | `src/test/gutterFixture.test.ts` (the stress document keeps its promised shape), `src/test/fixtures.test.ts` (hashes, each fixture's contract, and no reference to the samples) |

Adding a test: put it in the file for its area, or add `src/test/<area>.test.ts`; any file
named `*.test.ts` there is picked up automatically. Read fixtures from `test/fixtures/` by a path
built from `__dirname`, never from the working directory and never from `samples/`.

## Writing a host check

Follow "Writing or changing a host check" in [ENGINEERING](ENGINEERING.md#visual-parity). In
short: measure in the real window, measure pixels when the question is what a person sees,
restore the document even when an assertion fails, and do not depend on the window keeping
focus.

## Known gaps

- The preview-only host run is not a gate until the console warning is explained (Q10).
- Quote guides, callout accents and code token precedence have no assertion in the real editor
  since three stylesheet-bound checks were removed (P10).
- Some host checks time out intermittently; the cause is unknown.
- No CI: every gate runs only when someone runs it (Q05).
- No linter (Q06).
- macOS has no recorded host run (Q07).
- OS input methods and screen readers are covered only by synthetic checks.
- The paste cases use rich content written for the check, in the shapes a VS Code editor, a
  bare preformatted block and a Markdown editor's rendering take. What the real applications
  put on the clipboard has not been captured.
- An editor that stays blank after its window was minimized is not reproduced, so nothing
  checks it. The fallback that shows the editor when its first frame never comes has no check
  either. See known gaps in [PROGRESS](PROGRESS.md).
- A host check's window takes whatever is typed on the keyboard while it has the foreground.
  Stray characters reached a check's document once without failing it; a run that fails on
  unexpected text should be repeated before it is believed.
- The find check sets a document read-only by sending the webview the option the host would
  send, not by opening a file the system reports as read-only.
- Find has no check with a real input method, and none on macOS, whose keys differ. Composition
  is stood in for by a key press marked as composing and by a cell marked as composing.
- A key press a host check sends does not run the browser's own editing commands. Whether the
  page's Undo, run from the find box, would reach text typed into the document was therefore
  not reproduced; the widget cancels that key and keeps its own history instead.
- Nothing checks that a match found by a search that outlasted its first slice leaves the caret
  alone once the query has changed or the document has been edited. The rule is in the code
  only: it needs a search slow enough to be interrupted.
- Text composition with several cursors is not checked. The multiple-cursor clipboard sections
  build their own copy and paste events; the system clipboard is not involved.
- Large-document performance has not been measured since version 0.1.174; the spec's targets
  are unverified for the current design.
- Unit tests report per file, not per assertion: a failing file names its first failed
  assertion only.

## Recording results

At a milestone, record commands, counts, exit codes, the date and the extension version in
[PROGRESS](PROGRESS.md), and update the status table above when a suite's status changes. An
investigation worth keeping becomes a dated report in `docs/reports/`. Raw logs, screenshots and
result files stay in `qa/`: they are local and are never committed.
