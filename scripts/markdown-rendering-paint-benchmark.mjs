// Called by the isolated Electron release harness after its UI gates pass.
// Timings are measured inside the real webview, never in a standalone DOM.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const counts = { localEdit: 160, structuralEdit: 40, selection: 100, scroll: 100 };
const round = value => Number(value.toFixed(3));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function markdownPaintFixture(lineCount) {
  const block = [
    "## Section heading", "Paragraph text stays editable and preserves source.", "",
    "- [ ] An open task", "- [x] A complete task", "  - Nested ordinary item", "",
    "1. Ordered item", "2. Another ordered item", "", "> [!NOTE]", "> - A quoted bullet", "", "---", "",
    "A [link](https://example.invalid/) with **strong** and ~~strike~~ text.", "",
    "- A plain bullet", "", "| Key | Value |", "| --- | --- |", "| A | B |", "",
    "Plain follow-up paragraph.", "", "```ts", "const literal = '[ ] task';", "```", "",
    "***", "", "![Literal image](./missing.png)", "", "- [X] Uppercase completed task", "",
    "Paragraph with `inline code`.", "", "- Another list item", "", "",
  ];
  const longLine = "Long prose with emphasis *source* and Unicode café 界. ".repeat(45).slice(0, 2000);
  const languages = ["ts", "js", "json", "sh", "py", "yaml"];
  const bodies = ["const value: number = 42", "const value = 42", '{"value":42,"ready":true}',
    'if true; then echo "ready"; fi', "value = 42 # ready", "value: 42"];
  return Array.from({ length: lineCount }, (_, index) => {
    let value = block[index % block.length];
    const language = Math.floor(index / block.length) % languages.length;
    if (index % block.length === 25) value = "```" + languages[language];
    if (index % block.length === 26) value = bodies[language];
    if (index < 5) value = ["---", "release: true", "language: yaml", "---", ""][index];
    if (index % 120 === 15) value = longLine;
    if (index % 1000 === 300 || index % 1000 === 420) value = "`````";
    return value;
  }).join("\n");
}

function summarize(samples, field) {
  const values = samples.map(sample => sample[field]).filter(Number.isFinite).sort((a, b) => a - b);
  const at = quantile => values[Math.max(0, Math.ceil(values.length * quantile) - 1)] ?? 0;
  return { count: values.length, p50Ms: round(at(0.5)), p95Ms: round(at(0.95)), maxMs: round(at(1)),
    totalMs: round(values.reduce((sum, value) => sum + value, 0)) };
}

// Serialized into the webview by liveEval, whose lexical locals are root/win/view.
function initializeBrowserMetrics(context) {
  const clock = () => win.performance.now();
  const status = () => {
    const result = win.__MLRT_TEST_MARKDOWN_PARSE__?.();
    if (!result) throw new Error("Debug parser-status hook is unavailable");
    return result;
  };
  const paint = () => new Promise(resolve => {
    view.requestMeasure({
      read: () => clock(),
      // Plugin measurement writes can enqueue microtask dispatches. Two frames
      // give those updates a layout/paint opportunity before resolving.
      write: measuredAt => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve({ measuredAt, paintedAt: clock() }))),
    });
  });
  const convergence = async () => {
    const began = clock();
    let attempts = 0;
    while (!status().fullReady) {
      win.__MLRT_TEST_MARKDOWN_PARSE__(true);
      attempts++;
      if (clock() - began > 7000) throw new Error("Full parser convergence exceeded the 7-second sample budget");
      await new Promise(resolve => win.requestAnimationFrame(resolve));
    }
    if (attempts) await paint();
    return { forcedSlices: attempts, elapsedMs: clock() - began, status: status() };
  };
  const snapshot = () => {
    const windows = view.visibleRanges.map(range => ({ from: range.from, to: range.to,
      firstLine: view.state.doc.lineAt(range.from).number, lastLine: view.state.doc.lineAt(range.to).number }));
    const visibleLineBound = windows.reduce((sum, window) => sum + window.lastLine - window.firstLine + 1, 0);
    const taskControls = view.dom.querySelectorAll(".mlrt-markdown-task-control").length;
    if (taskControls > visibleLineBound) throw new Error("Task controls exceeded one per visible source line");
    // Test-only reflection of the instantiated production plugins, matching
    // the release harness's lifecycle checks. No production extension changes.
    const values = view.plugins.map(instance => instance.value).filter(Boolean);
    const markers = values.find(value => Array.isArray(value.markers) && value.sizes && typeof value.sizes.size === "number");
    const markerProjection = markers ? { classifiedMarkers: markers.markers.length,
      measuredMarkerCache: markers.sizes.size, decorationRanges: markers.decorations.size, failed: markers.failed } : null;
    if (markerProjection && (markerProjection.failed || markerProjection.measuredMarkerCache > markerProjection.classifiedMarkers ||
        markerProjection.decorationRanges > 2 * markerProjection.classifiedMarkers))
      throw new Error("Marker failure or cache/decorations escaped the currently classified marker bound");
    const style = win.getComputedStyle(view.contentDOM);
    return { windows, visibleLineBound, taskControls,
      textMetrics: { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing, contentWidth: view.contentDOM.clientWidth, devicePixelRatio: win.devicePixelRatio },
      markerProjection,
      decorationSets: values.filter(value => value.decorations && typeof value.decorations.size === "number")
        .map(value => ({ owner: value.constructor.name, ranges: value.decorations.size })),
      markerSpans: view.dom.querySelectorAll(".mlrt-markdown-marker").length,
      renderedTables: view.dom.querySelectorAll(".mlrt-table").length,
      renderedTableWrappers: view.dom.querySelectorAll(".mlrt-table-widget").length,
      renderedSourceLines: view.dom.querySelectorAll(".cm-line").length,
      totalDomElements: view.dom.querySelectorAll("*").length,
      heapUsedBytes: win.performance.memory?.usedJSHeapSize ?? null,
      heapTotalBytes: win.performance.memory?.totalJSHeapSize ?? null,
      parse: status(), scrollTop: view.scrollDOM.scrollTop };
  };
  const originalDocument = view.state.doc;
  let metricObserver = null, metricPromise = null;
  win.__MLRT_PAINT_METRICS__ = {
    paint, convergence, snapshot,
    async batch(kind, start, count) {
      const samples = [];
      for (let index = start; index < start + count; index++) {
        win.__MLRT_PAINT_PHASE__ = { ...context, kind, index, step: "dispatch" };
        const beforeDocument = view.state.doc, beforeState = view.state;
        let edit = null, lineNumber = null;
        const began = clock();
        if (kind === "localEdit" || kind === "structuralEdit") {
          lineNumber = kind === "localEdit" ? 42
            : 301 + (Math.floor(index / 2) % Math.floor(view.state.doc.lines / 1000)) * 1000;
          const line = view.state.doc.line(lineNumber);
          const previous = view.state.doc.sliceString(line.from, line.from + 1);
          const insert = kind === "localEdit" ? (previous === "P" ? "p" : "P") : (previous === "`" ? "~" : "`");
          edit = { from: line.from, to: line.from + 1, insert };
          view.dispatch({ changes: edit, userEvent: "input.type" });
        } else if (kind === "selection") {
          const line = view.state.doc.line(42);
          view.dispatch({ selection: { anchor: line.from + (index % (line.length + 1)) } });
          view.focus();
        } else if (kind === "scroll") {
          lineNumber = 1 + (index * 7919) % (view.state.doc.lines - 60);
          view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(lineNumber).from).top;
        } else throw new Error(`Unknown measurement class ${kind}`);
        const synchronousDispatchMs = clock() - began;
        const painted = await paint();
        const firstPaintOpportunityMs = painted.paintedAt - began;
        const statusAtFirstPaint = status();
        win.__MLRT_PAINT_PHASE__ = { ...context, kind, index, step: "forcedConvergence" };
        const converged = await convergence();
        const totalThroughForcedConvergenceMs = clock() - began;
        const projection = snapshot();
        // Isolated requests deliberately receive no acknowledgements. Clear
        // their retained full-text echoes between samples so the stress run
        // does not manufacture a 100-snapshot host backlog and heap pressure.
        // Posting/string construction remains included in the measured edit.
        win.__MLRT_TEST_SET_HOST_ISOLATION__(true);
        const documentIdentityPreserved = beforeDocument === view.state.doc;
        if ((kind === "selection" || kind === "scroll") && !documentIdentityPreserved)
          throw new Error(`${kind} changed immutable source identity`);
        samples.push({ index, lineNumber, edit, synchronousDispatchMs, firstPaintOpportunityMs,
          measurementReadMs: painted.measuredAt - began,
          deferredForcedConvergenceMs: converged.elapsedMs, forcedParseSlices: converged.forcedSlices,
          totalThroughForcedConvergenceMs, statusAtFirstPaint,
          documentIdentityPreserved, stateIdentityPreserved: beforeState === view.state,
          projection });
      }
      return samples;
    },
    sourceRestored() { return originalDocument.toString() === view.state.doc.toString(); },
    beginMetric() {
      metricObserver?.disconnect();
      metricPromise = new Promise(resolve => {
        metricObserver = new win.MutationObserver(() => {
          metricObserver.disconnect();
          const began = clock();
          paint().then(result => resolve({ mutationToPaintOpportunityMs: result.paintedAt - began }));
        });
        for (const target of [root.documentElement, root.body])
          metricObserver.observe(target, { attributes: true, attributeFilter: ["class", "style"] });
      });
    },
    async finishMetric() {
      const timing = await Promise.race([metricPromise, new Promise(resolve => win.setTimeout(() => resolve(null), 1000))]);
      metricObserver?.disconnect();
      return { timing, projection: snapshot(), sourcePreserved: this.sourceRestored() };
    },
    async acknowledgedEdit(index) {
      if (win.__MLRT_TEST_HOST_ISOLATED__) throw new Error("Acknowledgement sample requires the real host bridge");
      const line = view.state.doc.line(2), from = line.from;
      const original = originalDocument.sliceString(from, from + 1);
      const insert = index % 2 ? original : (original === "t" ? "T" : "t");
      let expectedText = "";
      const began = clock();
      let listener;
      const acknowledgement = new Promise((resolve, reject) => {
        const timer = win.setTimeout(() => { win.removeEventListener("message", listener); reject(new Error("Real host acknowledgement timed out")); }, 5000);
        listener = event => {
          if (event.data?.type === "setDocument" && event.data.source === "webviewAck" && event.data.text === expectedText) {
            win.clearTimeout(timer); win.removeEventListener("message", listener);
            resolve({ acknowledgementMs: clock() - began, revision: event.data.revision });
          }
        };
        win.addEventListener("message", listener);
      });
      view.dispatch({ changes: { from, to: from + 1, insert }, userEvent: "input.type" });
      expectedText = view.state.doc.toString();
      const ack = await acknowledgement;
      const painted = await paint();
      return { index, ...ack, throughAcknowledgementPaintMs: painted.paintedAt - began };
    },
    destroy() { metricObserver?.disconnect(); delete win.__MLRT_PAINT_METRICS__; },
  };
  return { initial: snapshot(), clockTimeOrigin: win.performance.timeOrigin };
}

function installWarningCapture() {
  win.__MLRT_PAINT_WARNINGS__ = [];
  win.__MLRT_PAINT_PHASE__ = { kind: "initialize" };
  const originalWarn = win.console.warn;
  win.__MLRT_PAINT_RESTORE_WARN__ = () => { win.console.warn = originalWarn; delete win.__MLRT_PAINT_RESTORE_WARN__; };
  win.console.warn = function (...args) {
    try {
      const currentView = win.__MLRT_EDITOR_VIEW__;
      const marker = currentView?.plugins.map(instance => instance.value)
        .find(value => value && Array.isArray(value.markers) && value.sizes);
      win.__MLRT_PAINT_WARNINGS__.push({ text: args.map(value => String(value)).join(" "),
        phase: { ...win.__MLRT_PAINT_PHASE__ }, timestamp: win.performance.now(), timeOrigin: win.performance.timeOrigin,
        stack: new Error("Measurement warning attribution").stack,
        parse: win.__MLRT_TEST_MARKDOWN_PARSE__?.(), viewport: currentView?.viewport,
        visibleRanges: currentView?.visibleRanges,
        pendingMeasureKeys: currentView?.measureRequests?.map(request => request.key?.constructor?.name ?? "unkeyed"),
        measureScheduled: currentView?.measureScheduled, measuringViewport: currentView?.viewState?.viewport,
        scrollTop: currentView?.scrollDOM.scrollTop,
        markers: marker ? { classified: marker.markers.length, measured: marker.sizes.size,
          decorations: marker.decorations.size, failed: marker.failed } : null });
    } catch { /* diagnostic collection must not change console behavior */ }
    originalWarn.apply(win.console, args);
  };
  return true;
}

/** The callbacks operate only on the release harness's isolated fixture/profile. */
export async function runMarkdownPaintMetrics({ liveEval, writeFixture, writeSettings, select, text, diagnosticOnly = false }) {
  const operationCounts = diagnosticOnly ? { scroll: 100 } : counts;
  const report = { measurement: "Real Electron webview transaction-to-paint-opportunity proxy",
    generatedAt: new Date().toISOString(), diagnosticOnly, counts: operationCounts, batchSize: 5,
    fixtures: [], acknowledgedEdits: null, warnings: [], lastPhase: null,
    limitations: [
      "Programmatic source transactions and scrolls are not hardware input-to-photon timings; two requestAnimationFrame callbacks establish a paint opportunity, not compositor presentation.",
      "Large-fixture samples isolate host mutation posting; parsing, production table scanning, projection, CodeMirror measurement and browser layout remain active.",
      "Suppressed host-echo/undo-focus queues are cleared between timed samples; otherwise missing acknowledgements would artificially retain up to100 full source strings.",
      "First-paint timings use normal viewport work. Separately reported full convergence explicitly drives 25ms forceParsing slices, including mounted language trees, and is not the normal lazy parsing schedule.",
      "Fixture reload wall time includes disk/host delivery and the harness's fixed 250ms settling delay; it is not a cold VS Code process startup measurement.",
      "Heap snapshots use performance.memory when available, without forced GC; retained-memory deltas are observations, not leak proof.",
      "Debug event buffers remain active. DOM/cache counts are reported independently from total renderer heap, which includes parser history, debug buffers and uncollected allocations.",
      "Paired enabled/off order is fixed, so warm caches and system scheduling can affect ratios. No CPU benchmark runs concurrently.",
    ] };
  async function restoreHost() {
    await liveEval("win.__MLRT_TEST_SET_HOST_ISOLATION__(false);return true;");
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await liveEval("return !win.__MLRT_TEST_HOST_RESYNC_PENDING__;")) return;
      await pause(50);
    }
    throw new Error("Host resynchronization did not settle after performance isolation");
  }
  const phase = value => liveEval(`win.__MLRT_PAINT_PHASE__=${JSON.stringify(value)};return true;`);
  try {
    await liveEval(`return (${installWarningCapture.toString()})();`);
    for (const lineCount of [10000, 100000]) {
      const source = markdownPaintFixture(lineCount);
      for (const enabled of [false, true]) {
        await phase({ lineCount, enabled, kind: "restoreHost" });
        await restoreHost();
        await phase({ lineCount, enabled, kind: "modeSettings" });
        await writeSettings({ "markdownLiveRenderTables.markdownRendering.enabled": enabled,
          "workbench.colorTheme": "Default Dark Modern" });
        await phase({ lineCount, enabled, kind: "fixtureReload" });
        const reloadBegan = performance.now();
        await writeFixture(source);
        const fixtureReloadWallMs = performance.now() - reloadBegan;
        await phase({ lineCount, enabled, kind: "initialCaret" });
        await select(source.split("\n").slice(0, 41).join("\n").length + 1);
        await liveEval("win.__MLRT_TEST_SET_HOST_ISOLATION__(true);return true;");
        const initialized = await liveEval(`return (${initializeBrowserMetrics.toString()})(${JSON.stringify({ lineCount, enabled })});`);
        await phase({ lineCount, enabled, kind: "initialFullConvergence" });
        const cold = await liveEval("return win.__MLRT_PAINT_METRICS__.convergence();");
        const fixtureReloadThroughFullConvergenceWallMs = performance.now() - reloadBegan;
        const result = { lineCount, enabled, sourceLength: source.length,
          sourceSha256: createHash("sha256").update(source).digest("hex"),
          fixtureReloadWallMs: round(fixtureReloadWallMs),
          fixtureReloadThroughFullConvergenceWallMs: round(fixtureReloadThroughFullConvergenceWallMs), initial: initialized.initial,
          forcedInitialFullConvergence: cold, classes: {}, metricCycles: [], fontMetricCycles: [] };
        for (const [kind, count] of Object.entries(operationCounts)) {
          const samples = [];
          for (let start = 0; start < count; start += 5)
            samples.push(...await liveEval(`return win.__MLRT_PAINT_METRICS__.batch(${JSON.stringify(kind)},${start},${Math.min(5, count - start)});`));
          assert.equal(samples.length, count);
          result.classes[kind] = { synchronousDispatch: summarize(samples, "synchronousDispatchMs"),
            firstPaintOpportunity: summarize(samples, "firstPaintOpportunityMs"),
            deferredForcedConvergence: summarize(samples, "deferredForcedConvergenceMs"),
            totalThroughForcedConvergence: summarize(samples, "totalThroughForcedConvergenceMs"),
            maxTaskControls: Math.max(...samples.map(sample => sample.projection.taskControls)),
            maxClassifiedMarkers: Math.max(...samples.map(sample => sample.projection.markerProjection?.classifiedMarkers ?? 0)),
            maxMarkerMeasurementCache: Math.max(...samples.map(sample => sample.projection.markerProjection?.measuredMarkerCache ?? 0)),
            maxMarkerDecorationRanges: Math.max(...samples.map(sample => sample.projection.markerProjection?.decorationRanges ?? 0)),
            maxDomElements: Math.max(...samples.map(sample => sample.projection.totalDomElements)), samples };
          console.log(`PAINT ${lineCount} ${enabled ? "enabled" : "disabled"} ${kind}`, JSON.stringify(result.classes[kind].firstPaintOpportunity));
        }
        assert(await liveEval("return win.__MLRT_PAINT_METRICS__.sourceRestored();"), "paired benchmark edits must restore exact source");
        if (enabled) assert(Object.values(result.classes).some(value => value.maxTaskControls > 0),
          "enabled stress samples must actually include rendered task controls");
        result.afterOperations = await liveEval("return win.__MLRT_PAINT_METRICS__.snapshot();");
        const themes = ["Default Light Modern", "Default High Contrast", "Default High Contrast Light", "Default Dark Modern"];
        for (let cycle = 0; cycle < 8; cycle++) {
          await phase({ lineCount, enabled, kind: "theme", index: cycle, theme: themes[cycle % themes.length] });
          await liveEval("win.__MLRT_PAINT_METRICS__.beginMetric();return true;");
          await writeSettings({ "markdownLiveRenderTables.markdownRendering.enabled": enabled, "workbench.colorTheme": themes[cycle % themes.length] });
          const metric = await liveEval("return win.__MLRT_PAINT_METRICS__.finishMetric();");
          assert(metric.sourcePreserved, "theme cycle changed source");
          result.metricCycles.push({ cycle, theme: themes[cycle % themes.length], ...metric });
        }
        const metricSettings = [
          { "editor.fontSize": 20, "editor.lineHeight": 30, "editor.letterSpacing": 1 },
          { "editor.fontSize": 14, "editor.lineHeight": 0, "editor.letterSpacing": 0 },
        ];
        for (const [index, settings] of metricSettings.entries()) {
          await phase({ lineCount, enabled, kind: "fontGeometry", index, settings });
          await liveEval("win.__MLRT_PAINT_METRICS__.beginMetric();return true;");
          await writeSettings({ "markdownLiveRenderTables.markdownRendering.enabled": enabled,
            "workbench.colorTheme": "Default Dark Modern", ...settings });
          const metric = await liveEval("return win.__MLRT_PAINT_METRICS__.finishMetric();");
          assert(metric.sourcePreserved, "font metric cycle changed source");
          result.fontMetricCycles.push({ settings, ...metric });
        }
        assert.notEqual(result.fontMetricCycles[0].projection.textMetrics.fontSize,
          result.fontMetricCycles[1].projection.textMetrics.fontSize, "font metric cycles must change actual rendered font size");
        result.afterMetricCycles = await liveEval("return win.__MLRT_PAINT_METRICS__.snapshot();");
        await liveEval("win.__MLRT_PAINT_METRICS__.destroy();return true;");
        report.fixtures.push(result);
      }
    }
    if (diagnosticOnly) return report;
    await phase({ kind: "acknowledgementSetup" });
    await restoreHost();
    await writeSettings({ "markdownLiveRenderTables.markdownRendering.enabled": true });
    // A small explicit host-integrated class complements the isolated stress
    // samples without pretending the 100k cases include extension-host IPC.
    await writeFixture(text);
    await select(text.indexOf("\n") + 1);
    await liveEval(`return (${initializeBrowserMetrics.toString()})({kind:"realHostAcknowledgement",enabled:true});`);
    const hostSamples = [];
    for (let index = 0; index < 20; index++) {
      await phase({ kind: "realHostAcknowledgement", enabled: true, index });
      hostSamples.push(await liveEval(`return win.__MLRT_PAINT_METRICS__.acknowledgedEdit(${index});`));
    }
    assert(await liveEval("return win.__MLRT_PAINT_METRICS__.sourceRestored();"), "host-ack edit pairs must restore source");
    report.acknowledgedEdits = { acknowledgement: summarize(hostSamples, "acknowledgementMs"),
      throughAcknowledgementPaint: summarize(hostSamples, "throughAcknowledgementPaintMs"), samples: hostSamples };
    await liveEval("win.__MLRT_PAINT_METRICS__.destroy();return true;");
    return report;
  } finally {
    report.lastPhase = await liveEval("return win.__MLRT_PAINT_PHASE__;").catch(() => null);
    await phase({ kind: "cleanup" }).catch(() => {});
    await liveEval("win.__MLRT_PAINT_METRICS__?.destroy();return true;").catch(() => {});
    try {
      await restoreHost();
      await writeFixture(text);
      await writeSettings();
      await select(0);
    } finally {
      report.warnings = await liveEval("return win.__MLRT_PAINT_WARNINGS__ ?? [];").catch(() => []);
      await liveEval("win.__MLRT_PAINT_RESTORE_WARN__?.();return true;").catch(() => {});
    }
  }
}
