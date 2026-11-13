---
name: add-dependency
description: Review and record a new, upgraded or removed npm package for Markdown Live Editor before changing it - owner approval for anything that ships, license of the exact version, where it lands in the bundle, network behavior, exact pin, and regenerated third-party notices. Use before any npm install of a package, including dev tools and upgrades.
argument-hint: "<package>[@version]"
---

# Add, upgrade or remove a dependency

This extension is packaged for installation on other machines. What it bundles, it
redistributes, with the license text in `THIRD_PARTY_NOTICES.md`.

## Stop and ask first

Ask with AskUserQuestion, recommendation first, before installing anything when the package:

- will be bundled into the host or the webview (a runtime dependency), or replaces one that is;
- has a license that is not a plain permissive one (MIT, ISC, BSD, Apache-2.0), or none stated;
- makes any network call at run time or install time: telemetry, update checks, remote fonts,
  CDN loading, grammar or model downloads. The webview's policy allows no connections, and that
  policy does not change to fit a package;
- needs an account, a key or a paid tier.

A development-only tool with a permissive license and no install script needs no approval, but
still gets the review below.

## Review before installing

`npm view` reads public registry metadata only.

1. **Version:** `npm view <pkg> versions time --json`. Prefer the newest stable release that is
   at least two weeks old; no prereleases or `latest` by habit.
2. **License** of that exact version: `npm view <pkg>@<version> license`. Read the license file
   when it is unusual or dual.
3. **Footprint:** `npm view <pkg>@<version> dependencies scripts dist.unpackedSize engines
   peerDependencies`. Note install scripts.
4. **Network behavior:** search its README for telemetry, analytics, update checks, CDN or
   remote assets.
5. **Fit:** peer dependencies against what is installed. The CodeMirror and Lezer packages must
   resolve to one copy each; a second copy of `@codemirror/state` breaks the editor at run time.
6. **Where it lands:** webview bundle (`media/liveEditor.js`), host bundle, or tooling only.

## Install and check

1. `npm install --save-exact <pkg>@<version>` (add `--save-dev` for tooling).
2. `npm ci` must then install cleanly from the lockfile.
3. `npm test`. It compiles, runs the suite and proves the host bundle loads with only `vscode`
   and Node built-ins (`scripts/check-extension-bundle.mjs`).
4. `node scripts/record-markdown-bundle-impact.mjs`. It inventories what esbuild actually
   bundled, appends missing license texts to `THIRD_PARTY_NOTICES.md`, stops with an error when a
   bundled package has no license file, and writes a size record under `qa/`, which is local.
   Report the size change it prints.
5. The `verify-change` skill for whatever the package affects, then `./Build_and_Install`.

## Record

- The approval: an accepted row in `docs/DECISIONS.md` stating what was approved, with the date.
  State the fact; do not quote the conversation (the repository is public).
- `docs/PROGRESS.md`: package, exact version, license, where it is bundled, size change.
- If the package changes what users see, the README.
- If it adds a file the extension loads at run time, the allowlist in `.vscodeignore`.
