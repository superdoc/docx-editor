import { shallowRef, type ShallowRef } from 'vue';
import type {
  DirectSurfaceRequest,
  SurfaceHandle,
  SurfaceMode,
  SurfaceOutcome,
  SurfaceRequest,
  SurfacesModuleConfig,
} from './types/index.js';

type SurfaceRender = NonNullable<DirectSurfaceRequest['render']>;

export interface ActiveSurface {
  id: string;
  mode: SurfaceMode;
  request: SurfaceRequest;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: SurfaceRender;
  resolve: (data?: unknown) => void;
  close: (reason?: unknown) => void;
  settle: (outcome: SurfaceOutcome) => boolean;
  readonly settled: boolean;
}

type SurfaceRendering = Pick<ActiveSurface, 'component' | 'props' | 'render'>;

const VALID_MODES = ['dialog', 'floating'] as const;

const VALID_PLACEMENTS = [
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'top-center',
  'bottom-center',
] as const;

function validateRequest(request: SurfaceRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('SurfaceManager: request must be a non-null object.');
  }

  if (!VALID_MODES.includes(request.mode)) {
    throw new Error(`SurfaceManager: mode must be "dialog" or "floating", got "${request.mode}".`);
  }

  const hasKind = 'kind' in request && request.kind != null;
  const hasComponent = 'component' in request && request.component != null;
  const hasRender = 'render' in request && typeof request.render === 'function';

  if (hasComponent && hasRender) {
    throw new Error('SurfaceManager: request cannot provide both "component" and "render". Use one or the other.');
  }

  if (!hasKind && !hasComponent && !hasRender) {
    throw new Error(
      'SurfaceManager: request must provide "kind" (intent-based) or "component"/"render" (direct-render).',
    );
  }

  if (request.mode === 'floating' && request.floating?.placement != null) {
    if (!VALID_PLACEMENTS.includes(request.floating.placement)) {
      throw new Error(
        `SurfaceManager: floating.placement must be one of ${VALID_PLACEMENTS.join(', ')}, got "${request.floating.placement}".`,
      );
    }
  }
}

function requestKind(request: SurfaceRequest): string | undefined {
  return 'kind' in request ? request.kind : undefined;
}

export class SurfaceManager {
  activeDialog: ShallowRef<ActiveSurface | null> = shallowRef(null);

  activeFloating: ShallowRef<ActiveSurface | null> = shallowRef(null);

  #destroyed = false;

  #nextId = 1;

  #getModuleConfig: () => SurfacesModuleConfig | undefined;

  constructor({ getModuleConfig }: { getModuleConfig: () => SurfacesModuleConfig | undefined }) {
    this.#getModuleConfig = getModuleConfig;
  }

  open(rawRequest: SurfaceRequest): SurfaceHandle {
    if (this.#destroyed) {
      return this.#createDestroyedHandle(rawRequest);
    }

    validateRequest(rawRequest);

    const request = this.#normalizeRequest(rawRequest);
    const { component, props, render } = this.#resolveRendering(request);

    let settle: (outcome: SurfaceOutcome) => boolean;
    let settled = false;

    const result = new Promise<SurfaceOutcome>((resolve) => {
      settle = (outcome) => {
        if (settled) return false;
        settled = true;
        resolve(outcome);
        return true;
      };
    });

    const resolveContent = (data?: unknown): void => {
      if (!settle({ status: 'submitted', data })) return;
      this.#clearSlot(surface);
    };
    const closeContent = (reason?: unknown): void => {
      if (!settle({ status: 'closed', reason })) return;
      this.#clearSlot(surface);
    };

    const surface: ActiveSurface = {
      id: request.id,
      mode: request.mode,
      request,
      component,
      props,
      render,
      resolve: resolveContent,
      close: closeContent,
      settle: (outcome) => settle(outcome),
      get settled() {
        return settled;
      },
    };

    const slot = request.mode === 'dialog' ? 'activeDialog' : 'activeFloating';
    const previous = this[slot].value;
    if (previous && !previous.settled) {
      previous.settle({ status: 'replaced', replacedBy: request.id });
    }
    this[slot].value = surface;

    return {
      id: request.id,
      mode: request.mode,
      close: (reason) => this.#closeSurface(surface, reason),
      result,
    };
  }

  close(id?: string, reason?: unknown): void {
    if (id != null) {
      const surface = this.#findById(id);
      if (surface) this.#closeSurface(surface, reason);
      return;
    }

    const dialog = this.activeDialog.value;
    if (dialog && !dialog.settled) {
      this.#closeSurface(dialog, reason);
      return;
    }
    const floating = this.activeFloating.value;
    if (floating && !floating.settled) {
      this.#closeSurface(floating, reason);
    }
  }

  settleAll(outcome: SurfaceOutcome): void {
    for (const slot of [this.activeDialog, this.activeFloating]) {
      const surface = slot.value;
      if (surface && !surface.settled) {
        surface.settle(outcome);
      }
      slot.value = null;
    }
  }

  destroy(): void {
    this.#destroyed = true;
    this.settleAll({ status: 'destroyed' });
  }

  #closeSurface(surface: ActiveSurface, reason?: unknown): void {
    if (surface.settled) return;
    surface.settle({ status: 'closed', reason });
    this.#clearSlot(surface);
  }

  #clearSlot(surface: ActiveSurface): void {
    const slot = surface.mode === 'dialog' ? this.activeDialog : this.activeFloating;
    if (slot.value === surface) {
      slot.value = null;
    }
  }

  #findById(id: string): ActiveSurface | null {
    if (this.activeDialog.value?.id === id) return this.activeDialog.value;
    if (this.activeFloating.value?.id === id) return this.activeFloating.value;
    return null;
  }

  #normalizeRequest(raw: SurfaceRequest): SurfaceRequest & { id: string } {
    const id = raw.id ?? `surface-${this.#nextId++}`;
    const moduleConfig: SurfacesModuleConfig = this.#getModuleConfig() ?? {};
    const dialogDefaults = moduleConfig.dialog;
    const floatingDefaults = moduleConfig.floating;
    const modeDefaults = raw.mode === 'dialog' ? dialogDefaults : floatingDefaults;

    const normalizedDialog = raw.mode === 'dialog' ? { maxWidth: dialogDefaults?.maxWidth, ...raw.dialog } : raw.dialog;

    const normalizedFloating =
      raw.mode === 'floating'
        ? {
            placement: floatingDefaults?.placement ?? 'top-right',
            width: floatingDefaults?.width,
            maxWidth: floatingDefaults?.maxWidth,
            maxHeight: floatingDefaults?.maxHeight,
            autoFocus: floatingDefaults?.autoFocus ?? true,
            closeOnOutsidePointerDown: floatingDefaults?.closeOnOutsidePointerDown ?? false,
            ...raw.floating,
          }
        : raw.floating;

    return {
      ...raw,
      id,
      closeOnEscape: raw.closeOnEscape ?? modeDefaults?.closeOnEscape ?? true,
      closeOnBackdrop: raw.mode === 'dialog' ? (raw.closeOnBackdrop ?? dialogDefaults?.closeOnBackdrop ?? true) : false,
      dialog: normalizedDialog,
      floating: normalizedFloating,
    };
  }

  #resolveRendering(request: SurfaceRequest): SurfaceRendering {
    if ('component' in request && request.component != null) {
      return { component: request.component, props: request.props };
    }
    if ('render' in request && typeof request.render === 'function') {
      return { render: request.render };
    }

    const moduleConfig = this.#getModuleConfig();
    const resolver = moduleConfig?.resolver;

    if (typeof resolver === 'function') {
      const resolution = resolver(request);

      if (resolution != null) {
        if (resolution.type === 'none') {
          throw new Error(`SurfaceManager: resolver explicitly suppressed surface for kind "${requestKind(request)}".`);
        }
        if (resolution.type === 'custom') {
          return { component: resolution.component, props: resolution.props };
        }
        if (resolution.type === 'external') {
          return { render: resolution.render };
        }
      }
    }

    throw new Error(
      `SurfaceManager: no renderer resolved for kind "${requestKind(request)}". ` +
        'Provide a resolver via surfaces.resolver, or use a direct-render request.',
    );
  }

  #createDestroyedHandle(rawRequest: SurfaceRequest | null | undefined): SurfaceHandle {
    const id = rawRequest?.id ?? `surface-${this.#nextId++}`;
    const mode = rawRequest?.mode ?? 'dialog';
    return {
      id,
      mode,
      close: () => {},
      result: Promise.resolve({ status: 'destroyed' }),
    };
  }
}
