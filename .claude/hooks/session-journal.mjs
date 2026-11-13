#!/usr/bin/env node
// Session-continuity hooks for Markdown Live Editor. Deterministic and dependency-free: it
// measures context use, says when a checkpoint is due, protects the owner's words at compaction
// and re-injects the session journal afterwards. It prints only when the model needs to know
// something.
//
//   node .claude/hooks/session-journal.mjs <session-start|prompt|post-tool|pre-compact>
//
// The journal format is in docs/sessions/README.md; the judgment (what is worth recording) is in
// the session-journal skill. Hook state is kept per session in .local/agent/ (gitignored).
//
// Privacy: journals are committed to a public repository, so they carry no session identifiers,
// no times of day and no quotations. Which journal belongs to which session is remembered only
// in the local hook state. The owner's own words appear only in what these hooks print into the
// running conversation, never in a file.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clip,
  kTokens,
  loadState,
  parseJsonLines,
  projectRoot,
  readInput,
  readTail,
  readText,
  relPath,
  saveState,
} from './lib.mjs';

export const LIMITS = {
  startupState: 1500,
  compactContext: 4000,
  preCompact: 9000,
  message: 1500,
};
export const STEP_MIN = 40_000;
export const STEP_SHARE = 0.1;
export const URGENT_SHARE = 0.75;
export const URGENT_MIN_GROWTH = 10_000;
export const TOOL_CHECK_INTERVAL_MS = 20_000;

// ---------- Journals ----------

export function section(text, title) {
  const match = new RegExp(`^## ${title}[ \\t]*$`, 'mi').exec(text);
  if (!match) return '';
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

// Header line: "Status: open · Updated: 2026-11-13"
export function parseJournal(text) {
  const status = /Status:\s*(open|closed)/i.exec(text)?.[1]?.toLowerCase() ?? 'open';
  const updated = /Updated:\s*([^·\n]+)/i.exec(text)?.[1]?.trim() ?? '';
  return {
    status,
    updated,
    stateNow: section(text, 'State now'),
    direction: section(text, 'Direction'),
  };
}

// Direction bullets still marked "pending" (not yet promoted to a project document).
export function pendingDirection(direction) {
  const items = [];
  for (const line of direction.split('\n')) {
    if (/^- /.test(line)) items.push(line);
    else if (items.length && line.trim()) items[items.length - 1] += `\n${line}`;
  }
  return items.filter((item) => /\bpending\b/i.test(item.split('\n')[0]));
}

export function listJournals(root) {
  const dir = join(root, 'docs', 'sessions');
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .map((name) => {
      const path = join(dir, name);
      const text = readText(path);
      return { path, rel: relPath(root, path), mtimeMs: statSync(path).mtimeMs, ...parseJournal(text) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// A session's journal is the one it last edited. That link lives in local hook state only.
export const findSessionJournal = (journals, rel) =>
  rel ? journals.find((journal) => journal.rel === rel) : undefined;

// The journal a file-editing tool call just wrote, as a repository-relative path, or null.
export function editedJournal(root, input) {
  if (!/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(input.tool_name ?? '')) return null;
  const file = input.tool_input?.file_path;
  if (typeof file !== 'string' || !file) return null;
  const rel = relPath(root, resolve(root, file));
  return /^docs\/sessions\/(?!README\.md$)[^/]+\.md$/i.test(rel) ? rel : null;
}

export const latestOpenJournal = (journals) => journals.find((journal) => journal.status === 'open');

// ---------- Transcript ----------

export const contextTokens = (usage) =>
  (usage.input_tokens ?? 0) +
  (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0) +
  (usage.output_tokens ?? 0);

export function lastUsage(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type === 'assistant' && !entry.isSidechain && entry.message?.usage) {
      return { tokens: contextTokens(entry.message.usage), model: entry.message.model ?? '' };
    }
  }
  return null;
}

export function observedCompactPoint(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.subtype === 'compact_boundary' && entry.compactMetadata?.preTokens > 0) {
      return entry.compactMetadata.preTokens;
    }
  }
  return 0;
}

export function readTranscriptTail(path) {
  if (!path) return null;
  for (const bytes of [1 << 20, 8 << 20]) {
    let entries;
    try {
      entries = parseJsonLines(readTail(path, bytes));
    } catch {
      return null;
    }
    const usage = lastUsage(entries);
    if (usage) return { usage, entries };
  }
  return null;
}

const MILLION_WINDOW = /\[1m\]|fable|sonnet-[5-9]|haiku-5-[5-9]|haiku-[6-9]|opus-4-[7-9]|opus-[5-9]/i;

// The token count at which auto-compaction runs. The observed value from an earlier compaction
// in this session is the most accurate; the model table follows Claude Code's documentation.
export function compactPoint({ env = {}, observed = 0, model = '' }) {
  const fromEnv = Number.parseInt(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '', 10);
  if (fromEnv > 0) return { tokens: fromEnv, source: 'setting' };
  if (observed > 0) return { tokens: observed, source: 'observed' };
  if (MILLION_WINDOW.test(model) && env.CLAUDE_CODE_DISABLE_1M_CONTEXT !== '1') {
    return { tokens: 967_000, source: 'model' };
  }
  return { tokens: 167_000, source: 'default' };
}

const stripReminders = (text) =>
  text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const WRAPPER_ONLY =
  /^<(command-|local-command|task-notification|side-sessions-event|ci-monitor-event|bash-|user-memory)/;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

// The owner's own messages and question answers after `sinceMs`, oldest first.
export function ownerMessages(entries, sinceMs = 0) {
  const askIds = new Set();
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (entry.isSidechain) continue;
    const content = entry.message?.content;
    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'tool_use' && part.name === 'AskUserQuestion') askIds.add(part.id);
      }
      continue;
    }
    if (entry.type !== 'user' || !entry.timestamp || entry.isMeta || entry.isCompactSummary) continue;
    const ts = Date.parse(entry.timestamp);
    if (!(ts > sinceMs)) continue;

    if (Array.isArray(content) && content.some((part) => part.type === 'tool_result')) {
      for (const part of content) {
        if (part.type !== 'tool_result' || !askIds.has(part.tool_use_id) || seen.has(part.tool_use_id)) {
          continue;
        }
        seen.add(part.tool_use_id);
        const text = stripReminders(textOf(part.content))
          .replace(/\s*You can now continue with[^\n]*$/i, '')
          .trim();
        if (text) out.push({ ts, kind: 'answer', text });
      }
      continue;
    }

    if (entry.origin && entry.origin.kind !== 'human') continue;
    const text = stripReminders(textOf(content));
    if (!text || WRAPPER_ONLY.test(text)) continue;
    out.push({ ts, kind: 'message', text });
  }
  return out;
}

const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// ---------- Nudges ----------

export function decideNudge(previous, { tokens, point, journalMtimeMs = 0, allowRoutine = true }) {
  const state = {
    tokensAtCheckpoint: 0,
    lastNudgeTokens: 0,
    urgentSent: false,
    journalMtimeMs: 0,
    ...previous,
  };
  if (journalMtimeMs > state.journalMtimeMs) {
    // The journal was written since the last look: that was a checkpoint.
    Object.assign(state, {
      journalMtimeMs,
      tokensAtCheckpoint: tokens,
      lastNudgeTokens: tokens,
      urgentSent: false,
    });
  } else if (tokens < state.tokensAtCheckpoint || tokens < state.lastNudgeTokens) {
    // Context shrank: a compaction happened.
    Object.assign(state, { tokensAtCheckpoint: tokens, lastNudgeTokens: tokens, urgentSent: false });
  }

  const step = Math.max(STEP_MIN, Math.round(point * STEP_SHARE));
  const since = tokens - state.tokensAtCheckpoint;
  let message = null;
  if (!state.urgentSent && tokens >= point * URGENT_SHARE && since >= URGENT_MIN_GROWTH) {
    const share = Math.round((tokens / point) * 100);
    message =
      `Session journal: context is at ${share}% of the auto-compaction point ` +
      `(${kTokens(tokens)} of about ${kTokens(point)}), with ${kTokens(since)} since the last ` +
      'checkpoint. Compaction will summarize this conversation soon; anything meaningful that is ' +
      'not yet recorded belongs in the journal now (session-journal skill).';
    state.urgentSent = true;
    state.lastNudgeTokens = tokens;
  } else if (allowRoutine && since >= step && tokens - state.lastNudgeTokens >= step) {
    message =
      `Session journal: about ${kTokens(since)} of conversation since the last checkpoint ` +
      `(context ${kTokens(tokens)}, auto-compaction near ${kTokens(point)}). If owner direction, ` +
      'decisions or findings from that stretch are unrecorded, the session-journal skill records them; ' +
      'if nothing meaningful happened, no action is needed.';
    state.lastNudgeTokens = tokens;
  }
  return { message, state };
}

// ---------- Outputs ----------

export function sessionStartOutput({ source, journals, journalRel, transcriptPath }) {
  const own = findSessionJournal(journals, journalRel);
  if (source === 'compact') {
    const lines = [];
    if (own) {
      lines.push(`Session journal for this session: ${own.rel} (updated ${own.updated || 'unknown'}).`);
      if (own.stateNow) lines.push('State now, from the journal:', own.stateNow);
      const pending = pendingDirection(own.direction);
      if (pending.length) lines.push('Direction not yet promoted to project documents:', ...pending);
    } else {
      lines.push(
        'No session journal exists for this session yet (format: docs/sessions/README.md). ' +
          'The session-journal skill creates one when something meaningful needs recording.',
      );
    }
    if (transcriptPath) lines.push(`Full pre-compaction transcript for verbatim lookup: ${transcriptPath}`);
    return clip(lines.join('\n'), LIMITS.compactContext);
  }
  const journal = (source === 'resume' && own) || latestOpenJournal(journals);
  if (!journal) return '';
  const label = journal === own ? 'Session journal for this session' : 'Latest open session journal';
  return clip(
    `${label}: ${journal.rel} (updated ${journal.updated || 'unknown'}).\n` +
      (journal.stateNow ? `State now, from the journal:\n${journal.stateNow}` : ''),
    LIMITS.startupState,
  ).trim();
}

export function preCompactOutput({ messages, journal, transcriptPath, limit = LIMITS.preCompact }) {
  const head = [
    'Markdown Live Editor compaction instructions (from .claude/hooks/session-journal.mjs):',
    '- Quote verbatim every owner message and answer listed at the end; they are the owner\'s own ' +
      'words and outrank any paraphrase.',
    '- Those quotes are for this conversation only. The repository is public: never copy them, ' +
      'or anything about how the owner works, into a tracked file or a commit message.',
    '- Keep decision and question IDs (A##, P##, Q##), files changed, commands run with their ' +
      'results, the installed extension version, commit hashes, and the open task list with its ' +
      'next step.',
    journal
      ? `- Session journal: ${journal.rel} (last checkpoint ${journal.updated || 'unknown'}). Facts ` +
        'already recorded there or in docs/ need only a pointer.'
      : '- No session journal exists yet for this session; say so in the summary.',
    '- Drop tool output, file contents and superseded attempts.',
  ].join('\n');
  if (!messages.length) return `${head}\n\nNo owner messages since the last checkpoint.`;

  const title = '\n\nOwner messages and answers since the last checkpoint (oldest first):';
  let budget = limit - head.length - title.length - 200;
  const kept = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    const block = `\n[${stamp(item.ts)} UTC] ${item.kind}: ${clip(item.text, LIMITS.message, ' … (truncated; full text in the transcript)')}`;
    if (block.length > budget) break;
    budget -= block.length;
    kept.unshift(block);
  }
  const omitted = messages.length - kept.length;
  const note = omitted
    ? `\n\n${omitted} earlier message(s) omitted for length; they are in the transcript${transcriptPath ? `: ${transcriptPath}` : ''}.`
    : '';
  return `${head}${title}${kept.join('')}${note}`;
}

// ---------- Event handlers ----------

function contextCheck({ root, input, state, allowRoutine }) {
  const tail = readTranscriptTail(input.transcript_path);
  if (!tail) return { message: null, state };
  const observed = observedCompactPoint(tail.entries) || state.observedCompactPoint || 0;
  const model = tail.usage.model || state.model || '';
  const point = compactPoint({ env: process.env, observed, model });
  const own = findSessionJournal(listJournals(root), state.journal);
  const result = decideNudge(state, {
    tokens: tail.usage.tokens,
    point: point.tokens,
    journalMtimeMs: own?.mtimeMs ?? 0,
    allowRoutine,
  });
  return {
    message: result.message,
    state: { ...result.state, observedCompactPoint: observed, model, lastTokens: tail.usage.tokens },
  };
}

export async function run(event, input, { write = (text) => process.stdout.write(text) } = {}) {
  const root = projectRoot(input);
  const sessionId = input.session_id;
  const state = loadState(root, sessionId);

  if (event === 'session-start') {
    const next = { ...state, model: input.model || state.model };
    if (input.source === 'compact') {
      const tail = readTranscriptTail(input.transcript_path);
      const observed = tail ? observedCompactPoint(tail.entries) : 0;
      if (observed) next.observedCompactPoint = observed;
    }
    saveState(root, sessionId, next);
    const text = sessionStartOutput({
      source: input.source,
      journals: listJournals(root),
      journalRel: next.journal,
      transcriptPath: input.transcript_path,
    });
    if (text) write(`${text}\n`);
    return;
  }

  if (event === 'prompt') {
    const result = contextCheck({ root, input, state, allowRoutine: true });
    saveState(root, sessionId, { ...result.state, turnStartMs: Date.now() });
    if (result.message) write(`${result.message}\n`);
    return;
  }

  if (event === 'post-tool') {
    const now = Date.now();
    const edited = editedJournal(root, input);
    let current = state;
    if (edited && edited !== state.journal) {
      current = { ...state, journal: edited };
      saveState(root, sessionId, current);
    }
    if (now - (current.lastToolCheckMs ?? 0) < TOOL_CHECK_INTERVAL_MS) return;
    const result = contextCheck({ root, input, state: current, allowRoutine: false });
    saveState(root, sessionId, { ...result.state, lastToolCheckMs: now });
    if (result.message) {
      write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: result.message },
        }),
      );
    }
    return;
  }

  if (event === 'pre-compact') {
    const journal = findSessionJournal(listJournals(root), state.journal);
    let entries = [];
    try {
      entries = parseJsonLines(readFileSync(input.transcript_path, 'utf8'));
    } catch {
      // No readable transcript: still emit the general instructions.
    }
    const messages = ownerMessages(entries, journal?.mtimeMs ?? 0);
    write(`${preCompactOutput({ messages, journal, transcriptPath: input.transcript_path })}\n`);
    return;
  }

  throw new Error(`unknown event "${event}"`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await run(process.argv[2], await readInput());
  } catch (error) {
    process.stderr.write(`session-journal hook: ${error.message}\n`);
    process.exit(1);
  }
}
