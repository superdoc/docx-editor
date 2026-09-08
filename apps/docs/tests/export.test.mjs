import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectDocumentationRoutes } from '../scripts/redirects.mjs';

const faviconHashes = {
  'android-chrome-192x192.png': '05858f553676edda50791eedacc05cf520e7cc826be9a4940ad711c15f342528',
  'android-chrome-512x512.png': '67f91f0e1b042623d37488ee2a068c0e90b0f6ff64205859bd4795cfa92f99f4',
  'apple-touch-icon.png': '35500dcee200115f8cf5447561046dab53adf93bb45d585555833a61dc42e40d',
  'favicon-16x16.png': '588881e0078c19022ea60be6c28be24214cb07a0271280203e8fb57d13ef2399',
  'favicon-32x32.png': '17720914a2e634d76acb0c747b8d439ed86b9fe745b5c6a7d96adc57c41616b6',
  'favicon.ico': '79211a3a079b08a2194872bc7f53878efa96ec13596ac226e0e29fb2610f4722',
};

const routes = [
  ['index.html', 'SuperDoc'],
  ['resources/how-superdoc-works/index.html', 'How SuperDoc works'],
  ['editor/index.html', 'SuperDoc Editor'],
  ['editor/quickstart/index.html', 'Open and edit your first DOCX'],
  ['editor/migrate-from-v1/overview/index.html', 'Migrate from v1'],
  ['editor/migrate-from-v1/removed-apis/index.html', 'Removed in v2'],
  ['editor/configuration/index.html', 'Configure the Editor'],
  ['editor/load-and-save-documents/index.html', 'Load and save a DOCX'],
  ['editor/export-options/index.html', 'Control DOCX export'],
  ['editor/document-modes/index.html', 'Choose a document mode'],
  ['editor/lifecycle-and-events/index.html', 'Handle lifecycle and events'],
  ['editor/who-renders-the-ui/index.html', 'Choose your interface'],
  ['editor/built-in-ui/overview/index.html', 'Use the built-in UI'],
  ['editor/built-in-ui/configure-the-toolbar/index.html', 'Configure the built-in toolbar'],
  ['editor/built-in-ui/comments/index.html', 'Add comments to the Editor'],
  ['editor/built-in-ui/search-and-replace/index.html', 'Search and replace document text'],
  ['editor/built-in-ui/hyperlinks/index.html', 'Configure hyperlink behavior'],
  ['editor/built-in-ui/context-menus/index.html', 'Configure the context menu'],
  ['editor/built-in-ui/content-controls/index.html', 'Show content-control chrome'],
  ['editor/built-in-ui/ruler/index.html', 'Show the ruler'],
  ['editor/built-in-ui/responsive-layout/index.html', 'Build a responsive Editor layout'],
  ['editor/content-controls/index.html', 'Content controls'],
  ['editor/content-controls/add-fields-to-a-docx-template/index.html', 'Add fields to a DOCX template'],
  ['editor/content-controls/fill-a-docx-template/index.html', 'Fill a DOCX template'],
  ['editor/content-controls/replace-clauses-from-your-application/index.html', 'Replace clauses from your application'],
  ['editor/content-controls/lock-template-fields/index.html', 'Lock template fields'],
  ['editor/custom-ui/overview/index.html', 'Build a custom UI'],
  ['editor/custom-ui/controller-setup/index.html', 'Build your first custom control'],
  ['editor/custom-ui/commands-and-state/index.html', 'Keep custom controls in sync'],
  ['editor/custom-ui/custom-commands/index.html', 'Register an application command'],
  ['editor/custom-ui/formatting-controls/index.html', 'Build a custom toolbar'],
  ['editor/custom-ui/comments/index.html', 'Build a custom comments panel'],
  ['editor/custom-ui/tracked-changes/index.html', 'Build a custom review panel'],
  ['editor/custom-ui/tables/index.html', 'Build selection-aware table controls'],
  ['editor/custom-ui/content-controls/index.html', 'Build a document field panel'],
  ['editor/custom-ui/context-menus/index.html', 'Build an application-owned context menu'],
  ['editor/custom-ui/search/index.html', 'Build custom find and replace controls'],
  ['editor/custom-ui/zoom-and-document-state/index.html', 'Build application document controls'],
  ['editor/custom-ui/selection-and-viewport/index.html', 'Build an AI prompt menu for selected text'],
  ['editor/custom-ui/selection-reference/index.html', 'Selection and position reference'],
  ['editor/custom-ui/review-highlights/index.html', 'Turn AI findings into tracked suggestions'],
  ['editor/dialogs-and-surfaces/index.html', 'Open dialogs and floating surfaces'],
  ['editor/theming/index.html', 'Theme the Editor UI'],
  ['editor/track-changes/index.html', 'Review tracked changes'],
  ['editor/collaboration/index.html', 'Understand collaboration'],
  ['editor/collaboration/connect-two-editors/index.html', 'Connect two editors'],
  ['editor/collaboration/initialize-a-document/index.html', 'Initialize a shared document'],
  ['editor/collaboration/save-and-restore-a-room/index.html', 'Save and restore a room'],
  ['editor/collaboration/control-room-access/index.html', 'Control access to a room'],
  ['editor/collaboration/run-a-server/index.html', 'Run a collaboration server'],
  ['editor/collaboration/presence-and-awareness/index.html', 'Show who is editing'],
  ['editor/collaboration/upgrade-a-document/index.html', 'Upgrade a local document to collaboration'],
  ['editor/version-history/index.html', 'Add version history'],
  ['editor/platform/proofing/index.html', 'Add spelling and grammar proofing'],
  ['editor/performance-and-large-documents/index.html', 'Tune performance for large documents'],
  ['editor/accessibility/index.html', 'Build accessible Editor experiences'],
  ['editor/secure-integration/index.html', 'Secure browser document workflows'],
  ['editor/telemetry/index.html', 'Configure telemetry'],
  ['editor/license/index.html', 'Configure the Editor license'],
  ['agents/overview/index.html', 'Overview'],
  ['agents/build/build-an-agent/index.html', 'Build an agent'],
  ['agents/build/tools/index.html', 'Tools and presets'],
  ['agents/build/legacy-tools/index.html', 'Legacy tools'],
  ['agents/automation/node-sdk/index.html', 'Automate a DOCX with Node.js'],
  ['agents/automation/python-sdk/index.html', 'Automate a DOCX with Python'],
  ['agents/automation/cli/index.html', 'Automate a DOCX from the CLI'],
  ['agents/workflows/review-tracked-changes/index.html', 'Review tracked changes'],
  ['agents/operate/safety/index.html', 'Safety'],
  ['document-api/mental-model/index.html', 'Document API mental model'],
  ['document-api/application-data/index.html', 'Store application data in DOCX'],
  ['document-api/query-content/index.html', 'Query document content'],
  ['document-api/replace-delete-content/index.html', 'Replace and delete content'],
  ['document-api/mutation-plans/index.html', 'Preview and apply mutation plans'],
  ['document-api/tracked-changes/index.html', 'Work with tracked changes'],
  ['document-api/comments/index.html', 'Create and resolve comment threads'],
  ['document-api/receipts-and-errors/index.html', 'Receipts and errors'],
  ['document-api/reference/index.html', 'Document API reference'],
  ['document-api/reference/content-controls/index.html', 'Content Controls operations'],
  ['document-api/reference/query/match/index.html', 'query.match'],
  ['resources/license/index.html', 'Licensing'],
  ['resources/package-compatibility/index.html', 'Package compatibility'],
  ['resources/security/index.html', 'Trust &amp; Security'],
  ['resources/docx-engine-license/index.html', 'SuperDoc DOCX Engine Proprietary License'],
];

for (const [outputPath, expectedText] of routes) {
  test(`exports ${outputPath}`, async () => {
    const html = await readFile(new URL(`../out/${outputPath}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

function sidebarLinks(html) {
  const sidebar = html.match(/<aside id="nd-sidebar"[\s\S]*?<\/aside>/u)?.[0];
  assert.ok(sidebar, 'expected the rendered desktop sidebar');

  return [...sidebar.matchAll(/<a\b([^>]*)>([^<]+)<\/a>/gu)].map(([, attributes, text]) => ({
    active: attributes.match(/\bdata-active="([^"]+)"/u)?.[1],
    text,
  }));
}

test('exports the condensed primary sections and keeps migration last', async () => {
  const editor = await readFile(new URL('../out/editor/index.html', import.meta.url), 'utf8');
  const migrationOverview = await readFile(
    new URL('../out/editor/migrate-from-v1/overview/index.html', import.meta.url),
    'utf8',
  );
  const migrationRemovedApis = await readFile(
    new URL('../out/editor/migrate-from-v1/removed-apis/index.html', import.meta.url),
    'utf8',
  );
  const resourcesOverview = await readFile(
    new URL('../out/resources/how-superdoc-works/index.html', import.meta.url),
    'utf8',
  );
  const resourcesCompatibility = await readFile(
    new URL('../out/resources/package-compatibility/index.html', import.meta.url),
    'utf8',
  );
  const resourcesSecurity = await readFile(new URL('../out/resources/security/index.html', import.meta.url), 'utf8');
  const resourcesLicense = await readFile(new URL('../out/resources/license/index.html', import.meta.url), 'utf8');
  const expectedPrimaryLabels = [
    'Editor',
    'Agents &amp; automation',
    'Document API',
    'Resources',
    'Migrate from v1',
  ];
  const editorLinks = sidebarLinks(editor);
  const migrationLinks = sidebarLinks(migrationOverview);
  const resourceLinks = sidebarLinks(resourcesOverview);

  assert.deepEqual(
    editorLinks.slice(0, expectedPrimaryLabels.length).map(({ text }) => text),
    expectedPrimaryLabels,
  );
  assert.ok(!editorLinks.some(({ text }) => text === 'Use with React'));
  assert.ok(!editorLinks.some(({ text }) => text === 'Use with SvelteKit'));
  assert.deepEqual(
    editorLinks.slice(-2).map(({ text }) => text),
    ['Telemetry', 'License'],
  );
  assert.deepEqual(
    migrationLinks.slice(expectedPrimaryLabels.length).map(({ text }) => text),
    ['Overview', 'Removed APIs'],
  );
  assert.deepEqual(
    resourceLinks.slice(expectedPrimaryLabels.length).map(({ text }) => text),
    ['How SuperDoc works', 'Package compatibility', 'Security', 'License'],
  );

  const sectionPages = [
    [editor, 'Editor'],
    [migrationOverview, 'Migrate from v1'],
    [migrationRemovedApis, 'Migrate from v1'],
    [resourcesOverview, 'Resources'],
    [resourcesCompatibility, 'Resources'],
    [resourcesSecurity, 'Resources'],
    [resourcesLicense, 'Resources'],
  ];
  for (const [html, expectedActiveLabel] of sectionPages) {
    const activePrimaryLabels = sidebarLinks(html)
      .slice(0, expectedPrimaryLabels.length)
      .filter(({ active }) => active === 'true')
      .map(({ text }) => text);
    assert.deepEqual(activePrimaryLabels, [expectedActiveLabel]);
  }

  const primaryNavigation = editor.match(/<nav[^>]+aria-label="Primary navigation"[\s\S]*?<\/nav>/u)?.[0];
  assert.ok(primaryNavigation);
  assert.doesNotMatch(primaryNavigation, />Get started</u);
});

test('exports the homepage without the documentation sidebar', async () => {
  const homepage = await readFile(new URL('../out/index.html', import.meta.url), 'utf8');
  const article = await readFile(new URL('../out/editor/quickstart/index.html', import.meta.url), 'utf8');

  assert.match(homepage, /id="nd-home-layout"/);
  assert.doesNotMatch(homepage, /id="nd-sidebar"/);
  assert.match(article, /id="nd-docs-layout"/);
  assert.match(article, /id="nd-sidebar"/);
});

test('keeps the DOCX Engine license out of Resources navigation', async () => {
  const security = await readFile(new URL('../out/resources/security/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(security, /href="\/resources\/docx-engine-license\/?"/u);
});

test('exports agent prompts that resolve against the serving origin', async () => {
  const homepage = await readFile(new URL('../out/index.html', import.meta.url), 'utf8');

  assert.match(homepage, /Point your agent at the right guide/);
  assert.match(homepage, /source of truth for SuperDoc v2/);
  // The prompt is rebuilt from the serving origin once hydrated, so a preview
  // or local build hands out its own Markdown routes instead of production's.
  assert.doesNotMatch(homepage, /https:\/\/docs\.superdoc\.dev\/(?:md|llms)/);
});

test('loads production analytics without counting preview traffic', async () => {
  const homepage = await readFile(new URL('../out/index.html', import.meta.url), 'utf8');

  assert.match(homepage, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-E4T80WRJGS/u);
  assert.match(homepage, /window\.location\.hostname === 'docs\.superdoc\.dev'/u);
  assert.match(homepage, /gtag\('config', 'G-E4T80WRJGS'\)/u);
});

test('exports the shared SuperDoc favicon bundle', async () => {
  const homepage = await readFile(new URL('../out/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../out/site.webmanifest', import.meta.url), 'utf8'));

  assert.match(homepage, /<link rel="manifest" href="\/site\.webmanifest"\/>/u);
  assert.match(homepage, /<link rel="icon" href="\/favicon\.ico" sizes="any"\/>/u);
  assert.match(homepage, /<link rel="icon" href="\/favicon-16x16\.png" sizes="16x16" type="image\/png"\/>/u);
  assert.match(homepage, /<link rel="icon" href="\/favicon-32x32\.png" sizes="32x32" type="image\/png"\/>/u);
  assert.match(
    homepage,
    /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" sizes="180x180" type="image\/png"\/>/u,
  );
  assert.equal(manifest.name, 'SuperDoc');
  assert.equal(manifest.short_name, 'SuperDoc');
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })),
    [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  );

  for (const [filename, expectedHash] of Object.entries(faviconHashes)) {
    const asset = await readFile(new URL(`../out/${filename}`, import.meta.url));
    assert.equal(createHash('sha256').update(asset).digest('hex'), expectedHash, filename);
  }
});

test('exports one page-context control with clean Markdown and AI routes', async () => {
  const article = await readFile(new URL('../out/editor/quickstart/index.html', import.meta.url), 'utf8');

  assert.match(article, /Copy page/);
  assert.match(article, /aria-label="More page formats"/);
  assert.match(article, /View as Markdown/);
  assert.match(article, /href="\/md\/editor\/quickstart\.md"/);
  assert.match(article, /Open in ChatGPT/);
  assert.match(article, /Open in Claude/);
  assert.match(article, /href="\/llms-full\.txt"/);
});

test('exports a canonical URL on every page shape', async () => {
  const homepage = await readFile(new URL('../out/index.html', import.meta.url), 'utf8');
  const article = await readFile(new URL('../out/editor/quickstart/index.html', import.meta.url), 'utf8');
  const reference = await readFile(
    new URL('../out/document-api/reference/blocks/split/index.html', import.meta.url),
    'utf8',
  );

  // Every alias Cloudflare Pages serves the export from would otherwise
  // advertise itself as canonical and compete with production in search.
  assert.match(homepage, /<link rel="canonical" href="https:\/\/docs\.superdoc\.dev\/"\/>/u);
  assert.match(article, /<link rel="canonical" href="https:\/\/docs\.superdoc\.dev\/editor\/quickstart\/"\/>/u);
  assert.match(
    reference,
    /<link rel="canonical" href="https:\/\/docs\.superdoc\.dev\/document-api\/reference\/blocks\/split\/"\/>/u,
  );
});

test('exports a sitemap covering every live documentation route', async () => {
  const sitemap = await readFile(new URL('../out/sitemap.xml', import.meta.url), 'utf8');
  const redirects = await readFile(new URL('../out/_redirects', import.meta.url), 'utf8');

  const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(([, url]) => url));
  const redirectSources = new Set(redirects.split('\n').map((line) => line.split(' ')[0]));

  // config/routes.json is an append-only history, so it still records routes
  // that have since moved or retired. The sitemap must advertise what the
  // export actually serves: a listed redirect source would send crawlers to a
  // hop, and a missing live page would go unindexed.
  const built = [...(await collectDocumentationRoutes(fileURLToPath(new URL('../out', import.meta.url))))].sort();
  const missing = built.filter((route) => !listed.has(`https://docs.superdoc.dev${route}`));

  assert.deepEqual(missing, [], 'every exported documentation page belongs in the sitemap');
  assert.equal(listed.size, built.length);

  for (const url of listed) {
    const path = url.replace('https://docs.superdoc.dev', '');
    // trailingSlash: true means the served URL always ends in a slash. An
    // entry without one points at a redirect rather than the page itself.
    assert.match(url, /\/$/u, `sitemap entry must be the served URL: ${url}`);
    assert.ok(!redirectSources.has(path), `sitemap must not list a redirect source: ${path}`);
  }
});

test('exports a robots policy that allows indexing and finds the sitemap', async () => {
  const robots = await readFile(new URL('../out/robots.txt', import.meta.url), 'utf8');

  assert.match(robots, /User-Agent: \*/u);
  assert.match(robots, /Allow: \//u);
  assert.match(robots, /Sitemap: https:\/\/docs\.superdoc\.dev\/sitemap\.xml/u);
  // Preview aliases are excluded by Cloudflare's X-Robots-Tag header. A
  // disallow rule here would ship in the production artifact too.
  assert.doesNotMatch(robots, /Disallow: \/\s*$/mu);
});

test('exports the tracked-changes fixture', async () => {
  const fixture = await stat(new URL('../out/fixtures/tracked-changes.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the sample NDA document', async () => {
  const fixture = await stat(new URL('../out/fixtures/sample-nda.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the editor quickstart sample document', async () => {
  const fixture = await stat(new URL('../out/fixtures/getting-started.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the focused loading sample document', async () => {
  const fixture = await stat(new URL('../out/fixtures/loading-sample.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the focused ruler sample document', async () => {
  const fixture = await stat(new URL('../out/fixtures/ruler-sample.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the focused search sample document', async () => {
  const fixture = await stat(new URL('../out/fixtures/search-sample.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the custom comments workflow document', async () => {
  const fixture = await stat(new URL('../out/fixtures/custom-comments-workflow.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the custom tracked-changes workflow document', async () => {
  const fixture = await stat(new URL('../out/fixtures/custom-track-changes-workflow.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the custom content-controls workflow document', async () => {
  const fixture = await stat(new URL('../out/fixtures/custom-content-controls-workflow.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the custom selection workflow document', async () => {
  const fixture = await stat(new URL('../out/fixtures/custom-selection-workflow.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the Content controls feature and its pattern map for agents', async () => {
  const article = await readFile(new URL('../out/editor/content-controls/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/content-controls.md', import.meta.url), 'utf8');

  assert.match(article, /Content controls/u);
  assert.match(article, /sd-content-control-patterns/u);
  assert.match(markdown, /Content-control shapes/u);
  assert.match(markdown, /Repeating section/u);
  assert.doesNotMatch(markdown, /<ContentControlPatterns/u);
});

test('exports the Content controls workflow guides and interactive-demo fallbacks', async () => {
  const authoring = await readFile(
    new URL('../out/editor/content-controls/add-fields-to-a-docx-template/index.html', import.meta.url),
    'utf8',
  );
  const fill = await readFile(
    new URL('../out/editor/content-controls/fill-a-docx-template/index.html', import.meta.url),
    'utf8',
  );
  const clauses = await readFile(
    new URL('../out/editor/content-controls/replace-clauses-from-your-application/index.html', import.meta.url),
    'utf8',
  );
  const locks = await readFile(
    new URL('../out/editor/content-controls/lock-template-fields/index.html', import.meta.url),
    'utf8',
  );
  const authoringMarkdown = await readFile(
    new URL('../out/md/editor/content-controls/add-fields-to-a-docx-template.md', import.meta.url),
    'utf8',
  );
  const populationMarkdown = await readFile(
    new URL('../out/md/editor/content-controls/fill-a-docx-template.md', import.meta.url),
    'utf8',
  );
  const clauseMarkdown = await readFile(
    new URL('../out/md/editor/content-controls/replace-clauses-from-your-application.md', import.meta.url),
    'utf8',
  );
  const lockMarkdown = await readFile(
    new URL('../out/md/editor/content-controls/lock-template-fields.md', import.meta.url),
    'utf8',
  );

  assert.match(authoring, /sd-content-control-authoring-demo/u);
  assert.match(fill, /sd-template-population-demo/u);
  assert.match(clauses, /sd-clause-library-demo/u);
  assert.match(locks, /sd-content-control-locks-demo/u);
  assert.match(authoringMarkdown, /Interactive editor: add template fields/u);
  assert.match(populationMarkdown, /Interactive editor: Fill the template/u);
  assert.match(populationMarkdown, /one form value updates 3 document occurrences/u);
  assert.match(clauseMarkdown, /Interactive editor: Choose a confidentiality clause/u);
  assert.match(lockMarkdown, /Interactive editor: Lock a template field/u);
  assert.match(lockMarkdown, /Content control cannot be deleted/u);
  assert.doesNotMatch(authoringMarkdown, /<ContentControlAuthoringDemo/u);
  assert.doesNotMatch(populationMarkdown, /<TemplatePopulationDemo/u);
  assert.doesNotMatch(clauseMarkdown, /<ClauseLibraryDemo/u);
  assert.doesNotMatch(lockMarkdown, /<ContentControlLocksDemo/u);
});

test('exports the content-control authoring document', async () => {
  const fixture = await stat(new URL('../out/fixtures/service-agreement-draft.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the service-agreement template', async () => {
  const fixture = await stat(new URL('../out/fixtures/service-agreement-template.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('exports the clause-library document', async () => {
  const fixture = await stat(new URL('../out/fixtures/clause-library-sample.docx', import.meta.url));
  assert.ok(fixture.size > 0);
});

test('the editor quickstart offers the clean sample and no review markup', async () => {
  const article = await readFile(new URL('../out/editor/quickstart/index.html', import.meta.url), 'utf8');
  const quickstartMarkdown = await readFile(new URL('../out/md/editor/quickstart.md', import.meta.url), 'utf8');
  const configurationMarkdown = await readFile(new URL('../out/md/editor/configuration.md', import.meta.url), 'utf8');

  assert.match(article, /Download the sample document/);
  assert.match(article, /href="\/fixtures\/getting-started\.docx"/);
  assert.match(quickstartMarkdown, /Change the effective date from `September 1, 2026` to `October 1, 2026`/);
  const reactStyles = await readFile(new URL('../../../examples/react/src/index.css', import.meta.url), 'utf8');
  assert.ok(quickstartMarkdown.includes(reactStyles.trim()), 'include the stylesheet imported by the React entry point');
  assert.doesNotMatch(quickstartMarkdown, /complete the Word round trip/i);
  assert.match(configurationMarkdown, /Continue with the `\/sample\.docx` project/);
  assert.match(configurationMarkdown, /documentMode: 'suggesting'/);
  // The tracked-changes fixture is reserved for review guidance, so the
  // quickstart must not reintroduce it through a download or an embed.
  assert.doesNotMatch(article, /tracked-changes\.docx/);
  assert.doesNotMatch(article, /cdn\.jsdelivr\.net/);
});

test('exports every framework example as plain Markdown', async () => {
  const pages = [
    'quickstart',
    'configuration',
    'document-modes',
    'load-and-save-documents',
  ];

  for (const page of pages) {
    const markdown = await readFile(new URL(`../out/md/editor/${page}.md`, import.meta.url), 'utf8');

    assert.match(markdown, /\*\*Vanilla — `/u, page);
    assert.match(markdown, /\*\*React — `/u, page);
    assert.doesNotMatch(markdown, /<\/?FrameworkExample(?:Tabs)?\b/u, page);
  }
});

test('exports the tracked-review workflow with local-file fallback', async () => {
  const article = await readFile(
    new URL('../out/agents/workflows/review-tracked-changes/index.html', import.meta.url),
    'utf8',
  );

  assert.match(article, /review-workflow\.[a-zA-Z0-9_-]+\.svg/);
  assert.match(article, /Open your DOCX/);
  assert.match(article, /Files stay in this browser/);
  assert.match(article, /changeMode/);
  assert.match(article, /tracked/);
  assert.doesNotMatch(article, /cdn\.jsdelivr\.net/);
});

test('exports the document modes guide with the shared Editor demo frame', async () => {
  const article = await readFile(new URL('../out/editor/document-modes/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/document-modes.md', import.meta.url), 'utf8');

  assert.match(article, /Try document modes/);
  assert.match(article, /data-preset="document-modes"/);
  assert.match(article, /aria-label="Try document modes configuration"/);
  assert.match(article, /aria-label="Mode"/);
  assert.match(article, /Reset the sample document/);
  assert.match(article, /Enter fullscreen/);
  assert.match(article, /Typing changes the document directly/);
  assert.doesNotMatch(article, /sd-editor-demo-mode-footer/);
  assert.doesNotMatch(article, /Run the test edit/);
  assert.match(markdown, /Editing changes the document directly/);
  assert.match(markdown, /use Changes to choose Original, Markup, or Final for the same proposal/);
  assert.match(markdown, /trackedChanges: 'markup'/);
  assert.match(markdown, /superdoc\.setViewingOptions/);
  assert.match(markdown, /`original`[^\n]*`30 days`, without change marks/u);
  assert.match(markdown, /`markup`[^\n]*`30 days` deleted and `60 days` inserted/u);
  assert.match(markdown, /`final`[^\n]*`60 days`, without change marks/u);
  assert.match(markdown, /These options only change the display\. The proposal remains in the DOCX/u);
  assert.doesNotMatch(markdown, /<EditorDemo\b/);
});

test('exports the proofing guide with an interactive editor', async () => {
  const article = await readFile(new URL('../out/editor/platform/proofing/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/platform/proofing.md', import.meta.url), 'utf8');

  assert.match(article, /Try proofing/);
  assert.match(article, /data-preset="proofing"/);
  assert.match(article, /data-expanded="false"/);
  assert.match(article, /Proofing helps people catch spelling and grammar mistakes while they write/);
  assert.match(article, /id="proofing-config"/);
  assert.match(article, /data-config-explorer="true"/);
  assert.match(article, /proofing config/);
  assert.match(article, /Setup/);
  assert.match(article, /Behavior/);
  assert.match(article, /Events/);
  assert.match(article, /Reserved/);
  assert.match(article, /required for feature/);
  assert.match(markdown, /Proofing: type `mispelled`, `workng`, or `teh`, then right-click the underline\./);
  assert.match(markdown, /\| `enabled` \| `boolean` \| `false` \|/);
  assert.match(markdown, /visibleFirst.*maxConcurrentRequests.*maxSegmentsPerBatch/s);
  const tableStart = markdown.indexOf('| Field | Type | Default | Status | Summary | API details | Guide |');
  const tableEnd = markdown.indexOf('\n\n', tableStart);
  const configRows = markdown.slice(tableStart, tableEnd).split('\n');
  assert.ok(configRows.length > 2);
  assert.ok(configRows.every((row) => row.startsWith('|') && row.endsWith('|')));
  assert.doesNotMatch(markdown, /<ProofingConfigReference\b/);
  assert.doesNotMatch(markdown, /<EditorDemo\b/);
});

test('exports the custom UI overview with ownership and live-control fallbacks', async () => {
  const article = await readFile(new URL('../out/editor/custom-ui/overview/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/overview.md', import.meta.url), 'utf8');

  assert.match(article, /sd-cui-arch/);
  assert.match(article, /data-custom-bold-demo="true"/);
  assert.match(markdown, /> \*\*Diagram: the custom UI ownership boundary\*\*/);
  assert.match(markdown, /> \*\*Live example: one custom control on a real document\*\*/);
  assert.doesNotMatch(markdown, /<CustomUiArchitecture\b/);
  assert.doesNotMatch(markdown, /<CustomBoldDemo\b/);
});

test('exports the custom UI command-state model with a Markdown fallback', async () => {
  const article = await readFile(new URL('../out/editor/custom-ui/commands-and-state/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/commands-and-state.md', import.meta.url), 'utf8');

  assert.match(article, /data-command-state-demo="true"/);
  assert.match(article, /Watch one control follow the selection/);
  assert.match(article, /Toggle bold for the simulated selection/);
  assert.match(article, /Run Bold to see the command result/);
  assert.match(markdown, /> \*\*Interactive model: watch one control follow the selection\*\*/);
  assert.match(markdown, /Pressing Bold changes `active` to `true` and reports `\{ success: true \}`/);
  assert.match(markdown, /A locked heading reports `enabled: false`, `active: false`, and a disabled reason/);
  assert.match(markdown, /State describes what the control should render/);
  assert.doesNotMatch(markdown, /<CommandStateDemo\b/);
});

test('exports the focused built-in toolbar example as clean Markdown', async () => {
  const article = await readFile(
    new URL('../out/editor/built-in-ui/configure-the-toolbar/index.html', import.meta.url),
    'utf8',
  );
  const markdown = await readFile(
    new URL('../out/md/editor/built-in-ui/configure-the-toolbar.md', import.meta.url),
    'utf8',
  );
  const redirects = await readFile(new URL('../out/_redirects', import.meta.url), 'utf8');

  assert.match(article, /responsiveTo/);
  assert.match(article, /Document mode/);
  assert.match(article, /data-preset="toolbar"/);
  assert.match(article, /getting-started\.docx/);
  assert.match(article, /id="toolbar-config"/);
  assert.match(article, /data-config-explorer="true"/);
  assert.match(
    article,
    /10(?:<!-- -->|\s)+fields(?:<!-- -->|\s)+· generated from <code>ToolbarConfig<\/code>/,
  );
  assert.match(markdown, /const toolbar = \{[\s\S]*?\} satisfies ToolbarConfig/);
  assert.match(markdown, /<SuperDocEditor[\s\S]*?document='\/sample\.docx'/);
  assert.match(markdown, /export default function App/);
  assert.match(markdown, /items: \{/);
  assert.match(markdown, /Toolbar configurations available in the interactive Editor/);
  assert.match(markdown, /Focus — `ui\.toolbar\.items`/);
  assert.match(markdown, /Remove — `ui\.toolbar\.excludeItems`/);
  assert.match(markdown, /Add — `ui\.toolbar\.customItems`/);
  assert.match(markdown, /Review note:/);
  assert.match(markdown, /controls that no longer fit move into the overflow menu/);
  assert.match(markdown, /handleImageUpload/);
  assert.match(markdown, /new FileReader\(\)/u);
  assert.match(markdown, /file\.slice\(0, file\.size, 'image\/png'\)/u);
  assert.match(markdown, /file\.slice\(0, file\.size, 'image\/jpeg'\)/u);
  assert.match(markdown, /readAsDataURL\(withImageMimeType\(file\)\)/u);
  assert.doesNotMatch(markdown, /URL\.(?:create|revoke)ObjectURL/u);
  assert.match(markdown, /examples return data URLs/iu);
  assert.match(markdown, /no backend or temporary object URL/iu);
  assert.match(markdown, /extension-accepted PNG and JPEG files[^.]*browser leaves `file\.type` empty/iu);
  assert.match(markdown, /immediately fetches object or HTTP URLs/iu);
  assert.match(markdown, /embeds the image in the\s+DOCX/iu);
  assert.match(markdown, /same-origin/iu);
  assert.match(markdown, /public or presigned URL/iu);
  assert.match(markdown, /without cross-origin\s+cookies or custom authorization headers/iu);
  assert.match(markdown, /cross-origin requests \(CORS\)/iu);
  assert.match(markdown, /CORS[^.]*application's origin/iu);
  assert.doesNotMatch(markdown, /persistent (?:storage|URL)/iu);
  assert.match(markdown, /\[Configure content controls\]\(\/editor\/built-in-ui\/content-controls\)/u);
  assert.match(markdown, /\| `items` \|/);
  assert.match(markdown, /\| `customItems` \|/);
  assert.doesNotMatch(markdown, /<ToolbarConfigReference\b/);
  assert.doesNotMatch(markdown, /<EditorDemo\b/);
  assert.doesNotMatch(markdown, /<include>/);
  assert.match(
    redirects,
    /^\/editor\/built-in-ui\/structured-content\/ \/editor\/built-in-ui\/configure-the-toolbar\/ 301$/mu,
  );
});

test('exports the custom UI setup examples as clean Markdown', async () => {
  const article = await readFile(new URL('../out/editor/custom-ui/controller-setup/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/controller-setup.md', import.meta.url), 'utf8');

  assert.match(article, /SuperDocUIProvider/);
  assert.match(article, /useSuperDocCommand/);
  assert.match(article, /data-variant="handoff"/);
  assert.match(markdown, /document: '\/sample\.docx'/);
  assert.match(markdown, /pnpm add superdoc/);
  assert.match(markdown, /useSetSuperDoc/);
  assert.match(markdown, /excludeItems: \['bold'\]/);
  assert.match(markdown, /Live example: move one control into your application/);
  assert.match(markdown, /Bold applied\./);
  assert.doesNotMatch(markdown, /toolbar: false/);
  assert.doesNotMatch(markdown, /<CustomBoldDemo\b/);
  assert.doesNotMatch(markdown, /<include>/);
});

test('exports the custom UI command-state contract without a copied command matrix', async () => {
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/commands-and-state.md', import.meta.url), 'utf8');

  assert.match(markdown, /`enabled`/);
  assert.match(markdown, /`active`/);
  assert.match(markdown, /`value`/);
  assert.match(markdown, /`reason`/);
  assert.match(markdown, /`supported`/);
  assert.match(markdown, /`CommandId`/);
  assert.match(markdown, /Choose the actions your workflow needs instead of generating a toolbar/);
  assert.match(markdown, /check the result even when `enabled` was `true`/);
});

test('exports the Editor tracked-change review workflow with the existing review demo', async () => {
  const article = await readFile(new URL('../out/editor/track-changes/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/track-changes.md', import.meta.url), 'utf8');

  assert.match(article, /Review a tracked change/);
  assert.match(article, /data-preset="tracked-review"/);
  assert.match(article, /Accept/);
  assert.match(article, /Reject/);
  assert.match(markdown, /Tracked-change review: accept or reject the sample change/);
  assert.match(markdown, /Editor modes and client-side review controls are not an authorization boundary/);
  assert.doesNotMatch(markdown, /<EditorDemo\b/);
});

test('exports the custom tracked-change review workflow as clean Markdown', async () => {
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/tracked-changes.md', import.meta.url), 'utf8');

  assert.match(markdown, /Live example: review changes from an application-owned panel/);
  assert.match(markdown, /custom-track-changes-workflow\.docx/);
  assert.match(markdown, /ui\.trackChanges\.observe\(render\)/);
  assert.match(markdown, /ui\.trackChanges\.setActive\(target\)/);
  assert.match(markdown, /await ui\.trackChanges\.scrollTo\(target\)/);
  assert.match(markdown, /await ui\.trackChanges\.navigatePrevious\(\)/);
  assert.match(markdown, /await ui\.trackChanges\.navigateNext\(\)/);
  assert.match(markdown, /await ui\.trackChanges\.acceptAsync\(target\)/);
  assert.match(markdown, /useSuperDocTrackChanges\(\)/);
  assert.match(markdown, /setting `ui\.comments` to `false` removes the built-in comments and review sidebar/);
  assert.doesNotMatch(markdown, /<include>/);
  assert.doesNotMatch(markdown, /<CustomTrackChangesDemo\b/);
});

test('exports the custom content-control workflow as clean Markdown', async () => {
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/content-controls.md', import.meta.url), 'utf8');

  assert.match(markdown, /Live example: edit document fields from an application-owned panel/);
  assert.match(markdown, /custom-content-controls-workflow\.docx/);
  assert.match(markdown, /ui\.contentControls\.observe\(\(snapshot\)/);
  assert.match(markdown, /await ui\.contentControls\.focus/);
  assert.match(markdown, /await documentApi\.contentControls\.text\.setValue/);
  assert.match(markdown, /await documentApi\.contentControls\.checkbox\.setState/);
  assert.match(markdown, /contentControls\.observe\(/);
  assert.match(markdown, /superdoc@2\.12\.0/);
  assert.match(markdown, /Confirm the updated field value/);
  assert.doesNotMatch(markdown, /<include>/);
  assert.doesNotMatch(markdown, /<CustomContentControlsDemo\b/);
});

test('exports the custom Search workflow as clean Markdown', async () => {
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/search.md', import.meta.url), 'utf8');

  assert.match(markdown, /Live example: drive Search from application-owned controls/);
  assert.match(markdown, /ui: editorUi/);
  assert.match(markdown, /search\.observe\(render\)/);
  assert.match(markdown, /useSuperDocSearch\(\)/);
  assert.match(markdown, /superdoc\.ui\.search\.find\('Legacy'/);
  assert.match(markdown, /`ui: \{ search: false \}` hides SuperDoc's Search surface/);
  assert.match(markdown, /no replacement is pending/);
  assert.doesNotMatch(markdown, /<include>/);
  assert.doesNotMatch(markdown, /<CustomSearchDemo\b/);
});

test('exports the custom table-controls workflow as clean Markdown', async () => {
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/tables.md', import.meta.url), 'utf8');

  assert.match(markdown, /ui\.tables\.getContext\(\)/);
  assert.match(markdown, /await addRow\.executeAsync\(\)/);
  assert.match(markdown, /await deleteRow\.executeAsync\(\)/);
  assert.match(markdown, /table-context-unavailable/);
  assert.doesNotMatch(markdown, /<include>/);
});

test('exports the custom toolbar workflow as clean Markdown', async () => {
  const article = await readFile(
    new URL('../out/editor/custom-ui/formatting-controls/index.html', import.meta.url),
    'utf8',
  );
  const markdown = await readFile(
    new URL('../out/md/editor/custom-ui/formatting-controls.md', import.meta.url),
    'utf8',
  );

  assert.match(article, /data-custom-toolbar-demo="true"/);
  assert.match(markdown, /> \*\*Live example: scale one control into a custom toolbar\*\*/);
  assert.match(markdown, /Formatting one sentence and extending the selection into plain text makes the font and size pickers show `Mixed`/);
  assert.match(markdown, /ui\.fonts\.getSnapshot\(\)/);
  assert.match(markdown, /report\(await action\(\), message\)/);
  assert.match(markdown, /if \(pending\) return/);
  assert.match(markdown, /fontFamily\.executeAsync\(event\.target\.value\)/);
  assert.match(markdown, /fontSize\.executeAsync\(event\.target\.value\)/);
  assert.match(markdown, /ui: editorUi/);
  assert.doesNotMatch(markdown, /<CustomToolbarDemo\b/);
  assert.doesNotMatch(markdown, /<include>/);
});

test('exports custom document controls as clean Markdown', async () => {
  const article = await readFile(
    new URL('../out/editor/custom-ui/zoom-and-document-state/index.html', import.meta.url),
    'utf8',
  );
  const markdown = await readFile(
    new URL('../out/md/editor/custom-ui/zoom-and-document-state.md', import.meta.url),
    'utf8',
  );

  assert.match(article, /data-custom-document-controls-demo="true"/);
  assert.match(markdown, /> \*\*Live example: build document-wide controls without replacing the toolbar\*\*/);
  assert.match(markdown, /\*\*Vanilla — `src\/main\.ts`\*\*/);
  assert.match(markdown, /\*\*React — `src\/App\.tsx`\*\*/);
  assert.match(markdown, /excludeItems: \['zoom'\]/);
  assert.match(markdown, /superdoc@2\.12\.0/);
  assert.match(markdown, /docs-only fitting helper/);
  assert.doesNotMatch(markdown, /ui\.zoom\.setMode\('fit-width'\)/);
  assert.match(markdown, /ui\.document\.observe\(render\)/);
  assert.match(markdown, /useSuperDocZoom\(\)/);
  assert.match(markdown, /useSuperDocDocument\(\)/);
  assert.match(markdown, /if \(!pendingExport\)/);
  assert.match(markdown, /triggerDownload: true/);
  assert.match(markdown, /exportInFlight/);
  assert.match(markdown, /`mode` field reports whether\s+the Editor is in editing, suggesting, or viewing mode/s);
  assert.match(markdown, /ui\.document\.getSnapshot\(\)/);
  assert.doesNotMatch(markdown, /`ui\.document\.(?:ready|mode)`/);
  assert.doesNotMatch(markdown, /<CustomDocumentControlsDemo\b/);
  assert.doesNotMatch(markdown, /<include>/);
});

test('exports the surface lifecycle experience as clean Markdown', async () => {
  const article = await readFile(new URL('../out/editor/dialogs-and-surfaces/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/dialogs-and-surfaces.md', import.meta.url), 'utf8');

  assert.match(article, /data-surface-lifecycle-demo="true"/u);
  assert.match(markdown, /> \*\*Live example: compare a dialog and a floating surface\*\*/u);
  assert.match(markdown, /openSurface\(\{ mode: 'dialog' \}\)/u);
  assert.match(markdown, /openSurface\(\{ mode: 'floating' \}\)/u);
  assert.match(markdown, /SurfaceOutcome<ConfirmationResult>/u);
  assert.match(markdown, /return \{\s+destroy\(\)/u);
  assert.match(markdown, /`submitted`.*`closed`.*`replaced`/su);
  assert.match(markdown, /Selection and viewport APIs/u);
  assert.doesNotMatch(markdown, /<SurfaceLifecycleDemo\b/u);
  assert.doesNotMatch(markdown, /<include>/u);
});

test('exports the theming experience as clean Markdown', async () => {
  const article = await readFile(new URL('../out/editor/theming/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/theming.md', import.meta.url), 'utf8');

  assert.match(article, /data-theme-playground="true"/u);
  assert.match(markdown, /> \*\*Live example: theme the Editor UI\*\*/u);
  assert.match(markdown, /satisfies ThemeConfig/u);
  assert.match(markdown, /document\.documentElement\.classList\.add\(themeClass\)/u);
  assert.match(markdown, /--sd-ui-toolbar-bg/u);
  assert.match(markdown, /buildTheme\(\)/u);
  assert.match(markdown, /Choose a token/u);
  assert.match(markdown, /`actionText`/u);
  assert.match(markdown, /`textDisabled`/u);
  assert.match(markdown, /`vars` accepts arbitrary string keys/u);
  assert.doesNotMatch(markdown, /<ThemePlayground\b/u);
  assert.doesNotMatch(markdown, /<include>/u);
});

test('exports custom command registration as clean Markdown', async () => {
  const article = await readFile(new URL('../out/editor/custom-ui/custom-commands/index.html', import.meta.url), 'utf8');
  const markdown = await readFile(new URL('../out/md/editor/custom-ui/custom-commands.md', import.meta.url), 'utf8');

  assert.match(article, /data-custom-command-demo="true"/);
  assert.match(markdown, /> \*\*Live example: run one application command from two controls\*\*/);
  assert.match(markdown, /ui\.commands\.register<InsertClausePayload>/);
  assert.match(markdown, /shortcut.*application still owns the keyboard listener/s);
  assert.match(markdown, /registration\.unregister/);
  assert.match(markdown, /getState\(\).*does not block custom-command execution/s);
  assert.match(markdown, /event\.composedPath\(\)\.includes\(commandDemo\)/);
  assert.match(markdown, /Move focus outside the\s+Editor experience/s);
  assert.doesNotMatch(markdown, /contextMenu:/);
  assert.doesNotMatch(markdown, /<CustomCommandDemo\b/);
  assert.doesNotMatch(markdown, /<include>/);
});

test('exports the comments workflow through each canonical surface', async () => {
  const builtInArticle = await readFile(new URL('../out/editor/built-in-ui/comments/index.html', import.meta.url), 'utf8');
  const builtIn = await readFile(new URL('../out/md/editor/built-in-ui/comments.md', import.meta.url), 'utf8');
  const customUI = await readFile(new URL('../out/md/editor/custom-ui/comments.md', import.meta.url), 'utf8');
  const documentApi = await readFile(new URL('../out/md/document-api/comments.md', import.meta.url), 'utf8');
  const trackedChanges = await readFile(new URL('../out/md/editor/track-changes.md', import.meta.url), 'utf8');

  assert.match(builtInArticle, /data-preset="comments"/);
  assert.match(builtInArticle, /comments-sample\.docx/);
  assert.match(builtInArticle, /id="comments-config"/);
  assert.match(builtInArticle, /data-config-explorer="true"/);
  assert.match(builtIn, /\*\*Vanilla — `src\/main\.ts`\*\*/);
  assert.match(builtIn, /\*\*React — `src\/App\.tsx`\*\*/);
  assert.match(builtIn, /Comment configurations available in the interactive Editor/);
  assert.match(builtIn, /Layout — `ui\.comments\.layout`/);
  assert.match(builtIn, /Actions — `interaction\.comments\.level`/);
  assert.match(builtIn, /layout: 'auto'/);
  assert.match(builtIn, /level: 'write'/);
  assert.match(builtIn, /\| `ui\.comments\.layout` \|/);
  assert.match(builtIn, /\| `interaction\.comments\.level` \|/);
  assert.match(builtIn, /not an authorization boundary/);
  assert.match(builtIn, /comment\s+permissions in a trusted backend/);
  assert.doesNotMatch(builtIn, /\b(?:displayMode|readOnly|allowResolve)\b/);
  assert.match(trackedChanges, /allowDecisions: false/);
  assert.match(customUI, /ui\.comments\.createFromCapture/);
  assert.match(customUI, /Live example: replace the comments panel/);
  assert.match(customUI, /ui\.comments\.createFromSelection/);
  assert.match(customUI, /ui\.comments\.setActive/);
  assert.match(customUI, /ui\.comments\.scrollTo/);
  assert.match(customUI, /comments: false/);
  assert.match(customUI, /parentCommentId/);
  assert.match(documentApi, /target: clause\.target/);
  assert.match(documentApi, /parentCommentId: createReceipt\.id/);
  assert.match(documentApi, /expectedRevision: afterReply\.evaluatedRevision/);
  assert.doesNotMatch(builtIn, /<include>/);
  assert.doesNotMatch(builtIn, /<CommentsConfigReference\b/);
  assert.doesNotMatch(customUI, /<include>/);
  assert.doesNotMatch(customUI, /<CustomCommentsDemo\b/);
  assert.doesNotMatch(documentApi, /<include>/);
});

test('exports the custom selection and viewport workflow as clean Markdown', async () => {
  const markdown = await readFile(
    new URL('../out/md/editor/custom-ui/selection-and-viewport.md', import.meta.url),
    'utf8',
  );

  assert.match(markdown, /nextCapture = ui\.selection\.capture\(\)/);
  assert.match(markdown, /ui\.viewport\.getRect\(\{ target, relativeTo: editorShell \}\)/);
  assert.match(markdown, /ui\.viewport\.observe\(positionPrompt\)/);
  assert.match(markdown, /ui\.selection\.restore\(capture\)/);
  assert.match(markdown, /context: currentCapture\.quotedText/);
  assert.match(markdown, /POST \/api\/selection-prompt/);
  assert.match(markdown, /Do not cache rectangle coordinates as document identity/);
  assert.match(markdown, /Live example: ask AI about selected document text/);
  assert.match(markdown, /demo response is local: no text is sent to a model/i);
  assert.doesNotMatch(markdown, /<include>/);
  assert.doesNotMatch(markdown, /<CustomSelectionDemo\b/);
});

test('exports the selection reference separately from the prompt tutorial', async () => {
  const tutorial = await readFile(new URL('../out/md/editor/custom-ui/selection-and-viewport.md', import.meta.url), 'utf8');
  const reference = await readFile(new URL('../out/md/editor/custom-ui/selection-reference.md', import.meta.url), 'utf8');
  assert.match(tutorial, /\/editor\/custom-ui\/selection-reference/);
  assert.doesNotMatch(tutorial, /## Resolve entities under a point/);
  assert.match(reference, /ui\.viewport\.entityAt\(\{ x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(reference, /removeEventListener/);
  assert.match(reference, /Only tracked-change hits carry it/);
});

test('exports built-in and custom search without duplicating Document API queries', async () => {
  const [article, builtIn] = await Promise.all([
    readFile(new URL('../out/editor/built-in-ui/search-and-replace/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/built-in-ui/search-and-replace.md', import.meta.url), 'utf8'),
  ]);
  const customUI = await readFile(new URL('../out/md/editor/custom-ui/search.md', import.meta.url), 'utf8');

  assert.match(article, /id="search-config"/);
  assert.match(article, /data-config-explorer="true"/);
  assert.match(article, /Position &amp; size/);
  assert.match(article, /Accessibility/);
  assert.match(article, /34(?:<!-- -->|\s)+fields(?:<!-- -->|\s)+· generated from <code>SearchConfig<\/code>/);
  assert.match(builtIn, /search: true/);
  assert.match(builtIn, /browser keeps its native page search shortcut/);
  assert.match(builtIn, /\*\*React — `src\/App\.tsx`\*\*/);
  assert.match(builtIn, /Search remains available in Viewing, but replace controls are hidden/);
  assert.match(builtIn, /Mode — `documentMode`/);
  assert.match(builtIn, /Replace controls — `ui\.search\.replaceControls`/);
  assert.match(builtIn, /Tracked deletions — `ui\.search\.includeTrackedDeletions`/);
  assert.match(builtIn, /eight case-insensitive `Client` matches/);
  assert.match(builtIn, /seven case-sensitive matches/);
  assert.match(builtIn, /`Legacy` has zero matches when tracked deletions are excluded and one when they are included/);
  assert.match(builtIn, /Changing a Search startup option recreates the Editor from its current DOCX/);
  assert.match(builtIn, /\| `replaceControls` \| `boolean` \| `true` \|/);
  assert.match(builtIn, /\| `floating\.closeOnOutsidePointerDown` \|/);
  assert.match(builtIn, /\| `strings\.invalidPattern` \|/);
  assert.doesNotMatch(builtIn, /\b(?:replaceEnabled|includeDeletedText)\b/);
  assert.doesNotMatch(builtIn, /<SearchConfigReference\b/);
  assert.match(customUI, /search\.find\(query\.value/);
  assert.match(customUI, /superdoc\.ui\.search\.find\('Legacy'/);
  assert.match(customUI, /search\.observe\(render\)/);
  assert.match(customUI, /runReplacement\(\(\) => search\.replaceAll\(replacement\.value\)\)/);
  assert.match(customUI, /\[Document API queries\]\(\/document-api\/query-content\)/);
  assert.doesNotMatch(builtIn, /<include>/);
  assert.doesNotMatch(customUI, /<include>/);
});

test('exports the remaining built-in UI workflows as clean Markdown', async () => {
  const [hyperlinks, hyperlinksArticle] = await Promise.all([
    readFile(new URL('../out/md/editor/built-in-ui/hyperlinks.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/editor/built-in-ui/hyperlinks/index.html', import.meta.url), 'utf8'),
  ]);
  const [contextMenu, contextMenuArticle] = await Promise.all([
    readFile(new URL('../out/md/editor/built-in-ui/context-menus.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/editor/built-in-ui/context-menus/index.html', import.meta.url), 'utf8'),
  ]);
  const contentControls = await readFile(
    new URL('../out/md/editor/built-in-ui/content-controls.md', import.meta.url),
    'utf8',
  );
  const responsive = await readFile(
    new URL('../out/md/editor/built-in-ui/responsive-layout.md', import.meta.url),
    'utf8',
  );
  const loading = await readFile(new URL('../out/md/editor/built-in-ui/loading.md', import.meta.url), 'utf8');

  assert.match(hyperlinks, /hyperlinks-sample\.docx/);
  assert.match(hyperlinks, /HyperlinkActivationHandler/);
  assert.match(hyperlinks, /hyperlinks: \{\s+onActivate: handleHyperlinkActivation/s);
  assert.match(hyperlinks, /Custom action — `hyperlinks\.onActivate`/);
  assert.match(hyperlinks, /\| `onActivate` \|/);
  assert.match(hyperlinks, /type: 'suppress'/);
  assert.match(hyperlinksArticle, /id="hyperlinks-config"/);
  assert.match(
    hyperlinksArticle,
    /1(?:<!-- -->|\s)+field(?:<!-- -->|\s)+· generated from <code>HyperlinksConfig<\/code>/,
  );
  assert.match(hyperlinks, /await context\.getDocumentTarget\(\)/);
  assert.match(hyperlinks, /reports the failure through `onException`/);
  assert.match(hyperlinks, /Use \[Custom UI\]\(\/editor\/custom-ui\/overview\)/);
  assert.match(hyperlinks, /\*\*React — `src\/App\.tsx`\*\*/);
  assert.doesNotMatch(hyperlinks, /linkPopover|popoverResolver|closePopover/);
  assert.doesNotMatch(hyperlinks, /<HyperlinksConfigReference\b/);
  assert.match(contextMenu, /context-menu-sample\.docx/);
  assert.match(contextMenu, /satisfies ContextMenuConfig/);
  assert.match(contextMenu, /openOnSlash: false/);
  assert.match(contextMenu, /ui\.contextMenu\.open\(\)/);
  assert.match(contextMenu, /ui\.contextMenu\.close\(\)/);
  assert.match(contextMenu, /Send selection to workflow/);
  assert.match(contextMenu, /ui\.contextMenu/);
  assert.match(contextMenu, /trigger === 'click' && hasSelection/);
  assert.match(contextMenu, /context\.selectedTextSettled/);
  assert.match(contextMenu, /\| `openOnSlash` \|/);
  assert.match(contextMenu, /\| `sections` \|/);
  assert.match(contextMenu, /\| `defaultItems` \|/);
  assert.match(contextMenu, /\| `menuProvider` \|/);
  assert.match(contextMenuArticle, /id="context-menu-config"/);
  assert.match(
    contextMenuArticle,
    /4(?:<!-- -->|\s)+fields(?:<!-- -->|\s)+· generated from <code>ContextMenuConfig<\/code>/,
  );
  assert.doesNotMatch(contextMenu, /\b(?:customItems|includeDefaultItems)\b/);
  assert.doesNotMatch(contextMenu, /<ContextMenuConfigReference\b/);
  assert.match(contextMenu, /\*\*React — `src\/App\.tsx`\*\*/);
  assert.match(contentControls, /content-controls-sample\.docx/);
  assert.match(contentControls, /contentControls: true/);
  assert.match(contentControls, /onContentControlClick/);
  assert.match(contentControls, /Built-in chrome — `ui\.contentControls`/);
  assert.match(contentControls, /The controls remain in the DOCX/);
  assert.match(contentControls, /\*\*React — `src\/App\.tsx`\*\*/);
  assert.doesNotMatch(contentControls, /\b(?:modules\.contentControls|chrome: 'default'|handleImageUpload)\b/);
  assert.match(responsive, /mode: 'fit-width'/);
  assert.match(responsive, /const viewOptions = \{ layout: 'web' \}/);
  assert.match(responsive, /Text wraps to the host width/);
  assert.match(responsive, /fullscreenchange/);
  assert.match(responsive, /Avoid nesting the Editor inside another horizontal scroller/);
  assert.match(loading, /Built-in overlay — `ui\.loading`/);
  assert.match(loading, /\| `loading` \| `boolean` \| `true` \|/);
  assert.doesNotMatch(loading, /<LoadingConfigReference\b/);
  assert.match(loading, /Replay loading/);
  assert.match(loading, /renderLoading/);
  assert.match(loading, /Could not open the document\./);
  assert.match(loading, /onContentError/);
  assert.match(loading, /ui: \{ loading: false \}/);
  assert.match(loading, /await superdoc\.replaceFile\(file\)/);
  assert.match(loading, /state === 'editing-ready'/);
  assert.match(loading, /onException/);
  assert.match(loading, /Could not open the document\. Reload the page to retry\./);
  assert.doesNotMatch(`${hyperlinks}\n${contextMenu}\n${contentControls}\n${responsive}\n${loading}`, /<include>/);
});

test('exports the Ruler guide with its interactive behavior and generated reference', async () => {
  const [article, markdown] = await Promise.all([
    readFile(new URL('../out/editor/built-in-ui/ruler/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/built-in-ui/ruler.md', import.meta.url), 'utf8'),
  ]);

  assert.match(article, /data-preset="ruler"/);
  assert.match(article, /ruler-sample\.docx/);
  assert.match(article, /id="ruler-config"/);
  assert.match(article, /data-config-explorer="true"/);
  assert.match(markdown, /Ruler controls available in the interactive Editor/);
  assert.match(markdown, /Click in the document to activate a section/);
  assert.match(markdown, /Measurements — `measurementUnit`/);
  assert.match(markdown, /\| `ui\.ruler` \|/);
  assert.match(markdown, /\| `measurementUnit` \|/);
  assert.match(markdown, /\| `onPageMarginsChange` \|/);
  assert.doesNotMatch(markdown, /<RulerConfigReference\b/);
  assert.doesNotMatch(markdown, /<EditorDemo\b/);
  assert.doesNotMatch(markdown, /<include>/);
});

test('exports the redistributed Editor guidance as clean Markdown', async () => {
  const paths = [
    'configuration',
    'lifecycle-and-events',
    'load-and-save-documents',
    'dialogs-and-surfaces',
    'theming',
    'platform/proofing',
    'accessibility',
    'secure-integration',
  ];
  const pages = await Promise.all(
    paths.map((path) => readFile(new URL(`../out/md/editor/${path}.md`, import.meta.url), 'utf8')),
  );
  const corpus = pages.join('\n');

  assert.match(corpus, /satisfies Partial<Config>/);
  assert.match(corpus, /onEditorUpdate:[\s\S]*export function unmountEditor\(\)[\s\S]*superdoc\.destroy\(\)/);
  assert.match(corpus, /Interactive model: the Editor lifecycle in your application/);
  assert.match(corpus, /Show a retry path instead of an empty mount point/);
  assert.match(corpus, /triggerDownload: false/);
  assert.match(corpus, /await handle\.result/);
  assert.match(corpus, /document\.documentElement\.classList\.add\(themeClass\)/);
  assert.match(corpus, /If the provider uses a network, document text leaves the browser/);
  assert.match(corpus, /Accessibility remains a shared responsibility/);
  assert.match(corpus, /client code a trusted authorization boundary/);
  assert.doesNotMatch(corpus, /<include>/);
});

test('exports storage, version, and configuration guidance for the v2 Editor', async () => {
  const [loadAndSave, exportOptions, configuration, telemetry, license, versionHistory] = await Promise.all([
    readFile(new URL('../out/md/editor/load-and-save-documents.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/export-options.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/configuration.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/telemetry.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/license.md', import.meta.url), 'utf8'),
    readFile(new URL('../out/md/editor/version-history.md', import.meta.url), 'utf8'),
  ]);

  assert.match(loadAndSave, /const endpoint = '\/api\/documents\/sample'/);
  assert.match(loadAndSave, /The Quickstart does not create this endpoint/u);
  assert.match(loadAndSave, /return a success status after the write finishes/u);
  assert.match(loadAndSave, /triggerDownload: false[\s\S]*method: 'PUT'/);
  assert.match(loadAndSave, /show \*\*Saved\*\* only after the `PUT` succeeds/u);
  assert.match(loadAndSave, /\[Choose your interface\]\(\/editor\/who-renders-the-ui\)/u);
  assert.match(versionHistory, /each save creates a new snapshot instead of overwriting the previous file/u);
  assert.match(versionHistory, /x-base-version-id/u);
  assert.match(versionHistory, /Return `409 Conflict` if another tab or user saved first/u);
  assert.match(versionHistory, /Bytes the Editor cannot\s+open never become current/u);
  assert.match(versionHistory, /restores the document that was open before the attempt/u);
  assert.match(versionHistory, /Restoring Version 1 should create Version 3/u);
  assert.match(exportOptions, /set it to `false` to return a `Blob` or ZIP/);
  assert.match(exportOptions, /does not apply `isFinalDoc`/);
  assert.doesNotMatch(exportOptions, /isFinalDoc: true/);
  assert.match(configuration, /structured document carrying `collaboration`/);
  assert.doesNotMatch(configuration, /`modules` configures[^\n]*collaboration/);
  assert.match(telemetry, /new SuperDoc\([\s\S]*telemetry: \{/);
  assert.match(license, /licenseKey: import\.meta\.env\.VITE_SUPERDOC_LICENSE_KEY/);
  assert.match(license, /not a secret or an authorization credential/);
});

test('exports the telemetry privacy boundary', async () => {
  const telemetry = await readFile(new URL('../out/md/editor/telemetry.md', import.meta.url), 'utf8');

  assert.match(
    telemetry,
    /"superdocVersion"[\s\S]*"browserInfo"[\s\S]*"metadata"[\s\S]*"events": \[[\s\S]*"timestamp"[\s\S]*"documentId"[\s\S]*"documentCreatedAt"/u,
  );
  assert.match(telemetry, /does not include the page path, query string, fragment, or document content/u);
  assert.match(telemetry, /allow the Editor page's origin/u);
  assert.doesNotMatch(telemetry, /current URL/u);
});

test('exports every generated Document API reference route', async () => {
  const model = JSON.parse(
    await readFile(new URL('../generated/document-api-reference.json', import.meta.url), 'utf8'),
  );
  const paths = [
    ...model.groups.map((group) => group.path),
    ...Object.values(model.operations).map((operation) => operation.path),
  ];

  for (const path of paths) {
    const route = path.endsWith('/index') ? path.slice(0, -'/index'.length) : path;
    const html = await stat(new URL(`../out/document-api/reference/${route}/index.html`, import.meta.url));
    const markdown = await stat(new URL(`../out/md/document-api/reference/${route}.md`, import.meta.url));
    assert.ok(html.size > 0, route);
    assert.ok(markdown.size > 0, route);
  }
});

test('renders input fields for every operation with a non-empty input schema', async () => {
  const model = JSON.parse(
    await readFile(new URL('../generated/document-api-reference.json', import.meta.url), 'utf8'),
  );
  const incorrectPages = [];

  for (const operation of Object.values(model.operations)) {
    if (!schemaAcceptsInput(operation.schemas.input, model.definitions)) continue;
    const route = operation.path.endsWith('/index') ? operation.path.slice(0, -'/index'.length) : operation.path;
    const html = await readFile(new URL(`../out/document-api/reference/${route}/index.html`, import.meta.url), 'utf8');
    if (html.includes('This operation takes no input fields.')) incorrectPages.push(operation.operationId);
  }

  assert.deepEqual(incorrectPages, []);
});

test('exports the searchable reference experience from contract data', async () => {
  const model = JSON.parse(
    await readFile(new URL('../generated/document-api-reference.json', import.meta.url), 'utf8'),
  );
  const landing = await readFile(new URL('../out/document-api/reference/index.html', import.meta.url), 'utf8');
  const namespace = await readFile(
    new URL('../out/document-api/reference/content-controls/index.html', import.meta.url),
    'utf8',
  );
  const operation = await readFile(
    new URL('../out/document-api/reference/query/match/index.html', import.meta.url),
    'utf8',
  );
  const landingText = landing.replaceAll('<!-- -->', '');
  const namespaceText = namespace.replaceAll('<!-- -->', '');
  const operationText = operation.replaceAll('<!-- -->', '');

  assert.ok(
    landingText.includes(`Search all ${Object.keys(model.operations).length} operations in contract ${model.contractVersion}`),
  );
  assert.match(landing, /blocks\.findText/);
  assert.match(landing, /Search operation names, paths, and descriptions/);
  assert.match(landing, /contentControls/);
  assert.match(namespaceText, /55 operations/);
  assert.match(namespace, /contentControls\.move/);
  assert.match(namespace, /contentControls\.replaceContent/);
  assert.match(namespace, /tracked/);
  assert.match(operationText, /Typechecked example/);
  assert.match(operationText, /Runtime validation is tracked separately/);
  assert.match(operationText, /additional input fields/);
  assert.match(operationText, /evaluatedRevision/);
  assert.match(operationText, /MATCH_NOT_FOUND/);
  assert.match(operationText, /AMBIGUOUS_MATCH/);
  assert.match(operationText, /Query content guide/);
  assert.match(operationText, /View raw JSON schemas/);
  assert.doesNotMatch(operationText, /fixture-backed|Example request|block-abc123/);

  const rawSchemas = JSON.parse(
    await readFile(new URL('../out/reference/document-api/query/match.json', import.meta.url), 'utf8'),
  );
  assert.equal(rawSchemas.operationId, 'query.match');
  assert.equal(rawSchemas.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(rawSchemas.$defs.SelectionTarget);
  assert.ok(rawSchemas.schemas.input);
  assert.ok(rawSchemas.schemas.output);
});

test('exports exact reference Markdown separately from the guide corpus', async () => {
  const operation = await readFile(new URL('../out/md/document-api/reference/query/match.md', import.meta.url), 'utf8');
  const fullGuides = await readFile(new URL('../out/llms-full.txt', import.meta.url), 'utf8');
  const fullReference = await readFile(new URL('../out/llms-reference.txt', import.meta.url), 'utf8');

  assert.match(operation, /^# query\.match/m);
  assert.match(operation, /\*\*Typechecked example:\*\*/);
  assert.match(operation, /"evaluatedRevision"/);
  assert.match(operation, /`MATCH_NOT_FOUND`/);
  assert.doesNotMatch(operation, /<DocumentApiOperation|<include>/);
  for (const heading of ['Input', 'Output']) {
    const schemaJson = operation.match(
      new RegExp('## ' + heading + ' schema\\n\\n```json\\n([\\s\\S]*?)\\n```', 'u'),
    )?.[1];
    assert.ok(schemaJson);
    const schema = JSON.parse(schemaJson);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    const references = [...JSON.stringify(schema).matchAll(/"#\/\$defs\/([^"]+)"/gu)].map((match) => match[1]);
    assert.deepEqual(
      references.filter((reference) => !Object.hasOwn(schema.$defs, reference)),
      [],
    );
  }
  assert.doesNotMatch(fullGuides, /^## query\.match$/m);
  assert.doesNotMatch(fullGuides, /^# Document API reference$/m);
  assert.match(fullReference, /^## query\.match$/m);
  assert.match(fullReference, /^### Expected result$/m);
  assert.doesNotMatch(fullReference, /^## Expected result$/m);
  assert.match(fullReference, /^## contentControls\.replaceContent$/m);
});

test('exports the machine-readable documentation files', async () => {
  const llmsIndex = await readFile(new URL('../out/llms.txt', import.meta.url), 'utf8');
  const fullCorpus = await readFile(new URL('../out/llms-full.txt', import.meta.url), 'utf8');
  const editorMarkdown = await readFile(new URL('../out/md/editor/quickstart.md', import.meta.url), 'utf8');
  const surfacesMarkdown = await readFile(
    new URL('../out/md/resources/how-superdoc-works.md', import.meta.url),
    'utf8',
  );
  const modesMarkdown = await readFile(new URL('../out/md/editor/document-modes.md', import.meta.url), 'utf8');
  const interfaceMarkdown = await readFile(
    new URL('../out/md/editor/who-renders-the-ui.md', import.meta.url),
    'utf8',
  );
  const customUISetupMarkdown = await readFile(
    new URL('../out/md/editor/custom-ui/controller-setup.md', import.meta.url),
    'utf8',
  );
  const migrationMarkdown = await readFile(
    new URL('../out/md/editor/migrate-from-v1/overview.md', import.meta.url),
    'utf8',
  );
  const queryMarkdown = await readFile(new URL('../out/md/document-api/query-content.md', import.meta.url), 'utf8');
  const mutationMarkdown = await readFile(
    new URL('../out/md/document-api/replace-delete-content.md', import.meta.url),
    'utf8',
  );
  const receiptsMarkdown = await readFile(
    new URL('../out/md/document-api/receipts-and-errors.md', import.meta.url),
    'utf8',
  );
  const trackedChangesMarkdown = await readFile(
    new URL('../out/md/document-api/tracked-changes.md', import.meta.url),
    'utf8',
  );
  const mutationPlansMarkdown = await readFile(
    new URL('../out/md/document-api/mutation-plans.md', import.meta.url),
    'utf8',
  );
  const reviewMarkdown = await readFile(
    new URL('../out/md/agents/workflows/review-tracked-changes.md', import.meta.url),
    'utf8',
  );
  const agentsOverviewMarkdown = await readFile(new URL('../out/md/agents/overview.md', import.meta.url), 'utf8');

  assert.match(llmsIndex, /^# SuperDoc/m);
  assert.match(llmsIndex, /\[Guide corpus\]\(\/llms-full\.txt\)/);
  assert.match(llmsIndex, /\[Document API reference corpus\]\(\/llms-reference\.txt\)/);
  assert.match(llmsIndex, /Prefer focused reference pages/);
  assert.match(fullCorpus, /^# Open and edit your first DOCX/m);
  assert.match(editorMarkdown, /^# Open and edit your first DOCX/m);
  assert.match(editorMarkdown, /\[Download the sample document\]\(\/fixtures\/getting-started\.docx\)/);
  assert.match(editorMarkdown, /`onReady` enables \*\*Export DOCX\*\*/);
  assert.match(surfacesMarkdown, /^# How SuperDoc works/m);
  assert.match(surfacesMarkdown, /> \*\*Diagram:\*\* People, services, CI, and agents use different SuperDoc surfaces/);
  assert.match(
    surfacesMarkdown,
    /Headless code does not have a toolbar, viewport, DOM selection, or visual review surface/,
  );
  assert.match(surfacesMarkdown, /The Document API is an operation contract, not another runtime/);
  assert.match(modesMarkdown, /^# Choose a document mode/m);
  assert.match(modesMarkdown, /Modes change Editor behavior in the browser/);
  assert.doesNotMatch(modesMarkdown, /<Callout\b/);
  assert.match(interfaceMarkdown, /^# Choose your interface/m);
  assert.match(interfaceMarkdown, /SuperDoc renders the DOCX canvas in every approach/);
  assert.match(interfaceMarkdown, /Interactive comparison: who renders the interface/);
  assert.match(interfaceMarkdown, /your application renders comments through `superdoc\.ui\.comments`/);
  assert.match(interfaceMarkdown, /A partial `ui` object changes only the surfaces it names/);
  assert.doesNotMatch(interfaceMarkdown, /<Callout\b/);
  assert.match(customUISetupMarkdown, /^# Build your first custom control/m);
  assert.match(customUISetupMarkdown, /SuperDocUIProvider/);
  assert.match(customUISetupMarkdown, /await bold\.executeAsync\(\)/);
  assert.doesNotMatch(customUISetupMarkdown, /<include>/);
  assert.match(migrationMarkdown, /^# Migrate from v1/m);
  assert.match(migrationMarkdown, /Do not connect a v2 editor[\s>]+directly to an existing v1 collaboration room/);
  assert.match(migrationMarkdown, /superdoc\/ui\/react/);
  assert.doesNotMatch(migrationMarkdown, /<Callout\b/);
  assert.match(queryMarkdown, /^# Query document content/m);
  assert.match(queryMarkdown, /> \*\*Diagram:\*\* Highlighted text in a DOCX becomes query result items/);
  assert.match(queryMarkdown, /evaluatedRevision/);
  assert.doesNotMatch(queryMarkdown, /<Callout\b/);
  assert.match(mutationMarkdown, /^# Replace and delete content/m);
  assert.match(mutationMarkdown, /expectedRevision: companyMatch\.evaluatedRevision/);
  assert.match(mutationMarkdown, /behavior: 'exact'/);
  assert.doesNotMatch(mutationMarkdown, /<Callout\b/);
  assert.match(receiptsMarkdown, /^# Receipts and errors/m);
  assert.match(receiptsMarkdown, /> \*\*Diagram:\*\* A successful mutation continues/);
  assert.match(receiptsMarkdown, /REVISION_MISMATCH/);
  assert.match(receiptsMarkdown, /Do not log full document contents/);
  assert.doesNotMatch(receiptsMarkdown, /<Callout\b/);
  assert.match(trackedChangesMarkdown, /^# Work with tracked changes/m);
  assert.match(trackedChangesMarkdown, /\[Review tracked changes\]\(\/editor\/track-changes\)/);
  assert.match(trackedChangesMarkdown, /target: \{ kind: 'id', id: detail\.id \}/);
  assert.match(trackedChangesMarkdown, /A review decision resolves an existing change/);
  assert.doesNotMatch(trackedChangesMarkdown, /<EditorDemo\b/);
  assert.match(mutationPlansMarkdown, /^# Preview and apply mutation plans/m);
  assert.match(mutationPlansMarkdown, /const preview = await doc\.mutations\.preview\(plan\)/);
  assert.match(mutationPlansMarkdown, /const receipt = await doc\.mutations\.apply\(plan\)/);
  assert.match(mutationPlansMarkdown, /> \*\*Diagram:\*\* Two query references become one atomic plan/);
  assert.doesNotMatch(mutationPlansMarkdown, /<include>/);
  assert.match(reviewMarkdown, /^# Review tracked changes/m);
  assert.match(reviewMarkdown, /changeMode: 'tracked'/);
  assert.match(reviewMarkdown, /The documentation site does not upload it/);
  assert.match(agentsOverviewMarkdown, /^# Overview/m);
  assert.match(agentsOverviewMarkdown, /@superdoc\/sdk/);
  assert.doesNotMatch(agentsOverviewMarkdown, /\bMCP\b/u);
  assert.match(agentsOverviewMarkdown, /Do not import `@superdoc\/headless`/);
  assert.match(agentsOverviewMarkdown, /no toolbar, document canvas, viewport/);
});

test('collaboration introduces shared editing before setup and persistence', async () => {
  const overview = await readFile(new URL('../out/md/editor/collaboration.md', import.meta.url), 'utf8');
  const guide = await readFile(new URL('../out/md/editor/collaboration/connect-two-editors.md', import.meta.url), 'utf8');

  const server = await readFile(new URL('../out/md/editor/collaboration/run-a-server.md', import.meta.url), 'utf8');
  assert.match(overview, /Illustration: two editors, one shared document/);
  assert.match(overview, /Alex changes the delivery date to Friday/);
  assert.doesNotMatch(overview, /Y\.Doc|roomMode|onCollaborationReady|<CollaborationOverview/);
  assert.match(server, /Save and restore a room/);
  assert.match(guide, /mode=create&user=Alex/);
  assert.match(guide, /DocumentCollaborationConfig/);
  assert.match(guide, /document: \{ url: '\/sample.docx', collaboration \}/);
  assert.match(guide, /Preview API/);
  assert.doesNotMatch(guide, /v2Collaboration|V2CollaborationConfig/);
  assert.match(guide, /onCollaborationReady/);
  assert.match(guide, /Now type a reply in Sam's editor/);
  assert.match(guide, /Live collaboration demo/);
  assert.match(guide, /Call `destroy\(\)` when your owning route or component unmounts/);
  assert.doesNotMatch(guide, /Use another provider|Export DOCX|Yjs update bytes/);
  assert.doesNotMatch(guide, /<include>/);
});

test('presence exports the working example and the local-user boundary', async () => {
  const page = await readFile(new URL('../out/md/editor/collaboration/presence-and-awareness.md', import.meta.url), 'utf8');
  assert.match(page, /Live presence demo/);
  assert.match(page, /includes the current user/);
  assert.match(page, /SuperDocAwarenessUpdatePayload/);
  assert.match(page, /list\.replaceChildren\(\.\.\.items\)/);
  assert.match(page, /his edits remain/);
  assert.doesNotMatch(page, /<CollaborationDemo|<include>/);
});

test('initialization explains create, join, and reopening without promising persistence', async () => {
  const page = await readFile(new URL('../out/md/editor/collaboration/initialize-a-document.md', import.meta.url), 'utf8');
  assert.match(page, /Create once, then join/);
  assert.match(page, /roomMode: 'create'/);
  assert.match(page, /roomMode: 'join'/);
  assert.match(page, /including the creator/);
  assert.match(page, /does not prove durable saving/);
  assert.match(page, /Node.js SDK/);
});

test('persistence exports storage hooks and distinguishes room state from files', async () => {
  const page = await readFile(new URL('../out/md/editor/collaboration/save-and-restore-a-room.md', import.meta.url), 'utf8');
  assert.match(page, /Saving only DOCX snapshots does not persist the Yjs room/);
  assert.match(page, /not a storage acknowledgment/);
  assert.match(page, /COLLABORATION_STORAGE_DIR/);
  assert.match(page, /encodeStateAsUpdate/);
  assert.match(page, /applyUpdate/);
  assert.match(page, /power-loss durability/);
  assert.doesNotMatch(page, /<include>/);
});

test('room access keeps public fixtures distinct from production identity', async () => {
  const page = await readFile(new URL('../out/md/editor/collaboration/control-room-access.md', import.meta.url), 'utf8');
  assert.match(page, /Live access demo/);
  assert.match(page, /only after server confirmation/);
  assert.match(page, /Public test credentials only/);
  assert.match(page, /session\.rooms\.includes\(documentName\)/);
  assert.match(page, /sd2\/v2\.1\/example-room/);
  assert.match(page, /document.collaboration.token/);
  assert.match(page, /'collaborationReason' in failure/);
  assert.match(page, /case 'access-denied'/);
  assert.match(page, /case 'sync-timeout'/);
  assert.match(page, /does not implement separate create, read-only, or edit roles/);
  assert.match(page, /does not secure separate file endpoints/);
  assert.doesNotMatch(page, /<CollaborationDemo|<include>/);
});

test('exports the Cloudflare Pages configuration', async () => {
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const headers = await readFile(new URL('../out/_headers', import.meta.url), 'utf8');
  const redirects = await readFile(new URL('../out/_redirects', import.meta.url), 'utf8');
  const editorRuntime = JSON.parse(
    await readFile(new URL('../config/editor-demo-runtime.json', import.meta.url), 'utf8'),
  );
  const contentSecurityPolicy = headers.match(/Content-Security-Policy: ([^\n]+)/u)?.[1];
  assert.ok(contentSecurityPolicy, 'The exported headers must include a Content-Security-Policy.');
  const directives = contentSecurityPolicy.split(';').map((directive) => directive.trim());
  const directiveSources = (name) =>
    directives
      .find((directive) => directive.startsWith(`${name} `))
      ?.split(/\s+/u)
      .slice(1) ?? [];
  const workerDirective = directives.find((directive) => directive.startsWith('worker-src '));
  const workerSources = workerDirective?.split(/\s+/u).slice(1) ?? [];
  const imageSources = directiveSources('img-src');
  const scriptSources = directiveSources('script-src').filter((source) => source.startsWith('https://'));
  const styleSources = directiveSources('style-src').filter((source) => source.startsWith('https://'));
  const connectSources = directiveSources('connect-src').filter((source) => source.startsWith('https://'));
  const runtimeSource = `${editorRuntime.cdnOrigin}/${editorRuntime.runtimePackage}@${editorRuntime.runtimeVersion}/`;
  const engineSource = `${editorRuntime.cdnOrigin}/${editorRuntime.enginePackage}@${editorRuntime.engineVersion}/dist-cdn/`;
  const engineWorkerSource = `${editorRuntime.cdnOrigin}/${editorRuntime.enginePackage}@${editorRuntime.engineVersion}/dist-cdn/assets/`;
  const externalWorkerSources = workerSources.filter((source) => source.startsWith('https://'));

  assert.match(config, /"pages_build_output_dir": "\.\/out"/u);
  assert.match(config, /"compatibility_date": "\d{4}-\d{2}-\d{2}"/u);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.deepEqual(scriptSources, [runtimeSource, engineSource, 'https://www.googletagmanager.com']);
  assert.deepEqual(styleSources, [runtimeSource, engineSource]);
  assert.deepEqual(connectSources, [
    engineSource,
    'https://api.github.com',
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://www.googletagmanager.com',
  ]);
  assert.ok(workerSources.includes("'self'"));
  assert.ok(workerSources.includes('blob:'));
  assert.deepEqual(externalWorkerSources, [engineWorkerSource]);
  assert.ok(imageSources.includes('blob:'));
  assert.ok(imageSources.includes('https://*.google-analytics.com'));
  assert.ok(imageSources.includes('https://www.googletagmanager.com'));
  assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
  // The documentation home is the site root now, so there is no landing
  // redirect to assert. What the file must contain is the V1 route rules.
  assert.match(redirects, /^\/getting-started\/quickstart \/editor\/quickstart\/ 301$/mu);
  assert.match(redirects, /^\/modules\/\* https:\/\/docs-v1\.superdoc\.dev\/editor\/built-in-ui\/:splat 302$/mu);
});

test('exports clean Markdown across the machine-readable corpus', async () => {
  const markdownRoot = new URL('../out/md/', import.meta.url);
  const markdownFiles = await collectFiles(markdownRoot, '.md');
  const fullCorpusUrl = new URL('../out/llms-full.txt', import.meta.url);
  const outputs = [...markdownFiles, fullCorpusUrl];
  const contentFiles = await collectFiles(new URL('../content/docs/', import.meta.url), '.mdx');
  const componentNames = new Set();

  for (const contentFile of contentFiles) {
    const source = withoutFencedCode(await readFile(contentFile, 'utf8'));
    for (const match of source.matchAll(/<([A-Z][A-Za-z0-9]*)\b/gu)) componentNames.add(match[1]);
  }

  componentNames.delete('DocsHome');
  const unresolvedComponent = new RegExp(`</?(?:${[...componentNames, 'img'].join('|')})\\b`, 'u');

  for (const output of outputs) {
    const markdown = await readFile(output, 'utf8');
    const prose = withoutFencedCode(markdown);

    assert.doesNotMatch(prose, /__img\d+/u, output.pathname);
    assert.doesNotMatch(prose, /\0/u, output.pathname);
    assert.doesNotMatch(prose, unresolvedComponent, output.pathname);
  }

  const mentalModel = await readFile(new URL('../out/md/document-api/mental-model.md', import.meta.url), 'utf8');
  const reviewWorkflow = await readFile(
    new URL('../out/md/agents/workflows/review-tracked-changes.md', import.meta.url),
    'utf8',
  );

  assert.match(mentalModel, /^### Browser$/m);
  assert.match(mentalModel, /\[Mount an editor\]\(\/editor\/quickstart\)/);
  assert.match(mentalModel, /^- \[Run a headless operation\]/m);
  assert.match(reviewWorkflow, /\[Download the tracked-changes fixture\]\(\/fixtures\/tracked-changes\.docx\)/);
  assert.match(reviewWorkflow, /Local DOCX selection: enabled\. Files remain in the browser\./);

  const productOverview = await readFile(new URL('../out/md/resources/how-superdoc-works.md', import.meta.url), 'utf8');
  assert.match(productOverview, /Interactive editor: Try SuperDoc in the browser/);
  assert.match(productOverview, /Tracked-change review: accept or reject the sample change\./);
});

/**
 * AIDEV-NOTE: The agent-facing corpus must be plain Markdown. Two classes of
 * MDX have leaked into it before:
 *
 *   - Author comments. `{/* Generated by scripts/... *\/}` is a note to whoever
 *     edits the page. An agent reading `/md/...` has no use for it, and it is
 *     not Markdown. Stripped by `stripMdxComments` in lib/llm-markdown.ts.
 *   - Component tags. A component rendered on the page but missing from
 *     `llmPlaceholderComponents` passes through as a literal `<Tag />`.
 *
 * Both were caught by reading output rather than by a test. This checks the
 * whole corpus, so the next one fails in CI instead.
 */
test('agent-facing Markdown contains no raw MDX', async () => {
  const files = await collectFiles(new URL('../out/md/', import.meta.url), '.md');
  assert.ok(files.length > 0, 'no exported Markdown found; the build must run before this test');

  const offenders = [];
  for (const file of files) {
    // Fenced code legitimately contains JSX: the custom-UI guides show React.
    const prose = withoutFencedCode(await readFile(file, 'utf8'));
    const route = file.pathname.split('/out/md/')[1];

    for (const [, comment] of prose.matchAll(/(\{\/\*[\s\S]*?\*\/\})/g)) {
      offenders.push(`${route}: MDX comment ${comment.slice(0, 60)}`);
    }
    for (const [, tag] of prose.matchAll(/(?:^|\n)\s*<([A-Z][A-Za-z0-9]*)[\s/>]/g)) {
      offenders.push(`${route}: unrendered <${tag}>, add it to llmPlaceholderComponents`);
    }
  }

  assert.deepEqual(offenders, []);
});

/**
 * AIDEV-NOTE: A placeholder that emits a heading silently inverts the outline.
 * `MigrationExample` rendered `### V2` beneath `#### getText`, which closed the
 * operation section before its own examples and left all 44 snippets as peers
 * of the API categories in every machine-readable projection.
 *
 * Checks the property directly: a placeholder's output belongs INSIDE the
 * section it was written under, so it must not out-rank the nearest heading
 * above it in the source MDX. An earlier version of this test guessed at the
 * shape from the exported Markdown alone and could not tell a real `###`
 * section from an injected one.
 */
test('component placeholders do not out-rank their source heading', async () => {
  const pages = await collectFiles(new URL('../content/docs/', import.meta.url), '.mdx');
  const offenders = [];

  for (const page of pages) {
    const route = page.pathname.split('/content/docs/')[1].replace(/\.mdx$/u, '');
    const exported = new URL(`../out/md/${route}.md`, import.meta.url);

    let markdown;
    try {
      markdown = withoutFencedCode(await readFile(exported, 'utf8'));
    } catch {
      continue; // Not every content file is a routed page.
    }

    const source = withoutFencedCode(await readFile(page, 'utf8'));
    // The exporter appends a `[#anchor]` slug to every heading, so compare on
    // the text alone. Matching the raw line finds nothing and silently disables
    // this check — which is exactly how an earlier version of it passed while
    // the defect it was written for was present.
    // Also drop Markdown backslash escapes: the exporter escapes `.` and `[`
    // in heading text, so `getSnapshot().pages[index]` comes back as
    // `getSnapshot().pages\[index]` and would read as an unauthored heading.
    const headingText = (text) =>
      text
        .replace(/\s*\[#[^\]]*\]\s*$/u, '')
        .replace(/\\(.)/gu, '$1')
        .trim();

    const sourceHeadings = [...source.matchAll(/^(#{1,6}) (.+)$/gm)].map(([, hashes, text]) => ({
      level: hashes.length,
      text: headingText(text),
    }));

    // Any heading in the export that the author did not write came from a
    // placeholder. It must sit deeper than the section it was rendered inside.
    const authored = new Set(sourceHeadings.map(({ text }) => text));
    let enclosing = 0;
    let sourceIndex = 0;

    for (const [, hashes, rawText] of markdown.matchAll(/^(#{1,6}) (.+)$/gm)) {
      const text = headingText(rawText);
      const level = hashes.length;

      if (authored.has(text)) {
        const match = sourceHeadings.slice(sourceIndex).findIndex((heading) => heading.text === text);
        if (match >= 0) sourceIndex += match + 1;
        enclosing = level;
        continue;
      }

      if (enclosing > 0 && level <= enclosing) {
        offenders.push(`${route}: generated "${text}" is h${level} inside an h${enclosing} section`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

async function collectFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const url = new URL(entry.name, directory);
      if (entry.isDirectory()) return collectFiles(new URL(`${entry.name}/`, directory), extension);
      return entry.name.endsWith(extension) ? [url] : [];
    }),
  );
  return files.flat();
}

function schemaAcceptsInput(schema, definitions, visitedReferences = new Set()) {
  if (typeof schema.$ref === 'string') {
    const reference = schema.$ref.match(/^#\/\$defs\/(.+)$/u)?.[1];
    if (reference && definitions[reference] && !visitedReferences.has(reference)) {
      const nextVisited = new Set(visitedReferences);
      nextVisited.add(reference);
      return schemaAcceptsInput(definitions[reference], definitions, nextVisited);
    }
  }

  if (schema.properties && typeof schema.properties === 'object' && Object.keys(schema.properties).length > 0) {
    return true;
  }

  const variants = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : Array.isArray(schema.allOf)
        ? schema.allOf
        : [];
  if (variants.some((variant) => schemaAcceptsInput(variant, definitions, visitedReferences))) return true;

  return (
    (schema.additionalProperties !== undefined && schema.additionalProperties !== false) ||
    schema.const !== undefined ||
    Array.isArray(schema.enum) ||
    (schema.type !== undefined && schema.type !== 'object')
  );
}

function withoutFencedCode(markdown) {
  const output = [];
  let fence;

  for (const line of markdown.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker && !fence) {
      fence = marker[0];
      continue;
    }
    if (marker && fence === marker[0]) {
      fence = undefined;
      continue;
    }
    if (!fence) output.push(line);
  }

  return output.join('\n');
}

test('exports a recovery page that keeps its 404 status', async () => {
  const notFound = await readFile(new URL('../out/404.html', import.meta.url), 'utf8');

  // Cloudflare Pages serves this file with a real 404. A redirect to the
  // homepage would tell crawlers the URL is fine and hide the broken link from
  // whoever should fix it, so the page must not navigate anywhere on its own.
  assert.doesNotMatch(notFound, /http-equiv="refresh"/iu);
  assert.doesNotMatch(notFound, /window\.location\.(?:replace|assign|href\s*=)/u);

  // A 404 that gets indexed competes with the pages that do exist.
  assert.match(notFound, /noindex/u);

  // The three recovery routes: what V2 has, the V1 archive, and a way to report
  // the link.
  assert.match(notFound, /Page not found/u);
  assert.match(notFound, /v1 archive/u);
  assert.match(notFound, /Report a broken link/u);
  // The repository moved and the old path still redirects, so a stale link here
  // would keep working and never surface as a failure.
  assert.match(notFound, /github\.com\/superdoc\/docx-editor/u);
  assert.doesNotMatch(notFound, /superdoc-dev\/superdoc/u);
});
