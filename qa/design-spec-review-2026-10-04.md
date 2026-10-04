# Design specification review: 2026-10-04

Scope: architectural and editorial revision of `LIVE_MARKDOWN_RENDERING_DESIGN_SPEC.md`. No runtime feature, table style, or visual-test expectation was changed.

## Baseline and decisions

- Reviewed repository commit: `f9524ce`; runtime baseline: extension `0.1.168`.
- VS Code: `1.140.0`, commit `07f806f999227108933c2e30515b26eecc1fda74`, Windows x64.
- The user selected support for all VS Code themes, with GitHub Dark Default as the visual reference.
- Source ownership now includes tables; always-rendered table protection is explicitly limited to the live editor, preserving the stock-editor toggle.
- The plan follows the implementation's host-routed undo, revision validation, normalized offsets, and composition handling. A stale local-history comment was not treated as architectural authority.
- Added explicit control focus and link-command routes, stale-action handling, parser/measurement invalidation, and a reversible rollout setting.
- Deferred new hanging indentation to preserve existing wrapping. Removed theme-exclusive functionality, repeated prohibitions, and rigid preservation of incidental code structure.
- Moved feasibility checks ahead of broad feature implementation. Preserved table and clipboard behavior as regression contracts.
- Reduced the spec from approximately 9,675 to 5,850 whitespace-delimited words. Markdown parsing found 33 headings and 10 tables with structurally consistent rows.

## Verification performed

| Check | Result |
| --- | --- |
| `npm.cmd run compile` | Passed: TypeScript and webview bundle. |
| `npm.cmd test` | Passed all existing suites, including the 10,000-operation editing fuzz and 10,011-line/104-table gutter fixture contract. |
| `git diff --check` | Passed after removing trailing metadata whitespace. |
| `node scripts/edh-visual-check.mjs` | Captured stock/live in one isolated Extension Development Host; failed the existing exact table-border assertion described below. |
| Direct image inspection | Inspected both newly captured screenshots; confirmed the stock source and live rendered-table surfaces in the same workbench layout. |
| `Build_and_Install.cmd` | Passed; packaged and verified installation of `0.1.169`. The required build bumped `package.json` and `package-lock.json` from `0.1.168`. |

The sandboxed Electron launch first exited before exposing a workbench target. Running the unchanged harness outside that sandbox produced the captures and measurements. This was an environment launch failure, not a rendering result.

## Visual baseline limitation

The harness saved [stock](edh-stock.png) and [live](edh-live.png) screenshots. These are local ignored QA artifacts and may be overwritten by later runs. The captured layout included the same right-side Chat panel; stock showed its minimap and live showed the existing table editor. This was a current-baseline inspection, not validation of future rendering or the GitHub reference palette.

All nine reported core geometry comparisons passed the 0.5 CSS px threshold. Both editors used Consolas at 14px. Stock line height was 19px; live was 18.9px. Gutter/content/glyph alignment differences were approximately 0.325px after coordinate conversion. Active gutter background remained transparent, with no reported horizontal overflow.

The harness then failed because header borders measured `0.8px` on all sides versus exact `1px` expectations. Body borders measured top `0px`, other sides `0.8px`, versus top `0px`, other sides `1px`. This reproduces the issue noted in the prior spec. The run stopped at that assertion, so later host-interaction checks did not execute.

Cause is not established here. Fractional display rasterization is a hypothesis, not a verified diagnosis; the run did not record a complete DPI/theme/version matrix. A follow-up must record display scale/zoom and distinguish a baseline product defect from a harness assertion issue before modifying either. No borders were restyled and no assertions were weakened in this review.

Future parser, accessibility, theme, IME, performance, and interaction gates in the revised spec remain implementation requirements, not results of this document review.
