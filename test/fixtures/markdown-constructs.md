---
title: Markdown constructs
tags:
  - fixture
  - constructs
---

# Markdown constructs

Test input: one section per Markdown construct the live preview classifies. Every case starts
with an identifier (the letters MC, a construct code and a number), and checks find cases by
identifier or by section heading, never by line number. This paragraph is ordinary prose that
is long enough to wrap in a narrow window.

[TOC]

## Headings

# MC-HD-01 Heading level 1

## MC-HD-02 Heading level 2

### MC-HD-03 Heading level 3

#### MC-HD-04 Heading level 4

##### MC-HD-05 Heading level 5

###### MC-HD-06 Heading level 6

MC-HD-07 Setext level 1
=======================

MC-HD-08 Setext level 2
-----------------------

## MC-HD-09 Closing markers ##

## Paragraphs

MC-PA-01 A paragraph is one or more lines of text.
A single newline stays inside the same paragraph.

MC-PA-02 A line ending in two spaces  
breaks here, and a line ending in a backslash\
breaks here.

## Emphasis

MC-EM-01 *italic with asterisks* and _italic with underscores_.

MC-EM-02 **bold with asterisks** and __bold with underscores__.

MC-EM-03 ***bold and italic*** and ~~strikethrough~~.

MC-EM-04 **bold with *nested italic* inside** and *italic with **nested bold** inside*.

MC-EM-05 snake_case_name and 2*3*4 stay literal, and so does an unmatched *asterisk.

## Inline Code

MC-IC-01 `inline code` in a paragraph.

MC-IC-02 ``code with a ` backtick`` and `  padded  ` code.

MC-IC-03 `**not bold**` and `&amp;` stay literal inside code.

## Links

MC-LK-01 [inline link](https://example.com) and [link with title](https://example.com "Title").

MC-LK-02 [reference link][mc-ref] and a collapsed [mc-ref][] reference.

MC-LK-03 Autolinks <https://example.com> and <test@example.com>.

MC-LK-04 [relative file](./other.md) and [heading link](./other.md#section).

MC-LK-05 [[Note]] and [[Note|Alias]] and [[Note#Heading]] wikilinks.

MC-LK-06 [missing reference] stays literal.

[mc-ref]: https://example.com/reference

## Images

MC-IM-01 ![alt text](image.png) is not fetched.

MC-IM-02 ![[Embedded note]] is not embedded.

## Blockquotes

> MC-BQ-01 A one-line quote.

> MC-BQ-02 A quote of two lines
> that belong to one paragraph.

> MC-BQ-03 Level one
> > Level two
> > > Level three

> MC-BQ-04 A quote with a list:
>
> - first item
> - second item

## Callouts

> [!NOTE]
> MC-CO-01 A note without a title.

> [!TIP] MC-CO-02 A custom title
> Body of the tip with **bold** text.

> [!WARNING]- MC-CO-03 Folded by default
> Hidden until the callout is expanded.

> [!IMPORTANT]+ MC-CO-04 Expanded by default
> Visible until the callout is folded.

> [!caution]
> MC-CO-05 Type names are matched without regard to case.

> [!info]
> MC-CO-06 An alias that renders as a note.

## Lists

- MC-LI-01 Bullet parent
  - Bullet child
    - Bullet grandchild
- MC-LI-02 Second bullet

5. MC-LI-03 Ordered list starting at five
1. Second ordered item
   1. Ordered child
   1. Second ordered child
1. Third ordered item

- MC-LI-04 Mixed parent
  1. Ordered child
     - Bullet grandchild

- MC-LI-05 Item with a second paragraph

  A continuation paragraph inside the item.

## Task Lists

- [ ] MC-TK-01 Open task
- [x] MC-TK-02 Completed task
  - [ ] MC-TK-03 Nested open task
  - [X] MC-TK-04 Nested task completed with a capital letter

## Tables

MC-TB-01 A minimal table:

| Key | Value |
| --- | --- |
| alpha | 1 |
| beta | 2 |

MC-TB-02 Column alignment:

| Left | Center | Right |
| :--- | :---: | ---: |
| a | b | c |
| longer text | mid | 100 |

MC-TB-03 Formatting, an escaped pipe and an empty cell:

| Case | Cell |
| --- | --- |
| formatting | **bold**, *italic*, `code`, [link](https://example.com) |
| escaped pipe | left \| right |
| empty |  |

## Code Blocks

MC-CB-01 A fence without a language:

```
No language identifier.
  Leading spaces are preserved.
```

MC-CB-02 A fence with a language:

```js
const answer = 42; // a comment
```

MC-CB-03 A tilde fence:

~~~
Fenced with tildes.
~~~

MC-CB-04 A longer fence that contains a shorter one:

````md
```js
const nested = true;
```
````

MC-CB-05 An indented code block:

    Indented by four spaces.
    Second indented row.

MC-CB-06 A fence inside a list item:

- Item with code

  ```sh
  echo "inside a list"
  ```

## Horizontal Rules

MC-HR-01 Three hyphens:

---

MC-HR-02 Three asterisks:

***

MC-HR-03 Three underscores:

___

## Escapes And Entities

MC-ES-01 \*not italic\*, \_not italic\_, \# not a heading, \[not a link\].

MC-ES-02 Named and numeric entities: &amp; &lt; &gt; &copy; &#39; &#x1f600;.

MC-ES-03 An unknown entity stays literal: &bogus;.

## HTML

MC-HT-01 Inline <span>HTML</span> is shown as written.

<div>
MC-HT-02 A block of HTML is shown as written.
</div>

<!-- MC-HT-03 A comment is shown as written. -->

MC-HT-04 <script>window.neverRuns = true;</script> is never executed.

## Math

MC-MA-01 Inline math $a^2 + b^2 = c^2$ stays source.

## Footnotes

MC-FN-01 A first reference[^one] and a second reference[^two] in one paragraph.

[^one]: MC-FN-02 The first note.

[^two]: MC-FN-03 The second note.

    Indented continuation text belongs to the second note.

## End

MC-END-01 The final paragraph of the document.
