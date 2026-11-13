---
name: verify-change
description: Choose and run the checks a Markdown Live Editor change needs - unit tests, the host checks in a real VS Code window with their screenshots opened, the repository checks, and Build_and_Install - then report exact results. Use before saying a change works, before a commit, after any change under src, media, scripts or test, and when asked to verify or check something in the editor.
argument-hint: "[what changed]"
---

# Verify a change

Report only what you ran: exact commands, counts and exit codes. Name checks you skipped or
could not run, and why. Never weaken an assertion, widen a tolerance, skip a test or suppress an
error to get a pass. A failure you believe was already there has to be reproduced on the
unchanged tree before you call it pre-existing.

## 1. Pick the checks

`docs/TESTING.md` is the plan: "What a change needs" lists the suites per kind of change, and
"Suite status" says which host suites pass today. The short form:

| The change touches | Run |
| --- | --- |
| Any TypeScript | `npm test` |
| Anything visible: tables, gutter, layout, selection, clipboard, Undo | `npm run test:host`, with the screenshots opened |
| Table structure controls, switching editors | `npm run test:host:structure`, `npm run test:host:toggle` |
| Code highlighting | `npm run test:host:highlighting`. It times out on some runs: a "token colors timed out" ending means run it again, a reported mismatch is a real failure |
| Live Preview rendering, lists, links, properties | `npm run test:host`, `npm run test:host:rendering`, `npm run test:host:release`; then `npm run test:host:preview`, whose checks must all pass (its one known console warning is described in the status table) |
| Dependencies or bundling | `npm ci`, `npm test`, `node scripts/record-markdown-bundle-impact.mjs`, and the `add-dependency` skill |
| A fixture | The steps in `test/fixtures/README.md` |
| Agent documentation | `npm run check:docs` and `npm run check:privacy` |
| `.claude/hooks`, `.claude/settings.json`, the checkers | `npm run test:agent`, then run the changed hook by hand with sample JSON on stdin |
| Before a commit | `npm run test:all` |

There is no lint command and no CI. Say so; do not improvise a substitute and call it equivalent.

## 2. Host pass for anything visible

The standalone harness is not evidence. Use the real editor.

1. `npm run test:host`. It compiles first, opens a VS Code window and takes the foreground for
   under a minute. Run one host check at a time, and leave the window alone while it runs: some
   checks fail when it loses focus.
2. The exit code is the verdict. Also search the output for `ok: false` and for a `failures`
   list that is not empty.
3. Open the screenshots with the Read tool: `qa/edh-stock.png` and `qa/edh-live.png` always, plus
   the files named on the output's `Saved` lines for the area you changed. Compare the first
   line's position, the gutter numbers, table edges and row line numbers. Describe only what you
   saw.
4. For a suite that is not green, compare your run with the status table: a check that passes
   there must still pass, and a check listed as failing must fail the same way. A new failure is
   yours until you reproduce it on the unchanged tree.

Read "Visual parity" in `docs/ENGINEERING.md` before judging gutter, font, table or selection
geometry. Coordinate spaces differ between Monaco and the webview.

Screenshots, logs and result files land in `qa/`, which is ignored. They show local paths: never
commit them, attach them or copy paths out of them into a document.

## 3. Install

`./Build_and_Install` after every prompt that changed the repository; in a non-interactive
Windows shell use `node scripts/build-and-install.mjs`. It bumps the patch version, installs
from the lockfile, packages, reinstalls and checks the installed files. Success ends with a
`Verified:` line naming the installed version.

- Report that version. The window needs "Developer: Reload Window" to activate it.
- If it stops on "does not contain expected marker", first check whether the change renamed that
  symbol or class on purpose; then the marker list in the script needs the new name.
- Leave the version bump in `package.json` and `package-lock.json`.
- If the change added a file the extension loads at run time, it must be added to the allowlist
  in `.vscodeignore`, or it will not ship.

## 4. Report and record

- In the reply: one line per check with its result, then what was not run.
- Name manual coverage the change needed but did not get: OS input methods, a screen reader,
  macOS.
- At a milestone, record the evidence in `docs/PROGRESS.md`, and update the status table in
  `docs/TESTING.md` if a suite's status changed (`update-docs` skill).
- A failure you did not fix is reported plainly, with its output.
