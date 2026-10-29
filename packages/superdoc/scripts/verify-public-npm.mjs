#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'scripts', script)], {
      cwd: PACKAGE_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error(`${script} exited with ${code ?? signal ?? 'unknown'}`));
    });
  });
}

async function settle(scripts) {
  const results = await Promise.allSettled(scripts.map((script) => run(script)));
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Multiple public npm verification checks failed');
}

await run('check-tsconfig-type-surface.cjs');
await run('ensure-types.cjs');
await run('link-engine-styles.cjs');
await run('verify-public-facade-emit.cjs');
await settle([
  'audit-npm-bundle.cjs',
  'smoke-npm-whiteboard.mjs',
  'audit-collaboration-upgrade-engine.cjs',
  'audit-declarations.cjs',
  'check-export-coverage.cjs',
  'check-private-core.cjs',
  'report-declaration-reachability.cjs',
  'audit-public-output.cjs',
]);
