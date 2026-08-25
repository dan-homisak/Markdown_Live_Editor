#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixturePath = path.join(repoRoot, "GutterStressTest.md");
const targetHeaderLine = 9_995;
const startMarker = "<!-- GUTTER-FIVE-DIGIT-START -->";
const endMarker = "<!-- GUTTER-FIVE-DIGIT-END -->";
const oldEndHeading = "## Part 9 — End-of-file boundary";
const newEndHeading = "## Part 10 — End-of-file boundary";

let source = readFileSync(fixturePath, "utf8")
  .replace(/^\uFEFF/, "")
  .replace(/\r\n?/g, "\n")
  .replace(/\n$/, "");

// Idempotently remove a previously generated section before recalibrating.
const generatedStart = source.indexOf(startMarker);
if (generatedStart >= 0) {
  const generatedEnd = source.indexOf(endMarker, generatedStart);
  if (generatedEnd < 0) {
    throw new Error(`Found ${startMarker} without ${endMarker}.`);
  }
  source = [
    source.slice(0, generatedStart).replace(/\n+$/, ""),
    source.slice(generatedEnd + endMarker.length).replace(/^\n+/, ""),
  ].join("\n\n");
}
source = source.replace(newEndHeading, oldEndHeading);

const lines = source.split("\n");
const endHeadingIndex = lines.indexOf(oldEndHeading);
if (endHeadingIndex < 0) {
  throw new Error(`Could not find ${JSON.stringify(oldEndHeading)}.`);
}

const head = lines.slice(0, endHeadingIndex);
const tail = lines.slice(endHeadingIndex);
tail[0] = newEndHeading;
const sectionPrefix = [
  startMarker,
  "## Part 9 — Five-digit gutter and virtualization boundary",
  "",
  "This generated ramp forces both native and table-owned gutter numbers through 9,999/10,000. Its varied prose widths also keep CodeMirror's off-screen height map active during large scroll jumps.",
  "",
];
const tableLines = [
  "<!-- GUTTER-RENDERED-CASE: GB9995 -->",
  "| [GB9995] Row | Five-digit boundary role |",
  "| ---: | --- |",
  "| 1 | source line 9997 |",
  "| 2 | source line 9998 |",
  "| 3 | source line 9999 |",
  "| 4 | source line 10000 |",
  "GB9995-AFTER: the first prose gutter number after the table must be 10001.",
  "",
  endMarker,
];

// Header line = existing head + prefix + generated filler + case comment + 1.
const fillerCount =
  targetHeaderLine - head.length - sectionPrefix.length - 2;
if (fillerCount <= 0) {
  throw new Error("Fixture is already too long to calibrate line 9995.");
}
const filler = Array.from({ length: fillerCount }, (_value, index) => {
  const sourceLine = head.length + sectionPrefix.length + index + 1;
  const variants = [
    "short.",
    "medium-width prose 0123456789.",
    "Unicode café 中文 العربية 😀.",
    "long prose that wraps repeatedly in narrow editors while retaining one native source-line gutter entry.",
  ];
  return `FIVE-DIGIT-RAMP-${String(sourceLine).padStart(5, "0")}: ${variants[index % variants.length]}`;
});

const outputLines = [
  ...head,
  ...sectionPrefix,
  ...filler,
  ...tableLines,
  "",
  ...tail,
];
const headerLine =
  outputLines.findIndex((line) => line.startsWith("| [GB9995]")) + 1;
if (headerLine !== targetHeaderLine) {
  throw new Error(
    `Five-digit table calibration failed: expected ${targetHeaderLine}, got ${headerLine}.`,
  );
}
if (outputLines[9_999] !== "| 4 | source line 10000 |") {
  throw new Error("Five-digit table does not own source line 10000.");
}

writeFileSync(fixturePath, outputLines.join("\n"), "utf8");
console.log(
  `Generated ${path.basename(fixturePath)} with ${outputLines.length} lines; GB9995 starts at ${headerLine}.`,
);
