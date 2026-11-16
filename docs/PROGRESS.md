# Progress and handoff

Updated: 2026-11-16.

## Actual repository state

- Git: branch `main`, the only branch, with a remote. Milestones 1 to 7 below are committed;
  milestone 7 is not pushed. The history was rewritten on 2026-11-13 (milestone 4), so every
  commit hash cited in these documents is the one in use after that rewrite.
- Product source differs from 047e615 in four places: the list-nesting fix of milestone 3, the
  save race fix of milestone 5, the corrections of milestone 6, and find, replace and multiple
  cursors in milestone 7. The extension version is a build counter: `Build_and_Install` raises
  it on every run. The installed version is 0.1.241.
- Layout: source and unit tests in `src/`, shipped assets in `media/`, scripts in `scripts/`,
  frozen fixtures in `test/fixtures/`, hand-testing documents in `samples/`, all project
  documents under `docs/`, agent tooling in `.claude/`. `qa/` and `dist/` are local output.
- Gates that pass: unit tests; the visual, structure-control, toggle, save-and-typing,
  editing-surface, find, rendering and whole-surface release host checks; the documentation and privacy checks; the agent tooling
  tests; and the install. Two host runs are not gates: the preview-only run, which reports a
  console warning, and the code-highlighting check, which times out on some runs. See
  [TESTING](TESTING.md).
- There is no lint configuration and no CI.
- Checked with Node.js 24, npm 11 and VS Code 1.146 on Windows.

## Milestone 1: agent framework (2026-11-13)

Decision A17. Added AGENTS.md in its current shape, CLAUDE.md, the documents under `docs/`,
four skills, a read-only reviewer subagent, session-continuity and Stop hooks with tests, and a
documentation checker that also fails when a document names an npm script or a repository path
that does not exist. Accepted decisions A01-A16 were reconstructed from the repository record and
are labeled as unconfirmed. What was adopted and what was left out is in [RESEARCH](RESEARCH.md).

Baseline of the unchanged product before any of it, at version 0.1.228: `npm run compile` exit 0
with a clean tree afterwards; the visual host check exit 0 with both screenshots opened; the unit
tests exit 0.

## Milestone 2: privacy rules and cleanup (2026-11-13)

Decisions A18-A22.

**Privacy (A18, A19)**

- AGENTS.md has a "Public repository" section: no messages, nothing about how the work is done,
  no personal identifiers, no raw run output.
- Journals no longer carry quotations, times of day or session identifiers. The link between a
  session and its journal moved into local hook state. The documentation checker enforces the
  journal rules and rejects email addresses in agent documents.
- New `scripts/check-privacy.mjs` scans everything git would commit for home-directory paths and
  for names in a local, ignored list. The Stop hook runs it every turn.
- 128 raw logs, result files and screenshots under `qa/` left version control; the files remain
  on disk and `qa/` is ignored. The seven dated reports moved to `docs/reports/` with one local
  path removed, wording about requests made neutral, and links to files that no longer exist
  turned into plain names.

**Layout and packaging (A20, A21)**

- Test inputs moved to `test/fixtures/` behind a hash manifest and a unit test that fails when a
  fixture changes. The documents for hand-testing moved to `samples/`. Three of the seven
  Markdown documents that were at the repository root were never read by a test.
- The design spec moved to `docs/DESIGN_SPEC.md`. A tracked crash-reporter log was removed.
- The package is built from an allowlist and went from 222 files to 10. It no longer carries a
  680 KB fixture, the spec, a build launcher, 48 compiled tests or 104 source maps.
- The manifest gained a public description, repository, issue and homepage links and keywords.
  `undici`, which every host check imports, is now a declared development dependency.
- An editor recommendation for a linter the project does not use was removed. Stale script
  headers were corrected.

**Testing (A21)**

- [TESTING](TESTING.md) is the test plan: tiers, what each kind of change must run, every suite
  with its status, fixture rules and known gaps.
- `npm test` now runs the unit tests through Node's test runner, which reports every file and
  continues after a failure, then the two bundle checks. The informal `qa:*` scripts were
  replaced by named tiers: `test:host` and five focused host commands, and `test:all`.
- Every host suite was run. Three Live Preview suites fail, and the code-highlighting check
  times out intermittently; all of it also happens on an untouched copy of the last commit, so
  it predates this work. The failures are recorded check by check in TESTING, with two behaviors
  to settle (Q09) and the repair proposed as P07.
- One attempt to stop the intermittent timeouts, by changing the shared launch settings of the
  host checks, made the toggle check fail and was reverted. That file is unchanged.

**Documents (A20, A22)**

- The README was rewritten for the public, with a screenshot cropped to document content.
- The spec was reconciled with the shipped editor: heading markers, properties, fence rows,
  code highlighting, footnotes and generated contents; a duplicated paragraph was removed.
  Shipped behavior was established from the code and from host screenshots, not from the older
  documents.

### Verification

All on 2026-11-13, on Windows, from the repository root, on the final tree.

- `npm run test:all`: **passed**, exit 0 in 66 seconds. In order: 25 of 25 unit test files and
  both bundle checks; the documentation check (26 agent documents and the README, 88 relative
  links, 185 repository paths, 58 npm script references, 22 accepted, 9 proposed and 9 open
  entries with 162 references); the privacy check (207 text files, a local list of 3 names);
  42 of 42 agent tooling tests; the visual host check (69 named check sections, none failing,
  table borders checked on 19 cells and 7 gutters); the structure-controls check; the toggle
  check.
- `./Build_and_Install`: **passed**, exit 0 in 13 seconds, 0.1.229 to 0.1.230, and the installed
  version was verified as 0.1.230.
- Package contents: 10 files, 855 KB, where it had been 222 files and 1.7 MB: the manifest,
  README, license, notices, `dist/extension.js`, `dist/onig.wasm` and the four files in `media/`.
- Hooks: the tool and prompt hooks were seen firing in a live session, and the tool hook linked
  the session to its journal in local state; the compaction hook, run by hand on a real
  transcript, reproduced only genuine messages.

Gate suites across the day, with the committed launch settings and the same product source:

| Suite | Runs |
| --- | --- |
| Visual check | Passed 4 of 4 |
| Structure controls | Passed 2 of 2 |
| Toggle | Passed 5 of 5 |

Suites that are not gates:

| Suite | Current tree | Untouched copy of the last commit |
| --- | --- | --- |
| Code highlighting | Passed 4 of 6 runs; the others timed out | Passed 4 of 5 runs |
| Rendering check | 23 of 25 checks | 24 of 25 checks |
| Release check, whole surface | 16 of 20 checks | 16 of 20 checks |
| Release check, Live Preview only | 7 of 16 checks, then 8 of 16 | 10 of 16 checks |

Not run: the benchmarks, the selection-rendering and device-scale variants of the visual check,
and anything on macOS. The installed build was not exercised by hand in a reloaded window.

## Milestone 3: purpose-built fixtures and repaired suites (2026-11-13)

Decisions A23 and A24. This milestone changed product code; the two before it did not.

**Fixtures (A23)**

- `test/fixtures/` now holds four documents written only as test input: `markdown-constructs.md`
  (70 cases, one section per construct), `code-languages.md` (nine fenced blocks),
  `table-cells.md` (cell content, tall and wrapping rows, table shapes) and the generated
  `gutter-stress.md`. Each has case identifiers and a stated contract.
- The sample documents that had been copied in as fixtures went back to `samples/`. A unit test
  asserts each fixture's contract and fails if any test or script refers to the samples folder.
- Checks find their input by identifier. The visual check derives its two navigation rows from
  `TC-NAV-01` and `TC-NAV-02` instead of fixed line numbers.

**Editor defect fixed (A24)**

- Tab on a list item that is its parent's first child, followed by Shift+Tab, left the item at
  its parent's level. Shift+Tab now removes indentation beyond the parent's content column
  before it unnests (`src/editor/markdown/markdownListEditing.ts`). A failing unit test came
  first; it covers bullets, numbers, quotes and tasks.

**Tests repaired, replaced or removed (A24)**

- Two host expectations that a later, deliberate change had made wrong were corrected; one was
  rewritten to state its intent; three that asserted stylesheet internals were removed. Reasons
  for each are in [TESTING](TESTING.md) under "What was repaired" and "Removed checks".
- The release check reverts its document after a failed check, so one failure no longer fails
  the checks that follow.
- The installer no longer looks for a list of 29 marker strings in the installed files. It
  compares every installed runtime file with the build, byte for byte.
- `npm test` deletes old compiled tests before compiling. A renamed test had kept running from
  its stale output.
- The rendering check and the whole-surface release check pass and joined `npm run test:all`.

**Found, not fixed**

- Rendering the constructs fixture logs a CodeMirror measure-loop warning that the old sample
  document never triggered. It needs the fixture's small tables. Recorded as Q10 with what was
  ruled out.

### Verification

All on 2026-11-13, on Windows, on the final tree of this milestone.

- `npm run test:all`: **passed**, exit 0 in 153 seconds. In order: 25 of 25 unit test files and
  both bundle checks; the documentation check; the privacy check; 42 of 42 agent tooling tests;
  the visual host check with no failing section; structure controls; toggle; the rendering
  check, 25 of 25; the whole-surface release check, 17 of 17.
- Before that run, the rendering check passed three times in a row and the whole-surface
  release check twice.
- `npm run test:host:preview`: 15 of 15 checks passed, twice; the run exits 1 because of the
  console warning in Q10.
- The list fix was red before the change (the round-trip assertion failed with the item at its
  parent's level) and green after it.
- `./Build_and_Install`: **passed**, exit 0 in 13 seconds, 0.1.230 to 0.1.231, verified by the
  new byte comparison. The package still holds 10 files.

Not run: the code-highlighting check on the final tree (it is intermittent and not a gate; its
fixture changed, and it has not been run against the new one), the benchmarks, the
selection-rendering and device-scale variants of the visual check, and anything on macOS. The
installed build was not exercised by hand in a reloaded window.

## Milestone 4: history cleanup (2026-11-13)

Decision A25.

- The work of milestones 1 to 3 was committed to `main` in two commits: the list fix, then the
  restructuring.
- `qa/` and `debug.log` were then removed from every commit with git's own filter. 109 of 110
  commits remain; the one that touched only those paths became empty and was dropped. No commit
  touches the removed paths, and the tree at the tip is identical to what it was before.
- A search of every file in every remaining commit finds no home-directory path.
- Every commit hash changed. The five hashes cited in these documents were updated; a hash
  quoted anywhere else from before 2026-11-13 no longer exists.
- A bundle of the complete earlier history was saved outside the repository before the rewrite.
- The rewritten `main` replaced the remote branch by a forced push, made with the commit that
  records this milestone.
- The dated reports in `docs/reports/` were kept.

Limits of the cleanup:

- The hosting service keeps a reference for one old pull request. It still reaches 69 commits
  of the earlier history, the newest from 2026-08-12. Every file in those commits was searched:
  none contains a home-directory path. Three early QA files are among them.
- Copies made before the rewrite, such as clones, forks and caches, are not changed by it.

### Verification

- A rehearsal on a throwaway clone first, then the real rewrite: the filter exited 0 in 29
  seconds both times.
- After the rewrite: `git log main -- qa debug.log` lists nothing; the diff between the old and
  new tip is empty; the working tree was clean; the local files under `qa/` are still on disk.
- `npm run check:docs`, `npm run check:privacy`, `npm run test:agent` and `npm test` passed on
  the rewritten tree, and `./Build_and_Install` installed 0.1.233.

## Milestone 5: reliability audit and the save race (2026-11-13)

Decision A24. An audit of version 0.1.233 found four defects; the
[reliability audit](reports/reliability-audit-2026-11-13.md) has the mechanisms and the
measurements. The first is fixed here. The other three, and one more found while the fix was
reviewed, are under known gaps.

**The defect.** Every save made the host send the whole document to the webview twice, with
unchanged text. A snapshot that crossed an edit on its way rolled that edit back in the editor;
the host then accepted the edit, the two sides disagreed, and the next keystroke was rejected
and lost with the conflict warning.

**The fix.**

- The host sends a snapshot only for a change event that carries content changes
  (`src/extension.ts`). A save that changes no text sends nothing.
- When an acknowledgement leaves no edit unanswered and the editor does not hold the
  acknowledged text, the webview applies it (`src/webview/liveEditor.ts`). This covers the
  snapshots that remain, such as a document that changes away and back while an edit is on its
  way.
- Validation, the queue, acknowledgements and rejections are unchanged.

**Review.** The reviewer subagent read the change and found no blocker. It reported two places
where the webview step fell short, and both were reproduced in the real window and fixed:

- A crossing snapshot that arrived during a source-editor composition waited for the
  composition to end and was then applied over the acknowledged text, so the edit stayed
  rolled back and the next keystroke was rejected. The acknowledged text now replaces the
  waiting snapshot.
- In a table cell the restored text came back with the caret one position early until two
  frames later. The caret is now placed with the restore, and the focus requests left waiting
  for a render are dropped, so a key pressed at once lands in order.

**Tests.** Written first and seen failing on the unfixed build:

- `scripts/check-markdown-host-lifecycle.mjs` asserts that an event without content changes
  sends no snapshot. It failed with two snapshots where one was expected.
- `scripts/edh-save-sync-check.mjs`, new, `npm run test:host:sync`, in `npm run test:all`. In a
  real window it failed first on the two snapshots a save sent; with only the host fixed it
  failed on the edit left rolled back, whose next keystroke was rejected.
- After the review the same check gained four cases: two unanswered edits, which passed
  unchanged; a simulated composition, which failed on the edit left rolled back; a table cell,
  which failed on the caret position at the answer; and a key pressed at the answer with the
  cell read on the next four frames, which failed while a waiting focus request still moved the
  caret back. The check delivers the crossing snapshot to the webview itself. It now counts a
  save only when the file on disk grew, and it reads the restored state without a delay.

### Verification

All on 2026-11-13, on Windows. The first two entries are from the final tree of this milestone,
after the review.

- `npm run test:all`: **passed**, exit 0 in 171 seconds. In order: 25 of 25 unit test files and
  both bundle checks; the documentation check; the privacy check; 42 of 42 agent tooling tests;
  the visual host check with no failing section, both screenshots opened; structure controls;
  toggle; save and typing (300 edits through 24 saves that reached the disk, none rejected);
  the rendering check, 25 of 25; the whole-surface release check, 17 of 17.
- `node scripts/edh-save-sync-check.mjs --crlf`: passed.
- The measurements of the audit, repeated with auto-save after 1000 ms. They come from a probe
  that is not in the repository, and the after column was taken before the review changes,
  which touch only the composition and table cell handling:

| Run | Before | After |
| --- | --- | --- |
| Second edit 1016 to 1047 ms after the first | 13 of 33 trials diverged | 0 of 42 |
| 500 edits 6 ms apart, a save about every 90 ms | 33 lost | 0 lost |
| 180 edits at nine a second, a save every 650 ms | 3 lost | 0 lost |
| 150 edits the same way on a 650 KB document | 6 lost | 0 lost |

- `./Build_and_Install`: installed 0.1.236.

Not run: `npm run test:host:preview` and the code-highlighting check, which are not gates; the
benchmarks; anything on macOS. Composition with a real input method was not exercised: the
composition case in the check sends the two composition events itself. The installed build was
not exercised by hand in a reloaded window.

**Remaining limits.**

- A snapshot of changed content that crosses an unanswered edit still makes the host reject
  that edit. That is the conflict the warning exists for. A save that changes the text is such
  a snapshot; see the trimming entry under known gaps.
- A composition that begins on rolled-back text, in the moment between a crossing snapshot and
  the acknowledgement, is sent on the old text when it ends, and the host rejects it. Read from
  the code, not reproduced.

## Milestone 6: defects reported against 0.1.228 (2026-11-13)

Decisions A26 and A27. Eight defects and one wish for a setting were reported against version
0.1.228. Each was first looked for in a real window. Seven defects were reproduced and
corrected, the setting exists, and one defect is not reproduced.

**The cell highlight flickered while typing.** A keystroke in a table cell replaces the text
that the highlight's ranges were attached to, and the word at the caret reached the highlight
through a selection event that arrives a frame or two after the key. In between, the previous
word was still the query and matched nothing: sampled frame by frame, 41 frames had no
highlight on the word being typed while 17 characters were entered.

- The query for a focused cell is read from the cell itself, and cells are repainted in a
  microtask after the change that moved them, before the browser paints
  (`src/editor/occurrenceHighlight.ts`).

**The cell highlight looked different from the one in prose.** A cell match is filled through
the CSS Custom Highlight API, which draws neither a rounded corner nor a border; a prose match
had both. In a theme that sets `editor.selectionHighlightBorder`, a high-contrast theme among
them, a cell match had no border at all.

- A prose match is square now, as a cell match is and as the stock editor's are. This changes
  what prose looked like: its corners had a 2 px radius.
- A cell match gets its border from one positioned box per match, in a layer over the table,
  with the same rule as the prose border. The layer exists only while the theme draws a border.

**Column widths moved on every keystroke.** Measured: the column grew by one character for each
character typed. That is how the layout works, so the answer is a setting (A27),
`tableLayout.typingResizeDelay`: while typing, the table keeps the widths it has and the text
wraps inside its cell; the table resizes once typing has paused for the delay, or at once when
another cell takes the caret, the table changes shape or the editor is resized. The default is
0, which leaves the behavior as it was (Q11).

**Line numbers could be selected.** The gutter had no rule against selection and lies outside
CodeMirror's content, so a drag that began there was the browser's own and selected the numbers.

- Line numbers cannot be selected. A gesture that begins in the gutter is a document selection
  from the text edge of that row: a click puts the caret at the start of the line, a drag
  selects the rows it passes, and Shift+click extends (`src/editor/documentClipboard.ts`).

**A context menu showed an orange outline.** A menu takes focus when it opens, and the browser
drew its own focus ring around it, 0.8 px in `rgb(229, 151, 0)`, whenever it counted that focus
as one to mark. The menus draw no outline now; the focused item's background is the mark.

**Text pasted from a Markdown editor arrived changed.** The rich content was converted back to
Markdown: a heading came back underlined, list markers had three spaces after them, and a line
that followed a nested list came back inside the list item, indented.

**Text pasted from a code block arrived escaped.** The rich content of a code editor is its text
with colors. Converting it put a backslash before every `*`, `[`, `]` and leading `-`.

- Automatic paste takes the plain text unchanged when it is the source of the rich content: the
  clipboard was written by a VS Code editor, or the rich content is preformatted text with no
  structure and the same text, or it has structure and the plain text holds all of its text and
  writes each kind of that structure in Markdown. The rule is pure
  (`src/shared/clipboardPasteSource.ts`) and answers no whenever it cannot show that, so a web
  page or a word processor converts as before. **Paste Rich** always converts.
- The converter writes `#` headings, one space after a list marker, and nests a list at its
  parent's content column.

**The caret landed in a task's hidden marker.** The characters of a concealed `- [x]` have no
width and sit at one point beside the checkbox. A click between the checkbox and the text
landed on one of them: the marker's source appeared, and with the caret beside the check letter
every word x in the document was highlighted, with a stray border beside the other checkboxes.

- A pointer selection never ends inside a concealed task marker; it ends at the start of the
  task's text. The keyboard still walks into the marker and reveals it
  (`src/editor/markdown/markdownRendering.ts`).
- The check letter of a rendered marker asks for no highlight, and a match that lies wholly
  inside a concealed marker is not drawn.

**The editor stayed blank after its window was minimized: not reproduced.** Three attempts in a
real window, each with the real screen captured on restore, painted at once: four minutes
minimized; one external edit while minimized; 120 external edits to an 80 KB document while
minimized, where every one was applied while hidden and the first frame came 3 ms after the
window showed. No cause is established and nothing is claimed fixed. Three things changed that
could matter and are safe on their own:

- The one place where the editor hides itself, while it aligns a restored table row after
  start-up, no longer depends on a frame arriving to show itself again. It shows after 400 ms
  whatever happened.
- When its window shows again the editor measures once.
- With the `debug` setting on, the output channel records how long the window was hidden and
  how long the first frame took, or that no frame came within a second. That would tell a slow
  editor from a renderer that painted nothing.

**Tests.**

- `scripts/edh-editing-surface-check.mjs`, new, `npm run test:host:surface`, in
  `npm run test:all`: seven sections in a real window. On the build without the corrections all
  seven failed, each on the defect it covers; with them all seven pass.
- Unit tests, new: `src/test/clipboardPasteSource.test.ts`, `src/test/tableResizeDelay.test.ts`,
  and the task-marker cases in `src/test/highlighting.test.ts`.

### Verification

All on 2026-11-13, on Windows. Two small edits came after the first series of host runs: the
paste rule stopped taking plain text for styled content with paragraphs, and the delay code
stopped measuring when no delay is set. The entries say which runs saw the final source tree.

- `npm test`, final tree: **passed**, exit 0. 27 of 27 unit test files and both bundle checks.
- `npm run check:docs`, `npm run check:privacy` and `npm run test:agent` (42 of 42): **passed**.
- The editing surface check, final tree: exit 0, 7 of 7, its occurrence, gutter and task
  screenshots opened.
- The visual check, final tree: exit 0. Both screenshots were opened on the run before the two
  edits, which also exited 0.
- Before the two edits, each run on its own: structure controls exit 0; toggle exit 0; save and
  typing exit 0 (300 edits through 22 saves); the whole-surface release check exit 0, 17 of 17;
  `node scripts/edh-visual-check.mjs --occurrence-highlight-only` exit 0.
- The rendering check, before the two edits: 24 of 25 on the first run, 25 of 25 on the second.
  The check that failed once expects a task marker's source to appear when the caret is put on
  it from a script, which needs the window to have focus; keystrokes from outside reached
  another check's window during the same series. It is recorded as one failure in two runs,
  not explained further.
- `npm run test:host:preview`, before the two edits: 15 of 15 checks; the run exits 1 on the
  one console warning of Q10, as it did before this milestone.
- `./Build_and_Install`: **passed**, exit 0, 0.1.237 to 0.1.238, and the installed version was
  verified as 0.1.238.

Not run: `npm run test:all` as one command; the code-highlighting check; the device-scale and
selection-rendering variants of the visual check; the benchmarks; anything on macOS. The
reviewer subagent has not read this change. Not exercised by hand: a real copy from the
applications named in the reports, an input method inside a table cell while the delay holds
its widths, and the installed build in a reloaded window.

**Remaining limits.**

- The paste rule was written against rich content in the shapes those applications are known
  to produce, not against captures from them. If a paste from one of them still converts, the
  clipboard's rich content does not have the shape assumed, and a capture of it is what is
  needed.
- With a typing delay set, text typed into a narrow or empty column wraps one character wide
  until typing pauses.
- Occurrence borders inside a table are positioned from the layout at the time of painting.
  They follow column widths, typing and editor geometry; a change of zoom alone is followed by
  the next of those.

## Milestone 7: find, replace and multiple cursors (2026-11-15)

Decisions A28, A29 and A30; plan in
[docs/plans](plans/2026-11-15-find-and-replace.md), all eight steps carried out. Behavior is in
the [README](../README.md#find-and-replace) and sections 11 and 12 of the
[design spec](DESIGN_SPEC.md); the code map is in [ARCHITECTURE](ARCHITECTURE.md).

**Find and replace.** `Ctrl+F` and `Ctrl+H` open a widget that follows the stock editor's:
match case, whole word, regular expressions, a match count, next and previous, replace and
replace all. Find searches the Markdown source, table cells included, each cell as the text it
shows while edited. A match in hidden syntax is revealed when it becomes current, and one in a
table that is off screen is scrolled into view. Replace writes through the existing edit path.
A replace all across prose and tables is two transactions dispatched as one editor update, so
the host receives one change and one Undo takes it back; the table change filter, the intent
rules and the host's validation were not modified.

**Multiple cursors.** Add the next occurrence, select all occurrences, change all occurrences,
cursors above and below, mouse cursors and column selection, with the stock keys. With one
cursor no existing key path changes: the new bindings decline unless several cursors exist.
The table source guard removes a caret that lands in table source when there are several;
copy, cut and paste with several selections are plain text. Occurrences inside table cells
take no cursor and are reported.

**What reuse needed (A30).** The find code and the cursor code refer to nothing in VS Code. The
host's part is two commands, a message, and an element for the widget.

**No dependency was added.** The commands and the column selection come from CodeMirror
packages that were already bundled. The webview bundle grew from 1,771,556 to 1,829,967 bytes.

Choices made while building, each an agent's judgment: a replacement carries its own user
event, so the properties input filter leaves it alone; a cell match that is current is painted
in the cell and becomes the cell's selection only when the widget gives up the focus; with
several cursors `Enter` is a plain line break, and list continuation waits for one cursor; a
cursor added above or below steps over a table, which is what the editor's vertical movement
does at a block.

### Verification

Windows, VS Code 1.146, Node.js 24.

- `npm run test:all`: exit 0, twice. 30 of 30 unit test files, both bundle checks, the
  documentation and privacy checks, 42 of 42 agent tooling tests, then the visual,
  structure-control, toggle, save-and-typing, editing-surface, find, rendering (25 of 25) and
  whole-surface release (17 of 17) host checks. One change came after the second run: where a
  word is both a find match and an occurrence, table cells now stack the two tints in the
  order prose does. `npm test` and the find check ran again after it.
- `node scripts/edh-find-check.mjs`: 20 of 20 sections, in four runs besides the two inside
  the suite, two of them under the light theme. Its thirteen find sections also passed under
  the high-contrast theme. The screenshots were opened, under the dark, light and
  high-contrast themes: the widget beside the stock one, the current match in a far table
  cell, the document after a replace all, matches drawn as borders under high contrast, eight
  selections with the note about table cells, and a column selection.
- The first run of the new check failed one section, and the first run with the cursor
  sections another. Both were the
  check's own mistakes, not the editor's: it looked up a table by its index among mounted
  tables, and it expected a table to stop Add Cursor Below. Both expectations were corrected
  to what the editor does and should do.
- Measured with `node scripts/edh-find-check.mjs --measure`, in the webview with the host
  isolated, on generated documents. A query whose only match is on the last line is found in
  3 ms at 10,000 lines (589,000 characters) and 5 ms at 100,000 lines (5,989,000 characters);
  a query with 10,000 matches is counted in 4 ms. A keystroke typed into the document costs the
  same with the widget open as closed: median 10 ms at 10,000 lines and 28 ms at 100,000 lines,
  60 samples each, in two runs. The 28 ms is the editor's cost before this milestone, not
  find's, and is above the spec's target for that size.
- `Build_and_Install`: installed 0.1.239 and verified the installed payload.

Not exercised: an input method in the find box or with several cursors, a screen reader,
macOS and its keys, a file the system reports as read-only (the check sends the option the
host would send), and the system clipboard with several selections.

### Review (2026-11-16)

The `invariant-reviewer` read the whole milestone. It found the replace write path sound: each
transaction is judged by the unchanged table filter, nothing is written unless every part is
accepted, the search domain leaves out exactly what the filter protects, and one update is one
change to the host. It found no blocker, and these defects, each confirmed before it was fixed:

- **The host mapped every change by reading the document from its start.** That code is older
  than this milestone, but an edit now carries thousands of changes. A unit test mapped 20,000
  changes in a megabyte of text in 18 s; a replace all of 10,012 matches took 4.5 s to come
  back from the host. The mapping now finds each line by searching the line starts: the same
  unit test passes and the same replace all comes back in 0.36 s.
- **A caret at the end of a document that ends in a table** stayed among several cursors, and
  the filter's refusal of text typed there took the typing at every cursor with it. The guard
  now removes that caret too when there are several; a lone caret is untouched.
- **An Enter that belongs to a composition replaced** in the widget. The widget now ignores key
  presses that belong to an input method.
- **A reveal could outlive its query.** A match found by a search that outlasted its first
  slice could become the selection after the user had moved on. The request is now tied to
  its query and dropped by any command, by closing, and by an edit to the document.
- Smaller: navigation and replace wait while text is composed in the editor or in a cell, or
  is still on its way to the host; a cell that mounts late is not focused if the focus has
  moved; inside a cell the table's configured keys are recognized by parsing them, not by one
  spelling; an open completion list keeps its keys with several cursors; a copy or paste mode
  asked for from the menu is not left armed by a copy or paste of several selections; and a
  cut or paste that the table guard refused is no longer announced as done.

**Undo in the find box.** The reviewer expected the page's own Undo, run from the find box, to
reach text typed into the document, because the browser keeps one history for a page. A key
press sent by a host check does not run that command, so this was not reproduced. The widget
now cancels the key and keeps a history for each of its boxes, which removes the question; a
replacement is undone from the text, not from the box.

The replace transactions moved into a pure function, `planReplaceTransactions`, so the table
guard's verdict on them is unit tested: one cell, several cells, prose with tables, insertions
beside a table, tables at both ends of a document, and a refused or stale plan.

Checks after the fixes: `npm run test:all`, exit 0 on the second of two runs, with 32 of 32
unit test files, 22 of 22 sections of the find check, rendering 25 of 25 and release 17 of 17;
`node scripts/edh-find-check.mjs --crlf`, 22 of 22; `node scripts/edh-find-check.mjs --measure`,
22 of 22 with the host timing above. `Build_and_Install` installed 0.1.240.

The first of those two runs stopped in the visual check, exit 1: its reverse drag from the text
up across a table selected six cells where all fifteen are expected. The visual check then
passed twice on its own and once inside the second run. That is one failure in four runs on
the same tree. It was not reproduced, its cause is not established, and it has not been run
on the tree before this milestone, so it is recorded as open, not as pre-existing.

## Known gaps and findings

- **Find opens over the first lines.** The stock editor moves the first lines of a document
  down while its find widget is open at the top; this editor does not, so the widget covers
  the right end of the first two lines there (milestone 7).
- **A current match inside syntax that a table cell's preview hides has no mark** until the
  cell takes the caret, which shows the cell's source (milestone 7).
- **Typing costs 28 ms a keystroke at 100,000 lines**, measured in milestone 7 with find
  closed. The spec's target at that size is 16 ms.
- **A replacement rewrites the whole of each cell it changes**, as an edit typed into the cell
  does: elsewhere in that cell `<br/>` becomes `<br>`, `&vert;` the numeric entity, and a
  non-breaking space a space. Replace All does this in every cell it touches. The README says
  so; whether a replacement should leave the rest of a cell byte for byte is undecided.
- **The visual check's reverse drag across a table failed once in four runs** on the final
  tree of milestone 7 and was not reproduced (the Review section above). Until it is
  explained, a failure of that check on a later change needs a second run before it is
  believed, and a second failure needs a comparison with the tree before this milestone.
- **Two rules of milestone 7 have no test:** a late match does not take the caret once the
  query changed or the document was edited, and the page's Undo cannot be reached from the
  find box. See known gaps in [TESTING](TESTING.md).

- **An editor that stays blank after its window was minimized is reported and not
  reproduced** (milestone 6). The debug log now records what happens when a window shows again.
- **Three reliability defects from the audit of 2026-11-13 are not fixed.** A read-only
  document accepts typing (reproduced); the host keeps up to 201 full copies of every document
  opened; document text or a highlighter failure can stop start-up in uncommon configurations.
  See the [reliability audit](reports/reliability-audit-2026-11-13.md).
- **Auto-save with `files.trimTrailingWhitespace` removes the space under the caret**
  (found 2026-11-13, not fixed). VS Code spares trailing whitespace at the cursor of its own
  editor on an auto-save; it knows no cursor for the live editor, so the space just typed is
  trimmed and the changed text is sent to the webview. Measured with a probe that is not in the
  repository, auto-save after 1000 ms: a word and a space, then the next word about a second
  later, 24 times. The two words were joined 19 times, the second word was rejected and lost
  4 times, and the text was right once. The save-and-typing check turns trimming off, so it
  does not cover this.
- **A console warning in the preview-only host run** (Q10). Until it is explained, that run is
  not a gate.
- **The code-highlighting check has not run against its new fixture**, and it times out on
  roughly one run in four for an unknown reason.
- **Quote guides, callout accents and code token precedence have no assertion** in the real
  editor (P10).
- **A01-A16 are unconfirmed reconstructions.**
- **No CI and no linter** (Q05, Q06).
- **Mixed version pinning.** Most runtime dependencies are exact; `dompurify`, `markdown-it`,
  `turndown` and `turndown-plugin-gfm` use caret ranges. The lockfile keeps installs
  reproducible, so this matters only when dependencies are next changed.
- **Performance targets are unmeasured for the current design.** The spec's large-file targets
  were last measured on version 0.1.174.
- **Manual coverage never recorded:** OS input method sessions, a screen reader, and the host
  checks on macOS (Q07).
- **`scripts/` is flat**, and some case modules are named for when they were written (P08).
- **The README screenshot is the only image.** It shows the dark theme.

## Next steps

From milestone 7: try find, replace and multiple cursors in daily use, and decide whether the
widget should move the first lines down as the stock one does, whether the occurrence commands
should reach into table cells, and whether a replacement should leave the rest of a cell
exactly as written. P11 lists what reuse outside VS Code would need from existing
code.

From the earlier milestones:

1. Try the corrections of milestone 6 in daily use, with the applications the paste reports
   came from. Answer Q11 once the typing delay has been tried. If the editor stays blank after
   a minimized window again, turn the `debug` setting on and keep the output channel's lines.
2. Decide which of the open reliability findings to fix: the three that remain from the audit
   and the trimming on auto-save.
3. Review A01-A16 in DECISIONS and correct any that misstate intent.
4. Answer Q02 (must documentation-only changes run `Build_and_Install`?) and Q03 (branch
   policy); both affect every later session.
5. Run the code-highlighting check against its new fixture several times and record the result.
6. Investigate Q10, starting from the table height estimate, then make the preview-only run a
   gate.
7. Carry out P10 so the removed checks have a pixel-based replacement.
8. In the first new session, confirm the SessionStart, PreCompact and Stop hooks fire, and
   update the status line in [.claude/README.md](../.claude/README.md).
