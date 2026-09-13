import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

test('saved room survives everyone leaving and a server process restart', async ({ browser }) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'superdoc-room-storage-'));
  const port = 1234 + Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
  let server: ChildProcess | undefined;
  let output = '';
  async function startServer() {
    output = '';
    server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      env: { ...process.env, COLLABORATION_STORAGE_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (data) => { output += String(data); });
    server.stderr?.on('data', (data) => { output += String(data); });
    await expect.poll(async () => {
      if (server?.exitCode != null) throw new Error(output);
      return fetch(`http://127.0.0.1:${port}`).then((response) => response.ok).catch(() => false);
    }).toBe(true);
  }
  async function stopServer() {
    if (!server || server.exitCode != null) return;
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
    server = undefined;
  }
  const context = await browser.newContext();
  try {
    await startServer();
    const creator = await context.newPage();
    await creator.goto('/?mode=create&user=Alex');
    await expect(creator.locator('#status')).toHaveText('Connected.', { timeout: 60_000 });
    output = '';
    await creator.locator('.superdoc-text-run').first().click();
    await creator.keyboard.type('PERSISTEDMARKER');
    await expect.poll(() => output).toContain('Room state saved.');
    await creator.close();
    await stopServer();
    await startServer();
    const reopened = await context.newPage();
    await reopened.goto('/?user=Sam');
    await expect(reopened.locator('#status')).toHaveText('Connected.', { timeout: 60_000 });
    await expect(reopened.locator('#editor')).toContainText('PERSISTEDMARKER');
    const download = reopened.waitForEvent('download');
    await reopened.getByRole('button', { name: 'Export DOCX' }).click();
    const file = await (await download).path();
    if (!file) throw new Error('Export did not produce a DOCX.');
    const zip = await JSZip.loadAsync(await readFile(file));
    expect(await zip.file('word/document.xml')?.async('string')).toContain('PERSISTEDMARKER');
  } finally {
    await context.close();
    await stopServer();
    await rm(directory, { recursive: true, force: true });
  }
});
