import { afterEach, expect, test, vi } from 'vitest';
import { templateFields } from './field-schema';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('superdoc');
  vi.resetModules();
});

test('keeps the changed document exportable when the post-lock field read fails', async () => {
  class Control extends EventTarget {
    disabled = true;
    checked = false;
    value = '';
    textContent = '';
    hidden = false;
  }
  const elements = new Map<string, Control>();
  function element(selector: string) {
    if (!elements.has(selector)) elements.set(selector, new Control());
    return elements.get(selector)!;
  }
  vi.stubGlobal('document', { querySelector: element, querySelectorAll: () => [] });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  const items = templateFields.map((field) => ({
    controlType: field.type,
    properties: { tag: field.tag },
    text: field.key === 'clientAddress' ? '42 Review Lane' : '',
    lockMode: 'unlocked',
  }));
  const list = vi.fn().mockResolvedValue({ items });
  const setLockMode = vi.fn(async () => {
    list.mockRejectedValue(new Error('Field read unavailable.'));
    return { success: true };
  });
  const exportDocument = vi.fn().mockResolvedValue(undefined);
  let notify = (_snapshot: { status: string }) => {};
  vi.doMock('superdoc', () => ({
    SuperDoc: class {
      activeEditor = {
        doc: { contentControls: { list, setLockMode, selectByTag: async () => ({ items: [items[1]] }) } },
      };
      ui = {
        contentControls: {
          observe: (callback: typeof notify) => {
            notify = callback;
            return () => {};
          },
          list: () => notify({ status: 'pending' }),
        },
      };
      export = exportDocument;
      constructor(options: { onReady: (event: { superdoc: unknown }) => void }) {
        options.onReady({ superdoc: this });
      }
    },
  }));
  await import('./filling');
  const exportButton = element('#export-filled-docx');
  expect(element('#client-legal-name').disabled).toBe(true);
  expect(list).not.toHaveBeenCalled();
  notify({ status: 'ready' });
  await vi.waitFor(() => expect(exportButton.disabled).toBe(false));
  const lock = element('#lock-address');
  lock.checked = true;
  lock.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(setLockMode).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(element('#filling-status').textContent).toContain('Field read unavailable'));
  expect(element('#client-address').disabled).toBe(true);
  expect(lock.disabled).toBe(true);
  expect(exportButton.disabled).toBe(false);
  exportButton.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(exportDocument).toHaveBeenCalledOnce());

  list.mockResolvedValue({
    items: items.map((item) => ({
      ...item,
      lockMode: item.properties.tag === 'client.address' ? 'contentLocked' : 'unlocked',
    })),
  });
  notify({ status: 'ready' });
  await vi.waitFor(() => expect(lock.disabled).toBe(false));
  expect(lock.checked).toBe(true);
  expect(element('#client-address').disabled).toBe(true);
});
