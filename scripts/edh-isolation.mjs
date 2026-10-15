import { existsSync } from "node:fs";
import path from "node:path";

// Test windows must never start the application installer or extension updates.
export const edhLaunchFlags = ["--disable-updates"];
export const edhSettings = {
  "update.mode": "none",
  "update.enableWindowsBackgroundUpdates": false,
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
};

export function resolveEdhExecutable(repoRoot) {
  const candidates = [
    process.env.MLRT_CODE_BIN,
    path.join(repoRoot, ".vscode-test", "isolated-code", "Code.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe"),
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    "/usr/share/code/code", "/usr/bin/code", "/snap/bin/code",
  ];
  return candidates.filter(Boolean).find(existsSync);
}
