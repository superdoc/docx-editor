import { Server } from '@hocuspocus/server';
import { localStorage } from './local-storage';
import { demoAccess } from './demo-access';

const port = 1234 + Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
const storageDirectory = process.env.COLLABORATION_STORAGE_DIR;
const server = Server.configure({
  port,
  address: '127.0.0.1',
  ...(storageDirectory ? localStorage(storageDirectory) : {}),
  ...(process.env.COLLABORATION_DEMO_AUTH === '1' ? demoAccess : {}),
});
await server.listen();

const stop = async () => {
  await server.destroy();
  process.exit();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
