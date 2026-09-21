#!/usr/bin/env node
//
// Which npm names a given fonts version ships under.
//
// Fonts ships from one build under two npm names: the canonical
// `@superdoc/fonts` and a deprecated `@superdoc-dev/fonts` compatibility
// mirror. Versions from before the scope move only ever existed under the
// legacy name, so every step that repairs or verifies a fonts release has to
// know which side of that boundary a version falls on.
//
// The stable planner, publisher and resume-fonts-release.cjs share this boundary.
//
export const FONTS_NPM_PACKAGES = ['@superdoc/fonts', '@superdoc-dev/fonts'];
export const FONTS_LEGACY_NPM_PACKAGES = ['@superdoc-dev/fonts'];

// The last fonts release before the scope move. Versions at or below it only
// ever shipped under the legacy name.
//
// AIDEV-NOTE: Without this, recovery would judge every pre-migration tag
// incomplete because the canonical package has no such version, then check out
// that old snapshot and run its publisher - which predates the canonical name
// and cannot create it. The recheck fails identically, so the orchestrator
// stops before it can cut any new release. Startup deadlock, not a slow path.
export const FONTS_LAST_LEGACY_ONLY_VERSION = '0.2.0';

/** Numeric-aware semver compare, ignoring prerelease suffixes. */
export function compareSemver(a, b) {
  const parse = (v) =>
    String(v)
      .split('-')[0]
      .split('.')
      .map((n) => Number(n) || 0);
  const [aParts, bParts] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if (aParts[i] !== bParts[i]) return aParts[i] < bParts[i] ? -1 : 1;
  }
  return 0;
}

export const fontsExpectedNpmPackages = (version) =>
  compareSemver(version, FONTS_LAST_LEGACY_ONLY_VERSION) <= 0
    ? FONTS_LEGACY_NPM_PACKAGES
    : FONTS_NPM_PACKAGES;

/**
 * Whether this version publishes the canonical package at all.
 *
 * The repair and verification steps of a fonts release are only meaningful for
 * versions that have a canonical half. Running them on a pre-migration tag asks
 * for `@superdoc/fonts@<legacy version>`, which is intentionally absent and will
 * never appear, so the wait times out and a healthy run fails.
 */
export const fontsPublishesCanonical = (version) => fontsExpectedNpmPackages(version).length > 1;

// CLI: print `true` or `false` for one version, so a workflow can gate on the
// same rule without restating the boundary in YAML.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: fonts-release-scope.mjs <version>');
    process.exit(2);
  }
  console.log(fontsPublishesCanonical(version) ? 'true' : 'false');
}
