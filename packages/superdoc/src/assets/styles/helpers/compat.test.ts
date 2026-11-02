import { describe, expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const variablesCss = readFileSync(resolve(__dirname, 'variables.css'), 'utf-8');
const compatCss = readFileSync(resolve(__dirname, 'compat.css'), 'utf-8');
const themesCss = readFileSync(resolve(__dirname, 'themes.css'), 'utf-8');

/** Extract all --sd-* variable declarations from a CSS string. */
const extractDeclaredVars = (css: string): Set<string> => {
  const vars = new Set<string>();
  for (const match of css.matchAll(/(--sd-[\w-]+)\s*:/g)) {
    vars.add(match[1]);
  }
  return vars;
};

/** Extract all var(--sd-*) references from a CSS string. */
const extractReferencedVars = (css: string): Set<string> => {
  const vars = new Set<string>();
  for (const match of css.matchAll(/var\((--sd-[\w-]+)/g)) {
    vars.add(match[1]);
  }
  return vars;
};

describe('backward compatibility', () => {
  const declaredInVariables = extractDeclaredVars(variablesCss);
  const declaredInCompat = extractDeclaredVars(compatCss);
  const referencedByCompat = extractReferencedVars(compatCss);

  describe('compat.css aliases', () => {
    it('every alias points to a variable defined in variables.css', () => {
      const broken: string[] = [];
      for (const ref of referencedByCompat) {
        if (!declaredInVariables.has(ref)) {
          broken.push(ref);
        }
      }
      expect(broken, `Compat aliases reference undefined variables: ${broken.join(', ')}`).toEqual([]);
    });

    it('does not re-declare any variable from variables.css', () => {
      const collisions: string[] = [];
      for (const name of declaredInCompat) {
        if (declaredInVariables.has(name)) {
          collisions.push(name);
        }
      }
      expect(collisions, `Compat re-declares variables from variables.css: ${collisions.join(', ')}`).toEqual([]);
    });

    it('has no circular references with variables.css', () => {
      // A circular reference: compat declares --old pointing to --new,
      // AND variables.css declares --new pointing back to --old.
      const circular: string[] = [];
      for (const compatVar of declaredInCompat) {
        // Find what this compat alias points to
        const match = compatCss.match(
          new RegExp(`${compatVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*var\\((--sd-[\\w-]+)`),
        );
        if (!match) continue;
        const target = match[1];
        // Check if variables.css references the compat var name
        const targetDecl = variablesCss.match(
          new RegExp(
            `${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:[^;]*var\\(${compatVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          ),
        );
        if (targetDecl) {
          circular.push(`${compatVar} ↔ ${target}`);
        }
      }
      expect(circular, `Circular references found: ${circular.join(', ')}`).toEqual([]);
    });
  });

  describe('old-name fallbacks in variables.css', () => {
    it('honors old comment variable names', () => {
      const expected: [string, string][] = [
        ['--sd-ui-comments-card-bg', '--sd-comment-bg'],
        ['--sd-ui-comments-card-hover-bg', '--sd-comment-bg-hover'],
        ['--sd-ui-comments-card-active-bg', '--sd-comment-bg-active'],
        ['--sd-ui-comments-separator', '--sd-comment-separator'],
        ['--sd-ui-comments-author-text', '--sd-comment-author-color'],
        ['--sd-ui-comments-timestamp-text', '--sd-comment-time-color'],
        ['--sd-ui-comments-internal-bg', '--sd-comment-internal-bg'],
        ['--sd-ui-comments-external-bg', '--sd-comment-external-bg'],
      ];
      for (const [newName, oldName] of expected) {
        const pattern = new RegExp(
          `${newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*var\\(${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        );
        expect(variablesCss, `Expected ${newName} to fall back to ${oldName}`).toMatch(pattern);
      }
    });

    it('honors old tracked change variable names', () => {
      const expected: [string, string][] = [
        ['--sd-tracked-changes-insert-border', '--sd-track-insert-border'],
        ['--sd-tracked-changes-insert-background', '--sd-track-insert-bg'],
        ['--sd-tracked-changes-delete-border', '--sd-track-delete-border'],
        ['--sd-tracked-changes-delete-background', '--sd-track-delete-bg'],
        ['--sd-tracked-changes-format-border', '--sd-track-format-border'],
      ];
      for (const [newName, oldName] of expected) {
        const pattern = new RegExp(
          `${newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*var\\(${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        );
        expect(variablesCss, `Expected ${newName} to fall back to ${oldName}`).toMatch(pattern);
      }
    });

    it('keeps focused tracked changes in the host palette', () => {
      const expected: [string, string, string, string][] = [
        [
          '--sd-tracked-changes-insert-background-focused',
          '--sd-track-insert-bg-focused',
          '--sd-tracked-changes-insert-background',
          '--sd-track-insert-bg',
        ],
        [
          '--sd-tracked-changes-delete-background-focused',
          '--sd-track-delete-bg-focused',
          '--sd-tracked-changes-delete-background',
          '--sd-track-delete-bg',
        ],
      ];
      for (const [target, focused, canonical, legacy] of expected) {
        const pattern = new RegExp(
          `${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*var\\(\\s*${focused.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,\\s*var\\(\\s*${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,\\s*var\\(\\s*${legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        );
        expect(variablesCss, `Expected ${target} to use ${focused}, ${canonical}, then ${legacy}`).toMatch(pattern);
      }
    });

    it('honors old semantic variable names', () => {
      const expected: [string, string][] = [
        ['--sd-ui-bg', '--sd-surface-card'],
        ['--sd-ui-text', '--sd-text-primary'],
        ['--sd-ui-border', '--sd-border-default'],
        ['--sd-ui-action', '--sd-action-primary'],
        ['--sd-ui-font-family', '--sd-font-family'],
        ['--sd-ui-hover-bg', '--sd-surface-hover'],
      ];
      for (const [newName, oldName] of expected) {
        const pattern = new RegExp(
          `${newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*var\\(${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        );
        expect(variablesCss, `Expected ${newName} to fall back to ${oldName}`).toMatch(pattern);
      }
    });
  });

  describe('preset themes', () => {
    /** Extract variables declared inside each .sd-theme-* block. */
    const extractThemeBlocks = (css: string): Map<string, Set<string>> => {
      const themes = new Map<string, Set<string>>();
      const blockRegex = /\.(sd-theme-[\w-]+)\s*\{([^}]+)\}/g;
      for (const match of css.matchAll(blockRegex)) {
        const vars = new Set<string>();
        for (const decl of match[2].matchAll(/(--sd-[\w-]+)\s*:/g)) {
          vars.add(decl[1]);
        }
        themes.set(match[1], vars);
      }
      return themes;
    };

    const themeBlocks = extractThemeBlocks(themesCss);

    it('contains all expected preset themes', () => {
      expect([...themeBlocks.keys()].sort()).toEqual(['sd-theme-blueprint', 'sd-theme-docs', 'sd-theme-word']);
    });

    it('every theme variable is declared in variables.css', () => {
      const declaredInVariables = extractDeclaredVars(variablesCss);
      const broken: string[] = [];
      for (const [theme, vars] of themeBlocks) {
        for (const v of vars) {
          if (!declaredInVariables.has(v)) {
            broken.push(`${theme}: ${v}`);
          }
        }
      }
      expect(broken, `Theme variables not in variables.css: ${broken.join(', ')}`).toEqual([]);
    });
  });
});
