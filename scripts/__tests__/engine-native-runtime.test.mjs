import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ENGINE_NATIVE_RUNTIME_EXPORTS, isEngineRuntimeOutputDestination, verifyEngineNativeRuntime } from '../engine-native-runtime.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const policy = { schema: 'engine-obfuscation.v1', tool: 'test', optionsSha256: 'a'.repeat(64) };

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'native-runtime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const banner = '/* licensed */\n';
  const code = 'export const protectedRuntime = true;\n';
  const inventory = {
    schema: 'superdoc-native-runtime-origins.v1', rawSha256: 'b'.repeat(64),
    exports: ENGINE_NATIVE_RUNTIME_EXPORTS, imports: ['node:fs', 'yjs'],
    modules: [{ path: 'superdoc/v2/headless/src/index.ts', sourceSha256: 'c'.repeat(64), renderedLength: 10 }],
  };
  const manifest = {
    schema: 'superdoc-native-runtime.v1', banner, outputSha256: hash(banner + code),
    protection: { ...policy, entries: [{ path: 'native-runtime.js', target: 'node', identifierNamesGenerator: 'hexadecimal',
      sourceSha256: inventory.rawSha256, obfuscatedSha256: hash(code) }] },
  };
  const write = () => {
    const bytes = JSON.stringify(inventory);
    manifest.inventorySha256 = hash(bytes);
    writeFileSync(path.join(directory, 'rendered-origins.json'), bytes);
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  };
  mkdirSync(path.join(directory, 'runtime'));
  writeFileSync(path.join(directory, 'runtime/native-runtime.js'), banner + code);
  write();
  return { directory, inventory, manifest, write };
}

test('native runtime binds protected bytes, raw origins, policy and its closed export surface', (t) => {
  const { directory, inventory } = fixture(t);
  assert.deepEqual(verifyEngineNativeRuntime(directory, policy).inventory, inventory);
});

for (const [name, mutate] of [
  ['wrong policy', ({ manifest }) => { manifest.protection.optionsSha256 = 'd'.repeat(64); }],
  ['missing protection entries', ({ manifest }) => { delete manifest.protection.entries; }],
  ['unprotected bytes', ({ manifest }) => { manifest.protection.entries[0].obfuscatedSha256 = 'd'.repeat(64); }],
  ['unbound origins', ({ inventory }) => { inventory.rawSha256 = 'd'.repeat(64); }],
  ['extra exports', ({ inventory }) => { inventory.exports = [...inventory.exports, 'privateDebug']; }],
  ['private external import', ({ inventory }) => { inventory.imports.push('@superdoc/headless'); }],
  ['missing origins', ({ inventory }) => { inventory.modules = []; }],
  ['duplicate origins', ({ inventory }) => { inventory.modules.push(inventory.modules[0]); }],
  ['origin traversal', ({ inventory }) => { inventory.modules[0].path = 'superdoc/v2/../../public/file.ts'; }],
  ['non-rendered origin', ({ inventory }) => { inventory.modules[0].renderedLength = 0; }],
]) {
  test(`rejects ${name} even when manifest inventory hashes are recomputed`, (t) => {
    const input = fixture(t);
    mutate(input);
    input.write();
    assert.throws(() => verifyEngineNativeRuntime(input.directory, policy), /Protected native runtime/);
  });
}

test('missing or modified component files fail closed', (t) => {
  const input = fixture(t);
  const file = path.join(input.directory, 'runtime/native-runtime.js');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// altered');
  assert.throws(() => verifyEngineNativeRuntime(input.directory, policy), /Protected native runtime/);
  rmSync(path.join(input.directory, 'manifest.json'));
  assert.throws(() => verifyEngineNativeRuntime(input.directory, policy), /ENOENT/);
});

test('native runtime has one fixed destination and cannot masquerade as a leaf', () => {
  assert.equal(isEngineRuntimeOutputDestination('native-runtime', 'dist-native'), true);
  assert.equal(isEngineRuntimeOutputDestination('native-runtime', 'headless/dist'), false);
  assert.equal(isEngineRuntimeOutputDestination('leaf-native-runtime', 'dist-native'), false);
  assert.equal(isEngineRuntimeOutputDestination('leaf-headless', 'headless/dist'), true);
  assert.equal(isEngineRuntimeOutputDestination('leaf-headless', '../headless/dist'), false);
});
