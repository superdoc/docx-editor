import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const selectedText = 'Amazing';

test('formats the DOCX with an application-owned control', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Export DOCX' })).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('.superdoc-toolbar')).toHaveCount(0);

  const textRun = page.locator('.superdoc-text-run').filter({ hasText: selectedText }).first();
  await expect(textRun).toBeVisible();
  await textRun.dblclick();

  // The editor owns its selection and paints it in an overlay, so the native
  // browser selection stays empty. The control reads the editor's command
  // state, which is the signal that the double-click selected the word.
  const bold = page.getByRole('button', { name: 'Bold' });
  await expect(bold).toBeEnabled();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await expect(page.locator('#status')).toHaveText('Bold applied.');
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await bold.click();
  await expect(page.locator('#status')).toHaveText('Bold removed.');
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await expect(page.locator('#status')).toHaveText('Bold applied.');
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => textRun.evaluate((element) => Number.parseInt(getComputedStyle(element).fontWeight, 10)))
    .toBeGreaterThanOrEqual(600);

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export DOCX' }).click();
  const path = await (await download).path();
  if (!path) throw new Error('The browser did not save the exported DOCX.');

  const zip = await JSZip.loadAsync(await readFile(path));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toBeTruthy();
  const selectedRun = documentXml
    ?.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)
    ?.find((run) => run.includes(`>${selectedText}</w:t>`));
  expect(selectedRun).toContain('<w:b');
  expect(errors).toEqual([]);
});
