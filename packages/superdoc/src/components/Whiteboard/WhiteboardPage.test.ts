import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount, type VueWrapper } from '@vue/test-utils';
import WhiteboardPage from './WhiteboardPage.vue';

type Registry = Record<string, Array<Record<string, unknown>>>;

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const mountPage = (registry: Registry, pageSize = { width: 400, height: 500, originalWidth: 800 }) => {
  const page = {
    pageIndex: 0,
    size: { width: 400, height: 500 },
    mount: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    addImage: vi.fn(),
    addText: vi.fn(),
  };
  const whiteboard = {
    getTool: () => 'select',
    getType: (type: string) => registry[type] ?? [],
  };
  wrapper = mount(WhiteboardPage, {
    props: { whiteboard, page, pageSize },
    attachTo: document.body,
  } as never);
  return page;
};

const drop = async (data: Record<string, string>) => {
  const dataTransfer = { getData: (type: string) => data[type] ?? '', files: [] };
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer, clientX: 30, clientY: 40 });
  wrapper?.element.dispatchEvent(event);
};

describe('WhiteboardPage drops', () => {
  it('adds a registered sticker scaled to the current page width', async () => {
    const page = mountPage({ stickers: [{ id: 'star', src: 'star.png', width: 100, height: 60 }] });

    await drop({ 'application/sticker': 'star' });

    expect(page.addImage).toHaveBeenCalledWith(
      expect.objectContaining({ stickerId: 'star', src: 'star.png', width: 50, height: 30, type: 'sticker' }),
    );
  });

  it('leaves the size unset for a sticker without finite dimensions', async () => {
    const page = mountPage({ stickers: [{ id: 'star', src: 'star.png' }] });

    await drop({ 'application/sticker': 'star' });

    expect(page.addImage).toHaveBeenCalledWith(expect.objectContaining({ width: undefined, height: undefined }));
  });

  it('adds the text of a predefined comment', async () => {
    const page = mountPage({ comments: [{ id: 'ok', text: 'Looks good' }] });

    await drop({ 'application/comment': 'ok', 'text/plain': 'fallback' });

    expect(page.addText).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: 'Looks good' }));
  });

  it('consumes a comment whose text is not a string without falling through to plain text', async () => {
    const page = mountPage({ comments: [{ id: 'odd', text: 42 }] });

    await drop({ 'application/comment': 'odd', 'text/plain': 'fallback' });

    expect(page.addText).not.toHaveBeenCalled();
  });
});
