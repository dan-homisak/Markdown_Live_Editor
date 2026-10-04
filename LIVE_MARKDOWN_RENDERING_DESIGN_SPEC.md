# Live Markdown Rendering Design Specification

- Status: proposed implementation reference; features below are not yet shipped
- Reviewed baseline: commit `f9524ce`, extension `0.1.168`
- Audience: maintainers and implementation agents
- Scope: add live rendering around the existing table editor while preserving its behavior
- Review evidence: [2026-10-04 baseline review](qa/design-spec-review-2026-10-04.md)

## 1. Product vision and authority

Markdown Live Editor should feel like a VS Code source editor in which Markdown becomes easier to read and useful to interact with as you write. Preserve the precise, compact editing experience users already have, and build on the rendered table editor that makes this project distinctive.

The experience has three layers:

1. **VS Code familiarity:** the user's font, line rhythm, theme, gutter, caret, selection, and established editing behavior.
2. **Readable Markdown:** visible heading markers, meaningful emphasis, clear links, and compact code and quote treatments.
3. **Local live interactions:** bullets, task checkboxes, and rules tied to editable source positions. Tables retain their existing rendered editing surface.

A heading stays on its source line at normal editor size. A task can be checked without rewriting its item. Moving into a transformed marker reveals its characters without shifting nearby text. Switching themes preserves the same features. The existing toggle to the stock editor remains available.

GitHub Dark Default is the visual reference for restrained color and contrast, not a prerequisite. Light, dark, high-contrast, and customized VS Code themes are supported.

This document defines the target, protected behavior, and release evidence. Requirements use **must**; suggestions use **should**. Examples do not add scope. Implementation details may change when contracts and tests remain satisfied. Changes to product scope or a protected contract require an explicit revision here. Test results and environment-specific investigations belong in dated QA records, not permanent product requirements.

When requirements compete, prioritize source correctness and recoverability, existing table/clipboard behavior, editing and accessibility, stable geometry, then visual polish. Leave a non-table construct as editable styled source when a safe enhancement is unavailable. That fallback is not completion of a required feature that has never passed its release gate.

## 2. Current system and integration boundaries

Extend the existing `CustomTextEditorProvider` and CodeMirror editor. Do not replace the editor engine. The following is established from the reviewed implementation; runtime guarantees still need Section 10's baseline checks.

| Area | Current implementation | Design consequence |
| --- | --- | --- |
| Document ownership | `src/extension.ts`: VS Code `TextDocument`, serialized edit queue, revision acknowledgements, snapshot validation, `WorkspaceEdit` | Reuse this mutation path. Never create a second document or persistence path. |
| Undo and composition | `src/webview/liveEditor.ts`: host-routed undo/redo and batched source IME composition; host updates bypass local history | Verify host history and dirty state. CodeMirror `history()` and an older local-history comment do not make local undo authoritative. |
| Source coordinates | `src/shared/documentChangeMapping.ts`: LF-normalized offsets mapped to host positions and host line endings | New offsets use the same normalized document and UTF-16 convention. |
| Markdown support | `src/editor/liveEditorExtensions.ts`: default CommonMark `markdown()` and input support; no explicit code-language registry | Extend one parser configuration. Preserve existing Enter/Backspace, paste, and completion behavior unless a scoped change is documented. |
| Tables | `getParsedTables` in `src/shared/tableModel.ts`, table decoration state, and source-protection extensions | Keep the detector, block replacement, atomic ranges, and annotated table-edit path. |
| Clipboard and selection | `documentClipboard.ts`, `table/tableClipboard.ts`, `documentSelectionState.ts`, `src/shared/clipboardModel.ts` | Decorations consume the existing model and never become clipboard input. |
| Geometry and colors | `editorTheme.ts`, `editorGeometrySync.ts`, `media/liveEditor.css`, host-injected metrics | Reuse measured geometry and VS Code variables; scope new styling away from tables. |
| Lifecycle | One live editor per document; `supportsMultipleEditorsPerDocument: false`; hidden webviews retain context | Preserve this lifecycle and retention policy. |

Inventory find/replace, multi-selection, accessibility, read-only handling, wrapping modes, and host selection transfer as **verified**, **limited**, or **absent**. A webview does not automatically inherit Monaco services. Missing general integrations are future work; a capability directly needed by a new action, such as rejecting a read-only task edit, belongs to that action's implementation.

## 3. Protected contracts

### 3.1 Source, persistence, and tables

The VS Code `TextDocument` is authoritative for the entire document, including tables. The webview is a synchronized editing projection. Incomplete or invalid Markdown is a normal intermediate editing state and must remain editable.

Rendering, opening, scrolling, selection, theme changes, and parser progress must not change source, dirty state, or undo history. Preserve whitespace, delimiters, escaping, BOM, and line-ending behavior. Never serialize decorated DOM or normalize unrelated text as a rendering side effect.

Recognized tables remain rendered **within the live editor**. Caret movement, selection, focus, accessibility fallback, and non-table source reveal must never expose backing pipe source. The existing stock-editor toggle continues to expose the complete Markdown document normally.

Table recognition, editing, navigation, structure controls, selection, clipboard, source protection, row-owned line numbers, wrapping, and styling are protected. New parsing may read table source for context, but `getParsedTables` retains rendering/interaction ownership when parsers disagree. New work must not add table features or modify `.mlrt-table-*` styling. Keep table line numbers in the table DOM; do not add a separately synchronized gutter.

Preserve verified behavior, not accidental code structure. Necessary shared integration changes must be narrowly scoped and prove no change to protected behavior. A discovered table defect gets its own documented fix and evidence; it is not silently bundled into this feature.

### 3.2 Editor geometry

New non-table content uses the effective editor font family, size, line height, letter spacing, ligatures, and variation settings. Reuse `--mlrt-editor-*` metrics, including their dependency on injected `--vscode-editor-font-size`; do not calculate another unzoomed size from host settings.

Every source line remains represented in order. Wrapped continuations use the canonical line height and receive no extra source number. Headings remain normal size. No semantic block adds vertical margin, padding, or layout-affecting borders. Draw guides/edges inside existing rows. Tables retain their current independent layout.

Literal/transformed marker transitions must preserve marker advance width, following-text position, wrap points, document height, and viewport position when source and viewport are unchanged. Ordinary navigation may scroll to reveal the caret; a decoration swap must not.

Measure advances with actual font, shaping context, tabs, letter spacing, and zoom. A `ch` unit or assumed character width is insufficient. A token that wraps, has unsupported bidirectional geometry, or cannot be measured safely stays literal. Never replace a multiline range to force it into one row.

Semantic bold/italic may differ from unstyled source glyph widths. Apply those styles consistently in both presentations and test wrapping. Preserve current wrapping and indentation; new hanging indents and parity for currently unsupported Monaco wrap modes are separate work.

### 3.3 Clipboard and established input

Preserve configured defaults, Smart/Rich/Plain Text/Markdown copy, Auto/Rich/Plain Text/Markdown paste, internal payloads, metadata carriers, MIME versions, sanitization, cut/move semantics, Office imports, and prose/table/mixed-selection routing. **Ordinary copy does not become source-only copy.** Explicit Copy Markdown remains the Markdown serialization route.

Use source and existing selection/clipboard models. Generated bullets, checkbox DOM, rule chrome, and backgrounds contribute no new payload. Existing serializer-generated list markers remain intentional output.

Do not add global keyboard handlers that compete with table navigation, Markdown input, clipboard, or host undo. Outside a narrowly handled new control, events continue through the established editor path.

## 4. Appearance and theme policy

### 4.1 Visual language

Use a flat editor canvas, normal-size monospace text, visible source markers, restrained semantic color, and quiet inset surfaces. Headings gain weight, not size. Code is a compact band of source rows. Quotes and alerts use guides and labels. Controls fit inside the line box. No cards, shadows, pill-shaped labels, animated reflow, or preview-page spacing.

Only unordered bullets, task markers, and thematic-break markers may transform in this phase. Heading, emphasis, link, image, quote, fence, and frontmatter syntax stays visible.

### 4.2 Theme ownership

VS Code owns canvas, ordinary foreground, gutter, cursor, selection, active line, and focus colors. Preserve their existing implementation and user overrides. The new layer owns non-table semantic roles: heading, punctuation, list marker, link, code surface/tokens, quote guide, alert accent, and task control states.

Centralize roles under `--mlrt-markdown-*`. Prefer documented [webview theme variables](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content). Appendix A defines mappings and the GitHub reference. Webview variables do not expose arbitrary TextMate/semantic-token rules; bundled code highlighting is an explicitly mapped subset, not Monaco syntax-theme parity.

All themes receive the same parsing and interactions. Do not gate functionality on a theme name or canvas hex value. Theme changes refresh colors without reparsing source, replacing the editor, remounting tables, or moving focus. A focused generated control stays focused.

For colors this feature introduces, validate contrast against the actual composited surface. Remove unsuitable optional tints or use host foreground while preserving meaning through markers, weight, labels, and outlines. Do not override the global editor palette. Validate accessible defaults without claiming arbitrary user-authored themes are accessible.

High-contrast themes retain functionality with outlines and reduced fills. Operating-system forced-colors is separate: use system colors and visible boundaries without globally disabling forced-color adjustment. Normal-size headings and source punctuation need ordinary-text contrast; small bold headings do not qualify as large text under [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### 4.3 Styling composition

Resolve each property deliberately, not by incidental CSS order:

| Property | Precedence |
| --- | --- |
| Foreground | Code/HTML tokens and specific link/image roles override heading foreground. Heading content overrides generic emphasis/quote foreground. Delimiters use punctuation roles except heading markers/Setext underlines. |
| Weight/style | Heading bold, strong, emphasis italic, and strike compose. Code returns to configured base weight/style, including inside headings. Line height never changes. |
| Background | Code row fill overrides alert tint; inline-code fill covers its span only. Keep the active line visible and selection above semantic fills. |
| Interaction | Existing table/selection ownership wins. Decorative marks add no actions beyond source hit mapping; task controls handle only explicit activation. |

For example, in ``## **Important** [deployment](./deploy.md) `settings` ``, heading content is bold in the heading role, the link retains its role, and code retains its foreground, punctuation, and base font treatment.

## 5. Supported Markdown

Use CommonMark structure with explicitly enabled GFM strikethrough, tasks, and extended autolinks. Alerts, YAML frontmatter, and footnotes follow the bounded rules below. Tables remain independently parsed. [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) and the [GFM specification](https://github.github.com/gfm/) are reference semantics, not a claim that the installed parser passes every conformance example. Pin dependencies and record intentional dialect differences with fixtures.

| Construct | Required presentation and behavior |
| --- | --- |
| ATX/Setext headings | All markers, optional closing markers, and underline rows remain. Heading color and weight 700 at normal size/line height. Levels differ by source markers, not size. A Setext underline never becomes a rule. |
| Emphasis/strong/strike | Visible punctuation-role delimiters; italic/bold/strike content with property-specific nesting. Unmatched delimiters remain source. |
| Inline code | Preserve backticks and exact source spacing. Code foreground and inset background add no width/padding; optional radius <= 3px. Do not substitute an HTML renderer's normalized display text. |
| Links/autolinks | Labels, brackets, destinations, and titles stay visible. Distinct link roles; underline on actionable modifier-hover. Normal clicks edit; Section 6.3 governs opening. |
| Images | Preserve alt text, punctuation, and destination with related link roles. No loading/previews or link action on a bare image. An enclosing link remains actionable. |
| Lists | Preserve ordered numbers exactly. Resting unordered markers may become bullets within measured source advance. Preserve indentation, tabs, wrapping, and current input behavior. |
| Tasks | `[ ]`, `[x]`, `[X]` in task position become compact square checkboxes within measured marker advance. Checked text retains ordinary styling; no forced strike/opacity. Section 6.2 governs activation. |
| Blockquotes | Preserve all `>` markers/rows; one quiet 1px inset guide in marker space. Source conveys nesting; no added indentation or extra depth guides. |
| Alerts | Preserve `>` and `[!TYPE]`; type-colored label at weight 600, 3px inset edge, optional contrast-safe row tint. All rows/numbers remain; no icons/collapse. |
| Thematic breaks | Resting 1px centered rule is an overlay with no added advance. Preserve literal marker advance/wrapping. Engagement reveals exact source; any remaining line must not obscure it. |
| Fenced code | Preserve fences, info string, blank lines, and code. Continuous row band with inset 1px edges at existing opening/closing fences. Highlight supported languages. Valid unclosed fences continue to container/document end; never invent a closer. |
| Indented code | Preserve indentation/rows; code band without invented fence controls or guessed language. |
| HTML/comments | Literal source; style parser-identified tags, attributes, strings, punctuation, comments. Never mount document HTML as DOM. |
| Escapes/entities | Preserve literal spelling. No escaped-marker controls or entity decoding in the editing surface. |
| YAML frontmatter | All delimiters/rows remain. Style keys, strings, numeric/boolean/null scalars, comments. Quoted values remain strings; no metadata panel. |
| Reference definitions/footnotes | Visible identifiers/continuations. Resolve ordinary reference links; footnotes remain non-interactive and unrenumbered. |
| Unsupported syntax | Editable source, including math, wiki links, TOC, diagrams, unknown extensions. Style nested syntax only when the parser recognizes it. |

### 5.1 Recognition boundaries

- **Tables:** first rendering/interaction ownership. Blocks spanning tables decorate non-table portions only; no wrapper/background paints through a table.
- **Literal regions:** code, comments, and raw HTML blocks suppress marker transformations according to parser boundaries. An inline HTML tag does not make all following prose literal.
- **Tasks:** marker starts a parsed list item's content and is followed by whitespace/end-of-line. Elsewhere brackets are ordinary source. The innermost containing task owns a caret in its content; nested child tasks are separate.
- **Alerts:** exactly uppercase NOTE, TIP, IMPORTANT, WARNING, CAUTION. `[!TYPE]` is the sole content of the first quote paragraph's first source line after quote markers/whitespace. The parsed blockquote supplies extent, including lazy continuations. Unknown types are ordinary quotes. Innermost nested alerts own each row's tint/edge; no stacked controls.
- **Frontmatter:** opening `---` is the first line after an optional preserved BOM; a later standalone `---` closes it. Allow trailing horizontal whitespace on delimiters. No closer means ordinary Markdown interpretation. TOML/JSON/other frontmatter variants are not implied. Table ownership still wins.
- **Footnotes:** `[^id]` references and `[^id]:` definitions with parser-owned indented continuations, outside literal/protected regions. Use a scoped parser extension, not a document-wide regex. Unresolved labels remain source.
- **Incomplete parsing:** decorate trustworthy ranges only. Incomplete-but-valid constructs follow parser rules. Background parse completion updates visible output without another keystroke.

### 5.2 Fenced-code language boundary

Bundle JavaScript (`javascript`, `js`, `nodejs`), TypeScript (`typescript`, `ts`), JSON (`json`), shell (`bash`, `sh`, `shell`), Python (`python`, `py`), and YAML (`yaml`, `yml`). Match the first info-string word case-insensitively. JSX/TSX and further aliases are not implied.

Map parser tags to Appendix A's roles. Unknown tags use ordinary code foreground. Unknown/empty languages, including `mermaid`, retain code/source styling without guessed highlighting. No grammar downloads, execution, or language services. Declare newly imported parser/highlight packages directly and review bundle size/licenses.

## 6. Interaction contracts

### 6.1 Literal and transformed markers

These are local presentations, not editor modes. Styling remains while marker presentation changes. For a transformable token `[from, to)`, apply these rules in priority order:

| Condition or action | Result |
| --- | --- |
| Table-owned range | Existing table behavior only. |
| Composition affects token, or measurement unavailable | Literal source and stable editable DOM. |
| Generated checkbox owns focus | Keep control mounted with a mapped source bookmark until focus leaves or the task is removed. |
| Any non-empty source selection overlaps token | Reveal literal source, even unfocused; consider every supported selection range. |
| Source editor is focused and a caret touches either boundary/interior | Reveal literal source (`from <= head <= to`). |
| Otherwise | Resting transformation, when validated geometry is available. |

Arrow navigation and deletion reveal markers before entering/deleting their characters. Preserve undecorated character/grapheme and word-motion behavior; never skip a marker or split a surrogate pair. Do not add non-table atomic ranges. Existing table atomic ranges remain unchanged.

Bullet/rule clicks map to the nearest valid literal caret boundary using source geometry. Item-text clicks edit normally. Checkbox activation is distinct. Drag, Shift-selection, Select All, and host/programmatic selection preserve exact endpoints and mixed-table projection. Up/down retains the editor's preferred horizontal position.

While IME owns a composing span, do not remount it or swap markers. Revalidate after composition. Presentation updates create no host edits/history entries. If a token is deleted or becomes a table, discard its control state and use existing source/table focus recovery; never restore a stale bookmark inside protected source.

### 6.2 Task controls and commands

Activation changes exactly one character: space to lowercase `x`, or `x`/`X` to space. Preserve brackets, list marker, whitespace, item text, and unrelated source. Read current source at activation; cached DOM checked state is not authoritative.

Pointer activation preserves the existing source selection and focus owner. A focused checkbox toggles with Space, retains focus, exposes checked state and an item-derived accessible name, and has a visible outline. Escape returns to the mapped source bookmark. Do not rewrite source Tab/Shift+Tab or add a tab stop for every task in a long document.

Provide these Command Palette actions, scoped to the active live editor, with no new default shortcuts:

- **Toggle Task Checkbox at Caret:** the innermost containing task for a single collapsed source caret, including a revealed marker; a focused checkbox explicitly identifies its task. Other selections/no task produce no edit.
- **Focus Task Checkbox at Caret:** bookmark the single caret, reveal/scroll its task control if needed, and focus it programmatically (`tabindex="-1"`). This is the keyboard route into the control. Tab/Shift+Tab from the control exit through normal focus order without a trap.

Source toggling remains available when accessibility/geometry fallback keeps markers literal. If a safe control cannot be displayed, the focus command leaves the caret unchanged and explains that the toggle command is available.

Composition temporarily disables both task commands and pointer activation; do not queue a delayed toggle or focus change. Known read-only state disables mutation; the host still validates edit acceptance. Rejection restores authoritative state without retrying stale coordinates.

Each activation is one host undo step, separate from adjacent typing. Two deliberate rapid activations are two ordered actions; an acknowledgement is not another activation. Verify toggle/undo/redo, dirty-state restoration, focus, and ordering with table edits through the existing host path. Local CodeMirror history isolation alone is insufficient.

### 6.3 Links

Normal clicks place the caret. Opening requires the VS Code link modifier or **Open Markdown Link at Caret**, scoped to one caret/actionable source range. Default modifier: Ctrl on Windows/Linux, Cmd on macOS; use Alt when `editor.multiCursorModifier` is `ctrlCmd`. Honor that setting and reject AltGr/composition/drag gestures, following [VS Code's modifier convention](https://code.visualstudio.com/docs/editing/codebasics#_multiple-selections-multicursor).

Flush pending ordinary source edits and order the typed host request behind them, including document identity, source range, destination, and revision context. The host verifies that it still represents the current link and validates the URI. A document destination or arbitrary webview message must never become a command.

| Destination | Resolution |
| --- | --- |
| `http`, `https`, `mailto` | Host external-URI API, only on explicit activation. |
| Relative/absolute document path | Resolve as a URI relative to document directory, preserving local/remote scheme and authority; open with VS Code. Do not build remote paths using local OS rules. |
| Same-document heading fragment | Source heading index and existing selection guards; no webview reload or edit. |
| Cross-document heading fragment | Resolve target Markdown and heading, then open/reveal; use stock navigation where no live target exists. |
| Reference link | CommonMark label normalization/definition precedence, then destination rules. |
| Missing/unresolved target, or relative path in untitled document without a base URI | Leave editing intact; concise non-modal explanation for explicit open action. Do not guess a workspace root. |
| Executable, `command`, `javascript`, `data`, or unapproved URI scheme | Reject; no webview navigation or generic command dispatch. |

Use a pinned GitHub-compatible heading slug implementation, with fixtures for inline markup, duplicate headings, Unicode, and percent encoding. Share its policy across host/view; do not invent a second algorithm. Cache indexes by revision; heading/reference edits invalidate dependent links. Decode URI escapes once at the appropriate boundary. HTML anchors and arbitrary custom URI handlers are outside this phase.

## 7. Implementation architecture

### 7.1 One incremental projection

Pipeline: normalized document/current table ranges -> Markdown syntax/semantic ranges -> selection/focus policy -> non-table decorations/actions. Presentation state is disposable; source is not.

| Responsibility | Contract |
| --- | --- |
| Parser and classifier | One configured tree with scoped extensions and bundled code parsers; source ranges carry kind/revision identity. |
| Protected-range filter | Reuse cached `getParsedTables(doc)`. Clip passive styles outside tables; drop interactive tokens entirely on table overlap. Recheck at action time. |
| Decoration state | Map unaffected ranges through changes, invalidate affected constructs/dependencies, and compose output deterministically. |
| Measurement/focus | CodeMirror-scheduled measurement; context-keyed caches; safe focused/composing DOM retention. |
| Source actions | Pure range-to-edit task logic; typed link requests. No mutation from DOM text. |
| Theme adapter | Semantic roles/accessibility fallback without changing parser or table state. |

A `src/editor/markdown/` module group is appropriate; filenames follow implementation needs. Do not create a framework or require a file per construct. Integrate with `createLiveEditorExtensions` without recreating the editor on theme/feature changes. Keep recognition/action logic testable without a browser.

Use mark decorations for source styles, line decorations for bands/edges, and narrow inline replacements for validated markers. No multiline prose widgets, wrappers spanning tables, or hidden source rows. Respect CodeMirror's direct versus viewport-derived decoration paths: layout-changing decorations need the appropriate direct state path. See the [decoration API/example](https://codemirror.net/examples/decoration/). A viewport optimization must not create a height/viewport feedback loop.

### 7.2 Invalidation and measurement

Invalidate enclosing structural context, not just the edited line. A changed fence, indentation, reference, or frontmatter delimiter can affect distant source. Incremental parsing determines scope. Selection-only updates must not parse/scan the document. Visible-range work consults enclosing blocks when openers are offscreen.

Track source revision, parser progress, selection/focus, viewport, and metric generations separately. Map or reject stale asynchronous results. Update on background parser progress without typing. Color-only changes do not reclassify source; font/zoom/wrap changes invalidate measurements.

Preserve the source-relative scroll anchor when late parsing applies semantic styles or metrics change. Those updates may legitimately change wrapping, but must not reset the viewport to the document start or steal focus. Marker presentation changes still obey the stricter no-reflow contract in Section 3.2.

Use CodeMirror's measurement scheduling for DOM reads/writes. No synchronous per-marker layout loop on every keystroke. Dispose observers, handlers, scheduled work, and detached widget references with the view. Bound hidden-view work and resume from current source/settings.

### 7.3 CSS isolation

Use namespaced non-table classes. Do not recolor shared ancestors, redefine table tokens, use broad Markdown descendant rules, or introduce bare `table`, `tr`, `th`, or `td` selectors. Code-language highlights also exclude protected source; a global highlighter alone is insufficient isolation.

Inset edges/backgrounds add no height/advance. Widgets use `box-sizing: border-box`, introduce no line breaks, and keep hit areas clear of adjacent text/gutter. Preserve selection/caret z-order. Never fix a new decoration by changing table overflow, clipping, stacking, or line-number ownership.

## 8. Reliability, recovery, and accessibility

### 8.1 Host synchronization

[VS Code custom text editors](https://code.visualstudio.com/api/extension-guides/custom-editors#custom-text-editor) share their backing `TextDocument` with host edits. Retain the current queue, `changeId`, `baseRevision`, before/final text validation, acknowledgements, and conflict invalidation floor. Task activation is a normal validated source edit, not a second checkbox model.

Before dispatch, check current marker text, selection policy, composition, protected ranges, and known read-only state. Preserve host EOL mapping. Map bookmarks through accepted changes. Rejection/authoritative replacement invalidates pending actions and cached results; never replay against a new snapshot automatically.

New async actions settle on success, rejection, exception, or disposal. Do not strand the edit queue or leave a control pending. Reuse existing conflict reporting and opt-in debug logging. New logs should record timing/ranges/failure categories without dumping document contents by default.

Test external source edits, undo/redo, save/revert, hidden/reopened views, and stock/live switching. Do not add save handlers, file watchers, a second undo stack, or persisted generated DOM.

### 8.2 Failure containment and rollout

Add one reversible setting, `markdownLiveRenderTables.markdownRendering.enabled`. It defaults to false during development; enable by default only after release gates pass. Disabling it removes new non-table appearance/actions while preserving current tables/clipboard. This is a recovery control, not a paragraph editing mode or replacement for the stock-editor toggle.

Contain parser/measurement/renderer failures to affected non-table ranges where possible. Show literal source, cancel unsafe actions, and emit bounded diagnostics instead of an update-loop exception. If necessary, disable the new layer for that session while keeping the base editor. Never recover by clearing source, bypassing host validation, or exposing table backing source.

Distinguish parse-not-ready, unsupported syntax, unavailable geometry, and internal failure. Routine incomplete Markdown produces no warning. An explicit failed action may explain itself; ordinary typing must not produce repeated notifications.

### 8.3 Accessibility and security

Source remains the text-editing surface. Decorative bullets/guides are hidden from assistive technology. Tasks expose role/name/checked/disabled state and focus. Avoid duplicate generated/source announcements. Test reading, selection, task commands, source reveal, and table boundaries with a screen reader in an actual Extension Development Host.

If replacements impair reading/selection, use literal non-table markers with source commands under host accessibility mode. Retain semantic styling where readable and task functionality. Do not add ARIA heading elements that disrupt source editing merely to imitate a rendered page.

Pointer targets must not overlap adjacent source. Use allocated marker width/row height and retain keyboard/command alternatives at small fonts. Verify focus, control-boundary contrast, and selection in light, dark, high-contrast, and forced-colors environments. No motion is needed.

Treat source, URIs, and host messages as untrusted. Use text nodes for labels, retain CSP/resource restrictions, and validate host requests by type/document/range/operation. New rendering never executes source HTML/scripts, fetches images, loads remote grammars, or bypasses clipboard sanitization. Existing cell HTML remains table-owned.

## 9. Performance and scale

Measure added rendering cost separately from total latency. Existing table parsing/synchronization may scale with document length; record those limitations and before/after results without hiding costs or rewriting those systems here.

| Fixture | Target on the recorded reference machine |
| --- | --- |
| Comprehensive syntax | Stable geometry and correct editing through every presentation transition. |
| 10,000 mixed source lines, tables, and 2,000-character lines | Added rendering p95 <= 8ms per ordinary update after warm-up. |
| 100,000 lines with long lines/offscreen block openers | Added rendering p95 <= 16ms; bounded memory; no document-wide caret-only work. |
| Both large fixtures | Added p95 input-to-next-paint <= 16ms versus the same build with the new layer disabled. |

Use at least 200 edits, 100 selection/focus changes, and 100 scroll updates per large fixture. Measure classes separately so cheap cursor updates cannot mask typing. Include added parser work, widgets, scheduled measurement, style/layout, and deferred work; timing only a synchronous callback is insufficient.

Record p50/p95/max, total latency, initial open/parse convergence, memory after repeated scroll/theme cycles, hardware, versions, and viewport. Separately measure long-range invalidation and metric/theme changes. Milestone 0 establishes reproducible reference hardware/baselines. Missed targets need optimization or an explicit scope/target decision, not silent threshold changes or relabeling deferred work.

Prefer incremental parsing and bounded visible rendering. A worker, second renderer, whole-document DOM, or new protocol needs evidence that the current architecture cannot meet requirements. Temporary literal fallback must converge when its dependency becomes available, without another keystroke.

## 10. Delivery and verification

### 10.1 Milestones and exit gates

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| 0. Baseline and feasibility | Capability inventory, table/clipboard/geometry baselines, reference environment, feature switch, minimal bullet/task/rule prototypes | Prove marker width/reveal, focus route, composition, read-only rejection, and one host undo step before expanding rendering. Record parser/highlighter isolation and bundle choices. |
| 1. Readable source | Theme adapter; headings, emphasis/strike, inline code, links/references/images, escapes, HTML/comments | Cross-theme/nested styling, host link routing, unchanged source/clipboard, same-window visual review. |
| 2. Local live controls | Lists, tasks/commands, quotes, thematic breaks | Section 6 transition matrix, pointer/keyboard/screen-reader checks, host history/conflicts, preserved table boundaries. |
| 3. Multiline semantics | Code bands/languages, alerts, bounded frontmatter/footnotes | Offscreen opener/parse-progress correctness, wrapping/metrics, scale/lifecycle checks. |
| 4. Release | Enable by default after gates; document dialect, commands, recovery setting | Full regression suite, visual/accessibility/performance evidence, no unresolved new correctness defects. |

Deliver small working slices with source fallback. Do not postpone mixed selection, IME, table regression, or theme support to final hardening. A prototype proves a decision; it is not a shipped alternative architecture. Baseline gaps directly blocking new actions may become scoped prerequisites; broader repairs need their own plan.

### 10.2 Verification matrix

| Contract | Required evidence |
| --- | --- |
| Source integrity | No edit on render/scroll/theme/selection. Exact task-character edit; LF/CRLF, BOM, trailing whitespace, Unicode/graphemes, undo/redo, save/revert. |
| Parser boundaries | Setext/rule/frontmatter ambiguity, escaped markers, unclosed fences, literal HTML, nested lists/quotes/alerts, changed references, unknown syntax, table adjacency. |
| Marker interaction | Both arrow directions, word motion, Home/End, Backspace/Delete, pointer mapping, drag/Shift-selection, supported selection ranges, unfocused selection, composition, focus restoration. |
| Host actions | Tasks with adjacent typing/table edits, rapid toggles, stale/rejected acknowledgements, external changes, read-only rejection, link modifier settings, invalid/remote/relative/fragment/reference destinations. |
| Clipboard | Every existing copy mode across prose, tables, partial/full mixed selections; every paste mode into prose, cells/ranges, mixed selections. Include internal copy/cut/move, external Markdown, spreadsheets/Office HTML, nested lists, blank lines, Unicode, undo. Compare MIME payloads to baseline. |
| Table preservation | Existing parser/edit/navigation/clipboard tests; identical styles/layout in matched states; no new decoration, source exposure, remount-induced focus loss, or gutter clipping. |
| Geometry | Same-window stock/live ordinary-source measurements; before/after live semantic states, wrapping, tables, selection. Glyph/text boxes as well as element boxes. |
| Themes/accessibility | GitHub Dark Default reference, built-in dark/light/high-contrast, customized canvas, forced-colors separately; keyboard and actual screen-reader use. |
| Lifecycle/scale | Large fixtures, background parsing, offscreen openers, metric/theme changes, hidden/reopened/disposed views, repeated scrolling without retained DOM/work accumulation. |

Start with `standard-markdown-fixture.md`, `standard-markdown-in-table-fixture.md`, `html-in-markdown-table-fixture.md`, `TestTable.md`, and existing stress fixtures. Add focused cases; a fixture's unsupported extensions do not imply new scope. Pure tests prove ranges/edits; browser/host tests prove focus, clipboard routing, composition, undo, and layout. Synthetic IME events alone do not establish real input-method compatibility.

For visual review, compile, then run `node scripts/edh-visual-check.mjs` directly. Capture stock Monaco/live webview in the same isolated VS Code/Electron window and layout. Confirm `.view-lines` for stock and a live webview `iframe` for live. Inspect saved screenshots directly; a standalone Chrome harness cannot prove workbench parity.

Measure font family/size, line height, first-line text x/y, content-left, gutter width, line-number ink, active gutter background, and table-cell left. Convert webview-local to workbench coordinates. Geometry tolerance is at most 0.5 CSS px. Compare computed colors, not antialiased pixels. Table comparisons use identical environment/state; mask only documented transient caret regions.

Cover wrapping on/off; narrow/wide editor viewports (target 360px/800px where feasible); default metrics and 20px font/30px line height; default/1px letter spacing; zoom 0/1; fractional scaling on an available machine. Record actual editor width, VS Code/Electron/extension/theme versions, font settings, DPI/device-pixel ratio, and sidebar/chat/minimap layout. Exact stock wrap parity applies to verified baseline settings, not every Monaco mode.

Keep baseline failures in dated QA records with reproduction and affected assertions. Determine product versus harness versus environment failure before changing a gate. Never weaken table/clipboard expectations to accommodate rendering. Unavailable OS, display, screen-reader, or IME coverage is incomplete validation, not a pass.

### 10.3 Definition of done

A milestone is complete when required features work, protected behavior passes regression checks, edits stay exact and host-undoable, and rendered content has been inspected in the workbench. Release also requires the theme/accessibility matrix, lifecycle/scale evidence, and working disable/recovery path.

Run `npm run compile`, `npm test`, and relevant direct Extension Development Host checks. On Windows with PowerShell script restrictions, use `npm.cmd`. Resolve red Problems diagnostics in touched implementation files, including editor-only diagnostics. Follow `AGENTS.md`: after repository changes run `./Build_and_Install` (`Build_and_Install.cmd` on Windows) and verify installation. Editing this spec alone does not establish that future feature gates have passed.

## 11. Explicit non-goals

- Table behavior, styling, recognition, cell rendering, or clipboard redesign.
- A replacement editor, second persisted document, or new undo/synchronization system.
- Preview-page typography, hidden source blocks, folding, large images, diagrams, math/media, or executable HTML.
- New clipboard modes, code-copy overlays, image chips/previews, alert icons, footnote navigation, or extra indentation guides.
- General find/replace, diagnostics, multi-cursor integration, split live editors, or unrelated indentation/wrapping/keybinding changes.
- Exact GitHub website layout/tokenization or full Monaco syntax-theme/service parity.

These boundaries apply to this phase, not permanently to the product. Future work must preserve the contracts or explicitly revise them with migration and regression evidence.

## Appendix A. Semantic roles and GitHub reference

The previous design's GitHub values remain the visual reference, originally pinned to [Primer Primitives commit f48bc063f7bc0fb3e447386a8c259650ce46dea8](https://github.com/primer/primitives/tree/f48bc063f7bc0fb3e447386a8c259650ce46dea8). They do not authorize recoloring the workbench, tables, or user theme. Record/verify the installed GitHub theme version; a historical Primer pin need not exactly match every theme release.

| Role | Theme mapping / fallback | GitHub Dark reference |
| --- | --- | --- |
| Canvas, ordinary text, gutter, cursor, selection, active line | Existing VS Code-derived implementation remains authoritative | Canvas `#0d1117`, text `#f0f6fc`; other roles follow host theme |
| Heading/link label | `textLink.foreground`, then editor foreground | `#4493f8` |
| Punctuation/comments | `descriptionForeground`, then editor foreground if contrast insufficient | `#9198a1` |
| List marker | `editorWarning.foreground`, then link/ordinary foreground | `#f2cc60` |
| Inline-code foreground / link destination | `textPreformat.foreground` / `textLink.foreground`, then editor foreground | `#a5d6ff` |
| Inline-code surface | `textPreformat.background`, then transparent | `rgba(101, 108, 118, 0.20)` |
| Code band | `textCodeBlock.background`, then editor background | `#151b23` |
| Quote/rule/code edge | `textBlockQuote.border`, then `contrastBorder`, then host foreground outline as needed | `#3d444d` for decorative edges |
| Task fill/mark/border | `checkbox.background`, `checkbox.foreground`, `checkbox.border`; distinct check mark and visible boundary | Dark unchecked fill; blue checked fill/white mark, subject to contrast |
| Control focus | `focusBorder`, then `contrastActiveBorder`, then host foreground | `#4493f8`, no geometry change |
| Alert NOTE/TIP/IMPORTANT/WARNING/CAUTION | `editorInfo.foreground` / `testing.iconPassed` / link foreground / `editorWarning.foreground` / `editorError.foreground`; fallback to foreground plus type label | `#4493f8` / `#3fb950` / `#ab7df8` / `#d29922` / `#f85149` |

Token names become webview CSS variables by replacing dots with hyphens under `--vscode-`. Missing/transparent values need explicit fallbacks. Alert tints are optional low-opacity derivatives of the resolved accent, removed when contrast/selection suffers. Use one resolver, not isolated hardcoded rules.

For GitHub Dark reference code highlighting: comments `#9198a1`, constants/numbers `#79c0ff`, declarations/types `#d2a8ff`, keywords `#ff7b72`, strings/destinations `#a5d6ff`, variables/parameters `#ffa657`, tags/regex `#7ee787`. Unknown tags use ordinary foreground. YAML keys use variable; quoted values string; numeric/boolean/null scalars constant.

Other themes use semantic UI roles for headings/links/controls and contrast-checked bundled light/dark code palettes. Centralize and record exact non-reference code palettes with Milestone 1 visual evidence; they are inputs to verify, not a reason to disable rendering. High-contrast uses host foreground/non-color distinctions where needed. Do not scrape theme files or rely on private workbench APIs to imitate TextMate colors.

The reference heading is `#4493f8`. Prettylights `#1f6feb` has approximately 4.08:1 contrast on `#0d1117`, insufficient for these normal-size headings. Quiet decorative borders alone may not identify a checkbox adequately: validate actual boundary/mark contrast and use a stronger host-derived outline where needed. Accessibility and theme ownership take precedence over literal reference colors.
