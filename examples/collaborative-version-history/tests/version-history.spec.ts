import { expect, test, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createSuperDocClient } from '@superdoc/sdk';
import { apiBase, startServer, type RunningServer } from './server-process.ts';

interface VersionRecord {
  id: string;
  label: string;
  trigger: string;
  createdBy: string;
  sha256: string;
  restoredFrom?: string;
}

const MARKERS = {
  ann: 'ANNFIRSTEDITMARKER',
  ben: 'BENFIRSTEDITMARKER',
  benOffline: 'BENOFFLINEEDITMARKER',
  annWhileBenOffline: 'ANNWHILEBENOFFLINEMARKER',
};

const listVersions = async () =>
  ((await (await fetch(`${apiBase}/versions`)).json()) as { versions: VersionRecord[]; head: string | null });

const versionText = async (versionId: string) => {
  const response = await fetch(`${apiBase}/versions/${versionId}/content`);
  expect(response.ok).toBe(true);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  return { xml: (await zip.file('word/document.xml')?.async('string')) ?? '', sha256: sha256(bytes) };
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function openEditor(browser: Browser, user: string, errors: string[]) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${user}: ${String(error)}`));
  await page.goto(`/?user=${user}`);
  await expect(page.locator('#connection')).toHaveText('Connected.', { timeout: 120_000 });
  return { context, page };
}

async function typeMarker(page: Page, marker: string) {
  await page.locator('.superdoc-text-run').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(marker);
  await expect(page.locator('#editor')).toContainText(marker);
}

test.describe.configure({ mode: 'serial' });

let dataDirectory: string;
let server: RunningServer | undefined;

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'collaborative-version-history-'));
  server = await startServer(dataDirectory);
});


test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && server) {
    try {
      const versions = await listVersions();
      await testInfo.attach('version-manifest', { body: JSON.stringify(versions, null, 2), contentType: 'application/json' });
      for (const version of versions.versions.slice(-2)) {
        const response = await fetch(`${apiBase}/versions/${version.id}/content`);
        if (response.ok) await testInfo.attach(`${version.id}.docx`, {
          body: Buffer.from(await response.arrayBuffer()),
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }
    } catch {}
  }
  await server?.stop();
  server = undefined;
  await rm(dataDirectory, { recursive: true, force: true });
});

test('a saved version restores after DOCX export and reload', async ({ browser }) => {
  const errors: string[] = [];
  const ann = await openEditor(browser, 'Ann', errors);
  try {
    await typeMarker(ann.page, 'SEED-RESTORE-MARKER');
    const saved = await fetch(`${apiBase}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'After edit', createdBy: 'Ann' }),
    });
    expect(saved.status).toBe(201);
    const restored = await fetch(`${apiBase}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ versionId: 'v1', baseVersionId: (await listVersions()).head, requestedBy: 'Ann' }),
    });
    const result = await restored.json();
    expect(restored.status, JSON.stringify(result)).toBe(200);
    expect(result.restored.restoredFrom).toBe('v1');
    await expect(ann.page.locator('#editor')).not.toContainText('SEED-RESTORE-MARKER');
    await expect(ann.page.locator('#editor')).toContainText('Discovery report');
    expect(errors).toEqual([]);
  } finally {
    await ann.context.close();
  }
});

test('two editors save, compare, restore and rejoin without losing each other’s work', async ({ browser }) => {
  const errors: string[] = [];
  const ann = await openEditor(browser, 'Ann', errors);
  const ben = await openEditor(browser, 'Ben', errors);
  try {
    expect((await listVersions()).versions.map((version) => version.id)).toEqual(['v1']);
    const original = await versionText('v1');

    await typeMarker(ann.page, MARKERS.ann);
    await expect(ben.page.locator('#editor')).toContainText(MARKERS.ann);
    await typeMarker(ben.page, MARKERS.ben);
    for (const editor of [ann, ben]) {
      await expect(editor.page.locator('#editor')).toContainText(MARKERS.ann);
      await expect(editor.page.locator('#editor')).toContainText(MARKERS.ben);
    }

    await ann.page.locator('#version-label').fill('Ann review');
    await ben.page.locator('#version-label').fill('Ben review');
    await Promise.all([ann.page.locator('#save-version').click(), ben.page.locator('#save-version').click()]);
    await expect(ann.page.locator('#status')).toHaveText(/^Saved v[23]\.$/, { timeout: 120_000 });
    await expect(ben.page.locator('#status')).toHaveText(/^Saved v[23]\.$/, { timeout: 120_000 });
    const afterSaves = await listVersions();
    expect(afterSaves.versions.map((version) => version.id)).toEqual(['v1', 'v2', 'v3']);
    expect(new Set(afterSaves.versions.slice(1).map((version) => version.createdBy))).toEqual(new Set(['Ann', 'Ben']));
    for (const versionId of ['v2', 'v3']) {
      const saved = await versionText(versionId);
      expect(saved.xml).toContain(MARKERS.ann);
      expect(saved.xml).toContain(MARKERS.ben);
    }
    for (const editor of [ann, ben]) {
      await expect(editor.page.locator('#versions li')).toHaveCount(3, { timeout: 10_000 });
    }

    await ann.page.locator('#compare-from').selectOption('v1');
    await ann.page.locator('#compare-to').selectOption('v3');
    const [comparison] = await Promise.all([ann.context.waitForEvent('page'), ann.page.locator('#compare').click()]);
    await expect(comparison.locator('#status')).toHaveText(/^\d+ tracked changes?\.$/, { timeout: 120_000 });
    expect(await comparison.evaluate(() => window.comparisonExample.reviewItems)).toBeGreaterThan(0);
    await expect(comparison.locator('#comparison')).toContainText(MARKERS.ann);
    await comparison.close();
    expect((await versionText('v1')).sha256).toBe(original.sha256);
    expect((await versionText('v1')).sha256).toBe(afterSaves.versions[0]!.sha256);

    const stale = await fetch(`${apiBase}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ versionId: 'v1', baseVersionId: 'v2', requestedBy: 'Ben' }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: 'stale-base', head: { id: 'v3' } });
    expect((await listVersions()).head).toBe('v3');

    await ann.page.locator('#versions li[data-version-id="v1"] button').click();
    await expect(ann.page.locator('#status')).toHaveText('Restored v1 as v5. The previous state is kept as v4.', {
      timeout: 120_000,
    });
    for (const editor of [ann, ben]) {
      await expect(editor.page.locator('#editor')).not.toContainText(MARKERS.ann, { timeout: 30_000 });
      await expect(editor.page.locator('#editor')).not.toContainText(MARKERS.ben);
      await expect(editor.page.locator('#editor')).toContainText('Discovery report');
    }
    const afterRestore = await listVersions();
    expect(afterRestore.versions.map(({ id, trigger, restoredFrom }) => ({ id, trigger, restoredFrom }))).toEqual([
      { id: 'v1', trigger: 'named', restoredFrom: undefined },
      { id: 'v2', trigger: 'named', restoredFrom: undefined },
      { id: 'v3', trigger: 'named', restoredFrom: undefined },
      { id: 'v4', trigger: 'before-restore', restoredFrom: undefined },
      { id: 'v5', trigger: 'restore', restoredFrom: 'v1' },
    ]);
    expect((await versionText('v4')).xml).toContain(MARKERS.ben);
    expect((await versionText('v5')).xml).not.toContain(MARKERS.ann);

    await ben.context.setOffline(true);
    await expect(ben.page.locator('#connection')).toHaveText(/^Offline\./, { timeout: 60_000 });
    await typeMarker(ben.page, MARKERS.benOffline);
    await typeMarker(ann.page, MARKERS.annWhileBenOffline);
    await expect(ann.page.locator('#editor')).not.toContainText(MARKERS.benOffline);
    await ben.context.setOffline(false);
    for (const editor of [ann, ben]) {
      await expect(editor.page.locator('#editor')).toContainText(MARKERS.benOffline, { timeout: 60_000 });
      await expect(editor.page.locator('#editor')).toContainText(MARKERS.annWhileBenOffline, { timeout: 60_000 });
    }

    await ann.page.locator('#version-label').fill('After rejoin');
    await ann.page.locator('#save-version').click();
    await expect(ann.page.locator('#status')).toHaveText('Saved v6.', { timeout: 120_000 });
    const acknowledged = await versionText('v6');
    expect(acknowledged.xml).toContain(MARKERS.benOffline);
    expect(acknowledged.xml).toContain(MARKERS.annWhileBenOffline);

    expect(await server!.stop()).toBe(0);
    server = await startServer(dataDirectory);
    const afterRestart = await listVersions();
    expect(afterRestart.versions.map((version) => version.id)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    expect((await versionText('v6')).sha256).toBe(acknowledged.sha256);
    for (const editor of [ann, ben]) {
      await expect(editor.page.locator('#connection')).toHaveText(/Connected\.|Reconnected\./, { timeout: 120_000 });
      await expect(editor.page.locator('#editor')).toContainText(MARKERS.benOffline);
      await expect(editor.page.locator('#editor')).toContainText(MARKERS.annWhileBenOffline);
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([ann.context.close(), ben.context.close()]);
  }
});

test('five peers keep native history and reopen a nonauthor export in a fresh room', async ({ browser }, testInfo) => {
  const errors: string[] = [];
  const peers = [];
  const client = createSuperDocClient({ user: { name: 'Reopen service', email: 'reopen@example.test' } });
  try {
    for (const user of ['Ann', 'Ben', 'Charlie', 'Dana', 'Ellie']) peers.push(await openEditor(browser, user, errors));
    const markers = ['ANN-5538-α', 'BEN-5538-😀', 'CHARLIE-5538-עברית', 'DANA-5538-مرحبا', 'ELLIE-5538-END'];
    const anchors = ['Statement of Work', '1. Scope of Services', '2. Milestones and Fees', '3. Payment Terms', '4. Term and Termination'];
    await Promise.all(peers.map(async (peer, index) => {
      const anchor = anchors[index], marker = markers[index];
      if (!anchor || !marker) throw new Error('Missing peer input');
      await peer.page.locator('.superdoc-text-run').filter({ hasText: anchor }).first().click();
      await peer.page.keyboard.press('End');
      await peer.page.keyboard.type(marker);
      await expect(peer.page.locator('#editor')).toContainText(marker);
    }));
    for (const peer of peers) {
      for (const marker of markers) await expect(peer.page.locator('#editor')).toContainText(marker);
    }
    const [ann, ben, , , ellie] = peers;
    if (!ann || !ben || !ellie) throw new Error('Five independent peers are required');
    const collaborationUrl = new URL(apiBase).origin.replace('http:', 'ws:');
    const initialFile = path.join(dataDirectory, 'initial-version.docx');
    await writeFile(initialFile, new Uint8Array(await (await fetch(`${apiBase}/versions/v1/content`)).arrayBuffer()));
    const initial = await client.open({ doc: initialFile });
    const targetSnapshot = await initial.diff.capture({});
    await initial.close({ discard: true });
    const live = await client.open({
      collaboration: {
        providerType: 'hocuspocus',
        url: collaborationUrl,
        documentId: 'contract-42',
        roomMode: 'join',
      },
    });
    try {
      const stale = await live.diff.compare({ targetSnapshot });
      await typeMarker(ben.page, 'BEN-EDIT-AFTER-COMPARE');
      await expect.poll(() => live.getText({})).toContain('BEN-EDIT-AFTER-COMPARE');
      await expect(live.diff.apply({ diff: stale, changeMode: 'direct' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      for (const peer of peers) await expect(peer.page.locator('#editor')).toContainText('BEN-EDIT-AFTER-COMPARE');
    } finally {
      await live.close({ discard: true });
    }
    const checkpoint = await fetch(`${apiBase}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Five authors', createdBy: 'Ann' }),
    });
    expect(checkpoint.status).toBe(201);
    const saved: VersionRecord = await checkpoint.json();
    for (const versionId of ['v1', saved.id]) {
      const restored = await fetch(`${apiBase}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId, baseVersionId: (await listVersions()).head, requestedBy: 'Ann' }),
      });
      expect(restored.status).toBe(200);
      for (const peer of peers) {
        for (const marker of markers) {
          if (versionId === 'v1') await expect(peer.page.locator('#editor')).not.toContainText(marker);
          else await expect(peer.page.locator('#editor')).toContainText(marker);
        }
      }
    }
    await ann.page.screenshot({ path: testInfo.outputPath('five-peer-version-history.png'), fullPage: true });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    for (let cycle = 0; cycle < 2; cycle++) {
      await ann.page.waitForTimeout(600);
      const own = `BEN-HISTORY-${cycle}`;
      const remote = `ANN-AFTER-BEN-${cycle}`;
      await typeMarker(ben.page, own);
      await expect(ann.page.locator('#editor')).toContainText(own);
      await typeMarker(ann.page, remote);
      await expect(ben.page.locator('#editor')).toContainText(remote);
      await ben.page.keyboard.press(`${modifier}+z`);
      for (const peer of peers) {
        await expect(peer.page.locator('#editor')).not.toContainText(own);
        await expect(peer.page.locator('#editor')).toContainText(remote);
      }
      await ben.page.keyboard.press(`${modifier}+Shift+z`);
      for (const peer of peers) await expect(peer.page.locator('#editor')).toContainText(own);
    }
    const exported = await ellie.page.evaluate(async () => {
      const blob = await window.versionHistoryExample.superdoc.export({ exportType: ['docx'], triggerDownload: false });
      if (!(blob instanceof Blob)) throw new Error('The nonauthor export did not return DOCX.');
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const bytes = new Uint8Array(exported);
    const xml = (await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string')) ?? '';
    for (const marker of markers) expect(xml).toContain(marker);
    expect(xml).toContain('BEN-HISTORY-1');
    expect(xml).toContain('ANN-AFTER-BEN-1');
    const file = path.join(dataDirectory, 'nonauthor-export.docx');
    await writeFile(file, bytes);
    const freshId = 'nonauthor-export-room';
    const seed = await client.open({
      doc: file,
      collaboration: { providerType: 'hocuspocus', url: collaborationUrl, documentId: freshId, roomMode: 'create' },
    });
    await seed.close({ discard: true });
    const late = await openEditor(browser, 'Late', errors);
    peers.push(late);
    await late.page.goto(`/?user=Late&doc=${freshId}`);
    await expect(late.page.locator('#connection')).toHaveText('Connected.', { timeout: 120_000 });
    for (const marker of markers) await expect(late.page.locator('#editor')).toContainText(marker);
    await expect(late.page.locator('#editor')).toContainText('BEN-HISTORY-1');
    await typeMarker(late.page, 'FRESH-ROOM-CONTINUES');
    await expect(ann.page.locator('#editor')).not.toContainText('FRESH-ROOM-CONTINUES');
    expect(errors).toEqual([]);
  } finally {
    await client.dispose();
    await Promise.allSettled(peers.map((peer) => peer.context.close()));
  }
});
