// Verify source/live viewport handoff in a real, isolated VS Code window.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "undici";
import { edhLaunchFlags, edhSettings, resolveEdhExecutable } from "./edh-isolation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), "mlrt-toggle-"));
const qa = path.join(repo, "qa");
const port = 9800 + Math.floor(Math.random() * 100);
const baseline = process.argv.includes("--baseline");
await mkdir(path.join(profile, "User"), { recursive: true });
await mkdir(qa, { recursive: true });
await writeFile(path.join(profile, "User/settings.json"), JSON.stringify({ ...edhSettings,
  "workbench.startupEditor": "none", "window.restoreWindows": "none",
  "security.workspace.trust.enabled": false, "editor.wordWrap": "on",
}));
const fixture = await readFile(path.join(repo, "standard-markdown-fixture.md"), "utf8");
const file = path.join(profile, "TestTable.md");
const longTableStart = Array.from({ length: 8 }, (_, i) => `# Section ${i}\n\n${fixture}`).join("\n\n") + "\n\n# Long table\n\n";
const longTableLine = longTableStart.split("\n").length;
const source = longTableStart + ["| Key | Value |", "| --- | --- |",
  ...Array.from({ length: 80 }, (_, i) => `| Row ${i} | ${"Wrapped table content. ".repeat(10)} |`),
  "", ...Array.from({ length: 60 }, (_, i) => `After table ${i}.`), "",
].join("\n");
await writeFile(file, process.argv.includes("--crlf") ? source.replace(/\r?\n/g, "\r\n") : source);
const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: "1" };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(resolveEdhExecutable(repo), [...edhLaunchFlags,
  `--extensionDevelopmentPath=${repo}`, `--user-data-dir=${profile}`,
  `--extensions-dir=${path.join(profile, "extensions")}`, `--remote-debugging-port=${port}`,
  "--new-window", "--disable-workspace-trust", "--skip-release-notes", "--skip-welcome", file,
], { env, stdio: "ignore", windowsHide: true });
const sockets = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.add(ws);
  let id = 0; const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  return { ws, send(method, params = {}) { return new Promise(resolve => {
    pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params }));
  }); } };
}
async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
}
async function until(action, description, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { const value = await action(); if (value) return value; await sleep(40); }
  throw new Error(`Timed out: ${description}`);
}
const liveExpression = body => `(() => {
  const roots = [window, ...Array.from(document.querySelectorAll('iframe')).flatMap(f => {
    try { return f.contentWindow ? [f.contentWindow] : []; } catch { return []; }
  })];
  const win = roots.find(w => { try { return w.__MLRT_EDITOR_VIEW__; } catch { return false; } });
  if (!win) return null;
  const view = win.__MLRT_EDITOR_VIEW__, root = win.document;
  ${body}
})()`;
const viewport = `const top = view.scrollDOM.getBoundingClientRect().top;
  const block = view.lineBlockAtHeight(Math.max(0, top - view.documentTop));
  const cell = [...root.querySelectorAll('.mlrt-table-cell[data-source-from]')].find(el => {
    const box = el.getBoundingClientRect(); return box.top <= top + 1 && box.bottom > top;
  });
  return { line: view.state.doc.lineAt(cell ? Number(cell.dataset.sourceFrom) : block.from).number,
    anchor: view.state.doc.lineAt(view.state.selection.main.anchor).number,
    head: view.state.doc.lineAt(view.state.selection.main.head).number,
    scrollTop: view.scrollDOM.scrollTop, top };`;
let wb;
try {
  const target = await until(async () => (await targets().catch(() => [])).find(t => /workbench\.html/.test(t.url)), "workbench");
  wb = await connect(target);
  await until(() => evaluate(wb, "!!document.querySelector('.monaco-editor .view-lines .view-line')"), "source editor");
  await sleep(2200);
  await evaluate(wb, `(() => { const dialog = document.querySelector('.monaco-dialog-box .monaco-button'); dialog?.click(); })()`);
  async function key(key, code, vk, modifiers = 0) {
    for (const type of ["keyDown", "keyUp"]) await wb.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers });
  }
  async function toggle() { await key("m", "KeyM", 77, process.platform === "darwin" ? 6 : 3); }
  async function goto(line) {
    await key("g", "KeyG", 71, 2); await sleep(80);
    await wb.send("Input.insertText", { text: String(line) }); await key("Enter", "Enter", 13);
    await sleep(120);
  }
  async function stock() {
    return evaluate(wb, `(() => {
      const editor = document.querySelector('.monaco-editor');
      const lines = [...editor.querySelectorAll('.line-numbers')].filter(n => {
        const r = n.getBoundingClientRect(), e = editor.getBoundingClientRect(); return r.bottom > e.top && r.top < e.bottom;
      });
      return { first: Number(lines[0]?.textContent), last: Number(lines.at(-1)?.textContent) };
    })()`);
  }
  async function live() {
    const clients = new Map();
    return until(async () => {
      for (const t of await targets()) {
        if (t.type !== "iframe") continue;
        let c = clients.get(t.id);
        if (!c) {
          c = await connect(t); clients.set(t.id, c);
          if (process.argv.includes("--profile")) { await c.send("Profiler.enable"); await c.send("Profiler.start"); }
        }
        if (await evaluate(c, liveExpression("return !!view.dom.offsetHeight;"))) return c;
      }
      return null;
    }, "live editor mounted");
  }
  const results = [];
  for (const [index, line] of [180, 430, 90, longTableLine + 45].entries()) {
    await goto(line);
    const before = await stock();
    if (index === 0 || index === 3) {
      const png = await wb.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(qa, index === 0 ? "toggle-stock.png" : "toggle-table-stock.png"), Buffer.from(png.result.data, "base64"));
    }
    const start = performance.now(); await toggle();
    const c = await live();
    const mountedMs = Math.round(performance.now() - start);
    if (process.argv.includes("--profile")) {
      const result = await c.send("Profiler.stop");
      await writeFile(path.join(qa, `toggle-${index}.cpuprofile`), JSON.stringify(result.result.profile));
    }
    const stages = await evaluate(c, liveExpression(`return win.performance.getEntriesByType('mark').map(m => ({ name: m.name, ms: Math.round(m.startTime) }));`));
    await sleep(350);
    const after = await evaluate(c, liveExpression(viewport));
    if (!baseline) assert.ok(Math.abs(before.first - after.line) <= 1, `source/live top: ${JSON.stringify({ before, after })}`);
    if (!baseline && index < 3) assert.equal(after.head, line, "source caret survives the toggle independently of the viewport");
    if (index === 0 || index === 3) {
      const png = await wb.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(qa, index === 0 ? "toggle-live.png" : "toggle-table-live.png"), Buffer.from(png.result.data, "base64"));
    }
    // Scroll independently of the caret; restoring the selection alone must not pass.
    await evaluate(c, liveExpression(`view.scrollDOM.scrollTop += 600; return true;`));
    await sleep(180);
    const scrolled = await evaluate(c, liveExpression(viewport));
    await toggle();
    await until(() => evaluate(wb, "!!document.querySelector('.monaco-editor .view-lines .view-line')"), "return to source");
    await sleep(200);
    const returned = await stock();
    if (!baseline && Math.abs(returned.first - scrolled.line) > 1) {
      assert.fail(`live/source top: ${JSON.stringify({ scrolled, returned })}`);
    }
    results.push({ before, after, scrolled, returned, mountedMs, stages });
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(path.join(qa, baseline ? "toggle-baseline.json" : "toggle-results.json"), JSON.stringify(results, null, 2));
  console.log(baseline ? "Baseline measured." : "Viewport handoff and repeated toggle checks passed.");
} finally {
  if (wb) void evaluate(wb, "window.close()").catch(() => {});
  for (const ws of sockets) ws.close();
  child.kill();
}
