import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { normalizeTrackChangesConfig, __resetDeprecationWarnings } from './normalize-track-changes-config.js';

describe('normalizeTrackChangesConfig', () => {
  let warnSpy;

  beforeEach(() => {
    __resetDeprecationWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('defaults (no user config)', () => {
    it('fills in safe defaults when nothing is provided', () => {
      const config = {};
      const result = normalizeTrackChangesConfig(config);

      expect(result).toEqual({ visible: false, mode: 'review', enabled: true, replacements: 'paired' });
      expect(config.modules.trackChanges).toEqual(result);
      expect(config.trackChanges).toEqual({ visible: false, enabled: true, replacementMode: 'grouped' });
      expect(config.layoutEngineOptions.trackedChanges).toEqual({ mode: 'review', enabled: true });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('defaults mode to "original" in viewing mode when visibility is off', () => {
      const config = { documentMode: 'viewing' };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('original');
      expect(result.visible).toBe(false);
    });

    it('defaults mode to "review" in viewing mode when visibility is on', () => {
      const config = {
        documentMode: 'viewing',
        modules: { trackChanges: { visible: true } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('review');
      expect(result.visible).toBe(true);
    });
  });

  describe('viewing options', () => {
    it('prefers the viewer outcome over legacy visibility and render settings', () => {
      const config = {
        documentMode: 'viewing',
        viewing: { trackedChanges: 'final' },
        modules: { trackChanges: { visible: true, mode: 'review' } },
      };

      const result = normalizeTrackChangesConfig(config);

      expect(result).toMatchObject({ visible: false, mode: 'final', enabled: true });
      expect(config.trackChanges).toEqual({ visible: false, enabled: true, replacementMode: 'grouped' });
      expect(config.layoutEngineOptions.trackedChanges).toEqual({ mode: 'final', enabled: true });
    });

    it.each([
      ['original', 'original', false],
      ['markup', 'review', true],
      ['final', 'final', false],
    ])('maps viewing.trackedChanges=%s to the internal renderer', (viewingMode, renderMode, visible) => {
      const config = { documentMode: 'viewing', viewing: { trackedChanges: viewingMode } };

      const result = normalizeTrackChangesConfig(config);

      expect(result).toMatchObject({ visible, mode: renderMode, enabled: true });
    });
  });

  describe('deprecated track-changes module options', () => {
    it('keeps module options working and points to their top-level replacements', () => {
      const config = {
        modules: {
          trackChanges: { visible: true, mode: 'original', enabled: false },
        },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result).toEqual({ visible: true, mode: 'original', enabled: false, replacements: 'paired' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('config.modules.trackChanges');
      expect(warnSpy.mock.calls[0][0]).toContain('config.trackChanges for behavior');
    });

    it('preserves the normalized values on the internal module path', () => {
      const config = {
        modules: { trackChanges: { visible: true } },
      };
      normalizeTrackChangesConfig(config);

      expect(config.modules.trackChanges.visible).toBe(true);
      expect(config.modules.trackChanges.mode).toBe('review');
      expect(config.modules.trackChanges.enabled).toBe(true);
    });

    it('preserves the previous author color config for v2 tracked-change rendering', () => {
      const authorColors = {
        enabled: true,
        overrides: { Ada: '#8250df' },
        resolve: vi.fn(),
      };
      const config = {
        modules: { trackChanges: { authorColors } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.authorColors).toBe(authorColors);
      expect(config.modules.trackChanges.authorColors).toBe(authorColors);
      expect(config.trackChanges.authorColors).toBe(authorColors);
      expect(config.layoutEngineOptions.trackedChanges).toEqual({ mode: 'review', enabled: true });
    });
  });

  describe('top-level tracked-change options', () => {
    it('uses top-level behavior without a deprecation warning', () => {
      const config = {
        trackChanges: { enabled: false, replacementMode: 'separate' },
      };

      const result = normalizeTrackChangesConfig(config);

      expect(result).toMatchObject({ enabled: false, replacements: 'independent' });
      expect(config.trackChanges.replacementMode).toBe('separate');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('preserves the semanticColors object by reference (keeps the resolve callback intact)', () => {
      const semanticColors = {
        enabled: true,
        overrides: { 'table-cell-insertion': '#1f6feb' },
        resolve: vi.fn(),
      };
      const config = {
        trackChanges: { semanticColors },
      };
      const result = normalizeTrackChangesConfig(config);

      // Same reference, not a clone, so the composed resolver keeps the callback.
      expect(result.semanticColors).toBe(semanticColors);
      expect(config.modules.trackChanges.semanticColors).toBe(semanticColors);
      expect(result.semanticColors.resolve).toBe(semanticColors.resolve);
    });

    it('preserves semanticColors and authorColors independently on the canonical path', () => {
      const authorColors = { overrides: { Ada: '#8250df' } };
      const semanticColors = { overrides: { 'cell-merge': '#d4a72c' } };
      const config = {
        trackChanges: { authorColors, semanticColors },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.authorColors).toBe(authorColors);
      expect(result.semanticColors).toBe(semanticColors);
    });

    it('omits semanticColors from the normalized result when not supplied', () => {
      const config = { trackChanges: { enabled: true } };
      const result = normalizeTrackChangesConfig(config);

      expect('semanticColors' in result).toBe(false);
      expect(config.modules.trackChanges.semanticColors).toBeUndefined();
    });

    it('ignores a non-object semanticColors value', () => {
      const config = {
        trackChanges: { enabled: true, semanticColors: 'nope' },
      };
      const result = normalizeTrackChangesConfig(config);

      expect('semanticColors' in result).toBe(false);
    });

    it('mirrors semantic colors to the internal module path only', () => {
      const semanticColors = { overrides: { 'move-from': '#00853d' } };
      const config = {
        trackChanges: { semanticColors },
      };
      normalizeTrackChangesConfig(config);

      expect(config.trackChanges.semanticColors).toBe(semanticColors);
      expect(config.modules.trackChanges.semanticColors).toBe(semanticColors);
      expect(config.layoutEngineOptions.trackedChanges).toEqual({ mode: 'review', enabled: true });
      expect('semanticColors' in config.layoutEngineOptions.trackedChanges).toBe(false);
    });

    it('keeps semanticColors stable and by-reference across repeated normalizations', () => {
      const semanticColors = { overrides: { 'cell-split': '#bc4c00' }, resolve: vi.fn() };
      const config = {
        trackChanges: { semanticColors },
      };

      const first = normalizeTrackChangesConfig(config);
      const second = normalizeTrackChangesConfig(config);

      expect(first.semanticColors).toBe(semanticColors);
      expect(second.semanticColors).toBe(semanticColors);
      expect(second.semanticColors).toBe(first.semanticColors);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('deprecated config.trackChanges.visible alias', () => {
    it('accepts visible via the legacy key and emits one deprecation warning', () => {
      const config = { trackChanges: { visible: true } };
      const result = normalizeTrackChangesConfig(config);

      expect(result.visible).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/config\.trackChanges\.visible/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/config\.viewing\.trackedChanges/);
    });

    it('mirrors the resolved visible back onto the legacy key', () => {
      const config = { trackChanges: { visible: true } };
      normalizeTrackChangesConfig(config);

      expect(config.trackChanges).toEqual({ visible: true, enabled: true, replacementMode: 'grouped' });
    });

    it('warns only once across multiple normalizer calls', () => {
      normalizeTrackChangesConfig({ trackChanges: { visible: true } });
      normalizeTrackChangesConfig({ trackChanges: { visible: false } });

      const visibleWarnings = warnSpy.mock.calls.filter((call) => /config\.trackChanges\.visible/.test(call[0]));
      expect(visibleWarnings).toHaveLength(1);
    });
  });

  describe('legacy config.layoutEngineOptions.trackedChanges', () => {
    it('accepts mode/enabled via the legacy key and emits one deprecation warning', () => {
      const config = {
        layoutEngineOptions: { trackedChanges: { mode: 'original', enabled: false } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('original');
      expect(result.enabled).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/layoutEngineOptions\.trackedChanges/);
    });

    it('mirrors resolved mode/enabled back onto the legacy key', () => {
      const config = {
        layoutEngineOptions: { trackedChanges: { mode: 'original', enabled: false } },
      };
      normalizeTrackChangesConfig(config);

      expect(config.layoutEngineOptions.trackedChanges).toEqual({ mode: 'original', enabled: false });
    });

    it('does not clobber sibling layoutEngineOptions fields', () => {
      const config = {
        layoutEngineOptions: { flowMode: 'semantic', trackedChanges: { mode: 'original' } },
      };
      normalizeTrackChangesConfig(config);

      expect(config.layoutEngineOptions.flowMode).toBe('semantic');
      expect(config.layoutEngineOptions.trackedChanges.mode).toBe('original');
    });
  });

  describe('precedence: new > legacy', () => {
    it('prefers config.trackChanges.visible over modules.trackChanges.visible', () => {
      const config = {
        modules: { trackChanges: { visible: false } },
        trackChanges: { visible: true },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.visible).toBe(true);
    });

    it('prefers modules.trackChanges.mode over layoutEngineOptions.trackedChanges.mode', () => {
      const config = {
        modules: { trackChanges: { mode: 'review' } },
        layoutEngineOptions: { trackedChanges: { mode: 'original' } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('review');
    });

    it('falls through to the legacy value when the new path omits the field', () => {
      const config = {
        modules: { trackChanges: { visible: true } }, // no mode/enabled
        layoutEngineOptions: { trackedChanges: { mode: 'original', enabled: false } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result).toEqual({ visible: true, mode: 'original', enabled: false, replacements: 'paired' });
    });
  });

  describe('defensive parsing', () => {
    it('ignores non-object legacy values', () => {
      const config = {
        trackChanges: 'not-an-object',
        layoutEngineOptions: { trackedChanges: null },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result).toEqual({ visible: false, mode: 'review', enabled: true, replacements: 'paired' });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('ignores array-typed modules/canonical/legacy objects', () => {
      const config = {
        modules: [],
        trackChanges: [],
        layoutEngineOptions: { trackedChanges: [] },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result).toEqual({ visible: false, mode: 'review', enabled: true, replacements: 'paired' });
      expect(Array.isArray(config.modules)).toBe(false);
    });

    it('treats a null canonical object as missing', () => {
      const config = {
        modules: { trackChanges: null },
        trackChanges: { visible: true },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.visible).toBe(true);
    });

    it('coerces invalid mode values to the derived default', () => {
      const config = {
        modules: { trackChanges: { mode: 'bogus' } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('review');
    });

    it('coerces non-boolean visible/enabled to the derived default', () => {
      const config = {
        modules: { trackChanges: { visible: 'yes', enabled: 0 } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.visible).toBe(false);
      expect(result.enabled).toBe(true);
    });
  });

  describe("replacementMode: 'grouped' | 'separate'", () => {
    it("defaults to 'grouped' on the public path", () => {
      const config = {};
      const result = normalizeTrackChangesConfig(config);

      expect(result.replacements).toBe('paired');
      expect(config.trackChanges.replacementMode).toBe('grouped');
    });

    it("maps replacementMode: 'separate' to the internal independent mode", () => {
      const result = normalizeTrackChangesConfig({ trackChanges: { replacementMode: 'separate' } });
      expect(result.replacements).toBe('independent');
    });

    it('keeps the previous replacements setting as a compatibility alias', () => {
      const config = {
        modules: { trackChanges: { replacements: 'independent' } },
      };
      normalizeTrackChangesConfig(config);

      expect(config.modules.trackChanges.replacements).toBe('independent');
      expect(config.trackChanges.replacementMode).toBe('separate');
      expect(warnSpy.mock.calls[0][0]).toContain('config.modules.trackChanges');
    });

    it('coerces an invalid replacementMode to the grouped default', () => {
      const result = normalizeTrackChangesConfig({
        trackChanges: { replacementMode: 'whatever' },
      });
      expect(result.replacements).toBe('paired');
    });

    it('prefers the top-level mode over the previous module setting', () => {
      const result = normalizeTrackChangesConfig({
        trackChanges: { replacementMode: 'grouped' },
        modules: { trackChanges: { replacements: 'independent' } },
      });
      expect(result.replacements).toBe('paired');
    });
  });

  describe('extended mode values (final / off)', () => {
    it('preserves mode: "final" supplied via the legacy layout path', () => {
      const config = {
        layoutEngineOptions: { trackedChanges: { mode: 'final', enabled: true } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('final');
      expect(config.layoutEngineOptions.trackedChanges.mode).toBe('final');
    });

    it('preserves mode: "off" supplied via the legacy layout path', () => {
      const config = {
        layoutEngineOptions: { trackedChanges: { mode: 'off' } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('off');
    });

    it('accepts mode: "final" on the previous module path', () => {
      const config = {
        modules: { trackChanges: { mode: 'final' } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result.mode).toBe('final');
    });
  });

  describe('conflicting legacy buckets', () => {
    it('warns for both legacy paths and merges their fields independently', () => {
      const config = {
        trackChanges: { visible: true },
        layoutEngineOptions: { trackedChanges: { mode: 'original', enabled: false } },
      };
      const result = normalizeTrackChangesConfig(config);

      expect(result).toEqual({ visible: true, mode: 'original', enabled: false, replacements: 'paired' });
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const messages = warnSpy.mock.calls.map((call) => call[0]);
      expect(messages.some((m) => /config\.trackChanges\.visible/.test(m))).toBe(true);
      expect(messages.some((m) => /layoutEngineOptions\.trackedChanges/.test(m))).toBe(true);
    });

    it('warns for both deprecated visibility inputs when the module value wins', () => {
      const config = {
        modules: { trackChanges: { visible: false } },
        trackChanges: { visible: true },
      };
      normalizeTrackChangesConfig(config);

      expect(warnSpy).toHaveBeenCalledTimes(2);
      const messages = warnSpy.mock.calls.map(([message]) => message);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.stringContaining('config.trackChanges.visible'),
          expect.stringContaining('config.modules.trackChanges'),
        ]),
      );
    });
  });

  describe('idempotency on config reuse', () => {
    it('does not re-warn when the same config object is normalized twice', () => {
      const config = {
        modules: { trackChanges: { visible: true } },
      };

      normalizeTrackChangesConfig(config);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Second pass on the SAME object — the write-through populated the legacy
      // paths on the first call, but that shouldn't look like new legacy usage.
      normalizeTrackChangesConfig(config);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('still warns on a fresh config object even after a previous one was normalized', () => {
      normalizeTrackChangesConfig({ modules: { trackChanges: { visible: true } } });

      __resetDeprecationWarnings();
      warnSpy.mockClear();

      const freshConfig = { trackChanges: { visible: true } };
      normalizeTrackChangesConfig(freshConfig);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('produces stable values across repeated normalizations of the same config', () => {
      const config = {
        modules: { trackChanges: { visible: true, mode: 'final' } },
      };
      const first = normalizeTrackChangesConfig(config);
      const second = normalizeTrackChangesConfig(config);

      expect(first).toEqual({ visible: true, mode: 'final', enabled: true, replacements: 'paired' });
      expect(second).toEqual(first);
    });
  });
});
