import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vite-plus/test';
import { initCollaborationComments, loadCommentsFromYdoc, syncCommentsToClients } from './helpers.js';
import { addYComment, updateYComment, deleteYComment, getCommentIndex } from './collaboration-comments.js';
import { SuperDoc } from '../SuperDoc.js';
import { PERMISSIONS, isAllowed, createTrackedChangePermissionResolver } from './permissions.js';

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

const CREATED_TIME = 1767225600000;

const yComment = (fields) => new MockYMap(Object.entries({ createdTime: CREATED_TIME, ...fields }));

function record(value) {
  return JSON.stringify(value, (_key, field) => (typeof field === 'function' ? `[Function ${field.name}]` : field), 2);
}

const storeValues = (superdoc) =>
  superdoc.commentsStore.commentsList.map((comment) =>
    typeof comment.getValues === 'function' ? comment.getValues() : comment,
  );

const storeSummary = (superdoc) =>
  storeValues(superdoc)
    .map((comment) => `${comment.commentId}: ${comment.commentText}`)
    .join('\n') || '(empty)';

const recordLoad = (commentsArray, superdoc) =>
  `yjs comments:\n${record(commentsArray.toJSON())}\n\nstore:\n${record(storeValues(superdoc))}\n`;

beforeAll(() => {
  globalThis.superdoc = { user: { name: 'Global User', email: 'global@example.com' } };
  globalThis.__IS_DEBUG__ = false;
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
        hasSyncedCollaborationComments: false,
        commentsList: [],
      },
      emit: vi.fn(),
      isCollaborative: true,
    };
  });

  it('initCollaborationComments wires provider sync and deduplicates updates', async () => {
    initCollaborationComments(superdoc);

    expect(superdoc.provider.on).toHaveBeenCalledWith('synced', expect.any(Function));
    expect(commentsArray._observers.size).toBe(1);

    const syncedHandler = superdoc.provider.on.mock.calls[0][1];
    syncedHandler();
    expect(superdoc.commentsStore.hasSyncedCollaborationComments).toBe(true);
    expect(superdoc.provider.off).toHaveBeenCalledWith('synced', syncedHandler);

    const steps = [];
    const step = (label, origin) => {
      commentsArray.emit({ transaction: { origin } });
      steps.push(`${label}\nstore:\n${storeSummary(superdoc)}`);
    };

    commentsArray.items = [
      yComment({ commentId: 'c1', commentText: 'Hello' }),
      yComment({ commentId: 'c1', commentText: 'Duplicate' }),
      yComment({ commentId: 'c2', commentText: 'Another' }),
    ];
    step('peer Other <other@example.com> writes c1, a duplicate c1 and c2', {
      user: { name: 'Other', email: 'other@example.com' },
    });

    commentsArray.items.push(yComment({ commentId: 'c3', commentText: 'Own echo' }));
    step('the current user writes c3', { user: superdoc.config.user });

    step('peer other-id, who shares the current user email, writes', {
      user: { id: 'other-id', name: 'Other', email: superdoc.config.user.email },
    });

    await expect(`${steps.join('\n\n')}\n`).toMatchFileSnapshot('./__snapshots__/collaboration/sync-updates.txt');
  });

  it('initCollaborationComments loads existing comments from ydoc on init', async () => {
    commentsArray.items = [
      yComment({ commentId: 'c1', commentText: 'Hello', creatorName: 'Alice', creatorEmail: 'alice@example.com' }),
      yComment({ commentId: 'c1', commentText: 'Duplicate', creatorName: 'Bob', creatorEmail: 'bob@example.com' }),
      yComment({ commentId: 'c2', commentText: 'Another', parentCommentId: 'c1', isInternal: false }),
    ];

    initCollaborationComments(superdoc);

    await expect(recordLoad(commentsArray, superdoc)).toMatchFileSnapshot(
      './__snapshots__/collaboration/load-on-init.txt',
    );
  });

  it('loadCommentsFromYdoc hydrates comments from importedId and deduplicates by stable key', async () => {
    commentsArray.items = [
      yComment({ importedId: 'legacy-1', commentText: 'legacy without commentId' }),
      yComment({ importedId: 'legacy-1', commentText: 'duplicate legacy' }),
      yComment({ commentId: 'c2', commentText: 'normal comment' }),
      yComment({ commentId: 'c2', commentText: 'duplicate normal comment' }),
    ];
    superdoc.provider.synced = true;

    expect(loadCommentsFromYdoc(superdoc)).toBe(true);
    expect(superdoc.commentsStore.hasSyncedCollaborationComments).toBe(true);
    await expect(recordLoad(commentsArray, superdoc)).toMatchFileSnapshot(
      './__snapshots__/collaboration/load-imported-id.txt',
    );
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
    commentsArray.items = [yComment({ commentId: 'c1', commentText: 'first' })];

    initCollaborationComments(superdoc);
    expect(commentsArray._observers.size).toBe(1);
    expect(superdoc.provider.on).toHaveBeenCalledTimes(1);
    expect(storeSummary(superdoc)).toBe('c1: first');

    superdoc.commentsStore.commentsList = [];
    initCollaborationComments(superdoc);

    expect(commentsArray._observers.size).toBe(1);
    expect(superdoc.provider.on).toHaveBeenCalledTimes(1);
    expect(storeSummary(superdoc)).toBe('c1: first');
  });

  it('skips non-object entries in the Yjs comments array', async () => {
    commentsArray.items = [null, 'not-a-comment', 42, yComment({ commentId: 'c1', commentText: 'Hello' })];

    expect(loadCommentsFromYdoc(superdoc)).toBe(true);

    await expect(recordLoad(commentsArray, superdoc)).toMatchFileSnapshot(
      './__snapshots__/collaboration/load-skips-non-objects.txt',
    );
  });

  it.each([
    ['a string origin', 'remote-origin'],
    ['a null origin', null],
    ['an origin without a user', { client: 7 }],
  ])('reloads comments for a transaction with %s', (_label, origin) => {
    initCollaborationComments(superdoc);
    commentsArray.items = [yComment({ commentId: 'c1', commentText: 'Hello' })];

    commentsArray.emit({ transaction: { origin } });

    expect(storeSummary(superdoc)).toBe('c1: Hello');
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
  });

  it('routes events to the correct helpers', async () => {
    const events = [
      { type: 'add', comment: { commentId: 'a', commentText: 'First', createdTime: CREATED_TIME } },
      { type: 'add', comment: { commentId: 'b', commentText: 'Second', createdTime: CREATED_TIME } },
      { type: 'update', comment: { commentId: 'a', commentText: 'First, edited', createdTime: CREATED_TIME } },
      {
        type: 'resolved',
        comment: { commentId: 'b', commentText: 'Second', createdTime: CREATED_TIME, resolvedTime: CREATED_TIME + 1 },
      },
      { type: 'update', comment: { commentId: 'missing', commentText: 'Never added' } },
      { type: 'deleted', comment: { commentId: 'missing' } },
      { type: 'deleted', comment: { commentId: 'a' } },
    ];
    const steps = events.map((event) => {
      superdoc.ydoc._lastMeta = null;
      syncCommentsToClients(superdoc, event);
      return [
        `event: ${JSON.stringify(event)}`,
        `transaction origin: ${superdoc.ydoc._lastMeta ? JSON.stringify(superdoc.ydoc._lastMeta) : '(no transaction)'}`,
        `yjs comments:\n${record(superdoc.ydoc.getArray('comments').toJSON())}`,
      ].join('\n');
    });

    await expect(`${steps.join('\n\n')}\n`).toMatchFileSnapshot('./__snapshots__/collaboration/sync-to-clients.txt');
  });

  it('ignores events when collaboration disabled', () => {
    superdoc.isCollaborative = false;
    syncCommentsToClients(superdoc, { type: 'add', comment: { commentId: 'a' } });
    expect(superdoc.ydoc.getArray('comments').toJSON()).toEqual([]);
  });

  it('ignores events when comments module disabled', () => {
    superdoc.config.modules.comments = false;
    syncCommentsToClients(superdoc, { type: 'add', comment: { commentId: 'a' } });
    expect(superdoc.ydoc.getArray('comments').toJSON()).toEqual([]);
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
    const resolver = vi.fn(() => true);
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
        getComment: vi.fn((id) =>
          id === 'change-1' ? { getValues: () => ({ commentId: 'change-1', text: 'hello' }) } : null,
        ),
      },
    };
    const trackedChange = { id: 'change-1', attrs: { authorEmail: 'editor@example.com' } };

    const result = SuperDoc.prototype.canPerformPermission.call(superdoc, {
      permission: PERMISSIONS.RESOLVE_OWN,
      trackedChange,
    });

    expect(result).toBe(true);
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith({
      permission: PERMISSIONS.RESOLVE_OWN,
      role: 'editor',
      isInternal: true,
      defaultDecision: true,
      comment: { commentId: 'change-1', text: 'hello' },
      currentUser: superdoc.config.user,
      superdoc,
      trackedChange,
    });
  });
});
