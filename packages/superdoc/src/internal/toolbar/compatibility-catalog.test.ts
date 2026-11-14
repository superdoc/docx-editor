import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vite-plus/test';
import { getCommandDescriptor } from '../../public/ui/commands.js';
import {
  ALL_BUILT_IN_TOOLBAR_ITEM_NAMES,
  BUILT_IN_TOOLBAR_CATALOG,
  assertCatalogAlignedWithController,
  getBuiltInToolbarItem,
  listBuiltInToolbarItemsByGroup,
  resolveToolbarCommandId,
} from './compatibility-catalog.js';

describe('built-in toolbar compatibility catalog', () => {
  it('stays aligned with the V2 command controller catalog', () => {
    expect(() => assertCatalogAlignedWithController()).not.toThrow();
  });

  it('classifies every entry into exactly one of the known dispositions', () => {
    const allowed = new Set(['controller-routed', 'host-routed', 'shell-owned', 'unsupported', 'unresolved']);
    for (const entry of BUILT_IN_TOOLBAR_CATALOG) {
      expect(allowed.has(entry.disposition)).toBe(true);
    }
  });

  it('represents every documented built-in toolbar item', () => {
    // The "Available buttons" list documented in
    // the built-in UI documentation, plus the customButtons concept.
    const documented = [
      'bold',
      'italic',
      'underline',
      'strike',
      'clearFormatting',
      'copyFormat',
      'fontFamily',
      'fontSize',
      'color',
      'highlight',
      'textAlign',
      'list',
      'numberedlist',
      'indentleft',
      'indentright',
      'lineHeight',
      'linkedStyles',
      'link',
      'image',
      'table',
      'tableActions',
      'undo',
      'redo',
      'search',
      'zoom',
      'commentsLayout',
      'ruler',
      'formattingMarks',
      'documentMode',
      'acceptTrackedChangeBySelection',
      'rejectTrackedChangeOnSelection',
      'customButtons',
    ];
    for (const name of documented) {
      expect(getBuiltInToolbarItem(name), `missing catalog entry for "${name}"`).not.toBeNull();
    }
  });

  it('does not let toolbar docs advertise print/export as built-in item ids', () => {
    // Anchored at this file rather than at `process.cwd()`. The cwd depends on
    // whether vitest was launched from the repository root or from this package,
    // so a cwd-relative path resolves differently per runner.
    //
    // `__dirname` rather than `import.meta.url`: vitest serves the module over
    // http, so `fileURLToPath` on that URL throws ERR_INVALID_URL_SCHEME. Vite
    // injects `__dirname` for this file regardless of how it is served.
    //
    // The toolbar surface is documented across the built-in UI section and its
    // runnable example rather than a single page, so the guard reads all of it:
    // an item list that moved between files would otherwise stop being checked
    // without anything failing.
    const docsRoot = resolve(__dirname, '../../../../../apps/docs');
    const toolbarDocs = ['content/docs/editor/built-in-ui', 'examples/editor']
      .map((directory) => resolve(docsRoot, directory))
      .filter((candidate) => existsSync(candidate))
      .flatMap((directory) =>
        readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.(mdx|ts|html)$/u.test(entry.name))
          .map((entry) => readFileSync(resolve(directory, entry.name), 'utf8')),
      )
      .join('\n');

    if (toolbarDocs.length === 0) {
      throw new Error(`Unable to locate the built-in toolbar documentation under ${docsRoot}`);
    }

    expect(getBuiltInToolbarItem('print')).toBeNull();
    expect(getBuiltInToolbarItem('export')).toBeNull();
    expect(toolbarDocs).not.toMatch(/right:\s*\[[^\]]*'export'[^\]]*\]/);
    expect(toolbarDocs).not.toMatch(/\|\s*`viewer`\s*\|[^|\n]*\bprint\b/i);
    expect(toolbarDocs).not.toMatch(/\|\s*`viewer`\s*\|[^|\n]*\bexport\b/i);
  });

  it('maps the documented legacy item names onto their canonical V2 command ids', () => {
    const expected: Record<string, string> = {
      strike: 'strikethrough',
      fontFamily: 'font-family',
      color: 'text-color',
      highlight: 'highlight-color',
      textAlign: 'text-align',
      list: 'bullet-list',
      numberedlist: 'numbered-list',
      indentleft: 'indent-decrease',
      indentright: 'indent-increase',
      documentMode: 'document-mode',
      table: 'table-insert',
      clearFormatting: 'clear-formatting',
      linkedStyles: 'linked-style',
    };
    for (const [name, commandId] of Object.entries(expected)) {
      expect(resolveToolbarCommandId(name), `legacy "${name}" should route to "${commandId}"`).toBe(commandId);
    }
  });

  it('points every controller-routed item at a routed controller command', () => {
    for (const entry of BUILT_IN_TOOLBAR_CATALOG) {
      if (entry.disposition !== 'controller-routed') continue;
      expect(entry.commandId).toBeTruthy();
      const descriptor = getCommandDescriptor(entry.commandId as string);
      expect(descriptor, `unknown command for "${entry.name}"`).not.toBeNull();
      expect(descriptor?.disposition).toBe('routed');
    }
  });

  it('records every non-controller-routed item with an explicit note', () => {
    for (const entry of BUILT_IN_TOOLBAR_CATALOG) {
      if (entry.disposition === 'controller-routed') continue;
      expect(entry.note, `${entry.disposition} "${entry.name}" needs a note`).toBeTruthy();
    }
  });

  it('records the phase-2 chrome ownership dispositions (no over-claim)', () => {
    // ruler is host-owned chrome with a public SuperDoc.toggleRuler() method.
    const ruler = getBuiltInToolbarItem('ruler');
    expect(ruler?.disposition).toBe('host-routed');
    expect(ruler?.instanceMethod).toBe('toggleRuler');
    // formatting marks stay host-routed via their public instance method.
    const marks = getBuiltInToolbarItem('formattingMarks');
    expect(marks?.disposition).toBe('host-routed');
    expect(marks?.instanceMethod).toBe('toggleFormattingMarks');
    expect(marks?.commandId).toBeNull();
    expect(getBuiltInToolbarItem('copyFormat')?.disposition).toBe('controller-routed');
    // The tableActions dropdown is shell chrome whose members route through the
    // controller table-context facade; search is the shell popover backed by
    // the shared ui.search surface.
    expect(getBuiltInToolbarItem('tableActions')?.disposition).toBe('shell-owned');
    expect(getBuiltInToolbarItem('search')?.disposition).toBe('shell-owned');
  });

  it('keeps the tableActions members pointed at routed controller table commands', () => {
    const tableActions = getBuiltInToolbarItem('tableActions');
    expect(tableActions?.memberCommandIds?.length).toBeGreaterThan(0);
    for (const memberId of tableActions?.memberCommandIds ?? []) {
      const descriptor = getCommandDescriptor(memberId);
      expect(descriptor, `unknown table member command "${memberId}"`).not.toBeNull();
      expect(descriptor?.disposition).toBe('routed');
    }
  });

  it('exposes items by group and a stable name index', () => {
    expect(listBuiltInToolbarItemsByGroup('left').map((e) => e.name)).toEqual(expect.arrayContaining(['undo', 'redo']));
    expect(ALL_BUILT_IN_TOOLBAR_ITEM_NAMES).toEqual(BUILT_IN_TOOLBAR_CATALOG.map((e) => e.name));
    expect(new Set(ALL_BUILT_IN_TOOLBAR_ITEM_NAMES).size).toBe(ALL_BUILT_IN_TOOLBAR_ITEM_NAMES.length);
  });
});
