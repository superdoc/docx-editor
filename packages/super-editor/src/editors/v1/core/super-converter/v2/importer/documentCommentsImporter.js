import { readPeoplePart, importedWordIdentity, captureCommentAuthorSource } from '../../comment-author-identity.js';
import { v4 as uuidv4 } from 'uuid';
import { defaultNodeListHandler } from './docxImporter';
import { stableHexHash } from '@core/utilities/hash.js';

/**
 * Parse comments.xml into SuperDoc-ready comments
 * These will be available in converter.comments
 *
 * @param {Object} param0
 * @param {ParsedDocx} param0.docx The parsed docx object
 * @param {NodeListHandler} param0.nodeListHandler The node list handler
 * @param {SuperConverter} param0.converter The super converter instance
 * @param {Editor} param0.editor The editor instance
 * @returns {Array} The parsed comments
 */
export function importCommentData({ docx, editor, converter }) {
  const nodeListHandler = defaultNodeListHandler();
  const comments = docx['word/comments.xml'];
  if (!comments) return;

  const commentThreadingProfile = converter?.commentThreadingProfile || {
    defaultStyle: docx['word/commentsExtended.xml'] ? 'commentsExtended' : 'range-based',
    mixed: false,
    fileSet: {
      hasCommentsExtended: !!docx['word/commentsExtended.xml'],
      hasCommentsExtensible: !!docx['word/commentsExtensible.xml'],
      hasCommentsIds: !!docx['word/commentsIds.xml'],
    },
  };

  const people = readPeoplePart(docx).people;
  const { elements } = comments;
  if (!elements || !elements.length) return;

  const { elements: allComments = [] } = elements[0];
  const extractedComments = allComments.map((el) => {
    const { attributes } = el;
    const importedId = attributes['w:id'];
    const authorName = readCommentAttribute(attributes, 'w:author', 'custom:author');
    const authorEmail = readCommentAttribute(attributes, 'w:email', 'custom:email');
    const initials = readCommentAttribute(attributes, 'w:initials', 'custom:initials');
    const createdDate = attributes['w:date'];
    const internalId = attributes['custom:internalId'];
    const trackedChange = attributes['custom:trackedChange'] === 'true';
    const trackedChangeType = attributes['custom:trackedChangeType'];
    const trackedChangeText =
      attributes['custom:trackedChangeText'] !== 'null' ? attributes['custom:trackedChangeText'] : null;
    const trackedChangeDisplayType =
      attributes['custom:trackedChangeDisplayType'] !== 'null' ? attributes['custom:trackedChangeDisplayType'] : null;
    const trackedDeletedText =
      attributes['custom:trackedDeletedText'] !== 'null' ? attributes['custom:trackedDeletedText'] : null;

    const date = new Date(createdDate);
    const unixTimestampMs = date.getTime();

    const parsedElements = nodeListHandler.handler({
      nodes: el.elements,
      nodeListHandler,
      docx,
      editor,
      converter,
      path: [el],
    });

    // Per OOXML spec, commentsExtended.xml links via the LAST paragraph's paraId
    // when a comment has multiple paragraphs
    const textElements = Array.isArray(parsedElements) ? parsedElements : parsedElements ? [parsedElements] : [];
    const lastElement = textElements[textElements.length - 1];
    const paraId = lastElement?.attrs?.['w14:paraId'];

    const threadingMethod = commentThreadingProfile.defaultStyle;
    const commentId = getCommentId(internalId, importedId, unixTimestampMs);

    return {
      commentId,
      importedId,
      creatorName: authorName,
      wordAuthorName: authorName,
      creatorIdentity: importedWordIdentity(people, authorName),
      creatorEmail: authorEmail,
      createdTime: unixTimestampMs,
      elements: textElements,
      initials,
      paraId,
      trackedChange,
      trackedChangeText,
      trackedChangeType,
      trackedChangeDisplayType,
      trackedDeletedText,
      isDone: false,
      origin: converter?.documentOrigin || 'word',
      threadingMethod,
      threadingStyleOverride: undefined,
      originalXmlStructure: {
        ...commentThreadingProfile.fileSet,
      },
    };
  });

  const extendedComments = generateCommentsWithExtendedData({
    docx,
    comments: extractedComments,
    converter,
    threadingProfile: commentThreadingProfile,
  });

  if (converter) {
    converter.commentAuthorSource = captureCommentAuthorSource(docx, extendedComments, converter.commentAuthorSource);
    const hasOverride = extendedComments.some(
      (comment) =>
        comment.threadingStyleOverride && comment.threadingStyleOverride !== commentThreadingProfile.defaultStyle,
    );
    converter.commentThreadingProfile = {
      ...commentThreadingProfile,
      mixed: hasOverride || commentThreadingProfile.mixed,
    };
  }
  return extendedComments;
}

const readCommentAttribute = (attributes, primaryName, fallbackName) => {
  if (!attributes) return undefined;
  return attributes[primaryName] ?? attributes[fallbackName];
};

/**
 * Import the commentsExtended.xml file to get the extended comment details
 * Note: This is where parent/child comment relationships are defined
 *
 * @param {Object} param0
 * @param {ParsedDocx} param0.docx The parsed docx object
 * @param {Array} param0.comments The comments to be extended
 * @param {SuperConverter} param0.converter The super converter instance
 * @returns {Array} The comments with extended details
 */
const generateCommentsWithExtendedData = ({ docx, comments, converter, threadingProfile }) => {
  if (!comments?.length) return [];

  const rangeData = extractCommentRangesFromDocument(docx, converter);
  const { commentsInTrackedChanges } = rangeData;
  const trackedChangeParentMap = detectThreadingFromTrackedChanges(comments, commentsInTrackedChanges);
  const rangeThreadedComments = detectThreadingFromRanges(comments, {
    ...rangeData,
    commentsInTrackedChanges: new Map(),
  });
  const commentIdSet = new Set(comments.map((comment) => comment.commentId));
  const rangeParentMap = new Map();
  rangeThreadedComments.forEach((comment) => {
    if (comment.parentCommentId && commentIdSet.has(comment.parentCommentId)) {
      rangeParentMap.set(comment.commentId, comment.parentCommentId);
    }
  });

  const commentsExtended = docx['word/commentsExtended.xml'];
  if (!commentsExtended) {
    const commentsWithThreading = detectThreadingFromRanges(comments, rangeData);
    return commentsWithThreading.map((comment) => ({
      ...comment,
      isDone: comment.isDone ?? false,
    }));
  }

  const { elements: initialElements = [] } = commentsExtended;
  if (!initialElements?.length) return comments.map((comment) => ({ ...comment, isDone: comment.isDone ?? false }));

  const { elements = [] } = initialElements[0] ?? {};

  const commentEx = elements.filter((el) => el.name === 'w15:commentEx');

  return comments.map((comment) => {
    const extendedDef = commentEx.find((ce) => {
      return comment.elements?.some((el) => el.attrs?.['w14:paraId'] === ce.attributes['w15:paraId']);
    });

    let isDone = comment.isDone ?? false;
    let parentCommentId = undefined;
    let threadingParentCommentId = undefined;
    let threadingStyleOverride = undefined;

    const trackedChangeParent = trackedChangeParentMap.get(comment.importedId);
    const isInsideTrackedChange = trackedChangeParent?.isTrackedChangeParent;

    // Track whether comment has an entry in commentsExtended.xml
    // If it has an entry but no paraIdParent, it's explicitly a top-level comment
    // and we should NOT use range-based parenting as a fallback
    const hasExtendedEntry = !!extendedDef;

    if (extendedDef) {
      const details = getExtendedDetails(extendedDef);
      isDone = details.isDone ?? false;

      if (details.paraIdParent) {
        const parentComment = comments.find(
          (c) =>
            c.paraId === details.paraIdParent ||
            c.elements?.some((el) => el.attrs?.['w14:paraId'] === details.paraIdParent),
        );
        const rangeParent = rangeParentMap.get(comment.commentId);
        if (parentComment?.trackedChange) {
          // Parent is a tracked change - use range parent if available, otherwise leave parentCommentId undefined
          // (TC association is tracked separately via trackedChangeParentId, not parentCommentId)
          if (rangeParent) {
            threadingParentCommentId = rangeParent;
            parentCommentId = threadingParentCommentId;
          }
          // If no rangeParent, we intentionally leave parentCommentId undefined
          // so the comment appears as a separate bubble from the TC
        } else {
          // Parent is a real comment (not a TC) - use it for threading
          threadingParentCommentId = parentComment?.commentId;
          parentCommentId = threadingParentCommentId;
        }
      }
    }

    const trackedChangeParentId = isInsideTrackedChange ? trackedChangeParent.trackedChangeId : undefined;

    // Only use range-based parenting as fallback when:
    // 1. parentCommentId is not set from commentsExtended.xml, AND
    // 2. The comment has NO entry in commentsExtended.xml at all
    // If a comment has an entry in commentsExtended.xml but no paraIdParent,
    // it's explicitly a top-level comment - don't override with range-based parenting
    if (!parentCommentId && !hasExtendedEntry && rangeParentMap.has(comment.commentId)) {
      parentCommentId = rangeParentMap.get(comment.commentId);
      if (threadingProfile?.defaultStyle === 'commentsExtended') {
        threadingStyleOverride = 'range-based';
      }
    }

    return {
      ...comment,
      isDone,
      parentCommentId,
      threadingStyleOverride,
      threadingParentCommentId,
      trackedChangeParentId,
    };
  });
};

/**
 * Extract the details from the commentExtended node
 *
 * @param {Object} commentEx The commentExtended node from commentsExtended.xml
 * @returns {Object} Object containing paraId, isDone and paraIdParent
 */
const getExtendedDetails = (commentEx) => {
  const { attributes } = commentEx;
  const paraId = attributes['w15:paraId'];
  const isDone = attributes['w15:done'] === '1' ? true : false;
  const paraIdParent = attributes['w15:paraIdParent'];
  return { paraId, isDone, paraIdParent };
};

/**
 * Extracts comment range information from document.xml by walking the XML tree
 * and identifying comment range markers and their positions.
 *
 * @param {ParsedDocx} docx The parsed docx object containing document.xml
 * @param {SuperConverter} converter The super converter instance
 * @returns {Object} Object containing:
 *   - rangeEvents: Array of {type: 'start'|'end', commentId} events
 *   - rangePositions: Map of comment ID → {startIndex: number, endIndex: number}
 *   - commentsInTrackedChanges: Map of comment ID → tracked change ID
 */
const extractCommentRangesFromDocument = (docx, converter) => {
  const documentXml = docx['word/document.xml'];
  if (!documentXml) {
    return { rangeEvents: [], rangePositions: new Map(), commentsInTrackedChanges: new Map() };
  }

  const rangeEvents = [];
  const rangePositions = new Map();
  const commentsInTrackedChanges = new Map();
  let positionIndex = 0;
  let lastElementWasCommentMarker = false;
  const recentlyClosedComments = new Set();
  const walkElements = (elements, currentTrackedChangeId = null) => {
    if (!elements || !Array.isArray(elements)) return;

    elements.forEach((element) => {
      const isCommentStart = element.name === 'w:commentRangeStart';
      const isCommentEnd = element.name === 'w:commentRangeEnd';
      const isTrackedChange = element.name === 'w:ins' || element.name === 'w:del';

      if (isCommentStart) {
        const commentId = element.attributes?.['w:id'];
        if (commentId !== undefined) {
          const id = String(commentId);
          rangeEvents.push({
            type: 'start',
            commentId: id,
          });
          if (!rangePositions.has(id)) {
            rangePositions.set(id, { startIndex: positionIndex, endIndex: -1 });
          } else {
            rangePositions.get(id).startIndex = positionIndex;
          }
          if (currentTrackedChangeId !== null) {
            commentsInTrackedChanges.set(id, currentTrackedChangeId);
          }
        }
        lastElementWasCommentMarker = true;
        recentlyClosedComments.clear();
      } else if (isCommentEnd) {
        const commentId = element.attributes?.['w:id'];
        if (commentId !== undefined) {
          const id = String(commentId);
          rangeEvents.push({
            type: 'end',
            commentId: id,
          });
          if (!rangePositions.has(id)) {
            rangePositions.set(id, { startIndex: -1, endIndex: positionIndex });
          } else {
            rangePositions.get(id).endIndex = positionIndex;
          }
          recentlyClosedComments.add(id);
        }
        lastElementWasCommentMarker = true;
      } else if (isTrackedChange) {
        // ID mapping and replacement pairing are handled by trackedChangeIdMapper.
        // Here we only associate recently-closed comments with the tracked change.
        const wordId = element.attributes?.['w:id'];
        const mappedId =
          wordId != null
            ? (converter?.trackedChangeIdMap?.get(String(wordId)) ?? String(wordId))
            : currentTrackedChangeId;

        if (mappedId && recentlyClosedComments.size > 0) {
          recentlyClosedComments.forEach((commentId) => {
            if (!commentsInTrackedChanges.has(commentId)) {
              commentsInTrackedChanges.set(commentId, mappedId);
            }
          });
        }
        recentlyClosedComments.clear();

        if (element.elements && Array.isArray(element.elements)) {
          walkElements(element.elements, mappedId);
        }
      } else {
        if (lastElementWasCommentMarker) {
          positionIndex++;
          lastElementWasCommentMarker = false;
        }

        if (element.name === 'w:p') {
          recentlyClosedComments.clear();
        }

        if (element.elements && Array.isArray(element.elements)) {
          walkElements(element.elements, currentTrackedChangeId);
        }
      }
    });
  };

  if (documentXml.elements && documentXml.elements.length > 0) {
    const body = documentXml.elements[0];
    if (body.elements) {
      walkElements(body.elements);
    }
  }

  return { rangeEvents, rangePositions, commentsInTrackedChanges };
};

/**
 * Detects parent-child relationships when comment ranges are nested within each other.
 * Uses a stack-based approach where a comment starting inside another comment's range
 * becomes a child of the most recent open comment.
 *
 * @param {Array} comments The comments array
 * @param {Array} rangeEvents Array of {type: 'start'|'end', commentId} events in document order
 * @param {Set} skipComments Set of comment IDs to skip (e.g., comments sharing positions)
 * @returns {Map} Map of child comment ID → parent comment ID (both as importedId)
 */
const detectThreadingFromNestedRanges = (comments, rangeEvents, skipComments = new Set()) => {
  const openRanges = [];
  const parentMap = new Map();

  rangeEvents.forEach((event) => {
    if (event.type === 'start') {
      if (!skipComments.has(event.commentId) && openRanges.length > 0) {
        for (let i = openRanges.length - 1; i >= 0; i--) {
          if (!skipComments.has(openRanges[i])) {
            parentMap.set(event.commentId, openRanges[i]);
            break;
          }
        }
      }
      openRanges.push(event.commentId);
    } else if (event.type === 'end') {
      const index = openRanges.lastIndexOf(event.commentId);
      if (index !== -1) {
        openRanges.splice(index, 1);
      }
    }
  });

  return parentMap;
};

/**
 * Detects parent-child relationships when multiple comments share the same start position.
 * This handles cases where different authors comment on the same text selection.
 * The earliest comment (by creation time) becomes the parent of all others at that position.
 *
 * @param {Array} comments The comments array
 * @param {Map} rangePositions Map of comment importedId → {startIndex: number, endIndex: number}
 * @returns {Map} Map of child comment importedId → parent comment importedId
 */
const detectThreadingFromSharedPosition = (comments, rangePositions) => {
  const parentMap = new Map();
  const commentsByStartPosition = new Map();

  comments.forEach((comment) => {
    const position = rangePositions.get(comment.importedId);
    if (position && position.startIndex >= 0) {
      const startKey = position.startIndex;
      if (!commentsByStartPosition.has(startKey)) {
        commentsByStartPosition.set(startKey, []);
      }
      commentsByStartPosition.get(startKey).push(comment);
    }
  });

  commentsByStartPosition.forEach((commentsAtPosition) => {
    if (commentsAtPosition.length <= 1) return;

    const sorted = [...commentsAtPosition].sort((a, b) => a.createdTime - b.createdTime);
    const parentComment = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      parentMap.set(sorted[i].importedId, parentComment.importedId);
    }
  });

  return parentMap;
};

/**
 * Handles reply comments that don't have corresponding ranges in document.xml.
 * Links these comments to the most recently created preceding comment that has a range.
 * This handles Google Docs exports where reply comments may only exist in comments.xml.
 *
 * @param {Array} comments The comments array
 * @param {Map} rangePositions Map of comment importedId → {startIndex: number, endIndex: number}
 * @returns {Map} Map of comment importedId → parent comment importedId
 */
const detectThreadingFromMissingRanges = (comments, rangePositions) => {
  const parentMap = new Map();
  const commentsWithRanges = [];
  const commentsWithoutRanges = [];

  comments.forEach((comment) => {
    const position = rangePositions.get(comment.importedId);
    if (position && position.startIndex >= 0) {
      commentsWithRanges.push(comment);
    } else {
      commentsWithoutRanges.push(comment);
    }
  });

  commentsWithoutRanges.forEach((comment) => {
    const potentialParents = commentsWithRanges
      .filter((c) => c.createdTime < comment.createdTime)
      .sort((a, b) => b.createdTime - a.createdTime);

    if (potentialParents.length > 0) {
      parentMap.set(comment.importedId, potentialParents[0].importedId);
    }
  });

  return parentMap;
};

/**
 * Detects parent-child relationships for comments whose ranges start inside tracked changes.
 * When a comment range starts inside a tracked change (w:ins or w:del), that tracked change
 * becomes the comment's parent. The tracked change ID is stored as a special marker object
 * that will be resolved later in applyParentRelationships.
 *
 * @param {Array} comments The comments array
 * @param {Map<string, string>} commentsInTrackedChanges Map of comment importedId → tracked change ID
 * @returns {Map} Map of comment importedId → {trackedChangeId: string, isTrackedChangeParent: true}
 */
const detectThreadingFromTrackedChanges = (comments, commentsInTrackedChanges) => {
  const parentMap = new Map();

  if (!commentsInTrackedChanges || commentsInTrackedChanges.size === 0) {
    return parentMap;
  }

  comments.forEach((comment) => {
    const trackedChangeId = commentsInTrackedChanges.get(comment.importedId);
    if (trackedChangeId !== undefined) {
      parentMap.set(comment.importedId, { trackedChangeId, isTrackedChangeParent: true });
    }
  });

  return parentMap;
};

/**
 * Main orchestration function that detects comment threading using multiple strategies.
 * Applies nested range detection, shared position detection, missing range detection,
 * and tracked change detection, then merges and applies all relationships.
 *
 * @param {Array} comments The comments array
 * @param {Object|Array} rangeData Either:
 *   - Object with {rangeEvents, rangePositions, commentsInTrackedChanges}
 *   - Array of rangeEvents (legacy format)
 * @returns {Array} Comments array with parentCommentId set where relationships were detected
 */
const detectThreadingFromRanges = (comments, rangeData) => {
  const { rangeEvents, rangePositions, commentsInTrackedChanges } = Array.isArray(rangeData)
    ? { rangeEvents: rangeData, rangePositions: new Map(), commentsInTrackedChanges: new Map() }
    : rangeData;

  if (!rangeEvents || rangeEvents.length === 0) {
    if (comments.length > 1) {
      const parentMap = detectThreadingFromMissingRanges(comments, rangePositions);
      return applyParentRelationships(comments, parentMap);
    }
    return comments;
  }

  const commentsWithSharedPosition = findCommentsWithSharedStartPosition(comments, rangePositions);
  const nestedParentMap = detectThreadingFromNestedRanges(comments, rangeEvents, commentsWithSharedPosition);
  const sharedPositionParentMap = detectThreadingFromSharedPosition(comments, rangePositions);
  const missingRangeParentMap = detectThreadingFromMissingRanges(comments, rangePositions);
  const trackedChangeParentMap = detectThreadingFromTrackedChanges(comments, commentsInTrackedChanges);

  const mergedParentMap = new Map([...missingRangeParentMap, ...nestedParentMap, ...sharedPositionParentMap]);

  return applyParentRelationships(comments, mergedParentMap, trackedChangeParentMap);
};

/**
 * Identifies comments that share the same start position in the document.
 * These comments are excluded from nested range detection to avoid conflicts,
 * as they're handled separately by detectThreadingFromSharedPosition.
 *
 * @param {Array} comments The comments array
 * @param {Map} rangePositions Map of comment importedId → {startIndex: number, endIndex: number}
 * @returns {Set} Set of comment importedIds that share start positions with other comments
 */
const findCommentsWithSharedStartPosition = (comments, rangePositions) => {
  const sharedPositionComments = new Set();
  const commentsByStartPosition = new Map();

  comments.forEach((comment) => {
    const position = rangePositions.get(comment.importedId);
    if (position && position.startIndex >= 0) {
      const startKey = position.startIndex;
      if (!commentsByStartPosition.has(startKey)) {
        commentsByStartPosition.set(startKey, []);
      }
      commentsByStartPosition.get(startKey).push(comment.importedId);
    }
  });

  commentsByStartPosition.forEach((commentIds) => {
    if (commentIds.length > 1) {
      commentIds.forEach((id) => sharedPositionComments.add(id));
    }
  });

  return sharedPositionComments;
};

/**
 * Applies detected parent-child relationships to comments by setting parentCommentId.
 * Handles both tracked change parents (special case) and regular comment parents.
 * Converts parent importedId to commentId in the final output.
 *
 * @param {Array} comments The comments array
 * @param {Map} parentMap Map of child comment importedId → parent comment importedId
 * @param {Map} trackedChangeParentMap Map of comment importedId → {trackedChangeId, isTrackedChangeParent}
 * @returns {Array} Comments array with parentCommentId set where relationships exist
 */
const applyParentRelationships = (comments, parentMap, trackedChangeParentMap = new Map()) => {
  return comments.map((comment) => {
    const trackedChangeParent = trackedChangeParentMap.get(comment.importedId);
    const updatedComment =
      trackedChangeParent && trackedChangeParent.isTrackedChangeParent
        ? {
            ...comment,
            trackedChangeParentId: trackedChangeParent.trackedChangeId,
          }
        : comment;

    const parentImportedId = parentMap.get(comment.importedId);
    if (parentImportedId) {
      const parentComment = comments.find((c) => c.importedId === parentImportedId);
      if (parentComment) {
        return {
          ...updatedComment,
          parentCommentId: parentComment.commentId,
        };
      }
    }
    return updatedComment;
  });
};

/**
 * Resolve a stable comment ID for imported comments.
 * - Prefer the explicit internal ID when present.
 * - If the comment has an imported ID, derive a stable hash from imported ID + created time.
 * - Otherwise, fall back to a new UUID.
 */
const getCommentId = (internalId, importedId, createdTime) => {
  if (internalId != null) return internalId;
  if (importedId == null || !Number.isFinite(createdTime)) return uuidv4();
  const hash = stableHexHash(`${importedId}-${createdTime}`);
  return `imported-${hash}`;
};
