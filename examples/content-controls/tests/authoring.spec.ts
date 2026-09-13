import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const clientName = 'Acme Products, Inc.';
const confidentialityClause =
  'Each party will protect confidential information with reasonable care and use it only to perform this agreement.';
const mutualClause = 'Both parties will protect confidential information for three years after this agreement ends.';

async function textBoundary(line: Locator, text: string, offset: number): Promise<{ x: number; y: number }> {
  const point = await line.evaluate(
    (element, input) => {
      const fullText = element.textContent ?? '';
      const matchStart = fullText.indexOf(input.text);
      if (matchStart < 0) return null;

      const targetOffset = matchStart + input.offset;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let remaining = targetOffset;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const length = node.textContent?.length ?? 0;
        if (remaining <= length) {
          const range = document.createRange();
          range.setStart(node, Math.min(remaining, length));
          range.collapse(true);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + 0.5, y: rect.top + rect.height / 2 };
        }
        remaining -= length;
      }
      return null;
    },
    { text, offset },
  );
  if (!point) throw new Error(`Could not find ${text}.`);
  return point;
}

async function selectText(page: Page, text: string): Promise<void> {
  const line = page.locator('.superdoc-line', { hasText: text }).first();
  await expect(line).toBeVisible({ timeout: 120_000 });
  const start = await textBoundary(line, text, 0);
  const end = await textBoundary(line, text, text.length);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function clickEmptyClauseLine(page: Page): Promise<void> {
  const heading = page.locator('.superdoc-line', { hasText: '4. Confidentiality' }).first();
  const nextHeading = page.locator('.superdoc-line', { hasText: '5. Ownership' }).first();
  await expect(heading).toBeVisible({ timeout: 120_000 });
  await expect(nextHeading).toBeVisible({ timeout: 120_000 });
  const [headingBox, nextHeadingBox] = await Promise.all([heading.boundingBox(), nextHeading.boundingBox()]);
  if (!headingBox || !nextHeadingBox) throw new Error('The clause slot is not visible.');
  await page.mouse.click(headingBox.x + 4, (headingBox.y + headingBox.height + nextHeadingBox.y) / 2);
}

test('routes between the add and fill workflows', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#authoring-panel')).toBeVisible();
  await expect(page.locator('#filling-panel')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Add fields' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Fill fields' })).not.toHaveAttribute('aria-current', 'page');

  await page.goto('/?workflow=fill');
  await expect(page.locator('#authoring-panel')).toBeHidden();
  await expect(page.locator('#filling-panel')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add fields' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Fill fields' })).toHaveAttribute('aria-current', 'page');
});

test('reports a workflow chunk that cannot be loaded', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/assets/authoring-*.js', (route) => route.abort('failed'));

  await page.goto('/?workflow=add');

  await expect(page.locator('#authoring-status')).toHaveText(
    'The Add fields workflow could not be loaded. Reload to try again.',
  );
  expect(errors).toEqual([]);
});

test('rejects selections outside the authoring slots', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page.locator('#authoring-status')).toHaveText('Select the client name to add the first field.', {
    timeout: 120_000,
  });

  await selectText(page, 'Provider will deliver product design');
  await page.getByRole('button', { name: 'Add inline field' }).click();
  await expect(page.locator('#authoring-status')).toHaveText('Select the client name in the document first.');
  await expect(page.locator('#detected-controls')).toHaveText('No fields yet.');

  await page.reload();
  await expect(page.locator('#authoring-status')).toHaveText('Select the client name to add the first field.', {
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Add inline field' }).click();
  await expect(page.locator('#authoring-status')).toHaveText('Select the client name in the document first.');
  await expect(page.locator('#detected-controls')).toHaveText('No fields yet.');

  await page.locator('.superdoc-line', { hasText: 'Provider will deliver product design' }).first().click();
  await page.getByRole('button', { name: 'Add block field' }).click();
  await expect(page.locator('#authoring-status')).toHaveText(
    'Place the caret on the empty line under Confidentiality first.',
  );
  await expect(page.locator('#detected-controls')).toHaveText('No fields yet.');
});

test('authors, exports, and reopens inline and block fields', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/?workflow=add');
  await expect(page.locator('#authoring-status')).toHaveText('Select the client name to add the first field.', {
    timeout: 120_000,
  });

  await selectText(page, clientName);
  await page.getByRole('button', { name: 'Add inline field' }).click();
  await expect(page.locator('#authoring-status')).toHaveText('Added the client name field.', { timeout: 120_000 });
  await expect(page.locator('#detected-controls')).toContainText('client.legalName');
  await expect(page.locator('#detected-controls')).toContainText('inline · text');
  await expect(page.getByRole('button', { name: 'Add inline field' })).toBeDisabled();
  await expect(page.locator('#detected-controls code', { hasText: 'client.legalName' })).toHaveCount(1);

  await clickEmptyClauseLine(page);
  await page.getByRole('button', { name: 'Add block field' }).click();
  await expect(page.locator('#authoring-status')).toHaveText('Added the confidentiality clause field.', {
    timeout: 120_000,
  });
  await expect(page.locator('#detected-controls')).toContainText('agreement.confidentiality');
  await expect(page.locator('#detected-controls')).toContainText('block · richText');
  await expect(page.locator('#editor')).toContainText(confidentialityClause);
  await expect(page.getByRole('button', { name: 'Add block field' })).toBeDisabled();
  await page.getByRole('button', { name: 'Use mutual confidentiality clause' }).click();
  await expect(page.locator('#authoring-status')).toHaveText('Replaced the confidentiality clause.', {
    timeout: 120_000,
  });
  await expect(page.locator('#editor')).toContainText(mutualClause);
  await page.getByRole('button', { name: 'Use mutual confidentiality clause' }).click();
  await expect(page.locator('#authoring-status')).toHaveText(
    /^(Replaced the confidentiality clause\.|The mutual confidentiality clause is already in use\.)$/,
  );
  await expect(page.getByRole('button', { name: 'Use mutual confidentiality clause' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export template' })).toBeEnabled();
  await expect(page.locator('#editor')).not.toContainText(confidentialityClause);
  await expect(page.locator('#detected-controls code', { hasText: 'agreement.confidentiality' })).toHaveCount(1);

  await page.evaluate(() => {
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => {
      URL.createObjectURL = createObjectURL;
      throw new Error('Blocked template download.');
    };
  });
  await page.getByRole('button', { name: 'Export template' }).click();
  await expect(page.locator('#authoring-status')).toHaveText('The template could not be exported.');
  await expect(page.getByRole('button', { name: 'Export template' })).toBeEnabled();
  expect(errors).toEqual([]);

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export template' }).click();
  const downloadPath = await (await download).path();
  if (!downloadPath) throw new Error('The browser did not save the exported DOCX.');
  const exported = await readFile(downloadPath);

  const zip = await JSZip.loadAsync(exported);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  expect(documentXml).toContain('<w:tag w:val="client.legalName"');
  expect(documentXml).toContain('<w:tag w:val="agreement.confidentiality"');
  const clauseContents = await page.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml!, 'application/xml');
    const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    return [...document.getElementsByTagNameNS(namespace, 'sdt')]
      .filter((control) =>
        [...control.getElementsByTagNameNS(namespace, 'tag')].some(
          (tag) => tag.getAttributeNS(namespace, 'val') === 'agreement.confidentiality',
        ),
      )
      .map((control) => control.getElementsByTagNameNS(namespace, 'sdtContent')[0]?.textContent);
  }, documentXml);
  expect(clauseContents).toEqual([mutualClause]);
  expect(documentXml).not.toContain(confidentialityClause);
  expect(documentXml).toMatch(/<w:p[^>]*>[\s\S]*<w:sdt>[\s\S]*client\.legalName[\s\S]*<\/w:sdt>[\s\S]*<\/w:p>/);
  expect(documentXml).toMatch(/<w:body[^>]*>[\s\S]*<w:sdt>[\s\S]*agreement\.confidentiality[\s\S]*<w:sdtContent><w:p/);

  await page.route('**/service-agreement-draft.docx', (route) =>
    route.fulfill({
      body: exported,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await page.reload();
  await expect(page.locator('#detected-controls')).toContainText('client.legalName', { timeout: 120_000 });
  await expect(page.locator('#detected-controls')).toContainText('agreement.confidentiality');
  const reopenedClause = page.locator('#detected-controls li').filter({ hasText: 'agreement.confidentiality' });
  await expect(reopenedClause).toHaveCount(1);
  await expect(reopenedClause).toContainText('block · richText');
  await expect(page.locator('#editor')).toContainText(mutualClause);
  await expect(page.locator('#editor')).not.toContainText(confidentialityClause);
  expect(errors).toEqual([]);
});
