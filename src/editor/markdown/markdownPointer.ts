export const MARKDOWN_MARKER_DRAG_EVENT = "mlrt:begin-markdown-marker-drag";

export interface MarkdownMarkerDragDetail {
  readonly anchor: number;
  readonly pointerEvent: PointerEvent;
}

type TaskPointerEvent = Pick<
  PointerEvent,
  "button" | "isPrimary" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "target"
>;

/** Only explicit checkbox activation preserves the previous editing selection.
 * Modified and secondary gestures continue through ordinary selection owners.
 * The structural target check also permits browser-free policy tests. */
export function isMarkdownTaskPointerActivation(event: TaskPointerEvent): boolean {
  if (
    event.button !== 0 || !event.isPrimary ||
    event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
  ) {
    return false;
  }
  const target = event.target as Element | null;
  return typeof target?.closest === "function" &&
    target.closest(".mlrt-markdown-task-control") !== null;
}
