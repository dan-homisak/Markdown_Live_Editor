# Session 2026-11-13: reliability audit

Status: open · Updated: 2026-11-13

## State now

- Working on: nothing in flight. The audit is in the
  [reliability audit](../reports/reliability-audit-2026-11-13.md). Its first finding, the save
  race, is fixed, reviewed and verified; the evidence is milestone 5 in
  [PROGRESS](../PROGRESS.md).
- Next step: the four open findings: read-only documents accept typing, the history snapshots
  are unbounded, start-up can be stopped by document text or the highlighter, and auto-save
  with trailing-whitespace trimming removes the space under the caret.
- Waiting on a decision: which of those four to fix.
- Committed on `main`, not pushed: the fix in `src/extension.ts` and
  `src/webview/liveEditor.ts` with its bundle, the new host check and its npm script, the
  lifecycle assertion, the report, the documents and the version bump. The reviewer subagent
  has read the change; its two findings in the webview step are fixed.
- Installed: 0.1.237.

## Direction

- 2026-11-13 → A24: the save race found by the audit is fixed.

## Checkpoints

### 1. Audit finished, four findings

- Learned: a save fires a document change event with no content change, and the host answers
  every such event with a full snapshot. A snapshot that crosses an unanswered edit rolls it
  back in the editor, and the acknowledgement does not restore it.
- Learned: the window is the round trip between the two sides, about 13 ms on a small file.
  The numbers, and the three other findings, are in the report.
- Learned: a host probe can produce the race on demand by typing a second edit 1018 to 1031 ms
  after the first with auto-save after 1000 ms. That is the shape of the regression check.
- Checks: `npm run typecheck` exit 0; `npm test` exit 0, 25 of 25 files and both bundle checks.
- Open: no host suite covers a save during typing or a read-only document.

### 2. Save race fixed

- Decided (agent): fix both sides. The host posts a snapshot only for content changes; the
  webview applies the acknowledged text when an acknowledgement leaves nothing unanswered and
  the editor differs.
- Rejected: ignoring host snapshots while edits are unanswered. The host checks type with host
  messages suppressed and then inject snapshots, so unanswered edits never drain there; and a
  lost answer would leave the editor deaf to external changes.
- Learned: letting the rollback's own pending focus entry drive the restore puts the caret
  after the restored edit. Without it the caret lands before the edit.
- Checks: `npm run test:all` exit 0 in 162 seconds; the new check also passes with `--crlf`.
- Open: the restore step does nothing during a composition; no input method was exercised.

### 3. Review findings fixed, one new finding

- Learned: the reviewer's two findings in the restore step both reproduce in the real window.
  A snapshot waiting for a composition to end was applied over the acknowledged text; in a
  table cell the caret came back one position early for two frames.
- Decided (agent): the acknowledged text replaces a snapshot that waits for a composition; the
  restore places a focused cell's caret itself and drops the focus requests waiting for a
  render. Only the restore raises the counter that drops them, so Undo behaves as before.
- Learned: placing the caret is not enough. The request the restore itself leaves for the next
  render moves the caret back behind a key typed in between; the frame-by-frame assertion in
  the check exists for that.
- Rejected: rebasing a composition that began on rolled-back text. It cannot be checked
  without a real input method; it stays a stated limit in PROGRESS.
- Learned: a save that changes text is a content change. With auto-save and trailing-whitespace
  trimming, the space under the caret is trimmed; the numbers are under known gaps in PROGRESS.
- Checks: `npm run test:all` exit 0 in 171 seconds; the check also passes with `--crlf`.
- Open: the trimming finding has no check in the repository; its numbers come from a probe.
