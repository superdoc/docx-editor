export interface CompareApplyResult {
  readonly appliedOperations?: number;
  readonly diagnostics?: readonly string[];
}

export interface CompareApplyDebugSnapshot {
  readonly textLength: number | null;
  readonly hostFacadeTextLength: number | null;
  readonly projectionBlockCount: number | null;
  readonly projectionTableCount: number | null;
  readonly renderStage: string | null;
  readonly hostFacadeMatchesEditorDoc: boolean | null;
}

export interface CompareApplyDocApi {
  readonly diff: {
    apply(
      input: { diff: unknown },
      options: { changeMode: 'tracked' | 'direct' },
    ): CompareApplyResult | Promise<CompareApplyResult>;
  };
  getText?(input: Record<string, never>): string;
  readonly doc?: {
    getText?(input: Record<string, never>): string;
  } | null;
  readonly documentMutationReadiness?: {
    whenPainted?(input?: { txId?: string }): Promise<unknown> | unknown;
  } | null;
  readonly host?: {
    readMountedProjectionBlocks?(): Array<{ kind?: string }> | null;
    getRenderReadinessSnapshot?(): { renderStage?: string | null } | null;
    getDocumentFacade?():
      | {
          available: true;
          doc: {
            getText?(input: Record<string, never>): string;
          };
        }
      | {
          available: false;
        };
  } | null;
}

export interface CompareApplyOutcome {
  readonly applyResult: CompareApplyResult;
  readonly changeMode: 'tracked' | 'direct';
  readonly fallbackFromTracked: boolean;
  readonly fallbackReason: 'tracked-deferred' | 'table-topology' | null;
}

export class CompareApplyFallbackError extends Error {
  readonly changeMode = 'direct';

  constructor(
    readonly fallbackReason: Exclude<CompareApplyOutcome['fallbackReason'], null>,
    options: { cause: unknown },
  ) {
    const causeMessage = options.cause instanceof Error ? options.cause.message : String(options.cause);
    const context =
      fallbackReason === 'table-topology' ? 'tracked table row replay was unsafe' : 'tracked mode was deferred';
    super(`Direct compare apply failed after ${context}: ${causeMessage}`, options);
    this.name = 'CompareApplyFallbackError';
  }
}

export class CompareApplyIneligibleError extends Error {
  constructor(readonly blockers: readonly string[]) {
    super(`Compare apply is blocked: ${blockers.join('; ') || 'no complete apply lane is available'}`);
    this.name = 'CompareApplyIneligibleError';
  }
}

function applyEligibilityForMode(
  diff: unknown,
  mode: 'tracked' | 'direct',
): { status: 'candidate' | 'blocked'; blockers: readonly string[] } | null {
  if (!diff || typeof diff !== 'object' || !('applyEligibility' in diff)) return null;
  const eligibility = (diff as { applyEligibility?: unknown }).applyEligibility;
  if (!eligibility || typeof eligibility !== 'object' || !(mode in eligibility)) return null;
  const modeEligibility = (eligibility as Record<string, unknown>)[mode];
  if (!modeEligibility || typeof modeEligibility !== 'object') return null;
  const status = (modeEligibility as { status?: unknown }).status;
  const blockers = (modeEligibility as { blockers?: unknown }).blockers;
  if ((status !== 'candidate' && status !== 'blocked') || !Array.isArray(blockers)) return null;
  return {
    status,
    blockers: blockers.flatMap((blocker) =>
      blocker && typeof blocker === 'object' && typeof (blocker as { message?: unknown }).message === 'string'
        ? [(blocker as { message: string }).message]
        : [],
    ),
  };
}

function isRelationshipBackedTrackedCompareDeferred(error: unknown, diff: unknown): boolean {
  if (!error || typeof error !== 'object' || !diff || typeof diff !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    details?: { unsupportedReason?: unknown; changedFamilies?: unknown };
  };
  const payload = 'payload' in diff ? (diff as { payload?: unknown }).payload : null;
  const relationshipBackedBody =
    payload && typeof payload === 'object' && 'relationshipBackedBody' in payload
      ? (payload as { relationshipBackedBody?: unknown }).relationshipBackedBody
      : null;
  const target =
    relationshipBackedBody && typeof relationshipBackedBody === 'object' && 'target' in relationshipBackedBody
      ? (relationshipBackedBody as { target?: unknown }).target
      : null;
  const targetMedia =
    target && typeof target === 'object' && 'media' in target ? (target as { media?: unknown }).media : null;
  return (
    candidate.code === 'CAPABILITY_UNSUPPORTED' &&
    candidate.details?.unsupportedReason === 'family-apply-lane-unavailable' &&
    Array.isArray(candidate.details.changedFamilies) &&
    candidate.details.changedFamilies.includes('media') &&
    Array.isArray(targetMedia) &&
    targetMedia.length > 0
  );
}

export function compareApplyFallbackMessage(outcome: CompareApplyOutcome): string {
  if (outcome.fallbackReason === 'table-topology') {
    return 'Tracked compare apply could not safely replay the table topology, so SuperDoc Dev applied the diff in direct mode. ';
  }
  if (outcome.fallbackReason === 'tracked-deferred') {
    return 'Tracked compare apply was deferred, so SuperDoc Dev applied the diff in direct mode. ';
  }
  return '';
}

function hasDirectTableTopologyReplayPayload(diff: unknown): boolean {
  if (!diff || typeof diff !== 'object') return false;
  const payload = 'payload' in diff ? (diff as { payload?: unknown }).payload : null;
  if (!payload || typeof payload !== 'object') return false;
  const familyPolicy =
    'familyPolicy' in payload && Array.isArray((payload as { familyPolicy?: unknown }).familyPolicy)
      ? (
          payload as {
            familyPolicy: Array<{
              family?: unknown;
              disposition?: unknown;
              changed?: unknown;
              applyRequired?: unknown;
            }>;
          }
        ).familyPolicy
      : [];
  const tablesPolicy = familyPolicy.find((entry) => entry?.family === 'tables') ?? null;
  if (!tablesPolicy) return false;
  const mainDocument = 'mainDocument' in payload ? (payload as { mainDocument?: unknown }).mainDocument : null;
  const targetMainDocument =
    mainDocument && typeof mainDocument === 'object' ? (mainDocument as { target?: unknown }).target : null;
  const hasTargetMainDocumentXml = Boolean(
    targetMainDocument &&
    typeof targetMainDocument === 'object' &&
    typeof (targetMainDocument as { xml?: unknown }).xml === 'string',
  );
  return (
    tablesPolicy.changed === true &&
    tablesPolicy.applyRequired === true &&
    tablesPolicy.disposition === 'deferred' &&
    hasTargetMainDocumentXml
  );
}

function isTrackedTableRowReplayUnsafe(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    details?: { unsupportedReason?: unknown; changedFamilies?: unknown };
  };
  return (
    candidate.code === 'CAPABILITY_UNSUPPORTED' &&
    candidate.details?.unsupportedReason === 'tracked-table-row-replay-unsafe' &&
    Array.isArray(candidate.details.changedFamilies) &&
    candidate.details.changedFamilies.includes('tables')
  );
}

export async function applyCompareWithWs09Fallback(
  docApi: CompareApplyDocApi,
  diff: unknown,
): Promise<CompareApplyOutcome> {
  const trackedEligibility = applyEligibilityForMode(diff, 'tracked');
  if (trackedEligibility?.status === 'blocked') {
    const directEligibility = applyEligibilityForMode(diff, 'direct');
    if (directEligibility?.status === 'blocked') {
      throw new CompareApplyIneligibleError([...trackedEligibility.blockers, ...directEligibility.blockers]);
    }
    return {
      applyResult: await docApi.diff.apply({ diff }, { changeMode: 'direct' }),
      changeMode: 'direct',
      fallbackFromTracked: true,
      fallbackReason: 'tracked-deferred',
    };
  }
  try {
    return {
      applyResult: await docApi.diff.apply({ diff }, { changeMode: 'tracked' }),
      changeMode: 'tracked',
      fallbackFromTracked: false,
      fallbackReason: null,
    };
  } catch (error) {
    const fallbackReason =
      isTrackedTableRowReplayUnsafe(error) && hasDirectTableTopologyReplayPayload(diff)
        ? 'table-topology'
        : isRelationshipBackedTrackedCompareDeferred(error, diff)
          ? 'tracked-deferred'
          : null;
    if (!fallbackReason) throw error;
    try {
      return {
        applyResult: await docApi.diff.apply({ diff }, { changeMode: 'direct' }),
        changeMode: 'direct',
        fallbackFromTracked: true,
        fallbackReason,
      };
    } catch (directError) {
      throw new CompareApplyFallbackError(fallbackReason, { cause: directError });
    }
  }
}

export async function settleCompareApplyPaint(docApi: CompareApplyDocApi): Promise<void> {
  const readiness = docApi.documentMutationReadiness;
  const whenPainted = readiness?.whenPainted;
  if (typeof whenPainted !== 'function') return;
  await whenPainted.call(readiness);
}

export function captureCompareApplyDebugSnapshot(docApi: CompareApplyDocApi): CompareApplyDebugSnapshot {
  let textLength: number | null = null;
  try {
    const directTextReader = docApi.getText ?? docApi.doc?.getText;
    const text = directTextReader?.({});
    if (typeof text === 'string') textLength = text.length;
  } catch {
    textLength = null;
  }

  let hostFacadeTextLength: number | null = null;
  let hostFacadeMatchesEditorDoc: boolean | null = null;
  try {
    const facade = docApi.host?.getDocumentFacade?.();
    if (facade?.available === true) {
      const hostText = facade.doc.getText?.({});
      if (typeof hostText === 'string') hostFacadeTextLength = hostText.length;
      const editorDoc = docApi.doc ?? null;
      hostFacadeMatchesEditorDoc = editorDoc ? facade.doc === editorDoc : null;
    }
  } catch {
    hostFacadeTextLength = null;
    hostFacadeMatchesEditorDoc = null;
  }

  let projectionBlockCount: number | null = null;
  let projectionTableCount: number | null = null;
  try {
    const blocks = docApi.host?.readMountedProjectionBlocks?.() ?? null;
    if (Array.isArray(blocks)) {
      projectionBlockCount = blocks.length;
      projectionTableCount = blocks.filter((block) => block?.kind === 'table').length;
    }
  } catch {
    projectionBlockCount = null;
    projectionTableCount = null;
  }

  let renderStage: string | null = null;
  try {
    const snapshot = docApi.host?.getRenderReadinessSnapshot?.() ?? null;
    renderStage = typeof snapshot?.renderStage === 'string' ? snapshot.renderStage : null;
  } catch {
    renderStage = null;
  }

  return {
    textLength,
    hostFacadeTextLength,
    projectionBlockCount,
    projectionTableCount,
    renderStage,
    hostFacadeMatchesEditorDoc,
  };
}
