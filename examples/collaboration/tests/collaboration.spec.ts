import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const edit = 'COLLABORATIONEDITMARKER';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LARGE_ANCHORS = {
  head: 'LARGE_COLLAB_HEAD_1425',
  middle: 'LARGE_COLLAB_MIDDLE_1425',
  tail: 'LARGE_COLLAB_TAIL_1425',
};

async function buildLargePagedDocx(): Promise<Buffer> {
  const paragraphCount = 64;
  const filler = 'content '.repeat(600);
  const body = Array.from({ length: paragraphCount }, (_, index) => {
    const paraId = (index + 1).toString(16).toUpperCase().padStart(8, '0');
    const anchor =
      index === 0
        ? `${LARGE_ANCHORS.head} `
        : index === Math.floor(paragraphCount / 2)
          ? `${LARGE_ANCHORS.middle} `
          : index === paragraphCount - 1
            ? `${LARGE_ANCHORS.tail} `
            : '';
    const pageBreak = index === 0 ? '' : '<w:r><w:br w:type="page"/></w:r>';
    return `<w:p w14:paraId="${paraId}">${pageBreak}<w:r><w:t xml:space="preserve">${anchor}Paragraph ${index}. ${filler}</w:t></w:r></w:p>`;
  }).join('');
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">' +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`;
  expect(new TextEncoder().encode(documentXml).byteLength).toBeGreaterThan(256 * 1024);

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  );
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

async function routeSampleDocx(page: Page, docx: Buffer): Promise<void> {
  await page.route('**/sample.docx', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: DOCX_MIME,
      body: docx,
    });
  });
}

async function exportDocumentXml(page: Page): Promise<string> {
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export DOCX' }).click();
  const path = await (await download).path();
  if (!path) throw new Error('The browser did not save the exported DOCX.');

  const zip = await JSZip.loadAsync(await readFile(path));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('exported DOCX has no word/document.xml');
  return documentXml;
}

async function expectDocumentXmlParses(page: Page, documentXml: string): Promise<void> {
  await expect(
    page.evaluate((xml) => {
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      return parsed.querySelector('parsererror')?.textContent ?? null;
    }, documentXml),
  ).resolves.toBeNull();
}

test('synchronizes a DOCX edit between two browser pages', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const creator = await context.newPage();
  const joiner = await context.newPage();
  const errors: string[] = [];

  for (const page of [creator, joiner]) {
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
  }

  await creator.goto('/?mode=create&user=Creator');
  await expect(creator.locator('#status')).toHaveText('Connected.', { timeout: 180_000 });
  await joiner.goto('/?user=Joiner');
  await expect(joiner.locator('#status')).toHaveText('Connected.', { timeout: 180_000 });
  await expect(creator.locator('#participants li')).toHaveText(['Creator', 'Joiner']);
  await expect(joiner.locator('#participants li')).toHaveText(['Joiner', 'Creator']);

  const textRun = creator.locator('.superdoc-text-run').first();
  await textRun.click();
  await creator.keyboard.type(edit);
  await expect(joiner.locator('#editor')).toContainText(edit, { timeout: 120_000 });

  const reply = 'COLLABORATIONREPLYMARKER';
  await joiner.locator('.superdoc-text-run').filter({ hasText: 'Alex and Sam will confirm' }).first().click();
  await joiner.keyboard.type(reply);
  await expect(creator.locator('#editor')).toContainText(reply, { timeout: 120_000 });

  const documentXml = await exportDocumentXml(joiner);
  expect(documentXml).toContain(edit);
  expect(documentXml).toContain(reply);
  await joiner.close();
  await expect(creator.locator('#participants li')).toHaveText(['Creator']);
  await expect(creator.locator('#editor')).toContainText(reply);
  const reopened = await context.newPage();
  await reopened.goto('/?user=Joiner');
  await expect(reopened.locator('#status')).toHaveText('Connected.', { timeout: 180_000 });
  await expect(reopened.locator('#editor')).toContainText(edit);
  await expect(reopened.locator('#editor')).toContainText(reply);
  const duplicateCreator = await context.newPage();
  await duplicateCreator.goto('/?mode=create&user=Creator');
  await expect(duplicateCreator.locator('#status')).toHaveText('Connection failed.', { timeout: 180_000 });
  await expect(creator.locator('#editor')).toContainText(edit);
  await expect(creator.locator('#editor')).toContainText(reply);
  expect(errors).toEqual([]);
  await context.close();
});

test('renders the same large DOCX page count for a room creator and joiner', async ({ browser }) => {
  test.setTimeout(300_000);
  const docx = await buildLargePagedDocx();
  const context = await browser.newContext();
  const creator = await context.newPage();
  const joiner = await context.newPage();
  const errors: string[] = [];

  for (const page of [creator, joiner]) {
    await routeSampleDocx(page, docx);
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
  }

  await creator.goto('/?mode=create&user=LargeCreator');
  await expect(creator.locator('#status')).toHaveText('Connected.', { timeout: 180_000 });
  const creatorPages = await expect
    .poll(() => creator.locator('.superdoc-page').count(), { timeout: 180_000 })
    .toBeGreaterThan(1)
    .then(() => creator.locator('.superdoc-page').count());

  await joiner.goto('/?user=LargeJoiner');
  await expect(joiner.locator('#status')).toHaveText('Connected.', { timeout: 180_000 });
  await expect.poll(() => joiner.locator('.superdoc-page').count(), { timeout: 180_000 }).toBe(creatorPages);

  const documentXml = await exportDocumentXml(joiner);
  await expectDocumentXmlParses(joiner, documentXml);
  expect(documentXml).toContain(LARGE_ANCHORS.head);
  expect(documentXml).toContain(LARGE_ANCHORS.middle);
  expect(documentXml).toContain(LARGE_ANCHORS.tail);
  expect(errors).toEqual([]);
  await context.close();
});
