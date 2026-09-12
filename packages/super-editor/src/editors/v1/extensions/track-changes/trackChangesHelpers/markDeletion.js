// @ts-check
import { Mapping, ReplaceStep } from 'prosemirror-transform';
import { Slice } from 'prosemirror-model';
import { v4 as uuidv4 } from 'uuid';
import { TrackDeleteMarkName, TrackInsertMarkName } from '../constants.js';
import { findTrackedMarkBetween } from './findTrackedMarkBetween.js';
import { isTextLikeInlineAtom } from './inlineAtoms.js';
import {
  getCurrentUserIdentity,
  getChangeAuthorIdentity,
  matchesSameUserRefinement,
  shouldCollapseNoEmailInsertion,
} from '../review-model/identity.js';

/**
 * Mark deletion.
 * @param {object} options Mark deletion options.
 * @param {import('prosemirror-state').Transaction} options.tr Transaction.
 * @param {number} options.from From position.
 * @param {number} options.to To position.
 * @param {import('../../../core/types/EditorConfig.js').User} options.user User object ({ name, email }).
 * @param {string} options.date Date.
 * @param {string} [options.id] Optional ID to use (for replace operations where insertion and deletion share the same ID).
 * @returns {{ deletionMark: import('prosemirror-model').Mark, deletionMap: Mapping, nodes: import('prosemirror-model').Node[] }} Deletion map and deletion mark.
 */
export const markDeletion = ({ tr, from, to, user, date, id: providedId }) => {
  const currentIdentity = getCurrentUserIdentity({ options: { user } });
  /**
   * @param {import('prosemirror-model').Mark | null | undefined} mark
   */
  const isOwnInsertion = (mark) => {
    const changeIdentity = getChangeAuthorIdentity(mark);
    if (matchesSameUserRefinement({ currentUser: currentIdentity, change: changeIdentity })) return true;
    // No-email imported insertions collapse only when truly unattributed, or
    // when their no-email display name matches the current user. A named
    // different author with no email remains protected review state.
    if (!changeIdentity.hasId && !changeIdentity.hasEmail) {
      return shouldCollapseNoEmailInsertion({ currentUser: user, insertionAttrs: mark?.attrs });
    }
    return false;
  };

  const trackedMark =
    /** @type {{ from: number, to: number, mark: import('prosemirror-model').Mark } | null | undefined} */ (
      findTrackedMarkBetween({
        tr,
        from,
        to,
        markName: TrackDeleteMarkName,
        predicate: (mark) =>
          matchesSameUserRefinement({
            currentUser: currentIdentity,
            change: getChangeAuthorIdentity(mark),
          }),
      })
    );

  let id;
  if (providedId) {
    // Use the provided ID (for replace operations)
    id = providedId;
  } else if (trackedMark) {
    id = trackedMark.mark.attrs.id;
  } else {
    id = uuidv4();
  }

  const deletionMark = tr.doc.type.schema.marks[TrackDeleteMarkName].create({
    id,
    author: user.name || '',
    authorId: user.id || '',
    authorEmail: user.email || '',
    authorImage: user.image || '',
    date,
  });

  const deletionMap = new Mapping();
  const shouldReassignExistingDeletions = Boolean(providedId);

  // Add deletion mark to inline nodes in range.
  // Behavior when replacing over existing tracked changes:
  // - Own insertions are removed (collapsed).
  // - Existing deletions are reassigned to the new deletion mark ID.
  // - Non-deleted inline nodes are marked as deleted.
  /** @type {import('prosemirror-model').Node[]} */
  let nodes = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name.includes('table')) {
      return;
    }

    // Skip containers; include leaves and text-like non-leaf atoms (e.g. tab) (SD-3376).
    if (!node.isInline || (!node.isLeaf && !isTextLikeInlineAtom(node))) {
      return;
    }

    const mappedFrom = deletionMap.map(Math.max(from, pos));
    const mappedTo = deletionMap.map(Math.min(to, pos + node.nodeSize));
    if (mappedFrom >= mappedTo) {
      return;
    }

    const insertMark = node.marks.find((mark) => mark.type.name === TrackInsertMarkName);
    const existingDeleteMarks = node.marks.filter((mark) => mark.type.name === TrackDeleteMarkName);

    if (insertMark && isOwnInsertion(insertMark)) {
      const removeStep = new ReplaceStep(mappedFrom, mappedTo, Slice.empty);
      if (!tr.maybeStep(removeStep).failed) {
        deletionMap.appendMap(removeStep.getMap());
      }
      return;
    }

    if (existingDeleteMarks.length > 0) {
      if (shouldReassignExistingDeletions) {
        nodes.push(node);
        existingDeleteMarks.forEach((existingDeleteMark) => {
          tr.removeMark(mappedFrom, mappedTo, existingDeleteMark);
        });
        tr.addMark(mappedFrom, mappedTo, deletionMark);
      }
      return;
    }

    nodes.push(node);
    tr.addMark(mappedFrom, mappedTo, deletionMark);
  });

  return { deletionMark, deletionMap, nodes };
};
