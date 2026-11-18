import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkGeneratedFiles } from './generation-utils.js';

const cwd = process.cwd();
const created: string[] = [];

afterEach(() => {
  process.chdir(cwd);
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docapi-genutils-'));
  created.push(dir);
  process.chdir(dir);
  return dir;
}

describe('checkGeneratedFiles determinism', () => {
  it('flags a missing tracked output but ignores a missing in-memory output', async () => {
    makeWorkspace();
    const issues = await checkGeneratedFiles(
      [
        { path: 'tracked/a.json', content: '{}\n' },
        { path: 'gitignored/b.json', content: '{}\n' },
      ],
      { roots: ['tracked'], inMemoryRoots: ['gitignored'] },
    );
    expect(issues).toEqual([{ kind: 'missing', path: 'tracked/a.json' }]);
  });

  it('does NOT false-fail when a stale gitignored output exists on disk', async () => {
    makeWorkspace();
    // Tracked output matches the in-memory build.
    mkdirSync('tracked', { recursive: true });
    writeFileSync('tracked/a.json', '{}\n');
    // Stale gitignored output that disagrees with the in-memory build.
    mkdirSync('gitignored', { recursive: true });
    writeFileSync('gitignored/b.json', '{"stale":true}\n');

    const issues = await checkGeneratedFiles(
      [
        { path: 'tracked/a.json', content: '{}\n' },
        { path: 'gitignored/b.json', content: '{}\n' },
      ],
      { roots: ['tracked'], inMemoryRoots: ['gitignored'] },
    );
    // The stale gitignored copy must not surface as an issue.
    expect(issues).toEqual([]);
  }, 15_000);

  it('still flags stale tracked output content', async () => {
    makeWorkspace();
    mkdirSync('tracked', { recursive: true });
    writeFileSync('tracked/a.json', '{"old":true}\n');

    const issues = await checkGeneratedFiles([{ path: 'tracked/a.json', content: '{}\n' }], {
      roots: ['tracked'],
    });
    expect(issues).toEqual([{ kind: 'content', path: 'tracked/a.json' }]);
  }, 15_000);
});
