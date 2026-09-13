import type {
  DiffApplyEligibility,
  DiffApplyEligibilityBlocker,
  DiffApplyEligibilityBlockerCode,
  DiffApplyModeEligibility,
  DiffPayload,
  DocumentApi,
} from 'superdoc';

declare const api: DocumentApi;
declare const targetSnapshot: ReturnType<DocumentApi['diff']['capture']>;

const diff: DiffPayload = api.diff.compare({ targetSnapshot });
const eligibility: DiffApplyEligibility | undefined = diff.applyEligibility;
const direct: DiffApplyModeEligibility | undefined = eligibility?.direct;
const blocker: DiffApplyEligibilityBlocker | undefined = direct?.blockers[0];
const code: DiffApplyEligibilityBlockerCode | undefined = blocker?.code;

void direct?.status;
void blocker?.message;
void blocker?.families;
void code;
