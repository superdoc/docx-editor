import type { ParagraphBatchOperation, SDParagraphProps, SDTabStop, BorderSide } from '@superdoc/document-api';

export type ParagraphPaintOperation = ParagraphBatchOperation;

type ParagraphPaintProperties = Omit<SDParagraphProps, 'tabs'> & { tabs?: Partial<SDTabStop>[] };

const BORDER_SIDES = new Set(['top', 'bottom', 'left', 'right', 'between', 'bar']);

function isBorderSide(side: string): side is BorderSide {
  return BORDER_SIDES.has(side);
}
const TAB_ALIGNMENTS = new Set(['left', 'center', 'right', 'decimal', 'bar', 'clear']);
const TAB_LEADERS = new Set(['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot']);

function colorValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return /^(?:#?[\da-f]{6}|auto)$/i.test(value) ? value.replace(/^#/, '') : undefined;
  if (typeof value !== 'object' || !('model' in value)) return undefined;
  const color = value;
  if (color.model === 'auto') return 'auto';
  return color.model === 'rgb' &&
    'value' in color &&
    typeof color.value === 'string' &&
    /^[\da-f]{6}$/i.test(color.value)
    ? color.value
    : undefined;
}

function hasOnlyKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function captureParagraphPaintOperations(
  props: ParagraphPaintProperties,
  supports: (operationId: ParagraphPaintOperation['operationId']) => boolean = () => true,
): ParagraphPaintOperation[] {
  const operations: ParagraphPaintOperation[] = [];
  if (props.bidi == null) operations.push({ operationId: 'format.paragraph.clearDirection', input: {} });
  else
    operations.push({
      operationId: 'format.paragraph.setDirection',
      input: { direction: props.bidi ? 'rtl' : 'ltr', alignmentPolicy: 'preserve' },
    });
  const alignment = props.alignment;
  if (alignment == null) operations.push({ operationId: 'format.paragraph.clearAlignment', input: {} });
  else if (alignment === 'left' || alignment === 'right' || alignment === 'center' || alignment === 'justify')
    operations.push({ operationId: 'format.paragraph.setAlignment', input: { alignment } });

  const spacing = props.spacing;
  if (!spacing || hasOnlyKeys(spacing, ['before', 'after', 'line', 'lineRule'])) {
    operations.push({ operationId: 'format.paragraph.clearSpacing', input: {} });
    if (spacing && (['before', 'after', 'line', 'lineRule'] as const).some((key) => spacing[key] != null)) {
      const lineRule = spacing.lineRule === 'multiple' ? 'auto' : (spacing.lineRule ?? 'auto');
      operations.push({
        operationId: 'format.paragraph.setSpacing',
        input: {
          ...(spacing.before != null ? { before: Math.round(Number(spacing.before) * 20) } : {}),
          ...(spacing.after != null ? { after: Math.round(Number(spacing.after) * 20) } : {}),
          ...(spacing.line != null
            ? { line: Math.round(Number(spacing.line) * (lineRule === 'auto' ? 240 : 20)) }
            : {}),
          ...(spacing.line != null || spacing.lineRule != null ? { lineRule } : {}),
        },
      });
    }
  }
  const indent = props.indent;
  if (
    !indent ||
    (hasOnlyKeys(indent, ['left', 'right', 'firstLine', 'hanging']) &&
      !(indent.firstLine != null && indent.hanging != null))
  ) {
    operations.push({ operationId: 'format.paragraph.clearIndentation', input: {} });
    if (indent && Object.keys(indent).length)
      operations.push({
        operationId: 'format.paragraph.setIndentation',
        input: Object.fromEntries(
          Object.entries(indent)
            .filter(([, value]) => value != null)
            .map(([key, value]) => [key, Math.round(Number(value) * 20)]),
        ),
      });
  }

  operations.push({
    operationId: 'format.paragraph.setKeepOptions',
    input: {
      keepNext: props.keepWithNext ?? null,
      keepLines: props.keepLines ?? null,
      widowControl: props.widowControl ?? null,
    },
  });
  operations.push({
    operationId: 'format.paragraph.setFlowOptions',
    input: {
      contextualSpacing: props.contextualSpacing ?? null,
      pageBreakBefore: props.pageBreakBefore ?? null,
    },
  });
  operations.push({
    operationId: 'format.paragraph.setOutlineLevel',
    input: { outlineLevel: props.outlineLevel ?? null },
  });

  const borders = props.borders;
  if (
    !borders ||
    Object.entries(borders).every(
      ([side, border]) =>
        BORDER_SIDES.has(side) &&
        hasOnlyKeys(border, ['style', 'color', 'width', 'space']) &&
        typeof border.style === 'string' &&
        (border.color == null || colorValue(border.color) !== undefined),
    )
  ) {
    operations.push({ operationId: 'format.paragraph.clearBorder', input: { side: 'all' } });
    for (const side of Object.keys(borders ?? {})) {
      if (!isBorderSide(side)) continue;
      const border = borders?.[side];
      if (!border || typeof border.style !== 'string') continue;
      operations.push({
        operationId: 'format.paragraph.setBorder',
        input: {
          side,
          style: border.style,
          ...(border.color != null ? { color: colorValue(border.color) } : {}),
          ...(border.width != null ? { size: Math.round(Number(border.width) * 8) } : {}),
          ...(border.space != null ? { space: border.space } : {}),
        },
      });
    }
  }
  const shading = props.shading;
  if (
    !shading ||
    (hasOnlyKeys(shading, ['fill', 'color', 'pattern']) &&
      (['fill', 'color'] as const).every((key) => shading[key] == null || colorValue(shading[key]) !== undefined))
  ) {
    operations.push({ operationId: 'format.paragraph.clearShading', input: {} });
    if (shading && Object.keys(shading).length)
      operations.push({
        operationId: 'format.paragraph.setShading',
        input: {
          ...(shading.fill != null ? { fill: colorValue(shading.fill) } : {}),
          ...(shading.color != null ? { color: colorValue(shading.color) } : {}),
          ...(shading.pattern != null ? { pattern: shading.pattern } : {}),
        },
      });
  }
  const tabs = props.tabs;
  if (
    !tabs ||
    tabs.every(
      (tab) =>
        hasOnlyKeys(tab, ['kind', 'position', 'alignment', 'leader']) &&
        (tab.kind === 'clear' || TAB_ALIGNMENTS.has(String(tab.alignment ?? 'left'))) &&
        (tab.leader == null || TAB_LEADERS.has(String(tab.leader))),
    )
  ) {
    operations.push({ operationId: 'format.paragraph.clearAllTabStops', input: {} });
    for (const tab of tabs ?? []) {
      const alignment = tab.kind === 'clear' ? 'clear' : (tab.alignment ?? 'left');
      const leader = tab.leader;
      if (alignment === 'num' || leader === 'line') continue;
      operations.push({
        operationId: 'format.paragraph.setTabStop',
        input: {
          position: Math.round(Number(tab.position) * 20),
          alignment,
          ...(leader != null ? { leader } : {}),
        },
      });
    }
  }
  const replacementGroups = [
    ['clearSpacing', 'setSpacing'],
    ['clearIndentation', 'setIndentation'],
    ['clearBorder', 'setBorder'],
    ['clearShading', 'setShading'],
    ['clearAllTabStops', 'setTabStop'],
  ].map((group) => group.map((name) => `format.paragraph.${name}`));
  const unavailable = new Set(
    replacementGroups
      .filter((group) => operations.some((entry) => group.includes(entry.operationId) && !supports(entry.operationId)))
      .flat(),
  );
  return operations.filter((entry) => supports(entry.operationId) && !unavailable.has(entry.operationId));
}
