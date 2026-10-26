// Locates the `@superdoc/font-system` source that this package's build and drift
// checks read, and decides whether its absence is a failure or a legitimate skip.
//
// Why this exists
// ---------------
// Four scripts here reach into `shared/font-system` through the same hardcoded
// relative path, and each one treated a missing path as "not in the monorepo,
// skip". That is right for a standalone install and wrong for this repository:
// if the directory moves or is renamed, every one of them prints a reassuring
// skip line and exits 0. The Verdana-class drift the check exists to catch would
// then ship unnoticed, and `check:families` would be green while checking
// nothing.
//
// The two cases are distinguishable. `shared/` is a workspace of this
// repository, so a checkout whose root manifest is ours is one where font-system
// must be resolvable. A published install is not: `scripts/` is not in this
// package's `files` array, so these scripts only run outside the monorepo when
// someone installs from a git URL and npm runs `prepare`. There, the assets and
// the committed family list already ship in the tree and recomputing them is
// neither possible nor needed.
//
// Keyed on the root manifest's name rather than on `pnpm-workspace.yaml`, which
// every pnpm monorepo has: a consumer who vendored this source into their own
// `packages/fonts/` would otherwise look like us and get a hard failure for a
// check that cannot apply to them.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** This repository's root manifest name, used to recognise our own checkout. */
const ROOT_PACKAGE_NAME = 'superdoc-monorepo';

/** Public repository root, relative to `packages/fonts/scripts/`. */
const REPO_ROOT = resolve(here, '../../..');

/** Canonical font-system location. Update this when the package moves. */
const FONT_SYSTEM_DIR = resolve(REPO_ROOT, 'shared/font-system');

export const FONT_SYSTEM_ASSETS = resolve(FONT_SYSTEM_DIR, 'assets');
export const FONT_SYSTEM_OFFERINGS = resolve(FONT_SYSTEM_DIR, 'src/font-offerings.ts');

/**
 * True when running inside the SuperDoc public repository, where font-system is
 * a workspace and must therefore be present.
 *
 * Keyed on this repository's own root manifest name rather than on
 * `pnpm-workspace.yaml` alone. Any pnpm monorepo has that file, so a consumer
 * who vendored this package's source into their own `packages/fonts/` would
 * otherwise look like our repository and get a hard failure for a check that
 * cannot apply to them.
 */
export function inMonorepo() {
  const rootManifest = resolve(REPO_ROOT, 'package.json');
  if (!existsSync(rootManifest)) return false;
  try {
    return JSON.parse(readFileSync(rootManifest, 'utf8')).name === ROOT_PACKAGE_NAME;
  } catch {
    // An unreadable or malformed root manifest is not evidence of our repository.
    return false;
  }
}

/**
 * Resolves a font-system path, or explains why it is missing.
 *
 * Returns `{ ok: true }` when the path is there. Returns `{ ok: false, skip }`
 * otherwise: `skip` is true only outside the monorepo, where absence is
 * expected. Inside the monorepo a missing path is a real failure, and the
 * message names what to fix rather than reporting a generic ENOENT.
 */
export function resolveFontSystemPath(target, what) {
  if (existsSync(target)) return { ok: true };

  if (!inMonorepo()) {
    return {
      ok: false,
      skip: true,
      message: `[@superdoc/fonts] font-system ${what} not present (standalone install)`,
    };
  }

  return {
    ok: false,
    skip: false,
    message: [
      `[@superdoc/fonts] font-system ${what} is missing inside the monorepo: ${target}`,
      `  The root manifest at ${REPO_ROOT} names "${ROOT_PACKAGE_NAME}", so font-system is a`,
      '  workspace here and must resolve. Skipping would leave this check green while it',
      '  compares nothing.',
      '  If the package moved, update FONT_SYSTEM_DIR in packages/fonts/scripts/font-system-source.mjs.',
    ].join('\n'),
  };
}
