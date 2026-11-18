import { readFile } from 'node:fs/promises';
import { loadConfig } from './src/server/config.ts';
import { createVersionServer } from './src/server/create-server.ts';

const DOCUMENT_ID = process.env.DOCUMENT_ID ?? 'contract-42';
const config = loadConfig();
const server = createVersionServer(config);

await server.listen();
console.log(`Collaboration and version server listening on ${server.url}`);

const created = await server.versions.createRoomIfMissing(DOCUMENT_ID, new Uint8Array(await readFile(config.sourceDocx)));
if ((await server.versions.list(DOCUMENT_ID)).length === 0) {
  await server.versions.save(DOCUMENT_ID, { label: 'Original document', trigger: 'named', createdBy: 'Server' });
}
console.log(`Room "${DOCUMENT_ID}" ${created === 'created' ? 'created' : 'reopened'}. Data is stored in ${config.dataDirectory}.`);
console.log(`Checkpoint policy: ${JSON.stringify(config.checkpoints)}`);
console.warn('This example has no access checks. Run it on a private network only.');

const stop = async () => {
  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed:', error);
    process.exit(1);
  }
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
