import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
await copyFile(require.resolve("vscode-oniguruma/release/onig.wasm"),
  fileURLToPath(new URL("../dist/onig.wasm", import.meta.url)));
