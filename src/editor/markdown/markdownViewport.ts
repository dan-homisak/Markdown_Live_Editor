import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { MarkdownRange } from "./markdownSyntax";

/** Prepare source rows before they enter the rendered viewport. Keep the
 * projection bounded even when an enclosing code block spans the document. */
export function markdownViewportWindows(view: EditorView, overscanLines = 60): MarkdownRange[] {
  const doc = view.state.doc, parsedTo = syntaxTree(view.state).length;
  const windows: MarkdownRange[] = [];
  for (const visible of view.visibleRanges) {
    const from = doc.line(Math.max(1, doc.lineAt(visible.from).number - overscanLines)).from;
    const to = Math.min(parsedTo, doc.line(Math.min(doc.lines, doc.lineAt(visible.to).number + overscanLines)).to);
    if (from >= to || !syntaxTreeAvailable(view.state, to)) continue;
    const previous = windows.at(-1);
    if (previous && previous.to >= from) windows[windows.length - 1] = { from: previous.from, to: Math.max(previous.to, to) };
    else windows.push({ from, to });
  }
  return windows;
}
