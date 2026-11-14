import { createSqliteRoomStore } from '../../src/storage/sqlite.ts';
import { createCollaborationServer } from '../../src/create-server.ts';

const filename = process.argv[2];
if (!filename) throw new Error('Expected a SQLite database path.');
const storage = await createSqliteRoomStore(filename);
const coordination = storage.coordination;
if (!coordination) throw new Error('Expected coordinated SQLite storage.');
let holdNextRead = false;
let releaseRead = () => {};
let releaseAuthentication = () => {};
const authenticationReleased = new Promise<void>(resolve => { releaseAuthentication = resolve; });
const roomStore = { ...storage, coordination: { ...coordination, async read(roomName: string) {
  const value = await coordination.read(roomName);
  if (holdNextRead) {
    holdNextRead = false;
    await new Promise<void>(resolve => { releaseRead = resolve; process.send?.({ type: 'read-held' }); });
  }
  return value;
} } };
const server = createCollaborationServer({ port: Number(process.argv[3] ?? 0), host: '127.0.0.1', roomStore, authorize: process.argv[4] === 'gated-auth' ? async ({ token }) => {
  if (token === 'held-auth') { process.send?.({ type: 'authentication-held' }); await authenticationReleased; }
  if (token === 'allowed') await new Promise(resolve => setTimeout(resolve, 10));
  return { userId: 'fixture-user' };
} : null, docxAutosave: null });
await server.listen();
process.send?.({ type: 'ready', url: server.webSocketURL, pid: process.pid });
process.on('message', async (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message) || !('id' in message)) return;
  try {
    if (message.type === 'delete' && 'room' in message && typeof message.room === 'string') await server.deleteRoom(message.room);
    if (message.type === 'fail-storage') storage.close();
    if (message.type === 'hold-read') holdNextRead = true;
    if (message.type === 'release-read') releaseRead();
    if (message.type === 'release-auth') releaseAuthentication();
    process.send?.({ id: message.id, done: true });
  } catch (error) { process.send?.({ id: message.id, error: String(error) }); }
});
process.on('SIGTERM', () => { void server.destroy().finally(() => process.exit(0)); });
