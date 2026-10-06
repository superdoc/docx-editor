/**
 * The Vite+ migration's regression guard.
 *
 * Every assertion here exists because the corresponding mistake was made during
 * #1147 and cost a full CI round to find. They share one shape: a binary that
 * resolves from one workspace root and not another, while
 * `pnpm install --frozen-lockfile` passes either way. The lockfile proves the
 * dependency graph is consistent; it says nothing about whether the executables
 * our scripts invoke are reachable from where those scripts run.
 *
 * These are structural checks on committed files. They deliberately do not probe
 * `node_modules`: the ownership gate runs before `pnpm install` in every
 * workflow, and an earlier version of this file failed twelve jobs at once by
 * forgetting that.
 *
 * Run:
 *   node --test scripts/__tests__/vite-plus-toolchain.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * This file runs in two layouts, and getting that wrong makes the guard useless
 * rather than noisy.
 *
 * In Orbit, `superdoc/public/` sits beside `superdoc/v2/` under `superdoc/`. In
 * the exported public repository, `superdoc/public/` *is* the checkout root and
 * neither parent exists. Resolving entrypoints through unconditional `..` hops
 * pointed outside the repository there, so every path missed, every check
 * skipped, and reverting `scripts/test.mjs` to `vitest` still passed — which is
 * exactly the regression this file exists to catch.
 *
 * So: detect the layout instead of assuming one, and record whether the sibling
 * workspaces are present at all.
 */
const SUPERDOC_ROOT = existsSync(resolve(PUBLIC_ROOT, '../v2/pnpm-workspace.yaml')) ? resolve(PUBLIC_ROOT, '..') : null;
const IN_ORBIT = SUPERDOC_ROOT !== null;

/**
 * Workspaces carrying their own `pnpm-workspace.yaml`.
 *
 * The public checkout has one; Orbit has three. Both are valid, so this reports
 * what is there rather than requiring the Orbit shape.
 */
const WORKSPACES = Object.freeze(
  IN_ORBIT
    ? {
        'superdoc/': SUPERDOC_ROOT,
        'superdoc/public/': PUBLIC_ROOT,
        'superdoc/v2/': resolve(SUPERDOC_ROOT, 'v2'),
      }
    : { './': PUBLIC_ROOT },
);

function toRepositoryPath(path) {
  return path.split(sep).join('/');
}

/**
 * Every tracked `package.json` under a root, skipping installed and built trees.
 *
 * Walked rather than globbed so this needs no dependency of its own: it runs in
 * the same pre-install window as the pnpm ownership gate.
 */
const MANIFEST_NAMES = Object.freeze(['package.json', 'package.json5', 'package.yaml']);

function listManifests(root, skip = new Set(['node_modules', 'dist', 'dist-cdn', '.next', 'out', '.git'])) {
  // Ask git first, so an ignored manifest a developer happens to have locally —
  // a draft under `superdoc/plans/`, say — cannot fail a gate that passes on the
  // hosted clean checkout. `--cached --others --exclude-standard` is tracked
  // files plus untracked-but-not-ignored ones, which is exactly what a PR can
  // contain.
  const tracked = trackedManifests(root);
  if (tracked) return tracked;
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(join(dir, entry.name));
      } else if (MANIFEST_NAMES.includes(entry.name)) {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return found;
}

/**
 * Manifests git reports under a root, or null when git cannot answer.
 *
 * Falling back to the filesystem walk keeps the guard working in an exported
 * tarball or a checkout without git, where every file present is repository
 * input anyway. Memoised because the callers ask per workspace and per package.
 */
const manifestCache = new Map();

function trackedManifests(root) {
  if (manifestCache.has(root)) return manifestCache.get(root);
  let result = null;
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...MANIFEST_NAMES.map((name) => `*${name}`)],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    result = output
      .split('\0')
      .filter(Boolean)
      .map((relativePath) => resolve(root, relativePath))
      // `git ls-files` reports installed trees when they are not ignored, and the
      // walk skipped them for a reason: a dependency's own manifest is not this
      // repository's input.
      .filter((path) => !/(?:^|[\\/])(?:node_modules|dist|dist-cdn|\.next|out)[\\/]/u.test(path.slice(root.length)));
  } catch {
    result = null;
  }
  manifestCache.set(root, result);
  return result;
}

/**
 * A manifest's parsed contents, or `null` when it is not JSON.
 *
 * pnpm also accepts `package.json5` and `package.yaml`, and neither can be
 * parsed here: this runs before `pnpm install`, so there is no parser to reach
 * for. Returning `null` and moving on would be a silent accept, so the caller
 * reports them instead — the same fail-closed stance the pnpm ownership gate
 * takes for exactly this reason.
 */
function readManifest(path) {
  if (!path.endsWith('.json')) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every value in one top-level section whose key selects a given package.
 *
 * Section-aware on purpose: `vite` appears in both `catalog:` and `overrides:`,
 * and they are allowed to disagree. The catalog entry pointing at the Vite+ core
 * is how packages opt into it; the override is what every other package in the
 * workspace is forced onto, and that one has to stay a real Vite.
 *
 * Selector-aware rather than exact-key, because an override key is a selector
 * and not a package name. pnpm accepts `vite`, `vite@7`, the convergence form
 * `vite@`, and a parent-scoped `some-pkg>vite`, all of which redirect `vite`.
 * Matching the literal key alone made `'vite@7': 'npm:react@19.0.0'` invisible:
 * every Vite 7 dependency in the workspace resolved to React while all four
 * tests stayed green.
 *
 * Returns every match, because these forms coexist and any one of them can be
 * the unsafe one.
 */
/**
 * The line index of a section header, or -1.
 *
 * A top-level key may be quoted: `'catalog':` is the same section to pnpm and
 * was invisible to a matcher looking for the bare token, so quoting the key was
 * enough to hide a poisoned catalog from every assertion here. Entry keys were
 * already unquoted before comparison; section keys were not.
 *
 * It may also carry a node property. `&unsafe overrides:` anchors the section
 * and is still `overrides` to pnpm, confirmed against pnpm 11.10.0: the override
 * under an anchored key lands in the lockfile. A `!!tag` binds the same way, so
 * both are allowed for.
 */
const SECTION_PROPERTY = '(?:(?:&[^\\s]+|!![^\\s]+)\\s+)*';

/**
 * A workspace file with any uniform leading indentation removed.
 *
 * Every matcher here anchors top-level keys to the start of a line, and YAML
 * permits the whole document to sit at a common indent. Indenting the file made
 * both sections invisible, so an unsafe catalog passed unexamined while pnpm
 * read the same keys as always. Removing the shared prefix restores the shape
 * these matchers expect without changing what the document means.
 */
function normalized(workspace) {
  const text = workspace.replace(/\r\n/gu, '\n');
  const body = text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    // A `---` document marker or a `%YAML` directive sits at column zero by
    // definition, so counting it made the shared indent zero and left an
    // indented mapping beneath it unreadable.
    .filter((line) => !/^(?:---|\.\.\.|%\S+)\s*$/u.test(line.trim()) && !line.startsWith('%'));
  const indent = Math.min(...body.map((line) => line.length - line.trimStart().length), Infinity);
  if (!Number.isFinite(indent) || indent === 0) return text;
  return text
    .split('\n')
    .map((line) => line.slice(indent))
    .join('\n');
}

function sectionHeader(lines, section) {
  return lines.findIndex((line) => new RegExp(`^${SECTION_PROPERTY}'?"?${section}'?"?:\\s*(?:#.*)?$`, 'u').test(line));
}

function sectionPairs(workspace, section, name) {
  const lines = normalized(workspace).split('\n');
  const start = sectionHeader(lines, section);
  if (start === -1) {
    // A section written in flow style is real YAML that this line reader cannot
    // see: `overrides: { vite: 'npm:...' }` has no block body, so a header-only
    // match found nothing and the workspace passed unexamined while pnpm applied
    // the override. Fail closed rather than report an empty section.
    assertBlockStyle(workspace, section);
    return [];
  }
  const found = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/u.test(line)) break; // next top-level key
    // A merge key pulls in entries defined elsewhere, and pnpm materializes
    // them: `overrides:\n  <<: *unsafe` recorded the merged bin-less override in
    // the lockfile, confirmed on pnpm 11.10.0. Following the anchor means
    // resolving arbitrary YAML references, which is past what a line reader can
    // do honestly, so the shape is refused instead of read as one odd entry.
    assert.ok(
      !/^\s+(?:'<<'|"<<"|<<)\s*:/u.test(line),
      `\`${section}:\` composes entries with a YAML merge key, which this guard cannot resolve and ` +
        'would read as an empty merge while pnpm applies the merged values. Inline the entries, or ' +
        'teach this file to resolve anchors.',
    );
    const entry = /^\s+(?<key>'[^']*'|"[^"]*"|[^:]+):\s*(?<value>.+?)\s*$/u.exec(line);
    if (!entry) continue;
    const key = entry.groups.key.replace(/^['"]|['"]$/gu, '');
    if (selects(key, name)) found.push({ key, value: scalar(entry.groups.value) });
  }
  return found;
}

/** Just the values, for callers that do not care which selector produced them. */
function sectionEntries(workspace, section, name) {
  return sectionPairs(workspace, section, name).map(({ value }) => value);
}

/**
 * The override keys that select a package, as written.
 *
 * Derived from the same walk as the values rather than repeating it. Keeping two
 * readers in step failed the moment one of them needed pairs: `overridesFor`
 * looped over every key but fetched the value with a first-match lookup, so
 * `vite-plus: '0.2.7'` beside `'vite-plus@': 'npm:react@19.0.0'` judged the safe
 * entry twice and never saw the unsafe one.
 */
function overrideKeys(workspace, name) {
  return sectionPairs(workspace, 'overrides', name).map(({ key }) => key);
}

/**
 * Refuses a section this reader would silently skip.
 *
 * Only block style is understood here, and a section absent entirely is fine:
 * `superdoc/` has no `overrides`. What is not fine is a section that exists in a
 * form this cannot read, because the result is indistinguishable from absence
 * and every assertion downstream quietly passes.
 */
function assertBlockStyle(workspace, section) {
  const text = normalized(workspace);
  // A whole-document flow mapping has no line-anchored keys at all, so every
  // per-section check below reads it as an empty file and passes. Rejected
  // first, because it hides every section at once rather than one.
  //
  // A `---` document-start marker may precede it, on its own line or on the same
  // one, and both are valid YAML. Dropped before the check rather than matched
  // around, so `--- { overrides: ... }` cannot slip past on punctuation.
  const body = text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/^---(?:\s|$)/u, '')
    .trimStart();
  assert.ok(
    !body.startsWith('{'),
    'pnpm-workspace.yaml is written as a document-level flow mapping, which this guard reads as an ' +
      'empty file and would pass without checking anything. Rewrite it as a block mapping, or teach ' +
      'this file to parse it.',
  );
  // Anchored to the line, not to `\s`, which matches newlines: `\s*\S` ran past
  // the header onto the first entry of a perfectly ordinary block section and
  // reported every workspace as flow style. A trailing comment is still block
  // style, so it is excluded explicitly rather than by matching "nothing here".
  const inline = new RegExp(`^${SECTION_PROPERTY}'?"?${section}'?"?:[^\\S\\n]*(?!#)\\S`, 'mu').exec(text);
  assert.ok(
    !inline,
    `\`${section}:\` is written in flow style, which this guard reads as an empty section and would ` +
      'pass without checking anything. Rewrite it as a block mapping, or teach this file to parse it.',
  );
}

/**
 * Whether an override or catalog key redirects the named package.
 *
 * The child half of a parent-scoped selector is what gets redirected, so
 * `qar@1>vite` is judged on `vite`. A trailing `@<range>` is a version filter on
 * the same package, not a different one.
 */
function selects(key, name) {
  const child = key.includes('>') ? key.slice(key.lastIndexOf('>') + 1) : key;
  return child.replace(/@[^@]*$/u, '') === name || child === name;
}

/** The single value for a selector, when only one may reasonably exist. */
function sectionEntry(workspace, section, name) {
  return sectionEntries(workspace, section, name)[0] ?? null;
}

/**
 * Whether a spec is recognisably a semver range against the npm registry.
 *
 * The safe case has to be recognised positively rather than inferred from the
 * absence of a protocol. A YAML alias arrives here as `*anchor`: no protocol, no
 * range, and pnpm resolves it to whatever the anchor holds, so "not a protocol"
 * silently meant "stock Vite" for a value that could be anything.
 *
 * Deliberately narrow. Every range this repository uses is covered, and a form
 * that is not recognised fails rather than passing unexamined.
 */
function isRegistryRange(spec) {
  return /^(?:[\^~><]|>=|<=|=)?\d+(?:\.[\dx*]+)*(?:[-+][\w.-]+)?$|^(?:\*|latest|next)$/u.test(spec);
}

/**
 * The shell command a `run:` body presents at a given offset.
 *
 * An inline value and a literal block (`run: |`) are line-oriented, so the
 * physical line is the command. A folded scalar (`run: >`) joins its lines with
 * spaces before the shell sees them, so the whole folded run has to be assembled
 * or `echo` and `vitest` on separate lines read as two commands rather than one
 * with an argument.
 */
function runBody(source, offset) {
  const lines = source.split('\n');
  const lineIndex = source.slice(0, offset).split('\n').length - 1;
  const indent = (line) => line.length - line.trimStart().length;
  // The `run:` key and its scalar indicator are not part of the command. A flow
  // mapping needs its own strip: `- { run: vitest run }` was passed whole, so
  // `vitest` sat behind the non-runner prefix `- { run:` and read as an argument.
  //
  // `openFlowMapping` is not used here: it reports mappings still *open* at end
  // of text, which is what `inRunBody` needs and the opposite of this. A
  // complete one-line mapping returns -1 there, so the strip never ran.
  const strip = (line) => {
    // A `{` only opens a flow mapping when it comes before the `run` key. Any
    // brace was taken as one, so an expression *inside* the command — `run:
    // vitest run --reporter=${{ env.R }}` — made the strip cut past the
    // invocation.
    const key = /(?:^|[-\s{,])'?"?run'?"?\s*:/u.exec(line);
    const brace = line.indexOf('{');
    if (brace !== -1 && key && brace < key.index + key[0].length) {
      // Cut at the `run` key wherever it sits, not at the first key: a mapping
      // may put another key ahead of it. The value runs to the next key or the
      // closing brace, and `lastFlowKey`'s rules for what separates them apply,
      // so a quoted comma or an expression brace does not end it early.
      const mapping = line.slice(brace);
      const mappingKey = /(?:^\{|,)\s*'?"?run'?"?\s*:\s*/u.exec(mapping);
      if (!mappingKey) return mapping;
      const rest = mapping.slice(mappingKey.index + mappingKey[0].length);
      const value = rest.slice(0, flowValueEnd(rest)).trim();
      // A quoted scalar's quotes are YAML's, not the shell's, so they are
      // removed: left in place, `invokes` blanked the whole command as data.
      return yamlScalar(value);
    }
    // A block value's YAML quotes are removed for the same reason the flow
    // value's are: they are YAML's, not the shell's, and leaving them made
    // `- run: "vitest run"` read as quoted data. Last round fixed this for flow
    // mappings only.
    const value = line.replace(/^\s*-?\s*'?"?run'?"?\s*:\s*[|>]?[-+\d]*\s*/u, '').trim();
    return yamlScalar(value);
  };
  // The indentation and chomping indicators may appear in either order, so both
  // spellings are accepted: `>2-` and `>-2` mean the same thing.
  const opener = /^\s*-?\s*'?"?run'?"?\s*:\s*(?<style>[|>])(?:(?<indicator>[1-9])[-+]?|[-+](?<chomped>[1-9])?)?/u;
  // The match may be on the opener itself, or on a continuation line indented
  // under it. Walk back to the nearest less-indented line and ask whether that
  // one opened a scalar.
  if (opener.exec(lines[lineIndex])?.groups.style !== '>') {
    // Walk out to the opener, not merely to the first less-indented line: a
    // more-indented continuation sits under a sibling line, so stopping at the
    // first one found `echo ok` rather than the `run: >` that opened the scalar.
    let depth = indent(lines[lineIndex]);
    let found = -1;
    for (let index = lineIndex - 1; index >= 0; index -= 1) {
      if (lines[index].trim() === '') continue;
      if (indent(lines[index]) >= depth) continue;
      depth = indent(lines[index]);
      if (opener.exec(lines[index])) {
        found = index;
        break;
      }
      // A line that is less indented and opens nothing ends the search: the
      // match was not inside a scalar at all.
      if (/^\s*-?\s*'?"?[\w-]+'?"?\s*:/u.test(lines[index])) break;
    }
    if (found === -1 || opener.exec(lines[found])?.groups.style !== '>')
      return joinContinuations(lines, lineIndex, strip);
    return foldFrom(lines, found, indent, foldIndicator(opener.exec(lines[found])));
  }
  return foldFrom(lines, lineIndex, indent, foldIndicator(opener.exec(lines[lineIndex])));
}

/**
 * A line with any shell line-continuations joined onto it.
 *
 * A trailing backslash removes the newline before the shell sees it, so
 * `echo ok \` followed by `vitest run` is one command with an argument. Returning
 * the second physical line on its own reported an invocation the shell never
 * makes. Preceding continued lines are pulled in too, since the match may land on
 * any of them.
 */
function joinContinuations(lines, lineIndex, strip) {
  // Only an odd run of trailing backslashes continues the line: a pair is an
  // escaped backslash, so the newline survives and the next line is its own
  // command. bash confirms — `echo ok \\` then `echo SECOND` runs both.
  const continues = (line) => /(?<!\\)(?:\\\\)*\\\s*$/u.test(line);
  let first = lineIndex;
  while (first > 0 && continues(lines[first - 1])) first -= 1;
  const joined = [strip(lines[first])];
  for (let index = first; continues(lines[index]) && index + 1 < lines.length; index += 1) {
    joined[joined.length - 1] = joined.at(-1).replace(/\\\s*$/u, '');
    joined.push(lines[index + 1].trim());
  }
  return joined.join(' ');
}

/** The indentation indicator from either spelling, or undefined. */
function foldIndicator(match) {
  return match?.groups.indicator ?? match?.groups.chomped;
}

/**
 * Every line indented under a folded scalar, joined as the shell sees them.
 *
 * A blank line inside a folded scalar folds to a newline rather than being
 * dropped, so `echo ok`, a blank, then `vitest run` is two commands. Discarding
 * blanks joined them into one and read the second as an argument.
 *
 * A more-indented line keeps its newline too: YAML folds only lines at the
 * scalar's own indentation, so an extra-indented continuation is a second
 * command rather than an argument. Trimming every line lost that distinction.
 *
 * The break belongs on both sides of such a run: returning to the base
 * indentation ends the more-indented block, so `echo ok`, a deeper
 * `printf detail`, then a base-level `vitest run` is three commands. Marking
 * only the entry joined the last two.
 *
 * An explicit indentation indicator (`run: >2`) states the base directly, so it
 * is used when present. Inferring the base from the first content line made a
 * deliberately deeper first line the baseline, which then folded the real base
 * lines into it.
 */
function foldFrom(lines, start, indent, indicator) {
  const body = [];
  let blank = false;
  // The indicator counts from the parent node's indentation, which is the
  // opening line's.
  let base = indicator ? indent(lines[start]) + Number(indicator) : null;
  let previousDeeper = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '') {
      // Only a blank *inside* the scalar folds to a newline; trailing blanks
      // before a less-indented line are outside it.
      if (body.length > 0) blank = true;
      continue;
    }
    if (indent(lines[index]) <= indent(lines[start])) break;
    // The first content line sets the scalar's indentation; anything deeper is
    // more-indented and keeps its break.
    base ??= indent(lines[index]);
    const deeper = indent(lines[index]) > base;
    body.push((blank || deeper || previousDeeper ? '\n' : '') + lines[index].trim());
    previousDeeper = deeper;
    blank = false;
  }
  return body.join(' ');
}

/**
 * Whether an offset falls inside a workflow's `run:` command body.
 *
 * A `run:` value is either inline on its own line, a block scalar whose
 * continuation lines are indented under it, or an entry in a flow mapping such
 * as `- { run: vitest run }`. All three are commands; every other YAML value is
 * configuration the shell never executes.
 */
function inRunBody(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  const current = lines.at(-1);
  if (/^\s*-?\s*'?"?run'?"?\s*:/u.test(current)) return true;
  // A flow mapping puts the key mid-line, so the anchored form above misses it.
  // The value ends at the next key in the mapping, though: checking only for an
  // unclosed brace made `- { run: echo ok, name: vitest }` report its own step
  // name as a command.
  //
  // A comma inside a quoted scalar is content, not a delimiter, so the scan for
  // that next key skips quoted regions: `- { run: "echo a,b && vitest run" }` is
  // one value, and splitting at its comma lost the invocation after it.
  //
  // The opener is found by tracking depth rather than taking the last `{`, which
  // picked a GitHub expression brace: `- { run: "echo ${{ github.actor }} && ..."`
  // has a closed nested pair, so the last opener looked already closed and the
  // surrounding mapping went unseen.
  //
  // Searched from the start of the block rather than the current line, because a
  // flow mapping may span lines: `- { name: probe, run:` followed by
  // `vitest run }` keeps the key on the previous line. Bounded to the nearest
  // preceding line at column zero or starting a block sequence entry, so an
  // unbalanced brace elsewhere in the file cannot reach forward.
  const blockStart = lines.findLastIndex((line, index) => index < lines.length - 1 && /^\s*-\s|^\S/u.test(line));
  const region = lines.slice(blockStart === -1 ? 0 : blockStart).join('\n');
  const brace = openFlowMapping(region);
  if (brace !== -1) {
    const key = lastFlowKey(region.slice(brace));
    if (key === 'run') return true;
  }
  // Inside a block scalar: walk out to the opener. Stopping at the first
  // less-indented line found a sibling rather than the `run:` that opened the
  // scalar, so a more-indented continuation was judged as not-a-command. This is
  // the same walk `runBody` does, and having written it twice is how the two
  // drifted apart.
  const indent = (line) => line.length - line.trimStart().length;
  let depth = indent(source.split('\n')[lines.length - 1]);
  for (let index = lines.length - 2; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (indent(line) >= depth) continue;
    depth = indent(line);
    if (/^\s*-?\s*'?"?run'?"?\s*:\s*[|>]/u.test(line)) return true;
    if (/^\s*-?\s*'?"?[\w-]+'?"?\s*:/u.test(line)) return false;
  }
  return false;
}

/**
 * A whole source with its comments removed, carrying quote state across lines.
 *
 * A template literal spans lines, so judging each line alone made an interior
 * line look like ordinary code and a `//` inside the literal cut it. Comments
 * still end at the newline; only the quoted regions are tracked globally.
 */
function withoutComments(source, markers) {
  const lines = source.split('\n');
  const stripped = [];
  let carried = null;
  for (const line of lines) {
    const { text, quote } = scanLine(line, markers, carried);
    stripped.push(text);
    carried = quote;
  }
  return stripped.join('\n');
}

/**
 * A line with any trailing comment removed, respecting quotes.
 *
 * `#` and `//` only start a comment outside quotes and at a token boundary.
 * Cutting at the first `#` anywhere deleted the command in
 * `run: echo "foo # setup" && vitest run`, taking the invocation with it.
 *
 * A backslash-escaped quote is content, not a delimiter. Ending the quoted
 * region at it made `echo "foo \" # setup" && vitest run` look like it had a
 * comment, which dropped the invocation again by a different route. Only
 * double-quoted regions honour the escape, matching both shell and JSON.
 *
 * The caller says which markers apply, because they are language-specific. A
 * workflow's `run:` values are shell, where `//` is a path or an argument and
 * not a comment at all.
 */
function withoutComment(line, markers = ['#', '//']) {
  return scanLine(line, markers, null).text;
}

/**
 * One line's stripped text and the quote state it leaves open.
 *
 * A single-line caller passes `carried` as null; the whole-source walk threads
 * it, so a template literal keeps its region across the newline. Only a
 * backtick can stay open at end of line, but the state is threaded uniformly
 * rather than special-cased.
 */
/**
 * Whether JavaScript would read the next token as an operand.
 *
 * This is what separates a regex literal from a division: `log(/a/)` opens one,
 * `a / b` does not. Only the preceding non-space character matters, plus the
 * keywords that take an expression.
 */
function expectsOperand(text) {
  return /[([{,;:=!&|?+\-*%~^<>]\s*$|^\s*$|\b(?:return|typeof|case|in|of|new|delete|void|yield|await)\s+$/u.test(text);
}

/**
 * The index of a regex literal's closing `/`, or -1 if it does not close.
 *
 * Escapes and character classes are tracked, since `/` inside either does not
 * end the pattern.
 */
function regexEnd(line, start) {
  let inClass = false;
  for (let index = start + 1; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') inClass = true;
    else if (character === ']') inClass = false;
    else if (character === '/' && !inClass) return index;
  }
  return -1;
}

function scanLine(line, markers, carried) {
  // A backtick opens a template literal in JavaScript, where `//` is content.
  // Only the JS entrypoints ask for the `//` marker, and those are the same
  // files that can carry one, so the quote set follows the markers.
  const quotes = markers.includes('//') ? ["'", '"', '`'] : ["'", '"'];
  const blocks = markers.includes('//');
  let quote = carried;
  let text = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    // A block comment runs to its terminator, across lines. Left unhandled, the
    // prose inside one was scanned as code and reported an invocation that
    // JavaScript never executes.
    if (quote === '/*') {
      if (line.startsWith('*/', index)) {
        quote = null;
        index += 1;
      }
      continue;
    }
    if (quote) {
      // A backslash escapes the next character, so skip it rather than letting an
      // escaped quote close the region.
      //
      // Which quotes honour that is language-specific. Shell and YAML single
      // quotes are literal, so a backslash there is content; JavaScript's are
      // not, and treating them as literal ended the string early and read the
      // rest as a comment. The marker set names the language, as it does for the
      // comment tokens and the quote set.
      const escapes = quote !== "'" || markers.includes('//');
      if (character === '\\' && escapes) {
        text += character + (line[index + 1] ?? '');
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      text += character;
      continue;
    }
    if (blocks && line.startsWith('/*', index)) {
      quote = '/*';
      index += 1;
      continue;
    }
    // A `/` opens a regex literal only where JavaScript expects an operand, and
    // inside one a `//` is a character class rather than a comment:
    // `console.log(/[//]/)` was cut at the class and lost the code after it.
    // `//` itself is never a regex — an empty pattern is written `new RegExp('')` —
    // so it stays a comment even though a preceding `;` permits an operand.
    if (blocks && character === '/' && line[index + 1] !== '/' && line[index + 1] !== '*' && expectsOperand(text)) {
      const end = regexEnd(line, index);
      if (end !== -1) {
        text += line.slice(index, end + 1);
        index = end;
        continue;
      }
    }
    if (quotes.includes(character)) {
      quote = character;
      text += character;
      continue;
    }
    const marker = markers.find((token) => line.startsWith(token, index));
    // What counts as a boundary depends on the marker. `#` in shell and YAML
    // needs whitespace before it, or `https://x` and a `#anchor` inside a bare
    // word would cut. `//` in JavaScript needs no space at all — `x();// note`
    // is a comment — so requiring one preserved it and reported the text after
    // it. What does have to be excluded there is a URL protocol, which is the
    // only other place `//` follows a token.
    const boundary = marker === '//' ? line[index - 1] !== ':' : index === 0 || /\s/u.test(line[index - 1]);
    if (marker && boundary) {
      return { text, quote };
    }
    text += character;
  }
  // A template literal and a block comment survive the newline; anything else is
  // a stray quote on one line and would swallow the rest of the file if carried.
  return { text, quote: quote === '`' || quote === '/*' ? quote : null };
}

/**
 * A YAML scalar with its quotes and any trailing inline comment removed.
 *
 * Carrying the comment into the value corrupts it, and the damage runs in the
 * direction that costs a real review: `npm:rolldown-vite@7.3.1 # tracked in
 * @superdoc/orbit#1147` parsed as an alias to `rolldown-vite@7.3.1 # tracked in`,
 * which is not the name this guard permits, so a legitimate override failed.
 *
 * A `#` inside quotes is content, not a comment, so the quoted form is read to
 * its closing quote first.
 */
function scalar(raw) {
  const quoted = /^(?<quote>['"])(?<value>.*?)\k<quote>/u.exec(raw);
  if (quoted) return quoted.groups.value;
  return raw.replace(/\s+#.*$/u, '').trim();
}

/**
 * Whether a shell command invokes a given binary.
 *
 * One definition shared by all three checks, because keeping three regexes in
 * agreement by hand did not work: the same leading-boundary bug was reported and
 * fixed separately for Vitest, then `vp`, then `vite`, each time because the
 * previous fix was not carried across. The matrix below pins the behaviour, so a
 * change here has to answer for every case at once.
 *
 * What counts as an invocation:
 *   - the bare binary, anywhere a command can start, including at end of line
 *   - an executable path: `./node_modules/.bin/x`, `node_modules/.bin/x`
 *   - behind any runner or wrapper: `pnpm exec x`, `npx x`, `env FOO=1 x`,
 *     `time x`, `nice -n 10 x`
 *
 * What does not:
 *   - a longer name that merely contains it: `vpx`, `myvite`, `vite-plus`
 *   - a file or subpath: `vitest.config`, `vitest/config`, `vp.config`
 *
 * Wrappers are deliberately not enumerated. The set is unbounded, and the
 * allowlist that tried to enumerate it let `env vitest run` through.
 */
function invokes(command, binary) {
  return commandSegments(command).some((segment) => segmentInvokes(segment, binary));
}

/**
 * Whether one already-split segment runs a binary.
 *
 * Separate from `invokes` because that one re-splits what it is given: handing it
 * a segment expanded the wrapper body again, so
 * `sh -c 'pnpm --dir ../public exec vp test'` matched `vp` under a lead with the
 * delegation stripped away, and the caller's `!delegates(segment)` then judged
 * the wrapper rather than the command inside it.
 */
function segmentInvokes(segment, binary) {
  const bare = unquoted(segment);
  const pattern = new RegExp(binaryPattern(binary).source, 'gu');
  for (const match of bare.matchAll(pattern)) {
    // Measured from the start of the word, because the match lands on the
    // binary name and an executable path puts `./node_modules/.bin/` in front
    // of it.
    const boundary = bare.slice(0, match.index).search(/\S+$/u);
    const start = boundary === -1 ? match.index : boundary;
    const word = bare.slice(start).split(/\s/u)[0];
    // A leading assignment is configuration, not a command: `TOOL=vp echo ok`
    // runs `echo`, and reading the word as the command left an empty lead that
    // looked like command position. An option carrying its value inline is the
    // same shape one character over — `env --unset=vp echo ok` unsets `vp` and
    // runs `echo` — so both are skipped.
    if (/^[\w.]+=/u.test(word) || /^-/u.test(word)) continue;
    // Command position, not merely present: `echo vp` passes the word as data,
    // and matching it anywhere in the segment reported a script that only
    // prints. The same rule the quoted form already used.
    if (isCommandPosition(bare.slice(0, start))) return true;
  }
  return false;
}

/**
 * A segment with quoted text blanked.
 *
 * Quoted text is data, not a command: `echo 'vp test run'` runs `echo`, and
 * matching the token inside the quotes reported a local invocation that blocked
 * a valid script. The same blanking keeps a quoted argument from supplying the
 * pnpm invocation that `delegates` looks for.
 *
 * Only the package-script scan uses this. The entrypoint scan deliberately does
 * not: `spawn('vitest', ['run'])` is an invocation whose binary is quoted, and
 * that literal is the exact regression the entrypoint check exists to catch.
 */
function unquoted(segment) {
  // The command token itself may be quoted: `'vp' test run` runs vp, because the
  // shell strips the quotes before resolving it. Unwrapped only in command
  // position, though: unwrapping every standalone quoted word turned the
  // argument in `echo 'vp'` back into a token and reported a script that only
  // prints.
  //
  // Command position is the head of the segment, or whatever follows a runner
  // that hands off to another command.
  const head = /^(?<lead>\s*(?:[\w.]+=\S*\s+)*(?:\S+\s+)*?)(?<quote>'|")(?<token>[\w./-]+)\k<quote>(?=\s|$)/u.exec(
    segment,
  );
  const unwrapped =
    head && isCommandPosition(head.groups.lead)
      ? `${head.groups.lead}${head.groups.token}${segment.slice(head[0].length)}`
      : segment;
  return unwrapped.replace(/'[^']*'/gu, ' ').replace(/"(?:\\.|[^"\\])*"/gu, ' ');
}

/**
 * Whether what precedes a token puts it in command position.
 *
 * Nothing at all, or a runner that executes its remaining arguments as a
 * command. Anything else means the token is an argument to something already
 * running.
 *
 * Consuming the runner's own options matters: reading only the last word made
 * `nice -n 10 'vp' test run` look like an argument to `10`, so the quoted
 * command was left blanked and the invocation went unseen. Options and their
 * values are skipped after a runner is found, and a chain of them collapses
 * because each runner hands off to the next.
 */
function isCommandPosition(lead) {
  // Which short flags take a separate value, per runner, read from each tool's
  // own `--help` rather than guessed. The previous rule assumed any flag
  // followed by a non-flag word consumed it, which is right for `nice -n 10` and
  // wrong for `env -u vp echo ok`, where `-u` names a variable to unset and
  // `echo` is the command. Getting it backwards in either direction misreads the
  // command, so the sets are explicit.
  const runners = {
    exec: '',
    run: '',
    dlx: '',
    x: '',
    npx: 'p',
    env: 'CfuSa',
    time: 'o',
    nice: 'n',
    'xvfb-run': 'nsfe',
    command: '',
    dotenv: 'ev',
    timeout: 'ks',
  };
  // A package manager hands off through a subcommand rather than directly, so it
  // is a runner only in combination with one.
  const managers = ['pnpm', 'npm', 'yarn', 'bun'];
  const words = withoutCommandPrefix(lead)
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .filter((word) => !/^[\w.]+=/u.test(word));
  let index = 0;
  // A control keyword opens a new command rather than taking arguments, so
  // anything after it is in command position. Both the openers and the
  // continuations count: `if vp test; then echo ok; fi` runs vp as the
  // condition, and consuming only the continuations left `if` looking like a
  // command that takes arguments.
  const keywords = ['if', 'while', 'until', 'then', 'do', 'else', 'elif', 'case', '!', '{', '('];
  while (index < words.length && keywords.includes(words[index])) index += 1;
  while (index < words.length) {
    const word = words[index].replace(/^.*\//u, '');
    const isManager = managers.includes(word);
    if (!(word in runners) && !isManager) return false;
    // A manager's own directory and filter options are consumed by the same
    // loop; only its subcommand hands off, and that subcommand is itself a
    // runner key.
    const valued = isManager ? 'CdirFfilterprefix' : runners[word];
    index += 1;
    // A mandatory positional argument is not the command: `timeout 30 vp test`
    // gives the duration first.
    const positionals = word === 'timeout' ? 1 : 0;
    // The runner's own flags, and a value for any that takes one. A bare `--`
    // ends them explicitly, which is how `dotenv -e .env -- vitest` separates
    // its options from the command.
    while (index < words.length && words[index].startsWith('-')) {
      if (words[index] === '--') {
        index += 1;
        break;
      }
      const flag = words[index];
      index += 1;
      // A long flag carries its value with `=`; a short one may take the next
      // word, but only if this runner documents it that way.
      const takesValue = flag.startsWith('--')
        ? !flag.includes('=') && /^--(?:dir|prefix|filter|unset|chdir|file|adjustment|signal|kill-after)$/u.test(flag)
        : [...valued].some((letter) => flag.endsWith(letter));
      // The lead ends here when a flag's value is the next word, so the token the
      // caller matched is that value rather than a command: `env -u vp echo ok`
      // unsets `vp` and runs `echo`.
      if (takesValue) {
        if (index >= words.length) return false;
        index += 1;
      }
    }
    index += positionals;
    if (index > words.length) return false;
  }
  return true;
}

/**
 * A command split into the separate commands a shell would run.
 *
 * Every operator that ends one command and starts another, so an exemption that
 * applies to one segment cannot silently cover the next. Missing `|` and `&` let
 * `pnpm --dir ../public exec vp test | vp test` count as a single delegated
 * command, and a literal newline is a separator too: a two-line script kept its
 * second, local invocation hidden behind the first line's `--dir`.
 *
 * A command substitution becomes its own segment, and is blanked from the text
 * around it. It runs as a separate command, so a delegation on either side of
 * the boundary says nothing about the other: `vp test $(pnpm --dir x exec y)`
 * exempted an outer `vp` that resolves locally, and once substitutions were
 * merely stripped, `echo pnpm --dir x $(vp test)` did the same in reverse. Both
 * fall out of treating the substitution as the separate command it is, rather
 * than of another special case in `delegates`.
 */
function commandSegments(command) {
  const segments = [];
  const substitution = /\$\(([^()]*)\)|`([^`]*)`/u;
  const expand = (text) => {
    let outer = text;
    let match;
    // Innermost first, so nesting collapses one layer per pass. Bounded because
    // each pass removes one substitution from a finite string.
    //
    // Single quotes suppress substitution in the shell, so `echo '$(vp test)'`
    // prints the text rather than running it. Extracting it anyway reported a
    // script that only prints. Double quotes do not suppress it, so those are
    // still expanded.
    while ((match = substitution.exec(outer))) {
      if (!singleQuoted(outer, match.index)) expand(match[1] ?? match[2]);
      outer = `${outer.slice(0, match.index)} ${outer.slice(match.index + match[0].length)}`;
    }
    // A wrapper runs its quoted arguments as commands, so those strings are
    // segments too. Blanking every quoted token as data hid `sh -c 'vp test run'`
    // entirely. Each body is split again on its own operators, because it can
    // hold several commands and only some of them may delegate.
    //
    // Two shapes, both real here: a shell with `-c` takes one command string,
    // and a multiplexer such as `concurrently` takes several. Ten scripts in
    // this repository use the second, three of them running `vite` inside the
    // quotes, so it hid `vite` consumers as well as `vp` ones.
    for (const wrapped of outer.matchAll(SHELL_WRAPPER)) {
      for (const part of shellSplit(unwrapBody(wrapped.groups.body))) expand(part);
    }
    const multiplexer = MULTIPLEXER.exec(outer);
    if (multiplexer) {
      // Each positional argument is a command. Quoting is only needed when the
      // command has spaces, so `concurrently vp` runs vp with no quotes at all
      // and expanding only quoted arguments left it invisible. Options and their
      // values are skipped, since those belong to the multiplexer.
      const rest = outer.slice(multiplexer.index + multiplexer[0].length);
      // Which multiplexer flags take a value, read from `concurrently --help`
      // rather than guessed: `-k` is boolean, so treating any word after any
      // flag as its value swallowed the command in `concurrently -k vp`.
      const valued =
        /^-(?:m|n|s|c|p|t|i|l|-(?:max-processes|names|success|prefix|prefix-colors|timings|name-separator|hide|kill-signal|restart-tries|restart-after|passthrough-arguments|default-input-target|cwd))$/u;
      for (const argument of rest.matchAll(/'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"|;&]+/gu)) {
        const value = argument[0];
        if (/^-/u.test(value)) continue;
        const previous = rest.slice(0, argument.index).trimEnd().split(/\s+/u).at(-1) ?? '';
        // A bare word after a value-taking option is that option's value.
        if (valued.test(previous) && !/^['"]/u.test(value)) continue;
        for (const part of shellSplit(unwrapBody(value))) expand(part);
      }
    }
    segments.push(outer);
  };
  for (const part of shellSplit(command)) expand(part);
  return segments;
}

/**
 * A shell invoked with a command string: the argument is code, not data.
 *
 * The body may be unquoted when it is a single word — `sh -c vp` runs vp — so
 * that form is matched too. A quoted body is preferred where present, since it
 * can hold spaces and operators.
 *
 * `eval` belongs here for the same reason: bash combines its arguments and
 * executes the result as a shell command, so `eval "vp test run"` runs vp while
 * the quoted body was being blanked as data. It is the only builtin that takes a
 * command *string* — `exec`, `command`, and `builtin` take an argv and are
 * already handled as runners, and `source` takes a file — so the list stops
 * there. Verified against bash rather than inferred from the names.
 *
 * `env -S` is the same shape: GNU env documents it as splitting the value into
 * arguments and running them, so listing `S` among the value-taking flags left
 * the command blanked.
 */
const SHELL_WRAPPER =
  /(?<![\w.-])(?:(?:sh|bash|zsh|dash)\s+-[a-z]*c|eval|env\s+-S|env\s+--split-string)\s*=?\s*(?<body>'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"|;&]+)/gu;

/** A wrapper body with its surrounding quotes removed, if it has any. */
function unwrapBody(body) {
  return /^['"]/u.test(body) ? body.slice(1, -1) : body;
}

/**
 * A launcher whose quoted arguments are each a command.
 *
 * `concurrently "a" "b"` runs both, and the same holds for the npm-run-all
 * family. Its options and their values are skipped by matching only quoted
 * arguments after it, which is how the real scripts here are written.
 */
const MULTIPLEXER = /(?<![\w.-])(?:concurrently|npm-run-all|run-p|run-s)(?![\w./-])/u;

/**
 * Launcher names this source can call, including import aliases.
 *
 * `import { spawnSync as launch } from 'node:child_process'` makes `launch` a
 * launcher, and requiring the call site to keep one of the built-in names missed
 * it. Both the ESM and CommonJS destructuring forms are read, and only aliases of
 * a real launcher count, so `readFile as launch` does not.
 */
const BASE_LAUNCHERS = Object.freeze([
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
  'run',
  'sh',
  'command',
  'cmd',
]);

function launcherNames(source) {
  const names = new Set(BASE_LAUNCHERS);
  const add = (list, separator) => {
    for (const part of list.split(',')) {
      const [original, alias] = part.split(separator).map((piece) => piece.trim());
      if (BASE_LAUNCHERS.includes(original) && alias) names.add(alias);
    }
  };
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/gu)) {
    add(match[1], /\s+as\s+/u);
  }
  for (const match of source.matchAll(/\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]/gu)) {
    add(match[1], ':');
  }
  return [...names];
}

/**
 * Identifiers this source passes to a launcher as the command.
 *
 * Memoised per source, since the entrypoint scan asks once per match.
 */
const launchedCache = new Map();

function launchedNames(source) {
  const cached = launchedCache.get(source);
  if (cached) return cached;
  const pattern = new RegExp(
    `(?<![\\w$])(?:[\\w$]+\\s*\\.\\s*)?(?:${launcherNames(source).join('|')})\\s*\\(\\s*(?<name>[\\w$]+)\\s*[,)]`,
    'gu',
  );
  const names = new Set([...source.matchAll(pattern)].map((match) => match.groups.name));
  launchedCache.set(source, names);
  return names;
}

/**
 * A YAML scalar decoded to the text the shell receives.
 *
 * The quotes are YAML's, not the shell's, so they come off. A double-quoted
 * scalar also honours escapes: `run: "echo ok\nvitest run"` is two commands, and
 * leaving the two characters `\n` in place made it read as one. Single-quoted
 * scalars are literal apart from a doubled quote.
 */
function yamlScalar(value) {
  if (!/^(['"]).*\1$/su.test(value)) return value;
  const body = value.slice(1, -1);
  if (value.startsWith("'")) return body.replaceAll("''", "'");
  // The second callback argument is the first capture group, and this pattern's
  // only group is the escape character. Naming it changes nothing about the
  // positional arguments, and reading `escape` as if it were the group is how a
  // first attempt silently decoded nothing.
  //
  // The same forms the scan blanks are decoded here, so the two agree on where a
  // command ends: the hex and unicode escapes produce the same characters as the
  // single-letter ones.
  const decoded = { n: '\n', r: '\r', t: '\t', 0: '\0', '\\': '\\', '"': '"', '/': '/', L: ' ', P: ' ', N: '', _: ' ' };
  return body.replace(
    /\\(?:([nrt0\\"/LPN_])|x([0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))/gu,
    (whole, letter, hex, short, long) => {
      if (letter) return decoded[letter] ?? whole;
      const code = Number.parseInt(hex ?? short ?? long, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    },
  );
}

/**
 * Where a flow mapping value ends: the next key, or the closing brace.
 *
 * Quoted regions and nested braces are skipped, since a comma inside either does
 * not delimit, and a `${{ }}` expression sits inside the value.
 */
function flowValueEnd(text) {
  let quote = null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      if (depth === 0) return index;
      depth -= 1;
    } else if (character === ',' && depth === 0) return index;
  }
  return text.length;
}

/**
 * The offset of the outermost flow mapping still open at end of text, or -1.
 *
 * Depth-tracked rather than "the last `{` with no `}` after it", because a
 * GitHub expression such as `${{ github.actor }}` opens and closes a nested pair
 * inside the run value. Taking the last opener found that one, saw it closed,
 * and concluded no mapping was open at all.
 */
function openFlowMapping(text) {
  const open = [];
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '{') open.push(index);
    else if (character === '}') open.pop();
  }
  return open.length > 0 ? open[0] : -1;
}

/**
 * The key whose value a flow mapping ends inside.
 *
 * Walks the mapping so a comma inside quotes cannot look like a delimiter, which
 * a regex splitting on every comma got wrong.
 *
 * A colon only separates a key from its value when the text before it is a plain
 * scalar: `run: echo http://example.com` has two, and treating the second as a
 * separator moved the active key off `run` and lost the command after it. YAML
 * requires a space after a key's colon, and a key holds no spaces of its own, so
 * both conditions are checked.
 */
function lastFlowKey(mapping) {
  let key = null;
  let candidate = '';
  let quote = null;
  for (let index = 0; index < mapping.length; index += 1) {
    const character = mapping[index];
    if (quote) {
      // Accumulated, not discarded: a key may be quoted, and dropping its
      // characters left an empty candidate so `- { 'run': vitest run }` named no
      // key at all. A quoted value's characters are harmless here, because the
      // separator test rejects anything that is not a bare word.
      if (character === '\\' && quote === '"') {
        candidate += mapping[index + 1] ?? '';
        index += 1;
      } else if (character === quote) quote = null;
      else candidate += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '{' || character === ',') {
      candidate = '';
      continue;
    }
    if (character === ':') {
      const name = candidate.trim().replace(/^['"]|['"]$/gu, '');
      const separates = /^[\w-]+$/u.test(name) && /^[\s]|^$/u.test(mapping.slice(index + 1));
      if (separates) {
        key = name;
        candidate = '';
      } else {
        candidate += character;
      }
      continue;
    }
    candidate += character;
  }
  return key;
}

/**
 * Whether an offset sits inside a single-quoted region.
 *
 * Single quotes are literal in the shell: no substitution, no escapes. Double
 * quotes are not, which is why only this form suppresses expansion.
 */
function singleQuoted(text, offset) {
  let quote = null;
  for (let index = 0; index < offset; index += 1) {
    const character = text[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (character === '\\') index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
  }
  return quote === "'";
}

/**
 * A command split on shell operators that are not inside quotes.
 *
 * Splitting the raw text first left an unmatched quote in each half, so
 * `echo 'vp test && example'` became two segments and neither could be blanked
 * as data. The literal `vp` then read as an invocation and blocked a script that
 * only prints one.
 */
function shellSplit(command) {
  const operators = ['&&', '||', '|', ';', '&', '\n'];
  const parts = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      current += character;
      if (character === '\\' && quote === '"') {
        current += command[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    // A `&` that follows a redirection duplicates a file descriptor rather than
    // backgrounding: `2>&1 vp test` is one command, and splitting there left
    // `1 vp test`, whose head reads as an unknown command.
    const duplication = character === '&' && /[<>]\s*$/u.test(current);
    const operator = duplication ? undefined : operators.find((token) => command.startsWith(token, index));
    if (operator) {
      parts.push(current);
      current = '';
      index += operator.length - 1;
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

/**
 * The token pattern for one binary name.
 *
 * The leading boundary excludes word and dot characters but allows `/`, so a
 * path to the executable still matches while `vpx` and `myvite` do not. The
 * trailing boundary additionally excludes `/` and `.`, which is what keeps
 * `vitest/config` and `vite.config` out.
 */
function binaryPattern(binary) {
  return new RegExp(`(?<![\\w.-])${binary}(?![\\w./-])`, 'u');
}

/**
 * Whether a command delegates to another directory rather than running here.
 *
 * A delegated script resolves its binary from the directory it names, so the
 * calling package does not need to declare the dependency. pnpm spells this four
 * ways and accepts an `=` in either long form; matching only `--dir ` would have
 * demanded a redundant `vite-plus` declaration from a valid `--dir=../public`
 * script. Verified against the CLI rather than assumed: `-C sub` and
 * `--dir=sub` both run in `sub`.
 *
 * The switch has to be pnpm's own option, which means it appears before pnpm
 * hands off to the command it launches. `vp test --dir fixtures` passes `--dir`
 * to `vp`, and so does `pnpm exec vp test --dir fixtures`: everything after
 * `exec` belongs to `vp`, which still has to resolve locally to read it.
 * Requiring only that a pnpm command precede the switch accepted that second
 * form, because `pnpm exec vp test` does precede it.
 *
 * Judged per segment, and `commandSegments` makes each command substitution its
 * own segment, so a delegation inside one cannot exempt the command around it or
 * the reverse.
 *
 * Anchored at the segment's command head, rather than looking for pnpm anywhere
 * before the switch. Quoted text is blanked first: `vp build --filter 'pnpm -C
 * x'` is one `vp` invocation whose argument merely mentions pnpm, and scanning
 * the raw text exempted it. Leading `VAR=value` assignments are skipped because
 * real scripts carry them.
 */
function delegates(segment) {
  // A quoted argument is data, not a command, so it cannot supply the pnpm
  // invocation or the switch. The same shell prefixes `isCommandPosition`
  // consumes are consumed here: a delegation inside a function body was reported
  // local because only assignments were stripped.
  const head = withoutCommandPrefix(unquoted(segment));
  if (!/^pnpm(?![\w./-])/u.test(head)) return false;
  const delegation = /(?<![\w-])(?:--dir|--prefix)[\s=]|(?<![\w-])-C\s/u.exec(head);
  if (!delegation) return false;
  // No subcommand yet, so the switch is still in pnpm's own option position.
  return !/(?<![\w.-])(?:exec|run|dlx|x)(?![\w./-])/u.test(head.slice(0, delegation.index));
}

/**
 * A command with the shell syntax that precedes it removed.
 *
 * A function body opener, a case pattern, assignments, and redirections all sit
 * ahead of the command without being one. Written once because
 * `isCommandPosition` and `delegates` both need it and had drifted apart.
 */
function withoutCommandPrefix(text) {
  return (
    text
      // A function body opener ends the definition and starts a command:
      // `probe() { vp test run; }` runs vp. The `{` is a keyword on its own, but
      // the name and parens sit ahead of it.
      .replace(/^\s*(?:function\s+)?[\w$-]+\s*(?:\(\s*\))?\s*\{\s*/u, '')
      // A case pattern ends the pattern list and starts a command. Anchored to a
      // `;;` or `in` boundary so a call's `)` is not mistaken for a pattern.
      .replace(/^.*(?:^|;;|\bin\b)\s*[^()\s]*\)\s*/su, '')
      // Assignments and redirections both precede the command and may
      // interleave, so they are consumed together.
      .replace(/^\s*(?:[\w.]+=\S*\s+|\d*(?:>>|>&|<&|>\||<>|>|<)\s*\S+\s+)*/u, '')
  );
}

/**
 * Every catalog entry a manifest's `catalog:` specifier could resolve to.
 *
 * A `catalog:` protocol is resolved by the root the install runs from, not by
 * the nearest ancestor workspace. Verified on pnpm 11.10.0: installing from an
 * outer root resolves a nested package's `catalog:` against the outer catalog,
 * and installing from a root whose catalog lacks the entry fails outright with
 * ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC.
 *
 * `superdoc/v2/runtime-tools` is installed by both `superdoc/` and
 * `superdoc/v2`, so its specifier has to be safe under either. Walking up and
 * stopping at the first definition would have accepted a v2 catalog that no
 * longer defines the entry at all, because `superdoc/` still does.
 *
 * Returns an empty list when no owning workspace defines it, which the caller
 * treats as a failure: that specifier does not install.
 */
function catalogEntries(manifestPath, name) {
  const entries = [];
  let directory = dirname(manifestPath);
  for (;;) {
    const workspace = resolve(directory, 'pnpm-workspace.yaml');
    // Only a workspace that actually installs this package resolves its
    // `catalog:`. The Orbit repository root carries a `pnpm-workspace.yaml` with
    // no `packages:` at all, so counting it reported every manifest as taking
    // vite-plus from a workspace that never sees it.
    if (existsSync(workspace) && installs(workspace, manifestPath)) {
      const source = readFileSync(workspace, 'utf8');
      entries.push({ workspace, entry: sectionEntry(source, 'catalog', name) });
    }
    const parent = dirname(directory);
    if (parent === directory) return entries;
    directory = parent;
  }
}

/**
 * Every override a package is subject to for a given name.
 *
 * Overrides are workspace-wide, and an install from any root that lists the
 * package applies that root's. Selector-aware for the same reason the `vite`
 * check is: `vite-plus@0`, `vite-plus@`, and `parent>vite-plus` all redirect it.
 */
/**
 * Every override a package is subject to for a given name.
 *
 * Overrides are workspace-wide, and an install from any root that lists the
 * package applies that root's. Selector-aware for the same reason the `vite`
 * check is: `vite-plus@0`, `vite-plus@`, and `parent>vite-plus` all redirect it.
 *
 * A parent-scoped selector is excluded, because it governs only that parent's
 * dependency. Returning it for every manifest reported all of them at once,
 * which is the noisy direction: an override this guard cannot attribute is not
 * evidence that a given package is broken.
 */
function overridesFor(manifestPath, name) {
  const found = [];
  let directory = dirname(manifestPath);
  for (;;) {
    const workspace = resolve(directory, 'pnpm-workspace.yaml');
    if (existsSync(workspace) && installs(workspace, manifestPath)) {
      const source = readFileSync(workspace, 'utf8');
      for (const { key, value } of sectionPairs(source, 'overrides', name)) {
        if (key.includes('>')) continue;
        found.push({ workspace, override: value });
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return found;
    directory = parent;
  }
}

/**
 * Whether a workspace's `packages:` list covers a manifest.
 *
 * The globs are simple enough here to match directly: `*` within a segment, `**`
 * across them. A pattern this cannot read counts as covering, so an unfamiliar
 * shape makes the catalog stricter rather than silently exempt.
 */
function installs(workspacePath, manifestPath) {
  const relativeDir = toRepositoryPath(relative(dirname(workspacePath), dirname(manifestPath)));
  // The root manifest sits in the workspace directory itself. pnpm resolves its
  // `catalog:` from that workspace even though no `packages:` pattern names it,
  // and treating an empty relative path as "not owned" let
  // `superdoc/public/package.json` — five scripts running `vp`, declaring
  // `vite-plus: catalog:` — skip the catalog check entirely.
  if (relativeDir === '') return true;
  return sectionItems(readFileSync(workspacePath, 'utf8'), 'packages').some((pattern) => {
    const expression = pattern
      .split('/')
      .map((part) => (part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*')))
      .join('/');
    return new RegExp(`^${expression}$`, 'u').test(relativeDir);
  });
}

/**
 * The items of a top-level YAML sequence.
 *
 * Walks the section the way `sectionEntries` walks a mapping, rather than
 * matching a contiguous run of list lines: `superdoc/v2` has comments between
 * its `packages:` entries, and a contiguous match stopped at the first one, so
 * `tests/*` was never seen and that workspace looked like it owned nothing under
 * `tests/`.
 */
function sectionItems(workspace, section) {
  const lines = normalized(workspace).split('\n');
  const start = sectionHeader(lines, section);
  if (start === -1) {
    // A flow sequence is real YAML this block reader cannot see:
    // `packages: ['packages/*']` has no list body, so it read as an empty
    // workspace and every manifest looked unowned. Read it rather than fail,
    // because unlike the mapping sections this one has a simple flat form.
    const inline = new RegExp(`^${SECTION_PROPERTY}'?"?${section}'?"?:[^\\S\\n]*\\[(?<body>[^\\]]*)\\]`, 'mu').exec(
      normalized(workspace),
    );
    if (!inline) return [];
    return inline.groups.body
      .split(',')
      .map((item) => scalar(item.trim()))
      .filter(Boolean);
  }
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/u.test(line)) break; // next top-level key
    const item = /^\s+-\s*(?<value>.+?)\s*$/u.exec(line);
    if (!item) continue;
    items.push(scalar(item.groups.value));
  }
  return items;
}

/**
 * Whether any script in this workspace invokes the `vite` binary directly.
 *
 * Only these workspaces care what `vite` resolves to. A workspace that merely
 * carries the Vite+ core in its catalog, and builds through `vp`, never runs the
 * executable and is not broken by the alias.
 */
function runsViteBinary(root) {
  return viteConsumers(root).length > 0;
}

/**
 * Manifests whose scripts run the `vite` binary, with the spec they declare.
 *
 * A package can redirect `vite` for itself, without touching the workspace file:
 * `"vite": "npm:@voidzero-dev/vite-plus-core@0.2.7"` in
 * `superdoc/tests/behavior` installs the bin-less core for that package alone,
 * so its `harness` script cannot resolve the executable while every
 * workspace-level assertion stays green.
 */
function viteConsumers(root) {
  const found = [];
  for (const path of listManifests(root)) {
    const manifest = readManifest(path);
    if (!manifest) continue;
    if (!Object.values(manifest.scripts ?? {}).some((command) => invokes(command, 'vite'))) continue;
    const spec = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }.vite;
    found.push({ path, spec });
  }
  return found;
}

/**
 * The matcher's contract, as a table.
 *
 * These run as assertions rather than living in a comment because the three
 * checks below share one matcher now: a change that fixes one case and breaks
 * another is the failure mode this file has actually had, twelve review rounds
 * running. Each row is a case some round got wrong.
 */
test('the binary matcher recognises invocations without over-matching', () => {
  const invocations = [
    ['vp test run', 'vp'],
    ['vp', 'vp'],
    ['vp;', 'vp'],
    ['pnpm exec vp test', 'vp'],
    ['./node_modules/.bin/vp test run', 'vp'],
    ['node_modules/.bin/vp test', 'vp'],
    ['vite build', 'vite'],
    ['./node_modules/.bin/vite build', 'vite'],
    ['npx vitest run', 'vitest'],
    ['env vitest run', 'vitest'],
    ['env NODE_ENV=test vitest run', 'vitest'],
    ['time vitest run', 'vitest'],
    ['nice -n 10 vitest', 'vitest'],
    ['xvfb-run vitest run', 'vitest'],
    ['dotenv -e .env -- vitest run', 'vitest'],
    ['./node_modules/.bin/vitest run', 'vitest'],
    // A quoted command token is still the command: the shell strips the quotes
    // before resolving it.
    ["'vp' test run", 'vp'],
    ['"vp" test', 'vp'],
    ["'./node_modules/.bin/vp' test", 'vp'],
    // A shell wrapper runs its argument as code, not data.
    ["sh -c 'vp test run'", 'vp'],
    ['bash -c "vp build"', 'vp'],
    ["sh -euc 'vp test'", 'vp'],
    // A `-c` body may be a single unquoted word.
    ['sh -c vp', 'vp'],
    ['bash -c vp', 'vp'],
    // `eval` executes its argument as a shell command, so the body is code.
    ['eval "vp test run"', 'vp'],
    ["eval 'vp test'", 'vp'],
    ['eval vp', 'vp'],
    // `env -S` splits its value into arguments and runs them.
    ["env -S 'vp test run'", 'vp'],
    ['env --split-string="vp test"', 'vp'],
    // A multiplexer's positional argument needs no quotes when it has no spaces.
    ['concurrently vp', 'vp'],
    ['concurrently -k vp', 'vp'],
    // A leading redirection belongs to the shell, not the command.
    ['> /tmp/vp.log vp test run', 'vp'],
    ['2> err.log vp test', 'vp'],
    ['2>&1 vp test', 'vp'],
    // An assignment may precede the redirection.
    ['FOO=1 > /tmp/vp.log vp test run', 'vp'],
    ['FOO=1 BAR=2 2> e vp test', 'vp'],
    // A case pattern ends the pattern list and starts a command.
    ['case "$MODE" in test) vp test run;; *) echo ok;; esac', 'vp'],
    ['case $x in a) echo y;; b) vp test;; esac', 'vp'],
    // A function body opener starts a command.
    ['probe() { vp test run; }; probe', 'vp'],
    ['function probe { vp test; }; probe', 'vp'],
    // A multiplexer runs each quoted argument as a command.
    ['concurrently "vp test run"', 'vp'],
    ['concurrently -k -n A,B "echo x" "vp test"', 'vp'],
    ['run-p "vp test" "echo y"', 'vp'],
    ['npm-run-all -p "vp build"', 'vp'],
    // Command position survives a runner or a leading assignment.
    ["pnpm exec 'vp' test", 'vp'],
    ["NODE_ENV=test 'vp' test", 'vp'],
    // A runner's own options do not end command position.
    ["nice -n 10 'vp' test run", 'vp'],
    ["xvfb-run -a 'vp' test", 'vp'],
    ['env -i vp test', 'vp'],
    ['env -u FOO vp test', 'vp'],
    ['timeout 30 vp test', 'vp'],
    ['timeout -k 5 30 vp test', 'vp'],
    ['xvfb-run -n 99 vp test', 'vp'],
    // A control keyword opens a new command rather than taking arguments.
    ['if true; then vp test; fi', 'vp'],
    ['for f in a; do vp test; done', 'vp'],
    ['if x; then y; else vp test; fi', 'vp'],
    // An opener is a keyword too: the condition runs as a command.
    ['if vp test; then echo ok; fi', 'vp'],
    ['while vp test; do echo x; done', 'vp'],
    ['until vp check; do echo y; done', 'vp'],
  ];
  const nonInvocations = [
    ['vpx build', 'vp'],
    ['myvp run', 'vp'],
    ['./bin/vp.config check', 'vp'],
    ['vp-helper run', 'vp'],
    ['vite-plus run', 'vite'],
    ['myvite go', 'vite'],
    ['./bin/vite.config check', 'vite'],
    ['vitest run', 'vite'],
    ['vitest.config.mjs', 'vitest'],
    ["import { defineConfig } from 'vitest/config'", 'vitest'],
    // Quoted text is data. A script that prints a Vite+ command is not running
    // one, and reporting it demanded an unused dependency.
    ["echo 'vp test run'", 'vp'],
    ['echo "vp test"', 'vp'],
    ['node -e \'require("vp")\'', 'vp'],
    // An operator inside quotes does not separate commands, so the whole string
    // stays data rather than splitting into an unmatched-quote fragment.
    ["echo 'vp test && example'", 'vp'],
    ["echo 'vp test | grep x'", 'vp'],
    // A quoted word in argument position is data. Unwrapping every standalone
    // quoted token turned this one back into a command.
    ["echo 'vp'", 'vp'],
    ['echo "vp"', 'vp'],
    ["cp a 'vp'", 'vp'],
    // Single quotes suppress substitution, so this prints rather than runs.
    ["echo '$(vp test)'", 'vp'],
    ["echo '`vp build`'", 'vp'],
    // An unquoted word in argument position is data too, not only a quoted one.
    ['echo vp', 'vp'],
    ['echo vp test run', 'vp'],
    ['cp a vp', 'vp'],
    // A case branch that runs something else is still argument position.
    ['case $x in a) echo vp;; esac', 'vp'],
    ['node -e vp', 'vp'],
    // An assignment value is configuration, not the command it precedes.
    ['TOOL=vp echo ok', 'vp'],
    ['BIN=vp npm run x', 'vp'],
    // A flag's value is not the command it precedes.
    ['env -u vp echo ok', 'vp'],
    ['env --unset vp echo ok', 'vp'],
    ['dotenv -e vp echo ok', 'vp'],
    ['xvfb-run -n vp echo ok', 'vp'],
    // A multiplexer's argument is still shell, so data inside it stays data.
    ['concurrently "echo vp" "echo ok"', 'vp'],
    ['eval "echo vp"', 'vp'],
    // An option's value is not a command.
    ['concurrently -n vp "echo x"', 'vp'],
  ];
  for (const [command, binary] of invocations) {
    assert.ok(invokes(command, binary), `expected to recognise \`${command}\` as running ${binary}`);
  }
  for (const [command, binary] of nonInvocations) {
    assert.ok(!invokes(command, binary), `expected \`${command}\` not to count as running ${binary}`);
  }

  // Delegation, in every spelling pnpm accepts. The `=` forms and `-C` were all
  // treated as local invocations, which demanded a redundant dependency
  // declaration from valid scripts.
  for (const segment of [
    'pnpm --dir ../public exec vp test',
    'pnpm --dir=../public exec vp test',
    'pnpm -C ../public exec vp test',
    'pnpm --prefix packages/sdk run test',
    'pnpm --prefix=packages/sdk run test',
    // The same shell prefixes `isCommandPosition` consumes apply here.
    'probe() { pnpm --dir ../public exec vp test; }',
    'FOO=1 pnpm --dir ../public exec vp test',
    'pnpm --silent --dir ../public exec vp test',
    // Leading environment assignments are ordinary in these scripts.
    'NODE_ENV=test pnpm --dir ../public exec vp test',
  ]) {
    assert.ok(delegates(segment), `expected \`${segment}\` to count as delegated`);
  }
  // The switch has to be pnpm's, and in pnpm's own option position. Everything
  // after `exec` or `run` belongs to the command pnpm launches, which still has
  // to resolve locally to read it.
  for (const segment of [
    'vp test run',
    'pnpm --filter x exec vp test',
    'pnpm exec vp test',
    'vp test --dir fixtures',
    'vp build -C sub',
    'vp test --prefix x',
    // A quoted argument is data. Scanning the raw segment let one supply the
    // pnpm invocation that exempted its own `vp`.
    "vp build --filter 'pnpm -C x'",
    "vp test run -t 'pnpm --dir ../public'",
    'vp test --name "pnpm --prefix y"',
    'pnpm exec vp test --dir fixtures',
    'pnpm exec vp test -C sub',
    'pnpm exec vp test --prefix y',
    'pnpm dlx vp test --dir x',
  ]) {
    assert.ok(!delegates(segment), `expected \`${segment}\` to run locally`);
  }

  // A command substitution runs as its own command, so a delegation on one side
  // of the boundary must not exempt the other. Both directions were bypasses:
  // a nested pnpm exempted an outer local `vp`, and once substitutions were
  // merely stripped, a nested `vp` was exempted by surrounding pnpm text.
  for (const command of [
    'vp test $(pnpm --dir ../public exec node -e "0")',
    'vp test `pnpm --dir x exec node -e 0`',
    'echo pnpm --dir ../public $(vp test)',
    'pnpm --dir ../public echo $(vp test)',
    'echo pnpm --dir x `vp build`',
    'vp test $(pnpm --dir a exec b) $(pnpm -C c run d)',
  ]) {
    assert.ok(
      commandSegments(command).some((segment) => segmentInvokes(segment, 'vp') && !delegates(segment)),
      `expected \`${command}\` to need vite-plus locally`,
    );
  }
  // A substitution beside a genuine delegation leaves it delegated.
  assert.ok(
    !commandSegments('pnpm --dir ../public exec vp test $(echo x)').some(
      (segment) => segmentInvokes(segment, 'vp') && !delegates(segment),
    ),
    'a substitution beside a real delegation must not make it local',
  );

  // Comment stripping, which has to respect quoting: a `#` inside quotes is
  // part of the command, and cutting there removed the invocation after it.
  assert.equal(withoutComment('run: echo "foo # setup" && vitest run'), 'run: echo "foo # setup" && vitest run');
  assert.equal(withoutComment("run: echo 'a # b' && vp test"), "run: echo 'a # b' && vp test");
  // An escaped quote is content, so the region stays open and the `#` after it
  // is not a comment. Verified against bash: this command does run `vitest`.
  assert.equal(
    withoutComment(String.raw`run: echo "foo \" # setup" && vitest run`),
    String.raw`run: echo "foo \" # setup" && vitest run`,
  );
  // An escaped backslash is not an escaped quote: the next `"` really does close
  // the string, so the `#` starts a comment. bash agrees — it prints `a \ b` and
  // never runs the second command — so cutting here is correct, not a miss.
  assert.equal(withoutComment(String.raw`run: echo "a \\" b # x" && vitest run`), String.raw`run: echo "a \\" b `);
  // Single quotes have no escapes in shell or YAML, so a backslash is literal
  // there. JavaScript's do honour escapes, which is why the marker set decides:
  // pass the shell marker explicitly rather than relying on the default.
  assert.equal(withoutComment(String.raw`run: echo 'a \' # x`, ['#']), String.raw`run: echo 'a \' `);
  assert.equal(
    withoutComment(String.raw`console.log('a \' // x'); y();`, ['//']),
    String.raw`console.log('a \' // x'); y();`,
  );
  assert.equal(withoutComment('run: vitest run # legacy'), 'run: vitest run ');
  assert.equal(withoutComment('# whole line'), '');
  assert.equal(withoutComment('  # indented'), '  ');
  assert.equal(withoutComment('const x = 1; // note'), 'const x = 1; ');
  // Not a comment marker: no whitespace before it.
  assert.equal(withoutComment('run: curl https://example.com/x'), 'run: curl https://example.com/x');
  assert.equal(withoutComment('run: vp test --grep foo#bar'), 'run: vp test --grep foo#bar');

  // Comment markers are language-specific: `//` is a path or argument in shell,
  // so it only ends a line in the JavaScript entrypoints.
  assert.equal(withoutComment('run: echo setup // note && vitest run', ['#']), 'run: echo setup // note && vitest run');
  assert.equal(withoutComment('const x = 1; // note', ['#', '//']), 'const x = 1; ');
  assert.equal(withoutComment('run: vitest run # legacy', ['#']), 'run: vitest run ');
  // A template literal is a quoted region in JavaScript, so `//` inside one is
  // content. Only the JS entrypoints ask for that marker.
  assert.equal(withoutComment('console.log(`foo // setup`); x();', ['#', '//']), 'console.log(`foo // setup`); x();');
  assert.equal(withoutComment('const x = 1; // note', ['#', '//']), 'const x = 1; ');
  // `#` starts no comment in JavaScript, so a regex literal or private field
  // keeps whatever follows it.
  assert.equal(withoutComment('console.log(/foo # setup/); x();', ['//']), 'console.log(/foo # setup/); x();');
  // `//` needs no whitespace before it in JavaScript, but a protocol is not a
  // comment.
  assert.equal(withoutComment('console.log("x");// note', ['//']), 'console.log("x");');
  assert.equal(withoutComment('const x=1;//note', ['//']), 'const x=1;');
  assert.equal(withoutComment('const u = "https://x.com/a"; y();', ['//']), 'const u = "https://x.com/a"; y();');
  // A block comment is a comment region, and it survives the newline.
  assert.equal(withoutComments('/* vitest run */\nx();', ['//']), '\nx();');
  assert.equal(withoutComments('/*\n * vitest run\n */\nx();', ['//']), '\n\n\nx();');
  assert.equal(withoutComments('/* old */ y();', ['//']), ' y();');
  // A folded scalar joins its lines before the shell sees them, so `vitest` on
  // its own line is an argument. A literal block keeps the newlines.
  const folded = 'steps:\n      - name: x\n        run: >\n          echo\n          vitest\n';
  assert.equal(runBody(folded, folded.indexOf('vitest')), 'echo vitest');
  // A literal block keeps the newlines, so its lines stay separate commands.
  // Leading indentation is left in place: it is whitespace to the shell, and
  // `invokes` treats the segment's head as command position either way.
  const literal = 'steps:\n      - name: x\n        run: |\n          echo\n          vitest run\n';
  assert.equal(runBody(literal, literal.indexOf('vitest')).trim(), 'vitest run');
  // A trailing backslash removes the newline, so the next line is an argument.
  const continued = 'steps:\n        run: |\n          echo ok \\\n          vitest run\n';
  assert.equal(runBody(continued, continued.indexOf('vitest')), 'echo ok  vitest run');
  // Launcher aliases are resolved from the import.
  assert.ok(launcherNames("import { spawnSync as launch } from 'node:child_process';").includes('launch'));
  assert.ok(launcherNames("const { spawn: go } = require('child_process');").includes('go'));
  assert.ok(!launcherNames("import { readFile as launch } from 'node:fs';").includes('launch'));

  // A workspace owns the manifest sitting in its own directory: pnpm resolves the
  // root package's `catalog:` there even though no `packages:` pattern names it.
  const workspaceFile = resolve(PUBLIC_ROOT, 'pnpm-workspace.yaml');
  assert.ok(installs(workspaceFile, resolve(PUBLIC_ROOT, 'package.json')), 'a workspace owns its root manifest');
  assert.ok(!installs(workspaceFile, resolve(PUBLIC_ROOT, '../package.json')), 'and nothing above it');
  const inline = '        run: vitest run\n';
  assert.equal(runBody(inline, inline.indexOf('vitest')), 'vitest run');
  // A flow mapping's value is cut at its own key, wherever that key sits, and
  // its YAML quotes are removed so the shell sees the command.
  const flow = '      - { name: x, run: "echo a,b && vitest run" }\n';
  assert.equal(runBody(flow, flow.indexOf('vitest')), 'echo a,b && vitest run');
  const flowPlain = '      - { run: vitest run }\n';
  assert.equal(runBody(flowPlain, flowPlain.indexOf('vitest')), 'vitest run');
  // A brace only opens a mapping when it precedes the `run` key; an expression
  // inside the command does not.
  const expression = '        run: vitest run --reporter=${{ env.R }}\n';
  assert.match(runBody(expression, expression.indexOf('vitest')), /^vitest run/u);
  // A quoted block scalar's quotes are YAML's too.
  const quoted = '      - run: "vitest run"\n';
  assert.equal(runBody(quoted, quoted.indexOf('vitest')), 'vitest run');
  // A double-quoted scalar honours escapes, so `\n` is a command separator.
  assert.equal(yamlScalar(String.raw`"echo ok\nvitest run"`), 'echo ok\nvitest run');
  // The hex and unicode forms decode to the same character, so they have to be
  // recognised too, or the scan and the split disagree.
  assert.equal(yamlScalar(String.raw`"echo ok\x0Avitest run"`), 'echo ok\nvitest run');
  assert.equal(yamlScalar(String.raw`"echo ok\u000Avitest run"`), 'echo ok\nvitest run');
  assert.equal(yamlScalar(String.raw`"echo ok\U0000000Avitest run"`), 'echo ok\nvitest run');
  // A tab is whitespace, not a separator: bash runs `echo ok<TAB>vitest run` as
  // one command, printing `ok vitest run`, so this is an argument.
  assert.equal(yamlScalar(String.raw`"echo ok\x09vitest run"`), 'echo ok\tvitest run');
  // An escaped backslash is not the start of an escape.
  assert.equal(yamlScalar(String.raw`"a\\nvitest"`), String.raw`a\nvitest`);
  // A single-quoted scalar is literal apart from a doubled quote.
  assert.equal(yamlScalar(String.raw`'echo ok\nvitest run'`), String.raw`echo ok\nvitest run`);
  assert.equal(yamlScalar("'it''s'"), "it's");
  // A more-indented folded line keeps its newline; a same-indent one folds to a
  // space.
  const deeper = 'x:\n        run: >\n          echo ok\n            vitest run\n';
  assert.match(runBody(deeper, deeper.indexOf('vitest')), /\n\s*vitest run$/u);
  const same = 'x:\n        run: >\n          echo\n          vitest\n';
  assert.equal(runBody(same, same.indexOf('vitest')), 'echo vitest');
  // An explicit indentation indicator states the base, so a deliberately deeper
  // first line does not become the baseline.
  const indicated = 'x:\n        run: >2\n           echo ok\n          vitest run\n';
  assert.match(runBody(indicated, indicated.indexOf('vitest')), /\nvitest run$/u);
  // The indicators may appear in either order.
  const chompFirst = 'x:\n        run: >-2\n           echo ok\n          vitest run\n';
  assert.match(runBody(chompFirst, chompFirst.indexOf('vitest')), /\nvitest run$/u);
  const indentFirst = 'x:\n        run: >2-\n           echo ok\n          vitest run\n';
  assert.match(runBody(indentFirst, indentFirst.indexOf('vitest')), /\nvitest run$/u);
  // A blank line inside a folded scalar folds to a newline, so what follows is a
  // second command rather than an argument.
  const blank = 'steps:\n        run: >\n          echo ok\n\n          vitest run\n';
  assert.match(runBody(blank, blank.indexOf('vitest')), /\n\s*vitest run$/u);
  // A regex literal is not a comment, and `//` inside a character class is
  // content. Division still is not a regex.
  assert.equal(withoutComment('console.log(/[//]/); x();', ['//']), 'console.log(/[//]/); x();');
  assert.equal(withoutComment('const r = /a\\/\\/b/; x();', ['//']), 'const r = /a\\/\\/b/; x();');
  assert.equal(withoutComment('const q = a / b; // note', ['//']), 'const q = a / b; ');
  assert.equal(withoutComment('x();// note', ['//']), 'x();');

  // Flow keys may be quoted, and dropping their characters named no key at all.
  assert.equal(lastFlowKey("{ 'run': vitest run"), 'run');
  assert.equal(lastFlowKey('{ "run": vitest run'), 'run');
  assert.equal(lastFlowKey("{ 'name': vitest, run: echo ok"), 'run');

  // Flow-mapping keys: a comma inside a quoted scalar is content, not the start
  // of the next key.
  assert.equal(lastFlowKey('{ run: "echo a,b && vitest run"'), 'run');
  assert.equal(lastFlowKey('{ run: echo ok, name: vitest'), 'name');
  assert.equal(lastFlowKey('{ name: x, run: vitest run'), 'run');
  assert.equal(lastFlowKey("{ run: 'a,b', name: vitest"), 'name');
  // A colon only separates a key when a plain scalar precedes it and a space
  // follows, so a URL or a flag value stays part of the run command.
  assert.equal(lastFlowKey('{ run: echo http://example.com && vitest run'), 'run');
  assert.equal(lastFlowKey('{ run: vitest run --reporter=x:y'), 'run');
  assert.equal(lastFlowKey('{ run: echo http://x.com, name: vitest'), 'name');
  // A GitHub expression opens and closes a nested pair inside the value, so the
  // mapping opener has to be found by depth rather than by the last brace.
  assert.equal(openFlowMapping('- { run: "echo ${{ github.actor }} && vitest run"'), 2);
  assert.equal(openFlowMapping('- { run: echo ok }'), -1);
  assert.equal(openFlowMapping('- name: x'), -1);

  // Section keys may carry a node property. `&unsafe overrides:` is still
  // `overrides` to pnpm, confirmed by installing one.
  for (const header of ['overrides:', "'overrides':", '&unsafe overrides:', '&a &b overrides:', '!!map overrides:']) {
    assert.notEqual(sectionHeader([header], 'overrides'), -1, `expected \`${header}\` to name the overrides section`);
  }
  for (const header of ['unrelated:', '  overrides:', 'overridesX:']) {
    assert.equal(sectionHeader([header], 'overrides'), -1, `expected \`${header}\` not to name the overrides section`);
  }

  // A delegation inside a wrapper body is still a delegation: judging the outer
  // segment re-expanded the body and matched under a lead without the switch.
  for (const command of ["sh -c 'pnpm --dir ../public exec vp test'", 'eval "pnpm -C ../public exec vp test"']) {
    assert.ok(
      !commandSegments(command).some((segment) => segmentInvokes(segment, 'vp') && !delegates(segment)),
      `expected \`${command}\` to stay delegated`,
    );
  }

  // Section style. A flow mapping is valid YAML this line reader cannot see, so
  // it has to fail rather than read as an empty section. A document-level flow
  // mapping hides every section at once and is rejected outright.
  assert.throws(() => assertBlockStyle("overrides: { vite: 'x' }\n", 'overrides'), /flow style/u);
  assert.throws(() => assertBlockStyle("catalog: {vite: 'x'}\n", 'catalog'), /flow style/u);
  assert.throws(
    () => assertBlockStyle("{ catalog: { vite: '^7.2.7' }, overrides: { vite: 'npm:react@19.0.0' } }\n", 'overrides'),
    /document-level flow mapping/u,
  );
  assert.throws(
    () => assertBlockStyle("# note\n\n{ overrides: { vite: 'x' } }\n", 'overrides'),
    /document-level flow mapping/u,
  );
  for (const yaml of ['overrides:\n  vite: ^7.2.7\n', 'overrides: # pinned\n  vite: ^7.2.7\n', 'catalog:\n']) {
    assert.doesNotThrow(() => assertBlockStyle(yaml, yaml.startsWith('catalog') ? 'catalog' : 'overrides'));
  }

  // Segment boundaries: a delegation in one command must not exempt the next.
  for (const command of [
    'pnpm --dir ../public exec vp test | vp test',
    'pnpm --dir ../public exec vp test\nvp test',
    'pnpm --dir ../public exec vp test && vp test',
    'pnpm --dir ../public exec vp test; vp test',
  ]) {
    assert.ok(
      commandSegments(command).some((segment) => segmentInvokes(segment, 'vp') && !delegates(segment)),
      `a local invocation after a separator must still be seen in \`${command.replace(/\n/gu, '\\n')}\``,
    );
  }

  // Registry ranges, recognised positively. A value that is not one of these is
  // not assumed to be stock Vite: a YAML alias carries no protocol either.
  for (const spec of ['^7.2.7', '~7.2.7', '7.2.7', '>=7.0.0', '7', '7.2.7-beta.1', '*', 'latest']) {
    assert.ok(isRegistryRange(spec), `expected \`${spec}\` to read as a registry range`);
  }
  for (const spec of [
    '*unsafe-vite',
    '*anchor',
    'npm:@voidzero-dev/vite-plus-core@0.2.7',
    'file:shared/common',
    'link:../common',
    'workspace:*',
    'catalog:',
    '../dummy',
  ]) {
    assert.ok(!isRegistryRange(spec), `expected \`${spec}\` not to read as a registry range`);
  }

  // Selector forms for overrides and catalogs, which redirect the same package.
  for (const key of ['vite', 'vite@7', 'vite@^7.2.7', 'vite@', 'some-pkg>vite', 'qar@1>vite', '@scope/x>vite']) {
    assert.ok(selects(key, 'vite'), `expected \`${key}\` to select vite`);
  }
  for (const key of ['vitest', 'vitest@3', 'vite-plus', 'vite-plus@0', 'rolldown-vite', 'vite>vitest']) {
    assert.ok(!selects(key, 'vite'), `expected \`${key}\` not to select vite`);
  }

  // Which override keys cover the catalog, and so decide whether it still needs
  // judging. Only a bare key does: a parent-scoped key governs one parent, and a
  // version-qualified key governs one version range, so neither can be shown to
  // cover whatever version the catalog resolves without semver this cannot load.
  const coversCatalog = (yaml) => overrideKeys(`overrides:\n${yaml}\n`, 'vite').some((key) => key === 'vite');
  assert.ok(coversCatalog("  vite: '^7.2.7'"), 'a bare key covers the catalog');
  assert.ok(!coversCatalog("  'vite@7': '^7.2.7'"), 'a version-qualified key covers only that range');
  assert.ok(!coversCatalog("  'vite@6': '^6.0.0'"), 'a key for another major covers nothing the catalog resolves');
  assert.ok(!coversCatalog("  'unrelated-parent>vite': '^7.2.7'"), 'a parent-scoped key covers only that parent');
  assert.ok(!coversCatalog("  other: '1.0.0'"), 'an unrelated key covers nothing here');

  // Scalars: quotes stripped, inline comments dropped, `#` inside quotes kept.
  assert.equal(scalar("'npm:rolldown-vite@7.3.1'"), 'npm:rolldown-vite@7.3.1');
  assert.equal(scalar('npm:rolldown-vite@7.3.1 # tracked in @superdoc/orbit#1147'), 'npm:rolldown-vite@7.3.1');
  assert.equal(scalar("'a#b' # comment"), 'a#b');
  assert.equal(scalar('^7.2.7'), '^7.2.7');
});

test('the vite override resolves to a package that ships the vite binary', () => {
  // `@voidzero-dev/vite-plus-core` publishes no `bin`. Overriding `vite` to it
  // removes the `vite` executable from every package in the workspace, which
  // broke roughly 38 browser jobs: the demo smoke-test webServer and the
  // behavior harnesses both shell out to `pnpm exec vite`. The previous
  // `npm:rolldown-vite@7.3.1` alias was safe only because rolldown-vite does
  // ship one, so this asserts the property rather than a package name.
  //
  // The `catalog:` entry may name the Vite+ core: that is opt-in and only
  // reaches packages that ask for it by declaring `vite-plus`. What the override
  // may not do is *defer* to that catalog entry, which is why this resolves the
  // indirection below rather than reading the override string literally.
  for (const [label, root] of Object.entries(WORKSPACES)) {
    const path = resolve(root, 'pnpm-workspace.yaml');
    if (!existsSync(path)) continue;
    const workspace = readFileSync(path, 'utf8');
    // Both sections are checked for readability up front, not only where this
    // run happens to consult them. A flow-style `catalog:` under a workspace-wide
    // override is unread today and would go unexamined the moment that override
    // changed, so the shape is rejected regardless of which branch needs it.
    assertBlockStyle(workspace, 'overrides');
    assertBlockStyle(workspace, 'catalog');
    // A workspace with no `overrides.vite` is not automatically exempt.
    // `superdoc/` has none, and its catalog is what feeds the `vite` binary to
    // the behavior and visual harnesses, so pointing that entry at the Vite+
    // core breaks them exactly as an override would.
    //
    // Where an override does apply workspace-wide, it wins: `superdoc/public`
    // carries the core in `catalog.vite` and stock Vite in `overrides.vite`, and
    // the nine packages that both run the binary and declare `vite: catalog:`
    // resolve to `vite@7.3.1`. Verified against the lockfile and by running
    // `pnpm exec vite --version` in one of them, so judging that catalog entry
    // would fail a working setup.
    //
    // A parent-scoped or version-qualified override does not win, though, and
    // treating any override as blanket coverage was wrong twice over. A harmless
    // `'unrelated-parent>vite': '^7.2.7'` suppressed the catalog check while
    // governing only that parent; so did `'vite@6': '^6.0.0'`, which cannot
    // affect the Vite 7 the catalog resolves. Both left a poisoned `catalog.vite`
    // unexamined.
    //
    // Only a bare `vite` key is judged as covering the catalog. Deciding whether
    // `vite@6` covers a given catalog version needs semver, and this runs before
    // `pnpm install`, so there is no matcher to reach for. Failing closed costs a
    // deliberate qualified override an explanation here; failing open costs the
    // executable.
    //
    // The catalog is only judged where something runs the binary. `superdoc/v2`
    // carries the core in its catalog on purpose and invokes `vite` nowhere, so
    // judging every catalog entry would fail that intended setup too.
    //
    // Every selector is judged, not just the first. `vite`, `vite@7`, `vite@`,
    // and `qar@1>vite` can all appear at once, and any one of them is enough to
    // redirect the name.
    const overrides = sectionEntries(workspace, 'overrides', 'vite');
    const governedWorkspaceWide = overrideKeys(workspace, 'vite').some((key) => key === 'vite');
    const specs = [
      ...overrides,
      ...(!governedWorkspaceWide && runsViteBinary(root) ? sectionEntries(workspace, 'catalog', 'vite') : []),
    ];
    for (const override of specs) {
      // `overrides.vite: 'catalog:'` defers to the catalog, so reading the literal
      // string is not enough: the catalog entry is allowed to name the Vite+ core,
      // and deferring to it reintroduces the exact regression with this assertion
      // still green. Follow the indirection before judging it.
      const resolved = override === 'catalog:' ? (sectionEntry(workspace, 'catalog', 'vite') ?? override) : override;
      // Assert the property, not one package name. Blocklisting vite-plus-core let
      // any other bin-less alias through — `npm:react@19.0.0` passed — and the
      // failure is identical: no `vite` executable anywhere in the workspace.
      //
      // Judged by protocol rather than by the `npm:` form alone. Reading only
      // `npm:` aliases treated every other spec as stock Vite, so
      // `file:shared/common` passed while `@superdoc/common` ships no `bin` and
      // every `vite` script in the workspace would fail after install. The same
      // held for `link:`, `github:`, and `workspace:`.
      //
      // What survives is an allowlist rather than a blocklist, because "no
      // protocol" is not the same as "a version range". A YAML alias reaches here
      // as the literal `*anchor`, which carries no protocol and so was waved
      // through; pnpm resolves that anchor and applies whatever it points at.
      // Confirmed against pnpm 11.10.0: an anchored `npm:rolldown-vite@7.3.1`
      // lands in the lockfile as exactly that, so an anchor naming a bin-less
      // package removes the executable while this assertion stays green.
      //
      // So a value passes only if it is recognisably a registry range, or an
      // `npm:` alias onto a package known to ship the binary. Vite itself and
      // rolldown-vite are the only ones this repository has used that way.
      // Anything else — an alias, an unresolved reference, a protocol this cannot
      // inspect — fails here and has to be justified deliberately.
      const alias = /^npm:(?<package>.+?)@[^@]+$/u.exec(resolved)?.groups.package;
      const shipsBinary = isRegistryRange(resolved) || ['vite', 'rolldown-vite'].includes(alias);
      assert.ok(
        shipsBinary,
        `${label}pnpm-workspace.yaml overrides vite to ${resolved}` +
          (resolved === override ? '' : ' (via catalog:)') +
          ', which is not known to ship a `vite` binary. @voidzero-dev/vite-plus-core does ' +
          'not, and overriding to it stopped every `vite` script and Playwright webServer in the ' +
          'workspace from resolving. Packages that build through Vite+ take it from their own ' +
          '`vite-plus` dependency instead; if this spec really does ship the binary, add it here.',
      );
    }
  }

  // The same rule, one level down. A package can redirect `vite` for itself
  // without touching any workspace file, and every assertion above reads only
  // `pnpm-workspace.yaml`, so a manifest-level
  // `"vite": "npm:@voidzero-dev/vite-plus-core@0.2.7"` took the executable from
  // that package alone while all of them stayed green.
  //
  // Judged by the same allowlist, so the two levels cannot drift apart.
  // `catalog:` is fine here: it defers to the catalog entry the workspace loop
  // has already judged. A package that declares nothing takes whatever the
  // workspace resolves, which is likewise already covered.
  const offenders = [];
  for (const { path, spec } of viteConsumers(IN_ORBIT ? SUPERDOC_ROOT : PUBLIC_ROOT)) {
    if (spec === undefined || spec === 'catalog:') continue;
    const alias = /^npm:(?<package>.+?)@[^@]+$/u.exec(spec)?.groups.package;
    if (isRegistryRange(spec) || ['vite', 'rolldown-vite'].includes(alias)) continue;
    offenders.push(`${toRepositoryPath(relative(IN_ORBIT ? SUPERDOC_ROOT : PUBLIC_ROOT, path))} declares ${spec}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'these packages run the `vite` binary but declare a spec that is not known to ship one, so the ' +
      `executable is missing for them however the workspace resolves it: ${offenders.join(', ')}`,
  );
});

test('every package that runs vp declares vite-plus, in whichever workspace owns it', () => {
  // pnpm gives a script the binaries from its own package and its own workspace
  // root, not an unrelated nested one. `@superdoc/layout-tests` ran `vp test`
  // while declaring only Vitest, so it worked from `superdoc/public/` and failed
  // with `vp: not found` from `superdoc/`.
  //
  // A script that delegates to another directory is exempt: the binary resolves
  // from the directory it names, not from the calling package.
  const offenders = [];
  const unreadable = [];
  // Orbit owns v2 as well, so scan from `superdoc/` there and from the
  // checkout root in the public repository.
  const scanRoot = IN_ORBIT ? SUPERDOC_ROOT : PUBLIC_ROOT;
  for (const path of listManifests(scanRoot)) {
    const manifest = readManifest(path);
    if (!manifest) {
      // A format this cannot parse is reported, not skipped: a `package.yaml`
      // gaining a local `vp` script would otherwise pass unexamined.
      if (!path.endsWith('.json')) unreadable.push(toRepositoryPath(relative(scanRoot, path)));
      continue;
    }
    const scripts = Object.entries(manifest.scripts ?? {});
    // Judged per command, not per script. A delegation anywhere used to exempt
    // the whole thing, so `pnpm --dir ../foo run build && vp test` hid a local
    // invocation behind an unrelated one.
    const invokesLocally = scripts.some(([, command]) =>
      commandSegments(command).some((segment) => segmentInvokes(segment, 'vp') && !delegates(segment)),
    );
    if (!invokesLocally) continue;
    // Every field pnpm installs from, because every one of them puts the binary
    // on the script's PATH. `optionalDependencies` is installed like the others
    // and exposes `vp` just the same, so rejecting a package that declares it
    // there blocked a valid manifest. Verified with pnpm 11.10.0: an
    // optional-only dependency lands in `node_modules/.bin`.
    //
    // `peerDependencies` is deliberately absent: a peer is a requirement on the
    // consumer, not something this package installs.
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    }['vite-plus'];
    const relativePath = toRepositoryPath(relative(scanRoot, path));
    if (!declared) {
      offenders.push(relativePath);
      continue;
    }
    // Presence is not enough: the name has to resolve to something that ships
    // `vp`. `"vite-plus": "npm:react@19.0.0"` installs React under that
    // dependency name and exposes no executable, which is the same failure this
    // guard exists to catch, one level down. Judged by the same rule the `vite`
    // specs use — a registry range, or an alias onto the package itself.
    //
    // `catalog:` is followed rather than waved through. Every manifest here
    // declares it that way, so accepting it unconditionally meant a poisoned
    // `catalog.vite-plus` in `superdoc/v2` passed every one of them while pnpm
    // installed React under the name.
    //
    // Every owning root has to define it safely, because the install root
    // decides which catalog applies and this package is installed from more than
    // one.
    const shipsBinary = (value) =>
      isRegistryRange(value ?? '') || /^npm:(?<package>.+?)@[^@]+$/u.exec(value ?? '')?.groups.package === 'vite-plus';
    if (declared === 'catalog:') {
      for (const { workspace, entry } of catalogEntries(path, 'vite-plus')) {
        if (shipsBinary(entry)) continue;
        const where = toRepositoryPath(relative(scanRoot, workspace));
        offenders.push(`${relativePath} takes vite-plus from ${where}, which defines it as ${entry ?? 'nothing'}`);
      }
    } else if (!shipsBinary(declared)) {
      offenders.push(`${relativePath} declares vite-plus as ${declared}`);
    }
    // An override outranks the declaration entirely. pnpm's overrides replace
    // any dependency in the graph, so `overrides.vite-plus: npm:react@19.0.0`
    // installs React under the name however the package asks for it, and
    // checking only the declaration and its catalog approved that.
    //
    // An override may defer to the catalog with `catalog:`, which is a safe way
    // to write one. Judging that literal rejected every package in a valid
    // setup, so the indirection is followed here as it is for the declaration
    // and for the `vite` override.
    for (const { workspace, override } of overridesFor(path, 'vite-plus')) {
      const resolved =
        override === 'catalog:'
          ? (sectionEntry(readFileSync(workspace, 'utf8'), 'catalog', 'vite-plus') ?? override)
          : override;
      if (shipsBinary(resolved)) continue;
      const where = toRepositoryPath(relative(scanRoot, workspace));
      const source = resolved === override ? '' : ' via catalog:';
      offenders.push(`${relativePath} has vite-plus overridden to ${resolved}${source} by ${where}`);
    }
  }
  assert.deepEqual(
    unreadable,
    [],
    'these manifests are in a format this guard cannot parse, so their scripts were never checked. ' +
      `Convert them to package.json or extend this test to read them: ${unreadable.join(', ')}`,
  );
  assert.deepEqual(
    offenders,
    [],
    `these packages run \`vp\` but do not declare vite-plus, so their scripts fail from a workspace root ` +
      `that does not hoist it: ${offenders.join(', ')}`,
  );
});

test('the protected engine resolves the same vite-plus version from both owning workspaces', () => {
  if (!IN_ORBIT) return;

  const manifestPath = resolve(SUPERDOC_ROOT, 'v2/package.json');
  const versions = Object.values(WORKSPACES)
    .map((root) => resolve(root, 'pnpm-workspace.yaml'))
    .filter((workspace) => installs(workspace, manifestPath))
    .map((workspace) => ({
      workspace: toRepositoryPath(relative(SUPERDOC_ROOT, workspace)),
      version: sectionEntry(readFileSync(workspace, 'utf8'), 'catalog', 'vite-plus'),
    }));
  assert.ok(versions.length > 1, 'superdoc/v2 is no longer owned by overlapping workspaces');
  assert.equal(
    new Set(versions.map(({ version }) => version)).size,
    1,
    'installing superdoc/v2 from different workspace roots must not change the build tool that ' +
      `produces protected artifacts: ${versions.map(({ workspace, version }) => `${workspace}=${version}`).join(', ')}`,
  );
});

test('the JavaScript test entrypoints stay on vp rather than drifting back to vitest', () => {
  // `pnpm test` dispatched to `scripts/test.mjs`, which ran `pnpm exec vitest`,
  // so the primary gate never exercised the toolchain this migration is about.
  // The reviewer who caught it was right that a passing suite proved nothing
  // until the entrypoint itself moved.
  //
  // `package.json` is here because the dispatchers matter as much as their
  // targets: `"test": "vitest run"` bypasses `scripts/test.mjs` entirely, and
  // checking only the script it used to call left that wide open.
  //
  // A manifest is scanned as scripts rather than as text, though. `"vitest":
  // "catalog:"` is a dependency declaration, and reading the whole file reported
  // it as an invocation.
  const entrypoints = ['scripts/test.mjs', 'scripts/test-cov.mjs', 'scripts/oss-local-ci.mjs'];
  const missing = entrypoints.filter((entrypoint) => !existsSync(resolve(PUBLIC_ROOT, entrypoint)));
  assert.deepEqual(missing, [], `missing test entrypoints: ${missing.join(', ')}`);

  // The dispatchers, judged with the shared matcher rather than the prose rules
  // the text scan needs: a manifest has no labels or import specifiers, only
  // commands, so a `vitest` token in one is always an invocation.
  const manifest = readManifest(resolve(PUBLIC_ROOT, 'package.json'));
  const dispatchers = Object.entries(manifest?.scripts ?? {})
    .filter(([, command]) => commandSegments(command).some((segment) => segmentInvokes(segment, 'vitest')))
    .map(([name, command]) => `${name}: ${command}`);
  assert.deepEqual(
    dispatchers,
    [],
    'these package.json scripts invoke vitest directly, so `pnpm test` bypasses the toolchain no matter ' +
      `what the scripts they dispatch to do: ${dispatchers.join('; ')}`,
  );

  for (const relativePath of entrypoints) {
    const raw = readFileSync(resolve(PUBLIC_ROOT, relativePath), 'utf8');
    const source = withoutComments(raw, ['//']);
    // Match the token in a command position, not every mention of the word. An
    // earlier version recognised `pnpm ... exec vitest` and the literal
    // `'vitest', 'run'` and nothing else, so `run: vitest run`, `npx vitest run`,
    // `spawn('vitest', ['--run'])`, and the double-quoted array form all slipped
    // past a passing assertion.
    //
    // The token boundary is the shared one, so `vitest.config` and
    // `vitest/config` stay out while `./node_modules/.bin/vitest run` is seen.
    // What remains to filter here is context this file has that a package script
    // does not: import specifiers, and the step labels these files are made of.
    const invocation = new RegExp(binaryPattern('vitest').source, 'gu');
    const offenders = [...source.matchAll(invocation)]
      .filter((match) => {
        // Bounded to the current line. Reading 20 characters back crossed
        // newlines, so a multiline `run: |` block whose previous line ended in a
        // word ("echo setup") made the next line's real invocation look like
        // prose.
        const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
        const line = source.slice(lineStart, match.index);
        // An import specifier is a reference, not a call. Excluding any preceding
        // quote also dropped `spawn('vitest', ...)`, so this is narrow.
        if (/(?:from|import|require\()\s*['"]$|@$/u.test(line.slice(-20))) return false;
        // Prose is identified by the key it sits under, not by the shape of the
        // word before it. The previous rule read any preceding English word as
        // prose unless it was one of a handful of known runners, which meant the
        // exemption grew with the shell: `env vitest run` and `time vitest run`
        // both went unreported while executing Vitest directly. There is no
        // bounded list of wrappers to enumerate.
        //
        // The JavaScript entrypoints have no such marker: any line can be a
        // command there, so they keep the broader rule, minus the prose keys
        // their step tables use.
        // The JavaScript entrypoints have no `run:` marker, so the rule is what
        // makes a string *not* executable. A prose key's value and a logger's
        // argument are data; an argv element, a `spawn` argument, and a shell
        // command string passed to a helper are all real references. Judging by
        // the line's leading key alone reported
        // `console.log("vitest run is legacy documentation")`.
        // The JavaScript entrypoints have no `run:` marker, so the rule is what
        // makes a string executable. Listing what is *not* left every other
        // context defaulting to a reference, so an ordinary
        // `const example = "vitest run";` was reported. These three shapes are
        // what the real entrypoints use, and each is a launch or an argument to
        // one; anything else is inert data.
        //
        // The context ends at the *opening* quote of the string holding the
        // match, which is what a first attempt got wrong: patterns requiring a
        // closing quote could never match, and every launch form failed open.
        const openQuote = /['"`][^'"`]*$/u.exec(line);
        const context = openQuote ? line.slice(0, openQuote.index) : line;
        // A launcher's first argument. The name may be qualified by an object,
        // since `child_process` is often imported as a namespace, so excluding
        // every property access rejected `childProcess.spawnSync(...)`. Only the
        // launcher names match, which is what keeps `console.log(` out.
        const names = launcherNames(source).join('|');
        const launch = new RegExp(`(?<![\\w$])(?:[\\w$]+\\s*\\.\\s*)?(?:${names})\\s*\\(\\s*$`, 'u');
        // An argv element. An array literal counts only when the call that
        // opened it is a launcher: accepting every array made
        // `const examples = ["vitest run"];` an invocation. A later argument in a
        // call still counts, which covers `spawnSync(bin, ["run", "vitest"])`; a
        // bare `(` is excluded, since that is any single-argument call including
        // a logger.
        // An argv element is a command only when a delegating runner word
        // precedes it in the same array: `['exec', 'vitest', 'run']` runs vitest,
        // but `spawnSync("echo", ["vitest"])` passes it as data. Treating every
        // string in a launcher's array as executable reported that echo call.
        // The launcher's own first argument is covered by `launch` above.
        const runnerWord = '(?:exec|run|dlx|x|npx|env|time|nice|command|--)';
        const argv = new RegExp(
          `\\[\\s*(?:['"\`][^'"\`]*['"\`]\\s*,\\s*)*['"\`]${runnerWord}['"\`]\\s*,\\s*(?:['"\`][^'"\`]*['"\`]\\s*,\\s*)*$`,
          'u',
        );
        // A ternary picking the binary by platform, as `test-cov.mjs` does. The
        // condition is required, so an object or prose key's `:` does not match.
        const ternary = /\?\s*\S[^?]*:\s*$/u;
        // An assignment whose variable is later launched. Inert on its own, but
        // `const runner = "vitest"; spawnSync(runner, …)` does launch it, and
        // `test-cov.mjs` builds its binary this way. Only a name that appears as
        // a launcher's first argument somewhere in the file counts, so an
        // assignment nothing launches stays data.
        const assigned = /(?:const|let|var)\s+(?<name>[\w$]+)\s*=/u.exec(line);
        const launchedLater = assigned !== null && launchedNames(source).has(assigned.groups.name);
        return launch.test(context) || argv.test(context) || ternary.test(context) || launchedLater;
      })
      .map((match) => {
        const line = source.slice(0, match.index).split('\n').length;
        return { line, text: source.split('\n')[line - 1].trim() };
      });
    assert.deepEqual(
      offenders,
      [],
      `${relativePath} invokes vitest directly again (${offenders
        .map(({ line, text }) => `line ${line}: ${text}`)
        .join('; ')}); route it through \`vp test run\` so the primary gate exercises the toolchain ` +
        'rather than bypassing it',
    );
  }
});

test('the pnpm ownership contract still guards the toolchain', () => {
  // This file is a companion to that suite, not a replacement. Deleting the
  // toolchain assertions there while these pass would leave the peer exceptions
  // and the catalog wiring unguarded, so name them explicitly.
  const path = resolve(PUBLIC_ROOT, 'scripts/__tests__/pnpm-config-ownership.test.mjs');
  assert.ok(existsSync(path), 'the pnpm ownership contract is missing');
  const source = readFileSync(path, 'utf8');
  for (const name of [
    'the vite override stays a real Vite that still ships its binary',
    'the Vitest peer exception agrees across every workspace that pins one',
  ]) {
    assert.ok(source.includes(name), `the pnpm ownership contract no longer covers: ${name}`);
  }
});

test('the committed hook scripts parse and stay executable', () => {
  // Nothing in CI executes `.vite-hooks/`; these scripts only ever run on
  // developer machines, where a syntax error blocks every commit with no
  // hosted signal. `sh -n` is the whole check on purpose: the dual-topology
  // behavior (Orbit vs exported root) is a runtime property this structural
  // guard cannot see. The dispatcher runs them through `sh`, so a lost
  // executable bit only breaks direct invocation, but it is also how a
  // copy-through-a-non-preserving-filesystem regression first shows up.
  const hooksDir = join(PUBLIC_ROOT, '.vite-hooks');
  const hooks = readdirSync(hooksDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile(),
  );
  assert.ok(hooks.length > 0, 'no committed hook scripts found in .vite-hooks');
  for (const hook of hooks) {
    const hookPath = join(hooksDir, hook.name);
    execFileSync('sh', ['-n', hookPath]);
    const mode = statSync(hookPath).mode;
    assert.ok(mode & 0o111, `.vite-hooks/${hook.name} lost its executable bit`);
  }
});
