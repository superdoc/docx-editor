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

// The namespace as well as the two helpers this file calls: `CWD_ANCHORED_CALLEES`
// reads the module's own export names rather than repeating them by hand.
import * as nodeFs from 'node:fs';
const { existsSync, readFileSync, readlinkSync } = nodeFs;
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Surfaces that must work from a bare public clone. A path here cannot depend
 * on anything above the repository root.
 *
 * Runtime modules and build config are intentionally absent: see the scope note
 * above. Widening this list is a policy change, not a fix for a failing check.
 */
const SCANNED_PATTERNS = [
  /(?:^|\/)__tests__\//,
  /(?:^|\/)tests?\//,
  /(?:^|\/)fixtures?\//,
  // Any extension, not only the JavaScript family. The directory patterns above
  // never cared what language a test was written in, and these did, so a
  // colocated `client.test.py` or `client.test.sh` was not read at all. What is
  // readable is already decided by `SCANNED_EXTENSIONS` in `isScanned`, so this
  // cannot pull in a `.docx` fixture that happens to be named `.test.docx`.
  /\.(?:test|spec)\.[A-Za-z0-9]+$/,
  /(?:^|\/)examples\//,
];

/**
 * Text formats where a relative path is meaningful. Binaries cannot carry one.
 *
 * Not only the JavaScript family. The scanned surfaces also hold Python and shell
 * tests, PHP and HTML fixtures, and `.cts`/`.mts` consumer tests, and every one of
 * those was skipped before its contents were read, so a private dependency in a
 * `.py` fixture passed the gate. A path literal in any of them breaks a public
 * clone the same way.
 *
 * `.svg` is here for the same reason: it is XML, not a binary, and the scanned
 * surfaces track 14 of them. An `<image href="../../labs/private.png">` in a demo
 * asset is a private dependency a public clone cannot satisfy, and skipping the
 * format by extension meant the required job never opened one.
 *
 * `.code-workspace` is JSON, and its `folders[].path` entries are paths by
 * definition: the one tracked in the word-addin demo points at the directories
 * the editor opens, so an escaping value there leaves the demo unusable from a
 * public clone.
 */
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

/**
 * Comment syntax per scanned extension, so prose about a path is not read as a
 * dependency on one.
 *
 * Applying the JavaScript grammar everywhere was wrong in both directions. A plain
 * `https://` in Markdown swallowed the rest of its line, and a `#` comment in a
 * Python, shell, or YAML test failed the gate for mentioning an old path. Each
 * language gets its own, and a format with no comment syntax gets none.
 *
 * A format gets every comment form it really has, not only its most common one.
 * PHP treats `#` as a line comment as well as `//`, and a `.vue` file is two
 * languages at once, so its template needs `<!-- -->` alongside the script
 * block's `//`. Listing one form per format failed the gate for a valid comment
 * written in the other. PHP 8 attributes are the stated cost of `#`: `#[Foo]`
 * reads as a comment, which can only hide a path, never invent one.
 *
 * `lines` open a comment that ends at the newline; `blocks` are `[open, close]`
 * pairs. Markdown and JSON are absent on purpose: neither has comments, and
 * Markdown's `<!-- -->` is rare enough in a path-bearing fixture that treating it
 * as prose would be the riskier default.
 */
const JS_COMMENTS = { lines: ['//'], blocks: [['/*', '*/']] };
const HASH_COMMENTS = { lines: ['#'] };
/**
 * `#` opens a comment only where a word does not already run into it.
 *
 * True of shell and YAML, and of neither Python nor PHP nor a Makefile, where
 * `x=1# note` really is a comment. Applying the rule everywhere made `x=1#
 * '../../labs/private.docx'` read as code and failed the unconditional job on a
 * line that carries only comment text. It exists for shell's `${#value}`
 * parameter-length expansion, whose `#` blanked the rest of its line and hid an
 * escaping argument after it, so it is spelled out per grammar rather than
 * pressed onto every `#` format.
 */
const BOUNDED_HASH_COMMENTS = { lines: ['#'], hashNeedsBoundary: true };
const SGML_COMMENTS = { blocks: [['<!--', '-->']] };

const COMMENT_GRAMMARS = new Map([
  ['.cjs', JS_COMMENTS],
  ['.cts', JS_COMMENTS],
  ['.css', { blocks: [['/*', '*/']] }],
  ['.js', JS_COMMENTS],
  ['.jsx', JS_COMMENTS],
  ['.mjs', JS_COMMENTS],
  ['.mts', JS_COMMENTS],
  ['.ts', JS_COMMENTS],
  ['.tsx', JS_COMMENTS],
  // Script block plus template: JavaScript comments and SGML comments both apply.
  [
    '.vue',
    {
      lines: ['//'],
      blocks: [
        ['/*', '*/'],
        ['<!--', '-->'],
      ],
    },
  ],
  ['.php', { lines: ['//', '#'], blocks: [['/*', '*/']] }],
  ['.py', HASH_COMMENTS],
  // Shell and YAML both require a boundary before `#`; Python and PHP do not.
  ['.sh', BOUNDED_HASH_COMMENTS],
  ['.yaml', BOUNDED_HASH_COMMENTS],
  ['.yml', BOUNDED_HASH_COMMENTS],
  ['.html', SGML_COMMENTS],
  ['.svg', SGML_COMMENTS],
  ['.xml', SGML_COMMENTS],
]);

/**
 * The comment grammar for a file, by extension or by basename.
 *
 * The extensionless build inputs are all `#`-commented, so a `# see
 * ../../labs/old.mk` in one is prose about a path rather than a dependency on
 * it, the same way it is in a shell or YAML test.
 *
 * A Makefile carries `hashNeedsBoundaryInRecipes` because it is two languages:
 * its own lines take `#` unconditionally, while a recipe line — one starting with
 * a TAB — is handed to the shell, where `$${#value}` is the parameter-length
 * expansion rather than a comment. Treating a recipe's `#` as a Make comment
 * blanked the rest of that line and hid an escaping `cat` argument after it.
 */
const BASENAME_COMMENT_GRAMMARS = new Map([
  ['Dockerfile', HASH_COMMENTS],
  ['Containerfile', HASH_COMMENTS],
  ['Makefile', { lines: ['#'], hashNeedsBoundaryInRecipes: true }],
  ['Justfile', { lines: ['#'], hashNeedsBoundaryInRecipes: true }],
  ['Procfile', HASH_COMMENTS],
]);

/**
 * Calls whose string argument is a URL route rather than a filesystem path.
 *
 * A machine-shaped literal is otherwise always a private dependency, which is
 * why `/home/alice/x.docx` is reported wherever it sits. The exception is a
 * server route: `app.get('/home/alice/profile', handler)` names a URL, and the
 * scanned surfaces can hold example servers, so the unconditional job would
 * fail on one even though nothing touches the filesystem.
 *
 * Narrow on purpose. Requiring a path-taking context instead would have been the
 * bigger change and the wrong one: it drops a hardcoded `/home/...` assigned to
 * a variable, which is the shape this guard most wants to catch.
 */
const ROUTE_REGISTERING_CALLEES = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use']);

/**
 * Receivers whose `.get(...)` registers a route rather than reading a key.
 *
 * The callee name alone is far too weak: of the route-shaped calls in the scanned
 * surfaces, most are Maps and caches — `rooms.get`, `metadata.get`,
 * `tokenCache.get`, `pending.get`. Exempting every one of those would wave a
 * machine path through wherever it was handed to a lookup.
 */
const ROUTER_RECEIVERS = new Set(['app', 'router', 'server', 'api', 'fastify', 'express']);

/**
 * Whether a candidate sits inside a `file:` URL.
 *
 * `file:///home/alice/x.docx` is a machine path whatever receives it.
 */
function isFileUrl(text, offset) {
  return text.slice(Math.max(0, offset - 8), offset).endsWith('file://');
}

/**
 * Callees whose first argument is a URL the browser resolves against the origin.
 *
 * `fetch('/home/alice/profile')` requests a route and opens no file on the host,
 * but a leading `/home/` is otherwise a machine path wherever it sits, so the
 * required job rejected a demo doing exactly that. This is the call-shaped
 * counterpart to the markup attributes and CSS `url()` above.
 *
 * Only the machine-rooted question, like those: a traversal handed to `fetch`
 * is still resolved and still reported, and `isFileUrl` still wins, because
 * `fetch('file:///home/alice/x')` names a path in any context.
 */
const URL_ARGUMENT_CALLEES = new Set(['fetch']);

/** Whether a candidate is the first argument of a call that takes a URL. */
function isUrlArgument(text, context, offset) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  const { name, receiver } = calleeBefore(text, paren);
  // A bare `fetch(...)` or `globalThis.fetch(...)`, not some object's own
  // `.fetch(...)`, which need not be the browser's.
  if (!URL_ARGUMENT_CALLEES.has(name)) return false;
  if (receiver !== '' && !['globalThis', 'window', 'self'].includes(receiver.split('.').pop())) return false;
  return (
    text
      .slice(paren + 1, offset)
      .replace(/['"`]\s*$/, '')
      .trim() === ''
  );
}

/**
 * Whether a candidate is the path of a `new URL(...)` whose base is an http(s)
 * origin.
 *
 * `new URL('/home/alice/profile', 'https://example.com')` names a route on that
 * origin and touches no file, but a leading `/home/` is otherwise a machine
 * path, so the required job rejected a demo doing exactly that.
 *
 * The base has to be a literal with an http or https scheme. `file:` is not
 * matched, so `new URL('/home/alice/x', 'file:///tmp/')` is still a path, and a
 * base this cannot read leaves the candidate exactly where it was.
 */
function isOriginRelativeUrl(text, context, offset) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  if (calleeBefore(text, paren).name !== 'URL') return false;
  if (
    text
      .slice(paren + 1, offset)
      .replace(/['"`]\s*$/, '')
      .trim() !== ''
  ) {
    return false;
  }
  return /^(['"`])https?:\/\//i.test(currentArgument(completeArgumentList(text, paren)).trim());
}

/** Whether a candidate is the first argument of a route registration. */
function isRouteLiteral(text, context, offset) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  const { name, receiver } = calleeBefore(text, paren);
  // A bare `get(...)` is not a route, and neither is `cache.get(...)`: the
  // receiver has to name a router.
  if (!ROUTER_RECEIVERS.has(receiver.split('.').pop()) || !ROUTE_REGISTERING_CALLEES.has(name)) return false;
  // And only the first argument is the route. Without this the exemption covered
  // every argument of any `.get(...)`, so a machine path handed to a second
  // parameter, or to a non-routing `cache.get`, was waved through. Only the
  // opening quote may sit between the candidate and the `(`.
  return (
    text
      .slice(paren + 1, offset)
      .replace(/['"`]\s*$/, '')
      .trim() === ''
  );
}

/**
 * Markup attributes whose value is a URL rather than a filesystem path.
 *
 * A machine-rooted literal is otherwise a private dependency wherever it sits,
 * and `isRouteLiteral` is the one exception — but it reads the enclosing call,
 * and markup has none. So `<a href="/home/alice/profile">` in a tracked demo was
 * rejected even though the browser resolves it against the origin and touches no
 * file. That is a false positive on a required job.
 *
 * Only the machine-rooted question is answered here. A traversal in an `href` is
 * still resolved and still reported, because `../../../../labs/x` breaks a public
 * clone whether a browser or a bundler follows it. And `isFileUrl` still wins:
 * `href="file:///home/alice/x"` names a path in any context.
 */
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'srcset', 'poster', 'data', 'formaction', 'cite', 'ping']);

/** Whether a candidate is the value of a markup attribute that carries a URL. */
function isUrlAttributeValue(text, offset) {
  if (!isInsideTag(text, offset)) return false;
  const tagStart = text.lastIndexOf('<', offset);
  const attributePrefix = text.slice(tagStart, offset);
  const quotedMatch = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"[^"]*|'[^']*)$/.exec(attributePrefix);
  if (quotedMatch && URL_ATTRIBUTES.has(quotedMatch[1].toLowerCase())) return true;
  // `<a href="` — the attribute name, `=`, and the opening quote, which the
  // candidate's own offset sits just past.
  const before = text.slice(Math.max(0, offset - 32), offset);
  const match = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*['"]?\s*$/.exec(before);
  if (!match || !URL_ATTRIBUTES.has(match[1].toLowerCase())) return false;
  // And it has to be a real attribute. The name-and-equals shape alone is also
  // `const src = '/home/alice/x'`, `SRC=/home/alice/x` in an env template, and
  // `src=/home/alice/x` in a shell script — so without this the exemption waved
  // a machine path through in every one of those, which is the direction that
  // hides a private dependency rather than merely annoying CI.
  return true;
}

/**
 * Markup that can embed a stylesheet, as opposed to being one.
 *
 * These formats also embed JavaScript, so `url(` in one of them is only a
 * stylesheet reference where a stylesheet really is. A `<script>` block calling
 * a function named `url` is ordinary code, and exempting it on the token alone
 * would let `url('/home/alice/private.png')` through a scanned `.vue` demo —
 * the fail-open direction, which is the one that hides a private dependency.
 */
const STYLESHEET_HOST_LANGUAGES = new Set(['.html', '.svg', '.vue']);

/**
 * Whether a candidate is the value of a CSS `url()`, which the browser resolves
 * against the origin exactly like the markup attributes above.
 *
 * `background-image: url('/home/assets/hero.png')` was rejected while
 * `<img src="/home/assets/hero.png">` was not, because only the attribute form
 * had an exemption. Both name a route on the site and touch no file.
 *
 * A `.css` file is a stylesheet throughout. In markup the offset has to sit in
 * a real stylesheet region: inside a `<style>` element, or inside a `style`
 * attribute value.
 *
 * As with the attributes, this answers only the machine-rooted question. A
 * traversal inside `url()` is still resolved and still reported: `url(../../labs/x)`
 * breaks a public clone whichever syntax carries it.
 */
function isCssUrlValue(text, offset, language) {
  const isStylesheet = language === '.css';
  if (!isStylesheet && !STYLESHEET_HOST_LANGUAGES.has(language)) return false;
  if (!/\burl\(\s*['"]?\s*$/i.test(text.slice(Math.max(0, offset - 16), offset))) return false;
  return isStylesheet || isInStyleElement(text, offset) || isStyleAttributeValue(text, offset);
}

/** Whether an offset sits inside an open `<style>` element. */
function isInStyleElement(text, offset) {
  const open = text.lastIndexOf('<style', offset);
  // `<styles>` is a different element, so the name has to end where `style` does.
  if (open === -1 || !/^<style[\s/>]/.test(text.slice(open, open + 7))) return false;
  const tagEnd = text.indexOf('>', open);
  if (tagEnd === -1 || tagEnd >= offset) return false;
  const close = text.indexOf('</style', tagEnd);
  return close === -1 || close > offset;
}

/** Whether an offset sits inside a `style` attribute value. */
function isStyleAttributeValue(text, offset) {
  if (!isInsideTag(text, offset)) return false;
  const attributePrefix = text.slice(text.lastIndexOf('<', offset), offset);
  const match = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"[^"]*|'[^']*)$/.exec(attributePrefix);
  return match?.[1].toLowerCase() === 'style';
}

/**
 * Whether an offset sits inside an open `<...>` tag.
 *
 * True when the nearest `<` before it comes after the nearest `>`, so the tag it
 * opened has not been closed yet. A tag may span lines, which is why this looks
 * back through the text rather than at the current line.
 *
 * The `<` must be followed by a tag name. Otherwise `if (a < b) {}` earlier in a
 * JavaScript file, or a TypeScript generic, would put everything after it
 * "inside a tag" and restore the same hole one step further out.
 */
function isInsideTag(text, offset) {
  const open = text.lastIndexOf('<', offset);
  if (open === -1 || open < text.lastIndexOf('>', offset)) return false;
  return /^<\/?[A-Za-z][A-Za-z0-9:._-]*[\s/>]/.test(text.slice(open, open + 40));
}

/**
 * Interpreters named in a shebang, mapped to the extension whose grammar they
 * share. An extensionless entrypoint gets its comment syntax from the program
 * that runs it: `#!/usr/bin/env php` in `artisan` means PHP comments, not none.
 */
const SHEBANG_GRAMMARS = [
  [/\b(?:php)\b/, '.php'],
  [/\b(?:ba|z|k|da)?sh\b/, '.sh'],
  [/\bpython[\d.]*\b/, '.py'],
  [/\b(?:node|bun|deno)\b/, '.js'],
];

/**
 * The extension whose language this file is written in, taking a shebang into
 * account when there is no extension to read.
 *
 * The same question `commentGrammarFor` answers, but the answer is needed as a
 * language rather than as a grammar: shell, Python and YAML share one grammar
 * object, so grammar identity cannot tell them apart.
 */
function languageExtensionFor(file, contents) {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  if (basename.lastIndexOf('.') > 0) return basename.slice(basename.lastIndexOf('.'));
  if (!contents?.startsWith('#!')) return '';
  const shebang = contents.slice(0, contents.indexOf('\n') + 1 || contents.length);
  return (SHEBANG_GRAMMARS.find(([pattern]) => pattern.test(shebang)) ?? [])[1] ?? '';
}

/**
 * Environment templates, matched on the whole name rather than an extension.
 *
 * `.env.example` reads as an extension of `.example`, so the allowlist skipped
 * it, and a leading-dot `.env` has no extension at all. Both carry paths by
 * design: an example server's `.env.example` can set
 * `GOOGLE_APPLICATION_CREDENTIALS`, and pointing that at a private sibling would
 * leave the exported demo depending on a file a public clone does not have.
 *
 * The whole `.env*` family, since the suffix is a local convention —
 * `.env.example`, `.env.local`, `.env.test` and a bare `.env` are all the same
 * format. Shell-style, so the `#` comment grammar applies.
 */
const ENVIRONMENT_TEMPLATE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/;

function commentGrammarFor(file, contents) {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  // Before the extension test: `.env.example` would otherwise read as `.example`,
  // and a bare `.env` has no extension at all. The format is shell-style, so a
  // `# see ../../labs/old.json` in one is prose about a path.
  if (ENVIRONMENT_TEMPLATE.test(basename)) return BOUNDED_HASH_COMMENTS;
  if (dot > 0) return COMMENT_GRAMMARS.get(basename.slice(dot));
  const named = BASENAME_COMMENT_GRAMMARS.get(basename);
  if (named) return named;
  if (!contents?.startsWith('#!')) return undefined;
  const shebang = contents.slice(0, contents.indexOf('\n') + 1 || contents.length);
  const match = SHEBANG_GRAMMARS.find(([pattern]) => pattern.test(shebang));
  return match ? COMMENT_GRAMMARS.get(match[1]) : undefined;
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
    'apps/cli/src/__tests__/lib/collaboration/v2-error-mapping.test.ts',
    {
      reason: 'asserts the private engine diagnostics contract; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
    },
  ],
  [
    'apps/cli/src/__tests__/runtime-v2-open-lifecycle.test.ts',
    {
      reason: 'exercises the private engine runtime lifecycle; skipped when absent',
      allow: /(?:^|\/)v2\/headless\/dist\//,
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
]);

/**
 * Path-shaped strings in quotes, or after an `=`/`:`/`(`. Deliberately narrow so
 * prose naming a directory does not qualify.
 *
 * The leading `..` is required: this guard is about escaping upward, and an
 * in-repo relative path is not its business.
 */
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

/**
 * Calls that join their separate arguments into a single path.
 *
 * Separate `'..'` arguments are one traversal only when something composes them.
 * `expect(parts).toEqual(['..', '..', 'literal'])` is expected data, and reading
 * it as `../../literal` failed the unconditional boundary job on an array that
 * never touches the filesystem.
 *
 * `relative` is deliberately absent even though it is a path API: it compares two
 * endpoints rather than joining them. `path.relative('..', '..')` returns `''`,
 * but reading it as a composer turned those two literals into `../..` and failed
 * the gate on a shallow file that never escapes.
 */
const PATH_COMPOSING_CALLEES = new Set(['join', 'normalize', 'resolve']);

/** The joined path a composed traversal is equivalent to. */
function joinComposedTraversal(fragment) {
  return [...fragment.matchAll(/['"`]([^'"`]*)['"`]/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .join('/');
}

/**
 * Callables on `node:fs` whose first argument is a path, plus the `node:path`
 * composers. `resolve('../x')` and `readFileSync('../x')` are decided by whoever
 * launched the process, not by the file the call sits in.
 *
 * The filesystem half is read from the module rather than typed out. A
 * hand-kept list is the wrong shape for this: it reached 30 names with
 * `unlinkSync` missing, so a root-launched `unlinkSync('../labs/private.docx')`
 * was resolved from the source directory and reported clean. Reading the module
 * cannot fall behind Node, and a name added in a later release is covered the
 * day it lands.
 *
 * Two kinds of export are excluded because they are not path-taking calls: an
 * API whose first argument is a file descriptor, and a class or other
 * non-function export, which the capitalized-name test drops.
 *
 * Only consulted when the candidate is the call's first argument. With an
 * explicit base in front of it, as in `resolve(__dirname, '../x')`, the base
 * wins and the path is directory-relative.
 */
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

const CWD_ANCHORED_CALLEES = new Set([
  ...Object.keys(nodeFs).filter(
    (name) => typeof nodeFs[name] === 'function' && !/^[A-Z]/.test(name) && !FD_FIRST_ARGUMENT.has(name),
  ),
  // `node:path` composers. `join` and `resolve` build a path from a bare
  // relative argument the same way, and `resolve` is the form most escapes take.
  'join',
  'resolve',
  // Python, because the scanned surfaces hold Python tests and examples and a
  // relative path there resolves from the process working directory too.
  // `Path('../labs/x')` was read as file-relative, which from a nested test
  // stayed inside and reported a real escape clean. `open` is Node's as well,
  // and means the same thing in both.
  'Path',
  'open',
]);

/**
 * Filesystem callees that belong to one language, keyed by the extensions that
 * language is written in.
 *
 * Kept out of the set above because these names are generic. `remove`, `move`,
 * `copy` and `walk` are ordinary method names in JavaScript, and anchoring them
 * everywhere failed the required job on a `cache.remove('../labs/x')` that never
 * touches the filesystem. Scoping them by extension keeps the escape they were
 * added for — `os.remove(...)` in a Python test resolved from the source
 * directory rather than the cwd — without inventing one in another language.
 *
 * A shebang-only entrypoint gets the same treatment through
 * `shebangExtensionFor`, so an extensionless `#!/usr/bin/env python3` script is
 * read as Python here too.
 */
const LANGUAGE_CWD_ANCHORED_CALLEES = new Map([
  [
    '.py',
    new Set([
      // The rest of Python's standard filesystem surface, which resolves from the
      // working directory the same way. Only `Path` and `open` were listed, so
      // `os.remove('../labs/private.docx')` and `shutil.copy(...)` were resolved
      // from the source directory and a real escape stayed inside.
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
      // `os.path.abspath` and `realpath` are not filesystem reads, but they do
      // resolve against the process working directory, which is the question this
      // set answers. Neither was listed and neither is a pass-through, so the
      // scanner stopped at the inner call and read the literal from the source
      // directory, while Python computes it from the cwd and the outer `open`
      // reaches outside. `expanduser` is here for the same reason: it produces an
      // absolute path from the environment rather than from the file.
      'abspath',
      'realpath',
      'expanduser',
    ]),
  ],
  [
    '.php',
    new Set([
      // PHP's filesystem surface, for the same reason. PHP resolves a relative
      // path from the process working directory, and `examples.yml` launches
      // the Laravel example from its own root, so a `file_get_contents(
      // '../../../../labs/private.docx')` in `routes/web.php` really does reach
      // the private parent while the guard resolved it from the deeper `routes/`
      // directory and reported clean.
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
      // Algorithm-first, so the path is the second argument. Their position is
      // in `LANGUAGE_PATH_ARGUMENT_POSITION`; without it the leading algorithm
      // name would be composed into the path as a directory segment.
      'hash_file',
      'hash_hmac_file',
      // The digest and stat family, which take the path first and open it the
      // same way. Listed as a family rather than one name at a time: they were
      // all missing together, and a set that covers `filesize` but not
      // `filemtime` reads as deliberate when it is not. `stat`, `lstat`,
      // `readlink` and `opendir` are absent here because they are already
      // anchored by the shared Node names.
      // The SPL file classes, whose constructor takes the path. Added as a
      // family for the same reason as the digest functions below: they were all
      // missing together, and a set that anchors `fopen` but not
      // `new SplFileObject` reads as a decision when it is an omission.
      'SplFileObject',
      'SplFileInfo',
      'DirectoryIterator',
      'RecursiveDirectoryIterator',
      'FilesystemIterator',
      'GlobIterator',
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
      'scandir',
      'glob',
      'unlink',
      'mkdir',
      'rmdir',
      'filesize',
      'realpath',
      'readfile',
      'file',
      'parse_ini_file',
      'copy',
      'rename',
      'touch',
    ]),
  ],
]);

function listTrackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

/**
 * Text formats with no extension to match on, keyed by basename.
 *
 * A build input is a runnable surface: an example's `Makefile` and
 * its `server/Dockerfile` are both tracked, and an `include ../../labs/x.mk` or
 * an escaping `COPY` source in either breaks a public clone the same way an
 * import does. The extension allowlist skipped them before their contents were
 * read, so the required job reported clean on a real escape.
 *
 * An extensionless file carrying a shebang is scanned too, without being named
 * here: `examples/getting-started/laravel/artisan` is a tracked PHP entrypoint,
 * and an escaping `require` in it was invisible while the same line in a `.php`
 * file was rejected. Reading the first two bytes decides that for any such
 * entrypoint rather than growing this list one name at a time.
 */
const SCANNED_BASENAMES = new Set(['Dockerfile', 'Makefile', 'Containerfile', 'Justfile', 'Procfile']);

function isScanned(file, contents) {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  // A leading dot is not an extension separator: `.nvmrc` has no extension.
  const extension = dot > 0 ? basename.slice(dot) : '';
  const named =
    SCANNED_EXTENSIONS.has(extension) || SCANNED_BASENAMES.has(basename) || ENVIRONMENT_TEMPLATE.test(basename);
  // `contents` is absent on the first pass, which decides what is worth reading.
  // A shebang is only consulted for a file with no extension at all, so this
  // never reopens the question for a `.docx` or a `.png`.
  const executable = extension === '' && contents !== undefined && contents.startsWith('#!');
  if (!named && !executable) return false;
  return SCANNED_PATTERNS.some((pattern) => pattern.test(file));
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

/**
 * APIs whose arguments are each a path in their own right, rather than a base
 * followed by segments to append.
 *
 * `copyFileSync('/tmp/a.docx', '../labs/b.docx')` resolves its destination at the
 * cwd regardless of the source, so an absolute first argument says nothing about
 * the second. Treating every earlier argument as a possible base let the
 * destination be checked from the source file's directory and pass.
 */
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
  // Python's two-path APIs, which behave the same way: `shutil.copy('source.docx',
  // '../labs/private.docx')` resolves its destination from the cwd regardless of
  // the source. Only the first argument was anchored, so the destination was
  // composed with `source.docx` and one level of the traversal was swallowed --
  // `open('../labs/x')` was reported while the same path as a copy destination
  // was not. `rename` is shared with Node; `replace` is Python's `os.replace`;
  // the remaining names are `shutil` APIs with no Node counterpart above.
  'copy',
  'copy2',
  'copyfile',
  'copytree',
  'move',
  'replace',
]);

const PYTHON_PATH_ARGUMENT_NAMES = new Set(['file', 'path', 'src', 'dst']);

/**
 * Filesystem APIs that take a path first and *data* second.
 *
 * Only the first argument is a path. `writeFileSync('snapshot.txt',
 * '../../labs/private.docx')` writes that traversal as file contents and opens
 * nothing but `snapshot.txt`, yet the cwd rule anchored the second argument too
 * and failed the required job on a generated fixture.
 *
 * Named rather than inferred. There is no way to tell a path parameter from a
 * data one by shape, and guessing the wrong way here hides a real escape, so the
 * list is the Node write APIs plus PHP's equivalent and nothing else.
 * `appendFile` and `file_put_contents` have the same shape; `copyFileSync` does
 * not, and stays above, because its second argument really is a path.
 */
const DATA_AFTER_PATH_CALLEES = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'file_put_contents',
]);

/**
 * The called name before an argument list's `(`, the receiver it was called on,
 * and where the whole qualified name begins.
 *
 * The receiver matters. Stripping it made `require.resolve('../x')` look like
 * `path.resolve`, and those anchor differently: `require.resolve` resolves from
 * the calling module, so an in-repository path was reported as an escape.
 *
 * `start` is where the expression begins, which is where an enclosing call's
 * argument list stops when this call is looked through.
 */
function calleeBefore(text, parenIndex) {
  let end = parenIndex;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  if (text.slice(end - 2, end) === '?.') {
    end -= 2;
    while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  }
  // A statically computed member reads as the name it spells: `fs['readFileSync']`
  // is `readFileSync`. Consuming only identifier and dot characters returned no
  // name at all, so the call anchored nothing and a root-launched escape written
  // that way was resolved from the source directory and reported clean. All three
  // quote characters, since a backtick with no interpolation is just as static:
  // ``fs[`readFileSync`]`` is the same call.
  const computed = /\[\s*(['"`])([A-Za-z0-9_$]+)\1\s*\]$/.exec(text.slice(0, end));
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

/**
 * Pure rewrites of a path string. They neither resolve nor anchor: they hand the
 * argument back in a different spelling.
 *
 * So whether the path escapes is decided by whoever receives the result, not by
 * the transformer. `path.normalize('../labs/private.docx')` returns
 * `../labs/private.docx` unchanged, and in
 * `readFileSync(path.normalize('../labs/private.docx'))` the outer call anchors it
 * at the process cwd.
 *
 * `dirname` counts: it shortens the path but keeps the traversal, so
 * `readFileSync(path.dirname('../../../labs/private.docx'))` still reads
 * `../../../labs`. Stopping at it made the scanner judge the literal
 * file-relative, which from a nested test stayed inside and reported that escape
 * clean.
 */
const PASS_THROUGH_PATH_CALLEES = new Set(['dirname', 'normalize', 'toNamespacedPath']);

/**
 * Calls that discard every leading segment, so their result cannot escape.
 *
 * `path.basename('../../../../labs/private.docx')` is `private.docx`, and an
 * outer `readFileSync` around it reads `<cwd>/private.docx` — inside the
 * repository, wherever the traversal pointed. Leaving these out of the
 * pass-through set was not enough: the candidate was still judged as the
 * original literal, so the required job failed on a line that reaches nothing
 * outside. Python's `os.path.basename` and the `.name` of a `Path` mean the same.
 *
 * Discarded rather than rewritten to the last segment. The remaining basename is
 * a bare filename with no traversal left in it, so there is nothing for the
 * resolver to decide, and rewriting would only invent a candidate the file does
 * not contain.
 */
const PATH_DISCARDING_CALLEES = new Set(['basename', 'stem']);

/**
 * The call that decides this candidate's base, looking through any pass-through
 * transformer around it, plus where that call's argument list stops.
 *
 * Reading only the innermost call let a transformer hide the anchor: because
 * `normalize` is not a path-taking API, `readFileSync(normalize('../labs/x'))`
 * fell through to file-relative resolution and a root-launched escape was
 * reported clean. Unwrapping stops at the first call that is not a pass-through,
 * so `resolve(__dirname, normalize('../x'))` still takes its base from `resolve`.
 */
function enclosingCall(text, context, offset) {
  const parens = context.openParens;
  let argumentEnd = offset;
  for (let i = parens.length - 1; i >= 0; i -= 1) {
    const { name, start } = calleeBefore(text, parens[i]);
    if (i === 0 || !PASS_THROUGH_PATH_CALLEES.has(name)) return { openParen: parens[i], argumentEnd };
    // The transformer's own name is not one of the outer call's arguments, so the
    // argument list has to stop where the transformer's expression begins.
    argumentEnd = start;
  }
  return { openParen: -1, argumentEnd };
}

/** Whether the innermost call around a candidate joins its arguments into a path. */
function composesPath(text, context) {
  const paren = context?.openParens?.at(-1);
  if (paren === undefined) return false;
  if (isArrayJoin(text, paren)) return false;
  return PATH_COMPOSING_CALLEES.has(calleeBefore(text, paren).name);
}

/**
 * Whether the innermost call around a candidate throws its leading segments away.
 *
 * The innermost only: `readFileSync(path.basename('../x'))` reaches nothing
 * outside, while `path.basename(resolve('../x'))` is a different expression whose
 * inner `resolve` really does anchor the traversal.
 *
 * `.name` on a `Path` is Python's spelling of the same thing and takes no
 * argument, so it is matched on the text after the literal rather than as a
 * callee: `open(Path('../../../../labs/x').name)`.
 */
function discardsLeadingSegments(text, context, offset, candidate) {
  const paren = context?.openParens?.at(-1);
  if (paren !== undefined && PATH_DISCARDING_CALLEES.has(calleeBefore(text, paren).name)) return true;
  // The literal's own closing quote, then `)` and `.name`, with nothing between.
  return /^['"`]\s*\)\s*\.\s*name\b/.test(text.slice(offset + candidate.length));
}

/**
 * Receivers whose `resolve` is not `path.resolve`.
 *
 * `require.resolve` and `import.meta.resolve` resolve from the calling module.
 * They share a name with `path.resolve` and mean the opposite thing.
 *
 * `Promise.resolve` shares the name and touches nothing at all, so
 * `Promise.resolve('../labs/private.docx')` was anchored at the cwd and failed
 * the gate on expected data that never reaches the filesystem. That is a false
 * positive on a required job, which is the worse direction here.
 */
const MODULE_RELATIVE_RECEIVERS = new Set(['require', 'import.meta', 'Promise']);

/**
 * Callees that hand their arguments to a separate process.
 *
 * Whatever the child does with a path operand, it resolves it from the working
 * directory it inherits, so these anchor at the cwd wherever the literal sits in
 * the call.
 */
const CHILD_PROCESS_CALLEES = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);

/**
 * The child-process callees that pass their arguments straight to the program,
 * with no shell in between.
 *
 * Only these can have a data-only exemption. `exec` and `execSync` take a
 * command line a shell interprets, so `echo hi > ../labs/x` opens that path even
 * though the command word only prints; deciding that needs the redirection
 * analysis the shell scanner already does, and guessing from the program name
 * would be a hole. They stay anchored.
 */
const ARGV_CHILD_PROCESS_CALLEES = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);

/**
 * Whether a spawned program only prints the arguments it is handed.
 *
 * `execFileSync('echo', ['../labs/x'])` writes that text to stdout and opens
 * nothing, which is the same reading the shell scanner already gives a bare
 * `echo`. Without this, anchoring every literal in a spawning call rejected a
 * fixture generating path-shaped expected output.
 *
 * A `shell` option takes the exemption away. With one, the argv form does go
 * through a shell, and `['ok', '>', '../labs/x']` creates that path even though
 * the program only prints. Any mention of the option cancels it, not only a
 * literal `true`: the value may be a variable or a platform test, and a scanner
 * that cannot read it should not be the one deciding the call is safe.
 */
const OUTPUT_ONLY_PROGRAMS = /^(['"`])(?:echo|printf)\1$/;

/** A `shell` option in a child-process call, whatever its value. */
const SHELL_OPTION = /\bshell\s*:/;

/** The first argument of a call, which for a child process names the program. */
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

/**
 * Receivers that make a shared callee name mean something other than the
 * filesystem.
 *
 * `open` is on `node:fs` and is Python's builtin, so it is in the shared set. It
 * is also `window.open`, which navigates to a URL and touches no file, and
 * anchoring by name alone failed the required job on a web test that only opens
 * a page. The same names are the browser's on `globalThis` and `self`.
 *
 * Keyed by receiver rather than by callee, so `fs.open` and a bare `open(...)`
 * are unaffected. A bare call cannot be disambiguated without following imports,
 * which this file deliberately does not do, and a bare `open` is far more likely
 * to be the filesystem one.
 */
const NON_FILESYSTEM_RECEIVERS = new Map([
  ['window', new Set(['open'])],
  ['globalThis', new Set(['open'])],
  ['self', new Set(['open'])],
]);

/**
 * The mirror of the map above: a callee that only names the filesystem when it
 * is called on a particular receiver, and resolves from the process cwd there.
 *
 * `apps/cli` runs its tests under `bun test`, so `Bun.file('../labs/x')` in a
 * root-launched test really does read the private sibling, and by name alone
 * `file` anchored nothing. Keying on the receiver is what makes it safe to add:
 * a bare `file(...)` or some other object's `.file(...)` is untouched.
 *
 * `Bun.write` is here too, and needs the companion map below: its first argument
 * is the destination path, its second is the data. Keying that by callee name
 * would have changed what every unrelated `write(...)` in the tree means, which
 * is why both halves are receiver-aware rather than only this one.
 */
const FILESYSTEM_RECEIVER_CALLEES = new Map([['Bun', new Set(['file', 'write'])]]);

/**
 * The receiver-aware half of `DATA_AFTER_PATH_CALLEES`: past the first argument
 * these write the value rather than opening it.
 *
 * `Bun.write('out.txt', '../labs/x')` creates `out.txt` holding that text and
 * reaches nothing, so without this the destination rule above would report the
 * payload as an escape.
 */
const DATA_AFTER_PATH_RECEIVER_CALLEES = new Map([['Bun', new Set(['write'])]]);

/**
 * Receivers that make `writeFile` the module-level `fs` function, whose first
 * argument is the path it opens.
 *
 * On anything else the same name is `FileHandle.writeFile`, which writes through
 * a handle that is already open and takes the data first. A fixture writing
 * path-shaped expected content with `handle.writeFile('../labs/x')` opens nothing
 * and was failing the required job.
 */
const FS_MODULE_RECEIVERS = new Set(['fs', 'fsp', 'fsPromises', 'promises', 'nodeFs']);

/** The `FileHandle` methods that share a name with a path-first `fs` function. */
const HANDLE_DATA_METHODS = new Set(['writeFile', 'appendFile']);

/**
 * Whether this call is the `FileHandle` method rather than the `fs` function.
 *
 * Both conditions are needed, and the argument count is the one that keeps this
 * from opening a hole. A receiver alone would take `myFs.writeFile('../labs/x',
 * data)` out of scope on the strength of an unrecognized name, which is the
 * fail-open direction. What the argument list looks like is the other half.
 *
 * The handle form is `writeFile(data)` or `writeFile(data, options)`, where the
 * options are an encoding name or a bag. `fs.writeFile(path, data)` also has two
 * arguments, so the second one has to be read: only an encoding or an object
 * literal means the handle form, and anything else stays a path. Writing the
 * four characters `utf8` to a path is not a call anyone makes, which is what
 * makes that safe to key on.
 */
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

/**
 * Callees whose path is not their first argument, by language and position.
 *
 * `hash_file('sha256', '../labs/x')` names an algorithm first, and the general
 * rule reads every earlier relative literal as a leading path segment, so the
 * traversal would have been resolved as `sha256/../labs/x`. Naming the position
 * is what keeps the algorithm out of the path.
 */
const LANGUAGE_PATH_ARGUMENT_POSITION = new Map([
  [
    '.php',
    new Map([
      ['hash_file', 1],
      ['hash_hmac_file', 1],
    ]),
  ],
]);

/** How many arguments precede the candidate in its own call. */
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

/**
 * Whether a `join` at this position is `Array.prototype.join` rather than
 * `path.join`.
 *
 * They share a name and mean opposite things: `path.join` builds a path from its
 * arguments, while `['x', 'y'].join('../labs/private.docx')` uses the argument as
 * a separator and touches nothing. Anchoring by name alone failed the required
 * job on the second, which is a false positive on a gate that blocks merges.
 *
 * Decided structurally, on the receiver: a literal array or the result of a call
 * ends in `]` or `)`, and neither can be the `path` module. Narrow on purpose.
 * `segments.join('../x')` stays anchored, because a bare identifier could name
 * either an array or a `path` alias, and guessing from the name would trade this
 * false positive for a missed escape.
 */
function isArrayJoin(text, parenIndex) {
  const { name, start } = calleeBefore(text, parenIndex);
  if (name !== 'join') return false;
  let before = start;
  while (before > 0 && /\s/.test(text[before - 1])) before -= 1;
  return before > 0 && (text[before - 1] === ']' || text[before - 1] === ')');
}

/**
 * Whether this one candidate is anchored at the process working directory.
 *
 * Decided per candidate rather than per statement, from the call that encloses
 * it: what came before it in that call's arguments, and which function it is
 * being passed to.
 */
/**
 * The current argument's text, from the last top-level comma of the enclosing
 * call rather than from its `(`.
 *
 * Everything before that comma belongs to a different argument. Reading the whole
 * list let a `process.cwd()` nested in an earlier argument supply a base for a
 * later one: in `copyFileSync(resolve(process.cwd(), 'fixtures/a.docx'),
 * '../labs/private.docx')` the destination is its own path, resolved at the cwd,
 * but it was prefixed with `fixtures/a.docx` and reported clean.
 *
 * Depth-aware, and skips string literals, so a comma inside a nested call or
 * inside a quoted path does not split the argument.
 */
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
 * The same text with JavaScript comments blanked to spaces.
 *
 * Length-preserving, so an offset taken from the result still points at the
 * right character of the original.
 */
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

/**
 * The same text with JavaScript comments blanked to spaces, skipping quoted
 * runs so a slash inside a string is not read as syntax.
 *
 * A path segment may legally contain `//`. Blanking by pattern alone, a `//` in
 * `resolve('fixtures//foo', '../../../labs/x')` opened a line comment that ran to
 * the end of the line, which took the cwd base away with it and resolved a real
 * escape from the source directory instead. Length-preserving, so every offset
 * still points at the same character.
 */
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

function cwdAnchorFrom(text, language) {
  const pattern = language === '.py' ? /(?:Path\.cwd|os\.getcwd)\s*\(\s*\)/ : /process\.cwd\s*\(\s*\)/;
  const match = pattern.exec(text);
  if (!match) return null;
  const segments = [...text.slice(match.index + match[0].length).matchAll(/['"`]([^'"`]*)['"`]/g)]
    .map((entry) => entry[1])
    .filter(Boolean);
  return { cwdRelative: true, prefix: segments.join('/') || undefined };
}

function isCwdAnchored(text, offset, candidate, context, language, languageCallees) {
  if (!context || context.inComment) return { cwdRelative: false };
  const { openParen, argumentEnd } = enclosingCall(text, context, offset);
  if (openParen === -1) return { cwdRelative: false };
  const argumentList = text.slice(openParen + 1, argumentEnd);
  const { name: callee } = calleeBefore(text, openParen);
  // For a `join`/`resolve`-style call the earlier arguments ARE the base, so the
  // whole list is read. For a multi-path API they are a different path entirely,
  // so only the current argument counts: in `copyFileSync(resolve(process.cwd(),
  // 'fixtures/a.docx'), '../labs/private.docx')` the destination is resolved at the
  // cwd on its own, and reading the whole list prefixed it with `fixtures/a.docx`
  // and reported it clean.
  // Comments are blanked before anything reads this text. A `process.cwd()`
  // inside one is prose about the base, not the base: `resolve(__dirname, /* not
  // process.cwd() */ '../../b/x')` was read as cwd-anchored, which resolved a
  // valid in-repository path from the wrong place and reported it missing.
  //
  // Blanked to spaces rather than removed, so every offset in this slice still
  // lines up with the text it came from. Both JavaScript forms only: this runs
  // on an argument list, and the formats with other comment syntax do not have
  // one.
  const precedingArguments = withoutComments(
    INDEPENDENT_PATH_ARGUMENTS.has(callee) ? currentArgument(argumentList) : argumentList,
  );
  // An explicit cwd expression earlier in this argument list is the base.
  // Relative literals after it are path segments too: `resolve(process.cwd(),
  // 'a', '../b')` is `<root>/b`.
  const precedingCwd = cwdAnchorFrom(precedingArguments, language);
  if (precedingCwd) return precedingCwd;
  const { name, receiver } = calleeBefore(text, openParen);
  if (name === 'URL') {
    const allArguments = completeArgumentList(text, openParen);
    const candidateStart = offset - openParen - 1;
    const afterCandidate = allArguments.slice(candidateStart + candidate.length);
    const followingBase = /^(['"`])\s*,([\s\S]*)$/.exec(afterCandidate)?.[2];
    const baseCwd = followingBase ? cwdAnchorFrom(withoutComments(followingBase), language) : null;
    if (baseCwd) return baseCwd;
  }
  // `require.resolve('../x')` and `import.meta.resolve` resolve from the calling
  // module, not the cwd, despite sharing a name with `path.resolve`.
  if (name === 'resolve' && MODULE_RELATIVE_RECEIVERS.has(receiver)) return { cwdRelative: false };
  // `window.open('../x')` navigates to a URL; only the receiver tells it apart
  // from the filesystem `open` that shares its name.
  if (NON_FILESYSTEM_RECEIVERS.get(receiver)?.has(name)) return { cwdRelative: false };
  // A child process inherits the cwd, so every path operand handed to one
  // resolves there rather than from the file that spawned it. The operand is
  // usually inside an array — `execFileSync('cat', ['../labs/x'])` — which put it
  // past the first argument, where the general rule fell back to file-relative
  // resolution and reported a read of the private sibling as clean.
  if (CHILD_PROCESS_CALLEES.has(name)) {
    const program = firstArgument(completeArgumentList(text, openParen)).trim();
    const argumentList = completeArgumentList(text, openParen);
    if (
      ARGV_CHILD_PROCESS_CALLEES.has(name) &&
      OUTPUT_ONLY_PROGRAMS.test(program) &&
      !SHELL_OPTION.test(argumentList)
    ) {
      return { cwdRelative: false, isData: true };
    }
    return { cwdRelative: true };
  }
  // `[...].join('../x')` uses its argument as a separator, not as a path segment.
  if (isArrayJoin(text, openParen)) return { cwdRelative: false };
  // A dotted variant anchors wherever the function it hangs off does.
  // `realpathSync.native('../x')` reads its callee name as `native`, which is in
  // no set, so the path fell back to file-relative resolution and a
  // root-launched escape was reported clean. The receiver's last segment is the
  // function that decides, and it is only consulted when the name itself is not
  // a known callee, so `path.resolve` still resolves as `resolve`.
  //
  // `languageCallees` holds the names that only anchor in this file's language,
  // so a generic `cache.remove(...)` in a JavaScript test is not read as Python's
  // `os.remove`.
  const anchors = (candidateName) =>
    CWD_ANCHORED_CALLEES.has(candidateName) ||
    Boolean(languageCallees?.has(candidateName)) ||
    Boolean(FILESYSTEM_RECEIVER_CALLEES.get(receiver)?.has(candidateName));
  const anchoringName = anchors(name) ? name : receiver.split('.').pop();
  if (!anchors(anchoringName)) return { cwdRelative: false };
  // Only the opening quote separates the candidate from `(`, so it is the first
  // argument: no base was passed, and a path-taking API anchors it at the cwd.
  // Python also lets that parameter be named, as in `open(file='../x')`.
  //
  // A pass-through template tag is allowed to sit in between. `String.raw` has no
  // parentheses of its own, so it stayed in the preceding text and the candidate
  // read as a later argument, which sent `readFileSync(String.raw`../labs/x`)`
  // back to file-relative resolution. It hands the literal back unchanged, so it
  // decides nothing about the base.
  const withoutTag = precedingArguments.replace(/['"`]\s*$/, '').replace(/(?:^|[\s(,])String\.raw\s*$/, '');
  const beforeCandidate = withoutTag.trim();
  // Python names the path parameter, and a named argument does not have to come
  // first: `open(mode='r', file='../labs/x')` opens the same file as
  // `open('../labs/x')`. Reading the whole preceding text meant only the
  // keyword-first spelling anchored, so the reordered one resolved from the
  // source directory and a root-launched escape read as clean. Only the
  // candidate's own argument answers which parameter it is.
  const namedArgument = language === '.py' ? currentArgument(beforeCandidate).trim() : beforeCandidate;
  const keyword = /^([A-Za-z_][A-Za-z0-9_]*)\s*=$/.exec(namedArgument)?.[1];
  const isFirstArgument =
    beforeCandidate === '' || (language === '.py' && keyword !== undefined && PYTHON_PATH_ARGUMENT_NAMES.has(keyword));
  // A named position replaces the first-argument question entirely: the earlier
  // arguments are not path segments, so neither the composing fallback below nor
  // the first-argument rule applies to them.
  const pathPosition = LANGUAGE_PATH_ARGUMENT_POSITION.get(language)?.get(name);
  if (pathPosition !== undefined) {
    return { cwdRelative: argumentPosition(precedingArguments) === pathPosition };
  }
  if (isFirstArgument && isHandleDataArgument(text, openParen, name, receiver)) {
    return { cwdRelative: false, isData: true };
  }
  if (isFirstArgument && (name === 'symlink' || name === 'symlinkSync')) {
    // A relative symlink target is stored verbatim and interpreted from the
    // destination's directory, not from the process cwd like the destination.
    const afterTarget = text.slice(offset + candidate.length);
    const secondArgument = /^(['"`])\s*,\s*([\s\S]*)$/.exec(afterTarget)?.[2] ?? '';
    const destination = /^(['"`])([^'"`]*)\1/.exec(secondArgument)?.[2] ?? composedLiteralPath(secondArgument);
    if (destination !== undefined) {
      return { cwdRelative: true, prefix: dirname(destination.replaceAll('\\', '/')) };
    }
  }
  if (isFirstArgument) return { cwdRelative: true };
  // Past the first argument of a write API, this is the data being written, not
  // a path the call opens. Reported as such so the candidate is dropped entirely
  // rather than merely resolved from somewhere else.
  if (DATA_AFTER_PATH_CALLEES.has(name) || DATA_AFTER_PATH_RECEIVER_CALLEES.get(receiver)?.has(name)) {
    return { cwdRelative: false, isData: true };
  }
  // A second source or destination path is its own path, not a suffix appended
  // to the first, so what preceded it does not supply a base.
  if (INDEPENDENT_PATH_ARGUMENTS.has(name)) return { cwdRelative: true };
  // Every preceding argument is itself relative, so no absolute base was ever
  // supplied and the whole call still anchors at the cwd:
  // `resolve('fixtures', '../../private/x')` is cwd-relative even though the
  // candidate is second. Requiring the first position missed that entirely.
  const earlier = precedingArguments.replace(/,\s*['"`]\s*$/, '');
  const literals = [...earlier.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1]);
  const isBareArgumentList = /^[\s,'"`]*$/.test(earlier.replace(/['"`][^'"`]*['"`]/g, ''));
  if (
    !isBareArgumentList ||
    literals.length === 0 ||
    !literals.every((literal) => !literal.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(literal))
  ) {
    // Not cwd-anchored, because something other than a relative literal supplied
    // the base. The relative literals between that base and the candidate are
    // still part of the path though: `resolve(__dirname, '..', '../../x')`
    // composes both, and dropping the `'..'` resolved one level too low and
    // reported an escape as clean. `__dirname`-style bases are directory-relative,
    // which is what the file base already models.
    return { cwdRelative: false, prefix: literals.filter(Boolean).join('/') };
  }
  // The earlier segments are part of the path, not just evidence about its base.
  // `resolve('fixtures', '../shared/x.docx')` from the root is
  // `<root>/shared/x.docx`, which is inside; dropping `fixtures` and resolving
  // only `../shared/x.docx` put it one level too high and failed a valid path.
  return { cwdRelative: true, prefix: literals.join('/') };
}

/**
 * The value of a `join`/`resolve` call whose arguments are all string literals,
 * or `undefined` when anything in it is not statically known.
 *
 * A symlink destination is commonly composed rather than written out:
 * `symlinkSync('../shared/data.docx', join('fixtures', 'link.docx'))` is a valid
 * in-repository link, and reading only the literal form left the target resolved
 * from the cwd, one directory too high, which failed the required job on it.
 *
 * Deliberately all-or-nothing. A single non-literal argument means the composed
 * value is not knowable here, and guessing at a prefix would move the target to
 * a directory the call never names. Returning `undefined` leaves the caller on
 * the path it already took.
 */
function composedLiteralPath(text) {
  const call = /^(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:join|resolve)\s*\(([^()]*)\)/.exec(text);
  if (!call) return undefined;
  const literal = /(['"`])([^'"`]*)\1/g;
  const segments = [...call[1].matchAll(literal)].map((match) => match[2]);
  if (segments.length === 0) return undefined;
  // Nothing may sit between the literals but separators, so a variable or a
  // nested call is not silently dropped from the composed value.
  if (call[1].replace(literal, '').trim().replace(/,/g, '').trim() !== '') return undefined;
  return segments.join('/');
}

/**
 * Resolve a candidate against its file's directory and report whether it lands
 * outside the root. Comparing resolved paths rather than counting `../` keeps
 * `packages/a/../b` correctly inside.
 *
 * Every form this scans is directory-relative, including the two that look like
 * exceptions. `new URL('../x', import.meta.url)` resolves per RFC 3986, which
 * drops the base's last segment — the filename — before applying `../`, and
 * `path.resolve(__dirname, '../x')` is directory-relative by construction. An
 * earlier version treated both as file-relative and so consumed one extra `..`,
 * turning real escapes into passes: from `examples/__tests__/a.spec.ts`, a
 * `../../../labs/private.docx` was reported clean. Verified against Node before
 * removing the special case.
 */
/**
 * Languages where every relative literal is resolved from the process working
 * directory, whatever encloses it.
 *
 * A shell script has no callee to consult: `cat '../../labs/private.docx'` hands
 * the argument straight to a command, and the shell resolves it from wherever the
 * script was launched. Reading it from the script's own directory turned a real
 * escape into an in-repository path — from `packages/a/tests/` that literal reads
 * as `packages/labs/...`, which exists nowhere and looked clean.
 *
 * Only shell. Python is handled through `Path` and `open` in
 * `CWD_ANCHORED_CALLEES`, because a bare Python string is not a path until
 * something opens it, and the JavaScript family is directory-relative by module
 * semantics.
 *
 * Decided by the shebang when there is no extension, not by the grammar object:
 * shell, Python, and YAML all share `HASH_COMMENTS`, so grammar identity cannot
 * tell them apart. Keying on `.sh` alone meant an extensionless `#!/bin/sh`
 * entrypoint was scanned and read with shell comments, then resolved from its own
 * directory anyway — the one place where the two halves of shebang support
 * disagreed.
 */
const CWD_RELATIVE_LANGUAGES = new Set(['.sh']);
const CWD_RELATIVE_SHEBANG = /\b(?:ba|z|k|da)?sh\b/;

function isCwdRelativeLanguage(file, contents) {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  if (basename.lastIndexOf('.') > 0) return CWD_RELATIVE_LANGUAGES.has(file.slice(file.lastIndexOf('.')));
  if (!contents?.startsWith('#!')) return false;
  return CWD_RELATIVE_SHEBANG.test(contents.slice(0, contents.indexOf('\n') + 1 || contents.length));
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

/**
 * Symlinks tracked in a scanned surface, as `path -> target`.
 *
 * A symlink carries its path in the link itself rather than in any file it could
 * be read from, and `readFileSync` follows it: a target inside the private parent
 * was scanned for *its* contents under the link's name, and a dangling one landed
 * in the read's `catch` and was skipped. Either way the required job reported
 * clean on a fixture a public clone cannot resolve, so the target is read with
 * `readlink` and resolved before anything is opened.
 *
 * Every tracked symlink in a scanned surface, whatever its name. Extension
 * decides whether a file's *contents* are worth reading; a link to `fixture.docx`
 * escapes just as completely as a link to `fixture.ts`.
 */
function listTrackedSymlinks() {
  return execFileSync('git', ['ls-files', '-sz'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      // `<mode> <sha> <stage>\t<path>`; 120000 is git's mode for a symlink.
      const tab = entry.indexOf('\t');
      if (tab === -1 || !entry.startsWith('120000 ')) return [];
      const file = entry.slice(tab + 1);
      if (!SCANNED_PATTERNS.some((pattern) => pattern.test(file))) return [];
      try {
        return [{ file, target: readlinkSync(resolve(REPO_ROOT, file)) }];
      } catch {
        return []; // Removed mid-run, or checked out as a plain file on a platform without links.
      }
    });
}

/**
 * Whether a path is worth opening to look for a shebang.
 *
 * Only a file with no extension at all, inside a scanned surface. Everything
 * else is decided by name, so no binary is ever read.
 */
function mightBeExecutableScript(file) {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  if (basename.lastIndexOf('.') > 0) return false;
  return SCANNED_PATTERNS.some((pattern) => pattern.test(file));
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

for (const file of listTrackedFiles()) {
  // Two passes: the first rules out anything whose name settles it, so a `.docx`
  // or a `.png` is never read. Only a path with no extension survives to be
  // opened and re-tested for a shebang.
  if (!isScanned(file) && !mightBeExecutableScript(file)) continue;
  const exemption = EXEMPT_PATHS.get(file);

  let contents;
  try {
    contents = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  } catch {
    continue; // Unreadable or removed mid-run; nothing to assert about it.
  }
  if (!isScanned(file, contents)) continue;

  // Candidates are collected over the whole file rather than line by line, so a
  // call that a formatter split across lines still reads as one argument list.
  const candidates = [
    ...[...contents.matchAll(RELATIVE_PATH_PATTERN)].map((match) => ({
      candidate: match[1],
      offset: match.index + match[0].indexOf(match[1]),
    })),
    // A machine path is only a machine path where something reads it. A web
    // example's `app.get('/home/alice/profile', handler)` is a route, and the
    // unconditional job failed on it even though nothing touches the filesystem.
    // So `/home` and `/Users` count inside a `file:` URL, which can only be a
    // path, or where a path-taking call receives them. A drive letter needs no
    // such test: `C:\Users\...` is a path in any context.
    ...[...contents.matchAll(ABSOLUTE_PATH_PATTERN)].map((match) => ({
      candidate: match[1],
      offset: match.index + match[0].indexOf(match[1]),
      machineRooted: match[1].startsWith('/'),
    })),
    // A composed traversal is reported at its first fragment, so the enclosing
    // call, and therefore the base, is the one those fragments sit in.
    ...[...contents.matchAll(COMPOSED_TRAVERSAL_PATTERN)].map((match) => ({
      candidate: joinComposedTraversal(match[1]),
      offset: match.index + match[0].indexOf(match[1]),
      composed: true,
    })),
  ];

  // `//` and `/* */` are comments in JS and TS, not in Markdown or YAML. Applying
  // the JS rule everywhere meant a plain `https://` in a Markdown line switched
  // the scanner into comment mode and skipped an escaping link later on that same
  // line. Vue is included: its script block is JS.
  //
  // Regex literals carrying an escaped `//` are blanked first. `const r = /\/\//`
  // holds the two characters that open a line comment, so the scanner switched to
  // comment mode at the regex and marked everything after it on that line as
  // prose -- a real escape written after one passed the gate. Nine tracked files
  // contain such a regex, so this is reachable rather than theoretical.
  //
  // Blanked rather than tokenized. Telling a regex from division needs an
  // operand-position heuristic, and an earlier attempt at one broke on comments
  // whose text contains a slash: a scanner that guesses wrong about JavaScript
  // syntax fails in both directions, and the under-report is the one that matters.
  // Blanking only the escaped-slash form is narrow enough to reason about, and it
  // cannot hide a path, because a path cannot appear inside `\/\/`.
  // The language decides both comment grammar and string interpolation rules.
  const language = languageExtensionFor(file, contents);
  const contexts = describeCallContexts(
    withoutEscapedSlashRegexes(contents),
    candidates.map((entry) => entry.offset),
    { grammar: commentGrammarFor(file, contents), language },
  );
  const lineStarts = [0];
  for (let i = 0; i < contents.length; i += 1) {
    if (contents[i] === '\n') lineStarts.push(i + 1);
  }
  // The filesystem names that only anchor in this file's language, so a generic
  // `remove` or `copy` in a JavaScript test is not read as Python's.
  const languageCallees = LANGUAGE_CWD_ANCHORED_CALLEES.get(language);
  // Whole-file state, so it is found once rather than once per candidate.
  const dataHeredocs = isCwdRelativeLanguage(file, contents) ? shellDataHeredocRanges(contents) : [];

  for (const { candidate, offset, composed, machineRooted } of candidates) {
    const context = contexts.get(offset);
    // A path inside a comment is prose about a path, not a dependency on one.
    if (context?.inComment) continue;
    // A path whose leading segments are thrown away before anything receives it
    // cannot reach outside: `readFileSync(path.basename('../../../../labs/x'))`
    // reads `<cwd>/x`, wherever the traversal pointed.
    if (discardsLeadingSegments(contents, context, offset, candidate)) continue;
    const { cwdRelative, prefix, isData } = isCwdAnchored(
      contents,
      offset,
      candidate,
      context,
      language,
      languageCallees,
    );
    // The data argument of a write API is file contents, not a path the call
    // opens. `writeFileSync('snapshot.txt', '../../labs/x')` touches only
    // `snapshot.txt`, so the traversal reaches nothing.
    if (isData) continue;
    // A machine-shaped literal is a private dependency wherever it sits, with two
    // exceptions: a server route names a URL, not a path, and so does a markup
    // attribute like `href`, which has no enclosing call to read. A `file:` URL is
    // always a path, so it overrides both.
    if (
      machineRooted &&
      !isFileUrl(contents, offset) &&
      (isRouteLiteral(contents, context, offset) ||
        isUrlAttributeValue(contents, offset) ||
        isCssUrlValue(contents, offset, language) ||
        isUrlArgument(contents, context, offset) ||
        isOriginRelativeUrl(contents, context, offset))
    ) {
      continue;
    }
    // Separate `'..'` arguments are one traversal only where something joins them
    // into a path. Anywhere else they are just strings that happen to read as one.
    //
    // A cwd-anchored call counts as well as a composer: `readdirSync('..')` from a
    // root-launched test reads the repository's parent, and a filesystem call is
    // not in PATH_COMPOSING_CALLEES because it does not join its arguments. Asking
    // only about composition discarded that escape before it was ever resolved.
    if (composed && !cwdRelative && !composesPath(contents, context)) continue;
    const shellCwd = isCwdRelativeLanguage(file, contents);
    // A shell string that is only printed is test data, not a dependency. The
    // language rule has no callee to consult, so without this every
    // traversal-shaped literal in a script read as a filesystem access.
    if (shellCwd && !cwdRelative && isPrintedShellArgument(contents, offset)) continue;
    if (shellCwd && !cwdRelative && isHereStringOperand(contents, offset)) continue;
    // The same rule one level up: a heredoc body handed to a command that copies
    // it out is the payload being written, not a path the script opens.
    if (shellCwd && !cwdRelative && isInDataHeredoc(dataHeredocs, offset, contents)) continue;
    // A PHP include statement has no parentheses, so no callee to read; its
    // traversal-prefixed form bypasses `include_path` and resolves from the cwd.
    const phpInclude = language === '.php' && isPhpIncludeTarget(contents, offset, candidate);
    const { resolved, escapes } = resolveCandidate(
      file,
      prefix ? `${prefix}/${candidate}` : candidate,
      cwdRelative || shellCwd || phpInclude,
    );
    if (!escapes) continue;
    // Exempt only the candidate this entry approves, so an unrelated escape
    // added to the same file later is still reported.
    if (exemption?.allow.test(candidate)) continue;
    let line = lineStarts.findIndex((start) => start > offset);
    line = line === -1 ? lineStarts.length : line;
    findings.push({
      file,
      line,
      candidate,
      // Distinguishes a live private dependency from a merely stale path.
      // Both fail; the fixes differ.
      existsLocally: existsSync(resolved),
      text: contents
        .slice(lineStarts[line - 1], offset + candidate.length + 40)
        .split('\n')[0]
        .trim()
        .slice(0, 110),
    });
  }
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
