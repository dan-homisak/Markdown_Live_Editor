#!/usr/bin/env node
// Side-by-side selection reference: stock VS Code (Monaco) vs the live editor.
//
// Opens a rich Markdown fixture in an isolated Extension Development Host,
// makes each selection in VS Code's own editor with trusted mouse input
// (click at the anchor, Shift+click at the head), captures a zoomed shot,
// toggles to the live editor (which inherits the selection), captures the
// same region, and toggles back. Screenshots land in qa/selection-parity/.
//
// Usage: node scripts/edh-selection-parity.mjs [--case=<name>] [--zoom=3]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";
import { edhLaunchFlags, edhSettings, resolveEdhExecutable } from "./edh-isolation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codeBin = resolveEdhExecutable(repoRoot);
if (!codeBin) throw new Error("VS Code executable not found; set MLRT_CODE_BIN.");
const onlyCase = process.argv.find((argument) => argument.startsWith("--case="))?.split("=")[1];
const zoom = Number(process.argv.find((argument) => argument.startsWith("--zoom="))?.split("=")[1] ?? 2);
const theme = process.argv.find((argument) => argument.startsWith("--theme="))?.split("=").slice(1).join("=");
const port = 9300 + Math.floor(Math.random() * 90);
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "mlrt-edh-parity-"));
const outDir = path.join(repoRoot, "qa", "selection-parity");
await mkdir(outDir, { recursive: true });
await mkdir(path.join(userDataDir, "User"), { recursive: true });
await writeFile(path.join(userDataDir, "User", "settings.json"), JSON.stringify({
  ...edhSettings,
  "workbench.startupEditor": "none",
  "chat.commandCenter.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  ...(theme ? { "workbench.colorTheme": theme } : {}),
}));
const fixturePath = path.join(userDataDir, "Selection.md");
const fixture = [
  "# Selection Parity",                                                   // 1
  "",                                                                     // 2
  "First paragraph line with some words.",                                // 3
  "Second line, with **bold**, `code`, and a [link](https://example.com).", // 4
  "Short.",                                                               // 5
  "- Bullet item one",                                                    // 6
  "- Bullet item two",                                                    // 7
  "  - Nested bullet three",                                              // 8
  "    - Deep nested four",                                               // 9
  "- Bullet item five",                                                   // 10
  "",                                                                     // 11
  "",                                                                     // 12
  "1. Numbered one",                                                      // 13
  "2. Numbered two",                                                      // 14
  "- [ ] Task item",                                                      // 15
  "Plain line after the list.",                                           // 16
  "A long paragraph that keeps going so that it wraps onto a second visual row inside the editor viewport, which exercises the wrapped-row seam as well as the ordinary line seams.", // 17
  "Final line of the selection.",                                         // 18
  "",                                                                     // 19
  "> Quote line one",                                                     // 20
  "> Quote line two",                                                     // 21
  "",                                                                     // 22
  "```js",                                                                // 23
  "const answer = 42;",                                                   // 24
  "```",                                                                  // 25
  "",                                                                     // 26
  "| Key | Value |",                                                      // 27
  "| --- | --- |",                                                        // 28
  "| a | b |",                                                            // 29
  "",                                                                     // 30
  "after",                                                                // 31
].join("\n");
await writeFile(fixturePath, fixture, "utf8");

// [name, anchor line, anchor column, head line, head column] (1-based).
const cases = [
  ["multi-paragraph", 3, 7, 18, 13],
  ["empty-lines", 5, 1, 13, 1],
  ["lists-from-column-1", 6, 1, 10, 8],
  ["wrapped-line", 16, 5, 18, 6],
  ["quote-and-code", 20, 3, 24, 10],
  ["reverse", 10, 12, 6, 4],
  ["single-line", 3, 7, 3, 25],
  ["through-table", 24, 3, 31, 3],
].filter(([name]) => !onlyCase || name === onlyCase);

const child = spawn(codeBin, [
  ...edhLaunchFlags,
  `--extensionDevelopmentPath=${repoRoot}`,
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${port}`,
  "--new-window", "--disable-workspace-trust", "--skip-release-notes", "--skip-welcome",
  fixturePath,
], { stdio: "ignore", env: electronEnv() });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function electronEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_") || key === "NODE_OPTIONS" || key === "ELECTRON_RUN_AS_NODE") delete env[key];
  }
  env.ELECTRON_NO_ATTACH_CONSOLE = "1";
  return env;
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const ready = new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { ws, ready, send };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return JSON.parse(result.result.result.value);
}

try {
  let workbench;
  for (let attempt = 0; attempt < 60 && !workbench; attempt++) {
    await sleep(1000);
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json()).catch(() => []);
    workbench = targets.find((target) => target.type === "page" && /workbench\.html/.test(target.url));
  }
  if (!workbench) throw new Error("Workbench target not found");
  const wb = connect(workbench.webSocketDebuggerUrl);
  await wb.ready;
  await wb.send("Runtime.enable");
  await wb.send("Page.enable");
  await sleep(4500);
  // Close the secondary side bar and any auxiliary panes for a clean view.
  await evaluate(wb, `JSON.stringify((() => { document.querySelector('.part.auxiliarybar')?.style.setProperty('display','none'); return true; })())`);

  const keyChord = async (key, code, keyCode, modifiers) => {
    await wb.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers });
    await wb.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
  };
  const stockVisible = () => evaluate(wb, `JSON.stringify(Boolean(document.querySelector('.editor-instance .monaco-editor .view-lines')))`);
  const toggle = async (toStock) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await keyChord("m", "KeyM", 77, process.platform === "darwin" ? 6 : 3);
      for (let wait = 0; wait < 40; wait++) {
        await sleep(150);
        if ((await stockVisible()) === toStock) {
          await sleep(toStock ? 400 : 1200);
          return;
        }
      }
    }
    throw new Error(`Toggle to ${toStock ? "stock" : "live"} editor did not complete`);
  };
  const click = async (point, modifiers = 0) => {
    await wb.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, modifiers });
    await wb.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1, modifiers });
    await wb.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1, modifiers });
    await sleep(150);
  };
  // Point of (line, column) in Monaco's rendered DOM, workbench coordinates.
  const monacoPoint = (line, column) => evaluate(wb, `JSON.stringify((() => {
    const editor = [...document.querySelectorAll('.editor-instance .monaco-editor')].find((candidate) => candidate.getBoundingClientRect().width > 0);
    const numbers = [...editor.querySelectorAll('.margin-view-overlays .line-numbers')];
    const number = numbers.find((element) => element.textContent.trim() === '${line}');
    if (!number) return null;
    const top = number.getBoundingClientRect().top;
    const viewLine = [...editor.querySelectorAll('.view-lines .view-line')]
      .find((element) => Math.abs(element.getBoundingClientRect().top - top) < 2);
    const walker = document.createTreeWalker(viewLine, NodeFilter.SHOW_TEXT);
    let remaining = ${column} - 1;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.data.replace(/\\u00a0/g, ' ');
      if (remaining <= text.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        return { x: rect.left + 0.5, y: rect.top + rect.height / 2 };
      }
      remaining -= text.length;
    }
    const rect = viewLine.getBoundingClientRect();
    return { x: rect.left + 2, y: rect.top + rect.height / 2 };
  })())`);
  const editorClip = () => evaluate(wb, `JSON.stringify((() => {
    const editor = document.querySelector('.editor-instance') ?? document.querySelector('.editor-group-container');
    const rect = editor.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: Math.min(rect.width, 900), height: Math.min(rect.height, 820) };
  })())`);
  const shot = async (name) => {
    const clip = await editorClip();
    const capture = await wb.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: zoom } });
    await writeFile(path.join(outDir, `${name}.png`), Buffer.from(capture.result.data, "base64"));
    console.log(`saved qa/selection-parity/${name}.png`);
  };

  const resetStock = async () => {
    // The stock editor owns focus after each toggle; scroll it to the top so
    // every fixture line is rendered and locatable.
    for (let wait = 0; wait < 40 && !(await stockVisible()); wait++) await sleep(150);
    await keyChord("Home", "Home", 36, process.platform === "darwin" ? 4 : 2);
    await sleep(400);
  };
  for (const [name, anchorLine, anchorColumn, headLine, headColumn] of cases) {
    await resetStock();
    const anchor = await monacoPoint(anchorLine, anchorColumn);
    const head = await monacoPoint(headLine, headColumn);
    if (!anchor || !head) throw new Error(`Could not locate ${name} in the stock editor`);
    await click(anchor);
    await click(head, 8);
    await wb.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    await sleep(300);
    const status = await evaluate(wb, `JSON.stringify(document.querySelector('[id="status.editor.selection"]')?.textContent ?? '')`);
    console.log(name, "stock selection:", status);
    await shot(`${name}-vscode`);
    await toggle(false);
    // The custom editor's webview may be visible before it receives focus.
    // Compare ACTIVE selections on both surfaces, not stock-active/live-idle.
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
    for (const target of targets.filter(target => target.type !== 'service_worker' && /vscode-webview/.test(target.url))) {
      const client = connect(target.webSocketDebuggerUrl); await client.ready;
      const focused = await evaluate(client, `JSON.stringify((() => {
        const roots = [document, ...Array.from(document.querySelectorAll('iframe')).map(f => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
        const root = roots.find(doc => doc.defaultView.__MLRT_EDITOR_VIEW__);
        if (!root) return false;
        root.defaultView.__MLRT_EDITOR_VIEW__.focus(); return true;
      })())`);
      client.ws.close(); if (focused) break;
    }
    await wb.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    await sleep(500);
    await shot(`${name}-live`);
    await toggle(true);
  }
} finally {
  child.kill("SIGTERM");
  await sleep(500);
}
