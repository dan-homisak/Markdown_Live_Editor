# Progress and handoff

Updated: 2026-11-13.

## Actual repository state

- Git: branch `main`, the only branch, with a remote. The newest commit is 5d48666 (2026-11-03).
  Everything described under the three milestones below is uncommitted, including staged file
  moves and the removal of raw QA output from version control.
- Product source differs from 5d48666 in one place: the list-nesting fix of milestone 3. The
  extension version is a build counter: `Build_and_Install` raises it on every run. The
  installed version is 0.1.232.
- Layout: source and unit tests in `src/`, shipped assets in `media/`, scripts in `scripts/`,
  frozen fixtures in `test/fixtures/`, hand-testing documents in `samples/`, all project
  documents under `docs/`, agent tooling in `.claude/`. `qa/` and `dist/` are local output.
- Gates that pass: unit tests; the visual, structure-control, toggle, rendering and
  whole-surface release host checks; the documentation and privacy checks; the agent tooling
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

## Known gaps and findings

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

1. Review A01-A16 in DECISIONS and correct any that misstate intent.
2. Answer Q02 (must documentation-only changes run `Build_and_Install`?) and Q03 (branch
   policy); both affect every later session.
3. Run the code-highlighting check against its new fixture several times and record the result.
4. Investigate Q10, starting from the table height estimate, then make the preview-only run a
   gate.
5. Carry out P10 so the removed checks have a pixel-based replacement.
6. In the first new session, confirm the SessionStart, PreCompact and Stop hooks fire, and
   update the status line in [.claude/README.md](../.claude/README.md).
