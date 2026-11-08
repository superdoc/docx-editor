/**
 * Fixtures for the public boundary guard.
 *
 * Each case builds a throwaway git repository, drops a file into it, runs the
 * real checker, and asserts the exit code. A guard that cannot fail is worse
 * than no guard, so every rule gets a failing case as well as a passing one.
 *
 * Run:
 *   node --test scripts/__tests__/check-public-boundary.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = resolve(dirname(fileURLToPath(import.meta.url)), '../check-public-boundary.mjs');

/**
 * The checker reads `git ls-files`, so a fixture has to be a real repository
 * with the files staged. It resolves paths relative to its own parent, so it is
 * copied into `<root>/scripts/` to make that parent the fixture root.
 *
 * `symlinks` maps a path to its raw link target, since a symlink carries its
 * path in the link rather than in any file contents `files` could hold.
 */
function runCheckerOn(files, { symlinks = {}, symlinksCheckedOutAsFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'public-boundary-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(CHECKER, join(root, 'scripts', 'check-public-boundary.mjs'));

    for (const [relativePath, contents] of Object.entries(files)) {
      const absolute = join(root, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    }

    for (const [relativePath, target] of Object.entries(symlinks)) {
      const absolute = join(root, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      symlinkSync(target, absolute);
    }

    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });

    for (const [relativePath, target] of Object.entries(symlinksCheckedOutAsFiles)) {
      const absolute = join(root, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, target);
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: target }).toString().trim();
      execFileSync('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},${relativePath}`], { cwd: root });
    }

    const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-public-boundary.mjs')], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('fails an example test that reads a fixture from outside the repository', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/toolbar.spec.ts': `const DOC = new URL('../../../../labs/fixtures/source.docx', import.meta.url);\n`,
  });
  assert.equal(status, 1);
  assert.match(output, /examples\/__tests__\/toolbar\.spec\.ts/);
  assert.match(output, /labs\/fixtures\/source\.docx/);
});

test('passes the same test once it points at an in-repository fixture', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/toolbar.spec.ts': `const DOC = new URL('./fixtures/source.docx', import.meta.url);\n`,
    'examples/__tests__/fixtures/source.docx': 'binary-ish placeholder',
  });
  assert.equal(status, 0, output);
});

test('reports whether an escaping path exists locally, to separate a private dependency from a stale path', () => {
  const { output } = runCheckerOn({
    'examples/app/__tests__/a.test.ts': `import x from '../../../../nonexistent/thing.js';\n`,
  });
  assert.match(output, /does not exist/);
});

test('allows an in-repository relative path that dips through a parent directory', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `import helper from '../../b/helper.js';\n`,
    'packages/b/helper.js': 'export default 1;\n',
  });
  assert.equal(status, 0, output);
});

test('does not miscount a specifier resolved against import.meta.url', () => {
  // `new URL('../..', import.meta.url)` resolves per RFC 3986: the base's last
  // segment (the filename) is dropped first, so from packages/a/tests/a.test.ts
  // this lands on packages/a — still inside.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const root = new URL('../..', import.meta.url);\n`,
  });
  assert.equal(status, 0, output);
});

test('catches an escape written as new URL against import.meta.url', () => {
  // Regression: an earlier version treated this form as file-relative, consuming
  // one extra `..`, so this real escape was reported clean.
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': `const DOC = new URL('../../../labs/private.docx', import.meta.url);\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('catches an escape written as path.resolve from a directory', () => {
  // Same regression via the other idiom: `resolve(__dirname, ...)` is
  // directory-relative, and treating it as file-relative hid the escape.
  const { status, output } = runCheckerOn({
    'examples/__tests__/b.spec.ts': `const p = path.resolve(__dirname, '../../../labs/foo');\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/foo/);
});

test('ignores runtime and build files, which the export seam owns instead', () => {
  const { status, output } = runCheckerOn({
    'packages/superdoc/vite.config.js': `const V2 = path.resolve(__dirname, '../../../v2');\n`,
    'apps/cli/src/lib/document-v2.ts': `export * from '../../../../../v2/headless/dist/index.js';\n`,
  });
  assert.equal(status, 0, output);
});

test('ignores prose that names the private repository without referencing a path', () => {
  const { status, output } = runCheckerOn({
    'examples/README.md': 'Fixtures promoted from the private labs/ corpus are rebuilt here as synthetic documents.\n',
  });
  assert.equal(status, 0, output);
});

test('scans markdown inside a scanned surface for real escaping paths', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/NOTES.md': 'See `../../../../labs/proofing/spec.md` for the scenario.\n',
  });
  assert.equal(status, 1, output);
});

test('catches a cwd-anchored escape that no plausible base keeps inside', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': `const p = path.resolve(process.cwd(), '../../../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('catches a lone cwd-anchored escape rather than guessing a base that suits it', () => {
  // CI launches vitest from the repository root, so `../labs/...` escapes. An
  // earlier version accepted it because a hypothetical file-relative reading
  // stayed inside.
  const { status, output } = runCheckerOn({
    'packages/superdoc/src/a.test.ts': `const p = path.resolve(process.cwd(), '../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('scans Windows-style backslash parent traversals', () => {
  // Escapes on Windows, and posix resolve reads it as one opaque segment, so the
  // Linux guard would otherwise report it clean.
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': 'const p = path.resolve(__dirname, "..\\\\..\\\\..\\\\labs\\\\private.docx");\n',
  });
  assert.equal(status, 1, output);
});

test('carries cwd anchoring across a multiline call', () => {
  // Prettier splits a long `resolve(process.cwd(), '...')`, which puts the base
  // and the literal on different lines. Judging the literal's line alone
  // resolved it from the file and reported this escape clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': [
      'const p = resolve(',
      '  process.cwd(),',
      "  '../private/secret.docx',",
      ');',
      '',
    ].join('\n'),
  });
  assert.equal(status, 1, output);
  assert.match(output, /private\/secret\.docx/);
});

test('does not read a comment mentioning process.cwd() as code', () => {
  // The cwd detector works on statements, and a comment explaining `process.cwd()`
  // used to bleed onto a neighbouring file-relative path and resolve it from the
  // wrong base.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': [
      '// Anchored at this file rather than at process.cwd().',
      "const p = fileURLToPath(new URL('../../b/x.mdx', import.meta.url));",
      '',
    ].join('\n'),
    'packages/b/x.mdx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('resolves an unbased relative path from the runner cwd', () => {
  // `resolve('../x')` and `readFileSync('../x')` take no base, so Node anchors
  // them at the process working directory. Treating them as file-relative
  // classified a root-launched escape as an in-repository path.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const p = resolve('../private/secret.docx');\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /private\/secret\.docx/);
});

test('rejects an absolute path naming somebody home directory', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': `const p = '/home/alice/private/secret.docx';\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /home\/alice/);
});

test('ignores scratch absolute paths that tests pass as synthetic arguments', () => {
  // `/tmp` and friends are how tests hand a path-shaped string to a pure
  // function. Flagging them produced 45 findings across 17 files, none real.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `expect(buildArgs('/tmp/superdoc')).toContain('--minify');\n`,
  });
  assert.equal(status, 0, output);
});

test('an exemption approves only its own candidate, not the whole file', () => {
  // A file-wide exemption would absorb any future escape added beside the
  // approved one. The checker's own fixture file is exempt for `../`-shaped
  // paths, so this asserts the narrower behavior via a second, unrelated shape.
  const { status, output } = runCheckerOn({
    'scripts/__tests__/check-public-boundary.test.mjs': [
      "const approved = '../../labs/fixtures/source.docx';",
      // Assembled so this file does not itself contain a literal home path, which
      // the guard would report on its own next run.
      `const unrelated = '/${'Users'}/someone-else/private/secret.docx';`,
      '',
    ].join('\n'),
  });
  assert.equal(status, 1, output);
  assert.match(output, /someone-else/);
  assert.doesNotMatch(output, /labs\/fixtures\/source\.docx/);
});

test('treats every path-taking fs call as cwd-relative, not just resolve', () => {
  // `readdirSync('../labs/private')` is anchored at the process cwd like the
  // others; an incomplete whitelist resolved it from the test file instead.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const e = readdirSync('../labs/private');\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private/);
});

test('rejects a Windows drive path even on a posix runner', () => {
  // posix `resolve` treats a drive-letter path as a relative segment and places
  // it under REPO_ROOT, which reported it clean. No drive path is ever inside.
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': `const w = 'C:/${'Users'}/alice/private.docx';\n`,
  });
  assert.equal(status, 1, output);
});

test('does not merge semicolon-free statements when anchoring cwd', () => {
  // A base is now read from the enclosing call rather than from a statement
  // delimited by `;`, so automatic semicolon insertion cannot merge two
  // statements and let one's process.cwd() mis-anchor the other.
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': [
      "const p = resolve(process.cwd(), 'apps/x')",
      "const q = new URL('../fixtures/y.mdx', import.meta.url)",
      '',
    ].join('\n'),
    'examples/fixtures/y.mdx': 'y\n',
  });
  assert.equal(status, 0, output);
});

test('does not read a string escape as a Windows drive path', () => {
  // `"d:\\n"` inside YAML fixture text is an escape sequence, not a path.
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': 'const yaml = "jobs:\\n  d:\\n    steps: []";\n',
  });
  assert.equal(status, 0, output);
});

test('a url literal does not hide the cwd base later in the same call', () => {
  // Stripping `//` comments with a regex also cut `https://`, truncating the
  // call before its process.cwd() and resolving a root-launched escape as
  // file-relative, which reported it clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts':
      "const f = load('https://superdoc.dev', resolve(process.cwd(), '../labs/private.docx'));\n",
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('anchors each path at its own call, not at one base per statement', () => {
  // `cwd: process.cwd()` and a sibling `new URL('../x', import.meta.url)` are
  // separate calls. Applying the first call's base to the second resolved an
  // in-repo fixture from the repository root and failed CI on a valid path.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': [
      'const opts = {',
      '  cwd: process.cwd(),',
      "  fixture: new URL('../../../shared/fixtures/x.docx', import.meta.url),",
      '};',
      '',
    ].join('\n'),
    'shared/fixtures/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('anchors a call at the cwd when every earlier argument is relative', () => {
  // `resolve('fixtures', '../../private/x')` is cwd-relative: no absolute base
  // was ever passed. Requiring the candidate to be the first argument missed it
  // and resolved from the file instead, which reported an escape as clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = resolve('fixtures', '../../private/secret.docx');\n",
  });
  assert.equal(status, 1, output);
});

test('still treats an explicit directory base as file-relative', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = resolve(__dirname, '../../../shared/fix/x.docx');\n",
    'shared/fix/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('finds a traversal that follows a leading child segment', () => {
  // `fixtures/../../private/x` leaves the root, but a pattern anchored at the
  // start of the literal matched nothing and the file passed.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = resolve(process.cwd(), 'fixtures/../../private/secret.docx');\n",
  });
  assert.equal(status, 1, output);
});

test('finds a traversal that follows a ./ prefix', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': "const u = new URL('./fixtures/../../../../labs/private.docx', import.meta.url);\n",
  });
  assert.equal(status, 1, output);
});

test('does not read // in a markdown url as the start of a comment', () => {
  // `//` is a comment in JS, not in Markdown. Applying the JS rule everywhere
  // let a plain URL swallow the rest of its line, hiding an escaping link.
  const { status, output } = runCheckerOn({
    'examples/README.md': 'See https://example.com and [fixture](../../../private/secret.docx)\n',
  });
  assert.equal(status, 1, output);
});

test('resolves a cdn-smoke path from the directory its lane runs in', () => {
  // ci-superdoc.yml runs this suite with working-directory
  // packages/superdoc/tests/cdn-smoke.
  const { status, output } = runCheckerOn({
    'packages/superdoc/tests/cdn-smoke/a.spec.ts': "const f = readFileSync('../fixtures/x.docx');\n",
    'packages/superdoc/tests/fixtures/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('anchors a bare path.join at the runner cwd', () => {
  // The innermost call is `join`, not the fs call wrapping it, so leaving `join`
  // out of the cwd-anchored set resolved the path from the source directory.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = readFileSync(path.join('../labs/private.docx'));\n",
  });
  assert.equal(status, 1, output);
});

test('treats require.resolve as module-relative, not cwd-relative', () => {
  // `require.resolve` resolves from the calling module. Stripping the receiver
  // made it indistinguishable from `path.resolve` and failed an in-repo path.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.cjs': "const p = require.resolve('../../../shared/x.cjs');\n",
    'shared/x.cjs': 'module.exports = 1;\n',
  });
  assert.equal(status, 0, output);
});

test('checks each path argument of a two-path call on its own', () => {
  // A destination is its own path, not a suffix appended to the source, so an
  // absolute first argument says nothing about the second.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "copyFileSync('/tmp/source.docx', '../labs/private.docx');\n",
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('scans a python fixture, not only the javascript family', () => {
  // Every non-JS extension was skipped before its contents were read, so a
  // private dependency in a `.py`, `.sh`, `.html`, or `.cts` file passed.
  const { status, output } = runCheckerOn({
    'packages/sdk/tests/test_fixture.py': "PATH = '../../../../labs/private.docx'\n",
  });
  assert.equal(status, 1, output);
});

test('scans an html fixture', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/fixtures/a.html': '<img src="../../../../labs/private.png">\n',
  });
  assert.equal(status, 1, output);
});

test('finds a traversal composed from separate arguments', () => {
  // `resolve(base, '..', '..', 'x')` joins to the same path a single literal
  // would, but no fragment carries a separator, so the literal pattern saw
  // nothing. This form appears in 18 files here.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const p = resolve(__dirname, '..', '..', '..', '..', 'labs/private.docx');\n",
  });
  assert.equal(status, 1, output);
});

test('does not flag a composed traversal that stays inside the repository', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const p = resolve(__dirname, '..', '..', '..', 'shared/fix/x.docx');\n",
    'shared/fix/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('does not read a root-absolute html src as a filesystem path', () => {
  // `<script src="/src/main.tsx">` is how Vite serves an entry point. Treating
  // every absolute root as a path produced 37 findings across 29 files, all of
  // them this, which is why the pattern covers only /home/ and /Users/.
  const { status, output } = runCheckerOn({
    'examples/x/index.html': '<script type="module" src="/src/main.tsx"></script>\n',
  });
  assert.equal(status, 0, output);
});

test('reports a traversal that ends at a directory', () => {
  // `new URL('../../../', import.meta.url)` has no filename after the last
  // separator, so a pattern requiring a path character there matched nothing.
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.spec.ts': "const u = new URL('../../../', import.meta.url);\n",
  });
  assert.equal(status, 1, output);
});

test('carries preceding relative segments into the resolution', () => {
  // `resolve('fixtures', '../shared/x.docx')` from the root is
  // `<root>/shared/x.docx`, which is inside. Treating the earlier segments as
  // mere evidence about the base, then resolving only the candidate, put it one
  // level too high and failed a valid path.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = resolve('fixtures', '../shared/x.docx');\n",
    'shared/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('reads a template interpolation as code', () => {
  // `${...}` inside a backtick string is code. Staying in string mode through it
  // meant the call's parentheses were never recorded, so the base was lost.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const p = `${resolve(process.cwd(), '../labs/private.docx')}`;\n",
  });
  assert.equal(status, 1, output);
});

test('treats a comment in a cts or mts test as prose', () => {
  // Both are TypeScript, so `//` starts a comment. Scanning them without that
  // rule read a comment about an old path as a live dependency.
  for (const file of ['tests/consumer-typecheck/a.test.cts', 'tests/consumer-typecheck/b.test.mts']) {
    const { status, output } = runCheckerOn({
      [file]: '// the old fixture was ../../../../labs/private/x.cjs\nexport const a = 1;\n',
    });
    assert.equal(status, 0, `${file}: ${output}`);
  }
});

test('does not let a nested cwd base leak into a later independent path', () => {
  // `copyFileSync(resolve(process.cwd(), 'fixtures/a.docx'), '../labs/x.docx')`.
  // The destination is its own path, resolved at the cwd; reading the whole
  // argument list prefixed it with `fixtures/a.docx` and reported it clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts':
      "copyFileSync(resolve(process.cwd(), 'fixtures/source.docx'), '../labs/private.docx');\n",
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('still reads earlier arguments as the base for a join-style call', () => {
  // The scoping above must not apply here: for `join`/`resolve` the earlier
  // arguments ARE the base, and treating them as a separate path made 48 real
  // files fail on paths that resolve inside the repository.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = join(import.meta.dir, '../../shared/fix/x.docx');\n",
    'shared/fix/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('treats a native comment as prose in every scanned language', () => {
  // Applying the JavaScript grammar everywhere failed the gate for a `#` comment
  // in a Python, shell, or YAML file and for an HTML `<!-- -->` comment.
  const cases = {
    'packages/sdk/tests/t.py': '# old fixture ../../../../labs/private.docx\nX = 1\n',
    'examples/x/tests/run.sh': '# old fixture ../../../../labs/private.docx\necho hi\n',
    'examples/__tests__/a.yaml': '# old fixture ../../../../labs/private.docx\nkey: value\n',
    'examples/__tests__/a.html': '<!-- old fixture ../../../../labs/private.docx -->\n<p>hi</p>\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file}: ${output}`);
  }
});

test('still finds a real path in a language whose comments it now knows', () => {
  // The grammar must not turn into a blanket exemption for those formats.
  const { status, output } = runCheckerOn({
    'packages/sdk/tests/t.py': "PATH = '../../../../labs/private.docx'\n",
  });
  assert.equal(status, 1, output);
});

test('closes a template interpolation on its own brace, not an inner one', () => {
  // An object literal inside the interpolation closes a brace of its own. Keying
  // the interpolation's end on paren depth treated that as the end, so the call
  // after it was scanned as backtick text and lost its cwd base.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const p = `${{ ok: true } && resolve(process.cwd(), '../labs/private.docx')}`;\n",
  });
  assert.equal(status, 1, output);
});

test('composes segments that follow an explicit directory base', () => {
  // `resolve(__dirname, '..', '../../../labs/x')` composes both relative
  // arguments. Discarding the intervening `'..'` resolved one level too low and
  // reported the escape as clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = resolve(__dirname, '..', '../../../labs/private.docx');\n",
  });
  assert.equal(status, 1, output);
});

test('does not over-compose a directory base that stays inside', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': "const f = resolve(__dirname, '..', 'fix/x.docx');\n",
    'packages/a/fix/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('looks through a path transformer to the call that anchors it', () => {
  // `normalize` returns its argument rewritten, not resolved, so the outer
  // `readFileSync` is what anchors it at the runner cwd. Reading only the
  // innermost call found `normalize`, which is not a path-taking API, and
  // resolved this root-launched escape from the test file instead.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const d = readFileSync(path.normalize('../labs/private.docx'));\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /labs\/private\.docx/);
});

test('still takes the base from the call around a path transformer', () => {
  // Unwrapping must stop at the first call that is not a pass-through:
  // `resolve(__dirname, normalize('../x'))` is directory-relative, so treating
  // `normalize` itself as cwd-anchored would fail this in-repository path.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const d = resolve(__dirname, path.normalize('../../shared/fix/x.docx'));\n`,
    'shared/fix/x.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('matches a composed traversal whose last fragment ends the argument list', () => {
  // `resolve(__dirname, '..', '..')` is a whole path. Requiring a trailing comma
  // on every `'..'` fragment matched nothing here, and the slash-based pattern
  // needs a separator, so from examples/ this real escape was reported clean.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': `const r = resolve(__dirname, '..', '..');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not read a non-path array of dot-dot strings as a traversal', () => {
  // `expect(parts).toEqual(['..', '..', 'literal'])` is expected data. Joining the
  // fragments unconditionally produced `../../literal` and failed the gate on an
  // array that never reaches the filesystem.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': `expect(parts).toEqual(['..', '..', 'literal']);\n`,
  });
  assert.equal(status, 0, output);
});

test('matches a lone dot-dot fragment that composes a whole path', () => {
  // `resolve(process.cwd(), '..')` from a root-launched test is the repository's
  // parent. Requiring two `'..'` fragments read a single one as ordinary, and the
  // slash-based pattern needs a separator the fragment does not carry, so this
  // real escape produced no candidate at all and was reported clean.
  const { status, output } = runCheckerOn({
    'tests/a.test.ts': `const root = resolve(process.cwd(), '..');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not read a lone dot-dot string outside a path-composing call', () => {
  // The pattern now matches one fragment, so the composer check is what keeps
  // ordinary data ordinary. Without it, matching a single `'..'` would fail the
  // gate on every array and assertion that happens to contain one.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': `expect(segment).toEqual('..');\n`,
  });
  assert.equal(status, 0, output);
});

test('anchors every path-taking fs call at the cwd, not only the listed ones', () => {
  // The anchored set was hand-kept and reached 30 names with `unlinkSync`
  // missing, so a root-launched `unlinkSync('../labs/private.docx')` resolved
  // from the source directory and stayed inside. The set is read from `node:fs`
  // now, so a name Node adds later is covered without an edit here.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `unlinkSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not anchor a descriptor-first fs call at the cwd', () => {
  // `writeSync(fd, ...)` takes a file descriptor, not a path. Reading the set
  // from the module without excluding these would anchor its first argument at
  // the repository root, so a descriptor call whose own first argument happens
  // to read as a path would be resolved as one.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `writeSync('../labs/handle', buffer);\n`,
  });
  assert.equal(status, 0, output);
});

test('treats the second native comment form of a format as prose too', () => {
  // PHP has `#` as well as `//`, and a `.vue` file is two languages, so its
  // template comments are `<!-- -->`. Giving each format one form failed the gate
  // for a valid comment written in the other.
  const cases = {
    'examples/__tests__/x.php': '<?php\n# old fixture ../../../labs/private.docx\n$p = 1;\n',
    'examples/__tests__/a.vue':
      '<template>\n  <!-- old fixture ../../../labs/private.docx -->\n  <p>hi</p>\n</template>\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file}: ${output}`);
  }
});

test('still finds a real path in php and vue beside their added comment forms', () => {
  // The added grammars must not become blanket exemptions for those formats.
  const cases = {
    'examples/__tests__/x.php': "<?php\n$p = '../../../labs/private.docx';\n",
    'examples/__tests__/a.vue': '<template>\n  <img src="../../../labs/private.png">\n</template>\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file}: ${output}`);
  }
});

test('anchors the first argument of every two-path filesystem call', () => {
  // `rename`, `link`, and `symlink` were in the independent-arguments set, which
  // their second argument needs, but absent from the cwd-anchored set, so even the
  // first argument fell through to file-relative resolution.
  for (const call of [
    "renameSync('../labs/private.docx', 'renamed.docx');",
    "linkSync('../labs/private.docx', 'l.docx');",
    "symlinkSync('../labs/private.docx', 's.docx');",
  ]) {
    const { status, output } = runCheckerOn({ 'packages/a/tests/a.test.ts': `${call}\n` });
    assert.equal(status, 1, `${call}: ${output}`);
  }
});

test('does not read path.relative as composing its arguments', () => {
  // `path.relative('..', '..')` compares two endpoints and returns `''`. Reading
  // it as a composer joined the literals into `../..`, which from a shallow file
  // resolves outside and failed the gate on a call that never escapes.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': `const r = relative('..', '..');\n`,
  });
  assert.equal(status, 0, output);
});

test('looks through dirname before choosing the base', () => {
  // `dirname` shortens a path but keeps its traversal, so the outer call still
  // receives `../../../labs` and anchors it at the cwd. Stopping at `dirname`
  // judged the literal file-relative, which from a nested test stayed inside and
  // reported this escape clean.
  const { status, output } = runCheckerOn({
    'packages/superdoc/src/__tests__/a.test.ts': `readFileSync(path.dirname('../../../labs/private.docx'));\n`,
  });
  assert.equal(status, 1, output);
});

test('catches a bare parent argument to a filesystem call', () => {
  // `readdirSync('..')` from a root-launched test reads the repository's parent.
  // A filesystem call does not join its arguments, so it is not a composer, and
  // asking only about composition discarded this lone `..` before it was
  // resolved. Being cwd-anchored is the other way a fragment becomes a path.
  const { status, output } = runCheckerOn({
    'tests/a.test.ts': `const entries = readdirSync('..');\n`,
  });
  assert.equal(status, 1, output);
});

test('still ignores a bare dot-dot that no call anchors or composes', () => {
  // The pairing above is what keeps ordinary data ordinary: a `'..'` that is
  // neither anchored at the cwd nor joined into a path is just a string.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': `expect(segments).toEqual(['..']);\n`,
  });
  assert.equal(status, 0, output);
});

test('anchors a dotted variant of a filesystem call', () => {
  // `realpathSync.native('../x')` reads its callee name as `native`, which is in
  // no set, so the path fell back to file-relative resolution and from a nested
  // test this root-launched escape was reported clean. The function the variant
  // hangs off is what decides the base.
  const { status, output } = runCheckerOn({
    'packages/superdoc/src/__tests__/a.test.ts': `realpathSync.native('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not anchor a dotted call whose base function is not path-taking', () => {
  // The receiver is only consulted when the name itself is unknown, so this must
  // not turn any dotted call into a filesystem call.
  const { status, output } = runCheckerOn({
    'packages/superdoc/src/__tests__/a.test.ts': `logger.child('../labs/note.txt');\n`,
  });
  assert.equal(status, 0, output);
});

test('looks through a pass-through template tag to the first argument', () => {
  // `String.raw` has no parentheses of its own, so it stayed in the preceding
  // text and the candidate read as a later argument, which sent the literal back
  // to file-relative resolution. The tag hands it back unchanged, so it decides
  // nothing about the base.
  const { status, output } = runCheckerOn({
    'packages/superdoc/src/__tests__/a.test.ts': 'readFileSync(String.raw`../../../../labs/private.docx`);\n',
  });
  assert.equal(status, 1, output);
});

test('does not read a comment in an argument list as the base', () => {
  // `resolve(__dirname, /* not process.cwd() */ '../../b/ok.txt')` from
  // `packages/a/tests/` is `packages/b/ok.txt`, which exists. The raw-text search
  // found `process.cwd()` in the comment, resolved the path from the repository
  // root instead, and reported a valid target as missing.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const p = resolve(__dirname, /* not process.cwd() */ '../../b/ok.txt');\n`,
    'packages/b/ok.txt': 'ok\n',
  });
  assert.equal(status, 0, output);
});

test('still reads a real process.cwd() base beside a comment', () => {
  // Blanking comments must not blank the code around them.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const p = resolve(process.cwd(), /* the root */ '../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors a Python relative path at the runner cwd', () => {
  // The scanned surfaces hold Python tests and examples, and a relative path in
  // Python resolves from the process working directory the same way. `Path` was
  // in no set, so the literal was read as file-relative, which from a nested
  // test stayed inside and reported a real escape clean.
  const { status, output } = runCheckerOn({
    'packages/sdk/langs/python/tests/probe_test.py': "p = Path('../labs/private.docx')\n",
  });
  assert.equal(status, 1, output);
});

test('catches a machine path inside a file URL', () => {
  // `file:///home/alice/x.docx` is a real machine-local dependency Node accepts.
  // The absolute pattern needed `/home` to follow a quote or whitespace, and here
  // it follows the URL's own third slash, so the escape produced no candidate.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `readFileSync(new URL('file:///home/alice/private.docx'));\n`,
  });
  assert.equal(status, 1, output);
});

test('does not read a server route as a machine path', () => {
  // A machine-shaped literal is a private dependency wherever it sits, except in
  // a route: `app.get('/home/alice/profile', handler)` names a URL, the scanned
  // surfaces can hold example servers, and the unconditional job failed on one
  // even though nothing touches the filesystem.
  const { status, output } = runCheckerOn({
    'examples/server/a.test.ts': `app.get('/home/alice/profile', handler);\n`,
  });
  assert.equal(status, 0, output);
});

test('still rejects a machine path a route-named call does not receive', () => {
  // The exception is narrow on purpose. A bare `get(...)` with no receiver is not
  // a route registration, and a machine path assigned to a variable is the shape
  // this guard most wants to catch.
  const cases = {
    'examples/a.test.ts': `get('/${'home'}/alice/private.docx');\n`,
    'examples/b.test.ts': `const p = '/${'home'}/alice/private.docx';\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('rejects a file URL even where a route would be allowed', () => {
  // `file://` can only be a path, so it overrides the route exception.
  const { status, output } = runCheckerOn({
    'examples/server/a.test.ts': `app.get(new URL('file:///${'home'}/alice/x.docx'), handler);\n`,
  });
  assert.equal(status, 1, output);
});

test('scans an extensionless build input for escapes', () => {
  // `examples/collaborative-agent/Makefile` and its `server/Dockerfile` are tracked,
  // and an escaping `include` or `COPY` source in either breaks a public clone
  // the same way an import does. The extension allowlist skipped them before
  // their contents were read, so the required job reported clean on a real escape.
  const cases = {
    'examples/agent/Makefile': 'include ../../../../labs/private.mk\n',
    'examples/agent/server/Dockerfile': 'COPY ../../../../labs/private.pem /app/key.pem\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('treats a hash comment in an extensionless build input as prose', () => {
  // Those formats are `#`-commented, so a path in one is prose about a path the
  // same way it is in a shell or YAML test.
  const { status, output } = runCheckerOn({
    'examples/agent/Dockerfile': '# old key lived at ../../../../labs/private.pem\nFROM node:22\n',
  });
  assert.equal(status, 0, output);
});

test('does not let a regex containing an escaped slash-slash hide an escape', () => {
  // `const r = /\/\//` holds the two characters that open a line comment, so the
  // scanner switched to comment mode at the regex and read the rest of that line
  // as prose. Nine tracked files contain such a regex, so a real escape written
  // after one passed the gate.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': 'const r = /\\/\\//; const p = "../../../labs/private.docx";\n',
  });
  assert.equal(status, 1, output);
});

test('still treats a real line comment as prose beside a slash', () => {
  // The blanking is narrow on purpose. A full regex-versus-division heuristic
  // misjudges comment text containing a slash, which is an over-report on a gate
  // that blocks merges, so only the escaped form is matched.
  const cases = {
    'examples/a.test.ts': 'const p = 1; // see ../../../labs/private.docx\n',
    'examples/b.test.ts': 'const p = 1; /* ../../../labs/private.docx */\n',
    'examples/c.test.ts': 'const r = /\\/\\//; export { r };\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('anchors a shell path at the runner cwd', () => {
  // A shell script has no callee to consult: `cat '../../labs/x'` hands the
  // argument straight to a command, resolved from wherever the script was
  // launched. Reading it from the script's own directory turned a real escape
  // into an in-repository path -- from `packages/a/tests/` that literal reads as
  // `packages/labs/...`, which exists nowhere and looked clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.sh': "#!/bin/sh\ncat '../../labs/private.docx'\n",
  });
  assert.equal(status, 1, output);
});

test('does not flag an in-repository shell path', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.sh': "#!/bin/sh\ncat './fixtures/ok.docx'\n",
    'packages/a/tests/fixtures/ok.docx': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('does not read a shell parameter-length expansion as a comment', () => {
  // `${#value}` is the shell's parameter-length expansion, not a comment. Taking
  // its `#` as a comment opener blanked the rest of the line, so an escaping
  // argument after one was never seen.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.sh': '#!/bin/sh\necho ${#value}; cat "../../labs/private.docx"\n',
  });
  assert.equal(status, 1, output);
});

test('still treats a real shell comment as prose', () => {
  // A `#` opens a comment where a word does not run into it, which covers both
  // the line-start and the trailing forms.
  const cases = {
    'packages/a/tests/a.sh': '#!/bin/sh\n# note ../../labs/private.docx\n',
    'packages/a/tests/b.sh': '#!/bin/sh\necho hi   # note ../../labs/private.docx\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('scans an extensionless entrypoint that carries a shebang', () => {
  // `examples/getting-started/laravel/artisan` is a tracked PHP entrypoint, and
  // an escaping `require` in it was invisible while the same line in a `.php`
  // file was rejected. The shebang decides, so a new entrypoint is covered
  // without adding its name anywhere.
  const { status, output } = runCheckerOn({
    'examples/laravel/artisan': '#!/usr/bin/env php\n<?php\nrequire "../../../../labs/private.php";\n',
  });
  assert.equal(status, 1, output);
});

test('reads an extensionless entrypoint with its interpreter comment syntax', () => {
  // The program named in the shebang decides the grammar: `php` means PHP
  // comments, so a path in one is prose rather than a dependency.
  const { status, output } = runCheckerOn({
    'examples/laravel/artisan': '#!/usr/bin/env php\n<?php\n// old: ../../../../labs/private.php\n',
  });
  assert.equal(status, 0, output);
});

test('the route exemption covers only a router first argument', () => {
  // Exempting any `.get(...)` with any receiver was too broad: of the
  // route-shaped calls in the scanned surfaces most are Maps and caches, and a
  // machine path handed to a later parameter is not a route either.
  const cases = {
    'examples/a.test.ts': `cache.get('/${'home'}/alice/private.docx');\n`,
    'examples/b.test.ts': `app.get('/ok', '/${'home'}/alice/private.docx');\n`,
    'examples/c.test.ts': `get('/${'home'}/alice/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('a router first argument is still a route', () => {
  const cases = {
    'examples/a.test.ts': `app.get('/home/alice/profile', handler);\n`,
    'examples/b.test.ts': `router.use('/home/alice/x', mw);\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('does not let a regex brace close a template interpolation', () => {
  // Inside `${...}` a regex holding a `}` was counted as the interpolation's
  // terminator, so the call after it was scanned as template text, lost its cwd
  // base, and a root-relative escape resolved from the source file instead.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': 'const x = `${/}/.test("}") && resolve(process.cwd(), "../labs/private.docx")}`;\n',
  });
  assert.equal(status, 1, output);
});

test('still reads an ordinary braced regex as code', () => {
  // Blanking a regex must not disturb the file around it.
  const { status, output } = runCheckerOn({
    'examples/a.test.ts': 'const r = /a{2}/; export { r };\n',
  });
  assert.equal(status, 0, output);
});

test('anchors an extensionless shell entrypoint at the runner cwd too', () => {
  // The two halves of shebang support disagreed: an extensionless `#!/bin/sh`
  // entrypoint was scanned and read with shell comments, then resolved from its
  // own directory anyway, because only `.sh` was treated as cwd-relative.
  const cases = {
    'packages/a/tests/run-thing': '#!/bin/sh\ncat "../../labs/private.docx"\n',
    'packages/a/tests/run-bash': '#!/usr/bin/env bash\ncat "../../labs/private.docx"\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not treat every extensionless entrypoint as cwd-relative', () => {
  // A `#!/usr/bin/env node` entrypoint is directory-relative like any module, so
  // an in-repository import resolves from its own directory and stays clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/run-node': '#!/usr/bin/env node\nimport x from "../../b/helper.js";\n',
    'packages/b/helper.js': 'export default 1;\n',
  });
  assert.equal(status, 0, output);
});

test('does not anchor a same-named call that is not path.resolve', () => {
  // `Promise.resolve` shares the name and touches nothing, so anchoring it at the
  // cwd failed the required job on expected data that never reaches the
  // filesystem. A false positive on a merge gate is the worse direction.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const p = Promise.resolve('../labs/private.docx');\n`,
  });
  assert.equal(status, 0, output);
});

test('still anchors a real path.resolve', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const p = path.resolve('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors the rest of the Python filesystem surface', () => {
  // Only `Path` and `open` were listed, so the standard `os` and `shutil` calls
  // were resolved from the source directory and a real escape stayed inside.
  const cases = {
    'packages/a/tests/a_test.py': 'import os\nos.remove("../labs/private.docx")\n',
    'packages/a/tests/b_test.py': 'import shutil\nshutil.copy("../labs/private.docx", "x")\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('reads a statically computed filesystem call as the name it spells', () => {
  // `fs['readFileSync'](...)` returned no callee name at all, because only
  // identifier and dot characters were consumed, so the call anchored nothing.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `fs['readFileSync']('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('rejects a symlink whose target escapes the repository', () => {
  // Both directions of the same gap. A dangling target reached the read's
  // `catch` and was skipped; an existing one was followed, so the *target's*
  // contents were scanned under the link's name and the escaping link path
  // itself was never resolved.
  const dangling = runCheckerOn(
    { 'examples/__tests__/a.spec.ts': 'export const x = 1;\n' },
    { symlinks: { 'examples/__tests__/fixture.ts': '../../../labs/nonexistent.ts' } },
  );
  assert.equal(dangling.status, 1, dangling.output);
  assert.match(dangling.output, /examples\/__tests__\/fixture\.ts/);

  // A `.docx` link is caught too: extension decides whether *contents* are worth
  // reading, and a symlink has none to read.
  const binary = runCheckerOn({}, { symlinks: { 'examples/__tests__/source.docx': '../../../labs/private.docx' } });
  assert.equal(binary.status, 1, binary.output);
});

test('allows a symlink that stays inside the repository', () => {
  // Mirrors the shape the public tree uses for an AGENTS.md/CLAUDE.md pair.
  const { status, output } = runCheckerOn(
    { 'examples/__tests__/AGENTS.md': 'notes\n' },
    { symlinks: { 'examples/__tests__/CLAUDE.md': 'AGENTS.md' } },
  );
  assert.equal(status, 0, output);
});

test('scans an SVG asset for an escaping reference', () => {
  // SVG is XML rather than a binary, and the scanned surfaces track 14 of them.
  // Skipping the extension meant a demo asset could keep a private dependency.
  const { status, output } = runCheckerOn({
    'examples/app/public/logo.svg': '<svg><image href="../../../../labs/private.png"/></svg>\n',
  });
  assert.equal(status, 1, output);
});

test('treats an SGML comment in an SVG as prose', () => {
  const { status, output } = runCheckerOn({
    'examples/app/public/logo.svg': '<svg><!-- was ../../../../labs/private.png --></svg>\n',
  });
  assert.equal(status, 0, output);
});

test('does not read a hash after a token as a comment in Python or PHP', () => {
  // `#` opens a comment in both without needing a preceding boundary, so the
  // shell's `${#value}` exception must not be applied to them: `x=1# '../x'`
  // is entirely comment text and failed the unconditional job.
  const cases = {
    'packages/a/tests/a_test.py': `x=1# '../../labs/private.docx'\n`,
    'packages/a/tests/a.php': `<?php\n$x=1# '../../labs/private.docx'\n;\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still reads a Python path that only looks like a comment suffix', () => {
  // The boundary rule is gone for Python, not the scanning: real code on the
  // line before any `#` is still code.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a_test.py': `open("../labs/private.docx")# note\n`,
  });
  assert.equal(status, 1, output);
});

test('does not let a regex character class holding a slash open a comment', () => {
  // `/[/*]/` is a valid regex. The other two regex shapes stop at the first bare
  // slash so they never saw it, and its `/*` opened a block comment that ran to
  // the end of the file: every candidate after it read as prose, so the escape
  // below was reported clean.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const matcher = /[/*]/;\nreadFileSync('../../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('leaves a path-shaped character class visible', () => {
  // The blanking only ever removes comment-opening characters, so a class body
  // that reads like a path is left alone: neutralizing it could only hide an
  // escape, which is what this pass exists to prevent.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const s = '[../../../../labs/private.docx]';\nreadFileSync('../../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not read an array join separator as a path', () => {
  // `path.join` and `Array.prototype.join` share a name and mean opposite things.
  // Anchoring by name alone failed the required job on a separator string that
  // touches nothing. Nested, so a file-relative reading stays inside: what this
  // removes is the cwd anchoring, not the rule that a literal escaping from its
  // own directory is reported wherever it sits.
  const cases = {
    'packages/a/b/c/tests/a.test.ts': `const s = ['x','y'].join('../../../../labs/private.docx');\n`,
    'packages/a/b/c/tests/b.test.ts': `const s = xs.map(f).join('../../../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still anchors a real path.join', () => {
  // The exclusion is structural, on a receiver ending in `]` or `)`. A bare
  // identifier could name either an array or a path alias, so it stays anchored.
  const cases = {
    'packages/a/tests/a.test.ts': `path.join('../../../../labs/private.docx');\n`,
    'packages/a/tests/b.test.ts': `join('../../../../labs/private.docx');\n`,
    'packages/a/tests/c.test.ts': `segments.join('../../../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not judge a traversal whose leading segments are discarded', () => {
  // `path.basename('../../../../labs/private.docx')` is `private.docx`, so the
  // outer call reads `<cwd>/private.docx` — inside the repository, wherever the
  // traversal pointed. Judging the original literal failed the required job on a
  // line that reaches nothing outside.
  const cases = {
    'packages/a/b/c/tests/a.test.ts': `readFileSync(path.basename('../../../../labs/private.docx'));\n`,
    'packages/a/b/c/tests/a_test.py': `open(Path('../../../../labs/private.docx').name)\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still judges a transformer that keeps the traversal', () => {
  // `dirname` shortens the path but keeps the traversal, and `normalize` hands it
  // back unchanged. Only the innermost call counts: `basename(resolve(...))` is a
  // different expression whose inner `resolve` really does anchor it.
  const cases = {
    'packages/a/b/c/tests/a.test.ts': `readFileSync(path.dirname('../../../../labs/private.docx'));\n`,
    'packages/a/b/c/tests/b.test.ts': `readFileSync(path.normalize('../../../../labs/private.docx'));\n`,
    'packages/a/b/c/tests/c.test.ts': `path.basename(resolve('../../../../labs/private.docx'));\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a PHP filesystem call at the runner cwd', () => {
  // PHP resolves a relative path from the process working directory, and
  // examples.yml launches the Laravel example from its own root. Only shell
  // had a language-level cwd rule, so this escape was resolved from the deeper
  // `routes/` directory and reported clean.
  const cases = {
    'examples/getting-started/laravel/routes/web.php': `<?php\nfile_get_contents('../../../../labs/private.docx');\n`,
    'examples/getting-started/laravel/routes/api.php': `<?php\nfopen('../../../../labs/private.docx', 'r');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not flag an in-repository PHP path', () => {
  const { status, output } = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php\nfile_get_contents('./fixture.txt');\n`,
    'examples/getting-started/laravel/routes/fixture.txt': 'x\n',
  });
  assert.equal(status, 0, output);
});

test('does not read a printed shell string as a filesystem access', () => {
  // The shell rule has no callee to consult, so every traversal-shaped string in
  // a script read as an access: a fixture that only prints one failed the gate.
  const cases = {
    'packages/a/tests/a.sh': `#!/bin/sh\nprintf '%s\\n' '../labs/private.docx'\n`,
    'packages/a/tests/b.sh': `#!/bin/sh\necho '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still reads a shell string that can reach the filesystem', () => {
  // The exclusion lapses for a pipe, substitution, or another command on the
  // same line. It is only ever the two output-only builtins, matched on a word
  // boundary.
  const cases = {
    'packages/a/tests/a.sh': `#!/bin/sh\ncat '../labs/private.docx'\n`,
    'packages/a/tests/c.sh': `#!/bin/sh\necho '../labs/private.docx' | xargs cat\n`,
    'packages/a/tests/d.sh': `#!/bin/sh\ncat $(echo '../labs/private.docx')\n`,
    'packages/a/tests/e.sh': `#!/bin/sh\necho 'x'; cat '../labs/private.docx'\n`,
    'packages/a/tests/f.sh': `#!/bin/sh\nechoserver '../labs/private.docx'\n`,
    'packages/a/tests/g.sh': `#!/bin/sh\nprintf '%s' 'x'\ncat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a package-local lane at the directory pnpm runs it from', () => {
  // `pnpm --prefix <dir> run <script>` changes to <dir> first — verified against
  // pnpm 11, where `pnpm --prefix apps/mcp run` reports a cwd of `<root>/apps/mcp`.
  // ci-mcp.yml runs the MCP tests that way, so a fixture path that is correct at
  // runtime resolved two levels too high and failed the required job.
  const { status, output } = runCheckerOn({
    'apps/mcp/src/__tests__/a.test.ts': `readFileSync('../../shared/common/data/blank.docx');\n`,
    'shared/common/data/blank.docx': 'x',
  });
  assert.equal(status, 0, output);
});

test('still catches a real escape from a package-local lane', () => {
  const { status, output } = runCheckerOn({
    'apps/mcp/src/__tests__/a.test.ts': `readFileSync('../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('reads a Makefile recipe line as shell, not as Make', () => {
  // A recipe line starts with a TAB and is handed to the shell verbatim, so
  // `$${#value}` is the parameter-length expansion. Reading its `#` as a Make
  // comment blanked the rest of the line and hid the escaping `cat` after it.
  const { status, output } = runCheckerOn({
    'examples/a/b/c/Makefile': `run:\n\techo $\${#value}; cat '../../../../../labs/private.docx'\n`,
  });
  assert.equal(status, 1, output);
});

test('still treats a Makefile comment line as prose', () => {
  // Only recipe lines are shell. A `#` at the start of a Make line opens a comment
  // with no boundary needed, which is why the flag is scoped rather than global.
  const { status, output } = runCheckerOn({
    'examples/a/b/c/Makefile': `# note ../../../../../labs/private.docx\nrun:\n\ttrue\n`,
  });
  assert.equal(status, 0, output);
});

test('does not read a generic method name as a Python filesystem call', () => {
  // `remove`, `move`, `copy` and `walk` are ordinary JavaScript method names.
  // Anchoring them in every language failed the required job on calls that never
  // touch the filesystem.
  const cases = {
    'packages/a/b/c/tests/a.test.ts': `cache.remove('../../labs/private.docx');\n`,
    'packages/a/b/c/tests/b.test.ts': `queue.move('../../labs/private.docx');\n`,
    'packages/a/b/c/tests/c.test.ts': `tree.walk('../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still anchors those names in the language they belong to', () => {
  // The escape they were added for: `os.remove(...)` in a Python test resolved
  // from the source directory rather than the cwd. Scoping is by extension, and a
  // shebang stands in where there is none.
  const cases = {
    'packages/a/b/c/tests/a_test.py': `os.remove('../../labs/private.docx')\n`,
    'packages/a/b/c/tests/b_test.py': `shutil.copy('../../labs/private.docx', 'x')\n`,
    'examples/getting-started/laravel/routes/web.php': `<?php\nfile_get_contents('../../../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not read window.open as a filesystem call', () => {
  // `open` is on `node:fs` and is Python's builtin, so it anchors by name. It is
  // also `window.open`, which navigates to a URL and touches no file, and a web
  // test that only opens a page failed the required job.
  const cases = {
    'packages/a/b/c/tests/a.test.ts': `window.open('../../labs/private.docx');\n`,
    'packages/a/b/c/tests/b.test.ts': `globalThis.open('../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still anchors the filesystem open', () => {
  // Keyed on the receiver, so a bare call and `fs.open` are untouched. A bare
  // `open` cannot be told apart without following imports, and it is far more
  // likely to be the filesystem one.
  const cases = {
    'packages/a/b/c/tests/a.test.ts': `open('../../labs/private.docx');\n`,
    'packages/a/b/c/tests/b.test.ts': `fs.open('../../labs/private.docx');\n`,
    'packages/a/b/c/tests/a_test.py': `open('../../labs/private.docx')\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a Python path computed with abspath', () => {
  // `os.path.abspath` is not a filesystem read, but it resolves against the
  // process working directory, which is the question the set answers. It was
  // neither a language callee nor a pass-through, so the scanner stopped at the
  // inner call and read the literal from the source directory.
  const cases = {
    'packages/a/b/c/tests/a_test.py': `open(os.path.abspath('../../labs/private.docx'))\n`,
    'packages/a/b/c/tests/b_test.py': `open(os.path.realpath('../../labs/private.docx'))\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a PHP include statement at the runner cwd', () => {
  // Left out earlier on the reasoning that `include_path` is consulted first.
  // The manual is explicit that a path "relative to the current directory
  // (starting with `.` or `..`)" makes "the include_path ignored altogether", so
  // this form really does resolve from the Laravel lane's working directory.
  const cases = {
    'examples/getting-started/laravel/routes/web.php': `<?php\nrequire '../../../../labs/private.php';\n`,
    'examples/getting-started/laravel/routes/api.php': `<?php\ninclude_once '../../../../labs/private.php';\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('leaves a bare PHP include target alone', () => {
  // Only the traversal-prefixed form bypasses `include_path`. A bare
  // `require 'bootstrap/app.php'` does consult it, so the file is not the base.
  const { status, output } = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php\nrequire 'bootstrap/app.php';\n`,
    'examples/getting-started/laravel/bootstrap/app.php': '<?php\n',
  });
  assert.equal(status, 0, output);
});

test('anchors the CLI lane at the directory pnpm runs it from', () => {
  // ci-superdoc.yml runs the root `test:cli` script, which is itself
  // `pnpm --prefix apps/cli run test`. The indirection sits in package.json, so
  // grepping the workflows for `--prefix` does not reveal this lane.
  const { status, output } = runCheckerOn({
    'apps/cli/src/__tests__/a.test.ts': `readFileSync('../../shared/common/data/blank.docx');\n`,
    'shared/common/data/blank.docx': 'x',
  });
  assert.equal(status, 0, output);
});

test('still catches a real escape from the CLI lane', () => {
  const { status, output } = runCheckerOn({
    'apps/cli/src/__tests__/a.test.ts': `readFileSync('../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors a recursively run package at its own root', () => {
  // ci-superdoc.yml's bun-test step runs `pnpm -r --filter <pkg> ... test`, and a
  // recursive run executes each package's script from that package's own root --
  // verified against pnpm 11. Falling back to the repository root resolved a
  // valid fixture read above the checkout and failed the required job.
  const cases = {
    'packages/layout-engine/layout-engine/src/__tests__/a.test.ts': `readFileSync('../../../shared/common/data/blank.docx');\n`,
    'packages/document-api/src/__tests__/a.test.ts': `readFileSync('../../shared/common/data/blank.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents, 'shared/common/data/blank.docx': 'x' });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still catches a real escape from a recursively run package', () => {
  const { status, output } = runCheckerOn({
    'packages/layout-engine/layout-engine/src/__tests__/a.test.ts': `readFileSync('../../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('takes the longest matching runner prefix, not the first listed', () => {
  // The entries nest -- the layout-engine packages sit under a shared parent --
  // so a first-match lookup would depend on the order of the table. `shared/`
  // holds three of them, and each has to anchor at its own root.
  const cases = {
    'shared/common/src/__tests__/a.test.ts': `readFileSync('../font-utils/data/x.json');\n`,
    'shared/font-utils/src/__tests__/a.test.ts': `readFileSync('../common/data/y.json');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({
      [file]: contents,
      'shared/font-utils/data/x.json': '{}',
      'shared/common/data/y.json': '{}',
    });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('scans an environment template for an escaping path', () => {
  // `.env.example` reads as an extension of `.example`, so the allowlist skipped
  // it, and a bare `.env` has no extension at all. Both carry paths by design:
  // a `GOOGLE_APPLICATION_CREDENTIALS` pointing at a private sibling leaves the
  // exported demo depending on a file a public clone does not have.
  const cases = {
    'examples/x/server/.env.example': 'GOOGLE_APPLICATION_CREDENTIALS=../../../../labs/creds.json\n',
    'examples/x/server/.env.local': 'CREDS=../../../../labs/creds.json\n',
    'examples/x/server/.env': 'CREDS=../../../../labs/creds.json\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('treats a comment in an environment template as prose', () => {
  // Shell-style, so the `#` grammar applies rather than none at all.
  const { status, output } = runCheckerOn({
    'examples/x/server/.env.example': '# was ../../../../labs/creds.json\nCREDS=./creds.json\n',
    'examples/x/server/creds.json': '{}',
  });
  assert.equal(status, 0, output);
});

test('does not read a machine-rooted URL attribute as a path', () => {
  // A machine-shaped literal is a private dependency wherever it sits, and the
  // one exception read the enclosing call — which markup does not have. So an
  // `href="/home/alice/profile"` in a tracked demo failed the required job even
  // though the browser resolves it against the origin and touches no file.
  const cases = {
    'examples/x/index.html': `<a href="/home/alice/profile">go</a>\n`,
    'examples/x/page.html': `<img src="/Users/bob/avatar.png">\n`,
    'examples/x/form.html': `<form action="/home/alice/submit"></form>\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still reads a real path that only looks like a URL attribute', () => {
  // The exemption answers the machine-rooted question only. A traversal in an
  // `href` still escapes a public clone, and a `file:` URL names a path in any
  // context, so it overrides the exemption entirely.
  const cases = {
    'examples/a/b/c/z.html': `<a href="../../../../../labs/private.docx">d</a>\n`,
    'examples/x/y.html': `<a href="file:///home/alice/private.docx">d</a>\n`,
    'examples/x/__tests__/a.test.ts': `readFileSync('/home/alice/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a package-filtered test lane at its package root', () => {
  // `pnpm --filter <pkg> test` selects a package and runs its script from that
  // package's root, the same as a recursive run. Several lanes test a package
  // this way, so a valid fixture read resolved from the repository root instead
  // and landed outside the checkout.
  const cases = {
    'packages/react/src/__tests__/a.test.ts': `readFileSync('../../shared/common/data/blank.docx');\n`,
    'apps/docs/src/__tests__/a.test.ts': `readFileSync('../../shared/common/data/blank.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents, 'shared/common/data/blank.docx': 'x' });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still catches a real escape from a package-filtered lane', () => {
  const { status, output } = runCheckerOn({
    'packages/react/src/__tests__/a.test.ts': `readFileSync('../../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not treat an assignment as a markup attribute', () => {
  // The URL-attribute exemption matched a bare `name = value` shape, which is
  // also `const src = ...` in JavaScript, `SRC=...` in an env template, and
  // `src=...` in a shell script. That waved a machine path through in every one
  // of those -- the direction that hides a private dependency rather than merely
  // failing CI, so it needs the tag context checked.
  const machine = '/home/alice/private.docx';
  const cases = {
    'examples/x/__tests__/a.test.ts': `const src = '${machine}';\n`,
    'examples/x/__tests__/b.test.ts': `let href = '${machine}';\n`,
    'examples/x/__tests__/c.test.ts': `let action = '${machine}';\n`,
    'examples/x/__tests__/a_test.py': `src = '${machine}'\n`,
    'examples/x/__tests__/a.sh': `#!/bin/sh\nsrc=${machine}\ncat "$src"\n`,
    'examples/x/.env.example': `SRC=${machine}\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('still exempts a real markup attribute', () => {
  // Including a tag that spans lines, and JSX, where the attribute is inside a
  // `.tsx` file rather than a markup one.
  const cases = {
    'examples/x/a.html': `<a class="x" href="/home/alice/profile" id="y">go</a>\n`,
    'examples/x/b.html': `<a\n  class="x"\n  href="/home/alice/profile"\n>go</a>\n`,
    'examples/x/__tests__/c.test.tsx': `const el = <a href="/home/alice/profile">go</a>;\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('does not read a less-than as an opening tag', () => {
  // Without a tag-name test, an earlier `a < b` would put everything after it
  // "inside a tag" and restore the same hole one step out.
  const { status, output } = runCheckerOn({
    'examples/x/__tests__/a.test.ts': `if (a < b) {}\nconst src = '/home/alice/private.docx';\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors the document API smoke lane at its own root', () => {
  // ci-docs.yml runs the root `test:document-api-smoke` script, which is
  // `pnpm --filter @superdoc-testing/document-api-smoke test`. Same wrapped shape
  // as `test:cli`: the `--filter` is in package.json, not in the workflow.
  const { status, output } = runCheckerOn({
    'tests/document-api-smoke/src/__tests__/a.test.ts': `readFileSync('../../shared/common/data/blank.docx');\n`,
    'shared/common/data/blank.docx': 'x',
  });
  assert.equal(status, 0, output);
});

test('scans a VS Code workspace file for an escaping folder path', () => {
  // `.code-workspace` is JSON, and `folders[].path` names the directories the
  // editor opens, so an escaping value leaves the demo unusable from a clone.
  const { status, output } = runCheckerOn({
    'examples/x/sample.code-workspace': `{ "folders": [{ "path": "../../../../labs/private" }] }\n`,
  });
  assert.equal(status, 1, output);
});

test('keeps a printed shell argument exempt across a command separator', () => {
  // `;`, `&&` and `||` separate commands rather than connecting them: nothing is
  // handed to what follows. Treating them as routing failed the required job on a
  // fixture whose traversal never leaves stdout.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho '../labs/private.docx'; true\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\necho '../labs/private.docx' && true\n`,
    'examples/x/__tests__/c.sh': `#!/bin/sh\ntrue; echo '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still reads a shell argument in a different command from the echo', () => {
  // The unit that decides is the command, not the line. A `cat` argument after a
  // separator is its own command, and a substitution is routing rather than
  // separation, so it stays inside the segment.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho 'x'; cat '../labs/private.docx'\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\necho 'x' && cat '../labs/private.docx'\n`,
    // A pipe is its own stage, and the candidate here is `cat`'s own argument
    // rather than something `echo` printed, so the leading `echo` cannot exempt
    // it.
    'examples/x/__tests__/c.sh': `#!/bin/sh\necho hi | cat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not read a quoted shell separator as a command split', () => {
  // A `;`, `&&` or `||` inside an argument is text, not syntax. Reading the
  // quoted one as a split made the following argument look like it began a new
  // `echo`, which exempted a path `cat` really does open -- a fail-open, and one
  // the segment splitting introduced.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\ncat '; echo ' '../../labs/private.docx'\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\ncat '&& echo ' '../../labs/private.docx'\n`,
    'examples/x/__tests__/c.sh': `#!/bin/sh\ncat "; echo " '../../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not anchor the data argument of a write call', () => {
  // `writeFileSync('snapshot.txt', '../../labs/private.docx')` writes that
  // traversal as file contents and opens nothing but `snapshot.txt`, so anchoring
  // the second argument failed the required job on a generated fixture.
  const cases = {
    'packages/a/tests/a.test.ts': `writeFileSync('snapshot.txt', '../../labs/private.docx');\n`,
    'packages/a/tests/b.test.ts': `appendFileSync('snapshot.txt', '../../labs/private.docx');\n`,
    'packages/a/tests/c.test.ts': `await writeFile('snapshot.txt', '../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still reads the path argument of a write call', () => {
  // Only the argument after the path is data. The path itself, a nested call in
  // the data position, and every other filesystem API are unchanged -- naming the
  // four write APIs is what keeps this from becoming a general hole.
  const cases = {
    'packages/a/tests/a.test.ts': `writeFileSync('../../labs/private.docx', 'contents');\n`,
    'packages/a/tests/b.test.ts': `appendFileSync('../../labs/private.docx', 'contents');\n`,
    'packages/a/tests/c.test.ts': `writeFileSync('out.txt', readFileSync('../../labs/private.docx'));\n`,
    'packages/a/tests/d.test.ts': `copyFileSync('/tmp/a.docx', '../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('splits a shell line on a backgrounding ampersand', () => {
  // A standalone `&` terminates the command before it, so what follows is its own
  // command. Reading `echo x & cat '../labs/y'` as one `echo` exempted the path
  // `cat` really opens.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho 'x' & cat '../labs/private.docx'\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\necho 'x'& cat '../labs/private.docx'\n`,
    'examples/x/__tests__/c.sh': `#!/bin/sh\nsleep 1 & cat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('keeps printed path data exempt across output redirections', () => {
  // `2>&1` and `&>out` redirect stdout; they do not consume the echoed path as a
  // filesystem operand. They also are not command separators.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho '../labs/private.docx' 2>&1\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\necho '../labs/private.docx' &> out\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('keeps a printed argument exempt across a backgrounding ampersand', () => {
  // The `&` ends the printing command, so a later one does not consume its
  // output. And an escaped `&` is literal text: verified against /bin/sh, where
  // `echo a\& cat 'x'` is one echo that prints `a& cat x` and runs no cat.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho '../labs/private.docx' & true\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\ntrue & echo '../labs/private.docx'\n`,
    'examples/x/__tests__/c.sh': `#!/bin/sh\necho a\\& cat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('treats a language copy destination as its own path', () => {
  // `shutil.copy('source.docx', '../labs/private.docx')` resolves its destination
  // from the cwd regardless of the source. Composing it with `source.docx`
  // swallowed one level of the traversal, so the same path that was reported as
  // an `open` argument passed as a copy destination.
  const cases = {
    'packages/a/b/tests/a_test.py': `shutil.copy('source.docx', '../labs/private.docx')\n`,
    'packages/a/b/tests/b_test.py': `shutil.move('source.docx', '../labs/private.docx')\n`,
    'packages/a/b/tests/c_test.py': `shutil.copytree('source', '../labs/private')\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('ignores a quoted shell metacharacter when detecting routing', () => {
  // Routing is syntax, so it only counts outside quotes -- the same rule the
  // splitter follows. `echo '$(' '../labs/x'` prints a literal `$(` and routes
  // nothing, and reading it as command substitution failed the required job.
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho '$(' '../labs/private.docx'\n`,
    'examples/x/__tests__/b.sh': `#!/bin/sh\necho '|' '../labs/private.docx'\n`,
    'examples/x/__tests__/c.sh': `#!/bin/sh\necho '>' '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still detects real routing outside quotes', () => {
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\ncat $(echo '../labs/private.docx')\n`,
    // `xargs` turns the piped bytes back into path arguments, which a plain
    // filter does not.
    'examples/x/__tests__/b.sh': `#!/bin/sh\necho '../labs/private.docx' | xargs cat\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('detects command substitution inside double quotes', () => {
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho "$(cat '../labs/private.docx')"\n`,
    'examples/x/__tests__/b.sh': '#!/bin/sh\necho "`cat \'../labs/private.docx\'`"\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('ignores escaped command substitution inside double quotes', () => {
  const cases = {
    'examples/x/__tests__/a.sh': `#!/bin/sh\necho "\\$(cat '../labs/private.docx')"\n`,
    'examples/x/__tests__/b.sh': '#!/bin/sh\necho "\\`cat \'../labs/private.docx\'\\`"\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('does not let a quote inside a regex open string mode', () => {
  // `/'/` is a valid pattern, and reading its apostrophe as a string opener made
  // everything after it string text -- so the `readFileSync` below was never
  // recorded as a call and its literal resolved from the source directory.
  const cases = {
    'packages/a/b/tests/a.test.ts': `const m = /'/;\nreadFileSync('../../labs/private.docx');\n`,
    'packages/a/b/tests/b.test.ts': `const m = /"/;\nreadFileSync('../../labs/private.docx');\n`,
    'packages/a/b/tests/c.test.ts': `const m = /[a'b]/g;\nreadFileSync('../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not read a mid-line slash pair as a regex literal', () => {
  // A regex literal only follows an operator, a bracket, or a line start.
  // Matching a bare `/.../` anywhere also matched the middle of an ordinary line
  // -- `'a/b.test.ts': "copy('/tmp/x'` has a slash, a quote and a later slash --
  // and blanking those quotes unbalanced the string state, which produced a false
  // finding in this file itself.
  //
  // The trailing comment is what the corrupted state then mis-read, so it is part
  // of the shape. It says `home` rather than the other machine root because this
  // file's own exemption covers `/home/` and not the other one.
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.mjs':
      `const cases = {\n  'packages/a/tests/a.test.ts': "copyFileSync('/tmp/source.docx', 'ok.docx');\\n",\n};\n` +
      `// the pattern covers only /home/ paths.\n`,
  });
  assert.equal(status, 0, output);
});

test('recognizes a backtick-computed filesystem member', () => {
  // JavaScript allows a static backtick key, and only single and double quotes
  // were accepted, so the call returned no name and anchored nothing.
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': 'fs[`readFileSync`](`../../labs/private.docx`);\n',
  });
  assert.equal(status, 1, output);
});

test('recognizes an optional filesystem call', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `fs.readFileSync?.('../../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors PHP chdir at the runner cwd', () => {
  const { status, output } = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php\nchdir('../../../../labs/private');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not anchor the data argument of file_put_contents', () => {
  const { status, output } = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php\nfile_put_contents('snapshot.txt', '../../../../../labs/private.docx');\n`,
  });
  assert.equal(status, 0, output);
});

test('treats every srcset candidate as an attribute URL', () => {
  const { status, output } = runCheckerOn({
    'examples/example.html': `<img srcset="/home/alice/a.png 1x, /home/alice/b.png 2x">\n`,
  });
  assert.equal(status, 0, output);
});

test('resolves a symlink target from the destination directory', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `symlinkSync('../shared/data.docx', 'fixtures/link.docx');\n`,
    'shared/data.docx': 'fixture',
  });
  assert.equal(status, 0, output);
});

test('treats os.replace paths as independent', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a_test.py': `os.replace('source.docx', '../labs/private.docx')\n`,
  });
  assert.equal(status, 1, output);
});

test('detects shell input routing from an output-only command', () => {
  const cases = {
    'packages/a/tests/a.sh': `#!/bin/sh\necho < '../labs/private.docx'\n`,
    'packages/a/tests/b.sh': `#!/bin/bash\necho <(cat '../labs/private.docx')\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a Python keyword path argument at the cwd', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a_test.py': `open(file='../labs/private.docx')\n`,
  });
  assert.equal(status, 1, output);
});

test('reads a Python f-string replacement field as code', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a_test.py': `value = f"{open('../labs/private.docx').read()}"\n`,
  });
  assert.equal(status, 1, output);
});

test('leaves doubled Python f-string braces as literal text', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a_test.py': `value = f"{{open('../labs/private.docx')}}"\n`,
  });
  assert.equal(status, 0, output);
});

test('recognizes Python cwd expressions as path bases', () => {
  const cases = {
    'packages/a/b/tests/a_test.py': `open(Path.cwd() / '../labs/private.docx')\n`,
    'packages/a/b/tests/b_test.py': `open(os.path.join(os.getcwd(), '../labs/private.docx'))\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('uses a URL base that follows the path candidate', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `readFileSync(new URL('../labs/private.docx', pathToFileURL(process.cwd() + '/')));\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors parse_ini_file at the PHP runner cwd', () => {
  const { status, output } = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php\nparse_ini_file('../../../../labs/private.ini');\n`,
  });
  assert.equal(status, 1, output);
});

test('recognizes quote-bearing regexes after operand keywords', () => {
  const cases = {
    'packages/a/b/tests/a.test.ts': `await /'/;\nreadFileSync('../labs/private.docx');\n`,
    'packages/a/b/tests/b.test.ts': `function* values() { yield /'/; }\nreadFileSync('../labs/private.docx');\n`,
    'packages/a/b/tests/c.test.ts': `throw /'/;\nreadFileSync('../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('keeps a backslash-continued shell argument in its logical command', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.sh': `#!/bin/sh\necho \\\n  '../labs/private.docx'\n`,
  });
  assert.equal(status, 0, output);
});

test('still rejects a continued shell path that is not only printed', () => {
  const cases = {
    'packages/a/tests/a.sh': `#!/bin/sh\ncat \\\n  '../labs/private.docx'\n`,
    'packages/a/tests/b.sh': `#!/bin/sh\necho \\\\\n  '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('reads a triple-quoted Python f-string replacement field as code', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a_test.py': `value = f"""{open('../labs/private.docx').read()}"""\n`,
  });
  assert.equal(status, 1, output);
});

test('leaves triple-quoted Python literal text alone', () => {
  const cases = {
    'packages/a/b/tests/a_test.py': `value = """open('../labs/private.docx')"""\n`,
    'packages/a/b/tests/b_test.py': `value = f"""{{open('../labs/private.docx')}}"""\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('keeps printed path data exempt when stdout is redirected', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.sh': `#!/bin/sh\necho '../labs/private.docx' > printed-path.txt\n`,
  });
  assert.equal(status, 0, output);
});

test('still rejects a path used as an output redirection target', () => {
  const cases = {
    'packages/a/tests/a.sh': `#!/bin/sh\necho value > '../labs/private.docx'\n`,
    'packages/a/tests/b.sh': `#!/bin/sh\necho value 2> '../labs/private.log'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('does not treat traversal text inside a regex as a path', () => {
  const { status, output } = runCheckerOn({
    'tests/a.test.ts': `const matcher = / \\.\\.\\/\\.\\.\\/labs\\/private/;\n`,
  });
  assert.equal(status, 0, output);
});

test('recognizes a long quote-bearing regex literal', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts':
      `const matcher = /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'/;\n` + `readFileSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('recognizes a quote-bearing regex literal after a unary keyword', () => {
  for (const keyword of ['typeof', 'void']) {
    const { status, output } = runCheckerOn({
      'packages/a/b/tests/a.test.ts': `const matcher = ${keyword} /'/;\n` + `readFileSync('../labs/private.docx');\n`,
    });
    assert.equal(status, 1, `${keyword} should not hide the read:\n${output}`);
  }
});

test('treats a heredoc body written out as data rather than as paths', () => {
  const { status, output } = runCheckerOn({
    'tests/generate-expected.sh': `#!/bin/sh\ncat > expected.txt <<'END'\n../labs/private.docx\nEND\n`,
  });
  assert.equal(status, 0, output);
});

test('still rejects a traversal in a heredoc body the shell executes', () => {
  const cases = {
    'tests/run-private.sh': `#!/bin/sh\nsh <<'END'\ncat ../labs/private.docx\nEND\n`,
    'tests/pipe-private.sh': `#!/bin/sh\ncat <<'END' | sh\ncat ../labs/private.docx\nEND\n`,
    'tests/after-heredoc.sh': `#!/bin/sh\ncat > expected.txt <<'END'\nplain data\nEND\ncat ../labs/private.docx\n`,
    'tests/here-string.sh': `#!/bin/sh\ncat <<< 'x'\ncat ../labs/private.docx\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('treats an origin-relative CSS url() like the markup attribute it matches', () => {
  const cases = {
    'examples/app/fixtures/theme.css': `.hero { background-image: url('/home/assets/hero.png'); }\n`,
    'examples/app/fixtures/theme.vue': `<template><div/></template>\n<style scoped>\n.hero { background: url('/home/assets/hero.png'); }\n</style>\n`,
    'examples/app/fixtures/block.html': `<style>.hero { background: url('/home/assets/hero.png'); }</style>\n`,
    'examples/app/fixtures/inline.html': `<div style="background: url('/home/assets/hero.png')"></div>\n`,
    'examples/app/fixtures/icon.svg': `<svg><rect style="fill: url('/home/assets/hero.png')"/></svg>\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still rejects a CSS url() that leaves the repository', () => {
  const cases = {
    'examples/app/fixtures/escape.css': `.hero { background-image: url('../../../../labs/private.png'); }\n`,
    'examples/app/fixtures/file-url.css': `.hero { background-image: url('file:///home/alice/private.png'); }\n`,
    // `url(` is only a stylesheet reference in a stylesheet. A call of that name
    // in a test is an ordinary call, and a machine path in it is a private
    // dependency like any other. Markup embeds both, so the region decides:
    // a `<script>` block is code even in a file whose `<style>` block is not.
    'tests/a.test.ts': `const x = url('/home/alice/private.png');\n`,
    'examples/app/fixtures/script.vue': `<template><div/></template>\n<script setup>\nconst logo = url('/home/alice/private.png');\n</script>\n`,
    'examples/app/fixtures/script.html': `<html><body><script>\nconst logo = url('/home/alice/private.png');\n</script></body></html>\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('reads an output-only command through its environment assignments', () => {
  const { status, output } = runCheckerOn({
    'tests/print.sh': `#!/bin/sh\nLC_ALL=C printf '%s\\n' '../labs/private.docx'\n`,
  });
  assert.equal(status, 0, output);
});

test('exempts only what an output-only command prints', () => {
  const cases = {
    'tests/assign.sh': `#!/bin/sh\nFOO=../labs/private.docx echo hi\n`,
    'tests/env-cat.sh': `#!/bin/sh\nLC_ALL=C cat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('keeps printed data exempt when something else is the redirection operand', () => {
  const cases = {
    // `/dev/null` is the only file this opens; the traversal never leaves stdout.
    'tests/redirect.sh': `#!/bin/sh\necho '../labs/private.docx' < /dev/null\n`,
    // A here-string carries data rather than naming a file to open.
    'tests/here-string.sh': `#!/bin/sh\necho hi <<< '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('reads a quote inside a path-shaped regex character class', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `const matcher = /[/'..]/;\n` + `readFileSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('anchors a Python keyword path argument that is not written first', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a_test.py': `open(mode='r', file='../labs/private.docx')\n`,
  });
  assert.equal(status, 1, output);
});

test('scans an examples directory at any depth', () => {
  const cases = {
    'examples/headless/bad.py': `open('../../../labs/private.docx')\n`,
    'apps/site/examples/editor/bad.py': `open('../../../../../labs/private.docx')\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('matches the directory name rather than a word containing it', () => {
  const { status, output } = runCheckerOn({
    'apps/myexamples/thing/bad.py': `open('../../../labs/private.docx')\n`,
  });
  assert.equal(status, 0, output);
});

test('anchors Bun.file at the cwd, and only on that receiver', () => {
  const { status } = runCheckerOn({
    'packages/foo/src/a.test.ts': `const doc = Bun.file('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, 'Bun.file resolves from the process cwd');
  const bare = runCheckerOn({
    // `file` is an ordinary method name, so the receiver is what makes anchoring
    // it safe. A cache lookup touches no filesystem.
    'packages/foo/src/b.test.ts': `const doc = cache.file('../labs/private.docx');\n`,
  });
  assert.equal(bare.status, 0, bare.output);
});

test('scans a colocated test whatever language it is written in', () => {
  const cases = {
    'packages/foo/client.test.py': `open('../labs/private.docx')\n`,
    'packages/foo/client.test.sh': `#!/bin/sh\ncat '../labs/private.docx'\n`,
    'packages/foo/client.spec.php': `<?php include '../labs/private.php';\n`,
    'packages/foo/client.test.mts': `readFileSync('../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('widening the test suffix does not pull in unreadable formats or plain sources', () => {
  const cases = {
    // `isScanned` still asks the extension allowlist first, so a binary named
    // like a test is not opened.
    'packages/foo/a.test.docx': `open('../labs/private.docx')\n`,
    // And a source file that is not a test stays out of scope entirely.
    'packages/foo/client.py': `open('../labs/private.docx')\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('scans a substitution in a heredoc body the shell expands', () => {
  const cases = {
    'tests/expand.sh': `#!/bin/sh\ncat > expected.txt <<EOF\n$(cat '../../labs/package.json')\nEOF\n`,
    'tests/backtick.sh': "#!/bin/sh\ncat > expected.txt <<EOF\n`cat '../../labs/package.json'`\nEOF\n",
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('keeps a heredoc body data when the delimiter suppresses expansion', () => {
  const substitution = `$(cat '../../labs/package.json')`;
  const cases = {
    'tests/single.sh': `#!/bin/sh\ncat > expected.txt <<'END'\n${substitution}\nEND\n`,
    'tests/double.sh': `#!/bin/sh\ncat > expected.txt <<"END"\n${substitution}\nEND\n`,
    'tests/escaped.sh': `#!/bin/sh\ncat > expected.txt <<\\END\n${substitution}\nEND\n`,
    // Unquoted, but expanding a variable names no file, so the body is data.
    'tests/variable.sh': `#!/bin/sh\ncat > expected.txt <<END\n\${HOME}/../labs/private.docx\nEND\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('treats a here-string operand as data whatever command receives it', () => {
  const cases = {
    'tests/cat.sh': `#!/bin/sh\ncat <<< '../labs/private.docx'\n`,
    'tests/grep.sh': `#!/bin/sh\ngrep x <<< '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still rejects a path the same command really opens', () => {
  const cases = {
    // A later command on the line is its own command.
    'tests/after.sh': `#!/bin/sh\ngrep x <<< 'data'; cat '../labs/private.docx'\n`,
    // One `<` is a redirection, and it does open the file.
    'tests/redirect.sh': `#!/bin/sh\ncat < '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a Bun.write destination while its payload stays data', () => {
  const destination = runCheckerOn({
    'apps/cli/src/a.test.ts': `await Bun.write('../../../labs/private.docx', data);\n`,
  });
  assert.equal(destination.status, 1, destination.output);
  const cases = {
    // The second argument is written, not opened.
    'apps/cli/src/b.test.ts': `await Bun.write('out.txt', '../../../labs/private.docx');\n`,
    // And `write` is an ordinary method name on anything else.
    'apps/cli/src/c.test.ts': `logger.write('x', '../../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('anchors a PHP is_link at the cwd', () => {
  const { status, output } = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php is_link('../../../../labs/private');\n`,
  });
  assert.equal(status, 1, output);
});

test('resolves a symlink target against a composed destination', () => {
  const cases = {
    'tests/a.test.ts': `symlinkSync('../shared/data.docx', join('fixtures', 'link.docx'));\n`,
    'tests/b.test.ts': `symlinkSync('../shared/data.docx', path.join('fixtures', 'link.docx'));\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents, 'shared/data.docx': 'placeholder' });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still reports a symlink target that escapes from its composed destination', () => {
  const escaping = runCheckerOn({
    'tests/a.test.ts': `symlinkSync('../../../../labs/private.docx', join('fixtures', 'link.docx'));\n`,
  });
  assert.equal(escaping.status, 1, escaping.output);
  // A destination that is not statically known leaves the target where it was,
  // rather than inventing a prefix the call never names.
  const unknown = runCheckerOn({
    'tests/b.test.ts': `symlinkSync('../shared/data.docx', join(dir, 'link.docx'));\n`,
    'shared/data.docx': 'placeholder',
  });
  assert.equal(unknown.status, 1, unknown.output);
});

test('recognizes a quote-bearing regex literal after new', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `const unused = () => new /'/;\n` + `readFileSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('keeps a doubled slash inside a quoted path argument out of comment syntax', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `readFileSync(resolve('fixtures//foo', '../../../labs/private.docx'));\n`,
  });
  assert.equal(status, 1, output);
});

test('still blanks a real comment in either syntax', () => {
  const cases = {
    'packages/a/b/tests/a.test.ts': `// readFileSync('../../../labs/private.docx')\nconst x = 1;\n`,
    'packages/a/b/tests/b.test.ts': `/* readFileSync('../../../labs/private.docx') */\nconst x = 1;\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('anchors an algorithm-first PHP call at its own path argument', () => {
  const escaping = runCheckerOn({
    'examples/getting-started/laravel/routes/web.php': `<?php hash_file('sha256', '../../../../labs/private');\n`,
  });
  assert.equal(escaping.status, 1, escaping.output);
  // The algorithm is not a leading path segment, so an in-repository path
  // resolves as itself rather than as `sha256/storage/app/x`.
  const inside = runCheckerOn({
    'examples/getting-started/laravel/routes/web2.php': `<?php hash_file('sha256', 'storage/app/x');\n`,
  });
  assert.equal(inside.status, 0, inside.output);
});

test('keeps a quote-spanning shell command together', () => {
  // The payload continues on the next line, so the command is `printf`, not the
  // bare traversal the second line looks like on its own.
  const printed = runCheckerOn({ 'tests/print.sh': `#!/bin/sh\nprintf '%s\\n' '\n../labs/private.docx'\n` });
  assert.equal(printed.status, 0, printed.output);
  const cases = {
    // The same shape on a command that really opens its argument.
    'tests/open.sh': `#!/bin/sh\ncat '\n../labs/private.docx'\n`,
    // And an ordinary two-command script is still two commands.
    'tests/two.sh': `#!/bin/sh\necho hi\ncat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors the PHP digest and stat family at the cwd', () => {
  const names = [
    'md5_file',
    'sha1_file',
    'filemtime',
    'fileatime',
    'filectime',
    'filetype',
    'fileperms',
    'fileowner',
    'filegroup',
    'fileinode',
    'is_executable',
    'disk_free_space',
    'disk_total_space',
  ];
  for (const name of names) {
    const escaping = runCheckerOn({
      [`examples/getting-started/laravel/routes/${name}.php`]: `<?php ${name}('../../../../labs/private');\n`,
    });
    assert.equal(escaping.status, 1, `${name} should fail:\n${escaping.output}`);
    const inside = runCheckerOn({
      [`examples/getting-started/laravel/routes/${name}.php`]: `<?php ${name}('storage/app/x');\n`,
    });
    assert.equal(inside.status, 0, `${name} should pass:\n${inside.output}`);
  }
});

test('keeps the PHP names scoped to PHP', () => {
  // `filemtime` is not a JavaScript filesystem call, so a method of that name
  // in a test anchors nothing.
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `cache.filemtime('../labs/private.docx');\n`,
  });
  assert.equal(status, 0, output);
});

test('checks a multiply-invoked project against every cwd that runs it', () => {
  // `apps/vscode-ext` is a project in the root vitest workspace as well as its
  // own lane, so the same file is launched from both. This path stays inside
  // under the package cwd and escapes under the root.
  const escaping = runCheckerOn({
    'apps/vscode-ext/src/a.test.ts': `readFileSync(resolve(process.cwd(), '../../labs/package.json'));\n`,
  });
  assert.equal(escaping.status, 1, escaping.output);
  const inside = runCheckerOn({
    'apps/vscode-ext/src/b.test.ts': `readFileSync(resolve(process.cwd(), 'fixtures/a.docx'));\n`,
  });
  assert.equal(inside.status, 0, inside.output);
});

test('recognizes a quote-bearing regex literal after bitwise negation', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `const matcher = ~ /'/;\n` + `readFileSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('keeps an unrelated substitution from routing printed data', () => {
  const cases = {
    'tests/date.sh': `#!/bin/sh\necho "$(date)" '../labs/private.docx'\n`,
    'tests/backtick.sh': '#!/bin/sh\necho "`date`" \'../labs/private.docx\'\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still routes a candidate that is inside the substitution', () => {
  const cases = {
    'tests/inside.sh': `#!/bin/sh\necho "$(cat '../labs/private.docx')"\n`,
    'tests/backtick.sh': "#!/bin/sh\necho `cat '../labs/private.docx'`\n",
    // A pipe hands on everything printed, so it stays a whole-command question.
    'tests/pipe.sh': `#!/bin/sh\necho '../labs/private.docx' | xargs cat\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('recognizes a regex in statement position after a control condition', () => {
  const cases = {
    'packages/a/b/tests/a.test.ts': `if (true) /'/.test('x');\n` + `readFileSync('../labs/private.docx');\n`,
    'packages/a/b/tests/b.test.ts': `while (x) /'/.test('y');\n` + `readFileSync('../labs/private.docx');\n`,
    // `for await` puts a keyword between `for` and its condition.
    'packages/a/b/tests/d.test.ts':
      `for await (const x of values) /'/.test(x);\n` + `readFileSync('../labs/private.docx');\n`,
    // A closing paren that is not a control condition is division far more often
    // than a regex, so it stays out of the operator class and this still fails
    // for the ordinary reason rather than because a quote was blanked.
    'packages/a/b/tests/c.test.ts': `const r = f(a) / 2;\n` + `readFileSync('../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('exempts an origin-relative URL passed to fetch', () => {
  const { status, output } = runCheckerOn({
    'examples/app/__tests__/a.spec.ts': `await fetch('/home/alice/profile');\n`,
  });
  assert.equal(status, 0, output);
});

test('keeps the fetch exemption to the URL it actually names', () => {
  const cases = {
    // Some other object's `.fetch` need not be the browser's.
    'examples/app/__tests__/a.spec.ts': `cache.fetch('/home/alice/private.docx');\n`,
    // Only the first argument is the URL.
    'examples/app/__tests__/b.spec.ts': `fetch(url, '/home/alice/private.docx');\n`,
    // A `file:` URL names a path in any context.
    'examples/app/__tests__/c.spec.ts': `fetch('file:///home/alice/private.docx');\n`,
    // And a traversal is resolved and reported whoever receives it.
    'examples/app/__tests__/d.spec.ts': `fetch('../../../../labs/private.docx');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('reads an output-only builtin through the command wrapper', () => {
  const cases = {
    'tests/wrapped.sh': `#!/bin/sh\ncommand printf '%s\\n' '../labs/private.docx'\n`,
    'tests/flagged.sh': `#!/bin/sh\ncommand -v printf '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('does not let the command wrapper carry a path-opening builtin', () => {
  const cases = {
    // The wrapper does not change what `cat` does.
    'tests/wrapped-cat.sh': `#!/bin/sh\ncommand cat '../labs/private.docx'\n`,
    // And the wrapper has to be the word `command`, not a prefix of one.
    'tests/lookalike.sh': `#!/bin/sh\ncommandfoo printf '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('treats the sole argument of a FileHandle write as data', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `await handle.writeFile('../labs/private.docx');\n`,
  });
  assert.equal(status, 0, output);
});

test('keeps every path-first write a path', () => {
  const cases = {
    'packages/a/b/tests/a.test.ts': `await fs.writeFile('../labs/private.docx', data);\n`,
    'packages/a/b/tests/b.test.ts': `await writeFile('../labs/private.docx', data);\n`,
    // An unrecognized receiver is not evidence of a handle. Two arguments means
    // the first is the path, whoever the receiver turns out to be.
    'packages/a/b/tests/c.test.ts': `await myFs.writeFile('../labs/private.docx', data);\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('reads a heredoc data command through its environment assignments', () => {
  const { status, output } = runCheckerOn({
    'tests/generate.sh': `#!/bin/sh\nLC_ALL=C cat > expected.txt <<'END'\n../labs/private.docx\nEND\n`,
  });
  assert.equal(status, 0, output);
  const executing = runCheckerOn({
    // The prefix does not make an executing heredoc into data.
    'tests/run.sh': `#!/bin/sh\nLC_ALL=C sh <<'END'\ncat ../labs/private.docx\nEND\n`,
  });
  assert.equal(executing.status, 1, executing.output);
});

test('recognizes a quote-bearing regex literal after export default', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `export default /'/;\n` + `readFileSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
});

test('does not read a property of the same name as an operand position', () => {
  // `mod.default / 2` is division. Matching it as a regex would blank the quote
  // in the literal after it and unbalance the string state, which is how a
  // false finding gets manufactured out of ordinary code.
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `const r = mod.default / 2, s = '/tmp/x';\nconst t = 1;\n`,
  });
  assert.equal(status, 0, output);
});

test('treats a FileHandle write as data when options are supplied', () => {
  const cases = {
    'packages/a/b/tests/a.test.ts': `await handle.writeFile('../labs/private.docx', 'utf8');\n`,
    'packages/a/b/tests/b.test.ts': `await handle.appendFile('../labs/private.docx', { encoding: 'utf8' });\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('keeps a two-argument write a path unless the second argument is options', () => {
  const cases = {
    // The module-level function is path-first whatever its second argument is.
    'packages/a/b/tests/a.test.ts': `await fs.writeFile('../labs/private.docx', 'utf8');\n`,
    // Data in the second position is not an options bag.
    'packages/a/b/tests/b.test.ts': `await myFs.writeFile('../labs/private.docx', data);\n`,
    // And the handle overloads take at most two arguments.
    'packages/a/b/tests/c.test.ts': `await handle.writeFile('../labs/private.docx', data, opts);\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('keeps printed data exempt through filters that only consume bytes', () => {
  const cases = {
    'tests/cat.sh': `#!/bin/sh\necho '../labs/private.docx' | cat\n`,
    'tests/grep.sh': `#!/bin/sh\necho '../labs/private.docx' | grep labs\n`,
    'tests/chain.sh': `#!/bin/sh\necho '../labs/private.docx' | grep labs | sort | uniq\n`,
    'tests/prefixed.sh': `#!/bin/sh\necho '../labs/private.docx' | LC_ALL=C grep labs\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('still routes printed data into a command that reinterprets it', () => {
  const cases = {
    // `xargs` turns the bytes back into path arguments.
    'tests/xargs.sh': `#!/bin/sh\necho '../labs/private.docx' | xargs cat\n`,
    // A shell reads them as a program.
    'tests/sh.sh': `#!/bin/sh\necho 'cat ../labs/private.docx' | sh\n`,
    // One reinterpreter anywhere downstream is enough.
    'tests/mixed.sh': `#!/bin/sh\necho '../labs/private.docx' | sort | xargs cat\n`,
    // And a candidate in a later stage is that stage's own argument.
    'tests/later.sh': `#!/bin/sh\necho hi | cat '../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors a path operand handed to a child process at the cwd', () => {
  const cases = {
    'packages/a/b/tests/a.test.ts': `execFileSync('cat', ['../labs/private.docx']);\n`,
    'packages/a/b/tests/b.test.ts': `spawnSync('cat', ['../labs/private.docx']);\n`,
    'packages/a/b/tests/c.test.ts': `execSync('cat ../labs/private.docx');\n`,
    'packages/a/b/tests/d.test.ts': `child_process.execFileSync('cat', ['../labs/private.docx']);\n`,
    // The `cwd` option is itself resolved from the cwd it replaces.
    'packages/a/b/tests/e.test.ts': `spawnSync('ls', [], { cwd: '../labs' });\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
  const inside = runCheckerOn({
    'packages/a/b/tests/f.test.ts': `execFileSync('cat', ['fixtures/a.docx']);\n`,
  });
  assert.equal(inside.status, 0, inside.output);
});

test('exempts a URL constructed against an http origin', () => {
  const { status, output } = runCheckerOn({
    'examples/app/__tests__/a.spec.ts': `new URL('/home/alice/profile', 'https://example.com');\n`,
  });
  assert.equal(status, 0, output);
});

test('keeps the URL exemption to an origin-relative first argument', () => {
  const cases = {
    // A `file:` base names a real path.
    'examples/app/__tests__/a.spec.ts': `new URL('/home/alice/x', 'file:///tmp/');\n`,
    // Only the first argument is the path being resolved.
    'examples/app/__tests__/b.spec.ts': `new URL(p, '/home/alice/private.docx');\n`,
    // A traversal is reported whatever the base.
    'examples/app/__tests__/c.spec.ts': `new URL('../../../../labs/x.docx', 'https://example.com');\n`,
    // A base this cannot read leaves the candidate where it was.
    'examples/app/__tests__/d.spec.ts': `new URL('/home/alice/private.docx', base);\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('treats a spawned output-only program as printing data', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `execFileSync('echo', ['../labs/private.docx']);\n`,
  });
  assert.equal(status, 0, output);
});

test('keeps the spawned exemption to programs that only print', () => {
  const cases = {
    // A different program opens what it is handed.
    'packages/a/b/tests/a.test.ts': `execFileSync('cat', ['../labs/private.docx']);\n`,
    // The shell forms take a command line, where the printing command word says
    // nothing about a redirection that really does open the path.
    'packages/a/b/tests/b.test.ts': `execSync('echo hi > ../labs/private.docx');\n`,
    // And the program is the first argument, not something later in it.
    'packages/a/b/tests/c.test.ts': `execFileSync('sh', ['-c', 'cat ../labs/private.docx']);\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('anchors the PHP SPL file classes at the cwd', () => {
  const names = [
    'SplFileObject',
    'SplFileInfo',
    'DirectoryIterator',
    'RecursiveDirectoryIterator',
    'FilesystemIterator',
    'GlobIterator',
  ];
  for (const name of names) {
    const escaping = runCheckerOn({
      [`examples/getting-started/laravel/routes/${name}.php`]: `<?php new ${name}('../../../../labs/private');\n`,
    });
    assert.equal(escaping.status, 1, `${name} should fail:\n${escaping.output}`);
    const inside = runCheckerOn({
      [`examples/getting-started/laravel/routes/${name}.php`]: `<?php new ${name}('storage/app/x');\n`,
    });
    assert.equal(inside.status, 0, `${name} should pass:\n${inside.output}`);
  }
  // Language-scoped, so a class of the same name in a JavaScript test anchors
  // nothing.
  const javascript = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `new SplFileObject('../labs/private.docx');\n`,
  });
  assert.equal(javascript.status, 0, javascript.output);
});

test('recognizes a quote-bearing regex literal after extends', () => {
  const { status, output } = runCheckerOn({
    'packages/a/b/tests/a.test.ts': `class C extends /'/.constructor {}\n` + `readFileSync('../labs/private.docx');\n`,
  });
  assert.equal(status, 1, output);
  // And a property of that name is division, not an operand position.
  const property = runCheckerOn({
    'packages/a/b/tests/b.test.ts': `const r = cfg.extends / 2, s = '/tmp/x';\nconst t = 1;\n`,
  });
  assert.equal(property.status, 0, property.output);
});

test('does not exempt a spawned program when a shell is in the way', () => {
  const cases = {
    // With `shell: true` the argv entries are a command line, and `>` creates
    // the destination even though the program only prints.
    'packages/a/b/tests/a.test.ts': `execFileSync('echo', ['ok', '>', '../labs/private.docx'], { shell: true });\n`,
    // The option cancels it whatever its value, since a scanner that cannot
    // read the value should not be the one deciding the call is safe.
    'packages/a/b/tests/b.test.ts': `execFileSync('echo', ['ok', '>', '../labs/private.docx'], { shell: useShell });\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
  const argv = runCheckerOn({
    'packages/a/b/tests/c.test.ts': `execFileSync('echo', ['../labs/private.docx']);\n`,
  });
  assert.equal(argv.status, 0, argv.output);
});

test('keeps heredoc payload data when a substitution sits elsewhere in the body', () => {
  const { status, output } = runCheckerOn({
    'tests/generate.sh': `#!/bin/sh\ncat > expected.txt <<END\n$(date)\n../labs/private.docx\nEND\n`,
  });
  assert.equal(status, 0, output);
  // The candidate inside the substitution is still executable.
  const executed = runCheckerOn({
    'tests/read.sh': `#!/bin/sh\ncat > expected.txt <<END\n$(cat '../labs/private.docx')\nEND\n`,
  });
  assert.equal(executed.status, 1, executed.output);
});

test('reads markdown and JSON without a comment grammar, so comment-looking text still counts', () => {
  const cases = {
    'examples/__tests__/NOTES.md': '<!-- see ../../../../labs/private.docx -->\n',
    'examples/__tests__/data.json': '{ "path": "x" } // ../../../../labs/private.docx\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('scans every named build input, not only the Makefile and Dockerfile', () => {
  const cases = {
    'examples/agent/Containerfile': 'COPY ../../../labs/private.pem /app/key.pem\n',
    'examples/agent/Justfile': 'build:\n\tcat ../../../labs/private.mk\n',
    'examples/agent/Procfile': 'web: node ../../../labs/server.js\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});

test('exempts the browser fetch reached through a global receiver', () => {
  const cases = {
    'examples/app/__tests__/a.spec.ts': `await window.fetch('/home/alice/profile');\n`,
    'examples/app/__tests__/b.spec.ts': `await globalThis.fetch('/home/alice/profile');\n`,
    'examples/app/__tests__/c.spec.ts': `await self.fetch('/home/alice/profile');\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('does not read a longer element name that starts with style as a stylesheet', () => {
  const { status, output } = runCheckerOn({
    'examples/app/fixtures/page.html': `<styles>.hero { background: url('/home/alice/private.png'); }</styles>\n`,
  });
  assert.equal(status, 1, output);
});

test('reads a leading-dot name as having no extension, so its shebang decides', () => {
  const { status, output } = runCheckerOn({
    'examples/app/tests/.run': `#!/bin/sh\ncat '../../labs/private.docx'\n`,
  });
  assert.equal(status, 1, output);
});

test('reads a call a formatter split across lines as one argument list', () => {
  const { status, output } = runCheckerOn({
    'packages/a/tests/a.test.ts': `const p = resolve(\n  process.cwd(),\n  '../labs/private.docx',\n);\n`,
  });
  assert.equal(status, 1, output);
});

test('reads a CSS url() as a stylesheet reference only in a stylesheet host language', () => {
  const { status, output } = runCheckerOn({
    'examples/app/__tests__/a.test.tsx': `const el = <div style="background: url('/home/alice/private.png')" />;\n`,
  });
  assert.equal(status, 1, output);
});

test('treats an unbounded hash as a comment in Python and PHP even before an escaping path', () => {
  const cases = {
    'packages/a/tests/a_test.py': `x=1# '../../../../labs/private.docx'\n`,
    'packages/a/tests/a.php': `<?php\n$x=1# '../../../../labs/private.docx'\n;\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('reports every finding in a file with more escapes than a call can take as arguments', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/many.txt': "'../../../labs/x'\n".repeat(150_000),
  });
  assert.equal(status, 1, output.slice(0, 2000));
  assert.doesNotMatch(output, /RangeError/);
  assert.match(output, /examples\/__tests__\/many\.txt/);
});

test('says when an escaping path reaches something that exists locally', () => {
  const { status, output } = runCheckerOn({
    'examples/__tests__/a.test.ts': `const parent = readdirSync('../../../');\n`,
  });
  assert.equal(status, 1, output);
  assert.match(output, /private sibling/);
});

test('scans every public clone surface', () => {
  const files = {
    'packages/a/__tests__/x.ts': `import '../../../../labs/a.js';\n`,
    'packages/a/tests/x.ts': `import '../../../../labs/b.js';\n`,
    'packages/a/test/x.ts': `import '../../../../labs/c.js';\n`,
    'packages/a/fixtures/x.ts': `import '../../../../labs/d.js';\n`,
    'packages/a/fixture/x.ts': `import '../../../../labs/e.js';\n`,
    'packages/a/examples/x.ts': `import '../../../../labs/f.js';\n`,
  };
  const { status, output } = runCheckerOn(files);
  assert.equal(status, 1, output);
  for (const file of Object.keys(files)) assert.match(output, new RegExp(file.replaceAll('.', '\\.')));
});

test('scans every listed text extension', () => {
  const extensions = [
    '.cjs',
    '.code-workspace',
    '.cts',
    '.css',
    '.html',
    '.js',
    '.json',
    '.jsx',
    '.md',
    '.mdx',
    '.mjs',
    '.mts',
    '.php',
    '.py',
    '.sh',
    '.svg',
    '.ts',
    '.tsx',
    '.txt',
    '.vue',
    '.xml',
    '.yaml',
    '.yml',
  ];
  const files = Object.fromEntries(
    extensions.map((extension) => [`examples/x/a${extension}`, `"../../../labs/private.docx"\n`]),
  );
  const { status, output } = runCheckerOn(files);
  assert.equal(status, 1, output);
  for (const file of Object.keys(files)) assert.match(output, new RegExp(`${file.replaceAll('.', '\\.')}\\n`));
});

test('requires a boundary before a YAML hash comment, as in shell', () => {
  const { status, output } = runCheckerOn({
    'examples/a.yaml': 'value: x# ../../labs/private.docx\n',
  });
  assert.equal(status, 1, output);
});

test('reads a Makefile hash outside a recipe as a comment whatever precedes it', () => {
  const { status, output } = runCheckerOn({
    'examples/Makefile': `X=1# '../../labs/private.docx'\n`,
  });
  assert.equal(status, 0, output);
});

test('treats each remaining native comment form as prose', () => {
  const cases = {
    'examples/x/a.css': '/* was ../../../labs/private.png */\n',
    'examples/x/a.vue': '<script>\n// was ../../../labs/private.docx\n</script>\n',
    'examples/x/Containerfile': '# was ../../../labs/private.pem\n',
    'examples/x/Justfile': '# was ../../../labs/private.mk\n',
    'examples/x/Procfile': '# was ../../../labs/server.js\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('reads a JavaScript runtime shebang with JavaScript comments', () => {
  for (const runtime of ['node', 'bun', 'deno']) {
    const { status, output } = runCheckerOn({
      'examples/x/run': `#!/usr/bin/env ${runtime}\n// was ../../../labs/private.docx\n`,
    });
    assert.equal(status, 0, `${runtime} should pass:\n${output}`);
  }
});

test('lets an extension decide the language before a shebang does', () => {
  const { status, output } = runCheckerOn({
    'examples/x/a.py': `#!/usr/bin/env node\nx=1# '../../../labs/private.docx'\n`,
  });
  assert.equal(status, 0, output);
});

test('reads a shebang only in an extensionless file, and an extensionless file only with one', () => {
  const cases = {
    'examples/x/payload.docx': `#!/bin/sh\ncat '../../../labs/private.docx'\n`,
    'examples/x/notes': `'../../../labs/private.docx'\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('ignores a symlink outside the public clone surfaces', () => {
  const { status, output } = runCheckerOn({}, { symlinks: { 'runtime/link.docx': '../../labs/private.docx' } });
  assert.equal(status, 0, output);
});

test('skips a tracked symlink checked out as a plain file', () => {
  const { status, output } = runCheckerOn(
    {},
    { symlinksCheckedOutAsFiles: { 'examples/__tests__/link.docx': '../../../labs/private.docx' } },
  );
  assert.equal(status, 0, output);
});

test('treats the block comment form of PHP, Vue and XML as prose', () => {
  const cases = {
    'examples/x/a.php': '<?php\n/* was ../../../labs/private.docx */\n',
    'examples/x/a.vue': '<script>\n/* was ../../../labs/private.docx */\n</script>\n',
    'examples/x/a.xml': '<root><!-- was ../../../labs/private.docx --></root>\n',
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 0, `${file} should pass:\n${output}`);
  }
});

test('takes a file language from its extension first and its shebang otherwise', () => {
  const cases = {
    'examples/x/a.py': `#!/usr/bin/env node\nos.remove('../labs/private.docx')\n`,
    'examples/x/run': `#!/usr/bin/env python3\nos.remove('../labs/private.docx')\n`,
  };
  for (const [file, contents] of Object.entries(cases)) {
    const { status, output } = runCheckerOn({ [file]: contents });
    assert.equal(status, 1, `${file} should fail:\n${output}`);
  }
});
