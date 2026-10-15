/** Line/column coordinates survive the webview's CRLF normalization. */
export interface EditorSourcePosition {
  line: number;
  character: number;
}

export interface EditorViewState {
  top: EditorSourcePosition;
  anchor: EditorSourcePosition;
  head: EditorSourcePosition;
}

export function isEditorViewState(value: unknown): value is EditorViewState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [record.top, record.anchor, record.head].every(position => {
    if (!position || typeof position !== "object") return false;
    const { line, character } = position as Record<string, unknown>;
    return Number.isSafeInteger(line) && Number(line) >= 0 &&
      Number.isSafeInteger(character) && Number(character) >= 0;
  });
}
