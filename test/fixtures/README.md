# Test fixtures

Documents written only to be test input. Each one exists for the checks named beside it, says
what those checks rely on, and is frozen. They are not samples and not documentation: for
documents to open and edit by hand, use `samples/`, which no test reads.

| Fixture | Purpose | Read by |
| --- | --- | --- |
| `markdown-constructs.md` | One section per Markdown construct the live preview classifies | The construct unit test; the release, live-preview, toggle and scroll host checks |
| `code-languages.md` | Nine fenced code blocks for comparing token colors with the stock editor | The code-highlighting host check |
| `table-cells.md` | Table cell content, tall and wrapping rows, table shapes | The visual host check's caret navigation regression; the standalone harness |
| `gutter-stress.md` | A 10,000-line document with over 100 tables, for line numbers and deep scrolling | The gutter contract unit test; the visual host check. Generated: change it only with `npm run fixtures:gutter` |
| `manifest.json` | SHA-256 of every fixture | The fixtures unit test |

## How the fixtures are built

- **Cases have identifiers.** `MC-EM-01` is a construct case, `CL-03` a code block, `TC-NAV-02` a
  table row, and the stress document uses bracketed IDs such as `[GB9995]`. A check finds its
  input by identifier or by section heading, never by line number, so a fixture can gain cases
  without retargeting a check.
- **Each fixture states its contract** at the top: the properties its readers depend on.
- **The contract is executable.** `src/test/fixtures.test.ts` asserts it: the section headings of
  the constructs fixture, its single contents marker and two footnotes; the order and first line
  of the code blocks; four columns in every table and the two adjacent navigation rows with
  exactly 35 characters before the bold text. The same test fails if any test or script refers
  to the samples folder.
- **Whitespace is content.** The constructs fixture contains a hard line break made of two
  trailing spaces. Do not let an editor trim it.

## Changing a fixture

A fixture changes only on purpose, in the same change as the tests that depend on it:

1. Add a case with a new identifier, or edit the fixture. Regenerate the stress document with
   its script; never edit it by hand.
2. Update the checks whose expectations it changes, and the contract assertions if the contract
   changed.
3. Run `npm run fixtures:manifest` to record the new hash.
4. Run `npm test`, then the host checks that read the fixture.

Fixtures are stored with LF line endings on every platform. Hashes are computed after
normalizing line endings, so the guard does not depend on the checkout.
