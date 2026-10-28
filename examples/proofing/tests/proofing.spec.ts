import { expect, test, type Locator } from '@playwright/test';

test('rechecks new text, replaces a dictionary typo, and ignores a word', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/');
  await expect(page.locator('#editor')).toContainText('don’t mispelled', { timeout: 120_000 });

  const endPoint = await textPoint(page.locator('#editor'), 'mispelled');
  await page.mouse.click(endPoint.right + 2, endPoint.y);
  await page.keyboard.press('End');
  await page.keyboard.type(' workng');
  await expect(page.locator('#editor')).toContainText('don’t mispelled workng');
  await waitForSpellingHighlight(page.locator('#editor'), 'workng');

  const typoPoint = await textPoint(page.locator('#editor'), 'workng');
  await page.mouse.click(typoPoint.x, typoPoint.y, { button: 'right' });
  const replacement = page.locator('[data-sd-context-menu-item="proofing-replace-0"]');
  await expect(replacement).toBeVisible({ timeout: 120_000 });
  await expect(replacement).toHaveText('working');
  await replacement.click();

  await expect(page.locator('#editor')).toContainText('mispelled working', { timeout: 120_000 });
  await expect(page.locator('#editor')).not.toContainText('workng');
  await waitForSpellingHighlight(page.locator('#editor'), 'mispelled');

  const ignoredPoint = await textPoint(page.locator('#editor'), 'mispelled');
  await page.mouse.click(ignoredPoint.x, ignoredPoint.y, { button: 'right' });
  const ignore = page.locator('[data-sd-context-menu-item="proofing-ignore"]');
  await expect(ignore).toBeVisible({ timeout: 120_000 });
  await ignore.click();
  await expect(page.locator('[data-sd-context-menu]')).toBeHidden();

  await page.mouse.click(ignoredPoint.x, ignoredPoint.y, { button: 'right' });
  await expect(page.locator('[data-sd-context-menu]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-sd-context-menu-section="proofing"]')).toHaveCount(0);

  const apostrophePoint = await textPoint(page.locator('#editor'), 'don’t');
  await page.mouse.click(apostrophePoint.x, apostrophePoint.y, { button: 'right' });
  await expect(page.locator('[data-sd-context-menu]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-sd-context-menu-section="proofing"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function waitForSpellingHighlight(editor: Locator, word: string) {
  await expect.poll(() => editor.evaluate((root, target) =>
    [...(CSS.highlights.get('sd-proofing-spelling') ?? [])].some(range =>
      root.contains(range.startContainer) && range.toString() === target), word),
  { timeout: 120_000 }).toBe(true);
}

async function textPoint(editor: Locator, text: string) {
  return editor.evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const start = node.textContent?.indexOf(target) ?? -1;
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + target.length);
        const rect = Array.from(range.getClientRects()).find(({ width, height }) => width > 0 && height > 0);
        if (!rect) throw new Error(`The text was not visibly rendered: ${target}`);
        return { x: rect.left + rect.width / 2, right: rect.right, y: rect.top + rect.height / 2 };
      }
      node = walker.nextNode();
    }
    throw new Error(`The seeded text was not rendered: ${target}`);
  }, text);
}
