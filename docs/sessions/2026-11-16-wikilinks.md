# Session 2026-11-16: wikilinks in a workspace folder

Status: open · Updated: 2026-11-16

## State now

- Working on: step 1 of wikilink support (A31) is built, reviewed twice and verified:
  milestone 8 in [PROGRESS](../PROGRESS.md).
- Next step: the later steps in P12, each after its own approval. Before any of them, the two
  facts about Obsidian in Q12 and Q13 are worth checking in the application.
- Waiting on a decision: nothing blocks. P12 is proposed, Q12 and Q13 are open.
- Uncommitted: nothing. Milestone 8 is committed on `main` and not pushed.
- Installed: 0.1.246, the committed tree.

## Direction

- 2026-11-16 → A31: wikilinks behave as they do in Obsidian, with the workspace folder that
  holds the document as the vault, and nothing is stored on disk for it. The first step is
  lookup in a listing of the folder, dimmed links to missing notes, and links that open in the
  live editor.
- 2026-11-16 → A31: a path from the folder's root wins over the note beside the linking note,
  and several notes of one name never raise a question. This replaced the documented lookup
  beside the file first and the picker.

## Checkpoints

### 1. What existed and what the first step is

- Learned: wikilinks were already parsed, hidden at rest and opened, by a lookup beside the
  file and then a workspace search that asked when several notes matched. Links in table cells
  are not rendered at all.
- Decided: A31. Later steps are P12; embeds stay out under A11.
- Open: Q12, the order among same-named notes when none is at the root or beside the linking
  note; Q13, how a heading link is shown at rest. Obsidian's help settles neither.

### 2. Built, then reworked after review

- Decided (agent): the lookup is a pure function over a list of paths
  (`src/shared/wikiLinkResolution.ts`); the host owns the list
  (`src/host/workspaceNoteIndex.ts`); dimming is a view plugin that asks the host.
- Learned: the command that opens a custom editor does not settle while VS Code replaces a
  preview tab. Awaited inside the edit queue, it stopped every later edit and link of the note
  the link was followed from. Found by running the host check with default tab settings. The
  host no longer waits for it, nor for a folder listing.
- Learned: VS Code turns `[label](command:...)` in a notification into a link that runs the
  command. A wikilink's name or heading reached one. Brackets are now removed from document
  text before it is shown. Found by the `invariant-reviewer`.
- Learned: a notification toast is drawn on an animation frame. A test window that another
  window covers draws none, shows the text in the status bar instead, and can stall checks
  that wait for a frame. One run of the core host check stalled this way and passed when run
  again; the unchanged commit passed as well.
- Learned: on macOS two host checks fail on the unchanged commit too, because they expect the
  Windows default line height of 18.9 px where macOS has 21 px. Recorded in TESTING.
- Rejected: waiting for the first folder listing when a link is followed. Edits queue behind a
  link request, and a search that never answers would hold them for ever.

### 3. Second review and what it changed

- Learned: the reviewer's second reading found two findings only partly resolved. A file
  search that never answers, and a first listing that fails, are now both recovered from: the
  search is given up after thirty seconds and tried again, a note beside the linking note
  opens before any listing exists, and a listing that works after one that did not tells the
  editors to ask again.
- Learned: opening the ordinary editor over a preview tab that held a live editor does settle,
  unlike the command for a custom editor. The wait was removed anyway.
- Learned: the preview-only host run is not steady on macOS. Of six runs in one day three
  passed all 15 checks and three failed between 2 and 6, different ones each time, one of
  those on the commit before this milestone. Not explained.
- Checks: the results of the final tree are in the Verification section of milestone 8.
