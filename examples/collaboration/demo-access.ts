import type { Configuration, onAuthenticatePayload } from '@hocuspocus/server';

// Public fixtures for the local walkthrough, not production credentials.
const exampleProviderRoom = 'sd2/v2.1/example-room';
const sessions = new Map([
  ['demo-alex', { userId: 'alex', rooms: [exampleProviderRoom] }],
  ['demo-sam', { userId: 'sam', rooms: [exampleProviderRoom] }],
  ['demo-taylor', { userId: 'taylor', rooms: [] }],
]);

export async function authenticateRoom({ token, documentName }: Pick<onAuthenticatePayload, 'token' | 'documentName'>) {
  const session = sessions.get(token);
  if (!session || !session.rooms.includes(documentName)) {
    throw new Error('Access denied');
  }
  return { userId: session.userId };
}

export const demoAccess = { onAuthenticate: authenticateRoom } satisfies Pick<Configuration, 'onAuthenticate'>;
