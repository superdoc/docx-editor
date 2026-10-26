import type { SuperDoc } from '../core/types/index.js';
import { isPlainObject } from './object-guards.js';

type V2TrackedChangeMutationImpact = {
  upsertIds: Set<string>;
  removedIds: Set<string>;
  remappedPairs: Array<{ from: string; to: string }>;
  reconcileMode: 'targeted';
  allResolved?: Record<string, unknown>;
};

type CommentInvalidationResult = {
  ok: boolean;
  removedIds: string[];
};

type CommentInvalidationStore = {
  dropCommentsFromMutationImpact?: (input: {
    superdoc: SuperDoc | null | undefined;
    documentId: string | null | undefined;
    removedIds: Set<string>;
  }) => CommentInvalidationResult | null | undefined;
};

type CommentInvalidationInput = {
  event?: unknown;
  commentsStore?: CommentInvalidationStore | null;
  superdoc?: SuperDoc | null;
  documentId?: string | null;
};

/**
 * Classify the tracked-change identities carried by a v2 mutation event.
 *
 * Receipt entities are the durable invalidation contract between the document
 * kernel and derived review UI. Direct receipts carry entity refs; mutation
 * plans carry the same identities through `trackedChanges` and per-step ids.
 */
export function getV2TrackedChangeMutationImpact(event: unknown): V2TrackedChangeMutationImpact | null {
  if (!isPlainObject(event) || event.type !== 'mutation:committed') return null;
  const payload = event.origin === 'history' ? event.result : event.receipt;
  if (!isPlainObject(payload)) return null;

  const upsertIds = new Set<string>();
  const removedIds = new Set<string>();
  const remappedPairs: Array<{ from: string; to: string }> = [];
  const collectEntity = (entry: unknown, into: Set<string>): void => {
    if (!isPlainObject(entry) || entry.kind !== 'entity' || entry.entityType !== 'trackedChange') return;
    if (typeof entry.entityId === 'string' && entry.entityId.length > 0) into.add(entry.entityId);
  };
  const readEntityId = (entry: unknown): string | null => {
    if (!isPlainObject(entry) || entry.kind !== 'entity' || entry.entityType !== 'trackedChange') return null;
    return typeof entry.entityId === 'string' && entry.entityId.length > 0 ? entry.entityId : null;
  };

  if (Array.isArray(payload.inserted)) payload.inserted.forEach((entry: unknown) => collectEntity(entry, upsertIds));
  if (Array.isArray(payload.updated)) payload.updated.forEach((entry: unknown) => collectEntity(entry, upsertIds));
  // Structural host receipts keep their block delta in the legacy top-level
  // `inserted`/`removed` slots for narrow projection invalidation. Preserve the
  // Document API's explicit tracked-change refs alongside that shape so review
  // rows can still reconcile narrowly instead of waiting for a full-list idle
  // refresh.
  if (Array.isArray(payload.trackedChangeRefs)) {
    payload.trackedChangeRefs.forEach((entry: unknown) => collectEntity(entry, upsertIds));
  }
  if (Array.isArray(payload.trackedChanges)) {
    payload.trackedChanges.forEach((entry: unknown) => collectEntity(entry, upsertIds));
  }
  if (Array.isArray(payload.steps)) {
    for (const step of payload.steps) {
      if (!isPlainObject(step) || !Array.isArray(step.trackedChangeIds)) continue;
      for (const id of step.trackedChangeIds) {
        if (typeof id === 'string' && id.length > 0) upsertIds.add(id);
      }
    }
  }
  if (Array.isArray(payload.removed)) payload.removed.forEach((entry: unknown) => collectEntity(entry, removedIds));
  if (Array.isArray(payload.invalidatedRefs)) {
    payload.invalidatedRefs.forEach((entry: unknown) => collectEntity(entry, removedIds));
  }
  if (Array.isArray(payload.remappedRefs)) {
    for (const mapping of payload.remappedRefs) {
      if (!isPlainObject(mapping)) continue;
      const fromId = readEntityId(mapping.from);
      const toId = readEntityId(mapping.to);
      if (fromId) removedIds.add(fromId);
      if (toId) upsertIds.add(toId);
      if (fromId && toId && fromId !== toId) {
        remappedPairs.push({ from: fromId, to: toId });
      }
    }
  }

  for (const id of removedIds) upsertIds.delete(id);
  const allResolved = readAllResolvedFact(event, payload);
  if (upsertIds.size === 0 && removedIds.size === 0 && !allResolved) return null;
  return {
    upsertIds,
    removedIds,
    remappedPairs,
    reconcileMode: 'targeted',
    ...(allResolved ? { allResolved } : {}),
  };
}

/**
 * Comment ids retired by a committed v2 mutation.
 */
export function collectV2InvalidatedCommentIds(event: unknown): Set<string> {
  const removedIds = new Set<string>();
  if (!isPlainObject(event) || event.type !== 'mutation:committed') return removedIds;
  const payload = event.origin === 'history' ? event.result : event.receipt;
  if (!isPlainObject(payload) || !Array.isArray(payload.invalidatedRefs)) return removedIds;
  for (const ref of payload.invalidatedRefs) {
    if (
      isPlainObject(ref) &&
      ref.kind === 'entity' &&
      ref.entityType === 'comment' &&
      typeof ref.entityId === 'string' &&
      ref.entityId
    ) {
      removedIds.add(ref.entityId);
    }
  }
  return removedIds;
}

export function applyV2CommentInvalidationFromMutation({
  event,
  commentsStore,
  superdoc,
  documentId,
}: CommentInvalidationInput = {}): CommentInvalidationResult {
  const removedIds = collectV2InvalidatedCommentIds(event);
  if (removedIds.size === 0) return { ok: true, removedIds: [] };
  return (
    commentsStore?.dropCommentsFromMutationImpact?.({
      superdoc,
      documentId,
      removedIds,
    }) ?? { ok: true, removedIds: [] }
  );
}

function readAllResolvedFact(
  event: Record<string, unknown>,
  receipt: Record<string, unknown>,
): Record<string, unknown> | null {
  const fact = event.trackedChangeAllResolved;
  if (
    event.origin === 'history' ||
    !isPlainObject(fact) ||
    fact.schemaVersion !== 1 ||
    fact.targetKind !== 'all' ||
    (fact.decision !== 'accept' && fact.decision !== 'reject') ||
    fact.remainingLogicalCount !== 0 ||
    typeof fact.catalogRevision !== 'string' ||
    !fact.catalogRevision ||
    typeof fact.sourceCoverageRevision !== 'string' ||
    !fact.sourceCoverageRevision ||
    typeof fact.logicalTargetCount !== 'number' ||
    !Number.isSafeInteger(fact.logicalTargetCount) ||
    fact.logicalTargetCount <= 0 ||
    typeof fact.physicalCarrierCount !== 'number' ||
    !Number.isSafeInteger(fact.physicalCarrierCount) ||
    fact.physicalCarrierCount < fact.logicalTargetCount ||
    typeof fact.txId !== 'string' ||
    fact.txId !== receipt.txId ||
    typeof fact.documentEpoch !== 'string' ||
    !Number.isSafeInteger(fact.commitSequence) ||
    typeof fact.packagePreviousRevision !== 'string' ||
    typeof fact.packageNextRevision !== 'string' ||
    fact.packagePreviousRevision === fact.packageNextRevision
  )
    return null;
  return fact;
}
