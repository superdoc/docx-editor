import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const PACKAGE_ROOT = join(__dirname, '..', '..', '..');
const SRC_ROOT = join(PACKAGE_ROOT, 'src');
const EXTERNAL_VUE_ENTRIES = ['src/public/ui/vue.ts', 'src/core/v2-integration/browser-peer-runtime.js'];
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|vue)$/;
const NON_PACKAGED_FILE = /\.(?:test|spec)\.|\.d\.ts$/;
const NAMED_VUE_IMPORT = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]vue['"]/g;

function packageRelative(file: string): string {
  return relative(PACKAGE_ROOT, file).split(sep).join('/');
}

function packagedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return packageRelative(path) === 'src/dev' ? [] : packagedSources(path);
    return SOURCE_FILE.test(entry.name) && !NON_PACKAGED_FILE.test(entry.name) ? [path] : [];
  });
}

function namedVueValueImports(source: string): string[] {
  return [...source.matchAll(NAMED_VUE_IMPORT)].flatMap(([, typeOnly, specifiers]) =>
    typeOnly
      ? []
      : specifiers
          .split(',')
          .map((specifier) => specifier.trim())
          .filter((specifier) => specifier && !specifier.startsWith('type '))
          .map((specifier) => specifier.split(/\s+as\s+/)[0].trim()),
  );
}

describe('packaged internal Vue runtime exports', () => {
  it('keeps the external Vue entries in step with the package build', () => {
    const viteConfig = readFileSync(join(PACKAGE_ROOT, 'vite.config.js'), 'utf8');
    for (const entry of EXTERNAL_VUE_ENTRIES) expect(viteConfig).toContain(`'${entry}'`);
  });

  it('exports every Vue API that packaged sources import by name', async () => {
    const runtime: Record<string, unknown> = await import('./internal-vue-runtime.js');
    const missing = packagedSources(SRC_ROOT)
      .filter((file) => !EXTERNAL_VUE_ENTRIES.includes(packageRelative(file)))
      .flatMap((file) =>
        namedVueValueImports(readFileSync(file, 'utf8'))
          .filter((name) => !(name in runtime))
          .map((name) => `${packageRelative(file)}: ${name}`),
      );
    expect(missing).toEqual([]);
  });
});
