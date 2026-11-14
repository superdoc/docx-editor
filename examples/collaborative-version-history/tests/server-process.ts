import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 1250 + Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');

export const apiBase = `http://127.0.0.1:${port}/api/documents/contract-42`;

export interface RunningServer {
  output(): string;
  stop(): Promise<number | null>;
}

export async function startServer(dataDirectory: string): Promise<RunningServer> {
  let output = '';
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: exampleRoot,
    env: {
      ...process.env,
      PORT: String(port),
      VERSION_DATA_DIR: dataDirectory,
      CHECKPOINT_IDLE_MS: 'off',
      CHECKPOINT_MAX_INTERVAL_MS: 'off',
      CHECKPOINT_WHEN_LAST_EDITOR_LEAVES: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));

  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The server exited early:\n${output}`);
    const ready = await fetch(`${apiBase}/versions`)
      .then(async (response) => response.ok && ((await response.json()) as { head: string | null }).head !== null)
      .catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`The server did not become ready:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    output: () => output,
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM');
      return exited;
    },
  };
}
