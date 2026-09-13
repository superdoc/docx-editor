import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

export const ENGINE_NATIVE_RUNTIME_ID = 'native-runtime';
export const ENGINE_NATIVE_RUNTIME_DESTINATION = 'dist-native';
export const ENGINE_NATIVE_RUNTIME_FILE = 'native-runtime.js';
export const ENGINE_NATIVE_RUNTIME_LEGAL_FILES = Object.freeze(['DOCX-ENGINE-LICENSE.md', 'NOTICE.md', 'THIRD_PARTY_NOTICES']);
export const ENGINE_NATIVE_CLI_LEGAL_FILES = Object.freeze([...ENGINE_NATIVE_RUNTIME_LEGAL_FILES, 'YJS-LICENSE']);
export const ENGINE_NATIVE_RUNTIME_EXPORTS = Object.freeze([
  'COLLAB_V2_DIAGNOSTICS', 'CollabV2DiagnosticError', 'DocumentRpcInvalidParamsError',
  'MAX_DOCUMENT_HOST_REQUEST_TIMEOUT_MS', 'createDocumentHost', 'createDocumentRuntimeSessionManager',
  'createHocuspocusSingleDocAdapter', 'createLiveblocksSingleDocAdapter', 'createV2DocumentApiHost',
  'createV2SingleDocCollaborationRuntime', 'createYWebsocketSingleDocAdapter', 'documentRpcErrorData',
  'isDocumentHostError', 'isDocumentRpcMethod', 'isDocumentRuntimeError', 'openDocumentRuntime',
  'openV2CollaborativeDocumentSession', 'openV2DocumentApiHost', 'redactForDiagnostics',
  'resolveDocumentRpcResponseTimeout', 'saveCollaborativeDocumentSession', 'saveDocumentSessionWithDiagnostics',
].sort());

export function isEngineRuntimeOutputDestination(id, destination) {
  if (id === ENGINE_NATIVE_RUNTIME_ID) return destination === ENGINE_NATIVE_RUNTIME_DESTINATION;
  return typeof destination === 'string' && destination.endsWith('/dist')
    && /^leaf-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)
    && id === `leaf-${destination.slice(0, -'/dist'.length).replaceAll('/', '-')}`;
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

// The producer receipt must verify the complete tree before this structural
// check. This manifest binds the rendered origins to the raw/protected bytes;
// it is not an independent grant of build or publication authority.
export function verifyEngineNativeRuntime(directory, expectedProtection) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const inventoryBytes = readFileSync(path.join(directory, 'rendered-origins.json'));
  const inventory = JSON.parse(inventoryBytes);
  const runtimePath = path.join(directory, 'runtime', ENGINE_NATIVE_RUNTIME_FILE);
  const code = readFileSync(runtimePath, 'utf8');
  const protection = manifest.protection;
  const entry = protection?.entries?.[0];
  if (
    manifest.schema !== 'superdoc-native-runtime.v1'
    || inventory.schema !== 'superdoc-native-runtime-origins.v1'
    || sha256(inventoryBytes) !== manifest.inventorySha256
    || sha256(code) !== manifest.outputSha256
    || !expectedProtection
    || ['schema', 'tool', 'optionsSha256'].some((key) => protection?.[key] !== expectedProtection[key])
    || !Array.isArray(protection?.entries) || protection.entries.length !== 1
    || entry.path !== ENGINE_NATIVE_RUNTIME_FILE
    || entry.target !== 'node'
    || entry.identifierNamesGenerator !== 'hexadecimal'
    || entry.sourceSha256 !== inventory.rawSha256
    || typeof manifest.banner !== 'string' || manifest.banner.length === 0
    || !code.startsWith(manifest.banner)
    || sha256(code.slice(manifest.banner.length)) !== entry.obfuscatedSha256
    || JSON.stringify(inventory.exports) !== JSON.stringify(ENGINE_NATIVE_RUNTIME_EXPORTS)
    || !Array.isArray(inventory.imports)
    || inventory.imports.some((specifier) => specifier !== 'yjs' && !builtins.has(specifier))
    || !Array.isArray(inventory.modules) || inventory.modules.length === 0
    || inventory.modules.some((module) => typeof module?.path !== 'string'
      || !module.path.startsWith('superdoc/v2/') || module.path.split('/').some((part) => part === '..' || part === '.')
      || module.path.includes('\\') || !/^[a-f0-9]{64}$/u.test(module.sourceSha256)
      || !Number.isSafeInteger(module.renderedLength) || module.renderedLength <= 0)
    || new Set(inventory.modules.map((module) => module.path)).size !== inventory.modules.length
  ) throw new Error('Protected native runtime does not match its origins, protection policy or export contract.');
  return { path: runtimePath, manifest, inventory };
}
