import { describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, TextRun } from '@superdoc/contracts';
import { hashMeasureContent, MeasureCache } from '../src/cache.js';
import { noteMarkerMeasureKey } from '../src/note-marker-measure-key.js';

const marker = (text: string): TextRun => ({
  kind: 'text',
  text,
  fontFamily: 'Times New Roman',
  fontSize: 8,
  vertAlign: 'superscript',
  dataAttrs: { 'data-v2-note-ref': 'footnote:42' },
});

const noteLabel = (text: string): TextRun => ({
  kind: 'text',
  text,
  fontFamily: 'Times New Roman',
  fontSize: 8,
  vertAlign: 'superscript',
  dataAttrs: {
    'data-sd-footnote-number': 'true',
    'data-v2-note-label': 'footnote:42',
  },
});

const paragraph = (text: string): FlowBlock => ({
  kind: 'paragraph',
  id: 'body-paragraph',
  runs: [marker(text)],
});

describe('note marker measurement identity', () => {
  it('shares a key for equal-length decimal labels when the face has tabular digits', () => {
    const capabilities = { hasTabularDigits: () => true };

    const first = noteMarkerMeasureKey(marker('1000'), capabilities);
    const second = noteMarkerMeasureKey(marker('1001'), capabilities);

    expect(first).toBe(second);
  });

  it('keeps different decimal digit counts distinct', () => {
    const capabilities = { hasTabularDigits: () => true };

    const first = noteMarkerMeasureKey(marker('999'), capabilities);
    const second = noteMarkerMeasureKey(marker('1000'), capabilities);

    expect(first).not.toBe(second);
  });

  it('keeps non-decimal marker labels exact', () => {
    const capabilities = { hasTabularDigits: () => true };

    const first = noteMarkerMeasureKey(marker('iv'), capabilities);
    const second = noteMarkerMeasureKey(marker('vi'), capabilities);

    expect(first).not.toBe(second);
  });

  it('keeps decimal marker labels exact when the face is not tabular', () => {
    const capabilities = { hasTabularDigits: () => false };

    const first = noteMarkerMeasureKey(marker('1000'), capabilities);
    const second = noteMarkerMeasureKey(marker('1001'), capabilities);

    expect(first).not.toBe(second);
  });

  it('keeps decimal marker labels exact without a measured capability plane', () => {
    const first = noteMarkerMeasureKey(marker('1000'));
    const second = noteMarkerMeasureKey(marker('1001'));

    expect(first).not.toBe(second);
  });

  it('shares a key for equal-length synthetic note labels when the face has tabular digits', () => {
    const capabilities = { hasTabularDigits: () => true };

    expect(noteMarkerMeasureKey(noteLabel('1000\u00A0'), capabilities)).toBe(
      noteMarkerMeasureKey(noteLabel('1001\u00A0'), capabilities),
    );
    expect(noteMarkerMeasureKey(noteLabel('999\u00A0'), capabilities)).not.toBe(
      noteMarkerMeasureKey(noteLabel('1000\u00A0'), capabilities),
    );
  });

  it('keeps custom-format synthetic note labels exact', () => {
    const capabilities = { hasTabularDigits: () => true };

    expect(noteMarkerMeasureKey(noteLabel('iv\u00A0'), capabilities)).not.toBe(
      noteMarkerMeasureKey(noteLabel('vi\u00A0'), capabilities),
    );
  });

  it('uses the marker identity in a paragraph measurement hash', () => {
    const capabilities = { hasTabularDigits: () => true };

    expect(hashMeasureContent(paragraph('1000'), capabilities)).toBe(
      hashMeasureContent(paragraph('1001'), capabilities),
    );
    expect(hashMeasureContent(paragraph('1000'))).not.toBe(hashMeasureContent(paragraph('1001')));
  });

  it('uses the marker identity for note references nested in table cells', () => {
    const capabilities = { hasTabularDigits: () => true };
    const table = (text: string): FlowBlock => ({
      kind: 'table',
      id: 'table',
      rows: [
        {
          id: 'row',
          cells: [
            {
              id: 'cell',
              blocks: [{ kind: 'paragraph', id: 'cell-paragraph', runs: [marker(text)] }],
            },
          ],
        },
      ],
    });

    expect(hashMeasureContent(table('1000'), capabilities)).toBe(hashMeasureContent(table('1001'), capabilities));
    expect(hashMeasureContent(table('1000'))).not.toBe(hashMeasureContent(table('1001')));
  });

  it('reuses a measured block across equal-width marker renumbering only with proven capabilities', () => {
    const capabilities = { hasTabularDigits: () => true };
    const cache = new MeasureCache<{ totalHeight: number }>();
    cache.set(paragraph('1000'), 400, 600, { totalHeight: 20 }, 'font-map', capabilities);

    expect(cache.get(paragraph('1001'), 400, 600, 'font-map', capabilities)).toEqual({ totalHeight: 20 });
    expect(cache.get(paragraph('1001'), 400, 600, 'font-map')).toBeUndefined();
  });
});
