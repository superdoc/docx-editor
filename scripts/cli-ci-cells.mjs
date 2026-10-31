import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const CLI_CI_CELLS = Object.freeze({
  'cli-core': ['pnpm', '--prefix', 'apps/cli', 'run', 'test'],
  'node-agent-actions': ['pnpm', '--prefix', 'packages/sdk/langs/node', 'run', 'test:agent-actions'],
  'node-cli-host': ['pnpm', '--prefix', 'packages/sdk/langs/node', 'run', 'test:cli-host'],
  'python-cli-host': ['pnpm', 'run', 'test:sdk-python-cli-host'],
});

export function verifyCliCellInventory(script) {
  assert.deepEqual(script.split(/\s*&&\s*/), Object.values(CLI_CI_CELLS).map(command => command.join(' ')),
    'CLI CI cells must cover the complete local test:cli command exactly once');
}

export function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 1, 'Pass one CLI CI cell');
  const command = CLI_CI_CELLS[args[0]];
  assert.ok(command, `Unknown CLI CI cell: ${args[0]}`);
  verifyCliCellInventory(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:cli']);
  const result = spawnSync(command[0], command.slice(1), { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `CLI cell ${args[0]} failed: ${result.signal ?? result.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
}
