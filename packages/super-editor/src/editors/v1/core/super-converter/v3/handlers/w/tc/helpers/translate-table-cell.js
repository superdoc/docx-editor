import { pixelsToTwips, inchesToTwips, twipsToPixels, normalizeHexColor, isValidHexColor } from '@converter/helpers';
import { translateChildNodes } from '@converter/v2/exporter/helpers/index';
import { translator as tcPrTranslator } from '../../tcPr';
import {
  isLegacySchemaDefaultBorders,
  convertBordersToOoxmlFormat,
} from '../../../../../../../extensions/table-cell/helpers/legacyBorderMigration.js';

/**
 * Main translation function for a table cell.
 * @param {import('@converter/exporter').ExportParams} params
 * @returns {import('@converter/exporter').XmlReadyNode}
 */
export function translateTableCell(params) {
  const elements = translateChildNodes({
    ...params,
    tableCell: params.node,
  });

  // A `<w:tc>` must contain at least one block-level element (ECMA-376
  // CT_Tc); `<w:tcPr>` alone is not valid content and Word offers to repair the
  // file. A cell can end up with nothing when every child drops out of the
  // export — which a final-doc export does to a paragraph whose mark was
  // tracked-deleted. Keep the cell inhabited, matching what accepting that
  // deletion does in the editor: the collapse refuses to cross a cell
  // boundary, so a cell's paragraph is emptied, never removed.
  if (!elements.length) {
    elements.push({ name: 'w:p', elements: [] });
  }

  const cellProps = generateTableCellProperties(params.node);
  elements.unshift(cellProps);

  return {
    name: 'w:tc',
    elements,
  };
}

/**
 * Generate w:tcPr properties node for a table cell
 * @param {import('@converter/exporter').SchemaNode} node
 * @returns {import('@converter/exporter').XmlReadyNode}
 */
export function generateTableCellProperties(node) {
  let tableCellProperties = { ...(node.attrs?.tableCellProperties || {}) };
  /** When set by import: keys that were in the cell's w:tcPr. When null/undefined (e.g. new cell), do not filter. */
  const inlineKeys = node.attrs?.tableCellPropertiesInlineKeys;

  const { attrs } = node;

  // Width
  const { colwidth: rawColwidth, widthUnit = 'px' } = attrs;
  const resolvedWidthType =
    attrs.cellWidthType ??
    (attrs.widthType !== 'auto' ? attrs.widthType : undefined) ??
    tableCellProperties.cellWidth?.type ??
    'dxa';

  // Filter to finite numbers to guard against NaN/Infinity/non-numeric entries
  const colwidth = Array.isArray(rawColwidth) ? rawColwidth.filter((v) => Number.isFinite(v)) : [];

  // Skip rewrite when:
  // - colwidth is empty (no data to compute from — preserve original cellWidth)
  // - resolvedWidthType is 'pct' (colwidth is in pixels but type expects fiftieths-of-percent)
  if (colwidth.length > 0 && resolvedWidthType !== 'pct') {
    const colwidthSum = colwidth.reduce((acc, curr) => acc + curr, 0);
    const propertiesWidthPixels = twipsToPixels(tableCellProperties.cellWidth?.value);
    if (propertiesWidthPixels !== colwidthSum) {
      tableCellProperties['cellWidth'] = {
        value: widthUnit === 'px' ? pixelsToTwips(colwidthSum) : inchesToTwips(colwidthSum),
        type: resolvedWidthType,
      };
    }
  }

  // Colspan
  const { colspan } = attrs;
  if (colspan > 1 && tableCellProperties.gridSpan !== colspan) {
    tableCellProperties['gridSpan'] = colspan;
  } else if (!colspan || colspan <= 1) {
    delete tableCellProperties.gridSpan;
  }

  // Background
  const { background = {} } = attrs;
  if (background?.color) {
    const fill = normalizeHexColor(background.color);
    if (fill && isValidHexColor(fill) && tableCellProperties.shading?.fill?.toUpperCase() !== fill) {
      tableCellProperties['shading'] = { fill, val: 'clear' };
    }
  } else if (!background?.color && tableCellProperties?.shading?.fill) {
    delete tableCellProperties.shading;
  }

  // Margins — only merge from attrs when the cell had w:tcMar in its w:tcPr
  // (inline), or when inlineKeys was not set (new cell / backward compat). Do
  // not output when inlineKeys is set and does not include 'cellMargins'
  // (inherited from table style).
  //
  // SD-3152: preserve the source key family per horizontal side. The importer
  // keeps the OOXML-shaped value on tableCellProperties.cellMargins (logical
  // marginStart/marginEnd or physical marginLeft/marginRight), while the
  // user-facing attrs.cellMargins is LTR-default physical-only (SD-3134). On
  // export, write the user-visible value back into whichever pair the import
  // preserved so a Word-authored <w:start>/<w:end> doc does not gain extra
  // <w:left>/<w:right> children on round-trip.
  const { cellMargins } = attrs;
  if (cellMargins && (!Array.isArray(inlineKeys) || inlineKeys.includes('cellMargins'))) {
    if (!tableCellProperties.cellMargins) tableCellProperties['cellMargins'] = {};
    const propMargins = tableCellProperties.cellMargins;

    // Vertical sides have no logical alternate (CT_TcMar has only top/bottom).
    ['top', 'bottom'].forEach((side) => {
      const key = `margin${side.charAt(0).toUpperCase() + side.slice(1)}`;
      if (cellMargins[side] != null) {
        const currentPx = twipsToPixels(propMargins[key]?.value);
        if (currentPx !== cellMargins[side]) {
          propMargins[key] = { value: pixelsToTwips(cellMargins[side]), type: 'dxa' };
        }
      } else if (propMargins[key]) {
        delete propMargins[key];
      }
    });

    // Horizontal sides: choose logical vs physical pair per imported source.
    [
      { side: 'left', physicalKey: 'marginLeft', logicalKey: 'marginStart' },
      { side: 'right', physicalKey: 'marginRight', logicalKey: 'marginEnd' },
    ].forEach(({ side, physicalKey, logicalKey }) => {
      const value = cellMargins[side];
      const hasPhysical = propMargins[physicalKey] != null;
      const hasLogical = propMargins[logicalKey] != null;
      const physicalTwips = propMargins[physicalKey]?.value;
      const logicalTwips = propMargins[logicalKey]?.value;

      if (value == null) {
        if (hasPhysical) delete propMargins[physicalKey];
        if (hasLogical) delete propMargins[logicalKey];
        return;
      }

      const newTwips = pixelsToTwips(value);

      if (hasPhysical && hasLogical) {
        // Mixed source (rare; not produced by Word). Mirror getTableCellMargins
        // import precedence — physical wins — to decide unchanged vs edited.
        // If the user-visible value still equals the imported physical, leave
        // both pairs untouched. If it was edited, normalize to physical and
        // drop the logical key so the doc emits one pair, not two conflicting.
        const unchanged = twipsToPixels(physicalTwips) === value;
        if (unchanged) return;
        propMargins[physicalKey] = { value: newTwips, type: 'dxa' };
        delete propMargins[logicalKey];
        return;
      }

      if (hasLogical) {
        // Logical-only source: stay logical on export.
        if (logicalTwips !== newTwips) {
          propMargins[logicalKey] = { value: newTwips, type: 'dxa' };
        }
        return;
      }

      // Physical-only source or new cell: default to physical.
      if (physicalTwips !== newTwips) {
        propMargins[physicalKey] = { value: newTwips, type: 'dxa' };
      }
    });
  }

  const { verticalAlign } = attrs;
  if (verticalAlign && verticalAlign !== tableCellProperties.vAlign) {
    tableCellProperties['vAlign'] = verticalAlign;
  } else if (!verticalAlign && tableCellProperties?.vAlign) {
    delete tableCellProperties.vAlign;
  }

  const { rowspan } = attrs;
  if (rowspan && rowspan > 1) {
    tableCellProperties['vMerge'] = 'restart';
  } else if (attrs.continueMerge) {
    tableCellProperties['vMerge'] = 'continue';
  } else {
    delete tableCellProperties.vMerge;
  }

  // Legacy fallback: if tableCellProperties.borders is absent but attrs.borders
  // has non-default values, migrate them on the fly for export (read-only, no node mutation).
  if (!tableCellProperties?.borders && attrs.borders != null) {
    if (!isLegacySchemaDefaultBorders(attrs.borders)) {
      tableCellProperties = {
        ...(tableCellProperties ?? {}),
        borders: convertBordersToOoxmlFormat(attrs.borders),
      };
    }
  }

  const result = tcPrTranslator.decode({ node: { ...node, attrs: { ...node.attrs, tableCellProperties } } });
  return result;
}
