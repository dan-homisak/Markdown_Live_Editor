# Progress and handoff

Updated: 2026-11-13.

## Actual repository state

- Git: branch `main`, the only branch, with a remote. Milestones 1 to 5 below are committed.
  The history was rewritten on 2026-11-13 (milestone 4), so every commit hash cited in these
  documents is the one in use after that rewrite.
- Product source differs from 047e615 in two places: the list-nesting fix of milestone 3 and
  the save race fix of milestone 5. The extension version is a build counter:
  `Build_and_Install` raises it on every run. The installed version is 0.1.237.
- Layout: source and unit tests in `src/`, shipped assets in `media/`, scripts in `scripts/`,
  frozen fixtures in `test/fixtures/`, hand-testing documents in `samples/`, all project
  documents under `docs/`, agent tooling in `.claude/`. `qa/` and `dist/` are local output.
- Gates that pass: unit tests; the visual, structure-control, toggle, save-and-typing,
  rendering and whole-surface release host checks; the documentation and privacy checks; the agent tooling
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

## Known gaps and findings

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

1. Decide which of the open reliability findings to fix: the three that remain from the audit
   and the trimming on auto-save.
2. Review A01-A16 in DECISIONS and correct any that misstate intent.
3. Answer Q02 (must documentation-only changes run `Build_and_Install`?) and Q03 (branch
   policy); both affect every later session.
4. Run the code-highlighting check against its new fixture several times and record the result.
5. Investigate Q10, starting from the table height estimate, then make the preview-only run a
   gate.
6. Carry out P10 so the removed checks have a pixel-based replacement.
7. In the first new session, confirm the SessionStart, PreCompact and Stop hooks fire, and
   update the status line in [.claude/README.md](../.claude/README.md).
