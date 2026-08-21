// @ts-check
// Pure conversions between a neutral CapturedFormatting shape and the
// converter's flat `definition.styles` map. No editor/DOM/PM imports, so this
// module is unit-testable in isolation.

/**
 * @typedef {Object} CapturedFormatting
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} underline
 * @property {number|null} fontSizePt  Font size in points, or null when unset.
 * @property {string|null} fontFamily
 * @property {string|null} colorHex    Bare uppercase hex, no leading '#', or null.
 */

/**
 * Normalise a colour value into bare uppercase 6-digit hex, or null.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normaliseHex(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

/**
 * Parse a font-size value ("16pt", "16", 16) into points, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseFontSizePt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim().match(/^(\d+(?:\.\d+)?)/)?.[1];
  if (!raw) return null;
  const pt = Number.parseFloat(raw);
  return Number.isFinite(pt) ? pt : null;
}

/**
 * Mutate the flat `definition.styles` map in place to reflect run-level
 * formatting. Boolean marks are presence-keyed ({} when on, absent when off),
 * matching the importer's shape. Block-level keys (spacing/indent/tabStops) are
 * deliberately left untouched.
 * @param {Record<string, any>} styles
 * @param {CapturedFormatting} captured
 */
export function applyToDefinitionStyles(styles, captured) {
  // On => presence ({}); off => explicit { value: '0' } rather than removing the
  // key, so a redefined style overrides (not inherits) a basedOn boolean.
  // generateLinkedStyleString reads value '0'/false as off (and a present key
  // blocks basedOn inheritance).
  const setBool = (key, on) => {
    styles[key] = on ? {} : { value: '0' };
  };
  setBool('bold', captured.bold);
  setBool('italic', captured.italic);
  setBool('underline', captured.underline);

  if (captured.fontSizePt != null) styles['font-size'] = `${captured.fontSizePt}pt`;
  else delete styles['font-size'];
  if (captured.fontFamily) styles['font-family'] = captured.fontFamily;
  else delete styles['font-family'];
  if (captured.colorHex) styles.color = `#${captured.colorHex}`;
  else delete styles.color;
}

/**
 * Inverse of applyToDefinitionStyles: read a flat styles map into neutral fields.
 * @param {Record<string, any>} styles
 * @returns {CapturedFormatting}
 */
export function definitionStylesToFormatting(styles) {
  const s = styles || {};
  // A boolean is on when its key is present and not an explicit off ('0'/false);
  // absent or explicit-off both read as false.
  const boolOn = (v) => {
    if (v == null) return false;
    const val = typeof v === 'object' ? v.value : v;
    return val !== '0' && val !== false;
  };
  return {
    bold: boolOn(s.bold),
    italic: boolOn(s.italic),
    underline: boolOn(s.underline),
    fontSizePt: parseFontSizePt(s['font-size']),
    fontFamily: typeof s['font-family'] === 'string' ? s['font-family'] : null,
    colorHex: normaliseHex(s.color),
  };
}

/**
 * Mutate `translatedLinkedStyles.styles[styleId]` (representation #2) run channel
 * in place. Font size is stored in OOXML half-points; font family is the
 * ascii/hAnsi/cs triple. Block-level paragraphProperties are left untouched.
 * @param {Record<string, any>} styleDef
 * @param {CapturedFormatting} captured
 */
export function applyToTranslatedStyle(styleDef, captured) {
  const run = { ...(styleDef.runProperties ?? {}) };
  run.bold = captured.bold;
  run.italic = captured.italic;
  if (captured.underline) run.underline = run.underline ?? { value: 'single' };
  else delete run.underline;
  if (captured.fontSizePt != null) run.fontSize = Math.round(captured.fontSizePt * 2);
  else delete run.fontSize;
  if (captured.fontFamily) {
    run.fontFamily = { ascii: captured.fontFamily, hAnsi: captured.fontFamily, cs: captured.fontFamily };
  } else {
    delete run.fontFamily;
  }
  if (captured.colorHex) run.color = { val: captured.colorHex };
  else delete run.color;
  styleDef.runProperties = run;
}

// --- word/styles.xml (representation #3) ------------------------------------
// The parsed tree uses the SuperConverter element shape:
//   { type: 'element', name: 'w:rPr', attributes: {}, elements: [ ...children ] }

/**
 * @typedef {Object} XmlElement
 * @property {string} [type]
 * @property {string} [name]
 * @property {Record<string,string>} [attributes]
 * @property {XmlElement[]} [elements]
 */

/** @param {XmlElement} parent @param {string} name @returns {XmlElement} */
function ensureChild(parent, name) {
  if (!parent.elements) parent.elements = [];
  let child = parent.elements.find((el) => el.name === name);
  if (!child) {
    child = { type: 'element', name, attributes: {}, elements: [] };
    parent.elements.push(child);
  }
  return child;
}

/** @param {XmlElement} parent @param {string} name */
function removeChild(parent, name) {
  if (!parent.elements) return;
  parent.elements = parent.elements.filter((el) => el.name !== name);
}

/**
 * Set an OOXML run-property toggle. On => present with no val (`<w:b/>`);
 * off => explicit `<w:b w:val="0"/>` so a basedOn style's value is overridden
 * rather than inherited (absent would inherit).
 * @param {XmlElement} rpr @param {string} name @param {boolean} on
 */
function setBooleanProp(rpr, name, on) {
  ensureChild(rpr, name).attributes = on ? {} : { 'w:val': '0' };
}

/**
 * Patch a single `w:style` element's `w:rPr` (run-level) to reflect the captured
 * formatting, so the redefinition survives `.docx` export. Mutates in place.
 * @param {XmlElement} styleEl
 * @param {CapturedFormatting} captured
 */
export function patchStyleXmlElement(styleEl, captured) {
  const rpr = ensureChild(styleEl, 'w:rPr');
  setBooleanProp(rpr, 'w:b', captured.bold);
  setBooleanProp(rpr, 'w:i', captured.italic);
  // Underline off is explicit (w:val="none") for the same reason as w:b/w:i:
  // an absent w:u would inherit a basedOn underline.
  ensureChild(rpr, 'w:u').attributes = captured.underline ? { 'w:val': 'single' } : { 'w:val': 'none' };

  if (captured.fontSizePt != null) {
    const halfPoints = String(Math.round(captured.fontSizePt * 2));
    ensureChild(rpr, 'w:sz').attributes = { 'w:val': halfPoints };
    ensureChild(rpr, 'w:szCs').attributes = { 'w:val': halfPoints };
  } else {
    removeChild(rpr, 'w:sz');
    removeChild(rpr, 'w:szCs');
  }
  if (captured.fontFamily) {
    ensureChild(rpr, 'w:rFonts').attributes = {
      'w:ascii': captured.fontFamily,
      'w:hAnsi': captured.fontFamily,
      'w:cs': captured.fontFamily,
    };
  } else {
    removeChild(rpr, 'w:rFonts');
  }
  if (captured.colorHex) ensureChild(rpr, 'w:color').attributes = { 'w:val': captured.colorHex };
  else removeChild(rpr, 'w:color');
}

/**
 * Locate the `w:style` element with the given `w:styleId` inside the parsed
 * `word/styles.xml` document. Returns undefined when not found.
 * @param {XmlElement|undefined} stylesXml
 * @param {string} styleId
 * @returns {XmlElement|undefined}
 */
export function findStyleXmlElement(stylesXml, styleId) {
  const root = stylesXml?.elements?.[0];
  const styleEls = root?.elements?.filter((el) => el.name === 'w:style') ?? [];
  return styleEls.find((el) => el.attributes?.['w:styleId'] === styleId);
}
