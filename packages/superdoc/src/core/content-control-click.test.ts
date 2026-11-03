import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('./v2-integration/v2-integration.js', () => ({
  loadDefaultV2IntegrationOrFallback: () => new Promise(() => {}),
}));

const { SuperDoc } = await import('./SuperDoc.js');
type SuperDocInstance = InstanceType<typeof SuperDoc>;

type ContentControl = {
  id: string;
  kind: 'inline' | 'block';
  controlType: string;
  properties: {
    alias?: string;
    tag?: string;
  };
};

const instances: SuperDocInstance[] = [];

function mountWithControls(controls: () => ContentControl[]) {
  const selector = document.createElement('div');
  document.body.append(selector);

  const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
  const focus = vi.fn();
  superdoc.activeEditor = {
    editorVersion: 2,
    focus,
    doc: {
      contentControls: {
        list(this: unknown) {
          if (this !== undefined) throw new Error('Document API facade functions must be called detached');
          return Promise.resolve({ items: controls() });
        },
      },
    },
  } as never;
  instances.push(superdoc);

  return { focus, selector, superdoc };
}

function appendControl(
  parent: ParentNode,
  control: Pick<ContentControl, 'id' | 'kind'>,
  text: string,
  options: { containerId?: string; containerOnly?: boolean } = {},
): HTMLElement {
  const element = document.createElement(control.kind === 'inline' ? 'span' : 'div');
  // DomPainter stamps primary attrs.sdt as data-sdt-* and attrs.containerSdt as
  // data-sdt-container-*. Container-only chrome omits the primary keys entirely.
  if (options.containerOnly) {
    element.dataset.sdtContainerType = 'structuredContent';
    element.dataset.sdtContainerId = options.containerId ?? control.id;
  } else {
    element.dataset.sdtId = control.id;
    element.dataset.sdtType = 'structuredContent';
    element.dataset.sdtScope = control.kind;
    if (options.containerId) {
      element.dataset.sdtContainerId = options.containerId;
      element.dataset.sdtContainerType = 'structuredContent';
    }
  }
  if (text) element.textContent = text;
  parent.append(element);
  return element;
}

function appendBlockLabel(parent: HTMLElement, text = 'Label'): HTMLElement {
  const label = document.createElement('div');
  label.className = 'superdoc-structured-content__label';
  label.textContent = text;
  parent.append(label);
  return label;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

describe('content-control:click', () => {
  it('emits once for the innermost clicked inline or block control with its public metadata', async () => {
    const controls: ContentControl[] = [
      {
        id: 'block-1',
        kind: 'block',
        controlType: 'richText',
        properties: { alias: 'Block control', tag: 'block-tag' },
      },
      {
        id: 'inline-1',
        kind: 'inline',
        controlType: 'checkbox',
        properties: { alias: 'Inline control', tag: 'inline-tag' },
      },
    ];
    const { selector, superdoc } = mountWithControls(() => controls);
    const block = appendControl(selector, controls[0], '');
    const painterHost = document.createElement('div');
    painterHost.addEventListener('click', (event) => event.stopPropagation());
    block.append(painterHost);
    const inline = appendControl(painterHost.attachShadow({ mode: 'open' }), controls[1], 'Inline target');
    const payloads: unknown[] = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    inline.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    block.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(payloads).toEqual([
        {
          source: 'pointer',
          target: {
            alias: 'Inline control',
            controlType: 'checkbox',
            id: 'inline-1',
            scope: 'inline',
            tag: 'inline-tag',
          },
        },
        {
          source: 'pointer',
          target: {
            alias: 'Block control',
            controlType: 'richText',
            id: 'block-1',
            scope: 'block',
            tag: 'block-tag',
          },
        },
      ]);
    });
  });

  it('does not report programmatic focus as a content-control click', async () => {
    const controls: ContentControl[] = [{ id: 'inline-1', kind: 'inline', controlType: 'text', properties: {} }];
    const { focus, superdoc } = mountWithControls(() => controls);
    const payloads: unknown[] = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    superdoc.focus();
    await Promise.resolve();

    expect(focus).toHaveBeenCalledOnce();
    expect(payloads).toEqual([]);
  });

  it('keeps resolving clicks after rendered content and the live catalog update', async () => {
    let controls: ContentControl[] = [{ id: 'before-import', kind: 'inline', controlType: 'text', properties: {} }];
    const { selector, superdoc } = mountWithControls(() => controls);
    const payloads: Array<{ target: { id: string } }> = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    appendControl(selector, controls[0], 'Before import').click();
    controls = [{ id: 'after-update', kind: 'block', controlType: 'richText', properties: {} }];
    selector.replaceChildren();
    appendControl(selector, controls[0], 'After update').click();

    await vi.waitFor(() => {
      expect(payloads.map(({ target }) => target.id)).toEqual(['before-import', 'after-update']);
    });
  });

  it('emits the container id when clicking a nested block chrome label', async () => {
    const controls: ContentControl[] = [
      {
        id: 'outer-container',
        kind: 'block',
        controlType: 'richText',
        properties: { alias: 'Outer block' },
      },
      {
        id: 'inner-child',
        kind: 'block',
        controlType: 'richText',
        properties: { alias: 'Inner block' },
      },
    ];
    const { selector, superdoc } = mountWithControls(() => controls);
    // Nested block frames carry data-sdt-id for the nearest child and
    // data-sdt-container-id for the outer control whose chrome is painted.
    const frame = appendControl(selector, controls[1], '', { containerId: 'outer-container' });
    const label = appendBlockLabel(frame, 'Outer');
    const labelText = document.createElement('span');
    labelText.textContent = 'Outer';
    label.replaceChildren(labelText);
    const payloads: Array<{ target: { id: string; alias?: string } }> = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    labelText.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(payloads).toEqual([
        {
          source: 'pointer',
          target: {
            alias: 'Outer block',
            controlType: 'richText',
            id: 'outer-container',
            scope: 'block',
          },
        },
      ]);
    });
  });

  it('emits the container id for container-only block fragments with no data-sdt-type', async () => {
    const controls: ContentControl[] = [
      {
        id: 'container-only',
        kind: 'block',
        controlType: 'richText',
        properties: { alias: 'Container only' },
      },
    ];
    const { selector, superdoc } = mountWithControls(() => controls);
    // Mirror DomPainter: chrome from attrs.containerSdt alone stamps
    // data-sdt-container-type/id and omits data-sdt-type/id entirely.
    const frame = appendControl(selector, controls[0], '', {
      containerId: 'container-only',
      containerOnly: true,
    });
    const body = document.createElement('p');
    body.textContent = 'Body';
    frame.append(body);
    const label = appendBlockLabel(frame);
    const payloads: Array<{ target: { id: string } }> = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    expect(frame.hasAttribute('data-sdt-type')).toBe(false);
    expect(frame.hasAttribute('data-sdt-id')).toBe(false);
    expect(frame.dataset.sdtContainerType).toBe('structuredContent');

    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(payloads.map(({ target }) => target.id)).toEqual(['container-only', 'container-only']);
    });
  });

  it('ignores container-only documentSection frames that are not content controls', async () => {
    const controls: ContentControl[] = [{ id: 'sc-1', kind: 'block', controlType: 'richText', properties: {} }];
    const { selector, superdoc } = mountWithControls(() => controls);
    const section = document.createElement('div');
    section.className = 'superdoc-document-section';
    section.dataset.sdtContainerType = 'documentSection';
    section.dataset.sdtContainerId = 'section-1';
    const label = appendBlockLabel(section, 'Section');
    selector.append(section);
    const payloads: unknown[] = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(payloads).toEqual([]);
  });

  it('prefers the nearest child id for nested block body clicks, not the container', async () => {
    const controls: ContentControl[] = [
      {
        id: 'outer-container',
        kind: 'block',
        controlType: 'richText',
        properties: { alias: 'Outer block' },
      },
      {
        id: 'inner-child',
        kind: 'block',
        controlType: 'richText',
        properties: { alias: 'Inner block' },
      },
    ];
    const { selector, superdoc } = mountWithControls(() => controls);
    const frame = appendControl(selector, controls[1], '', { containerId: 'outer-container' });
    appendBlockLabel(frame, 'Outer');
    const body = document.createElement('p');
    body.textContent = 'Inner body';
    frame.append(body);
    const payloads: Array<{ target: { id: string } }> = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    // Click the frame body (not the label): nearest-child id wins.
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(payloads.map(({ target }) => target.id)).toEqual(['inner-child']);
    });
  });

  it('resolves clicks for a ui.contentControls.onClick listener with no instance listener', async () => {
    const controls: ContentControl[] = [
      { id: 'ui-only', kind: 'inline', controlType: 'text', properties: { alias: 'Ui only' } },
    ];
    const { selector, superdoc } = mountWithControls(() => controls);
    const payloads: Array<{ target: { id: string } }> = [];
    const activePath = vi.fn();
    superdoc.ui.contentControls.onClick((payload) => payloads.push(payload));
    superdoc.ui.contentControls.observeActivePath(activePath);
    activePath.mockClear();

    expect(superdoc.listenerCount('content-control:click')).toBe(1);

    const control = appendControl(selector, controls[0], 'Ui only target');
    control.click();
    await vi.waitFor(() => {
      expect(payloads).toHaveLength(1);
    });
    control.click();

    await vi.waitFor(() => {
      expect(payloads.map(({ target }) => target.id)).toEqual(['ui-only', 'ui-only']);
    });
    expect(activePath).not.toHaveBeenCalled();
  });

  it('falls back to data-sdt-id when a block label click has no container id', async () => {
    const controls: ContentControl[] = [
      {
        id: 'block-simple',
        kind: 'block',
        controlType: 'richText',
        properties: {},
      },
    ];
    const { selector, superdoc } = mountWithControls(() => controls);
    const frame = appendControl(selector, controls[0], '');
    const label = appendBlockLabel(frame);
    const payloads: Array<{ target: { id: string } }> = [];
    superdoc.on('content-control:click', (payload) => payloads.push(payload));

    label.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(payloads.map(({ target }) => target.id)).toEqual(['block-simple']);
    });
  });
});
