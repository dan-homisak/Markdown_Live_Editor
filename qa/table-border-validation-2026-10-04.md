# Table border validation: 2026-10-04

This record documents the requested repair of the existing direct Extension Development Host border check, its independent source audit, and actual-host validation. Table styling is unchanged. The border gate is corrected and verified; the complete later host regression has a separately recorded status below. Source line references describe the inspected version and may move with the correction.

## What the existing check measures

The authored table model is explicit in `media/liveEditor.css:256-321`: separate borders, zero border spacing, a `0 solid` baseline, right and bottom borders of `1px` on each data cell, top borders only on the first header row, and a left border only on the first data column. Each internal seam is painted once. Source smoke checks at `src/test/smoke.test.ts:842-853` require the one-pixel declarations and prohibit a general top border on every data cell.

`liveMetricsExpression` in `scripts/edh-visual-check.mjs` reads `getComputedStyle(...).border*Width`. The original parity assertion compared those serialized values with hardcoded `"1px"`/`"0px"` strings. These are two different observations: authored CSS length versus the browser's resolved border width. The original test checked only the first column's header and first body cell, so it also did not inspect every seam.

Recorded actual-host baseline runs consistently resolve the authored one-pixel sides to `0.8px`, while sides authored as zero remain `0px`. The separate focused rendering run records device-pixel ratio `1.25` at zoom zero in the same installed Electron environment. The arithmetic `0.8 × 1.25 = 1` is consistent with a single device-pixel border, but arithmetic alone is not a verified Chromium rounding algorithm or proof that every zoom level uses `1 / devicePixelRatio`.

The nine preceding glyph/gutter/font/layout checks pass their existing `0.5px` tolerance. The border string mismatch stops the script at its initial `assertPixelParity` call, before the later interaction suites. A correction must preserve that tolerance and the single-edge border contract.

## Strict correction implemented

The harness now measures independent, temporary references in the same webview and effective zoom context, authored with explicit zero-, one-, and two-pixel borders. It removes the probes after reading their computed styles, keeps them out of normal layout and the accessibility tree, and records authored widths, resolved widths, device-pixel ratio, viewport scale, and effective CSS zoom. The references do not use `.mlrt-table-*` classes, so the product rule under test cannot redefine the reference.

Every expected nonzero table side is compared with the reference's resolved one-CSS-pixel width by exact equality; zero sides are checked against zero. Reference validity is checked, existing source checks retain the authored `1px` declarations, and painted sides must use solid style. No broad numeric range, rounded-to-one width, table CSS compensation, or increased general pixel tolerance was introduced.

All rendered data cells are inspected rather than only two first-column samples:

| Cell side | Required ownership |
| --- | --- |
| Right and bottom | One reference border on every data cell |
| Top | One reference border only on the first header row; zero on body rows |
| Left | One reference border only on the first data column; zero elsewhere |

This approach tests the current browser's realization of a specified CSS length without assuming a Chromium rounding formula. A product regression to double borders or missing borders still fails exact comparisons. An unexpected reference result or effective-zoom discrepancy must fail with diagnostic output rather than silently choose an expectation from the table cells themselves.

The integrating agent subsequently measured independent probes in the actual webview at device-pixel ratio `1.25`: authored `0px` resolved to `0px`; `1px` resolved to `0.8px`; and `2px` resolved to `1.6px`. A 100px probe content box measured approximately `101.599998px` with the one-pixel borders and `103.2px` with the two-pixel borders, consistent with the resolved widths on both sides. This establishes that the original assertion confused authored and browser-resolved widths in this environment. No table CSS adjustment is required by that evidence.

The first subsequent direct host run passed the border gate and proceeded through clipboard and host-Undo checks, exposing two independent navigation-harness assumptions. Those were investigated and corrected as described below. The final [complete default host run](table-border-full-validation.log) exits successfully.

The corrected gate also passed in three isolated actual-host scale cases. Each case retained all nine core geometry checks at the unchanged `0.5px` tolerance, checked 19 data cells and seven row-owned gutter cells, and reported editor/table CSS zoom `1`. The integrating agent directly inspected all three corresponding screenshots.

| Actual device-pixel ratio | One-CSS-pixel reference resolves to | Border and geometry result |
| --- | --- | --- |
| 1 | `1px` | Passed; [measurements](edh-table-borders-dpr-1.json) |
| 1.25 | `0.8px` | Passed; [measurements](edh-table-borders-dpr-1-25.json) |
| 2 | `1px` | Passed; [measurements](edh-table-borders-dpr-2.json) |

At each scale, six deliberate actual-DOM regressions were rejected: missing outer border, doubled outer border, doubled row seam, doubled column seam, border in the line-number gutter, and dashed separator. These negative controls verify that the corrected assertion still catches the border failures it is intended to prevent. The DPR 2 result also demonstrates why `1 / devicePixelRatio` would have been the wrong generic expectation.

## Complete host regression and installation

The required direct `node scripts/edh-visual-check.mjs` passed to completion in isolated profile `mlrt-edh-8RfnMx`, using the final compiled product code. All 67 logged check stages completed, including table/clipboard interactions, host Undo, wrapped selection, synthetic composition conflict reconciliation, and the final platform shortcut returning to stock Monaco. This is the complete default script with experimental rendering disabled; the separate 25-check suite covers the enabled prototype. Final same-layout stock/live screenshots were directly inspected.

Two later harness corrections were necessary after the original border failure stopped masking them:

- The general ArrowUp test expected an unclamped horizontal coordinate even when the preceding wrapped row was shorter. Independent grapheme/caret measurements place that row's nearest available caret at `595.575px`; the actual caret was `595.5625px`, a `0.0125px` difference. The former `61.575px` delta was measured against an unavailable column on that row. The assertion now checks the independently measured clamped goal, uses the actual line height, and verifies native horizontal goal resets. Its existing column tolerance was not increased.
- The exact-fixture test required both glyphs adjacent to a caret to occupy one row, which excludes a valid soft-wrap boundary. After ArrowUp, offset `110` is the end of the intended visual row while its next glyph begins the following row. Collapsed caret rectangles and an independent native line-boundary selection both confirm the intended row (`74–110`). The assertion requires this affinity evidence and the clamped column; checking only a neighboring glyph would be insufficient. The following ArrowDown lands at offset `35` on native visual row `0–36` in the destination cell. Table product navigation was not changed.

The script's final return-to-source shortcut also now uses its existing platform-specific modifier selection instead of hardcoding the macOS chord on Windows.

`npm.cmd test` passed, including TypeScript compilation, table/clipboard regression suites, marker/focus tests, isolated bundled-host loading, and the new deterministic permission/disposal race tests. `Build_and_Install.cmd` completed and verified **version 0.1.173**. Installed host/browser bundles, CSS, and notices match the workspace byte-for-byte. Experimental rendering remains default false. The broader feasibility limitations below still apply.

## Feasibility work identified and advanced during the continuation

1. **Host accessibility mode transitions — focused proof completed.** The twenty-five-check run changed the isolated profile's actual `editor.accessibilitySupport` setting to `on` and back through normal configuration propagation. It verified literal marker source, removed controls, table DOM identity, and owned-focus release/recovery. This proves mode plumbing, not actual screen-reader announcements.
2. **Viewport eviction and focus recovery — focused proof completed.** The same run used a 2,002-task temporary fixture, focused a checkbox through the host command, and scrolled it outside the real CodeMirror viewport. The old control disconnected, the visible projection held 92 controls / 184 markers and sizes, the mapped source bookmark received focus without scroll-back, source remained unchanged, and the control was recreated after returning. External prefix insertion, task deletion, and newer nonempty selection tests also passed. Broader lifecycle/retained-cache behavior remains open.
3. **Pending-pointer cancellation.** Hold a real checkbox pointer press, disable rendering through host settings, then release. Assert no task edit, no extra acknowledgement, and usable source/table input. Repeat with pointer cancellation or ownership change if the harness can produce the event without pretending it is a physical device test.
4. **Clipboard isolation with the feature enabled.** Reuse the existing actual-host copy/cut/paste checks with selected source spanning rendered markers and tables, checking source bytes and exported HTML for absence of generated task controls. The already passing nineteen focused checks cover drag handoff and two specific selection owners, not the whole clipboard matrix.
5. **Controlled dynamic geometry and hidden-view lifecycle.** Change font metrics while the control owns focus, and switch away/back to the retained custom editor while an ordinary edit acknowledgement settles. Verify measured source geometry, bookmark ownership, table identity, and no hidden-view focus theft. Record supported workbench-setting behavior separately from view-width-only experiments.

Real OS IME and actual assistive-technology checks remain separate acceptance work; synthetic composition or setting changes must not be renamed as those proofs. Browser layout/paint, input-to-next-paint, heap/cache retention, and 100,000-line structural performance also remain open despite the CPU-only characterization.
