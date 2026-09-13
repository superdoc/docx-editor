import type { Config } from 'superdoc';

export const reportReviewDecisions: NonNullable<Config['onTrackedChangesBulkDecision']> = (result) => {
  const status = document.querySelector<HTMLOutputElement>('#review-status');
  if (!status) return;

  const action = result.decision === 'accept' ? 'Accepted' : 'Rejected';
  const remaining = result.permissionDeniedCount > 0 ? ` ${result.permissionDeniedCount} left undecided.` : '';
  status.value = `${action} ${result.successfulCount} changes.${remaining}`;
};
