// Compare actual rendered token styles in stock Monaco and the live webview
// in one isolated VS Code window, using the user's standard Markdown fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";

const repo = fileURLToPath(new URL("../", import.meta.url));
const qa = path.join(repo, "qa");
const profile = mkdtempSync(path.join(os.tmpdir(), "mlrt-code-colors-"));
const user = path.join(profile, "User");
const port = 9700 + Math.floor(Math.random() * 200);
const fixture = path.join(profile, "standard-markdown-fixture.md");
const source = (await readFile(path.join(repo, "standard-markdown-fixture.md"), "utf8")).replace(/\r\n?/g, "\n");
const lines = source.split("\n");
const blocks = [...source.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].filter(match => match[1] && match[1] !== "txt").map(match => {
  const from = match.index + match[0].indexOf("\n") + 1;
  return { language: match[1], from, body: match[2], line: source.slice(0, from).split("\n").length };
});
const settings = {
  "workbench.startupEditor": "none", "workbench.colorTheme": "Dark+",
  "editor.minimap.enabled": false, "editor.wordWrap": "off", "editor.fontSize": 14,
  "editor.renderWhitespace": "none", "editor.bracketPairColorization.enabled": false,
  "editor.colorDecorators": false,
  "markdownLiveRenderTables.debug": true,
};
await mkdir(qa, { recursive: true });
await mkdir(user, { recursive: true });
await mkdir(path.join(profile, "extensions"), { recursive: true });
await writeFile(fixture, source);
await writeFile(path.join(user, "settings.json"), JSON.stringify(settings));
const code = process.env.MLRT_CODE_BIN || [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code", "/usr/share/code/code",
].filter(Boolean).find(existsSync);
assert(code, "VS Code executable is required");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(code, [`--extensionDevelopmentPath=${repo}`, `--user-data-dir=${profile}`,
  `--extensions-dir=${path.join(profile, "extensions")}`, `--remote-debugging-port=${port}`,
  "--new-window", "--disable-workspace-trust", "--skip-release-notes", "--skip-welcome", fixture],
{ stdio: "ignore", env, windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
const report = { checks: [], profile, port };
const snapshots = new Map(), configurations = new Map();
async function waitFor(probe, label, timeout = 20000) {
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
  let id = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const client = { socket, send(method, params = {}) {
    return new Promise((resolve, reject) => { const current = ++id; pending.set(current, { resolve, reject }); socket.send(JSON.stringify({ id: current, method, params })); });
  } };
  clients.push(client);
  return client;
}
async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function key(client, key, code, vk, modifiers = 0) {
  const value = { key, code, windowsVirtualKeyCode: vk, modifiers };
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...value });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...value });
  await sleep(90);
}
async function palette(title) {
  await key(wb, "F1", "F1", 112);
  await wb.send("Input.insertText", { text: title });
  await sleep(300);
  await key(wb, "Enter", "Enter", 13);
  await sleep(400);
}
const rootCode = `const roots=[document,...Array.from(document.querySelectorAll('iframe')).map(frame=>{try{return frame.contentDocument;}catch{return null;}}).filter(Boolean)]; const root=roots.find(doc=>doc.defaultView.__MLRT_EDITOR_VIEW__);if(!root)return null;const win=root.defaultView,view=win.__MLRT_EDITOR_VIEW__;`;
async function liveEval(body) { return evaluate(live, `(()=>{${rootCode}${body}})()`); }
async function screenshot(name) {
  const result = await wb.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(qa, `edh-code-${name}.png`), Buffer.from(result.data, "base64"));
}
const stylesCode = `const styles=element=>{const css=getComputedStyle(element);const decoration=new Set();for(let parent=element;parent;parent=parent.parentElement){for(const value of getComputedStyle(parent).textDecorationLine.split(' '))if(value!=='none')decoration.add(value);if(parent.matches('.cm-line,.view-line'))break;}return {color:css.color,fontStyle:css.fontStyle,fontWeight:css.fontWeight,textDecoration:[...decoration].sort().join(' ')||'none'};};`;
async function stockBlock(block) {
  await key(wb, "g", "KeyG", 71, process.platform === "darwin" ? 4 : 2);
  await wb.send("Input.insertText", { text: String(block.line) });
  await key(wb, "Enter", "Enter", 13);
  await sleep(350);
  return evaluate(wb, `(()=>{${stylesCode}
    const expected=${JSON.stringify(block.body.trimEnd().split("\n"))};
    const rows=Array.from(document.querySelectorAll('.view-lines .view-line'));
    return expected.map(text=>{if(!text)return [];const row=rows.find(row=>row.textContent.replace(/\u00a0/g,' ')===text);if(!row)return null;
      const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT),result=[];let node;
      while(node=walker.nextNode())for(const char of node.textContent.replace(/\u00a0/g,' '))result.push({char,...styles(node.parentElement)});
      return result;});})()`);
}
async function liveBlock(block) {
  await liveEval(`view.dispatch({selection:{anchor:${block.from}},effects:view.constructor.scrollIntoView(${block.from},{y:'center'})});view.focus();return true;`);
  await waitFor(async () => liveEval(`const body=${JSON.stringify(block.body.trimEnd())};for(let i=0;i<body.length;i++){if(body[i]==='\\n')continue;const point=view.domAtPos(${block.from}+i,1);if(!point.node.parentElement?.closest('.mlrt-vscode-code-token'))return false;}return true;`), `native ${block.language} token colors`);
  return liveEval(`${stylesCode}
    const body=${JSON.stringify(block.body.trimEnd())};let position=${block.from};
    return body.split('\\n').map(text=>{const result=[];for(let i=0;i<text.length;i++){
      const point=view.domAtPos(position+i,1);const element=point.node.nodeType===3?point.node.parentElement:point.node;
      result.push({char:text[i],...styles(element)});
    }position+=text.length+1;return result;});`);
}
let wb, live;
try {
  console.log(`Code highlighting EDH port ${port}`);
  const target = await waitFor(async () => (await targets()).find(target => target.type === "page" && /workbench\.html/.test(target.url)), "workbench", 30000);
  wb = await connect(target.webSocketDebuggerUrl);
  await wb.send("Page.enable");
  await sleep(2000);
  await evaluate(wb, `(()=>{for(const button of document.querySelectorAll('button'))if(/^(Get Started|Not Now|Skip|Maybe Later)$/i.test(button.textContent.trim()))button.click();return true;})()`);
  await key(wb, "Escape", "Escape", 27);
  await waitFor(() => evaluate(wb, "!!document.querySelector('.view-lines')"), "stock Monaco");
  for (const theme of ["Dark+", "Light+", "Default High Contrast"]) {
    const custom = theme === "Light+" ? { "[Light+]": { textMateRules: [
      { scope: "keyword.control", settings: { foreground: "#B000B0", fontStyle: "bold italic" } },
      { scope: "entity.name.function", settings: { foreground: "#006F6F", fontStyle: "underline" } },
    ] } } : {};
    const configuration = { ...settings, "workbench.colorTheme": theme, "editor.tokenColorCustomizations": custom };
    configurations.set(theme, configuration);
    await writeFile(path.join(user, "settings.json"), JSON.stringify(configuration));
    await sleep(900);
    await waitFor(() => evaluate(wb, `document.querySelector('.monaco-workbench')?.classList.contains(${JSON.stringify(theme === "Light+" ? "vs" : theme === "Default High Contrast" ? "hc-black" : "vs-dark")})`), `stock ${theme} applied`);
    const stock = new Map();
    for (const block of blocks) {
      const styles = await stockBlock(block);
      assert(styles.every(Boolean), `all stock ${block.language} code rows visible`);
      stock.set(block.language, styles);
      if (["js", "html", "diff"].includes(block.language)) await screenshot(`${theme.replace(/\W/g, '')}-stock-${block.language}`);
    }
    snapshots.set(theme, stock);
    await palette("Markdown Live Editor: Toggle Markdown Live Editor");
    await waitFor(() => evaluate(wb, "!!document.querySelector('iframe')"), "live webview");
    live = await waitFor(async () => {
      for (const target of (await targets()).filter(target => target.webSocketDebuggerUrl && target.type !== "service_worker" && /vscode-webview/.test(target.url))) {
        const client = await connect(target.webSocketDebuggerUrl);
        if (await evaluate(client, `(()=>{${rootCode}return !!view;})()`)) return client;
        client.socket.close();
      }
      return null;
    }, "CodeMirror webview");
    report.themeData = await liveEval("return {...root.body.dataset};");
    for (const block of blocks) {
      const actual = await liveBlock(block), expected = stock.get(block.language);
      const mismatches = [];
      for (let line = 0; line < expected.length; line++) for (let column = 0; column < expected[line].length; column++) {
        const a = actual[line]?.[column], e = expected[line][column];
        if (JSON.stringify(a) !== JSON.stringify(e)) mismatches.push({ line: block.line + line, column, expected: e, actual: a });
      }
      report.checks.push({ theme, language: block.language, characters: expected.flat().length, mismatches });
      console.log(`${mismatches.length ? "FAIL" : "PASS"} ${theme} ${block.language}: ${expected.flat().length} characters, ${mismatches.length} mismatches`);
      if (["js", "html", "diff"].includes(block.language)) await screenshot(`${theme.replace(/\W/g, '')}-live-${block.language}`);
    }
    assert.equal(await liveEval("return view.state.doc.toString();"), source, "highlighting preserves source");
    // Token colors must also survive source-mode reconfiguration and edits.
    if (theme === "Dark+") {
      await liveEval(`view.dispatch({selection:{anchor:${blocks[0].from}},scrollIntoView:true});view.focus();return true;`);
      await live.send("Input.insertText", { text: "// edit\n" });
      await waitFor(async () => liveEval(`return view.state.doc.sliceString(${blocks[0].from},${blocks[0].from + 7})==='// edit';`), "real code edit");
      await waitFor(async () => liveEval(`return !!view.domAtPos(${blocks[0].from},1).node.parentElement?.closest('.mlrt-vscode-code-token');`), "retokenized code edit");
      await key(live, "z", "KeyZ", 90, process.platform === "darwin" ? 4 : 2);
      await waitFor(async () => await liveEval("return view.state.doc.toString();") === source, "host undo");
    }
    if (theme === "Default High Contrast") {
      for (const changedTheme of ["Dark+", "Light+"]) {
        await writeFile(path.join(user, "settings.json"), JSON.stringify(configurations.get(changedTheme)));
        await waitFor(() => liveEval(`return root.body.dataset.vscodeThemeId===${JSON.stringify(changedTheme)};`), `retained webview theme ${changedTheme}`);
        for (const block of blocks) {
          const expected = snapshots.get(changedTheme).get(block.language);
          await waitFor(async () => JSON.stringify(await liveBlock(block)) === JSON.stringify(expected), `retained ${changedTheme} ${block.language} token refresh`);
        }
        report.checks.push({ theme: changedTheme, retainedWebview: true, mismatches: [] });
        console.log(`PASS retained webview ${changedTheme}: all nine languages refresh without reopening`);
      }
    }
    await palette("Markdown Live Editor: Toggle Markdown Live Editor");
    await waitFor(() => evaluate(wb, "!!document.querySelector('.view-lines')"), "return to stock Monaco");
    live.socket.close(); live = null;
  }
  assert(report.checks.every(check => check.mismatches.length === 0), "stock/live syntax colors and font styles must match for every character");
} catch (error) {
  report.error = String(error);
  console.error(error);
  process.exitCode = 1;
  if (wb) await screenshot("failure").catch(() => {});
} finally {
  await writeFile(path.join(qa, "edh-code-highlighting.json"), JSON.stringify(report, null, 2));
  if (wb) await evaluate(wb, "window.close()").catch(() => {});
  for (const client of clients) client.socket.close();
  child.kill();
}
