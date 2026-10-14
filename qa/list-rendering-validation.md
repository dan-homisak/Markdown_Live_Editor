List rendering validation
=========================

Implemented hover/caret fold controls, blue collapse indicators, nested guides,
wrapped list indentation, and literal source reveal across bullet/task prefixes.
List folding includes every descendant block and retains nested fold state.
Bullets, checkboxes and single-digit ordered markers now share a two-column
slot, with at least four columns per nesting level. Checkboxes expand into the
complete source prefix when entered from either direction. Fold controls clear
the ancestor guides; bullet emphasis uses the guide's accent without a halo.
Rendered columns also honor custom editor letter spacing.
The text caret's nesting guide stays active independently of hover, including
arrow navigation with the pointer parked over ordinary prose or another list.
Highlight ownership is the current row's guide directly beneath its marker,
rather than the parent guide one level to the left. Leaf rows do not activate
an ancestor's guide when no guide exists beneath their own marker.

Validation performed in an isolated VS Code Extension Development Host:

- `npm test`: passed, including new list ownership, fold mapping, sibling,
  deleted-parent, EOF, mixed-list, code/quote/table descendant tests.
- `node scripts/edh-visual-check.mjs`: passed stock/live geometry and editing
  regressions. Inspected `edh-stock.png` and `edh-live.png` in the same layout.
- `node scripts/edh-markdown-release-check.mjs --lists-only`: 9/9 passed.
  Inspected hover, collapsed, task-source, nested-block and wrapped screenshots.
  Gutter width stayed 68.325 CSS px before/after folding; hidden source line
  numbers disappeared. Wrapped guide endpoints matched their row boxes.
- The original eight list checks pass with `--large-metrics` (20px font, 30px line
  height, 1px letter spacing). Marker/label columns and guides align within
  0.5 CSS px. Caret targets clear the ancestor guide by at least 3 CSS px.
- The caret-guide regression passes across three nesting levels, up/down arrow
  navigation, simultaneous hover, pointer exit, task and ordered lists, and
  leaf rows and return to ordinary prose. It checks the exact current-row guide
  identity. Inspected `edh-markdown-release-lists-caret-guide.png`
  and `edh-markdown-release-lists-caret-and-hover-guides.png` in VS Code.
- `node scripts/edh-markdown-rendering-check.mjs`: 25/25 passed. The three
  previously reported failures are fixed: offscreen controls lose their DOM
  ownership, unsafe bidi text returns checkbox focus to source, and injected
  presentation failure removes marker decorations while preserving editable
  source and tables. Ordinary task-prefix arrow navigation also passes.
- Marker geometry checks pass at 20px with 1px letter spacing, zoom level 1,
  and a narrow editor. Source reveal intentionally shifts labels; leaving the
  prefix restores the exact rendered glyph positions and wrapping.

The focused checks preserve Markdown source exactly while folding. They cover
bullet, ordered and checkbox lists, retained child folds, keyboard traversal,
all task-prefix caret boundaries, continuation paragraphs, callouts, code and
rendered tables. No actual OS IME or screen reader was exercised.
