#!/usr/bin/env node
//
// npm-mirror-publish.cjs - publish one built package under two npm names.
//
// A package that changes npm scope cannot take its old name with it: npm has no
// alias or redirect, and a scoped package's scope IS its owning org, so the new
// name is always a new package. The only way to keep existing installs working
// is to publish the same build under both names for a while.
//
// This module packs the canonical tarball once, derives the mirror from it, and
// publishes both .tgz files by path. Publishing a directory instead would make
// npm build a fresh tarball at publish time, so the bytes an artifact audit
// inspected would not be the bytes uploaded.
//
// Deliberately NOT rewritten in the mirror: dependencies, optionalDependencies,
// and every other manifest field. A mirror of `@superdoc/sdk` published as
// `@superdoc-dev/sdk` still depends on `@superdoc/sdk-*` platform packages. The
// mirror's own name is the only legacy identity in the artifact. Pointing its
// companions back at the old scope would fork the platform family and mean
// publishing every native binary twice, forever.
//
// Publishing both names from one tarball enforces their exact-version invariant.

const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  defaultEffects,
  defaultRegistry,
  makeChecksumLookup,
  makeRegistryLookup,
  rootDir,
  tarballIntegrity,
  tarballShasum,
} = require('./npm-registry.cjs');

/**
 * Confirm a version already on the registry was built from the tarball we are
 * holding.
 *
 * Resume has to be safe, not just quiet. Treating "the version exists" as "the
 * work is done" lets a rerun on a different commit publish mismatched halves of
 * a release: canonical stays at the old build because its version is taken,
 * while the mirror uploads the new build under the same version. The two names
 * are then permanently different code at one version, which is exactly what
 * publishing both from one tarball is supposed to prevent.
 *
 * AIDEV-NOTE: This must never degrade to a no-op. Skipping the comparison when a
 * checksum is unavailable would let the caller retag a version it cannot prove
 * it built. If neither checksum can be read, fail and make a human decide.
 */
const assertPublishedArtifactMatches = ({ tarballPath, manifest, getChecksums }) => {
  if (typeof getChecksums !== 'function') {
    throw new Error(
      `${manifest.name}@${manifest.version} is already published, but no checksum lookup was provided to prove it matches this build.`,
    );
  }

  const remote = getChecksums(manifest.name, manifest.version) || {};
  const comparisons = [
    { field: 'dist.integrity', remote: remote.integrity, local: () => tarballIntegrity(tarballPath) },
    { field: 'dist.shasum', remote: remote.shasum, local: () => tarballShasum(tarballPath) },
  ].filter((entry) => entry.remote);

  if (comparisons.length === 0) {
    throw new Error(
      `${manifest.name}@${manifest.version} is already published, but the registry reports no ` +
        'dist.integrity or dist.shasum to compare against. Refusing to retag an unverified artifact.',
    );
  }

  for (const { field, remote: recorded, local } of comparisons) {
    const computed = local();
    if (computed !== recorded) {
      throw new Error(
        `${manifest.name}@${manifest.version} is already published from a different artifact.\n` +
          `  registry ${field}: ${recorded}\n` +
          `  local    ${field}: ${computed}\n` +
          'Publish a new version rather than resuming against a changed build.',
      );
    }
  }
};

/**
 * Refuse to publish a tarball whose version is not the one the caller asked for.
 *
 * AIDEV-NOTE: A resume is driven by a release tag, but the tarball comes from
 * whatever the checkout holds, and the two can disagree. `packages/fonts/.releaserc.cjs`
 * only adds `@semantic-release/git` for non-prereleases, so a `main` prerelease
 * bump is never committed: on a rerun where semantic-release no-ops, the tag says
 * 0.3.0-next.1 while package.json still says 0.2.0. Without this check the resume
 * would publish, or worse retag, the wrong version - moving a `next` dist-tag
 * backwards onto an older release - while the verifier waits on a version nobody
 * repaired. Checking out the tag does not fix it, because the tagged commit does
 * not carry the bump either. Fail and let a human decide.
 */
const assertPackedVersion = ({ manifest, expectedVersion }) => {
  if (!expectedVersion || manifest.version === expectedVersion) return;

  throw new Error(
    `${manifest.name} packed version ${manifest.version} does not match the requested ${expectedVersion}.\n` +
      'The checkout cannot produce the requested version, so publishing it would upload or retag the wrong release.\n' +
      'Release from a tree whose manifest is at the requested version.',
  );
};

/**
 * Every version string that must agree for one release of a package that
 * selects a native binary at runtime.
 *
 * The root pins each platform package to an exact version, and the runtime
 * resolves the binary through that pin. A mismatch does not fail at install
 * time - npm happily installs an optional dependency at a different version -
 * it fails later as a missing binary on whichever platform drifted.
 */
const assertPlatformVersionsAligned = ({ manifest, platformPackages = [] }) => {
  if (platformPackages.length === 0) return;

  const optional = manifest.optionalDependencies || {};
  const mismatches = [];

  for (const platformName of platformPackages) {
    const pinned = optional[platformName];
    if (!pinned) {
      mismatches.push(`${platformName} is missing from optionalDependencies`);
      continue;
    }
    if (pinned !== manifest.version) {
      mismatches.push(`${platformName} is pinned to ${pinned}, expected ${manifest.version}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `${manifest.name}@${manifest.version} platform version mismatch:\n  ${mismatches.join('\n  ')}`,
    );
  }
};

/**
 * Confirm every platform package is already on the registry at this version.
 *
 * Manifest pins alone prove nothing: a root can pin `@superdoc/sdk-linux-x64@1.22.0`
 * while that package has never been published. Install then succeeds, npm skips
 * the unresolvable optional dependency, and the binary is missing at runtime.
 * Platform packages must publish before their root, and this is what enforces it.
 */
const assertPlatformPackagesPublished = ({
  manifest,
  platformPackages = [],
  isPublished,
  logger = console,
}) => {
  if (platformPackages.length === 0) return;

  const missing = platformPackages.filter((name) => !isPublished(name, manifest.version));

  if (missing.length > 0) {
    throw new Error(
      `${manifest.name}@${manifest.version} cannot publish before its platform packages:\n  ` +
        `${missing.map((name) => `${name}@${manifest.version} is not on the registry`).join('\n  ')}`,
    );
  }

  logger.log(`All ${platformPackages.length} platform packages present at ${manifest.version}.`);
};

/**
 * Resolve a workspace-relative package directory, refusing anything that escapes
 * the repository.
 *
 * A miscomputed or caller-supplied `packageDir` containing `../` would otherwise
 * pack and publish whatever sits at that path. The publish step is not a good
 * place to discover that: by then the tarball is already built from the wrong
 * contents.
 */
/**
 * realpath for a path that may not exist: resolve the deepest existing ancestor
 * and re-append the missing tail.
 */
const realpathOfNearestExisting = (target) => {
  let current = target;
  const missing = [];

  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return target;
    missing.unshift(path.basename(current));
    current = parent;
  }

  return path.join(realpathSync(current), ...missing);
};

const resolveWorkspacePath = (packageDir, workspaceRoot = rootDir) => {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, packageDir);

  // Compare real paths, not lexical ones. A symlink inside the repository can
  // point anywhere, and `pnpm pack` follows it: a lexical prefix check would
  // accept `packages/link` while the pack actually runs outside the tree.
  // A path that does not exist yet cannot be realpath'd, so resolve the nearest
  // existing ancestor and re-append the rest. Without this, a missing directory
  // under a symlinked root (macOS /tmp, for one) compares a real root against a
  // lexical path and fails a containment check it should pass.
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  const realResolved = realpathOfNearestExisting(resolved);
  const withinRoot =
    realResolved === realRoot || realResolved.startsWith(`${realRoot}${path.sep}`);

  if (!withinRoot) {
    throw new Error(`packageDir must stay inside the repository, got: ${packageDir}`);
  }

  return resolved;
};

const findTarball = (packOutput) => {
  const line = packOutput
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith('.tgz'));

  if (!line) throw new Error(`Could not find a .tgz in pack output:\n${packOutput}`);
  return line;
};

/**
 * Pack a workspace package, keeping the tarball, and extract a copy beside it.
 *
 * pnpm resolves `workspace:` and `catalog:` specifiers during pack, so the
 * extracted manifest carries real version ranges rather than workspace
 * protocols. The tarball is what gets published; the extracted copy exists so
 * the mirror can be rebuilt from identical contents.
 */
const packAndExtract = ({
  packageDir,
  destination,
  workspaceRoot,
  effects = defaultEffects,
  logger = console,
}) => {
  const cwd = resolveWorkspacePath(packageDir, workspaceRoot);
  logger.log(`Packing ${packageDir}...`);

  const packOutput = effects.runCapture('pnpm', ['pack', '--pack-destination', destination], cwd);
  const tarballLine = findTarball(packOutput);
  const tarballPath = path.isAbsolute(tarballLine)
    ? tarballLine
    : path.join(destination, tarballLine);

  // mkdirSync rather than a `mkdir -p` shell-out: on Windows mkdir is a shell
  // builtin with no -p, so the spawn fails outright. Directory creation does not
  // need to be injectable for tests either, since it touches only the temp dir.
  const extractDir = path.join(destination, 'extracted');
  mkdirSync(extractDir, { recursive: true });
  effects.run('tar', ['-xzf', tarballPath, '-C', extractDir], destination);

  return { tarballPath, packageRoot: path.join(extractDir, 'package') };
};

const readManifest = (packageRoot) =>
  JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

/**
 * Rewrite the extracted manifest to the legacy name and repack it as the mirror
 * tarball. Returns the mirrored manifest and the tarball path.
 */
const buildMirrorTarball = ({
  packageRoot,
  mirrorName,
  destination,
  canonicalTarballPath,
  effects = defaultEffects,
  logger = console,
}) => {
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // AIDEV-NOTE: Rewrite `name` only. Do not rewrite dependencies or
  // optionalDependencies to the legacy scope: the mirror must keep resolving
  // the canonical platform family, or every native binary has to be published
  // twice for as long as the mirror exists.
  manifest.name = mirrorName;
  manifest.publishConfig = { ...(manifest.publishConfig || {}), access: 'public' };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  logger.log(`Packing mirror ${mirrorName}...`);
  // AIDEV-NOTE: --ignore-scripts is required. `npm pack` runs the `prepare`
  // lifecycle script, and this directory is unpacked tarball contents, not a
  // workspace: a package whose `files` omits its own build scripts (fonts does)
  // has a `prepare` that cannot run here. The contents were already built and
  // audited before this point, so re-running a build would be wrong even if it
  // could succeed.
  const packOutput = effects.runCapture(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', destination],
    packageRoot,
  );
  const tarballLine = findTarball(packOutput);
  const packed = path.isAbsolute(tarballLine) ? tarballLine : path.join(destination, tarballLine);

  // npm derives the tarball filename from the package name, and two names can
  // flatten to the same basename (`@a/b-c` and `@a-b/c` both give `a-b-c`).
  // Rename the mirror so it can never land on the canonical tarball, and refuse
  // to continue if npm already overwrote it before we got here.
  const mirrorPath = path.join(destination, `mirror-${path.basename(packed)}`);

  if (packed === canonicalTarballPath) {
    throw new Error(
      `Mirror pack overwrote the canonical tarball at ${packed}. ` +
        'The two package names produce the same tarball filename; pack them into separate directories.',
    );
  }

  renameSync(packed, mirrorPath);

  return { manifest, tarballPath: mirrorPath };
};

/**
 * Validate every already-published version in the set before publishing any of
 * it.
 *
 * A published npm version is immutable, so the two names in a mirror pair can
 * only be brought back into agreement by burning a version. The per-tarball
 * guard inside `publishTarball` runs too late to prevent that: it validates the
 * mirror only after the canonical publish has already landed. Checking the
 * whole set up front keeps a resume attempt against a divergent artifact a
 * no-op instead of a half-applied release.
 */
const assertResumableArtifacts = ({ entries, isPublished, getChecksums }) => {
  for (const { tarballPath, manifest } of entries) {
    if (isPublished(manifest.name, manifest.version)) {
      assertPublishedArtifactMatches({ tarballPath, manifest, getChecksums });
    }
  }
};

/**
 * Publish one tarball by path, or verify and retag it if the version is already
 * on the registry.
 *
 * Republishing a version npm already has is a hard error, so a release that
 * failed partway must be resumable. The resume path compares artifacts first:
 * an existing version is only accepted when it was built from this exact
 * tarball.
 *
 * AIDEV-NOTE: `npm publish` can authenticate with OIDC, but `npm dist-tag`
 * cannot. Trusted publishing covers `npm publish` and `npm stage publish` only,
 * so the retag branch here needs a conventional token even in an OIDC release.
 * https://docs.npmjs.com/trusted-publishers
 */
const publishTarball = ({
  tarballPath,
  manifest,
  tag,
  isPublished,
  getChecksums,
  effects = defaultEffects,
  logger = console,
}) => {
  if (isPublished(manifest.name, manifest.version)) {
    assertPublishedArtifactMatches({ tarballPath, manifest, getChecksums });

    logger.log(
      `${manifest.name}@${manifest.version} already published from this artifact, ensuring dist-tag "${tag}".`,
    );
    effects.run(
      'npm',
      ['dist-tag', 'add', `${manifest.name}@${manifest.version}`, tag, '--registry', defaultRegistry()],
      rootDir,
    );
    return { published: false };
  }

  logger.log(`Publishing ${manifest.name}@${manifest.version} with dist-tag "${tag}"...`);
  effects.run(
    'npm',
    ['publish', tarballPath, '--access', 'public', '--tag', tag, '--registry', defaultRegistry()],
    rootDir,
  );
  return { published: true };
};

/**
 * Mark exactly one published version as deprecated.
 *
 * `npm deprecate` is retroactive, not standing: it reads the packument, filters
 * the versions that exist NOW through the supplied range, and writes `deprecated`
 * onto those records. It stores no rule for future publishes. So every mirror
 * release has to deprecate its own new version right after publishing it, or the
 * mirror quietly ships a clean, non-deprecated version.
 *
 * AIDEV-NOTE: `npm deprecate` is not an OIDC-authenticated command. Trusted
 * publishing covers `npm publish` and `npm stage publish` only, so this step
 * needs a conventional token even in an otherwise tokenless release.
 * https://docs.npmjs.com/trusted-publishers
 */
const deprecateVersion = ({
  packageName,
  version,
  message,
  effects = defaultEffects,
  logger = console,
}) => {
  logger.log(`Deprecating ${packageName}@${version}...`);
  effects.run(
    'npm',
    ['deprecate', `${packageName}@${version}`, message, '--registry', defaultRegistry()],
    rootDir,
  );
};

/**
 * Publish a built package under its canonical name, then under a legacy mirror
 * name derived from the same contents, then deprecate the mirror version.
 *
 * Canonical publishes first because the mirror carries new-scope dependencies
 * and would otherwise reference packages that do not exist yet.
 *
 * `onTarballs` runs only once the release is known to be able to proceed, and
 * receives both tarball paths before anything is published, so a
 * caller can run an artifact audit against the exact bytes that will upload.
 *
 * `expectedVersion` binds the publish to a version the caller already committed
 * to, such as one read off a release tag. See `assertPackedVersion`.
 */
const publishWithMirror = ({
  packageDir,
  workspaceRoot,
  mirrorName,
  deprecationMessage,
  tag = 'latest',
  expectedVersion,
  platformPackages = [],
  dryRun = false,
  onTarballs,
  effects = defaultEffects,
  logger = console,
}) => {
  if (!mirrorName) throw new Error('mirrorName is required');
  if (!deprecationMessage) {
    throw new Error('deprecationMessage is required: a mirror must tell consumers where to go');
  }

  const isPublished = makeRegistryLookup(effects);
  const getChecksums = makeChecksumLookup(effects);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'superdoc-mirror-'));

  try {
    const { tarballPath: canonicalTarball, packageRoot } = packAndExtract({
      packageDir,
      destination: tempDir,
      workspaceRoot,
      effects,
      logger,
    });
    const canonical = readManifest(packageRoot);

    if (canonical.name === mirrorName) {
      throw new Error(`Mirror name ${mirrorName} matches the canonical package name`);
    }

    assertPackedVersion({ manifest: canonical, expectedVersion });

    assertPlatformVersionsAligned({ manifest: canonical, platformPackages });
    assertPlatformPackagesPublished({
      manifest: canonical,
      platformPackages,
      isPublished,
      logger,
    });

    const { manifest: mirrored, tarballPath: mirrorTarball } = buildMirrorTarball({
      packageRoot,
      mirrorName,
      destination: tempDir,
      canonicalTarballPath: canonicalTarball,
      effects,
      logger,
    });
    assertPlatformVersionsAligned({ manifest: mirrored, platformPackages });

    // Before `onTarballs`, not after: a divergent resume is guaranteed to abort,
    // and a callback that ran anyway would report on a release that never
    // happened. The current caller only reads the tarballs, but the hook is a
    // public extension point and a future one could publish a report.
    assertResumableArtifacts({
      entries: [
        { tarballPath: canonicalTarball, manifest: canonical },
        { tarballPath: mirrorTarball, manifest: mirrored },
      ],
      isPublished,
      getChecksums,
    });

    if (onTarballs) {
      onTarballs({ canonicalTarball, mirrorTarball, version: canonical.version });
    }

    if (dryRun) {
      for (const tarball of [canonicalTarball, mirrorTarball]) {
        effects.run('npm', ['publish', tarball, '--dry-run', '--access', 'public', '--tag', tag, '--registry', defaultRegistry()], rootDir);
      }
      return {
        version: canonical.version,
        canonical: { name: canonical.name, published: false },
        mirror: { name: mirrorName, published: false },
      };
    }

    const canonicalResult = publishTarball({
      tarballPath: canonicalTarball,
      manifest: canonical,
      tag,
      isPublished,
      getChecksums,
      effects,
      logger,
    });
    const mirrorResult = publishTarball({
      tarballPath: mirrorTarball,
      manifest: mirrored,
      tag,
      isPublished,
      getChecksums,
      effects,
      logger,
    });

    deprecateVersion({
      packageName: mirrorName,
      version: mirrored.version,
      message: deprecationMessage,
      effects,
      logger,
    });

    return {
      version: canonical.version,
      canonical: { name: canonical.name, published: canonicalResult.published },
      mirror: { name: mirrorName, published: mirrorResult.published },
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

module.exports = {
  assertPackedVersion,
  assertPlatformPackagesPublished,
  resolveWorkspacePath,
  assertPlatformVersionsAligned,
  assertPublishedArtifactMatches,
  buildMirrorTarball,
  defaultEffects,
  deprecateVersion,
  makeChecksumLookup,
  makeRegistryLookup,
  packAndExtract,
  publishTarball,
  assertResumableArtifacts,
  publishWithMirror,
  tarballIntegrity,
  tarballShasum,
};
