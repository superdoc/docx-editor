import { describe, it, expect } from 'vite-plus/test';
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

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..');

const superdocCss = readFileSync(
  join(repoRoot, 'packages', 'superdoc', 'src', 'assets', 'styles', 'elements', 'superdoc.css'),
  'utf8',
);

const extractRuleBody = (css, selector) => {
  const idx = css.indexOf(selector);
  if (idx === -1) return null;
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
};

describe('search-match CSS precedence (SD-3045)', () => {
  describe('packages/superdoc/src/assets/styles/elements/superdoc.css', () => {
    it('the coarse match fallback excludes exact-range carriers and uses !important', () => {
      const selector = '.superdoc .ProseMirror-search-match:not([data-sd-search-exact-highlight])';
      const body = extractRuleBody(superdocCss, selector);
      expect(body, `${selector} rule must exist`).not.toBeNull();
      expect(body).toMatch(/background\s*:[^;]*!important/);
    });

    it('the coarse active fallback excludes exact-range carriers and uses !important', () => {
      const selector = '.superdoc .ProseMirror-active-search-match:not([data-sd-search-exact-highlight])';
      const body = extractRuleBody(superdocCss, selector);
      expect(body, `${selector} rule must exist`).not.toBeNull();
      expect(body).toMatch(/background\s*:[^;]*!important/);
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
