import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { describe, it } = process.env.VITEST ? await import('vitest') : require('node:test');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vueTsc = require.resolve('vue-tsc/bin/vue-tsc.js', { paths: [packageRoot] });

function checkComponent(script) {
  const dir = mkdtempSync(path.join(packageRoot, '.check-vue-'));
  try {
    writeFileSync(path.join(dir, 'Probe.vue'), `<script setup lang="ts">\n${script}\n</script>\n<template><p /></template>\n`);
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: '../tsconfig.vue.json', include: ['../src/vite-env.d.ts', 'Probe.vue'] }),
    );
    return spawnSync(process.execPath, [vueTsc, '--noEmit', '-p', path.join(dir, 'tsconfig.json')], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check:vue', () => {
  it('runs vue-tsc on tsconfig.vue.json without emitting', () => {
    const { scripts } = require('../package.json');
    assert.equal(scripts['check:vue'], 'vue-tsc --noEmit -p tsconfig.vue.json');
  });

  it('reports a type error in a TypeScript component', () => {
    const result = checkComponent('const planted: number = "text";');
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /Probe\.vue\(2,7\): error TS2322/);
  });

  it('passes a type-correct TypeScript component', () => {
    const result = checkComponent('const planted: number = 1;');
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
