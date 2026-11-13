# Decision register

Updated: 2026-11-13. **Accepted** means established for this project. **Proposed** means
recommended for review; it is not permission to build, change a default or delete anything.
**Open** questions wait for an answer. Implementation status belongs in [PROGRESS](PROGRESS.md).

## How to read this register

Entries state what is true for the project, with the date and the evidence. They never quote
anyone and never describe how a decision was requested: this repository is public (A18).

A01-A16 were reconstructed on 2026-11-13 from the repository's own record, because no register
existed: the earlier instruction file (commit 047e615), the design spec, the README, setting
defaults in `package.json` and the commit history. They have not been individually confirmed.
An entry that misstates intent is corrected in place, with the date.

IDs are never reused or renumbered. A replaced entry stays, marked "superseded by" its successor.
An answered question keeps its row, with the outcome in its Notes.

## Accepted

| ID | Decision | Evidence and notes |
| --- | --- | --- |
| A01 | Before finishing any code change, run the type check or compile command and resolve all reported errors | Instruction file at 047e615 |
| A02 | After every prompt that changes this repository, run `./Build_and_Install` before responding, so the latest build is installed into VS Code | Instruction file at 047e615. Whether changes that cannot alter the package are exempt: Q02 |
| A03 | A change that can affect the user interface is inspected in rendered form before it is finished; terminal output and supplied screenshots are not enough | Instruction file at 047e615 |
| A04 | No known red VS Code Problems diagnostics are left in touched files | Instruction file at 047e615 |
| A05 | Visual parity with the stock editor is judged only inside one isolated VS Code window, with stock and live captured in the same workbench layout. The standalone harness is not proof. Core measurements may differ by at most 0.5 px | Instruction file at 047e615; spec section 9. Procedure: [ENGINEERING](ENGINEERING.md#visual-parity) |
| A06 | Rendered editor metrics come from VS Code's injected webview CSS variables, especially `--vscode-editor-font-size`, not from values the extension host computes | Instruction file at 047e615 |
| A07 | Table row line numbers are owned by the rendered table DOM, never by a separate CodeMirror gutter widget synchronized by `ResizeObserver` | Instruction file at 047e615; spec section 3 |
| A08 | Obsidian-style Live Preview is the required editing model: formatting syntax is hidden at rest and the exact source is revealed at the caret. Permanently colored raw syntax is not an acceptable substitute for a requested live-rendered feature | Spec status line and sections 1 and 10 |
| A09 | The Markdown document is the only authoritative content model. Rendering, selection, focus, folding, scrolling and themes never rewrite it; edits go through the VS Code document and its Undo | Spec section 3; README |
| A10 | Recognized tables keep their own rendering, editing and source ownership. No other Markdown transformation may consume or paint over their source ranges | Spec sections 2 and 3 |
| A11 | Safety boundaries: document HTML is never executed, images and embedded notes are never fetched, code is never run, nothing is downloaded, and links open only through the host, which refuses `command:`, `javascript:`, `data:` and custom schemes | Spec sections 2, 5, 6 and 8 |
| A12 | Test fixture documents are used without modifying them | Spec section 9. Superseded by A21, which also separates them from the documents people edit |
| A13 | Active-line highlighting outside tables is a setting, off by default | Commit 57f72b7; `lineHighlight.enabled` defaults to `false` |
| A14 | Heading `#` markers are shown by default; a setting hides them at rest | Commit b980348; `markdownRendering.showHeadingMarkers` defaults to `true`; confirmed in the host on 2026-11-13 |
| A15 | Code-block syntax highlighting uses VS Code's language grammars and the active theme, with six bundled grammars as the fallback | Commit 9760420; traced in `src/editor/markdown/vscodeCodeHighlighting.ts` on 2026-11-13 |
| A16 | The `+` append-row and append-column flyouts are not part of the table interface | Commit 0458449 |
| A17 | This repository uses a structured agent workflow: shared instructions, a decision register, verification rules, session journals, and checks that enforce what can be enforced | 2026-11-13. What was adopted and what was left out: [RESEARCH](RESEARCH.md) |
| A18 | The repository is public. Tracked files and commit messages never contain the owner's messages, anything about how the owner works, or personal identifiers | 2026-11-13. Rules: "Public repository" in AGENTS.md. Enforced where mechanical by `scripts/check-privacy.mjs` and the journal rules in `scripts/check-docs.mjs` |
| A19 | Records an agent needs to continue the work stay in version control. Raw run output does not: logs, screenshots and result files are local | 2026-11-13. `qa/` is ignored; written reports are in `docs/reports/`. Answers Q04 |
| A20 | Documents describe what ships. A document that is wrong, out of date or contradicts the editor is corrected to match the editor | 2026-11-13. Answers Q01. Applied to the spec, the README, stale script headers and the packaging rules |
| A21 | Tests use their own frozen fixtures, separate from the documents people open and edit, and testing follows a written plan | 2026-11-13. `test/fixtures/` with a hash manifest; `samples/` for hand-testing; [TESTING](TESTING.md) |
| A22 | The README is written for the public: what the extension does, how to use it, its settings, limits and safety, without internal process | 2026-11-13 |
| A23 | Test fixtures are documents designed only for testing: purpose-built, with case identifiers and a stated contract. The sample documents are never test input, and fixtures are not copies of them | 2026-11-13. `test/fixtures/README.md`; enforced by `src/test/fixtures.test.ts` |
| A24 | Obvious defects in the editor are corrected when found. A test that is wrong, obsolete or works against the product is removed or replaced with a better one | 2026-11-13. Each use is an agent's judgment and is recorded with its reason in [PROGRESS](PROGRESS.md) and [TESTING](TESTING.md) |
| A25 | Material that is no longer needed is removed from the repository's history as well as from the working tree | 2026-11-13. Carried out the same day for `qa/` and `debug.log` only, after the scope was confirmed: milestone 4 in [PROGRESS](PROGRESS.md). The dated reports were kept |

## Not selected

| Option | Why | Evidence |
| --- | --- | --- |
| Permanently visible, colored Markdown syntax (the readable-source design of version 0.1.174) | Replaced by A08 | Spec status line |
| A separate gutter widget for table line numbers | A07: fragile when table rows wrap at different window widths | Instruction file at 047e615 |
| The standalone HTML harness as evidence of parity | A05: no Monaco, workbench layout, real settings or webview embedding | Instruction file at 047e615 |
| A second persistent whole-document rendering parser, or a DOM-to-source model | The CodeMirror Markdown tree classifies; the document is the model (A09) | Spec section 7 |
| Quoting requests in journals and registers | A18: the repository is public | 2026-11-13 |
| Normalizing every file to LF, or a repository-wide `.editorconfig` | Source and sample files keep their checkout form; only agent documents and fixtures are pinned | [RESEARCH](RESEARCH.md) |

## Proposed

Recommendations by agents. None is approved unless its Notes say it was carried out under an
accepted decision.

| ID | Proposal | Notes |
| --- | --- | --- |
| P01 | A change limited to agent documents and `.claude/`, none of which ship in the VSIX, skips `Build_and_Install`; it still runs the documentation, privacy and agent checks | Answers Q02. Each run bumps the version, reinstalls the extension and asks for a window reload without changing what is installed |
| P02 | Bring the spec up to date with shipped behavior | Done 2026-11-13 under A20 |
| P03 | Keep dated reports in git; stop tracking raw logs and result dumps; ignore `debug.log` | Done 2026-11-13 under A19 |
| P04 | Add a small CI workflow that runs `npm ci`, `npm test`, `npm run check:docs`, `npm run check:privacy` and `npm run test:agent` on push. Host checks stay local because they need a desktop | Answers Q05 |
| P05 | Add ESLint with a minimal TypeScript configuration | Answers Q06. The editor recommendation for an ESLint extension the project could not use was removed on 2026-11-13 under A20 |
| P06 | Package only what the extension loads | Done 2026-11-13 under A20, as an agent's judgment of what was wrong: `.vscodeignore` is now an allowlist and the package went from 222 files to 10. Reverse it there if any removed file was meant to ship (Q08) |
| P07 | Repair the Live Preview host suites before treating them as gates: settle the two behaviors in Q09, make each check restore its fixture so one failure cannot fail the next three, and remove the dependence on window focus | Mostly done 2026-11-13 under A24: the rendering and whole-surface suites pass and are gates; the preview-only run passes every check but still reports the warning in Q10. The intermittent timeouts are not explained. Status: [TESTING](TESTING.md) |
| P10 | Check quote guides, callout accents and code token colors by measuring pixels, replacing three checks that were removed because they asserted stylesheet internals | Follows from A24. See "Removed checks" in [TESTING](TESTING.md) |
| P08 | Group `scripts/` by purpose (build, host checks, benchmarks) and rename the case modules that are named for when they were written | Not done in the cleanup pass: every script derives the repository root from its own location, and the host checks were the safety net for that pass |
| P09 | Declare `undici` as a development dependency | Done 2026-11-13 under A20: every host check imports it, and it was present only through another package's dependencies. Pinned to the version already installed (7.28.0, MIT, no install script); it is not bundled or shipped |

## Open questions

| ID | Question | Notes |
| --- | --- | --- |
| Q01 | Where the spec and the shipped editor disagreed, which was right? | Answered 2026-11-13 by A20: the shipped editor. The spec was revised for heading markers, properties, fence rows, code highlighting, footnotes and generated contents, and a duplicated paragraph was removed |
| Q02 | Must a change that cannot alter the packaged extension still run `Build_and_Install` (A02)? | Open. Recommendation: P01. Until answered, every repository change runs it |
| Q03 | Branch policy. Only `main` exists, locally and on the remote. Do agents commit to `main` when asked to commit, or work on branches and pull requests? | Open. Until answered: commit only when asked, and ask which branch |
| Q04 | What QA evidence stays in version control? | Answered 2026-11-13 by A19. 128 raw logs, result files and screenshots left version control and stay on disk; seven dated reports moved to `docs/reports/`. The old files were removed from earlier commits as well, under A25 |
| Q05 | Should the repository have CI? None exists | Open. Recommendation: P04 |
| Q06 | Should the project have a linter? It has none | Open. Recommendation: P05 |
| Q07 | macOS. The history records builds on macOS, while the recorded host checks ran on Windows. Is a macOS run of the host checks required before a change is called done? | Open. No recommendation |
| Q08 | Was anything that the package used to carry meant to ship? It held a 680 KB stress fixture, the design spec, the Windows build launcher, 48 compiled test files and 104 source maps | Treated as no under A20 (P06). Confirm, or name what should return |
| Q09 | Two Live Preview host checks fail the same way on every run, at the last commit as well. Which side is right in each? (a) Nesting: Tab on a list item that is already its parent's first child indents it two more spaces; Shift+Tab then moves it to its parent's level rather than back where it was, and the check expects the original document. (b) The code-block language control is styled one pixel smaller than the code text, explicitly, in `media/markdownBlocks.css`; the check expects the two sizes to be equal | Answered 2026-11-13 under A24. (a) was a defect: the unit tests already expected Tab to indent a first child, and nothing undid it. Shift+Tab now removes indentation beyond the parent's content column before it unnests, with unit tests for bullets, numbers, quotes and tasks. (b) was an out-of-date check: the smaller label was introduced on purpose three weeks after the check was written, so the check now expects it |
| Q10 | Rendering the constructs fixture logs CodeMirror's "Measure loop restarted more than 5 times" once. It happens only while the fixture's Tables section is present, with any two of its three small tables, and not with the larger sample document. What keeps the table layout from settling? | Open. Found 2026-11-13 by the purpose-built fixture. It is a warning, not a visible failure, but the preview-only host run treats any console warning as a failure, correctly. A likely place to start is the table height estimate in `src/editor/table/tableHeightEstimate.ts` |
