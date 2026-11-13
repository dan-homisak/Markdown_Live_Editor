#!/usr/bin/env node
// Stop hook. Before Claude finishes a turn it runs two checks and, when one fails, asks Claude
// to fix the problem first. Silent when everything passes.
//
// 1. Privacy, on every turn: no file git would commit may contain a home-directory path or a
//    privately listed name (scripts/check-privacy.mjs). The repository is public.
// 2. Documentation, when an agent document changed during the turn: scripts/check-docs.mjs.
//    Changes are found by modification time, so shell edits count too. The files in scope come
//    from `scripts/check-docs.mjs --list`, so fixtures and samples never trigger it.
//
// It continues at most once per turn (stop_hook_active).
//
//   node .claude/hooks/stop-gate.mjs   (hook input JSON on stdin)

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clip, loadState, projectRoot, readInput, relPath } from './lib.mjs';

export const REASON_LIMIT = 2000;

function runScript(root, name, args, timeout) {
  return spawnSync(process.execPath, [join(root, 'scripts', name), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
  });
}

const outcome = (result) => ({
  ok: result.status === 0,
  output: (result.stderr || result.stdout || result.error?.message || '').trim(),
});

export const runCheckDocs = (root) => outcome(runScript(root, 'check-docs.mjs', [], 50_000));
export const runCheckPrivacy = (root) => outcome(runScript(root, 'check-privacy.mjs', [], 50_000));

// Absolute paths of the documents the checker covers; empty when the checker cannot run.
export function listDocs(root) {
  const result = runScript(root, 'check-docs.mjs', ['--list'], 20_000);
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => join(root, line));
}

export function changedDocs(root, sinceMs, list = listDocs) {
  return list(root).filter((path) => {
    try {
      return statSync(path).mtimeMs > sinceMs;
    } catch {
      return false;
    }
  });
}

// Returns the reason to keep working, or null.
export function docsGate({ root, turnStartMs, check = runCheckDocs, list = listDocs }) {
  if (!turnStartMs) return null;
  const changed = changedDocs(root, turnStartMs, list);
  if (!changed.length) return null;
  const result = check(root);
  if (result.ok) return null;
  const files = changed.slice(0, 5).map((path) => relPath(root, path)).join(', ');
  return (
    `Docs check failed after documentation edits in this turn (${files}). ` +
    `Fix these, then rerun node scripts/check-docs.mjs:\n${result.output}`
  );
}

export function privacyGate({ root, check = runCheckPrivacy }) {
  const result = check(root);
  if (result.ok) return null;
  return (
    'Privacy check failed: a file that would be committed to this public repository contains a ' +
    'home-directory path or a privately listed name. Remove it (see "Public repository" in ' +
    `AGENTS.md), then rerun node scripts/check-privacy.mjs:\n${result.output}`
  );
}

// Returns the Stop decision to print, or null to let Claude finish.
export function stopGate({ input, root, turnStartMs, checks = {} }) {
  if (input.stop_hook_active) return null;
  const reasons = [
    privacyGate({ root, check: checks.privacy }),
    docsGate({ root, turnStartMs, check: checks.docs, list: checks.list }),
  ].filter(Boolean);
  if (!reasons.length) return null;
  return { decision: 'block', reason: clip(reasons.join('\n\n'), REASON_LIMIT) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const input = await readInput();
    const root = projectRoot(input);
    const decision = stopGate({
      input,
      root,
      turnStartMs: loadState(root, input.session_id).turnStartMs,
    });
    if (decision) process.stdout.write(JSON.stringify(decision));
  } catch (error) {
    process.stderr.write(`stop-gate hook: ${error.message}\n`);
    process.exit(1);
  }
}
