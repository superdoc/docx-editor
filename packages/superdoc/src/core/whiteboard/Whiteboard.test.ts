import { describe, it, expect, vi } from 'vite-plus/test';
import { Whiteboard } from './Whiteboard';

describe('Whiteboard', () => {
  it('register/getType returns stored items', () => {
    const wb = new Whiteboard();
    const stickers = [{ id: 'a', src: '/a.png' }];
    wb.register('stickers', stickers);
    expect(wb.getType('stickers')).toBe(stickers);
    expect(wb.getType('unknown')).toBeUndefined();
  });

  it('getWhiteboardData returns per-page JSON', () => {
    const wb = new Whiteboard();
    wb.setWhiteboardData({
      pages: {
        0: {
          strokes: [{ points: [[1, 2]] }],
          text: [{ id: 't1', x: 1, y: 2, content: 'hi' }],
          images: [{ id: 'i1', x: 1, y: 2, src: '/x.png' }],
        },
        1: {
          strokes: [
            {
              points: [
                [3, 4],
                [5, 6],
              ],
            },
          ],
          text: [{ id: 't2', x: 10, y: 20, content: 'bye' }],
          images: [{ id: 'i2', x: 2, y: 3, src: '/y.png', width: 50, height: 60 }],
        },
      },
    });

    const data = wb.getWhiteboardData();
    expect(data.pages['0'].strokes.length).toBe(1);
    expect(data.pages['0'].text.length).toBe(1);
    expect(data.pages['0'].images.length).toBe(1);
    expect(data.pages['1'].strokes.length).toBe(1);
    expect(data.pages['1'].text[0].content).toBe('bye');
    expect(data.pages['1'].images[0].width).toBe(50);
  });

  it('setWhiteboardData emits setData and change', () => {
    const wb = new Whiteboard();
    const onSetData = vi.fn();
    const onChange = vi.fn();
    wb.on('setData', onSetData);
    wb.on('change', onChange);

    wb.setWhiteboardData({
      pages: {
        1: {
          strokes: [],
          text: [],
          images: [],
        },
        2: {
          strokes: [{ points: [[7, 8]] }],
          text: [{ id: 't3', x: 5, y: 6, content: 'note' }],
          images: [],
        },
      },
    });

    expect(onSetData).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('setWhiteboardData clears previous pages', () => {
    const wb = new Whiteboard();
    wb.setWhiteboardData({ pages: { 0: { strokes: [], text: [], images: [] } } });
    wb.setWhiteboardData({ pages: { 1: { strokes: [], text: [], images: [] } } });
    const data = wb.getWhiteboardData();
    expect(data.pages['0']).toBeUndefined();
    expect(data.pages['1']).toBeDefined();
  });

  it('emits change when a page mutates', () => {
    const wb = new Whiteboard();
    const onChange = vi.fn();
    wb.on('change', onChange);

    wb.setWhiteboardData({ pages: { 0: { strokes: [], text: [], images: [] } } });
    const page = wb.getPage(0);
    page.addText({ x: 1, y: 2, content: 'hello' });

    expect(onChange).toHaveBeenCalled();
  });
});
