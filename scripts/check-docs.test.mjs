// Tests for scripts/check-docs.mjs. Synthetic projects in a temporary folder only.
//   node --test scripts/check-docs.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AGENTS_MAX_LINES, checkDocs } from './check-docs.mjs';

const temp = mkdtempSync(join(tmpdir(), 'mlrt-docs-'));
after(() => rmSync(temp, { recursive: true, force: true }));

const DECISIONS = `# Decisions

| ID | Decision | Notes |
| --- | --- | --- |
| A01 | Accepted thing | Source |
| P01 | Proposed thing | Q01 |
| Q01 | Open question | |
`;

const JOURNAL = `# Session 2026-11-13: sample

Status: open · Updated: 2026-11-13

## State now

- Working on: checks

## Direction

- 2026-11-13 → A01: fixtures are frozen

## Checkpoints

### 1. Start

- Done: started.
`;

// A project the checker accepts; `files` adds to or replaces the defaults.
function project(name, files = {}) {
  const root = join(temp, name);
  const all = {
    'package.json': JSON.stringify({ scripts: { compile: 'tsc' } }),
    'AGENTS.md': '# Rules\n\nSee [decisions](docs/DECISIONS.md) and A01.\n',
    'CLAUDE.md': '@AGENTS.md\n\n# Adapter\n',
    'docs/DECISIONS.md': DECISIONS,
    'docs/GUIDE.md': 'Run `npm run compile`, then `node scripts/tool.mjs --flag`. See P01 and `src/app.ts`.\n',
    'scripts/tool.mjs': '',
    'src/app.ts': '',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    if (content === null) continue;
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const problems = (root) => checkDocs(root).errors;

describe('a consistent project', () => {
  it('passes and counts what it checked', () => {
    const result = checkDocs(project('ok'));
    assert.deepEqual(result.errors, []);
    assert.match(result.summary[0], /Checked 4 agent documents and 0 product documents: 1 relative links, 2 repository paths, 1 npm script references/);
    assert.match(result.summary[1], /1 accepted, 1 proposed, 1 open questions/);
    assert.deepEqual(result.files, ['AGENTS.md', 'CLAUDE.md', 'docs/DECISIONS.md', 'docs/GUIDE.md']);
  });

  it('leaves fixtures, QA records and other Markdown outside its scope alone', () => {
    const root = project('scope', {
      'TestTable.md': 'trailing space  \n[dead](nowhere.md) Q99\n```\nunclosed',
      'qa/report.md': '[dead](nowhere.md)\r\n',
      'src/notes.md': 'Z99 [dead](nowhere.md)',
    });
    assert.deepEqual(problems(root), []);
  });

  it('accepts patterns and placeholders as paths', () => {
    const root = project('patterns', {
      'docs/GUIDE.md': 'Tests are `src/test/*.test.ts`; journals are `docs/sessions/<date>-<topic>.md` and `scripts/edh-*-check.mjs`.\n',
    });
    assert.deepEqual(problems(root), []);
  });
});

describe('agent documents', () => {
  it('reports text problems with file and line', () => {
    const root = project('text', {
      'docs/BAD.md': '# Bad\n\ntrailing \n[dead](nowhere.md)\n<<<<<<< HEAD\n\n```js\nunclosed\n',
      'docs/CR.md': '# CR\r\n',
      'docs/NOEOL.md': '# No final newline',
    });
    const errors = problems(root);
    assert.ok(errors.includes('docs/BAD.md:3: trailing whitespace'));
    assert.ok(errors.includes('docs/BAD.md:4: broken relative link: nowhere.md'));
    assert.ok(errors.includes('docs/BAD.md:5: merge-conflict marker'));
    assert.ok(errors.includes('docs/BAD.md:7: unclosed code fence'));
    assert.ok(errors.some((e) => e.startsWith('docs/CR.md: contains CR characters')));
    assert.ok(errors.includes('docs/NOEOL.md: missing final newline'));
    assert.equal(errors.length, 6);
  });

  it('reports undefined and duplicate IDs, ignoring code spans and fences', () => {
    const root = project('ids', {
      'docs/DECISIONS.md': `${DECISIONS}| A01 | Again | |\n`,
      'docs/GUIDE.md': 'See Q07, but not `Q08`.\n\n```\nQ09\n```\n',
    });
    const errors = problems(root);
    assert.ok(errors.some((e) => /docs\/DECISIONS\.md:8: duplicate definition of A01/.test(e)));
    assert.ok(errors.includes('docs/GUIDE.md:1: reference to undefined ID Q07'));
    assert.equal(errors.length, 2);
  });

  it('reports commands and paths that do not exist', () => {
    const root = project('stale', {
      'docs/GUIDE.md': 'Run `npm run lint` and `node scripts/gone.mjs`; edit `src/missing.ts`.\n',
    });
    assert.deepEqual(problems(root), [
      'docs/GUIDE.md:1: npm script "lint" is not defined in package.json',
      'docs/GUIDE.md:1: path does not exist: scripts/gone.mjs',
      'docs/GUIDE.md:1: path does not exist: src/missing.ts',
    ]);
  });

  it('does not check commands and paths in journals and plans, which are historical', () => {
    const root = project('history', {
      'docs/sessions/2026-11-13-sample.md': `${JOURNAL}- Removed \`src/old.ts\` and \`npm run old\`.\n`,
      'docs/plans/2026-11-13-plan.md': '# Plan\n\nTouches `src/planned.ts`.\n',
      'docs/plans/README.md': '# Plans\n\nSee `src/app.ts`.\n',
    });
    assert.deepEqual(problems(root), []);
  });

  it('requires the import adapter and a compact AGENTS.md', () => {
    const root = project('root-files', {
      'CLAUDE.md': '# No import\n',
      'AGENTS.md': `# Rules\n${'line\n'.repeat(AGENTS_MAX_LINES)}`,
    });
    const errors = problems(root);
    assert.ok(errors.includes('CLAUDE.md: must begin with the @AGENTS.md import'));
    assert.ok(errors.some((e) => e.startsWith(`AGENTS.md: ${AGENTS_MAX_LINES + 1} lines`)));
  });
});

describe('product documents', () => {
  it('checks relative links only', () => {
    const root = project('product', {
      'README.md': '# App  \r\n\r\nUse `[text]()` syntax. Q99. [spec](SPEC.md) [gone](missing.md)\r\n',
      'SPEC.md': '',
    });
    assert.deepEqual(problems(root), ['README.md:3: broken relative link: missing.md']);
  });
});

describe('dated reports', () => {
  it('are records: links and line endings are checked, wording and formatting are not', () => {
    const root = project('reports', {
      'docs/reports/2026-10-04-review.md': '# Review  \n\nSee Q77 and `src/long-gone.ts`, `npm run old`. [kept](../GUIDE.md) [dead](missing.json)\n',
      'docs/reports/crlf.md': '# CR\r\n',
    });
    const errors = problems(root);
    assert.ok(errors.includes('docs/reports/2026-10-04-review.md:3: broken relative link: missing.json'));
    assert.ok(errors.some((e) => e.startsWith('docs/reports/crlf.md: contains CR characters')));
    assert.equal(errors.length, 2);
  });
});

describe('privacy rules for a public repository', () => {
  const journal = (body) => ({ 'docs/sessions/2026-11-13-sample.md': body });

  it('rejects quotations under Direction, times of day and session identifiers in journals', () => {
    const quoted = JOURNAL.replace('fixtures are frozen', 'the owner said "freeze the fixtures"');
    assert.ok(problems(project('quoted', journal(quoted))).some((e) => /:11: quotation marks under "## Direction"/.test(e)));

    const curly = JOURNAL.replace('fixtures are frozen', '“freeze them”');
    assert.ok(problems(project('curly', journal(curly))).some((e) => /quotation marks under/.test(e)));

    const timed = JOURNAL.replace('### 1. Start', '### 20:40 Start');
    assert.ok(problems(project('timed', journal(timed))).some((e) => /:15: checkpoint headed by a time of day/.test(e)));

    const stamped = JOURNAL.replace('Updated: 2026-11-13', 'Updated: 2026-11-13 20:40');
    assert.ok(problems(project('stamped', journal(stamped))).some((e) => /header line must be exactly/.test(e)));

    const identified = `${JOURNAL}- Session 0a1b2c3d-1111-2222-3333-444455556666 continued.\n`;
    assert.ok(problems(project('identified', journal(identified))).some((e) => /session identifier/.test(e)));

    // Quotation marks elsewhere in a journal are fine: error text, command output names.
    const elsewhere = `${JOURNAL}- Learned: the check prints "No problems found.".\n`;
    assert.deepEqual(problems(project('elsewhere', journal(elsewhere))), []);
  });

  it('rejects email addresses in agent documents, except example addresses', () => {
    const root = project('emails', {
      'docs/GUIDE.md': 'Write to person@company.io, not to test@example.com or a@b.test.\n',
    });
    assert.deepEqual(problems(root), ['docs/GUIDE.md:1: email address; the repository is public']);
  });
});

describe('agent files', () => {
  it('checks skills, subagents and journals', () => {
    const root = project('agent-files', {
      '.claude/skills/good/SKILL.md': '---\nname: good\ndescription: Does a thing.\n---\n\n# Good\n',
      '.claude/skills/renamed/SKILL.md': '---\nname: other\ndescription: Does a thing.\n---\n',
      '.claude/skills/bare/SKILL.md': '# No frontmatter\n',
      '.claude/skills/long/SKILL.md': `---\nname: long\ndescription: ${'x'.repeat(1600)}\n---\n`,
      '.claude/agents/reviewer.md': '---\nname: reviewer\n---\n\nReview.\n',
      'docs/sessions/Bad Name.md': '# Notes\n',
      'docs/sessions/2026-11-13-sample.md': JOURNAL,
    });
    const result = checkDocs(root);
    const errors = result.errors;
    assert.ok(errors.includes('.claude/skills/renamed/SKILL.md: name "other" differs from its directory "renamed"'));
    assert.ok(errors.includes('.claude/skills/bare/SKILL.md:1: missing YAML frontmatter'));
    assert.ok(errors.includes('.claude/skills/long/SKILL.md: description and when_to_use exceed 1,536 characters'));
    assert.ok(errors.includes('.claude/agents/reviewer.md: name and description are required'));
    assert.ok(errors.some((e) => e.startsWith('docs/sessions/Bad Name.md: journal file name must be')));
    assert.ok(errors.some((e) => e.startsWith('docs/sessions/Bad Name.md: header line must be exactly')));
    assert.ok(!errors.some((e) => e.includes('2026-11-13-sample.md')));
    assert.ok(!errors.some((e) => e.includes('skills/good')));
    assert.match(result.summary[2], /4 skills, 1 subagents, 2 session journals/);
  });
});
