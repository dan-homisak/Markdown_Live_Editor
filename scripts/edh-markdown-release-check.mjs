#!/usr/bin/env node
// Integrated readable-source release checks in one isolated VS Code workbench.
// Run npm.cmd run compile first. Fixtures and target links live in the temp profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qa = path.join(repo, "qa");
const codeOnly = process.argv.includes("--code-only");
const livePreviewOnly = process.argv.includes("--live-preview-only");
const nestedGuideOnly = process.argv.includes("--nested-guide-only");
const measureDiagnostic = process.argv.includes("--measure-diagnostic-only");
const paintOnly = process.argv.includes("--paint-only") || measureDiagnostic;
const paintMetrics = paintOnly || process.argv.includes("--paint");
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-release-edh-"));
const user = path.join(profile, "User"), extensions = path.join(profile, "extensions");
const fixture = path.join(profile, "MarkdownRelease.md");
// Avoid reconnecting to a stale renderer from earlier isolated QA windows.
const port = await new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
});
const text = [
  "---", "title: Release fixture", "enabled: true", "count: 12", "# metadata comment", "---", "",
  '## **Important** [deployment](./LinkedTarget.md "title") `settings` ##',
  "Setext *heading*", "===", "",
  "Plain **bold**, *italic*, ***both***, ~~strike *nested*~~ and `  exact  `.",
  'Literal <span title="safe" data-markdown-source="literal">**prose**</span> <!-- source comment -->',
  '[Local target](./LinkedTarget.md) [Unsupported](command:workbench.action.closeWindow)',
  '![Source image](https://example.invalid/never-fetch.png) <https://example.com> [Reference][ref]',
  '[ref]: ./LinkedTarget.md "Reference title"', '~~[struck link](./LinkedTarget.md)~~', "",
  "- [ ] Editable task", "- Resting bullet", "",
  "> A quote", "> > A nested quote", "> lazy continuation", "",
  "> [!NOTE]", "> A note", "", "> [!TIP]", "> A tip", "", "> [!IMPORTANT]", "> Important", "",
  "> [!WARNING]", "> A warning", "", "> [!CAUTION]", "> A caution", "",
  '```javascript', 'const jsValue = "string";', '', '// javascript comment', '```', "",
  '```typescript', 'const tsValue: number = 12;', '```', "",
  '```json', '{ "jsonKey": true, "count": 12 }', '```', "",
  '```bash', '# shell comment', 'echo "$HOME"', '```', "",
  '```python', 'def python_value():', '    return "value"', '```', "",
  '```yaml', 'yaml_key: "quoted"', 'enabled: true', '```', "",
  '```unknown', '**unknown language stays code**', '```', "",
  '    indented **literal**', "",
  '| **Header** | Content |', '| --- | --- |', '| [link](./LinkedTarget.md) | <b>Table HTML</b> |', "",
  '<div data-markdown-source="block">', '# literal html block', '</div>', "", "End source.", "",
].join("\n");
// Deliberately omit rendering.enabled: this verifies the installed default.
const settings = { "markdownLiveRenderTables.debug": true,
  "editor.fontFamily": "Consolas, 'Courier New', monospace", "editor.fontSize": 14,
  "editor.wordWrap": "on", "workbench.startupEditor": "none", "workbench.colorTheme": "Default Dark Modern" };
await Promise.all([mkdir(qa, { recursive: true }), mkdir(user, { recursive: true }), mkdir(extensions, { recursive: true })]);
await writeFile(fixture, text);
await writeFile(path.join(profile, "LinkedTarget.md"), "# Safe local target\n");
await writeFile(path.join(user, "settings.json"), JSON.stringify(settings, null, 2));
const code = process.env.MLRT_CODE_BIN || [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code", "/usr/share/code/code",
].filter(Boolean).find(existsSync);
if (!code) throw new Error("VS Code executable not found; set MLRT_CODE_BIN.");
const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: "1" };
for (const key of Object.keys(env)) if (key.startsWith("npm_") || ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"].includes(key)) delete env[key];
const child = spawn(code, [`--extensionDevelopmentPath=${repo}`, `--user-data-dir=${profile}`,
  `--extensions-dir=${extensions}`, `--remote-debugging-port=${port}`, "--new-window", "--disable-workspace-trust",
  "--skip-release-notes", "--skip-welcome", fixture], { stdio: "ignore", env, windowsHide: true });
const clients = [], checks = [];
const report = { profile, port, checks, environment: {}, limitations: [
  "OS IME and an actual screen reader are not exercised by this automated script.",
  "Forced colors uses Chromium emulation, not a changed Windows system theme.",
] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(probe, label, timeout = 12000) {
  let last;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { last = await probe(); if (last) return last; } catch (error) { last = String(error); }
    await sleep(100);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), events = [];
  let id = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && ["warning", "error"].includes(message.params?.type))
      events.push({ type: message.params.type, text: message.params.args?.map(arg => arg.value ?? arg.description).join(" "),
        timestamp: message.params.timestamp, stack: message.params.stackTrace?.callFrames?.slice(0, 5) });
    if (message.method === "Runtime.exceptionThrown") events.push({ type: "exception", text: message.params.exceptionDetails?.exception?.description });
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const client = { socket, events, send(method, params = {}) { return new Promise((resolve, reject) => {
    const current = ++id, timer = setTimeout(() => { pending.delete(current); reject(Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(current, { resolve, reject, timer }); socket.send(JSON.stringify({ id: current, method, params }));
  }); } };
  clients.push(client); await client.send("Runtime.enable"); return client;
}
async function evaluate(client, expression) {
  const value = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || JSON.stringify(value.exceptionDetails));
  return value.result?.value;
}
const rootCode = `const roots=[document,...Array.from(document.querySelectorAll('iframe')).map(frame=>{try{return frame.contentDocument;}catch{return null;}}).filter(Boolean)];const root=roots.find(doc=>doc.defaultView.__MLRT_EDITOR_VIEW__);if(!root)return null;const win=root.defaultView,view=win.__MLRT_EDITOR_VIEW__;`;
let wb, live;
const liveEval = body => evaluate(live, `(()=>{${rootCode}${body}})()`);
async function key(client, key, code, vk, modifiers = 0) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(100);
}
async function palette(title) {
  await key(wb, "F1", "F1", 112); await sleep(180); await wb.send("Input.insertText", { text: title });
  await sleep(350); await key(wb, "Enter", "Enter", 13); await sleep(450);
}
async function reconnectLive() {
  return waitFor(async () => {
    for (const item of (await targets()).filter(item => item.type !== "service_worker" && /vscode-webview/.test(item.url))) {
      if (!item.webSocketDebuggerUrl) continue;
      const client = await connect(item.webSocketDebuggerUrl);
      if (await evaluate(client, `(()=>{${rootCode}return !!view&&!root.hidden;})()`)) return client;
      client.socket.close();
    }
    return null;
  }, "visible live context");
}
async function reopenFixture() {
  await key(wb, "p", "KeyP", 80, process.platform === "darwin" ? 4 : 2);
  await wb.send("Input.insertText", { text: fixture }); await sleep(300); await key(wb, "Enter", "Enter", 13); await sleep(450);
  if (!await evaluate(wb, "!!document.querySelector('iframe')")) {
    await key(wb, "m", "KeyM", 77, process.platform === "darwin" ? 6 : 3); await sleep(700);
  }
  live = await reconnectLive();
}
async function screenshot(name) {
  const shot = await wb.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(qa, `edh-markdown-release-${name}.png`), Buffer.from(shot.data, "base64"));
}
async function select(position) {
  await liveEval(`view.dispatch({selection:{anchor:${position}},scrollIntoView:true});view.focus();return true;`);
  await sleep(250);
}
async function showSection(position) {
  await select(position);
  await liveEval(`view.scrollDOM.scrollTop=view.lineBlockAt(${position}).top;return true;`);
  await sleep(250);
}
async function sample(position) {
  return liveEval(`const pos=${position},a=view.domAtPos(pos,1),b=view.domAtPos(pos+1,-1),r=root.createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);const box=r.getBoundingClientRect(),el=a.node.nodeType===3?a.node.parentElement:a.node,css=win.getComputedStyle(el),line=el.closest('.cm-line');return {position:pos,text:r.toString(),classes:el.className,line:line?.textContent,lineClasses:line?.className,fontSize:css.fontSize,fontFamily:css.fontFamily,lineHeight:css.lineHeight,fontWeight:css.fontWeight,fontStyle:css.fontStyle,color:css.color,background:css.backgroundColor,decoration:css.textDecorationLine,x:box.x,y:box.y,height:box.height};`);
}
async function check(name, action) {
  if (livePreviewOnly && !name.startsWith("live preview:")) return;
  if (nestedGuideOnly && !name.startsWith("nested quote and alert")) return;
  if (measureDiagnostic && !name.startsWith("actual rendered performance")) return;
  if (codeOnly && !name.startsWith("all bundled code")) return;
  if (paintOnly && !/^(forced-colors|actual code token|actual rendered performance)/.test(name)) return;
  try { const detail = await action(); checks.push({ name, pass: true, detail }); console.log(`PASS ${name}`, JSON.stringify(detail ?? {})); }
  catch (error) { checks.push({ name, pass: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}
async function writeSettings(extra = {}) {
  await writeFile(path.join(user, "settings.json"), JSON.stringify({ ...settings, ...extra }, null, 2)); await sleep(700);
}
async function writeFixture(source) {
  await writeFile(fixture, source);
  await waitFor(async () => liveEval(`return view.state.doc.toString()===${JSON.stringify(source)};`), "host fixture reload");
  await sleep(250);
}

try {
  console.log(`Release EDH port ${port}; profile ${profile}`);
  const target = await waitFor(async () => (await targets()).find(item => item.type === "page" && /workbench\.html/.test(item.url)), "workbench", 30000);
  wb = await connect(target.webSocketDebuggerUrl); await wb.send("Page.enable"); await sleep(1800);
  // First-run prompts, if present, are dismissed before measurements.
  await key(wb, "Escape", "Escape", 27);
  assert(await evaluate(wb, "!!document.querySelector('.view-lines')"), "stock Monaco must be active");
  report.environment.stock = await evaluate(wb, "(()=>{const el=document.querySelector('.view-lines'),css=getComputedStyle(el);return {font:css.fontFamily,fontSize:css.fontSize,lineHeight:css.lineHeight,dpr:devicePixelRatio,width:innerWidth,height:innerHeight};})()");
  await screenshot("stock");
  await key(wb, "m", "KeyM", 77, process.platform === "darwin" ? 6 : 3); await sleep(1800);
  assert(await evaluate(wb, "!!document.querySelector('iframe')"));
  live = await waitFor(async () => {
    for (const item of (await targets()).filter(item => item.type !== "service_worker" && /vscode-webview/.test(item.url))) {
      if (!item.webSocketDebuggerUrl) continue;
      const client = await connect(item.webSocketDebuggerUrl);
      if (await evaluate(client, `(()=>{${rootCode}return !!view;})()`)) return client;
      client.socket.close();
    }
    return null;
  }, "live context");
  await liveEval("win.__MLRT_RELEASE_MESSAGES=[];win.addEventListener('message',event=>win.__MLRT_RELEASE_MESSAGES.push(event.data));return true;");
  await select(0);
  await waitFor(async () => liveEval("return !!root.querySelector('.mlrt-markdown-role-heading')&&!!root.querySelector('.mlrt-markdown-block-frontmatter');"), "default-enabled semantic presentation");
  await screenshot("readable");

  if (livePreviewOnly) {
    const { runLivePreviewChecks } = await import('./edh-live-preview-cases.mjs');
    await runLivePreviewChecks({ check, liveEval, select, screenshot, writeFixture, writeSettings, waitFor, sleep, palette,
      send: (method, params) => live.send(method, params), key: (...args) => key(live, ...args),
      workbench: expression => evaluate(wb, expression), reopenFixture, text, repo });
  }

  await check("default-enabled literal source, parser frontmatter, HTML and image isolation", async () => {
    const data = await liveEval("return {source:view.state.doc.toString(),enabled:win.__MLRT_EDITOR_OPTIONS__?.markdownRendering?.enabled,frontmatter:root.querySelectorAll('.mlrt-markdown-block-frontmatter').length,htmlMounted:root.querySelectorAll('[data-markdown-source]').length,remoteImages:root.querySelectorAll('img[src*=\"never-fetch\"]').length};");
    assert.equal(data.source, text); assert.equal(data.enabled, true); assert.equal(data.frontmatter, 6); assert.equal(data.htmlMounted, 0); assert.equal(data.remoteImages, 0);
    return { ...data, source: undefined, sourceLength: text.length };
  });
  await check("nested semantic properties keep normal metrics and exact source", async () => {
    const samples = {};
    for (const word of ["Important", "deployment", "settings", "Setext", "heading", "bold", "italic", "both", "nested", "  exact  ", "span", "title=", "prose", "source comment"]) samples[word] = await sample(text.indexOf(word));
    assert.equal(samples.Important.fontWeight, "700"); assert.equal(samples.deployment.fontWeight, "700");
    assert.equal(samples.settings.fontWeight, "400"); assert.equal(samples.settings.fontStyle, "normal");
    assert.equal(samples.heading.fontStyle, "italic"); assert.equal(samples.heading.fontWeight, "700");
    assert.equal(samples.both.fontStyle, "italic"); assert.equal(samples.both.fontWeight, "700");
    assert.equal(samples.nested.fontStyle, "italic"); assert.match(samples.nested.decoration, /line-through/);
    assert.notEqual(samples.deployment.color, samples.settings.color);
    assert.match(samples.span.classes, /role-tag/); assert.match(samples["title="].classes, /role-variable/);
    assert.equal(samples.prose.fontWeight, "700"); assert.match(samples["source comment"].classes, /role-comment/);
    for (const value of Object.values(samples)) { assert.equal(value.fontSize, "14px"); assert.equal(value.lineHeight, "18.9px"); }
    assert.match(samples["  exact  "].line, /`  exact  `/); assert.match(samples.Important.line, /^## \*\*Important\*\*/);
    return samples;
  });
  await check("recovery switch retains source row positions and table DOM", async () => {
    const positions = [text.indexOf("Important"), text.indexOf("Setext"), text.indexOf("Plain"), text.indexOf("Literal")];
    const before = await Promise.all(positions.map(sample));
    await select(text.indexOf("| **Header"));
    await liveEval("win.__MLRT_RELEASE_TABLE=root.querySelector('.mlrt-table');return true;");
    await writeSettings({ "markdownLiveRenderTables.markdownRendering.enabled": false });
    await waitFor(async () => liveEval("return !root.querySelector('.mlrt-markdown-source,.mlrt-markdown-block-code');"), "disabled layer");
    assert(await liveEval("return win.__MLRT_RELEASE_TABLE===root.querySelector('.mlrt-table');"));
    await select(0);
    const after = await Promise.all(positions.map(sample));
    for (let index = 0; index < before.length; index++) assert(Math.abs(before[index].y - after[index].y) <= 0.5, "source row y remains fixed");
    await writeSettings();
    await waitFor(async () => liveEval("return !!root.querySelector('.mlrt-markdown-role-heading');"), "enabled layer");
    assert.equal(await liveEval("return view.state.doc.toString();"), text);
    return { sourceRows: positions.length, maxYDelta: Math.max(...before.map((value, index) => Math.abs(value.y - after[index].y))), tableRetained: true };
  });
  await check("quote guides and five alert labels occupy source rows", async () => {
    await select(text.indexOf("> A quote"));
    const data = await liveEval("return {quotes:root.querySelectorAll('.cm-line.mlrt-markdown-block-quote').length,labels:Array.from(root.querySelectorAll('.mlrt-markdown-block-alert-label')).map(el=>({text:el.textContent,weight:win.getComputedStyle(el).fontWeight,lineHeight:win.getComputedStyle(el).lineHeight,color:win.getComputedStyle(el).color,edge:win.getComputedStyle(el.closest('.cm-line')).boxShadow})),guides:Array.from(root.querySelectorAll('.cm-line.mlrt-markdown-block-quote')).map(el=>win.getComputedStyle(el).boxShadow)};");
    assert(data.quotes >= 13); assert.equal(data.labels.length, 5); assert(data.labels.every(label => label.weight === "600" && label.lineHeight === "18.9px"));
    assert(data.guides.every(value => value !== "none")); assert(new Set(data.labels.map(label=>label.color)).size>1);
    assert(data.labels.every(label=>label.edge.includes(label.color)), "alert edge and label share the resolved type accent");
    await screenshot("quotes-alerts"); return data;
  });
  await check("all bundled code languages, blank rows and unknown fallback", async () => {
    const data = [];
    for (const [language, needle] of [["javascript", "const jsValue"], ["typescript", "const tsValue"], ["json", '{ "jsonKey"'], ["shell", 'echo "$HOME"'], ["python", "def python_value"], ["yaml", "yaml_key"], ["unknown", "**unknown language"], ["indented", "indented **literal"]]) {
      const position = text.indexOf(needle); await select(position); const value = await sample(position);
      if (!value.lineClasses?.includes("mlrt-markdown-block-code")) {
        value.diagnostic = await liveEval(`const line=view.state.doc.lineAt(${position}),plugins=view.plugins.map(plugin=>plugin.value).filter(Boolean),blocks=plugins.find(plugin=>plugin.constructor.name.includes('MarkdownBlockView'));const ranges=[];blocks?.decorations.between(line.from,line.to,(from,to,value)=>ranges.push({from,to,spec:value.spec}));return {lineFrom:line.from,lineTo:line.to,visible:view.visibleRanges,blockWindows:blocks?.windows,blockTree:blocks?.tree?.toString(),ranges};`);
        await liveEval("const blocks=view.plugins.map(plugin=>plugin.value).find(plugin=>plugin?.constructor.name.includes('MarkdownBlockView'));blocks.decorations=blocks.decorations.update({filter:(from,to,value)=>value.spec.class!=='mlrt-markdown-block-code-source'});view.dispatch({selection:view.state.selection});return true;");
        await sleep(150); value.afterRemovingMultilineCodeSource = await sample(position);
      }
      assert.match(value.lineClasses, /mlrt-markdown-block-code/, `${language}: ${JSON.stringify(value)}`); assert.equal(value.fontSize, "14px"); assert.equal(value.fontWeight, "400");
      const tokens = await liveEval(`const a=view.domAtPos(${position},1),el=a.node.nodeType===3?a.node.parentElement:a.node,line=el.closest('.cm-line');return Array.from(line.querySelectorAll('[class*=mlrt-markdown-block-token]')).map(el=>({text:el.textContent,classes:el.className}));`);
      if (!["unknown", "indented"].includes(language)) assert(tokens.length > 0, `${language} has actual mounted token decoration`);
      else assert.equal(tokens.length, 0, `${language} has no guessed language`);
      data.push({ language, value, tokens });
    }
    await showSection(text.indexOf("const jsValue"));
    const blank = await liveEval("return Array.from(root.querySelectorAll('.cm-line.mlrt-markdown-block-code')).filter(el=>el.textContent==='').length;");
    assert(blank >= 1, "blank code row retains fill"); await screenshot("code-languages"); return { languages: data, blankRows: blank };
  });
  await check("table source remains exclusively owned across all styling paths", async () => {
    await select(text.indexOf("| **Header"));
    const data = await liveEval("const tables=Array.from(root.querySelectorAll('.mlrt-table'));return {tables:tables.length,semanticDescendants:tables.reduce((n,table)=>n+table.querySelectorAll('[class*=mlrt-markdown]').length,0),text:tables[0]?.textContent};");
    assert.equal(data.tables, 1); assert.equal(data.semanticDescendants, 0); await screenshot("table-html"); return data;
  });
  await check("light, dark, high contrast recolor without source or table remount", async () => {
    await select(text.indexOf("| **Header"));
    await liveEval("win.__MLRT_RELEASE_DOC=view.state.doc;win.__MLRT_RELEASE_TABLE=root.querySelector('.mlrt-table');return true;");
    const data = [];
    for (const [name, kind] of [["Default Light Modern", "vscode-light"], ["Default High Contrast", "vscode-high-contrast"], ["Default Dark Modern", "vscode-dark"]]) {
      await writeSettings({ "workbench.colorTheme": name });
      await waitFor(async () => liveEval(`return root.body.dataset.vscodeThemeKind===${JSON.stringify(kind)};`), name);
      await sleep(250);
      const value = await liveEval("const css=win.getComputedStyle(view.dom);return {kind:root.body.dataset.vscodeThemeKind,sourceRetained:view.state.doc===win.__MLRT_RELEASE_DOC,tableRetained:root.querySelector('.mlrt-table')===win.__MLRT_RELEASE_TABLE,foreground:css.getPropertyValue('--mlrt-markdown-foreground'),codeFill:css.getPropertyValue('--mlrt-markdown-code-background'),outline:css.getPropertyValue('--mlrt-markdown-inline-code-outline')};");
      assert(value.sourceRetained && value.tableRetained); data.push(value);
      await select(0); await screenshot(`theme-${kind}`); await select(text.indexOf("| **Header"));
      // Viewport eviction is allowed; preserve the current table across theme changes.
      await liveEval("win.__MLRT_RELEASE_TABLE=root.querySelector('.mlrt-table');return true;");
    }
    return data;
  });
  await check("forced-colors source and code outline remain visible", async () => {
    await select(0); await live.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] }); await sleep(250);
    const value = await sample(text.indexOf("settings")); assert.notEqual(value.color, "rgba(0, 0, 0, 0)");
    try {
      const outline = await liveEval("const css=win.getComputedStyle(root.querySelector('.mlrt-markdown-inline-code')),probe=root.createElement('i');probe.style.cssText='position:absolute;outline:1px solid CanvasText';root.body.appendChild(probe);const expected=win.getComputedStyle(probe).outlineWidth;probe.remove();return {style:css.outlineStyle,width:css.outlineWidth,color:css.outlineColor,expected};"); assert.equal(outline.style, "solid"); assert.equal(outline.width, outline.expected); assert(parseFloat(outline.width)>0);
      const blockEdges = await liveEval("const query=selector=>{const el=root.querySelector(selector);if(!el)return null;const css=win.getComputedStyle(el,'::before'),row=win.getComputedStyle(el);return {left:css.borderLeftWidth,top:css.borderTopWidth,bottom:css.borderBottomWidth,style:css.borderTopStyle,pointerEvents:css.pointerEvents,rowBorder:row.borderTopWidth};};return {quote:query('.cm-line.mlrt-markdown-block-quote'),start:query('.cm-line.mlrt-markdown-block-start'),end:query('.cm-line.mlrt-markdown-block-end')};");
      assert.equal(blockEdges.quote.left, outline.expected); assert.equal(blockEdges.start.top, outline.expected); assert.equal(blockEdges.end.bottom, outline.expected);
      for(const edge of Object.values(blockEdges)) { assert.equal(edge.style,"solid");assert.equal(edge.pointerEvents,"none");assert.equal(edge.rowBorder,"0px"); }
      await screenshot("forced-colors"); return { value, outline, blockEdges, emulated: true };
    } finally { await live.send("Emulation.setEmulatedMedia", { features: [] }); }
  });
  await check("actual code token foreground wins identical-range source wrappers", async () => {
    const samples = [];
    for (const needle of ["// javascript comment", "# shell comment", "# metadata comment"]) {
      const position = text.indexOf(needle); await showSection(position);
      const actual = await sample(position + 3);
      const expected = await liveEval("const probe=root.createElement('i');probe.style.color='var(--mlrt-markdown-code-comment)';view.dom.appendChild(probe);const color=win.getComputedStyle(probe).color;probe.remove();return color;");
      assert.equal(actual.color, expected, `${needle} actual leaf foreground`); samples.push({ needle, actual, expected });
    }
    await showSection(text.indexOf("const jsValue")); await screenshot("code-languages"); return samples;
  });
  await check("nested quote and alert code retain guides without horizontal borders", async () => {
    const nested = ["Nested code guide fixture", "", "> Outer quote", "> > ```javascript", "> > const quoteCode = 1;", "> > ```", "> After nested code.", "",
      "> [!WARNING]", ">", "> ```javascript", "> const alertCode = 2;", "> ```", "> After alert code.", "",
      "```javascript", "const standaloneCode = 3;", "```", "", "End."].join("\n");
    const selectors={quoteStart:4,quoteBody:5,quoteEnd:6,alertStart:11,alertBody:12,alertEnd:13,standalone:17};
    const capture=async()=>liveEval(`const result={};for(const [name,number]of Object.entries(${JSON.stringify(selectors)})){const line=view.state.doc.line(number),pos=line.from,a=view.domAtPos(pos,1),b=view.domAtPos(pos+1,-1),el=(a.node.nodeType===3?a.node.parentElement:a.node).closest('.cm-line'),css=win.getComputedStyle(el),pseudo=win.getComputedStyle(el,'::before'),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const box=range.getBoundingClientRect();result[name]={line:el.textContent,classes:el.className,shadow:css.boxShadow,guide:css.getPropertyValue('--mlrt-markdown-block-guide-width').trim(),fill:css.backgroundColor,top:css.getPropertyValue('--mlrt-markdown-block-top-edge').trim(),bottom:css.getPropertyValue('--mlrt-markdown-block-bottom-edge').trim(),border:[css.borderTopWidth,css.borderLeftWidth],pseudo:{left:pseudo.borderLeftWidth,top:pseudo.borderTopWidth,bottom:pseudo.borderBottomWidth,pointerEvents:pseudo.pointerEvents},glyph:{x:box.x,y:box.y,width:box.width,height:box.height},fontSize:css.fontSize,lineHeight:css.lineHeight};}return result;`);
    try {
      await writeFixture(nested); await select(0);
      await waitFor(async()=>liveEval("return root.querySelectorAll('.cm-line.mlrt-markdown-block-code.mlrt-markdown-block-quote').length===6;"),"nested code row projection");
      const normal=await capture();
      for(const [name,row]of Object.entries(normal)){
        assert.match(row.classes,/mlrt-markdown-block-code/);
        const width=name.startsWith('quote')?'1px':name.startsWith('alert')?'2px':'';
        assert.equal(row.guide,width);assert.deepEqual(row.border,['0px','0px']);
        if(width)assert(row.shadow.includes(` ${width} 0px 0px 0px inset`),`${name}: guide remains in code shadow`);
        assert.equal(row.top,'transparent');assert.equal(row.bottom,'transparent');
        assert.equal((row.shadow.match(/inset/g)??[]).length,1,'only the enclosing vertical guide remains');
      }
      await screenshot('nested-guides');
      // Reveal the source in the same rendered block layout. Disabling the
      // entire renderer deliberately removes code padding and is a different mode.
      await liveEval('view.dispatch({selection:{anchor:0,head:view.state.doc.length}});view.focus();return true;');await sleep(250);
      const revealed=await capture();
      let maxGeometryDelta=0;
      for(const name of Object.keys(normal))for(const key of ['x','y','width','height'])maxGeometryDelta=Math.max(maxGeometryDelta,Math.abs(normal[name].glyph[key]-revealed[name].glyph[key]));
      assert(maxGeometryDelta<=0.5,`nested code source geometry drift ${maxGeometryDelta}`);
      await select(0);
      await live.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await sleep(250);
      const forced=await capture();
      const probes=await liveEval("const el=root.createElement('i');el.style.cssText='position:absolute;border:1px solid CanvasText;border-left-width:2px';root.body.appendChild(el);const css=win.getComputedStyle(el),result={one:css.borderTopWidth,two:css.borderLeftWidth};el.remove();return result;");
      for(const [name,row]of Object.entries(forced)){
        assert.equal(row.pseudo.left,name.startsWith('quote')?probes.one:name.startsWith('alert')?probes.two:'0px');
        assert.equal(row.pseudo.top,'0px');assert.equal(row.pseudo.bottom,'0px');
        assert.equal(row.pseudo.pointerEvents,'none');assert.deepEqual(row.border,['0px','0px']);
        for(const key of ['x','y','width','height'])assert(Math.abs(row.glyph[key]-normal[name].glyph[key])<=0.5);
      }
      assert.equal(await liveEval('return view.state.doc.toString();'),nested);
      await screenshot('nested-guides-forced-colors');return {normal,forced,probes,maxGeometryDelta,sourceUnchanged:true};
    } finally {
      await live.send('Emulation.setEmulatedMedia',{features:[]});await writeSettings();await writeFixture(text);await select(0);
    }
  });
  await check("modifier hover is actionable only for validated destinations", async () => {
    await select(0);
    const hover = async needle => {
      const pos = text.indexOf(needle), point = await liveEval(`const b=view.coordsAtPos(${pos}+2);return {x:b.left+2,y:(b.top+b.bottom)/2};`);
      await live.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, modifiers: process.platform === "darwin" ? 4 : 2 }); await sleep(180);
      return liveEval("return Array.from(root.querySelectorAll('.mlrt-markdown-link-actionable-hover')).map(el=>el.textContent).join('');");
    };
    const valid = await hover("Local target"), unsupported = await hover("Unsupported");
    assert.match(valid, /Local target/); assert.equal(unsupported, "");
    await hover("struck link"); const struck = await sample(text.indexOf("struck link"));
    assert.match(struck.decoration, /line-through/); assert.match(struck.decoration, /underline/);
    await screenshot("link-hover");
    await live.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, modifiers: 0 }); return { valid, unsupported, struck };
  });
  await check("task source context menu provides a validated toggle", async () => {
    const position = text.indexOf("Editable task"); await select(position);
    const point = await liveEval(`const box=view.coordsAtPos(${position}+3);return {x:box.left+1,y:(box.top+box.bottom)/2};`);
    await live.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "right", clickCount: 1 });
    await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "right", clickCount: 1 });
    const menu = await waitFor(async () => liveEval("const items=Array.from(root.querySelectorAll('.mlrt-clipboard-menu-item'));const toggle=items.find(el=>el.textContent==='Toggle Task Checkbox');if(!toggle)return null;const box=toggle.getBoundingClientRect();return {labels:items.map(el=>el.textContent),x:box.x+box.width/2,y:box.y+box.height/2};"), "task context menu");
    assert(menu.labels.includes("Focus Task Checkbox")); await screenshot("task-context-menu");
    await live.send("Input.dispatchMouseEvent", { type: "mousePressed", x: menu.x, y: menu.y, button: "left", clickCount: 1 });
    await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: menu.x, y: menu.y, button: "left", clickCount: 1 });
    const expected = text.replace("[ ] Editable task", "[x] Editable task");
    await waitFor(async () => liveEval(`return view.state.doc.toString()===${JSON.stringify(expected)};`), "context action source edit");
    await waitFor(async () => liveEval(`return win.__MLRT_RELEASE_MESSAGES.some(message=>message.source==='webviewAck'&&message.text===${JSON.stringify(expected)});`), "context toggle host acknowledgement");
    await liveEval("view.focus();return true;"); await key(live, "z", "KeyZ", 90, process.platform === "darwin" ? 4 : 2);
    await waitFor(async () => liveEval(`return view.state.doc.toString()===${JSON.stringify(text)};`), "context action host undo");
    return { labels: menu.labels, toggledSourceCharacterOnly: true, hostUndo: true };
  });
  await check("literal accessibility mode explains unavailable generated focus", async () => {
    await writeSettings({ "editor.accessibilitySupport": "on" }); await select(text.indexOf("Editable task"));
    await waitFor(async () => liveEval("return root.querySelectorAll('.mlrt-markdown-task-control').length===0;"), "literal accessibility marker mode");
    await palette("Markdown Live Editor: Focus Task Checkbox at Caret");
    const explanation = await waitFor(async () => liveEval("return Array.from(root.querySelectorAll('[role=status]')).map(el=>el.textContent).find(text=>text.includes('Toggle Task Checkbox at Caret'));"), "focus fallback explanation");
    assert.equal(await liveEval("return view.state.doc.toString();"), text);
    await screenshot("focus-fallback"); await writeSettings({ "editor.accessibilitySupport": "off" }); await select(0);
    return { explanation, sourceUnchanged: true };
  });
  await check("disabled source focus tracking preserves newer table ownership", async () => {
    const task = text.indexOf("Editable task"); await select(task);
    await writeSettings({ "markdownLiveRenderTables.markdownRendering.enabled": false });
    await showSection(text.indexOf("| **Header"));
    const parked = await liveEval(`const cell=root.querySelector('.mlrt-table-cell');cell.focus();view.dispatch({selection:{anchor:${task}}});cell.blur();return {selection:view.state.selection.main.head,active:root.activeElement?.tagName};`);
    assert.equal(parked.selection, task);
    await writeSettings();
    await palette("Markdown Live Editor: Toggle Task Checkbox at Caret"); await sleep(300);
    assert.equal(await liveEval("return view.state.doc.toString();"), text, "newer table owner blocks a parked source caret after re-enable");
    await select(task); await palette("Markdown Live Editor: Toggle Task Checkbox at Caret");
    const expected = text.replace("[ ] Editable task", "[x] Editable task");
    await waitFor(async () => liveEval(`return view.state.doc.toString()===${JSON.stringify(expected)};`), "intentional source task command");
    await liveEval("view.focus();return true;"); await key(live, "z", "KeyZ", 90, process.platform === "darwin" ? 4 : 2);
    await waitFor(async () => liveEval(`return view.state.doc.toString()===${JSON.stringify(text)};`), "source task undo");
    return { parked, tableOwnershipRetained: true, intentionalSourceCommand: true };
  });
  await check("host command rejects command URI and opens a temporary local document", async () => {
    await select(text.indexOf("Unsupported") + 2); await palette("Markdown Live Editor: Open Markdown Link at Caret");
    await waitFor(async () => liveEval("return win.__MLRT_RELEASE_MESSAGES.some(message=>message.type==='markdownLinkResult'&&message.ok===false);"), "unsupported link result");
    assert(await evaluate(wb, "!!document.querySelector('.monaco-workbench')"), "command URI must not close window");
    await select(text.indexOf("Local target") + 2); await palette("Markdown Live Editor: Open Markdown Link at Caret");
    await waitFor(async () => evaluate(wb, "Array.from(document.querySelectorAll('.tab.active')).some(tab=>tab.textContent.includes('LinkedTarget.md'))"), "local target tab");
    const titles = await evaluate(wb, "Array.from(document.querySelectorAll('.tab')).map(tab=>tab.textContent)");
    await screenshot("local-link-opened");
    // Opening a local target can hide or replace the original preview webview.
    // Bring its source tab back through the workbench before querying it.
    await reopenFixture();
    assert.equal(await liveEval("return view.state.doc.toString();"), text); return { titles, sourceUnchanged: true };
  });
  await check("standard fixture readable screenshots preserve complete host source", async () => {
    const standard = (await readFile(path.join(repo, "standard-markdown-fixture.md"), "utf8")).replace(/\r\n/g, "\n");
    await writeFixture(standard);
    const sections = ["# Standard Markdown Fixture", "## Emphasis", "## Blockquotes", "## Code Blocks", "## Tables"];
    const captured = [];
    for (const [index, section] of sections.entries()) {
      const position = standard.indexOf(section);
      if (position < 0) continue;
      await showSection(position); await screenshot(`standard-${index}`); captured.push(section);
    }
    assert(captured.length >= 3); assert.equal(await liveEval("return view.state.doc.toString();"), standard);
    await writeFixture(text); return { sourceLength: standard.length, captured };
  });
  if(paintMetrics) await check("actual rendered performance and host acknowledgement samples", async () => {
    const {runMarkdownPaintMetrics}=await import('./markdown-rendering-paint-benchmark.mjs');
    const metrics=await runMarkdownPaintMetrics({liveEval,writeFixture,writeSettings,select,text,diagnosticOnly:measureDiagnostic});
    await writeFile(path.join(qa,`edh-markdown-paint-results${measureDiagnostic?'-measure-diagnostic':''}.json`),JSON.stringify(metrics,null,2));
    return {fixtures:metrics.fixtures.map(fixture=>({lineCount:fixture.lineCount,enabled:fixture.enabled,classes:Object.fromEntries(Object.entries(fixture.classes).map(([name,value])=>[name,value.firstPaintOpportunity]))})),acknowledgedEdits:metrics.acknowledgedEdits?.acknowledgement};
  });
  report.finalSourceMatches = await liveEval(`return view.state.doc.toString()===${JSON.stringify(text)};`);
  report.console = live.events;
} catch (error) { checks.push({ name: "harness initialization/completion", pass: false, error: String(error) }); console.error(error); }
finally {
  report.passed = checks.length > 0 && checks.every(check => check.pass) && !(report.console?.length);
  const reportName=`edh-markdown-release-results${livePreviewOnly ? "-live-preview" : nestedGuideOnly ? "-nested-guides" : codeOnly ? "-code-diagnostic" : measureDiagnostic ? "-measure-diagnostic" : paintOnly ? "-paint" : ""}.json`;
  await writeFile(path.join(qa, reportName), JSON.stringify(report, null, 2));
  for (const client of clients) client.socket.close(); child.kill();
  console.log(`Saved qa/${reportName}; ${checks.filter(check => check.pass).length}/${checks.length} checks passed.`);
  if (!report.passed) process.exitCode = 1;
}
