import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const edit = 'VERSIONHISTORYEDITMARKER';

test('saves and restores a DOCX snapshot', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/');
  const save = page.getByRole('button', { name: 'Save version' });
  await expect(save).toBeEnabled({ timeout: 120_000 });
  const saveLocked = await save.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
    return button.disabled;
  });
  expect(saveLocked).toBe(true);
  await expect(page.getByRole('button', { name: 'Restore version 1' })).toBeVisible();
  await expect(page.locator('#versions button')).toHaveCount(1);

  const textRun = page.locator('.superdoc-text-run').first();
  await textRun.click();
  await page.keyboard.type(edit);
  await expect(page.locator('#editor')).toContainText(edit);

  await save.click();
  await expect(page.getByRole('button', { name: 'Restore version 2' })).toBeVisible();
  const restoreLocked = await page.getByRole('button', { name: 'Restore version 1' }).evaluate((button: HTMLButtonElement) => {
    button.click();
    return [...document.querySelectorAll<HTMLButtonElement>('#save-version, #export-docx, #versions button')]
      .every((control) => control.disabled);
  });
  expect(restoreLocked).toBe(true);
  await expect(page.locator('#status')).toHaveText('Version 1 restored as version 3.', { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Restore version 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore version 3' })).toBeVisible();
  await expect(page.locator('#editor')).not.toContainText(edit);

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export current DOCX' }).click();
  const path = await (await download).path();
  if (!path) throw new Error('The browser did not save the exported DOCX.');

  const zip = await JSZip.loadAsync(await readFile(path));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toContain('Discovery report');
  expect(documentXml).not.toContain(edit);
  await page.getByRole('button', { name: 'Restore version 2' }).click();
  await expect(page.locator('#status')).toHaveText('Version 2 restored as version 4.', { timeout: 120_000 });
  await expect(page.locator('#editor')).toContainText(edit);
  const newerDownload = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export current DOCX' }).click();
  const newerPath = await (await newerDownload).path();
  if (!newerPath) throw new Error('The browser did not save the newer DOCX.');
  const newerZip = await JSZip.loadAsync(await readFile(newerPath));
  const newerXml = await newerZip.file('word/document.xml')?.async('string');
  expect(newerXml).toContain('Discovery report');
  expect(newerXml).toContain(edit);
  expect(errors).toEqual([]);
});
