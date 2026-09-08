import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const clientName = 'Northstar Labs LLC';
const templatePath = new URL('../public/service-agreement-template.docx', import.meta.url);

async function activeContentControlId(page: Page) {
  return page.evaluate(() => {
    const caret = document.querySelector<HTMLElement>('[data-v2-local-selection-caret]')?.getBoundingClientRect();
    if (!caret) return null;
    const ids = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-sdt-id]')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            caret.left >= rect.left - 1 &&
            caret.left <= rect.right + 1 &&
            caret.top >= rect.top - 1 &&
            caret.top <= rect.bottom + 1
          );
        })
        .map((element) => element.dataset.sdtId)
        .filter((id): id is string => Boolean(id)),
    );
    return ids.size === 1 ? [...ids][0] : null;
  });
}

async function clientControlIds(page: Page) {
  return page
    .locator('[data-sdt-tag="client.legalName"][data-sdt-id]')
    .evaluateAll((elements) => [
      ...new Set(elements.map((element) => (element as HTMLElement).dataset.sdtId).filter(Boolean)),
    ]);
}

async function makeSecondClientNameOccurrenceIncompatible() {
  const zip = await JSZip.loadAsync(await readFile(templatePath));
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('The template has no word/document.xml part.');

  const documentXml = await documentPart.async('string');
  const occurrences = [...documentXml.matchAll(/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/g)].filter((match) =>
    match[0].includes('<w:tag w:val="client.legalName"/>'),
  );
  const occurrence = occurrences[1];
  if (!occurrence || occurrence.index === undefined) throw new Error('The template has fewer than two client names.');

  const incompatibleProperties = occurrence[0].replace(
    '<w:text/>',
    '<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:font="MS Gothic" w14:val="2612"/><w14:uncheckedState w14:font="MS Gothic" w14:val="2610"/></w14:checkbox>',
  );
  if (incompatibleProperties === occurrence[0]) throw new Error('The client name control is not a text control.');
  const incompatibleXml = `${documentXml.slice(0, occurrence.index)}${incompatibleProperties}${documentXml.slice(
    occurrence.index + occurrence[0].length,
  )}`;
  zip.file('word/document.xml', incompatibleXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makeAutoRenewFieldIncompatible() {
  const zip = await JSZip.loadAsync(await readFile(templatePath));
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('The template has no word/document.xml part.');

  const documentXml = await documentPart.async('string');
  const autoRenewProperties = [...documentXml.matchAll(/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/g)].find((match) =>
    match[0].includes('<w:tag w:val="agreement.autoRenew"/>'),
  );
  if (!autoRenewProperties || autoRenewProperties.index === undefined) {
    throw new Error('The template has no auto-renew field.');
  }

  const incompatibleProperties = autoRenewProperties[0].replace(/<w14:checkbox>[\s\S]*?<\/w14:checkbox>/, '<w:text/>');
  if (incompatibleProperties === autoRenewProperties[0]) throw new Error('The auto-renew field is not a checkbox.');
  const incompatibleXml = `${documentXml.slice(0, autoRenewProperties.index)}${incompatibleProperties}${documentXml.slice(
    autoRenewProperties.index + autoRenewProperties[0].length,
  )}`;
  zip.file('word/document.xml', incompatibleXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('populates, exports, and reopens the service agreement', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/?workflow=fill');
  const nameInput = page.getByRole('textbox', { name: 'Client legal name' });
  await expect(nameInput).toBeEnabled({ timeout: 120_000 });
  await expect(nameInput).toHaveValue('Acme Products, Inc.');

  await nameInput.fill(clientName);
  await expect(page.locator('#filling-status')).toHaveText('Updated 3 locations.', { timeout: 120_000 });
  await expect(page.locator('#editor')).toContainText(clientName);

  await page.getByLabel('Auto-renew').check();
  await expect(page.locator('#filling-status')).toHaveText('Updated 1 location.', { timeout: 120_000 });
  await expect(page.locator('#editor')).toContainText('☒');

  const controlIds = await clientControlIds(page);
  expect(controlIds).toHaveLength(3);
  const next = page.getByRole('button', { name: 'Next client legal name occurrence' });
  const previous = page.getByRole('button', { name: 'Previous client legal name occurrence' });

  await next.click();
  await expect(page.locator('#filling-status')).toHaveText('Focused client name 2 of 3.', { timeout: 120_000 });
  await expect.poll(() => activeContentControlId(page)).toBe(controlIds[1]);
  await next.click();
  await expect(page.locator('#filling-status')).toHaveText('Focused client name 3 of 3.', { timeout: 120_000 });
  await expect.poll(() => activeContentControlId(page)).toBe(controlIds[2]);
  await next.click();
  await expect(page.locator('#filling-status')).toHaveText('Focused client name 1 of 3.', { timeout: 120_000 });
  await expect.poll(() => activeContentControlId(page)).toBe(controlIds[0]);
  await previous.click();
  await expect(page.locator('#filling-status')).toHaveText('Focused client name 3 of 3.', { timeout: 120_000 });
  await expect.poll(() => activeContentControlId(page)).toBe(controlIds[2]);

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export DOCX' }).click();
  const downloadPath = await (await download).path();
  if (!downloadPath) throw new Error('The browser did not save the exported DOCX.');
  const exported = await readFile(downloadPath);

  const zip = await JSZip.loadAsync(exported);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toBeDefined();
  expect(documentXml?.match(/<w:tag w:val="client\.legalName"/g)).toHaveLength(3);
  expect(documentXml?.match(new RegExp(clientName, 'g'))).toHaveLength(3);
  expect(documentXml).toContain('<w14:checked w14:val="1"');
  expect(documentXml).toContain('☒');

  await page.route('**/service-agreement-template.docx', (route) =>
    route.fulfill({
      body: exported,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Client legal name' })).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByRole('textbox', { name: 'Client legal name' })).toHaveValue(clientName);
  await expect(page.getByLabel('Auto-renew')).toBeChecked();
  expect(errors).toEqual([]);
});

test('locks the filled address and keeps its value and lock after reopening', async ({ page }) => {
  test.setTimeout(180_000);
  async function exportControls() {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export DOCX' }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing exported DOCX.');
    const bytes = await readFile(path);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    const controls = await page.evaluate((xml) => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      return [...document.getElementsByTagNameNS(namespace, 'sdt')].map((control) => ({
        tag: control.getElementsByTagNameNS(namespace, 'tag')[0]?.getAttributeNS(namespace, 'val'),
        lock: control.getElementsByTagNameNS(namespace, 'lock')[0]?.getAttributeNS(namespace, 'val') ?? null,
        text: control.getElementsByTagNameNS(namespace, 'sdtContent')[0]?.textContent,
      }));
    }, xml);
    return { bytes, controls };
  }

  await page.goto('/?workflow=fill');
  const address = page.getByRole('textbox', { name: 'Client address' });
  await expect(address).toBeEnabled({ timeout: 120_000 });
  await address.fill('42 Review Lane');
  await page.getByLabel('Lock address after filling').check();
  await expect(page.locator('#filling-status')).toHaveText('Client address locked.', { timeout: 120_000 });
  await expect(address).toBeDisabled();
  const { bytes, controls } = await exportControls();
  expect(controls.filter((control) => control.tag === 'client.address')).toEqual([
    { tag: 'client.address', lock: 'contentLocked', text: '42 Review Lane' },
  ]);
  expect(controls.filter((control) => control.lock && control.lock !== 'unlocked').map((control) => control.tag)).toEqual([
    'client.address',
  ]);
  await page.route('**/service-agreement-template.docx', (route) =>
    route.fulfill({
      body: bytes,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await page.reload();
  await expect(page.getByLabel('Lock address after filling')).toBeChecked({ timeout: 120_000 });
  await expect(address).toBeDisabled();
  await page.getByLabel('Lock address after filling').uncheck();
  await expect(address).toBeEnabled();
  const unlocked = await exportControls();
  const unlockedAddresses = unlocked.controls.filter((control) => control.tag === 'client.address');
  expect(unlockedAddresses).toHaveLength(1);
  expect(unlockedAddresses[0].text).toBe('42 Review Lane');
  expect([null, 'unlocked']).toContain(unlockedAddresses[0].lock);
});

test('exports the latest form values without waiting for debounced updates', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?workflow=fill');
  const nameInput = page.getByRole('textbox', { name: 'Client legal name' });
  await expect(nameInput).toBeEnabled({ timeout: 120_000 });

  await nameInput.fill(clientName);
  await page.getByLabel('Auto-renew').check();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export DOCX' }).click();
  const downloadPath = await (await download).path();
  if (!downloadPath) throw new Error('The browser did not save the exported DOCX.');

  const zip = await JSZip.loadAsync(await readFile(downloadPath));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml?.match(new RegExp(clientName, 'g'))).toHaveLength(3);
  expect(documentXml).toContain('<w14:checked w14:val="1"');
});

test('reports a failed filled-document export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/?workflow=fill');
  await expect(page.getByRole('button', { name: 'Export DOCX' })).toBeEnabled({ timeout: 120_000 });
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('Blocked download.');
    };
  });

  await page.getByRole('button', { name: 'Export DOCX' }).click();

  await expect(page.locator('#filling-status')).toHaveText('The filled DOCX could not be exported.');
  await expect(page.getByRole('button', { name: 'Export DOCX' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('waits for navigation readiness and serializes rapid client-name focus requests', async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  test.setTimeout(300_000);
  await page.goto('/?workflow=fill');
  await expect(page.getByRole('textbox', { name: 'Client legal name' })).toBeEnabled({ timeout: 120_000 });

  const controlIds = await clientControlIds(page);
  expect(controlIds).toHaveLength(3);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#previous-client-name')?.click();
    document.querySelector<HTMLButtonElement>('#next-client-name')?.click();
  });

  await expect(page.locator('#filling-status')).toHaveText('Focused client name 1 of 3.', { timeout: 120_000 });
  await expect.poll(() => activeContentControlId(page)).toBe(controlIds[0]);
});

test('shows partial success when one matching control has an incompatible type', async ({ page }) => {
  test.setTimeout(300_000);
  const incompatibleDocument = await makeSecondClientNameOccurrenceIncompatible();
  await page.route('**/service-agreement-template.docx', (route) =>
    route.fulfill({
      body: incompatibleDocument,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await page.goto('/?workflow=fill');
  const nameInput = page.getByRole('textbox', { name: 'Client legal name' });
  await expect(nameInput).toBeEnabled({ timeout: 120_000 });

  await nameInput.fill(clientName);
  await expect(page.locator('#filling-status')).toHaveText('Updated 2 of 3 locations.', { timeout: 120_000 });
  await expect.poll(async () => (await page.locator('#editor').textContent())?.split(clientName).length ?? 0).toBe(3);

  let downloaded = false;
  page.on('download', () => {
    downloaded = true;
  });
  await page.getByRole('button', { name: 'Export DOCX' }).click();
  await expect(page.locator('#filling-status')).toHaveText('Fix failed field updates before exporting.');
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test('keeps export disabled when a template field has an incompatible type', async ({ page }) => {
  test.setTimeout(300_000);
  const incompatibleDocument = await makeAutoRenewFieldIncompatible();
  await page.route('**/service-agreement-template.docx', (route) =>
    route.fulfill({
      body: incompatibleDocument,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );

  await page.goto('/?workflow=fill');
  await expect(page.getByRole('textbox', { name: 'Client legal name' })).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByLabel('Auto-renew')).toBeDisabled();
  await expect(page.locator('#filling-status')).toHaveText('Template fields are missing or incompatible.');
  await expect(page.getByRole('button', { name: 'Export DOCX' })).toBeDisabled();
});
