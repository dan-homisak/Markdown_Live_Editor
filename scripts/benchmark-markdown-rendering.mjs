#!/usr/bin/env node
// Pure CPU characterization. Run `npm.cmd run compile` before this script.
// There is deliberately no EditorView, DOM, input event, compositor or host sync.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Use the CJS dependency graph throughout, matching compiled production helpers.
const { EditorState } = require("@codemirror/state");
const { markdown } = require("@codemirror/lang-markdown");
const { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } = require("@codemirror/language");
const { classifyMarkdownMarkers, markdownParserExtensions } =
  require("../dist/editor/markdown/markdownSyntax.js");
const { getParsedTables } = require("../dist/shared/tableModel.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "qa", "markdown-rendering-cpu-baseline.json");
const counts = { localEdit: 160, structuralEdit: 40, selection: 100, viewport: 100 };
const windowLines = 60;
const round = value => Number(value.toFixed(4));
const digest = value => createHash("sha256").update(value).digest("hex");

function fixture(lineCount) {
  const lines = [];
  const longLine = "Long prose with emphasis *source* and Unicode café 界. ".repeat(45).slice(0, 2000);
  const block = [
    "## Section heading", "Paragraph text stays editable and preserves source.", "",
    "- [ ] An open task", "- [x] A complete task", "  - Nested ordinary item", "",
    "1. Ordered item", "2. Another ordered item", "", 
    "> Quoted content", "> - A quoted bullet", "", "---", "",
    "A [link](https://example.invalid/) with **strong** and ~~strike~~ text.", "",
    "- A plain bullet", "", "| Key | Value |", "| --- | --- |", "| A | B |", "",
    "Plain follow-up paragraph.", "", "```ts", "const literal = '[ ] task';", "```", "",
    "***", "", "![Literal image](./missing.png)", "", "- [X] Uppercase completed task", "",
    "Paragraph with `inline code`.", "", "- Another list item", "", "",
  ];
  for (let index = 0; index < lineCount; index++) {
    let text = block[index % block.length];
    // Replace only the prose slot, never a fence/table delimiter. Long lines
    // must not accidentally turn the remainder into an unterminated code block.
    if (index % 120 === 15) text = longLine;
    // Five-backtick fences span 120 lines, crossing both visible windows. Their
    // first character is the deliberate distant structural edit target.
    if (index % 1000 === 300 || index % 1000 === 420) text = "`````";
    lines.push(text);
  }
  return lines.join("\n");
}

function windowsFor(doc, index) {
  const startA = 1 + (index * 7919) % Math.max(1, doc.lines - windowLines + 1);
  const startB = 1 + (index * 3571 + Math.floor(doc.lines / 2)) % Math.max(1, doc.lines - windowLines + 1);
  const windows = [startA, startB].sort((a, b) => a - b).map(startLine => {
    const endLine = Math.min(doc.lines, startLine + windowLines - 1);
    return { from: doc.line(startLine).from, to: doc.line(endLine).to, startLine, endLine };
  });
  if (windows[1].from <= windows[0].to) {
    windows[0].to = Math.max(windows[0].to, windows[1].to);
    windows[0].endLine = Math.max(windows[0].endLine, windows[1].endLine);
    windows.pop();
  }
  return windows;
}

function converge(state) {
  const started = performance.now();
  let attempts = 0;
  let tree;
  do {
    tree = ensureSyntaxTree(state, state.doc.length, 25);
    attempts++;
    assert(performance.now() - started < 120_000, "Full parse failed to converge in 120 seconds");
  } while (!tree);
  // ensureSyntaxTree advances the parse context. Publish that completed tree
  // into the next CM state through the public transaction API, like forceParsing.
  if (syntaxTree(state) !== tree) state = state.update({}).state;
  assert.equal(syntaxTreeAvailable(state, state.doc.length), true);
  assert.equal(syntaxTree(state).length, state.doc.length);
  return { state, attempts, elapsedMs: performance.now() - started };
}

function summary(samples, field) {
  const values = samples.map(sample => sample[field]).sort((a, b) => a - b);
  const at = quantile => values[Math.max(0, Math.ceil(values.length * quantile) - 1)] ?? 0;
  return {
    count: values.length, p50Ms: round(at(0.5)), p95Ms: round(at(0.95)),
    maxMs: round(at(1)), totalMs: round(values.reduce((total, value) => total + value, 0)),
  };
}

function verifyMarkers(markers, windows, tables) {
  const lineBound = windows.reduce((sum, window) => sum + window.endLine - window.startLine + 1, 0);
  assert(markers.length <= 3 * lineBound, "Classifier output exceeded the visible-line marker bound");
  for (const marker of markers) {
    assert(windows.some(window => marker.from < window.to && marker.to > window.from));
    assert(!tables.some(table => marker.from < table.to && marker.to > table.from));
  }
}

function benchmark(source, enabled, operationCounts = counts) {
  const started = performance.now();
  let state = EditorState.create({
    doc: source,
    extensions: markdown(enabled ? { extensions: markdownParserExtensions } : {}),
  });
  const creationMs = performance.now() - started;
  const creationTreeLength = syntaxTree(state).length;
  const initial = converge(state);
  state = initial.state;
  let checkpoint = performance.now();
  let tables = getParsedTables(state.doc);
  const initialTableMs = performance.now() - checkpoint;
  const initialWindows = windowsFor(state.doc, 0);
  checkpoint = performance.now();
  const initialMarkers = enabled
    ? classifyMarkdownMarkers(state.doc, syntaxTree(state), tables, initialWindows) : [];
  const initialClassifierMs = performance.now() - checkpoint;
  verifyMarkers(initialMarkers, initialWindows, tables);
  const cold = {
    stateCreationMs: round(creationMs), treeLengthAfterCreation: creationTreeLength,
    fullDocumentLength: state.doc.length, parseConvergenceMs: round(initial.elapsedMs),
    convergenceAttempts: initial.attempts, tableScanMs: round(initialTableMs),
    classifierMs: round(initialClassifierMs), initialTableCount: tables.length,
    initialMarkerCount: initialMarkers.length,
    totalMeasuredCpuMs: round(creationMs + initial.elapsedMs + initialTableMs + initialClassifierMs),
  };
  const classes = {};
  let iteration = 0;
  for (const [kind, count] of Object.entries(operationCounts)) {
    const samples = [];
    for (let index = 0; index < count; index++, iteration++) {
      const previousState = state;
      const previousDoc = state.doc;
      const previousTree = syntaxTree(state);
      const previousTables = tables;
      const windows = windowsFor(state.doc, iteration);
      const startedSample = performance.now();
      checkpoint = startedSample;
      let convergenceAttempts = 0;
      let edit = null;
      if (kind === "localEdit" || kind === "structuralEdit") {
        const lineNumber = kind === "localEdit"
          ? 2 + (index * 37 % Math.floor((state.doc.lines - 2) / 40)) * 40
          : 301 + (Math.floor(index / 2) % Math.floor(state.doc.lines / 1000)) * 1000;
        const line = state.doc.line(lineNumber);
        const previous = state.doc.sliceString(line.from, line.from + 1);
        const insert = kind === "structuralEdit" ? (previous === "`" ? "~" : "`")
          : (previous === "P" ? "p" : "P");
        edit = { from: line.from, to: line.from + 1, insert, lineNumber };
        state = state.update({ changes: edit }).state;
        const completed = converge(state);
        state = completed.state;
        convergenceAttempts = completed.attempts;
      } else if (kind === "selection") {
        state = state.update({ selection: { anchor: windows[0].from } }).state;
      }
      const parserAndStateMs = performance.now() - checkpoint;
      checkpoint = performance.now();
      // This WeakMap is production getParsedTables: keyed by immutable Text,
      // never EditorState. Selection transactions therefore reuse the array.
      tables = getParsedTables(state.doc);
      const tableMs = performance.now() - checkpoint;
      checkpoint = performance.now();
      const markers = enabled
        ? classifyMarkdownMarkers(state.doc, syntaxTree(state), tables, windows) : [];
      const classifierMs = enabled ? performance.now() - checkpoint : 0;
      const totalMs = performance.now() - startedSample;
      const documentIdentityPreserved = state.doc === previousDoc;
      const stateIdentityPreserved = state === previousState;
      const treeIdentityPreserved = syntaxTree(state) === previousTree;
      const tableCacheHit = tables === previousTables;
      if (kind === "selection" || kind === "viewport") {
        assert(documentIdentityPreserved && treeIdentityPreserved && tableCacheHit,
          `${kind} invalidated the immutable document, completed tree, or table cache`);
        assert.equal(stateIdentityPreserved, kind === "viewport");
      } else {
        assert(!documentIdentityPreserved && !tableCacheHit);
      }
      assert(syntaxTreeAvailable(state, state.doc.length));
      verifyMarkers(markers, windows, tables);
      samples.push({
        index, parserAndStateMs, tableMs, classifierMs, totalMs,
        convergenceAttempts, markerCount: markers.length, tableCount: tables.length,
        documentIdentityPreserved, stateIdentityPreserved, treeIdentityPreserved,
        tableCacheHit, visibleWindows: windows, edit,
      });
    }
    classes[kind] = {
      parserAndState: summary(samples, "parserAndStateMs"),
      tableBaseline: summary(samples, "tableMs"),
      addedClassifier: summary(samples, "classifierMs"),
      total: summary(samples, "totalMs"),
      markerCount: { min: Math.min(...samples.map(sample => sample.markerCount)),
        max: Math.max(...samples.map(sample => sample.markerCount)) },
      tableCacheHits: samples.filter(sample => sample.tableCacheHit).length,
      samples: samples.map(sample => Object.fromEntries(Object.entries(sample).map(([key, value]) =>
        [key, key.endsWith("Ms") ? round(value) : value]))),
    };
  }
  return { mode: enabled ? "configured-parser-plus-classifier" : "commonmark-parser-no-rendering",
    cold, classes, elapsedIncludingVerificationMs: round(performance.now() - started),
    finalSourceSha256: digest(state.doc.toString()) };
}

const dependencies = {};
for (const name of ["@codemirror/state", "@codemirror/lang-markdown", "@codemirror/language", "@lezer/markdown", "@lezer/common"]) {
  dependencies[name] = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8")).version;
}
const artifacts = {};
for (const name of ["package-lock.json", "dist/editor/markdown/markdownSyntax.js", "dist/shared/tableModel.js", "scripts/benchmark-markdown-rendering.mjs"]) {
  artifacts[name] = digest(await readFile(path.join(root, name)));
}
console.log("Warming pure parser/table/classifier CPU paths (no DOM or paint measurements).");
for (const enabled of [false, true]) {
  benchmark(fixture(2000), enabled, { localEdit: 20, structuralEdit: 4, selection: 10, viewport: 10 });
}
const result = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  status: "CPU baseline only; not an input-to-paint or release performance gate",
  reproduction: "npm.cmd run compile && node scripts/benchmark-markdown-rendering.mjs",
  environment: { node: process.version, platform: process.platform, architecture: process.arch,
    cpuModel: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(), dependencies },
  artifactSha256: artifacts,
  methodology: {
    fixtures: "Deterministic 10,000/100,000 lines; mixed tables/tasks/lists; 2,000-character prose lines every 120 lines; five-backtick fenced regions spanning 120 lines every 1,000 lines.",
    operationCounts: counts,
    parsing: "CM state creation/transactions plus ensureSyntaxTree(state, doc.length, 25) until fully converged; publish completed context via state.update({}) if needed. Edits include all deferred full parse CPU work. Selection and viewport operations never call ensureSyntaxTree or standalone parser.",
    modes: "Paired commonmark() baseline and markdown({extensions: markdownParserExtensions}) plus pure classifier. Table parsing is measured separately in both. Mode differences are sequential-run characterization, not controlled end-to-end performance deltas.",
    cacheIdentity: "Production getParsedTables WeakMap keys the immutable CodeMirror Text object, not EditorState. Every selection transaction is asserted to produce a new state while preserving Text, completed tree and cached table-array identity. Viewport classifications retain the same state.",
    windows: "Up to two nonoverlapping windows of 60 source lines; starts 1+(i*7919)%(lines-59), 1+(i*3571+floor(lines/2))%(lines-59); overlapping windows merged. Exact UTF-16/line windows recorded per sample. This is viewport CPU simulation, not rendered scroll.",
    classifier: "Calls compiled classifyMarkdownMarkers(Text, completedTree, cachedTables, visibleWindows); no whole-document string conversion in selection/viewport classifier path. Protected-range exclusion still scans the cached whole-document table array per visible marker. Selection benchmark conservatively reclassifies windows though production may retain classifications.",
    statistics: "Nearest-rank p50/p95/max in milliseconds; total is per-class sum. Timed totals include parser/state, table lookup/scan and classifier. Fixture/window generation, assertions and sample storage are outside operation timing.",
    warmup: "Separate 2,000-line fixture per mode: 20 local edits, 4 structural edits, 10 selections, 10 viewport updates. Cold values are new fixture initialization in this warmed process.",
    markerBound: "Every output marker must overlap a recorded visible window, avoid all recognized table ranges and remain below three markers per visible source line. These are output bounds, not DOM/cache-memory measurements.",
    exclusions: ["EditorView/plugin/widget creation", "geometry measurement", "layout/paint/input-to-next-paint", "actual focus/scroll/theme/IME events", "VS Code host synchronization and full-text message claims", "host undo", "retained DOM/cache/heap stability after repeated theme cycles"],
    releaseInterpretation: "Cannot establish <=8/16ms added rendering or <=16ms paint budgets; those require same-workbench on/off measurements including scheduled view work. Full-snapshot table scans are an existing baseline cost reported without hiding them.",
  },
  fixtures: [],
};
for (const lineCount of [10_000, 100_000]) {
  const source = fixture(lineCount);
  console.log(`Benchmarking ${lineCount.toLocaleString("en-US")} lines (${source.length.toLocaleString("en-US")} UTF-16 code units).`);
  const baseline = benchmark(source, false);
  const enabled = benchmark(source, true);
  assert.equal(baseline.finalSourceSha256, enabled.finalSourceSha256);
  result.fixtures.push({ lineCount, utf16Length: source.length, sourceSha256: digest(source), baseline, enabled });
  for (const [kind, value] of Object.entries(enabled.classes)) {
    console.log(`${lineCount} ${kind}: p95 parser=${value.parserAndState.p95Ms}ms table=${value.tableBaseline.p95Ms}ms classifier=${value.addedClassifier.p95Ms}ms total=${value.total.p95Ms}ms markers<=${value.markerCount.max}`);
  }
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Saved ${path.relative(root, output)}. Pure CPU characterization; release performance gates remain unmeasured.`);
