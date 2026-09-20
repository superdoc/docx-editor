import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function installPackedSuperdocFixture({ fixtureRoot, superdocTarball, engineTarball, fontsTarball }) {
  const manifestPath = join(fixtureRoot, 'package.json');
  const workspacePath = join(fixtureRoot, 'pnpm-workspace.yaml');
  const originalManifest = readFileSync(manifestPath, 'utf8');
  let workspaceCreated = false;

  try {
    const manifest = JSON.parse(originalManifest);
    manifest.dependencies = {
      ...manifest.dependencies,
      superdoc: `file:${superdocTarball}`,
      ...(engineTarball ? { '@superdoc/docx-engine': `file:${engineTarball}` } : {}),
      ...(fontsTarball ? { '@superdoc/fonts': `file:${fontsTarball}` } : {}),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (existsSync(workspacePath)) {
      throw new Error(`Packed fixture workspace already exists: ${workspacePath}`);
    }

    // Keep the fixture isolated from repository overrides while allowing the
    // freshly published engine version that the packed SuperDoc artifact pins.
    // pnpm 11 reads both settings only from pnpm-workspace.yaml.
    const workspace = [
      'packages:',
      '  - "."',
      'minimumReleaseAgeExclude:',
      '  - "@superdoc/docx-engine"',
      ...(engineTarball
        ? ['overrides:', `  "@superdoc/docx-engine": ${JSON.stringify(`file:${engineTarball}`)}`]
        : []),
      '',
    ].join('\n');
    writeFileSync(workspacePath, workspace);
    workspaceCreated = true;

    execFileSync(
      'pnpm',
      [
        'install',
        '--ignore-scripts',
        '--no-frozen-lockfile',
        '--no-lockfile',
        '--prefer-offline',
      ],
      { cwd: fixtureRoot, stdio: 'inherit' },
    );
  } finally {
    writeFileSync(manifestPath, originalManifest);
    if (workspaceCreated) rmSync(workspacePath, { force: true });
  }
}
