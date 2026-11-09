import { describe, expect, it } from 'vite-plus/test';

import {
  emptyElementPattern,
  inspectDocx,
  isEncryptedDocx,
  isGenericContentTypeName,
  isStandardsNamespace,
  organizationReceivers,
  pairedElementPattern,
  readZipEntries,
  relationshipTargetProblem,
  writeZipEntries,
} from '../lib/docx-privacy.mjs';
import { sanitizeDocxBuffer } from '../sanitize-docx.mjs';

/**
 * Build a minimal .docx in memory. Only the parts the privacy gate reads are
 * present; that is enough to exercise every detection rule without shipping a
 * binary fixture for the fixture checker.
 */
function makeDocx({ core = '', app = '', custom = '', document = '', footer = '', parts = {}, customXml = {} } = {}) {
  const entries = new Map();
  entries.set(
    '[Content_Types].xml',
    Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  );
  if (core) entries.set('docProps/core.xml', Buffer.from(core));
  if (app) entries.set('docProps/app.xml', Buffer.from(app));
  if (custom) entries.set('docProps/custom.xml', Buffer.from(custom));
  if (document) entries.set('word/document.xml', Buffer.from(document));
  if (footer) entries.set('word/footer2.xml', Buffer.from(footer));
  for (const [name, content] of Object.entries(parts)) {
    entries.set(`word/${name}`, Buffer.from(content));
  }
  for (const [name, content] of Object.entries(customXml)) {
    entries.set(`customXml/${name}`, Buffer.from(content));
  }
  return writeZipEntries(entries);
}

const CORE_WITH_PERSON = `<?xml version="1.0"?><cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Real Person</dc:creator><cp:lastModifiedBy>Someone Else</cp:lastModifiedBy></cp:coreProperties>`;

describe('zip round-trip', () => {
  it('reads back what it writes', () => {
    const buffer = makeDocx({ core: CORE_WITH_PERSON });
    const entries = readZipEntries(buffer);
    expect(entries.get('docProps/core.xml').toString()).toContain('Real Person');
  });

  it('is deterministic, so sanitizing twice produces no diff', () => {
    const first = makeDocx({ core: CORE_WITH_PERSON });
    const second = makeDocx({ core: CORE_WITH_PERSON });
    expect(first.equals(second)).toBe(true);
  });
});

describe('inspectDocx', () => {
  it('reports creator and last-modified-by', () => {
    const report = inspectDocx(makeDocx({ core: CORE_WITH_PERSON }));
    expect(report.identities).toEqual(
      expect.arrayContaining([
        { kind: 'dc:creator', value: 'Real Person' },
        { kind: 'cp:lastModifiedBy', value: 'Someone Else' },
      ]),
    );
  });

  it('reports company', () => {
    const app = '<?xml version="1.0"?><Properties><Company>Acme Corp</Company></Properties>';
    expect(inspectDocx(makeDocx({ app })).identities).toContainEqual({ kind: 'Company', value: 'Acme Corp' });
  });

  it('reports tracked-change and comment authors', () => {
    const document = '<?xml version="1.0"?><w:document><w:ins w:author="Reviewer Name" w:id="1"/></w:document>';
    expect(inspectDocx(makeDocx({ document })).identities).toContainEqual({
      kind: 'w:author',
      value: 'Reviewer Name',
    });
  });

  it('reports people-catalog account identifiers', () => {
    const report = inspectDocx(
      makeDocx({
        parts: {
          'people.xml':
            '<w15:people><w15:person w15:author="SuperDoc Test User"><w15:presenceInfo w15:userId="S::person@customer.example::1234"/></w15:person></w15:people>',
        },
      }),
    );
    expect(report.identities).toContainEqual({
      kind: 'w15:userId',
      value: 'S::person@customer.example::1234',
    });
  });

  it('ignores tool bookkeeping properties', () => {
    const custom =
      '<?xml version="1.0"?><Properties><property name="SuperdocVersion"><vt:lpwstr>1.0</vt:lpwstr></property></Properties>';
    expect(inspectDocx(makeDocx({ custom })).identities).toHaveLength(0);
  });

  it('flags document-management properties', () => {
    const custom =
      '<?xml version="1.0"?><Properties><property name="ClientID"><vt:lpwstr>12345</vt:lpwstr></property></Properties>';
    expect(inspectDocx(makeDocx({ custom })).identities).toContainEqual({
      kind: 'dms-property',
      value: 'ClientID=12345',
    });
  });

  it('flags organization content types in customXml', () => {
    const report = inspectDocx(
      makeDocx({ customXml: { 'item1.xml': '<x ma:contentTypeName="Acme Legal Document"/>' } }),
    );
    expect(report.taxonomy.join()).toContain('Acme Legal Document');
  });

  it('ignores standards and reserved-example namespaces', () => {
    const report = inspectDocx(
      makeDocx({
        customXml: {
          'item1.xml': '<x xmlns="http://schemas.microsoft.com/office/2006/metadata" ref="http://example.com/schema"/>',
        },
      }),
    );
    expect(report.taxonomy).toEqual([]);
  });

  it('finds revision authors in every word part, not a chosen few', () => {
    // Tracked changes live wherever their content lives. A gate that inspects
    // only document/comments/people misses an author in a header or footnote.
    const report = inspectDocx(
      makeDocx({
        parts: {
          'header1.xml': '<w:hdr><w:ins w:author="Header Person" w:id="1"/></w:hdr>',
          'footnotes.xml': '<w:footnotes><w:del w:author="Footnote Person" w:id="2"/></w:footnotes>',
          'endnotes.xml': '<w:endnotes><w:ins w:author="Endnote Person" w:id="3"/></w:endnotes>',
        },
      }),
    );
    const values = report.identities.map((entry) => entry.value);
    expect(values).toContain('Header Person');
    expect(values).toContain('Footnote Person');
    expect(values).toContain('Endnote Person');
  });

  it('flags a document-management stamp rendered in a footer', () => {
    const footer = '<?xml version="1.0"?><w:ftr><w:p><w:r><w:t>MCL-OFFICE-03 VERSION 1.8a</w:t></w:r></w:p></w:ftr>';
    expect(inspectDocx(makeDocx({ footer })).bodyStamps.join()).toContain('MCL-OFFICE-03');
  });

  it('flags a SharePoint receiver naming a third-party organization', () => {
    const report = inspectDocx(
      makeDocx({
        customXml: {
          'item8.xml':
            '<r><Receivers><Receiver><Assembly>Acme.ClientMatter.ContentTypes, Version=1.0</Assembly></Receiver></Receivers></r>',
        },
      }),
    );
    expect(report.taxonomy.join()).toContain('Acme.ClientMatter.ContentTypes');
  });

  it('ignores SharePoint receivers shipped by Microsoft', () => {
    const report = inspectDocx(
      makeDocx({
        customXml: {
          'item2.xml':
            '<r><Receivers><Receiver><Assembly>Microsoft.Office.DocumentManagement, Version=1.0</Assembly></Receiver></Receivers></r>',
        },
      }),
    );
    expect(report.taxonomy).toEqual([]);
  });

  it('reads a stamp split across adjacent runs', () => {
    // Word splits visible text across runs freely. Replacing tags with spaces
    // turns `MCL-OFFICE` + `-03 VERSION 1.8a` into two words and stops matching.
    const footer = '<w:ftr><w:p><w:r><w:t>MCL-OFFICE</w:t></w:r><w:r><w:t>-03 VERSION 1.8a</w:t></w:r></w:p></w:ftr>';
    expect(inspectDocx(makeDocx({ footer })).bodyStamps.join()).toContain('MCL-OFFICE-03');
  });

  it('does not report a fragment of the approved synthetic stamp', () => {
    // A page number in the next run concatenates onto the stamp, and the
    // pattern then matches a truncated prefix of it.
    const footer = '<w:ftr><w:p><w:r><w:t>SUPERDOC-TEST VERSION 1.0a</w:t></w:r><w:r><w:t>63</w:t></w:r></w:p></w:ftr>';
    expect(inspectDocx(makeDocx({ footer })).bodyStamps).toEqual([]);
  });

  it('reads author attributes in either quote form', () => {
    const document = "<w:document><w:ins w:author='Jane Doe' w:id='1'/></w:document>";
    expect(inspectDocx(makeDocx({ document })).identities).toContainEqual({
      kind: 'w:author',
      value: 'Jane Doe',
    });
  });

  it('reads single-quoted custom property names', () => {
    const custom =
      '<?xml version="1.0"?><Properties><property name=\'ClientID\'><vt:lpwstr>12345</vt:lpwstr></property></Properties>';
    expect(inspectDocx(makeDocx({ custom })).identities).toContainEqual({
      kind: 'dms-property',
      value: 'ClientID=12345',
    });
  });

  it('scans every SharePoint receiver, not just the first', () => {
    // A Microsoft handler ahead of a third-party one must not shadow it.
    const report = inspectDocx(
      makeDocx({
        customXml: {
          'item1.xml':
            '<r><Receivers><Receiver><Assembly>Microsoft.Office.DocumentManagement, V=1</Assembly></Receiver><Receiver><Assembly>Acme.ClientMatter.ContentTypes, V=1</Assembly></Receiver></Receivers></r>',
        },
      }),
    );
    expect(report.taxonomy.join()).toContain('Acme.ClientMatter.ContentTypes');
  });

  it('scans customXml itemProps parts as well as items', () => {
    const report = inspectDocx(
      makeDocx({ customXml: { 'itemProps1.xml': '<r ma:contentTypeName="Acme Legal Document"/>' } }),
    );
    expect(report.taxonomy.join()).toContain('Acme Legal Document');
  });

  it('treats encrypted documents as opaque rather than failing', () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
    expect(isEncryptedDocx(ole)).toBe(true);
    expect(inspectDocx(ole)).toEqual({
      identities: [],
      taxonomy: [],
      bodyStamps: [],
      relationships: [],
      encrypted: true,
    });
  });
});

describe('sanitizeDocxBuffer', () => {
  it('replaces identities with the synthetic test user', () => {
    const { buffer, changed } = sanitizeDocxBuffer(makeDocx({ core: CORE_WITH_PERSON }));
    expect(changed).toBe(true);
    const values = inspectDocx(buffer).identities.map((entry) => entry.value);
    expect(values).not.toContain('Real Person');
    expect(values).toContain('SuperDoc Test User');
  });

  it('rewrites revision authors but preserves revision structure', () => {
    const document =
      '<?xml version="1.0"?><w:document><w:ins w:id="7" w:author="Real Person" w:date="2026-01-01T00:00:00Z"><w:t>hi</w:t></w:ins></w:document>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ document }));
    const xml = readZipEntries(buffer).get('word/document.xml').toString();
    expect(xml).toContain('w:id="7"');
    expect(xml).toContain('w:date="2026-01-01T00:00:00Z"');
    expect(xml).toContain('<w:t>hi</w:t>');
    expect(xml).not.toContain('Real Person');
  });

  it('rewrites people-catalog account identifiers but preserves presence metadata', () => {
    const source = makeDocx({
      parts: {
        'people.xml':
          '<w15:people><w15:person w15:author="SuperDoc Test User"><w15:presenceInfo w15:providerId="AD" w15:userId="S::person@customer.example::1234"/></w15:person></w15:people>',
      },
    });
    const { buffer, changed } = sanitizeDocxBuffer(source);
    const xml = readZipEntries(buffer).get('word/people.xml').toString();
    expect(changed).toBe(true);
    expect(xml).toContain('w15:providerId="AD"');
    expect(xml).toContain('w15:userId="S::reviewer@example.com::00000000-0000-0000-0000-000000000000"');
    expect(xml).not.toContain('person@customer.example');
  });

  it('rewrites single-quoted author attributes too', () => {
    const document = "<w:document><w:ins w:author='Jane Doe' w:id='1'><w:t>hi</w:t></w:ins></w:document>";
    const { buffer, changed } = sanitizeDocxBuffer(makeDocx({ document }));
    expect(changed).toBe(true);
    const values = inspectDocx(buffer).identities.map((entry) => entry.value);
    expect(values).not.toContain('Jane Doe');
    expect(values).toContain('SuperDoc Test User');
  });

  it('drops document-management properties', () => {
    const custom =
      '<?xml version="1.0"?><Properties><property name="ClientID"><vt:lpwstr>12345</vt:lpwstr></property><property name="SuperdocVersion"><vt:lpwstr>1.0</vt:lpwstr></property></Properties>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ custom }));
    const xml = readZipEntries(buffer).get('docProps/custom.xml').toString();
    expect(xml).not.toContain('ClientID');
    expect(xml).toContain('SuperdocVersion');
  });

  it('redacts a footer stamp without disturbing the surrounding element', () => {
    const footer = '<?xml version="1.0"?><w:ftr><w:p><w:r><w:t>MCL-OFFICE-03 VERSION 1.8a</w:t></w:r></w:p></w:ftr>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ footer }));
    const xml = readZipEntries(buffer).get('word/footer2.xml').toString();
    expect(xml).not.toContain('MCL-OFFICE-03');
    expect(xml).toContain('<w:ftr><w:p><w:r><w:t>');
    expect(inspectDocx(buffer).bodyStamps).toEqual([]);
  });

  it('removes an organization customXml part and everything that points at it', () => {
    // The highest-risk rewrite: dropping a part means its itemProps sibling, its
    // relationship, and its content-type override must go too, or Word sees a
    // package that references something absent.
    const entries = new Map();
    entries.set(
      '[Content_Types].xml',
      Buffer.from(
        '<Types><Override PartName="/customXml/item1.xml" ContentType="application/xml"/>' +
          '<Override PartName="/customXml/itemProps1.xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/xml"/></Types>',
      ),
    );
    entries.set('customXml/item1.xml', Buffer.from('<r ma:contentTypeName="Acme Legal Document"/>'));
    entries.set('customXml/itemProps1.xml', Buffer.from('<p/>'));
    entries.set('customXml/_rels/item1.xml.rels', Buffer.from('<Relationships/>'));
    entries.set(
      'word/_rels/document.xml.rels',
      Buffer.from(
        '<Relationships><Relationship Id="rId1" Target="../customXml/item1.xml"/>' +
          '<Relationship Id="rId2" Target="styles.xml"/></Relationships>',
      ),
    );
    entries.set('word/document.xml', Buffer.from('<w:document/>'));
    entries.set('word/styles.xml', Buffer.from('<w:styles/>'));

    const { buffer, changed } = sanitizeDocxBuffer(writeZipEntries(entries));
    expect(changed).toBe(true);

    const after = readZipEntries(buffer);
    expect([...after.keys()]).not.toContain('customXml/item1.xml');
    expect([...after.keys()]).not.toContain('customXml/itemProps1.xml');
    expect([...after.keys()]).not.toContain('customXml/_rels/item1.xml.rels');

    const rels = after.get('word/_rels/document.xml.rels').toString();
    expect(rels).not.toContain('customXml/item1.xml');
    expect(rels).toContain('styles.xml');

    const types = after.get('[Content_Types].xml').toString();
    expect(types).not.toContain('/customXml/item1.xml');
    expect(types).toContain('/word/document.xml');
  });

  it('keeps a customXml part that names no organization', () => {
    const entries = new Map();
    entries.set('[Content_Types].xml', Buffer.from('<Types/>'));
    entries.set('customXml/item1.xml', Buffer.from('<r ma:contentTypeName="Document"/>'));
    const { buffer } = sanitizeDocxBuffer(writeZipEntries(entries));
    expect([...readZipEntries(buffer).keys()]).toContain('customXml/item1.xml');
  });

  it('redacts a stamp split across adjacent runs', () => {
    // The gate reads the concatenated run text, so per-node redaction would
    // leave it failing on a document the sanitizer reports as cleaned.
    const footer = '<w:ftr><w:p><w:r><w:t>MCL-OFFICE</w:t></w:r><w:r><w:t>-03 VERSION 1.8a</w:t></w:r></w:p></w:ftr>';
    const { buffer, changed } = sanitizeDocxBuffer(makeDocx({ footer }));
    expect(changed).toBe(true);
    expect(inspectDocx(buffer).bodyStamps).toEqual([]);
    // Run structure survives: two <w:t> nodes in, two out.
    const xml = readZipEntries(buffer).get('word/footer2.xml').toString();
    expect((xml.match(/<w:t/gu) || []).length).toBe(2);
  });

  it('leaves an already-clean document byte-identical', () => {
    const clean = makeDocx({
      core: '<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>SuperDoc Test User</dc:creator></cp:coreProperties>',
    });
    const { buffer, changed } = sanitizeDocxBuffer(clean);
    expect(changed).toBe(false);
    expect(buffer.equals(clean)).toBe(true);
  });

  it('does not touch encrypted documents', () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(32)]);
    const { buffer, changed } = sanitizeDocxBuffer(ole);
    expect(changed).toBe(false);
    expect(buffer.equals(ole)).toBe(true);
  });
});

describe('quote and run-boundary edge cases', () => {
  it('reads a single-quoted contentTypeName', () => {
    const report = inspectDocx(
      makeDocx({ customXml: { 'item1.xml': "<r ma:contentTypeName='Acme Legal Document'/>" } }),
    );
    expect(report.taxonomy.join()).toContain('Acme Legal Document');
  });

  it('rewrites an author whose name contains an apostrophe', () => {
    // Excluding both quote characters from the value class left `O'Connor`
    // unscrubbed inside a double-quoted attribute.
    const document = '<w:document><w:ins w:author="O\'Connor" w:id="1"/></w:document>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ document }));
    const values = inspectDocx(buffer).identities.map((entry) => entry.value);
    expect(values).not.toContain("O'Connor");
    expect(values).toContain('SuperDoc Test User');
  });

  it('redacts a stamp the gate sees only in its spaced reading', () => {
    // Text in one paragraph and the stamp in the next: the concatenated
    // reading joins them, the spaced reading does not, and the gate reports
    // both. The sanitizer has to clear whatever the gate can see.
    const footer =
      '<w:ftr><w:p><w:r><w:t>Header line</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>MCL-OFFICE-03 VERSION 1.8a</w:t></w:r></w:p></w:ftr>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ footer }));
    expect(inspectDocx(buffer).bodyStamps).toEqual([]);
  });
});

describe('namespace and quoting variants', () => {
  it('reads core properties bound to a non-standard namespace prefix', () => {
    // A DOCX may bind Dublin Core to `d:` and stay perfectly valid.
    const core =
      '<cp:coreProperties xmlns:d="http://purl.org/dc/elements/1.1/"><d:creator>Real Person</d:creator></cp:coreProperties>';
    expect(inspectDocx(makeDocx({ core })).identities.map((entry) => entry.value)).toContain('Real Person');
  });

  it('removes a single-quoted DMS property', () => {
    // The inspector reports it, so the sanitizer has to be able to remove it.
    const custom =
      '<?xml version="1.0"?><Properties><property name=\'ClientID\'><vt:lpwstr>12345</vt:lpwstr></property></Properties>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ custom }));
    expect(inspectDocx(buffer).identities).toEqual([]);
  });
});

describe('gate and sanitizer stay in step on namespace aliases', () => {
  it('sanitizes an aliased core-property tag the gate reports', () => {
    const core =
      '<cp:coreProperties xmlns:d="http://purl.org/dc/elements/1.1/"><d:creator>Real Person</d:creator></cp:coreProperties>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ core }));
    expect(inspectDocx(buffer).identities.map((e) => e.value)).not.toContain('Real Person');
  });

  it('reads and rewrites author attributes under any namespace prefix', () => {
    const document = '<w:document><a:ins a:author="Real Person"/></w:document>';
    expect(inspectDocx(makeDocx({ document })).identities.map((e) => e.value)).toContain('Real Person');
    const { buffer } = sanitizeDocxBuffer(makeDocx({ document }));
    expect(inspectDocx(buffer).identities.map((e) => e.value)).toContain('SuperDoc Test User');
  });

  it('drops customXml taxonomy wherever the gate finds it', () => {
    for (const parts of [
      { 'itemProps1.xml': '<r ma:contentTypeName="Acme Legal Document"/>' },
      { 'item1.xml': "<r ma:contentTypeName='Acme Legal Document'/>" },
    ]) {
      const source = makeDocx({ customXml: parts });
      expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
      expect(inspectDocx(sanitizeDocxBuffer(source).buffer).taxonomy).toEqual([]);
    }
    // A generic content type is not taxonomy and must survive.
    const generic = makeDocx({ customXml: { 'item1.xml': '<r ma:contentTypeName="Document"/>' } });
    expect([...readZipEntries(sanitizeDocxBuffer(generic).buffer).keys()]).toContain('customXml/item1.xml');
  });
  it('reports a Creator custom property, and the sanitizer clears it', () => {
    // As PDF metadata "Creator" names a tool; as a DOCX custom property it
    // routinely holds a person's name.
    const custom = `<?xml version="1.0"?><Properties><property name="Creator"><vt:lpwstr>Jane Q. Attorney</vt:lpwstr></property></Properties>`;
    const source = makeDocx({ custom });
    expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('Creator=Jane Q. Attorney');
    // Gate and sanitizer share one predicate, so anything reported is fixable.
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).identities).toEqual([]);
  });

  it('refuses an archive whose part uses an unsupported compression method', () => {
    // Skipping the entry would make an unreadable part look like an absent one,
    // and the gate would call the fixture clean.
    const source = makeDocx({ core: CORE_WITH_PERSON });
    const patched = Buffer.from(source);
    for (let index = 0; index + 4 <= patched.length; index += 1) {
      if (patched.readUInt32LE(index) === 0x04034b50) patched.writeUInt16LE(9, index + 8);
      if (patched.readUInt32LE(index) === 0x02014b50) patched.writeUInt16LE(9, index + 10);
    }
    expect(() => inspectDocx(patched)).toThrow(/[Uu]nsupported compression method/);
  });
  it('rewrites the node that matched, not the first identical one', () => {
    // Searching for a node's own XML finds the first copy in the part, which is
    // a different node whenever a document repeats a run.
    const footer =
      '<w:p><w:r><w:t> VERSION 7.1</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>ACME-FILE</w:t></w:r><w:r><w:t> VERSION 7.1</w:t></w:r></w:p>';
    const source = makeDocx({ footer });
    expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);

    const { buffer } = sanitizeDocxBuffer(source);
    expect(inspectDocx(buffer).bodyStamps).toEqual([]);
    // The earlier duplicate is untouched: it carried no stamp of its own.
    const rewritten = readZipEntries(buffer).get('word/footer2.xml').toString('utf8');
    expect(rewritten.startsWith('<w:p><w:r><w:t> VERSION 7.1</w:t></w:r></w:p>')).toBe(true);
  });

  it('sanitizing twice changes nothing the second time', () => {
    // A page-number run truncates the synthetic stamp's own match, and an
    // equality-only guard then appends to it on every run.
    const footer = '<w:p><w:r><w:t>MCL-DOCS VERSION 3.2</w:t></w:r><w:r><w:t>63</w:t></w:r></w:p>';
    const once = sanitizeDocxBuffer(makeDocx({ footer })).buffer;
    const twice = sanitizeDocxBuffer(once).buffer;
    const read = (buffer) => readZipEntries(buffer).get('word/footer2.xml').toString('utf8');
    expect(read(twice)).toEqual(read(once));
  });
  it('refuses an archive with duplicate entry names', () => {
    // A Map keyed by name keeps the last member, so a real core.xml followed by
    // a clean copy inspects clean while the archive still publishes both.
    // writeZipEntries cannot express that, so build the two members by hand.
    const clean =
      '<?xml version="1.0"?><cp:coreProperties>' + '<dc:creator>SuperDoc Test User</dc:creator></cp:coreProperties>';
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const xml of [CORE_WITH_PERSON, clean]) {
      const name = Buffer.from('docProps/core.xml');
      const data = Buffer.from(xml);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 6);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, name, data);
      centrals.push(central, name);
      offset += 30 + name.length + data.length;
    }
    const body = Buffer.concat(locals);
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(2, 8);
    end.writeUInt16LE(2, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(body.length, 16);

    expect(() => inspectDocx(Buffer.concat([body, directory, end]))).toThrow(/[Dd]uplicate/);
  });

  it('reads custom properties under any namespace prefix', () => {
    const custom =
      '<?xml version="1.0"?><Properties>' +
      '<cp:property name="ClientID"><vt:lpwstr>ACME-4471</vt:lpwstr></cp:property></Properties>';
    const source = makeDocx({ custom });
    expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('ClientID=ACME-4471');
    // The sanitizer has to remove what the gate reports, prefix and all.
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).identities).toEqual([]);
  });

  it('leaves no fragment when both stamp readings overlap', () => {
    // The joined and spaced readings can bound the same stamp one character
    // apart; applying both left the odd character behind.
    const footer =
      '<w:p><w:r><w:t>ACME-FILE</w:t></w:r><w:r><w:t> VERSION 7.1</w:t></w:r>' + '<w:r><w:t> x</w:t></w:r></w:p>';
    const { buffer } = sanitizeDocxBuffer(makeDocx({ footer }));
    expect(inspectDocx(buffer).bodyStamps).toEqual([]);
    expect(readZipEntries(buffer).get('word/footer2.xml').toString('utf8')).not.toMatch(/>1</);
  });
  it('reads custom properties with whitespace around the attribute equals', () => {
    // XML permits `name = "…"`, and a tight-only regex enumerated nothing.
    const custom =
      '<?xml version="1.0"?><Properties>' +
      '<property name = "ClientID"><vt:lpwstr>ACME-4471</vt:lpwstr></property></Properties>';
    const source = makeDocx({ custom });
    expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('ClientID=ACME-4471');
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).identities).toEqual([]);
  });
  it('reports reviewer initials, not only the author name', () => {
    // An author hand-edited to an approved value while the initials stay real
    // would otherwise pass the gate.
    const parts = {
      'comments.xml': '<w:comments><w:comment w:author="SuperDoc Test User" w:initials="JQA"/></w:comments>',
    };
    const source = makeDocx({ parts });
    expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('JQA');
    // The sanitizer rewrites them to the approved synthetic value.
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).identities.map((entry) => entry.value)).not.toContain('JQA');
  });

  it('removes a content-type override however its PartName is quoted', () => {
    for (const quote of ["'", '"']) {
      const types = `<Types><Override PartName=${quote}/customXml/item1.xml${quote} ContentType="application/xml"/></Types>`;
      const entries = new Map([
        ['[Content_Types].xml', Buffer.from(types)],
        ['customXml/item1.xml', Buffer.from('<r ma:contentTypeName="Acme Legal Document"/>')],
      ]);
      const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
      expect(cleaned.has('customXml/item1.xml')).toBe(false);
      // An override pointing at a part that is gone leaves the package invalid.
      expect(cleaned.get('[Content_Types].xml').toString('utf8')).not.toContain('item1.xml');
    }
  });
  it('decodes an XML part according to its byte-order mark', () => {
    // A part saved as UTF-16 reads as NUL-separated letters under a UTF-8
    // decode, and every metadata regex then matches nothing.
    for (const bom of [
      [0xff, 0xfe],
      [0xfe, 0xff],
    ]) {
      const body = Buffer.from(CORE_WITH_PERSON, 'utf16le');
      const wide = bom[0] === 0xfe ? Buffer.from(body).swap16() : body;
      const entries = new Map([
        ['[Content_Types].xml', Buffer.from('<Types/>')],
        ['docProps/core.xml', Buffer.concat([Buffer.from(bom), wide])],
      ]);
      const source = writeZipEntries(entries);
      expect(inspectDocx(source).identities.length).toBeGreaterThan(0);
      // And the sanitizer reads it the same way, so the gate can be cleared.
      expect(inspectDocx(sanitizeDocxBuffer(source).buffer).identities.map((entry) => entry.value)).not.toContain(
        'Real Person',
      );
    }
  });

  it('reads a taxonomy attribute with whitespace around the equals', () => {
    const parts = { 'itemProps1.xml': '<r ma:contentTypeName = "Acme Legal Document"/>' };
    const source = makeDocx({ customXml: parts });
    expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).taxonomy).toEqual([]);
  });

  it('reads author and initials attributes spaced away from the equals', () => {
    // XML permits `w:author = "…"`. Requiring the `=` to touch the name let the
    // spacing decide whether a reviewer was reported, and the sanitizer used
    // the same tight syntax, so the identity survived the cleanup too.
    const document = '<w:document><w:ins w:author = "Real Person" w:initials = "RP"/></w:document>';
    const source = makeDocx({ document });
    expect(inspectDocx(source).identities).toEqual(
      expect.arrayContaining([
        { kind: 'w:author', value: 'Real Person' },
        { kind: 'w:initials', value: 'RP' },
      ]),
    );

    const cleaned = readZipEntries(sanitizeDocxBuffer(source).buffer).get('word/document.xml').toString();
    expect(cleaned).not.toContain('Real Person');
    expect(cleaned).not.toContain('"RP"');
    // The document's own spacing is replayed rather than reformatted.
    expect(cleaned).toContain('w:author = "SuperDoc Test User"');
  });

  it('sanitizes a part that carries initials but no author', () => {
    // The guard that decides whether a part is worth rewriting has to admit
    // everything the rewrite handles, or the part is written back untouched.
    const source = makeDocx({ parts: { 'comments.xml': '<w:comments><w:comment w:initials="RP"/></w:comments>' } });
    const cleaned = readZipEntries(sanitizeDocxBuffer(source).buffer).get('word/comments.xml').toString();
    expect(cleaned).not.toContain('"RP"');
    expect(cleaned).toContain('w:initials="ST"');
  });

  it('reads taxonomy bound to a namespace alias other than ma', () => {
    // Prefixes are aliases. Keying on the literal `ma:` made the alias the gate
    // in both the detector and the sanitizer.
    const source = makeDocx({
      customXml: {
        'itemProps1.xml':
          '<r xmlns:x="http://schemas.microsoft.com/office/2006/metadata/properties" x:contentTypeName="Acme Legal Document"/>',
      },
    });
    expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).taxonomy).toEqual([]);
  });

  it('reads an external taxonomy URL whatever the case of its scheme', () => {
    // URI schemes are case-insensitive, and the sanitizer already matched
    // without regard to case, so a case-sensitive detector left the two halves
    // of the policy disagreeing.
    const source = makeDocx({ customXml: { 'item1.xml': '<r ref="HTTPS://outside.example/schema"/>' } });
    expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).taxonomy).toEqual([]);
  });

  it('leaves the encoding declaration true of the bytes it writes', () => {
    // A part decoded from UTF-16 is written back as UTF-8. Carrying the old
    // declaration forward makes the part unreadable to a conforming parser even
    // though this gate, which sniffs the BOM, reads it back fine.
    const declared =
      '<?xml version="1.0" encoding="UTF-16"?><cp:coreProperties><dc:creator>Real Person</dc:creator></cp:coreProperties>';
    const entries = new Map([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['docProps/core.xml', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(declared, 'utf16le')])],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer).get('docProps/core.xml');
    expect(cleaned[0] === 0xff && cleaned[1] === 0xfe).toBe(false);
    expect(cleaned.toString('utf8')).toContain('encoding="UTF-8"');
    expect(cleaned.toString('utf8')).not.toContain('UTF-16');
  });

  it('drops a customXml relationship whose Target is spaced away from the equals', () => {
    // Deleting the part while leaving the relationship produces a package that
    // points at a member that is not there.
    const entries = new Map([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['customXml/item1.xml', Buffer.from('<root/>')],
      ['customXml/itemProps1.xml', Buffer.from('<r ma:contentTypeName="Acme Legal Document"/>')],
      [
        'word/_rels/document.xml.rels',
        Buffer.from('<Relationships><Relationship Id="rId1" Target = "../customXml/item1.xml"/></Relationships>'),
      ],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
    expect(cleaned.has('customXml/item1.xml')).toBe(false);
    expect(cleaned.get('word/_rels/document.xml.rels').toString()).not.toContain('customXml/item1.xml');
  });

  it('removes the relationships file belonging to a dropped itemProps part', () => {
    // A standard OPC layout gives itemProps its own .rels. Leaving it behind
    // orphans a relationships file against a part that no longer exists.
    const entries = new Map([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['customXml/item1.xml', Buffer.from('<root/>')],
      ['customXml/itemProps1.xml', Buffer.from('<r ma:contentTypeName="Acme Legal Document"/>')],
      ['customXml/_rels/item1.xml.rels', Buffer.from('<Relationships/>')],
      ['customXml/_rels/itemProps1.xml.rels', Buffer.from('<Relationships/>')],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
    expect(cleaned.has('customXml/itemProps1.xml')).toBe(false);
    expect(cleaned.has('customXml/_rels/itemProps1.xml.rels')).toBe(false);
    expect(cleaned.has('customXml/_rels/item1.xml.rels')).toBe(false);
  });

  it('reports the originating Word template but not the default one', () => {
    // Nothing else in the pipeline reads <Template>, so a house style or a DMS
    // path survives every property-level cleanup and ships with the fixture.
    const app = '<Properties><Template>T:\\firmwide\\HouseStyle.dotx</Template></Properties>';
    const source = makeDocx({ app });
    expect(inspectDocx(source).identities).toContainEqual({
      kind: 'Template',
      value: 'T:\\firmwide\\HouseStyle.dotx',
    });
    const cleaned = readZipEntries(sanitizeDocxBuffer(source).buffer).get('docProps/app.xml').toString();
    expect(cleaned).not.toContain('HouseStyle');
    expect(cleaned).toContain('<Template>Normal.dotm</Template>');

    // Word's own default names nobody, so it must not fail every fixture.
    for (const generic of ['Normal.dotm', 'Normal', 'Normal.dotx']) {
      expect(
        inspectDocx(makeDocx({ app: `<Properties><Template>${generic}</Template></Properties>` })).identities,
      ).toEqual([]);
    }
  });

  it('bounds an allowed namespace host at its own name', () => {
    // A hostname that merely starts with an allowed one is a different host.
    // The inspector parsed it correctly and the sanitizer did not, so the
    // fixture failed the gate and the recommended cleanup reported no change.
    const evil = makeDocx({ customXml: { 'item1.xml': '<r ref="https://schemas.microsoft.com.evil/acme"/>' } });
    expect(inspectDocx(evil).taxonomy.length).toBeGreaterThan(0);
    const cleaned = sanitizeDocxBuffer(evil);
    expect(cleaned.changed).toBe(true);
    expect(inspectDocx(cleaned.buffer).taxonomy).toEqual([]);

    // The genuinely allowed host stays clean and is left alone.
    const allowed = makeDocx({
      customXml: { 'item1.xml': '<r ref="https://schemas.microsoft.com/office/2006/metadata"/>' },
    });
    expect(inspectDocx(allowed).taxonomy).toEqual([]);
    expect(sanitizeDocxBuffer(allowed).changed).toBe(false);
  });

  it('decodes a UTF-16 part that declares its encoding without a byte-order mark', () => {
    // XML autodetects by leading bytes, so a BOM is not required. Read as UTF-8
    // the part becomes NUL-separated letters and every pattern matches nothing,
    // which reads as an empty part rather than an unreadable one.
    const declared =
      '<?xml version="1.0" encoding="UTF-16"?><cp:coreProperties><dc:creator>Real Person</dc:creator></cp:coreProperties>';
    // Little-endian, then big-endian: XML autodetects both from the leading bytes.
    for (const raw of [Buffer.from(declared, 'utf16le'), Buffer.from(Buffer.from(declared, 'utf16le')).swap16()]) {
      const source = writeZipEntries(
        new Map([
          ['[Content_Types].xml', Buffer.from('<Types/>')],
          ['docProps/core.xml', raw],
        ]),
      );
      expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('Real Person');
      // And the name really leaves the archive, rather than the gate simply
      // failing to see it.
      const cleaned = sanitizeDocxBuffer(source);
      expect(cleaned.changed).toBe(true);
      expect(readZipEntries(cleaned.buffer).get('docProps/core.xml').toString('utf16le')).not.toContain('Real Person');
      expect(inspectDocx(cleaned.buffer).identities.map((entry) => entry.value)).not.toContain('Real Person');
    }
  });

  it('classifies generic taxonomy the same way in the gate and the sanitizer', () => {
    // The two used to disagree on case and surrounding whitespace, which broke
    // both ways: a reported value the sanitizer would not remove, and an
    // approved value whose customXml store it deleted anyway.
    const store = (value) =>
      makeDocx({
        customXml: { 'item1.xml': '<root/>', 'itemProps1.xml': `<r ma:contentTypeName="${value}"/>` },
      });
    for (const value of ['Document', 'document', 'Document ', ' Item', 'DOC']) {
      const source = store(value);
      expect(inspectDocx(source).taxonomy).toEqual([]);
      expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/itemProps1.xml')).toBe(true);
    }
    const named = store('Acme Matter');
    expect(inspectDocx(named).taxonomy.length).toBeGreaterThan(0);
    expect(readZipEntries(sanitizeDocxBuffer(named).buffer).has('customXml/itemProps1.xml')).toBe(false);
  });

  it('reads every taxonomy name in a part, not only the first', () => {
    // A part can carry a generic name ahead of an organization's, exactly as
    // an event-receiver list can hold a Microsoft handler ahead of a third
    // party's.
    const source = makeDocx({
      customXml: { 'itemProps1.xml': '<r ma:contentTypeName="Document" ma:contentTypeName="Acme Matter"/>' },
    });
    expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
  });

  it('removes a receiver whose tag carries attributes', () => {
    // The inspector always allowed attributes on the tag; the sanitizer matched
    // only a bare `<Assembly>`, so an attributed receiver was reported and then
    // left in place, which no cleanup command could resolve.
    for (const inner of [
      '<Receivers><Receiver><Assembly type="receiver">Acme.ClientMatter.Receiver</Assembly></Receiver></Receivers>',
      '<Receivers><Receiver><Class xmlns:x="y">Acme.ClientMatter.Handler</Class></Receiver></Receivers>',
      '<Receivers><Receiver><Assembly >Acme.ClientMatter.Receiver</Assembly></Receiver></Receivers>',
    ]) {
      const source = makeDocx({
        customXml: { 'item1.xml': '<root/>', 'itemProps1.xml': `<p:properties>${inner}</p:properties>` },
      });
      expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
      expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/itemProps1.xml')).toBe(false);
    }

    // Microsoft's own handlers ship with SharePoint and name nobody, attributes
    // or not, so they must not start failing every fixture that has one.
    const shipped = makeDocx({
      customXml: {
        'item1.xml': '<root/>',
        'itemProps1.xml':
          '<p:properties><Receivers><Receiver><Assembly type="receiver">Microsoft.SharePoint.Handler</Assembly></Receiver></Receivers></p:properties>',
      },
    });
    expect(inspectDocx(shipped).taxonomy).toEqual([]);
    expect(sanitizeDocxBuffer(shipped).changed).toBe(false);
  });

  it('matches receiver elements by local name, whatever the prefix', () => {
    // Prefixes are aliases here as everywhere else in this module.
    for (const inner of [
      '<p:Receivers><p:Receiver><p:Assembly>Acme.ClientMatter.Receiver</p:Assembly></p:Receiver></p:Receivers>',
      '<ns0:Receivers><ns0:Receiver><ns0:Class>Acme.ClientMatter.Handler</ns0:Class></ns0:Receiver></ns0:Receivers>',
    ]) {
      const source = makeDocx({
        customXml: { 'item1.xml': '<root/>', 'itemProps1.xml': `<p:properties>${inner}</p:properties>` },
      });
      expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
      expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/itemProps1.xml')).toBe(false);
    }

    // A prefixed Microsoft handler is still shipped software naming nobody.
    const shipped = makeDocx({
      customXml: {
        'item1.xml': '<root/>',
        'itemProps1.xml':
          '<p:properties><p:Receivers><p:Receiver><p:Assembly>Microsoft.SharePoint.Handler</p:Assembly></p:Receiver></p:Receivers></p:properties>',
      },
    });
    expect(inspectDocx(shipped).taxonomy).toEqual([]);
  });

  it('drops OPC entries written with explicit end tags', () => {
    // `<Relationship .../>` and `<Relationship ...></Relationship>` are the
    // same empty element. Matching only the self-closing spelling left the
    // package pointing at parts the cleanup had just removed.
    const entries = new Map([
      [
        '[Content_Types].xml',
        Buffer.from('<Types><Override PartName="/customXml/itemProps1.xml" ContentType="x"></Override></Types>'),
      ],
      ['customXml/item1.xml', Buffer.from('<root/>')],
      ['customXml/itemProps1.xml', Buffer.from('<r ma:contentTypeName="Acme Matter"/>')],
      [
        'word/_rels/document.xml.rels',
        Buffer.from(
          '<Relationships><Relationship Id="rId1" Target="../customXml/item1.xml"></Relationship></Relationships>',
        ),
      ],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
    expect(cleaned.has('customXml/item1.xml')).toBe(false);
    expect(cleaned.get('word/_rels/document.xml.rels').toString()).not.toContain('customXml/item1.xml');
    expect(cleaned.get('[Content_Types].xml').toString()).not.toContain('itemProps1.xml');
  });

  it('reads and rewrites elements whose end tag carries whitespace', () => {
    // `</dc:creator >` is the same end tag. Missing it approved a fixture that
    // still carried the real creator.
    const core = '<cp:coreProperties><dc:creator>Real Person</dc:creator ></cp:coreProperties>';
    const source = makeDocx({ core });
    expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('Real Person');
    expect(readZipEntries(sanitizeDocxBuffer(source).buffer).get('docProps/core.xml').toString()).not.toContain(
      'Real Person',
    );
  });

  it('drops a relationship whose element carries a namespace prefix', () => {
    // OPC parts may bind their own namespace prefix. Leaving a prefixed
    // relationship behind points the package at a part that is gone.
    const entries = new Map([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['customXml/item1.xml', Buffer.from('<root/>')],
      ['customXml/itemProps1.xml', Buffer.from('<r ma:contentTypeName="Acme Matter"/>')],
      [
        'word/_rels/document.xml.rels',
        Buffer.from('<Relationships><r:Relationship Id="rId1" Target="../customXml/item1.xml"/></Relationships>'),
      ],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
    expect(cleaned.has('customXml/item1.xml')).toBe(false);
    expect(cleaned.get('word/_rels/document.xml.rels').toString()).not.toContain('customXml/item1.xml');
  });

  it('reads and removes custom properties however the element is spelled', () => {
    for (const property of [
      '<property name="ClientMatterID"><vt:lpwstr>ACME-4471</vt:lpwstr></property >',
      '<cp:property name="ClientMatterID"><vt:lpwstr>ACME-4471</vt:lpwstr></cp:property>',
    ]) {
      const source = makeDocx({ custom: `<Properties>${property}</Properties>` });
      expect(inspectDocx(source).identities.length).toBeGreaterThan(0);
      expect(readZipEntries(sanitizeDocxBuffer(source).buffer).get('docProps/custom.xml').toString()).not.toContain(
        'ACME-4471',
      );
    }
  });

  it('redacts a visible stamp however the run element is spelled', () => {
    // The gate has a second, tag-stripping reading that saw these already, so
    // the sanitizer missing them meant a fixture the gate failed and the
    // recommended cleanup could not fix.
    for (const run of [
      '<w:p><w:r><w:t>ACME-CLIENT-4471 VERSION 1.0a</w:t ></w:r></w:p>',
      '<x:p><x:r><x:t>ACME-CLIENT-4471 VERSION 1.0a</x:t></x:r></x:p>',
    ]) {
      const source = makeDocx({ footer: `<w:ftr>${run}</w:ftr>` });
      expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
      const cleaned = sanitizeDocxBuffer(source);
      expect(readZipEntries(cleaned.buffer).get('word/footer2.xml').toString()).not.toContain('ACME-CLIENT-4471');
      expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
    }
  });

  it('redacts a stamp stored in any visible run element', () => {
    // `w:delText` renders in review view, so a stamp there is on the page.
    for (const element of ['delText']) {
      const run = `<w:p><w:r><w:${element}>ACME-FILE VERSION 1.0a</w:${element}></w:r></w:p>`;
      const source = makeDocx({ footer: `<w:ftr>${run}</w:ftr>` });
      expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
      const cleaned = sanitizeDocxBuffer(source);
      expect(cleaned.changed).toBe(true);
      expect(readZipEntries(cleaned.buffer).get('word/footer2.xml').toString()).not.toContain('ACME-FILE');
      expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
    }
  });
});

describe('external relationship targets', () => {
  const withTarget = (target) =>
    writeZipEntries(
      new Map([
        ['[Content_Types].xml', Buffer.from('<Types/>')],
        ['word/document.xml', Buffer.from('<w:document/>')],
        [
          'word/_rels/document.xml.rels',
          Buffer.from(
            `<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`,
          ),
        ],
      ]),
    );

  // Reviewed and approved: exactly what the published fixtures carry today.
  const approved = [
    'https://superdoc.dev/',
    'https://www.harbourshare.com/',
    'http://www.betterbuildingspartnership.co.uk/working-groups/green-leases/green-lease-toolkit/',
    'https://en.wikipedia.org/wiki/Oscar_Wilde',
  ];

  // Everything else fails until someone reads it. A hyperlink in document
  // content is ordinarily just content, so this list is about the target being
  // unreviewed rather than about the host being external.
  const rejected = [
    'https://client.example/matter/123',
    // An owned host does not launder an unapproved path.
    'https://superdoc.dev/clients/acme-corp/matter-4471',
    'https://www.harbourshare.com/customers/acme',
    // Approved host, but not an encyclopedia article.
    'https://en.wikipedia.org/wiki/Special:Export?pages=x',
    'https://superdoc.dev/?matter=4471',
    'https://user:pass@example.org/x',
    'mailto:partner@clientfirm.com',
    'file:///T:/firmwide/matter.docx',
    '\\\\fileserver\\matters\\4471.docx',
    'http://192.168.1.50/intranet/matter',
    'http://localhost:8080/x',
    'ftp://files.clientfirm.com/matter',
  ];

  for (const target of approved) {
    it(`publishes the reviewed target ${target}`, () => {
      const source = withTarget(target);
      expect(inspectDocx(source).relationships).toEqual([]);
      expect(sanitizeDocxBuffer(source).changed).toBe(false);
    });
  }

  for (const target of rejected) {
    it(`fails and then clears the unreviewed target ${target}`, () => {
      const source = withTarget(target);
      // The gate reports it.
      expect(inspectDocx(source).relationships.length).toBeGreaterThan(0);
      // The cleanup clears it, so the fixture is fixable.
      const cleaned = sanitizeDocxBuffer(source);
      expect(cleaned.changed).toBe(true);
      expect(inspectDocx(cleaned.buffer).relationships).toEqual([]);
      // And the relationship still exists, so the r:id in the body resolves.
      const rels = readZipEntries(cleaned.buffer).get('word/_rels/document.xml.rels').toString();
      expect(rels).toContain('Id="rId9"');
      expect(rels).toContain('https://example.com/');
      expect(rels).not.toContain(target);
    });
  }

  it('sanitizes to a byte-identical result the second time', () => {
    const source = withTarget('https://client.example/matter/123');
    const once = sanitizeDocxBuffer(source).buffer;
    const twice = sanitizeDocxBuffer(once);
    expect(twice.changed).toBe(false);
    expect(twice.buffer.equals(once)).toBe(true);
  });
});

describe('gate and sanitizer agree, and neither destroys ordinary content', () => {
  const store = (item) =>
    writeZipEntries(
      new Map([
        ['[Content_Types].xml', Buffer.from('<Types/>')],
        ['customXml/item1.xml', Buffer.from(item)],
        ['customXml/itemProps1.xml', Buffer.from('<r/>')],
      ]),
    );

  it('leaves a custom store whose Class element is an ordinary word', () => {
    // `Assembly` and `Class` are only structural inside a Receivers block.
    const source = store('<school><Class>Biology</Class></school>');
    expect(inspectDocx(source).taxonomy).toEqual([]);
    expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/item1.xml')).toBe(true);
  });

  it('removes a store whose receivers name a third party', () => {
    const source = store(
      '<Receivers><Receiver><Assembly>Acme.ClientMatter.Receiver, V=1</Assembly></Receiver></Receivers>',
    );
    expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
    expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/item1.xml')).toBe(false);
  });

  it('leaves a store that merely describes a taxonomy attribute in prose', () => {
    // The words in element text declare nothing.
    const source = store('<notes>the attribute contentTypeName="Acme Matter" is explained here</notes>');
    expect(inspectDocx(source).taxonomy).toEqual([]);
    expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/item1.xml')).toBe(true);
  });

  it('does not rewrite field instructions', () => {
    // `w:instrText` is a field's instruction, not its result, so it is not on
    // the page. Substituting the synthetic stamp into it changed where an
    // INCLUDETEXT field pointed.
    const document = '<w:p><w:r><w:instrText> INCLUDETEXT "DMS-21251548" </w:instrText></w:r></w:p>';
    const source = makeDocx({ document });
    // The gate does not report it either, so the two agree.
    expect(inspectDocx(source).bodyStamps).toEqual([]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(source).buffer).get('word/document.xml').toString();
    expect(cleaned).toContain('INCLUDETEXT "DMS-21251548"');
  });

  it('reports and clears a HyperlinkBase pointing outside the reviewed list', () => {
    const app = '<Properties><HyperlinkBase>https://client.example/matter/123</HyperlinkBase></Properties>';
    const source = makeDocx({ app });
    expect(inspectDocx(source).identities.map((entry) => entry.kind)).toContain('HyperlinkBase');
    const cleaned = sanitizeDocxBuffer(source);
    expect(readZipEntries(cleaned.buffer).get('docProps/app.xml').toString()).not.toContain('client.example');
    expect(inspectDocx(cleaned.buffer).identities.map((entry) => entry.kind)).not.toContain('HyperlinkBase');

    // A reviewed base is left alone.
    const reviewed = makeDocx({ app: '<Properties><HyperlinkBase>https://superdoc.dev/</HyperlinkBase></Properties>' });
    expect(inspectDocx(reviewed).identities.map((entry) => entry.kind)).not.toContain('HyperlinkBase');
  });
});

describe('XML entities are resolved before content is judged', () => {
  it('reads and clears a stamp written with character references', () => {
    // A parser resolves entities before a reader sees the text, so
    // `ACME&#45;FILE` is `ACME-FILE` on the page.
    for (const text of ['ACME&#45;FILE VERSION 1.0a', 'ACME&#x2D;FILE VERSION 1.0a']) {
      const source = makeDocx({ footer: `<w:ftr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:ftr>` });
      expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
      const cleaned = sanitizeDocxBuffer(source);
      // Reported and cleared, so the fixture is fixable rather than stuck.
      expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
      expect(readZipEntries(cleaned.buffer).get('word/footer2.xml').toString()).not.toContain('ACME');
    }
  });

  it('reads and clears a customXml URL written with character references', () => {
    const source = makeDocx({
      customXml: {
        'item1.xml': '<p:properties><ns ref="https&#58;//client.example/x"/></p:properties>',
        'itemProps1.xml': '<r/>',
      },
    });
    expect(inspectDocx(source).taxonomy.length).toBeGreaterThan(0);
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).taxonomy).toEqual([]);
  });

  it('leaves a standards-host URL alone however it is written', () => {
    const source = makeDocx({
      customXml: {
        'item1.xml': '<p:properties><ns ref="https&#58;//schemas.microsoft.com/x"/></p:properties>',
        'itemProps1.xml': '<r/>',
      },
    });
    expect(inspectDocx(source).taxonomy).toEqual([]);
  });
});

describe('entity handling does not corrupt what it rewrites', () => {
  it('keeps surrounding text and entities intact when redacting a stamp', () => {
    // Offsets computed on decoded text but applied to raw XML split `&amp;`
    // into `&a` and left fragments of the stamp behind.
    const footer = '<w:ftr><w:p><w:r><w:t>&amp; ACME-FILE VERSION 1.0a tail</w:t></w:r></w:p></w:ftr>';
    const cleaned = sanitizeDocxBuffer(makeDocx({ footer })).buffer;
    const text = /<w:t>([\s\S]*?)<\/w:t>/.exec(readZipEntries(cleaned).get('word/footer2.xml').toString())[1];
    expect(text).toContain('&amp;');
    expect(text).toContain('tail');
    expect(text).not.toContain('ACME');
    // And the rewritten part is still clean on a second pass.
    expect(inspectDocx(cleaned).bodyStamps).toEqual([]);
  });

  it('reads an external relationship whose TargetMode is encoded', () => {
    // An XML reader resolves character references before OPC sees the value.
    const source = writeZipEntries(
      new Map([
        ['[Content_Types].xml', Buffer.from('<Types/>')],
        ['word/document.xml', Buffer.from('<w:document/>')],
        [
          'word/_rels/document.xml.rels',
          Buffer.from(
            '<Relationships><Relationship Id="rId9" Target="https://client.example/matter/1" TargetMode="Extern&#x61;l"/></Relationships>',
          ),
        ],
      ]),
    );
    expect(inspectDocx(source).relationships.length).toBeGreaterThan(0);
    expect(inspectDocx(sanitizeDocxBuffer(source).buffer).relationships).toEqual([]);
  });

  it('scans footnotes and endnotes, which render like headers and footers', () => {
    for (const part of ['footnotes', 'endnotes']) {
      const source = makeDocx({
        parts: { [`${part}.xml`]: '<w:x><w:p><w:r><w:t>ACME-FILE VERSION 1.0a</w:t></w:r></w:p></w:x>' },
      });
      expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
      const cleaned = sanitizeDocxBuffer(source);
      expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
    }
  });

  it('leaves an approved HyperlinkBase in place', () => {
    // Clearing a reviewed base rewrites a clean fixture and changes where its
    // relative hyperlinks resolve.
    const approved = makeDocx({ app: '<Properties><HyperlinkBase>https://superdoc.dev/</HyperlinkBase></Properties>' });
    const cleaned = sanitizeDocxBuffer(approved);
    expect(cleaned.changed).toBe(false);
    expect(readZipEntries(cleaned.buffer).get('docProps/app.xml').toString()).toContain('superdoc.dev');

    // An unreviewed one is still cleared.
    const rejected = makeDocx({
      app: '<Properties><HyperlinkBase>https://client.example/matter/1</HyperlinkBase></Properties>',
    });
    expect(readZipEntries(sanitizeDocxBuffer(rejected).buffer).get('docProps/app.xml').toString()).not.toContain(
      'client.example',
    );
  });

  it('scans comment bodies, which render in the comment pane', () => {
    // An approved synthetic author does not make the comment text invisible.
    const parts = {
      'comments.xml':
        '<w:comments><w:comment w:author="SuperDoc Test User"><w:p><w:r><w:t>ACME-FILE VERSION 1.0a</w:t></w:r></w:p></w:comment></w:comments>',
    };
    const source = makeDocx({ parts });
    expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
    const cleaned = sanitizeDocxBuffer(source);
    expect(cleaned.changed).toBe(true);
    expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
  });
});

describe('attribute and payload boundaries are respected', () => {
  const withTarget = (target) =>
    writeZipEntries(
      new Map([
        ['[Content_Types].xml', Buffer.from('<Types/>')],
        ['word/document.xml', Buffer.from('<w:document/>')],
        [
          'word/_rels/document.xml.rels',
          Buffer.from(
            `<Relationships><Relationship Id="rId9" Target="${target}" TargetMode="External"/></Relationships>`,
          ),
        ],
      ]),
    );

  it('does not let an encoded quote truncate a relationship target', () => {
    // Decoding the whole element first turns `&#34;` into a delimiter, so
    // `https://superdoc.dev/&#34;customer` read as the approved root and the
    // rest of the URL was published.
    expect(inspectDocx(withTarget('https://superdoc.dev/&#34;customer')).relationships.length).toBeGreaterThan(0);
    // The genuinely approved target is still approved.
    expect(inspectDocx(withTarget('https://superdoc.dev/')).relationships).toEqual([]);
    // And an encoded TargetMode is still recognised as external.
    const encodedMode = writeZipEntries(
      new Map([
        ['[Content_Types].xml', Buffer.from('<Types/>')],
        ['word/document.xml', Buffer.from('<w:document/>')],
        [
          'word/_rels/document.xml.rels',
          Buffer.from(
            '<Relationships><Relationship Id="rId9" Target="https://client.example/m" TargetMode="Extern&#x61;l"/></Relationships>',
          ),
        ],
      ]),
    );
    expect(inspectDocx(encodedMode).relationships.length).toBeGreaterThan(0);
  });

  it('keeps a CDATA section a CDATA section when redacting', () => {
    // Escaping the payload turned `<![CDATA[…]]>` into visible text.
    const footer = '<w:ftr><w:p><w:r><w:t><![CDATA[ACME-FILE VERSION 1.0a]]></w:t></w:r></w:p></w:ftr>';
    const source = makeDocx({ footer });
    expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
    const cleaned = sanitizeDocxBuffer(source);
    const text = readZipEntries(cleaned.buffer).get('word/footer2.xml').toString();
    expect(text).toContain('<![CDATA[SUPERDOC-TEST VERSION 1.0a]]>');
    expect(text).not.toContain('&lt;![CDATA[');
    expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
  });

  it('does not let an allowlisted host launder credentials or query material', () => {
    const store = (url) =>
      makeDocx({
        customXml: { 'item1.xml': `<p:properties><ns ref="${url}"/></p:properties>`, 'itemProps1.xml': '<r/>' },
      });
    for (const url of [
      'https://user:pass@schemas.microsoft.com/office/s',
      'https://schemas.microsoft.com/s?client=acme',
      'https://schemas.microsoft.com/s#acme',
    ]) {
      expect(inspectDocx(store(url)).taxonomy.length).toBeGreaterThan(0);
    }
    // The ordinary standards namespaces real fixtures carry stay clean.
    for (const url of [
      'https://schemas.microsoft.com/office/2006/metadata/properties',
      'http://schemas.openxmlformats.org/officeDocument/2006/customXml',
    ]) {
      expect(inspectDocx(store(url)).taxonomy).toEqual([]);
    }
  });

  it('scans numbered comment and note parts, not only the canonical names', () => {
    for (const part of ['comments1', 'commentsExtended', 'footnotes2', 'endnotes1']) {
      const source = makeDocx({
        parts: { [`${part}.xml`]: '<w:x><w:p><w:r><w:t>ACME-FILE VERSION 1.0a</w:t></w:r></w:p></w:x>' },
      });
      expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
    }
  });

  it('reads a stamp split across mixed or adjacent CDATA sections', () => {
    // A text node may mix ordinary data with CDATA, or hold several sections
    // side by side; both render as one string.
    for (const inner of ['ACME-FILE<![CDATA[ VERSION 1.0a]]>', '<![CDATA[ACME-FILE]]><![CDATA[ VERSION 1.0a]]>']) {
      const source = makeDocx({ footer: `<w:ftr><w:p><w:r><w:t>${inner}</w:t></w:r></w:p></w:ftr>` });
      expect(inspectDocx(source).bodyStamps.length).toBeGreaterThan(0);
      const cleaned = sanitizeDocxBuffer(source);
      expect(readZipEntries(cleaned.buffer).get('word/footer2.xml').toString()).not.toContain('ACME');
      expect(inspectDocx(cleaned.buffer).bodyStamps).toEqual([]);
    }
  });

  it('drops a relationship whose target is entity-encoded', () => {
    // `Target="../customXml/item&#49;.xml"` names item1.xml to an OPC reader.
    const entries = new Map([
      ['[Content_Types].xml', Buffer.from('<Types/>')],
      ['customXml/item1.xml', Buffer.from('<root/>')],
      ['customXml/itemProps1.xml', Buffer.from('<r ma:contentTypeName="Acme Matter"/>')],
      [
        'word/_rels/document.xml.rels',
        Buffer.from('<Relationships><Relationship Id="rId1" Target="../customXml/item&#49;.xml"/></Relationships>'),
      ],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
    expect(cleaned.has('customXml/item1.xml')).toBe(false);
    expect(cleaned.get('word/_rels/document.xml.rels').toString()).not.toContain('customXml/item');
  });

  it('reads author attributes from start tags, not from visible prose', () => {
    // A fixture can contain OOXML prose or a code sample in its body text;
    // rewriting that changes the document's content rather than its metadata.
    const document =
      '<w:document><w:p><w:r><w:t>Example w:author="Jane Doe" in a sample</w:t></w:r></w:p></w:document>';
    const source = makeDocx({ document });
    expect(inspectDocx(source).identities).toEqual([]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(source).buffer).get('word/document.xml').toString();
    expect(cleaned).toContain('Jane Doe');
    expect(cleaned).not.toContain('SuperDoc Test User');

    // Real attributes are still reported and rewritten, in every spelling.
    for (const tag of [
      '<w:ins w:author="Real Person"/>',
      '<w:ins w:author = "Real Person"/>',
      '<x:ins x:author="Real Person"/>',
    ]) {
      const real = makeDocx({ document: `<w:document>${tag}</w:document>` });
      expect(inspectDocx(real).identities.length).toBeGreaterThan(0);
      expect(readZipEntries(sanitizeDocxBuffer(real).buffer).get('word/document.xml').toString()).not.toContain(
        'Real Person',
      );
    }
  });

  it('drops content-type overrides and links whatever their spelling or part', () => {
    // An encoded PartName names the same override; a customXml store can be
    // linked from a header rather than the document.
    const entries = new Map([
      [
        '[Content_Types].xml',
        Buffer.from('<Types><Override PartName="/customXml/itemProps&#49;.xml" ContentType="x"/></Types>'),
      ],
      ['customXml/item1.xml', Buffer.from('<root/>')],
      ['customXml/itemProps1.xml', Buffer.from('<r ma:contentTypeName="Acme Matter"/>')],
      [
        'word/_rels/header1.xml.rels',
        Buffer.from('<Relationships><Relationship Id="rId1" Target="../customXml/item1.xml"/></Relationships>'),
      ],
    ]);
    const cleaned = readZipEntries(sanitizeDocxBuffer(writeZipEntries(entries)).buffer);
    expect(cleaned.has('customXml/itemProps1.xml')).toBe(false);
    expect(cleaned.get('[Content_Types].xml').toString()).not.toContain('itemProps');
    expect(cleaned.get('word/_rels/header1.xml.rels').toString()).not.toContain('customXml/item1.xml');
  });

  it('does not let a quoted angle bracket end a start tag', () => {
    // `[^>]*` stopped at the `>` inside the attribute value and dropped every
    // later attribute, including the author.
    const document = '<w:document><w:ins data=">" w:author="Real Person"/></w:document>';
    const source = makeDocx({ document });
    expect(inspectDocx(source).identities.map((entry) => entry.value)).toContain('Real Person');
    expect(readZipEntries(sanitizeDocxBuffer(source).buffer).get('word/document.xml').toString()).not.toContain(
      'Real Person',
    );
  });

  it('survives an unmatched CDATA marker', () => {
    // An unclosed `<![CDATA[` inside a comment made the decoder re-enter itself
    // on the same tail until Node threw, taking the whole scan with it.
    const source = makeDocx({ customXml: { 'item1.xml': '<r><!-- <![CDATA[ example --></r>' } });
    expect(() => inspectDocx(source)).not.toThrow();
    // A properly closed section is still read.
    const closed = makeDocx({
      footer: '<w:ftr><w:p><w:r><w:t><![CDATA[ACME-FILE VERSION 1.0a]]></w:t></w:r></w:p></w:ftr>',
    });
    expect(inspectDocx(closed).bodyStamps.length).toBeGreaterThan(0);
  });
});

describe('parser hardening', () => {
  it('matches an element whose attribute value contains a quoted angle bracket', () => {
    // `[^>]*` stopped at the first `>` even inside a quoted value, so this
    // element was never inspected and its external target survived both the
    // gate and sanitization.
    const evasive = '<Relationship ext:data=">" Target="https://client.example/" TargetMode="External"/>';
    expect([...evasive.matchAll(emptyElementPattern('Relationship'))]).toHaveLength(1);
    expect([...`<dc:creator attr=">">Real Name</dc:creator>`.matchAll(pairedElementPattern('creator'))]).toHaveLength(
      1,
    );
  });

  it('ignores a forged EOCD hidden in the archive comment', () => {
    // A ZIP comment is arbitrary bytes, so it can carry an EOCD signature. A
    // backward scan reaches that forgery first, and a zero-entry record makes
    // every part look absent: the gate then reports an identity-bearing
    // document as clean. Verified against a real fixture before the fix.
    const archive = makeDocx({ core: '<dc:creator>Real Name</dc:creator>' });
    expect(inspectDocx(archive).identities).toHaveLength(1);

    const forged = Buffer.alloc(22);
    forged.writeUInt32LE(0x06054b50, 0); // zero entries, zero offset, zero comment
    const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const head = Buffer.from(archive);
    head.writeUInt16LE(forged.length, eocd + 20); // real record now declares the forgery as its comment

    const attacked = Buffer.concat([head, forged]);
    expect(inspectDocx(attacked).identities).toHaveLength(1);
  });

  it('ignores a forged EOCD that under-declares its entry count', () => {
    // A forgery can reuse the genuine directory offset and size while claiming
    // fewer entries. Every signature check passes, the reader stops early, and
    // an identity in a later entry is never read.
    const archive = makeDocx({ core: '<dc:creator>Real Name</dc:creator>' });
    expect(inspectDocx(archive).identities).toHaveLength(1);

    const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const directorySize = archive.readUInt32LE(eocd + 12);
    const directoryOffset = archive.readUInt32LE(eocd + 16);
    const realCount = archive.readUInt16LE(eocd + 10);
    expect(realCount).toBeGreaterThan(1);

    const forged = Buffer.alloc(22);
    forged.writeUInt32LE(0x06054b50, 0);
    forged.writeUInt16LE(1, 8);
    forged.writeUInt16LE(1, 10); // one entry, not the real count
    forged.writeUInt32LE(directorySize, 12); // real size
    forged.writeUInt32LE(directoryOffset, 16); // real offset
    const head = Buffer.from(archive);
    head.writeUInt16LE(forged.length, eocd + 20);

    expect(inspectDocx(Buffer.concat([head, forged])).identities).toHaveLength(1);
  });

  it('ignores a forged EOCD whose directory does not end at the record', () => {
    // The sharper form of the under-declared count: claim one entry AND the size
    // of just that entry. Internally consistent, points at a real directory, and
    // still stops the reader before the entry holding the identity. Only
    // anchoring the directory end to the record itself rules it out.
    const archive = makeDocx({ core: '<dc:creator>Real Name</dc:creator>' });
    expect(inspectDocx(archive).identities).toHaveLength(1);

    const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const directoryOffset = archive.readUInt32LE(eocd + 16);
    const nameLength = archive.readUInt16LE(directoryOffset + 28);
    const extraLength = archive.readUInt16LE(directoryOffset + 30);
    const commentLength = archive.readUInt16LE(directoryOffset + 32);

    const forged = Buffer.alloc(22);
    forged.writeUInt32LE(0x06054b50, 0);
    forged.writeUInt16LE(1, 8);
    forged.writeUInt16LE(1, 10);
    forged.writeUInt32LE(46 + nameLength + extraLength + commentLength, 12); // just entry one
    forged.writeUInt32LE(directoryOffset, 16);
    const head = Buffer.from(archive);
    head.writeUInt16LE(forged.length, eocd + 20);

    expect(inspectDocx(Buffer.concat([head, forged])).identities).toHaveLength(1);
  });

  it('inspects every occurrence, so an approved value cannot mask a later one', () => {
    // The gate suppresses approved synthetic values, so reading only the first
    // occurrence let `SuperDoc` stand in front of a real name and carry the
    // whole document past the check.
    const shadowed = makeDocx({
      core: '<dc:creator>SuperDoc</dc:creator><dc:creator>Jane Doe</dc:creator>',
    });
    expect(inspectDocx(shadowed).identities.map((identity) => identity.value)).toContain('Jane Doe');

    // Same shape for the non-identity fields that also read a single value.
    const masked = makeDocx({
      app: '<Template>Normal.dotm</Template><Template>ClientSecret.dotx</Template>',
    });
    expect(inspectDocx(masked).identities.map((identity) => identity.value)).toContain('ClientSecret.dotx');
  });

  it('does not let a commented value shadow live metadata', () => {
    // Scanning raw XML treats a commented element as live, and taking the first
    // match let an approved value inside a comment hide a real identity after
    // it: the gate passed while the document still published the name.
    const shadowed = makeDocx({
      core: '<!-- <dc:creator>SuperDoc</dc:creator> --><dc:creator>Jane Doe</dc:creator>',
    });
    expect(inspectDocx(shadowed).identities.map((identity) => identity.value)).toContain('Jane Doe');
  });

  it('rejects an archive whose central directory is malformed', () => {
    // Returning the entries parsed so far made a truncated archive look like
    // one that simply lacks the part holding an author, so the gate reported it
    // clean. It has to fail closed instead.
    const archive = makeDocx({ core: '<dc:creator>Real Name</dc:creator>' });
    const corrupted = Buffer.from(archive);
    const eocd = corrupted.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    corrupted.writeUInt32LE(0xdeadbeef, corrupted.readUInt32LE(eocd + 16));

    expect(() => readZipEntries(corrupted)).toThrow();

    // inspectDocx propagates rather than returning a clean result. The gate
    // catches that and records the archive as unreadable, which is the whole
    // point: a corrupt archive must never come back with no findings.
    expect(() => inspectDocx(corrupted)).toThrow();
  });
});

describe('named privacy rules', () => {
  const identityValues = (source) => inspectDocx(source).identities.map((identity) => `${identity.kind}|${identity.value}`);
  const withRelationshipParts = (parts) =>
    writeZipEntries(new Map([['[Content_Types].xml', Buffer.from('<Types/>')], ...Object.entries(parts).map(([name, xml]) => [name, Buffer.from(xml)])]));

  it('treats each schema host and each RFC 2606 reserved host as a standards namespace, and nothing near them', () => {
    for (const host of [
      'schemas.microsoft.com',
      'schemas.openxmlformats.org',
      'purl.org',
      'www.w3.org',
      'w3.org',
      'dublincore.org',
      'example.com',
      'example.org',
      'example.net',
    ]) {
      expect(isStandardsNamespace(`https://${host}/schema`), host).toBe(true);
      expect(isStandardsNamespace(`https://${host.toUpperCase()}/schema`), host).toBe(true);
    }
    for (const host of ['sub.purl.org', 'w3.org.evil', 'example.co', 'acme.example', 'schemas.microsoft.net']) {
      expect(isStandardsNamespace(`https://${host}/schema`), host).toBe(false);
    }
    expect(isStandardsNamespace('not a url')).toBe(false);
  });

  it('reads each Word default content-type name, including an empty one, as generic', () => {
    for (const value of ['document', 'doc', 'item', '', '  ']) {
      expect(isGenericContentTypeName(value), JSON.stringify(value)).toBe(true);
    }
    for (const value of ['documents', 'items', 'Acme']) {
      expect(isGenericContentTypeName(value), value).toBe(false);
    }
    const empty = makeDocx({ customXml: { 'itemProps1.xml': '<r ma:contentTypeName=""/>' } });
    expect(inspectDocx(empty).taxonomy).toEqual([]);
  });

  it('skips receivers shipped as Microsoft or System assemblies and reports the rest', () => {
    const receivers = (name) => `<Receivers><Receiver><Assembly>${name}</Assembly></Receiver></Receivers>`;
    expect(organizationReceivers(receivers('Microsoft.SharePoint, V=1'))).toEqual([]);
    expect(organizationReceivers(receivers('System.Web, V=1'))).toEqual([]);
    expect(organizationReceivers(receivers('Systematic.Receivers, V=1'))).toEqual([
      { tag: 'Assembly', value: 'Systematic.Receivers, V=1' },
    ]);
    expect(organizationReceivers('<Receivers><Receiver><Class>Acme.Handler</Class></Receiver></Receivers>')).toEqual([
      { tag: 'Class', value: 'Acme.Handler' },
    ]);
    expect(organizationReceivers('<Receivers><Receiver><Name>Acme.Handler</Name></Receiver></Receivers>')).toEqual([]);
  });

  it('reports a document-management reference number in visible text under each system prefix', () => {
    for (const reference of ['DMS-21251548', 'NRPORTBL 4471', 'IMANAGE_123456', 'EDOCS99887', 'dms-21251548']) {
      const source = makeDocx({ footer: `<w:ftr><w:p><w:r><w:t>Ref ${reference}</w:t></w:r></w:p></w:ftr>` });
      const expected = reference === 'dms-21251548' ? [] : [`word/footer2.xml: ${reference}`];
      expect(inspectDocx(source).bodyStamps, reference).toEqual(expected);
    }
    const tooShort = makeDocx({ footer: '<w:ftr><w:p><w:r><w:t>DMS-123</w:t></w:r></w:p></w:ftr>' });
    expect(inspectDocx(tooShort).bodyStamps).toEqual([]);
  });

  it('reports a stamp that both visible-text readings find once', () => {
    const source = makeDocx({ footer: '<w:ftr><w:p><w:r><w:t>ACME-FILE VERSION 1.0a</w:t></w:r></w:p></w:ftr>' });
    expect(inspectDocx(source).bodyStamps).toEqual(['word/footer2.xml: ACME-FILE VERSION 1.0a']);
  });

  it('reads only the parts a reader sees for stamps', () => {
    const stamp = '<w:x><w:p><w:r><w:t>ACME-FILE VERSION 1.0a</w:t></w:r></w:p></w:x>';
    for (const part of [
      'document.xml',
      'document2.xml',
      'header1.xml',
      'footer3.xml',
      'footnotes.xml',
      'endnotes.xml',
      'comments.xml',
      'commentsExtended.xml',
      'commentsIds.xml',
    ]) {
      expect(inspectDocx(makeDocx({ parts: { [part]: stamp } })).bodyStamps, part).toHaveLength(1);
    }
    for (const part of ['settings.xml', 'styles.xml', 'glossary/document.xml']) {
      expect(inspectDocx(makeDocx({ parts: { [part]: stamp } })).bodyStamps, part).toEqual([]);
    }
  });

  it('ignores each tool bookkeeping property and reports every other custom property', () => {
    const property = (name) => `<property name="${name}"><vt:lpwstr>v</vt:lpwstr></property>`;
    const tools = ['SuperdocVersion', 'DocumentGuid', 'Created', 'Producer', 'LastSaved', 'AppVersion'];
    const custom = `<Properties>${[...tools, 'Creator', 'Reviewer'].map(property).join('')}</Properties>`;
    expect(identityValues(makeDocx({ custom }))).toEqual(['custom-property|Creator=v', 'custom-property|Reviewer=v']);
  });

  it('classifies each document-management property name by its name alone', () => {
    const managed = [
      '_dlc_DocId',
      'ContentTypeId',
      'eDOCSAuthor',
      'iManageWorkspace',
      'NRPortblLibrary',
      'ClientID',
      'MatterID',
      'db_contract_ref',
      'Firm-Document-ID',
      'clientid',
    ];
    const ordinary = ['ClientIDs', 'XContentTypeId', 'MatterIDx', 'Document-ID-Copy'];
    const property = (name) => `<property name="${name}"><vt:lpwstr></vt:lpwstr></property>`;
    const custom = `<Properties>${[...managed, ...ordinary].map(property).join('')}</Properties>`;
    expect(identityValues(makeDocx({ custom }))).toEqual([
      ...managed.map((name) => `dms-property|${name}`),
      ...ordinary.map((name) => `custom-property|${name}`),
    ]);
  });

  it('reports every core and app identity field, in property order', () => {
    const core =
      '<cp:coreProperties><dc:description>D</dc:description><cp:keywords>K</cp:keywords><dc:subject>S</dc:subject>' +
      '<dc:title>T</dc:title><cp:lastModifiedBy>L</cp:lastModifiedBy><dc:creator>C</dc:creator></cp:coreProperties>';
    const app = '<Properties><Manager>M</Manager><Company>Co</Company></Properties>';
    expect(identityValues(makeDocx({ core, app }))).toEqual([
      'dc:creator|C',
      'cp:lastModifiedBy|L',
      'dc:title|T',
      'dc:subject|S',
      'cp:keywords|K',
      'dc:description|D',
      'Company|Co',
      'Manager|M',
    ]);
  });

  it('reads every HyperlinkBase, so an approved one cannot mask a later one', () => {
    const app =
      '<Properties><HyperlinkBase>https://superdoc.dev/</HyperlinkBase><HyperlinkBase>https://client.example/m</HyperlinkBase></Properties>';
    expect(identityValues(makeDocx({ app }))).toEqual([
      'HyperlinkBase|unreviewed external target https://client.example/m',
    ]);
  });

  it('reports reviewer author, initials and account id per part, in that order', () => {
    const document = '<w:document><w15:p w:userId="U" w:initials="I" w:author="A"/></w:document>';
    expect(identityValues(makeDocx({ document }))).toEqual(['w:author|A', 'w:initials|I', 'w15:userId|U']);
  });

  it('names each private or local network host as such', () => {
    for (const host of [
      'localhost',
      '[::1]',
      'printer.local',
      'wiki.internal',
      'intranet',
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.1.1',
      '0.0.0.0',
    ]) {
      expect(relationshipTargetProblem(`http://${host}/x`), host).toBe('private or local network target');
    }
    for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1']) {
      expect(relationshipTargetProblem(`http://${host}/x`), host).toBe('unreviewed external target');
    }
  });

  it('gives the reason each unpublishable target fails', () => {
    expect(relationshipTargetProblem('')).toBeNull();
    expect(relationshipTargetProblem('  ')).toBeNull();
    expect(relationshipTargetProblem(undefined)).toBeNull();
    expect(relationshipTargetProblem('\\\\server\\share\\a.docx')).toBe('unparseable external target');
    expect(relationshipTargetProblem('https://u:p@client.example/')).toBe('credentials in an external target');
    expect(relationshipTargetProblem('MAILTO:a@client.example')).toBe('email target');
    expect(relationshipTargetProblem('file:///T:/a.docx')).toBe('file target');
    expect(relationshipTargetProblem('ftp://client.example/a')).toBe('ftp target');
    expect(relationshipTargetProblem('https://client.example/a#b')).toBe('external target carrying query or fragment');
    expect(relationshipTargetProblem('https://client.example/a')).toBe('unreviewed external target');
  });

  it('approves only exact reviewed targets and encyclopedia articles', () => {
    expect(relationshipTargetProblem(' https://superdoc.dev/ ')).toBeNull();
    expect(relationshipTargetProblem('https://superdoc.dev')).toBe('unreviewed external target');
    expect(relationshipTargetProblem('https://en.wikipedia.org/wiki/Ada_Lovelace_(1815)')).toBeNull();
    expect(relationshipTargetProblem('https://en.wikipedia.org/wiki/A/B')).toBe('unreviewed external target');
    expect(relationshipTargetProblem('http://en.wikipedia.org/wiki/Ada')).toBe('unreviewed external target');
  });

  it('approves an RFC 2606 reserved host only after every other check passes', () => {
    for (const target of ['https://example.com/a', 'http://docs.example.org/a', 'https://EXAMPLE.NET/']) {
      expect(relationshipTargetProblem(target), target).toBeNull();
    }
    expect(relationshipTargetProblem('https://u:p@example.com/')).toBe('credentials in an external target');
    expect(relationshipTargetProblem('ftp://example.com/a')).toBe('ftp target');
    expect(relationshipTargetProblem('mailto:a@example.com')).toBe('email target');
    expect(relationshipTargetProblem('https://example.com/?client=acme')).toBe(
      'external target carrying query or fragment',
    );
    expect(relationshipTargetProblem('https://example.com.client.test/')).toBe('unreviewed external target');
  });

  it('reads external relationships in every relationships part, whatever the case of the target mode', () => {
    const rel = (mode) =>
      `<Relationships><Relationship Id="r1" Target="https://client.example/m" TargetMode="${mode}"/></Relationships>`;
    const source = withRelationshipParts({
      'word/_rels/footer1.xml.rels': rel('external'),
      'customXml/_rels/item1.xml.rels': rel('EXTERNAL'),
      'word/_rels/document.xml.rels': rel('Internal'),
      'word/rels/document.xml.rels': rel('External'),
      'word/_rels/nested/document.xml.rels': rel('External'),
    });
    expect(inspectDocx(source).relationships).toEqual([
      'word/_rels/footer1.xml.rels: unreviewed external target https://client.example/m',
      'customXml/_rels/item1.xml.rels: unreviewed external target https://client.example/m',
    ]);
  });

  it('reads identities from every word part but taxonomy only from custom XML store parts', () => {
    const source = withRelationshipParts({
      'word/glossary/document.xml': '<w:x w:author="Glossary Person"/>',
      'docProps/other.xml': '<w:x w:author="Not Read"/>',
      'customXml/item12.xml': '<r ma:contentTypeName="Acme A"/>',
      'customXml/itemProps3.xml': '<r ma:contentTypeName="Acme B"/>',
      'customXml/notes.xml': '<r ma:contentTypeName="Acme C"/>',
      'word/item1.xml': '<r ma:contentTypeName="Acme D"/>',
    });
    const report = inspectDocx(source);
    expect(report.identities).toEqual([{ kind: 'w:author', value: 'Glossary Person' }]);
    expect(report.taxonomy).toEqual([
      'customXml/item12.xml: contentTypeName="Acme A"',
      'customXml/itemProps3.xml: contentTypeName="Acme B"',
    ]);
  });

  it('reports each custom XML finding in its own format, naming a receiver without its assembly version', () => {
    const item =
      '<r ma:contentTypeName="Acme Matter"><Receivers><Receiver><Assembly>Acme.Receivers, Version=1.0, Culture=neutral</Assembly></Receiver></Receivers>' +
      '<ref>https://client.example/schema</ref></r>';
    expect(inspectDocx(makeDocx({ customXml: { 'item1.xml': item } })).taxonomy).toEqual([
      'customXml/item1.xml: contentTypeName="Acme Matter"',
      'customXml/item1.xml: <Assembly>Acme.Receivers',
      'customXml/item1.xml: external URL https://client.example/schema',
    ]);
  });

  it('reads a contentTypeName with or without a namespace prefix, in document order', () => {
    const source = makeDocx({
      customXml: {
        'itemProps1.xml': '<r contentTypeName="Acme First"/><r x:contentTypeName="Acme Second" ma:contentTypeName="Acme Third"/>',
      },
    });
    expect(inspectDocx(source).taxonomy).toEqual([
      'customXml/itemProps1.xml: contentTypeName="Acme First"',
      'customXml/itemProps1.xml: contentTypeName="Acme Second"',
      'customXml/itemProps1.xml: contentTypeName="Acme Third"',
    ]);
    expect(readZipEntries(sanitizeDocxBuffer(makeDocx({ customXml: { 'item1.xml': '<root/>', 'itemProps1.xml': '<r contentTypeName="Acme"/>' } })).buffer).has('customXml/itemProps1.xml')).toBe(false);
  });

  it('does not read a contentTypeName written inside an XML comment', () => {
    const source = makeDocx({
      customXml: { 'item1.xml': '<root/>', 'itemProps1.xml': '<r><!-- contentTypeName="Acme Matter" --></r>' },
    });
    expect(inspectDocx(source).taxonomy).toEqual([]);
    expect(readZipEntries(sanitizeDocxBuffer(source).buffer).has('customXml/itemProps1.xml')).toBe(true);
  });

  it('still reports a reviewed relationship target found inside custom XML', () => {
    const source = makeDocx({ customXml: { 'item1.xml': '<r ref="https://superdoc.dev/"/>' } });
    expect(inspectDocx(source).taxonomy).toEqual(['customXml/item1.xml: external URL https://superdoc.dev/']);
  });

  it('approves only plain encyclopedia article paths', () => {
    expect(relationshipTargetProblem('https://en.wikipedia.org/wiki/Special:Export')).toBe('unreviewed external target');
    expect(relationshipTargetProblem('https://en.wikipedia.org/wiki/Ada?client=acme')).toBe(
      'external target carrying query or fragment',
    );
  });

  it('blanks an XML comment in place, so it never joins the text around it into an element', () => {
    const core = '<cp:coreProperties><dc:crea<!---->tor>Jane Doe</dc:crea<!---->tor></cp:coreProperties>';
    expect(inspectDocx(makeDocx({ core })).identities).toEqual([]);
  });

  it('does not report a value that only appears inside an XML comment', () => {
    const core = '<cp:coreProperties><!-- <dc:creator>Former Author</dc:creator> --></cp:coreProperties>';
    expect(inspectDocx(makeDocx({ core })).identities).toEqual([]);
  });

  it('reads a visible part only at its own path under word/', () => {
    const stamp = '<w:x><w:p><w:r><w:t>ACME-FILE VERSION 1.0a</w:t></w:r></w:p></w:x>';
    const source = withRelationshipParts({ 'archive/word/footer1.xml': stamp, 'word/footer1.xml.bak': stamp });
    expect(inspectDocx(source).bodyStamps).toEqual([]);
  });

  it('reads a relationship as external only when its target mode is exactly External', () => {
    for (const mode of ['NotExternal', 'External2', 'External ']) {
      const source = withRelationshipParts({
        'word/_rels/document.xml.rels': `<Relationships><Relationship Id="r1" Target="https://client.example/m" TargetMode="${mode}"/></Relationships>`,
      });
      expect(inspectDocx(source).relationships, mode).toEqual([]);
    }
  });

  it('reads a document as encrypted only when it carries the whole OLE signature', () => {
    const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    expect(isEncryptedDocx(Buffer.from(magic))).toBe(true);
    expect(isEncryptedDocx(Buffer.from(magic.slice(0, 7)))).toBe(false);
    expect(isEncryptedDocx(Buffer.from([...magic.slice(0, 7), 0x00, 0x00]))).toBe(false);
    expect(isEncryptedDocx(Buffer.from([0xd0, ...magic.slice(1).map(() => 0)]))).toBe(false);
  });

  it('matches an empty element in both its self-closing and explicit-end spellings', () => {
    const pattern = emptyElementPattern('Relationship');
    expect('<Relationship a="1"/>'.match(pattern)).toHaveLength(1);
    expect('<p:Relationship a="1" ></p:Relationship >'.match(pattern)).toHaveLength(1);
    expect('<Relationship a="1">text</Relationship>'.match(pattern)).toBeNull();
  });
});
