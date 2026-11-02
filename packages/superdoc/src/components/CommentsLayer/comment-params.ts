import type { TrackChangeCustomAttribute, TrackChangeImagePreview } from '@superdoc/document-api';
import type { StoryLocator } from '../../core/types/index.js';

export type TrackedChangeDecision = 'accept' | 'reject';

export type SelectionBounds = { top: number; left: number; right: number; bottom: number };

export type CommentMention = { name?: string | null; email?: string | null };

export type CommentAuthor = { name?: string | null; email?: string | null };

export type TrackedChangeDetailLine = { excerpt: string; label: string };

export type CommentSelectionParams = {
  documentId?: string | null;
  page?: number;
  selectionBounds?: Partial<SelectionBounds> | null;
  source?: string | null;
};

export type CommentIdentity = {
  commentId?: string;
  importedId?: string | null;
  parentCommentId?: string | null;
  trackedChangeParentId?: string | null;
  trackedChangeThreadParentId?: string | null;
  threadingParentCommentId?: string | null;
};

export type CommentInputParams = CommentIdentity & {
  uid?: string;
  trackedChangeSide?: string | null;
  fileId?: string | null;
  fileType?: string | null;
  createdAtVersionNumber?: number | null;
  isInternal?: boolean;
  mentions?: CommentMention[];
  isFocused?: boolean;
  creatorId?: string | null;
  creatorEmail?: string | null;
  creatorName?: string | null;
  creatorImage?: string | null;
  createdTime?: number;
  importedAuthor?: CommentAuthor | null;
  docxCommentJSON?: unknown;
  commentText?: string;
  selection?: CommentSelectionParams;
  trackedChange?: boolean;
  trackedChangeType?: string | null;
  trackedChangeText?: string | null;
  trackedChangeDisplayType?: string | null;
  semanticColorKey?: string | null;
  semanticColor?: string | null;
  trackedChangeStory?: StoryLocator | null;
  trackedChangeStoryKind?: string | null;
  trackedChangeStoryLabel?: string;
  trackedChangeAnchorKey?: string | null;
  trackedChangeCanonicalId?: string | null;
  trackedChangePositionAliases?: string[];
  deletedText?: string | null;
  trackedChangeLabel?: string | null;
  trackedChangeDetailLines?: TrackedChangeDetailLine[] | null;
  trackedChangeImagePreview?: TrackChangeImagePreview | null;
  customAttributes?: readonly TrackChangeCustomAttribute[] | null;
  resolvedTime?: number | null;
  resolvedById?: string | null;
  resolvedByEmail?: string | null;
  resolvedByName?: string | null;
  trackedChangeDecision?: TrackedChangeDecision | null;
};
