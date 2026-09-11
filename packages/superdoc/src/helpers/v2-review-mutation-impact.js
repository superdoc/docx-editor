/**
 * Classify the tracked-change identities carried by a v2 mutation event.
 *
 * Receipt entities are the durable invalidation contract between the document
 * kernel and derived review UI. Direct receipts carry entity refs; mutation
 * plans carry the same identities through `trackedChanges` and per-step ids.
 */
export function getV2TrackedChangeMutationImpact(event) {
  if (event?.type !== 'mutation:committed') return null;
  const payload = event.origin === 'history' ? event.result : event.receipt;
  if (!payload || typeof payload !== 'object') return null;

  const upsertIds = new Set();
  const removedIds = new Set();
  /** @type {Array<{ from: string, to: string }>} */
  const remappedPairs = [];
  const collectEntity = (entry, into) => {
    if (entry?.kind !== 'entity' || entry.entityType !== 'trackedChange') return;
    if (typeof entry.entityId === 'string' && entry.entityId.length > 0) into.add(entry.entityId);
  };
  const readEntityId = (entry) => {
    if (entry?.kind !== 'entity' || entry.entityType !== 'trackedChange') return null;
    return typeof entry.entityId === 'string' && entry.entityId.length > 0 ? entry.entityId : null;
  };

  if (Array.isArray(payload.inserted)) payload.inserted.forEach((entry) => collectEntity(entry, upsertIds));
  if (Array.isArray(payload.updated)) payload.updated.forEach((entry) => collectEntity(entry, upsertIds));
  // Structural host receipts keep their block delta in the legacy top-level
  // `inserted`/`removed` slots for narrow projection invalidation. Preserve the
  // Document API's explicit tracked-change refs alongside that shape so review
  // rows can still reconcile narrowly instead of waiting for a full-list idle
  // refresh.
  if (Array.isArray(payload.trackedChangeRefs)) {
    payload.trackedChangeRefs.forEach((entry) => collectEntity(entry, upsertIds));
  }
  if (Array.isArray(payload.trackedChanges)) {
    payload.trackedChanges.forEach((entry) => collectEntity(entry, upsertIds));
  }
  if (Array.isArray(payload.steps)) {
    for (const step of payload.steps) {
      if (!Array.isArray(step?.trackedChangeIds)) continue;
      for (const id of step.trackedChangeIds) {
        if (typeof id === 'string' && id.length > 0) upsertIds.add(id);
      }
    }
  }
  if (Array.isArray(payload.removed)) payload.removed.forEach((entry) => collectEntity(entry, removedIds));
  if (Array.isArray(payload.invalidatedRefs)) {
    payload.invalidatedRefs.forEach((entry) => collectEntity(entry, removedIds));
  }
  if (Array.isArray(payload.remappedRefs)) {
    for (const mapping of payload.remappedRefs) {
      const fromId = readEntityId(mapping?.from);
      const toId = readEntityId(mapping?.to);
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
 *
 * AIDEV-NOTE: History commits put invalidated comment ids on `result`; cut and
 * other command receipts use `receipt`. Same origin split as
 * getV2TrackedChangeMutationImpact. Reading the wrong field, or treating a
 * tracked-change entity as a comment, leaves a sidebar card after cut or
 * undo/redo.
 */
export function collectV2InvalidatedCommentIds(event) {
  const removedIds = new Set();
  if (event?.type !== 'mutation:committed') return removedIds;
  const payload = event.origin === 'history' ? event.result : event.receipt;
  if (!Array.isArray(payload?.invalidatedRefs)) return removedIds;
  for (const ref of payload.invalidatedRefs) {
    if (ref?.kind === 'entity' && ref.entityType === 'comment' && typeof ref.entityId === 'string' && ref.entityId) {
      removedIds.add(ref.entityId);
    }
  }
  return removedIds;
}

export function applyV2CommentInvalidationFromMutation({ event, commentsStore, superdoc, documentId } = {}) {
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

function readAllResolvedFact(event, receipt) {
  const fact = event?.trackedChangeAllResolved;
  if (
    event?.origin === 'history' ||
    !fact ||
    fact.schemaVersion !== 1 ||
    fact.targetKind !== 'all' ||
    (fact.decision !== 'accept' && fact.decision !== 'reject') ||
    fact.remainingLogicalCount !== 0 ||
    typeof fact.catalogRevision !== 'string' ||
    !fact.catalogRevision ||
    typeof fact.sourceCoverageRevision !== 'string' ||
    !fact.sourceCoverageRevision ||
    !Number.isSafeInteger(fact.logicalTargetCount) ||
    fact.logicalTargetCount <= 0 ||
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
