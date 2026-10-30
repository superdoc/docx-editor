import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Authorize } from './types.ts';

export interface ExampleTokenClaims {
  sub: string;
  documents: string[] | '*';
  readOnly?: boolean;
  exp: number;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const signature = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signExampleToken(secret: string, claims: ExampleTokenClaims): string {
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${data}.${signature(secret, data)}`;
}

export function verifyExampleToken(secret: string, token: string, now = Date.now()): ExampleTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signed] = parts as [string, string, string];

  const expected = Buffer.from(signature(secret, `${header}.${body}`));
  const actual = Buffer.from(signed);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let claims: Partial<ExampleTokenClaims>;
  try {
    if ((decode(header) as { alg?: unknown })?.alg !== 'HS256') return null;
    claims = decode(body) as Partial<ExampleTokenClaims>;
  } catch {
    return null;
  }

  if (typeof claims?.sub !== 'string' || typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
  const documents = claims.documents;
  if (documents !== '*' && !(Array.isArray(documents) && documents.every((id) => typeof id === 'string'))) return null;
  return { sub: claims.sub, documents, readOnly: claims.readOnly === true, exp: claims.exp };
}

export function createExampleAuthorize(secret: string): Authorize {
  return ({ token, documentId }) => {
    const claims = verifyExampleToken(secret, token);
    if (!claims || documentId === null) return null;
    if (claims.documents !== '*' && !claims.documents.includes(documentId)) return null;
    return { userId: claims.sub, readOnly: claims.readOnly };
  };
}
