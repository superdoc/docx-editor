import { isIPv6 } from 'node:net';

export interface ServerConfig {
  port: number;
  host: string;
  storageDirectory: string;
  auth: { mode: 'example-token'; secret: string } | { mode: 'none' };
  docx: { mode: 'autosave'; directory: string; idleMs: number } | { mode: 'off' };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? '1234');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535. Received "${env.PORT}".`);
  }

  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    storageDirectory: env.COLLABORATION_STORAGE_DIR ?? './collaboration-data',
    auth: loadAuth(env),
    docx: loadDocx(env),
  };
}

function loadAuth(env: NodeJS.ProcessEnv): ServerConfig['auth'] {
  const mode = env.COLLABORATION_AUTH ?? 'example-token';
  if (mode === 'none') return { mode };
  if (mode !== 'example-token') {
    throw new Error(`COLLABORATION_AUTH must be "example-token" or "none". Received "${mode}".`);
  }

  const secret = env.COLLABORATION_AUTH_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error(
      'Set COLLABORATION_AUTH_SECRET to a random value of at least 32 characters, ' +
        'or set COLLABORATION_AUTH=none to run without access checks on a private network.',
    );
  }
  return { mode, secret };
}

function loadDocx(env: NodeJS.ProcessEnv): ServerConfig['docx'] {
  const mode = env.COLLABORATION_DOCX ?? 'autosave';
  if (mode === 'off') return { mode };
  if (mode !== 'autosave') throw new Error(`COLLABORATION_DOCX must be "autosave" or "off". Received "${mode}".`);

  const idleMs = Number(env.COLLABORATION_DOCX_IDLE_MS ?? '10000');
  if (!Number.isInteger(idleMs) || idleMs < 0) {
    throw new Error(`COLLABORATION_DOCX_IDLE_MS must be a whole number of milliseconds. Received "${env.COLLABORATION_DOCX_IDLE_MS}".`);
  }
  return { mode, directory: env.COLLABORATION_DOCX_DIR ?? './collaboration-docx', idleMs };
}

export function websocketUrl(host: string, port: number): string {
  return `ws://${isIPv6(host) ? `[${host}]` : host}:${port}`;
}

export function autosaveUrl(config: Pick<ServerConfig, 'host' | 'port'>): string {
  if (config.host === '0.0.0.0') return websocketUrl('127.0.0.1', config.port);
  if (config.host === '::') return websocketUrl('::1', config.port);
  return websocketUrl(config.host, config.port);
}
