import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { SurfaceManager } from './surface-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createManager(moduleConfig = {}) {
  return new SurfaceManager({
    getModuleConfig: () => moduleConfig,
  });
}

/** A minimal Vue component stub */
const StubComponent = { template: '<div>stub</div>' };

/** A minimal external renderer stub */
function stubRenderer(ctx) {
  return { destroy: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SurfaceManager', () => {
  let manager;

  beforeEach(() => {
    manager = createManager();
  });

  // -----------------------------------------------------------------------
  // open() — direct render
  // -----------------------------------------------------------------------

  describe('open() — direct render with component', () => {
    it('returns a handle with id, mode, close, and result', () => {
      const handle = manager.open({
        mode: 'dialog',
        component: StubComponent,
      });

      expect(handle.id).toBeDefined();
      expect(handle.mode).toBe('dialog');
      expect(typeof handle.close).toBe('function');
      expect(handle.result).toBeInstanceOf(Promise);
    });

    it('sets activeDialog when mode is dialog', () => {
      manager.open({ mode: 'dialog', component: StubComponent });
      expect(manager.activeDialog.value).not.toBeNull();
      expect(manager.activeDialog.value.mode).toBe('dialog');
    });

    it('sets activeFloating when mode is floating', () => {
      manager.open({ mode: 'floating', component: StubComponent });
      expect(manager.activeFloating.value).not.toBeNull();
      expect(manager.activeFloating.value.mode).toBe('floating');
    });

    it('uses provided id if given', () => {
      const handle = manager.open({ id: 'my-id', mode: 'dialog', component: StubComponent });
      expect(handle.id).toBe('my-id');
    });

    it('generates an id if none provided', () => {
      const h1 = manager.open({ mode: 'dialog', component: StubComponent });
      const h2 = manager.open({ mode: 'floating', component: StubComponent });
      expect(h1.id).not.toBe(h2.id);
    });

    it('passes extra props to the surface object', () => {
      manager.open({
        mode: 'dialog',
        component: StubComponent,
        props: { foo: 'bar' },
      });
      expect(manager.activeDialog.value.props).toEqual({ foo: 'bar' });
    });
  });

  describe('open() — direct render with external renderer', () => {
    it('sets the render function on the surface', () => {
      manager.open({ mode: 'dialog', render: stubRenderer });
      expect(typeof manager.activeDialog.value.render).toBe('function');
      expect(manager.activeDialog.value.component).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // open() — intent-based (resolver)
  // -----------------------------------------------------------------------

  describe('open() — intent-based with resolver', () => {
    it('resolves via a custom resolver returning a component', () => {
      const m = createManager({
        resolver: (req) => ({ type: 'custom', component: StubComponent, props: { x: 1 } }),
      });
      m.open({ kind: 'test', mode: 'dialog' });
      expect(m.activeDialog.value.component).toBe(StubComponent);
      expect(m.activeDialog.value.props).toEqual({ x: 1 });
    });

    it('resolves via a custom resolver returning an external renderer', () => {
      const m = createManager({
        resolver: () => ({ type: 'external', render: stubRenderer }),
      });
      m.open({ kind: 'test', mode: 'floating' });
      expect(typeof m.activeFloating.value.render).toBe('function');
    });

    it('throws when resolver returns { type: "none" }', () => {
      const m = createManager({
        resolver: () => ({ type: 'none' }),
      });
      expect(() => m.open({ kind: 'suppressed', mode: 'dialog' })).toThrow(
        'resolver explicitly suppressed surface for kind "suppressed"',
      );
    });

    it('falls through when resolver returns null', () => {
      const m = createManager({
        resolver: () => null,
      });
      // No built-in registry — should throw "no renderer resolved"
      expect(() => m.open({ kind: 'unknown', mode: 'dialog' })).toThrow('no renderer resolved for kind "unknown"');
    });

    it('falls through when resolver returns undefined', () => {
      const m = createManager({
        resolver: () => undefined,
      });
      expect(() => m.open({ kind: 'unknown', mode: 'dialog' })).toThrow(/no renderer resolved/);
    });
  });

  // -----------------------------------------------------------------------
  // open() — validation errors
  // -----------------------------------------------------------------------

  describe('open() — validation errors', () => {
    it('throws if request is null', () => {
      expect(() => manager.open(null)).toThrow(/non-null object/);
    });

    it('throws if mode is missing', () => {
      expect(() => manager.open({ component: StubComponent })).toThrow(/mode must be/);
    });

    it('throws if mode is invalid', () => {
      expect(() => manager.open({ mode: 'popover', component: StubComponent })).toThrow(/mode must be/);
    });

    it('throws if both component and render are provided', () => {
      expect(() => manager.open({ mode: 'dialog', component: StubComponent, render: stubRenderer })).toThrow(
        /both "component" and "render"/,
      );
    });

    it('throws if neither kind, component, nor render is provided', () => {
      expect(() => manager.open({ mode: 'dialog' })).toThrow(/must provide "kind"/);
    });

    it('throws for intent-based request with no resolver or built-in', () => {
      expect(() => manager.open({ kind: 'test', mode: 'dialog' })).toThrow(/no renderer resolved/);
    });

    it('throws if floating.placement is invalid', () => {
      expect(() =>
        manager.open({ mode: 'floating', component: StubComponent, floating: { placement: 'right-top' } }),
      ).toThrow(/floating\.placement must be one of/);
    });

    it('does not throw when floating.placement is omitted (uses default)', () => {
      expect(() => manager.open({ mode: 'floating', component: StubComponent })).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Replacement lifecycle
  // -----------------------------------------------------------------------

  describe('replacement lifecycle', () => {
    it('replaces an existing dialog and settles the previous handle', async () => {
      const h1 = manager.open({ mode: 'dialog', component: StubComponent });
      const h2 = manager.open({ mode: 'dialog', component: StubComponent });

      const outcome = await h1.result;
      expect(outcome.status).toBe('replaced');
      expect(outcome.replacedBy).toBe(h2.id);
      expect(manager.activeDialog.value.id).toBe(h2.id);
    });

    it('replaces an existing floating and settles the previous handle', async () => {
      const h1 = manager.open({ mode: 'floating', component: StubComponent });
      const h2 = manager.open({ mode: 'floating', component: StubComponent });

      const outcome = await h1.result;
      expect(outcome.status).toBe('replaced');
      expect(outcome.replacedBy).toBe(h2.id);
    });

    it('dialog and floating coexist independently', () => {
      manager.open({ mode: 'dialog', component: StubComponent });
      manager.open({ mode: 'floating', component: StubComponent });

      expect(manager.activeDialog.value).not.toBeNull();
      expect(manager.activeFloating.value).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // close()
  // -----------------------------------------------------------------------

  describe('close()', () => {
    it('closes by id and resolves with "closed"', async () => {
      const handle = manager.open({ id: 'x', mode: 'dialog', component: StubComponent });
      manager.close('x');

      const outcome = await handle.result;
      expect(outcome.status).toBe('closed');
      expect(manager.activeDialog.value).toBeNull();
    });

    it('closes topmost surface (dialog first) when no id given', async () => {
      const dh = manager.open({ mode: 'dialog', component: StubComponent });
      manager.open({ mode: 'floating', component: StubComponent });

      manager.close(); // should close dialog, not floating
      const outcome = await dh.result;
      expect(outcome.status).toBe('closed');
      expect(manager.activeDialog.value).toBeNull();
      expect(manager.activeFloating.value).not.toBeNull();
    });

    it('closes floating if no dialog is active', async () => {
      const fh = manager.open({ mode: 'floating', component: StubComponent });
      manager.close();

      const outcome = await fh.result;
      expect(outcome.status).toBe('closed');
      expect(manager.activeFloating.value).toBeNull();
    });

    it('passes reason to the outcome', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      manager.close('x-id-not-needed', 'user-cancel');
      // close by id wasn't matched, so try with actual id
      manager.close(handle.id, 'user-cancel');

      const outcome = await handle.result;
      expect(outcome.reason).toBe('user-cancel');
    });

    it('is a no-op for an unknown id', () => {
      manager.open({ mode: 'dialog', component: StubComponent });
      manager.close('nonexistent');
      expect(manager.activeDialog.value).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Content-facing resolve/close on the surface object
  // -----------------------------------------------------------------------

  describe('content-facing resolve/close', () => {
    it('resolve() settles with "submitted", data, and clears the slot', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      const surface = manager.activeDialog.value;

      surface.resolve({ password: 'secret' });

      const outcome = await handle.result;
      expect(outcome.status).toBe('submitted');
      expect(outcome.data).toEqual({ password: 'secret' });
      expect(manager.activeDialog.value).toBeNull();
    });

    it('resolve() clears the floating slot after submit', async () => {
      const handle = manager.open({ mode: 'floating', component: StubComponent });
      const surface = manager.activeFloating.value;

      surface.resolve({ query: 'contract' });

      const outcome = await handle.result;
      expect(outcome.status).toBe('submitted');
      expect(outcome.data).toEqual({ query: 'contract' });
      expect(manager.activeFloating.value).toBeNull();
    });

    it('close() from content settles with "closed" and clears the slot', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      const surface = manager.activeDialog.value;

      surface.close('cancelled');

      const outcome = await handle.result;
      expect(outcome.status).toBe('closed');
      expect(outcome.reason).toBe('cancelled');
      expect(manager.activeDialog.value).toBeNull();
    });
    it('stale resolve() from a replaced dialog does not clear a replacement reusing the same id', async () => {
      const firstHandle = manager.open({ id: 'shared', mode: 'dialog', component: StubComponent });
      const staleSurface = manager.activeDialog.value;

      const replacementHandle = manager.open({ id: 'shared', mode: 'dialog', component: StubComponent });
      const replacementSurface = manager.activeDialog.value;

      await expect(firstHandle.result).resolves.toEqual({ status: 'replaced', replacedBy: 'shared' });

      staleSurface.resolve('stale-result');

      let replacementSettled = false;
      replacementHandle.result.then(() => {
        replacementSettled = true;
      });
      await Promise.resolve();

      expect(manager.activeDialog.value).toBe(replacementSurface);
      expect(replacementSettled).toBe(false);

      replacementSurface.resolve('fresh-result');
      await expect(replacementHandle.result).resolves.toEqual({ status: 'submitted', data: 'fresh-result' });
      expect(manager.activeDialog.value).toBeNull();
    });

    it('stale close() from a replaced floating surface does not clear a replacement reusing the same id', async () => {
      const firstHandle = manager.open({ id: 'shared', mode: 'floating', component: StubComponent });
      const staleSurface = manager.activeFloating.value;

      const replacementHandle = manager.open({ id: 'shared', mode: 'floating', component: StubComponent });
      const replacementSurface = manager.activeFloating.value;

      await expect(firstHandle.result).resolves.toEqual({ status: 'replaced', replacedBy: 'shared' });

      staleSurface.close('stale-close');

      let replacementSettled = false;
      replacementHandle.result.then(() => {
        replacementSettled = true;
      });
      await Promise.resolve();

      expect(manager.activeFloating.value).toBe(replacementSurface);
      expect(replacementSettled).toBe(false);

      replacementSurface.close('fresh-close');
      await expect(replacementHandle.result).resolves.toEqual({ status: 'closed', reason: 'fresh-close' });
      expect(manager.activeFloating.value).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // First settle wins
  // -----------------------------------------------------------------------

  describe('first settle wins', () => {
    it('ignores a second resolve() call', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      const surface = manager.activeDialog.value;

      surface.resolve('first');
      surface.resolve('second');

      const outcome = await handle.result;
      expect(outcome.data).toBe('first');
    });

    it('ignores close() after resolve()', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      const surface = manager.activeDialog.value;

      surface.resolve('data');
      surface.close('nope');

      const outcome = await handle.result;
      expect(outcome.status).toBe('submitted');
    });

    it('ignores resolve() after close()', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      const surface = manager.activeDialog.value;

      surface.close();
      surface.resolve('too late');

      const outcome = await handle.result;
      expect(outcome.status).toBe('closed');
    });
  });

  // -----------------------------------------------------------------------
  // settleAll()
  // -----------------------------------------------------------------------

  describe('settleAll()', () => {
    it('settles all active surfaces and clears slots', async () => {
      const dh = manager.open({ mode: 'dialog', component: StubComponent });
      const fh = manager.open({ mode: 'floating', component: StubComponent });

      manager.settleAll({ status: 'closed', reason: 'runtime-restart' });

      const [dOut, fOut] = await Promise.all([dh.result, fh.result]);
      expect(dOut).toEqual({ status: 'closed', reason: 'runtime-restart' });
      expect(fOut).toEqual({ status: 'closed', reason: 'runtime-restart' });
      expect(manager.activeDialog.value).toBeNull();
      expect(manager.activeFloating.value).toBeNull();
    });

    it('is safe to call when no surfaces are active', () => {
      expect(() => manager.settleAll({ status: 'destroyed' })).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // destroy()
  // -----------------------------------------------------------------------

  describe('destroy()', () => {
    it('settles all surfaces with "destroyed"', async () => {
      const handle = manager.open({ mode: 'dialog', component: StubComponent });
      manager.destroy();

      const outcome = await handle.result;
      expect(outcome.status).toBe('destroyed');
    });

    it('subsequent open() returns an immediately-destroyed handle', async () => {
      manager.destroy();
      const handle = manager.open({ mode: 'dialog', component: StubComponent });

      const outcome = await handle.result;
      expect(outcome.status).toBe('destroyed');
    });
  });

  // -----------------------------------------------------------------------
  // Request normalization
  // -----------------------------------------------------------------------

  describe('request normalization', () => {
    it('merges module-level dialog defaults', () => {
      const m = createManager({
        dialog: { closeOnEscape: false, closeOnBackdrop: false },
      });
      m.open({ mode: 'dialog', component: StubComponent });

      const req = m.activeDialog.value.request;
      expect(req.closeOnEscape).toBe(false);
      expect(req.closeOnBackdrop).toBe(false);
    });

    it('request-level overrides win over module-level defaults', () => {
      const m = createManager({
        dialog: { closeOnEscape: false },
      });
      m.open({ mode: 'dialog', component: StubComponent, closeOnEscape: true });

      expect(m.activeDialog.value.request.closeOnEscape).toBe(true);
    });

    it('merges module-level floating defaults', () => {
      const m = createManager({
        floating: { closeOnEscape: false },
      });
      m.open({ mode: 'floating', component: StubComponent });

      expect(m.activeFloating.value.request.closeOnEscape).toBe(false);
    });

    it('defaults closeOnEscape to true when not configured', () => {
      manager.open({ mode: 'dialog', component: StubComponent });
      expect(manager.activeDialog.value.request.closeOnEscape).toBe(true);
    });

    it('defaults closeOnBackdrop to true for dialogs', () => {
      manager.open({ mode: 'dialog', component: StubComponent });
      expect(manager.activeDialog.value.request.closeOnBackdrop).toBe(true);
    });

    it('forces closeOnBackdrop to false for floating', () => {
      manager.open({ mode: 'floating', component: StubComponent });
      expect(manager.activeFloating.value.request.closeOnBackdrop).toBe(false);
    });

    it('merges module-level dialog.maxWidth into request.dialog', () => {
      const m = createManager({ dialog: { maxWidth: '600px' } });
      m.open({ mode: 'dialog', component: StubComponent });

      expect(m.activeDialog.value.request.dialog?.maxWidth).toBe('600px');
    });

    it('request-level dialog.maxWidth wins over module-level', () => {
      const m = createManager({ dialog: { maxWidth: '600px' } });
      m.open({ mode: 'dialog', component: StubComponent, dialog: { maxWidth: '400px' } });

      expect(m.activeDialog.value.request.dialog?.maxWidth).toBe('400px');
    });

    it('defaults floating.placement to top-right when nothing is configured', () => {
      manager.open({ mode: 'floating', component: StubComponent });
      expect(manager.activeFloating.value.request.floating?.placement).toBe('top-right');
    });

    it('merges module-level floating.width into request.floating', () => {
      const m = createManager({ floating: { width: 500 } });
      m.open({ mode: 'floating', component: StubComponent });

      expect(m.activeFloating.value.request.floating?.width).toBe(500);
    });

    it('request-level floating.width wins over module-level', () => {
      const m = createManager({ floating: { width: 500 } });
      m.open({ mode: 'floating', component: StubComponent, floating: { width: 350 } });

      expect(m.activeFloating.value.request.floating?.width).toBe(350);
    });

    it('merges module-level floating.maxWidth into request.floating', () => {
      const m = createManager({ floating: { maxWidth: '800px' } });
      m.open({ mode: 'floating', component: StubComponent });

      expect(m.activeFloating.value.request.floating?.maxWidth).toBe('800px');
    });

    it('merges module-level floating.maxHeight into request.floating', () => {
      const m = createManager({ floating: { maxHeight: '600px' } });
      m.open({ mode: 'floating', component: StubComponent });

      expect(m.activeFloating.value.request.floating?.maxHeight).toBe('600px');
    });

    it('defaults floating.autoFocus to true', () => {
      manager.open({ mode: 'floating', component: StubComponent });
      expect(manager.activeFloating.value.request.floating?.autoFocus).toBe(true);
    });

    it('defaults floating.closeOnOutsidePointerDown to false', () => {
      manager.open({ mode: 'floating', component: StubComponent });
      expect(manager.activeFloating.value.request.floating?.closeOnOutsidePointerDown).toBe(false);
    });

    it('request-level explicit top/right/bottom/left pass through unchanged', () => {
      manager.open({
        mode: 'floating',
        component: StubComponent,
        floating: { top: 10, right: 20, bottom: 30, left: 40 },
      });

      const opts = manager.activeFloating.value.request.floating;
      expect(opts.top).toBe(10);
      expect(opts.right).toBe(20);
      expect(opts.bottom).toBe(30);
      expect(opts.left).toBe(40);
    });
  });

  // -----------------------------------------------------------------------
  // Resolver call semantics
  // -----------------------------------------------------------------------

  describe('resolver semantics', () => {
    it('resolver receives the normalized request (with generated id)', () => {
      const resolverSpy = vi.fn(() => ({ type: 'custom', component: StubComponent }));
      const m = createManager({ resolver: resolverSpy });

      m.open({ kind: 'test', mode: 'dialog' });

      expect(resolverSpy).toHaveBeenCalledTimes(1);
      const receivedReq = resolverSpy.mock.calls[0][0];
      expect(receivedReq.id).toBeDefined();
      expect(receivedReq.kind).toBe('test');
    });

    it('direct-render requests bypass the resolver entirely', () => {
      const resolverSpy = vi.fn();
      const m = createManager({ resolver: resolverSpy });

      m.open({ mode: 'dialog', component: StubComponent });
      expect(resolverSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // No unhandled promise rejections
  // -----------------------------------------------------------------------

  describe('no unhandled rejections', () => {
    it('handle.result never rejects on replace', async () => {
      const h1 = manager.open({ mode: 'dialog', component: StubComponent });
      manager.open({ mode: 'dialog', component: StubComponent });

      // Should resolve, not reject
      const outcome = await h1.result;
      expect(outcome.status).toBe('replaced');
    });

    it('handle.result never rejects on settleAll', async () => {
      const h = manager.open({ mode: 'dialog', component: StubComponent });
      manager.settleAll({ status: 'closed', reason: 'restart' });

      const outcome = await h.result;
      expect(outcome.status).toBe('closed');
    });

    it('handle.result never rejects on destroy', async () => {
      const h = manager.open({ mode: 'floating', component: StubComponent });
      manager.destroy();

      const outcome = await h.result;
      expect(outcome.status).toBe('destroyed');
    });
  });
});
