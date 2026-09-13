import type { FlowBlock, ImageBlock, ParagraphBlock, Run, SdtMetadata, SectionBreakBlock } from '@superdoc/contracts';

export type PMNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
};

export type AdapterOptions = {
  emitSectionBreaks?: boolean;
  blockIdPrefix?: string;
  converterContext?: unknown;
};

export type FlowBlocksResult = {
  blocks: FlowBlock[];
  bookmarks: Map<string, number>;
};

const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_FONT_SIZE = 12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

const pixelsFromTwips = (value: unknown): number | undefined => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.round((numeric / 1440) * 96) : undefined;
};

const structuredContentMetadata = (attrs: Record<string, unknown>, scope: 'inline' | 'block'): SdtMetadata => ({
  type: 'structuredContent',
  scope,
  id: asString(attrs.id),
  tag: asString(attrs.tag),
  alias: asString(attrs.alias) ?? asString(asRecord(attrs.sdtPr).alias),
});

const documentSectionMetadata = (attrs: Record<string, unknown>): SdtMetadata => ({
  type: 'documentSection',
  id: asString(attrs.id),
  title: asString(attrs.title),
  description: asString(attrs.description),
  sectionType: asString(attrs.sectionType),
  isLocked: asBoolean(attrs.isLocked),
});

const docPartObjectMetadata = (attrs: Record<string, unknown>): SdtMetadata => ({
  type: 'docPartObject',
  gallery: asString(attrs.docPartGallery) ?? asString(attrs.gallery),
  uniqueId: asString(attrs.id) ?? asString(attrs.uniqueId),
  instruction: asString(attrs.instruction),
});

const fieldAnnotationMetadata = (attrs: Record<string, unknown>): SdtMetadata => ({
  type: 'fieldAnnotation',
  variant: asString(attrs.type) ?? 'text',
  fieldId: asString(attrs.fieldId),
  fieldType: asString(attrs.fieldType),
  displayLabel: asString(attrs.displayLabel),
  defaultDisplayLabel: asString(attrs.defaultDisplayLabel),
  fieldColor: asString(attrs.fieldColor),
  fontFamily: asString(attrs.fontFamily),
  fontSize: attrs.fontSize,
  hash: asString(attrs.hash),
  sdtId: asString(attrs.sdtId),
  hidden: asBoolean(attrs.hidden) ?? false,
  highlighted: asBoolean(attrs.highlighted) ?? true,
  isLocked: asBoolean(attrs.isLocked) ?? false,
  visibility: asString(attrs.visibility) ?? (attrs.hidden === true ? 'hidden' : 'visible'),
});

const textRun = (text: string, sdt?: SdtMetadata): Run => ({
  kind: 'text',
  text,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  ...(sdt ? { sdt } : {}),
});

const tokenRun = (token: 'pageNumber' | 'totalPageCount', sdt?: SdtMetadata): Run => ({
  kind: 'text',
  text: '0',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  token,
  ...(sdt ? { sdt } : {}),
});

const fieldRun = (attrs: Record<string, unknown>): Run => {
  const sdt = fieldAnnotationMetadata(attrs);
  return {
    kind: 'text',
    text: asString(attrs.displayLabel) ?? '',
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: DEFAULT_FONT_SIZE,
    sdt,
  };
};

const collectInlineRuns = (nodes: PMNode[] | undefined, inheritedSdt?: SdtMetadata): Run[] => {
  const runs: Run[] = [];

  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      runs.push(textRun(node.text ?? '', inheritedSdt));
      continue;
    }

    if (node.type === 'page-number') {
      runs.push(tokenRun('pageNumber', inheritedSdt));
      continue;
    }

    if (node.type === 'total-page-number') {
      runs.push(tokenRun('totalPageCount', inheritedSdt));
      continue;
    }

    if (node.type === 'run') {
      runs.push(...collectInlineRuns(node.content, inheritedSdt));
      continue;
    }

    if (node.type === 'structuredContent') {
      runs.push(...collectInlineRuns(node.content, structuredContentMetadata(asRecord(node.attrs), 'inline')));
      continue;
    }

    if (node.type === 'fieldAnnotation') {
      runs.push(fieldRun(asRecord(node.attrs)));
    }
  }

  return runs.length > 0 ? runs : [textRun('', inheritedSdt)];
};

const elementAttrs = (element: Record<string, unknown>): Record<string, unknown> => asRecord(element.attributes);

/**
 * Word ST_OnOff: a bare `<w:bidi/>` means ON, and only the explicit falsy spellings turn it off
 * (ECMA-376 §22.9.2.7). Mirrors `parseOnOff` in the style engine.
 */
const ST_OFF = new Set(['0', 'false', 'off']);
const readOnOff = (attrs: Record<string, unknown>): boolean => {
  const raw = asString(attrs['w:val']);
  return raw == null ? true : !ST_OFF.has(raw.trim().toLowerCase());
};

const readSectPr = (sectPr: unknown): Partial<SectionBreakBlock> => {
  const elements = Array.isArray(asRecord(sectPr).elements)
    ? (asRecord(sectPr).elements as Record<string, unknown>[])
    : [];
  const out: Partial<SectionBreakBlock> = {};
  // `w:bidi` and `w:cols` are siblings in any order, so the direction is collected here and applied
  // to the column layout after the loop.
  let pageIsRtl = false;

  for (const element of elements) {
    const name = asString(element.name);
    const attrs = elementAttrs(element);

    if (name === 'w:type') {
      out.type = asString(attrs['w:val']) as SectionBreakBlock['type'];
      continue;
    }

    if (name === 'w:pgSz') {
      const w = pixelsFromTwips(attrs['w:w']);
      const h = pixelsFromTwips(attrs['w:h']);
      if (w != null && h != null) out.pageSize = { w, h };
      out.orientation = asString(attrs['w:orient']) as SectionBreakBlock['orientation'];
      continue;
    }

    if (name === 'w:pgMar') {
      out.margins = {
        top: pixelsFromTwips(attrs['w:top']),
        right: pixelsFromTwips(attrs['w:right']),
        bottom: pixelsFromTwips(attrs['w:bottom']),
        left: pixelsFromTwips(attrs['w:left']),
        header: pixelsFromTwips(attrs['w:header']),
        footer: pixelsFromTwips(attrs['w:footer']),
      };
      continue;
    }

    if (name === 'w:cols') {
      const count = Number(attrs['w:num']);
      out.columns = {
        count: Number.isFinite(count) && count > 0 ? count : 1,
        gap: pixelsFromTwips(attrs['w:space']) ?? 0,
      };
      continue;
    }

    if (name === 'w:bidi') {
      pageIsRtl = readOnOff(attrs);
      continue;
    }

    if (name === 'w:vAlign') {
      out.vAlign = asString(attrs['w:val']) as SectionBreakBlock['vAlign'];
      continue;
    }

    if (name === 'w:headerReference') {
      out.headerRefs = { ...(out.headerRefs ?? {}), [asString(attrs['w:type']) ?? 'default']: asString(attrs['r:id']) };
      continue;
    }

    if (name === 'w:footerReference') {
      out.footerRefs = { ...(out.footerRefs ?? {}), [asString(attrs['w:type']) ?? 'default']: asString(attrs['r:id']) };
    }
  }

  // Section `w:bidi` governs section-level chrome, and on the column axis it decides which side the
  // FIRST column sits on (ECMA-376 §17.6.1). Only applied when the section actually declares
  // columns: absent `w:cols` means a single column, which has no order to flip, and synthesising a
  // layout here would make an unstyled section look like it carries explicit column properties.
  if (pageIsRtl && out.columns) {
    out.columns = { ...out.columns, direction: 'rtl' };
  }

  return out;
};

const sectionBreakFromSectPr = (
  id: string,
  sectPr: unknown,
  attrs?: SectionBreakBlock['attrs'],
): SectionBreakBlock => ({
  kind: 'sectionBreak',
  id,
  margins: {},
  ...readSectPr(sectPr),
  attrs: {
    source: 'sectPr',
    ...(attrs ?? {}),
  },
});

type DocumentSection = {
  nodes: PMNode[];
  sectPr?: unknown;
};

const paragraphSectPr = (node: PMNode): unknown => asRecord(asRecord(node.attrs).paragraphProperties).sectPr;

const documentSectPr = (node: PMNode): unknown => asRecord(node.attrs).bodySectPr ?? asRecord(node.attrs).sectPr;

const splitDocumentSections = (node: PMNode): DocumentSection[] => {
  const sections: DocumentSection[] = [];
  let currentNodes: PMNode[] = [];

  for (const child of node.content ?? []) {
    currentNodes.push(child);

    const sectPr = child.type === 'paragraph' ? paragraphSectPr(child) : undefined;
    if (sectPr) {
      sections.push({ nodes: currentNodes, sectPr });
      currentNodes = [];
    }
  }

  if (currentNodes.length > 0 || sections.length === 0) {
    sections.push({
      nodes: currentNodes,
      sectPr: documentSectPr(node),
    });
  } else {
    const bodySectPr = documentSectPr(node);
    if (bodySectPr) {
      sections.push({ nodes: [], sectPr: bodySectPr });
    }
  }

  return sections;
};

const samePageSize = (left: SectionBreakBlock['pageSize'], right: SectionBreakBlock['pageSize']): boolean =>
  left?.w === right?.w && left?.h === right?.h;

const requiresPageBoundary = (
  previous: Partial<SectionBreakBlock>,
  current: Partial<SectionBreakBlock>,
  boundaryType: SectionBreakBlock['type'] | undefined,
): boolean => {
  if (boundaryType !== 'continuous') return false;
  const previousForcesBoundary =
    previous.type === 'nextPage' || previous.type === 'evenPage' || previous.type === 'oddPage';
  return (
    previousForcesBoundary ||
    previous.orientation !== current.orientation ||
    !samePageSize(previous.pageSize, current.pageSize)
  );
};

const resolveBoundaryType = (
  previous: Partial<SectionBreakBlock>,
  current: Partial<SectionBreakBlock>,
): SectionBreakBlock['type'] | undefined => {
  if (current.type) return current.type;
  if (previous.type) return previous.type;
  return current.type;
};

const paragraphBlock = (
  id: string,
  node: PMNode,
  inheritedSdt?: SdtMetadata,
  attrs?: ParagraphBlock['attrs'],
): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: collectInlineRuns(node.content, undefined),
  attrs: {
    ...asRecord(node.attrs),
    ...(attrs ?? {}),
    ...(inheritedSdt ? { sdt: inheritedSdt } : {}),
  },
});

export function toFlowBlocks(input: PMNode | object, options: AdapterOptions = {}): FlowBlocksResult {
  const root = input as PMNode;
  const blocks: FlowBlock[] = [];
  const bookmarks = new Map<string, number>();
  const blockIdPrefix = options.blockIdPrefix ?? '';
  let paragraphIndex = 0;
  let sectionIndex = 0;

  const nextParagraphId = (): string => `${blockIdPrefix}${paragraphIndex++}-paragraph`;
  const nextSectionBreakId = (): string => `${blockIdPrefix}section-break-${++sectionIndex}`;

  const appendParagraph = (node: PMNode, inheritedSdt?: SdtMetadata, attrs?: ParagraphBlock['attrs']): void => {
    blocks.push(paragraphBlock(nextParagraphId(), node, inheritedSdt, attrs));
  };

  const appendSectionBreak = (
    sectPr: unknown,
    sectionOrdinal: number,
    boundaryType?: SectionBreakBlock['type'],
    attrs?: SectionBreakBlock['attrs'],
  ): void => {
    if (!sectPr) return;

    const block = sectionBreakFromSectPr(nextSectionBreakId(), sectPr, {
      sectionIndex: sectionOrdinal,
      ...(sectionOrdinal === 0 ? { isFirstSection: true } : {}),
      ...(attrs ?? {}),
    });

    if (boundaryType) {
      block.type = boundaryType;
    }

    blocks.push(block);
  };

  const appendDocument = (node: PMNode, inheritedSdt?: SdtMetadata): void => {
    if (!options.emitSectionBreaks) {
      for (const child of node.content ?? []) visit(child, inheritedSdt);
      return;
    }

    const sections = splitDocumentSections(node);

    sections.forEach((section, index) => {
      const previousSectPr = index > 0 ? sections[index - 1]?.sectPr : undefined;
      const previousProps = readSectPr(previousSectPr);
      const currentProps = readSectPr(section.sectPr);
      const boundaryType = resolveBoundaryType(previousProps, currentProps);
      appendSectionBreak(section.sectPr, index, boundaryType, {
        ...(index > 0 && requiresPageBoundary(previousProps, currentProps, boundaryType)
          ? { requirePageBoundary: true }
          : {}),
      });

      for (const child of section.nodes) {
        visit(child, inheritedSdt);
      }
    });
  };

  const visit = (node: PMNode, inheritedSdt?: SdtMetadata): void => {
    switch (node.type) {
      case 'doc':
        appendDocument(node, inheritedSdt);
        break;
      case 'paragraph':
        appendParagraph(node, inheritedSdt);
        break;
      case 'structuredContentBlock':
        for (const child of node.content ?? []) {
          visit(child, inheritedSdt ?? structuredContentMetadata(asRecord(node.attrs), 'block'));
        }
        break;
      case 'documentSection':
        for (const child of node.content ?? []) {
          visit(child, documentSectionMetadata(asRecord(node.attrs)));
        }
        break;
      case 'documentPartObject': {
        const docPart = docPartObjectMetadata(asRecord(node.attrs));
        for (const child of node.content ?? []) {
          if (child.type === 'paragraph') {
            appendParagraph(child, docPart, {
              sdt: docPart,
              ...(inheritedSdt ? { containerSdt: inheritedSdt } : {}),
              isTocEntry: true,
              tocInstruction: asString(asRecord(node.attrs).instruction),
              tocId: asString(asRecord(node.attrs).id),
            });
          } else {
            visit(child, docPart);
          }
        }
        break;
      }
      case 'image': {
        const size = asRecord(asRecord(node.attrs).size);
        const image: ImageBlock = {
          kind: 'image',
          id: `${blockIdPrefix}${paragraphIndex++}-image`,
          src: asString(asRecord(node.attrs).src) ?? '',
          width: typeof size.width === 'number' ? size.width : undefined,
          height: typeof size.height === 'number' ? size.height : undefined,
          attrs: inheritedSdt ? { sdt: inheritedSdt } : undefined,
        };
        blocks.push(image);
        break;
      }
      default:
        for (const child of node.content ?? []) visit(child, inheritedSdt);
        break;
    }
  };

  visit(root);

  return { blocks, bookmarks };
}
