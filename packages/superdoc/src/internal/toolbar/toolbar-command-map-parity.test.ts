import { describe, expect, it } from 'vite-plus/test';
import {
  BUILT_IN_TOOLBAR_CATALOG,
  TABLE_ACTION_COMMAND_IDS,
  TABLE_ACTION_COMMAND_IDS_BY_OPTION,
  getBuiltInToolbarItem,
  resolveBuiltInItemCommandId,
} from './compatibility-catalog.js';

const NAMES_OUTSIDE_THE_CATALOG = [
  'tableOfContents',
  'directionLtr',
  'directionRtl',
  'ai',
  'overflow',
  'linkInput',
  'notAToolbarItem',
];

const lines = (rows: readonly string[]) => `${rows.join('\n')}\n`;

describe('built-in toolbar command maps match origin/main', () => {
  it('resolves every item name to the command origin/main resolved', async () => {
    const names = [...new Set([...BUILT_IN_TOOLBAR_CATALOG.map((entry) => entry.name), ...NAMES_OUTSIDE_THE_CATALOG])];
    const resolved = names.map((name) => `${name} -> ${resolveBuiltInItemCommandId(name) ?? 'nothing'}`);
    await expect(lines(resolved)).toMatchFileSnapshot('./__snapshots__/toolbar-command-map-parity/item-commands.txt');
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

  it('maps each table action option to the command origin/main ran', async () => {
    const options = Object.entries(TABLE_ACTION_COMMAND_IDS_BY_OPTION).map(([option, id]) => `${option} -> ${id}`);
    const enabledBy = `tableActions is enabled while any of these is: ${TABLE_ACTION_COMMAND_IDS.join(', ')}`;
    await expect(lines([...options, enabledBy])).toMatchFileSnapshot(
      './__snapshots__/toolbar-command-map-parity/table-action-commands.txt',
    );
  });

  it('lists the routed table action members origin/main listed', async () => {
    const members = [...(getBuiltInToolbarItem('tableActions')?.memberCommandIds ?? [])].sort();
    await expect(lines(members)).toMatchFileSnapshot(
      './__snapshots__/toolbar-command-map-parity/table-action-members.txt',
    );
  });
});
