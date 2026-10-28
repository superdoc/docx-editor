import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from './ui.js';

function fakeHostVisuals() {
  const disposed: string[] = [];
  let generation = 0;
  const highlight = vi.fn((id: string) => ({
    id,
    replace: vi.fn(),
    add: vi.fn(),
    clear: vi.fn(),
    invalidate: vi.fn(),
    dispose: vi.fn(() => disposed.push(id)),
  }));
  return {
    visuals: { highlight, generation: () => generation },
    disposed,
    nextGeneration: () => {
      generation += 1;
    },
  };
}

function setup(host: Record<string, unknown> | null) {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const superdoc = {
    activeEditor: host
      ? {
          doc: {},
          host,
          get visuals() {
            return (host as { getHostVisuals?: () => unknown }).getHostVisuals?.() ?? null;
          },
        }
      : null,
    config: { documentMode: 'editing' },
    on: vi.fn((event: string, listener: (payload?: unknown) => void) => listeners.set(event, listener)),
    off: vi.fn(),
  };
  return { ui: createSuperDocUI({ superdoc }), listeners, superdoc };
}

describe('ui.decorations', () => {
  it('creates a highlight through the host with the caller id', () => {
    const { visuals } = fakeHostVisuals();
    const { ui } = setup({ getHostVisuals: () => visuals });

    const handle = ui.decorations.highlight('finding-7', { className: 'finding' });

    expect(handle.id).toBe('finding-7');
    expect(visuals.highlight).toHaveBeenCalledWith('finding-7', { className: 'finding' });
  });

  it('disposes its own highlights on destroy and refuses new ones', () => {
    const { visuals, disposed } = fakeHostVisuals();
    const host = { getHostVisuals: () => visuals };
    const first = setup(host);
    const other = setup(host);
    first.ui.decorations.highlight('global');
    const scope = first.ui.createScope();
    scope.decorations.highlight('scoped');
    other.ui.decorations.highlight('other-controller');

    first.ui.destroy();

    expect(disposed.sort()).toEqual(['global', 'scoped']);
    expect(() => first.ui.decorations.highlight('late')).toThrow('destroyed');
    expect(() => scope.decorations.highlight('late')).toThrow('destroyed');
  });

  it('throws without a ready document', () => {
    const { ui } = setup({ getHostVisuals: () => null });

    expect(() => ui.decorations.highlight('finding')).toThrow('ready document');
  });

  it('disposes scope highlights with the scope and leaves others alone', () => {
    const { visuals, disposed } = fakeHostVisuals();
    const { ui } = setup({ getHostVisuals: () => visuals });
    const scope = ui.createScope();

    scope.decorations.highlight('scoped');
    ui.decorations.highlight('global');
    scope.dispose();

    expect(disposed).toEqual(['scoped']);
  });

  it('disposes highlights from the replaced document and keeps ones created for the new one', () => {
    const { visuals, disposed, nextGeneration } = fakeHostVisuals();
    const host = { getHostVisuals: () => visuals };
    const { ui, listeners, superdoc } = setup(host);
    ui.decorations.highlight('a');
    ui.createScope().decorations.highlight('b');
    nextGeneration();
    ui.decorations.highlight('created-for-new-document');

    listeners.get('document-replaced')?.({ editor: superdoc.activeEditor, host });

    expect(disposed.sort()).toEqual(['a', 'b']);
  });

  it('disposes highlights from a previous host when the editor changes', () => {
    const first = fakeHostVisuals();
    const second = fakeHostVisuals();
    let visuals = first.visuals;
    const host = { getHostVisuals: () => visuals };
    const { ui, listeners } = setup(host);
    ui.decorations.highlight('old-editor');
    visuals = second.visuals;

    listeners.get('active-editor-change')?.();

    expect(first.disposed).toEqual(['old-editor']);
  });
});

describe('ui.decorations.subscribe', () => {
  it('reports overlapping highlights without measuring unrelated tracked markers', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-superdoc-extension-decoration', 'outside-provider');
    const container = document.createElement('div');
    const paragraph = document.createElement('p');
    const highlight = document.createElement('span');
    highlight.setAttribute(
      'data-superdoc-extension-decorations',
      JSON.stringify(['outer-provider', 'inner provider', 'extension-only-provider']),
    );
    paragraph.setAttribute('data-superdoc-extension-decoration', 'outer-provider');
    paragraph.appendChild(highlight);
    container.appendChild(paragraph);
    const markerRect = vi.fn(() => ({ left: 100, top: 100, right: 110, bottom: 110 }) as DOMRect);
    for (let index = 0; index < 1000; index += 1) {
      const marker = document.createElement('span');
      marker.setAttribute('data-track-change-marker', 'true');
      marker.getBoundingClientRect = markerRect;
      container.appendChild(marker);
    }
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
    const originalElementFromPoint = document.elementFromPoint;
    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementFromPoint = () => highlight;
    document.elementsFromPoint = () => [highlight, paragraph, container, wrapper];
    const visuals = {
      ...fakeHostVisuals().visuals,
      providerOwner: (provider: string) =>
        provider === 'extension-only-provider'
          ? null
          : { id: provider === 'inner provider' ? 'inner' : provider.replace('-provider', '') },
      ownerById: (id: string) => ({ data: { id } }),
    };
    const superdoc = {
      activeEditor: { doc: {}, visuals, host: { getHostVisuals: () => visuals }, mount: { container } },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    const events: string[] = [];
    try {
      ui.decorations.subscribe((event) => events.push(`${event.type}:${event.id}`));
      for (const type of ['pointermove', 'pointermove', 'click']) {
        highlight.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }));
      }
      expect(events).toEqual(['hover-enter:outer', 'hover-enter:inner', 'click:outer', 'click:inner']);
      expect(markerRect).not.toHaveBeenCalled();
    } finally {
      ui.destroy();
      document.elementFromPoint = originalElementFromPoint;
      document.elementsFromPoint = originalElementsFromPoint;
      wrapper.remove();
    }
  });

  it('stops delivering events after unsubscribe and on destroy', () => {
    const { visuals } = fakeHostVisuals();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const removeListener = vi.spyOn(container, 'removeEventListener');
    const superdoc = {
      activeEditor: { doc: {}, host: { getHostVisuals: () => visuals }, mount: { container } },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    const unsubscribe = ui.decorations.subscribe(() => {});
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('click', expect.any(Function));

    ui.decorations.subscribe(() => {});
    removeListener.mockClear();
    ui.destroy();
    expect(removeListener).toHaveBeenCalledWith('click', expect.any(Function));
    expect(() => ui.decorations.subscribe(() => {})).toThrow('destroyed');
    container.remove();
  });
});
