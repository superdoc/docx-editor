export const PERMISSIONS = Object.freeze({
  RESOLVE_OWN: 'RESOLVE_OWN',
  RESOLVE_OTHER: 'RESOLVE_OTHER',
  REJECT_OWN: 'REJECT_OWN',
  REJECT_OTHER: 'REJECT_OTHER',
  COMMENTS_OVERFLOW_OWN: 'COMMENTS_OVERFLOW',
  COMMENTS_OVERFLOW_OTHER: 'COMMENTS_OVERFLOW_OTHER',
  COMMENTS_DELETE_OWN: 'COMMENTS_DELETE_OWN',
  COMMENTS_DELETE_OTHER: 'COMMENTS_DELETE_OTHER',
  UPLOAD_VERSION: 'UPLOAD_VERSION',
  VERSION_HISTORY: 'VERSION_HISTORY',
});

const ROLES = Object.freeze({
  EDITOR: 'editor',
  SUGGESTER: 'suggester',
  VIEWER: 'viewer',
});

const PERMISSION_MATRIX = Object.freeze({
  [PERMISSIONS.RESOLVE_OWN]: {
    internal: [ROLES.EDITOR],
    external: [ROLES.EDITOR],
  },
  [PERMISSIONS.RESOLVE_OTHER]: {
    internal: [ROLES.EDITOR],
    external: [ROLES.EDITOR],
  },
  [PERMISSIONS.REJECT_OWN]: {
    internal: [ROLES.EDITOR, ROLES.SUGGESTER],
    external: [ROLES.EDITOR, ROLES.SUGGESTER],
  },
  [PERMISSIONS.REJECT_OTHER]: {
    internal: [ROLES.EDITOR],
    external: [ROLES.EDITOR],
  },
  [PERMISSIONS.COMMENTS_OVERFLOW_OWN]: {
    internal: [ROLES.EDITOR, ROLES.SUGGESTER],
    external: [ROLES.EDITOR, ROLES.SUGGESTER],
  },
  [PERMISSIONS.COMMENTS_OVERFLOW_OTHER]: {
    internal: [ROLES.EDITOR],
    external: [ROLES.EDITOR],
  },
  [PERMISSIONS.COMMENTS_DELETE_OWN]: {
    internal: [ROLES.EDITOR, ROLES.SUGGESTER],
    external: [ROLES.EDITOR, ROLES.SUGGESTER],
  },
  [PERMISSIONS.COMMENTS_DELETE_OTHER]: {
    internal: [ROLES.EDITOR],
    external: [ROLES.EDITOR],
  },
  [PERMISSIONS.UPLOAD_VERSION]: {
    internal: [ROLES.EDITOR],
    external: [],
  },
  [PERMISSIONS.VERSION_HISTORY]: {
    internal: [ROLES.EDITOR],
    external: [],
  },
});

const pickResolver = (context = {}) => {
  if (typeof context.permissionResolver === 'function') return context.permissionResolver;
  if (typeof context.superdoc?.config?.permissionResolver === 'function') {
    return context.superdoc.config.permissionResolver;
  }
  const deprecatedResolver = context.superdoc?.config?.modules?.comments?.permissionResolver;
  if (typeof deprecatedResolver === 'function') return deprecatedResolver;
  return null;
};

const BUILT_IN_PERMISSION_METHOD = Symbol.for('superdoc.internal.permission-method.builtin');
const BUILT_IN_PERMISSION_RESOLVER = Symbol.for('superdoc.internal.permission-resolver.builtin');

/** Create the shell's internal, live tracked-change permission shim. */
export const createTrackedChangePermissionResolver = (superdoc) => {
  const isBuiltInPolicy = () =>
    superdoc.canPerformPermission?.[BUILT_IN_PERMISSION_METHOD] === true && pickResolver({ superdoc }) === null;
  const resolver = (payload = {}) =>
    isBuiltInPolicy()
      ? defaultDecisionFor(payload.permission, superdoc.config.role, superdoc.config.isInternal)
      : superdoc.canPerformPermission({
          ...payload,
          role: superdoc.config.role,
          isInternal: superdoc.config.isInternal,
        });
  Object.defineProperty(resolver, BUILT_IN_PERMISSION_RESOLVER, {
    value: isBuiltInPolicy,
  });
  return resolver;
};

const defaultDecisionFor = (permission, role, isInternal) => {
  const internalExternal = isInternal ? 'internal' : 'external';
  return PERMISSION_MATRIX[permission]?.[internalExternal]?.includes(role) ?? false;
};

const NON_DATA_PERMISSION_PROPERTY = Symbol();

const readPermissionDataProperty = (source, key) => {
  if (source == null) return undefined;
  if (typeof source !== 'object' && typeof source !== 'function') return NON_DATA_PERMISSION_PROPERTY;
  for (let owner = source; owner !== null; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) return 'value' in descriptor ? descriptor.value : NON_DATA_PERMISSION_PROPERTY;
  }
  return undefined;
};

export const readBuiltInTrackedChangePermissionDecision = (superdoc, canPerform, permission, trackedChange) => {
  try {
    if (
      readPermissionDataProperty(superdoc, 'canPerformPermission') !== canPerform ||
      readPermissionDataProperty(canPerform, BUILT_IN_PERMISSION_METHOD) !== true
    ) {
      return null;
    }
    const config = readPermissionDataProperty(superdoc, 'config');
    if (!config || typeof config !== 'object') return null;
    const role = readPermissionDataProperty(config, 'role');
    const isInternal = readPermissionDataProperty(config, 'isInternal');
    const user = readPermissionDataProperty(config, 'user');
    const resolver = readPermissionDataProperty(config, 'permissionResolver');
    const modules = readPermissionDataProperty(config, 'modules');
    const comments = readPermissionDataProperty(modules, 'comments');
    const deprecatedResolver = readPermissionDataProperty(comments, 'permissionResolver');
    const commentsStore = readPermissionDataProperty(superdoc, 'commentsStore');
    const getComment = readPermissionDataProperty(commentsStore, 'getComment');
    const comment = readPermissionDataProperty(trackedChange, 'comment');
    const commentId = readPermissionDataProperty(trackedChange, 'commentId');
    const id = readPermissionDataProperty(trackedChange, 'id');
    if (
      [
        role,
        isInternal,
        user,
        resolver,
        modules,
        comments,
        deprecatedResolver,
        commentsStore,
        getComment,
        comment,
        commentId,
        id,
      ].includes(NON_DATA_PERMISSION_PROPERTY) ||
      typeof resolver === 'function' ||
      typeof deprecatedResolver === 'function'
    ) {
      return null;
    }
    return defaultDecisionFor(permission, role, isInternal);
  } catch {
    return null;
  }
};

/**
 * Resolve a client-side permission through the built-in matrix and optional
 * resolver.
 *
 * @param {string} permission The permission to check
 * @param {string | undefined} role The role to check
 * @param {boolean | undefined} isInternal The internal/external flag
 * @param {object} [context] Context passed to the permission resolver
 * @param {object | null} [context.comment] The comment/tracked change being evaluated
 * @param {object | null} [context.superdoc] The SuperDoc instance
 * @param {object | null} [context.currentUser] The active user object performing the action
 * @param {Function} [context.permissionResolver] Explicit resolver override
 * @param {object | null} [context.trackedChange] Tracked change metadata (for tracked-change permissions)
 * @returns {boolean} Whether the permission is allowed
 */
export const isAllowed = (permission, role, isInternal, context = {}) => {
  const defaultDecision = defaultDecisionFor(permission, role, isInternal);
  const resolver = pickResolver(context);

  if (typeof resolver !== 'function') return defaultDecision;

  const decision = resolver({
    permission,
    role,
    isInternal,
    defaultDecision,
    comment: context.comment ?? null,
    currentUser: context.currentUser ?? context.superdoc?.config?.user ?? null,
    superdoc: context.superdoc ?? null,
    trackedChange: context.trackedChange ?? null,
  });

  return typeof decision === 'boolean' ? decision : defaultDecision;
};
