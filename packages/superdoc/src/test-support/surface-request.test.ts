import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import type { ActiveSurface } from '../core/surface-manager.js';
import type { DirectSurfaceRequest } from '../core/types/index.js';
import { activeSurface, surfaceRequest } from './surface-request.js';

describe('surfaceRequest', () => {
  it('returns a dialog request with only the required mode by default', () => {
    expect(surfaceRequest()).toEqual({ mode: 'dialog' });
    expectTypeOf(surfaceRequest()).toEqualTypeOf<DirectSurfaceRequest>();
  });

  it('applies overrides', () => {
    expect(surfaceRequest({ id: 'float-1', mode: 'floating', floating: { autoFocus: true } })).toEqual({
      id: 'float-1',
      mode: 'floating',
      floating: { autoFocus: true },
    });
  });
});

describe('activeSurface', () => {
  it('takes its mode only from the request, so mode and request.mode always agree', () => {
    expect(activeSurface().mode).toBe('dialog');
    expectTypeOf<'mode'>().not.toMatchTypeOf<keyof NonNullable<Parameters<typeof activeSurface>[0]>>();
  });

  it('returns an unsettled surface whose mode follows its request', () => {
    const surface = activeSurface({ request: surfaceRequest({ mode: 'floating' }) });

    expectTypeOf(surface).toEqualTypeOf<ActiveSurface>();
    expect(surface.id).toBe('surface-1');
    expect(surface.mode).toBe('floating');
    expect(surface.request).toEqual({ mode: 'floating' });
    expect(surface.settled).toBe(false);
    expect(surface.settle({ status: 'closed' })).toBe(false);
    expect(surface.resolve()).toBeUndefined();
    expect(surface.close()).toBeUndefined();
  });

  it('keeps every override, including members the defaults also set', () => {
    const resolve = () => {};
    const surface = activeSurface({ id: 'float-1', props: { a: 1 }, resolve });

    expect(surface.id).toBe('float-1');
    expect(surface.props).toEqual({ a: 1 });
    expect(surface.resolve).toBe(resolve);
  });
});
