// Tests for the session-journal, stop-gate and read-only-bash hooks. Synthetic data only.
//   node --test .claude/hooks/hooks.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadState, readTail } from './lib.mjs';
import { readOnlyVerdict } from './read-only-bash.mjs';
import {
  LIMITS,
  compactPoint,
  decideNudge,
  editedJournal,
  lastUsage,
  listJournals,
  ownerMessages,
  parseJournal,
  pendingDirection,
  preCompactOutput,
  readTranscriptTail,
  run,
  sessionStartOutput,
} from './session-journal.mjs';
import { docsGate, privacyGate, stopGate } from './stop-gate.mjs';

// Hooks prefer CLAUDE_PROJECT_DIR; tests pass their own project folder through `cwd`.
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;

const temp = mkdtempSync(join(tmpdir(), 'mlrt-hooks-'));
after(() => rmSync(temp, { recursive: true, force: true }));

function project(name) {
  const root = join(temp, name);
  mkdirSync(join(root, 'docs', 'sessions'), { recursive: true });
  return root;
}

const JOURNAL = `# Session 2026-11-13: sample

Status: open · Updated: 2026-11-13

## State now

- Working on: hooks
- Next step: tests

## Direction

- 2026-11-13 → A12: first instruction
- 2026-11-13, pending: second instruction
  continues here

## Checkpoints

### 1. Built hooks

- Done: wrote them.
`;

const at = (iso) => ({ timestamp: iso });
const human = (iso, text) => ({ type: 'user', ...at(iso), origin: { kind: 'human' }, message: { content: text } });
const assistant = (usage, extra = {}) => ({
  type: 'assistant',
  ...at('2026-11-13T10:00:00Z'),
  message: { model: 'claude-opus-5-5', usage, content: [] },
  ...extra,
});

describe('journal parsing', () => {
  it('reads header fields and sections', () => {
    const journal = parseJournal(JOURNAL);
    assert.equal(journal.status, 'open');
    assert.equal(journal.updated, '2026-11-13');
    assert.match(journal.stateNow, /^- Working on: hooks\n- Next step: tests$/);
    assert.match(journal.direction, /first instruction/);
  });

  it('lists only pending direction, with continuation lines', () => {
    const pending = pendingDirection(parseJournal(JOURNAL).direction);
    assert.equal(pending.length, 1);
    assert.match(pending[0], /second instruction\n {2}continues here/);
  });

  it('finds journals newest first and ignores the README', () => {
    const root = project('list');
    writeFileSync(join(root, 'docs', 'sessions', 'README.md'), '# Sessions\n');
    writeFileSync(join(root, 'docs', 'sessions', 'old.md'), JOURNAL.replace('open', 'closed'));
    writeFileSync(join(root, 'docs', 'sessions', 'new.md'), JOURNAL);
    utimesSync(join(root, 'docs', 'sessions', 'old.md'), new Date(1000), new Date(1000));
    const journals = listJournals(root);
    assert.deepEqual(journals.map((j) => j.rel), ['docs/sessions/new.md', 'docs/sessions/old.md']);
  });

  it('reads a journal saved with CRLF line endings', () => {
    const root = project('crlf');
    writeFileSync(join(root, 'docs', 'sessions', 'windows.md'), JOURNAL.replace(/\n/g, '\r\n'));
    const [journal] = listJournals(root);
    assert.equal(journal.status, 'open');
    assert.equal(journal.updated, '2026-11-13');
    assert.equal(journal.stateNow, '- Working on: hooks\n- Next step: tests');
    assert.equal(pendingDirection(journal.direction).length, 1);
  });
});

describe('journal binding', () => {
  it('recognizes only file edits to a journal', () => {
    const root = project('edited');
    const edit = (tool_name, file_path) => editedJournal(root, { tool_name, tool_input: { file_path } });
    const journal = 'docs/sessions/2026-11-13-sample.md';
    assert.equal(edit('Edit', join(root, 'docs', 'sessions', '2026-11-13-sample.md')), journal);
    assert.equal(edit('Write', journal), journal);
    assert.equal(edit('Edit', join(root, 'docs', 'sessions', 'README.md')), null);
    assert.equal(edit('Edit', join(root, 'docs', 'PROGRESS.md')), null);
    assert.equal(edit('Read', join(root, 'docs', 'sessions', '2026-11-13-sample.md')), null);
    assert.equal(edit('Bash', undefined), null);
  });

  it('remembers the journal a session edited in local state, never in the journal', async () => {
    const root = project('bind');
    const file = join(root, 'docs', 'sessions', '2026-11-13-sample.md');
    writeFileSync(file, JOURNAL);
    const input = { session_id: 'dddd4444-session', cwd: root };
    await run('post-tool', { ...input, tool_name: 'Edit', tool_input: { file_path: file } }, { write: () => {} });
    assert.equal(loadState(root, 'dddd4444-session').journal, 'docs/sessions/2026-11-13-sample.md');

    let printed = '';
    await run('session-start', { ...input, source: 'compact' }, { write: (t) => (printed += t) });
    assert.match(printed, /Session journal for this session: docs\/sessions\/2026-11-13-sample\.md/);
    assert.match(printed, /second instruction/);

    // Another session has no journal of its own after compaction.
    printed = '';
    await run('session-start', { session_id: 'eeee5555-session', cwd: root, source: 'compact' }, { write: (t) => (printed += t) });
    assert.match(printed, /No session journal exists for this session yet/);
  });
});

describe('transcript reading', () => {
  it('extracts owner messages and question answers only', () => {
    const entries = [
      human('2026-11-13T09:00:00Z', 'before the checkpoint'),
      human('2026-11-13T11:00:00Z', 'Make it light.<system-reminder>injected</system-reminder>'),
      { type: 'user', ...at('2026-11-13T11:01:00Z'), isMeta: true, message: { content: 'meta note' } },
      { type: 'user', ...at('2026-11-13T11:02:00Z'), isCompactSummary: true, message: { content: 'summary' } },
      { type: 'user', ...at('2026-11-13T11:03:00Z'), origin: { kind: 'hook' }, message: { content: 'hook text' } },
      human('2026-11-13T11:04:00Z', '<command-name>/context</command-name>'),
      { type: 'user', ...at('2026-11-13T11:05:00Z'), isSidechain: true, origin: { kind: 'human' }, message: { content: 'subagent' } },
      { type: 'assistant', ...at('2026-11-13T11:06:00Z'), message: { content: [{ type: 'tool_use', id: 'ask1', name: 'AskUserQuestion' }, { type: 'tool_use', id: 'bash1', name: 'Bash' }] } },
      { type: 'user', ...at('2026-11-13T11:07:00Z'), message: { content: [{ type: 'tool_result', tool_use_id: 'bash1', content: 'ls output' }] } },
      { type: 'user', ...at('2026-11-13T11:08:00Z'), message: { content: [{ type: 'tool_result', tool_use_id: 'ask1', content: 'Your questions have been answered: "Where?"="docs". You can now continue with these answers in mind.' }] } },
      { type: 'user', ...at('2026-11-13T11:09:00Z'), message: { content: [{ type: 'tool_result', tool_use_id: 'ask1', content: 'duplicate' }] } },
    ];
    const messages = ownerMessages(entries, Date.parse('2026-11-13T10:00:00Z'));
    assert.deepEqual(
      messages.map((m) => [m.kind, m.text]),
      [
        ['message', 'Make it light.'],
        ['answer', 'Your questions have been answered: "Where?"="docs".'],
      ],
    );
  });

  it('reads context size from the last main-thread assistant usage', () => {
    const entries = [
      assistant({ input_tokens: 1, cache_read_input_tokens: 100, output_tokens: 9 }),
      assistant({ input_tokens: 999 }, { isSidechain: true }),
      { type: 'user', ...at('2026-11-13T10:01:00Z'), message: { content: 'x' } },
    ];
    assert.deepEqual(lastUsage(entries), { tokens: 110, model: 'claude-opus-5-5' });
  });

  it('reads the tail of a large transcript, dropping the partial first line', () => {
    const path = join(temp, 'transcript.jsonl');
    const filler = JSON.stringify({ type: 'attachment', blob: 'x'.repeat(2000) });
    const lines = Array.from({ length: 800 }, () => filler);
    lines.push(JSON.stringify(assistant({ input_tokens: 5, cache_creation_input_tokens: 7 })));
    writeFileSync(path, `${lines.join('\n')}\n`);
    assert.ok(readTail(path, 5000).startsWith('{'));
    assert.equal(readTranscriptTail(path).usage.tokens, 12);
  });
});

describe('compaction point', () => {
  it('prefers the setting, then the observed point, then the model', () => {
    assert.deepEqual(compactPoint({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' }, observed: 970_000 }), { tokens: 500_000, source: 'setting' });
    assert.deepEqual(compactPoint({ observed: 970_862, model: 'claude-haiku-4-5' }), { tokens: 970_862, source: 'observed' });
    assert.equal(compactPoint({ model: 'claude-opus-5-5' }).tokens, 967_000);
    assert.equal(compactPoint({ model: 'claude-fable-5-2' }).tokens, 967_000);
    assert.equal(compactPoint({ model: 'claude-sonnet-4-6[1m]' }).tokens, 967_000);
    assert.equal(compactPoint({ model: 'claude-sonnet-4-6' }).tokens, 167_000);
    assert.equal(compactPoint({ env: { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' }, model: 'claude-opus-5-5' }).tokens, 167_000);
  });
});

describe('nudges', () => {
  const point = 1_000_000; // step = 100k, urgent at 750k

  it('stays silent below the step and nudges once per step', () => {
    let r = decideNudge({}, { tokens: 90_000, point });
    assert.equal(r.message, null);
    r = decideNudge(r.state, { tokens: 120_000, point });
    assert.match(r.message, /about 120k of conversation since the last checkpoint/);
    r = decideNudge(r.state, { tokens: 150_000, point });
    assert.equal(r.message, null);
    r = decideNudge(r.state, { tokens: 225_000, point });
    assert.match(r.message, /since the last checkpoint/);
  });

  it('resets after a journal write and after a compaction', () => {
    let r = decideNudge({}, { tokens: 300_000, point, journalMtimeMs: 5 });
    assert.equal(r.message, null);
    assert.equal(r.state.tokensAtCheckpoint, 300_000);
    r = decideNudge(r.state, { tokens: 20_000, point, journalMtimeMs: 5 });
    assert.equal(r.message, null);
    assert.equal(r.state.tokensAtCheckpoint, 20_000);
  });

  it('sends the urgent nudge once, and only with enough unrecorded growth', () => {
    let r = decideNudge({}, { tokens: 760_000, point, journalMtimeMs: 1 });
    assert.equal(r.message, null);
    r = decideNudge(r.state, { tokens: 775_000, point, journalMtimeMs: 1 });
    assert.match(r.message, /78% of the auto-compaction point/);
    r = decideNudge(r.state, { tokens: 790_000, point, journalMtimeMs: 1, allowRoutine: false });
    assert.equal(r.message, null);
  });

  it('mid-turn checks send only the urgent nudge', () => {
    const r = decideNudge({}, { tokens: 300_000, point, allowRoutine: false });
    assert.equal(r.message, null);
  });
});

describe('outputs', () => {
  const journals = [
    { rel: 'docs/sessions/new.md', status: 'open', ...parseJournal(JOURNAL) },
  ];

  it('re-injects the session journal state and pending direction after compaction', () => {
    const text = sessionStartOutput({ source: 'compact', journals, journalRel: 'docs/sessions/new.md', transcriptPath: '/t.jsonl' });
    assert.match(text, /Session journal for this session: docs\/sessions\/new\.md/);
    assert.match(text, /- Next step: tests/);
    assert.match(text, /second instruction/);
    assert.doesNotMatch(text, /first instruction/);
    assert.match(text, /\/t\.jsonl/);
    assert.ok(text.length <= LIMITS.compactContext);
  });

  it('shows the latest open journal at startup and nothing when all are closed', () => {
    assert.match(sessionStartOutput({ source: 'startup', journals }), /Latest open session journal/);
    const closed = [{ ...journals[0], status: 'closed' }];
    assert.equal(sessionStartOutput({ source: 'startup', journals: closed }), '');
  });

  it('keeps the newest owner messages within the compaction limit and warns against copying them', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ ts: Date.UTC(2026, 10, 13, 10, i), kind: 'message', text: `message ${i} ${'y'.repeat(600)}` }));
    const text = preCompactOutput({ messages, journal: journals[0], transcriptPath: '/t.jsonl' });
    assert.ok(text.length <= LIMITS.preCompact, `length ${text.length}`);
    assert.match(text, /message 29 /);
    assert.doesNotMatch(text, /message 0 /);
    assert.match(text, /earlier message\(s\) omitted/);
    assert.match(text, /docs\/sessions\/new\.md/);
    assert.match(text, /never copy them/);
  });
});

describe('hook runs', () => {
  it('records the turn start and stays silent on a short session', async () => {
    const root = project('run');
    const transcript = join(root, 't.jsonl');
    writeFileSync(transcript, `${JSON.stringify(assistant({ input_tokens: 1000 }))}\n`);
    let printed = '';
    await run('prompt', { session_id: 's-1', cwd: root, transcript_path: transcript }, { write: (t) => (printed += t) });
    assert.equal(printed, '');
    assert.ok(loadState(root, 's-1').turnStartMs > 0);
  });

  it('shows the open journal at session start', async () => {
    const root = project('start');
    writeFileSync(join(root, 'docs', 'sessions', '2026-11-13-sample.md'), JOURNAL);
    let printed = '';
    await run('session-start', { session_id: 'cccc3333-session', cwd: root, source: 'startup' }, { write: (t) => (printed += t) });
    assert.match(printed, /Latest open session journal: docs\/sessions\/2026-11-13-sample\.md/);
    assert.match(printed, /- Next step: tests/);
  });
});

describe('read-only shell for reviewers', () => {
  it('allows read-only git and the documentation check only', () => {
    for (const command of ['git diff HEAD', 'git status --short', 'git log --oneline -5', 'node scripts/check-docs.mjs']) {
      assert.equal(readOnlyVerdict(command).allow, true, command);
    }
    for (const command of [
      'git diff && rm -rf docs',
      'git diff > out.txt',
      'git log | head',
      'git diff $(echo x)',
      'git diff --output=x.patch',
      'git commit -m x',
      'npm install left-pad',
      'node scripts/build-and-install.mjs',
      'rm file',
      '',
    ]) {
      assert.equal(readOnlyVerdict(command).allow, false, command);
    }
  });
});

describe('stop gate', () => {
  const root = project('gate');
  const doc = join(root, 'docs', 'X.md');
  writeFileSync(doc, '# X\n');
  const list = () => [doc];
  const pass = () => ({ ok: true, output: '' });
  const failing = () => ({ ok: false, output: 'docs/X.md:1: broken relative link: nowhere.md' });
  const leaking = () => ({ ok: false, output: 'src/a.ts:3: home-directory path; use a path relative to the repository' });

  it('skips the docs check when no document changed, and passes when the check passes', () => {
    const future = Date.now() + 60_000;
    assert.equal(docsGate({ root, turnStartMs: future, check: failing, list }), null);
    assert.equal(docsGate({ root, turnStartMs: 1, check: pass, list }), null);
    assert.equal(docsGate({ root, turnStartMs: undefined, check: failing, list }), null);
    assert.equal(docsGate({ root, turnStartMs: 1, check: failing, list: () => [] }), null);
  });

  it('checks privacy on every turn, even when no document changed', () => {
    assert.equal(privacyGate({ root, check: pass }), null);
    assert.match(privacyGate({ root, check: leaking }), /Privacy check failed[\s\S]*home-directory path/);
    const checks = { privacy: leaking, docs: failing, list };
    const decision = stopGate({ input: {}, root, turnStartMs: Date.now() + 60_000, checks });
    assert.equal(decision.decision, 'block');
    assert.match(decision.reason, /Privacy check failed/);
    assert.doesNotMatch(decision.reason, /Docs check failed/);
  });

  it('blocks once with every failing check, then lets the turn end', () => {
    const checks = { privacy: leaking, docs: failing, list };
    const decision = stopGate({ input: {}, root, turnStartMs: 1, checks });
    assert.equal(decision.decision, 'block');
    assert.match(decision.reason, /Privacy check failed/);
    assert.match(decision.reason, /Docs check failed[\s\S]*docs\/X\.md[\s\S]*broken relative link/);
    assert.equal(stopGate({ input: { stop_hook_active: true }, root, turnStartMs: 1, checks }), null);
    assert.equal(stopGate({ input: {}, root, turnStartMs: 1, checks: { privacy: pass, docs: pass, list } }), null);
  });
});
