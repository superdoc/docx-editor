import { describe, expect, it } from 'vite-plus/test';
import { reactive } from 'vue';
import {
  cloneV2TrackedChangeStory,
  normalizeTrackedChangeCustomAttributes,
  normalizeTrackedChangeDetailLines,
  normalizeTrackedChangeImagePreview,
  shallowEqual,
  trackedChangeCustomAttributesEqual,
  trackedChangeDetailLinesEqual,
} from './tracked-change-row-values.js';

const ATTRIBUTE = { name: 'w15:x', namespaceUri: 'urn:x', localName: 'x', value: '1' };
const IMAGE_SRC = 'data:image/png;base64,AAAA';

describe('shallowEqual', () => {
  it('compares one level deep with Object.is', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
    expect(shallowEqual({ a: NaN }, { a: NaN })).toBe(true);
    expect(shallowEqual({ a: 0 }, { a: -0 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('compares primitives with Object.is', () => {
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(NaN, NaN)).toBe(true);
    expect(shallowEqual(null, undefined)).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual(1, {})).toBe(false);
  });

  it('compares arrays by index and does not tell arrays from objects', () => {
    expect(shallowEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(shallowEqual(['a'], ['b'])).toBe(false);
    expect(shallowEqual([], {})).toBe(true);
    expect(shallowEqual(['a'], { 0: 'a' })).toBe(true);
  });

  it('compares reactive, null-prototype, and class-instance values by their own keys', () => {
    class TrackedChangeRowValue {
      excerpt = 'old';
      label = 'Deleted';
    }
    const nullPrototype = (values: Record<string, unknown>): Record<string, unknown> =>
      Object.assign(Object.create(null) as Record<string, unknown>, values);

    expect(shallowEqual(reactive({ excerpt: 'old', label: 'Deleted' }), { excerpt: 'old', label: 'Deleted' })).toBe(
      true,
    );
    expect(shallowEqual(reactive({ excerpt: 'old' }), reactive({ excerpt: 'old' }))).toBe(true);
    expect(shallowEqual(nullPrototype({ excerpt: 'old' }), { excerpt: 'old' })).toBe(true);
    expect(shallowEqual(new TrackedChangeRowValue(), { excerpt: 'old', label: 'Deleted' })).toBe(true);

    expect(shallowEqual(reactive({ excerpt: 'old' }), { excerpt: 'new' })).toBe(false);
    expect(shallowEqual(nullPrototype({ excerpt: 'old' }), { excerpt: 'new' })).toBe(false);
    expect(shallowEqual(new TrackedChangeRowValue(), { excerpt: 'old', label: 'Inserted' })).toBe(false);
  });
});

describe('normalizeTrackedChangeDetailLines', () => {
  it('reads non-arrays and empty results as null', () => {
    expect(normalizeTrackedChangeDetailLines(undefined)).toBeNull();
    expect(normalizeTrackedChangeDetailLines({ excerpt: 'a' })).toBeNull();
    expect(normalizeTrackedChangeDetailLines([])).toBeNull();
    expect(normalizeTrackedChangeDetailLines([null, 'x', 3])).toBeNull();
  });

  it('keeps object lines and defaults missing strings to empty', () => {
    expect(
      normalizeTrackedChangeDetailLines([
        { excerpt: 'old', label: 'Deleted', extra: true },
        { excerpt: 5 },
        null,
        ['x'],
      ]),
    ).toEqual([
      { excerpt: 'old', label: 'Deleted' },
      { excerpt: '', label: '' },
      { excerpt: '', label: '' },
    ]);
  });
});

describe('trackedChangeDetailLinesEqual', () => {
  it('compares lines element by element', () => {
    const lines = [{ excerpt: 'a', label: 'b' }];
    expect(trackedChangeDetailLinesEqual(lines, lines)).toBe(true);
    expect(trackedChangeDetailLinesEqual(lines, [{ excerpt: 'a', label: 'b' }])).toBe(true);
    expect(trackedChangeDetailLinesEqual(lines, [{ excerpt: 'a', label: 'c' }])).toBe(false);
    expect(trackedChangeDetailLinesEqual(lines, [...lines, ...lines])).toBe(false);
    expect(trackedChangeDetailLinesEqual(null, null)).toBe(true);
    expect(trackedChangeDetailLinesEqual(null, [])).toBe(false);
    expect(trackedChangeDetailLinesEqual(undefined, null)).toBe(false);
  });
});

describe('normalizeTrackedChangeCustomAttributes', () => {
  it('reads non-arrays as null and keeps an empty array', () => {
    expect(normalizeTrackedChangeCustomAttributes(null)).toBeNull();
    expect(normalizeTrackedChangeCustomAttributes(ATTRIBUTE)).toBeNull();
    expect(normalizeTrackedChangeCustomAttributes([])).toEqual([]);
  });

  it('keeps attributes with a name, namespace and local name', () => {
    expect(
      normalizeTrackedChangeCustomAttributes([
        { ...ATTRIBUTE, extra: true },
        { name: 'a:b', namespaceUri: 'urn:a', localName: 'b' },
        { ...ATTRIBUTE, namespaceUri: '' },
        { ...ATTRIBUTE, localName: 1 },
        null,
        'w15:x',
      ]),
    ).toEqual([ATTRIBUTE, { name: 'a:b', namespaceUri: 'urn:a', localName: 'b', value: '' }]);
  });
});

describe('trackedChangeCustomAttributesEqual', () => {
  it('compares attributes element by element', () => {
    expect(trackedChangeCustomAttributesEqual([ATTRIBUTE], [{ ...ATTRIBUTE }])).toBe(true);
    expect(trackedChangeCustomAttributesEqual([ATTRIBUTE], [{ ...ATTRIBUTE, value: '2' }])).toBe(false);
    expect(trackedChangeCustomAttributesEqual([], [])).toBe(true);
    expect(trackedChangeCustomAttributesEqual(null, [])).toBe(false);
    expect(trackedChangeCustomAttributesEqual(undefined, undefined)).toBe(true);
  });
});

describe('normalizeTrackedChangeImagePreview', () => {
  it('keeps only data image previews', () => {
    expect(normalizeTrackedChangeImagePreview(null)).toBeNull();
    expect(normalizeTrackedChangeImagePreview(IMAGE_SRC)).toBeNull();
    expect(normalizeTrackedChangeImagePreview({ src: 'https://x/a.png' })).toBeNull();
    expect(normalizeTrackedChangeImagePreview({ src: 'data:text/plain,a' })).toBeNull();
  });

  it('keeps valid optional fields and defaults alt text', () => {
    expect(
      normalizeTrackedChangeImagePreview({
        src: IMAGE_SRC,
        contentType: 'image/png',
        role: 'inserted',
        width: 120.5,
        height: 80,
        alt: 'Logo',
        partUri: '/word/media/image1.png',
      }),
    ).toEqual({ src: IMAGE_SRC, contentType: 'image/png', role: 'inserted', width: 120.5, height: 80, alt: 'Logo' });
  });

  it('drops invalid optional fields', () => {
    expect(
      normalizeTrackedChangeImagePreview({
        src: IMAGE_SRC,
        contentType: 'text/plain',
        role: 7,
        width: 0,
        height: Infinity,
        alt: '',
      }),
    ).toEqual({ src: IMAGE_SRC, alt: 'Tracked image preview' });
    expect(normalizeTrackedChangeImagePreview({ src: IMAGE_SRC, role: '', width: -1, height: '80' })).toEqual({
      src: IMAGE_SRC,
      alt: 'Tracked image preview',
    });
  });
});

describe('cloneV2TrackedChangeStory', () => {
  it('reads non-objects as null', () => {
    expect(cloneV2TrackedChangeStory(null)).toBeNull();
    expect(cloneV2TrackedChangeStory('body')).toBeNull();
  });

  it('copies the story and its section without aliasing them', () => {
    const section = { index: 2, kind: 'header' };
    const story = { kind: 'story', storyType: 'headerFooter', section };
    const clone = cloneV2TrackedChangeStory(story);
    expect(clone).toEqual({ kind: 'story', storyType: 'headerFooter', section: { index: 2, kind: 'header' } });
    expect(clone).not.toBe(story);
    expect(clone?.section).not.toBe(section);
    section.index = 3;
    expect(clone?.section).toEqual({ index: 2, kind: 'header' });
  });

  it('keeps a non-object section as is', () => {
    expect(cloneV2TrackedChangeStory({ kind: 'story', section: 'odd' })).toEqual({ kind: 'story', section: 'odd' });
    expect(cloneV2TrackedChangeStory({ kind: 'story', section: null })).toEqual({ kind: 'story', section: null });
  });

  it('unwraps reactive stories and sections', () => {
    const story = reactive({ kind: 'story', storyType: 'footnote', section: { index: 1 } });
    const clone = cloneV2TrackedChangeStory(story);
    expect(clone).toEqual({ kind: 'story', storyType: 'footnote', section: { index: 1 } });
    story.section.index = 9;
    expect(clone?.section).toEqual({ index: 1 });
  });
});
