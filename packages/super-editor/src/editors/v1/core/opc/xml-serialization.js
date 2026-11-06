/**
 * Serialize an xml-js non-compact JS tree to a string for OPC package files
 * (e.g. word/_rels/document.xml.rels, _rels/.rels, [Content_Types].xml).
 *
 * xml-js's `js2xml` does not re-encode XML entities in attribute values: a
 * `&amp;` decoded by `xml2js` would round-trip back as a bare `&`, producing
 * malformed XML. Word rejects malformed `*.rels` with an "unreadable content"
 * repair prompt and applies default formatting during repair, which manifests
 * as font, table-width, and spacing regressions. See SD-2888.
 *
 * This helper is the single serialization path for OPC metadata. Always use
 * it instead of calling `xmljs.js2xml` directly on parsed OPC XML.
 *
 * @module opc/xml-serialization
 */

import * as xmljs from 'xml-js';

/**
 * Escape the raw attribute, before xml-js's ambiguous quote pre-escaping.
 *
 * @param {string} _value - xml-js's pre-escaped value
 * @param {string} name - attribute name
 * @param {string} _elementName - containing element name
 * @param {object} element - original element or declaration
 * @returns {string}
 */
function escapeAttributeValue(_value, name, _elementName, element) {
  // Literal attribute whitespace is normalized to spaces by XML readers.
  return String(element.attributes[name])
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

/**
 * Neutralize xml-js's one-level `&amp;` desanitization of decoded text.
 * Copy the affected nodes so imported trees and CDATA remain untouched.
 *
 * @param {object} node - non-compact XML node or document
 * @returns {object}
 */
function preserveTextEntities(node) {
  if (node.type === 'text') return { ...node, text: String(node.text).replace(/&/g, '&amp;') };
  return node.elements ? { ...node, elements: node.elements.map(preserveTextEntities) } : node;
}

/**
 * Serialize an xml-js non-compact JS object to an XML string with attribute
 * and text values correctly XML-encoded from their exact decoded values.
 *
 * @param {object} jsObject - xml-js non-compact tree (from `xml2js({ compact: false })`)
 * @returns {string}
 */
export function serializeOpcXml(jsObject) {
  return xmljs.js2xml(preserveTextEntities(jsObject), {
    spaces: 0,
    attributeValueFn: escapeAttributeValue,
    // Run after xml-js escaping so CR references survive XML line-end normalization.
    textFn: (text) => text.replace(/\r/g, '&#xD;'),
  });
}
