// Mutation-plane consolidation guard.
//
// SuperDoc v2 review mutations (comments + tracked changes) must route through
// the browser Document API surface (`activeEditor.doc.comments.*`,
// `activeEditor.doc.trackChanges.decide`). The public/shell review-mutation
// surfaces (comments store, comments-layer UI, the SuperDoc Vue component, and
// the v2 shell runtime adapter) must not regress back to host-dispatch review
// commands or to direct `activeEditor.v2Comments.<mutation>` /
// `activeEditor.v2TrackedChanges.accept|reject` calls. Those bridge surfaces may
// remain as read/focus/reveal/active-target helpers, or as explicitly named
// compatibility wrappers (in the private v2 browser shell) that delegate to
// `activeEditor.doc.*`.
//
// This static guard fails if a public review-mutation surface reintroduces a
// dispatch-backed or bridge-mutation review route.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const PKG_SRC = join(__dirname, '..', '..');

// Public review-mutation surfaces in scope for this guard. If one of these
// files moves, the guard should fail loudly so coverage is updated instead of
// silently disappearing.
const REVIEW_MUTATION_SURFACES = [
  'stores/comments-store.ts',
  'components/CommentsLayer/CommentDialog.vue',
  'components/CommentsLayer/commentsList/commentsList.vue',
  'SuperDoc.vue',
  'core/editor-runtime/v2/v2-editor-runtime-adapter.ts',
];

// Strip line and block comments so guidance comments that mention the old
// routes do not trip the scanner.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const FORBIDDEN_PATTERNS: { label: string; re: RegExp }[] = [
  // Review commands must not be mapped into host dispatch. Non-review v2
  // runtime commands (text/structure/history fallback) may still use
  // host.dispatch while that private cleanup remains out of scope.
  {
    label: 'host-dispatch review command',
    re: /(?:host\.dispatch\s*\(\s*\{[\s\S]{0,160}?kind\s*:|mapped\s*=\s*\{\s*kind\s*:)\s*['"]review\.(?:comment\w+|trackedChangeDecide)['"]/,
  },
  // Direct bridge mutation method on the active-editor facade.
  {
    label: 'activeEditor.v2Comments.<mutation>',
    re: /\.v2Comments\s*[?.]*\.(commitPendingComment|reply|edit|resolve|reopen|delete)\s*\(/,
  },
  {
    label: 'activeEditor.v2TrackedChanges.accept|reject',
    re: /\.v2TrackedChanges\s*[?.]*\.(accept|reject|acceptAll|rejectAll)\s*\(/,
  },
];

describe('public v2 review mutation route guard', () => {
  it('public review-mutation surfaces do not dispatch or call bridge mutation methods directly', () => {
    const offenders: { file: string; pattern: string }[] = [];
    for (const rel of REVIEW_MUTATION_SURFACES) {
      let source: string;
      try {
        source = readFileSync(join(PKG_SRC, rel), 'utf8');
      } catch (error) {
        throw new Error(`review mutation route guard could not read ${rel}: ${String(error)}`);
      }
      const code = stripComments(source);
      for (const { label, re } of FORBIDDEN_PATTERNS) {
        if (re.test(code)) offenders.push({ file: rel, pattern: label });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('self-test: scanner flags host-dispatch review command', () => {
    const synthetic = stripComments(`const r = await host.dispatch({ kind: 'review.trackedChangeDecide', input });`);
    const hit = FORBIDDEN_PATTERNS.some(({ re }) => re.test(synthetic));
    expect(hit).toBe(true);
  });

  it('self-test: scanner flags direct bridge mutation method', () => {
    const synthetic = stripComments(`await superdoc.activeEditor.v2TrackedChanges.accept(row);`);
    const hit = FORBIDDEN_PATTERNS.some(({ re }) => re.test(synthetic));
    expect(hit).toBe(true);
  });

  it('self-test: scanner ignores forbidden routes that appear only in comments', () => {
    const synthetic = stripComments(
      `// route through host.dispatch({ kind: 'review.trackedChangeDecide' })\nconst x = 1;`,
    );
    const hit = FORBIDDEN_PATTERNS.some(({ re }) => re.test(synthetic));
    expect(hit).toBe(false);
  });

  it('self-test: scanner allows Document API mutation route', () => {
    const synthetic = stripComments(`const receipt = activeEditor.doc.trackChanges.decide({ decision, target });`);
    const hit = FORBIDDEN_PATTERNS.some(({ re }) => re.test(synthetic));
    expect(hit).toBe(false);
  });
});
