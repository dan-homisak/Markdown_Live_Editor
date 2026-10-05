# Live Markdown Rendering Design Specification

- Status: target design; new non-table rendering is not yet implemented
- Reviewed baseline: commit `db29a34`, extension `0.1.169`
- Audience: maintainers, designers, and implementation agents
- Evidence: [engineering review, 2026-10-04](qa/design-spec-engineering-review-2026-10-04.md); [earlier baseline review](qa/design-spec-review-2026-10-04.md)

## 1. Product direction

**Make Markdown feel alive while keeping the precision, density, and trust of a VS Code source editor.** The existing editable tables are the foundation. Extend that experience to the surrounding document without making users relearn selection, typing, navigation, or moving content between applications.

The distinctive choice is to render meaning in place. Headings gain emphasis on their original lines. Code becomes easier to scan inside the editor's line rhythm. Tasks become useful controls. Tables remain editable grids. Markdown syntax stays available where the user is working, and the document does not rearrange itself as the caret moves. Ease of use comes from predictable behavior and discoverable actions, rather than from hiding every delimiter.

### 1.1 The experience to build

| User intent | Expected experience |
| --- | --- |
| Read a mixed document | Headings, emphasis, lists, quotes, code, and tables have a coherent hierarchy on one compact canvas. The user's font and VS Code theme define the environment. |
| Write or correct Markdown | Click into text and type immediately. Heading, emphasis, link, and fence syntax remains visible. A transformed bullet, task marker, or rule reveals its exact characters when engaged. |
| Complete a task | Click its checkbox or use the task command. Only its check character changes; selection stays useful and one Undo reverses the action. |
| Edit a table and continue writing | Existing cell editing, structure controls, navigation, selection, and clipboard behavior work as before. No competing prose controls appear inside tables. |
| Select or move content | Drag, Shift-select, cut, copy, and paste use the established document selection model, including mixed prose/table content. Decorations never become accidental content. |
| Inspect all source | The existing toggle opens VS Code's stock Markdown editor, including table source. Returning to live editing does not convert or rewrite the file. |

There are two editor surfaces: the stock source editor and the live editor. Within the live editor, local marker reveal is a presentation change, not another editing mode. There is no paragraph-wide edit/read switch, preview pane, or focus-triggered block expansion.

GitHub Dark Default is a reference for restrained color and contrast. The feature works in light, dark, high-contrast, and customized VS Code themes. Theme identity never enables or disables syntax or actions.

### 1.2 Authority and priorities

This document defines product contracts and the next rendering release. **Must** and unqualified behavioral statements denote requirements; **should** allows an evidenced implementation choice. Examples illustrate scope rather than extending it. Update this document when changing a contract or release scope; keep experiments and dated measurements in QA records.

Resolve tradeoffs in this order: source correctness and recovery; existing table and clipboard behavior; editing and accessibility; predictable geometry; visual polish. An unsafe enhancement falls back to editable source. A required feature that always falls back is unfinished.

Implementation may reorganize code when these contracts remain satisfied. This is a design for extending the product, not a requirement to preserve every current implementation detail.

## 2. Existing system and protected contracts

### 2.1 Integration map

Extend the existing `CustomTextEditorProvider` and CodeMirror editor. Integrate with the ownership already established in the repository.

| Responsibility | Existing owner | Implication |
| --- | --- | --- |
| Document and persistence | `src/extension.ts`: VS Code `TextDocument`, serialized queue, snapshot validation, `WorkspaceEdit`, acknowledgements | Use the existing mutation path and host undo. No second document, save path, or undo authority. |
| Synchronization and IME | `src/webview/liveEditor.ts`: optimistic edits, reconciliation, composition batching, host commands | Presentation is disposable; pending source edits are not. Reuse reconciliation and composition boundaries. |
| Coordinates | `src/shared/documentChangeMapping.ts` | Use UTF-16 offsets in the LF-normalized snapshot; map to host positions and EOLs through existing helpers. |
| Markdown support | `src/editor/liveEditorExtensions.ts`: CommonMark `markdown()` and input support | Configure one editor Markdown parser. Preserve Enter/Backspace, completion, and paste behavior while adding syntax. |
| Tables | `getParsedTables`, table decorations, annotated cell edits, source guards | Keep table recognition, replacement ranges, atomic navigation, and interaction ownership. |
| Selection/clipboard | `documentSelectionState.ts`, `documentClipboard.ts`, `table/tableClipboard.ts`, `clipboardModel.ts` | Consume the existing model, including mixed selections. Never derive clipboard data from decorated DOM. |
| Layout/theme | `editorTheme.ts`, `editorGeometrySync.ts`, `media/liveEditor.css`, host metrics | Reuse effective editor metrics and theme variables; isolate new non-table styles. |

Preserve the lifecycle: one live editor per document, with hidden webviews retained. A webview does not inherit Monaco services. Inventory find/replace, multi-cursor behavior, read-only awareness, accessibility, wrap modes, and stock/live selection transfer as verified, limited, or absent. Do not advertise absent capabilities as part of this release.

### 2.2 Source integrity

The VS Code `TextDocument`, including unsaved changes, is authoritative. Rendering, parsing, scrolling, selection, theme changes, and marker reveal must not edit source, dirty state, or undo history. Incomplete Markdown is normal input, not an error requiring repair.

Preserve untouched characters, whitespace, escaping, and delimiters. Leave encoding, BOM, save behavior, and line endings under existing host ownership; rendering introduces no normalization and makes no byte-level promise about VS Code saves. Never serialize generated DOM back into Markdown.

Every new mutation describes the smallest intended source edit against a known snapshot. A rejected edit resynchronizes from the current host document, which may itself be dirty. Never recover from disk or automatically replay an action at stale coordinates.

### 2.3 Tables and clipboard

Recognized tables remain rendered inside the live editor. Non-table source reveal, accessibility fallback, or rendering failure must not expose their backing pipe source. The stock editor still exposes the complete document. This protects recognized ranges; it does not freeze recognition after a legitimate source edit changes the document.

When parsers disagree, `getParsedTables` owns rendering and interaction. Non-table styles and actions must exclude those ranges, including row backgrounds and nested-language highlights. Record dialect disagreements as fixtures; do not silently change recognition to make parsers agree.

Protect table editing, navigation, structure controls, selection, wrapping, row-owned line numbers, and styling. Preserve `.mlrt-table-*` rules and table tokens. Keep line numbers in table rows; a separate gutter synchronized by `ResizeObserver` is not an acceptable replacement. Shared integration changes need focused regression evidence. Discovered table defects get separately documented fixes.

Preserve Smart/Rich/Plain Text/Markdown copy, Auto/Rich/Plain Text/Markdown paste, configured defaults, internal payloads/MIME versions, metadata, sanitization, Office imports, and cut/move semantics. Ordinary Copy keeps its existing behavior; Copy Markdown remains the explicit Markdown serialization route. Generated controls contribute no clipboard payload. Existing serializer-generated list markers remain intentional output.

### 2.4 Geometry and ordinary input

Use effective editor font, size, weight, line height, letter spacing, ligatures, and variation settings through existing `--mlrt-editor-*` metrics. Preserve their use of injected `--vscode-editor-font-size`; do not introduce a competing unzoomed size calculation.

Non-table source lines remain in order at the canonical line height. Wrapped continuations receive no additional source number. Headings remain normal size. No semantic block adds vertical spacing or layout-affecting borders. Tables retain their independent layout.

With source, semantic styling, and viewport unchanged, marker reveal must preserve following-text position, wrap points, document height, and viewport position. Preserve actual shaped marker advance, excluding adjacent whitespace. Measure in context, including tabs, zoom, and letter spacing; character counts and `ch` alone are insufficient. Wrapped or unsafe bidirectional markers stay literal. Never replace multiline ranges to force them into one row.

Semantic bold/italic can change glyph widths relative to stock source. Apply the same styles in both marker presentations. Stock/live parity concerns ordinary source and editor chrome; marker stability compares the same live content before and after reveal. Neither promises identical stock wrapping for styled headings.

Preserve existing input and wrapping. Do not add global handlers that compete with table navigation, clipboard, Markdown input, or host undo. New hanging indentation and unsupported Monaco wrap modes are separate work.

## 3. Rendering language and release scope

### 3.1 Visual system

Use a flat canvas, monospace text, meaningful weight, restrained semantic colors, and inset code/quote treatments. The document should feel more readable without feeling larger. Avoid cards, shadows, badges, preview-page spacing, and animated reflow.

Only unordered bullets, task markers, and thematic-break markers transform in this release. Heading, emphasis, link, image, quote, fence, and frontmatter syntax stays visible. Each generated visual must have a clear reading or editing benefit.

VS Code owns canvas, ordinary text, gutter, caret, selection, active line, and focus colors. Centralize non-table semantic roles under `--mlrt-markdown-*`, using [documented webview theme variables](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content). Appendix A gives defaults and reference colors. Arbitrary TextMate rules are not exposed through those variables; code highlighting is a bundled subset, not Monaco syntax-theme parity.

Theme updates recolor existing content without reparsing, replacing the editor, remounting tables, or losing focus. Font and zoom changes require measurement invalidation, not just recoloring.

| Property | Composition rule |
| --- | --- |
| Foreground | Specific code/HTML tokens and link/image roles override heading color. Heading content overrides generic emphasis/quote color. Delimiters use punctuation roles, except heading markers and Setext underlines. |
| Weight/style | Heading bold, strong, italic, and strike compose. Code uses configured base weight/style even within headings. Line height stays fixed. |
| Background/edges | Code bands override alert tint; inline-code fill covers only its span. Edges are inset. Caret, selection, active line, and focus remain distinguishable above semantic treatments. |
| Interaction | Table and document-selection ownership wins. Decorative marks map hits to source; only explicit controls consume activation. |

For example, in ``## **Important** [deployment](./deploy.md) `settings` ``, the heading remains one normal-size source line, the link keeps its color, and code keeps its own foreground and base font treatment. Resolve properties deliberately rather than through incidental CSS order.

### 3.2 Required constructs

Use CommonMark structure with explicitly enabled GFM strikethrough, tasks, and extended autolinks. Tables stay independently parsed. [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) and [GFM](https://github.github.com/gfm/) provide reference semantics, not a blanket conformance claim. Pin resolved dependencies in the lockfile and capture intentional differences in fixtures.

| Construct | Required presentation |
| --- | --- |
| ATX/Setext headings | Color and weight 700 at normal size. Preserve opening/closing markers and underline rows. Levels differ through source markers; Setext underlines never become rules. |
| Emphasis, strong, strike | Style content; retain punctuation-role delimiters. Compose nested styles. Unmatched delimiters remain source. |
| Inline code | Keep backticks and exact spaces. Quiet inset fill with no padding or width change; no renderer-style space normalization. |
| Links, autolinks, references | Keep labels, brackets, destinations, titles, and definitions. Distinguish text roles; underline only on actionable modifier-hover. Section 4.3 governs opening. |
| Images | Keep alt text and destination with related link roles. No fetch, preview, or bare-image action; an enclosing link may be actionable. |
| Lists | Preserve ordered numbers, indentation, tabs, and wrapping. Resting unordered markers become bullets when geometry is safe. A task's list marker remains independently represented. |
| Tasks | Compact square checkboxes for supported markers. Checked text retains ordinary styling; no automatic strike or dimming. |
| Blockquotes | Keep all `>` markers and rows. One quiet inset guide uses existing marker space; source expresses nesting without extra indentation or stacked guides. |
| Alerts | Keep `>` and `[!TYPE]`. Type-colored label at weight 600, inset accent edge, optional subtle row tint. No icons, collapse, or extra rows. |
| Thematic breaks | Quiet centered rule on the existing row. Preserve source advance/hit mapping; literal reveal removes any overlay obscuring text. Rule chrome does not capture clicks beyond its source range. |
| Fenced/indented code | Continuous row fill including blank rows; inset edges at existing fence rows. Keep fences, info strings, indentation, and source. Never invent a closer or guess an indented block's language. |
| HTML/comments | Literal source with parser-based token styling. Never mount document HTML as DOM. Inline tags do not make all following prose literal. |
| Escapes/entities | Preserve spelling; no entity decoding or escaped-marker transformation in the editing surface. |
| YAML frontmatter | Keep delimiters/rows; style keys, strings, scalars, and comments. No metadata panel, validation service, or source rewrite. |
| Other syntax | Editable source. Existing recognized nested syntax may retain styling; no new controls for unsupported extensions. |

### 3.3 Recognition rules

Recognize structure rather than using independent document-wide regexes. Code, comments, and HTML literal regions suppress transformations according to parser boundaries. Apply table protection after classification and again before actions.

**Tasks:** the first paragraph of a parsed list item starts with `[ ]`, `[x]`, or `[X]`, followed by whitespace or end-of-line. Other spellings stay literal. The ASCII-space toggle subset and end-of-line acceptance are explicit product rules, not a claim that every GFM whitespace variant is interactive. Commands target the nearest enclosing list item, which must itself be a task. A nested ordinary item must not unexpectedly toggle its parent task. Carets inside literal code or protected tables do not target containing tasks.

**Alerts:** exactly uppercase NOTE, TIP, IMPORTANT, WARNING, and CAUTION, with `[!TYPE]` as the sole content of the first source line of the first quote paragraph. The parsed quote supplies extent, including lazy continuations. Unknown types remain quotes; the innermost alert owns a row's accent/tint.

**Frontmatter:** opening `---` is the first line after an optional BOM present in the text; a later standalone `---` closes it. Delimiters allow trailing horizontal whitespace. Without a closer, use ordinary Markdown interpretation. TOML/JSON variants are outside scope. Existing table ownership still wins inside this region; capture that limitation explicitly.

Bundle code highlighting for JavaScript (`javascript`, `js`, `nodejs`), TypeScript (`typescript`, `ts`), JSON (`json`), shell (`bash`, `sh`, `shell`), Python (`python`, `py`), and YAML (`yaml`, `yml`). Match the first info-string word case-insensitively. Unknown languages retain code styling. No grammar downloads, execution, language services, or implied JSX/TSX support. Declare imported packages directly; record bundle-size/license impact.

Special footnote parsing/navigation, heading-fragment navigation, HTML anchors, and cross-document heading indexes are deferred. Their source remains editable. These introduce independent resolution policies and are not prerequisites for the core live-editing experience.

## 4. Interaction contracts

### 4.1 Marker presentation

For a transformable token `[from, to)`, resolve presentation in this order. Consider effective document selection, including mixed-selection projection, not just CodeMirror's primary caret.

| Condition | Presentation |
| --- | --- |
| Table-owned or invalidated token | Existing table behavior, or ordinary source if no longer valid. Cancel its new control state. |
| Composition in progress | Freeze affected composing DOM; never introduce or swap a replacement over it. Task actions are unavailable, not queued. |
| Feature disabled, accessibility fallback, or unsafe geometry | Literal source. Return control focus safely before removing a focused control. |
| Any non-empty source selection overlaps the token | Literal source, even unfocused. Source selection takes precedence over generated-control focus. |
| Explicit task-control focus | Keep that validated checkbox mounted with a mapped source bookmark. The focus command is the explicit exception to caret-driven reveal. |
| Focused source caret touches boundary/interior | Literal source (`from <= head <= to`). |
| Otherwise | Resting transformation when syntax and geometry are ready. |

Arrow motion and deletion operate on ordinary characters/graphemes. Reveal before navigation or deletion would skip hidden characters; do not add non-table atomic ranges. Bullet/rule clicks map to the nearest valid literal source position. Item-text clicks edit normally. Preserve Home/End, word motion, preferred horizontal position, drag, Shift-selection, Select All, and supported selection endpoints.

Hover alone does not reveal source. Dragging or modified selection gestures never toggle a checkbox; disambiguate activation from selection before editing. Presentation-only transactions create no host edits/history entries.

When parsing or geometry becomes ready, refresh without another keystroke. Never expose stale actions while waiting. Temporary fallback must converge for supported syntax/settings; permanent fallback is reserved for declared unsupported geometry or accessibility needs.

### 4.2 Task controls

Activation changes one UTF-16 code unit: space to lowercase `x`, or `x`/`X` to space. Preserve all other text. Read current source when creating the edit; DOM checked state is only a projection.

Pointer activation keeps the source caret or table selection and returns focus to its previous editing owner. An already keyboard-focused checkbox retains focus. Space toggles a focused checkbox; Escape returns to its mapped source bookmark. Expose an item-derived accessible name, checked/disabled state, and visible focus indication.

Provide **Toggle Task Checkbox at Caret** and **Focus Task Checkbox at Caret** in the Command Palette, with no new default shortcuts. Add the toggle action to the existing editor context menu when applicable. Toggle uses one collapsed caret under Section 3.3's ownership rule, or an explicitly focused checkbox; other selections produce no edit. Preserve the invoking editor's last intentional editing context while the palette takes focus. Commands must not fall through to another document.

The focus command bookmarks the caret, brings its control into view, and focuses it programmatically. Do not add thousands of sequential Tab stops (`tabindex="-1"`). Source Tab/Shift+Tab stays unchanged; those keys leave a focused control through normal focus order. If a safe control cannot be displayed, leave the caret unchanged and explain that the toggle command remains available. Source toggling also works during literal-marker accessibility/geometry fallback.

Keep pointer targets inside allocated marker width/line height, without overlapping adjacent text. A concise hover hint and context action make the keyboard route discoverable at small fonts.

Each activation is one host undo step, separate from adjacent typing. Two rapid toggles are two ordered edits derived from successive optimistic snapshots, not from one stale DOM value. Acknowledgements neither retoggle nor overwrite later optimistic edits. Verify this through actual host history, not just local transaction annotations.

Establish read-only capability for new mutations using supported host information and final host acceptance; scheme alone is insufficient. During composition, reject activation without queuing it. Rejection reconciles host state and discards dependent actions. Disabling rendering must let already submitted edits settle through normal acknowledgement/rejection.

If a focused task disappears, changes ownership, leaves the rendered viewport, or rendering is disabled, release control focus to a valid mapped source position if it still owns focus. Preserve any newer source selection instead of restoring an obsolete bookmark. Do not pin offscreen widgets indefinitely, focus hidden views, or steal focus from the workbench. Never restore a bookmark inside protected table source.

### 4.3 Links

Normal clicks edit. Opening requires the VS Code link modifier or **Open Markdown Link at Caret**, scoped to one actionable link in the invoking editor. Use Ctrl on Windows/Linux and Cmd on macOS by default, or Alt when `editor.multiCursorModifier` is `ctrlCmd`, following [VS Code's modifier convention](https://code.visualstudio.com/docs/editing/codebasics#_multiple-selections-multicursor). Reject AltGr, composition, and drag/selection gestures.

The initial action scope is HTTP, HTTPS, mailto, and fragment-free document paths, including resolved reference links. Resolve paths as URIs relative to the document directory, preserving local/remote scheme and authority. Untitled documents without a base URI must not guess a workspace root. Open files through VS Code as text documents; no generic executable launch or command dispatch. Other schemes and document-heading fragments remain source-only, with a concise explanation on explicit command use. External HTTP(S) fragments pass through normally.

Flush pending edits and order the request behind them. Bind it to the invoking panel/session, snapshot, and source range. The host derives or verifies the destination from source before applying a narrow URI allowlist; a supplied destination alone is insufficient. Share pure recognition/resolution policy between host and view, with on-demand host verification rather than a second persistent rendering model. Preserve reference-label normalization/definition precedence. Decode URI components only at the appropriate parsing boundary.

No action navigates the webview. Reject `command:`, `javascript:`, `data:`, and arbitrary custom handlers. Failed/unsupported opens leave editing intact and report only on explicit activation. Do not style unsupported targets as actionable. This scope avoids requiring a workspace index or heading-slug policy for the rendering release.

## 5. Architecture and reliability

### 5.1 One source projection

```text
CodeMirror document + existing protected table ranges
  -> incremental Markdown tree and semantic ranges
  -> table exclusion + selection/focus/accessibility policy
  -> source marks, row treatments, measured inline controls
```

One configured CodeMirror Markdown parser owns new editor classification. Existing table and clipboard parsers keep their responsibilities; “one parser” does not mean replacing them. Host actions may reuse pure parsing helpers on demand. No renderer reads its DOM back as a semantic model.

| Component | Responsibility |
| --- | --- |
| Classifier | Construct ranges/dependencies from syntax, including enclosing offscreen blocks. No source mutation. |
| Protection/composition | Clip passive marks/row treatments outside tables; drop interactive tokens on any table overlap. Resolve styles and effective selection. |
| Decoration state | Map unaffected ranges; invalidate changed constructs. Render necessary visible content with bounded overscan. |
| Measurement/focus | CodeMirror-scheduled reads/writes, metric-aware caches, composing/focused DOM retention, mapped bookmarks. |
| Source actions | Pure task edit calculation and typed link requests through existing synchronization. |
| Theme adapter | Resolve roles and contrast fallback without changing source/parser state. |

A `src/editor/markdown/` module group is sufficient; no generic framework or mandatory file per construct. Recognition and edit planning should be testable without a browser.

Use marks for inline styles, line decorations for row treatments, and narrow replacements for proven marker geometry. Never wrap prose into multiline widgets or hide source rows. Honor CodeMirror's direct versus viewport-derived decoration restrictions: block replacements and replacements crossing line breaks cannot come from a viewport-derived provider. Check installed API declarations when implementing; see the [decoration reference](https://codemirror.net/docs/ref/#view.EditorView.decorations).

Do not install a global nested-language highlighter that paints table-owned source. Namespaced classes and final protected-range filtering cover every decoration path. Avoid broad Markdown descendant rules and bare table-element selectors.

### 5.2 Invalidation and bounded work

Track document identity separately from host acknowledgement revision, syntax progress, selection/focus, viewport, and metrics. Host revision also advances for snapshots; it is not a sufficient key for optimistic local text. Use immutable document identity or an equivalent local generation for source caches.

Edits can invalidate enclosing or distant structure: fences, indentation, frontmatter, and references are not line-local. Map only semantically valid ranges and reclassify affected dependencies. An incomplete tree is not proof that a region is plain text. Decorate trustworthy ranges and update on background parse progress.

Selection-only updates must not scan/parse the whole document. Color changes do not invalidate syntax; font/zoom/wrap changes invalidate measurements. Preserve a source-relative scroll anchor when late styling changes wrapping; marker reveal retains the stricter no-reflow contract.

Use scheduled measurement and bounded caches, not synchronous per-marker layout on every keystroke. Dispose observers, handlers, pending work, and detached DOM with the view. Hidden views stop unnecessary presentation work and resume from current source/settings.

### 5.3 Mutation and recovery

Retain the serialized queue, `changeId`, `baseRevision`, exact before/final snapshot validation, acknowledgements, and conflict floor. Above that floor, an older base revision is not automatically stale if the exact before-snapshot is the valid successor of earlier queued edits; preserve current validation semantics. Task actions are ordinary validated source edits. Small typed message additions may use this queue; a second synchronization protocol may not.

Before dispatch, revalidate source, ownership, selection, composition, and known read-only state. Authoritative replacement/rejection invalidates dependent actions, syntax results, and unsafe bookmarks. Every new async action settles on success, rejection, exception, or disposal. Never strand the queue or leave a permanently pending control.

Add one recovery setting: `markdownLiveRenderTables.markdownRendering.enabled`. Default false during development; enable by default only after release gates pass. Disabling removes new appearance/actions while preserving tables, clipboard, selection, and base Markdown input. Reconfigure in place, cancel unsent control intents, and let submitted source edits settle. Check parser-dependent input behavior with the switch both on and off; removing decorations alone is not sufficient recovery. The stock-editor toggle remains the complete source route.

Contain failures to affected non-table presentation where possible. If necessary, disable the new layer for the session while keeping the base editor usable. Incomplete syntax and temporary parse/measurement delay are quiet fallback states. Internal failures use bounded diagnostics and at most a concise actionable notification; no repeated typing-time warnings. Logs contain categories, ranges, and timings without document content by default.

Prove recovery after rendering-layer initialization/update failure. CodeMirror dropping a failed plugin is not, by itself, proof that source input, selection, and table protection remain intact.

### 5.4 Accessibility and security

Source remains the text-editing surface. Decorative bullets/guides are hidden from assistive technology; tasks expose role, name, state, and focus without duplicate source/control announcements. Do not add ARIA heading widgets that interrupt text editing merely to resemble a preview page.

Under host accessibility mode, use literal non-table markers if replacements impair reading/selection, while retaining task commands and readable styles. Validate the available VS Code/webview accessibility signal during feasibility work rather than inventing one. Test with an actual screen reader in the Extension Development Host.

Validate introduced colors on their composited background. Normal-size text, including headings/punctuation, targets at least 4.5:1 contrast under [WCAG text guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Interactive boundaries, state indicators, and focus must remain distinguishable. Remove optional tints or use host foreground when needed; do not recolor the global palette or claim accessibility for arbitrary user themes.

High-contrast themes use visible outlines and reduced fills. Test OS forced-colors separately, using system colors where needed without globally disabling forced-color adjustment. No motion is required.

Treat Markdown, destinations, and messages as untrusted. Use text nodes for labels; retain CSP/resource restrictions and clipboard sanitization. Validate host requests against originating document/session and operation. No source HTML execution, image loading, remote grammar fetch, or content-driven commands. Existing cell HTML remains table-owned.

## 6. Delivery and evidence

### 6.1 Ordered milestones

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| 0. Baseline and feasibility | Capability inventory, reproducible environment, feature switch, minimal bullet/task/rule prototypes | Prove no-reflow reveal, navigation/deletion, focus recovery, real composition, read-only rejection, one host undo step, and table/highlighter isolation. |
| 1. Readable source | Theme adapter; headings, emphasis/strike, inline code, links/images, literal HTML/comments | Nested styling, all theme classes, unchanged source/clipboard, same-window visual inspection. Remain behind the switch. |
| 2. Local interactions | Bullets, tasks/commands, quotes, rules, bounded link opening | Section 4 behavior, mixed selection, host history/rejection, real input methods, keyboard/screen-reader use. |
| 3. Multiline rendering | Code bands/languages, alerts, bounded frontmatter | Offscreen context and parse convergence; wrapping, lifecycle, and scale evidence. |
| 4. Default release | Enable rendering; document dialect, actions, limitations, recovery | Full regression evidence, no unresolved new correctness defects, performance/usability review, working disable path. |

Feasibility is a decision gate. Before dependent implementation, prove marker geometry, task undo/read-only behavior, and focus/accessibility under replacement and virtualization. If a proof fails, change the implementation or explicitly revise the affected contract here. Do not silently ship permanent fallback as the intended interaction.

Deliver small working slices. Table regression, clipboard, themes, and composition belong in each affected slice, not final hardening. Broader baseline repairs need a separate plan unless they directly block a required new action.

### 6.2 Verification matrix

| Contract | Required evidence |
| --- | --- |
| Source/history | No edits on render/scroll/theme/selection. Exact task edits; LF/CRLF, host BOM/encoding behavior, Unicode, whitespace, save/revert, dirty-state restoration. Rapid toggles with typing/table edits, external changes, rejected acknowledgements. |
| Syntax | Setext/rule/frontmatter ambiguity, escapes, unclosed fences, nested lists/quotes/alerts, inline HTML versus blocks, changed references, table adjacency/disagreements. |
| Marker input | Both arrow directions, word motion, Home/End, Backspace/Delete, hit mapping, drag/Shift-selection, every supported range, unfocused mixed selection, focus commands, viewport eviction, real IME. |
| Clipboard/tables | Existing suites and each copy/paste mode across prose, cells/ranges, partial/full mixed selections. Compare payloads and cell styles to baseline; Office HTML, internal cut/move, nested lists, blank lines, Unicode. No source exposure, focus loss, or gutter regression. |
| Links | Modifiers, active-editor routing, stale requests, references, encoded/relative/remote paths, untitled sources, missing files, rejected schemes/fragments. |
| Theme/accessibility | GitHub Dark Default reference; built-in dark/light/high-contrast; customized canvas; forced-colors separately. Keyboard and actual screen-reader checks. |
| Lifecycle/recovery | Disable/re-enable during pending edits, rendering failures, external changes during composition, hidden/reopened/disposed views, metric changes, no retained widget/work growth. |

Start with `standard-markdown-fixture.md`, `standard-markdown-in-table-fixture.md`, `html-in-markdown-table-fixture.md`, `TestTable.md`, and stress fixtures; add focused cases. Unsupported fixture syntax does not add scope. Pure tests establish ranges/edits; host/browser checks establish history, focus, clipboard, composition, and layout. Synthetic IME events alone are insufficient.

Visual evidence compares stock Monaco/live CodeMirror in one isolated VS Code/Electron window and workbench layout. Compile, then run `node scripts/edh-visual-check.mjs` directly. Confirm stock `.view-lines` and a live webview `iframe`; save and inspect screenshots. The Chrome harness is useful for smoke checks but cannot prove workbench parity.

Measure ordinary-source font/size, line height, content-left, gutter width, first text/glyph positions, line-number ink, active-line/gutter background, and table-cell left. Convert webview-local into workbench coordinates. Tolerance is at most 0.5 CSS px; element alignment alone is insufficient. Compare unchanged tables in identical state/environment. Compare marker transitions within live rendering rather than against unstyled stock glyph widths.

Cover narrow/wide viewports, wrapping on/off, default metrics and 20px font/30px line height, default/1px letter spacing, zoom 0/1, and available fractional scaling. Record actual widths, font, DPI/device-pixel ratio, theme/host versions, and sidebar/chat/minimap layout. Classify failures as product, harness, or environment before changing a gate; never weaken protected expectations to accommodate rendering.

Also review the complete reading/writing journey from Section 1.1. Users should discover task activation, edit a marker, cross a table boundary, and return to source without instructions about internal state. Passing geometry checks alone does not establish a coherent editor.

### 6.3 Performance budgets

Establish reproducible baselines in Milestone 0. These are initial engineering budgets on the recorded reference machine, not guarantees for every computer:

| Fixture | Added rendering budget after warm-up |
| --- | --- |
| 10,000 mixed lines with tables and 2,000-character lines | p95 added update cost <= 8ms |
| 100,000 lines, long lines, offscreen structural openers | p95 added update cost <= 16ms; bounded visible DOM/caches |
| Both | p95 input-to-next-paint increase <= 16ms versus the same build with rendering disabled; no whole-document caret-only work |

Use at least 200 edits, 100 selection/focus changes, and 100 scroll updates per large fixture. Report classes separately with p50/p95/max, total latency, cold open/parse convergence, and memory after repeated scroll/theme cycles. Include parsing, widgets, scheduled measurement, layout/paint, and deferred work, not just synchronous callbacks. Measure long-range invalidation and metric changes separately.

Existing table parsing scans new snapshots, and synchronization transmits full text claims. Measure baseline costs honestly. Passing incremental budgets does not make poor end-to-end responsiveness acceptable: record that release decision and any needed prerequisite. Do not quietly rewrite table parsing or synchronization in this feature.

Prefer incremental classification and bounded visible output. Add a worker or more complex scheduling only when measurements justify it. Persistent misses need optimization or an evidenced scope/budget revision, not moving work outside the measured interval.

### 6.4 Completion

A milestone is complete when its behaviors work, relevant protected contracts pass, and rendered content has been inspected in the workbench. Default release also requires theme/accessibility, scale/lifecycle, and recovery evidence. Unavailable screen-reader, OS, or IME coverage is incomplete validation, not a pass.

Run `npm run compile`, `npm test`, and relevant direct host checks. Use `npm.cmd` under Windows PowerShell restrictions. Resolve red Problems diagnostics in touched implementation files, including editor-only errors. After repository changes, follow `AGENTS.md`: run `./Build_and_Install` (`Build_and_Install.cmd` on Windows) and verify installation. Revising this document does not prove future feature gates.

## 7. Boundaries and future evolution

This release does not redesign tables/clipboard, replace the editor, create another persistence model, or promise all Monaco services. It excludes preview typography, hidden prose blocks, folding, image/media previews, math/diagrams, executable HTML, code-copy overlays, alert icons, new wrap/indent behavior, and split live editors.

Footnote semantics, document-heading navigation, additional languages, and broader host services can follow as separate increments with their own user benefit and acceptance criteria. Future development inherits the source, table, clipboard, geometry, theme, and recovery contracts unless this reference explicitly revises them. Keep unsupported content usable as source so the product can grow without forcing document migration.

## Appendix A. Semantic roles

These are centralized defaults, not permission to override the workbench or tables. Missing/transparent theme values need explicit fallback. Resolve contrast on the actual surface; labels, markers, weight, and outlines carry meaning when accents are unavailable.

| Role | Theme mapping / fallback | GitHub Dark visual reference |
| --- | --- | --- |
| Canvas, ordinary text, chrome | Existing VS Code-derived implementation | Installed theme |
| Heading/link label | `textLink.foreground`, then editor foreground | `#4493f8` |
| Punctuation/comments | `descriptionForeground`, then editor foreground when contrast requires it | `#9198a1` |
| List marker | Punctuation/foreground; optional restrained accent, never an implied diagnostic | `#f2cc60` |
| Inline-code text / link destination | `textPreformat.foreground` / `textLink.foreground`, then foreground | `#a5d6ff` |
| Inline-code fill | `textPreformat.background`, then transparent | `rgba(101, 108, 118, 0.20)` |
| Code band | `textCodeBlock.background`, then editor background | `#151b23` |
| Quote/rule/code edge | `textBlockQuote.border`, then `contrastBorder`, then foreground as needed | `#3d444d` for decorative edges |
| Task fill/mark/border | `checkbox.background`, `checkbox.foreground`, `checkbox.border`; distinguish checked/unchecked | Theme-derived fill and contrasting mark/boundary |
| Focus | `focusBorder`, then `contrastActiveBorder`, then foreground | `#4493f8`; no geometry change |
| NOTE/TIP/IMPORTANT/WARNING/CAUTION | `editorInfo.foreground` / `testing.iconPassed` / link / `editorWarning.foreground` / `editorError.foreground`; foreground plus label fallback | `#4493f8` / `#3fb950` / `#ab7df8` / `#d29922` / `#f85149` |

Code token reference: comments `#9198a1`, constants/numbers `#79c0ff`, declarations/types `#d2a8ff`, keywords `#ff7b72`, strings `#a5d6ff`, variables/parameters `#ffa657`, tags/regex `#7ee787`. Unknown tags use ordinary foreground. YAML keys use variable; quoted values string; numeric/boolean/null scalars constant.

Use contrast-checked bundled light/dark code palettes for other themes, and host foreground/non-color distinctions for high-contrast where needed. Record exact values with Milestone 1 visual evidence. Do not scrape theme files or private workbench APIs. The GitHub palette is a reference to validate against the installed theme, not an exact reproduction guarantee.
