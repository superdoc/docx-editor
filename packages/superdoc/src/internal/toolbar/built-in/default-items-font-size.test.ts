import { describe, expect, it } from 'vite-plus/test';
import { makeDefaultItems } from './default-items.js';
import { toolbarIcons } from './toolbarIcons.js';
import { toolbarTexts } from './toolbarTexts.js';

const fontSizeItem = () => {
  const { defaultItems } = makeDefaultItems({
    superToolbar: { config: { mode: 'docx' }, ui: {} },
    toolbarIcons,
    toolbarTexts,
    hideButtons: false,
  });
  const item = defaultItems.find((candidate) => candidate.name.value === 'fontSize');
  if (!item) throw new Error('fontSize item missing');
  return item;
};

describe('font size active label', () => {
  it('shows the size read from a value with a unit', () => {
    const item = fontSizeItem();
    item.activate({ fontSize: '12pt' });
    expect(item.label.value).toBe('12');
  });

  it('shows the size read from a numeric value', () => {
    const item = fontSizeItem();
    item.activate({ fontSize: 14 });
    expect(item.label.value).toBe('14');
  });

  it('clamps sizes to the 8 to 96 display range', () => {
    const item = fontSizeItem();
    item.activate({ fontSize: '120pt' });
    expect(item.label.value).toBe('96');
    item.activate({ fontSize: '4' });
    expect(item.label.value).toBe('8');
  });

  it('falls back to 12 when no number can be read', () => {
    const item = fontSizeItem();
    item.activate({ fontSize: 'abc' });
    expect(item.label.value).toBe('12');
  });
});
