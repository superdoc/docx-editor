/**
 * Editor-neutral translator for `word/theme/theme1.xml`. Produces a
 * concrete color palette, major/minor font scheme, and DrawingML format
 * matrix entries needed by downstream style references.
 */
import { js2xml } from 'xml-js';

import { findChildren, type OoxmlElement } from './parse-xml.js';

export interface WordThemeColorPalette {
  readonly [colorName: string]: string;
}

export interface WordThemeFontScheme {
  readonly major?: WordThemeFontFamily;
  readonly minor?: WordThemeFontFamily;
}

export interface WordThemeFontFamily {
  readonly latin?: string;
  readonly ea?: string;
  readonly cs?: string;
}

/** Authored DrawingML format definitions, indexed by the matching style reference. */
export interface WordThemeFormatScheme {
  readonly fillStyles: readonly string[];
  readonly backgroundFillStyles: readonly string[];
  readonly lineStyles?: readonly string[];
}

export const DEFAULT_WORD_THEME_PALETTE: WordThemeColorPalette = {
  dk1: '#000000',
  lt1: '#FFFFFF',
  dk2: '#44546A',
  lt2: '#E7E6E6',
  accent1: '#5B9BD5',
  accent2: '#ED7D31',
  accent3: '#A5A5A5',
  accent4: '#FFC000',
  accent5: '#4472C4',
  accent6: '#70AD47',
  hlink: '#0563C1',
  folHlink: '#954F72',
};

export const DEFAULT_WORD_THEME_FONT_SCHEME: WordThemeFontScheme = {
  major: { latin: 'Calibri Light' },
  minor: { latin: 'Calibri' },
};

const DRAWINGML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
]);

type ThemeReader = ReturnType<typeof createThemeReader>;

function createThemeReader(root: OoxmlElement) {
  const bindings = new WeakMap<OoxmlElement, Record<string, string>>();
  const index = (node: OoxmlElement, inherited: Record<string, string>) => {
    const namespaces = { ...inherited };
    for (const [attribute, value] of Object.entries(node.attributes ?? {})) {
      if (value === undefined) continue;
      if (attribute === 'xmlns') namespaces[''] = value;
      else if (attribute.startsWith('xmlns:')) namespaces[attribute.slice(6)] = value;
    }
    bindings.set(node, namespaces);
    for (const child of node.elements ?? []) index(child, namespaces);
  };
  index(root, {});
  const name = (node: OoxmlElement | null | undefined): string | undefined => {
    if (!node?.name) return undefined;
    const separator = node.name.indexOf(':');
    const prefix = separator < 0 ? '' : node.name.slice(0, separator);
    return DRAWINGML_NAMESPACES.has(bindings.get(node)?.[prefix] ?? '') ? node.name.slice(separator + 1) : undefined;
  };
  const child = (node: OoxmlElement | null | undefined, localName: string) =>
    node?.elements?.find((element) => name(element) === localName);
  const serialize = (node: OoxmlElement): string => {
    const namespaces = bindings.get(node) ?? {};
    if (!Object.entries(namespaces).some(([prefix, uri]) => prefix !== 'a' && DRAWINGML_NAMESPACES.has(uri)))
      return serializeElement(node);
    const attributes = { ...node.attributes };
    for (const [prefix, uri] of Object.entries(namespaces)) attributes[prefix ? `xmlns:${prefix}` : 'xmlns'] = uri;
    return serializeElement({ ...node, attributes });
  };
  return { name, child, serialize };
}

function parseColorPalette(
  theme: OoxmlElement | null | undefined,
  reader: ThemeReader,
): WordThemeColorPalette | undefined {
  if (!theme) return undefined;
  const themeElements = reader.child(theme, 'themeElements');
  const clrScheme = reader.child(themeElements, 'clrScheme');
  if (!clrScheme?.elements?.length) return undefined;
  const palette: Record<string, string> = {};
  for (const colorNode of clrScheme.elements) {
    const colorName = reader.name(colorNode);
    if (!colorName) continue;
    const valueNode = colorNode.elements?.find(
      (el) => reader.name(el) && el.attributes && (el.attributes.val || el.attributes.lastClr),
    );
    if (!valueNode) continue;
    // For a:sysClr, `val` is a logical name like "windowText" and `lastClr`
    // carries the actual hex. Prefer the hex when present.
    const valAttr = valueNode.attributes?.val;
    const lastClr = valueNode.attributes?.lastClr;
    const looksHex = valAttr ? /^[0-9A-Fa-f]{6}$/.test(String(valAttr).trim()) : false;
    const colorValue = lastClr ?? (looksHex ? valAttr : undefined) ?? valAttr;
    if (!colorValue) continue;
    const normalized = String(colorValue).trim();
    if (!normalized) continue;
    palette[colorName] = `#${normalized.toUpperCase()}`;
  }
  return Object.keys(palette).length ? palette : undefined;
}

function parseFontFamily(fontNode: OoxmlElement | undefined, reader: ThemeReader): WordThemeFontFamily | undefined {
  if (!fontNode) return undefined;
  const out: { latin?: string; ea?: string; cs?: string } = {};
  const latin = reader.child(fontNode, 'latin');
  const typeface = latin?.attributes?.typeface;
  if (typeface) out.latin = typeface;
  const ea = reader.child(fontNode, 'ea');
  if (ea?.attributes?.typeface) out.ea = ea.attributes.typeface;
  const cs = reader.child(fontNode, 'cs');
  if (cs?.attributes?.typeface) out.cs = cs.attributes.typeface;
  return Object.keys(out).length ? out : undefined;
}

function parseFontScheme(theme: OoxmlElement | null | undefined, reader: ThemeReader): WordThemeFontScheme | undefined {
  if (!theme) return undefined;
  const themeElements = reader.child(theme, 'themeElements');
  const fontScheme = reader.child(themeElements, 'fontScheme');
  if (!fontScheme) return undefined;
  const majorRoot = reader.child(fontScheme, 'majorFont');
  const minorRoot = reader.child(fontScheme, 'minorFont');
  const major = parseFontFamily(majorRoot, reader);
  const minor = parseFontFamily(minorRoot, reader);
  if (!major && !minor) return undefined;
  return { major, minor };
}

function serializeElement(element: OoxmlElement): string {
  return js2xml({ elements: [element] }, { compact: false, spaces: 0 });
}

function parseFormatScheme(
  theme: OoxmlElement | null | undefined,
  reader: ThemeReader,
): WordThemeFormatScheme | undefined {
  if (!theme) return undefined;
  const themeElements = reader.child(theme, 'themeElements');
  const formatScheme = reader.child(themeElements, 'fmtScheme');
  if (!formatScheme) return undefined;
  const fillStyles =
    reader
      .child(formatScheme, 'fillStyleLst')
      ?.elements?.filter((element) => element.type === 'element')
      .map(reader.serialize) ?? [];
  const backgroundFillStyles =
    reader
      .child(formatScheme, 'bgFillStyleLst')
      ?.elements?.filter((element) => element.type === 'element')
      .map(reader.serialize) ?? [];
  const lineStyles =
    reader
      .child(formatScheme, 'lnStyleLst')
      ?.elements?.filter((element) => element.type === 'element')
      .map(reader.serialize) ?? [];
  if (fillStyles.length === 0 && backgroundFillStyles.length === 0 && lineStyles.length === 0) return undefined;
  return { fillStyles, backgroundFillStyles, lineStyles };
}

export interface ThemeParseResult {
  palette?: WordThemeColorPalette;
  fontScheme?: WordThemeFontScheme;
  formatScheme?: WordThemeFormatScheme;
}

/**
 * Parse the theme root (`a:theme`) into colors + font scheme. Returns an
 * empty object when the part is absent or unreadable.
 */
export function compileThemeFromRoot(root: OoxmlElement | null | undefined): ThemeParseResult {
  if (!root) return {};
  const reader = createThemeReader(root);
  // Accept either the `a:theme` root directly or a wrapper.
  let themeRoot: OoxmlElement | null | undefined = root;
  if (reader.name(root) !== 'theme') {
    themeRoot = reader.child(root, 'theme') ?? root;
  }
  const out: ThemeParseResult = {};
  const palette = parseColorPalette(themeRoot, reader);
  if (palette) out.palette = palette;
  const fontScheme = parseFontScheme(themeRoot, reader);
  if (fontScheme) out.fontScheme = fontScheme;
  const formatScheme = parseFormatScheme(themeRoot, reader);
  if (formatScheme) out.formatScheme = formatScheme;
  return out;
}

/**
 * Build the v1-shaped `docx[word/theme/theme1.xml]` object that
 * existing helpers like `resolveDocxFontFamily(...)` know how to walk.
 * Preserves the original xml-js element tree so callers needing legacy
 * compatibility do not have to reimplement font resolution.
 */
export function buildLegacyThemeShape(root: OoxmlElement | null | undefined): Record<string, unknown> | undefined {
  if (!root) return undefined;
  // The v1 helper expects the file root with `.elements = [a:theme]`.
  // xml-js gives us the top element; wrap it so `theme.elements[0]` is a:theme.
  return { elements: [root] };
}

function colorSchemeEntry(name: string, value: string): OoxmlElement {
  return {
    type: 'element',
    name: `a:${name}`,
    elements: [
      {
        type: 'element',
        name: 'a:srgbClr',
        attributes: {
          val: value.replace(/^#/, '').toUpperCase(),
        },
      },
    ],
  };
}

function fontSchemeEntry(name: 'a:majorFont' | 'a:minorFont', fontFamily?: WordThemeFontFamily): OoxmlElement {
  return {
    type: 'element',
    name,
    elements: [
      {
        type: 'element',
        name: 'a:latin',
        attributes: {
          typeface: fontFamily?.latin ?? '',
        },
      },
      {
        type: 'element',
        name: 'a:ea',
        attributes: {
          typeface: fontFamily?.ea ?? '',
        },
      },
      {
        type: 'element',
        name: 'a:cs',
        attributes: {
          typeface: fontFamily?.cs ?? '',
        },
      },
    ],
  };
}

export function buildFallbackThemeShape(
  theme: ThemeParseResult = {
    palette: DEFAULT_WORD_THEME_PALETTE,
    fontScheme: DEFAULT_WORD_THEME_FONT_SCHEME,
  },
): Record<string, unknown> {
  const palette = theme.palette ?? DEFAULT_WORD_THEME_PALETTE;
  const fontScheme = theme.fontScheme ?? DEFAULT_WORD_THEME_FONT_SCHEME;

  return {
    elements: [
      {
        type: 'element',
        name: 'a:theme',
        elements: [
          {
            type: 'element',
            name: 'a:themeElements',
            elements: [
              {
                type: 'element',
                name: 'a:clrScheme',
                elements: [
                  colorSchemeEntry('dk1', palette.dk1 ?? DEFAULT_WORD_THEME_PALETTE.dk1),
                  colorSchemeEntry('lt1', palette.lt1 ?? DEFAULT_WORD_THEME_PALETTE.lt1),
                  colorSchemeEntry('dk2', palette.dk2 ?? DEFAULT_WORD_THEME_PALETTE.dk2),
                  colorSchemeEntry('lt2', palette.lt2 ?? DEFAULT_WORD_THEME_PALETTE.lt2),
                  colorSchemeEntry('accent1', palette.accent1 ?? DEFAULT_WORD_THEME_PALETTE.accent1),
                  colorSchemeEntry('accent2', palette.accent2 ?? DEFAULT_WORD_THEME_PALETTE.accent2),
                  colorSchemeEntry('accent3', palette.accent3 ?? DEFAULT_WORD_THEME_PALETTE.accent3),
                  colorSchemeEntry('accent4', palette.accent4 ?? DEFAULT_WORD_THEME_PALETTE.accent4),
                  colorSchemeEntry('accent5', palette.accent5 ?? DEFAULT_WORD_THEME_PALETTE.accent5),
                  colorSchemeEntry('accent6', palette.accent6 ?? DEFAULT_WORD_THEME_PALETTE.accent6),
                  colorSchemeEntry('hlink', palette.hlink ?? DEFAULT_WORD_THEME_PALETTE.hlink),
                  colorSchemeEntry('folHlink', palette.folHlink ?? DEFAULT_WORD_THEME_PALETTE.folHlink),
                ],
              },
              {
                type: 'element',
                name: 'a:fontScheme',
                elements: [
                  fontSchemeEntry('a:majorFont', fontScheme.major),
                  fontSchemeEntry('a:minorFont', fontScheme.minor),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// Re-export findChildren so test code can introspect.
export { findChildren };
