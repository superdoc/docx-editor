import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendDispositionRedirects,
  archiveHost,
  collectShippedLinks,
  parseDispositions,
  readV1Manifest,
  renderDispositionRedirects,
  resolveTerminalPaths,
  toCloudflarePattern,
  validateDispositions,
  validateManifest,
  validateManifestConsistency,
} from '../scripts/v1-routes.mjs';
import { INTENDED_MERGES, collapsedRoutes } from '../scripts/verify-route-matrix.mjs';

const readConfig = async (name) => JSON.parse(await readFile(new URL(`../config/${name}`, import.meta.url), 'utf8'));

/**
 * A manifest file for the redirect-writing tests.
 *
 * Those tests exercise how rules reach the deployed file, not what V1 contained,
 * so they supply the smallest manifest that reads as valid rather than a copy of
 * the real one.
 */
async function writeManifestFixture(directory, { redirects = [], redirectPatterns = [] } = {}) {
  const manifestPath = join(directory, 'v1-manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      capture: {
        capturedFrom: 'https://docs.superdoc.dev',
        capturedAt: '2026-07-30',
        sourceRepository: 'https://github.com/superdoc/orbit',
        sourceCommit: '0000000000000000000000000000000000000000',
        sourcePath: 'superdoc/public/apps/docs',
        archiveOrigin: archiveHost,
      },
      live: ['/legacy/guide'],
      dead: [],
      candidates: ['/legacy/guide'],
      redirects,
      redirectPatterns,
    }),
  );
  return manifestPath;
}

test('every URL the V1 archive answers has exactly one disposition', async () => {
  const [manifest, dispositionConfig, routeManifest] = await Promise.all([
    readV1Manifest(),
    readConfig('v1-dispositions.json'),
    readConfig('routes.json'),
  ]);

  const problems = validateDispositions({
    manifest,
    dispositions: parseDispositions(dispositionConfig),
    v2Routes: new Set(routeManifest.routes.map((route) => route.replace(/\/$/u, ''))),
    shippedLinks: await collectShippedLinks(['packages', 'apps/cli', 'apps/mcp', 'apps/vscode-ext']),
  });

  assert.deepEqual(problems, []);
});

test('reports a released-package link that no rule would answer', async () => {
  const [manifest, dispositionConfig, routeManifest] = await Promise.all([
    readV1Manifest(),
    readConfig('v1-dispositions.json'),
    readConfig('routes.json'),
  ]);

  const problems = validateDispositions({
    manifest: { ...manifest, live: [] },
    dispositions: parseDispositions(dispositionConfig),
    v2Routes: new Set(routeManifest.routes.map((route) => route.replace(/\/$/u, ''))),
    // A link printed by a released package outlives the release that printed
    // it, so it cannot be fixed after the fact.
    shippedLinks: ['/a-guide-that-never-existed'],
  });

  assert.deepEqual(problems, [
    'Released packages link to a route with no V2 page or V1 disposition: /a-guide-that-never-existed',
  ]);
});

test('accepts a released-package link that resolves directly to a V2 page', () => {
  const problems = validateDispositions({
    manifest: { live: [], dead: [], redirectPatterns: [] },
    dispositions: new Map(),
    v2Routes: new Set(['/editor/quickstart']),
    shippedLinks: ['/editor/quickstart'],
  });

  assert.deepEqual(problems, []);
});

test('translates Mintlify patterns into Cloudflare splats', () => {
  assert.deepEqual(toCloudflarePattern({ source: '/modules/:path*', destination: '/editor/built-in-ui/:path*' }), {
    source: '/modules/*',
    destination: '/editor/built-in-ui/:splat',
  });
});

test('orders redirect rules so the most specific pattern wins', async () => {
  const manifest = await readV1Manifest();
  const dispositions = parseDispositions(await readConfig('v1-dispositions.json'));
  const rules = renderDispositionRedirects(
    dispositions,
    manifest.redirectPatterns,
    resolveTerminalPaths(manifest.redirects),
  )
    .split('\n')
    .map((line) => {
      const [source, destination, status] = line.split(' ');
      return { source, destination, status };
    });

  // Cloudflare takes the first matching rule, so a broad pattern placed above a
  // narrow one silently swallows it.
  const firstMatch = (path) =>
    rules.find((rule) =>
      rule.source.endsWith('/*') ? path.startsWith(rule.source.slice(0, -1)) : rule.source === path,
    );
  const resolve = (path) => {
    const rule = firstMatch(path);
    if (!rule) return undefined;
    return rule.destination.replace(':splat', path.slice(rule.source.length - 1));
  };

  // Both of these are published inside released packages and resolve only
  // through a wildcard.
  assert.equal(resolve('/core/superdoc/configuration'), 'https://docs-v1.superdoc.dev/editor/superdoc/configuration');
  assert.equal(
    resolve('/modules/collaboration/overview'),
    'https://docs-v1.superdoc.dev/editor/collaboration/overview',
  );
  // The broad /modules/* rule still catches everything else.
  assert.equal(resolve('/modules/toolbar'), 'https://docs-v1.superdoc.dev/editor/built-in-ui/toolbar');

  const patternIndex = (source) => rules.findIndex((rule) => rule.source === source);
  assert.ok(
    patternIndex('/modules/collaboration/*') < patternIndex('/modules/*'),
    'the narrower pattern must come first',
  );
});

test('emits both slash variants and stays inside the Cloudflare rule limit', async () => {
  const manifest = await readV1Manifest();
  const dispositions = parseDispositions(await readConfig('v1-dispositions.json'));
  const rules = renderDispositionRedirects(
    dispositions,
    manifest.redirectPatterns,
    resolveTerminalPaths(manifest.redirects),
  ).split('\n');

  // Cloudflare matches sources exactly, so a visitor arriving at the other form
  // would miss the redirect entirely.
  assert.ok(rules.some((rule) => rule.startsWith('/getting-started/quickstart ')));
  assert.ok(rules.some((rule) => rule.startsWith('/getting-started/quickstart/ ')));
  assert.ok(rules.length <= 2000, `redirect output must fit the Cloudflare limit, got ${rules.length}`);
});

test('refuses a disposition for a URL the site never answered', async () => {
  const manifest = await readV1Manifest();
  const problems = validateDispositions({
    manifest: { ...manifest, live: [], dead: ['/document-api/reference/export'] },
    dispositions: parseDispositions({
      dispositions: [{ source: '/document-api/reference/export', kind: 'archive' }],
    }),
    v2Routes: new Set(),
  });

  assert.deepEqual(problems, ['Disposition for a V1 route the site does not answer: /document-api/reference/export']);
});

test('resolves V1 redirect chains to their terminal destination', () => {
  const terminal = resolveTerminalPaths([
    { source: '/a', destination: '/b' },
    { source: '/b', destination: '/c' },
    { source: '/loop', destination: '/loop' },
    { source: '/anchored', destination: '/target#section' },
  ]);

  // An archive rule pointing at a path V1 redirects again costs a second hop.
  assert.equal(terminal.get('/a'), '/c');
  assert.equal(terminal.get('/b'), '/c');
  assert.equal(terminal.get('/loop'), '/loop');
  // The fragment is part of where V1 sends the request, and these sources
  // carry none of their own for the browser to preserve.
  assert.equal(terminal.get('/anchored'), '/target#section');
});

test('writes the V1 rules into the redirect file the deployment serves', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'superdoc-v1-redirects-'));
  t.after(() => rm(outputDirectory, { force: true, recursive: true }));
  const dispositionsPath = join(outputDirectory, 'dispositions.json');
  const manifestPath = await writeManifestFixture(outputDirectory);

  await writeFile(join(outputDirectory, '_redirects'), '/docs/old/ /docs/new/ 301\n');
  await writeFile(dispositionsPath, JSON.stringify({ dispositions: [{ source: '/legacy/guide', kind: 'archive' }] }));

  const result = await appendDispositionRedirects({ dispositionsPath, outputDirectory, manifestPath });
  const written = await readFile(join(outputDirectory, '_redirects'), 'utf8');

  // Validating the registry proves nothing if the rules never reach the file
  // Cloudflare reads.
  assert.match(written, /^\/docs\/old\/ \/docs\/new\/ 301$/mu);
  assert.match(written, /^\/legacy\/guide https:\/\/docs-v1\.superdoc\.dev\/legacy\/guide 302$/mu);
  assert.equal(result.v1RuleCount, 2);
  assert.equal(result.totalRuleCount, 3);
});

test('refuses to overwrite a rule the V2 tooling already generated', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'superdoc-v1-redirects-'));
  t.after(() => rm(outputDirectory, { force: true, recursive: true }));
  const dispositionsPath = join(outputDirectory, 'dispositions.json');
  const manifestPath = await writeManifestFixture(outputDirectory);

  // Both sets share one file and one namespace, so a duplicated source means
  // one of the two silently wins depending on order.
  await writeFile(join(outputDirectory, '_redirects'), '/legacy/guide /docs/guide/ 301\n');
  await writeFile(dispositionsPath, JSON.stringify({ dispositions: [{ source: '/legacy/guide', kind: 'archive' }] }));

  await assert.rejects(
    appendDispositionRedirects({ dispositionsPath, outputDirectory, manifestPath }),
    /collide with rules the V2 tooling already generated[\s\S]*\/legacy\/guide/u,
  );
});

test('drops a V1 rule the V2 tooling already generated identically', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'superdoc-v1-redirects-'));
  t.after(() => rm(outputDirectory, { force: true, recursive: true }));
  const dispositionsPath = join(outputDirectory, 'dispositions.json');
  const manifestPath = await writeManifestFixture(outputDirectory);

  // A V1 route whose replacement page later moved is redirected by both tools
  // to the same destination. The same rule twice is not a conflict.
  await writeFile(join(outputDirectory, '_redirects'), '/docs/old /docs/new/ 301\n/docs/old/ /docs/new/ 301\n');
  await writeFile(
    dispositionsPath,
    JSON.stringify({ dispositions: [{ source: '/docs/old', kind: 'v2', destination: '/docs/new/' }] }),
  );

  const result = await appendDispositionRedirects({ dispositionsPath, outputDirectory, manifestPath });
  const written = await readFile(join(outputDirectory, '_redirects'), 'utf8');

  assert.equal(result.v1RuleCount, 0);
  assert.equal(result.totalRuleCount, 2);
  assert.equal(written.match(/^\/docs\/old\/ /gmu).length, 1);
});

test('propagates a failed package scan instead of reporting no links', async () => {
  // git grep exits 1 for both "no matches" and "no such path", so a renamed
  // directory would otherwise read as a clean result.
  await assert.rejects(collectShippedLinks(['no-such-directory']), /these paths do not exist/u);
  assert.ok((await collectShippedLinks(['packages'])).length > 0);
});

test('keeps a more specific V1 redirect that its wildcard would get wrong', async () => {
  const manifest = await readV1Manifest();
  const dispositions = parseDispositions(await readConfig('v1-dispositions.json'));
  const rules = renderDispositionRedirects(
    dispositions,
    manifest.redirectPatterns,
    resolveTerminalPaths(manifest.redirects),
  ).split('\n');

  // V1 sends /modules/collaboration/backend to .../configuration, which is why
  // the exact redirect exists alongside the pattern. Dropping it because a
  // wildcard covers the path would land visitors on a different page.
  assert.ok(
    rules.includes(
      '/modules/collaboration/backend https://docs-v1.superdoc.dev/editor/collaboration/configuration 302',
    ),
    'the specific redirect survives its wildcard',
  );

  // A path the wildcard resolves identically needs no rule of its own.
  assert.ok(!rules.some((rule) => rule.startsWith('/modules/toolbar ')));
});

test('a retired route is refused rather than redirected', async () => {
  const dispositions = parseDispositions({
    dispositions: [
      { source: '/a-guide-nothing-replaces', kind: 'retired', reason: 'superseded with no equivalent page' },
    ],
  });

  // Retired means the 404 page, which offers a search for the requested path and
  // a link into the archive. A blanket redirect home would read as a soft 404
  // and lose what the visitor asked for, so no rule is emitted at all.
  assert.deepEqual(renderDispositionRedirects(dispositions).split('\n').filter(Boolean), []);

  // And the reason is mandatory: retiring a URL without saying why leaves nobody
  // able to tell a decision from an oversight.
  assert.throws(
    () => parseDispositions({ dispositions: [{ source: '/x', kind: 'retired' }] }),
    /must explain why \/x was retired/u,
  );
});

test('the frozen manifest records where it came from and where those URLs now resolve', async () => {
  const manifest = await readV1Manifest();

  // Without provenance the file is an unattributable blob: nobody can tell what
  // revision it describes, or which deployment still answers its archive routes.
  assert.equal(manifest.capture.sourcePath, 'superdoc/public/apps/docs');
  assert.equal(manifest.capture.sourceRepository, 'https://github.com/superdoc/orbit');
  assert.equal(manifest.capture.archiveOrigin, archiveHost);
  assert.match(manifest.capture.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.ok(manifest.live.length > 0);

  // The capture is permanent, so the shape is checked on every read rather than
  // trusted to a generator that no longer exists.
  assert.deepEqual(validateManifest({ ...manifest, live: [] }), [
    'live must not be empty; V1 answered routes and an empty capture would silently pass every check.',
  ]);
  assert.deepEqual(validateManifest({ ...manifest, capture: { ...manifest.capture, sourceCommit: '' } }), [
    'capture.sourceCommit must be recorded so the capture stays reproducible.',
  ]);
  assert.deepEqual(
    validateManifest({ ...manifest, capture: { ...manifest.capture, archiveOrigin: 'https://x.dev' } }),
    [`capture.archiveOrigin must match the archive host this app redirects to: ${archiveHost}`],
  );
});

test('the frozen manifest agrees with itself about what was crawled', async () => {
  const manifest = await readV1Manifest();

  // V1 is frozen, so this can no longer drift on its own. What it catches is a
  // hand edit: a route added to the inventory without a crawl result has no
  // evidence either way, and one removed from the inventory leaves a crawled
  // path nothing accounts for.
  assert.deepEqual(validateManifestConsistency(manifest), []);
  assert.deepEqual(
    validateManifestConsistency({ ...manifest, candidates: [...manifest.candidates, '/invented-by-hand'] }),
    ['Inventoried but never crawled, so nothing knows whether V1 answers it: /invented-by-hand'],
  );
  assert.deepEqual(validateManifestConsistency({ ...manifest, live: [...manifest.live, '/never-inventoried'] }), [
    'Crawled but not in the inventory that produced the crawl: /never-inventoried',
  ]);
});

test('generates the same redirect file however often it runs', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'superdoc-v1-redirects-'));
  t.after(() => rm(outputDirectory, { force: true, recursive: true }));
  const dispositionsPath = join(outputDirectory, 'dispositions.json');
  const manifestPath = await writeManifestFixture(outputDirectory);

  await writeFile(join(outputDirectory, '_redirects'), '/docs/old/ /docs/new/ 301\n');
  await writeFile(
    dispositionsPath,
    JSON.stringify({
      dispositions: [
        { source: '/legacy/guide', kind: 'archive' },
        { source: '/legacy/moved', kind: 'v2', destination: '/docs/new/' },
      ],
    }),
  );

  const first = await appendDispositionRedirects({ dispositionsPath, outputDirectory, manifestPath });
  const afterFirst = await readFile(join(outputDirectory, '_redirects'), 'utf8');
  // Rerunning must replace this command's own output rather than read it as a
  // collision with the V2 tooling.
  const second = await appendDispositionRedirects({ dispositionsPath, outputDirectory, manifestPath });
  const afterSecond = await readFile(join(outputDirectory, '_redirects'), 'utf8');

  assert.equal(afterFirst, afterSecond);
  assert.deepEqual(first, second);
  assert.match(afterSecond, /^\/docs\/old\/ \/docs\/new\/ 301$/mu);
});

test('requires V2 destinations to be the route the export actually serves', async () => {
  // next.config.mjs sets trailingSlash, so V2 pages are directory indexes and
  // the canonical route ends in a slash. A slashless destination 301s to a URL
  // that immediately redirects again, costing every inbound V1 link a hop.
  assert.throws(
    () => parseDispositions({ dispositions: [{ source: '/old', kind: 'v2', destination: '/docs/new' }] }),
    /must be a canonical V2 route ending in a slash/u,
  );
  assert.doesNotThrow(() =>
    parseDispositions({ dispositions: [{ source: '/old', kind: 'v2', destination: '/docs/new/' }] }),
  );

  const { dispositions } = await readConfig('v1-dispositions.json');
  const uncanonical = dispositions.filter(
    (entry) => entry.kind === 'v2' && entry.destination !== '/' && !entry.destination.endsWith('/'),
  );
  assert.deepEqual(uncanonical, []);
});

test('serves a same-path replacement directly instead of redirecting to itself', () => {
  const dispositions = parseDispositions({
    dispositions: [
      // The V1 path and its V2 replacement are the same page once the pages own
      // the root namespace. Cloudflare already resolves /x to /x/, so a rule
      // here would only add a hop to something the export serves directly.
      { source: '/document-api/reference', kind: 'v2', destination: '/document-api/reference/' },
      // A genuine move still needs both slash variants, since Cloudflare
      // matches sources exactly.
      { source: '/getting-started/quickstart', kind: 'v2', destination: '/editor/quickstart/' },
    ],
  });

  const rules = renderDispositionRedirects(dispositions).split('\n').filter(Boolean);

  assert.deepEqual(rules, [
    '/getting-started/quickstart /editor/quickstart/ 301',
    '/getting-started/quickstart/ /editor/quickstart/ 301',
  ]);
});

test('suppresses same-path rules across the whole shipped registry', async () => {
  const dispositions = parseDispositions(await readConfig('v1-dispositions.json'));
  const rules = new Set(
    renderDispositionRedirects(dispositions)
      .split('\n')
      .filter(Boolean)
      .map((rule) => rule.split(' ')[0]),
  );

  // Most of the registry is same-path after the namespace move, so most of it
  // should produce no rule at all. A regression here would reintroduce hundreds
  // of self-redirects without failing anything else.
  const samePath = [...dispositions.values()].filter(
    (entry) => entry.kind === 'v2' && entry.destination === `${entry.source}/`,
  );
  assert.ok(samePath.length > 400, `expected the bulk of the registry to be same-path, got ${samePath.length}`);
  for (const { source } of samePath) {
    assert.ok(!rules.has(source), `same-path replacement must not emit a rule: ${source}`);
    assert.ok(!rules.has(`${source}/`), `same-path replacement must not emit a slash variant: ${source}/`);
  }
});

test('the deployed-route verifier accepts the intended setup-page merge and nothing wider', () => {
  const origin = 'https://example.pages.dev';
  const landed = (path) => `${origin}${path}/`;
  const setup = '/editor/custom-ui/controller-setup';

  assert.deepEqual(INTENDED_MERGES.get(setup), [setup, '/editor/custom-ui/react-setup']);

  const merged = [
    { source: setup, kind: 'v2', landed: landed(setup) },
    { source: '/editor/custom-ui/react-setup', kind: 'v2', landed: landed(setup) },
  ];
  assert.deepEqual(collapsedRoutes(merged), []);

  // A third route absorbed by the same page is still a defect.
  const widened = [...merged, { source: '/editor/custom-ui/vue-setup', kind: 'v2', landed: landed(setup) }];
  assert.equal(collapsedRoutes(widened).length, 1);
});
