import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  findOccurrences,
  occurrenceQueryForCellText,
  occurrenceQueryForState,
} from "../editor/occurrenceHighlight";
import { selectedLineSegments } from "../editor/documentSelectionDecorations";
import { CornerStyle, selectionPieces, snapToDevicePixel, styleSelectionRows } from "../editor/selectionGeometry";

const wordChar = (character: string): boolean => /[\p{L}\p{N}_]/u.test(character);

// --- Occurrence queries -------------------------------------------------------

{
  const doc = "The tracker records every tracker event. Trackers differ.";
  const caret = EditorState.create({ doc, selection: EditorSelection.cursor(doc.indexOf("tracker") + 2) });
  assert.deepEqual(occurrenceQueryForState(caret), { text: "tracker", wholeWord: true, matchCase: true },
    "a caret inside a word queries that whole word, case-sensitively");
  const start = doc.indexOf("tracker");
  const selected = EditorState.create({ doc, selection: EditorSelection.range(start, start + 7) });
  assert.deepEqual(occurrenceQueryForState(selected),
    { text: "tracker", wholeWord: false, matchCase: false, exclude: { from: start, to: start + 7 } },
    "a selection queries its text, case-insensitively, excluding itself");
  const space = EditorState.create({ doc: "a  b", selection: EditorSelection.cursor(2) });
  assert.equal(occurrenceQueryForState(space), null, "no word at the caret, no query");
  const multiline = EditorState.create({ doc: "one\ntwo", selection: EditorSelection.range(0, 5) });
  assert.equal(occurrenceQueryForState(multiline), null, "multi-line selections are not highlighted");
  const blank = EditorState.create({ doc: "a   b", selection: EditorSelection.range(1, 4) });
  assert.equal(occurrenceQueryForState(blank), null, "whitespace-only selections are not highlighted");
  const multiple = EditorState.create({
    doc: "word word",
    selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(6)]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  assert.equal(occurrenceQueryForState(multiple), null, "multiple cursors do not highlight");
}

assert.deepEqual(occurrenceQueryForCellText("the tracker cell", 6, 6), { text: "tracker", wholeWord: true, matchCase: true });
assert.deepEqual(occurrenceQueryForCellText("the tracker cell", 4, 11), { text: "tracker", wholeWord: false, matchCase: false, exclude: undefined });
assert.deepEqual(occurrenceQueryForCellText("a b", 1, 1), { text: "a", wholeWord: true, matchCase: true },
  "a caret at the end of a word still names that word, like VS Code");
assert.equal(occurrenceQueryForCellText("a  b", 2, 2), null, "a caret between spaces names no word");
assert.equal(occurrenceQueryForCellText("two\nlines", 0, 9), null);

// --- Matching -----------------------------------------------------------------

{
  const text = "tracker trackers Tracker tracker_x tracker.";
  const word = { text: "tracker", wholeWord: true, matchCase: true };
  assert.deepEqual(findOccurrences(text, word, wordChar), [0, 35], "whole words only, case-sensitive");
  const loose = { text: "tracker", wholeWord: false, matchCase: false };
  assert.deepEqual(findOccurrences(text, loose, wordChar), [0, 8, 17, 25, 35], "substring and case-insensitive");
  assert.deepEqual(findOccurrences(text, loose, wordChar, 100), [100, 108, 117, 125, 135], "offset is applied");
  assert.deepEqual(findOccurrences("aaaa", { text: "aa", wholeWord: false, matchCase: true }, wordChar), [0, 1, 2],
    "overlapping candidates are reported; the painter keeps them disjoint");
  assert.equal(findOccurrences("x ".repeat(5000), { text: "x", wholeWord: true, matchCase: true }, wordChar).length, 2000,
    "match count is bounded");
  // Case folding that changes length must not misalign ranges.
  assert.deepEqual(findOccurrences("İstanbul istanbul", { text: "istanbul", wholeWord: false, matchCase: false }, wordChar), [9]);
}

// --- Selected line segments (VS Code linesVisibleRangesForRange) ------------------

{
  // Offsets: ab[0..2], empty[3], cd[4..6], ef[7..9].
  const doc = "ab\n\ncd\nef";
  const state = EditorState.create({ doc });
  assert.deepEqual(selectedLineSegments(state, { from: 1, to: 7 }), [
    { from: 1, to: 2, lineFrom: 0, lineTo: 2, fromLineStart: false, continues: true },
    { from: 3, to: 3, lineFrom: 3, lineTo: 3, fromLineStart: true, continues: true },
    { from: 4, to: 6, lineFrom: 4, lineTo: 6, fromLineStart: true, continues: true },
    { from: 7, to: 7, lineFrom: 7, lineTo: 9, fromLineStart: true, continues: false },
  ], "every line is listed, including the zero-width line the selection ends on");
  assert.equal(selectedLineSegments(state, { from: 4, to: 6 }).at(-1)?.continues, false,
    "a selection ending at a line end does not select the line break");
  assert.deepEqual(selectedLineSegments(state, { from: 2, to: 2 }), [], "empty selections paint nothing");
  assert.deepEqual(selectedLineSegments(state, { from: 0, to: 9 }, { from: 4, to: 6 }).map(segment => segment.lineFrom), [4],
    "offscreen selected lines are not walked or measured");
  const withTable = EditorState.create({ doc: "x\n| A |\n| --- |\n| a |\ny" });
  assert.deepEqual(selectedLineSegments(withTable, { from: 0, to: withTable.doc.length }).map((segment) => segment.lineFrom),
    [0, withTable.doc.length - 1], "rendered table source is skipped");
}

// --- Corner styles and pieces (VS Code SelectionsOverlay) -----------------------

{
  const rows = [
    { left: 40, right: 120, top: 0, bottom: 19 },
    { left: 0, right: 200, top: 19, bottom: 38 },
    { left: 0, right: 60, top: 38, bottom: 57 },
  ];
  const styled = styleSelectionRows(rows, 2);
  const corners = styled.map((row) => [row.startTop, row.startBottom, row.endTop, row.endBottom]);
  assert.deepEqual(corners, [
    [CornerStyle.External, CornerStyle.Internal, CornerStyle.External, CornerStyle.Internal],
    [CornerStyle.External, CornerStyle.Flat, CornerStyle.External, CornerStyle.External],
    [CornerStyle.Flat, CornerStyle.External, CornerStyle.Internal, CornerStyle.External],
  ], "external, flat, and internal corners follow VS Code's rules");
  const pieces = selectionPieces(styled);
  const rowPieces = pieces.filter((piece) => piece.role === "row");
  assert.deepEqual(rowPieces.map((piece) => [piece.topLeft, piece.topRight, piece.bottomRight, piece.bottomLeft]), [
    [true, true, false, false],
    [true, true, true, false],
    [false, false, true, true],
  ], "only external corners are rounded");
  const fillets = pieces.filter((piece) => piece.role === "fillet");
  assert.deepEqual(fillets.map((piece) => [piece.kind, piece.left, piece.width, piece.top]), [
    ["selection", 37, 3, 0],
    ["selection", 120, 3, 0],
    ["selection", 60, 3, 38],
  ], "concave fillets sit just outside the stepped-in row");
  assert.ok(pieces.every(piece => piece.kind === "selection"), "fillets never erase block backgrounds or another selection");
  assert.deepEqual(fillets.map(piece => piece.clipPath?.trim()), [
    "M3 19H0A3 3 0 0 0 3 16Z",
    "M0 19H3A3 3 0 0 1 0 16Z",
    "M0 0H3A3 3 0 0 0 0 3Z",
  ], "only the concave sliver is filled, using a circular arc");
  assert.ok(selectionPieces(styled, false).every((piece) => piece.role === "row" &&
    !piece.topLeft && !piece.topRight && !piece.bottomLeft && !piece.bottomRight),
  "without rounding (high contrast) there are no fillets or rounded corners");
  const zeroWidthEnd = styleSelectionRows([
    { left: 0, right: 10, top: 0, bottom: 19 },
    { left: 0, right: 0, top: 19, bottom: 38 },
  ], 2);
  assert.equal(zeroWidthEnd[0].startBottom, CornerStyle.Flat, "a zero-width final row still shapes its neighbor");
  assert.equal(selectionPieces(zeroWidthEnd).filter((piece) => piece.role === "row").length, 1, "but paints nothing itself");
  const separated = styleSelectionRows([
    { left: 0, right: 50, top: 0, bottom: 19 },
    { left: 10, right: 50, top: 60, bottom: 79 },
  ], 2);
  assert.ok(separated.every((row) => row.startTop === CornerStyle.External && row.startBottom === CornerStyle.External),
    "rows that do not touch (across a table) do not affect each other");
  assert.equal(snapToDevicePixel(10.3, 1.25), 10.4);
  assert.equal(snapToDevicePixel(10.3, 1), 10);
  assert.equal(snapToDevicePixel(124.399999, 1.25), snapToDevicePixel(124.400001, 1.25),
    "equivalent half-pixel DOM coordinates snap consistently");
}

console.log("Selection painting geometry and occurrence highlighting tests passed");
