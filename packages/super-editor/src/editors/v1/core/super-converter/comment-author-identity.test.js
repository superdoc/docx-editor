/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import * as xmljs from 'xml-js';
import {
  captureCommentAuthorSource,
  generatedCommentAuthorRows,
  hasLocalCommentAuthorSourceConflict,
  readCommentAuthorSourceRows,
  commentPeopleUpdatedFiles,
  importedWordIdentity,
  prepareCommentAuthors,
  readPeoplePart,
  resolvePeopleTarget,
  PEOPLE_NAMESPACE as P,
  PEOPLE_RELATIONSHIP as R,
} from './comment-author-identity.js';

const rels = (target = 'people.xml') =>
  xmljs.xml2js(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}" Target="${target}"/></Relationships>`,
  );
const emptyRels = () =>
  xmljs.xml2js(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="urn:unrelated" Target="people.xml"/></Relationships>',
  );
const author = (id, userId = id, extra = {}) => ({
  commentId: id,
  creatorName: 'Alex',
  creatorId: 'same-app-id',
  creatorEmail: 'same@example.com',
  creatorIdentity: { providerId: 'AD', userId },
  ...extra,
});
const plan = (comments, options = {}) => {
  const convertedXml = options.convertedXml || { 'word/_rels/document.xml.rels': emptyRels() };
  return prepareCommentAuthors({
    comments,
    convertedXml,
    source: captureCommentAuthorSource(convertedXml),
    ...options,
  });
};
const labels = (result) => Object.fromEntries(result.comments.map((c) => [c.commentId, c.wordAuthorName]));

describe('Word author label allocation and people preservation', () => {
  it('accepts only matching generated ingress rows and never demotes imported ownership', () => {
    const tree = (rows) =>
      xmljs.xml2js(
        `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${rows}</w:comments>`,
      );
    const row = (id, name) => `<w:comment w:internalId="${id}" w:author="${name}"/>`;
    const convertedXml = { 'word/comments.xml': tree(row('old', 'Imported')) };
    const original = captureCommentAuthorSource(convertedXml);
    convertedXml['word/comments.xml'] = tree(
      row('old', 'Imported') + row('local', 'Generated') + row('new-source', 'Incoming'),
    );
    const metadata = [
      ['old', 'Imported'],
      ['local', 'Generated'],
      ['new-source', 'Spoof'],
      ['absent', 'Ignored'],
      null,
      [12, 'Ignored'],
    ];
    const source = captureCommentAuthorSource(convertedXml, [], original, metadata);
    expect([...source.comments.keys()]).toEqual(['old', 'new-source']);
    expect([...source.localCommentIds]).toEqual(['local']);
    expect(generatedCommentAuthorRows(convertedXml['word/comments.xml'], source)).toEqual([['local', 'Generated']]);
    // Raw/schema import owns every row regardless of attached transport assertions.
    expect(captureCommentAuthorSource(convertedXml, [], undefined, metadata).comments.size).toBe(3);
    for (const malformed of [null, {}, 'local']) {
      expect(captureCommentAuthorSource(convertedXml, [], original, malformed).comments.size).toBe(3);
    }
    expect(original.comments.size).toBe(1);
    expect(original.localCommentIds.size).toBe(0);
  });

  it.each([{ creatorId: 'fallback-app-id' }, { creatorEmail: 'fallback@example.com' }, {}])(
    'rejects a generated legacy seed containing an assignment-owned fallback row: %j',
    (fallback) => {
      const comment = { commentId: 'local-fallback', creatorName: 'Alex', ...fallback };
      const allocated = plan([comment]);
      const label = allocated.comments[0].wordAuthorName;
      const generated = xmljs.xml2js(
        `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:internalId="local-fallback" w:author="${label}"/></w:comments>`,
      );
      const rows = readCommentAuthorSourceRows(generated);
      expect(hasLocalCommentAuthorSourceConflict(rows, [comment], allocated.assignments)).toBe(true);
      expect(
        hasLocalCommentAuthorSourceConflict(
          rows,
          [{ ...comment, creatorName: 'Another owner' }],
          allocated.assignments,
        ),
      ).toBe(false);
      expect(comment).toEqual({ commentId: 'local-fallback', creatorName: 'Alex', ...fallback });
    },
  );

  it('recognizes a current imported numeric-reference snapshot after sequential source comments then people ingress', () => {
    const convertedXml = {
      'word/_rels/document.xml.rels': emptyRels(),
      'word/comments.xml': xmljs.xml2js(
        '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:internalId="known-source" w:author="Alex"/></w:comments>',
      ),
    };
    const source = captureCommentAuthorSource(convertedXml);
    const before = JSON.stringify([...source.comments]);
    convertedXml['word/_rels/document.xml.rels'] = rels();
    convertedXml['word/people.xml'] = xmljs.xml2js(
      `<p:people xmlns:p="${P}"><p:person p:author="Alex"><p:presenceInfo p:providerId="vendor&#9;tab&#10;line&#13;end" p:userId="account&#9;tab&#10;line&#13;end"/></p:person></p:people>`,
    );
    const identity = { providerId: 'vendor\ttab\nline\rend', userId: 'account\ttab\nline\rend' };
    const comment = { commentId: 'known-source', creatorName: 'UI decoration', creatorIdentity: identity };
    const result = plan([comment], { convertedXml, source });
    expect(result.comments[0].wordAuthorName).toBe('Alex');
    expect(result.comments[0].creatorIdentity).toEqual(identity);
    expect(JSON.stringify([...source.comments])).toBe(before);
    expect(() => plan([{ ...comment, commentId: 'unknown-local' }], { convertedXml, source })).toThrow(TypeError);
    expect(() =>
      plan([{ ...comment, creatorIdentity: { ...identity, userId: 'unrelated\nclaim' } }], { convertedXml, source }),
    ).toThrow(TypeError);
  });

  it.each(['removed', 'remapped'])(
    'retains actually observed imported tuple validation evidence after people is %s',
    (transition) => {
      const convertedXml = {
        'word/_rels/document.xml.rels': emptyRels(),
        'word/comments.xml': xmljs.xml2js(
          '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:internalId="known-source" w:author="Alex"/></w:comments>',
        ),
      };
      const original = captureCommentAuthorSource(convertedXml);
      const originalSnapshot = JSON.stringify([...original.comments]);
      convertedXml['word/_rels/document.xml.rels'] = rels();
      convertedXml['word/people.xml'] = xmljs.xml2js(
        `<p:people xmlns:p="${P}"><p:person p:author="Alex"><p:presenceInfo p:providerId="vendor&#9;tab&#10;line&#13;end" p:userId="account&#9;tab&#10;line&#13;end"/></p:person></p:people>`,
      );
      // Observe the real current Word tuple through normal preparation/source publication first.
      // The companion sequential-input test supplies this tuple on the first call as well.
      const observed = plan([{ commentId: 'known-source', creatorName: 'UI decoration' }], {
        convertedXml,
        source: original,
      });
      const identity = observed.comments[0].creatorIdentity;
      expect(identity).toEqual({ providerId: 'vendor\ttab\nline\rend', userId: 'account\ttab\nline\rend' });
      const source = observed.source;
      convertedXml['word/people.xml'] = xmljs.xml2js(
        `<p:people xmlns:p="${P}">${transition === 'removed' ? '' : '<p:person p:author="Alex"><p:presenceInfo p:providerId="vendor" p:userId="current-account"/></p:person>'}</p:people>`,
      );
      const input = { commentId: 'known-source', creatorName: 'UI decoration', creatorIdentity: identity };
      const result = plan([input], { convertedXml, source });
      expect(result.comments[0].creatorIdentity).toEqual(
        transition === 'removed' ? undefined : { providerId: 'vendor', userId: 'current-account' },
      );
      expect(xmljs.js2xml(result.part.tree)).toBe(xmljs.js2xml(convertedXml['word/people.xml']));
      expect(JSON.stringify([...original.comments])).toBe(originalSnapshot);
      expect([...result.source.comments.keys()]).toEqual(['known-source']);
      expect(() => plan([{ ...input, commentId: 'unknown-local' }], { convertedXml, source })).toThrow(TypeError);
      expect(() =>
        plan([{ ...input, creatorIdentity: { ...identity, userId: 'never-observed\nclaim' } }], {
          convertedXml,
          source,
        }),
      ).toThrow(TypeError);
    },
  );

  it.each(['ordinary', 'numeric references'])(
    'resolves current imported associations independently of the captured %s snapshot',
    (kind) => {
      const old = kind === 'ordinary' ? 'old-account' : 'old&#9;account&#10;line&#13;end';
      const convertedXml = {
        'word/_rels/document.xml.rels': rels(),
        'word/comments.xml': xmljs.xml2js(
          '<c:comments xmlns:c="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><c:comment c:id="0" c:date="2026-01-01T00:00:00Z" c:author="Alex" c:internalId="old"/></c:comments>',
        ),
        'word/people.xml': xmljs.xml2js(
          `<p:people xmlns:p="${P}"><p:person p:author="Alex"><p:presenceInfo p:providerId="vendor" p:userId="${old}"/></p:person></p:people>`,
        ),
      };
      const source = captureCommentAuthorSource(convertedXml);
      const snapshot = importedWordIdentity(readPeoplePart(convertedXml).people, 'Alex');
      const comment = author('old', undefined, { creatorIdentity: snapshot });
      const before = JSON.stringify([...source.comments]);
      const root = convertedXml['word/people.xml'].elements[0];
      for (const state of ['changed', 'removed', 'ambiguous', 'incomplete']) {
        root.elements = xmljs.xml2js(
          `<p:people xmlns:p="${P}">${state === 'removed' ? '' : `<p:person p:author="Alex">${state === 'incomplete' ? '' : '<p:presenceInfo p:providerId="vendor" p:userId="current-account"/>'}</p:person>`}${state === 'ambiguous' ? '<p:person p:author="Alex"><p:presenceInfo p:providerId="vendor" p:userId="other-account"/></p:person>' : ''}</p:people>`,
        ).elements[0].elements;
        const result = plan([comment], { convertedXml, source });
        expect(result.comments[0].wordAuthorName).toBe('Alex');
        expect(result.comments[0].creatorIdentity).toEqual(
          state === 'changed' ? { providerId: 'vendor', userId: 'current-account' } : undefined,
        );
        expect(xmljs.js2xml(result.part.tree)).toBe(xmljs.js2xml(convertedXml['word/people.xml']));
        expect(JSON.stringify([...source.comments])).toBe(before);
        expect(() =>
          plan([], {
            convertedXml,
            source,
            validationComments: [author('invalid', '\n')],
          }),
        ).toThrow(TypeError);
      }
    },
  );

  it('allocates all conflicting account labels deterministically and groups exact pairs only', () => {
    const comments = [author('a'), author('b'), author('same-a', 'a')];
    const one = plan(comments);
    const reverse = plan(comments.slice().reverse());
    expect(labels(one)).toEqual(labels(reverse));
    expect(labels(one).a).toMatch(/^Alex \[sd-[a-f\d]+\]$/);
    expect(labels(one).a).not.toBe(labels(one).b);
    expect(labels(one)['same-a']).toBe(labels(one).a);
    expect(
      readPeoplePart({ 'word/_rels/document.xml.rels': rels(), 'word/people.xml': one.part.tree }).people,
    ).toHaveLength(2);
    expect(comments.every((c) => !c.wordAuthorName)).toBe(true);
  });

  it('guards hash collisions and imported literal suffix reservations with full owner keys', () => {
    const xml = {
      'word/_rels/document.xml.rels': rels(),
      'word/people.xml': xmljs.xml2js(
        `<x:people xmlns:x="${P}" xmlns:v="urn:vendor"><x:person x:author="Alex [sd-forced]"><x:presenceInfo x:providerId="unknown" x:userId="opaque"/><v:keep>text</v:keep></x:person><x:person x:author="Alex [sd-forced-2]"/></x:people>`,
      ),
    };
    const comments = [author('b'), author('a')];
    const one = plan(comments, { convertedXml: xml, hash: () => 'forced' });
    const reverse = plan(comments.slice().reverse(), { convertedXml: xml, hash: () => 'forced' });
    expect(labels(one)).toEqual(labels(reverse));
    expect(new Set(Object.values(labels(one))).size).toBe(2);
    expect(Object.values(labels(one)).sort()).toEqual(['Alex [sd-forced-3]', 'Alex [sd-forced-4]']);
    expect(xml['word/people.xml'].elements[0].elements).toHaveLength(2);
    expect(one.part.tree.elements[0].elements.slice(0, 2)).toEqual(xml['word/people.xml'].elements[0].elements);
  });

  it('keeps prior assignments across later arrivals and deletion/readdition without exporting stale identities', () => {
    const first = plan([author('a')]);
    expect(labels(first).a).toBe('Alex');
    const second = plan([author('b'), author('a')], { assignments: first.assignments });
    expect(labels(second).a).toBe('Alex');
    expect(labels(second).b).not.toBe('Alex');
    const removed = plan([], { assignments: second.assignments });
    expect(removed.part).toBeUndefined();
    const readded = plan([author('b'), author('a')], { assignments: removed.assignments });
    expect(labels(readded)).toEqual(labels(second));
    // A fresh peer can have different label history, but always maps each comment to its exact pair.
    const fresh = plan([author('a'), author('b')]);
    expect(labels(fresh).a).not.toBe('Alex');
    expect(fresh.comments.map((c) => c.creatorIdentity.userId)).toEqual(['a', 'b']);
  });

  it('hydrates only unique expanded-name identities and preserves ambiguous or shadowed metadata', () => {
    const xml = {
      'word/_rels/document.xml.rels': rels('/word/alt.xml'),
      'word/alt.xml': xmljs.xml2js(
        `<people xmlns="${P}" xmlns:p="${P}" xmlns:v="urn:vendor"><person p:author="Alex"><presenceInfo p:providerId="custom" p:userId="opaque"/><v:child xmlns:p="urn:shadow"><p:presenceInfo p:providerId="wrong" p:userId="wrong"/></v:child></person><person p:author="Ambiguous"><presenceInfo p:providerId="AD" p:userId="one"/></person><person p:author="Ambiguous"><presenceInfo p:providerId="AD" p:userId="two"/></person></people>`,
      ),
    };
    const read = readPeoplePart(xml);
    expect(importedWordIdentity(read.people, 'Alex')).toEqual({ providerId: 'custom', userId: 'opaque' });
    expect(importedWordIdentity(read.people, 'Ambiguous')).toBeUndefined();
    const result = plan([author('fallback', undefined, { creatorName: 'Ambiguous', creatorIdentity: undefined })], {
      convertedXml: xml,
    });
    expect(result.comments[0].wordAuthorName).not.toBe('Ambiguous');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.part.tree).toEqual(xml['word/alt.xml']);
  });

  it('uses genuine parsed comment provenance to pin a literal imported label including (imported)', () => {
    const comment = { commentId: 'old', creatorName: 'Actual (imported)', wordAuthorName: 'Actual (imported)' };
    const convertedXml = { 'word/_rels/document.xml.rels': emptyRels() };
    const source = captureCommentAuthorSource(convertedXml, [comment]);
    const result = plan(
      [
        { ...comment, creatorName: 'UI decoration' },
        { ...author('new'), wordAuthorName: 'Actual (imported)', importedId: 'spoof' },
      ],
      { convertedXml, source },
    );
    expect(labels(result).old).toBe('Actual (imported)');
    expect(labels(result).new).toBe('Alex');
  });

  it('preserves untouched original people bytes and creates a noncolliding dynamic part and relationship', () => {
    const raw = `<?xml version="1.0"?><p:people xmlns:p="${P}">\n<p:person p:author="Old"><p:presenceInfo p:providerId="vendor" p:userId="opaque"/></p:person>\n</p:people>`;
    const original = {
      'word/_rels/document.xml.rels': rels(),
      'word/people.xml': xmljs.xml2js(raw, { captureSpacesBetweenElements: true }),
    };
    const unchanged = plan([], { convertedXml: original });
    expect(
      commentPeopleUpdatedFiles(original, unchanged.part, [{ name: 'word/people.xml', content: raw }])[
        'word/people.xml'
      ],
    ).toBe(raw);
    const occupied = {
      'word/_rels/document.xml.rels': emptyRels(),
      'word/people.xml': { elements: [{ type: 'element', name: 'unrelated' }] },
    };
    const result = plan([author('new')], { convertedXml: occupied });
    expect(result.part.path).toBe('word/people2.xml');
    const overlay = commentPeopleUpdatedFiles(occupied, result.part);
    expect(overlay['word/_rels/document.xml.rels']).toContain('Id="rId2"');
    expect(overlay['word/_rels/document.xml.rels']).toContain('Type="urn:unrelated"');
    expect(occupied['word/_rels/document.xml.rels'].elements[0].elements).toHaveLength(1);
  });

  it('serializes appended people without changing imported attributes, mixed text or CDATA', () => {
    const raw = `<p:people xmlns:p="${P}" xmlns:v="urn:vendor" v:keep="&amp;quot; &amp;amp;"><p:person p:author="Old &amp; &lt;Reviewer&gt; &quot;name&quot; &amp;quot;"><p:presenceInfo p:providerId="vendor &amp;quot;" p:userId="opaque &amp;amp;"/><v:extra v:keep="&lt;tag&gt; &amp; &quot;quote&quot; &amp;quot; &amp;amp;">before &amp;amp;<v:child/>after &amp;amp; &amp;quot;<![CDATA[raw &amp; &quot; <tag>]]></v:extra></p:person></p:people>`;
    const convertedXml = { 'word/_rels/document.xml.rels': rels(), 'word/people.xml': xmljs.xml2js(raw) };
    const before = JSON.stringify(convertedXml);
    const identity = { providerId: 'vendor & <tag> "quote" &quot;', userId: 'opaque &amp; & <id> "quote"' };
    const name = 'New & <Reviewer> "quote" &quot; &amp;';
    const result = plan([author('new', identity.userId, { creatorName: name, creatorIdentity: identity })], {
      convertedXml,
    });
    const overlay = commentPeopleUpdatedFiles(convertedXml, result.part, [{ name: 'word/people.xml', content: raw }]);
    const doc = new DOMParser().parseFromString(overlay['word/people.xml'], 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const original = new DOMParser().parseFromString(raw, 'application/xml');
    expect(doc.documentElement.getAttributeNS('urn:vendor', 'keep')).toBe('&quot; &amp;');
    const people = [...doc.getElementsByTagNameNS(P, 'person')];
    expect(people[0].isEqualNode(original.getElementsByTagNameNS(P, 'person')[0])).toBe(true);
    expect(people[1].getAttributeNS(P, 'author')).toBe(name);
    const presence = people[1].getElementsByTagNameNS(P, 'presenceInfo')[0];
    expect(presence.getAttributeNS(P, 'providerId')).toBe(identity.providerId);
    expect(presence.getAttributeNS(P, 'userId')).toBe(identity.userId);
    expect(overlay['word/people.xml']).toContain('<![CDATA[raw &amp; &quot; <tag>]]>');
    expect(JSON.stringify(convertedXml)).toBe(before);

    const unchanged = plan([], { convertedXml });
    expect(
      commentPeopleUpdatedFiles(convertedXml, unchanged.part, [{ name: 'word/people.xml', content: raw }])[
        'word/people.xml'
      ],
    ).toBe(raw);
  });

  it('preserves whitespace-bearing current trees with no carrier and only reuses an equivalent raw carrier', () => {
    const raw = `<?xml version='1.0'?><p:people xmlns:p="${P}" xmlns:v="urn:vendor">\n <p:person p:author="Old"><p:presenceInfo p:providerId="vendor" p:userId="old"/><v:extra xml:space="preserve">  <v:child/> \t <v:child/>  </v:extra></p:person>\n <![CDATA[root &amp;]]>\n</p:people>`;
    const tree = xmljs.xml2js(raw, { captureSpacesBetweenElements: true });
    const convertedXml = { 'word/_rels/document.xml.rels': rels(), 'word/people.xml': tree };
    const before = JSON.stringify(convertedXml);
    const unchanged = plan([], { convertedXml });
    const carrier = [{ name: 'word/people.xml', content: raw }];
    expect(commentPeopleUpdatedFiles(convertedXml, unchanged.part, carrier)['word/people.xml']).toBe(raw);
    const current = raw.replace('>  <v:child/>', '>    <v:child/>');
    convertedXml['word/people.xml'] = xmljs.xml2js(current, { captureSpacesBetweenElements: true });
    const snapshot = JSON.stringify(convertedXml);
    for (const originalFiles of [carrier, []]) {
      const noop = plan([], { convertedXml });
      const output = commentPeopleUpdatedFiles(convertedXml, noop.part, originalFiles)['word/people.xml'];
      const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
      expect(parse(output).documentElement.isEqualNode(parse(current).documentElement)).toBe(true);
      const appended = plan([author('new')], { convertedXml });
      const result = parse(commentPeopleUpdatedFiles(convertedXml, appended.part, originalFiles)['word/people.xml']);
      for (const [index, child] of [...parse(current).documentElement.childNodes].entries()) {
        expect(result.documentElement.childNodes[index].isEqualNode(child)).toBe(true);
      }
      expect(JSON.stringify(convertedXml)).toBe(snapshot);
    }
    expect(JSON.stringify(tree)).toBe(JSON.stringify(JSON.parse(before)['word/people.xml']));
    // An old client's already-lossy current tree cannot be repaired from a stale carrier.
    convertedXml['word/people.xml'] = xmljs.xml2js(raw);
    const lossy = plan([], { convertedXml });
    const output = commentPeopleUpdatedFiles(convertedXml, lossy.part, carrier)['word/people.xml'];
    expect(output).not.toBe(raw);
    const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
    expect(
      parse(output).documentElement.isEqualNode(parse(xmljs.js2xml(convertedXml['word/people.xml'])).documentElement),
    ).toBe(true);
  });

  it('preserves existing namespace-prefixed external hyperlink attributes when adding the people relationship', () => {
    const raw =
      '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=2&amp;literal=&amp;quot;&amp;other=&amp;amp;" TargetMode="External"/></r:Relationships>';
    const convertedXml = { 'word/_rels/document.xml.rels': xmljs.xml2js(raw) };
    const result = plan([author('new')], { convertedXml });
    const overlay = commentPeopleUpdatedFiles(convertedXml, result.part);
    const doc = new DOMParser().parseFromString(overlay['word/_rels/document.xml.rels'], 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const original = new DOMParser().parseFromString(raw, 'application/xml');
    const namespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const relations = [...doc.getElementsByTagNameNS(namespace, 'Relationship')];
    expect(relations).toHaveLength(2);
    expect(relations[0].isEqualNode(original.getElementsByTagNameNS(namespace, 'Relationship')[0])).toBe(true);
    expect(relations[1].getAttribute('Type')).toBe(R);
  });

  it('retains imported character-reference whitespace when appending an ordinary identity', () => {
    const raw = `<p:people xmlns:p="${P}" xmlns:v="urn:vendor" v:keep="root&#9;tab&#10;line&#13;end"><p:person p:author="Old" v:keep="person&#x9;tab&#xA;line&#xD;end"><p:presenceInfo p:providerId="vendor&#9;tab&#10;line&#13;end" p:userId="old&#x9;account&#xA;line&#xD;end"/><v:extra v:keep="extra&#9;tab&#10;line&#13;end &amp;#xD;">before&#xD;return&#xD;&#xA;line<v:child/>after&#13; &amp;#xD;<![CDATA[raw &amp; <tag>]]></v:extra></p:person></p:people>`;
    const convertedXml = { 'word/_rels/document.xml.rels': rels(), 'word/people.xml': xmljs.xml2js(raw) };
    const before = JSON.stringify(convertedXml);
    const original = new DOMParser().parseFromString(raw, 'application/xml');
    const carrier = [{ name: 'word/people.xml', content: raw }];
    const unchanged = plan([], { convertedXml });
    expect(commentPeopleUpdatedFiles(convertedXml, unchanged.part, carrier)['word/people.xml']).toBe(raw);
    const comments = [
      author('new', 'new-account', { creatorIdentity: { providerId: 'vendor', userId: 'new-account' } }),
    ];
    const commentsBefore = JSON.stringify(comments);
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = plan(comments, { convertedXml });
      const output = commentPeopleUpdatedFiles(convertedXml, result.part, carrier)['word/people.xml'];
      const doc = new DOMParser().parseFromString(output, 'application/xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect.soft(doc.documentElement.getAttributeNS('urn:vendor', 'keep')).toBe('root\ttab\nline\rend');
      const people = [...doc.getElementsByTagNameNS(P, 'person')];
      expect(people).toHaveLength(2);
      expect.soft(people[0].isEqualNode(original.getElementsByTagNameNS(P, 'person')[0])).toBe(true);
      const oldPresence = people[0].getElementsByTagNameNS(P, 'presenceInfo')[0];
      expect.soft(oldPresence.getAttributeNS(P, 'providerId')).toBe('vendor\ttab\nline\rend');
      expect.soft(oldPresence.getAttributeNS(P, 'userId')).toBe('old\taccount\nline\rend');
      expect
        .soft(people[0].getElementsByTagNameNS('urn:vendor', 'extra')[0].textContent)
        .toBe('before\rreturn\r\nlineafter\r &#xD;raw &amp; <tag>');
      expect(people[1].getElementsByTagNameNS(P, 'presenceInfo')[0].getAttributeNS(P, 'userId')).toBe('new-account');
    }
    expect(JSON.stringify(convertedXml)).toBe(before);
    expect(JSON.stringify(comments)).toBe(commentsBefore);
  });

  it.each(['../../../escape.xml', 'https://outside/people.xml', 'people.xml#fragment', 'bad\\path.xml'])(
    'refuses unsafe people relationship %s',
    (target) => {
      expect(resolvePeopleTarget(target)).toBeUndefined();
      expect(() => plan([author('new')], { convertedXml: { 'word/_rels/document.xml.rels': rels(target) } })).toThrow(
        /people/i,
      );
    },
  );
  it('associates different display labels with the same exact opaque pair without conflating names', () => {
    const result = plan([
      author('one', 'same-account'),
      author('two', 'same-account', { creatorName: 'Another display' }),
    ]);
    expect(labels(result)).toEqual({ one: 'Alex', two: 'Another display' });
    const people = readPeoplePart({
      'word/_rels/document.xml.rels': rels(),
      'word/people.xml': result.part.tree,
    }).people;
    expect(people.map((p) => p.identity)).toEqual([
      { providerId: 'AD', userId: 'same-account' },
      { providerId: 'AD', userId: 'same-account' },
    ]);
  });
});
