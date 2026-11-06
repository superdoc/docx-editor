/** Validate and snapshot an explicitly asserted Word provider identity; never derive one from app metadata. */
export function snapshotWordIdentity(identity: unknown): { providerId: string; userId: string } | null | undefined {
  if (identity === undefined || identity === null) return identity;
  const validIdentifier = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].every((character) => {
      const code = character.codePointAt(0)!;
      // Attribute whitespace is normalized by XML readers. Reject it instead of changing opaque IDs.
      return code >= 0x20 && code !== 0x7f && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff;
    });
  const pair = identity as { providerId?: unknown; userId?: unknown };
  if (typeof identity !== 'object' || !validIdentifier(pair.providerId) || !validIdentifier(pair.userId)) {
    throw new TypeError(
      'Word identity requires non-empty XML-safe providerId and userId strings without control characters.',
    );
  }
  return { providerId: pair.providerId, userId: pair.userId };
}

/** Explicit ordinary author overrides suppress the active user's account unless authorIdentity is supplied. */
export function resolveCommentWordIdentity(
  options: Record<string, unknown> | undefined,
  user: { wordIdentity?: unknown },
) {
  if (options && Object.prototype.hasOwnProperty.call(options, 'authorIdentity')) {
    return snapshotWordIdentity(options.authorIdentity);
  }
  if (
    options &&
    ['author', 'authorId', 'authorEmail'].some((key) => Object.prototype.hasOwnProperty.call(options, key))
  ) {
    return undefined;
  }
  return snapshotWordIdentity(user.wordIdentity);
}
