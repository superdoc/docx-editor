import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vite-plus/test';
import LinkInput from './LinkInput.vue';

describe('LinkInput', () => {
  it('loads clicked link text when the selection snapshot has no quoted text', async () => {
    const clickedElement = document.createElement('a');
    clickedElement.href = 'https://example.com/';
    clickedElement.textContent = 'Example link text';

    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        clickedElement,
        ui: {
          selection: {
            getSnapshot: () => ({ quotedText: '' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.get('input[name="text"]').element.value).toBe('Example link text');
  });

  it('loads full hyperlink text ahead of the clicked segment text', async () => {
    const clickedElement = document.createElement('a');
    clickedElement.href = 'https://example.com/';
    clickedElement.textContent = 'Super';

    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        clickedElement,
        hyperlinkText: 'SuperDoc website',
        ui: {
          selection: {
            getSnapshot: () => ({ quotedText: '' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.get('input[name="text"]').element.value).toBe('SuperDoc website');
  });

  it('opens the current link in a new tab with noopener isolation', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const wrapper = mount(LinkInput, {
        props: {
          href: 'https://example.com/',
          ui: {
            document: {
              getSnapshot: () => ({ mode: 'editing' }),
            },
          },
        },
      });

      await wrapper.vm.$nextTick();
      await wrapper.get('[data-item="btn-link-open"]').trigger('click');

      expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener');
    } finally {
      open.mockRestore();
    }
  });

  it('submits edited link text with the href', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const closePopover = vi.fn();
    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        closePopover,
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: 'Original text' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('input[name="text"]').setValue('Updated text');
    await wrapper.get('input[name="link"]').setValue('https://updated.example/');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');

    expect(execute).toHaveBeenCalledWith('link', {
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: null,
      textTarget: null,
    });
    expect(closePopover).toHaveBeenCalled();
  });

  it('waits for a settled Apply result, prevents duplicates, and retains the form on rejection', async () => {
    let settle;
    const executeAsync = vi.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const closePopover = vi.fn();
    const textTarget = {
      kind: 'selection',
      start: { kind: 'text', blockId: 'p1', offset: 0 },
      end: { kind: 'text', blockId: 'p1', offset: 13 },
    };
    const wrapper = mount(LinkInput, {
      props: {
        textTarget,
        selectedText: 'Original text',
        closePopover,
        ui: {
          commands: { executeAsync },
          selection: { getSnapshot: () => ({ quotedText: '' }) },
          document: { getSnapshot: () => ({ mode: 'suggesting' }) },
        },
      },
    });
    await wrapper.get('input[name="link"]').setValue('https://example.com/');
    expect(wrapper.get('input[name="text"]').element.value).toBe('Original text');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');
    await wrapper.get('input[name="link"]').trigger('keydown.enter');
    expect(executeAsync).toHaveBeenCalledTimes(1);
    expect(executeAsync).toHaveBeenCalledWith(
      'link',
      expect.objectContaining({ textTarget, currentText: 'Original text' }),
    );
    expect(closePopover).not.toHaveBeenCalled();
    settle({ success: false, failure: { code: 'INVALID_CONTEXT' } });
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Could not apply link'));
    expect(closePopover).not.toHaveBeenCalled();
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');
    settle({ success: true });
    await vi.waitFor(() => expect(closePopover).toHaveBeenCalledTimes(1));
  });

  it('does not dismiss the popover when Remove rejects', async () => {
    const closePopover = vi.fn();
    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        closePopover,
        ui: {
          commands: { executeAsync: vi.fn().mockResolvedValue(false) },
          document: { getSnapshot: () => ({ mode: 'editing' }) },
        },
      },
    });
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-item="btn-link-remove"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Could not apply link'));
    expect(closePopover).not.toHaveBeenCalled();
  });

  it('omits text when editing an existing link with empty link text', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const closePopover = vi.fn();
    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        closePopover,
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: 'Original text' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('input[name="text"]').setValue('');
    await wrapper.get('input[name="link"]').setValue('https://updated.example/');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');

    expect(execute).toHaveBeenCalledWith('link', {
      href: 'https://updated.example/',
      currentText: 'Original text',
      hyperlinkTarget: null,
      textTarget: null,
    });
    expect(closePopover).toHaveBeenCalled();
  });

  it('submits edited link text when pressing Enter in the text field', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const closePopover = vi.fn();
    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        closePopover,
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: 'Original text' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('input[name="text"]').setValue('Updated text');
    await wrapper.get('input[name="text"]').trigger('keydown.enter');

    expect(execute).toHaveBeenCalledWith('link', {
      href: 'https://example.com/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: null,
      textTarget: null,
    });
    expect(closePopover).toHaveBeenCalled();
  });

  it('submits clicked hyperlink target when removing a link', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const closePopover = vi.fn();
    const hyperlinkTarget = { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' };
    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        hyperlinkTarget,
        closePopover,
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: '' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('[data-item="btn-link-remove"]').trigger('click');

    expect(execute).toHaveBeenCalledWith('link', { href: null, hyperlinkTarget });
    expect(closePopover).toHaveBeenCalled();
  });

  it('submits clicked hyperlink target when applying an empty link', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const closePopover = vi.fn();
    const hyperlinkTarget = { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' };
    const wrapper = mount(LinkInput, {
      props: {
        href: 'https://example.com/',
        hyperlinkTarget,
        closePopover,
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: '' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('input[name="link"]').setValue('');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');

    expect(execute).toHaveBeenCalledWith('link', { href: null, hyperlinkTarget });
    expect(closePopover).toHaveBeenCalled();
  });

  it('restores the captured selection before executing the link command (SD-3656)', async () => {
    const calls = [];
    const restoreSelection = vi.fn(() => calls.push('restore'));
    const execute = vi.fn(() => {
      calls.push('execute');
      return { success: true };
    });
    const wrapper = mount(LinkInput, {
      props: {
        restoreSelection,
        closePopover: vi.fn(),
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: 'world' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('input[name="link"]').setValue('https://example.com/');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');

    expect(restoreSelection).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    // Restore must run first so the command targets the highlighted text.
    expect(calls).toEqual(['restore', 'execute']);
  });

  it('trims surrounding whitespace before normalizing a pasted URL', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const wrapper = mount(LinkInput, {
      props: {
        closePopover: vi.fn(),
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: 'world' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    // A pasted URL with a leading space must not get "https://" prepended onto a
    // value that already carries a scheme.
    await wrapper.get('input[name="link"]').setValue(' https://superdoc.dev');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');

    expect(execute).toHaveBeenCalledWith('link', expect.objectContaining({ href: 'https://superdoc.dev' }));
  });

  it('forwards the captured textTarget into the link command payload (SD-3656)', async () => {
    const execute = vi.fn(() => ({ success: true }));
    const textTarget = {
      kind: 'selection',
      start: { kind: 'text', blockId: 'p1', offset: 6 },
      end: { kind: 'text', blockId: 'p1', offset: 11 },
    };
    const wrapper = mount(LinkInput, {
      props: {
        textTarget,
        closePopover: vi.fn(),
        ui: {
          commands: { executeAsync: execute },
          selection: {
            getSnapshot: () => ({ quotedText: 'world' }),
          },
          document: {
            getSnapshot: () => ({ mode: 'editing' }),
          },
        },
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.get('input[name="link"]').setValue('https://example.com/');
    await wrapper.get('[data-item="btn-link-apply"]').trigger('click');

    expect(execute).toHaveBeenCalledWith('link', expect.objectContaining({ href: 'https://example.com/', textTarget }));
  });
});
