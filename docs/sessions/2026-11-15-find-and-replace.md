# Session 2026-11-15: find, replace and multiple cursors

Status: open · Updated: 2026-11-16

## State now

- Working on: nothing in progress. Milestone 7 (find, replace, multiple cursors) is built,
  reviewed by the `invariant-reviewer`, and its findings are fixed: the Review section of
  milestone 7 in [PROGRESS](../PROGRESS.md).
- Next step: the next steps in PROGRESS. Open there for a decision: whether a replacement
  should leave the rest of a changed cell byte for byte, whether the widget should move the
  first lines down, and whether the occurrence commands should reach into table cells.
- Waiting on a decision: nothing blocks.
- Uncommitted: nothing. Milestone 7 with the review fixes is committed on `main` and not
  pushed.
- Installed: 0.1.241, the committed tree.

## Direction

- 2026-11-15 → A28: the live editor gets find and replace like the stock editor's.
- 2026-11-15 → A29: the live editor gets the stock editor's multiple cursors, as many of its
  commands as the editor can carry.
- 2026-11-15 → A30: the editor is to be reusable outside VS Code, so new editor code stays
  independent of the VS Code host.

## Checkpoints

### 1. Plan accepted

- Decided: A28, A29, A30; P11 records what reuse would need from existing code.
- Rejected: an external search server and `@codemirror/search` for find inside a document;
  reasons under Not selected in DECISIONS.
- Learned: a transaction that carries a `tables` intent must keep every change inside the
  declared tables, so a replace all across prose and tables cannot be one transaction. Two
  transactions dispatched as one editor update still reach the host as one change message.
  The installed CodeMirror packages export the cursor above and below commands and
  rectangular selection. 23 source files read the main selection; the list of those that
  already refuse several ranges is in the plan.
- Decided (agent): keys are handled in the webview, because a contributed keybinding scoped by
  the active custom editor would also fire with focus elsewhere in the window.

### 2. Find and replace built (plan steps 1 to 5)

- Decided (agent): the code is `src/shared/findModel.ts`, and `findState.ts`,
  `findController.ts`, `findWidget.ts` and `find.ts` under `src/editor/find/`. A replacement
  uses the user event `find.replace`, not an input event, so the properties input filter
  leaves it alone. Cell highlight names carry a number per editor, and their rules come from
  an editor theme, because the shared stylesheet cannot name them.
- Learned: the two-transaction update for a replace all across prose and tables reaches the
  host as one change and is undone by one Undo, with the table filter untouched. Tables that
  scroll out of view are unmounted, so a check must find a cell by its text, not by the index
  of its table.
- Checks: `npm test`, 29 of 29 files and both bundle checks. `node scripts/edh-find-check.mjs`,
  13 of 13 sections, three consecutive runs, one under the high-contrast theme. The editing
  surface check, 7 of 7; the visual check and the save and typing check, exit 0.
- Measured with `--measure`, in the webview with the host isolated: a query whose only match
  is on the last line is found in 3 ms at 10,000 lines and 5 ms at 100,000. A keystroke typed
  into the document costs the same with the widget open as closed: median 10 ms at 10,000
  lines and 28 ms at 100,000, 60 samples each.
- Open: the stock editor moves the first lines down while its widget is open at the top of a
  document; this editor does not. A current match inside syntax that a table cell's preview
  hides has no visible mark until the cell takes the caret.

### 3. Multiple cursors built (plan steps 6 to 8), plan complete

- Learned: selection painting and the reveal rules already walked every range. What one
  cursor relied on the browser for (arrows, Backspace, Enter) had to be bound for several,
  and each binding declines unless several cursors exist, so the single-caret paths are
  untouched. The editor's vertical movement steps over a table, so the cursor above and below
  commands do too; the guard still removes any caret that lands in table source.
- Decided (agent): copy, cut and paste with several selections are plain text; `Enter` with
  several cursors is a plain line break; `Alt+Enter` in the find box selects every match.
- Decided (agent), after reading the diff: `F3` pressed while a table cell holds the caret
  searches on from that caret, and cells are repainted only while find is open or closing.
- Checks: `npm run test:all`, exit 0, with 30 of 30 unit test files and 20 of 20 sections of
  the find check. The two corrections above came after that run started; `npm test` and the
  find check were run again with them, and the whole suite once more before the install.
- Open: whether the widget should move the first lines down as the stock one does; whether
  the occurrence commands should reach into table cells. Both are in PROGRESS.

### 4. Review of milestone 7

- Learned: the reviewer found the replace write path sound and no blocker. Confirmed since:
  `mapNormalizedDocumentChangesToHost` reads the text from its start for every change, so
  20,000 changes in a megabyte took 18 s in a unit test (a replace all or many cursors now
  send that many); a caret at the end of a document that ends in a table stays among several
  cursors and makes the filter refuse typing at all of them; an Enter that belongs to a
  composition replaces in the widget (reproduced in the host check).
- Learned: a raw key press sent by the host check does not run the browser's own Undo, so
  the claim that Undo in the find box can reach the page's shared history was not
  reproduced. The widget gets its own history for its two boxes and cancels the key, which
  removes the question.
- Decided (agent): also fix the reveal flag that outlives its query, add composition guards to
  navigation, exempt configured table keys inside cells by parsing them, let the properties
  completion keep its keys with several cursors, and clear the copy and paste modes in the
  several-selection branches. The replace transactions move to a pure function so they can
  be unit tested.
- Open: a cell replace re-encodes the whole cell as a typed edit does (`<br/>` to `<br>`,
  `&vert;` to the numeric entity, a non-breaking space to a space). Decide after the fixes
  whether to make it surgical or record it.
- Checks: new sections in `scripts/edh-find-check.mjs` (Undo in the box after text typed into
  the document, a composing Enter, buttons by mouse, the guard in the host, cut, Ctrl+Shift+L,
  a cell that is composing), a host timing under `--measure`, `--crlf`, and
  `src/test/documentChangeMapping.test.ts`. A plain `tsc` overwrites the host bundle; run
  `npm run compile` before a host check.

### 5. Review findings fixed

- Checks: the mapping unit test went from 18 s to passing; the host's answer to a replace
  all of 10,012 matches from 4.5 s to 0.36 s. `npm test`, 32 of 32 files. The find check,
  22 of 22 sections, also with `--crlf` and `--measure`; then `npm run test:all` and the
  install.
- Learned: a completion that is only being looked up reports itself as pending right after a
  typed character. Holding the several-cursor keys back for anything but an open list broke
  Backspace at several cursors; the guard now waits for an open list only.
- Decided (agent): a cell replace keeps the typed-edit encoding of the whole cell. It is
  stated in the README, pinned by a unit test, and listed in PROGRESS for a decision.
- Open: two rules have no test (a late match leaving the caret alone, and the page's Undo
  being unreachable from the find box); both are in the known gaps of TESTING.

### 6. Committed

- Checks: milestone 7 with the review fixes is one commit on `main`, not pushed. The
  install before it raised the version to 0.1.241; nothing else changed after the last run
  of the gate suite except this journal and two lines of PROGRESS.
- Learned: the earlier milestones are on the remote; `main` was level with it before this
  commit.
