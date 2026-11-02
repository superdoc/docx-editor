import { describe, expect, it, vi } from 'vite-plus/test';
import { createSuperDocUI } from '../ui.js';
import {
  executeFirstPartyCommandAsync,
  readFirstPartyPageNumbers,
  registerFirstPartyCommandMutation,
} from './create-super-doc-ui.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';

const FOOTER = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' } as const;
const INSERTED = { success: true, field: { kind: 'field', blockId: 'F1', occurrenceIndex: 0, nestingDepth: 0 } };
const NUMBERED = {
  success: true,
  section: { kind: 'section', sectionId: 'section-0' },
  kind: 'footer',
  parts: [{ kind: 'headerFooterPart', refId: 'rId7' }],
  titlePage: false,
};
const REMOVED = { success: true, section: { kind: 'section', sectionId: 'section-0' }, parts: [] };
const PAGE_NUMBER_INFO = {
  section: { kind: 'section', sectionId: 'section-0' },
  placements: [{ kind: 'footer', alignment: 'right', parts: [{ kind: 'headerFooterPart', refId: 'rId7' }] }],
  showOnFirstPage: true,
  titlePage: false,
  format: 'decimal',
  start: null,
};

function selectionAt(story: unknown, start = 2, end = start) {
  const withStory = story ? { story } : {};
  return {
    empty: start === end,
    target: { kind: 'text', segments: [{ blockId: 'F1', range: { start, end } }], ...withStory },
    selectionTarget: {
      kind: 'selection',
      start: { kind: 'text', blockId: 'F1', offset: start, ...withStory },
      end: { kind: 'text', blockId: 'F1', offset: end, ...withStory },
      ...withStory,
    },
    activeMarks: [] as string[],
    activeCommentIds: [] as string[],
    activeChangeIds: [] as string[],
    text: '',
  };
}

function setup(opts: { selection?: unknown; readSelection?: () => unknown; mode?: string; firstParty?: boolean } = {}) {
  const selection = 'selection' in opts ? opts.selection : selectionAt(FOOTER);
  const readSelection = opts.readSelection ?? (() => selection);
  const facadeInsert = vi.fn(() => INSERTED);
  const facadeNumbering = vi.fn(() => NUMBERED);
  const humanInsert = vi.fn(async (..._args: unknown[]) => INSERTED);
  const codeInsert = vi.fn(async (..._args: unknown[]) => INSERTED);
  const humanNumbering = vi.fn(async (..._args: unknown[]): Promise<unknown> => NUMBERED);
  const codeNumbering = vi.fn(async (..._args: unknown[]): Promise<unknown> => NUMBERED);
  const humanRemove = vi.fn(async (..._args: unknown[]): Promise<unknown> => REMOVED);
  const codeRead = vi.fn(async (): Promise<unknown> => PAGE_NUMBER_INFO);
  const host: Record<string, () => unknown> = {
    getHandles: () => ({
      editing: {
        fields: { insertAtSelection: humanInsert },
        pageNumbers: { set: humanNumbering, remove: humanRemove, get: vi.fn() },
      },
    }),
    getCodeFieldEditingCommands: () => ({ insertAtSelection: codeInsert }),
    getCodePageNumberEditingCommands: () => ({ set: codeNumbering, remove: vi.fn(), get: codeRead }),
  };
  const superdoc: Record<string, unknown> = {
    activeEditor: {
      editorVersion: 2,
      host,
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        contentControls: { list: () => ({ items: [] }) },
        selection: { current: readSelection },
        fields: { insert: facadeInsert },
        headerFooters: { pageNumbers: { set: facadeNumbering, remove: vi.fn(), get: vi.fn() } },
      },
    },
    config: { documentMode: opts.mode ?? 'editing' },
    on: vi.fn(),
    off: vi.fn(),
  };
  registerFirstPartyCommandMutation(superdoc, host, {
    supports: () => false,
    run: vi.fn(),
    runListApply: async () => false,
  });
  const ui = createSuperDocUI({ superdoc });
  return {
    ui,
    host,
    facadeInsert,
    humanInsert,
    codeInsert,
    facadeNumbering,
    humanNumbering,
    codeNumbering,
    humanRemove,
    codeRead,
  };
}

async function settledState(ui: ReturnType<typeof createSuperDocUI>) {
  await vi.waitFor(() => expect(ui.selection.getSnapshot().status).toBe('ready'));
  return ui.commands.get('page-number-insert').getState();
}

describe('page-number-insert', () => {
  it.each([
    ['footer', FOOTER],
    ['header', { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' }],
  ])('is enabled at a collapsed %s caret', async (_label, story) => {
    const { ui, humanInsert } = setup({ selection: selectionAt(story) });
    expect(await settledState(ui)).toMatchObject({ enabled: true, supported: true, source: 'builtin' });
    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toEqual(INSERTED);
    expect(humanInsert).toHaveBeenCalledWith({ instruction: 'PAGE' });
  });

  it('fails closed while the host cannot hand out its editing handles', async () => {
    const { ui, host, humanInsert } = setup();
    await settledState(ui);
    host.getHandles = () => {
      throw new Error('host-not-ready');
    };
    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toBe(false);
    expect(humanInsert).not.toHaveBeenCalled();
  });

  it.each([
    ['in the body', selectionAt(null)],
    ['for a footer range', selectionAt(FOOTER, 1, 3)],
    ['without a selection', null],
  ])('is disabled with context-unavailable %s', async (_label, selection) => {
    const { ui, humanInsert, codeInsert } = setup({ selection });
    expect(await settledState(ui)).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.contextUnavailable,
    });
    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toBe(false);
    expect(humanInsert).not.toHaveBeenCalled();
    expect(codeInsert).not.toHaveBeenCalled();
  });

  it('is disabled and never mutates in viewing mode', async () => {
    const { ui, humanInsert } = setup({ mode: 'viewing' });
    expect(await settledState(ui)).toMatchObject({ enabled: false, reason: SUPERDOC_UI_REASONS.documentReadonly });
    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toBe(false);
    expect(humanInsert).not.toHaveBeenCalled();
  });

  it('hands the insert to the host before the selection read settles, so typed text lands after the field', async () => {
    let settleRead: (value: unknown) => void = () => {};
    const { ui, humanInsert } = setup({
      readSelection: () => new Promise((resolve) => (settleRead = resolve)),
    });
    expect(ui.selection.getSnapshot().status).not.toBe('ready');

    const pending = executeFirstPartyCommandAsync(ui, 'page-number-insert');

    // The host queue orders the field against typing only if it is entered now.
    expect(humanInsert).toHaveBeenCalledTimes(1);
    expect(humanInsert).toHaveBeenCalledWith({ instruction: 'PAGE' });
    settleRead(selectionAt(FOOTER));
    expect(await pending).toEqual(INSERTED);
  });

  it('reports the host refusal when an unsettled caret turns out to be in the body', async () => {
    const refused = { success: false, failure: { code: 'PRECONDITION_FAILED', message: 'caret is in the body' } };
    const { ui, humanInsert } = setup({ readSelection: () => new Promise(() => {}) });
    humanInsert.mockResolvedValueOnce(refused as never);

    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toEqual(refused);
    expect(humanInsert).toHaveBeenCalledTimes(1);
  });

  it('inserts a PAGE field through the human-attributed host command for built-in UI', async () => {
    const { ui, facadeInsert, humanInsert, codeInsert } = setup();
    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toEqual(INSERTED);
    expect(humanInsert).toHaveBeenCalledWith({ instruction: 'PAGE' });
    expect(codeInsert).not.toHaveBeenCalled();
    expect(facadeInsert).not.toHaveBeenCalled();
  });

  it('inserts through the code-attributed host command for public calls', async () => {
    const { ui, facadeInsert, humanInsert, codeInsert } = setup();
    expect(await ui.commands.executeAsync('page-number-insert')).toEqual(INSERTED);
    expect(codeInsert).toHaveBeenCalledWith({ instruction: 'PAGE' });
    expect(humanInsert).not.toHaveBeenCalled();
    expect(facadeInsert).not.toHaveBeenCalled();
  });

  it('inserts a tracked field in suggesting mode', async () => {
    const { ui, humanInsert } = setup({ mode: 'suggesting' });
    await executeFirstPartyCommandAsync(ui, 'page-number-insert');
    expect(humanInsert).toHaveBeenCalledWith({ instruction: 'PAGE' }, { changeMode: 'tracked' });
  });

  it('ignores a repeat while the first insertion is still pending', async () => {
    const { ui, humanInsert } = setup();
    let finish!: (value: typeof INSERTED) => void;
    humanInsert.mockImplementationOnce(() => new Promise<typeof INSERTED>((resolve) => (finish = resolve)));
    await settledState(ui);

    const first = executeFirstPartyCommandAsync(ui, 'page-number-insert');
    await vi.waitFor(() => expect(humanInsert).toHaveBeenCalledTimes(1));
    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toBe(false);
    finish(INSERTED);
    expect(await first).toEqual(INSERTED);

    expect(await executeFirstPartyCommandAsync(ui, 'page-number-insert')).toEqual(INSERTED);
    expect(humanInsert).toHaveBeenCalledTimes(2);
  });
});

describe('page-numbers-apply', () => {
  const settledNumberingState = async (ui: ReturnType<typeof createSuperDocUI>) => {
    await vi.waitFor(() => expect(ui.selection.getSnapshot().status).toBe('ready'));
    return ui.commands.get('page-numbers-apply').getState();
  };

  it.each([
    ['in the body', selectionAt(null)],
    ['at a footer caret', selectionAt(FOOTER)],
    ['without a selection', null],
  ])('is enabled %s', async (_label, selection) => {
    const { ui } = setup({ selection });
    expect(await settledNumberingState(ui)).toMatchObject({ enabled: true, supported: true, source: 'builtin' });
  });

  it('is unavailable while suggesting because header/footer structure cannot be suggested', async () => {
    const { ui, humanNumbering, humanRemove } = setup({ mode: 'suggesting' });
    expect(await settledNumberingState(ui)).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.operationUnavailable,
    });
    expect(ui.commands.get('page-numbers-remove').getState()).toMatchObject({ enabled: false });
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-apply')).toMatchObject({ success: false });
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-remove')).toMatchObject({ success: false });
    expect(humanNumbering).not.toHaveBeenCalled();
    expect(humanRemove).not.toHaveBeenCalled();
  });

  it('is read-only in viewing mode', async () => {
    const { ui, humanNumbering } = setup({ mode: 'viewing' });
    expect(await settledNumberingState(ui)).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-apply')).toBe(false);
    expect(humanNumbering).not.toHaveBeenCalled();
  });

  it('routes to the human-attributed host command and leaves unset options to the section', async () => {
    const { ui, humanNumbering, codeNumbering, facadeNumbering } = setup({ selection: selectionAt(null) });
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-apply')).toEqual(NUMBERED);
    expect(humanNumbering).toHaveBeenCalledWith({ kind: 'footer' });
    expect(codeNumbering).not.toHaveBeenCalled();
    expect(facadeNumbering).not.toHaveBeenCalled();
  });

  it('maps positions and passes placement, first-page, style, and start options', async () => {
    const { ui, codeNumbering } = setup({ selection: selectionAt(null) });
    await ui.commands.executeAsync('page-numbers-apply', {
      position: 'top',
      alignment: 'center',
      showOnFirstPage: false,
    });
    await ui.commands.executeAsync('page-numbers-apply', { kind: 'footer', format: 'lowerRoman', start: 3 });
    await ui.commands.executeAsync('page-numbers-apply', { position: 'bottom', start: null });
    expect(codeNumbering.mock.calls).toEqual([
      [{ kind: 'header', alignment: 'center', showOnFirstPage: false }],
      [{ kind: 'footer', format: 'lowerRoman', start: 3 }],
      [{ kind: 'footer', start: null }],
    ]);
  });

  it.each([
    ['an unknown position', { position: 'middle' }],
    ['an unknown alignment', { alignment: 'justify' }],
    ['a non-boolean first-page choice', { showOnFirstPage: 'no' }],
    ['an unknown number style', { format: 'emoji' }],
    ['a negative start', { start: -1 }],
    ['a fractional start', { start: 1.5 }],
    ['a scalar payload', 'bottom'],
  ])('fails closed for %s', async (_label, payload) => {
    const { ui, codeNumbering } = setup({ selection: selectionAt(null) });
    expect(await ui.commands.executeAsync('page-numbers-apply', payload)).toBe(false);
    expect(codeNumbering).not.toHaveBeenCalled();
  });

  it('returns the failure receipt so the popover can explain it', async () => {
    const { ui, humanNumbering } = setup({ selection: selectionAt(null) });
    const blocked = {
      success: false,
      failure: {
        code: 'PRECONDITION_FAILED',
        message: 'shares its line',
        details: { reason: 'page-number-has-content', kind: 'footer' },
      },
    };
    humanNumbering.mockResolvedValueOnce(blocked);
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-apply', { position: 'top' })).toEqual(blocked);
  });

  it('ignores a repeat while a page-number change is still pending', async () => {
    const { ui, humanNumbering, humanRemove } = setup({ selection: selectionAt(null) });
    let finish!: (value: unknown) => void;
    humanNumbering.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await settledNumberingState(ui);

    const first = executeFirstPartyCommandAsync(ui, 'page-numbers-apply');
    await vi.waitFor(() => expect(humanNumbering).toHaveBeenCalledTimes(1));
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-apply')).toBe(false);
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-remove')).toBe(false);
    finish(NUMBERED);
    expect(await first).toEqual(NUMBERED);
    expect(humanNumbering).toHaveBeenCalledTimes(1);
    expect(humanRemove).not.toHaveBeenCalled();
  });
});

describe('page-numbers-remove', () => {
  it('removes the caret section numbers through the human-attributed host command', async () => {
    const { ui, humanRemove } = setup({ selection: selectionAt(null) });
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-remove')).toEqual(REMOVED);
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-remove', { position: 'top' })).toEqual(REMOVED);
    expect(humanRemove.mock.calls).toEqual([[{}], [{ kind: 'header' }]]);
  });

  it('fails closed for an unknown position', async () => {
    const { ui, humanRemove } = setup({ selection: selectionAt(null) });
    expect(await executeFirstPartyCommandAsync(ui, 'page-numbers-remove', { position: 'middle' })).toBe(false);
    expect(humanRemove).not.toHaveBeenCalled();
  });
});

describe('readFirstPartyPageNumbers', () => {
  it('reads the caret section numbers for the built-in popover', async () => {
    const { ui, codeRead } = setup({ selection: selectionAt(null) });
    expect(await readFirstPartyPageNumbers(ui)).toEqual(PAGE_NUMBER_INFO);
    expect(codeRead).toHaveBeenCalledTimes(1);
  });

  it('resolves null when the host has no page-number commands', async () => {
    const { ui, host } = setup({ selection: selectionAt(null) });
    host.getCodePageNumberEditingCommands = () => null;
    expect(await readFirstPartyPageNumbers(ui)).toBeNull();
    expect(await readFirstPartyPageNumbers({})).toBeNull();
  });
});
