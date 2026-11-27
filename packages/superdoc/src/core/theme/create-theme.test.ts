import { describe, expect, it, beforeEach } from 'vite-plus/test';
import { createTheme, buildTheme, type ThemeConfig } from './create-theme.ts';

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
    it('does not inject styles into the DOM', () => {
      buildTheme({ name: 'no-inject', colors: { action: '#abc' } });
      expect(document.querySelector('[data-sd-theme="sd-theme-no-inject"]')).toBeNull();
    });
  });
});

function recordInput(config: unknown): string {
  return JSON.stringify(config, (_key, value: unknown) => (value === undefined ? '<undefined>' : value), 2);
}

const unknownColorKey: Record<string, string> = { action: '#ff0000', notAColor: '#000' };
const nullishColors: Record<string, string | null | undefined> = { action: '#ff0000', bg: undefined, text: null };

const recordedThemes: Array<{ scenario: string; config: ThemeConfig }> = [
  {
    scenario: 'all-colors',
    config: {
      name: 'colors-test',
      colors: {
        action: '#6366f1',
        actionHover: '#4f46e5',
        actionText: '#fefefe',
        bg: '#ffffff',
        hoverBg: '#f1f5f9',
        activeBg: '#e2e8f0',
        disabledBg: '#f5f5f5',
        text: '#1e293b',
        textMuted: '#64748b',
        textDisabled: '#94a3b8',
        border: '#e2e8f0',
      },
    },
  },
  { scenario: 'nullish-colors', config: { name: 'null-test', colors: nullishColors } },
  { scenario: 'unknown-color-key', config: { name: 'unknown-test', colors: unknownColorKey } },
  {
    scenario: 'font-radius-shadow',
    config: { name: 'shape', font: 'Inter, sans-serif', radius: '8px', shadow: '0 2px 8px rgba(0,0,0,0.1)' },
  },
  {
    scenario: 'vars',
    config: {
      name: 'vars-test',
      vars: { '--sd-ui-toolbar-bg': '#f8fafc', '--sd-ui-comments-card-bg': '#f0f0ff', '--sd-ui-menu-bg': null },
    },
  },
  {
    scenario: 'docs-product-theme',
    config: {
      name: 'product',
      colors: { action: '#4f46e5', bg: '#f8fafc', text: '#1e293b', border: '#cbd5e1' },
      vars: { '--sd-layout-page-bg': '#ffffff', '--sd-ui-toolbar-bg': '#eef2ff' },
    },
  },
  {
    scenario: 'var-overrides-semantic-color',
    config: { name: 'override', colors: { bg: '#000000' }, vars: { '--sd-ui-bg': '#111111' } },
  },
  { scenario: 'unsafe-name', config: { name: 'acme corp/dark', colors: { action: '#f00' } } },
  { scenario: 'empty', config: { name: 'empty' } },
];

describe('buildTheme recordings', () => {
  it.each(recordedThemes)('$scenario', async ({ scenario, config }) => {
    const { className, css } = buildTheme(config);
    const recording = `input:\n${recordInput(config)}\n\nclassName: ${className}\n\ncss:\n${css}\n`;
    await expect(recording).toMatchFileSnapshot(`./__snapshots__/create-theme/${scenario}.txt`);
  });
});
