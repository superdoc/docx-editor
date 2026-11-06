import {
  captureCommentAuthorSource,
  readCommentAuthorSourceRows,
  hasLocalCommentAuthorSourceConflict,
  prepareCommentAuthors,
  commentPeopleUpdatedFiles,
  preservePeopleWhitespace,
} from './comment-author-identity.js';
import { decodeYjsToEnvelope } from '../../extensions/collaboration/part-sync/json-crdt.js';
import {
  PARTS_MAP_KEY,
  META_MAP_KEY,
  META_PARTS_SCHEMA_VERSION_KEY,
  META_PARTS_CAPABILITY_KEY,
  META_PARTS_LAST_HYDRATED_AT_KEY,
  META_PARTS_FALLBACK_MODE_KEY,
} from '../../extensions/collaboration/part-sync/constants.js';
/* global TextEncoder */
import * as xmljs from 'xml-js';
import { v4 as uuidv4 } from 'uuid';
import { DocxExporter, exportSchemaToJson } from './exporter';
import {
  createDocumentJson,
  addDefaultStylesIfMissing,
  defaultNodeListHandler,
  filterOutRootInlineNodes,
} from './v2/importer/docxImporter.js';
import { normalizeDuplicateBlockIdentitiesInContent } from './v2/importer/normalizeDuplicateBlockIdentitiesInContent.js';
import { preProcessPageFieldsOnly } from './field-references/preProcessPageFieldsOnly.js';
import { carbonCopy } from '../utilities/carbonCopy.js';
import { deobfuscateFont, getArrayBufferFromUrl, computeCrc32Hex } from './helpers.js';
import { parseEmbeddingPolicy } from '@superdoc/font-system';
import { baseNumbering } from './v2/exporter/helpers/base-list.definitions.js';
import { DEFAULT_CUSTOM_XML, DEFAULT_DOCX_DEFS } from './exporter-docx-defs.js';
import {
  getCommentDefinition,
  prepareCommentParaIds,
  prepareCommentsXmlFilesForExport,
} from './v2/exporter/commentsExporter.js';
import { prepareFootnotesXmlForExport, prepareEndnotesXmlForExport } from './v2/exporter/footnotesExporter.js';
import { writeAppStatistics } from '../../document-api-adapters/helpers/app-properties.js';
import { getWordStatistics, resolveMainBodyEditor } from '../../document-api-adapters/helpers/word-statistics.js';
import { refreshAllStatFields } from '../../document-api-adapters/helpers/refresh-stat-fields.js';
import { ensureSettingsRoot, hasUpdateFields, setUpdateFields } from '../../document-api-adapters/document-settings.js';
import { importFootnoteData, importEndnoteData } from './v2/importer/documentFootnotesImporter.js';
import { DocxHelpers } from './docx-helpers/index.js';
import { mergeRelationshipElements } from './relationship-helpers.js';
import { getWordPartRelsPath, normalizeWordPartPath } from '../helpers/word-part-path.js';
import { COMMENT_RELATIONSHIP_TYPES } from './constants.js';
import {
  createEmptyBibliographyPart,
  loadBibliographyPartFromPackage,
  syncBibliographyPartToPackage,
  getBibliographyPartExportPaths,
} from './citation-sources.js';
const FONT_FAMILY_FALLBACKS = Object.freeze({
  swiss: 'Arial, sans-serif',
  roman: 'Times New Roman, serif',
  modern: 'Courier New, monospace',
  script: 'cursive',
  decorative: 'fantasy',
  system: 'system-ui',
  auto: 'sans-serif',
});

const DEFAULT_GENERIC_FALLBACK = 'sans-serif';
const DEFAULT_FONT_SIZE_PT = 10;
const CURRENT_APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';
const SUPERDOC_DOCUMENT_ORIGIN_PROPERTY = 'SuperdocDocumentOrigin';
const STORED_DOCUMENT_ORIGINS = new Set(['word', 'google-docs', 'unknown', 'superdoc']);

/**
 * Pull default run formatting (font family, size, kern) out of a DOCX run properties node.
 * Mutates the supplied state object with any discovered values.
 */
const collectRunDefaultProperties = (
  runProps,
  { allowOverrideTypeface = true, allowOverrideSize = true, themeResolver, state },
) => {
  if (!runProps?.elements?.length || !state) return;

  const fontsNode = runProps.elements.find((el) => el.name === 'w:rFonts');
  if (fontsNode?.attributes) {
    const themeName = fontsNode.attributes['w:asciiTheme'];
    if (themeName) {
      const themeInfo = themeResolver?.(themeName) || {};
      if ((allowOverrideTypeface || !state.typeface) && themeInfo.typeface) state.typeface = themeInfo.typeface;
      if ((allowOverrideTypeface || !state.panose) && themeInfo.panose) state.panose = themeInfo.panose;
    }

    const ascii = fontsNode.attributes['w:ascii'];
    if ((allowOverrideTypeface || !state.typeface) && ascii) {
      state.typeface = ascii;
    }
  }

  const sizeNode = runProps.elements.find((el) => el.name === 'w:sz');
  if (sizeNode?.attributes?.['w:val']) {
    const sizeTwips = Number(sizeNode.attributes['w:val']);
    if (Number.isFinite(sizeTwips)) {
      if (state.fallbackSzTwips === undefined) state.fallbackSzTwips = sizeTwips;
      const sizePt = sizeTwips / 2;
      if (allowOverrideSize || state.fontSizePt === undefined) state.fontSizePt = sizePt;
    }
  }

  const kernNode = runProps.elements.find((el) => el.name === 'w:kern');
  if (kernNode?.attributes?.['w:val']) {
    if (allowOverrideSize || state.kern === undefined) state.kern = kernNode.attributes['w:val'];
  }
};

class SuperConverter {
  static allowedElements = Object.freeze({
    'w:document': 'doc',
    'w:body': 'body',
    'w:p': 'paragraph',
    'w:r': 'run',
    'w:t': 'text',
    'w:delText': 'text',
    'w:br': 'lineBreak',
    'w:tbl': 'table',
    'w:tr': 'tableRow',
    'w:tc': 'tableCell',
    'w:drawing': 'drawing',
    'w:bookmarkStart': 'bookmarkStart',
    // 'w:tab': 'tab',

    // Formatting only
    'w:sectPr': 'sectionProperties',
    'w:rPr': 'runProperties',

    // Comments
    'w:commentRangeStart': 'commentRangeStart',
    'w:commentRangeEnd': 'commentRangeEnd',
    'w:commentReference': 'commentReference',
  });

  static markTypes = [
    { name: 'w:b', type: 'bold', property: 'value' },
    // { name: 'w:bCs', type: 'bold' },
    { name: 'w:i', type: 'italic' },
    // { name: 'w:iCs', type: 'italic' },
    { name: 'w:u', type: 'underline', mark: 'underline', property: 'underlineType' },
    { name: 'w:strike', type: 'strike', mark: 'strike', property: 'value' },
    { name: 'w:color', type: 'color', mark: 'textStyle', property: 'color' },
    { name: 'w:sz', type: 'fontSize', mark: 'textStyle', property: 'fontSize' },
    // { name: 'w:szCs', type: 'fontSize', mark: 'textStyle', property: 'fontSize' },
    { name: 'w:rFonts', type: 'fontFamily', mark: 'textStyle', property: 'fontFamily' },
    { name: 'w:rStyle', type: 'styleId', mark: 'textStyle', property: 'styleId' },
    { name: 'w:jc', type: 'textAlign', mark: 'textStyle', property: 'textAlign' },
    { name: 'w:ind', type: 'textIndent', mark: 'textStyle', property: 'textIndent' },
    { name: 'w:spacing', type: 'lineHeight', mark: 'textStyle', property: 'lineHeight' },
    { name: 'w:spacing', type: 'letterSpacing', mark: 'textStyle', property: 'letterSpacing' },
    { name: 'link', type: 'link', mark: 'link', property: 'href' },
    { name: 'w:highlight', type: 'highlight', mark: 'highlight', property: 'color' },
    { name: 'w:shd', type: 'highlight', mark: 'highlight', property: 'color' },
    { name: 'w:caps', type: 'textTransform', mark: 'textStyle', property: 'textTransform' },
  ];

  static propertyTypes = Object.freeze({
    'w:pPr': 'paragraphProperties',
    'w:rPr': 'runProperties',
    'w:sectPr': 'sectionProperties',
    'w:numPr': 'numberingProperties',
    'w:tcPr': 'tableCellProperties',
  });

  static elements = new Set(['w:document', 'w:body', 'w:p', 'w:r', 'w:t', 'w:delText']);

  static getFontTableEntry(docx, fontName) {
    if (!docx || !fontName) return null;
    const fontTable = docx['word/fontTable.xml'];
    if (!fontTable?.elements?.length) return null;
    const fontsNode = fontTable.elements.find((el) => el.name === 'w:fonts');
    if (!fontsNode?.elements?.length) return null;
    return fontsNode.elements.find((el) => el?.attributes?.['w:name'] === fontName) || null;
  }

  static getFallbackFromFontTable(docx, fontName) {
    const fontEntry = SuperConverter.getFontTableEntry(docx, fontName);
    const family = fontEntry?.elements?.find((child) => child.name === 'w:family')?.attributes?.['w:val'];
    if (!family) return null;
    const mapped = FONT_FAMILY_FALLBACKS[family.toLowerCase()];
    return mapped || DEFAULT_GENERIC_FALLBACK;
  }

  static toCssFontFamily(fontName, docx) {
    if (!fontName) return fontName;
    if (fontName.includes(',')) return fontName;

    const fallback = SuperConverter.getFallbackFromFontTable(docx, fontName) || DEFAULT_GENERIC_FALLBACK;

    const normalizedFallbackParts = fallback
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    if (normalizedFallbackParts.includes(fontName.trim().toLowerCase())) {
      return fallback;
    }

    return `${fontName}, ${fallback}`;
  }

  constructor(params = null) {
    // Suppress logging when true
    this.debug = params?.debug || false;

    // Optional DOM environment for server-side usage (e.g., JSDOM)
    this.domEnvironment = {
      mockWindow: params?.mockWindow || null,
      mockDocument: params?.mockDocument || null,
    };

    // Important docx pieces
    this.declaration = null;
    this.documentAttributes = null;

    // The docx as a list of files
    this.convertedXml = {};
    this.docx = params?.docx || [];
    this.media = params?.media || {};

    this.fonts = params?.fonts || {};

    /**
     * Track-changes options forwarded from the editor. Consumed during
     * import (e.g. by `buildTrackedChangeIdMap`) so behaviors like
     * `replacements` can be toggled per SuperDoc instance.
     * @type {{ replacements?: 'paired' | 'independent' } | null}
     */
    this.trackedChangesOptions = params?.trackedChangesOptions || null;

    /**
     * Word revision id allocator. Built lazily at export time; preserves
     * imported decimal `w:id` values and mints fresh part-local decimal ids
     * for native revisions / successor fragments.
     * @type {import('@extensions/track-changes/review-model/word-id-allocator').WordIdAllocator | null}
     */
    this.wordIdAllocator = null;

    this.addedMedia = {};
    this.comments = [];
    this.commentAuthorAssignments = new Map();
    this.commentAuthorSource = captureCommentAuthorSource({});
    this.commentPeopleExport = undefined;
    this.footnotes = [];
    this.footnoteProperties = null;
    this.bibliographyPart = createEmptyBibliographyPart();
    this.viewSetting = null;
    this.inlineDocumentFonts = [];
    this.commentThreadingProfile = null;

    /** @type {string[]} Warnings emitted during export */
    this.exportWarnings = [];

    // Store custom highlight colors
    this.docHiglightColors = new Set([]);

    // XML inputs
    this.xml = params?.xml;
    this.declaration = null;

    // List defs (deprecated)
    this.numbering = {};

    // Translated numbering definitions
    this.translatedNumbering = {};

    // Processed additional content
    this.numbering = null;
    this.pageStyles = null;
    this.themeColors = null;

    // The JSON converted XML before any processing. This is simply the result of xml2json
    this.initialJSON = null;

    // Headers and footers
    this.headers = {};
    this.headerIds = { default: null, even: null, odd: null, first: null };
    this.headerEditors = [];
    this.footers = {};
    this.footerIds = { default: null, even: null, odd: null, first: null };
    this.footerEditors = [];
    this.importedBodyHasHeaderRef = false;
    this.importedBodyHasFooterRef = false;
    this.headerFooterModified = false;

    // Linked Styles (deprecated)
    this.linkedStyles = [];

    // Translated linked styles
    this.translatedLinkedStyles = {};

    // This is the JSON schema that we will be working with
    this.json = params?.json;

    this.tagsNotInSchema = ['w:body'];
    this.savedTagsToRestore = [];

    this.documentInternalId = null;

    // Uploaded file
    this.fileSource = params?.fileSource || null;
    this.documentId = params?.documentId || null;

    // Document identification
    this.documentGuid = null; // Permanent GUID (from MS docId, custom property, or generated)
    this.documentUniqueIdentifier = null; // Final identifier (identifierHash or contentHash)
    this.documentModified = false; // Track if document has been edited

    // Track if this is a blank document created from template
    this.isBlankDoc = params?.isNewFile || false;

    // Parse the initial XML, if provided
    if (this.docx.length || this.xml) this.parseFromXml();
  }

  /**
   * Get the DocxHelpers object that contains utility functions for working with docx files.
   * @returns {import('./docx-helpers/docx-helpers.js').DocxHelpers} The DocxHelpers object.
   */
  get docxHelpers() {
    return DocxHelpers;
  }

  parseFromXml() {
    this.docx?.forEach((file) => {
      this.convertedXml[file.name] = preservePeopleWhitespace(file.content, this.parseXmlToJson(file.content));

      if (file.name === 'word/document.xml') {
        this.documentAttributes = this.convertedXml[file.name].elements[0]?.attributes;
      }

      if (file.name === 'word/styles.xml') {
        this.convertedXml[file.name] = addDefaultStylesIfMissing(this.convertedXml[file.name]);
      }
    });
    if (!this.convertedXml['word/styles.xml']) {
      for (let i = 1; i <= 5; i += 1) {
        if (this.convertedXml[`word/styles${i}.xml`] != null) {
          this.convertedXml['word/styles.xml'] = addDefaultStylesIfMissing(this.convertedXml[`word/styles${i}.xml`]);
          break;
        }
      }
    }
    this.commentAuthorAssignments = new Map();
    this.commentAuthorSource = captureCommentAuthorSource(this.convertedXml);
    this.initialJSON = this.convertedXml['word/document.xml'];

    if (!this.initialJSON) this.initialJSON = this.parseXmlToJson(this.xml);
    this.declaration = this.initialJSON?.declaration;

    // Only resolve existing GUIDs synchronously (no hash generation yet)
    this.resolveDocumentGuid();
  }

  /**
   * Parses XML content into JSON format while preserving whitespace-only text runs.
   *
   * This method wraps xml-js's xml2json parser with additional preprocessing to prevent
   * the parser from dropping whitespace-only content in <w:t> and <w:delText> elements.
   * This is critical for correctly handling documents that rely on document-level
   * xml:space="preserve" rather than per-element attributes, which is common in
   * PDF-to-DOCX converted documents.
   *
   * The whitespace preservation strategy:
   * 1. Before parsing, wraps whitespace-only content with [[sdspace]] placeholders
   * 2. xml-js parser preserves the placeholder-wrapped text
   * 3. During text node processing (t-translator.js), placeholders are removed
   *
   * @param {string} xml - The XML string to parse
   * @returns {Object} The parsed JSON representation of the XML document
   *
   * @example
   * // Handles whitespace-only text runs
   * const xml = '<w:t> </w:t>';
   * const result = parseXmlToJson(xml);
   * // Result preserves the space: { elements: [{ text: '[[sdspace]] [[sdspace]]' }] }
   *
   * @example
   * // Handles elements with attributes
   * const xml = '<w:t xml:space="preserve">  text  </w:t>';
   * const result = parseXmlToJson(xml);
   * // Preserves content and attributes
   *
   * @example
   * // Handles both w:t and w:delText elements
   * const xml = '<w:delText> </w:delText>';
   * const result = parseXmlToJson(xml);
   * // Preserves whitespace in deleted text
   */
  parseXmlToJson(xml) {
    // Preserve whitespace-only text runs so xml-js doesn't drop them during parsing.
    // This handles both <w:t> and <w:delText> elements, with or without attributes.
    // Documents may rely on document-level xml:space="preserve" rather than per-element attributes.
    const newXml = xml.replace(
      /(<w:(?:t|delText)(?:\s[^>]*)?>)(\s+)(<\/w:(?:t|delText)>)/g,
      '$1[[sdspace]]$2[[sdspace]]$3',
    );
    return JSON.parse(xmljs.xml2json(newXml, null, 2));
  }

  /**
   * Checks if an element name matches the expected local name, with or without namespace prefix.
   * This helper supports custom namespace prefixes in DOCX files (e.g., 'op:Properties', 'custom:property').
   *
   * @private
   * @static
   * @param {string|undefined|null} elementName - The element name to check (may include namespace prefix)
   * @param {string} expectedLocalName - The expected local name without prefix
   * @returns {boolean} True if the element name matches (with or without prefix)
   *
   * @example
   * // Exact match without prefix
   * _matchesElementName('Properties', 'Properties') // => true
   *
   * @example
   * // Match with namespace prefix
   * _matchesElementName('op:Properties', 'Properties') // => true
   * _matchesElementName('custom:property', 'property') // => true
   *
   * @example
   * // No match
   * _matchesElementName('SomeOtherElement', 'Properties') // => false
   * _matchesElementName(':Properties', 'Properties') // => false (empty prefix)
   */
  static _matchesElementName(elementName, expectedLocalName) {
    if (!elementName || typeof elementName !== 'string') return false;
    if (!expectedLocalName) return false;

    // Exact match without prefix
    if (elementName === expectedLocalName) return true;

    // Check if it ends with :expectedLocalName and has a non-empty prefix
    if (elementName.endsWith(`:${expectedLocalName}`)) {
      const prefix = elementName.slice(0, -(expectedLocalName.length + 1));
      return prefix.length > 0;
    }

    return false;
  }

  /**
   * Extracts the namespace prefix from an element name.
   *
   * @private
   * @static
   * @param {string} elementName - The element name (may include namespace prefix, e.g., 'op:Properties')
   * @returns {string} The namespace prefix (e.g., 'op') or empty string if no prefix
   *
   * @example
   * _extractNamespacePrefix('op:Properties') // => 'op'
   * _extractNamespacePrefix('Properties') // => ''
   * _extractNamespacePrefix('custom:property') // => 'custom'
   */
  static _extractNamespacePrefix(elementName) {
    if (!elementName || typeof elementName !== 'string') return '';
    const colonIndex = elementName.indexOf(':');
    return colonIndex > 0 ? elementName.slice(0, colonIndex) : '';
  }

  /**
   * Generic method to get a stored custom property from docx.
   * Supports both standard and custom namespace prefixes (e.g., 'op:Properties', 'custom:property').
   *
   * @static
   * @param {Array} docx - Array of docx file objects
   * @param {string} propertyName - Name of the property to retrieve
   * @returns {string|null} The property value or null if not found
   *
   * Returns null in the following cases:
   * - docx array is empty or doesn't contain 'docProps/custom.xml'
   * - custom.xml cannot be parsed
   * - Properties element is not found (with or without namespace prefix)
   * - Property with the specified name is not found
   * - Property has malformed structure (missing nested elements or text)
   * - Any error occurs during parsing or retrieval
   *
   * @example
   * // Standard property without namespace prefix
   * const version = SuperConverter.getStoredCustomProperty(docx, 'SuperdocVersion');
   * // => '1.2.3'
   *
   * @example
   * // Property with namespace prefix (e.g., from Office 365)
   * const guid = SuperConverter.getStoredCustomProperty(docx, 'DocumentGuid');
   * // Works with both 'Properties' and 'op:Properties' elements
   * // => 'abc-123-def-456'
   *
   * @example
   * // Non-existent property
   * const missing = SuperConverter.getStoredCustomProperty(docx, 'NonExistent');
   * // => null
   */
  static getStoredCustomProperty(docx, propertyName) {
    try {
      const customXml = docx.find((doc) => doc.name === 'docProps/custom.xml');
      if (!customXml) return null;

      const converter = new SuperConverter();
      const content = customXml.content;
      const contentJson = converter.parseXmlToJson(content);

      // Handle namespace prefixes (e.g., 'op:Properties' or 'Properties')
      const properties = contentJson?.elements?.find((el) => SuperConverter._matchesElementName(el.name, 'Properties'));
      if (!properties?.elements) return null;

      // Handle namespace prefixes for property element (e.g., 'op:property' or 'property')
      const property = properties.elements.find(
        (el) => SuperConverter._matchesElementName(el.name, 'property') && el.attributes?.name === propertyName,
      );
      if (!property) return null;

      // Add null safety for nested property structure
      if (!property.elements?.[0]?.elements?.[0]?.text) {
        console.warn(`Malformed property structure for "${propertyName}"`);
        return null;
      }

      return property.elements[0].elements[0].text;
    } catch (e) {
      console.warn(`Error getting custom property ${propertyName}:`, e);
      return null;
    }
  }

  /**
   * Generic method to set a stored custom property in docx.
   * Supports both standard and custom namespace prefixes (e.g., 'op:Properties', 'custom:property').
   *
   * @static
   * @param {Object} docx - The docx object to store the property in (converted XML structure)
   * @param {string} propertyName - Name of the property
   * @param {string|Function} value - Value or function that returns the value
   * @param {boolean} preserveExisting - If true, won't overwrite existing values
   * @returns {string|null} The stored value, or null if Properties element is not found
   *
   * @throws {Error} If an error occurs during property setting (logged as warning)
   *
   * @example
   * // Set a new property
   * const value = SuperConverter.setStoredCustomProperty(docx, 'MyProperty', 'MyValue');
   * // => 'MyValue'
   *
   * @example
   * // Set a property with a function
   * const guid = SuperConverter.setStoredCustomProperty(docx, 'DocumentGuid', () => uuidv4());
   * // => 'abc-123-def-456'
   *
   * @example
   * // Preserve existing value
   * SuperConverter.setStoredCustomProperty(docx, 'MyProperty', 'NewValue', true);
   * // => 'MyValue' (original value preserved)
   *
   * @example
   * // Works with namespace prefixes
   * // If docx has 'op:Properties' and 'op:property' elements, this will handle them correctly
   * const version = SuperConverter.setStoredCustomProperty(docx, 'Version', '2.0.0');
   * // => '2.0.0'
   */
  static setStoredCustomProperty(docx, propertyName, value, preserveExisting = false) {
    try {
      const customLocation = 'docProps/custom.xml';
      if (!docx[customLocation]) docx[customLocation] = generateCustomXml();

      const customXml = docx[customLocation];

      // Handle namespace prefixes (e.g., 'op:Properties' or 'Properties')
      const properties = customXml.elements?.find((el) => SuperConverter._matchesElementName(el.name, 'Properties'));
      if (!properties) return null;
      if (!properties.elements) properties.elements = [];

      // Extract namespace prefix from Properties element to use for new property elements
      const namespacePrefix = SuperConverter._extractNamespacePrefix(properties.name);
      const propertyElementName = namespacePrefix ? `${namespacePrefix}:property` : 'property';

      // Check if property already exists (handle namespace prefixes)
      let property = properties.elements.find(
        (el) => SuperConverter._matchesElementName(el.name, 'property') && el.attributes?.name === propertyName,
      );

      if (property && preserveExisting) {
        // Add null safety when returning existing value
        if (!property.elements?.[0]?.elements?.[0]?.text) {
          console.warn(`Malformed existing property structure for "${propertyName}"`);
          return null;
        }
        return property.elements[0].elements[0].text;
      }

      // Generate value if it's a function
      const finalValue = typeof value === 'function' ? value() : value;

      if (!property) {
        // Get next available pid
        const existingPids = properties.elements
          .filter((el) => el.attributes?.pid)
          .map((el) => parseInt(el.attributes.pid, 10)) // Add radix for clarity
          .filter(Number.isInteger); // Use isInteger instead of isFinite since PIDs should be integers
        const pid = existingPids.length > 0 ? Math.max(...existingPids) + 1 : 2;

        property = {
          type: 'element',
          name: propertyElementName,
          attributes: {
            name: propertyName,
            fmtid: '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}',
            pid,
          },
          elements: [
            {
              type: 'element',
              name: 'vt:lpwstr',
              elements: [
                {
                  type: 'text',
                  text: finalValue,
                },
              ],
            },
          ],
        };

        properties.elements.push(property);
      } else {
        // Normalize namespace prefix to match parent Properties element for consistency
        const existingPropertyPrefix = SuperConverter._extractNamespacePrefix(property.name);
        if (existingPropertyPrefix !== namespacePrefix) {
          property.name = propertyElementName;
        }

        // Add null safety when updating existing property
        if (!property.elements?.[0]?.elements?.[0]) {
          console.warn(`Malformed property structure for "${propertyName}", recreating structure`);
          property.elements = [
            {
              type: 'element',
              name: 'vt:lpwstr',
              elements: [
                {
                  type: 'text',
                  text: finalValue,
                },
              ],
            },
          ];
        } else {
          property.elements[0].elements[0].text = finalValue;
        }
      }

      return finalValue;
    } catch (e) {
      console.warn(`Error setting custom property ${propertyName}:`, e);
      return null;
    }
  }

  static getStoredSuperdocVersion(docx) {
    return SuperConverter.getStoredCustomProperty(docx, 'SuperdocVersion');
  }

  static setStoredSuperdocVersion(docx = this.convertedXml, version = CURRENT_APP_VERSION) {
    return SuperConverter.setStoredCustomProperty(docx, 'SuperdocVersion', version, false);
  }

  /**
   * Generate a Word-compatible timestamp (truncated to minute precision like MS Word)
   * @returns {string} Timestamp in YYYY-MM-DDTHH:MM:00Z format
   */
  static generateWordTimestamp() {
    const date = new Date();
    date.setSeconds(0, 0);
    return date.toISOString().split('.')[0] + 'Z';
  }

  /**
   * Get the dcterms:created timestamp from the already-parsed core.xml
   * @returns {string|null} The created timestamp in ISO format, or null if not found
   */
  getDocumentCreatedTimestamp() {
    const coreXml = this.convertedXml['docProps/core.xml'];
    if (!coreXml) return null;

    const coreProps = coreXml.elements?.find(
      (el) => el.name === 'cp:coreProperties' || SuperConverter._matchesElementName(el.name, 'coreProperties'),
    );
    if (!coreProps?.elements) return null;

    const createdElement = coreProps.elements.find(
      (el) => el.name === 'dcterms:created' || SuperConverter._matchesElementName(el.name, 'created'),
    );

    return createdElement?.elements?.[0]?.text || null;
  }

  /**
   * Set the dcterms:created timestamp in the already-parsed core.xml
   * @param {string} timestamp - The timestamp to set (ISO format)
   */
  setDocumentCreatedTimestamp(timestamp) {
    const coreXml = this.convertedXml['docProps/core.xml'];
    if (!coreXml) return;

    const coreProps = coreXml.elements?.find(
      (el) => el.name === 'cp:coreProperties' || SuperConverter._matchesElementName(el.name, 'coreProperties'),
    );
    if (!coreProps) return;

    // Initialize elements array if missing
    if (!coreProps.elements) {
      coreProps.elements = [];
    }

    let createdElement = coreProps.elements.find(
      (el) => el.name === 'dcterms:created' || SuperConverter._matchesElementName(el.name, 'created'),
    );

    if (createdElement?.elements?.[0]) {
      createdElement.elements[0].text = timestamp;
    } else {
      // Create the element if it doesn't exist
      createdElement = {
        type: 'element',
        name: 'dcterms:created',
        attributes: { 'xsi:type': 'dcterms:W3CDTF' },
        elements: [{ type: 'text', text: timestamp }],
      };
      coreProps.elements.push(createdElement);
    }
  }

  /**
   * Get document GUID from docx files (static method)
   * @static
   * @param {Array} docx - Array of docx file objects
   * @returns {string|null} The document GUID
   */
  static extractDocumentGuid(docx) {
    try {
      const settingsXml = docx.find((doc) => doc.name === 'word/settings.xml');
      if (!settingsXml) return null;

      // Parse XML properly instead of regex
      const converter = new SuperConverter();
      const settingsJson = converter.parseXmlToJson(settingsXml.content);

      // Navigate the parsed structure to find w15:docId
      const settings = settingsJson.elements?.[0];
      if (!settings) return null;

      const docIdElement = settings.elements?.find((el) => el.name === 'w15:docId');
      if (docIdElement?.attributes?.['w15:val']) {
        return docIdElement.attributes['w15:val'].replace(/[{}]/g, '');
      }
    } catch {
      // Continue to check custom property
    }

    // Then check custom property
    return SuperConverter.getStoredCustomProperty(docx, 'DocumentGuid');
  }

  /**
   * Get the permanent document GUID
   * @returns {string|null} The document GUID (only for modified documents)
   */
  getDocumentGuid() {
    return this.documentGuid;
  }

  /**
   * Get the SuperDoc version for this converter instance
   * @returns {string|null} The SuperDoc version or null if not available
   */
  getSuperdocVersion() {
    if (this.docx) {
      return SuperConverter.getStoredSuperdocVersion(this.docx);
    }
    return null;
  }

  /**
   * Resolve existing document GUID (synchronous)
   * For new files: reads existing GUID and sets fresh timestamp
   * For imported files: reads existing GUIDs only
   */
  resolveDocumentGuid() {
    // 1. Check Microsoft's docId (READ ONLY)
    const microsoftGuid = this.getMicrosoftDocId();
    if (microsoftGuid) {
      this.documentGuid = microsoftGuid;
    } else {
      // 2. Check our custom property
      const customGuid = SuperConverter.getStoredCustomProperty(this.docx, 'DocumentGuid');
      if (customGuid) {
        this.documentGuid = customGuid;
      }
    }

    // BLANK DOC: set fresh timestamp (ensures unique identifier for each new doc from template)
    if (this.isBlankDoc) {
      this.setDocumentCreatedTimestamp(SuperConverter.generateWordTimestamp());
    }
  }

  /**
   * Get Microsoft's docId from settings.xml (READ ONLY)
   */
  getMicrosoftDocId() {
    this.getDocumentInternalId(); // Existing method
    if (this.documentInternalId) {
      return this.documentInternalId.replace(/[{}]/g, '');
    }
    return null;
  }

  /**
   * Generate identifier hash from documentGuid and dcterms:created
   * Uses CRC32 of the combined string for a compact identifier
   * Only call when both documentGuid and timestamp exist
   * @returns {string} Hash identifier in format "HASH-XXXXXXXX"
   */
  #generateIdentifierHash() {
    const combined = `${this.documentGuid}|${this.getDocumentCreatedTimestamp()}`;
    const data = new TextEncoder().encode(combined);
    return `HASH-${computeCrc32Hex(data).toUpperCase()}`;
  }

  /**
   * Generate content hash from file bytes
   * Uses CRC32 of the raw file content for a stable identifier
   * @returns {Promise<string>} Hash identifier in format "HASH-XXXXXXXX"
   */
  async #generateContentHash() {
    if (!this.fileSource) {
      // No file source available, generate a random hash (last resort)
      return `HASH-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;
    }

    try {
      let data;

      if (ArrayBuffer.isView(this.fileSource)) {
        const view = this.fileSource;
        data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      } else if (this.fileSource instanceof ArrayBuffer) {
        data = new Uint8Array(this.fileSource);
      } else if (this.fileSource instanceof Blob || this.fileSource instanceof File) {
        const arrayBuffer = await this.fileSource.arrayBuffer();
        data = new Uint8Array(arrayBuffer);
      } else {
        return `HASH-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;
      }

      return `HASH-${computeCrc32Hex(data).toUpperCase()}`;
    } catch (e) {
      console.warn('[super-converter] Could not generate content hash:', e);
      return `HASH-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;
    }
  }

  /**
   * Get document unique identifier (async)
   *
   * For blank documents (isBlankDoc: true):
   * - GUID and timestamp already set in resolveDocumentGuid()
   * - Returns identifierHash(guid|timestamp)
   *
   * For imported files (isBlankDoc: false):
   * - If both documentGuid and dcterms:created exist: returns identifierHash
   * - Otherwise: returns contentHash and generates missing metadata for future exports
   *
   * @returns {Promise<string>} Document unique identifier
   */
  async getDocumentIdentifier() {
    // Return cached identifier if already computed
    if (this.documentUniqueIdentifier) {
      return this.documentUniqueIdentifier;
    }

    // Check what metadata we have (for new files, both are set in resolveDocumentGuid)
    const hasGuid = Boolean(this.documentGuid);
    const hasTimestamp = Boolean(this.getDocumentCreatedTimestamp());

    if (hasGuid && hasTimestamp) {
      // Both exist: use identifierHash
      this.documentUniqueIdentifier = this.#generateIdentifierHash();
    } else {
      // Missing one or both: use contentHash for stability (same file = same hash)
      // But generate missing metadata so re-exported file will have complete metadata
      if (!hasGuid) {
        this.documentGuid = uuidv4();
      }
      if (!hasTimestamp) {
        this.setDocumentCreatedTimestamp(SuperConverter.generateWordTimestamp());
      }
      this.documentModified = true; // Ensures metadata is saved on export
      this.documentUniqueIdentifier = await this.#generateContentHash();
    }

    return this.documentUniqueIdentifier;
  }

  /**
   * Promote to GUID on first edit (for documents that didn't have one)
   */
  promoteToGuid() {
    if (this.documentGuid) return this.documentGuid;

    this.documentGuid = this.getMicrosoftDocId() || uuidv4();
    this.documentModified = true;
    this.documentUniqueIdentifier = null; // Clear cached identifier

    // Note: GUID is stored to custom properties during export to avoid
    // unnecessary XML modifications if the document is never saved
    return this.documentGuid;
  }

  getDocumentDefaultStyles() {
    const styles = this.convertedXml['word/styles.xml'];
    const styleRoot = styles?.elements?.[0];
    const styleElements = styleRoot?.elements || [];
    if (!styleElements.length) return {};

    const defaults = styleElements.find((el) => el.name === 'w:docDefaults');
    const normalStyle = styleElements.find((el) => el.name === 'w:style' && el.attributes?.['w:styleId'] === 'Normal');

    const defaultsState = {
      typeface: undefined,
      panose: undefined,
      fontSizePt: undefined,
      kern: undefined,
      fallbackSzTwips: undefined,
    };

    const docDefaultRun = defaults?.elements?.find((el) => el.name === 'w:rPrDefault');
    const docDefaultProps = docDefaultRun?.elements?.find((el) => el.name === 'w:rPr') ?? docDefaultRun;
    collectRunDefaultProperties(docDefaultProps, {
      allowOverrideTypeface: true,
      allowOverrideSize: true,
      themeResolver: (theme) => this.getThemeInfo(theme),
      state: defaultsState,
    });

    const normalRunProps = normalStyle?.elements?.find((el) => el.name === 'w:rPr') ?? null;
    collectRunDefaultProperties(normalRunProps, {
      allowOverrideTypeface: true,
      allowOverrideSize: true,
      themeResolver: (theme) => this.getThemeInfo(theme),
      state: defaultsState,
    });

    if (defaultsState.fontSizePt === undefined) {
      if (Number.isFinite(defaultsState.fallbackSzTwips)) defaultsState.fontSizePt = defaultsState.fallbackSzTwips / 2;
      else defaultsState.fontSizePt = DEFAULT_FONT_SIZE_PT;
    }

    const fontFamilyCss = defaultsState.typeface
      ? SuperConverter.toCssFontFamily(defaultsState.typeface, this.convertedXml)
      : undefined;

    const result = {};
    if (defaultsState.fontSizePt !== undefined) result.fontSizePt = defaultsState.fontSizePt;
    if (defaultsState.kern !== undefined) result.kern = defaultsState.kern;
    if (defaultsState.typeface) result.typeface = defaultsState.typeface;
    if (defaultsState.panose) result.panose = defaultsState.panose;
    if (fontFamilyCss) result.fontFamilyCss = fontFamilyCss;

    return result;
  }

  getDocumentFonts() {
    const inlineDocumentFonts = [...new Set(this.inlineDocumentFonts || [])];
    const defaults = this.getDocumentDefaultStyles?.() || {};
    const defaultTypeface = typeof defaults.typeface === 'string' ? defaults.typeface : null;
    const defaultFontFamilyCss = typeof defaults.fontFamilyCss === 'string' ? defaults.fontFamilyCss : null;
    const fallbackFont =
      defaultTypeface ||
      (defaultFontFamilyCss ? defaultFontFamilyCss.split(',')[0]?.replace(/["']/g, '').trim() : null);
    const withDefaultFont = (fonts) => {
      const result = [...fonts];
      if (fallbackFont && !result.includes(fallbackFont)) result.push(fallbackFont);
      return result;
    };
    const fontTable = this.convertedXml['word/fontTable.xml'];
    if (!fontTable) {
      return withDefaultFont(inlineDocumentFonts);
    }

    const wFonts = fontTable.elements?.find((element) => element.name === 'w:fonts');
    if (!wFonts) {
      return withDefaultFont(inlineDocumentFonts);
    }

    if (!wFonts.elements) {
      return withDefaultFont(inlineDocumentFonts);
    }

    const fontsInFontTable = wFonts.elements
      .filter((element) => element.name === 'w:font')
      .map((element) => element.attributes['w:name']);

    const allFonts = [...inlineDocumentFonts, ...fontsInFontTable];
    return withDefaultFont([...new Set(allFonts)]);
  }

  getFontFaceImportString() {
    const fontTable = this.convertedXml['word/fontTable.xml'];
    if (!fontTable || !Object.keys(this.fonts).length) return;

    const fonts = fontTable.elements.find((el) => el.name === 'w:fonts');
    const embededFonts = fonts?.elements.filter((el) =>
      el.elements?.some((nested) => nested?.attributes && nested.attributes['r:id'] && nested.attributes['w:fontKey']),
    );
    const fontsToInclude = embededFonts?.reduce((acc, cur) => {
      const embedElements = cur.elements
        .filter((el) => el.name.startsWith('w:embed'))
        ?.map((el) => ({ ...el, fontFamily: cur.attributes['w:name'] }));
      return [...acc, ...embedElements];
    }, []);

    const rels = this.convertedXml['word/_rels/fontTable.xml.rels'];
    const relationships = rels?.elements.find((el) => el.name === 'Relationships') || {};
    const { elements } = relationships;

    const fontsImported = [];
    let styleString = '';
    for (const font of fontsToInclude) {
      const filePath = elements.find((el) => el.attributes.Id === font.attributes['r:id'])?.attributes?.Target;
      // Skip a font with a missing relationship/binary/deobfuscation rather than aborting the whole
      // method (one malformed embedded font must not drop every other font's @font-face). Matches the
      // registry path (getEmbeddedFontFaces), which already `continue`s past the same cases.
      if (!filePath) continue;

      const fontUint8Array = this.fonts[`word/${filePath}`];
      if (!fontUint8Array?.buffer) continue;
      // Copy the EXACT view bytes into a fresh buffer BEFORE deobfuscating. deobfuscateFont XORs its
      // input IN PLACE; passing `this.fonts[...].buffer` would mutate the shared embedded-font bytes,
      // so the later registry extraction (getEmbeddedFontFaces) would double-XOR and corrupt the face.
      // The byteOffset/byteLength slice also avoids XORing the wrong bytes when the Uint8Array is a
      // view into a larger pooled buffer. getEmbeddedFontFaces already copies the same way.
      const fontBuffer = fontUint8Array.buffer.slice(
        fontUint8Array.byteOffset,
        fontUint8Array.byteOffset + fontUint8Array.byteLength,
      );

      const ttfBuffer = deobfuscateFont(fontBuffer, font.attributes['w:fontKey']);
      if (!ttfBuffer) continue;

      // Honor the embedding policy here too. The registry path (getEmbeddedFontFaces) skips a face whose
      // OS/2 fsType forbids embedding (or is unreadable), but this legacy @font-face injection would
      // otherwise still emit the restricted bytes under the logical family. Reuse the SAME rule
      // (parseEmbeddingPolicy; a null/unreadable policy is conservatively not embeddable) so the policy
      // gate has one source of truth; skip just this face rather than aborting the rest.
      const policy = parseEmbeddingPolicy(ttfBuffer);
      if (!(policy ? policy.embeddable : false)) continue;

      // Convert to a blob and inject @font-face
      const blob = new Blob([ttfBuffer], { type: 'font/ttf' });
      const fontUrl = URL.createObjectURL(blob);
      const isNormal = font.name.includes('Regular');
      const isBold = font.name.includes('Bold');
      const isItalic = font.name.includes('Italic');
      const isLight = font.name.includes('Light');
      const fontWeight = isNormal ? 'normal' : isBold ? 'bold' : isLight ? '200' : 'normal';

      if (!fontsImported.includes(font.fontFamily)) {
        fontsImported.push(font.fontFamily);
      }

      styleString += `
        @font-face {
          font-style: ${isItalic ? 'italic' : 'normal'};
          font-weight: ${fontWeight};
          font-display: swap;
          font-family: ${font.fontFamily};
          src: url(${fontUrl}) format('truetype');
        }
      `;
    }

    return {
      styleString,
      fontsImported,
    };
  }

  /**
   * Extract the document's embedded fonts as structured, deobfuscated faces for first-class registry
   * registration (the architecturally correct replacement for the legacy `@font-face` CSS injection in
   * {@link getFontFaceImportString}). The converter only extracts + deobfuscates + classifies; it does
   * NOT create object URLs, inject `<style>`, or decide what to register. Each face carries the
   * deobfuscated bytes, its OS/2-derived weight/style + raw `fsType` licensing, and the `fontTable`
   * relationship id. The document font controller decides which to register, skipping faces that are
   * not embeddable (Restricted-License) or whose OS/2 table was unreadable (conservative: no license
   * proof -> fall through to the bundled substitute).
   *
   * @returns {Array<{ family: string, source: ArrayBuffer, weight: '400'|'700', style: 'normal'|'italic', fsType: number|null, embeddable: boolean, relationshipId: string }>}
   */
  getEmbeddedFontFaces() {
    const fontTable = this.convertedXml['word/fontTable.xml'];
    if (!fontTable || !Object.keys(this.fonts).length) return [];

    const wFonts = fontTable.elements?.find((el) => el.name === 'w:fonts');
    const embeddedEntries =
      wFonts?.elements?.filter((el) =>
        el.elements?.some((nested) => nested?.attributes?.['r:id'] && nested?.attributes?.['w:fontKey']),
      ) ?? [];
    const embedElements = embeddedEntries.flatMap((entry) =>
      (entry.elements ?? [])
        .filter((el) => el.name?.startsWith('w:embed'))
        .map((el) => ({ embed: el, family: entry.attributes?.['w:name'] })),
    );

    const rels = this.convertedXml['word/_rels/fontTable.xml.rels'];
    const relElements = rels?.elements?.find((el) => el.name === 'Relationships')?.elements ?? [];

    // Weight/style fallback from the w:embed* element name (w:embedRegular/Bold/Italic/BoldItalic),
    // used only when the OS/2 table is unreadable.
    const faceFromEmbedName = (name = '') => ({
      weight: /bold/i.test(name) ? '700' : '400',
      style: /italic/i.test(name) ? 'italic' : 'normal',
    });

    const faces = [];
    for (const { embed, family } of embedElements) {
      const relationshipId = embed.attributes?.['r:id'];
      const fontKey = embed.attributes?.['w:fontKey'];
      // Skip a malformed embed rather than aborting the whole extraction (one bad font must not drop
      // every other embedded face).
      if (!family || !relationshipId || !fontKey) continue;
      const filePath = relElements.find((el) => el.attributes?.Id === relationshipId)?.attributes?.Target;
      if (!filePath) continue;
      const fontUint8Array = this.fonts[`word/${filePath}`];
      if (!fontUint8Array?.buffer) continue;
      // Slice the EXACT view bytes into a fresh buffer. fontUint8Array may be a view into a larger
      // (pooled) buffer, and deobfuscateFont XORs its input IN PLACE and returns the whole buffer -
      // so passing `.buffer` would deobfuscate the wrong bytes and corrupt the shared `this.fonts`
      // data. The fresh copy is also the independent buffer the registry will own.
      const sourceBytes = fontUint8Array.buffer.slice(
        fontUint8Array.byteOffset,
        fontUint8Array.byteOffset + fontUint8Array.byteLength,
      );
      const ttf = deobfuscateFont(sourceBytes, fontKey);
      if (!ttf) continue;

      const policy = parseEmbeddingPolicy(ttf);
      const fallback = faceFromEmbedName(embed.name);
      faces.push({
        family,
        source: ttf,
        weight: policy?.face.weight ?? fallback.weight,
        style: policy?.face.style ?? fallback.style,
        fsType: policy?.fsType ?? null,
        // Conservative: an unreadable OS/2 table (null policy) is NOT embeddable - we cannot prove the
        // license permits embedding, so the controller skips it and the bundled substitute renders.
        embeddable: policy ? policy.embeddable : false,
        relationshipId,
      });
    }
    return faces;
  }

  getDocumentInternalId() {
    const settingsLocation = 'word/settings.xml';
    if (!this.convertedXml[settingsLocation]) {
      // Don't create settings if it doesn't exist during read
      return;
    }

    const settings = this.convertedXml[settingsLocation];
    if (!settings.elements?.[0]?.elements?.length) {
      return;
    }

    // Look for existing w15:docId only
    const w15DocId = settings.elements[0].elements.find((el) => el.name === 'w15:docId');
    this.documentInternalId = w15DocId?.attributes?.['w15:val'];
  }

  createDocumentIdElement() {
    // This should only be called when WRITING, never when reading
    const docId = uuidv4().toUpperCase();
    this.documentInternalId = docId;

    return {
      type: 'element',
      name: 'w15:docId',
      attributes: {
        'w15:val': `{${docId}}`,
      },
    };
  }

  getThemeInfo(themeName) {
    themeName = themeName.toLowerCase();
    const theme1 = this.convertedXml['word/theme/theme1.xml'];
    if (!theme1) return {};
    const themeData = theme1.elements.find((el) => el.name === 'a:theme');
    const themeElements = themeData.elements.find((el) => el.name === 'a:themeElements');
    const fontScheme = themeElements.elements.find((el) => el.name === 'a:fontScheme');
    let fonts;

    if (themeName.startsWith('major')) {
      fonts = fontScheme.elements.find((el) => el.name === 'a:majorFont').elements[0];
    } else if (themeName.startsWith('minor')) {
      fonts = fontScheme.elements.find((el) => el.name === 'a:minorFont').elements[0];
    }

    const { typeface, panose } = fonts.attributes;
    return { typeface, panose };
  }

  getSchema(editor) {
    let result;
    try {
      this.getDocumentInternalId();
      if (!this.convertedXml.media) {
        this.convertedXml.media = this.media;
      }
      result = createDocumentJson(this.convertedXml, this, editor);
    } catch (error) {
      editor?.emit('exception', { error, editor });
    }

    if (result) {
      this.savedTagsToRestore.push({ ...result.savedTagsToRestore });
      this.pageStyles = result.pageStyles;
      this.numbering = result.numbering;
      this.comments = result.comments;
      this.footnotes = result.footnotes;
      this.endnotes = result.endnotes ?? [];
      this.linkedStyles = result.linkedStyles;
      this.translatedLinkedStyles = result.translatedLinkedStyles;
      this.translatedNumbering = result.translatedNumbering;
      this.inlineDocumentFonts = result.inlineDocumentFonts;
      this.themeColors = result.themeColors ?? null;
      this.importDiagnostics = result.importDiagnostics ?? [];
      this.bibliographyPart = loadBibliographyPartFromPackage(this.convertedXml);

      return result.pmDoc;
    } else {
      return null;
    }
  }

  schemaToXml(data, debug = false) {
    const exporter = new DocxExporter(this);
    return exporter.schemaToXml(data, debug);
  }

  /** Recover only an evidenced initial room source projection from the old derived cache. */
  #initializeLegacyCommentAuthorSource(editor, comments) {
    const ydoc = editor?.options?.ydoc;
    const meta = ydoc?.getMap(META_MAP_KEY);
    const capability = meta?.get(META_PARTS_CAPABILITY_KEY);
    const envelope = ydoc && decodeYjsToEnvelope(ydoc.getMap(PARTS_MAP_KEY).get('word/comments.xml'));
    const rows = readCommentAuthorSourceRows(envelope?.data);
    const checkpoint = readCommentAuthorSourceRows(this.commentAuthorSourcePart);
    const legacy = this.commentAuthorSource;
    if (
      !editor?._partPublisher ||
      meta?.get(META_PARTS_SCHEMA_VERSION_KEY) !== 1 ||
      capability?.version !== 1 ||
      meta?.get(META_PARTS_FALLBACK_MODE_KEY) ||
      !Number.isFinite(Date.parse(meta?.get(META_PARTS_LAST_HYDRATED_AT_KEY))) ||
      envelope?.v !== 1 ||
      envelope.clientId !== capability.clientId ||
      !rows ||
      !checkpoint ||
      !legacy?.comments ||
      [...rows].some(([id, name]) => legacy.comments.get(id)?.name !== name || checkpoint.get(id) !== name) ||
      hasLocalCommentAuthorSourceConflict(rows, comments, this.commentAuthorAssignments)
    ) {
      throw new Error('Cannot establish comment source ownership from this legacy room state.');
    }
    // The room proves ID/name origin only. Current converted people remains the export authority.
    // The convenience comments list can include local rows; only proved source IDs may corroborate snapshots.
    const imported = (this.comments || []).filter((comment) => rows.has(String(comment.commentId)));
    const source = captureCommentAuthorSource({ 'word/comments.xml': envelope.data }, imported);
    for (const [id, record] of source.comments) {
      const captured = imported.find((comment) => String(comment.commentId) === id);
      if (captured?.creatorIdentity) {
        source.comments.set(id, { ...record, identity: { ...captured.creatorIdentity } });
      }
    }
    return source;
  }

  /** Export-only people overlay; never synchronized back into the live parts store. */
  getCommentPeopleUpdatedFiles() {
    return commentPeopleUpdatedFiles(this.convertedXml, this.commentPeopleExport, this.docx);
  }

  async exportToDocx(
    jsonData,
    editorSchema,
    documentMedia,
    isFinalDoc = false,
    commentsExportType,
    comments = [],
    editor,
    exportJsonOnly = false,
    fieldsHighlightColor,
    preserveSdtWrappers = false,
  ) {
    // Reset export warnings for this export cycle
    this.exportWarnings = [];
    this.commentPeopleExport = undefined;

    // Filter out SYNTHETIC tracked-change projection rows - they shouldn't be
    // exported to comments.xml. `comments.list()` returns one such row per
    // tracked change (so the sidebar can show revisions next to comments); its
    // identity IS the tracked change (commentId/id === trackedChangeLink.
    // trackedChangeId) and it carries only the change excerpt as `text`, no real
    // comment body. Those must never become a <w:comment>. A GENUINE user comment
    // ANCHORED ON a tracked change also carries trackedChange:true + a
    // trackedChangeLink, but keeps its OWN distinct id, so the identity check
    // spares it. (`!c.trackedChange` alone silently dropped real
    // comments-on-revisions — comment-on-insertion/deletion.)
    const isSyntheticTrackedChangeRow = (c) => {
      const linkId = c.trackedChangeLink?.trackedChangeId;
      if (!c.trackedChange || !linkId) return false;
      const identity = c.commentId ?? c.id;
      return identity != null && String(identity) === String(linkId);
    };
    // A tracked-change row with no body at all is also synthetic noise; keep the
    // body check so bodiless rows drop even if they somehow lack a link.
    const hasCommentBody = (c) =>
      Boolean(
        (typeof c.commentText === 'string' && c.commentText.length > 0) ||
          c.commentJSON ||
          (Array.isArray(c.elements) && c.elements.length) ||
          (typeof c.text === 'string' && c.text.length > 0),
      );
    const byId = new Map();
    comments.forEach((comment) => {
      [comment.commentId, comment.importedId].filter((id) => id != null).forEach((id) => byId.set(String(id), comment));
    });
    const isExcluded = (comment) => {
      if (commentsExportType === 'clean') return true;
      if (commentsExportType !== 'external') return false;
      const seen = new Set();
      let current = comment;
      while (current && !seen.has(current)) {
        if (current.isInternal) return true;
        seen.add(current);
        current = byId.get(String(current.threadingParentCommentId ?? current.parentCommentId));
      }
      return false;
    };
    const retainedComments = comments.filter(
      (c) => !isExcluded(c) && !isSyntheticTrackedChangeRow(c) && !(c.trackedChange && !hasCommentBody(c)),
    );
    const source =
      this.commentAuthorSource?.version === 1
        ? this.commentAuthorSource
        : this.#initializeLegacyCommentAuthorSource(editor, comments);
    const authorPlan = prepareCommentAuthors({
      convertedXml: this.convertedXml,
      comments: retainedComments,
      validationComments: comments,
      source,
      assignments: this.commentAuthorAssignments,
    });
    // Validation has succeeded. Remember all local IDs, including omitted rows, before writing XML.
    // A later export failure must not turn those generated rows into imported source on retry.
    this.commentAuthorSource = authorPlan.source;
    const exportableComments = authorPlan.comments;
    const commentsWithParaIds = exportableComments.map((c) => prepareCommentParaIds(c));
    const commentDefinitions = commentsWithParaIds.map((c, index) =>
      getCommentDefinition(c, index, commentsWithParaIds, editor),
    );

    // Compute the stat-field cache map once from the main body editor.
    // This same map is reused for header/footer exports so all parts
    // see document-level counts, not sub-editor-local counts.
    let statFieldCacheMap;
    try {
      if (editor) {
        statFieldCacheMap = refreshAllStatFields(editor);
      }
    } catch {
      // Non-critical — translators will fall back to node attrs
    }
    this._currentStatFieldCacheMap = statFieldCacheMap;

    const { result, params } = this.exportToXmlJson({
      data: jsonData,
      editorSchema,
      comments: exportableComments,
      commentDefinitions,
      commentsExportType,
      isFinalDoc,
      editor,
      fieldsHighlightColor,
      preserveSdtWrappers,
      statFieldCacheMap,
    });

    // Keep convertedXml's document part in sync with the current export tree
    // before downstream export passes (e.g. numbering pruning) inspect refs.
    const currentDocument = this.convertedXml['word/document.xml'] || {};
    this.convertedXml['word/document.xml'] = {
      ...currentDocument,
      ...result,
      declaration: result?.declaration ?? currentDocument.declaration,
    };

    if (exportJsonOnly) return result;

    const exporter = new DocxExporter(this);
    const xml = exporter.schemaToXml(result);

    const {
      updatedXml: footnotesUpdatedXml,
      relationships: footnotesRels,
      media: footnotesMedia,
    } = prepareFootnotesXmlForExport({
      footnotes: this.footnotes,
      editor,
      converter: this,
      convertedXml: this.convertedXml,
    });
    this.convertedXml = { ...this.convertedXml, ...footnotesUpdatedXml };

    const {
      updatedXml: endnotesUpdatedXml,
      relationships: endnotesRels,
      media: endnotesMedia,
    } = prepareEndnotesXmlForExport({
      endnotes: this.endnotes,
      editor,
      converter: this,
      convertedXml: this.convertedXml,
    });
    this.convertedXml = { ...this.convertedXml, ...endnotesUpdatedXml };

    // Update media
    await this.#exportProcessMediaFiles(
      {
        ...documentMedia,
        ...params.media,
        ...footnotesMedia,
        ...endnotesMedia,
        ...this.media,
      },
      editor,
    );

    // Update content types and comments files as needed — always run so cleanup
    // happens even when all comments have been removed
    const {
      documentXml,
      relationships: commentsRels,
      removedTargets,
    } = this.#prepareCommentsXmlFilesForExport({
      defs: params.exportedCommentDefs,
      exportType: commentsExportType,
      commentsWithParaIds,
    });
    const updatedXml = { ...documentXml };

    this.convertedXml = { ...this.convertedXml, ...updatedXml };

    // Physically remove comment parts that the exporter deleted from documentXml.
    // The spread merge above only adds/overwrites keys — absent keys survive from
    // the old this.convertedXml. Without this, Editor.ts sees stale data and
    // serializes comment files that should have been null-sentinelled.
    if (removedTargets?.length) {
      for (const target of removedTargets) {
        const key = target.startsWith('word/') ? target : `word/${target}`;
        delete this.convertedXml[key];
      }
    }

    const headFootRels = this.#exportProcessHeadersFooters({ isFinalDoc });
    this._currentStatFieldCacheMap = undefined; // cleanup after export cycle

    // Update the rels table
    this.#exportProcessNewRelationships([
      ...params.relationships,
      ...commentsRels,
      ...footnotesRels,
      ...endnotesRels,
      ...headFootRels,
    ]);

    // Prune relationships for comment parts that were removed
    if (removedTargets?.length) {
      this.#pruneCommentRelationships(removedTargets);
    }

    // Persist citation sources to package customXml bibliography part.
    this.bibliographyPart = syncBibliographyPartToPackage(this.convertedXml, this.bibliographyPart);

    // Store SuperDoc version
    SuperConverter.setStoredSuperdocVersion(this.convertedXml);
    const storedDocumentOrigin = STORED_DOCUMENT_ORIGINS.has(this.documentOrigin) ? this.documentOrigin : 'superdoc';
    SuperConverter.setStoredCustomProperty(
      this.convertedXml,
      SUPERDOC_DOCUMENT_ORIGIN_PROPERTY,
      storedDocumentOrigin,
      false,
    );

    // Store document GUID if document was modified
    if (this.documentModified || this.documentGuid) {
      if (!this.documentGuid) {
        this.documentGuid = this.getMicrosoftDocId() || uuidv4();
      }

      // Always store in custom.xml (never modify settings.xml)
      SuperConverter.setStoredCustomProperty(this.convertedXml, 'DocumentGuid', this.documentGuid, true);
    }

    // Flush document statistics into app.xml and settings.xml.
    this.#exportStatFieldMetadata(editor);

    // Update the numbering.xml
    this.#exportNumberingFile(params);

    this.commentPeopleExport = authorPlan.part;
    this.commentAuthorAssignments = authorPlan.assignments;
    this.exportWarnings.push(...authorPlan.warnings);
    return xml;
  }

  exportToXmlJson({
    data,
    editorSchema,
    comments,
    commentDefinitions,
    commentsExportType = 'clean',
    isFinalDoc = false,
    editor,
    isHeaderFooter = false,
    fieldsHighlightColor = null,
    preserveSdtWrappers = false,
    statFieldCacheMap = undefined,
    existingRelationships = [],
    partPath = 'word/document.xml',
  }) {
    const bodyNode = this.savedTagsToRestore.find((el) => el.name === 'w:body');

    // Use the pre-computed cache map (from exportToDocx) when available.
    // This ensures header/footer exports use main-body statistics, not
    // sub-editor-local counts. Falls back to computing from the current
    // editor for standalone calls.
    let resolvedCacheMap = statFieldCacheMap ?? this._currentStatFieldCacheMap;
    if (!resolvedCacheMap) {
      try {
        if (editor) {
          resolvedCacheMap = refreshAllStatFields(editor);
        }
      } catch {
        // Non-critical — translators will fall back to node attrs
      }
    }

    const [result, params] = exportSchemaToJson({
      node: data,
      bodyNode,
      relationships: [],
      documentMedia: {},
      media: {},
      isFinalDoc,
      editorSchema,
      converter: this,
      pageStyles: this.pageStyles,
      comments,
      commentsExportType,
      exportedCommentDefs: commentDefinitions,
      editor,
      isHeaderFooter,
      fieldsHighlightColor,
      preserveSdtWrappers,
      statFieldCacheMap: resolvedCacheMap,
      existingRelationships,
      currentPartPath: partPath,
    });

    return { result, params };
  }

  getBibliographyPartExportPaths() {
    return getBibliographyPartExportPaths(this.bibliographyPart);
  }

  /**
   * Writes document-statistic metadata into docProps/app.xml and
   * word/settings.xml as part of the export pipeline.
   *
   * Only upserts targeted elements — all unrelated metadata is preserved.
   */
  #exportStatFieldMetadata(editor) {
    if (!editor) return;

    try {
      // docProps/app.xml is document-scoped metadata. When export runs from a
      // linked child editor (for example a header/footer editor), compute the
      // statistics from the main body editor so package-level counts stay
      // aligned with Word's document-level stat-field semantics.
      const statsEditor = resolveMainBodyEditor(editor);
      const stats = getWordStatistics(statsEditor);
      writeAppStatistics(this.convertedXml, stats);

      // Only set w:updateFields when the document actually contains a
      // total-page-number node AND pagination is unavailable. This is the
      // only scenario where the cached NUMPAGES result is definitively stale.
      // Setting w:updateFields unconditionally would cause Word to recalculate
      // ALL fields on open (TOC, cross-references, etc.) — a side effect the
      // plan explicitly warns against.
      const settingsPart = this.convertedXml['word/settings.xml'];
      if (settingsPart && stats.pages == null) {
        const hasNumPagesNode = this.#anyPartContainsNodeType('total-page-number', editor);
        if (hasNumPagesNode) {
          const settingsRoot = ensureSettingsRoot(settingsPart);
          if (!hasUpdateFields(settingsRoot)) {
            setUpdateFields(settingsRoot, true);
          }
        }
      }
    } catch {
      // Non-critical — export should not fail if stats cannot be computed
    }
  }

  /**
   * Checks whether any document part (body + all header/footer editors)
   * contains at least one node of the given type.
   */
  #anyPartContainsNodeType(typeName, mainEditor) {
    // Check main body
    if (mainEditor && this.#docContainsNodeType(mainEditor.state.doc, typeName)) {
      return true;
    }
    // Check all header editors
    for (const entry of this.headerEditors ?? []) {
      if (entry?.editor && this.#docContainsNodeType(entry.editor.state.doc, typeName)) {
        return true;
      }
    }
    // Check all footer editors
    for (const entry of this.footerEditors ?? []) {
      if (entry?.editor && this.#docContainsNodeType(entry.editor.state.doc, typeName)) {
        return true;
      }
    }
    return false;
  }

  #docContainsNodeType(doc, typeName) {
    let found = false;
    doc.descendants((node) => {
      if (found) return false;
      if (node.type.name === typeName) {
        found = true;
        return false;
      }
      return true;
    });
    return found;
  }

  #exportNumberingFile() {
    const numberingPath = 'word/numbering.xml';
    // SD-2911: source presence must be captured before the baseNumbering fallback —
    // the importer fills `this.numbering` from baseNumbering when the source had no
    // numbering part, so it can't be inferred from `this.numbering` at write time.
    const sourceHadNumberingXml = Boolean(this.convertedXml[numberingPath]);
    let numberingXml = this.convertedXml[numberingPath];

    if (!numberingXml) numberingXml = baseNumbering;
    const currentNumberingXml = numberingXml.elements[0];

    if (!sourceHadNumberingXml && !hasBodyNumberingReferences(this.convertedXml['word/document.xml'])) {
      return;
    }

    if (this.numbering?.definitions && this.numbering?.abstracts) {
      const abstracts = Object.values(this.numbering.abstracts);
      const definitions = Object.values(this.numbering.definitions);
      currentNumberingXml.elements = [...abstracts, ...definitions];
    } else {
      currentNumberingXml.elements = [];
    }

    this.convertedXml[numberingPath] = numberingXml;
  }

  /**
   * Update comments files and relationships depending on export type
   */
  #prepareCommentsXmlFilesForExport({ defs, exportType, commentsWithParaIds }) {
    const {
      documentXml,
      relationships,
      removedTargets = [],
      warnings = [],
    } = prepareCommentsXmlFilesForExport({
      exportType,
      convertedXml: this.convertedXml,
      defs,
      commentsWithParaIds,
      threadingProfile: this.commentThreadingProfile,
    });

    if (warnings.length) {
      this.exportWarnings.push(...warnings);
    }

    return { documentXml, relationships, removedTargets };
  }

  #exportProcessHeadersFooters({ isFinalDoc = false }) {
    const relsData = this.convertedXml['word/_rels/document.xml.rels'];
    const relationships = relsData.elements.find((x) => x.name === 'Relationships');
    const newDocRels = [];

    Object.entries(this.headers).forEach(([id, header], index) => {
      const relationshipTarget =
        relationships.elements.find((el) => el.attributes.Id === id)?.attributes.Target || `header${index + 1}.xml`;
      const partPath = normalizeWordPartPath(relationshipTarget);
      const relsPath = getWordPartRelsPath(partPath);
      const headerEditor = this.headerEditors.find((item) => item.id === id);
      const existingRelationships =
        this.convertedXml[relsPath]?.elements?.find((x) => x.name === 'Relationships')?.elements || [];

      if (!headerEditor) return;

      const { result, params } = this.exportToXmlJson({
        data: header,
        editor: headerEditor.editor,
        editorSchema: headerEditor.editor.schema,
        comments: [],
        commentDefinitions: [],
        isHeaderFooter: true,
        isFinalDoc,
        existingRelationships,
        partPath,
      });

      const bodyContent = result.elements[0].elements;
      const file = this.convertedXml[partPath];

      if (!file) {
        this.convertedXml[partPath] = {
          declaration: this.initialJSON?.declaration,
          elements: [
            {
              attributes: DEFAULT_DOCX_DEFS,
              name: 'w:hdr',
              type: 'element',
              elements: [],
            },
          ],
        };
        newDocRels.push({
          type: 'element',
          name: 'Relationship',
          attributes: {
            Id: id,
            Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
            Target: partPath.replace(/^word\//, ''),
          },
        });
      }

      this.convertedXml[partPath].elements[0].elements = bodyContent;

      if (params.relationships.length) {
        this.convertedXml[relsPath] = {
          declaration: this.initialJSON?.declaration,
          elements: [
            {
              name: 'Relationships',
              attributes: {
                xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships',
              },
              elements: mergeRelationshipElements(existingRelationships, params.relationships),
            },
          ],
        };
      }
    });

    Object.entries(this.footers).forEach(([id, footer], index) => {
      const relationshipTarget =
        relationships.elements.find((el) => el.attributes.Id === id)?.attributes.Target || `footer${index + 1}.xml`;
      const partPath = normalizeWordPartPath(relationshipTarget);
      const relsPath = getWordPartRelsPath(partPath);
      const footerEditor = this.footerEditors.find((item) => item.id === id);
      const existingRelationships =
        this.convertedXml[relsPath]?.elements?.find((x) => x.name === 'Relationships')?.elements || [];

      if (!footerEditor) return;

      const { result, params } = this.exportToXmlJson({
        data: footer,
        editor: footerEditor.editor,
        editorSchema: footerEditor.editor.schema,
        comments: [],
        commentDefinitions: [],
        isHeaderFooter: true,
        isFinalDoc,
        existingRelationships,
        partPath,
      });

      const bodyContent = result.elements[0].elements;
      const file = this.convertedXml[partPath];

      if (!file) {
        this.convertedXml[partPath] = {
          declaration: this.initialJSON?.declaration,
          elements: [
            {
              attributes: DEFAULT_DOCX_DEFS,
              name: 'w:ftr',
              type: 'element',
              elements: [],
            },
          ],
        };
        newDocRels.push({
          type: 'element',
          name: 'Relationship',
          attributes: {
            Id: id,
            Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
            Target: partPath.replace(/^word\//, ''),
          },
        });
      }

      this.convertedXml[partPath].elements[0].elements = bodyContent;

      if (params.relationships.length) {
        this.convertedXml[relsPath] = {
          declaration: this.initialJSON?.declaration,
          elements: [
            {
              name: 'Relationships',
              attributes: {
                xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships',
              },
              elements: mergeRelationshipElements(existingRelationships, params.relationships),
            },
          ],
        };
      }
    });

    return newDocRels;
  }

  #exportProcessNewRelationships(rels = []) {
    const relsData = this.convertedXml['word/_rels/document.xml.rels'];
    const relationships = relsData.elements.find((x) => x.name === 'Relationships');

    relationships.elements = mergeRelationshipElements(relationships.elements, rels);
  }

  /**
   * Remove relationship entries for comment parts that are no longer being emitted.
   * Matches by both normalized target AND comment relationship type to avoid
   * accidentally pruning unrelated relationships.
   * @param {string[]} removedTargets - bare filenames like 'commentsExtended.xml'
   */
  #pruneCommentRelationships(removedTargets) {
    const relsData = this.convertedXml['word/_rels/document.xml.rels'];
    const relationships = relsData.elements.find((x) => x.name === 'Relationships');
    if (!relationships?.elements) return;

    const normalizeTarget = (target) => {
      if (!target) return '';
      return target
        .replace(/^\.\//, '')
        .replace(/^\//, '')
        .replace(/^word\//, '');
    };

    const removedSet = new Set(removedTargets.map(normalizeTarget));

    relationships.elements = relationships.elements.filter((rel) => {
      const type = rel.attributes?.Type;
      const target = normalizeTarget(rel.attributes?.Target);
      if (COMMENT_RELATIONSHIP_TYPES.has(type) && removedSet.has(target)) {
        return false;
      }
      return true;
    });
  }

  async #exportProcessMediaFiles(media = {}) {
    const processedData = {
      ...(this.convertedXml.media || {}),
    };

    for (const [filePath, value] of Object.entries(media)) {
      if (value == null) continue;
      processedData[filePath] = await getArrayBufferFromUrl(value);
    }

    this.convertedXml.media = processedData;
    this.media = this.convertedXml.media;
    this.addedMedia = {
      ...processedData,
    };
  }

  /**
   * Re-import a single header/footer part from OOXML JSON to PM JSON.
   *
   * Used by the part-sync afterCommit hook to rebuild the PM JSON cache
   * after a remote collaborator updates a header/footer part.
   *
   * @param {string} partId - OOXML zip path (e.g. 'word/header1.xml')
   * @returns {object|null} PM JSON document, or null on failure
   */
  reimportHeaderFooterPart(partId) {
    const xmlJson = this.convertedXml?.[partId];
    if (!xmlJson?.elements?.[0]?.elements) return null;

    const rootElements = carbonCopy(xmlJson.elements[0].elements);
    const { processedNodes } = preProcessPageFieldsOnly(rootElements);

    const nodeListHandler = defaultNodeListHandler();
    let schema = nodeListHandler.handler({
      nodes: processedNodes,
      nodeListHandler,
      docx: this.convertedXml,
      converter: this,
      numbering: this.numbering,
      translatedNumbering: this.translatedNumbering,
      translatedLinkedStyles: this.translatedLinkedStyles,
      editor: {},
      filename: partId.split('/').pop(),
      path: [],
    });

    schema = filterOutRootInlineNodes(schema);
    schema = normalizeDuplicateBlockIdentitiesInContent(schema);

    return { type: 'doc', content: [...schema] };
  }

  /**
   * Re-import a notes part (footnotes.xml or endnotes.xml) from OOXML JSON
   * to the derived NoteEntry[] cache.
   *
   * Used by the notes-part-descriptor afterCommit hook to rebuild
   * `converter.footnotes` / `converter.endnotes` after a mutation.
   *
   * @param {string} partId - OOXML zip path ('word/footnotes.xml' or 'word/endnotes.xml')
   * @returns {Array<{id: string, type?: string|null, content: any[], originalXml?: any}>}
   */
  reimportNotePart(partId) {
    if (!this.convertedXml?.[partId]) return [];

    const importFn = partId === 'word/endnotes.xml' ? importEndnoteData : importFootnoteData;
    return importFn({
      docx: this.convertedXml,
      editor: {},
      converter: this,
      numbering: this.numbering,
    });
  }

  // Deprecated methods for backward compatibility
  static getStoredSuperdocId(docx) {
    console.warn('getStoredSuperdocId is deprecated, use getDocumentGuid instead');
    return SuperConverter.extractDocumentGuid(docx);
  }

  static updateDocumentVersion(docx, version) {
    console.warn('updateDocumentVersion is deprecated, use setStoredSuperdocVersion instead');
    return SuperConverter.setStoredSuperdocVersion(docx, version);
  }
}

function generateCustomXml() {
  return DEFAULT_CUSTOM_XML;
}

/** @returns {boolean} True if any descendant of `documentXml` is a `w:numPr` element. */
function hasBodyNumberingReferences(documentXml) {
  if (!documentXml || typeof documentXml !== 'object') return false;
  const stack = Array.isArray(documentXml.elements) ? [...documentXml.elements] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.name === 'w:numPr') return true;
    if (Array.isArray(node.elements)) stack.push(...node.elements);
  }
  return false;
}

export { SuperConverter, hasBodyNumberingReferences };
