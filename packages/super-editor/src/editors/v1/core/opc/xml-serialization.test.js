/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import * as xmljs from 'xml-js';
import { serializeOpcXml } from './xml-serialization.js';

function parse(xml) {
  return xmljs.xml2js(xml, { compact: false });
}

describe('serializeOpcXml', () => {
  it('escapes & in attribute values so the output XML is well-formed', () => {
    const tree = parse('<?xml version="1.0"?><Root><A href="http://x.com/?a=1&amp;b=2"/></Root>');

    const out = serializeOpcXml(tree);

    expect(out).toContain('href="http://x.com/?a=1&amp;b=2"');
    expect(out).not.toMatch(/href="http:\/\/x\.com\/\?a=1&b=2"/);

    const parsed = new DOMParser().parseFromString(out, 'application/xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
  });

  it('escapes <, >, and " in attribute values', () => {
    const tree = parse('<?xml version="1.0"?><Root><A label="&lt;tag&gt;" title="&quot;hi&quot;"/></Root>');

    const out = serializeOpcXml(tree);

    expect(out).toContain('label="&lt;tag&gt;"');
    expect(out).toContain('title="&quot;hi&quot;"');
  });

  it('preserves attribute values that contain no XML-significant characters', () => {
    const tree = parse('<?xml version="1.0"?><Root><A href="numbering.xml"/></Root>');
    expect(serializeOpcXml(tree)).toContain('href="numbering.xml"');
  });

  it('does not double-escape already-escaped sequences (single round-trip)', () => {
    // xml-js's xml2js decodes entities; serializeOpcXml re-encodes them once.
    const tree = parse('<?xml version="1.0"?><Root><A href="a&amp;b"/></Root>');
    const out = serializeOpcXml(tree);
    expect(out).toContain('href="a&amp;b"');
    expect(out).not.toContain('&amp;amp;');
  });

  it('round-trips through parse → serialize → parse without losing entities', () => {
    const original = '<?xml version="1.0"?><Root><A href="http://x.com/?a=1&amp;b=2&amp;c=3"/></Root>';
    const out = serializeOpcXml(parse(original));
    const reparsed = parse(out);
    const a = reparsed.elements[0].elements[0];
    expect(a.attributes.href).toBe('http://x.com/?a=1&b=2&c=3');
  });

  it.each(['&', '<tag>', '"quoted"', "'quoted'", 'literal &quot; &amp; &lt; &#34;'])(
    'preserves the exact raw attribute value %s across repeated serialization',
    (value) => {
      const tree = {
        elements: [{ type: 'element', name: 'r:Root', attributes: { 'xmlns:r': 'urn:test', value } }],
      };
      const before = JSON.stringify(tree);
      let current = tree;
      for (let index = 0; index < 3; index++) {
        const out = serializeOpcXml(current);
        const doc = new DOMParser().parseFromString(out, 'application/xml');
        expect(doc.querySelector('parsererror')).toBeNull();
        expect(doc.documentElement.namespaceURI).toBe('urn:test');
        expect(doc.documentElement.getAttribute('value')).toBe(value);
        current = parse(out);
      }
      expect(JSON.stringify(tree)).toBe(before);
    },
  );

  it('retains imported entity-looking attributes, mixed text and CDATA exactly', () => {
    const original =
      '<r:Root xmlns:r="urn:test" value="literal &amp;quot; &amp;amp; &quot;quote&quot; &lt;tag&gt;">before &amp;amp;<r:Child value="&amp;quot;"/>after &amp;amp; &amp;quot; &lt;tag&gt;<![CDATA[raw &amp; &quot; <tag>]]></r:Root>';
    const expected = new DOMParser().parseFromString(original, 'application/xml');
    const tree = parse(original);
    const before = JSON.stringify(tree);
    let current = tree;
    for (let index = 0; index < 3; index++) {
      const out = serializeOpcXml(current);
      const doc = new DOMParser().parseFromString(out, 'application/xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.isEqualNode(expected.documentElement)).toBe(true);
      expect(out).toContain('<![CDATA[raw &amp; &quot; <tag>]]>');
      current = parse(out);
    }
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('preserves literal ampersand entities in text before and after child elements', () => {
    const original = '<Root>before &amp;amp;<Child/>after &amp;amp; &amp;quot; &lt;tag&gt;</Root>';
    const out = serializeOpcXml(parse(original));
    const doc = new DOMParser().parseFromString(out, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.textContent).toBe('before &amp;after &amp; &quot; <tag>');
  });

  it.each([
    {
      label: 'attribute whitespace',
      original: '<r:Root xmlns:r="urn:test" value="before&#x9;tab&#xA;line&#xD;return&#xD;&#xA;end &amp;#xD;"/>',
    },
    {
      label: 'mixed text carriage returns',
      original: '<r:Root xmlns:r="urn:test">before&#xD;return&#xD;&#xA;line<r:Child/>after&#13; &amp;#xD;</r:Root>',
    },
  ])('preserves imported $label through repeated XML decoding', ({ original }) => {
    const expected = new DOMParser().parseFromString(original, 'application/xml');
    expect(expected.querySelector('parsererror')).toBeNull();
    const tree = parse(original);
    const before = JSON.stringify(tree);
    let current = tree;
    for (let index = 0; index < 3; index++) {
      const out = serializeOpcXml(current);
      const doc = new DOMParser().parseFromString(out, 'application/xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.isEqualNode(expected.documentElement)).toBe(true);
      current = parse(out);
    }
    expect(JSON.stringify(tree)).toBe(before);
  });
});
