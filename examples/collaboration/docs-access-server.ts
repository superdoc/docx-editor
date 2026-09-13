import { Server } from '@hocuspocus/server';
import { authenticateRoom } from './demo-access';

const deniedAttempts = new Map<string, number>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const server = Server.configure({
  address: '127.0.0.1',
  port: 1335,
  async onAuthenticate(payload) {
    if (!/^sd2\/v2\.1\/docs-access-[0-9a-f-]{36}$/.test(payload.documentName)) {
      throw new Error('Access denied');
    }
    // Each temporary docs room uses the same public Alex/Sam permission fixture.
    try {
      return await authenticateRoom({ token: payload.token, documentName: 'sd2/v2.1/example-room' });
    } catch (error) {
      const attempt = payload.requestParameters.get('attempt');
      for (const [id, expires] of deniedAttempts) {
        if (expires < Date.now() || deniedAttempts.size >= 256) deniedAttempts.delete(id);
      }
      if (attempt && uuid.test(attempt)) deniedAttempts.set(attempt, Date.now() + 60_000);
      throw error;
    }
  },
  async onRequest({ request, response }) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/access-result') return;
    const attempt = url.searchParams.get('attempt') ?? '';
    const expires = deniedAttempts.get(attempt) ?? 0;
    deniedAttempts.delete(attempt);
    // The pinned editor masks authentication errors; report only actual server rejections.
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    response.end(JSON.stringify({ denied: expires > Date.now() }));
    throw null;
  },
});

await server.listen();
const stop = async () => {
  await server.destroy();
  process.exit();
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
