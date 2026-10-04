# Live Markdown Rendering Design Specification

Status: proposed  
Audience: implementation agents and maintainers  
Scope: the next phase of Markdown Live Editor, extending live rendering around the existing table editor; tables themselves are explicitly out of scope

## 1. Product direction

Markdown Live Editor shall feel like editing Markdown source on GitHub, enhanced with restrained live-rendered affordances.

The editor is not a conventional preview and shall not try to make the document look like a published page. It is a source-first editor. Markdown punctuation, source order, line numbers, cursor movement, selection, and editing behavior remain understandable at all times. Friendly rendering is added only where it makes the source easier to scan or interact with.

The intended visual hierarchy is:

1. VS Code supplies the editor geometry, configured typography, selection mechanics, and host integration.
2. The pinned GitHub Primer/Prettylights palette supplies the source-highlighting character: monospace source, blue structural syntax, yellow list markers, muted punctuation, and restrained emphasis. The GitHub Dark Default VS Code theme supplies the reference workbench and canvas; its syntax rules are not the Markdown color authority.
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
- The current `getParsedTables` detector remains the sole authority for recognized table ranges, including cases where a new GFM parser would classify the source differently. New decorations, commands, and CSS must treat those ranges and every `.mlrt-table-*` element as a protected exclusion zone. Shared syntax parsing may inspect them for context; rendering and interaction ownership may not change.
- A future table-only design document will own all table decisions. This document has no authority to change them.

“Source-engaged state,” “reveal syntax,” and similar rules in this document apply only to non-table Markdown. They never apply to a recognized table.

### 2.2 One canonical line rhythm

All editor text uses the same canonical font size and line height, derived from the current VS Code editor settings and injected `--mlrt-editor-*` variables.

- Headings do not become larger and do not increase line height.
- Lists, quotes, callouts, code blocks, rules, and inline formatting do not add vertical margins.
- Decorative borders and backgrounds must be inset, overlaid, or drawn inside the existing visual rows. They must not add vertical padding or border width to layout.
- Every text row, including code and callout rows, uses `--mlrt-editor-line-height`.
- Wrapped text may occupy additional visual rows under the current wrapping setting. Every wrapped row uses the canonical line height, and continuation rows do not receive a new source line number. Exact stock-editor wrap points are a separate validation target defined in Section 2.3.
- A multiline source construct occupies the visual rows implied by its source lines and wrapping. Rendering must not collapse several source lines into one tall replacement block.
- The gutter must remain continuous. A line number must never shift vertically merely because the source line is a heading, list item, fence, quote, or callout.

The fixed rhythm requirements govern all new non-table renderers. Existing rendered tables retain their current geometry without modification.

### 2.3 Stable geometry while editing

Moving the caret into an element must not cause surrounding content to jump.

- Resting and source-engaged states must have the same height, marker advance width, following-text position, wrap points, and scroll position when source and viewport are unchanged. Caret scrolling required by ordinary navigation is permitted; scrolling caused solely by a decoration swap is not.
- Replacing a source token with a friendly control is allowed only when its advance width matches the literal token under the actual font, weight, letter spacing, zoom, and surrounding indentation. Do not assume a fixed pixel width or that `ch` exactly matches the configured font. Recalculate measurements when editor metrics change.
- Ordinary prose must retain the existing stock-editor geometry baseline. Semantic bold/italic styling can change glyph widths relative to unstyled source; any resulting wrap difference must be recorded and covered by a fixture. State transitions may never introduce an additional wrap difference.
- Hanging indentation for wrapped lists is the only intentional new continuation-alignment difference. Its width must be source-derived and identical in both rendering states; it must not modify the underlying whitespace.
- Incomplete or malformed Markdown must fail open to ordinary editable source rather than producing a broken widget.

### 2.4 The Markdown source is authoritative outside recognized tables

- The underlying document remains standard Markdown at every point in an edit.
- Decorations and widgets must not own canonical content.
- Selection positions, document edits, undo/redo, and host synchronization operate on source text. Clipboard commands continue to derive their existing representations from the source and existing selection models; source authority does not require every copy mode to emit literal Markdown.
- All current clipboard behavior is a protected invariant: defaults, commands, MIME representations, Smart/Rich/Plain Text/Markdown conversion, paste precedence, internal lossless payloads, cut/move semantics, and prose/table/mixed-selection routing remain unchanged. Section 6.2 records the regression matrix. This phase has no authority to redesign clipboard behavior.
- Find, diagnostics, and multi-cursor capabilities must be inventoried in Phase 0 rather than assumed to exist in the custom editor. Existing capabilities must not regress; missing host integrations are deferred as specified in Section 3.
- Interactive controls, such as task checkboxes, edit the smallest corresponding source range in one undoable transaction.
- No live rendering may make valid source unreachable by keyboard.

Recognized tables are the deliberate exception: their Markdown remains the persisted backing data, but it is never exposed as direct editor source. Existing table controls are the only editing surface.

### 2.5 Non-table source remains visually legible

Source syntax should remain visible by default when it is useful to understanding the document. The heading marker is the clearest example: `#` characters remain visible.

Syntax may be visually transformed only when the transformed form is substantially friendlier and unambiguous:

- unordered list marker to bullet glyph;
- task marker to checkbox;
- thematic-break marker to horizontal rule;
- no other marker replacements in this phase; image/link chips remain deferred under Section 3.3.

When syntax is transformed, keyboard movement must be able to reach every literal character. Reveal the token before a motion or edit would enter it, following Section 4. Do not require a separate edit/preview mode.

### 2.6 Exact GitHub Dark Default color system

The supported appearance uses literal colors from Appendix A, with the explicit accessible heading mapping in Section 5.1. Do not substitute nearby VS Code theme variables, the older `#58a6ff` accent palette, hand-tuned alternatives, or `color-mix()` approximations.

- Keep the user’s configured VS Code editor font family, font size, letter spacing, and canonical line height. Color fidelity does not override editor-metric fidelity.
- The reference review environment must use the GitHub Dark Default host theme so the surrounding editor canvas matches the target palette without changing existing table styling.
- New Markdown color tokens must be scoped to non-table prose and generated non-table controls. Do not redefine existing `--mlrt-*` table tokens and do not place a global color rule on a selector inherited by `.mlrt-table-widget`.
- Enable the new non-table appearance when the active host theme is GitHub Dark Default and its injected editor canvas matches `#0d1117`. If a light theme, another dark theme, VS Code high-contrast theme, or customized incompatible canvas is active, retain the existing source presentation without the new non-table decorations or controls. Table and clipboard behavior remain governed by their protected contracts.
- React to theme/canvas changes without rewriting source, rebuilding table controls, or moving focus. Theme fallback is required behavior, not a light-theme design or an approximation of the pinned palette.
- Operating-system forced-colors mode overrides palette values with system colors and visible outlines when the new appearance is active. VS Code high-contrast themes are distinct from operating-system forced-colors mode and use the source fallback above.
- Heading text uses the official `fgColor.accent` value `#4493f8`; `#1f6feb` remains the frozen Prettylights heading reference and a strong non-text accent. This deliberate mapping resolves the contrast issue without inventing a color. Appendix A records both roles.
- Meaning must not rely on color alone.

## 3. Feature scope and capability baseline

### 3.1 Existing capabilities and new deliverables

This specification adds non-table Markdown decoration and the narrowly defined task/link interactions. It does not assume that every stock VS Code editing service already exists in a custom webview.

| Capability | Current evidence / required Phase 0 audit | Treatment in this phase |
| --- | --- | --- |
| Rendered tables and protected backing source | Existing table widget, detector, selection guards, and table editing tests | Preserve the Section 2.1 contract exactly. |
| Clipboard modes, conversion, and mixed selections | Existing document/table clipboard serializers and regression tests | Freeze and preserve the full Section 6.2 matrix; no redesign. |
| Source editing, IME, undo/redo, host revisions | Existing CodeMirror editor and extension-host synchronization/composition handling | Preserve current behavior and validate with new decorations active. |
| Markdown Enter/Backspace and Tab/Shift+Tab | Current `markdown()` support and source/table key handling; record exact behavior in Phase 0 | Preserve existing bindings; add only the scoped task command. |
| Find/replace, diagnostics, and general multi-cursor editing | Not established as full custom-editor integrations; inspect and record what actually works in Phase 0 | Preserve verified capability. Missing general integrations are deferred, not silently added as decoration prerequisites. |
| Non-table semantic decorations and marker controls | New work defined by Sections 4 and 5 | Required within the supported Section 2.6 appearance profile. |
| Link opening/resolution and task toggle command | New scoped interactions; not supplied automatically by styling | Required with source mapping, host routing, accessibility, and undo validation. |
| Fenced-code language grammars | Current `markdown()` call does not supply the required code-language registry | Bundle the explicit Section 7.2 language set and palette mapping. |

Phase 0 must record actual results and known gaps rather than relabeling an unverified capability as already supported. A capability that exists today must not regress; an absent general host feature requires a separate future design.

### 3.2 Required rendering and interaction matrix

| Construct | Source visibility | Required enhancement | Delivery |
| --- | --- | --- | --- |
| ATX/Setext headings | All markers and source rows visible | Normal-size blue bold styling with nested-style precedence | Phase 1 |
| Emphasis, strong, strike, inline code | Delimiters visible | Semantic font styles, exact foreground/background roles | Phase 1 |
| Inline links and autolinks | Labels, delimiters, destinations, titles visible | Source styling and platform modifier-open through host | Phase 1 |
| Escapes, entities, HTML, comments | Literal source visible | Context-aware styling; no document HTML mounted as live DOM | Phase 1 |
| Unordered/ordered lists | Ordered markers visible; unordered marker transformed only at rest | Width-preserving bullet and source-derived continuation indent | Phase 2 |
| Tasks | Task marker revealed on source engagement | Accessible checkbox and one-character toggle command/transaction | Phase 2 |
| Quotes/thematic breaks | Quote markers visible; rule marker revealed on engagement | Inset guides and a line-preserving rule | Phase 2 |
| Fenced/indented code | Every source row/fence visible | Continuous row band and the named language grammars | Phase 3 |
| Alerts and YAML frontmatter | Markers and every source row visible | Scoped recognition, row tint/edges, compact source styling | Phase 3 |
| Images, reference definitions, footnotes | Literal source visible | Source styling and reference-link resolution, without new preview/jump controls | Phase 4 |
| Existing tables | Existing rendered editing surface | Existing implementation only, under Section 2.1 | Every milestone regression |
| Unsupported/ambiguous extensions | Editable source visible | Safe fallback without altering nearby supported constructs | Every milestone |

### 3.3 Deferred enhancements

Image chips/hover previews, additional alert icons, code-copy overlays, footnote jump controls, optional extra indentation guides, block collapse, diagrams/math/media, and additional code-language grammars are deferred. Decorative quote/alert edges explicitly required in Section 5 are included. General find/replace, diagnostics, multi-cursor integration, new clipboard modes, and unrelated indentation/keybinding changes are outside this phase. Do not implement deferred features as incidental polish.

The palette and visual composition are maintained in Appendix A. Implementation rules refer to that appendix; the main body owns behavior, scope, and validation.

## 4. Rendering states

The implementation should use two visual states without becoming a two-mode editor.

### 4.1 Resting state

The element is recognizable and compact while its source remains legible. Semantic controls may replace narrow marker ranges, and inline content may receive visual styling.

### 4.2 Source-engaged state

For each transformed non-table token with source range `[from, to)`, reveal the exact token when any non-empty editor selection overlaps that range, or when a source-editor caret is at or inside either boundary (`from <= head <= to`). Apply the rule to all supported selection ranges, not just the primary range. A non-empty selection reveals overlapping tokens even when the editor is unfocused; a collapsed caret engages syntax while the source editor has focus. A focused generated control keeps its control presentation and a source bookmark until focus returns to source.

This is a local token-level state. The rest of the line may remain styled; paragraphs and blocks do not wholesale alternate between HTML and raw source. Returning to resting state is decoration-only and must not edit the document, create an undo entry, reset a preferred column, or cause a geometry change.

| Trigger | Required result |
| --- | --- |
| Left/right movement toward a token | Reveal at its boundary before movement would enter it; each subsequent key reaches the next literal source position. Do not skip the token. |
| Shift-arrow, drag, or existing Select All behavior | Reveal every overlapping transformed token; preserve the exact source endpoints and existing mixed-table selection projection. |
| Click a bullet or rule | Reveal the token and place the caret at the nearest literal character boundary using measured source geometry. Do not snap every click to the block start/end. |
| Click a task checkbox | Toggle the task as specified in Section 5.6; preserve the current selection/bookmark and focus owner. This action is distinct from clicking editable item text. |
| Backspace/Delete at a token boundary | Reveal before the ordinary source edit and remove the same source character/range the undecorated editor would remove. |
| Host-originated or existing programmatic selection | Map selection through changes and reveal the intersected token before painting. Missing find/diagnostic integrations are not introduced here. |
| Caret/selection leaves the token | Restore its resting decoration only when composition and focus rules permit, preserving width and wrapping. |
| IME composition touches a token | Keep literal source and stable editable DOM for the affected span until composition is committed/cancelled. Defer replacement-widget changes in that span, then revalidate source ranges. |

Do not add new non-table atomic ranges as the default marker implementation. CodeMirror atomic ranges make normal cursor motion skip their interiors ([API behavior](https://raw.githubusercontent.com/codemirror/view/main/src/editorview.ts)). Any exception needs explicit movement/deletion handling and direct tests proving every source position remains reachable; existing table atomic ranges are unaffected.

### 4.3 Tables have no source-engaged state

Section 2.1 governs tables in every rendering state. None of the token transitions above changes the existing rendered table interaction model or reveals backing pipe source.

## 5. Element behavior

The following requirements define the required first complete pass, subject to the scope matrix in Section 3. “Marker” means Markdown punctuation; “content” means the human-readable text governed by it. Nested styling follows Section 7.2 rather than whichever CSS rule is loaded last.

### 5.1 Headings

Example source: `## Deployment notes`

- Keep all `#` markers visible at all times.
- Color heading markers, required following spaces, ordinary heading text, and optional closing ATX markers `#4493f8`. This is the explicit accessible mapping from the pinned palette; do not silently revert to the `#1f6feb` Prettylights reference.
- Apply `font-weight: 700` to the heading source span. Inline emphasis/strike add their font treatment; links, inline code, escapes, and delimiter punctuation retain their more specific foreground treatment under Section 7.2.
- Keep the normal editor font size and canonical line height for every heading level.
- Distinguish levels only through marker count. H1 through H6 use the same heading foreground, weight, font size, and line height.
- Do not add top or bottom margin, underline rules, or preview-style spacing.
- Setext heading text and its underline source use the same heading foreground and `font-weight: 700`; the underline remains in its ordinary source row and is never transformed into a thematic break.

Visually, `## Deployment notes` is visible blue source on the flat editor canvas, at normal editor size and rhythm. Nested syntax retains its specific treatment; no preview-style `<h2>` geometry is introduced.

### 5.2 Emphasis, strong text, and strikethrough

- Style ordinary prose content semantically: italic for emphasis, bold for strong text, and line-through for strikethrough, normally in `#f0f6fc`. Inside headings or links, inherit the more specific content foreground while composing font styles.
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
- Keyboard editing and selection use literal source positions. All copy/cut/paste behavior follows the unchanged Section 6.2 clipboard contract.
- Reference links and definitions receive the same source-first treatment.
- Use the platform's normal VS Code link modifier (Ctrl on Windows/Linux, Cmd on macOS) without treating AltGr text input as activation. Route opening through an extension-host message; do not navigate the webview.
- Resolve relative paths against the document URI, decode fragments, and navigate local heading fragments through source positions without rewriting source or exposing table source. Permit `http`, `https`, and `mailto` external destinations through the host; open local/remote workspace files through VS Code. Reject executable/command/data schemes. Unresolved references or destinations leave editing and selection intact.

### 5.5 Unordered and ordered lists

- Render `-`, `*`, or `+` as a compact `#f2cc60` bullet in resting state. Reveal the literal marker, also in `#f2cc60`, when the caret intersects its source range.
- Keep ordered-list numbers visible in `#f2cc60`. Do not renumber them visually in a way that disagrees with source.
- Preserve indentation as source-backed horizontal geometry.
- Additional list indentation guides are deferred; preserve any guides already provided by the existing editor.
- Wrapped continuation text aligns with list content through the state-stable, source-derived hanging indent defined in Section 2.3. Verify nested markers, multi-digit ordered markers, tabs, and quoted lists.
- Preserve the current Markdown Enter/Backspace behavior. Inventory Tab/Shift+Tab in Phase 0 and preserve it rather than introducing an unrelated indentation/keybinding redesign. Task widget navigation must not intercept source-editing bindings.
- Marker transformations must reserve enough width to prevent the item text from shifting when raw syntax is revealed.

### 5.6 Task lists

- Transform `[ ]`, `[x]`, and `[X]` into a compact accessible checkbox in resting state.
- The checkbox fits entirely within the canonical line box and is aligned to the text baseline.
- Use the exact state colors in Appendix A.5. The control is square with a `3px` corner radius; it is not a round switch or a pill.
- Use a one-pixel `#3d444d` border for the unchecked control. The checked control uses no additional outer border beyond its `#1f6feb` fill.
- Clicking it changes only the middle character: space becomes lowercase `x`, and `x` or `X` becomes space. Preserve brackets, list marker, whitespace, item content, selection/bookmark, and the current focus owner. Use the existing source transaction/host synchronization path and isolate the action as one undo step before and after adjacent typing.
- Keep item text `#f0f6fc` whether checked or unchecked. Do not force strikethrough, opacity, or a muted text color.
- Expose a checkbox role, checked state, accessible name from the item text, visible focus, and normal control focusability. Space toggles a focused checkbox; Escape returns to the bookmarked source position. Do not create a focus trap or repurpose source Tab/Shift+Tab bindings.
- Provide a `Markdown Live Editor: Toggle Task Checkbox at Caret` command for the containing task item, including when its marker is revealed. No new default shortcut is required. The command uses the same one-character transaction as the checkbox and does nothing outside a task or in read-only source.
- While source composition is active, defer control actions that would interrupt it; after composition ends, revalidate that the intended task marker still exists before applying the action.
- When the caret intersects the task marker, reveal the literal task syntax without moving the item text.

### 5.7 Blockquotes

- Keep `>` markers visible in `#9198a1`; ordinary quoted content uses `#f0f6fc`, with nested inline/block treatments applied according to Section 7.2.
- Draw a one-pixel `#3d444d` vertical guide inside the line’s existing horizontal space, aligned consistently through consecutive quote lines.
- Do not add vertical margin or padding.
- Every quoted source line remains an ordinary independently numbered editor line.
- Nested quote depth is represented by repeated source markers. Additional per-depth guides are deferred; retain the required one-pixel blockquote guide without changing indentation.

### 5.8 GitHub-style alerts and callouts

Recognize alert markers such as `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, and `> [!CAUTION]`.

- Keep the `>` and `[!TYPE]` source visible. The `>` remains `#9198a1`; the alert marker and title use the corresponding foreground from Appendix A.4.
- Render the alert marker/title at `font-weight: 600`. Additional semantic icons are deferred; the visible `[!TYPE]` text identifies the alert without adding width or relying only on hue.
- Draw a three-pixel inset left edge using the “Strong edge” color from Appendix A.4 and apply the exact “Muted row tint” across every source line in the alert.
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
- Apply language-aware highlighting for the required languages and aliases in Section 7.2, using Appendix A.3 values without replacing source or changing metrics.
- A new code-copy overlay/action is deferred. Existing selection copy/cut behavior remains governed by Section 6.2.
- Empty, incomplete, or unclosed fences remain editable. A valid unclosed fence extends to the end of its Markdown container/document under CommonMark rules; it suppresses inline/list transforms within that code content. Do not classify a valid unclosed fence as malformed prose or invent a closing fence.
- Indented code blocks receive the code background treatment but do not invent fence controls.

### 5.11 Images

Full inline image previews are incompatible with the fixed line rhythm and are not part of the default editor surface.

- Keep image Markdown source visible. Use `#4493f8` for alt text, `#a5d6ff` for destination, and `#9198a1` for punctuation.
- New image chips/icons and hover previews are deferred. This phase styles image source without adding resource loading or another interaction surface.
- Missing files, remote loading, and unsafe URLs must not disturb editing or line geometry.

### 5.12 HTML, escaped syntax, entities, and comments

- Raw HTML remains source. Tags use `#7ee787`, attribute/type-like entities use `#d2a8ff`, strings use `#a5d6ff`, and punctuation uses `#9198a1`; it is not mounted as live DOM.
- Escaped Markdown punctuation must not be transformed.
- Entities may be syntax-highlighted, but source remains visible.
- HTML comments remain source in `#9198a1`.
- Never execute scripts, event attributes, embedded web content, or arbitrary HTML from the document.

### 5.13 Frontmatter, footnotes, and unsupported extensions

- YAML frontmatter remains compact source: delimiters and punctuation `#9198a1`, keys `#ffa657`, strings `#a5d6ff`, and numeric/boolean/null constants `#79c0ff`. Quoted literals remain strings; there is no competing keyword color for the same YAML scalar. It is not replaced by a metadata panel.
- Footnote markers and definitions use `#d2a8ff` for identifiers and `#9198a1` for punctuation while remaining fully visible. New footnote jump controls are deferred; do not style a decorative label as an actionable control.
- Unsupported Markdown extensions remain editable source and must not break nearby decorations.
- Mermaid and other fenced extensions use the normal fenced-code treatment in this phase; diagram rendering would violate the default fixed-line editor surface.

### 5.14 Tables

Section 2.1 is the sole table design authority for this phase. This includes inline Markdown inside cells, source protection, line-number ownership, and every current editing/clipboard interaction. Section 7.4 supplies the CSS exclusion rules; no separate table rendering implementation is added here.

## 6. Interaction and editing requirements

### 6.1 Cursor and pointer mapping

- Outside recognized tables, left/right movement traverses literal source positions in a predictable order.
- Up/down movement preserves the preferred horizontal column across ordinary and decorated lines.
- Clicking rendered text places the caret at the corresponding source character, not merely at the start or end of the block.
- Clicking decorative marker chrome follows Section 4.2. Checkbox activation follows Section 5.6 and does not masquerade as a source click.
- Movement into a recognized table transfers control to the existing table navigation behavior without revealing table source.
- Drag selection can cross any combination of plain lines, decorated lines, code blocks, callouts, and existing table widgets without becoming trapped and without changing table behavior.

### 6.2 Selection and clipboard

- Selected non-table text represents the underlying Markdown source. Table selections continue to use the existing table selection and clipboard model.
- Selection painting remains visually continuous across styled spans.
- Preserve all existing clipboard behavior for prose, tables, and mixed selections. In particular, ordinary Smart copy must not be changed into source-only copy merely because the new rendering is source-backed. Explicit Copy Markdown remains the existing route for Markdown serialization.
- Continue to obtain clipboard inputs from the source and the existing document/table selection models, never by scraping newly decorated editor DOM. Generated controls must not add payload content or alter existing conversion. Bullets/list markers already generated by the current clipboard serializer are intentional and must not be removed.
- Preserve context-menu routing, configured default copy/paste modes, internal MIME version and metadata carriers, HTML sanitization, Office/spreadsheet interoperability, cut tokens, deferred cut clearing, move detection, and undo/focus behavior. Do not introduce a special clipboard mode for new Markdown widgets.

The following matrix documents the existing routes, not a new serialization specification. Capture their actual MIME types and payloads in Phase 0 and compare before/after each rendering milestone. When this summary omits a detail, the current serializer and regression baseline are authoritative; do not normalize or "correct" existing output to satisfy the summary.

| Copy mode | Prose-only selection | Rendered-table selection | Mixed prose/table selection |
| --- | --- | --- | --- |
| Smart (current default) | Current display-text `text/plain`, Smart HTML, and existing internal source payload | Current table/grid serialization and worksheet-friendly list handling | Current document/composite routing, including its existing conditional Markdown `text/plain` handling |
| Rich | Current display-text plain representation and semantic rich HTML | Current table/grid representations with semantic lists in rich HTML | Current rich document/composite representations |
| Plain Text | Current display-text plain representation | Current plain tab-delimited/grid representation | Current plain document/composite representation |
| Markdown | Current literal selected Markdown source | Current Markdown serialization of the selected table/cells | Current source/projection-based Markdown serialization |

Cut uses the same existing mode-specific representations and current delete/move semantics. Existing metadata carriers and private payload exceptions remain unchanged in every mode.

| Paste mode | Protected behavior |
| --- | --- |
| Auto (current default) | Current supported internal lossless payload handling, then existing HTML/Markdown/plain fallback precedence for the destination and selection; pending cut/move routing is unchanged. |
| Rich | Current HTML conversion, table/list import, and fallback behavior. |
| Plain Text | Current plain-text interpretation and destination-specific insertion behavior. |
| Markdown | Current Markdown MIME/plain fallback and Markdown interpretation. |

Regression coverage must include all copy modes for prose-only, table-only, and partial/full mixed selections, plus all paste modes into prose, table cells/ranges, and mixed selections. Include internal copy/cut/move, external Markdown, spreadsheet and rich-text data, nested lists, blank lines, Unicode, and undo/redo. The sources of truth are `src/editor/documentClipboard.ts`, `src/editor/table/tableClipboard.ts`, `src/shared/clipboardModel.ts`, and their existing tests.

### 6.3 Editing and source synchronization

- Every source edit continues through the current CodeMirror-to-extension-host synchronization path.
- Preserve existing IME composition, dead keys, Unicode, undo/redo, paste, and host-originated changes. Preserve existing multi-cursor capabilities if established by the Phase 0 inventory; this phase does not add general multi-cursor support.
- Decoration updates must not move focus or reset a composition.
- A decoration-only selection, focus, viewport, background-parse, theme, or metric update must not create a source transaction or host edit. Map ranges through host edits and current revision validation rather than adding a second synchronization path.
- Parsing and decoration performance must meet the fixtures and budgets in Section 8. Avoid synchronous forced layout during ordinary updates; use CodeMirror's measurement scheduling for geometry reads.

### 6.4 Accessibility

- Generated controls are keyboard reachable only when they perform an action; purely decorative elements are ignored by assistive technology.
- Interactive widgets expose an accessible role, label, state, focus appearance, and sufficiently large pointer target without enlarging the line box.
- Forced-colors mode uses system colors and visible outlines.
- Verify contrast of the actual foreground/background combinations, including code and alert tints. Heading text uses the accessible mapping in Section 5.1; keep normal editor metrics. Preserve selection legibility without overwriting the existing clipboard/selection model.
- Syntax remains understandable without relying only on hue.
- Reduced-motion users should encounter no transition-driven movement; the initial design should use little or no motion.

## 7. Recommended implementation architecture

### 7.1 Decoration-first, line-preserving rendering

Use CodeMirror 6 syntax-aware decorations for all new non-table Markdown rendering:

- mark decorations for color, weight, emphasis, inline backgrounds, and delimiter treatment;
- line decorations for code, quote, callout, and frontmatter backgrounds or inset edges;
- small replace/widget decorations only for width-controlled markers such as bullets, checkboxes, and thematic breaks;
- literal source positions and the explicit token transition rules in Section 4.2; do not reuse the table's atomic-navigation policy for non-table controls.

Do not use multiline HTML replacement widgets for ordinary Markdown blocks. They obscure source, complicate cursor mapping, and make fixed gutter rhythm difficult to guarantee.

The existing multiline `TableWidget` remains governed by Section 2.1. No external prototype is an implementation dependency; any future prototype reference must include a concrete repository/path and identify the exact pattern being reused.

### 7.2 Parsing

- Use the syntax tree produced by `@codemirror/lang-markdown` as the non-table structural source of truth. The current `markdown()` configuration uses CommonMark; explicitly enable only the required GFM/custom extensions rather than silently adopting unrelated subscript, superscript, or emoji syntax.
- Give the current table detector first rendering/interaction ownership of its recognized ranges. Shared syntax parsing may inspect the full source for container context. Subtract protected ranges from new decorations and prevent line backgrounds, wrappers, and generated controls from painting or handling table-owned DOM. Parser traversal is not a table behavior change.
- Required dialect: CommonMark headings, emphasis, code, lists, quotes, links/images, escapes, entities, and HTML source; GFM task markers, strikethrough, and extended autolinks; and the explicitly scoped alert, YAML-frontmatter, and footnote recognition below. Existing table recognition remains independent.
- Avoid parsing the entire document with a second renderer on every keystroke.
- Derive decorations from source ranges, never from rendered HTML offsets.
- Fail open for unsupported or ambiguous syntax. Incomplete-but-valid constructs, including unclosed code fences, follow their parser/container rules without making source unreachable.

Recognition precedence and extension boundaries:

| Case | Required interpretation |
| --- | --- |
| Any range claimed by `getParsedTables` | Existing table rendering and interaction win over every new renderer. Do not change the detector to make the new dialect agree with it. |
| YAML frontmatter | Recognize an opening `---` line only at document start (after an optional preserved BOM), with a matching closing `---` line. Keep every source row. Without a closer, do not claim the rest of the document as frontmatter; use the ordinary Markdown parser. Protected table ranges still win. |
| Fenced/indented code, inline code, HTML comments and raw HTML | Suppress Markdown marker transforms inside literal regions. Highlight code/HTML source with its appropriate parser. `- [ ]`, `***`, `#`, and escaped delimiters inside these regions remain literal. |
| Setext underline versus thematic break | Honor the structural parser: `Title` followed by `---` is a heading, while a parsed standalone thematic break is a rule. Frontmatter takes precedence only under the start/closer rule above. |
| Task marker | Recognize `[ ]`, `[x]`, or `[X]` only at the start of a parsed list item's content and followed by whitespace/end-of-line. Do not transform bracket text elsewhere. |
| Alert | Recognize the five uppercase `[!TYPE]` forms when they alone begin the first paragraph of a parsed blockquote, after quote markers/whitespace. The blockquote container determines the extent, including blank/lazy continuation rows. Unknown types are ordinary quotes. Nested quotes/lists retain their container geometry; do not create overlapping nested alert controls. |
| Footnote | Recognize visible `[^id]` references and `[^id]:` definitions with their indented continuations outside literal/protected ranges. Unresolved references remain visible; no automatic renumbering or jump control is added. |
| Escaped syntax | Follow the parser's escape ranges. Escaped markers never become bullets, tasks, rules, or emphasis delimiters. |

Styling precedence is property-specific; it is not decided by incidental CSS order:

| Layer/property | Required precedence |
| --- | --- |
| Foreground | Literal code/HTML tokens and specific link/image destinations or labels win over heading foreground; heading ordinary text wins over generic emphasis/strong/quote foreground. Each delimiter retains its own specified punctuation color, except heading markers/Setext underlines, which retain heading color. |
| Font style | Heading bold, emphasis italic, strong bold, and strike compose on their content. Inline/fenced code uses the configured normal editor weight/style so a surrounding heading/emphasis does not change code metrics. |
| Background | Inline-code fill applies to its exact span. Fenced/indented-code row fill wins over enclosing alert/frontmatter row tint. Alert guides may remain inset outside the code text; no layer reaches table-owned DOM. |
| Selection/cursor | Existing selection and cursor painting remain visible above semantic fills. New fills must not obscure selection, find markers already provided by the baseline, or table selection overlays. |

Required composition fixtures include ``## **Important** [deployment](./deploy.md) `settings` ``, a code fence inside an alert/list, an escaped task marker, frontmatter followed by a rule, and syntax immediately before/after tables. In the heading example, the heading/strong text is blue and bold, the link retains link styling, and the code/backticks retain their code/punctuation styling.

Required fenced-code language support:

| Language | Accepted identifiers |
| --- | --- |
| JavaScript | `javascript`, `js`, `nodejs` |
| TypeScript | `typescript`, `ts` |
| JSON | `json` |
| Bash/shell | `bash`, `sh`, `shell` |
| Python | `python`, `py` |
| YAML | `yaml`, `yml` |

Match identifiers case-insensitively using the first info-string word. Bundle the required language parsers with the extension; do not download grammars into the webview. Explicitly map their available highlighting tags to Appendix A.3: comments, constants, declarations/types, keywords, strings, variables, regex, and punctuation. Unknown tags fall back to ordinary code foreground. Unknown/empty language identifiers, diagrams, and unavailable parsers retain source and code-row styling without guessed tokenization. Exact colors are required for mapped roles; GitHub/TextMate token-boundary parity is not claimed.

Recompute decorations when relevant source changes, selection/focus transitions, visible ranges change, background parsing advances, or theme/editor metrics change. Extend visible-range work to the enclosing construct so fences/alerts remain continuous when their opener is offscreen. Parser incompleteness uses temporary editable source and must converge after parsing advances without another keystroke.

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

- Centralize Appendix A values under a non-table scope with an `--mlrt-github-dark-*` prefix. Apply the Section 5.1 heading role deliberately. Values are literal colors, not VS Code variable aliases.
- Keep static styles in `media/liveEditor.css` and geometry-dependent values in injected `--mlrt-editor-*` properties.
- Do not modify an existing `.mlrt-table-*` rule. Do not use element selectors or inherited global custom-property changes that can restyle the existing table widget.
- Never use a bare `table`, `thead`, `tbody`, `tr`, `th`, or `td` selector for this phase.
- Prefer inset `box-shadow`, layered `background-image`, and pseudo-elements over layout-affecting borders or padding.
- Every Markdown line class must retain canonical font size, line height, letter spacing, and font family. Specific font weight/style follows Section 7.2; a blanket `font: inherit` reset must not erase semantic styling.
- Generated widgets must use `box-sizing: border-box`, fit inside one line box, and avoid changing CodeMirror’s block height measurement.

## 8. Delivery sequence

### Phase 0: fixtures and invariants

- Begin with `standard-markdown-fixture.md` and existing table fixtures, including `standard-markdown-in-table-fixture.md` and `html-in-markdown-table-fixture.md`. Add focused cases for precedence, malformed/incomplete syntax, tabs, nesting, wrapping, Unicode, and source adjacent to tables; unsupported extensions in existing fixtures are fallback cases, not implied new scope.
- Produce the capability inventory in Section 3.1, record current source keybindings, and capture the full Section 6.2 clipboard matrix before implementation. Freeze current payload semantics and editing/selection behavior as the regression authority.
- Capture rendered-table screenshots and computed styles before implementing new Markdown decoration. Compare the same source, selected/focused state, width, theme, and host settings before/after; no intentional table visual/behavioral changes are allowed. Mask only documented transient caret/blink regions in pixel comparisons, never table geometry or content.
- Record VS Code/Electron and extension versions, GitHub theme package/version, OS, editor font/weight/ligatures, font size, letter spacing, effective line height, wrapping configuration, zoom, device pixel ratio/display scaling, viewport CSS dimensions, and sidebar/chat/minimap layout with each visual run. Wait for fonts and layout to settle.
- Use the same isolated Extension Development Host window to capture stock and live screenshots. Confirm Monaco `.view-lines` for stock and a live webview `iframe` for the custom editor. Inspect the images directly; the standalone HTML harness is not proof of workbench parity.
- Measure actual text-node/glyph boxes as well as line/content/gutter boxes. Convert webview coordinates into workbench coordinates before comparisons. Verify line rhythm, first-line x/y, line-number ink, selection geometry, active gutter background, and state-stable marker width/wrap points.
- Reproduce the pre-implementation visual-check discrepancy observed during the design review: `scripts/edh-visual-check.mjs` measured `0.8px` table borders where it asserts exactly `1px`, while its core font/gutter geometry checks passed. Record zoom/DPI and establish whether the assertion or baseline is incorrect before making it a release gate. Do not restyle tables or weaken tests to accommodate new Markdown rendering. Any justified harness correction must be isolated from product changes and documented against the original baseline.

Required geometry matrix: wrapping on/off; viewport widths of 360px and 800px where feasible; default editor metrics and 20px font/30px line height; default and 1px letter spacing; zoom levels 0 and 1; the local display scale plus a fractional device-pixel-ratio case on a capable test machine. Stock/live comparisons use identical workbench layouts at each setting. Unsupported themes verify fallback; forced-colors verifies system-color rendering separately. Record unavailable cross-platform/display environments as incomplete validation rather than claiming coverage.

Performance fixtures and budgets:

| Fixture | Content and measurement | Required budget |
| --- | --- | --- |
| Comprehensive Markdown fixture | Supported syntax, ambiguity/nesting, malformed source, and adjacent existing tables | No rendering-state transition changes wrap points, source positions, scroll position, or source text. |
| Generated 10,000-source-line fixture | Repeated mixed prose, lists/tasks, headings, code, alerts, and existing tables; include lines at least 2,000 characters long | New decoration work has p95 main-thread cost at most 8ms per update. |
| Generated 100,000-source-line fixture | Same content mix with code/alert openers outside the visible viewport | New decoration work has p95 main-thread cost at most 16ms per update; work must not grow in proportion to all document lines for a caret-only update. |

Measure at least 200 source edits, 100 selection/focus transitions, and 100 scroll updates after warm-up on each large fixture, at both viewport widths. Compare the same extension and machine with only the new non-table decorations enabled/disabled; existing table parsing/synchronization costs remain part of both baselines. Record p50/p95/max decoration cost and input-to-next-paint latency. Added p95 input-to-next-paint latency must be at most 16ms. Measure parsing advancement and metric/theme changes separately. If a required feature misses a budget, optimize it before release; deferral requires an explicit scope revision. Do not rewrite table/clipboard behavior to meet a decoration budget.

### Phase 1: source styling and inline semantics

- Headings with visible markers, blue accent, bold content, and unchanged metrics.
- Emphasis, strong text, strikethrough, inline code, links, escapes, and comments.
- Nested-style precedence, explicit GFM parser setup, host link resolution, and the accessible heading mapping.
- Exact pinned colors, unsupported-theme fallback, forced-colors, selection, cursor, and IME verification.

### Phase 2: line-level controls

- Unordered and ordered lists.
- Interactive task checkboxes.
- Blockquotes and thematic breaks.
- Complete the Section 4.2 transition matrix and task toggle command, including boundary deletion, selection reveal, composition, focus return, and undo isolation.

### Phase 3: multiline visual continuity

- Fenced and indented code blocks.
- Bundled support for the named code languages and explicit unknown-language fallback.
- GitHub-style alerts/callouts.
- Frontmatter styling.
- Wrapped-line, viewport, and large-file performance checks.

### Phase 4: secondary syntax and hardening

- Images, reference definitions, footnotes, and safe unsupported-syntax fallback.
- Mixed selections across prose, decorated blocks, and tables.
- Regression, accessibility, cross-platform, and GitHub Dark Default fidelity coverage.

At each milestone, run `npm run compile`, the relevant existing automated tests, and the same-window visual checks; inspect saved screenshots directly. Verify the table/clipboard regression baselines before proceeding. Run `./Build_and_Install` after repository changes as required by `AGENTS.md` (use `Build_and_Install.cmd` on Windows); inspect and resolve any red Problems diagnostics in touched implementation files. This document defines future implementation work; editing the spec does not claim those features or gates have already passed.

## 9. Acceptance criteria

The phase is complete only when all of the following are true:

1. Headings, including H1 and H6, have the same computed font size and line height as ordinary editor text.
2. Computed non-table colors match Appendix A and the explicit Section 5.1 heading mapping. No specified role uses a legacy `#58a6ff` substitution or host-theme approximation. Nested heading/link/code examples follow the precedence table.
3. The vertical distance between equivalent unwrapped source lines is constant across plain text, headings, lists, tasks, quotes, alerts, rules, and code lines.
4. Gutter line numbers remain aligned before, inside, and after every decorated multiline construct.
5. Resting/source-engaged transitions preserve marker advance width, following-text x/y, wrap points, document height, and scroll position within the geometry tolerance. Only the documented static semantic-font and list-continuation differences from stock wrapping are allowed.
6. Every Section 4.2 transition passes, including navigation in both directions, Shift-selection, pointer mapping, Backspace/Delete, host selection, unfocused selections, and IME. Every transformed token remains character-accurately editable.
7. Task checkbox and task-at-caret command change only the middle marker character, preserve source selection/bookmark and focus behavior, and form exactly one undo step separate from adjacent typing. Read-only, composition, rapid toggles, host acknowledgements, and undo/redo are verified.
8. Normal link clicks position the caret; platform modifier-click resolves external, relative-file, reference, and heading-fragment destinations through the host. Invalid/unresolved destinations do not navigate the webview or disrupt editing.
9. The complete Section 6.2 copy/cut/paste regression matrix matches the baseline for prose, table, and mixed selections, including current defaults, representations, internal payloads, Office imports, and cut/move semantics. New decorations add no clipboard content. Ordinary copy is not redefined as source-only copy.
10. Incomplete headings, lists, links, task markers, fences, alerts, and emphasis delimiters remain editable and do not throw.
11. Selection and cursor painting work across styled lines and table boundaries.
12. Every table identified by the current detector retains the Section 2.1 always-rendered behavior through existing focus, editing, selection, clipboard, undo/redo, and navigation operations.
13. Protected table ranges receive no new non-table decorations/interactions; no command or caret position exposes backing pipe source.
14. Before/after rendered-table screenshots and computed table styles show zero intentional visual differences.
15. Existing table/clipboard test expectations and direct visual checks pass. Any pre-existing harness correction has a separate recorded baseline justification; new rendering never supplies a reason to weaken those expectations.
16. The Section 8 geometry/appearance matrix is verified and recorded, including unsupported-theme fallback and the distinction between VS Code high-contrast themes and operating-system forced-colors. Normal-size heading contrast meets the accessible mapping rationale in Appendix A.1.
17. The 10,000/100,000-line fixtures meet the Section 8 budgets. Offscreen construct starts, background parse completion, scrolling, and metric/theme changes do not leave stale decoration or require another keystroke to converge.
18. `npm run compile`, the automated test suite, and the same-window Extension Development Host visual checks pass with no red Problems diagnostics in touched files.
19. Every required feature in Section 3 is implemented and validated; deferred features remain deferred. Existing host integration capabilities match the Phase 0 inventory without silently introducing a new general editor feature.

For geometry checks, use a tolerance of at most 0.5 CSS px after coordinate conversion. Record computed colors in normalized browser form and compare token values, not antialiased screenshot pixels. Before/after table checks use the frozen same-environment baseline; fractional border measurement must not be mistaken for permission to alter table styling.

## 10. Explicit non-goals for this phase

- Making the editor look like GitHub’s rendered README view.
- Enlarged preview-style headings.
- Vertical document spacing based on semantic block type.
- Full-size inline image, Mermaid, math, media, or arbitrary HTML rendering in the editing flow.
- Collapsing source lines inside callouts, code blocks, or frontmatter.
- A separate edit/preview mode.
- Any table behavior, styling, rendering, or interaction change.
- Showing recognized table source, even temporarily.
- Any clipboard redesign, changed defaults, source-only default copy, new code-copy action, or change to existing conversion, MIME, paste, cut/move, or mixed-selection behavior.
- New general find/replace, diagnostics, multi-cursor integration, or unrelated indentation/keybinding changes. Preserve any capability verified in Phase 0; absent capabilities need their own future design.
- Image previews/chips, additional callout icons, footnote jump controls, arbitrary code-language downloads, and the other deferred enhancements in Section 3.
- Adapting the specified colors to arbitrary VS Code themes. Unsupported themes retain the existing source presentation; the explicit heading mapping and forced-colors behavior are defined above.

## 11. Design decision rule

When requirements conflict, use this order:

1. Keep recognized tables always rendered and preserve the existing table and clipboard implementations without visual or behavioral changes.
2. Preserve non-table source correctness and editability.
3. Preserve canonical line rhythm and gutter continuity.
4. Preserve cursor, selection, clipboard, undo, and accessibility behavior.
5. Match the pinned GitHub palette and source character within the explicit accessible heading mapping and supported appearance profile.
6. Add friendly semantic rendering.

If an enhancement cannot satisfy the first four priorities, leave that non-table syntax as styled source until a line-preserving interaction is designed. Do not resolve a conflict by exposing/restyling tables, changing clipboard behavior, or weakening the recorded baseline. Missing capabilities and optional enhancements require an explicit scope revision before implementation.

## Appendix A. Pinned GitHub Dark Default palette and composition

### A.1 Research baseline and fidelity rule

The palette below is pinned to GitHub’s official Primer Primitives repository at commit [`f48bc063f7bc0fb3e447386a8c259650ce46dea8`](https://github.com/primer/primitives/tree/f48bc063f7bc0fb3e447386a8c259650ce46dea8). The relevant sources are the [default dark base palette](https://github.com/primer/primitives/blob/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/base/color/dark/dark.json5), [functional foreground/background/border tokens](https://github.com/primer/primitives/tree/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/functional/color), [Prettylights syntax tokens](https://github.com/primer/primitives/blob/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/functional/color/syntax.json5), and [CodeMirror component tokens](https://github.com/primer/primitives/blob/f48bc063f7bc0fb3e447386a8c259650ce46dea8/src/tokens/component/codeMirror.json5).

The [GitHub VS Code Theme](https://github.com/primer/github-vscode-theme) is the host reference only. Its Markdown heading/list token assignments differ from Prettylights, so it must not be used to override these mappings. Record the installed theme version during visual QA. Exact palette fidelity does not imply identical tokenization to GitHub's website or its TextMate grammars.

The pinned Prettylights heading color `#1f6feb` on `#0d1117` has approximately 4.08:1 contrast. This editor retains normal-size headings, so Section 5.1 deliberately uses `#4493f8` for heading foreground. The [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) uses a 4.5:1 minimum for ordinary-size text; this spec does not treat bold 14px editor text as large text.

These values are frozen implementation inputs for this phase. Hex-letter casing has no visual meaning; lowercase is used consistently below. Alpha colors are written as `rgba()` so their intended compositing is explicit.

No new non-table Markdown color may be invented during implementation. If a missing visual role is discovered, it must be mapped to an existing color in these tables or added to this document from an official GitHub Primer token before use.

### A.2 Foundation and editor colors

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
| `fgColor.accent` / `fgColor.link` | `#4493f8` | Accessible heading foreground, link labels, interactive links, NOTE title/icon |
| `bgColor.accent.emphasis` | `#1f6feb` | Checked-control fill and strong non-text blue edge |
| `borderColor.default` | `#3d444d` | Code edges, rules, quote guides, unchecked controls |
| `borderColor.muted` | `rgba(61, 68, 77, 0.70)` | Quiet indentation guides and secondary separators |
| `codeMirror.selection.bgColor` | `rgba(56, 139, 253, 0.40)` | Non-table prose selection background |
| `codeMirror.activeline.bgColor` | `rgba(101, 108, 118, 0.20)` | Active non-table source line background |
| `codeMirror.cursor.fgColor` | `#f0f6fc` | Non-table text cursor |
| `codeMirror.lineNumber.fgColor` | `#9198a1` | Reference gutter line-number color |
| neutral muted fill | `rgba(101, 108, 118, 0.20)` | Inline-code fill and quiet generated-chip fill |

The existing editor and table implementation already own shared canvas, gutter, selection, and active-line styling. The values above define the target and may be applied to new non-table layers, but this phase must not recolor table-owned DOM or rewrite existing table tokens to achieve them.

### A.3 GitHub Prettylights source colors

| GitHub Prettylights token | Exact value | Markdown use in this editor |
| --- | --- | --- |
| `syntax.comment` | `#9198a1` | HTML comments and secondary comment-like text |
| `syntax.constant` | `#79c0ff` | Constants, numbers, booleans, code language identifier |
| `syntax.constantOtherReferenceLink` | `#a5d6ff` | URL destinations, reference destinations, autolinks |
| `syntax.entityTag` | `#7ee787` | HTML tag names and regular-expression-like code tokens |
| `syntax.entity` | `#d2a8ff` | Types, declarations, footnote identifiers where semantic distinction helps |
| `syntax.storageModifierImport` | `#f0f6fc` | Ordinary code/source foreground |
| `syntax.keyword` | `#ff7b72` | Code keywords; YAML numeric/boolean/null scalars use the explicit constant mapping in Section 5.13 |
| `syntax.string` | `#a5d6ff` | Strings, link destinations, frontmatter string values |
| `syntax.variable` | `#ffa657` | Variables, parameters, frontmatter keys |
| `syntax.stringRegexp` | `#7ee787` | Regular expressions and comparable special string content |
| `syntax.markup.list` | `#f2cc60` | Unordered markers, ordered markers, and list syntax |
| `syntax.markup.heading` | `#1f6feb` | Frozen Prettylights reference only; editor heading foreground uses `fgColor.accent` as specified in Section 5.1 |
| `syntax.markup.italic` | `#f0f6fc` | Emphasized content plus italic font style |
| `syntax.markup.bold` | `#f0f6fc` | Strong content plus bold font weight |
| `syntax.bracketHighlighterUnmatched` | `#f85149` | Clearly invalid or unmatched syntax when diagnostics are shown |
| `syntax.bracketHighlighterAngle` | `#9198a1` | Angle brackets and quiet structural punctuation |
| `syntax.sublimeLinterGutterMark` | `#3d444d` | Quiet structural marks and guide lines |

For the supported fenced-code languages in Section 7.2, use the Prettylights values above rather than the user's current VS Code syntax colors. Exact token colors are required; cross-grammar 1:1 token boundaries are not claimed. Missing or unknown grammars use ordinary editable code source.

### A.4 Semantic and callout colors

| Semantic role | Foreground/title | Strong edge | Muted row tint |
| --- | --- | --- | --- |
| NOTE / accent | `#4493f8` | `#1f6feb` | `rgba(56, 139, 253, 0.10)` |
| TIP / success | `#3fb950` | `#238636` | `rgba(46, 160, 67, 0.15)` |
| IMPORTANT / done | `#ab7df8` | `#8957e5` | `rgba(171, 125, 248, 0.15)` |
| WARNING / attention | `#d29922` | `#9e6a03` | `rgba(187, 128, 9, 0.15)` |
| CAUTION / danger | `#f85149` | `#da3633` | `rgba(248, 81, 73, 0.10)` |
| Severe/urgent auxiliary state | `#db6d28` | `#bd561d` | `rgba(219, 109, 40, 0.10)` |

The foreground, edge, and tint values are different official roles and must not be collapsed into a single approximate color.

### A.5 Task-control colors

| State | Fill | Border or mark |
| --- | --- | --- |
| Unchecked, resting | `#212830` | `#3d444d` border |
| Unchecked, hover | `#262c36` | `#3d444d` border |
| Checked, resting | `#1f6feb` | `#ffffff` check mark |
| Checked, hover | `#2a7aef` | `#ffffff` check mark |
| Checked, active | `#3685f3` | `#ffffff` check mark |
| Keyboard focus | existing visible focus geometry with `#4493f8` color | no size change |

### A.6 Overall visual composition

Under the GitHub Dark Default reference theme, the page reads as a flat `#0d1117` source canvas with `#f0f6fc` monospace text. There are no preview-page cards and no large typographic jumps. Semantic structure appears through precise source color, font style, thin inset edges, and quiet row backgrounds.

- Blue `#4493f8` headings are the strongest recurring structural signal; `#1f6feb` is reserved for strong non-text accents and checked-control fills.
- Yellow `#f2cc60` list markers make list structure immediately scannable without turning the list into preview HTML.
- Muted `#9198a1` punctuation remains present but recedes behind content.
- Code areas form a compact `#151b23` band with `#3d444d` inset top and bottom edges.
- Links use bright `#4493f8` labels and pale `#a5d6ff` destinations.
- Callouts use one exact semantic color family while preserving every source row.
- All corners are restrained. Where a one-line control needs rounding, use a maximum radius of `6px`; do not introduce pill-shaped content except for an explicitly icon-sized control.
- Shadows are not part of the content design. Use only inset one-pixel edges needed to define code or control boundaries.
- No non-table element receives vertical margin or block padding.
