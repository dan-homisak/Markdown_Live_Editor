#!/usr/bin/env node
// Record the SHA-256 of every test fixture in test/fixtures/manifest.json.
//
//   node scripts/update-fixture-manifest.mjs
//
// The unit test src/test/fixtures.test.ts fails when a fixture no longer matches this manifest,
// so a fixture cannot change by accident. Run this only after changing a fixture on purpose,
// in the same change as the tests that depend on it. Hashes are taken after normalizing line
// endings to LF, so a CRLF checkout produces the same values.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");
const manifestName = "manifest.json";

const files = {};
for (const name of readdirSync(fixturesDir).sort()) {
  if (name === manifestName || name === "README.md") continue;
  const text = readFileSync(path.join(fixturesDir, name), "utf8").replace(/\r\n?/g, "\n");
  files[name] = createHash("sha256").update(text, "utf8").digest("hex");
}

writeFileSync(path.join(fixturesDir, manifestName), `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`Recorded ${Object.keys(files).length} fixture hash(es) in test/fixtures/${manifestName}.`);
