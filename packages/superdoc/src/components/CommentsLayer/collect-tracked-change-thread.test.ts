import { describe, it, expect } from 'vite-plus/test';
import { collectTrackedChangeThread } from './collect-tracked-change-thread.js';

// Spatial tracked-change linkage and explicit conversation membership are
// independent. Only the latter may seed a tracked-change dialog.

const tc = { commentId: 'tc-1', trackedChange: true };

describe('collectTrackedChangeThread', () => {
  describe('explicit tracked-change conversation membership', () => {
    it('returns just the TC itself when no comments are anchored', () => {
      const sut = collectTrackedChangeThread(tc, [tc]);
      expect(sut.map((c) => c.commentId)).toEqual(['tc-1']);
    });

    it('includes an explicitly threaded root comment (no parentCommentId)', () => {
      const root = { commentId: 'c-root', trackedChangeThreadParentId: 'tc-1' };
      const sut = collectTrackedChangeThread(tc, [tc, root]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['c-root', 'tc-1']);
    });

    it('includes a legacy tracked-change child that only has the legacy parent field', () => {
      const legacyRoot = {
        commentId: 'legacy-root',
        trackedChangeParentId: 'tc-1',
        trackedChangeType: 'insert',
      };
      const sut = collectTrackedChangeThread(tc, [tc, legacyRoot]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['legacy-root', 'tc-1']);
    });

    it('includes a direct reply via parentCommentId === trackedChangeId (runtime-created replies)', () => {
      const reply = { commentId: 'c-direct', parentCommentId: 'tc-1' };
      const sut = collectTrackedChangeThread(tc, [tc, reply]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['c-direct', 'tc-1']);
    });

    it('includes a V2 reply whose document parent is a hidden sidecar root but whose UI parent is the tracked change', () => {
      const reply = {
        commentId: 'c-v2-reply',
        parentCommentId: '0',
        threadingParentCommentId: 'tc-1',
        trackedChangeThreadParentId: 'tc-1',
      };
      const sut = collectTrackedChangeThread(tc, [tc, reply]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['c-v2-reply', 'tc-1']);
    });

    it('picks up a bi-parented reply whose parent is itself TC-anchored on the same TC (BFS chain)', () => {
      const root = { commentId: 'c-root', trackedChangeThreadParentId: 'tc-1' };
      const reply = { commentId: 'c-reply', parentCommentId: 'c-root', trackedChangeThreadParentId: 'tc-1' };
      const sut = collectTrackedChangeThread(tc, [tc, root, reply]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['c-reply', 'c-root', 'tc-1']);
    });

    it('walks the BFS through a deep chain of TC-anchored replies', () => {
      const r0 = { commentId: 'r0', trackedChangeThreadParentId: 'tc-1' };
      const r1 = { commentId: 'r1', parentCommentId: 'r0', trackedChangeThreadParentId: 'tc-1' };
      const r2 = { commentId: 'r2', parentCommentId: 'r1', trackedChangeThreadParentId: 'tc-1' };
      const sut = collectTrackedChangeThread(tc, [tc, r0, r1, r2]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['r0', 'r1', 'r2', 'tc-1']);
    });
  });

  describe('spatial-only linkage', () => {
    it('does not include a standalone root whose anchor merely overlaps the tracked change', () => {
      const spatialOnly = { commentId: 'word-comment', trackedChangeParentId: 'tc-1' };
      const sut = collectTrackedChangeThread(tc, [tc, spatialOnly]);
      expect(sut.map((c) => c.commentId)).toEqual(['tc-1']);
    });

    it('excludes a reply whose parentCommentId points to a comment that is NOT TC-anchored on this TC', () => {
      // Real-world shape from documentCommentsImporter.js:199 — `rangeParent`
      // can resolve to a comment whose range lives OUTSIDE the TC. The reply
      // gets `parentCommentId = <non-TC parent>` AND `trackedChangeParentId = <TC>`.
      // It belongs in the non-TC parent's thread, NOT here.
      const realParent = { commentId: 'real-parent' /* not TC-anchored */ };
      const biParented = {
        commentId: 'c-bi-parented',
        parentCommentId: 'real-parent',
        trackedChangeParentId: 'tc-1',
      };
      const sut = collectTrackedChangeThread(tc, [tc, realParent, biParented]);
      expect(sut.map((c) => c.commentId)).not.toContain('c-bi-parented');
    });

    it('still includes a sibling TC-anchored root even when an unrelated bi-parented reply is filtered out', () => {
      const root = { commentId: 'c-root', trackedChangeThreadParentId: 'tc-1' };
      const realParent = { commentId: 'real-parent' };
      const biParented = {
        commentId: 'c-bi-parented',
        parentCommentId: 'real-parent',
        trackedChangeParentId: 'tc-1',
      };
      const sut = collectTrackedChangeThread(tc, [tc, root, realParent, biParented]);
      expect(sut.map((c) => c.commentId).sort()).toEqual(['c-root', 'tc-1']);
    });

    it('excludes a reply whose parentCommentId points to a comment anchored on a DIFFERENT TC', () => {
      const otherTcRoot = { commentId: 'other-root', trackedChangeThreadParentId: 'tc-OTHER' };
      const biParented = {
        commentId: 'c-bi-parented',
        parentCommentId: 'other-root',
        trackedChangeParentId: 'tc-1',
      };
      const sut = collectTrackedChangeThread(tc, [tc, otherTcRoot, biParented]);
      expect(sut.map((c) => c.commentId)).not.toContain('c-bi-parented');
    });
  });
});
