/**
 * SuperDoc API contract tests for the VS Code extension.
 *
 * Verifies that SuperDoc's source code still exports the public APIs
 * that the webview (webview/main.js) depends on. Uses static analysis
 * of the source to avoid importing the full SuperDoc dependency tree.
 *
 * If any of these fail after a SuperDoc update, the VS Code extension
 * would break in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPERDOC_PKG = resolve(import.meta.dirname, '..', '..', '..', 'packages', 'superdoc');
const SUPERDOC_SRC = resolve(SUPERDOC_PKG, 'src');
const superdocClassSrc = readFileSync(resolve(SUPERDOC_SRC, 'core', 'SuperDoc.ts'), 'utf-8');

describe('SuperDoc API contract', () => {
  describe('package exports', () => {
    it('exports SuperDoc class from main entry point', () => {
      const indexSrc = readFileSync(resolve(SUPERDOC_SRC, 'index.js'), 'utf-8');
      expect(indexSrc).toMatch(/export\s*\{[^}]*SuperDoc[^}]*\}/s);
    });

    it('exports style.css via package.json exports field', () => {
      const pkg = JSON.parse(readFileSync(resolve(SUPERDOC_PKG, 'package.json'), 'utf-8'));
      expect(pkg.exports['./style.css']).toBeDefined();
    });

    it('has style.css in dist', () => {
      // dist may not exist locally if build hasn't run — skip gracefully
      const cssPath = resolve(SUPERDOC_PKG, 'dist', 'style.css');
      if (!existsSync(cssPath)) {
        return; // dist not built locally — CI will catch this
      }
      const css = readFileSync(cssPath, 'utf-8');
      expect(css.length).toBeGreaterThan(0);
    });
  });

  describe('SuperDoc class methods', () => {
    it('extends EventEmitter (provides on/off/emit)', () => {
      expect(superdocClassSrc).toMatch(/class\s+SuperDoc\s+extends\s+EventEmitter/);
    });

    it('has export() method', () => {
      // webview/main.js: editor.export({ exportType: ['docx'], triggerDownload: false })
      expect(superdocClassSrc).toMatch(/async\s+export\s*\(/);
    });

    it('has destroy() method', () => {
      // webview/main.js: editor.destroy()
      expect(superdocClassSrc).toMatch(/destroy\s*\(\s*\)/);
    });

    it('has getHTML() method', () => {
      // webview/main.js: editorInstance.getHTML()
      // SuperDoc.getHTML delegates to editor.getHTML — both have it
      expect(superdocClassSrc).toMatch(/getHTML\s*\(options/);
    });

    it('has activeEditor property', () => {
      // webview/main.js: editor.activeEditor.on('update', ...)
      expect(superdocClassSrc).toMatch(/this\.activeEditor\s*=/);
    });
  });

  describe('constructor config', () => {
    it('accepts selector option', () => {
      // webview/main.js: new SuperDoc({ selector: '#superdoc', ... })
      expect(superdocClassSrc).toMatch(/config\.selector/);
    });

    it('accepts document option', () => {
      // webview/main.js: new SuperDoc({ document: file, ... })
      expect(superdocClassSrc).toMatch(/config\.document/);
    });

    it('accepts documentMode option', () => {
      // webview/main.js: new SuperDoc({ documentMode: 'editing', ... })
      expect(superdocClassSrc).toMatch(/config\.documentMode/);
    });

    it('accepts onReady callback', () => {
      // webview/main.js: new SuperDoc({ onReady: () => { ... }, ... })
      expect(superdocClassSrc).toMatch(/config\.onReady/);
    });

    it('accepts onException callback', () => {
      // webview/main.js: new SuperDoc({ onException: (error) => { ... }, ... })
      expect(superdocClassSrc).toMatch(/config\.onException/);
    });
  });
});
