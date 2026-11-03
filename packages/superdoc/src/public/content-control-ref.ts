import type { ContentControlType } from '@superdoc/document-api';

export interface ContentControlRef {
  id: string;
  tag?: string;
  alias?: string;
  controlType: ContentControlType;
  scope: 'inline' | 'block';
}

export interface ContentControlClickPayload {
  target: ContentControlRef;
  source: 'pointer';
}
