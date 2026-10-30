import { signExampleToken } from '../src/auth/example-token.ts';
import { createRoom, RoomExistsError } from '../src/create-room.ts';

const [documentId, docxPath] = process.argv.slice(2);
if (!documentId || !docxPath) {
  console.error('Usage: pnpm create-room <documentId> <path/to/document.docx>');
  process.exit(1);
}

const secret = process.env.COLLABORATION_AUTH_SECRET;
const token =
  process.env.COLLABORATION_TOKEN ??
  (secret
    ? signExampleToken(secret, { sub: 'room-creator', documents: [documentId], exp: Math.floor(Date.now() / 1000) + 300 })
    : undefined);

try {
  await createRoom({ serverUrl: process.env.COLLABORATION_URL ?? 'ws://127.0.0.1:1234', documentId, docxPath, token });
  console.log(`Created the room for ${documentId}. Editors can join it now.`);
  process.exit(0);
} catch (error) {
  if (error instanceof RoomExistsError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(`Could not create the room for ${documentId}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
