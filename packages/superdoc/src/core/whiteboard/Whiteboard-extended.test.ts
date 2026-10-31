import { describe, it, expect, vi } from 'vite-plus/test';
import { Whiteboard } from './Whiteboard.js';

describe('Whiteboard extended', () => {
  describe('tool and enabled state', () => {
    it('setTool updates the current tool and emits', () => {
      const wb = new Whiteboard();
      const spy = vi.fn();
      wb.on('tool', spy);
      wb.setTool('draw');
      expect(wb.getTool()).toBe('draw');
      expect(spy).toHaveBeenCalledWith('draw');
    });

    it('setTool propagates to existing pages', () => {
      const wb = new Whiteboard();
      wb.setPageSize(0, { width: 100, height: 100 });
      wb.setPageSize(1, { width: 100, height: 100 });
      wb.setTool('erase');
      expect(wb.getPage(0).getTool()).toBe('erase');
      expect(wb.getPage(1).getTool()).toBe('erase');
    });

    it('setEnabled updates state and emits', () => {
      const onEnabledChange = vi.fn();
      const wb = new Whiteboard({ onEnabledChange });
      const spy = vi.fn();
      wb.on('enabled', spy);
      wb.setEnabled(true);
      expect(wb.isEnabled()).toBe(true);
      expect(spy).toHaveBeenCalledWith(true);
      expect(onEnabledChange).toHaveBeenCalledWith(true);
    });

    it('setEnabled propagates to existing pages', () => {
      const wb = new Whiteboard();
      wb.setPageSize(0, { width: 100, height: 100 });
      wb.setEnabled(true);
      expect(wb.getPage(0).isEnabled()).toBe(true);
      wb.setEnabled(false);
      expect(wb.getPage(0).isEnabled()).toBe(false);
    });
  });

  describe('opacity', () => {
    it('clamps to [0, 1]', () => {
      const wb = new Whiteboard();
      wb.setOpacity(0.5);
      expect(wb.getOpacity()).toBe(0.5);
      wb.setOpacity(2);
      expect(wb.getOpacity()).toBe(1);
      wb.setOpacity(-1);
      expect(wb.getOpacity()).toBe(0);
    });

    it('falls back to 1 for non-finite values', () => {
      const wb = new Whiteboard();
      wb.setOpacity(NaN);
      expect(wb.getOpacity()).toBe(1);
    });

    it('emits opacity events', () => {
      const wb = new Whiteboard();
      const spy = vi.fn();
      wb.on('opacity', spy);
      wb.setOpacity(0.25);
      expect(spy).toHaveBeenCalledWith(0.25);
    });
  });

  describe('pages', () => {
    it('getPages returns an empty array initially', () => {
      const wb = new Whiteboard();
      expect(wb.getPages()).toEqual([]);
    });

    it('setPageSize creates a page lazily', () => {
      const wb = new Whiteboard();
      wb.setPageSize(3, { width: 100, height: 100 });
      expect(wb.getPage(3)).toBeDefined();
      expect(wb.getPages()).toHaveLength(1);
    });

    it('setPageSize reuses existing page', () => {
      const wb = new Whiteboard();
      wb.setPageSize(0, { width: 100, height: 100 });
      const first = wb.getPage(0);
      wb.setPageSize(0, { width: 200, height: 200 });
      const second = wb.getPage(0);
      expect(first).toBe(second);
    });

    it('rerender calls render on each page', () => {
      const wb = new Whiteboard();
      wb.setPageSize(0, { width: 100, height: 100 });
      wb.setPageSize(1, { width: 100, height: 100 });
      expect(() => wb.rerender()).not.toThrow();
    });
  });

  describe('register / getType', () => {
    it('register stores and getType returns items', () => {
      const wb = new Whiteboard();
      wb.register('stickers', [{ id: 'a' }]);
      expect(wb.getType('stickers')).toEqual([{ id: 'a' }]);
    });
  });

  describe('callbacks', () => {
    it('onChange callback fires when setWhiteboardData is called', () => {
      const onChange = vi.fn();
      const wb = new Whiteboard({ onChange });
      wb.setWhiteboardData({ pages: {} });
      expect(onChange).toHaveBeenCalled();
    });

    it('onSetData callback fires with page list', () => {
      const onSetData = vi.fn();
      const wb = new Whiteboard({ onSetData });
      wb.setWhiteboardData({
        pages: { 0: { strokes: [], text: [], images: [] } },
      });
      expect(onSetData).toHaveBeenCalled();
      const pagesArg = onSetData.mock.calls[0][0];
      expect(pagesArg).toHaveLength(1);
    });

    it('handles missing pages gracefully in setWhiteboardData', () => {
      const wb = new Whiteboard();
      expect(() => wb.setWhiteboardData()).not.toThrow();
      expect(() => wb.setWhiteboardData({})).not.toThrow();
      expect(wb.getPages()).toHaveLength(0);
    });
  });

  describe('getWhiteboardData', () => {
    it('includes meta.pageSizes with original dims when known', () => {
      const wb = new Whiteboard();
      wb.setPageSize(0, { width: 200, height: 300, originalWidth: 100, originalHeight: 150 });
      const data = wb.getWhiteboardData();
      expect(data.meta.pageSizes['0']).toEqual({
        width: 200,
        height: 300,
        originalWidth: 100,
        originalHeight: 150,
      });
      expect(data.version).toBe(1);
    });
  });
});
