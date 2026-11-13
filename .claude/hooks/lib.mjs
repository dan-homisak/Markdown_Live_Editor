// Shared helpers for this repository's Claude Code hooks. Dependency-free; needs only Node.js.
// See .claude/README.md for what each hook does and how to test it.

import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export async function readInput(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

export function projectRoot(input = {}) {
  return resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
}

export const toPosix = (path) => path.split(sep).join('/');
export const relPath = (root, path) => toPosix(relative(root, path));

// This repository checks out with CRLF on Windows (core.autocrlf). Agent documents are pinned to
// LF by .gitattributes, but a journal saved by an editor may still carry CRLF; read it as LF so
// the line-anchored patterns in the hooks keep working.
export const readText = (path) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

// Per-session hook state lives in .local/agent/, which is gitignored.
export function statePath(root, sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^\w-]/g, '_').slice(0, 80);
  return join(root, '.local', 'agent', `${safe}.json`);
}

export function loadState(root, sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(root, sessionId), 'utf8'));
  } catch {
    return {};
  }
}

export function saveState(root, sessionId, state) {
  const path = statePath(root, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

// Reads the last `bytes` of a file, dropping the partial first line.
export function readTail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

export function parseJsonLines(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Partial or non-JSON line; skip.
    }
  }
  return entries;
}

export const kTokens = (n) => `${Math.round(n / 1000)}k`;

export function clip(text, limit, marker = ' … (truncated)') {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`;
}
