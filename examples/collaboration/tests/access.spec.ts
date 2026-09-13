import { expect, test } from '@playwright/test';
import { authenticateRoom } from '../demo-access';

test('server checks credentials against the requested room', async () => {
  await expect(authenticateRoom({ token: 'demo-alex', documentName: 'sd2/v2.1/example-room' })).resolves.toEqual({ userId: 'alex' });
  for (const token of ['', 'invalid', 'demo-taylor']) {
    await expect(authenticateRoom({ token, documentName: 'sd2/v2.1/example-room' })).rejects.toThrow('Access denied');
  }
  for (const documentName of ['sd2/v2.1/another-room', 'example-room', 'sd2/v2.1/example-room/extra']) {
    await expect(authenticateRoom({ token: 'demo-alex', documentName })).rejects.toThrow('Access denied');
  }
});

test('authorized editors synchronize while a known user without access is rejected', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  try {
    const alex = await context.newPage();
    await alex.goto('/?mode=create&user=Alex');
    await expect(alex.locator('#status')).toHaveText('Connected.', { timeout: 60_000 });
    await alex.locator('.superdoc-text-run').first().click();
    await alex.keyboard.type('AUTHORIZEDROOMMARKER');
    const sam = await context.newPage();
    await sam.goto('/?user=Sam');
    await expect(sam.locator('#status')).toHaveText('Connected.', { timeout: 60_000 });
    await expect(sam.locator('#editor')).toContainText('AUTHORIZEDROOMMARKER');
    const taylor = await context.newPage();
    await taylor.goto('/?user=Taylor');
    await expect(taylor.locator('#status')).toHaveText('Connection failed.', { timeout: 60_000 });
    await expect(taylor.locator('#editor')).not.toContainText('AUTHORIZEDROOMMARKER');
    await expect(taylor.getByRole('button', { name: 'Export DOCX' })).toBeDisabled();
    await expect(alex.locator('#participants li')).toHaveText(['Alex', 'Sam']);
  } finally {
    await context.close();
  }
});
