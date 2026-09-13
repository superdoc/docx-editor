import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashEngineTree, observeEngineInputIdentity, verifyPreparedEngine, writeEngineProducerReceipt } from '../../engine-prepared-input.mjs';
import { packCiSuperdocBuildArtifact } from '../../ci-superdoc-build-artifact.mjs';
import { writeEngineConsumerArtifactReceipt } from '../../ci-docx-engine-artifact.mjs';
import { writePublicOutputReceipt } from '../../../packages/superdoc/scripts/public-output-receipt.mjs';
import { ENGINE_NATIVE_RUNTIME_EXPORTS } from '../../engine-native-runtime.mjs';

const packageEnvironment = { ...process.env, SUPERDOC_ENGINE_INPUT: 'prepared', SUPERDOC_V2_RUNTIME_MODE: 'package' };
const fixtureRuntimeOutputSources = Object.freeze({
  'native-runtime': {
    destination: 'dist-native',
    source: 'export const runtime = "protected-native";\n',
  },
  'leaf-document-compare': {
    destination: 'document-compare/dist',
    source: 'export const runtime = "document-compare";\n',
  },
  'leaf-editor-core': {
    destination: 'editor-core/dist',
    source: 'export const runtime = "editor-core";\n',
  },
  'leaf-collaboration-v2': {
    destination: 'collaboration-v2/dist',
    source: 'export const runtime = "collaboration-v2";\n',
  },
  'leaf-document-api-v2-adapter': {
    destination: 'document-api-v2-adapter/dist',
    source: 'export const runtime = "document-api-v2-adapter";\n',
  },
  'leaf-headless': {
    destination: 'headless/dist',
    source: 'export const runtime = "headless";\n',
  },
  'leaf-collaboration-upgrade': {
    destination: 'collaboration-upgrade/dist',
    source: 'export const runtime = "collaboration-upgrade";\n',
  },
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function writeEngineSurface(root, source) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'docx-engine.es.js'), source);
  writeJson(path.join(root, 'manifest.json'), {
    schemaVersion: 1,
    packageName: '@superdoc/docx-engine',
    protection: { obfuscatedSetSha256: 'protected' },
    files: [{ path: 'docx-engine.es.js', sha256: sha256(source) }],
  });
}

function createFixture({ nativeRuntime = false } = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'ci-superdoc-artifact-'));
  const workspaceRoot = path.join(repoRoot, 'superdoc', 'public');
  const packageRoot = path.join(workspaceRoot, 'packages', 'superdoc');
  const documentApiRoot = path.join(workspaceRoot, 'packages', 'document-api', 'dist');
  const engineArtifactRoot = path.join(workspaceRoot, '.ci-docx-engine');
  const v2Root = path.join(repoRoot, 'superdoc', 'v2');
  const archivePath = path.join(workspaceRoot, 'superdoc-build-artifact.json.gz');

  mkdirSync(path.join(v2Root, 'src'), { recursive: true });
  mkdirSync(packageRoot, { recursive: true });
  writeJson(path.join(v2Root, 'package.json'), { name: '@superdoc/docx-engine', version: '1.2.3' });
  writeFileSync(path.join(v2Root, 'src', 'index.ts'), 'export const engineSource = true;\n');
  writeJson(path.join(packageRoot, 'package.json'), {
    name: 'superdoc',
    version: '2.0.0',
    dependencies: { '@superdoc/docx-engine': 'workspace:1.2.3' },
  });
  writeFileSync(path.join(packageRoot, 'source.js'), 'export const publicSource = true;\n');
  if (nativeRuntime) {
    writeJson(path.join(workspaceRoot, 'apps/cli/package.json'), { dependencies: { yjs: '13.6.31' } });
    writeJson(path.join(workspaceRoot, 'node_modules/yjs/package.json'), { name: 'yjs', version: '13.6.31' });
    mkdirSync(path.join(workspaceRoot, 'node_modules/yjs/dist'));
    writeFileSync(path.join(workspaceRoot, 'node_modules/yjs/dist/yjs.mjs'), 'export const fixture = true;\n');
    writeFileSync(path.join(workspaceRoot, 'node_modules/yjs/LICENSE'), 'fixture license\n');
    mkdirSync(path.join(v2Root, 'src/superdoc'));
    writeFileSync(path.join(v2Root, 'src/superdoc/index.ts'), 'export const fixture = true;\n');
  }
  writeFileSync(
    path.join(workspaceRoot, '.gitignore'),
    [
      'packages/**/dist/',
      'packages/**/dist-cdn/',
      'packages/**/build-receipts/',
      '.ci-docx-engine/',
      '.ci-superdoc-artifact/',
      '.tmp/',
      '*.json.gz',
      'node_modules/',
    ].join('\n'),
  );
  writeFileSync(path.join(v2Root, '.gitignore'), 'dist/\ndist-cdn/\ndist-native/\nbuild-receipts/\n.build-artifacts/\n');
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'CI Artifact Test']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-qm', 'fixture']);

  writeEngineSurface(path.join(v2Root, 'dist'), 'export const engine = "npm";\n');
  writeEngineSurface(path.join(v2Root, 'dist-cdn'), 'export const engine = "cdn";\n');
  const inputIdentity = observeEngineInputIdentity({ v2Root, repoRoot });
  const runtimeRoots = {};
  const runtimeOutputs = {};
  const protection = { schema: 'engine-obfuscation.v1', tool: 'test', optionsSha256: 'a'.repeat(64) };
  for (const [id, { destination, source }] of Object.entries(fixtureRuntimeOutputSources)) {
    const root = path.join(v2Root, ...destination.split('/'));
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'index.js'), source);
    if (nativeRuntime && id === 'native-runtime') {
      const banner = '/* fixture license */\n';
      const inventory = JSON.stringify({
        schema: 'superdoc-native-runtime-origins.v1',
        rawSha256: sha256(source),
        exports: ENGINE_NATIVE_RUNTIME_EXPORTS,
        imports: ['yjs'],
        modules: [{ path: 'superdoc/v2/src/index.ts', sourceSha256: sha256(source), renderedLength: source.length }],
      });
      mkdirSync(path.join(root, 'runtime'));
      writeFileSync(path.join(root, 'runtime/native-runtime.js'), banner + source);
      writeFileSync(path.join(root, 'rendered-origins.json'), inventory);
      writeJson(path.join(root, 'manifest.json'), {
        schema: 'superdoc-native-runtime.v1',
        banner,
        outputSha256: sha256(banner + source),
        inventorySha256: sha256(inventory),
        protection: { ...protection, entries: [{
          path: 'native-runtime.js', target: 'node', identifierNamesGenerator: 'hexadecimal',
          sourceSha256: sha256(source), obfuscatedSha256: sha256(source),
        }] },
      });
    }
    const tree = hashEngineTree(root);
    runtimeRoots[id] = root;
    runtimeOutputs[id] = {
      digest: tree.digest,
      fileCount: tree.files.length,
      sizeBytes: tree.sizeBytes,
      destination,
    };
  }
  const engineSurfaces = Object.fromEntries(
    ['dist', 'dist-cdn'].map((surface) => {
      const tree = hashEngineTree(path.join(v2Root, surface));
      return [surface, { digest: tree.digest, fileCount: tree.files.length, sizeBytes: tree.sizeBytes, ...(nativeRuntime ? { protection } : {}) }];
    }),
  );
  const engineReceipt = writeEngineProducerReceipt({
    v2Root,
    receipt: {
      engineVersion: '1.2.3',
      inputIdentity,
      protectionCache: { authoritativeForPublication: true },
      surfaces: engineSurfaces,
      runtimeOutputs,
    },
  }).receipt;

  mkdirSync(path.join(packageRoot, 'dist'));
  mkdirSync(path.join(packageRoot, 'dist-cdn'));
  writeFileSync(path.join(packageRoot, 'dist', 'superdoc.es.js'), 'export const publicNpm = true;\n');
  writeFileSync(path.join(packageRoot, 'dist-cdn', 'superdoc.js'), 'globalThis.SuperDoc = {};\n');
  const publicReceipt = writePublicOutputReceipt({
    packageRoot,
    v2Root,
    surfaces: ['npm', 'cdn'],
    env: packageEnvironment,
  }).receipt;

  for (const relative of ['index.js', 'index.d.ts', 'types/index.js', 'types/index.d.ts']) {
    mkdirSync(path.dirname(path.join(documentApiRoot, relative)), { recursive: true });
    writeFileSync(path.join(documentApiRoot, relative), `// ${relative}\n`);
  }
  mkdirSync(engineArtifactRoot);
  const engineArchive = path.join(engineArtifactRoot, 'superdoc-docx-engine-1.2.3.tgz');
  writeFileSync(engineArchive, 'audited engine consumer tarball\n');
  const verifiedEngine = verifyPreparedEngine({
    v2Root,
    expectedVersion: '1.2.3',
    surfaces: ['dist', 'dist-cdn'],
    currentInputIdentity: inputIdentity,
  });
  writeEngineConsumerArtifactReceipt({ root: engineArtifactRoot, engineArchive, verifiedEngine });

  return {
    archivePath,
    documentApiRoot,
    engineArtifactRoot,
    engineReceipt,
    packageRoot,
    publicReceipt,
    repoRoot,
    runtimeRoots,
    v2Root,
    workspaceRoot,
  };
}

function packFixture(fixture, options = {}) {
  return packCiSuperdocBuildArtifact({
    workspaceRoot: fixture.workspaceRoot,
    packageRoot: fixture.packageRoot,
    v2Root: fixture.v2Root,
    documentApiRoot: fixture.documentApiRoot,
    engineArtifactRoot: fixture.engineArtifactRoot,
    archivePath: fixture.archivePath,
    env: packageEnvironment,
    ...options,
  });
}

function replaceWithPreviousTrees(fixture) {
  for (const destination of [
    path.join(fixture.packageRoot, 'dist'),
    path.join(fixture.packageRoot, 'dist-cdn'),
    path.join(fixture.packageRoot, 'build-receipts'),
    fixture.documentApiRoot,
    fixture.engineArtifactRoot,
    ...Object.values(fixture.runtimeRoots),
    path.join(fixture.workspaceRoot, '.ci-superdoc-artifact'),
  ]) {
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, 'previous.txt'), `previous ${path.basename(destination)}\n`);
  }
}

export { createFixture, packFixture, replaceWithPreviousTrees, fixtureRuntimeOutputSources, git };
