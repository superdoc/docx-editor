import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const packageRoot = path.resolve(__dirname, '..');
const vueTsc = createRequire(path.join(packageRoot, 'package.json')).resolve('vue-tsc/bin/vue-tsc.js');

function checkProbeTest(source: string) {
  const dir = mkdtempSync(path.join(packageRoot, '.check-test-types-'));
  try {
    writeFileSync(path.join(dir, 'probe.test.ts'), source);
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        extends: '../tsconfig.test.json',
        files: ['../src/vite-env.d.ts', 'probe.test.ts'],
        include: [],
      }),
    );
    return spawnSync(process.execPath, [vueTsc, '--noEmit', '-p', path.join(dir, 'tsconfig.json')], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface TestTypeCheckConfig {
  extends: string;
  compilerOptions: { lib: string[] };
  files: string[];
  include: string[];
  exclude: string[];
}

function readTestTypeCheckConfig(): TestTypeCheckConfig {
  return JSON.parse(readFileSync(path.join(packageRoot, 'tsconfig.test.json'), 'utf8'));
}

describe('tsconfig.test.json', () => {
  const config = readTestTypeCheckConfig();

  it('checks tests with vue-tsc against the package Vue config and its own empty exclude', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(scripts['check:test-types']).toBe('vue-tsc --noEmit -p tsconfig.test.json');
    expect(config.extends).toBe('./tsconfig.vue.json');
    expect(config.exclude).toEqual([]);
  });

  it('uses the Vue config lib plus DOM.Iterable, so the test lib cannot drift from the package lib', () => {
    const vueConfig = JSON.parse(readFileSync(path.join(packageRoot, 'tsconfig.vue.json'), 'utf8'));
    expect(config.compilerOptions.lib).toEqual([...vueConfig.compilerOptions.lib, 'DOM.Iterable']);
  });

  it('lists only test files that exist, so a renamed test cannot drop out', () => {
    const [ambientTypes, ...tests] = config.files;
    expect(ambientTypes).toBe('src/vite-env.d.ts');
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter((file) => !/^src\/.+\.test\.ts$/.test(file))).toEqual([]);
    expect(tests.filter((file) => !existsSync(path.join(packageRoot, file)))).toEqual([]);
    expect(new Set(tests).size).toBe(tests.length);
  });

  it('includes only directory globs that match a test file, so a moved directory cannot drop out', () => {
    expect(config.include.length).toBeGreaterThan(0);
    expect(config.include.filter((pattern) => !/^src\/.+\/\*\.test\.ts$/.test(pattern))).toEqual([]);
    expect(config.include.filter((pattern) => globSync(pattern, { cwd: packageRoot }).length === 0)).toEqual([]);
  });

  it('reports a type error in a test file under its compiler options', () => {
    const result = checkProbeTest("export const planted: number = 'text';\n");
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout).toMatch(/probe\.test\.ts\(1,14\): error TS2322/);
  });

  it('passes a type-correct test file under its compiler options', () => {
    const result = checkProbeTest('export const planted: number = 1;\n');
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('does not list a file that an include glob already covers', () => {
    const globbed = new Set(config.include.flatMap((pattern) => globSync(pattern, { cwd: packageRoot })));
    expect(config.files.filter((file) => globbed.has(file))).toEqual([]);
  });
});
