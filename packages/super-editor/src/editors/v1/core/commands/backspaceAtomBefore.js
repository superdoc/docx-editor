import { Selection } from 'prosemirror-state';

/**
 * Atom inline node types that should be treated as a single deletable unit
 * when Backspace is pressed with the cursor immediately after them.
 *
 * Why opt-in (rather than "any atom"):
 *   `findPreviousTextDeleteRange` deliberately skips atoms like bookmarkEnd
 *   so backspace deletes the previous text character, not the bookmark marker.
 *   Generalizing atom-deletion would break that behavior. This list captures
 *   atoms whose semantics are "a glyph the user inserted" — closer to text
 *   than to a marker — so deleting them on Backspace matches Word/intuition.
 *
 * Kept in sync with `TEXT_LIKE_INLINE_ATOMS` in track-changes
 * (trackChangesHelpers/inlineAtoms.js), which gates the same atoms for tracked
 * deletion. `tab` is included so Backspace removes an inserted tab the same way
 * it removes a typed character — including in suggesting mode (SD-3376).
 */
const DELETABLE_INLINE_ATOMS = new Set(['noBreakHyphen', 'tab']);

/**
 * Returns the deletable atom inside a single-child run, or null otherwise.
 * After import, atoms like noBreakHyphen always live inside their own `run`
 * wrapper. From a paragraph-level cursor, `nodeBefore` is that wrapper run —
 * not the atom directly — so we have to peek one level deeper.
 */
const onlyChildAtomIn = (runNode) => {
  if (!runNode || runNode.type.name !== 'run') return null;
  if (runNode.content.childCount !== 1) return null;
  const child = runNode.content.firstChild;
  if (!child?.isAtom || !child.isInline) return null;
  if (!DELETABLE_INLINE_ATOMS.has(child.type.name)) return null;
  return child;
};

/**
 * Backspace handler that deletes a deletable inline atom (and its wrapper run,
 * if any) directly before the cursor as a single unit.
 *
 * Three caret positions resolve to "right after the atom" in the rendered doc:
 *   1. Inside the atom's run, after the atom        → nodeBefore = atom
 *   2. At paragraph level, between runs             → nodeBefore = atom-wrapper run
 *   3. At the start of the run after the atom       → walk one level up
 *
 * Slotted into the keymap chain BEFORE `backspaceAcrossRuns` so the run-aware
 * scanner does not walk past the atom and delete a character from the previous
 * run instead.
 *
 * @returns {import('@core/commands/types').Command}
 */
export const backspaceAtomBefore =
  () =>
  ({ state, tr, dispatch }) => {
    const sel = state.selection;
    if (!sel.empty) return false;

    const $pos = sel.$from;
    let from = -1;
    let to = -1;

    // Case 1: inside the atom's run, immediately after the atom. If the atom
    // is the run's only child, remove the whole wrapper for parity with cases
    // 2 and 3 — otherwise we leak an empty run that would have to be cleaned
    // up later. If the run holds other inline content too, just delete the atom.
    const direct = $pos.nodeBefore;
    if (direct?.isInline && direct.isAtom && DELETABLE_INLINE_ATOMS.has(direct.type.name)) {
      const parent = $pos.parent;
      if (parent.type.name === 'run' && parent.content.childCount === 1) {
        const runStart = $pos.before($pos.depth);
        from = runStart;
        to = runStart + parent.nodeSize;
      } else {
        from = $pos.pos - direct.nodeSize;
        to = $pos.pos;
      }
    }

    // Case 2: at paragraph level, nodeBefore is the run wrapping the atom.
    if (from === -1 && onlyChildAtomIn(direct)) {
      from = $pos.pos - direct.nodeSize;
      to = $pos.pos;
    }

    // Case 3: at the start of the run that follows the atom-run. The cursor's
    // parent is a run, parentOffset is 0, and the previous paragraph-level
    // sibling is the atom-wrapper run.
    if (from === -1 && $pos.parent.type.name === 'run' && $pos.parentOffset === 0) {
      const parentBefore = state.doc.resolve($pos.before($pos.depth)).nodeBefore;
      if (onlyChildAtomIn(parentBefore)) {
        from = $pos.before($pos.depth) - parentBefore.nodeSize;
        to = $pos.before($pos.depth);
      }
    }

    if (from === -1) return false;

    if (dispatch) {
      tr.delete(from, to).setSelection(Selection.near(tr.doc.resolve(from)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
