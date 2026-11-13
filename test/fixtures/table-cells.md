# Table cell fixture

Test input for table rendering and for moving the caret between cells. Every row starts with
an identifier, and checks find rows by identifier, never by line number. The third column is
the cell under test; the fourth says what a correct renderer shows.

Contract:

- TC-NAV-01 and TC-NAV-02 are adjacent, in that order. Arrow Down from the end of the deeply
  nested list in TC-NAV-01 must land after the 35th character of TC-NAV-02, just before its
  bold text. Their cell text must not change.
- Every table has four columns, so the cell under test is always column index 2.

## Inline content

| ID | Case | Cell under test | Expected |
| --- | --- | --- | --- |
| TC-IN-01 | Plain text | Plain text | Unformatted text |
| TC-IN-02 | Emphasis | **bold**, *italic*, ***both***, ~~strike~~ | Four styles, markers hidden at rest |
| TC-IN-03 | Inline code | `inline code` and `a \| b` | Code styling; the escaped pipe is one character |
| TC-IN-04 | Link | [label](https://example.com) and <https://example.com> | Two links |
| TC-IN-05 | Escaped pipe | left \| right | One cell containing a pipe |
| TC-IN-06 | Entities | &amp; &lt; &gt; &copy; &#124; | Five characters |
| TC-IN-07 | Escapes | \*literal\* and \_literal\_ | Literal punctuation, no emphasis |
| TC-IN-08 | Empty cell |  | An empty, editable cell |
| TC-IN-09 | Spaces only |     | An empty, editable cell |

## Multi-line content

| ID | Case | Cell under test | Expected |
| --- | --- | --- | --- |
| TC-ML-01 | Line break | first line<br>second line | Two lines in one cell |
| TC-ML-02 | HTML list | <ul><li>one</li><li>two</li></ul> | A two-item list |
| TC-ML-03 | Unbreakable token | abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz | Wraps or scrolls without widening the page |

## Caret navigation

| ID | Case | Cell under test | Expected |
| --- | --- | --- | --- |
| TC-NAV-00 | Row above | Characters: &amp; &lt; &gt; " ' ` ~ * _ [ ] ( ) { } . ! + - # &#124; | Special characters shown without breaking the table |
| TC-NAV-01 | Deep nesting | <ul><li>Level 1<ul><li>Level 2<ul><li>Level 3<ul><li>Level 4<ul><li>Level 5<ul><li>Level 6</li></ul></li></ul></li></ul></li></ul></li></ul></li></ul> | Six visibly indented levels |
| TC-NAV-02 | Long wrapping | This is a very long table cell with **bold text**, `inline code`, a [link](https://example.com), and a long token: abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz. | Wraps across several visual lines |
| TC-NAV-03 | Row below |  | An empty cell after a tall row |

## Table shapes

Column alignment:

| ID | Left | Center | Right |
| :--- | :--- | :---: | ---: |
| TC-SH-01 | a | b | c |
| TC-SH-02 | longer text | mid | 100 |

A row with fewer cells than the header:

| ID | Case | Cell under test | Expected |
| --- | --- | --- | --- |
| TC-SH-03 | Short row |

Two tables separated by one blank line:

| ID | Case | Cell under test | Expected |
| --- | --- | --- | --- |
| TC-SH-04 | First table | above | Stays a separate table |

| ID | Case | Cell under test | Expected |
| --- | --- | --- | --- |
| TC-SH-05 | Second table | below | Stays a separate table |
