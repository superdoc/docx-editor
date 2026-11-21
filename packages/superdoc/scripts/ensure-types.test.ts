import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const publicEntries = [
  'ui',
  'ui-react',
  'ui-vue',
  'collaboration-upgrade-engine',
  'collaboration-validation',
  'collaboration-worker',
];
const countsFromRepositorySources = [
  /(Emitted )\d+( shared\/common declarations)/g,
  /(Fixed )\d+( import paths in )\d+( \.d\.ts files)/g,
  /(Scanned: )\d+( declaration files)/g,
];
const relocatedSharedCommonDeclarations = [
  'shared/common/event-types.d.ts',
  'shared/common/comments-types.d.ts',
  'shared/common/Telemetry.d.ts',
  'shared/common/helpers/v-click-outside.d.ts',
];
const distRoots: string[] = [];

interface SeededDist {
  distRoot: string;
  input: Record<string, string>;
}

interface ScriptRun {
  script: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

function seedDist(files: Record<string, string>, { withEntries = true } = {}): SeededDist {
  const distRoot = mkdtempSync(path.join(tmpdir(), 'superdoc-ensure-types-test-'));
  distRoots.push(distRoot);
  const entries: Record<string, string> = withEntries
    ? {
        'superdoc/src/public/index.d.ts': 'declare class SuperDoc {}\nexport { SuperDoc };\n',
        ...Object.fromEntries(publicEntries.map((entry) => [`superdoc/src/public/${entry}.d.ts`, 'export {};\n'])),
      }
    : {};
  const input = { ...entries, ...files };
  for (const [file, content] of Object.entries(input)) {
    mkdirSync(path.dirname(path.join(distRoot, file)), { recursive: true });
    writeFileSync(path.join(distRoot, file), content);
  }
  return { distRoot, input };
}

function normalize(text: string, distRoot: string) {
  const withoutPaths = text.split(path.relative(process.cwd(), distRoot)).join('<dist>').split(distRoot).join('<dist>');
  return countsFromRepositorySources.reduce(
    (current, pattern) => current.replace(pattern, (_match, ...parts: unknown[]) => parts.slice(0, -2).join('<n>')),
    withoutPaths,
  );
}

function run(script: string, distRoot: string): ScriptRun {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, script)], {
    encoding: 'utf8',
    env: { ...process.env, SUPERDOC_PUBLIC_NPM_OUT_DIR: distRoot, SUPERDOC_AUDIT_INFORMATIONAL: '' },
  });
  return {
    script,
    status: result.status,
    stdout: normalize(result.stdout, distRoot),
    stderr: normalize(result.stderr, distRoot),
  };
}

function fileSections(heading: string, files: Record<string, string>) {
  return [heading, ...Object.entries(files).map(([file, content]) => `--- ${file}\n${content}`)].join('\n');
}

function record(
  seeded: SeededDist,
  runs: ScriptRun[],
  { outputFiles = [], expectedFiles = [] }: { outputFiles?: string[]; expectedFiles?: string[] } = {},
) {
  const sections = [
    fileSections('== input files', seeded.input),
    ...runs.map((step) =>
      [
        `== $ node ${step.script}`,
        `exit code: ${step.status}`,
        `-- stdout\n${step.stdout}`,
        `-- stderr\n${step.stderr}`,
      ].join('\n'),
    ),
  ];
  if (outputFiles.length > 0) {
    sections.push(
      fileSections(
        '== output files',
        Object.fromEntries(outputFiles.map((file) => [file, readFileSync(path.join(seeded.distRoot, file), 'utf8')])),
      ),
    );
  }
  if (expectedFiles.length > 0) {
    sections.push(
      [
        '== emitted declarations',
        ...expectedFiles.map(
          (file) => `${file}: ${existsSync(path.join(seeded.distRoot, file)) ? 'present' : 'missing'}`,
        ),
      ].join('\n'),
    );
  }
  return `${sections.join('\n')}\n`;
}

afterEach(() => {
  for (const distRoot of distRoots.splice(0)) rmSync(distRoot, { recursive: true, force: true });
});

describe('ensure-types shared/common relocation', () => {
  it('rewrites each imported name to the file that declares it', async () => {
    const seeded = seedDist({
      'superdoc/src/public/index.d.ts':
        "import { DOCX, CommentEvent } from '@superdoc/common';\ndeclare class SuperDoc {}\nexport type RootEvent = CommentEvent;\nexport { SuperDoc, DOCX };\n",
      'superdoc/src/components/CommentsLayer/use-comment.d.ts':
        "import { CommentEvent, Comment as CommonComment } from '../../../../../shared/common';\nexport type Pair = [CommentEvent, CommonComment];\n",
      'superdoc/src/core/document-open-telemetry.d.ts':
        "export type Client = Pick<import('../../../../shared/common').Telemetry, 'trackDocumentOpen'>;\n",
      'superdoc/src/core/create-app.d.ts':
        "import { vClickOutside as clickOutside } from '@superdoc/common';\nexport type Directive = typeof clickOutside;\n",
    });

    const runs = [run('ensure-types.cjs', seeded.distRoot), run('audit-declarations.cjs', seeded.distRoot)];
    await expect(
      record(seeded, runs, {
        outputFiles: [
          'superdoc/src/public/index.d.ts',
          'superdoc/src/components/CommentsLayer/use-comment.d.ts',
          'superdoc/src/core/document-open-telemetry.d.ts',
          'superdoc/src/core/create-app.d.ts',
        ],
        expectedFiles: relocatedSharedCommonDeclarations,
      }),
    ).toMatchFileSnapshot('./__snapshots__/ensure-types/relocates-shared-common-imports.txt');
  }, 120_000);

  it('fails with the file and symbol when shared/common does not export a name', async () => {
    const seeded = seedDist({
      'superdoc/src/core/collaboration/helpers.d.ts':
        "import { NotACommonExport } from '../../../../../shared/common';\nexport type Missing = NotACommonExport;\n",
    });

    await expect(record(seeded, [run('ensure-types.cjs', seeded.distRoot)])).toMatchFileSnapshot(
      './__snapshots__/ensure-types/unknown-shared-common-export.txt',
    );
  }, 120_000);

  it('fails when an import does not name the symbols it takes', async () => {
    const seeded = seedDist({
      'superdoc/src/core/collaboration/helpers.d.ts':
        "import * as common from '../../../../../shared/common';\nexport type Event = common.CommentEvent;\n",
    });

    await expect(record(seeded, [run('ensure-types.cjs', seeded.distRoot)])).toMatchFileSnapshot(
      './__snapshots__/ensure-types/namespace-import.txt',
    );
  }, 120_000);
});

describe('audit-declarations shared/common rule', () => {
  it('fails on shared/common specifiers that do not resolve to an emitted declaration', async () => {
    const seeded = seedDist(
      {
        'shared/common/event-types.d.ts': 'export type CommentEvent = string;\n',
        'superdoc/src/ok.d.ts':
          "import { CommentEvent } from '../../shared/common/event-types.js';\nexport type A = CommentEvent;\n",
        'superdoc/src/bare.d.ts':
          "import { CommentEvent } from '../../shared/common';\nexport type B = CommentEvent;\n",
        'superdoc/src/missing.d.ts': "export type C = import('../../shared/common/missing.js').Missing;\n",
      },
      { withEntries: false },
    );

    await expect(record(seeded, [run('audit-declarations.cjs', seeded.distRoot)])).toMatchFileSnapshot(
      './__snapshots__/ensure-types/unresolved-shared-common.txt',
    );
  });
});
