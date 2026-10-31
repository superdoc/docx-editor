import { describe, it, expect } from 'vite-plus/test';
import useSelection from './use-selection.js';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from './selection-source.js';

describe('useSelection', () => {
  it('exposes ref-wrapped fields and initial values', () => {
    const s = useSelection({
      documentId: 'doc-1',
      page: 3,
      source: 'pdf',
      selectionBounds: { top: 10, left: 20 },
    });
    expect(s.documentId.value).toBe('doc-1');
    expect(s.page.value).toBe(3);
    expect(s.source.value).toBe('pdf');
    expect(s.selectionBounds).toEqual({ top: 10, left: 20 });
  });

  it('getContainerId combines documentId and page', () => {
    const s = useSelection({ documentId: 'doc-1', page: 2 });
    expect(s.getContainerId()).toBe('doc-1-page-2');
  });

  describe('getContainerLocation', () => {
    it('returns origin when no parent is provided', () => {
      const s = useSelection({ documentId: 'doc-1', page: 1 });
      expect(s.getContainerLocation(null)).toEqual({ top: 0, left: 0 });
    });

    it('returns offset of origin when container is not found in DOM', () => {
      const s = useSelection({ documentId: 'missing-doc', page: 1 });
      const parent = { getBoundingClientRect: () => ({ top: 50, left: 25 }) };
      // container not in DOM → uses { top: 0, left: 0 } baseline
      const result = s.getContainerLocation(parent);
      expect(result).toEqual({ top: -50, left: -25 });
    });

    it('returns offset from parent when container is in DOM', () => {
      const container = document.createElement('div');
      container.id = 'doc-1-page-1';
      container.getBoundingClientRect = () => ({ top: 100, left: 40 });
      document.body.appendChild(container);
      const s = useSelection({ documentId: 'doc-1', page: 1 });
      const parent = { getBoundingClientRect: () => ({ top: 30, left: 10 }) };
      expect(s.getContainerLocation(parent)).toEqual({ top: 70, left: 30 });
      container.remove();
    });
  });

  describe('getValues', () => {
    it('returns a raw snapshot of the selection state', () => {
      const s = useSelection({
        documentId: 'doc-1',
        page: 1,
        source: DOCUMENT_EDITOR_SELECTION_SOURCE,
        selectionBounds: { top: 5, left: 5 },
      });
      const values = s.getValues();
      expect(values).toEqual({
        documentId: 'doc-1',
        page: 1,
        source: DOCUMENT_EDITOR_SELECTION_SOURCE,
        selectionBounds: { top: 5, left: 5 },
      });
    });

    it('uses an empty object for selectionBounds when none is provided', () => {
      const s = useSelection({ documentId: 'doc-1', page: 1 });
      expect(s.getValues().selectionBounds).toEqual({});
    });
  });
});
