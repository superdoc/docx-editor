import { v4 as uuidv4 } from 'uuid';

const ownerIds = new WeakMap<object, string>();

export function getSuperDocUiOwnerId(superdoc: unknown): string | null {
  if (!superdoc || typeof superdoc !== 'object') return null;
  let ownerId = ownerIds.get(superdoc);
  if (!ownerId) {
    ownerId = uuidv4();
    ownerIds.set(superdoc, ownerId);
  }
  return ownerId;
}
