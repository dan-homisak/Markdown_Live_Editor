// The VSIX intentionally excludes node_modules. Prove the host can load using
// only VS Code and Node builtins, without accidentally resolving repo packages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const realRequire = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("../dist/extension.js", import.meta.url));
const source = await readFile(entry, "utf8");
const hostModule = { exports: {} };
vm.runInNewContext(source, {
  module: hostModule,
  exports: hostModule.exports,
  __filename: entry,
  __dirname: fileURLToPath(new URL("../dist/", import.meta.url)),
  require(name) {
    if (name === "vscode") return {};
    if (builtinModules.includes(name.replace(/^node:/, ""))) return realRequire(name);
    throw new Error(`Unbundled extension-host dependency: ${name}`);
  },
  console,
  Buffer,
  process,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
}, { filename: entry });
assert.equal(typeof hostModule.exports.activate, "function");
assert.equal(typeof hostModule.exports.deactivate, "function");
console.log("Extension host bundle loads without repository node_modules.");
