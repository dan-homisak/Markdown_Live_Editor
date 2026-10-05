#!/usr/bin/env node
// Focused marker interaction checks in an actual isolated Extension Development Host.
// Run npm.cmd run compile first. No fixture changes touch the user's documents.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const geometryOnly = process.argv.includes("--geometry-only");
const mixedOnly = process.argv.includes("--mixed-only");
const lifecycleOnly = process.argv.includes("--lifecycle-only");
const largeMetrics = process.argv.includes("--large-metrics");
const zoomOne = process.argv.includes("--zoom-one");
const narrow = process.argv.includes("--narrow");
const theme = process.argv.includes("--light") ? "Default Light Modern" : process.argv.includes("--high-contrast") ? "Default High Contrast" : "Default Dark Modern";
const variant = lifecycleOnly ? "-lifecycle" : mixedOnly ? "-mixed-diagnostic" : geometryOnly ? `-${largeMetrics ? "20px" : "14px"}-${zoomOne ? "zoom1" : "zoom0"}-${narrow ? "narrow" : "wide"}-${theme.includes("Light") ? "light" : theme.includes("Contrast") ? "hc" : "dark"}` : "";
const qa = path.join(repo, "qa");
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-markdown-edh-"));
const extensions = path.join(profile, "extensions");
const user = path.join(profile, "User");
const fixture = path.join(profile, "MarkdownMarkers.md");
const port = 9800 + Math.floor(Math.random() * 190);
const text = [
  "Ordinary source before markers.", "",
  "- Bullet alpha and ordinary following text that should retain its exact placement.",
  "- [ ] Task alpha with enough following text to exercise source wrapping at narrow widths.",
  "- [X] Task beta", "  - Nested bullet", "\t- Tab nested bullet", "",
  "***", "", "After rule.", "",
  "| Marker | Content |", "| --- | --- |", "| - [ ] | Table stays owned |", "",
  "```md", "- [ ] Literal fenced task", "***", "```", "", "End source.", "",
].join("\n");
const initialSettings = {
  "markdownLiveRenderTables.markdownRendering.enabled": true,
  "markdownLiveRenderTables.debug": true,
  "editor.fontFamily": "Consolas, 'Courier New', monospace",
  "editor.fontSize": largeMetrics ? 20 : 14,
  "editor.lineHeight": largeMetrics ? 30 : 0,
  "editor.letterSpacing": largeMetrics ? 1 : 0,
  "editor.wordWrap": "on",
  "window.zoomLevel": zoomOne ? 1 : 0,
  "workbench.startupEditor": "none",
  "workbench.colorTheme": theme,
};
await mkdir(qa, { recursive: true });
await mkdir(extensions, { recursive: true });
await mkdir(user, { recursive: true });
await writeFile(fixture, text, "utf8");
await writeFile(path.join(user, "settings.json"), JSON.stringify(initialSettings, null, 2));
const code = process.env.MLRT_CODE_BIN || [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code", "/usr/share/code/code",
].filter(Boolean).find(existsSync);
if (!code) throw new Error("VS Code executable not found; set MLRT_CODE_BIN.");
const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: "1" };
for (const key of Object.keys(env)) if (key.startsWith("npm_") || ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"].includes(key)) delete env[key];
const child = spawn(code, [
  `--extensionDevelopmentPath=${repo}`, `--user-data-dir=${profile}`,
  `--extensions-dir=${extensions}`, `--remote-debugging-port=${port}`,
  "--new-window", "--disable-workspace-trust", "--skip-release-notes", "--skip-welcome", fixture,
], { stdio: "ignore", env, windowsHide: true });
let childExit = null;
child.on("exit", (code, signal) => { childExit = { code, signal }; });
const clients = [];
const results = [];
const report = { profile, port, environment: {}, checks: results, limitations: [
  "No actual OS IME or screen reader was exercised by this script.",
  "These focused marker checks do not replace the stock/live baseline gate or the complete release matrix.",
] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(probe, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await probe(); if (last) return last; } catch (error) { last = String(error); }
    await sleep(100);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const events=[];
  let id = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if(message.method==="Runtime.consoleAPICalled"&&["warning","error"].includes(message.params?.type))events.push({type:message.params.type,text:message.params.args?.map(arg=>arg.value??arg.description).join(" ")});
    if(message.method==="Runtime.exceptionThrown")events.push({type:"exception",text:message.params.exceptionDetails?.exception?.description??message.params.exceptionDetails?.text});
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const client = { socket, events, send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const current = ++id;
      const timer = setTimeout(() => { pending.delete(current); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(current, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: current, method, params }));
    });
  } };
  clients.push(client);
  await client.send("Runtime.enable");
  return client;
}
async function evaluate(client, expression) {
  const value = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || JSON.stringify(value.exceptionDetails));
  return value.result?.value;
}
const rootCode = `const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => { try { return frame.contentDocument; } catch { return null; } }).filter(Boolean)]; const root = roots.find(doc => doc.defaultView.__MLRT_EDITOR_VIEW__); if (!root) return null; const win = root.defaultView; const view = win.__MLRT_EDITOR_VIEW__;`;
async function liveEval(body) { return evaluate(live, `(() => { ${rootCode} ${body} })()`); }
async function key(client, key, code, vk, modifiers = 0, value) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers, ...(value ? { text: value, unmodifiedText: value } : {}) });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  // Chromium publishes native selection changes asynchronously; sample after
  // its selectionchange/CodeMirror reconciliation turn, not after CDP dispatch.
  await sleep(90);
}
async function check(name, action) {
  if(mixedOnly&&!name.startsWith("task outside a mixed")&&!name.startsWith("rendering preserves")&&!name.startsWith("requested initial"))return;
  if(lifecycleOnly&&!/^(focused external|newer source|focused checkbox viewport|host accessibility|rendering preserves|requested initial)/.test(name))return;
  try { const detail = await action(); results.push({ name, pass: true, detail }); console.log(`PASS ${name}`, JSON.stringify(detail ?? {})); }
  catch (error) {
    const state = live ? await liveEval("return {source:view.state.doc.toString(),selection:view.state.selection.toJSON(),active:root.activeElement?.outerHTML.slice(0,160),markers:root.querySelectorAll('.mlrt-markdown-marker').length,controls:root.querySelectorAll('.mlrt-markdown-task-control').length,options:win.__MLRT_HARNESS_OPTIONS,plugins:view.plugins.filter(plugin=>plugin.value&&Array.isArray(plugin.value.markers)).map(plugin=>({markers:plugin.value.markers.length,sizes:plugin.value.sizes.size,decorations:plugin.value.decorations.size,firstLiteral:plugin.value.markers[0]?plugin.value.literal(plugin.value.markers[0]):null,scheduled:plugin.value.scheduled,failed:plugin.value.failed,destroyed:plugin.value.destroyed,composing:plugin.value.composing,viewComposing:view.composing,compositionStarted:view.compositionStarted,treeLength:plugin.value.tree?.length,visibleRanges:view.visibleRanges})),messages:win.__MLRT_HARNESS_MESSAGES.slice(-3).map(message=>({source:message.source,revision:message.revision}))};").catch(()=>null) : null;
    if(state&&mixedOnly)state.mixedTrace=await liveEval("return {before:win.__MLRT_MIXED_BEFORE,events:win.__MLRT_MIXED_TRACE,updates:win.__MLRT_DEBUG_EVENTS__?.slice(win.__MLRT_MIXED_DEBUG_INDEX).filter(event=>event.event==='editor-update')};");
    results.push({ name, pass: false, error: String(error), state }); console.error(`FAIL ${name}: ${error}`);
    // Keep subsequent cases independent using the actual host history. Never
    // inject a synthetic document snapshot into a host-undo proof.
    if(live) for(let attempt=0;attempt<5 && await source()!==text;attempt++) {
      await liveEval("view.focus(); return true;");
      await key(live,"z","KeyZ",90,process.platform==="darwin"?4:2);
      await sleep(250);
    }
  }
}
async function screenshot(name) {
  const shot = await wb.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(qa, name.replace(/\.png$/, `${variant}.png`)), Buffer.from(shot.data, "base64"));
}
async function source() { return liveEval("return view.state.doc.toString();"); }
async function select(anchor, head = anchor) {
  await liveEval(`view.dispatch({ selection: { anchor: ${anchor}, head: ${head} }, scrollIntoView: true }); view.focus(); return true;`);
  await sleep(180);
}
async function hostUndo(expected) {
  await key(live, "z", "KeyZ", 90, process.platform === "darwin" ? 4 : 2);
  await waitFor(async () => (await source()) === expected, "actual host undo");
  return liveEval("return win.__MLRT_HARNESS_MESSAGES.slice(-3).map(message => ({ source: message.source, revision: message.revision }));");
}
async function setRendering(enabled) {
  await writeFile(path.join(user, "settings.json"), JSON.stringify({ ...initialSettings, "markdownLiveRenderTables.markdownRendering.enabled": enabled }, null, 2));
  await waitFor(async () => liveEval(`return win.__MLRT_HARNESS_OPTIONS?.markdownRendering?.enabled === ${enabled};`), "host configuration propagation");
  await sleep(300);
}
async function pointOnTask() {
  return liveEval(`const button = root.querySelector('.mlrt-markdown-task-control[aria-label^="Task alpha"]'); if (!button) return null; const box = button.getBoundingClientRect(); const x=box.x+box.width/2,y=box.y+box.height/2; return {x,y,width:box.width,height:box.height,hit:root.elementFromPoint(x,y)?.outerHTML.slice(0,180),disabled:button.getAttribute('aria-disabled')};`);
}
async function clickTask() {
  const point = await waitFor(pointOnTask, "visible first task control");
  await live.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return point;
}
async function palette(title) {
  await key(wb, "F1", "F1", 112);
  await sleep(180);
  await wb.send("Input.insertText", { text: title });
  await sleep(350);
  await key(wb, "Enter", "Enter", 13);
  await sleep(400);
}
async function geometry() {
  return liveEval(`const positions = ${JSON.stringify([text.indexOf("Bullet alpha"), text.indexOf("Task alpha"), text.indexOf("Task beta"), text.indexOf("Nested bullet"), text.indexOf("Tab nested bullet"), text.indexOf("After rule."), text.indexOf("End source.")])}; const glyphs = positions.map(position => { const a = view.domAtPos(position, 1), b = view.domAtPos(position+1, -1); const range = root.createRange(); range.setStart(a.node,a.offset); range.setEnd(b.node,b.offset); const box=range.getBoundingClientRect(); return {position,x:box.x,y:box.y,width:box.width,height:box.height}; }); return { glyphs, height:view.contentHeight, scrollTop:view.scrollDOM.scrollTop, scrollWidth:view.scrollDOM.scrollWidth, source:view.state.doc.toString(), markerCount:root.querySelectorAll('.mlrt-markdown-marker').length, controls:root.querySelectorAll('.mlrt-markdown-task-control').length };`);
}
async function wrapGeometry() {
  return liveEval(`return ${JSON.stringify([text.indexOf("Bullet alpha"),text.indexOf("Task alpha"),text.indexOf("Task beta"),text.indexOf("Nested bullet"),text.indexOf("Tab nested bullet")])}.map(start=>{const line=view.state.doc.lineAt(start),rows=[];for(let position=start;position<line.to;position++){const a=view.domAtPos(position,1),b=view.domAtPos(position+1,-1),range=root.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const box=range.getBoundingClientRect();let row=rows.at(-1);if(!row||Math.abs(row.y-box.y)>0.5){row={from:position,to:position+1,x:box.x,y:box.y,right:box.right};rows.push(row);}else{row.to=position+1;row.right=box.right;}}return {start,rows};});`);
}
async function tableSelection() {
  return liveEval("const address=cell=>`${cell.dataset.rowKind}:${cell.dataset.rowIndex}:${cell.dataset.column}`;return {selection:view.state.selection.toJSON(),rectangle:Array.from(root.querySelectorAll('.mlrt-table-cell-selected')).map(address).sort(),mixed:Array.from(root.querySelectorAll('.mlrt-document-range-selected')).map(address).sort(),owner:root.activeElement?.className};");
}
async function nativeSelection() {
  return liveEval("const selection=win.getSelection();return {anchor:selection?.anchorNode?.nodeName,anchorClass:selection?.anchorNode?.parentElement?.className,anchorText:selection?.anchorNode?.textContent?.slice(0,100),anchorOffset:selection?.anchorOffset,head:selection?.focusNode?.nodeName,headClass:selection?.focusNode?.parentElement?.className,headText:selection?.focusNode?.textContent?.slice(0,100),headOffset:selection?.focusOffset};");
}
async function focusState() {
  return liveEval("return {selection:view.state.selection.toJSON(),sourceFocus:view.hasFocus,documentFocus:root.hasFocus(),active:root.activeElement?.className,controls:root.querySelectorAll('.mlrt-markdown-task-control').length,scrollTop:view.scrollDOM.scrollTop,visibleRanges:view.visibleRanges};");
}
async function focusFirstTask() {
  const anchor=text.indexOf('Task alpha')+2;
  await select(anchor);await palette('Markdown Live Editor: Focus Task Checkbox at Caret');
  await waitFor(async()=>liveEval("return root.activeElement?.matches('.mlrt-markdown-task-control[aria-label^=\"Task alpha\"]');"),'first task keyboard focus');
  return anchor;
}
async function writeHostFixture(value) {
  await writeFile(fixture,value,'utf8');
  await waitFor(async()=>await source()===value,'actual external file reload',15000);
  await sleep(250);
}
async function establishMixedSelection(proseOrigin = false) {
  await select(0);const points=await liveEval(`const cell=root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-column="0"]'),box=cell.getBoundingClientRect(),caret=view.coordsAtPos(${text.indexOf("After rule.")+5});return {start:{x:box.left+10,y:box.top+box.height/2},end:{x:caret.left+0.1,y:(caret.top+caret.bottom)/2}};`);
  if(proseOrigin)[points.start,points.end]=[points.end,points.start];
  for(const [type,point]of [["mousePressed",points.start],["mouseMoved",points.end],["mouseReleased",points.end]])await live.send("Input.dispatchMouseEvent",{type,...point,button:"left",clickCount:type==="mouseMoved"?undefined:1});
  await sleep(180);return tableSelection();
}
let wb, live;
try {
  console.log(`Markdown EDH port ${port}; profile ${profile}`);
  const workbench = await waitFor(async () => {
    if (childExit) throw new Error(`Electron exited ${JSON.stringify(childExit)}`);
    return (await targets()).find(target => target.type === "page" && /workbench\.html/.test(target.url));
  }, "workbench renderer", 30000);
  wb = await connect(workbench.webSocketDebuggerUrl);
  await wb.send("Page.enable");
  if(geometryOnly) {
    try {
      const window = await wb.send("Browser.getWindowForTarget");
      await wb.send("Browser.setWindowBounds",{windowId:window.windowId,bounds:{windowState:"normal"}});
      await wb.send("Browser.setWindowBounds",{windowId:window.windowId,bounds:{width:narrow?1100:1700,height:1100}});
      report.environment.requestedWindow={width:narrow?1100:1700,height:1100};
    } catch(error) {
      report.environment.windowResizeUnavailable=String(error);
      report.environment.widthMethod=narrow?"CodeMirror view width constrained to 450 CSS px inside unchanged workbench":"Unchanged real workbench viewport";
      report.limitations.push("Electron does not expose CDP Browser window bounds; narrow geometry constrains the editor view inside the existing workbench, not the OS window.");
    }
  }
  await sleep(1800);
  assert(await evaluate(wb, "!!document.querySelector('.view-lines')"), "stock Monaco must be active");
  Object.assign(report.environment,await evaluate(wb, "({dpr:devicePixelRatio,width:innerWidth,height:innerHeight,userAgent:navigator.userAgent})"));
  report.environment.settings=initialSettings;
  await screenshot("edh-markdown-stock.png");
  await key(wb, "m", "KeyM", 77, process.platform === "darwin" ? 6 : 3);
  await sleep(1800);
  assert(await evaluate(wb, "!!document.querySelector('iframe')"), "live workbench must contain webview iframe");
  live = await waitFor(async () => {
    for (const target of (await targets()).filter(target => target.type !== "service_worker" && /vscode-webview/.test(target.url))) {
      if (!target.webSocketDebuggerUrl) continue;
      const client = await connect(target.webSocketDebuggerUrl);
      if (await evaluate(client, `(() => { ${rootCode} return !!view; })()`)) return client;
      client.socket.close();
    }
    return null;
  }, "live editor context");
  await liveEval("win.__MLRT_HARNESS_MESSAGES=[]; win.addEventListener('message',event=>{if(event.data?.type==='setDocument')win.__MLRT_HARNESS_MESSAGES.push(event.data);if(event.data?.editorOptions)win.__MLRT_HARNESS_OPTIONS=event.data.editorOptions;}); return true;");
  if(geometryOnly&&narrow&&report.environment.windowResizeUnavailable)await liveEval("view.dom.style.width='450px';return true;");
  await select(0);
  await waitFor(async () => liveEval("return root.querySelectorAll('.mlrt-markdown-task-control').length === 2;"), "initial parser and marker measurement convergence");
  report.environment.live = await liveEval("const css=getComputedStyle(view.contentDOM); return {theme:root.body.dataset.vscodeThemeId,themeKind:root.body.dataset.vscodeThemeKind,font:css.fontFamily,fontSize:css.fontSize,lineHeight:css.lineHeight,letterSpacing:css.letterSpacing,viewport:view.scrollDOM.clientWidth,screenReader:root.body.classList.contains('vscode-using-screen-reader')};");
  await screenshot("edh-markdown-resting.png");
  await check("rendering preserves source and isolates tables/code", async () => {
    assert.equal(await source(), text);
    const data=await liveEval("return {controls:root.querySelectorAll('.mlrt-markdown-task-control').length,tableControls:root.querySelectorAll('.mlrt-table .mlrt-markdown-task-control').length,tables:root.querySelectorAll('.mlrt-table').length,ackCount:win.__MLRT_HARNESS_MESSAGES.length};");
    assert.equal(data.controls,2); assert.equal(data.tableControls,0); assert.equal(data.tables,1); assert.equal(data.ackCount,0); return data;
  });
  await check("requested initial metrics are applied inside the real webview",async()=>{
    const actual=report.environment.live;
    assert.equal(parseFloat(actual.fontSize),largeMetrics?20:14);
    assert(Math.abs(parseFloat(actual.lineHeight)-(largeMetrics?30:18.9))<=0.5);
    assert.equal(actual.letterSpacing==="normal"?0:parseFloat(actual.letterSpacing),largeMetrics?1:0);
    return actual;
  });
  await check("marker reveal retains actual following glyph boxes and document geometry", async () => {
    const before=await geometry();const wraps=await wrapGeometry(); const transitions=[];
    for(const anchor of [text.indexOf("- Bullet"),text.indexOf("[ ]"),text.indexOf("[X]"),text.indexOf("***"),text.indexOf("  - Nested")+2,text.indexOf("\t- Tab")+1]) {
      await select(anchor); const after=await geometry(); assert.equal(after.source,text); assert.equal(after.height,before.height); assert.equal(after.scrollTop,before.scrollTop);
      let maxDelta=0;
      for(let i=0;i<before.glyphs.length;i++)for(const dimension of ["x","y","width","height"])maxDelta=Math.max(maxDelta,Math.abs(before.glyphs[i][dimension]-after.glyphs[i][dimension]));
      assert(maxDelta<=0.5,`glyph geometry drift ${maxDelta}`);
      const afterWraps=await wrapGeometry();let maxWrapDelta=0;
      for(let i=0;i<wraps.length;i++){assert.equal(afterWraps[i].rows.length,wraps[i].rows.length,"wrapped row count stable");for(let j=0;j<wraps[i].rows.length;j++){const a=wraps[i].rows[j],b=afterWraps[i].rows[j];assert.equal(a.from,b.from,"wrap start source offset stable");assert.equal(a.to,b.to,"wrap end source offset stable");for(const dimension of ["x","y","right"])maxWrapDelta=Math.max(maxWrapDelta,Math.abs(a[dimension]-b[dimension]));}}
      assert(maxWrapDelta<=0.5,`wrapped glyph drift ${maxWrapDelta}`);transitions.push({anchor,maxDelta,maxWrapDelta,markers:after.markerCount});
    }
    await screenshot("edh-markdown-revealed.png"); await select(0);return {before,wraps,transitions};
  });
  if(!geometryOnly) {
  await check("ordinary arrow navigation exposes each task character", async () => {
    const from=text.indexOf("[ ]"); await select(from-1);const right=[];for(let i=0;i<5;i++){await key(live,"ArrowRight","ArrowRight",39);right.push(await liveEval("return view.state.selection.main.head;"));}
    assert.deepEqual(right,[from,from+1,from+2,from+3,from+4]);const left=[];for(let i=0;i<5;i++){await key(live,"ArrowLeft","ArrowLeft",37);left.push(await liveEval("return view.state.selection.main.head;"));}
    assert.deepEqual(left,[from+3,from+2,from+1,from,from-1]);assert.equal(await source(),text);return {right,left};
  });
  await check("task marker Backspace edits one literal character and host Undo restores it", async () => {
    const from=text.indexOf("[ ]");await select(from+3);await key(live,"Backspace","Backspace",8);const expected=text.slice(0,from+2)+text.slice(from+3);await waitFor(async()=>await source()===expected,"literal Backspace edit");const undo=await hostUndo(text);return {deletedPosition:from+2,undo};
  });
  await check("trusted pointer task activation is one source edit and one real host Undo", async () => {
    await select(0);const prior=await liveEval("return view.state.selection.main.toJSON();");const ackBefore=await liveEval("return win.__MLRT_HARNESS_MESSAGES.length;");const point=await clickTask();const from=text.indexOf("[ ]")+1;const expected=text.slice(0,from)+"x"+text.slice(from+1);await waitFor(async()=>await source()===expected,"trusted task toggle");await waitFor(async()=>liveEval(`return win.__MLRT_HARNESS_MESSAGES.slice(${ackBefore}).some(message=>message.source==='webviewAck'&&message.text===${JSON.stringify(expected)});`),"task host acknowledgement");assert.deepEqual(await liveEval("return view.state.selection.main.toJSON();"),prior);const undo=await hostUndo(text);return {point,changedCodeUnit:from,undo};
  });
  await check("rapid toggles create two host Undo steps separate from preceding typing",async()=>{
    await select(0);await live.send("Input.insertText",{text:"q"});await waitFor(async()=>await source()==="q"+text,"preceding typing");await select(1);const count=await liveEval("return win.__MLRT_HARNESS_MESSAGES.length;");await clickTask();await clickTask();await waitFor(async()=>liveEval(`return win.__MLRT_HARNESS_MESSAGES.slice(${count}).filter(message=>message.source==='webviewAck').length>=2;`),"two task acknowledgements");assert.equal(await source(),"q"+text);await hostUndo("q"+text.replace("[ ]","[x]"));await hostUndo("q"+text);await hostUndo(text);return {toggles:2,undoSteps:3,typingSeparate:true};
  });
  await check("task pointer activation preserves a rectangular table selection",async()=>{
    await select(0);await liveEval("const cell=root.querySelector('.mlrt-table-cell[data-row-kind=\"body\"][data-row-index=\"0\"][data-column=\"0\"]');if(!cell)throw new Error('Missing table body cell');cell.focus();return true;");await key(live,"Escape","Escape",27);await key(live,"ArrowRight","ArrowRight",39,8);const before=await tableSelection();assert.equal(before.rectangle.length,2,"two-cell rectangular selection established");await screenshot("edh-markdown-table-selection.png");await clickTask();await waitFor(async()=>await source()===text.replace("[ ]","[x]"),"toggle while table owns selection");const after=await tableSelection();assert.deepEqual(after.rectangle,before.rectangle);assert.deepEqual(after.selection,before.selection);await hostUndo(text);const undone=await tableSelection();assert.deepEqual(undone.rectangle,before.rectangle,"host Undo retains rectangle");return {before,after,undone};
  });
  await check("checkbox-origin drag hands selection through prose into the table",async()=>{
    await select(0);const start=await pointOnTask();assert(start);const points=await liveEval(`const cell=root.querySelector('.mlrt-table-cell[data-row-kind="body"][data-column="1"]'),box=cell.getBoundingClientRect(),caret=view.coordsAtPos(${text.indexOf("After rule.")+5});return {prose:{x:caret.left+0.1,y:(caret.top+caret.bottom)/2},table:{x:box.left+10,y:box.top+box.height/2}};`);
    const messages=await liveEval("return win.__MLRT_HARNESS_MESSAGES.length;");
    for(const [type,point]of [["mousePressed",start],["mouseMoved",points.prose],["mouseMoved",points.table],["mouseReleased",points.table]]){await live.send("Input.dispatchMouseEvent",{type,x:point.x,y:point.y,button:"left",...(type==="mouseMoved"?{}:{clickCount:1})});await sleep(60);}
    const selection=await tableSelection();assert.equal(await source(),text);assert.equal(selection.selection.ranges[0].anchor,text.indexOf("[ ]"));assert(selection.selection.ranges[0].head>=text.indexOf("| Marker"));assert.equal(selection.mixed.length,4);assert.equal(await liveEval("return win.__MLRT_HARNESS_MESSAGES.length;"),messages);await screenshot("edh-markdown-checkbox-origin-drag.png");return {selection,sourcePreserved:true,taskNotToggled:true};
  });
  await check("task outside a mixed prose/table selection preserves its endpoints and cells",async()=>{
    if(mixedOnly){
      report.mixedBaseline=[];
      for(const enabled of [false,true]){
        await setRendering(enabled);await establishMixedSelection();
        await liveEval("win.__MLRT_BASELINE_TRACE=[];if(!win.__MLRT_BASELINE_LISTENER){win.__MLRT_BASELINE_LISTENER=()=>{const selection=win.getSelection();win.__MLRT_BASELINE_TRACE.push({time:Date.now(),selection:view.state.selection.toJSON(),native:{anchorText:selection?.anchorNode?.textContent?.slice(0,100),anchorOffset:selection?.anchorOffset,headText:selection?.focusNode?.textContent?.slice(0,100),headOffset:selection?.focusOffset}});};root.addEventListener('selectionchange',win.__MLRT_BASELINE_LISTENER,true);}return true;");
        const snapshots=[];const sample=async(label)=>snapshots.push({label,cm:await tableSelection(),native:await nativeSelection()});
        await sample('established');await sleep(500);await sample('idle-before-shot');await screenshot(`edh-markdown-mixed-baseline-${enabled?'on':'off'}.png`);await sample('immediate-after-shot');await sleep(500);await sample('idle-after-shot');
        const point=await liveEval(`const caret=view.coordsAtPos(${text.indexOf('[ ]')+1});return {x:caret.left+1,y:(caret.top+caret.bottom)/2};`);
        await live.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none'});await sleep(300);await sample('hover-only');
        report.mixedBaseline.push({enabled,snapshots,events:await liveEval("return win.__MLRT_BASELINE_TRACE;")});
      }
      console.log('MIXED BASELINE',JSON.stringify(report.mixedBaseline));
    }
    const before=await establishMixedSelection(true);assert(before.mixed.length>0,"mixed table cells selected");assert(before.selection.ranges.some(range=>range.anchor!==range.head),"mixed source endpoints are nonempty");
    if(mixedOnly)await liveEval(`win.__MLRT_MIXED_BEFORE=${JSON.stringify(before)};win.__MLRT_MIXED_TRACE=[];win.__MLRT_MIXED_DEBUG_INDEX=win.__MLRT_DEBUG_EVENTS__?.length??0;for(const type of ['pointerdown','pointerup','mousedown','mouseup','focusin','selectionchange'])for(const capture of [true,false])root.addEventListener(type,event=>{const selection=win.getSelection();if(win.__MLRT_MIXED_TRACE.length<60)win.__MLRT_MIXED_TRACE.push({type,capture,target:event.target?.className,owner:root.activeElement?.className,selection:view.state.selection.toJSON(),domSelection:{anchor:selection?.anchorNode?.nodeName,anchorClass:selection?.anchorNode?.parentElement?.className,anchorOffset:selection?.anchorOffset,head:selection?.focusNode?.nodeName,headClass:selection?.focusNode?.parentElement?.className,headOffset:selection?.focusOffset},prevented:event.defaultPrevented,pointer:view.plugins.find(plugin=>plugin.value&&Array.isArray(plugin.value.markers))?.value?.pointer?true:false});},capture);return true;`);
    await sleep(500);assert.deepEqual((await tableSelection()).selection,before.selection,"mixed source selection remains stable before checkbox activation");
    await liveEval("win.__MLRT_TASK_PRESS=null;root.addEventListener('pointerdown',event=>{const selection=win.getSelection();win.__MLRT_TASK_PRESS={target:event.target?.className,selection:view.state.selection.toJSON(),native:{anchorText:selection?.anchorNode?.textContent?.slice(0,100),anchorOffset:selection?.anchorOffset,headText:selection?.focusNode?.textContent?.slice(0,100),headOffset:selection?.focusOffset}};},{capture:true,once:true});return true;");
    await clickTask();const atPress=await liveEval("return win.__MLRT_TASK_PRESS;");assert.deepEqual(atPress.selection,before.selection,"mixed selection is intact at the actual checkbox pointerdown");await waitFor(async()=>await source()===text.replace("[ ]","[x]"),"task action outside mixed selection");const after=await tableSelection();assert.deepEqual(after.selection,before.selection,"task activation preserves mixed endpoints");assert.deepEqual(after.mixed,before.mixed,"task activation preserves selected table cells");await screenshot("edh-markdown-mixed-selection.png");await hostUndo(text);const undone=await tableSelection();return {direction:'prose-to-table',before,atPress,after,undone,undoSelectionPolicy:'Existing host Undo restores a source caret; reconstruction of the mixed range is not asserted.'};
  });
  await check("synthetic post-composition-end task action is rejected before host flush",async()=>{
    const anchor=text.indexOf("Task alpha")+5;await select(anchor);const expected=text.slice(0,anchor)+"Z"+text.slice(anchor);const immediate=await liveEval(`const index=win.__MLRT_HARNESS_MESSAGES.length;view.contentDOM.dispatchEvent(new win.CompositionEvent('compositionstart',{data:'',bubbles:true}));view.dispatch({changes:{from:${anchor},insert:'Z'}});view.contentDOM.dispatchEvent(new win.CompositionEvent('compositionend',{data:'Z',bubbles:true}));const nativeEnded=!view.compositionStarted;win.dispatchEvent(new win.MessageEvent('message',{data:{type:'markdownTaskCommand',action:'toggle'}}));return {source:view.state.doc.toString(),nativeEnded,hostMessages:win.__MLRT_HARNESS_MESSAGES.length-index};`);assert.equal(immediate.source,expected);assert.equal(immediate.nativeEnded,true,"CodeMirror composition ended before task request");await waitFor(async()=>liveEval(`return win.__MLRT_HARNESS_MESSAGES.some(message=>message.source==='webviewAck'&&message.text===${JSON.stringify(expected)});`),"composition flush acknowledgement");assert.equal(await source(),expected);await hostUndo(text);return {synthetic:true,realIME:false,nativeEnded:immediate.nativeEnded,taskSuppressed:true};
  });
  await check("host Command Palette focuses task; Space toggles and Escape restores bookmark", async () => {
    const anchor=text.indexOf("Task alpha")+5;await select(anchor);await palette("Markdown Live Editor: Focus Task Checkbox at Caret");await waitFor(async()=>liveEval("return root.activeElement?.matches('.mlrt-markdown-task-control');"),"task command focus");await screenshot("edh-markdown-focused.png");await key(live," ","Space",32,0," ");const expected=text.replace("[ ]","[x]");await waitFor(async()=>await source()===expected,"keyboard task activation");assert(await liveEval("return root.activeElement?.matches('.mlrt-markdown-task-control');"),"checkbox retains keyboard focus");await key(live,"Escape","Escape",27);await waitFor(async()=>liveEval(`return view.hasFocus && view.state.selection.main.head===${anchor};`),"source bookmark restoration");const undo=await hostUndo(text);return {anchor,undo};
  });
  await check("recovery toggle restores parser and appearance without editing source", async () => {
    await select(0);await liveEval("win.__MLRT_HARNESS_TABLE=root.querySelector('.mlrt-table');return true;");await setRendering(false);assert.equal(await source(),text);assert.equal(await liveEval("return root.querySelectorAll('.mlrt-markdown-marker,.mlrt-markdown-task-control').length;"),0);assert.equal(await liveEval("return root.querySelectorAll('.mlrt-table').length;"),1);assert(await liveEval("return win.__MLRT_HARNESS_TABLE===root.querySelector('.mlrt-table');"),"table DOM preserved while disabling");await screenshot("edh-markdown-disabled.png");await setRendering(true);await waitFor(async()=>liveEval("return root.querySelectorAll('.mlrt-markdown-task-control').length===2;"),"markers after re-enable");assert.equal(await source(),text);assert(await liveEval("return win.__MLRT_HARNESS_TABLE===root.querySelector('.mlrt-table');"),"table DOM preserved while enabling");return {sourcePreserved:true,tableDOMRetained:true,controlsRestored:true};
  });
  await check("disabling a keyboard-focused task releases to its source bookmark",async()=>{
    const anchor=text.indexOf("Task alpha")+2;await select(anchor);await palette("Markdown Live Editor: Focus Task Checkbox at Caret");await waitFor(async()=>liveEval("return root.activeElement?.matches('.mlrt-markdown-task-control');"),"focused control before disable");await setRendering(false);await waitFor(async()=>liveEval(`return view.hasFocus&&view.state.selection.main.head===${anchor};`),"owned focus release on disable");assert.equal(await source(),text);await setRendering(true);await select(0);return {anchor,sourcePreserved:true};
  });
  await check('focused external prefix insertion returns to the mapped source bookmark',async()=>{
    const anchor=await focusFirstTask(),prefix='External prefix.\n';
    try {
      await writeHostFixture(prefix+text);
      const state=await focusState();assert(state.sourceFocus,JSON.stringify(state));
      assert.deepEqual(state.selection.ranges,[{anchor:anchor+prefix.length,head:anchor+prefix.length}]);
      assert.equal(await source(),prefix+text);await screenshot('edh-markdown-external-focus.png');
      return {externalFileWrite:true,prefixLength:prefix.length,state};
    } finally { await writeHostFixture(text);await select(0); }
  });
  await check('focused external task deletion returns to a valid source boundary',async()=>{
    await focusFirstTask();const start=text.indexOf('- [ ]'),end=text.indexOf('\n',start)+1,expected=text.slice(0,start)+text.slice(end);
    try {
      await writeHostFixture(expected);
      const state=await focusState();assert(state.sourceFocus,JSON.stringify(state));
      // Host reload applies a minimal text replacement: the following task
      // shares the first three characters "- [", so that prefix survives.
      const mappedBoundary=start+3;
      assert.deepEqual(state.selection.ranges,[{anchor:mappedBoundary,head:mappedBoundary}]);
      assert.equal(await liveEval("return root.querySelectorAll('.mlrt-markdown-task-control[aria-label^=\"Task alpha\"]').length;"),0);
      return {externalFileWrite:true,deleted:{from:start,to:end},mappedBoundary,state};
    } finally { await writeHostFixture(text);await select(0); }
  });
  await check('newer source range supersedes the focused checkbox bookmark on disable',async()=>{
    await focusFirstTask();const expected={ranges:[{anchor:10,head:20}],main:0};
    await liveEval('view.dispatch({selection:{anchor:10,head:20}});return true;');
    const before=await focusState();assert.deepEqual(before.selection,expected);
    try {
      await setRendering(false);const after=await focusState();assert.deepEqual(after.selection,expected);assert(after.sourceFocus,JSON.stringify(after));
      assert.equal(await source(),text);return {before,after,sourcePreserved:true};
    } finally { await setRendering(true);await select(0); }
  });
  await check('newer source range maps through external replacement without obsolete bookmark restoration',async()=>{
    await focusFirstTask();const prefix='External prefix.\n';
    await liveEval('view.dispatch({selection:{anchor:10,head:20}});return true;');
    const before=await focusState();assert.deepEqual(before.selection.ranges,[{anchor:10,head:20}]);
    try {
      await writeHostFixture(prefix+text);const after=await focusState();assert(after.sourceFocus,JSON.stringify(after));
      assert.deepEqual(after.selection.ranges,[{anchor:10+prefix.length,head:20+prefix.length}]);
      return {externalFileWrite:true,before,after};
    } finally { await writeHostFixture(text);await select(0); }
  });
  await check('focused checkbox viewport eviction releases focus without scrolling back',async()=>{
    const large=text+'\n'+Array.from({length:2000},(_,index)=>`- [ ] Offscreen task ${index}`).join('\n')+'\n';
    try {
      await writeHostFixture(large);const anchor=await focusFirstTask();
      const target=await liveEval("win.__MLRT_EVICTED_CONTROL=root.activeElement;const box=view.scrollDOM.getBoundingClientRect();return {x:box.right-40,y:box.top+Math.min(300,box.height/2)};");
      const messages=await liveEval('return win.__MLRT_HARNESS_MESSAGES.length;');
      await live.send('Input.dispatchMouseEvent',{type:'mouseWheel',...target,deltaX:0,deltaY:3000});
      await waitFor(async()=>liveEval(`return view.scrollDOM.scrollTop>1500&&!view.visibleRanges.some(range=>range.from<=${anchor}&&range.to>=${anchor});`),'focused task outside actual viewport');
      await sleep(400);const before=await focusState();await sleep(500);const after=await focusState();
      assert(after.sourceFocus,JSON.stringify(after));assert.deepEqual(after.selection.ranges,[{anchor,head:anchor}]);
      assert(Math.abs(after.scrollTop-before.scrollTop)<=0.5,'focus release must not scroll back');
      const projection=await liveEval("const plugin=view.plugins.find(plugin=>plugin.value&&Array.isArray(plugin.value.markers))?.value;return {oldControlConnected:win.__MLRT_EVICTED_CONTROL.isConnected,oldControlPresent:!!root.querySelector('[data-markdown-task-from=\"118\"]'),markers:plugin?.markers.length,sizes:plugin?.sizes.size,controls:root.querySelectorAll('.mlrt-markdown-task-control').length};");
      assert.equal(projection.oldControlConnected,false);assert.equal(projection.oldControlPresent,false);assert(projection.controls<500,'viewport projection must not mount all2000 task controls');
      assert.equal(await source(),large);assert.equal(await liveEval('return win.__MLRT_HARNESS_MESSAGES.length;'),messages);await screenshot('edh-markdown-viewport-eviction.png');
      await liveEval('view.scrollDOM.scrollTop=0;return true;');await waitFor(async()=>liveEval("return !!root.querySelector('.mlrt-markdown-task-control[aria-label^=\"Task alpha\"]');"),'task control recreated after scrolling back');
      return {fixtureTasks:2002,before,after,projection,sourcePreserved:true};
    } finally { await writeHostFixture(text);await select(0); }
  });
  await check('host accessibility mode releases task focus and restores literal source',async()=>{
    const anchor=await focusFirstTask();await liveEval("win.__MLRT_ACCESSIBILITY_TABLE=root.querySelector('.mlrt-table');return true;");
    try {
      await writeFile(path.join(user,'settings.json'),JSON.stringify({...initialSettings,'editor.accessibilitySupport':'on'},null,2));
      await waitFor(async()=>liveEval('return win.__MLRT_HARNESS_OPTIONS?.markdownRendering?.screenReaderOptimized===true;'),'host accessibility setting propagation');
      await waitFor(async()=>liveEval("return root.querySelectorAll('.mlrt-markdown-marker,.mlrt-markdown-task-control').length===0;"),'accessibility literal fallback');
      const state=await focusState();assert(state.sourceFocus,JSON.stringify(state));assert.deepEqual(state.selection.ranges,[{anchor,head:anchor}]);
      assert.equal(await source(),text);assert(await liveEval("return win.__MLRT_ACCESSIBILITY_TABLE===root.querySelector('.mlrt-table');"));await screenshot('edh-markdown-accessibility-source.png');
      return {actualHostSetting:true,actualScreenReader:false,state,sourcePreserved:true,tableDOMRetained:true};
    } finally {
      await writeFile(path.join(user,'settings.json'),JSON.stringify({...initialSettings,'editor.accessibilitySupport':'off'},null,2));
      await waitFor(async()=>liveEval('return win.__MLRT_HARNESS_OPTIONS?.markdownRendering?.screenReaderOptimized===false;'),'accessibility mode recovery');await select(0);
      await waitFor(async()=>liveEval("return root.querySelectorAll('.mlrt-markdown-task-control').length===2;"),'task controls after accessibility recovery');
    }
  });
  await check("Markdown Enter continuation stays usable with rendering on and off", async () => {
    const states=[];for(const enabled of [true,false]){await setRendering(enabled);const at=text.indexOf("\n",text.indexOf("- Bullet"));await select(at);await key(live,"Enter","Enter",13,0,"\r");const expected=text.slice(0,at)+"\n- "+text.slice(at);await waitFor(async()=>await source()===expected,`Markdown continuation enabled=${enabled}`);await hostUndo(text);states.push({enabled,continued:true});}await setRendering(true);return states;
  });
  await check("live light/high-contrast theme updates retain source and table DOM",async()=>{
    await select(0);await liveEval("win.__MLRT_HARNESS_TABLE=root.querySelector('.mlrt-table');return true;");const themes=[];
    for(const [name,kind] of [["Default Light Modern","vscode-light"],["Default High Contrast","vscode-high-contrast"],["Default Dark Modern","vscode-dark"]]){
      await writeFile(path.join(user,"settings.json"),JSON.stringify({...initialSettings,"workbench.colorTheme":name},null,2));await waitFor(async()=>liveEval(`return root.body.dataset.vscodeThemeKind===${JSON.stringify(kind)};`),`theme ${name}`);await sleep(250);assert.equal(await source(),text);assert(await liveEval("return win.__MLRT_HARNESS_TABLE===root.querySelector('.mlrt-table');"),"theme must retain table DOM");themes.push(await liveEval("return {theme:root.body.dataset.vscodeThemeId,kind:root.body.dataset.vscodeThemeKind,controls:root.querySelectorAll('.mlrt-markdown-task-control').length};"));await screenshot(`edh-markdown-theme-${kind}.png`);
    }return {themes,tableDOMRetained:true,sourcePreserved:true};
  });
  await check("unsafe bidi marker geometry releases a focused control to source",async()=>{
    const anchor=text.indexOf("Task alpha")+2;await select(anchor);await palette("Markdown Live Editor: Focus Task Checkbox at Caret");await waitFor(async()=>liveEval("return root.activeElement?.matches('.mlrt-markdown-task-control');"),"task focused before unsafe geometry");
    const position=text.indexOf("\n",text.indexOf("Task alpha"));const expected=text.slice(0,position)+" \u05d0"+text.slice(position);
    const bidi=await liveEval(`view.dispatch({changes:{from:${position},insert:' \u05d0'}});return view.bidiSpans(view.state.doc.lineAt(${anchor})).map(span=>span.level);`);assert(bidi.some(level=>level%2===1),"actual task source line has unsafe bidi geometry");
    await waitFor(async()=>liveEval(`return !root.activeElement?.matches('.mlrt-markdown-task-control')&&view.hasFocus&&view.state.selection.main.head===${anchor};`),"unsafe bidi geometry focus recovery");assert.equal(await source(),expected);await hostUndo(text);await select(0);return {bidiLevels:bidi,expectedSourceEditOnly:true,bookmark:anchor};
  });
  await check("host rejects a task after file becomes read-only", async () => {
    await select(0);await chmod(fixture,0o444);const index=await liveEval("return win.__MLRT_HARNESS_MESSAGES.length;");await clickTask();await waitFor(async()=>liveEval(`return win.__MLRT_HARNESS_MESSAGES.slice(${index}).some(message=>message.source==='webviewReject');`),"authoritative read-only rejection");assert.equal(await source(),text);assert.equal(await readFile(fixture,"utf8"),text);return liveEval("return {readOnly:win.__MLRT_HARNESS_OPTIONS?.markdownRendering?.readOnly,last:win.__MLRT_HARNESS_MESSAGES.at(-1)?.source};");
  });
  await chmod(fixture,0o666);
  await check("injected rendering update failure leaves editable source and protected tables",async()=>{
    await select(0);await setRendering(false);await setRendering(true);await liveEval("const plugin=view.plugins.find(plugin=>plugin.value&&Array.isArray(plugin.value.markers))?.value;if(!plugin)throw new Error('Marker plugin unavailable');plugin.classify=()=>{throw new Error('Intentional feasibility classification failure');};plugin.tree=null;view.dispatch({});return true;");await sleep(200);assert.equal(await source(),text);assert.equal(await liveEval("return root.querySelectorAll('.mlrt-markdown-marker,.mlrt-markdown-task-control').length;"),0);assert.equal(await liveEval("return root.querySelectorAll('.mlrt-table').length;"),1);await select(text.length);await live.send("Input.insertText",{text:"z"});await waitFor(async()=>await source()===text+"z","source input after renderer fault");await hostUndo(text);await screenshot("edh-markdown-failure-fallback.png");await setRendering(false);await setRendering(true);return {fault:"classification update",sourceInputUsable:true,hostUndoUsable:true,tablesPreserved:true};
  });
  }
  await screenshot("edh-markdown-final.png");
  report.finalSourceMatches = await source() === text;
  report.runtimeErrors=await liveEval("return win.__MLRT_DEBUG_EVENTS__?.filter(event=>/error|fail/i.test(event.event)).map(event=>({event:event.event,details:event.details}));");
  report.console={expectedFaultWarnings:live.events.filter(event=>event.text?.includes("Markdown rendering disabled for this view after a presentation failure.")),unexpected:live.events.filter(event=>!event.text?.includes("Markdown rendering disabled for this view after a presentation failure."))};
} catch(error) { results.push({name:"harness initialization/completion",pass:false,error:String(error),childExit});console.error(error); }
finally {
  await chmod(fixture,0o666).catch(()=>{});
  report.passed=results.every(result=>result.pass)&&(!report.console||report.console.unexpected.length===0);
  await writeFile(path.join(qa,`edh-markdown-rendering-results${variant}.json`),JSON.stringify(report,null,2));
  for(const client of clients)client.socket.close();
  child.kill();
  console.log(`Saved qa/edh-markdown-rendering-results${variant}.json; ${results.filter(result=>result.pass).length}/${results.length} checks passed.`);
  if(!report.passed)process.exitCode=1;
}
