import { describe, expect, it } from 'vite-plus/test';
import { isActiveTrackedChangeContextMenuTarget, normalizeCommentsUiConfig } from './comment-small-screen.js';

describe('normalizeCommentsUiConfig', () => {
  it('keeps canonical layout and responsive options', () => {
    const target = document.createElement('div');

    expect(
      normalizeCommentsUiConfig({
        layout: 'auto',
        responsive: { target, breakpoint: 1200 },
      }),
    ).toEqual({
      layout: 'auto',
      responsive: { target, breakpoint: 1200 },
    });
  });

  it('maps deprecated responsive fields to the canonical shape', () => {
    expect(
      normalizeCommentsUiConfig({
        displayMode: 'inline',
        compactMeasurementSelector: '  #workspace  ',
        compactBreakpointPx: 960,
      }),
    ).toEqual({
      displayMode: 'inline',
      compactMeasurementSelector: '#workspace',
      compactBreakpointPx: 960,
      layout: 'inline',
      responsive: { target: '#workspace', breakpoint: 960 },
    });
  });

  it('gives canonical fields precedence over deprecated aliases', () => {
    expect(
      normalizeCommentsUiConfig({
        layout: 'sidebar',
        displayMode: 'inline',
        responsive: { target: '#canonical', breakpoint: 1200 },
        compactMeasurementSelector: '#deprecated',
        compactBreakpointPx: 960,
      }),
    ).toEqual({
      displayMode: 'inline',
      compactMeasurementSelector: '#deprecated',
      compactBreakpointPx: 960,
      layout: 'sidebar',
      responsive: { target: '#canonical', breakpoint: 1200 },
    });
  });

  it('drops invalid layout and responsive values', () => {
    expect(
      normalizeCommentsUiConfig({
        layout: 'floating',
        responsive: { target: '   ', breakpoint: -1 },
      }),
    ).toEqual({});
  });

  it('keeps unrelated legacy module fields intact', () => {
    expect(normalizeCommentsUiConfig({ permissionResolver: 'resolver', suppressInternalExternal: true })).toEqual({
      permissionResolver: 'resolver',
      suppressInternalExternal: true,
    });
  });
});

describe('isActiveTrackedChangeContextMenuTarget', () => {
  it('recognizes descendants of the already-focused tracked-change carrier', () => {
    const carrier = document.createElement('span');
    carrier.classList.add('track-change-focused');
    const child = document.createElement('strong');
    carrier.appendChild(child);

    expect(isActiveTrackedChangeContextMenuTarget(child)).toBe(true);
  });

  it('does not preserve inactive tracked changes or unrelated active review carriers', () => {
    const inactiveTrackedChange = document.createElement('span');
    inactiveTrackedChange.setAttribute('data-track-change-id', 'tc-1');
    const activeComment = document.createElement('span');
    activeComment.classList.add('sd-review-target-active');

    expect(isActiveTrackedChangeContextMenuTarget(inactiveTrackedChange)).toBe(false);
    expect(isActiveTrackedChangeContextMenuTarget(activeComment)).toBe(false);
    expect(isActiveTrackedChangeContextMenuTarget(null)).toBe(false);
  });
});
