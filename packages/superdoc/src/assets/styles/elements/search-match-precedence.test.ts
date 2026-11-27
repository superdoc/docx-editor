import { describe, it, expect, afterEach } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// SD-3045 (cross-package CSS invariant). The DomPainter writes
// `style.backgroundColor = run.highlight` inline on the same span the search
// DecorationBridge tags with `.ProseMirror-search-match`. Without `!important`,
// the inline style wins and the search highlight is invisible on every run
// whose source rPr carries a highlight mark (e.g. `<w:highlight w:val="white"/>`).
// These tests guard the two CSS sites that paint the transient search colour.

const stylesRoot = join(__dirname, '..');

const inlineImports = (path: string): string =>
  readFileSync(path, 'utf8').replace(/@import\s+'([^']+)';/g, (_statement, relative: string) =>
    inlineImports(join(dirname(path), relative)),
  );

const superdocStyles = inlineImports(join(stylesRoot, 'main.css'));

const superdocCss = readFileSync(join(__dirname, 'superdoc.css'), 'utf8');

const extractRuleBody = (css: string, selector: string) => {
  const idx = css.indexOf(selector);
  if (idx === -1) return null;
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
};

const INLINE_RUN_HIGHLIGHT = 'rgb(255, 255, 255)';

const renderRun = (classes: string[], attributes: Record<string, string> = {}): HTMLElement => {
  const root = document.createElement('div');
  root.className = 'superdoc';
  const span = document.createElement('span');
  span.className = classes.join(' ');
  span.setAttribute('style', `background-color: ${INLINE_RUN_HIGHLIGHT};`);
  for (const [name, value] of Object.entries(attributes)) span.setAttribute(name, value);
  root.append(span);
  document.body.append(root);
  return span;
};

describe('search-match CSS precedence (SD-3045)', () => {
  describe('packages/superdoc/src/assets/styles/main.css', () => {
    afterEach(() => {
      document.head.innerHTML = '';
      document.body.innerHTML = '';
    });

    const loadSuperdocStyles = () => {
      const styleEl = document.createElement('style');
      styleEl.textContent = superdocStyles;
      document.head.append(styleEl);
    };

    it('paints a coarse match over the run highlight written inline by the painter', () => {
      loadSuperdocStyles();
      const run = renderRun(['ProseMirror-search-match']);
      expect(getComputedStyle(run).backgroundColor).toBe('rgba(255, 213, 0, 0.4)');
    });

    it('paints the active coarse match over the inline run highlight and the plain match color', () => {
      loadSuperdocStyles();
      const active = renderRun(['ProseMirror-active-search-match']);
      const both = renderRun(['ProseMirror-search-match', 'ProseMirror-active-search-match']);
      expect(getComputedStyle(active).backgroundColor).toBe('rgba(255, 150, 0, 0.6)');
      expect(getComputedStyle(both).backgroundColor).toBe('rgba(255, 150, 0, 0.6)');
    });

    it('leaves exact-range carriers to the custom highlight and keeps their inline run highlight', () => {
      loadSuperdocStyles();
      const exact = { 'data-sd-search-exact-highlight': '' };
      const match = renderRun(['ProseMirror-search-match'], exact);
      const active = renderRun(['ProseMirror-active-search-match'], exact);
      expect(getComputedStyle(match).backgroundColor).toBe(INLINE_RUN_HIGHLIGHT);
      expect(getComputedStyle(active).backgroundColor).toBe(INLINE_RUN_HIGHLIGHT);
    });

    it('uses the existing search variables for exact custom-highlight colors', () => {
      expect(extractRuleBody(superdocCss, '::highlight(superdoc-search-match)')).toMatch(
        /background\s*:\s*var\(--sd-ui-search-match-bg\)/,
      );
      expect(extractRuleBody(superdocCss, '::highlight(superdoc-search-active-match)')).toMatch(
        /background\s*:\s*var\(--sd-ui-search-match-active-bg\)/,
      );
    });
  });

  describe('JSDOM specificity sanity check', () => {
    it('class-level `background !important` beats inline `style="background-color: white"`', () => {
      const styleEl = document.createElement('style');
      styleEl.textContent = `.search-test { background: rgba(255, 213, 0, 0.4) !important; }`;
      document.head.appendChild(styleEl);

      const span = document.createElement('span');
      span.className = 'search-test';
      span.setAttribute('style', 'background-color: rgb(255, 255, 255);');
      document.body.appendChild(span);

      const bg = getComputedStyle(span).backgroundColor;

      styleEl.remove();
      span.remove();

      expect(bg).toBe('rgba(255, 213, 0, 0.4)');
    });

    it('without !important, inline `background-color: white` overrides class background', () => {
      const styleEl = document.createElement('style');
      styleEl.textContent = `.search-test-noimp { background: rgba(255, 213, 0, 0.4); }`;
      document.head.appendChild(styleEl);

      const span = document.createElement('span');
      span.className = 'search-test-noimp';
      span.setAttribute('style', 'background-color: rgb(255, 255, 255);');
      document.body.appendChild(span);

      const bg = getComputedStyle(span).backgroundColor;

      styleEl.remove();
      span.remove();

      expect(bg).toBe('rgb(255, 255, 255)');
    });
  });
});
