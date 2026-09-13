export const ROOM_LIFETIME_MS = 15 * 60 * 1000;
export const ROOM_PATH = /^\/rooms\/sd2\/v2\.1\/(docs-([0-9]+)-[0-9a-f-]{36})$/;

interface DemoRoom {
  documentId: string;
  token: string;
  expiresAt: number;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function issueRoom(secret: string, now = Date.now()): Promise<DemoRoom> {
  const expiresAt = now + ROOM_LIFETIME_MS;
  const documentId = `docs-${expiresAt}-${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(documentId));
  const token = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { documentId, token, expiresAt };
}

export async function authorizeRoom(url: URL, secret: string, now = Date.now()): Promise<string | null> {
  const match = ROOM_PATH.exec(url.pathname);
  const token = url.searchParams.get('token') ?? '';
  if (!match || !/^[0-9a-f]{64}$/.test(token)) return null;
  const documentId = match[1]!;
  const expiresAt = Number(match[2]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + ROOM_LIFETIME_MS) return null;
  const signature = Uint8Array.from(token.match(/../g)!, (byte) => parseInt(byte, 16));
  return (await crypto.subtle.verify('HMAC', await signingKey(secret), signature, new TextEncoder().encode(documentId)))
    ? documentId
    : null;
}
