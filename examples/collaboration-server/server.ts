import { createExampleAuthorize, signExampleToken } from './src/auth/example-token.ts';
import { autosaveUrl, loadConfig, websocketUrl } from './src/config.ts';
import { createCollaborationServer } from './src/create-server.ts';
import { createDocxAutosave } from './src/docx/autosave.ts';
import { createFileDocxStore } from './src/storage/file-docx.ts';
import { createFileRoomStore } from './src/storage/file.ts';

const config = loadConfig();
const auth = config.auth;

const docxAutosave =
  config.docx.mode === 'off'
    ? null
    : createDocxAutosave({
        serverUrl: autosaveUrl(config),
        docxStore: createFileDocxStore(config.docx.directory),
        idleMs: config.docx.idleMs,
        token:
          auth.mode === 'none'
            ? undefined
            : () =>
                signExampleToken(auth.secret, {
                  sub: 'docx-autosave',
                  documents: '*',
                  exp: Math.floor(Date.now() / 1000) + 300,
                }),
      });

const server = createCollaborationServer({
  port: config.port,
  host: config.host,
  roomStore: createFileRoomStore(config.storageDirectory),
  authorize: auth.mode === 'none' ? null : createExampleAuthorize(auth.secret),
  docxAutosave,
});

await server.listen();
console.log(`Collaboration server listening on ${websocketUrl(config.host, config.port)}`);
console.log(`Rooms are stored in ${config.storageDirectory}`);
if (config.docx.mode === 'autosave') console.log(`DOCX files are saved to ${config.docx.directory}`);
if (auth.mode === 'none') console.warn('Access checks are off. Anyone who can reach this server can open any room.');

const stop = async () => {
  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    console.error('Collaboration server shutdown failed:', error);
    process.exit(1);
  }
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
