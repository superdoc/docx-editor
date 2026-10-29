import { describe, expect, it } from 'vite-plus/test';
import {
  BUILT_IN_TOOLBAR_CATALOG,
  TABLE_ACTION_COMMAND_IDS,
  TABLE_ACTION_COMMAND_IDS_BY_OPTION,
  getBuiltInToolbarItem,
  resolveBuiltInItemCommandId,
} from './compatibility-catalog.js';

const ORIGIN_MAIN_HEADLESS_ITEM_MAP = {
  undo: 'undo',
  redo: 'redo',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  acceptTrackedChangeBySelection: 'track-changes-accept-selection',
  rejectTrackedChangeOnSelection: 'track-changes-reject-selection',
  ruler: 'ruler',
  formattingMarks: 'formatting-marks',
  zoom: 'zoom',
  measurementUnit: 'measurement-unit',
  documentMode: 'document-mode',
  link: 'link',
  fontFamily: 'font-family',
  fontSize: 'font-size',
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
  directionLtr: 'direction-ltr',
  directionRtl: 'direction-rtl',
  clearFormatting: 'clear-formatting',
  copyFormat: 'copy-format',
};

const ORIGIN_MAIN_TABLE_ACTION_COMMAND_MAP = {
  addRowBefore: 'table-add-row-before',
  addRowAfter: 'table-add-row-after',
  deleteRow: 'table-delete-row',
  addColumnBefore: 'table-add-column-before',
  addColumnAfter: 'table-add-column-after',
  deleteColumn: 'table-delete-column',
  deleteTable: 'table-delete',
  deleteCellAndTableBorders: 'table-remove-borders',
  mergeCells: 'table-merge-cells',
  splitCell: 'table-split-cell',
  fixTables: 'table-fix',
};

const ORIGIN_MAIN_CATALOG_TABLE_MEMBERS = [
  'table-add-row-before',
  'table-add-row-after',
  'table-delete-row',
  'table-add-column-before',
  'table-add-column-after',
  'table-delete-column',
  'table-delete',
  'table-merge-cells',
  'table-split-cell',
  'table-remove-borders',
];

const ORIGIN_MAIN_CATALOG_COMMAND_IDS = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  clearFormatting: 'clear-formatting',
  copyFormat: 'copy-format',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  color: 'text-color',
  highlight: 'highlight-color',
  textAlign: 'text-align',
  list: 'bullet-list',
  numberedlist: 'numbered-list',
  indentleft: 'indent-decrease',
  indentright: 'indent-increase',
  lineHeight: 'line-height',
  linkedStyles: 'linked-style',
  link: 'link',
  image: 'image',
  pageNumber: 'page-numbers-apply',
  table: 'table-insert',
  undo: 'undo',
  redo: 'redo',
  zoom: 'zoom',
  measurementUnit: 'measurement-unit',
  documentMode: 'document-mode',
  acceptTrackedChangeBySelection: 'track-changes-accept-selection',
  rejectTrackedChangeOnSelection: 'track-changes-reject-selection',
};

const NO_LONGER_BUILT_IN_ITEM_NAMES = new Set(['directionLtr', 'directionRtl']);
const HOST_ROUTED_ITEM_NAMES = new Set(['ruler', 'formattingMarks']);

function originMainResolve(name: string): string | null {
  if (NO_LONGER_BUILT_IN_ITEM_NAMES.has(name) || HOST_ROUTED_ITEM_NAMES.has(name)) return null;
  const catalogId = (ORIGIN_MAIN_CATALOG_COMMAND_IDS as Record<string, string | undefined>)[name];
  return catalogId ?? (ORIGIN_MAIN_HEADLESS_ITEM_MAP as Record<string, string | undefined>)[name] ?? null;
}

describe('built-in toolbar command maps match origin/main', () => {
  it('resolves every item name to the command origin/main resolved', () => {
    const names = [
      ...new Set([
        ...BUILT_IN_TOOLBAR_CATALOG.map((entry) => entry.name),
        ...Object.keys(ORIGIN_MAIN_HEADLESS_ITEM_MAP),
        'ai',
        'overflow',
        'linkInput',
        'notAToolbarItem',
      ]),
    ];
    const resolved = Object.fromEntries(names.map((name) => [name, resolveBuiltInItemCommandId(name)]));
    expect(resolved).toEqual(Object.fromEntries(names.map((name) => [name, originMainResolve(name)])));
  });

  it('keeps the ruler and formatting marks on their SuperDoc instance methods', () => {
    expect(
      ['ruler', 'formattingMarks', 'watermark'].map((name) => {
        const entry = getBuiltInToolbarItem(name);
        return [name, entry?.disposition, entry?.instanceMethod];
      }),
    ).toEqual([
      ['ruler', 'host-routed', 'toggleRuler'],
      ['formattingMarks', 'host-routed', 'toggleFormattingMarks'],
      ['watermark', 'host-routed', 'ui.watermark.open'],
    ]);
  });

  it('maps each table action option to the command origin/main ran', () => {
    expect(TABLE_ACTION_COMMAND_IDS_BY_OPTION).toEqual(ORIGIN_MAIN_TABLE_ACTION_COMMAND_MAP);
    expect(TABLE_ACTION_COMMAND_IDS).toEqual(Object.values(ORIGIN_MAIN_TABLE_ACTION_COMMAND_MAP));
  });

  it('lists the routed table action members origin/main listed', () => {
    expect([...(getBuiltInToolbarItem('tableActions')?.memberCommandIds ?? [])].sort()).toEqual(
      [...ORIGIN_MAIN_CATALOG_TABLE_MEMBERS].sort(),
    );
  });
});
