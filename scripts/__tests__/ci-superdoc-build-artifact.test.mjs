import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { materializeCiSuperdocBuildArtifact, runWithCiSuperdocMaterialization, verifyCiSuperdocMaterialization } from '../ci-superdoc-build-artifact.mjs';
import { writeEngineConsumerArtifactReceipt } from '../ci-docx-engine-artifact.mjs';
import { artifactCanonicalSha256, createSuperDocArtifactStore } from '../superdoc-artifact-store.mjs';
import { createFixture, packFixture, replaceWithPreviousTrees, fixtureRuntimeOutputSources, git } from './fixtures/ci-superdoc-build-artifact.mjs';

test('packs and transactionally materializes the complete receipt-bound build set', () => {
  const fixture = createFixture();
  try {
    const packed = packFixture(fixture);
    replaceWithPreviousTrees(fixture);
    const restored = materializeCiSuperdocBuildArtifact({
      workspaceRoot: fixture.workspaceRoot,
      v2Root: fixture.v2Root,
      archivePath: fixture.archivePath,
    });

    assert.equal(restored.manifest.digest, packed.manifest.digest);
    assert.deepEqual(
      packed.manifest.components.map(({ id }) => id),
      [
        'public-npm',
        'public-cdn',
        'public-receipt',
        'document-api',
        'engine-consumer',
        ...Object.keys(fixtureRuntimeOutputSources).sort(),
      ],
    );
    assert.equal(readFileSync(path.join(fixture.packageRoot, 'dist', 'superdoc.es.js'), 'utf8'), 'export const publicNpm = true;\n');
    for (const [id, { source }] of Object.entries(fixtureRuntimeOutputSources)) {
      assert.equal(readFileSync(path.join(fixture.runtimeRoots[id], 'index.js'), 'utf8'), source);
    }
    assert.equal(
      verifyCiSuperdocMaterialization({
        workspaceRoot: fixture.workspaceRoot,
        v2Root: fixture.v2Root,
        expectedDigest: packed.manifest.digest,
      }).artifactDigest,
      packed.manifest.digest,
    );
    assert.throws(
      () =>
        verifyCiSuperdocMaterialization({
          workspaceRoot: fixture.workspaceRoot,
          v2Root: fixture.v2Root,
          expectedDigest: 'f'.repeat(64),
        }),
      /does not match the required digest/u,
    );
    let childEnvironment;
    assert.equal(
      runWithCiSuperdocMaterialization({
        workspaceRoot: fixture.workspaceRoot,
        v2Root: fixture.v2Root,
        command: ['pnpm', 'run', 'test:cli'],
        run(_executable, _args, options) {
          childEnvironment = options.env;
          return { status: 0 };
        },
      }),
      0,
    );
    assert.equal(childEnvironment.SUPERDOC_CLI_REQUIRE_PREBUILT_INPUTS, 'restored');
    assert.equal(childEnvironment.SUPERDOC_CLI_RESTORED_ARTIFACT_DIGEST, packed.manifest.digest);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects a modified archive before touching any destination', () => {
  const fixture = createFixture();
  try {
    packFixture(fixture);
    const archive = JSON.parse(gunzipSync(readFileSync(fixture.archivePath)).toString('utf8'));
    archive.entries[0].content = Buffer.from('tampered\n').toString('base64');
    writeFileSync(fixture.archivePath, gzipSync(Buffer.from(JSON.stringify(archive))));
    replaceWithPreviousTrees(fixture);

    assert.throws(
      () =>
        materializeCiSuperdocBuildArtifact({
          workspaceRoot: fixture.workspaceRoot,
          v2Root: fixture.v2Root,
          archivePath: fixture.archivePath,
        }),
      /content hash/u,
    );
    assert.equal(readFileSync(path.join(fixture.packageRoot, 'dist', 'previous.txt'), 'utf8'), 'previous dist\n');
    assert.equal(readFileSync(path.join(fixture.engineArtifactRoot, 'previous.txt'), 'utf8'), 'previous .ci-docx-engine\n');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('restores native artifacts in a sparse checkout without private source and rejects subsequent drift', () => {
  const fixture = createFixture();
  try {
    const packed = packFixture(fixture);
    replaceWithPreviousTrees(fixture);
    git(fixture.repoRoot, ['update-index', '--skip-worktree', 'superdoc/v2/src/index.ts']);
    rmSync(path.join(fixture.v2Root, 'src'), { recursive: true });
    materializeCiSuperdocBuildArtifact({
      workspaceRoot: fixture.workspaceRoot, v2Root: fixture.v2Root, archivePath: fixture.archivePath,
    });
    const verify = () => verifyCiSuperdocMaterialization({
      workspaceRoot: fixture.workspaceRoot, v2Root: fixture.v2Root, expectedDigest: packed.manifest.digest,
    });
    assert.equal(verify().artifactDigest, packed.manifest.digest);
    writeFileSync(path.join(fixture.runtimeRoots['native-runtime'], 'index.js'), 'unsealed replacement');
    assert.throws(verify, /native-runtime|does not match/u);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects an archive that omits a producer-sealed runtime leaf before touching any destination', () => {
  const fixture = createFixture();
  try {
    packFixture(fixture);
    const archive = JSON.parse(gunzipSync(readFileSync(fixture.archivePath)).toString('utf8'));
    const omitted = archive.manifest.components.find(({ id }) => id === 'leaf-editor-core');
    archive.manifest.components = archive.manifest.components.filter(({ id }) => id !== omitted.id);
    archive.manifest.recipe.components = archive.manifest.recipe.components.filter((id) => id !== omitted.id);
    archive.entries = archive.entries.filter(({ path: entryPath }) => !entryPath.startsWith(`${omitted.payloadPath}/`));
    const { digest: _ignored, ...unsignedManifest } = archive.manifest;
    archive.manifest.digest = artifactCanonicalSha256(unsignedManifest);
    writeFileSync(fixture.archivePath, gzipSync(Buffer.from(JSON.stringify(archive))));
    replaceWithPreviousTrees(fixture);

    assert.throws(
      () =>
        materializeCiSuperdocBuildArtifact({
          workspaceRoot: fixture.workspaceRoot,
          v2Root: fixture.v2Root,
          archivePath: fixture.archivePath,
        }),
      /unsupported recipe|incomplete component set/u,
    );
    assert.equal(
      readFileSync(path.join(fixture.runtimeRoots['leaf-editor-core'], 'previous.txt'), 'utf8'),
      'previous dist\n',
    );
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects archive path traversal before touching any destination', () => {
  const fixture = createFixture();
  try {
    packFixture(fixture);
    const archive = JSON.parse(gunzipSync(readFileSync(fixture.archivePath)).toString('utf8'));
    archive.entries[0].path = '../escape';
    writeFileSync(fixture.archivePath, gzipSync(Buffer.from(JSON.stringify(archive))));
    replaceWithPreviousTrees(fixture);

    assert.throws(
      () =>
        materializeCiSuperdocBuildArtifact({
          workspaceRoot: fixture.workspaceRoot,
          v2Root: fixture.v2Root,
          archivePath: fixture.archivePath,
        }),
      /portable relative path/u,
    );
    assert.equal(readFileSync(path.join(fixture.packageRoot, 'dist', 'previous.txt'), 'utf8'), 'previous dist\n');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects an artifact from stale public source before promotion', () => {
  const fixture = createFixture();
  try {
    packFixture(fixture);
    writeFileSync(path.join(fixture.packageRoot, 'source.js'), 'export const publicSource = false;\n');
    replaceWithPreviousTrees(fixture);

    assert.throws(
      () =>
        materializeCiSuperdocBuildArtifact({
          workspaceRoot: fixture.workspaceRoot,
          v2Root: fixture.v2Root,
          archivePath: fixture.archivePath,
        }),
      /current public source inputs/u,
    );
    assert.equal(readFileSync(path.join(fixture.packageRoot, 'dist', 'previous.txt'), 'utf8'), 'previous dist\n');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rolls every component back when promotion fails during or after the complete switch', () => {
  const fixture = createFixture();
  try {
    packFixture(fixture);
    replaceWithPreviousTrees(fixture);
    for (const failurePoint of ['after-promote:leaf-editor-core', 'after-promote:native-runtime', 'after-post-verify']) {
      assert.throws(
        () =>
          materializeCiSuperdocBuildArtifact({
            workspaceRoot: fixture.workspaceRoot,
            v2Root: fixture.v2Root,
            archivePath: fixture.archivePath,
            checkpoint(name) {
              if (name === failurePoint) throw new Error(`injected materialization failure at ${failurePoint}`);
            },
          }),
        /injected materialization failure/u,
      );
      for (const destination of [
        path.join(fixture.packageRoot, 'dist'),
        path.join(fixture.packageRoot, 'dist-cdn'),
        path.join(fixture.packageRoot, 'build-receipts'),
        fixture.documentApiRoot,
        fixture.engineArtifactRoot,
        ...Object.values(fixture.runtimeRoots),
        path.join(fixture.workspaceRoot, '.ci-superdoc-artifact'),
      ]) {
        assert.match(readFileSync(path.join(destination, 'previous.txt'), 'utf8'), /^previous /u);
      }
    }
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects a transitive runtime leaf changed after materialization', () => {
  const fixture = createFixture();
  try {
    const packed = packFixture(fixture);
    materializeCiSuperdocBuildArtifact({
      workspaceRoot: fixture.workspaceRoot,
      v2Root: fixture.v2Root,
      archivePath: fixture.archivePath,
    });
    writeFileSync(path.join(fixture.runtimeRoots['leaf-editor-core'], 'index.js'), 'tampered runtime\n');
    assert.throws(
      () =>
        verifyCiSuperdocMaterialization({
          workspaceRoot: fixture.workspaceRoot,
          v2Root: fixture.v2Root,
          expectedDigest: packed.manifest.digest,
        }),
      /leaf-editor-core/u,
    );
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('packs runtime leaves from the immutable producer pointer instead of mutable compatibility views', async () => {
  const fixture = createFixture();
  try {
    const store = createSuperDocArtifactStore({ root: path.join(fixture.v2Root, '.build-artifacts', 'engine') });
    const componentSources = [
      ['dist', path.join(fixture.v2Root, 'dist')],
      ['dist-cdn', path.join(fixture.v2Root, 'dist-cdn')],
      ...Object.entries(fixture.runtimeRoots),
      ['receipt', path.join(fixture.v2Root, 'build-receipts')],
    ];
    const components = [];
    const compatibilityViews = [];
    for (const [id, sourceRoot] of componentSources) {
      const object = await store.installObject({ sourceRoot });
      components.push({ id, objectDigest: object.digest });
      compatibilityViews.push({ id, componentId: id, destination: sourceRoot });
    }
    await store.promote({ components, compatibilityViews });

    writeFileSync(path.join(fixture.runtimeRoots['leaf-editor-core'], 'index.js'), 'mutated compatibility view\n');
    const packed = packFixture(fixture);
    replaceWithPreviousTrees(fixture);
    materializeCiSuperdocBuildArtifact({
      workspaceRoot: fixture.workspaceRoot,
      v2Root: fixture.v2Root,
      archivePath: fixture.archivePath,
    });

    assert.match(packed.manifest.digest, /^[0-9a-f]{64}$/u);
    assert.equal(
      readFileSync(path.join(fixture.runtimeRoots['leaf-editor-core'], 'index.js'), 'utf8'),
      fixtureRuntimeOutputSources['leaf-editor-core'].source,
    );
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects symlinked component input and preserves an existing archive on pack failure', () => {
  const fixture = createFixture();
  try {
    writeFileSync(fixture.archivePath, 'previous archive\n');
    const target = path.join(fixture.repoRoot, 'outside.js');
    writeFileSync(target, 'outside\n');
    symlinkSync(target, path.join(fixture.documentApiRoot, 'linked.js'));
    assert.throws(() => packFixture(fixture), /contains a symlink/u);
    assert.equal(readFileSync(fixture.archivePath, 'utf8'), 'previous archive\n');
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('rejects an engine consumer tarball bound to a different producer receipt', () => {
  const fixture = createFixture();
  try {
    const engineArchive = path.join(fixture.engineArtifactRoot, 'superdoc-docx-engine-1.2.3.tgz');
    rmSync(path.join(fixture.engineArtifactRoot, 'engine-consumer-receipt.json'));
    writeEngineConsumerArtifactReceipt({
      root: fixture.engineArtifactRoot,
      engineArchive,
      verifiedEngine: {
        engineVersion: '1.2.3',
        receipt: { digest: 'e'.repeat(64), inputIdentity: { digest: 'b'.repeat(64) } },
        surfaces: { dist: { digest: 'c'.repeat(64) }, 'dist-cdn': { digest: 'd'.repeat(64) } },
      },
    });
    assert.throws(() => packFixture(fixture), /does not match the public producer receipt/u);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});
