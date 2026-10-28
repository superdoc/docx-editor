/**
 * Maps SDRunProps field names to InlineRunPatch field names.
 * SDRunProps (read-side) and InlineRunPatch (write-side) use different keys
 * for the same properties; direct assignment between them is forbidden.
 *
 * @param {Record<string, unknown>} props - SDRunProps object from doc.getNodeById
 * @returns {Record<string, unknown>} InlineRunPatch ready for doc.format.apply
 */
export function sdRunPropsToInlineRunPatch(props) {
  if (!props || typeof props !== 'object') return {};
  const patch = {};
  if (props.fonts) {
    patch.rFonts = {
      ascii: props.fonts.ascii,
      hAnsi: props.fonts.hAnsi,
      eastAsia: props.fonts.eastAsia,
      cs: props.fonts.cs,
      asciiTheme: props.fonts.asciiTheme,
      hAnsiTheme: props.fonts.hAnsiTheme,
      eastAsiaTheme: props.fonts.eastAsiaTheme,
      csTheme: props.fonts.csTheme,
      hint: props.fonts.hint,
    };
  }
  if (props.fontFamily != null) patch.fontFamily = props.fontFamily;
  if (props.lang) {
    patch.lang = {
      val: props.lang.val,
      eastAsia: props.lang.eastAsia,
      bidi: props.lang.bidi,
    };
  }
  if (props.fontSize != null) patch.fontSize = props.fontSize;
  if (props.fontSizeCs != null) patch.fontSizeCs = props.fontSizeCs;

  const color = projectColorRefToInlineColor(props.color);
  if (color != null) patch.color = color;
  if (props.highlight != null) patch.highlight = props.highlight;

  const shading = projectShadingToInlinePatch(props.shading);
  if (shading) patch.shading = shading;

  if (props.cs != null) patch.cs = props.cs;
  if (props.rtl != null) patch.rtl = props.rtl;
  if (props.bold != null) patch.bold = props.bold;
  if (props.boldCs != null) patch.bCs = props.boldCs;
  if (props.italic != null) patch.italic = props.italic;
  if (props.italicCs != null) patch.iCs = props.italicCs;

  const underline = projectUnderlineToInlinePatch(props.underline);
  if (underline !== undefined) patch.underline = underline;

  if (props.strikethrough != null) patch.strike = props.strikethrough;
  if (props.doubleStrikethrough != null) patch.dstrike = props.doubleStrikethrough;
  if (props.caps != null) patch.caps = props.caps;
  if (props.smallCaps != null) patch.smallCaps = props.smallCaps;
  if (props.outline != null) patch.outline = props.outline;
  if (props.shadow != null) patch.shadow = props.shadow;
  if (props.emboss != null) patch.emboss = props.emboss;
  if (props.imprint != null) patch.imprint = props.imprint;

  if (props.verticalAlign != null) patch.vertAlign = props.verticalAlign;
  if (props.characterSpacing != null) patch.letterSpacing = props.characterSpacing;
  if (props.characterScale != null) patch.charScale = props.characterScale;
  if (props.kern != null) patch.kerning = props.kern;
  if (props.baselineShift != null) patch.position = props.baselineShift;
  if (props.fitTextWidth != null) patch.fitText = { val: props.fitTextWidth };

  if (props.vanish != null) patch.vanish = props.vanish;
  if (props.webHidden != null) patch.webHidden = props.webHidden;
  if (props.specVanish != null) patch.specVanish = props.specVanish;

  const border = projectBorderToInlinePatch(props.border);
  if (border) patch.border = border;

  return patch;
}

function projectColorRefToInlineColor(color) {
  if (!color) return undefined;
  if (typeof color === 'string') return color;
  if (color.model === 'rgb') return color.value;
  if (color.model === 'auto') return 'auto';
  return undefined;
}

function projectUnderlineToInlinePatch(underline) {
  if (underline == null) return undefined;
  const patch = {};
  if (underline.style != null) patch.style = underline.style;
  if (underline.color?.model === 'rgb') patch.color = underline.color.value;
  if (underline.color?.model === 'theme') patch.themeColor = underline.color.theme;
  return Object.keys(patch).length > 0 ? patch : true;
}

function projectShadingToInlinePatch(shading) {
  if (!shading) return undefined;
  const patch = {};
  const fill = projectColorRefToInlineColor(shading.fill);
  if (fill != null) patch.fill = fill;
  const color = projectColorRefToInlineColor(shading.color);
  if (color != null) patch.color = color;
  if (shading.pattern != null) patch.val = shading.pattern;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function projectBorderToInlinePatch(border) {
  if (!border) return undefined;
  const patch = {};
  if (border.style != null) patch.val = border.style;
  if (border.width != null) patch.sz = border.width;
  if (border.space != null) patch.space = border.space;
  const color = projectColorRefToInlineColor(border.color);
  if (color != null) patch.color = color;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Serializes a selection to a stable string key used to detect whether
 * the target selection is the same as the source (skip apply in that case).
 *
 * Falls back to the plain text target when the host has not populated an
 * explicit `selectionTarget` yet.
 *
 * @param {{ selectionTarget?: unknown; target?: unknown } | null | undefined} selection
 * @returns {string}
 */
export function selectionKey(selection) {
  const target = selection?.selectionTarget ?? selection?.target;
  if (!selection || !target) return '';
  try {
    return JSON.stringify(target);
  } catch {
    return String(target);
  }
}
