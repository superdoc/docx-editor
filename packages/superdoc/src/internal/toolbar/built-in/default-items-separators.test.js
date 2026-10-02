import { describe, expect, it } from 'vite-plus/test';
import { makeDefaultItems } from './default-items.js';
import { toolbarIcons } from './toolbarIcons.js';
import { toolbarTexts } from './toolbarTexts.js';

const superToolbar = { config: { mode: 'docx' }, ui: {} };

const groupItems = (items) => {
  const byGroup = new Map();
  for (const item of items) {
    const group = item.group?.value || 'center';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(item);
  }
  return byGroup;
};

const expectNoOrphanSeparators = (items) => {
  expect(items[0]?.type).not.toBe('separator');
  expect(items[items.length - 1]?.type).not.toBe('separator');
  for (let i = 0; i < items.length - 1; i += 1) {
    expect(items[i].type === 'separator' && items[i + 1].type === 'separator').toBe(false);
  }
};

describe('built-in toolbar separator normalization', () => {
  it('drops orphaned separators, per rendered group, after excluding an adjacent run of controls', () => {
    const { defaultItems } = makeDefaultItems({
      superToolbar,
      toolbarIcons,
      toolbarTexts,
      hideButtons: false,
      excludedItemNames: new Set(['fontFamily', 'fontSize']),
    });

    for (const items of groupItems(defaultItems).values()) {
      expectNoOrphanSeparators(items);
    }
  });

  it('drops orphaned separators after excluding a whole button group by item name', () => {
    const { defaultItems } = makeDefaultItems({
      superToolbar,
      toolbarIcons,
      toolbarTexts,
      hideButtons: false,
      // `color` is the color button's item name -- its local variable is `colorButton`.
      excludedItemNames: new Set(['bold', 'italic', 'underline', 'strikethrough', 'color', 'highlight']),
    });

    for (const items of groupItems(defaultItems).values()) {
      expectNoOrphanSeparators(items);
    }
  });

  it('drops a leading separator that only looked flanked because a different-group neighbor sat next to it in the raw sequence', () => {
    // `zoom` and `fontFamily` are both `center`; the item right before them in
    // the raw array, `search`, is `right`. A flat (group-unaware) adjacency
    // check would see `search` as a valid neighbor for the separator that
    // used to sit after `fontFamily`, and wrongly keep it -- even though,
    // once `center` is rendered on its own, that separator is the very first
    // item in the group.
    const { defaultItems } = makeDefaultItems({
      superToolbar,
      toolbarIcons,
      toolbarTexts,
      hideButtons: false,
      excludedItemNames: new Set(['zoom', 'fontFamily']),
    });

    const centerItems = groupItems(defaultItems).get('center');
    expect(centerItems[0].type).not.toBe('separator');
    expect(centerItems[0].name.value).toBe('fontSize');
  });

  it('keeps the linkedStyles-forced-into-overflow case clean of orphan separators', () => {
    const { defaultItems, overflowItems } = makeDefaultItems({
      superToolbar,
      toolbarIcons,
      toolbarTexts,
      hideButtons: true,
      availableWidth: 1300,
    });

    expect(defaultItems.some((item) => item.name.value === 'linkedStyles')).toBe(false);
    expect(overflowItems.some((item) => item.name.value === 'linkedStyles')).toBe(true);

    for (const items of groupItems(defaultItems).values()) {
      expectNoOrphanSeparators(items);
    }
  });

  it('is a no-op when nothing is excluded and nothing overflows', () => {
    const { defaultItems } = makeDefaultItems({
      superToolbar,
      toolbarIcons,
      toolbarTexts,
      hideButtons: false,
    });

    const separatorIds = defaultItems.filter((item) => item.type === 'separator').map((item) => item.id.value);
    expect(separatorIds.length).toBeGreaterThan(1);
  });
});
