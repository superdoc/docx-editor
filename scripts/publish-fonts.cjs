#!/usr/bin/env node
//
// Fonts publisher. Ships one build under two npm names: the canonical
// `@superdoc/fonts` and a deprecated `@superdoc-dev/fonts` compatibility mirror
// for consumers who installed before the scope change.
//
// Keep the mirror for consumers that have not migrated their imports yet.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { auditTarball } = require('./audit-publish-artifact.mjs');
const { publishWithMirror } = require('./npm-mirror-publish.cjs');

const rootDir = path.resolve(__dirname, '..');

const CANONICAL_PACKAGE_NAME = '@superdoc/fonts';
const LEGACY_PACKAGE_NAME = '@superdoc-dev/fonts';

// AIDEV-NOTE: Violations the fonts package already ships, verified against the
// published @superdoc-dev/fonts@0.2.0 tarball. They exist because `files`
// includes `src` and vite emits a source map, both of which predate this
// baseline. Removing them changes what consumers receive and is a separate
// decision from any rename, so they are tolerated rather than fixed here.
//
// This is an allowlist, not a bypass. The auditor still runs, so a new source
// map, a private v2 source path, an unexpected raw file, or a leaked absolute
// build path fails the release. It does not scan for credentials; that is not
// what this gate covers. Shrink this list when the package contents are cleaned
// up; never grow it to make a release pass.
const KNOWN_ARTIFACT_VIOLATIONS = Object.freeze([
  'dist/superdoc-fonts.min.js: contains a sourceMappingURL reference',
  'dist/superdoc-fonts.min.js.map: source map files are not allowed in published artifacts',
  'package.json: exports...source uses a "source" export condition',
  'src/asset-urls.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/bundled-families.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/bundled-files.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/cdn-entry.test.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/cdn-entry.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/curation.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/index.test.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
  'src/index.ts: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts',
]);

// AIDEV-NOTE: Reuse the auditor's own marker lists rather than copying them.
// A local copy drifts: the first version of this scan checked two hardcoded
// strings while the auditor already rejected four absolute-path forms including
// Windows and /private/var/folders, so a leaked path in an exempted file could
// pass here and fail nowhere.
const {
  ABSOLUTE_PATH_MARKERS,
  PRIVATE_SOURCE_PATH_MARKERS,
} = require('./audit-publish-artifact.mjs');

/**
 * Read every baseline-exempted file out of the tarball and reject leaked
 * markers in their contents.
 */
const assertNoLeakedMarkers = (tarballPath, label) => {
  const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => /\.(?:ts|map)$/u.test(entry));

  const findings = [];

  for (const entry of entries) {
    const contents = execFileSync('tar', ['-xzOf', tarballPath, entry], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    const relPath = entry.replace(/^package\//u, '');

    for (const marker of PRIVATE_SOURCE_PATH_MARKERS) {
      if (contents.includes(marker)) {
        findings.push(`${relPath}: contains private source path "${marker}"`);
      }
    }

    for (const marker of ABSOLUTE_PATH_MARKERS) {
      if (marker.test(contents)) {
        findings.push(`${relPath}: contains an absolute build path (${marker})`);
      }
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `${label} has leaked markers inside baseline-exempted files:\n` +
        `${findings.map((f) => `  - ${f}`).join('\n')}\n` +
        'The baseline exempts these files from type checks, not from content checks.',
    );
  }
};

/**
 * Audit a tarball against the fonts baseline, in both directions.
 *
 * An allowlist that only rejects additions decays: once a violation is fixed,
 * its exemption lingers and silently re-permits the same violation years later.
 * Requiring an exact match makes the list shrink-only in practice, because
 * cleaning something up forces the exemption to be deleted in the same change.
 */
const assertOnlyKnownViolations = (tarballPath, label, logger = console) => {
  // AIDEV-NOTE: The baseline exempts whole files (raw `.ts` under src/, the
  // source map). The auditor classifies those by type and stops, so it never
  // reads their contents: a private v2 source path or an absolute build path
  // planted inside one would ship unnoticed. Scan them separately, so the
  // exemption covers only the file's presence, never what is in it.
  assertNoLeakedMarkers(tarballPath, label);

  const { violations } = auditTarball(tarballPath, { label });

  const unexpected = violations.filter((v) => !KNOWN_ARTIFACT_VIOLATIONS.includes(v));
  const resolved = KNOWN_ARTIFACT_VIOLATIONS.filter((v) => !violations.includes(v));

  if (unexpected.length > 0) {
    throw new Error(
      `${label} failed the publish-artifact audit with violations that are not in the fonts baseline:\n` +
        `${unexpected.map((v) => `  - ${v}`).join('\n')}\n` +
        'Fix the artifact. Do not add these to KNOWN_ARTIFACT_VIOLATIONS to make the release pass.',
    );
  }

  if (resolved.length > 0) {
    throw new Error(
      `${label} no longer has these baseline violations, so their exemptions are stale:\n` +
        `${resolved.map((v) => `  - ${v}`).join('\n')}\n` +
        'Remove them from KNOWN_ARTIFACT_VIOLATIONS. A stale exemption would silently re-permit the violation later.',
    );
  }

  logger.log(`${label}: audited, baseline matched exactly (${violations.length} known violations).`);
};

// The message npm writes onto every mirrored version, permanently. It has to
// stay true for as long as the mirror exists, so it names the canonical package
// rather than linking a page that could rot, and it does not tell anyone to run
// a bare `npm install @superdoc/fonts`: that resolves `latest`, which does not
// exist during the prerelease pilot. Once the canonical package has a stable
// release, this can become a plain install instruction.
const DEPRECATION_MESSAGE =
  'This package is now published as @superdoc/fonts and is kept only as a compatibility mirror. Check https://www.npmjs.com/package/@superdoc/fonts for the release channel to install.';

const run = (command, args, cwd = rootDir) => {
  execFileSync(command, args, { stdio: 'inherit', cwd });
};

const buildFontsPackage = (logger = console) => {
  logger.log(`Building ${CANONICAL_PACKAGE_NAME}...`);
  // AIDEV-NOTE: --fail-if-no-match is load-bearing. A pnpm filter that matches
  // nothing exits 0 and builds nothing, so a workspace rename would turn this
  // into a silent no-op and the publish would go on to audit and upload
  // whatever stale or missing dist happened to be in the checkout. Matches the
  // stable pipeline must fail before it can audit or upload a stale artifact.
  run('pnpm', ['--filter', CANONICAL_PACKAGE_NAME, '--fail-if-no-match', 'build']);
};

const publishFontsPackage = ({
  distTag = 'latest',
  version,
  build = true,
  dryRun = false,
  onTarballs,
  logger = console,
} = {}) => {
  if (build) {
    buildFontsPackage(logger);
  }

  return publishWithMirror({
    packageDir: 'packages/fonts',
    mirrorName: LEGACY_PACKAGE_NAME,
    deprecationMessage: DEPRECATION_MESSAGE,
    tag: distTag,
    // Callers that already know which version they are publishing (a resume
    // driven by a release tag, or semantic-release itself) pass it here so the
    // packed tarball is checked against it before anything uploads.
    expectedVersion: version,
    dryRun,
    logger,
    // Audit the exact tarballs that will upload. Publishing a directory would
    // let npm rebuild them afterwards, so anything verified here could differ
    // from what consumers receive.
    onTarballs: ({ canonicalTarball, mirrorTarball }) => {
      assertOnlyKnownViolations(canonicalTarball, CANONICAL_PACKAGE_NAME, logger);
      assertOnlyKnownViolations(mirrorTarball, LEGACY_PACKAGE_NAME, logger);
      onTarballs?.({ canonicalTarball, mirrorTarball, version });
    },
  });
};

const parseArgs = (argv) => {
  let distTag;
  let version;
  let skipBuild = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist-tag') {
      distTag = argv[index + 1];
      index += 1;
    } else if (arg === '--version') {
      version = argv[index + 1];
      index += 1;
    } else if (arg === '--skip-build') {
      skipBuild = true;
    }
  }

  return {
    distTag: distTag || process.env.RELEASE_DIST_TAG || 'latest',
    version,
    build: !skipBuild && process.env.SKIP_BUILD !== 'true',
  };
};

if (require.main === module) {
  try {
    publishFontsPackage(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  CANONICAL_PACKAGE_NAME,
  DEPRECATION_MESSAGE,
  assertNoLeakedMarkers,
  KNOWN_ARTIFACT_VIOLATIONS,
  LEGACY_PACKAGE_NAME,
  assertOnlyKnownViolations,
  publish: async (_pluginConfig, context) => {
    const { nextRelease, logger = console } = context;
    const distTag = (nextRelease && nextRelease.channel) || 'latest';

    // semantic-release-pnpm writes this version into the manifest during
    // prepare. Passing it makes the publisher prove that happened, rather than
    // uploading whatever version the working tree holds under this run's tag.
    publishFontsPackage({
      distTag,
      version: nextRelease && nextRelease.version,
      build: true,
      logger,
    });
  },
  publishFontsPackage,
};
