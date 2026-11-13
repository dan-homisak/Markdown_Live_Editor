# Session 2026-11-13: agent framework and repository cleanup

Status: open · Updated: 2026-11-13

## State now

- Working on: nothing in flight. All four milestones in [PROGRESS](../PROGRESS.md) are done:
  the framework, the cleanup, the purpose-built fixtures and repairs, and the history cleanup.
- Next step: run the code-highlighting check against its new fixture, then investigate Q10.
- Waiting on a decision: Q02, Q03 and Q08 remain open. Whether the dated reports stay is
  undecided; they were kept.
- Uncommitted: nothing. `main` was rewritten and force-pushed on 2026-11-13.
- Installed: 0.1.233.

## Direction

- 2026-11-13 → A17: this repository uses a structured agent workflow: shared instructions, a
  decision register, verification rules, session journals and checks that enforce them.
- 2026-11-13 → A18: the repository is public. Tracked files never contain the owner's messages,
  or anything about how, when or with what the owner works.
- 2026-11-13 → A19: records an agent needs to continue the work stay in version control; raw
  logs, screenshots and result dumps do not.
- 2026-11-13 → A20: documents describe what ships. Where a document was wrong, old or
  contradicted the editor, the document is corrected.
- 2026-11-13 → A21: tests use their own frozen fixtures, separate from the documents people open
  and edit, and follow a written plan.
- 2026-11-13 → A22: the README is written for the public.
- 2026-11-13 → A23: test fixtures are documents designed only for testing. The sample
  documents are not test input and fixtures are not copies of them.
- 2026-11-13 → A24: obvious defects in the editor are corrected. A test that is wrong,
  obsolete or works against the product is removed or replaced with a better one.
- 2026-11-13 → A25: old material that is no longer needed is removed from the repository's
  history as well as from the working tree. Confirmed scope: `qa/` and `debug.log`.

## Checkpoints

### 1. Framework written, checked and installed

- Decided (agent): adopt the structure of an existing private framework and rewrite the content
  for this project. What was adopted, changed and left out is in [RESEARCH](../RESEARCH.md).
- Decided (agent): accepted decisions were reconstructed from the repository record and are
  labeled as such.
- Learned: this repository checks out with CRLF, tracks its webview bundle, and holds Markdown
  that tests depend on byte for byte. A straight copy of the checker and LF rules would have
  damaged them.
- Checks: baseline of the unchanged product passed (compile, unit tests, the visual host check
  with both screenshots opened). Exact results are in PROGRESS.

### 2. Privacy rules and cleanup pass

- Decided: journals carry no quotations, no times of day and no session identifiers. The link
  between a session and its journal lives in local hook state. The documentation checker enforces
  the format; a privacy check scans everything git would commit for home-directory paths and for
  names kept in a local, ignored list.
- Decided: test inputs moved to `test/fixtures/` behind a hash manifest; the documents for
  hand-testing moved to `samples/`; the spec and dated reports moved under `docs/`; `qa/` is
  local output only.
- Decided: the package is built from an allowlist. It went from 222 files to 10.
- Learned: the live-preview host check already fails at the last commit, with two root failures
  and three that follow from them, and some of its checks depend on window focus. Details and
  status are in [TESTING](../TESTING.md).
- Learned: code blocks are colored by VS Code's own grammars, with six bundled grammars as the
  fallback. The older documents described only the fallback.
- Rejected: reorganizing `scripts/` into subfolders in the same pass; every script computes the
  repository root from its own location, and the host checks are the safety net for this work.

### 3. Documents reconciled, every suite run

- Decided (agent): the README was rewritten from what the editor does, established from the code
  and from host screenshots; the spec was revised to match in six places. Neither older document
  was trusted as evidence for the other.
- Learned: two more Live Preview suites fail, and all three fail the same way on an untouched
  copy of the last commit. Two root causes are open as Q09; the rest are recorded check by check
  in [TESTING](../TESTING.md).
- Learned: some host checks fail intermittently with timeouts, the code-highlighting check on
  about a third of its runs. The cause is not established.
- Rejected: turning off background throttling and Command Palette closing in the shared launch
  settings. It was a guess at the cause; it did not cure the timeouts and it made the toggle
  check fail twice in two runs. Reverted; the toggle check then passed three times.
- Decided (agent): a check that times out intermittently is not a gate. The code-highlighting
  check stays available but is not part of `npm run test:all`.
- Decided (agent): `undici` became a declared development dependency; it was imported by every
  host check but present only through another package.
- Open: Q02, Q03, Q05-Q09.

### 4. Purpose-built fixtures and repairs

- Decided: `test/fixtures/` now holds `markdown-constructs.md`, `code-languages.md`,
  `table-cells.md` and the generated `gutter-stress.md`. Each has case identifiers, a stated
  contract in the folder's README, and contract assertions in `src/test/fixtures.test.ts`,
  which also fails if any test or script refers to the samples folder.
- Decided: host checks find fixture rows by identifier. The visual check computes the two
  navigation rows from `TC-NAV-01` and `TC-NAV-02` instead of fixed line numbers.
- Decided: `npm test` deletes old compiled tests before compiling; a renamed test had kept
  running from its stale output.
- Learned: Tab on a first child only adds indentation, and Shift+Tab then moved the item to its
  parent's level. The unit tests cover Tab and Shift+Tab separately and a sibling round trip,
  but not this one; the host check that does has been failing. Treated as a defect (A24).
- Learned: the code-block language control is one pixel smaller than the code by an explicit
  rule in the stylesheet, so the host check that expects equal sizes is out of date.

### 5. Suites repaired, history cleanup prepared

- Decided (agent, under A24): Shift+Tab removes indentation beyond the parent's content column
  before it unnests. Two host expectations were corrected, one rewritten to its intent, and
  three that asserted stylesheet internals removed; the release check reverts its document
  after a failed check; the installer compares installed files with the build byte for byte.
  Reasons are in [TESTING](../TESTING.md).
- Checks: `npm run test:all` passed with nine steps, including the rendering check at 25 of 25
  and the whole-surface release check at 17 of 17, which are gates now. The preview-only run
  passes 15 of 15 checks but exits 1.
- Learned: that exit comes from one CodeMirror measure-loop warning, raised only when the
  constructs fixture's small tables are present. The sample document it replaced never raised
  it. Open as Q10.
- Learned: the history holds 108 commits; the old run output sits in 27 of them, and no history
  rewriting tool beyond git's own is installed. A rewrite changes every commit hash, so the
  hashes cited in DECISIONS, RESEARCH and TESTING must be updated in the commit that follows it.
- Checks: a rehearsal on a throwaway clone removed `qa/` and `debug.log` from every commit in
  under a minute with git's own filter. 107 of 108 commits remain, none touches those paths,
  and no file anywhere in the rewritten history contains a home-directory path.
- Open: the scope of A25. Nothing is rewritten or force-pushed before it is confirmed.

### 6. History cleaned

- Decided: the scope of A25 is `qa/` and `debug.log`, removed from every commit; the commit
  history itself is kept, and so are the dated reports.
- Checks: 109 of 110 commits remain, none touches the removed paths, the tip tree is unchanged,
  and no file in any remaining commit contains a home-directory path. A bundle of the earlier
  history was saved outside the repository first.
- Learned: every commit hash changed, and the five cited in the documents were updated. One
  old pull-request reference on the hosting service still reaches 69 early commits; they were
  searched and hold no local path.
- Decided (agent): commits carry no tool attribution line, under the public-repository rules.
