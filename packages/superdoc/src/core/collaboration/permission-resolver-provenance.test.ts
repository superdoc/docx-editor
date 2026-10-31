import { describe, expect, it, vi } from 'vite-plus/test';
import { createTrackedChangePermissionResolver, isAllowed } from './permissions.js';

const provenance = Symbol.for('superdoc.internal.permission-resolver.builtin');

function configured() {
  const superdoc = {
    config: { role: 'editor', isInternal: true, user: { name: 'Alice' } },
    canPerformPermission: vi.fn(({ permission, role, isInternal, trackedChange }) =>
      isAllowed(permission, role, isInternal, { superdoc, trackedChange }),
    ),
  };
  Object.defineProperty(superdoc.canPerformPermission, Symbol.for('superdoc.internal.permission-method.builtin'), {
    value: true,
  });
  return { superdoc, resolver: createTrackedChangePermissionResolver(superdoc) };
}

describe('tracked-change permission policy provenance', () => {
  it('withdraws built-in provenance when the permission method itself is replaced', () => {
    const { superdoc, resolver } = configured();
    superdoc.canPerformPermission = vi.fn(() => false);
    expect(resolver[provenance]()).toBe(false);
    expect(resolver({ permission: 'RESOLVE_OTHER' })).toBe(false);
  });
  it('brands only the built-in policy and evaluates current role configuration', () => {
    const { superdoc, resolver } = configured();
    expect(resolver[provenance]()).toBe(true);
    expect(resolver({ permission: 'RESOLVE_OTHER', role: 'viewer' })).toBe(true);
    superdoc.config.role = 'suggester';
    expect(resolver({ permission: 'RESOLVE_OTHER', role: 'editor' })).toBe(false);
    expect(resolver({ permission: 'REJECT_OWN' })).toBe(true);
  });

  it.each(['top-level', 'deprecated'])(
    'withdraws built-in provenance for a runtime %s custom callback and restores it on removal',
    (location) => {
      const { superdoc, resolver } = configured();
      const custom = vi.fn(() => false);
      if (location === 'top-level') superdoc.config.permissionResolver = custom;
      else superdoc.config.modules = { comments: { permissionResolver: custom } };
      const trackedChange = { id: 'change-1', linkedComments: { commentIds: ['comment-1'] } };
      expect(resolver[provenance]()).toBe(false);
      expect(resolver({ permission: 'RESOLVE_OTHER', trackedChange })).toBe(false);
      expect(custom).toHaveBeenCalledWith(expect.objectContaining({ trackedChange, role: 'editor' }));
      if (location === 'top-level') delete superdoc.config.permissionResolver;
      else delete superdoc.config.modules.comments.permissionResolver;
      expect(resolver[provenance]()).toBe(true);
    },
  );
});
