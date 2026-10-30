import { toRaw } from 'vue';
import type { TrackChangeCustomAttribute } from '@superdoc/document-api';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import { isPlainObject } from '../../helpers/object-guards.js';

type IndexableObject = Readonly<Record<string, unknown>>;

type TrackedChangeDetailLine = { excerpt: string; label: string };

type TrackedChangeRowImagePreview = {
  src: string;
  contentType?: string;
  role?: string;
  width?: number;
  height?: number;
  alt: string;
};

const isObjectOrArray = (value: unknown): value is IndexableObject => isPlainObject(value) || Array.isArray(value);

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

export const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!isObjectOrArray(a) || !isObjectOrArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
};

const elementsShallowEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((element, index) => shallowEqual(element, b[index]));
};

export const normalizeTrackedChangeDetailLines = (lines: unknown): TrackedChangeDetailLine[] | null => {
  if (!Array.isArray(lines)) return null;
  const normalized = lines.filter(isObjectOrArray).map((line) => ({
    excerpt: stringOrEmpty(line.excerpt),
    label: stringOrEmpty(line.label),
  }));
  return normalized.length > 0 ? normalized : null;
};

export const trackedChangeDetailLinesEqual = elementsShallowEqual;

export const normalizeTrackedChangeCustomAttributes = (attributes: unknown): TrackChangeCustomAttribute[] | null => {
  if (!Array.isArray(attributes)) return null;
  return attributes
    .filter(isObjectOrArray)
    .map((attribute) => ({
      name: stringOrEmpty(attribute.name),
      namespaceUri: stringOrEmpty(attribute.namespaceUri),
      localName: stringOrEmpty(attribute.localName),
      value: stringOrEmpty(attribute.value),
    }))
    .filter((attribute) => attribute.name && attribute.namespaceUri && attribute.localName);
};

export const trackedChangeCustomAttributesEqual = elementsShallowEqual;

const positiveDimension = (value: unknown): number | null => (isFiniteNumber(value) && value > 0 ? value : null);

export const normalizeTrackedChangeImagePreview = (preview: unknown): TrackedChangeRowImagePreview | null => {
  if (!isObjectOrArray(preview)) return null;
  const src = typeof preview.src === 'string' ? preview.src : null;
  if (!src || !src.startsWith('data:image/')) return null;
  const contentType =
    typeof preview.contentType === 'string' && preview.contentType.startsWith('image/') ? preview.contentType : null;
  const role = typeof preview.role === 'string' ? preview.role : null;
  const width = positiveDimension(preview.width);
  const height = positiveDimension(preview.height);
  const alt = typeof preview.alt === 'string' && preview.alt.length > 0 ? preview.alt : 'Tracked image preview';
  return {
    src,
    ...(contentType ? { contentType } : {}),
    ...(role ? { role } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    alt,
  };
};

export const cloneV2TrackedChangeStory = (story: unknown): Record<string, unknown> | null => {
  if (!isObjectOrArray(story)) return null;
  const rawStory = toRaw(story);
  return {
    ...rawStory,
    ...(isObjectOrArray(rawStory.section) ? { section: { ...toRaw(rawStory.section) } } : {}),
  };
};
