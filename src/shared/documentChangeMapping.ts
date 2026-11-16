export interface DocumentChangeLike {
  from: number;
  to: number;
  text: string;
}

export interface LineCharacter {
  line: number;
  character: number;
}

export interface MappedDocumentChange {
  from: LineCharacter;
  to: LineCharacter;
  text: string;
}

export function normalizeDocumentText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function getHostLineSeparator(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function normalizeChangeTextLineEndings(
  text: string,
  lineSeparator: "\r\n" | "\n",
): string {
  return lineSeparator === "\n"
    ? normalizeDocumentText(text)
    : normalizeDocumentText(text).replace(/\n/g, lineSeparator);
}

export function lineCharacterAtNormalizedOffset(
  normalizedText: string,
  offset: number,
): LineCharacter {
  const clampedOffset = Math.min(Math.max(0, offset), normalizedText.length);
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < clampedOffset; index++) {
    if (normalizedText.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }

  return {
    line,
    character: clampedOffset - lineStart,
  };
}

/** Where every line of LF-normalized text starts. */
function normalizedLineStarts(normalizedText: string): number[] {
  const starts = [0];
  for (
    let index = normalizedText.indexOf("\n");
    index !== -1;
    index = normalizedText.indexOf("\n", index + 1)
  ) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * The same answer as `lineCharacterAtNormalizedOffset`, found by searching
 * the line starts. One edit can carry thousands of changes (a replace all,
 * typing at many cursors); reading the text from its start for each of them
 * blocked the extension host for seconds.
 */
function lineCharacterFromStarts(
  starts: readonly number[],
  length: number,
  offset: number,
): LineCharacter {
  const clampedOffset = Math.min(Math.max(0, offset), length);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= clampedOffset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { line: low, character: clampedOffset - starts[low] };
}

export function mapNormalizedDocumentChangesToHost(
  hostText: string,
  changes: readonly DocumentChangeLike[],
  hostLineSeparator: "\r\n" | "\n" = getHostLineSeparator(hostText),
): MappedDocumentChange[] {
  const normalizedHostText = normalizeDocumentText(hostText);
  const starts = normalizedLineStarts(normalizedHostText);
  const length = normalizedHostText.length;

  return changes.map((change) => ({
    from: lineCharacterFromStarts(starts, length, change.from),
    to: lineCharacterFromStarts(starts, length, change.to),
    text: normalizeChangeTextLineEndings(change.text, hostLineSeparator),
  }));
}
