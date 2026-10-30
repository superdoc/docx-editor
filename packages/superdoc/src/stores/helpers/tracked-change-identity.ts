import type { BodyStoryLocator } from '@superdoc/document-api';
import { isPlainObject } from '../../helpers/object-guards.js';

type TrackedChangeAnchorParts = { storyKey: string; rawId: string };

export const BODY_TRACKED_CHANGE_STORY: BodyStoryLocator = { kind: 'story', storyType: 'body' };

export const normalizeCommentId = (id: unknown): string | null => (id === undefined || id === null ? null : String(id));

const isNonEmptyString = (value: string | null): value is string => Boolean(value);

const trackedChangeFields = (comment: unknown): Record<string, unknown> | null =>
  isPlainObject(comment) && comment.trackedChange ? comment : null;

export const makeTrackedChangeAnchorKey = ({ storyKey, rawId }: TrackedChangeAnchorParts): string =>
  `tc::${storyKey}::${rawId}`;

export const isBodyTrackedChangeComment = (comment: unknown): boolean => {
  const fields = trackedChangeFields(comment);
  if (!fields) return false;
  const storyType = isPlainObject(fields.trackedChangeStory) ? fields.trackedChangeStory.storyType : undefined;
  if (storyType == null || storyType === 'body') return true;
  const anchorKey = fields.trackedChangeAnchorKey;
  return typeof anchorKey === 'string' && anchorKey.startsWith('tc::body::');
};

export const buildBodyTrackedChangeAnchorKey = (rawId: unknown): string | null => {
  if (rawId === undefined || rawId === null) return null;
  return makeTrackedChangeAnchorKey({ storyKey: 'body', rawId: String(rawId) });
};

export const parseTrackedChangeAnchorKey = (anchorKey: unknown): TrackedChangeAnchorParts | null => {
  const normalized = normalizeCommentId(anchorKey);
  if (!normalized?.startsWith('tc::')) return null;
  const separatorIndex = normalized.indexOf('::', 'tc::'.length);
  if (separatorIndex <= 'tc::'.length) return null;
  const storyKey = normalized.slice('tc::'.length, separatorIndex);
  const rawId = normalized.slice(separatorIndex + 2);
  if (!storyKey || !rawId) return null;
  return { storyKey, rawId };
};

export const buildTrackedChangeAnchorKeyForStory = (storyKey: string | null, rawId: unknown): string | null => {
  if (rawId === undefined || rawId === null) return null;
  return makeTrackedChangeAnchorKey({ storyKey: storyKey || 'body', rawId: String(rawId) });
};

export const normalizeTrackedChangePositionAliases = (aliases: unknown): string[] => {
  if (!Array.isArray(aliases)) return [];
  return [...new Set(aliases.map(normalizeCommentId).filter(isNonEmptyString))];
};

const storyIdKey = (prefix: string, id: unknown): string | null => (id ? `${prefix}:${String(id)}` : null);

export const getTrackedChangeStoryKey = (comment: unknown): string | null => {
  const fields = trackedChangeFields(comment);
  if (!fields) return null;

  const anchorParts = parseTrackedChangeAnchorKey(fields.trackedChangeAnchorKey);
  if (anchorParts) return anchorParts.storyKey;

  const story = fields.trackedChangeStory;
  if (!isPlainObject(story)) return null;
  switch (story.storyType) {
    case 'body':
      return 'body';
    case 'headerFooterPart':
      return storyIdKey('hf', story.refId);
    case 'footnote':
      return storyIdKey('fn', story.noteId);
    case 'endnote':
      return storyIdKey('en', story.noteId);
    case 'textbox':
      return storyIdKey('textbox', story.textboxId);
    default:
      return null;
  }
};

export const normalizeTrackedChangeStoryKey = (storyKey: string | null): string | null => {
  if (storyKey?.startsWith('hf:part:')) return `hf:${storyKey.slice('hf:part:'.length)}`;
  if (storyKey?.startsWith('headerFooterPart:')) return `hf:${storyKey.slice('headerFooterPart:'.length)}`;
  return storyKey;
};

export const trackedChangeStoryKeysAreCompatible = (
  leftStoryKey: string | null,
  rightStoryKey: string | null,
): boolean => {
  const left = normalizeTrackedChangeStoryKey(leftStoryKey);
  const right = normalizeTrackedChangeStoryKey(rightStoryKey);
  return !left || !right || left === right;
};

export const positionEntryMatchesTrackedChangeStory = (entry: unknown, comment: unknown): boolean => {
  const expectedStoryKey = normalizeTrackedChangeStoryKey(getTrackedChangeStoryKey(comment));
  const entryStoryKey = normalizeTrackedChangeStoryKey(
    normalizeCommentId(isPlainObject(entry) ? entry.storyKey : null),
  );
  return trackedChangeStoryKeysAreCompatible(expectedStoryKey, entryStoryKey);
};

export const buildTrackedChangeImportedPositionId = (id: unknown): string | null => {
  const normalizedId = normalizeCommentId(id);
  if (!normalizedId) return null;
  return normalizedId.startsWith('imported:') ? normalizedId : `imported:${normalizedId}`;
};
