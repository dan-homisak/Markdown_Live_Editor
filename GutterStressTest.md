---
title: Markdown Live Editor Gutter Exhaustive Stress Test
purpose: source-line continuity, table-owned gutter geometry, clipping, wrapping, editing, and virtualization
fixture-version: 1
line-ending-note: the live editor normalizes LF and CRLF before rendering
tags: [markdown, tables, gutter, windows, macos, regression]
---

# Markdown Live Editor — Exhaustive Gutter Stress Test

This is a source-line test instrument, not a prose-rendering showcase. Open it first in the stock VS Code text editor, then toggle **Markdown Live Editor** in the same window and compare the gutters at identical widths, zoom levels, fonts, and workbench layouts.

## The numbering oracle

For every rendered table in this file:

1. The table header keeps its actual source line number.
2. The Markdown delimiter consumes one source line but has no rendered row.
3. Therefore the first body row is normally header line plus two. That single skipped number is intentional.
4. Later body rows increase by exactly one source line each.
5. The first prose line after a table continues from the final table source line, including any intentional blank lines.
6. No number may duplicate, move to the wrong visual row, disappear because a row wrapped, or be covered by the table.
7. The left edge, right padding, active-line color, and digit alignment must match the ordinary CodeMirror gutter.

Every live-table header begins with a stable bracketed ID such as `[GS001]`. Use the ID to report a failure; do not rely on a hard-coded line number after you begin editing.

## Required manual passes

- Compare stock and live editors in the same VS Code window.
- Test editor widths near 320, 480, 640, 900, and 1400 CSS pixels.
- Test wrapping on and off.
- Test zoom at 80%, 100%, 125%, 150%, and 200%.
- Test a font with narrow digits and a font with wide/tabular digits.
- Test with Explorer, terminal, and chat sidebars opened on both the left and right.
- Test with the minimap enabled and disabled.
- Scroll vertically in short jumps, page jumps, scrollbar drags, and direct line-number navigation.
- Horizontally scroll every wide table; its table-owned gutter must remain fixed and unclipped.
- Focus the first, middle, and last cell of wrapped rows; the active gutter number must follow the focused source row.
- Drag-select from prose into a table, table gutter into prose, and across multiple tables.
- Repeat on Windows and macOS. On Windows, also save once as CRLF and once as LF.

## Required edit passes

- Insert and delete prose lines before a table; all downstream table numbers must update immediately.
- Insert and delete blank lines directly above and below a table.
- Edit a short cell until it wraps to two, five, and ten visual lines.
- Replace a long cell with an empty value and undo/redo repeatedly.
- Insert and delete table rows at the top, middle, and bottom.
- Insert and delete columns in narrow and horizontally scrolling tables.
- Paste multiline text into a cell, then undo and redo.
- Convert a valid delimiter to an invalid one and back.
- Add and remove leading/trailing outer pipes.
- Move a table across the 99/100 and 999/1000 source-line boundaries.

## Failure record template

- Case ID:
- OS and VS Code version:
- Font, zoom, wrapping, and editor width:
- Operation immediately before failure:
- Expected source number sequence:
- Actual visible sequence:
- Screenshot of stock and live editors in the same layout:

## Part 1 — Decimal digit boundaries

The first calibrated table starts on source line 99. Its separator is line 100 and its first body row is line 101.
<!-- GUTTER-RENDERED-CASE: GB099 -->
PRE-BOUNDARY-PAD-0069: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0070: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0071: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0072: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0073: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0074: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0075: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0076: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0077: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0078: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0079: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0080: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0081: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0082: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0083: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0084: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0085: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0086: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0087: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0088: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0089: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0090: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0091: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0092: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0093: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0094: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0095: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0096: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0097: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-BOUNDARY-PAD-0098: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
| [GB099] Header on line 99 | Boundary role |
| --- | --- |
| First body row on line 101 | The missing visible 100 is only the Markdown delimiter. |
| Second body row on line 102 | This confirms the table-owned gutter has crossed into three digits. |
GB099-AFTER: this prose line is intentionally adjacent to the table with no blank source line.

## Part 2 — Pipe-table syntax matrix

<!-- GUTTER-RENDERED-CASE: GS001 -->
### GS001 — canonical outer pipes with spaces
| [GS001] Name | Value | Notes |
| --- | --- | --- |
| Alpha | 1 | canonical body row |
| Beta | 2 | second body row |
GS001-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS002 -->
### GS002 — fully compact outer pipes
|[GS002]A|B|C|
|---|---|---|
|x|y|z|
GS002-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS003 -->
### GS003 — no outer pipes
[GS003] A | B | C
--- | --- | ---
one | two | three
GS003-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS004 -->
### GS004 — leading pipe only
| [GS004] A | B | C
| --- | --- | ---
| one | two | three
GS004-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS005 -->
### GS005 — trailing pipe only
[GS005] A | B | C |
--- | --- | --- |
one | two | three |
GS005-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS006 -->
### GS006 — single-column table
| [GS006] Only column |
| --- |
| first |
| second |
GS006-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS007 -->
### GS007 — header-only table
The delimiter is hidden and there are no body rows; the next prose line must still account for both source lines.
| [GS007] Header A | Header B |
| --- | --- |
GS007-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS008 -->
### GS008 — one body row
| [GS008] Header A | Header B |
| --- | --- |
| only body | only neighbor |
GS008-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS009 -->
### GS009 — left, center, and right alignment delimiters
| [GS009] Left | Center | Right |
| :--- | :---: | ---: |
| left | center | 12345 |
GS009-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS010 -->
### GS010 — long delimiter runs and uneven padding
| [GS010] A      | B | C        |
| :------------ |:------:| ----------------: |
| padded | compact | right |
GS010-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS011 -->
### GS011 — empty header and body cells
| [GS011] |  | Last |
| --- | --- | --- |
|  |  |  |
| value |  | tail |
GS011-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS012 -->
### GS012 — empty first and final columns
| [GS012] | Middle |  |
| --- | --- | --- |
|  | value |  |
GS012-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS013 -->
### GS013 — header wider than delimiter
Verify four cells render and the gutter stays independent from ragged table width.
| [GS013] A | B | C | D |
| --- | --- |
| one | two | three | four |
GS013-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS014 -->
### GS014 — delimiter wider than header
| [GS014] A | B |
| --- | --- | --- | --- |
| one | two | three | four |
GS014-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS015 -->
### GS015 — body wider than header and delimiter
| [GS015] A | B |
| --- | --- |
| one | two | three | four | five |
GS015-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS016 -->
### GS016 — ragged body rows
| [GS016] A | B | C | D |
| --- | --- | --- | --- |
| one | two |
| one | two | three |
| one | two | three | four |
GS016-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS017 -->
### GS017 — delimiter-looking body rows
| [GS017] A | B |
| --- | --- |
| first | row |
| --- | --- |
| :---: | ---: |
| final | row |
GS017-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS018 -->
### GS018 — minimum three-hyphen delimiters
| [GS018] A | B | C |
| --- | :---: | ---: |
| x | y | z |
GS018-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS019 -->
### GS019 — tabs and mixed whitespace
| [GS019] A	|	B | C |
|	---	|	:---:	|	---:	|
| alpha	|	beta | gamma |
GS019-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS020 -->
### GS020 — one-space source indentation
 | [GS020] A | B |
 | --- | --- |
 | one | two |
GS020-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS021 -->
### GS021 — two-space source indentation
  | [GS021] A | B |
  | --- | --- |
  | one | two |
GS021-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS022 -->
### GS022 — three-space source indentation
   | [GS022] A | B |
   | --- | --- |
   | one | two |
GS022-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS023 -->
### GS023 — escaped and entity pipes
| [GS023] Expression | Meaning |
| --- | --- |
| a \| b | backslash-escaped pipe |
| a &#124; b | numeric entity pipe |
| a &vert; b | named entity pipe |
GS023-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS024 -->
### GS024 — backslash runs near separators
| [GS024] Value | Neighbor |
| --- | --- |
| path\\ | even slash run |
| path\ | odd slash before padding |
| C:\\folder\\ | Windows-looking path |
GS024-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS025 -->
### GS025 — inline Markdown source in cells
| [GS025] Feature | Literal source |
| --- | --- |
| emphasis | **bold** *italic* ~~strike~~ |
| code | `const value = 1` and ``double ` tick`` |
| link | [label](https://example.com "title") |
GS025-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS026 -->
### GS026 — HTML breaks create tall rows
| [GS026] Row | Height stress |
| --- | --- |
| one | line 1<br>line 2<br>line 3<br>line 4 |
| two | short again |
| three | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
GS026-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS027 -->
### GS027 — long wrapping prose
| [GS027] Key | Value |
| --- | --- |
| wrapped | This sentence deliberately contains many ordinary words so the same source row becomes two, five, or ten visual lines as the editor narrows, while its gutter number remains one full-height row target aligned to the top. |
| after wrap | short |
GS027-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS028 -->
### GS028 — unbroken tokens and URLs
| [GS028] Key | Value |
| --- | --- |
| token | abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 |
| url | https://example.com/a/very/long/path/with/query?alpha=abcdefghijklmnopqrstuvwxyz&beta=ABCDEFGHIJKLMNOPQRSTUVWXYZ#fragment |
GS028-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS029 -->
### GS029 — Unicode, combining marks, and emoji
| [GS029] Script | Text |
| --- | --- |
| Latin | café naïve résumé coöperate é combining |
| CJK | 中文内容 日本語の文章 한국어 문장 |
| Emoji | 😀 ✅ ⚠️ 📌 👨‍👩‍👧‍👦 |
GS029-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS030 -->
### GS030 — bidirectional and RTL text
| [GS030] Direction | Text |
| --- | --- |
| Arabic | العربية نص من اليمين إلى اليسار |
| Hebrew | עברית טקסט מימין לשמאל |
| Mixed | English العربية 123 עברית English |
GS030-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS031 -->
### GS031 — Markdown-looking cell starts
| [GS031] Token | Neighbor |
| --- | --- |
| # heading-looking | value |
| - list-looking | value |
| 1. ordered-looking | value |
| > quote-looking | value |
| --- | delimiter-looking value |
GS031-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS032 -->
### GS032 — raw HTML-looking text
| [GS032] HTML | Neighbor |
| --- | --- |
| <strong>bold-looking</strong> | <span title="x">span-looking</span> |
| <table><tr><td>nested-looking</td></tr></table> | sibling |
GS032-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS033 -->
### GS033 — many short rows
| [GS033] Index | Value |
| ---: | --- |
| 1 | row-01 |
| 2 | row-02 |
| 3 | row-03 |
| 4 | row-04 |
| 5 | row-05 |
| 6 | row-06 |
| 7 | row-07 |
| 8 | row-08 |
| 9 | row-09 |
| 10 | row-10 |
| 11 | row-11 |
| 12 | row-12 |
| 13 | row-13 |
| 14 | row-14 |
| 15 | row-15 |
| 16 | row-16 |
| 17 | row-17 |
| 18 | row-18 |
| 19 | row-19 |
| 20 | row-20 |
| 21 | row-21 |
| 22 | row-22 |
| 23 | row-23 |
| 24 | row-24 |
GS033-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS034 -->
### GS034 — twenty-four-column horizontal overflow
Scroll fully right and back. The table-owned gutter must stay fixed, opaque, and above the cells.
| [GS034] C01 | C02 | C03 | C04 | C05 | C06 | C07 | C08 | C09 | C10 | C11 | C12 | C13 | C14 | C15 | C16 | C17 | C18 | C19 | C20 | C21 | C22 | C23 | C24 |
| --- | --- | --- | :---: | --- | --- | :---: | --- | --- | :---: | --- | --- | :---: | --- | --- | :---: | --- | --- | :---: | --- | --- | :---: | --- | --- |
| value-01 | value-02 | value-03 | value-04 | value-05 | value-06 | value-07 | value-08 | value-09 | value-10 | value-11 | value-12 | value-13 | value-14 | value-15 | value-16 | value-17 | value-18 | value-19 | value-20 | value-21 | value-22 | value-23 | value-24 |
| second-01 | second-02 | second-03 | second-04 | second-05 | second-06 | second-07 | second-08 | second-09 | second-10 | second-11 | second-12 | second-13 | second-14 | second-15 | second-16 | second-17 | second-18 | second-19 | second-20 | second-21 | second-22 | second-23 | second-24 |
GS034-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS035 -->
### GS035 — wide cells plus many columns
| [GS035] Identity | Long heading 2 | Long heading 3 | Long heading 4 | Long heading 5 | Long heading 6 | Long heading 7 | Long heading 8 | Long heading 9 | Long heading 10 | Long heading 11 | Long heading 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| column-1-abcdefghijklmnopqrstuvwxyz0123456789 | column-2-abcdefghijklmnopqrstuvwxyz0123456789 | column-3-abcdefghijklmnopqrstuvwxyz0123456789 | column-4-abcdefghijklmnopqrstuvwxyz0123456789 | column-5-abcdefghijklmnopqrstuvwxyz0123456789 | column-6-abcdefghijklmnopqrstuvwxyz0123456789 | column-7-abcdefghijklmnopqrstuvwxyz0123456789 | column-8-abcdefghijklmnopqrstuvwxyz0123456789 | column-9-abcdefghijklmnopqrstuvwxyz0123456789 | column-10-abcdefghijklmnopqrstuvwxyz0123456789 | column-11-abcdefghijklmnopqrstuvwxyz0123456789 | column-12-abcdefghijklmnopqrstuvwxyz0123456789 |
GS035-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS036 -->
### GS036 — reference and autolink source
| [GS036] Kind | Value |
| --- | --- |
| reference | [Example][gutter-example-ref] |
| autolink | <https://example.com/path?query=value#fragment> |
| email | <gutter@example.com> |
GS036-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS037 -->
### GS037 — quotes, entities, and symbols
| [GS037] Kind | Value |
| --- | --- |
| quotes | "double" 'single' “curly” ‘curly’ |
| entities | &amp; &lt; &gt; &quot; &#39; &copy; &reg; |
| symbols | ± × ÷ → ← ↔ ∑ √ ∞ |
GS037-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS038 -->
### GS038 — very long header with short body
| [GS038] This header is intentionally much longer than the body and must wrap without moving the row number away from the source header line | Neighbor |
| --- | --- |
| x | y |
GS038-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS039 -->
### GS039 — empty trailing cells without uniform outer style
[GS039] A | B | 
--- | --- | ---
one | two | 
three |  | 
GS039-AFTER: the first prose gutter number after this table must continue from the final table source row.

<!-- GUTTER-RENDERED-CASE: GS040 -->
### GS040 — single-character and numeric values
| [GS040] 0 | 1 | -1 | 1.25 |
| --- | --- | --- | --- |
| a | b | c | d |
| 0 | 00 | 000 | 0000 |
GS040-AFTER: the first prose gutter number after this table must continue from the final table source row.

## Part 3 — Calibrated 999/1000 boundary and long-table stress

The next live table is calibrated so its header is source line 995, delimiter is 996, and body rows cross 999/1000. The table is intentionally tall enough to exercise scrolling, wrapped row heights, and four-digit gutter width.
<!-- GUTTER-RENDERED-CASE: GB995 -->
PRE-THOUSAND-RAMP-0450: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0451: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0452: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0453: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0454: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0455: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0456: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0457: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0458: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0459: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0460: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0461: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0462: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0463: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0464: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0465: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0466: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0467: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0468: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0469: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0470: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0471: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0472: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0473: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0474: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0475: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0476: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0477: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0478: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0479: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0480: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0481: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0482: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0483: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0484: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0485: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0486: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0487: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0488: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0489: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0490: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0491: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0492: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0493: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0494: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0495: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0496: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0497: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0498: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0499: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0500: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0501: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0502: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0503: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0504: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0505: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0506: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0507: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0508: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0509: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0510: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0511: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0512: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0513: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0514: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0515: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0516: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0517: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0518: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0519: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0520: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0521: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0522: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0523: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0524: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0525: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0526: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0527: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0528: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0529: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0530: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0531: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0532: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0533: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0534: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0535: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0536: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0537: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0538: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0539: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0540: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0541: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0542: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0543: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0544: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0545: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0546: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0547: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0548: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0549: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0550: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0551: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0552: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0553: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0554: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0555: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0556: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0557: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0558: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0559: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0560: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0561: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0562: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0563: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0564: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0565: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0566: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0567: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0568: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0569: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0570: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0571: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0572: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0573: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0574: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0575: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0576: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0577: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0578: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0579: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0580: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0581: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0582: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0583: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0584: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0585: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0586: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0587: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0588: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0589: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0590: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0591: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0592: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0593: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0594: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0595: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0596: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0597: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0598: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0599: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0600: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0601: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0602: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0603: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0604: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0605: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0606: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0607: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0608: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0609: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0610: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0611: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0612: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0613: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0614: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0615: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0616: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0617: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0618: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0619: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0620: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0621: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0622: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0623: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0624: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0625: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0626: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0627: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0628: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0629: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0630: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0631: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0632: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0633: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0634: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0635: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0636: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0637: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0638: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0639: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0640: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0641: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0642: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0643: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0644: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0645: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0646: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0647: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0648: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0649: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0650: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0651: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0652: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0653: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0654: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0655: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0656: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0657: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0658: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0659: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0660: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0661: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0662: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0663: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0664: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0665: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0666: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0667: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0668: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0669: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0670: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0671: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0672: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0673: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0674: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0675: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0676: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0677: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0678: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0679: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0680: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0681: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0682: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0683: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0684: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0685: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0686: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0687: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0688: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0689: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0690: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0691: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0692: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0693: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0694: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0695: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0696: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0697: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0698: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0699: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0700: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0701: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0702: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0703: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0704: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0705: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0706: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0707: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0708: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0709: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0710: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0711: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0712: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0713: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0714: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0715: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0716: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0717: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0718: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0719: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0720: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0721: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0722: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0723: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0724: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0725: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0726: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0727: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0728: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0729: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0730: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0731: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0732: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0733: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0734: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0735: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0736: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0737: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0738: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0739: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0740: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0741: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0742: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0743: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0744: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0745: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0746: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0747: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0748: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0749: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0750: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0751: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0752: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0753: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0754: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0755: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0756: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0757: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0758: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0759: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0760: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0761: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0762: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0763: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0764: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0765: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0766: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0767: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0768: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0769: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0770: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0771: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0772: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0773: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0774: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0775: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0776: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0777: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0778: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0779: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0780: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0781: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0782: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0783: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0784: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0785: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0786: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0787: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0788: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0789: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0790: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0791: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0792: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0793: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0794: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0795: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0796: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0797: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0798: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0799: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0800: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0801: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0802: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0803: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0804: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0805: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0806: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0807: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0808: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0809: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0810: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0811: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0812: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0813: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0814: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0815: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0816: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0817: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0818: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0819: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0820: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0821: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0822: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0823: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0824: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0825: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0826: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0827: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0828: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0829: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0830: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0831: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0832: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0833: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0834: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0835: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0836: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0837: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0838: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0839: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0840: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0841: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0842: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0843: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0844: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0845: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0846: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0847: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0848: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0849: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0850: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0851: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0852: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0853: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0854: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0855: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0856: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0857: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0858: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0859: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0860: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0861: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0862: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0863: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0864: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0865: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0866: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0867: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0868: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0869: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0870: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0871: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0872: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0873: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0874: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0875: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0876: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0877: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0878: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0879: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0880: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0881: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0882: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0883: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0884: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0885: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0886: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0887: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0888: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0889: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0890: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0891: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0892: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0893: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0894: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0895: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0896: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0897: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0898: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0899: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0900: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0901: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0902: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0903: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0904: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0905: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0906: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0907: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0908: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0909: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0910: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0911: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0912: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0913: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0914: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0915: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0916: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0917: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0918: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0919: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0920: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0921: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0922: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0923: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0924: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0925: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0926: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0927: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0928: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0929: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0930: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0931: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0932: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0933: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0934: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0935: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0936: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0937: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0938: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0939: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0940: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0941: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0942: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0943: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0944: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0945: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0946: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0947: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0948: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0949: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0950: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0951: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0952: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0953: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0954: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0955: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0956: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0957: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0958: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0959: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0960: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0961: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0962: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0963: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0964: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0965: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0966: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0967: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0968: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0969: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0970: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0971: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0972: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0973: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0974: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0975: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0976: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0977: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0978: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0979: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0980: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0981: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0982: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0983: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0984: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0985: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0986: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0987: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0988: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0989: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0990: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0991: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0992: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0993: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
PRE-THOUSAND-RAMP-0994: ordinary source line used to exercise continuous numbering, wrapping, and viewport virtualization.
| [GB995] Row | Height profile | Payload |
| ---: | --- | --- |
| 1 | short row | payload-01 |
| 2 | short row | payload-02 |
| 3 | three-break row | alpha<br>beta<br>gamma |
| 4 | short row | payload-04 |
| 5 | long wrapping row | This is a deliberately long sentence with ordinary words, punctuation, digits 0123456789, and enough material to wrap repeatedly at narrow editor widths while one source-line number remains attached to the complete visual row. |
| 6 | three-break row | alpha<br>beta<br>gamma |
| 7 | short row | payload-07 |
| 8 | short row | payload-08 |
| 9 | three-break row | alpha<br>beta<br>gamma |
| 10 | eight-break row | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
| 11 | short row | payload-11 |
| 12 | three-break row | alpha<br>beta<br>gamma |
| 13 | short row | payload-13 |
| 14 | short row | payload-14 |
| 15 | long wrapping row | This is a deliberately long sentence with ordinary words, punctuation, digits 0123456789, and enough material to wrap repeatedly at narrow editor widths while one source-line number remains attached to the complete visual row. |
| 16 | short row | payload-16 |
| 17 | short row | payload-17 |
| 18 | three-break row | alpha<br>beta<br>gamma |
| 19 | short row | payload-19 |
| 20 | eight-break row | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
| 21 | three-break row | alpha<br>beta<br>gamma |
| 22 | short row | payload-22 |
| 23 | short row | payload-23 |
| 24 | three-break row | alpha<br>beta<br>gamma |
| 25 | long wrapping row | This is a deliberately long sentence with ordinary words, punctuation, digits 0123456789, and enough material to wrap repeatedly at narrow editor widths while one source-line number remains attached to the complete visual row. |
| 26 | short row | payload-26 |
| 27 | three-break row | alpha<br>beta<br>gamma |
| 28 | short row | payload-28 |
| 29 | short row | payload-29 |
| 30 | eight-break row | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
| 31 | short row | payload-31 |
| 32 | short row | payload-32 |
| 33 | three-break row | alpha<br>beta<br>gamma |
| 34 | short row | payload-34 |
| 35 | long wrapping row | This is a deliberately long sentence with ordinary words, punctuation, digits 0123456789, and enough material to wrap repeatedly at narrow editor widths while one source-line number remains attached to the complete visual row. |
| 36 | three-break row | alpha<br>beta<br>gamma |
| 37 | short row | payload-37 |
| 38 | short row | payload-38 |
| 39 | three-break row | alpha<br>beta<br>gamma |
| 40 | eight-break row | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
| 41 | short row | payload-41 |
| 42 | three-break row | alpha<br>beta<br>gamma |
| 43 | short row | payload-43 |
| 44 | short row | payload-44 |
| 45 | long wrapping row | This is a deliberately long sentence with ordinary words, punctuation, digits 0123456789, and enough material to wrap repeatedly at narrow editor widths while one source-line number remains attached to the complete visual row. |
| 46 | short row | payload-46 |
| 47 | short row | payload-47 |
| 48 | three-break row | alpha<br>beta<br>gamma |
| 49 | short row | payload-49 |
| 50 | eight-break row | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
| 51 | three-break row | alpha<br>beta<br>gamma |
| 52 | short row | payload-52 |
| 53 | short row | payload-53 |
| 54 | three-break row | alpha<br>beta<br>gamma |
| 55 | long wrapping row | This is a deliberately long sentence with ordinary words, punctuation, digits 0123456789, and enough material to wrap repeatedly at narrow editor widths while one source-line number remains attached to the complete visual row. |
| 56 | short row | payload-56 |
| 57 | three-break row | alpha<br>beta<br>gamma |
| 58 | short row | payload-58 |
| 59 | short row | payload-59 |
| 60 | eight-break row | a<br>b<br>c<br>d<br>e<br>f<br>g<br>h |
GB995-AFTER: adjacent prose immediately after the sixty-row boundary table.

## Part 4 — Every surrounding Markdown block family

Each following case places a valid live table between source blocks. The same family is exercised on both sides whenever meaningful.


<!-- GUTTER-RENDERED-CASE: GM001 -->
### GM001 — ordinary paragraphs
GM001 before paragraph with plain text, punctuation, and 12345.
| [GM001] Header | Neighbor |
| --- | --- |
| GM001 row one | short |
| GM001 row two | This longer neighbor should wrap when the editor is narrow. |
GM001 after paragraph with plain text, punctuation, and 67890.

<!-- GUTTER-RENDERED-CASE: GM002 -->
### GM002 — multi-line soft-wrapped paragraphs
GM002 before paragraph source line one
continues on source line two
and continues on source line three.
| [GM002] Header | Neighbor |
| --- | --- |
| GM002 row one | short |
| GM002 row two | This longer neighbor should wrap when the editor is narrow. |
GM002 after paragraph source line one
continues on source line two
and continues on source line three.

<!-- GUTTER-RENDERED-CASE: GM003 -->
### GM003 — two-space hard breaks
GM003 before hard break line one.  
Before hard break line two.  
Before hard break line three.
| [GM003] Header | Neighbor |
| --- | --- |
| GM003 row one | short |
| GM003 row two | This longer neighbor should wrap when the editor is narrow. |
GM003 after hard break line one.  
After hard break line two.  
After hard break line three.

<!-- GUTTER-RENDERED-CASE: GM004 -->
### GM004 — backslash hard breaks
GM004 before backslash break one.\
Before backslash break two.\
Before backslash break three.
| [GM004] Header | Neighbor |
| --- | --- |
| GM004 row one | short |
| GM004 row two | This longer neighbor should wrap when the editor is narrow. |
GM004 after backslash break one.\
After backslash break two.\
After backslash break three.

<!-- GUTTER-RENDERED-CASE: GM005 -->
### GM005 — ATX heading levels one and two
# GM005 heading level one before
## GM005 heading level two before
| [GM005] Header | Neighbor |
| --- | --- |
| GM005 row one | short |
| GM005 row two | This longer neighbor should wrap when the editor is narrow. |
# GM005 heading level one after
## GM005 heading level two after

<!-- GUTTER-RENDERED-CASE: GM006 -->
### GM006 — ATX heading levels three through six
### GM006 heading level three before
#### GM006 heading level four before
##### GM006 heading level five before
###### GM006 heading level six before
| [GM006] Header | Neighbor |
| --- | --- |
| GM006 row one | short |
| GM006 row two | This longer neighbor should wrap when the editor is narrow. |
### GM006 heading level three after
#### GM006 heading level four after
##### GM006 heading level five after
###### GM006 heading level six after

<!-- GUTTER-RENDERED-CASE: GM007 -->
### GM007 — Setext headings
GM007 Setext level one before
===
GM007 Setext level two before
---
| [GM007] Header | Neighbor |
| --- | --- |
| GM007 row one | short |
| GM007 row two | This longer neighbor should wrap when the editor is narrow. |
GM007 Setext level one after
===
GM007 Setext level two after
---

<!-- GUTTER-RENDERED-CASE: GM008 -->
### GM008 — emphasis and inline code
GM008 before has **bold**, *italic*, ***bold italic***, ~~strike~~, and `inline code`.
| [GM008] Header | Neighbor |
| --- | --- |
| GM008 row one | short |
| GM008 row two | This longer neighbor should wrap when the editor is narrow. |
GM008 after has __bold__, _italic_, escaped \*stars\*, and ``code with ` tick``.

<!-- GUTTER-RENDERED-CASE: GM009 -->
### GM009 — inline links and images
GM009 before: [link](https://example.com "title") and ![image](https://placehold.co/40x20?text=B).
| [GM009] Header | Neighbor |
| --- | --- |
| GM009 row one | short |
| GM009 row two | This longer neighbor should wrap when the editor is narrow. |
GM009 after: [relative](./README.md) and [fragment](#part-4--every-surrounding-markdown-block-family).

<!-- GUTTER-RENDERED-CASE: GM010 -->
### GM010 — autolinks and raw URLs
GM010 before: <https://example.com> <gutter@example.com>.
| [GM010] Header | Neighbor |
| --- | --- |
| GM010 row one | short |
| GM010 row two | This longer neighbor should wrap when the editor is narrow. |
GM010 after: https://example.com/path?query=value#hash and http://localhost:3000/test.

<!-- GUTTER-RENDERED-CASE: GM011 -->
### GM011 — reference links and definitions
GM011 before uses [the reference][gutter-example-ref].
[gutter-before-ref]: https://example.com/before "Before title"
| [GM011] Header | Neighbor |
| --- | --- |
| GM011 row one | short |
| GM011 row two | This longer neighbor should wrap when the editor is narrow. |
GM011 after uses [another reference][gutter-after-ref].
[gutter-after-ref]: https://example.com/after "After title"

<!-- GUTTER-RENDERED-CASE: GM012 -->
### GM012 — single and nested blockquotes
> GM012 quote before.
>
> > Nested quote before.
| [GM012] Header | Neighbor |
| --- | --- |
| GM012 row one | short |
| GM012 row two | This longer neighbor should wrap when the editor is narrow. |
> GM012 quote after.
>
> > Nested quote after.

<!-- GUTTER-RENDERED-CASE: GM013 -->
### GM013 — Obsidian-style callouts
> [!NOTE]
> GM013 note callout before.
| [GM013] Header | Neighbor |
| --- | --- |
| GM013 row one | short |
| GM013 row two | This longer neighbor should wrap when the editor is narrow. |
> [!WARNING]- Collapsed warning after
> GM013 warning body after.

<!-- GUTTER-RENDERED-CASE: GM014 -->
### GM014 — tight unordered lists
- GM014 before item A
- GM014 before item B
  - nested before item
| [GM014] Header | Neighbor |
| --- | --- |
| GM014 row one | short |
| GM014 row two | This longer neighbor should wrap when the editor is narrow. |
- GM014 after item A
- GM014 after item B
  - nested after item

<!-- GUTTER-RENDERED-CASE: GM015 -->
### GM015 — mixed unordered markers
* GM015 asterisk before
+ GM015 plus before
- GM015 hyphen before
| [GM015] Header | Neighbor |
| --- | --- |
| GM015 row one | short |
| GM015 row two | This longer neighbor should wrap when the editor is narrow. |
* GM015 asterisk after
+ GM015 plus after
- GM015 hyphen after

<!-- GUTTER-RENDERED-CASE: GM016 -->
### GM016 — loose unordered lists
- GM016 before first item.

  Continuation paragraph before.

- GM016 before second item.
| [GM016] Header | Neighbor |
| --- | --- |
| GM016 row one | short |
| GM016 row two | This longer neighbor should wrap when the editor is narrow. |
- GM016 after first item.

  Continuation paragraph after.

- GM016 after second item.

<!-- GUTTER-RENDERED-CASE: GM017 -->
### GM017 — ordered and nested lists
1. GM017 first before
2. GM017 second before
   1. nested ordered before
   2. second nested before
| [GM017] Header | Neighbor |
| --- | --- |
| GM017 row one | short |
| GM017 row two | This longer neighbor should wrap when the editor is narrow. |
5. GM017 starts at five after
6. GM017 six after
   1. nested ordered after

<!-- GUTTER-RENDERED-CASE: GM018 -->
### GM018 — task lists
- [x] GM018 completed before
- [ ] GM018 incomplete before
  - [X] nested complete before
| [GM018] Header | Neighbor |
| --- | --- |
| GM018 row one | short |
| GM018 row two | This longer neighbor should wrap when the editor is narrow. |
- [x] GM018 completed after
- [ ] GM018 incomplete after
  - [ ] nested incomplete after

<!-- GUTTER-RENDERED-CASE: GM019 -->
### GM019 — mixed nested lists
1. GM019 ordered before
   - unordered child before
     1. ordered grandchild before
| [GM019] Header | Neighbor |
| --- | --- |
| GM019 row one | short |
| GM019 row two | This longer neighbor should wrap when the editor is narrow. |
- GM019 unordered after
  1. ordered child after
     - unordered grandchild after

<!-- GUTTER-RENDERED-CASE: GM020 -->
### GM020 — definition-list-looking syntax
GM020 Term Before
: GM020 definition before.
| [GM020] Header | Neighbor |
| --- | --- |
| GM020 row one | short |
| GM020 row two | This longer neighbor should wrap when the editor is narrow. |
GM020 Term After
: GM020 definition after.

<!-- GUTTER-RENDERED-CASE: GM021 -->
### GM021 — thematic breaks
GM021 before hyphen rule:
---
GM021 before asterisk rule:
***
GM021 before underscore rule:
___
| [GM021] Header | Neighbor |
| --- | --- |
| GM021 row one | short |
| GM021 row two | This longer neighbor should wrap when the editor is narrow. |
GM021 after hyphen rule:
---
GM021 after asterisk rule:
***
GM021 after underscore rule:
___

<!-- GUTTER-RENDERED-CASE: GM022 -->
### GM022 — backtick fenced code with fake table source
```md
| NEG-GM022-BEFORE | must remain code |
| --- | --- |
| fake | row |
```
| [GM022] Header | Neighbor |
| --- | --- |
| GM022 row one | short |
| GM022 row two | This longer neighbor should wrap when the editor is narrow. |
```md
| NEG-GM022-AFTER | must remain code |
| --- | --- |
| fake | row |
```

<!-- GUTTER-RENDERED-CASE: GM023 -->
### GM023 — tilde fenced code with fake table source
~~~markdown
| NEG-GM023-BEFORE | must remain code |
| --- | --- |
| fake | row |
~~~
| [GM023] Header | Neighbor |
| --- | --- |
| GM023 row one | short |
| GM023 row two | This longer neighbor should wrap when the editor is narrow. |
~~~markdown
| NEG-GM023-AFTER | must remain code |
| --- | --- |
| fake | row |
~~~

<!-- GUTTER-RENDERED-CASE: GM024 -->
### GM024 — four-backtick fences containing triple backticks
````markdown
```
| NEG-GM024-BEFORE | four-backtick fence remains open |
| --- | --- |
```
````
| [GM024] Header | Neighbor |
| --- | --- |
| GM024 row one | short |
| GM024 row two | This longer neighbor should wrap when the editor is narrow. |
````markdown
```
| NEG-GM024-AFTER | four-backtick fence remains open |
| --- | --- |
```
````

<!-- GUTTER-RENDERED-CASE: GM025 -->
### GM025 — indented code blocks
    const before = true;
    | NEG-GM025-BEFORE | indented code |
    | --- | --- |
| [GM025] Header | Neighbor |
| --- | --- |
| GM025 row one | short |
| GM025 row two | This longer neighbor should wrap when the editor is narrow. |
    const after = true;
    | NEG-GM025-AFTER | indented code |
    | --- | --- |

<!-- GUTTER-RENDERED-CASE: GM026 -->
### GM026 — inline HTML and HTML breaks
<span title="before">GM026 inline HTML before</span><br>
GM026 source after the explicit break.
| [GM026] Header | Neighbor |
| --- | --- |
| GM026 row one | short |
| GM026 row two | This longer neighbor should wrap when the editor is narrow. |
<strong>GM026 inline HTML after</strong><br>
GM026 source after the explicit break.

<!-- GUTTER-RENDERED-CASE: GM027 -->
### GM027 — raw HTML block elements
<div class="gutter-before">
<p>GM027 raw HTML block before.</p>
</div>
| [GM027] Header | Neighbor |
| --- | --- |
| GM027 row one | short |
| GM027 row two | This longer neighbor should wrap when the editor is narrow. |
<section class="gutter-after">
<p>GM027 raw HTML block after.</p>
</section>

<!-- GUTTER-RENDERED-CASE: GM028 -->
### GM028 — details and summary blocks
<details>
<summary>GM028 details before</summary>
Body before.
</details>
| [GM028] Header | Neighbor |
| --- | --- |
| GM028 row one | short |
| GM028 row two | This longer neighbor should wrap when the editor is narrow. |
<details>
<summary>GM028 details after</summary>
Body after.
</details>

<!-- GUTTER-RENDERED-CASE: GM029 -->
### GM029 — HTML comments containing fake tables
<!--
| NEG-GM029-BEFORE | comment table |
| --- | --- |
| fake | row |
-->
| [GM029] Header | Neighbor |
| --- | --- |
| GM029 row one | short |
| GM029 row two | This longer neighbor should wrap when the editor is narrow. |
<!--
| NEG-GM029-AFTER | comment table |
| --- | --- |
| fake | row |
-->

<!-- GUTTER-RENDERED-CASE: GM030 -->
### GM030 — inline and display math source
GM030 inline math before: $a^2 + b^2 = c^2$.
$$
\int_0^1 x^2 dx = \frac{1}{3}
$$
| [GM030] Header | Neighbor |
| --- | --- |
| GM030 row one | short |
| GM030 row two | This longer neighbor should wrap when the editor is narrow. |
GM030 inline math after: $e^{i\pi}+1=0$.
$$
\sum_{n=1}^{\infty} \frac{1}{n^2}
$$

<!-- GUTTER-RENDERED-CASE: GM031 -->
### GM031 — footnote references and definitions
GM031 before has a footnote.[^gutter-before]
[^gutter-before]: Footnote definition before.
| [GM031] Header | Neighbor |
| --- | --- |
| GM031 row one | short |
| GM031 row two | This longer neighbor should wrap when the editor is narrow. |
GM031 after has a footnote.[^gutter-after]
[^gutter-after]: Footnote definition after.

    Indented footnote continuation after.

<!-- GUTTER-RENDERED-CASE: GM032 -->
### GM032 — Obsidian wikilinks, embeds, and block IDs
GM032 before: [[Example Note]] [[Example Note|Alias]] ![[diagram.png]].
^gm032-before-block
| [GM032] Header | Neighbor |
| --- | --- |
| GM032 row one | short |
| GM032 row two | This longer neighbor should wrap when the editor is narrow. |
GM032 after: [[Example Note#Heading]] [[Example Note#^block-id]].
^gm032-after-block

<!-- GUTTER-RENDERED-CASE: GM033 -->
### GM033 — escaped Markdown punctuation
\# GM033 not a heading before
\- GM033 not a list before
\> GM033 not a quote before
| [GM033] Header | Neighbor |
| --- | --- |
| GM033 row one | short |
| GM033 row two | This longer neighbor should wrap when the editor is narrow. |
\1. GM033 not an ordered item after
\* GM033 not emphasis after \[not a link\](https://example.com)

<!-- GUTTER-RENDERED-CASE: GM034 -->
### GM034 — Unicode and bidirectional prose
GM034 before: café résumé 中文 日本語 한국어 العربية עברית 😀.
| [GM034] Header | Neighbor |
| --- | --- |
| GM034 row one | short |
| GM034 row two | This longer neighbor should wrap when the editor is narrow. |
GM034 after: English العربية 123 עברית English; é combining mark.

<!-- GUTTER-RENDERED-CASE: GM035 -->
### GM035 — multiple blank-line counts
GM035 prose before three blank source lines.



| [GM035] Header | Neighbor |
| --- | --- |
| GM035 row one | short |
| GM035 row two | This longer neighbor should wrap when the editor is narrow. |




GM035 prose after four blank source lines.

<!-- GUTTER-RENDERED-CASE: GM036 -->
### GM036 — list adjacency without blank lines
- GM036 list item immediately before table
| [GM036] Header | Neighbor |
| --- | --- |
| GM036 row one | short |
| GM036 row two | This longer neighbor should wrap when the editor is narrow. |
- GM036 list item immediately after table

<!-- GUTTER-RENDERED-CASE: GM037 -->
### GM037 — heading adjacency without blank lines
### GM037 heading immediately before table
| [GM037] Header | Neighbor |
| --- | --- |
| GM037 row one | short |
| GM037 row two | This longer neighbor should wrap when the editor is narrow. |
### GM037 heading immediately after table

<!-- GUTTER-RENDERED-CASE: GM038 -->
### GM038 — paragraph adjacency without blank lines
GM038 paragraph immediately before table.
| [GM038] Header | Neighbor |
| --- | --- |
| GM038 row one | short |
| GM038 row two | This longer neighbor should wrap when the editor is narrow. |
GM038 paragraph immediately after table.

<!-- GUTTER-RENDERED-CASE: GM039 -->
### GM039 — link and image definitions as neighboring lines
[gutter-image-ref]: https://placehold.co/40x20?text=Gutter "Gutter image"
| [GM039] Header | Neighbor |
| --- | --- |
| GM039 row one | short |
| GM039 row two | This longer neighbor should wrap when the editor is narrow. |
[gutter-example-ref]: https://example.com "Gutter example"

<!-- GUTTER-RENDERED-CASE: GM040 -->
### GM040 — raw HTML table blocks around a Markdown table
<table><tbody><tr><td>HTML before A</td><td>HTML before B</td></tr></tbody></table>
| [GM040] Header | Neighbor |
| --- | --- |
| GM040 row one | short |
| GM040 row two | This longer neighbor should wrap when the editor is narrow. |
<table><tbody><tr><td>HTML after A</td><td>HTML after B</td></tr></tbody></table>

## Part 5 — Container and ambiguity probes

These cases exercise positions where Markdown container rules and the custom table parser can disagree. Positive `GC` IDs are expected to become live tables. `NEG-` IDs are observation controls and must retain ordinary source gutter rows under the current parser contract.

<!-- GUTTER-RENDERED-CASE: GC001 -->
### GC001 — table immediately after a list item
- GC001 list item directly above the live table
| [GC001] Header | Value |
| --- | --- |
| row | follows a list prelude |
GC001-AFTER: ordinary gutter numbering must resume after the final table row.

<!-- GUTTER-RENDERED-CASE: GC002 -->
### GC002 — two-space-indented table after list prelude
- GC002 parent list item
  | [GC002] Header | Value |
  | --- | --- |
  | row | two source spaces |
GC002-AFTER: ordinary gutter numbering must resume after the final table row.

<!-- GUTTER-RENDERED-CASE: GC003 -->
### GC003 — three-space-indented table
   | [GC003] Header | Value |
   | --- | --- |
   | row | three source spaces |
GC003-AFTER: ordinary gutter numbering must resume after the final table row.

<!-- GUTTER-RENDERED-CASE: GC004 -->
### GC004 — table between HTML container tags
<details>
<summary>GC004 container opens before the live table</summary>
| [GC004] Header | Value |
| --- | --- |
| row | parser-visible inside details source |
GC004-AFTER: ordinary gutter numbering must resume after the final table row.

</details>

### Negative container controls

> | NEG-CONTAINER-BLOCKQUOTE | table-looking source in a blockquote |
> | --- | --- |
> | fake | ordinary gutter rows under the current parser |

- | NEG-CONTAINER-LIST-MARKER | table-looking source with list marker |
    | --- | --- |
    | fake | four-space continuation remains ordinary source |

    | NEG-CONTAINER-FOUR-SPACES | indented code, not a live table |
    | --- | --- |
    | fake | ordinary gutter rows |

	| NEG-CONTAINER-TAB | tab-indented code, not a live table |
	| --- | --- |
	| fake | ordinary gutter rows |

## Part 6 — Non-table negative controls

Each `NEG-` block resembles a table but must not acquire table-owned gutter cells.

### NEG001 — backtick fence
```markdown
| NEG001 | fenced |
| --- | --- |
| fake | table |
```

### NEG002 — tilde fence
~~~markdown
| NEG002 | fenced |
| --- | --- |
| fake | table |
~~~

### NEG003 — mismatched marker does not close fence
````markdown
~~~
| NEG003 | still fenced |
| --- | --- |
| fake | table |
````

### NEG004 — shorter fence does not close longer opener
`````markdown
```
| NEG004 | still fenced |
| --- | --- |
| fake | table |
`````

### NEG005 — HTML comment block
<!--
| NEG005 | comment |
| --- | --- |
| fake | table |
-->

### NEG006 — one-line HTML comment
<!-- | NEG006 | comment-shaped fake table | -->

### NEG007 — four-space indented code
    | NEG007 | indented |
    | --- | --- |
    | fake | table |

### NEG008 — tab-indented code
	| NEG008 | indented |
	| --- | --- |
	| fake | table |

### NEG009 — delimiter has only two hyphens
| NEG009 | invalid delimiter |
| -- | -- |
| fake | body |

### NEG010 — delimiter has no pipe
| NEG010 | header has a pipe |
-------------
| fake | body |

### NEG011 — header and delimiter are separated
| NEG011 | header |

| --- | --- |
| fake | body |

### NEG012 — escaped pipes only
\| NEG012 \| escaped header \|
\| --- \| --- \|
\| fake \| body \|

### NEG013 — ordinary body-like rows without delimiter
| NEG013 | body-looking row |
| another | body-looking row |
| final | body-looking row |

### NEG014 — raw HTML table
<table>
  <thead><tr><th>NEG014 A</th><th>B</th></tr></thead>
  <tbody><tr><td>one</td><td>two</td></tr></tbody>
</table>

### NEG015 — Setext and thematic syntax containing prose pipes
NEG015 prose with an isolated | pipe
---
More NEG015 prose after the Setext-looking underline.

### NEG016 — separator-like text inside inline prose
NEG016 ordinary text: | --- | --- | is not preceded by a table header source line.

## Part 7 — Editing and structural mutation targets

<!-- GUTTER-RENDERED-CASE: GE001 -->
### GE001 — empty cells for fill and clear edits
| [GE001] A | B | C | D |
| --- | --- | --- | --- |
|  |  |  |  |
| keep |  | keep |  |
|  | keep |  | keep |
GE001-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE002 -->
### GE002 — short-to-long wrapping edit target
| [GE002] Key | Editable value |
| --- | --- |
| grow me | short |
| stable sibling | do not move this row number |
GE002-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE003 -->
### GE003 — long-to-short unwrapping edit target
| [GE003] Key | Editable value |
| --- | --- |
| shrink me | This long value should be replaced by a tiny value during the edit pass, then restored with undo and redo while the gutter row changes height without losing its source identity. |
| stable sibling | short |
GE003-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE004 -->
### GE004 — row insertion and deletion target
| [GE004] Row | Value |
| --- | --- |
| top | insert above me |
| middle | insert above and below me |
| bottom | append after me |
GE004-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE005 -->
### GE005 — column insertion and deletion target
| [GE005] A | B | C |
| --- | --- | --- |
| a1 | b1 | c1 |
| a2 | b2 | c2 |
GE005-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE006 -->
### GE006 — leading and trailing pipe conversion target
[GE006] A | B | C
--- | --- | ---
one | two | three
GE006-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE007 -->
### GE007 — delimiter invalidation and restoration target
Change one delimiter cell from `---` to `--`; the widget should disappear cleanly. Restoring it must create exactly one correctly numbered widget.
| [GE007] A | B |
| --- | --- |
| one | two |
GE007-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE008 -->
### GE008 — multiline paste and undo target
| [GE008] Destination | Neighbor |
| --- | --- |
| paste here | stable |
| lower row | stable |
GE008-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE009 -->
### GE009 — same-shape table A for DOM identity checks
| [GE009] A | B |
| --- | --- |
| first | same 2x2 shape |
GE009-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE010 -->
### GE010 — same-shape table B must keep its own source numbers
Edit GE009, then GE010, then insert prose above both. A reused widget must never keep the other table's gutter number.
| [GE010] A | B |
| --- | --- |
| second | same 2x2 shape |
GE010-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE011 -->
### GE011 — selection across tall and short rows
| [GE011] Row | Content |
| --- | --- |
| short | x |
| tall | one<br>two<br>three<br>four<br>five<br>six |
| short again | y |
GE011-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GE012 -->
### GE012 — horizontal scroll plus cell edit
| [GE012] C01 | C02 | C03 | C04 | C05 | C06 | C07 | C08 | C09 | C10 | C11 | C12 | C13 | C14 | C15 | C16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edit-01-abcdefghijklmnopqrstuvwxyz | edit-02-abcdefghijklmnopqrstuvwxyz | edit-03-abcdefghijklmnopqrstuvwxyz | edit-04-abcdefghijklmnopqrstuvwxyz | edit-05-abcdefghijklmnopqrstuvwxyz | edit-06-abcdefghijklmnopqrstuvwxyz | edit-07-abcdefghijklmnopqrstuvwxyz | edit-08-abcdefghijklmnopqrstuvwxyz | edit-09-abcdefghijklmnopqrstuvwxyz | edit-10-abcdefghijklmnopqrstuvwxyz | edit-11-abcdefghijklmnopqrstuvwxyz | edit-12-abcdefghijklmnopqrstuvwxyz | edit-13-abcdefghijklmnopqrstuvwxyz | edit-14-abcdefghijklmnopqrstuvwxyz | edit-15-abcdefghijklmnopqrstuvwxyz | edit-16-abcdefghijklmnopqrstuvwxyz |
GE012-AFTER: numbering must resume on this prose line after the table mutation target.

### Whole-document mutation sequence

1. Insert ten prose lines at the very top and verify every `GB`, `GS`, `GM`, `GC`, `GE`, and `GV` table renumbers once.
2. Undo the insertion and verify no stale four-digit table gutter remains.
3. Move the EOF table to source line 1 temporarily; verify the first table gutter is not clipped by the editor top padding.
4. Move it back to EOF, save, close, reopen, and repeat with CRLF.
5. Use Replace All to change `stable` to a longer phrase while GE008 and nearby tables are off screen.
6. Jump back to GE008; off-screen updates must have produced current, not cached, source numbers.

## Part 8 — Second calibrated deep-scroll table and virtualization ramp

The next padding lines deliberately mix short, long, Unicode, and numeric content. Resize during a fast scrollbar drag and watch for native gutter gaps before the next table.

DEEP-RAMP-1831: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1832: short.
DEEP-RAMP-1833: medium width 0123456789.
DEEP-RAMP-1834: Unicode café 中文 العربية 😀.
DEEP-RAMP-1835: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1836: short.
DEEP-RAMP-1837: medium width 0123456789.
DEEP-RAMP-1838: Unicode café 中文 العربية 😀.
DEEP-RAMP-1839: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1840: short.
DEEP-RAMP-1841: medium width 0123456789.
DEEP-RAMP-1842: Unicode café 中文 العربية 😀.
DEEP-RAMP-1843: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1844: short.
DEEP-RAMP-1845: medium width 0123456789.
DEEP-RAMP-1846: Unicode café 中文 العربية 😀.
DEEP-RAMP-1847: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1848: short.
DEEP-RAMP-1849: medium width 0123456789.
DEEP-RAMP-1850: Unicode café 中文 العربية 😀.
DEEP-RAMP-1851: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1852: short.
DEEP-RAMP-1853: medium width 0123456789.
DEEP-RAMP-1854: Unicode café 中文 العربية 😀.
DEEP-RAMP-1855: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1856: short.
DEEP-RAMP-1857: medium width 0123456789.
DEEP-RAMP-1858: Unicode café 中文 العربية 😀.
DEEP-RAMP-1859: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1860: short.
DEEP-RAMP-1861: medium width 0123456789.
DEEP-RAMP-1862: Unicode café 中文 العربية 😀.
DEEP-RAMP-1863: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1864: short.
DEEP-RAMP-1865: medium width 0123456789.
DEEP-RAMP-1866: Unicode café 中文 العربية 😀.
DEEP-RAMP-1867: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1868: short.
DEEP-RAMP-1869: medium width 0123456789.
DEEP-RAMP-1870: Unicode café 中文 العربية 😀.
DEEP-RAMP-1871: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1872: short.
DEEP-RAMP-1873: medium width 0123456789.
DEEP-RAMP-1874: Unicode café 中文 العربية 😀.
DEEP-RAMP-1875: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1876: short.
DEEP-RAMP-1877: medium width 0123456789.
DEEP-RAMP-1878: Unicode café 中文 العربية 😀.
DEEP-RAMP-1879: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1880: short.
DEEP-RAMP-1881: medium width 0123456789.
DEEP-RAMP-1882: Unicode café 中文 العربية 😀.
DEEP-RAMP-1883: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1884: short.
DEEP-RAMP-1885: medium width 0123456789.
DEEP-RAMP-1886: Unicode café 中文 العربية 😀.
DEEP-RAMP-1887: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1888: short.
DEEP-RAMP-1889: medium width 0123456789.
DEEP-RAMP-1890: Unicode café 中文 العربية 😀.
DEEP-RAMP-1891: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1892: short.
DEEP-RAMP-1893: medium width 0123456789.
DEEP-RAMP-1894: Unicode café 中文 العربية 😀.
DEEP-RAMP-1895: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1896: short.
DEEP-RAMP-1897: medium width 0123456789.
DEEP-RAMP-1898: Unicode café 中文 العربية 😀.
DEEP-RAMP-1899: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1900: short.
DEEP-RAMP-1901: medium width 0123456789.
DEEP-RAMP-1902: Unicode café 中文 العربية 😀.
DEEP-RAMP-1903: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1904: short.
DEEP-RAMP-1905: medium width 0123456789.
DEEP-RAMP-1906: Unicode café 中文 العربية 😀.
DEEP-RAMP-1907: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1908: short.
DEEP-RAMP-1909: medium width 0123456789.
DEEP-RAMP-1910: Unicode café 中文 العربية 😀.
DEEP-RAMP-1911: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1912: short.
DEEP-RAMP-1913: medium width 0123456789.
DEEP-RAMP-1914: Unicode café 中文 العربية 😀.
DEEP-RAMP-1915: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1916: short.
DEEP-RAMP-1917: medium width 0123456789.
DEEP-RAMP-1918: Unicode café 中文 العربية 😀.
DEEP-RAMP-1919: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1920: short.
DEEP-RAMP-1921: medium width 0123456789.
DEEP-RAMP-1922: Unicode café 中文 العربية 😀.
DEEP-RAMP-1923: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1924: short.
DEEP-RAMP-1925: medium width 0123456789.
DEEP-RAMP-1926: Unicode café 中文 العربية 😀.
DEEP-RAMP-1927: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1928: short.
DEEP-RAMP-1929: medium width 0123456789.
DEEP-RAMP-1930: Unicode café 中文 العربية 😀.
DEEP-RAMP-1931: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1932: short.
DEEP-RAMP-1933: medium width 0123456789.
DEEP-RAMP-1934: Unicode café 中文 العربية 😀.
DEEP-RAMP-1935: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1936: short.
DEEP-RAMP-1937: medium width 0123456789.
DEEP-RAMP-1938: Unicode café 中文 العربية 😀.
DEEP-RAMP-1939: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1940: short.
DEEP-RAMP-1941: medium width 0123456789.
DEEP-RAMP-1942: Unicode café 中文 العربية 😀.
DEEP-RAMP-1943: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1944: short.
DEEP-RAMP-1945: medium width 0123456789.
DEEP-RAMP-1946: Unicode café 中文 العربية 😀.
DEEP-RAMP-1947: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1948: short.
DEEP-RAMP-1949: medium width 0123456789.
DEEP-RAMP-1950: Unicode café 中文 العربية 😀.
DEEP-RAMP-1951: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1952: short.
DEEP-RAMP-1953: medium width 0123456789.
DEEP-RAMP-1954: Unicode café 中文 العربية 😀.
DEEP-RAMP-1955: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1956: short.
DEEP-RAMP-1957: medium width 0123456789.
DEEP-RAMP-1958: Unicode café 中文 العربية 😀.
DEEP-RAMP-1959: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1960: short.
DEEP-RAMP-1961: medium width 0123456789.
DEEP-RAMP-1962: Unicode café 中文 العربية 😀.
DEEP-RAMP-1963: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1964: short.
DEEP-RAMP-1965: medium width 0123456789.
DEEP-RAMP-1966: Unicode café 中文 العربية 😀.
DEEP-RAMP-1967: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1968: short.
DEEP-RAMP-1969: medium width 0123456789.
DEEP-RAMP-1970: Unicode café 中文 العربية 😀.
DEEP-RAMP-1971: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1972: short.
DEEP-RAMP-1973: medium width 0123456789.
DEEP-RAMP-1974: Unicode café 中文 العربية 😀.
DEEP-RAMP-1975: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1976: short.
DEEP-RAMP-1977: medium width 0123456789.
DEEP-RAMP-1978: Unicode café 中文 العربية 😀.
DEEP-RAMP-1979: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1980: short.
DEEP-RAMP-1981: medium width 0123456789.
DEEP-RAMP-1982: Unicode café 中文 العربية 😀.
DEEP-RAMP-1983: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1984: short.
DEEP-RAMP-1985: medium width 0123456789.
DEEP-RAMP-1986: Unicode café 中文 العربية 😀.
DEEP-RAMP-1987: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1988: short.
DEEP-RAMP-1989: medium width 0123456789.
DEEP-RAMP-1990: Unicode café 中文 العربية 😀.
DEEP-RAMP-1991: long ordinary text that wraps at narrow widths while retaining exactly one native source-line gutter entry.
DEEP-RAMP-1992: short.
DEEP-RAMP-1993: medium width 0123456789.
| [GB1995] Row | Boundary role |
| ---: | --- |
| 1 | source line 1997 |
| 2 | source line 1998 |
| 3 | source line 1999 |
| 4 | source line 2000 |
| 5 | source line 2001 |
GB1995-AFTER: adjacent prose after the second calibrated table.

<!-- GUTTER-RENDERED-CASE: GV001 -->
### GV001 — deep-scroll narrow table
| [GV001] Deep | Value |
| --- | --- |
| row one | reached after a large scroll jump |
| row two | resize here |
GV001-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GV002 -->
### GV002 — deep-scroll very wide table
Jump here from the top, scroll fully right, then jump back to GB099. No stale table gutter number may survive either jump.
| [GV002] C01 | C02 | C03 | C04 | C05 | C06 | C07 | C08 | C09 | C10 | C11 | C12 | C13 | C14 | C15 | C16 | C17 | C18 | C19 | C20 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deep-1-abcdefghijklmnopqrstuvwxyz | deep-2-abcdefghijklmnopqrstuvwxyz | deep-3-abcdefghijklmnopqrstuvwxyz | deep-4-abcdefghijklmnopqrstuvwxyz | deep-5-abcdefghijklmnopqrstuvwxyz | deep-6-abcdefghijklmnopqrstuvwxyz | deep-7-abcdefghijklmnopqrstuvwxyz | deep-8-abcdefghijklmnopqrstuvwxyz | deep-9-abcdefghijklmnopqrstuvwxyz | deep-10-abcdefghijklmnopqrstuvwxyz | deep-11-abcdefghijklmnopqrstuvwxyz | deep-12-abcdefghijklmnopqrstuvwxyz | deep-13-abcdefghijklmnopqrstuvwxyz | deep-14-abcdefghijklmnopqrstuvwxyz | deep-15-abcdefghijklmnopqrstuvwxyz | deep-16-abcdefghijklmnopqrstuvwxyz | deep-17-abcdefghijklmnopqrstuvwxyz | deep-18-abcdefghijklmnopqrstuvwxyz | deep-19-abcdefghijklmnopqrstuvwxyz | deep-20-abcdefghijklmnopqrstuvwxyz |
GV002-AFTER: numbering must resume on this prose line after the table mutation target.

<!-- GUTTER-RENDERED-CASE: GV003 -->
### GV003 — rapid shape switching
Delete a row, add two columns, undo all edits, then page to the top and back.
| [GV003] A | B | C |
| --- | --- | --- |
| one | two | three |
| four | five | six |
| seven | eight | nine |
GV003-AFTER: numbering must resume on this prose line after the table mutation target.

## Part 9 — End-of-file boundary

The final live table has no prose or blank source line after its final body row. Add a new line at EOF, remove it, undo, redo, and verify the final gutter number never clips at the bottom of the scroll range.
<!-- GUTTER-RENDERED-CASE: GF999 -->
| [GF999] EOF header | Value |
| --- | --- |
| final body row | This is the final content line in the fixture. |
