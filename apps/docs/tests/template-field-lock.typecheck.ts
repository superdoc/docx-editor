import type { BrowserDocumentApi } from 'superdoc/ui';
import { setTemplateFieldLock } from '../snippets/editor/set-template-field-lock';

export function checkTemplateFieldLockModes(doc: BrowserDocumentApi) {
  void setTemplateFieldLock(doc, 'client.address', 'unlocked');
  void setTemplateFieldLock(doc, 'client.address', 'contentLocked');
  void setTemplateFieldLock(doc, 'client.address', 'sdtLocked');
  void setTemplateFieldLock(doc, 'client.address', 'sdtContentLocked');
  // @ts-expect-error Unsupported lock modes must remain a compile-time error.
  void setTemplateFieldLock(doc, 'client.address', 'invalid');
}
