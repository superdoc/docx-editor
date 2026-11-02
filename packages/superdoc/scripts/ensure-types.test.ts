import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const publicEntries = ['ui', 'ui-react', 'ui-vue', 'collaboration-upgrade-engine', 'collaboration-worker'];
const distRoots: string[] = [];

function seedDist(files: Record<string, string>, { withEntries = true } = {}) {
  const distRoot = mkdtempSync(path.join(tmpdir(), 'superdoc-ensure-types-test-'));
  distRoots.push(distRoot);
  const entries: Record<string, string> = withEntries
    ? {
        'superdoc/src/public/index.d.ts': 'declare class SuperDoc {}\nexport { SuperDoc };\n',
        ...Object.fromEntries(publicEntries.map((entry) => [`superdoc/src/public/${entry}.d.ts`, 'export {};\n'])),
      }
    : {};
  for (const [file, content] of Object.entries({ ...entries, ...files })) {
    mkdirSync(path.dirname(path.join(distRoot, file)), { recursive: true });
    writeFileSync(path.join(distRoot, file), content);
  }
  return distRoot;
}

function run(script: string, distRoot: string) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, script)], {
    encoding: 'utf8',
    env: { ...process.env, SUPERDOC_PUBLIC_NPM_OUT_DIR: distRoot, SUPERDOC_AUDIT_INFORMATIONAL: '' },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function read(distRoot: string, file: string) {
  return readFileSync(path.join(distRoot, file), 'utf8');
}

afterEach(() => {
  for (const distRoot of distRoots.splice(0)) rmSync(distRoot, { recursive: true, force: true });
});

describe('ensure-types shared/common relocation', () => {
  it('rewrites each imported name to the file that declares it', () => {
    const distRoot = seedDist({
      'superdoc/src/public/index.d.ts':
        "import { DOCX, CommentEvent } from '@superdoc/common';\ndeclare class SuperDoc {}\nexport type RootEvent = CommentEvent;\nexport { SuperDoc, DOCX };\n",
      'superdoc/src/components/CommentsLayer/use-comment.d.ts':
        "import { CommentEvent, Comment as CommonComment } from '../../../../../shared/common';\nexport type Pair = [CommentEvent, CommonComment];\n",
      'superdoc/src/core/document-open-telemetry.d.ts':
        "export type Client = Pick<import('../../../../shared/common').Telemetry, 'trackDocumentOpen'>;\n",
      'superdoc/src/core/create-app.d.ts':
        "import { vClickOutside as clickOutside } from '@superdoc/common';\nexport type Directive = typeof clickOutside;\n",
    });

    const result = run('ensure-types.cjs', distRoot);
    expect(result.status, result.output).toBe(0);

    const index = read(distRoot, 'superdoc/src/public/index.d.ts');
    expect(index).toContain(
      "declare const DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';",
    );
    expect(index).toContain("import { CommentEvent } from '../../../shared/common/event-types.js';");
    expect(index).not.toContain('@superdoc/common');

    expect(read(distRoot, 'superdoc/src/components/CommentsLayer/use-comment.d.ts')).toContain(
      "import { CommentEvent } from '../../../../shared/common/event-types.js';\nimport { Comment as CommonComment } from '../../../../shared/common/comments-types.js';",
    );
    expect(read(distRoot, 'superdoc/src/core/document-open-telemetry.d.ts')).toContain(
      "import('../../../shared/common/Telemetry.js').Telemetry",
    );
    expect(read(distRoot, 'superdoc/src/core/create-app.d.ts')).toContain(
      "import { default as clickOutside } from '../../../shared/common/helpers/v-click-outside.js';",
    );
    for (const file of ['event-types.d.ts', 'comments-types.d.ts', 'Telemetry.d.ts', 'helpers/v-click-outside.d.ts']) {
      expect(existsSync(path.join(distRoot, 'shared/common', file)), file).toBe(true);
    }

    const audit = run('audit-declarations.cjs', distRoot);
    expect(audit.status, audit.output).toBe(0);
    expect(audit.output).toContain('OK    shared/common specifiers');
  }, 120_000);

  it('fails with the file and symbol when shared/common does not export a name', () => {
    const distRoot = seedDist({
      'superdoc/src/core/collaboration/helpers.d.ts':
        "import { NotACommonExport } from '../../../../../shared/common';\nexport type Missing = NotACommonExport;\n",
    });

    const result = run('ensure-types.cjs', distRoot);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "superdoc/src/core/collaboration/helpers.d.ts: 'NotACommonExport' is not exported by shared/common/index.ts",
    );
  }, 120_000);

  it('fails when an import does not name the symbols it takes', () => {
    const distRoot = seedDist({
      'superdoc/src/core/collaboration/helpers.d.ts':
        "import * as common from '../../../../../shared/common';\nexport type Event = common.CommentEvent;\n",
    });

    const result = run('ensure-types.cjs', distRoot);
    expect(result.status).toBe(1);
    expect(result.output).toContain('superdoc/src/core/collaboration/helpers.d.ts');
    expect(result.output).toContain('must name each symbol');
  }, 120_000);
});

describe('audit-declarations shared/common rule', () => {
  it('fails on shared/common specifiers that do not resolve to an emitted declaration', () => {
    const distRoot = seedDist(
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

    const result = run('audit-declarations.cjs', distRoot);
    expect(result.status).toBe(1);
    expect(result.output).toContain('unrelocated-shared-common');
    expect(result.output).toContain('superdoc/src/bare.d.ts: ../../shared/common');
    expect(result.output).toContain('superdoc/src/missing.d.ts: ../../shared/common/missing.js');
    expect(result.output).not.toContain('superdoc/src/ok.d.ts');
  });
});
