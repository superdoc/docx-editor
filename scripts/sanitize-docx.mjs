#!/usr/bin/env node
/**
 * Rewrite a .docx fixture with synthetic identity metadata.
 *
 * Replaces `dc:creator`, `cp:lastModifiedBy`, `<Company>`, `<Manager>`, and
 * every comment/tracked-change author and people-catalog account identifier
 * with an approved synthetic identity, and clears free-text properties that
 * tend to carry document-management IDs (title, subject, keywords,
 * description).
 *
 * What it changes:
 * ----------------
 * Document properties, revision and comment identities across every
 * `word/*.xml` part (including people-catalog account IDs), document-management
 * custom properties, `customXml` parts that name an outside organization, and
 * template/matter stamps printed into visible header and footer text.
 *
 * What it deliberately does NOT do:
 * ---------------------------------
 * It does not rewrite substantive body content. Text edits are confined to
 * document-management stamps matched by an explicit pattern; a fixture whose
 * actual prose is confidential cannot be made safe by this script, and should
 * be replaced with a synthetic document or moved out of the public tree. The
 * privacy gate keeps failing on anything it cannot mechanically clean.
 *
 * Tracked-change author names are rewritten but their `w:id`, dates, and
 * revision structure are preserved, so diff and accept/reject tests keep
 * asserting on the same document semantics.
 *
 * Usage:
 *   node scripts/sanitize-docx.mjs <file.docx> [more.docx ...]
 *   node scripts/sanitize-docx.mjs --all      # every tracked fixture
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeXmlPart,
  attributeValueOf,
  decodeXmlEntities,
  encodeXmlText,
  elementEndSource,
  elementNameSource,
  emptyElementPattern,
  encodeXmlPart,
  isEncryptedDocx,
  isGenericContentTypeName,
  isReportableCustomProperty,
  organizationReceivers,
  relationshipTargetProblem,
  RELATIONSHIPS_PART,
  TEXT_ELEMENTS,
  VISIBLE_TEXT_PARTS,
  pairedElementPattern,
  isStandardsNamespace,
  contentTypeNames,
  readZipEntries,
  writeZipEntries,
} from './lib/docx-privacy.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SYNTHETIC_AUTHOR = 'SuperDoc Test User';
const SYNTHETIC_COMPANY = 'SuperDoc';
const SYNTHETIC_USER_ID = 'S::reviewer@example.com::00000000-0000-0000-0000-000000000000';
// Ends on a letter, not a digit. A stamp ending in `1.0` merges with an
// adjacent run holding a page number (`…1.0` + `63` reads as `1.063`) and the
// gate then reports a stamp the sanitizer just wrote.
const SYNTHETIC_STAMP = 'SUPERDOC-TEST VERSION 1.0a';
// RFC 2606 reserved, so it can never belong to anyone. The relationship is
// retargeted rather than deleted: dropping it would leave the `r:id` in the
// document body pointing at nothing, which is a broken package rather than a
// clean one.
const SYNTHETIC_HYPERLINK = 'https://example.com/';

/**
 * Document-management stamps rendered into visible body text. Kept in sync
 * with the same pattern in lib/docx-privacy.mjs, which is what fails the gate.
 */
const DOCUMENT_STAMP_PATTERN =
  /\b[A-Z][A-Z0-9]{2,}(?:[-_][A-Z0-9]+){1,4}\s+(?:VERSION|VER|V)\s*[\d.]+[a-z]?\b|\b(?:DMS|NRPORTBL|IMANAGE|EDOCS)[-_ ]?\d{4,}\b/g;

/** Element text replacements applied to docProps parts. */
const ELEMENT_RULES = [
  { part: 'docProps/core.xml', tag: 'dc:creator', value: SYNTHETIC_AUTHOR },
  { part: 'docProps/core.xml', tag: 'cp:lastModifiedBy', value: SYNTHETIC_AUTHOR },
  { part: 'docProps/core.xml', tag: 'dc:title', value: '' },
  { part: 'docProps/core.xml', tag: 'dc:subject', value: '' },
  { part: 'docProps/core.xml', tag: 'cp:keywords', value: '' },
  { part: 'docProps/core.xml', tag: 'dc:description', value: '' },
  { part: 'docProps/app.xml', tag: 'Company', value: SYNTHETIC_COMPANY },
  { part: 'docProps/app.xml', tag: 'Manager', value: '' },
  // A base URL for every relative hyperlink in the document. It names an
  // organization's server as plainly as Company does, and nothing read it
  // before. Cleared rather than retargeted: an absent base is the default.
  //
  // Only when the gate would reject it. Clearing a reviewed base rewrites a
  // clean fixture and changes where its relative hyperlinks resolve.
  { part: 'docProps/app.xml', tag: 'HyperlinkBase', value: '', when: (current) => Boolean(relationshipTargetProblem(current)) },
  // Word's default, so the cleaned document claims no particular house style.
  { part: 'docProps/app.xml', tag: 'Template', value: 'Normal.dotm' },
];

/** The text of an element, for rules that only apply to some values. */
function textOfElement(xml, tag) {
  const localName = tag.includes(':') ? tag.split(':').pop() : tag;
  const match = pairedElementPattern(localName, 'i').exec(xml);
  return match ? match[2].trim() : '';
}

function replaceElementText(xml, tag, value) {
  // Match on the local name with any prefix, mirroring the inspector: a
  // document may bind Dublin Core to `d:` and the gate reports it either way,
  // so the sanitizer has to be able to rewrite it either way.
  const localName = tag.includes(':') ? tag.split(':').pop() : tag;
  const paired = pairedElementPattern(localName);
  if (paired.test(xml)) {
    return xml.replace(paired, `$1${value}$3`);
  }
  // Self-closing elements carry no text, so there is nothing to redact.
  return xml;
}

function replaceIdentityAttributes(xml) {
  // Both quote forms, matching the gate: XML permits w:author='…' as readily as
  // w:author="…", and the quote style must not decide whether a name is
  // scrubbed. The original delimiter is captured and replayed, so the rewrite
  // does not change the document's quoting style.
  // The character class excludes only the captured delimiter, so an apostrophe
  // inside a double-quoted value (`w:author="O'Connor"`) still matches. Excluding
  // both quote characters left exactly that common surname unscrubbed.
  // Whitespace around the `=` is valid XML and names the same attribute, so it
  // must not decide whether the value is scrubbed. The spacing is captured in
  // the prefix and replayed, leaving the document's own formatting intact.
  // Anchored inside a start tag. `w:author="…"` can also appear in visible body
  // text — a code sample or OOXML prose in a fixture — and rewriting that
  // changes the document's content rather than its metadata.
  const attributePattern = (attribute) =>
    new RegExp(`(<[A-Za-z_](?:[^>"']|"[^"]*"|'[^']*')*?\\s${attribute}\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, 'g');
  const rewrite = (value) => (match, prefix, double) => {
    const quote = double === undefined ? "'" : '"';
    return `${prefix}${quote}${value}${quote}`;
  };
  return xml
    .replace(attributePattern('[A-Za-z0-9_.-]+:author'), rewrite(SYNTHETIC_AUTHOR))
    .replace(attributePattern('[A-Za-z0-9_.-]+:initials'), rewrite('ST'))
    .replace(attributePattern('[A-Za-z0-9_.-]+:userId'), rewrite(SYNTHETIC_USER_ID));
}

/**
 * @param {Buffer} buffer
 * @returns {{ buffer: Buffer, changed: boolean }}
 */
export function sanitizeDocxBuffer(buffer) {
  if (isEncryptedDocx(buffer)) {
    return { buffer, changed: false };
  }
  const entries = readZipEntries(buffer);
  let changed = false;

  for (const { part, tag, value, when } of ELEMENT_RULES) {
    if (!entries.has(part)) continue;
    const original = decodeXmlPart(entries.get(part));
    if (when && !when(textOfElement(original, tag))) continue;
    const updated = replaceElementText(original, tag, value);
    if (updated !== original) {
      entries.set(part, encodeXmlPart(updated));
      changed = true;
    }
  }

  for (const [name, content] of entries) {
    if (!/^word\/.*\.xml$/i.test(name)) continue;
    const original = decodeXmlPart(content);
    // The guard has to admit everything the rewrite handles. Testing only for
    // `author=` skipped any part carrying reviewer initials alone, and testing
    // for a bare `=` skipped the spaced spelling the rewrite now accepts, so in
    // both cases the part was written back untouched.
    if (!/\s[A-Za-z0-9_.-]+:(?:author|initials|userId)\s*=\s*["']/.test(original)) continue;
    const updated = replaceIdentityAttributes(original);
    if (updated !== original) {
      entries.set(name, encodeXmlPart(updated));
      changed = true;
    }
  }

  if (entries.has('docProps/custom.xml')) {
    const original = decodeXmlPart(entries.get('docProps/custom.xml'));
    const updated = dropDmsProperties(original);
    if (updated !== original) {
      entries.set('docProps/custom.xml', encodeXmlPart(updated));
      changed = true;
    }
  }

  if (dropOrgCustomXml(entries)) {
    changed = true;
  }

  if (redactDocumentStamps(entries)) {
    changed = true;
  }

  if (retargetExternalRelationships(entries)) {
    changed = true;
  }

  return { buffer: changed ? writeZipEntries(entries) : buffer, changed };
}

/**
 * Point unreviewed external relationships at a reserved address.
 *
 * The relationship element is kept and only its `Target` is rewritten, so the
 * `r:id` referenced from the document body still resolves. Deleting it would
 * trade a privacy finding for a broken package.
 *
 * @param {Map<string, Buffer>} entries
 * @returns {boolean} whether anything was rewritten
 */
function retargetExternalRelationships(entries) {
  let changed = false;
  for (const [name, content] of entries) {
    if (!RELATIONSHIPS_PART.test(name)) continue;
    const original = decodeXmlPart(content);
    const updated = original.replace(emptyElementPattern('Relationship'), (element) => {
      // Delimiters located in the raw element and only the value decoded, as in
      // the inspector: decoding first lets an encoded quote truncate the value.
      if (!attributeValueOf(element, 'TargetMode').match(/^External$/i)) return element;
      const value = attributeValueOf(element, 'Target');
      if (!relationshipTargetProblem(value)) return element;
      return element.replace(/(Target\s*=\s*)(?:"[^"]*"|'[^']*')/i, `$1"${SYNTHETIC_HYPERLINK}"`);
    });
    if (updated !== original) {
      entries.set(name, encodeXmlPart(updated));
      changed = true;
    }
  }
  return changed;
}

/**
 * Replace document-management stamps rendered into visible text.
 *
 * A firm's template or matter reference is printed in a footer as an ordinary
 * run, so it survives every property-level cleanup and shows on the page. The
 * run is rewritten in place, which keeps the paragraph, its formatting, and
 * every surrounding element intact: layout tests still see a footer with text,
 * just not somebody else's reference.
 *
 * @param {Map<string, Buffer>} entries
 * @returns {boolean} whether anything was rewritten
 */
function redactDocumentStamps(entries) {
  let changed = false;
  for (const [name, content] of entries) {
    if (!VISIBLE_TEXT_PARTS.test(name)) continue;
    const original = decodeXmlPart(content);

    // Collect the <w:t> nodes and match the stamp against their concatenation,
    // because Word splits one visible identifier across runs: `MCL-OFFICE` and
    // `-03 VERSION 1.8a` are two nodes and neither matches on its own. The gate
    // reads the same concatenation, so redacting per node would leave it
    // failing on a document the sanitizer claims to have cleaned.
    // Every text-bearing run element, not just `w:t`. The gate reads visible
    // text by stripping tags, so it sees a stamp wherever WordprocessingML
    // stores it — a tracked deletion in `w:delText`, a field result in
    // `w:instrText` — and collecting only `w:t` here reported such a fixture
    // and then left it unchanged, which no cleanup command could resolve.
    const nodes = TEXT_ELEMENTS
      .flatMap((localName) => [...original.matchAll(pairedElementPattern(localName))])
      .sort((left, right) => left.index - right.index);
    if (nodes.length === 0) continue;

    // Two readings, matching the gate. Concatenated run text catches a stamp
    // Word split mid-identifier; space-joined run text catches one split across
    // paragraphs, where the gate sees a space that the concatenation does not.
    // Redacting only the first left the gate failing on stamps it could see.
    // Entities are resolved before a reader sees the text, so `ACME&#45;FILE`
    // is `ACME-FILE` on the page. Matching raw text made the encoding the gate,
    // and once the inspector decoded, it reported stamps this command could not
    // clear. A node whose decoded text differs is rewritten whole rather than
    // by offset, since decoded offsets do not map back onto the raw run.
    // Every offset below indexes DECODED text, and the rewrite re-encodes what
    // it keeps. Mixing the two — decoded offsets applied to the raw source —
    // split `&amp;` into `&a` and left fragments of the stamp behind.
    const decoded = nodes.map((node) => decodeXmlEntities(node[2]));
    const joined = decoded.join('');
    const spaced = decoded.join(' ');
    const spans = [];
    for (const match of joined.matchAll(DOCUMENT_STAMP_PATTERN)) {
      // Prefix, not equality, mirroring the inspector: an adjacent page-number
      // run truncates the match to `…VERSION 1.`, and rewriting that fragment
      // appends a second `0a` every time the sanitizer runs.
      const stamp = match[0].trim();
      if (stamp === SYNTHETIC_STAMP || SYNTHETIC_STAMP.startsWith(stamp)) continue;
      spans.push([match.index, match.index + match[0].length]);
    }
    // Map a spaced-reading hit back onto concatenated offsets: each gap before
    // node i contributes one extra character in `spaced`.
    for (const match of spaced.matchAll(DOCUMENT_STAMP_PATTERN)) {
      // Prefix, not equality, mirroring the inspector: an adjacent page-number
      // run truncates the match to `…VERSION 1.`, and rewriting that fragment
      // appends a second `0a` every time the sanitizer runs.
      const stamp = match[0].trim();
      if (stamp === SYNTHETIC_STAMP || SYNTHETIC_STAMP.startsWith(stamp)) continue;
      const gapsBefore = (position) => {
        let consumed = 0;
        for (let index = 0; index < nodes.length; index += 1) {
          consumed += decoded[index].length + (index > 0 ? 1 : 0);
          if (consumed > position) return index;
        }
        return Math.max(0, nodes.length - 1);
      };
      const start = match.index - gapsBefore(match.index);
      const end = match.index + match[0].length - gapsBefore(match.index + match[0].length);
      if (!spans.some(([a, b]) => a === start && b === end)) spans.push([start, end]);
    }
    if (spans.length === 0) continue;
    spans.sort((a, b) => a[0] - b[0]);
    // Coalesce, not just deduplicate. The two readings can describe the same
    // stamp with boundaries one character apart, and applying both leaves the
    // odd character behind as a fragment of the original.
    const merged = [];
    for (const [start, end] of spans) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    spans.length = 0;
    spans.push(...merged);

    // Rewrite node by node: the first node overlapping a stamp receives the
    // replacement, later overlapping nodes lose their overlapping characters.
    // Run boundaries and every other element stay exactly where they were.
    let cursor = 0;
    let updated = original;
    const replacements = [];
    for (const [nodeIndex, node] of nodes.entries()) {
      const value = decoded[nodeIndex];
      const start = cursor;
      const end = cursor + value.length;
      cursor = end;
      let text = '';
      let position = start;
      let emitted = false;
      for (const [spanStart, spanEnd] of spans) {
        if (spanEnd <= start || spanStart >= end) continue;
        text += value.slice(position - start, Math.max(0, spanStart - start));
        if (spanStart >= start && !emitted) {
          text += SYNTHETIC_STAMP;
          emitted = true;
        }
        position = Math.min(end, spanEnd);
      }
      if (position === start && !emitted) continue;
      text += value.slice(position - start);
      // Re-encoded, because the kept characters came from decoded text: an `&`
      // written back raw would be a malformed entity in the rewritten part.
      //
      // Except inside CDATA, where the payload is literal by definition and
      // escaping it turned `<![CDATA[…]]>` into visible `&lt;![CDATA[…]]&gt;`
      // text. The section is rewritten as a section instead.
      // Any CDATA in the node, not only a whole-node section: a mixed node
      // is rewritten as one section, which renders identically.
      const isCdata = node[2].includes('<![CDATA[');
      const written = isCdata ? `<![CDATA[${text.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>` : encodeXmlText(text);
      replacements.push([node.index, node[0].length, `${node[1]}${written}${node[3]}`]);
    }
    // Splice by offset. Searching for the node's own XML would rewrite the
    // first identical `<w:t>` in the part, which is a different node whenever a
    // document repeats a run: the wrong text is blanked and the real stamp
    // survives, so the sanitizer reports a change the gate still fails on.
    for (const [index, length, replacement] of replacements.slice().reverse()) {
      updated = updated.slice(0, index) + replacement + updated.slice(index + length);
    }

    if (updated !== original) {
      entries.set(name, encodeXmlPart(updated));
      changed = true;
    }
  }
  return changed;
}

/**
 * Remove `customXml` parts that name the originating organization (SharePoint
 * content types, contract-automation vocabularies).
 *
 * These parts are inert document-management baggage: nothing in the editor,
 * the diff engine, or any test reads them. They are dropped together with their
 * `itemProps`/`_rels` siblings and their `[Content_Types].xml` overrides and
 * document relationships, so the package stays internally consistent.
 *
 * @param {Map<string, Buffer>} entries
 * @returns {boolean} whether anything was removed
 */
function dropOrgCustomXml(entries) {
  const doomed = new Set();
  for (const [name, content] of entries) {
    // itemProps parts too, and both quote forms — matching the inspector,
    // which reports taxonomy in either. Anything it flags has to be removable.
    if (!/^customXml\/item(?:Props)?\d*\.xml$/i.test(name)) continue;
    const xml = decodeXmlPart(content);
    // The inspector's own pattern and classifier, so the two cannot drift on
    // prefix, quoting, whitespace or case. Anything it flags has to be
    // removable here, or the gate can never be satisfied; anything it approves
    // must survive, or this command deletes a store the gate called clean.
    const namesOrg =
      contentTypeNames(xml).some((value) => !isGenericContentTypeName(value)) ||
      // The inspector's own receiver parsing, which allows attributes and
      // trailing space on the tag. Matching only a bare `<Assembly>` here left
      // an attributed receiver reported and unremovable.
      organizationReceivers(xml).length > 0 ||
      // Decided by the inspector's own parser rather than a negative lookahead
      // over the URL text. A lookahead allows any host that merely starts with
      // an allowed name, so `schemas.microsoft.com.evil` read as allowed here
      // while the inspector's exact hostname check flagged it — leaving a
      // fixture the gate rejects and this command reports as unchanged.
      (decodeXmlEntities(xml).match(/https?:\/\/[^\s"'<>]+/gi) ?? []).some((url) => !isStandardsNamespace(url));
    if (!namesOrg) continue;
    // Drop the item and its props together, whichever one carried the taxonomy.
    const index = name.replace(/\.xml$/i, '').replace(/^customXml\/item(?:Props)?/i, '');
    doomed.add(name);
    doomed.add(`customXml/item${index}.xml`);
    doomed.add(`customXml/itemProps${index}.xml`);
    doomed.add(`customXml/_rels/item${index}.xml.rels`);
    // itemProps carries its own relationships file in a standard OPC layout.
    // Deleting the part it describes while leaving the .rels behind orphans a
    // relationships file against a part that no longer exists.
    doomed.add(`customXml/_rels/itemProps${index}.xml.rels`);
  }
  if (doomed.size === 0) return false;

  const removedIds = new Set();
  for (const name of doomed) entries.delete(name);

  // Drop the document relationships that pointed at the removed parts.
  // Every relationship part, not only the document's. A customXml store can be
  // linked from a header, a footer or a glossary, and deleting the part while
  // leaving that link makes the package point at a member that is gone.
  for (const relsName of [...entries.keys()].filter((name) => /(?:^|\/)_rels\/[^/]+\.rels$/i.test(name))) {
    const rels = decodeXmlPart(entries.get(relsName));
    // Matched by local name in either empty-element spelling, so a prefixed or
    // explicitly-closed relationship is dropped with the part it points at.
    const updated = rels.replace(emptyElementPattern('Relationship'), (element) => {
      // Both quote forms, and whitespace around the `=` as the content-type
      // override below already allows: dropping a part while leaving its
      // relationship makes the package invalid, and XML permits both
      // `Target='…'` and `Target = "…"` just as readily.
      // Decoded, because the value an OPC reader resolves is the decoded one:
      // `Target="../customXml/item&#49;.xml"` names `item1.xml`, and comparing
      // raw text left the relationship pointing at a part just deleted.
      const target = attributeValueOf(element, 'Target');
      const resolved = `customXml/${path.posix.basename(target)}`;
      if (!/customXml/i.test(target) || !doomed.has(resolved)) return element;
      const id = /Id="([^"]*)"/i.exec(element)?.[1];
      if (id) removedIds.add(id);
      return '';
    });
    entries.set(relsName, encodeXmlPart(updated));
  }

  // Drop the content-type overrides for the removed parts.
  if (entries.has('[Content_Types].xml')) {
    const types = decodeXmlPart(entries.get('[Content_Types].xml'));
    // Same matcher as the relationships above.
    const updated = types.replace(emptyElementPattern('Override'), (element) => {
      // Both quote forms and whitespace around the `=`, as elsewhere: missing
      // the override leaves the package pointing at a part that is gone.
      // Decoded, like the relationship targets: an OPC reader resolves the
      // reference before matching the part it names.
      const partName = attributeValueOf(element, 'PartName').replace(/^\//, '');
      return doomed.has(partName) ? '' : element;
    });
    entries.set('[Content_Types].xml', encodeXmlPart(updated));
  }

  return true;
}

/**
 * Remove `<property>` elements whose name matches a document-management system.
 * Remaining properties keep their original `pid` values; Word tolerates gaps in
 * the sequence, and renumbering would churn every fixture unnecessarily.
 *
 * @param {string} xml
 * @returns {string}
 */
function dropDmsProperties(xml) {
  return xml.replace(
    // Both quote forms, matching the inspector: it reports a single-quoted DMS
    // property, so the sanitizer has to be able to remove one.
    // Any namespace prefix, matching the inspector: it reports a prefixed
    // property, so the sanitizer has to be able to remove one.
    new RegExp(
      `<${elementNameSource('property')}\\b[^>]*\\bname\\s*=\\s*(?:"([^"]*)"|'([^']*)')[^>]*>[\\s\\S]*?${elementEndSource('property')}`,
      'gi',
    ),
    (element, doubleQuoted, singleQuoted) => {
      const name = (doubleQuoted ?? singleQuoted ?? '').trim();
      // Every property the gate reports, not only the DMS ones. The two lists
      // have to be the same list, or the gate flags fixtures this cannot fix.
      return isReportableCustomProperty(name) ? '' : element;
    },
  );
}

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

function main(argv) {
  const targets = argv.includes('--all')
    ? listTrackedDocx()
    : argv.filter((arg) => !arg.startsWith('-'));

  if (targets.length === 0) {
    console.error('Usage: node scripts/sanitize-docx.mjs <file.docx> [...] | --all');
    return 1;
  }

  let changedCount = 0;
  for (const target of targets) {
    const absolute = path.isAbsolute(target) ? target : path.join(REPO_ROOT, target);
    const { buffer, changed } = sanitizeDocxBuffer(readFileSync(absolute));
    if (changed) {
      writeFileSync(absolute, buffer);
      changedCount += 1;
      console.log(`sanitized ${target}`);
    }
  }
  console.log(`\n${changedCount} of ${targets.length} fixtures rewritten.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
