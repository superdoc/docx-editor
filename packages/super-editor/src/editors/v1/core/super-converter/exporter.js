import { SuperConverter } from './SuperConverter.js';
import { inchesToTwips, linesToTwips, rgbToHex } from './helpers.js';
import { DEFAULT_DOCX_DEFS } from './exporter-docx-defs.js';
import { translateChildNodes } from './v2/exporter/helpers/index.js';
import { sortPropertyChildElements } from './v3/handlers/ooxml-property-order.js';
import { translator as wBrNodeTranslator } from './v3/handlers/w/br/br-translator.js';
import { translator as wHighlightTranslator } from './v3/handlers/w/highlight/highlight-translator.js';
import { translator as wTabNodeTranslator } from './v3/handlers/w/tab/tab-translator.js';
import { translator as wNoBreakHyphenNodeTranslator } from './v3/handlers/w/noBreakHyphen/no-break-hyphen-translator.js';
import { translator as wSmartTagNodeTranslator } from './v3/handlers/w/smartTag/smartTag-translator.js';
import { translator as wPNodeTranslator } from './v3/handlers/w/p/p-translator.js';
import { translator as wRNodeTranslator } from './v3/handlers/w/r/r-translator.js';
import { translator as wTcNodeTranslator } from './v3/handlers/w/tc/tc-translator';
import { translator as wTrNodeTranslator } from './v3/handlers/w/tr/tr-translator.js';
import { translator as wSdtNodeTranslator } from './v3/handlers/w/sdt/sdt-translator';
import { translator as wTblNodeTranslator } from './v3/handlers/w/tbl/tbl-translator.js';
import { translator as wUnderlineTranslator } from './v3/handlers/w/u/u-translator.js';
import { translator as wDrawingNodeTranslator } from './v3/handlers/w/drawing/drawing-translator.js';
import { translator as wBookmarkStartTranslator } from './v3/handlers/w/bookmark-start/index.js';
import { translator as wBookmarkEndTranslator } from './v3/handlers/w/bookmark-end/index.js';
import {
  commentRangeStartTranslator as wCommentRangeStartTranslator,
  commentRangeEndTranslator as wCommentRangeEndTranslator,
} from './v3/handlers/w/commentRange/index.js';
import { translator as wPermStartTranslator } from './v3/handlers/w/perm-start/index.js';
import { translator as wPermEndTranslator } from './v3/handlers/w/perm-end/index.js';
import { translator as sdPageReferenceTranslator } from '@converter/v3/handlers/sd/pageReference';
import { translator as sdCrossReferenceTranslator } from '@converter/v3/handlers/sd/crossReference/crossReference-translator.js';
import { translator as sdCitationTranslator } from '@converter/v3/handlers/sd/citation/citation-translator.js';
import { translator as sdBibliographyTranslator } from '@converter/v3/handlers/sd/bibliography/bibliography-translator.js';
import { translator as sdAuthorityEntryTranslator } from '@converter/v3/handlers/sd/authorityEntry/authorityEntry-translator.js';
import { translator as sdTableOfAuthoritiesTranslator } from '@converter/v3/handlers/sd/tableOfAuthorities/tableOfAuthorities-translator.js';
import { translator as sdSequenceFieldTranslator } from '@converter/v3/handlers/sd/sequenceField/sequenceField-translator.js';
import { translator as sdTableOfContentsTranslator } from '@converter/v3/handlers/sd/tableOfContents';
import { translator as sdIndexTranslator } from '@converter/v3/handlers/sd/index';
import { translator as sdIndexEntryTranslator } from '@converter/v3/handlers/sd/indexEntry';
import { translator as sdAutoPageNumberTranslator } from '@converter/v3/handlers/sd/autoPageNumber';
import { translator as sdTotalPageNumberTranslator } from '@converter/v3/handlers/sd/totalPageNumber';
import { translator as sdSectionPageCountTranslator } from '@converter/v3/handlers/sd/sectionPageCount';
import { translator as sdDocumentStatFieldTranslator } from '@converter/v3/handlers/sd/documentStatField/documentStatField-translator.js';
import { translator as pictTranslator } from './v3/handlers/w/pict/pict-translator';
import { translateVectorShape, translateShapeGroup } from '@converter/v3/handlers/wp/helpers/decode-image-node-helpers';
import { translator as wTextTranslator } from '@converter/v3/handlers/w/t';
import { translator as wFootnoteReferenceTranslator } from './v3/handlers/w/footnoteReference/footnoteReference-translator.js';
import { carbonCopy } from '@core/utilities/carbonCopy.js';
import { DEFAULT_XML_DECLARATION } from './constants.js';

const DEFAULT_SECTION_PROPS_TWIPS = Object.freeze({
  pageSize: Object.freeze({ width: '12240', height: '15840' }),
  pageMargins: Object.freeze({
    top: '1440',
    right: '1440',
    bottom: '1440',
    left: '1440',
    header: '720',
    footer: '720',
    gutter: '0',
  }),
});

export const ensureSectionLayoutDefaults = (sectPr, converter) => {
  if (!sectPr) {
    return {
      type: 'element',
      name: 'w:sectPr',
      elements: [],
    };
  }

  if (!sectPr.elements) sectPr.elements = [];

  const ensureChild = (name) => {
    let child = sectPr.elements.find((n) => n.name === name);
    if (!child) {
      child = {
        type: 'element',
        name,
        elements: [],
        attributes: {},
      };
      sectPr.elements.push(child);
    } else {
      if (!child.elements) child.elements = [];
      if (!child.attributes) child.attributes = {};
    }
    return child;
  };

  const pageSize = converter?.pageStyles?.pageSize;
  const pgSz = ensureChild('w:pgSz');
  if (pageSize?.width != null) pgSz.attributes['w:w'] = String(inchesToTwips(pageSize.width));
  if (pageSize?.height != null) pgSz.attributes['w:h'] = String(inchesToTwips(pageSize.height));
  if (pgSz.attributes['w:w'] == null) pgSz.attributes['w:w'] = DEFAULT_SECTION_PROPS_TWIPS.pageSize.width;
  if (pgSz.attributes['w:h'] == null) pgSz.attributes['w:h'] = DEFAULT_SECTION_PROPS_TWIPS.pageSize.height;

  const pageMargins = converter?.pageStyles?.pageMargins;
  const pgMar = ensureChild('w:pgMar');
  if (pageMargins) {
    Object.entries(pageMargins).forEach(([key, value]) => {
      const converted = inchesToTwips(value);
      if (converted != null) pgMar.attributes[`w:${key}`] = String(converted);
    });
  }
  Object.entries(DEFAULT_SECTION_PROPS_TWIPS.pageMargins).forEach(([key, value]) => {
    const attrKey = `w:${key}`;
    if (pgMar.attributes[attrKey] == null) pgMar.attributes[attrKey] = value;
  });

  return sectPr;
};

/**
 * Walk an XML JSON tree in place and normalize every `<w:pgMar>` element's
 * numeric attributes to integer twips.
 *
 * ECMA-376 §17.6.11 requires `ST_TwipsMeasure` values to be non-negative whole
 * numbers when expressed as raw twips, but some authoring pipelines emit
 * float-valued twips like `w:top="168.160400390625"` that strict consumers
 * reject. SuperDoc preserves those floats verbatim on the paragraph-level
 * sectPr passthrough path. This pass is the single normalization point —
 * applied once at the export root — so we produce schema-valid output
 * regardless of which path the pgMar values reached the tree through
 * (body sectPr → `pageMargins` → `inchesToTwips`, or paragraph-level
 * passthrough sectPr that preserved source attrs).
 *
 * Idempotent. Mutates the tree in place; returns nothing. SD-2912.
 *
 * @param {{ name?: string, attributes?: Record<string, unknown>, elements?: Array<unknown> } | null | undefined} node
 * @returns {void}
 */
export const normalizePgMarTwipsInTree = (node) => {
  if (!node || typeof node !== 'object') return;
  if (node.name === 'w:pgMar' && node.attributes && typeof node.attributes === 'object') {
    for (const key of Object.keys(node.attributes)) {
      const value = node.attributes[key];
      if (value == null) continue;
      const serialized = String(value).trim();
      if (!serialized) continue;
      const num = Number(serialized);
      if (Number.isFinite(num) && !/^-?\d+$/.test(serialized)) {
        node.attributes[key] = String(Math.round(num));
      }
    }
  }
  if (Array.isArray(node.elements)) {
    for (const child of node.elements) normalizePgMarTwipsInTree(child);
  }
};

export const isLineBreakOnlyRun = (node) => {
  if (!node) return false;
  if (node.type === 'lineBreak' || node.type === 'hardBreak') return true;
  if (node.type !== 'run') return false;
  const runContent = Array.isArray(node.content) ? node.content : [];
  if (!runContent.length) return false;
  return runContent.every((child) => child?.type === 'lineBreak' || child?.type === 'hardBreak');
};

/**
 * @typedef {Object} ExportParams
 * @property {Object} node JSON node to translate (from PM schema)
 * @property {Object} [bodyNode] The stored body node to restore, if available
 * @property {Object[]} [relationships] The relationships to add to the document
 * @property {Object} [extraParams] The extra params from NodeTranslator
 */

/**
 * @typedef {Object} SchemaNode
 * @property {string} type The name of this node from the prose mirror schema
 * @property {Array<SchemaNode>} content The child nodes
 * @property {Object} attrs The node attributes
 * /

/**
 * @typedef {Object} XmlReadyNode
 * @property {string} name The XML tag name
 * @property {Array<XmlReadyNode>} elements The child nodes
 * @property {Object} [attributes] The node attributes
 */

/**
 * @typedef {Object.<string, *>} SchemaAttributes
 * Key value pairs representing the node attributes from prose mirror
 */

/**
 * @typedef {Object.<string, *>} XmlAttributes
 * Key value pairs representing the node attributes to export to XML format
 */

/**
 * @typedef {Object} MarkType
 * @property {string} type The mark type
 * @property {Object} attrs Any attributes for this mark
 */

/**
 * Main export function. It expects the prose mirror data as JSON (ie: a doc node)
 *
 * @param {ExportParams} params - The parameters object, containing a node and possibly a body node
 * @returns {XmlReadyNode} The complete document node in XML-ready format
 */
export function exportSchemaToJson(params) {
  const { type } = params.node || {};

  // Node handlers for each node type that we can export
  const router = {
    doc: translateDocumentNode,
    body: translateBodyNode,
    heading: translateHeadingNode,
    paragraph: wPNodeTranslator,
    run: wRNodeTranslator,
    text: wTextTranslator,
    lineBreak: wBrNodeTranslator,
    table: wTblNodeTranslator,
    tableRow: wTrNodeTranslator,
    tableCell: wTcNodeTranslator,
    tableHeader: wTcNodeTranslator,
    bookmarkStart: wBookmarkStartTranslator,
    bookmarkEnd: wBookmarkEndTranslator,
    fieldAnnotation: wSdtNodeTranslator,
    tab: wTabNodeTranslator,
    noBreakHyphen: wNoBreakHyphenNodeTranslator,
    smartTag: wSmartTagNodeTranslator,
    image: [wDrawingNodeTranslator, pictTranslator],
    hardBreak: wBrNodeTranslator,
    commentRangeStart: wCommentRangeStartTranslator,
    commentRangeEnd: wCommentRangeEndTranslator,
    permStart: wPermStartTranslator,
    permEnd: wPermEndTranslator,
    permStartBlock: wPermStartTranslator,
    permEndBlock: wPermEndTranslator,
    commentReference: [],
    footnoteReference: wFootnoteReferenceTranslator,
    shapeContainer: pictTranslator,
    shapeTextbox: pictTranslator,
    contentBlock: pictTranslator,
    vectorShape: translateVectorShape,
    shapeGroup: translateShapeGroup,
    chart: wDrawingNodeTranslator,
    structuredContent: wSdtNodeTranslator,
    structuredContentBlock: wSdtNodeTranslator,
    documentPartObject: wSdtNodeTranslator,
    documentSection: wSdtNodeTranslator,
    'page-number': sdAutoPageNumberTranslator,
    'total-page-number': sdTotalPageNumberTranslator,
    'section-page-count': sdSectionPageCountTranslator,
    pageReference: sdPageReferenceTranslator,
    crossReference: sdCrossReferenceTranslator,
    citation: sdCitationTranslator,
    bibliography: sdBibliographyTranslator,
    authorityEntry: sdAuthorityEntryTranslator,
    tableOfAuthorities: sdTableOfAuthoritiesTranslator,
    sequenceField: sdSequenceFieldTranslator,
    documentStatField: sdDocumentStatFieldTranslator,
    tableOfContents: sdTableOfContentsTranslator,
    index: sdIndexTranslator,
    indexEntry: sdIndexEntryTranslator,
    mathBlock: translatePassthroughNode,
    mathInline: translatePassthroughNode,
    passthroughBlock: translatePassthroughNode,
    passthroughInline: translatePassthroughNode,
  };

  const entry = router[type];

  if (!entry) {
    console.error('No translation function found for node type:', type);
    return null;
  }

  const handlers = Array.isArray(entry) ? entry : [entry];
  for (const handler of handlers) {
    let result;
    if (handler && 'decode' in handler && typeof handler.decode === 'function') {
      result = handler.decode(params);
    } else if (typeof handler === 'function') {
      result = handler(params);
    }

    if (result) {
      return result;
    }
  }

  return null;
}

export function translatePassthroughNode(params) {
  const original = params?.node?.attrs?.originalXml;
  if (!original) return null;
  return carbonCopy(original);
}

/**
 * There is no body node in the prose mirror schema, so it is stored separately
 * and needs to be restored here.
 *
 * @param {ExportParams} params
 * @returns {XmlReadyNode} JSON of the XML-ready body node
 */
function translateBodyNode(params) {
  const liveSectPr = params.converter?.bodySectPr;
  let sectPr =
    (liveSectPr && typeof liveSectPr === 'object' ? carbonCopy(liveSectPr) : null) ||
    params.bodyNode?.elements?.find((n) => n.name === 'w:sectPr');
  if (!sectPr) {
    sectPr = {
      type: 'element',
      name: 'w:sectPr',
      elements: [],
    };
  } else if (!sectPr.elements) {
    sectPr = { ...sectPr, elements: [] };
  }

  sectPr = ensureSectionLayoutDefaults(sectPr, params.converter);

  if (params.converter) {
    // COMPATIBILITY FALLBACK: Synthesizes a default header/footer reference in
    // the exported sectPr when one was created via the old converter-only path
    // but never wired as a real section ref. After the parts-backed
    // materialization fix (ensureExplicitHeaderFooterSlot), new UI-created
    // slots already have real refs at creation time, so this fallback should
    // only fire for legacy/import-only paths. Do not remove without verifying
    // import round-trip coverage.
    const canExportHeaderRef = params.converter.importedBodyHasHeaderRef || params.converter.headerFooterModified;
    const canExportFooterRef = params.converter.importedBodyHasFooterRef || params.converter.headerFooterModified;
    const hasHeader = sectPr.elements?.some((n) => n.name === 'w:headerReference');
    const hasDefaultHeader = params.converter.headerIds?.default;
    if (!hasHeader && hasDefaultHeader && !params.editor.options.isHeaderOrFooter && canExportHeaderRef) {
      const defaultHeader = generateDefaultHeaderFooter('header', params.converter.headerIds?.default);
      sectPr.elements.push(defaultHeader);
    }

    const hasFooter = sectPr.elements?.some((n) => n.name === 'w:footerReference');
    const hasDefaultFooter = params.converter.footerIds?.default;
    if (!hasFooter && hasDefaultFooter && !params.editor.options.isHeaderOrFooter && canExportFooterRef) {
      const defaultFooter = generateDefaultHeaderFooter('footer', params.converter.footerIds?.default);
      sectPr.elements.push(defaultFooter);
    }

    // Re-emit footnote properties if they were parsed during import
    const hasFootnotePr = sectPr.elements?.some((n) => n.name === 'w:footnotePr');
    const footnoteProperties = params.converter.footnoteProperties;
    if (!hasFootnotePr && footnoteProperties?.source === 'sectPr' && footnoteProperties.originalXml) {
      sectPr.elements.push(carbonCopy(footnoteProperties.originalXml));
    }
  }

  const elements = translateChildNodes(params);

  if (params.isHeaderFooter) {
    return {
      name: 'w:body',
      elements: [...elements],
    };
  }

  return {
    name: 'w:body',
    elements: [...elements, sectPr],
  };
}

const generateDefaultHeaderFooter = (type, id) => {
  return {
    type: 'element',
    name: `w:${type}Reference`,
    attributes: {
      'w:type': 'default',
      'r:id': id,
    },
  };
};

/**
 * Translate a heading node to a paragraph with Word heading style
 *
 * @param {ExportParams} params The parameters object containing the heading node
 * @returns {XmlReadyNode} JSON of the XML-ready paragraph node with heading style
 */
function translateHeadingNode(params) {
  const { node } = params;
  const { level = 1, ...otherAttrs } = node.attrs;

  // Convert heading to paragraph with appropriate Word heading style
  const paragraphNode = {
    type: 'paragraph',
    content: node.content,
    attrs: {
      ...otherAttrs,
      styleId: `Heading${level}`, // Maps to Heading1, Heading2, etc. in Word
    },
  };

  // Use existing paragraph translator with the modified node
  return wPNodeTranslator.decode({ ...params, node: paragraphNode });
}

/**
 * Merge mc:Ignorable lists from two attribute objects, deduplicating entries.
 *
 * @param {string} defaultIgnorable - The default mc:Ignorable string
 * @param {string} originalIgnorable - The original mc:Ignorable string from import
 * @returns {string} Merged and deduplicated mc:Ignorable string
 */
function mergeMcIgnorable(defaultIgnorable = '', originalIgnorable = '') {
  const merged = [
    ...new Set([...defaultIgnorable.split(/\s+/).filter(Boolean), ...originalIgnorable.split(/\s+/).filter(Boolean)]),
  ];
  return merged.join(' ');
}

function normalizeDocumentBackgroundColorForExport(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return hex.toUpperCase();
}

function translateDocumentBackgroundNode(params) {
  const background = params?.node?.attrs?.documentBackground;
  if (!background || typeof background !== 'object') return null;

  if (background.originalXml && typeof background.originalXml === 'object') {
    return carbonCopy(background.originalXml);
  }

  const color = normalizeDocumentBackgroundColorForExport(background.color);
  if (!color) return null;

  return {
    type: 'element',
    name: 'w:background',
    attributes: { 'w:color': color },
    elements: [],
  };
}

/**
 * Translate a document node
 *
 * @param {ExportParams} params The parameters object
 * @returns {XmlReadyNode} JSON of the XML-ready document node
 */
function translateDocumentNode(params) {
  const bodyNode = {
    type: 'body',
    content: params.node.content,
  };

  const translatedBackgroundNode = translateDocumentBackgroundNode(params);
  const translatedBodyNode = exportSchemaToJson({ ...params, node: bodyNode });

  // Merge original document attributes with defaults to preserve custom namespaces
  const originalAttrs = params.converter?.documentAttributes || {};
  const attributes = {
    ...DEFAULT_DOCX_DEFS,
    ...originalAttrs,
  };

  // Merge mc:Ignorable lists - combine both default and original ignorable namespaces
  const mergedIgnorable = mergeMcIgnorable(DEFAULT_DOCX_DEFS['mc:Ignorable'], originalAttrs['mc:Ignorable']);
  if (mergedIgnorable) {
    attributes['mc:Ignorable'] = mergedIgnorable;
  }

  const node = {
    name: 'w:document',
    elements: translatedBackgroundNode ? [translatedBackgroundNode, translatedBodyNode] : [translatedBodyNode],
    attributes,
  };

  // SD-2912: normalize every <w:pgMar> in the final tree to integer twips,
  // catching both the body sectPr path (already integer-correct via
  // inchesToTwips) and the paragraph-level passthrough sectPr path that
  // preserves source attrs verbatim.
  normalizePgMarTwipsInTree(node);

  return [node, params];
}

/**
 * Wrap a text node in a run
 *
 * @param {XmlReadyNode} node
 * @returns {XmlReadyNode} The wrapped run node
 */
export function wrapTextInRun(nodeOrNodes, marks) {
  let elements = [];
  if (Array.isArray(nodeOrNodes)) elements = nodeOrNodes;
  else elements = [nodeOrNodes];

  if (marks && marks.length) elements.unshift(generateRunProps(marks));
  return {
    name: 'w:r',
    elements,
  };
}

/**
 * Generate a w:rPr node (run properties) from marks
 *
 * @param {Object[]} marks The marks to add to the run properties
 * @returns
 */
export function generateRunProps(marks = []) {
  return {
    name: 'w:rPr',
    // w:rPr is an ECMA-376 xsd:sequence (CT_RPr); emit children in canonical
    // schema order rather than mark-array order so Word for the web accepts it.
    elements: sortPropertyChildElements(
      'w:rPr',
      marks.filter((mark) => !!Object.keys(mark).length),
    ),
  };
}

/**
 * Get all marks as a list of MarkType objects
 *
 * @param {MarkType[]} marks
 * @returns
 */
export function processOutputMarks(marks = []) {
  return marks.flatMap((mark) => {
    if (mark.type === 'textStyle') {
      return Object.entries(mark.attrs)
        .filter(([, value]) => value)
        .map(([key]) => {
          const unwrappedMark = { type: key, attrs: mark.attrs };
          return translateMark(unwrappedMark);
        });
    } else {
      return translateMark(mark);
    }
  });
}

/**
 * Translate a mark to an XML ready attribute
 *
 * @param {MarkType} mark
 * @returns {Object} The XML ready mark attribute
 */
function translateMark(mark) {
  const xmlMark = SuperConverter.markTypes.find((m) => m.type === mark.type);
  if (!xmlMark) {
    return {};
  }

  const markElement = { name: xmlMark.name, attributes: {} };

  const { attrs } = mark;
  let value;

  switch (mark.type) {
    case 'bold':
      if (attrs?.value) {
        markElement.attributes['w:val'] = attrs.value;
      } else {
        delete markElement.attributes;
      }
      markElement.type = 'element';
      break;

    case 'italic':
      if (attrs?.value && attrs.value !== '1' && attrs.value !== true) {
        markElement.attributes['w:val'] = attrs.value;
      } else {
        delete markElement.attributes;
      }
      markElement.type = 'element';
      break;

    case 'underline': {
      const translated = wUnderlineTranslator.decode({
        node: {
          attrs: {
            underlineType: attrs.underlineType ?? attrs.underline ?? null,
            underlineColor: attrs.underlineColor ?? attrs.color ?? null,
            underlineThemeColor: attrs.underlineThemeColor ?? attrs.themeColor ?? null,
            underlineThemeTint: attrs.underlineThemeTint ?? attrs.themeTint ?? null,
            underlineThemeShade: attrs.underlineThemeShade ?? attrs.themeShade ?? null,
          },
        },
      });
      return translated || {};
    }

    // Text style cases
    case 'fontSize':
      value = attrs.fontSize;
      markElement.attributes['w:val'] = value.slice(0, -2) * 2; // Convert to half-points
      break;

    case 'fontFamily':
      value = attrs.fontFamily;
      ['w:ascii', 'w:eastAsia', 'w:hAnsi', 'w:cs'].forEach((attr) => {
        const parsedValue = value.split(', ');
        markElement.attributes[attr] = parsedValue[0] ? parsedValue[0] : value;
      });
      break;

    // Add ability to get run styleIds from textStyle marks and inject to run properties in word
    case 'styleId':
      markElement.name = 'w:rStyle';
      markElement.attributes['w:val'] = attrs.styleId;
      break;

    case 'color': {
      const rawColor = attrs.color;
      if (!rawColor) break;

      const normalized = String(rawColor).trim().toLowerCase();
      if (normalized === 'inherit') {
        markElement.attributes['w:val'] = 'auto';
        break;
      }

      let processedColor = String(rawColor).replace(/^#/, '').replace(/;$/, ''); // Remove `#` and `;` if present
      if (processedColor.startsWith('rgb')) {
        processedColor = rgbToHex(processedColor);
      }
      markElement.attributes['w:val'] = processedColor;
      break;
    }

    case 'textAlign':
      markElement.attributes['w:val'] = attrs.textAlign;
      break;

    case 'textIndent':
      markElement.attributes['w:firstline'] = inchesToTwips(attrs.textIndent);
      break;

    case 'textTransform':
      if (attrs?.textTransform === 'none') {
        markElement.attributes['w:val'] = '0';
      } else {
        delete markElement.attributes;
      }
      markElement.type = 'element';
      break;

    case 'lineHeight':
      markElement.attributes['w:line'] = linesToTwips(attrs.lineHeight);
      break;
    case 'highlight': {
      const highlightValue = attrs.color ?? attrs.highlight ?? null;
      if (String(highlightValue).trim().toLowerCase() === 'transparent' && !attrs.ooxmlHighlightClear) {
        return {};
      }
      const translated = wHighlightTranslator.decode({ node: { attrs: { highlight: highlightValue } } });
      return translated || {};
    }
    case 'strike':
      if (attrs?.value === '0') markElement.attributes['w:val'] = attrs.value;
      break;

    case 'link':
      return {};
  }

  return markElement;
}

export class DocxExporter {
  constructor(converter) {
    this.converter = converter;
  }

  schemaToXml(data, debug = false) {
    const result = this.#generate_xml_as_list(data, debug);
    return result.join('');
  }

  #generate_xml_as_list(data, debug = false) {
    const json = JSON.parse(JSON.stringify(data));
    const declaration = this.converter.declaration?.attributes ?? DEFAULT_XML_DECLARATION.attributes;
    const xmlTag = `<?xml${Object.entries(declaration)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join('')}?>`;
    const result = this.#generateXml(json, debug);
    const final = [xmlTag, ...result];
    return final;
  }

  #replaceSpecialCharacters(text) {
    if (text === undefined || text === null) return text;
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Recursively generates XML string representation from a JSON node structure.
   * Handles special processing for different element types to maintain Word document integrity.
   *
   * Processing behavior by element type:
   * - Text nodes (type='text'): Escapes special XML characters (&, <, >, ", ')
   * - w:instrText: Joins child text nodes and escapes special characters; preserves field instruction syntax
   * - w:t, w:delText, wp:posOffset: Removes [[sdspace]] placeholders that were added during import to preserve
   *   whitespace, then escapes special characters. These placeholders are temporary markers used internally.
   * - Other elements: Recursively processes child elements
   *
   * @param {Object} node - The JSON node to convert to XML
   * @param {string} node.name - The XML element name (e.g., 'w:t', 'w:p')
   * @param {Object} [node.attributes] - Key-value pairs of XML attributes
   * @param {Array} [node.elements] - Array of child nodes to process recursively
   * @param {string} [node.type] - Node type ('text' for text nodes, 'element' for XML elements)
   * @param {string} [node.text] - The text content (only present when type='text')
   * @returns {string[]|string|null} Array of XML string fragments for elements, string for text nodes, or null for invalid nodes
   * @throws {Error} Logs error to console if text element processing fails, then continues processing
   *
   * @example
   * // Simple text element
   * const node = {
   *   name: 'w:t',
   *   elements: [{ type: 'text', text: 'Hello World' }]
   * };
   * // Returns: ['<w:t>', 'Hello World', '</w:t>']
   *
   * @example
   * // Element with placeholder removal
   * const node = {
   *   name: 'w:t',
   *   elements: [{ type: 'text', text: 'Text[[sdspace]]content' }]
   * };
   * // Returns: ['<w:t>', 'Textcontent', '</w:t>']
   */
  #generateXml(node, insideDeletion = false) {
    if (!node) return null;
    let { name } = node;
    const { elements, attributes } = node;

    // Normalize w:delInstrText → w:instrText. During import, w:del wrappers around
    // field character runs lose their trackDelete marks (only text content gets marked),
    // so on export the w:del wrapper is absent. Per ECMA-376 §17.16.13, w:delInstrText
    // outside w:del is non-conformant — renaming to w:instrText keeps the field valid.
    // Inside a surviving w:del wrapper, ECMA-376 expects w:delInstrText to remain intact.
    if (name === 'w:delInstrText' && !insideDeletion) {
      name = 'w:instrText';
    }

    let tag = `<${name}`;

    for (let attr in attributes) {
      const parsedAttrName =
        typeof attributes[attr] === 'string' ? this.#replaceSpecialCharacters(attributes[attr]) : attributes[attr];
      tag += ` ${attr}="${parsedAttrName}"`;
    }

    const selfClosing = name && (!elements || !elements.length);
    if (selfClosing) tag += ' />';
    else tag += '>';
    let tags = [tag];

    if (!name && node.type === 'text') {
      return this.#replaceSpecialCharacters(node.text ?? '');
    }

    const nextInsideDeletion = insideDeletion || name === 'w:del';

    if (elements) {
      if (name === 'w:instrText' || name === 'w:delInstrText') {
        const textContent = (elements || [])
          .map((child) => (typeof child?.text === 'string' ? child.text : ''))
          .join('');
        tags.push(this.#replaceSpecialCharacters(textContent));
      } else if (name === 'w:t' || name === 'w:delText' || name === 'wp:posOffset') {
        // Validate that the first child element has valid text content
        if (elements.length === 0) {
          // Empty elements array - will be handled as self-closing tag, which is an error state
          console.error(`${name} element has no child elements. Expected text node. Element will be self-closing.`);
        } else if (elements[0] == null || typeof elements[0].text !== 'string') {
          // Invalid or missing text content - push empty string to maintain XML structure
          console.error(
            `${name} element's first child is missing or does not have a valid text property. ` +
              `Received: ${JSON.stringify(elements[0])}. Pushing empty string to maintain XML structure.`,
          );
          tags.push('');
        } else {
          // Valid text content - remove [[sdspace]] placeholders that were added during XML import
          // to preserve whitespace, then escape special XML characters
          let text = elements[0].text.replace(/\[\[sdspace\]\]/g, '');
          text = this.#replaceSpecialCharacters(text);
          tags.push(text);
        }
      } else {
        if (elements) {
          for (let child of elements) {
            const newElements = this.#generateXml(child, nextInsideDeletion);
            if (!newElements) {
              continue;
            }

            if (typeof newElements === 'string') {
              tags.push(newElements);
              continue;
            }

            const removeUndefined = newElements.filter((el) => {
              const isUndefined = el === '<undefined>' || el === '</undefined>';
              return !isUndefined;
            });

            for (const element of removeUndefined) {
              tags.push(element);
            }
          }
        }
      }
    }

    if (!selfClosing) tags.push(`</${name}>`);
    return tags;
  }
}
