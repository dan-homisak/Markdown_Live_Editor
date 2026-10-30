# Markdown Live Editor

Markdown Live Editor provides Obsidian-style Live Preview inside VS Code, with editable tables. Formatting syntax disappears while reading and reappears when the caret enters the formatted text. Your document remains ordinary Markdown.

Edits are written directly back to the underlying Markdown, so documents remain standard `.md` files that work with existing tools, version control, and publishing workflows.

## Highlights

- Read rendered headings, emphasis, inline code, quotes, callouts, and YAML properties
- Follow generated `[TOC]` heading links and numbered footnote references/backlinks
- Reveal exact Markdown syntax by moving the caret into the text
- Wrap highlighted text by typing a formatting character; repeat it to build bold, wikilinks, or code fences
- Nest and unnest lists with Tab/Shift+Tab, continue them with Enter, and navigate to item text with the arrow keys
- Open rendered Markdown links and wikilinks, including heading/block targets
- Highlight JavaScript, TypeScript, JSON, shell, Python, and YAML code without downloads
- Copy code from a block's language toolbar
- Toggle task checkboxes with one source edit and one Undo
- Edit Markdown tables through a live, spreadsheet-like interface
- Navigate cells by keyboard and create multiline cell content
- Select individual cells, rows, columns, or rectangular ranges
- Copy and paste across Markdown editors, spreadsheets, and rich-text applications
- Preserve table alignment, escaped pipes, and Markdown formatting
- Expand tables safely when pasted data exceeds their current dimensions
- Switch between the live editor and VS Code's standard Markdown editor at any time

## Getting started

Open a `.md` or `.markdown` file in VS Code, then select the eye icon in the editor title bar to toggle Markdown Live Editor.

You can also use the default keyboard shortcut:

- macOS: `Cmd+Ctrl+M`
- Windows and Linux: `Ctrl+Alt+M`

To customize the shortcut, open **Keyboard Shortcuts** and search for **Markdown Live Editor: Toggle Markdown Live Editor**.

## Formatting a selection

Highlight text and type a formatting character. The text stays selected, so another press extends the surrounding markers:

- `*` or `_`: italics, then bold, then bold italics
- Backtick: inline code, then double backticks, then a fenced code block with the selected text between two fence lines
- `[`: `[text]()` with an empty link destination; press again for `[[text]]`
- `!`: `![text]()`; on an existing link or wikilink, converts it to image or embed syntax
- `~`, `=`, `$`, or `^`: surround the text with that character; repeat for doubled markers such as strikethrough `~~text~~` or highlight `==text==`
- `(`, `{`, `<`, single quote, or double quote: surround the text with the matching pair

This also works inside table cells, where backticks stay inline. Highlight, math, and superscript markers are inserted as source syntax. Their rendering depends on the Markdown viewer. Typing without a selection keeps its usual behavior.

## Working with tables

Inactive table cells render inline emphasis, code, links, escapes, and entities. Click a table cell to reveal and edit its exact Markdown source; leaving it restores formatting. Press `Tab` or `Shift+Tab` to move between cells. `Enter` moves down the same column, exiting after the final row; `Shift+Enter` adds a line break within a cell. Wide tables support horizontal wheel scrolling, Shift+wheel, and dragging the scrollbar.

Ordinary arrow keys navigate characters and visual lines normally, crossing into another cell only after the caret reaches a cell edge. For immediate geometric navigation to an adjacent cell, hold the configured key or combination (`F2` by default) while pressing an arrow key; the caret lands at the end of the destination cell so you can continue typing there.

Press `Escape` while editing to select the current cell. From there, use the arrow keys to move the selection or hold `Shift` to extend it. Range selections can also be created by dragging or by shift-clicking another cell.

Hold `Ctrl` (`Cmd` on macOS) while clicking cells, row gutters, or row/column handles to add or toggle separate selections in the same table. Cells, rows, and columns can be combined. Backspace clears only the selected cells; Delete clears populated selections first, then removes their complete empty rows and columns. Unselected gaps are preserved. Right-click actions use the exact selected cells and row/column counts.

Right-click a text line and choose **Insert table (2 × 2)** to add a table. Delete the final blank line between two tables with the same number of columns to combine them; the second table's header becomes a data row.

Use a table's row or column handle to select a row or column, then hold `Shift` with the arrow keys to extend the selection. Dragging across all cells in a row or column also selects complete rows or columns. `Backspace` always clears contents and preserves table structure, even when pressed repeatedly. `Delete` clears a populated row, column, or whole-table selection; if it is already empty, `Delete` removes it immediately. Partial cell ranges only clear their contents. The right-click menu keeps clear, delete-row, delete-column, and whole-table actions available, with counts based on the highlighted range. Menu **Delete row/column** removes the targeted rows or columns immediately and leaves the caret in a nearby cell so you can repeat the action. Tables with different column counts cannot merge; attempting it displays the two column counts.

The editor provides several clipboard formats for moving content between Markdown, spreadsheets, and rich-text tools. Smart copy is the default and keeps list content inside spreadsheet cells using portable inline markers and same-cell line breaks. **Copy Rich** preserves semantic nested lists for Word and other rich-text tools. Dedicated **Copy Plain Text** and **Copy Markdown** actions are also available from the context menu.

The editor title bar provides Undo and Redo buttons for document and table edits. The context menu's **Delete table** removes the table and its contents immediately; **Clear table** preserves its structure.

While editing a cell, use **Ctrl+Enter** to insert a row below, **Ctrl+Shift+Enter** above, **Alt+Enter** for a column to the right, and **Alt+Shift+Enter** to the left. The caret moves into the inserted cell. Inserting above the header creates a blank header and moves the old header into the first body row.

## Configuration

The following settings are available in VS Code:

- `markdownLiveRenderTables.tableNavigation.modifierKey` - accepts a custom key or combination used with arrow keys for direct cell navigation, such as `F2`, `Control`, `Ctrl+Space`, or `KeyQ`
- `markdownLiveRenderTables.tableShortcuts.insertRowBelow`, `insertRowAbove`, `insertColumnRight`, and `insertColumnLeft` - customize the four insertion shortcuts; use modifiers plus a key/code such as `Ctrl+Shift+KeyI`, or an empty string to disable. Changes take effect immediately.
- `markdownLiveRenderTables.clipboard.defaultCopyMode` - sets the default copy representation
- `markdownLiveRenderTables.clipboard.defaultPasteMode` - sets the default paste interpretation
- `markdownLiveRenderTables.lineHighlight.enabled` - highlights the active line outside rendered tables; defaults to `false`. Table highlighting and editing are unchanged.
- `markdownLiveRenderTables.debug` - enables diagnostic logging for development and troubleshooting
- `markdownLiveRenderTables.markdownRendering.enabled` - enables live Markdown styling and actions; defaults to `true`
- `markdownLiveRenderTables.markdownRendering.showHeadingMarkers` - always shows heading `#` markers; defaults to `true`. Disable to hide inactive markers and reveal them at the caret.

Rendering is active whenever a document opens in the live editor. Existing windows may need **Developer: Reload Window** after installing an update. An explicit `false` setting continues to disable the feature; remove that override or set it to `true` to use the new rendering.

Place the caret in a task and use **Markdown Live Editor: Toggle Task Checkbox at Caret** or **Focus Task Checkbox at Caret** in the Command Palette. These actions also appear in the task context menu. A focused checkbox supports Space to toggle and Escape to return to the caret. Editing a marker reveals its exact source characters.

Click a rendered link to open it. Move the caret into a link to edit its original Markdown or `[[Note|Alias]]` syntax. While editing the link, Ctrl+click on Windows/Linux or Cmd+click on macOS opens it; use Alt+click when `editor.multiCursorModifier` is `ctrlCmd`. **Markdown Live Editor: Open Markdown Link at Caret** also works. Supported targets include HTTP, HTTPS, mailto, document paths, references, wikilinks, headings, and block IDs. Note names resolve beside the current file, then within its workspace; ambiguous matches prompt for a choice. Documents open at the target in VS Code.

Headings keep their `#` markers by default, retain the editor's text size, and use a different VS Code Dark+/Light+ syntax color for each level. Bold/italic/strike, inline code, links, quotes, callouts, and code fences render without inactive formatting syntax. Editing reveals the exact source. Fenced code keeps both fence rows and their gutter numbers, hiding the opening fence and language without moving the code or following rows. Code blocks retain their background, use subtly rounded corners without top/bottom borders, and show their language in the upper-right control. Hover or keyboard focus changes the label to Copy; activating it copies the code. Callouts support titles and `+`/`-` folding. Fenced code highlights `javascript/js/nodejs`, `typescript/ts`, `json`, `bash/sh/shell`, `python/py`, and `yaml/yml`; unknown languages remain plain code. HTML stays literal, and images/embedded notes are not fetched. Independently recognized tables retain their existing rendering and ownership.

YAML properties stay visible as syntax-colored source inside a subtle frame, including their `---` delimiters and line numbers. Type `---` alone on the first line to create a closed properties block above the existing document. Empty property rows offer `tags` first; use Up/Down and Enter to select a property, Escape to dismiss, or Ctrl+Space to reopen suggestions. Custom names work too: type a name followed by `:` or press Enter to add `: `. Suggestions are local defaults and omit keys already present; no vault lookup is performed.

Within properties, Tab/Shift+Tab use two-space indentation. Enter continues list items, an empty item ends the list, and Enter on the closing delimiter moves into the document body. Simple property separators receive a space automatically. After edits, leaving the block formats valid YAML with two-space indentation while preserving values, comments and quoted strings. Invalid YAML (including duplicate keys) is underlined with an explanatory hover; ambiguous text is kept for correction. Existing files are never reformatted merely by opening them. These editing aids follow the Markdown rendering setting.

In lists, Up/Down follows rendered rows and avoids parking the caret in indentation before item text. Home goes to item text first, then source-line start; End goes to the end of the current rendered row, including wrapped rows. Tab/Shift+Tab and Ctrl/Cmd+]/[ nest or unnest an item and its descendants in one keystroke, including numbered lists. Enter continues bullets, numbered items, and unchecked tasks; Enter on an empty item outdents or exits the list. Backspace at item-text start outdents or removes a top-level marker.

Nested blockquotes retain a guide and indentation for every level. Ordered lists display consecutive numbers starting at the first source number, while editing a number reveals its original spelling. Character entities render as their characters outside literal code. A standalone `[TOC]` generates a navigable heading list; `[^label]` references and their definitions render with matching numbers and navigation back to the reference. Indented continuation paragraphs remain part of their footnote. These presentations preserve the saved Markdown and reveal source at the caret.

Turning rendering off restores ordinary non-table presentation and base Markdown input while retaining table editing. Host accessibility mode uses literal markers and keeps the task toggle command available. Actual OS IME and screen-reader coverage is recorded separately from automation. See `LIVE_MARKDOWN_RENDERING_DESIGN_SPEC.md` for the current product contract and `qa/live-preview-2026-10-04.md` for verification and limits.

## Development

Requirements:

- Node.js and npm
- Visual Studio Code 1.101 or later

Install dependencies and build the extension:

```sh
npm install
npm run compile
```

Run the automated test suite:

```sh
npm test
```

After compiling, run `node scripts/edh-markdown-rendering-check.mjs` for marker interactions and `node scripts/edh-markdown-release-check.mjs` for the complete rendering surface in isolated VS Code windows. The required `node scripts/edh-visual-check.mjs` remains the stock/live geometry and table regression check.

Create a local VSIX package:

```sh
npm run package
```

## License

This project is available under the MIT License.
