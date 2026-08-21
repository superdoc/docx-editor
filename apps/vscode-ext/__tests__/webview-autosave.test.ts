/**
 * Regression test for #3768.
 *
 * The webview autosave must export the document *silently*. SuperDoc's
 * `export()` defaults `triggerDownload: true`, which opens a browser
 * "Save File" dialog (via `showSaveFilePicker`). Because the debounced
 * autosave and the Cmd/Ctrl+S handler both call `saveDocument()`, the dialog
 * popped on essentially every edit. Passing `triggerDownload: false` makes
 * `export()` return the Blob directly — which is what the `postMessage` save
 * path consumes.
 *
 * Uses static analysis of the source (no webview/DOM runtime needed), matching
 * the approach in superdoc-contract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webviewSrc = readFileSync(resolve(import.meta.dirname, '..', 'webview', 'main.js'), 'utf-8');
const exportCall = webviewSrc.match(/editor\.export\(\s*\{[^}]*\}\s*\)/)?.[0] ?? null;

describe('webview autosave export (#3768)', () => {
  it('calls editor.export() in the save path', () => {
    expect(exportCall, 'expected an editor.export({ ... }) call in webview/main.js').not.toBeNull();
  });

  it('passes triggerDownload: false so autosave does not open a Save File dialog', () => {
    expect(exportCall ?? '').toMatch(/triggerDownload:\s*false/);
  });

  it('does not pass the unsupported `format` option', () => {
    // `format` is not a recognized export() option; the correct key is `exportType`.
    expect(exportCall ?? '').not.toMatch(/\bformat:/);
  });
});
