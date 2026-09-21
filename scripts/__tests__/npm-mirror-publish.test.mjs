import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  assertPlatformPackagesPublished,
  assertPlatformVersionsAligned,
  assertPublishedArtifactMatches,
  buildMirrorTarball,
  deprecateVersion,
  publishTarball,
  publishWithMirror,
  resolveWorkspacePath,
  tarballIntegrity,
  tarballShasum,
} = require('../npm-mirror-publish.cjs');

const silent = { log() {} };

const withTempPackage = (manifest, run) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mirror-test-'));
  const packageRoot = path.join(dir, 'package');
  mkdirSync(packageRoot);
  writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    return run(packageRoot, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Records every command instead of running it, so publish ordering and argument
 * shape can be asserted without touching a registry. Pack calls create a stub
 * file so the caller's real filesystem handling still runs.
 */
const recordingEffects = ({ packOutput = 'package.tgz' } = {}) => {
  const calls = [];
  return {
    calls,
    run: (command, args) => {
      calls.push([command, ...args]);
    },
    runCapture: (command, args) => {
      calls.push([command, ...args]);
      const destIndex = args.indexOf('--pack-destination');
      if (destIndex !== -1) {
        writeFileSync(path.join(args[destIndex + 1], packOutput), 'stub');
      }
      return packOutput;
    },
  };
};

const sdkManifest = (overrides = {}) => ({
  name: '@superdoc/sdk',
  version: '1.22.0',
  optionalDependencies: {
    '@superdoc/sdk-darwin-arm64': '1.22.0',
    '@superdoc/sdk-linux-x64': '1.22.0',
  },
  ...overrides,
});

const SDK_PLATFORMS = ['@superdoc/sdk-darwin-arm64', '@superdoc/sdk-linux-x64'];

// --- version alignment -------------------------------------------------------

test('platform packages pinned to the root version pass', () => {
  assert.doesNotThrow(() =>
    assertPlatformVersionsAligned({ manifest: sdkManifest(), platformPackages: SDK_PLATFORMS }),
  );
});

test('a platform package left on an older version is rejected', () => {
  const manifest = sdkManifest({
    optionalDependencies: {
      '@superdoc/sdk-darwin-arm64': '1.22.0',
      '@superdoc/sdk-linux-x64': '1.21.1',
    },
  });

  assert.throws(
    () => assertPlatformVersionsAligned({ manifest, platformPackages: SDK_PLATFORMS }),
    /sdk-linux-x64 is pinned to 1\.21\.1, expected 1\.22\.0/u,
  );
});

test('a platform package starting a fresh version line is rejected', () => {
  // The failure this guards against: a renamed platform family published at
  // 0.1.0 while its root is on 1.22.0. Install succeeds, then the binary is
  // missing at runtime.
  const manifest = sdkManifest({
    optionalDependencies: {
      '@superdoc/sdk-darwin-arm64': '0.1.0',
      '@superdoc/sdk-linux-x64': '0.1.0',
    },
  });

  assert.throws(
    () => assertPlatformVersionsAligned({ manifest, platformPackages: SDK_PLATFORMS }),
    /pinned to 0\.1\.0, expected 1\.22\.0/u,
  );
});

test('a platform package missing from optionalDependencies is rejected', () => {
  const manifest = sdkManifest({
    optionalDependencies: { '@superdoc/sdk-darwin-arm64': '1.22.0' },
  });

  assert.throws(
    () => assertPlatformVersionsAligned({ manifest, platformPackages: SDK_PLATFORMS }),
    /sdk-linux-x64 is missing from optionalDependencies/u,
  );
});

test('every mismatch is reported at once', () => {
  const manifest = sdkManifest({
    optionalDependencies: { '@superdoc/sdk-darwin-arm64': '1.21.1' },
  });

  assert.throws(
    () => assertPlatformVersionsAligned({ manifest, platformPackages: SDK_PLATFORMS }),
    (error) =>
      /darwin-arm64 is pinned to 1\.21\.1/u.test(error.message) &&
      /linux-x64 is missing/u.test(error.message),
  );
});

test('a package with no platform family skips the check', () => {
  assert.doesNotThrow(() =>
    assertPlatformVersionsAligned({ manifest: { name: '@superdoc/fonts', version: '0.2.0' } }),
  );
});

// --- registry preflight ------------------------------------------------------

test('publishing is blocked until every platform package is on the registry', () => {
  // A correct manifest pin proves nothing about whether the package exists.
  // npm skips an unresolvable optional dependency silently at install time.
  const isPublished = (name) => name !== '@superdoc/sdk-linux-x64';

  assert.throws(
    () =>
      assertPlatformPackagesPublished({
        manifest: sdkManifest(),
        platformPackages: SDK_PLATFORMS,
        isPublished,
        logger: silent,
      }),
    /sdk-linux-x64@1\.22\.0 is not on the registry/u,
  );
});

test('the preflight passes when all platform packages are present', () => {
  assert.doesNotThrow(() =>
    assertPlatformPackagesPublished({
      manifest: sdkManifest(),
      platformPackages: SDK_PLATFORMS,
      isPublished: () => true,
      logger: silent,
    }),
  );
});

test('the preflight checks the root version, not just presence', () => {
  const seen = [];
  assertPlatformPackagesPublished({
    manifest: sdkManifest(),
    platformPackages: SDK_PLATFORMS,
    isPublished: (name, version) => {
      seen.push(`${name}@${version}`);
      return true;
    },
    logger: silent,
  });

  assert.deepEqual(seen, [
    '@superdoc/sdk-darwin-arm64@1.22.0',
    '@superdoc/sdk-linux-x64@1.22.0',
  ]);
});

// --- mirror manifest rewrite -------------------------------------------------

test('the mirror keeps new-scope platform dependencies', () => {
  // The mirror's own name is the only legacy identity in the artifact. Rewriting
  // its companions back to the old scope would fork the platform family.
  withTempPackage(sdkManifest(), (packageRoot, dir) => {
    const { manifest } = buildMirrorTarball({
      packageRoot,
      mirrorName: '@superdoc-dev/sdk',
      destination: dir,
      effects: recordingEffects(),
      logger: silent,
    });

    assert.equal(manifest.name, '@superdoc-dev/sdk');
    assert.deepEqual(manifest.optionalDependencies, {
      '@superdoc/sdk-darwin-arm64': '1.22.0',
      '@superdoc/sdk-linux-x64': '1.22.0',
    });
    assert.doesNotThrow(() =>
      assertPlatformVersionsAligned({ manifest, platformPackages: SDK_PLATFORMS }),
    );
  });
});

test('the mirror keeps the canonical version and persists the rewrite', () => {
  withTempPackage(sdkManifest(), (packageRoot, dir) => {
    const { manifest } = buildMirrorTarball({
      packageRoot,
      mirrorName: '@superdoc-dev/sdk',
      destination: dir,
      effects: recordingEffects(),
      logger: silent,
    });

    assert.equal(manifest.version, '1.22.0');

    const onDisk = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(onDisk.name, '@superdoc-dev/sdk');
    assert.equal(onDisk.publishConfig.access, 'public');
  });
});

test('the rewrite forces public access without dropping other publishConfig keys', () => {
  const manifest = sdkManifest({
    publishConfig: { access: 'restricted', registry: 'https://registry.example.com' },
  });

  withTempPackage(manifest, (packageRoot, dir) => {
    const { manifest: mirrored } = buildMirrorTarball({
      packageRoot,
      mirrorName: '@superdoc-dev/sdk',
      destination: dir,
      effects: recordingEffects(),
      logger: silent,
    });

    assert.equal(mirrored.publishConfig.access, 'public');
    assert.equal(mirrored.publishConfig.registry, 'https://registry.example.com');
  });
});

test('the rewrite changes nothing except name and access', () => {
  const manifest = sdkManifest({
    dependencies: { yjs: '^13.6.19' },
    exports: { '.': './dist/index.js' },
    files: ['dist'],
  });

  withTempPackage(manifest, (packageRoot, dir) => {
    const { manifest: mirrored } = buildMirrorTarball({
      packageRoot,
      mirrorName: '@superdoc-dev/sdk',
      destination: dir,
      effects: recordingEffects(),
      logger: silent,
    });

    assert.deepEqual(mirrored.dependencies, { yjs: '^13.6.19' });
    assert.deepEqual(mirrored.exports, { '.': './dist/index.js' });
    assert.deepEqual(mirrored.files, ['dist']);
  });
});

test('the mirror tarball is renamed so it cannot collide with the canonical one', () => {
  // npm derives the tarball filename from the manifest, and two names that
  // differ only by scope produce the same basename.
  withTempPackage(sdkManifest(), (packageRoot, dir) => {
    const { tarballPath } = buildMirrorTarball({
      packageRoot,
      mirrorName: '@superdoc-dev/sdk',
      destination: dir,
      effects: recordingEffects({ packOutput: 'superdoc-sdk-1.22.0.tgz' }),
      logger: silent,
    });

    assert.match(path.basename(tarballPath), /^mirror-/u);
  });
});

// --- publish sequence --------------------------------------------------------

test('publishing uploads the tarball by path, not the directory', () => {
  // Publishing a directory makes npm build a fresh tarball, so the audited bytes
  // would not be the uploaded bytes.
  const effects = recordingEffects();

  publishTarball({
    tarballPath: '/tmp/pkg.tgz',
    manifest: { name: '@superdoc/fonts', version: '0.2.0' },
    tag: 'next',
    isPublished: () => false,
    effects,
    logger: silent,
  });

  const publish = effects.calls.find((call) => call[1] === 'publish');
  assert.ok(publish, 'expected a publish call');
  assert.equal(publish[2], '/tmp/pkg.tgz');
  assert.deepEqual(publish.slice(3, 7), ['--access', 'public', '--tag', 'next']);
});

test('an already-published version repairs its dist-tag instead of failing', () => {
  // Republishing an existing version is a hard error, so a release that failed
  // partway has to be resumable - but only after proving the artifact matches.
  withTarball('published build', (tarballPath) => {
    const effects = recordingEffects();

    const result = publishTarball({
      tarballPath,
      manifest: { name: '@superdoc/fonts', version: '0.2.0' },
      tag: 'next',
      isPublished: () => true,
      getChecksums: () => ({ integrity: tarballIntegrity(tarballPath) }),
      effects,
      logger: silent,
    });

    assert.equal(result.published, false);
    assert.ok(!effects.calls.some((call) => call[1] === 'publish'));

    const distTag = effects.calls.find((call) => call[1] === 'dist-tag');
    assert.deepEqual(distTag.slice(1), [
      'dist-tag',
      'add',
      '@superdoc/fonts@0.2.0',
      'next',
      '--registry',
      'https://registry.npmjs.org',
    ]);
  });
});

test('deprecation targets one exact version, never a range', () => {
  // npm deprecate is retroactive: it marks versions that exist when it runs and
  // stores no rule, so a range here would sweep in unrelated versions.
  const effects = recordingEffects();

  deprecateVersion({
    packageName: '@superdoc-dev/fonts',
    version: '0.2.0',
    message: 'Moved to @superdoc/fonts',
    effects,
    logger: silent,
  });

  const call = effects.calls.find((entry) => entry[1] === 'deprecate');
  assert.equal(call[2], '@superdoc-dev/fonts@0.2.0');
  assert.equal(call[3], 'Moved to @superdoc/fonts');
});

// --- resume safety -----------------------------------------------------------

const withTarball = (contents, run) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tarball-test-'));
  const tarballPath = path.join(dir, 'package.tgz');
  writeFileSync(tarballPath, contents);
  try {
    return run(tarballPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('local checksums are computed the way npm records them', () => {
  // Verified against the registry: @superdoc-dev/fonts@0.2.0 hashes to the same
  // sha512 and sha1 values npm reports as dist.integrity and dist.shasum.
  withTarball('hello', (tarballPath) => {
    assert.equal(
      tarballIntegrity(tarballPath),
      `sha512-${createHash('sha512').update('hello').digest('base64')}`,
    );
    assert.equal(
      tarballShasum(tarballPath),
      createHash('sha1').update('hello').digest('hex'),
    );
  });
});

test('resuming onto a version built from a different artifact fails closed', () => {
  // Without this, a rerun on a changed build leaves canonical at the old code
  // and publishes the mirror from the new code at the same version.
  withTarball('rebuilt artifact', (tarballPath) => {
    assert.throws(
      () =>
        assertPublishedArtifactMatches({
          tarballPath,
          manifest: { name: '@superdoc/fonts', version: '0.2.0' },
          getChecksums: () => ({ integrity: 'sha512-somethingElseEntirely==' }),
        }),
      /already published from a different artifact/u,
    );
  });
});

test('resuming onto the same artifact is allowed', () => {
  withTarball('same artifact', (tarballPath) => {
    const integrity = tarballIntegrity(tarballPath);
    assert.doesNotThrow(() =>
      assertPublishedArtifactMatches({
        tarballPath,
        manifest: { name: '@superdoc/fonts', version: '0.2.0' },
        getChecksums: () => ({ integrity }),
      }),
    );
  });
});

test('a version with only the legacy shasum still gets compared', () => {
  // Packages published before dist.integrity existed carry sha1 only. Falling
  // back keeps the check meaningful instead of skipping it.
  withTarball('legacy artifact', (tarballPath) => {
    assert.doesNotThrow(() =>
      assertPublishedArtifactMatches({
        tarballPath,
        manifest: { name: '@superdoc/fonts', version: '0.2.0' },
        getChecksums: () => ({ integrity: null, shasum: tarballShasum(tarballPath) }),
      }),
    );

    assert.throws(
      () =>
        assertPublishedArtifactMatches({
          tarballPath,
          manifest: { name: '@superdoc/fonts', version: '0.2.0' },
          getChecksums: () => ({ integrity: null, shasum: 'deadbeef' }),
        }),
      /already published from a different artifact/u,
    );
  });
});

test('a registry version with no checksum at all is refused, not skipped', () => {
  // Degrading to a no-op here would let the caller retag a version it cannot
  // prove it built.
  withTarball('anything', (tarballPath) => {
    assert.throws(
      () =>
        assertPublishedArtifactMatches({
          tarballPath,
          manifest: { name: '@superdoc/fonts', version: '0.2.0' },
          getChecksums: () => ({ integrity: null, shasum: null }),
        }),
      /Refusing to retag an unverified artifact/u,
    );
  });
});

test('resume without a checksum lookup is refused outright', () => {
  withTarball('anything', (tarballPath) => {
    assert.throws(
      () =>
        assertPublishedArtifactMatches({
          tarballPath,
          manifest: { name: '@superdoc/fonts', version: '0.2.0' },
        }),
      /no checksum lookup was provided/u,
    );
  });
});

test('the resume branch mutates nothing when identity cannot be proven', () => {
  // The tag mutation must not be reachable from an unverified resume.
  const effects = recordingEffects();

  assert.throws(() =>
    publishTarball({
      tarballPath: '/tmp/does-not-exist.tgz',
      manifest: { name: '@superdoc/fonts', version: '0.2.0' },
      tag: 'next',
      isPublished: () => true,
      effects,
      logger: silent,
    }),
  );

  assert.deepEqual(effects.calls, []);
});

test('the resume branch refuses to retag a mismatched artifact', () => {
  withTarball('local build', (tarballPath) => {
    const effects = recordingEffects();

    assert.throws(
      () =>
        publishTarball({
          tarballPath,
          manifest: { name: '@superdoc/fonts', version: '0.2.0' },
          tag: 'next',
          isPublished: () => true,
          getChecksums: () => ({ integrity: 'sha512-differentBuild==' }),
          effects,
          logger: silent,
        }),
      /already published from a different artifact/u,
    );

    assert.deepEqual(effects.calls, []);
  });
});

// --- full orchestration ------------------------------------------------------

/**
 * Drives publishWithMirror against a fake workspace package. `pnpm pack` and
 * `npm pack` are simulated by writing a stub tarball containing a real manifest,
 * so the whole sequence runs without a registry or a build.
 */
const runPublishWithMirror = ({
  manifest,
  published = new Set(),
  divergentMirror = false,
  expectThrow = null,
  overrides = {},
}) => {
  // Tmpdir, with the containment root pointed at it. Writing a fixture into the
  // repository would make `check:release-scripts` mutate the working tree, and
  // the naming convention is that `check:*` never does.
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'mirror-ws-'));
  const packageDir = '.';
  const calls = [];
  const packedChecksums = { canonical: null, mirror: null };

  const effects = {
    run: (command, args) => {
      calls.push([command, ...args]);
      if (command === 'mkdir') mkdirSync(args[1], { recursive: true });
      if (command === 'tar') {
        const dest = args[args.indexOf('-C') + 1];
        const root = path.join(dest, 'package');
        mkdirSync(root, { recursive: true });
        writeFileSync(
          path.join(root, 'package.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
      }
    },
    runCapture: (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === 'view') {
        const spec = args[1];
        if (!published.has(spec)) {
          const error = new Error('E404 Not found');
          error.stderr = 'npm error code E404';
          throw error;
        }
        // A resumed release must prove the published version came from the
        // tarball in hand, so the fake registry reports the stub's real hashes.
        const which = spec.startsWith('@superdoc-dev/') ? 'mirror' : 'canonical';
        // Simulates a mirror version that exists but was built from other bytes.
        if (divergentMirror && which === 'mirror') {
          if (args[2] === 'dist.integrity') return 'sha512-someoneelsesbytes';
          if (args[2] === 'dist.shasum') return '0000000000000000000000000000000000000000';
        }
        if (args[2] === 'dist.integrity') return packedChecksums[which]?.integrity ?? '';
        if (args[2] === 'dist.shasum') return packedChecksums[which]?.shasum ?? '';
        return spec.split('@').pop();
      }
      const destIndex = args.indexOf('--pack-destination');
      if (destIndex !== -1) {
        // Canonical and mirror packs both land here; give each distinct bytes so
        // a checksum comparison is meaningful. The caller renames the mirror
        // tarball afterwards, so hash the bytes rather than a fixed path.
        const isCanonical = command === 'pnpm';
        const name = isCanonical ? 'pkg.tgz' : 'mirror-src.tgz';
        const body = isCanonical ? 'canonical-stub' : 'mirror-stub';
        writeFileSync(path.join(args[destIndex + 1], name), body);
        packedChecksums[isCanonical ? 'canonical' : 'mirror'] = {
          integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
          shasum: createHash('sha1').update(body).digest('hex'),
        };
        return name;
      }
      return 'pkg.tgz';
    },
  };

  const invoke = () =>
    publishWithMirror({
      packageDir,
      workspaceRoot: workspace,
      mirrorName: '@superdoc-dev/fonts',
      deprecationMessage: 'Moved to @superdoc/fonts',
      tag: 'next',
      effects,
      logger: silent,
      ...overrides,
    });

  try {
    if (expectThrow) {
      assert.throws(invoke, expectThrow);
      return { result: null, calls };
    }
    const result = publishWithMirror({
      packageDir,
      workspaceRoot: workspace,
      mirrorName: '@superdoc-dev/fonts',
      deprecationMessage: 'Moved to @superdoc/fonts',
      tag: 'next',
      effects,
      logger: silent,
      ...overrides,
    });
    return { result, calls };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
};

test('dry runs audit both tarballs without publishing, retagging or deprecating', () => {
  for (const published of [new Set(), new Set(['@superdoc/fonts@0.3.0', '@superdoc-dev/fonts@0.3.0'])]) {
    let audited = false;
    const { result, calls } = runPublishWithMirror({
      manifest: { name: '@superdoc/fonts', version: '0.3.0' },
      published,
      overrides: {
        dryRun: true,
        expectedVersion: '0.3.0',
        tag: 'latest',
        onTarballs: ({ canonicalTarball, mirrorTarball }) => {
          assert.ok(readFileSync(canonicalTarball).length);
          assert.ok(readFileSync(mirrorTarball).length);
          audited = true;
        },
      },
    });
    assert.equal(audited, true);
    assert.equal(result.canonical.published, false);
    assert.equal(result.mirror.published, false);
    assert.equal(calls.filter((call) => call[1] === 'publish').length, 2);
    assert.ok(calls.filter((call) => call[1] === 'publish').every((call) => call.includes('--dry-run')));
    assert.ok(calls.every((call) => !['deprecate', 'dist-tag'].includes(call[1])));
  }
});

const fontsManifest = { name: '@superdoc/fonts', version: '0.2.0' };

test('canonical publishes before the mirror, and the mirror is deprecated last', () => {
  // Order matters: the mirror carries canonical dependencies, so publishing it
  // first would reference packages that do not exist yet.
  const { calls } = runPublishWithMirror({ manifest: fontsManifest });

  const sequence = calls
    .filter((call) => call[1] === 'publish' || call[1] === 'deprecate')
    .map((call) => `${call[1]} ${call[2]}`);

  assert.equal(sequence.length, 3);
  assert.match(sequence[0], /^publish .*\/pkg\.tgz$/u);
  assert.match(sequence[1], /^publish .*\/mirror-/u);
  assert.equal(sequence[2], 'deprecate @superdoc-dev/fonts@0.2.0');
});

test('both names publish at the same version', () => {
  const { result } = runPublishWithMirror({ manifest: fontsManifest });

  assert.equal(result.version, '0.2.0');
  assert.equal(result.canonical.name, '@superdoc/fonts');
  assert.equal(result.mirror.name, '@superdoc-dev/fonts');
  assert.ok(result.canonical.published);
  assert.ok(result.mirror.published);
});

test('an audit callback sees both tarballs before anything is published', () => {
  // PR 3 uses this to run the shared artifact auditor against the exact bytes
  // that will upload.
  let seen = null;
  const { calls } = runPublishWithMirror({
    manifest: fontsManifest,
    overrides: {
      onTarballs: (tarballs) => {
        seen = { ...tarballs, publishesSoFar: 0 };
      },
    },
  });

  assert.ok(seen, 'expected onTarballs to be called');
  assert.equal(path.basename(seen.canonicalTarball), 'pkg.tgz');
  assert.match(path.basename(seen.mirrorTarball), /^mirror-/u);
  assert.equal(seen.version, '0.2.0');
  assert.ok(calls.some((call) => call[1] === 'publish'));
});

test('an audit failure stops the release before any publish', () => {
  assert.throws(
    () =>
      runPublishWithMirror({
        manifest: fontsManifest,
        overrides: {
          onTarballs: () => {
            throw new Error('artifact contains a source map');
          },
        },
      }),
    /artifact contains a source map/u,
  );
});

test('a packed version other than the requested one publishes nothing', () => {
  // The interrupted-prerelease shape. `packages/fonts/.releaserc.cjs` adds
  // @semantic-release/git only for non-prereleases, so a `main` bump is never
  // committed: a rerun where semantic-release no-ops leaves the tag at
  // 0.3.0-next.1 and package.json at 0.2.0. Publishing the packed 0.2.0 would
  // drag the `next` dist-tag backwards onto an older release while the verifier
  // waited on a version nothing repaired.
  const { calls } = runPublishWithMirror({
    manifest: fontsManifest,
    overrides: { expectedVersion: '0.3.0-next.1' },
    expectThrow: /packed version 0\.2\.0 does not match the requested 0\.3\.0-next\.1/u,
  });

  assert.deepEqual(
    calls.filter((call) => call[1] === 'publish' || call[1] === 'dist-tag' || call[1] === 'deprecate'),
    [],
    'nothing may publish, retag, or deprecate on a version mismatch',
  );
});

test('a packed version matching the requested one releases normally', () => {
  const { result } = runPublishWithMirror({
    manifest: fontsManifest,
    overrides: { expectedVersion: '0.2.0' },
  });

  assert.equal(result.version, '0.2.0');
  assert.ok(result.canonical.published);
  assert.ok(result.mirror.published);
});

test('omitting the requested version leaves the packed version unchallenged', () => {
  // Callers that do not know the version up front, such as a plain local
  // publish, must keep working.
  const { result } = runPublishWithMirror({ manifest: fontsManifest });

  assert.equal(result.version, '0.2.0');
});

test('a mirror name equal to the canonical name is rejected', () => {
  assert.throws(
    () =>
      runPublishWithMirror({
        manifest: fontsManifest,
        overrides: { mirrorName: '@superdoc/fonts' },
      }),
    /matches the canonical package name/u,
  );
});

test('a mirror without a deprecation message is rejected', () => {
  assert.throws(
    () =>
      runPublishWithMirror({
        manifest: fontsManifest,
        overrides: { deprecationMessage: '' },
      }),
    /deprecationMessage is required/u,
  );
});

test('the temp directory is cleaned up even when the release fails', () => {
  const before = new Set(
    require('node:fs')
      .readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith('superdoc-mirror-')),
  );

  assert.throws(() =>
    runPublishWithMirror({
      manifest: fontsManifest,
      overrides: {
        onTarballs: () => {
          throw new Error('audit failed');
        },
      },
    }),
  );

  const after = require('node:fs')
    .readdirSync(os.tmpdir())
    .filter((entry) => entry.startsWith('superdoc-mirror-') && !before.has(entry));

  assert.deepEqual(after, []);
});

test('a resumed release retags instead of republishing', () => {
  // The canonical half already landed; only the mirror should publish.
  const { calls, result } = runPublishWithMirror({
    manifest: fontsManifest,
    published: new Set(['@superdoc/fonts@0.2.0']),
  });

  assert.equal(result.canonical.published, false);
  assert.equal(result.mirror.published, true);

  const publishes = calls.filter((call) => call[1] === 'publish');
  assert.equal(publishes.length, 1);
  assert.match(path.basename(publishes[0][2]), /^mirror-/u);

  assert.ok(calls.some((call) => call[1] === 'dist-tag' && call[3] === '@superdoc/fonts@0.2.0'));
});

test('a divergent published mirror aborts before the canonical publish', () => {
  // The exact fonts-pilot shape: the mirror version already exists from the
  // legacy pipeline, the canonical one does not. Published versions are
  // immutable, so if this check ran per-tarball the canonical half would land
  // first and the pair would be permanently stuck on different artifacts at the
  // same version. Nothing may publish.
  const { calls } = runPublishWithMirror({
    manifest: fontsManifest,
    published: new Set(['@superdoc-dev/fonts@0.2.0']),
    divergentMirror: true,
    expectThrow: /already published .*different artifact|does not match/iu,
  });

  assert.deepEqual(
    calls.filter((call) => call[1] === 'publish' || call[1] === 'deprecate'),
    [],
  );
});

test('a divergent published mirror aborts before the audit callback runs', () => {
  // The callback is a public extension point, so it must not observe a release
  // that is already guaranteed to abort. The fonts publisher only reads the
  // tarballs here, but a future caller could publish a report.
  let seen = false;
  runPublishWithMirror({
    manifest: fontsManifest,
    published: new Set(['@superdoc-dev/fonts@0.2.0']),
    divergentMirror: true,
    overrides: {
      onTarballs: () => {
        seen = true;
      },
    },
    expectThrow: /already published .*different artifact|does not match/iu,
  });

  assert.equal(seen, false);
});

test('a matching published mirror still lets the canonical half publish', () => {
  // Same resume shape, matching bytes. This must stay a working resume path, or
  // the fonts pilot could never publish its first canonical version.
  const { result, calls } = runPublishWithMirror({
    manifest: fontsManifest,
    published: new Set(['@superdoc-dev/fonts@0.2.0']),
  });

  assert.equal(result.canonical.published, true);
  assert.equal(result.mirror.published, false);

  const publishes = calls.filter((call) => call[1] === 'publish');
  assert.equal(publishes.length, 1);
  assert.match(path.basename(publishes[0][2]), /^pkg\.tgz$/u);
});

// --- workspace containment ---------------------------------------------------

test('a packageDir inside the repository resolves', () => {
  assert.ok(resolveWorkspacePath('packages/fonts').endsWith(path.join('packages', 'fonts')));
});

test('a packageDir that escapes the repository is rejected', () => {
  // A miscomputed packageDir would otherwise pack and publish whatever sits at
  // that path, and publish time is a bad place to discover it.
  for (const escape of ['../../etc', 'packages/../../..', '/tmp', '../']) {
    assert.throws(
      () => resolveWorkspacePath(escape),
      /must stay inside the repository/u,
      `expected ${escape} to be rejected`,
    );
  }
});

test('a mirror pack that overwrites the canonical tarball is refused', () => {
  // npm derives the tarball filename from the package name, and two names can
  // flatten to the same basename: `@a/b-c` and `@a-b/c` both give `a-b-c`.
  // Scope-only renames do not collide, but the helper is not scope-only.
  withTempPackage(sdkManifest(), (packageRoot, dir) => {
    const collidingPath = path.join(dir, 'package.tgz');

    assert.throws(
      () =>
        buildMirrorTarball({
          packageRoot,
          mirrorName: '@superdoc-dev/sdk',
          destination: dir,
          canonicalTarballPath: collidingPath,
          effects: recordingEffects(),
          logger: silent,
        }),
      /overwrote the canonical tarball/u,
    );
  });
});

test('a symlink inside the repository that points outside is rejected', (t) => {
  // A lexical prefix check passes here because the path *looks* internal, but
  // pnpm pack follows the link and would pack whatever it targets.
  const root = mkdtempSync(path.join(os.tmpdir(), 'symlink-root-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'symlink-outside-'));

  try {
    // 'junction' is the one directory-link type Windows creates without elevation
    // or Developer Mode; it is ignored on POSIX. If the platform still refuses,
    // skip rather than fail: the guard is what is under test, not the ability to
    // make a symlink.
    try {
      symlinkSync(outside, path.join(root, 'link'), 'junction');
    } catch (error) {
      t.skip(`cannot create a directory symlink here: ${error.code ?? error.message}`);
      return;
    }

    assert.throws(
      () => resolveWorkspacePath('link', root),
      /must stay inside the repository/u,
      'a symlink escaping the root must be refused',
    );

    mkdirSync(path.join(root, 'real-package'));
    assert.doesNotThrow(() => resolveWorkspacePath('real-package', root));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a path that does not exist yet is still checked lexically', () => {
  // realpath cannot resolve a missing path; the containment rule must still
  // apply rather than silently passing.
  const root = mkdtempSync(path.join(os.tmpdir(), 'symlink-root-'));

  try {
    assert.doesNotThrow(() => resolveWorkspacePath('not/created/yet', root));
    assert.throws(() => resolveWorkspacePath('../escape', root), /must stay inside/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
