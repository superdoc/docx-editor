import { describe, expect, it } from 'bun:test';

import { compileThemeFromRoot } from './parse-theme.js';
import { parseOoxml } from './parse-xml.js';

describe('compileThemeFromRoot format scheme', () => {
  it('retains line styles in their authored style-matrix order', () => {
    const { root, error } = parseOoxml(`
      <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:themeElements>
          <a:fmtScheme name="Office">
            <a:fillStyleLst><a:noFill/></a:fillStyleLst>
            <a:lnStyleLst>
              <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"/>
              <a:ln w="12700" cap="rnd" cmpd="sng" algn="ctr"/>
            </a:lnStyleLst>
            <a:bgFillStyleLst/>
          </a:fmtScheme>
        </a:themeElements>
      </a:theme>
    `);

    expect(error).toBeUndefined();
    const lineStyles = compileThemeFromRoot(root).formatScheme?.lineStyles;
    expect(lineStyles).toHaveLength(2);
    expect(lineStyles?.[0]).toContain('cap="flat"');
    expect(lineStyles?.[1]).toContain('cap="rnd"');
  });
});

describe('compileThemeFromRoot namespace equivalence', () => {
  const namespace = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const theme = `<a:theme xmlns:a="${namespace}"><a:themeElements><a:clrScheme name="Mapped"><a:accent2><a:srgbClr val="237D43"/></a:accent2></a:clrScheme><a:fontScheme name="Fonts"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Format"><a:fillStyleLst><a:noFill/></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"/></a:lnStyleLst><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`;

  it('reads equivalent standard, alternate and default DrawingML colors and fonts without mutating input', () => {
    const standard = compileThemeFromRoot(parseOoxml(theme).root);
    for (const xml of [
      theme.replace(namespace, 'http://purl.oclc.org/ooxml/drawingml/main'),
      theme
        .replace(namespace, 'http://purl.oclc.org/ooxml/drawingml/main')
        .replaceAll('a:', 'ns0:')
        .replace('xmlns:a', 'xmlns:ns0'),
      theme
        .replace(namespace, 'http://purl.oclc.org/ooxml/drawingml/main')
        .replaceAll('a:', '')
        .replace('xmlns:a', 'xmlns'),
      theme,
      theme.replaceAll('a:', 'ns0:').replace('xmlns:a', 'xmlns:ns0'),
      theme.replaceAll('a:', '').replace('xmlns:a', 'xmlns'),
    ]) {
      const root = parseOoxml(xml).root;
      const original = JSON.stringify(root);
      const actual = compileThemeFromRoot(root);
      expect(actual.palette).toEqual(standard.palette);
      expect(actual.fontScheme).toEqual(standard.fontScheme);
      expect(actual.palette?.accent2).toBe('#237D43');
      expect(actual.fontScheme?.major?.latin).toBe('Cambria');
      expect(actual.formatScheme?.lineStyles).toHaveLength(1);
      expect(JSON.stringify(root)).toBe(original);
    }
  });

  it('honors local rebinding and declares alternate-prefix format fragments', () => {
    const localColor = theme
      .replace('<a:accent2>', `<a:accent2 xmlns:c="${namespace}">`)
      .replace('<a:srgbClr', '<c:srgbClr');
    expect(compileThemeFromRoot(parseOoxml(localColor).root).palette?.accent2).toBe('#237D43');
    const foreignFonts = theme.replace(
      '<a:fontScheme name="Fonts">',
      '<a:fontScheme xmlns:a="urn:foreign" name="Fonts">',
    );
    expect(compileThemeFromRoot(parseOoxml(foreignFonts).root).fontScheme).toBeUndefined();
    expect(compileThemeFromRoot(parseOoxml(foreignFonts).root).palette?.accent2).toBe('#237D43');
    const foreignColor = theme.replace('<a:srgbClr', '<a:srgbClr xmlns:a="urn:foreign"');
    expect(compileThemeFromRoot(parseOoxml(foreignColor).root).palette).toBeUndefined();
    const alternate = compileThemeFromRoot(
      parseOoxml(theme.replaceAll('a:', 'ns0:').replace('xmlns:a', 'xmlns:ns0')).root,
    );
    expect(alternate.formatScheme?.lineStyles?.[0]).toContain(`xmlns:ns0="${namespace}"`);
  });

  it('ignores foreign namespace lookalikes and preserves malformed fallback', () => {
    expect(compileThemeFromRoot(parseOoxml(theme.replace(namespace, 'urn:foreign')).root)).toEqual({});
    expect(compileThemeFromRoot(parseOoxml('<a:theme><broken></a:theme>').root)).toEqual({});
  });
});
