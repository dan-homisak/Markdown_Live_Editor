#!/usr/bin/env node
// Privacy check for a public repository. Dependency-free; needs only Node.js and git.
//
//   node scripts/check-privacy.mjs
//
// Scans every file git would commit (tracked files plus untracked files that are not ignored)
// and exits 1 when one of them contains:
//
// - a home-directory path, which carries a local user name;
// - a term listed in .local/private-terms.txt. That file is gitignored, so the private names
//   themselves (other projects, people, machines) never enter the repository. One term per line;
//   lines starting with # are comments. Without the file this part of the check is skipped.
//
// The rules these checks enforce are in AGENTS.md under "Public repository". What a session
// journal may contain is checked by scripts/check-docs.mjs.

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BINARY = /\.(png|jpe?g|gif|ico|webp|bmp|wasm|vsix|woff2?|ttf|otf|pdf|zip|gz)$/i;
// Generated from registry metadata; no local paths, and far too large to be worth reading.
const SKIPPED_FILES = new Set(['package-lock.json']);
const MAX_BYTES = 8 * 1024 * 1024;

// A drive letter, then Users, then a name: plain, JSON-escaped, forward-slashed or URL-encoded.
const WINDOWS_HOME = /[A-Za-z](?::|%3A)[\\/]+Users[\\/]+[^\\/\s"'`<>|*?)]+/i;
// An absolute macOS or Linux home path, not part of a longer path or a URL.
const UNIX_HOME = /(?<![\w./-])\/(?:Users|home)\/[A-Za-z0-9._-]+/;

export function listCandidateFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

export function loadPrivateTerms(root) {
  let text;
  try {
    text = readFileSync(join(root, '.local', 'private-terms.txt'), 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function termPattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A plain word matches only as a whole word, so a short name does not match inside others.
  return new RegExp(/^\w+$/.test(term) ? `\\b${escaped}\\b` : escaped, 'i');
}

export function checkPrivacy(root, { files = listCandidateFiles(root), terms = loadPrivateTerms(root) } = {}) {
  const errors = [];
  if (files === null) {
    return { errors: ['git ls-files failed, so the files that would be committed cannot be listed'], summary: [] };
  }
  const patterns = terms.map(termPattern);
  let scanned = 0;

  for (const file of files) {
    if (BINARY.test(file) || SKIPPED_FILES.has(file)) continue;
    const path = join(root, file);
    let text;
    try {
      if (statSync(path).size > MAX_BYTES) continue;
      text = readFileSync(path, 'utf8');
    } catch {
      continue; // Deleted in the working tree, or unreadable.
    }
    if (text.includes('\u0000')) continue; // Binary content under a text extension.
    scanned += 1;

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const where = `${file}:${index + 1}`;
      if (WINDOWS_HOME.test(line) || UNIX_HOME.test(line)) {
        errors.push(`${where}: home-directory path; use a path relative to the repository`);
      }
      // The term is not printed, so this output can be quoted without repeating it.
      if (patterns.some((pattern) => pattern.test(line))) {
        errors.push(`${where}: contains a term listed in .local/private-terms.txt`);
      }
    }
  }

  const summary = [
    `Privacy check: ${scanned} text files that git would commit; ` +
      (terms.length ? `${terms.length} private term(s) from the local list.` : 'no local private-terms list, so only paths were checked.'),
  ];
  return { errors, summary };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkPrivacy(root);
  for (const line of result.summary) console.log(line);
  if (result.errors.length > 0) {
    console.error(result.errors.slice(0, 60).join('\n'));
    if (result.errors.length > 60) console.error(`... and ${result.errors.length - 60} more`);
    console.error(`${result.errors.length} problem(s) found.`);
    process.exit(1);
  }
  console.log('No problems found.');
}
