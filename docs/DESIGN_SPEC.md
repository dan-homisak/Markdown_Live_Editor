# Live Markdown Rendering Design Specification

- Status: Obsidian-style Live Preview is the required editing model. It replaced an earlier readable-source design.
- Product direction: most of an Obsidian-style editor, with this project's existing VS Code and table behavior.
- Scope: contextual syntax concealment, YAML properties, callouts, code blocks, Obsidian-style tasks, smart list editing, and actionable Markdown links and wikilinks.
- Revised 2026-11-15 for find and replace (section 11) and multiple cursors (section 12).
- Revised 2026-11-13 to describe the shipped editor where this document had fallen behind it: heading markers, properties, fence rows, code highlighting, footnotes and generated contents; and again the same day for pointer placement beside task checkboxes. User-visible behavior is described in the [README](../README.md).
- Evidence: the test plan and the current state of each suite are in [TESTING](TESTING.md). Dated reports in `docs/reports/` describe earlier versions; the performance measurements there belong to version 0.1.174 and do not validate the current layout.

## 1. Product experience

The resting document should read as formatted Markdown, not as colored Markdown source. Formatting punctuation disappears when the caret is outside its construct. Moving the caret into the formatted text reveals the exact source needed to edit it. Moving away restores the rendered presentation automatically, without changing the document or its dirty state.

This follows the interaction model described in [Obsidian Live Preview](https://obsidian.md/help/edit-and-read), [internal links](https://obsidian.md/help/links), and [callouts](https://obsidian.md/help/callouts). These references describe the intended experience, not a claim of complete Obsidian compatibility. Future features should extend this model rather than reverting to permanently visible delimiters.

The ordinary VS Code font, gutter, caret, selection, active-line treatment, and existing table editor remain familiar. This application still stores standard Markdown and uses the existing authoritative VS Code document, host Undo, synchronization, and clipboard machinery.

## 2. Required presentation

| Construct | Resting presentation | Editing presentation |
| --- | --- | --- |
| ATX/Setext headings | Heading text at the editor's text size, with weight and a color per level. ATX `#` markers stay visible by default (`markdownRendering.showHeadingMarkers`); with that setting off they are hidden at rest. Hide Setext underline rows. | Reveal its exact heading markers while the caret is in the heading. |
| Bold, italics, strike | Render the content with composed styles; omit delimiter runs. | Reveal delimiters for every enclosing active formatting construct. |
| Inline code | Render exact code characters/spaces with a code treatment; omit surrounding backticks. | Reveal the original backtick runs. Do not normalize the saved content. |
| Markdown links/references | Render the label; hide brackets, destination, title, and reference suffix. Autolinks omit angle brackets. | Reveal the entire active link expression. Reference definitions remain editable metadata. |
| Wikilinks | `[[Note]]` displays Note; `[[Note|Alias]]` displays Alias. Both are actionable note links. | Reveal the brackets, target, fragment, and alias separator for editing. |
| Unordered lists | Render bullets, preserve nesting, and align editable item text. | Reveal source markers at the marker itself; item navigation prefers content over indentation. |
| Ordered lists | Preserve visible numbering and hierarchy. | Edit the original number/marker; Enter continues its numbering. |
| Tasks | Rounded compact square control; checked state uses a contrasting filled accent/check and subdued struck item text. Suppress the redundant list bullet. | Source marker editing and explicit toggle/focus commands remain available. |
| Quotes | Render an inset quote guide; omit inactive row quote markers. | Reveal quote prefixes on the active row. |
| Callouts | Render an icon, title, accent guide, and subtle tinted content. Hide `>` and `[!TYPE]` syntax. Support custom titles and `+`/`-` collapsibility. | Reveal the original callout header while editing its content or title. Folding is presentation state, never a source edit. |
| Fenced code | Render highlighted editable code in a continuous band. Both fence rows keep their place and their line numbers, so the code and the rows after it never move; the fence characters and info string are hidden, and the language label sits on the opening row. Hover or keyboard focus turns the label into Copy. | Reveal original fences/info strings while the caret is in the block; retain the code toolbar. |
| Indented code | Render a code band with structural indentation removed and a plain-text toolbar. | Reveal the structural indentation while editing. Preserve meaningful code whitespace. |
| YAML frontmatter | Show the YAML itself, syntax-colored inside a subtle frame labeled Properties, with its `---` delimiters and line numbers. | Edit the source in place, with key suggestions and list continuation (section 5). |
| Generated contents | A standalone `[TOC]` renders a navigable list of the document's headings. | Reveal the marker. |
| Footnotes | `[^label]` references and their definitions render with matching numbers and navigate to each other. Indented continuation paragraphs stay part of their footnote. | Reveal the original label syntax. |
| Rules | Render a horizontal rule. | Reveal its original Markdown marker when editing that row/marker. |
| Escapes | Hide the escape backslash around supported escaped punctuation. | Reveal its exact spelling at the active escape. |
| Images/embeds | Keep editable labels/source without automatic network fetching. | Preserve source. Fetching images or embedding notes is a separate feature. |
| HTML/comments and unsupported constructs | Keep literal, editable source with existing safe styling. | Never execute document HTML or invent unsupported rendering. |

Recognized tables retain their existing independent rendering and interaction. No new Markdown transformation may consume or paint over their source ranges, including when another Markdown construct encloses a table.

## 3. Source, reveal, and geometry contracts

The Markdown document is the only authoritative content model. Rendering, selection, focus, theme changes, folding, scrolling, and toolbar interaction must not rewrite it. Preserve exact punctuation, whitespace, casing, newline mapping, BOM/encoding behavior, and host Undo semantics.

Reveal is contextual, not merely a caret test against the punctuation itself:

1. Protected table ownership wins.
2. Non-empty source selections reveal overlapping constructs, including effective mixed selections.
3. A source caret inside or on the boundary of an inline construct reveals that construct's delimiters, including enclosing formatting.
4. A caret inside a code block or YAML region reveals its original source structure. Quote prefixes may reveal by row. Callout editing reveals the header required to change its type/title.
5. Explicit checkbox/toolbar focus retains the relevant control and mapped editing context; focus changes must not remove a button before activation.
6. Composition freezes affected projection until the input session settles. Source-dependent mutations are unavailable during unsettled composition.
7. Otherwise use the resting rendering. Hover alone does not reveal source.

Unlike the previous design, concealed punctuation need not retain its original width. Hiding it must close the visible gap. Setext underline rows may collapse, and code/callout chrome may add appropriate padding. Fence rows and properties rows do not collapse: they keep their rows and line numbers. Reflow is intentional. Preserve the caret's source position and keep it visible; never leave the cursor inside an invisible region or let delayed layout jump it to unrelated source.

Ordinary prose and editor chrome still use injected VS Code font metrics, especially `--vscode-editor-font-size`. Keep source-line numbering meaningful as rows collapse. Existing table row heights, line numbers, alignment, and gutters remain independently owned by the table DOM.

## 4. List keyboard behavior

Apply these controls only to an intentional non-table source selection in a parser-recognized list. Literal code, HTML, metadata, protected tables, and composing input must retain their own behavior.

| Key | Behavior |
| --- | --- |
| Up/Down | Preserve normal visual-column movement, but clamp a destination in a list's indentation/marker area to the start of item text. Respect wrapped visual lines. Table-boundary navigation has first refusal. |
| Home | Go to item text start; pressing it there goes to the literal source-line start. |
| Enter | Continue the current bullet, increment an ordered number, or create a new unchecked task. Keep quote/nesting context. |
| Enter on an empty item | Outdent a nested item once; exit an empty top-level list item. |
| Tab / Shift+Tab | Nest/unnest the current item and its descendants, or a supported selected group of list items. |
| Ctrl/Cmd+] / Ctrl/Cmd+[ | Alternate indent/outdent controls for lists. |
| Backspace at item-text start | Unnest once; at top level remove the structural list/task prefix. |
| Shift+arrows and ordinary character/word motion | Preserve source selection and editing. Do not silently destroy markers. |

Use one source transaction per structural action and one authoritative host Undo step. Read current source for every action. Honor read-only settings, ownership, and composition. Do not introduce a second list persistence model or rewrite unrelated sibling numbering.

## 5. Task, code, property, and callout controls

A task activation changes exactly one code unit: space to lowercase `x`, or `x`/`X` to space. Pointer toggles preserve the prior source/table selection. Space toggles an explicitly focused checkbox; Escape returns to its mapped source bookmark. Keep Command Palette and source context-menu actions. Controls expose names, state, disabled state, and focus indicators. Do not create thousands of sequential task Tab stops.

The characters of a concealed task marker have no width and sit at one point beside the checkbox. A pointer selection never ends on one of them: it ends at the start of the task's text, so a click beside a checkbox does not reveal the marker. The start of the marker stays reachable, and the keyboard walks into the marker and reveals it. A coordinate left of the content, such as the line-number gutter, resolves to the start of the marker. The check letter of a rendered marker is syntax: a caret beside it asks for no occurrence highlight, and no occurrence is drawn on a marker that is concealed.

Code blocks show their language in a corner control in resting and editing states; hover or keyboard focus changes the label to Copy. The label comes from the first info-string word; code in a language without a grammar remains plain text. Copy reads current source and excludes fence syntax and structural quote/list prefixes, while retaining meaningful indentation and line breaks. It copies only code, adds no source/history entry, gives success/failure feedback, and works through pointer and keyboard activation. A label click returns to editable source. Never execute code or download grammars.

Properties are the YAML source itself, colored and framed; there is no independent mutable YAML object. Typing `---` alone on the first line creates a closed block above the document. Empty rows offer local default keys, `tags` first, omitting keys already present; no vault lookup is performed. Tab and Shift+Tab indent by two spaces, Enter continues list items, an empty item ends the list, and Enter on the closing delimiter moves into the body. Invalid YAML, including duplicate keys, is underlined with an explanation and left for correction. After the user edits the block and leaves it, valid YAML is formatted to two-space indentation with values, comments and quoting preserved. A document is never reformatted by opening it, and nothing outside an edited block is normalized.

Callouts recognize case-insensitive type names, standard Obsidian aliases, custom titles, and optional `+`/`-`. Known aliases map to supported semantic roles; custom types use the note fallback. The first paragraph in the parsed quote supplies the header and the quote supplies extent, including nested/lazy content. Folding state belongs to the view, maps through edits, and cannot hide protected tables. Entering source for editing reveals the folded region.

## 6. Link behavior and resolution

Rendered links are real interactions. A plain primary click on an inactive rendered link opens its target. When the caret is editing that link, a plain click continues editing; Ctrl+click on Windows/Linux, Cmd+click on macOS, or Alt+click when `editor.multiCursorModifier` is `ctrlCmd` opens it. The Open Markdown Link at Caret command remains available. Reject drag, Shift-selection, AltGr, non-primary, composing, stale, and table-owned gestures.

Support inline Markdown links, autolinks, references, and wikilinks, including aliases. Resolve note/document paths relative to the current document. Wikilink note names may omit `.md`; try the neighboring document first, then the containing workspace. Ambiguous matches require a visible choice rather than silently selecting a note. Missing notes report failure; this revision does not create files automatically.

Support document heading fragments and Obsidian `#^block-id` targets. Heading matching accepts displayed heading text or a normalized lowercase slug; explicitly nested heading paths use heading ancestry. Open the matching target position through supported VS Code text-document APIs. Untitled documents without a base URI must not guess a workspace root.

HTTP, HTTPS, and mailto use the supported host opener. Document paths preserve URI scheme/authority. Never navigate the webview, launch executable files through a generic opener, or accept `command:`, `javascript:`, `data:`, and arbitrary custom handlers. Images/embedded notes do not become implicit external actions.

Link requests are queued behind pending source edits and bound to the originating panel/session, exact before snapshot, revision floor, and source range. The host derives the destination again from source. After asynchronous reads or a note-choice dialog, recheck active panel, source version/text, and enabled setting before changing focus. Every request settles, including errors/disposal.

## 7. Rendering architecture and reliability

Use the configured incremental CodeMirror Markdown tree for classification, with explicitly enabled GFM extensions, frontmatter, and wikilinks. No second persistent whole-document rendering parser or DOM-to-source model is allowed. Existing table and clipboard parsers retain their responsibilities; on-demand host validation may reuse pure recognition helpers.

Inline styles use marks. Contextual concealment uses source-bound replacement decorations. Block/multiline replacements must come from a direct state-field decoration provider; viewport-derived plugins may discover bounded windows and dispatch effects but cannot directly supply layout-changing replacements. Preserve table source filters and selection guards.

Track immutable document identity, syntax progress, selection/focus, viewport, and metrics separately. Reuse classified parts for selection-only updates. Reclassify changed syntax/enclosing constructs when edits or background parsing invalidate them. Keep viewport output, measurement caches, and retained widget data bounded. Copy and link actions may read their current source on demand; ordinary caret motion must not copy or parse entire long blocks.

Use scheduled measurement. Dispose observers/listeners and pending callbacks; hidden views resume from current source/settings. Map fold/bookmark state through edits and release it when its owner disappears. Never steal focus from another editor or restore a caret inside protected table source.

Apply focus/viewport context after native input mutations have settled, rather than dispatching from a focus microtask before CodeMirror's DOM observer imports an edit. Defer these presentation effects while the table owns a pointer-selection gesture. Mixed selections already publish their linear source envelope in the editor selection; do not mirror that range through a delayed transaction that restores a competing native highlight.

Retain the existing serialized source queue, exact before/final snapshot checks, `changeId`, `baseRevision`, conflict floor, and acknowledgements. An older base revision can remain valid when its exact snapshot is the queued successor above the conflict floor. Rejection invalidates dependent actions and restores authoritative source. Do not strand composition commands or queues.

`markdownLiveRenderTables.markdownRendering.enabled` defaults to true. Disabling it restores ordinary non-table source, removes new actions/list behavior and preview widgets, and preserves tables/clipboard. Reconfigure the retained editor in place; let already submitted edits settle. The stock editor remains the complete-source recovery route. Internal preview failures must leave source editing and table protection usable and emit bounded diagnostics.

## 8. Syntax and styling boundaries

Code blocks are colored with VS Code's own TextMate grammars and the active color theme, including the user's token color customizations, so a block matches the stock editor. The host collects grammar and theme data; the webview tokenizes with the Oniguruma WebAssembly engine shipped in the package. Nothing is downloaded. When that engine is unavailable, the bundled grammars cover JavaScript (`javascript`, `js`, `nodejs`), TypeScript (`typescript`, `ts`), JSON, shell (`bash`, `sh`, `shell`), Python (`python`, `py`), and YAML (`yaml`, `yml`). Unknown info strings retain a plain code treatment; do not imply a grammar that is not loaded.

Frontmatter opens with standalone `---` at the first document line after an optional BOM and closes at a later standalone `---`; trailing horizontal whitespace is accepted. No closer means ordinary Markdown. TOML/JSON metadata variants remain source. Table ownership still wins inside metadata; do not conceal a recognized table inside a property widget.

Unmatched formatting, unclosed wiki syntax, and literal regions must remain editable. Match parser semantics rather than running independent document-wide regular expressions. The first source reference definition wins according to existing CommonMark normalization. Do not claim blanket CommonMark/GFM or Obsidian conformance.

Use namespaced `--mlrt-markdown-*` semantic colors and the existing theme adapter. VS Code owns canvas/chrome/caret/selection/focus. Contrast-check ordinary text on the actual composited surface, and keep controls distinguishable in dark, light, high-contrast, and forced colors. Avoid motion and avoid theme updates that remount tables or lose source focus.

Host accessibility mode may use literal source and task commands when concealment impairs editing/announcements. Generated UI uses safe text nodes, meaningful button labels and state, and keyboard focus. CSP, resource restrictions, source HTML isolation, and clipboard sanitization remain unchanged. Automated semantics tests do not replace actual screen-reader or OS IME testing.

## 9. Verification and delivery

Pure tests cover source ranges, reveal ownership, literals/table exclusion, properties, exact code copy, list edits, wiki parsing/resolution, fragments, and host lifecycle validation. Actual VS Code/Electron tests cover resting/active screenshots, pointer hit mapping, caret movement, list keys/host Undo, keyboard/pointer copying, callout folding, real local-note opening, and recovery. Use the frozen fixtures in `test/fixtures/` without modifying them; a hash manifest guards them.

| Area | Required regression |
| --- | --- |
| Source | No mutation from rendering, selection, folding, toolbar focus, or themes; exact history and LF/CRLF mapping. |
| Preview | Hide complete inactive delimiter/destination runs, reveal exact active source, no invisible caret, no stale replacement after edits. |
| Lists | Nested/wrapped navigation, continuation, empty-item exit, subtree indent/outdent, Backspace, mixed/table rejection, read-only and composition. |
| Controls | Stable pointer and keyboard focus, accessible labels/states, exact code clipboard contents, task Undo and rejection. |
| Links | Plain rendered clicks, active source/modifiers, aliases/references/fragments, local/remote paths, ambiguous/missing notes, stale/forged/hidden-panel requests. |
| Tables/clipboard | Existing source protection, editing/navigation, geometry, row-owned line numbers, copy/paste modes, rich serialization, cut/move and mixed selection. |
| Lifecycle | Disable/re-enable, authoritative replacement, composition, theme/font changes, offscreen regions, hidden/disposed views, failure fallback. |

Compile, then run `node scripts/edh-visual-check.mjs` directly for protected stock/live geometry in the same isolated window. Save and inspect actual stock `.view-lines` and live webview screenshots. Ordinary glyph boxes, gutter/chrome, active-line treatment, and table alignment retain the 0.5 CSS px gate with coordinate-space conversion. New preview content intentionally reflows and is assessed against this revised interaction contract, not the obsolete fixed-width-delimiter rule. Never weaken table-border calibration or table geometry assertions to accommodate preview changes.

Run `node scripts/edh-markdown-release-check.mjs --live-preview-only` for the contextual preview path. Inspect the screenshots, not just terminal output. Old full-surface literal-source assertions remain historical unless updated to this contract. Record failing product behavior separately from harness/environment issues and fix new correctness failures before installation.

Large-file engineering targets remain p95 added synchronous cost <=8ms at 10k lines and <=16ms at 100k lines, with added visible-frame opportunity <=16ms and bounded DOM/caches. Global fence reinterpretation is measured separately, including full deferred convergence. Version 0.1.174 measurements are historical baselines, not a pass for this new layout. Report sample counts, cold/warm conditions, real host acknowledgement versus isolated renderer measurements, and unresolved warnings honestly. Optimize measured misses or explicitly document a scope revision; do not hide deferred work.

Before finishing a change, run the compile/type check and relevant tests, resolve known red Problems diagnostics, directly inspect rendered content, and run `Build_and_Install.cmd` as required by `AGENTS.md`. Verify the installed version and payload. Record unavailable manual OS IME, screen-reader, and other-platform coverage explicitly.

## 10. Future development

The product direction is an Obsidian-style live editor, with this project's VS Code integration and spreadsheet-like table behavior. New Markdown features should render at rest and reveal source for editing wherever practical. Permanently coloring raw syntax is not an acceptable substitute for a requested live-rendered feature.

This revision does not promise a vault graph, note-creation/autocomplete system, backlinks, embedded media/notes, math/diagram execution, arbitrary HTML rendering, or all Obsidian plugins. Those need explicit behavior and validation when added. They must inherit source ownership, protected tables, host history, safe links, clipboard, recovery, and contextual reveal.

## 11. Find and replace

Find and replace follow the stock editor's widget in place, controls, wording and keys (decision A28). They are the editor's own: nothing is sent anywhere, and no dependency provides them.

**What is searched.** The Markdown source, because the document is the only content model. Prose is searched as written, so a match can lie inside syntax that is concealed at rest. A recognized table is searched one cell at a time, as the text the cell shows while it is edited: `<br>` is a line break and `&#124;` a pipe. Pipes, the delimiter row and padding are structure and are not searched. No match spans two cells or a table boundary; the line break before a table and the one that ends it belong to the table.

**Matching.** A query compiles to one regular expression: literal text is escaped, case is ignored unless Match Case is on, and `^` and `$` match at line boundaries. Whole Word accepts a match unless a word character sits on both sides of one of its edges, the stock editor's rule. An invalid pattern is reported in the widget and searches nothing. Empty matches are found in prose only.

**The current match.** In prose it is the editor's selection, so the reveal rules of section 3 show concealed syntax around it without the editor holding the focus. A current match in a table cell is painted in the cell and leaves the editor's selection alone; when the widget gives up the focus, the cell takes the caret with the match selected. Opening find from a table cell searches on from that cell.

**Highlights.** Matches are highlighted only where they can be seen: on the visible lines of prose, as marks that change no layout, and in the mounted table cells, through the CSS Custom Highlight API with a positioned box for the border, like an occurrence (decision A26). The names a view registers its cell highlights under are its own.

**Replacing.** A replacement is an ordinary source edit through the existing queue, validation and host Undo. One cell is written as a declared cell edit; several cells as a declared table edit. A cell's new text is encoded as typed text is, so a pipe or a line break in a replacement cannot change a row's cells; a plan that would is refused before anything is written. Replace All across prose and tables is two transactions in one editor update: one change message, one host edit and one Undo step, with the table change filter and the host's validation unchanged. Replace is refused on a read-only document and while text is being composed. A cell that a replacement changes is written whole, the way an edit typed into it is: its other text is encoded again too.

**The widget's own input.** Undo and Redo in the find and replace boxes come from a history the widget keeps for each box. The page's own Undo is cancelled there, because it is shared by the whole page and could take back text typed into the document. A key press that belongs to an input method is not a command. Find moves no caret and writes nothing while text is being composed, in the editor or in a table cell, or has not yet reached the host. Inside a table cell, the table navigation key and the table shortcuts keep their keys as configured, whatever they are.

**Bounded work.** The whole document is searched only while the widget is open and only when the query or the document changes: at once for a query, after a short pause for an edit, in slices when one slice is not enough. At most 20,000 matches are kept. Caret movement and scrolling never search.

**Independence.** The find code depends on the editor, the table model and the DOM, not on the host application (decision A30). The host supplies the element the widget is mounted in and may open find through an exported function.

Not provided: find in selection, preserve case, search history, marks on the scrollbar, and the stock editor's find settings. The stock editor moves the first lines down while its widget is open at the top of a document; this editor does not, so the widget covers the right end of the first two lines there.

## 12. Multiple cursors

The stock editor's multiple cursors work in prose, with its keys (decision A29): add the next occurrence, select all occurrences of the find match, change all occurrences, add a cursor above or below, add a cursor with the mouse, and select a column.

**One caret stays as it was.** With a single cursor nothing in this section acts: the arrow keys, Backspace and Enter remain with the browser and with the list, table boundary and properties handling of sections 4 and 5. Only while several cursors exist are those keys bound to commands that move or edit every cursor; the browser knows one caret. Escape returns to the main cursor. A completion list that is open keeps the arrows, Enter and Escape.

**One edit.** Typing, deleting and pasting at several cursors is one source transaction, one change to the host and one Undo step.

**Tables hold no cursor.** A rendered table cell is its own editing surface. The table source guard removes a caret that lands in table source and leaves the other cursors where they are; a lone caret is still moved beside its table. A cursor added above or below steps over a table. Among several cursors, a caret at the end of a document that ends in a table is removed as well: text typed there is refused unless it starts a new line, and that refusal would take the typing at every cursor with it. The occurrence commands select matches in prose only, count the matches inside table cells, and say so; Replace All (section 11) changes those. An edit that would write into table source without declaring it is refused as a whole, as before.

**Occurrences.** A search that starts from a caret first selects the word under it and then matches whole words with the same case. One that starts from selected text matches any occurrence and follows the Match Case and Whole Word options of find. With the find widget open, selecting all occurrences uses its query, regular expressions included. At most 10,000 cursors are created.

**Mouse.** The modifier that adds a cursor is the one the host's multi-cursor setting names, Alt by default; the other modifier keeps opening links (section 6). Shift+Alt+drag selects a column.

**Clipboard.** Several selections are copied one to a line as plain text. Pasted plain text goes one line to each selection when it has exactly as many lines as there are selections, otherwise whole to each. The table-aware and rich clipboard paths apply to a single selection only.

**Reveal.** The rules of section 3 already consider every range: each caret and each selection reveals the syntax around it.

Not provided: undoing the last cursor, and cursors inside table cells.
