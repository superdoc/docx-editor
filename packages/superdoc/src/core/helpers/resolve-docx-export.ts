import { DocumentApiValidationError, resolveDocxExportPolicies } from '@superdoc/document-api';
import type { ExportParams } from '../../public/export-types.js';

export function resolveV2DocxExportOptions(
  options: Pick<ExportParams, 'policies' | 'isFinalDoc' | 'commentsType'> = {},
) {
  const policies = resolveDocxExportPolicies({ policies: options.policies });
  if (options.isFinalDoc !== undefined) {
    if (typeof options.isFinalDoc !== 'boolean')
      throw new DocumentApiValidationError('INVALID_INPUT', 'isFinalDoc must be a boolean.');
    const legacy = options.isFinalDoc ? 'final' : 'review-preserving';
    if (options.policies?.trackedChanges !== undefined && policies.trackedChanges !== legacy) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'isFinalDoc conflicts with policies.trackedChanges.');
    }
    policies.trackedChanges = legacy;
  }
  if (options.commentsType !== undefined) {
    if (options.commentsType !== 'external' && options.commentsType !== 'clean') {
      throw new DocumentApiValidationError('INVALID_INPUT', 'commentsType must be external or clean.');
    }
    const legacy = options.commentsType === 'clean' ? 'remove' : 'preserve';
    if (options.policies?.comments !== undefined && policies.comments !== legacy) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'commentsType conflicts with policies.comments.');
    }
    policies.comments = legacy;
  }
  return {
    mode: policies.trackedChanges,
    commentExportMode: policies.comments === 'remove' ? ('strip' as const) : policies.comments,
    contentControlExportMode: policies.contentControls,
  };
}
