/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import DocxZipper from './DocxZipper.js';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PEOPLE_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml';
const peoplePath = 'word/metadata/people-custom.xml';
const updates = {
  'word/_rels/document.xml.rels':
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="people" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="/word/metadata/people-custom.xml"/></Relationships>',
  [peoplePath]: '<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>',
};
const parse = (xml) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
};

const manifests = [
  { label: 'default namespace', root: `Types xmlns="${CT}"`, child: '' },
  { label: 'prefixed root with default namespace', root: `ct:Types xmlns:ct="${CT}" xmlns="${CT}"`, child: '' },
  { label: 'prefixed root only', root: `ct:Types xmlns:ct="${CT}"`, child: 'ct:' },
  { label: 'foreign default namespace', root: `ct:Types xmlns:ct="${CT}" xmlns="urn:vendor"`, child: 'ct:' },
];

describe('Word people content-type namespaces', () => {
  for (const { label, root, child } of manifests) {
    for (const existing of [false, true]) {
      it.each(['original', 'collaborative', 'updated-docs'])(
        `${label}, existing override ${existing}: registers the emitted dynamic path for %s`,
        async (route) => {
          const rootName = root.split(' ')[0];
          const existingOverride = existing
            ? `<local:Override xmlns:local="${CT}" PartName="/${peoplePath}" ContentType="${PEOPLE_CT}"/>`
            : '';
          const shadowPath = existing ? 'word/vendor-shadow.xml' : peoplePath;
          // These lookalike registrations have locally shadowed namespaces and must be preserved, not matched.
          const xml = `<${root} xmlns:v="urn:vendor" v:note="keep &amp; &amp;quot; &lt;tag&gt; &quot;quote&quot;"><${child}Default Extension="xml" ContentType="application/xml"/><${child}Override PartName="/custom/unmanaged.xml" ContentType="application/vnd.synthetic+xml"/><${child}Override xmlns${child ? ':ct' : ''}="urn:vendor" PartName="/${shadowPath}" ContentType="vendor-shadow"/><v:extension v:attr="&amp;amp;">before &amp;amp;<v:child/><![CDATA[<opaque>&literal]]>after &amp;quot;</v:extension>${existingOverride}</${rootName}>`;
          const before = parse(xml);
          const base = [{ name: '[Content_Types].xml', content: xml }];
          const zipper = new DocxZipper();
          let output;
          if (route === 'updated-docs') {
            output = await zipper.updateContentTypes({ files: base }, {}, true, updates);
          } else {
            const zip = new JSZip();
            base.forEach((file) => zip.file(file.name, file.content));
            const result =
              route === 'original'
                ? await zipper.exportFromOriginalFile(await zip.generateAsync({ type: 'nodebuffer' }), updates, {})
                : await zipper.exportFromCollaborativeDocx(base, updates, {}, {});
            const packed = await JSZip.loadAsync(await result.generateAsync({ type: 'nodebuffer' }));
            output = await packed.file('[Content_Types].xml').async('string');
            expect(await packed.file(peoplePath).async('string')).toBe(updates[peoplePath]);
            expect(await packed.file('word/_rels/document.xml.rels').async('string')).toBe(
              updates['word/_rels/document.xml.rels'],
            );
          }
          for (let repeat = 0; repeat < 2; repeat++) {
            const after = parse(output);
            const overrides = [...after.getElementsByTagNameNS(CT, 'Override')].filter(
              (node) => node.getAttribute('PartName') === `/${peoplePath}`,
            );
            expect(overrides).toHaveLength(1);
            expect(overrides[0].getAttribute('ContentType')).toBe(PEOPLE_CT);
            expect(overrides[0].parentElement).toBe(after.documentElement);
            const added = existing ? undefined : overrides[0];
            const retained = [...after.documentElement.childNodes].filter((node) => node !== added);
            expect(retained).toHaveLength(before.documentElement.childNodes.length);
            retained.forEach((node, index) =>
              expect(node.isEqualNode(before.documentElement.childNodes[index])).toBe(true),
            );
            expect([...after.documentElement.attributes].map((attr) => [attr.name, attr.value])).toEqual(
              [...before.documentElement.attributes].map((attr) => [attr.name, attr.value]),
            );
            output = await zipper.updateContentTypes(
              { files: [{ name: '[Content_Types].xml', content: output }] },
              {},
              true,
              updates,
            );
          }
        },
      );
    }
  }
});
