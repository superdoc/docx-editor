#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  assertEngineInputIdentity,
  canonicalJson,
  ENGINE_PRODUCER_RECEIPT_SCHEMA,
  hashEngineTree,
  observeEngineInputIdentity,
  readEngineProducerSelection,
} from './engine-prepared-input.mjs';
import {
  ARTIFACT_TREE_SCHEMA,
  artifactCanonicalSha256,
  canonicalArtifactJson,
} from './superdoc-artifact-store.mjs';
import {
  readPublicOutputSelection,
  sealPublicArtifactObject,
  verifyPublicOutputReceipt,
} from '../packages/superdoc/scripts/public-output-receipt.mjs';
import { verifyEngineConsumerArtifact } from './ci-docx-engine-artifact.mjs';
import {
  ENGINE_NATIVE_RUNTIME_ID,
  ENGINE_NATIVE_RUNTIME_DESTINATION,
  isEngineRuntimeOutputDestination,
} from './engine-native-runtime.mjs';

export const CI_SUPERDOC_BUILD_ARTIFACT_SCHEMA = 'superdoc-ci-build-artifact.v2';
export const CI_SUPERDOC_BUILD_ARCHIVE_SCHEMA = 'superdoc-ci-build-archive.v2';
export const CI_SUPERDOC_MATERIALIZATION_SCHEMA = 'superdoc-ci-build-materialization.v2';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digestPattern = /^[0-9a-f]{64}$/u;
const maximumExpandedArchiveBytes = 1024 * 1024 * 1024;
const archiveFileName = 'superdoc-build-artifact.json.gz';
const materializationDirectory = '.ci-superdoc-artifact';
const materializationReceiptName = 'materialized-receipt.json';

const baseComponentSpecs = Object.freeze([
  Object.freeze({ id: 'public-npm', payloadPath: 'payload/public-npm', destination: 'packages/superdoc/dist' }),
  Object.freeze({ id: 'public-cdn', payloadPath: 'payload/public-cdn', destination: 'packages/superdoc/dist-cdn' }),
  Object.freeze({
    id: 'public-receipt',
    payloadPath: 'payload/public-receipt',
    destination: 'packages/superdoc/build-receipts',
  }),
  Object.freeze({
    id: 'document-api',
    payloadPath: 'payload/document-api',
    destination: 'packages/document-api/dist',
  }),
  Object.freeze({ id: 'engine-consumer', payloadPath: 'payload/engine-consumer', destination: '.ci-docx-engine' }),
]);

export const CI_SUPERDOC_CLI_RUNTIME_OUTPUT_DESTINATIONS = Object.freeze({
  [ENGINE_NATIVE_RUNTIME_ID]: ENGINE_NATIVE_RUNTIME_DESTINATION,
  'leaf-document-compare': 'document-compare/dist',
  'leaf-editor-core': 'editor-core/dist',
  'leaf-collaboration-v2': 'collaboration-v2/dist',
  'leaf-document-api-v2-adapter': 'document-api-v2-adapter/dist',
  'leaf-headless': 'headless/dist',
  'leaf-collaboration-upgrade': 'collaboration-upgrade/dist',
});

const documentApiRequiredFiles = Object.freeze([
  'index.js',
  'index.d.ts',
  'types/index.js',
  'types/index.d.ts',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function assertRegularFile(filePath, label) {
  const state = lstatSync(filePath, { throwIfNoEntry: false });
  if (!state?.isFile() || state.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${filePath}.`);
  return state;
}

function assertPortablePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value === '.' ||
    value === '..' ||
    value.startsWith('../')
  ) {
    throw new Error(`${label} must be a normalized portable relative path.`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  if (canonicalArtifactJson(actual) !== canonicalArtifactJson(sortedExpected)) {
    throw new Error(`${label} has unsupported fields: ${actual.join(', ')}.`);
  }
}

function withDigest(body) {
  return { ...body, digest: artifactCanonicalSha256(body) };
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function collectTree(root) {
  const state = lstatSync(root, { throwIfNoEntry: false });
  if (!state?.isDirectory() || state.isSymbolicLink()) {
    throw new Error(`CI artifact component must be a regular directory: ${root}.`);
  }
  const directories = [];
  const files = [];
  const walk = (directory, parent = '') => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareUtf8(left.name, right.name),
    );
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = parent ? path.posix.join(parent, entry.name) : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`CI artifact component contains a symlink: ${absolute}.`);
      if (entry.isDirectory()) {
        directories.push(relative);
        walk(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        files.push({ path: relative, sha256: sha256(bytes), sizeBytes: bytes.byteLength, bytes });
      } else {
        throw new Error(`CI artifact component contains an unsupported entry: ${absolute}.`);
      }
    }
  };
  walk(root);
  return createCollectedTree(directories, files);
}

function collectSingleFile(relative, bytes) {
  assertPortablePath(relative, 'virtual component file');
  return createCollectedTree([], [{ path: relative, sha256: sha256(bytes), sizeBytes: bytes.byteLength, bytes }]);
}

function createCollectedTree(directories, files) {
  directories.sort(compareUtf8);
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const fileMetadata = files.map(({ path: filePath, sha256: fileDigest, sizeBytes }) => ({
    path: filePath,
    sha256: fileDigest,
    sizeBytes,
  }));
  const body = { schema: ARTIFACT_TREE_SCHEMA, directories, files: fileMetadata };
  return {
    tree: {
      ...body,
      digest: artifactCanonicalSha256(body),
      fileCount: fileMetadata.length,
      sizeBytes: fileMetadata.reduce((total, file) => total + file.sizeBytes, 0),
    },
    files,
  };
}

function validateTree(tree, label) {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) throw new Error(`${label} must be an object.`);
  assertExactKeys(tree, ['schema', 'directories', 'files', 'digest', 'fileCount', 'sizeBytes'], label);
  if (tree.schema !== ARTIFACT_TREE_SCHEMA || !Array.isArray(tree.directories) || !Array.isArray(tree.files)) {
    throw new Error(`${label} has an invalid tree shape.`);
  }
  const directories = new Set();
  for (const [index, relative] of tree.directories.entries()) {
    assertPortablePath(relative, `${label}.directories[${index}]`);
    if (directories.has(relative)) throw new Error(`${label} repeats directory ${relative}.`);
    directories.add(relative);
  }
  const files = new Set();
  let sizeBytes = 0;
  for (const [index, file] of tree.files.entries()) {
    assertExactKeys(file, ['path', 'sha256', 'sizeBytes'], `${label}.files[${index}]`);
    assertPortablePath(file.path, `${label}.files[${index}].path`);
    if (!digestPattern.test(file.sha256 ?? '') || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new Error(`${label}.files[${index}] has invalid content metadata.`);
    }
    if (files.has(file.path) || directories.has(file.path)) throw new Error(`${label} repeats path ${file.path}.`);
    files.add(file.path);
    sizeBytes += file.sizeBytes;
  }
  if (
    canonicalArtifactJson([...tree.directories].sort(compareUtf8)) !== canonicalArtifactJson(tree.directories) ||
    canonicalArtifactJson([...tree.files].sort((left, right) => compareUtf8(left.path, right.path))) !==
      canonicalArtifactJson(tree.files)
  ) {
    throw new Error(`${label} paths are not in canonical order.`);
  }
  const body = { schema: tree.schema, directories: tree.directories, files: tree.files };
  if (
    tree.digest !== artifactCanonicalSha256(body) ||
    tree.fileCount !== tree.files.length ||
    tree.sizeBytes !== sizeBytes
  ) {
    throw new Error(`${label} failed its exact-tree digest check.`);
  }
  return tree;
}

function assertDocumentApiComplete(root) {
  const missing = documentApiRequiredFiles.filter((relative) => {
    const state = lstatSync(path.join(root, ...relative.split('/')), { throwIfNoEntry: false });
    return !state?.isFile() || state.isSymbolicLink();
  });
  if (missing.length > 0) throw new Error(`Document API artifact is incomplete; missing ${missing.join(', ')}.`);
}

function runtimeOutputEntries(receipt) {
  const runtimeOutputs = receipt?.runtimeOutputs;
  if (!runtimeOutputs || typeof runtimeOutputs !== 'object' || Array.isArray(runtimeOutputs)) {
    throw new Error('Engine producer receipt has no sealed runtime output set.');
  }
  const entries = Object.entries(runtimeOutputs).sort(([left], [right]) => compareUtf8(left, right));
  if (entries.length === 0) throw new Error('Engine producer receipt has no sealed runtime output set.');
  for (const [id, output] of entries) {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new Error(`Engine producer receipt has an invalid runtime output ${id}.`);
    }
    assertExactKeys(output, ['digest', 'fileCount', 'sizeBytes', 'destination'], `engine runtime output ${id}`);
    const destination = assertPortablePath(output.destination, `engine runtime output ${id}.destination`);
    if (
      !isEngineRuntimeOutputDestination(id, destination) ||
      !digestPattern.test(output.digest ?? '') ||
      !Number.isSafeInteger(output.fileCount) ||
      output.fileCount < 1 ||
      !Number.isSafeInteger(output.sizeBytes) ||
      output.sizeBytes < 1
    ) {
      throw new Error(`Engine producer receipt has invalid content metadata for runtime output ${id}.`);
    }
  }
  return entries;
}

function componentSpecsForEngineReceipt(receipt) {
  return [
    ...baseComponentSpecs,
    ...runtimeOutputEntries(receipt).map(([id, output]) =>
      Object.freeze({
        id,
        payloadPath: path.posix.join('payload', 'engine-runtime', id),
        destination: path.posix.join('../v2', output.destination),
      }),
    ),
  ];
}

function resolveRuntimeOutputRoot(v2Root, id, output) {
  if (!isEngineRuntimeOutputDestination(id, output.destination)) throw new Error(`Engine runtime output ${id} does not match its destination.`);
  const root = path.resolve(v2Root, ...output.destination.split('/'));
  const relative = path.relative(v2Root, root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Engine runtime output ${id} resolves outside the engine root.`);
  }
  return root;
}

function resolveComponentDestination(workspaceRoot, v2Root, spec, engineProducerReceipt) {
  const output = engineProducerReceipt.runtimeOutputs[spec.id];
  if (!output) return path.resolve(workspaceRoot, spec.destination);
  const runtimeRoot = resolveRuntimeOutputRoot(v2Root, spec.id, output);
  if (runtimeRoot !== path.resolve(workspaceRoot, spec.destination)) {
    throw new Error(`CI SuperDoc runtime component ${spec.id} does not target the selected engine root.`);
  }
  return runtimeRoot;
}

function assertRuntimeTreeMatches(tree, output, id, label) {
  if (
    tree.digest !== output.digest ||
    tree.files.length !== output.fileCount ||
    tree.sizeBytes !== output.sizeBytes
  ) {
    throw new Error(`${label} ${id} does not match the engine producer receipt.`);
  }
}

export function assertCiSuperdocCliRuntimeClosure(engineProducerReceipt) {
  const missing = Object.entries(CI_SUPERDOC_CLI_RUNTIME_OUTPUT_DESTINATIONS)
    .filter(([id, destination]) => engineProducerReceipt?.runtimeOutputs?.[id]?.destination !== destination)
    .map(([id, destination]) => `${id} (${destination})`);
  if (missing.length > 0) {
    throw new Error(`CI SuperDoc artifact is missing sealed CLI runtime outputs: ${missing.join(', ')}.`);
  }
  return engineProducerReceipt;
}

function validateEngineProducerReceipt(receipt, expectedDigest) {
  if (receipt?.schema !== ENGINE_PRODUCER_RECEIPT_SCHEMA) {
    throw new Error(`Unsupported engine producer receipt schema: ${receipt?.schema}.`);
  }
  const { digest, ...body } = receipt;
  if (!digestPattern.test(digest ?? '') || digest !== sha256(canonicalJson(body)) || digest !== expectedDigest) {
    throw new Error('Engine producer receipt failed its digest binding.');
  }
  runtimeOutputEntries(receipt);
  assertCiSuperdocCliRuntimeClosure(receipt);
  return receipt;
}

function createManifest({ publicReceipt, engineReceipt, engineProducerReceipt, components }) {
  const componentSpecs = componentSpecsForEngineReceipt(engineProducerReceipt);
  const body = {
    schema: CI_SUPERDOC_BUILD_ARTIFACT_SCHEMA,
    package: publicReceipt.package,
    source: {
      publicProducerReceiptDigest: publicReceipt.digest,
      publicSourceIdentityDigest: publicReceipt.sourceIdentity.digest,
      publicSourceHeadSha: publicReceipt.sourceIdentity.headSha,
      engineProducerReceiptDigest: publicReceipt.engineInput.producerReceiptDigest,
      engineConsumerReceiptDigest: engineReceipt.digest,
      engineProducerReceipt,
    },
    recipe: {
      schema: 'superdoc-ci-build-artifact-recipe.v2',
      archive: CI_SUPERDOC_BUILD_ARCHIVE_SCHEMA,
      components: componentSpecs.map(({ id }) => id),
    },
    components: components.map(({ spec, collected }) => ({
      id: spec.id,
      payloadPath: spec.payloadPath,
      destination: spec.destination,
      tree: collected.tree,
    })),
  };
  return withDigest(body);
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('CI SuperDoc build manifest must be an object.');
  }
  assertExactKeys(manifest, ['schema', 'package', 'source', 'recipe', 'components', 'digest'], 'CI build manifest');
  const { digest, ...body } = manifest;
  if (
    manifest.schema !== CI_SUPERDOC_BUILD_ARTIFACT_SCHEMA ||
    !digestPattern.test(digest ?? '') ||
    digest !== artifactCanonicalSha256(body)
  ) {
    throw new Error('CI SuperDoc build manifest failed its schema or self-digest check.');
  }
  if (manifest.package?.name !== 'superdoc' || typeof manifest.package?.version !== 'string') {
    throw new Error('CI SuperDoc build manifest has an invalid package identity.');
  }
  assertExactKeys(manifest.package, ['name', 'version', 'manifestSha256'], 'CI build manifest package');
  if (!digestPattern.test(manifest.package.manifestSha256 ?? '')) {
    throw new Error('CI SuperDoc build manifest package digest is invalid.');
  }
  assertExactKeys(
    manifest.source,
    [
      'publicProducerReceiptDigest',
      'publicSourceIdentityDigest',
      'publicSourceHeadSha',
      'engineProducerReceiptDigest',
      'engineConsumerReceiptDigest',
      'engineProducerReceipt',
    ],
    'CI build manifest source binding',
  );
  for (const field of [
    'publicProducerReceiptDigest',
    'publicSourceIdentityDigest',
    'engineProducerReceiptDigest',
    'engineConsumerReceiptDigest',
  ]) {
    if (!digestPattern.test(manifest.source[field] ?? '')) throw new Error(`CI build manifest source.${field} is invalid.`);
  }
  const engineProducerReceipt = validateEngineProducerReceipt(
    manifest.source.engineProducerReceipt,
    manifest.source.engineProducerReceiptDigest,
  );
  const componentSpecs = componentSpecsForEngineReceipt(engineProducerReceipt);
  if (!/^[0-9a-f]{40,64}$/u.test(manifest.source.publicSourceHeadSha ?? '')) {
    throw new Error('CI build manifest source head is invalid.');
  }
  assertExactKeys(manifest.recipe, ['schema', 'archive', 'components'], 'CI build manifest recipe');
  if (
    manifest.recipe?.schema !== 'superdoc-ci-build-artifact-recipe.v2' ||
    manifest.recipe?.archive !== CI_SUPERDOC_BUILD_ARCHIVE_SCHEMA ||
    canonicalArtifactJson(manifest.recipe?.components) !== canonicalArtifactJson(componentSpecs.map(({ id }) => id))
  ) {
    throw new Error('CI SuperDoc build manifest uses an unsupported recipe.');
  }
  if (!Array.isArray(manifest.components) || manifest.components.length !== componentSpecs.length) {
    throw new Error('CI SuperDoc build manifest has an incomplete component set.');
  }
  for (const [index, spec] of componentSpecs.entries()) {
    const component = manifest.components[index];
    assertExactKeys(component, ['id', 'payloadPath', 'destination', 'tree'], `CI build component ${index}`);
    if (
      component.id !== spec.id ||
      component.payloadPath !== spec.payloadPath ||
      component.destination !== spec.destination
    ) {
      throw new Error(`CI SuperDoc build component ${index} violates its fixed path contract.`);
    }
    validateTree(component.tree, `CI build component ${spec.id}`);
  }
  return manifest;
}

function createArchiveObject(manifest, components) {
  const entries = [];
  for (const { spec, collected } of components) {
    for (const file of collected.files) {
      entries.push({
        path: path.posix.join(spec.payloadPath, file.path),
        content: file.bytes.toString('base64'),
      });
    }
  }
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  return { schema: CI_SUPERDOC_BUILD_ARCHIVE_SCHEMA, manifest, entries };
}

function decodeArchive(bytes) {
  let archive;
  try {
    archive = JSON.parse(gunzipSync(bytes, { maxOutputLength: maximumExpandedArchiveBytes }).toString('utf8'));
  } catch (error) {
    throw new Error(`CI SuperDoc build archive is unreadable: ${error.message}`);
  }
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) throw new Error('CI build archive must be an object.');
  assertExactKeys(archive, ['schema', 'manifest', 'entries'], 'CI build archive');
  if (archive.schema !== CI_SUPERDOC_BUILD_ARCHIVE_SCHEMA || !Array.isArray(archive.entries)) {
    throw new Error('CI SuperDoc build archive has an unsupported schema.');
  }
  const manifest = validateManifest(archive.manifest);
  const expectedFiles = new Map();
  for (const component of manifest.components) {
    for (const file of component.tree.files) {
      expectedFiles.set(path.posix.join(component.payloadPath, file.path), file);
    }
  }
  const decoded = new Map();
  let previousPath = null;
  for (const [index, entry] of archive.entries.entries()) {
    assertExactKeys(entry, ['path', 'content'], `CI build archive entry ${index}`);
    assertPortablePath(entry.path, `CI build archive entry ${index}.path`);
    if (previousPath !== null && compareUtf8(previousPath, entry.path) >= 0) {
      throw new Error('CI SuperDoc build archive entries are duplicated or not canonically ordered.');
    }
    previousPath = entry.path;
    const expected = expectedFiles.get(entry.path);
    if (!expected || typeof entry.content !== 'string') throw new Error(`CI build archive has unexpected entry ${entry.path}.`);
    const content = Buffer.from(entry.content, 'base64');
    if (content.toString('base64') !== entry.content) throw new Error(`CI build archive entry ${entry.path} is not canonical base64.`);
    if (content.byteLength !== expected.sizeBytes || sha256(content) !== expected.sha256) {
      throw new Error(`CI build archive entry ${entry.path} failed its content hash check.`);
    }
    decoded.set(entry.path, content);
  }
  if (decoded.size !== expectedFiles.size) {
    const missing = [...expectedFiles.keys()].filter((entry) => !decoded.has(entry));
    throw new Error(`CI SuperDoc build archive is incomplete; missing ${missing.join(', ')}.`);
  }
  return { archive, decoded, manifest };
}

function readArchive(archivePath) {
  assertRegularFile(archivePath, 'CI SuperDoc build archive');
  return decodeArchive(readFileSync(archivePath));
}

function writeDecodedComponent(root, component, decoded) {
  mkdirSync(root, { recursive: true });
  for (const relative of component.tree.directories) mkdirSync(path.join(root, ...relative.split('/')), { recursive: true });
  for (const file of component.tree.files) {
    const destination = path.join(root, ...file.path.split('/'));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, decoded.get(path.posix.join(component.payloadPath, file.path)), { flag: 'wx' });
  }
  const sealed = sealPublicArtifactObject(root);
  if (
    sealed.digest !== component.tree.digest ||
    sealed.fileCount !== component.tree.fileCount ||
    sealed.sizeBytes !== component.tree.sizeBytes
  ) {
    throw new Error(`Staged CI build component ${component.id} failed exact-tree verification.`);
  }
}

function verifyStagedComponents({ workspaceRoot, stagingRoots, manifest, v2Root }) {
  const byId = new Map(manifest.components.map((component) => [component.id, component]));
  const receiptPath = path.join(stagingRoots.get('public-receipt'), 'public-producer-receipt.json');
  const publicReceipt = verifyPublicOutputReceipt({
    packageRoot: path.join(workspaceRoot, 'packages', 'superdoc'),
    v2Root,
    requiredSurfaces: ['npm', 'cdn'],
    surfaceRoots: {
      npm: stagingRoots.get('public-npm'),
      cdn: stagingRoots.get('public-cdn'),
    },
    receiptPath,
    verifyEngineInput: false,
  });
  if (
    publicReceipt.digest !== manifest.source.publicProducerReceiptDigest ||
    publicReceipt.sourceIdentity.digest !== manifest.source.publicSourceIdentityDigest ||
    publicReceipt.sourceIdentity.headSha !== manifest.source.publicSourceHeadSha ||
    publicReceipt.engineInput.mode !== 'prepared' ||
    publicReceipt.engineInput.producerReceiptDigest !== manifest.source.engineProducerReceiptDigest
  ) {
    throw new Error('CI build archive public producer/source binding does not match its manifest.');
  }
  assertDocumentApiComplete(stagingRoots.get('document-api'));
  const engine = verifyEngineConsumerArtifact({
    root: stagingRoots.get('engine-consumer'),
    expectedProducerReceiptDigest: publicReceipt.engineInput.producerReceiptDigest,
  });
  if (engine.receipt.digest !== manifest.source.engineConsumerReceiptDigest) {
    throw new Error('CI build archive engine consumer receipt does not match its manifest.');
  }
  const engineProducerReceipt = validateEngineProducerReceipt(
    manifest.source.engineProducerReceipt,
    publicReceipt.engineInput.producerReceiptDigest,
  );
  assertEngineInputIdentity(engineProducerReceipt.inputIdentity, observeEngineInputIdentity({ v2Root }));
  for (const [id, output] of runtimeOutputEntries(engineProducerReceipt)) {
    const root = stagingRoots.get(id);
    if (!root) throw new Error(`CI build archive is missing runtime component ${id}.`);
    assertRuntimeTreeMatches(hashEngineTree(root), output, id, 'CI build archive runtime');
  }
  for (const [id, component] of byId) {
    const sealed = sealPublicArtifactObject(stagingRoots.get(id));
    if (sealed.digest !== component.tree.digest) throw new Error(`CI build archive component ${id} changed during verification.`);
  }
  return { engine, publicReceipt };
}

function markerPathFor(workspaceRoot) {
  return path.join(workspaceRoot, materializationDirectory, materializationReceiptName);
}

function buildMaterializationReceipt(manifest) {
  return withDigest({
    schema: CI_SUPERDOC_MATERIALIZATION_SCHEMA,
    artifactDigest: manifest.digest,
    publicProducerReceiptDigest: manifest.source.publicProducerReceiptDigest,
    publicSourceIdentityDigest: manifest.source.publicSourceIdentityDigest,
    engineProducerReceiptDigest: manifest.source.engineProducerReceiptDigest,
    engineProducerReceipt: manifest.source.engineProducerReceipt,
    components: manifest.components.map((component) => ({ id: component.id, treeDigest: component.tree.digest })),
  });
}

function readMaterializationReceipt(receiptPath) {
  assertRegularFile(receiptPath, 'CI SuperDoc materialization receipt');
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    throw new Error(`CI SuperDoc materialization receipt is unreadable: ${error.message}`);
  }
  if (receipt?.schema !== CI_SUPERDOC_MATERIALIZATION_SCHEMA) {
    throw new Error(`Unsupported CI SuperDoc materialization receipt schema: ${receipt?.schema}.`);
  }
  assertExactKeys(
    receipt,
    [
      'schema',
      'artifactDigest',
      'publicProducerReceiptDigest',
      'publicSourceIdentityDigest',
      'engineProducerReceiptDigest',
      'engineProducerReceipt',
      'components',
      'digest',
    ],
    'CI SuperDoc materialization receipt',
  );
  const { digest, ...body } = receipt;
  if (!digestPattern.test(digest ?? '') || digest !== artifactCanonicalSha256(body)) {
    throw new Error('CI SuperDoc materialization receipt failed its self-digest check.');
  }
  const engineProducerReceipt = validateEngineProducerReceipt(
    receipt.engineProducerReceipt,
    receipt.engineProducerReceiptDigest,
  );
  const componentSpecs = componentSpecsForEngineReceipt(engineProducerReceipt);
  if (
    !digestPattern.test(receipt.artifactDigest ?? '') ||
    !digestPattern.test(receipt.publicProducerReceiptDigest ?? '') ||
    !digestPattern.test(receipt.publicSourceIdentityDigest ?? '') ||
    !digestPattern.test(receipt.engineProducerReceiptDigest ?? '') ||
    !Array.isArray(receipt.components) ||
    canonicalArtifactJson(receipt.components.map(({ id }) => id)) !==
      canonicalArtifactJson(componentSpecs.map(({ id }) => id))
  ) {
    throw new Error('CI SuperDoc materialization receipt has an invalid shape.');
  }
  for (const component of receipt.components) {
    assertExactKeys(component, ['id', 'treeDigest'], 'CI materialization component');
    if (!digestPattern.test(component.treeDigest ?? '')) throw new Error('CI materialization component digest is invalid.');
  }
  return receipt;
}

export function defaultCiSuperdocArchivePath(workspaceRoot = publicRoot) {
  return path.join(workspaceRoot, archiveFileName);
}

export function defaultCiSuperdocMaterializationReceiptPath(workspaceRoot = publicRoot) {
  return markerPathFor(workspaceRoot);
}

export function packCiSuperdocBuildArtifact({
  workspaceRoot = publicRoot,
  packageRoot = path.join(workspaceRoot, 'packages', 'superdoc'),
  v2Root = path.resolve(workspaceRoot, '..', 'v2'),
  documentApiRoot = path.join(workspaceRoot, 'packages', 'document-api', 'dist'),
  engineArtifactRoot = path.join(workspaceRoot, '.ci-docx-engine'),
  archivePath = defaultCiSuperdocArchivePath(workspaceRoot),
  env = process.env,
  checkpoint = () => {},
} = {}) {
  const selection = readPublicOutputSelection({ packageRoot });
  const publicReceipt = verifyPublicOutputReceipt({
    packageRoot,
    v2Root,
    requiredSurfaces: ['npm', 'cdn'],
    surfaceRoots: selection.surfaceRoots,
    receiptPath: selection.receiptPath,
    env,
  });
  if (publicReceipt.target !== 'all' || publicReceipt.engineInput.mode !== 'prepared') {
    throw new Error('CI SuperDoc build artifact requires a complete prepared-engine public producer receipt.');
  }
  assertDocumentApiComplete(documentApiRoot);
  const engine = verifyEngineConsumerArtifact({
    root: engineArtifactRoot,
    expectedProducerReceiptDigest: publicReceipt.engineInput.producerReceiptDigest,
  });
  const engineSelection = readEngineProducerSelection(v2Root);
  const engineProducerReceipt = validateEngineProducerReceipt(
    engineSelection.receipt,
    publicReceipt.engineInput.producerReceiptDigest,
  );
  const runtimeSources = new Map();
  for (const [id, output] of runtimeOutputEntries(engineProducerReceipt)) {
    const root = engineSelection.runtimeRoots[id];
    if (!root) throw new Error(`Prepared engine selection has no sealed runtime root for ${id}.`);
    assertRuntimeTreeMatches(hashEngineTree(root), output, id, 'Prepared engine runtime');
    runtimeSources.set(id, collectTree(root));
  }
  const receiptBytes = readFileSync(selection.receiptPath);
  const componentSources = new Map([
    ['public-npm', collectTree(selection.surfaceRoots.npm)],
    ['public-cdn', collectTree(selection.surfaceRoots.cdn)],
    ['public-receipt', collectSingleFile('public-producer-receipt.json', receiptBytes)],
    ['document-api', collectTree(documentApiRoot)],
    ['engine-consumer', collectTree(engineArtifactRoot)],
    ...runtimeSources,
  ]);
  const componentSpecs = componentSpecsForEngineReceipt(engineProducerReceipt);
  const components = componentSpecs.map((spec) => ({ spec, collected: componentSources.get(spec.id) }));
  const manifest = createManifest({
    publicReceipt,
    engineReceipt: engine.receipt,
    engineProducerReceipt,
    components,
  });
  const archiveObject = createArchiveObject(manifest, components);
  const archiveBytes = gzipSync(Buffer.from(JSON.stringify(archiveObject)), { level: 9 });
  checkpoint('before-write');
  const temporaryPath = `${archivePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(path.dirname(archivePath), { recursive: true });
    writeFileSync(temporaryPath, archiveBytes, { flag: 'wx' });
    const verified = readArchive(temporaryPath);
    if (verified.manifest.digest !== manifest.digest) throw new Error('Written CI build archive changed before promotion.');
    checkpoint('before-promote');
    renameSync(temporaryPath, archivePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { archivePath, manifest };
}

export function materializeCiSuperdocBuildArtifact({
  workspaceRoot = publicRoot,
  v2Root = path.resolve(workspaceRoot, '..', 'v2'),
  archivePath = defaultCiSuperdocArchivePath(workspaceRoot),
  checkpoint = () => {},
} = {}) {
  const { decoded, manifest } = readArchive(archivePath);
  checkpoint('after-archive-verify');
  const temporaryParent = path.join(workspaceRoot, '.tmp');
  mkdirSync(temporaryParent, { recursive: true });
  const temporaryRoot = mkdtempSync(path.join(temporaryParent, 'ci-superdoc-materialize-'));
  const stagingRoots = new Map();
  const promotions = [];
  const engineProducerReceipt = manifest.source.engineProducerReceipt;
  let materializedReceipt;
  try {
    for (const component of manifest.components) {
      const candidate = path.join(temporaryRoot, 'components', component.id);
      writeDecodedComponent(candidate, component, decoded);
      stagingRoots.set(component.id, candidate);
      promotions.push({
        id: component.id,
        candidate,
        destination: resolveComponentDestination(workspaceRoot, v2Root, component, engineProducerReceipt),
      });
    }
    verifyStagedComponents({ workspaceRoot, stagingRoots, manifest, v2Root });
    const markerCandidate = path.join(temporaryRoot, 'marker');
    writeJsonAtomic(path.join(markerCandidate, materializationReceiptName), buildMaterializationReceipt(manifest));
    promotions.push({
      id: 'materialization-receipt',
      candidate: markerCandidate,
      destination: path.join(workspaceRoot, materializationDirectory),
    });
    checkpoint('after-stage-verify');

    const promoted = [];
    try {
      for (const promotion of promotions) {
        const backup = path.join(temporaryRoot, 'backups', promotion.id);
        mkdirSync(path.dirname(backup), { recursive: true });
        const hadPrevious = existsSync(promotion.destination);
        if (hadPrevious) renameSync(promotion.destination, backup);
        const state = { ...promotion, backup, hadPrevious, installed: false };
        promoted.push(state);
        checkpoint(`after-backup:${promotion.id}`);
        mkdirSync(path.dirname(promotion.destination), { recursive: true });
        renameSync(promotion.candidate, promotion.destination);
        state.installed = true;
        checkpoint(`after-promote:${promotion.id}`);
      }
      materializedReceipt = verifyCiSuperdocMaterialization({
        workspaceRoot,
        v2Root,
        expectedDigest: manifest.digest,
        receiptPath: markerPathFor(workspaceRoot),
      });
      checkpoint('after-post-verify');
      checkpoint('before-commit');
      for (const promotion of promoted) {
        try {
          rmSync(promotion.backup, { recursive: true, force: true });
        } catch {
          // The verified new set is committed; stale backups are disposable.
        }
      }
    } catch (error) {
      for (const promotion of promoted.reverse()) {
        if (promotion.installed) rmSync(promotion.destination, { recursive: true, force: true });
        if (promotion.hadPrevious && existsSync(promotion.backup)) renameSync(promotion.backup, promotion.destination);
      }
      throw error;
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  const receiptPath = markerPathFor(workspaceRoot);
  return { manifest, receipt: materializedReceipt, receiptPath };
}

export function verifyCiSuperdocMaterialization({
  workspaceRoot = publicRoot,
  v2Root = path.resolve(workspaceRoot, '..', 'v2'),
  expectedDigest,
  receiptPath = markerPathFor(workspaceRoot),
} = {}) {
  if (!digestPattern.test(expectedDigest ?? '')) {
    throw new Error('A lowercase SHA-256 CI SuperDoc artifact digest is required.');
  }
  const receipt = readMaterializationReceipt(receiptPath);
  if (receipt.artifactDigest !== expectedDigest) {
    throw new Error('Restored CI SuperDoc artifact digest does not match the required digest.');
  }
  const componentDigests = new Map(receipt.components.map((component) => [component.id, component.treeDigest]));
  const engineProducerReceipt = validateEngineProducerReceipt(
    receipt.engineProducerReceipt,
    receipt.engineProducerReceiptDigest,
  );
  const componentSpecs = componentSpecsForEngineReceipt(engineProducerReceipt);
  for (const spec of componentSpecs) {
    const root = resolveComponentDestination(workspaceRoot, v2Root, spec, engineProducerReceipt);
    const sealed = sealPublicArtifactObject(root);
    if (sealed.digest !== componentDigests.get(spec.id)) {
      throw new Error(`Restored CI SuperDoc component ${spec.id} does not match its materialization receipt.`);
    }
  }
  const packageRoot = path.join(workspaceRoot, 'packages', 'superdoc');
  const publicReceiptPath = path.join(packageRoot, 'build-receipts', 'public-producer-receipt.json');
  const publicReceipt = verifyPublicOutputReceipt({
    packageRoot,
    v2Root,
    requiredSurfaces: ['npm', 'cdn'],
    receiptPath: publicReceiptPath,
    verifyEngineInput: false,
  });
  if (
    publicReceipt.digest !== receipt.publicProducerReceiptDigest ||
    publicReceipt.sourceIdentity.digest !== receipt.publicSourceIdentityDigest ||
    publicReceipt.engineInput.mode !== 'prepared' ||
    publicReceipt.engineInput.producerReceiptDigest !== receipt.engineProducerReceiptDigest
  ) {
    throw new Error('Restored CI SuperDoc public receipt does not match the materialization receipt.');
  }
  assertEngineInputIdentity(engineProducerReceipt.inputIdentity, observeEngineInputIdentity({ v2Root }));
  for (const [id, output] of runtimeOutputEntries(engineProducerReceipt)) {
    const root = resolveRuntimeOutputRoot(v2Root, id, output);
    assertRuntimeTreeMatches(hashEngineTree(root), output, id, 'Restored engine runtime');
  }
  assertDocumentApiComplete(path.join(workspaceRoot, 'packages', 'document-api', 'dist'));
  verifyEngineConsumerArtifact({
    root: path.join(workspaceRoot, '.ci-docx-engine'),
    expectedProducerReceiptDigest: receipt.engineProducerReceiptDigest,
  });
  return receipt;
}

export function runWithCiSuperdocMaterialization({
  workspaceRoot = publicRoot,
  v2Root = path.resolve(workspaceRoot, '..', 'v2'),
  command,
  env = process.env,
  run = spawnSync,
} = {}) {
  if (!Array.isArray(command) || command.length === 0) throw new Error('Restored-artifact command is required.');
  const receiptPath = markerPathFor(workspaceRoot);
  const marker = readMaterializationReceipt(receiptPath);
  verifyCiSuperdocMaterialization({ workspaceRoot, v2Root, expectedDigest: marker.artifactDigest, receiptPath });
  const result = run(command[0], command.slice(1), {
    cwd: workspaceRoot,
    stdio: 'inherit',
    env: {
      ...env,
      SUPERDOC_CLI_REQUIRE_PREBUILT_INPUTS: 'restored',
      SUPERDOC_CLI_RESTORED_ARTIFACT_DIGEST: marker.artifactDigest,
    },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function resolveCliArchivePath(argv) {
  if (argv.length === 0) return defaultCiSuperdocArchivePath();
  if (argv.length === 2 && argv[0] === '--archive') return path.resolve(publicRoot, argv[1]);
  throw new Error('Expected optional --archive <path>.');
}

export function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'pack') {
    const result = packCiSuperdocBuildArtifact({ archivePath: resolveCliArchivePath(args) });
    process.stdout.write(`${result.manifest.digest}\n`);
    return 0;
  }
  if (command === 'materialize') {
    const result = materializeCiSuperdocBuildArtifact({ archivePath: resolveCliArchivePath(args) });
    process.stdout.write(`${result.manifest.digest}\n`);
    return 0;
  }
  if (command === 'run') {
    const separator = args[0] === '--' ? 1 : 0;
    return runWithCiSuperdocMaterialization({ command: args.slice(separator) });
  }
  throw new Error(
    'Usage: node scripts/ci-superdoc-build-artifact.mjs <pack|materialize> [--archive <path>] | run -- <command ...>',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
