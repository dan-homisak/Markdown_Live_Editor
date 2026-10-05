# Full Markdown rendering implementation — 2026-10-04

The full rendering layer is enabled by default. This replaces the earlier default-off marker prototype and follows the user's direction to finish the visible experience. An existing explicit `false` setting remains a recovery override. Neither this implementation status nor default enablement represents a pass for unavailable manual testing.

## Delivered behavior

- ATX and Setext headings, composed strong/emphasis/strike, exact inline-code source, link/image/reference roles, and literal parser-styled HTML/comments.
- Measured unordered bullets, task checkboxes, and line-wide rules. Caret/selection reveals exact markers without changing following glyph positions. Tasks support pointer activation, Command Palette toggle/focus, and the source context menu, with one host Undo step per toggle.
- Fenced/indented code bands including blank rows, bundled JavaScript/TypeScript/JSON/shell/Python/YAML highlighting, quotes, all five uppercase alert types, and closed first-document YAML frontmatter. All paths exclude independently recognized tables.
- Bounded link opening through the existing host queue: modifier pointer activation or the explicit caret command; HTTP(S)/mailto and fragment-free document paths; originating panel/session, exact source, range, revision floor, and URI policy validation. Documents open through VS Code text-document APIs.
- In-place recovery, theme contrast adaptation, host accessibility-mode literal markers, composition guards, mapped focus return, viewport-bounded decoration output, and retained table DOM.

The configured CodeMirror Markdown tree supplies all view classification and mounted language syntax. The host reuses the pure structural parser only when verifying explicit source actions. No source HTML is mounted, no image is fetched, and no remote grammar is loaded.

Passive marks terminate at source newlines. Actual Electron inspection exposed a CodeMirror DOM-reuse case where a multiline code-source mark retained tokens but dropped the shell row's code and active-line classes. Removing only that mark restored the classes at identical glyph coordinates; the implementation now splits these marks without changing source. The diagnostic is saved in `qa/edh-markdown-release-results-code-diagnostic.json`. Alert-label recognition is shared so unresolved-link styling cannot override alert type colors, and row accent specificity is explicit.

## Verification

`npm.cmd test` passes, including compilation, existing table/clipboard/input/source tests, the 10,000-operation table edit fuzz, marker tests, new presentation/block/link tests, standalone extension-bundle loading, and bundled-host lifecycle checks.

The integrated default-enabled build passed `node scripts/edh-visual-check.mjs`: 67 CHECK stages, exit 0, saved in `qa/edh-full-rendering-validation.log`. Stock/live screenshots `qa/edh-stock.png` and `qa/edh-live.png` were inspected directly. Ordinary glyph placement, gutter, font metrics, active line, and table geometry remain within the existing 0.5 CSS px gate. The table-border assertion passes without loosening its independently calibrated border expectations. Earlier fractional/device-scale border evidence remains in `qa/table-border-validation-2026-10-04.md`.

The integrated build also passed all 25 checks in `node scripts/edh-markdown-rendering-check.mjs`, recorded in `qa/edh-markdown-rendering-results.json`. This includes actual host task Undo, source/table selections, drag handoff, dynamic recovery/themes, external document changes, focus virtualization, read-only rejection, accessibility-mode fallback, and injected rendering-failure recovery. `qa/edh-markdown-resting.png` was inspected directly in the same VS Code workbench layout.

`node scripts/edh-markdown-release-check.mjs` passed all 14 full-surface checks, with exact final source and no runtime console warnings/errors. `qa/edh-markdown-release-results.json` contains the measurements. Checks include default-enabled loading without a settings override, nested semantic properties, source-row geometry, every bundled language, literal HTML/image isolation, alert type colors, table exclusion, theme changes, calibrated forced-color inline outlines, task context-menu toggle and actual host Undo, literal accessibility-mode focus fallback, disabled-period table ownership, modifier-hover (including strike), and bounded local/unsupported link commands.

The user's `standard-markdown-fixture.md` was read into an isolated fixture and left untouched. Five section screenshots cover the title/frontmatter, emphasis, quotes, code, and tables. The readable surface, language bands, alerts, high-contrast/forced-color treatment, and standard-fixture screenshots were inspected directly. Main screenshots are `qa/edh-markdown-release-readable.png`, `qa/edh-markdown-release-code-languages.png`, `qa/edh-markdown-release-quotes-alerts.png`, and `qa/edh-markdown-release-standard-0.png` through `-4.png`.

The final focused `--nested-guide-only` check passed, exit 0, with no console warnings. Quote and alert guides coexist with code fence top/bottom edges in normal and forced colors; standalone code has no left guide. Forced-color widths match independent 1px/2px probes, source remains exact, and glyph geometry differs by 0px from rendering-disabled recovery. Both screenshots were inspected directly. Evidence is in `qa/edh-markdown-release-results-nested-guides.json` and `qa/edh-markdown-nested-guides-validation.log`.

## Large-document measurements

The actual Electron webview ran 160 local edits, 40 fence edits that invalidate the document tail, 100 selection changes, and 100 scrolls **per fixture and per setting**: 10,000 lines/294,813 UTF-16 units and 100,000 lines/2,937,123 units. `qa/edh-markdown-paint-results.json` contains raw samples, p50/p95/max/totals, parser status, source identity, viewport output, theme/font cycles, and heap observations. The same production table parsing, source-claim construction, rendering, and layout paths run in both settings.

| Fixture and operation | Disabled p95 frame opportunity | Enabled p95 frame opportunity | Added p95 synchronous dispatch |
| --- | ---: | ---: | ---: |
| 10k local edit | 18.3ms | 18.2ms | 0.2ms |
| 10k structural edit | 30.3ms | 36.3ms | 6.3ms |
| 10k selection | 18.2ms | 18.3ms | 0.1ms |
| 10k scroll | 13.4ms | 21.9ms | 0.0ms |
| 100k local edit | 58.3ms | 54.6ms | 0.7ms |
| 100k structural edit | 60.7ms | 71.3ms | 9.2ms |
| 100k selection | 18.3ms | 18.3ms | 0.0ms |
| 100k scroll | 13.0ms | 25.7ms | 0.0ms |

Frame opportunity means the production scheduled measurement followed by two `requestAnimationFrame` callbacks; it is a browser proxy, not hardware input-to-photon measurement. Enabled 100k local-edit p50 rose from 48.3ms to 54.4ms despite its lower p95. The largest p95 visible-frame increase was 12.7ms during 100k scrolling. Those observations meet the initial synchronous and visible-frame added-cost targets, while total baseline typing latency at 100k remains material.

Full-document convergence is reported separately and includes deferred work. The structural workload flips a five-backtick opener, changing which subsequent regions are literal outer code versus Markdown with nested language grammars. Eagerly finishing all offscreen parsing raised structural p95 total from 30.3ms to 60.5ms at 10k and 242.6ms to 399.9ms at 100k; enabled maxima were 66.4ms and 478.7ms. These exceed the initial small deferred-work limits. The spec explicitly revises this global-reparse class to <=75ms/500ms p95 total and <=40ms/200ms added p95 for this reference environment. Ordinary/visible budgets remain unchanged. Source review and bounded output support attribution to newly invalidated syntax and scheduled parse slices, but this is an inference, not a profiler attribution. No classifier initiates its own document parse.

Visible DOM remained bounded: at most 9 task controls and 625/742 editor descendant elements in the enabled 10k/100k operation samples. Marker measurement entries matched classified visible markers (21 at the final 10k position, 15 at 100k); no failed marker plugin was observed. Selection, scrolling, themes, and font cycles preserved source identity. Theme cycles covered dark, light, high-contrast dark/light; font cycles applied 20px/30px/1px spacing and restored 14px/default line height/normal spacing. Heap observations after cycles were about 34.3MB/124.6MB enabled; unforced-GC snapshots are not leak proof.

Large stress samples suppress host mutation posting and drain synthetic unacknowledged snapshots **outside** each measured interval, preventing the harness itself from retaining hundreds of full-text claims. They do not establish large-file IPC latency. A separate 20-edit run used actual host acknowledgements: median 2.7ms, p95 3.8ms, maximum 11.5ms. The paired runs use a fixed order; reload timings include a fixed harness delay and are not cold-process startup measurements. The diagnostic explicitly forces 25ms parse slices only after recording natural visible-frame timing; ordinary editing never calls that full-parse hook.

The stress run also recorded ten CodeMirror measurement-loop warnings, so its strict console check exits nonzero despite all functional/count/source/timing assertions passing. A focused diagnostic reproduced **six warnings with rendering disabled and six with it enabled**: the same two 10k scroll indices (16 and 47) at identical UTF-16 viewport ranges, and the same two font-change cycles at both file sizes. Every tree/viewport was ready, source remained exact, marker plugins were healthy, and layout settled. This is an observed baseline condition in shared CodeMirror/table geometry under far-scroll/font stress, not an enabled-only regression. The raw warnings remain in `qa/edh-markdown-release-results-paint.json` and `qa/edh-markdown-paint-results-measure-diagnostic.json`; neither harness mutes them or falsely reports a warning-free pass. Fixing that existing shared stabilization behavior is outside this rendering implementation's table-preservation scope.

## Final installation

`Build_and_Install.cmd` completed successfully and installed `dan-homisak.markdown-live-render-tables@0.1.174` on October 4, 2026 (local time). Its packaging step compiled the final source again. The installed manifest enables Markdown rendering by default, and SHA-256 hashes match the repository for the webview JavaScript, all three CSS resources, extension host, and third-party notices. Exact hashes and the installed directory are recorded in `qa/markdown-rendering-install-verification.json`. Run **Developer: Reload Window** to activate this build in an existing VS Code window.

## Explicit validation limits

- Windows VS Code/Electron is the exercised host. macOS/Linux command modifiers have pure policy tests; those operating systems were not exercised visually.
- No actual OS IME candidate session or screen reader was exercised. Synthetic composition, actual host accessibility settings, DOM semantics, and focus tests are narrower evidence.
- Forced-colors emulation checks browser behavior; it is not an actual Windows OS contrast-theme session.
- The live webview retains its existing product boundaries: no claim of Monaco find/replace, multi-cursor parity, heading-fragment navigation, image previews, arbitrary TextMate syntax theme parity, or new Office-application integration testing.
- Existing full-snapshot table parsing and host synchronization remain baseline costs; performance results must identify end-to-end and isolated-renderer measurements separately.

## Dependency and package evidence

Bundled language dependencies are pinned in `package-lock.json`. `THIRD_PARTY_NOTICES.md` records resolved licenses and bundle impact. The host bundle-load check prevents an installed VSIX from accidentally depending on the repository's excluded `node_modules` directory. The install script verifies the full rendering bundle, both new CSS resources, and the default-enabled manifest in the installed extension.

The final regenerated inventory, `qa/markdown-rendering-bundle-impact.json`, covers 35 bundled packages. The webview is 1,885,924 bytes (466,579 gzip), an increase of 192,473 bytes (54,297 gzip) versus the tracked baseline. The standalone extension host is 435,190 bytes (111,637 gzip); its increase includes bundling runtime dependencies previously excluded from the installed package. Both generated bundle hashes match the files on disk and the installed payload.
