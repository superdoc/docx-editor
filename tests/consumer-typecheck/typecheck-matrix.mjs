/**
 * TypeScript compatibility matrix for the v2 public package contract.
 *
 * The fixture installs SuperDoc and its optional font bundle from packed tarballs, so the matrix
 * tests the customer-visible package surfaces rather than workspace symlinks.
 *
 * Run: npm run typecheck:matrix
 *
 * Pass --use-existing-tarball to freshly install an already-built
 * superdoc.tgz, or --skip-pack to reuse the already-installed fixture.
 */
import { execFile, execFileSync, execSync } from 'child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { installPackedSuperdocFixture } from './packed-fixture.mjs';
import { syncDocsSnippets } from './sync-docs-snippets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const skipPack = process.argv.includes('--skip-pack');
const useExistingTarball = process.argv.includes('--use-existing-tarball');

if (skipPack && useExistingTarball) {
  console.error('--skip-pack and --use-existing-tarball are mutually exclusive.');
  process.exit(2);
}

syncDocsSnippets();

console.log('Checking all-public-types.ts fixture against the classification...');
try {
  execSync('node check-all-public-types-fixture.mjs', { cwd: __dirname, stdio: 'inherit' });
} catch {
  console.error('\nPublic-types fixture check failed (see message above).');
  process.exit(1);
}
console.log();

if (!skipPack) {
  const internal = process.env.SUPERDOC_EVAL_FAST_BUILD === '1';
  const tarballPath = join(repoRoot, 'packages', 'superdoc', internal ? 'superdoc-internal.tgz' : 'superdoc.tgz');
  if (useExistingTarball) {
    console.log('Installing fixture from the existing superdoc tarball...');
  } else {
    console.log('Packing superdoc and reinstalling fixture...');
    try {
      execSync(internal ? 'pnpm run pack:superdoc:internal' : 'pnpm --filter superdoc run pack:es', {
        cwd: internal ? join(repoRoot, '..', '..') : repoRoot,
        stdio: 'inherit',
      });
    } catch {
      console.error('Failed to pack superdoc. Run with --skip-pack to use the installed fixture.');
      process.exit(1);
    }
  }
  if (!existsSync(tarballPath)) {
    console.error(`Expected tarball at ${tarballPath} but it is missing.`);
    process.exit(1);
  }
  const fontsPackRoot = mkdtempSync(join(tmpdir(), 'superdoc-fonts-pack-'));
  try {
    execFileSync('npm', ['pack', '--silent', '--pack-destination', fontsPackRoot], {
      cwd: join(repoRoot, 'packages', 'fonts'),
      stdio: 'inherit',
    });
    const fontsTarballs = readdirSync(fontsPackRoot).filter((name) => name.endsWith('.tgz'));
    if (fontsTarballs.length !== 1) throw new Error(`Expected one fonts tarball, found ${fontsTarballs.length}`);
    const [fontsTarballName] = fontsTarballs;
    const fontsTarballPath = join(fontsPackRoot, fontsTarballName);
    if (!existsSync(fontsTarballPath)) throw new Error(`Expected fonts tarball at ${fontsTarballPath}`);
    installPackedSuperdocFixture({
      fixtureRoot: __dirname,
      superdocTarball: tarballPath,
      engineTarball: process.env.SUPERDOC_DOCX_ENGINE_TARBALL,
      fontsTarball: fontsTarballPath,
    });
  } catch {
    console.error('Failed to install fixture from packed SuperDoc packages.');
    process.exit(1);
  } finally {
    rmSync(fontsPackRoot, { recursive: true, force: true });
  }
  console.log('Fresh fixture install complete.\n');
}

const scenarios = [
  {
    name: 'bundler / root entry / strict',
    module: 'ESNext',
    moduleResolution: 'bundler',
    skipLibCheck: false,
    strict: true,
    files: ['src/imports-main.ts'],
  },
  {
    name: 'node16 / root entry / strict',
    module: 'Node16',
    moduleResolution: 'node16',
    skipLibCheck: false,
    strict: true,
    files: ['src/imports-main.ts'],
  },
  {
    name: 'nodenext / root entry / strict',
    module: 'NodeNext',
    moduleResolution: 'nodenext',
    skipLibCheck: false,
    strict: true,
    files: ['src/imports-main.ts'],
  },
  {
    name: 'node16 / CJS root require / strict',
    module: 'Node16',
    moduleResolution: 'node16',
    skipLibCheck: false,
    strict: true,
    files: ['src/imports-cjs.cts'],
  },
  {
    name: 'nodenext / CJS root require / strict',
    module: 'NodeNext',
    moduleResolution: 'nodenext',
    skipLibCheck: false,
    strict: true,
    files: ['src/imports-cjs.cts'],
  },
  {
    name: 'bundler / all public types are real',
    module: 'ESNext',
    moduleResolution: 'bundler',
    skipLibCheck: false,
    strict: true,
    files: ['src/all-public-types.ts'],
  },
  {
    name: 'node16 / all public types are real',
    module: 'Node16',
    moduleResolution: 'node16',
    skipLibCheck: false,
    strict: true,
    files: ['src/all-public-types.ts'],
  },
  {
    name: 'bundler / v2 public fixtures / skipLibCheck=false',
    module: 'ESNext',
    moduleResolution: 'bundler',
    skipLibCheck: false,
    strict: true,
    noPropertyAccessFromIndexSignature: true,
    files: ['src/**/*.ts'],
  },
  {
    name: 'node16 / v2 public fixtures / skipLibCheck=false',
    module: 'Node16',
    moduleResolution: 'node16',
    skipLibCheck: false,
    strict: true,
    noPropertyAccessFromIndexSignature: true,
    files: ['src/**/*.ts'],
  },
  {
    name: 'nodenext / v2 public fixtures / skipLibCheck=false',
    module: 'NodeNext',
    moduleResolution: 'nodenext',
    skipLibCheck: false,
    strict: true,
    noPropertyAccessFromIndexSignature: true,
    files: ['src/**/*.ts'],
  },
];

const tscPath = join(__dirname, 'node_modules', '.bin', 'tsc');
let passed = 0;
let failed = 0;

console.log('TypeScript Compatibility Matrix');
console.log('='.repeat(80));
console.log();

const execute = promisify(execFile);
let cursor = 0;
async function worker() {
  while (cursor < scenarios.length) {
    const index = cursor++;
    const scenario = scenarios[index];
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: scenario.module,
        moduleResolution: scenario.moduleResolution,
        strict: scenario.strict,
        skipLibCheck: scenario.skipLibCheck,
        noEmit: true,
        esModuleInterop: true,
        types: ['node'],
        ...(scenario.noPropertyAccessFromIndexSignature
          ? { noPropertyAccessFromIndexSignature: true }
          : {}),
      },
      include: scenario.files,
    };

    const tsconfigPath = join(__dirname, `tsconfig.matrix-${process.pid}-${index}.json`);
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

    console.log(`Running: ${scenario.name}`);
    try {
      await execute(tscPath, ['-p', tsconfigPath], {
        cwd: __dirname,
        timeout: 300000,
        killSignal: 'SIGKILL',
      });
      console.log(`  PASS: ${scenario.name}\n`);
      passed += 1;
    } catch (error) {
      console.error(`  FAIL: ${scenario.name}`);
      const stdout = error.stdout?.toString();
      const stderr = error.stderr?.toString();
      if (stdout) console.error(stdout);
      if (stderr) console.error(stderr);
      console.error();
      failed += 1;
    } finally {
      rmSync(tsconfigPath, { force: true });
    }
  }
}
await Promise.all(Array.from({ length: Math.min(4, scenarios.length) }, worker));

console.log('='.repeat(80));
console.log(`Results: ${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);
