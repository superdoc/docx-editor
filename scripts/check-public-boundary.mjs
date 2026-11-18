#!/usr/bin/env node
/**
 * Public boundary guard: tests and fixtures may not reach outside the repository.
 *
 * Fails when a test, fixture, or example references a path that resolves
 * outside the repository root. A public clone has no parent directory, so the
 * reference is either dead on arrival or silently depends on a private sibling
 * checkout that only exists in the development monorepo.
 *
 * Why this exists
 * ---------------
 * `superdoc/public` is developed inside a larger private repository where
 * sibling directories like `../v2` and `../labs` really do exist. That makes an
 * escaping path look correct locally and in private CI, and only break for
 * someone who cloned the public mirror. A demo Playwright suite shipped reading
 * its fixture from `../../../../labs/proofing/...` for exactly this reason:
 * nothing asked whether the path survived the export.
 *
 * Why resolution rather than a text ban
 * ------------------------------------
 * Banning the substring `labs/` or `../v2` would flag prose that legitimately
 * names the private repository — policy docs, migration notes, this file — while
 * still missing an escape written a different way. So the check resolves each
 * candidate against the filesystem and reports the ones landing outside the
 * root. Only something that is really a path can fail, and something that is
 * really a path cannot hide behind spelling.
 *
 * What this does not catch
 * ------------------------
 * It reads literal path-shaped strings, so it cannot see a path assembled at
 * runtime (`'../'.repeat(4) + 'labs/x'`), one built from a variable, or an
 * in-repo symlink whose target escapes. Those are real gaps rather than
 * oversights: evaluating them needs a resolver, not a scanner. The guard raises
 * the floor on the common case — a literal specifier in an import or a fixture
 * path — and the export seam remains the backstop for the shipped tree.
 *
 * Callees are matched by the name at the call site, so an aliased import
 * (`import { readdirSync as list }`) is not recognized as a filesystem call.
 * That only matters for a path whose own text does not escape: `list('..')` is
 * missed, while `list('../labs/x')` is still caught, because a literal carrying
 * a traversal is reported wherever it sits. Following the alias means tracking
 * bindings through the module, which is the resolver this deliberately is not.
 *
 * Scope, and what owns the rest
 * -----------------------------
 * This guard covers the surfaces that must run from a bare public clone:
 * tests, fixtures, and examples. It deliberately does NOT scan build
 * wiring, manifests, the lockfile, or runtime modules that consume the private
 * engine during development. Those escape by design and are owned by the
 * porter's `EXPORT_SEAM_VERIFY_RULES`, which rewrites the engine dependency and
 * fails the export if a private marker survives. Two guards, one boundary:
 * the porter proves the shipped tree, this proves the tree developers edit.
 *
 * Run directly:
 *   node scripts/check-public-boundary.mjs
 *   pnpm run check:public-boundary
 */

import * as nodeFs from 'node:fs';
const { existsSync, readFileSync, readlinkSync } = nodeFs;
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COLOCATED_TEST_IN_ANY_LANGUAGE = /\.(?:test|spec)\.[A-Za-z0-9]+$/;

const PUBLIC_CLONE_SURFACES = [
  /(?:^|\/)__tests__\//,
  /(?:^|\/)tests?\//,
  /(?:^|\/)fixtures?\//,
  COLOCATED_TEST_IN_ANY_LANGUAGE,
  /(?:^|\/)examples\//,
];

function isInPublicCloneSurface(file) {
  return PUBLIC_CLONE_SURFACES.some((pattern) => pattern.test(file));
}

const SCANNED_EXTENSIONS = new Set([
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
]);

function basenameOf(file) {
  return file.slice(file.lastIndexOf('/') + 1);
}

function extensionAfterNonLeadingDot(basename) {
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot) : '';
}

function shebangLineOf(contents) {
  if (!contents?.startsWith('#!')) return undefined;
  return contents.slice(0, contents.indexOf('\n') + 1 || contents.length);
}

const JS_COMMENTS = { lines: ['//'], blocks: [['/*', '*/']] };
const HASH_COMMENTS = { lines: ['#'] };
const BOUNDED_HASH_COMMENTS = { lines: ['#'], hashNeedsBoundary: true };
const SGML_COMMENTS = { blocks: [['<!--', '-->']] };
const CSS_COMMENTS = { blocks: [['/*', '*/']] };
const VUE_SCRIPT_AND_TEMPLATE_COMMENTS = {
  lines: ['//'],
  blocks: [
    ['/*', '*/'],
    ['<!--', '-->'],
  ],
};
const PHP_COMMENTS = { lines: ['//', '#'], blocks: [['/*', '*/']] };
const MAKE_COMMENTS_WITH_SHELL_RECIPES = { lines: ['#'], hashNeedsBoundaryInRecipes: true };

const COMMENT_GRAMMARS = new Map([
  ['.cjs', JS_COMMENTS],
  ['.cts', JS_COMMENTS],
  ['.css', CSS_COMMENTS],
  ['.js', JS_COMMENTS],
  ['.jsx', JS_COMMENTS],
  ['.mjs', JS_COMMENTS],
  ['.mts', JS_COMMENTS],
  ['.ts', JS_COMMENTS],
  ['.tsx', JS_COMMENTS],
  ['.vue', VUE_SCRIPT_AND_TEMPLATE_COMMENTS],
  ['.php', PHP_COMMENTS],
  ['.py', HASH_COMMENTS],
  ['.sh', BOUNDED_HASH_COMMENTS],
  ['.yaml', BOUNDED_HASH_COMMENTS],
  ['.yml', BOUNDED_HASH_COMMENTS],
  ['.html', SGML_COMMENTS],
  ['.svg', SGML_COMMENTS],
  ['.xml', SGML_COMMENTS],
]);

const BASENAME_COMMENT_GRAMMARS = new Map([
  ['Dockerfile', HASH_COMMENTS],
  ['Containerfile', HASH_COMMENTS],
  ['Makefile', MAKE_COMMENTS_WITH_SHELL_RECIPES],
  ['Justfile', MAKE_COMMENTS_WITH_SHELL_RECIPES],
  ['Procfile', HASH_COMMENTS],
]);

const ROUTE_REGISTERING_CALLEES = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use']);

const ROUTER_RECEIVERS = new Set(['app', 'router', 'server', 'api', 'fastify', 'express']);

const BROWSER_GLOBAL_RECEIVERS = new Set(['globalThis', 'window', 'self']);

function isFileUrl(text, offset) {
  return text.slice(Math.max(0, offset - 8), offset).endsWith('file://');
}

function isFirstArgumentOf(text, paren, offset) {
  return (
    text
      .slice(paren + 1, offset)
      .replace(/['"`]\s*$/, '')
      .trim() === ''
  );
}

function lastSegmentOf(receiver) {
  return receiver.split('.').pop();
}

const URL_ARGUMENT_CALLEES = new Set(['fetch']);

function isBrowserFetchCall({ name, receiver }) {
  return URL_ARGUMENT_CALLEES.has(name) && (receiver === '' || BROWSER_GLOBAL_RECEIVERS.has(lastSegmentOf(receiver)));
}

function isUrlArgument(text, context, offset) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  return isBrowserFetchCall(calleeBefore(text, paren)) && isFirstArgumentOf(text, paren, offset);
}

const HTTP_ORIGIN_LITERAL = /^(['"`])https?:\/\//i;

function isOriginRelativeUrl(text, context, offset) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  if (calleeBefore(text, paren).name !== 'URL') return false;
  if (!isFirstArgumentOf(text, paren, offset)) return false;
  return HTTP_ORIGIN_LITERAL.test(currentArgument(completeArgumentList(text, paren)).trim());
}

function isRouterRegistration({ name, receiver }) {
  return ROUTER_RECEIVERS.has(lastSegmentOf(receiver)) && ROUTE_REGISTERING_CALLEES.has(name);
}

function isRouteLiteral(text, context, offset) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  return isRouterRegistration(calleeBefore(text, paren)) && isFirstArgumentOf(text, paren, offset);
}

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'srcset', 'poster', 'data', 'formaction', 'cite', 'ping']);

const OPEN_QUOTED_ATTRIBUTE_VALUE = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"[^"]*|'[^']*)$/;
const ATTRIBUTE_NAME_BEFORE_VALUE = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*['"]?\s*$/;

function isUrlAttributeName(name) {
  return name !== undefined && URL_ATTRIBUTES.has(name.toLowerCase());
}

function isUrlAttributeValue(text, offset) {
  if (!isInsideTag(text, offset)) return false;
  const tagPrefix = text.slice(text.lastIndexOf('<', offset), offset);
  const valuePrefix = text.slice(Math.max(0, offset - 32), offset);
  return (
    isUrlAttributeName(OPEN_QUOTED_ATTRIBUTE_VALUE.exec(tagPrefix)?.[1]) ||
    isUrlAttributeName(ATTRIBUTE_NAME_BEFORE_VALUE.exec(valuePrefix)?.[1])
  );
}

const STYLESHEET_HOST_LANGUAGES = new Set(['.html', '.svg', '.vue']);

function isCssUrlValue(text, offset, language) {
  const isStylesheet = language === '.css';
  if (!isStylesheet && !STYLESHEET_HOST_LANGUAGES.has(language)) return false;
  if (!/\burl\(\s*['"]?\s*$/i.test(text.slice(Math.max(0, offset - 16), offset))) return false;
  return isStylesheet || isInStyleElement(text, offset) || isStyleAttributeValue(text, offset);
}

const STYLE_ELEMENT_NAME_END = /^<style[\s/>]/;

function isInStyleElement(text, offset) {
  const open = text.lastIndexOf('<style', offset);
  if (open === -1 || !STYLE_ELEMENT_NAME_END.test(text.slice(open, open + 7))) return false;
  const tagEnd = text.indexOf('>', open);
  if (tagEnd === -1 || tagEnd >= offset) return false;
  const close = text.indexOf('</style', tagEnd);
  return close === -1 || close > offset;
}

function isStyleAttributeValue(text, offset) {
  if (!isInsideTag(text, offset)) return false;
  const tagPrefix = text.slice(text.lastIndexOf('<', offset), offset);
  return OPEN_QUOTED_ATTRIBUTE_VALUE.exec(tagPrefix)?.[1].toLowerCase() === 'style';
}

const TAG_NAME_AFTER_LESS_THAN = /^<\/?[A-Za-z][A-Za-z0-9:._-]*[\s/>]/;

function isInsideTag(text, offset) {
  const open = text.lastIndexOf('<', offset);
  if (open === -1 || open < text.lastIndexOf('>', offset)) return false;
  return TAG_NAME_AFTER_LESS_THAN.test(text.slice(open, open + 40));
}

function isUrlRatherThanPath(text, context, offset, language) {
  if (isFileUrl(text, offset)) return false;
  return (
    isRouteLiteral(text, context, offset) ||
    isUrlAttributeValue(text, offset) ||
    isCssUrlValue(text, offset, language) ||
    isUrlArgument(text, context, offset) ||
    isOriginRelativeUrl(text, context, offset)
  );
}

const SHELL_SHEBANG = /\b(?:ba|z|k|da)?sh\b/;

const SHEBANG_GRAMMARS = [
  [/\b(?:php)\b/, '.php'],
  [SHELL_SHEBANG, '.sh'],
  [/\bpython[\d.]*\b/, '.py'],
  [/\b(?:node|bun|deno)\b/, '.js'],
];

function shebangLanguageOf(contents) {
  const shebang = shebangLineOf(contents);
  if (shebang === undefined) return undefined;
  return SHEBANG_GRAMMARS.find(([pattern]) => pattern.test(shebang))?.[1];
}

function languageExtensionFor(file, contents) {
  const extension = extensionAfterNonLeadingDot(basenameOf(file));
  if (extension !== '') return extension;
  return shebangLanguageOf(contents) ?? '';
}

const ENVIRONMENT_TEMPLATE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/;

function commentGrammarFor(file, contents) {
  const basename = basenameOf(file);
  if (ENVIRONMENT_TEMPLATE.test(basename)) return BOUNDED_HASH_COMMENTS;
  const extension = extensionAfterNonLeadingDot(basename);
  if (extension !== '') return COMMENT_GRAMMARS.get(extension);
  const named = BASENAME_COMMENT_GRAMMARS.get(basename);
  if (named) return named;
  const language = shebangLanguageOf(contents);
  return language === undefined ? undefined : COMMENT_GRAMMARS.get(language);
}

/**
 * Escapes allowed inside the scanned surfaces.
 *
 * Each entry names the candidate it approves via `allow`, not just the file. A
 * file-wide exemption would silently absorb any *future* escape added to the same
 * file: approving a private-engine import would also approve an unrelated private
 * fixture added next to it a year later.
 *
 * Keep this empty where possible. A test that needs private data should get a
 * public fixture instead — that is the fix, not an entry here.
 */
const EXEMPT_PATHS = new Map([
  [
    'scripts/__tests__/docx-privacy.test.mjs',
    {
      reason: 'embeds Windows template and hyperlink paths on purpose, to assert the privacy gate reports them',
      allow: /^[A-Za-z]:[\\/]{1,2}/,
    },
  ],
  [
    'apps/cli/scripts/__tests__/pinned-embedded-binaries.test.ts',
    {
      reason: 'embeds build-machine paths on purpose, to assert the artifact audit accepts the pinned binary and rejects a planted path',
      allow: /^\/Users\/(?:runner|example)\//,
    },
  ],
  [
    'scripts/__tests__/check-public-boundary.test.mjs',
    {
      reason: "this guard's own fixtures, which embed escaping paths on purpose to prove it fails on them",
      // Every shape the fixtures exercise: a leading traversal with either
      // separator, a traversal reached through child segments or a `./` prefix,
      // a bare `..` with no separator at all, and the home-directory form.
      allow: /^(?:\.{0,2}[/\\]?(?:[A-Za-z0-9_.-]+[/\\])*\.\.(?:[/\\]|$)|\/home\/)/,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/v2-preset-compat.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/tracked-only-policy.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/contextual-formatting.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/replace-granularity.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/style-table.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/full-preset-anchor-occurrence.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /^(?:\.\.\/){7}v2\/headless\/dist\/index\.js$/,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/full-preset-compare.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /^(?:\.\.\/){7}v2\/headless\/dist\/index\.js$/,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/full-preset-heading-adoption.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /^(?:\.\.\/){7}v2\/headless\/dist\/index\.js$/,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/full-preset-style-replace.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /^(?:\.\.\/){7}v2\/headless\/dist\/index\.js$/,
    },
  ],
  [
    'packages/sdk/langs/node/src/__tests__/full-preset-tracked-policy.integration.test.ts',
    {
      reason: 'integration test against the private engine build; skipped when absent',
      allow: /^(?:\.\.\/){7}v2\/headless\/dist\/index\.js$/,
    },
  ],
  [
    'apps/cli/src/__tests__/lib/collaboration/v2-error-mapping.test.ts',
    {
      reason: 'asserts the private engine diagnostics contract (one engine: the native runtime build)',
      allow: /^(?:\.\.\/){7}v2\/dist-native\/runtime\/native-runtime\.js$/,
    },
  ],
  [
    'apps/cli/src/__tests__/runtime-v2-open-lifecycle.test.ts',
    {
      reason: 'exercises the private engine runtime lifecycle (one engine: the native runtime build)',
      allow: /^(?:\.\.\/){5}v2\/dist-native\/runtime\/native-runtime\.js$/,
    },
  ],
  [
    'apps/cli/src/__tests__/runtime-typed-collaboration.test.ts',
    {
      reason: 'exercises typed collaborative open through the private native runtime build',
      allow: /^(?:\.\.\/){5}v2\/dist-native\/runtime\/native-runtime\.js$/,
    },
  ],
  [
    'apps/cli/src/__tests__/typed-collaborative-close-a3c.test.ts',
    {
      reason: 'asserts typed collaborative close against the private native runtime build and its engine host type',
      allow: /^(?:\.\.\/){5}v2\/(?:dist-native\/runtime\/native-runtime|src\/document-engine)\.js$/,
    },
  ],
  [
    'apps/cli/src/__tests__/runtime-typed-remote-change.test.ts',
    {
      reason: 'seeds a private collaboration room (bootstrap helpers) to assert the typed remote-change event',
      allow: /^(?:\.\.\/){5}v2\/collaboration-v2\/src\/(?:manifest\/bootstrap|setup\/bootstrap-docx)$/,
    },
  ],
  [
    'apps/cli/scripts/__tests__/cli-version-build.test.ts',
    {
      reason: 'pins the native CLI compile to the private engine canvas version and its built (dist-native) inputs',
      allow: /^(?:\.\.\/){5}v2\/(?:package\.json)?$/,
    },
  ],
  [
    'scripts/__tests__/check-repo-structure.test.mjs',
    { reason: 'fixture asserts the workspace-escape rule itself fires', allow: /(?:^|\/)v2(?:\/|$)/ },
  ],
  [
    'scripts/__tests__/publish-fonts-baseline.test.mjs',
    {
      reason: 'asserts release scoping against the private engine tree, and uses a fake home path as a fixture',
      allow: /(?:(?:^|\/)v2(?:\/|$)|^\/(?:Users\/someone|home\/runner)\/|^[A-Za-z]:[\\/])/,
    },
  ],
  [
    'scripts/__tests__/audit-publish-artifact.test.mjs',
    {
      reason:
        'embeds fake leaked absolute paths on purpose — a synthetic project path plus real-world CI ' +
        'build roots — to assert the publish audit reports them',
      allow: /^\/Users\/(?:example|runner|administrator)\//,
    },
  ],
  [
    'packages/superdoc/scripts/ensure-types.test.ts',
    {
      reason:
        'seeds emitted declarations into a temporary dist root; their shared/common specifiers resolve inside ' +
        'that root, which is what ensure-types rewrites',
      allow: /^(?:\.\.\/){4,5}shared\/common(?:\/[a-z-]+\.js)?$/,
    },
  ],
]);

/**
 * Absolute literals that name somebody's machine: `/home/alice/…`, `/Users/bob/…`,
 * `C:\Users\…`. Those cannot resolve in any other clone, so they are always a
 * private dependency rather than a portable path.
 *
 * Deliberately excludes `/tmp`, `/var`, and friends. Tests pass those as
 * synthetic arguments to pure functions — `createBunBuildArgs(..., '/tmp/superdoc')`
 * never touches the filesystem — and including them produced 45 findings across
 * 17 files, none of them a real dependency. A guard that noisy gets ignored,
 * which is worse than one with a stated limit.
 *
 * The same measurement rules out other machine-shaped roots. Adding `/workspace`,
 * `/srv`, `/opt`, `/src` and friends catches a hardcoded `/workspace/orbit/...`,
 * but a root-absolute URL in HTML is not a filesystem path: `<script
 * src="/src/main.tsx">` is how Vite serves an entry point, and widening produced
 * 37 findings across 29 files, all of them that. `/home/` and `/Users/` are kept
 * because they name a person's machine and cannot be anything else. A hardcoded
 * absolute path under some other root is a real gap, and a stated one.
 *
 * The drive-letter branch requires two real path characters after the separator,
 * so a string escape like `"d:\n"` inside YAML fixture text is not read as a
 * Windows path.
 */
const ABSOLUTE_PATH_PATTERN =
  /(?:^|[\s'"`([=,:/])((?:\/(?:home|Users)\/[^\s'"`)\],;]+|[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_.-]{2,}[^\s'"`)\],;]*))/g;

/**
 * A relative literal containing a parent traversal, wherever the traversal sits.
 *
 * `..` after a leading child segment counts: `fixtures/../../private/x.docx`
 * resolves one level above `fixtures`, and an earlier version anchored the
 * pattern at the start of the literal, so that form matched nothing and passed.
 * Resolution decides whether it actually escapes, so a `packages/a/../b` that
 * stays inside is still reported clean.
 */
const RELATIVE_PATH_PATTERN = /(?:^|[[\s'"`(=,:])((?:\.{1,2}[/\\]|[A-Za-z0-9_@.-]+[/\\])*\.\.[/\\][^\s'"`)\],;]*)/g;

/**
 * A traversal composed from separate arguments: `resolve(base, '..', '..', 'x')`.
 *
 * Node joins those into the same path a single `'../../x'` literal would produce,
 * but each fragment carries no separator of its own, so the pattern above matched
 * nothing and the call passed. This form appears in 18 files here, so it is a
 * shape a real escape is likely to take.
 *
 * One `'..'` counts. Requiring two read a single fragment as ordinary, but
 * `resolve(process.cwd(), '..')` in a root-launched test is the repository's
 * parent: the traversal is the whole argument, so neither this pattern nor the
 * separator-bearing one above saw it and the escape was reported clean. Whether
 * anything composes the fragments is `composesPath`'s question, and whether the
 * result escapes is resolution's; neither is this pattern's.
 *
 * The last fragment need not be followed by a comma: `resolve(__dirname, '..',
 * '..')` is a whole path in itself, and requiring a trailing comma on every
 * fragment matched nothing there, so from `examples/a.test.ts` that real escape was
 * reported clean.
 */
const COMPOSED_TRAVERSAL_PATTERN = /((?:['"`]\.\.['"`]\s*,\s*)*['"`]\.\.['"`](?:\s*,\s*['"`][^'"`]*['"`])?)/g;

const PATH_COMPOSING_CALLEES = new Set(['join', 'normalize', 'resolve']);

function joinComposedTraversal(fragment) {
  return [...fragment.matchAll(/['"`]([^'"`]*)['"`]/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .join('/');
}

const FD_FIRST_ARGUMENT = new Set([
  'close',
  'closeSync',
  'fchmod',
  'fchmodSync',
  'fchown',
  'fchownSync',
  'fdatasync',
  'fdatasyncSync',
  'fstat',
  'fstatSync',
  'fsync',
  'fsyncSync',
  'ftruncate',
  'ftruncateSync',
  'futimes',
  'futimesSync',
  'read',
  'readSync',
  'readv',
  'readvSync',
  'write',
  'writeSync',
  'writev',
  'writevSync',
]);

const CLASS_EXPORT_NAME = /^[A-Z]/;

function isPathTakingFsExport(name) {
  return typeof nodeFs[name] === 'function' && !CLASS_EXPORT_NAME.test(name) && !FD_FIRST_ARGUMENT.has(name);
}

const NODE_PATH_COMPOSERS = ['join', 'resolve'];

const PATH_BUILTINS_SHARED_BY_PYTHON_AND_NODE = ['Path', 'open'];

const CWD_ANCHORED_CALLEES = new Set([
  ...Object.keys(nodeFs).filter(isPathTakingFsExport),
  ...NODE_PATH_COMPOSERS,
  ...PATH_BUILTINS_SHARED_BY_PYTHON_AND_NODE,
]);

const PYTHON_OS_AND_SHUTIL_CALLEES = [
  'chdir',
  'copy',
  'copy2',
  'copyfile',
  'copytree',
  'getsize',
  'isdir',
  'isfile',
  'listdir',
  'makedirs',
  'move',
  'remove',
  'replace',
  'removedirs',
  'rmtree',
  'walk',
];

const PYTHON_CWD_RESOLVING_CALLEES = ['abspath', 'realpath', 'expanduser'];

const PHP_FILESYSTEM_FUNCTIONS = [
  'file_get_contents',
  'file_put_contents',
  'chdir',
  'fopen',
  'file_exists',
  'is_dir',
  'is_file',
  'is_readable',
  'is_writable',
  'is_link',
  'scandir',
  'glob',
  'unlink',
  'mkdir',
  'rmdir',
  'realpath',
  'readfile',
  'file',
  'parse_ini_file',
  'copy',
  'rename',
  'touch',
];

const PHP_ALGORITHM_FIRST_FILE_FUNCTIONS = ['hash_file', 'hash_hmac_file'];

const PHP_DIGEST_AND_STAT_FUNCTIONS = [
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
  'filesize',
  'is_executable',
  'disk_free_space',
  'disk_total_space',
];

const PHP_SPL_FILE_CLASSES = [
  'SplFileObject',
  'SplFileInfo',
  'DirectoryIterator',
  'RecursiveDirectoryIterator',
  'FilesystemIterator',
  'GlobIterator',
];

const LANGUAGE_CWD_ANCHORED_CALLEES = new Map([
  ['.py', new Set([...PYTHON_OS_AND_SHUTIL_CALLEES, ...PYTHON_CWD_RESOLVING_CALLEES])],
  [
    '.php',
    new Set([
      ...PHP_FILESYSTEM_FUNCTIONS,
      ...PHP_ALGORITHM_FIRST_FILE_FUNCTIONS,
      ...PHP_DIGEST_AND_STAT_FUNCTIONS,
      ...PHP_SPL_FILE_CLASSES,
    ]),
  ],
]);

function listTrackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

const SCANNED_BASENAMES = new Set(BASENAME_COMMENT_GRAMMARS.keys());

function isScannedByName(basename) {
  return (
    SCANNED_EXTENSIONS.has(extensionAfterNonLeadingDot(basename)) ||
    SCANNED_BASENAMES.has(basename) ||
    ENVIRONMENT_TEMPLATE.test(basename)
  );
}

function isExtensionlessScript(basename, contents) {
  return extensionAfterNonLeadingDot(basename) === '' && shebangLineOf(contents) !== undefined;
}

function isScanned(file, contents) {
  const basename = basenameOf(file);
  if (!isScannedByName(basename) && !isExtensionlessScript(basename, contents)) return false;
  return isInPublicCloneSurface(file);
}

/**
 * Lanes that run their tests from somewhere other than the repository root, as
 * `working-directory` in the workflow that runs them. Longest prefix wins.
 *
 * The order of this list is not the rule: entries nest — `packages/sdk/scripts/`
 * sits under a hypothetical `packages/sdk/`, and the layout-engine packages sit
 * under `packages/layout-engine/` — and a first-match lookup would have taken
 * whichever happened to be written first. The lookup sorts by prefix length, so
 * an entry can be added anywhere in this list without changing what an existing
 * one means.
 *
 * Anything absent from this table is checked against the repository root, which
 * is where CI launches vitest. Adding an entry is a statement about how a lane
 * is invoked, so it belongs next to the workflow that invokes it.
 */
const RUNNER_WORKING_DIRECTORIES = [
  // ci-superdoc.yml runs the CDN smoke suite from the suite directory.
  ['packages/superdoc/tests/cdn-smoke/', 'packages/superdoc/tests/cdn-smoke'],
  // `pnpm --prefix <dir> run <script>` changes to <dir> before running, so these
  // lanes launch from a package root rather than from the repository root.
  // Verified against pnpm 11: `pnpm --prefix apps/mcp run` reports a cwd of
  // `<root>/apps/mcp`. Without these entries a fixture path that is correct at
  // runtime resolved two levels too high and failed the required job.
  //
  // ci-mcp.yml: `pnpm --prefix apps/mcp run test`.
  ['apps/mcp/', 'apps/mcp'],
  // ci-superdoc.yml runs the root `test:cli` script, which is itself
  // `pnpm --prefix apps/cli run test`. The wrapper is why a grep for `--prefix`
  // in the workflows did not turn this one up: the indirection is in package.json.
  ['apps/cli/', 'apps/cli'],
  // ci-superdoc.yml: `pnpm --prefix packages/sdk run test:scripts`, which runs
  // `scripts/__tests__/*.test.mjs` from `packages/sdk`. Only that directory: the
  // language SDKs under `packages/sdk/langs/` are tested by their own lanes from
  // the repository root, and a blanket `packages/sdk/` entry would mis-anchor
  // those. Longest prefix wins, so this stays below any future deeper entry.
  ['packages/sdk/scripts/', 'packages/sdk'],
  // ci-superdoc.yml's bun-test step runs `pnpm -r --filter <pkg> ... test`, and a
  // recursive run executes each package's script from that package's own root —
  // verified against pnpm 11 in a scratch workspace. One entry per filtered
  // package, resolved from the `name` in its package.json rather than assumed
  // from the filter, since three of them live under `packages/layout-engine/` and
  // three under `shared/`.
  ['packages/document-api/', 'packages/document-api'],
  ['packages/layout-engine/layout-engine/', 'packages/layout-engine/layout-engine'],
  ['packages/layout-engine/style-engine/', 'packages/layout-engine/style-engine'],
  ['packages/layout-engine/geometry-utils/', 'packages/layout-engine/geometry-utils'],
  ['packages/word-layout/', 'packages/word-layout'],
  ['shared/common/', 'shared/common'],
  ['shared/font-utils/', 'shared/font-utils'],
  ['shared/url-validation/', 'shared/url-validation'],
  // `pnpm --filter <pkg> test` selects a package and runs its script from that
  // package's root, the same as a recursive run. One entry per lane that tests a
  // package this way, resolved from each package.json's `name`:
  //   react.yml, vscode.yml,
  //   ci-docs.yml, and ci-superdoc.yml's memory-profiling step.
  // `packages/superdoc/tests/cdn-smoke/` is the same shape and was already above.
  ['packages/react/', 'packages/react'],
  // Two bases, not one. These are also projects in the root `vitest.config.mjs`
  // workspace, which ci-superdoc.yml runs with `pnpm exec vp test run` from the
  // repository root, so the same test file really is launched from both its own
  // package and the root. A single longest-prefix base only modelled the first,
  // and a path that stays inside under the package escapes under the root.
  ['packages/layout-engine/tests/', ['packages/layout-engine/tests', '.']],
  ['apps/docs/', 'apps/docs'],
  ['apps/vscode-ext/', ['apps/vscode-ext', '.']],
  // ci-docs.yml runs the root `test:document-api-smoke` script, which is
  // `pnpm --filter @superdoc-testing/document-api-smoke test`. Same wrapped shape
  // as `test:cli`: the `--filter` lives in package.json, so grepping only the
  // workflows does not reveal it.
  ['tests/document-api-smoke/', 'tests/document-api-smoke'],
];

/**
 * For each requested offset, the unclosed `(` stack around it and whether it sits
 * inside a comment. One forward pass, so a `(` inside a string literal and a `//`
 * inside a URL cannot corrupt the nesting.
 *
 * The whole stack rather than just the innermost call, because a pass-through
 * transformer between the candidate and the call that anchors it has to be looked
 * through: see `enclosingCall`.
 *
 * Written as a scan rather than a parse because the question is narrow: which
 * call encloses this string, and what came before it in that call's arguments.
 * An earlier version answered it per statement instead, delimiting statements by
 * `;` or a blank line. That was wrong in both directions. It missed the base
 * when a URL literal's `//` truncated the statement, and it applied one base to
 * every path in a statement, so `{ cwd: process.cwd(), fixture: new URL('../x',
 * import.meta.url) }` resolved the fixture from the wrong place.
 */
function describeCallContexts(text, offsets, { grammar, language } = {}) {
  const wanted = new Set(offsets);
  const contexts = new Map();
  const open = [];
  // Interpolation bookkeeping: the string state to restore and the brace depth,
  // so a replacement field's closing `}` is told apart from an object's.
  const templates = [];
  const braces = [];
  // 'code', 'line-comment', 'block-comment', or the quote character in progress.
  let mode = 'code';
  let quoteWidth = 1;
  let stringInterpolates = false;
  // The closer of the block comment in progress, since a format can have more
  // than one block form: a `.vue` file uses both `*/` and `-->`.
  let blockClose = null;
  // Whether the current line is a Makefile recipe, which is shell rather than
  // Make. Recomputed at each newline; a leading TAB is what marks one.
  let inMakeRecipe = text[0] === '\t';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\n') inMakeRecipe = text[i + 1] === '\t';
    if (wanted.has(i)) {
      contexts.set(i, {
        openParens: [...open],
        inComment: mode === 'line-comment' || mode === 'block-comment',
      });
    }
    if (mode === 'line-comment') {
      if (char === '\n') mode = 'code';
      i += 1;
      continue;
    }
    if (mode === 'block-comment') {
      if (text.startsWith(blockClose, i)) {
        mode = 'code';
        i += blockClose.length;
        blockClose = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode !== 'code') {
      if (char === '\\') {
        i += 2;
        continue;
      }
      // `${...}` inside a backtick string is code, not text. Staying in string
      // mode through it meant the interpolation's parentheses were never recorded,
      // so a call written as `` `${resolve(process.cwd(), '../x')}` `` lost its
      // base and an escape was resolved from the source file instead.
      const startsJavaScriptInterpolation = mode === '`' && char === '$' && text[i + 1] === '{';
      if (language === '.py' && stringInterpolates && char === '{' && text[i + 1] === '{') {
        i += 2;
        continue;
      }
      const startsPythonInterpolation = language === '.py' && stringInterpolates && char === '{' && text[i + 1] !== '{';
      if (startsJavaScriptInterpolation || startsPythonInterpolation) {
        templates.push({ mode, quoteWidth, stringInterpolates });
        mode = 'code';
        stringInterpolates = false;
        // Brace depth, not paren depth. An object literal inside the
        // interpolation, `${{ ok: true } && resolve(...)}`, closes a brace of its
        // own, and keying on `open.length` treated that as the interpolation's end:
        // the call after it was scanned as backtick text and lost its cwd base.
        braces.push(0);
        i += startsJavaScriptInterpolation ? 2 : 1;
        continue;
      }
      if (text.startsWith(mode.repeat(quoteWidth), i)) {
        mode = 'code';
        i += quoteWidth;
        quoteWidth = 1;
        stringInterpolates = false;
        continue;
      }
      i += 1;
      continue;
    }
    // Closing an interpolation returns to the string that opened it, but only the
    // brace that matches its `${`: an inner `{` increments the count first.
    if (braces.length > 0 && char === '{') {
      braces[braces.length - 1] += 1;
      i += 1;
      continue;
    }
    if (braces.length > 0 && char === '}') {
      if (braces[braces.length - 1] === 0) {
        braces.pop();
        const restored = templates.pop();
        mode = restored.mode;
        quoteWidth = restored.quoteWidth;
        stringInterpolates = restored.stringInterpolates;
      } else {
        braces[braces.length - 1] -= 1;
      }
      i += 1;
      continue;
    }
    const lineOpener = grammar?.lines?.find((opener) => text.startsWith(opener, i));
    // A `#` opens a comment only where the grammar says a word cannot run into
    // it. The shell needs that: `${#value}` is the parameter-length expansion, and
    // treating its `#` as a comment blanked the rest of the line, so an escaping
    // `cat` argument after one was never seen. Python and PHP do not, since `x=1#
    // note` really is a comment there; see BOUNDED_HASH_COMMENTS.
    //
    // A Makefile is both at once. Its own lines are `#`-commented unconditionally,
    // but a recipe line — one starting with a TAB — is handed to the shell
    // verbatim, so a `$${#value}` in a recipe needs the shell rule or the rest of
    // that line is blanked and an escaping `cat` after it disappears.
    const needsBoundary = grammar?.hashNeedsBoundary || (grammar?.hashNeedsBoundaryInRecipes && inMakeRecipe);
    const commentOpensHere = lineOpener !== '#' || !needsBoundary || i === 0 || /[\s;&|(]/.test(text[i - 1]);
    if (lineOpener && commentOpensHere) {
      mode = 'line-comment';
      i += lineOpener.length;
      continue;
    }
    const block = grammar?.blocks?.find(([opener]) => text.startsWith(opener, i));
    if (block) {
      mode = 'block-comment';
      blockClose = block[1];
      i += block[0].length;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      mode = char;
      quoteWidth = language === '.py' && text.startsWith(char.repeat(3), i) ? 3 : 1;
      const prefix = text.slice(Math.max(0, i - 3), i);
      stringInterpolates = language === '.py' && /(?:^|[^A-Za-z0-9_])(?:f|fr|rf)$/i.test(prefix);
      i += quoteWidth;
      continue;
    }
    if (char === '(') open.push(i);
    else if (char === ')') open.pop();
    i += 1;
  }
  return contexts;
}

const INDEPENDENT_PATH_ARGUMENTS = new Set([
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'link',
  'linkSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
  'copy',
  'copy2',
  'copyfile',
  'copytree',
  'move',
  'replace',
]);

const PYTHON_PATH_ARGUMENT_NAMES = new Set(['file', 'path', 'src', 'dst']);

const DATA_AFTER_PATH_CALLEES = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'file_put_contents',
]);

const STATIC_COMPUTED_MEMBER = /\[\s*(['"`])([A-Za-z0-9_$]+)\1\s*\]$/;

function calleeBefore(text, parenIndex) {
  let end = parenIndex;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  if (text.slice(end - 2, end) === '?.') {
    end -= 2;
    while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  }
  const computed = STATIC_COMPUTED_MEMBER.exec(text.slice(0, end));
  if (computed) {
    const receiverEnd = end - computed[0].length;
    let receiverStart = receiverEnd;
    while (receiverStart > 0 && /[A-Za-z0-9_$.]/.test(text[receiverStart - 1])) receiverStart -= 1;
    return { name: computed[2], receiver: text.slice(receiverStart, receiverEnd), start: receiverStart };
  }
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$.]/.test(text[start - 1])) start -= 1;
  const qualified = text.slice(start, end);
  const dot = qualified.lastIndexOf('.');
  return { name: qualified.slice(dot + 1), receiver: dot === -1 ? '' : qualified.slice(0, dot), start };
}

const PASS_THROUGH_PATH_CALLEES = new Set(['dirname', 'normalize', 'toNamespacedPath']);

const PATH_DISCARDING_CALLEES = new Set(['basename', 'stem']);

function enclosingCall(text, context, offset) {
  const parens = context.openParens;
  let argumentEnd = offset;
  for (let i = parens.length - 1; i >= 0; i -= 1) {
    const { name, start } = calleeBefore(text, parens[i]);
    if (i === 0 || !PASS_THROUGH_PATH_CALLEES.has(name)) return { openParen: parens[i], argumentEnd };
    argumentEnd = start;
  }
  return { openParen: -1, argumentEnd };
}

function composesPath(text, context) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  if (isArrayJoin(text, paren)) return false;
  return PATH_COMPOSING_CALLEES.has(calleeBefore(text, paren).name);
}

const PATH_NAME_PROPERTY_AFTER_LITERAL = /^['"`]\s*\)\s*\.\s*name\b/;

function discardsLeadingSegments(text, context, offset, candidate) {
  const paren = context?.openParens?.at(-1);
  if (paren !== undefined && PATH_DISCARDING_CALLEES.has(calleeBefore(text, paren).name)) return true;
  return PATH_NAME_PROPERTY_AFTER_LITERAL.test(text.slice(offset + candidate.length));
}

const MODULE_RELATIVE_RECEIVERS = new Set(['require', 'import.meta', 'Promise']);

const CHILD_PROCESS_CALLEES = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);

const ARGV_CHILD_PROCESS_CALLEES = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);

const OUTPUT_ONLY_PROGRAMS = /^(['"`])(?:echo|printf)\1$/;

const SHELL_OPTION = /\bshell\s*:/;

function firstArgument(argumentList) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < argumentList.length; i += 1) {
    const char = argumentList[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) return argumentList.slice(0, i);
  }
  return argumentList;
}

const NON_FILESYSTEM_RECEIVERS = new Map([
  ['window', new Set(['open'])],
  ['globalThis', new Set(['open'])],
  ['self', new Set(['open'])],
]);

const FILESYSTEM_RECEIVER_CALLEES = new Map([['Bun', new Set(['file', 'write'])]]);

const DATA_AFTER_PATH_RECEIVER_CALLEES = new Map([['Bun', new Set(['write'])]]);

const FS_MODULE_RECEIVERS = new Set(['fs', 'fsp', 'fsPromises', 'promises', 'nodeFs']);

const HANDLE_DATA_METHODS = new Set(['writeFile', 'appendFile']);

const HANDLE_WRITE_OPTIONS =
  /^(?:\{[\s\S]*\}$|(['"`])(?:utf-?8|ascii|base64url|base64|binary|hex|latin1|ucs-?2|utf-?16le)\1$)/i;

function isHandleDataArgument(text, openParen, name, receiver) {
  if (!HANDLE_DATA_METHODS.has(name)) return false;
  if (receiver === '' || FS_MODULE_RECEIVERS.has(receiver.split('.').pop())) return false;
  const argumentList = completeArgumentList(text, openParen);
  const following = argumentPosition(argumentList);
  if (following === 0) return true;
  if (following > 1) return false;
  return HANDLE_WRITE_OPTIONS.test(currentArgument(argumentList).trim());
}

const LANGUAGE_PATH_ARGUMENT_POSITION = new Map([
  [
    '.php',
    new Map([
      ['hash_file', 1],
      ['hash_hmac_file', 1],
    ]),
  ],
]);

function argumentPosition(precedingArguments) {
  let depth = 0;
  let quote = null;
  let commas = 0;
  for (let i = 0; i < precedingArguments.length; i += 1) {
    const char = precedingArguments[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) commas += 1;
  }
  return commas;
}

function isArrayJoin(text, parenIndex) {
  const { name, start } = calleeBefore(text, parenIndex);
  if (name !== 'join') return false;
  let before = start;
  while (before > 0 && /\s/.test(text[before - 1])) before -= 1;
  return before > 0 && (text[before - 1] === ']' || text[before - 1] === ')');
}

function currentArgument(argumentList) {
  let depth = 0;
  let quote = null;
  let lastComma = -1;
  for (let i = 0; i < argumentList.length; i += 1) {
    const char = argumentList[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) lastComma = i;
  }
  return argumentList.slice(lastComma + 1);
}

function completeArgumentList(text, openParen) {
  let depth = 0;
  let quote = null;
  for (let i = openParen + 1; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) return text.slice(openParen + 1, i);
      depth -= 1;
    }
  }
  return text.slice(openParen + 1);
}

/**
 * The same text with the two regex-literal shapes that confuse the scanner
 * blanked to spaces.
 *
 * `const r = /\/\//` contains the two characters that open a line comment, so the
 * scanner switched to comment mode at the regex and read the rest of that line as
 * prose. A regex holding a brace, `/}/`, is the interpolation version of the same
 * problem: inside `${...}` its `}` was counted as the interpolation's terminator,
 * so the call after it lost its cwd base and a root-relative escape resolved from
 * the source file instead.
 *
 * Length-preserving, so every offset still points at the same character of the
 * original. Only these shapes, deliberately: a full regex-versus-division
 * heuristic misjudges comment text containing a slash, which is an over-report on
 * a gate that blocks merges.
 *
 * The third shape is a character class holding a slash, `/[/*]/`. The other two
 * patterns stop at the first bare `/`, so they never saw it, and its `/*` opened
 * a block comment that ran to the end of the file: every candidate after it read
 * as `inComment`, so a following `readFileSync('../../../../labs/x')` was
 * reported clean. Only the class *contents* are blanked, not the enclosing
 * literal, which keeps the edit inside one `[...]` on one line and means it
 * cannot swallow a later call the way blanking a whole literal can. A class whose
 * body looks path-shaped is left visible, so the blanking can never be what hides
 * an escape.
 */
const CONFUSING_REGEX_BODY = String.raw`(?:[^/\n\\]|\\.)*`;
const ESCAPED_SLASH_REGEX = new RegExp(
  String.raw`/${CONFUSING_REGEX_BODY}\\/\\/${CONFUSING_REGEX_BODY}/[gimsuy]*`,
  'g',
);
const BRACED_REGEX = new RegExp(String.raw`/${CONFUSING_REGEX_BODY}[{}]${CONFUSING_REGEX_BODY}/[gimsuy]*`, 'g');
/** A character class on one line, whatever it holds. */
const CHARACTER_CLASS = /\[(?:[^\]\n\\]|\\.)*\]/g;
/** Anything that could be the start of a real path, and so must stay visible. */
const PATH_SHAPED_CLASS_BODY = /\.\.|\/home|\/Users|[A-Za-z]:[\\/]/i;

function withoutSlashCharacterClasses(text) {
  return text.replace(CHARACTER_CLASS, (match) => {
    const body = match.slice(1, -1);
    // Only a slash inside the class can open a comment; nothing else here matters.
    if (!body.includes('/')) return match;
    // A class body that reads like a path is left alone. Blanking it could only
    // ever hide an escape, and this pass exists to stop the scanner losing one.
    //
    // Except for a quote in it. `/[/'..]/` is path-shaped, so the body survives,
    // but the class slash ends the literal for every later pass and the
    // apostrophe then opens string mode, hiding the call on the rest of the
    // line. Blanking only the quote keeps the path text visible and takes the
    // string away, which is the one edit that cannot lose an escape.
    if (PATH_SHAPED_CLASS_BODY.test(body)) {
      return /['"`]/.test(body) ? `[${body.replace(/['"`]/g, ' ')}]` : match;
    }
    return `[${' '.repeat(body.length)}]`;
  });
}

/**
 * A regex literal in a position where a value is expected, used to find quote
 * characters inside one.
 *
 * A regex may hold a quote — `/'/` is a valid pattern — and the tokenizer reads
 * that apostrophe as opening a string. Everything after it became string text, so
 * a following `readFileSync('../labs/x')` was never recorded as a call and its
 * literal resolved from the source directory instead of the cwd.
 *
 * The leading operator is what makes this safe. Matching a bare `/.../` anywhere
 * also matches the middle of an ordinary line: `'a/b.test.ts': "copy('/tmp/x'` has
 * a `/`, a quote, and a later `/`, and blanking those quotes unbalanced the string
 * state and produced a false finding in this repository's own fixture file. A
 * regex literal can only follow an operator, an opening bracket, or a line start.
 *
 * The keyword list is every keyword that leaves an operand position open, not
 * only the ones that read like control flow. `typeof /'/` and `void /'/` are
 * operand positions too, and while they are strange code, a scanner that misses
 * them lets the apostrophe open string mode and hides the rest of the line.
 *
 * Only the quote characters inside the literal are blanked, never the literal
 * itself and never anything around it. Blanking whole literals was tried and
 * rejected: on five adversarial shapes it swallowed a real path in three. The
 * literal stays on one line, and a body that reads like a path is left visible,
 * so this can never be what hides an escape.
 */
const REGEX_OPERAND_KEYWORDS =
  'return|await|yield|throw|typeof|void|delete|instanceof|in|of|case|do|else|new|default|extends';
// A control condition's closing paren, which puts what follows in statement
// position: `if (true) /'/.test(x)` is a regex, not division. A bare `)` cannot
// join the operator class above, because `)` is followed by division far more
// often than by a regex — `f(a) / 2, '/tmp/x'` would have its quote blanked and
// the string state unbalanced, which is the false finding that class is narrow
// to avoid. Naming the keyword is what separates the two.
const CONTROL_CONDITION = String.raw`\b(?:if|while|for(?:\s+await)?|switch)\s*\((?:[^()\n]|\([^()\n]*\))*\)`;

const REGEX_AFTER_OPERATOR = new RegExp(
  String.raw`(^|[=(,:[&|!?+\-*%;{}~]|=>|(?<!\.)\b(?:${REGEX_OPERAND_KEYWORDS})|${CONTROL_CONDITION})(\s*)(\/(?:[^/\n\\]|\\.)+\/[gimsuy]*)`,
  'g',
);

function withoutRegexQuotes(text) {
  return text.replace(REGEX_AFTER_OPERATOR, (whole, before, spacing, literal) => {
    const body = literal.slice(1, literal.lastIndexOf('/'));
    if (!/['"`]/.test(body)) return whole;
    if (PATH_SHAPED_CLASS_BODY.test(body)) return whole;
    return `${before}${spacing}${literal.replace(/['"`]/g, ' ')}`;
  });
}

function withoutEscapedSlashRegexes(text) {
  return withoutRegexQuotes(withoutSlashCharacterClasses(text))
    .replace(ESCAPED_SLASH_REGEX, (match) => ' '.repeat(match.length))
    .replace(BRACED_REGEX, (match) => ' '.repeat(match.length));
}

function withoutComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\' && i + 1 < text.length) {
        out += text.slice(i, i + 2);
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      const stop = newline === -1 ? text.length : newline;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? text.length : close + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += char;
  }
  return out;
}

const PYTHON_CWD_EXPRESSION = /(?:Path\.cwd|os\.getcwd)\s*\(\s*\)/;
const NODE_CWD_EXPRESSION = /process\.cwd\s*\(\s*\)/;

function cwdAnchorFrom(text, language) {
  const pattern = language === '.py' ? PYTHON_CWD_EXPRESSION : NODE_CWD_EXPRESSION;
  const match = pattern.exec(text);
  if (!match) return null;
  const segments = [...text.slice(match.index + match[0].length).matchAll(/['"`]([^'"`]*)['"`]/g)]
    .map((entry) => entry[1])
    .filter(Boolean);
  return { cwdRelative: true, prefix: segments.join('/') || undefined };
}

const NOT_CWD_ANCHORED = Object.freeze({ cwdRelative: false });
const CWD_ANCHORED = Object.freeze({ cwdRelative: true });
const DATA_NOT_PATH = Object.freeze({ cwdRelative: false, isData: true });

function cwdBaseAfterUrlCandidate(text, openParen, offset, candidate, language) {
  const allArguments = completeArgumentList(text, openParen);
  const candidateStart = offset - openParen - 1;
  const afterCandidate = allArguments.slice(candidateStart + candidate.length);
  const followingBase = /^(['"`])\s*,([\s\S]*)$/.exec(afterCandidate)?.[2];
  return followingBase ? cwdAnchorFrom(withoutComments(followingBase), language) : null;
}

function isModuleRelativeResolve({ name, receiver }) {
  return name === 'resolve' && MODULE_RELATIVE_RECEIVERS.has(receiver);
}

function isNonFilesystemReceiverCall({ name, receiver }) {
  return Boolean(NON_FILESYSTEM_RECEIVERS.get(receiver)?.has(name));
}

function isSpawnedOutputOnlyProgram(text, openParen, name) {
  const argumentList = completeArgumentList(text, openParen);
  const program = firstArgument(argumentList).trim();
  return ARGV_CHILD_PROCESS_CALLEES.has(name) && OUTPUT_ONLY_PROGRAMS.test(program) && !SHELL_OPTION.test(argumentList);
}

function isCwdAnchoringCallee({ name, receiver }, languageCallees) {
  const anchors = (candidateName) =>
    CWD_ANCHORED_CALLEES.has(candidateName) ||
    Boolean(languageCallees?.has(candidateName)) ||
    Boolean(FILESYSTEM_RECEIVER_CALLEES.get(receiver)?.has(candidateName));
  return anchors(name) || anchors(lastSegmentOf(receiver));
}

const PASS_THROUGH_TEMPLATE_TAG = /(?:^|[\s(,])String\.raw\s*$/;
const PYTHON_KEYWORD_ARGUMENT = /^([A-Za-z_][A-Za-z0-9_]*)\s*=$/;

function isPythonPathKeyword(beforeCandidate) {
  const keyword = PYTHON_KEYWORD_ARGUMENT.exec(currentArgument(beforeCandidate).trim())?.[1];
  return keyword !== undefined && PYTHON_PATH_ARGUMENT_NAMES.has(keyword);
}

function isFirstPathArgument(precedingArguments, language) {
  const beforeCandidate = precedingArguments.replace(/['"`]\s*$/, '').replace(PASS_THROUGH_TEMPLATE_TAG, '').trim();
  return beforeCandidate === '' || (language === '.py' && isPythonPathKeyword(beforeCandidate));
}

const SYMLINK_CALLEES = new Set(['symlink', 'symlinkSync']);

function symlinkTargetDirectory(text, offset, candidate) {
  const afterTarget = text.slice(offset + candidate.length);
  const secondArgument = /^(['"`])\s*,\s*([\s\S]*)$/.exec(afterTarget)?.[2] ?? '';
  const destination = /^(['"`])([^'"`]*)\1/.exec(secondArgument)?.[2] ?? composedLiteralPath(secondArgument);
  return destination === undefined ? undefined : dirname(destination.replaceAll('\\', '/'));
}

function isDataAfterPath({ name, receiver }) {
  return DATA_AFTER_PATH_CALLEES.has(name) || Boolean(DATA_AFTER_PATH_RECEIVER_CALLEES.get(receiver)?.has(name));
}

function isRootedLiteral(literal) {
  return literal.startsWith('/') || /^[A-Za-z]:[\\/]/.test(literal);
}

function anchorFromEarlierLiterals(precedingArguments) {
  const earlier = precedingArguments.replace(/,\s*['"`]\s*$/, '');
  const literals = [...earlier.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1]);
  const isBareArgumentList = /^[\s,'"`]*$/.test(earlier.replace(/['"`][^'"`]*['"`]/g, ''));
  if (!isBareArgumentList || literals.length === 0 || literals.some(isRootedLiteral)) {
    return { cwdRelative: false, prefix: literals.filter(Boolean).join('/') };
  }
  return { cwdRelative: true, prefix: literals.join('/') };
}

function isCwdAnchored(text, offset, candidate, context, language, languageCallees) {
  if (!context || context.inComment) return NOT_CWD_ANCHORED;
  const { openParen, argumentEnd } = enclosingCall(text, context, offset);
  if (openParen === -1) return NOT_CWD_ANCHORED;
  const argumentList = text.slice(openParen + 1, argumentEnd);
  const callee = calleeBefore(text, openParen);
  const { name, receiver } = callee;
  const precedingArguments = withoutComments(
    INDEPENDENT_PATH_ARGUMENTS.has(name) ? currentArgument(argumentList) : argumentList,
  );
  const precedingCwd = cwdAnchorFrom(precedingArguments, language);
  if (precedingCwd) return precedingCwd;
  if (name === 'URL') {
    const baseCwd = cwdBaseAfterUrlCandidate(text, openParen, offset, candidate, language);
    if (baseCwd) return baseCwd;
  }
  if (isModuleRelativeResolve(callee)) return NOT_CWD_ANCHORED;
  if (isNonFilesystemReceiverCall(callee)) return NOT_CWD_ANCHORED;
  if (CHILD_PROCESS_CALLEES.has(name)) {
    return isSpawnedOutputOnlyProgram(text, openParen, name) ? DATA_NOT_PATH : CWD_ANCHORED;
  }
  if (isArrayJoin(text, openParen)) return NOT_CWD_ANCHORED;
  if (!isCwdAnchoringCallee(callee, languageCallees)) return NOT_CWD_ANCHORED;
  const isFirstArgument = isFirstPathArgument(precedingArguments, language);
  const pathPosition = LANGUAGE_PATH_ARGUMENT_POSITION.get(language)?.get(name);
  if (pathPosition !== undefined) {
    return { cwdRelative: argumentPosition(precedingArguments) === pathPosition };
  }
  if (isFirstArgument && isHandleDataArgument(text, openParen, name, receiver)) return DATA_NOT_PATH;
  if (isFirstArgument && SYMLINK_CALLEES.has(name)) {
    const targetDirectory = symlinkTargetDirectory(text, offset, candidate);
    if (targetDirectory !== undefined) return { cwdRelative: true, prefix: targetDirectory };
  }
  if (isFirstArgument) return CWD_ANCHORED;
  if (isDataAfterPath(callee)) return DATA_NOT_PATH;
  if (INDEPENDENT_PATH_ARGUMENTS.has(name)) return CWD_ANCHORED;
  return anchorFromEarlierLiterals(precedingArguments);
}

function composedLiteralPath(text) {
  const call = /^(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:join|resolve)\s*\(([^()]*)\)/.exec(text);
  if (!call) return undefined;
  const literal = /(['"`])([^'"`]*)\1/g;
  const segments = [...call[1].matchAll(literal)].map((match) => match[2]);
  if (segments.length === 0) return undefined;
  if (call[1].replace(literal, '').trim().replace(/,/g, '').trim() !== '') return undefined;
  return segments.join('/');
}

const CWD_RELATIVE_LANGUAGES = new Set(['.sh']);

function isCwdRelativeLanguage(file, contents) {
  const extension = extensionAfterNonLeadingDot(basenameOf(file));
  if (extension !== '') return CWD_RELATIVE_LANGUAGES.has(extension);
  const shebang = shebangLineOf(contents);
  return shebang !== undefined && SHELL_SHEBANG.test(shebang);
}

/**
 * Shell builtins that only write to stdout, so their argument is text rather
 * than a path.
 *
 * The language-level rule above has no callee to consult, so it treated every
 * traversal-shaped string in a shell script as a filesystem access:
 * `printf '%s\n' '../labs/private.docx'` in a fixture failed the required job
 * even though nothing opens it.
 *
 * A deny-list of the two output-only builtins rather than an allow-list of
 * path-taking commands. An allow-list would have to name every command that
 * opens a file, and anything missing from it becomes a missed escape — the wrong
 * direction for this gate. These two are the only ones whose argument is
 * text by definition.
 *
 * Per-command environment assignments are part of the command word's position,
 * not a different command: `LC_ALL=C printf '%s\n' '../labs/x'` prints exactly
 * what `printf` alone would, and anchoring on the segment start alone failed the
 * required job on a fixture that pins its locale. Only the assignment prefix is
 * allowed to precede, so nothing else can put `printf` in the command position.
 */
//
// The prefix a command word may carry is shared, so the two sets that ask "which
// command is this" cannot drift apart. They already had: the environment-prefix
// fix landed on the output-only set alone, and the heredoc set kept rejecting
// `LC_ALL=C cat > expected.txt <<'EOF'` for months of review rounds afterwards.
const COMMAND_WORD_PREFIX = String.raw`^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s'"]*)\s+)*(?:(?:command|builtin)\s+(?:-[pvV]\s+)*)?`;

const OUTPUT_ONLY_SHELL_COMMANDS = new RegExp(`${COMMAND_WORD_PREFIX}(?:echo|printf)\\b`);
/**
 * Anything that can consume the candidate as a path wherever it appears in the
 * command: a pipe, a command substitution, or a process substitution.
 *
 * Process substitution keeps its angle bracket here because `<(...)` and `>(...)`
 * run a command of their own, so the candidate inside one is that command's
 * argument no matter where it sits: `echo <(cat '../labs/x')` really does open
 * the path.
 *
 * A plain redirection is decided relative to the candidate instead, because
 * printed payload stays data while the redirect operand is a path. A bare `<`
 * was here and failed `echo '../labs/x' < /dev/null` on the required job: the
 * only file that command opens is `/dev/null`, and the traversal never leaves
 * stdout.
 *
 * `;`, `&&` and `||` are deliberately absent. They separate commands rather than
 * connecting them: `echo '../labs/x'; true` hands nothing to `true`, and treating
 * the separator as routing failed the required job on a fixture whose traversal
 * never leaves stdout. They are what bounds the segment instead — see below.
 */
const SHELL_PATH_ROUTING = /[|`]|[$<>]\(/;

/**
 * Commands that consume piped bytes as data rather than reinterpreting them as
 * path arguments.
 *
 * `echo '../labs/x' | cat` prints the text and copies it; with no file operand
 * `cat` reads standard input, and nothing opens the traversal. The required job
 * rejected those fixtures because any pipe cancelled the exemption.
 *
 * An allow-list, like the heredoc data commands and unlike the output-only set,
 * because the failure directions differ: a filter missing from this list only
 * leaves a printed path reported, while a reinterpreter wrongly added would hide
 * a real escape. `xargs`, `sh` and friends are absent for exactly that reason —
 * `| xargs cat` really does open what it is handed.
 */
const PIPELINE_FILTER_COMMANDS = new RegExp(
  `${COMMAND_WORD_PREFIX}(?:cat|grep|egrep|fgrep|sed|awk|head|tail|sort|uniq|wc|tr|cut|rev|nl|fold|tee|column)\\b`,
);

/**
 * The candidate's own pipeline stage, its offset inside it, and the stages
 * downstream of it.
 *
 * The unit that decides is the stage, not the whole pipeline. `echo hi | cat
 * '../labs/x'` has an output-only command at the front and a path-opening one
 * after the pipe, and reading the pipeline as a whole let the leading `echo`
 * exempt an argument that `cat` really does open.
 */
function shellPipelineStage(segment, candidateOffset) {
  const stages = [];
  let start = 0;
  let quote = null;
  let candidateStage = 0;
  let stageStart = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (quote) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    // A single `|`. `||` separates commands and never reaches here, because the
    // segmenter already split on it.
    if (char !== '|' || segment[i + 1] === '|' || segment[i - 1] === '|') continue;
    stages.push(segment.slice(start, i));
    if (i < candidateOffset) {
      candidateStage = stages.length;
      stageStart = i + 1;
    }
    start = i + 1;
  }
  stages.push(segment.slice(start));
  return {
    stage: stages[candidateStage],
    offsetInStage: candidateOffset - stageStart,
    downstream: stages.slice(candidateStage + 1),
  };
}

/**
 * Where the candidate's own command begins and ends on its line.
 *
 * The unit that decides is the command, not the line. Reading the whole line
 * meant `echo '../labs/x'; true` lost the exemption, while `echo 'x'; cat
 * '../labs/y'` kept it for the wrong reason — the `cat` argument sits in a
 * different command from the `echo` that made the line look output-only.
 *
 * Split on the separators only. A `|` or a `$(` is routing rather than
 * separation, so it stays inside the segment and `SHELL_PATH_ROUTING` still
 * sees it.
 */
function shellCommandSegment(line, offsetInLine) {
  let start = 0;
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    // Quoting first. A separator inside an argument is text, not syntax:
    // `cat '; echo ' '../labs/x'` is one `cat` call with two arguments, and
    // reading the quoted `;` as a split made the second argument look like it
    // began a new `echo` command and exempted a path `cat` really does open.
    if (quote) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    // `||` and `&&` are separators, and so is a standalone `&`, which backgrounds
    // the command before it: `echo x & cat '../labs/y'` is two commands, and
    // reading it as one `echo` exempted the path `cat` opens.
    //
    // A lone `|` is a pipe, which is routing rather than separation and has to
    // stay inside the segment for the escape test to see. `&` adjacent to `>` is a
    // redirection — `2>&1`, `&>out` — and is likewise not a split. Whether a
    // candidate is payload or the redirect target is decided after segmentation.
    let separator = 0;
    if (char === ';') separator = 1;
    else if ((char === '&' || char === '|') && line[i + 1] === char) separator = 2;
    else if (char === '&' && line[i + 1] !== '>' && line[i - 1] !== '>') separator = 1;
    if (!separator) continue;
    if (i >= offsetInLine) return { text: line.slice(start, i), start };
    start = i + separator;
    i += separator - 1;
  }
  return { text: line.slice(start), start };
}

/**
 * The whole command the offset belongs to, which is not always one physical
 * line.
 *
 * A newline ends a command only when nothing is holding it open. A trailing
 * backslash is the familiar case; an unclosed quote is the other, and reading
 * only the first meant `printf '%s\n' '` with its payload on the next line was
 * analysed without the `printf` in front of it, so the output-only exemption
 * never applied and the required job rejected a fixture that opens nothing.
 *
 * Scanned from the start of the file rather than backwards from the offset,
 * because whether a quote is open at a given newline is only knowable from
 * everything before it.
 */
function shellLogicalLine(contents, offset) {
  let start = 0;
  let end = contents.length;
  let quote = null;
  for (let i = 0; i < contents.length; i += 1) {
    const char = contents[i];
    if (quote) {
      // A backslash escapes inside double quotes only; single quotes are literal.
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\\') {
      // Skips the next character, so a backslash-continued newline never ends
      // the command.
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== '\n') continue;
    if (i >= offset) {
      end = i;
      break;
    }
    start = i + 1;
  }

  return {
    text: contents.slice(start, end).replace(/\\\r?\n/g, (continuation) => ' '.repeat(continuation.length)),
    offset: offset - start,
  };
}

/** Whether this candidate is only ever printed, in a shell command that keeps it so. */
function isPrintedShellArgument(contents, offset) {
  const line = shellLogicalLine(contents, offset);
  const segment = shellCommandSegment(line.text, line.offset);
  // Routing is syntax, so it only counts outside quotes — the same rule the
  // splitter follows. `echo '$(' '../labs/x'` prints a literal `$(` and routes
  // nothing, and reading it as command substitution cancelled the exemption and
  // failed the required job on a fixture whose traversal never leaves stdout.
  const { stage, offsetInStage, downstream } = shellPipelineStage(segment.text, line.offset - segment.start);
  const syntax = withoutShellQuotes(stage);
  const candidateOffset = offsetInStage;
  const beforeCandidate = syntax.slice(0, candidateOffset);
  const lastOutputRedirect = beforeCandidate.lastIndexOf('>');
  const isRedirectTarget =
    lastOutputRedirect !== -1 && /^&?\s*['"]?\s*$/.test(beforeCandidate.slice(lastOutputRedirect + 1));
  // The same question for input redirection. `< '../labs/x'` opens that path
  // whatever the command is, so the candidate is not payload; a `<` anywhere
  // else in the command is redirecting something that is not the candidate.
  // `<<` and `<<<` are excluded because a heredoc and a here-string carry data
  // rather than name a file to open.
  const lastInputRedirect = beforeCandidate.lastIndexOf('<');
  const isRedirectSource =
    lastInputRedirect !== -1 &&
    beforeCandidate[lastInputRedirect - 1] !== '<' &&
    /^\s*['"]?\s*$/.test(beforeCandidate.slice(lastInputRedirect + 1));
  // Only what the command prints is exempt. `FOO=../labs/x echo hi` prints
  // nothing of the sort — the traversal is an assignment the command carries into
  // its environment, so it stays reportable while the arguments after `echo` do
  // not.
  const command = OUTPUT_ONLY_SHELL_COMMANDS.exec(stage);
  const isArgument = command !== null && candidateOffset >= command.index + command[0].length;
  return (
    isArgument &&
    downstream.every((next) => PIPELINE_FILTER_COMMANDS.test(next)) &&
    !isInsideShellSubstitution(stage, candidateOffset) &&
    !isRedirectTarget &&
    !isRedirectSource
  );
}

/**
 * Whether the candidate sits inside a command or process substitution.
 *
 * A substitution runs a command of its own, so a path inside one is that
 * command's argument. A substitution *elsewhere* in the line runs independently
 * and consumes nothing: `echo "$(date)" '../labs/x'` prints the date and the
 * literal, and testing the whole command for `$(` rejected it even though
 * nothing opens the traversal.
 *
 * Tracks quoting itself rather than reading the blanked text, because the
 * blanking keeps a `$(` inside double quotes visible but not its closing `)`,
 * so a counter run over it never sees the substitution end. Single quotes
 * suppress substitution entirely; double quotes do not. A pipe stays a
 * whole-command question and is tested separately, because it routes everything
 * the command printed rather than one argument.
 */
function isInsideShellSubstitution(segment, candidateOffset) {
  let depth = 0;
  let inBackticks = false;
  let quote = null;
  for (let i = 0; i < candidateOffset && i < segment.length; i += 1) {
    const char = segment[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '`') {
      inBackticks = !inBackticks;
      continue;
    }
    if ((char === '$' || char === '<' || char === '>') && segment[i + 1] === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ')' && depth > 0) depth -= 1;
  }
  return depth > 0 || inBackticks;
}

/**
 * Whether the candidate is the operand of a here-string.
 *
 * `<<<` hands its word to the command on stdin as text. Nothing opens it, so
 * `cat <<< '../labs/x'` and `grep x <<< '../labs/x'` touch no such file, and the
 * required job failed both. Independent of the command for that reason: the
 * printing exemption asks which command it is because an argument's meaning
 * depends on that, and a here-string operand is data whoever receives it.
 */
function isHereStringOperand(contents, offset) {
  const line = shellLogicalLine(contents, offset);
  const before = withoutShellQuotes(line.text).slice(0, line.offset);
  const marker = before.lastIndexOf('<<<');
  return marker !== -1 && /^\s*['"]?\s*$/.test(before.slice(marker + 3));
}

/**
 * Commands whose heredoc body is copied out rather than executed, so the body is
 * the payload being written instead of a set of filesystem operands.
 *
 * An allow-list here, unlike `OUTPUT_ONLY_SHELL_COMMANDS`, because the failure
 * directions are reversed. There the missing entry is a command that opens a
 * path, so an allow-list would miss escapes; here the missing entry only means a
 * heredoc body stays scanned, which fails closed. `sh <<'EOF'` and
 * `python <<'EOF'` are absent on purpose: their body is a program, and a
 * traversal in it breaks a public clone exactly like one written inline.
 */
const HEREDOC_DATA_COMMANDS = new RegExp(`${COMMAND_WORD_PREFIX}(?:cat|echo|printf|tee)\\b`);

/** The heredoc operator, kept apart from `<<<`, which is a here-string. */
const HEREDOC_OPERATOR = /(?<!<)<<-?(?!<)/g;

/** The delimiter word that closes a heredoc, in each of its quoting forms. */
const HEREDOC_DELIMITER = /^<<(-?)\s*(?:'([^']*)'|"([^"]*)"|((?:\\.|[A-Za-z0-9_])+))/;

/**
 * Byte ranges of heredoc bodies whose text is data.
 *
 * A shell fixture that generates its expected output with
 * `cat > expected.txt <<'EOF'` puts that output in the body, and a
 * traversal-shaped line there is the data being compared, not a path the script
 * opens. Without this the required job failed a fixture that never touches
 * anything outside the repository.
 *
 * Bodies end at their delimiter rather than at the next blank line, because that
 * is what the shell itself does and a body may hold anything, including further
 * `<<` text. Several heredocs may open on one line, and each body follows the
 * previous one's terminator, so they are queued in order.
 */
function shellDataHeredocRanges(contents) {
  const ranges = [];
  const queue = [];
  let active = null;
  let offset = 0;

  for (const raw of contents.split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (active) {
      const terminator = active.strip ? line.replace(/^\t+/, '') : line;
      if (terminator === active.delimiter) {
        // An unquoted delimiter leaves expansion on, so a substitution in the
        // body is a command the shell really runs: `<<EOF` holding
        // `$(cat '../../labs/x')` reads the private sibling on the way to
        // building the payload. A quoted delimiter suppresses all of it.
        //
        // Whether that applies is asked of the candidate, not the body. An
        // unrelated `$(date)` on one line does not make the literal text on the
        // next line executable, and cancelling the whole range for it rejected a
        // fixture whose payload only reaches `expected.txt`.
        if (active.isData) ranges.push({ start: active.bodyStart, end: lineStart, expands: active.expands });
        active = queue.shift() ?? null;
        if (active) active.bodyStart = offset;
      }
      continue;
    }

    // Quoted content is blanked first so `echo '<<EOF'` does not open one. The
    // blanking preserves length, so an index into it still indexes the raw line,
    // which is where the delimiter has to be read from: quoting the delimiter is
    // the common form, and blanking removes it.
    for (const operator of withoutShellQuotes(line).matchAll(HEREDOC_OPERATOR)) {
      const delimiter = HEREDOC_DELIMITER.exec(line.slice(operator.index));
      if (!delimiter) continue;
      const segment = shellCommandSegment(line, operator.index);
      // The body reaches the command's stdin, so routing that hands stdin to
      // something else — `cat <<'EOF' | sh` — takes the exemption away. The
      // operator is blanked before that test, since its own `<` would otherwise
      // read as the input redirection it is not.
      const routing = withoutShellQuotes(segment.text).replace(HEREDOC_OPERATOR, (match) => ' '.repeat(match.length));
      queue.push({
        delimiter: delimiter[2] ?? delimiter[3] ?? delimiter[4].replace(/\\(.)/g, '$1'),
        strip: delimiter[1] === '-',
        // Quoting the delimiter, in any of its forms, turns expansion off for
        // the whole body. `<<'EOF'`, `<<"EOF"` and `<<\EOF` all do it.
        expands: delimiter[4] !== undefined && !delimiter[4].includes('\\'),
        isData: HEREDOC_DATA_COMMANDS.test(segment.text) && !SHELL_PATH_ROUTING.test(routing),
      });
    }

    active = queue.shift() ?? null;
    if (active) active.bodyStart = offset;
  }

  return ranges;
}

function isInDataHeredoc(ranges, offset, contents) {
  const range = ranges.find((entry) => offset >= entry.start && offset < entry.end);
  if (range === undefined) return false;
  if (!range.expands) return true;
  // Inside an expanding body, only a candidate that is itself part of a
  // substitution is executable; the rest is still the payload being written.
  return !isInsideShellSubstitution(contents.slice(range.start, range.end), offset - range.start);
}

/**
 * A shell segment with literal quoted content blanked to spaces.
 *
 * Single quotes suppress all shell evaluation. Double quotes still evaluate
 * command substitutions, so active `$(` and backticks stay visible while
 * escaped forms are blanked with the surrounding literal content. The result
 * contains only syntax that can route the printed value back into a command.
 */
function withoutShellQuotes(segment) {
  let out = '';
  let quote = null;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (quote) {
      if (char === '\\' && quote === '"' && i + 1 < segment.length) {
        out += '  ';
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        out += char;
        continue;
      }
      if (quote === '"' && char === '$' && segment[i + 1] === '(') {
        out += '$(';
        i += 1;
        continue;
      }
      if (quote === '"' && char === '`') {
        out += char;
        continue;
      }
      out += ' ';
      continue;
    }
    if (char === '\\' && i + 1 < segment.length) {
      // An escaped metacharacter is literal, so it is not routing either.
      out += '  ';
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    out += char;
  }
  return out;
}

/**
 * PHP's include statements, which take a path with no parentheses of their own.
 *
 * They were left out of the PHP callee set on the reasoning that they consult
 * `include_path` first, so the path might resolve elsewhere. The manual is
 * explicit that this is wrong for the shape that matters here: a path "relative
 * to the current directory (starting with `.` or `..`)" makes "the `include_path`
 * ignored altogether". So a `require '../../../../labs/private.php'` in a lane
 * launched from the Laravel root really does reach the private parent, and
 * resolving it from the file's own directory reported it clean.
 *
 * Only the traversal-prefixed form is anchored, which is exactly the form the
 * manual says bypasses `include_path`. A bare `require 'bootstrap/app.php'` does
 * consult that path first and is left alone.
 */
const PHP_INCLUDE_STATEMENT = /(?:^|[\s;{}(])(?:include|include_once|require|require_once)\s*\(?\s*$/;

function isPhpIncludeTarget(contents, offset, candidate) {
  if (!/^\.{1,2}[\\/]/.test(candidate)) return false;
  const lineStart = contents.lastIndexOf('\n', offset) + 1;
  // Everything on this line before the literal's opening quote.
  return PHP_INCLUDE_STATEMENT.test(contents.slice(lineStart, offset).replace(/['"`]\s*$/, ''));
}

function resolveCandidate(fromFile, rawCandidate, cwdRelative) {
  // An absolute literal ignores every base, so it escapes unless it happens to
  // sit inside this checkout — which a machine path never does.
  if (/^[A-Za-z]:[\\/]/.test(rawCandidate)) {
    // A Windows drive path is absolute on Windows, but posix `resolve` treats
    // `C:/Users/...` as a relative segment and places it under REPO_ROOT, which
    // reported it clean. No drive path can be inside this checkout.
    return { resolved: rawCandidate, escapes: true };
  }
  if (rawCandidate.startsWith('/')) {
    const resolved = resolve(rawCandidate.replace(/\\+/g, '/'));
    const rel = relative(REPO_ROOT, resolved);
    return { resolved, escapes: rel.startsWith('..') || isAbsolute(rel) };
  }
  // A Windows-native literal such as `..\\..\\labs\\x` escapes on Windows but
  // means nothing to posix `resolve`, so the Linux guard would read it as one
  // opaque segment and report it clean. Normalized to forward slashes first.
  const candidate = rawCandidate.replace(/\\+/g, '/');
  const fileBase = resolve(REPO_ROOT, dirname(fromFile));
  if (!cwdRelative) {
    const resolved = resolve(fileBase, candidate);
    const rel = relative(REPO_ROOT, resolved);
    return { resolved, escapes: rel.startsWith('..') || isAbsolute(rel) };
  }

  // `process.cwd()` is decided by whoever launches the test, so the base is not
  // in the file. It is in the workflow: CI runs vitest from the repository root
  // unless a lane sets `working-directory`. So the root is the default base, and
  // a lane that runs from elsewhere records it in RUNNER_WORKING_DIRECTORIES.
  //
  // An earlier version accepted the candidate if *any* plausible base kept it
  // inside. That is too weak: from `packages/superdoc/src`, a genuine
  // `resolve(process.cwd(), '../labs/private.docx')` escape was reported clean
  // because a hypothetical file-relative reading stayed inside.
  // Longest matching prefix, not the first written: the entries nest, so a
  // first-match lookup would depend on the order of the list above.
  const configured = RUNNER_WORKING_DIRECTORIES.filter(([prefix]) => fromFile.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  //
  // An entry may name more than one base, because a project can be launched more
  // than one way. Escaping under any of them is an escape: the file has to work
  // from every cwd that really runs it, and reporting only the first would let
  // the other invocation reach outside unnoticed. That is the same direction as
  // the rule above, not its opposite — neither accepts a path because some base
  // happens to keep it inside.
  const bases = configured ? [configured[1]].flat() : ['.'];
  const attempts = bases.map((entry) => {
    const resolved = resolve(resolve(REPO_ROOT, entry), candidate);
    const rel = relative(REPO_ROOT, resolved);
    return { resolved, escapes: rel.startsWith('..') || isAbsolute(rel) };
  });
  return attempts.find((attempt) => attempt.escapes) ?? attempts[0];
}

const GIT_SYMLINK_MODE = '120000 ';

function trackedSymlinkPath(lsFilesStageEntry) {
  const tab = lsFilesStageEntry.indexOf('\t');
  if (tab === -1 || !lsFilesStageEntry.startsWith(GIT_SYMLINK_MODE)) return undefined;
  return lsFilesStageEntry.slice(tab + 1);
}

function readLinkTargetIfStillALink(file) {
  try {
    return readlinkSync(resolve(REPO_ROOT, file));
  } catch {
    return undefined;
  }
}

function listTrackedSymlinks() {
  return execFileSync('git', ['ls-files', '-sz'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const file = trackedSymlinkPath(entry);
      if (file === undefined || !isInPublicCloneSurface(file)) return [];
      const target = readLinkTargetIfStillALink(file);
      return target === undefined ? [] : [{ file, target }];
    });
}

function mightBeExecutableScript(file) {
  return extensionAfterNonLeadingDot(basenameOf(file)) === '' && isInPublicCloneSurface(file);
}

const findings = [];

for (const { file, target } of listTrackedSymlinks()) {
  const { resolved, escapes } = resolveCandidate(file, target, false);
  if (!escapes) continue;
  if (EXEMPT_PATHS.get(file)?.allow.test(target)) continue;
  findings.push({
    file,
    line: 1,
    candidate: target,
    existsLocally: existsSync(resolved),
    text: `symlink -> ${target}`,
  });
}

function readTrackedFileIfStillPresent(file) {
  try {
    return readFileSync(resolve(REPO_ROOT, file), 'utf8');
  } catch {
    return undefined;
  }
}

function matchedGroupAt(match) {
  return { candidate: match[1], offset: match.index + match[0].indexOf(match[1]) };
}

function pathCandidatesIn(contents) {
  return [
    ...[...contents.matchAll(RELATIVE_PATH_PATTERN)].map(matchedGroupAt),
    ...[...contents.matchAll(ABSOLUTE_PATH_PATTERN)].map((match) => ({
      ...matchedGroupAt(match),
      machineRooted: match[1].startsWith('/'),
    })),
    ...[...contents.matchAll(COMPOSED_TRAVERSAL_PATTERN)].map((match) => ({
      ...matchedGroupAt(match),
      candidate: joinComposedTraversal(match[1]),
      composed: true,
    })),
  ];
}

function lineStartOffsets(contents) {
  const lineStarts = [0];
  for (let i = 0; i < contents.length; i += 1) {
    if (contents[i] === '\n') lineStarts.push(i + 1);
  }
  return lineStarts;
}

function lineNumberAt(lineStarts, offset) {
  const line = lineStarts.findIndex((start) => start > offset);
  return line === -1 ? lineStarts.length : line;
}

function findingSnippet(contents, lineStarts, line, offset, candidate) {
  return contents
    .slice(lineStarts[line - 1], offset + candidate.length + 40)
    .split('\n')[0]
    .trim()
    .slice(0, 110);
}

function isComposedTraversalNobodyJoins({ composed }, cwdRelative, contents, context) {
  return Boolean(composed) && !cwdRelative && !composesPath(contents, context);
}

function isShellPayloadData(contents, offset, dataHeredocs) {
  return (
    isPrintedShellArgument(contents, offset) ||
    isHereStringOperand(contents, offset) ||
    isInDataHeredoc(dataHeredocs, offset, contents)
  );
}

function findingsInFile(file, contents) {
  const exemption = EXEMPT_PATHS.get(file);
  const candidates = pathCandidatesIn(contents);
  const language = languageExtensionFor(file, contents);
  const contexts = describeCallContexts(
    withoutEscapedSlashRegexes(contents),
    candidates.map((entry) => entry.offset),
    { grammar: commentGrammarFor(file, contents), language },
  );
  const lineStarts = lineStartOffsets(contents);
  const languageCallees = LANGUAGE_CWD_ANCHORED_CALLEES.get(language);
  const shellCwd = isCwdRelativeLanguage(file, contents);
  const dataHeredocs = shellCwd ? shellDataHeredocRanges(contents) : [];
  const fileFindings = [];

  for (const entry of candidates) {
    const { candidate, offset, machineRooted } = entry;
    const context = contexts.get(offset);
    if (context?.inComment) continue;
    if (discardsLeadingSegments(contents, context, offset, candidate)) continue;
    const { cwdRelative, prefix, isData } = isCwdAnchored(
      contents,
      offset,
      candidate,
      context,
      language,
      languageCallees,
    );
    if (isData) continue;
    if (machineRooted && isUrlRatherThanPath(contents, context, offset, language)) continue;
    if (isComposedTraversalNobodyJoins(entry, cwdRelative, contents, context)) continue;
    if (shellCwd && !cwdRelative && isShellPayloadData(contents, offset, dataHeredocs)) continue;
    const phpInclude = language === '.php' && isPhpIncludeTarget(contents, offset, candidate);
    const { resolved, escapes } = resolveCandidate(
      file,
      prefix ? `${prefix}/${candidate}` : candidate,
      cwdRelative || shellCwd || phpInclude,
    );
    if (!escapes) continue;
    if (exemption?.allow.test(candidate)) continue;
    const line = lineNumberAt(lineStarts, offset);
    fileFindings.push({
      file,
      line,
      candidate,
      existsLocally: existsSync(resolved),
      text: findingSnippet(contents, lineStarts, line, offset, candidate),
    });
  }
  return fileFindings;
}

for (const file of listTrackedFiles()) {
  if (!isScanned(file) && !mightBeExecutableScript(file)) continue;
  const contents = readTrackedFileIfStillPresent(file);
  if (contents === undefined || !isScanned(file, contents)) continue;
  for (const finding of findingsInFile(file, contents)) findings.push(finding);
}

if (findings.length === 0) {
  console.log('[check:public-boundary] OK — no test, fixture, or example reaches outside the repository root.');
  process.exit(0);
}

console.error('[check:public-boundary] FAIL — these reference paths outside the repository root:');
console.error('');
const byFile = new Map();
for (const finding of findings) {
  if (!byFile.has(finding.file)) byFile.set(finding.file, []);
  byFile.get(finding.file).push(finding);
}
for (const [file, fileFindings] of [...byFile.entries()].sort()) {
  console.error(`  ${file}`);
  for (const finding of fileFindings) {
    console.error(
      `    :${finding.line}  ${finding.candidate}  (${finding.existsLocally ? 'private sibling' : 'does not exist'})`,
    );
    console.error(`             ${finding.text}`);
  }
}
console.error('');
console.error(`Total: ${findings.length} reference(s) across ${byFile.size} file(s).`);
console.error('A public clone has no parent directory. Add a public fixture and point at that.');
console.error('An escape that is genuinely safe belongs in EXEMPT_PATHS with its reason.');
process.exit(1);
