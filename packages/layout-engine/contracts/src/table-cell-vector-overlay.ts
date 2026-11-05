import type { FlowBlock } from './index.js';

const svgNumber = String.raw`[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?`;
const customLinePath = new RegExp(
  String.raw`^M\s+${svgNumber}\s+${svgNumber}\s+L\s+${svgNumber}\s+${svgNumber}\s*$`,
  'iu',
);

export function isTableCellVectorOverlay(block: FlowBlock): boolean {
  if (
    block.kind !== 'drawing' ||
    block.drawingKind !== 'vectorShape' ||
    block.anchor?.isAnchored !== true ||
    block.wrap?.type !== 'None' ||
    block.textContent?.parts.length
  )
    return false;

  if (block.shapeKind === 'line' || block.shapeKind === 'straightConnector1') return true;
  const paths = block.customGeometry?.paths;
  return paths != null && paths.length > 0 && paths.every((path) => customLinePath.test(path.d));
}
