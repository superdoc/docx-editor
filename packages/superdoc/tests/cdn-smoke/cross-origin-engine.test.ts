import { expect, test, type Page } from '@playwright/test';
import { Hocuspocus } from '@hocuspocus/server';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// SD-3988: a script-tag page loads the engine from a CDN on another origin,
// so the engine's worker files are cross-origin to the page. The browser
// refuses to start a cross-origin module worker directly.
const ENGINE_ORIGIN = 'http://localhost:3334';
const ENGINE_BASE_URL = `${ENGINE_ORIGIN}/node_modules/@superdoc/docx-engine`;
const PAGE_ORIGIN = 'http://localhost:3333';
const DOCX = path.resolve(__dirname, 'fixtures/sample-review.docx');
const ENGINE_MANIFEST = path.resolve(__dirname, '../../node_modules/@superdoc/docx-engine/dist-cdn/manifest.json');

// Both mounted modes use the same composed dispatcher at a same-origin URL.
async function engineWorkerPaths(): Promise<Record<'document' | 'collaboration', string>> {
  const manifest = JSON.parse(await readFile(ENGINE_MANIFEST, 'utf8')) as { files: { path: string }[] };
  const find = (prefix: string): string => {
    const file = manifest.files.find((entry) => entry.path.startsWith(`assets/${prefix}-`));
    if (!file) throw new Error(`engine manifest has no ${prefix} file`);
    return `/node_modules/@superdoc/docx-engine/dist-cdn/${file.path}`;
  };
  return {
    document: find('dom-worker-entry'),
    collaboration: find('dom-worker-entry'),
  };
}

// Both test servers are on loopback, and Chromium's Local Network Access
// checks block one loopback origin from loading another's scripts. A real CDN
// is a public origin, where those checks do not apply.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });

const PAGE = `<!DOCTYPE html><html><head>
<link href="/dist-cdn/superdoc.min.css" rel="stylesheet"/>
<script>window.SUPERDOC_ENGINE_CDN_BASE_URL='${ENGINE_BASE_URL}';</script>
<script src="/dist-cdn/superdoc.min.js"></script>
</head><body><div id="editor" style="height: 100vh"></div></body></html>`;

interface StartupEvidence {
  pageErrors: string[];
  workerErrors: string[];
  workerEntryRequests: string[];
  createdWorkers: string[];
  consoleLog: string[];
  failedRequests: string[];
}

async function openCrossOriginPage(page: Page): Promise<StartupEvidence> {
  const evidence: StartupEvidence = {
    pageErrors: [],
    workerErrors: [],
    workerEntryRequests: [],
    createdWorkers: [],
    consoleLog: [],
    failedRequests: [],
  };
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('worker', (worker) => evidence.createdWorkers.push(worker.url()));
  page
    .context()
    .on('requestfailed', (request) =>
      evidence.failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`),
    );
  page.on('console', (message) => {
    evidence.consoleLog.push(`[${message.type()}] ${message.text()}`);
    if ((message.type() === 'error' || message.type() === 'warning') && /worker/i.test(message.text())) {
      evidence.workerErrors.push(message.text());
    }
  });
  page.context().on('request', (request) => {
    if (/-worker-entry-[^/]*\.js$/.test(new URL(request.url()).pathname)) {
      evidence.workerEntryRequests.push(request.url());
    }
  });
  await page.route('**/cross-origin-engine.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }),
  );
  await page.goto('/cross-origin-engine.html');
  await page.waitForFunction(() => (window as never as { SuperDoc?: unknown }).SuperDoc !== undefined);
  return evidence;
}

interface MountOptions {
  document?: string;
  workerUrls?: Record<string, string>;
  room?: { id: string; serverUrl: string; mode: 'create' | 'join' };
}

function mount(page: Page, options: MountOptions = {}): Promise<void> {
  return page.evaluate(async ({ document, workerUrls, room }) => {
    const win = window as never as {
      SuperDoc: new (config: unknown) => unknown;
      superdoc?: unknown;
      __SUPERDOC_READY__?: boolean;
      __SUPERDOC_COLLAB_READY__?: boolean;
      __SUPERDOC_EXCEPTIONS__?: unknown[];
    };
    win.__SUPERDOC_EXCEPTIONS__ = [];
    win.__SUPERDOC_READY__ = false;
    win.__SUPERDOC_COLLAB_READY__ = false;
    const documentSource =
      room && document
        ? {
            id: 'sd-3988-room-doc',
            data: new File([await (await fetch(document)).arrayBuffer()], 'contract.docx', {
              type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            }),
            collaboration: {
              providerType: 'hocuspocus',
              documentId: room.id,
              serverUrl: room.serverUrl,
              roomMode: room.mode,
            },
          }
        : document;
    win.superdoc = new win.SuperDoc({
      selector: '#editor',
      ...(documentSource ? { document: documentSource } : {}),
      ...(workerUrls ? { workerUrls } : {}),
      onReady: () => {
        win.__SUPERDOC_READY__ = true;
      },
      onCollaborationReady: () => {
        win.__SUPERDOC_COLLAB_READY__ = true;
      },
      onException: ({ code, error, workerFailure }: { code?: string; error?: Error; workerFailure?: unknown }) => {
        win.__SUPERDOC_EXCEPTIONS__!.push({ code, message: error?.message, workerFailure });
      },
    });
  }, options);
}

async function mountAndWaitForReady(page: Page, evidence: StartupEvidence, options: MountOptions = {}): Promise<void> {
  await mount(page, options);
  try {
    await page.waitForFunction(
      () => (window as never as { __SUPERDOC_READY__?: boolean }).__SUPERDOC_READY__ === true,
      null,
      {
        timeout: 60_000,
      },
    );
  } catch (error) {
    throw new Error(`SuperDoc did not reach Ready: ${JSON.stringify(evidence, null, 2)}`, { cause: error });
  }
  if (options.room) {
    await page.waitForFunction(
      () => (window as never as { __SUPERDOC_COLLAB_READY__?: boolean }).__SUPERDOC_COLLAB_READY__ === true,
      null,
      { timeout: 60_000 },
    );
  }
}

test('a blank editor reaches Ready with the engine on another origin', async ({ page }) => {
  test.setTimeout(90_000);
  const evidence = await openCrossOriginPage(page);

  await mountAndWaitForReady(page, evidence);

  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.workerErrors).toEqual([]);
});

test('a DOCX opens and accepts a Document API edit with the engine on another origin', async ({ page }) => {
  test.setTimeout(90_000);
  const docx = await readFile(DOCX);
  await page.route('**/contract.docx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: docx,
    }),
  );
  const evidence = await openCrossOriginPage(page);

  await mountAndWaitForReady(page, evidence, { document: '/contract.docx' });
  await expect(page.locator('.superdoc-page').first()).toBeVisible({ timeout: 60_000 });

  const text = await page.evaluate(async () => {
    const doc = (
      window as never as {
        superdoc: {
          activeEditor: {
            doc: {
              insert(input: { value: string }): Promise<unknown>;
              getText(input: Record<string, never>): Promise<string>;
            };
          };
        };
      }
    ).superdoc.activeEditor.doc;
    await doc.insert({ value: 'Cross-origin engine edit' });
    return doc.getText({});
  });

  expect(text).toContain('Cross-origin engine edit');
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.workerErrors).toEqual([]);
});

// A host whose engine code is on another origin copies the worker files to
// its own origin and passes them as `workerUrls` (SD-3988 split-origin hosts).
test('a split-origin host opens and edits with workerUrls on its own origin', async ({ page }) => {
  test.setTimeout(90_000);
  const workerUrls = await engineWorkerPaths();
  const docx = await readFile(DOCX);
  await page.route('**/contract.docx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: docx,
    }),
  );
  const evidence = await openCrossOriginPage(page);

  await mountAndWaitForReady(page, evidence, { document: '/contract.docx', workerUrls });
  await expect(page.locator('.superdoc-page').first()).toBeVisible({ timeout: 60_000 });
  const text = await page.evaluate(async () => {
    const doc = (
      window as never as {
        superdoc: {
          activeEditor: {
            doc: {
              insert(input: { value: string }): Promise<unknown>;
              getText(input: Record<string, never>): Promise<string>;
            };
          };
        };
      }
    ).superdoc.activeEditor.doc;
    await doc.insert({ value: 'Split-origin worker edit' });
    return doc.getText({});
  });

  expect(text).toContain('Split-origin worker edit');
  expect(evidence.workerEntryRequests.every((url) => url.startsWith(PAGE_ORIGIN))).toBe(true);
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.workerErrors).toEqual([]);
});

test('split-origin collaboration workers sync two clients and a rejoined client', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const server = new Hocuspocus({ address: '127.0.0.1', port: 0, quiet: true, stopOnSignals: false });
  await server.listen();
  const peerContext = await browser.newContext();
  try {
    const workerUrls = await engineWorkerPaths();
    const docx = await readFile(DOCX);
    const roomId = `sd-3988-${randomUUID()}`;
    const routeDocument = (target: Page) =>
      target.route('**/contract.docx', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          body: docx,
        }),
      );
    const room = (mode: 'create' | 'join') => ({
      document: '/contract.docx',
      workerUrls,
      room: { id: roomId, serverUrl: server.webSocketURL, mode },
    });
    const text = (target: Page) =>
      target.evaluate(async () => {
        const doc = (
          window as never as {
            superdoc: { activeEditor: { doc: { getText(input: Record<string, never>): Promise<string> } } };
          }
        ).superdoc.activeEditor.doc;
        return doc.getText({});
      });

    await routeDocument(page);
    const creatorEvidence = await openCrossOriginPage(page);
    await mountAndWaitForReady(page, creatorEvidence, room('create'));
    let peer = await peerContext.newPage();
    await routeDocument(peer);
    const peerEvidence = await openCrossOriginPage(peer);
    await mountAndWaitForReady(peer, peerEvidence, room('join'));

    const edit = ' Split-origin collaboration edit';
    await page.evaluate(async (value) => {
      const doc = (
        window as never as {
          superdoc: { activeEditor: { doc: { insert(input: { value: string }): Promise<unknown> } } };
        }
      ).superdoc.activeEditor.doc;
      await doc.insert({ value });
    }, edit);
    await expect.poll(() => text(peer), { timeout: 30_000 }).toContain(edit);

    await peer.close();
    peer = await peerContext.newPage();
    await routeDocument(peer);
    const rejoinEvidence = await openCrossOriginPage(peer);
    await mountAndWaitForReady(peer, rejoinEvidence, room('join'));
    await expect.poll(() => text(peer), { timeout: 30_000 }).toContain(edit);

    for (const evidence of [creatorEvidence, peerEvidence, rejoinEvidence]) {
      expect(evidence.workerEntryRequests.some((url) => url.includes('review-index-worker-entry-'))).toBe(false);
      expect(evidence.workerEntryRequests.every((url) => url.startsWith(PAGE_ORIGIN))).toBe(true);
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.workerErrors).toEqual([]);
    }
    for (const client of [page, peer]) {
      expect(
        await client.evaluate(
          () => (window as never as { __SUPERDOC_EXCEPTIONS__?: unknown[] }).__SUPERDOC_EXCEPTIONS__,
        ),
      ).toEqual([]);
    }
  } finally {
    await peerContext.close();
    await server.destroy();
  }
});

test('a cross-origin workerUrls.document is ignored and the editor reaches Ready', async ({ page }) => {
  test.setTimeout(90_000);
  const { document } = await engineWorkerPaths();
  const refusedWorkerUrl = `${ENGINE_ORIGIN}${document}`;
  const docx = await readFile(DOCX);
  await page.route('**/contract.docx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: docx,
    }),
  );
  const evidence = await openCrossOriginPage(page);

  await mountAndWaitForReady(page, evidence, {
    document: '/contract.docx',
    workerUrls: { document: refusedWorkerUrl },
  });
  await expect(page.locator('.superdoc-page').first()).toBeVisible({ timeout: 60_000 });
  expect(
    await page.evaluate(() => (window as never as { __SUPERDOC_EXCEPTIONS__?: unknown[] }).__SUPERDOC_EXCEPTIONS__),
  ).toEqual([]);
  expect(
    await page.evaluate(() => {
      const superdoc = (
        window as never as { superdoc: { config: { document?: string; documents?: { url?: string }[] } } }
      ).superdoc;
      return { document: superdoc.config.document, url: superdoc.config.documents?.[0]?.url };
    }),
  ).toEqual({ document: '/contract.docx', url: '/contract.docx' });
  expect(evidence.pageErrors).toEqual([]);
  expect(evidence.workerErrors).toEqual([]);
  expect(evidence.workerEntryRequests.some((url) => url === refusedWorkerUrl)).toBe(false);
});
