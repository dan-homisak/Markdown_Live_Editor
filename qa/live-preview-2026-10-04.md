# Obsidian-style Live Preview — 2026-10-04

This revision implements the user's clarified editing model. Version 0.1.174 intentionally retained most source delimiters; the current specification replaces that model with contextual concealment and reveal. The user's original fixture files were read into isolated test documents and left unchanged.

Work began October 4; final validation and installation were completed October 5, 2026.

## Delivered behavior

- Inactive headings, bold/italic/strike, inline code, Markdown links, wikilinks, quote prefixes, and code fences conceal their formatting syntax. Caret/selection entry reveals the corresponding exact source.
- YAML frontmatter renders a Properties view; property activation returns to the original source value. Rendering never serializes YAML back into the document.
- Code blocks show a language label and Copy button; fences reveal while editing. Copy reads the current code on demand, excluding fences and structural prefixes. Unknown/untyped languages remain plain code.
- Callouts have icons, semantic accents/tints, titles, case-insensitive type aliases, and optional presentation-only folding.
- Task controls use rounded squares with a filled checked state and struck completed text. Task source edits and existing keyboard/context-menu actions remain available.
- Lists support visual Up/Down clamping to item text, two-stage Home, Tab/Shift+Tab and modifier-bracket nesting, Enter continuation/empty-item exit, and Backspace at item start. Table-boundary navigation retains precedence.
- Plain clicks open inactive rendered Markdown/wiki links; active link syntax remains editable and supports the existing modifier/command route. Wikilinks support aliases, optional `.md`, workspace fallback/ambiguity choice, and heading/block fragments. Host session/snapshot/version validation and URI restrictions remain in place.

## Engineering fixes established during actual-host testing

Block replacements must use CodeMirror's direct state-field decoration provider. Inline parts reuse classification across selection updates; code copy does not materialize a long block during caret/viewport work. Block widgets use inclusive boundaries to avoid empty source rows before/after rendered content.

A Properties widget's vertical margins caused a real coordinate-map error: the rendered link glyph was visible at one source position while `posAtCoords` returned a later line, and vertical motion scanned to the document start. CodeMirror measures block widget border boxes. Removing outside margins restored hit testing; spacing now lives inside the widget.

Code-toolbar focus is retained while its button owns focus, and Enter/Space activate its action explicitly. The Windows clipboard normalizes LF to CRLF; the test checks exact code contents after only that platform newline normalization.

CodeMirror's built-in Markdown Enter binding has high precedence and continued loose task lists with two newlines. The new structural list bindings explicitly take precedence for recognized source lists, preserving the requested single continuation and one host Undo step.

The full table suite exposed an immediate native-source-edit race after leaving a table. A focus microtask could dispatch presentation changes before CodeMirror imported the contenteditable mutation. Preview view-context effects now run on the next animation frame, after input mutations settle. A focused table/key-cell/value-cell/source-edit scenario verifies all three host Undo steps and exact final restoration.

Delayed presentation effects also recreated a native highlight during a table-owned drag. The preview now defers those effects until the table releases its pointer gesture and consumes the existing linear source selection without a second asynchronous projection transaction. The original mixed-selection assertions pass unchanged.

Code copy removes structural prefixes for fenced/indented code inside lists and quotes, including combined nesting, while retaining additional code indentation. Pure regressions cover these variants. Callouts containing a protected table do not offer a fold control that would hide that table.

## Verification

`npm.cmd test` passes, including compilation, existing source/table/clipboard/navigation suites, the 10,000-operation table fuzz, new preview/list plans, wiki/fragment tests, and bundled-host lifecycle validation.

`node scripts/edh-markdown-release-check.mjs --live-preview-only` passed all 9 checks on the final source, exited successfully, and recorded no console errors. The test covers resting/active syntax, source selections, Properties editing, keyboard code copy, task/callout treatment, smart list movement and real host Undo, table ownership/recovery, actual plain-click local Markdown opening, wikilink command opening, and the user's full standard fixture.

`node scripts/edh-visual-check.mjs` passed the full stock/live/table regression suite on the final source and exited successfully. Table-border checks report 19 cells, 7 gutters, and no failures. The unchanged 0.5 CSS px gate passes: first glyph/content/table left and gutter differences are approximately 0.325 px, font size is exact, and line-height difference is 0.1 px. The focused `--global-undo-only` regression also passes after the scheduling fix.

Screenshots inspected directly include `qa/edh-stock.png`, `qa/edh-live.png`, `qa/edh-markdown-release-live-preview-resting.png`, the YAML/code editing states, and the standard fixture's inline formatting and callouts. These are actual VS Code/Electron workbench screenshots, not standalone browser substitutes. Final raw evidence is saved in `qa/edh-markdown-release-results-live-preview.json`, `qa/edh-live-preview-validation.log`, and `qa/edh-live-preview-table-regression.log`.

`node scripts/record-markdown-bundle-impact.mjs` confirms the generated payload matches disk, inventories 35 bundled packages with their license notices, and records the current sizes/hashes. This revision adds no package dependencies beyond the prior rendering implementation.

## Explicit limits

- This is the requested Live Preview feature set, not all Obsidian features. HTML remains literal; images/embedded notes are not fetched; vault graph/backlinks/autocomplete and additional grammars are separate work.
- Existing table cell presentation remains owned by the table editor. The new prose concealment and link handlers do not intercept cell editing.
- Properties are an editable source-backed display of common key/value/list metadata, not a complete independent YAML form/validation service. Complex data remains available through exact source editing.
- Windows VS Code/Electron is the exercised host. OS IME candidate sessions and an actual screen reader were not exercised; synthetic/policy tests are narrower evidence.
- The previous paired 10k/100k performance record belongs to 0.1.174. It is not a performance pass for this reflowing preview. This revision has bounded viewport classification tests and on-demand code copy; the full paired benchmark has not been repeated.

## Installation

`Build_and_Install.cmd` completed successfully and installed **0.1.176** into `C:\Users\thema\.vscode\extensions\dan-homisak.markdown-live-render-tables-0.1.176`. The command rebuilt/typechecked, packaged the VSIX, removed the prior extension installation, installed the new package, and passed its payload checks.

The first install reached 0.1.175 but its final verifier incorrectly looked for the Copy button's JavaScript class in a stylesheet that uses a shared button selector. The verifier now checks the Copy class in the JavaScript and the code-toolbar selector in CSS. A complete second build/install passed.

`qa/live-preview-install-verification.json` independently verifies exact SHA-256 matches for the installed webview, all three stylesheets, extension-host bundle, and third-party notices. The installed manifest matches the workspace manifest after excluding VS Code's added installation metadata, and Live Preview defaults to enabled. The rebuilt JavaScript hashes match the final tested payload.

Use **Developer: Reload Window** in an existing VS Code window to activate 0.1.176. If the rendering setting was explicitly disabled, enable `markdownLiveRenderTables.markdownRendering.enabled`.
