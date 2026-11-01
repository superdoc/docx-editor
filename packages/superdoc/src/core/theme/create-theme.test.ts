import { describe, expect, it, beforeEach } from 'vite-plus/test';
import { createTheme, buildTheme } from './create-theme.ts';

describe('createTheme', () => {
  beforeEach(() => {
    document.querySelectorAll('[data-sd-theme]').forEach((el) => el.remove());
  });

  it('returns a class name with sd-theme- prefix', () => {
    const cls = createTheme({ colors: { action: '#ff0000' } });
    expect(cls).toMatch(/^sd-theme-/);
  });

  it('uses the provided name', () => {
    expect(createTheme({ name: 'dark', colors: { bg: '#000' } })).toBe('sd-theme-dark');
  });

  it('generates unique names when no name provided', () => {
    const a = createTheme({ colors: { action: '#111' } });
    const b = createTheme({ colors: { action: '#222' } });
    expect(a).not.toBe(b);
  });

  describe('color mapping', () => {
    it('maps all color properties to CSS variables', () => {
      const { css } = buildTheme({
        name: 'colors-test',
        colors: {
          action: '#6366f1',
          actionHover: '#4f46e5',
          bg: '#ffffff',
          hoverBg: '#f1f5f9',
          activeBg: '#e2e8f0',
          disabledBg: '#f5f5f5',
          text: '#1e293b',
          textMuted: '#64748b',
          textDisabled: '#94a3b8',
          border: '#e2e8f0',
        },
      });
      expect(css).toContain('--sd-ui-action: #6366f1');
      expect(css).toContain('--sd-ui-action-hover: #4f46e5');
      expect(css).toContain('--sd-ui-bg: #ffffff');
      expect(css).toContain('--sd-ui-hover-bg: #f1f5f9');
      expect(css).toContain('--sd-ui-active-bg: #e2e8f0');
      expect(css).toContain('--sd-ui-disabled-bg: #f5f5f5');
      expect(css).toContain('--sd-ui-text: #1e293b');
      expect(css).toContain('--sd-ui-text-muted: #64748b');
      expect(css).toContain('--sd-ui-text-disabled: #94a3b8');
      expect(css).toContain('--sd-ui-border: #e2e8f0');
    });

    it('ignores null and undefined color values', () => {
      const colors: Record<string, string | null | undefined> = { action: '#ff0000', bg: undefined, text: null };
      const { css } = buildTheme({
        name: 'null-test',
        colors,
      });
      expect(css).toContain('--sd-ui-action: #ff0000');
      expect(css).not.toContain('--sd-ui-bg');
      expect(css).not.toContain('--sd-ui-text');
    });

    it('ignores unknown color keys', () => {
      const colors: Record<string, string> = { action: '#ff0000', notAColor: '#000' };
      const { css } = buildTheme({
        name: 'unknown-test',
        colors,
      });
      expect(css).toContain('--sd-ui-action');
      expect(css).not.toContain('notAColor');
    });
  });

  describe('top-level shortcuts', () => {
    it('maps font to --sd-ui-font-family', () => {
      const { css } = buildTheme({ name: 'font-test', font: 'Inter, sans-serif' });
      expect(css).toContain('--sd-ui-font-family: Inter, sans-serif');
    });

    it('maps radius to --sd-ui-radius', () => {
      const { css } = buildTheme({ name: 'radius-test', radius: '8px' });
      expect(css).toContain('--sd-ui-radius: 8px');
    });

    it('maps shadow to --sd-ui-shadow', () => {
      const { css } = buildTheme({ name: 'shadow-test', shadow: '0 2px 8px rgba(0,0,0,0.1)' });
      expect(css).toContain('--sd-ui-shadow: 0 2px 8px rgba(0,0,0,0.1)');
    });
  });

  describe('vars escape hatch', () => {
    it('spreads raw CSS variable overrides', () => {
      const { css } = buildTheme({
        name: 'vars-test',
        vars: {
          '--sd-ui-toolbar-bg': '#f8fafc',
          '--sd-ui-comments-card-bg': '#f0f0ff',
        },
      });
      expect(css).toContain('--sd-ui-toolbar-bg: #f8fafc');
      expect(css).toContain('--sd-ui-comments-card-bg: #f0f0ff');
    });

    it('ignores null vars', () => {
      const { css } = buildTheme({
        name: 'vars-null',
        vars: { '--sd-ui-toolbar-bg': '#fff', '--sd-ui-menu-bg': null },
      });
      expect(css).toContain('--sd-ui-toolbar-bg');
      expect(css).not.toContain('--sd-ui-menu-bg');
    });

    it('combines colors and vars', () => {
      const { css } = buildTheme({
        name: 'combined',
        colors: { action: '#6366f1' },
        vars: { '--sd-ui-toolbar-bg': '#f8fafc' },
      });
      expect(css).toContain('--sd-ui-action: #6366f1');
      expect(css).toContain('--sd-ui-toolbar-bg: #f8fafc');
    });
  });

  describe('style injection', () => {
    it('injects a style element into the document', () => {
      const cls = createTheme({ name: 'inject', colors: { action: '#abc' } });
      const style = document.querySelector(`[data-sd-theme="${cls}"]`);
      expect(style).not.toBeNull();
      expect(style!.textContent).toContain('--sd-ui-action: #abc');
    });

    it('updates existing style element on re-call with same name', () => {
      createTheme({ name: 'reuse', colors: { action: '#111' } });
      createTheme({ name: 'reuse', colors: { action: '#222' } });
      const styles = document.querySelectorAll('[data-sd-theme="sd-theme-reuse"]');
      expect(styles.length).toBe(1);
      expect(styles[0].textContent).toContain('#222');
    });

    it('returns class name even with empty config', () => {
      const cls = createTheme({ name: 'empty' });
      expect(cls).toBe('sd-theme-empty');
      expect(document.querySelector('[data-sd-theme="sd-theme-empty"]')).toBeNull();
    });
  });

  describe('buildTheme', () => {
    it('returns className and css', () => {
      const result = buildTheme({ name: 'build', colors: { action: '#f00' } });
      expect(result.className).toBe('sd-theme-build');
      expect(result.css).toContain('.sd-theme-build');
      expect(result.css).toContain('--sd-ui-action: #f00');
    });

    it('does not inject styles into the DOM', () => {
      buildTheme({ name: 'no-inject', colors: { action: '#abc' } });
      expect(document.querySelector('[data-sd-theme="sd-theme-no-inject"]')).toBeNull();
    });

    it('wraps css in the class selector', () => {
      const { css } = buildTheme({ name: 'selector', colors: { bg: '#fff' } });
      expect(css).toMatch(/^\.sd-theme-selector \{/);
      expect(css).toMatch(/\}$/);
    });
  });
});
