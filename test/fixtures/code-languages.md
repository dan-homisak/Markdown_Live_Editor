# Code language fixture

Test input for the code-highlighting host check, which compares the color of every character in
each fenced block below between the stock editor and the live editor.

Contract:

- Nine fenced blocks, in this order: js, ts, html, css, json, sh, python, md, diff.
- The first block is JavaScript and starts with a line comment, because the check types a
  comment at its first character to prove that an edit is recolored.
- Every block mixes the token kinds a theme colors differently: comments, keywords, strings,
  numbers, names and punctuation.
- The block marked txt is excluded by the check and must stay uncolored.

## CL-01 js

```js
// CL-01: comment, keyword, string, template, number, boolean, call.
const rows = [
  { name: "Alpha", count: 3, enabled: true },
  { name: "Beta", count: 12, enabled: false },
];

for (const row of rows) {
  console.log(`${row.name}: ${row.count * 2}`);
}
```

## CL-02 ts

```ts
// CL-02: type alias, annotation, generic, optional member, return type.
type TableRow = {
  id: string;
  label: string;
  width?: number;
};

function renderLabel<T extends TableRow>(row: T, fallback = "none"): string {
  return row.width && row.width > 40 ? row.label : `${fallback}: ${row.id}`;
}
```

## CL-03 html

```html
<!-- CL-03: comment, tag, attribute, string, entity, text. -->
<table class="grid" data-rows="2">
  <tr>
    <th scope="col">Name</th>
    <td>Alpha &amp; Beta</td>
  </tr>
</table>
```

## CL-04 css

```css
/* CL-04: comment, selector, property, unit, color, function. */
.grid th,
.grid td {
  border: 1px solid #cccccc;
  padding: 0.5rem;
  width: calc(100% - 2px);
}
```

## CL-05 json

```json
{
  "name": "code-language-fixture",
  "cases": ["string", "number", "boolean", "null"],
  "count": 9,
  "enabled": true,
  "parent": null
}
```

## CL-06 sh

```sh
# CL-06: comment, command, option, string, variable.
count=3
echo "rows: $count"
ls -la ./fixtures | grep "md"
```

## CL-07 python

```python
# CL-07: comment, keyword, string, f-string, number, builtin, call.
rows = ["alpha", "beta", "gamma"]

for index, row in enumerate(rows, start=1):
    print(f"{index}: {row.upper()}")
```

## CL-08 md

```md
# CL-08 heading

| Column A | Column B |
|---|---|
| `code` | **bold** |
```

## CL-09 diff

```diff
--- a/before.md
+++ b/after.md
@@ -1,2 +1,2 @@
- old line
+ new line
```

## CL-10 txt

```txt
CL-10: plain text. Not compared, never colored.
```
