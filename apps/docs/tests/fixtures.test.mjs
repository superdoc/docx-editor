// Fixtures ship in the public documentation site, so they must not carry
// human-identifying metadata, or review markup a reader could mistake for
// their own edit. These assertions are the contract that keeps that true.
// Word's own machine metadata is out of scope and documented in README.md.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import JSZip from 'jszip';

const FIXTURES = new URL('../public/fixtures/', import.meta.url);

test('the collaboration sample is a compact, metadata-free delivery agreement', async () => {
  const { bytes, document, core, app, comments } = await openFixture('collaboration-sample.docx');
  const example = await readFile(new URL('../../../examples/collaboration/public/sample.docx', import.meta.url));
  assert.deepEqual(bytes, example);
  assert.match(document, /Delivery is due Monday\./);
  assert.match(document, /Alex and Sam will confirm the final date\./);
  assert.match(document, /w:pgSz w:w="5760" w:h="4320"/);
  assert.equal(core, '');
  assert.equal(app, '');
  assert.equal(comments, '');
});

async function openFixture(name) {
  const bytes = await readFile(new URL(name, FIXTURES));
  const zip = await JSZip.loadAsync(bytes);
  const read = async (entry) => (zip.file(entry) ? zip.file(entry).async('string') : '');
  return {
    bytes,
    zip,
    contentTypes: await read('[Content_Types].xml'),
    document: await read('word/document.xml'),
    documentRels: await read('word/_rels/document.xml.rels'),
    styles: await read('word/styles.xml'),
    comments: await read('word/comments.xml'),
    core: await read('docProps/core.xml'),
    app: await read('docProps/app.xml'),
  };
}

/**
 * Author fields must be empty, not a placeholder. `tests/content.test.mjs`
 * owns that rule for every fixture; this asserts the specific upstream
 * identifiers that were present in the source document, so a regenerated
 * fixture can never reintroduce them.
 */
const FORBIDDEN_IDENTIFIERS = ['Andrii', 'Orlov', 'python-docx'];

test('the sample NDA carries no upstream author metadata', async () => {
  const { core, app } = await openFixture('sample-nda.docx');

  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    assert.ok(!core.includes(identifier), `core.xml must not contain "${identifier}"`);
    assert.ok(!app.includes(identifier), `app.xml must not contain "${identifier}"`);
  }
});

/**
 * Every WordprocessingML element that carries review state. Kept as one list
 * so the gate cannot drift narrower than the generator that produces the
 * fixture: both must cover the same forms.
 */
const REVISION_ELEMENTS = [
  'w:ins',
  'w:del',
  'w:moveFrom',
  'w:moveTo',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
  'w:rPrChange',
  'w:pPrChange',
  'w:tblPrChange',
  'w:trPrChange',
  'w:tcPrChange',
  'w:sectPrChange',
  'w:numberingChange',
  'w:cellIns',
  'w:cellDel',
  'w:cellMerge',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:commentReference',
];

test('the sample NDA has no tracked changes or comments in any part', async () => {
  const { zip } = await openFixture('sample-nda.docx');

  // Scan every Word XML part, not just the body: a header, footer, or note
  // could otherwise carry review markup past this gate.
  const wordParts = Object.keys(zip.files).filter((name) => name.startsWith('word/') && name.endsWith('.xml'));
  assert.ok(wordParts.length > 0, 'expected the package to contain Word XML parts');

  for (const part of wordParts) {
    const xml = await zip.file(part).async('string');
    for (const element of REVISION_ELEMENTS) {
      assert.ok(!new RegExp(`<${element}\\b`).test(xml), `${part} must not contain <${element}>`);
    }
  }

  // Comment bodies and reviewer identities live in dedicated parts, so their
  // absence is a separate guarantee from the markup scan above.
  for (const part of [
    'word/comments.xml',
    'word/commentsExtended.xml',
    'word/commentsIds.xml',
    'word/commentsExtensible.xml',
    'word/people.xml',
  ]) {
    assert.equal(zip.file(part), null, `must not ship ${part}`);
  }
});

/**
 * Name of the first entry in the archive, read from the ZIP bytes rather than
 * from a library's file map. Word expects `[Content_Types].xml` to come first
 * physically, and an in-memory map's iteration order is not a guarantee of
 * that, however closely the two happen to agree today.
 */
function firstArchiveEntry(bytes) {
  const LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const offset = bytes.indexOf(LOCAL_HEADER);

  assert.notEqual(offset, -1, 'expected a ZIP local file header');

  const nameLength = bytes.readUInt16LE(offset + 26);
  return bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
}

test('the sample NDA is a valid DOCX package with real content', async () => {
  const { zip, document, bytes } = await openFixture('sample-nda.docx');

  // OPC requires the content-type map, and Word expects it first in the archive.
  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.ok(zip.file('word/document.xml'), 'must contain a main document part');

  // Structure the quickstart relies on to demonstrate DOCX fidelity:
  // real Word styles rather than inline formatting.
  assert.match(document, /NON-DISCLOSURE AGREEMENT/);
  assert.ok(/w:val="Heading1"/.test(document), 'must use a Heading 1 style');
  assert.ok(/w:val="Heading2"/.test(document), 'must use a Heading 2 style');
  assert.ok(/w:val="ListBullet"/.test(document), 'must contain a bulleted list');
});

test('the getting-started fixture is clean and uses real document structure', async () => {
  const { zip, document, core, app, bytes } = await openFixture('getting-started.docx');
  const versionHistory = await readFile(new URL('../../../examples/version-history/public/sample.docx', import.meta.url));
  assert.deepEqual(bytes, versionHistory, 'version history continues with the Quickstart document');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.ok(zip.file('word/styles.xml'), 'must contain Word styles');
  assert.ok(zip.file('word/numbering.xml'), 'must contain real list numbering');
  assert.match(document, /Statement of Work/);
  assert.match(document, /September 1, 2026/);
  assert.match(document, /Meridian Consulting LLC/);
  assert.match(document, /Aurora Systems, Inc\./);
  assert.ok(/w:val="Title"/.test(document), 'must use a Title style');
  assert.ok(/w:val="Heading1"/.test(document), 'must use a Heading 1 style');
  assert.ok(/w:val="ListBullet"/.test(document), 'must use a bulleted list style');
  assert.equal(document.match(/<w:tbl>/g)?.length, 2, 'must contain milestone and signature tables');
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);

  for (const element of REVISION_ELEMENTS) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
  assert.equal(zip.file('word/comments.xml'), null, 'must not ship comments');
});

test('the tracked-changes fixture keeps its tracked change', async () => {
  // The review documentation depends on this fixture having a suggestion.
  // Guard it so fixture cleanup never silently empties the review guide.
  const { document } = await openFixture('tracked-changes.docx');
  assert.ok(/<w:ins\b/.test(document), 'tracked-changes.docx must retain its tracked insertion');
});

test('basic review keeps one proposal and matches the runnable example', async () => {
  const { bytes, document, comments, core } = await openFixture('basic-review.docx');
  assert.deepEqual(bytes, await readFile(new URL('../../../examples/document-modes/public/basic-review.docx', import.meta.url)));
  const text = [...document.matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');
  assert.ok(text.length < 250);
  assert.equal(document.match(/<w:ins\b/g)?.length, 1);
  assert.match(document, /installation and/);
  assert.match(document, /Payment is due within 30 days/);
  assert.match(document, /Support lasts for one year/);
  assert.equal(comments, '');
  assert.equal(core, '');
});

test('the tracked-review fixture keeps one focused replacement', async () => {
  const { bytes, document, core, app } = await openFixture('tracked-review.docx');
  const visibleText = [...document.matchAll(/<w:(t|delText)\b[^>]*>(.*?)<\/w:\1>/g)]
    .map((match) => match[2])
    .join(' ');

  assert.ok(visibleText.length < 200, `tracked-review.docx must stay short, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.equal(document.match(/<w:ins\b/g)?.length, 1, 'must contain one tracked insertion');
  assert.equal(document.match(/<w:del\b/g)?.length, 1, 'must contain one tracked deletion');
  assert.match(document, /<w:delText[^>]*>30<\/w:delText>/);
  assert.match(document, /<w:t[^>]*>60<\/w:t>/);
  assert.match(document, /w:author="Alex Rivera"/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(app, /<Company><\/Company>/);
});

test('the service-agreement template keeps its field map and matches the runnable example', async () => {
  const { bytes, document, core, app } = await openFixture('service-agreement-template.docx');
  const example = await readFile(
    new URL('../../../examples/content-controls/public/service-agreement-template.docx', import.meta.url),
  );

  assert.deepEqual(bytes, example);
  assert.equal(document.match(/<w:tag w:val="client\.legalName"\/>/g)?.length, 3);
  assert.equal(document.match(/<w:tag w:val="agreement\.effectiveDate"\/>/g)?.length, 2);
  assert.match(document, /<w:tag w:val="client\.address"\/>/);
  assert.match(document, /<w:tag w:val="agreement\.autoRenew"\/>/);
  assert.match(document, /<w14:checkbox>/);
  assert.match(document, /<w14:checked w14:val="0"\/>/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);
});

test('the authoring draft stays untagged and matches the runnable example', async () => {
  const { bytes, document } = await openFixture('service-agreement-draft.docx');
  const example = await readFile(
    new URL('../../../examples/content-controls/public/service-agreement-draft.docx', import.meta.url),
  );
  assert.deepEqual(bytes, example);
  assert.doesNotMatch(document, /<(?:w:sdt|w:ins|w:del|w:commentReference)\b/);
  assert.match(document, /Acme Products, Inc\./);
  const paragraphs = [...document.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(([xml]) => xml);
  const heading = paragraphs.findIndex((xml) => xml.includes('4. Confidentiality'));
  assert.ok(heading >= 0, 'the block-field instruction needs its Confidentiality heading');
  assert.ok(paragraphs[heading + 1], 'the heading must be followed by an empty insertion paragraph');
  assert.doesNotMatch(paragraphs[heading + 1], /<w:t\b|<w:drawing\b/);
});

test('the clause-library fixture keeps one block-level replacement slot', async () => {
  const { document, core, app } = await openFixture('clause-library-sample.docx');
  const compact = document.replaceAll(/>\s+</g, '><');

  assert.equal(document.match(/<w:sdt>/g)?.length, 1);
  assert.equal(document.match(/<w:tag\b/g)?.length, 1);
  assert.match(document, /<w:alias w:val="Confidentiality clause"\/>/);
  assert.match(document, /<w:tag w:val="agreement\.confidentiality"\/>/);
  assert.match(document, /<w:id w:val="2601"\/>/);
  assert.match(compact, /<\/w:p><w:sdt><w:sdtPr>/);
  assert.match(compact, /<\/w:sdtPr><w:sdtContent><w:p>/);
  assert.doesNotMatch(document, /<w:text\/>/);
  assert.doesNotMatch(document, /<(?:w:ins|w:del|w:commentReference)\b/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);
});

/**
 * The custom UI overview's fixture exists to be short. If it grows into another
 * contract, the page's one instruction — select a sentence, press Bold — ends up
 * below the fold, which is the problem it was made to solve.
 */
test('the formatting fixture stays short, clean, and free of review markup', async () => {
  const { bytes, document } = await openFixture('formatting-sample.docx');

  // Assert on visible text, not bytes. DEFLATE compresses repetition away, so
  // 4,800 characters of padding moved the packaged size by 39 bytes — a size
  // ceiling would have let this document grow to any length a reader has to
  // scroll through.
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');
  assert.ok(visibleText.length < 500, `formatting-sample.docx must stay short, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);

  const paragraphs = document.match(/<w:p>/g) ?? [];
  assert.ok(paragraphs.length <= 5, `must stay a handful of paragraphs, got ${paragraphs.length}`);

  for (const element of ['w:ins', 'w:del', 'w:commentReference']) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }

  // The sentence the page tells the reader to select has to actually be there.
  assert.match(document, /Select this sentence and press the Bold button above\./);
});

test('the document modes fixture keeps its comparison target visible and clean', async () => {
  const { bytes, document } = await openFixture('document-modes.docx');
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');

  assert.ok(visibleText.length < 200, `document-modes.docx must stay short, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.match(document, /Either party may end this agreement by giving 30 days’ written notice\./);

  for (const element of ['w:ins', 'w:del', 'w:commentReference']) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});

test('the comments fixture keeps one focused review thread', async () => {
  const { bytes, contentTypes, document, documentRels, comments, core } =
    await openFixture('comments-sample.docx');
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');

  assert.ok(visibleText.length < 200, `comments-sample.docx must stay short, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.match(document, /<w:commentRangeStart w:id="0"\/>/);
  assert.match(document, /<w:commentRangeEnd w:id="0"\/>/);
  assert.match(document, /<w:commentReference w:id="0"\/>/);
  assert.match(document, /September 30, 2026/);
  assert.match(comments, /<w:comment w:id="0"/);
  assert.match(comments, /Does this match the signed schedule\?/);
  assert.match(comments, /xmlns:w14="http:\/\/schemas\.microsoft\.com\/office\/word\/2010\/wordml"/);
  assert.match(comments, /<w:p w14:paraId="[0-9A-F]{8}">/);
  assert.match(comments, /w:author="SuperDoc Test User" w:initials="ST"/);
  assert.match(
    contentTypes,
    /PartName="\/word\/comments\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.comments\+xml"/,
  );
  assert.match(
    documentRels,
    /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/comments" Target="comments\.xml"/,
  );
  assert.match(core, /<dc:creator><\/dc:creator>/);

  for (const element of ['w:ins', 'w:del']) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});

test('the custom comments fixture makes thread navigation visible across three compact pages', async () => {
  const { bytes, contentTypes, document, documentRels, styles, comments, core, app } =
    await openFixture('custom-comments-workflow.docx');
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');

  assert.equal(document.match(/<w:br w:type="page"\/>/g)?.length, 2, 'must contain three explicit pages');
  assert.equal(document.match(/<w:commentRangeStart\b/g)?.length, 2, 'must contain two comment anchors');
  assert.equal(document.match(/<w:commentRangeEnd\b/g)?.length, 2, 'must close both comment anchors');
  assert.equal(document.match(/<w:commentReference\b/g)?.length, 2, 'must show both comment references');
  assert.equal(comments.match(/<w:comment\b/g)?.length, 2, 'must contain two comment threads');
  assert.match(document, /January 12, 2027/);
  assert.match(document, /September 30, 2027/);
  assert.match(document, /Select the approval criteria and add a comment\./);
  assert.match(comments, /Confirm the kickoff date\./);
  assert.match(comments, /Does this match the signed schedule\?/);
  assert.match(styles, /<w:sz w:val="24"\/>/);
  assert.ok(visibleText.length < 500, `custom comments fixture must stay concise, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.match(
    contentTypes,
    /PartName="\/word\/comments\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.comments\+xml"/,
  );
  assert.match(
    documentRels,
    /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/comments" Target="comments\.xml"/,
  );
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);
  assert.doesNotMatch(document, /<(?:w:ins|w:del)\b/);
});

test('the custom tracked-changes fixture makes review navigation visible across three compact pages', async () => {
  const { bytes, zip, contentTypes, document, styles, core, app } = await openFixture(
    'custom-track-changes-workflow.docx',
  );
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.equal(document.match(/<w:br w:type="page"\/>/g)?.length, 2, 'must contain three explicit pages');
  assert.equal(document.match(/<w:ins\b/g)?.length, 2, 'must contain two tracked insertions');
  assert.equal(document.match(/<w:del\b/g)?.length, 1, 'must contain one tracked deletion');
  assert.match(document, /w:author="Alex Rivera"/);
  assert.match(document, /w:author="Morgan Lee"/);
  assert.match(document, /within 10 business days/);
  assert.match(document, /automatically renews for one year/);
  assert.match(document, /prior written approval/);
  assert.match(styles, /<w:sz w:val="24"\/>/);
  assert.ok(visibleText.length < 500, `custom review fixture must stay concise, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.equal(zip.file('word/comments.xml'), null, 'must not ship comments');
  assert.doesNotMatch(contentTypes, /comments\.xml/);
  assert.doesNotMatch(document, /<w:comment(?:RangeStart|RangeEnd|Reference)\b/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(core, /<dcterms:created xsi:type="dcterms:W3CDTF">2025-01-15T00:00:00Z<\/dcterms:created>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);
});

test('the custom content-controls fixture makes typed field navigation visible across two compact pages', async () => {
  const { bytes, zip, contentTypes, document, styles, core, app } = await openFixture(
    'custom-content-controls-workflow.docx',
  );
  const visibleText = [...document.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.equal(document.match(/<w:br w:type="page"\/>/g)?.length, 1, 'must contain two explicit pages');
  assert.equal(document.match(/<w:sdt>/g)?.length, 2, 'must contain exactly two content controls');
  assert.match(document, /<w:alias w:val="Client name"\/><w:tag w:val="client-name"\/><w:id w:val="3001"\/><w:text\/>/);
  assert.match(
    document,
    /<w:alias w:val="Review approved"\/><w:tag w:val="review-approved"\/><w:id w:val="3002"\/><w14:checkbox>/,
  );
  assert.match(document, /<w14:checked w14:val="0"\/>/);
  assert.match(document, /Acme Inc\./);
  assert.match(document, /Use Show in document to move between fields\./);
  assert.match(styles, /<w:sz w:val="24"\/>/);
  assert.match(app, /<Paragraphs>7<\/Paragraphs>/);
  assert.ok(visibleText.length < 300, `custom field fixture must stay concise, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.equal(zip.file('word/comments.xml'), null, 'must not ship comments');
  assert.doesNotMatch(contentTypes, /comments\.xml/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);

  for (const element of REVISION_ELEMENTS) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});

test('the custom selection fixture provides two clean geometry targets', async () => {
  const { bytes, zip, contentTypes, document, styles, core, app } = await openFixture(
    'custom-selection-workflow.docx',
  );
  const visibleText = [...document.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.equal(document.match(/<w:br w:type="page"\/>/g)?.length, 1, 'must contain two explicit pages');
  assert.match(document, /fees Customer paid in the twelve months before the claim/);
  assert.match(document, /sixty days’ written notice/);
  assert.match(document, /Select the cap and choose Ask AI/);
  assert.match(document, /Select the notice to move the prompt/);
  assert.match(styles, /<w:sz w:val="24"\/>/);
  assert.ok(visibleText.length < 300, `custom selection fixture must stay concise, got ${visibleText.length} characters`);
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.equal(zip.file('word/comments.xml'), null, 'must not ship comments');
  assert.doesNotMatch(contentTypes, /comments\.xml/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);

  for (const element of REVISION_ELEMENTS) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});

test('the search fixture provides three short pages with deliberate query results', async () => {
  const { bytes, zip, document, styles, core, app } = await openFixture('search-sample.docx');
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');
  const deletedText = [...document.matchAll(/<w:delText[^>]*>(.*?)<\/w:delText>/g)]
    .map((match) => match[1])
    .join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.ok(zip.file('word/document.xml'), 'must contain a main document part');
  assert.ok(zip.file('word/styles.xml'), 'must contain Word styles');
  assert.equal(document.match(/<w:br w:type="page"\/>/g)?.length, 2, 'must contain three explicit pages');
  assert.ok(visibleText.length < 500, `search-sample.docx must stay short, got ${visibleText.length} characters`);
  assert.equal(visibleText.match(/\bClient\b/g)?.length, 7, 'must contain seven case-sensitive Client matches');
  assert.equal(visibleText.match(/\bclient\b/g)?.length, 1, 'must contain one lowercase client match');
  assert.equal(visibleText.match(/\bclient\b/gi)?.length, 8, 'must contain eight case-insensitive client matches');
  assert.doesNotMatch(visibleText, /Customer/);
  assert.equal(deletedText.trim(), 'Legacy', 'must contain one unique pending deletion for the Search demo');
  assert.match(
    document,
    /<w:del w:id="0" w:author="SuperDoc Test User" w:date="2025-01-15T00:00:00Z"><w:r><w:delText xml:space="preserve"> Legacy<\/w:delText><\/w:r><\/w:del>/,
  );
  assert.match(styles, /<w:sz w:val="36"\/>/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);
  assert.equal(zip.file('word/comments.xml'), null, 'must not ship comments');

  for (const element of REVISION_ELEMENTS.filter((element) => element !== 'w:del')) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
  assert.equal(document.match(/<w:del\b/g)?.length, 1, 'must contain exactly one tracked deletion');
});

test('the hyperlinks fixture keeps one real external hyperlink', async () => {
  const { bytes, document, documentRels, core, app } = await openFixture('hyperlinks-sample.docx');
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.ok(visibleText.length < 200, `hyperlinks-sample.docx must stay short, got ${visibleText.length} characters`);
  assert.match(document, /<w:hyperlink r:id="rId2" w:history="1">/);
  assert.match(document, /SuperDoc documentation/);
  assert.match(
    documentRels,
    /Id="rId2" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/hyperlink" Target="https:\/\/docs\.superdoc\.dev\/" TargetMode="External"/,
  );
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);

  for (const element of REVISION_ELEMENTS) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});

test('the context-menu fixture stays focused on one selectable sentence', async () => {
  const { bytes, document, documentRels, core, app } = await openFixture('context-menu-sample.docx');
  const visibleText = [...document.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.match(visibleText, /Select this sentence, then right-click it to open the document menu\./);
  assert.doesNotMatch(document, /<w:hyperlink\b/);
  assert.doesNotMatch(documentRels, /relationships\/hyperlink/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);

  for (const element of REVISION_ELEMENTS) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});

test('the content-controls fixture keeps one text field and one checkbox', async () => {
  const { bytes, document, core, app } = await openFixture('content-controls-sample.docx');
  const visibleText = [...document.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join(' ');

  assert.equal(firstArchiveEntry(bytes), '[Content_Types].xml');
  assert.ok(bytes.length < 8_000, `must stay a small package, got ${bytes.length} bytes`);
  assert.match(visibleText, /Client name:\s+Acme Inc\./);
  assert.equal(document.match(/<w:sdt>/g)?.length, 2, 'must contain exactly two content controls');
  assert.match(document, /<w:alias w:val="Client name"\/><w:tag w:val="client-name"\/><w:id w:val="2001"\/><w:text\/>/);
  assert.match(
    document,
    /<w:alias w:val="Review approved"\/><w:tag w:val="review-approved"\/><w:id w:val="2002"\/><w14:checkbox>/,
  );
  assert.match(document, /xmlns:mc="http:\/\/schemas\.openxmlformats\.org\/markup-compatibility\/2006"/);
  assert.match(document, /mc:Ignorable="w14"/);
  assert.match(document, /<w14:checked w14:val="0"\/>/);
  assert.match(document, /<w14:checkedState w14:font="MS Gothic" w14:val="2612"\/>/);
  assert.match(document, /<w14:uncheckedState w14:font="MS Gothic" w14:val="2610"\/>/);
  assert.match(core, /<dc:creator><\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(app, /<Company><\/Company>/);
  assert.match(app, /<Manager><\/Manager>/);

  for (const element of REVISION_ELEMENTS) {
    assert.ok(!new RegExp(`<${element}\\b`).test(document), `must not contain <${element}>`);
  }
});
