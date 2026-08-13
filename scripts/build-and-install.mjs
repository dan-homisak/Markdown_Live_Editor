import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionId = "dan-homisak.markdown-live-render-tables";
const vsixPath = path.join(projectDir, "markdown-live-render-tables-latest.vsix");
const npmCommand = findNpmCommand();
const codeCli = findCodeCli();

function log(message) {
  console.log(`\n==> ${message}`);
}

function run(command, args, options = {}) {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    const commandLine = ["call", quoteForCmd(command), ...args.map(quoteForCmd)].join(" ");
    return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      windowsVerbatimArguments: true,
      ...options,
    });
  }

  return execFileSync(command, args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...options,
  });
}

function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tryRun(command, args) {
  try {
    return run(command, args);
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    if (output) console.warn(output);
    return undefined;
  }
}

function findNpmCommand() {
  if (process.platform !== "win32") return "npm";

  const bundledNpm = path.join(path.dirname(process.execPath), "npm.cmd");
  if (existsSync(bundledNpm)) return bundledNpm;
  return "npm.cmd";
}

function findCodeCli() {
  const candidates = process.platform === "win32"
    ? [
        process.env.VSCODE_CLI,
        "code.cmd",
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "bin", "code.cmd"),
        path.join(process.env.ProgramFiles ?? "", "Microsoft VS Code", "bin", "code.cmd"),
        path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft VS Code", "bin", "code.cmd"),
      ]
    : [
        process.env.VSCODE_CLI,
        "code",
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
  ];

  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) return candidate;

    try {
      run(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next standard VS Code CLI location.
    }
  }

  throw new Error(
    "Could not find the VS Code CLI. Install VS Code, then add its 'code' command to PATH.",
  );
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(projectDir, "package.json"), "utf8")).version;
}

async function removeStaleExtensions() {
  const extensionsDir = path.join(os.homedir(), ".vscode", "extensions");
  if (!existsSync(extensionsDir)) return 0;

  const prefix = `${extensionId}-`;
  const entries = await readdir(extensionsDir, { withFileTypes: true });
  const stale = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
  await Promise.all(stale.map((entry) => rm(path.join(extensionsDir, entry.name), { recursive: true, force: true })));
  return stale.length;
}

function installedVersion() {
  const output = run(codeCli, ["--list-extensions", "--show-versions"]);
  const match = output.split(/\r?\n/).find((line) => line.startsWith(`${extensionId}@`));
  return match?.slice(extensionId.length + 1);
}

async function verifyInstalledPayload(version) {
  const installedDir = path.join(os.homedir(), ".vscode", "extensions", `${extensionId}-${version}`);
  if (!existsSync(installedDir)) {
    throw new Error(`Expected installed extension directory was not found: ${installedDir}`);
  }

  const checks = [
    ["media/liveEditor.js", "formatTableCellSourceEdit"],
    ["media/liveEditor.js", "computeCellBeforeInputDecision"],
    ["media/liveEditor.js", "hiddenLineNumberMarker"],
    ["media/liveEditor.js", "createEditorGeometrySync"],
    ["media/liveEditor.js", "appendColumnSizing"],
    ["media/liveEditor.js", "measureTableColumnSizing"],
    ["media/liveEditor.js", "measureAvailableDataWidthCh"],
    ["media/liveEditor.css", "table-layout: fixed"],
    ["media/liveEditor.css", "mlrt-table-source-line"],
    ["media/liveEditor.css", "mlrt-live-content-width"],
    ["dist/extension.js", "ignored a change without source ranges"],
    ["dist/extension.js", "validateDocumentChangeClaim"],
    ["dist/extension.js", "reopenActiveEditorWith"],
  ];

  for (const [relativePath, marker] of checks) {
    const content = await readFile(path.join(installedDir, relativePath), "utf8");
    if (!content.includes(marker)) {
      throw new Error(`Installed ${relativePath} does not contain expected marker: ${marker}`);
    }
  }
}

log("Using VS Code CLI");
console.log(run(codeCli, ["--version"]).trim());

log("Cleaning generated build outputs");
await rm(path.join(projectDir, "dist"), { recursive: true, force: true });
await rm(vsixPath, { force: true });

log("Bumping patch version so VS Code sees a genuine update");
const previousVersion = packageVersion();
run(npmCommand, ["version", "patch", "--no-git-tag-version"]);
const expectedVersion = packageVersion();
console.log(`Version: ${previousVersion} -> ${expectedVersion}`);

log("Installing dependencies from package-lock.json");
run(npmCommand, ["ci"]);

log("Building and packaging extension");
run(npmCommand, ["run", "package"]);
if (!existsSync(vsixPath)) throw new Error(`Expected package was not created: ${vsixPath}`);

log("Preparing Windows transfer bundle");
run(process.execPath, ["scripts/prepare-windows-install-bundle.mjs"]);

log("Uninstalling previously installed extension, if present");
tryRun(codeCli, ["--uninstall-extension", extensionId]);

log("Removing stale installed extension directories");
const staleCount = await removeStaleExtensions();
console.log(staleCount ? `Removed ${staleCount} stale extension directorie(s).` : "No stale extension directories found.");

log("Installing latest VSIX into VS Code");
run(codeCli, ["--install-extension", vsixPath, "--force"]);

log("Verifying installed extension version and payload");
const foundVersion = installedVersion();
if (foundVersion !== expectedVersion) {
  throw new Error(`Expected ${extensionId}@${expectedVersion} but found ${foundVersion ?? "not installed"}.`);
}
await verifyInstalledPayload(expectedVersion);
console.log(`Verified: ${extensionId}@${foundVersion}`);

log("Done");
console.log(`Installed: ${vsixPath}`);
console.log("Reload VS Code with 'Developer: Reload Window' to activate this build.");
