import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vite-plus/test';
import { initCollaborationComments, loadCommentsFromYdoc, syncCommentsToClients } from './helpers.js';
import * as commentsModule from './collaboration-comments.js';
const { addYComment, updateYComment, deleteYComment, getCommentIndex } = commentsModule;
import { SuperDoc } from '../SuperDoc.js';
import { PERMISSIONS, isAllowed, createTrackedChangePermissionResolver } from './permissions.js';
import * as permissionsModule from './permissions.js';

var MockYMap;
var MockYArray;
var MockYDoc;

vi.mock('yjs', () => {
  MockYMap = class extends Map {
    toJSON() {
      return Object.fromEntries(this);
    }
  };

  MockYArray = class {
    constructor() {
      this.items = [];
      this._observers = new Set();
    }

    push(nodes) {
      this.items.push(...nodes);
    }

    delete(index, count) {
      this.items.splice(index, count);
    }

    insert(index, nodes) {
      this.items.splice(index, 0, ...nodes);
    }

    toJSON() {
      return this.items.map((item) => (item?.toJSON ? item.toJSON() : item));
    }

    observe(handler) {
      this._observers.add(handler);
    }

    emit(event) {
      for (const handler of this._observers) handler(event);
    }
  };

  MockYDoc = class {
    constructor() {
      this._arrays = new Map();
      this._lastMeta = null;
    }

    getArray(name) {
      if (!this._arrays.has(name)) {
        this._arrays.set(name, new MockYArray());
      }
      return this._arrays.get(name);
    }

    transact(fn, meta) {
      this._lastMeta = meta;
      fn();
    }
  };

  return {
    Map: MockYMap,
  };
});

var useCommentMock;
vi.mock('../../components/CommentsLayer/use-comment', () => {
  useCommentMock = vi.fn((comment) => ({ normalized: comment.commentId }));
  return { default: useCommentMock };
});

beforeAll(() => {
  globalThis.superdoc = { user: { name: 'Global User', email: 'global@example.com' } };
  globalThis.__IS_DEBUG__ = false;
});

beforeEach(() => {
  useCommentMock?.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('collaboration helpers', () => {
  let superdoc;
  let commentsArray;

  beforeEach(() => {
    const ydoc = new MockYDoc();
    commentsArray = ydoc.getArray('comments');
    superdoc = {
      config: {
        user: { id: 'owner-id', name: 'Owner', email: 'owner@example.com' },
        modules: {
          comments: true,
        },
      },
      provider: {
        on: vi.fn(),
        off: vi.fn(),
      },
      ydoc,
      commentsStore: {
        commentsParentElement: 'parent',
        editorCommentIds: ['1'],
        handleEditorLocationsUpdate: vi.fn(),
        hasSyncedCollaborationComments: false,
        commentsList: [],
      },
      emit: vi.fn(),
      isCollaborative: true,
    };
  });

  it('initCollaborationComments wires provider sync and deduplicates updates', () => {
    initCollaborationComments(superdoc);

    expect(superdoc.provider.on).toHaveBeenCalledWith('synced', expect.any(Function));
    expect(commentsArray._observers.size).toBe(1);

    // Trigger synced event
    const syncedHandler = superdoc.provider.on.mock.calls[0][1];
    syncedHandler();
    expect(superdoc.commentsStore.handleEditorLocationsUpdate).toHaveBeenCalled();
    expect(superdoc.commentsStore.hasSyncedCollaborationComments).toBe(true);

    // Trigger observation from another user
    commentsArray.items = [
      new MockYMap(Object.entries({ commentId: 'c1', text: 'Hello' })),
      new MockYMap(Object.entries({ commentId: 'c1', text: 'Duplicate' })),
      new MockYMap(Object.entries({ commentId: 'c2', text: 'Another' })),
    ];

    const event = {
      transaction: { origin: { user: { name: 'Other', email: 'other@example.com' } } },
    };
    commentsArray.emit(event);

    expect(useCommentMock).toHaveBeenCalledTimes(2);
    expect(superdoc.commentsStore.commentsList).toEqual([{ normalized: 'c1' }, { normalized: 'c2' }]);

    // Event from same user should be ignored
    commentsArray.emit({ transaction: { origin: { user: superdoc.config.user } } });
    expect(useCommentMock).toHaveBeenCalledTimes(2);

    // Same email but different actor id should not be ignored.
    commentsArray.emit({
      transaction: { origin: { user: { id: 'other-id', name: 'Other', email: superdoc.config.user.email } } },
    });
    expect(useCommentMock).toHaveBeenCalledTimes(4);
  });

  it('initCollaborationComments loads existing comments from ydoc on init', () => {
    commentsArray.items = [
      new MockYMap(Object.entries({ commentId: 'c1', text: 'Hello' })),
      new MockYMap(Object.entries({ commentId: 'c1', text: 'Duplicate' })),
      new MockYMap(Object.entries({ commentId: 'c2', text: 'Another' })),
    ];

    initCollaborationComments(superdoc);

    expect(useCommentMock).toHaveBeenCalledTimes(2);
    expect(superdoc.commentsStore.commentsList).toEqual([{ normalized: 'c1' }, { normalized: 'c2' }]);
  });

  it('loadCommentsFromYdoc hydrates comments from importedId and deduplicates by stable key', () => {
    commentsArray.items = [
      new MockYMap(Object.entries({ importedId: 'legacy-1', text: 'legacy without commentId' })),
      new MockYMap(Object.entries({ importedId: 'legacy-1', text: 'duplicate legacy' })),
      new MockYMap(Object.entries({ commentId: 'c2', text: 'normal comment' })),
      new MockYMap(Object.entries({ commentId: 'c2', text: 'duplicate normal comment' })),
    ];
    superdoc.provider.synced = true;

    const loaded = loadCommentsFromYdoc(superdoc);

    expect(loaded).toBe(true);
    expect(useCommentMock).toHaveBeenCalledTimes(2);
    expect(useCommentMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ importedId: 'legacy-1', commentId: 'legacy-1' }),
    );
    expect(useCommentMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ commentId: 'c2' }));
    expect(superdoc.commentsStore.commentsList).toEqual([{ normalized: 'legacy-1' }, { normalized: 'c2' }]);
    expect(superdoc.commentsStore.hasSyncedCollaborationComments).toBe(true);
  });

  it('loadCommentsFromYdoc preserves local v2 tracked-change rows when room comments are empty', () => {
    const trackedRow = {
      commentId: 'tc-1',
      trackedChange: true,
      trackedChangeAnchorKey: 'tc::body::tc-1',
    };
    superdoc.editorVersion = 2;
    superdoc.activeEditor = { editorVersion: 2 };
    superdoc.provider.synced = true;
    superdoc.commentsStore.commentsList = [
      trackedRow,
      { commentId: 'local-comment', commentText: 'room comments own this row' },
    ];

    const loaded = loadCommentsFromYdoc(superdoc);

    expect(loaded).toBe(true);
    expect(useCommentMock).not.toHaveBeenCalled();
    expect(superdoc.commentsStore.commentsList).toEqual([trackedRow]);
    expect(superdoc.commentsStore.hasSyncedCollaborationComments).toBe(true);
  });

  it('loadCommentsFromYdoc does not preserve tracked-change rows without v2 runtime evidence', () => {
    superdoc.editorVersion = undefined;
    superdoc.activeEditor = null;
    superdoc.commentsStore.commentsList = [
      {
        commentId: 'tc-1',
        trackedChange: true,
        trackedChangeAnchorKey: 'tc::body::tc-1',
      },
    ];

    const loaded = loadCommentsFromYdoc(superdoc);

    expect(loaded).toBe(true);
    expect(superdoc.commentsStore.commentsList).toEqual([]);
  });

  it('initCollaborationComments re-hydrates store on repeated init without duplicating listeners', () => {
    commentsArray.items = [new MockYMap(Object.entries({ commentId: 'c1', text: 'first' }))];

    initCollaborationComments(superdoc);
    expect(commentsArray._observers.size).toBe(1);
    expect(superdoc.provider.on).toHaveBeenCalledTimes(1);
    expect(superdoc.commentsStore.commentsList).toEqual([{ normalized: 'c1' }]);

    // Simulate store reset after mount; second init should re-hydrate but not add listeners again.
    superdoc.commentsStore.commentsList = [];
    initCollaborationComments(superdoc);

    expect(commentsArray._observers.size).toBe(1);
    expect(superdoc.provider.on).toHaveBeenCalledTimes(1);
    expect(superdoc.commentsStore.commentsList).toEqual([{ normalized: 'c1' }]);
  });

  it('initCollaborationComments skips when module disabled', () => {
    superdoc.config.modules.comments = false;
    initCollaborationComments(superdoc);
    expect(superdoc.provider.on).not.toHaveBeenCalled();
  });
});

describe('collaboration comments primitives', () => {
  const testUser = { name: 'Test User', email: 'test@example.com' };

  it('manages Yjs comment array operations', () => {
    const ydoc = new MockYDoc();
    const yArray = ydoc.getArray('comments');
    const baseComment = { commentId: 'c1', body: 'Hello' };

    addYComment(yArray, ydoc, { comment: baseComment }, testUser);
    expect(yArray.toJSON()).toEqual([baseComment]);
    expect(ydoc._lastMeta.user).toEqual(testUser);

    const updatedComment = { commentId: 'c1', body: 'Updated' };
    updateYComment(yArray, ydoc, { comment: updatedComment }, testUser);
    expect(yArray.toJSON()).toEqual([updatedComment]);

    deleteYComment(yArray, ydoc, { comment: updatedComment }, testUser);
    expect(yArray.toJSON()).toEqual([]);
  });

  it('getCommentIndex finds matching comment ids', () => {
    const ydoc = new MockYDoc();
    const yArray = ydoc.getArray('comments');
    addYComment(yArray, ydoc, { comment: { commentId: 'c5', body: 'Test' } }, testUser);
    expect(getCommentIndex(yArray, { commentId: 'missing' })).toBe(-1);
    expect(getCommentIndex(yArray, { commentId: 'c5' })).toBe(0);
  });
});

describe('syncCommentsToClients routing', () => {
  let superdoc;
  let addSpy;
  let updateSpy;
  let deleteSpy;

  beforeEach(() => {
    const ydoc = new MockYDoc();
    superdoc = {
      ydoc,
      isCollaborative: true,
      config: {
        user: { name: 'Test User', email: 'test@example.com' },
        modules: { comments: true },
      },
    };

    addSpy = vi.spyOn(commentsModule, 'addYComment');
    updateSpy = vi.spyOn(commentsModule, 'updateYComment');
    deleteSpy = vi.spyOn(commentsModule, 'deleteYComment');
  });

  afterEach(() => {
    addSpy.mockRestore();
    updateSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it('routes events to the correct helpers', () => {
    syncCommentsToClients(superdoc, { type: 'add', comment: { commentId: 'a' } });
    expect(addSpy).toHaveBeenCalled();

    syncCommentsToClients(superdoc, { type: 'update', comment: { commentId: 'a' } });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    syncCommentsToClients(superdoc, { type: 'resolved', comment: { commentId: 'a' } });
    expect(updateSpy).toHaveBeenCalledTimes(2);

    syncCommentsToClients(superdoc, { type: 'deleted', comment: { commentId: 'a' } });
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('ignores events when collaboration disabled', () => {
    superdoc.isCollaborative = false;
    syncCommentsToClients(superdoc, { type: 'add', comment: {} });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('ignores events when comments module disabled', () => {
    superdoc.config.modules.comments = false;
    syncCommentsToClients(superdoc, { type: 'add', comment: {} });
    expect(addSpy).not.toHaveBeenCalled();
  });
});

describe('permissions', () => {
  it('SD-5650 avoids comment-store lookups for the built-in matrix and preserves them for custom context', () => {
    const storedComment = { commentText: 'Synthetic permission context' };
    const getComment = vi.fn(() => storedComment);
    const superdoc = {
      config: { role: 'editor', isInternal: true, user: { name: 'Alice' } },
      commentsStore: { getComment },
      canPerformPermission: SuperDoc.prototype.canPerformPermission,
    };
    const resolver = createTrackedChangePermissionResolver(superdoc);
    const trackedChange = { id: 'synthetic-change', linkedComments: { commentIds: ['synthetic-comment'] } };
    expect(resolver({ permission: PERMISSIONS.RESOLVE_OTHER, trackedChange })).toBe(true);
    expect(
      getComment,
      'the built-in matrix depends only on permission, role and internal/external status',
    ).not.toHaveBeenCalled();
    const custom = vi.fn(() => false);
    superdoc.config.permissionResolver = custom;
    expect(resolver({ permission: PERMISSIONS.RESOLVE_OTHER, trackedChange })).toBe(false);
    expect(getComment).toHaveBeenCalledTimes(1);
    expect(custom).toHaveBeenCalledWith(expect.objectContaining({ comment: storedComment, trackedChange }));
  });

  it('exposes immutable list of permission keys', () => {
    expect(Object.keys(PERMISSIONS)).toEqual(expect.arrayContaining(['RESOLVE_OWN', 'VERSION_HISTORY']));
  });

  it('applies the built-in role matrix without a resolver', () => {
    expect(isAllowed(PERMISSIONS.RESOLVE_OWN, 'editor', true)).toBe(true);
    expect(isAllowed(PERMISSIONS.RESOLVE_OWN, 'viewer', true)).toBe(false);
    expect(isAllowed(PERMISSIONS.REJECT_OWN, 'suggester', false)).toBe(true);
    expect(isAllowed(PERMISSIONS.REJECT_OTHER, 'suggester', false)).toBe(false);
  });

  it('uses the deprecated comments resolver as a fallback', () => {
    const permissionResolver = vi.fn().mockImplementation(({ defaultDecision, comment, currentUser, superdoc }) => {
      expect(defaultDecision).toBe(true);
      expect(comment.commentId).toBe('comment-1');
      expect(currentUser.email).toBe('editor@example.com');
      expect(superdoc).toBeDefined();
      return false;
    });

    const superdoc = {
      config: {
        user: { email: 'editor@example.com' },
        modules: {
          comments: {
            permissionResolver,
          },
        },
      },
    };

    const allowed = isAllowed(PERMISSIONS.RESOLVE_OWN, 'editor', true, {
      superdoc,
      comment: { commentId: 'comment-1' },
      trackedChange: { id: 'comment-1', attrs: { authorEmail: 'editor@example.com' } },
    });

    expect(allowed).toBe(false);
    expect(permissionResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: PERMISSIONS.RESOLVE_OWN,
        role: 'editor',
        isInternal: true,
        defaultDecision: true,
        trackedChange: expect.objectContaining({ id: 'comment-1' }),
      }),
    );
  });

  it('prefers the canonical resolver over the deprecated comments resolver', () => {
    const permissionResolver = vi.fn(() => true);
    const commentsPermissionResolver = vi.fn(() => false);
    const superdoc = {
      config: {
        permissionResolver,
        modules: {
          comments: {
            permissionResolver: commentsPermissionResolver,
          },
        },
      },
    };

    const allowed = isAllowed(PERMISSIONS.RESOLVE_OWN, 'viewer', true, { superdoc });

    expect(allowed).toBe(true);
    expect(permissionResolver).toHaveBeenCalledOnce();
    expect(commentsPermissionResolver).not.toHaveBeenCalled();
  });

  it('prefers the canonical resolver through canPerformPermission', () => {
    const permissionResolver = vi.fn(() => true);
    const commentsPermissionResolver = vi.fn(() => false);
    const superdoc = {
      config: {
        role: 'viewer',
        isInternal: true,
        user: null,
        permissionResolver,
        modules: {
          comments: {
            permissionResolver: commentsPermissionResolver,
          },
        },
      },
    };

    const allowed = SuperDoc.prototype.canPerformPermission.call(superdoc, {
      permission: PERMISSIONS.RESOLVE_OWN,
    });

    expect(allowed).toBe(true);
    expect(permissionResolver).toHaveBeenCalledOnce();
    expect(commentsPermissionResolver).not.toHaveBeenCalled();
  });

  it('prefers a call-scoped resolver over configured resolvers', () => {
    const callScopedResolver = vi.fn(() => true);
    const permissionResolver = vi.fn(() => false);
    const superdoc = { config: { permissionResolver } };

    const allowed = isAllowed(PERMISSIONS.RESOLVE_OWN, 'viewer', true, {
      superdoc,
      permissionResolver: callScopedResolver,
    });

    expect(allowed).toBe(true);
    expect(callScopedResolver).toHaveBeenCalledOnce();
    expect(permissionResolver).not.toHaveBeenCalled();
  });

  it('uses the built-in decision when the resolver returns undefined', () => {
    const superdoc = {
      config: {
        user: { email: 'viewer@example.com' },
        modules: {
          comments: {
            permissionResolver: vi.fn(() => undefined),
          },
        },
      },
    };

    const allowed = isAllowed(PERMISSIONS.RESOLVE_OWN, 'viewer', true, {
      superdoc,
      comment: { commentId: 'comment-2' },
    });

    expect(allowed).toBe(false);
  });

  it('canPerformPermission resolves tracked-change comments via store', () => {
    const originalIsAllowed = permissionsModule.isAllowed;
    const resolver = vi.fn(({ comment }) => {
      expect(comment).toEqual({ commentId: 'change-1', text: 'hello' });
      return true;
    });

    const superdoc = {
      config: {
        role: 'editor',
        isInternal: true,
        user: { email: 'editor@example.com' },
        modules: {
          comments: {
            permissionResolver: resolver,
          },
        },
      },
      commentsStore: {
        getComment: vi.fn(() => ({
          getValues: () => ({ commentId: 'change-1', text: 'hello' }),
        })),
      },
    };

    const isAllowedSpy = vi
      .spyOn(permissionsModule, 'isAllowed')
      .mockImplementation((permission, role, isInternal, ctx) => {
        expect(ctx.comment).toEqual({ commentId: 'change-1', text: 'hello' });
        return originalIsAllowed(permission, role, isInternal, ctx);
      });

    const result = SuperDoc.prototype.canPerformPermission.call(superdoc, {
      permission: PERMISSIONS.RESOLVE_OWN,
      trackedChange: { id: 'change-1', attrs: { authorEmail: 'editor@example.com' } },
    });

    expect(result).toBe(true);
    expect(superdoc.commentsStore.getComment).toHaveBeenCalledWith('change-1');
    expect(resolver).toHaveBeenCalled();
    expect(isAllowedSpy).toHaveBeenCalledWith(
      PERMISSIONS.RESOLVE_OWN,
      'editor',
      true,
      expect.objectContaining({ trackedChange: expect.objectContaining({ id: 'change-1' }) }),
    );

    isAllowedSpy.mockRestore();
  });
});
