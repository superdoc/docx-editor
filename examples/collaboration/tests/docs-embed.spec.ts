import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const docsUrl = process.env.DOCS_COLLABORATION_TEST_URL;
test.skip(!docsUrl, 'Set DOCS_COLLABORATION_TEST_URL to test the local docs embed.');

test('access checks allow Sam, deny Taylor, and preserve Alex’s edits', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(new URL('/editor/collaboration/control-room-access/', docsUrl!).href);
  const demo = page.locator('.sd-collaboration-demo');
  await expect(demo.getByRole('button', { name: 'Connect Sam', exact: true })).toBeEnabled({ timeout: 90_000 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(demo.locator('.sd-editor-preview')).toHaveAttribute('data-expanded', 'false');
  await demo.getByRole('button', { name: 'Expand', exact: true }).click();
  const alex = demo.getByRole('region', { name: "Alex's editor" });
  await alex.locator('.superdoc-text-run').filter({ hasText: 'Delivery is due' }).first().click();
  await page.keyboard.type('ACCESSMARKER');
  await demo.getByRole('button', { name: 'Connect Sam', exact: true }).click();
  await expect(demo.getByRole('region', { name: "Sam's editor" })).toContainText('ACCESSMARKER');
  await demo.getByRole('button', { name: 'Connect Taylor', exact: true }).click();
  const taylor = demo.getByRole('region', { name: "Taylor's editor" });
  await expect(demo).toContainText('Access denied.', { timeout: 40_000 });
  await expect(taylor.locator('.superdoc-text-run')).toHaveCount(0);
  await expect(alex.locator('[data-v2-remote-label="true"]')).toHaveCount(0);
  await demo.getByRole('button', { name: 'Connect Sam', exact: true }).click();
  await expect(demo.getByRole('region', { name: "Sam's editor" })).toContainText('ACCESSMARKER');
  // No denial receipt means the UI must not guess from Taylor's identity.
  await page.route('**/access-result?*', (route) => route.abort());
  await demo.getByRole('button', { name: 'Connect Taylor', exact: true }).click();
  await expect(demo).toContainText('Could not connect.', { timeout: 40_000 });
  await expect(demo).not.toContainText('Access denied.');
});

test('access results stay visible in the collapsed mobile demo', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(new URL('/editor/collaboration/control-room-access/', docsUrl!).href);
  const demo = page.locator('.sd-collaboration-demo');
  const connectTaylor = demo.getByRole('button', { name: 'Connect Taylor', exact: true });
  await expect(connectTaylor).toBeEnabled({ timeout: 90_000 });
  await connectTaylor.focus();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('status').filter({ hasText: 'Access denied.' })).toBeVisible({ timeout: 40_000 });
  await expect(demo.locator('.sd-editor-preview')).toHaveAttribute('data-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.setOffline(true);
  await demo.getByRole('button', { name: 'Connect Sam', exact: true }).click();
  await expect(demo).toContainText('Could not connect.', { timeout: 40_000 });
  await expect(demo).not.toContainText('Access denied.');
  await context.setOffline(false);
  await demo.getByRole('button', { name: 'Connect Sam', exact: true }).click();
  await expect(demo).toContainText('Sam joined the room.', { timeout: 40_000 });
});

test.beforeEach(async ({ context }) => {
  const engineDirectory = process.env.DOCS_COLLABORATION_ENGINE_DIR;
  if (!engineDirectory) return;
  await context.route('https://cdn.jsdelivr.net/npm/@superdoc/docx-engine@*/dist-cdn/**', async (route) => {
    const asset = new URL(route.request().url()).pathname.split('/dist-cdn/')[1];
    const body = await readFile(path.join(engineDirectory, asset));
    const contentType = asset.endsWith('.json')
      ? 'application/json'
      : asset.endsWith('.css')
        ? 'text/css'
        : 'application/javascript';
    await route.fulfill({ body, contentType, headers: { 'access-control-allow-origin': '*' } });
  });
});

for (const { width, initialScroll } of [
  { width: 1280, initialScroll: 0 },
  { width: 1280, initialScroll: 250 },
  { width: 1814, initialScroll: 0 },
  { width: 1814, initialScroll: 250 },
]) {
  test(`startup preserves the reader's scroll position at ${initialScroll}px in a ${width}px viewport`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 820 });
    let releaseFixture!: () => void;
    const fixtureGate = new Promise<void>((resolve) => {
      releaseFixture = resolve;
    });
    await page.route('**/fixtures/collaboration-sample.docx', async (route) => {
      await fixtureGate;
      await route.continue();
    });
    await page.goto(docsUrl!);
    await page.evaluate((top) => window.scrollTo(0, top), initialScroll);
    const before = await page.evaluate(() => window.scrollY);
    releaseFixture();
    const demo = page.locator('.sd-collaboration-demo');
    await expect(demo.getByRole('button', { name: 'Restart demo' })).toBeEnabled({ timeout: 90_000 });
    await expect(demo.locator('[data-v2-remote-label="true"]')).toHaveCount(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await page.setViewportSize({ width: width + 1, height: 771 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
}

test('the docs embed synchronizes, zooms, expands, and resets both editors', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(docsUrl!);
  const demo = page.locator('.sd-collaboration-demo');
  await expect(demo.getByRole('button', { name: 'Start demo', exact: true })).toHaveCount(0);
  await expect(demo.getByRole('button', { name: 'Restart demo' })).toBeEnabled({ timeout: 90_000 });
  await expect(demo.locator('.sd-editor-preview')).toHaveAttribute('data-expanded', 'false');
  await demo.getByRole('button', { name: 'Expand', exact: true }).click();
  const alex = demo.getByRole('region', { name: "Alex's editor" });
  const sam = demo.getByRole('region', { name: "Sam's editor" });
  await expect(alex.locator('[data-v2-remote-caret="true"]').first()).toBeVisible();
  await expect(sam.locator('[data-v2-remote-caret="true"]').first()).toBeVisible();
  await expect(alex.locator('[data-v2-remote-label="true"]').first()).toHaveText('Sam');
  await expect(sam.locator('[data-v2-remote-label="true"]').first()).toHaveText('Alex');
  await expect(alex.locator('[data-v2-remote-caret="true"]').first()).toHaveCSS('background-color', 'rgb(0, 133, 61)');
  await expect(sam.locator('[data-v2-remote-caret="true"]').first()).toHaveCSS('background-color', 'rgb(19, 85, 255)');
  await alex.locator('.superdoc-text-run').filter({ hasText: 'Delivery is due' }).first().click();
  await page.keyboard.type('FIRSTMARKER');
  await expect(sam).toContainText('FIRSTMARKER');
  await expect(sam.locator('[data-v2-remote-caret="true"]').first()).toHaveCSS('background-color', 'rgb(19, 85, 255)');
  await sam.locator('.superdoc-text-run').filter({ hasText: 'Alex and Sam' }).first().click();
  await page.keyboard.type('SECONDMARKER');
  await expect(alex).toContainText('SECONDMARKER');
  await expect(alex.locator('[data-v2-remote-caret="true"]').first()).toHaveCSS('background-color', 'rgb(0, 133, 61)');
  const fit = demo.getByRole('button', { name: 'Fit document to width' });
  const initialZoom = await fit.innerText();
  await demo.getByRole('button', { name: 'Zoom in' }).click();
  await expect(fit).not.toHaveText(initialZoom);
  await fit.click();
  await expect(fit).toHaveText(initialZoom);
  await demo.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(demo.locator('.sd-editor-preview')).toHaveAttribute('data-expanded', 'false');
  await demo.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(demo.locator('.sd-editor-preview')).toHaveAttribute('data-expanded', 'true');
  await demo.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect(demo).toHaveAttribute('data-fullscreen', 'true');
  await demo.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect(demo).toHaveAttribute('data-fullscreen', 'false');
  page.once('dialog', (dialog) => dialog.accept());
  await demo.getByRole('button', { name: 'Restart demo' }).click();
  await expect(demo.getByRole('button', { name: 'Restart demo' })).toBeEnabled({ timeout: 90_000 });
  await expect(alex).not.toContainText('FIRSTMARKER');
  await expect(sam).not.toContainText('SECONDMARKER');
  await expect(alex).toContainText('Delivery is due Monday.');
});

test('a connection failure leaves the walkthrough usable', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto(docsUrl!);
  const demo = page.locator('.sd-collaboration-demo');
  await expect(demo.getByRole('button', { name: 'Restart demo' })).toBeEnabled({ timeout: 90_000 });
  await context.setOffline(true);
  await expect(demo.getByRole('button', { name: 'Restart demo' })).toBeVisible();
  await expect(demo.getByRole('region', { name: "Alex's editor" })).toContainText('Delivery is due Monday.');
  page.once('dialog', (dialog) => dialog.accept());
  await demo.getByRole('button', { name: 'Restart demo' }).click();
  await expect(demo.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled({ timeout: 45_000 });
  await expect(demo).toContainText('could not connect');
  await expect(page.getByRole('heading', { name: '1. Start the example' })).toBeVisible();
});

test('presence leaves and returns without losing document edits', async ({ page }) => {
  test.setTimeout(120_000);
  const url = new URL('/editor/collaboration/presence-and-awareness/', docsUrl!);
  await page.goto(url.href);
  const demo = page.locator('.sd-collaboration-demo');
  const participants = demo.getByRole('list', { name: 'Connected participants' });
  await expect(participants.getByRole('listitem')).toHaveText(['Alex', 'Sam'], { timeout: 90_000 });
  await demo.getByRole('button', { name: 'Expand', exact: true }).click();
  const alex = demo.getByRole('region', { name: "Alex's editor" });
  const sam = demo.getByRole('region', { name: "Sam's editor" });
  await sam.locator('.superdoc-text-run').filter({ hasText: 'Alex and Sam' }).first().click();
  await page.keyboard.type('PRESENCEMARKER');
  await expect(alex).toContainText('PRESENCEMARKER');
  await demo.getByRole('button', { name: 'Disconnect Sam' }).click();
  await expect(participants.getByRole('listitem')).toHaveText(['Alex']);
  await expect(alex.locator('[data-v2-remote-label="true"]')).toHaveCount(0);
  await expect(alex).toContainText('PRESENCEMARKER');
  await demo.getByRole('button', { name: 'Reconnect Sam' }).click();
  await expect(participants.getByRole('listitem')).toHaveText(['Alex', 'Sam']);
  await expect(sam).toContainText('PRESENCEMARKER');
  await expect(alex.locator('[data-v2-remote-label="true"]')).toHaveText(['Sam']);
  await demo.getByRole('button', { name: 'Disconnect Sam' }).click();
  await expect(participants.getByRole('listitem')).toHaveText(['Alex']);
});

test('presence controls fit a narrow viewport and work from the keyboard', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('/editor/collaboration/presence-and-awareness/', docsUrl!).href);
  const demo = page.locator('.sd-collaboration-demo');
  const disconnect = demo.getByRole('button', { name: 'Disconnect Sam' });
  await expect(disconnect).toBeEnabled({ timeout: 90_000 });
  await disconnect.focus();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('listitem')).toHaveText(['Alex']);
  await expect(demo.getByRole('button', { name: 'Reconnect Sam' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
