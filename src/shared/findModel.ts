import {
  canonicalTableCellValue,
  formatTableCellSourceEdit,
  ParsedRow,
  ParsedTable,
  parseMarkdownTableRow,
  positionAfterTable,
  ReadonlyDocText,
  rowToDisplayValues,
  TableCellSourceEdit,
} from "./tableModel";

/**
 * Find and replace over a Markdown document, without an editor.
 *
 * The search domain is the Markdown source. Prose is searched as written.
 * A recognized table is searched one cell at a time, as the text the cell
 * shows while it is edited; pipes, the delimiter row and padding are not
 * searched, and no match spans two cells or a table boundary.
 *
 * Document text is LF-normalized, as everywhere in the editor.
 */
export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Matches counted and navigated at most; the stock editor stops near here too. */
export const FIND_MATCH_LIMIT = 20000;

export type CompiledFindQuery =
  | {
      ok: true;
      /** Global and multiline. Never used directly: every search clones it. */
      pattern: RegExp;
      regex: boolean;
      wholeWord: boolean;
      /** A literal query without a line break can be searched a piece at a time. */
      singleLineLiteral: boolean;
    }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "invalid"; message: string };

export type UsableFindQuery = Extract<CompiledFindQuery, { ok: true }>;

export interface TextMatch {
  from: number;
  to: number;
}

/**
 * One searchable stretch. `row` is the grid row of a cell: 0 is the header
 * and 1 the first body row. `cellFrom` is where the cell's source starts in
 * the document, which places the cell among the prose around its table.
 */
export type FindSegment =
  | { kind: "prose"; from: number; to: number }
  | { kind: "cell"; tableFrom: number; row: number; column: number; cellFrom: number; value: string };

/** A match. Prose offsets are document offsets; cell offsets are in the cell's text. */
export type FindLocation =
  | { kind: "prose"; from: number; to: number }
  | { kind: "cell"; tableFrom: number; row: number; column: number; cellFrom: number; from: number; to: number };

export interface FindScan {
  readonly matches: FindLocation[];
  readonly done: boolean;
  /** More matches exist than the limit allowed. */
  readonly truncated: boolean;
  /**
   * Continues the scan and returns whether it is finished. `shouldPause` is
   * asked between pieces of the document and every few hundred matches; a
   * paused scan resumes where it stopped on the next call.
   */
  run(shouldPause?: () => boolean): boolean;
}

export interface PlannedCellReplace {
  tableFrom: number;
  row: number;
  column: number;
  /** The cell's text after the replace, before it is encoded as source. */
  value: string;
  edit: TableCellSourceEdit;
}

export interface ReplacePlan {
  /** Changes outside tables, in document order, against the planned document. */
  prose: { from: number; to: number; insert: string }[];
  /** One edit per changed cell, each replacing exactly that cell's source. */
  cells: PlannedCellReplace[];
  /** Matches whose text changes. */
  count: number;
  /** Why nothing may be applied, when an edit would damage a table. */
  refused: string | null;
  /** For the plan of one match: the text that takes the match's place. */
  inserted?: string;
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const SCAN_PIECE = 64 * 1024;
const PAUSE_EVERY = 256;

export function compileFindQuery(text: string, options: FindOptions): CompiledFindQuery {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const source = options.regex ? normalized : escapeFindRegex(normalized);
  const flags = `gm${options.matchCase ? "" : "i"}`;
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, `${flags}u`);
  } catch (unicodeError) {
    // A pattern written for the older syntax, such as an escaped hyphen.
    try {
      pattern = new RegExp(source, flags);
    } catch {
      return { ok: false, reason: "invalid", message: errorMessage(unicodeError) };
    }
  }
  return {
    ok: true,
    pattern,
    regex: options.regex,
    wholeWord: options.wholeWord,
    singleLineLiteral: !options.regex && !normalized.includes("\n"),
  };
}

/** Text as a pattern that matches exactly that text. */
export function escapeFindRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Invalid regular expression: /, "") || "Invalid regular expression";
}

/** Every match of `query` in `text`, left to right and without overlap. */
export function findInText(
  text: string,
  query: UsableFindQuery,
  options: { limit?: number; allowEmpty?: boolean } = {},
): TextMatch[] {
  const limit = options.limit ?? Infinity;
  const results: TextMatch[] = [];
  for (const match of execAll(text, query, options.allowEmpty ?? false)) {
    results.push({ from: match.index, to: match.index + match[0].length });
    if (results.length >= limit) break;
  }
  return results;
}

function* execAll(text: string, query: UsableFindQuery, allowEmpty: boolean): Generator<RegExpExecArray> {
  const pattern = new RegExp(query.pattern.source, query.pattern.flags);
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const from = match.index;
    const empty = match[0].length === 0;
    if (empty) {
      // Step over one character, never half of a surrogate pair.
      pattern.lastIndex = from + (isHighSurrogate(text, from) ? 2 : 1);
    }
    if ((!empty || allowEmpty) && (!query.wholeWord || isWholeWord(text, from, from + match[0].length))) {
      yield match;
    }
    if (empty && from >= text.length) break;
  }
}

/** The match of `query` that starts exactly at `from` and ends at `to`, if there is one. */
function execAt(text: string, query: UsableFindQuery, from: number, to: number): RegExpExecArray | null {
  const pattern = new RegExp(query.pattern.source, `${query.pattern.flags.replace("g", "")}y`);
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  if (!match || match.index !== from || from + match[0].length !== to) return null;
  return !query.wholeWord || isWholeWord(text, from, to) ? match : null;
}

function isHighSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff && index + 1 < text.length;
}

function wordCharacterAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  return WORD_CHARACTER.test(String.fromCodePoint(text.codePointAt(index)!));
}

function wordCharacterBefore(text: string, index: number): boolean {
  if (index <= 0) return false;
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 && isHighSurrogate(text, index - 2) ? index - 2 : index - 1;
  return wordCharacterAt(text, start);
}

/**
 * The stock editor's rule: an edge of the match is a word edge unless a word
 * character sits on both sides of it.
 */
function isWholeWord(text: string, from: number, to: number): boolean {
  const left = !(wordCharacterBefore(text, from) && wordCharacterAt(text, from));
  const right = !(wordCharacterBefore(text, to) && wordCharacterAt(text, to));
  return left && right;
}

/**
 * The parts of `from`-`to` that are prose: what is left once every table, with
 * the line breaks that belong to it, is taken out. `tables` is in document order.
 */
export function proseRangesWithin(
  doc: ReadonlyDocText,
  tables: readonly ParsedTable[],
  from: number,
  to: number,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let cursor = from;
  for (const table of tables) {
    const protectedFrom = table.from > 0 && doc.sliceString(table.from - 1, table.from) === "\n"
      ? table.from - 1
      : table.from;
    const protectedTo = positionAfterTable(doc, table);
    if (protectedTo <= cursor) continue;
    if (protectedFrom >= to) break;
    if (protectedFrom > cursor) ranges.push({ from: cursor, to: protectedFrom });
    cursor = Math.max(cursor, protectedTo);
  }
  if (cursor < to) ranges.push({ from: cursor, to });
  return ranges;
}

/**
 * The searchable stretches of a document, in document order. The line break
 * before a table and the one that ends it belong to the table: removing either
 * would change its rows, so neither is part of any prose segment.
 */
export function planFindSegments(doc: ReadonlyDocText, tables: readonly ParsedTable[]): FindSegment[] {
  const segments: FindSegment[] = [];
  let cursor = 0;
  let lineStartAtCursor = true;
  for (const table of [...tables].sort((left, right) => left.from - right.from)) {
    const protectedFrom = table.from > 0 && doc.sliceString(table.from - 1, table.from) === "\n"
      ? table.from - 1
      : table.from;
    if (table.from > 0 && protectedFrom >= cursor) {
      segments.push({ kind: "prose", from: cursor, to: protectedFrom });
    }
    const rows: ParsedRow[] = [table.header, ...table.body];
    rows.forEach((row, rowIndex) => {
      rowToDisplayValues(row, table.columnCount).forEach((value, column) => {
        const cell = row.cells[column];
        if (cell && value.length > 0) {
          segments.push({ kind: "cell", tableFrom: table.from, row: rowIndex, column, cellFrom: cell.start, value });
        }
      });
    });
    const protectedTo = positionAfterTable(doc, table);
    lineStartAtCursor = protectedTo > table.to;
    cursor = Math.max(cursor, protectedTo);
  }
  // After a table that ends the document without a line break there is no
  // prose position at all: the end of the document is the end of its last row.
  if (cursor < doc.length || lineStartAtCursor) {
    segments.push({ kind: "prose", from: cursor, to: doc.length });
  }
  return segments;
}

export function createFindScan(
  doc: ReadonlyDocText,
  tables: readonly ParsedTable[],
  query: UsableFindQuery,
  limit = FIND_MATCH_LIMIT,
): FindScan {
  const pieces = scanPieces(doc, planFindSegments(doc, tables), query);
  const scan = {
    matches: [] as FindLocation[],
    done: false,
    truncated: false,
    run(shouldPause?: () => boolean): boolean {
      let sinceAsked = 0;
      while (!scan.done) {
        const next = pieces.next();
        if (next.done) {
          scan.done = true;
        } else if (next.value === null) {
          if (shouldPause?.()) return false;
        } else if (scan.matches.length >= limit) {
          scan.truncated = true;
          scan.done = true;
        } else {
          scan.matches.push(next.value);
          if (++sinceAsked >= PAUSE_EVERY) {
            sinceAsked = 0;
            if (shouldPause?.()) return false;
          }
        }
      }
      return true;
    },
  };
  return scan;
}

/** Yields matches in document order, and `null` wherever a scan may pause. */
function* scanPieces(
  doc: ReadonlyDocText,
  segments: readonly FindSegment[],
  query: UsableFindQuery,
): Generator<FindLocation | null> {
  for (const segment of segments) {
    if (segment.kind === "cell") {
      for (const match of execAll(segment.value, query, false)) {
        yield {
          kind: "cell",
          tableFrom: segment.tableFrom,
          row: segment.row,
          column: segment.column,
          cellFrom: segment.cellFrom,
          from: match.index,
          to: match.index + match[0].length,
        };
      }
      continue;
    }
    const text = doc.sliceString(segment.from, segment.to);
    let pieceFrom = 0;
    do {
      // Whole lines only, so a word edge at the end of a piece is a real one.
      let pieceTo = text.length;
      if (query.singleLineLiteral && text.length - pieceFrom > SCAN_PIECE) {
        const lineEnd = text.indexOf("\n", pieceFrom + SCAN_PIECE);
        if (lineEnd !== -1) pieceTo = lineEnd + 1;
      }
      const piece = pieceFrom === 0 && pieceTo === text.length ? text : text.slice(pieceFrom, pieceTo);
      // A later piece starts after a line break, where an empty match was
      // already offered at the end of the piece before it.
      for (const match of execAll(piece, query, true)) {
        if (pieceFrom > 0 && match[0].length === 0 && match.index === 0) continue;
        const from = segment.from + pieceFrom + match.index;
        yield { kind: "prose", from, to: from + match[0].length };
      }
      pieceFrom = pieceTo;
      yield null;
    } while (pieceFrom < text.length);
  }
}

/**
 * Positions that order prose and cells together: a document offset, then an
 * offset inside a cell's text (0 in prose). A cell's source lies inside its
 * table, where no prose position can be.
 */
export function compareFindPositions(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

export function findLocationStart(location: FindLocation): [number, number] {
  return location.kind === "prose" ? [location.from, 0] : [location.cellFrom, location.from];
}

export function findLocationEnd(location: FindLocation): [number, number] {
  return location.kind === "prose" ? [location.to, 0] : [location.cellFrom, location.to];
}

/** The index of the first match starting at or after `position`; `matches.length` when there is none. */
export function findLowerBound(matches: readonly FindLocation[], position: readonly [number, number]): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (compareFindPositions(findLocationStart(matches[middle]), position) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The first match starting at or after `position`, wrapping to the first; -1 without matches. */
export function nextFindIndex(matches: readonly FindLocation[], position: readonly [number, number]): number {
  if (matches.length === 0) return -1;
  const index = findLowerBound(matches, position);
  return index === matches.length ? 0 : index;
}

/** The last match starting before `position`, wrapping to the last; -1 without matches. */
export function previousFindIndex(matches: readonly FindLocation[], position: readonly [number, number]): number {
  if (matches.length === 0) return -1;
  const index = findLowerBound(matches, position);
  return index === 0 ? matches.length - 1 : index - 1;
}

/**
 * The text that replaces one match. A literal replacement is used as written.
 * With a regular expression, `$1` to `$99` are groups, `$&` and `$0` the whole
 * match, `$$` a dollar sign, and `\n`, `\t` and `\\` a line break, a tab and a
 * backslash. A reference to a group the pattern does not have stays as written.
 */
export function expandFindReplacement(
  template: string,
  regex: boolean,
  match: readonly (string | undefined)[],
): string {
  if (!regex) return template;
  let result = "";
  for (let index = 0; index < template.length; index++) {
    const character = template[index];
    const next = template[index + 1];
    if (character === "\\" && (next === "n" || next === "t" || next === "\\")) {
      result += next === "n" ? "\n" : next === "t" ? "\t" : "\\";
      index++;
    } else if (character === "$" && next === "$") {
      result += "$";
      index++;
    } else if (character === "$" && (next === "&" || (next === "0" && !isDigit(template[index + 2])))) {
      result += match[0] ?? "";
      index++;
    } else if (character === "$" && isDigit(next)) {
      const two = isDigit(template[index + 2]) ? Number(template.slice(index + 1, index + 3)) : NaN;
      const one = Number(next);
      if (two >= 1 && two < match.length) {
        result += match[two] ?? "";
        index += 2;
      } else if (one >= 1 && one < match.length) {
        result += match[one] ?? "";
        index++;
      } else {
        result += character;
      }
    } else {
      result += character;
    }
  }
  return result;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Plans the replacement of every match in the document. */
export function planReplaceAll(
  doc: ReadonlyDocText,
  tables: readonly ParsedTable[],
  query: UsableFindQuery,
  template: string,
): ReplacePlan {
  const plan: ReplacePlan = { prose: [], cells: [], count: 0, refused: null };
  for (const segment of planFindSegments(doc, tables)) {
    if (segment.kind === "prose") {
      const text = doc.sliceString(segment.from, segment.to);
      for (const match of execAll(text, query, true)) {
        const insert = expandFindReplacement(template, query.regex, match);
        if (insert === match[0]) continue;
        const from = segment.from + match.index;
        plan.prose.push({ from, to: from + match[0].length, insert });
        plan.count++;
      }
      continue;
    }
    let value = "";
    let cursor = 0;
    let changed = 0;
    for (const match of execAll(segment.value, query, false)) {
      const insert = expandFindReplacement(template, query.regex, match);
      value += segment.value.slice(cursor, match.index) + insert;
      cursor = match.index + match[0].length;
      if (insert !== match[0]) changed++;
    }
    if (changed === 0) continue;
    value += segment.value.slice(cursor);
    if (planCell(doc, tables, plan, segment, value)) plan.count += changed;
  }
  plan.refused = tableDamage(doc, tables, plan);
  return plan;
}

/**
 * Plans the replacement of one match. Returns null when `location` is not a
 * match of `query` in this document any more, so nothing stale is replaced.
 */
export function planReplaceAt(
  doc: ReadonlyDocText,
  tables: readonly ParsedTable[],
  query: UsableFindQuery,
  template: string,
  location: FindLocation,
): ReplacePlan | null {
  const plan: ReplacePlan = { prose: [], cells: [], count: 0, refused: null };
  const segments = planFindSegments(doc, tables);
  if (location.kind === "prose") {
    const segment = segments.find(candidate =>
      candidate.kind === "prose" && candidate.from <= location.from && location.to <= candidate.to);
    if (!segment || segment.kind !== "prose" || location.to < location.from) return null;
    const text = doc.sliceString(segment.from, segment.to);
    const match = execAt(text, query, location.from - segment.from, location.to - segment.from);
    if (!match) return null;
    const insert = expandFindReplacement(template, query.regex, match);
    plan.inserted = insert;
    if (insert !== match[0]) {
      plan.prose.push({ from: location.from, to: location.to, insert });
      plan.count = 1;
    }
    return plan;
  }
  const segment = segments.find(candidate => candidate.kind === "cell" &&
    candidate.tableFrom === location.tableFrom && candidate.row === location.row && candidate.column === location.column);
  if (!segment || segment.kind !== "cell" || location.to <= location.from) return null;
  const match = execAt(segment.value, query, location.from, location.to);
  if (!match) return null;
  const insert = expandFindReplacement(template, query.regex, match);
  plan.inserted = insert;
  if (insert !== match[0]) {
    const value = segment.value.slice(0, location.from) + insert + segment.value.slice(location.to);
    if (planCell(doc, tables, plan, segment, value)) plan.count = 1;
  }
  plan.refused = tableDamage(doc, tables, plan);
  return plan;
}

/** Adds the edit that gives a cell a new value; false when the source would not change. */
function planCell(
  doc: ReadonlyDocText,
  tables: readonly ParsedTable[],
  plan: ReplacePlan,
  segment: Extract<FindSegment, { kind: "cell" }>,
  value: string,
): boolean {
  const table = tables.find(candidate => candidate.from === segment.tableFrom);
  const row = table && tableRow(table, segment.row);
  if (!table || !row || canonicalTableCellValue(value) === segment.value) return false;
  // The same encoding a typed cell edit uses: pipes and line breaks are
  // written so that the row keeps its cells, and the cell keeps its padding.
  const edit = formatTableCellSourceEdit(row, table.columnCount, segment.column, value, { trim: "horizontal" });
  if (doc.sliceString(edit.from, edit.to) === edit.insert) return false;
  plan.cells.push({ tableFrom: segment.tableFrom, row: segment.row, column: segment.column, value, edit });
  return true;
}

function tableRow(table: ParsedTable, row: number): ParsedRow | undefined {
  return row === 0 ? table.header : table.body[row - 1];
}

/**
 * Proves that the planned cell edits leave every edited row on one line with
 * the cells it had. A plan that fails here is never dispatched. For one cell
 * the table guard checks the same again when the edit is dispatched; for
 * several cells the guard checks only that each change lies inside a declared
 * table, so this is the check that counts.
 */
function tableDamage(doc: ReadonlyDocText, tables: readonly ParsedTable[], plan: ReplacePlan): string | null {
  const byRow = new Map<string, PlannedCellReplace[]>();
  for (const cell of plan.cells) {
    const key = `${cell.tableFrom}:${cell.row}`;
    byRow.set(key, [...(byRow.get(key) ?? []), cell]);
  }
  for (const cells of byRow.values()) {
    const table = tables.find(candidate => candidate.from === cells[0].tableFrom);
    const row = table && tableRow(table, cells[0].row);
    if (!table || !row) return "a table changed before the replace was planned";
    let text = row.text;
    for (const cell of [...cells].sort((left, right) => right.edit.from - left.edit.from)) {
      if (/[\r\n]/.test(cell.edit.insert) || cell.edit.from < row.from || cell.edit.to > row.to) {
        return "a replacement would break a table row";
      }
      text = text.slice(0, cell.edit.from - row.from) + cell.edit.insert + text.slice(cell.edit.to - row.from);
    }
    if (parseMarkdownTableRow(row.lineIndex, row.from, text).cells.length !== row.cells.length) {
      return "a replacement would change the cells of a table row";
    }
    if (doc.sliceString(row.from, row.to) !== row.text) return "a table changed before the replace was planned";
  }
  return null;
}
