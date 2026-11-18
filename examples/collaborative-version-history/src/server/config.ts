import type { CheckpointPolicy } from './checkpoints.ts';

export interface ServerConfig {
  port: number;
  host: string;
  dataDirectory: string;
  sourceDocx: string;
  checkpoints: CheckpointPolicy;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const offset = Number(env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
  return {
    port: wholeNumber(env, 'PORT', 1250 + offset, 1),
    host: env.HOST ?? '127.0.0.1',
    dataDirectory: env.VERSION_DATA_DIR ?? './version-data',
    sourceDocx: env.SOURCE_DOCX ?? './public/sample.docx',
    checkpoints: {
      idleMs: optionalMs(env, 'CHECKPOINT_IDLE_MS', 30_000),
      maxIntervalMs: optionalMs(env, 'CHECKPOINT_MAX_INTERVAL_MS', 600_000),
      whenLastEditorLeaves: (env.CHECKPOINT_WHEN_LAST_EDITOR_LEAVES ?? 'on') !== 'off',
    },
  };
}

function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number) {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be a whole number of at least ${minimum}. Received "${raw}".`);
  }
  return value;
}

function optionalMs(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  if (env[name] === 'off') return null;
  return wholeNumber(env, name, fallback, 1);
}
