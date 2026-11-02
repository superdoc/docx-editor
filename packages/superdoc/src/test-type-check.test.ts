import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
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

const EXCLUDED_TEST_CEILING = 53;

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

function testTypeCheckProgramFiles(): string[] {
  const configPath = path.join(packageRoot, 'tsconfig.test.json');
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts
    .parseJsonConfigFileContent(config, ts.sys, packageRoot, undefined, configPath)
    .fileNames.map((file) => path.relative(packageRoot, file).split(path.sep).join('/'));
}

describe('tsconfig.test.json', () => {
  const config = readTestTypeCheckConfig();
  const testFiles = globSync(['src/**/*.test.ts', 'scripts/**/*.test.ts'], { cwd: packageRoot }).map((file) =>
    file.split(path.sep).join('/'),
  );

  it('checks tests with vue-tsc against the package Vue config', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(scripts['check:test-types']).toBe('vue-tsc --noEmit -p tsconfig.test.json');
    expect(config.extends).toBe('./tsconfig.vue.json');
  });

  it('uses the Vue config lib plus DOM.Iterable, so the test lib cannot drift from the package lib', () => {
    const vueConfig = JSON.parse(readFileSync(path.join(packageRoot, 'tsconfig.vue.json'), 'utf8'));
    expect(config.compilerOptions.lib).toEqual([...vueConfig.compilerOptions.lib, 'DOM.Iterable']);
  });

  it('includes every test by glob, so a new test is checked unless it is excluded by name', () => {
    expect(config.files).toEqual(['src/vite-env.d.ts']);
    expect(config.include).toEqual(['src/**/*.test.ts', 'scripts/**/*.test.ts']);
  });

  it('excludes only existing test files, each once and in order, so a renamed test cannot stay excluded', () => {
    const existing = new Set(testFiles);
    expect(config.exclude.filter((file) => !existing.has(file))).toEqual([]);
    expect(new Set(config.exclude).size).toBe(config.exclude.length);
    expect(config.exclude).toEqual([...config.exclude].sort());
  });

  it('caps the excluded tests, so a PR that adds an exception must raise this ceiling', () => {
    expect(config.exclude.length).toBeLessThanOrEqual(EXCLUDED_TEST_CEILING);
  });

  it('checks every test file that is not excluded', () => {
    const excluded = new Set(config.exclude);
    const checked = new Set(testTypeCheckProgramFiles());
    expect(testFiles.filter((file) => !excluded.has(file) && !checked.has(file))).toEqual([]);
    expect(config.exclude.filter((file) => checked.has(file))).toEqual([]);
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
});
