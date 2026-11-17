// Wikilinks in a workspace folder, in a real, isolated VS Code window.
// Run `npm run compile` first. The folder is written into a temporary profile.
//
// Every section starts from the Home note and is reported on its own. The
// folder is compared with what was written at the end: following links,
// dimming missing ones and listing the folder must create and change nothing.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";
import { edhLaunchFlags, edhSettings, resolveEdhExecutable } from "./edh-isolation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const qa = path.join(repo, "qa");
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-wikilink-"));
const vault = path.join(profile, "vault");
const user = path.join(profile, "User"), extensions = path.join(profile, "extensions");
const port = await new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
});

const filler = (label, count) => Array.from({ length: count }, (_, index) => `${label} line ${index + 1}.`).join("\n\n");
const home = [
  "# Home", "",
  "Existing: [[Alpha]] and [[deep note|Deep alias]] and [[Plan#Milestones]].", "",
  "Missing: [[Ghost]] and [[Ghost#Section|aliased ghost]].", "",
  "Same note: [[#Far heading]].", "",
  "Standard: [standard link](notes/Deep%20Note.md).", "",
  "Duplicate: [[Beta]].", "",
  "Text file: [data file](data.txt).", "",
  filler("Home", 60), "",
  "## Far heading", "", "After the far heading.", "", filler("Tail", 40), "",
].join("\n");
const plan = [
  "# Plan", "", "Root wins: [[Alpha]].", "", filler("Plan", 60), "",
  "## Milestones", "", "Milestone text.", "", filler("More", 40), "",
].join("\n");
const files = {
  "Home.md": home,
  "Alpha.md": "# Alpha at the root\n",
  "projects/Alpha.md": "# Alpha in projects\n",
  "projects/Plan.md": plan,
  "projects/Beta.md": "# Beta in projects\n",
  "archive/Beta.md": "# Beta in archive\n",
  "notes/Deep Note.md": "# Deep note\n",
  "data.txt": "plain data\n",
};
const settings = { ...edhSettings,
  "workbench.startupEditor": "none", "window.restoreWindows": "none", "security.workspace.trust.enabled": false,
  "editor.wordWrap": "on", "editor.fontFamily": "Consolas, 'Courier New', monospace", "editor.fontSize": 14 };
await Promise.all([mkdir(qa, { recursive: true }), mkdir(user, { recursive: true }), mkdir(extensions, { recursive: true })]);
for (const [name, text] of Object.entries(files)) {
  await mkdir(path.dirname(path.join(vault, name)), { recursive: true });
  await writeFile(path.join(vault, name), text);
}
await writeFile(path.join(user, "settings.json"), JSON.stringify(settings, null, 2));

/** Every file under the folder with its text, to show nothing was written. */
async function snapshot(directory = vault, prefix = "") {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshot(path.join(directory, entry.name), `${name}/`));
    else result[name] = await readFile(path.join(directory, entry.name), "utf8");
  }
  return result;
}

const code = resolveEdhExecutable(repo);
if (!code) throw new Error("VS Code executable not found; set MLRT_CODE_BIN.");
const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: "1" };
for (const key of Object.keys(env)) if (key.startsWith("npm_") || ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"].includes(key)) delete env[key];
const child = spawn(code, [...edhLaunchFlags, `--extensionDevelopmentPath=${repo}`, `--user-data-dir=${profile}`,
  `--extensions-dir=${extensions}`, `--remote-debugging-port=${port}`, "--new-window", "--disable-workspace-trust",
  "--skip-release-notes", "--skip-welcome", vault, path.join(vault, "Home.md")], { stdio: "ignore", env, windowsHide: true });

const sockets = new Set(), checks = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(probe, label, timeout = 15000) {
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
  const socket = new WebSocket(url), pending = new Map();
  let id = 0;
  sockets.add(socket);
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(Error(JSON.stringify(message.error))); else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  return { socket, send(method, params = {}) { return new Promise((resolve, reject) => {
    const current = ++id, timer = setTimeout(() => { pending.delete(current); reject(Error(`CDP timeout: ${method}`)); }, 5000);
    pending.set(current, { resolve, reject, timer }); socket.send(JSON.stringify({ id: current, method, params }));
  }); } };
}
async function evaluate(client, expression) {
  const value = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || JSON.stringify(value.exceptionDetails));
  return value.result?.value;
}
const rootCode = `const roots=[document,...Array.from(document.querySelectorAll('iframe')).map(frame=>{try{return frame.contentDocument;}catch{return null;}}).filter(Boolean)];const root=roots.find(doc=>doc.defaultView.__MLRT_EDITOR_VIEW__);if(!root)return null;const win=root.defaultView,view=win.__MLRT_EDITOR_VIEW__;`;
let wb, live;
const liveClients = new Map();
const liveEval = body => evaluate(live, `(()=>{${rootCode}${body}})()`);
const workbench = expression => evaluate(wb, expression);
async function key(key, code, vk, modifiers = 0) {
  await wb.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
  await wb.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(100);
}
async function palette(title) {
  await key("F1", "F1", 112); await sleep(180); await wb.send("Input.insertText", { text: title });
  await waitFor(() => workbench(`Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row')).some(row=>row.textContent.includes(${JSON.stringify(title)}))`), `palette command ${title}`, 20000);
  await key("Enter", "Enter", 13); await sleep(450);
}
async function screenshot(name) {
  const shot = await wb.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(qa, `wikilink-${name}.png`), Buffer.from(shot.data, "base64"));
}
const tabs = () => workbench("Array.from(document.querySelectorAll('.tabs-container .tab')).map(tab=>tab.textContent)");
const activeTab = () => workbench("document.querySelector('.tabs-container .tab.active')?.textContent ?? ''");
const pickerOpen = () => workbench("(()=>{const widget=document.querySelector('.quick-input-widget');return !!widget&&getComputedStyle(widget).display!=='none';})()");

/** The live editor whose document starts with `prefix`, once its tab is the active one. */
async function liveShowing(prefix, tabName) {
  await waitFor(async () => (await activeTab()).includes(tabName), `active tab ${tabName}`);
  live = await waitFor(async () => {
    const listed = (await targets()).filter(item => item.type !== "service_worker" && /vscode-webview/.test(item.url) && item.webSocketDebuggerUrl);
    for (const [id, client] of liveClients) {
      if (!listed.some(item => item.id === id)) { client.socket.close(); liveClients.delete(id); }
    }
    for (const item of listed) {
      let client = liveClients.get(item.id);
      if (!client) { client = await connect(item.webSocketDebuggerUrl); liveClients.set(item.id, client); }
      try {
        if (await evaluate(client, `(()=>{${rootCode}return view.state.doc.sliceString(0,${prefix.length})===${JSON.stringify(prefix)};})()`)) return client;
      } catch { /* a webview that is starting or closing has no editor yet */ }
    }
    return null;
  }, `a live editor holding ${JSON.stringify(prefix)}`);
  await sleep(350);
  return live;
}
async function showTab(name) {
  const point = await workbench(`(()=>{const tab=Array.from(document.querySelectorAll('.tabs-container .tab')).find(each=>each.textContent.includes(${JSON.stringify(name)}));if(!tab)return null;const box=tab.getBoundingClientRect();return {x:box.left+Math.min(40,box.width/2),y:box.top+box.height/2};})()`);
  assert(point, `no tab named ${name}`);
  await wb.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...point });
  await wb.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...point });
}
async function select(position) {
  await liveEval(`view.dispatch({selection:{anchor:${position}},scrollIntoView:true});view.focus();return true;`);
  await sleep(250);
}
/** Back to the Home note with the caret on its title, away from every link. */
async function goHome() {
  await key("Escape", "Escape", 27);
  await showTab("Home.md");
  await liveShowing("# Home", "Home.md");
  await select(0);
  await liveEval("view.scrollDOM.scrollTop=0;return true;");
  await sleep(200);
}
/** A plain click on the rendered text at a source position. */
async function click(position) {
  const point = await liveEval(`const at=view.domAtPos(${position});const range=root.createRange();range.setStart(at.node,at.offset);range.setEnd(at.node,at.offset+1);const box=range.getBoundingClientRect();const frame=Array.from(document.querySelectorAll('iframe')).find(each=>each.contentDocument===root)?.getBoundingClientRect();return {x:box.left+box.width/2+(frame?.left??0),y:box.top+box.height/2+(frame?.top??0)};`);
  await live.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...point });
  await live.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...point });
}
/** Runs the link command with the caret inside the link at `needle`. */
async function follow(source, needle) {
  await select(source.indexOf(needle) + 3);
  await palette("Markdown Live Editor: Open Markdown Link at Caret");
}
/** The text of the line under the caret and of the line at the top of the view. */
const where = () => liveEval(`const top=view.scrollDOM.getBoundingClientRect().top;const block=view.lineBlockAtHeight(Math.max(0,top-view.documentTop)+2);return {caret:view.state.doc.lineAt(view.state.selection.main.head).text,top:view.state.doc.lineAt(block.from).text,scrollTop:Math.round(view.scrollDOM.scrollTop)};`);
const dimmed = () => liveEval("return Array.from(root.querySelectorAll('.mlrt-markdown-link-unresolved')).map(element=>element.textContent).join('|');");
// `--case=<part of a name>[,<another>]` runs the sections whose name contains one of the parts.
const caseFilter = process.argv.find(argument => argument.startsWith("--case="))?.slice(7).split(",");
async function check(name, action) {
  if (caseFilter && !caseFilter.some(part => name.includes(part))) return;
  try { const detail = await action(); checks.push({ name, pass: true, detail }); console.log(`PASS ${name}`, JSON.stringify(detail ?? {})); }
  catch (error) {
    checks.push({ name, pass: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`);
    await screenshot(`failure-${checks.length}`).catch(() => {});
  }
}

try {
  console.log(`Wikilink EDH port ${port}; profile ${profile}`);
  const before = await snapshot();
  const target = await waitFor(async () => (await targets()).find(item => item.type === "page" && /workbench\.html/.test(item.url)), "workbench", 60000);
  wb = await connect(target.webSocketDebuggerUrl); await wb.send("Page.enable"); await sleep(1800);
  await key("Escape", "Escape", 27);
  await waitFor(() => workbench("!!document.querySelector('.monaco-editor .view-lines .view-line')"), "stock editor", 30000);
  await palette("Markdown Live Editor: Toggle Markdown Live Editor");
  await liveShowing("# Home", "Home.md");
  await select(0);
  // Home keeps its tab whatever a followed link does to preview tabs.
  await palette("View: Keep Editor");

  await check("a wikilink to a note that does not exist is dimmed, and no other link is", async () => {
    await goHome();
    const text = await waitFor(async () => { const value = await dimmed(); return value.includes("Ghost") && value.includes("aliased ghost") ? value : null; }, "missing links dimmed");
    for (const resolved of ["Alpha", "Deep alias", "Plan#Milestones", "Far heading", "standard link", "Beta"]) {
      assert(!text.includes(resolved), `${resolved} must not be dimmed: ${text}`);
    }
    const styles = await liveEval(`const style=element=>win.getComputedStyle(element);const missing=root.querySelector('.mlrt-markdown-link-unresolved');const links=Array.from(root.querySelectorAll('.mlrt-markdown-role-link'));const found=links.find(element=>element.textContent.includes('Alpha'));const opacityAround=element=>{let value=1;for(let each=element;each&&each!==view.contentDOM;each=each.parentElement)value*=Number(style(each).opacity);return value;};return {missing:Number(style(missing).opacity),found:opacityAround(found),sameLineHeight:Math.abs(missing.closest('.cm-line').getBoundingClientRect().height-found.closest('.cm-line').getBoundingClientRect().height)};`);
    assert.equal(styles.missing, 0.7); assert.equal(styles.found, 1);
    assert(styles.sameLineHeight < 0.01, "dimming does not change a line's height");
    await screenshot("dimmed");
    return { dimmed: text, ...styles };
  });

  await check("creating the note lights the link, and deleting it dims the link again", async () => {
    await goHome();
    await waitFor(async () => (await dimmed()).includes("Ghost"), "dimmed before the note exists");
    await writeFile(path.join(vault, "Ghost.md"), "# Ghost\n");
    try {
      await waitFor(async () => (await dimmed()) === "", "no link dimmed once Ghost.md exists", 20000);
    } finally { await rm(path.join(vault, "Ghost.md"), { force: true }); }
    await waitFor(async () => (await dimmed()).includes("aliased ghost"), "dimmed again after the note is deleted", 20000);
    return { created: true, deleted: true };
  });

  await check("a file created elsewhere leaves the dimmed links dimmed the whole time", async () => {
    await goHome();
    const expected = await waitFor(async () => { const value = await dimmed(); return value.includes("aliased ghost") ? value : null; }, "missing links dimmed");
    // Every state the document's DOM passes through is recorded, so a link
    // that lights up between the notice and the new answer is seen.
    await liveEval(`win.__MLRT_DIM_LOG=[];win.__MLRT_NOTICES=0;win.__MLRT_ANSWERS=0;
      const sample=()=>win.__MLRT_DIM_LOG.push(Array.from(root.querySelectorAll('.mlrt-markdown-link-unresolved')).map(element=>element.textContent).join('|'));
      win.__MLRT_DIM_OBSERVER=new win.MutationObserver(sample);
      win.__MLRT_DIM_OBSERVER.observe(view.contentDOM,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
      win.addEventListener('message',event=>{if(event.data?.type==='wikiLinksChanged')win.__MLRT_NOTICES++;else if(event.data?.type==='wikiLinkStatus'&&win.__MLRT_NOTICES)win.__MLRT_ANSWERS++;});
      sample();return true;`);
    await writeFile(path.join(vault, "Unrelated.md"), "# Unrelated\n");
    let log;
    try {
      await waitFor(() => liveEval("return win.__MLRT_NOTICES>0&&win.__MLRT_ANSWERS>0;"), "the editor was told the folder changed and asked again", 20000);
      await sleep(400);
      log = await liveEval("win.__MLRT_DIM_OBSERVER.disconnect();return {states:win.__MLRT_DIM_LOG,notices:win.__MLRT_NOTICES,answers:win.__MLRT_ANSWERS};");
    } finally { await rm(path.join(vault, "Unrelated.md"), { force: true }); }
    assert(log.states.every(state => state === expected), `a dimmed link changed in between: ${JSON.stringify([...new Set(log.states)])}`);
    // Let the deletion's own notice and answer pass before the next section.
    await sleep(1500);
    return { statesSeen: log.states.length, notices: log.notices, answers: log.answers };
  });

  await check("a plain click on a link to a heading of the same note moves the caret there", async () => {
    await goHome();
    await click(home.indexOf("Far heading") + 2);
    const position = await waitFor(async () => { const value = await where(); return value.caret === "## Far heading" && value.top === "## Far heading" ? value : null; }, "caret and view at the far heading");
    assert.deepEqual(await tabs(), [await activeTab()], "no other editor opened");
    assert((await activeTab()).includes("Home.md"));
    assert.equal(await liveEval("return view.state.doc.toString();"), home, "the document is unchanged");
    await screenshot("same-note-heading");
    return position;
  });

  await check("a note opens in the live editor at the heading the link names", async () => {
    await goHome();
    await follow(home, "[[Plan#Milestones]]");
    await liveShowing("# Plan", "Plan.md");
    const position = await waitFor(async () => { const value = await where(); return value.caret === "## Milestones" && value.top === "## Milestones" ? value : null; }, "caret and view at Milestones");
    assert.equal((await tabs()).filter(tab => tab.includes("Plan.md")).length, 1, "one editor for the note");
    await screenshot("opened-at-heading");
    // Reported, not required: whether the opened editor has the keyboard.
    return { ...position, editorHasFocus: await liveEval("return view.hasFocus;") };
  });

  await check("the note at the folder's root wins over the one beside the linking note", async () => {
    await goHome();
    await follow(home, "[[Plan#Milestones]]");
    await liveShowing("# Plan", "Plan.md");
    await follow(plan, "[[Alpha]]");
    await liveShowing("# Alpha at the root", "Alpha.md");
    assert.equal(await pickerOpen(), false);
    return { opened: await liveEval("return view.state.doc.toString();") };
  });

  await check("two notes of one name open one of them by rule, with no question asked", async () => {
    await goHome();
    await follow(home, "[[Beta]]");
    await liveShowing("# Beta in archive", "Beta.md");
    assert.equal(await pickerOpen(), false, "no picker");
    return { opened: await liveEval("return view.state.doc.toString();") };
  });

  await check("a note that is already open is shown again at the heading", async () => {
    await goHome();
    await follow(home, "[[Plan#Milestones]]");
    await liveShowing("# Plan", "Plan.md");
    await select(0);
    await liveEval("view.scrollDOM.scrollTop=0;return true;");
    assert.equal((await where()).caret, "# Plan");
    await goHome();
    await click(home.indexOf("Plan#Milestones") + 2);
    await liveShowing("# Plan", "Plan.md");
    const position = await waitFor(async () => { const value = await where(); return value.caret === "## Milestones" && value.top === "## Milestones" ? value : null; }, "the open note moved to Milestones");
    assert.equal((await tabs()).filter(tab => tab.includes("Plan.md")).length, 1, "the open editor was reused");
    return position;
  });

  await check("an ordinary Markdown link to a note that is not open opens it in the live editor", async () => {
    await goHome();
    assert.equal((await tabs()).some(tab => tab.includes("Deep Note.md")), false, "the note is not open yet");
    await click(home.indexOf("standard link") + 2);
    await liveShowing("# Deep note", "Deep Note.md");
    assert.equal((await tabs()).filter(tab => tab.includes("Deep Note.md")).length, 1);
    // Reported, not required: which tabs the followed links left open.
    return { tabs: await tabs() };
  });

  await check("a link to a file that is not Markdown opens the ordinary editor, and the note it was followed from still answers", async () => {
    // The file replaces a preview tab that holds a live editor. Opening over
    // such a tab is what once left the linking note's queue waiting for ever.
    await goHome();
    await follow(home, "[[Plan#Milestones]]");
    await liveShowing("# Plan", "Plan.md");
    await goHome();
    await click(home.indexOf("data file") + 2);
    await waitFor(async () => (await activeTab()).includes("data.txt"), "the text file's tab");
    assert(await workbench("!!document.querySelector('.monaco-editor .view-lines .view-line')"), "it opened in the ordinary editor");
    await goHome();
    await click(home.indexOf("Far heading") + 2);
    const position = await waitFor(async () => { const value = await where(); return value.caret === "## Far heading" ? value : null; }, "the linking note still follows a link");
    return { ...position, tabs: await tabs() };
  });

  await check("a missing note is reported and not created", async () => {
    await goHome();
    const tabsBefore = await tabs();
    await follow(home, "[[Ghost]]");
    // A toast is drawn on an animation frame, and a window that another one
    // covers draws none; VS Code then shows the text in the status bar. Either is the report.
    const message = await waitFor(() => workbench("(()=>{for(const element of document.querySelectorAll('.notifications-toasts, .notifications-center, .statusbar')){const at=element.textContent.indexOf('The note');if(at>=0&&element.textContent.includes('was not found'))return element.textContent.slice(at,at+90);}return null;})()"), "the not-found report");
    assert(message.includes("Ghost"), message);
    assert.deepEqual(await tabs(), tabsBefore, "nothing opened");
    assert.equal(existsSync(path.join(vault, "Ghost.md")), false, "the note was not created");
    await key("Escape", "Escape", 27);
    return { message };
  });

  await check("the folder holds exactly the files it started with, unchanged", async () => {
    assert.deepEqual(await snapshot(), before);
    return { files: Object.keys(before).length };
  });

  await writeFile(path.join(qa, "wikilink-results.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter(each => !each.pass);
  console.log(`${checks.length - failed.length} of ${checks.length} wikilink checks passed.`);
  if (failed.length) process.exitCode = 1;
} finally {
  if (wb) void evaluate(wb, "window.close()").catch(() => {});
  await sleep(300);
  for (const socket of sockets) socket.close();
  child.kill();
}
