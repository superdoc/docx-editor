import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { useLinkPopover } from './use-link-popover.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function createHandle() {
  let settle;
  return {
    id: 'link-popover',
    mode: 'floating',
    close: vi.fn((reason) => settle?.({ status: 'closed', reason })),
    result: new Promise((resolve) => {
      settle = resolve;
    }),
  };
}

function createManagerStub() {
  const handles = [];
  return {
    open: vi.fn(() => {
      const handle = createHandle();
      handles.push(handle);
      return handle;
    }),
    handles,
  };
}

function createPayload(overrides = {}) {
  const element = document.createElement('a');
  element.href = overrides.href ?? 'https://example.com';
  return {
    href: 'https://example.com',
    target: '_blank',
    rel: 'noopener',
    tooltip: 'Example',
    element,
    clientX: 42,
    clientY: 64,
    documentMode: 'editing',
    editableText: true,
    ...overrides,
  };
}

function createSubject({
  resolver,
  handlerSource = null,
  manager = createManagerStub(),
  editor = { id: 'editor' },
  ui,
  builtInEditorDisabled = false,
  interceptsNavigationOnly = false,
} = {}) {
  const layer = document.createElement('div');
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  });
  const emitException = vi.fn();
  const uiController = ui ?? { id: 'ui' };
  const popover = useLinkPopover({
    getSurfaceManager: () => manager,
    getActiveEditor: () => editor,
    getUi: () => uiController,
    getActivationHandler: () => resolver,
    getActivationHandlerSource: () => handlerSource,
    getBuiltInEditorDisabled: () => builtInEditorDisabled,
    shouldInterceptNavigationOnlyHyperlinks: () => interceptsNavigationOnly,
    getLayerElement: () => layer,
    emitException,
  });
  return { popover, manager, emitException, ui: uiController, editor };
}

describe('useLinkPopover', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([undefined, null, ''])('SD-5415 missing or empty href %s cannot navigate or place a caret', async (href) => {
    const setSelectionTarget = vi.fn();
    const getBookmark = vi.fn();
    const editor = {
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: getBookmark } },
    };
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { popover } = createSubject({ editor });

    expect(() => popover.handleLinkClick(createPayload({ href }))).not.toThrow();
    await tick();

    expect(getBookmark).not.toHaveBeenCalled();
    expect(setSelectionTarget).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    popover.destroy();
  });

  it('opens the built-in link popover for editing mode without a resolver', async () => {
    const { popover, manager, ui } = createSubject();

    popover.handleLinkClick(createPayload());
    await tick();

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(request).toMatchObject({
      id: 'link-popover',
      mode: 'floating',
      closeOnEscape: true,
      floating: {
        left: '32px',
        top: '44px',
        closeOnOutsidePointerDown: true,
      },
    });
    expect(request.component).toBeDefined();
    expect(request.props).toMatchObject({
      href: 'https://example.com',
      target: '_blank',
      rel: 'noopener',
      tooltip: 'Example',
      documentMode: 'editing',
      ui,
    });
  });

  it('opens the built-in popover with the current doc-api href when the clicked DOM link is stale', async () => {
    const element = document.createElement('a');
    element.href = 'https://old.example/';
    element.dataset.linkRid = 'rId-old';
    element.textContent = 'SuperDoc website';
    const editor = {
      doc: {
        hyperlinks: {
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    rId: 'rId-new',
                    text: 'SuperDoc website',
                    targetKind: 'external',
                    externalTarget: 'https://new.example/',
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://old.example/',
      }),
    );
    await tick();

    const request = manager.open.mock.calls[0][0];
    expect(request.props.href).toBe('https://new.example/');
    expect(request.props.hyperlinkTarget).toMatchObject({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:1',
      href: 'https://new.example/',
    });
  });

  it('resolves the exact Document API address for a custom hyperlink action', async () => {
    const address = {
      kind: 'inline',
      nodeType: 'hyperlink',
      anchor: {
        start: { blockId: 'p-1', offset: 0 },
        end: { blockId: 'p-1', offset: 8 },
      },
    };
    const list = vi.fn(() => ({
      stories: [
        {
          storyId: 'main:/word/document.xml',
          hyperlinks: [
            {
              hyperlinkNodeId: 'hl:1',
              text: 'Example',
              externalTarget: 'https://example.com',
              address,
            },
          ],
        },
      ],
    }));
    const resolver = vi.fn((context) => {
      void context.getDocumentTarget();
      void context.getDocumentTarget();
      return { type: 'none' };
    });
    const { popover } = createSubject({
      editor: { doc: { hyperlinks: { list } } },
      resolver,
      handlerSource: 'hyperlinks.onActivate',
    });
    const element = document.createElement('a');
    element.textContent = 'Example';

    popover.handleLinkClick(createPayload({ element }));
    await tick();

    const context = resolver.mock.calls[0][0];
    await expect(context.getDocumentTarget()).resolves.toEqual(address);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does not expose a body Document API target for an identical header hyperlink', async () => {
    const bodyAddress = {
      kind: 'inline',
      nodeType: 'hyperlink',
      anchor: {
        start: { blockId: 'body-p-1', offset: 0 },
        end: { blockId: 'body-p-1', offset: 7 },
      },
    };
    const list = vi.fn(() => ({
      stories: [
        {
          storyId: 'main:/word/document.xml',
          partUri: '/word/document.xml',
          hyperlinks: [
            {
              hyperlinkNodeId: 'body-link',
              rId: 'rId1',
              text: 'Example',
              externalTarget: 'https://example.com',
              address: bodyAddress,
            },
          ],
        },
        {
          storyId: 'header:/word/header1.xml',
          partUri: '/word/header1.xml',
          hyperlinks: [
            {
              hyperlinkNodeId: 'header-link',
              rId: 'rId1',
              text: 'Example',
              externalTarget: 'https://example.com',
            },
          ],
        },
      ],
    }));
    const get = vi.fn(() => ({
      success: true,
      hyperlink: {
        hyperlinkNodeId: 'header-link',
        rId: 'rId1',
        text: 'Example',
        externalTarget: 'https://example.com',
      },
    }));
    const resolver = vi.fn(() => ({ type: 'none' }));
    const { popover } = createSubject({
      editor: { doc: { hyperlinks: { list, get } } },
      resolver,
      handlerSource: 'hyperlinks.onActivate',
    });
    const fragment = document.createElement('p');
    fragment.dataset.blockId = 'header-p-1';
    fragment.dataset.pmStart = '1';
    fragment.dataset.sourceAnchor = JSON.stringify({
      sourceRef: { partUri: '/word/header1.xml', xpathLikePath: '/w:hdr[1]/w:p[ordinal=0]' },
    });
    const element = document.createElement('a');
    element.href = 'https://example.com';
    element.dataset.linkRid = 'rId1';
    element.textContent = 'Example';
    fragment.append(element);

    popover.handleLinkClick(createPayload({ element }));
    await tick();

    const context = resolver.mock.calls[0][0];
    await expect(context.getDocumentTarget()).resolves.toBeNull();
    expect(get).toHaveBeenCalledWith({
      storyId: 'header:/word/header1.xml',
      hyperlinkNodeId: 'header-link',
    });
  });

  it('opens the built-in popover with a hyperlink target from async worker-backed reads', async () => {
    const element = document.createElement('a');
    element.href = 'https://old.example/';
    element.dataset.linkRid = 'rId-worker';
    element.textContent = 'SuperDoc website';
    const editor = {
      doc: {
        hyperlinks: {
          list: () =>
            Promise.resolve({
              stories: [
                {
                  storyId: 'main:/word/document.xml',
                  hyperlinks: [
                    {
                      hyperlinkNodeId: 'hl:worker',
                      rId: 'rId-worker',
                      text: 'SuperDoc website',
                      targetKind: 'external',
                      externalTarget: 'https://worker.example/',
                    },
                  ],
                },
              ],
            }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://old.example/',
      }),
    );
    await tick();

    const request = manager.open.mock.calls[0][0];
    expect(request.props.href).toBe('https://worker.example/');
    expect(request.props.hyperlinkTarget).toMatchObject({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:worker',
      href: 'https://worker.example/',
    });
  });

  it('does not open a stale built-in popover after an async hyperlink read is cancelled', async () => {
    let resolveList;
    const editor = {
      doc: {
        hyperlinks: {
          list: () =>
            new Promise((resolve) => {
              resolveList = resolve;
            }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(createPayload());
    popover.destroy();
    resolveList?.({ stories: [] });
    await tick();

    expect(manager.open).not.toHaveBeenCalled();
  });

  it('opens the built-in popover with full text and target for a clicked link segment', async () => {
    const element = document.createElement('a');
    element.href = 'https://example.com/';
    element.textContent = 'Super';
    const editor = {
      doc: {
        hyperlinks: {
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    text: 'SuperDoc website',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                    address: {
                      kind: 'inline',
                      nodeType: 'hyperlink',
                      anchor: {
                        start: { blockId: 'P1', offset: 10 },
                        end: { blockId: 'P1', offset: 26 },
                      },
                    },
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://example.com/',
      }),
    );
    await tick();

    const request = manager.open.mock.calls[0][0];
    expect(request.props.hyperlinkText).toBe('SuperDoc website');
    expect(request.props.textTarget).toEqual({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 10 },
      end: { kind: 'text', blockId: 'P1', offset: 26 },
    });
  });

  it('does not project cross-block hyperlink addresses into selection targets', async () => {
    const element = document.createElement('a');
    element.href = 'https://example.com/';
    element.textContent = 'SuperDoc website';
    const editor = {
      doc: {
        hyperlinks: {
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    text: 'SuperDoc website',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                    address: {
                      kind: 'inline',
                      nodeType: 'hyperlink',
                      anchor: {
                        start: { blockId: 'P1', offset: 10 },
                        end: { blockId: 'P2', offset: 6 },
                      },
                    },
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://example.com/',
      }),
    );
    await tick();

    expect(manager.open.mock.calls[0][0].props.textTarget).toBeNull();
  });

  it('loads full text target details when the hyperlink list row has no address', async () => {
    const fragment = document.createElement('p');
    fragment.dataset.blockId = 'P1';
    fragment.dataset.pmStart = '1';
    fragment.append('prefix ');
    const element = document.createElement('a');
    element.href = 'https://example.com/';
    element.textContent = 'Super';
    fragment.append(element);
    const get = vi.fn(() => ({
      success: true,
      hyperlink: {
        hyperlinkNodeId: 'hl:1',
        text: 'SuperDoc website',
        targetKind: 'external',
        externalTarget: 'https://example.com/',
        address: {
          kind: 'inline',
          nodeType: 'hyperlink',
          anchor: {
            start: { blockId: 'P1', offset: 7 },
            end: { blockId: 'P1', offset: 23 },
          },
        },
      },
    }));
    const editor = {
      doc: {
        hyperlinks: {
          get,
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    text: 'SuperDoc website',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://example.com/',
      }),
    );
    await tick();

    expect(get).toHaveBeenCalledWith({ storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' });
    expect(manager.open.mock.calls[0][0].props.textTarget).toEqual({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 7 },
      end: { kind: 'text', blockId: 'P1', offset: 23 },
    });
  });

  it('converts rendered absolute PM link positions into block-relative text targets', async () => {
    const fragment = document.createElement('p');
    fragment.dataset.blockId = 'P1';
    fragment.dataset.pmStart = '171';
    fragment.dataset.pmEnd = '246';
    fragment.append('External link 1: https://example.com   External link 2: ');
    const element = document.createElement('a');
    element.href = 'https://www.superdoc.dev/';
    element.dataset.linkRid = 'rId203';
    element.dataset.pmStart = '230';
    element.dataset.pmEnd = '246';
    element.textContent = 'SuperDoc website';
    fragment.append(element);
    const get = vi.fn(() => ({
      success: true,
      hyperlink: {
        hyperlinkNodeId: 'hl:869:1',
        rId: 'rId203',
        text: 'SuperDoc website',
        targetKind: 'external',
        externalTarget: 'https://www.superdoc.dev/',
      },
    }));
    const match = vi.fn(() => ({
      items: [
        {
          target: {
            kind: 'selection',
            start: { kind: 'text', blockId: 'P1', offset: 56 },
            end: { kind: 'text', blockId: 'P1', offset: 72 },
          },
        },
      ],
    }));
    const editor = {
      doc: {
        query: { match },
        hyperlinks: {
          get,
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:869:1',
                    rId: 'rId203',
                    text: 'SuperDoc website',
                    targetKind: 'external',
                    externalTarget: 'https://www.superdoc.dev/',
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://www.superdoc.dev/',
      }),
    );
    await tick();

    expect(get).toHaveBeenCalledWith({ storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:869:1' });
    expect(match).toHaveBeenCalledWith({
      select: { type: 'text', pattern: 'SuperDoc website', caseSensitive: true },
      require: 'any',
    });
    expect(manager.open.mock.calls[0][0].props.textTarget).toEqual({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 56 },
      end: { kind: 'text', blockId: 'P1', offset: 72 },
    });
  });

  it('does not use a query fallback from another block when the clicked block is known', async () => {
    const fragment = document.createElement('p');
    fragment.dataset.blockId = 'P1';
    fragment.dataset.pmStart = '1';
    fragment.append('prefix ');
    const element = document.createElement('a');
    element.href = 'https://www.superdoc.dev/';
    element.textContent = 'SuperDoc website';
    fragment.append(element);
    const get = vi.fn(() => ({
      success: true,
      hyperlink: {
        hyperlinkNodeId: 'hl:869:1',
        text: 'SuperDoc website',
        targetKind: 'external',
        externalTarget: 'https://www.superdoc.dev/',
      },
    }));
    const match = vi.fn(() => ({
      items: [
        {
          target: {
            kind: 'selection',
            start: { kind: 'text', blockId: 'P2', offset: 0 },
            end: { kind: 'text', blockId: 'P2', offset: 16 },
          },
        },
      ],
    }));
    const editor = {
      doc: {
        query: { match },
        hyperlinks: {
          get,
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:869:1',
                    text: 'SuperDoc website',
                    targetKind: 'external',
                    externalTarget: 'https://www.superdoc.dev/',
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://www.superdoc.dev/',
      }),
    );
    await tick();

    expect(manager.open.mock.calls[0][0].props.textTarget).toEqual({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 7 },
      end: { kind: 'text', blockId: 'P1', offset: 23 },
    });
  });

  it('uses clicked text to disambiguate rendered links that share a relationship id', async () => {
    const element = document.createElement('a');
    element.href = 'https://example.com/';
    element.dataset.linkRid = 'rId1';
    element.textContent = 'Second link';
    const editor = {
      doc: {
        hyperlinks: {
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    rId: 'rId1',
                    text: 'First link',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                  },
                  {
                    hyperlinkNodeId: 'hl:2',
                    rId: 'rId1',
                    text: 'Second link',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://example.com/',
      }),
    );
    await tick();

    const request = manager.open.mock.calls[0][0];
    expect(request.props.hyperlinkTarget).toMatchObject({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:2',
      text: 'Second link',
    });
  });

  it('uses clicked text range to disambiguate identical rendered links', async () => {
    const fragment = document.createElement('p');
    fragment.dataset.blockId = 'P1';
    fragment.dataset.pmStart = '1';
    const first = document.createElement('a');
    first.href = 'https://example.com/';
    first.dataset.linkRid = 'rId1';
    first.textContent = 'Click here';
    const element = document.createElement('a');
    element.href = 'https://example.com/';
    element.dataset.linkRid = 'rId1';
    element.textContent = 'Click here';
    fragment.append(first, ' and then ', element);
    const secondOffset = 'Click here and then '.length;
    const editor = {
      doc: {
        hyperlinks: {
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    rId: 'rId1',
                    text: 'Click here',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                    address: {
                      kind: 'inline',
                      nodeType: 'hyperlink',
                      anchor: {
                        start: { blockId: 'P1', offset: 0 },
                        end: { blockId: 'P1', offset: 'Click here'.length },
                      },
                    },
                  },
                  {
                    hyperlinkNodeId: 'hl:2',
                    rId: 'rId1',
                    text: 'Click here',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                    address: {
                      kind: 'inline',
                      nodeType: 'hyperlink',
                      anchor: {
                        start: { blockId: 'P1', offset: secondOffset },
                        end: { blockId: 'P1', offset: secondOffset + 'Click here'.length },
                      },
                    },
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://example.com/',
      }),
    );
    await tick();

    const request = manager.open.mock.calls[0][0];
    expect(request.props.hyperlinkTarget).toMatchObject({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:2',
      text: 'Click here',
    });
  });

  it('prefers rendered pm offsets over DOM text walking when disambiguating identical links', async () => {
    const fragment = document.createElement('p');
    fragment.dataset.blockId = 'P1';
    fragment.dataset.pmStart = '1';
    fragment.append('1. ');
    const element = document.createElement('a');
    element.href = 'https://example.com/';
    element.dataset.linkRid = 'rId1';
    element.dataset.pmStart = '0';
    element.dataset.pmEnd = '10';
    element.textContent = 'Click here';
    fragment.append(element);
    const editor = {
      doc: {
        hyperlinks: {
          list: () => ({
            stories: [
              {
                storyId: 'main:/word/document.xml',
                hyperlinks: [
                  {
                    hyperlinkNodeId: 'hl:1',
                    rId: 'rId1',
                    text: 'Click here',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                    address: {
                      kind: 'inline',
                      nodeType: 'hyperlink',
                      anchor: {
                        start: { blockId: 'P1', offset: 0 },
                        end: { blockId: 'P1', offset: 10 },
                      },
                    },
                  },
                  {
                    hyperlinkNodeId: 'hl:2',
                    rId: 'rId1',
                    text: 'Click here',
                    targetKind: 'external',
                    externalTarget: 'https://example.com/',
                    address: {
                      kind: 'inline',
                      nodeType: 'hyperlink',
                      anchor: {
                        start: { blockId: 'P1', offset: 3 },
                        end: { blockId: 'P1', offset: 13 },
                      },
                    },
                  },
                ],
              },
            ],
          }),
        },
      },
    };
    const { popover, manager } = createSubject({ editor });

    popover.handleLinkClick(
      createPayload({
        element,
        href: 'https://example.com/',
      }),
    );
    await tick();

    expect(manager.open.mock.calls[0][0].props.hyperlinkTarget).toMatchObject({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:1',
    });
  });

  it('passes anchor navigation into the built-in link popover', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<a name="section-one"></a>';
    const scrollTo = vi.fn();
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 50 });
    host.scrollTo = scrollTo;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' });
    const { popover, manager } = createSubject({
      ui: {
        viewport: {
          getHost: () => host,
        },
      },
    });

    popover.handleLinkClick(createPayload({ href: '#section-one' }));
    await tick();
    const handle = manager.handles[0];

    manager.open.mock.calls[0][0].props.goToAnchor('#section-one');
    await tick();

    expect(handle.close).toHaveBeenCalledWith('closed');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });

  it('passes a complete resolver context', () => {
    const resolver = vi.fn(() => ({ type: 'none' }));
    const { popover, editor } = createSubject({ resolver });
    const payload = createPayload({ href: '#anchor', documentMode: 'suggesting' });

    popover.handleLinkClick(payload);

    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({
        editor,
        href: '#anchor',
        target: '_blank',
        rel: 'noopener',
        tooltip: 'Example',
        element: payload.element,
        clientX: 42,
        clientY: 64,
        isAnchorLink: true,
        documentMode: 'suggesting',
        defaultAction: 'edit',
        position: { left: '32px', top: '44px' },
      }),
    );
    expect(typeof resolver.mock.calls[0][0].closePopover).toBe('function');
  });

  it('suppresses the popover when resolver returns none', async () => {
    const { popover, manager } = createSubject({ resolver: () => ({ type: 'none' }) });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(manager.open).not.toHaveBeenCalled();
  });

  it('does not open the built-in editor when custom UI falls back to default', async () => {
    const resolver = vi.fn(() => undefined);
    const { popover, manager } = createSubject({ resolver, builtInEditorDisabled: true });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('routes non-text hyperlinks through canonical activation', async () => {
    const resolver = vi.fn(() => ({ type: 'render', render: vi.fn() }));
    const { popover, manager } = createSubject({ resolver, interceptsNavigationOnly: true });

    popover.handleLinkClick(createPayload({ editableText: false }));
    await tick();

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ defaultAction: 'navigate' }));
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  it('suppresses non-text hyperlinks when canonical activation returns suppress', async () => {
    const resolver = vi.fn(() => ({ type: 'suppress' }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { popover, manager, emitException } = createSubject({ resolver, interceptsNavigationOnly: true });

    popover.handleLinkClick(createPayload({ editableText: false }));
    await tick();

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ defaultAction: 'navigate' }));
    expect(emitException).not.toHaveBeenCalled();
    expect(manager.open).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('continues to suppress canonical activations that return deprecated none', async () => {
    const resolver = vi.fn(() => ({ type: 'none' }));
    const { popover, manager } = createSubject({
      resolver,
      handlerSource: 'hyperlinks.onActivate',
    });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('keeps deprecated resolvers away from non-text hyperlinks', async () => {
    const resolver = vi.fn(() => ({ type: 'none' }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { popover } = createSubject({ resolver });

    popover.handleLinkClick(createPayload({ editableText: false }));
    await tick();

    expect(resolver).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });

  it('opens a custom component with injected props', async () => {
    const component = { name: 'CustomLinkPopover' };
    const { popover, manager, editor } = createSubject({
      resolver: () => ({ type: 'custom', component, props: { label: 'Link' } }),
    });

    popover.handleLinkClick(createPayload());
    await tick();

    const request = manager.open.mock.calls[0][0];
    expect(request.component).toBeDefined();
    expect(request.props).toMatchObject({
      label: 'Link',
      editor,
      href: 'https://example.com',
    });
    expect(typeof request.props.closePopover).toBe('function');
  });

  it('closes the open surface from the injected closePopover prop', async () => {
    const component = { name: 'CustomLinkPopover' };
    const { popover, manager } = createSubject({
      resolver: () => ({ type: 'custom', component }),
    });

    popover.handleLinkClick(createPayload());
    await tick();

    const request = manager.open.mock.calls[0][0];
    const handle = manager.handles[0];
    request.props.closePopover();

    expect(handle.close).toHaveBeenCalledWith('closed');
  });

  it('falls back to default and emits exception for invalid custom resolutions', async () => {
    const { popover, manager, emitException } = createSubject({
      resolver: () => ({ type: 'custom', component: null }),
    });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(emitException).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'The hyperlink activation handler returned an invalid result.',
      }),
      source: 'linkPopoverResolver',
    });
    expect(manager.open).toHaveBeenCalledTimes(1);
    expect(manager.open.mock.calls[0][0].component).toBeDefined();
  });

  it('bridges external renderer context and cleanup return', async () => {
    const destroy = vi.fn();
    const render = vi.fn(() => ({ destroy }));
    const { popover, manager, editor } = createSubject({
      resolver: () => ({ type: 'external', render }),
    });

    popover.handleLinkClick(createPayload());
    await tick();

    const request = manager.open.mock.calls[0][0];
    const container = document.createElement('div');
    const result = request.render({
      container,
      close: vi.fn(),
    });

    expect(render).toHaveBeenCalledWith({
      container,
      closePopover: expect.any(Function),
      editor,
      href: 'https://example.com',
    });
    expect(result).toEqual({ destroy });
  });

  it('bridges the canonical render context without deprecated popover fields', async () => {
    const destroy = vi.fn();
    const render = vi.fn(() => ({ destroy }));
    const { popover, manager, editor } = createSubject({
      resolver: () => ({ type: 'render', render }),
    });

    popover.handleLinkClick(createPayload());
    await tick();

    const request = manager.open.mock.calls[0][0];
    const container = document.createElement('div');
    const close = vi.fn();
    const result = request.render({ container, close });

    expect(render).toHaveBeenCalledWith({
      container,
      close: expect.any(Function),
      editor,
      href: 'https://example.com',
    });
    expect(render.mock.calls[0][0]).not.toHaveProperty('closePopover');
    render.mock.calls[0][0].close();
    expect(close).toHaveBeenCalledWith('closed');
    expect(result).toEqual({ destroy });
  });

  it('falls back to default and emits exception when resolver throws', async () => {
    const error = new Error('bad resolver');
    const { popover, manager, emitException } = createSubject({
      resolver: () => {
        throw error;
      },
    });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(emitException).toHaveBeenCalledWith({ error, source: 'linkPopoverResolver' });
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  it('falls back to default when external renderer throws', async () => {
    const error = new Error('bad render');
    const { popover, manager, emitException } = createSubject({
      resolver: () => ({
        type: 'external',
        render: () => {
          throw error;
        },
      }),
    });

    popover.handleLinkClick(createPayload());
    await tick();
    const externalRequest = manager.open.mock.calls[0][0];
    const close = vi.fn();

    externalRequest.render({ container: document.createElement('div'), close });
    await tick();

    expect(emitException).toHaveBeenCalledWith({ error, source: 'linkPopoverExternalRender' });
    expect(close).toHaveBeenCalledWith('external-error');
    expect(manager.open).toHaveBeenCalledTimes(2);
  });

  it('fails closed with canonical error sources when onActivate throws', async () => {
    const error = new Error('bad activation handler');
    const { popover, manager, emitException } = createSubject({
      resolver: () => {
        throw error;
      },
      handlerSource: 'hyperlinks.onActivate',
    });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(emitException).toHaveBeenCalledWith({ error, source: 'hyperlinks.onActivate' });
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('fails closed when onActivate returns a Promise', async () => {
    const { popover, manager, emitException } = createSubject({
      resolver: () => Promise.reject(new Error('async failure')),
      handlerSource: 'hyperlinks.onActivate',
    });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(emitException).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'hyperlinks.onActivate must return synchronously; Promises are not supported.',
      }),
      source: 'hyperlinks.onActivate',
    });
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('fails closed when onActivate returns an invalid result', async () => {
    const { popover, manager, emitException } = createSubject({
      resolver: () => ({ type: 'unknown' }),
      handlerSource: 'hyperlinks.onActivate',
    });

    popover.handleLinkClick(createPayload());
    await tick();

    expect(emitException).toHaveBeenCalledWith({
      error: expect.objectContaining({ message: 'hyperlinks.onActivate returned an invalid result.' }),
      source: 'hyperlinks.onActivate',
    });
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('fails closed with canonical error sources when application rendering throws', async () => {
    const error = new Error('bad application render');
    const { popover, manager, emitException } = createSubject({
      resolver: () => ({
        type: 'render',
        render: () => {
          throw error;
        },
      }),
      handlerSource: 'hyperlinks.onActivate',
    });

    popover.handleLinkClick(createPayload());
    await tick();
    const request = manager.open.mock.calls[0][0];
    const close = vi.fn();

    request.render({ container: document.createElement('div'), close });
    await tick();

    expect(emitException).toHaveBeenCalledWith({ error, source: 'hyperlinks.onActivate.render' });
    expect(close).toHaveBeenCalledWith('external-error');
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to default after an external renderer error if destroyed first', async () => {
    const error = new Error('bad render');
    const { popover, manager, emitException } = createSubject({
      resolver: () => ({
        type: 'external',
        render: () => {
          throw error;
        },
      }),
    });

    popover.handleLinkClick(createPayload());
    await tick();
    const externalRequest = manager.open.mock.calls[0][0];

    externalRequest.render({ container: document.createElement('div'), close: vi.fn() });
    popover.destroy();
    await tick();

    expect(emitException).toHaveBeenCalledWith({ error, source: 'linkPopoverExternalRender' });
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  it('toggles the same link closed', async () => {
    const { popover, manager } = createSubject();
    const payload = createPayload();

    popover.handleLinkClick(payload);
    await tick();
    popover.handleLinkClick(payload);

    expect(manager.handles[0].close).toHaveBeenCalledWith('toggle');
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  it('does not reopen the same link after the surface outside-click handler closes it first', async () => {
    const { popover, manager } = createSubject();
    const payload = createPayload();
    document.body.appendChild(payload.element);

    popover.handleLinkClick(payload);
    await tick();
    payload.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    manager.handles[0].close();
    await tick();
    popover.handleLinkClick(payload);
    await tick();

    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  it('reopens the same link after a non-pointer surface close', async () => {
    const { popover, manager } = createSubject();
    const payload = createPayload();

    popover.handleLinkClick(payload);
    await tick();
    manager.handles[0].close();
    await tick();
    popover.handleLinkClick(payload);
    await tick();

    expect(manager.open).toHaveBeenCalledTimes(2);
  });

  it('reopens the same link after an unrelated outside pointer close', async () => {
    const { popover, manager } = createSubject();
    const payload = createPayload();

    popover.handleLinkClick(payload);
    await tick();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    manager.handles[0].close();
    await tick();
    popover.handleLinkClick(payload);
    await tick();

    expect(manager.open).toHaveBeenCalledTimes(2);
  });

  it('closes the active popover when destroyed', async () => {
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload());
    await tick();

    popover.destroy();

    expect(manager.handles[0].close).toHaveBeenCalledWith('destroyed');
  });

  it('cancels a pending surface open when explicitly closed before the microtask runs', async () => {
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload());
    popover.closeCurrentPopover();
    await tick();

    expect(manager.open).not.toHaveBeenCalled();
  });

  it('cancels a pending surface open when destroyed before the microtask runs', async () => {
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload());
    popover.destroy();
    await tick();

    expect(manager.open).not.toHaveBeenCalled();
  });

  it('opens viewing mode external links with noopener and no editable surface', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload({ documentMode: 'viewing', rel: 'noopener noreferrer nofollow' }));
    await tick();

    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('forces noopener for viewing mode blank-target links without rel features', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload({ documentMode: 'viewing', target: '_blank', rel: null }));
    await tick();

    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('preserves noreferrer when forcing noopener for viewing mode blank-target links', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload({ documentMode: 'viewing', target: '_blank', rel: 'noreferrer' }));
    await tick();

    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('opens viewing mode external links with the clicked target and rel features', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { popover, manager } = createSubject();

    popover.handleLinkClick(
      createPayload({ documentMode: 'viewing', target: 'report-frame', rel: 'nofollow noopener' }),
    );
    await tick();

    expect(open).toHaveBeenCalledWith('https://example.com', 'report-frame', 'noopener');
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('opens viewing mode external links in the same browsing context by default', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { popover, manager } = createSubject();

    popover.handleLinkClick(createPayload({ documentMode: 'viewing', target: null, rel: null }));
    await tick();

    expect(open).toHaveBeenCalledWith('https://example.com', '_self');
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('navigates viewing mode anchor links without opening an external tab or surface', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = document.createElement('div');
    host.innerHTML = '<a name="section-one"></a>';
    const scrollTo = vi.fn();
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 50 });
    host.scrollTo = scrollTo;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' });
    const { popover, manager } = createSubject({
      ui: {
        viewport: {
          getHost: () => host,
        },
      },
    });

    popover.handleLinkClick(createPayload({ href: '#section-one', documentMode: 'viewing' }));
    await tick();

    expect(open).not.toHaveBeenCalled();
    expect(manager.open).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });

  it('routes a painted V2 bookmark through one exact model viewport request', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = document.createElement('div');
    host.innerHTML = '<div data-source-node-id="w14:para-target">Target Heading</div>';
    const scrollTo = vi.fn();
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 50 });
    host.scrollTo = scrollTo;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' });
    const scrollIntoView = vi.fn(async () => ({ success: true }));
    const editor = {
      id: 'editor',
      doc: {
        bookmarks: {
          get: vi.fn(async ({ target }) =>
            target.name === 'targetSection' ? { range: { from: { blockId: 'w14:para-target' } } } : null,
          ),
        },
      },
      pageMetrics: {},
    };
    const { popover, manager } = createSubject({
      editor,
      ui: {
        viewport: {
          getHost: () => host,
          scrollIntoView,
        },
      },
    });

    popover.handleLinkClick(createPayload({ href: '#targetSection', documentMode: 'viewing' }));
    await tick();
    await tick();

    expect(open).not.toHaveBeenCalled();
    expect(manager.open).not.toHaveBeenCalled();
    expect(editor.doc.bookmarks.get).toHaveBeenCalledWith({
      target: { kind: 'entity', entityType: 'bookmark', name: 'targetSection' },
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'w14:para-target', range: { start: 0, end: 0 } },
      block: 'start',
      behavior: 'instant',
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('decodes encoded anchor fragments before resolving V2 bookmarks', async () => {
    const scrollIntoView = vi.fn(async () => ({ success: true }));
    const editor = {
      id: 'editor',
      doc: {
        bookmarks: {
          get: vi.fn(async ({ target }) =>
            target.name === 'Target[1].Clause' ? { range: { from: { blockId: 'w14:target' } } } : null,
          ),
        },
      },
      pageMetrics: {},
    };
    const { popover } = createSubject({
      editor,
      ui: {
        viewport: {
          getHost: () => document.createElement('div'),
          scrollIntoView,
        },
      },
    });

    popover.handleLinkClick(createPayload({ href: '#Target%5B1%5D.Clause', documentMode: 'viewing' }));
    await tick();
    await tick();

    expect(editor.doc.bookmarks.get).toHaveBeenCalledWith({
      target: { kind: 'entity', entityType: 'bookmark', name: 'Target[1].Clause' },
    });
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'w14:target', range: { start: 0, end: 0 } },
      block: 'start',
      behavior: 'instant',
    });
  });

  it('places the editing caret before invoking the viewport for an unpainted V2 bookmark', async () => {
    const host = document.createElement('div');
    const scrollTo = vi.fn();
    host.scrollTo = scrollTo;
    let releaseCaret;
    const setSelectionTarget = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseCaret = resolve;
        }),
    );
    const scrollIntoView = vi.fn(async () => ({ success: true }));
    const revealBodyTarget = vi.fn();
    const pageIndexForBodyTarget = vi.fn();
    const scrollToPage = vi.fn();
    const editor = {
      id: 'editor',
      authoring: { setSelectionTarget },
      doc: {
        bookmarks: {
          get: vi.fn(async () => ({ range: { from: { blockId: 'w14:para-far' } } })),
        },
      },
      pageMetrics: { revealBodyTarget, pageIndexForBodyTarget, scrollToPage },
    };
    const { popover, manager } = createSubject({
      editor,
      ui: { viewport: { getHost: () => host, scrollIntoView } },
    });

    popover.handleLinkClick(createPayload({ href: '#section-far', documentMode: 'editing' }));
    await tick();
    manager.open.mock.calls[0][0].props.goToAnchor('#section-far');
    await tick();

    expect(setSelectionTarget).toHaveBeenCalledWith({
      target: {
        kind: 'selection',
        start: {
          kind: 'text',
          blockId: 'w14:para-far',
          offset: 0,
          story: { kind: 'story', storyType: 'body' },
        },
        end: {
          kind: 'text',
          blockId: 'w14:para-far',
          offset: 0,
          story: { kind: 'story', storyType: 'body' },
        },
        story: { kind: 'story', storyType: 'body' },
      },
      collapse: 'start',
      focus: true,
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    releaseCaret();
    await tick();
    await tick();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'w14:para-far', range: { start: 0, end: 0 } },
      block: 'start',
      behavior: 'instant',
    });
    expect(revealBodyTarget).not.toHaveBeenCalled();
    expect(pageIndexForBodyTarget).not.toHaveBeenCalled();
    expect(scrollToPage).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('uses the same caret-first model route in suggesting mode', async () => {
    const events = [];
    const setSelectionTarget = vi.fn(async () => {
      events.push('caret');
    });
    const scrollIntoView = vi.fn(async () => {
      events.push('viewport');
      return { success: true };
    });
    const editor = {
      id: 'editor',
      authoring: { setSelectionTarget },
      doc: {
        bookmarks: {
          get: vi.fn(async () => ({ range: { from: { blockId: 'w14:para-suggested' } } })),
        },
      },
    };
    const { popover, manager } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });

    popover.handleLinkClick(createPayload({ href: '#suggested-section', documentMode: 'suggesting' }));
    await tick();
    manager.open.mock.calls[0][0].props.goToAnchor('#suggested-section');
    await tick();
    await tick();

    expect(events).toEqual(['caret', 'viewport']);
    expect(setSelectionTarget).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'w14:para-suggested', range: { start: 0, end: 0 } },
      block: 'start',
      behavior: 'instant',
    });
  });

  it('routes viewing mode through the model viewport without placing a caret or opening a window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const setSelectionTarget = vi.fn();
    const scrollIntoView = vi.fn(async () => ({ success: true }));
    const editor = {
      id: 'editor',
      authoring: { setSelectionTarget },
      doc: {
        bookmarks: {
          get: vi.fn(async () => ({ range: { from: { blockId: 'w14:para-view' } } })),
        },
      },
    };
    const { popover, manager } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });

    popover.handleLinkClick(createPayload({ href: '#view-target', documentMode: 'viewing' }));
    await tick();
    await tick();

    expect(open).not.toHaveBeenCalled();
    expect(manager.open).not.toHaveBeenCalled();
    expect(setSelectionTarget).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'w14:para-view', range: { start: 0, end: 0 } },
      block: 'start',
      behavior: 'instant',
    });
  });

  it('navigates a TOC entry directly through the caret-first model viewport route', async () => {
    const anchor = document.createElement('a');
    anchor.href = '#_Toc228451583';
    const entry = document.createElement('div');
    entry.className = 'superdoc-toc-entry';
    entry.appendChild(anchor);
    const events = [];
    const bookmarkGet = vi.fn(async () => ({ range: { from: { blockId: 'w14:para-h1' } } }));
    const setSelectionTarget = vi.fn(async () => {
      events.push('caret');
    });
    const scrollIntoView = vi.fn(async () => {
      events.push('viewport');
      return { success: true };
    });
    const editor = {
      id: 'editor',
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: bookmarkGet } },
    };
    const { popover, manager } = createSubject({
      editor,
      ui: { viewport: { scrollIntoView } },
    });

    popover.handleLinkClick(createPayload({ href: '#_Toc228451583', element: anchor, documentMode: 'editing' }));
    await tick();
    await tick();

    expect(manager.open).not.toHaveBeenCalled();
    expect(bookmarkGet).toHaveBeenCalledWith({
      target: { kind: 'entity', entityType: 'bookmark', name: '_Toc228451583' },
    });
    expect(events).toEqual(['caret', 'viewport']);
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'w14:para-h1', range: { start: 0, end: 0 } },
      block: 'start',
      behavior: 'instant',
    });
  });

  it.each(['ref', 'noteRef'])('leaves a note at the exact body bookmark for a %s link', async (kind) => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = kind;
    note.appendChild(anchor);
    const events = [];
    const setSelectionTarget = vi.fn(async () => {
      events.push('caret');
    });
    const scrollIntoView = vi.fn(async () => {
      events.push('viewport');
      return { success: true };
    });
    const editor = {
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: vi.fn(async () => ({ range: { from: { blockId: 'body-marker', offset: 19 } } })) } },
    };
    const { popover, manager } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });
    popover.handleLinkClick(createPayload({ href: '#note-target', element: anchor, editableText: false }));
    await tick();
    await tick();
    expect(manager.open).not.toHaveBeenCalled();
    expect(events).toEqual(['viewport', 'caret']);
    expect(setSelectionTarget.mock.calls[0][0].target.start).toEqual({
      kind: 'text',
      blockId: 'body-marker',
      offset: 19,
      story: { kind: 'story', storyType: 'body' },
    });
    expect(scrollIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'body-marker', range: { start: 19, end: 19 } },
      block: 'start',
      behavior: 'instant',
    });
  });

  it('owns note REF navigation across async model reads, reveal and caret publication', async () => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    let finishRead,
      finishReveal,
      finishCaret,
      pending = false,
      task;
    const bookmarkGet = vi.fn(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ range: { from: { blockId: 'body-marker', offset: 8 } } });
        }),
    );
    const scrollIntoView = vi.fn(
      () =>
        new Promise((resolve) => {
          finishReveal = () => resolve({ success: true });
        }),
    );
    const setSelectionTarget = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCaret = () => resolve({ ok: true });
        }),
    );
    const input = {
      runAfterPendingInput: vi.fn((action) => {
        pending = true;
        task = Promise.resolve()
          .then(action)
          .finally(() => {
            pending = false;
          });
        return task;
      }),
    };
    const editor = {
      host: { getHandles: () => ({ editing: { input } }) },
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: bookmarkGet } },
    };
    const { popover } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });
    popover.handleLinkClick(createPayload({ href: '#BodyTarget', element: anchor, editableText: false }));
    expect(input.runAfterPendingInput).toHaveBeenCalledTimes(1);
    await tick();
    expect(pending).toBe(true);
    finishRead();
    await tick();
    expect(pending).toBe(true);
    finishReveal();
    await tick();
    expect(pending).toBe(true);
    finishRead();
    await tick();
    expect(pending).toBe(true);
    expect(setSelectionTarget).toHaveBeenCalledTimes(1);
    finishCaret();
    await task;
    expect(pending).toBe(false);
    expect(setSelectionTarget.mock.lastCall[0].target.start).toMatchObject({ blockId: 'body-marker', offset: 8 });
  });

  it('cancels note navigation closed while waiting for pending input without reacquiring a newer generation', async () => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    let run, task;
    const input = {
      runAfterPendingInput: vi.fn((action) => {
        task = new Promise((resolve) => {
          run = () => resolve(action());
        });
        return task;
      }),
    };
    const bookmarkGet = vi.fn(),
      setSelectionTarget = vi.fn(),
      scrollIntoView = vi.fn();
    const editor = {
      host: { getHandles: () => ({ editing: { input } }) },
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: bookmarkGet } },
    };
    const { popover } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });
    popover.handleLinkClick(createPayload({ href: '#BodyTarget', element: anchor, editableText: false }));
    expect(input.runAfterPendingInput).toHaveBeenCalledTimes(1);
    popover.destroy();
    run();
    await task;
    expect(bookmarkGet).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(setSelectionTarget).not.toHaveBeenCalled();
  });

  it('cannot resume an aborted note reveal when the same editor becomes usable again', async () => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    const retirement = new AbortController();
    let finishReveal, task;
    const input = {
      runAfterPendingInput: vi.fn((action) => {
        task = action(retirement.signal);
        return task;
      }),
    };
    const bookmarkGet = vi.fn(async () => ({ range: { from: { blockId: 'body-marker', offset: 8 } } }));
    const scrollIntoView = vi.fn(
      () =>
        new Promise((resolve) => {
          finishReveal = () => resolve({ success: true });
        }),
    );
    const setSelectionTarget = vi.fn();
    const editor = {
      host: { getHandles: () => ({ editing: { input } }) },
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: bookmarkGet } },
    };
    const { popover } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });
    popover.handleLinkClick(createPayload({ href: '#BodyTarget', element: anchor, editableText: false }));
    await tick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    retirement.abort();
    finishReveal();
    await task;
    expect(bookmarkGet).toHaveBeenCalledTimes(1);
    expect(setSelectionTarget).not.toHaveBeenCalled();
  });

  it('revalidates a note REF bookmark moved by a peer during a successful viewport reveal', async () => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    let offset = 7;
    let releaseReveal;
    const bookmarkGet = vi.fn(async () => ({ range: { from: { blockId: 'body-marker', offset } } }));
    const setSelectionTarget = vi.fn(async () => ({ success: true }));
    const scrollIntoView = vi.fn(({ target }) =>
      target.range.start === 7
        ? new Promise((resolve) => {
            releaseReveal = () => resolve({ success: true });
          })
        : Promise.resolve({ success: true }),
    );
    const editor = { authoring: { setSelectionTarget }, doc: { bookmarks: { get: bookmarkGet } } };
    const { popover, manager } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });

    popover.handleLinkClick(createPayload({ href: '#BodyTarget', element: anchor, editableText: false }));
    await tick();
    expect(manager.open).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(setSelectionTarget).not.toHaveBeenCalled();

    offset = 8;
    releaseReveal();
    await tick();
    expect(setSelectionTarget.mock.lastCall[0].target.start).toMatchObject({ blockId: 'body-marker', offset: 8 });
  });

  it('re-reveals a note REF target moved to another body paragraph before placing the caret', async () => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    let blockId = 'old-body-paragraph';
    let releaseReveal;
    const setSelectionTarget = vi.fn(async () => ({ success: true }));
    const scrollIntoView = vi.fn(({ target }) =>
      target.blockId === 'old-body-paragraph'
        ? new Promise((resolve) => {
            releaseReveal = () => resolve({ success: true });
          })
        : Promise.resolve({ success: true }),
    );
    const editor = {
      authoring: { setSelectionTarget },
      doc: { bookmarks: { get: vi.fn(async () => ({ range: { from: { blockId, offset: 3 } } })) } },
    };
    const { popover } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });

    popover.handleLinkClick(createPayload({ href: '#BodyTarget', element: anchor, editableText: false }));
    await tick();
    blockId = 'new-body-paragraph';
    releaseReveal();
    await tick();
    expect(scrollIntoView.mock.calls.map(([request]) => request.target.blockId)).toEqual([
      'old-body-paragraph',
      'new-body-paragraph',
    ]);
    expect(setSelectionTarget.mock.lastCall[0].target.start).toMatchObject({ blockId, offset: 3 });
  });

  it('does not place a note caret when a target name becomes ambiguous during reveal', async () => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    let duplicate = false;
    let releaseReveal;
    const setSelectionTarget = vi.fn();
    const scrollIntoView = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseReveal = () => resolve({ success: true });
        }),
    );
    const editor = {
      authoring: { setSelectionTarget },
      doc: {
        bookmarks: {
          list: vi.fn(() => ({
            items: duplicate ? [{ name: 'BodyTarget' }, { name: 'BodyTarget' }] : [{ name: 'BodyTarget' }],
          })),
          get: vi.fn(() => ({ range: { from: { blockId: 'body-marker', offset: 7 } } })),
        },
      },
    };
    const { popover } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });

    popover.handleLinkClick(createPayload({ href: '#BodyTarget', element: anchor, editableText: false }));
    await tick();
    duplicate = true;
    releaseReveal();
    await tick();
    expect(setSelectionTarget).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { range: { from: { blockId: 'invalid-offset', offset: -1 } } },
    { address: { story: { storyType: 'footer' } }, range: { from: { blockId: 'wrong-story', offset: 0 } } },
  ])('does not change note selection or scroll for an unavailable body target: %j', async (bookmark) => {
    const note = document.createElement('div');
    note.dataset.sdNoteRole = 'body';
    const anchor = document.createElement('a');
    anchor.dataset.sdNoteCrossReference = 'ref';
    note.appendChild(anchor);
    const setSelectionTarget = vi.fn();
    const scrollIntoView = vi.fn();
    const editor = { authoring: { setSelectionTarget }, doc: { bookmarks: { get: vi.fn(() => bookmark) } } };
    const { popover } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });
    popover.handleLinkClick(createPayload({ href: '#unavailable', element: anchor, editableText: false }));
    await tick();
    await tick();
    expect(setSelectionTarget).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('still opens the link popover before navigating a non-TOC anchor in editing mode', async () => {
    const anchor = document.createElement('a');
    anchor.href = '#section-two';
    const scrollIntoView = vi.fn();
    const editor = {
      id: 'editor',
      doc: { bookmarks: { get: vi.fn(() => ({ range: { from: { blockId: 'w14:para-two' } } })) } },
    };
    const { popover, manager } = createSubject({ editor, ui: { viewport: { scrollIntoView } } });

    popover.handleLinkClick(createPayload({ href: '#section-two', element: anchor, documentMode: 'editing' }));
    await tick();
    await tick();

    expect(manager.open).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('no-ops when the bookmark is outside the body story', async () => {
    const scrollIntoView = vi.fn();
    const editor = {
      id: 'editor',
      doc: {
        bookmarks: {
          get: vi.fn(async () => ({
            address: { story: { kind: 'story', storyType: 'headerFooterSlot' } },
            range: { from: { blockId: 'w14:para-in-footer' } },
          })),
        },
      },
    };
    const { popover, manager } = createSubject({
      editor,
      ui: { viewport: { scrollIntoView } },
    });

    popover.handleLinkClick(createPayload({ href: '#footer-bookmark' }));
    await tick();

    manager.open.mock.calls[0][0].props.goToAnchor('#footer-bookmark');
    await tick();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('treats an authoritative model miss as a no-op even when a stale named anchor is mounted', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<a name="missing-bookmark"></a>';
    const scrollTo = vi.fn();
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 50 });
    host.scrollTo = scrollTo;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' });
    const scrollIntoView = vi.fn();
    const editor = {
      id: 'editor',
      doc: {
        bookmarks: {
          get: vi.fn(() => {
            throw new Error('TARGET_NOT_FOUND');
          }),
        },
      },
    };
    const { popover, manager } = createSubject({
      editor,
      ui: { viewport: { getHost: () => host, scrollIntoView } },
    });

    popover.handleLinkClick(createPayload({ href: '#missing-bookmark' }));
    await tick();

    manager.open.mock.calls[0][0].props.goToAnchor('#missing-bookmark');
    await tick();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('bounds viewport retries without DOM, reveal, page, or window fallback', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = document.createElement('div');
    host.innerHTML = '<a name="stale-anchor"></a>';
    const scrollTo = vi.fn();
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 50 });
    host.scrollTo = scrollTo;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' });
    const scrollIntoView = vi.fn(async () => ({ success: false }));
    const revealBodyTarget = vi.fn();
    const pageIndexForBodyTarget = vi.fn();
    const scrollToPage = vi.fn();
    const editor = {
      id: 'editor',
      doc: {
        bookmarks: {
          get: vi.fn(() => ({ range: { from: { blockId: 'w14:para-gone' } } })),
        },
      },
      pageMetrics: { revealBodyTarget, pageIndexForBodyTarget, scrollToPage },
    };
    const { popover, manager } = createSubject({
      editor,
      ui: { viewport: { getHost: () => host, scrollIntoView } },
    });

    popover.handleLinkClick(createPayload({ href: '#stale-anchor' }));
    await tick();

    manager.open.mock.calls[0][0].props.goToAnchor('#stale-anchor');
    await tick();
    await tick();

    expect(scrollIntoView).toHaveBeenCalledTimes(4);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(revealBodyTarget).not.toHaveBeenCalled();
    expect(pageIndexForBodyTarget).not.toHaveBeenCalled();
    expect(scrollToPage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
