# Dated reports

Written records of past investigations and validations. Each describes the version it names and
is not updated afterwards; for the current state read [PROGRESS](../PROGRESS.md) and
[TESTING](../TESTING.md).

| Report | Subject |
| --- | --- |
| [design-spec-review-2026-10-04](design-spec-review-2026-10-04.md) | First review of the rendering design |
| [design-spec-engineering-review-2026-10-04](design-spec-engineering-review-2026-10-04.md) | Engineering review that turned the design into an implementation reference |
| [markdown-rendering-feasibility-2026-10-04](markdown-rendering-feasibility-2026-10-04.md) | Baseline, prototype and performance characterization before the rendering work |
| [markdown-rendering-release-2026-10-04](markdown-rendering-release-2026-10-04.md) | The readable-source rendering release, version 0.1.174, with the last large-document measurements |
| [table-border-validation-2026-10-04](table-border-validation-2026-10-04.md) | How table borders are measured and calibrated |
| [live-preview-2026-10-04](live-preview-2026-10-04.md) | The Live Preview release, version 0.1.176: what was delivered, lessons and limits |
| [list-rendering-validation](list-rendering-validation.md) | List guides, folding and marker behavior |
| [reliability-audit-2026-11-13](reliability-audit-2026-11-13.md) | Audit of version 0.1.233 for lost input and start-up failures: a save race, read-only documents, history memory |

Reading notes:

- The reports name logs, result files and screenshots that were local output of the runs they
  describe. Those files are not kept in the repository; the conclusions are in the report text.
- Paths and names are as they were when the report was written. The design spec is now
  `docs/DESIGN_SPEC.md`, and the fixtures are in `test/fixtures/`.
- A new report goes here when an investigation produces findings worth keeping. Write
  conclusions, commands and results; leave raw output in `qa/`, which is ignored.
