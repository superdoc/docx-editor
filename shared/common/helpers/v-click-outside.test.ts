import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';

import type { DirectiveBinding } from 'vue';
import vClickOutside from './v-click-outside';

type ClickOutsideHandler = (event: MouseEvent) => void;

interface MockDocument {
  addEventListener: Mock;
  removeEventListener: Mock;
}

describe('v-click-outside directive', () => {
  let originalDocument: Document | undefined;
  let addEventListenerMock: Mock;
  let removeEventListenerMock: Mock;

  beforeEach(() => {
    originalDocument = globalThis.document;
    addEventListenerMock = mock();
    removeEventListenerMock = mock();

    (globalThis as unknown as { document: MockDocument }).document = {
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    };
  });

  afterEach(() => {
    if (originalDocument === undefined) {
      delete (globalThis as unknown as { document?: MockDocument }).document;
    } else {
      (globalThis as unknown as { document: Document }).document = originalDocument;
    }
  });

  it('invokes binding when clicks originate outside the element and unregisters on unmount', () => {
    const containsMock = mock().mockReturnValue(false);
    const binding: DirectiveBinding<ClickOutsideHandler> = {
      value: mock(),
      oldValue: undefined,
      arg: undefined,
      modifiers: {},
      instance: null,
      dir: vClickOutside,
    };
    const el = {
      contains: containsMock,
    } as unknown as HTMLElement;

    vClickOutside.mounted(el, binding);

    expect(addEventListenerMock).toHaveBeenCalledWith('click', expect.any(Function));

    const handler = addEventListenerMock.mock.calls[0][1];

    // Trigger an outside click
    const outsideEvent = { target: {} };
    handler(outsideEvent);
    expect(binding.value).toHaveBeenCalledWith(outsideEvent);

    // Trigger an inside click
    binding.value.mockClear();
    containsMock.mockReturnValue(true);
    handler({ target: {} });
    expect(binding.value).not.toHaveBeenCalled();

    vClickOutside.unmounted(el);
    expect(removeEventListenerMock).toHaveBeenCalledWith('click', handler);
  });

  it('shares one document click listener across high-cardinality consumers (SD-3852)', () => {
    const consumerCount = 1_316;
    const elements = Array.from({ length: consumerCount }, () => ({
      contains: mock().mockReturnValue(false),
    })) as unknown as HTMLElement[];
    const bindings = Array.from({ length: consumerCount }, () => ({
      value: mock(),
      oldValue: undefined,
      arg: undefined,
      modifiers: {},
      instance: null,
      dir: vClickOutside,
    })) as DirectiveBinding<ClickOutsideHandler>[];

    try {
      elements.forEach((element, index) => vClickOutside.mounted(element, bindings[index]!));
      expect(addEventListenerMock).toHaveBeenCalledTimes(1);
    } finally {
      elements.forEach((element) => vClickOutside.unmounted(element));
    }

    expect(removeEventListenerMock).toHaveBeenCalledTimes(1);
  });

  it('dispatches the latest binding and respects a composed inside path', () => {
    const first = mock();
    const second = mock();
    const el = {
      contains: mock().mockReturnValue(false),
    } as unknown as HTMLElement;
    const binding = (value: ClickOutsideHandler) =>
      ({
        value,
        oldValue: undefined,
        arg: undefined,
        modifiers: {},
        instance: null,
        dir: vClickOutside,
      }) as DirectiveBinding<ClickOutsideHandler>;

    try {
      vClickOutside.mounted(el, binding(first));
      vClickOutside.updated(el, binding(second));
      const handler = addEventListenerMock.mock.calls[0][1];

      handler({ target: {}, composedPath: () => [el] });
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      const outsideEvent = { target: {}, composedPath: () => [] };
      handler(outsideEvent);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(outsideEvent);
    } finally {
      vClickOutside.unmounted(el);
    }
  });

  it('owns one independent listener per element document', () => {
    const firstDocument = {
      addEventListener: mock(),
      removeEventListener: mock(),
    } as unknown as Document;
    const secondDocument = {
      addEventListener: mock(),
      removeEventListener: mock(),
    } as unknown as Document;
    const elements = [firstDocument, secondDocument].map((ownerDocument) => ({
      ownerDocument,
      contains: mock().mockReturnValue(false),
    })) as unknown as HTMLElement[];
    const binding = {
      value: mock(),
      oldValue: undefined,
      arg: undefined,
      modifiers: {},
      instance: null,
      dir: vClickOutside,
    } as DirectiveBinding<ClickOutsideHandler>;

    try {
      vClickOutside.mounted(elements[0]!, binding);
      vClickOutside.mounted(elements[1]!, binding);
      expect(firstDocument.addEventListener).toHaveBeenCalledTimes(1);
      expect(secondDocument.addEventListener).toHaveBeenCalledTimes(1);
    } finally {
      elements.forEach((element) => vClickOutside.unmounted(element));
    }

    expect(firstDocument.removeEventListener).toHaveBeenCalledTimes(1);
    expect(secondDocument.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
