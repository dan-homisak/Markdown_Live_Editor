# Engineering workflow

Updated: 2026-11-13. This workflow complements [AGENTS.md](../AGENTS.md). What to test and with
which suite is in [TESTING](TESTING.md); what ran, and when, is in [PROGRESS](PROGRESS.md); where
the guidance came from is in [RESEARCH](RESEARCH.md).

## Operating model

The owner controls product direction, accepted decisions, setting defaults, dependencies and
anything published. An implementation agent owns a bounded task through code, tests, visual
inspection, installation and handoff. Every agent works from the same versioned instructions; do
not maintain competing project memories. One implementation agent is the default. An
independently prompted review pass is valuable for the edit path, table source protection and
geometry, but it is not proof by itself.

The repository is public. Before writing anything that will be tracked, read "Public repository"
in AGENTS.md.

## A task from request to evidence

1. **Understand.** Read the outcome, the relevant documents and code, and the working tree. For a
   defect, capture the failing evidence first: a failing test, or a host check with its output
   or screenshot.
2. **Bound.** State what will be observably true afterwards, the affected surfaces (host,
   webview, tables, preview, settings, package) and what is excluded. If an open question in
   DECISIONS blocks the task, raise that question instead of guessing.
3. **Prove.** For defined behavior and defects, write the failing test first and confirm it fails
   for the intended reason. Visual exploration may come before tests.
4. **Implement.** The smallest slice that is complete where it touches the edit path, Undo,
   tables, settings and the README.
5. **Inspect.** Review the actual diff. For anything visible, run the host check and open the
   screenshots. A test proving a decoration exists does not prove the editor looks right.
6. **Verify.** Run what the [TESTING](TESTING.md) matrix names for the change; keep exact
   commands, counts and exits.
7. **Install.** `./Build_and_Install`, and report the installed version (decision A02).
8. **Handoff.** Update the owning documents and PROGRESS at milestones; state what remains and
   the next executable step, without claiming that unrun checks passed.

If an attempt fails repeatedly, stop patching blindly: preserve the evidence, minimize the
reproduction, recheck assumptions against the pinned library version's documentation, and
escalate a concrete blocker or design change.

## Visual parity

Decisions A05, A06 and A07 govern this work. These notes were learned the hard way in this
repository.

**Procedure**

1. `npm run test:host`. It compiles, launches an isolated Extension Development Host, opens a
   small table document, captures the stock editor, runs "Markdown Live Editor: Toggle Markdown
   Live Editor", and captures the live editor in the same workbench layout. It fails if a core
   measurement differs by more than 0.5 px.
2. Open `qa/edh-stock.png` and `qa/edh-live.png` and compare them. A passing run is necessary;
   when layout changed, it is not sufficient.

**What parity means**

- Compare computed font family, font size, line height, line-number gutter position, first-line
  x and y, and the active-line background.
- Compare glyph and text-node boxes as well as element boxes. CodeMirror line boxes can align
  while the text ink is still shifted by default padding. Compare Monaco's first-line text,
  line-number text, content left edge, gutter width, font size, line height, table-cell left
  edge and active gutter background.
- Mind the coordinate spaces. Monaco measurements are workbench-screen coordinates; webview
  measurements are relative to the webview document. Add Monaco's editor-left offset to live
  boxes before comparing x positions.
- Never claim parity from terminal output or from the standalone harness. The harness has no
  Monaco, workbench layout, real editor settings, minimap, sidebar or webview embedding.

**Writing or changing a host check**

- Launch the host with `--remote-debugging-port`, read `http://127.0.0.1:<port>/json`, and
  connect with `undici`'s `WebSocket`. Capture with `Page.captureScreenshot`; read DOM and
  computed metrics with `Runtime.evaluate`. Driving separate headless Chrome windows produced
  crash-report noise instead.
- Dismiss first-run onboarding and sign-in dialogs in the isolated profile before judging a
  screenshot.
- Prove which editor is showing: a webview `iframe` in the workbench means live; Monaco's
  `.view-lines` means stock.
- Measure composited pixels when the question is what a person sees. A correct background on a
  hidden layer once covered every selected glyph, and a nominal stroke width rasterized to
  alternating one- and two-pixel lines.
- A settled screenshot misses first-frame defects, such as syntax colors arriving after a row
  scrolls into view. Sample the frames, not only the end state.
- Leave the document as the check found it, even when an assertion fails, so one failure cannot
  fail the checks after it.
- Do not depend on the window keeping focus. A check that needs focus must take it and prove it
  has it.

**Known traps**

- *Looks slightly zoomed.* The live editor once used unzoomed `editor.fontSize` and derived
  line heights from the extension host. Use the injected variables (A06).
- *Gutter too far left.* Compare Monaco's margin and content rectangles with `.cm-gutters`,
  `.cm-lineNumbers .cm-gutterElement`, `.cm-content` and `.cm-line` in the same window before
  changing any styling.
- *Table line numbers vanish.* Check clipping and stacking first. The table shifts left into the
  gutter on purpose, so its wrapper must allow visible overflow and sit above the CodeMirror
  gutter layer. Do not reach for a separate gutter widget (A07).

## Lessons this repository already paid for

Each of these cost a debugging session. Sources are the dated reports in `docs/reports/`, the
spec and the script headers.

- **Margins on block widgets break hit testing.** CodeMirror measures a block widget's border
  box. A widget with vertical margins made `posAtCoords` return a later line than the one under
  the pointer. Put spacing inside the widget.
- **A focus microtask can run before input is imported.** Dispatching presentation changes from
  a focus microtask raced CodeMirror's import of a native edit after leaving a table. Preview
  context effects run on the next animation frame.
- **Delayed effects fight pointer gestures.** A deferred presentation effect recreated a native
  highlight during a table-owned drag. Presentation waits until the table releases the pointer.
- **Built-in key bindings can outrank yours.** CodeMirror's Markdown Enter binding continued
  loose task lists with two newlines until the list bindings were given precedence explicitly.
- **Platforms rewrite the clipboard.** Windows normalizes LF to CRLF; a clipboard test compares
  after that one normalization and nothing else.
- **The verifier can be the bug.** An install once "failed" because the payload check looked for
  a class name in the wrong file. Check the marker list in `scripts/build-and-install.mjs` before
  doubting the build, and update it when a marker is renamed.
- **Old evidence describes old versions.** The performance record belongs to version 0.1.174 and
  its fixed-width design; it is not a pass for the reflowing preview. Read the version a report
  names before citing it.
- **Documents drift when they are updated later.** The spec fell behind the shipped editor and
  had to be reconciled in one pass (A20). Change the owning document in the same change as the
  behavior.
- **Tests rot when nobody runs them.** Three host suites were found failing on 2026-11-13 with
  no record of when they broke. A suite that is not a named gate with a recorded status is not
  protecting anything; [TESTING](TESTING.md) now keeps that status.
- **Shared inputs are not fixtures.** Tests once read the same documents that were open for
  editing every day, so an ordinary edit could change what a test exercised. Fixtures are frozen
  behind a hash manifest (A21).
- **Evidence piles up.** Hundreds of logs and screenshots accumulated with no rule for what to
  keep, and they carried local paths into a public repository. Keep the written report; raw
  output stays local (A19).
- **A stylesheet rule written from an assumed DOM is a guess.** A rule meant to hide highlights
  inside hidden list syntax matched nothing, because the two decorations nest the other way
  round. The check written for it found that; look at the rendered DOM before writing a selector
  for nested decorations.
- **A fake settings message does not last.** A check that hands the editor its options in a
  made-up message loses them at the host's next reply, which carries the real ones. Change the
  real setting in the test profile and wait for the editor to receive it.
- **The browser decides when a focus ring shows.** Whether a focused element counts as
  focus-visible depends on what was done last, so a check that only opens a menu may or may not
  see the ring. Force the state through the debugging protocol and assert that it was forced.
- **A package ships whatever is not excluded.** An exclusion list let a 680 KB fixture, compiled
  tests and source maps ride along for months. The package is built from an allowlist now.

## Session continuity

Long conversations lose detail when an agent's context is compacted. The answer is a committed
journal per session in [docs/sessions](sessions/README.md), written as the work happens:

- **Checkpoint** at decisions and answers, milestones and commits, before long autonomous work,
  when the context nears compaction, and at session end. Skip it when nothing new happened.
- **Record selectively:** decisions with IDs, rejected options with the reason, findings that
  change the plan, and task state, all as facts about the project. Link to documents and commits
  instead of repeating them.
- **Promote:** durable facts move to the document that owns them, and the journal marks where
  they went. Closing a session promotes everything still pending.

In Claude Code the `session-journal` and `update-docs` skills carry the judgment, and
deterministic hooks measure context use, say when a checkpoint is due, protect the conversation's
exact wording inside the compaction summary without writing it to any file, and re-inject the
journal afterwards. Details: [.claude/README.md](../.claude/README.md).

## Plans and reusable prompts

For work spanning sessions, create one short plan in `docs/plans/` from the template there. No
other backlog format is needed.

Example defect request:

> In the live editor, Delete on an already-empty selected row leaves the row in place; the README
> says it removes it. Reproduce it first, in a unit test if the planning logic is pure, otherwise
> as a focused case in the visual check. Fix it, run the gates in TESTING, open both screenshots,
> install, and report exact results.

Example review request:

> Review the current diff against the invariants in AGENTS.md. Trace every path that can write
> the document or touch table source. Report reproducible findings with file locations and
> impact; label uncertainty. Do not change code.

Example suite-repair request:

> Take item (a) of Q09. Show what the editor does, what the check expects and what the README
> says. Once the intended behavior is settled, fix the side that is wrong and record the outcome.

Example resumption request:

> Read PROGRESS and the open session journal, inspect the working tree, verify the recorded
> state and continue with the next step. Preserve unrelated changes and open questions.

## Dependency review

Adding, upgrading or removing a runtime dependency needs approval first. Before proposing one,
establish: the license of the exact version; whether it lands in the webview bundle, the host
bundle or neither; its size cost; any network access, telemetry or update check (none is
acceptable in the webview, whose policy allows no connections); install scripts; and its release
history. Pin the exact version. After installing, `npm ci` must succeed from the lockfile,
`npm test` must pass its bundle check, and `node scripts/record-markdown-bundle-impact.mjs` must
finish without a missing-license error. The `add-dependency` skill walks this list.

## Review priorities

Trace these project-specific failure classes before cosmetic issues:

- A path that writes the document without host validation, changes text outside its claimed
  range, or acknowledges before applying; edits lost, duplicated or reordered.
- Rendering, selection, folding or a theme change that mutates source or marks the file dirty.
- Table source consumed, hidden or painted over by something other than the table; a caret or
  selection left inside hidden source.
- More than one Undo step for one action; any second history.
- Geometry from host-computed metrics; margins on block widgets; a viewport plugin supplying
  layout-changing decorations; a loosened tolerance or calibration.
- Races: focus microtasks, effects during composition or pointer gestures, requests that outlive
  a hidden or disposed panel, observers and timers that are never released.
- Whole-document parsing or copying on caret movement or scroll; unbounded caches.
- A changed Content Security Policy, document text assigned as HTML, a new link scheme, a
  network request, unsanitized clipboard HTML.
- An unbundled runtime dependency, a missing license notice, stale install markers, a file added
  to the package allowlist without a reason.
- Tests that do not prove their claim: weakened assertions, widened tolerances, arbitrary
  sleeps, harness screenshots presented as VS Code evidence, a test that reads `samples/`.
- Anything in a tracked file or commit message that the "Public repository" rules forbid.

Findings need a concrete scenario, a code location, the impact, and evidence or stated
uncertainty.

## Keep the instructions useful

AGENTS.md holds durable cross-tool rules; CLAUDE.md imports it and adds only tool-specific notes.
User-visible behavior lives in the README, the rendering model in the spec, decisions in
DECISIONS, the code map in ARCHITECTURE, the test plan in TESTING, workflow here, and current
facts in PROGRESS. Keep root instructions compact and load detail when relevant; the
documentation checker fails when AGENTS.md outgrows this project's own line budget.

When an agent repeats a mistake, prefer a test or a small checked script if the rule is
mechanical. Three such mistakes are already checked: naming commands and files that do not
exist, changing a fixture by accident, and committing a local path or a private name. Add prose
only when the missing information is contextual, and remove guidance that became wrong. Do not
add hooks, MCP servers, subagents or "agent teams" without an observed benefit.

At handoff record: date, scope, files, decision changes, exact checks and results, the installed
version, known failures and the next step.
