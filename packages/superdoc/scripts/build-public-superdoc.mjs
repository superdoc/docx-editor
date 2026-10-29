#!/usr/bin/env node
// build-public-superdoc.mjs - the explicit public SuperDoc producer.
//
// Builds the public npm and/or CDN surfaces against a VERIFIED engine input.
// This command never builds private V2 source: in an Orbit checkout it
// requires a sealed prepared engine (producer receipt + exact-tree match); in
// a public checkout it requires the exact installed engine package. When the
// input is missing or stale it fails closed and names the one canonical
// preparation command instead of building implicitly.
//
// Emits a superdoc-build-timing.v1 payload (target: public) on success and
// failure so the public boundary is measurable without ad hoc stopwatching.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILD_ORCHESTRATED_ENV,
  observeEngineInputIdentity,
  resolveEngineInputContract,
  readDeclaredEngineVersion,
  verifyInstalledEngine,
  verifyPreparedEngine,
  ENGINE_EXPECTED_RECEIPT_DIGEST_ENV,
} from '../../../scripts/engine-prepared-input.mjs';
import { createSuperDocArtifactStore } from '../../../scripts/superdoc-artifact-store.mjs';
import { startBuildTiming } from '../../../scripts/superdoc-build-timing.mjs';
import {
  observePublicSourceIdentity,
  observePublicEngineInput,
  writePublicOutputReceipt,
} from './public-output-receipt.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2_ROOT = path.resolve(PACKAGE_ROOT, '../../../v2');
const PUBLIC_ARTIFACT_STORE_ROOT = path.join(PACKAGE_ROOT, '.build-artifacts', 'public');

const SURFACES = new Set(['npm', 'cdn']);

function parseArgs(argv) {
  const args = { surfaces: ['npm', 'cdn'] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--surface') {
      const value = argv[++index];
      if (!SURFACES.has(value)) throw new Error(`--surface must be npm or cdn; got ${value}`);
      args.surfaces = [value];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function run(command, commandArgs, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
      env: { ...env, [BUILD_ORCHESTRATED_ENV]: '1' },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code ?? signal ?? 'unknown'}`));
    });
  });
}

async function settleSurfaceBuilds(tasks) {
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Multiple public surface builds failed');
}

/**
 * Verify the engine input for this build. Source mode is an explicit Orbit
 * dev surface and does not consume a packaged engine, so it skips input
 * verification here (the resolver still enforces source-mode rules).
 */
function verifyEngineInput(env) {
  if (env.SUPERDOC_V2_RUNTIME_MODE === 'source') {
    return { contract: 'source', detail: 'explicit source mode (Orbit dev surface)' };
  }
  const contract = resolveEngineInputContract({ env, v2Root: V2_ROOT });
  const expectedVersion = readDeclaredEngineVersion(PACKAGE_ROOT);
  if (contract.mode === 'prepared') {
    const verified = verifyPreparedEngine({
      v2Root: V2_ROOT,
      expectedVersion,
      surfaces: ['dist'],
      expectedReceiptDigest: env[ENGINE_EXPECTED_RECEIPT_DIGEST_ENV] ?? null,
      currentInputIdentity: observeEngineInputIdentity({ v2Root: V2_ROOT }),
    });
    const identity = observePublicEngineInput({ packageRoot: PACKAGE_ROOT, v2Root: V2_ROOT, env });
    return {
      contract: 'prepared',
      detail: `engine ${verified.engineVersion}, receipt ${verified.receipt.digest.slice(0, 12)}`,
      verified,
      identity,
    };
  }
  const verified = verifyInstalledEngine({ packageRoot: PACKAGE_ROOT, expectedVersion });
  return {
    contract: 'installed',
    detail: `engine ${verified.engineVersion} at ${verified.engineRoot}`,
    verified,
    identity: observePublicEngineInput({ packageRoot: PACKAGE_ROOT, v2Root: V2_ROOT, env }),
  };
}

async function injectedCheckpoint(name, detail = {}) {
  const requested = process.env.SUPERDOC_BUILD_FAIL_AT?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (requested.includes(name) || requested.includes(`public:${name}`)) {
    const error = new Error(`Injected public build failure at ${name}`);
    error.code = 'SUPERDOC_INJECTED_FAILURE';
    error.detail = detail;
    throw error;
  }
}

async function main() {
  if (process.env.SUPERDOC_V2_CI_REQUIRE_PREPARED === '1') {
    throw new Error(
      'Prepared-candidate mode forbids rebuilding the public SuperDoc package. Materialize the sealed candidate instead.',
    );
  }
  const { surfaces } = parseArgs(process.argv.slice(2));
  const timing = startBuildTiming({
    target: 'public',
    command: `superdoc build-public-superdoc ${surfaces.join('+')}`,
    argv: process.argv.slice(2),
  });
  const timingFile =
    process.env.SUPERDOC_BUILD_TIMING_FILE ?? path.join(PACKAGE_ROOT, 'build-timing', `public-${surfaces.join('-')}.json`);
  const artifactStore = createSuperDocArtifactStore({
    root: PUBLIC_ARTIFACT_STORE_ROOT,
    checkpoint: injectedCheckpoint,
  });
  const artifactRun = await artifactStore.createRun({ producer: 'public' });
  const surfaceRoots = {
    npm: path.join(artifactRun.stagingRoot, 'dist'),
    cdn: path.join(artifactRun.stagingRoot, 'dist-cdn'),
  };

  try {
    const engineInput = await timing.stage('verify-engine-input', async () => verifyEngineInput(process.env));
    console.log(`[build-public] engine input: ${engineInput.contract} (${engineInput.detail})`);
    if (engineInput.contract === 'source') {
      throw new Error(
        'The sealed public producer requires package mode. Use build:dev or the Orbit dev/watch scripts for source mode.',
      );
    }
    const publicSourceIdentity = observePublicSourceIdentity({ packageRoot: PACKAGE_ROOT });
    const buildEnv = {
      ...process.env,
      SUPERDOC_PUBLIC_NPM_OUT_DIR: surfaceRoots.npm,
      SUPERDOC_PUBLIC_CDN_OUT_DIR: surfaceRoots.cdn,
      ...(engineInput.contract === 'prepared'
        ? { [ENGINE_EXPECTED_RECEIPT_DIGEST_ENV]: engineInput.verified.receipt.digest }
        : {}),
    };

    const surfaceTasks = [];
    if (surfaces.includes('npm')) {
      surfaceTasks.push((async () => {
        const npmHandle = timing.startStage('npm', { label: 'public npm surface' });
        try {
          await timing.stage('npm/vite', { parentId: 'npm', command: 'vp build' }, async () =>
            run('pnpm', ['exec', 'vp', 'build'], { env: { ...buildEnv, SUPERDOC_NPM_FORMAT: 'es' } }),
          );
          await timing.stage('npm/vite-cjs', { parentId: 'npm', command: 'vp build' }, async () =>
            run('pnpm', ['exec', 'vp', 'build'], { env: { ...buildEnv, SUPERDOC_NPM_FORMAT: 'cjs' } }),
          );
          await timing.stage('npm/collaboration-bridge', { parentId: 'npm' }, async () =>
            run('pnpm', ['run', 'build:collaboration-upgrade-engine'], { env: buildEnv }),
          );
          await timing.stage('npm/verify', { parentId: 'npm', command: 'pnpm run verify:npm' }, async () =>
            run('pnpm', ['run', 'verify:npm'], { env: buildEnv }),
          );
          npmHandle.end({ verdict: 'ok' });
        } catch (error) {
          npmHandle.end({ verdict: 'failed', error });
          throw error;
        }
      })());
    }

    if (surfaces.includes('cdn')) {
      surfaceTasks.push((async () => {
        const cdnHandle = timing.startStage('cdn', { label: 'public CDN surface' });
        try {
          await timing.stage('cdn/vite', { parentId: 'cdn', command: 'vp build --config vite.config.cdn.js' }, async () =>
            run('pnpm', ['exec', 'vp', 'build', '--config', 'vite.config.cdn.js'], { env: buildEnv }),
          );
          await timing.stage('cdn/verify', { parentId: 'cdn', command: 'pnpm run verify:cdn' }, async () =>
            run('pnpm', ['run', 'verify:cdn'], { env: buildEnv }),
          );
          cdnHandle.end({ verdict: 'ok' });
        } catch (error) {
          cdnHandle.end({ verdict: 'failed', error });
          throw error;
        }
      })());
    }
    await settleSurfaceBuilds(surfaceTasks);

    await injectedCheckpoint('after-surfaces');
    const receiptPath = path.join(artifactRun.stagingRoot, 'build-receipts', 'public-producer-receipt.json');
    const sealed = await timing.stage('seal-public-receipt', async () =>
      writePublicOutputReceipt({
        packageRoot: PACKAGE_ROOT,
        v2Root: V2_ROOT,
        surfaces,
        env: buildEnv,
        engineInput: engineInput.identity,
        sourceIdentity: publicSourceIdentity,
        surfaceRoots,
        receiptPath,
      }),
    );
    await injectedCheckpoint('after-receipt');

    const components = [];
    for (const surface of surfaces) {
      const object = await artifactStore.installObject({ sourceRoot: surfaceRoots[surface] });
      components.push({ id: surface, objectDigest: object.digest });
    }
    const receiptObject = await artifactStore.installObject({
      sourceRoot: path.dirname(receiptPath),
    });
    components.push({ id: 'receipt', objectDigest: receiptObject.digest });
    const compatibilityViews = surfaces.map((surface) => ({
      id: surface,
      componentId: surface,
      destination: path.join(PACKAGE_ROOT, surface === 'npm' ? 'dist' : 'dist-cdn'),
    }));
    compatibilityViews.push({
      id: 'receipt',
      componentId: 'receipt',
      destination: path.join(PACKAGE_ROOT, 'build-receipts'),
    });
    const promoted = await timing.stage('promote', async () =>
      artifactStore.promote({ components, compatibilityViews }),
    );
    console.log(
      `[build-public] sealed receipt ${sealed.receipt.digest.slice(0, 12)}; pointer ${promoted.pointer.digest.slice(0, 12)}`,
    );

    const written = timing.write(timingFile, { status: 'ok' });
    console.log(`[build-public] timing written to ${written.filePath}`);
  } catch (error) {
    try {
      timing.write(timingFile, { status: 'failed' });
    } catch {
      // timing evidence is best-effort on failure; the build error dominates
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  } finally {
    await artifactStore.discardRun(artifactRun).catch((error) => {
      console.error(`[build-public] failed to discard staging run ${artifactRun.runId}: ${error.message}`);
    });
  }
}

await main();
