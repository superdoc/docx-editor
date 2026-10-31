/**
 * The find/replace panel's settled-replace continuation.
 *
 * A worker-backed replace resolves asynchronously, and the session it belongs to
 * can be gone by the time it does: the search handle is reassigned when the
 * active editor changes and nulled on teardown. Publishing the resolved snapshot
 * anyway would repopulate the panel with matches from a document the user is no
 * longer looking at.
 *
 * A leaf module rather than a closure inside `useFindReplace`, following
 * `find-shortcut-owner.ts`. The guard previously lived in two byte-identical
 * inline closures, each of which needed a full composable driving a
 * worker-backed host caught mid-swap to reach one branch. Nothing could, so it
 * shipped with a comment admitting it was verified by inspection only. The
 * duplication was the tell: logic worth stating twice is worth naming once.
 */

type ReplaceSession = { getSnapshot: () => unknown };

type ReplaceContinuationDeps<S extends ReplaceSession> = {
  getCurrentSession: () => S | null;
  applySlice: (snapshot: unknown) => void;
  onSettled: () => void;
};

/**
 * Build the continuation that publishes a settled replace back into the panel.
 *
 * The session handle itself is the identity. `onSettled` always runs, including
 * when the write is skipped: it clears the pending flag that gates the replace
 * controls, and leaving it set would disable them with nothing left to settle.
 */
export function createReplaceContinuation<S extends ReplaceSession>(
  session: S,
  { getCurrentSession, applySlice, onSettled }: ReplaceContinuationDeps<S>,
): () => void {
  return () => {
    if (session === getCurrentSession()) {
      try {
        applySlice(session.getSnapshot());
      } catch {
        /* host gone */
      }
    }
    onSettled();
  };
}
