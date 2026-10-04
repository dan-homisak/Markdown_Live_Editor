# Live Markdown Rendering Design Specification

Status: proposed  
Audience: implementation agents and maintainers  
Scope: the next phase of Markdown Live Editor, extending live rendering around the existing table editor; tables themselves are explicitly out of scope

## 1. Product direction

Markdown Live Editor shall feel like editing Markdown source on GitHub, enhanced with restrained live-rendered affordances.

The editor is not a conventional preview and shall not try to make the document look like a published page. It is a source-first editor. Markdown punctuation, source order, line numbers, cursor movement, selection, and editing behavior remain understandable at all times. Friendly rendering is added only where it makes the source easier to scan or interact with.

The intended visual hierarchy is:

1. VS Code supplies the editor geometry, configured typography, selection mechanics, and host integration.
2. GitHub Dark Default and GitHub Prettylights supply the exact colors and source-highlighting character: monospace source, blue structural syntax, yellow list markers, muted punctuation, and restrained emphasis.
3. Live rendering supplies compact semantic affordances such as checkboxes, bullets, rules, callout accents, and code-block chrome.

The result should feel like “raw GitHub Markdown, made friendlier,” not like a rendered document with an editing mode.

## 2. Non-negotiable design contract

### 2.1 Tables are always rendered and are not part of this design phase

Tables are the foundational exception to the source-first presentation described elsewhere in this document.

- As soon as the existing table parser recognizes valid table Markdown, the source range must be replaced by the existing rendered table editor.
- A recognized table never reveals raw table Markdown because of focus, cursor movement, selection, editing, an active-row state, or any general “show source” behavior.
- Users edit recognized tables only through the existing rendered table UI.
- All existing table editing, selection, clipboard, structure controls, source protection, line-number ownership, wrapping, layout, colors, borders, spacing, hover states, focus states, and styling remain exactly as they are.
- This phase must not add a new table feature, remove a table feature, restyle a table selector, or reinterpret table source.
- New Markdown parsers, decorations, commands, and CSS must treat every recognized table range and every `.mlrt-table-*` element as a protected exclusion zone.
- A future table-only design document will own all table decisions. This document has no authority to change them.

“Source-engaged state,” “reveal syntax,” and similar rules in this document apply only to non-table Markdown. They never apply to a recognized table.

### 2.2 One canonical line rhythm

All editor text uses the same canonical font size and line height, derived from the current VS Code editor settings and injected `--mlrt-editor-*` variables.

- Headings do not become larger and do not increase line height.
- Lists, quotes, callouts, code blocks, rules, and inline formatting do not add vertical margins.
- Decorative borders and backgrounds must be inset, overlaid, or drawn inside the existing visual rows. They must not add vertical padding or border width to layout.
- Every text row, including code and callout rows, uses `--mlrt-editor-line-height`.
- Wrapped text may occupy additional visual rows, exactly as it does in the stock editor. Every wrapped row still uses the canonical line height, and continuation rows do not receive a new source line number.
- A multiline source construct occupies the visual rows implied by its source lines and wrapping. Rendering must not collapse several source lines into one tall replacement block.
- The gutter must remain continuous. A line number must never shift vertically merely because the source line is a heading, list item, fence, quote, or callout.

The fixed rhythm requirements govern all new non-table renderers. Existing rendered tables retain their current geometry without modification.

### 2.3 Stable geometry while editing

Moving the caret into an element must not cause surrounding content to jump.

- Active and inactive states must have the same height.
- Replacing a source token with a friendly control is allowed only when the replacement reserves a predictable width and source mapping remains exact.
- Revealing hidden or transformed syntax must not change vertical geometry. Horizontal movement should also be minimized; width-preserving swaps are preferred.
- Incomplete or malformed Markdown must fail open to ordinary editable source rather than producing a broken widget.

### 2.4 The Markdown source is authoritative outside recognized tables

- The underlying document remains standard Markdown at every point in an edit.
- Decorations and widgets must not own canonical content.
- Copy, cut, paste, undo, redo, find, selection, diagnostics, and host synchronization operate on source text.
- Interactive controls, such as task checkboxes, edit the smallest corresponding source range in one undoable transaction.
- No live rendering may make valid source unreachable by keyboard.

Recognized tables are the deliberate exception: their Markdown remains the persisted backing data, but it is never exposed as direct editor source. Existing table controls are the only editing surface.

### 2.5 Non-table source remains visually legible

Source syntax should remain visible by default when it is useful to understanding the document. The heading marker is the clearest example: `#` characters remain visible.

Syntax may be visually transformed only when the transformed form is substantially friendlier and unambiguous:

- unordered list marker to bullet glyph;
- task marker to checkbox;
- thematic-break marker to horizontal rule;
- optional compact image or link affordance.

When syntax is transformed, placing the caret in its source range reveals the exact characters or otherwise provides character-accurate editing without changing line height.

### 2.6 Exact GitHub Dark Default color system

The target is a literal GitHub Dark Default palette, not a theme-aware approximation. New non-table Markdown rendering must use the exact values in Section 3. Do not substitute nearby VS Code theme variables, the older `#58a6ff` accent palette, hand-tuned alternatives, or `color-mix()` approximations.

- Keep the user’s configured VS Code editor font family, font size, letter spacing, and canonical line height. Color fidelity does not override editor-metric fidelity.
- The reference review environment must use the GitHub Dark Default host theme so the surrounding editor canvas matches the target palette without changing existing table styling.
- New Markdown color tokens must be scoped to non-table prose and generated non-table controls. Do not redefine existing `--mlrt-*` table tokens and do not place a global color rule on a selector inherited by `.mlrt-table-widget`.
- This specification defines the dark-default appearance. A light-theme design is a separate future decision.
- Operating-system forced-colors mode may override these hex values for accessibility. That is the only intentional color-fidelity exception in this phase.
- Meaning must not rely on color alone.

## 3. GitHub Dark Default visual specification

### 3.1 Research baseline and fidelity rule

The palette below was resolved from GitHub’s official Primer Primitives repository at commit [`f48bc063f7bc0fb3e447386a8c259650ce46dea8`](https://github.com/primer/primitives/tree/f48bc063f7bc0fb3e447386a8c259650ce46dea8), current on September 15, 2026. The relevant sources are the [default dark base palette](https://github.com/primer/primitives/blob/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/base/color/dark/dark.json5), [functional foreground/background/border tokens](https://github.com/primer/primitives/tree/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/functional/color), [Prettylights syntax tokens](https://github.com/primer/primitives/blob/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/functional/color/syntax.json5), and [CodeMirror component tokens](https://github.com/primer/primitives/blob/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/component/codeMirror.json5). GitHub’s official [GitHub VS Code Theme](https://github.com/primer/github-vscode-theme) was also reviewed to confirm how Primer roles map into an editor surface.

These values are frozen implementation inputs for this phase. Hex-letter casing has no visual meaning; lowercase is used consistently below. Alpha colors are written as `rgba()` so their intended compositing is explicit.

No new non-table Markdown color may be invented during implementation. If a missing visual role is discovered, it must be mapped to an existing color in these tables or added to this document from an official GitHub Primer token before use.

### 3.2 Foundation and editor colors

| GitHub token or role | Exact value | Required use |
| --- | --- | --- |
| `bgColor.default` | `#0d1117` | Reference editor canvas and ordinary source background |
| `bgColor.muted` | `#151b23` | Fenced code background and recessed non-table rows |
| `bgColor.inset` | `#010409` | Deep inset surface only when a true inset is required |
| `control.bgColor.rest` | `#212830` | Unchecked task-control fill |
| `control.bgColor.hover` | `#262c36` | Unchecked task-control hover fill |
| `fgColor.default` | `#f0f6fc` | Plain prose, strong/emphasis content, primary source text |
| `fgColor.muted` | `#9198a1` | Comments, secondary punctuation, quote markers, fence markers |
| `fgColor.disabled` | `#656c76` | Disabled or unavailable control content only |
| `fgColor.accent` / `fgColor.link` | `#4493f8` | Link labels, interactive links, NOTE title/icon |
| `bgColor.accent.emphasis` | `#1f6feb` | Markdown headings, checked-control fill, strong blue edge |
| `borderColor.default` | `#3d444d` | Code edges, rules, quote guides, unchecked controls |
| `borderColor.muted` | `rgba(61, 68, 77, 0.70)` | Quiet indentation guides and secondary separators |
| `codeMirror.selection.bgColor` | `rgba(56, 139, 253, 0.40)` | Non-table prose selection background |
| `codeMirror.activeline.bgColor` | `rgba(101, 108, 118, 0.20)` | Active non-table source line background |
| `codeMirror.cursor.fgColor` | `#f0f6fc` | Non-table text cursor |
| `codeMirror.lineNumber.fgColor` | `#9198a1` | Reference gutter line-number color |
| neutral muted fill | `rgba(101, 108, 118, 0.20)` | Inline-code fill and quiet generated-chip fill |

The existing editor and table implementation already own shared canvas, gutter, selection, and active-line styling. The values above define the target and may be applied to new non-table layers, but this phase must not recolor table-owned DOM or rewrite existing table tokens to achieve them.

### 3.3 GitHub Prettylights source colors

| GitHub Prettylights token | Exact value | Markdown use in this editor |
| --- | --- | --- |
| `syntax.comment` | `#9198a1` | HTML comments and secondary comment-like text |
| `syntax.constant` | `#79c0ff` | Constants, numbers, booleans, code language identifier |
| `syntax.constantOtherReferenceLink` | `#a5d6ff` | URL destinations, reference destinations, autolinks |
| `syntax.entityTag` | `#7ee787` | HTML tag names and regular-expression-like code tokens |
| `syntax.entity` | `#d2a8ff` | Types, declarations, footnote identifiers where semantic distinction helps |
| `syntax.storageModifierImport` | `#f0f6fc` | Ordinary code/source foreground |
| `syntax.keyword` | `#ff7b72` | Code keywords and frontmatter reserved literals |
| `syntax.string` | `#a5d6ff` | Strings, link destinations, frontmatter string values |
| `syntax.variable` | `#ffa657` | Variables, parameters, frontmatter keys |
| `syntax.stringRegexp` | `#7ee787` | Regular expressions and comparable special string content |
| `syntax.markup.list` | `#f2cc60` | Unordered markers, ordered markers, and list syntax |
| `syntax.markup.heading` | `#1f6feb` | Entire heading line, including visible heading markers |
| `syntax.markup.italic` | `#f0f6fc` | Emphasized content plus italic font style |
| `syntax.markup.bold` | `#f0f6fc` | Strong content plus bold font weight |
| `syntax.bracketHighlighterUnmatched` | `#f85149` | Clearly invalid or unmatched syntax when diagnostics are shown |
| `syntax.bracketHighlighterAngle` | `#9198a1` | Angle brackets and quiet structural punctuation |
| `syntax.sublimeLinterGutterMark` | `#3d444d` | Quiet structural marks and guide lines |

For fenced code language highlighting, use the Prettylights values above rather than colors from the user’s current VS Code syntax theme. The intent is a 1:1 GitHub Dark Default color result.

### 3.4 Semantic and callout colors

| Semantic role | Foreground/title | Strong edge | Muted row tint |
| --- | --- | --- | --- |
| NOTE / accent | `#4493f8` | `#1f6feb` | `rgba(56, 139, 253, 0.10)` |
| TIP / success | `#3fb950` | `#238636` | `rgba(46, 160, 67, 0.15)` |
| IMPORTANT / done | `#ab7df8` | `#8957e5` | `rgba(171, 125, 248, 0.15)` |
| WARNING / attention | `#d29922` | `#9e6a03` | `rgba(187, 128, 9, 0.15)` |
| CAUTION / danger | `#f85149` | `#da3633` | `rgba(248, 81, 73, 0.10)` |
| Severe/urgent auxiliary state | `#db6d28` | `#bd561d` | `rgba(219, 109, 40, 0.10)` |

The foreground, edge, and tint values are different official roles and must not be collapsed into a single approximate color.

### 3.5 Task-control colors

| State | Fill | Border or mark |
| --- | --- | --- |
| Unchecked, resting | `#212830` | `#3d444d` border |
| Unchecked, hover | `#262c36` | `#3d444d` border |
| Checked, resting | `#1f6feb` | `#ffffff` check mark |
| Checked, hover | `#2a7aef` | `#ffffff` check mark |
| Checked, active | `#3685f3` | `#ffffff` check mark |
| Keyboard focus | existing visible focus geometry with `#4493f8` color | no size change |

### 3.6 Overall visual composition

Under the GitHub Dark Default reference theme, the page reads as a flat `#0d1117` source canvas with `#f0f6fc` monospace text. There are no preview-page cards and no large typographic jumps. Semantic structure appears through precise source color, font style, thin inset edges, and quiet row backgrounds.

- Blue `#1f6feb` headings are the strongest recurring structural signal.
- Yellow `#f2cc60` list markers make list structure immediately scannable without turning the list into preview HTML.
- Muted `#9198a1` punctuation remains present but recedes behind content.
- Code areas form a compact `#151b23` band with `#3d444d` inset top and bottom edges.
- Links use bright `#4493f8` labels and pale `#a5d6ff` destinations.
- Callouts use one exact semantic color family while preserving every source row.
- All corners are restrained. Where a one-line control needs rounding, use a maximum radius of `6px`; do not introduce pill-shaped content except for an explicitly icon-sized control.
- Shadows are not part of the content design. Use only inset one-pixel edges needed to define code or control boundaries.
- No non-table element receives vertical margin or block padding.

## 4. Rendering states

The implementation should use two visual states without becoming a two-mode editor.

### 4.1 Resting state

The element is recognizable and compact while its source remains legible. Semantic controls may replace narrow marker ranges, and inline content may receive visual styling.

### 4.2 Source-engaged state

When the caret or a selection intersects transformed syntax, the exact source token becomes directly editable. The rest of the line may remain styled. Entering this state must not change the line’s height or move other lines.

This is a local token-level state, not a block-level switch. A paragraph, list, callout, or code block must not wholesale alternate between rendered HTML and raw source.

### 4.3 Tables have no source-engaged state

Recognized tables remain rendered while resting, focused, selected, edited, copied, pasted, resized, or structurally modified. A caret or selection approaching a table must enter the existing rendered table interaction model, never reveal the backing pipe-delimited source.

## 5. Element behavior

The following requirements define the intended first complete pass. “Marker” means Markdown punctuation; “content” means the human-readable text governed by it.

### 5.1 Headings

Example source: `## Deployment notes`

- Keep all `#` markers visible at all times.
- Color the marker, required following space, and heading content `#1f6feb`, matching GitHub Prettylights `syntax.markup.heading` exactly.
- Render the entire heading source span at `font-weight: 700`. The marker and text should look like one continuous GitHub source token.
- Keep the normal editor font size and canonical line height for every heading level.
- Distinguish levels only through marker count. H1 through H6 use the same `#1f6feb`, weight, font size, and line height.
- Do not add top or bottom margin, underline rules, or preview-style spacing.
- Setext heading text and its underline source use `#1f6feb` and `font-weight: 700`; the underline remains in its ordinary source row.

Visually, `## Deployment notes` should look almost exactly like that line in GitHub’s dark source view: two visible blue hash characters, one visible blue space, and blue bold text on the flat editor canvas. It must not resemble a large rendered `<h2>`.

### 5.2 Emphasis, strong text, and strikethrough

- Style content semantically: italic `#f0f6fc` for emphasis, bold `#f0f6fc` for strong text, and line-through `#f0f6fc` for strikethrough.
- Keep delimiter characters visible in `#9198a1` so they remain readable but quieter than their content.
- Nested combinations must compose without changing line height.
- Unmatched delimiters remain plain source.

### 5.3 Inline code

- Keep backticks visible in `#9198a1`.
- Render code content in `#a5d6ff` over `rgba(101, 108, 118, 0.20)`.
- Use no vertical padding. Horizontal inset may be simulated with an inline background or at most a very small width-preserving treatment.
- Inline code must not change the configured editor font metrics.
- The background may use a `3px` radius, but it must remain inside the existing line box and must not grow the source span.

### 5.4 Links and autolinks

- Keep Markdown brackets, parentheses, angle brackets, destinations, and titles visible.
- Render link labels in `#4493f8`, destinations and autolinks in `#a5d6ff`, and brackets/parentheses in `#9198a1`.
- Use an underline in the same foreground color for destinations and for link labels on modifier-hover. Do not use a second invented hover color.
- A normal click positions the caret. Modifier-click follows the link, matching VS Code conventions.
- Keyboard editing, selection, and source copying always operate on the literal Markdown.
- Reference links and definitions receive the same source-first treatment.

### 5.5 Unordered and ordered lists

- Render `-`, `*`, or `+` as a compact `#f2cc60` bullet in resting state. Reveal the literal marker, also in `#f2cc60`, when the caret intersects its source range.
- Keep ordered-list numbers visible in `#f2cc60`. Do not renumber them visually in a way that disagrees with source.
- Preserve indentation as source-backed horizontal geometry.
- Optional indentation guides use `rgba(61, 68, 77, 0.70)` and must not alter line height or intercept pointer input.
- Wrapped continuation text aligns with list content rather than with the marker.
- `Enter`, `Tab`, `Shift+Tab`, and backspace behavior should match Markdown list editing expectations and remain undoable.
- Marker transformations must reserve enough width to prevent the item text from shifting when raw syntax is revealed.

### 5.6 Task lists

- Transform `[ ]`, `[x]`, and `[X]` into a compact accessible checkbox in resting state.
- The checkbox fits entirely within the canonical line box and is aligned to the text baseline.
- Use the exact state colors in Section 3.5. The control is square with a `3px` corner radius; it is not a round switch or a pill.
- Use a one-pixel `#3d444d` border for the unchecked control. The checked control uses no additional outer border beyond its `#1f6feb` fill.
- Clicking it changes only the marker character range and creates one undo step.
- Keep item text `#f0f6fc` whether checked or unchecked. Do not force strikethrough, opacity, or a muted text color.
- Keyboard users can reach and toggle the checkbox, and the control exposes a useful accessible name and checked state.
- When the caret intersects the task marker, reveal the literal task syntax without moving the item text.

### 5.7 Blockquotes

- Keep `>` markers visible in `#9198a1`; quoted content remains `#f0f6fc`.
- Draw a one-pixel `#3d444d` vertical guide inside the line’s existing horizontal space, aligned consistently through consecutive quote lines.
- Do not add vertical margin or padding.
- Every quoted source line remains an ordinary independently numbered editor line.
- Nested quote depth is represented by repeated markers and, optionally, repeated subtle guides.

### 5.8 GitHub-style alerts and callouts

Recognize alert markers such as `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, and `> [!CAUTION]`.

- Keep the `>` and `[!TYPE]` source visible. The `>` remains `#9198a1`; the alert marker and title use the corresponding foreground from Section 3.4.
- Render the alert title at `font-weight: 600`. Use a 14px GitHub Octicon-equivalent semantic icon only if it fits inside the canonical line box; its fill is the title foreground.
- Draw a three-pixel inset left edge using the “Strong edge” color from Section 3.4 and apply the exact “Muted row tint” across every source line in the alert.
- Do not add the padding or margins used by GitHub’s fully rendered alert component. This editor borrows the exact colors and semantic iconography while compressing them into source-height rows.
- Subsequent callout lines retain their `>` source markers and line numbers.
- Use color plus text/iconography so the type remains understandable without color.
- Unknown alert types fall back to an ordinary blockquote.
- Collapsing callouts is outside the initial phase because it would hide source lines and violate continuous gutter behavior.

### 5.9 Thematic breaks

- In resting state, `---`, `***`, and `___` become a one-pixel `#3d444d` horizontal rule drawn through the vertical center of the existing source row.
- When the caret intersects the marker, reveal the exact source characters.
- The rule must not add margins, padding, or an extra row.
- The active/source-engaged appearance should combine visible punctuation with a subtle remaining rule when that can be done without obscuring text.

### 5.10 Fenced code blocks

Fenced code blocks must feel like code without turning into a large preview card.

- Preserve one editor row per source line, plus ordinary wrapping behavior.
- Apply one continuous `#151b23` background band to the fence and content lines.
- Draw `#3d444d` one-pixel inset top and bottom edges on the opening and closing fence rows. Borders must not affect layout.
- Add no vertical margin or vertical padding.
- Keep opening and closing fences visible in `#9198a1`; do not hide or replace them.
- Style the optional language identifier in `#79c0ff`.
- Code content uses the editor’s configured monospace font and canonical line height.
- Apply language-aware highlighting with the exact GitHub Prettylights colors in Section 3.3 without replacing source or changing metrics.
- A copy action is optional. If included, it must be an overlay contained within the opening-fence row, use `#212830` resting fill, `#262c36` hover fill, `#3d444d` border, and `#f0f6fc` icon; it copies only code content and never reserves vertical space.
- Empty, incomplete, or unclosed fences remain editable and use predictable source styling.
- Indented code blocks receive the code background treatment but do not invent fence controls.

### 5.11 Images

Full inline image previews are incompatible with the fixed line rhythm and are not part of the default editor surface.

- Keep image Markdown source visible. Use `#4493f8` for alt text, `#a5d6ff` for destination, and `#9198a1` for punctuation.
- A compact one-line icon or chip may indicate that the destination is an image.
- An optional hover preview may float above the editor without changing document layout.
- Missing files, remote loading, and unsafe URLs must not disturb editing or line geometry.

### 5.12 HTML, escaped syntax, entities, and comments

- Raw HTML remains source. Tags use `#7ee787`, attribute/type-like entities use `#d2a8ff`, strings use `#a5d6ff`, and punctuation uses `#9198a1`; it is not mounted as live DOM.
- Escaped Markdown punctuation must not be transformed.
- Entities may be syntax-highlighted, but source remains visible.
- HTML comments remain source in `#9198a1`.
- Never execute scripts, event attributes, embedded web content, or arbitrary HTML from the document.

### 5.13 Frontmatter, footnotes, and unsupported extensions

- YAML frontmatter remains compact source: delimiters and punctuation `#9198a1`, keys `#ffa657`, strings `#a5d6ff`, reserved literals `#ff7b72`, and numeric/boolean constants `#79c0ff`. It is not replaced by a metadata panel.
- Footnote markers and definitions use `#d2a8ff` for identifiers, `#4493f8` for interactive labels, and `#9198a1` for punctuation while remaining fully visible.
- Unsupported Markdown extensions remain editable source and must not break nearby decorations.
- Mermaid and other fenced extensions use the normal fenced-code treatment in this phase; diagram rendering would violate the default fixed-line editor surface.

### 5.14 Tables

The existing rendered table editor is the only permitted table experience.

- The instant the existing parser detects a valid table, render the existing `TableWidget` and hide/protect the backing source exactly as today.
- Never provide a raw-table fallback, source-engaged table mode, temporary pipe-source reveal, or direct source editing command.
- New Markdown decoration logic must skip the entire table source range.
- New CSS must not target `table`, `thead`, `tbody`, `tr`, `th`, or `td` generically; every new selector must be scoped so it cannot reach `.mlrt-table-widget` descendants.
- Do not alter inline Markdown rendering inside table cells in this phase.
- Zero visual difference in the rendered table is the acceptance target. A separate table-only document will define any future table work.

## 6. Interaction and editing requirements

### 6.1 Cursor and pointer mapping

- Outside recognized tables, left/right movement traverses literal source positions in a predictable order.
- Up/down movement preserves the preferred horizontal column across ordinary and decorated lines.
- Clicking rendered text places the caret at the corresponding source character, not merely at the start or end of the block.
- Clicking transformed marker chrome resolves to that marker’s source range.
- Movement into a recognized table transfers control to the existing table navigation behavior without revealing table source.
- Drag selection can cross any combination of plain lines, decorated lines, code blocks, callouts, and existing table widgets without becoming trapped and without changing table behavior.

### 6.2 Selection and clipboard

- Selected non-table text represents the underlying Markdown source. Table selections continue to use the existing table selection and clipboard model.
- Selection painting remains visually continuous across styled spans.
- Non-table copy and cut preserve exact source unless an existing explicit rich-copy command says otherwise. Table copy/cut remains exactly as currently implemented.
- Decorations must not leak generated glyphs, labels, icons, or control text into plain-text copy.

### 6.3 Editing and source synchronization

- Every source edit continues through the current CodeMirror-to-extension-host synchronization path.
- IME composition, dead keys, Unicode, multi-cursor edits, undo/redo, paste, and host-originated changes must work with decorations enabled.
- Decoration updates must not move focus or reset a composition.
- Parsing and decoration must be incremental enough that typing remains responsive in large files.

### 6.4 Accessibility

- Generated controls are keyboard reachable only when they perform an action; purely decorative elements are ignored by assistive technology.
- Interactive widgets expose an accessible role, label, state, focus appearance, and sufficiently large pointer target without enlarging the line box.
- Forced-colors mode uses system colors and visible outlines.
- Syntax remains understandable without relying only on hue.
- Reduced-motion users should encounter no transition-driven movement; the initial design should use little or no motion.

## 7. Recommended implementation architecture

### 7.1 Decoration-first, line-preserving rendering

Use CodeMirror 6 syntax-aware decorations for all new non-table Markdown rendering:

- mark decorations for color, weight, emphasis, inline backgrounds, and delimiter treatment;
- line decorations for code, quote, callout, and frontmatter backgrounds or inset edges;
- small replace/widget decorations only for width-controlled markers such as bullets, checkboxes, and thematic breaks;
- atomic ranges only where a generated control replaces an exact source token and cursor behavior is explicitly handled.

Do not use multiline HTML replacement widgets for ordinary Markdown blocks. They obscure source, complicate cursor mapping, and make fixed gutter rhythm difficult to guarantee.

This restriction does not apply to the existing `TableWidget`. Tables must continue to use their current multiline replacement widget because always-rendered table editing is a permanent product requirement.

The useful pattern from the experimental Meeting Minutes project is its source-backed, single-line transform approach and continuous treatment of fenced-code source lines. Its inactive full-block HTML replacement approach should not be carried into this editor.

### 7.2 Parsing

- Prefer the syntax tree already produced by `@codemirror/lang-markdown` as the structural source of truth.
- Give the existing table detector first ownership of recognized table ranges. General Markdown decoration must not parse through, decorate, or partially claim those ranges.
- Add narrowly scoped recognition for GFM tasks, alerts, strikethrough, and other extensions only where the base parser does not expose sufficient nodes.
- Avoid parsing the entire document with a second renderer on every keystroke.
- Derive decorations from source ranges, never from rendered HTML offsets.
- Fail open when a node is incomplete or ambiguous.

### 7.3 Suggested module boundaries

The exact filenames may change, but responsibilities should remain separated:

- `src/editor/markdown/markdownDecorations.ts`: composition root and CodeMirror extension.
- `src/editor/markdown/markdownDecorationState.ts`: incremental parse/decorate state.
- `src/editor/markdown/inlineDecorations.ts`: headings, emphasis, links, inline code, and delimiters.
- `src/editor/markdown/blockDecorations.ts`: quotes, alerts, rules, code fences, and frontmatter.
- `src/editor/markdown/listDecorations.ts`: lists, tasks, indentation, and marker widgets.
- `src/editor/markdown/markdownInteraction.ts`: checkbox toggles, modifier-link open, and marker hit mapping.
- `src/editor/markdown/markdownTheme.ts`: semantic class names and token mapping, or corresponding additions to `editorTheme.ts`.
- `src/editor/markdown/markdownRanges.ts`: shared range classification and hard table-exclusion logic.

Keep document mutation logic independent from DOM widgets so it can be unit tested without a browser.

### 7.4 Styling rules

- Centralize the exact Section 3 values under a non-table scope with an `--mlrt-github-dark-*` prefix. Values are literal colors, not VS Code variable aliases.
- Keep static styles in `media/liveEditor.css` and geometry-dependent values in injected `--mlrt-editor-*` properties.
- Do not modify an existing `.mlrt-table-*` rule. Do not use element selectors or inherited global custom-property changes that can restyle the existing table widget.
- Never use a bare `table`, `thead`, `tbody`, `tr`, `th`, or `td` selector for this phase.
- Prefer inset `box-shadow`, layered `background-image`, and pseudo-elements over layout-affecting borders or padding.
- Every Markdown line class must explicitly inherit the canonical font metrics.
- Generated widgets must use `box-sizing: border-box`, fit inside one line box, and avoid changing CodeMirror’s block height measurement.

## 8. Delivery sequence

### Phase 0: fixtures and invariants

- Add a comprehensive Markdown fixture containing every supported construct, malformed/incomplete variants, nesting, wrapping, and content adjacent to tables.
- Capture rendered-table baseline screenshots and computed style snapshots before implementing any new Markdown decoration. Treat them as immutable regression fixtures.
- Add automated measurements for line height, gutter alignment, first-line position, selection geometry, and no vertical jump when the caret enters or leaves syntax.
- Record stock-editor and live-editor screenshots in the same Extension Development Host layout.

### Phase 1: source styling and inline semantics

- Headings with visible markers, blue accent, bold content, and unchanged metrics.
- Emphasis, strong text, strikethrough, inline code, links, escapes, and comments.
- Exact GitHub Dark Default color, forced-colors, selection, cursor, and IME verification.

### Phase 2: line-level controls

- Unordered and ordered lists.
- Interactive task checkboxes.
- Blockquotes and thematic breaks.
- Keyboard navigation and width-stable source reveal.

### Phase 3: multiline visual continuity

- Fenced and indented code blocks.
- GitHub-style alerts/callouts.
- Frontmatter styling.
- Wrapped-line, viewport, and large-file performance checks.

### Phase 4: secondary syntax and hardening

- Images, reference definitions, footnotes, and safe unsupported-syntax fallback.
- Mixed selections across prose, decorated blocks, and tables.
- Regression, accessibility, cross-platform, and GitHub Dark Default fidelity coverage.

## 9. Acceptance criteria

The phase is complete only when all of the following are true:

1. Headings, including H1 and H6, have the same computed font size and line height as ordinary editor text.
2. Computed non-table colors match the exact Section 3 values; screenshots contain no legacy `#58a6ff` substitution or host-theme approximation for specified roles.
3. The vertical distance between equivalent unwrapped source lines is constant across plain text, headings, lists, tasks, quotes, alerts, rules, and code lines.
4. Gutter line numbers remain aligned before, inside, and after every decorated multiline construct.
5. Moving the caret into or out of a transformed marker produces no vertical layout shift.
6. Every transformed non-table token can be edited character-accurately by keyboard.
7. Clicking a task checkbox creates the correct Markdown edit and one undo step.
8. Normal link clicks position the caret; modifier-click opens the destination.
9. Copying a non-table selection yields source Markdown and excludes generated UI text.
10. Incomplete headings, lists, links, task markers, fences, alerts, and emphasis delimiters remain editable and do not throw.
11. Selection and cursor painting work across styled lines and table boundaries.
12. Every recognized table is rendered immediately and remains rendered through focus, selection, editing, clipboard operations, undo/redo, and navigation.
13. No command or caret position exposes recognized table pipe source for direct editing.
14. Before/after rendered-table screenshots and computed table styles show zero intentional visual differences.
15. The existing rendered table test suite and direct visual checks still pass unchanged.
16. GitHub Dark Default, forced-colors, line-wrapping, non-default font-size, and non-default line-height configurations are verified. Other color themes are not parity targets for this phase.
17. The live editor remains responsive on a large fixture; decoration work is limited to changed syntax ranges and/or the visible viewport where practical.
18. `npm run compile`, the automated test suite, and the same-window Extension Development Host visual checks pass with no red Problems diagnostics in touched files.

For geometry checks, use a tolerance of at most 0.5 px where the existing visual-parity tooling uses measured browser coordinates.

## 10. Explicit non-goals for this phase

- Making the editor look like GitHub’s rendered README view.
- Enlarged preview-style headings.
- Vertical document spacing based on semantic block type.
- Full-size inline image, Mermaid, math, media, or arbitrary HTML rendering in the editing flow.
- Collapsing source lines inside callouts, code blocks, or frontmatter.
- A separate edit/preview mode.
- Any table behavior, styling, rendering, or interaction change.
- Showing recognized table source, even temporarily.
- Adapting the specified Markdown colors to arbitrary VS Code themes. GitHub Dark Default is the deliberate color target; forced-colors accessibility remains the exception.

## 11. Design decision rule

When requirements conflict, use this order:

1. Keep recognized tables always rendered and preserve the existing table implementation without visual or behavioral changes.
2. Preserve non-table source correctness and editability.
3. Preserve canonical line rhythm and gutter continuity.
4. Preserve cursor, selection, clipboard, undo, and accessibility behavior.
5. Match the exact GitHub Dark Default colors and GitHub source appearance.
6. Add friendly semantic rendering.

If an enhancement cannot satisfy the first four priorities, leave that non-table syntax as styled source until a line-preserving interaction is designed. Never resolve a conflict by exposing or restyling table source.
