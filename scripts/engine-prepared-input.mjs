// engine-prepared-input.mjs - explicit installed-versus-prepared engine input contracts.
//
// The public `superdoc` package consumes `@superdoc/docx-engine` through exactly
// two verified input contracts:
//
//   installed  An exported public checkout or registry consumer resolves the
//              packaged engine through node_modules. Verification binds the
//              exact declared dependency version, the packaged manifest, and
//              per-file content hashes.
//
//   prepared   An Orbit checkout consumes the locally built engine component.
//              Verification requires a producer receipt written by the one
//              authorized engine build, an exact-tree hash match for each
//              consumed surface, and the exact package version.
//
// Selection is explicit (SUPERDOC_ENGINE_INPUT) with a topology-derived
// default; verification is never skipped in package mode. File existence is
// not a valid readiness state: a dist tree without a matching producer receipt
// fails closed with the one canonical preparation command.

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isEngineRuntimeOutputDestination } from './engine-native-runtime.mjs';

export const ENGINE_PACKAGE_NAME = '@superdoc/docx-engine';
export const ENGINE_PRODUCER_RECEIPT_SCHEMA = 'superdoc-engine-producer-receipt.v1';
export const ENGINE_BUILD_AUTHORITY_SCHEMA = 'superdoc-engine-build-authority.v1';
export const ENGINE_INPUT_ENV = 'SUPERDOC_ENGINE_INPUT';
export const ENGINE_EXPECTED_RECEIPT_DIGEST_ENV = 'SUPERDOC_ENGINE_EXPECTED_RECEIPT_DIGEST';
export const BUILD_ORCHESTRATED_ENV = 'SUPERDOC_BUILD_ORCHESTRATED';
export const ENGINE_BUILD_AUTHORITY_FILE_ENV = 'SUPERDOC_ENGINE_BUILD_AUTHORITY_FILE';
export const ENGINE_INPUT_IDENTITY_SCHEMA = 'superdoc-engine-input-identity.v2';
export const SOURCE_CONTENT_IDENTITY_SCHEMA = 'superdoc-source-content-identity.v1';

export const ENGINE_INPUT_MODES = Object.freeze(['installed', 'prepared']);

// The one canonical preparation command. Every fail-closed consumer error
// names this command; no consumer invents its own recursive remediation.
export const ENGINE_PREPARE_COMMAND = 'pnpm run prepare:engine (from the Orbit repository root)';

export class EngineInputError extends Error {
  constructor(message, { code = 'engine-input', remediation = null } = {}) {
    super(remediation ? `${message}\nRemediation: ${remediation}` : message);
    this.name = 'EngineInputError';
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const ENGINE_INPUT_PATHS = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'superdoc/package.json',
  'superdoc/pnpm-lock.yaml',
  'superdoc/pnpm-workspace.yaml',
  'superdoc/v2',
  'superdoc/public/package.json',
  'superdoc/public/pnpm-lock.yaml',
  'superdoc/public/pnpm-workspace.yaml',
  'superdoc/public/scripts/audit-publish-artifact.mjs',
  'superdoc/public/scripts/engine-prepared-input.mjs',
  'superdoc/public/scripts/engine-native-runtime.mjs',
  'superdoc/public/scripts/superdoc-artifact-store.mjs',
  'superdoc/public/scripts/superdoc-build-timing.mjs',
  'superdoc/public/packages/document-api',
  'superdoc/public/packages/layout-engine',
  'superdoc/public/packages/preset-geometry',
  'superdoc/public/packages/word-layout',
  'superdoc/public/shared',
]);

function runGit(repoRoot, args, { encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new EngineInputError(
      `cannot establish the prepared engine input identity: git ${args.join(' ')} failed (${String(result.stderr ?? '').trim()})`,
      { code: 'engine-input-identity', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  return result.stdout;
}

const CONTENT_IDENTITY_EXCLUDED_DIRECTORIES = new Set([
  '.build-artifacts',
  '.cache',
  '.git',
  '.turbo',
  '.vite',
  'artifacts',
  'build-receipts',
  'build-timing',
  'coverage',
  'dist',
  'dist-cdn',
  'dist-native',
  'node_modules',
  'tmp',
]);

function contentIdentityFileIsExcluded(name) {
  return (
    name === '.DS_Store' ||
    name.endsWith('.log') ||
    name.endsWith('.tgz') ||
    name.endsWith('.tsbuildinfo')
  );
}

function normalizeInputPath(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) {
    throw new EngineInputError(`source identity input path must be relative: ${relative}`, {
      code: 'engine-input-identity',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const normalized = path.normalize(relative || '.');
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new EngineInputError(`source identity input path escapes its root: ${relative}`, {
      code: 'engine-input-identity',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  return normalized;
}

export function hashSourceInputClosure({ root, inputPaths, label = 'source' }) {
  const requestedRoot = path.resolve(root);
  const rootInfo = lstatSync(requestedRoot, { throwIfNoEntry: false });
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new EngineInputError(`${label} identity root must be a regular directory: ${requestedRoot}`, {
      code: 'engine-input-identity',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const resolvedRoot = realpathSync(requestedRoot);

  const inputs = [];
  const filesByPath = new Map();
  const linksByPath = new Map();
  const addFile = (absolute) => {
    const relative = path.relative(resolvedRoot, absolute).split(path.sep).join('/');
    const bytes = readFileSync(absolute);
    filesByPath.set(relative, { path: relative, sha256: sha256(bytes), sizeBytes: bytes.byteLength });
  };
  const addLink = (absolute) => {
    const target = readlinkSync(absolute);
    let resolvedTarget;
    try {
      resolvedTarget = realpathSync(path.resolve(path.dirname(absolute), target));
    } catch (error) {
      throw new EngineInputError(`broken symlink in ${label} input closure: ${absolute} (${error.message})`, {
        code: 'engine-input-identity',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    const resolvedRelative = path.relative(resolvedRoot, resolvedTarget);
    if (
      resolvedRelative === '..' ||
      resolvedRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelative)
    ) {
      throw new EngineInputError(`symlink escapes the ${label} input root: ${absolute} -> ${target}`, {
        code: 'engine-input-identity',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    const relative = path.relative(resolvedRoot, absolute).split(path.sep).join('/');
    linksByPath.set(relative, {
      path: relative,
      target: target.split(path.sep).join('/'),
      resolvedPath: resolvedRelative.split(path.sep).join('/'),
    });
  };
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (
        CONTENT_IDENTITY_EXCLUDED_DIRECTORIES.has(entry.name) &&
        (entry.isDirectory() || entry.isSymbolicLink())
      ) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        addLink(absolute);
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        if (!contentIdentityFileIsExcluded(entry.name)) addFile(absolute);
      } else {
        throw new EngineInputError(`unexpected filesystem entry in ${label} input closure: ${absolute}`, {
          code: 'engine-input-identity',
          remediation: ENGINE_PREPARE_COMMAND,
        });
      }
    }
  };

  for (const requested of [...new Set(inputPaths)].sort(compareUtf8)) {
    const normalized = normalizeInputPath(requested);
    const absolute = path.resolve(resolvedRoot, normalized);
    const relative = path.relative(resolvedRoot, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new EngineInputError(`${label} identity input escapes its root: ${requested}`, {
        code: 'engine-input-identity',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    const info = lstatSync(absolute, { throwIfNoEntry: false });
    const normalizedPosix = (relative || '.').split(path.sep).join('/');
    if (!info) {
      inputs.push({ path: normalizedPosix, type: 'missing' });
    } else if (info.isSymbolicLink()) {
      inputs.push({ path: normalizedPosix, type: 'symlink' });
      addLink(absolute);
    } else if (info.isDirectory()) {
      inputs.push({ path: normalizedPosix, type: 'directory' });
      walk(absolute);
    } else if (info.isFile()) {
      inputs.push({ path: normalizedPosix, type: 'file' });
      if (!contentIdentityFileIsExcluded(path.basename(absolute))) addFile(absolute);
    } else {
      throw new EngineInputError(`unexpected filesystem entry in ${label} input closure: ${absolute}`, {
        code: 'engine-input-identity',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
  }

  const files = [...filesByPath.values()].sort((left, right) => compareUtf8(left.path, right.path));
  const links = [...linksByPath.values()].sort((left, right) => compareUtf8(left.path, right.path));
  const body = { schema: SOURCE_CONTENT_IDENTITY_SCHEMA, inputs, files, links };
  return {
    digest: sha256Canonical(body),
    fileCount: files.length,
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    files,
  };
}

function resolveGitRoot(startDirectory) {
  const result = spawnSync('git', ['-C', startDirectory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return null;
  return path.resolve(result.stdout.trim());
}

/**
 * Bind prepared output to the exact checkout inputs that can change engine
 * bytes. HEAD alone is insufficient because local builds commonly run from a
 * dirty tree; the tracked diff and every relevant untracked file are hashed.
 */
export function observeEngineInputIdentity({ v2Root, repoRoot = path.resolve(v2Root, '../..') }) {
  const gitRoot = resolveGitRoot(repoRoot);
  if (!gitRoot) {
    const closure = hashSourceInputClosure({ root: repoRoot, inputPaths: ENGINE_INPUT_PATHS, label: 'engine' });
    const body = {
      schema: ENGINE_INPUT_IDENTITY_SCHEMA,
      mode: 'content',
      contentDigest: closure.digest,
      fileCount: closure.fileCount,
      sizeBytes: closure.sizeBytes,
    };
    return { ...body, digest: sha256Canonical(body) };
  }
  const headSha = runGit(gitRoot, ['rev-parse', 'HEAD']).trim();
  const trackedDiff = runGit(gitRoot, ['diff', '--binary', 'HEAD', '--', ...ENGINE_INPUT_PATHS], {
    encoding: null,
  });
  const untrackedOutput = runGit(
    gitRoot,
    ['ls-files', '--others', '--exclude-standard', '-z', '--', ...ENGINE_INPUT_PATHS],
    { encoding: 'utf8' },
  );
  const untracked = untrackedOutput
    .split('\0')
    .filter(Boolean)
    .sort(compareUtf8)
    .map((relative) => {
      const absolute = path.resolve(gitRoot, relative);
      const info = lstatSync(absolute, { throwIfNoEntry: false });
      if (!info?.isFile() || info.isSymbolicLink()) {
        throw new EngineInputError(`unexpected untracked engine input entry: ${relative}`, {
          code: 'engine-input-identity',
          remediation: ENGINE_PREPARE_COMMAND,
        });
      }
      const bytes = readFileSync(absolute);
      return { path: relative.split(path.sep).join('/'), sha256: sha256(bytes), sizeBytes: bytes.byteLength };
    });
  const body = {
    schema: ENGINE_INPUT_IDENTITY_SCHEMA,
    mode: 'git',
    headSha,
    trackedDiffSha256: sha256(trackedDiff),
    untracked,
  };
  return { ...body, digest: sha256Canonical(body) };
}

export function assertEngineInputIdentity(receiptIdentity, currentIdentity) {
  if (receiptIdentity?.schema !== ENGINE_INPUT_IDENTITY_SCHEMA || !receiptIdentity?.digest) {
    throw new EngineInputError('engine producer receipt has no supported build-input identity', {
      code: 'engine-input-identity-missing',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const { digest, ...unsigned } = receiptIdentity;
  if (digest !== sha256Canonical(unsigned)) {
    throw new EngineInputError('engine producer receipt build-input identity failed its self-digest check', {
      code: 'engine-input-identity-digest',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const validGitIdentity =
    receiptIdentity.mode === 'git' &&
    /^[a-f0-9]{40,64}$/u.test(receiptIdentity.headSha ?? '') &&
    /^[a-f0-9]{64}$/u.test(receiptIdentity.trackedDiffSha256 ?? '') &&
    Array.isArray(receiptIdentity.untracked);
  const validContentIdentity =
    receiptIdentity.mode === 'content' &&
    /^[a-f0-9]{64}$/u.test(receiptIdentity.contentDigest ?? '') &&
    Number.isSafeInteger(receiptIdentity.fileCount) &&
    receiptIdentity.fileCount >= 0 &&
    Number.isSafeInteger(receiptIdentity.sizeBytes) &&
    receiptIdentity.sizeBytes >= 0;
  if (!validGitIdentity && !validContentIdentity) {
    throw new EngineInputError('engine producer receipt build-input identity has an invalid shape', {
      code: 'engine-input-identity',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  if (currentIdentity?.digest !== digest) {
    throw new EngineInputError(
      `prepared engine input identity ${digest} does not match the current checkout ${currentIdentity?.digest ?? 'unknown'}`,
      { code: 'engine-input-stale', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
}

/** Stable key-sorted JSON so digests do not depend on property order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * List every regular file under `root` as sorted POSIX-relative paths.
 * Symlinks and unexpected filesystem entries fail exact-tree verification.
 */
export function listTreeFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new EngineInputError(`unexpected symlink in engine tree: ${absolute}`, { code: 'engine-tree-symlink' });
      }
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
      else throw new EngineInputError(`unexpected filesystem entry in engine tree: ${absolute}`, { code: 'engine-tree-entry' });
    }
  };
  walk(root);
  return files.sort(compareUtf8);
}

/**
 * Exact-tree hash of a directory: every file, sorted, content-hashed.
 * Returns `{ files: [{path, sha256, sizeBytes}], digest, sizeBytes }`.
 */
export function hashEngineTree(root) {
  if (lstatSync(root, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new EngineInputError(`engine tree root must not be a symlink: ${root}`, { code: 'engine-tree-symlink' });
  }
  const files = listTreeFiles(root).map((relative) => {
    const data = readFileSync(path.join(root, ...relative.split('/')));
    return { path: relative, sha256: sha256(data), sizeBytes: data.byteLength };
  });
  return {
    files,
    digest: sha256Canonical(files),
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

function hashArtifactStoreObject(root) {
  const directories = [];
  const files = [];
  const walk = (directory, parent = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = parent ? path.posix.join(parent, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        throw new EngineInputError(`unexpected symlink in immutable engine object: ${absolute}`, {
          code: 'engine-pointer-object',
          remediation: ENGINE_PREPARE_COMMAND,
        });
      }
      if (entry.isDirectory()) {
        directories.push(relative);
        walk(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        files.push({ path: relative, sha256: sha256(bytes), sizeBytes: bytes.byteLength });
      } else {
        throw new EngineInputError(`unexpected entry in immutable engine object: ${absolute}`, {
          code: 'engine-pointer-object',
          remediation: ENGINE_PREPARE_COMMAND,
        });
      }
    }
  };
  walk(root);
  directories.sort(compareUtf8);
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return sha256Canonical({ schema: 'superdoc-artifact-tree.v1', directories, files });
}

export function engineProducerReceiptPath(v2Root) {
  return path.join(v2Root, 'build-receipts', 'engine-producer-receipt.json');
}

export function engineArtifactStoreRoot(v2Root) {
  return path.join(v2Root, '.build-artifacts', 'engine');
}

export function quarantineInvalidEngineProducerSelection(v2Root, error) {
  const storeRoot = engineArtifactStoreRoot(v2Root);
  const pointerPath = path.join(storeRoot, 'pointers', 'current.json');
  const receiptPath = engineProducerReceiptPath(v2Root);
  const sourcePath = existsSync(pointerPath) ? pointerPath : receiptPath;
  if (!existsSync(sourcePath)) return null;

  const quarantineRoot = path.join(storeRoot, 'quarantine');
  mkdirSync(quarantineRoot, { recursive: true });
  const code = String(error?.code ?? 'invalid').replace(/[^a-z0-9_-]/giu, '-');
  const kind = sourcePath === pointerPath ? 'pointer' : 'receipt';
  const destination = path.join(
    quarantineRoot,
    `${Date.now()}-${process.pid}-${randomBytes(6).toString('hex')}-${code}-${kind}.json`,
  );
  try {
    renameSync(sourcePath, destination);
  } catch (renameError) {
    if (renameError?.code === 'ENOENT') return null;
    throw renameError;
  }
  return { sourcePath, quarantinePath: destination, kind };
}

/** Attach the self-digest over the canonical receipt body. */
function withReceiptDigest(receipt) {
  const { digest: _ignored, ...unsigned } = receipt;
  return { ...unsigned, digest: sha256Canonical(unsigned) };
}

export function writeEngineProducerReceipt({ v2Root, receipt }) {
  const complete = withReceiptDigest({ schema: ENGINE_PRODUCER_RECEIPT_SCHEMA, ...receipt });
  const filePath = engineProducerReceiptPath(v2Root);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(complete, null, 2)}\n`);
  renameSync(temp, filePath);
  return { filePath, receipt: complete };
}

function readEngineProducerReceiptFile(filePath) {
  if (!existsSync(filePath)) {
    throw new EngineInputError(
      `no engine producer receipt at ${filePath}. A dist tree without its producer receipt is not a valid prepared engine.`,
      { code: 'engine-receipt-missing', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new EngineInputError(`engine producer receipt is unreadable: ${filePath} (${error.message})`, {
      code: 'engine-receipt-corrupt',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  if (receipt?.schema !== ENGINE_PRODUCER_RECEIPT_SCHEMA) {
    throw new EngineInputError(
      `engine producer receipt schema mismatch: expected ${ENGINE_PRODUCER_RECEIPT_SCHEMA}, got ${receipt?.schema}`,
      { code: 'engine-receipt-schema', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  const { digest, ...unsigned } = receipt;
  if (digest !== sha256Canonical(unsigned)) {
    throw new EngineInputError(`engine producer receipt failed its self-digest check: ${filePath}`, {
      code: 'engine-receipt-digest',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  return receipt;
}

function readSelfDigestedJson(filePath, label, schema) {
  let value;
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new EngineInputError(`${label} is unreadable: ${filePath} (${error.message})`, {
      code: 'engine-pointer-corrupt',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  if (value?.schema !== schema) {
    throw new EngineInputError(`${label} schema mismatch: expected ${schema}, got ${value?.schema}`, {
      code: 'engine-pointer-schema',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const { digest, ...unsigned } = value;
  if (digest !== sha256Canonical(unsigned)) {
    throw new EngineInputError(`${label} failed its self-digest check: ${filePath}`, {
      code: 'engine-pointer-digest',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  return value;
}

/**
 * Resolve the authoritative immutable component roots. The fixed dist paths
 * are compatibility views and are consulted only when no local pointer exists,
 * as happens after a sealed candidate is restored on another runner.
 */
export function readEngineProducerSelection(v2Root) {
  const storeRoot = engineArtifactStoreRoot(v2Root);
  const pointerPath = path.join(storeRoot, 'pointers', 'current.json');
  if (!existsSync(pointerPath)) {
    const receipt = readEngineProducerReceiptFile(engineProducerReceiptPath(v2Root));
    const runtimeRoots = Object.create(null);
    for (const [id, output] of Object.entries(receipt.runtimeOutputs ?? {})) {
      runtimeRoots[id] = resolveEngineRuntimeOutputRoot(v2Root, id, output?.destination);
    }
    return {
      receipt,
      surfaceRoots: { dist: path.join(v2Root, 'dist'), 'dist-cdn': path.join(v2Root, 'dist-cdn') },
      runtimeRoots,
      pointer: null,
    };
  }

  const pointer = readSelfDigestedJson(pointerPath, 'engine artifact pointer', 'superdoc-artifact-pointer.v1');
  const expectedEnvelopePath = path.posix.join('envelopes', `${pointer.contentSetDigest}.json`);
  if (pointer.envelopePath !== expectedEnvelopePath) {
    throw new EngineInputError('engine artifact pointer selects a non-content-addressed envelope path', {
      code: 'engine-pointer-envelope',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const envelopePath = path.join(storeRoot, ...pointer.envelopePath.split('/'));
  const envelope = readSelfDigestedJson(envelopePath, 'engine artifact envelope', 'superdoc-artifact-envelope.v1');
  if (envelope.digest !== pointer.envelopeDigest || envelope.contentSetDigest !== pointer.contentSetDigest) {
    throw new EngineInputError('engine artifact pointer does not match its envelope', {
      code: 'engine-pointer-envelope',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const components = new Map(envelope.components?.map((component) => [component.id, component]) ?? []);
  const receiptComponent = components.get('receipt');
  if (!receiptComponent?.objectDigest) {
    throw new EngineInputError('engine artifact envelope has no receipt component', {
      code: 'engine-pointer-receipt',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const objectRoot = (component) => {
    if (!component?.objectDigest || component.objectPath !== path.posix.join('objects', component.objectDigest)) {
      throw new EngineInputError('engine artifact envelope contains an invalid component path', {
        code: 'engine-pointer-component',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    const root = path.join(storeRoot, 'objects', component.objectDigest);
    if (hashArtifactStoreObject(root) !== component.objectDigest) {
      throw new EngineInputError(`immutable engine object ${component.objectDigest} failed exact-tree verification`, {
        code: 'engine-pointer-object',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    return root;
  };
  if (components.size !== envelope.components.length) {
    throw new EngineInputError('engine artifact envelope contains duplicate component ids', {
      code: 'engine-pointer-component',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  for (const component of envelope.components) objectRoot(component);
  const receipt = readEngineProducerReceiptFile(
    path.join(objectRoot(receiptComponent), 'engine-producer-receipt.json'),
  );
  const surfaceRoots = {};
  for (const surface of Object.keys(receipt.surfaces ?? {})) {
    const component = components.get(surface);
    if (!component) {
      throw new EngineInputError(`engine artifact envelope has no ${surface} component sealed by its receipt`, {
        code: 'engine-pointer-component',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    surfaceRoots[surface] = objectRoot(component);
  }
  const runtimeRoots = Object.create(null);
  for (const [id, output] of Object.entries(receipt.runtimeOutputs ?? {})) {
    resolveEngineRuntimeOutputRoot(v2Root, id, output?.destination);
    const component = components.get(id);
    if (!component) {
      throw new EngineInputError(`engine artifact envelope has no ${id} runtime component sealed by its receipt`, {
        code: 'engine-pointer-component',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    runtimeRoots[id] = objectRoot(component);
  }
  return { receipt, surfaceRoots, runtimeRoots, pointer: { ...pointer, envelope } };
}

function resolveEngineRuntimeOutputRoot(v2Root, id, destination) {
  if (
    typeof id !== 'string' ||
    !isEngineRuntimeOutputDestination(id, destination) ||
    typeof destination !== 'string' ||
    destination.length === 0 ||
    destination.includes('\\') ||
    path.posix.isAbsolute(destination) ||
    path.posix.normalize(destination) !== destination ||
    destination === '.' ||
    destination.startsWith('../')
  ) {
    throw new EngineInputError(`engine producer receipt has an invalid destination for runtime output ${id}`, {
      code: 'engine-receipt-runtime-output',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const root = path.resolve(v2Root, ...destination.split('/'));
  const relative = path.relative(v2Root, root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new EngineInputError(`engine runtime output ${id} resolves outside the engine root`, {
      code: 'engine-receipt-runtime-output',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  return root;
}

export function readEngineProducerReceipt(v2Root) {
  return readEngineProducerSelection(v2Root).receipt;
}

/** Normalize `workspace:0.5.0-next.1` / `0.5.0-next.1` to the exact version. */
export function normalizeExactEngineVersion(specifier, { label = 'engine dependency' } = {}) {
  if (typeof specifier !== 'string' || specifier.length === 0) {
    throw new EngineInputError(`${label} specifier is missing`, { code: 'engine-version-spec' });
  }
  const version = specifier.startsWith('workspace:') ? specifier.slice('workspace:'.length) : specifier;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new EngineInputError(
      `${label} must pin an exact version; got ${JSON.stringify(specifier)}`,
      { code: 'engine-version-spec' },
    );
  }
  return version;
}

export function readDeclaredEngineVersion(superdocPackageRoot) {
  const manifestPath = path.join(superdocPackageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const specifier = manifest.dependencies?.[ENGINE_PACKAGE_NAME];
  return normalizeExactEngineVersion(specifier, { label: `${manifestPath} dependencies.${ENGINE_PACKAGE_NAME}` });
}

function verifyManifestFile(surfaceRoot, surfaceLabel) {
  const manifestPath = path.join(surfaceRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new EngineInputError(`${surfaceLabel} has no manifest.json`, {
      code: 'engine-manifest-missing',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.packageName !== ENGINE_PACKAGE_NAME) {
    throw new EngineInputError(`${surfaceLabel} manifest.json has an unsupported schema or package name`, {
      code: 'engine-manifest-schema',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  if (!manifest.protection?.obfuscatedSetSha256) {
    throw new EngineInputError(`${surfaceLabel} manifest.json records no protection metadata`, {
      code: 'engine-manifest-protection',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  return manifest;
}

/**
 * Verify one surface directory (e.g. `dist`) against the per-file hashes in
 * its own manifest.json, and require the on-disk tree to be exactly the
 * manifest set plus the manifest itself. Returns the exact-tree hash.
 */
export function verifyEngineSurface(surfaceRoot, surfaceLabel) {
  if (!existsSync(surfaceRoot)) {
    throw new EngineInputError(`${surfaceLabel} does not exist at ${surfaceRoot}`, {
      code: 'engine-surface-missing',
      remediation: ENGINE_PREPARE_COMMAND,
    });
  }
  const manifest = verifyManifestFile(surfaceRoot, surfaceLabel);
  const tree = hashEngineTree(surfaceRoot);
  const byPath = new Map(tree.files.map((file) => [file.path, file]));
  const problems = [];
  for (const entry of manifest.files) {
    const actual = byPath.get(entry.path);
    if (!actual) problems.push(`missing: ${entry.path}`);
    else if (actual.sha256 !== entry.sha256) problems.push(`changed: ${entry.path}`);
    byPath.delete(entry.path);
  }
  byPath.delete('manifest.json');
  for (const stray of byPath.keys()) problems.push(`unexpected: ${stray}`);
  if (problems.length > 0) {
    throw new EngineInputError(
      `${surfaceLabel} does not match its manifest (${problems.length} problem(s)):\n  ${problems.slice(0, 20).join('\n  ')}${problems.length > 20 ? '\n  ...' : ''}`,
      { code: 'engine-surface-mismatch', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  return { manifest, tree };
}

/**
 * Verify a prepared local engine component (Orbit checkout).
 *
 * @param {object} params
 * @param {string} params.v2Root absolute path to superdoc/v2
 * @param {string} params.expectedVersion exact version the consumer declares
 * @param {string[]} [params.surfaces] surface dirs to verify (default ['dist'])
 * @param {string|null} [params.expectedReceiptDigest] orchestrator-passed binding
 */
export function verifyPreparedEngine({
  v2Root,
  expectedVersion,
  surfaces = ['dist'],
  expectedReceiptDigest = null,
  currentInputIdentity = null,
}) {
  const selection = readEngineProducerSelection(v2Root);
  const receipt = selection.receipt;
  if (expectedReceiptDigest && receipt.digest !== expectedReceiptDigest) {
    throw new EngineInputError(
      `engine producer receipt digest ${receipt.digest} does not match the orchestrator-expected digest ${expectedReceiptDigest}`,
      { code: 'engine-receipt-binding', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  if (receipt.engineVersion !== expectedVersion) {
    throw new EngineInputError(
      `prepared engine version ${receipt.engineVersion} does not match the declared dependency ${expectedVersion}`,
      { code: 'engine-version-mismatch', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  if (currentInputIdentity) assertEngineInputIdentity(receipt.inputIdentity, currentInputIdentity);
  const enginePackageVersion = JSON.parse(readFileSync(path.join(v2Root, 'package.json'), 'utf8')).version;
  if (enginePackageVersion !== expectedVersion) {
    throw new EngineInputError(
      `superdoc/v2 package version ${enginePackageVersion} does not match the declared dependency ${expectedVersion}`,
      { code: 'engine-version-mismatch', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  const verifiedSurfaces = {};
  for (const surface of surfaces) {
    const sealed = receipt.surfaces?.[surface];
    if (!sealed?.digest) {
      throw new EngineInputError(`engine producer receipt does not seal surface ${surface}`, {
        code: 'engine-receipt-surface',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    const surfaceRoot = selection.surfaceRoots[surface];
    if (!surfaceRoot) {
      throw new EngineInputError(`engine artifact selection does not contain surface ${surface}`, {
        code: 'engine-receipt-surface',
        remediation: ENGINE_PREPARE_COMMAND,
      });
    }
    const { manifest, tree } = verifyEngineSurface(surfaceRoot, `prepared engine ${surface}`);
    if (tree.digest !== sealed.digest) {
      throw new EngineInputError(
        `prepared engine ${surface} tree digest ${tree.digest} does not match its sealed producer receipt digest ${sealed.digest}. ` +
          'The output changed after the producer sealed it.',
        { code: 'engine-seal-mismatch', remediation: ENGINE_PREPARE_COMMAND },
      );
    }
    verifiedSurfaces[surface] = { root: surfaceRoot, digest: tree.digest, fileCount: tree.files.length, manifest };
  }
  return { mode: 'prepared', engineVersion: receipt.engineVersion, receipt, surfaces: verifiedSurfaces };
}

/** Locate the installed engine by walking node_modules (bundler-equivalent). */
export function findInstalledEngineRoot(packageRoot) {
  let dir = packageRoot;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...ENGINE_PACKAGE_NAME.split('/'));
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const INSTALLED_REQUIRED_FILES = Object.freeze([
  'dist/docx-engine.es.js',
  'dist/collaboration-upgrade-engine.js',
  'dist/collaboration-worker.js',
  'dist/style.css',
  'dist/docx-engine.d.ts',
  'dist/collaboration-worker.d.ts',
  'dist/DOCX-ENGINE-LICENSE.md',
  'dist/NOTICE.md',
]);

/**
 * Verify an installed engine package (public checkout / registry consumer):
 * exact version, required runtime/legal files, and packaged-manifest content
 * hashes for every file the manifest records.
 */
export function verifyInstalledEngine({ packageRoot, expectedVersion }) {
  const engineRoot = findInstalledEngineRoot(packageRoot);
  if (!engineRoot) {
    throw new EngineInputError(
      `${ENGINE_PACKAGE_NAME} is not installed in any node_modules above ${packageRoot}`,
      {
        code: 'engine-not-installed',
        remediation: `install dependencies (pnpm install), or in an Orbit checkout run: ${ENGINE_PREPARE_COMMAND}`,
      },
    );
  }
  if (existsSync(path.join(engineRoot, 'src', 'superdoc', 'index.ts'))) {
    // In an Orbit checkout the workspace symlink resolves to the private v2
    // workspace. That is never a valid *installed* engine: it must be consumed
    // through the verified prepared contract instead.
    throw new EngineInputError(
      `installed-engine resolution reached the private v2 workspace at ${engineRoot}. ` +
        'Use the prepared contract (default in Orbit) or install the packaged engine.',
      { code: 'engine-installed-private', remediation: ENGINE_PREPARE_COMMAND },
    );
  }
  const manifest = JSON.parse(readFileSync(path.join(engineRoot, 'package.json'), 'utf8'));
  if (manifest.name !== ENGINE_PACKAGE_NAME) {
    throw new EngineInputError(`installed engine package name is ${manifest.name}`, { code: 'engine-installed-name' });
  }
  if (manifest.version !== expectedVersion) {
    throw new EngineInputError(
      `installed engine version ${manifest.version} does not match the declared exact dependency ${expectedVersion}`,
      { code: 'engine-version-mismatch' },
    );
  }
  for (const relative of INSTALLED_REQUIRED_FILES) {
    if (!existsSync(path.join(engineRoot, ...relative.split('/')))) {
      throw new EngineInputError(`installed engine is missing ${relative}`, { code: 'engine-installed-shape' });
    }
  }
  const distManifestPath = path.join(engineRoot, 'dist', 'manifest.json');
  if (existsSync(distManifestPath)) {
    const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf8'));
    const problems = [];
    for (const entry of distManifest.files ?? []) {
      const absolute = path.join(engineRoot, 'dist', ...entry.path.split('/'));
      if (!existsSync(absolute)) {
        problems.push(`missing: ${entry.path}`);
        continue;
      }
      if (sha256(readFileSync(absolute)) !== entry.sha256) problems.push(`changed: ${entry.path}`);
    }
    if (problems.length > 0) {
      throw new EngineInputError(
        `installed engine dist does not match its packaged manifest:\n  ${problems.slice(0, 20).join('\n  ')}`,
        { code: 'engine-installed-integrity' },
      );
    }
  }
  return { mode: 'installed', engineRoot, engineVersion: manifest.version };
}

/**
 * Resolve which engine input contract applies. Explicit env selection wins;
 * otherwise the checkout topology decides: a private v2 workspace selects the
 * prepared contract, its absence selects the installed contract.
 */
export function resolveEngineInputContract({ env = process.env, v2Root }) {
  const requested = env[ENGINE_INPUT_ENV];
  if (requested !== undefined && !ENGINE_INPUT_MODES.includes(requested)) {
    throw new EngineInputError(
      `invalid ${ENGINE_INPUT_ENV}=${JSON.stringify(requested)}; expected one of ${ENGINE_INPUT_MODES.join(', ')}`,
      { code: 'engine-input-selection' },
    );
  }
  if (requested) return { mode: requested, reason: `explicit ${ENGINE_INPUT_ENV}=${requested}` };
  // The marker is private source, not package.json: in a public checkout the
  // engine package root is the installed dist-only package, which also has a
  // package.json but never private source.
  const privateV2SourceExists = existsSync(path.join(v2Root, 'src', 'superdoc', 'index.ts'));
  return privateV2SourceExists
    ? { mode: 'prepared', reason: 'private v2 workspace present (Orbit checkout default)' }
    : { mode: 'installed', reason: 'no private v2 workspace (public checkout default)' };
}
