#!/usr/bin/env node
// Consistency check for the agent documentation of Markdown Live Editor. Dependency-free; needs
// only Node.js.
//
//   node scripts/check-docs.mjs          check and report; exits 1 on any problem
//   node scripts/check-docs.mjs --list   print the files in scope, one per line
//
// Scope is explicit, because this repository also holds Markdown that must never be "fixed":
// test fixtures, generated stress documents and historical QA records.
//
// - Agent documents (AGENTS.md, CLAUDE.md, docs/, .claude/): broken relative links, trailing
//   whitespace, CR line endings, missing final newline, unclosed code fences, merge-conflict
//   markers and replacement characters. Decision and question IDs (A##, P##, Q##) are defined
//   once in docs/DECISIONS.md and every reference in prose points to a defined ID.
// - Living agent documents (everything above except session journals, plans and dated reports,
//   which are historical): every `npm run <script>` named in a code span exists in package.json,
//   and every repository path named in a code span (src/, scripts/, docs/, media/, test/,
//   samples/, .claude/) exists.
// - Dated reports in docs/reports/: relative links, line endings and final newline only. They
//   are records of past work and are not reformatted.
// - README.md: relative links only. It is the public, shipped document.
// - Skills and subagents: frontmatter, names and size.
// - Session journals: format, size, and the privacy rules a public repository needs (no
//   quotations under Direction, no times of day, no session identifiers).
//
// Home-directory paths and privately listed names are checked across the whole repository by
// scripts/check-privacy.mjs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STRICT_FILES = ['AGENTS.md', 'CLAUDE.md'];
export const STRICT_DIRS = ['docs', '.claude'];
export const LINK_ONLY_FILES = ['README.md'];
// This project's own budget for the always-loaded instruction file; detail belongs in docs/.
export const AGENTS_MAX_LINES = 220;

const HISTORICAL = /^docs\/(sessions|plans|reports)\/(?!README\.md$)/;
// Dated reports keep their original text: only links and line endings are checked.
const RECORD = /^docs\/reports\/(?!README\.md$)/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EXAMPLE_EMAIL = /@(example\.(com|org|net)|[\w.-]+\.(test|invalid))$/i;
const ID_DEFINITION = /^\|\s*([APQ]\d{2})\s*\|/;
const ID_REFERENCE = /\b([APQ]\d{2})\b/g;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const NPM_SCRIPT = /\bnpm run ([\w:.-]+)/g;
const REPO_PATH = /(?:^|[\s"'(=])((?:src|scripts|docs|media|test|samples|\.claude)\/[\w./-]*)/g;
// A path followed by one of these is a pattern or placeholder, not a file to look up.
const PATTERN_NEXT = /[<*{$[…]/;

function walkMarkdown(dir, out = []) {
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(dir, name);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (name !== 'node_modules') walkMarkdown(path, out);
    } else if (name.toLowerCase().endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

export function docScope(root) {
  const strict = STRICT_FILES.map((name) => join(root, name)).filter((path) => existsSync(path));
  for (const dir of STRICT_DIRS) walkMarkdown(join(root, dir), strict);
  const linkOnly = LINK_ONLY_FILES.map((name) => join(root, name)).filter((path) => existsSync(path));
  return { strict, linkOnly };
}

// Claude Code ignores malformed skill and agent files silently, so they are checked here.
function frontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) return null;
  const fields = {};
  for (const line of text.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { fields, bodyLines: text.slice(end + 5).split('\n').length - 1 };
}

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const readLf = (path) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

export function checkDocs(root) {
  const rel = (path) => relative(root, path).split(sep).join('/');
  const errors = [];
  const report = (file, line, message) => errors.push(`${rel(file)}${line ? `:${line}` : ''}: ${message}`);
  const { strict, linkOnly } = docScope(root);

  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    errors.push('package.json: unreadable, so npm script references cannot be checked');
  }

  const definitions = new Map();
  const references = [];
  const counts = { links: 0, paths: 0, commands: 0 };

  const checkLinks = (file, prose, n) => {
    for (const match of prose.matchAll(LINK)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      counts.links += 1;
      let pathPart = target.split('#')[0];
      try {
        pathPart = decodeURIComponent(pathPart);
      } catch {
        // Keep the literal text; a malformed escape is reported as a broken link below.
      }
      if (!existsSync(resolve(dirname(file), pathPart))) report(file, n, `broken relative link: ${target}`);
    }
  };

  for (const file of strict) {
    const raw = readFileSync(file, 'utf8');
    const name = rel(file);
    if (raw.includes('�')) report(file, 0, 'contains a Unicode replacement character');
    if (raw.includes('\r')) report(file, 0, 'contains CR characters; agent documents use LF (see .gitattributes)');
    const text = raw.replace(/\r\n?/g, '\n');
    if (text.length > 0 && !text.endsWith('\n')) report(file, 0, 'missing final newline');

    const living = !HISTORICAL.test(name);
    const record = RECORD.test(name);
    const definesIds = name === 'docs/DECISIONS.md';
    let inFence = false;
    let fenceLine = 0;

    text.split('\n').forEach((line, index) => {
      const n = index + 1;
      if (!record && /[ \t]+$/.test(line)) report(file, n, 'trailing whitespace');
      if (/^(<{7}|={7}|>{7})(\s|$)/.test(line)) report(file, n, 'merge-conflict marker');
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        fenceLine = n;
        return;
      }
      if (inFence) return;
      if (record) {
        checkLinks(file, line.replace(/`[^`]*`/g, ''), n);
        return;
      }
      for (const match of line.matchAll(EMAIL)) {
        if (!EXAMPLE_EMAIL.test(match[0])) report(file, n, 'email address; the repository is public');
      }

      if (definesIds) {
        const match = line.match(ID_DEFINITION);
        if (match) {
          if (definitions.has(match[1])) {
            report(file, n, `duplicate definition of ${match[1]} (first at ${definitions.get(match[1])})`);
          } else {
            definitions.set(match[1], `${name}:${n}`);
          }
        }
      }

      const prose = line.replace(/`[^`]*`/g, '');
      for (const match of prose.matchAll(ID_REFERENCE)) references.push({ id: match[1], file, n });
      checkLinks(file, prose, n);
      if (!living) return;

      for (const span of line.matchAll(/`([^`]+)`/g)) {
        const code = span[1];
        for (const match of code.matchAll(NPM_SCRIPT)) {
          counts.commands += 1;
          if (!Object.hasOwn(scripts, match[1])) {
            report(file, n, `npm script "${match[1]}" is not defined in package.json`);
          }
        }
        for (const match of code.matchAll(REPO_PATH)) {
          const next = code[match.index + match[0].length] ?? '';
          if (PATTERN_NEXT.test(next)) continue;
          const target = match[1].replace(/[.,;:]+$/, '');
          counts.paths += 1;
          if (!existsSync(join(root, target))) report(file, n, `path does not exist: ${target}`);
        }
      }
    });

    if (inFence) report(file, fenceLine, 'unclosed code fence');
  }

  for (const ref of references) {
    if (!definitions.has(ref.id)) report(ref.file, ref.n, `reference to undefined ID ${ref.id}`);
  }

  for (const file of linkOnly) {
    let inFence = false;
    readLf(file).split('\n').forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (!inFence) checkLinks(file, line.replace(/`[^`]*`/g, ''), index + 1);
    });
  }

  const agents = join(root, 'AGENTS.md');
  if (!existsSync(agents)) {
    errors.push('AGENTS.md: missing');
  } else {
    const lines = readLf(agents).split('\n').length - 1;
    if (lines > AGENTS_MAX_LINES) {
      errors.push(`AGENTS.md: ${lines} lines; keep it to ${AGENTS_MAX_LINES} or fewer and move detail into docs/`);
    }
  }
  const claude = join(root, 'CLAUDE.md');
  if (!existsSync(claude) || !readFileSync(claude, 'utf8').startsWith('@AGENTS.md')) {
    errors.push('CLAUDE.md: must begin with the @AGENTS.md import');
  }

  // Limits from the Claude Code documentation: the skill listing cuts descriptions at 1,536
  // characters, and SKILL.md bodies should stay under 500 lines.
  const agentCounts = { skills: 0, agents: 0, journals: 0 };
  const skillsDir = join(root, '.claude', 'skills');
  for (const name of isDir(skillsDir) ? readdirSync(skillsDir).sort() : []) {
    const dir = join(skillsDir, name);
    if (!isDir(dir)) continue;
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file)) {
      report(dir, 0, 'skill directory without SKILL.md');
      continue;
    }
    agentCounts.skills += 1;
    const meta = frontmatter(readLf(file));
    if (!meta) {
      report(file, 1, 'missing YAML frontmatter');
      continue;
    }
    if (meta.fields.name && meta.fields.name !== name) {
      report(file, 0, `name "${meta.fields.name}" differs from its directory "${name}"`);
    }
    const description = `${meta.fields.description ?? ''} ${meta.fields.when_to_use ?? ''}`.trim();
    if (!description) report(file, 0, 'missing description');
    if (description.length > 1536) report(file, 0, 'description and when_to_use exceed 1,536 characters');
    if (meta.bodyLines > 500) report(file, 0, `body has ${meta.bodyLines} lines; keep it under 500`);
  }

  const agentsDir = join(root, '.claude', 'agents');
  for (const name of isDir(agentsDir) ? readdirSync(agentsDir).sort() : []) {
    if (!name.endsWith('.md')) continue;
    const file = join(agentsDir, name);
    agentCounts.agents += 1;
    const meta = frontmatter(readLf(file));
    if (!meta) report(file, 1, 'missing YAML frontmatter');
    else if (!meta.fields.name || !meta.fields.description) report(file, 0, 'name and description are required');
  }

  // Session journals; the format is in docs/sessions/README.md.
  const sessionsDir = join(root, 'docs', 'sessions');
  for (const name of isDir(sessionsDir) ? readdirSync(sessionsDir).sort() : []) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const file = join(sessionsDir, name);
    const text = readLf(file);
    const lines = text.split('\n').length - 1;
    agentCounts.journals += 1;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(name)) {
      report(file, 0, 'journal file name must be YYYY-MM-DD-<topic>.md in lowercase');
    }
    if (!/^# Session \d{4}-\d{2}-\d{2}: \S/.test(text)) {
      report(file, 1, 'journal must start with "# Session YYYY-MM-DD: <topic>"');
    }
    if (!/^Status: (open|closed) · Updated: \d{4}-\d{2}-\d{2}$/m.test(text)) {
      report(file, 0, 'header line must be exactly "Status: open|closed · Updated: YYYY-MM-DD" (a date; no time, no session IDs)');
    }
    for (const section of ['State now', 'Direction', 'Checkpoints']) {
      if (!new RegExp(`^## ${section}[ \\t]*$`, 'm').test(text)) report(file, 0, `missing section "## ${section}"`);
    }
    // The repository is public: a journal restates direction as project facts and never quotes.
    const journalLines = text.split('\n');
    const directionStart = journalLines.findIndex((line) => /^## Direction[ \t]*$/.test(line));
    journalLines.forEach((line, index) => {
      const n = index + 1;
      if (/^#{2,4} \d{1,2}:\d{2}\b/.test(line)) {
        report(file, n, 'checkpoint headed by a time of day; number checkpoints instead');
      }
      if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(line)) {
        report(file, n, 'session identifier; journals carry none');
      }
    });
    if (directionStart !== -1) {
      for (let index = directionStart + 1; index < journalLines.length && !/^## /.test(journalLines[index]); index += 1) {
        if (/["“”]/.test(journalLines[index])) {
          report(file, index + 1, 'quotation marks under "## Direction"; restate direction as a fact about the project, never quote');
        }
      }
    }
    if (lines > 200) report(file, 0, `journal has ${lines} lines; condense it to 200 or fewer`);
  }

  const idCounts = { A: 0, P: 0, Q: 0 };
  for (const id of definitions.keys()) idCounts[id[0]] += 1;
  const summary = [
    `Checked ${strict.length} agent documents and ${linkOnly.length} product documents: ` +
      `${counts.links} relative links, ${counts.paths} repository paths, ${counts.commands} npm script references.`,
    `Defined IDs: ${idCounts.A} accepted, ${idCounts.P} proposed, ${idCounts.Q} open questions; ` +
      `${references.length} ID references.`,
    `Agent files: ${agentCounts.skills} skills, ${agentCounts.agents} subagents, ` +
      `${agentCounts.journals} session journals.`,
  ];
  return { files: [...strict, ...linkOnly].map(rel), errors, summary };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.includes('--list')) {
    const { strict, linkOnly } = docScope(root);
    for (const path of [...strict, ...linkOnly]) console.log(relative(root, path).split(sep).join('/'));
    process.exit(0);
  }
  const result = checkDocs(root);
  for (const line of result.summary) console.log(line);
  if (result.errors.length > 0) {
    console.error(result.errors.join('\n'));
    console.error(`${result.errors.length} problem(s) found.`);
    process.exit(1);
  }
  console.log('No problems found.');
}
