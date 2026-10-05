# Markdown Live Editor

Markdown Live Editor provides Obsidian-style Live Preview inside VS Code, with editable tables. Formatting syntax disappears while reading and reappears when the caret enters the formatted text. Your document remains ordinary Markdown.

Edits are written directly back to the underlying Markdown, so documents remain standard `.md` files that work with existing tools, version control, and publishing workflows.

## Highlights

- Read rendered headings, emphasis, inline code, quotes, callouts, and YAML properties
- Reveal exact Markdown syntax by moving the caret into the text
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

## Working with tables

Click a table cell to edit it. Press `Tab` or `Shift+Tab` to move between cells, and use `Shift+Enter` to add a line break within a cell.

Ordinary arrow keys navigate characters and visual lines normally, crossing into another cell only after the caret reaches a cell edge. For immediate geometric navigation to an adjacent cell, hold the configured function key (`F2` by default) while pressing an arrow key; the caret lands at the end of the destination cell so you can continue typing there.

Press `Escape` while editing to select the current cell. From there, use the arrow keys to move the selection or hold `Shift` to extend it. Range selections can also be created by dragging or by shift-clicking another cell.

The editor provides several clipboard formats for moving content between Markdown, spreadsheets, and rich-text tools. Smart copy is the default and keeps list content inside spreadsheet cells using portable inline markers and same-cell line breaks. **Copy Rich** preserves semantic nested lists for Word and other rich-text tools. Dedicated **Copy Plain Text** and **Copy Markdown** actions are also available from the context menu.

## Configuration

The following settings are available in VS Code:

- `markdownLiveRenderTables.tableNavigation.modifierKey` - chooses the function key used with arrow keys for direct cell navigation
- `markdownLiveRenderTables.clipboard.defaultCopyMode` - sets the default copy representation
- `markdownLiveRenderTables.clipboard.defaultPasteMode` - sets the default paste interpretation
- `markdownLiveRenderTables.debug` - enables diagnostic logging for development and troubleshooting
- `markdownLiveRenderTables.markdownRendering.enabled` - enables live Markdown styling and actions; defaults to `true`

Rendering is active whenever a document opens in the live editor. Existing windows may need **Developer: Reload Window** after installing an update. An explicit `false` setting continues to disable the feature; remove that override or set it to `true` to use the new rendering.

Place the caret in a task and use **Markdown Live Editor: Toggle Task Checkbox at Caret** or **Focus Task Checkbox at Caret** in the Command Palette. These actions also appear in the task context menu. A focused checkbox supports Space to toggle and Escape to return to the caret. Editing a marker reveals its exact source characters.

Click a rendered link to open it. Move the caret into a link to edit its original Markdown or `[[Note|Alias]]` syntax. While editing the link, Ctrl+click on Windows/Linux or Cmd+click on macOS opens it; use Alt+click when `editor.multiCursorModifier` is `ctrlCmd`. **Markdown Live Editor: Open Markdown Link at Caret** also works. Supported targets include HTTP, HTTPS, mailto, document paths, references, wikilinks, headings, and block IDs. Note names resolve beside the current file, then within its workspace; ambiguous matches prompt for a choice. Documents open at the target in VS Code.

Headings, bold/italic/strike, inline code, links, quotes, callouts, code fences, and YAML properties render without inactive formatting syntax. Editing reveals the exact source. Code blocks show a language label and Copy button. Callouts support titles and `+`/`-` folding; clicking a property opens its original YAML for editing. Fenced code highlights `javascript/js/nodejs`, `typescript/ts`, `json`, `bash/sh/shell`, `python/py`, and `yaml/yml`; unknown languages remain plain code. HTML stays literal, and images/embedded notes are not fetched. YAML frontmatter requires opening and closing standalone `---` at the start of the document. Independently recognized tables retain their existing rendering and ownership.

In lists, Up/Down avoids parking the caret in indentation before item text. Home goes to item text first, then source-line start. Tab/Shift+Tab and Ctrl/Cmd+]/[ nest or unnest an item and its descendants. Enter continues bullets, numbered items, and unchecked tasks; Enter on an empty item outdents or exits the list. Backspace at item-text start outdents or removes a top-level marker.

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
