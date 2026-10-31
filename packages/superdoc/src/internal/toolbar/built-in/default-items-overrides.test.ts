import { describe, expect, it, vi } from 'vite-plus/test';
import { makeDefaultItems } from './default-items.js';
import { toolbarIcons } from './toolbarIcons.js';
import { toolbarTexts } from './toolbarTexts.js';

type Items = ReturnType<typeof makeDefaultItems>;

const findItem = ({ defaultItems, overflowItems }: Items, name: string) => {
  const item = [...defaultItems, ...overflowItems].find((candidate) => candidate.name?.value === name);
  if (!item) throw new Error(`expected a ${name} item`);
  return item;
};

const build = (overrides: {
  icons?: Record<string, unknown>;
  texts?: Record<string, unknown>;
  superToolbar?: object;
}) =>
  makeDefaultItems({
    superToolbar: { config: {}, ...overrides.superToolbar },
    toolbarIcons: { ...toolbarIcons, ...overrides.icons },
    toolbarTexts: { ...toolbarTexts, ...overrides.texts },
  } as Parameters<typeof makeDefaultItems>[0]);

const renderLinkInputProps = (items: Items) => {
  const link = findItem(items, 'link');
  link.expand.value = true;
  const dropdown = link.nestedOptions.value.find((option) => option.key === 'linkDropdown');
  if (!dropdown?.render) throw new Error('expected a renderable link dropdown');
  return dropdown.render().children[0].props as { restoreSelection: () => void };
};

describe('default toolbar icon and text overrides', () => {
  it('uses a string override for the bold icon and tooltip', () => {
    const bold = findItem(build({ icons: { bold: '<svg>custom</svg>' }, texts: { bold: 'Strong' } }), 'bold');

    expect(bold.icon.value).toBe('<svg>custom</svg>');
    expect(bold.tooltip.value).toBe('Strong');
  });

  it('falls back to the built-in icon and tooltip for a non-string override', () => {
    const bold = findItem(build({ icons: { bold: { svg: 'object' } }, texts: { bold: 42 } }), 'bold');

    expect(bold.icon.value).toBe(toolbarIcons.bold);
    expect(bold.tooltip.value).toBe(toolbarTexts.bold);
  });
});

describe('default toolbar link dropdown selection restore', () => {
  it('restores the captured selection before the link command runs', () => {
    const capture = { selectionTarget: { kind: 'text', blockId: 'p1' } };
    const restore = vi.fn();
    const items = build({
      superToolbar: { pendingSelectionCapture: capture, ui: { selection: { get: () => null, restore } } },
    });

    renderLinkInputProps(items).restoreSelection();

    expect(restore).toHaveBeenCalledExactlyOnceWith(capture);
  });

  it.each([
    ['never captured', undefined],
    ['cleared', null],
  ])('does not call restore when the capture was %s and there is no live selection', (_label, capture) => {
    const restore = vi.fn();
    const items = build({
      superToolbar: { pendingSelectionCapture: capture, ui: { selection: { get: () => null, restore } } },
    });

    renderLinkInputProps(items).restoreSelection();

    expect(restore).not.toHaveBeenCalled();
  });
});
