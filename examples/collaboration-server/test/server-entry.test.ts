import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { signExampleToken } from '../src/auth/example-token.ts';
import { connect, freePort, open, startServer, waitFor, type Client } from './helpers.ts';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const ROOM = 'sd2/v2.1/contract-42';
const templateDirectory = fileURLToPath(new URL('..', import.meta.url));

const token = (secret: string) =>
  signExampleToken(secret, { sub: 'alice', documents: ['contract-42'], exp: Math.floor(Date.now() / 1000) + 60 });

interface RunningEntry {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function runEntry(t: TestContext, env: Record<string, string>): RunningEntry {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: templateDirectory,
    env: { PATH: process.env.PATH ?? '', HOST: '127.0.0.1', COLLABORATION_DOCX: 'off', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  return { child, output: () => output, exited };
}

async function waitForOutput(entry: RunningEntry, text: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!entry.output().includes(text)) {
    if (entry.child.exitCode !== null) throw new Error(`server.ts exited early:\n${entry.output()}`);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for "${text}":\n${entry.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function storageDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('pnpm start serves rooms, checks tokens and stops cleanly on SIGTERM', async (t) => {
  const port = await freePort();
  const directory = await storageDirectory(t);
  const entry = runEntry(t, {
    PORT: String(port),
    COLLABORATION_AUTH_SECRET: SECRET,
    COLLABORATION_STORAGE_DIR: directory,
  });
  await waitForOutput(entry, 'Collaboration server listening');

  const clients: Client[] = [];
  t.after(() => clients.forEach((client) => client.leave()));
  const running = { port, clients };
  const writer = await connect(running, ROOM, { token: token(SECRET) });
  writer.document.getText('body').insert(0, 'Acknowledged before SIGTERM.');
  await waitFor(() => writer.pendingChanges() === 0, 'the edit acknowledgement');
  assert.equal(
    (await open(running, ROOM, { token: token('a-different-secret-of-at-least-32-chars') })).outcome,
    'denied',
  );
  entry.child.kill('SIGTERM');
  assert.equal(await entry.exited, 0);

  const restarted = await startServer(t, { storageDirectory: directory });
  const reloaded = await connect(restarted, ROOM);
  assert.equal(reloaded.document.getText('body').toString(), 'Acknowledged before SIGTERM.');
});

test('pnpm start refuses to run with token checks but no secret', async (t) => {
  const entry = runEntry(t, { PORT: String(await freePort()), COLLABORATION_STORAGE_DIR: await storageDirectory(t) });

  assert.notEqual(await entry.exited, 0);
  assert.match(entry.output(), /COLLABORATION_AUTH_SECRET/);
});
