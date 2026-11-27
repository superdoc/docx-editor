import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Line, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { clearIncrementalModuleState, incrementalLayout, type IncrementalLayoutResult } from '../src/index.js';

const CHAR_WIDTH = 10;
const LINE_HEIGHT = 10;

const blockText = (block: ParagraphBlock): string =>
  block.runs.map((run) => ('text' in run && typeof run.text === 'string' ? run.text : '')).join('');

const measureRequests: string[] = [];

const measureByText = async (block: FlowBlock, constraints: { maxWidth: number }): Promise<ParagraphMeasure> => {
  if (block.kind !== 'paragraph') throw new Error(`unexpected block kind ${block.kind}`);
  const text = blockText(block);
  if (block.id.startsWith('header')) measureRequests.push(`${block.id} "${text}" at width ${constraints.maxWidth}`);
  const charsPerLine = Math.max(1, Math.floor(constraints.maxWidth / CHAR_WIDTH));
  const length = Math.max(1, text.length);
  const lines: Line[] = Array.from({ length: Math.ceil(length / charsPerLine) }, (_, index) => ({
    fromRun: 0,
    fromChar: index * charsPerLine,
    toRun: 0,
    toChar: Math.min(length, (index + 1) * charsPerLine),
    width: Math.min(charsPerLine, length - index * charsPerLine) * CHAR_WIDTH,
    ascent: 8,
    descent: 2,
    lineHeight: LINE_HEIGHT,
  }));
  return { kind: 'paragraph', lines, totalHeight: lines.length * LINE_HEIGHT };
};

const makeParagraph = (id: string, text: string): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text }],
});

const makeHeaderPageNumber = (): FlowBlock => ({
  kind: 'paragraph',
  id: 'header-page',
  runs: [{ kind: 'text', text: '1', token: 'pageNumber' }],
});

const makeHeading = (id: string, markerText: string): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text: markerText }],
  attrs: { styleId: 'Heading1', wordLayout: { marker: { markerText } } },
});

const makeResolvedHeading = (id: string, markerText: string): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text: markerText }],
  attrs: { styleId: 'Titre1', headingLevel: 1, wordLayout: { marker: { markerText } } },
});

const makeOrdinalHeading = (id: string, ordinal: number): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text: 'Chapter' }],
  attrs: { styleId: 'Titre1', headingLevel: 1, listLevelOrdinal: ordinal },
});

const layoutWithChapterHeader = (heading: FlowBlock) =>
  incrementalLayout(
    [],
    null,
    [heading, makeParagraph('body', 'Body')],
    {
      pageSize: { w: 300, h: 300 },
      margins: { top: 20, right: 20, bottom: 20, left: 20, header: 5 },
      sectionMetadata: [{ sectionIndex: 0, numbering: { chapterStyle: 1, chapterSeparator: 'hyphen' } }],
    },
    measureByText,
    {
      headerBlocks: { default: [makeHeaderPageNumber()] },
      constraints: { width: 40, height: 40 },
    },
  );

const describeHeaderPrelayout = (result: IncrementalLayoutResult): string => {
  const [firstPage] = result.layout.pages;
  const header = result.headers?.find((entry) => entry.type === 'default');
  return [
    'header measure requests',
    ...measureRequests.map((request) => `  ${request}`),
    `final header height ${header?.layout.height}`,
    'page 1 body',
    ...(firstPage?.fragments ?? []).map((fragment) => `  ${fragment.blockId} at y ${fragment.y}`),
    '',
  ].join('\n');
};

describe('header/footer pre-layout', () => {
  beforeEach(() => {
    clearIncrementalModuleState();
    measureRequests.length = 0;
  });

  it('reserves header room for the widest chapter page number before body layout', async () => {
    const result = await layoutWithChapterHeader(makeHeading('heading-1', '123456789.'));
    await expect(describeHeaderPrelayout(result)).toMatchFileSnapshot(
      './__snapshots__/headerFooterPrelayout/style-heading-chapter.txt',
    );
  });

  it('uses adapter-resolved heading levels for conservative chapter pre-layout', async () => {
    const result = await layoutWithChapterHeader(makeResolvedHeading('heading-1', '123456789.'));
    await expect(describeHeaderPrelayout(result)).toMatchFileSnapshot(
      './__snapshots__/headerFooterPrelayout/resolved-heading-level-chapter.txt',
    );
  });

  it('uses heading ordinal fallback for conservative chapter pre-layout', async () => {
    const result = await layoutWithChapterHeader(makeOrdinalHeading('heading-1', 3));
    await expect(describeHeaderPrelayout(result)).toMatchFileSnapshot(
      './__snapshots__/headerFooterPrelayout/heading-ordinal-chapter.txt',
    );
  });

  it('reuses one validated geometry seed without enumerating body blocks or sections', async () => {
    const body = [makeParagraph('body-1', 'Body'), makeParagraph('body-2', 'Tail')];
    const options = {
      pageSize: { w: 300, h: 300 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      sectionMetadata: [{ sectionIndex: 0 }],
    };
    const furniture = {
      headerBlocks: { default: [makeHeaderPageNumber()] },
      footerBlocks: { default: [makeParagraph('footer', 'Footer')] },
      constraints: { width: 40, height: 40 },
      pageCountFieldsExact: false,
    };
    const ownerFingerprint = 'owner:options+furniture';
    const first = await incrementalLayout([], null, body, options, measureByText, furniture, undefined, undefined, {
      headerFooterGeometry: { ownerFingerprint, retainedSeed: null },
    });

    expect(first.headerFooterGeometrySeed).not.toBeNull();
    expect(first.headerFooterGeometrySeed).toMatchObject({
      version: 2,
      sectionMetadataHasChapterNumbering: false,
    });
    expect(first.bridgeTiming.counters).toMatchObject({
      headerFooterPreLayoutReuses: 0,
      headerFooterPreLayoutBodyBlocksEnumerated: 2,
      headerFooterPreLayoutSectionsEnumerated: 1,
    });

    const warmSectionMetadata = new Proxy(options.sectionMetadata, {
      get(target, property, receiver) {
        if (property === 'toJSON') {
          throw new Error('warm geometry validation enumerated section metadata');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const second = await incrementalLayout(
      body,
      first.layout,
      body,
      { ...options, sectionMetadata: warmSectionMetadata },
      measureByText,
      furniture,
      first.measures,
      undefined,
      {
        headerFooterGeometry: {
          ownerFingerprint,
          retainedSeed: first.headerFooterGeometrySeed,
        },
      },
    );

    expect(second.headerFooterGeometryFingerprint).toBe(first.headerFooterGeometryFingerprint);
    expect(second.headerFooterGeometrySeed).toBe(first.headerFooterGeometrySeed);
    expect(second.bridgeTiming.counters).toMatchObject({
      headerFooterPreLayoutReuses: 1,
      headerFooterPreLayoutBodyBlocksEnumerated: 0,
      headerFooterPreLayoutSectionsEnumerated: 0,
    });

    const corruptedSeed = {
      ...first.headerFooterGeometrySeed!,
      geometry: {
        ...first.headerFooterGeometrySeed!.geometry,
        headerContentHeights: { default: -1 },
      },
    };
    const third = await incrementalLayout(
      body,
      first.layout,
      body,
      options,
      measureByText,
      furniture,
      first.measures,
      undefined,
      {
        headerFooterGeometry: {
          ownerFingerprint,
          retainedSeed: corruptedSeed,
        },
      },
    );
    expect(third.bridgeTiming.counters).toMatchObject({
      headerFooterPreLayoutReuses: 0,
      headerFooterPreLayoutBodyBlocksEnumerated: 2,
      headerFooterPreLayoutSectionsEnumerated: 1,
    });
  });
});
