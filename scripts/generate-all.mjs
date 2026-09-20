#!/usr/bin/env node

/**
 * Full generation DAG — produces all derived artifacts from source-of-truth inputs.
 *
 * Phases (run in order; 1-3 are sequential, 4 is independent):
 *   1. docapi:sync             → packages/document-api/generated/**
 *   2. cli:export-sdk-contract → apps/cli/generated/sdk-contract.json
 *   3. sdk codegen             → generated clients, tool catalogs, and native-binary embeddings
 *   4. @superdoc/fonts generate → packages/fonts/src/{asset-urls,bundled-families}.ts (from font-system)
 *
 * Before generation, gitignored output directories are cleaned to prevent stale file accumulation.
 *
 * Documentation is not generated here. The documentation site owns its own
 * reference and regenerates it during dev, build, test, and typecheck.
 */

import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function run(command, args) {
  console.log(`  > ${command} ${args.join(' ')}`);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
    });
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
  } catch (error) {
    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      console.log(error.stdout.trim());
    }
    if (typeof error?.stderr === 'string' && error.stderr.trim()) {
      console.error(error.stderr.trim());
    }
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

/**
 * Remove all .json files from a directory while preserving non-json files
 * (e.g. __init__.py in packages/sdk/tools/).
 */
async function cleanJsonFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return; // directory doesn't exist yet
  }
  await Promise.all(
    entries.filter((name) => name.endsWith('.json')).map((name) => rm(path.join(dir, name), { force: true })),
  );
}

async function clean() {
  console.log('Cleaning gitignored generated output directories...');
  await Promise.all([
    rm(path.join(REPO_ROOT, 'packages/document-api/generated'), { recursive: true, force: true }),
    rm(path.join(REPO_ROOT, 'apps/cli/generated'), { recursive: true, force: true }),
    rm(path.join(REPO_ROOT, 'packages/sdk/langs/node/src/generated'), { recursive: true, force: true }),
    rm(path.join(REPO_ROOT, 'packages/sdk/langs/node/src/embedded-prompts.generated.ts'), { force: true }),
    rm(path.join(REPO_ROOT, 'packages/sdk/langs/node/src/embedded-tools.generated.ts'), { force: true }),
    rm(path.join(REPO_ROOT, 'packages/sdk/langs/python/superdoc/generated'), { recursive: true, force: true }),
    cleanJsonFiles(path.join(REPO_ROOT, 'packages/sdk/tools')),
  ]);
}

async function main() {
  console.log('generate:all — producing all derived artifacts...\n');

  // Clean stale outputs
  await clean();

  // Phase 1-2: Document API contract outputs
  console.log('\n--- Phase 1: docapi:sync ---');
  await run('pnpm', ['run', 'docapi:sync']);

  // Phase 2: CLI SDK contract export
  console.log('\n--- Phase 2: cli:export-sdk-contract ---');
  await run('pnpm', ['exec', 'tsx', path.join(REPO_ROOT, 'apps/cli/scripts/export-sdk-contract.ts')]);

  // Phase 3: SDK codegen (Node + Python clients + tool catalogs)
  console.log('\n--- Phase 3: sdk codegen ---');
  await run('node', [path.join(REPO_ROOT, 'packages/sdk/codegen/src/generate-all.mjs')]);
  await run('node', [path.join(REPO_ROOT, 'packages/sdk/langs/node/scripts/embed-prompts.mjs')]);
  await run('node', [path.join(REPO_ROOT, 'packages/sdk/langs/node/scripts/embed-tools.mjs')]);

  // Phase 4: @superdoc/fonts derived sources: bundled asset URLs (from the asset dir) plus curatable
  // family names (from font-system offerings). Kept out of the package's build/prepare lifecycle so a
  // standalone install never needs tsx; regenerated here, in the workspace pipeline.
  console.log('\n--- Phase 4: @superdoc/fonts generate ---');
  await run('pnpm', ['--filter', '@superdoc/fonts', 'generate']);

  console.log('\ngenerate:all complete.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
