import type { ContentControlClickPayload } from './types.js';
import { isPlainObject } from '../../helpers/object-guards.js';

export const HOST_EVENTS = [
  'document-replaced',
  'editorCreate',
  'active-editor-change',
  'document-mode-change',
  'formatting-marks-change',
  'zoomChange',
  'measurement-unit-change',
  'viewport-change',
  'fonts-changed',
] as const;

export function isContentControlClickPayload(value: unknown): value is ContentControlClickPayload {
  if (!isPlainObject(value) || value.source !== 'pointer' || !isPlainObject(value.target)) return false;
  const { id, controlType, scope } = value.target;
  return typeof id === 'string' && typeof controlType === 'string' && (scope === 'inline' || scope === 'block');
}
