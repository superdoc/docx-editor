// @ts-check
/**
 * Canonical child-element order for OOXML fixed-sequence property containers.
 *
 * ECMA-376 models these property containers (`w:rPr`, `w:pPr`, `w:numPr`, ...)
 * as `xsd:sequence` complex types (`CT_RPr`, `CT_PPr`, `CT_NumPr`, ...), which
 * means their child elements MUST appear in a fixed order. Desktop Word
 * silently repairs out-of-order children on open, but Word for the web rejects
 * the whole package and opens the document read-only as "corrupt".
 *
 * The export pipeline emits children in JavaScript object/array insertion order
 * (`Object.keys(attrs)`, mark-array order), which is not guaranteed to match the
 * schema sequence. This table lets the emit paths stable-sort children back into
 * canonical order regardless of how the ProseMirror attributes were built.
 *
 * Keys are container local names (namespace prefix stripped); values are the
 * ECMA-376 child sequences as local names. Sequences are sourced from ECMA-376
 * (CT_RPr §17.3.2.28, CT_PPr §17.3.1.26, CT_NumPr §17.3.1.19, CT_TrPr §17.4.82,
 * CT_TcPr §17.4.70, CT_TblPr §17.4.60, CT_TblPrEx §17.4.61, CT_SectPr §17.6.17).
 *
 * @type {Readonly<Record<string, string[]>>}
 */
export const OOXML_PROPERTY_CHILD_ORDER = Object.freeze({
  rPr: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
    'highlight',
    'u',
    'effect',
    'bdr',
    'shd',
    'fitText',
    'vertAlign',
    'rtl',
    'cs',
    'em',
    'lang',
    'eastAsianLayout',
    'specVanish',
    'oMath',
    'rPrChange',
  ],
  pPr: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'kinsoku',
    'wordWrap',
    'overflowPunct',
    'topLinePunct',
    'autoSpaceDE',
    'autoSpaceDN',
    'bidi',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
    'ind',
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
    'jc',
    'textDirection',
    'textAlignment',
    'textboxTightWrap',
    'outlineLvl',
    'divId',
    'cnfStyle',
    'rPr',
    'sectPr',
    'pPrChange',
  ],
  numPr: ['ilvl', 'numId', 'numberingChange', 'ins'],
  trPr: [
    'cnfStyle',
    'divId',
    'gridBefore',
    'gridAfter',
    'wBefore',
    'wAfter',
    'cantSplit',
    'trHeight',
    'tblHeader',
    'tblCellSpacing',
    'jc',
    'hidden',
    'ins',
    'del',
    'trPrChange',
  ],
  tcPr: [
    'cnfStyle',
    'tcW',
    'gridSpan',
    'hMerge',
    'vMerge',
    'tcBorders',
    'shd',
    'noWrap',
    'tcMar',
    'textDirection',
    'tcFitText',
    'vAlign',
    'hideMark',
    'headers',
    'cellIns',
    'cellDel',
    'cellMerge',
    'tcPrChange',
  ],
  tblPr: [
    'tblStyle',
    'tblpPr',
    'tblOverlap',
    'bidiVisual',
    'tblStyleRowBandSize',
    'tblStyleColBandSize',
    'tblW',
    'jc',
    'tblCellSpacing',
    'tblInd',
    'tblBorders',
    'shd',
    'tblLayout',
    'tblCellMar',
    'tblLook',
    'tblCaption',
    'tblDescription',
    'tblPrChange',
  ],
  tblPrEx: ['tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook'],
  sectPr: [
    'headerReference',
    'footerReference',
    'footnotePr',
    'endnotePr',
    'type',
    'pgSz',
    'pgMar',
    'paperSrc',
    'pgBorders',
    'lnNumType',
    'pgNumType',
    'cols',
    'formProt',
    'vAlign',
    'noEndnote',
    'titlePg',
    'textDirection',
    'bidi',
    'rtlGutter',
    'docGrid',
    'printerSettings',
    'sectPrChange',
  ],
});

/**
 * Strips an OOXML namespace prefix from an element name (e.g. `w:rFonts` → `rFonts`).
 * @param {string|undefined|null} name
 * @returns {string|undefined|null}
 */
const stripPrefix = (name) =>
  typeof name === 'string' && name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;

/**
 * Returns the canonical child sequence for a property container, or undefined
 * if the container is not a known fixed-sequence type.
 * @param {string} containerName Container element name, with or without prefix (e.g. `w:rPr` or `rPr`).
 * @returns {string[]|undefined}
 */
export function getCanonicalChildOrder(containerName) {
  const key = stripPrefix(containerName);
  return key ? OOXML_PROPERTY_CHILD_ORDER[key] : undefined;
}

/**
 * Stable-sorts the child elements of a fixed-sequence OOXML property container
 * into ECMA-376 canonical order.
 *
 * Known children are ordered by their position in the canonical sequence.
 * Unknown/extension elements (e.g. `w14:*`, `mc:AlternateContent`) sort AFTER
 * all known children, preserving their original relative order. If the
 * container has no canonical sequence, the input is returned unchanged.
 *
 * @template {{ name?: string }} T
 * @param {string} containerName The container element name (e.g. `w:rPr`).
 * @param {T[]} elements The emitted child elements.
 * @returns {T[]} The elements ordered into canonical schema sequence.
 */
export function sortPropertyChildElements(containerName, elements) {
  if (!Array.isArray(elements) || elements.length < 2) return elements;
  const order = getCanonicalChildOrder(containerName);
  if (!order) return elements;

  const rankByName = new Map(order.map((name, index) => [name, index]));
  const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

  return elements
    .map((element, index) => {
      const rank = rankByName.get(stripPrefix(element?.name));
      return { element, index, rank: rank == null ? UNKNOWN_RANK : rank };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.element);
}
