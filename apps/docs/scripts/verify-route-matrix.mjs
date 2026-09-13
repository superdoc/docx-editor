/**
 * Follows every V1 route through the deployed redirects and checks where it lands.
 *
 * A status code alone is a weak gate. A rule that sends an archive URL to the V2
 * home page, or points every reference page at the same surviving article, still
 * answers 200 everywhere while quietly losing the reader. So this asserts the
 * four properties the registry actually promises:
 *
 *   1. the request ends in a 200
 *   2. an `archive` route ends on the archive host, a `v2` route on this site
 *   3. a `v2` route ends on its registered destination
 *   4. no two routes collapse onto one page
 *
 * Usage: node scripts/verify-route-matrix.mjs [origin]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveHost } from './v1-routes.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const dispositionsPath = `${here}../config/v1-dispositions.json`;
// Normalized so a trailing slash in the argument cannot turn every request into
// a doubled path or make every host comparison fail.
const origin = new URL(process.argv[2] ?? 'https://superdoc-docs-next.pages.dev').origin;

// Cloudflare rate-limits bursts from one client, and a throttled request is
// indistinguishable from a broken route. Keep the fan-out modest so a failure
// here means the routing is wrong rather than the probe too eager.
const concurrency = 12;
const requestTimeoutMs = 25_000;

/** Drops a trailing slash, except from the root path where it is the whole path. */
function stripTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/$/u, '') : value;
}

/** Compares URL paths without letting a trailing slash count as a difference. */
function samePath(left, right) {
  return stripTrailingSlash(left) === stripTrailingSlash(right);
}

async function probe({ source, kind, destination }) {
  const requested = `${origin}${source}`;
  let response;
  try {
    response = await fetch(requested, {
      redirect: 'follow',
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    return { source, kind, failure: `request failed: ${error.message}` };
  }

  const final = new URL(response.url);
  const landed = `${final.origin}${final.pathname}`;

  // A retired route is meant to 404 here rather than resolve anywhere. Checking
  // it like the others would demand a 200 that must never exist, so the gate is
  // that it stayed on this site and was refused: a retired path that redirected
  // somewhere, or that started answering again, is the failure.
  if (kind === 'retired') {
    if (response.status !== 404) return { source, kind, landed, failure: `expected 404, got ${response.status}` };
    if (final.origin !== origin) return { source, kind, landed, failure: `a retired route left ${origin}` };
    return { source, kind, landed };
  }

  if (response.status !== 200) {
    return { source, kind, landed, failure: `final status ${response.status}` };
  }

  const expectedOrigin = kind === 'archive' ? archiveHost : origin;
  if (final.origin !== expectedOrigin) {
    return { source, kind, landed, failure: `a ${kind} route left ${expectedOrigin}` };
  }

  // Archive destinations are V1's own paths, which this repository does not own,
  // so the host is all that can be asserted for them.
  if (kind === 'v2' && destination && !samePath(final.pathname, destination)) {
    return { source, kind, landed, failure: `expected ${destination}` };
  }

  return { source, kind, landed };
}

async function probeAll(dispositions) {
  const results = [];
  for (let index = 0; index < dispositions.length; index += concurrency) {
    const batch = dispositions.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(probe))));
  }
  return results;
}

/**
 * V1 routes that were deliberately merged onto one V2 page.
 *
 * Keyed by the V2 path they share, so the entry says which page absorbed them
 * rather than just naming the sources. Anything not listed here is a defect.
 *
 * Keys are normalised the way `samePath` compares, because the slash on a
 * landing path comes from the export's `trailingSlash` setting rather than from
 * the route. A config change would otherwise turn this exception back into a
 * failure with nothing about the routes having changed.
 */
export const INTENDED_MERGES = new Map([
  // The V1 security guide moved into the resources section, and its old path
  // was kept pointing at the new page rather than retired.
  ['/resources/security', ['/guides/general/security', '/resources/security']],
  // The React setup guide was folded into the shared custom UI setup page.
  ['/editor/custom-ui/controller-setup', ['/editor/custom-ui/controller-setup', '/editor/custom-ui/react-setup']],
]);

/**
 * Reports V2 routes that share a landing page and were not meant to.
 *
 * The registry maps almost every V2 route to its own page, so a duplicate is
 * usually a defect: the likely cause is an overly greedy wildcard swallowing a
 * section, which no per-route check would catch. A merge that is intentional
 * belongs in INTENDED_MERGES, which keeps the invariant while recording the
 * exception -- and still fails if the same page later absorbs a third route.
 *
 * Archive routes are excluded. Their landing pages are decided by V1's own
 * redirects, which legitimately merge section indexes onto a first article, and
 * this repository cannot change that.
 */
export function collapsedRoutes(results) {
  const byLanding = new Map();
  for (const { landed, source, kind } of results) {
    if (!landed || kind !== 'v2') continue;
    byLanding.set(landed, [...(byLanding.get(landed) ?? []), source]);
  }
  return [...byLanding.entries()].filter(([landing, sources]) => {
    if (sources.length <= 1) return false;
    // The landing URL carries the deployment origin; the registry does not.
    const intended = INTENDED_MERGES.get(stripTrailingSlash(new URL(landing).pathname));
    if (!intended) return true;
    return [...sources].sort().join() !== [...intended].sort().join();
  });
}

async function run() {
  const { dispositions } = JSON.parse(await readFile(dispositionsPath, 'utf8'));
  process.stdout.write(`Probing ${dispositions.length} V1 routes against ${origin}\n`);

  const results = await probeAll(dispositions);
  const failures = results.filter((result) => result.failure);
  const collapsed = collapsedRoutes(results);

  for (const { source, kind, landed, failure } of failures) {
    process.stdout.write(`  ${kind} ${source} -> ${landed ?? 'no response'}: ${failure}\n`);
  }
  for (const [landing, sources] of collapsed) {
    process.stdout.write(`  ${sources.length} routes collapse onto ${landing}: ${sources.join(', ')}\n`);
  }

  const archived = results.filter((result) => result.kind === 'archive').length;
  const retired = results.filter((result) => result.kind === 'retired').length;
  process.stdout.write(
    `\n${results.length - failures.length}/${results.length} routes land where the registry says ` +
      `(${archived} on the archive, ${retired} retired, ${results.length - archived - retired} here)\n`,
  );

  if (failures.length > 0 || collapsed.length > 0) process.exit(1);
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedScript === fileURLToPath(import.meta.url)) await run();
