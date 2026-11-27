import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test';
// Fresh isolated documents from the happy-dom test environment (see
// vitest.config.mjs) - the painter package deliberately has no jsdom
// dependency, so a direct `import "jsdom"` fails vite's transform here
// (persistent-page rendering preflight plan, workstream 8).
const createTestDocument = (): Document => document.implementation.createHTMLDocument('painter-test');

import { ensureRulerStyles, _resetRulerStylesInjection } from './ruler-styles.js';

describe('ensureRulerStyles', () => {
  let doc: Document;

  beforeEach(() => {
    // Reset the injection state before each test
    _resetRulerStylesInjection();

    // Create a fresh DOM for each test
    doc = createTestDocument();
  });

  afterEach(() => {
    // Clean up: reset injection state
    _resetRulerStylesInjection();
  });

  it('injects styles into the document head', () => {
    ensureRulerStyles(doc);

    const styleElement = doc.querySelector('style[data-superdoc-ruler-styles]');
    expect(styleElement).not.toBeNull();
  });

  it('injects styles only once when called multiple times', () => {
    ensureRulerStyles(doc);
    ensureRulerStyles(doc);
    ensureRulerStyles(doc);

    const styleElements = doc.querySelectorAll('style[data-superdoc-ruler-styles]');
    expect(styleElements.length).toBe(1);
  });

  it('adds data attribute to style element', () => {
    ensureRulerStyles(doc);

    const styleElement = doc.querySelector('style[data-superdoc-ruler-styles]');
    expect(styleElement?.getAttribute('data-superdoc-ruler-styles')).toBe('true');
  });

  it('injects the ruler stylesheet', async () => {
    ensureRulerStyles(doc);

    const styleElement = doc.querySelector('style[data-superdoc-ruler-styles]');
    await expect(styleElement?.textContent).toMatchFileSnapshot('__snapshots__/ruler-styles/stylesheet.txt');
  });

  it('appends style element to document head', () => {
    const initialHeadChildCount = doc.head.children.length;

    ensureRulerStyles(doc);

    expect(doc.head.children.length).toBe(initialHeadChildCount + 1);

    const lastChild = doc.head.lastElementChild;
    expect(lastChild?.tagName).toBe('STYLE');
    expect(lastChild?.getAttribute('data-superdoc-ruler-styles')).toBe('true');
  });

  it('does nothing when document is null', () => {
    // Should not throw
    expect(() => {
      ensureRulerStyles(null);
    }).not.toThrow();
  });

  it('does nothing when document is undefined', () => {
    // Should not throw
    expect(() => {
      ensureRulerStyles(undefined);
    }).not.toThrow();
  });

  it('handles document without head gracefully', () => {
    // Create a document without a head element
    const minimalDoc = createTestDocument();
    // ACTUALLY headless: the old jsdom HTML parser auto-inserted <head> here.
    minimalDoc.head.remove();

    // Should not throw even if head is missing
    expect(() => {
      ensureRulerStyles(minimalDoc);
    }).not.toThrow();
  });

  describe('multiple document instances', () => {
    it('injects styles separately for different documents', () => {
      const doc1 = createTestDocument();

      const doc2 = createTestDocument();

      ensureRulerStyles(doc1);

      // After injecting into doc1, doc2 should still be empty
      const styleInDoc2Before = doc2.querySelector('style[data-superdoc-ruler-styles]');
      expect(styleInDoc2Before).toBeNull();

      // Note: The current implementation uses a global flag, so this will not inject again
      // This test documents the current behavior
      ensureRulerStyles(doc2);

      // Due to global flag, it won't inject into doc2
      const styleInDoc2After = doc2.querySelector('style[data-superdoc-ruler-styles]');
      expect(styleInDoc2After).toBeNull();
    });
  });
});
