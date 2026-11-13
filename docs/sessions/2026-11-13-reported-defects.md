# Session 2026-11-13: reported defects

Status: open · Updated: 2026-11-13

## State now

- Working on: the eight defects reported against version 0.1.228 (A26) and the typing resize
  delay (A27). Seven defects are corrected and the setting exists; the blank editor after a
  minimized window is not reproduced. Evidence: milestone 6 in [PROGRESS](../PROGRESS.md).
- Next step: the corrections need use with the real applications the paste reports came from;
  then the next steps in PROGRESS. `npm run test:all` has not run as one command on this tree.
- Waiting on a decision: Q11, the default of the typing resize delay.
- Committed on `main`, not pushed: the corrections in `src/` and `media/` with the bundle, two
  new modules in `src/shared/` with their unit tests, the new host check
  `scripts/edh-editing-surface-check.mjs` and its npm script, the manifest entry for the
  setting, the version bump and the documents.
- Installed: 0.1.238, with these changes.

## Direction

- 2026-11-13 → A26: eight defects reported against version 0.1.228 are to be corrected.
- 2026-11-13 → A27: table column resizing while typing can be delayed by a setting.

## Checkpoints

### 1. Every defect but one reproduced in a real window

- Learned: a keystroke in a table cell replaces the text its highlight ranges were attached
  to, and the word at the caret reached the highlight through a selection event that arrives a
  frame or two later. In between the old word, which no longer matches, was the query: two or
  three frames without a highlight on every key.
- Learned: the gutter has no rule against selection and is outside CodeMirror's content, so a
  drag there was the browser's own and selected the numbers.
- Learned: a menu takes focus when it opens, and the browser draws its own focus ring around
  it, in the browser's color, whenever it counts that focus as one to mark.
- Learned: rich content from a code editor is the plain text with colors. Converting it escapes
  every Markdown character. Rich content from a Markdown editor is a rendering; converting it
  gave underlined headings, three spaces after list markers, and a line that follows a list
  indented into the list.
- Learned: the hidden characters of a task marker sit at one point beside the checkbox. A click
  there lands on one of them, reveals the marker, and with the caret beside the check letter
  every word x was highlighted, with stray borders on the other checkboxes.
- Open: the blank editor after a minimized window. Three attempts painted at once on restore:
  four minutes minimized, one external edit while minimized, and 120 external edits to an
  80 KB document while minimized. The first frame came 3 ms after the window showed.

### 2. Corrections and their check

- Decided (agent): the cell highlight's query is read from the focused cell itself, and cells
  are repainted in a microtask after the change. The fill stays with the CSS Custom Highlight
  API; the border is one positioned box per match, only while the theme draws a border.
- Decided (agent): an occurrence in prose is square, as in a cell and in the stock editor.
- Rejected: positioned boxes for the fill. Above the text they cover it under an opaque theme
  color; below a cell they cannot show through a header or a focused cell.
- Decided (agent): Automatic paste takes the plain text when it is the source of the rich
  content. The rule is pure, in `src/shared/clipboardPasteSource.ts`, and answers no whenever
  it cannot show that, so a web page converts as before.
- Decided (agent): a pointer selection never ends inside a concealed task marker; the keyboard
  still walks in. A gutter gesture resolves to the start of the marker.
- Decided (agent): the typing resize delay defaults to 0. The default is Q11.
- Learned: a rule meant to hide highlights inside hidden syntax matched nothing, because the
  decorations nest the other way round. Hidden matches are skipped when decorations are built.
- Decided (agent): for the unreproduced defect, the editor no longer depends on a frame to
  become visible after start-up, it measures once when its window shows again, and it records
  how long the first frame took in the debug log.
- Checks: `scripts/edh-editing-surface-check.mjs`, new, failed in all seven sections on the
  build without the corrections and passes with them. `npm test`: 27 of 27 files and both
  bundle checks.
- Open: one run of the rendering check failed one check, the reveal of a task marker's source;
  to be repeated before it is believed.

### 3. Gates run, build installed

- Learned: the rendering check passed 25 of 25 when repeated. The single failure needs the
  window's focus, and keystrokes from outside reached a check's window in the same series.
- Decided (agent): text with a white-space style is taken as source only without paragraphs
  and without inline formatting, since word processors and messages keep white space too.
- Checks: the exact runs and their order are under milestone 6 in PROGRESS. Installed 0.1.238.
- Open: nothing was copied from the real applications; the reviewer subagent has not read
  the change; `npm run test:all` has not run as one command.
