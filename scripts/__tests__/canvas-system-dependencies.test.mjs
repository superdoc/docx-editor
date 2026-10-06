import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const execFileAsync = promisify(execFile);

async function readRepoFile(relativePath) {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('canvas system dependency installer guards apt commands with timeout and diagnostics', async () => {
  const content = await readRepoFile('scripts/install-canvas-system-dependencies.sh');

  assert.ok(content.includes("dpkg-query --show --showformat='${db:Status-Status}'"));
  assert.ok(content.includes('Canvas system dependencies are already installed.'));
  assert.ok(content.includes('APT_COMMAND_TIMEOUT:-10m'));
  assert.ok(content.includes('timeout "${apt_timeout}" sudo apt-get'));
  assert.ok(content.includes('Acquire::Retries=3'));
  assert.ok(content.includes('Dpkg::Use-Pty=0'));
  assert.ok(content.includes('timed out after ${apt_timeout}'));
  assert.ok(content.includes('fuser -v /var/lib/dpkg/lock'));
});

for (const scenario of [
  { name: 'preserves Blacksmith-managed mirrors', mirrorName: 'blacksmith-ubuntu-mirrors.txt', preserve: true },
  { name: 'uses HTTPS fallbacks for legacy Azure mirrors', mirrorName: 'apt-mirrors.txt', preserve: false },
]) {
  test(`canvas dependency installer ${scenario.name}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-apt-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    const bin = path.join(root, 'bin');
    const mirrorFile = path.join(root, scenario.mirrorName);
    const sourceFile = path.join(root, 'ubuntu.sources');
    const aptLog = path.join(root, 'apt.log');
    await mkdir(bin);
    const originalMirrors = [
      'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1',
      'http://mirrors.edge.kernel.org/ubuntu/\tpriority:2',
      'http://archive.ubuntu.com/ubuntu/\tpriority:3',
      '',
    ].join('\n');
    await writeFile(mirrorFile, originalMirrors);
    await writeFile(sourceFile, `Types: deb\nURIs: mirror+file:${mirrorFile}\nSuites: noble\nComponents: main\n`);
    await writeFile(path.join(bin, 'dpkg-query'), '#!/usr/bin/env bash\nexit 1\n');
    await writeFile(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
    await writeFile(path.join(bin, 'timeout'), '#!/usr/bin/env bash\nshift\nexec "$@"\n');
    await writeFile(
      path.join(bin, 'apt-get'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$APT_TEST_LOG"\n',
    );
    await Promise.all(
      ['dpkg-query', 'sudo', 'timeout', 'apt-get'].map((name) => chmod(path.join(bin, name), 0o755)),
    );

    const installer = path.join(REPO_ROOT, 'scripts/install-canvas-system-dependencies.sh');
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      APT_MIRROR_FILE: '',
      APT_UBUNTU_SOURCES_FILE: sourceFile,
      APT_TEST_LOG: aptLog,
      GITHUB_ACTIONS: 'true',
    };

    await execFileAsync('bash', [installer, '--prepare-mirrors'], { env });
    await assert.rejects(() => access(aptLog), { code: 'ENOENT' });
    if (scenario.preserve) assert.equal(await readFile(mirrorFile, 'utf8'), originalMirrors);
    await writeFile(mirrorFile, originalMirrors);
    await execFileAsync('bash', [installer], { env });

    const mirrors = await readFile(mirrorFile, 'utf8');
    if (scenario.preserve) {
      assert.equal(mirrors, originalMirrors, 'changing provider mirrors discards staged package indexes');
    } else {
      assert.equal(mirrors.includes('azure.archive.ubuntu.com'), false);
      assert.doesNotMatch(mirrors, /http:\/\//);
      assert.match(mirrors, /https:\/\/mirrors\.edge\.kernel\.org/);
      assert.match(mirrors, /https:\/\/archive\.ubuntu\.com/);
    }

    const aptCommands = await readFile(aptLog, 'utf8');
    assert.match(aptCommands, /update/);
    assert.match(aptCommands, /install .*build-essential/);
  });
}

for (const scenario of [
  { name: 'uses only configured Ubuntu sources on GitHub runners', github: 'true', sources: true, scoped: true },
  { name: 'preserves source selection outside GitHub Actions', github: 'false', sources: true, scoped: false },
  { name: 'preserves source selection when Ubuntu sources are unavailable', github: 'true', sources: false, scoped: false },
]) {
  test(`canvas dependency installer ${scenario.name}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-sources-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = path.join(root, 'bin');
    const sourceFile = path.join(root, 'ubuntu.sources');
    const aptLog = path.join(root, 'apt.log');
    const source = 'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
    await mkdir(bin);
    if (scenario.sources) await writeFile(sourceFile, source);
    const commands = {
      'dpkg-query': 'exit 1',
      sudo: 'exec "$@"',
      timeout: 'shift; exec "$@"',
      'apt-get': 'printf "%s\\n" "$*" >> "$APT_TEST_LOG"',
    };
    await Promise.all(Object.entries(commands).map(async ([name, command]) => {
      const file = path.join(bin, name);
      await writeFile(file, `#!/usr/bin/env bash\n${command}\n`);
      await chmod(file, 0o755);
    }));

    await execFileAsync('bash', [path.join(REPO_ROOT, 'scripts/install-canvas-system-dependencies.sh')], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_ACTIONS: scenario.github,
        APT_MIRROR_FILE: path.join(root, 'no-mirrors'),
        APT_UBUNTU_SOURCES_FILE: sourceFile,
        APT_TEST_LOG: aptLog,
      },
    });

    const invocations = (await readFile(aptLog, 'utf8')).trim().split('\n');
    assert.equal(invocations.length, 2, 'update and install both execute');
    for (const invocation of invocations) {
      assert.equal(invocation.includes(`Dir::Etc::sourcelist=${sourceFile}`), scenario.scoped);
      assert.equal(invocation.includes('Dir::Etc::sourceparts=-'), scenario.scoped);
      assert.doesNotMatch(invocation, /AllowUnauthenticated|AllowInsecure|Trusted=yes/i);
    }
    assert.match(invocations[0], /update$/);
    assert.match(invocations[1], /install .*libcairo2-dev/);
    if (scenario.sources) assert.equal(await readFile(sourceFile, 'utf8'), source);
  });
}
