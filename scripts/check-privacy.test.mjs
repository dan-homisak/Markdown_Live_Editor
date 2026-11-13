// Tests for scripts/check-privacy.mjs. Synthetic projects in a temporary folder only. Paths
// that would trip the check are assembled at run time so this file itself stays clean.
//   node --test scripts/check-privacy.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkPrivacy, loadPrivateTerms } from './check-privacy.mjs';

const temp = mkdtempSync(join(tmpdir(), 'mlrt-privacy-'));
after(() => rmSync(temp, { recursive: true, force: true }));

function project(name, files) {
  const root = join(temp, name);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const person = 'someone';
const windowsHome = ['C:', 'Users', person, 'project'].join('\\');
const escapedHome = ['C:', 'Users', person, 'AppData'].join('\\\\');
const encodedHome = ['file:///c%3A', 'Users', person, 'project', 'a.md'].join('/');
const macHome = `/${'Users'}/${person}/project`;
const linuxHome = `/${'home'}/${person}/project`;

describe('home-directory paths', () => {
  it('reports every form a local path takes, with file and line', () => {
    const files = {
      'docs/a.md': `Installed into \`${windowsHome}\`.\n`,
      'qa.json': `{"path":"${escapedHome}"}\n`,
      'log.txt': `first line\nopened ${encodedHome}\n`,
      'src/a.ts': `const a = "${macHome}";\nconst b = "${linuxHome}";\n`,
    };
    const root = project('paths', files);
    const { errors } = checkPrivacy(root, { files: Object.keys(files), terms: [] });
    assert.deepEqual(errors.map((error) => error.split(': ')[0]).sort(), [
      'docs/a.md:1',
      'log.txt:2',
      'qa.json:1',
      'src/a.ts:1',
      'src/a.ts:2',
    ]);
    assert.ok(errors.every((error) => error.includes('home-directory path')));
  });

  it('accepts placeholders, repository paths and web addresses', () => {
    const files = {
      'docs/a.md': [
        'A path like `C:\\Users\\<name>` is not allowed.',
        'See https://example.com/home/page and https://example.com/Users/list.',
        'Sources live in `src/home/index.ts` and `docs/Users/guide.md`.',
        'Use `~/.vscode/extensions` or `%USERPROFILE%`.',
      ].join('\n'),
    };
    const root = project('clean', files);
    assert.deepEqual(checkPrivacy(root, { files: Object.keys(files), terms: [] }).errors, []);
  });

  it('skips binary files, the lockfile and missing files', () => {
    const files = {
      'shot.png': `${windowsHome}`,
      'package-lock.json': `${windowsHome}`,
      'blob.txt': `\u0000${windowsHome}`,
    };
    const root = project('skips', files);
    const result = checkPrivacy(root, { files: [...Object.keys(files), 'deleted.md'], terms: [] });
    assert.deepEqual(result.errors, []);
    assert.match(result.summary[0], /0 text files/);
  });
});

describe('private terms', () => {
  it('reads the local list, ignoring comments and blank lines', () => {
    const root = project('terms', { '.local/private-terms.txt': '# names\n\nSecretProject\n  other name  \r\n' });
    assert.deepEqual(loadPrivateTerms(root), ['SecretProject', 'other name']);
    assert.deepEqual(loadPrivateTerms(project('no-terms', { 'a.md': '' })), []);
  });

  it('matches whole words without printing the term', () => {
    const files = {
      'docs/a.md': 'Adopted from secretproject.\nThe party stays.\nAn article is fine.\n',
      'docs/b.md': 'Mentions other name here.\n',
    };
    const root = project('match', files);
    const { errors } = checkPrivacy(root, { files: Object.keys(files), terms: ['SecretProject', 'art', 'other name'] });
    assert.deepEqual(errors, [
      'docs/a.md:1: contains a term listed in .local/private-terms.txt',
      'docs/b.md:1: contains a term listed in .local/private-terms.txt',
    ]);
  });

  it('says when no list exists, and fails when files cannot be listed', () => {
    const root = project('none', { 'a.md': 'fine\n' });
    assert.match(checkPrivacy(root, { files: ['a.md'], terms: [] }).summary[0], /no local private-terms list/);
    assert.match(checkPrivacy(root, { files: null, terms: [] }).errors[0], /git ls-files failed/);
  });
});
