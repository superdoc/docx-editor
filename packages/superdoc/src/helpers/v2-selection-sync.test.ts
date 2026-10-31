import { describe, it, expect } from 'vite-plus/test';
import {
  hasOutsideV2DomRangeSelection,
  isV2RangeSnapshot,
  shouldPreserveHostV2Selection,
  shouldRetainV2FloatingSelection,
} from './v2-selection-sync.js';

const rangeSnapshot = {
  anchor: { blockId: 'p-1', blockOffset: 0 },
  focus: { blockId: 'p-1', blockOffset: 12 },
};

const crossBlockSnapshot = {
  anchor: { blockId: 'p-1', blockOffset: 0 },
  focus: { blockId: 'p-2', blockOffset: 3 },
};

const collapsedSnapshot = {
  anchor: { blockId: 'p-1', blockOffset: 4 },
  focus: { blockId: 'p-1', blockOffset: 4 },
};

describe('isV2RangeSnapshot', () => {
  it('treats differing block offsets within a block as a range', () => {
    expect(isV2RangeSnapshot(rangeSnapshot)).toBe(true);
  });

  it('treats differing blocks as a range', () => {
    expect(isV2RangeSnapshot(crossBlockSnapshot)).toBe(true);
  });

  it('treats a collapsed caret as not a range', () => {
    expect(isV2RangeSnapshot(collapsedSnapshot)).toBe(false);
  });

  it('rejects missing or partial snapshots', () => {
    expect(isV2RangeSnapshot(null)).toBe(false);
    expect(isV2RangeSnapshot(undefined)).toBe(false);
    expect(isV2RangeSnapshot({ anchor: { blockId: 'p-1', blockOffset: 0 } })).toBe(false);
  });
});

describe('hasOutsideV2DomRangeSelection', () => {
  it('detects a non-collapsed DOM range whose endpoints are outside the v2 root', () => {
    const root = document.createElement('div');
    const outside = document.createElement('div');
    const startContainer = document.createTextNode('outside start');
    const endContainer = document.createTextNode('outside end');
    outside.append(startContainer, endContainer);

    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ startContainer, endContainer }),
    };

    expect(hasOutsideV2DomRangeSelection(selection, root)).toBe(true);
  });

  it('keeps a non-collapsed DOM range with an endpoint inside the v2 root eligible for host preservation', () => {
    const root = document.createElement('div');
    const startContainer = document.createTextNode('inside start');
    const endContainer = document.createTextNode('outside end');
    root.append(startContainer);

    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ startContainer, endContainer }),
    };

    expect(hasOutsideV2DomRangeSelection(selection, root)).toBe(false);
  });

  it('does not treat absent or collapsed native ranges as outside selections', () => {
    expect(hasOutsideV2DomRangeSelection(null, document.createElement('div'))).toBe(false);
    expect(hasOutsideV2DomRangeSelection({ rangeCount: 0, isCollapsed: false }, document.createElement('div'))).toBe(
      false,
    );
    expect(hasOutsideV2DomRangeSelection({ rangeCount: 1, isCollapsed: true }, document.createElement('div'))).toBe(
      false,
    );
  });
});

describe('shouldPreserveHostV2Selection', () => {
  it('preserves the host range in editable modes', () => {
    expect(shouldPreserveHostV2Selection('editing', rangeSnapshot)).toBe(true);
    expect(shouldPreserveHostV2Selection('suggesting', crossBlockSnapshot)).toBe(true);
  });

  it('does not preserve in viewing mode, so native DOM selection stays authoritative', () => {
    expect(shouldPreserveHostV2Selection('viewing', rangeSnapshot)).toBe(false);
  });

  it('does not preserve for missing or unknown document modes', () => {
    expect(shouldPreserveHostV2Selection(null, rangeSnapshot)).toBe(false);
    expect(shouldPreserveHostV2Selection(undefined, rangeSnapshot)).toBe(false);
    expect(shouldPreserveHostV2Selection('unknown', rangeSnapshot)).toBe(false);
  });

  it('does not preserve when the host holds only a collapsed caret', () => {
    expect(shouldPreserveHostV2Selection('editing', collapsedSnapshot)).toBe(false);
    expect(shouldPreserveHostV2Selection('editing', null)).toBe(false);
  });
});

describe('shouldRetainV2FloatingSelection', () => {
  it('keeps an existing document-editor affordance while a host range survives a repaint', () => {
    expect(shouldRetainV2FloatingSelection(true, { source: 'document-editor' })).toBe(true);
  });

  it('releases the affordance once the host range ends or it belongs to another surface', () => {
    expect(shouldRetainV2FloatingSelection(false, { source: 'document-editor' })).toBe(false);
    expect(shouldRetainV2FloatingSelection(true, { source: 'pdf' })).toBe(false);
    expect(shouldRetainV2FloatingSelection(true, null)).toBe(false);
  });
});
