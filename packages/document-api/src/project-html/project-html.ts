import { DocumentApiValidationError } from '../errors.js';
import { validateOptionalBoolean, validateProjectionReadInput } from '../content-projection/validation.js';
import type { ProjectHtmlInput, SDContentProjectionResult } from '../types/content-projection.js';

const PROJECT_HTML_FIELDS = new Set(['in', 'reviewMode', 'scope', 'styling', 'includeSourceMap']);

export interface ProjectHtmlAdapter {
  projectHtml(input: ProjectHtmlInput): Promise<SDContentProjectionResult<'html'>>;
}

export function executeProjectHtml(
  adapter: ProjectHtmlAdapter | undefined,
  input: ProjectHtmlInput,
): Promise<SDContentProjectionResult<'html'>> {
  validateProjectionReadInput(input, 'projectHtml', PROJECT_HTML_FIELDS);
  if (input.styling !== undefined && input.styling !== 'inline')
    throw new DocumentApiValidationError('INVALID_INPUT', 'styling must be inline.', { operation: 'projectHtml' });
  validateOptionalBoolean(input.includeSourceMap, 'includeSourceMap', 'projectHtml');
  if (!adapter) {
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      'projectHtml is not available. The host engine has not provided an adapter for this capability.',
      { operation: 'projectHtml' },
    );
  }
  return adapter.projectHtml(input);
}
