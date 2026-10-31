import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import {
  getPreferredCommentFocusTargetClientY,
  getVisibleThreadAnchorClientY,
  getVisibleThreadHighlightClientY,
  scrollThreadAnchorToFocusTarget,
} from './comment-focus.js';

describe('getPreferredCommentFocusTargetClientY', () => {
  it('returns 38% of window inner height, rounded', () => {
    const originalInner = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    expect(getPreferredCommentFocusTargetClientY()).toBe(380);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInner });
  });
});

describe('getVisibleThreadAnchorClientY', () => {
  it('returns null when positionEntry has no bounds', () => {
    const layers = { getBoundingClientRect: () => ({ top: 0 }) };
    expect(getVisibleThreadAnchorClientY(layers, null)).toBeNull();
    expect(getVisibleThreadAnchorClientY(layers, {})).toBeNull();
  });

  it('returns null when layersElement lacks getBoundingClientRect', () => {
    expect(getVisibleThreadAnchorClientY({}, { bounds: { top: 10 } })).toBeNull();
  });

  it('returns null when resulting position is off-screen (negative)', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    const layers = { getBoundingClientRect: () => ({ top: -50 }) };
    expect(getVisibleThreadAnchorClientY(layers, { bounds: { top: 10 } })).toBeNull();
  });

  it('returns null when resulting position is off-screen (below viewport)', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    const layers = { getBoundingClientRect: () => ({ top: 400 }) };
    expect(getVisibleThreadAnchorClientY(layers, { bounds: { top: 200 } })).toBeNull();
  });

  it('returns the anchor client Y when visible', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    const layers = { getBoundingClientRect: () => ({ top: 100 }) };
    expect(getVisibleThreadAnchorClientY(layers, { bounds: { top: 50 } })).toBe(150);
  });
});

describe('getVisibleThreadHighlightClientY', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it('returns null when threadIds is empty', () => {
    expect(getVisibleThreadHighlightClientY([])).toBeNull();
    expect(getVisibleThreadHighlightClientY(null)).toBeNull();
  });

  it('returns null when no highlight matches any id', () => {
    const el = document.createElement('div');
    el.className = 'superdoc-comment-highlight';
    el.setAttribute('data-comment-ids', 'a,b');
    document.body.appendChild(el);
    expect(getVisibleThreadHighlightClientY(['x'])).toBeNull();
  });

  it('returns top position of the first visible matching highlight', () => {
    const el = document.createElement('div');
    el.className = 'superdoc-comment-highlight';
    el.setAttribute('data-comment-ids', 'c-1,c-2');
    el.getBoundingClientRect = () => ({ top: 100, bottom: 120 });
    document.body.appendChild(el);
    expect(getVisibleThreadHighlightClientY(['c-2'])).toBe(100);
  });

  it('parses imported id map entries (key=value)', () => {
    const el = document.createElement('div');
    el.className = 'superdoc-comment-highlight';
    el.setAttribute('data-comment-imported-ids', 'orig=imp-1');
    el.getBoundingClientRect = () => ({ top: 50, bottom: 60 });
    document.body.appendChild(el);
    expect(getVisibleThreadHighlightClientY(['imp-1'])).toBe(50);
  });

  it('returns the minimum top among multiple visible matches', () => {
    const a = document.createElement('div');
    a.className = 'superdoc-comment-highlight';
    a.setAttribute('data-comment-ids', 'c-1');
    a.getBoundingClientRect = () => ({ top: 200, bottom: 220 });
    const b = document.createElement('div');
    b.className = 'superdoc-comment-highlight';
    b.setAttribute('data-comment-ids', 'c-1');
    b.getBoundingClientRect = () => ({ top: 100, bottom: 120 });
    document.body.append(a, b);
    expect(getVisibleThreadHighlightClientY(['c-1'])).toBe(100);
  });
});

describe('scrollThreadAnchorToFocusTarget', () => {
  const makePresentation = (reachable, resolved) => ({
    getReachableThreadAnchorClientY: vi.fn(() => reachable),
    scrollThreadAnchorToClientY: vi.fn(() => resolved),
  });

  it('returns null when presentation is missing or target is invalid', () => {
    expect(scrollThreadAnchorToFocusTarget(null, 'p', 'f', 100)).toBeNull();
    expect(scrollThreadAnchorToFocusTarget(makePresentation(1, true), 'p', 'f', NaN)).toBeNull();
  });

  it('scrolls primary thread when reachable and resolved', () => {
    const presentation = makePresentation(150, true);
    expect(scrollThreadAnchorToFocusTarget(presentation, 'thread-1', 'thread-2', 200)).toBe(150);
    expect(presentation.scrollThreadAnchorToClientY).toHaveBeenCalledWith('thread-1', 200, { behavior: 'auto' });
  });

  it('falls back to fallback thread when primary is not resolved', () => {
    const presentation = {
      getReachableThreadAnchorClientY: vi.fn(),
      scrollThreadAnchorToClientY: vi.fn(),
    };
    presentation.getReachableThreadAnchorClientY.mockReturnValueOnce(NaN).mockReturnValueOnce(75);
    presentation.scrollThreadAnchorToClientY.mockReturnValue(true);
    expect(scrollThreadAnchorToFocusTarget(presentation, 'p', 'f', 200)).toBe(75);
  });

  it('returns null when fallback matches primary and primary failed', () => {
    const presentation = makePresentation(NaN, false);
    expect(scrollThreadAnchorToFocusTarget(presentation, 'same', 'same', 200)).toBeNull();
  });
});
