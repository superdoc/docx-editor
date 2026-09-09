import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { loader } from 'fumadocs-core/source';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const contentRoot = new URL('../content/docs/', import.meta.url);

test('Editor navigation places setup and accessibility before feature depth', async () => {
  const { pages } = JSON.parse(await readFile(new URL('editor/meta.json', contentRoot), 'utf8'));
  const sectionOf = (page) => {
    const position = pages.indexOf(page);
    assert.notEqual(position, -1, `${page} must remain discoverable`);
    return pages.slice(0, position).findLast((entry) => entry.startsWith('---'));
  };
  assert.ok(!pages.includes('---Production---'));
  for (const page of ['lifecycle-and-events', 'load-and-save-documents', 'export-options']) {
    assert.equal(sectionOf(page), '---Get started---');
  }
  assert.equal(sectionOf('accessibility'), '---Interface---');
  assert.equal(sectionOf('version-history'), '---Features---');
  for (const page of ['performance-and-large-documents', 'secure-integration', 'telemetry', 'license']) {
    assert.equal(sectionOf(page), '---');
  }

  const editorRoot = new URL('editor/', contentRoot);
  const files = [];
  for (const path of await readdir(editorRoot, { recursive: true })) {
    if (path.endsWith('.mdx')) {
      files.push({ type: 'page', path, data: {} });
    } else if (path.endsWith('meta.json')) {
      files.push({ type: 'meta', path, data: JSON.parse(await readFile(new URL(path, editorRoot), 'utf8')) });
    }
  }
  const source = loader({ baseUrl: '/editor', source: { files } });
  const nodes = source.pageTree.children;
  assert.deepEqual(
    nodes.filter((node) => node.type === 'separator').map((node) => node.name),
    ['Get started', 'Interface', 'Features', undefined],
  );
  const divider = nodes.findIndex((node) => node.type === 'separator' && !node.name);
  const trailingGuides = nodes.slice(divider + 1);
  assert.deepEqual(
    trailingGuides.map((node) => [node.type, node.url]),
    ['performance-and-large-documents', 'secure-integration', 'telemetry', 'license'].map((slug) => [
      'page',
      `/editor/${slug}`,
    ]),
  );
  for (const node of trailingGuides) {
    assert.ok(source.getPage(node.url.slice('/editor/'.length).split('/')));
  }
  assert.ok(!nodes.some((node) => node.type === 'page' && (node.name === '---' || node.url.endsWith('/---'))));
});
const snippetsRoot = fileURLToPath(new URL('../snippets/', import.meta.url));
const snippetsRootPrefix = snippetsRoot.endsWith('/') ? snippetsRoot : `${snippetsRoot}/`;
// Runnable examples own their typecheck and are included directly so the guide cannot drift from the app.
const examplesRoot = fileURLToPath(new URL('../../../examples/', import.meta.url));
const examplesRootPrefix = examplesRoot.endsWith('/') ? examplesRoot : `${examplesRoot}/`;
const runtimeConfigUrl = new URL('../config/editor-demo-runtime.json', import.meta.url);
const layoutUrl = new URL('../lib/layout.tsx', import.meta.url);
const docsHomeUrl = new URL('../components/docs-home.tsx', import.meta.url);
const builtInUiMetaUrl = new URL('../content/docs/editor/built-in-ui/meta.json', import.meta.url);
const builtInUiMapUrl = new URL('../components/embeds/built-in-ui-map.tsx', import.meta.url);
const editorDemoUrl = new URL('../components/embeds/editor-demo.tsx', import.meta.url);
const editorDemoZoomUrl = new URL('../components/embeds/editor-demo-zoom.ts', import.meta.url);
const customBoldDemoUrl = new URL('../components/embeds/custom-bold-demo.tsx', import.meta.url);
const customDocumentControlsDemoUrl = new URL(
  '../components/embeds/custom-document-controls-demo.tsx',
  import.meta.url,
);
const customCommandDemoUrl = new URL('../components/embeds/custom-command-demo.tsx', import.meta.url);
const customCommandShortcutUrl = new URL('../components/embeds/custom-command-shortcut.ts', import.meta.url);
const customCommandPageUrl = new URL('../content/docs/editor/custom-ui/custom-commands.mdx', import.meta.url);
const customCommandExampleUrl = new URL('../snippets/editor/custom-command.ts', import.meta.url);
const customCommandMarkupUrl = new URL('../snippets/editor/custom-command.html', import.meta.url);
const customUiMetaUrl = new URL('../content/docs/editor/custom-ui/meta.json', import.meta.url);
const customUiOverviewPageUrl = new URL('../content/docs/editor/custom-ui/overview.mdx', import.meta.url);
const customUiSetupPageUrl = new URL('../content/docs/editor/custom-ui/controller-setup.mdx', import.meta.url);
const customToolbarPageUrl = new URL('../content/docs/editor/custom-ui/formatting-controls.mdx', import.meta.url);
const customCommentsPageUrl = new URL('../content/docs/editor/custom-ui/comments.mdx', import.meta.url);
const customCommentsDemoUrl = new URL('../components/embeds/custom-comments-demo.tsx', import.meta.url);
const customTrackChangesPageUrl = new URL('../content/docs/editor/custom-ui/tracked-changes.mdx', import.meta.url);
const customTrackChangesDemoUrl = new URL('../components/embeds/custom-track-changes-demo.tsx', import.meta.url);
const customContentControlsPageUrl = new URL(
  '../content/docs/editor/custom-ui/content-controls.mdx',
  import.meta.url,
);
const customContentControlsDemoUrl = new URL(
  '../components/embeds/custom-content-controls-demo.tsx',
  import.meta.url,
);
const templatePopulationDemoUrl = new URL(
  '../components/embeds/template-population-demo.tsx',
  import.meta.url,
);
const contentControlAuthoringDemoUrl = new URL(
  '../components/embeds/content-control-authoring-demo.tsx',
  import.meta.url,
);
const contentControlAuthoringFixtureUrl = new URL('../public/fixtures/service-agreement-draft.docx', import.meta.url);
const contentControlAuthoringExampleFixtureUrl = new URL(
  '../../../examples/content-controls/public/service-agreement-draft.docx',
  import.meta.url,
);
const contentControlLocksDemoUrl = new URL(
  '../components/embeds/content-control-locks-demo.tsx',
  import.meta.url,
);
const editorDemoViewControlsUrl = new URL(
  '../components/embeds/editor-demo-view-controls.tsx',
  import.meta.url,
);
const docsComponentsCssUrl = new URL('../components/docs-components.css', import.meta.url);
const pinnedV2MajorPackageInstall =
  /\b(?:pnpm add(?:\s+--global)?|npm (?:install|i|add)|yarn add|bun add)[^\n]*\s(?:superdoc|@superdoc\/[a-z0-9-]+)@(?:\^|~)?2(?:[.\w-]*)?(?=\s|$)/mu;
const focusedToolbarExampleUrl = new URL('../snippets/editor/focused-built-in-toolbar.ts', import.meta.url);
const focusedReactToolbarExampleUrl = new URL('../snippets/editor/react-focused-built-in-toolbar.tsx', import.meta.url);
const builtInToolbarPageUrl = new URL(
  '../content/docs/editor/built-in-ui/configure-the-toolbar.mdx',
  import.meta.url,
);
const redirectsConfigUrl = new URL('../config/redirects.json', import.meta.url);
const builtInEditorDemoDataUrl = new URL('../lib/built-in-editor-demos.ts', import.meta.url);
const customUiControllerExampleUrl = new URL('../snippets/editor/custom-ui-controller.ts', import.meta.url);
const customUiControllerMarkupUrl = new URL('../snippets/editor/custom-ui-controller.html', import.meta.url);
const reactToolbarExampleUrl = new URL('../snippets/editor/react-custom-toolbar.tsx', import.meta.url);
const customToolbarExampleUrl = new URL('../snippets/editor/custom-toolbar.ts', import.meta.url);
const reactCustomToolbarExampleUrl = new URL(
  '../snippets/editor/react-custom-formatting-toolbar.tsx',
  import.meta.url,
);
const customCommentsExampleUrl = new URL('../snippets/editor/custom-comments.ts', import.meta.url);
const customCommentsHtmlUrl = new URL('../snippets/editor/custom-comments.html', import.meta.url);
const reactCustomCommentsExampleUrl = new URL('../snippets/editor/react-custom-comments.tsx', import.meta.url);
const customTrackedReviewExampleUrl = new URL('../snippets/editor/custom-tracked-review.ts', import.meta.url);
const customTrackedReviewHtmlUrl = new URL('../snippets/editor/custom-tracked-review.html', import.meta.url);
const reactCustomTrackedReviewExampleUrl = new URL(
  '../snippets/editor/react-custom-tracked-review.tsx',
  import.meta.url,
);
const customContentControlsExampleUrl = new URL('../snippets/editor/custom-content-controls.ts', import.meta.url);
const reactCustomContentControlsExampleUrl = new URL(
  '../snippets/editor/react-custom-content-controls.tsx',
  import.meta.url,
);
const reactBuiltInCommentsExampleUrl = new URL('../snippets/editor/react-built-in-comments.tsx', import.meta.url);
const builtInContentControlsPageUrl = new URL(
  '../content/docs/editor/built-in-ui/content-controls.mdx',
  import.meta.url,
);
const builtInContentControlsExampleUrl = new URL('../snippets/editor/built-in-content-controls.ts', import.meta.url);
const reactBuiltInContentControlsExampleUrl = new URL(
  '../snippets/editor/react-built-in-content-controls.tsx',
  import.meta.url,
);
const reactBuiltInSearchExampleUrl = new URL('../snippets/editor/react-built-in-find-replace.tsx', import.meta.url);
const customSearchExampleUrl = new URL('../snippets/editor/custom-search.ts', import.meta.url);
const reactCustomSearchExampleUrl = new URL('../snippets/editor/react-custom-search.tsx', import.meta.url);
const customSearchPageUrl = new URL('../content/docs/editor/custom-ui/search.mdx', import.meta.url);
const customSearchDemoUrl = new URL('../components/embeds/custom-search-demo.tsx', import.meta.url);
const customSearchTrackedDeletionsUrl = new URL(
  '../snippets/editor/custom-search-tracked-deletions.ts',
  import.meta.url,
);
const reactBuiltInHyperlinksExampleUrl = new URL('../snippets/editor/react-built-in-hyperlinks.tsx', import.meta.url);
const builtInContextMenuExampleUrl = new URL('../snippets/editor/built-in-context-menu.ts', import.meta.url);
const reactBuiltInContextMenuExampleUrl = new URL('../snippets/editor/react-built-in-context-menu.tsx', import.meta.url);
const customContextMenuExampleUrl = new URL('../snippets/editor/custom-context-menu.ts', import.meta.url);
const reactCustomContextMenuExampleUrl = new URL(
  '../snippets/editor/react-custom-context-menu.tsx',
  import.meta.url,
);
const customDocumentControlsExampleUrl = new URL('../snippets/editor/custom-zoom-document.ts', import.meta.url);
const customDocumentControlsMarkupUrl = new URL('../snippets/editor/custom-zoom-document.html', import.meta.url);
const reactCustomDocumentControlsExampleUrl = new URL(
  '../snippets/editor/react-custom-zoom-document.tsx',
  import.meta.url,
);
const customDocumentControlsPageUrl = new URL(
  '../content/docs/editor/custom-ui/zoom-and-document-state.mdx',
  import.meta.url,
);
const surfaceLifecyclePageUrl = new URL('../content/docs/editor/dialogs-and-surfaces.mdx', import.meta.url);
const surfaceLifecycleDemoUrl = new URL('../components/embeds/surface-lifecycle-demo.tsx', import.meta.url);
const externalSurfaceExampleUrl = new URL('../snippets/editor/external-surface.ts', import.meta.url);
const themingPageUrl = new URL('../content/docs/editor/theming.mdx', import.meta.url);
const themePlaygroundUrl = new URL('../components/embeds/theme-playground.tsx', import.meta.url);
const themeExampleUrl = new URL('../snippets/editor/theme.ts', import.meta.url);
const customSelectionPageUrl = new URL(
  '../content/docs/editor/custom-ui/selection-and-viewport.mdx',
  import.meta.url,
);
const customSelectionDemoUrl = new URL('../components/embeds/custom-selection-demo.tsx', import.meta.url);
const superdocRuntimeUrl = new URL('../components/embeds/superdoc-runtime.ts', import.meta.url);
const customSelectionMarkupUrl = new URL('../snippets/editor/selection-and-viewport.html', import.meta.url);
const customSelectionExampleUrl = new URL('../snippets/editor/selection-and-viewport.ts', import.meta.url);
const reactCustomSelectionExampleUrl = new URL(
  '../snippets/editor/react-selection-and-viewport.tsx',
  import.meta.url,
);
const documentApiReferenceModelUrl = new URL('../generated/document-api-reference.json', import.meta.url);
const generatedProofingConfigUrl = new URL('../generated/proofing-config-reference.json', import.meta.url);
const generatedSearchConfigUrl = new URL('../generated/search-config-reference.json', import.meta.url);
const generatedSearchFloatingConfigUrl = new URL('../generated/search-floating-config-reference.json', import.meta.url);
const generatedSearchStringsUrl = new URL('../generated/search-strings-reference.json', import.meta.url);
const generatedHyperlinksConfigUrl = new URL('../generated/hyperlinks-config-reference.json', import.meta.url);
const generatedLoadingConfigUrl = new URL('../generated/loading-config-reference.json', import.meta.url);
const generatedRulerUiConfigUrl = new URL('../generated/ruler-ui-config-reference.json', import.meta.url);
const generatedRulerEditorConfigUrl = new URL('../generated/ruler-editor-config-reference.json', import.meta.url);
const generatedContextMenuConfigUrl = new URL('../generated/context-menu-config-reference.json', import.meta.url);
const generatedToolbarConfigUrl = new URL('../generated/toolbar-config-reference.json', import.meta.url);
const generatedCommentsConfigUrl = new URL('../generated/comments-config-reference.json', import.meta.url);
const generatedCommentsResponsiveConfigUrl = new URL(
  '../generated/comments-responsive-config-reference.json',
  import.meta.url,
);
const generatedCommentInteractionConfigUrl = new URL(
  '../generated/comment-interaction-config-reference.json',
  import.meta.url,
);
const superdocCoreTypesUrl = new URL('../../../packages/superdoc/src/core/types/index.ts', import.meta.url);
const reviewHighlightsExampleUrl = new URL('../snippets/editor/review-highlights.ts', import.meta.url);
const reviewHighlightsPageUrl = new URL(
  '../content/docs/editor/custom-ui/review-highlights.mdx',
  import.meta.url,
);
const commentThreadExampleUrl = new URL('../snippets/document-api/comment-thread.ts', import.meta.url);
const documentStorageExampleUrl = new URL('../snippets/editor/document-storage.ts', import.meta.url);
const reactDocumentStorageExampleUrl = new URL('../snippets/editor/react-document-storage.tsx', import.meta.url);
const vanillaQuickstartExampleUrl = new URL('../../../examples/vanilla/src/main.ts', import.meta.url);
const reactQuickstartExampleUrl = new URL('../../../examples/react/src/App.tsx', import.meta.url);
const pythonSdkExampleUrl = new URL('../snippets/headless/python-accept-changes.py', import.meta.url);
const cliExampleUrl = new URL('../snippets/headless/cli-accept-changes.sh', import.meta.url);
const commandCatalogUrl = new URL('../../../packages/superdoc/src/public/ui/commands.ts', import.meta.url);
const superdocPackageUrl = new URL('../../../packages/superdoc/package.json', import.meta.url);
// The Document API operation inventory, taken from the canonical contract rather
// than from the generated model these tests are checking. A test that asked the
// model to agree with itself would pass no matter what the generator dropped.
// `check-documented-operations.ts` in the contract package guards the same
// invariant from the other side.
async function readContractOperationIds() {
  const { OPERATION_IDS } = await import('@superdoc/document-api');
  return new Set(OPERATION_IDS);
}

function compileImageMimeNormalizer(example) {
  const source = example.match(/function withImageMimeType\(file: File\): Blob \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source, 'The toolbar example must define withImageMimeType.');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(`${javascript}\nreturn withImageMimeType;`)();
}

function compileReviewFindingsController(example, exportName = 'createReviewFindings') {
  const javascript = ts.transpileModule(example, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === 'superdoc') return { defineSuperDocExtension: (extension) => extension };
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected review findings import: ${id}`);
  };
  Function('require', 'module', 'exports', javascript)(require, module, module.exports);
  return module.exports[exportName];
}

function createReviewFindingsContext(onReplace = () => {}) {
  const mutationHandlers = [];
  return {
    disposables: { add() {} },
    visuals: {
      highlight: () => ({
        clear() {},
        replace(targets) {
          onReplace(targets);
        },
      }),
    },
    onMutation(filter, handler) {
      mutationHandlers.push(handler);
      return () => {
        const index = mutationHandlers.indexOf(handler);
        if (index >= 0) mutationHandlers.splice(index, 1);
      };
    },
    emitMutation() {
      for (const handler of [...mutationHandlers]) handler({ affects: new Set(['text']) });
    },
  };
}

function createReviewFindingsCapture() {
  return {
    status: 'ready',
    empty: false,
    target: {
      kind: 'text',
      coordinateSpace: 'visible',
      segments: [{ blockId: 'shared-block-id', range: { start: 0, end: 12 } }],
    },
    selectionTarget: null,
    activeMarks: [],
    activeCommentIds: [],
    activeChangeIds: [],
    quotedText: 'Twelve months',
    capturedAt: Date.now(),
  };
}

const registeredComponents = new Set([
  'Card',
  'Cards',
  'Callout',
  'BuiltInUiMap',
  'ClauseLibraryDemo',
  'CommandStateDemo',
  'ContentControlAuthoringDemo',
  'ContentControlLocksDemo',
  'ContentControlPatterns',
  'CommentsConfigReference',
  'ConfigReference',
  'ContextMenuConfigReference',
  'CustomBoldDemo',
  'CustomCommentsDemo',
  'CustomCommandDemo',
  'CustomContentControlsDemo',
  'CustomDocumentControlsDemo',
  'CustomReviewFindingsDemo',
  'CustomSearchDemo',
  'CustomSelectionDemo',
  'CustomTrackChangesDemo',
  'CustomToolbarDemo',
  'CustomUiArchitecture',
  'CollaborationOverview',
  'CollaborationDemo',
  'DocumentPreview',
  'DocumentApiNamespace',
  'DocumentApiOperation',
  'DocumentApiReferenceLanding',
  'DocsHome',
  'EditorDemo',
  'FileDownload',
  'FrameworkExample',
  'FrameworkExampleTabs',
  'HyperlinksConfigReference',
  'InterfaceOwnership',
  'LifecycleJourney',
  'LoadingConfigReference',
  'MigrationAgentPrompt',
  'MigrationExplorer',
  'MigrationExample',
  'MigrationExampleTabs',
  'ProofingConfigReference',
  'ReceiptBar',
  'RuntimeExample',
  'RuntimeExampleTabs',
  'RulerConfigReference',
  'SearchConfigReference',
  'SurfaceLifecycleDemo',
  'ThemePlayground',
  'ToolbarConfigReference',
  'TemplatePopulationDemo',
]);
const editorDemoPresets = new Set([
  'comments',
  'content-controls',
  'context-menu',
  'document-modes',
  'hyperlinks',
  'loading',
  'proofing',
  'ruler',
  'search',
  'toolbar',
  'tracked-review',
]);

async function collectMdxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = new URL(entry.name, directory);
      if (entry.isDirectory()) return collectMdxFiles(new URL(`${entry.name}/`, directory));
      return entry.name.endsWith('.mdx') ? [path] : [];
    }),
  );
  return files.flat();
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('internal content, fixture, and media references resolve', async () => {
  const missingReferences = [];

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');
    // Any root-relative reference, not just a fixed set of prefixes. The pages
    // own the root namespace, so an internal link is simply /something: a regex
    // naming prefixes would skip the links it exists to check, and a broken one
    // would pass silently.
    const markdownLinks = [...markdown.matchAll(/\]\((\/[^)#?\s]+)/g)].map((match) => match[1]);
    const componentLinks = [...markdown.matchAll(/(?:href|fixture)=['"](\/[^'"#?\s]+)/g)].map((match) => match[1]);
    const markdownImages = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)].map(
      (match) => match[1],
    );

    for (const link of new Set([...markdownLinks, ...componentLinks])) {
      // A reference with a file extension is a public asset rather than a page
      // route, so it resolves against public/ instead of the content tree.
      if (/\.[a-z0-9]+$/iu.test(link)) {
        const assetPath = new URL(`../public${link}`, import.meta.url);
        if (!(await pathExists(assetPath))) missingReferences.push(`${file.pathname}: ${link}`);
        continue;
      }

      const route = link.slice('/'.length).replace(/\/$/, '');
      const page = new URL(`${route}.mdx`, contentRoot);
      const indexPage = new URL(`${route}/index.mdx`, contentRoot);
      if (!(await pathExists(page)) && !(await pathExists(indexPage))) {
        missingReferences.push(`${file.pathname}: ${link}`);
      }
    }

    for (const image of markdownImages) {
      if (/^https?:\/\//.test(image)) continue;
      const imagePath = image.startsWith('/') ? new URL(`../public${image}`, import.meta.url) : new URL(image, file);
      if (!(await pathExists(imagePath))) missingReferences.push(`${file.pathname}: ${image}`);
    }
  }

  assert.deepEqual(missingReferences, [], `Missing content references under ${appRoot}`);
});

test('authored guides use the generated local Document API reference', async () => {
  const staleReferences = [];

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');
    if (/https:\/\/docs\.superdoc\.dev\/document-api\/reference|Mintlify reference remains canonical/u.test(markdown)) {
      staleReferences.push(file.pathname);
    }
  }

  assert.deepEqual(staleReferences, []);
});

test('published install guidance targets stable v2 packages', async () => {
  const staleInstallTargets = [];
  const unqualifiedCanonicalPackageInstall =
    /\b(?:pnpm add(?:\s+--global)?|npm (?:install|i)|yarn add|bun add)\s+@superdoc\/(?:sdk|cli)(?=\s|$)/mu;

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');
    if (
      /(?:superdoc|@superdoc\/[a-z0-9-]+)@next|current `next` release|`next` dist-tag|@superdoc-dev\/(?:cli|sdk|mcp)/u.test(
        markdown,
      ) ||
      unqualifiedCanonicalPackageInstall.test(markdown) ||
      pinnedV2MajorPackageInstall.test(markdown)
    ) {
      staleInstallTargets.push(file.pathname);
    }
  }

  const docsHome = await readFile(docsHomeUrl, 'utf8');
  if (/superdoc@next/u.test(docsHome)) staleInstallTargets.push(docsHomeUrl.pathname);

  assert.deepEqual(staleInstallTargets, []);
  // The bare package name is deliberate: `latest` is the v2 line, so pinning a
  // major in the hero would only go stale at v3 while saying nothing today.
  assert.match(docsHome, /npm install superdoc'/u);
});

test('install guidance cannot pin the current v2 major', () => {
  for (const command of ['pnpm add superdoc@2', 'npm install @superdoc/sdk@2.0.0', 'bun add @superdoc/react@^2']) {
    assert.match(command, pinnedV2MajorPackageInstall);
  }

  assert.doesNotMatch('pnpm add superdoc', pinnedV2MajorPackageInstall);
  assert.doesNotMatch('pnpm add @superdoc/sdk@latest', pinnedV2MajorPackageInstall);
});

test('Markdown images include alt text and accessible SVG metadata', async () => {
  const accessibilityIssues = [];

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');
    const images = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)];

    for (const image of images) {
      const altText = image[1].trim();
      const source = image[2];
      if (!altText) accessibilityIssues.push(`${file.pathname}: ${source} has empty alt text`);

      if (!source.endsWith('.svg') || /^https?:\/\//.test(source)) continue;
      const imagePath = source.startsWith('/') ? new URL(`../public${source}`, import.meta.url) : new URL(source, file);
      const svg = await readFile(imagePath, 'utf8');
      if (!/<title(?:\s|>)/.test(svg)) accessibilityIssues.push(`${file.pathname}: ${source} has no SVG title`);
      if (!/<desc(?:\s|>)/.test(svg)) accessibilityIssues.push(`${file.pathname}: ${source} has no SVG description`);
    }
  }

  assert.deepEqual(accessibilityIssues, []);
});

test('the editor demo runtime uses exact stable packages', async () => {
  const runtimeConfig = JSON.parse(await readFile(runtimeConfigUrl, 'utf8'));
  const superdocPackage = JSON.parse(await readFile(superdocPackageUrl, 'utf8'));
  const engineSpecifier = superdocPackage.dependencies?.[runtimeConfig.enginePackage];

  assert.equal(runtimeConfig.runtimePackage, superdocPackage.name);
  assert.match(runtimeConfig.runtimeVersion, /^2\.\d+\.\d+$/u);
  assert.match(runtimeConfig.engineVersion, /^\d+\.\d+\.\d+$/u);
  assert.ok(engineSpecifier, `${runtimeConfig.enginePackage} must remain a SuperDoc dependency`);
  assert.equal(runtimeConfig.uiModulePath, superdocPackage.exports?.['./ui']?.import?.slice(1));
});

test('the custom UI overview demo uses the Editor-owned controller', async () => {
  const demo = await readFile(customBoldDemoUrl, 'utf8');

  assert.match(demo, /const ui = instance\.ui/u);
  assert.doesNotMatch(demo, /\b(?:createSuperDocUI|loadUIModule)\b/u);
});

test('the custom UI setup demo shows one control changing ownership', async () => {
  const [page, demo] = await Promise.all(
    [customUiSetupPageUrl, customBoldDemoUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomBoldDemo variant='handoff' \/>/u);
  assert.match(page, /Only the visible Bold control changed owner/u);
  assert.match(demo, /excludeItems: \['bold'\]/u);
  assert.match(demo, /const toolbarContainer = builtInToolbarRef\.current/u);
  assert.match(demo, /container: toolbarContainer/u);
  assert.match(demo, /data-variant=\{variant\}/u);
  assert.match(
    demo,
    /\{isHandoffVariant \? \([\s\S]*\{applicationControls\}[\s\S]*\{builtInControls\}[\s\S]*\) : null\}\s*<CollapsibleEditorPreview/u,
  );
  assert.match(demo, /<CollapsibleEditorPreview[\s\S]*\{!isHandoffVariant \? applicationControls : null\}/u);
});

test('the built-in toolbar examples use canonical public item ids', async () => {
  const examples = await Promise.all(
    [
      focusedToolbarExampleUrl,
      focusedReactToolbarExampleUrl,
      new URL('../snippets/editor/basic-built-in-toolbar.ts', import.meta.url),
      new URL('../snippets/editor/react-basic-built-in-toolbar.tsx', import.meta.url),
    ].map((url) => readFile(url, 'utf8')),
  );
  const publicTypes = await readFile(superdocCoreTypesUrl, 'utf8');
  const demoData = await readFile(builtInEditorDemoDataUrl, 'utf8');
  const itemType = publicTypes.match(/export type ToolbarItemId =([\s\S]*?);/u)?.[1];

  assert.ok(itemType, 'ToolbarItemId must remain a named public union.');
  const publicItems = new Set([...itemType.matchAll(/'([^']+)'/gu)].map((match) => match[1]));

  for (const example of examples) {
    const items = example.match(/items:\s*\{([\s\S]*?)\n\s*\},/u)?.[1];

    assert.ok(items, 'The focused toolbar example must define an explicit items allowlist.');

    const configuredItems = [...items.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
    const unknownItems = configuredItems.filter((item) => !publicItems.has(item));

    assert.deepEqual(unknownItems, []);
    assert.ok(!configuredItems.includes('overflow'), 'Focused toolbars should list controls, not overflow chrome.');
  }

  const demoConfig = demoData.match(/toolbarDemoItems = \{([\s\S]*?)\n\} as const/u)?.[1];
  assert.ok(demoConfig, 'The toolbar demo must define the focused toolbar it renders.');
  const demoItems = new Set([...demoConfig.matchAll(/'([^']+)'/gu)].map((match) => match[1]));
  const unknownDemoItems = [...demoItems].filter((item) => !publicItems.has(item));

  assert.deepEqual(unknownDemoItems, []);
  assert.ok(!demoItems.has('overflow'), 'The toolbar demo data should not expose overflow chrome.');
  assert.match(demoData, /toolbarDemoExcludedItems = \['bold', 'italic'\] as const/u);
});

test('the hyperlink recipes provide a document with a link to activate', async () => {
  const page = await readFile(new URL('../content/docs/editor/built-in-ui/hyperlinks.mdx', import.meta.url), 'utf8');
  assert.match(page, /href='\/fixtures\/hyperlinks-sample\.docx'/u);
  assert.match(page, /public\/hyperlinks-sample\.docx/u);
  assert.match(page, /Click \*\*SuperDoc documentation\*\*/u);
  for (const name of ['built-in-hyperlinks.ts', 'react-built-in-hyperlinks.tsx']) {
    const snippet = await readFile(new URL(`../snippets/editor/${name}`, import.meta.url), 'utf8');
    assert.match(snippet, /document[:=]\s*'\/hyperlinks-sample\.docx'/u);
  }
});

test('the toolbar guide preserves the built-in image upload workflow', async () => {
  const [page, vanillaExample, reactExample, redirectsConfig] = await Promise.all([
    readFile(builtInToolbarPageUrl, 'utf8'),
    readFile(focusedToolbarExampleUrl, 'utf8'),
    readFile(focusedReactToolbarExampleUrl, 'utf8'),
    readFile(redirectsConfigUrl, 'utf8').then(JSON.parse),
  ]);

  for (const example of [vanillaExample, reactExample]) {
    assert.match(example, /center: \[[^\]]*'image'/u);
    assert.match(example, /handleImageUpload/u);
    assert.match(example, /new FileReader\(\)/u);
    assert.match(example, /file\.slice\(0, file\.size, 'image\/png'\)/u);
    assert.match(example, /file\.slice\(0, file\.size, 'image\/jpeg'\)/u);
    assert.match(example, /readAsDataURL\(withImageMimeType\(file\)\)/u);
    assert.doesNotMatch(example, /URL\.(?:create|revoke)ObjectURL/u);

    const withImageMimeType = compileImageMimeNormalizer(example);
    const typedPng = { name: 'typed.png', size: 4, type: 'image/png' };
    const typedJpeg = { name: 'typed.jpg', size: 4, type: 'image/jpeg' };
    assert.equal(withImageMimeType(typedPng), typedPng);
    assert.equal(withImageMimeType(typedJpeg), typedJpeg);

    const sliceCalls = [];
    const emptyTypeFile = (name) => ({
      name,
      size: 4,
      type: '',
      slice(start, end, type) {
        sliceCalls.push({ start, end, type });
        return { type };
      },
    });
    assert.deepEqual(withImageMimeType(emptyTypeFile('scan.PNG')), { type: 'image/png' });
    assert.deepEqual(withImageMimeType(emptyTypeFile('photo.JpEg')), { type: 'image/jpeg' });
    assert.deepEqual(sliceCalls, [
      { start: 0, end: 4, type: 'image/png' },
      { start: 0, end: 4, type: 'image/jpeg' },
    ]);
    assert.throws(() => withImageMimeType({ name: 'notes.txt', size: 4, type: '' }), /PNG or JPEG/u);
    assert.throws(() => withImageMimeType({ name: 'notes.png', size: 4, type: 'text/plain' }), /PNG or JPEG/u);

    const bytes = new Uint8Array([0, 127, 128, 255]);
    for (const [name, type] of [['scan.PNG', 'image/png'], ['photo.JpEg', 'image/jpeg']]) {
      const file = new File([bytes], name);
      const normalized = withImageMimeType(file);
      assert.equal(normalized.type, type);
      assert.equal(normalized.size, file.size);
      assert.deepEqual(new Uint8Array(await normalized.arrayBuffer()), bytes);
    }
  }

  assert.match(page, /handleImageUpload/u);
  assert.match(page, /examples return data URLs/iu);
  assert.match(page, /no backend or temporary object URL/iu);
  assert.match(page, /extension-accepted PNG and JPEG files[^.]*browser leaves `file\.type` empty/iu);
  assert.match(page, /immediately fetches object or HTTP URLs/iu);
  assert.match(page, /embeds the image in the\s+DOCX/iu);
  assert.match(page, /same-origin/iu);
  assert.match(page, /public or presigned URL/iu);
  assert.match(page, /without cross-origin\s+cookies or custom authorization headers/iu);
  assert.match(page, /cross-origin requests \(CORS\)/iu);
  assert.match(page, /CORS[^.]*application's origin/iu);
  assert.doesNotMatch(page, /persistent (?:storage|URL)/iu);
  assert.match(page, /\[Configure content controls\]\(\/editor\/built-in-ui\/content-controls\)/u);

  const legacyRoute = redirectsConfig.pageMoves.find(
    ({ source }) => source === '/editor/built-in-ui/structured-content/',
  );
  assert.equal(legacyRoute?.destination, '/editor/built-in-ui/configure-the-toolbar/');
  assert.match(legacyRoute?.reason ?? '', /image/u);
});

test('the redirected toolbar guide preserves the built-in table controls', async () => {
  const [page, vanillaExample, reactExample, redirectsConfig] = await Promise.all([
    readFile(builtInToolbarPageUrl, 'utf8'),
    readFile(focusedToolbarExampleUrl, 'utf8'),
    readFile(focusedReactToolbarExampleUrl, 'utf8'),
    readFile(redirectsConfigUrl, 'utf8').then(JSON.parse),
  ]);

  for (const example of [vanillaExample, reactExample]) {
    assert.match(example, /center: \[[^\]]*'table'[^\]]*'table-actions'/u);
  }

  assert.match(page, /\*\*Table\*\* inserts a table/iu);
  assert.match(page, /\*\*Table actions\*\*[^.]*selection is inside a table/iu);

  const legacyRoute = redirectsConfig.pageMoves.find(
    ({ source }) => source === '/editor/built-in-ui/structured-content/',
  );
  assert.equal(legacyRoute?.destination, '/editor/built-in-ui/configure-the-toolbar/');
  assert.match(legacyRoute?.reason ?? '', /table/u);
});

test('the React toolbar example uses command ids from the public v2 command catalog', async () => {
  const example = await readFile(reactToolbarExampleUrl, 'utf8');
  const catalog = await readFile(commandCatalogUrl, 'utf8');
  const configuredIds = new Set([
    ...[...example.matchAll(/<CommandButton\s+id='([^']+)'/gu)].map((match) => match[1]),
    ...[...example.matchAll(/useSuperDocCommand\('([^']+)'\)/gu)].map((match) => match[1]),
  ]);
  const catalogIds = new Set([...catalog.matchAll(/\bid:\s*'([^']+)'/gu)].map((match) => match[1]));
  const unknownIds = [...configuredIds].filter((id) => !catalogIds.has(id));

  assert.deepEqual(unknownIds, []);
});

test('the custom UI setup preserves selection and shares the Editor-owned controller', async () => {
  const [markup, vanilla, react] = await Promise.all(
    [customUiControllerMarkupUrl, customUiControllerExampleUrl, reactToolbarExampleUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  for (const example of [vanilla, react]) {
    assert.match(example, /excludeItems: \['bold'\]/u);
    assert.match(example, /preventDefault\(\)/u);
    assert.doesNotMatch(example, /toolbar: false/u);
  }

  assert.match(markup, /id="toolbar"/u);
  assert.match(vanilla, /container: '#toolbar'/u);
  assert.match(vanilla, /const editorUi = \{/u);
  assert.match(vanilla, /ui: editorUi/u);
  assert.match(vanilla, /readySuperDoc\.ui\.commands\.get\('bold'\)/u);
  assert.match(vanilla, /bold\.executeAsync\(\)/u);
  assert.match(react, /const editorUi = \{/u);
  assert.match(react, /\} satisfies UIConfig/u);
  assert.doesNotMatch(react, /container: '#toolbar'/u);
  assert.match(react, /useSuperDocCommand\('bold'\)/u);
  assert.match(react, /bold\.executeAsync\(\)/u);
  assert.match(react, /disabled=\{!bold\.enabled \|\| pending\}/u);
  assert.match(react, /setStatus\(\(current\) => \(\{ id: current\.id \+ 1,/u);
  assert.match(react, /<span key=\{status\.id\}>\{status\.message\}<\/span>/u);
  assert.match(react, /onReady=\{\(\{ superdoc \}\) => setSuperDoc\(superdoc\)\}/u);
  assert.doesNotMatch(react, /\bui=\{\{/u);
});

test('the custom toolbar continues the setup project with selection-aware controls', async () => {
  const [vanilla, react] = await Promise.all(
    [customToolbarExampleUrl, reactCustomToolbarExampleUrl].map((url) => readFile(url, 'utf8')),
  );

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/sample\.docx['"]/u);
    assert.match(example, /toolbar: false/u);
    assert.match(example, /useSuperDocCommand|get\('bold'\)/u);
    assert.match(example, /font-family/u);
    assert.match(example, /font-size/u);
    assert.doesNotMatch(example, /contract\.docx|document-mode|paragraph-style/u);
  }

  assert.match(vanilla, /ui\.fonts\.observe\(render\)/u);
  assert.match(react, /fontFamily\.executeAsync\(event\.target\.value\)/u);
  assert.match(react, /fontSize\.executeAsync\(event\.target\.value\)/u);

  // `Mixed` reports an indeterminate selection; choosing it would dispatch an
  // empty payload, so both examples keep it visible but not selectable.
  assert.match(vanilla, /mixed\.disabled = true/u);
  assert.equal(react.match(/<option disabled value=''>/gu)?.length, 2);

  // A uniform value outside the preset list is one value, not a mixed one.
  assert.match(vanilla, /\[\{ value: selected, label: selected \}, \.\.\.options\]/u);
  assert.match(react, /getPickerChoices\(fontOptions, fontFamily\.value\)/u);
  assert.match(react, /getPickerChoices\(sizeOptions, fontSize\.value\)/u);

  // Commands run one at a time, as the setup guide's control does.
  assert.match(vanilla, /boldButton\.disabled = pending \|\| !boldState\.enabled/u);
  assert.match(vanilla, /if \(pending\) return;/u);
  // The select is rebuilt when a command starts, so the chosen value is read first.
  assert.match(vanilla, /const value = fontFamilySelect\.value;\s+return run\(\(\) => fontFamily\.executeAsync\(value\)/u);
  assert.match(vanilla, /const value = fontSizeSelect\.value;\s+return run\(\(\) => fontSize\.executeAsync\(value\)/u);
  assert.match(react, /disabled=\{pending \|\| !bold\.enabled\}/u);
  assert.match(react, /if \(pending\) return;/u);
});

test('the custom UI navigation has no internal section separators', async () => {
  const { pages } = JSON.parse(await readFile(customUiMetaUrl, 'utf8'));

  assert.deepEqual(
    pages.filter((page) => typeof page === 'string' && page.startsWith('---')),
    [],
  );
});

test('the custom UI overview separates the core path from optional workflows', async () => {
  const { pages } = JSON.parse(await readFile(customUiMetaUrl, 'utf8'));
  const [overview, toolbar, documentControls] = await Promise.all(
    [customUiOverviewPageUrl, customToolbarPageUrl, customDocumentControlsPageUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.deepEqual(pages.slice(0, 5), [
    'overview',
    'controller-setup',
    'commands-and-state',
    'formatting-controls',
    'zoom-and-document-state',
  ]);

  assert.match(toolbar, /alternative recipe, \[[^\]]+\]\(\/editor\/custom-ui\/zoom-and-document-state\)/u);
  assert.match(documentControls, /Return to the \[Custom UI overview\]/u);
  assert.doesNotMatch(documentControls, /\/editor\/custom-ui\/comments/u);

  for (const page of pages.slice(1)) {
    assert.match(overview, new RegExp(`/editor/custom-ui/${page}(?:\\)|/)`, 'u'));
  }

  assert.match(overview, /\/editor\/dialogs-and-surfaces/u);
  assert.match(overview, /\/editor\/theming/u);
});

/** Slugs linked from the numbered list under a heading, in the order they are listed. */
function orderedCorePathSlugs(overview) {
  const section = overview.split('## Start with one control')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^\d+\.\s.*?\/editor\/custom-ui\/([a-z0-9-]+)\)/gmu)].map(([, slug]) => slug);
}

/** Slugs linked from the workflow table rows, which must stay disjoint from the core path. */
function workflowTableSlugs(overview) {
  const section = overview.split('## Choose a workflow')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^\|.*?\/editor\/custom-ui\/([a-z0-9-]+)\)/gmu)].map(([, slug]) => slug);
}

test('the overview core-path list matches navigation order and excludes optional workflows', async () => {
  const { pages } = JSON.parse(await readFile(customUiMetaUrl, 'utf8'));
  const overview = await readFile(customUiOverviewPageUrl, 'utf8');

  assert.deepEqual(orderedCorePathSlugs(overview), ['controller-setup', 'commands-and-state']);

  const optional = workflowTableSlugs(overview);
  assert.ok(optional.length > 0);
  for (const slug of pages.slice(1, 5)) {
    assert.ok(!optional.includes(slug), `${slug} is listed as both a core-path step and an optional workflow`);
  }
});

test('the core path promises only what its guides deliver', async () => {
  const [overview, toolbar, documentControls] = await Promise.all(
    [customUiOverviewPageUrl, customToolbarPageUrl, customDocumentControlsPageUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.match(overview, /alternative recipes/u);
  assert.match(overview, /Each replaces the first control's Editor code; neither requires the other/u);
  assert.match(toolbar, /Continue with the `\/sample\.docx` project from \[[^\]]+\]\(\/editor\/custom-ui\/controller-setup\)/u);
  assert.match(documentControls, /Start from \[[^\]]+\]\(\/editor\/custom-ui\/controller-setup\)/u);
});

test('the custom toolbar demo proves toggle, picker, and mixed selection state', async () => {
  const [page, demo] = await Promise.all(
    [customToolbarPageUrl, customBoldDemoUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomToolbarDemo \/>/u);
  assert.match(page, /Extend that formatted selection into the next plain sentence and the pickers show/u);
  assert.match(demo, /variant\?: 'standalone' \| 'handoff' \| 'toolbar'/u);
  assert.match(demo, /editorUi = \{ \.\.\.editorUi, toolbar: false \}/u);
  assert.match(demo, /ui\.fonts\.observe/u);
  assert.match(demo, /observerCleanupRef\.current/u);
  assert.match(demo, /ui\.commands\.get\(id\)\.executeAsync\(value\)/u);
  assert.match(demo, /runPickerCommand\('font-family'/u);
  assert.match(demo, /runPickerCommand\('font-size'/u);
  assert.match(demo, /fontSizeValue && !hasPickerOption\(fontSizeOptions, fontSizeValue\)/u);
  assert.equal(demo.match(/<option disabled value=''>/gu)?.length, 2);
});

test('the React comments example keeps restart-sensitive config identities stable', async () => {
  const example = await readFile(reactBuiltInCommentsExampleUrl, 'utf8');

  assert.match(example, /const editorConfig = \{/u);
  assert.match(example, /user=\{editorConfig\.user\}/u);
  assert.match(example, /ui=\{editorConfig\.ui\}/u);
  assert.doesNotMatch(example, /\b(?:user|ui)=\{\{/u);
});

test('the review findings app wires a complete standalone workflow', async () => {
  const app = await readFile(new URL('../snippets/editor/review-findings-app.ts', import.meta.url), 'utf8');
  const html = await readFile(new URL('../snippets/editor/review-findings-app.html', import.meta.url), 'utf8');
  for (const action of ['bindSelection', 'save', 'suggest', 'refresh']) assert.ok(app.includes(`review.${action}`));
  assert.match(app, /if \(pending \|\| !ready\) return/u);
  assert.match(app, /extensions: \[review.extension\]/u);
  assert.match(app, /isSupersededRefresh/u);
  assert.match(app, /triggerDownload: true/u);
  assert.match(html, /Simulated response/u);
  assert.match(html, /src="\/src\/main.ts"/u);
});

test('the review app serializes actions and recovers after a failure', async () => {
  const source = await readFile(new URL('../snippets/editor/review-findings-app.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('review-findings-app.ts', source, ts.ScriptTarget.Latest, true);
  const actionRunner = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'run');
  assert.ok(actionRunner);
  const compiled = ts.transpileModule(actionRunner.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const errors = [];
  const app = new Function('renderControls', 'renderFindings', 'showError', `
    let pending = false;
    let ready = false;
    const rows = [];
    ${compiled}
    return { run, setReady: () => { ready = true; }, isPending: () => pending };
  `)(() => {}, () => {}, (error) => errors.push(error));

  let calls = 0;
  await app.run(async () => { calls += 1; });
  assert.equal(calls, 0, 'actions wait for readiness');
  app.setReady();
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const first = app.run(async () => { calls += 1; await deferred; });
  assert.equal(app.isPending(), true);
  await app.run(async () => { calls += 1; });
  assert.equal(calls, 1, 'a second click cannot dispatch another action');
  release();
  await first;
  assert.equal(app.isPending(), false);

  const failure = new Error('Save failed');
  await app.run(async () => { throw failure; });
  assert.deepEqual(errors, [failure]);
  assert.equal(app.isPending(), false, 'failures release the action lock');
  await app.run(async () => { calls += 1; });
  assert.equal(calls, 2, 'the reader can retry');
});

test('the custom comments examples replace one surface with a focused workflow', async () => {
  const [page, demo, html, vanilla, react] = await Promise.all(
    [
      customCommentsPageUrl,
      customCommentsDemoUrl,
      customCommentsHtmlUrl,
      customCommentsExampleUrl,
      reactCustomCommentsExampleUrl,
    ].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomCommentsDemo \/>/u);
  assert.match(page, /built-in comments UI/u);
  assert.match(page, /Document API comments/u);
  assert.doesNotMatch(page, /<CommentsConfigReference\b/u);
  assert.match(html, /id="toolbar"/u);
  assert.match(html, /id="editor" style="height: 70vh; overflow: auto"/u);

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/sample\.docx['"]/u);
    assert.match(example, /comments: false/u);
    assert.match(example, /selection\.capture\(\)/u);
    assert.match(example, /comments\.createFromCapture/u);
    assert.match(example, /comments\.setActive/u);
    assert.match(example, /comments\.scrollTo/u);
    assert.match(example, /comments\.resolve/u);
    assert.match(example, /comments\.reopen/u);
    assert.match(example, /Alex Rivera/u);
    assert.match(example, /parentCommentId/u);
    assert.doesNotMatch(example, /contract\.docx|comments\.(?:reply|edit|delete)\(/u);
  }

  assert.match(vanilla, /addEventListener\('mousedown', captureSelection\)/u);
  assert.match(vanilla, /toolbar: \{ container: toolbar, responsiveTo: 'container' \}/u);
  assert.match(vanilla, /startComment\.focus\(\)/u);
  assert.match(react, /onMouseDown=\{captureSelection\}/u);
  assert.match(react, /startCommentRef\.current\?\.focus\(\)/u);
  assert.match(react, /ref=\{startCommentRef\}/u);

  assert.match(page, /document moves between the first and final pages/u);
  assert.match(demo, /DEMO_DOCUMENT = '\/fixtures\/custom-comments-workflow\.docx'/u);
  assert.match(demo, /comments: false/u);
  assert.match(demo, /toolbar: \{ container: toolbarContainer/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /contentClassName='sd-custom-comments-demo-workspace'/u);
  assert.match(demo, /expandedMaxHeight='80rem'/u);
  assert.match(demo, /value: 80/u);
  assert.match(demo, /instance\.ui\.zoom\.set\(INITIAL_ZOOM\.value\)/u);
  assert.match(demo, /instance\.ui\.comments\.observe/u);
  assert.match(demo, /instance\.ui\.zoom\.observe/u);
  assert.match(demo, /fitRuntimeEditorToWidth\(instanceRef\.current\)/u);
  assert.match(demo, /comments\.createFromCapture/u);
  assert.match(demo, /commentsHandle\?\.setActive/u);
  assert.match(demo, /commentsHandle\.scrollTo/u);
  assert.match(demo, /commentsHandle\.resolve/u);
  assert.match(demo, /commentsHandle\.reopen/u);
  assert.match(demo, /observerCleanupRef\.current/u);
  assert.match(demo, /capture\.quotedText/u);
  assert.match(demo, /key=\{thread\.address\.entityId\}/u);

  // Creation settles asynchronously. The composer must lock until the receipt
  // arrives so one draft cannot be submitted twice.
  assert.match(vanilla, /if \(!capture \|\| pendingCapture\) return;/u);
  assert.match(vanilla, /pendingCapture = capture;/u);
  assert.match(react, /if \(!ui \|\| !capture \|\| pending\) return;/u);
  assert.match(react, /disabled=\{pending \|\| text\.trim\(\)\.length === 0\}/u);
});

test('the custom tracked-change examples build one application-owned review panel', async () => {
  const [page, demo, html, vanilla, react] = await Promise.all(
    [
      customTrackChangesPageUrl,
      customTrackChangesDemoUrl,
      customTrackedReviewHtmlUrl,
      customTrackedReviewExampleUrl,
      reactCustomTrackedReviewExampleUrl,
    ].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomTrackChangesDemo \/>/u);
  assert.match(page, /custom-track-changes-workflow\.docx/u);
  assert.match(page, /A successful decision should remove one row and decrease the count/u);
  assert.match(page, /\/editor\/custom-ui\/overview/u);
  assert.match(html, /id="toolbar"/u);
  assert.match(html, /id="previous-change"/u);
  assert.match(html, /id="editor" style="height: 70vh; overflow: auto"/u);
  assert.match(html, /id="next-change"/u);

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/contract\.docx['"]/u);
    assert.match(example, /comments: false/u);
    // Show in document pins the clicked occurrence for both focus and reveal.
    assert.match(example, /trackChanges\.setActive\(target\)/u);
    assert.match(example, /trackChanges\.scrollTo\(target\)/u);
    assert.match(example, /trackChanges\.navigatePrevious/u);
    assert.match(example, /trackChanges\.navigateNext/u);
    // Decisions await settlement so a late failure clears the pending state.
    assert.match(example, /await ui\.trackChanges\.acceptAsync\(target\)/u);
    assert.match(example, /await ui\.trackChanges\.rejectAsync\(target\)/u);
    assert.doesNotMatch(example, /trackChanges\.accept\(|trackChanges\.reject\(/u);
    // A row decides its exact occurrence: id plus story for non-body changes.
    assert.match(example, /const story = change\.address\?\.story;/u);
    assert.match(example, /Alex Rivera/u);
    assert.doesNotMatch(example, /commands\.executeAsync|acceptAllAsync|rejectAllAsync/u);
  }

  assert.match(vanilla, /trackChanges\.observe\(render\)/u);
  assert.match(vanilla, /toolbar: \{ container: toolbar, responsiveTo: 'container' \}/u);
  // Pending rerenders reuse the observed directory, not the page-bounded passive snapshot.
  assert.match(vanilla, /lastChanges = changes;/u);
  assert.doesNotMatch(vanilla, /trackChanges\.getSnapshot\(\)/u);
  assert.match(react, /useSuperDocTrackChanges\(\)/u);
  assert.match(react, /key=\{rowKey\(change\)\}/u);
  // Active and pending state are tracked per occurrence, not per id, so a
  // same-id body and footnote row never light up together.
  for (const example of [vanilla, react]) {
    assert.match(example, /function isActiveRow\(/u);
    assert.match(example, /activeRow\.key === rowKey\(change\)/u);
    assert.doesNotMatch(example, /change\.id === (?:changes|trackChanges)\.activeId|activeId === change\.id/u);
  }
  assert.match(vanilla, /pendingDecision = \{ key: rowKey\(change\), decision \}/u);
  assert.match(react, /setPendingKey\(rowKey\(change\)\)/u);
  assert.match(react, /onContentError=\{\(\) => onLoadError\(/u);
  assert.match(demo, /key=\{rowKey\(change\)\}/u);
  assert.match(demo, /isActiveRow\(change, trackChanges\.activeId, activeRow\)/u);
  assert.match(demo, /pendingDecision\?\.key === rowKey\(change\)/u);
  assert.doesNotMatch(demo, /change\.id === trackChanges\.activeId/u);
  assert.match(demo, /DEMO_DOCUMENT = '\/fixtures\/custom-track-changes-workflow\.docx'/u);
  assert.match(demo, /comments: false/u);
  assert.match(demo, /toolbar: \{ container: toolbarContainer/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /contentClassName='sd-custom-track-changes-demo-workspace'/u);
  assert.match(demo, /expandedMaxHeight='80rem'/u);
  assert.match(demo, /value: 80/u);
  assert.match(demo, /instance\.ui\.zoom\.set\(INITIAL_ZOOM\.value\)/u);
  assert.match(demo, /instance\.ui\.trackChanges\.observe/u);
  assert.match(demo, /instance\.ui\.zoom\.observe/u);
  assert.match(demo, /fitRuntimeEditorToWidth\(instanceRef\.current\)/u);
  assert.match(demo, /trackChangesHandle\.navigatePrevious/u);
  assert.match(demo, /trackChangesHandle\.navigateNext/u);
  // The demo awaits the one Document API operation a decision routes to, so
  // it never dispatches twice or waits on the pinned runtime's selection read.
  assert.match(demo, /await doc\.trackChanges\.decide\(\{\s+decision,\s+target: story \? \{ kind: 'id', id: change\.id, story \}/u);
  assert.doesNotMatch(demo, /commands\.executeAsync|trackChangesHandle\.accept\(|handle\.accept\(/u);
  // A rejected operation must still clear the pending state and report.
  assert.match(demo, /try \{\s+const receipt = await doc\.trackChanges\.decide\(/u);
  assert.match(demo, /\} catch \(cause\) \{[\s\S]{0,400}setPendingDecision\(null\)/u);
  assert.match(demo, /trackChangesHandle\?\.setActive\(target\)/u);
  assert.match(demo, /observerCleanupRef\.current/u);
  assert.match(demo, /disabled=\{pendingDecision !== null\}/u);
});

test('the custom content-control examples build one application-owned field panel', async () => {
  const [page, demo, vanilla, react] = await Promise.all(
    [
      customContentControlsPageUrl,
      customContentControlsDemoUrl,
      customContentControlsExampleUrl,
      reactCustomContentControlsExampleUrl,
    ].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomContentControlsDemo \/>/u);
  assert.match(page, /custom-content-controls-workflow\.docx/u);
  assert.match(page, /Confirm the updated field value/u);
  assert.match(page, /superdoc@2\.12\.0/u);
  assert.match(page, /\/editor\/custom-ui\/overview/u);

  assert.match(demo, /value: 80/u);
  assert.match(demo, /instance\.ui\.zoom\.set\(INITIAL_ZOOM\.value\)/u);
  assert.match(demo, /instance\.ui\.contentControls\.observe/u);
  assert.match(demo, /instance\.ui\.zoom\.observe/u);
  assert.match(demo, /fitRuntimeEditorToWidth\(instanceRef\.current\)/u);
  assert.match(demo, /textControls\.setValue/u);
  assert.match(demo, /checkboxes\.setState/u);
  assert.match(demo, /mutationIsObserved/u);
  assert.match(demo, /observerCleanupRef\.current/u);
  assert.match(demo, /pendingMutation !== null/u);

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/contract\.docx['"]/u);
    assert.match(example, /contentControls\.focus/u);
    assert.match(example, /contentControls.*text/u);
    assert.match(example, /\.setValue/u);
    assert.match(example, /contentControls.*checkbox/u);
    assert.match(example, /\.setState/u);
    assert.match(example, /controlType === 'text'/u);
    assert.match(example, /controlType === 'checkbox'/u);
    assert.match(example, /contentLocked/u);
    assert.doesNotMatch(example, /querySelector.*\[data-/u);
    assert.match(example, /await refreshFields\(\)/u);
  }

  assert.match(vanilla, /contentControls\.observe\(\(snapshot\)/u);
  // A failed update keeps the submitted draft instead of resetting the input.
  assert.match(vanilla, /drafts\.set\(control\.id, value\);\s+pendingMutation = \{ controlId/u);
  assert.match(vanilla, /lastControls = controls;/u);
  assert.match(vanilla, /request !== catalogRequest/u);
  assert.match(vanilla, /update\.disabled = locked \|\| pendingMutation !== null \|\| input\.value === currentValue/u);
  // A successful update clears the draft so later document changes show through.
  assert.match(vanilla, /drafts\.delete\(completedMutation\.controlId\)/u);
  assert.match(react, /delete next\[pendingMutation\.controlId\]/u);
  assert.match(react, /contentControls\.observe\(/u);
  assert.match(react, /request !== catalogRequest\.current/u);
  assert.match(react, /useSuperDocHost\(\)/u);
  // The demo reports a refresh failure separately from the mutation receipt.
  assert.match(demo, /refreshPinnedRuntimeCatalog\(instance, mutation\)/u);
  assert.match(demo, /The field list will refresh on the next change\./u);

  assert.match(vanilla, /mutationIsObserved/u);
  assert.match(vanilla, /if \(!receipt\.success\) failMutation/u);
  assert.doesNotMatch(vanilla, /finally \{\s*pendingMutation = null;/u);
  assert.match(react, /mutationIsObserved/u);
  assert.match(react, /if \(!receipt\.success\) \{\s*setPendingMutation\(null\);/u);
  assert.doesNotMatch(react, /finally \{\s*setPendingMutation\(null\);/u);
});

test('the content-control examples use the canonical chrome config and typed click payload', async () => {
  const [page, vanilla, react] = await Promise.all(
    [builtInContentControlsPageUrl, builtInContentControlsExampleUrl, reactBuiltInContentControlsExampleUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  assert.match(page, /href='\/fixtures\/content-controls-sample\.docx'/u);
  assert.match(page, /public\/content-controls-sample\.docx/u);
  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/content-controls-sample\.docx['"]/u);
    assert.match(example, /contentControls: true/u);
    assert.match(example, /target\.alias/u);
    assert.match(example, /target\.tag/u);
    assert.match(example, /target\.controlType/u);
    assert.doesNotMatch(example, /\b(?:modules\.contentControls|chrome:)\b/u);
  }
  assert.match(vanilla, /onContentControlClick/u);
  assert.match(react, /ContentControlClickPayload/u);
  assert.match(react, /onContentControlClick=\{handleContentControlClick\}/u);
  assert.doesNotMatch(react, /\bui=\{\{/u);
});

test('the React search example enables the built-in search surface with stable config', async () => {
  const example = await readFile(reactBuiltInSearchExampleUrl, 'utf8');

  assert.match(example, /const editorConfig = \{/u);
  assert.match(example, /search: true/u);
  assert.match(example, /ui=\{editorConfig\.ui\}/u);
  assert.doesNotMatch(example, /\bui=\{\{/u);
});

test('the custom Search examples replace only the built-in surface', async () => {
  const [page, demo, vanilla, react] = await Promise.all(
    [customSearchPageUrl, customSearchDemoUrl, customSearchExampleUrl, reactCustomSearchExampleUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  assert.match(page, /<CustomSearchDemo \/>/u);
  assert.match(page, /replaces only the Search surface/u);
  assert.match(page, /Gate \*\*Replace\s+all\*\* on `canReplaceAll`/u);
  assert.match(page, /disabled unless there is a match/u);
  assert.match(page, /application-owned context menu/u);

  assert.match(demo, /DEMO_DOCUMENT = '\/fixtures\/search-sample\.docx'/u);
  assert.match(demo, /search: false/u);
  assert.match(demo, /toolbar: \{ container: toolbarContainer/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /contentClassName='sd-custom-search-demo-workspace'/u);
  assert.match(demo, /value: 80/u);
  assert.match(demo, /instance\.ui\.zoom\.set\(INITIAL_ZOOM\.value\)/u);
  assert.match(demo, /clientWidth.*NARROW_DEMO_WIDTH/u);
  assert.match(demo, /instance\.ui\.search\.observe/u);
  assert.match(demo, /instance\.ui\.zoom\.observe/u);
  assert.match(demo, /fitRuntimeEditorToWidth\(instanceRef\.current\)/u);
  assert.match(demo, /ui\.search\.close\(\)/u);
  assert.match(demo, /replacementPending/u);

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/search-sample\.docx['"]/u);
    assert.match(example, /const editorUi = \{ search: false \} satisfies UIConfig/u);
    assert.match(example, /\bsearch\.find\(/u);
    assert.match(example, /\bsearch\.previous\(\)/u);
    assert.match(example, /\bsearch\.next\(\)/u);
    assert.match(example, /\bsearch\.replace\(/u);
    assert.match(example, /\bsearch\.replaceAll\(/u);
    assert.match(example, /canReplace/u);
    // Replace needs a match: canReplace alone is document mutability.
    assert.match(example, /!hasMatches \|\| !(?:snapshot|search)\.canReplace \|\| replacementPending/u);
    // Replace all has its own capability: a truncated session refuses it.
    assert.match(example, /canReplaceAll/u);
    assert.match(example, /replacementPending/u);
    assert.match(example, /runReplacement/u);
    assert.doesNotMatch(example, /\/contract\.docx|includeDeletedText/u);
  }

  assert.match(vanilla, /search\.observe\(render\)/u);
  assert.match(react, /useSuperDocSearch\(\)/u);

  // Both examples expose the tracked-deletion option the verification step needs.
  for (const example of [vanilla, react]) {
    assert.match(example, /includeTrackedDeletions: include/u);
  }
  assert.match(page, /Include pending deletions\*\* and search for `Legacy`/u);
  // Text typed before the Editor is ready still searches once it is.
  assert.match(vanilla, /includeDeletions\.addEventListener\('change', runSearch\);\s+\/\/[^\n]*\n\s+runSearch\(\);/u);
});

test('the custom Search example can include tracked deletions per query', async () => {
  const example = await readFile(customSearchTrackedDeletionsUrl, 'utf8');

  assert.match(example, /superdoc\.ui\.search\.find\('Legacy',/u);
  assert.match(example, /includeTrackedDeletions: true/u);
  assert.doesNotMatch(example, /\bincludeDeletedText\b/u);
});

test('the React hyperlinks example keeps restart-sensitive config identities stable', async () => {
  const example = await readFile(reactBuiltInHyperlinksExampleUrl, 'utf8');

  assert.match(example, /const editorConfig = \{/u);
  assert.match(example, /hyperlinks=\{editorConfig\.hyperlinks\}/u);
  assert.match(example, /ui=\{editorConfig\.ui\}/u);
  assert.doesNotMatch(example, /\b(?:hyperlinks|ui)=\{\{/u);
});

test('the context menu examples use the canonical composition fields', async () => {
  const examples = await Promise.all(
    [builtInContextMenuExampleUrl, reactBuiltInContextMenuExampleUrl].map((url) => readFile(url, 'utf8')),
  );

  for (const example of examples) {
    assert.match(example, /\bsections:\s*\[/u);
    assert.doesNotMatch(example, /\b(?:customItems|includeDefaultItems)\b/u);
  }
});

test('the custom context-menu examples replace only the built-in surface', async () => {
  const examples = await Promise.all(
    [customContextMenuExampleUrl, reactCustomContextMenuExampleUrl].map((url) => readFile(url, 'utf8')),
  );

  for (const example of examples) {
    assert.match(example, /document(?:=|:)\s*['"]\/contract\.docx['"]/u);
    assert.match(example, /const editorUi = \{ contextMenu: false \} satisfies UIConfig/u);
    assert.match(example, /contextMenu\.contextAt\(point\)/u);
    assert.match(example, /trackChanges\.acceptAsync/u);
    assert.match(example, /trackChanges\.rejectAsync/u);
    assert.match(example, /event\.shiftKey && event\.key === 'F10'/u);
    // A decision in flight disables both buttons, and a late decision closes
    // only the menu that started it.
    assert.match(example, /decisionPending/u);
    assert.match(example, /menuId(?:Ref\.current)? === (?:menuId|startedFrom)/u);
    // Dismissal retires the open menu so a late action cannot steal focus.
    assert.match(example, /closeMenu[\s\S]{0,200}menuId(?:Ref\.current)? \+= 1/u);
    assert.doesNotMatch(example, /viewport\.contextAt|commands\.executeAsync/u);
  }

  const [vanilla, react] = examples;
  // Copy follows the live selection rather than the snapshot taken at open time.
  assert.match(vanilla, /ui\.selection\.observe\(/u);
  assert.match(react, /useSuperDocSelection\(\)/u);
  // Only events from inside the editor container open the document menu.
  assert.match(react, /closest\('\.superdoc-editor-container'\)/u);
  assert.match(vanilla, /editorHost\.addEventListener\('contextmenu'/u);

  const html = await readFile(new URL('../snippets/editor/custom-context-menu.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="\/src\/main\.ts"><\/script>/u);
});

test('the custom document controls replace only built-in zoom', async () => {
  const [markup, vanilla, react] = await Promise.all(
    [customDocumentControlsMarkupUrl, customDocumentControlsExampleUrl, reactCustomDocumentControlsExampleUrl].map(
      (url) => readFile(url, 'utf8'),
    ),
  );

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/sample\.docx['"]/u);
    assert.match(example, /excludeItems: \['zoom'\]/u);
    assert.match(example, /ui(?::\s*editorUi|=\{editorUi\})/u);
    assert.match(example, /zoom\.set\(/u);
    assert.doesNotMatch(example, /zoom\.setMode\('fit-width'\)/u);
    assert.match(example, /document\.export\(\{ exportType: \['docx'\], triggerDownload: true \}\)/u);
    assert.match(example, /documentState\.mode|currentDocument\.mode/u);
    assert.match(example, /The document could not be read or updated\./u);
    assert.match(example, /The editor reported a runtime error\./u);
    assert.doesNotMatch(example, /\/contract\.docx|setMode\('manual'\)|toolbar: false/u);
  }

  assert.match(markup, /id="toolbar"/u);
  assert.match(markup, /id="document-error" role="alert"/u);
  assert.match(vanilla, /container: '#toolbar'/u);
  assert.match(vanilla, /ui\.zoom\.observe\(render\)/u);
  assert.match(vanilla, /ui\.document\.observe\(render\)/u);
  assert.match(vanilla, /if \(exportInFlight\) return;/u);
  assert.match(vanilla, /exportButton\.disabled = !currentDocument\.ready \|\| exportInFlight/u);
  assert.match(react, /useSuperDocZoom\(\)/u);
  assert.match(react, /useSuperDocDocument\(\)/u);
  assert.match(react, /if \(exportInFlight\.current\) return;/u);
  assert.match(react, /!documentState\.ready \|\| isExporting/u);
  assert.doesNotMatch(react, /container: '#toolbar'/u);
});

test('the custom document controls demo shows a partial ownership handoff', async () => {
  const [page, demo] = await Promise.all(
    [customDocumentControlsPageUrl, customDocumentControlsDemoUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomDocumentControlsDemo \/>/u);
  assert.match(demo, /data-custom-document-controls-demo/u);
  assert.match(demo, /excludeItems: \['zoom'\]/u);
  assert.match(demo, /ui\.zoom\.observe\(setZoom\)/u);
  assert.match(demo, /ui\.document\.observe\(setDocumentState\)/u);
  assert.match(demo, /if \(!ui \|\| exportInFlightRef\.current\) return;/u);
  assert.match(demo, /disabled=\{!controlsReady \|\| isExporting\}/u);
  // A content error after onReady is reported beside the live editor; only an
  // initial-load failure tears the session down.
  assert.match(demo, /if \(readyRef\.current\) \{\s+setRuntimeError\(/u);
  assert.match(demo, />\s*Your application\s*</u);
  assert.match(demo, />\s*SuperDoc UI\s*</u);
});

test('the dialogs and surfaces guide demonstrates both lifecycle slots', async () => {
  const [page, demo, example, styles] = await Promise.all(
    [surfaceLifecyclePageUrl, surfaceLifecycleDemoUrl, externalSurfaceExampleUrl, docsComponentsCssUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  assert.match(page, /<SurfaceLifecycleDemo \/>/u);
  // The trap is scoped to the dialog backdrop, so the guide must say the application owns
  // everything outside it rather than implying the trap covers the whole page.
  assert.match(page, /are not part of it/u);
  assert.match(page, /`inert` on the surrounding region is enough/u);
  assert.match(page, /mode: 'dialog'/u);
  assert.match(page, /mode: 'floating'/u);
  assert.match(page, /Selection and viewport APIs/u);
  assert.match(page, /`submitted`.*`closed`.*`replaced`/su);
  assert.match(page, /Destroying the Editor produces.*`destroyed`/su);

  assert.match(demo, /DEMO_DOCUMENT = '\/fixtures\/getting-started\.docx'/u);
  assert.match(demo, /data-surface-lifecycle-demo/u);
  assert.match(demo, /openSurface<ConfirmationResult>/u);
  assert.match(demo, /mode: 'dialog'/u);
  assert.match(demo, /mode: 'floating'/u);
  assert.match(demo, /observeOutcome\('Inspector'/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /contentClassName='sd-surface-lifecycle-demo-workspace'/u);
  assert.match(demo, /document\.documentElement\.requestFullscreen\(\)/u);
  assert.match(demo, /return \{\s+destroy\(\)/u);

  assert.match(example, /SurfaceOutcome<ConfirmationResult>/u);
  assert.match(example, /await confirmInEditor\(/u);
  assert.match(page, /external-surface\.html/u);
  assert.match(example, /document: '\/sample\.docx'/u);
  assert.match(example, /onContentError: reportDocumentError/u);
  assert.match(example, /onException: reportDocumentError/u);
  assert.match(example, /Could not open the document\. Reload to try again\./u);
  // A modal owns focus: the dialog's trap is bound to its own backdrop and the host stands
  // down from floating Escape while a dialog exists, so a floating surface must not be
  // openable on top of one.
  assert.match(demo, /disabled=\{!controlsReady \|\| isDialogOpen \|\| !isPreviewExpanded\}/u);
  // A collapsed preview clips the canvas the teleported host is sized to.
  assert.match(demo, /disabled=\{!controlsReady \|\| !isPreviewExpanded \|\| isDialogOpen\}/u);
  // The preview renders its own toggle outside `children`, so it needs gating too, and the
  // dialog restores focus while the opener is still disabled.
  assert.match(demo, /toggleDisabled=\{isDialogOpen\}/u);
  // A promise callback's state update renders in a later task, so a microtask queued beside it
  // still sees the disabled opener. The restore must run after the commit that re-enables it.
  assert.doesNotMatch(demo, /queueMicrotask/u);
  assert.match(demo, /restoreOpenerFocusRef\.current = true;/u);
  // Teleported toolbar menus sit above the surface host and outside the inert toolbar mount, so
  // they must be dismissed — but only after openSurface(), because SurfaceHost's floating Escape
  // handler defers to an open dialog and would otherwise close the inspector.
  const openIndex = demo.indexOf('instance.openSurface<ConfirmationResult>(');
  const dismissIndex = demo.indexOf("document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));");
  assert.ok(openIndex > 0 && dismissIndex > openIndex, 'the toolbar dismissal runs after the dialog opens');
  assert.match(
    demo,
    /useLayoutEffect\(\(\) => \{\n    if \(isDialogOpen \|\| !restoreOpenerFocusRef\.current\) return;[\s\S]*?\}, \[isDialogOpen\]\);/u,
  );
  // onContentError also covers update failures; a post-ready one must not destroy the session.
  assert.match(demo, /if \(readyRef\.current\) \{[\s\S]*?Your edits are still here/u);
  // Everything outside the dialog backdrop must be unreachable while a modal is open,
  // not just the surface buttons: the trap only sees keydowns bubbling through it.
  assert.match(demo, /inert=\{isDialogOpen\}/u);
  // Fullscreen is owned by document.documentElement, which outlives this component.
  // Cleanup must not read a DOM ref: React detaches host refs before passive effect
  // cleanup, so ownership is tracked independently.
  assert.match(demo, /ownsFullscreenRef\.current && document\.fullscreenElement/u);
  // A request that settles after unmount must hand fullscreen back itself.
  assert.match(demo, /if \(!mountedRef\.current\) \{\s*\n\s*void document\.exitFullscreen/u);
  assert.doesNotMatch(demo, /rootRef\.current\?\.dataset\.fullscreen/u);
  assert.match(demo, /document\.exitFullscreen\(\)\.catch/u);
  // A superseded dialog settles after dialogRef points at its replacement.
  assert.match(demo, /if \(activeRef\.current !== handle\)/u);
  assert.match(example, /case 'submitted'/u);
  assert.match(example, /case 'closed'/u);
  assert.match(example, /case 'replaced'/u);
  assert.match(example, /case 'destroyed'/u);
  assert.match(example, /return \{\s+destroy\(\)/u);

  assert.match(
    styles,
    /\.sd-editor-demo\[data-fullscreen='true'\][\s\S]*?z-index: calc\(var\(--sd-ui-surface-z-index, 100\) - 1\)/u,
  );
  assert.match(
    styles,
    /\.sd-surface-lifecycle-demo\[data-fullscreen='true'\][\s\S]*?z-index: calc\(var\(--sd-ui-surface-z-index, 100\) - 1\)/u,
  );
  // An unthemed teleported surface host must keep light surface tokens in dark mode, or its
  // text resolves near-white on a white background. The playground opts out via the root
  // attribute rather than the fallback being deleted for every surface demo.
  assert.match(styles, /html\.dark:not\(\[data-sd-theme-active\]\) \.sd-surface-host \{[\s\S]*?--sd-ui-text: #202124;/u);
  assert.doesNotMatch(styles, /^\.dark \.sd-surface-host \{/mu);
});

test('the theming guide moves from semantic tokens to one component override', async () => {
  const [page, demo, example, styles, preview] = await Promise.all(
    [
      themingPageUrl,
      themePlaygroundUrl,
      themeExampleUrl,
      docsComponentsCssUrl,
      new URL('../components/embeds/collapsible-editor-preview.tsx', import.meta.url),
    ].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<ThemePlayground \/>/u);
  // A post-ready content error must not destroy the session, and collapsing the preview must
  // make its clipped content unreachable rather than merely invisible.
  assert.match(demo, /if \(readyRef\.current\) \{[\s\S]*?Your edits are still here/u);
  assert.match(preview, /inert=\{!expanded\}/u);
  assert.match(page, /Start with semantic tokens/u);
  assert.match(page, /Override one component/u);
  assert.match(page, /document\.documentElement/u);
  assert.match(page, /`buildTheme\(\)`/u);
  // `colors.bg` also feeds --sd-layout-page-bg, so both the example and the playground must
  // pin the document page or a dark UI surface repaints pages behind unchanged DOCX text.
  assert.match(example, /'--sd-layout-page-bg': '#ffffff'/u);
  assert.match(demo, /'--sd-layout-page-bg': '#ffffff'/u);
  assert.match(page, /'--sd-layout-page-bg': '#ffffff'/u);
  assert.doesNotMatch(page, /fonts\.map|onFontsChanged/iu);
  assert.match(page, /`vars` accepts arbitrary string keys/u);
  assert.match(page, /Choose a token/u);
  assert.match(page, /It does not choose the fonts stored in the DOCX/u);

  assert.match(demo, /data-theme-playground/u);
  assert.match(demo, /aria-label=\{`\$\{label\} hex color`\}/u);
  assert.match(demo, /aria-invalid=\{!valid\}/u);
  assert.match(demo, /onBlur=\{\(\) => setText\(value\)\}/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /value: 80/u);
  assert.match(demo, /runtime\.createTheme\(themeConfig\)/u);
  assert.match(demo, /document\.documentElement\.classList\.add\(themeClass\)/u);
  // Fullscreen is owned by document.documentElement, which outlives this component.
  assert.match(demo, /ownsFullscreenRef\.current && document\.fullscreenElement/u);
  // The dialog's trap is backdrop-scoped, so nothing outside it may stay reachable.
  assert.match(demo, /className='sd-theme-playground-controls' inert=\{isDialogOpen\}/u);
  assert.match(demo, /className='sd-theme-playground-toolbar' inert=\{isDialogOpen\}/u);
  assert.match(demo, /<div inert=\{isDialogOpen\}>\s*\n\s*<DynamicCodeBlock/u);
  // The preview's own Collapse button renders outside `children`.
  assert.match(demo, /toggleDisabled=\{isDialogOpen\}/u);
  // A collapsed preview clips the canvas the surface host is sized to, and the dialog's
  // focus restore lands while the opener is still inert.
  assert.match(demo, /disabled=\{!controlsReady \|\| !isPreviewExpanded\}/u);
  // A promise callback's state update renders in a later task, so a microtask queued beside it
  // still sees the inert region. The restore must run after the commit that clears `inert`.
  assert.doesNotMatch(demo, /queueMicrotask/u);
  assert.match(demo, /restoreOpenerFocusRef\.current = true;/u);
  assert.match(
    demo,
    /useLayoutEffect\(\(\) => \{\n    if \(isDialogOpen \|\| !restoreOpenerFocusRef\.current\) return;[\s\S]*?\}, \[isDialogOpen\]\);/u,
  );
  // Teleported toolbar menus must be dismissed, but only after openSurface() claims the dialog
  // slot, so SurfaceHost's floating handlers defer instead of closing a surface beside it.
  const themeOpenIndex = demo.indexOf('instance.openSurface(');
  const themeDismissIndex = demo.indexOf("document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));");
  assert.ok(themeOpenIndex > 0 && themeDismissIndex > themeOpenIndex, 'the dismissal runs after the dialog opens');
  // A collapsed preview hides the header these controls live in.
  assert.match(demo, /disabled=\{!controlsReady \|\| isDialogOpen \|\| !isPreviewExpanded\}/u);
  assert.match(demo, /if \(!mountedRef\.current\) \{\s*\n\s*void document\.exitFullscreen/u);
  assert.match(demo, /'--sd-ui-toolbar-bg'/u);
  assert.match(demo, /mode: 'dialog'/u);
  assert.match(demo, /return \{\s+destroy\(\)/u);

  assert.match(example, /satisfies ThemeConfig/u);
  assert.match(example, /document\.documentElement\.classList\.add\(themeClass\)/u);
  assert.doesNotMatch(example, /new SuperDoc\(/u);
  assert.match(page, /import '\.\/theme'/u);
  assert.doesNotMatch(example, /fonts|uiDisplayFallbackFont/iu);

  assert.match(styles, /\.sd-theme-playground\[data-fullscreen='true'\]/u);
});

test('docs dark tokens outrank runtime root aliases loaded by embeds', async () => {
  const css = await readFile(new URL('../app/global.css', import.meta.url), 'utf8');
  assert.match(css, /:root\.dark\s*\{[^}]*--sd-text-secondary:\s*#aeb4c0;/u);
});

test('the custom commands guide shares one application action across two controls', async () => {
  const [page, demo, example, markup] = await Promise.all(
    [customCommandPageUrl, customCommandDemoUrl, customCommandExampleUrl, customCommandMarkupUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  assert.match(page, /title: Register an application command/u);
  assert.match(page, /A normal function is enough when one control owns an action/u);
  assert.match(page, /<CustomCommandDemo \/>/u);
  assert.match(page, /Both controls execute `application\.insertClause`/u);
  assert.match(page, /press \*\*Control-Shift-Y\*\*/u);
  assert.match(page, /`getState\(\)` describes availability; it does not block custom-command execution/u);
  assert.match(page, /Move focus outside the\s+Editor experience/u);

  assert.match(demo, /DEMO_DOCUMENT = '\/fixtures\/getting-started\.docx'/u);
  assert.match(demo, /CUSTOM_COMMAND_SHORTCUT/u);
  assert.match(demo, /value: 80/u);
  assert.match(demo, /commands\.register<InsertClausePayload>/u);
  assert.match(demo, /id: COMMAND_ID/u);
  assert.match(demo, /registration\.handle\.getState\(\)/u);
  assert.match(demo, /registration\.handle\.observe/u);
  assert.match(demo, /command\.getState\(\)/u);
  assert.match(demo, /command\.executeAsync\(\{ text: CLAUSE_TEXT, trigger \}\)/u);
  assert.match(demo, /event\.composedPath\(\)\.includes\(rootRef\.current\)/u);
  assert.match(demo, /if \(event\.repeat\) return/u);
  assert.match(demo, /matchesCustomCommandShortcut\(event\)/u);
  assert.match(demo, /shortcut: CUSTOM_COMMAND_SHORTCUT/u);
  assert.match(demo, /aria-keyshortcuts='Control\+Shift\+Y'/u);
  assert.match(demo, /window\.addEventListener\('keydown', runShortcut, true\)/u);
  assert.match(demo, /window\.removeEventListener\('keydown', runShortcut, true\)/u);
  assert.match(demo, /registration\.unregister\(\)/u);
  assert.match(demo, /onMouseDown=\{preserveSelection\}/u);
  assert.match(demo, /disabled=\{!controlsReady \|\| isPending \|\| !commandState\.enabled\}/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /contentClassName='sd-custom-command-demo-workspace'/u);

  assert.match(markup, /id="command-demo"/u);
  assert.match(markup, /id="toolbar"/u);
  assert.match(markup, /aria-keyshortcuts="Control\+Shift\+Y"/u);
  assert.match(example, /document: '\/sample\.docx'/u);
  assert.match(example, /ui: \{ toolbar: \{ container: '#toolbar' \} \}/u);
  assert.match(example, /CustomCommandHandle<InsertClausePayload>/u);
  assert.match(example, /commands\.register<InsertClausePayload>/u);
  assert.match(example, /id: 'application\.insertClause'/u);
  assert.match(example, /shortcut: 'Ctrl-Shift-Y'/u);
  assert.match(example, /onReady:[\s\S]*stopCommandState\?\.\(\);[\s\S]*unregisterCommand\?\.\(\);/u);
  assert.match(example, /if \(!command\.getState\(\)\.enabled\)/u);
  assert.match(example, /command\.executeAsync\(\{ text: clauseText, trigger \}\)/u);
  assert.match(example, /event\.composedPath\(\)\.includes\(commandDemo\)/u);
  assert.match(example, /if \(event\.repeat\) return/u);
  assert.match(example, /event\.key\.toLowerCase\(\) !== 'y'/u);
  // An IME keydown must not fire the command mid-composition.
  assert.match(example, /if \(event\.isComposing\) return;/u);
  assert.match(example, /insertClause\.addEventListener\('mousedown', preserveSelection\)/u);
  assert.match(example, /selection\.selectionTarget \?\? selection\.target/u);
  assert.match(example, /'selection-required'/u);
  // Insert degrades to replace at a non-collapsed range, so the command needs a caret.
  assert.match(example, /&& selection\.empty/u);
  assert.match(demo, /&& selection\.empty/u);
  // onContentError also covers update failures, so a post-ready error must not destroy the
  // session and the reader's edits with it.
  assert.match(demo, /if \(readyRef\.current\) \{[\s\S]*?Your edits are still here/u);
  assert.match(demo, /selection\.selectionTarget \?\? selection\.target/u);
  assert.match(page, /Custom commands do not create an authorization boundary/u);
  assert.match(page, /backend must still enforce document access/u);
  assert.match(example, /unregisterCommand\?\.\(\)/u);

  const { matchesCustomCommandShortcut } = await import(customCommandShortcutUrl.href);
  assert.equal(
    matchesCustomCommandShortcut({ altKey: false, ctrlKey: true, key: 'Y', metaKey: false, shiftKey: true }),
    true,
  );
  // An IME keydown during composition must not fire the command.
  assert.equal(
    matchesCustomCommandShortcut({
      altKey: false,
      ctrlKey: true,
      isComposing: true,
      key: 'y',
      metaKey: false,
      shiftKey: true,
    }),
    false,
  );
  assert.equal(
    matchesCustomCommandShortcut({ altKey: true, ctrlKey: true, key: 'c', metaKey: false, shiftKey: false }),
    false,
  );
});

test('the custom selection examples preserve identity and remeasure geometry', async () => {
  const [markup, vanilla, react] = await Promise.all(
    [customSelectionMarkupUrl, customSelectionExampleUrl, reactCustomSelectionExampleUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  for (const example of [vanilla, react]) {
    assert.match(example, /document(?:=|:)\s*['"]\/contract\.docx['"]/u);
    // The observer must ignore unsettled and collapsed snapshots: a capture is
    // kept on purpose while focus sits in the prompt, so only a ready non-empty
    // selection replaces it.
    assert.match(example, /selection\.status !== 'ready' \|\| selection\.empty/u);
    assert.match(example, /selection\.capture\(\)/u);
    assert.match(example, /viewport\.getRect\(\{ target, relativeTo:/u);
    assert.match(example, /viewport\.observe\(positionPrompt\)/u);
    assert.match(example, /selection\.restore\(capture|selection\.restore\(currentCapture/u);
    assert.match(example, /selectionTarget \?\? .*\.target/u);
    assert.match(example, /context: currentCapture\.quotedText/u);
    assert.match(example, /fetch\('\/api\/selection-prompt'/u);
    assert.match(example, /typeof value\.answer !== 'string'/u);
    assert.doesNotMatch(example, /getSelection\(|querySelector\([^\n]*superdoc-/u);
  }

  assert.match(markup, /id="prompt-card" hidden/u);
  assert.match(markup, /aria-label="Actions for selected text"/u);
  assert.match(markup, /id="open-selection-prompt"/u);
  assert.match(markup, /id="selection-composer" hidden/u);
  assert.match(markup, /id="close-selection-prompt"/u);
  assert.match(markup, /id="selection-question"/u);
  assert.match(markup, /id="prompt-response" hidden/u);
  assert.match(vanilla, /stopSelection\?\.\(\)/u);
  assert.match(vanilla, /stopViewport\?\.\(\)/u);
  assert.match(vanilla, /setComposerOpen\(true\)/u);
  assert.match(vanilla, /resetComposer\(\)/u);
  assert.match(vanilla, /question\.focus\(\)/u);
  assert.match(vanilla, /openPromptButton\.focus\(\)/u);
  assert.match(vanilla, /openPromptButton\.removeEventListener/u);
  assert.match(vanilla, /status\.textContent = interactionStatus/u);
  assert.match(vanilla, /requestId !== promptRequestId/u);
  assert.match(react, /useSuperDocSelection\(\)/u);
  assert.match(react, /useEffect\(\(\) => ui\?\.viewport\.observe\(positionPrompt\)/u);
  assert.match(react, /const host = ui\.viewport\.getHost\(\)/u);
  assert.match(react, /Math\.min\(preferredTop, maxTop\)/u);
  assert.match(react, /requestId !== promptRequestIdRef\.current/u);
  assert.match(react, /setIsComposerOpen\(false\)/u);
  assert.match(react, /questionRef\.current\?\.focus\(\)/u);
  assert.match(react, /actionButtonRef\.current\?\.focus\(\)/u);
  assert.match(react, /geometryStatus \?\? status/u);
});

test('selection prompt identity changes when text changes at the same offsets', async () => {
  for (const url of [customSelectionExampleUrl, reactCustomSelectionExampleUrl, customSelectionDemoUrl]) {
    const source = await readFile(url, 'utf8');
    const expression = source.match(/JSON\.stringify\([^;]*(?:nextCapture|capture)\.[^;]*\)/u)?.[0];
    assert.ok(expression, `Missing capture identity in ${url.pathname}`);
    const keyFor = Function('nextCapture', 'capture', `return ${expression};`);
    const key = (capture) => keyFor(capture, capture);
    const target = { from: 10, to: 20 };

    for (const address of [{ selectionTarget: target }, { target }]) {
      const original = { ...address, quotedText: 'thirty days', capturedAt: 1 };
      const recaptured = { ...original, capturedAt: 2 };
      const edited = { ...recaptured, quotedText: 'ninety days' };
      assert.equal(key(original), key(recaptured), 'recapturing unchanged context preserves the prompt');
      assert.notEqual(key(original), key(edited), `${url.pathname}: edited context must reset the prompt`);
    }
  }
});

test('selection prompts hide only when their range is outside the viewport', async () => {
  const rect = (left, top, width = 20, height = 20) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const cases = [
    ['inside', [rect(200, 200)], true],
    ['clipped left', [rect(-30, 200)], false],
    ['clipped right', [rect(810, 200)], false],
    ['clipped above', [rect(200, -30)], false],
    ['clipped below', [rect(200, 610)], false],
    ['partly visible left', [rect(-10, 200)], true],
    ['partly visible right', [rect(790, 200)], true],
    ['later line visible', [rect(200, -30), rect(400, 200)], true],
    ['later page visible', [rect(200, -900), rect(400, 200)], true],
    ['all fragments clipped', [rect(200, -30), rect(200, 610)], false],
  ];
  for (const url of [customSelectionExampleUrl, reactCustomSelectionExampleUrl, customSelectionDemoUrl]) {
    const source = await readFile(url, 'utf8');
    const vanilla = url === customSelectionExampleUrl;
    const start = source.indexOf('const geometry =');
    const end = source.indexOf(vanilla ? '\n    };' : '\n  },', start);
    assert.ok(start > 0 && end > start, `Missing positionPrompt in ${url.pathname}`);
    const body = source.slice(start, end);
    for (const [name, rects, visible] of cases) {
      const element = { getBoundingClientRect: () => rect(0, 0, 800, 600), clientWidth: 800 };
      const promptCard = { offsetWidth: 100, offsetHeight: 40, hidden: true, style: {}, contains: () => false };
      const focused = [];
      let position = null;
      const ui = { viewport: { getRect: () => ({ found: true, rect: rects[0], rects }), getHost: () => element } };
      const context = {
        ui, instance: { ui }, target: {}, documentElement: element, editorElement: element,
        editorShell: element, editor: element, shell: element, promptCard,
        promptRef: { current: promptCard }, composerOpenRef: { current: false }, isComposerOpen: false,
        status: { textContent: '' }, interactionStatus: '', PROMPT_EDGE: 8, PROMPT_GAP: 12,
        setPromptPosition: (value) => { position = value; }, setPosition: (value) => { position = value; },
        setGeometryMessage: () => {}, setGeometryStatus: () => {},
        // Unhiding the Vanilla card must restore focus, so the body now reads these.
        composer: { hidden: true }, question: { focus: () => focused.push('question') },
        openPromptButton: { focus: () => focused.push('openPrompt') },
        document: { activeElement: null }, restorePromptFocus: false,
        focusIsUnclaimed: () => true,
      };
      Function(...Object.keys(context), body)(...Object.values(context));
      assert.equal(vanilla ? !promptCard.hidden : position !== null, visible, `${url.pathname}: ${name}`);
      if (vanilla) {
        // The card must not steal focus from the Editor on first appearance; only a card that
        // owned focus when it was hidden gets it back.
        assert.deepEqual(focused, [], `${url.pathname}: ${name} does not steal focus`);
      }
      if (name.startsWith('later')) {
        assert.equal(vanilla ? parseFloat(promptCard.style.left) : position.left, 360, 'anchor to the visible fragment');
        assert.equal(vanilla ? parseFloat(promptCard.style.top) : position.top, 148, 'position above the visible fragment');
      }
    }
  }
});

test('React selection prompts remeasure when their card remounts', async () => {
  for (const url of [reactCustomSelectionExampleUrl, customSelectionDemoUrl]) {
    const source = await readFile(url, 'utf8');
    assert.match(source, /const isPromptVisible = (?:position|promptPosition) !== null;/u);
    // The card unmounts while the range is out of view, so focus restoration must also
    // depend on visibility or a keyboard user loses the prompt on the way back.
    assert.match(source, /\}, \[isComposerOpen, isPromptVisible\]\);/u);
    // Neither branch may steal focus: opening the composer refocuses it, a scroll-back only
    // restores focus the prompt already owned.
    assert.match(source, /composerJustOpened/u);
    assert.match(source, /restoreComposerFocusRef\.current = promptControlName\(promptRef\.current\);/u);
    const effect = source.match(/useLayoutEffect\(positionPrompt, \[[^\]]+\]\);/u)?.[0]
      ?? source.match(/useEffect\(\(\) => \{\n    if \(!capture\) return;[\s\S]*?\}, \[[^\]]+\]\);/u)?.[0];
    assert.ok(effect, `Missing positioning effect in ${url.pathname}`);
    let previous;
    let measured = 0;
    const runEffect = (callback, dependencies) => {
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) callback();
      previous = dependencies;
    };
    const positionPrompt = () => { measured++; };
    const capture = {};
    for (const isPromptVisible of [false, true, false, true]) {
      const before = measured;
      const scope = {
        useLayoutEffect: runEffect, useEffect: runEffect, positionPrompt, capture,
        answer: '', isComposerOpen: true, isPromptVisible,
        requestAnimationFrame: (callback) => { callback(); return 1; }, cancelAnimationFrame() {},
      };
      Function(...Object.keys(scope), effect)(...Object.values(scope));
      if (isPromptVisible) assert.equal(measured, before + 1, `${url.pathname}: measure the newly mounted card`);
      Function(...Object.keys(scope), effect)(...Object.values(scope));
      assert.equal(measured, before + 1, 'unchanged visibility must not trigger a render loop');
    }
  }
});

test('the comments guide does not promise the tracked panel continues its interface', async () => {
  // tracked-changes.mdx restarts from the setup guide and replaces index.html with
  // custom-tracked-review.html, which carries no comments markup, so the link must not read as
  // an addition to the panel the reader just built.
  const page = await readFile(
    new URL('../content/docs/editor/custom-ui/comments.mdx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(page, /the same review interface/u);
  assert.match(page, /separate workflow rather than a panel you add to\nthis one/u);

  const fixture = await readFile(
    new URL('../snippets/editor/custom-tracked-review.html', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(fixture, /comment/iu, 'the tracked fixture still omits the comments panel');
});

test('the surfaces guide qualifies the dialog focus trap', async () => {
  // SurfaceDialog's trapFocus() returns early when its focusable query is empty, so the
  // unconditional "dialogs trap focus" claim needs the empty-content case spelled out.
  const page = await readFile(
    new URL('../content/docs/editor/dialogs-and-surfaces.mdx', import.meta.url),
    'utf8',
  );
  assert.match(page, /The trap also needs something to hold/u);
  assert.match(page, /has no cycle\nto enforce and Tab leaves it on the first press/u);
  assert.match(page, /at least one enabled control/u);

  // Pinned to the runtime behaviour the paragraph describes.
  const dialog = await readFile(
    new URL('../../../packages/superdoc/src/components/surfaces/SurfaceDialog.vue', import.meta.url),
    'utf8',
  );
  assert.match(dialog, /if \(focusable\.length === 0\) return;/u);
});

test('the selection reference separates SelectionTarget from the geometry fallback', async () => {
  // apply() takes SelectionTarget; SelectionSlice.target is a TextTarget that only getRect()
  // accepts, so the `selectionTarget ?? target` fallback must not be copied into apply().
  const page = await readFile(new URL('../content/docs/editor/custom-ui/selection-reference.mdx', import.meta.url), 'utf8');
  assert.match(page, /`selection\.apply\(\)` takes a `SelectionTarget`/u);
  assert.match(page, /only `selectionTarget` is accepted by\n`apply\(\)`/u);
  assert.doesNotMatch(page, /`selection\.apply\(target\)`/u);
});

test('entityAt migrations reach the detailed selection reference', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/migration/v1-to-v2.json', import.meta.url), 'utf8'));
  const entries = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.v2 === 'superdoc.ui.viewport.entityAt') entries.push(node);
    Object.values(node).forEach(walk);
  };
  walk(catalog);
  assert.ok(entries.length >= 2, 'the catalog still routes entityAt migrations');

  const guide = await readFile(customSelectionPageUrl, 'utf8');
  assert.match(guide, /\/editor\/custom-ui\/selection-reference/u);
  assert.doesNotMatch(guide, /## Resolve entities under a point/u);
  const page = await readFile(new URL('../content/docs/editor/custom-ui/selection-reference.mdx', import.meta.url), 'utf8');
  for (const entry of entries) {
    assert.equal(
      entry.docsPath,
      '/editor/custom-ui/selection-reference',
      `${entry.id} must point at the page that documents entityAt`,
    );
  }
  // A runnable handler, not just the summary table row.
  assert.match(page, /ui\.viewport\.entityAt\(\{ x: event\.clientX, y: event\.clientY \}\)/u);
  assert.match(page, /ui\.viewport\.getHost\(\)/u);
  assert.match(page, /removeEventListener/u, 'the citation listener shows its cleanup');
  // The caveats are the reason this guidance cannot be reduced to the table row.
  assert.match(page, /doc\.metadata\.resolve\(\{ id: hit\.tag \}\)/u);
  assert.match(page, /painted ids are unique only within that part/u);
  assert.match(page, /Only tracked-change hits carry it/u);
});

test('prompt focus restoration yields to a deliberate focus move', async () => {
  // A card that owned focus when it scrolled away reclaims it on the way back only if nobody
  // else took it, and returns the reader to the exact control they were using. Closing the
  // composer is deliberate and always lands focus on the compact action button.
  const stripTypes = (code) => code.replace(/:\s*(HTMLElement \| null|string \| null|boolean|string)(?=[,)\s{])/gu, '');
  for (const url of [reactCustomSelectionExampleUrl, customSelectionDemoUrl]) {
    const source = await readFile(url, 'utf8');
    const helpers = ['focusIsUnclaimed', 'promptControlName', 'focusPromptControl']
      .map((name) => {
        const found = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`, 'u'));
        assert.ok(found, `Missing ${name} in ${url.pathname}`);
        return found[0];
      })
      .join('\n');
    const marker = source.indexOf('const composerJustOpened');
    const start = source.lastIndexOf('useEffect(() => {', marker);
    const tail = '}, [isComposerOpen, isPromptVisible]);';
    const end = source.indexOf(tail, marker) + tail.length;
    assert.ok(marker > 0 && start > 0 && end > start, `Missing focus effect in ${url.pathname}`);
    const program = stripTypes(`${helpers}\n${source.slice(start, end)}`);

    const cases = [
      ['a reader who moved on keeps focus', 'close', false, 'elsewhere', []],
      ['the exact control returns', 'close', false, 'body', ['close']],
      ['an unknown control falls back', 'gone', false, 'body', ['fallback']],
      ['closing the composer always lands focus', null, true, 'elsewhere', ['fallback']],
    ];
    for (const [name, restoreTarget, closedComposer, activeKind, expected] of cases) {
      const focused = [];
      class FakeElement {
        constructor(label) {
          this.label = label;
        }
        focus() {
          focused.push(this.label);
        }
        closest() {
          return this;
        }
        getAttribute() {
          return this.label;
        }
      }
      const body = new FakeElement('body');
      const controls = { close: new FakeElement('close') };
      const card = { querySelector: (selector) => controls[selector.match(/"([^"]+)"/u)[1]] ?? null };
      const fallback = { current: new FakeElement('fallback') };
      const scope = {
        HTMLElement: FakeElement,
        useEffect: (callback) => callback(),
        isComposerOpen: false,
        isPromptVisible: true,
        wasComposerOpenRef: { current: false },
        restoreComposerFocusRef: { current: restoreTarget },
        restoreActionFocusRef: { current: closedComposer },
        actionButtonRef: fallback,
        questionRef: fallback,
        promptInputRef: fallback,
        promptRef: { current: card },
        document: { activeElement: activeKind === 'body' ? body : new FakeElement('elsewhere'), body },
      };
      Function(...Object.keys(scope), program)(...Object.values(scope));
      assert.deepEqual(focused, expected, `${url.pathname}: ${name}`);
    }
  }

  // The Vanilla card is hidden rather than unmounted, so it keeps the control element itself.
  const vanilla = await readFile(customSelectionExampleUrl, 'utf8');
  assert.match(vanilla, /restorePromptFocus = focusedPromptControl\(promptCard\);/u);
  assert.match(vanilla, /control\.isConnected \? control : composer\.hidden \? openPromptButton : question/u);
});

test('the custom selection demo keeps the real editor and AI prompt in one frame', async () => {
  const [page, demo] = await Promise.all(
    [customSelectionPageUrl, customSelectionDemoUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.match(page, /<CustomSelectionDemo \/>/u);
  assert.match(page, /creates its response locally and sends no text to a model/u);
  assert.match(page, /POST \/api\/selection-prompt/u);
  assert.match(page, /captured `quotedText`/u);
  assert.match(page, /keeps the quickstart `index\.html`/u);
  assert.match(page, /For Vanilla, replace the contents of `<body>` in\s+`index\.html` with:/u);
  assert.doesNotMatch(page, /\b(?:posAtCoords|coordsAtPos|editor\.view)\b/u);
  assert.match(demo, /data-custom-selection-demo/u);
  assert.match(demo, /custom-selection-workflow\.docx/u);
  assert.match(demo, /EditorDemoViewControls/u);
  assert.match(demo, /fitRuntimeEditorToWidth/u);
  assert.match(demo, /ui\.selection\.observe\(handleSelection\)/u);
  assert.match(demo, /selection\.status !== 'ready' \|\| selection\.empty/u);
  assert.match(demo, /ui\.viewport\.observe\(\(\) => positionPrompt\(\)\)/u);
  // The prompt card unmounts when the captured range scrolls out of view, so focus
  // restoration has to depend on visibility, not only on the composer flag.
  assert.match(demo, /\}, \[isComposerOpen, isPromptVisible\]\);/u);
  assert.match(demo, /selection\.restore\(currentCapture\)/u);
  assert.match(demo, /setGeometryMessage\(null\);\n\n    const composerOpen/u);
  assert.match(demo, /geometryMessage \?\? interactionMessage/u);
  assert.match(demo, /data-mode=\{isComposerOpen \? 'composer' : 'actions'\}/u);
  assert.match(demo, /setIsComposerOpen\(true\)/u);
  assert.match(demo, /promptInputRef\.current\?\.focus\(\)/u);
  assert.match(demo, /actionButtonRef\.current\?\.focus\(\)/u);
  assert.match(demo, /fitRuntimeEditorToWidth\(superdoc\)/u);
  assert.match(demo, /createDemoAnswer\(currentCapture\.quotedText, reviewFindings\)/u);
  assert.match(demo, />\s*Simulated response\s*</u);
  assert.match(demo, /disabled=\{!prompt\.trim\(\)\}/u);
  assert.match(demo, /<CollapsibleEditorPreview[\s\S]*sd-custom-selection-demo-document/u);
});

test('the review findings layout responds to its workspace width', async () => {
  const css = await readFile(new URL('../components/docs-components.css', import.meta.url), 'utf8');
  assert.match(css, /\.sd-custom-review-findings-demo\s*\{[^}]*container-type: inline-size;[^}]*container-name: sd-review-findings;/u);
  assert.match(css, /@container sd-review-findings \(max-width: 52rem\)\s*\{\s*\.sd-custom-review-findings-workspace\s*\{\s*grid-template-columns: 1fr;/u);
});

test('the review findings guide turns an AI finding into a tracked suggestion', async () => {
  const [page, demo, example, runtime] = await Promise.all(
    [reviewHighlightsPageUrl, customSelectionDemoUrl, reviewHighlightsExampleUrl, superdocRuntimeUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  assert.match(page, /title: Turn AI findings into tracked suggestions/u);
  assert.match(page, /navTitle: Review findings/u);
  assert.match(page, /<CustomReviewFindingsDemo \/>/u);
  assert.match(page, /Saving the finding and creating the tracked change use the real Document API/u);
  assert.match(page, /Metadata does not render by itself/u);
  assert.match(page, /Bind the selection before sending the model request/u);
  assert.match(page, /Do not call `replaceFile\(\)` while `save\(\)`, `suggest\(\)`, or `remove\(\)` is pending/u);
  assert.match(page, /prevent new review actions until replacement finishes/u);
  assert.match(page, /does not cancel a write already sent to the Editor/u);
  assert.match(page, /Set `user` to the identity that should author tracked suggestions/u);
  assert.match(page, /Track changes[\s\S]*owns navigation and accept\/reject controls/u);
  assert.match(page, /If the same application action[\s\S]*\[Custom commands\]/u);
  assert.match(page, /onFindingsChanged: renderFindingPanel/u);
  assert.match(page, /refuses a selection that the reader edited while the model request was in flight/u);
  assert.match(page, /Only the newest `refresh\(\)` publishes/u);
  assert.match(page, /rejects a selection that spans\nparagraphs/u);
  assert.match(demo, /finding\.anchorStatus !== 'resolved'/u);
  // The demo reimplements the controller inline, so it must carry the same guarantees:
  // one-paragraph capture, edit invalidation, coalesced mutation refreshes, paint dropped
  // when a re-resolve fails.
  assert.match(demo, /queueMutationRefresh/u);
  assert.match(demo, /highlightLayer\.replace\(\[\]\);\s*\n\s*setFindings\(\[\]\);/u);

  assert.match(demo, /export function CustomReviewFindingsDemo/u);
  assert.match(demo, /SuperDocCtor\.defineSuperDocExtension/u);
  assert.match(demo, /ctx\.visuals\.highlight\('findings'/u);
  assert.match(demo, /doc\.metadata\.attach\(/u);
  assert.match(demo, /doc\.metadata\.remove\(/u);
  assert.match(demo, /doc\.replace\([\s\S]*changeMode: 'tracked'/u);
  assert.match(demo, /metadata\.scrollIntoView/u);
  assert.match(demo, /'Save as finding'/u);
  assert.match(demo, />\s*Show in document\s*</u);
  assert.match(demo, /Suggest edit/u);
  assert.match(demo, /contentClassName=\{reviewFindings \? 'sd-custom-review-findings-workspace'/u);

  assert.match(example, /export type ReviewFindingPayload/u);
  assert.match(example, /export type BoundReviewSelection/u);
  assert.match(example, /function isReviewFindingPayload/u);
  assert.match(example, /function toSelectionTarget/u);
  assert.match(example, /activeSource = source/u);
  assert.match(example, /if \(activeSource === source\) activeSource = null/u);
  assert.match(example, /function bindSelection\(capture: SelectionCapture\)/u);
  assert.match(example, /captureIsCurrent\(context, doc\)/u);
  // suggest() rejects a truncated verification preview, so save() must not accept a capture
  // longer than the preview limit.
  assert.match(example, /MAX_VERIFIABLE_CAPTURE_LENGTH = 200/u);
  // A quote that disagrees with the anchored text makes suggest() fail forever.
  assert.match(example, /payload\.quote !== capture\.quotedText/u);
  // An empty suggestion proposes deleting the anchored text; only an absent one means no edit.
  assert.match(example, /finding\.payload\.suggestedText === undefined/u);
  // A panel that re-renders immutably produces copies; bindings must survive that.
  // A copy must stay valid, but a row retained across a document swap must not: a replacement
  // DOCX can reuse metadata IDs, so the row carries a per-activation token instead.
  assert.match(example, /sourceToken: string;/u);
  assert.match(example, /value\.sourceToken === activeSourceToken/u);
  // Two controllers must not mint the same token on their first activation.
  assert.match(example, /crypto\.randomUUID\(\)/u);
  assert.doesNotMatch(example, /sourceBindings\.set\(row\.finding/u);
  assert.doesNotMatch(example, /if \(!suggestedText\)/u);
  assert.match(demo, /captureLength > 200/u);
  assert.match(example, /ctx\.onMutation\(/u);
  assert.match(example, /sequence !== refreshSequence/u);
  assert.match(example, /sourceIsCurrent\(finding, doc\)/u);
  assert.match(example, /expectedRevision: overlapping\.evaluatedRevision/u);
  assert.match(example, /expectedRevision: current\.evaluatedRevision/u);
  assert.match(example, /changeMode: 'tracked'/u);
  assert.match(example, /return \{ bindSelection, extension, refresh, remove, save, suggest \}/u);
  assert.match(example, /layer\?\.replace/u);
  assert.match(runtime, /'BlankDOCX' \| 'createTheme' \| 'defineSuperDocExtension'/u);
});

test('the review findings guide refreshes after a rolled-back replacement', async () => {
  // A rejected replaceFile() reopens and remounts the previous document, and the panel was
  // already cleared by refresh(null), so refreshing only on success strands that document.
  const page = await readFile(reviewHighlightsPageUrl, 'utf8');
  assert.match(page, /Refresh on both outcomes, not only on success/u);
  assert.match(page, /reopened and\nremounted/u);
});

test('rebinding the document retires rows and captures from the previous one', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const createReviewFindings = compileReviewFindingsController(example);
  const reviewFindings = createReviewFindings();
  reviewFindings.extension.activate(createReviewFindingsContext());

  // Two Editors showing copies of one DOCX: same metadata IDs, same activation, so neither the
  // id nor the activation token can tell the rows apart.
  const makeDocument = () => ({
    metadata: {
      list: async () => ({ evaluatedRevision: 1, items: [{ anchorStatus: 'resolved', id: 'finding-1' }] }),
      get: async () => ({
        payload: { kind: 'risk', question: 'q', quote: 'Twelve months', summary: 's', suggestedText: 't' },
      }),
      remove: async ({ id }) => ({ id, success: true }),
      resolve: async () => null,
    },
  });

  const first = makeDocument();
  const capture = reviewFindings.bindSelection(createReviewFindingsCapture());
  const [fromFirst] = await reviewFindings.refresh(first);
  assert.ok(capture);
  assert.ok(fromFirst);

  // Rebinding is allowed — a replacement document, or a swap racing an in-flight refresh.
  const second = makeDocument();
  const [fromSecond] = await reviewFindings.refresh(second);
  assert.ok(fromSecond, 'refresh may bind a different document');

  // But the retained row and capture belong to the previous binding and must be refused, even
  // though they carry the same activation token and the caller passes the currently bound doc.
  assert.equal(fromFirst.sourceToken, fromSecond.sourceToken, 'same activation, so only the epoch differs');
  assert.deepEqual(await reviewFindings.remove(second, fromFirst), {
    message: 'The document changed after this finding was listed. Refresh the findings.',
    success: false,
  });
  assert.deepEqual(
    await reviewFindings.save(second, capture, { question: 'q', quote: 'Twelve months', summary: 's' }),
    { message: 'The document changed after this text was selected. Select the text again.', success: false },
  );

  // The freshly listed row still works against its own binding.
  assert.deepEqual(await reviewFindings.remove(second, fromSecond), { id: 'finding-1', success: true });
});

test('the review findings controller refuses actions carrying another document', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const createReviewFindings = compileReviewFindingsController(example);
  const reviewFindings = createReviewFindings();

  reviewFindings.extension.activate(createReviewFindingsContext());
  const reviewSelection = reviewFindings.bindSelection(createReviewFindingsCapture());
  assert.ok(reviewSelection);

  let removedFromBoundDocument = null;
  const boundDocument = {
    metadata: {
      list: async () => ({ evaluatedRevision: 1, items: [{ anchorStatus: 'resolved', id: 'finding-1' }] }),
      get: async () => ({
        payload: {
          kind: 'risk',
          question: 'What should I review?',
          quote: 'Twelve months',
          summary: 'Review the liability cap.',
          suggestedText: 'the greater of twelve months of fees or USD 250,000',
        },
      }),
      remove: async ({ id }) => {
        removedFromBoundDocument = id;
        return { id, success: true };
      },
      resolve: async () => null,
    },
  };
  const [finding] = await reviewFindings.refresh(boundDocument);
  assert.ok(finding);

  // A second Editor showing a copy of the same DOCX reuses block IDs, so its metadata would
  // accept this target and attach the finding to unrelated content. Refuse before reading it.
  let otherDocumentRead = false;
  const markRead = async () => {
    otherDocumentRead = true;
    return { evaluatedRevision: 1, items: [{ anchorStatus: 'resolved', id: 'finding-1' }] };
  };
  const otherDocument = { metadata: { get: markRead, list: markRead, remove: markRead, resolve: markRead } };

  assert.deepEqual(
    await reviewFindings.save(otherDocument, reviewSelection, {
      question: 'What should I review?',
      quote: 'Twelve months',
      summary: 'Review the liability cap.',
    }),
    { message: 'The document changed after this text was selected. Select the text again.', success: false },
  );
  assert.deepEqual(await reviewFindings.suggest(otherDocument, finding), {
    message: 'The document changed after this finding was listed. Refresh the findings.',
    success: false,
  });
  assert.deepEqual(await reviewFindings.remove(otherDocument, finding), {
    message: 'The document changed after this finding was listed. Refresh the findings.',
    success: false,
  });
  assert.equal(otherDocumentRead, false, 'the other document is never read');

  // The document this activation listed still works, so the guard is not a blanket refusal.
  assert.deepEqual(await reviewFindings.remove(boundDocument, finding), { id: 'finding-1', success: true });
  assert.equal(removedFromBoundDocument, 'finding-1');
});

test('the review findings controller rejects selections and cards from a replaced document', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const createReviewFindings = compileReviewFindingsController(example);
  const reviewFindings = createReviewFindings();

  reviewFindings.extension.activate(createReviewFindingsContext());
  const reviewSelection = reviewFindings.bindSelection(createReviewFindingsCapture());
  assert.ok(reviewSelection);

  const [finding] = await reviewFindings.refresh({
    metadata: {
      list: async () => ({ items: [{ id: 'finding-1', anchorStatus: 'resolved' }] }),
      get: async () => ({
        payload: {
          kind: 'risk',
          question: 'What should I review?',
          quote: 'Twelve months',
          summary: 'Review the liability cap.',
          suggestedText: 'the greater of twelve months of fees or USD 250,000',
        },
      }),
      resolve: async () => null,
    },
  });
  assert.ok(finding);

  reviewFindings.extension.activate(createReviewFindingsContext());
  let metadataRead = false;
  const result = await reviewFindings.save(
    {
      metadata: {
        list: async () => {
          metadataRead = true;
          return { evaluatedRevision: 1, items: [] };
        },
      },
    },
    reviewSelection,
    { question: 'What should I review?', quote: 'Twelve months', summary: 'Review the liability cap.' },
  );

  assert.deepEqual(result, {
    success: false,
    message: 'The document changed after this text was selected. Select the text again.',
  });
  assert.equal(metadataRead, false);

  const removeResult = await reviewFindings.remove(
    {
      metadata: {
        list: async () => {
          metadataRead = true;
          return { evaluatedRevision: 1, items: [{ id: 'finding-1' }] };
        },
      },
    },
    finding,
  );
  assert.deepEqual(removeResult, {
    success: false,
    message: 'The document changed after this finding was listed. Refresh the findings.',
  });
  assert.equal(metadataRead, false);

  const suggestResult = await reviewFindings.suggest(
    {
      metadata: {
        list: async () => {
          metadataRead = true;
          return { evaluatedRevision: 1, items: [{ id: 'finding-1' }] };
        },
      },
    },
    finding,
  );
  assert.deepEqual(suggestResult, {
    success: false,
    message: 'The document changed after this finding was listed. Refresh the findings.',
  });
  assert.equal(metadataRead, false);
});

test('the review findings controller creates a tracked suggestion from the current anchor', async () => {
  let suggestionStatus;
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const reviewFindings = compileReviewFindingsController(example)();
  const paintedTargets = [];
  reviewFindings.extension.activate({
    disposables: { add() {} },
    visuals: { highlight: () => ({ clear() {}, replace(targets) { paintedTargets.push(targets); } }) },
    onMutation: () => () => {},
  });

  const calls = [];
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'revision-1', items: [{ id: 'finding-1', anchorStatus: 'resolved' }] }),
      update: async ({ payload }) => { suggestionStatus = payload.suggestionStatus; return { success: true, id: 'finding-1' }; },
      get: async () => ({
        payload: {
          kind: 'risk',
          question: 'What should I review?',
          quote: 'twelve months of fees',
          summary: 'The cap may be near zero.',
          suggestedText: 'the greater of twelve months of fees or USD 250,000',
          suggestionStatus,
        },
      }),
      resolve: async () => ({
        target: {
          kind: 'text',
          segments: [{ blockId: 'paragraph-1', range: { start: 12, end: 33 } }],
        },
      }),
    },
    ranges: { resolve: async () => ({ preview: { text: 'twelve months of fees', truncated: false } }) },
    replace: async (input, options) => {
      calls.push({ input, options });
      return { success: true };
    },
  };

  const [finding] = await reviewFindings.refresh(doc);
  assert.ok(finding);
  assert.equal(paintedTargets.at(-1).length, 1);
  assert.deepEqual(await reviewFindings.suggest(doc, finding), { success: true, id: 'finding-1' });
  assert.deepEqual(paintedTargets.at(-1), []);
  // The row still carries suggestedText, so a re-rendered panel must not apply it twice.
  assert.deepEqual(await reviewFindings.suggest(doc, finding), {
    success: false,
    message: 'This finding already has a tracked suggestion.',
  });
  const [reListed] = await reviewFindings.refresh(doc);
  assert.equal(reListed.suggested, true);
  assert.deepEqual(calls, [
    {
      input: {
        target: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'paragraph-1', offset: 12 },
          end: { kind: 'text', blockId: 'paragraph-1', offset: 33 },
        },
        text: 'the greater of twelve months of fees or USD 250,000',
      },
      options: { changeMode: 'tracked', expectedRevision: 'revision-1' },
    },
  ]);
});

test('the review findings controller stops accepting actions as soon as its source is torn down', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const createReviewFindings = compileReviewFindingsController(example);
  const reviewFindings = createReviewFindings();

  const activation = reviewFindings.extension.activate(createReviewFindingsContext());
  const reviewSelection = reviewFindings.bindSelection(createReviewFindingsCapture());
  assert.ok(reviewSelection);

  const [finding] = await reviewFindings.refresh({
    metadata: {
      list: async () => ({ items: [{ id: 'finding-1', anchorStatus: 'resolved' }] }),
      get: async () => ({
        payload: {
          kind: 'risk',
          question: 'What should I review?',
          quote: 'Twelve months',
          summary: 'Review the liability cap.',
          suggestedText: 'the greater of twelve months of fees or USD 250,000',
        },
      }),
      resolve: async () => null,
    },
  });
  assert.ok(finding);

  // `replaceFile()` disposes the extension before the replacement document opens, so the teardown window is the
  // dangerous one: the replacement is reachable but its activation has not run yet.
  activation.dispose();

  let metadataRead = false;
  const replacementDoc = {
    metadata: {
      list: async () => {
        metadataRead = true;
        return { evaluatedRevision: 1, items: [] };
      },
    },
  };

  assert.equal(reviewFindings.bindSelection(createReviewFindingsCapture()), null);

  const saveResult = await reviewFindings.save(replacementDoc, reviewSelection, {
    question: 'What should I review?',
    quote: 'Twelve months',
    summary: 'Review the liability cap.',
  });
  assert.deepEqual(saveResult, {
    success: false,
    message: 'The document changed after this text was selected. Select the text again.',
  });

  const removeResult = await reviewFindings.remove(replacementDoc, finding);
  assert.deepEqual(removeResult, {
    success: false,
    message: 'The document changed after this finding was listed. Refresh the findings.',
  });

  const suggestResult = await reviewFindings.suggest(replacementDoc, finding);
  assert.deepEqual(suggestResult, {
    success: false,
    message: 'The document changed after this finding was listed. Refresh the findings.',
  });
  assert.equal(metadataRead, false);
});

test('the review findings controller refuses a capture that an edit moved', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const reviewFindings = compileReviewFindingsController(example)();
  const ctx = createReviewFindingsContext();
  reviewFindings.extension.activate(ctx);

  const reviewSelection = reviewFindings.bindSelection(createReviewFindingsCapture());
  assert.ok(reviewSelection);

  // The reader edits the paragraph while the model request is still in flight. The document
  // identity is unchanged, so only the edit count can tell the frozen offsets are stale.
  ctx.emitMutation();

  let metadataRead = false;
  const result = await reviewFindings.save(
    {
      metadata: {
        list: async () => {
          metadataRead = true;
          return { evaluatedRevision: 1, items: [] };
        },
      },
    },
    reviewSelection,
    { question: 'What should I review?', quote: 'Twelve months', summary: 'Review the liability cap.' },
  );

  assert.deepEqual(result, {
    success: false,
    message: 'The document changed after this text was selected. Select the text again.',
  });
  assert.equal(metadataRead, false);
});

test('the review findings controller refuses a selection that spans paragraphs', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const reviewFindings = compileReviewFindingsController(example)();
  reviewFindings.extension.activate(createReviewFindingsContext());

  const capture = createReviewFindingsCapture();
  capture.target.segments = [
    { blockId: 'paragraph-1', range: { start: 4, end: 12 } },
    { blockId: 'paragraph-2', range: { start: 0, end: 6 } },
  ];

  // `suggest()` can only replace text inside one paragraph, so saving this would strand the finding.
  assert.equal(reviewFindings.bindSelection(capture), null);

  let metadataRead = false;
  const result = await reviewFindings.save(
    {
      metadata: {
        list: async () => {
          metadataRead = true;
          return { evaluatedRevision: 1, items: [] };
        },
      },
    },
    { capture },
    { question: 'What should I review?', quote: 'Twelve months', summary: 'Review the liability cap.' },
  );

  assert.deepEqual(result, {
    success: false,
    message: 'Select up to 200 characters inside one paragraph of plain body text before saving the finding.',
  });
  assert.equal(metadataRead, false);
});

test('the review findings guide includes the stylesheet its controller imports', async () => {
  const page = await readFile(reviewHighlightsPageUrl, 'utf8');
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const stylesheets = [...example.matchAll(/import '\.\/(.+\.css)';/gu)];
  assert.ok(stylesheets.length > 0);
  for (const [, filename] of stylesheets) {
    assert.ok(page.includes(`<include>../../../../snippets/editor/${filename}</include>`));
    assert.ok((await readFile(new URL(filename, reviewHighlightsExampleUrl), 'utf8')).trim());
  }
});

test('the review findings guide ignores superseded refreshes but reports real errors', async () => {
  const page = await readFile(reviewHighlightsPageUrl, 'utf8');
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const handler = page.match(/function showRefreshError\(error: unknown\): void \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(handler, 'The guide must provide a refresh error handler.');
  const errors = [];
  const panels = [];
  const javascript = ts.transpileModule(handler, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const showRefreshError = Function('isSupersededRefresh', 'showError', 'renderFindingPanel', `${javascript}\nreturn showRefreshError;`)(
    compileReviewFindingsController(example, 'isSupersededRefresh'),
    (error) => errors.push(error),
    (rows) => panels.push(rows),
  );
  assert.equal((page.match(/\.then\(renderFindingPanel, showRefreshError\)/gu) ?? []).length, 3);
  assert.doesNotMatch(page, /\.then\(renderFindingPanel, showError\)/u);

  const controller = compileReviewFindingsController(example)();
  controller.extension.activate(createReviewFindingsContext());
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const doc = { metadata: { list: async () => { await gate; return { items: [] }; } } };
  const older = controller.refresh(doc).then(() => assert.fail('Stale refresh published'), showRefreshError);
  const newer = controller.refresh(doc);
  release();
  await Promise.all([older, newer]);
  assert.deepEqual(errors, []);
  assert.deepEqual(panels, []);

  const failure = new Error('Metadata unavailable');
  await controller.refresh({ metadata: { list: async () => { throw failure; } } }).catch(showRefreshError);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(panels, [[]]);

  const setup = page.match(/const reviewFindings = createReviewFindings\(\{[\s\S]*?\n\}\);/u)?.[0];
  assert.ok(setup);
  const configured = Function('createReviewFindings', 'renderFindingPanel', 'showRefreshError', `${setup}\nreturn reviewFindings;`)(
    compileReviewFindingsController(example), (rows) => panels.push(rows), showRefreshError,
  );
  const ctx = createReviewFindingsContext();
  configured.extension.activate(ctx);
  let fail = false;
  await configured.refresh({ metadata: { list: async () => {
    if (fail) throw failure;
    return { items: [] };
  } } });
  fail = true;
  ctx.emitMutation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, [failure, failure]);
  assert.deepEqual(panels, [[], []]);
});

test('the review findings controller lets only the newest refresh publish', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const reviewFindings = compileReviewFindingsController(example)();
  const paintedTargets = [];
  reviewFindings.extension.activate(createReviewFindingsContext((targets) => paintedTargets.push(targets)));

  const gatedDoc = (ids) => {
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    return {
      release: () => release(),
      doc: {
        metadata: {
          list: async () => {
            await gate;
            return { evaluatedRevision: 'revision-1', items: ids.map((id) => ({ id, anchorStatus: 'resolved' })) };
          },
          get: async () => ({
            payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' },
          }),
          resolve: async () => ({
            target: { kind: 'text', segments: [{ blockId: 'paragraph-1', range: { start: 0, end: 4 } }] },
          }),
        },
      },
    };
  };

  const older = gatedDoc(['finding-1', 'finding-2']);
  const newer = gatedDoc(['finding-1']);
  const olderRefresh = reviewFindings.refresh(older.doc);
  const newerRefresh = reviewFindings.refresh(newer.doc);

  newer.release();
  const rows = await newerRefresh;
  assert.deepEqual(
    rows.map((row) => row.id),
    ['finding-1'],
  );
  const paintedByNewer = paintedTargets.at(-1);

  // The superseded call finishes last and must not restore its two-row listing.
  older.release();
  await assert.rejects(olderRefresh, /A newer refresh replaced this one/u);
  assert.deepEqual(paintedTargets.at(-1), paintedByNewer);
});

test('an absent document retires pending finding refreshes and mutation reads', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const painted = [];
  const ctx = createReviewFindingsContext((targets) => painted.push(targets));
  const controller = compileReviewFindingsController(example)();
  controller.extension.activate(ctx);
  let listCalls = 0;
  let release;
  let gate = Promise.resolve();
  const doc = { metadata: {
    list: async () => { listCalls += 1; await gate; return { items: [{ id: 'f1', anchorStatus: 'resolved' }] }; },
    get: async () => ({ payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' } }),
    resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 1 } }] } }),
  } };
  await controller.refresh(doc);
  gate = new Promise((resolve) => { release = resolve; });
  const pending = controller.refresh(doc);
  assert.deepEqual(await controller.refresh(undefined), []);
  const stale = assert.rejects(pending, /A newer refresh replaced this one/u);
  release();
  await stale;
  const paintCount = painted.length;
  ctx.emitMutation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listCalls, 2, 'Mutations must not reread the absent document');
  assert.equal(painted.length, paintCount, 'Mutations must not restore cached paint');
  gate = Promise.resolve();
  assert.equal((await controller.refresh(doc)).length, 1, 'An explicit refresh can resume');
});

test('the review findings controller suggests the stored payload, not the listed row', async () => {
  let suggestionStatus;
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const reviewFindings = compileReviewFindingsController(example)();
  reviewFindings.extension.activate(createReviewFindingsContext());

  let storedSuggestion = 'the greater of twelve months of fees or USD 250,000';
  const calls = [];
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'revision-1', items: [{ id: 'finding-1', anchorStatus: 'resolved' }] }),
      update: async ({ payload }) => { suggestionStatus = payload.suggestionStatus; return { success: true, id: 'finding-1' }; },
      get: async () => ({
        payload: {
          kind: 'risk',
          question: 'What should I review?',
          quote: 'twelve months of fees',
          summary: 'The cap may be near zero.',
          suggestedText: storedSuggestion,
          suggestionStatus,
        },
      }),
      resolve: async () => ({
        target: { kind: 'text', segments: [{ blockId: 'paragraph-1', range: { start: 12, end: 33 } }] },
      }),
    },
    ranges: { resolve: async () => ({ preview: { text: 'twelve months of fees', truncated: false } }) },
    replace: async (input, options) => {
      calls.push({ input, options });
      return { success: true };
    },
  };

  const [finding] = await reviewFindings.refresh(doc);
  assert.ok(finding);

  // Another writer revises the finding after the panel listed it.
  storedSuggestion = 'the greater of twelve months of fees or USD 500,000';

  assert.deepEqual(await reviewFindings.suggest(doc, finding), { success: true, id: 'finding-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.text, 'the greater of twelve months of fees or USD 500,000');
});

test('the review findings controller re-resolves its anchors after an edit', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const rendered = [];
  const reviewFindings = compileReviewFindingsController(example)({
    onFindingsChanged: (rows) => rendered.push(rows),
  });
  const paintedTargets = [];
  const ctx = createReviewFindingsContext((targets) => paintedTargets.push(targets));
  reviewFindings.extension.activate(ctx);

  let resolvedRange = { start: 12, end: 33 };
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'revision-1', items: [{ id: 'finding-1', anchorStatus: 'resolved' }] }),
      get: async () => ({
        payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' },
      }),
      resolve: async () => ({
        target: { kind: 'text', segments: [{ blockId: 'paragraph-1', range: { ...resolvedRange } }] },
      }),
    },
  };

  await reviewFindings.refresh(doc);
  assert.deepEqual(paintedTargets.at(-1), [{ kind: 'text', blockId: 'paragraph-1', range: { start: 12, end: 33 } }]);

  // An edit before the finding moves the durable anchor; the cached paint must follow it.
  resolvedRange = { start: 40, end: 61 };
  ctx.emitMutation();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(paintedTargets.at(-1), [{ kind: 'text', blockId: 'paragraph-1', range: { start: 40, end: 61 } }]);
  assert.equal(rendered.length, 1);
  assert.deepEqual(
    rendered[0].map((row) => row.id),
    ['finding-1'],
  );
});

test('queued finding refreshes cannot publish pre-edit targets', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const demo = await readFile(customSelectionDemoUrl, 'utf8');
  const functions = demo.slice(demo.indexOf('  const refreshFindings = useCallback('), demo.indexOf('  const teardown = useCallback('));
  const javascript = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const surface of ['demo', 'controller']) {
    const painted = [];
    let version = 0;
    const releases = [];
    const doc = { metadata: {
      list: async () => ({ items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
      get: async () => {
        if (version > 0) await new Promise((resolve) => releases.push(resolve));
        return { payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' } };
      },
      resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: `p${version}`, range: { start: 0, end: 1 } }] } }),
    } };
    let mutate;
    if (surface === 'controller') {
      const ctx = createReviewFindingsContext((targets) => painted.push(targets));
      const controller = compileReviewFindingsController(example)();
      controller.extension.activate(ctx);
      await controller.refresh(doc);
      mutate = () => ctx.emitMutation();
    } else {
      const scope = {
        useCallback: (fn) => fn, instanceRef: { current: { activeEditor: { doc } } },
        refreshIdRef: { current: 0 }, highlightLayerRef: { current: { replace: (targets) => painted.push(targets) } },
        mountedRef: { current: true }, suggestedFindingIdsRef: { current: new Set() },
        mutationRefreshRunningRef: { current: false }, mutationRefreshQueuedRef: { current: false },
        REVIEW_FINDING_NAMESPACE: 'test', isReviewFindingPayload: () => true,
        toVisualTargets: (target) => [target], setSuggestedFindingIds() {}, setFindings() {}, setInteractionMessage() {},
      };
      const demoRefresh = Function(...Object.keys(scope), `${javascript}\nreturn { refreshFindings, queueMutationRefresh };`)(...Object.values(scope));
      await demoRefresh.refreshFindings();
      mutate = demoRefresh.queueMutationRefresh;
    }
    painted.length = 0;
    version = 1;
    mutate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(releases.length, 1);
    version = 2;
    mutate();
    releases[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(painted, [], `${surface}: superseded targets must not publish`);
    assert.equal(releases.length, 2);
    releases[1]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(painted.length, 1, `${surface}: only the newest refresh paints`);
    assert.match(JSON.stringify(painted), /p2/u);
  }
});

test('the review findings controller coalesces mutation refreshes and drops paint when one fails', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const errors = [];
  const reviewFindings = compileReviewFindingsController(example)({ onFindingsError: (error) => errors.push(error) });
  const paintedTargets = [];
  const ctx = createReviewFindingsContext((targets) => paintedTargets.push(targets));
  reviewFindings.extension.activate(ctx);

  let listCalls = 0;
  let failList = false;
  const doc = {
    metadata: {
      list: async () => {
        listCalls += 1;
        if (failList) throw new Error('the worker rejected the listing');
        return { evaluatedRevision: 'revision-1', items: [{ id: 'finding-1', anchorStatus: 'resolved' }] };
      },
      get: async () => ({ payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' } }),
      resolve: async () => ({
        target: { kind: 'text', segments: [{ blockId: 'paragraph-1', range: { start: 0, end: 4 } }] },
      }),
    },
  };

  await reviewFindings.refresh(doc);
  const afterInitial = listCalls;
  assert.equal(paintedTargets.at(-1).length, 1);

  // A typing burst must not start one listing per keystroke.
  ctx.emitMutation();
  ctx.emitMutation();
  ctx.emitMutation();
  ctx.emitMutation();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(listCalls - afterInitial <= 2, `expected at most 2 coalesced refreshes, saw ${listCalls - afterInitial}`);

  // A genuine failure must drop the pre-edit paint rather than leave it over moved text.
  failList = true;
  ctx.emitMutation();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(paintedTargets.at(-1), []);
  assert.equal(errors.length, 1);
});

test('a failed winning refresh clears paint even when a mutation refresh is pending', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const painted = [];
  const controller = compileReviewFindingsController(example)();
  const ctx = createReviewFindingsContext((targets) => painted.push(targets));
  controller.extension.activate(ctx);
  let gate = Promise.resolve();
  let release;
  let fail = false;
  const doc = { metadata: {
    list: async () => {
      if (fail) throw new Error('Listing unavailable');
      await gate;
      return { items: [{ id: 'f1', anchorStatus: 'resolved' }] };
    },
    get: async () => ({ payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' } }),
    resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 1 } }] } }),
  } };
  await controller.refresh(doc);
  assert.equal(painted.at(-1).length, 1);
  gate = new Promise((resolve) => { release = resolve; });
  ctx.emitMutation();
  fail = true;
  await assert.rejects(controller.refresh(doc), /Listing unavailable/u);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(painted.at(-1), []);
});

test('a failed old mutation refresh cannot clear replacement findings', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const errors = [];
  const controller = compileReviewFindingsController(example)({ onFindingsError: (error) => errors.push(error) });
  const oldContext = createReviewFindingsContext();
  const oldActivation = controller.extension.activate(oldContext);
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
      get: async () => ({ payload: { kind: 'risk', question: 'q', quote: 'c', summary: 's' } }),
      resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 1 } }] } }),
    },
  };
  await controller.refresh(doc);
  let rejectOld;
  const originalList = doc.metadata.list;
  doc.metadata.list = () => new Promise((_, reject) => { rejectOld = reject; });
  oldContext.emitMutation();
  oldActivation.dispose();
  const paint = [];
  controller.extension.activate(createReviewFindingsContext((targets) => paint.push(targets)));
  await controller.refresh({ metadata: { ...doc.metadata, list: originalList } });
  assert.equal(paint.at(-1).length, 1);
  rejectOld(new Error('old worker disposed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(paint.at(-1).length, 1);
  assert.deepEqual(errors, []);
});

test('suggestions refuse changed or truncated anchored text', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const demo = await readFile(customSelectionDemoUrl, 'utf8');
  const demoFunction = demo.match(/  async function suggestFinding\(finding: ReviewFinding\) \{[\s\S]*?\n  \}/u)?.[0];
  assert.ok(demoFunction);
  const javascript = ts.transpileModule(demoFunction, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const preview of [{ text: 'reader edit', truncated: false }, { text: 'old', truncated: true }]) {
    let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
    let replaceCalls = 0;
    const doc = {
      metadata: {
        list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
        get: async () => ({ payload: structuredClone(payload) }),
        resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
        update: async (input) => { payload = structuredClone(input.payload); return { success: true, id: 'f1' }; },
      },
      ranges: { resolve: async (input) => { assert.equal(input.expectedRevision, 'r1'); return { preview }; } },
      replace: async () => { replaceCalls++; return { success: true }; },
    };
    const controller = compileReviewFindingsController(example)();
    controller.extension.activate(createReviewFindingsContext());
    const [finding] = await controller.refresh(doc);
    const result = await controller.suggest(doc, finding);
    assert.equal(result.success, false);
    assert.match(result.message, /text changed|too long/u);
    assert.equal(replaceCalls, 0);
    assert.equal(payload.suggestionStatus, undefined);
    let message;
    const instance = { activeEditor: { doc } };
    const scope = {
      instanceRef: { current: instance }, mountedRef: { current: true }, findingActionRef: { current: null },
      REVIEW_FINDING_NAMESPACE: 'test', isReviewFindingPayload: () => true,
      toSelectionTarget: (target) => target, setPendingFindingId() {},
      setInteractionMessage(value) { message = value; }, refreshFindings: async () => {},
    };
    const action = Function(...Object.keys(scope), `${javascript}\nreturn suggestFinding;`)(...Object.values(scope));
    await action(finding);
    assert.match(message, /text changed|too long/u);
    assert.equal(replaceCalls, 0);
    assert.equal(payload.suggestionStatus, undefined);
  }
});

test('suggestions refuse a quote another writer changed after the reservation', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const demo = await readFile(customSelectionDemoUrl, 'utf8');
  const demoFunction = demo.match(/  async function suggestFinding\(finding: ReviewFinding\) \{[\s\S]*?\n  \}/u)?.[0];
  assert.ok(demoFunction);
  const javascript = ts.transpileModule(demoFunction, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  // The reservation pins suggestionStatus, not the rest of the payload. A writer that rewrites
  // `quote` in that window leaves the verification below comparing against the pre-reservation
  // quote, so the edit would be applied against text the stored finding no longer describes.
  const buildDoc = () => {
    let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
    const state = { pendingLeft: false, replaceCalls: 0, updates: 0 };
    const doc = {
      metadata: {
        list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
        get: async () => ({ payload: structuredClone(payload) }),
        resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
        update: async (input) => {
          payload = structuredClone(input.payload);
          state.updates += 1;
          if (state.updates === 1) payload.quote = 'rewritten by another writer';
          state.pendingLeft = payload.suggestionStatus === 'pending';
          return { success: true, id: 'f1' };
        },
      },
      // The document still reads as the original quote, so only the payload check can catch this.
      ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
      replace: async () => {
        state.replaceCalls += 1;
        return { success: true };
      },
    };
    return { doc, state };
  };

  const { doc, state } = buildDoc();
  const controller = compileReviewFindingsController(example)();
  controller.extension.activate(createReviewFindingsContext());
  const [finding] = await controller.refresh(doc);
  const result = await controller.suggest(doc, finding);
  assert.equal(result.success, false);
  assert.match(result.message, /finding changed while requesting its suggestion/u);
  assert.equal(state.replaceCalls, 0);
  // The reservation was ours, so refusing must not leave the finding durably pending.
  assert.equal(state.pendingLeft, false, 'the reservation is released after a quote-only refusal');

  const demoState = buildDoc();
  const demoController = compileReviewFindingsController(example)();
  demoController.extension.activate(createReviewFindingsContext());
  const [demoFinding] = await demoController.refresh(demoState.doc);
  let message;
  const scope = {
    instanceRef: { current: { activeEditor: { doc: demoState.doc } } },
    mountedRef: { current: true },
    findingActionRef: { current: null },
    REVIEW_FINDING_NAMESPACE: 'test',
    isReviewFindingPayload: () => true,
    toSelectionTarget: (target) => target,
    setPendingFindingId() {},
    setInteractionMessage(value) {
      message = value;
    },
    refreshFindings: async () => {},
  };
  const action = Function(...Object.keys(scope), `${javascript}\nreturn suggestFinding;`)(...Object.values(scope));
  await action(demoFinding);
  assert.match(message, /finding changed while requesting its suggestion/u);
  assert.equal(demoState.state.replaceCalls, 0);
});

test('a suggestion is not marked created from a quote rewritten after the edit', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  // Promoting to `created` records the quote the tracked replacement came from and suppresses
  // further suggestions, so a quote rewritten between doc.replace() and the post-edit read must
  // not be recorded as that source.
  let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
  const statuses = [];
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
      get: async () => ({ payload: structuredClone(payload) }),
      resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
      update: async (input) => {
        payload = structuredClone(input.payload);
        statuses.push(payload.suggestionStatus);
        return { success: true, id: 'f1' };
      },
    },
    ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
    replace: async () => {
      payload.quote = 'rewritten after the edit';
      return { success: true };
    },
  };
  const controller = compileReviewFindingsController(example)();
  controller.extension.activate(createReviewFindingsContext());
  const [finding] = await controller.refresh(doc);
  const result = await controller.suggest(doc, finding);
  assert.equal(result.success, false);
  assert.match(result.message, /edit was added, but the finding changed/u);
  assert.ok(!statuses.includes('created'), 'the rewritten quote is never promoted to created');
});

test('an interrupted suggestion publishes its pending row to the active panel', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const panels = [];
  const controller = compileReviewFindingsController(example)({ onFindingsChanged: (rows) => panels.push(rows) });
  controller.extension.activate(createReviewFindingsContext());
  let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
      get: async () => ({ payload: structuredClone(payload) }),
      resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
      update: async (input) => { payload = structuredClone(input.payload); return { success: true, id: 'f1' }; },
    },
    ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
    replace: async () => { throw new Error('connection interrupted'); },
  };
  const [finding] = await controller.refresh(doc);
  assert.equal(finding.payload.suggestionStatus, undefined);
  assert.deepEqual(await controller.suggest(doc, finding), { success: false, message: 'connection interrupted' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(panels.at(-1)?.[0].payload.suggestionStatus, 'pending');
});

test('suggestion status survives a fresh controller and blocks interrupted retries', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const create = compileReviewFindingsController(example);
  for (const failure of ['none', 'reserve', 'replace', 'record', 'changed-payload']) {
    let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
    let replaceCalls = 0;
    const doc = {
      metadata: {
        list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
        get: async () => ({ payload: structuredClone(payload) }),
        resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
        update: async (input) => {
          if ((failure === 'reserve' && input.payload.suggestionStatus === 'pending') ||
              (failure === 'record' && input.payload.suggestionStatus === 'created')) {
            return { success: false, failure: { message: 'status write failed' } };
          }
          payload = structuredClone(input.payload);
          if (failure === 'changed-payload') payload.suggestedText = 'another writer changed this';
          return { success: true, id: 'f1' };
        },
      },
      ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
      replace: async () => {
        replaceCalls++;
        if (failure === 'replace') throw new Error('connection interrupted');
        return { success: true };
      },
    };
    const controller = create();
    controller.extension.activate(createReviewFindingsContext());
    const [finding] = await controller.refresh(doc);
    assert.equal((await controller.suggest(doc, finding)).success, failure === 'none');
    const reopened = create();
    const paint = [];
    reopened.extension.activate(createReviewFindingsContext((targets) => paint.push(targets)));
    const [row] = await reopened.refresh(doc);
    assert.equal(row.payload.suggestionStatus, failure === 'reserve' ? undefined : failure === 'none' ? 'created' : 'pending');
    assert.equal((await reopened.suggest(doc, row)).success, false);
    assert.equal(replaceCalls, failure === 'reserve' || failure === 'changed-payload' ? 0 : 1);
    if (failure === 'none') assert.deepEqual(paint.at(-1), []);
  }
});

test('completed suggestions do not mark another writer\'s payload as created', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const create = compileReviewFindingsController(example);
  const demo = await readFile(customSelectionDemoUrl, 'utf8');
  const demoFunction = demo.match(/async function suggestFinding\([\s\S]*?(?=\n  async function )/u)?.[0];
  assert.ok(demoFunction);
  const javascript = ts.transpileModule(demoFunction, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const surface of ['controller', 'demo']) {
   for (const change of ['text', 'status']) {
    let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
    let updateCalls = 0;
    const doc = {
      metadata: {
        list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
        get: async () => ({ payload: structuredClone(payload) }),
        resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
        update: async (input) => {
          updateCalls++;
          payload = structuredClone(input.payload);
          return { success: true, id: 'f1' };
        },
      },
      ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
      replace: async ({ text }) => {
        assert.equal(text, 'new');
        if (change === 'text') payload.suggestedText = 'another suggestion';
        else delete payload.suggestionStatus;
        return { success: true };
      },
    };
    const controller = create();
    controller.extension.activate(createReviewFindingsContext());
    const [finding] = await controller.refresh(doc);
    if (surface === 'controller') {
      const result = await controller.suggest(doc, finding);
      assert.equal(result.success, false, change);
      assert.match(result.message, /edit was added/u);
    } else {
      let message;
      const instance = { activeEditor: { doc }, ui: { selection: { apply() {} } } };
      const scope = {
        instanceRef: { current: instance }, mountedRef: { current: true }, findingActionRef: { current: null },
        REVIEW_FINDING_NAMESPACE: 'test', isReviewFindingPayload: () => true,
        toSelectionTarget: (target) => target, setPendingFindingId() {},
        setInteractionMessage(value) { message = value; }, refreshFindings: async () => {},
      };
      const action = Function(...Object.keys(scope), `${javascript}\nreturn suggestFinding;`)(...Object.values(scope));
      await action(finding);
      assert.match(message, /edit was added.*finding changed/u);
    }
    assert.equal(updateCalls, 1, change);
    const reopened = create();
    reopened.extension.activate(createReviewFindingsContext());
    const [row] = await reopened.refresh(doc);
    assert.equal(row.payload.suggestedText, change === 'text' ? 'another suggestion' : 'new');
    assert.equal(row.payload.suggestionStatus, change === 'text' ? 'pending' : undefined);
   }
  }
});

test('confirmed replacement failures release reservations without overwriting newer findings', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const demo = await readFile(customSelectionDemoUrl, 'utf8');
  const demoFunction = demo.match(/  async function suggestFinding\(finding: ReviewFinding\) \{[\s\S]*?\n  \}/u)?.[0];
  assert.ok(demoFunction);
  const javascript = ts.transpileModule(demoFunction, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  for (const surface of ['controller', 'demo']) {
    for (const failure of ['orphan', 'receipt', 'throw', 'cleanup', 'newer-status', 'read-list', 'read-get', 'read-resolve']) {
      let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
      let revision = 1;
      let replaceCalls = 0;
      let readFailed = false;
      const failRead = (method) => {
        if (failure === `read-${method}` && payload.suggestionStatus === 'pending' && !readFailed) {
          readFailed = true;
          throw new Error('preflight read failed');
        }
      };
      const doc = {
        metadata: {
          list: async () => { failRead('list'); return { evaluatedRevision: String(revision), items: [{ id: 'f1', anchorStatus: 'resolved' }] }; },
          get: async () => { failRead('get'); return { payload: structuredClone(payload) }; },
          resolve: async () => { failRead('resolve'); return failure === 'orphan' && payload.suggestionStatus === 'pending'
            ? null
            : { target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }; },
          update: async (input, options) => {
            assert.equal(options.expectedRevision, String(revision));
            if (failure === 'cleanup' && input.payload.suggestionStatus === undefined) {
              return { success: false, failure: { message: 'cleanup rejected' } };
            }
            payload = structuredClone(input.payload);
            revision++;
            return { success: true, id: 'f1' };
          },
        },
        ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
        replace: async () => {
          replaceCalls++;
          revision++;
          if (failure === 'throw') throw new Error('connection interrupted');
          payload.summary = 'updated by another writer';
          if (failure === 'newer-status') payload.suggestionStatus = 'created';
          return { success: false, failure: { message: 'revision changed' } };
        },
      };
      let suggest;
      if (surface === 'controller') {
        const controller = compileReviewFindingsController(example)();
        controller.extension.activate(createReviewFindingsContext());
        const [finding] = await controller.refresh(doc);
        suggest = () => controller.suggest(doc, finding);
      } else {
        const instance = { activeEditor: { doc } };
        const scope = {
          instanceRef: { current: instance }, mountedRef: { current: true }, findingActionRef: { current: null },
          REVIEW_FINDING_NAMESPACE: 'test', isReviewFindingPayload: () => true,
          toSelectionTarget: (target) => target, setPendingFindingId() {}, setInteractionMessage() {},
          refreshFindings: async () => {},
        };
        const action = Function(...Object.keys(scope), `${javascript}\nreturn suggestFinding;`)(...Object.values(scope));
        suggest = () => action({ id: 'f1', payload });
      }
      await suggest();
      assert.equal(payload.suggestionStatus, failure === 'receipt' || failure === 'orphan' || failure.startsWith('read-') ? undefined : failure === 'newer-status' ? 'created' : 'pending', `${surface}: ${failure}`);
      if (failure.startsWith('read-')) assert.equal(replaceCalls, 0, 'a failed preflight never attempts replacement');
      if (failure === 'receipt') assert.equal(payload.summary, 'updated by another writer');
      await suggest();
      assert.equal(replaceCalls, failure === 'orphan' ? 0 : failure === 'receipt' ? 2 : 1, `${surface}: ${failure} retry`);
    }
  }
});

test('saving a finding never copies caller-supplied suggestion status', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const create = compileReviewFindingsController(example);
  for (const suggestionStatus of ['pending', 'created']) {
    const controller = create();
    controller.extension.activate(createReviewFindingsContext());
    let saved;
    const doc = { metadata: {
      list: async () => ({ evaluatedRevision: 'r1', items: [] }),
      attach: async ({ payload }) => { saved = payload; return { success: true, id: 'f1' }; },
    } };
    const context = controller.bindSelection(createReviewFindingsCapture());
    // The quote must match the bound capture; this test is about suggestionStatus, not the quote.
    const payload = { question: 'q', quote: 'Twelve months', summary: 's', suggestedText: 'new', suggestionStatus };
    assert.equal((await controller.save(doc, context, payload)).success, true);
    assert.deepEqual(saved, { kind: 'risk', question: 'q', quote: 'Twelve months', summary: 's', suggestedText: 'new' });
  }
});

test('the findings callback publishes created status after an early mutation refresh', async () => {
  const example = await readFile(reviewHighlightsExampleUrl, 'utf8');
  const published = [];
  const controller = compileReviewFindingsController(example)({ onFindingsChanged: (rows) => published.push(rows) });
  const context = createReviewFindingsContext();
  controller.extension.activate(context);
  let payload = { kind: 'risk', question: 'q', quote: 'old', summary: 's', suggestedText: 'new' };
  const doc = {
    metadata: {
      list: async () => ({ evaluatedRevision: 'r1', items: [{ id: 'f1', anchorStatus: 'resolved' }] }),
      get: async () => ({ payload: structuredClone(payload) }),
      resolve: async () => ({ target: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 3 } }] } }),
      update: async (input) => { payload = structuredClone(input.payload); return { success: true, id: 'f1' }; },
    },
    ranges: { resolve: async () => ({ preview: { text: 'old', truncated: false } }) },
    replace: async () => {
      context.emitMutation();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(published.at(-1)[0].payload.suggestionStatus, 'pending');
      return { success: true };
    },
  };
  const [finding] = await controller.refresh(doc);
  assert.equal((await controller.suggest(doc, finding)).success, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published.at(-1)[0].payload.suggestionStatus, 'created');
  assert.equal(published.at(-1)[0].suggested, true);
});

test('saving a demo finding rejects edits made while the metadata preflight is pending', async () => {
  const demo = await readFile(customSelectionDemoUrl, 'utf8');
  const source = demo.match(/  async function saveFinding\(\) \{[\s\S]*?\n  \}/u)?.[0];
  assert.ok(source);
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const recapture of [false, true]) {
    const mutationEpochRef = { current: 0 };
    const captureEpochRef = { current: 0 };
    let attaches = 0;
    const messages = [];
    const doc = { metadata: {
      list: async () => {
        mutationEpochRef.current++;
        if (recapture) captureEpochRef.current = mutationEpochRef.current;
        return { evaluatedRevision: 'after-edit', items: [] };
      },
      attach: async () => { attaches++; return { success: false, failure: { message: 'unexpected attach' } }; },
    } };
    const scope = {
      instanceRef: { current: { activeEditor: { doc } } },
      captureRef: { current: { target: { kind: 'selection' }, quotedText: 'old text' } },
      captureEpochRef, mutationEpochRef,
      prompt: 'question', answer: { summary: 'summary' }, findingActionRef: { current: null },
      mountedRef: { current: true }, toSelectionTarget: (target) => target,
      setInteractionMessage: (message) => messages.push(message), setIsSavingFinding() {},
      REVIEW_FINDING_NAMESPACE: 'test',
    };
    const save = Function(...Object.keys(scope), `${javascript}\nreturn saveFinding;`)(...Object.values(scope));
    await save();
    assert.equal(attaches, 0, `recaptured during preflight: ${recapture}`);
    assert.match(messages.at(-1), /document changed after this text was selected/u);
  }
});

test('the built-in Editor demos keep focused controls and restart-safe configuration changes', async () => {
  const demo = await readFile(editorDemoUrl, 'utf8');

  assert.match(demo, /customItems:\s*\[\s*\{\s*type: 'button',\s*id: 'addReviewNote',\s*region: 'center'/u);
  assert.match(demo, /onSelect: \(\{ insertText \}\) => insertText\('Review note: '\)/u);
  assert.doesNotMatch(demo, /customButtons:/u);
  assert.match(demo, /getPinnedFocusedToolbarOptions\(builtInToolbar!, \{ left: \['search'\] \}\)/u);
  assert.match(
    demo,
    /search:\s*\{\s*replaceEnabled: initialReplaceControls,\s*includeDeletedText: initialIncludeTrackedDeletions,/u,
  );
  assert.match(demo, /toolbar: getPinnedToolbarOptions\(initialToolbarStrategy, builtInToolbar!\)/u);
  assert.match(
    demo,
    /interaction:\s+preset === 'comments' \? \{ comments: \{ level: initialCommentsLevel \} \} : undefined/u,
  );
  assert.match(demo, /getPinnedCommentsOptions\(preset === 'comments' \? initialCommentsLayout : 'inline'\)/u);
  assert.match(demo, /return \{ displayMode: layout \}/u);
  assert.match(demo, /export\(\{ exportType: \['docx'\], triggerDownload: false \}\)/u);
  assert.match(demo, /const currentDocumentMode = instance\.config\.documentMode/u);
  assert.match(demo, /const hadMountedEditor = instanceRef\.current !== null/u);
  assert.match(demo, /setState\(replacedEditor \|\| !hadMountedEditor \? 'error' : 'ready'\)/u);
  assert.match(
    demo,
    /commentsLayout,\s+commentsLevel,\s+contentControlChrome,\s+contextMenuStrategy,\s+documentMode: currentDocumentMode,\s+hyperlinkBehavior,\s+includeTrackedDeletions,\s+replaceControls,\s+toolbarStrategy,/u,
  );
  assert.match(
    demo,
    /setDemoInteractionBlocked\(true\)[\s\S]*Promise\.all\([\s\S]*finally \{\s+if \(mountedRef\.current && loadId === loadIdRef\.current\) setDemoInteractionBlocked\(false\);/u,
  );
  assert.match(demo, /setDemoInteractionBlocked\(true\)[\s\S]*instance\.export/u);
  assert.match(demo, /retryMountRef\.current = retry/u);
  assert.match(demo, /document\.documentElement\.requestFullscreen\(\)/u);
  assert.match(demo, /finally \{\s+setDemoInteractionBlocked\(false\)/u);
  assert.match(demo, /onZoomChange: \(\{ zoom: nextZoom \}\)/u);
  assert.match(demo, /label='Mode'[\s\S]*options=\{documentModes\}/u);
  assert.match(demo, /documentMode === 'viewing'[\s\S]*label='Changes'[\s\S]*options=\{viewingTrackedChangesModes\}/u);
  assert.match(demo, /instance\.setViewingOptions\(\{ trackedChanges: mode \}\)/u);
  assert.match(demo, /className='sd-editor-demo-config-reset'/u);
  assert.doesNotMatch(demo, /sd-editor-demo-mode-(?:header|footer|switcher)/u);
  assert.match(demo, /label='Toolbar'[\s\S]*options=\{toolbarDemoStrategies\}/u);
  assert.match(demo, /label='Layout'[\s\S]*options=\{commentsDemoLayouts\}/u);
  assert.match(demo, /label='Actions'[\s\S]*options=\{commentsDemoLevels\}/u);
  assert.match(demo, /label='Built-in chrome'[\s\S]*value=\{contentControlChrome \? 'show' : 'hide'\}/u);
  assert.match(demo, /label='Menu'[\s\S]*options=\{contextMenuDemoStrategies\}/u);
  assert.match(demo, /label='Activation'[\s\S]*options=\{hyperlinkDemoBehaviors\}/u);
  assert.match(demo, /preset === 'ruler' \? \{ comments: false, ruler: true \} : \{\}/u);
  assert.match(demo, /instanceRef\.current\?\.toggleRuler\(\)/u);
  assert.match(demo, /instanceRef\.current\?\.setMeasurementUnit\(unit\)/u);
  assert.match(demo, /ui\.selection\.observe[\s\S]*setRulerActive\(hasRulerSelection\(snapshot\)\)/u);
  assert.match(demo, /getRulerHint\(rulerActive\)/u);
  assert.match(demo, /label='Ruler'[\s\S]*label='Measurements'/u);
  assert.match(demo, /label='Replace controls'/u);
  assert.match(demo, /label='Tracked deletions'/u);
});

test('the shared Editor demo fit-width helper uses V2 base page metrics', async () => {
  const { EDITOR_DEMO_FIT_WIDTH_PADDING, fitRuntimeEditorToWidth } = await import(editorDemoZoomUrl);
  const calls = [];
  const instance = {
    activeEditor: {
      pageMetrics: {
        getSnapshot: () => ({
          pages: [{ base: { widthPx: 816 } }, { base: { widthPx: 1056 } }],
        }),
      },
    },
    getViewportMetrics: () => ({ availableWidth: 658 }),
    getZoomState: () => ({ max: 100, min: 50 }),
    ui: {
      zoom: {
        set: (value) => calls.push(['set', value]),
        setMode: (mode) => calls.push(['setMode', mode]),
      },
    },
  };

  assert.equal(EDITOR_DEMO_FIT_WIDTH_PADDING, 2);
  assert.equal(fitRuntimeEditorToWidth(instance), true);
  assert.deepEqual(calls, [
    ['set', 62],
    ['setMode', 'fit-width'],
  ]);
});

test('the shared Editor demo view controls preserve every interaction contract', async () => {
  const { Window } = await import('happy-dom');
  const browserWindow = new Window({ url: 'https://docs.superdoc.dev/' });
  const globalNames = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: browserWindow },
    document: { configurable: true, value: browserWindow.document },
    navigator: { configurable: true, value: browserWindow.navigator },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });

  const [{ act, createElement }, { createRoot }, { EditorDemoViewControls }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import(editorDemoViewControlsUrl),
  ]);
  const interactions = [];
  const container = browserWindow.document.createElement('div');
  browserWindow.document.body.append(container);
  const root = createRoot(container);

  const render = async (overrides = {}) => {
    await act(async () =>
      root.render(
        createElement(EditorDemoViewControls, {
      disabled: false,
      fitActive: false,
      isFullscreen: false,
      onFit: () => interactions.push('fit'),
      onFullscreen: () => interactions.push('fullscreen'),
      onZoom: (direction) => interactions.push(direction),
      zoom: { max: 150, min: 50, mode: 'manual', value: 100 },
      ...overrides,
        }),
      ),
    );
  };
  const button = (label) => {
    const match = container.querySelector(`button[aria-label='${label}']`);
    assert.ok(match instanceof browserWindow.HTMLButtonElement, `Missing ${label} button.`);
    return match;
  };
  const click = (label) => act(async () => button(label).click());

  try {
    await render();
    await click('Zoom out');
    await click('Fit document to width');
    await click('Zoom in');
    await click('Enter fullscreen');

    assert.deepEqual(interactions, [-1, 'fit', 1, 'fullscreen']);
    assert.equal(button('Fit document to width').getAttribute('aria-pressed'), 'false');
    assert.equal(button('Fit document to width').textContent, '100%');

    await render({ fitActive: true, isFullscreen: true });
    assert.equal(button('Fit document to width').getAttribute('aria-pressed'), 'true');
    assert.equal(button('Fit document to width').textContent, 'Fit');
    button('Exit fullscreen');

    await render({ zoom: { max: 150, min: 50, mode: 'manual', value: 50 } });
    assert.equal(button('Zoom out').disabled, true);
    assert.equal(button('Zoom in').disabled, false);

    await render({ zoom: { max: 150, min: 50, mode: 'manual', value: 150 } });
    assert.equal(button('Zoom out').disabled, false);
    assert.equal(button('Zoom in').disabled, true);

    await render({ disabled: true });
    assert.ok([...container.querySelectorAll('button')].every((control) => control.disabled));
  } finally {
    await act(async () => root.unmount());
    browserWindow.close();
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('the Ruler demo derives its live hint from the current selection', async () => {
  const { getRulerHint, hasRulerSelection } = await import('../lib/built-in-editor-demos.ts');

  assert.equal(hasRulerSelection({}), false);
  assert.equal(getRulerHint(hasRulerSelection({})), 'Click in the document to enable the margin handles.');
  assert.equal(hasRulerSelection({ target: { from: 1, to: 1 } }), true);
  assert.equal(
    getRulerHint(hasRulerSelection({ target: { from: 1, to: 1 } })),
    'Drag either margin handle to reflow the page.',
  );
  assert.equal(hasRulerSelection({ selectionTarget: { from: 1, to: 1 } }), true);
});

test('the generated reference model mirrors the canonical operation inventory', async () => {
  const model = JSON.parse(await readFile(documentApiReferenceModelUrl, 'utf8'));
  const contractOperationIds = await readContractOperationIds();
  const modelOperationIds = Object.keys(model.operations).sort();
  const operationPaths = Object.values(model.operations).map((operation) => operation.path);

  assert.deepEqual(modelOperationIds, [...contractOperationIds].sort());
  assert.equal(new Set(operationPaths).size, modelOperationIds.length);
});

test('the generated reference navigation does not repeat page-tree entries', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../content/docs/document-api/reference/meta.json', import.meta.url), 'utf8'),
  );

  assert.equal(new Set(metadata.pages).size, metadata.pages.length);
  assert.ok(metadata.pages.includes('document-index'));
});

test('the reference generator emits raw schemas as same-origin artifacts', async () => {
  const model = JSON.parse(await readFile(documentApiReferenceModelUrl, 'utf8'));
  const query = model.operations['query.match'];
  const rawSchemas = JSON.parse(
    await readFile(new URL(`../public/reference/document-api/${query.path}.json`, import.meta.url), 'utf8'),
  );

  assert.equal(rawSchemas.operationId, 'query.match');
  assert.equal(rawSchemas.$schema, model.schemaDialect);
  assert.deepEqual(rawSchemas.schemas, query.schemas);
  const references = [...JSON.stringify(rawSchemas).matchAll(/"#\/\$defs\/([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(references.length > 0);
  assert.ok(Object.keys(rawSchemas.$defs).length < Object.keys(model.definitions).length);
  assert.deepEqual(
    references.filter((reference) => !Object.hasOwn(rawSchemas.$defs, reference)),
    [],
  );
});

test('the Content Controls curation covers every operation exactly once', async () => {
  const model = JSON.parse(await readFile(documentApiReferenceModelUrl, 'utf8'));
  const curation = await import('../lib/document-api-reference/curation.ts');
  const operationIds = model.groups.find((group) => group.key === 'contentControls').operationIds;
  const curatedIds = curation.getNamespaceJobs('contentControls', operationIds).flatMap((job) => job.operationIds);

  assert.equal(new Set(curatedIds).size, curatedIds.length);
  assert.deepEqual([...curatedIds].sort(), [...operationIds].sort());
});

test('the proofing starter checks repeated words with segment-local UTF-16 offsets', async () => {
  const { proofing } = await import('../snippets/editor/proofing-provider.ts');
  const segments = [{ id: 'paragraph', text: '😀 teh teh other', metadata: { surface: 'body' } }];
  const result = await proofing.provider.check({ segments });
  assert.deepEqual(result.issues.map(({ start, end, segmentId }) => ({ start, end, segmentId })), [
    { start: 3, end: 6, segmentId: 'paragraph' },
    { start: 7, end: 10, segmentId: 'paragraph' },
  ]);
  assert.equal((await proofing.provider.check({ segments: [] })).issues.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(proofing.provider.check({ segments, signal: controller.signal }), { name: 'AbortError' });
});

test('the proofing starter leaves words with Unicode letters, marks, or numbers intact', async () => {
  const { proofing } = await import('../snippets/editor/proofing-provider.ts');
  const segments = [{ id: 'paragraph', text: 'caféteh teh猫 e\u0301teh teh\u0301 ١teh teh١ _teh teh_', metadata: { surface: 'body' } }];
  assert.deepEqual((await proofing.provider.check({ segments })).issues, []);
  const punctuation = [{ id: 'paragraph', text: '(teh), teh!', metadata: { surface: 'body' } }];
  assert.deepEqual((await proofing.provider.check({ segments: punctuation })).issues.map(({ start, end }) => ({ start, end })), [
    { start: 1, end: 4 },
    { start: 7, end: 10 },
  ]);
});

test('the generated proofing reference mirrors the exported fields', async () => {
  const generatedProofingConfig = JSON.parse(await readFile(generatedProofingConfigUrl, 'utf8'));
  const superdocTypes = await readFile(superdocCoreTypesUrl, 'utf8');

  const configBody = superdocTypes.match(/export interface ProofingConfig \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const providerBody = superdocTypes.match(/export interface ProofingProvider \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const configFields = [...configBody.matchAll(/^\s{2}(\w+)\??:/gmu)].map((match) => match[1]).sort();
  const documentedFields = generatedProofingConfig.fields.map((field) => field.name).sort();
  assert.deepEqual(documentedFields, configFields);
  assert.equal(new Set(documentedFields).size, documentedFields.length);
  assert.ok(generatedProofingConfig.fields.every((field) => field.type && field.description));

  const providerField = generatedProofingConfig.fields.find((field) => field.name === 'provider');
  const providerTypeName = configBody.match(/^\s{2}provider\??:\s*([^;]+);/mu)?.[1];
  const providerCheck = providerBody.match(/^\s{2}check:\s*([^;]+);/mu)?.[1];
  const providerFields = [...providerBody.matchAll(/^\s{2}(\w+)\??:/gmu)].map((match) => match[1]).sort();
  const documentedProviderFields = [...(providerField?.type ?? '').matchAll(/^\s{2}(\w+)\??:/gmu)]
    .map((match) => match[1])
    .sort();

  assert.ok(providerField);
  assert.equal(providerField.typeName, providerTypeName);
  assert.deepEqual(documentedProviderFields, providerFields);
  assert.ok(providerCheck && providerField.type.includes(`check: ${providerCheck};`));
});

test('the generated Search reference mirrors every canonical nested field', async () => {
  const [generatedSearchConfig, generatedSearchFloatingConfig, generatedSearchStrings, superdocTypes] =
    await Promise.all([
      readFile(generatedSearchConfigUrl, 'utf8').then(JSON.parse),
      readFile(generatedSearchFloatingConfigUrl, 'utf8').then(JSON.parse),
      readFile(generatedSearchStringsUrl, 'utf8').then(JSON.parse),
      readFile(superdocCoreTypesUrl, 'utf8'),
    ]);

  const sourceFields = (typeName) => {
    const body = superdocTypes.match(new RegExp(`export interface ${typeName}(?: extends [^{]+)? \\{([\\s\\S]*?)\\n\\}`, 'u'))?.[1] ?? '';
    return [...body.matchAll(/^\s{2}(\w+)\??:/gmu)].map((match) => match[1]);
  };
  const generatedFields = (reference) => reference.fields.map((field) => field.name);

  assert.deepEqual(generatedFields(generatedSearchConfig), sourceFields('SearchConfig'));
  assert.deepEqual(generatedFields(generatedSearchFloatingConfig), sourceFields('SearchFloatingConfig'));
  assert.deepEqual(generatedFields(generatedSearchStrings), sourceFields('SearchStrings'));
  assert.ok(
    [generatedSearchConfig, generatedSearchFloatingConfig, generatedSearchStrings].every((reference) =>
      reference.fields.every((field) => field.type && field.description && !field.deprecated),
    ),
  );
});

test('the generated Hyperlinks reference mirrors every canonical field', async () => {
  const [generatedHyperlinksConfig, superdocTypes] = await Promise.all([
    readFile(generatedHyperlinksConfigUrl, 'utf8').then(JSON.parse),
    readFile(superdocCoreTypesUrl, 'utf8'),
  ]);
  const configBody = superdocTypes.match(/export interface HyperlinksConfig \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const sourceFields = [...configBody.matchAll(/^\s{2}(\w+)\??:/gmu)].map((match) => match[1]);
  const generatedFields = generatedHyperlinksConfig.fields.map((field) => field.name);

  assert.deepEqual(generatedFields, sourceFields);
  assert.equal(new Set(generatedFields).size, generatedFields.length);
  assert.ok(generatedHyperlinksConfig.fields.every((field) => field.type && field.description && !field.deprecated));
});

test('the Loading configuration explorer mirrors UIConfig.loading', async () => {
  const [generatedLoadingConfig, superdocTypes] = await Promise.all([
    readFile(generatedLoadingConfigUrl, 'utf8').then(JSON.parse),
    readFile(superdocCoreTypesUrl, 'utf8'),
  ]);
  const { loadingConfigExplorer } = await import('../lib/loading-config-explorer.ts');
  const { configFieldTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const uiConfigBody = superdocTypes.match(/export interface UIConfig \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const loadingDeclaration = uiConfigBody.match(/^\s{2}loading\??:\s*([^;]+);/mu);
  const field = loadingConfigExplorer.fields[0];
  const group = loadingConfigExplorer.groups[0];

  assert.ok(loadingDeclaration, 'UIConfig.loading must remain public.');
  assert.deepEqual(generatedLoadingConfig.fields.map((candidate) => candidate.name), ['loading']);
  assert.equal(field.name, 'loading');
  assert.equal(field.type, loadingDeclaration[1].trim());
  assert.equal(field.default, 'true');
  assert.equal(
    configFieldTemplate(loadingConfigExplorer, group, field),
    ['ui: {', '  loading: false', '}'].join('\n'),
  );
  assert.match(renderConfigReferenceMarkdown(loadingConfigExplorer), /\| `loading` \| `boolean` \| `true` \|/u);
});

test('the Hyperlinks configuration explorer renders the canonical activation result', async () => {
  const { hyperlinksConfigExplorer } = await import('../lib/hyperlinks-config-explorer.ts');
  const { configFieldTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const field = hyperlinksConfigExplorer.fields[0];
  const group = hyperlinksConfigExplorer.groups[0];

  assert.equal(field.name, 'onActivate');
  assert.equal(field.default, 'undefined');
  assert.match(configFieldTemplate(hyperlinksConfigExplorer, group, field), /type: 'suppress'/u);
  assert.match(renderConfigReferenceMarkdown(hyperlinksConfigExplorer), /\| `onActivate` \|/u);
  assert.doesNotMatch(renderConfigReferenceMarkdown(hyperlinksConfigExplorer), /type: 'none'/u);
});

test('the generated Context menu reference mirrors every canonical field', async () => {
  const [generatedContextMenuConfig, superdocTypes] = await Promise.all([
    readFile(generatedContextMenuConfigUrl, 'utf8').then(JSON.parse),
    readFile(superdocCoreTypesUrl, 'utf8'),
  ]);
  const configBody = superdocTypes.match(/export interface ContextMenuConfig \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const compatibilityFields = new Set(['customItems', 'includeDefaultItems']);
  const sourceFields = [...configBody.matchAll(/^\s{2}(?:readonly\s+)?(\w+)\??:/gmu)]
    .map((match) => match[1])
    .filter((name) => !compatibilityFields.has(name));
  const generatedFields = generatedContextMenuConfig.fields.map((field) => field.name);

  assert.deepEqual(generatedFields, sourceFields);
  assert.equal(new Set(generatedFields).size, generatedFields.length);
  assert.ok(generatedContextMenuConfig.fields.every((field) => field.type && field.description && !field.deprecated));
  assert.match(configBody, /@deprecated replaceWith=`sections`/u);
  assert.match(configBody, /@deprecated replaceWith=`defaultItems`/u);
});

test('the Ruler configuration explorer mirrors the canonical UI and Editor fields', async () => {
  const [{ rulerConfigExplorer }, { renderConfigReferenceMarkdown }, generatedUi, generatedEditor] = await Promise.all([
    import('../lib/ruler-config-explorer.ts'),
    import('../lib/config-explorer.ts'),
    readFile(generatedRulerUiConfigUrl, 'utf8').then(JSON.parse),
    readFile(generatedRulerEditorConfigUrl, 'utf8').then(JSON.parse),
  ]);

  assert.deepEqual(generatedUi.fields.map((field) => field.name), ['ruler']);
  assert.deepEqual(
    generatedEditor.fields.map((field) => field.name).sort(),
    ['measurementUnit', 'onPageMarginsChange'],
  );
  assert.deepEqual(
    rulerConfigExplorer.fields.map((field) => field.name),
    ['ui.ruler', 'measurementUnit', 'onPageMarginsChange'],
  );
  assert.deepEqual(
    rulerConfigExplorer.groups.map((group) => group.label),
    ['Ruler', 'Measurements', 'Events'],
  );
  const markdown = renderConfigReferenceMarkdown(rulerConfigExplorer);
  assert.match(markdown, /\| `ui\.ruler` \|/u);
  assert.match(markdown, /\| `onPageMarginsChange` \|/u);
  assert.doesNotMatch(markdown, /\| `rulers` \||\| `rulerContainer` \|/u);
});

test('the Context menu configuration explorer renders valid canonical examples', async () => {
  const { contextMenuConfigExplorer } = await import('../lib/context-menu-config-explorer.ts');
  const { configFieldTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const field = (name) => contextMenuConfigExplorer.fields.find((candidate) => candidate.name === name);
  const group = (id) => contextMenuConfigExplorer.groups.find((candidate) => candidate.id === id);
  const markdown = renderConfigReferenceMarkdown(contextMenuConfigExplorer);

  assert.deepEqual(
    contextMenuConfigExplorer.fields.map((candidate) => candidate.name),
    ['openOnSlash', 'sections', 'defaultItems', 'menuProvider'],
  );
  assert.match(configFieldTemplate(contextMenuConfigExplorer, group('items'), field('sections')), /ui: \{/u);
  assert.match(configFieldTemplate(contextMenuConfigExplorer, group('items'), field('sections')), /onSelect:/u);
  assert.match(configFieldTemplate(contextMenuConfigExplorer, group('advanced'), field('menuProvider')), /item\.disabled/u);
  assert.doesNotMatch(markdown, /customItems|includeDefaultItems/u);
});

test('the Search configuration explorer renders valid nested examples', async () => {
  const { searchConfigExplorer } = await import('../lib/search-config-explorer.ts');
  const { configFieldTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const names = searchConfigExplorer.fields.map((field) => field.name);
  const field = (name) => searchConfigExplorer.fields.find((candidate) => candidate.name === name);
  const group = (id) => searchConfigExplorer.groups.find((candidate) => candidate.id === id);

  assert.equal(names.length, 34);
  assert.equal(new Set(names).size, names.length);
  assert.ok(searchConfigExplorer.fields.every((candidate) => candidate.summary?.length));
  assert.deepEqual(
    searchConfigExplorer.groups.map((candidate) => candidate.id),
    ['behavior', 'position', 'focus', 'text', 'accessibility'],
  );
  assert.equal(field('replaceControls')?.default, 'true');
  assert.equal(field('floating.placement')?.default, "'top-right'");
  assert.equal(field('strings.noResults')?.default, "'No results'");

  const positionExample = configFieldTemplate(searchConfigExplorer, group('position'), field('floating.placement'));
  assert.equal(
    positionExample,
    [
      'ui: {',
      '  search: {',
      '    floating: {',
      "      placement: 'bottom-right'",
      '    },',
      '  },',
      '}',
    ].join('\n'),
  );
  const textExample = configFieldTemplate(searchConfigExplorer, group('text'), field('strings.noResults'));
  assert.match(textExample, /strings: \{\n\s+noResults: 'No matches'/u);
  assert.doesNotMatch(textExample, /noResultsLabel/u);

  const markdown = renderConfigReferenceMarkdown(searchConfigExplorer);
  assert.match(markdown, /\| `replaceControls` \| `boolean` \| `true` \|/u);
  assert.match(markdown, /\| `floating\.placement` \|/u);
  assert.match(markdown, /\| `strings\.findAriaLabel` \|/u);
  assert.doesNotMatch(markdown, /replaceEnabled|includeDeletedText|noResultsLabel/u);
});

test('the Toolbar configuration explorer covers every canonical option', async () => {
  const generatedToolbarConfig = JSON.parse(await readFile(generatedToolbarConfigUrl, 'utf8'));
  const { toolbarConfigExplorer } = await import('../lib/toolbar-config-explorer.ts');
  const { configFieldTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const generatedNames = generatedToolbarConfig.fields.map((field) => field.name);
  const names = toolbarConfigExplorer.fields.map((field) => field.name);
  const field = (name) => toolbarConfigExplorer.fields.find((candidate) => candidate.name === name);
  const group = (id) => toolbarConfigExplorer.groups.find((candidate) => candidate.id === id);

  assert.deepEqual(generatedNames, [
    'container',
    'items',
    'excludeItems',
    'icons',
    'strings',
    'overflow',
    'responsiveTo',
    'fontOptions',
    'customItems',
    'includeItems',
  ]);
  assert.deepEqual([...names].sort(), [...generatedNames].sort());
  assert.equal(new Set(names).size, names.length);
  assert.ok(toolbarConfigExplorer.fields.every((candidate) => candidate.summary?.length));
  assert.ok(generatedToolbarConfig.fields.every((candidate) => candidate.type && candidate.description && !candidate.deprecated));
  assert.deepEqual(
    toolbarConfigExplorer.groups.map((candidate) => candidate.id),
    ['controls', 'layout', 'appearance'],
  );
  assert.equal(field('overflow')?.default, "'menu'");
  assert.equal(field('responsiveTo')?.default, "'viewport'");
  assert.match(field('container')?.summary ?? '', /Leave this unset to let React's SuperDocEditor/u);

  const items = field('items');
  const controls = group('controls');
  assert.ok(items && controls);
  assert.equal(
    configFieldTemplate(toolbarConfigExplorer, controls, items),
    [
      'ui: {',
      '  toolbar: {',
      "    items: { left: ['undo', 'redo'], center: ['bold', 'italic'], right: ['document-mode'] }",
      '  },',
      '}',
    ].join('\n'),
  );

  const markdown = renderConfigReferenceMarkdown(toolbarConfigExplorer);
  assert.match(markdown, /\| `items` \|/u);
  assert.match(markdown, /\| `customItems` \|/u);
  assert.match(markdown, /\| `responsiveTo` \| `"container" \\| "viewport"` \| `'viewport'` \|/u);
  assert.doesNotMatch(
    markdown,
    /\| `(?:groups|texts|hideButtons|responsiveToContainer|fonts|customButtons|showFormattingMarksButton|showTableOfContentsButton)` \|/u,
  );
});

test('the Comments configuration explorer keeps layout and actions in their canonical namespaces', async () => {
  const [generatedCommentsConfig, generatedCommentsResponsiveConfig, generatedCommentInteractionConfig] =
    await Promise.all([
      readFile(generatedCommentsConfigUrl, 'utf8').then(JSON.parse),
      readFile(generatedCommentsResponsiveConfigUrl, 'utf8').then(JSON.parse),
      readFile(generatedCommentInteractionConfigUrl, 'utf8').then(JSON.parse),
    ]);
  const { commentsConfigExplorer } = await import('../lib/comments-config-explorer.ts');
  const { configFieldTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const field = (name) => commentsConfigExplorer.fields.find((candidate) => candidate.name === name);
  const group = (id) => commentsConfigExplorer.groups.find((candidate) => candidate.id === id);

  assert.deepEqual(
    generatedCommentsConfig.fields.map((candidate) => candidate.name),
    ['layout', 'responsive'],
  );
  assert.deepEqual(
    generatedCommentsResponsiveConfig.fields.map((candidate) => candidate.name),
    ['target', 'breakpoint'],
  );
  assert.deepEqual(
    generatedCommentInteractionConfig.fields.map((candidate) => candidate.name),
    ['level'],
  );
  assert.deepEqual(
    commentsConfigExplorer.fields.map((candidate) => candidate.name),
    [
      'ui.comments.layout',
      'ui.comments.responsive.target',
      'ui.comments.responsive.breakpoint',
      'interaction.comments.level',
    ],
  );
  assert.ok(commentsConfigExplorer.fields.every((candidate) => candidate.summary?.length));
  assert.deepEqual(commentsConfigExplorer.sources, [
    'CommentsConfig',
    'CommentsResponsiveConfig',
    'CommentInteractionConfig',
  ]);
  assert.equal(field('ui.comments.layout')?.default, "'sidebar'");
  assert.equal(field('interaction.comments.level')?.default, "'resolve'");

  const level = field('interaction.comments.level');
  const actions = group('actions');
  assert.ok(level && actions);
  assert.equal(
    configFieldTemplate(commentsConfigExplorer, actions, level),
    ['interaction: {', '  comments: {', "    level: 'write'", '  },', '}'].join('\n'),
  );

  const markdown = renderConfigReferenceMarkdown(commentsConfigExplorer);
  assert.match(markdown, /\| `ui\.comments\.layout` \|/u);
  assert.match(markdown, /\| `ui\.comments\.responsive\.breakpoint` \|/u);
  assert.match(markdown, /\| `interaction\.comments\.level` \|/u);
  assert.doesNotMatch(markdown, /\b(?:displayMode|readOnly|allowResolve|compactBreakpointPx)\b/u);
});

test('the Editor configuration reference starts with concise essential fields', async () => {
  const { editorConfigExplorer } = await import('../lib/editor-config-explorer.ts');
  const { configTemplate, renderConfigReferenceMarkdown } = await import('../lib/config-explorer.ts');
  const essentials = editorConfigExplorer.fields
    .filter((field) => field.group === 'essentials')
    .map((field) => field.name);
  const lifecycle = editorConfigExplorer.fields
    .filter((field) => field.group === 'lifecycle')
    .map((field) => field.name);

  assert.deepEqual(essentials, ['selector', 'document', 'documentMode', 'user']);
  assert.ok(['onReady', 'onContentError', 'onException'].every((field) => lifecycle.includes(field)));
  const copiedSetup = configTemplate(editorConfigExplorer);
  assert.match(copiedSetup, /onReady:/u);
  assert.match(copiedSetup, /onContentError:/u);
  assert.match(copiedSetup, /onException:/u);
  assert.ok(editorConfigExplorer.fields.every((field) => field.summary?.length));
  assert.ok(editorConfigExplorer.fields.every((field) => !field.summary?.includes('Painter plan')));
  assert.equal(editorConfigExplorer.fields.find((field) => field.name === 'onSidebarToggle')?.type, '(isOpened: boolean) => void');
  assert.equal(
    editorConfigExplorer.fields.find((field) => field.name === 'onException')?.type,
    '(params: SuperDocExceptionPayload) => void',
  );
  const onExceptionDescription =
    editorConfigExplorer.fields.find((field) => field.name === 'onException')?.description ?? '';
  assert.match(onExceptionDescription, /can accompany a legacy exception payload/iu);
  assert.match(onExceptionDescription, /filters unsupported internal records/iu);
  assert.match(
    onExceptionDescription,
    /translated package and readiness records[^.]*at most one structured diagnostic for each `\(documentId, generation, internalCode\)` tuple/iu,
  );
  assert.match(onExceptionDescription, /suppresses a generic boot diagnostic when a more specific package diagnostic/iu);
  assert.doesNotMatch(onExceptionDescription, /one per underlying internal record/iu);
  assert.doesNotMatch(onExceptionDescription, /emitted in addition to, not instead of/iu);
  const interactionType = editorConfigExplorer.fields.find((field) => field.name === 'interaction')?.type ?? '';
  assert.match(interactionType, /comments\?: \{ level\?: CommentInteractionLevel; \}/u);
  assert.doesNotMatch(interactionType, /CommentInteractionConfig|readOnly|allowResolve/u);
  const permissionResolver = editorConfigExplorer.fields.find((field) => field.name === 'permissionResolver');
  assert.equal(permissionResolver?.summary, 'Customize client-side permission decisions.');
  assert.match(permissionResolver?.description ?? '', /^Customize client-side permission decisions\./u);
  assert.doesNotMatch(permissionResolver?.description ?? '', /comment and tracked-change permission decisions/iu);
  const fieldNames = new Set(editorConfigExplorer.fields.map((field) => field.name));
  for (const legacyField of [
    'comments',
    'conversations',
    'editorExtensions',
    'format',
    'html',
    'jsonOverride',
    'markdown',
    'onEditorBeforeCreate',
    'onEditorDestroy',
    'onFontsResolved',
    'onListDefinitionsChange',
    'onTransaction',
    'onUnsupportedContent',
    'rulerContainer',
    'rulers',
    'suppressDefaultDocxStyles',
    'trackChanges',
    'warnOnUnsupportedContent',
  ]) {
    assert.equal(fieldNames.has(legacyField), false, `${legacyField} should not appear in the current Config Explorer`);
  }
  assert.equal(fieldNames.has('experimental'), false);
  const useLayoutEngine = editorConfigExplorer.fields.find((field) => field.name === 'useLayoutEngine');
  assert.equal(useLayoutEngine?.type, 'boolean');
  assert.match(useLayoutEngine?.description ?? '', /omit `layoutEngineOptions`/u);
  assert.match(useLayoutEngine?.description ?? '', /initial non-default zoom/u);
  assert.match(useLayoutEngine?.description ?? '', /does not select a different DOCX renderer/u);
  assert.doesNotMatch(useLayoutEngine?.description ?? '', /Whether DOCX documents use the layout engine/u);
  assert.equal(useLayoutEngine?.deprecated, undefined);
  assert.equal(
    editorConfigExplorer.fields.find((field) => field.name === 'modules')?.type,
    '{\n  trackChanges?: TrackChangesModuleConfig;\n}',
  );
  assert.doesNotMatch(renderConfigReferenceMarkdown(editorConfigExplorer), /Deprecated\./u);
});

test('deprecated HTML and Markdown initializers name complete body replacements', async () => {
  const superdocTypes = await readFile(superdocCoreTypesUrl, 'utf8');
  assert.ok(
    superdocTypes.includes(
      "@deprecated replaceWith=`doc.replace({ target: { kind: 'story', storyType: 'body' }, type: 'html', value }) after onReady` removeIn=v3.0",
    ),
  );
  assert.ok(
    superdocTypes.includes(
      "@deprecated replaceWith=`doc.replace({ target: { kind: 'story', storyType: 'body' }, type: 'markdown', value }) after onReady` removeIn=v3.0",
    ),
  );
});

test('the lifecycle journey maps the application states to public Editor signals', async () => {
  const { lifecycleFailure, lifecycleStages, renderLifecycleJourneyMarkdown } =
    await import('../lib/lifecycle-journey.ts');

  assert.deepEqual(
    lifecycleStages.map((stage) => stage.id),
    ['mount', 'ready', 'edit', 'save', 'unmount'],
  );
  assert.deepEqual(
    lifecycleStages.map((stage) => stage.signal),
    ['new SuperDoc()', 'onReady', 'onEditorUpdate', 'export() + fetch()', 'destroy()'],
  );
  assert.match(lifecycleFailure.signal, /onContentError.*onException/u);

  const markdown = renderLifecycleJourneyMarkdown();
  assert.match(markdown, /Mark the document saved only after your backend accepts them/u);
  assert.match(markdown, /Show a retry path instead of an empty mount point/u);
});

test('the document storage example preserves unsaved state and reports failures', async () => {
  const [storage, reactStorage] = await Promise.all(
    [documentStorageExampleUrl, reactDocumentStorageExampleUrl].map((url) => readFile(url, 'utf8')),
  );

  assert.match(storage, /const savedRevision = editRevision/u);
  assert.match(storage, /editRevision === savedRevision \? 'Saved' : 'Unsaved changes'/u);
  assert.match(storage, /Could not open the document\. Reload to try again\./u);
  assert.match(storage, /Save failed\. Try again\./u);
  assert.match(reactStorage, /if \(savingRef\.current\) return;/u);
  assert.match(reactStorage, /savingRef\.current = true;[\s\S]*finally \{\s+savingRef\.current = false;/u);
  assert.match(reactStorage, /const savedRevision = editRevisionRef\.current/u);
  assert.match(reactStorage, /editRevisionRef\.current === savedRevision \? 'Saved' : 'Unsaved changes'/u);
  assert.match(reactStorage, /setSaveStatus\('Save failed\. Try again\.'\)/u);
  assert.match(reactStorage, /<output aria-live='polite'>/u);
  assert.match(reactStorage, /onContentError/u);
  assert.match(reactStorage, /onException/u);
});

test('Quickstart examples report both document failure paths', async () => {
  const [vanilla, react] = await Promise.all(
    [vanillaQuickstartExampleUrl, reactQuickstartExampleUrl].map((url) => readFile(url, 'utf8')),
  );

  for (const example of [vanilla, react]) {
    assert.match(example, /onContentError/u);
    assert.match(example, /onException/u);
  }
});

test('mutation and headless examples keep their safety guards', async () => {
  const [reviewHighlights, commentThread, pythonSdk, cli] = await Promise.all(
    [reviewHighlightsExampleUrl, commentThreadExampleUrl, pythonSdkExampleUrl, cliExampleUrl].map((url) =>
      readFile(url, 'utf8'),
    ),
  );

  assert.match(reviewHighlights, /expectedRevision: overlapping\.evaluatedRevision/u);
  assert.match(reviewHighlights, /expectedRevision: current\.evaluatedRevision/u);
  assert.match(commentThread, /expectedRevision: match\.evaluatedRevision/u);
  assert.match(commentThread, /expectedRevision: afterCreate\.evaluatedRevision/u);
  assert.match(commentThread, /expectedRevision: afterReply\.evaluatedRevision/u);
  assert.match(pythonSdk, /try:[\s\S]*finally:\s+document\.close\(\{"discard": True\}\)/u);
  assert.match(cli, /trap 'superdoc close --discard [^']+' EXIT/u);
});

test('every meta.json page entry resolves to real content', async () => {
  // A renamed section leaves the parent meta.json pointing at a directory that
  // no longer exists. Nothing else catches it: the build silently drops the
  // missing entry, so the section just stops appearing in the sidebar.
  const unresolved = [];

  async function checkMeta(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    if (entries.some((entry) => entry.name === 'meta.json')) {
      const metaUrl = new URL('meta.json', directory);
      const meta = JSON.parse(await readFile(metaUrl, 'utf8'));

      for (const page of meta.pages ?? []) {
        // Fumadocs control entries (separators, rest globs) name no file.
        if (typeof page !== 'string' || page.startsWith('...') || page.startsWith('---')) continue;

        const candidates = [`${page}.mdx`, `${page}/meta.json`, `${page}/index.mdx`];
        const resolved = await Promise.all(candidates.map((path) => pathExists(new URL(path, directory))));
        if (!resolved.some(Boolean)) unresolved.push(`${metaUrl.pathname}: "${page}"`);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) await checkMeta(new URL(`${entry.name}/`, directory));
    }
  }

  await checkMeta(contentRoot);
  assert.deepEqual(unresolved, []);
});

test('the sidebar section picker matches the root navigation sections', async () => {
  const layout = await readFile(layoutUrl, 'utf8');
  const links = layout.match(/links:\s*\[([\s\S]*?)\],\s*nav:/u)?.[1] ?? '';
  const linkedSections = new Set(
    [...links.matchAll(/(?:href=|url:\s*)'\/([^/'#?]+)(?:\/[^']*)?'/gu)].map(([, section]) => section),
  );
  const rootSections = new Set();

  for (const entry of await readdir(contentRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaUrl = new URL(`${entry.name}/meta.json`, contentRoot);
    if (!(await pathExists(metaUrl))) continue;
    const meta = JSON.parse(await readFile(metaUrl, 'utf8'));
    if (meta.root === true) rootSections.add(entry.name);
  }

  assert.deepEqual([...linkedSections].sort(), [...rootSections].sort());
});

test('the agent example allows exactly the tracked-capable actions', async () => {
  // The example refuses edits that cannot record a suggestion. That allowlist
  // is a copy of which actions accept `changeMode`, so it has to be pinned to
  // the SDK or it will silently drift into permitting untracked edits.
  const actionsSource = await readFile(
    new URL('../../../packages/sdk/langs/node/src/agent/actions.ts', import.meta.url),
    'utf8',
  );
  const actionArgs = actionsSource.match(/export const ACTION_ARGS[^=]*=\s*\{([\s\S]*?)\n\};/u)?.[1] ?? '';
  const hints = actionsSource.match(/export const ACTION_HINTS[^=]*=\s*\{([\s\S]*?)\n\};/u)?.[1] ?? '';
  // An action can declare changeMode and still refuse to honor it. move_range
  // is the current example: its hint says tracked mode fails without mutating.
  const directOnly = new Set(
    [...hints.matchAll(/\n {2}([a-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/gu)]
      .filter(([, , hint]) => /direct-only|tracked["']?\s*(?:mode\s*)?fails|cannot be tracked/iu.test(hint))
      .map(([, name]) => name),
  );
  const supported = new Set(
    [...actionArgs.matchAll(/\n {2}([a-z0-9_]+):\s*\[([\s\S]*?)\],/gu)]
      .filter(([, name, args]) => args.includes('changeMode') && !directOnly.has(name))
      .map(([, name]) => name),
  );

  const example = await readFile(new URL('../snippets/agents/agent-loop.mjs', import.meta.url), 'utf8');
  const declared = new Set(
    [
      ...(example.match(/const TRACKED_CAPABLE_ACTIONS = new Set\(\[([\s\S]*?)\]\)/u)?.[1] ?? '').matchAll(
        /'([a-z0-9_]+)'/gu,
      ),
    ].map(([, name]) => name),
  );

  assert.ok(supported.size > 0, 'no changeMode-capable actions found in the SDK');
  assert.deepEqual([...declared].sort(), [...supported].sort());
});

test('MDX components and demo presets use the supported authoring vocabulary', async () => {
  const unsupported = [];

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');
    const prose = markdown.replace(/```[\s\S]*?```/g, '');
    const components = [...prose.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1]);

    for (const component of new Set(components)) {
      if (!registeredComponents.has(component)) unsupported.push(`${file.pathname}: <${component}>`);
    }

    for (const match of prose.matchAll(/<EditorDemo\b[^>]*\bpreset=['"]([^'"]+)['"]/g)) {
      if (!editorDemoPresets.has(match[1])) unsupported.push(`${file.pathname}: EditorDemo preset ${match[1]}`);
    }
  }

  assert.deepEqual(unsupported, []);
});

test('the Content controls feature maps control shapes to focused workflows', async () => {
  const page = await readFile(new URL('../content/docs/editor/content-controls/index.mdx', import.meta.url), 'utf8');
  const meta = JSON.parse(
    await readFile(new URL('../content/docs/editor/content-controls/meta.json', import.meta.url), 'utf8'),
  );
  assert.equal(meta.title, 'Templates and fields');
  assert.match(page, /^title: Templates and fields$/m);
  const { contentControlPatterns, renderContentControlPatternsMarkdown } = await import(
    '../lib/content-control-patterns.ts',
  );
  const markdown = renderContentControlPatternsMarkdown();

  assert.deepEqual(
    contentControlPatterns.map(({ id }) => id),
    ['inline', 'block', 'repeating'],
  );
  assert.match(page, /<ContentControlPatterns \/>/u);
  assert.match(page, /\/editor\/content-controls\/add-fields-to-a-docx-template/u);
  assert.match(page, /\/editor\/content-controls\/fill-a-docx-template/u);
  assert.match(page, /\/editor\/content-controls\/replace-clauses-from-your-application/u);
  assert.match(page, /\/editor\/content-controls\/lock-template-fields/u);
  assert.match(page, /\/editor\/custom-ui\/content-controls/u);
  assert.match(markdown, /Block-level/u);
  assert.match(markdown, /Repeating section/u);
  assert.doesNotMatch(markdown, /<ContentControlPatterns/u);
});

test('the Content controls template guides stay focused and agent-readable', async () => {
  const meta = JSON.parse(await readFile(new URL('../content/docs/editor/content-controls/meta.json', import.meta.url), 'utf8'));
  assert.ok(meta.pages.indexOf('fill-a-docx-template') < meta.pages.indexOf('add-fields-to-a-docx-template'));
  const lockSnippet = await readFile(new URL('../snippets/editor/set-template-field-lock.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(lockSnippet, /from ['"]@superdoc\/document-api['"]/u);
  const authoring = await readFile(
    new URL('../content/docs/editor/content-controls/add-fields-to-a-docx-template.mdx', import.meta.url),
    'utf8',
  );
  const fill = await readFile(
    new URL('../content/docs/editor/content-controls/fill-a-docx-template.mdx', import.meta.url),
    'utf8',
  );
  const clauses = await readFile(
    new URL('../content/docs/editor/content-controls/replace-clauses-from-your-application.mdx', import.meta.url),
    'utf8',
  );
  const locks = await readFile(
    new URL('../content/docs/editor/content-controls/lock-template-fields.mdx', import.meta.url),
    'utf8',
  );
  const { renderClauseLibraryMarkdown } = await import('../lib/clause-library.ts');
  const { contentControlLockModes, getContentControlLockMode, renderContentControlLocksMarkdown } = await import(
    '../lib/content-control-locks.ts'
  );
  const { renderContentControlAuthoringMarkdown } = await import('../lib/content-control-authoring.ts');
  const { renderTemplatePopulationMarkdown, templatePopulationFields } = await import('../lib/template-population.ts');
  const authoringMarkdown = renderContentControlAuthoringMarkdown();
  const populationMarkdown = renderTemplatePopulationMarkdown();
  const clauseMarkdown = renderClauseLibraryMarkdown();
  const lockMarkdown = renderContentControlLocksMarkdown();

  assert.match(authoring, /<ContentControlAuthoringDemo \/>/u);
  assert.match(authoring, /snippets\/editor\/add-template-fields\.ts/u);
  assert.match(authoring, /examples\/content-controls/u);
  assert.match(fill, /<TemplatePopulationDemo \/>/u);
  assert.match(fill, /examples\/content-controls\/src\/field-schema\.ts/u);
  assert.match(fill, /examples\/content-controls\/src\/template-fields\.ts/u);
  assert.doesNotMatch(fill, /examples\/template-population/u);
  assert.match(clauses, /<ClauseLibraryDemo \/>/u);
  assert.match(clauses, /snippets\/editor\/replace-clause\.ts/u);
  assert.match(locks, /<ContentControlLocksDemo \/>/u);
  assert.match(locks, /snippets\/editor\/set-template-field-lock\.ts/u);
  assert.match(authoringMarkdown, /`client\.legalName`/u);
  assert.match(authoringMarkdown, /inline text field/u);
  assert.match(populationMarkdown, /`client\.legalName`/u);
  assert.match(
    populationMarkdown,
    new RegExp(`${templatePopulationFields.clientLegalName.occurrences} document occurrences`),
  );
  assert.match(clauseMarkdown, /`agreement\.confidentiality`/u);
  assert.deepEqual(
    contentControlLockModes.map(({ lockMode }) => lockMode),
    ['unlocked', 'sdtLocked', 'contentLocked', 'sdtContentLocked'],
  );
  assert.equal(getContentControlLockMode({ cannotDelete: true, cannotEdit: false }), 'sdtLocked');
  assert.equal(getContentControlLockMode({ cannotDelete: false, cannotEdit: true }), 'contentLocked');
  assert.match(lockMarkdown, /Content control cannot be deleted/u);
  assert.match(lockMarkdown, /Contents cannot be edited/u);
  assert.doesNotMatch(authoringMarkdown, /<ContentControlAuthoringDemo/u);
  assert.doesNotMatch(populationMarkdown, /<TemplatePopulationDemo/u);
  assert.doesNotMatch(clauseMarkdown, /<ClauseLibraryDemo/u);
  assert.doesNotMatch(lockMarkdown, /<ContentControlLocksDemo/u);
});

test('the content-control authoring demo uses real Document API mutations', async () => {
  const demo = await readFile(contentControlAuthoringDemoUrl, 'utf8');
  const { getReadyAuthoringTarget } = await import('../lib/content-control-authoring.ts');
  const selectionTarget = {
    kind: 'selection',
    start: { kind: 'text', blockId: 'client-name', offset: 0 },
    end: { kind: 'text', blockId: 'client-name', offset: 19 },
  };

  assert.match(demo, /create\.contentControl/u);
  assert.match(demo, /kind: 'inline'/u);
  assert.match(demo, /kind: 'block'/u);
  assert.match(demo, /service-agreement-draft\.docx/u);
  assert.match(demo, /const canExport = hasClientField && hasClauseField;/u);
  assert.match(demo, /disabled=\{disabled \|\| !canExport\} onClick=\{\(\) => void exportDocument\(\)\}/u);
  assert.match(demo, /createdTags\.has\('client\.legalName'\) \|\|\s+controls\.some/u);
  assert.match(demo, /createdTags\.has\('agreement\.confidentiality'\) \|\|\s+controls\.some/u);
  for (const [handler, nextHandler, tag] of [
    ['addInlineField', 'addBlockField', 'client.legalName'],
    ['addBlockField', 'changeZoom', 'agreement.confidentiality'],
  ]) {
    const body = demo.slice(demo.indexOf(`async function ${handler}()`), demo.indexOf(`function ${nextHandler}(`));
    const receipt = body.indexOf('if (!receipt.success)');
    const lock = body.indexOf(`setCreatedTags((current) => new Set(current).add('${tag}'))`);
    const refresh = body.indexOf('await refreshControls()');

    assert.ok(receipt >= 0 && receipt < lock && lock < refresh, `${handler} must lock its tag before refresh`);
    assert.match(body, /field added, but the detected-fields list could not be refreshed\./u);
  }
  assert.match(
    demo,
    /selection\.observe\(\(snapshot\) => \{\s*latestSelectionRef\.current = snapshot;\s*\}\)/u,
    'the observer must replace the cached selection even when the snapshot is stale or targetless',
  );
  assert.equal(
    getReadyAuthoringTarget({ status: 'pending', empty: false, selectionTarget }, false),
    null,
  );
  assert.equal(
    getReadyAuthoringTarget({ status: 'stale', empty: false, selectionTarget }, false),
    null,
  );
  assert.equal(
    getReadyAuthoringTarget({ status: 'ready', empty: false, selectionTarget }, false),
    selectionTarget,
  );
  assert.equal(
    getReadyAuthoringTarget({ status: 'ready', empty: true, selectionTarget }, true),
    selectionTarget,
  );
  assert.equal(getReadyAuthoringTarget({ status: 'ready', empty: false, selectionTarget }, true), null);
  assert.deepEqual(
    await readFile(contentControlAuthoringFixtureUrl),
    await readFile(contentControlAuthoringExampleFixtureUrl),
  );
});

test('the content-control lock demo uses real Document API mutations', async () => {
  const demo = await readFile(contentControlLocksDemoUrl, 'utf8');

  assert.match(demo, /contentControls\.setLockMode/u);
  assert.match(demo, /contentControls\.text\.setValue/u);
  assert.match(demo, /contentControls\.delete/u);
  assert.match(demo, /fieldTag = 'client\.address'/u);
  assert.match(demo, /service-agreement-template\.docx/u);
});

test('the template population demo flushes document updates before export', async () => {
  const demo = await readFile(templatePopulationDemoUrl, 'utf8');
  const exportBody = demo.match(/async function exportDocument\(\) \{([\s\S]*?)\n  \}/u)?.[1] ?? '';

  const flush = exportBody.indexOf('flushTextUpdate()');
  const wait = exportBody.indexOf('await updateQueueRef.current.wait()');
  const failureGate = exportBody.indexOf('updateQueueRef.current.hasFailures()');
  const download = exportBody.indexOf('await instance.export');

  assert.ok(flush >= 0 && flush < wait && wait < failureGate && failureGate < download);
  assert.match(demo, /inputTimerRef\.current = window\.setTimeout\(flushTextUpdate, 250\)/u);
  assert.match(demo, /await queueUpdate\('autoRenew', \(context\) => updateAutoRenew\(context, checked\)\)/u);
  assert.match(demo, /updateQueueRef\.current\.activate\(doc\)/u);
  assert.match(demo, /function resetDocument\(\) \{\s+updateQueueRef\.current\.invalidate\(\)/u);
  assert.match(demo, /if \(!isCurrent\(\)\) return false;/u);
  assert.match(demo, /inputTimerRef\.current = null;\s+pendingTextRef\.current = null;\s+destroyEditor\(\)/u);
});

test('the template population update queue drops reset-era work and retains failures until retry', async () => {
  const { createTemplatePopulationUpdateQueue } = await import('../lib/template-population.ts');
  const updates = createTemplatePopulationUpdateQueue();
  const originalDocument = { id: 'original' };
  const replacementDocument = { id: 'replacement' };
  let releaseFirstUpdate;
  const firstUpdateBlocked = new Promise((resolve) => {
    releaseFirstUpdate = resolve;
  });
  let firstUpdateStarted;
  const firstUpdateDidStart = new Promise((resolve) => {
    firstUpdateStarted = resolve;
  });
  const mutatedDocuments = [];

  updates.activate(originalDocument);
  const firstUpdate = updates.enqueue('clientLegalName', async ({ document, isCurrent }) => {
    firstUpdateStarted();
    await firstUpdateBlocked;
    if (!isCurrent()) return false;
    mutatedDocuments.push(document);
    return true;
  });
  const staleCheckboxUpdate = updates.enqueue('autoRenew', async ({ document }) => {
    mutatedDocuments.push(document);
    return true;
  });

  await firstUpdateDidStart;
  updates.invalidate();
  updates.activate(replacementDocument);
  releaseFirstUpdate();
  await Promise.all([firstUpdate, staleCheckboxUpdate]);

  assert.deepEqual(mutatedDocuments, [], 'queued work from the old document must not run after reset');

  await updates.enqueue('autoRenew', async () => {
    throw new Error('selection failed');
  });
  await updates.wait();
  assert.equal(updates.hasFailures(), true, 'a rejected document update must keep export blocked');

  await updates.enqueue('autoRenew', async ({ document }) => {
    mutatedDocuments.push(document);
    return true;
  });
  assert.equal(updates.hasFailures(), false, 'a successful retry must clear the failed field');
  assert.deepEqual(mutatedDocuments, [replacementDocument]);
});

test('the built-in UI map follows its section navigation', async () => {
  const meta = JSON.parse(await readFile(builtInUiMetaUrl, 'utf8'));
  const { builtInUiSurfaces } = await import('../lib/built-in-ui-map.ts');
  const guideSlugs = builtInUiSurfaces.map((surface) => surface.slug);

  assert.deepEqual(guideSlugs, meta.pages.slice(1));
  assert.deepEqual(
    builtInUiSurfaces.map((surface) => surface.href),
    guideSlugs.map((slug) => `/editor/built-in-ui/${slug}`),
  );
});

test('the built-in UI map keeps its vertical tab semantics at responsive widths', async () => {
  const source = await readFile(builtInUiMapUrl, 'utf8');
  const css = await readFile(docsComponentsCssUrl, 'utf8');
  const tabRules = [...css.matchAll(/\.sd-builtin-map-tabs\s*\{([^}]*)\}/g)];

  assert.match(source, /orientation='vertical'/);
  assert.ok(tabRules.length > 0, 'the built-in UI map must define its tab layout');
  assert.match(tabRules[0][1], /display:\s*flex/);
  assert.match(tabRules[0][1], /flex-direction:\s*column/);
  for (const rule of tabRules.slice(1)) {
    assert.doesNotMatch(rule[1], /display:\s*grid|grid-template-columns/);
  }
});

test('Document API calls in code examples match the generated contract', async () => {
  const operationIds = await readContractOperationIds();
  const callableAliases = new Map([['capabilities', 'capabilities.get']]);
  const documentHandleMethods = new Set(['close', 'invoke', 'save']);
  const unknownCalls = [];

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');
    const codeBlocks = collectFencedCode(markdown);

    for (const example of collectCodeIncludes(markdown, file)) {
      codeBlocks.push(await readFile(example, 'utf8'));
    }

    for (const code of codeBlocks) {
      for (const match of code.matchAll(/\b(?:editor\.)?doc\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/gu)) {
        const call = match[1];
        const operationId = callableAliases.get(call) ?? call;
        if (!operationIds.has(operationId) && !documentHandleMethods.has(call)) {
          unknownCalls.push(`${file.pathname}: doc.${call}()`);
        }
      }
    }
  }

  for (const example of await collectReferenceExampleSources()) {
    const code = await readFile(example, 'utf8');
    for (const match of code.matchAll(/\b(?:editor\.)?doc\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/gu)) {
      const call = match[1];
      const operationId = callableAliases.get(call) ?? call;
      if (!operationIds.has(operationId) && !documentHandleMethods.has(call)) {
        unknownCalls.push(`${example.pathname}: doc.${call}()`);
      }
    }
  }

  assert.deepEqual(unknownCalls, []);
});

test('included code resolves inside a typechecked source directory', async () => {
  const invalidIncludes = [];
  const includedSnippets = new Set();

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');

    for (const example of collectCodeIncludes(markdown, file)) {
      const examplePath = fileURLToPath(example);
      const isTypecheckedSource =
        examplePath.startsWith(snippetsRootPrefix) || examplePath.startsWith(examplesRootPrefix);
      if (!isTypecheckedSource || !(await pathExists(example))) {
        invalidIncludes.push(`${file.pathname}: ${example.pathname}`);
        continue;
      }

      includedSnippets.add(examplePath);

      if (/\.(?:js|mjs|cjs)$/u.test(examplePath)) {
        const syntax = spawnSync(process.execPath, ['--check', examplePath], { encoding: 'utf8' });
        if (syntax.status !== 0) invalidIncludes.push(`${file.pathname}: ${syntax.stderr.trim()}`);
      }
    }
  }

  const referenceModel = JSON.parse(await readFile(documentApiReferenceModelUrl, 'utf8'));
  for (const example of Object.values(referenceModel.examples)) {
    const exampleUrl = new URL(`../${example.sourcePath}`, import.meta.url);
    const examplePath = fileURLToPath(exampleUrl);
    if (!examplePath.startsWith(snippetsRootPrefix) || !(await pathExists(exampleUrl))) {
      invalidIncludes.push(`${documentApiReferenceModelUrl.pathname}: ${example.sourcePath}`);
      continue;
    }
    includedSnippets.add(examplePath);
  }

  for (const example of await collectSnippetFiles(new URL('../snippets/', import.meta.url))) {
    const examplePath = fileURLToPath(example);
    if (!examplePath.endsWith('.d.ts') && !includedSnippets.has(examplePath)) {
      invalidIncludes.push(`${example.pathname}: snippet source is not included by a documentation page`);
    }
  }

  assert.deepEqual(invalidIncludes, []);
});

async function collectSnippetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = new URL(entry.name, directory);
      if (entry.isDirectory()) return collectSnippetFiles(new URL(`${entry.name}/`, directory));
      return /\.(?:ts|js|mjs|cjs)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

async function collectReferenceExampleSources() {
  const model = JSON.parse(await readFile(documentApiReferenceModelUrl, 'utf8'));
  return Object.values(model.examples).map((example) => new URL(`../${example.sourcePath}`, import.meta.url));
}

test('fenced code fragments parse', async () => {
  const issues = [];

  for (const file of await collectMdxFiles(contentRoot)) {
    const markdown = await readFile(file, 'utf8');

    for (const block of collectFencedCodeBlocks(markdown)) {
      if (['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript'].includes(block.language)) {
        const result = ts.transpileModule(block.code, {
          fileName: `${file.pathname}.${block.language}`,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
          reportDiagnostics: true,
        });

        for (const diagnostic of result.diagnostics ?? []) {
          if (diagnostic.category === ts.DiagnosticCategory.Error) {
            issues.push(`${file.pathname}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
          }
        }
      }

      if (block.language === 'bash') {
        const syntax = spawnSync('bash', ['-n'], { input: block.code, encoding: 'utf8' });
        if (syntax.status !== 0) issues.push(`${file.pathname}: ${syntax.stderr.trim()}`);
      }

      if (block.language === 'html') {
        for (const issue of validateHtmlFragment(block.code)) issues.push(`${file.pathname}: ${issue}`);
      }
    }
  }

  assert.deepEqual(issues, []);
});

function validateHtmlFragment(html) {
  const issues = [];
  const stack = [];
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source']);
  const ids = new Set();

  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/giu)) {
    const tag = match[1].toLowerCase();
    const token = match[0];

    if (!token.startsWith('</')) {
      const id = token.match(/\bid=["']([^"']+)["']/u)?.[1];
      if (id && ids.has(id)) issues.push(`duplicate HTML id "${id}"`);
      if (id) ids.add(id);
      if (!voidElements.has(tag) && !token.endsWith('/>')) stack.push(tag);
      continue;
    }

    if (stack.pop() !== tag) issues.push(`unbalanced HTML tag </${tag}>`);
  }

  if (stack.length > 0) issues.push(`unclosed HTML tag <${stack.at(-1)}>`);
  return issues;
}

function collectCodeIncludes(markdown, file) {
  return [...markdown.matchAll(/<include(?:\s[^>]*)?>([^<]+)<\/include>/gu)].map((match) => {
    const reference = match[1].trim().split('#')[0];
    return new URL(reference, file);
  });
}

function collectFencedCode(markdown) {
  return collectFencedCodeBlocks(markdown).map((block) => block.code);
}

function collectFencedCodeBlocks(markdown) {
  const blocks = [];
  let marker;
  let language = '';
  let lines = [];

  for (const line of markdown.split('\n')) {
    const fence = line.match(/^\s*(`{3,}|~{3,})([^`]*)$/u);

    if (!marker && fence) {
      marker = fence[1];
      language = fence[2].trim().split(/\s+/u)[0] ?? '';
      lines = [];
      continue;
    }

    if (marker && fence && fence[1][0] === marker[0] && fence[1].length >= marker.length) {
      blocks.push({ language, code: lines.join('\n') });
      marker = undefined;
      language = '';
      lines = [];
      continue;
    }

    if (marker) lines.push(line);
  }

  return blocks;
}

test('derives search terms from a requested path', async () => {
  const { searchTermsFromPath } = await import('../lib/site-url.ts');

  // A 404 already knows what the reader wanted; it is in the URL. These become
  // the search query so nobody has to retype it.
  assert.equal(searchTermsFromPath('/ai/agents/architecture'), 'ai agents architecture');
  assert.equal(searchTermsFromPath('/editor/custom-ui/controller-setup'), 'editor custom ui controller setup');
  // A file extension is noise in a search query.
  assert.equal(searchTermsFromPath('/md/editor/quickstart.md'), 'md editor quickstart');
  assert.equal(searchTermsFromPath('/'), '');
});
