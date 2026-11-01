export type TrackedChangeDecisionRow = {
  trackedChangeType?: unknown;
  trackedChangeDisplayType?: unknown;
  trackedChangeCanonicalId?: unknown;
  trackedChangeAnchorKey?: unknown;
};

export type TrackedChangeReceiptRef = {
  kind?: unknown;
  entityType?: unknown;
  entityId?: unknown;
};

export type TrackedChangeDecisionReceipt = {
  success?: unknown;
  txId?: unknown;
  removed?: unknown;
  invalidatedRefs?: unknown;
};

export type TrackedChangeDecisionOutcome = {
  decidedId?: unknown;
  decidedIds?: unknown;
  receipt?: TrackedChangeDecisionReceipt | null;
};

export type ActiveTrackedChangeTargetAdapter = {
  clearActiveTrackedChangeTargetIfMatches?: (decidedId: string) => unknown;
};

export type CanonicalPaintHost = {
  activeEditor?: {
    documentMutationReadiness?: {
      whenPainted?: (receipt: TrackedChangeDecisionReceipt) => unknown;
    } | null;
  } | null;
};

export const normalizeTrackedChangeDecisionType = (value: unknown): string | null => {
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  if (!lower) return null;
  if (
    lower === 'insert' ||
    lower === 'insertion' ||
    lower === 'trackinsert' ||
    lower === 'tableinsert' ||
    lower === 'paragraphsplit'
  ) {
    return 'insertion';
  }
  if (lower === 'delete' || lower === 'deletion' || lower === 'trackdelete' || lower === 'tabledelete') {
    return 'deletion';
  }
  return lower;
};

export const trackedChangeDecisionKeepsCommentAnchor = ({
  comment,
  decision,
}: { comment?: TrackedChangeDecisionRow | null; decision?: unknown } = {}): boolean => {
  const normalizedDecision = decision === 'accept' || decision === 'reject' ? decision : null;
  if (!normalizedDecision) return false;
  const type =
    normalizeTrackedChangeDecisionType(comment?.trackedChangeDisplayType) ??
    normalizeTrackedChangeDecisionType(comment?.trackedChangeType);
  return (
    (normalizedDecision === 'accept' && type === 'insertion') ||
    (normalizedDecision === 'reject' && type === 'deletion')
  );
};

export const collectTrackedChangeDecisionIdsWithAliases = (
  comment: TrackedChangeDecisionRow | null | undefined,
  aliasIds: Iterable<string>,
): Set<string> => {
  const trackedChangeIds = new Set(aliasIds);
  if (comment?.trackedChangeCanonicalId != null) {
    trackedChangeIds.add(String(comment.trackedChangeCanonicalId));
  }
  const anchorKey = comment?.trackedChangeAnchorKey != null ? String(comment.trackedChangeAnchorKey) : null;
  if (anchorKey) {
    trackedChangeIds.add(anchorKey);
    if (anchorKey.startsWith('tc::')) {
      const rawId = anchorKey.slice(anchorKey.lastIndexOf('::') + 2);
      if (rawId) trackedChangeIds.add(rawId);
    }
  }
  return trackedChangeIds;
};

export const collectTrackedChangeEntityIdsFromReceipt = (
  receipt: TrackedChangeDecisionReceipt | null | undefined,
): Set<string> => {
  const record = receipt && typeof receipt === 'object' ? receipt : null;
  if (!record?.success) return new Set();
  const ids = new Set<string>();
  const collect = (entry: TrackedChangeReceiptRef | null | undefined) => {
    const ref = entry && typeof entry === 'object' ? entry : null;
    if (ref?.kind !== 'entity' || ref.entityType !== 'trackedChange') return;
    if (ref.entityId != null && String(ref.entityId).length > 0) ids.add(String(ref.entityId));
  };
  if (Array.isArray(record.removed)) record.removed.forEach(collect);
  if (Array.isArray(record.invalidatedRefs)) record.invalidatedRefs.forEach(collect);
  return ids;
};

export const collectReliableDecidedTrackedChangeIds = (
  outcome: TrackedChangeDecisionOutcome | null | undefined,
): Set<string> => {
  const ids = new Set<string>();
  if (outcome?.decidedId != null && String(outcome.decidedId).length > 0) {
    ids.add(String(outcome.decidedId));
  }
  if (Array.isArray(outcome?.decidedIds)) {
    outcome.decidedIds.forEach((id) => {
      if (id != null && String(id).length > 0) ids.add(String(id));
    });
  }
  collectTrackedChangeEntityIdsFromReceipt(outcome?.receipt).forEach((id) => ids.add(id));
  return ids;
};

export const clearV2ActiveTrackedChangeTarget = (
  adapter: ActiveTrackedChangeTargetAdapter | null | undefined,
  decidedId: string | null | undefined,
): void => {
  if (!decidedId || typeof adapter?.clearActiveTrackedChangeTargetIfMatches !== 'function') return;
  try {
    adapter.clearActiveTrackedChangeTargetIfMatches(decidedId);
  } catch {}
};

export const waitForTrackedDecisionCanonicalPaint = async ({
  superdoc,
  receipt,
}: { superdoc?: CanonicalPaintHost | null; receipt?: TrackedChangeDecisionReceipt | null } = {}): Promise<void> => {
  const readiness = superdoc?.activeEditor?.documentMutationReadiness;
  if (
    receipt?.success !== true ||
    typeof receipt?.txId !== 'string' ||
    !receipt.txId ||
    typeof readiness?.whenPainted !== 'function'
  ) {
    return;
  }
  try {
    await readiness.whenPainted(receipt);
    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame === 'function') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallback);
          resolve();
        };
        const fallback = setTimeout(finish, 250);
        requestFrame(() => requestFrame(() => setTimeout(finish, 0)));
      });
    }
  } catch {}
};
