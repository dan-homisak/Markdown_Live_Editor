# Live Markdown design: engineering review, 2026-10-04

Scope: revise `LIVE_MARKDOWN_RENDERING_DESIGN_SPEC.md` into the implementation reference for the next rendering release. Reviewed commit `db29a34`, extension `0.1.169`. This review changes the design, not runtime rendering. The earlier [baseline review](design-spec-review-2026-10-04.md) remains a historical record.

## Assessment

The existing direction is sound: keep the VS Code source-editor geometry, retain the table editor, and add local rendering. The document needed firmer decisions at the boundaries between source selection, generated controls, asynchronous host edits, and release scope. Its extensive preservation rules also obscured the positive product experience.

The revised reference leads with six user journeys, consolidates protected behavior, and separates visual language, interactions, architecture, and release evidence. Its distinctive experience comes from visible syntax, compact typography, local controls, and stable geometry.

## Findings and decisions

| Finding | Consequence | Revision |
| --- | --- | --- |
| Source selection and checkbox focus had competing priority rules. | Implementations could hide selected text, remount a focused control, or make keyboard focus impossible. | Effective mixed/source selection wins; explicit control focus overrides only collapsed-caret reveal. Preserve newer selection when releasing focus. |
| Control lifetime assumed mounted DOM could retain focus indefinitely. | Virtualization, disable, ownership changes, and Command Palette focus could lose context or target another document. | Define bookmarks, invocation context, viewport eviction, fallback, and focus release without stealing workbench focus. |
| “Innermost containing task” left ordinary nested list items ambiguous. | A command in a normal subitem could unexpectedly complete its parent task. | Target the nearest enclosing list item only if it is itself a task; exclude code and protected tables. |
| Host revision was discussed like document identity. | Optimistic edits share host revisions; snapshots can advance revision without changing text. Revision-only caches can be wrong. | Separate immutable/local document generation from acknowledgement revision and parser progress. Preserve snapshot validation and the conflict floor. |
| Recovery concentrated on removing decorations. | Submitted edits could be abandoned; parser/input changes or a failed plugin could leave the base editor altered. | Separate disposable presentation from in-flight edits; verify input with the switch on/off and test rendering-layer initialization/update failure. |
| Heading-fragment navigation, cross-document indexes, and special footnote parsing expanded scope. | Independent slug, indexing, invalidation, and navigation policies would delay core live editing. | Defer explicitly. Retain ordinary links/references and bounded host opening; unsupported destinations are not presented as actionable. |
| “One parser” could imply replacing table/clipboard parsing or forbidding host verification. | Either interpretation risks behavior or adds a duplicate rendering service. | One configured editor parser for new classification; retain existing owners and share pure host verification on demand. |
| Geometry, semantic fonts, and performance targets were insufficiently distinguished. | Engineers could chase impossible styled-source wrap parity or overlook poor total latency. | Separate ordinary-source parity from live-marker stability; retain budgets and require baseline/end-to-end measurements. |
| UI detail outweighed discoverability and user journeys. | Isolated styling checks would not establish usability. | Add task context-menu/hover discovery and complete reading/writing journey review. |

Also removed warning-color semantics from the default list-marker mapping, clarified host ownership of BOM/encoding/save behavior, and identified the supported task-marker subset as an intentional dialect policy.

## Source grounding

Inspected host synchronization/validation, webview composition and optimistic reconciliation, extension assembly, table recognition/decorations, selection interfaces, coordinate mapping, geometry/theme integration, package scripts, README, and the earlier review.

Undo/redo routes through the host despite a stale local-history comment in `liveEditorExtensions.ts`. That comment is not architectural authority. Table parsing is memoized by immutable document object but scans each new snapshot; host messages include before/final text. The performance plan acknowledges those costs.

Checked official [VS Code custom-editor documentation](https://code.visualstudio.com/api/extension-guides/custom-editors), [webview theming](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content), [modifier settings](https://code.visualstudio.com/docs/editing/codebasics#_multiple-selections-multicursor), [CommonMark](https://spec.commonmark.org/0.31.2/), [GFM tasks](https://github.github.com/gfm/#task-list-items-extension-), and [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). CodeMirror's documentation endpoint returned HTTP 403; installed package declarations supplied the direct/viewport-derived decoration distinction.

## Validation

| Check | Result |
| --- | --- |
| `npm.cmd test` (includes compile) | Passed TypeScript, bundle, and all existing suites, including 10,000-operation editing fuzz and 10,011-line/104-table gutter contract. |
| Direct host visual check | Fresh stock/live captures in one isolated Extension Development Host. Core geometry passed; full script failed the existing border assertion below. |
| Direct screenshot inspection | Inspected both captures: stock source and live table editor in the same layout, without a blocking onboarding/sign-in modal. |
| Document structure/diff | Markdown parse and local links passed. Spec: 29 headings, 10 tables with consistent row widths, 5,621 words versus 5,850 before revision. `git diff --check` passed. |
| Required build/install | `Build_and_Install.cmd` passed; verified version and installed payload for `0.1.170`. The required script bumped `package.json` and `package-lock.json` from `0.1.169`. |

Initial sandboxed Electron launch exited with code `2147483651` before exposing a workbench target. The unchanged script obtained captures with sandbox escalation.

Fresh [stock](edh-stock.png) and [live](edh-live.png) captures show the same right-side Chat panel and editor area. Stock has its minimap; the existing live editor does not. Both use Consolas at 14px. All nine reported geometry comparisons pass 0.5 CSS px: principal horizontal differences are approximately 0.325px; line heights are 19px stock and 18.9px live. No editor/table horizontal overflow was reported; active gutter background is transparent.

The script then fails because header borders measure `0.8px` on each side against exact `1px` expectations; body borders measure `0px` top and `0.8px` elsewhere against `0px`/`1px`. This reproduces the earlier baseline failure. Cause remains unestablished; display quantization is not a proven diagnosis. Later host-interaction checks do not execute after this assertion. No border styling or test expectation changed.

Screenshots are ignored local QA artifacts and may be overwritten. This inspection covers the reviewed baseline, not future theme, accessibility, IME, performance, or interaction gates, and does not establish full visual parity.
