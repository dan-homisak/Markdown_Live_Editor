import assert from "node:assert/strict";
import {
  lineCharacterAtNormalizedOffset,
  mapNormalizedDocumentChangesToHost,
} from "../shared/documentChangeMapping";

// --- Offsets to lines and columns ----------------------------------------------------

{
  const text = "one\ntwo\n\nfour";
  const at = (offset: number): string => {
    const position = lineCharacterAtNormalizedOffset(text, offset);
    return `${position.line}:${position.character}`;
  };
  assert.deepEqual([0, 3, 4, 7, 8, 9, 13].map(at), ["0:0", "0:3", "1:0", "1:3", "2:0", "3:0", "3:4"]);
  assert.equal(at(-5), "0:0", "an offset before the text is its start");
  assert.equal(at(99), "3:4", "an offset past the text is its end");
}

// Every change is mapped to the same place whether it is mapped alone or with others.
{
  const lines = Array.from({ length: 200 }, (_, index) => "x".repeat(index % 17));
  const text = lines.join("\n");
  const changes = Array.from({ length: text.length + 1 }, (_, offset) => ({ from: offset, to: Math.min(text.length, offset + (offset % 5)), text: "" }));
  const together = mapNormalizedDocumentChangesToHost(text, changes);
  changes.forEach((change, index) => {
    assert.deepEqual(together[index].from, lineCharacterAtNormalizedOffset(text, change.from));
    assert.deepEqual(together[index].to, lineCharacterAtNormalizedOffset(text, change.to));
  });
}

// A document that uses CRLF is addressed by line and column, and inserted text takes its line endings.
{
  const host = "one\r\ntwo\r\nthree";
  const [change] = mapNormalizedDocumentChangesToHost(host, [{ from: 4, to: 7, text: "2\n2" }]);
  assert.deepEqual(change, { from: { line: 1, character: 0 }, to: { line: 1, character: 3 }, text: "2\r\n2" });
  const [lf] = mapNormalizedDocumentChangesToHost("one\ntwo", [{ from: 4, to: 7, text: "2\r\n2" }]);
  assert.equal(lf.text, "2\n2");
}

// One edit can carry thousands of changes: a replace all, or typing at many
// cursors. Mapping them must not read the document once per change.
{
  const line = "Line mentions the tracker among other ordinary words.";
  const text = Array.from({ length: 20000 }, () => line).join("\n");
  const changes = Array.from({ length: 20000 }, (_, index) => {
    const from = index * (line.length + 1) + line.indexOf("tracker");
    return { from, to: from + 7, text: "t" };
  });
  const started = performance.now();
  const mapped = mapNormalizedDocumentChangesToHost(text, changes);
  const elapsed = performance.now() - started;
  assert.equal(mapped.length, 20000);
  assert.deepEqual(mapped[19999], { from: { line: 19999, character: 18 }, to: { line: 19999, character: 25 }, text: "t" });
  assert.ok(elapsed < 2000, `20,000 changes in a megabyte of text are mapped in ${Math.round(elapsed)} ms, not once through the text for each`);
}

console.log("documentChangeMapping tests passed");
