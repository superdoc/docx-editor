import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test('accepts, rejects, and reopens an undecided proposal', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?workflow=review');
  await expect(page.getByRole('button', { name: 'Accept change' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Accept change' }).click();
  await expect(page.locator('#review-change option')).toHaveCount(0);
  await expect(page.locator('#editor')).toContainText('installation and');

  const payment = page.locator('.superdoc-text-run').filter({ hasText: 'Payment is due within 30 days.' }).first();
  await payment.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' REJECTTHIS');
  await expect(page.locator('#review-change option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reject change' }).click();
  await expect(page.locator('#review-change option')).toHaveCount(0);
  await expect(page.locator('#editor')).not.toContainText('REJECTTHIS');

  await page.locator('.superdoc-text-run').filter({ hasText: 'Support lasts for one year.' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' KEEPUNDECIDED');
  await expect(page.locator('#review-change option')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export DOCX' }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Missing exported DOCX.');
  const bytes = await readFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('installation and');
  expect(xml).not.toContain('REJECTTHIS');
  const revisions = [...xml.matchAll(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g)].map(([value]) => value);
  expect(revisions.join('')).toContain('KEEPUNDECIDED');
  expect(revisions.join('')).not.toContain('installation and');
  await page.route('**/basic-review.docx', (route) =>
    route.fulfill({
      body: bytes,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await page.reload();
  await expect(page.locator('#review-change option')).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator('#editor')).toContainText('KEEPUNDECIDED');
});
