#!/usr/bin/env node
// PreToolUse hook for read-only agents: allows only a short list of read-only shell commands and
// blocks everything else, including any chaining, redirection or substitution.
//
//   node .claude/hooks/read-only-bash.mjs   (hook input JSON on stdin)

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInput } from './lib.mjs';

const ALLOWED = [
  /^git (diff|log|show|status|blame|ls-files|rev-parse)( |$)/,
  /^node scripts\/check-docs\.mjs( |$)/,
];
const SHELL_SYNTAX = /[;&|<>`$\n\r]/;
const WRITING_OPTIONS = /(^|\s)--(output|ext-diff)\b/;

export function readOnlyVerdict(command) {
  const text = String(command ?? '').trim();
  if (!text) return { allow: false, reason: 'empty command' };
  if (SHELL_SYNTAX.test(text)) {
    return { allow: false, reason: 'chaining, pipes, redirection and substitution are not allowed' };
  }
  if (WRITING_OPTIONS.test(text)) return { allow: false, reason: '--output and --ext-diff are not allowed' };
  if (!ALLOWED.some((pattern) => pattern.test(text))) {
    return {
      allow: false,
      reason:
        'only git diff/log/show/status/blame/ls-files/rev-parse and the documentation check ' +
        'are allowed; use Read, Grep and Glob for everything else',
    };
  }
  return { allow: true };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const input = await readInput();
  const verdict = readOnlyVerdict(input.tool_input?.command);
  if (!verdict.allow) {
    process.stderr.write(`Read-only agent: ${verdict.reason}.\n`);
    process.exit(2);
  }
}
