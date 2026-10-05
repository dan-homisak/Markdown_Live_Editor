#!/usr/bin/env node
// Inventory actual esbuild inputs and preserve installed license notices.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const metrics = bytes => ({ bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: hash(bytes) });
const common = { absWorkingDir: root, bundle: true, write: false, metafile: true, logLevel: "silent" };
const definitions = {
  webview: { ...common, entryPoints: ["src/webview/liveEditor.ts"], platform: "browser", format: "iife", target: "es2022", outfile: path.join(root, "media/liveEditor.js") },
  extensionHost: { ...common, entryPoints: ["src/extension.ts"], platform: "node", format: "cjs", target: "node20", external: ["vscode"], sourcemap: true, outfile: path.join(root, "dist/extension.js") },
};
const packages = new Map();
const bundles = {};
for (const [name, options] of Object.entries(definitions)) {
  const result = await build(options);
  const generated = result.outputFiles.find(output => output.path.endsWith(".js"));
  const disk = await readFile(options.outfile);
  bundles[name] = { ...metrics(generated.contents), diskMatchesGenerated: hash(disk) === hash(generated.contents),
    sourceMapBytes: result.outputFiles.find(output => output.path.endsWith(".map"))?.contents.length ?? 0 };
  for (const output of Object.values(result.metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs)) {
      const normalized = input.replaceAll("\\", "/");
      const index = normalized.lastIndexOf("node_modules/");
      if (index < 0) continue;
      const remaining = normalized.slice(index + "node_modules/".length).split("/");
      const packageName = remaining[0].startsWith("@") ? remaining.slice(0, 2).join("/") : remaining[0];
      const directory = normalized.slice(0, index + "node_modules/".length) + packageName;
      let entry = packages.get(directory);
      if (!entry) {
        const manifest = JSON.parse(await readFile(path.join(root, directory, "package.json"), "utf8"));
        entry = { name: manifest.name, version: manifest.version, license: manifest.license,
          directory, outputContributions: { webview: 0, extensionHost: 0 } };
        packages.set(directory, entry);
      }
      entry.outputContributions[name] += contribution.bytesInOutput;
    }
  }
}

const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.md");
let notices = await readFile(noticesPath, "utf8");
notices = notices.replace("# Bundled host parser notices", "# Bundled third-party notices")
  .replace("The extension host bundles these MIT-licensed Lezer parser packages.",
    "This file preserves licenses for third-party packages bundled into the extension host or webview. The inventory is generated from esbuild inputs and installed package license files by `scripts/record-markdown-bundle-impact.mjs`.");
const missingLicenses = [];
for (const entry of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
  const directory = path.join(root, entry.directory);
  const files = (await readdir(directory)).filter(file => /^licen[sc]e(?:[.-].*)?$/i.test(file)).sort();
  if (!files.length) { missingLicenses.push(`${entry.name}@${entry.version}`); continue; }
  entry.licenseFiles = files.map(file => `${entry.directory}/${file}`);
  const heading = `## ${entry.name} ${entry.version}`;
  if (notices.includes(`${heading}\n`) || notices.includes(`${heading}\r\n`)) continue;
  notices += `\n${heading}\n\n`;
  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    notices += `Installed license source: \`${entry.directory}/${file}\`\n\n${text.trim()}\n\n`;
  }
}
if (missingLicenses.length) throw new Error(`Missing installed license files: ${missingLicenses.join(", ")}`);
await writeFile(noticesPath, `${notices.trimEnd()}\n`);

const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const previousWebview = execFileSync("git", ["show", "HEAD:media/liveEditor.js"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const previousHostSource = execFileSync("git", ["show", "HEAD:src/extension.ts"], { cwd: root, encoding: "utf8" });
const previousHost = await build({ ...definitions.extensionHost, entryPoints: undefined,
  stdin: { contents: previousHostSource, resolveDir: path.join(root, "src"), sourcefile: "extension.ts", loader: "ts" } });
const previousHostBytes = previousHost.outputFiles.find(output => output.path.endsWith(".js")).contents;
const baseline = {
  revision,
  webview: { kind: "Exact tracked HEAD media/liveEditor.js bytes", ...metrics(previousWebview) },
  extensionHost: { kind: "HEAD extension.ts rebuilt with current installed dependencies and current shared imports; not a historical packaged byte-for-byte baseline", ...metrics(previousHostBytes) },
};
const delta = {};
for (const name of Object.keys(bundles)) {
  delta[name] = { bytes: bundles[name].bytes - baseline[name].bytes,
    gzipBytes: bundles[name].gzipBytes - baseline[name].gzipBytes };
}
const languageRoots = new Set(["@codemirror/lang-javascript", "@codemirror/lang-json", "@codemirror/lang-python", "@codemirror/lang-yaml", "@codemirror/legacy-modes"]);
const inventory = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const result = {
  recordedAt: new Date().toISOString(),
  reproduction: "npm.cmd run compile && node scripts/record-markdown-bundle-impact.mjs",
  limitations: ["Sizes describe the current unminified production bundles; gzip is an additional comparison metric, not VSIX compressed-size evidence.",
    "Runtime disabling retains bundled code; it is a recovery behavior, not a download-size reduction.",
    "Package byte contributions use esbuild bytesInOutput; shared runtime glue is not attributed and totals need not equal full bundle bytes.",
    "The diff includes all working-tree changes since the recorded HEAD, not just highlighting or link actions."],
  bundles, baseline, delta,
  newLanguageRoots: inventory.filter(entry => languageRoots.has(entry.name)),
  bundledPackages: inventory,
  notices: { path: "THIRD_PARTY_NOTICES.md", packageCount: inventory.length, missingLicenseFiles: missingLicenses },
};
await mkdir(path.join(root, "qa"), { recursive: true });
await writeFile(path.join(root, "qa/markdown-rendering-bundle-impact.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ bundles, delta, bundledPackages: inventory.length,
  newLanguageRoots: result.newLanguageRoots.map(entry => `${entry.name}@${entry.version}`) }, null, 2));
