#!/usr/bin/env node
//
// smoke-v2-runtime-mode.mjs - dual-mode v2 resolver smoke.
//
// Proves the publishing-boundary invariants of the v2 runtime resolver without
// running a full build:
//
//   - Orbit source mode aliases the private v2 contract into `superdoc/v2/**/src`
//     and enables the `source` export condition (fast HMR).
//   - Package mode never aliases into `superdoc/v2/**/src` (release safety).
//   - Package mode requires a VERIFIED engine input: a sealed prepared engine
//     (producer receipt + exact-tree match + exact version) or the exact
//     installed package. Bare file existence is never accepted.
//   - A stale, mutated, unsealed, or version-mismatched prepared engine fails
//     closed and names the canonical preparation command.
//   - Package mode never resolves `@superdoc/headless/*`.
//   - Source mode fails clearly when private v2 source is absent.
//   - Plain dev/build/pack/release never auto-select source mode.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_MODE,
  SOURCE_MODE,
  assertNoSrcAliases,
  headlessImportGuardPlugin,
  resolveEnginePackageRoot,
  resolveSuperDocV2RuntimeMode,
} from '../vite.v2-runtime-mode.mjs';
import {
  ENGINE_PREPARE_COMMAND,
  hashEngineTree,
  observeEngineInputIdentity,
  readDeclaredEngineVersion,
  writeEngineProducerReceipt,
} from '../../../scripts/engine-prepared-input.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const V2_ROOT = resolveEnginePackageRoot(import.meta.url);
const LAYOUT_ENGINE_ROOT = path.resolve(PACKAGE_ROOT, '../layout-engine');
const DECLARED_ENGINE_VERSION = readDeclaredEngineVersion(PACKAGE_ROOT);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  OK ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n    ${error instanceof Error ? error.message : error}`);
  }
}

function aliasReplacements(resolution) {
  return resolution.aliases.map((a) => (typeof a.replacement === 'string' ? a.replacement : ''));
}

function hasAlias(resolution, find, replacement) {
  return resolution.aliases.some((alias) => String(alias.find) === find && alias.replacement === replacement);
}

function resolveThroughAliases(resolution, specifier) {
  const alias = resolution.aliases.find(({ find }) =>
    find instanceof RegExp
      ? find.test(specifier)
      : specifier === find || specifier.startsWith(`${find}/`),
  );
  return alias ? specifier.replace(alias.find, alias.replacement) : null;
}

function aliasesTouchV2Src(resolution, v2Root = V2_ROOT) {
  const srcRoot = path.join(v2Root, 'src');
  return aliasReplacements(resolution).some((r) => r.startsWith(`${srcRoot}${path.sep}`));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Build a properly SEALED prepared-engine fixture: dist files, an engine dist
 * manifest with per-file hashes and protection metadata, and a producer
 * receipt sealing the exact tree. This is the same contract a real
 * `build:engine` run produces.
 */
function sealFixture(tmpV2, { version = DECLARED_ENGINE_VERSION } = {}) {
  mkdirSync(tmpV2, { recursive: true });
  writeFileSync(
    path.join(tmpV2, 'package.json'),
    `${JSON.stringify({ name: '@superdoc/docx-engine', version })}\n`,
  );
  const dist = path.join(tmpV2, 'dist');
  mkdirSync(dist, { recursive: true });
  const distFiles = {
    'docx-engine.es.js': 'export {};\n',
    'collaboration-upgrade-engine.js': 'export {};\n',
    'collaboration-worker.js': 'export {};\n',
    'style.css': '',
    'docx-engine.d.ts': 'export {};\n',
    'collaboration-worker.d.ts': 'export {};\n',
  };
  for (const [name, contents] of Object.entries(distFiles)) {
    writeFileSync(path.join(dist, name), contents);
  }
  const protection = {
    schema: 'sd-docx-engine-obfuscation/v1',
    tool: 'javascript-obfuscator@0.0.0-fixture',
    optionsSha256: '0'.repeat(64),
    obfuscatedSetSha256: '1'.repeat(64),
    entryCount: Object.keys(distFiles).length,
  };
  const manifest = {
    schemaVersion: 1,
    packageName: '@superdoc/docx-engine',
    distPrefix: 'dist',
    generatedAt: new Date().toISOString(),
    protection,
    files: Object.entries(distFiles)
      .map(([name, contents]) => ({
        path: name,
        sha256: sha256(contents),
        sizeBytes: Buffer.byteLength(contents),
        contentType: 'application/octet-stream',
      }))
      .sort((left, right) => (left.path < right.path ? -1 : 1)),
  };
  writeFileSync(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const tree = hashEngineTree(dist);
  writeEngineProducerReceipt({
    v2Root: tmpV2,
    receipt: {
      engineVersion: version,
      target: 'package',
      builtAtIso: new Date().toISOString(),
      authority: { nonce: 'f'.repeat(32), mode: 'standalone', orchestrator: 'direct' },
      toolchain: { node: process.version },
      inputIdentity: observeEngineInputIdentity({ v2Root: tmpV2, repoRoot: path.resolve(tmpV2, '../..') }),
      surfaces: {
        dist: { digest: tree.digest, fileCount: tree.files.length, sizeBytes: tree.sizeBytes, protection },
      },
    },
  });
  return tmpV2;
}

function withSealedFixture(fn, options = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'superdoc-v2-sealed-'));
  const tmpV2 = path.join(repoRoot, 'superdoc', 'v2');
  try {
    sealFixture(tmpV2, options);
    return fn(tmpV2);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

const PREPARED_ENV = { SUPERDOC_ENGINE_INPUT: 'prepared' };

function resolvePackage(v2Root, extraEnv = {}, command = 'build') {
  return resolveSuperDocV2RuntimeMode({
    command,
    env: { ...PREPARED_ENV, ...extraEnv },
    packageRoot: PACKAGE_ROOT,
    v2Root,
    layoutEngineRoot: LAYOUT_ENGINE_ROOT,
  });
}

console.log('[smoke:v2-resolver] dual-mode v2 runtime resolver');

const v2SourcePresent = existsSync(path.join(V2_ROOT, 'src', 'superdoc', 'index.ts'));

check('build defaults to package mode (never auto-source)', () => {
  withSealedFixture((v2Root) => {
    const r = resolveSuperDocV2RuntimeMode({
      command: 'build',
      env: { ...PREPARED_ENV },
      packageRoot: PACKAGE_ROOT,
      v2Root,
      layoutEngineRoot: LAYOUT_ENGINE_ROOT,
    });
    if (r.mode !== PACKAGE_MODE) throw new Error(`expected package mode, got ${r.mode}`);
  });
});

check('dev server defaults to package mode unless source mode is explicit', () => {
  withSealedFixture((v2Root) => {
    const r = resolvePackage(v2Root, {}, 'serve');
    if (r.mode !== PACKAGE_MODE) throw new Error(`expected package mode, got ${r.mode}`);
    if (r.conditions.includes('source')) throw new Error('implicit dev mode must not use source conditions');
  });
});

check('package mode never aliases into superdoc/v2/**/src', () => {
  withSealedFixture((v2Root) => {
    const r = resolvePackage(v2Root, { SUPERDOC_V2_RUNTIME_MODE: 'package' });
    assertNoSrcAliases(r.aliases, v2Root);
    if (aliasesTouchV2Src(r, v2Root)) throw new Error('package-mode alias points into v2 src');
    if (r.conditions.includes('source')) throw new Error('package mode must not use the source export condition for v2');
    if (r.engineInput?.contract !== 'prepared') throw new Error('package mode must report the verified prepared contract');
  });
});

check('sealed dist-only prepared engine resolves (public-topology equivalent) and maps the engine entries', () => {
  withSealedFixture((v2Root) => {
    if (existsSync(path.join(v2Root, 'src'))) throw new Error('fixture unexpectedly has src/');
    const r = resolvePackage(v2Root, { SUPERDOC_V2_RUNTIME_MODE: 'package' });
    if (r.mode !== PACKAGE_MODE) throw new Error(`expected package mode, got ${r.mode}`);
    assertNoSrcAliases(r.aliases, v2Root);
    const hasSuperdocEntry = aliasReplacements(r).some((rep) => rep.endsWith('docx-engine.es.js'));
    if (!hasSuperdocEntry) throw new Error('package mode did not map @superdoc/docx-engine onto the dist entry');
    const hasUpgradeEngine = aliasReplacements(r).some((rep) => rep.endsWith('collaboration-upgrade-engine.js'));
    if (!hasUpgradeEngine) throw new Error('package mode did not map the collaboration upgrade engine build input');
    const hasCollaborationWorker = aliasReplacements(r).some((rep) => rep.endsWith('collaboration-worker.js'));
    if (!hasCollaborationWorker) throw new Error('package mode did not map the collaboration worker build input');
    const hasHeadless = r.aliases.some((alias) => String(alias.find).includes('headless'));
    if (hasHeadless) throw new Error('package mode must not alias @superdoc/headless');

    let threw = false;
    try {
      resolveSuperDocV2RuntimeMode({
        command: 'serve',
        env: { SUPERDOC_V2_RUNTIME_MODE: 'source' },
        packageRoot: PACKAGE_ROOT,
        v2Root,
        layoutEngineRoot: LAYOUT_ENGINE_ROOT,
      });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('source mode must fail clearly when v2 source is absent');
  });
});

check('unsealed ambient dist fails closed and names the canonical preparation command', () => {
  withSealedFixture((tmpV2) => {
    rmSync(path.join(tmpV2, 'build-receipts'), { recursive: true, force: true });
    let observedError = null;
    try {
      resolvePackage(tmpV2);
    } catch (error) {
      observedError = error;
    }
    const message = observedError instanceof Error ? observedError.message : String(observedError ?? '');
    if (!message) throw new Error('unsealed dist must not resolve');
    if (observedError?.code !== 'engine-receipt-missing') {
      throw new Error(`expected engine-receipt-missing, got ${observedError?.code ?? 'no code'}`);
    }
    if (!message.includes(ENGINE_PREPARE_COMMAND)) {
      throw new Error(`fail-closed error must name the canonical preparation command; got: ${message}`);
    }
  });
});

check('a sealed engine mutated after sealing fails closed', () => {
  withSealedFixture((v2Root) => {
    writeFileSync(path.join(v2Root, 'dist', 'docx-engine.es.js'), 'export const tampered = 1;\n');
    let observedError = null;
    try {
      resolvePackage(v2Root);
    } catch (error) {
      observedError = error;
    }
    if (!observedError) throw new Error('mutated sealed engine must not resolve');
    if (observedError.code === 'engine-input-stale') throw new Error('mutation failed for the wrong identity reason');
  });
});

check('a prepared engine with the wrong version fails closed', () => {
  withSealedFixture((tmpV2) => {
    let observedError = null;
    try {
      resolvePackage(tmpV2);
    } catch (error) {
      observedError = error;
    }
    if (!observedError) throw new Error('version-mismatched prepared engine must not resolve');
    if (observedError.code !== 'engine-version-mismatch') {
      throw new Error(`expected engine-version-mismatch, got ${observedError.code ?? 'no code'}`);
    }
  }, { version: '0.0.1' });
});

check('an unexpected stray file inside the sealed dist fails closed', () => {
  withSealedFixture((v2Root) => {
    writeFileSync(path.join(v2Root, 'dist', 'stray.js'), 'export {};\n');
    let threw = false;
    try {
      resolvePackage(v2Root);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('stray files in a sealed tree must not verify');
  });
});

if (v2SourcePresent) {
  check('Orbit source mode aliases into v2 src and enables the source condition', () => {
    const r = resolveSuperDocV2RuntimeMode({
      command: 'serve',
      env: { SUPERDOC_V2_RUNTIME_MODE: 'source' },
      packageRoot: PACKAGE_ROOT,
      v2Root: V2_ROOT,
      layoutEngineRoot: LAYOUT_ENGINE_ROOT,
    });
    if (r.mode !== SOURCE_MODE) throw new Error(`expected source mode, got ${r.mode}`);
    if (!aliasesTouchV2Src(r)) throw new Error('source mode did not alias into v2 src');
    if (!r.conditions.includes('source')) throw new Error('source mode must enable the source condition');
    const layoutEngineSource = path.join(LAYOUT_ENGINE_ROOT, 'layout-engine', 'src', 'index.ts');
    if (!aliasReplacements(r).includes(layoutEngineSource)) {
      throw new Error('source mode must alias @superdoc/layout-engine to source');
    }
    const contractsSource = path.join(LAYOUT_ENGINE_ROOT, 'contracts', 'src', 'index.ts');
    if (!hasAlias(r, '/^@superdoc\\/contracts$/', contractsSource)) {
      throw new Error('source mode must alias @superdoc/contracts to live public source');
    }
    const collaborationSdkSource = path.join(
      V2_ROOT,
      'document-api-v2-adapter',
      'src',
      'worker',
      'collaboration-sdk.ts',
    );
    const collaborationSdkSpecifier = '@superdoc/document-api-v2-adapter/worker/collaboration-sdk';
    const resolvedCollaborationSdk = resolveThroughAliases(r, collaborationSdkSpecifier);
    if (resolvedCollaborationSdk !== collaborationSdkSource) {
      throw new Error(
        `source mode resolved ${collaborationSdkSpecifier} to ${resolvedCollaborationSdk ?? 'nothing'}`,
      );
    }
    const workerSource = path.join(V2_ROOT, 'document-api-v2-adapter', 'src', 'worker', 'index.ts');
    const workerSpecifier = '@superdoc/document-api-v2-adapter/worker';
    const resolvedWorker = resolveThroughAliases(r, workerSpecifier);
    if (resolvedWorker !== workerSource) {
      throw new Error(`source mode resolved ${workerSpecifier} to ${resolvedWorker ?? 'nothing'}`);
    }
    const nodeWorkerSource = path.join(
      V2_ROOT,
      'document-api-v2-adapter',
      'src',
      'worker',
      'node-channel.ts',
    );
    const nodeWorkerSpecifier = '@superdoc/document-api-v2-adapter/worker/node';
    const resolvedNodeWorker = resolveThroughAliases(r, nodeWorkerSpecifier);
    if (resolvedNodeWorker !== nodeWorkerSource) {
      throw new Error(
        `source mode resolved ${nodeWorkerSpecifier} to ${resolvedNodeWorker ?? 'nothing'}`,
      );
    }
  });
} else {
  console.log('  (skip) Orbit source-mode case - superdoc/v2 source not present');
}

check('invalid mode value is rejected', () => {
  let threw = false;
  try {
    resolveSuperDocV2RuntimeMode({
      command: 'build',
      env: { SUPERDOC_V2_RUNTIME_MODE: 'bogus' },
      packageRoot: PACKAGE_ROOT,
      v2Root: V2_ROOT,
      layoutEngineRoot: LAYOUT_ENGINE_ROOT,
    });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('invalid mode should throw');
});

check('installed contract rejects a node-linked engine whose package dist is missing', () => {
  const tmpPackageRoot = mkdtempSync(path.join(tmpdir(), 'superdoc-v2-node-linked-'));
  const tmpV2Root = mkdtempSync(path.join(tmpdir(), 'superdoc-v2-empty-dist-'));
  try {
    writeFileSync(
      path.join(tmpPackageRoot, 'package.json'),
      `${JSON.stringify({ name: 'consumer', dependencies: { '@superdoc/docx-engine': DECLARED_ENGINE_VERSION } })}\n`,
    );
    const linked = path.join(tmpPackageRoot, 'node_modules', '@superdoc', 'docx-engine');
    mkdirSync(linked, { recursive: true });
    writeFileSync(
      path.join(linked, 'package.json'),
      `${JSON.stringify({ name: '@superdoc/docx-engine', version: DECLARED_ENGINE_VERSION })}\n`,
    );
    let threw = false;
    try {
      resolveSuperDocV2RuntimeMode({
        command: 'build',
        env: { SUPERDOC_V2_RUNTIME_MODE: 'package', SUPERDOC_ENGINE_INPUT: 'installed' },
        packageRoot: tmpPackageRoot,
        v2Root: tmpV2Root,
        layoutEngineRoot: LAYOUT_ENGINE_ROOT,
      });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('missing node-installed dist should not be treated as resolvable');
  } finally {
    rmSync(tmpPackageRoot, { recursive: true, force: true });
    rmSync(tmpV2Root, { recursive: true, force: true });
  }
});

check('package mode blocks @superdoc/headless resolution; source mode does not add the guard', () => {
  const guard = headlessImportGuardPlugin(PACKAGE_MODE);
  if (!guard) throw new Error('package mode must return the headless guard plugin');
  let threw = false;
  try {
    guard.resolveId('@superdoc/headless/browser');
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('the guard must reject @superdoc/headless subpath imports');
  if (guard.resolveId('@superdoc/docx-engine') !== undefined) {
    throw new Error('the guard must ignore non-headless specifiers');
  }
  if (headlessImportGuardPlugin(SOURCE_MODE) !== null) {
    throw new Error('source mode must not install the package-mode headless guard');
  }
});

if (failures > 0) {
  console.error(`[smoke:v2-resolver] FAIL (${failures} check(s) failed)`);
  process.exit(1);
}
console.log('[smoke:v2-resolver] PASS');
