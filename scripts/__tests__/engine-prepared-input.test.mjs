import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  EngineInputError,
  ENGINE_INPUT_IDENTITY_SCHEMA,
  ENGINE_PREPARE_COMMAND,
  hashEngineTree,
  normalizeExactEngineVersion,
  observeEngineInputIdentity,
  quarantineInvalidEngineProducerSelection,
  readEngineProducerReceipt,
  readEngineProducerSelection,
  resolveEngineInputContract,
  sha256Canonical,
  verifyInstalledEngine,
  verifyPreparedEngine,
  writeEngineProducerReceipt,
} from '../engine-prepared-input.mjs';
import { createSuperDocArtifactStore } from '../superdoc-artifact-store.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const PROTECTION = {
  schema: 'sd-docx-engine-obfuscation/v1',
  tool: 'javascript-obfuscator@0.0.0-test',
  optionsSha256: '0'.repeat(64),
  obfuscatedSetSha256: '1'.repeat(64),
  entryCount: 3,
};

function writeSealedEngine(
  v2Root,
  { version = '1.2.3', mutateAfterSeal = null, inputIdentity = null, runtimeOutputs = [] } = {},
) {
  writeFileSync(path.join(v2Root, 'package.json'), JSON.stringify({ name: '@superdoc/docx-engine', version }));
  const dist = path.join(v2Root, 'dist');
  mkdirSync(dist, { recursive: true });
  const files = {
    'docx-engine.es.js': 'export {};\n',
    'collaboration-upgrade-engine.js': 'export {};\n',
    'style.css': 'body{}\n',
  };
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(dist, name), contents);
  writeFileSync(
    path.join(dist, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      packageName: '@superdoc/docx-engine',
      distPrefix: 'dist',
      protection: PROTECTION,
      files: Object.entries(files).map(([name, contents]) => ({
        path: name,
        sha256: sha256(contents),
        sizeBytes: Buffer.byteLength(contents),
      })),
    }),
  );
  const tree = hashEngineTree(dist);
  const sealedRuntimeOutputs = {};
  for (const output of runtimeOutputs) {
    const root = path.join(v2Root, ...output.destination.split('/'));
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'index.js'), output.contents);
    const runtimeTree = hashEngineTree(root);
    sealedRuntimeOutputs[output.id] = {
      digest: runtimeTree.digest,
      fileCount: runtimeTree.files.length,
      sizeBytes: runtimeTree.sizeBytes,
      destination: output.destination,
    };
  }
  writeEngineProducerReceipt({
    v2Root,
    receipt: {
      engineVersion: version,
      target: 'package',
      builtAtIso: new Date().toISOString(),
      authority: { nonce: 'a'.repeat(32), mode: 'standalone', orchestrator: 'direct' },
      toolchain: { node: process.version },
      ...(inputIdentity ? { inputIdentity } : {}),
      surfaces: { dist: { digest: tree.digest, fileCount: tree.files.length, sizeBytes: tree.sizeBytes, protection: PROTECTION } },
      ...(runtimeOutputs.length > 0 ? { runtimeOutputs: sealedRuntimeOutputs } : {}),
    },
  });
  if (mutateAfterSeal) mutateAfterSeal(dist);
  return tree;
}

function testInputIdentity(headSha = 'a'.repeat(40)) {
  const body = {
    schema: ENGINE_INPUT_IDENTITY_SCHEMA,
    mode: 'git',
    headSha,
    trackedDiffSha256: 'b'.repeat(64),
    untracked: [],
  };
  return { ...body, digest: sha256Canonical(body) };
}

function withTemp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sd-engine-input-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGit(repoRoot, ...args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('a sealed prepared engine verifies and reports its receipt digest', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root);
    const verified = verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' });
    assert.equal(verified.mode, 'prepared');
    assert.equal(verified.engineVersion, '1.2.3');
    assert.match(verified.receipt.digest, /^[0-9a-f]{64}$/);
    assert.ok(verified.surfaces.dist.fileCount >= 4);
  });
});

test('engine selection resolves runtime leaves from immutable pointer components', async (t) => {
  const v2Root = mkdtempSync(path.join(tmpdir(), 'sd-engine-runtime-selection-'));
  t.after(() => rmSync(v2Root, { recursive: true, force: true }));
  writeSealedEngine(v2Root, {
    runtimeOutputs: [
      {
        id: 'leaf-headless',
        destination: 'headless/dist',
        contents: 'sealed runtime\n',
      },
    ],
  });

  const store = createSuperDocArtifactStore({ root: path.join(v2Root, '.build-artifacts', 'engine') });
  const dist = await store.installObject({ sourceRoot: path.join(v2Root, 'dist') });
  const runtime = await store.installObject({ sourceRoot: path.join(v2Root, 'headless', 'dist') });
  const receipt = await store.installObject({ sourceRoot: path.join(v2Root, 'build-receipts') });
  await store.promote({
    components: [
      { id: 'dist', objectDigest: dist.digest },
      { id: 'leaf-headless', objectDigest: runtime.digest },
      { id: 'receipt', objectDigest: receipt.digest },
    ],
    compatibilityViews: [
      { id: 'dist', componentId: 'dist', destination: path.join(v2Root, 'dist') },
      {
        id: 'leaf-headless',
        componentId: 'leaf-headless',
        destination: path.join(v2Root, 'headless', 'dist'),
      },
      { id: 'receipt', componentId: 'receipt', destination: path.join(v2Root, 'build-receipts') },
    ],
  });

  writeFileSync(path.join(v2Root, 'headless', 'dist', 'index.js'), 'mutated compatibility view\n');
  const selection = readEngineProducerSelection(v2Root);
  assert.notEqual(selection.runtimeRoots['leaf-headless'], path.join(v2Root, 'headless', 'dist'));
  assert.equal(readFileSync(path.join(selection.runtimeRoots['leaf-headless'], 'index.js'), 'utf8'), 'sealed runtime\n');
});

test('missing receipt fails closed with the canonical preparation command', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root);
    rmSync(path.join(v2Root, 'build-receipts'), { recursive: true, force: true });
    assert.throws(
      () => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' }),
      (error) => error instanceof EngineInputError && error.message.includes(ENGINE_PREPARE_COMMAND),
    );
  });
});

test('bytes changed after sealing fail the exact-tree check', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root, {
      mutateAfterSeal: (dist) => writeFileSync(path.join(dist, 'style.css'), 'body{color:red}\n'),
    });
    assert.throws(() => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' }), /does not match its manifest/);
  });
});

test('unexpected files inside the sealed tree are rejected', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root, {
      mutateAfterSeal: (dist) => writeFileSync(path.join(dist, 'stray.js'), 'export {};\n'),
    });
    assert.throws(() => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' }), /unexpected: stray.js/);
  });
});

test('symlinks inside the sealed tree are rejected', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root, {
      mutateAfterSeal: (dist) => symlinkSync(path.join(dist, 'style.css'), path.join(dist, 'link.css')),
    });
    assert.throws(() => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' }), /symlink/);
  });
});

test('version mismatches fail in both directions', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root, { version: '9.9.9' });
    assert.throws(() => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' }), /does not match the declared dependency/);
  });
});

test('a tampered receipt fails its self-digest check', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root);
    const receiptPath = path.join(v2Root, 'build-receipts', 'engine-producer-receipt.json');
    const receipt = readEngineProducerReceipt(v2Root);
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, engineVersion: '6.6.6' }));
    assert.throws(() => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3' }), /self-digest/);
  });
});

test('an invalid authoritative pointer can be quarantined before a producer rebuild', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root);
    const pointerPath = path.join(v2Root, '.build-artifacts', 'engine', 'pointers', 'current.json');
    mkdirSync(path.dirname(pointerPath), { recursive: true });
    writeFileSync(pointerPath, '{not json\n');
    let observedError;
    try {
      readEngineProducerSelection(v2Root);
    } catch (error) {
      observedError = error;
    }
    assert.equal(observedError?.code, 'engine-pointer-corrupt');
    const quarantined = quarantineInvalidEngineProducerSelection(v2Root, observedError);
    assert.equal(quarantined?.sourcePath, pointerPath);
    assert.match(quarantined?.quarantinePath ?? '', /quarantine/u);
    assert.equal(readEngineProducerSelection(v2Root).pointer, null);
  });
});

test('orchestrator-expected receipt digest binding is enforced', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root);
    assert.throws(
      () => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3', expectedReceiptDigest: 'b'.repeat(64) }),
      /orchestrator-expected digest/,
    );
  });
});

test('prepared reuse is bound to the current source input identity', () => {
  withTemp((v2Root) => {
    const builtFrom = testInputIdentity();
    writeSealedEngine(v2Root, { inputIdentity: builtFrom });
    assert.doesNotThrow(() =>
      verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3', currentInputIdentity: builtFrom }),
    );
    assert.throws(
      () =>
        verifyPreparedEngine({
          v2Root,
          expectedVersion: '1.2.3',
          currentInputIdentity: testInputIdentity('c'.repeat(40)),
        }),
      /does not match the current checkout/,
    );
  });
});

test('engine input identity invalidates on every public producer helper without absorbing adjacent outputs', () => {
  withTemp((repoRoot) => {
    const helperPaths = [
      'superdoc/public/scripts/audit-publish-artifact.mjs',
      'superdoc/public/scripts/engine-prepared-input.mjs',
      'superdoc/public/scripts/engine-native-runtime.mjs',
      'superdoc/public/scripts/superdoc-artifact-store.mjs',
      'superdoc/public/scripts/superdoc-build-timing.mjs',
    ];
    for (const relative of ['superdoc/v2/package.json', ...helperPaths]) {
      const absolute = path.join(repoRoot, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${relative}\n`);
    }
    runGit(repoRoot, 'init', '--quiet');
    runGit(repoRoot, 'add', '.');
    runGit(
      repoRoot,
      '-c',
      'user.name=SuperDoc Test',
      '-c',
      'user.email=superdoc-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    const v2Root = path.join(repoRoot, 'superdoc/v2');
    const baseline = observeEngineInputIdentity({ v2Root, repoRoot });

    for (const relative of helperPaths) {
      const absolute = path.join(repoRoot, relative);
      const original = readFileSync(absolute, 'utf8');
      writeFileSync(absolute, `${original}changed\n`);
      assert.notEqual(observeEngineInputIdentity({ v2Root, repoRoot }).digest, baseline.digest, relative);
      writeFileSync(absolute, original);
      assert.equal(observeEngineInputIdentity({ v2Root, repoRoot }).digest, baseline.digest, relative);
    }

    const unrelatedOutput = path.join(repoRoot, 'superdoc/public/scripts/generated-output.json');
    writeFileSync(unrelatedOutput, '{}\n');
    assert.equal(observeEngineInputIdentity({ v2Root, repoRoot }).digest, baseline.digest);
  });
});

test('engine input identity falls back to a deterministic source closure without Git', () => {
  withTemp((repoRoot) => {
    const v2Root = path.join(repoRoot, 'superdoc', 'v2');
    mkdirSync(path.join(v2Root, 'src', 'superdoc'), { recursive: true });
    writeFileSync(path.join(v2Root, 'package.json'), '{}\n');
    const sourcePath = path.join(v2Root, 'src', 'superdoc', 'index.ts');
    writeFileSync(sourcePath, 'export const engine = true;\n');

    const baseline = observeEngineInputIdentity({ v2Root, repoRoot });
    assert.equal(baseline.mode, 'content');
    assert.match(baseline.contentDigest, /^[a-f0-9]{64}$/u);

    mkdirSync(path.join(v2Root, 'dist'), { recursive: true });
    writeFileSync(path.join(v2Root, 'dist', 'ambient.js'), 'generated output\n');
    mkdirSync(path.join(v2Root, 'build-receipts'));
    writeFileSync(path.join(v2Root, 'build-receipts', 'receipt.json'), '{}\n');
    assert.equal(observeEngineInputIdentity({ v2Root, repoRoot }).digest, baseline.digest);

    writeFileSync(sourcePath, 'export const engine = false;\n');
    assert.notEqual(observeEngineInputIdentity({ v2Root, repoRoot }).digest, baseline.digest);
    writeFileSync(sourcePath, 'export const engine = true;\n');
    symlinkSync('index.ts', path.join(v2Root, 'src', 'superdoc', 'linked.ts'));
    const linked = observeEngineInputIdentity({ v2Root, repoRoot });
    assert.notEqual(linked.digest, baseline.digest);
    assert.equal(observeEngineInputIdentity({ v2Root, repoRoot }).digest, linked.digest);
    symlinkSync(tmpdir(), path.join(v2Root, 'src', 'superdoc', 'outside'));
    assert.throws(() => observeEngineInputIdentity({ v2Root, repoRoot }), /symlink escapes/u);
  });
});

test('receipts that do not seal a requested surface are rejected', () => {
  withTemp((v2Root) => {
    writeSealedEngine(v2Root);
    assert.throws(
      () => verifyPreparedEngine({ v2Root, expectedVersion: '1.2.3', surfaces: ['dist', 'dist-cdn'] }),
      /does not seal surface dist-cdn/,
    );
  });
});

test('contract resolution: explicit env wins; private source selects prepared; otherwise installed', () => {
  withTemp((v2Root) => {
    assert.equal(resolveEngineInputContract({ env: {}, v2Root }).mode, 'installed');
    mkdirSync(path.join(v2Root, 'src', 'superdoc'), { recursive: true });
    writeFileSync(path.join(v2Root, 'src', 'superdoc', 'index.ts'), 'export {};\n');
    assert.equal(resolveEngineInputContract({ env: {}, v2Root }).mode, 'prepared');
    assert.equal(resolveEngineInputContract({ env: { SUPERDOC_ENGINE_INPUT: 'installed' }, v2Root }).mode, 'installed');
    assert.throws(
      () => resolveEngineInputContract({ env: { SUPERDOC_ENGINE_INPUT: 'ambient' }, v2Root }),
      /invalid SUPERDOC_ENGINE_INPUT/,
    );
  });
});

test('installed contract rejects resolving into the private v2 workspace', () => {
  withTemp((dir) => {
    const packageRoot = path.join(dir, 'consumer');
    const linked = path.join(packageRoot, 'node_modules', '@superdoc', 'docx-engine');
    mkdirSync(linked, { recursive: true });
    writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@superdoc/docx-engine', version: '1.2.3' }));
    mkdirSync(path.join(linked, 'src', 'superdoc'), { recursive: true });
    writeFileSync(path.join(linked, 'src', 'superdoc', 'index.ts'), 'export {};\n');
    assert.throws(
      () => verifyInstalledEngine({ packageRoot, expectedVersion: '1.2.3' }),
      /private v2 workspace/,
    );
  });
});

test('installed contract verifies packaged manifest hashes when present', () => {
  withTemp((dir) => {
    const packageRoot = path.join(dir, 'consumer');
    const engineRoot = path.join(packageRoot, 'node_modules', '@superdoc', 'docx-engine');
    const dist = path.join(engineRoot, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(engineRoot, 'package.json'), JSON.stringify({ name: '@superdoc/docx-engine', version: '1.2.3' }));
    const files = {
      'docx-engine.es.js': 'export {};\n',
      'collaboration-upgrade-engine.js': 'export {};\n',
      'collaboration-worker.js': 'export {};\n',
      'style.css': '',
      'docx-engine.d.ts': 'export {};\n',
      'collaboration-worker.d.ts': 'export {};\n',
      'DOCX-ENGINE-LICENSE.md': 'license\n',
      'NOTICE.md': 'notice\n',
    };
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(dist, name), contents);
    writeFileSync(
      path.join(dist, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        packageName: '@superdoc/docx-engine',
        files: Object.entries(files).map(([name, contents]) => ({ path: name, sha256: sha256(contents) })),
      }),
    );
    const verified = verifyInstalledEngine({ packageRoot, expectedVersion: '1.2.3' });
    assert.equal(verified.mode, 'installed');

    writeFileSync(path.join(dist, 'style.css'), 'tampered');
    assert.throws(() => verifyInstalledEngine({ packageRoot, expectedVersion: '1.2.3' }), /changed: style.css/);
  });
});

test('exact version normalization accepts workspace pins and rejects ranges', () => {
  assert.equal(normalizeExactEngineVersion('workspace:0.5.0-next.1'), '0.5.0-next.1');
  assert.equal(normalizeExactEngineVersion('1.0.0'), '1.0.0');
  assert.throws(() => normalizeExactEngineVersion('^1.0.0'), /exact version/);
  assert.throws(() => normalizeExactEngineVersion('workspace:*'), /exact version/);
});
