# Reliability audit: 2026-11-13

An audit of version 0.1.233 (commit 571ad93) for defects that lose input, let the editor and the
document disagree, or stop the editor from working. Nothing was changed in the product. Each
finding says whether it was reproduced or only read from the code.

Read in full: the host (`src/extension.ts`), the webview entry (`src/webview/liveEditor.ts`),
change validation and mapping, the table model, table source protection, table source writes,
table structure edits, list editing, and the code-highlighting start-up on both sides.

Not covered: document and table clipboard, range selection, the structure controls, composition
with a real input method, and anything on macOS.

## Summary

| # | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | A save that crosses an unanswered edit rolls that edit back in the editor; the next keystroke is rejected and lost | Reproduced in a real VS Code window | Lost keystrokes and a conflict warning during ordinary typing |
| 2 | A document VS Code treats as read-only accepts typing | Reproduced in a real VS Code window | An in-memory document is modified where the stock editor refuses |
| 3 | The host keeps up to 201 full copies of each document and never releases them | Measured in Node; the retention read from the code | Memory grows with document size and with every document opened |
| 4 | Document text can stop the start-up script; a highlighter failure stops the editor | Parsing reproduced in a browser replica; the rest read from the code | A blank or failed editor, in uncommon configurations |

## 1. A save can cost the next keystroke

**Mechanism.**

1. The host's `onDidChangeTextDocument` handler posts `setDocument` for every event that its own
   apply did not cause, including events without a content change. VS Code raises such an event
   whenever a document's dirty state changes, so every save sends the whole document to the
   webview with a new revision.
2. In `handleHostMessage`, a snapshot whose source is `host` replaces the editor text
   unconditionally, also while `pendingWebviewEchoes` holds edits the host has not answered.
3. When the snapshot was produced before the host processed an edit that was already on its
   way, the editor rolls that edit back. The host then receives the edit, finds its before-text
   still matching, applies it and acknowledges it. `acknowledgeWebviewEcho` compares the
   acknowledgement with the claim, not with the editor, so nothing puts the text back.
4. The editor is now one edit behind the document. The next edit fails validation with
   `before-text-mismatch`: it is rejected, the editor is refreshed, and the warning about a
   conflicting edit is shown. That keystroke is gone.

**Measurements.** A real VS Code window on Windows with the development build and an isolated
profile; edits were dispatched to the editor one at a time. `files.autoSave` was `afterDelay`
with a delay of 1000 ms.

- Every save produced two `host` snapshots with unchanged text, 1015 to 1029 ms after the edit
  that made the document dirty (4 of 4 samples).
- A second edit was typed a chosen interval after the first. Of 33 undisturbed trials, 13 left
  the editor without the second edit while the document had it; their intervals were 1018 to
  1031 ms. No trial above 1031 ms did (17 trials, 1034 to 1046 ms). In all 13, the next edit was
  rejected and missing from the document. Nine more trials were disturbed by the recovery from
  the trial before them and are not counted.
- 500 edits 6 ms apart with a save about every 90 ms: 45 saves, 33 rejections, 33 edits missing.
- 180 edits at nine a second with a save every 650 ms: 34 saves, 3 edits missing.
- The same on a 651,653-character copy of `test/fixtures/gutter-stress.md`, where an
  acknowledgement takes 23 to 25 ms: 150 edits, 31 saves, 6 edits missing.
- The warning shown was the one for a conflicting edit refreshed from the saved document.

The window is the round trip between the two sides, so it widens with document size: every
edit carries the full text twice and every answer carries it once.

**Proposed, not approved.** Post from the host only when an event has content changes. In the
webview, when an acknowledgement empties the pending list and the editor text differs from the
acknowledged text, apply the acknowledged text. Both touch the edit path, so the change needs a
host check that fails first, and a review against the invariants.

## 2. Read-only documents accept typing

- With `files.readonlyInclude` matching the file, text sent to the stock editor was refused.
  The same input in the live editor was inserted, sent to the host, applied and acknowledged.
  The file on disk was unchanged and the document was modified in memory.
- The webview never sets CodeMirror's read-only or editable state. The host's read-only result
  (`isDocumentKnownReadOnly`) switches off task toggles, list commands, properties, selection
  wrapping and table cell editing only, and the host checks it only for task toggles.
- Not tested: a file the extension itself reports as read-only, and a read-only file system.
  Whether an extension can see setting-based or session read-only state is not established.

## 3. History snapshots are not bounded by size or by session

- `HistoryAvailability` (`src/shared/historyAvailability.ts`) keeps up to 201 full texts per
  document so the Undo and Redo buttons can be enabled. The provider's `historiesByDocument`
  map gains an entry for every document opened in the live editor and never removes one.
- Measured in Node with the compiled class: 201 snapshots of the 651,653-character fixture held
  125 MB at one byte per character. Text outside Latin-1 takes two.
- The webview also keeps up to 200 full before-texts for restoring focus after Undo, and up to
  100 unanswered texts.
- For a note of 20 KB this is a few megabytes. It matters for large documents.

## 4. Start-up can be stopped by content or by the highlighter

- `getEditorHtml` writes the document into an inline script as JSON and escapes only the
  closing script tag. Under the HTML parsing rules, `<!--` followed later by `<script>` leaves
  the parser in a state where the closing tag no longer ends the element, until a `-->`
  appears. A browser replica of the shell confirmed it: with such a document and no
  highlighting data the scripts never ran; with highlighting data containing `-->` they ran.
  Grammar data normally follows the document and contains `-->`, so this needs a document with
  that text and a session without highlighting data. Not reproduced in the editor.
- Read from the code, not reproduced: `initializeEditor` awaits the highlighter inside the
  start-up `try` block, so a highlighter that fails in the webview shows the start-up error
  instead of falling back to the bundled grammars. The host returns a configuration with an
  empty scope name when no installed extension contributes a Markdown grammar, which the
  webview rejects.

## What held up

- `npm run typecheck`: exit 0. `npm test`: exit 0, 25 of 25 unit test files and both bundle
  checks.
- Read without finding a defect: claim validation against the live document, verification
  between sequential groups, the conflict floor, table edit intents, the change filter at table
  boundaries, and line-ending mapping.
- In every run of finding 1 the document itself stayed consistent: text before the typed region
  was intact and the editor matched the document after the refresh. The loss is the rejected
  keystroke, not corruption.

The measurements came from a throwaway probe that is not part of the repository. No host suite
covers a save during typing or a read-only document.
