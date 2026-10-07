export interface CodeHighlightRange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface CodeHighlightToken {
  readonly from: number;
  readonly to: number;
  readonly color: string;
  /** TextMate FontStyle bits: italic, bold, underline, strikethrough. */
  readonly fontStyle: number;
}

export interface CodeHighlightRequest {
  readonly type: "requestCodeHighlighting";
  readonly id: number;
  readonly ranges: readonly CodeHighlightRange[];
  readonly themeName?: string;
}

export interface CodeHighlightResponse {
  readonly type: "codeHighlighting";
  readonly id: number;
  readonly tokens: readonly CodeHighlightToken[];
}

export function isCodeHighlightRequest(value: unknown): value is CodeHighlightRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as CodeHighlightRequest;
  return request.type === "requestCodeHighlighting" && Number.isSafeInteger(request.id) &&
    request.id > 0 && (request.themeName === undefined || typeof request.themeName === "string") &&
    Array.isArray(request.ranges) && request.ranges.length <= 500 &&
    request.ranges.every(range => range && Number.isSafeInteger(range.from) &&
      Number.isSafeInteger(range.to) && range.from >= 0 && range.to > range.from &&
      typeof range.text === "string" && range.text.length === range.to - range.from);
}
