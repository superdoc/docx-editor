import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifiedClaim = { actorId: string; jti: string };
export type ClaimResult = { ok: true; claim: VerifiedClaim } | { ok: false; reason: string };

type ClaimPayload = { sub?: unknown; aud?: unknown; exp?: unknown; jti?: unknown; cid?: unknown };

const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function signatureMatches(signingInput: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const actual = Buffer.from(signature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createClaimVerifier(secret: string, documentId: string) {
  const clientByJti = new Map<string, number>();

  return function verify(actorId: string | null, claim: string | undefined, clientId: number): ClaimResult {
    if (!actorId || !claim) return { ok: false, reason: 'no-claim' };
    const parts = claim.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [header, body, signature] = parts;

    try {
      if ((decode(header) as { alg?: unknown }).alg !== 'HS256') return { ok: false, reason: 'algorithm' };
      if (!signatureMatches(`${header}.${body}`, signature, secret)) return { ok: false, reason: 'signature' };
      const payload = decode(body) as ClaimPayload;
      if (typeof payload.sub !== 'string' || payload.sub !== actorId) return { ok: false, reason: 'subject' };
      if (payload.aud !== documentId) return { ok: false, reason: 'audience' };
      if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return { ok: false, reason: 'expired' };
      if (typeof payload.jti !== 'string' || !payload.jti) return { ok: false, reason: 'jti' };
      if (payload.cid !== undefined && payload.cid !== clientId) return { ok: false, reason: 'client' };

      const firstClient = clientByJti.get(payload.jti);
      if (firstClient === undefined) clientByJti.set(payload.jti, clientId);
      else if (firstClient !== clientId) return { ok: false, reason: 'copied' };
      return { ok: true, claim: { actorId: payload.sub, jti: payload.jti } };
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  };
}
