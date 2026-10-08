/**
 * The built-in toolbar and `editor.ui` driving one real document together.
 *
 * This is the live counterpart to the unit-level parity model. Everything here
 * is real: the CDN bundle, a real DOCX, a mounted built-in toolbar rendering
 * actual DOM, real mouse and keyboard input, and assertions against rendered
 * classes rather than internal item state.
 *
 * It exists because the hybrid arrangement is what this branch changed. Before,
 * the toolbar built its own controller; now it borrows the instance's, so an
 * application panel and the toolbar read the same object. The unit tests prove
 * that graph is correct. Only a browser can show a user clicking the toolbar
 * and a custom panel seeing it, which is the claim that matters.
 *
 * The `sd-active` class on `[data-item="btn-bold"]` is the toolbar's rendered
 * state, from `ToolbarButton.vue`.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// CJS under Playwright, so `__dirname` rather than `import.meta.url`.
const SAMPLE = path.resolve(__dirname, 'fixtures/sample-review.docx');

const PAGE = `<!DOCTYPE html><html><head>
<link href="/dist-cdn/superdoc.min.css" rel="stylesheet"/>
<script>window.SUPERDOC_ENGINE_CDN_BASE_URL='/node_modules/@superdoc/docx-engine';</script>
<script src="/dist-cdn/superdoc.min.js"></script>
</head><body style="margin:0">
<div id="toolbar"></div>
<div id="editor"></div>
<script>
  window.__ready = false;
  window.__exceptions = [];
  // A custom panel: nothing but an observer on the instance's controller, which
  // is what an application sidebar is at this boundary.
  window.__panelBold = [];
  window.__mount = function () {
    var editor = new SuperDoc({
      selector: '#editor',
      toolbar: '#toolbar',
      document: '/sample-review.docx',
      onReady: function () { window.__ready = true; },
      onException: function (p) { window.__exceptions.push(String(p && p.error)); },
    });
    window.__editor = editor;
    window.__stopPanel = editor.ui.commands.get('bold').observe(function (state) {
      window.__panelBold.push({ enabled: state.enabled, active: state.active });
    });
  };
  window.__boldState = function () { return window.__editor.ui.commands.get('bold').getState(); };
  window.__panelLast = function () { return window.__panelBold[window.__panelBold.length - 1] || null; };
</script>
</body></html>`;

async function open(page: Page): Promise<void> {
  const sample = await readFile(SAMPLE);
  await page.route('**/sample-review.docx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: sample,
    }),
  );
  await page.route('**/hybrid.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto('/hybrid.html');
  await page.waitForFunction(() => (window as never as { SuperDoc?: unknown }).SuperDoc !== undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => (window as never as { __mount: () => void }).__mount());
  await page.waitForFunction(
    () => {
      const w = window as never as { __ready: boolean; __exceptions: string[] };
      return w.__ready || w.__exceptions.length > 0;
    },
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => (window as never as { __exceptions: string[] }).__exceptions)).toEqual([]);
}

/**
 * Settle the editor first, THEN select.
 *
 * Selecting while the editor is still rendering does take effect, but a later
 * render collapses it, and bold correctly reports `range-selection-required`
 * for roughly 870ms before it re-establishes. Waiting that window out after the
 * fact is unreliable: the streak can complete inside a stable-looking gap and
 * the command that follows lands on a collapsed selection. Sampling showed the
 * opposite order has no collapse at all, so this waits for the document to be
 * ready and quiet before pressing anything.
 *
 * Found the hard way: the wait-it-out version passed when this file ran alone
 * and failed every time under the loaded parallel suite.
 */
async function selectTextAndSettle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (
        window as never as { __editor: { ui: { document: { getSnapshot(): { ready: boolean } } } } }
      ).__editor.ui.document.getSnapshot().ready,
    { timeout: 60_000, polling: 100 },
  );
  // Quiet period: the render that collapses an early selection happens in here.
  await page.waitForTimeout(2_000);

  await page.click('#editor');
  await page.keyboard.press('ControlOrMeta+a');

  await page.waitForFunction(
    () => {
      const w = window as never as { __boldState: () => { enabled: boolean }; __streak?: number };
      w.__streak = w.__boldState().enabled ? (w.__streak ?? 0) + 1 : 0;
      return (w.__streak ?? 0) >= 5;
    },
    { timeout: 30_000, polling: 100 },
  );
}

const boldButton = '[data-item="btn-bold"]';

/** Run bold through the instance's controller, the way a custom panel would. */
async function execBoldThroughUi(page: Page): Promise<void> {
  const result = await page.evaluate(() =>
    (
      window as never as { __editor: { ui: { commands: { executeAsync(id: string): Promise<unknown> } } } }
    ).__editor.ui.commands.executeAsync('bold'),
  );
  expect(result).not.toBe(false);
}

async function boldActive(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as never as { __boldState: () => { active: boolean } }).__boldState().active);
}

test('the built-in toolbar and editor.ui drive one document together', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);

  // The toolbar is really rendered, not merely constructed.
  await expect(page.locator('#toolbar .superdoc-toolbar')).toBeVisible();
  await expect(page.locator(boldButton)).toBeVisible();

  await selectTextAndSettle(page);
  await expect(page.locator(boldButton)).not.toHaveClass(/sd-active/);

  // The custom panel drives; the rendered toolbar button has to follow.
  await execBoldThroughUi(page);
  await expect(page.locator(boldButton)).toHaveClass(/sd-active/, { timeout: 15_000 });
  expect(await boldActive(page)).toBe(true);

  // And back off again, so the assertion is about tracking rather than about
  // one state happening to be reached.
  await execBoldThroughUi(page);
  await expect(page.locator(boldButton)).not.toHaveClass(/sd-active/, { timeout: 15_000 });
  expect(await boldActive(page)).toBe(false);

  // The panel observed the transitions rather than only reading on demand.
  const observed = (await page.evaluate(() => (window as never as { __panelBold: unknown[] }).__panelBold)) as Array<{
    active: boolean;
  }>;
  expect(observed.some((entry) => entry.active)).toBe(true);
  expect(observed.length).toBeGreaterThan(2);
});

test('a custom panel keeps working after the built-in toolbar is removed', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await expect(page.locator(boldButton)).toBeVisible();
  await selectTextAndSettle(page);

  // Real teardown, not just DOM removal. `replaceChildren()` drops nodes while
  // leaving the toolbar instance and its controller wiring alive, so it never
  // reaches `#destroyController()` and would pass even if toolbar destruction
  // tore down the shared controller. `superdoc.toolbar.destroy()` is the
  // documented path and the one this branch changed.
  await page.evaluate(() =>
    (window as never as { __editor: { toolbar: { destroy(): void } } }).__editor.toolbar.destroy(),
  );
  await expect(page.locator(boldButton)).toHaveCount(0);

  await execBoldThroughUi(page);
  await expect.poll(() => boldActive(page), { timeout: 15_000 }).toBe(true);

  const state = await page.evaluate(() => (window as never as { __boldState: () => unknown }).__boldState());
  expect(state).toMatchObject({ supported: true, enabled: true });
});
