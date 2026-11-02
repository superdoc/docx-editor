import type { ActiveSurface } from '../core/surface-manager.js';
import type { DirectSurfaceRequest } from '../core/types/index.js';

export function surfaceRequest(overrides: Partial<DirectSurfaceRequest> = {}): DirectSurfaceRequest {
  return { mode: 'dialog', ...overrides } satisfies DirectSurfaceRequest;
}

export function activeSurface(overrides: Partial<Omit<ActiveSurface, 'mode'>> = {}): ActiveSurface {
  const request = overrides.request ?? surfaceRequest();
  return {
    id: 'surface-1',
    request,
    resolve: () => {},
    close: () => {},
    settle: () => false,
    settled: false,
    ...overrides,
    mode: request.mode,
  } satisfies ActiveSurface;
}
