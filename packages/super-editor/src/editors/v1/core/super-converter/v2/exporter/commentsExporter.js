import { translator as wPTranslator } from '@converter/v3/handlers/w/p';
import { carbonCopy } from '../../../utilities/carbonCopy.js';
import { COMMENT_REF, COMMENTS_XML_DEFINITIONS } from '../../exporter-docx-defs.js';
import { generateDocxRandomId } from '../../../helpers/generateDocxRandomId.js';
import { COMMENT_FILE_BASENAMES } from '../../constants.js';

/**
 * Insert w15:paraId into the comments
 *
 * @param {Object} comment The comment to update
 * @returns {Object} The updated comment
 */
export const prepareCommentParaIds = (comment) => {
  const newComment = {
    ...comment,
    commentParaId: generateDocxRandomId(),
  };
  return newComment;
};

const getCommentIds = (comment) => {
  if (!comment) return [];
  return [comment.commentId, comment.importedId, comment.internalId].filter((id) => id != null).map((id) => String(id));
};

const buildCommentLookup = (comments = []) => {
  const byId = new Map();
  for (const comment of comments) {
    getCommentIds(comment).forEach((id) => byId.set(id, comment));
  }
  return byId;
};

const findCommentById = (comments = [], id) => {
  if (id == null) return null;
  const lookup = buildCommentLookup(comments);
  return lookup.get(String(id)) || null;
};

/**
 * Resolve the thread-wide "done" state for a comment.
 *
 * Resolving a thread marks the whole *thread* resolved (CMTS-LIFE-002), but the
 * runtime stamps `resolvedTime` only on the comment that was resolved — the
 * thread root. Replies therefore carry no `resolvedTime`/`isDone` of their own.
 * Word reads `w15:done` per-comment from `commentsExtended.xml`; a thread whose
 * root is `done="1"` while a reply is `done="0"` is malformed, so Word drops the
 * resolved root and shows only the still-open reply (SD-3355's "dangling
 * comment"). A comment is therefore exported as done when it — or any ancestor
 * in its thread — is resolved.
 *
 * @param {Object} comment The comment being exported
 * @param {Object[]} [allComments] The full export comment list
 * @returns {boolean} Whether the comment's thread is resolved
 */
export const isCommentResolvedInThread = (comment, allComments = []) => {
  const isDone = (c) => Boolean(c?.resolvedTime || c?.isDone);
  if (isDone(comment)) return true;
  const byId = buildCommentLookup(allComments);
  const seen = new Set();
  let current = comment;
  while (current) {
    const parentId = current.threadingParentCommentId || current.parentCommentId;
    const parentKey = parentId != null ? String(parentId) : null;
    if (parentKey == null || seen.has(parentKey)) break;
    seen.add(parentKey);
    const parent = byId.get(parentKey);
    if (!parent) break;
    if (isDone(parent)) return true;
    current = parent;
  }
  return false;
};

/**
 * Generate the w:comment node for a comment
 * This is stored in comments.xml
 *
 * @param {Object} comment The comment to export
 * @param {string} commentId The index of the comment
 * @returns {Object} The w:comment node for the comment
 */
export const getCommentDefinition = (comment, commentId, allComments, editor) => {
  const nodes = Array.isArray(comment.commentJSON)
    ? comment.commentJSON
    : comment.commentJSON
      ? [comment.commentJSON]
      : [];
  const translatedParagraphs = nodes.map((node) => wPTranslator.decode({ editor, node })).filter(Boolean);

  const attributes = {
    'w:id': String(commentId),
    'w:author': comment.wordAuthorName ?? comment.creatorName ?? comment.importedAuthor?.name,
    'w:date': toIsoNoFractional(comment.createdTime),
    'w:initials': getInitials(comment.creatorName),
    'w:done': isCommentResolvedInThread(comment, allComments) ? '1' : '0',
    'w15:paraId': comment.commentParaId,
    'custom:internalId': comment.commentId || comment.internalId,
    'custom:trackedChange': comment.trackedChange,
    'custom:trackedChangeText': comment.trackedChangeText || null,
    'custom:trackedChangeType': comment.trackedChangeType,
    'custom:trackedChangeDisplayType': comment.trackedChangeDisplayType || null,
    'custom:trackedDeletedText': comment.deletedText || null,
    'custom:email': comment.creatorEmail || comment.importedAuthor?.email,
  };

  // Add the w15:paraIdParent attribute if the comment has a parent
  // Note: If the parent is a tracked change (not a real Word comment), we don't set this attribute
  // because Word doesn't recognize tracked changes as comment parents
  if (comment?.parentCommentId) {
    const parentComment = findCommentById(allComments, comment.parentCommentId);
    if (parentComment && !parentComment.trackedChange) {
      attributes['w15:paraIdParent'] = parentComment.commentParaId;
    }
  }

  return {
    type: 'element',
    name: 'w:comment',
    attributes,
    elements: translatedParagraphs,
  };
};

/**
 * Get the initials of a name
 *
 * @param {string} name The name to get the initials of
 * @returns {string | null} The initials of the name
 */
export const getInitials = (name) => {
  if (!name) return null;

  const preparedText = name.replace('(imported)', '').trim();
  const initials = preparedText
    .split(' ')
    .map((word) => word[0])
    .join('');
  return initials;
};

/**
 * Convert a unix date to an ISO string without milliseconds
 *
 * @param {number} unixMillis The date to convert
 * @returns {string} The date as an ISO string without milliseconds
 */
export const toIsoNoFractional = (unixMillis) => {
  const date = new Date(unixMillis || Date.now());
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/**
 * Updates or creates the `word/comments.xml` entry in a docx file structure.
 *
 * @param {Object[]} commentDefs - An array of comment definition objects.
 * @param {Object} convertedXml - The entire XML object representing the docx file structure.
 * @returns {Object} - The updated portion of the comments XML structure.
 */
export const updateCommentsXml = (commentDefs = [], commentsXml) => {
  const newCommentsXml = carbonCopy(commentsXml);

  // Re-build the comment definitions
  commentDefs.forEach((commentDef) => {
    const paragraphs = commentDef.elements || [];
    if (!paragraphs.length) return;

    const firstParagraph = paragraphs.find((node) => node?.name === 'w:p') ?? paragraphs[0];
    const lastParagraph =
      paragraphs
        .slice()
        .reverse()
        .find((node) => node?.name === 'w:p') ?? paragraphs[paragraphs.length - 1];

    if (!firstParagraph?.attributes) firstParagraph.attributes = {};
    if (!lastParagraph?.attributes) lastParagraph.attributes = {};

    // NOTE: Per ECMA-376, w:pPr should be first child of w:p
    const elements = firstParagraph.elements || [];
    firstParagraph.elements = elements;
    elements.unshift(COMMENT_REF);

    const paraId = commentDef.attributes['w15:paraId'];
    lastParagraph.attributes['w14:paraId'] = paraId;

    commentDef.attributes = {
      'w:id': commentDef.attributes['w:id'],
      'w:author': commentDef.attributes['w:author'],
      'w:date': commentDef.attributes['w:date'],
      'w:initials': commentDef.attributes['w:initials'],
      'custom:internalId': commentDef.attributes['custom:internalId'],
      'custom:trackedChange': commentDef.attributes['custom:trackedChange'],
      'custom:trackedChangeText': commentDef.attributes['custom:trackedChangeText'],
      'custom:trackedChangeType': commentDef.attributes['custom:trackedChangeType'],
      'custom:trackedChangeDisplayType': commentDef.attributes['custom:trackedChangeDisplayType'],
      'custom:trackedDeletedText': commentDef.attributes['custom:trackedDeletedText'],
      'custom:email': commentDef.attributes['custom:email'],
      'xmlns:custom': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    };
  });

  newCommentsXml.elements[0].elements = commentDefs;
  return newCommentsXml;
};

/**
 * Determine export strategy based on comment origins
 * @param {Object[]} comments The comments list
 * @returns {'word' | 'google-docs' | 'unknown'} The export strategy to use
 */
export const determineExportStrategy = (comments) => {
  if (!comments || comments.length === 0) {
    return 'word';
  }

  const origins = new Set(comments.map((c) => c.origin || 'word'));

  if (origins.size === 1) {
    const origin = origins.values().next().value;
    return origin === 'google-docs' ? 'google-docs' : 'word';
  }

  return 'word';
};

const resolveThreadingStyle = (comment, threadingProfile) => {
  if (comment?.threadingStyleOverride) return comment.threadingStyleOverride;
  if (threadingProfile?.defaultStyle) return threadingProfile.defaultStyle;
  return comment?.originalXmlStructure?.hasCommentsExtended ? 'commentsExtended' : 'range-based';
};

/**
 * This function updates the commentsExtended.xml structure with the comments list.
 *
 * @param {Object[]} comments The comments list
 * @param {Object} commentsExtendedXml The commentsExtended.xml structure as JSON
 * @param {import('@superdoc/common').CommentThreadingProfile | 'word' | 'google-docs' | 'unknown'} threadingProfile
 * @returns {Object | null} The updated commentsExtended structure, or null if it shouldn't be generated
 */
export const updateCommentsExtendedXml = (comments = [], commentsExtendedXml, threadingProfile = null) => {
  if (!commentsExtendedXml) {
    return null;
  }
  const exportStrategy = typeof threadingProfile === 'string' ? threadingProfile : 'word';
  const profile = typeof threadingProfile === 'string' ? null : threadingProfile;
  const hasThreadedComments = comments.some((comment) => comment.threadingParentCommentId || comment.parentCommentId);
  const hasResolvedComments = comments.some((comment) => comment.resolvedTime || comment.isDone);

  // Always generate commentsExtended.xml when exporting comments (unless Google Docs style)
  // This ensures that comments without threading relationships are explicitly marked as
  // top-level comments, preventing range-based parenting on re-import from incorrectly
  // creating threading relationships based on nested ranges.
  const shouldGenerateCommentsExtended = profile
    ? profile.defaultStyle === 'commentsExtended' ||
      profile.mixed ||
      comments.some((comment) => resolveThreadingStyle(comment, profile) === 'commentsExtended')
    : exportStrategy !== 'google-docs'; // Generate for 'word' and 'unknown' strategies

  // If any threaded comments exist, always include commentsExtended.xml so Word can retain threads.
  const shouldIncludeForThreads = hasThreadedComments;

  // Word reads w15:done from commentsExtended.xml to determine resolved status.
  // Without this file, resolved comments appear unresolved when opened in Word.
  if (!shouldGenerateCommentsExtended && !shouldIncludeForThreads && !hasResolvedComments) {
    return null;
  }

  const xmlCopy = carbonCopy(commentsExtendedXml);

  const commentsEx = comments.map((comment) => {
    // A resolved thread must mark every comment in it done. Resolving stamps
    // resolvedTime on the root only, so a reply inherits the resolved state of
    // its thread root (SD-3355) — otherwise Word drops the resolved root.
    const isResolved = isCommentResolvedInThread(comment, comments);
    const attributes = {
      'w15:paraId': comment.commentParaId,
      'w15:done': isResolved ? '1' : '0',
    };

    // Use paraIdParent only for comments that should use commentsExtended threading.
    // Note: If the parent is a tracked change (not a real Word comment), we don't set this attribute
    // because Word doesn't recognize tracked changes as comment parents.
    const parentId = comment.threadingParentCommentId || comment.parentCommentId;
    const threadingStyle = resolveThreadingStyle(comment, profile);
    if (parentId && (threadingStyle === 'commentsExtended' || shouldIncludeForThreads)) {
      const parentComment = findCommentById(comments, parentId);
      const allowTrackedParent = profile?.defaultStyle === 'commentsExtended';
      if (parentComment && (allowTrackedParent || !parentComment.trackedChange)) {
        attributes['w15:paraIdParent'] = parentComment.commentParaId;
      }
    }

    return {
      type: 'element',
      name: 'w15:commentEx',
      attributes,
    };
  });

  xmlCopy.elements[0].elements = commentsEx;
  return xmlCopy;
};

/**
 * Update commentsIds.xml and/or commentsExtensible.xml.
 * Either part may be null — only the provided parts are populated.
 * Both share the same durable IDs when both are present.
 *
 * @param {Object[]} comments The comments list
 * @param {Object | null} commentsIds The commentsIds.xml structure as JSON (null to skip)
 * @param {Object | null} extensible The commentsExtensible.xml structure as JSON (null to skip)
 * @returns {Object} The updated commentsIds and commentsExtensible structures (null for skipped parts)
 */
export const updateCommentsIdsAndExtensible = (comments = [], commentsIds, extensible) => {
  const documentIdsUpdated = commentsIds ? carbonCopy(commentsIds) : null;
  const extensibleUpdated = extensible ? carbonCopy(extensible) : null;

  if (documentIdsUpdated) documentIdsUpdated.elements[0].elements = [];
  if (extensibleUpdated) extensibleUpdated.elements[0].elements = [];

  comments.forEach((comment) => {
    const newDurableId = generateDocxRandomId();

    if (documentIdsUpdated) {
      documentIdsUpdated.elements[0].elements.push({
        type: 'element',
        name: 'w16cid:commentId',
        attributes: {
          'w16cid:paraId': comment.commentParaId,
          'w16cid:durableId': newDurableId,
        },
      });
    }

    if (extensibleUpdated) {
      extensibleUpdated.elements[0].elements.push({
        type: 'element',
        name: 'w16cex:commentExtensible',
        attributes: {
          'w16cex:durableId': newDurableId,
          'w16cex:dateUtc': toIsoNoFractional(comment.createdTime),
        },
      });
    }
  });

  return {
    documentIdsUpdated,
    extensibleUpdated,
  };
};

/**
 * Generate initial comments XML structure with no content
 *
 * @param {Object} convertedXml The converted XML structure of the docx file
 * @returns {Object} The updated XML structure with the comments files
 */
export const generateConvertedXmlWithCommentFiles = (convertedXml, fileSet = null) => {
  const newXml = carbonCopy(convertedXml);
  newXml['word/comments.xml'] = COMMENTS_XML_DEFINITIONS.COMMENTS_XML_DEF;
  // Always include commentsExtended.xml - it's needed to explicitly mark comments as
  // top-level (no threading) and prevent range-based parenting on re-import.
  // The updateCommentsExtendedXml function will decide whether to actually include it
  // based on export strategy (e.g., skip for Google Docs style).
  const includeExtended = true;
  const includeExtensible = fileSet ? fileSet.hasCommentsExtensible : true;
  const includeIds = fileSet ? fileSet.hasCommentsIds : true;

  if (includeExtended) newXml['word/commentsExtended.xml'] = COMMENTS_XML_DEFINITIONS.COMMENTS_EXTENDED_XML_DEF;
  if (includeExtensible) newXml['word/commentsExtensible.xml'] = COMMENTS_XML_DEFINITIONS.COMMENTS_EXTENSIBLE_XML_DEF;
  if (includeIds) newXml['word/commentsIds.xml'] = COMMENTS_XML_DEFINITIONS.COMMENTS_IDS_XML_DEF;
  // Do NOT overwrite [Content_Types].xml here — DocxZipper.updateContentTypes() is the
  // authoritative source that builds content types at zip-assembly time based on which
  // files actually exist in updatedDocs.
  return newXml;
};

/**
 * Remove comments files from the converted XML
 *
 * @param {Object} convertedXml The converted XML structure of the docx file
 * @returns {Object} The updated XML structure with the comments files removed
 */
export const removeCommentsFilesFromConvertedXml = (convertedXml) => {
  const updatedXml = carbonCopy(convertedXml);

  delete updatedXml['word/comments.xml'];
  delete updatedXml['word/commentsExtended.xml'];
  delete updatedXml['word/commentsExtensible.xml'];
  delete updatedXml['word/commentsIds.xml'];

  return updatedXml;
};

/**
 * Generate a relationship for a comments file target
 *
 * @param {String} target The target of the relationship
 * @returns {Object} The generated relationship
 */
export const generateRelationship = (target) => {
  const relsDefault = COMMENTS_XML_DEFINITIONS.DOCUMENT_RELS_XML_DEF.elements[0].elements;
  const rel = relsDefault.find((rel) => rel.attributes.Target === target);
  return { ...rel };
};

/** @type {readonly string[]} All possible comment support file targets */
const ALL_COMMENT_TARGETS = COMMENT_FILE_BASENAMES;

/**
 * Generate comments files into convertedXml
 *
 * @param {Object} params
 * @param {Object} params.convertedXml Current converted XML map
 * @param {Object[]} params.defs Export-ready `w:comment` definitions
 * @param {Object[]} params.commentsWithParaIds Comments enriched with generated `commentParaId`
 * @param {'clean' | string} params.exportType Export mode
 * @param {import('@superdoc/common').CommentThreadingProfile | null} params.threadingProfile
 * @returns {{ documentXml: Object, relationships: Object[], removedTargets: string[], warnings: string[] }}
 */
export const prepareCommentsXmlFilesForExport = ({
  convertedXml,
  defs,
  commentsWithParaIds,
  exportType,
  threadingProfile,
}) => {
  const relationships = [];
  const warnings = [];

  if (exportType === 'clean') {
    const documentXml = removeCommentsFilesFromConvertedXml(convertedXml);
    // Clean export: all comment parts are intentionally removed — no warnings
    return { documentXml, relationships, removedTargets: ALL_COMMENT_TARGETS, warnings };
  }

  const hasComments = commentsWithParaIds && commentsWithParaIds.length > 0;

  // When all comments have been removed, clean up all comment parts
  if (!hasComments) {
    const documentXml = removeCommentsFilesFromConvertedXml(convertedXml);
    const removedTargets = [...ALL_COMMENT_TARGETS];
    if (threadingProfile?.fileSet) {
      warnings.push('All comments removed — cleaning up imported comment support files');
    }
    return { documentXml, relationships, removedTargets, warnings };
  }

  const emittedTargets = new Set();

  const exportStrategy = determineExportStrategy(commentsWithParaIds);
  const updatedXml = generateConvertedXmlWithCommentFiles(convertedXml, threadingProfile?.fileSet);

  updatedXml['word/comments.xml'] = updateCommentsXml(defs, updatedXml['word/comments.xml']);
  relationships.push(generateRelationship('comments.xml'));
  emittedTargets.add('comments.xml');

  // Key off the file-set capability, not exportStrategy: the importer tags
  // every file missing commentsExtended.xml as origin='google-docs', including
  // legacy Word range-based files, so exportStrategy can't distinguish them.
  const forceWordThreadingProfile =
    threadingProfile?.defaultStyle === 'range-based' && threadingProfile?.fileSet?.hasCommentsExtended === false;
  const effectiveThreadingProfile = forceWordThreadingProfile ? 'word' : threadingProfile || exportStrategy;

  const commentsExtendedXml = updateCommentsExtendedXml(
    commentsWithParaIds,
    updatedXml['word/commentsExtended.xml'],
    effectiveThreadingProfile,
  );

  // Only add the file and relationship if we're actually generating commentsExtended.xml
  // For Google Docs without original commentsExtended.xml, we skip it entirely to preserve range-based threading
  if (commentsExtendedXml !== null) {
    updatedXml['word/commentsExtended.xml'] = commentsExtendedXml;
    relationships.push(generateRelationship('commentsExtended.xml'));
    emittedTargets.add('commentsExtended.xml');
  } else {
    delete updatedXml['word/commentsExtended.xml'];
    if (threadingProfile?.fileSet?.hasCommentsExtended) {
      warnings.push('commentsExtended.xml removed — export strategy does not require it');
    }
  }

  // Generate updates for commentsIds.xml and/or commentsExtensible.xml independently.
  // They share durable IDs when both are present, but either can exist without the other.
  const hasIds = !!updatedXml['word/commentsIds.xml'];
  const hasExtensible = !!updatedXml['word/commentsExtensible.xml'];

  if (hasIds !== hasExtensible) {
    const present = hasIds ? 'commentsIds.xml' : 'commentsExtensible.xml';
    const absent = hasIds ? 'commentsExtensible.xml' : 'commentsIds.xml';
    warnings.push(`Partial comment file-set: ${present} present without ${absent}`);
  }

  if (hasIds || hasExtensible) {
    const { documentIdsUpdated, extensibleUpdated } = updateCommentsIdsAndExtensible(
      commentsWithParaIds,
      hasIds ? updatedXml['word/commentsIds.xml'] : null,
      hasExtensible ? updatedXml['word/commentsExtensible.xml'] : null,
    );
    if (documentIdsUpdated) {
      updatedXml['word/commentsIds.xml'] = documentIdsUpdated;
      relationships.push(generateRelationship('commentsIds.xml'));
      emittedTargets.add('commentsIds.xml');
    }
    if (extensibleUpdated) {
      updatedXml['word/commentsExtensible.xml'] = extensibleUpdated;
      relationships.push(generateRelationship('commentsExtensible.xml'));
      emittedTargets.add('commentsExtensible.xml');
    }
  }

  if (!threadingProfile && hasComments) {
    warnings.push('Comments exist but no threading profile detected — using default export shape');
  }

  // Compute comment targets that are not emitted in this export cycle
  const removedTargets = ALL_COMMENT_TARGETS.filter((target) => !emittedTargets.has(target));

  return {
    relationships,
    documentXml: updatedXml,
    removedTargets,
    warnings,
  };
};
