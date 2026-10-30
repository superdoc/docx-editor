import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { BuiltInToolbar } from './built-in-toolbar.js';
import { createSuperDocUI } from '../../public/ui/create-super-doc-ui.js';
import type { CommandState, SuperDocLike, SuperDocUI } from '../../public/ui/types.js';
import { createHighContrastMode } from '../../composables/use-high-contrast-mode.js';

const controllers: SuperDocUI[] = [];
afterEach(() => {
  for (const ui of controllers.splice(0)) ui.destroy?.();
});

function makeHost() {
  const host: Record<string, unknown> = {
    activeEditor: { id: 'editor-1' },
    config: { documentMode: 'editing', rulers: true, layoutEngineOptions: { showFormattingMarks: false } },
    fonts: { getDocumentFontOptions: () => [] },
    on: () => {},
    off: () => {},
    emit: () => {},
    toggleRuler: vi.fn(),
    toggleFormattingMarks: vi.fn(),
    setShowFormattingMarks: vi.fn(),
  };
  let ui: SuperDocUI | null = null;
  Object.defineProperty(host, 'ui', {
    get() {
      if (!ui) {
        ui = createSuperDocUI({ superdoc: host as SuperDocLike });
        controllers.push(ui);
      }
      return ui;
    },
  });
  return host;
}

function makeToolbar(host = makeHost()) {
  return new BuiltInToolbar({
    highContrastMode: createHighContrastMode(),
    superdoc: host,
    hideButtons: false,
    showFormattingMarksButton: true,
    showTableOfContentsButton: true,
  });
}

const enabled: CommandState = { enabled: true, disabled: false, active: false, supported: true };
const blocked: CommandState = { enabled: false, disabled: true, active: false, supported: true, reason: 'pinned' };

const COMMAND_IDS = [
  'undo',
  'redo',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'track-changes-accept-selection',
  'track-changes-reject-selection',
  'ruler',
  'formatting-marks',
  'zoom',
  'measurement-unit',
  'document-mode',
  'link',
  'font-family',
  'font-size',
  'bullet-list',
  'numbered-list',
  'table-insert',
  'image',
  'table-of-contents-insert',
  'text-color',
  'highlight-color',
  'text-align',
  'line-height',
  'linked-style',
  'indent-decrease',
  'indent-increase',
  'direction-ltr',
  'direction-rtl',
  'clear-formatting',
  'copy-format',
  'page-numbers-apply',
  'page-number-insert',
];

function snapshotBlocking(blockedId: string) {
  return {
    commands: Object.fromEntries(COMMAND_IDS.map((id) => [id, id === blockedId ? blocked : enabled])),
  };
}

const COMMAND_FOLLOWED_BY_ITEM: Record<string, string> = {
  undo: 'undo',
  redo: 'redo',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  acceptTrackedChangeBySelection: 'track-changes-accept-selection',
  rejectTrackedChangeOnSelection: 'track-changes-reject-selection',
  zoom: 'zoom',
  measurementUnit: 'measurement-unit',
  documentMode: 'document-mode',
  link: 'link',
  list: 'bullet-list',
  numberedlist: 'numbered-list',
  table: 'table-insert',
  image: 'image',
  tableOfContents: 'table-of-contents-insert',
  color: 'text-color',
  highlight: 'highlight-color',
  textAlign: 'text-align',
  lineHeight: 'line-height',
  linkedStyles: 'linked-style',
  indentleft: 'indent-decrease',
  indentright: 'indent-increase',
  clearFormatting: 'clear-formatting',
  copyFormat: 'copy-format',
};

describe('built-in toolbar item to command routing', () => {
  it('disables each rendered item exactly when its own command is disabled', () => {
    const toolbar = makeToolbar();
    const observed: Record<string, string[]> = {};
    for (const name of Object.keys(COMMAND_FOLLOWED_BY_ITEM)) {
      const item = toolbar.getToolbarItemByName(name);
      expect(item, `toolbar renders ${name}`).toBeTruthy();
      observed[name] = COMMAND_IDS.filter((id) => {
        toolbar.snapshot = snapshotBlocking(id);
        toolbar.updateToolbarState();
        return item?.disabled.value === true;
      });
    }
    expect(observed).toEqual(
      Object.fromEntries(Object.entries(COMMAND_FOLLOWED_BY_ITEM).map(([name, id]) => [name, [id]])),
    );
    toolbar.destroy();
  });

  it('keeps the font controls enabled whatever their command reports', () => {
    const toolbar = makeToolbar();
    for (const name of ['fontFamily', 'fontSize']) {
      const item = toolbar.getToolbarItemByName(name);
      const disabledFor = COMMAND_IDS.filter((id) => {
        toolbar.snapshot = snapshotBlocking(id);
        toolbar.updateToolbarState();
        return item?.disabled.value === true;
      });
      expect(disabledFor, name).toEqual([]);
    }
    toolbar.destroy();
  });

  it('drives the ruler and formatting marks through the SuperDoc instance, not a command', () => {
    const host = makeHost();
    const toolbar = makeToolbar(host);
    const ruler = toolbar.getToolbarItemByName('ruler');
    const marks = toolbar.getToolbarItemByName('formattingMarks');

    toolbar.snapshot = {
      commands: {
        ruler: { ...blocked, active: false },
        'formatting-marks': { ...blocked, active: true },
      },
    };
    toolbar.updateToolbarState();
    expect({
      ruler: { disabled: ruler?.disabled.value, active: ruler?.active.value },
      marks: { disabled: marks?.disabled.value, active: marks?.active.value },
    }).toEqual({ ruler: { disabled: false, active: true }, marks: { disabled: false, active: false } });

    toolbar.emitCommand({ item: ruler! });
    toolbar.emitCommand({ item: marks! });
    expect(host.toggleRuler).toHaveBeenCalledTimes(1);
    expect(host.toggleFormattingMarks).toHaveBeenCalledTimes(1);
    toolbar.destroy();
  });

  it('runs each clicked item through the command it follows', () => {
    const toolbar = makeToolbar();
    const ran: string[] = [];
    const spy = vi.spyOn(toolbar.ui.commands, 'has').mockImplementation((id: string) => {
      ran.push(id);
      return false;
    });
    const clicked = Object.entries(COMMAND_FOLLOWED_BY_ITEM).filter(([name]) => name !== 'image');
    for (const [name] of clicked) {
      ran.length = 0;
      toolbar.emitCommand({ item: toolbar.getToolbarItemByName(name)!, argument: 'value' });
      expect(ran[0], name).toBe(COMMAND_FOLLOWED_BY_ITEM[name]);
    }
    spy.mockRestore();
    toolbar.destroy();
  });

  it('enables the table actions dropdown when any table action, including Fix tables, is enabled', () => {
    const toolbar = makeToolbar();
    const tableActions = toolbar.getToolbarItemByName('tableActions');
    const ids = [
      'table-add-row-before',
      'table-add-row-after',
      'table-delete-row',
      'table-add-column-before',
      'table-add-column-after',
      'table-delete-column',
      'table-delete',
      'table-remove-borders',
      'table-merge-cells',
      'table-split-cell',
      'table-fix',
      'table-insert',
    ];
    const enablingIds = ids.filter((id) => {
      toolbar.snapshot = { commands: { [id]: enabled } };
      toolbar.updateToolbarState();
      return tableActions?.disabled.value === false;
    });
    expect(enablingIds).toEqual(ids.slice(0, 11));
    toolbar.destroy();
  });

  it('runs each table action option through its own command', async () => {
    const toolbar = makeToolbar();
    const tableActions = toolbar.getToolbarItemByName('tableActions')!;
    const ran: string[] = [];
    const spy = vi.spyOn(toolbar.ui.commands, 'has').mockImplementation((id: string) => {
      ran.push(id);
      return false;
    });
    const options = [
      'addRowBefore',
      'addRowAfter',
      'deleteRow',
      'addColumnBefore',
      'addColumnAfter',
      'deleteColumn',
      'deleteTable',
      'deleteCellAndTableBorders',
      'mergeCells',
      'splitCell',
      'fixTables',
      'notAnOption',
    ];
    for (const command of options) toolbar.emitCommand({ item: tableActions, argument: { command } });
    expect(ran).toEqual([
      'table-add-row-before',
      'table-add-row-after',
      'table-delete-row',
      'table-add-column-before',
      'table-add-column-after',
      'table-delete-column',
      'table-delete',
      'table-remove-borders',
      'table-merge-cells',
      'table-split-cell',
      'table-fix',
    ]);
    spy.mockRestore();
    toolbar.destroy();
  });
});
