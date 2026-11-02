import type { PartialBrowserDocumentApi } from '../public/browser-document-api.js';
import type { SuperDoc } from '../public/index.js';

export interface DevSessionEditor {
  doc?: PartialBrowserDocumentApi | null;
  documentApiUnavailableReason?: string | null;
}

export const devSession: { superdoc: SuperDoc | null; editor: DevSessionEditor | null } = {
  superdoc: null,
  editor: null,
};

export function setDevSuperdoc(superdoc: SuperDoc | null): void {
  devSession.superdoc = superdoc;
  Reflect.set(window, 'superdoc', superdoc);
}

export function setDevEditor(editor: DevSessionEditor | null): void {
  devSession.editor = editor;
  Reflect.set(window, 'editor', editor);
}
