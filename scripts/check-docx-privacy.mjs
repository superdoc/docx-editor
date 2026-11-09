#!/usr/bin/env node
/**
 * DOCX fixture privacy gate.
 *
 * Every `.docx` in this repository is a ZIP archive, so the text-based export
 * scans never see inside one. Real documents carry the identity of whoever
 * authored them: `dc:creator`, `cp:lastModifiedBy`, `<Company>`, comment and
 * tracked-change authors, and SharePoint/DMS taxonomy in `customXml`. A fixture
 * copied from a real document publishes all of it.
 *
 * This gate unpacks each tracked fixture and fails on any identity that is not
 * an approved synthetic one.
 *
 * Why an allowlist of names rather than a denylist:
 * -------------------------------------------------
 * We cannot enumerate every real person who might ever author a fixture, but we
 * can enumerate the handful of synthetic identities tests are allowed to use.
 * Anything else is unreviewed by construction, which is the correct default for
 * a public repository.
 *
 * Run directly:
 *   node scripts/check-docx-privacy.mjs
 *   pnpm run check:docx-privacy
 *
 * To approve a new synthetic identity, add it to SYNTHETIC_IDENTITIES in lib/docx-privacy.mjs.
 * To sanitize an offending fixture in place, use scripts/sanitize-docx.mjs.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNTHETIC_IDENTITIES, inspectDocx } from './lib/docx-privacy.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Encrypted fixtures whose decrypted contents were inspected and found clean.
 *
 * An encrypted document is opaque to this gate, and encryption is not privacy
 * when the password lives in the test suite beside it. So the exception is not
 * "trust the ciphertext" — it records that somebody decrypted the file, read
 * the plaintext, and confirmed it carries no identity.
 *
 * Keyed by SHA-256 rather than by path: a path-only exception would keep
 * approving the file after its bytes change, which is exactly when it needs
 * looking at again. Replacing an exempted fixture fails the gate until someone
 * repeats the inspection and records the new hash.
 *
 * @type {Map<string, {path: string, reason: string}>}
 */
const REVIEWED_EXCEPTIONS = new Map([]);

function listTrackedDocx() {
  // `:(icase)` because git pathspecs are case-sensitive by default: a fixture
  // committed as Contract.DOCX would never be listed, and so would never be
  // scanned, which is a silent way past this gate rather than a loud one.
  const out = execFileSync('git', ['ls-files', '-z', '--', ':(icase)*.docx'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/**
 * Word writes a `~$name.docx` owner file next to an open document containing
 * the editor's name. It is never a fixture, so treat any tracked one as a
 * mistake rather than trying to inspect it.
 */
function isWordLockFile(relativePath) {
  return path.basename(relativePath).startsWith('~$');
}

function isApproved(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return true;
  return SYNTHETIC_IDENTITIES.has(trimmed);
}

function main() {
  const files = listTrackedDocx();
  const failures = [];

  for (const relativePath of files) {
    const absolutePath = path.join(REPO_ROOT, relativePath);

    if (isWordLockFile(relativePath)) {
      failures.push({
        file: relativePath,
        findings: [
          {
            kind: 'word-lock-file',
            detail: 'Word owner file (~$*.docx) carries the editor name and must not be committed.',
          },
        ],
      });
      continue;
    }

    let report;
    let bytes;
    try {
      bytes = readFileSync(absolutePath);
    } catch (error) {
      failures.push({
        file: relativePath,
        findings: [{ kind: 'unreadable', detail: error.message }],
      });
      continue;
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    if (REVIEWED_EXCEPTIONS.has(digest)) continue;

    try {
      report = inspectDocx(bytes);
    } catch (error) {
      failures.push({
        file: relativePath,
        findings: [{ kind: 'unreadable', detail: error.message }],
      });
      continue;
    }

    const findings = [];
    for (const { kind, value } of report.identities) {
      if (!isApproved(value)) {
        findings.push({ kind, detail: value });
      }
    }
    for (const detail of report.taxonomy) {
      findings.push({ kind: 'customXml-taxonomy', detail });
    }
    for (const detail of report.bodyStamps) {
      findings.push({ kind: 'document-stamp', detail });
    }
    for (const detail of report.relationships ?? []) {
      findings.push({ kind: 'external-relationship', detail });
    }
    if (report.encrypted) {
      // Ciphertext hides whatever metadata the plaintext carries, so a clean
      // report here proves nothing. Require an explicit reviewed decision.
      findings.push({
        kind: 'encrypted',
        detail: 'contents cannot be inspected; decrypt and review, or record a REVIEWED_EXCEPTIONS entry',
      });
    }
    if (findings.length > 0) {
      failures.push({ file: relativePath, findings });
    }
  }

  if (failures.length === 0) {
    console.log(`DOCX privacy gate: ${files.length} fixtures clean.`);
    return 0;
  }

  console.error(`DOCX privacy gate FAILED: ${failures.length} of ${files.length} fixtures carry unapproved metadata.\n`);
  for (const failure of failures) {
    console.error(`  ${failure.file}`);
    for (const finding of failure.findings) {
      console.error(`      ${finding.kind}: ${finding.detail}`);
    }
  }
  console.error(
    [
      '',
      'Fix by one of:',
      '  1. node scripts/sanitize-docx.mjs <file>   (strip identity metadata in place)',
      '  2. Replace the fixture with a synthetic equivalent.',
      '  3. Move an externally sourced document out of the public tree.',
      '',
      'Only add a REVIEWED_EXCEPTIONS entry when the metadata is provably synthetic',
      'or cleared for redistribution, and record why.',
    ].join('\n'),
  );
  return 1;
}

process.exit(main());
