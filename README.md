# Markdown Live Editor

Edit Markdown in VS Code the way you read it. Formatting syntax steps out of the way while you
read and comes back the moment your caret enters it, and tables become a small spreadsheet you
can type into, select and paste across. Your file stays plain Markdown the whole time.

![The live editor showing properties, formatted text, lists, tasks, callouts, a code block and a table](docs/images/live-preview.png)

- **Live preview.** Headings, emphasis, links, lists, tasks, quotes, callouts, code blocks and
  YAML properties render in place. Move the caret into any of them to edit the exact source.
- **Real table editing.** Click a cell and type. Move with Tab, Enter and the arrow keys, select
  ranges, insert and delete rows and columns, and copy to and from spreadsheets.
- **Nothing proprietary.** Every edit is written straight to the `.md` file through VS Code's own
  document and Undo history. Switch back to the standard editor at any time.
- **Feels like VS Code.** Your font, theme, line numbers and selection colors carry over.

## Contents

- [Getting started](#getting-started)
- [Live preview](#live-preview)
- [Tables](#tables)
- [Copy and paste](#copy-and-paste)
- [Settings](#settings)
- [Commands](#commands)
- [Limitations](#limitations)
- [Privacy and safety](#privacy-and-safety)
- [Building from source](#building-from-source)

## Getting started

Requires VS Code 1.101 or later.

1. Install the extension from a `.vsix` package: in the Extensions view choose
   **Install from VSIX…**, or run `code --install-extension <file>.vsix`. To build the package
   yourself, see [Building from source](#building-from-source).
2. Open a `.md` or `.markdown` file.
3. Select the eye icon in the editor title bar, or press `Ctrl+Alt+M` (`Cmd+Ctrl+M` on macOS).

The same button and shortcut switch back to VS Code's standard editor. Your scroll position and
caret travel with you. To change the shortcut, open **Keyboard Shortcuts** and search for
**Markdown Live Editor: Toggle Markdown Live Editor**.

The sample documents in [`samples/`](samples/) are a quick way to try everything.

## Live preview

At rest the document reads as formatted text. Put the caret inside a construct, or select across
it, and its exact Markdown appears for editing; move away and it renders again. Nothing about
this changes the file: opening, scrolling, selecting and folding never mark a document as edited.

| Markdown | At rest | While editing |
| --- | --- | --- |
| Headings | Colored by level, at the editor's text size. `#` markers stay visible by default | Markers always editable; a setting hides them at rest |
| Bold, italic, strikethrough | Styled text, markers hidden | Markers shown for the construct under the caret |
| Inline code | Code styling, backticks hidden | Backticks shown |
| Links and wikilinks | The label only; `[[Note\|Alias]]` shows the alias | The full link source |
| Lists | Bullets or numbers with indent guides | Markers editable in place |
| Tasks | A checkbox; completed items are struck through | The `[ ]` or `[x]` source |
| Quotes | An inset guide for every nesting level | The `>` prefix on the active row |
| Callouts | Icon, title and tint; `+` and `-` make them foldable | The `> [!TYPE]` header |
| Fenced code | Highlighted code with the language shown in the corner | Both fence lines |
| YAML front matter | Syntax-colored properties in a frame | Edited in place as YAML |
| `[TOC]` | A linked list of the document's headings | The marker |
| Footnotes | Numbered references linked to their definitions | The `[^label]` source |
| Tables | A rendered, editable grid | See [Tables](#tables) |

Horizontal rules, escaped characters and character entities render as well. HTML is shown as
written, and images and embedded notes keep their source text.

Line numbers are never part of a selection. A click on a line number puts the caret at the start
of that line, and a drag that starts there selects the document's text from that line on.

### Formatting a selection

Select text and type a formatting character. The selection is kept, so pressing the key again
extends the markers.

| Type | Result |
| --- | --- |
| `*` or `_` | Italic, then bold, then bold italic |
| `` ` `` | Inline code, then double backticks, then a fenced code block |
| `[` | `[text]()`, then `[[text]]` |
| `!` | `![text]()`; on a link or wikilink, turns it into an image or embed |
| `~`, `=`, `$`, `^` | Surrounds the text; repeat for `~~strikethrough~~` or `==highlight==` |
| `(`, `{`, `<`, `'`, `"` | Surrounds the text with the matching pair |

This works inside table cells too, where backticks stay inline. Highlight, math and superscript
markers are inserted as source; whether they render depends on the viewer you publish with.
Typing without a selection behaves as usual.

### Lists and tasks

- `Enter` continues a bullet, a numbered item or an unchecked task. On an empty item it outdents,
  or leaves the list at the top level.
- `Tab` and `Shift+Tab` (or `Ctrl+]` and `Ctrl+[`, `Cmd` on macOS) nest and unnest an item
  together with its children.
- `Backspace` at the start of an item's text outdents it, or removes the marker at the top level.
- `Home` goes to the start of the item's text first, then to the start of the line. Up and Down
  follow the rendered rows and keep the caret out of the indentation.
- Click a checkbox to toggle a task. That is one edit and one Undo step. From the keyboard, use
  **Toggle Task Checkbox at Caret**, or **Focus Task Checkbox at Caret** and then `Space`.
- A click beside a checkbox puts the caret at the start of the task's text. To edit the
  `- [x]` source, move the caret into it with the Left arrow.

Numbered lists display consecutive numbers starting from the first number in the source;
editing a number shows it as written.

### Links

Click a rendered link to open it. While the caret is inside a link you are editing it, so a
plain click keeps editing: use `Ctrl+click` (`Cmd+click` on macOS; `Alt+click` if
`editor.multiCursorModifier` is `ctrlCmd`), or run **Open Markdown Link at Caret**.

Web addresses and `mailto:` links open in your browser or mail client. File links, reference
links and wikilinks open in VS Code at the heading or `^block` they point to. A wikilink is
looked up next to the current file first, then in the workspace; if several notes match, you
are asked which one. Missing notes are reported, never created.

### Code blocks

Code is colored with VS Code's own language grammars and your color theme, so a block looks the
way it does in the standard editor. Where those are unavailable, built-in grammars cover
JavaScript, TypeScript, JSON, shell, Python and YAML; other languages are shown as plain code.

The language name sits in the corner of each block. Hover over it, or focus it with the
keyboard, and it becomes **Copy**, which copies the code without its fences.

### Properties

YAML front matter at the top of a file is shown as colored source inside a frame.

- Type `---` on the first line to create a properties block.
- On an empty row, suggestions offer common keys such as `tags` and `aliases`. Use Up, Down and
  `Enter` to pick one, `Escape` to dismiss, `Ctrl+Space` to bring them back. Any name works: type
  it followed by `:`.
- `Enter` continues a list; an empty item ends it. `Tab` and `Shift+Tab` indent by two spaces.
- Invalid YAML, including duplicate keys, is underlined with an explanation on hover.
- When you leave the block after editing, valid YAML is tidied to two-space indentation with
  values, comments and quoting preserved. A file is never reformatted just by opening it.

### Callouts

A quote that starts with `> [!NOTE]` becomes a callout. Types are matched without regard to
case and include `note`, `tip`, `important`, `warning` and `caution`, plus the usual aliases
such as `info`, `todo`, `success`, `question`, `danger` and `bug`. Text after the type becomes
the title. Add `+` or `-` after the brackets to make the callout foldable; folding changes only
what you see, never the file.

## Tables

Click a cell to edit its Markdown. When you leave the cell it renders again, including emphasis,
code and links.

Columns size themselves to their text and follow it as you type. If that movement distracts,
set a [typing resize delay](#settings): the columns then keep their widths while you type, the
text wraps inside its cell, and the table resizes once you pause or move to another cell.

### Moving around

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Next or previous cell |
| `Enter` | Down one row; leaves the table after the last row |
| `Shift+Enter` | Line break inside the cell |
| Arrow keys | Move through text; cross into the next cell at a cell's edge |
| `F2` + arrow key | Jump straight to the neighboring cell (the key is [configurable](#settings)) |
| `Escape` | Select the current cell |

Wide tables scroll sideways on their own, with the mouse wheel, `Shift`+wheel or the scrollbar.

### Selecting

- With a cell selected, arrow keys move the selection and `Shift`+arrow extends it.
- Drag across cells, or `Shift`+click, to select a range.
- Click a row or column handle to select the whole row or column.
- `Ctrl`+click (`Cmd` on macOS) adds or removes cells, rows and columns from the selection.

### Rows, columns and tables

| Action | How |
| --- | --- |
| Insert a row below or above | `Ctrl+Enter`, `Ctrl+Shift+Enter` |
| Insert a column right or left | `Alt+Enter`, `Alt+Shift+Enter` |
| Clear the selected cells | `Backspace` |
| Clear, then remove, selected rows or columns | `Delete`, pressed again once they are empty |
| Insert, select or delete from a menu | Right-click a cell or handle |
| Add a table | Right-click a line of text and choose **Insert table (2 × 2)** |
| Join two tables | Delete the blank line between two tables with the same number of columns |
| Remove a table | Right-click and choose **Delete table**; **Clear table** keeps its shape |

`Backspace` never changes a table's shape. `Delete` on a partial range only clears it. Inserting
a row above the header makes a new blank header and turns the old one into the first body row.
When two tables are joined, the second table's header becomes an ordinary row. Tables with
different column counts are not joined; you are told the two counts instead.

**Undo** and **Redo** are in the editor title bar and on their usual shortcuts. They use
VS Code's own history for the file, so they work the same in both editors.

### Your document is protected

Each table edit is checked against the document at the moment it is applied and must land
exactly on the cell or table it was made for. If the file changed underneath, for example from
another program, the edit is refused, the table reloads from the file, and a status message
says why. Text outside the table is never touched.

## Copy and paste

Copy and paste work across Markdown editors, spreadsheets and word processors. The right-click
menu offers every format; **Copy** and **Paste** on the keyboard use your defaults.

| Copy as | Use it for |
| --- | --- |
| Smart (default) | Spreadsheets: lists stay inside their cells |
| Rich | Word processors: nested lists stay real lists |
| Plain Text | Anywhere formatting is unwanted |
| Markdown | Other Markdown tools |

Paste is automatic by default. It prefers the editor's own lossless data, then rich content,
then Markdown, then plain text, and can be forced to one of them from the menu. A paste larger
than the selection grows the table instead of spilling out of it. Pasted text keeps
fill-in blanks such as `____` and identifiers such as `snake_case` as written.

Rich content is converted to Markdown, with `#` headings and one space after a list marker.
Automatic paste takes the plain text unchanged instead in two cases, where converting would only
damage it:

- The text was copied in a code editor, VS Code's own included: the rich version is the same
  text with colors.
- The plain text is already Markdown and the rich version is a rendering of it, as Markdown
  editors and chat assistants copy. The plain text must contain all of the rendered text and
  write its headings, lists, tables, links and emphasis in Markdown syntax.

**Paste Rich** always converts.

## Settings

All settings start with `markdownLiveRenderTables.`.

| Setting | Default | What it does |
| --- | --- | --- |
| `markdownRendering.enabled` | `true` | Live preview. Turn it off for plain source everywhere except tables, which stay editable |
| `markdownRendering.showHeadingMarkers` | `true` | Keep heading `#` markers visible. Turn it off to hide them until the caret is in the heading |
| `lineHighlight.enabled` | `false` | Highlight the line the caret is on, outside tables |
| `occurrenceHighlight.enabled` | `true` | Highlight other occurrences of the word at the caret or of the selected text, as VS Code does, with the same look in text and in table cells |
| `tableLayout.typingResizeDelay` | `0` | Milliseconds typing in a table cell must pause before the columns resize, up to `5000`. `0` resizes on every keystroke |
| `tableNavigation.modifierKey` | `F2` | Key held with an arrow to jump between cells, for example `Control`, `Ctrl+Space` or `KeyQ` |
| `tableShortcuts.insertRowBelow` | `Ctrl+Enter` | Each of the four insert shortcuts takes modifiers plus a key, or an empty string to disable it |
| `tableShortcuts.insertRowAbove` | `Ctrl+Shift+Enter` | |
| `tableShortcuts.insertColumnRight` | `Alt+Enter` | |
| `tableShortcuts.insertColumnLeft` | `Alt+Shift+Enter` | |
| `clipboard.defaultCopyMode` | `smart` | `smart`, `rich`, `plain` or `markdown` |
| `clipboard.defaultPasteMode` | `auto` | `auto`, `rich`, `plain` or `markdown` |
| `debug` | `false` | Write diagnostics to the **Markdown Live Editor** output channel |

The editor also follows VS Code's own `editor.wordWrap`, `editor.roundedSelection`,
`editor.renderWhitespace`, `editor.multiCursorModifier` and font settings.

## Commands

Available from the Command Palette under **Markdown Live Editor**.

| Command | Default shortcut |
| --- | --- |
| Toggle Markdown Live Editor | `Ctrl+Alt+M` (`Cmd+Ctrl+M` on macOS) |
| Toggle Task Checkbox at Caret | |
| Focus Task Checkbox at Caret | |
| Open Markdown Link at Caret | |
| Undo, Redo | VS Code's own shortcuts |
| Show Debug Log | |

## Limitations

- HTML is shown as text, not rendered.
- Images and embedded notes are not displayed; their source stays editable.
- Math and diagrams are not rendered.
- It is an editor, not a vault: there is no graph, backlinks panel, note creation or link
  completion.
- A file can be open in one live editor at a time.
- VS Code's screen-reader mode shows literal Markdown markers instead of hiding them. Behavior
  with a screen reader, and with input methods for languages such as Chinese and Japanese, has
  been tested only through automation, not with the real tools.

## Privacy and safety

- The editor makes no network requests and collects no telemetry.
- Documents are never executed: HTML is inert, code blocks only display, and images are not
  fetched.
- Links open through VS Code. Script, command and data links are refused.
- Pasted rich content is sanitized before it becomes Markdown.

## Building from source

```sh
npm ci
npm test
npm run package
```

`npm run package` writes `markdown-live-render-tables-latest.vsix`, ready to install. Project
documentation for contributors starts in [AGENTS.md](AGENTS.md): architecture, testing and the
design specification are under [`docs/`](docs/).

## License

[MIT](LICENSE). Bundled third-party software is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
