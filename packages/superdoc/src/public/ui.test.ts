import { afterEach, describe, it, expect, vi } from 'vite-plus/test';
import { BUILT_IN_COMMAND_IDS, createSuperDocUI, shallowEqual } from './ui.js';
import { SUPERDOC_UI_REASONS } from './ui/reasons.js';
import { COMMAND_CATALOG, ALL_BUILT_IN_COMMAND_IDS } from './ui/commands.js';
import { LIST_PRESET_IDS } from '@superdoc/document-api';
import { bulletStyleButtons, numberedStyleButtons } from '../internal/toolbar/built-in/list-style-buttons.js';

// Shared non-empty selection used by inline-format command tests. The public
// Document API requires an explicit selection target, so the controller routes
// `format.*` with `{ target: SELECTION_TARGET, value }`.
const SELECTION_TARGET = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'P1', offset: 0 },
  end: { kind: 'text', blockId: 'P1', offset: 5 },
} as const;
const SELECTION_INFO = {
  empty: false,
  target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] },
  selectionTarget: SELECTION_TARGET,
  activeMarks: [] as string[],
  activeCommentIds: [] as string[],
  activeChangeIds: [] as string[],
  text: 'hello',
} as const;

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Smoke test for the public facade ui entry (SD-3183).
 * Three runtime re-exports cover the entry. Declaration-side validation
 * (70-symbol set, leak grep) lives in
 * `packages/superdoc/scripts/verify-public-facade-emit.cjs`. Bundle-shape
 * validation lives in `packages/superdoc/scripts/audit-npm-bundle.cjs`.
 */
describe('public facade (ui)', () => {
  it('re-exports createSuperDocUI as a function', async () => {
    expect(typeof createSuperDocUI).toBe('function');
  });

  it('re-exports shallowEqual as a function', async () => {
    expect(typeof shallowEqual).toBe('function');
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('re-exports BUILT_IN_COMMAND_IDS as an object', async () => {
    expect(typeof BUILT_IN_COMMAND_IDS).toBe('object');
    expect(BUILT_IN_COMMAND_IDS).not.toBeNull();
  });

  it('projects tracked-change rows with the public UI compatibility wrapper', async () => {
    const trackedChange = {
      address: { kind: 'trackedChange', changeId: 'tc-1' },
      id: 'tc-1',
      type: 'insert',
      author: 'Avery Writer',
      excerpt: 'Inserted words',
    };
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: {
            list: () => ({ items: [trackedChange] }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    const [row] = ui.trackChanges.getSnapshot().items;

    expect(row).toMatchObject({ id: 'tc-1', type: 'insert' });
    expect(row?.change).toEqual(trackedChange);
    expect(ui.trackChanges.getSnapshot().authors).toEqual(['Avery Writer']);
    expect(ui.trackChanges.accept('tc-1')).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: { kind: 'id', id: 'tc-1' },
    });
  });

  it('routes a story-scoped accept/reject through decide, never the legacy per-id method', async () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const decide = vi.fn(() => ({ success: true }));
    const accept = vi.fn(() => ({ success: true }));
    const reject = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-fn', type: 'insert' }] }),
            // Legacy per-id methods are present but cannot carry a story, so a
            // `{ id, story }` decision must skip them and route through `decide`.
            accept,
            reject,
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.accept({ id: 'tc-fn', story: footnoteStory })).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: { kind: 'id', id: 'tc-fn', story: footnoteStory },
    });
    expect(ui.trackChanges.reject({ id: 'tc-fn', story: footnoteStory })).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'reject',
      target: { kind: 'id', id: 'tc-fn', story: footnoteStory },
    });
    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('keeps the bare-string accept/reject on the legacy-preferred per-id path (unchanged)', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const accept = vi.fn(() => ({ success: true }));
    const reject = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-1', type: 'insert' }] }),
            accept,
            reject,
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    // A bare id is the body / simple case: it still prefers the legacy per-id
    // method (called with the bare id) exactly as before, never `decide`.
    expect(ui.trackChanges.accept('tc-1')).toEqual({ success: true });
    expect(accept).toHaveBeenCalledWith('tc-1');
    expect(ui.trackChanges.reject('tc-1')).toEqual({ success: true });
    expect(reject).toHaveBeenCalledWith('tc-1');
    expect(decide).not.toHaveBeenCalled();
  });

  it('routes legacy font-family command ids through the v2 format API with a selection target', async () => {
    const fontFamily = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          trackChanges: { list: () => ({ items: [] }) },
          format: { fontFamily },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.has('font-family')).toBe(true);
    expect(ui.commands.get('font-family').getState()).toMatchObject({ enabled: true, supported: true });
    // The public Document API requires an explicit target; the controller passes
    // the resolved selection target rather than a bare value.
    expect(await ui.toolbar.execute('font-family', 'Arial')).toEqual({ success: true });
    expect(fontFamily).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: 'Arial' }, { offsetSpace: 'selection' });
  });

  it('routes a multi-paragraph inline format as ONE format.* call with the host\u2019s original selectionTarget (SD-3706)', async () => {
    // Cross-block selections are resolved centrally by the v2 adapter: the
    // controller passes the host's own selectionTarget through, once, with the
    // private editable-offsets option. No mutations.apply plan and no
    // per-paragraph fan-out exist.
    const CROSS_TARGET = {
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 2 },
      end: { kind: 'text', blockId: 'P2', offset: 4 },
    } as const;
    const crossSelection = {
      empty: false,
      target: {
        kind: 'text',
        segments: [
          { blockId: 'P1', range: { start: 2, end: 5 } },
          { blockId: 'P2', range: { start: 0, end: 4 } },
        ],
      },
      selectionTarget: CROSS_TARGET,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'llohell',
    };
    const apply = vi.fn(() => ({ success: true }));
    const fontFamily = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => crossSelection },
          trackChanges: { list: () => ({ items: [] }) },
          format: { fontFamily },
          mutations: { apply },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('font-family', 'Courier New')).toEqual({ success: true });
    expect(fontFamily).toHaveBeenCalledTimes(1);
    expect(fontFamily).toHaveBeenCalledWith(
      { target: CROSS_TARGET, value: 'Courier New' },
      { offsetSpace: 'selection' },
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('fails closed when a host supplies no selectionTarget for a multi-block range selection (SD-3706)', async () => {
    // Deriving a cross-block target from per-block segments would guess at
    // offsets the host never published - the command reports selection-required
    // instead of mutating a guessed range.
    const crossSelectionWithoutTarget = {
      empty: false,
      target: {
        kind: 'text',
        segments: [
          { blockId: 'P1', range: { start: 2, end: 5 } },
          { blockId: 'P2', range: { start: 0, end: 4 } },
        ],
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'llohell',
    };
    const fontFamily = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => crossSelectionWithoutTarget },
          trackChanges: { list: () => ({ items: [] }) },
          format: { fontFamily },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('font-family', 'Courier New')).toBe(false);
    expect(fontFamily).not.toHaveBeenCalled();
  });

  it('applies a mixed-selection bold toggle to the whole selection and removes it on the next toggle (SD-3706)', async () => {
    const CROSS_TARGET = {
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 0 },
      end: { kind: 'text', blockId: 'P2', offset: 4 },
    } as const;
    let activeMarks: string[] = [];
    const crossSelection = () => ({
      empty: false,
      target: {
        kind: 'text',
        segments: [
          { blockId: 'P1', range: { start: 0, end: 5 } },
          { blockId: 'P2', range: { start: 0, end: 4 } },
        ],
      },
      selectionTarget: CROSS_TARGET,
      activeMarks,
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'hellohell',
    });
    const bold = vi.fn(() => ({ success: true }));
    let notifySelection = () => {};
    const superdoc = {
      activeEditor: {
        host: {
          getHandles: () => ({
            editing: {
              selection: {
                subscribe: (listener: () => void) => {
                  notifySelection = listener;
                  return () => {
                    notifySelection = () => {};
                  };
                },
              },
            },
          }),
        },
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: crossSelection },
          trackChanges: { list: () => ({ items: [] }) },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    // Mixed selection (bold not active everywhere) -> toggle ON across the range.
    expect(await ui.toolbar.execute('bold')).toEqual({ success: true });
    expect(bold).toHaveBeenLastCalledWith({ target: CROSS_TARGET, value: true }, { offsetSpace: 'selection' });

    // Once the whole selection is bold, the next toggle removes it.
    activeMarks = ['bold'];
    notifySelection();
    expect(await ui.toolbar.execute('bold')).toEqual({ success: true });
    expect(bold).toHaveBeenLastCalledWith({ target: CROSS_TARGET, value: false }, { offsetSpace: 'selection' });
  });

  it('routes inline format commands as tracked mutations in suggesting mode', async () => {
    const fontFamily = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          trackChanges: { list: () => ({ items: [] }) },
          format: { fontFamily },
        },
      },
      config: { documentMode: 'suggesting' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('font-family', 'Arial')).toEqual({ success: true });
    expect(fontFamily).toHaveBeenCalledWith(
      { target: SELECTION_TARGET, value: 'Arial' },
      { changeMode: 'tracked', offsetSpace: 'selection' },
    );
  });

  it('projects selected inline formatting values into the shared toolbar snapshot', async () => {
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          trackChanges: { list: () => ({ items: [] }) },
          format: {
            fontFamily: vi.fn(),
            fontSize: vi.fn(),
            color: vi.fn(),
            highlight: vi.fn(),
          },
          query: {
            match: vi.fn(() => ({
              items: [
                {
                  address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
                  blocks: [
                    {
                      blockId: 'P1',
                      range: { start: 0, end: 5 },
                      runs: [
                        {
                          range: { start: 0, end: 5 },
                          styles: {
                            fontFamily: 'Courier New',
                            fontSizePt: 18,
                            color: '#D2003F',
                            highlight: '#ECCF35',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            })),
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('font-family').getState()).toMatchObject({ enabled: true, value: 'Courier New' });
    expect(ui.commands.get('font-size').getState()).toMatchObject({ enabled: true, value: '18' });
    expect(ui.commands.get('text-color').getState()).toMatchObject({ enabled: true, value: '#D2003F' });
    expect(ui.commands.get('highlight-color').getState()).toMatchObject({ enabled: true, value: '#ECCF35' });
  });

  it('composes document font options over defaults and recomputes on fonts-changed', async () => {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    let familyOptions = [
      { value: 'Acme, Inc Sans', label: 'Acme, Inc Sans', previewFamily: 'Acme, Inc Sans' },
      { value: 'Arial Black', label: 'Arial Black', previewFamily: 'Arial Black, sans-serif' },
      { value: 'Calibri', label: 'Calibri', previewFamily: 'Calibri, sans-serif' },
      { value: 'Georgia', label: 'Georgia', previewFamily: 'Georgia, serif' },
      { value: 'Verdana', label: 'Verdana', previewFamily: 'Verdana, sans-serif' },
    ];
    let documentOptions: Array<{ logicalFamily: string; previewFamily: string }> = [
      { logicalFamily: 'Cambria', previewFamily: 'Caladea' },
    ];

    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
        },
      },
      fonts: {
        getFontFamilyOptions: () => familyOptions,
        getDocumentFontOptions: () => documentOptions,
      },
      config: { documentMode: 'editing' },
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    // Document fonts lead; the existing runtime picker list backfills.
    const initial = ui.fonts.getFamilyOptions().map((o) => o.value);
    expect(initial[0]).toBe('Cambria');
    expect(initial).toContain('Acme, Inc Sans');
    expect(initial).not.toContain('Acme');
    expect(initial).toContain('Arial Black');
    expect(initial).toContain('Calibri');
    expect(initial).toContain('Georgia');
    expect(initial).toContain('Verdana');

    expect(handlers.has('fonts-changed')).toBe(true);
    familyOptions = [
      { value: 'Arial Black', label: 'Arial Black', previewFamily: 'Arial Black, sans-serif' },
      { value: 'Calibri', label: 'Calibri', previewFamily: 'Calibri, sans-serif' },
      { value: 'Gelasio', label: 'Gelasio', previewFamily: 'Gelasio, serif' },
      { value: 'Verdana', label: 'Verdana', previewFamily: 'Verdana, sans-serif' },
    ];
    documentOptions = [
      { logicalFamily: 'Cambria', previewFamily: 'Caladea' },
      { logicalFamily: 'BrandSans', previewFamily: 'BrandSans' },
    ];
    for (const handler of handlers.get('fonts-changed') ?? []) handler({ source: 'config-change' });

    const values = ui.fonts.getFamilyOptions().map((o) => o.value);
    expect(values.slice(0, 2)).toEqual(['Cambria', 'BrandSans']);
    expect(values).toContain('Gelasio');
  });

  it('maps DocumentFontOption rows over static fallback defaults when the runtime picker is unavailable (SD-3887)', () => {
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
        },
      },
      fonts: {
        // Intentionally the document-only shape (logicalFamily), not FontFamilyOption.value.
        getDocumentFontOptions: () => [
          { logicalFamily: 'Cambria', previewFamily: 'Caladea' },
          { logicalFamily: 'Calibri', previewFamily: 'Carlito' },
          { logicalFamily: '"Acme, Inc Sans", serif', previewFamily: 'Acme, Inc Sans' },
        ],
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    const values = ui.fonts.getFamilyOptions().map((o) => o.value);
    expect(values).toEqual([
      'Cambria',
      'Calibri',
      'Acme, Inc Sans',
      'Arial',
      'Courier New',
      'Georgia',
      'Times New Roman',
      'Verdana',
    ]);
  });

  it('disables inline-format commands with range-selection-required when there is no selection', async () => {
    const fontFamily = vi.fn();
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          format: { fontFamily },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.rangeSelectionRequired,
    });
    // Fail closed: no selection target means the operation is never invoked.
    expect(await ui.toolbar.execute('font-family', 'Arial')).toBe(false);
    expect(fontFamily).not.toHaveBeenCalled();
  });

  it('does not route read-only built-in command routes in viewing mode', async () => {
    const readOnlyReceipt = {
      success: false,
      failure: { code: 'READ_ONLY', message: 'Document is read-only.' },
    };
    const bold = vi.fn(() => readOnlyReceipt);
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          format: { bold },
        },
      },
      config: { documentMode: 'viewing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.bold)).toBe(false);
    expect(bold).not.toHaveBeenCalled();
  });

  it('disables styling commands when the selection overlaps a contentLocked content control (SD-3274)', async () => {
    const bold = vi.fn(() => ({ success: true }));
    const listInRange = vi.fn(() => ({
      items: [{ id: 'cc-1', lockMode: 'contentLocked', target: { kind: 'inline', nodeType: 'sdt', nodeId: 'cc-1' } }],
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          trackChanges: { list: () => ({ items: [] }) },
          contentControls: { list: () => ({ items: [] }), listInRange },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.contentControlLocked,
    });
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.bold)).toBe(false);
    expect(bold).not.toHaveBeenCalled();

    // Alignment (paragraph-level) is never gated by content-control lock.
    expect(ui.commands.get('text-align').getState()).not.toMatchObject({
      reason: SUPERDOC_UI_REASONS.contentControlLocked,
    });
  });

  it('disables styling commands for a COLLAPSED caret inside a contentLocked content control (SD-3274)', async () => {
    // A collapsed caret never resolves an inline selection target
    // (`resolveInlineSelectionTarget` returns null whenever `empty` is true),
    // so this exercises the earlier "no resolved target" branch in
    // `computeCommandState`, distinct from the range-selection case covered
    // by the test above.
    const bold = vi.fn(() => ({ success: true }));
    const listInRange = vi.fn(() => ({
      items: [{ id: 'cc-1', lockMode: 'contentLocked', target: { kind: 'inline', nodeType: 'sdt', nodeId: 'cc-1' } }],
    }));
    const collapsedSelection = {
      empty: true,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 3, end: 3 } }] },
      selectionTarget: null,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => collapsedSelection },
          trackChanges: { list: () => ({ items: [] }) },
          contentControls: { list: () => ({ items: [] }), listInRange },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.contentControlLocked,
    });
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.bold)).toBe(false);
    expect(bold).not.toHaveBeenCalled();
  });

  it('does NOT fail closed on a mutating inline command while the content-control lock read is still pending (regression guard)', async () => {
    // `listInRange` never resolving simulates the real async-worker window
    // right after a selection change, before the lock-mode read for THIS
    // selection has settled — `readAsync`'s cold-read path deliberately
    // defers issuing that read at all for `COLD_ASYNC_READ_START_DELAY_MS`
    // (180ms), so this is the GUARANTEED status on every fresh selection, not
    // a rare race. A prior fix failed closed here reasoning it was an unknown
    // lock state, but that silently blocked ordinary bold/font/format-painter
    // commands on plain documents with no content controls at all (caught by
    // `format-painter.spec.ts` CI failures). The command must proceed while
    // pending; only a confirmed lock (a settled, non-empty lock mode) blocks it.
    const bold = vi.fn(() => ({ success: true }));
    const listInRange = vi.fn(() => new Promise(() => {}));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          trackChanges: { list: () => ({ items: [] }) },
          contentControls: { list: () => ({ items: [] }), listInRange },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.bold)).toEqual({ success: true });
    expect(bold).toHaveBeenCalled();
    expect(listInRange).toHaveBeenCalled();
  });

  it('keeps styling commands enabled when the selection overlaps only an sdtLocked control (wrapper-only lock)', async () => {
    const bold = vi.fn(() => ({ success: true }));
    const listInRange = vi.fn(() => ({
      items: [{ id: 'cc-1', lockMode: 'sdtLocked', target: { kind: 'inline', nodeType: 'sdt', nodeId: 'cc-1' } }],
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          trackChanges: { list: () => ({ items: [] }) },
          contentControls: { list: () => ({ items: [] }), listInRange },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState()).toMatchObject({ enabled: true });
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.bold)).toEqual({ success: true });
  });

  it('routes tracked-change toolbar commands through decide()', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: '',
            }),
          },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-1', type: 'insert' }] }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.acceptChange).getState()).toMatchObject({
      enabled: true,
      supported: true,
    });
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: { kind: 'id', id: 'tc-1' },
    });
  });

  it.each([
    ['accept', BUILT_IN_COMMAND_IDS.acceptChange],
    ['reject', BUILT_IN_COMMAND_IDS.rejectChange],
  ] as const)('routes a partial tracked-change selection through a range %s decision', async (decision, commandId) => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              // Deleted text is zero-width in the visible target. The explicit
              // selection target retains the tracked-coordinate range and must
              // therefore be the source of truth for partial decisions.
              target: {
                kind: 'text',
                story,
                segments: [{ blockId: 'P1', range: { start: 18, end: 18 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story,
                coordinateSpace: 'tracked',
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 24, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: 'move',
            }),
          },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-1', type: 'delete', grouping: 'standalone' }] }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(commandId)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision,
      target: {
        kind: 'range',
        coordinateSpace: 'tracked',
        range: {
          kind: 'text',
          story,
          segments: [{ blockId: 'P1', range: { start: 20, end: 24 } }],
        },
      },
    });
  });

  it('routes a body partial decision while the all-story catalog is pending', async () => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const list = vi.fn((input?: { in?: 'all' }) =>
      input?.in === 'all'
        ? new Promise<never>(() => {})
        : { items: [{ id: 'tc-1', type: 'delete', grouping: 'standalone' }] },
    );
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story,
                segments: [{ blockId: 'P1', range: { start: 18, end: 18 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story,
                coordinateSpace: 'tracked',
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 24, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: 'move',
            }),
          },
          trackChanges: { list, decide },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: {
        kind: 'range',
        coordinateSpace: 'tracked',
        range: {
          kind: 'text',
          story,
          segments: [{ blockId: 'P1', range: { start: 20, end: 24 } }],
        },
      },
    });
  });

  it('falls back to the active tracked-change id when a range decision is not accepted', async () => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi
      .fn()
      .mockReturnValueOnce({ success: false, failure: { code: 'NO_MATCH' } })
      .mockReturnValueOnce({ success: true });
    const accept = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 24, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: 'move',
            }),
          },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-1', type: 'replacement', grouping: 'replacement-pair' }] }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenNthCalledWith(1, {
      decision: 'accept',
      target: {
        kind: 'range',
        coordinateSpace: 'visible',
        range: {
          kind: 'text',
          story,
          segments: [{ blockId: 'P1', range: { start: 20, end: 24 } }],
        },
      },
    });
    expect(decide).toHaveBeenNthCalledWith(2, {
      decision: 'accept',
      target: { kind: 'id', id: 'tc-1' },
    });
  });

  it('keeps the selected story when falling back from a failed range decision to the active id', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const decide = vi
      .fn()
      .mockReturnValueOnce({ success: false, failure: { code: 'NO_MATCH' } })
      .mockReturnValueOnce({ success: true });
    const accept = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'FN-P1', offset: 20, story },
                end: { kind: 'text', blockId: 'FN-P1', offset: 24, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: 'move',
            }),
          },
          trackChanges: {
            list: () => ({
              items: [{ id: 'tc-1', type: 'replacement', grouping: 'replacement-pair', storyLocator: story }],
            }),
            accept,
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenNthCalledWith(1, {
      decision: 'accept',
      target: {
        kind: 'range',
        coordinateSpace: 'visible',
        range: {
          kind: 'text',
          story,
          segments: [{ blockId: 'FN-P1', range: { start: 20, end: 24 } }],
        },
      },
    });
    expect(decide).toHaveBeenNthCalledWith(2, {
      decision: 'accept',
      target: { kind: 'id', id: 'tc-1', story },
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it('uses the all-story catalog for a partial tracked change outside the body', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const list = vi.fn((input?: { in?: 'all' }) => ({
      items:
        input?.in === 'all'
          ? [{ id: 'tc-footnote', type: 'insertion', grouping: 'standalone', storyLocator: story }]
          : [],
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: { kind: 'text', story, segments: [{ blockId: 'FN-P1', range: { start: 3, end: 7 } }] },
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'FN-P1', offset: 3, story },
                end: { kind: 'text', blockId: 'FN-P1', offset: 7, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-footnote'],
              text: 'note',
            }),
          },
          trackChanges: { list, decide },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(list).toHaveBeenCalledWith({ in: 'all' });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: {
        kind: 'range',
        coordinateSpace: 'visible',
        range: {
          kind: 'text',
          story,
          segments: [{ blockId: 'FN-P1', range: { start: 3, end: 7 } }],
        },
      },
    });
  });

  it('keeps selection-driven activeId for a non-body change via the all-story catalog', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const list = vi.fn((input?: { in?: 'all' }) => {
      if (input?.in === 'all') {
        return Promise.resolve({
          items: [{ id: 'tc-footnote', type: 'insertion', grouping: 'standalone', storyLocator: story }],
        });
      }
      // Body-only inventory omits the footnote change.
      return { items: [] };
    });
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: { kind: 'text', story, segments: [{ blockId: 'FN-P1', range: { start: 3, end: 7 } }] },
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'FN-P1', offset: 3, story },
                end: { kind: 'text', blockId: 'FN-P1', offset: 7, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-footnote'],
              text: 'note',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    // Unsettled all-story: do not publish a non-body id before the catalog can
    // prove whether it is canonical or a painted alias.
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledWith({ in: 'all' });
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-footnote');
    });
    // The public slice now carries non-body rows too (#939 made them visible to
    // custom UIs), so the point of this test is narrower than when it was written:
    // activeId resolves the non-body selection through the all-story catalog
    // rather than publishing a raw alias.
    expect(ui.trackChanges.getSnapshot().items.map((item) => (item as { id: string }).id)).toEqual(['tc-footnote']);
  });

  it('skips selection aliases absent from body and all-story inventories when resolving activeId', async () => {
    const list = vi.fn((input?: { in?: 'all' }) => ({
      items: input?.in === 'all' ? [{ id: 'tc-1', type: 'insert' }] : [{ id: 'tc-1', type: 'insert' }],
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 1 } }] },
              selectionTarget: SELECTION_TARGET,
              activeMarks: [],
              activeCommentIds: [],
              // Ghost painted alias first; real public id second.
              activeChangeIds: ['ghost-alias', 'tc-1'],
              text: 'x',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
  });

  it('does not map a footnote selection alias onto a body change that reuses the same Word revision id', async () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const bodyStory = { kind: 'story', storyType: 'body' } as const;
    // Same raw Word w:id on body + footnote — unscoped / body-first mapping would
    // resolve the footnote caret to the body public id.
    const sharedWordId = '42';
    const bodyRow = {
      id: 'tc-body',
      type: 'insertion',
      grouping: 'standalone',
      storyLocator: bodyStory,
      sourceIds: { wordIdInsert: sharedWordId },
    };
    const footnoteRow = {
      id: 'tc-footnote',
      type: 'insertion',
      grouping: 'standalone',
      storyLocator: footnoteStory,
      sourceIds: { wordIdInsert: sharedWordId },
    };
    const list = vi.fn((input?: { in?: 'all' }) => ({
      items: input?.in === 'all' ? [bodyRow, footnoteRow] : [bodyRow],
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: footnoteStory,
                segments: [{ blockId: 'FN-P1', range: { start: 0, end: 2 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: footnoteStory,
                start: { kind: 'text', blockId: 'FN-P1', offset: 0, story: footnoteStory },
                end: { kind: 'text', blockId: 'FN-P1', offset: 2, story: footnoteStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: [`imported:${sharedWordId}`],
              text: 'fn',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-footnote');
    expect(ui.trackChanges.getSnapshot().activeId).not.toBe('tc-body');
  });

  it('does not expose a colliding non-body selection alias while the all-story catalog is pending', async () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const bodyStory = { kind: 'story', storyType: 'body' } as const;
    const sharedWordId = '42';
    const bodyRow = {
      id: 'tc-body',
      type: 'insertion',
      grouping: 'standalone',
      storyLocator: bodyStory,
      sourceIds: { wordIdInsert: sharedWordId },
    };
    const footnoteRow = {
      id: 'tc-footnote',
      type: 'insertion',
      grouping: 'standalone',
      storyLocator: footnoteStory,
      sourceIds: { wordIdInsert: sharedWordId },
    };
    let resolveAllStory!: (value: { items: unknown[] }) => void;
    const allStory = new Promise<{ items: unknown[] }>((resolve) => {
      resolveAllStory = resolve;
    });
    const list = vi.fn((input?: { in?: 'all' }) => (input?.in === 'all' ? allStory : { items: [bodyRow] }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: footnoteStory,
                segments: [{ blockId: 'FN-P1', range: { start: 0, end: 2 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: footnoteStory,
                start: { kind: 'text', blockId: 'FN-P1', offset: 0, story: footnoteStory },
                end: { kind: 'text', blockId: 'FN-P1', offset: 2, story: footnoteStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: [`imported:${sharedWordId}`],
              text: 'fn',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    expect(ui.trackChanges.getSnapshot().activeId).not.toBe(`imported:${sharedWordId}`);

    resolveAllStory({ items: [bodyRow, footnoteRow] });
    await vi.waitFor(() => {
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-footnote');
    });
  });

  it('does not expose a non-colliding non-body selection alias while the all-story catalog is pending', async () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const sharedWordId = '42';
    const footnoteRow = {
      id: 'tc-footnote',
      type: 'insertion',
      grouping: 'standalone',
      storyLocator: footnoteStory,
      sourceIds: { wordIdInsert: sharedWordId },
    };
    let resolveAllStory!: (value: { items: unknown[] }) => void;
    const allStory = new Promise<{ items: unknown[] }>((resolve) => {
      resolveAllStory = resolve;
    });
    const list = vi.fn((input?: { in?: 'all' }) => (input?.in === 'all' ? allStory : { items: [] }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: footnoteStory,
                segments: [{ blockId: 'FN-P1', range: { start: 0, end: 2 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: footnoteStory,
                start: { kind: 'text', blockId: 'FN-P1', offset: 0, story: footnoteStory },
                end: { kind: 'text', blockId: 'FN-P1', offset: 2, story: footnoteStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: [`imported:${sharedWordId}`],
              text: 'fn',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    expect(ui.trackChanges.getSnapshot().activeId).not.toBe(`imported:${sharedWordId}`);

    resolveAllStory({ items: [footnoteRow] });
    await vi.waitFor(() => {
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-footnote');
    });
  });

  it('retains a canonical textbox selection id when the all-story row has no story locator', async () => {
    const textboxStory = { kind: 'story', storyType: 'textbox', textboxId: 'tx-1' } as const;
    const textboxRow = {
      id: 'tc-textbox',
      type: 'insertion',
      grouping: 'standalone',
    };
    let resolveAllStory!: (value: { items: unknown[] }) => void;
    const allStory = new Promise<{ items: unknown[] }>((resolve) => {
      resolveAllStory = resolve;
    });
    const list = vi.fn((input?: { in?: 'all' }) => (input?.in === 'all' ? allStory : { items: [] }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: textboxStory,
                segments: [{ blockId: 'TX-P1', range: { start: 0, end: 2 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: textboxStory,
                start: { kind: 'text', blockId: 'TX-P1', offset: 0, story: textboxStory },
                end: { kind: 'text', blockId: 'TX-P1', offset: 2, story: textboxStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-textbox'],
              text: 'tx',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();

    resolveAllStory({ items: [textboxRow] });
    await vi.waitFor(() => {
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-textbox');
    });
  });

  it('keeps the first active id when a textbox selection spans independent changes', async () => {
    // Several changes in one textbox is ordinary, not ambiguous: the ids describe
    // different revisions. Clearing activeId here would drop the highlight for a
    // perfectly resolvable selection.
    const textboxStory = { kind: 'story', storyType: 'textbox', textboxId: 'tx-1' } as const;
    const first = {
      id: 'tc-a',
      type: 'insertion',
      grouping: 'standalone',
      sourceIds: { wordIdInsert: '1' },
    };
    const second = {
      id: 'tc-b',
      type: 'insertion',
      grouping: 'standalone',
      sourceIds: { wordIdInsert: '2' },
    };
    const list = vi.fn((input?: { in?: 'all' }) => (input?.in === 'all' ? { items: [first, second] } : { items: [] }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: textboxStory,
                segments: [{ blockId: 'TX-P1', range: { start: 0, end: 9 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: textboxStory,
                start: { kind: 'text', blockId: 'TX-P1', offset: 0, story: textboxStory },
                end: { kind: 'text', blockId: 'TX-P1', offset: 9, story: textboxStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-a', 'tc-b'],
              text: 'two spans',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    await vi.waitFor(() => {
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-a');
    });
  });

  it('does not resolve a textbox selection to a body row that also omits its story', async () => {
    // Body rows omit their locator too (body is the documented default), so a
    // missing story is not proof of textbox ownership. With one Word revision id
    // shared between a textbox and a body change, live selection can supply both
    // canonical ids and the catalog order would otherwise decide the winner.
    const textboxStory = { kind: 'story', storyType: 'textbox', textboxId: 'tx-1' } as const;
    const wordId = '42';
    const bodyRow = {
      id: 'tc-body',
      type: 'insertion',
      grouping: 'standalone',
      sourceIds: { wordIdInsert: wordId },
    };
    const textboxRow = {
      id: 'tc-textbox',
      type: 'insertion',
      grouping: 'standalone',
      sourceIds: { wordIdInsert: wordId },
    };
    const list = vi.fn((input?: { in?: 'all' }) =>
      // Body listed first, which is the ordering that used to win.
      input?.in === 'all' ? { items: [bodyRow, textboxRow] } : { items: [bodyRow] },
    );
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: textboxStory,
                segments: [{ blockId: 'TX-P1', range: { start: 0, end: 2 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: textboxStory,
                start: { kind: 'text', blockId: 'TX-P1', offset: 0, story: textboxStory },
                end: { kind: 'text', blockId: 'TX-P1', offset: 2, story: textboxStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-body', 'tc-textbox'],
              text: 'tx',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledWith({ in: 'all' });
    });
    // Ambiguous, so fail closed rather than activate the body change.
    expect(ui.trackChanges.getSnapshot().activeId).not.toBe('tc-body');
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
  });

  it('does not map a body selection alias onto a story-less row sharing its revision id', async () => {
    // A row with no story locator shares the body story signature, so an
    // unfiltered body lookup can alias a body selection onto a textbox change
    // that reuses the same Word revision id.
    const bodyStory = { kind: 'story', storyType: 'body' } as const;
    const sharedWordId = '42';
    const storylessRow = {
      id: 'tc-textbox',
      type: 'insertion',
      grouping: 'standalone',
      sourceIds: { wordIdInsert: sharedWordId },
    };
    const bodyRow = {
      id: 'tc-body',
      type: 'insertion',
      grouping: 'standalone',
      storyLocator: bodyStory,
      sourceIds: { wordIdInsert: sharedWordId },
    };
    const list = vi.fn((input?: { in?: 'all' }) =>
      // The story-less row is first, so a first-wins alias map would pick it.
      input?.in === 'all' ? { items: [storylessRow, bodyRow] } : { items: [bodyRow] },
    );
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story: bodyStory,
                segments: [{ blockId: 'P1', range: { start: 0, end: 2 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story: bodyStory,
                start: { kind: 'text', blockId: 'P1', offset: 0, story: bodyStory },
                end: { kind: 'text', blockId: 'P1', offset: 2, story: bodyStory },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: [`imported:${sharedWordId}`],
              text: 'bd',
            }),
          },
          trackChanges: { list },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });
    await vi.waitFor(() => {
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-body');
    });
    expect(ui.trackChanges.getSnapshot().activeId).not.toBe('tc-textbox');
  });

  it('keeps an atomic grouped insertion on the whole-change ID path', async () => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'P1', offset: 2, story },
                end: { kind: 'text', blockId: 'P1', offset: 6, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-group'],
              text: 'line',
            }),
          },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-group', type: 'insertion', grouping: 'unknown' }] }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'id', id: 'tc-group' } });
  });

  it('routes a partially selected replacement through the selected text range', async () => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 24, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-replacement'],
              text: 'move',
            }),
          },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-replacement', type: 'replacement', grouping: 'replacement-pair' }] }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: {
        kind: 'range',
        coordinateSpace: 'visible',
        range: {
          kind: 'text',
          story,
          segments: [{ blockId: 'P1', range: { start: 20, end: 24 } }],
        },
      },
    });
  });

  it('routes an exactly selected replacement side through the whole-change ID decision', async () => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 29, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-replacement'],
              text: 'two years',
            }),
          },
          trackChanges: {
            list: () => ({
              items: [
                {
                  id: 'tc-replacement',
                  type: 'replacement',
                  grouping: 'replacement-pair',
                  insertedText: 'two years',
                  deletedText: 'one year',
                  excerpt: 'one year -> two years',
                },
              ],
            }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: { kind: 'id', id: 'tc-replacement' },
    });
  });

  it('preserves the selected story for a fully selected inserted replacement side range', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '1' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 29, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-replacement'],
              text: 'two years',
            }),
          },
          trackChanges: {
            list: () => ({
              items: [
                {
                  id: 'tc-replacement',
                  storyLocator: story,
                  type: 'replacement',
                  grouping: 'replacement-pair',
                  insertedText: 'two years',
                  deletedText: 'one year',
                  excerpt: 'one year -> two years',
                },
              ],
            }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: { kind: 'id', id: 'tc-replacement', story },
    });
  });

  it('keeps the selected story when a whole selected replacement uses the tracked-change id path', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '7' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const accept = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              selectionTarget: {
                kind: 'selection',
                story,
                start: { kind: 'text', blockId: 'FN-P1', offset: 20, story },
                end: { kind: 'text', blockId: 'FN-P1', offset: 29, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-replacement'],
              text: 'one year -> two years',
            }),
          },
          trackChanges: {
            list: () => ({
              items: [
                {
                  id: 'tc-replacement',
                  type: 'replacement',
                  grouping: 'replacement-pair',
                  insertedText: 'two years',
                  deletedText: 'one year',
                  excerpt: 'one year -> two years',
                  storyLocator: story,
                },
              ],
            }),
            accept,
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({
      decision: 'accept',
      target: { kind: 'id', id: 'tc-replacement', story },
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it.each([
    ['accept', BUILT_IN_COMMAND_IDS.acceptChange],
    ['reject', BUILT_IN_COMMAND_IDS.rejectChange],
  ] as const)('routes selected tracked changes through one atomic %s decision', async (decision, commandId) => {
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1', 'tc-2'],
              text: 'changed text',
            }),
          },
          trackChanges: {
            list: () => ({
              items: [
                { id: 'tc-1', type: 'insert' },
                { id: 'tc-2', type: 'delete' },
              ],
            }),
            decide,
          },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute(commandId)).toEqual({ success: true });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith({
      decision,
      target: { kind: 'ids', ids: ['tc-1', 'tc-2'] },
    });
  });

  it('routes public comments handle resolve and reopen with canonical commentId inputs', async () => {
    const receipt = { success: true };
    const patch = vi.fn(() => receipt);
    const superdoc = {
      activeEditor: {
        doc: {
          comments: {
            list: () => ({ items: [] }),
            patch,
          },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };

    const ui = createSuperDocUI({ superdoc });

    expect(ui.comments.resolve('c1')).toBe(receipt);
    expect(ui.comments.reopen('c1')).toBe(receipt);
    expect(patch).toHaveBeenNthCalledWith(1, { commentId: 'c1', status: 'resolved' });
    expect(patch).toHaveBeenNthCalledWith(2, { commentId: 'c1', status: 'active' });
  });

  // cui-selection-040: the selection slice + geometry read truthfully from the
  // v2 live-selection source.
  const TARGET = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 6, end: 11 } }] } as const;

  function makeSelectionSuperdoc(
    overrides: {
      info?: unknown;
      getSelectionAnchorRect?: (input?: unknown) => unknown;
      apply?: (target: unknown) => unknown;
    } = {},
  ) {
    const current = vi.fn((_input?: { includeText?: boolean }) =>
      'info' in overrides
        ? overrides.info
        : {
            empty: false,
            target: TARGET,
            activeMarks: [],
            activeCommentIds: [],
            activeChangeIds: [],
            text: 'world',
          },
    );
    const apply = vi.fn(overrides.apply ?? (() => ({ ok: true, mode: 'range' })));
    const host = {
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} }, selectionTargets: { apply } } }),
      ...(overrides.getSelectionAnchorRect ? { getSelectionAnchorRect: overrides.getSelectionAnchorRect } : {}),
    };
    const superdoc = {
      activeEditor: {
        host,
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    return { superdoc, current, apply };
  }

  it('computeSelection requests includeText and reflects info.empty + info.text', async () => {
    const { superdoc, current } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const slice = ui.selection.getSnapshot();
    expect(current).toHaveBeenCalledWith({ includeText: true });
    expect(slice.empty).toBe(false);
    expect(slice.quotedText).toBe('world');
    expect(slice.target).toEqual(TARGET);
  });

  it('refreshes the selection projection when document mode changes', () => {
    const handlers = new Map<string, () => void>();
    let info: unknown = {
      empty: false,
      target: TARGET,
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      text: 'world',
    };
    const current = vi.fn(() => info);
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.getSnapshot()).toMatchObject({ empty: false, quotedText: 'world' });

    info = { empty: true, target: null, selectionTarget: null };
    superdoc.config.documentMode = 'viewing';
    handlers.get('document-mode-change')?.();
    expect(ui.selection.getSnapshot()).toMatchObject({ empty: true, quotedText: '' });

    info = {
      empty: false,
      target: TARGET,
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      text: 'world',
    };
    superdoc.config.documentMode = 'editing';
    handlers.get('document-mode-change')?.();
    expect(ui.selection.getSnapshot()).toMatchObject({ empty: false, quotedText: 'world' });
    expect(current).toHaveBeenCalledTimes(3);
  });

  it('treats info.empty:true as empty even when text is present', async () => {
    const { superdoc } = makeSelectionSuperdoc({
      info: { empty: true, target: TARGET, activeMarks: [], activeCommentIds: [], activeChangeIds: [], text: '' },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.getSnapshot().empty).toBe(true);
  });

  it('getAnchorRect prefers the v2 host geometry hook with placement', async () => {
    const getSelectionAnchorRect = vi.fn(() => ({
      pageIndex: 0,
      left: 12,
      right: 60,
      top: 30,
      bottom: 48,
      width: 48,
      height: 18,
    }));
    const { superdoc } = makeSelectionSuperdoc({ getSelectionAnchorRect });
    const ui = createSuperDocUI({ superdoc });
    const rect = ui.selection.getAnchorRect({ placement: 'start' });
    expect(getSelectionAnchorRect).toHaveBeenCalledWith({ placement: 'start' });
    expect(rect).toMatchObject({ left: 12, top: 30, width: 48, height: 18 });
  });

  it('getAnchorRect returns null when the v2 host geometry hook cannot resolve a painted rect', async () => {
    const getSelectionAnchorRect = vi.fn(() => null);
    const { superdoc } = makeSelectionSuperdoc({ getSelectionAnchorRect });
    const ui = createSuperDocUI({ superdoc });
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 1, right: 11, top: 2, bottom: 12, width: 10, height: 10 }),
      }),
    } as unknown as Selection);

    try {
      expect(ui.selection.getAnchorRect({ placement: 'start' })).toBeNull();
      expect(getSelectionAnchorRect).toHaveBeenCalledWith({ placement: 'start' });
      expect(getSelection).not.toHaveBeenCalled();
    } finally {
      getSelection.mockRestore();
    }
  });

  it('getAnchorRect fails closed when the host hook is absent', async () => {
    const { superdoc } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.getAnchorRect({ placement: 'start' })).toBeNull();
  });

  it('restore re-applies the captured target through the host selection helper', async () => {
    const { superdoc, apply } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    expect(ui.selection.restore(capture!)).toEqual({ ok: true, success: true });
    expect(apply).toHaveBeenCalledWith({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 6 },
      end: { kind: 'text', blockId: 'P1', offset: 11 },
    });
  });

  it('restore rebuilds a multi-segment same-story selection when the source exposes only a text target', async () => {
    const { superdoc, apply } = makeSelectionSuperdoc({
      info: {
        empty: false,
        target: {
          kind: 'text',
          segments: [
            { blockId: 'P1', range: { start: 0, end: 5 } },
            { blockId: 'P3', range: { start: 2, end: 4 } },
          ],
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: 'hello world',
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    expect(ui.selection.restore(capture!)).toEqual({ ok: true, success: true });
    expect(apply).toHaveBeenCalledWith({
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 0 },
      end: { kind: 'text', blockId: 'P3', offset: 4 },
    });
  });

  it('restore fails closed with not-ready when no editor is mounted', async () => {
    const { superdoc } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    (superdoc as { activeEditor: unknown }).activeEditor = null;
    expect(ui.selection.restore(capture!)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.notReady,
    });
  });

  it('restore fails closed with target-unresolved when the capture has no usable target', async () => {
    const { superdoc, apply } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = {
      empty: false,
      target: null,
      selectionTarget: null,
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      text: '',
      capturedAt: Date.now(),
    } as unknown as NonNullable<ReturnType<typeof ui.selection.capture>>;
    expect(ui.selection.restore(capture)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.targetUnresolved,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a segment with no range', segments: [{ blockId: 'P1' }] },
    { label: 'a negative start offset', segments: [{ blockId: 'P1', range: { start: -4, end: 1 } }] },
    { label: 'an inverted range (start > end)', segments: [{ blockId: 'P1', range: { start: 8, end: 2 } }] },
    { label: 'a non-integer offset', segments: [{ blockId: 'P1', range: { start: 0, end: 1.5 } }] },
    {
      label: 'a malformed middle segment among valid endpoints',
      segments: [
        { blockId: 'P1', range: { start: 0, end: 5 } },
        { blockId: 'P2' },
        { blockId: 'P3', range: { start: 2, end: 4 } },
      ],
    },
  ])('restore fails closed with target-unresolved for a capture with $label', async ({ segments }) => {
    const { superdoc, apply } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = {
      empty: false,
      target: { kind: 'text', segments },
      selectionTarget: null,
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      text: '',
      capturedAt: Date.now(),
    } as unknown as NonNullable<ReturnType<typeof ui.selection.capture>>;
    expect(ui.selection.restore(capture)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.targetUnresolved,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('restore fails closed for a capture whose segment array has a sparse endpoint hole', async () => {
    const { superdoc, apply } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    // Build a genuine sparse array (hole at index 0) rather than a literal, so
    // the regression is exercised: `Array.prototype.every` skips holes, which
    // once let a hole reach `segments[0].blockId` and throw.
    const sparseSegments: unknown[] = [];
    sparseSegments[1] = { blockId: 'P2', range: { start: 0, end: 3 } };
    const capture = {
      empty: false,
      target: { kind: 'text', segments: sparseSegments },
      selectionTarget: null,
      activeMarks: [],
      activeCommentIds: [],
      activeChangeIds: [],
      text: '',
      capturedAt: Date.now(),
    } as unknown as NonNullable<ReturnType<typeof ui.selection.capture>>;
    expect(() => ui.selection.restore(capture)).not.toThrow();
    expect(ui.selection.restore(capture)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.targetUnresolved,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('restore reports not-ready when the host handle surface throws a lifecycle error', async () => {
    const { superdoc } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    superdoc.activeEditor.host = {
      getHandles: () => {
        throw Object.assign(new Error('v2-editor-host: host-not-ready'), {
          name: 'V2EditorHostError',
          reason: 'host-not-ready',
        });
      },
    };
    expect(ui.selection.restore(capture!)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.notReady,
    });
  });

  it('restore fails closed when the host selection helper is absent', async () => {
    const { superdoc } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    superdoc.activeEditor.host = { getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }) };
    expect(ui.selection.restore(capture!)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable,
    });
  });

  it('restore passes a host apply failure reason through', async () => {
    const { superdoc, apply } = makeSelectionSuperdoc({
      apply: () => ({ ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly }),
    });
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    expect(ui.selection.restore(capture!)).toEqual({
      ok: false,
      success: false,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('restore supports the v1 success-branch pattern', async () => {
    const { superdoc } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const capture = ui.selection.capture();
    expect(capture).not.toBeNull();
    const fallback = vi.fn();
    if (!ui.selection.restore(capture!)?.success) fallback();
    expect(fallback).not.toHaveBeenCalled();
    superdoc.activeEditor.host = { getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }) };
    if (!ui.selection.restore(capture!)?.success) fallback();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('apply routes a provided selection target through the host selection helper', async () => {
    const { superdoc, apply } = makeSelectionSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.apply(SELECTION_TARGET)).toEqual({ ok: true });
    expect(apply).toHaveBeenCalledWith(SELECTION_TARGET);
  });

  it('apply fails closed when the host selection helper is absent', async () => {
    const { superdoc } = makeSelectionSuperdoc();
    superdoc.activeEditor.host = { getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }) };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.apply(SELECTION_TARGET)).toEqual({
      ok: false,
      reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable,
    });
  });
});

describe('public ui — context menu runtime control', () => {
  it('opens and closes through the active editor facade', () => {
    const open = vi.fn(() => ({ ok: true }));
    const close = vi.fn();
    const superdoc = {
      activeEditor: { editorVersion: 2, contextMenu: { open, close } },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.contextMenu.open()).toEqual({ ok: true });
    expect(open).toHaveBeenCalledOnce();

    ui.contextMenu.close();
    expect(close).toHaveBeenCalledOnce();

    ui.destroy();
    expect(ui.contextMenu.open()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.notReady });
    expect(open).toHaveBeenCalledOnce();
    ui.contextMenu.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves stable failure reasons from the editor facade', () => {
    const superdoc = {
      activeEditor: {
        editorVersion: 2,
        contextMenu: { open: () => ({ ok: false, reason: 'geometry-unavailable' }) },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.contextMenu.open()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.geometryUnavailable });
  });

  it('fails closed before the editor or surface is available', () => {
    const superdoc = { activeEditor: null, on: vi.fn(), off: vi.fn() };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.contextMenu.open()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.notReady });
    superdoc.activeEditor = {};
    expect(ui.contextMenu.open()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
    expect(() => ui.contextMenu.close()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Viewport + metadata geometry: routes through the v2 host target-geometry
// surface, resolves metadata through the Document API, and fails closed.
// ---------------------------------------------------------------------------

describe('public ui — viewport + metadata geometry', () => {
  const RECT = { pageIndex: 0, left: 10, right: 50, top: 20, bottom: 40, width: 40, height: 20 };
  const META_TARGET = {
    kind: 'selection',
    start: { kind: 'text', blockId: 'P1', offset: 6 },
    end: { kind: 'text', blockId: 'P1', offset: 11 },
  };

  function makeGeometrySuperdoc(
    opts: {
      getTargetRects?: (input: unknown) => unknown;
      scrollTargetIntoView?: (input: unknown) => unknown;
      resolve?: (input: { id: string }) => unknown;
      omitHost?: boolean;
      omitMetadata?: boolean;
    } = {},
  ) {
    const getTargetRects = vi.fn(
      opts.getTargetRects ?? (() => ({ success: true, rects: [RECT], rect: RECT, pageIndex: 0 })),
    );
    const scrollTargetIntoView = vi.fn(opts.scrollTargetIntoView ?? (async () => ({ success: true })));
    let geometryListener: (() => void) | null = null;
    const observeGeometry = vi.fn((listener: () => void) => {
      geometryListener = listener;
      return () => {
        geometryListener = null;
      };
    });
    const resolve = vi.fn(opts.resolve ?? ((input: { id: string }) => ({ id: input.id, target: META_TARGET })));
    const host = opts.omitHost
      ? undefined
      : { getTargetRects, scrollTargetIntoView, observeGeometry, getHandles: () => ({ editing: null }) };
    const doc: Record<string, unknown> = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    if (!opts.omitMetadata) doc.metadata = { resolve };
    const superdoc = {
      activeEditor: {
        ...(host ? { host } : {}),
        doc,
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    return {
      superdoc,
      getTargetRects,
      scrollTargetIntoView,
      observeGeometry,
      resolve,
      fireGeometry: () => geometryListener?.(),
    };
  }

  it('viewport.getRect routes to the v2 host getTargetRects and returns painted rects', async () => {
    const target = { kind: 'text', blockId: 'P1', range: { start: 6, end: 11 } } as const;
    const { superdoc, getTargetRects } = makeGeometrySuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const result = ui.viewport.getRect({ target });
    expect(getTargetRects).toHaveBeenCalledWith({ target });
    expect(result.found).toBe(true);
    expect(result.success).toBe(true);
    expect(result.rects).toHaveLength(1);
    expect(result.rect).toMatchObject({ left: 10, top: 20, width: 40, height: 20 });
  });

  it('viewport.getRect fails closed with the host reason for an unresolved target', async () => {
    const { superdoc } = makeGeometrySuperdoc({ getTargetRects: () => ({ success: false, reason: 'unresolved' }) });
    const ui = createSuperDocUI({ superdoc });
    const result = ui.viewport.getRect({ target: { kind: 'text', blockId: 'missing', range: { start: 0, end: 1 } } });
    expect(result.found).toBe(false);
    expect(result.success).toBe(false);
    expect(result.rects).toEqual([]);
    expect(result.reason).toBe('unresolved');
  });

  it('viewport.getRect fails closed (unavailable) when the host geometry surface is absent', async () => {
    const { superdoc } = makeGeometrySuperdoc({ omitHost: true });
    const ui = createSuperDocUI({ superdoc });
    const result = ui.viewport.getRect({ target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 1 } } });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('metadata.getRect resolves the id through doc.metadata.resolve then host geometry', async () => {
    const { superdoc, resolve, getTargetRects } = makeGeometrySuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const result = ui.metadata.getRect({ id: 'cite-001' });
    expect(resolve).toHaveBeenCalledWith({ id: 'cite-001' });
    expect(getTargetRects).toHaveBeenCalledWith({ target: META_TARGET });
    expect(result.success).toBe(true);
    expect(result.rect).toMatchObject({ left: 10, top: 20 });
  });

  it('metadata.getRect fails closed when the metadata id does not resolve', async () => {
    const { superdoc } = makeGeometrySuperdoc({ resolve: () => null });
    const ui = createSuperDocUI({ superdoc });
    const result = ui.metadata.getRect({ id: 'missing' });
    expect(result.found).toBe(false);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('unresolved');
  });

  it('metadata.getRect fails closed when the Document API metadata surface is unavailable', async () => {
    const { superdoc } = makeGeometrySuperdoc({ omitMetadata: true });
    const ui = createSuperDocUI({ superdoc });
    const result = ui.metadata.getRect({ id: 'cite-001' });
    expect(result.found).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('metadata.getRect settles async metadata.resolve through the read coordinator', async () => {
    const { superdoc, resolve, getTargetRects } = makeGeometrySuperdoc({
      resolve: (input) => Promise.resolve({ id: input.id, target: META_TARGET }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.metadata.getRect({ id: 'cite-001' })).toMatchObject({ found: false, reason: 'unresolved' });
    await Promise.resolve();
    const result = ui.metadata.getRect({ id: 'cite-001' });

    expect(resolve).toHaveBeenCalledWith({ id: 'cite-001' });
    expect(getTargetRects).toHaveBeenCalledWith({ target: META_TARGET });
    expect(result.success).toBe(true);
  });

  it('metadata.scrollIntoView resolves the id and delegates to host.scrollTargetIntoView', async () => {
    const { superdoc, resolve, scrollTargetIntoView } = makeGeometrySuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.metadata.scrollIntoView({ id: 'cite-001', block: 'center' });
    expect(result).toEqual({ success: true });
    expect(resolve).toHaveBeenCalledWith({ id: 'cite-001' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target: META_TARGET, block: 'center', behavior: 'smooth' });
  });

  it('metadata.scrollIntoView awaits async metadata.resolve before scrolling', async () => {
    const { superdoc, scrollTargetIntoView } = makeGeometrySuperdoc({
      resolve: (input) => Promise.resolve({ id: input.id, target: META_TARGET }),
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.metadata.scrollIntoView({ id: 'cite-001', block: 'center' });

    expect(result).toEqual({ success: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target: META_TARGET, block: 'center', behavior: 'smooth' });
  });

  it('metadata.scrollIntoView fails closed when the id does not resolve', async () => {
    const { superdoc, scrollTargetIntoView } = makeGeometrySuperdoc({ resolve: () => null });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.metadata.scrollIntoView({ id: 'missing' });
    expect(result).toEqual({ success: false });
    expect(scrollTargetIntoView).not.toHaveBeenCalled();
  });

  // A multi-paragraph metadata anchor resolves to a `TextTarget` (one segment
  // per paragraph) rather than the single-range `SelectionTarget` above.
  // `metadata.getRect`/`scrollIntoView` never branch on the resolved target's
  // shape — they forward whatever `doc.metadata.resolve` returns straight to
  // the host geometry surface — so this proves that pass-through actually
  // carries a multi-segment target through unmodified, not just a
  // single-range one.
  const MULTI_SEGMENT_META_TARGET = {
    kind: 'text',
    segments: [
      { blockId: 'P1', range: { start: 6, end: 11 } },
      { blockId: 'P2', range: { start: 0, end: 4 } },
    ],
  };

  it('metadata.getRect forwards a multi-segment TextTarget resolve result to host geometry unmodified', async () => {
    const { superdoc, resolve, getTargetRects } = makeGeometrySuperdoc({
      resolve: (input) => ({ id: input.id, target: MULTI_SEGMENT_META_TARGET }),
    });
    const ui = createSuperDocUI({ superdoc });
    const result = ui.metadata.getRect({ id: 'cite-multi' });
    expect(resolve).toHaveBeenCalledWith({ id: 'cite-multi' });
    expect(getTargetRects).toHaveBeenCalledWith({ target: MULTI_SEGMENT_META_TARGET });
    expect(result.success).toBe(true);
  });

  it('metadata.scrollIntoView forwards a multi-segment TextTarget resolve result to host geometry unmodified', async () => {
    const { superdoc, resolve, scrollTargetIntoView } = makeGeometrySuperdoc({
      resolve: (input) => ({ id: input.id, target: MULTI_SEGMENT_META_TARGET }),
    });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.metadata.scrollIntoView({ id: 'cite-multi', block: 'center' });
    expect(result).toEqual({ success: true });
    expect(resolve).toHaveBeenCalledWith({ id: 'cite-multi' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: MULTI_SEGMENT_META_TARGET,
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('viewport.observe subscribes to host geometry invalidation and fires the listener (coalesced)', async () => {
    const { superdoc, observeGeometry, fireGeometry } = makeGeometrySuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const listener = vi.fn();
    const unsubscribe = ui.viewport.observe(listener);
    expect(observeGeometry).toHaveBeenCalledTimes(1);
    fireGeometry();
    // Coalesced via requestAnimationFrame — flush one frame.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  // row-862: bullet-list / numbered-list toolbar ids route through the v2 edit
  // command path (`activeEditor.editCommands.lists.apply`), report supported
  // state, and surface per-alias active state from the edit-command snapshot.
  function makeListSuperdoc(
    options: {
      apply?: ReturnType<typeof vi.fn>;
      activeSeed?: 'bullet' | 'ordered' | null;
      enabled?: boolean;
      shippedStatus?: string;
      mode?: 'editing' | 'viewing';
    } = {},
  ) {
    const apply = options.apply ?? vi.fn(() => Promise.resolve({ status: 'committed' }));
    const getSnapshot = vi.fn(() => ({
      commands: {
        'lists.apply': {
          enabled: options.enabled ?? true,
          reason: options.enabled === false ? 'editing-selection-required' : null,
          shippedStatus: options.shippedStatus ?? 'supported',
          active: options.activeSeed != null,
          value: { seed: options.activeSeed ?? null },
        },
      },
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
        },
        editCommands: { lists: { apply }, getSnapshot },
      },
      config: { documentMode: options.mode ?? 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    return { superdoc, apply, getSnapshot };
  }

  it('recognizes bullet-list / numbered-list and reports supported state', async () => {
    const { superdoc } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.has('bullet-list')).toBe(true);
    expect(ui.commands.has('numbered-list')).toBe(true);
    expect(ui.commands.get('bullet-list').getState()).toMatchObject({ enabled: true, supported: true });
    expect(ui.commands.get('numbered-list').getState()).toMatchObject({ enabled: true, supported: true });
  });

  it('routes bullet-list through editCommands.lists.apply with a bullet toggle', async () => {
    const { superdoc, apply } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('bullet-list');
    expect(apply).toHaveBeenCalledWith({ kind: 'bullet', behavior: 'toggle' });
  });

  it('routes numbered-list through editCommands.lists.apply with an ordered toggle', async () => {
    const { superdoc, apply } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('numbered-list');
    expect(apply).toHaveBeenCalledWith({ kind: 'ordered', behavior: 'toggle' });
  });

  it('computes per-alias active state from the edit-command snapshot', async () => {
    const { superdoc } = makeListSuperdoc({ activeSeed: 'ordered' });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('numbered-list').getState().active).toBe(true);
    expect(ui.commands.get('bullet-list').getState().active).toBe(false);
  });

  it('mirrors disabled list state from the edit-command snapshot', async () => {
    const { superdoc } = makeListSuperdoc({ enabled: false });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bullet-list').getState()).toMatchObject({
      supported: true,
      enabled: false,
      disabled: true,
    });
  });

  it('blocks the edit-command list fast path in viewing mode', async () => {
    const { superdoc, apply } = makeListSuperdoc({ mode: 'viewing' });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('bullet-list').getState()).toMatchObject({
      supported: true,
      enabled: false,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });
    expect(await ui.toolbar.execute('bullet-list')).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps the command id list kind authoritative over payload overrides', async () => {
    const { superdoc, apply } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('bullet-list', { kind: 'ordered', preset: 'square' });
    expect(apply).toHaveBeenCalledWith({ kind: 'bullet', behavior: 'toggle', preset: 'square' });
  });

  // SD-3571: the built-in toolbar style dropdowns emit a bare style-key string
  // as the command argument. It must be mapped to the matching ListPresetId, not
  // dropped (which silently applied a default decimal/disc list). Because it is a
  // style pick (not the main kind-toggle button), it routes the variant-aware
  // 'toggleStyle' behavior so it switches an existing list instead of removing it.
  it('routes a numbered style-key string to the matching preset (variant-aware)', async () => {
    const { superdoc, apply } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('numbered-list', 'upper-roman');
    expect(apply).toHaveBeenCalledWith({ kind: 'ordered', behavior: 'toggleStyle', preset: 'upperRoman' });
  });

  it('maps the paren-letter style-keys to the letter-parenthesis presets', async () => {
    const { superdoc, apply } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('numbered-list', 'upper-alpha-paren');
    expect(apply).toHaveBeenCalledWith({
      kind: 'ordered',
      behavior: 'toggleStyle',
      preset: 'upperLetterParenthesis',
    });
  });

  it('routes a bullet style-key string to the matching preset (variant-aware)', async () => {
    const { superdoc, apply } = makeListSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('bullet-list', 'square');
    expect(apply).toHaveBeenCalledWith({ kind: 'bullet', behavior: 'toggleStyle', preset: 'square' });
  });

  // Drift guard: every toolbar style-key must forward a valid ListPresetId. A new
  // button with no mapping (or a renamed preset) fails here instead of silently
  // reverting to the default list style.
  it.each(numberedStyleButtons.map((button) => [button.key]))(
    'forwards numbered style-key "%s" as a valid preset',
    async (styleKey) => {
      const { superdoc, apply } = makeListSuperdoc();
      const ui = createSuperDocUI({ superdoc });
      await ui.toolbar.execute('numbered-list', styleKey);
      const call = apply.mock.calls.at(-1)?.[0];
      expect(call.kind).toBe('ordered');
      expect(call.behavior).toBe('toggleStyle');
      expect(LIST_PRESET_IDS).toContain(call.preset);
    },
  );

  it.each(bulletStyleButtons.map((button) => [button.key]))(
    'forwards bullet style-key "%s" as a valid preset',
    async (styleKey) => {
      const { superdoc, apply } = makeListSuperdoc();
      const ui = createSuperDocUI({ superdoc });
      await ui.toolbar.execute('bullet-list', styleKey);
      const call = apply.mock.calls.at(-1)?.[0];
      expect(call.kind).toBe('bullet');
      expect(call.behavior).toBe('toggleStyle');
      expect(LIST_PRESET_IDS).toContain(call.preset);
    },
  );

  it('reports list commands unsupported when the editor exposes no edit-command path', async () => {
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bullet-list').getState()).toMatchObject({ supported: false, enabled: false });
    expect(await ui.toolbar.execute('bullet-list')).toBe(false);
  });

  function makeHistorySuperdoc(
    options: {
      undoEnabled?: boolean;
      redoEnabled?: boolean;
      undoReason?: string | null;
      redoReason?: string | null;
      mode?: 'editing' | 'viewing';
    } = {},
  ) {
    const undo = vi.fn(() => ({ success: true }));
    const redo = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo, redo },
        },
        editCommands: {
          getSnapshot: vi.fn(() => ({
            commands: {
              'history.undo': {
                shippedStatus: 'supported',
                enabled: options.undoEnabled ?? true,
                reason: options.undoReason ?? null,
              },
              'history.redo': {
                shippedStatus: 'supported',
                enabled: options.redoEnabled ?? false,
                // The real host reports an empty history stack as `reason: null`
                // (`withHistoryEnabledState`), never a ready-made string. This
                // fixture used to inject `'history-empty'` directly, which meant
                // the assertions below passed against a value production could
                // not emit. Default to the host's actual contract.
                reason: options.redoReason ?? null,
              },
            },
          })),
        },
      },
      config: { documentMode: options.mode ?? 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    return { superdoc, undo, redo };
  }

  it('mirrors undo and redo enablement from the lower edit-command snapshot', async () => {
    const { superdoc } = makeHistorySuperdoc({ undoEnabled: true, redoEnabled: false });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('undo').getState()).toMatchObject({
      supported: true,
      enabled: true,
      disabled: false,
    });
    expect(ui.commands.get('redo').getState()).toMatchObject({
      supported: true,
      enabled: false,
      disabled: true,
      reason: 'history-empty',
    });
  });

  // An empty history stack is a temporary state, not a missing capability. The
  // host signals it with `reason: null`; if that fell through to the generic
  // `command-unsupported` fallback it would be indistinguishable from a
  // permanently unavailable command (`table-fix`), and a consumer branching on
  // the documented reason taxonomy would hide undo/redo for the whole session.
  it('distinguishes an empty history stack from a genuinely unsupported command', async () => {
    const { superdoc } = makeHistorySuperdoc({ undoEnabled: false, redoEnabled: false });
    const ui = createSuperDocUI({ superdoc });

    for (const id of ['undo', 'redo']) {
      const state = ui.commands.get(id).getState();
      expect(state.reason, `${id} must report the empty stack, not an unsupported command`).toBe(
        SUPERDOC_UI_REASONS.historyEmpty,
      );
      expect(state.reason).not.toBe(SUPERDOC_UI_REASONS.commandUnsupported);
      // `supported` stays true: the command exists, it just has nothing to undo.
      expect(state.supported, `${id} must remain a supported command`).toBe(true);
      expect(state.enabled).toBe(false);
    }
  });

  // `history-empty` is claimed only for the full empty-stack shape. A history
  // command the host reports as unsupported has a null reason too, and must not
  // borrow the empty-stack explanation on that basis — an application would then
  // wait for a stack that is never coming.
  it('does not claim history-empty for an unsupported history command', async () => {
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo: vi.fn(), redo: vi.fn() },
        },
        editCommands: {
          getSnapshot: vi.fn(() => ({
            commands: {
              // Not shipped on this host, and no named reason.
              'history.undo': { shippedStatus: 'not-shipped', enabled: false, reason: null },
              'history.redo': { shippedStatus: 'supported', enabled: false, reason: null },
            },
          })),
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    const undo = ui.commands.get('undo').getState();
    expect(undo.supported, 'a not-shipped command is not supported').toBe(false);
    expect(undo.reason).not.toBe(SUPERDOC_UI_REASONS.historyEmpty);
    expect(undo.reason).toBe(SUPERDOC_UI_REASONS.commandUnsupported);

    // The supported sibling on the same snapshot still reports the empty stack,
    // so this is the shippedStatus doing the work, not a blanket change.
    expect(ui.commands.get('redo').getState().reason).toBe(SUPERDOC_UI_REASONS.historyEmpty);
  });

  // A pending, unavailable, or failed history read reaches the controller as the
  // same `{ enabled: false, reason: null }` shape as a confirmed empty stack.
  // Calling that "empty" would tell the application the stack is exhausted when
  // it was never read — and after a failed read the adapter caches that null, so
  // the wrong answer would persist. `historyResolved: false` separates them.
  it('reports an unresolved history read as not-ready rather than empty', async () => {
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo: vi.fn(), redo: vi.fn() },
        },
        editCommands: {
          getSnapshot: vi.fn(() => ({
            commands: {
              'history.undo': { shippedStatus: 'supported', enabled: false, reason: null, historyResolved: false },
              'history.redo': { shippedStatus: 'supported', enabled: false, reason: null, historyResolved: true },
            },
          })),
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    const undo = ui.commands.get('undo').getState();
    expect(undo.reason, 'an unread stack is not an empty one').toBe(SUPERDOC_UI_REASONS.notReady);
    expect(undo.reason).not.toBe(SUPERDOC_UI_REASONS.historyEmpty);
    expect(undo.supported).toBe(true);

    // The resolved sibling on the same snapshot still reports the empty stack.
    expect(ui.commands.get('redo').getState().reason).toBe(SUPERDOC_UI_REASONS.historyEmpty);
  });

  // The history read settles on its own schedule and emits no SuperDoc lifecycle
  // event. Without a subscription to the edit-command snapshot, a freshly opened
  // document would hold the pre-read `not-ready` until something unrelated forced
  // a recompute — trading a wrong-but-temporary answer for a stuck one.
  it('recomputes when the edit-command snapshot settles the history read', async () => {
    let resolvedRead = false;
    let notify: (() => void) | null = null;
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo: vi.fn(), redo: vi.fn() },
        },
        editCommands: {
          subscribe: (listener: () => void) => {
            notify = listener;
            return () => {
              notify = null;
            };
          },
          getSnapshot: vi.fn(() => ({
            commands: {
              'history.undo': {
                shippedStatus: 'supported',
                enabled: false,
                reason: null,
                historyResolved: resolvedRead,
              },
              'history.redo': {
                shippedStatus: 'supported',
                enabled: false,
                reason: null,
                historyResolved: resolvedRead,
              },
            },
          })),
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('undo').getState().reason).toBe(SUPERDOC_UI_REASONS.notReady);
    expect(notify, 'the controller must subscribe to the edit-command snapshot').toBeTypeOf('function');

    // The read lands and the adapter republishes; no lifecycle event fires.
    resolvedRead = true;
    notify!();
    // The recompute is coalesced into a microtask so an adapter emission that
    // shares a gesture with a selection change does not recompute twice.
    await Promise.resolve();

    expect(ui.commands.get('undo').getState().reason).toBe(SUPERDOC_UI_REASONS.historyEmpty);
    ui.destroy();
  });

  // Coalescing must not become dropping: many emissions in one tick collapse to
  // a single recompute, but that recompute has to happen.
  // A caret move drives BOTH paths: the adapter republishes from its own
  // selection subscription, and the controller's host-selection subscription
  // recomputes synchronously. Coalescing adapter emissions against each other is
  // not enough — the queued microtask must also notice that a recompute already
  // ran for the same gesture, or typing pays for two full state computations.
  it('does not recompute twice when a caret move drives both paths', async () => {
    let notifyEdit: (() => void) | null = null;
    let notifySelection: ((snapshot: unknown) => void) | null = null;
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo: vi.fn(), redo: vi.fn() },
        },
        editCommands: {
          subscribe: (listener: () => void) => {
            notifyEdit = listener;
            return () => {};
          },
          getSnapshot: () => ({
            commands: {
              'history.undo': { shippedStatus: 'supported', enabled: false, reason: null, historyResolved: true },
              'history.redo': { shippedStatus: 'supported', enabled: false, reason: null, historyResolved: true },
            },
          }),
        },
        host: {
          getHandles: () => ({
            editing: {
              selection: {
                getSnapshot: () => null,
                subscribe: (listener: (snapshot: unknown) => void) => {
                  notifySelection = listener;
                  return () => {};
                },
              },
            },
          }),
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    let recomputes = 0;
    ui.toolbar.subscribe(() => {
      recomputes += 1;
    });
    await Promise.resolve();
    recomputes = 0;

    // The adapter subscribes to selection during host mount, before the
    // controller does, so its republish lands first for a given gesture.
    notifyEdit!();
    notifySelection!(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(recomputes, 'one caret move must drive one recompute, not two').toBe(1);
    ui.destroy();
  });

  it('coalesces repeated edit-command emissions into one recompute', async () => {
    let notify: (() => void) | null = null;
    const getSnapshot = vi.fn(() => ({
      commands: {
        'history.undo': { shippedStatus: 'supported', enabled: false, reason: null, historyResolved: true },
        'history.redo': { shippedStatus: 'supported', enabled: false, reason: null, historyResolved: true },
      },
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo: vi.fn(), redo: vi.fn() },
        },
        editCommands: {
          subscribe: (listener: () => void) => {
            notify = listener;
            return () => {
              notify = null;
            };
          },
          getSnapshot,
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    let recomputes = 0;
    const stop = ui.toolbar.subscribe(() => {
      recomputes += 1;
    });
    // Ignore whatever the subscription itself emits on attach; only the
    // adapter-driven recomputes below are being counted.
    await Promise.resolve();
    recomputes = 0;

    for (let i = 0; i < 5; i += 1) notify!();
    await Promise.resolve();
    await Promise.resolve();

    // Exactly one: `<= 1` would also pass if the recompute were dropped
    // entirely, which is the other half of what coalescing must not do.
    expect(recomputes, 'five emissions in one tick must drive exactly one recompute').toBe(1);

    stop?.();
    ui.destroy();
  });

  // Empty → available → empty. The reason must clear when the command becomes
  // enabled and come back as `history-empty`, never degrading to a different
  // reason on the return trip. Recompute is driven the way the real host drives
  // it — a lifecycle event — not by mutating cached state behind the controller.
  it('clears and restores the history-empty reason as the stack fills and drains', async () => {
    let undoEnabled = false;
    const handlers = new Map<string, () => void>();
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
          history: { undo: vi.fn(() => ({ success: true })), redo: vi.fn(() => ({ success: true })) },
        },
        editCommands: {
          getSnapshot: vi.fn(() => ({
            commands: {
              'history.undo': { shippedStatus: 'supported', enabled: undoEnabled, reason: null },
              'history.redo': { shippedStatus: 'supported', enabled: false, reason: null },
            },
          })),
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    const refresh = () => handlers.get('document-mode-change')?.();

    expect(ui.commands.get('undo').getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.historyEmpty,
    });

    undoEnabled = true;
    refresh();
    const available = ui.commands.get('undo').getState();
    expect(available.enabled).toBe(true);
    // An enabled command never carries a reason.
    expect(available.reason).toBeUndefined();

    undoEnabled = false;
    refresh();
    expect(ui.commands.get('undo').getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.historyEmpty,
    });
  });

  it('keeps read-only gating authoritative over mirrored undo and redo state', async () => {
    const { superdoc } = makeHistorySuperdoc({ undoEnabled: true, redoEnabled: true, mode: 'viewing' });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('undo').getState()).toMatchObject({
      supported: true,
      enabled: false,
      disabled: true,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });
    expect(ui.commands.get('redo').getState()).toMatchObject({
      supported: true,
      enabled: false,
      disabled: true,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });
  });
});

// ---------------------------------------------------------------------------
// Reason taxonomy: built-in command states carry stable public reasons when
// disabled/unsupported and fail closed without mutating the document
// (Workstream 2, SuperDocUIReason).
// ---------------------------------------------------------------------------

describe('public ui — command reason taxonomy', () => {
  const noopEvents = () => ({ on: vi.fn(), off: vi.fn() });

  function makeDocSuperdoc(opts: { doc?: Record<string, unknown> | null; mode?: string } = {}) {
    const hasEditor = opts.doc !== undefined;
    return {
      ...(hasEditor ? { activeEditor: opts.doc === null ? {} : { doc: opts.doc } } : {}),
      config: { documentMode: opts.mode ?? 'editing' },
      ...noopEvents(),
    };
  }

  const baseDoc = (extra: Record<string, unknown> = {}) => ({
    comments: { list: () => ({ items: [] }) },
    trackChanges: { list: () => ({ items: [] }) },
    selection: { current: () => null },
    ...extra,
  });

  // baseDoc variant with a live range selection, so inline-format commands are
  // enabled (they require a resolvable selection target).
  const baseDocSelected = (extra: Record<string, unknown> = {}) => ({
    comments: { list: () => ({ items: [] }) },
    trackChanges: { list: () => ({ items: [] }) },
    selection: { current: () => SELECTION_INFO },
    ...extra,
  });

  function makeFormatPainterSuperdoc(
    opts: {
      sourceRange?: { start: number; end: number };
      targetRange?: { start: number; end: number };
      sourceEmpty?: boolean;
      targetEmpty?: boolean;
      story?: Record<string, unknown>;
      sourceText?: string;
      targetText?: string;
      sourceRuns?: Array<{ text: string; props?: Record<string, unknown> }>;
      targetRuns?: Array<{ text: string; props?: Record<string, unknown> }>;
      sourceParagraphProps?: Record<string, unknown>;
      targetParagraphProps?: Record<string, unknown>;
      queryMatch?: () => unknown;
      readEffectiveInlineUniformity?: () => unknown;
      bold?: () => unknown;
      mode?: 'editing' | 'suggesting';
      applyResult?: () => unknown;
      listStyle?: Record<string, unknown>;
      targetNodeType?: 'paragraph' | 'listItem';
      targetLockMode?: 'contentLocked' | 'sdtContentLocked';
    } = {},
  ) {
    const sourceRange = opts.sourceRange ?? { start: 0, end: 5 };
    const targetRange = opts.targetRange ?? { start: 0, end: 5 };
    const sourceRuns = opts.sourceRuns ?? [
      {
        text: opts.sourceText ?? 'hello',
        props: { bold: true, color: '#D2003F' },
      },
    ];
    const targetRuns = opts.targetRuns ?? [
      {
        text: opts.targetText ?? 'world',
        props: {},
      },
    ];
    const sourceText = sourceRuns.map((run) => run.text).join('');
    const targetText = targetRuns.map((run) => run.text).join('');
    const sourceParagraphProps = opts.sourceParagraphProps ?? {};
    const targetParagraphProps = opts.targetParagraphProps ?? {};
    const sourceEmpty = opts.sourceEmpty ?? false;
    const targetEmpty = opts.targetEmpty ?? false;
    const story = opts.story;
    const sourceSelection = {
      empty: sourceEmpty,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: sourceRange }], ...(story ? { story } : {}) },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: sourceRange.start, ...(story ? { story } : {}) },
        end: { kind: 'text', blockId: 'P1', offset: sourceRange.end, ...(story ? { story } : {}) },
        ...(story ? { story } : {}),
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: sourceEmpty ? '' : sourceText.slice(sourceRange.start, sourceRange.end),
    };
    const targetSelection = {
      empty: targetEmpty,
      target: { kind: 'text', segments: [{ blockId: 'P2', range: targetRange }], ...(story ? { story } : {}) },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P2', offset: targetRange.start, ...(story ? { story } : {}) },
        end: { kind: 'text', blockId: 'P2', offset: targetRange.end, ...(story ? { story } : {}) },
        ...(story ? { story } : {}),
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: targetEmpty ? '' : targetText.slice(targetRange.start, targetRange.end),
    };

    let currentSelection: Record<string, unknown> = sourceSelection;
    const apply = vi.fn(opts.applyResult ?? (() => ({ success: true })));
    const setAlignment = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const applyListStyle = vi.fn(() => ({ success: true }));
    const getNodeForInput = (input: { nodeId: string; story?: unknown }) => ({
      node: {
        kind: 'paragraph',
        paragraph: {
          styleRef: null,
          props: input.nodeId === 'P1' ? sourceParagraphProps : targetParagraphProps,
          inlines: (input.nodeId === 'P1' ? sourceRuns : targetRuns).map((run) => ({
            run: {
              text: run.text,
              props: run.props ?? {},
            },
          })),
        },
      },
      address: {
        nodeType: input.nodeId === 'P2' ? (opts.targetNodeType ?? 'paragraph') : 'paragraph',
        nodeId: input.nodeId,
        ...(input.story ? { story: input.story } : {}),
      },
    });
    const getNodeById = vi.fn((input: { nodeId: string }) => getNodeForInput(input));
    const getNode = vi.fn((input: { nodeId: string; story?: unknown }) => getNodeForInput(input));

    const superdoc = makeDocSuperdoc({
      doc: baseDoc({
        selection: { current: () => currentSelection },
        ...(opts.targetLockMode
          ? {
              contentControls: {
                listInRange: vi.fn((range: { startBlockId?: string }) => ({
                  items: range.startBlockId === 'P2' ? [{ id: 'locked-target', lockMode: opts.targetLockMode }] : [],
                })),
              },
            }
          : {}),
        getNode,
        getNodeById,
        ...(opts.queryMatch ? { query: { match: opts.queryMatch } } : {}),
        format: {
          apply,
          ...(opts.bold ? { bold: opts.bold } : {}),
          paragraph: { setAlignment, setIndentation },
          ...(opts.readEffectiveInlineUniformity
            ? { readEffectiveInlineUniformity: opts.readEffectiveInlineUniformity }
            : {}),
        },
        ...(opts.listStyle
          ? {
              lists: {
                getState: vi.fn(() => ({ success: true, isListItem: true })),
                getStyle: vi.fn(() => opts.listStyle),
                applyStyle: applyListStyle,
              },
            }
          : {}),
      }),
      ...(opts.mode ? { mode: opts.mode } : {}),
    });

    return {
      superdoc,
      apply,
      setAlignment,
      setIndentation,
      applyListStyle,
      setSelection(selection: Record<string, unknown>) {
        currentSelection = selection;
      },
      targetSelection,
    };
  }

  it('enabled built-in commands carry no reason (reason is disabled-only)', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDocSelected({ format: { bold: vi.fn() } }) });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState();
    expect(state).toMatchObject({ enabled: true, supported: true });
    expect(state.reason).toBeUndefined();
  });

  it('unknown command ids report command-unsupported and fail closed on execute', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc() });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('totally-made-up').getState();
    expect(state).toMatchObject({ enabled: false, supported: false, source: 'unsupported' });
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.commandUnsupported);
    // Fail closed: execute returns false and routes nothing.
    expect(await ui.commands.execute('totally-made-up')).toBe(false);
  });

  it('reports not-ready when no active editor is mounted', async () => {
    const superdoc = makeDocSuperdoc({}); // no activeEditor
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState();
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.notReady);
  });

  it('reports document-api-unavailable when the editor is mounted but has no doc facade', async () => {
    const superdoc = makeDocSuperdoc({ doc: null }); // editor present, no doc
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState();
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.documentApiUnavailable);
  });

  it('reports operation-unavailable when the doc facade lacks the backing operation', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc() }); // no format namespace
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState();
    expect(state.enabled).toBe(false);
    expect(state.supported).toBe(false);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.operationUnavailable);
  });

  it('reports document-readonly for mutating commands in viewing mode', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc({ format: { bold: vi.fn() } }), mode: 'viewing' });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.bold).getState();
    expect(state.enabled).toBe(false);
    // Still supported by v2 — just blocked by read-only state.
    expect(state.supported).toBe(true);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.documentReadonly);
  });

  it('does not route tracked-change decisions in viewing mode', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = makeDocSuperdoc({
      doc: baseDoc({
        selection: {
          current: () => ({
            empty: false,
            activeMarks: [],
            activeCommentIds: [],
            activeChangeIds: ['tc-1'],
            text: '',
          }),
        },
        trackChanges: { list: () => ({ items: [{ id: 'tc-1', type: 'insert' }] }), decide },
      }),
      mode: 'viewing',
    });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.acceptChange).getState();
    expect(state.enabled).toBe(false);
    expect(state.supported).toBe(true);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.documentReadonly);
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toBe(false);
    expect(ui.trackChanges.accept('tc-1')).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('does not route tracked-change decisions when comments are read-only in editing mode', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = makeDocSuperdoc({
      doc: baseDoc({
        selection: {
          current: () => ({
            empty: false,
            activeMarks: [],
            activeCommentIds: [],
            activeChangeIds: ['tc-1'],
            text: '',
          }),
        },
        trackChanges: { list: () => ({ items: [{ id: 'tc-1', type: 'insert' }] }), decide },
      }),
      mode: 'editing',
    }) as any;
    superdoc.config.modules = { comments: { readOnly: true } };

    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('track-changes-accept-selection').getState();
    expect(state.enabled).toBe(false);
    expect(state.supported).toBe(true);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.documentReadonly);
    expect(await ui.toolbar.execute('track-changes-accept-selection')).toBe(false);
    expect(ui.trackChanges.accept('tc-1')).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('disables toolbar accept/reject when permissionResolver denies the selected tracked change (SD-3845)', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const canPerformPermission = vi.fn(({ permission }) => {
      if (
        permission === 'RESOLVE_OWN' ||
        permission === 'RESOLVE_OTHER' ||
        permission === 'REJECT_OWN' ||
        permission === 'REJECT_OTHER'
      ) {
        return false;
      }
      return true;
    });
    const superdoc = {
      ...makeDocSuperdoc({
        doc: baseDoc({
          selection: {
            current: () => ({
              empty: false,
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: '',
            }),
          },
          trackChanges: { list: () => ({ items: [{ id: 'tc-1', type: 'insert', author: 'Alice' }] }), decide },
        }),
        mode: 'editing',
      }),
      config: { documentMode: 'editing', user: { name: 'Alice' } },
      canPerformPermission,
    };
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('track-changes-accept-selection').getState();
    expect(state.enabled).toBe(false);
    expect(state.supported).toBe(true);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.permissionDenied);
    expect(canPerformPermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'RESOLVE_OWN', trackedChange: expect.objectContaining({ id: 'tc-1' }) }),
    );
    expect(await ui.toolbar.execute('track-changes-accept-selection')).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('keeps toolbar accept enabled for another user tracked change when OTHER is allowed (SD-3845)', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const canPerformPermission = vi.fn(
      ({ permission }) => permission === 'RESOLVE_OTHER' || permission === 'REJECT_OTHER',
    );
    const superdoc = {
      ...makeDocSuperdoc({
        doc: baseDoc({
          selection: {
            current: () => ({
              empty: false,
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: '',
            }),
          },
          trackChanges: {
            list: () => ({
              items: [{ id: 'tc-1', type: 'insert', author: 'Alice', authorEmail: 'alice@mikelegal.test' }],
            }),
            decide,
          },
        }),
        mode: 'editing',
      }),
      config: {
        documentMode: 'editing',
        user: { id: 'bob-id', email: 'bob@mikelegal.test', name: 'Bob' },
      },
      canPerformPermission,
    };
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('track-changes-accept-selection').getState();
    expect(state.enabled).toBe(true);
    expect(canPerformPermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'RESOLVE_OTHER', trackedChange: expect.objectContaining({ id: 'tc-1' }) }),
    );
    expect(await ui.toolbar.execute('track-changes-accept-selection')).toEqual({ success: true });
    expect(decide).toHaveBeenCalled();
  });

  it('blocks a partial-selection range decide when permissionResolver denies the active tracked change (SD-3845)', async () => {
    const story = { kind: 'story', storyType: 'body' } as const;
    const decide = vi.fn(() => ({ success: true }));
    const canPerformPermission = vi.fn(() => false);
    const superdoc = {
      ...makeDocSuperdoc({
        doc: baseDoc({
          selection: {
            current: () => ({
              empty: false,
              target: {
                kind: 'text',
                story,
                segments: [{ blockId: 'P1', range: { start: 18, end: 18 } }],
              },
              selectionTarget: {
                kind: 'selection',
                story,
                coordinateSpace: 'tracked',
                start: { kind: 'text', blockId: 'P1', offset: 20, story },
                end: { kind: 'text', blockId: 'P1', offset: 24, story },
              },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: 'move',
            }),
          },
          trackChanges: {
            list: () => ({ items: [{ id: 'tc-1', type: 'delete', grouping: 'standalone', author: 'Alice' }] }),
            decide,
          },
        }),
        mode: 'editing',
      }),
      config: { documentMode: 'editing', user: { name: 'Alice' } },
      canPerformPermission,
    };
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('track-changes-accept-selection').getState();
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.permissionDenied);
    expect(await ui.toolbar.execute('track-changes-accept-selection')).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('reports table cell-context commands as a named context-facade gap when no table context resolves', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc() });
    const ui = createSuperDocUI({ superdoc });
    // The table cell-context family is a real v2 operation routed through the
    // shared table-context facade. With no host table-context surface the
    // command is supported-but-disabled, failing closed with the precise, named
    // `table-context-unavailable` reason — NOT the generic `command-deferred`.
    const state = ui.commands.get('table-delete-row').getState();
    expect(state).toMatchObject({ enabled: false, supported: true, source: 'builtin' });
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.tableContextUnavailable);
    expect(ui.commands.has('table-delete-row')).toBe(true);
    expect(await ui.commands.execute('table-delete-row')).toBe(false);
    // The catalog no longer produces the generic command-deferred reason for any id.
    for (const id of ALL_BUILT_IN_COMMAND_IDS) {
      expect(ui.commands.get(id).getState().reason).not.toBe(SUPERDOC_UI_REASONS.commandDeferred);
    }
  });

  it('copy-format is enabled in editing mode and arms the painter on execute', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc() });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('copy-format').getState();
    expect(state).toMatchObject({ enabled: true, supported: true, active: false, source: 'builtin' });
    // Executing arms the painter — the command settles as true.
    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);
  });

  it('copy-format is disabled in viewing mode', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc(), mode: 'viewing' });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('copy-format').getState();

    expect(state).toMatchObject({ enabled: false, supported: true, active: false, source: 'builtin' });
  });

  it('copy-format cancels on a later re-execute after the double-click window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T10:00:00.000Z'));

    const superdoc = makeDocSuperdoc({ doc: baseDoc() });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);

    vi.setSystemTime(new Date('2026-07-07T10:00:00.600Z'));

    expect(await ui.commands.executeAsync('copy-format')).toBe(false);
    expect(ui.commands.get('copy-format').getState().active).toBe(false);
  });

  it('copy-format upgrades to persistent mode on double-click within 500ms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T10:00:00.000Z'));

    const superdoc = makeDocSuperdoc({ doc: baseDoc() });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);

    vi.setSystemTime(new Date('2026-07-07T10:00:00.300Z'));

    expect(await ui.commands.execute('copy-format')).toBe(true);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);
    expect(ui.toolbar.getSnapshot().copyFormatActive).toBe(true);
  });

  it('copy-format keeps the newest state when double-click captures overlap', async () => {
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const modes: string[] = [];
    ui.formatPainter.onModeChange((mode) => modes.push(mode));

    const firstClick = ui.commands.executeAsync('copy-format');
    const secondClick = ui.commands.executeAsync('copy-format');
    expect(await Promise.all([firstClick, secondClick])).toEqual([true, true]);
    expect(modes).toContain('persistent');

    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);
  });

  it('copy-format apply exits armed mode after pointer-up on a new selection', async () => {
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc();
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);

    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: { bold: true, color: '#D2003F' },
      },
      { offsetSpace: 'selection' },
    );
    await vi.waitFor(() => {
      expect(ui.commands.get('copy-format').getState().active).toBe(false);
      expect(ui.toolbar.getSnapshot().copyFormatActive).toBe(false);
    });
  });

  it('copy-format applies inline formatting as one tracked selection mutation in suggesting mode', async () => {
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({ mode: 'suggesting' });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: { bold: true, color: '#D2003F' },
      },
      { changeMode: 'tracked', offsetSpace: 'selection' },
    );
  });

  it('copy-format stops before paragraph mutations and remains armed when inline apply fails', async () => {
    const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceParagraphProps: { alignment: 'center' },
      applyResult: () => ({ success: false, failure: { code: 'PRECONDITION_FAILED', message: 'stale target' } }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(setAlignment).not.toHaveBeenCalled();
    expect(ui.commands.get('copy-format').getState().active).toBe(true);
  });

  it.each(['contentLocked', 'sdtContentLocked'] as const)(
    'copy-format does not mutate a %s target and remains armed',
    async (targetLockMode) => {
      const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
        sourceParagraphProps: { alignment: 'center' },
        targetLockMode,
      });
      const ui = createSuperDocUI({ superdoc });

      expect(await ui.commands.executeAsync('copy-format')).toBe(true);
      setSelection(targetSelection);
      ui.formatPainter.notifyPointerUp();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(apply).not.toHaveBeenCalled();
      expect(setAlignment).not.toHaveBeenCalled();
      expect(ui.commands.get('copy-format').getState().active).toBe(true);
    },
  );

  it('copy-format awaits fresh inline values when the reactive projection is still pending', async () => {
    const pendingProjection = new Promise<never>(() => {});
    const queryMatch = vi
      .fn()
      .mockReturnValueOnce(pendingProjection)
      .mockResolvedValue({
        items: [
          {
            address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
            blocks: [
              {
                blockId: 'P1',
                range: { start: 0, end: 5 },
                runs: [
                  {
                    range: { start: 0, end: 5 },
                    styles: { color: '#D2003F' },
                  },
                ],
              },
            ],
          },
        ],
      });
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceRuns: [{ text: 'hello', props: { bold: true } }],
      queryMatch,
    });
    const ui = createSuperDocUI({ superdoc });

    const readsBeforeCapture = queryMatch.mock.calls.length;
    expect(readsBeforeCapture).toBeGreaterThan(0);
    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(queryMatch.mock.calls.length).toBeGreaterThan(readsBeforeCapture);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: { bold: true, color: '#D2003F' },
      },
      { offsetSpace: 'selection' },
    );
  });

  it('copy-format awaits uncached effective font and size before publishing its snapshot', async () => {
    let resolveUniformity: (value: unknown) => void = () => undefined;
    const effectiveUniformity = new Promise((resolve) => {
      resolveUniformity = resolve;
    });
    const readEffectiveInlineUniformity = vi.fn(() => effectiveUniformity);
    const queryMatch = vi.fn(() => Promise.resolve({ items: [] }));
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceRuns: [{ text: 'hello', props: { bold: true } }],
      queryMatch,
      readEffectiveInlineUniformity,
    });
    const ui = createSuperDocUI({ superdoc });

    let captureSettled = false;
    const capture = ui.commands.executeAsync('copy-format').then((value) => {
      captureSettled = true;
      return value;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(captureSettled).toBe(false);

    resolveUniformity({
      success: true,
      values: {
        fontFamily: { state: 'uniform', value: 'Cambria' },
        fontSize: { state: 'uniform', value: '14' },
      },
    });
    await expect(capture).resolves.toBe(true);
    expect(readEffectiveInlineUniformity).toHaveBeenCalled();
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: { bold: true, fontFamily: 'Cambria', fontSize: 14 },
      },
      { offsetSpace: 'selection' },
    );
  });

  it('copy-format apply stays active in persistent mode after pointer-up on a new selection', async () => {
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc();
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    expect(ui.commands.get('copy-format').getState().active).toBe(true);

    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: { bold: true, color: '#D2003F' },
      },
      { offsetSpace: 'selection' },
    );
    expect(ui.commands.get('copy-format').getState().active).toBe(true);
    expect(ui.toolbar.getSnapshot().copyFormatActive).toBe(true);
  });

  it('copy-format waits for an in-flight inline toggle before capturing source formatting (SD-3788)', async () => {
    vi.useFakeTimers();
    const sourceRuns: Array<{ text: string; props: Record<string, unknown> }> = [{ text: 'hello', props: {} }];
    let resolveBold = () => undefined;
    const bold = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveBold = () => {
            resolve({ success: true });
          };
        }),
    );
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({ sourceRuns, bold });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.execute('bold')).toBe(true);
    const capture = ui.commands.executeAsync('copy-format');
    setTimeout(resolveBold, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await capture).toBe(true);

    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledWith(
      { target: targetSelection.selectionTarget, inline: { bold: true } },
      { offsetSpace: 'selection' },
    );
  });

  it('copy-format discards optimistic marks when the in-flight inline toggle fails (SD-3788)', async () => {
    const sourceRuns: Array<{ text: string; props: Record<string, unknown> }> = [
      { text: 'hello', props: { color: '#D2003F' } },
    ];
    let resolveBold: ((receipt: { success: false }) => void) | null = null;
    const bold = vi.fn(
      () =>
        new Promise<{ success: false }>((resolve) => {
          resolveBold = resolve;
        }),
    );
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({ sourceRuns, bold });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.execute('bold')).toBe(true);
    const capture = ui.commands.executeAsync('copy-format');
    resolveBold?.({ success: false });

    await expect(capture).resolves.toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledWith(
      { target: targetSelection.selectionTarget, inline: { color: '#D2003F' } },
      { offsetSpace: 'selection' },
    );
  });

  it('copy-format transfers paragraph formatting even for partial source selection (Word behavior)', async () => {
    const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceRange: { start: 0, end: 4 },
      sourceParagraphProps: { alignment: 'center' },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(setAlignment).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
        alignment: 'center',
      });
    });
  });

  it('copy-format still applies paragraph formatting when the destination lacks an inline selection target', async () => {
    const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceParagraphProps: { alignment: 'center' },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    const { selectionTarget: _selectionTarget, ...paragraphOnlyTarget } = targetSelection;
    setSelection(paragraphOnlyTarget);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(setAlignment).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
        alignment: 'center',
      });
    });
  });

  it('copy-format converts paragraph indentation points to twips before apply', async () => {
    const { superdoc, setIndentation, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceParagraphProps: {
        indent: { left: 36, right: 12, firstLine: 18 },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(setIndentation).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
        left: 720,
        right: 240,
        firstLine: 360,
      });
    });
  });

  it('copy-format keeps header/footer story on paragraph apply targets', async () => {
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' };
    const { superdoc, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      story: headerStory,
      sourceParagraphProps: { alignment: 'center' },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(setAlignment).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2', story: headerStory },
        alignment: 'center',
      });
    });
  });

  it('copy-format keeps header/footer story on list style targets', async () => {
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' };
    const listStyle = { version: 1, levels: [{ level: 0, numFmt: 'bullet' }] };
    const { superdoc, applyListStyle, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      story: headerStory,
      sourceParagraphProps: { numbering: { numId: 1, level: 0 } },
      listStyle,
      targetNodeType: 'listItem',
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();

    await vi.waitFor(() => {
      expect(applyListStyle).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'listItem', nodeId: 'P2', story: headerStory },
        style: listStyle,
      });
    });
  });

  it('copy-format captures inline and paragraph from caret source selection', async () => {
    const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceRange: { start: 2, end: 2 },
      sourceEmpty: true,
      sourceParagraphProps: { alignment: 'center' },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Inline props from the run at caret offset are applied to the text target
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ inline: expect.objectContaining({ bold: true }) }), {
      offsetSpace: 'selection',
    });
    // Paragraph formatting is also captured and applied
    await vi.waitFor(() => {
      expect(setAlignment).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
        alignment: 'center',
      });
    });
  });

  it('copy-format does not apply inline formatting to caret target, but applies paragraph', async () => {
    vi.useFakeTimers();
    const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceParagraphProps: { alignment: 'center' },
      targetRange: { start: 2, end: 2 },
      targetEmpty: true,
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    // Advance past all 8 polling attempts (each waits 16ms after attempt 0)
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    // Inline NOT applied — caret target has empty === true
    expect(apply).not.toHaveBeenCalled();
    // Paragraph IS applied via the caret fallback path
    await vi.waitFor(() => {
      expect(setAlignment).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
        alignment: 'center',
      });
    });
  });

  it('copy-format transfers paragraph formatting when the source and target selections cover full paragraphs', async () => {
    const { superdoc, apply, setAlignment, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceParagraphProps: { alignment: 'center' },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(setAlignment).toHaveBeenCalledWith({
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
        alignment: 'center',
      });
    });
  });

  it('copy-format omits mixed inline props from the captured source selection', async () => {
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceRuns: [
        { text: 'he', props: { bold: true, color: '#D2003F' } },
        { text: 'llo', props: { bold: true, color: '#00FF00' } },
      ],
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: { bold: true },
      },
      { offsetSpace: 'selection' },
    );
  });

  it('copy-format normalizes object-shaped SDRunProps into InlineRunPatch before apply', async () => {
    const { superdoc, apply, setSelection, targetSelection } = makeFormatPainterSuperdoc({
      sourceRuns: [
        {
          text: 'hello',
          props: {
            color: { model: 'rgb', value: 'D2003F' },
            underline: { style: 'double', color: { model: 'theme', theme: 'accent1' } },
            border: {
              style: 'single',
              width: 4,
              space: 1,
              color: { model: 'auto' },
            },
            fonts: {
              ascii: 'Calibri',
              hAnsi: 'Calibri',
              eastAsiaTheme: 'majorEastAsia',
            },
            fitTextWidth: 72,
          },
        },
      ],
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    setSelection(targetSelection);
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: {
          color: 'D2003F',
          underline: { style: 'double', themeColor: 'accent1' },
          border: { val: 'single', sz: 4, space: 1, color: 'auto' },
          rFonts: {
            ascii: 'Calibri',
            hAnsi: 'Calibri',
            eastAsia: undefined,
            eastAsiaTheme: 'majorEastAsia',
            cs: undefined,
            asciiTheme: undefined,
            hAnsiTheme: undefined,
            csTheme: undefined,
            hint: undefined,
          },
          fitText: { val: 72 },
        },
      },
      { offsetSpace: 'selection' },
    );
  });

  it('copy-format captures projected inline value styles from the source selection', async () => {
    const sourceSelection = {
      empty: false,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P1', offset: 5 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'hello',
    };
    const targetSelection = {
      empty: false,
      target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 0, end: 5 } }] },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P2', offset: 0 },
        end: { kind: 'text', blockId: 'P2', offset: 5 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'world',
    };

    let currentSelection = sourceSelection;
    const apply = vi.fn(() => ({ success: true }));
    const superdoc = makeDocSuperdoc({
      doc: baseDoc({
        selection: { current: () => currentSelection },
        getNodeById: (input: { nodeId: string }) => ({
          node: {
            kind: 'paragraph',
            paragraph: {
              styleRef: null,
              props: {},
              inlines: [
                {
                  run: {
                    text: input.nodeId === 'P1' ? 'hello' : 'world',
                    props: {},
                  },
                },
              ],
            },
          },
          address: { nodeType: 'paragraph', nodeId: input.nodeId },
        }),
        query: {
          match: () => ({
            items: [
              {
                address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
                blocks: [
                  {
                    blockId: 'P1',
                    range: { start: 0, end: 5 },
                    runs: [
                      {
                        range: { start: 0, end: 5 },
                        styles: {
                          fontFamily: 'Courier New',
                          fontSizePt: 18,
                          color: '#D2003F',
                          highlight: '#ECCF35',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        },
        format: { apply },
      }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.commands.executeAsync('copy-format')).toBe(true);
    currentSelection = targetSelection;
    ui.formatPainter.notifyPointerUp();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {
        target: targetSelection.selectionTarget,
        inline: expect.objectContaining({
          fontFamily: 'Courier New',
          fontSize: 18,
          color: '#D2003F',
          highlight: '#ECCF35',
        }),
      },
      { offsetSpace: 'selection' },
    );
  });

  it('reports selection-required for a single tracked-change decision with no active change', async () => {
    const superdoc = makeDocSuperdoc({
      doc: baseDoc({ trackChanges: { list: () => ({ items: [] }), decide: vi.fn() } }),
    });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get(BUILT_IN_COMMAND_IDS.acceptChange).getState();
    expect(state.supported).toBe(true);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe(SUPERDOC_UI_REASONS.selectionRequired);
  });

  it('reports bulk-decisions-disabled when the host does not expose bulk decisions', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc() }); // trackChanges has only list()
    const ui = createSuperDocUI({ superdoc });
    const bulk = ui.commands.get(BUILT_IN_COMMAND_IDS.acceptAllChanges).getState();
    expect(bulk.enabled).toBe(false);
    expect(bulk.supported).toBe(false);
    expect(bulk.reason).toBe(SUPERDOC_UI_REASONS.bulkDecisionsDisabled);
    // A single decision without a route reports operation-unavailable, not bulk.
    const single = ui.commands.get(BUILT_IN_COMMAND_IDS.acceptChange).getState();
    expect(single.reason).toBe(SUPERDOC_UI_REASONS.operationUnavailable);
  });

  it('disabled commands appear in the toolbar snapshot with their reason (not opaque)', async () => {
    const superdoc = makeDocSuperdoc({ doc: baseDoc(), mode: 'viewing' });
    const ui = createSuperDocUI({ superdoc });
    const snapshot = ui.toolbar.getSnapshot();
    const bold = snapshot.commands[BUILT_IN_COMMAND_IDS.bold];
    expect(bold).toBeDefined();
    expect(bold.disabled).toBe(true);
    expect(typeof bold.reason).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Plan A controller workflow parity (Workstreams 3-8): comments, content
// controls, selection/viewport/navigation, custom commands, document control,
// and track changes have real public-surface behavior or explicit reasoned
// fail-closed behavior — no silent no-ops.
// ---------------------------------------------------------------------------

const WF_TARGET = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] } as const;
const WF_SELECTION_TARGET = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'P1', offset: 0 },
  end: { kind: 'text', blockId: 'P3', offset: 5 },
} as const;

function makeWorkflowSuperdoc(
  opts: {
    comments?: Record<string, unknown>;
    trackChanges?: Record<string, unknown>;
    contentControls?: Record<string, unknown>;
    selectionInfo?: unknown;
    host?: Record<string, unknown> | null;
    v2TrackedChanges?: Record<string, unknown> | null;
    mode?: string;
    noEditor?: boolean;
    noDoc?: boolean;
  } = {},
) {
  const selectionCurrent = vi.fn((_input?: { includeText?: boolean }) =>
    'selectionInfo' in opts
      ? opts.selectionInfo
      : {
          empty: false,
          target: WF_TARGET,
          selectionTarget: WF_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'hello',
        },
  );
  const doc = {
    comments: { list: () => ({ items: [] }), ...(opts.comments ?? {}) },
    trackChanges: { list: () => ({ items: [] }), ...(opts.trackChanges ?? {}) },
    contentControls: { list: () => ({ items: [] }), ...(opts.contentControls ?? {}) },
    selection: { current: selectionCurrent },
  };
  const activeEditor = opts.noEditor
    ? undefined
    : {
        ...(opts.noDoc ? {} : { doc }),
        ...(opts.host ? { host: opts.host } : {}),
        ...(opts.v2TrackedChanges ? { v2TrackedChanges: opts.v2TrackedChanges } : {}),
      };
  const superdoc = {
    ...(activeEditor ? { activeEditor } : {}),
    config: { documentMode: opts.mode ?? 'editing' },
    on: vi.fn(),
    off: vi.fn(),
  };
  return { superdoc, selectionCurrent };
}

describe('public ui — comments workflow parity (row 737)', () => {
  it('createFromSelection anchors a comment to the live selection target', async () => {
    const create = vi.fn(() => ({ success: true, id: 'c-new' }));
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [] }), create } });
    const ui = createSuperDocUI({ superdoc });
    const receipt = ui.comments.createFromSelection({ text: 'Check this' });
    expect(receipt).toMatchObject({ success: true });
    expect(create).toHaveBeenCalledWith({ target: WF_TARGET, text: 'Check this' });
  });

  it('createFromSelection refreshes the comments snapshot without relying on host events', async () => {
    const items: Array<{ id: string }> = [];
    const create = vi.fn(({ text }: { text: string }) => {
      items.push({ id: `c-${items.length + 1}` });
      return { success: true, text };
    });
    const { superdoc } = makeWorkflowSuperdoc({
      comments: {
        list: () => ({ items: items.slice() }),
        create,
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.comments.getSnapshot().total).toBe(0);
    expect(ui.comments.createFromSelection({ text: 'Check this' })).toMatchObject({ success: true });
    expect(ui.comments.getSnapshot().total).toBe(1);
  });

  it('domain handles emit immediately on observe() and subscribe() — main-compatible first emit', () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ id: 'c-1' }] }) },
      trackChanges: { list: () => ({ items: [] }) },
    });
    const ui = createSuperDocUI({ superdoc });

    // observe(): value-direct, fires immediately with the current snapshot.
    const observed: unknown[] = [];
    const offObserve = ui.comments.observe((snapshot) => observed.push(snapshot));
    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual(ui.comments.getSnapshot());
    offObserve();

    // subscribe(): { snapshot }-shaped (main contract), also fires immediately.
    const subscribed: Array<{ snapshot: unknown }> = [];
    const offSubscribe = ui.comments.subscribe((event) => subscribed.push(event));
    expect(subscribed).toHaveLength(1);
    expect(subscribed[0]).toEqual({ snapshot: ui.comments.getSnapshot() });
    offSubscribe();

    // Same first-emit shape on another domain handle (consistency across elements).
    const tcObserved: unknown[] = [];
    ui.trackChanges.observe((snapshot) => tcObserved.push(snapshot));
    expect(tcObserved).toHaveLength(1);
    expect(tcObserved[0]).toEqual(ui.trackChanges.getSnapshot());

    ui.destroy();
  });

  it('isolates a throwing observer so a sibling on the same handle still receives a CHANGE emit', () => {
    const items: Array<{ id: string }> = [];
    const create = vi.fn(({ text }: { text: string }) => {
      items.push({ id: `c-${items.length + 1}` });
      return { success: true, text };
    });
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: items.slice() }), create },
    });
    const ui = createSuperDocUI({ superdoc });

    // Attach the throwing observer first: it runs before the good observer in
    // the raw substrate notify loop, so without per-listener isolation on the
    // change path its throw would stop the sibling from being notified.
    const offThrowing = ui.comments.observe(() => {
      throw new Error('observer boom');
    });
    const good: unknown[] = [];
    const offGood = ui.comments.observe((snapshot) => good.push(snapshot));
    const beforeChange = good.length;

    // Drive a document mutation → recompute → CHANGE emit on the comments slice.
    expect(ui.comments.createFromSelection({ text: 'Check this' })).toMatchObject({ success: true });

    expect(good.length).toBeGreaterThan(beforeChange);
    expect(good[good.length - 1]).toEqual(ui.comments.getSnapshot());

    offThrowing();
    offGood();
    ui.destroy();
  });

  it('does not miss a synchronous recompute triggered by the first observe() listener', () => {
    // observe() subscribes BEFORE its immediate emit, so an observer whose
    // first callback synchronously triggers a recompute (here via setActive)
    // is already registered when that change emit fires and does not miss it.
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1' }, { commentId: 'c-2' }] }) },
    });
    const ui = createSuperDocUI({ superdoc });

    const activeIds: Array<string | null> = [];
    let triggered = false;
    const off = ui.comments.observe((snapshot) => {
      activeIds.push(snapshot.activeId);
      if (!triggered) {
        triggered = true;
        ui.comments.setActive('c-2');
      }
    });

    // Immediate emit (activeId null) + the change emit from the synchronous
    // setActive recompute (activeId 'c-2'). An emit-first ordering would lose
    // the second emit because the observer would not yet be subscribed.
    expect(activeIds).toEqual([null, 'c-2']);
    expect(ui.comments.getSnapshot().activeId).toBe('c-2');

    off();
    ui.destroy();
  });

  it('exposes get() as a retained alias of getSnapshot() on domain handles', () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ id: 'c-1' }] }) },
      trackChanges: { list: () => ({ items: [] }) },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.comments.get()).toEqual(ui.comments.getSnapshot());
    expect(ui.trackChanges.get()).toEqual(ui.trackChanges.getSnapshot());

    ui.destroy();
  });

  it('createFromSelection fails closed with NO_SELECTION when the selection is empty', async () => {
    const create = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [] }), create },
      selectionInfo: {
        empty: true,
        target: null,
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const receipt = ui.comments.createFromSelection({ text: 'Check this' }) as {
      success: boolean;
      failure?: { code?: string };
    };
    expect(receipt.success).toBe(false);
    expect(receipt.failure?.code).toBe('NO_SELECTION');
    expect(create).not.toHaveBeenCalled();
  });

  it('createFromCapture fails closed with NO_SELECTION when the capture carries no target', async () => {
    // The same mistake as an empty selection — the composer submitted with
    // nothing captured — has to read the same way to the consumer. Before this
    // guard the null target reached `comments.create` and came back as the
    // Document API's INVALID_TARGET, so the two creation paths disagreed about
    // a single user error.
    const create = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [] }), create } });
    const ui = createSuperDocUI({ superdoc });

    for (const capture of [{ target: null }, { selectionTarget: null }, { target: null, selectionTarget: null }]) {
      const receipt = ui.comments.createFromCapture(capture as never, { text: 'Check this' }) as {
        success: boolean;
        failure?: { code?: string };
      };
      expect(receipt.success).toBe(false);
      expect(receipt.failure?.code).toBe('NO_SELECTION');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('createFromCapture still reaches the Document API when the capture has a target', async () => {
    // The guard above must reject only the empty capture. A present target —
    // including one carried on `selectionTarget` rather than `target` — keeps
    // going, and a target that no longer resolves stays the Document API's
    // failure to name rather than being relabelled NO_SELECTION here.
    const create = vi.fn(() => ({ success: true, id: 'c-1' }));
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [] }), create } });
    const ui = createSuperDocUI({ superdoc });

    const target = { type: 'text' } as never;
    expect(ui.comments.createFromCapture({ target }, { text: 'Check this' })).toMatchObject({ success: true });
    expect(create).toHaveBeenCalledWith({ target, text: 'Check this' });

    create.mockClear();
    ui.comments.createFromCapture({ selectionTarget: target }, { text: 'Check this' });
    expect(create).toHaveBeenCalledWith({ target, text: 'Check this' });
  });

  it('createFromCapture returns a receipt rather than throwing on a hostile capture', async () => {
    // Every method on this handle is documented as failing closed, so a capture
    // whose property access throws — a revoked Proxy, a getter that raises —
    // has to come back as a receipt. Reading the target outside `safeCall` let
    // that exception escape into consumer code.
    const create = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [] }), create } });
    const ui = createSuperDocUI({ superdoc });

    const hostile = {
      get target() {
        throw new Error('revoked capture');
      },
    };
    const receipt = ui.comments.createFromCapture(hostile as never, { text: 'Check this' }) as {
      success: boolean;
    };
    expect(receipt.success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('delete routes through the Document API comments.delete', async () => {
    const del = vi.fn(() => ({ success: true, removed: ['c-1'] }));
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [{ id: 'c-1' }] }), delete: del } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.comments.delete('c-1')).toMatchObject({ success: true });
    expect(del).toHaveBeenCalledWith({ commentId: 'c-1' });
  });

  it('reply uses the canonical parentCommentId input shape when reply is exposed', async () => {
    const reply = vi.fn(() => ({ success: true, id: 'c-reply' }));
    const create = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1' }] }), create, reply },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.comments.reply('c-1', { text: 'Looks good.' })).toMatchObject({ success: true });
    expect(reply).toHaveBeenCalledWith({ parentCommentId: 'c-1', text: 'Looks good.' });
    expect(create).not.toHaveBeenCalled();
  });

  it('edit routes the new body through the Document API comments.patch', async () => {
    const patch = vi.fn(() => ({ success: true }));
    const create = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1' }] }), create, patch },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.comments.edit('c-1', { text: 'Corrected wording.' })).toMatchObject({ success: true });
    expect(patch).toHaveBeenCalledWith({ commentId: 'c-1', text: 'Corrected wording.' });
    // An edit is a body change, never a new comment.
    expect(create).not.toHaveBeenCalled();
  });

  it('edit fails closed when comments.patch is unavailable', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [{ id: 'c-1' }] }) } });
    const ui = createSuperDocUI({ superdoc });
    const receipt = ui.comments.edit('c-1', { text: 'x' }) as { success: boolean };
    expect(receipt.success).toBe(false);
  });

  it('delete fails closed when the operation is unavailable', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ comments: { list: () => ({ items: [{ id: 'c-1' }] }) } });
    const ui = createSuperDocUI({ superdoc });
    const receipt = ui.comments.delete('c-1') as { success: boolean };
    expect(receipt.success).toBe(false);
  });

  it('setActive drives the comments slice activeId independently of the selection', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1' }, { commentId: 'c-2' }] }) },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.comments.getSnapshot().activeId).toBeNull();
    expect(ui.comments.setActive('c-2')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-2');
    // Idempotent re-activation of the already-active id is accepted.
    expect(ui.comments.setActive('c-2')).toBe(true);
    // A request that resolves to no current comment fails closed without
    // touching the existing focus, matching main: resolution runs before
    // any state changes, so a bad id can't clobber a valid prior activation.
    expect(ui.comments.setActive('does-not-exist')).toBe(false);
    expect(ui.comments.getSnapshot().activeId).toBe('c-2');
    // Clearing is always accepted.
    expect(ui.comments.setActive(null)).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBeNull();
  });

  it('setActive returns its own acceptance even when a synchronous observer re-enters and clears focus', () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1' }, { commentId: 'c-2' }] }) },
    });
    const ui = createSuperDocUI({ superdoc });

    let reentered = false;
    const off = ui.comments.observe((snapshot) => {
      if (snapshot.activeId === 'c-1' && !reentered) {
        reentered = true;
        ui.comments.setActive(null);
      }
    });

    expect(ui.comments.setActive('c-1')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBeNull();

    off();
  });

  it('comments setActive returns false when no editor is mounted', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ noEditor: true });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.comments.setActive('c-1')).toBe(false);
  });

  it('comments setActive accepts an importedId alias and a reply id, resolving to the thread root', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: {
        list: () => ({
          items: [
            { commentId: 'c-1', importedId: '0' },
            { commentId: 'c-1-reply', parentCommentId: 'c-1', rootCommentId: 'c-1' },
          ],
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    // The importedId alias resolves to the comment's own id.
    expect(ui.comments.setActive('0')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');
    // A reply's id resolves to its thread root, not the reply itself.
    expect(ui.comments.setActive('c-1-reply')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');
  });

  it('comments setActive resolves a reply lacking rootCommentId via its parentCommentId', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: {
        list: () => ({
          items: [
            { commentId: 'c-1' },
            // Reply row with only parentCommentId populated (no rootCommentId).
            { commentId: 'c-1-reply', parentCommentId: 'c-1' },
          ],
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.comments.setActive('c-1-reply')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');
  });

  it('scrollTo resolves the comment target and routes through host.scrollTargetIntoView', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1', target: WF_TARGET }] }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.comments.scrollTo('c-1');
    expect(result).toEqual({ success: true, ok: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target: WF_TARGET, block: 'center', behavior: 'smooth' });
  });

  it('scrollTo awaits an async comments.get fallback when the snapshot list does not carry the target', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const get = vi.fn(() => Promise.resolve({ commentId: 'c-2', target: WF_TARGET }));
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [] }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.comments.scrollTo('c-2');

    expect(result).toEqual({ success: true, ok: true });
    expect(get).toHaveBeenCalledWith({ commentId: 'c-2' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target: WF_TARGET, block: 'center', behavior: 'smooth' });
  });

  it('scrollTo fails closed with target-unresolved for an unknown comment', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [] }), get: () => null },
      host: { scrollTargetIntoView: vi.fn() },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.comments.scrollTo('missing')).toEqual({
      success: false,
      ok: false,
      reason: SUPERDOC_UI_REASONS.targetUnresolved,
    });
  });

  it('scrollTo fails closed with host-capability-unavailable when the host cannot scroll', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ id: 'c-1', target: WF_TARGET }] }) },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.comments.scrollTo('c-1')).toEqual({
      success: false,
      ok: false,
      reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable,
    });
  });

  it('scrollTo fails closed with not-ready when no editor is mounted', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ noEditor: true });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.comments.scrollTo('c-1')).toEqual({
      success: false,
      ok: false,
      reason: SUPERDOC_UI_REASONS.notReady,
    });
  });
});

describe('public ui — viewport.scrollIntoView parity', () => {
  // One test per supported target kind. Each asserts the method resolves the
  // target to the segment-shaped form the host scroll surface consumes, forwards
  // block/behavior, and maps the host result to `{ success }`.

  it('scrolls a single-block text range (TextAddress) into view', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({ host: { scrollTargetIntoView } });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.viewport.scrollIntoView({
      target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 5 } },
      block: 'start',
      behavior: 'auto',
    });

    expect(result).toEqual({ success: true });
    // A TextAddress is normalized to a single-segment text target.
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] },
      block: 'start',
      behavior: 'auto',
    });
  });

  it('forwards instant behavior to the host', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({ host: { scrollTargetIntoView } });
    const ui = createSuperDocUI({ superdoc });
    const target = { kind: 'text', blockId: 'P1', range: { start: 0, end: 5 } } as const;

    const result = await ui.viewport.scrollIntoView({ target, behavior: 'instant' });

    expect(result).toEqual({ success: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] },
      block: 'center',
      behavior: 'instant',
    });
  });

  it('maps one failed instant text-range attempt without retrying', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: 'target-not-visible' }));
    const { superdoc } = makeWorkflowSuperdoc({ host: { scrollTargetIntoView } });
    const ui = createSuperDocUI({ superdoc });
    const target = { kind: 'text', blockId: 'P-far', range: { start: 0, end: 0 } } as const;

    const result = await ui.viewport.scrollIntoView({ target, block: 'start', behavior: 'instant' });

    expect(result).toEqual({ success: false });
    expect(scrollTargetIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: { kind: 'text', segments: [{ blockId: 'P-far', range: { start: 0, end: 0 } }] },
      block: 'start',
      behavior: 'instant',
    });
  });

  it('scrolls a multi-segment text target (TextTarget) into view', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({ host: { scrollTargetIntoView } });
    const ui = createSuperDocUI({ superdoc });

    type Segment = { blockId: string; range: { start: number; end: number } };
    const target: { kind: 'text'; segments: [Segment, ...Segment[]] } = {
      kind: 'text',
      segments: [
        { blockId: 'P1', range: { start: 0, end: 5 } },
        { blockId: 'P2', range: { start: 0, end: 3 } },
      ],
    };
    const result = await ui.viewport.scrollIntoView({ target, block: 'nearest', behavior: 'auto' });

    expect(result).toEqual({ success: true });
    // A multi-segment target passes through unchanged.
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target, block: 'nearest', behavior: 'auto' });
  });

  it('scrolls a comment entity into view', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [{ commentId: 'c-1', target: WF_TARGET }] }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.viewport.scrollIntoView({
      target: { kind: 'entity', entityType: 'comment', entityId: 'c-1' },
      block: 'center',
      behavior: 'smooth',
    });

    expect(result).toEqual({ success: true });
    // The comment id resolves to its stored target (same path as comments.scrollTo).
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target: WF_TARGET, block: 'center', behavior: 'smooth' });
  });

  it('awaits an async comment entity fallback before scrolling', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const get = vi.fn(() => Promise.resolve({ commentId: 'c-2', target: WF_TARGET }));
    const { superdoc } = makeWorkflowSuperdoc({
      comments: { list: () => ({ items: [] }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.viewport.scrollIntoView({
      target: { kind: 'entity', entityType: 'comment', entityId: 'c-2' },
    });

    expect(result).toEqual({ success: true });
    expect(get).toHaveBeenCalledWith({ commentId: 'c-2' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: WF_TARGET,
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('scrolls a tracked-change entity into view', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: [{ id: 'tc-1', target: WF_TARGET }] }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.viewport.scrollIntoView({
      target: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-1' },
      block: 'center',
      behavior: 'smooth',
    });

    expect(result).toEqual({ success: true });
    // The tracked-change id resolves to its stored target (same path as trackChanges.scrollTo).
    expect(scrollTargetIntoView).toHaveBeenCalledWith({ target: WF_TARGET, block: 'center', behavior: 'smooth' });
  });

  it('uses the tracked-change row matching the requested story when one is already loaded', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '1' } as const;
    const bodyTarget = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] } as const;
    const footnoteTarget = {
      kind: 'text',
      story: footnoteStory,
      segments: [{ blockId: 'FN1', range: { start: 0, end: 5 } }],
    } as const;
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: {
        list: () => ({
          items: [
            {
              id: 'tc-repeated',
              address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-repeated' },
              target: bodyTarget,
            },
            {
              id: 'tc-repeated',
              address: {
                kind: 'entity',
                entityType: 'trackedChange',
                entityId: 'tc-repeated',
                story: footnoteStory,
              },
              target: footnoteTarget,
            },
          ],
        }),
      },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.viewport.scrollIntoView({
      target: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-repeated', story: footnoteStory },
    });

    expect(result).toEqual({ success: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: footnoteTarget,
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('passes tracked-change story through the async entity fallback before scrolling', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '1' } as const;
    const footnoteTarget = {
      kind: 'text',
      story: footnoteStory,
      segments: [{ blockId: 'FN1', range: { start: 0, end: 5 } }],
    } as const;
    const get = vi.fn(() => Promise.resolve({ id: 'tc-fn', target: footnoteTarget }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: [] }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.viewport.scrollIntoView({
      target: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
    });

    expect(result).toEqual({ success: true });
    expect(get).toHaveBeenCalledWith({ id: 'tc-fn', story: footnoteStory });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: footnoteTarget,
      block: 'center',
      behavior: 'smooth',
    });
  });
});

describe('public ui — track changes workflow parity (row 748)', () => {
  const items = [
    {
      id: 'tc-1',
      type: 'insert',
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 3 } }] },
    },
    {
      id: 'tc-2',
      type: 'delete',
      target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 0, end: 3 } }] },
    },
    { id: 'tc-3', type: 'insert' },
  ];

  it('acceptAll / rejectAll and their built-in command ids route through the canonical all target', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }), decide },
      host: {
        getCapabilities: () => ({
          editableSubset: {
            commands: [
              { command: 'trackedChanges.acceptAll', status: 'supported' },
              { command: 'trackedChanges.rejectAll', status: 'supported' },
            ],
          },
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.acceptAllChanges).getState()).toMatchObject({
      supported: true,
      enabled: true,
    });
    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.rejectAllChanges).getState()).toMatchObject({
      supported: true,
      enabled: true,
    });
    expect(ui.trackChanges.acceptAll()).toMatchObject({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'all' } });
    expect(ui.trackChanges.rejectAll()).toMatchObject({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'reject', target: { kind: 'all' } });
    await expect(ui.trackChanges.acceptAllAsync()).resolves.toMatchObject({ success: true });
    await expect(ui.trackChanges.rejectAllAsync()).resolves.toMatchObject({ success: true });
    await expect(ui.commands.executeAsync(BUILT_IN_COMMAND_IDS.acceptAllChanges)).resolves.toMatchObject({
      success: true,
    });
    await expect(ui.commands.executeAsync(BUILT_IN_COMMAND_IDS.rejectAllChanges)).resolves.toMatchObject({
      success: true,
    });
    expect(decide).toHaveBeenLastCalledWith({ decision: 'reject', target: { kind: 'all' } });
  });

  it('acceptAsync / rejectAsync wait for the tracked-change decision', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' };
    const decide = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }), decide } });
    const ui = createSuperDocUI({ superdoc });

    await expect(ui.trackChanges.acceptAsync('tc-1')).resolves.toMatchObject({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'id', id: 'tc-1' } });

    await expect(ui.trackChanges.rejectAsync({ id: 'tc-2', story })).resolves.toMatchObject({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'reject', target: { kind: 'id', id: 'tc-2', story } });
  });

  it('acceptAsync / rejectAsync with an explicit id do not wait for a pending selection read', async () => {
    const decide = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      selectionInfo: new Promise(() => {}),
      trackChanges: { list: () => ({ items }), decide },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.state.selection.status).not.toBe('ready');

    // The panel supplies the id, so the decision must settle even though the
    // selection read never does.
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timed out'), 50));
    await expect(Promise.race([ui.trackChanges.acceptAsync('tc-1'), timeout])).resolves.toMatchObject({
      success: true,
    });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'id', id: 'tc-1' } });

    await expect(Promise.race([ui.trackChanges.rejectAsync({ id: 'tc-2' }), timeout])).resolves.toMatchObject({
      success: true,
    });
    expect(decide).toHaveBeenLastCalledWith({ decision: 'reject', target: { kind: 'id', id: 'tc-2' } });
  });

  it('acceptAsync / rejectAsync fail closed on an empty id instead of deciding the selected change', async () => {
    const decide = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      selectionInfo: {
        empty: false,
        target: WF_TARGET,
        selectionTarget: WF_SELECTION_TARGET,
        activeChangeIds: ['tc-1'],
      },
      trackChanges: { list: () => ({ items }), decide },
    });
    const ui = createSuperDocUI({ superdoc });

    await expect(ui.trackChanges.acceptAsync('')).resolves.toBe(false);
    await expect(ui.trackChanges.rejectAsync({ id: '' })).resolves.toBe(false);
    expect(ui.trackChanges.accept('')).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('async domain decisions bypass an application command registered under a built-in id', async () => {
    const decide = vi.fn(async () => ({ success: true }));
    const override = vi.fn(() => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }), decide, acceptAll: decide, rejectAll: decide },
      host: { v2TrackedChanges: { bulkDecisions: true } },
    });
    const ui = createSuperDocUI({ superdoc });
    ui.commands.register({ id: BUILT_IN_COMMAND_IDS.acceptChange, execute: override });
    ui.commands.register({ id: BUILT_IN_COMMAND_IDS.acceptAllChanges, execute: override });

    await expect(ui.trackChanges.acceptAsync('tc-1')).resolves.toMatchObject({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'id', id: 'tc-1' } });
    await ui.trackChanges.acceptAllAsync();
    expect(override).not.toHaveBeenCalled();

    // The command registry still honours the override.
    await ui.commands.executeAsync(BUILT_IN_COMMAND_IDS.acceptChange, 'tc-1');
    expect(override).toHaveBeenCalledTimes(1);
  });

  it('acceptAll fails closed when generic decide exists without host bulk opt-in', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }), decide } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.acceptAllChanges).getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.bulkDecisionsDisabled,
    });
    expect(ui.trackChanges.acceptAll()).toBe(false);
    await expect(ui.trackChanges.acceptAllAsync()).resolves.toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('acceptAll fails closed (false) when bulk decisions are unavailable on the host', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.acceptAll()).toBe(false);
  });

  it('acceptAll reports bulk-decisions-disabled when the host capability matrix disables bulk decisions', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }), decide },
      host: {
        getCapabilities: () => ({
          editableSubset: {
            commands: [
              {
                command: 'trackedChanges.acceptAll',
                status: 'unsupported',
                reason: 'bulk-tracked-change-decisions-omitted',
              },
            ],
          },
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.acceptAllChanges).getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.bulkDecisionsDisabled,
    });
    expect(ui.trackChanges.acceptAll()).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('next / previous navigate the change feed and update the active id', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    expect(ui.trackChanges.next()).toBe('tc-1');
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
    expect(ui.trackChanges.next()).toBe('tc-2');
    expect(ui.trackChanges.previous()).toBe('tc-1');
    // wraps around
    expect(ui.trackChanges.previous()).toBe('tc-3');
  });

  it('follows the host review target when a document click lands beside another selection-derived change', () => {
    const replacement = { id: 'tc-replacement', type: 'replacement' };
    const adjacentInsertion = { id: 'tc-adjacent', type: 'insert' };
    type ReviewTarget = {
      entityType: 'trackedChange';
      entityId: string;
      origin: 'document';
      layoutEpoch: number;
      story: { kind: 'story'; storyType: 'body' };
    };
    let activeReviewTarget: ReviewTarget | null = null;
    let publishReviewSnapshot: ((snapshot: { activeReviewTarget: ReviewTarget | null }) => void) | null = null;
    const detachReview = vi.fn();
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: vi.fn((listener: typeof publishReviewSnapshot) => {
        publishReviewSnapshot = listener;
        return detachReview;
      }),
    };
    const selectionInfo = {
      empty: true,
      target: WF_TARGET,
      selectionTarget: WF_SELECTION_TARGET,
      activeMarks: [],
      activeCommentIds: [],
      // Deleted replacement text is not live editable content, so the caret
      // resolves to this adjacent insertion after the document click.
      activeChangeIds: [adjacentInsertion.id],
      text: '',
    };
    const listTrackChanges = vi.fn(() => ({ items: [replacement, adjacentInsertion] }));
    const { superdoc } = makeWorkflowSuperdoc({
      selectionInfo,
      trackChanges: { list: listTrackChanges },
      host: { getHandles: () => ({ review }) },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.getSnapshot().activeId).toBe(adjacentInsertion.id);
    const listCallsBeforeDocumentClick = listTrackChanges.mock.calls.length;

    activeReviewTarget = {
      entityType: 'trackedChange',
      entityId: replacement.id,
      origin: 'document',
      layoutEpoch: 7,
      story: { kind: 'story', storyType: 'body' },
    };
    publishReviewSnapshot?.({ activeReviewTarget });

    expect(ui.trackChanges.getSnapshot().activeId).toBe(replacement.id);
    expect(listTrackChanges).toHaveBeenCalledTimes(listCallsBeforeDocumentClick);

    const observed: string[] = [];
    const stopObserving = ui.trackChanges.observe((snapshot) => observed.push(snapshot.activeId ?? 'none'));
    const observationsBeforeDuplicate = observed.length;
    publishReviewSnapshot?.({ activeReviewTarget: { ...activeReviewTarget, layoutEpoch: 8 } });
    expect(observed).toHaveLength(observationsBeforeDuplicate);

    activeReviewTarget = null;
    publishReviewSnapshot?.({ activeReviewTarget });
    expect(ui.trackChanges.getSnapshot().activeId).toBe(adjacentInsertion.id);

    stopObserving();
    ui.destroy();
    expect(detachReview).toHaveBeenCalledOnce();
  });

  it('keeps explicit focus when a document edit temporarily unpaints the tracked change', () => {
    let activeReviewTarget: unknown = null;
    let publishReviewSnapshot:
      | ((snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void)
      | null = null;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: (listener: (snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void) => {
        publishReviewSnapshot = listener;
        return () => undefined;
      },
      setActiveReviewTarget: (target: unknown) => {
        activeReviewTarget = target;
        publishReviewSnapshot?.({ activeReviewTarget, lastInteractionRejection: null });
      },
    };
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: { getHandles: () => ({ review, layout: { generation: 1 } }) },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    activeReviewTarget = null;
    publishReviewSnapshot?.({
      activeReviewTarget,
      lastInteractionRejection: { code: 'review-target-invalidated', detail: 'not-painted' },
    });

    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
  });

  it('clears explicit focus after a remote peer removes the tracked change', async () => {
    vi.useFakeTimers();
    try {
      let currentItems = [...items];
      let activeReviewTarget: unknown = null;
      let publishReviewSnapshot:
        | ((snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void)
        | null = null;
      let publishHostEvent: ((event: Record<string, unknown>) => void) | null = null;
      const review = {
        getActiveReviewTarget: () => activeReviewTarget,
        subscribe: (
          listener: (snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void,
        ) => {
          publishReviewSnapshot = listener;
          return () => undefined;
        },
        setActiveReviewTarget: (target: unknown) => {
          activeReviewTarget = target;
          publishReviewSnapshot?.({ activeReviewTarget, lastInteractionRejection: null });
        },
      };
      const { superdoc } = makeWorkflowSuperdoc({
        trackChanges: { list: () => ({ items: currentItems }) },
        host: {
          getHandles: () => ({ review, layout: { generation: 1 } }),
          events: {
            subscribe: (listener: (event: Record<string, unknown>) => void) => {
              publishHostEvent = listener;
              return () => undefined;
            },
          },
        },
      });
      const ui = createSuperDocUI({ superdoc });

      expect(ui.trackChanges.setActive('tc-1')).toBe(true);
      currentItems = currentItems.filter((item) => item.id !== 'tc-1');
      activeReviewTarget = null;
      publishReviewSnapshot?.({
        activeReviewTarget,
        lastInteractionRejection: { code: 'review-target-invalidated', detail: 'not-painted' },
      });
      publishHostEvent?.({
        type: 'collaboration:remote-changed',
        changedStoryIds: ['main:/word/document.xml'],
        changedPartUris: ['/word/document.xml'],
      });

      await vi.advanceTimersByTimeAsync(7000);
      expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
      ui.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('canonicalizes a story-scoped painted alias from the host review target before publishing activeId', () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '1' } as const;
    const canonicalChange = {
      id: 'tc-footnote-replacement',
      type: 'replacement',
      sourceIds: { wordIdInsert: '0', wordIdDelete: '1' },
      address: { story: footnoteStory },
      storyLocator: footnoteStory,
    };
    type ReviewTarget = {
      entityType: 'trackedChange';
      entityId: string;
      origin: 'document';
      layoutEpoch: number;
      story: typeof footnoteStory;
    };
    let activeReviewTarget: ReviewTarget | null = null;
    let publishReviewSnapshot: ((snapshot: { activeReviewTarget: ReviewTarget | null }) => void) | null = null;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: (listener: typeof publishReviewSnapshot) => {
        publishReviewSnapshot = listener;
        return () => {};
      },
    };
    const { superdoc } = makeWorkflowSuperdoc({
      // Mirror the browser path: the V2 feed is ready while the Document API's
      // independent all-story validation read is still pending.
      trackChanges: { list: () => new Promise(() => {}) },
      v2TrackedChanges: { listTrackedChanges: () => ({ items: [canonicalChange] }) },
      host: { getHandles: () => ({ review }) },
    });
    const ui = createSuperDocUI({ superdoc });

    activeReviewTarget = {
      entityType: 'trackedChange',
      entityId: 'imported:0',
      origin: 'document',
      layoutEpoch: 1,
      story: footnoteStory,
    };
    publishReviewSnapshot?.({ activeReviewTarget });

    expect(ui.trackChanges.getSnapshot().activeId).toBe(canonicalChange.id);
    ui.destroy();
  });

  it('canonicalizes a story-scoped selection alias before publishing the active tracked-change id', () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '1' } as const;
    const canonicalChange = {
      id: 'tc-footnote-replacement',
      type: 'replacement',
      sourceIds: { wordIdInsert: '0', wordIdDelete: '1' },
      address: { story: footnoteStory },
      storyLocator: footnoteStory,
    };
    const { superdoc } = makeWorkflowSuperdoc({
      selectionInfo: {
        empty: true,
        target: { ...WF_TARGET, story: footnoteStory },
        selectionTarget: {
          ...WF_SELECTION_TARGET,
          story: footnoteStory,
          start: { ...WF_SELECTION_TARGET.start, story: footnoteStory },
          end: { ...WF_SELECTION_TARGET.end, story: footnoteStory },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: ['imported:0'],
        text: '',
      },
      trackChanges: { list: () => ({ items: [canonicalChange] }) },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.getSnapshot().activeId).toBe(canonicalChange.id);
    ui.destroy();
  });

  it('adopts a tracked change already focused by the host before controller creation', () => {
    const activeReviewTarget = {
      entityType: 'trackedChange',
      entityId: 'tc-replacement',
      origin: 'document',
      layoutEpoch: 3,
      story: { kind: 'story', storyType: 'body' },
    } as const;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: vi.fn(() => () => {}),
    };
    const { superdoc } = makeWorkflowSuperdoc({
      selectionInfo: {
        empty: true,
        target: WF_TARGET,
        selectionTarget: WF_SELECTION_TARGET,
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: ['tc-adjacent'],
        text: '',
      },
      trackChanges: {
        list: () => ({
          items: [
            { id: 'tc-replacement', type: 'replacement' },
            { id: 'tc-adjacent', type: 'insert' },
          ],
        }),
      },
      host: { getHandles: () => ({ review }) },
    });

    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.getSnapshot().activeId).toBe(activeReviewTarget.entityId);
    ui.destroy();
  });

  it('next returns null when there are no tracked changes', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items: [] }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.next()).toBeNull();
    expect(ui.trackChanges.previous()).toBeNull();
  });

  it('navigateNext / navigatePrevious advance the active id and scroll instantly', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target: items[0].target, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
    expect(await ui.trackChanges.navigatePrevious()).toEqual({ success: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
  });

  it('navigateNext threads a non-body row story into the scroll target (IT-1250)', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '1' } as const;
    const footnoteTarget = { kind: 'text', segments: [{ blockId: 'FN1', range: { start: 0, end: 3 } }] } as const;
    const rows = [
      {
        id: 'tc-fn',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn', story: footnoteStory },
        target: footnoteTarget,
      },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-fn');
    // The row's story is stamped onto the story-less stored target so the host
    // resolves carriers within the footnote story, not the body default.
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: { ...footnoteTarget, story: footnoteStory },
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it('navigateNext resolves the async entity fallback with the active row story (IT-1250)', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' } as const;
    const headerTarget = {
      kind: 'text',
      story: headerStory,
      segments: [{ blockId: 'H1', range: { start: 0, end: 3 } }],
    } as const;
    const get = vi.fn(() => Promise.resolve({ id: 'tc-hf', target: headerTarget }));
    const rows = [
      {
        id: 'tc-hf',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-hf', story: headerStory },
      },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(get).toHaveBeenCalledWith({ id: 'tc-hf', story: headerStory });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target: headerTarget, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
  });

  it('navigateNext keeps body rows story-less so body matching is unchanged', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const get = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    // The stored body target is passed through unchanged (same reference), with
    // no story stamped onto it and no story-scoped fallback read.
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target: items[0].target, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('navigateNext steps from the active occurrence when an id repeats across stories (IT-1250)', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' } as const;
    const bodyTarget = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 3 } }] } as const;
    const headerTarget = { kind: 'text', segments: [{ blockId: 'H1', range: { start: 0, end: 3 } }] } as const;
    const tailTarget = { kind: 'text', segments: [{ blockId: 'P9', range: { start: 0, end: 3 } }] } as const;
    const rows = [
      { id: 'tc-dup', type: 'insert', target: bodyTarget },
      {
        id: 'tc-dup',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup', story: headerStory },
        target: headerTarget,
      },
      { id: 'tc-tail', type: 'insert', target: tailTarget },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    // First hop lands on the body occurrence, story-less.
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(scrollTargetIntoView).toHaveBeenLastCalledWith(
      { target: bodyTarget, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
    // Explicitly focus the header occurrence, as an inline click or review-card
    // activation would. Default navigation remains body-scoped when body rows
    // exist, but once a non-body occurrence is active the complete feed is used.
    expect(ui.trackChanges.setActive({ id: 'tc-dup', story: headerStory })).toBe(true);
    // The next hop must step forward from the header occurrence, not loop back
    // to the body row that shares the raw id.
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-tail');
    expect(scrollTargetIntoView).toHaveBeenLastCalledWith(
      { target: tailTarget, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
  });

  it('scrollTo honours a requested { id, story } when the id repeats across stories (IT-1250)', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '3' } as const;
    const bodyTarget = { kind: 'text', segments: [{ blockId: 'P9', range: { start: 0, end: 4 } }] } as const;
    const footnoteTarget = { kind: 'text', segments: [{ blockId: 'FN3', range: { start: 0, end: 4 } }] } as const;
    const rows = [
      {
        id: 'tc-dup',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup' },
        target: bodyTarget,
      },
      {
        id: 'tc-dup',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup', story: footnoteStory },
        target: footnoteTarget,
      },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    // A bare id resolves the first occurrence, the body row.
    expect(await ui.trackChanges.scrollTo('tc-dup')).toMatchObject({ ok: true });
    expect(scrollTargetIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: bodyTarget }),
      expect.any(Function),
    );

    // The row's story pins the footnote occurrence.
    expect(await ui.trackChanges.scrollTo({ id: 'tc-dup', story: footnoteStory })).toMatchObject({ ok: true });
    expect(scrollTargetIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: { ...footnoteTarget, story: footnoteStory } }),
      expect.any(Function),
    );

    expect(await ui.trackChanges.scrollTo({ id: '', story: footnoteStory })).toMatchObject({ ok: false });
  });

  it('scrollTo pins an explicit body story even when a same-id non-body row is listed first (IT-1250)', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const bodyStory = { kind: 'story', storyType: 'body' } as const;
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '4' } as const;
    const bodyTarget = { kind: 'text', segments: [{ blockId: 'P10', range: { start: 0, end: 4 } }] } as const;
    const footnoteTarget = { kind: 'text', segments: [{ blockId: 'FN4', range: { start: 0, end: 4 } }] } as const;
    const rows = [
      {
        id: 'tc-dup2',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup2', story: footnoteStory },
        target: footnoteTarget,
      },
      {
        id: 'tc-dup2',
        type: 'insert',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-dup2' },
        target: bodyTarget,
      },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    // The footnote row is first, so a bare id would reveal it. An explicit
    // body story must still reveal the body occurrence, with no story threaded
    // into the host call (body is the host default).
    expect(await ui.trackChanges.scrollTo({ id: 'tc-dup2', story: bodyStory })).toMatchObject({ ok: true });
    expect(scrollTargetIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: bodyTarget }),
      expect.any(Function),
    );
    const lastTarget = scrollTargetIntoView.mock.calls.at(-1)?.[0]?.target;
    expect(lastTarget).not.toHaveProperty('story');
  });

  it('scrollTo threads the matching row story into the scroll target (IT-1250)', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '2' } as const;
    const footnoteTarget = { kind: 'text', segments: [{ blockId: 'FN2', range: { start: 0, end: 4 } }] } as const;
    const rows = [
      {
        id: 'tc-fn2',
        type: 'delete',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-fn2', story: footnoteStory },
        target: footnoteTarget,
      },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.scrollTo('tc-fn2')).toMatchObject({ ok: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: { ...footnoteTarget, story: footnoteStory },
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it('scrollTo preserves canonical focus when a custom panel passes a raw tracked-change alias', async () => {
    const publicId = 'tc|body|replacement|27|28';
    const rawId = 'imported:28';
    const target = {
      kind: 'text',
      segments: [{ blockId: 'P99', range: { start: 4, end: 12 } }],
    } as const;
    const rows = [
      {
        id: publicId,
        type: 'replacement',
        sourceIds: { wordIdInsert: '28', wordIdDelete: '27' },
        target,
      },
    ];
    let activeReviewTarget: unknown = null;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: vi.fn(() => () => {}),
      setActiveReviewTarget: vi.fn((next: unknown) => {
        activeReviewTarget = next;
      }),
      clearActiveReviewTarget: vi.fn(() => {
        activeReviewTarget = null;
      }),
    };
    const scrollTargetIntoView = vi.fn(async (_input: unknown, shouldContinue?: () => boolean) =>
      shouldContinue?.() === false
        ? { success: false, reason: SUPERDOC_UI_REASONS.targetNotVisible }
        : { success: true },
    );
    const get = vi.fn(() => ({ id: rawId, target }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }), get },
      host: {
        getHandles: () => ({ review, layout: { generation: 1 } }),
        scrollTargetIntoView,
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive(rawId)).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe(publicId);

    await expect(ui.trackChanges.scrollTo(rawId)).resolves.toEqual({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe(publicId);
    expect(activeReviewTarget).toMatchObject({
      entityType: 'trackedChange',
      entityId: publicId,
      paintedEntityId: rawId,
    });
    expect(get).not.toHaveBeenCalled();
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
  });

  it('scrollTo retains explicit panel focus across a transient host clear while reveal is pending', async () => {
    let activeReviewTarget: unknown = null;
    let publishReviewSnapshot: ((snapshot: { activeReviewTarget: unknown }) => void) | null = null;
    let resolveScroll: ((value: unknown) => void) | null = null;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      setActiveReviewTarget: vi.fn((target: unknown) => {
        activeReviewTarget = target;
        publishReviewSnapshot?.({ activeReviewTarget });
      }),
      clearActiveReviewTarget: vi.fn(() => {
        activeReviewTarget = null;
        publishReviewSnapshot?.({ activeReviewTarget });
      }),
      subscribe: vi.fn((listener: typeof publishReviewSnapshot) => {
        publishReviewSnapshot = listener;
        return () => {};
      }),
    };
    const scrollTargetIntoView = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveScroll = resolve;
        }),
    );
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: {
        getHandles: () => ({ review }),
        scrollTargetIntoView,
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    const reveal = ui.trackChanges.scrollTo('tc-1');
    for (let index = 0; index < 6 && scrollTargetIntoView.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(scrollTargetIntoView).toHaveBeenCalledOnce();

    activeReviewTarget = null;
    publishReviewSnapshot?.({ activeReviewTarget });
    resolveScroll?.({ success: true });

    await expect(reveal).resolves.toMatchObject({ ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
  });

  it('protects a newer panel focus while its tracked-change target is resolving', async () => {
    let activeReviewTarget: unknown = null;
    let publishReviewSnapshot: ((snapshot: { activeReviewTarget: unknown }) => void) | null = null;
    let resolveFirstScroll: ((value: unknown) => void) | null = null;
    let resolveSecondTarget: ((value: unknown) => void) | null = null;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      setActiveReviewTarget: vi.fn((target: unknown) => {
        activeReviewTarget = target;
        publishReviewSnapshot?.({ activeReviewTarget });
      }),
      clearActiveReviewTarget: vi.fn(() => {
        activeReviewTarget = null;
        publishReviewSnapshot?.({ activeReviewTarget });
      }),
      subscribe: vi.fn((listener: typeof publishReviewSnapshot) => {
        publishReviewSnapshot = listener;
        return () => {};
      }),
    };
    const scrollTargetIntoView = vi.fn(() => {
      if (scrollTargetIntoView.mock.calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirstScroll = resolve;
        });
      }
      return Promise.resolve({ success: true });
    });
    const rows = [
      { id: 'tc-1', type: 'insert', target: items[0].target },
      { id: 'tc-2', type: 'delete' },
    ];
    const get = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSecondTarget = resolve;
        }),
    );
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }), get },
      host: {
        getHandles: () => ({ review }),
        scrollTargetIntoView,
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    const firstReveal = ui.trackChanges.scrollTo('tc-1');
    for (let index = 0; index < 6 && scrollTargetIntoView.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(scrollTargetIntoView).toHaveBeenCalledOnce();

    expect(ui.trackChanges.setActive('tc-2')).toBe(true);
    const secondReveal = ui.trackChanges.scrollTo('tc-2');
    for (let index = 0; index < 6 && get.mock.calls.length === 0; index += 1) await Promise.resolve();
    expect(get).toHaveBeenCalledWith({ id: 'tc-2' });

    // The old reveal temporarily unmounts its carrier while the newer click is
    // still awaiting the Document API target lookup.
    activeReviewTarget = null;
    publishReviewSnapshot?.({ activeReviewTarget });
    resolveSecondTarget?.({ id: 'tc-2', target: items[1].target });

    await expect(secondReveal).resolves.toMatchObject({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');

    resolveFirstScroll?.({ success: false, reason: SUPERDOC_UI_REASONS.targetNotVisible });
    await expect(firstReveal).resolves.toEqual({ success: false, ok: false });
  });

  it('scrollTo lets a comment target supersede a pending tracked-change reveal', async () => {
    let activeReviewTarget: unknown = null;
    let publishReviewSnapshot: ((snapshot: { activeReviewTarget: unknown }) => void) | null = null;
    let resolveScroll: ((value: unknown) => void) | null = null;
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      setActiveReviewTarget: vi.fn((target: unknown) => {
        activeReviewTarget = target;
        publishReviewSnapshot?.({ activeReviewTarget });
      }),
      clearActiveReviewTarget: vi.fn(() => {
        activeReviewTarget = null;
        publishReviewSnapshot?.({ activeReviewTarget });
      }),
      subscribe: vi.fn((listener: typeof publishReviewSnapshot) => {
        publishReviewSnapshot = listener;
        return () => {};
      }),
    };
    const scrollTargetIntoView = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveScroll = resolve;
        }),
    );
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: {
        getHandles: () => ({ review }),
        scrollTargetIntoView,
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    const reveal = ui.trackChanges.scrollTo('tc-1');
    for (let index = 0; index < 6 && scrollTargetIntoView.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(scrollTargetIntoView).toHaveBeenCalledOnce();

    activeReviewTarget = { entityType: 'comment', entityId: 'comment-1' };
    publishReviewSnapshot?.({ activeReviewTarget });
    resolveScroll?.({ success: true });

    await expect(reveal).resolves.toEqual({ success: false, ok: false });
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    expect(activeReviewTarget).toEqual({ entityType: 'comment', entityId: 'comment-1' });
  });

  it('scrollTo falls back to focusTrackedChange when the host geometry path cannot resolve a structural target', async () => {
    // `normalizeGeometryTarget` (v2-host) has no branch for `kind: 'structural'`
    // and always fails closed with `invalid-target` — the exact gap this
    // fallback exists to cover.
    const structuralTarget = {
      kind: 'structural',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-struct' },
    };
    const rows = [{ id: 'tc-struct', type: 'formatting', target: structuralTarget }];
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: 'invalid-target' }));
    const focusTrackedChange = vi.fn(async () => ({ ok: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
      v2TrackedChanges: { focusTrackedChange },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.scrollTo('tc-struct')).toMatchObject({ success: true, ok: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target: structuralTarget, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
    // Body-scoped: no story known, so the fallback receives the bare id.
    expect(focusTrackedChange).toHaveBeenCalledWith('tc-struct');
  });

  it('scrollTo threads a legacy-imported Word revision id into the focusTrackedChange fallback', async () => {
    // The canonical public id alone does not always match the painted carrier:
    // a row imported from a legacy Word revision can be painted with the raw
    // `w:id`, not the canonical id (`create-v2-tracked-changes-adapter.test.js`
    // pins this alias path as necessary for such rows). The fallback must
    // thread the row's provenance through as `importedId` so the carrier
    // lookup can try both.
    const structuralTarget = {
      kind: 'structural',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-struct-imported' },
    };
    const rows = [
      {
        id: 'tc-struct-imported',
        type: 'formatting',
        target: structuralTarget,
        wordRevisionIds: { format: '42' },
      },
    ];
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: 'invalid-target' }));
    const focusTrackedChange = vi.fn(async () => ({ ok: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
      v2TrackedChanges: { focusTrackedChange },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.scrollTo('tc-struct-imported')).toMatchObject({ success: true, ok: true });
    expect(focusTrackedChange).toHaveBeenCalledWith({ commentId: 'tc-struct-imported', importedId: '42' });
  });

  it('scrollTo keeps a move-side row active when the focusTrackedChange fallback publishes a canonical host target', async () => {
    let activeReviewTarget: unknown = null;
    let lastInteractionRejection: unknown = null;
    const listeners = new Set<(snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void>();
    const publish = () => {
      for (const listener of listeners) listener({ activeReviewTarget, lastInteractionRejection });
    };
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: (listener: (snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setActiveReviewTarget: (target: unknown) => {
        activeReviewTarget = target;
        lastInteractionRejection = null;
        publish();
      },
    };
    const moveSideId = 'tc|move|1%7C101::move-to';
    const canonicalMoveId = 'tc|move|1%7C101';
    const focusTrackedChange = vi.fn(async () => {
      review.setActiveReviewTarget({
        entityType: 'trackedChange',
        entityId: canonicalMoveId,
        paintedEntityId: moveSideId,
        origin: 'panel',
        layoutEpoch: 1,
        story: { kind: 'story', storyType: 'body' },
      });
      return { ok: true };
    });
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: {
        list: () => ({
          items: [
            {
              id: moveSideId,
              type: 'move',
              target: { kind: 'structural', nodeId: 'move-node' },
            },
          ],
        }),
      },
      host: {
        getHandles: () => ({ review, layout: { generation: 1 } }),
      },
      v2TrackedChanges: { focusTrackedChange },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.scrollTo(moveSideId)).toEqual({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe(moveSideId);
    expect(activeReviewTarget).toMatchObject({
      entityType: 'trackedChange',
      entityId: moveSideId,
    });
  });

  it('scrollTo threads story into the focusTrackedChange fallback so a non-body occurrence is not collapsed to body', async () => {
    // A bare id always resolves to BODY_STORY in `resolveTrackedChangeTarget`
    // (browser-shell adapter) — passing one here for a footnote/header row
    // would silently scroll to a different (body) occurrence sharing the
    // same raw id.
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '3' } as const;
    const structuralTarget = {
      kind: 'structural',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-struct-fn', story: footnoteStory },
    };
    const rows = [
      {
        id: 'tc-struct-fn',
        type: 'formatting',
        address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-struct-fn', story: footnoteStory },
        target: structuralTarget,
      },
    ];
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: 'invalid-target' }));
    const focusTrackedChange = vi.fn(async () => ({ ok: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
      v2TrackedChanges: { focusTrackedChange },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.scrollTo('tc-struct-fn')).toMatchObject({ success: true, ok: true });
    expect(focusTrackedChange).toHaveBeenCalledWith({ commentId: 'tc-struct-fn', trackedChangeStory: footnoteStory });
  });

  it('scrollTo returns the primary failure when there is no focusTrackedChange fallback available', async () => {
    const structuralTarget = {
      kind: 'structural',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-struct-2' },
    };
    const rows = [{ id: 'tc-struct-2', type: 'formatting', target: structuralTarget }];
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: 'invalid-target' }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
      // no v2TrackedChanges facade exposed
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.trackChanges.scrollTo('tc-struct-2');
    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
  });

  it('navigateNext falls back to focusTrackedChange for a structural row', async () => {
    const structuralTarget = {
      kind: 'structural',
      address: { kind: 'entity', entityType: 'trackedChange', entityId: 'tc-1' },
    };
    const rows = [{ id: 'tc-1', type: 'formatting', target: structuralTarget }];
    const scrollTargetIntoView = vi.fn(async () => ({ success: false, reason: 'invalid-target' }));
    const focusTrackedChange = vi.fn(async () => ({ ok: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }) },
      host: { scrollTargetIntoView },
      v2TrackedChanges: { focusTrackedChange },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(focusTrackedChange).toHaveBeenCalledWith('tc-1');
  });

  it('navigateNext fails closed without advancing when there are no tracked changes', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: [] }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: false });
    expect(scrollTargetIntoView).not.toHaveBeenCalled();
  });

  it('navigateNext rolls back the active id when the host cannot route navigation', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    const initialActiveId = ui.trackChanges.getSnapshot().activeId;
    // The scroll fails closed (no host capability); the optimistic activeId
    // move rolls back atomically, matching main's rollback-on-failure contract.
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: false });
    expect(ui.trackChanges.getSnapshot().activeId).toBe(initialActiveId);
  });

  it('concurrent failed navigateNext calls restore the original active id', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.setActive('tc-3')).toBe(true);

    const first = ui.trackChanges.navigateNext();
    const second = ui.trackChanges.navigateNext();

    await expect(first).resolves.toEqual({ success: false });
    await expect(second).resolves.toEqual({ success: false });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-3');
  });

  it('navigateNext skips stale scroll and rollback after a newer explicit activation', async () => {
    let resolveGet: ((value: unknown) => void) | null = null;
    const get = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const rows = [
      { id: 'tc-1', type: 'insert' },
      { id: 'tc-2', type: 'delete', target: items[1].target },
    ];
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const navigation = ui.trackChanges.navigateNext();
    for (let index = 0; index < 6 && get.mock.calls.length === 0; index += 1) await Promise.resolve();
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');

    expect(ui.trackChanges.setActive('tc-2')).toBe(true);
    resolveGet?.({ id: 'tc-1', target: items[0].target });

    await expect(navigation).resolves.toEqual({ success: false });
    expect(scrollTargetIntoView).not.toHaveBeenCalled();
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
  });

  it('drops queued navigateNext calls after a newer explicit activation', async () => {
    let resolveScroll: ((value: unknown) => void) | null = null;
    const scrollTargetIntoView = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveScroll = resolve;
        }),
    );
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const first = ui.trackChanges.navigateNext();
    for (let index = 0; index < 6 && scrollTargetIntoView.mock.calls.length === 0; index += 1) await Promise.resolve();
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');

    const second = ui.trackChanges.navigateNext();
    expect(ui.trackChanges.setActive('tc-3')).toBe(true);
    resolveScroll?.({ success: true });

    await expect(first).resolves.toEqual({ success: false });
    await expect(second).resolves.toEqual({ success: false });
    expect(scrollTargetIntoView).toHaveBeenCalledTimes(1);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-3');
  });

  it('scrollTo supersedes a navigateNext queued in the same turn', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const rows = [items[0], { id: 'tc-2', type: 'delete' }];
    const get = vi.fn(async () => ({ id: 'tc-2', target: items[1].target }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const navigation = ui.trackChanges.navigateNext();
    const reveal = ui.trackChanges.scrollTo('tc-2');

    await expect(navigation).resolves.toEqual({ success: false });
    await expect(reveal).resolves.toEqual({ success: true, ok: true });
    expect(scrollTargetIntoView).toHaveBeenCalledOnce();
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
  });

  it('setActive returns true for an accepted activation and false for an unknown id', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.setActive('tc-2')).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
    // Idempotent re-activation of the already-active id is accepted.
    expect(ui.trackChanges.setActive('tc-2')).toBe(true);
    // A non-null id that matches no current item fails closed.
    expect(ui.trackChanges.setActive('tc-missing')).toBe(false);
    // Clearing is always accepted.
    expect(ui.trackChanges.setActive(null)).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
  });

  it('setActive returns false when no editor is mounted', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ noEditor: true });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.setActive('tc-1')).toBe(false);
  });

  it('setActive({ id, story }) fails closed until all-story tracked changes are ready', async () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', id: '1' };
    const list = vi.fn((input?: { in?: unknown }) =>
      input?.in === 'all'
        ? new Promise(() => {
            // Keep the all-story read pending.
          })
        : { items: [] },
    );
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list } });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive({ id: 'tc-fn', story: footnoteStory })).toBe(false);
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
  });

  it('setActive({ id, story }) accepts a ready all-story tracked change', async () => {
    const footnoteStory = { kind: 'story', storyType: 'footnote', id: '1' };
    const list = vi.fn((input?: { in?: unknown }) =>
      input?.in === 'all'
        ? { items: [{ id: 'tc-fn', type: 'insert', address: { story: footnoteStory } }] }
        : { items: [] },
    );
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list } });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive({ id: 'tc-fn', story: footnoteStory })).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-fn');
  });

  it('scrollTo resolves the change target and routes through host.scrollTargetIntoView', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.trackChanges.scrollTo('tc-1');
    expect(result).toEqual({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target: items[0].target, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
  });

  it('scrollTo uses the stable navigation target when tracked-change geometry is outside the painted window', async () => {
    const address = {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'tc-windowed',
    };
    const navigationTarget = {
      kind: 'block',
      story: { kind: 'story', storyType: 'body' },
      blockId: 'P149',
      role: 'primary',
    };
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: {
        list: () => ({
          items: [{ id: 'tc-windowed', type: 'insert', address, navigationTarget }],
        }),
      },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.trackChanges.scrollTo('tc-windowed');

    expect(result).toEqual({ success: true, ok: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: {
          kind: 'text',
          blockId: 'P149',
          range: { start: 0, end: 0 },
          story: navigationTarget.story,
          address,
        },
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it('scrollTo refreshes a list-only navigation target before revealing a streamed tracked change', async () => {
    const address = {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'tc-streamed',
    };
    const staleNavigationTarget = {
      kind: 'block',
      story: { kind: 'story', storyType: 'body' },
      blockId: 'P149',
      role: 'primary',
    };
    const authoritativeNavigationTarget = {
      ...staleNavigationTarget,
      blockId: 'P2210',
    };
    const get = vi.fn(async () => ({
      id: 'tc-streamed',
      type: 'delete',
      address,
      navigationTarget: authoritativeNavigationTarget,
    }));
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: {
        list: () => ({
          items: [
            {
              id: 'tc-streamed',
              type: 'delete',
              address,
              navigationTarget: staleNavigationTarget,
            },
          ],
        }),
        get,
      },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.trackChanges.scrollTo('tc-streamed');

    expect(result).toEqual({ success: true, ok: true });
    expect(get).toHaveBeenCalledWith({ id: 'tc-streamed' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: {
          kind: 'text',
          blockId: 'P2210',
          range: { start: 0, end: 0 },
          story: authoritativeNavigationTarget.story,
          address,
        },
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it('scrollTo materializes an off-window tracked change from its stable block target', async () => {
    const address = {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'tc-distant',
    };
    const navigationTarget = {
      kind: 'block',
      story: { kind: 'story', storyType: 'body' },
      blockId: 'P192',
      role: 'primary',
    };
    const get = vi.fn(async () => ({
      id: 'tc-distant',
      type: 'delete',
      address,
      navigationTarget,
      target: {
        kind: 'text',
        segments: [{ blockId: 'STALE-UNMOUNTED', range: { start: 20, end: 27 } }],
      },
    }));
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: {
        list: () => ({ items: [{ id: 'tc-visible', type: 'insert' }] }),
        get,
      },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.trackChanges.scrollTo('tc-distant');

    expect(result).toEqual({ success: true, ok: true });
    expect(get).toHaveBeenCalledWith({ id: 'tc-distant' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: {
          kind: 'text',
          blockId: 'P192',
          range: { start: 0, end: 0 },
          story: navigationTarget.story,
          address,
        },
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it.each([
    ['move-to', 'DESTINATION'],
    ['move-from', 'SOURCE'],
  ] as const)(
    'scrollTo resolves a streamed synthetic %s row through its canonical move geometry',
    async (side, blockId) => {
      const canonicalId = 'tc|move|1%7C101';
      const id = `${canonicalId}::${side}`;
      const staleTarget = {
        kind: 'text',
        segments: [{ blockId: 'STALE', range: { start: 0, end: 0 } }],
      };
      const get = vi.fn(async () => ({
        id: canonicalId,
        type: 'move',
        target: {
          kind: 'move',
          source: {
            kind: 'text',
            segments: [{ blockId: 'SOURCE', range: { start: 0, end: 6 } }],
          },
          destination: {
            kind: 'text',
            segments: [{ blockId: 'DESTINATION', range: { start: 0, end: 11 } }],
          },
        },
      }));
      const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
      const { superdoc } = makeWorkflowSuperdoc({
        trackChanges: {
          list: () => ({
            items: [
              {
                id,
                trackedChangeCanonicalId: canonicalId,
                type: 'move',
                subtype: side,
                target: staleTarget,
              },
            ],
          }),
          get,
        },
        host: { scrollTargetIntoView },
      });
      const ui = createSuperDocUI({ superdoc });

      const result = await ui.trackChanges.scrollTo(id);

      expect(result).toEqual({ success: true, ok: true });
      expect(get).toHaveBeenCalledWith({ id: canonicalId });
      expect(scrollTargetIntoView).toHaveBeenCalledWith(
        {
          target: {
            kind: 'text',
            segments: [{ blockId, range: { start: 0, end: side === 'move-to' ? 11 : 6 } }],
          },
          block: 'center',
          behavior: 'auto',
        },
        expect.any(Function),
      );
    },
  );

  it('scrollTo prefers the stable navigation target when the row target is semantic rather than geometric', async () => {
    const address = {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'tc-formatting',
    };
    const navigationTarget = {
      kind: 'block',
      story: { kind: 'story', storyType: 'body' },
      blockId: 'P150',
      role: 'primary',
    };
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: {
        list: () => ({
          items: [
            {
              id: 'tc-formatting',
              type: 'formatting',
              target: { kind: 'formatting', operation: 'setProperties' },
              address,
              navigationTarget,
            },
          ],
        }),
      },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.trackChanges.scrollTo('tc-formatting');

    expect(result).toEqual({ success: true, ok: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: {
          kind: 'text',
          blockId: 'P150',
          range: { start: 0, end: 0 },
          story: navigationTarget.story,
          address,
        },
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it('tracked-change navigation ignores transient invalidation of a virtualized carrier', async () => {
    let activeReviewTarget: unknown = null;
    let lastInteractionRejection: unknown = null;
    const listeners = new Set<(snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void>();
    const publish = () => {
      for (const listener of listeners) listener({ activeReviewTarget, lastInteractionRejection });
    };
    const review = {
      getActiveReviewTarget: () => activeReviewTarget,
      subscribe: (listener: (snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setActiveReviewTarget: (target: unknown) => {
        activeReviewTarget = target;
        lastInteractionRejection = null;
        publish();
      },
      clearActiveReviewTarget: () => {
        if (activeReviewTarget == null) return;
        activeReviewTarget = null;
        lastInteractionRejection = { code: 'review-target-invalidated', detail: 'not-painted' };
        publish();
      },
    };
    const scrollTargetIntoView = vi.fn(async () => {
      // A deep virtualized paint releases an existing carrier. If scrollTo
      // leaves the matching host focus installed, this null notification
      // supersedes its optimistic revision despite the successful landing.
      review.clearActiveReviewTarget();
      return { success: true };
    });
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: {
        scrollTargetIntoView,
        getHandles: () => ({ review, layout: { generation: 1 } }),
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    expect(await ui.trackChanges.scrollTo('tc-2')).toEqual({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
    expect(activeReviewTarget).toMatchObject({ entityType: 'trackedChange', entityId: 'tc-2' });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    expect(await ui.trackChanges.navigateNext()).toEqual({ success: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
    expect(activeReviewTarget).toMatchObject({ entityType: 'trackedChange', entityId: 'tc-2' });
  });

  it.each(['scrollTo', 'navigateNext'] as const)(
    '%s keeps a newer explicit activation after stale virtualized navigation settles',
    async (operation) => {
      let activeReviewTarget: unknown = null;
      let lastInteractionRejection: unknown = null;
      const listeners = new Set<
        (snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void
      >();
      const publish = () => {
        for (const listener of listeners) listener({ activeReviewTarget, lastInteractionRejection });
      };
      const review = {
        getActiveReviewTarget: () => activeReviewTarget,
        subscribe: (
          listener: (snapshot: { activeReviewTarget: unknown; lastInteractionRejection: unknown }) => void,
        ) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        setActiveReviewTarget: (target: unknown) => {
          activeReviewTarget = target;
          lastInteractionRejection = null;
          publish();
        },
        clearActiveReviewTarget: () => {
          activeReviewTarget = null;
          lastInteractionRejection = { code: 'review-target-invalidated', detail: 'not-painted' };
          publish();
        },
      };
      let resolveScroll: ((value: { success: true }) => void) | null = null;
      const scrollTargetIntoView = vi.fn(
        () =>
          new Promise<{ success: true }>((resolve) => {
            resolveScroll = resolve;
          }),
      );
      const { superdoc } = makeWorkflowSuperdoc({
        trackChanges: { list: () => ({ items }) },
        host: {
          scrollTargetIntoView,
          getHandles: () => ({ review, layout: { generation: 1 } }),
        },
      });
      const ui = createSuperDocUI({ superdoc });

      expect(ui.trackChanges.setActive('tc-3')).toBe(true);
      const staleNavigation =
        operation === 'scrollTo' ? ui.trackChanges.scrollTo('tc-1') : ui.trackChanges.navigateNext();
      for (let index = 0; index < 6 && scrollTargetIntoView.mock.calls.length === 0; index += 1)
        await Promise.resolve();
      expect(scrollTargetIntoView).toHaveBeenCalledTimes(1);

      expect(ui.trackChanges.setActive('tc-2')).toBe(true);
      review.clearActiveReviewTarget();
      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');

      resolveScroll?.({ success: true });
      await staleNavigation;

      expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
      expect(activeReviewTarget).toMatchObject({ entityType: 'trackedChange', entityId: 'tc-2' });
    },
  );

  it('scrollTo awaits an async trackChanges.get fallback when the snapshot list does not carry the target', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const get = vi.fn(() => Promise.resolve({ id: 'tc-9', target: items[1].target }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: [{ id: 'tc-9', type: 'delete' }] }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.trackChanges.scrollTo('tc-9');

    expect(result).toEqual({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-9');
    expect(get).toHaveBeenCalledWith({ id: 'tc-9' });
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      { target: items[1].target, block: 'center', behavior: 'auto' },
      expect.any(Function),
    );
  });

  it('scrollTo cannot restore an older panel click after a newer activation', async () => {
    let resolveFirstTarget: ((value: unknown) => void) | null = null;
    const get = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirstTarget = resolve;
        }),
    );
    const firstTarget = items[0].target;
    const secondTarget = items[1].target;
    const rows = [
      { id: 'tc-1', type: 'insert' },
      { id: 'tc-2', type: 'delete', target: secondTarget },
    ];
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items: rows }), get },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.setActive('tc-1')).toBe(true);
    const firstReveal = ui.trackChanges.scrollTo('tc-1');
    for (let index = 0; index < 6 && get.mock.calls.length === 0; index += 1) await Promise.resolve();
    expect(get).toHaveBeenCalledWith({ id: 'tc-1' });

    expect(ui.trackChanges.setActive('tc-2')).toBe(true);
    await expect(ui.trackChanges.scrollTo('tc-2')).resolves.toMatchObject({ ok: true });
    resolveFirstTarget?.({ id: 'tc-1', target: firstTarget });

    await expect(firstReveal).resolves.toEqual({ success: false, ok: false });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
    expect(scrollTargetIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTargetIntoView).toHaveBeenCalledWith(
      {
        target: secondTarget,
        block: 'center',
        behavior: 'auto',
      },
      expect.any(Function),
    );
  });

  it('scrollTo cancels an in-flight host reveal after a newer panel click', async () => {
    type PendingScroll = {
      shouldContinue: (() => boolean) | undefined;
      resolve: (value: unknown) => void;
    };
    const pendingScrolls: PendingScroll[] = [];
    const scrollTargetIntoView = vi.fn(
      (_input: unknown, shouldContinue?: () => boolean) =>
        new Promise((resolve) => {
          pendingScrolls.push({ shouldContinue, resolve });
        }),
    );
    const { superdoc } = makeWorkflowSuperdoc({
      trackChanges: { list: () => ({ items }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });

    const firstReveal = ui.trackChanges.scrollTo('tc-1');
    for (let index = 0; index < 6 && pendingScrolls.length < 1; index += 1) await Promise.resolve();
    expect(pendingScrolls).toHaveLength(1);

    const secondReveal = ui.trackChanges.scrollTo('tc-2');
    for (let index = 0; index < 6 && pendingScrolls.length < 2; index += 1) await Promise.resolve();
    expect(pendingScrolls).toHaveLength(2);
    expect(pendingScrolls[0].shouldContinue?.()).toBe(false);
    expect(pendingScrolls[1].shouldContinue?.()).toBe(true);

    pendingScrolls[0].resolve({ success: false, reason: 'target-not-visible' });
    pendingScrolls[1].resolve({ success: true });

    await expect(firstReveal).resolves.toEqual({ success: false, ok: false });
    await expect(secondReveal).resolves.toMatchObject({ success: true, ok: true });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
  });

  it('scrollTo fails closed with host-capability-unavailable when the host cannot scroll', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.trackChanges.scrollTo('tc-1')).toEqual({
      success: false,
      ok: false,
      reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable,
    });
  });

  it('scrollTo rolls back the active id when the host cannot scroll', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ trackChanges: { list: () => ({ items }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.trackChanges.setActive('tc-2')).toBe(true);

    expect(await ui.trackChanges.scrollTo('tc-1')).toEqual({
      success: false,
      ok: false,
      reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable,
    });
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');
  });
});

describe('public ui — content controls workflow parity (row 738)', () => {
  const ccItems = [
    {
      id: 'cc-1',
      controlType: 'text',
      target: { kind: 'block', nodeType: 'sdt', nodeId: 'n1' },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P1', offset: 5 },
      },
    },
    {
      id: 'cc-2',
      controlType: 'checkbox',
      target: { kind: 'inline', nodeType: 'sdt', nodeId: 'n2' },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P2', offset: 4 },
        end: { kind: 'text', blockId: 'P2', offset: 7 },
      },
    },
  ];

  it('surfaces the control containing the selection anchor', async () => {
    const listInRange = vi.fn(() => ({ items: [ccItems[0]] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }), listInRange },
    });
    const ui = createSuperDocUI({ superdoc });
    const snapshot = ui.contentControls.getSnapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.activeIds).toEqual(['cc-1']);
    expect(snapshot.activeId).toBe('cc-1');
    expect(listInRange).toHaveBeenCalledWith({ startBlockId: 'P1', endBlockId: 'P3' });
  });

  it('surfaces active content-control ids for a collapsed caret selection', async () => {
    const listInRange = vi.fn(() => ({ items: [ccItems[1]] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }), listInRange },
      selectionInfo: {
        empty: true,
        target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 4, end: 4 } }] },
        selectionTarget: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'P2', offset: 4 },
          end: { kind: 'text', blockId: 'P2', offset: 4 },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const snapshot = ui.contentControls.getSnapshot();
    expect(snapshot.activeIds).toEqual(['cc-2']);
    expect(snapshot.activeId).toBe('cc-2');
    expect(listInRange).toHaveBeenCalledWith({ startBlockId: 'P2', endBlockId: 'P2' });
  });

  it('surfaces the active content control when selectionTarget is unavailable', () => {
    const listInRange = vi.fn(() => ({ items: [ccItems[1]] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }), listInRange },
      selectionInfo: {
        empty: true,
        target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 4, end: 4 } }] },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
    });

    const snapshot = createSuperDocUI({ superdoc }).contentControls.getSnapshot();

    expect(snapshot.activeIds).toEqual(['cc-2']);
    expect(snapshot.activeId).toBe('cc-2');
    expect(listInRange).toHaveBeenCalledWith({ startBlockId: 'P2', endBlockId: 'P2' });
  });

  it('compares a tracked live selection to content-control bounds in visible offsets', () => {
    const listInRange = vi.fn(() => ({ items: [ccItems[1]] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }), listInRange },
      selectionInfo: {
        empty: true,
        target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 5, end: 5 } }] },
        selectionTarget: {
          kind: 'selection',
          coordinateSpace: 'tracked',
          start: { kind: 'text', blockId: 'P2', offset: 8 },
          end: { kind: 'text', blockId: 'P2', offset: 8 },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: ['deleted-before-caret'],
        text: '',
      },
    });

    const snapshot = createSuperDocUI({ superdoc }).contentControls.getSnapshot();

    expect(snapshot.activeIds).toEqual(['cc-2']);
    expect(snapshot.activeId).toBe('cc-2');
  });

  it('filters same-paragraph candidates by the exact caret offset', () => {
    const laterControl = {
      ...ccItems[1],
      id: 'cc-3',
      target: { kind: 'inline', nodeType: 'sdt', nodeId: 'n3' },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P2', offset: 10 },
        end: { kind: 'text', blockId: 'P2', offset: 14 },
      },
    };
    const listInRange = vi.fn(() => ({ items: [ccItems[1], laterControl] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: [ccItems[1], laterControl] }), listInRange },
      selectionInfo: {
        empty: true,
        target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 2, end: 2 } }] },
        selectionTarget: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'P2', offset: 2 },
          end: { kind: 'text', blockId: 'P2', offset: 2 },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
    });

    const snapshot = createSuperDocUI({ superdoc }).contentControls.getSnapshot();

    expect(snapshot.activeIds).toEqual([]);
    expect(snapshot.activeId).toBeNull();
  });

  it('excludes multi-block candidates that do not contain the selection start', () => {
    const middleControl = {
      ...ccItems[0],
      id: 'cc-middle',
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P3', offset: 0 },
        end: { kind: 'text', blockId: 'P4', offset: 5 },
      },
    };
    const listInRange = vi.fn(() => ({ items: [middleControl] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: [middleControl] }), listInRange },
      selectionInfo: {
        empty: false,
        target: {
          kind: 'text',
          segments: ['P1', 'P2', 'P3', 'P4', 'P5'].map((blockId) => ({
            blockId,
            range: { start: 0, end: 5 },
          })),
        },
        selectionTarget: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'P1', offset: 0 },
          end: { kind: 'text', blockId: 'P5', offset: 5 },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: 'selected range',
      },
    });

    const snapshot = createSuperDocUI({ superdoc }).contentControls.getSnapshot();

    expect(listInRange).toHaveBeenCalledWith({ startBlockId: 'P1', endBlockId: 'P5' });
    expect(snapshot.activeIds).toEqual([]);
    expect(snapshot.activeId).toBeNull();
  });

  it('orders an exact nested active path innermost first', () => {
    const outer = {
      ...ccItems[0],
      id: 'cc-outer',
      target: { kind: 'block', nodeType: 'sdt', nodeId: 'outer' },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P3', offset: 5 },
      },
    };
    const listInRange = vi.fn(() => ({ items: [outer, ccItems[1]] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: [outer, ccItems[1]] }), listInRange },
      selectionInfo: {
        empty: true,
        target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 5, end: 5 } }] },
        selectionTarget: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'P2', offset: 5 },
          end: { kind: 'text', blockId: 'P2', offset: 5 },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
    });

    const snapshot = createSuperDocUI({ superdoc }).contentControls.getSnapshot();

    expect(snapshot.activeIds).toEqual(['cc-2', 'cc-outer']);
    expect(snapshot.activeId).toBe('cc-2');
  });

  it('keeps active metadata available while the full catalog is pending', () => {
    const listInRange = vi.fn(() => ({ items: [ccItems[1]] }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => new Promise(() => {}), listInRange },
      selectionInfo: {
        empty: true,
        target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 5, end: 5 } }] },
        selectionTarget: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'P2', offset: 5 },
          end: { kind: 'text', blockId: 'P2', offset: 5 },
        },
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
    });

    const snapshot = createSuperDocUI({ superdoc }).contentControls.getSnapshot();

    expect(snapshot.status).toBe('pending');
    expect(snapshot.activeIds).toEqual(['cc-2']);
    expect(snapshot.items.find((item) => item.id === 'cc-2')).toBe(ccItems[1]);
  });

  it('active ids fail closed to empty when listInRange is unavailable', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ contentControls: { list: () => ({ items: ccItems }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.contentControls.getSnapshot().activeIds).toEqual([]);
    expect(ui.contentControls.getSnapshot().activeId).toBeNull();
  });

  it('surfaces loaded content controls in the reactive snapshot', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ contentControls: { list: () => ({ items: ccItems }) } });
    const ui = createSuperDocUI({ superdoc });
    const snapshot = ui.contentControls.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items.find((item) => item.id === 'cc-2')).toMatchObject({ controlType: 'checkbox' });
    expect(ui.contentControls.get()).toBe(snapshot);
    expect(ui.contentControls.get({ id: 'cc-2' })).toMatchObject({ controlType: 'checkbox' });
    expect(ui.contentControls.get({ id: 'missing' })).toBeNull();
  });

  it('getRect routes through host geometry when the control row exposes a selectionTarget', async () => {
    const getTargetRects = vi.fn(() => ({
      success: true,
      rects: [{ pageIndex: 0, left: 1, right: 2, top: 3, bottom: 4, width: 1, height: 1 }],
    }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: { getTargetRects },
    });
    const ui = createSuperDocUI({ superdoc });
    const rect = ui.contentControls.getRect({ id: 'cc-1' });
    expect(rect).toMatchObject({ found: true, rect: { left: 1, top: 3 } });
    expect(getTargetRects).toHaveBeenCalledWith({ target: ccItems[0].selectionTarget });
  });

  it('getRect fails closed (unresolved) for an unknown control', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: { getTargetRects: vi.fn() },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.contentControls.getRect({ id: 'missing' })).toMatchObject({ found: false, reason: 'unresolved' });
  });

  it('getRect fails closed for malformed input', async () => {
    const getTargetRects = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: { getTargetRects },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.contentControls.getRect(undefined as never)).toMatchObject({ found: false, reason: 'unresolved' });
    expect(ui.contentControls.getRect({} as never)).toMatchObject({ found: false, reason: 'unresolved' });
    expect(getTargetRects).not.toHaveBeenCalled();
  });

  it('getRect fails closed when a loaded control has no selectionTarget', async () => {
    const getTargetRects = vi.fn();
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: {
        list: () => ({ items: [{ ...ccItems[0], selectionTarget: null }] }),
      },
      host: { getTargetRects },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.contentControls.getRect({ id: 'cc-1' })).toMatchObject({ found: false, reason: 'unavailable' });
    expect(getTargetRects).not.toHaveBeenCalled();
  });

  it('scrollIntoView routes through host.scrollTargetIntoView when the control row exposes a selectionTarget', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.scrollIntoView({ id: 'cc-2' })).toEqual({ success: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: ccItems[1].selectionTarget,
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('scrollIntoView fails closed for malformed input', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.scrollIntoView(undefined as never)).toEqual({ success: false });
    expect(await ui.contentControls.scrollIntoView({} as never)).toEqual({ success: false });
    expect(scrollTargetIntoView).not.toHaveBeenCalled();
  });

  it('scrollIntoView fails closed when a loaded control has no selectionTarget', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: {
        list: () => ({ items: [{ ...ccItems[1], selectionTarget: null }] }),
      },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.scrollIntoView({ id: 'cc-2' })).toEqual({ success: false });
    expect(scrollTargetIntoView).not.toHaveBeenCalled();
  });

  it('focus places the caret (best-effort) and scrolls the control into view', async () => {
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: { scrollTargetIntoView },
    });
    const ui = createSuperDocUI({ superdoc });
    // No selectionTargets.apply host capability is wired in this mock, so the
    // caret-placement step is a no-op; focus still succeeds via the scroll -
    // matching main's "lock/viewing mode never make it fail" semantics.
    expect(await ui.contentControls.focus({ id: 'cc-2' })).toEqual({ success: true });
    expect(scrollTargetIntoView).toHaveBeenCalledWith({
      target: ccItems[1].selectionTarget,
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('focus scrolls, applies a collapsed caret target, and activates native content-control chrome', async () => {
    const calls: string[] = [];
    const apply = vi.fn(() => {
      calls.push('apply');
      return { ok: true };
    });
    const activate = vi.fn(() => {
      calls.push('activate');
      return { ok: true };
    });
    const scrollTargetIntoView = vi.fn(async () => {
      calls.push('scroll');
      return { success: true };
    });
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: {
        scrollTargetIntoView,
        getHandles: () => ({
          editing: {
            selection: { subscribe: () => () => {} },
            selectionTargets: { apply },
            contentControls: { activate },
          },
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.focus({ id: 'cc-2' })).toEqual({ success: true });
    expect(calls).toEqual(['scroll', 'apply', 'activate']);
    expect(apply).toHaveBeenCalledWith({
      ...ccItems[1].selectionTarget,
      end: ccItems[1].selectionTarget.start,
    });
    expect(activate).toHaveBeenCalledWith({ id: 'cc-2' });
  });

  it('focus fails closed when selection apply still cannot reach the control after scrolling', async () => {
    const apply = vi.fn(() => ({ ok: false, reason: 'target-unresolved' }));
    const scrollTargetIntoView = vi.fn(async () => ({ success: true }));
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: ccItems }) },
      host: {
        scrollTargetIntoView,
        getHandles: () => ({
          editing: {
            selection: { subscribe: () => () => {} },
            selectionTargets: { apply },
          },
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.focus({ id: 'cc-2' })).toEqual({ success: false, reason: 'not-reachable' });
  });

  it('focus fails closed with invalid-id for an empty id', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ contentControls: { list: () => ({ items: ccItems }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.focus({ id: '' })).toEqual({ success: false, reason: 'invalid-id' });
    expect(await ui.contentControls.focus(undefined as never)).toEqual({ success: false, reason: 'invalid-id' });
  });

  it('focus fails closed with not-ready when no editor is mounted', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ noEditor: true });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-ready' });
  });

  it('focus fails closed with not-found for an unknown control', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ contentControls: { list: () => ({ items: ccItems }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.focus({ id: 'missing' })).toEqual({ success: false, reason: 'not-found' });
  });

  it('focus fails closed with not-reachable when the scroll cannot be routed', async () => {
    const { superdoc } = makeWorkflowSuperdoc({ contentControls: { list: () => ({ items: ccItems }) } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.contentControls.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-reachable' });
  });

  it('focus fails closed with not-reachable (not not-found) when a loaded control has no selectionTarget', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      contentControls: { list: () => ({ items: [{ ...ccItems[0], selectionTarget: null }] }) },
    });
    const ui = createSuperDocUI({ superdoc });
    // The control IS found - it just has no resolvable anchor, the same
    // failure family as a routable scroll that fails, not "no such control".
    expect(await ui.contentControls.focus({ id: 'cc-1' })).toEqual({ success: false, reason: 'not-reachable' });
  });
});

describe('public ui — selection.getRects (row 746)', () => {
  it('resolves multi-line selection rects through host geometry', async () => {
    const rects = [
      { pageIndex: 0, left: 1, right: 2, top: 3, bottom: 4, width: 1, height: 1 },
      { pageIndex: 0, left: 5, right: 6, top: 7, bottom: 8, width: 1, height: 1 },
    ];
    const getTargetRects = vi.fn(() => ({ success: true, rects }));
    const { superdoc } = makeWorkflowSuperdoc({ host: { getTargetRects } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.getRects()).toHaveLength(2);
    expect(getTargetRects).toHaveBeenCalledWith({ target: WF_SELECTION_TARGET });
  });

  it('fails closed to [] when the host has no geometry surface', async () => {
    const { superdoc } = makeWorkflowSuperdoc({});
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.getRects()).toEqual([]);
  });

  it('fails closed to [] when the selection is empty', async () => {
    const { superdoc } = makeWorkflowSuperdoc({
      selectionInfo: {
        empty: true,
        target: null,
        activeMarks: [],
        activeCommentIds: [],
        activeChangeIds: [],
        text: '',
      },
      host: { getTargetRects: vi.fn() },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.selection.getRects()).toEqual([]);
  });
});

describe('public ui — custom commands parity (row 741)', () => {
  function makeBareSuperdoc(mode = 'editing') {
    return {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => null },
        },
      },
      config: { documentMode: mode },
      on: vi.fn(),
      off: vi.fn(),
    };
  }

  it('register / has / get / execute / unregister lifecycle', async () => {
    const superdoc = makeBareSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const execute = vi.fn(() => ({ success: true }));
    expect(ui.commands.has('my-cmd')).toBe(false);
    const registration = ui.commands.register({ id: 'my-cmd', execute });
    expect(ui.commands.has('my-cmd')).toBe(true);
    expect(ui.commands.ids).toContain('my-cmd');
    expect(ui.commands.get('my-cmd').getState()).toMatchObject({ supported: true, enabled: true, source: 'custom' });
    expect(await ui.commands.execute('my-cmd', { value: 1 })).toMatchObject({ success: true });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ payload: { value: 1 } }));
    registration.unregister();
    expect(ui.commands.has('my-cmd')).toBe(false);
    expect(ui.commands.get('my-cmd').getState()).toMatchObject({
      supported: false,
      reason: SUPERDOC_UI_REASONS.commandUnsupported,
    });
  });

  it('observe notifies when custom command state changes', async () => {
    const superdoc = makeBareSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    let disabled = true;
    ui.commands.register({
      id: 'toggle-cmd',
      execute: () => true,
      getState: () => ({ disabled, value: disabled ? 'off' : 'on' }),
    });
    const handle = ui.commands.get('toggle-cmd');
    const seen: unknown[] = [];
    const unsubscribe = handle.observe((s) => seen.push(s.value));
    disabled = false;
    await ui.commands.execute('toggle-cmd');
    expect(seen).toContain('on');
    unsubscribe();
  });

  it('getContextMenuItems honors context-dependent visibility and fails closed otherwise', async () => {
    const superdoc = makeBareSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const invoke = vi.fn(() => true);
    ui.commands.register({
      id: 'ctx-cmd',
      execute: invoke,
      contextMenu: { label: 'Do thing', group: 'extras', order: 1, when: (ctx) => !ctx.selection.empty },
    });
    const visibleCtx = {
      point: { x: 0, y: 0 },
      entities: [],
      selection: { ...ui.selection.getSnapshot(), empty: false },
      position: null,
      insideSelection: false,
    };
    const hiddenCtx = { ...visibleCtx, selection: { ...visibleCtx.selection, empty: true } };
    expect(ui.commands.getContextMenuItems(visibleCtx).map((i) => i.id)).toEqual(['ctx-cmd']);
    expect(ui.commands.getContextMenuItems(hiddenCtx)).toEqual([]);
    ui.commands.getContextMenuItems(visibleCtx)[0].invoke();
    expect(invoke).toHaveBeenCalled();
  });
});

describe('public ui — document control parity (row 742)', () => {
  function makeDocControlSuperdoc(opts: { mode?: string; withDoc?: boolean; instance?: Record<string, unknown> } = {}) {
    const doc = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    return {
      activeEditor: { ...(opts.withDoc === false ? {} : { doc }) },
      config: { documentMode: opts.mode ?? 'editing' },
      on: vi.fn(),
      off: vi.fn(),
      ...(opts.instance ?? {}),
    };
  }

  it('setMode routes through superdoc.setDocumentMode', async () => {
    const setDocumentMode = vi.fn();
    const superdoc = makeDocControlSuperdoc({ instance: { setDocumentMode } });
    const ui = createSuperDocUI({ superdoc });
    ui.document.setMode('suggesting');
    expect(setDocumentMode).toHaveBeenCalledWith('suggesting');
  });

  it('tracks local V2 mutations until the current document changes', async () => {
    const hostEventListeners: Array<(event: Record<string, unknown>) => void> = [];
    const instanceEventListeners = new Map<string, (payload?: unknown) => void>();
    const makeHost = () => ({
      events: {
        subscribe: (listener: (event: Record<string, unknown>) => void) => {
          hostEventListeners.push(listener);
          return () => undefined;
        },
      },
    });
    const doc = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    const firstHost = makeHost();
    const exportFn = vi.fn(() => new Blob(['document']));
    const superdoc = {
      activeEditor: { doc, host: firstHost },
      config: { documentMode: 'editing' },
      export: exportFn,
      on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
        instanceEventListeners.set(event, listener);
      }),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    const observedDirtyStates: boolean[] = [];
    const stopObserving = ui.document.observe((documentState) => observedDirtyStates.push(documentState.dirty));

    expect(ui.document.getSnapshot().dirty).toBe(false);

    hostEventListeners.at(-1)?.({
      type: 'collaboration:remote-changed',
      changedStoryIds: ['main:/word/document.xml'],
      changedPartUris: ['/word/document.xml'],
    });
    expect(ui.document.getSnapshot().dirty).toBe(false);

    hostEventListeners.at(-1)?.({ type: 'mutation:committed', editableCommandKind: 'insert-text' });
    expect(ui.document.getSnapshot().dirty).toBe(true);
    expect(observedDirtyStates.at(-1)).toBe(true);

    await ui.document.export({ exportType: ['docx'], triggerDownload: false });
    expect(ui.document.getSnapshot().dirty).toBe(true);

    instanceEventListeners.get('document-replaced')?.({ editor: superdoc.activeEditor, host: firstHost });
    expect(ui.document.getSnapshot().dirty).toBe(false);
    expect(observedDirtyStates.at(-1)).toBe(false);

    hostEventListeners.at(-1)?.({ type: 'mutation:committed' });
    expect(ui.document.getSnapshot().dirty).toBe(true);

    const secondHost = makeHost();
    superdoc.activeEditor = { doc, host: secondHost };
    instanceEventListeners.get('active-editor-change')?.();
    expect(ui.document.getSnapshot().dirty).toBe(false);

    stopObserving();
  });

  it('keeps per-editor dirty state across active-editor switches', () => {
    const listenersByHost = new Map<object, (event: Record<string, unknown>) => void>();
    const instanceEventListeners = new Map<string, (payload?: unknown) => void>();
    const makeHost = () => {
      const host = {
        events: {
          subscribe: (listener: (event: Record<string, unknown>) => void) => {
            listenersByHost.set(host, listener);
            return () => undefined;
          },
        },
      };
      return host;
    };
    const doc = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    const hostA = makeHost();
    const hostB = makeHost();
    const editorA = { doc, host: hostA };
    const editorB = { doc, host: hostB };
    const superdoc = {
      activeEditor: editorA as { doc: typeof doc; host: object },
      config: { documentMode: 'editing' },
      on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
        instanceEventListeners.set(event, listener);
      }),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.document.getSnapshot().dirty).toBe(false);

    listenersByHost.get(hostA)?.({ type: 'document:mutated', source: 'input', revision: 1 });
    expect(ui.document.getSnapshot().dirty).toBe(true);

    superdoc.activeEditor = editorB;
    instanceEventListeners.get('active-editor-change')?.();
    expect(ui.document.getSnapshot().dirty).toBe(false);

    superdoc.activeEditor = editorA;
    instanceEventListeners.get('active-editor-change')?.();
    expect(ui.document.getSnapshot().dirty).toBe(true);

    // Exporting bytes is not persistence: the host's save event leaves A dirty.
    listenersByHost.get(hostA)?.({ type: 'save:completed', saveId: 's1', byteLength: 10 });
    expect(ui.document.getSnapshot().dirty).toBe(true);
  });

  it.each([
    { initialRevision: 0, inactiveRevision: 1, readFails: false, expectedDirty: true },
    { initialRevision: 1, inactiveRevision: 0, readFails: false, expectedDirty: false },
    { initialRevision: 1, inactiveRevision: 0, readFails: true, expectedDirty: true },
  ])(
    'reconciles an inactive editor revision from $initialRevision to $inactiveRevision (readFails: $readFails)',
    ({ initialRevision, inactiveRevision, readFails, expectedDirty }) => {
      const instanceListeners = new Map<string, () => void>();
      const makeHost = () => ({
        revision: 0,
        getLocalMutationRevision() {
          return this.revision;
        },
        events: { subscribe: vi.fn(() => vi.fn()) },
      });
      const doc = {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => null },
      };
      const editorA = { doc, host: makeHost() };
      const editorB = { doc, host: makeHost() };
      editorA.host.revision = initialRevision;
      const superdoc = {
        activeEditor: editorA,
        config: { documentMode: 'editing' },
        on: vi.fn((name: string, listener: () => void) => instanceListeners.set(name, listener)),
        off: vi.fn(),
      };
      const ui = createSuperDocUI({ superdoc });
      expect(ui.document.getSnapshot().dirty).toBe(initialRevision > 0);
      superdoc.activeEditor = editorB;
      instanceListeners.get('active-editor-change')?.();
      expect(editorA.host.events.subscribe.mock.results[0].value).toHaveBeenCalled();
      editorA.host.revision = inactiveRevision;
      if (readFails) {
        vi.spyOn(editorA.host, 'getLocalMutationRevision').mockImplementation(() => {
          throw new Error('Revision unavailable');
        });
      }
      expect(ui.document.getSnapshot().dirty).toBe(false);
      superdoc.activeEditor = editorA;
      instanceListeners.get('active-editor-change')?.();
      expect(ui.document.getSnapshot().dirty).toBe(expectedDirty);
    },
  );

  it('clears dirty state when the host replaces the document from collaboration', () => {
    const hostEventListeners: Array<(event: Record<string, unknown>) => void> = [];
    const doc = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    let revision = 0;
    const host = {
      getLocalMutationRevision: () => revision,
      events: {
        subscribe: (listener: (event: Record<string, unknown>) => void) => {
          hostEventListeners.push(listener);
          return () => undefined;
        },
      },
    };
    const ui = createSuperDocUI({
      superdoc: { activeEditor: { doc, host }, config: { documentMode: 'editing' }, on: vi.fn(), off: vi.fn() },
    });
    revision = 1;
    hostEventListeners.at(-1)?.({ type: 'document:mutated', source: 'input', revision });
    expect(ui.document.getSnapshot().dirty).toBe(true);

    // The host reopened the remote document and reset its revision.
    revision = 0;
    hostEventListeners.at(-1)?.({
      type: 'collaboration:document-replaced',
      previousSource: { kind: 'remote' },
      source: { kind: 'remote' },
    });
    expect(ui.document.getSnapshot().dirty).toBe(false);
  });

  it('seeds dirty state from a host that was edited before the controller existed', () => {
    const doc = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    const host = {
      getLocalMutationRevision: vi.fn(() => 3),
      events: { subscribe: () => () => undefined },
    };
    const superdoc = {
      activeEditor: { doc, host },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.document.getSnapshot().dirty).toBe(true);
    expect(host.getLocalMutationRevision).toHaveBeenCalled();
  });

  it('marks non-receipt document mutations dirty through document:mutated', () => {
    const hostEventListeners: Array<(event: Record<string, unknown>) => void> = [];
    const doc = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: { current: () => null },
    };
    const host = {
      getLocalMutationRevision: () => 0,
      events: {
        subscribe: (listener: (event: Record<string, unknown>) => void) => {
          hostEventListeners.push(listener);
          return () => undefined;
        },
      },
    };
    const ui = createSuperDocUI({
      superdoc: { activeEditor: { doc, host }, config: { documentMode: 'editing' }, on: vi.fn(), off: vi.fn() },
    });
    expect(ui.document.getSnapshot().dirty).toBe(false);
    // A `create.table` result never emits `mutation:committed`; the dedicated
    // signal is the only thing that fires.
    hostEventListeners.at(-1)?.({ type: 'document:mutated', source: 'facade', revision: 1 });
    expect(ui.document.getSnapshot().dirty).toBe(true);
  });

  it('leaves the document clean for previews and no-op committed mutations', () => {
    const mountUi = () => {
      const hostEventListeners: Array<(event: Record<string, unknown>) => void> = [];
      const doc = {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => null },
      };
      const host = {
        getLocalMutationRevision: () => 0,
        events: {
          subscribe: (listener: (event: Record<string, unknown>) => void) => {
            hostEventListeners.push(listener);
            return () => undefined;
          },
        },
      };
      const ui = createSuperDocUI({
        superdoc: { activeEditor: { doc, host }, config: { documentMode: 'editing' }, on: vi.fn(), off: vi.fn() },
      });
      return { ui, emit: (event: Record<string, unknown>) => hostEventListeners.at(-1)?.(event) };
    };

    // A dry-run preview emits `mutation:committed` with `dryRun: true`.
    const preview = mountUi();
    preview.emit({ type: 'mutation:committed', origin: 'command', dryRun: true, receipt: { success: true } });
    expect(preview.ui.document.getSnapshot().dirty).toBe(false);

    // Applying a list a range already has commits a synthetic `changed: false`
    // receipt: the toolbar sees success, but no document bytes changed.
    const noop = mountUi();
    noop.emit({ type: 'mutation:committed', origin: 'command', receipt: { success: true, changed: false } });
    expect(noop.ui.document.getSnapshot().dirty).toBe(false);

    const statusNoop = mountUi();
    statusNoop.emit({ type: 'mutation:committed', origin: 'command', receipt: { success: true, status: 'NO_OP' } });
    expect(statusNoop.ui.document.getSnapshot().dirty).toBe(false);

    const typedNoop = mountUi();
    typedNoop.emit({ type: 'mutation:committed', origin: 'command', receipt: { success: true, noop: true } });
    expect(typedNoop.ui.document.getSnapshot().dirty).toBe(false);

    // A real committed mutation still marks the document dirty.
    const edit = mountUi();
    edit.emit({ type: 'mutation:committed', origin: 'command', receipt: { success: true } });
    expect(edit.ui.document.getSnapshot().dirty).toBe(true);
  });

  it('preserves an editor-provided dirty state', () => {
    const superdoc = makeDocControlSuperdoc();
    Object.assign(superdoc.activeEditor, { isDirty: true });

    const ui = createSuperDocUI({ superdoc });

    expect(ui.document.getSnapshot().dirty).toBe(true);
  });

  it('export resolves through superdoc.export', async () => {
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const params = { exportType: ['docx'], triggerDownload: false } as const;
    const exportFn = vi.fn(() => blob);
    const superdoc = makeDocControlSuperdoc({ instance: { export: exportFn } });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.document.export(params);

    expect(result).toBe(blob);
    expect(result).toBeInstanceOf(Blob);
    expect(result?.size).toBe(4);
    expect(result?.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(exportFn).toHaveBeenCalledOnce();
    expect(exportFn).toHaveBeenCalledWith(params);
  });

  it('replaceFile routes through the host replaceFile/loadDocument capability', async () => {
    const replaceFile = vi.fn(() => Promise.resolve());
    const superdoc = makeDocControlSuperdoc({ instance: { replaceFile } });
    const ui = createSuperDocUI({ superdoc });
    const file = new Blob(['x']);
    void ui.document.replaceFile(file);
    expect(replaceFile).toHaveBeenCalledWith(file);

    const bytes = new Uint8Array([1, 2, 3]);
    void ui.document.replaceFile(bytes);
    expect(replaceFile).toHaveBeenCalledWith(bytes);
  });

  it('export / replaceFile fail closed (undefined) when unavailable', async () => {
    const superdoc = makeDocControlSuperdoc({ withDoc: false });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.document.export()).toBeUndefined();
    expect(ui.document.replaceFile(new Blob(['x']))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Plan B command catalog (Workstream 9, row 747): the descriptor catalog is the
// single source of truth for built-in command ids, aliases, routes, mutation
// policy, payload normalization, and deferred/unsupported reasons. Every v1
// headless-toolbar id has an explicit, fail-closed state.
// ---------------------------------------------------------------------------

describe('public ui — Plan B command catalog (row 747)', () => {
  // The 43 v1 headless-toolbar built-in command ids.
  const V1_HEADLESS_TOOLBAR_IDS = [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'font-size',
    'font-family',
    'text-color',
    'highlight-color',
    'link',
    'text-align',
    'line-height',
    'linked-style',
    'bullet-list',
    'numbered-list',
    'indent-increase',
    'indent-decrease',
    'direction-ltr',
    'direction-rtl',
    'undo',
    'redo',
    'ruler',
    'formatting-marks',
    'zoom',
    'zoom-fit-width',
    'document-mode',
    'clear-formatting',
    'copy-format',
    'track-changes-accept-selection',
    'track-changes-reject-selection',
    'image',
    'table-of-contents-insert',
    'table-insert',
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
    'table-fix',
  ];

  function makeCatalogSuperdoc(
    opts: {
      doc?: Record<string, unknown>;
      host?: Record<string, unknown>;
      mode?: string;
      instance?: Record<string, unknown>;
    } = {},
  ) {
    const doc = opts.doc ?? {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }), decide: vi.fn(() => ({ success: true })) },
      selection: { current: () => null },
      format: {
        bold: vi.fn(),
        italic: vi.fn(),
        underline: vi.fn(),
        strikethrough: vi.fn(),
        fontFamily: vi.fn(),
        fontSize: vi.fn(),
      },
      history: { undo: vi.fn(), redo: vi.fn() },
    };
    return {
      activeEditor: { doc, ...(opts.host ? { host: opts.host } : {}) },
      config: { documentMode: opts.mode ?? 'editing' },
      on: vi.fn(),
      off: vi.fn(),
      ...(opts.instance ?? {}),
    };
  }

  it('exposes exactly one descriptor per id (no duplicates)', async () => {
    const ids = COMMAND_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_BUILT_IN_COMMAND_IDS).toEqual(ids);
  });

  it('gives every v1 headless-toolbar id an explicit, fail-closed state', async () => {
    const superdoc = makeCatalogSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    for (const id of V1_HEADLESS_TOOLBAR_IDS) {
      const state = ui.commands.get(id).getState();
      expect(ui.commands.has(id)).toBe(true);
      // Either routed-and-enabled, or disabled with a stable reason — never opaque.
      const ok = state.enabled === true || typeof state.reason === 'string';
      expect(ok, `command ${id} must be routed or carry a reason`).toBe(true);
      if (!state.enabled) {
        // A disabled command never mutates.
        expect(await ui.commands.execute(id)).toBe(false);
      }
    }
  });

  it('surfaces all v1 ids visibly in the toolbar snapshot and commands.ids', async () => {
    const superdoc = makeCatalogSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.ids).toContain('text-align');
    expect(ui.commands.ids).toContain('table-insert');
    const snapshot = ui.toolbar.getSnapshot();
    // Table cell-context commands surface visibly with the precise context-facade
    // gap reason (the catalog produces no generic command-deferred reason).
    expect(snapshot.commands['table-delete-row']).toMatchObject({
      disabled: true,
      reason: SUPERDOC_UI_REASONS.tableContextUnavailable,
    });
  });

  it('routes kebab track-change aliases to the same behavior as the v2-native ids', async () => {
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = makeDocSuperdocForCatalog(decide);
    const ui = createSuperDocUI({ superdoc });
    // Alias enabled exactly like acceptChange (an active change is selected).
    expect(ui.commands.get('track-changes-accept-selection').getState()).toMatchObject({
      enabled: true,
      supported: true,
    });
    expect(await ui.toolbar.execute('track-changes-accept-selection')).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'id', id: 'tc-1' } });
    decide.mockClear();
    expect(await ui.toolbar.execute('track-changes-reject-selection')).toEqual({ success: true });
    expect(decide).toHaveBeenCalledWith({ decision: 'reject', target: { kind: 'id', id: 'tc-1' } });
  });

  function makeDocSuperdocForCatalog(decide: ReturnType<typeof vi.fn>) {
    return {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: false,
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: ['tc-1'],
              text: '',
            }),
          },
          trackChanges: { list: () => ({ items: [{ id: 'tc-1', type: 'insert' }] }), decide },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
  }

  it('normalizes "12pt" font sizes to a numeric value on the format.fontSize route', async () => {
    const fontSize = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { fontSize },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    // "12pt" → numeric 12, passed with the resolved selection target.
    await ui.toolbar.execute('font-size', '12pt');
    expect(fontSize).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: 12 }, { offsetSpace: 'selection' });
    fontSize.mockClear();
    await ui.toolbar.execute('setFontSize', '14 PT');
    expect(fontSize).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: 14 }, { offsetSpace: 'selection' });
    fontSize.mockClear();
    await ui.toolbar.execute('font-size', '16');
    expect(fontSize).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: 16 }, { offsetSpace: 'selection' });
  });

  it('routes text-color / highlight-color through inline format ops with a normalized color and selection target', async () => {
    const color = vi.fn(() => ({ success: true }));
    const highlight = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { color, highlight },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-color').getState()).toMatchObject({ enabled: true, supported: true });
    // Bare 6-hex normalizes to #RRGGBB.
    expect(await ui.toolbar.execute('text-color', 'ff0000')).toEqual({ success: true });
    expect(color).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: '#ff0000' }, { offsetSpace: 'selection' });
    expect(await ui.toolbar.execute('highlight-color', '#00FF00')).toEqual({ success: true });
    expect(highlight).toHaveBeenCalledWith(
      { target: SELECTION_TARGET, value: '#00FF00' },
      { offsetSpace: 'selection' },
    );
  });

  it('publishes an optimistic inline value only after an async mutation settles successfully', async () => {
    // The synchronous-capture branch is gone (SD-3706 §5): a sync result relies
    // on the authoritative post-settlement re-read, and promise-backed results
    // publish the optimistic value only when the receipt resolves successfully.
    let selectionInfo: any = SELECTION_INFO;
    let notifySelection = () => {};
    const highlight = vi.fn(() => Promise.resolve({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      host: {
        getHandles: () => ({
          editing: {
            selection: {
              subscribe: (listener: () => void) => {
                notifySelection = listener;
                return () => {
                  notifySelection = () => {};
                };
              },
            },
          },
        }),
      },
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => selectionInfo },
        format: { highlight },
        query: { match: vi.fn(() => ({ items: [] })) },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('highlight-color').getState().value).toBeUndefined();
    await ui.toolbar.execute('highlight-color', '#ECCF35');
    expect(highlight).toHaveBeenCalledWith(
      { target: SELECTION_TARGET, value: '#ECCF35' },
      { offsetSpace: 'selection' },
    );
    await vi.waitFor(() => {
      expect(ui.commands.get('highlight-color').getState().value).toBe('#ECCF35');
    });

    selectionInfo = {
      ...SELECTION_INFO,
      target: { kind: 'text', segments: [{ blockId: 'P2', range: { start: 0, end: 4 } }] },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P2', offset: 0 },
        end: { kind: 'text', blockId: 'P2', offset: 4 },
      },
      text: 'next',
    };
    notifySelection();

    expect(ui.commands.get('highlight-color').getState().value).toBeUndefined();
  });

  it('does not publish an optimistic inline value when the async mutation fails', async () => {
    const highlight = vi.fn(() =>
      Promise.resolve({ success: false, failure: { code: 'NO_OP', message: 'no change' } }),
    );
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { highlight },
        query: { match: vi.fn(() => ({ items: [] })) },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('highlight-color', '#ECCF35');
    await Promise.resolve();
    await Promise.resolve();
    expect(highlight).toHaveBeenCalled();
    expect(ui.commands.get('highlight-color').getState().value).toBeUndefined();
  });

  it('routes clear-formatting through format.apply with a null inline patch on the selection', async () => {
    const apply = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { apply },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('clear-formatting').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.execute('clear-formatting')).toEqual({ success: true });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        target: SELECTION_TARGET,
        inline: expect.objectContaining({
          bold: null,
          italic: null,
          color: null,
          highlight: null,
          vertAlign: null,
          smallCaps: null,
          caps: null,
          letterSpacing: null,
          dstrike: null,
        }),
      }),
      { offsetSpace: 'selection' },
    );
  });

  it.each(['contentLocked', 'sdtContentLocked'] as const)(
    'clear-formatting is disabled and performs no mutations for %s content',
    async (lockMode) => {
      const apply = vi.fn(() => ({ success: true }));
      const resetDirectFormatting = vi.fn(() => ({ success: true }));
      const remove = vi.fn(() => ({ success: true }));
      const setStyleRef = vi.fn(() => ({ success: true }));
      const superdoc = makeCatalogSuperdoc({
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          contentControls: {
            listInRange: () => ({ items: [{ id: 'locked-control', lockMode }] }),
          },
          format: { apply, paragraph: { resetDirectFormatting } },
          lists: { remove },
          styles: { paragraph: { setStyleRef } },
        },
      });
      const ui = createSuperDocUI({ superdoc });

      expect(ui.commands.get('clear-formatting').getState()).toMatchObject({
        enabled: false,
        supported: true,
        reason: SUPERDOC_UI_REASONS.contentControlLocked,
      });
      expect(await ui.toolbar.execute('clear-formatting')).toBe(false);
      expect(apply).not.toHaveBeenCalled();
      expect(resetDirectFormatting).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(setStyleRef).not.toHaveBeenCalled();
    },
  );

  it('routes clear-formatting as one tracked selection mutation in suggesting mode', async () => {
    const apply = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      mode: 'suggesting',
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { apply },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('clear-formatting')).toEqual({ success: true });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ target: SELECTION_TARGET }), {
      changeMode: 'tracked',
      offsetSpace: 'selection',
    });
  });

  it('runs block reset and setMarkRunProps at caret in direct mode (Option E)', async () => {
    const resetDirectFormatting = vi.fn(() => ({ success: true }));
    const setMarkRunProps = vi.fn(() => ({ success: true }));
    const CARET_INFO = {
      empty: true,
      target: { kind: 'text', segments: [{ blockId: 'P1' }] },
      selectionTarget: null,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
    const formatApply = vi.fn(() => ({ success: true }));
    const setStyleRef = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => CARET_INFO },
        format: { apply: formatApply, paragraph: { resetDirectFormatting, setMarkRunProps } },
        lists: { remove: vi.fn(() => ({ success: true })) },
        styles: { paragraph: { setStyleRef } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('clear-formatting').getState()).toMatchObject({ enabled: true, supported: true });
    await ui.toolbar.execute('clear-formatting');
    // Inline patch is skipped at caret — adjacent run props are untouched.
    expect(formatApply).not.toHaveBeenCalled();
    // setStyleRef is called at caret — it changes only pStyle without clearing runs.
    expect(setStyleRef).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ nodeId: 'P1' }), styleId: 'Normal' }),
    );
    expect(resetDirectFormatting).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ nodeId: 'P1' }) }),
    );
    expect(setMarkRunProps).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ nodeId: 'P1' }),
        markRunProps: expect.objectContaining({ bold: false, italic: false, smallCaps: false, caps: false }),
      }),
    );
  });

  it('preserves the header/footer story on clear-formatting paragraph targets', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const resetDirectFormatting = vi.fn(() => ({ success: true }));
    const setMarkRunProps = vi.fn(() => ({ success: true }));
    const listsRemove = vi.fn(() => ({ success: true }));
    const listsRemoveInStory = vi.fn(() => ({ success: true }));
    const setStyleRef = vi.fn(() => ({ success: true }));
    const selectionInfo = {
      empty: true,
      target: { kind: 'text', segments: [{ blockId: 'P1' }], story },
      selectionTarget: null,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => selectionInfo },
        format: { paragraph: { resetDirectFormatting, setMarkRunProps } },
        lists: { remove: listsRemove, removeInStory: listsRemoveInStory },
        styles: { paragraph: { setStyleRef } },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    await ui.toolbar.execute('clear-formatting');

    const target = { kind: 'block', nodeType: 'paragraph', nodeId: 'P1', story };
    expect(resetDirectFormatting).toHaveBeenCalledWith({ target });
    expect(listsRemoveInStory).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      story,
    });
    expect(listsRemove).not.toHaveBeenCalled();
    expect(setStyleRef).toHaveBeenCalledWith({ target, styleId: 'Normal' });
    expect(setMarkRunProps).toHaveBeenCalledWith(expect.objectContaining({ target }));
  });

  it('skips setMarkRunProps at caret in suggesting mode but still runs block reset', async () => {
    const resetDirectFormatting = vi.fn(() => ({ success: true }));
    const setMarkRunProps = vi.fn(() => ({ success: true }));
    const CARET_INFO = {
      empty: true,
      target: { kind: 'text', segments: [{ blockId: 'P1' }] },
      selectionTarget: null,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
    const setStyleRef = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      mode: 'suggesting',
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => CARET_INFO },
        format: { paragraph: { resetDirectFormatting, setMarkRunProps } },
        lists: { remove: vi.fn(() => ({ success: true })) },
        styles: { paragraph: { setStyleRef } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('clear-formatting');
    expect(resetDirectFormatting).toHaveBeenCalled();
    expect(setStyleRef).toHaveBeenCalled();
    expect(setMarkRunProps).not.toHaveBeenCalled();
  });

  it('runs resetDirectFormatting on covered blocks for a range selection', async () => {
    const resetDirectFormatting = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { apply: vi.fn(() => ({ success: true })), paragraph: { resetDirectFormatting } },
        lists: { remove: vi.fn(() => ({ success: true })) },
        styles: { paragraph: { setStyleRef: vi.fn(() => ({ success: true })) } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('clear-formatting');
    expect(resetDirectFormatting).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ nodeId: 'P1' }) }),
    );
  });

  it('runs lists.remove on covered blocks for a range selection', async () => {
    const listsRemove = vi.fn(() => ({ success: true }));
    const listsRemoveInStory = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: {
          apply: vi.fn(() => ({ success: true })),
          paragraph: { resetDirectFormatting: vi.fn(() => ({ success: true })) },
        },
        lists: { remove: listsRemove, removeInStory: listsRemoveInStory },
        styles: { paragraph: { setStyleRef: vi.fn(() => ({ success: true })) } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('clear-formatting');
    expect(listsRemove).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
    });
    expect(listsRemoveInStory).not.toHaveBeenCalled();
  });

  it('runs styles.paragraph.setStyleRef with the default style id for a range selection', async () => {
    const setStyleRef = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: {
          apply: vi.fn(() => ({ success: true })),
          paragraph: { resetDirectFormatting: vi.fn(() => ({ success: true })) },
        },
        lists: { remove: vi.fn(() => ({ success: true })) },
        styles: { paragraph: { setStyleRef } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('clear-formatting');
    expect(setStyleRef).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ nodeId: 'P1' }),
        styleId: 'Normal',
      }),
    );
  });

  it('resolves as success when lists.remove rejects on a non-list paragraph (sync)', async () => {
    // The v2 kernel rejects listRemove with 'list-not-a-list-item' for ordinary paragraphs.
    // The settled result must not propagate that failure — execute() should still resolve truthy.
    const listsRemove = vi.fn(() => ({ success: false, code: 'list-not-a-list-item' }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: {
          apply: vi.fn(() => ({ success: true })),
          paragraph: { resetDirectFormatting: vi.fn(() => ({ success: true })) },
        },
        lists: { remove: listsRemove },
        styles: { paragraph: { setStyleRef: vi.fn(() => ({ success: true })) } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.toolbar.execute('clear-formatting');
    expect(listsRemove).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  it('resolves as success when lists.remove rejects on a non-list paragraph (async/worker-backed)', async () => {
    // Promise-backed implementations set r.immediate = true regardless of outcome, so the
    // filter must happen at the settled level, not the immediate level.
    const listsRemove = vi.fn(() => Promise.resolve({ success: false, code: 'list-not-a-list-item' }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: {
          apply: vi.fn(() => ({ success: true })),
          paragraph: { resetDirectFormatting: vi.fn(() => ({ success: true })) },
        },
        lists: { remove: listsRemove },
        styles: { paragraph: { setStyleRef: vi.fn(() => ({ success: true })) } },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.toolbar.execute('clear-formatting');
    expect(listsRemove).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  it('toggles inline marks based on live active state (value = !active)', async () => {
    const bold = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => ({ ...SELECTION_INFO, activeMarks: ['bold'] }) },
        format: { bold },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    // Bold already active at the selection → toggling sends value: false.
    expect(ui.commands.get('bold').getState()).toMatchObject({ enabled: true, active: true });
    await ui.toolbar.execute('bold');
    expect(bold).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: false }, { offsetSpace: 'selection' });
  });

  // --- Style-cascade-aware toggle-mark active state (SD-3860) --------------

  it('shows the bold button active for style-inherited bold with no direct rPr (SD-3860)', async () => {
    // No `activeMarks` on the raw selection (no direct <w:b/>), but the
    // mounted projection's run.bold is the cascade-resolved effective value
    // (e.g. inherited from a Heading style) - the button must still light up.
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [{ kind: 'text', text: 'hello', bold: true }],
        },
      ],
    };
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { bold: vi.fn() },
      },
      host,
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bold').getState()).toMatchObject({ enabled: true, active: true });
  });

  it('a single click removes style-inherited bold instead of writing a redundant direct override (SD-3860)', async () => {
    // Reproduces the double-click bug: without cascade awareness, the first
    // click would see active=false (no direct mark) and send value: true (a
    // visual no-op, since the style already made it bold) - only a SECOND
    // click would actually turn it off. The fix must send value: false on the
    // very first click.
    const bold = vi.fn(() => ({ success: true }));
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [{ kind: 'text', text: 'hello', bold: true }],
        },
      ],
    };
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { bold },
      },
      host,
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bold').getState()).toMatchObject({ enabled: true, active: true });
    await ui.toolbar.execute('bold');
    expect(bold).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: false }, { offsetSpace: 'selection' });
  });

  it('keeps effective bold aligned after painted tracked deletions before the selection', async () => {
    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'P1', offset: 7 },
      end: { kind: 'text' as const, blockId: 'P1', offset: 13 },
    };
    const selection = {
      ...SELECTION_INFO,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 7, end: 13 } }] },
      selectionTarget: target,
      text: 'target',
    };
    const bold = vi.fn(() => ({ success: true }));
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          id: 'P1',
          runs: [
            { kind: 'text', text: 'before ' },
            { kind: 'text', text: 'deleted ', trackedChange: { kind: 'delete' } },
            { kind: 'text', text: 'target', bold: true },
          ],
        },
      ],
    };
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => selection },
        format: { bold },
      },
      host,
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('bold').getState().active).toBe(true);
    await ui.toolbar.execute('bold');
    expect(bold).toHaveBeenCalledWith({ target, value: false }, { offsetSpace: 'selection' });
  });

  it('falls back to the worker-side effective read for style-inherited bold when the mounted projection is unavailable (SD-3860)', async () => {
    const readEffectiveInlineUniformity = vi.fn(() => ({
      success: true,
      values: { bold: { state: 'uniform', value: 'true' } },
    }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { bold: vi.fn(), readEffectiveInlineUniformity },
      },
      // No host at all: the mounted-projection read has no source to consult
      // and must fall through to the worker uniformity read.
    });
    const ui = createSuperDocUI({ superdoc });
    ui.commands.get('bold').getState();
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.commands.get('bold').getState().active).toBe(true);
    expect(readEffectiveInlineUniformity).toHaveBeenCalledWith(
      expect.objectContaining({ target: SELECTION_TARGET, offsetSpace: 'selection' }),
    );
  });

  it('does not show italic active for a selection that is only effectively bold (distinct mark keys stay independent)', async () => {
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [{ kind: 'text', text: 'hello', bold: true }],
        },
      ],
    };
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { bold: vi.fn(), italic: vi.fn() },
      },
      host,
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bold').getState().active).toBe(true);
    expect(ui.commands.get('italic').getState().active).toBe(false);
  });

  it('a just-typed pending-mark toggle still wins over the effective (cascade-resolved) mark check (SD-3654 regression)', async () => {
    // The pending store is only ever set for a genuine collapsed-caret toggle
    // and must stay authoritative regardless of what the mounted projection's
    // effectively-resolved bold says (here: effectively bold from the style).
    const caretPoint = { kind: 'text', blockId: 'P1', offset: 1 };
    const caretTarget = { kind: 'selection', start: caretPoint, end: caretPoint };
    const caretSelection = {
      empty: true,
      target: caretTarget,
      selectionTarget: caretTarget,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
    const host = {
      getPendingInlineFormat: () => ({ bold: false }),
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          id: 'P1',
          runs: [{ kind: 'text', text: 'x', bold: true }],
        },
      ],
    };
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => caretSelection },
        format: { bold: vi.fn() },
      },
      host,
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bold').getState().active).toBe(false);
  });

  it('keeps document paint at most one mutation behind a rapid inline-toggle burst (SD-3788)', async () => {
    const paintResolvers: Array<() => void> = [];
    const bold = vi.fn(() => ({ success: true, txId: `tx-${paintResolvers.length + 1}` }));
    const superdoc = {
      activeEditor: {
        documentMutationReadiness: {
          whenPainted: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                paintResolvers.push(resolve);
              }),
          ),
        },
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    ui.commands.execute('bold');
    expect(ui.commands.get('bold').getState().active).toBe(true);

    Array.from({ length: 20 }, () => ui.commands.execute('bold'));
    expect(bold).toHaveBeenCalledTimes(1);
    expect(ui.commands.get('bold').getState().active).toBe(true);

    paintResolvers[0]?.();
    await vi.waitFor(() => expect(bold).toHaveBeenCalledTimes(2));

    expect(bold).toHaveBeenNthCalledWith(1, { target: SELECTION_TARGET, value: true }, { offsetSpace: 'selection' });
    expect(bold).toHaveBeenNthCalledWith(2, { target: SELECTION_TARGET, value: true }, { offsetSpace: 'selection' });
    expect(ui.commands.get('bold').getState().active).toBe(true);

    paintResolvers.slice(1).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect(bold).toHaveBeenCalledTimes(2);
    ui.destroy();
  });

  it('compacts alternating inline-toggle bursts per command and selection (SD-3788)', async () => {
    const paintResolvers: Array<() => void> = [];
    let mutationCount = 0;
    const makeMutation = () => ({ success: true, txId: `tx-${++mutationCount}` });
    const bold = vi.fn(makeMutation);
    const italic = vi.fn(makeMutation);
    const superdoc = {
      activeEditor: {
        documentMutationReadiness: {
          whenPainted: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                paintResolvers.push(resolve);
              }),
          ),
        },
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold, italic },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    ui.commands.execute('bold');
    for (let index = 0; index < 20; index += 1) {
      ui.commands.execute(index % 2 === 0 ? 'italic' : 'bold');
    }
    expect(bold.mock.calls.length + italic.mock.calls.length).toBe(1);

    paintResolvers[0]?.();
    await vi.waitFor(() => expect(bold.mock.calls.length + italic.mock.calls.length).toBe(2));
    paintResolvers[1]?.();
    await vi.waitFor(() => expect(bold.mock.calls.length + italic.mock.calls.length).toBe(3));
    paintResolvers[2]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(bold).toHaveBeenCalledTimes(2);
    expect(italic).toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it('cancels a queued inline toggle when the document mode changes before execution (SD-3788)', async () => {
    let releasePaint = () => undefined;
    const bold = vi.fn(() => ({ success: true, txId: `tx-${bold.mock.calls.length}` }));
    const superdoc = {
      activeEditor: {
        documentMutationReadiness: {
          whenPainted: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releasePaint = resolve;
              }),
          ),
        },
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' as string },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    ui.commands.execute('bold');
    const queued = ui.commands.executeAsync('bold');
    superdoc.config.documentMode = 'viewing';
    releasePaint();

    await expect(queued).resolves.toBe(false);
    expect(bold).toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it('rolls back an optimistic inline toggle when the worker mutation fails (SD-3788)', async () => {
    let resolveBold: ((receipt: { success: false }) => void) | null = null;
    const bold = vi.fn(
      () =>
        new Promise<{ success: false }>((resolve) => {
          resolveBold = resolve;
        }),
    );
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { bold },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.executeAsync('bold');
    expect(ui.commands.get('bold').getState().active).toBe(true);

    resolveBold?.({ success: false });
    await expect(pending).resolves.toEqual({ success: false });
    expect(ui.commands.get('bold').getState().active).toBe(false);
  });

  it('honors explicit boolean/null payloads for inline mark commands', async () => {
    const bold = vi.fn(() => ({ success: true }));
    const superdoc = makeCatalogSuperdoc({
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => SELECTION_INFO },
        format: { bold },
      },
    });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('bold', false);
    expect(bold).toHaveBeenLastCalledWith({ target: SELECTION_TARGET, value: false }, { offsetSpace: 'selection' });
    await ui.toolbar.execute('bold', { value: true });
    expect(bold).toHaveBeenLastCalledWith({ target: SELECTION_TARGET, value: true }, { offsetSpace: 'selection' });
    await ui.toolbar.execute('bold', { value: null });
    expect(bold).toHaveBeenLastCalledWith({ target: SELECTION_TARGET, value: null }, { offsetSpace: 'selection' });
  });

  it('execute returns the immediate receipt for a sync operation even when paint settlement is pending', async () => {
    let releasePaint: (() => void) | null = null;
    const whenPainted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePaint = resolve;
        }),
    );
    const receipt = { success: true, txId: 'tx-sync' };
    const bold = vi.fn(() => receipt);
    const superdoc = {
      activeEditor: {
        documentMutationReadiness: { whenPainted },
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.execute('bold')).toBe(receipt);
    expect(whenPainted).toHaveBeenCalledWith({ txId: 'tx-sync' });
    releasePaint?.();
  });

  it('executeAsync resolves the committed receipt after mutation readiness for a sync operation', async () => {
    let releasePaint: (() => void) | null = null;
    const whenPainted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePaint = resolve;
        }),
    );
    const receipt = { success: true, txId: 'tx-sync' };
    const bold = vi.fn(() => receipt);
    const superdoc = {
      activeEditor: {
        documentMutationReadiness: { whenPainted },
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.executeAsync('bold');

    await Promise.resolve();
    expect(whenPainted).toHaveBeenCalledWith({ txId: 'tx-sync' });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releasePaint?.();
    await expect(pending).resolves.toBe(receipt);
  });

  it('execute returns true immediately for async lower-level operations', async () => {
    let releaseOperation: ((receipt: { success: true; txId: string }) => void) | null = null;
    const operationResult = new Promise<{ success: true; txId: string }>((resolve) => {
      releaseOperation = resolve;
    });
    const bold = vi.fn(() => operationResult);
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.execute('bold')).toBe(true);
    releaseOperation?.({ success: true, txId: 'tx-async' });
  });

  it('executeAsync resolves the eventual receipt for async lower-level operations', async () => {
    let releaseOperation: ((receipt: { success: true; txId: string }) => void) | null = null;
    const operationResult = new Promise<{ success: true; txId: string }>((resolve) => {
      releaseOperation = resolve;
    });
    let releasePaint: (() => void) | null = null;
    const whenPainted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePaint = resolve;
        }),
    );
    const bold = vi.fn(() => operationResult);
    const superdoc = {
      activeEditor: {
        documentMutationReadiness: { whenPainted },
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.executeAsync('bold');

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseOperation?.({ success: true, txId: 'tx-async' });
    await Promise.resolve();
    expect(whenPainted).toHaveBeenCalledWith({ txId: 'tx-async' });
    expect(settled).toBe(false);
    releasePaint?.();
    await expect(pending).resolves.toEqual({ success: true, txId: 'tx-async' });
  });

  it('routes zoom through SuperDoc.setZoom and normalizes percent payloads', async () => {
    const setZoom = vi.fn();
    const superdoc = makeCatalogSuperdoc({
      instance: { setZoom, getZoomState: () => ({ value: 150, mode: 'manual', min: 10, max: 400 }) },
    });
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('zoom').getState();
    expect(state).toMatchObject({ enabled: true, supported: true, value: 150 });
    await ui.toolbar.execute('zoom', '150%');
    expect(setZoom).toHaveBeenCalledWith(150);
    setZoom.mockClear();
    await ui.toolbar.execute('zoom', 200);
    expect(setZoom).toHaveBeenCalledWith(200);
    setZoom.mockClear();
    // Legacy fraction-style values are converted to percentages.
    await ui.toolbar.execute('zoom', 1.25);
    expect(setZoom).toHaveBeenCalledWith(125);
  });

  it('fails closed for invalid zoom payloads before calling SuperDoc.setZoom', async () => {
    const setZoom = vi.fn();
    const superdoc = makeCatalogSuperdoc({ instance: { setZoom } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('zoom', 'not-a-number')).toBe(false);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it('routes zoom-fit-width through SuperDoc.setZoomMode with a fixed argument', async () => {
    const setZoomMode = vi.fn();
    const superdoc = makeCatalogSuperdoc({ instance: { setZoomMode } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('zoom-fit-width').getState()).toMatchObject({ enabled: true, supported: true });
    await ui.toolbar.execute('zoom-fit-width');
    expect(setZoomMode).toHaveBeenCalledWith('fit-width');
  });

  it('routes document-mode through SuperDoc.setDocumentMode and stays enabled while viewing', async () => {
    const setDocumentMode = vi.fn();
    const superdoc = makeCatalogSuperdoc({ mode: 'viewing', instance: { setDocumentMode } });
    const ui = createSuperDocUI({ superdoc });
    // document-mode is a control, not a mutation — enabled even in viewing mode.
    expect(ui.commands.get('document-mode').getState()).toMatchObject({
      enabled: true,
      supported: true,
      value: 'viewing',
    });
    await ui.toolbar.execute('document-mode', { mode: 'editing' });
    expect(setDocumentMode).toHaveBeenCalledWith('editing');
    await ui.toolbar.execute('document-mode', 'suggesting');
    expect(setDocumentMode).toHaveBeenCalledWith('suggesting');
  });

  it('routes measurement-unit through SuperDoc.setMeasurementUnit and reads the live value while viewing', async () => {
    const setMeasurementUnit = vi.fn();
    const superdoc = makeCatalogSuperdoc({
      mode: 'viewing',
      instance: { setMeasurementUnit, getMeasurementUnit: () => 'cm' },
    });
    const ui = createSuperDocUI({ superdoc });
    // A view control (not a mutation) — enabled even in viewing mode, value read live.
    expect(ui.commands.get('measurement-unit').getState()).toMatchObject({
      enabled: true,
      supported: true,
      value: 'cm',
    });
    await ui.toolbar.execute('measurement-unit', 'cm');
    expect(setMeasurementUnit).toHaveBeenCalledWith('cm');
    await ui.toolbar.execute('measurement-unit', { value: 'in' });
    expect(setMeasurementUnit).toHaveBeenCalledWith('in');
  });

  it('fails closed for invalid measurement-unit payloads before calling SuperDoc.setMeasurementUnit', async () => {
    const setMeasurementUnit = vi.fn();
    const superdoc = makeCatalogSuperdoc({ instance: { setMeasurementUnit } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('measurement-unit', 'furlongs')).toBe(false);
    expect(setMeasurementUnit).not.toHaveBeenCalled();
  });

  it('recomputes the measurement-unit command value on a measurement-unit-change event', async () => {
    // A programmatic setMeasurementUnit writes the store then emits
    // 'measurement-unit-change'. The controller must recompute so the command
    // value reflects the live unit immediately, without an unrelated event.
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    let currentUnit: 'in' | 'cm' = 'in';
    const setMeasurementUnit = vi.fn((unit: 'in' | 'cm') => {
      currentUnit = unit;
      for (const handler of handlers.get('measurement-unit-change') ?? []) handler({ unit });
    });
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          trackChanges: { list: () => ({ items: [] }) },
        },
      },
      config: { documentMode: 'editing' },
      setMeasurementUnit,
      getMeasurementUnit: () => currentUnit,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    // The controller subscribes to the measurement-unit-change lifecycle event.
    expect(handlers.has('measurement-unit-change')).toBe(true);
    expect(ui.commands.get('measurement-unit').getState().value).toBe('in');

    let latestValue: unknown;
    ui.commands.get('measurement-unit').observe((state) => {
      latestValue = state.value;
    });

    await ui.toolbar.execute('measurement-unit', 'cm');
    expect(setMeasurementUnit).toHaveBeenCalledWith('cm');
    // Command value tracks the live unit after the emitted recompute.
    expect(ui.commands.get('measurement-unit').getState().value).toBe('cm');
    expect(latestValue).toBe('cm');
  });

  it('prefers the public config document mode while the runtime snapshot still lags', async () => {
    const superdoc = makeCatalogSuperdoc({
      mode: 'suggesting',
      instance: {
        setDocumentMode: vi.fn(),
        getActiveRuntime: () => ({
          getSnapshot: () => ({ documentMode: 'editing' }),
        }),
      },
    });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('document-mode').getState()).toMatchObject({
      enabled: true,
      supported: true,
      value: 'suggesting',
    });
    expect(ui.document.getSnapshot().mode).toBe('suggesting');
  });

  it('fails closed for invalid document-mode payloads before calling SuperDoc.setDocumentMode', async () => {
    const setDocumentMode = vi.fn();
    const superdoc = makeCatalogSuperdoc({ instance: { setDocumentMode } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('document-mode', { mode: 'invalid' })).toBe(false);
    expect(setDocumentMode).not.toHaveBeenCalled();
  });

  it('reports not-ready for instance-routed commands before an active editor is mounted', async () => {
    const setZoom = vi.fn();
    const superdoc = {
      config: { documentMode: 'editing' },
      setZoom,
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('zoom').getState()).toMatchObject({
      enabled: false,
      supported: false,
      reason: SUPERDOC_UI_REASONS.notReady,
    });
    expect(await ui.commands.execute('zoom', 150)).toBe(false);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it('reports operation-unavailable for instance-routed commands when the host lacks the method', async () => {
    const superdoc = makeCatalogSuperdoc(); // no setZoom/setDocumentMode on the instance
    const ui = createSuperDocUI({ superdoc });
    const zoom = ui.commands.get('zoom').getState();
    expect(zoom.enabled).toBe(false);
    expect(zoom.reason).toBe(SUPERDOC_UI_REASONS.operationUnavailable);
    expect(await ui.commands.execute('zoom', 1.5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Block / paragraph / list / link / create command routing (Workstreams 3-4,
// row 747): the families that were previously command-deferred now route
// through public v2 surfaces, resolving target/context from the live selection
// (blockId === public block nodeId === paraId in the v2 adapter).
// ---------------------------------------------------------------------------

describe('public ui — block / paragraph / list / link / create routing (row 747)', () => {
  // Two-block selection so per-block application is observable.
  const MULTI_TARGET = {
    kind: 'text',
    segments: [
      { blockId: 'P1', range: { start: 0, end: 5 } },
      { blockId: 'P2', range: { start: 0, end: 3 } },
    ],
  } as const;
  const MULTI_SELECTION_TARGET = {
    kind: 'selection',
    start: { kind: 'text', blockId: 'P1', offset: 0 },
    end: { kind: 'text', blockId: 'P2', offset: 3 },
  } as const;
  const SINGLE_BLOCK_SELECTION_INFO = {
    empty: false,
    target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 0 } }] },
    selectionTarget: {
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 0 },
      end: { kind: 'text', blockId: 'P1', offset: 0 },
    },
    activeMarks: [] as string[],
    activeCommentIds: [] as string[],
    activeChangeIds: [] as string[],
    text: '',
  } as const;
  const linkAddress = (start: number, end: number) =>
    ({
      kind: 'inline',
      nodeType: 'hyperlink',
      anchor: {
        start: { blockId: 'P1', offset: start },
        end: { blockId: 'P1', offset: end },
      },
    }) as const;

  function makeBlockSuperdoc(
    docExtra: Record<string, unknown>,
    opts: { selectionInfo?: unknown; mode?: string; editorExtra?: Record<string, unknown> } = {},
  ) {
    const selectionInfo =
      'selectionInfo' in opts
        ? opts.selectionInfo
        : {
            empty: false,
            target: MULTI_TARGET,
            selectionTarget: MULTI_SELECTION_TARGET,
            activeMarks: [] as string[],
            activeCommentIds: [] as string[],
            activeChangeIds: [] as string[],
            text: 'hello',
          };
    return {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          contentControls: { list: () => ({ items: [] }) },
          selection: { current: () => selectionInfo },
          ...docExtra,
        },
        ...(opts.editorExtra ?? {}),
      },
      config: { documentMode: opts.mode ?? 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
  }

  function multiSelectionInfoInStory(story: unknown) {
    return {
      empty: false,
      target: { ...MULTI_TARGET, story },
      selectionTarget: { ...MULTI_SELECTION_TARGET, story },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'hello',
    };
  }

  it('text-align routes format.paragraph.setAlignment per covered block', async () => {
    const setAlignment = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ format: { paragraph: { setAlignment } } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-align').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.execute('text-align', 'center')).toMatchObject({ success: true });
    expect(setAlignment).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      alignment: 'center',
    });
    expect(setAlignment).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
      alignment: 'center',
    });
  });

  it('text-align reports a uniform direct paragraph alignment from body nodes', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: 'center' } } },
    }));
    const superdoc = makeBlockSuperdoc({
      getNodeById,
      format: { paragraph: { setAlignment: vi.fn() } },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('text-align').getState().value).toBe('center');
    expect(getNodeById).toHaveBeenCalledWith({ nodeId: 'P1', nodeType: 'paragraph' });
    expect(getNodeById).toHaveBeenCalledWith({ nodeId: 'P2', nodeType: 'paragraph' });
  });

  it.each(['center', 'right'] as const)(
    'text-align reports inherited %s alignment from the resolved layout',
    (alignment) => {
      const getNodeById = vi.fn(({ nodeId }: { nodeId: string }) => ({
        node: { kind: 'paragraph', paragraph: { props: {}, nodeId } },
      }));
      const readMountedProjectionBlocksByIds = vi.fn(() => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment }, runs: [] },
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment }, runs: [] },
      ]);
      const superdoc = makeBlockSuperdoc(
        { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
        { editorExtra: { host: { readMountedProjectionBlocksByIds } } },
      );
      const ui = createSuperDocUI({ superdoc });

      expect(ui.commands.get('text-align').getState().value).toBe(alignment);
      expect(readMountedProjectionBlocksByIds).toHaveBeenCalledWith(['P1', 'P2']);
    },
  );

  it('text-align immediately reports a mounted alignment while paragraph node reads are pending', () => {
    const getNodeById = vi.fn(() => new Promise(() => {}));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: 'center' }, runs: [] },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe('center');
  });

  it('text-align reports mixed mounted alignments while paragraph node reads are pending', () => {
    const getNodeById = vi.fn(() => new Promise(() => {}));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: 'right' }, runs: [] },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBeUndefined();
  });

  it('text-align fails closed while paragraph node reads and mounted projection are incomplete', () => {
    const getNodeById = vi.fn(() => new Promise(() => {}));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBeUndefined();
  });

  it('text-align keeps direct alignment authoritative over the resolved layout', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: 'right' } } },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: 'center' }, runs: [] },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe('right');
  });

  it.each([
    ['start', 'ltr', 'left'],
    ['start', 'rtl', 'left'],
    ['end', 'ltr', 'right'],
    ['end', 'rtl', 'right'],
    ['distributed', 'ltr', 'justify'],
    ['distributed', 'rtl', 'justify'],
    ['numTab', 'ltr', 'justify'],
    ['lowKashida', 'rtl', 'justify'],
    ['mediumKashida', 'rtl', 'justify'],
    ['highKashida', 'rtl', 'justify'],
    ['thaiDistribute', 'rtl', 'justify'],
  ] as const)(
    'text-align resolves direct %s through the mounted %s projection (%s)',
    (directAlignment, inlineDirection, effectiveAlignment) => {
      const getNodeById = vi.fn(() => ({
        node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
      }));
      const host = {
        readMountedProjectionBlocksByIds: () => [
          {
            kind: 'paragraph',
            sourceAnchor: { sourceNodeId: 'P1' },
            attrs: { alignment: effectiveAlignment, directionContext: { inlineDirection } },
            runs: [],
          },
          {
            kind: 'paragraph',
            sourceAnchor: { sourceNodeId: 'P2' },
            attrs: { alignment: effectiveAlignment, directionContext: { inlineDirection } },
            runs: [],
          },
        ],
      };
      const superdoc = makeBlockSuperdoc(
        { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
        { editorExtra: { host } },
      );

      expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe(effectiveAlignment);
    },
  );

  it('text-align fails closed for an unknown direct alignment instead of trusting the projection', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: 'sideways' } } },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: 'center' }, runs: [] },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBeUndefined();
  });

  it('text-align preserves direct public alignment in the inherited RTL direction', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: 'left' } } },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          attrs: { alignment: 'left', directionContext: { inlineDirection: 'rtl' } },
          runs: [],
        },
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P2' },
          attrs: { alignment: 'left', directionContext: { inlineDirection: 'rtl' } },
          runs: [],
        },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe('left');
  });

  it.each([
    ['rtl', 'right'],
    ['ltr', 'left'],
  ] as const)(
    'text-align reports the visual %s default when resolved paragraphs have no alignment',
    (inlineDirection, expected) => {
      const getNodeById = vi.fn(() => ({
        node: { kind: 'paragraph', paragraph: { props: {} } },
      }));
      const host = {
        readMountedProjectionBlocksByIds: () => [
          {
            kind: 'paragraph',
            sourceAnchor: { sourceNodeId: 'P1' },
            attrs: { directionContext: { inlineDirection } },
            runs: [],
          },
          {
            kind: 'paragraph',
            sourceAnchor: { sourceNodeId: 'P2' },
            attrs: { directionContext: { inlineDirection } },
            runs: [],
          },
        ],
      };
      const superdoc = makeBlockSuperdoc(
        { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
        { editorExtra: { host } },
      );

      expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe(expected);
    },
  );

  it('text-align reports the visual RTL default from legacy paragraph properties', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: {} } },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () =>
        ['P1', 'P2'].map((blockId) => ({
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: blockId },
          attrs: { paragraphProperties: { rightToLeft: true } },
          runs: [],
        })),
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe('right');
  });

  it('text-align fails closed when an indirectly formatted selected paragraph is unmounted', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: {} } },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBeUndefined();
  });

  it('text-align reports mixed direct public alignment when a selected paragraph is unmounted', () => {
    const getNodeById = vi.fn(({ nodeId }: { nodeId: 'P1' | 'P2' }) => ({
      node: {
        kind: 'paragraph',
        paragraph: { props: { alignment: nodeId === 'P1' ? 'left' : 'right' } },
      },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          attrs: { alignment: 'right', directionContext: { inlineDirection: 'rtl' } },
          runs: [],
        },
      ],
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBeUndefined();
  });

  it('text-align preserves direct logical alignment when the projection seam is unavailable', () => {
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: 'right' } } },
    }));
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host: {} } },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe('right');
  });

  it.each([
    ['uniform', { P1: 'right', P2: 'right' }, 'right'],
    ['mixed', { P1: 'center', P2: 'right' }, undefined],
    ['default-left', { P1: undefined, P2: undefined }, 'left'],
  ] as const)('text-align resolves %s paragraph alignment', (_scenario, alignments, expected) => {
    const getNodeById = vi.fn(({ nodeId }: { nodeId: 'P1' | 'P2' }) => ({
      node: { kind: 'heading', heading: { props: { alignment: alignments[nodeId] } } },
    }));
    const host = {
      readMountedProjectionBlocksByIds: () =>
        (['P1', 'P2'] as const).map((nodeId) => ({
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: nodeId },
          attrs: alignments[nodeId] ? { alignment: alignments[nodeId] } : {},
          runs: [],
        })),
    };
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      { editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('text-align').getState().value).toBe(expected);
  });

  it('text-align reads header/footer alignment with the exact selected story', () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId4' } as const;
    const getNode = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: 'center' } } },
    }));
    const superdoc = makeBlockSuperdoc(
      { getNode, format: { paragraph: { setAlignment: vi.fn() } } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('text-align').getState().value).toBe('center');
    expect(getNode).toHaveBeenCalledWith({
      kind: 'block',
      nodeType: 'paragraph',
      nodeId: 'P1',
      story,
    });
    expect(getNode).toHaveBeenCalledWith({
      kind: 'block',
      nodeType: 'paragraph',
      nodeId: 'P2',
      story,
    });
  });

  it('text-align resolves inherited header/footer alignment in the exact selected story', () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId4' } as const;
    const getNode = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: {} } },
    }));
    const readMountedProjectionBlocksByIds = vi.fn(() => [
      { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'center' }, runs: [] },
      { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: 'center' }, runs: [] },
    ]);
    const superdoc = makeBlockSuperdoc(
      { getNode, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        selectionInfo: multiSelectionInfoInStory(story),
        editorExtra: { host: { readMountedProjectionBlocksByIds } },
      },
    );

    expect(createSuperDocUI({ superdoc }).commands.get('text-align').getState().value).toBe('center');
    expect(readMountedProjectionBlocksByIds).toHaveBeenCalledWith(['P1', 'P2'], story);
  });

  it('text-align refreshes its value after a committed document mutation', () => {
    let alignment: 'left' | 'center' = 'left';
    let notifyHostEvent = (_event: unknown) => {};
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment } } },
    }));
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        editorExtra: {
          host: {
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-align').getState().value).toBe('left');

    alignment = 'center';
    notifyHostEvent({ type: 'mutation:committed' });

    expect(ui.commands.get('text-align').getState().value).toBe('center');
  });

  it('keeps a settled async alignment visible while an unrelated commit refreshes it', async () => {
    let notifyHostEvent = (_event: unknown) => {};
    let resolveNode = (_value: unknown) => {};
    const getNodeById = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveNode = resolve;
        }),
    );
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        selectionInfo: SINGLE_BLOCK_SELECTION_INFO,
        editorExtra: {
          host: {
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    resolveNode({ node: { kind: 'paragraph', paragraph: { props: { alignment: 'center' } } } });
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('center'));

    const publishedValues: unknown[] = [];
    const unsubscribe = ui.commands.get('text-align').observe((state) => publishedValues.push(state.value));
    notifyHostEvent({ type: 'mutation:committed', origin: 'typing' });

    expect(ui.commands.get('text-align').getState().value).toBe('center');
    expect(publishedValues).not.toContain(undefined);

    resolveNode({ node: { kind: 'paragraph', paragraph: { props: { alignment: 'right' } } } });
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('right'));
    expect(publishedValues).not.toContain(undefined);
    unsubscribe();
  });

  it('stops serving a stale async alignment when its refresh fails', async () => {
    let notifyHostEvent = (_event: unknown) => {};
    let resolveNode = (_value: unknown) => {};
    let rejectNode = (_error: unknown) => {};
    let readCount = 0;
    const getNodeById = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          readCount += 1;
          if (readCount === 1) resolveNode = resolve;
          else rejectNode = reject;
        }),
    );
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        selectionInfo: SINGLE_BLOCK_SELECTION_INFO,
        editorExtra: {
          host: {
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    resolveNode({ node: { kind: 'paragraph', paragraph: { props: { alignment: 'center' } } } });
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('center'));

    notifyHostEvent({ type: 'mutation:committed', origin: 'typing' });
    expect(ui.commands.get('text-align').getState().value).toBe('center');

    rejectNode(new Error('node refresh failed'));
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBeUndefined());
  });

  it('lets a refreshed mixed projection override stale async paragraph nodes', async () => {
    let notifyHostEvent = (_event: unknown) => {};
    let projectedAlignments: readonly ['center', 'center'] | readonly ['center', 'right'] = ['center', 'center'];
    const nodeResolvers = new Map<string, (value: unknown) => void>();
    const getNodeById = vi.fn(
      ({ nodeId }: { nodeId: string }) =>
        new Promise((resolve) => {
          nodeResolvers.set(nodeId, resolve);
        }),
    );
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        editorExtra: {
          host: {
            readMountedProjectionBlocksByIds: () =>
              (['P1', 'P2'] as const).map((blockId, index) => ({
                kind: 'paragraph',
                sourceAnchor: { sourceNodeId: blockId },
                attrs: { alignment: projectedAlignments[index] },
                runs: [],
              })),
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    for (const resolve of nodeResolvers.values()) {
      resolve({ node: { kind: 'paragraph', paragraph: { props: { alignment: 'center' } } } });
    }
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('center'));

    projectedAlignments = ['center', 'right'];
    notifyHostEvent({ type: 'mutation:committed', origin: 'typing' });

    expect(ui.commands.get('text-align').getState().value).toBeUndefined();
  });

  it('keeps the chosen alignment visible through commit, focus, and paint transitions', async () => {
    const selectionInfo: any = {
      ...SINGLE_BLOCK_SELECTION_INFO,
      target: { ...SINGLE_BLOCK_SELECTION_INFO.target },
      selectionTarget: { ...SINGLE_BLOCK_SELECTION_INFO.selectionTarget },
    };
    const selectedTarget = selectionInfo.target;
    const selectedRange = selectionInfo.selectionTarget;
    let alignment: 'left' | 'center' = 'left';
    let notifySelection = () => {};
    let notifyHostEvent = (_event: unknown) => {};
    let resolvePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const receipt = { success: true, txId: 'align-center' } as const;
    const setAlignment = vi.fn(() => receipt);
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment } } },
    }));
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment } } },
      {
        selectionInfo,
        editorExtra: {
          documentMutationReadiness: { whenPainted: vi.fn(() => painted) },
          host: {
            readMountedProjectionBlocksByIds: () => [
              { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment }, runs: [] },
            ],
            getHandles: () => ({
              editing: {
                selection: {
                  subscribe: (listener: () => void) => {
                    notifySelection = listener;
                    return () => {};
                  },
                },
              },
            }),
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-align').getState().value).toBe('left');

    const settlement = ui.toolbar.executeAsync('text-align', 'center');

    expect(ui.commands.get('text-align').getState().value).toBe('center');
    notifyHostEvent({ type: 'mutation:committed', receipt });
    expect(ui.commands.get('text-align').getState().value).toBe('center');

    // Clicking the toolbar can briefly make the worker selection unreadable.
    // That transient selection-required snapshot must not reset the icon while
    // the successful paragraph mutation is waiting for its painted projection.
    selectionInfo.target = null;
    selectionInfo.selectionTarget = null;
    notifySelection();
    expect(ui.commands.get('text-align').getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.selectionRequired,
      value: 'center',
    });

    selectionInfo.target = selectedTarget;
    selectionInfo.selectionTarget = selectedRange;
    alignment = 'center';
    resolvePaint();
    await settlement;

    expect(ui.commands.get('text-align').getState().value).toBe('center');
  });

  it('retires oversized-selection alignment feedback after the mutation paints', async () => {
    const segments = Array.from({ length: 65 }, (_, index) => ({
      blockId: `P${index}`,
      range: { start: 0, end: 1 },
    }));
    const selectionInfo = {
      empty: false,
      target: { kind: 'text', segments },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P0', offset: 0 },
        end: { kind: 'text', blockId: 'P64', offset: 1 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
    let notifyHostEvent = (_event: unknown) => {};
    let resolvePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const setAlignment = vi.fn(() => ({ success: true, txId: 'align-many' }));
    const superdoc = makeBlockSuperdoc(
      { format: { paragraph: { setAlignment } } },
      {
        selectionInfo,
        editorExtra: {
          documentMutationReadiness: { whenPainted: vi.fn(() => painted) },
          host: {
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('text-align').getState().value).toBeUndefined();
    const settlement = ui.toolbar.executeAsync('text-align', 'center');

    // Large selections cannot be authoritatively probed, but they still expose
    // the successful pick while its paint is pending.
    expect(ui.commands.get('text-align').getState().value).toBe('center');

    resolvePaint();
    await settlement;
    expect(ui.commands.get('text-align').getState().value).toBeUndefined();

    notifyHostEvent({ type: 'mutation:committed', origin: 'history' });
    expect(ui.commands.get('text-align').getState().value).toBeUndefined();
    notifyHostEvent({ type: 'collaboration:remote-changed', remoteGeneration: 1 });
    expect(ui.commands.get('text-align').getState().value).toBeUndefined();
  });

  it('keeps public alignment feedback for a partially mounted mixed-direction selection', async () => {
    let mountedBlocks = [
      {
        kind: 'paragraph',
        sourceAnchor: { sourceNodeId: 'P1' },
        attrs: { alignment: 'left', directionContext: { inlineDirection: 'ltr' } },
        runs: [],
      },
    ];
    let directAlignment: 'left' | 'center' = 'left';
    let notifyHostEvent = (_event: unknown) => {};
    let resolvePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        getNodeById,
        format: { paragraph: { setAlignment: vi.fn(() => ({ success: true, txId: 'align-left' })) } },
      },
      {
        editorExtra: {
          documentMutationReadiness: { whenPainted: vi.fn(() => painted) },
          host: {
            readMountedProjectionBlocksByIds: () => mountedBlocks,
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const settlement = ui.toolbar.executeAsync('text-align', 'left');

    expect(ui.commands.get('text-align').getState().value).toBe('left');

    mountedBlocks = [
      mountedBlocks[0],
      {
        kind: 'paragraph',
        sourceAnchor: { sourceNodeId: 'P2' },
        attrs: { alignment: 'right', directionContext: { inlineDirection: 'rtl' } },
        runs: [],
      },
    ];
    resolvePaint();
    await settlement;

    expect(ui.commands.get('text-align').getState().value).toBe('left');

    directAlignment = 'center';
    mountedBlocks = mountedBlocks.map((block) => ({ ...block, attrs: { ...block.attrs, alignment: 'center' } }));
    notifyHostEvent({ type: 'mutation:committed', origin: 'history' });
    expect(ui.commands.get('text-align').getState().value).toBe('center');
  });

  it.each(['center', 'justify'] as const)(
    'keeps %s alignment feedback while a partially mounted selection waits for paint',
    async (requestedAlignment) => {
      let directAlignment: 'left' | typeof requestedAlignment = 'left';
      let mountedBlocks = [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          attrs: { alignment: 'left', directionContext: { inlineDirection: 'ltr' } },
          runs: [],
        },
      ];
      let resolvePaint = () => {};
      const painted = new Promise<void>((resolve) => {
        resolvePaint = resolve;
      });
      const superdoc = makeBlockSuperdoc(
        {
          getNodeById: () => ({
            node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
          }),
          format: { paragraph: { setAlignment: vi.fn(() => ({ success: true, txId: 'align' })) } },
        },
        {
          editorExtra: {
            documentMutationReadiness: { whenPainted: vi.fn(() => painted) },
            host: { readMountedProjectionBlocksByIds: () => mountedBlocks },
          },
        },
      );
      const ui = createSuperDocUI({ superdoc });

      const settlement = ui.toolbar.executeAsync('text-align', requestedAlignment);
      expect(ui.commands.get('text-align').getState().value).toBe(requestedAlignment);

      directAlignment = requestedAlignment;
      mountedBlocks = ['P1', 'P2'].map((blockId) => ({
        kind: 'paragraph',
        sourceAnchor: { sourceNodeId: blockId },
        attrs: { alignment: requestedAlignment, directionContext: { inlineDirection: 'ltr' } },
        runs: [],
      }));
      resolvePaint();
      await settlement;

      expect(ui.commands.get('text-align').getState().value).toBe(requestedAlignment);
    },
  );

  it('keeps requested public alignment feedback when every selected direction is mounted', async () => {
    let directAlignment: 'left' | 'right' = 'left';
    let mountedAlignment: 'left' | 'right' = 'left';
    let resolvePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const superdoc = makeBlockSuperdoc(
      {
        getNodeById: () => ({
          node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
        }),
        format: { paragraph: { setAlignment: vi.fn(() => ({ success: true, txId: 'align-right' })) } },
      },
      {
        editorExtra: {
          documentMutationReadiness: { whenPainted: vi.fn(() => painted) },
          host: {
            readMountedProjectionBlocksByIds: () =>
              ['P1', 'P2'].map((blockId) => ({
                kind: 'paragraph',
                sourceAnchor: { sourceNodeId: blockId },
                attrs: { alignment: mountedAlignment, directionContext: { inlineDirection: 'ltr' } },
                runs: [],
              })),
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const settlement = ui.toolbar.executeAsync('text-align', 'right');
    expect(ui.commands.get('text-align').getState().value).toBe('right');

    directAlignment = 'right';
    mountedAlignment = 'right';
    resolvePaint();
    await settlement;
    expect(ui.commands.get('text-align').getState().value).toBe('right');
  });

  it('keeps the requested public alignment as optimistic feedback in RTL paragraphs', async () => {
    let resolvePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const superdoc = makeBlockSuperdoc(
      {
        getNodeById: () => ({
          node: { kind: 'paragraph', paragraph: { props: { alignment: 'right' } } },
        }),
        format: { paragraph: { setAlignment: vi.fn(() => ({ success: true, txId: 'align-left' })) } },
      },
      {
        editorExtra: {
          documentMutationReadiness: { whenPainted: vi.fn(() => painted) },
          host: {
            readMountedProjectionBlocksByIds: () =>
              ['P1', 'P2'].map((blockId) => ({
                kind: 'paragraph',
                sourceAnchor: { sourceNodeId: blockId },
                attrs: { alignment: 'right', directionContext: { inlineDirection: 'rtl' } },
                runs: [],
              })),
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const settlement = ui.toolbar.executeAsync('text-align', 'left');

    expect(ui.commands.get('text-align').getState().value).toBe('left');

    resolvePaint();
    await settlement;
  });

  it('rolls back the optimistic alignment when the paragraph mutation fails', async () => {
    const failure = { success: false, failure: { code: 'BLOCK_FAILED', message: 'alignment failed' } };
    const superdoc = makeBlockSuperdoc(
      {
        getNodeById: () => ({
          node: { kind: 'paragraph', paragraph: { props: { alignment: 'left' } } },
        }),
        format: { paragraph: { setAlignment: vi.fn(() => Promise.resolve(failure)) } },
      },
      {
        selectionInfo: SINGLE_BLOCK_SELECTION_INFO,
        editorExtra: {
          host: {
            readMountedProjectionBlocksByIds: () => [
              { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'left' }, runs: [] },
            ],
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const settlement = ui.toolbar.executeAsync('text-align', 'center');
    expect(ui.commands.get('text-align').getState().value).toBe('center');

    expect(await settlement).toEqual(failure);
    expect(ui.commands.get('text-align').getState().value).toBe('left');
  });

  it('never publishes an optimistic alignment when the paragraph mutation rejects synchronously', async () => {
    const failure = { success: false, failure: { code: 'BLOCK_FAILED', message: 'alignment failed' } };
    const superdoc = makeBlockSuperdoc(
      {
        getNodeById: () => ({
          node: { kind: 'paragraph', paragraph: { props: { alignment: 'left' } } },
        }),
        format: { paragraph: { setAlignment: vi.fn(() => failure) } },
      },
      {
        selectionInfo: SINGLE_BLOCK_SELECTION_INFO,
        editorExtra: {
          host: {
            readMountedProjectionBlocksByIds: () => [
              { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: 'left' }, runs: [] },
            ],
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    const publishedValues: unknown[] = [];
    const unsubscribe = ui.commands.get('text-align').observe((state) => publishedValues.push(state.value));

    expect(await ui.toolbar.executeAsync('text-align', 'center')).toEqual(failure);

    expect(publishedValues).not.toContain('center');
    expect(ui.commands.get('text-align').getState().value).toBe('left');
    unsubscribe();
  });

  it('text-align refreshes inherited alignment after a remote collaboration change paints', async () => {
    let directAlignment: 'left' | undefined = 'left';
    let effectiveAlignment: 'left' | 'center' = 'left';
    let notifyHostEvent = (_event: unknown) => {};
    let resolvePaint: () => void = () => undefined;
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const whenPainted = vi.fn(() => painted);
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
    }));
    const readMountedProjectionBlocksByIds = vi.fn(() => [
      { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: effectiveAlignment }, runs: [] },
      { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: effectiveAlignment }, runs: [] },
    ]);
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        editorExtra: {
          documentMutationReadiness: {
            getRenderEpoch: () => 17,
            whenPainted,
          },
          host: {
            readMountedProjectionBlocksByIds,
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-align').getState().value).toBe('left');

    directAlignment = undefined;
    notifyHostEvent({
      type: 'collaboration:remote-changed',
      remoteGeneration: 1,
      changedStoryIds: ['main:/word/document.xml'],
      changedPartUris: ['/word/document.xml'],
    });

    expect(ui.commands.get('text-align').getState().value).toBe('left');
    expect(whenPainted).toHaveBeenCalledWith({ afterEpoch: 17 });

    effectiveAlignment = 'center';
    resolvePaint();
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('center'));
  });

  it.each(['history', 'extension'])(
    'text-align refreshes inherited alignment after a local %s mutation paints',
    async (origin) => {
      let directAlignment: 'left' | undefined = 'left';
      let effectiveAlignment: 'left' | 'center' = 'left';
      let notifyHostEvent = (_event: unknown) => {};
      let resolvePaint: () => void = () => undefined;
      const painted = new Promise<void>((resolve) => {
        resolvePaint = resolve;
      });
      const whenPainted = vi.fn(() => painted);
      const superdoc = makeBlockSuperdoc(
        {
          getNodeById: () => ({
            node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
          }),
          format: { paragraph: { setAlignment: vi.fn() } },
        },
        {
          editorExtra: {
            documentMutationReadiness: {
              getRenderEpoch: () => 17,
              whenPainted,
            },
            host: {
              readMountedProjectionBlocksByIds: () => [
                {
                  kind: 'paragraph',
                  sourceAnchor: { sourceNodeId: 'P1' },
                  attrs: { alignment: effectiveAlignment },
                  runs: [],
                },
                {
                  kind: 'paragraph',
                  sourceAnchor: { sourceNodeId: 'P2' },
                  attrs: { alignment: effectiveAlignment },
                  runs: [],
                },
              ],
              events: {
                subscribe: (listener: (event: unknown) => void) => {
                  notifyHostEvent = listener;
                  return () => {};
                },
              },
            },
          },
        },
      );
      const ui = createSuperDocUI({ superdoc });
      expect(ui.commands.get('text-align').getState().value).toBe('left');

      directAlignment = undefined;
      notifyHostEvent({ type: 'mutation:committed', origin });

      expect(ui.commands.get('text-align').getState().value).toBe('left');
      expect(whenPainted).toHaveBeenCalledWith({ afterEpoch: 17 });

      effectiveAlignment = 'center';
      resolvePaint();
      await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('center'));
    },
  );

  it('text-align publishes each painted remote generation while a newer paint is queued', async () => {
    let directAlignment: 'left' | undefined = 'left';
    let effectiveAlignment: 'left' | 'center' | 'right' = 'left';
    let renderEpoch = 17;
    let notifyHostEvent = (_event: unknown) => {};
    let resolveFirstPaint: () => void = () => undefined;
    let resolveSecondPaint: () => void = () => undefined;
    const firstPaint = new Promise<void>((resolve) => {
      resolveFirstPaint = resolve;
    });
    const secondPaint = new Promise<void>((resolve) => {
      resolveSecondPaint = resolve;
    });
    const whenPainted = vi.fn().mockReturnValueOnce(firstPaint).mockReturnValueOnce(secondPaint);
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { alignment: directAlignment } } },
    }));
    const readMountedProjectionBlocksByIds = vi.fn(() => [
      { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P1' }, attrs: { alignment: effectiveAlignment }, runs: [] },
      { kind: 'paragraph', sourceAnchor: { sourceNodeId: 'P2' }, attrs: { alignment: effectiveAlignment }, runs: [] },
    ]);
    const superdoc = makeBlockSuperdoc(
      { getNodeById, format: { paragraph: { setAlignment: vi.fn() } } },
      {
        editorExtra: {
          documentMutationReadiness: {
            getRenderEpoch: () => renderEpoch,
            whenPainted,
          },
          host: {
            readMountedProjectionBlocksByIds,
            events: {
              subscribe: (listener: (event: unknown) => void) => {
                notifyHostEvent = listener;
                return () => {};
              },
            },
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-align').getState().value).toBe('left');

    directAlignment = undefined;
    notifyHostEvent({ type: 'collaboration:remote-changed', remoteGeneration: 1 });
    renderEpoch = 18;
    notifyHostEvent({ type: 'collaboration:remote-changed', remoteGeneration: 2 });

    effectiveAlignment = 'center';
    resolveFirstPaint();
    await vi.waitFor(() => {
      expect(whenPainted).toHaveBeenCalledTimes(2);
      expect(ui.commands.get('text-align').getState().value).toBe('center');
    });

    effectiveAlignment = 'right';
    resolveSecondPaint();
    await vi.waitFor(() => expect(ui.commands.get('text-align').getState().value).toBe('right'));
    expect(whenPainted).toHaveBeenNthCalledWith(1, { afterEpoch: 17 });
    expect(whenPainted).toHaveBeenNthCalledWith(2, { afterEpoch: 18 });
  });

  it.each([
    ['header', 'rId6', 'center'],
    ['footer', 'rId7', 'right'],
  ])('text-align preserves the exact %s story on paragraph targets', async (_kind, refId, alignment) => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId } as const;
    const setAlignment = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc(
      { format: { paragraph: { setAlignment } } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('text-align', alignment)).toMatchObject({ success: true });
    expect(setAlignment).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1', story },
      alignment,
    });
    expect(setAlignment).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2', story },
      alignment,
    });
  });

  it('reflects the effective (inherited) font/size from the layout when a run has no direct override (SD-3652)', async () => {
    // Runs whose font comes from the style/docDefaults/theme have no direct rFonts,
    // so the Document API query projects nothing. Fall back to the resolved value
    // the layout already computed (matched to the selection by source node id).
    const projectionBlocks = [
      {
        kind: 'paragraph',
        sourceAnchor: { sourceNodeId: 'P1' },
        runs: [{ kind: 'text', text: 'a', fontFamily: 'Cambria, serif', fontSize: 18.6667 }],
      },
      {
        kind: 'paragraph',
        sourceAnchor: { sourceNodeId: 'P2' },
        runs: [{ kind: 'text', text: 'b', fontFamily: 'Cambria, serif', fontSize: 18.6667 }],
      },
    ];
    const readMountedProjectionBlocks = vi.fn(() => projectionBlocks);
    const readMountedProjectionBlocksByIds = vi.fn(() => projectionBlocks);
    const host = {
      readMountedProjectionBlocks,
      readMountedProjectionBlocksByIds,
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn(), fontSize: vi.fn() } },
      { editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    // CSS stack normalized to the named family; px normalized to points.
    expect(ui.commands.get('font-family').getState().value).toBe('Cambria');
    expect(ui.commands.get('font-size').getState().value).toBe('14');
    expect(readMountedProjectionBlocksByIds).toHaveBeenCalledWith(['P1', 'P2']);
    expect(readMountedProjectionBlocks).not.toHaveBeenCalled();
  });

  it('resolves a uniform font for a selection including an unmounted block via the effective-inline read (SD-3706)', async () => {
    // Select-all on a large document never mounts the tail, so the layout
    // projection cannot prove uniformity - the producer consults the internal
    // worker-side `format.readEffectiveInlineUniformity` read instead. A
    // uniform verdict shows the concrete font; the mounted subset is never
    // reported as representative on its own.
    const readEffectiveInlineUniformity = vi.fn(() => ({
      success: true,
      values: {
        fontFamily: { state: 'uniform', value: 'Cambria' },
        fontSize: { state: 'uniform', value: '14' },
      },
    }));
    const host = {
      // P2 intentionally absent from the mounted projection: the layout read
      // fails closed and the uniformity read is the authority.
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [{ kind: 'text', text: 'aaaaa', fontFamily: 'Cambria, serif', fontSize: 18.6667 }],
        },
      ],
      getPendingInlineFormat: () => null,
      setPendingInlineFormat: vi.fn(),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const crossBlockSelection = {
      empty: false,
      target: {
        kind: 'text',
        segments: [
          { blockId: 'P1', range: { start: 0, end: 5 } },
          { blockId: 'P2', range: { start: 0, end: 4 } },
        ],
      },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P2', offset: 4 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'aaaaahell',
    };
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn(), fontSize: vi.fn(), readEffectiveInlineUniformity } },
      { selectionInfo: crossBlockSelection, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    ui.commands.get('font-family').getState();
    // The async read settles through the shared read cache.
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.commands.get('font-family').getState().value).toBe('Cambria');
    expect(readEffectiveInlineUniformity).toHaveBeenCalledWith(
      expect.objectContaining({ target: crossBlockSelection.selectionTarget, offsetSpace: 'selection' }),
    );
  });

  it('shows blank (no held value) for a selection with an unmounted block when the uniformity read reports mixed (SD-3706)', async () => {
    const readEffectiveInlineUniformity = vi.fn(() => ({
      success: true,
      values: { fontFamily: { state: 'mixed' }, fontSize: { state: 'mixed' } },
    }));
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [{ kind: 'text', text: 'aaaaa', fontFamily: 'Cambria, serif', fontSize: 18.6667 }],
        },
      ],
      getPendingInlineFormat: () => null,
      setPendingInlineFormat: vi.fn(),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const crossBlockSelection = {
      empty: false,
      target: {
        kind: 'text',
        segments: [
          { blockId: 'P1', range: { start: 0, end: 5 } },
          { blockId: 'P2', range: { start: 0, end: 4 } },
        ],
      },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P2', offset: 4 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'aaaaahell',
    };
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn(), readEffectiveInlineUniformity } },
      { selectionInfo: crossBlockSelection, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    ui.commands.get('font-family').getState();
    await Promise.resolve();
    await Promise.resolve();
    // Settled mixed selection never adopts the mounted subset's font.
    expect(ui.commands.get('font-family').getState().value).toBeUndefined();
  });

  it('resolves the caret font with half-open run intervals at all three tab-boundary positions (SD-3706)', () => {
    // Hanging-indent list items carry a tab run alongside text runs. The caret
    // rule is half-open [start, end) for all but the final run: at the
    // boundary AFTER the leading tab the caret reports the FOLLOWING text run
    // (deliberate divergence from Word's preceding-character rule - the tab is
    // list-marker chrome); at paragraph end, the final text-bearing run.
    // Visible offsets: tab[0,1) "AAAA"[1,5) "BBBB"[5,9).
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [
            { kind: 'tab', text: '\t', fontFamily: 'Courier New', fontSize: 12 },
            { kind: 'text', text: 'AAAA', fontFamily: 'Times New Roman', fontSize: 12 },
            { kind: 'text', text: 'BBBB', fontFamily: 'Courier New', fontSize: 12 },
          ],
        },
      ],
      getPendingInlineFormat: () => null,
      setPendingInlineFormat: vi.fn(),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const caretSelectionAt = (offset: number) => ({
      empty: false,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: offset, end: offset } }] },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset },
        end: { kind: 'text', blockId: 'P1', offset },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    });
    const fontAtCaret = (offset: number): unknown => {
      const superdoc = makeBlockSuperdoc(
        { format: { fontFamily: vi.fn() } },
        { selectionInfo: caretSelectionAt(offset), editorExtra: { host } },
      );
      return createSuperDocUI({ superdoc }).commands.get('font-family').getState().value;
    };
    // Before the tab: the tab run's own font.
    expect(fontAtCaret(0)).toBe('Courier New');
    // After the tab: the FOLLOWING text run, not the tab.
    expect(fontAtCaret(1)).toBe('Times New Roman');
    // Paragraph end: the final text-bearing run.
    expect(fontAtCaret(9)).toBe('Courier New');
    // Interior boundary between two text runs: the following run (half-open).
    expect(fontAtCaret(5)).toBe('Courier New');
  });

  it('does not override a direct font with the resolved layout value (SD-3652)', async () => {
    // A run with a direct font wins; the layout fallback only fills inherited fonts.
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [{ kind: 'text', text: 'a', fontFamily: 'Cambria, serif' }],
        },
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P2' },
          runs: [{ kind: 'text', text: 'b', fontFamily: 'Cambria, serif' }],
        },
      ],
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const query = {
      match: () => ({
        items: [
          {
            blocks: [
              { blockId: 'P1', runs: [{ range: { start: 0, end: 5 }, styles: { fontFamily: 'Georgia' } }] },
              { blockId: 'P2', runs: [{ range: { start: 0, end: 3 }, styles: { fontFamily: 'Georgia' } }] },
            ],
          },
        ],
      }),
    };
    const superdoc = makeBlockSuperdoc({ query, format: { fontFamily: vi.fn() } }, { editorExtra: { host } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBe('Georgia');
  });

  it('resolves the effective font for a caret inside a nested table cell (SD-3652)', () => {
    // Table-cell paragraphs are nested under table.rows[].cells[].blocks[], not
    // top-level; the traversal must descend to match the cell's source node id.
    const host = {
      readMountedProjectionBlocks: () => [
        {
          kind: 'table',
          id: 'T1',
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      kind: 'paragraph',
                      sourceAnchor: { sourceNodeId: 'C1' },
                      runs: [{ kind: 'text', text: 'x', fontFamily: 'Verdana, sans-serif', fontSize: 20 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      getPendingInlineFormat: () => null,
      setPendingInlineFormat: vi.fn(),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn(), fontSize: vi.fn() } },
      { selectionInfo: caretSelectionInfo('C1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBe('Verdana');
  });

  it('matches a projection block by block.id when it has no sourceNodeId (SD-3652)', () => {
    // Some projected blocks are identifiable by block.id rather than a source
    // anchor; the lookup must fall back to block.id.
    const host = {
      readMountedProjectionBlocks: () => [
        { kind: 'paragraph', id: 'P1', runs: [{ kind: 'text', text: 'x', fontFamily: 'Tahoma, sans-serif' }] },
      ],
      getPendingInlineFormat: () => null,
      setPendingInlineFormat: vi.fn(),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBe('Tahoma');
  });

  it('resolves color and highlight effective-at-caret from the run, like font/size (SD-3654)', () => {
    // After a stored color/highlight mark is consumed by the first insert, the
    // caret has no direct projection - the swatch must still reflect the run's
    // color/highlight (resolved from the layout) instead of resetting.
    const host = {
      readMountedProjectionBlocks: () => [
        { kind: 'paragraph', id: 'P1', runs: [{ kind: 'text', text: 'x', color: '#ff0000', highlight: '#ffff00' }] },
      ],
      getPendingInlineFormat: () => null,
      setPendingInlineFormat: vi.fn(),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { color: vi.fn(), highlight: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('text-color').getState().value).toBe('#FF0000');
    expect(ui.commands.get('highlight-color').getState().value).toBe('#FFFF00');
  });

  // --- Font/size stored marks at a collapsed caret (SD-3652) ----------------
  const caretSelectionInfo = (blockId: string, offset: number) => {
    const point = { kind: 'text', blockId, offset };
    const target = { kind: 'selection', start: point, end: point };
    return {
      empty: true,
      target,
      selectionTarget: target,
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: '',
    };
  };
  const storeCapableHost = (extra: Record<string, unknown> = {}) => ({
    getPendingInlineFormat: () => null,
    setPendingInlineFormat: vi.fn(),
    getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    ...extra,
  });

  it('seeds a collapsed caret immediately but defers its worker validation during foreground typing', async () => {
    vi.useFakeTimers();
    const seed = caretSelectionInfo('P1', 1);
    let foreground = { active: 1, pending: 0 };
    let publishSelection: (() => void) | null = null;
    const current = vi.fn(async () => seed);
    const host = storeCapableHost({
      getForegroundMutationState: () => foreground,
      readLiveSelectionSyncSnapshot: () => seed,
      readMountedProjectionBlocksByIds: () => [
        {
          kind: 'paragraph',
          id: 'P1',
          runs: [{ kind: 'text', text: 'x', fontFamily: 'Tahoma, sans-serif' }],
        },
      ],
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      { selection: { current }, format: { fontFamily: vi.fn() } },
      { selectionInfo: null, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });

    publishSelection?.();
    expect(ui.commands.get('font-family').getState().value).toBe('Tahoma');
    expect(current).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(120);
    expect(current).not.toHaveBeenCalled();
    foreground = { active: 0, pending: 0 };
    await vi.advanceTimersByTimeAsync(120);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('does not publish unresolved font values before an Enter-created paragraph paints (SD-4464)', async () => {
    let selection = caretSelectionInfo('P1', 1);
    let mountedBlocks = [
      {
        kind: 'paragraph',
        id: 'P1',
        runs: [{ kind: 'text', text: 'a', fontFamily: 'Tahoma, sans-serif', fontSize: 16 }],
      },
    ];
    let foreground = { active: 0, pending: 0 };
    let publishSelection: (() => void) | null = null;
    let resolvePaint: () => void = () => undefined;
    const painted = new Promise<void>((resolve) => {
      resolvePaint = resolve;
    });
    const whenPainted = vi.fn(() => painted);
    const host = storeCapableHost({
      getForegroundMutationState: () => foreground,
      readLiveSelectionSyncSnapshot: () => selection,
      readMountedProjectionBlocksByIds: () => mountedBlocks,
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      {
        selection: { current: () => selection },
        format: { fontFamily: vi.fn(), fontSize: vi.fn() },
      },
      {
        selectionInfo: null,
        editorExtra: {
          host,
          documentMutationReadiness: { getRenderEpoch: () => 17, whenPainted },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    publishSelection?.();
    expect(ui.commands.get('font-family').getState().value).toBe('Tahoma');
    expect(ui.commands.get('font-size').getState().value).toBe('12');

    const publishedFamilies: unknown[] = [];
    const publishedSizes: unknown[] = [];
    const stopFamily = ui.commands.get('font-family').observe((state) => publishedFamilies.push(state.value));
    const stopSize = ui.commands.get('font-size').observe((state) => publishedSizes.push(state.value));

    foreground = { active: 1, pending: 0 };
    selection = caretSelectionInfo('P2', 0);
    publishSelection?.();

    expect(ui.commands.get('font-family').getState().value).toBe('Tahoma');
    expect(ui.commands.get('font-size').getState().value).toBe('12');
    expect(publishedFamilies.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
    expect(
      publishedSizes.every(
        (value) =>
          (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isFinite(value)),
      ),
    ).toBe(true);

    foreground = { active: 0, pending: 0 };
    mountedBlocks = [
      {
        kind: 'paragraph',
        id: 'P2',
        runs: [{ kind: 'text', text: '', fontFamily: 'Cambria, serif', fontSize: 20 }],
      },
    ];
    resolvePaint();

    await vi.waitFor(() => expect(ui.commands.get('font-family').getState().value).toBe('Cambria'));
    expect(ui.commands.get('font-size').getState().value).toBe('15');
    expect(whenPainted).toHaveBeenCalledWith({ afterEpoch: 17 });
    expect(publishedFamilies.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
    expect(
      publishedSizes.every(
        (value) =>
          (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isFinite(value)),
      ),
    ).toBe(true);
    stopFamily();
    stopSize();
    ui.destroy();
  });

  it('does not preflight the mounted projection when foreground typing keeps the caret in the same block', () => {
    let selection = caretSelectionInfo('P1', 1);
    let foreground = { active: 0, pending: 0 };
    let publishSelection: (() => void) | null = null;
    const readMountedProjectionBlocksByIds = vi.fn(() => [
      {
        kind: 'paragraph',
        id: 'P1',
        runs: [{ kind: 'text', text: 'ab', fontFamily: 'Tahoma, sans-serif', fontSize: 16 }],
      },
    ]);
    const whenPainted = vi.fn(() => Promise.resolve());
    const host = storeCapableHost({
      getForegroundMutationState: () => foreground,
      readLiveSelectionSyncSnapshot: () => selection,
      readMountedProjectionBlocksByIds,
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      {
        selection: { current: () => selection },
        format: { fontFamily: vi.fn(), fontSize: vi.fn() },
      },
      {
        selectionInfo: selection,
        editorExtra: {
          host,
          documentMutationReadiness: { getRenderEpoch: () => 17, whenPainted },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    readMountedProjectionBlocksByIds.mockClear();

    selection = caretSelectionInfo('P1', 2);
    publishSelection?.();
    const ordinaryCaretRefreshReads = readMountedProjectionBlocksByIds.mock.calls.length;
    expect(ordinaryCaretRefreshReads).toBeGreaterThan(0);

    readMountedProjectionBlocksByIds.mockClear();
    foreground = { active: 1, pending: 0 };
    selection = caretSelectionInfo('P1', 3);
    publishSelection?.();

    expect(whenPainted).not.toHaveBeenCalled();
    expect(readMountedProjectionBlocksByIds).toHaveBeenCalledTimes(ordinaryCaretRefreshReads);
    expect(ui.selection.getSnapshot().selectionTarget).toMatchObject({
      start: { blockId: 'P1', offset: 3 },
      end: { blockId: 'P1', offset: 3 },
    });
    ui.destroy();
  });

  it('publishes the latest caret immediately when post-paint readiness rejects', async () => {
    let selection = caretSelectionInfo('P1', 1);
    let foreground = { active: 0, pending: 0 };
    let publishSelection: (() => void) | null = null;
    const whenPainted = vi.fn(() => Promise.reject(new Error('paint unavailable')));
    const host = storeCapableHost({
      getForegroundMutationState: () => foreground,
      readLiveSelectionSyncSnapshot: () => selection,
      readMountedProjectionBlocksByIds: (blockIds: string[]) =>
        blockIds.includes('P1')
          ? [
              {
                kind: 'paragraph',
                id: 'P1',
                runs: [{ kind: 'text', text: 'a', fontFamily: 'Tahoma, sans-serif', fontSize: 16 }],
              },
            ]
          : [],
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      {
        selection: { current: () => selection },
        format: { fontFamily: vi.fn(), fontSize: vi.fn() },
      },
      {
        selectionInfo: selection,
        editorExtra: {
          host,
          documentMutationReadiness: { getRenderEpoch: () => 17, whenPainted },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    publishSelection?.();
    expect(ui.commands.get('font-family').getState().value).toBe('Tahoma');

    foreground = { active: 1, pending: 0 };
    selection = caretSelectionInfo('P2', 0);
    publishSelection?.();

    await vi.waitFor(() =>
      expect(ui.selection.getSnapshot().selectionTarget).toMatchObject({
        start: { blockId: 'P2', offset: 0 },
        end: { blockId: 'P2', offset: 0 },
      }),
    );
    expect(whenPainted).toHaveBeenCalledWith({ afterEpoch: 17 });
    expect(ui.commands.get('font-family').getState().value).toBeUndefined();
    ui.destroy();
  });

  it('keeps tracked-change overlap active while a foreground caret seed remains on its painted carrier (SD-3799)', () => {
    const settledSelection = {
      ...caretSelectionInfo('P1', 1),
      activeCommentIds: ['comment-1'],
      activeChangeIds: ['change-1'],
    };
    const localCaretSeed = caretSelectionInfo('P1', 2);
    let publishSelection: ((snapshot?: unknown) => void) | null = null;
    const host = storeCapableHost({
      readLiveSelectionSyncSnapshot: () => localCaretSeed,
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: (snapshot?: unknown) => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      {
        trackChanges: { list: () => ({ items: [{ id: 'change-1', type: 'insert' }] }) },
      },
      { selectionInfo: settledSelection, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.getSnapshot().activeId).toBe('change-1');

    (host as Record<string, unknown>).getForegroundMutationState = () => ({ active: 1, pending: 0 });
    const sameTrackedCarrier = {
      anchor: { visualCaret: { trackChangeId: 'change-1' } },
      focus: { visualCaret: { trackChangeId: 'change-1' } },
    };
    publishSelection?.(sameTrackedCarrier);

    expect(ui.selection.getSnapshot().activeCommentIds).toEqual([]);
    expect(ui.selection.getSnapshot().activeChangeIds).toEqual(['change-1']);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('change-1');
  });

  it('clears review overlap when a foreground caret seed moves outside the active change', async () => {
    const settledSelection = {
      ...caretSelectionInfo('P1', 1),
      activeCommentIds: ['comment-1'],
      activeChangeIds: ['change-1'],
    };
    const localCaretSeed = caretSelectionInfo('P2', 4);
    let publishSelection: (() => void) | null = null;
    const host = storeCapableHost({
      readLiveSelectionSyncSnapshot: () => localCaretSeed,
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const decide = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc(
      {
        trackChanges: {
          list: () => ({ items: [{ id: 'change-1', type: 'insert' }] }),
          decide,
        },
      },
      { selectionInfo: settledSelection, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.trackChanges.getSnapshot().activeId).toBe('change-1');

    (host as Record<string, unknown>).getForegroundMutationState = () => ({ active: 1, pending: 0 });
    publishSelection?.();

    expect(ui.selection.getSnapshot().activeCommentIds).toEqual([]);
    expect(ui.selection.getSnapshot().activeChangeIds).toEqual([]);
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    expect(ui.commands.get(BUILT_IN_COMMAND_IDS.acceptChange).getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.selectionRequired,
    });
    expect(await ui.toolbar.execute(BUILT_IN_COMMAND_IDS.acceptChange)).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('keeps tracked-change overlap for an adjacent caret shift during an active typing dispatch', () => {
    const settledSelection = {
      ...caretSelectionInfo('P1', 1),
      activeChangeIds: ['change-1'],
    };
    const localCaretSeed = caretSelectionInfo('P1', 2);
    let publishSelection: (() => void) | null = null;
    const host = storeCapableHost({
      readLiveSelectionSyncSnapshot: () => localCaretSeed,
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      { trackChanges: { list: () => ({ items: [{ id: 'change-1', type: 'insert' }] }) } },
      { selectionInfo: settledSelection, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.selection.getSnapshot()).toMatchObject({
      selectionTarget: settledSelection.selectionTarget,
      activeChangeIds: ['change-1'],
    });
    (host as Record<string, unknown>).getForegroundMutationState = () => ({ active: 1, pending: 1 });
    publishSelection?.();

    expect(ui.selection.getSnapshot().activeChangeIds).toEqual(['change-1']);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('change-1');
  });

  it('does not carry tracked-change overlap through pending work without carrier proof', () => {
    const settledSelection = {
      ...caretSelectionInfo('P1', 1),
      activeChangeIds: ['change-1'],
    };
    const localCaretSeed = caretSelectionInfo('P1', 2);
    let publishSelection: (() => void) | null = null;
    const host = storeCapableHost({
      readLiveSelectionSyncSnapshot: () => localCaretSeed,
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              publishSelection = listener;
              return () => {};
            },
          },
        },
      }),
    });
    const superdoc = makeBlockSuperdoc(
      { trackChanges: { list: () => ({ items: [{ id: 'change-1', type: 'insert' }] }) } },
      { selectionInfo: settledSelection, editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });

    (host as Record<string, unknown>).getForegroundMutationState = () => ({ active: 0, pending: 1 });
    publishSelection?.();

    expect(ui.selection.getSnapshot().activeChangeIds).toEqual([]);
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
  });

  it('enables font-family at a collapsed caret when the host can store a pending mark (SD-3652)', () => {
    const host = storeCapableHost();
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    // "Set the font, then type" flow: the pick must register at a caret.
    expect(ui.commands.get('font-family').getState()).toMatchObject({ enabled: true, supported: true });
  });

  it('keeps font-family disabled at a caret when the host cannot store pending marks (SD-3652)', () => {
    // No setPendingInlineFormat -> no place to hold the pick, so fail closed.
    const host = { getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }) };
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState()).toMatchObject({
      enabled: false,
      reason: 'range-selection-required',
    });
  });

  it('stores a font picked at a caret as a pending mark instead of calling the API (SD-3652)', async () => {
    const setPendingInlineFormat = vi.fn();
    const fontFamily = vi.fn();
    const host = storeCapableHost({ setPendingInlineFormat });
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('font-family', 'Courier New')).toBe(true);
    expect(setPendingInlineFormat).toHaveBeenCalledWith('fontFamily', 'Courier New');
    expect(fontFamily).not.toHaveBeenCalled();
  });

  it('executeAsync reflects a pending-store success at a caret, not false (SD-3652)', async () => {
    // The built-in toolbar uses executeAsync; the caret pending-store path must
    // settle as a success so the pick is not reported as a failed command.
    const setPendingInlineFormat = vi.fn();
    const host = storeCapableHost({ setPendingInlineFormat });
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    const result = await ui.toolbar.executeAsync('font-family', 'Courier New');
    expect(result).not.toBe(false);
    expect(result).toBe(true);
    expect(setPendingInlineFormat).toHaveBeenCalledWith('fontFamily', 'Courier New');
  });

  it('shows the pending font at a caret before any text carries it (SD-3652)', () => {
    const host = storeCapableHost({ getPendingInlineFormat: () => ({ fontFamily: 'Courier New' }) });
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 1), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');
  });

  it('reflects the caret run font in a mixed-font paragraph instead of blanking (SD-3652)', () => {
    // Caret at offset 5 sits inside 'def' (chars [3,6)); the combobox must show
    // that run's font, not blank (as whole-block uniformity would give).
    const host = storeCapableHost({
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [
            { kind: 'text', text: 'abc', fontFamily: 'Arial, sans-serif', fontSize: 16 },
            { kind: 'text', text: 'def', fontFamily: 'Courier New, monospace', fontSize: 16 },
          ],
        },
      ],
    });
    const superdoc = makeBlockSuperdoc(
      { format: { fontFamily: vi.fn() } },
      { selectionInfo: caretSelectionInfo('P1', 5), editorExtra: { host } },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');
  });

  it('reports the selected range font in a mixed-font paragraph, not the whole block (SD-3652)', () => {
    // Selecting the uniform 'def' (Courier) inside a paragraph that also holds
    // 'abc' (Arial) must show Courier - not blank, as whole-block uniformity gave.
    const host = storeCapableHost({
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [
            { kind: 'text', text: 'abc', fontFamily: 'Arial, sans-serif', fontSize: 16 },
            { kind: 'text', text: 'def', fontFamily: 'Courier New, monospace', fontSize: 16 },
          ],
        },
      ],
    });
    // Range selection over offsets [3,6) = 'def'.
    const segTarget = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 3, end: 6 } }] };
    const selectionInfo = {
      empty: false,
      target: segTarget,
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 3 },
        end: { kind: 'text', blockId: 'P1', offset: 6 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'def',
    };
    const superdoc = makeBlockSuperdoc({ format: { fontFamily: vi.fn() } }, { selectionInfo, editorExtra: { host } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');
  });

  it('blanks the font for a selection spanning two fonts (SD-3652)', () => {
    // Selecting across BOTH 'abc' (Arial) and 'def' (Courier) is genuinely mixed
    // -> blank, matching Word.
    const host = storeCapableHost({
      readMountedProjectionBlocks: () => [
        {
          kind: 'paragraph',
          sourceAnchor: { sourceNodeId: 'P1' },
          runs: [
            { kind: 'text', text: 'abc', fontFamily: 'Arial, sans-serif', fontSize: 16 },
            { kind: 'text', text: 'def', fontFamily: 'Courier New, monospace', fontSize: 16 },
          ],
        },
      ],
    });
    const segTarget = { kind: 'text', segments: [{ blockId: 'P1', range: { start: 1, end: 5 } }] };
    const selectionInfo = {
      empty: false,
      target: segTarget,
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 1 },
        end: { kind: 'text', blockId: 'P1', offset: 5 },
      },
      activeMarks: [] as string[],
      activeCommentIds: [] as string[],
      activeChangeIds: [] as string[],
      text: 'bcde',
    };
    const superdoc = makeBlockSuperdoc({ format: { fontFamily: vi.fn() } }, { selectionInfo, editorExtra: { host } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('font-family').getState().value).toBeUndefined();
  });

  it('routes paragraph format toolbar commands as tracked mutations in suggesting mode', async () => {
    const setAlignment = vi.fn(() => ({ success: true }));
    const setSpacing = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getNodeById = vi.fn(() => ({
      node: {
        kind: 'paragraph',
        paragraph: { props: { indent: { left: 0 } } },
      },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent: vi.fn(() => ({ success: true })), getState },
        format: { paragraph: { setAlignment, setSpacing, setIndentation } },
        getNodeById,
      },
      { mode: 'suggesting', selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('text-align', 'center')).toMatchObject({ success: true });
    expect(setAlignment).toHaveBeenCalledWith(
      { target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' }, alignment: 'center' },
      { changeMode: 'tracked' },
    );
    expect(await ui.toolbar.execute('line-height', 1.5)).toMatchObject({ success: true });
    expect(setSpacing).toHaveBeenCalledWith(
      { target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' }, line: 360, lineRule: 'auto' },
      { changeMode: 'tracked' },
    );
    expect(await ui.toolbar.executeAsync('indent-increase')).toMatchObject({ success: true });
    expect(setIndentation).toHaveBeenCalledWith(
      { target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' }, left: 720 },
      { changeMode: 'tracked' },
    );
  });

  it('text-align reports the first per-block failure instead of a later success', async () => {
    const failure = { success: false, failure: { code: 'BLOCK_FAILED', message: 'first block failed' } };
    const setAlignment = vi.fn().mockReturnValueOnce(failure).mockReturnValueOnce({ success: true, txId: 'tx-later' });
    const superdoc = makeBlockSuperdoc({ format: { paragraph: { setAlignment } } });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('text-align', 'center')).toBe(failure);
    expect(setAlignment).toHaveBeenCalledTimes(2);
  });

  it('text-align normalizes legacy alignment payloads and fails closed on invalid values', async () => {
    const setAlignment = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ format: { paragraph: { setAlignment } } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('text-align', { value: 'Justified' });
    expect(setAlignment).toHaveBeenCalledWith(expect.objectContaining({ alignment: 'justify' }));
    setAlignment.mockClear();
    expect(await ui.toolbar.execute('text-align', 'sideways')).toBe(false);
    expect(setAlignment).not.toHaveBeenCalled();
  });

  it('line-height routes format.paragraph.setSpacing with a 240ths line value', async () => {
    const setSpacing = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ format: { paragraph: { setSpacing } } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('line-height', 1.5);
    expect(setSpacing).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      line: 360,
      lineRule: 'auto',
    });
  });

  it('line-height preserves the selection story on paragraph targets', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' } as const;
    const setSpacing = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc(
      { format: { paragraph: { setSpacing } } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    await ui.toolbar.execute('line-height', 1.5);

    expect(setSpacing).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1', story },
      line: 360,
      lineRule: 'auto',
    });
  });

  it('linked-style routes styles.paragraph.setStyle with a style id', async () => {
    const setStyle = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ styles: { paragraph: { setStyle } } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('linked-style', { styleId: 'Heading1' });
    expect(setStyle).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      styleId: 'Heading1',
    });
  });

  it('direction-ltr / direction-rtl route format.paragraph.setDirection with the fixed value', async () => {
    const setDirection = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ format: { paragraph: { setDirection } } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('direction-rtl');
    expect(setDirection).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      direction: 'rtl',
    });
    setDirection.mockClear();
    await ui.toolbar.execute('direction-ltr');
    expect(setDirection).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      direction: 'ltr',
    });
  });

  // --- Stored inline marks on a collapsed caret (SD-3654) -------------------
  // A collapsed caret carries `empty: true` but still sits in a block.
  const COLLAPSED_CARET_INFO = {
    empty: true,
    target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 0 } }] },
    selectionTarget: {
      kind: 'selection',
      start: { kind: 'text', blockId: 'P1', offset: 0 },
      end: { kind: 'text', blockId: 'P1', offset: 0 },
    },
    activeMarks: [] as string[],
    activeCommentIds: [] as string[],
    activeChangeIds: [] as string[],
    text: '',
  } as const;

  function makeCaretSuperdocWithPendingHost(docExtra: Record<string, unknown> = {}) {
    const store = new Map<string, boolean | string | number | null>();
    const host = {
      getPendingInlineFormat: () => (store.size ? Object.fromEntries(store) : null),
      setPendingInlineFormat: vi.fn((method: string, value: boolean | string | number | null) =>
        store.set(method, value),
      ),
      clearPendingInlineFormat: vi.fn((method?: string) =>
        method === undefined ? store.clear() : store.delete(method),
      ),
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(docExtra, { selectionInfo: COLLAPSED_CARET_INFO, editorExtra: { host } });
    return { superdoc, host, store };
  }

  it('bold on a collapsed caret is enabled and stores a pending mark instead of failing closed (SD-3654)', async () => {
    const { superdoc, host } = makeCaretSuperdocWithPendingHost({ format: { bold: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });

    // Enabled (not range-selection-required) because the caret can store a mark.
    expect(ui.commands.get('bold').getState()).toMatchObject({ enabled: true, supported: true, active: false });

    await ui.toolbar.execute('bold');
    expect(host.setPendingInlineFormat).toHaveBeenCalledWith('bold', true);
    // Now the button reflects the stored mark as active.
    expect(ui.commands.get('bold').getState().active).toBe(true);
  });

  it('toggling a stored mark twice flips it off (SD-3654)', async () => {
    const { superdoc, host } = makeCaretSuperdocWithPendingHost({ format: { bold: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('bold');
    expect(host.setPendingInlineFormat).toHaveBeenLastCalledWith('bold', true);
    await ui.toolbar.execute('bold');
    expect(host.setPendingInlineFormat).toHaveBeenLastCalledWith('bold', false);
    expect(ui.commands.get('bold').getState().active).toBe(false);
  });

  it('strikethrough stores the pending mark under its format method name, not its inline key (SD-3654)', async () => {
    const { superdoc, host } = makeCaretSuperdocWithPendingHost({ format: { strikethrough: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('strikethrough');
    expect(host.setPendingInlineFormat).toHaveBeenCalledWith('strikethrough', true);
  });

  it('text-color on a collapsed caret stores the color value; a null value stores a pending null (SD-3654)', async () => {
    const { superdoc, host } = makeCaretSuperdocWithPendingHost({ format: { color: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.execute('text-color', '#FF0000');
    expect(host.setPendingInlineFormat).toHaveBeenCalledWith('color', '#FF0000');
    // A "None"/cleared value at a caret stores a pending null so the next typed
    // text is explicitly cleared, rather than inheriting the neighbour's color.
    await ui.toolbar.execute('text-color', null);
    expect(host.setPendingInlineFormat).toHaveBeenLastCalledWith('color', null);
  });

  function makePreArmedCaretSuperdoc(activeMarks: string[]) {
    const store = new Map<string, boolean | string | number | null>([['bold', true]]);
    const clearPendingInlineFormat = vi.fn((method?: string) =>
      method === undefined ? store.clear() : store.delete(method),
    );
    const host = {
      getPendingInlineFormat: () => (store.size ? Object.fromEntries(store) : null),
      setPendingInlineFormat: vi.fn(),
      clearPendingInlineFormat,
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { bold: vi.fn() } },
      { selectionInfo: { ...COLLAPSED_CARET_INFO, activeMarks }, editorExtra: { host } },
    );
    return { superdoc, clearPendingInlineFormat };
  }

  it('retires a stored mark once the selection reflects it (SD-3654 reconcile)', async () => {
    // Selection already reports bold → the armed mark is redundant and is cleared,
    // handing the button off to the real marks with no gap.
    const { superdoc, clearPendingInlineFormat } = makePreArmedCaretSuperdoc(['bold']);
    createSuperDocUI({ superdoc });
    expect(clearPendingInlineFormat).toHaveBeenCalledWith('bold');
  });

  it('keeps a stored mark active while the selection has not caught up (SD-3654 reconcile)', async () => {
    // Selection does not yet report bold (the async format has not landed) → keep
    // the mark armed so the toolbar button stays active instead of blinking off.
    const { superdoc, clearPendingInlineFormat } = makePreArmedCaretSuperdoc([]);
    const ui = createSuperDocUI({ superdoc });
    expect(clearPendingInlineFormat).not.toHaveBeenCalled();
    expect(ui.commands.get('bold').getState().active).toBe(true);
  });

  it('does not retire a pending explicit-off mark from an empty caret projection (SD-3941)', () => {
    const store = new Map<string, boolean | string | number | null>([['bold', false]]);
    const clearPendingInlineFormat = vi.fn((method?: string) =>
      method === undefined ? store.clear() : store.delete(method),
    );
    const host = {
      getPendingInlineFormat: () => (store.size ? Object.fromEntries(store) : null),
      setPendingInlineFormat: vi.fn(),
      clearPendingInlineFormat,
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { bold: vi.fn() } },
      { selectionInfo: COLLAPSED_CARET_INFO, editorExtra: { host } },
    );

    const ui = createSuperDocUI({ superdoc });

    expect(clearPendingInlineFormat).not.toHaveBeenCalledWith('bold');
    expect(ui.commands.get('bold').getState().active).toBe(false);
  });

  it('does not retire a pending null ("None") value on reconcile (SD-3654)', async () => {
    // A pending null is an explicit clear-on-next-insert. A collapsed caret
    // projects no color, so `current == null` would spuriously match and retire
    // it before the insert applies it - reconcile must skip it.
    const store = new Map<string, boolean | string | number | null>([['color', null]]);
    const clearPendingInlineFormat = vi.fn((method?: string) =>
      method === undefined ? store.clear() : store.delete(method),
    );
    const host = {
      getPendingInlineFormat: () => (store.size ? Object.fromEntries(store) : null),
      setPendingInlineFormat: vi.fn(),
      clearPendingInlineFormat,
      getHandles: () => ({ editing: { selection: { subscribe: () => () => {} } } }),
    };
    const superdoc = makeBlockSuperdoc(
      { format: { color: vi.fn() } },
      { selectionInfo: COLLAPSED_CARET_INFO, editorExtra: { host } },
    );
    createSuperDocUI({ superdoc });
    expect(clearPendingInlineFormat).not.toHaveBeenCalledWith('color');
  });

  it('inline commands still fail closed on a collapsed caret when the host cannot store marks (SD-3654)', async () => {
    // No host pending API → the classic range-selection-required posture holds.
    const superdoc = makeBlockSuperdoc({ format: { bold: vi.fn() } }, { selectionInfo: COLLAPSED_CARET_INFO });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bold').getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.rangeSelectionRequired,
    });
  });

  it('block paragraph commands fail closed with selection-required when there is no block', async () => {
    const setAlignment = vi.fn();
    const superdoc = makeBlockSuperdoc(
      { format: { paragraph: { setAlignment } } },
      {
        selectionInfo: {
          empty: true,
          target: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('text-align').getState();
    expect(state).toMatchObject({ enabled: false, supported: true, reason: SUPERDOC_UI_REASONS.selectionRequired });
    expect(await ui.toolbar.execute('text-align', 'center')).toBe(false);
    expect(setAlignment).not.toHaveBeenCalled();
  });

  it('bullet-list applies lists.apply with the bullet seed when the block is not yet that kind', async () => {
    const apply = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const superdoc = makeBlockSuperdoc({ lists: { apply, getState, remove: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bullet-list').getState()).toMatchObject({ enabled: true, supported: true, active: false });
    expect(await ui.toolbar.execute('bullet-list')).toMatchObject({ success: true });
    expect(apply).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      seed: 'bullet',
    });
    expect(apply).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
      seed: 'bullet',
    });
  });

  it.each([
    ['lists.getState is missing', undefined],
    ['lists.getState returns an unavailable result', vi.fn(() => ({ success: false }))],
  ])('disables body list toggles when %s', async (_scenario, getState) => {
    const apply = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ lists: { apply, getState } });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('bullet-list').getState()).toMatchObject({
      enabled: false,
      supported: false,
      reason: SUPERDOC_UI_REASONS.operationUnavailable,
    });
    expect(await ui.toolbar.executeAsync('bullet-list')).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('disables body list toggle-off when lists.remove is unavailable', async () => {
    const apply = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc({ lists: { apply, getState } });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('bullet-list').getState()).toMatchObject({
      enabled: false,
      supported: false,
      reason: SUPERDOC_UI_REASONS.operationUnavailable,
    });
    expect(await ui.toolbar.executeAsync('bullet-list')).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('bullet-list applies the seed to only the non-matching blocks in a mixed selection', async () => {
    const apply = vi.fn(() => ({ success: true }));
    const remove = vi.fn(() => ({ success: true }));
    const getState = vi
      .fn()
      .mockImplementation(({ target }: { target: { nodeId: string } }) =>
        target.nodeId === 'P1'
          ? { success: true, isListItem: true, seed: 'bullet' }
          : { success: true, isListItem: false, seed: null },
      );
    const superdoc = makeBlockSuperdoc({ lists: { apply, remove, getState } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bullet-list').getState()).toMatchObject({ active: false });
    expect(await ui.toolbar.execute('bullet-list')).toMatchObject({ success: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
      seed: 'bullet',
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not fan out reactive list-state reads for a document-wide selection', () => {
    const segments = Array.from({ length: 65 }, (_, index) => ({
      blockId: `P${index}`,
      range: { start: 0, end: 1 },
    }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const superdoc = makeBlockSuperdoc(
      { lists: { apply: vi.fn(), remove: vi.fn(), getState } },
      {
        selectionInfo: {
          empty: false,
          target: { kind: 'text', segments },
          selectionTarget: {
            kind: 'selection',
            start: { kind: 'text', blockId: 'P0', offset: 0 },
            end: { kind: 'text', blockId: 'P64', offset: 1 },
          },
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('bullet-list').getState()).toMatchObject({ enabled: true, supported: true });
    expect(getState).not.toHaveBeenCalled();
  });

  it('bullet-list toggles off via lists.remove only when every covered block is already a bullet list', async () => {
    const apply = vi.fn(() => ({ success: true }));
    const remove = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc({ lists: { apply, remove, getState } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('bullet-list').getState()).toMatchObject({ active: true });
    expect(await ui.toolbar.execute('bullet-list')).toMatchObject({ success: true });
    expect(remove).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' } });
    expect(remove).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' } });
    expect(apply).not.toHaveBeenCalled();
  });

  it('bullet-list fails closed when applying a list in a header/footer story', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const apply = vi.fn(() => ({ success: true }));
    const remove = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const superdoc = makeBlockSuperdoc(
      { lists: { apply, remove, getState } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('bullet-list')).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ['bullet-list', 'bullet'],
    ['numbered-list', 'ordered'],
  ] as const)('disables header/footer %s when async state resolves to an apply action', async (commandId) => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const getStateInStory = vi.fn(() => Promise.resolve({ success: true, isListItem: false, seed: null }));
    const superdoc = makeBlockSuperdoc(
      { lists: { apply: vi.fn(), removeInStory: vi.fn(), getStateInStory } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    await vi.waitFor(() => {
      expect(ui.commands.get(commandId).getState()).toMatchObject({
        enabled: false,
        active: false,
        supported: false,
        reason: SUPERDOC_UI_REASONS.operationUnavailable,
      });
    });
  });

  it.each([
    ['bullet-list', 'bullet'],
    ['numbered-list', 'ordered'],
  ] as const)('enables header/footer %s when story-aware removal is supported', (commandId, seed) => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const getStateInStory = vi.fn(() => ({ success: true, isListItem: true, seed }));
    const superdoc = makeBlockSuperdoc(
      { lists: { apply: vi.fn(), removeInStory: vi.fn(), getStateInStory } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get(commandId).getState()).toMatchObject({
      enabled: true,
      active: true,
      supported: true,
    });
  });

  it('bullet-list removes header/footer list formatting through the story-aware seam', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const apply = vi.fn(() => ({ success: true }));
    const remove = vi.fn(() => ({ success: true }));
    const removeInStory = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const getStateInStory = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc(
      { lists: { apply, remove, removeInStory, getState, getStateInStory } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('bullet-list')).toMatchObject({ success: true });
    expect(removeInStory).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      story,
    });
    expect(removeInStory).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
      story,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('bullet-list reads duplicate paragraph ids from the selected header/footer story', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const apply = vi.fn(() => ({ success: true }));
    const remove = vi.fn(() => ({ success: true }));
    const removeInStory = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const getStateInStory = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const superdoc = makeBlockSuperdoc(
      { lists: { apply, remove, removeInStory, getState, getStateInStory } },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    const active = ui.commands.get('bullet-list').getState().active;
    const result = await ui.toolbar.executeAsync('bullet-list');

    expect({ active, result }).toEqual({ active: false, result: false });
    expect(getStateInStory).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      story,
    });
    expect(removeInStory).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('indent-increase / indent-decrease route lists.indent / lists.outdent for list items', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const outdent = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc(
      { lists: { indent, outdent, getState } },
      { selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });
    await ui.toolbar.executeAsync('indent-increase');
    expect(indent).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'listItem', nodeId: 'P1' } });
    await ui.toolbar.executeAsync('indent-decrease');
    expect(outdent).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'listItem', nodeId: 'P1' } });
  });

  it('routes linked/custom list items through list indent when their list seed is null', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const outdent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const clearIndentation = vi.fn(() => ({ success: true }));
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { indent: { left: 36 } } } },
    }));
    // `seed: null` is valid for list definitions imported through Word style
    // links. Membership is the `isListItem` flag, not the optional seed.
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: null }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent, outdent, getState },
        format: { paragraph: { setIndentation, clearIndentation } },
        getNodeById,
      },
      { selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.executeAsync('indent-increase')).toMatchObject({ success: true });
    expect(indent).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'listItem', nodeId: 'P1' } });
    expect(await ui.toolbar.executeAsync('indent-decrease')).toMatchObject({ success: true });
    expect(outdent).toHaveBeenCalledWith({ target: { kind: 'block', nodeType: 'listItem', nodeId: 'P1' } });
    expect(setIndentation).not.toHaveBeenCalled();
    expect(clearIndentation).not.toHaveBeenCalled();
  });

  it('fails toolbar indent closed when list membership cannot be resolved', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { indent: { left: 36 } } } },
    }));
    const getState = vi.fn(() => ({ success: false, failure: { code: 'TARGET_UNRESOLVED' } }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent, getState },
        format: { paragraph: { setIndentation } },
        getNodeById,
      },
      { selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.executeAsync('indent-increase')).toBe(false);
    expect(indent).not.toHaveBeenCalled();
    expect(setIndentation).not.toHaveBeenCalled();
  });

  it('indent-increase routes plain paragraphs through format.paragraph.setIndentation', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getNodeById = vi.fn(() => ({
      node: {
        kind: 'paragraph',
        paragraph: {
          props: {
            indent: {
              left: 36,
              right: 12,
              firstLine: 18,
            },
          },
        },
      },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent, getState },
        format: { paragraph: { setIndentation } },
        getNodeById,
      },
      { selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('indent-increase').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.executeAsync('indent-increase')).toMatchObject({ success: true });
    expect(indent).not.toHaveBeenCalled();
    expect(setIndentation).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      left: 1440,
      right: 240,
      firstLine: 360,
    });
  });

  it('fails toolbar indentation closed when header/footer indentation cannot be read in-story', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const indent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getStateInStory = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { indent: { left: 36 } } } },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent, getState, getStateInStory },
        format: { paragraph: { setIndentation } },
        getNodeById,
      },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    for (const commandId of ['indent-increase', 'indent-decrease'] as const) {
      expect(ui.commands.get(commandId).getState()).toMatchObject({ enabled: false, supported: false });
      expect(await ui.toolbar.executeAsync(commandId)).toBe(false);
    }
    expect(setIndentation).not.toHaveBeenCalled();
    expect(indent).not.toHaveBeenCalled();
  });

  it.each([
    ['the story-aware read is missing', undefined],
    ['the story-aware read is unavailable', vi.fn(() => ({ success: false }))],
  ])('fails toolbar indent closed when %s', async (_scenario, getStateInStory) => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const indent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent, getState, getStateInStory },
        format: { paragraph: { setIndentation } },
      },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('indent-increase').getState()).toMatchObject({ enabled: false, supported: false });
    expect(await ui.toolbar.executeAsync('indent-increase')).toBe(false);
    expect(getState).not.toHaveBeenCalled();
    expect(indent).not.toHaveBeenCalled();
    expect(setIndentation).not.toHaveBeenCalled();
  });

  it('indent-increase reads hybrid paragraph indentation from the selected header/footer story', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const indent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getStateInStory = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { indent: { left: 72, right: 24 } } } },
    }));
    const getNode = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { props: { indent: { left: 36, right: 12 } } } },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { indent, getState, getStateInStory },
        format: { paragraph: { setIndentation } },
        getNode,
        getNodeById,
      },
      { selectionInfo: multiSelectionInfoInStory(story) },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.executeAsync('indent-increase')).toMatchObject({ success: true });
    expect(getNode).toHaveBeenCalledWith({
      kind: 'block',
      nodeType: 'paragraph',
      nodeId: 'P1',
      story,
    });
    expect(setIndentation).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1', story },
      left: 1440,
      right: 240,
    });
    expect(indent).not.toHaveBeenCalled();
  });

  it('indent-decrease clears plain paragraph indentation when the next step reaches zero', async () => {
    const outdent = vi.fn(() => ({ success: true }));
    const clearIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: false, seed: null }));
    const getNodeById = vi.fn(() => ({
      node: {
        kind: 'paragraph',
        paragraph: {
          props: {
            indent: {
              left: 36,
            },
          },
        },
      },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { outdent, getState },
        format: { paragraph: { setIndentation: vi.fn(), clearIndentation } },
        getNodeById,
      },
      { selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('indent-decrease').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.executeAsync('indent-decrease')).toMatchObject({ success: true });
    expect(outdent).not.toHaveBeenCalled();
    expect(clearIndentation).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
    });
  });

  it('indent-increase routes an all-list selection through one story-aware range mutation', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const indentRange = vi.fn(() => ({ success: true, txId: 'indent-range-1' }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(async () => ({ success: true, isListItem: true, seed: 'bullet' }));
    const getStateInStory = vi.fn(async () => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc({
      lists: { indent, indentRange, getState, getStateInStory },
      format: { paragraph: { setIndentation } },
    });
    const ui = createSuperDocUI({ superdoc });

    await ui.toolbar.executeAsync('indent-increase');

    expect(getStateInStory).toHaveBeenCalledTimes(4);
    expect(indentRange).toHaveBeenCalledWith({
      paraIds: ['P1', 'P2'],
      story: { kind: 'story', storyType: 'body' },
    });
    expect(indent).not.toHaveBeenCalled();
    expect(setIndentation).not.toHaveBeenCalled();
  });

  it('indent-decrease routes an all-list selection through one story-aware range mutation', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' } as const;
    const outdent = vi.fn(() => ({ success: true }));
    const outdentRange = vi.fn(() => ({ success: true, txId: 'outdent-range-1' }));
    const clearIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(async () => ({ success: true, isListItem: true, seed: 'ordered' }));
    const getStateInStory = vi.fn(async () => ({ success: true, isListItem: true, seed: 'ordered' }));
    const superdoc = makeBlockSuperdoc(
      {
        lists: { outdent, outdentRange, getState, getStateInStory },
        format: { paragraph: { setIndentation: vi.fn(), clearIndentation } },
      },
      {
        selectionInfo: {
          empty: false,
          target: { ...MULTI_TARGET, story },
          selectionTarget: { ...MULTI_SELECTION_TARGET, story },
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: 'hello',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('indent-decrease').getState()).toMatchObject({ enabled: true, supported: true });
    await ui.toolbar.executeAsync('indent-decrease');

    // State resolves every selected item before advertising the range route;
    // execution then performs its own authoritative reads.
    expect(getStateInStory).toHaveBeenCalledTimes(6);
    expect(getStateInStory).toHaveBeenNthCalledWith(1, {
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      story,
    });
    expect(outdentRange).toHaveBeenCalledWith({
      paraIds: ['P1', 'P2'],
      story,
    });
    expect(outdent).not.toHaveBeenCalled();
    expect(clearIndentation).not.toHaveBeenCalled();
  });

  it('falls back to per-item list mutations when the range operation is unavailable', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const getState = vi.fn(async () => ({ success: true, isListItem: true, seed: 'bullet' }));
    const getStateInStory = vi.fn(async () => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc({ lists: { indent, getState, getStateInStory } });
    const ui = createSuperDocUI({ superdoc });

    await ui.toolbar.executeAsync('indent-increase');

    expect(indent).toHaveBeenCalledWith({
      target: {
        kind: 'block',
        nodeType: 'listItem',
        nodeId: 'P1',
      },
    });
    expect(indent).toHaveBeenCalledWith({
      target: {
        kind: 'block',
        nodeType: 'listItem',
        nodeId: 'P2',
      },
    });
  });

  it('fails per-item list indent closed in a header/footer story', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const indent = vi.fn(() => ({ success: true }));
    const indentRange = vi.fn(() => ({ success: true }));
    const getState = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const getStateInStory = vi.fn(() => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc(
      { lists: { indent, indentRange, getState, getStateInStory } },
      { selectionInfo: multiSelectionInfoInStory(story), mode: 'suggesting' },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('indent-increase').getState()).toMatchObject({
      enabled: false,
      supported: false,
      reason: SUPERDOC_UI_REASONS.operationUnavailable,
    });
    expect(await ui.toolbar.executeAsync('indent-increase')).toBe(false);
    expect(indentRange).not.toHaveBeenCalled();
    expect(indent).not.toHaveBeenCalled();
  });

  it('routes per-item list outdent through the header/footer story-aware seam', async () => {
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    const outdent = vi.fn(() => ({ success: true }));
    const outdentRange = vi.fn(() => ({ success: true }));
    const outdentInStory = vi.fn(() => ({ success: true }));
    const getState = vi.fn(async () => ({ success: true, isListItem: true, seed: 'bullet' }));
    const getStateInStory = vi.fn(async () => ({ success: true, isListItem: true, seed: 'bullet' }));
    const superdoc = makeBlockSuperdoc(
      { lists: { outdent, outdentRange, outdentInStory, getState, getStateInStory } },
      { selectionInfo: multiSelectionInfoInStory(story), mode: 'suggesting' },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.executeAsync('indent-decrease')).toMatchObject({ success: true });
    expect(outdentInStory).toHaveBeenCalledWith(
      {
        target: { kind: 'block', nodeType: 'listItem', nodeId: 'P1' },
        story,
      },
      { changeMode: 'tracked' },
    );
    expect(outdentInStory).toHaveBeenCalledWith(
      {
        target: { kind: 'block', nodeType: 'listItem', nodeId: 'P2' },
        story,
      },
      { changeMode: 'tracked' },
    );
    expect(outdentRange).not.toHaveBeenCalled();
    expect(outdent).not.toHaveBeenCalled();
  });

  it('indent-increase computes each non-list block indent from its own awaited node read (SD-3659)', async () => {
    const indent = vi.fn(() => ({ success: true }));
    const setIndentation = vi.fn(() => ({ success: true }));
    const getState = vi.fn(async () => ({ success: true, isListItem: false, seed: null }));
    // Each block has a different existing left indent; the awaited node read must
    // be consulted per block so the +720twip step builds on the block's own value.
    const getNodeById = vi.fn(async ({ nodeId }: { nodeId: string }) => ({
      node: { kind: 'paragraph', paragraph: { props: { indent: { left: nodeId === 'P1' ? 36 : 72 } } } },
    }));
    const superdoc = makeBlockSuperdoc({
      lists: { indent, getState },
      format: { paragraph: { setIndentation } },
      getNodeById,
    });
    const ui = createSuperDocUI({ superdoc });

    await ui.toolbar.executeAsync('indent-increase');

    expect(indent).not.toHaveBeenCalled();
    expect(setIndentation).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
      left: 1440,
    });
    expect(setIndentation).toHaveBeenCalledWith({
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P2' },
      left: 2160,
    });
  });

  it('link wraps the selected text through hyperlinks.wrap when there is no active link', async () => {
    const wrap = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [] }));
    const superdoc = makeBlockSuperdoc({ hyperlinks: { wrap, list, patch: vi.fn(), remove: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('link').getState()).toMatchObject({ enabled: true, supported: true, active: false });
    expect(await ui.toolbar.execute('link', 'https://example.com')).toMatchObject({ success: true });
    expect(wrap).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 5 } },
      link: { destination: { href: 'https://example.com' } },
    });
    expect(wrap).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P2', range: { start: 0, end: 3 } },
      link: { destination: { href: 'https://example.com' } },
    });
  });

  it('link wraps a captured target even after the live selection is empty', async () => {
    const wrap = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [] }));
    const superdoc = makeBlockSuperdoc(
      { hyperlinks: { wrap, list, patch: vi.fn(), remove: vi.fn() } },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(
      await ui.toolbar.execute('link', {
        href: 'https://example.com',
        capture: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          quotedText: 'hello',
          capturedAt: 1,
        },
      }),
    ).toMatchObject({ success: true });
    expect(wrap).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 5 } },
      link: { destination: { href: 'https://example.com' } },
    });
    expect(wrap).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P2', range: { start: 0, end: 3 } },
      link: { destination: { href: 'https://example.com' } },
    });
  });

  it('link wraps the toolbar textTarget after its popover collapses the live selection', async () => {
    const wrap = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [] }));
    const superdoc = makeBlockSuperdoc(
      { hyperlinks: { wrap, list, patch: vi.fn(), remove: vi.fn() } },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(
      await ui.toolbar.execute('link', {
        href: 'https://example.com',
        textTarget: SELECTION_TARGET,
        text: 'hello',
      }),
    ).toMatchObject({ success: true });

    expect(wrap).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 5 } },
      link: { destination: { href: 'https://example.com' } },
    });
  });

  it('link inserts linked text at a collapsed selection target', async () => {
    const insert = vi.fn(() => ({ success: true }));
    const wrap = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [] }));
    const superdoc = makeBlockSuperdoc(
      { hyperlinks: { wrap, insert, list, patch: vi.fn(), remove: vi.fn() } },
      { selectionInfo: SINGLE_BLOCK_SELECTION_INFO },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('link').getState()).toMatchObject({ enabled: true, supported: true, active: false });
    expect(await ui.toolbar.execute('link', { href: 'https://example.com', text: 'Example' })).toMatchObject({
      success: true,
    });
    expect(wrap).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 0 } },
      text: 'Example',
      link: { destination: { href: 'https://example.com' } },
    });
  });

  it('link fails closed when no live selection or explicit target exists', async () => {
    const insert = vi.fn(() => ({ success: true }));
    const wrap = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [] }));
    const superdoc = makeBlockSuperdoc(
      { hyperlinks: { wrap, insert, list, patch: vi.fn(), remove: vi.fn() } },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('link').getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.rangeSelectionRequired,
    });
    expect(await ui.toolbar.execute('link', { href: 'https://example.com', text: 'Example' })).toBe(false);
    expect(wrap).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('link patches an active link href through hyperlinks.patch', async () => {
    const address = linkAddress(0, 5);
    const patch = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [{ address, properties: { href: 'https://old.example' } }] }));
    const superdoc = makeBlockSuperdoc(
      { hyperlinks: { wrap: vi.fn(), patch, remove: vi.fn(), list } },
      {
        selectionInfo: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'hello',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    const state = ui.commands.get('link').getState();
    expect(state).toMatchObject({ enabled: true, active: true, value: 'https://old.example' });
    expect(await ui.toolbar.execute('link', { href: 'https://new.example' })).toMatchObject({ success: true });
    expect(patch).toHaveBeenCalledWith({ target: address, patch: { href: 'https://new.example' } });
  });

  it('link replaces active link display text when provided', async () => {
    const address = linkAddress(0, 5);
    const patch = vi.fn(() => ({ success: true }));
    const replace = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [{ address, properties: { href: 'https://old.example' }, text: 'hello' }] }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: { wrap: vi.fn(), patch, remove: vi.fn(), list },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'hello',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('link', { href: 'https://new.example', text: 'updated' })).toMatchObject({
      success: true,
    });
    expect(patch).toHaveBeenCalledWith({ target: address, patch: { href: 'https://new.example' } });
    expect(replace).toHaveBeenCalledWith({
      target: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 0 },
        end: { kind: 'text', blockId: 'P1', offset: 5 },
      },
      text: 'updated',
    });
  });

  it('link refuses a cross-block active link edit when requested display text cannot be targeted', async () => {
    const address = {
      kind: 'inline',
      nodeType: 'hyperlink',
      anchor: {
        start: { blockId: 'P1', offset: 0 },
        end: { blockId: 'P2', offset: 3 },
      },
    };
    const patch = vi.fn(() => ({ success: true, txId: 'tx-href' }));
    const replace = vi.fn(() => ({ success: true, txId: 'tx-text' }));
    const list = vi.fn(() => ({ items: [{ address, properties: { href: 'https://old.example' }, text: 'hello' }] }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: { wrap: vi.fn(), patch, remove: vi.fn(), list },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'hello',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('link', { href: 'https://new.example', text: 'updated' })).toBe(false);
    expect(patch).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('link updates a clicked v2 link target and text without an active selection', async () => {
    const updateTarget = vi.fn(() => ({ success: true, hyperlinkNodeId: 'hl:1', txId: 'tx-1' }));
    const replace = vi.fn(() => ({ success: true, txId: 'tx-2' }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.toolbar.execute('link', {
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      textTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
    });
    expect(result).toMatchObject({ success: true, txId: 'tx-2' });
    expect(updateTarget).toHaveBeenCalledWith({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:1',
      newTarget: { kind: 'external', url: 'https://updated.example/' },
    });
    expect(replace).toHaveBeenCalledWith({
      target: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
      text: 'Updated text',
    });
  });

  it('link reports a partial failure when clicked href update succeeds but text replace fails', async () => {
    const updateTarget = vi.fn(() => ({ success: true, hyperlinkNodeId: 'hl:1', txId: 'tx-href' }));
    const replaceFailure = { success: false, failure: { code: 'TEXT_FAILED', message: 'text replace failed' } };
    const replace = vi.fn(() => replaceFailure);
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.toolbar.execute('link', {
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      textTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
    });

    expect(updateTarget).toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      failure: {
        code: 'PARTIAL_LINK_EDIT',
      },
      applied: {
        href: true,
        text: false,
      },
      hyperlinkResult: { success: true, txId: 'tx-href' },
      textResult: replaceFailure,
    });
  });

  it('link executeAsync waits for an async clicked v2 link target update', async () => {
    let resolveUpdate: ((value: { success: true; hyperlinkNodeId: string; txId: string }) => void) | null = null;
    const updateTarget = vi.fn(
      () =>
        new Promise<{ success: true; hyperlinkNodeId: string; txId: string }>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.get('link').executeAsync({
      href: 'https://updated.example/',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
    });

    expect(updateTarget).toHaveBeenCalledWith({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:1',
      newTarget: { kind: 'external', url: 'https://updated.example/' },
    });
    resolveUpdate?.({ success: true, hyperlinkNodeId: 'hl:1', txId: 'tx-async' });
    await expect(pending).resolves.toMatchObject({ success: true, txId: 'tx-async' });
  });

  it('link executeAsync waits for an async href update before replacing clicked link text', async () => {
    let resolveUpdate: ((value: { success: true; hyperlinkNodeId: string; txId: string }) => void) | null = null;
    const updateTarget = vi.fn(
      () =>
        new Promise<{ success: true; hyperlinkNodeId: string; txId: string }>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const replace = vi.fn(() => ({ success: true, txId: 'tx-text' }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.get('link').executeAsync({
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      textTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
    });

    expect(updateTarget).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    resolveUpdate?.({ success: true, hyperlinkNodeId: 'hl:1', txId: 'tx-href' });
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(replace).toHaveBeenCalledWith({
      target: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
      text: 'Updated text',
    });
    await expect(pending).resolves.toMatchObject({ success: true, txId: 'tx-text' });
  });

  it('link executeAsync does not replace text when an async href update fails', async () => {
    const updateFailure = { success: false, failure: { code: 'STALE_REVISION', message: 'stale revision' } };
    let resolveUpdate: ((value: typeof updateFailure) => void) | null = null;
    const updateTarget = vi.fn(
      () =>
        new Promise<typeof updateFailure>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const replace = vi.fn(() => ({ success: true, txId: 'tx-text' }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.get('link').executeAsync({
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      textTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
    });

    resolveUpdate?.(updateFailure);
    await expect(pending).resolves.toBe(updateFailure);
    expect(replace).not.toHaveBeenCalled();
  });

  it('link executeAsync reports partial failure when async text replace fails after href update', async () => {
    const updateTarget = vi.fn(() => ({ success: true, hyperlinkNodeId: 'hl:1', txId: 'tx-href' }));
    const replaceFailure = { success: false, failure: { code: 'TEXT_FAILED', message: 'text replace failed' } };
    let resolveReplace: ((value: typeof replaceFailure) => void) | null = null;
    const replace = vi.fn(
      () =>
        new Promise<typeof replaceFailure>((resolve) => {
          resolveReplace = resolve;
        }),
    );
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const pending = ui.commands.get('link').executeAsync({
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      textTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 10 },
        end: { kind: 'text', blockId: 'P1', offset: 23 },
      },
    });

    resolveReplace?.(replaceFailure);

    await expect(pending).resolves.toMatchObject({
      success: false,
      failure: {
        code: 'PARTIAL_LINK_EDIT',
      },
      applied: {
        href: true,
        text: false,
      },
      hyperlinkResult: { success: true, txId: 'tx-href' },
      textResult: replaceFailure,
    });
  });

  it('link refuses clicked v2 text edits when no text target is available', async () => {
    const updateTarget = vi.fn(() => ({ success: true, hyperlinkNodeId: 'hl:1', txId: 'tx-1' }));
    const replace = vi.fn(() => ({ success: true, txId: 'tx-2' }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: {
          wrap: vi.fn(),
          patch: vi.fn(),
          remove: vi.fn(),
          updateTarget,
          list: vi.fn(() => ({ items: [] })),
        },
        text: { replace },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    const result = await ui.toolbar.execute('link', {
      href: 'https://updated.example/',
      text: 'Updated text',
      currentText: 'Original text',
      hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      textTarget: null,
    });
    expect(result).toBe(false);
    expect(updateTarget).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('link updates a clicked v2 link instead of a stale selected link', async () => {
    const selectedAddress = linkAddress(0, 5);
    const patch = vi.fn(() => ({ success: true }));
    const updateTarget = vi.fn(() => ({ success: true, hyperlinkNodeId: 'clicked-link', txId: 'tx-1' }));
    const list = vi.fn(() => ({
      items: [{ address: selectedAddress, properties: { href: 'https://selected.example' }, text: 'selected' }],
    }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: { wrap: vi.fn(), patch, remove: vi.fn(), updateTarget, list },
      },
      {
        selectionInfo: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'selected',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(
      await ui.toolbar.execute('link', {
        href: 'https://clicked.example/',
        currentText: 'clicked',
        hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'clicked-link' },
      }),
    ).toMatchObject({ success: true });
    expect(updateTarget).toHaveBeenCalledWith({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'clicked-link',
      newTarget: { kind: 'external', url: 'https://clicked.example/' },
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('link removes an active link when href is null', async () => {
    const address = linkAddress(0, 5);
    const remove = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({ items: [{ address, properties: { href: 'https://old.example' } }] }));
    const superdoc = makeBlockSuperdoc(
      { hyperlinks: { wrap: vi.fn(), patch: vi.fn(), remove, list } },
      {
        selectionInfo: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'hello',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('link', { href: null })).toMatchObject({ success: true });
    expect(remove).toHaveBeenCalledWith({ target: address, mode: 'unwrap' });
  });

  it('link removes a clicked v2 link without an active selection', async () => {
    const remove = vi.fn(() => ({ success: true, txId: 'tx-1', hyperlinkNodeId: null }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: { wrap: vi.fn(), patch: vi.fn(), remove, list: vi.fn(() => ({ items: [] })) },
      },
      {
        selectionInfo: {
          empty: true,
          target: null,
          selectionTarget: null,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(
      await ui.toolbar.execute('link', {
        href: null,
        hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'hl:1' },
      }),
    ).toMatchObject({ success: true });
    expect(remove).toHaveBeenCalledWith({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'hl:1',
      keepText: true,
    });
  });

  it('link removes a clicked v2 link instead of a stale selected link', async () => {
    const selectedAddress = linkAddress(0, 5);
    const remove = vi.fn(() => ({ success: true, txId: 'tx-1', hyperlinkNodeId: null }));
    const list = vi.fn(() => ({
      items: [{ address: selectedAddress, properties: { href: 'https://selected.example' } }],
    }));
    const superdoc = makeBlockSuperdoc(
      {
        hyperlinks: { wrap: vi.fn(), patch: vi.fn(), remove, list },
      },
      {
        selectionInfo: {
          empty: false,
          target: MULTI_TARGET,
          selectionTarget: MULTI_SELECTION_TARGET,
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'selected',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(
      await ui.toolbar.execute('link', {
        href: null,
        hyperlinkTarget: { storyId: 'main:/word/document.xml', hyperlinkNodeId: 'clicked-link' },
      }),
    ).toMatchObject({ success: true });
    expect(remove).toHaveBeenCalledWith({
      storyId: 'main:/word/document.xml',
      hyperlinkNodeId: 'clicked-link',
      keepText: true,
    });
    expect(remove).not.toHaveBeenCalledWith({ target: selectedAddress, mode: 'unwrap' });
  });

  it('link does not patch or remove a different link in the same paragraph', async () => {
    const wrap = vi.fn(() => ({ success: true }));
    const patch = vi.fn(() => ({ success: true }));
    const remove = vi.fn(() => ({ success: true }));
    const list = vi.fn(() => ({
      items: [{ address: linkAddress(10, 14), properties: { href: 'https://old.example' } }],
    }));
    const superdoc = makeBlockSuperdoc({ hyperlinks: { wrap, patch, remove, list } });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('link').getState()).toMatchObject({ enabled: true, supported: true, active: false });
    expect(await ui.toolbar.execute('link', 'https://new.example')).toMatchObject({ success: true });
    expect(wrap).toHaveBeenCalledWith({
      target: { kind: 'text', blockId: 'P1', range: { start: 0, end: 5 } },
      link: { destination: { href: 'https://new.example' } },
    });
    expect(patch).not.toHaveBeenCalled();

    expect(await ui.toolbar.execute('link', { href: null })).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('table-insert routes create.table with normalized rows/columns and an at-nodeId location', async () => {
    const table = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ create: { table } });
    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('table-insert').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.execute('table-insert', { rows: 2, cols: 3 })).toMatchObject({ success: true });
    expect(table).toHaveBeenCalledWith({ rows: 2, columns: 3, at: { kind: 'after', nodeId: 'P1' } });
  });

  it('table-insert routes create.table at the caret offset (Word parity split) when a collapsed text caret is available', async () => {
    const table = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc(
      { create: { table } },
      {
        selectionInfo: {
          empty: true,
          target: { kind: 'text', blockId: 'P1', range: { start: 5, end: 5 } },
          selectionTarget: null,
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('table-insert', { rows: 2, cols: 3 })).toMatchObject({ success: true });
    expect(table).toHaveBeenCalledWith({
      rows: 2,
      columns: 3,
      at: { kind: 'inParagraph', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' }, offset: 5 },
    });
  });

  it('table-insert fails closed on invalid dimensions', async () => {
    const table = vi.fn();
    const superdoc = makeBlockSuperdoc({ create: { table } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('table-insert', { rows: 0, cols: 3 })).toBe(false);
    expect(table).not.toHaveBeenCalled();
  });

  it('image routes create.image with a src and an at-target location', async () => {
    const image = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ create: { image } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA', alt: 'x' })).toMatchObject({
      success: true,
    });
    expect(image).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'data:image/png;base64,AAAA',
        alt: 'x',
        at: { kind: 'after', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' } },
      }),
    );
  });

  it.each([
    ['header', { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' }],
    ['footer', { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' }],
  ] as const)('routes image insertion at a collapsed %s caret with its physical story', async (_kind, story) => {
    const image = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc(
      { create: { image } },
      {
        selectionInfo: {
          empty: true,
          target: { kind: 'text', story, segments: [{ blockId: 'HF1', range: { start: 4, end: 4 } }] },
          selectionTarget: null,
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: '',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA' })).toMatchObject({ success: true });
    expect(image).toHaveBeenCalledWith({
      src: 'data:image/png;base64,AAAA',
      in: story,
      at: {
        kind: 'inParagraph',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'HF1', story },
        offset: 4,
      },
    });
  });

  it('preserves the active header slot section when image size is implicit', async () => {
    const image = vi.fn(() => ({ success: true }));
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' } as const;
    const resolveHeaderFooterEditTarget = vi.fn(({ kind }: { kind: 'header' | 'footer' }) =>
      kind === 'header'
        ? {
            status: 'ready',
            pageIndex: 3,
            sectionIndex: 1,
            sectionId: 'section-1',
            renderedVariant: 'default',
            slotVariant: 'default',
            refId: 'rId-header',
            renderEpoch: 1,
          }
        : { status: 'unavailable', reason: 'not-rendered' },
    );
    const superdoc = makeBlockSuperdoc(
      { create: { image } },
      {
        selectionInfo: {
          empty: true,
          target: { kind: 'text', story, segments: [{ blockId: 'HF1', range: { start: 4, end: 4 } }] },
          selectionTarget: null,
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: '',
        },
        editorExtra: {
          pageLayout: { getActiveRulerContext: () => ({ pageIndex: 3 }) },
          host: { resolveHeaderFooterEditTarget },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA' })).toMatchObject({ success: true });
    expect(image).toHaveBeenCalledWith({
      src: 'data:image/png;base64,AAAA',
      in: {
        kind: 'story',
        storyType: 'headerFooterSlot',
        section: { kind: 'section', sectionId: 'section-1' },
        headerFooterKind: 'header',
        variant: 'default',
      },
      at: {
        kind: 'inParagraph',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'HF1', story },
        offset: 4,
      },
    });
    expect(resolveHeaderFooterEditTarget).toHaveBeenCalledWith({ pageIndex: 3, kind: 'header' });
  });

  it('preserves the active first-page header slot section when image size is implicit', async () => {
    const image = vi.fn(() => ({ success: true }));
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' } as const;
    const resolveHeaderFooterEditTarget = vi.fn(({ kind }: { kind: 'header' | 'footer' }) =>
      kind === 'header'
        ? {
            status: 'ready',
            pageIndex: 3,
            sectionIndex: 1,
            sectionId: 'section-1',
            renderedVariant: 'first',
            slotVariant: 'first',
            refId: 'rId-header',
            renderEpoch: 1,
          }
        : { status: 'unavailable', reason: 'not-rendered' },
    );
    const superdoc = makeBlockSuperdoc(
      { create: { image } },
      {
        selectionInfo: {
          empty: true,
          target: { kind: 'text', story, segments: [{ blockId: 'HF1', range: { start: 4, end: 4 } }] },
          selectionTarget: null,
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: '',
        },
        editorExtra: {
          pageLayout: { getActiveRulerContext: () => ({ pageIndex: 3 }) },
          host: { resolveHeaderFooterEditTarget },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA' })).toMatchObject({ success: true });
    expect(image).toHaveBeenCalledWith({
      src: 'data:image/png;base64,AAAA',
      in: {
        kind: 'story',
        storyType: 'headerFooterSlot',
        section: { kind: 'section', sectionId: 'section-1' },
        headerFooterKind: 'header',
        variant: 'first',
      },
      at: {
        kind: 'inParagraph',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'HF1', story },
        offset: 4,
      },
    });
    expect(resolveHeaderFooterEditTarget).toHaveBeenCalledWith({ pageIndex: 3, kind: 'header' });
  });

  it('preserves the physical story for image insertion without a collapsed caret', async () => {
    const image = vi.fn(() => ({ success: true }));
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' } as const;
    const superdoc = makeBlockSuperdoc(
      { create: { image } },
      {
        selectionInfo: {
          empty: false,
          target: { kind: 'text', story, segments: [{ blockId: 'HF1', range: { start: 0, end: 4 } }] },
          selectionTarget: null,
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: 'Head',
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA' })).toMatchObject({ success: true });
    expect(image).toHaveBeenCalledWith({
      src: 'data:image/png;base64,AAAA',
      in: story,
      at: {
        kind: 'after',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'HF1', story },
      },
    });
  });

  it('keeps block-level header image insertion in the physical story when an active slot resolves', async () => {
    const image = vi.fn(() => ({ success: true }));
    const story = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' } as const;
    const resolveHeaderFooterEditTarget = vi.fn(({ kind }: { kind: 'header' | 'footer' }) =>
      kind === 'header'
        ? {
            status: 'ready',
            pageIndex: 3,
            sectionIndex: 1,
            sectionId: 'section-1',
            renderedVariant: 'default',
            slotVariant: 'default',
            refId: 'rId-header',
            renderEpoch: 1,
          }
        : { status: 'unavailable', reason: 'not-rendered' },
    );
    const superdoc = makeBlockSuperdoc(
      { create: { image } },
      {
        selectionInfo: {
          empty: false,
          target: { kind: 'text', story, segments: [{ blockId: 'HF1', range: { start: 0, end: 4 } }] },
          selectionTarget: null,
          activeMarks: [] as string[],
          activeCommentIds: [] as string[],
          activeChangeIds: [] as string[],
          text: 'Head',
        },
        editorExtra: {
          pageLayout: { getActiveRulerContext: () => ({ pageIndex: 3 }) },
          host: { resolveHeaderFooterEditTarget },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA' })).toMatchObject({ success: true });
    expect(image).toHaveBeenCalledWith({
      src: 'data:image/png;base64,AAAA',
      in: story,
      at: {
        kind: 'after',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'HF1', story },
      },
    });
  });

  it('routes image and table inserts as tracked mutations in suggesting mode', async () => {
    const image = vi.fn(() => ({ success: true }));
    const table = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ create: { image, table } }, { mode: 'suggesting' });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('image', { src: 'data:image/png;base64,AAAA', alt: 'x' })).toMatchObject({
      success: true,
    });
    expect(image).toHaveBeenCalledWith(expect.objectContaining({ src: 'data:image/png;base64,AAAA', alt: 'x' }), {
      changeMode: 'tracked',
    });

    expect(await ui.toolbar.execute('table-insert', { rows: 2, cols: 3 })).toMatchObject({ success: true });
    expect(table).toHaveBeenCalledWith(
      { rows: 2, columns: 3, at: { kind: 'after', nodeId: 'P1' } },
      { changeMode: 'tracked' },
    );
  });

  it('table-of-contents-insert routes create.tableOfContents', async () => {
    const tableOfContents = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ create: { tableOfContents } });
    const ui = createSuperDocUI({ superdoc });
    expect(await ui.toolbar.execute('table-of-contents-insert')).toMatchObject({ success: true });
    expect(tableOfContents).toHaveBeenCalledWith(
      expect.objectContaining({
        at: { kind: 'after', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' } },
      }),
    );
  });

  it('fails closed for unsupported tracked create commands in suggesting mode', async () => {
    const tableOfContents = vi.fn(() => ({ success: true }));
    const superdoc = makeBlockSuperdoc({ create: { tableOfContents } }, { mode: 'suggesting' });
    const ui = createSuperDocUI({ superdoc });

    expect(await ui.toolbar.execute('table-of-contents-insert')).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(tableOfContents).not.toHaveBeenCalled();
  });

  it('table cell-context commands fail closed with table-context-unavailable when no host context resolves', async () => {
    const superdoc = makeBlockSuperdoc({ tables: { insertRow: vi.fn(), deleteRow: vi.fn(), mergeCells: vi.fn() } });
    const ui = createSuperDocUI({ superdoc });
    // No host table-context facade → the routed table family is supported but
    // fails closed with the precise, named context reason and never mutates.
    for (const id of ['table-add-row-after', 'table-delete-row', 'table-merge-cells', 'table-remove-borders']) {
      const state = ui.commands.get(id).getState();
      expect(state, id).toMatchObject({ enabled: false, supported: true, source: 'builtin' });
      expect(state.reason, id).toBe(SUPERDOC_UI_REASONS.tableContextUnavailable);
      expect(await ui.toolbar.execute(id), id).toBe(false);
    }
  });

  it('routes the table cell-context family through tables.* once the host resolves a table context', async () => {
    const insertRow = vi.fn(() => ({ success: true }));
    const insertRowCommand = vi.fn(() => ({ success: true }));
    const insertColumn = vi.fn(() => ({ success: true }));
    const insertColumnCommand = vi.fn(() => ({ success: true }));
    const deleteRow = vi.fn(() => ({ success: true }));
    const deleteColumn = vi.fn(() => ({ success: true }));
    const mergeCells = vi.fn(() => ({ success: true }));
    const splitCell = vi.fn(() => ({ success: true }));
    const setBorders = vi.fn(() => ({ success: true }));
    const deleteTable = vi.fn(() => ({ success: true }));
    const getTableContext = vi.fn(() => ({
      inTable: true,
      table: { nodeId: 'TBL1', rows: 3, columns: 2 },
      row: { index: 1 },
      column: { index: 0 },
      cell: { nodeId: 'CELL-1-0' },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        tables: {
          insertRow,
          deleteRow,
          insertColumn,
          deleteColumn,
          delete: deleteTable,
          mergeCells,
          splitCell,
          setBorders,
        },
      },
      // The shared table-context facade reads `activeEditor.host.getTableContext()`.
      {
        editorExtra: {
          host: {
            getTableContext,
            getHandles: () => ({
              editing: { tables: { insertRow: insertRowCommand, insertColumn: insertColumnCommand } },
            }),
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });

    // Read surface: the resolved table context is exposed to custom UIs.
    expect(ui.tables.isInTable()).toBe(true);
    expect(ui.tables.getContext()).toMatchObject({
      inTable: true,
      tableNodeId: 'TBL1',
      rowIndex: 1,
      columnIndex: 0,
      cellNodeId: 'CELL-1-0',
      rows: 3,
      columns: 2,
    });

    // Commands enable and route through the matching tables.* operation.
    expect(ui.commands.get('table-delete-row').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.execute('table-add-row-after')).toMatchObject({ success: true });
    expect(insertRowCommand).toHaveBeenCalledWith({ nodeId: 'TBL1', rowIndex: 1, position: 'below' });
    expect(insertRow).not.toHaveBeenCalled();
    expect(await ui.toolbar.execute('table-add-column-before')).toMatchObject({ success: true });
    expect(insertColumnCommand).toHaveBeenCalledWith({ nodeId: 'TBL1', columnIndex: 0, position: 'left' }, 1);
    expect(insertColumn).not.toHaveBeenCalled();
    expect(await ui.toolbar.execute('table-delete-row')).toMatchObject({ success: true });
    expect(deleteRow).toHaveBeenCalledWith({ nodeId: 'TBL1', rowIndex: 1 });
    expect(await ui.toolbar.execute('table-delete-column')).toMatchObject({ success: true });
    expect(deleteColumn).toHaveBeenCalledWith({ nodeId: 'TBL1', columnIndex: 0 });
    expect(await ui.toolbar.execute('table-split-cell')).toMatchObject({ success: true });
    expect(splitCell).toHaveBeenCalledWith({ nodeId: 'CELL-1-0', rows: 1, columns: 2 });
    expect(await ui.toolbar.execute('table-remove-borders')).toMatchObject({ success: true });
    expect(setBorders).toHaveBeenCalledWith({ nodeId: 'TBL1', mode: 'applyTo', applyTo: 'all', border: null });
    expect(await ui.toolbar.execute('table-delete')).toMatchObject({ success: true });
    expect(deleteTable).toHaveBeenCalledWith({ nodeId: 'TBL1' });
  });

  it('treats a multi-cell table selection as mergeable but not splittable', async () => {
    const mergeCells = vi.fn(() => ({ success: true }));
    const splitCell = vi.fn(() => ({ success: true }));
    const getTableContext = vi.fn(() => ({
      inTable: true,
      table: { nodeId: 'TBL1', rows: 2, columns: 2 },
      row: { index: 0 },
      column: { index: 0 },
      cell: null,
      cellRange: {
        start: { rowIndex: 0, columnIndex: 0 },
        end: { rowIndex: 1, columnIndex: 1 },
      },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        tables: {
          mergeCells,
          splitCell,
        },
      },
      { editorExtra: { host: { getTableContext } } },
    );
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('table-merge-cells').getState()).toMatchObject({ enabled: true, supported: true });
    expect(await ui.toolbar.execute('table-merge-cells')).toMatchObject({ success: true });
    expect(mergeCells).toHaveBeenCalledWith({
      nodeId: 'TBL1',
      start: { rowIndex: 0, columnIndex: 0 },
      end: { rowIndex: 1, columnIndex: 1 },
    });

    expect(ui.commands.get('table-split-cell').getState()).toMatchObject({
      enabled: false,
      supported: true,
      reason: SUPERDOC_UI_REASONS.tableContextUnavailable,
    });
    expect(await ui.toolbar.execute('table-split-cell')).toBe(false);
    expect(splitCell).not.toHaveBeenCalled();
  });

  it('routes table cell-context commands as tracked mutations in suggesting mode (SD-3714)', async () => {
    const insertRow = vi.fn(() => ({ success: true }));
    const insertRowCommand = vi.fn(() => ({ success: true }));
    const deleteRow = vi.fn(() => ({ success: true }));
    const insertColumn = vi.fn(() => ({ success: true }));
    const insertColumnCommand = vi.fn(() => ({ success: true }));
    const deleteColumn = vi.fn(() => ({ success: true }));
    const mergeCells = vi.fn(() => ({ success: true }));
    const splitCell = vi.fn(() => ({ success: true }));
    const setBorders = vi.fn(() => ({ success: true }));
    const deleteTable = vi.fn(() => ({ success: true }));
    const getTableContext = vi.fn(() => ({
      inTable: true,
      table: { nodeId: 'TBL1', rows: 3, columns: 2 },
      row: { index: 1 },
      column: { index: 0 },
      cell: { nodeId: 'CELL-1-0' },
    }));
    const superdoc = makeBlockSuperdoc(
      {
        tables: {
          insertRow,
          deleteRow,
          insertColumn,
          deleteColumn,
          delete: deleteTable,
          mergeCells,
          splitCell,
          setBorders,
        },
      },
      {
        mode: 'suggesting',
        editorExtra: {
          host: {
            getTableContext,
            getHandles: () => ({
              editing: { tables: { insertRow: insertRowCommand, insertColumn: insertColumnCommand } },
            }),
          },
        },
      },
    );
    const ui = createSuperDocUI({ superdoc });
    const TRACKED = { changeMode: 'tracked' };

    expect(await ui.toolbar.execute('table-add-row-after')).toMatchObject({ success: true });
    expect(insertRowCommand).toHaveBeenCalledWith({ nodeId: 'TBL1', rowIndex: 1, position: 'below' }, TRACKED);
    expect(insertRow).not.toHaveBeenCalled();
    expect(await ui.toolbar.execute('table-add-column-before')).toMatchObject({ success: true });
    expect(insertColumnCommand).toHaveBeenCalledWith({ nodeId: 'TBL1', columnIndex: 0, position: 'left' }, 1, TRACKED);
    expect(insertColumn).not.toHaveBeenCalled();
    expect(await ui.toolbar.execute('table-delete-row')).toMatchObject({ success: true });
    expect(deleteRow).toHaveBeenCalledWith({ nodeId: 'TBL1', rowIndex: 1 }, TRACKED);
    expect(await ui.toolbar.execute('table-delete-column')).toMatchObject({ success: true });
    expect(deleteColumn).toHaveBeenCalledWith({ nodeId: 'TBL1', columnIndex: 0 }, TRACKED);
    expect(await ui.toolbar.execute('table-merge-cells')).toMatchObject({ success: true });
    expect(mergeCells).toHaveBeenCalledWith(
      { nodeId: 'TBL1', start: { rowIndex: 1, columnIndex: 0 }, end: { rowIndex: 1, columnIndex: 0 } },
      TRACKED,
    );
    expect(await ui.toolbar.execute('table-split-cell')).toMatchObject({ success: true });
    expect(splitCell).toHaveBeenCalledWith({ nodeId: 'CELL-1-0', rows: 1, columns: 2 }, TRACKED);
    expect(await ui.toolbar.execute('table-remove-borders')).toMatchObject({ success: true });
    expect(setBorders).toHaveBeenCalledWith({ nodeId: 'TBL1', mode: 'applyTo', applyTo: 'all', border: null }, TRACKED);
    expect(await ui.toolbar.execute('table-delete')).toMatchObject({ success: true });
    expect(deleteTable).toHaveBeenCalledWith({ nodeId: 'TBL1' }, TRACKED);
  });

  it('block / list / create commands fail closed in viewing mode', async () => {
    const setAlignment = vi.fn();
    const apply = vi.fn();
    const table = vi.fn();
    const superdoc = makeBlockSuperdoc(
      {
        format: { paragraph: { setAlignment } },
        lists: { apply, getState: () => ({ success: true, isListItem: false }) },
        create: { table },
      },
      { mode: 'viewing' },
    );
    const ui = createSuperDocUI({ superdoc });
    for (const id of ['text-align', 'bullet-list', 'table-insert']) {
      expect(ui.commands.get(id).getState(), id).toMatchObject({
        enabled: false,
        supported: true,
        reason: SUPERDOC_UI_REASONS.documentReadonly,
      });
    }
    expect(await ui.toolbar.execute('text-align', 'center')).toBe(false);
    expect(await ui.toolbar.execute('table-insert', { rows: 2, cols: 2 })).toBe(false);
    expect(setAlignment).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Shared search surface. Find, navigation, and replacement use one host-owned
// session and fail closed when the active host cannot provide the operation.
// ---------------------------------------------------------------------------

describe('public ui — shared search surface (row 747 / search ownership)', () => {
  function makeSearchSuperdoc(opts: { search?: Record<string, unknown>; editCommands?: Record<string, unknown> } = {}) {
    return {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => null },
        },
        ...(opts.search ? { host: { search: opts.search } } : {}),
        ...(opts.editCommands ? { editCommands: opts.editCommands } : {}),
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
  }

  it('fails closed with search-unavailable when the host exposes no search facade', async () => {
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc() });
    expect(ui.search.getSnapshot()).toMatchObject({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    expect(ui.search.open()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    const slice = ui.search.find('hello');
    expect(slice).toMatchObject({
      query: 'hello',
      total: 0,
      available: false,
      reason: SUPERDOC_UI_REASONS.searchUnavailable,
    });
    expect(ui.search.next()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    // Replace also fails closed when there is no host search facade at all.
    expect(ui.search.replace('x')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
    expect(ui.search.replaceAll('x')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
  });

  it('falls back to browser-shell editCommands.search when host.search is not exposed', async () => {
    const state = { query: '', total: 0, activeIndex: -1 };
    const getState = vi.fn(() => ({ ...state }));
    const editSearch = {
      query: vi.fn(async (input: { query: string; caseSensitive?: boolean; includeDeletedText?: boolean }) => {
        state.query = input.query;
        state.total = input.query ? 2 : 0;
        state.activeIndex = input.query ? 0 : -1;
        return { status: 'ok', ...state };
      }),
      next: vi.fn(async () => {
        state.activeIndex = state.total > 0 ? 1 : -1;
        return { status: 'ok', ...state };
      }),
      previous: vi.fn(async () => {
        state.activeIndex = state.total > 0 ? 0 : -1;
        return { status: 'ok', ...state };
      }),
      replace: vi.fn(async () => {
        state.total = 1;
        state.activeIndex = 0;
        return { status: 'committed', replaced: 1 };
      }),
      replaceAll: vi.fn(async () => {
        state.total = 0;
        state.activeIndex = -1;
        return { status: 'committed', replaced: 1 };
      }),
      getState,
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: {
          'find.replace': { shippedStatus: 'supported', enabled: state.total > 0, reason: null },
          'find.replaceAll': { shippedStatus: 'supported', enabled: state.total > 0, reason: null },
        },
      })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });

    expect(ui.search.getSnapshot()).toMatchObject({ available: true, total: 0 });
    const slice = ui.search.find('hello', { caseSensitive: true });
    expect(editSearch.query).toHaveBeenCalledWith({
      query: 'hello',
      caseSensitive: true,
      includeDeletedText: false,
      regex: false,
    });
    // A worker-backed query publishes no matches until its own result settles.
    expect(slice).toMatchObject({ available: true, query: 'hello', total: 0, canReplace: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ available: true, total: 2, activeIndex: 0, canReplace: true });

    expect(ui.search.next()).toEqual({ ok: true });
    expect(ui.search.getSnapshot().activeIndex).toBe(1);
    expect(ui.search.previous()).toEqual({ ok: true });
    expect(ui.search.getSnapshot().activeIndex).toBe(0);

    // Async fallback replace resolves with the settled outcome.
    await expect(Promise.resolve(ui.search.replace('x'))).resolves.toEqual({ ok: true });
    expect(editSearch.replace).toHaveBeenCalledWith({ replacement: 'x' });
    await expect(Promise.resolve(ui.search.replaceAll('y'))).resolves.toEqual({ ok: true });
    expect(editSearch.replaceAll).toHaveBeenCalledWith({ replacement: 'y' });
  });

  it('ignores a stale fallback query result that resolves after a newer query', async () => {
    // Worker-backed queries can resolve out of order; a slow stale result must
    // not overwrite the state of the newer query the user is looking at.
    const state = { query: '', total: 0, activeIndex: -1 };
    let resolveStale: (value: unknown) => void = () => {};
    const editSearch = {
      query: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveStale = resolve;
            }),
        )
        .mockImplementationOnce(async () => {
          state.query = 'abc';
          state.total = 1;
          state.activeIndex = 0;
          return { status: 'ok', ...state };
        }),
      getState: vi.fn(() => ({ ...state })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({ commands: {} })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });
    // `getSnapshot()` re-syncs from the source of truth, so the stale write is
    // only observable through emissions: subscribers must never see the stale
    // "ab" totals flash over the newer "abc" session.
    const emitted: Array<{ query?: string; total?: number }> = [];
    ui.search.subscribe(({ snapshot }) => emitted.push({ query: snapshot.query, total: snapshot.total }));

    ui.search.find('ab');
    ui.search.find('abc');
    await Promise.resolve();
    await Promise.resolve();

    resolveStale({ status: 'ok', query: 'ab', total: 5, activeIndex: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(emitted.some((slice) => slice.total === 5)).toBe(false);
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'abc', total: 1 });
  });

  it('does not carry the previous query matches into a new worker-backed query', async () => {
    // With the worker fallback, `find()` returns before the query settles.
    // The interim snapshot must not keep the old session's total/canReplace,
    // or a panel could navigate or replace the old query's matches.
    let resolveSecond: (value: unknown) => void = () => {};
    const state = { query: '', total: 0, activeIndex: -1 };
    const editSearch = {
      query: vi.fn((input: { query: string }) => {
        if (input.query === 'A') {
          state.query = 'A';
          state.total = 3;
          state.activeIndex = 0;
          return Promise.resolve({ status: 'ok', ...state });
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      }),
      next: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: { 'find.replace': { shippedStatus: 'supported', enabled: true, reason: null } },
      })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });

    ui.search.find('A');
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 3, canReplace: true });

    const interim = ui.search.find('B');
    expect(interim).toMatchObject({ query: 'B', total: 0, activeIndex: -1, canReplace: false });
    expect(ui.search.next()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
    // Snapshot reads and fresh observers re-sync from the shell; they must not
    // resurface A's session while B is still settling.
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'B', total: 0, canReplace: false });
    const observed: Array<{ query: string; total: number }> = [];
    const stop = ui.search.observe((snapshot) => observed.push({ query: snapshot.query, total: snapshot.total }));
    stop();
    expect(observed).toEqual([{ query: 'B', total: 0 }]);

    state.query = 'B';
    state.total = 1;
    state.activeIndex = 0;
    resolveSecond({ status: 'ok', ...state });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'B', total: 1, canReplace: true });
  });

  it('does not carry the previous options into a same-query worker-backed search', async () => {
    // Toggling Match case or Include pending deletions re-runs `find()` with
    // the same query. The shell's state then shares the query but describes
    // the old option set, so query equality is not proof it belongs to this
    // call; the interim snapshot must still report no matches.
    let resolveSecond: (value: unknown) => void = () => {};
    // The production shell's getState() exposes only query, total,
    // activeIndex, and canReplace, and does not change until the worker
    // answers, so a same-query request looks identical to the old session.
    const state = { query: 'Client', total: 8, activeIndex: 0 };
    let calls = 0;
    const editSearch = {
      query: vi.fn(() => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ status: 'ok', ...state });
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      }),
      next: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: { 'find.replace': { shippedStatus: 'supported', enabled: true, reason: null } },
      })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });

    ui.search.find('Client');
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'Client', total: 8, canReplace: true });

    const interim = ui.search.find('Client', { caseSensitive: true });
    expect(interim).toMatchObject({ query: 'Client', caseSensitive: true, total: 0, canReplace: false });
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'Client', total: 0, canReplace: false });
    expect(ui.search.next()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });

    state.total = 7;
    resolveSecond({ status: 'ok', ...state });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'Client', total: 7, canReplace: true });
  });

  it('keeps a repeated query pending until its own worker result settles (A -> B -> A)', async () => {
    // The shell still reports A's settled session while B and then A again are
    // in flight. Remembering only the previous request would let the stale A
    // snapshot pass as current; every promise-backed request must wait for
    // its own result.
    const pending: Array<(value: unknown) => void> = [];
    const state = { query: '', total: 0, activeIndex: -1 };
    let calls = 0;
    const editSearch = {
      query: vi.fn((input: { query: string }) => {
        if (input.query === '') {
          // Cancellation of an outstanding fallback; settles immediately.
          return Promise.resolve({ status: 'ok', query: '', total: 0, activeIndex: -1 });
        }
        calls += 1;
        if (calls === 1) {
          state.query = input.query;
          state.total = 4;
          state.activeIndex = 0;
          return Promise.resolve({ status: 'ok', ...state });
        }
        return new Promise((resolve) => pending.push(resolve));
      }),
      next: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: {
          'find.replace': { shippedStatus: 'supported', enabled: true, reason: null },
          'find.replaceAll': { shippedStatus: 'supported', enabled: true, reason: null },
        },
      })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });

    ui.search.find('A');
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 4, canReplace: true });

    ui.search.find('B');
    const again = ui.search.find('A', { caseSensitive: true });
    expect(again).toMatchObject({ query: 'A', caseSensitive: true, total: 0, canReplace: false, canReplaceAll: false });
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 0, canReplace: false });
    expect(ui.search.next()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });

    // B's late answer is stale and ignored; A's own answer lands.
    pending[0]?.({ status: 'ok', query: 'B', total: 9, activeIndex: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 0 });
    state.total = 2;
    pending[1]?.({ status: 'ok', ...state });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 2, canReplace: true, canReplaceAll: true });
  });

  it('does not advertise canReplaceAll for an empty host-backed session', async () => {
    // The host derives `canReplace` from document mutability alone, so a
    // session with no matches still reports it. Replace all is an action and
    // needs matches.
    const setSession = vi.fn(() => ({ query: 'zzz', matches: [], activeMatchIndex: -1, total: 0, canReplace: true }));
    const getState = vi.fn(() => ({ query: 'zzz', matches: [], activeMatchIndex: -1, total: 0, canReplace: true }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn(), getState },
      }),
    });
    expect(ui.search.find('zzz')).toMatchObject({ total: 0, canReplace: true, canReplaceAll: false });
    expect(ui.search.getSnapshot()).toMatchObject({ total: 0, canReplace: true, canReplaceAll: false });
  });

  it('keeps a rejected worker-backed query authoritative over the shell session it did not replace', async () => {
    // The shell rethrows on failure without replacing its stored session, so
    // getState() still describes A. B's failed snapshot must win anyway.
    const state = { query: '', total: 0, activeIndex: -1, canReplace: true };
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
    const editSearch = {
      query: vi.fn((input: { query: string }) => {
        if (input.query === '') return { status: 'ok', query: '', total: 0, activeIndex: -1 };
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      }),
      next: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
    };
    const editCommands = {
      search: editSearch,
      getState: () => ({ 'find.replace': { enabled: true }, 'find.replaceAll': { enabled: true } }),
      subscribe: () => () => {},
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });
    ui.search.find('A');
    Object.assign(state, { query: 'A', total: 3, activeIndex: 0 });
    pending[0]?.resolve({ status: 'ok', ...state });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 3, canReplace: true });

    ui.search.find('B');
    pending[1]?.reject(new Error('worker unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    const failed = { query: 'B', total: 0, canReplace: false, canReplaceAll: false, available: false };
    expect(ui.search.getSnapshot()).toMatchObject(failed);
    const observed = vi.fn();
    ui.search.observe(observed);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0]?.[0]).toMatchObject(failed);
    // Navigation fails closed on the published no-match snapshot and never
    // reaches the shell's stale A session.
    expect(ui.search.next()).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
    expect(editSearch.next).not.toHaveBeenCalled();
  });

  it('clears an invalid-pattern reason together with the query', () => {
    const empty = { query: '', matches: [], activeMatchIndex: -1, total: 0, canReplace: true };
    let hostState: Record<string, unknown> = empty;
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: {
          setSession: vi.fn((query: string) => {
            hostState = {
              ...empty,
              query,
              queryError: { code: 'invalid-pattern', message: 'Unterminated character class' },
            };
            return hostState;
          }),
          next: vi.fn(),
          previous: vi.fn(),
          clear: vi.fn(() => {
            hostState = empty;
          }),
          getState: vi.fn(() => hostState),
        },
      }),
    });
    expect(ui.search.find('[', { regex: true })).toMatchObject({
      reason: SUPERDOC_UI_REASONS.searchInvalidPattern,
      available: true,
    });
    const observed = vi.fn();
    ui.search.observe(observed);
    observed.mockClear();
    ui.search.clear();
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0]?.[0]).toMatchObject({ query: '', total: 0, available: true, reason: undefined });
    expect(ui.search.getSnapshot().reason).toBeUndefined();
  });

  it('publishes a new worker-backed query without the previous session matches', async () => {
    // Observers run inline. The first emit for B must not carry A's totals or
    // replace capabilities, or a re-entrant observer could act on A's session.
    const state = { query: '', total: 0, activeIndex: -1, canReplace: true };
    const pending: Array<(value: unknown) => void> = [];
    const editSearch = {
      query: vi.fn((input: { query: string }) => {
        if (input.query === '') return { status: 'ok', query: '', total: 0, activeIndex: -1 };
        return new Promise((resolve) => pending.push(resolve));
      }),
      next: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
    };
    const editCommands = {
      search: editSearch,
      getState: () => ({ 'find.replace': { enabled: true }, 'find.replaceAll': { enabled: true } }),
      subscribe: () => () => {},
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });
    ui.search.find('A');
    Object.assign(state, { query: 'A', total: 3, activeIndex: 0 });
    pending[0]?.({ status: 'ok', ...state });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'A', total: 3, canReplace: true, canReplaceAll: true });

    const seen: Array<{ query: string; total: number; canReplace: boolean; canReplaceAll: boolean }> = [];
    const reentrant: unknown[] = [];
    ui.search.observe((snapshot) => {
      seen.push({
        query: snapshot.query,
        total: snapshot.total,
        canReplace: snapshot.canReplace,
        canReplaceAll: snapshot.canReplaceAll,
      });
      if (snapshot.query === 'B') reentrant.push(ui.search.next());
    });
    seen.length = 0;
    editSearch.next.mockClear();

    ui.search.find('B');
    expect(seen.every((entry) => entry.query === 'B')).toBe(true);
    expect(seen[0]).toEqual({ query: 'B', total: 0, canReplace: false, canReplaceAll: false });
    expect(reentrant[0]).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
    expect(editSearch.next).not.toHaveBeenCalled();
  });

  it('republishes replace capabilities to search subscribers on document-mode-change', () => {
    // The host derives `canReplace` from the live document mode. Search has its
    // own listener set, so a mode flip must republish it explicitly or React /
    // Vue consumers keep offering Replace in viewing mode.
    let mode: 'editing' | 'viewing' = 'editing';
    const hostState = () => ({
      query: 'hello',
      matches: [{ length: 5 }, { length: 5 }],
      activeMatchIndex: 0,
      total: 2,
      canReplace: mode === 'editing',
    });
    const handlers = new Map<string, () => void>();
    const superdoc = makeSearchSuperdoc({
      search: {
        setSession: vi.fn(hostState),
        next: vi.fn(),
        previous: vi.fn(),
        clear: vi.fn(),
        getState: vi.fn(hostState),
      },
    });
    superdoc.on = vi.fn((event: string, handler: () => void) => handlers.set(event, handler));
    const ui = createSuperDocUI({ superdoc });
    expect(ui.search.find('hello')).toMatchObject({ total: 2, canReplace: true, canReplaceAll: true });
    const listener = vi.fn();
    ui.search.subscribe(listener);
    listener.mockClear();

    mode = 'viewing';
    superdoc.config.documentMode = 'viewing';
    handlers.get('document-mode-change')?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      snapshot: { total: 2, canReplace: false, canReplaceAll: false },
    });
    expect(ui.search.getSnapshot()).toMatchObject({ total: 2, canReplace: false, canReplaceAll: false });

    // An unrelated mode event with no capability change stays quiet.
    handlers.get('document-mode-change')?.();
    expect(listener).toHaveBeenCalledTimes(1);

    mode = 'editing';
    superdoc.config.documentMode = 'editing';
    handlers.get('document-mode-change')?.();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(ui.search.getSnapshot()).toMatchObject({ total: 2, canReplace: true, canReplaceAll: true });
  });

  it('cancels an outstanding shell fallback when a newer query is answered by the host', async () => {
    // Query A finds nothing inline, so the shell starts its Document API
    // fallback. Query B is answered by the inline host synchronously and never
    // reaches the shell, so nothing advances the shell's fallback generation
    // unless find() does it. A's late result must not project onto the host.
    let resolveFallback: (value: unknown) => void = () => {};
    const hostState = {
      query: '',
      matches: [] as Array<{ length: number }>,
      activeMatchIndex: -1,
      total: 0,
      canReplace: true,
    };
    const setSession = vi.fn((query: string) => {
      hostState.query = query;
      hostState.matches = query === 'B' ? [{ length: 1 }, { length: 1 }] : [];
      hostState.total = hostState.matches.length;
      hostState.activeMatchIndex = hostState.total > 0 ? 0 : -1;
      return { ...hostState };
    });
    const getState = vi.fn(() => ({ ...hostState }));
    const editSearch = {
      query: vi.fn((input: { query: string }) => {
        if (input.query === '') return { status: 'ok', query: '', total: 0, activeIndex: -1 };
        return new Promise((resolve) => {
          resolveFallback = resolve;
        });
      }),
      getState: vi.fn(() => ({ query: 'A', total: 0, activeIndex: -1 })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: {
          'find.replace': { shippedStatus: 'supported', enabled: true, reason: null },
          'find.replaceAll': { shippedStatus: 'supported', enabled: true, reason: null },
        },
      })),
    };
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn(), getState },
        editCommands,
      }),
    });

    ui.search.find('A');
    expect(editSearch.query).toHaveBeenCalledWith({
      query: 'A',
      caseSensitive: false,
      includeDeletedText: false,
      regex: false,
    });

    ui.search.find('B');
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'B', total: 2 });
    // The outstanding A fallback was told to stand down before B ran.
    expect(editSearch.query).toHaveBeenLastCalledWith({ query: '' });

    resolveFallback({ status: 'ok', query: 'A', total: 5, activeIndex: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ query: 'B', total: 2 });
  });

  it('reports canReplaceAll false and refuses replaceAll when the shell truncates the match set', async () => {
    // The browser shell enumerates at most 1,000 matches. Beyond that it keeps
    // `find.replace` enabled and disables `find.replaceAll` with
    // `search-truncated`. Both must reach the snapshot separately, or a panel
    // enables Replace all for an action that deterministically fails.
    const state = { query: 'the', total: 1200, activeIndex: 0 };
    const editSearch = {
      query: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
      replace: vi.fn(async () => ({ status: 'committed', replaced: 1 })),
      replaceAll: vi.fn(async () => ({ status: 'committed', replaced: 1200 })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: {
          'find.replace': { shippedStatus: 'supported', enabled: true, reason: null },
          'find.replaceAll': { shippedStatus: 'supported', enabled: false, reason: 'search-truncated' },
        },
      })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });

    ui.search.find('the');
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.search.getSnapshot()).toMatchObject({ total: 1200, canReplace: true, canReplaceAll: false });

    await expect(Promise.resolve(ui.search.replace('a'))).resolves.toEqual({ ok: true });
    expect(ui.search.replaceAll('a')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
    expect(editSearch.replaceAll).not.toHaveBeenCalled();
  });

  it('resolves an async fallback replace with the settled outcome, not an immediate ok', async () => {
    // Worker-backed replace mutations settle asynchronously. The handle must
    // resolve with the real mapped outcome so callers can hold their pending
    // state until the mutation lands (a fire-and-forget `{ ok: true }` made
    // double-click double-replace possible).
    let resolveReplace: (value: unknown) => void = () => {};
    const state = { query: 'hello', total: 1, activeIndex: 0 };
    const editSearch = {
      query: vi.fn(async () => ({ status: 'ok', ...state })),
      getState: vi.fn(() => ({ ...state })),
      replace: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveReplace = resolve;
          }),
      ),
      replaceAll: vi.fn(async () => ({ status: 'committed', replaced: 1 })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: {
          'find.replace': { shippedStatus: 'supported', enabled: true, reason: null },
          'find.replaceAll': { shippedStatus: 'supported', enabled: true, reason: null },
        },
      })),
    };
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ editCommands }) });

    const pending = ui.search.replace('x');
    expect(typeof (pending as Promise<unknown>)?.then).toBe('function');

    resolveReplace({ status: 'rejected', rejection: { code: 'read-only-document' } });
    await expect(pending).resolves.toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly });
  });

  it('falls back to browser-shell editCommands.search when host search cannot enumerate matches', async () => {
    const hostSearch = {
      setSession: vi.fn(() => ({ query: 'hello', matches: [], activeMatchIndex: -1, total: 0, canReplace: false })),
      getState: vi.fn(() => ({ query: 'hello', matches: [], activeMatchIndex: -1, total: 0, canReplace: false })),
      next: vi.fn(),
      previous: vi.fn(),
      clear: vi.fn(),
    };
    const editSearch = {
      query: vi.fn(async () => ({ status: 'ok', query: 'hello', total: 2, activeIndex: 0 })),
      getState: vi.fn(() => ({ query: 'hello', total: 2, activeIndex: 0 })),
    };
    const editCommands = {
      search: editSearch,
      getSnapshot: vi.fn(() => ({
        commands: {
          'find.replace': { shippedStatus: 'supported', enabled: true, reason: null },
          'find.replaceAll': { shippedStatus: 'supported', enabled: true, reason: null },
        },
      })),
    };
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({ search: hostSearch, editCommands }),
    });

    const slice = ui.search.find('hello');
    expect(hostSearch.setSession).toHaveBeenCalledWith('hello', {
      caseSensitive: false,
      includeDeletedText: false,
      highlight: true,
    });
    expect(editSearch.query).toHaveBeenCalledWith({
      query: 'hello',
      caseSensitive: false,
      includeDeletedText: false,
      regex: false,
    });
    expect(slice).toMatchObject({ query: 'hello', total: 2, activeIndex: 0, available: true });
  });

  it('refreshes search availability to unavailable when the active host disappears', async () => {
    const search = {
      setSession: vi.fn(() => ({
        query: 'hello',
        matches: [{ length: 1 }],
        activeMatchIndex: 0,
        total: 1,
        canReplace: true,
      })),
      getState: vi.fn(() => ({
        query: 'hello',
        matches: [{ length: 1 }],
        activeMatchIndex: 0,
        total: 1,
        canReplace: true,
      })),
      next: vi.fn(),
      previous: vi.fn(),
      clear: vi.fn(),
    };
    const superdoc = makeSearchSuperdoc({ search });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.search.find('hello')).toMatchObject({ available: true, total: 1 });
    delete (superdoc.activeEditor as { host?: unknown }).host;

    expect(ui.search.getSnapshot()).toMatchObject({
      available: false,
      total: 0,
      activeIndex: -1,
      reason: SUPERDOC_UI_REASONS.searchUnavailable,
    });
  });

  it('routes replace / replaceAll through the host search session when replace is available', async () => {
    const setSession = vi.fn(() => ({
      query: 'hello',
      matches: [{ length: 1 }],
      activeMatchIndex: 0,
      total: 1,
      canReplace: true,
    }));
    const getState = vi.fn(() => ({ query: 'hello', matches: [], activeMatchIndex: -1, total: 0, canReplace: true }));
    const replaceCurrent = vi.fn(() => ({ status: 'committed', replaced: 1 }));
    const replaceAll = vi.fn(() => ({ status: 'committed', replaced: 3 }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn(), getState, replaceCurrent, replaceAll },
      }),
    });
    ui.search.find('hello');
    expect(ui.search.replace('x')).toEqual({ ok: true });
    expect(replaceCurrent).toHaveBeenCalledWith('x');
    expect(ui.search.replaceAll('y')).toEqual({ ok: true });
    expect(replaceAll).toHaveBeenCalledWith('y');
  });

  it('fails closed on replace in viewing/read-only mode with document-readonly', async () => {
    const setSession = vi.fn(() => ({
      query: 'hello',
      matches: [{ length: 1 }],
      activeMatchIndex: 0,
      total: 1,
      canReplace: false,
    }));
    const replaceCurrent = vi.fn(() => ({ status: 'rejected', reason: 'read-only' }));
    const replaceAll = vi.fn(() => ({ status: 'rejected', reason: 'read-only' }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn(), replaceCurrent, replaceAll },
      }),
    });
    ui.search.find('hello');
    expect(ui.search.replace('x')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly });
    expect(ui.search.replaceAll('x')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly });
  });

  it('fails closed with operation-unavailable when the host search cannot replace', async () => {
    const setSession = vi.fn(() => ({ matches: [{ length: 1 }], activeMatchIndex: 0, total: 1 }));
    // Host exposes search/navigation but no replace methods (e.g. an older host).
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({ search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn() } }),
    });
    ui.search.find('hello');
    expect(ui.search.replace('x')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
    expect(ui.search.replaceAll('x')).toEqual({ ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable });
  });

  it('routes search navigation through the host search facade when present', async () => {
    const setSession = vi.fn(() => ({ matches: [{ length: 1 }, { length: 1 }], activeMatchIndex: 0 }));
    const next = vi.fn(() => ({ matches: [{ length: 1 }, { length: 1 }], activeMatchIndex: 1 }));
    const previous = vi.fn(() => ({ matches: [{ length: 1 }, { length: 1 }], activeMatchIndex: 0 }));
    const clear = vi.fn();
    const ui = createSuperDocUI({ superdoc: makeSearchSuperdoc({ search: { setSession, next, previous, clear } }) });

    expect(ui.search.open()).toEqual({ ok: true });
    const slice = ui.search.find('term', { caseSensitive: true });
    expect(setSession).toHaveBeenCalledWith('term', {
      caseSensitive: true,
      includeDeletedText: false,
      highlight: true,
    });
    expect(slice).toMatchObject({
      query: 'term',
      total: 2,
      activeIndex: 0,
      available: true,
      open: true,
      caseSensitive: true,
    });
    expect(slice.reason).toBeUndefined();

    expect(ui.search.next()).toEqual({ ok: true });
    expect(ui.search.getSnapshot().activeIndex).toBe(1);
    expect(ui.search.previous()).toEqual({ ok: true });
    expect(ui.search.getSnapshot().activeIndex).toBe(0);

    ui.search.clear();
    expect(clear).toHaveBeenCalled();
    expect(ui.search.getSnapshot()).toMatchObject({ query: '', total: 0, activeIndex: -1 });
  });

  it('passes includeTrackedDeletions through ui.search into the host search session', async () => {
    const setSession = vi.fn(() => ({
      query: 'deleted',
      matches: [{ length: 1 }],
      activeMatchIndex: 0,
      total: 1,
      canReplace: true,
      includeDeletedText: true,
    }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn() },
      }),
    });

    const slice = ui.search.find('deleted', { includeTrackedDeletions: true });
    expect(setSession).toHaveBeenCalledWith('deleted', {
      caseSensitive: false,
      includeDeletedText: true,
      highlight: true,
    });
    expect(slice).toMatchObject({
      query: 'deleted',
      total: 1,
      activeIndex: 0,
      available: true,
      includeTrackedDeletions: true,
      includeDeletedText: true,
    });
  });

  it('keeps search() as a compatibility alias for find()', () => {
    const setSession = vi.fn(() => ({ query: 'term', matches: [{ length: 1 }], activeMatchIndex: 0 }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({ search: { setSession, next: vi.fn(), previous: vi.fn(), clear: vi.fn() } }),
    });

    expect(ui.search.search('term', { includeDeletedText: true })).toMatchObject({
      query: 'term',
      total: 1,
      includeTrackedDeletions: true,
      includeDeletedText: true,
    });
    expect(setSession).toHaveBeenCalledWith('term', {
      caseSensitive: false,
      includeDeletedText: true,
      highlight: true,
    });
  });

  it('syncs host-owned search snapshots across controller instances', async () => {
    const getState = vi.fn(() => ({
      query: 'term',
      matches: [{ length: 1 }, { length: 1 }],
      activeMatchIndex: 1,
    }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: {
          setSession: vi.fn(),
          next: vi.fn(),
          previous: vi.fn(),
          clear: vi.fn(),
          getState,
        },
      }),
    });

    expect(ui.search.getSnapshot()).toMatchObject({
      query: 'term',
      total: 2,
      activeIndex: 1,
      available: true,
    });
    expect(getState).toHaveBeenCalled();
  });

  it('clears tracked-deletion search state when the host disables it', () => {
    let includeDeletedText = true;
    const getState = vi.fn(() => ({
      query: 'term',
      matches: [{ length: 1 }],
      activeMatchIndex: 0,
      includeDeletedText,
    }));
    const ui = createSuperDocUI({
      superdoc: makeSearchSuperdoc({
        search: {
          setSession: vi.fn(),
          next: vi.fn(),
          previous: vi.fn(),
          clear: vi.fn(),
          getState,
        },
      }),
    });

    expect(ui.search.getSnapshot()).toMatchObject({
      includeTrackedDeletions: true,
      includeDeletedText: true,
    });

    includeDeletedText = false;

    expect(ui.search.getSnapshot()).toMatchObject({
      includeTrackedDeletions: false,
      includeDeletedText: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Shared custom-button callback context (phase 2, WS2). The callback no longer
// depends on `superdoc.activeEditor.commands`; it routes through the shared
// controller (`execute`/`ui`), the Document API facade (`doc`/`insertText`),
// and read-only selection/mode context.
// ---------------------------------------------------------------------------

describe('public ui — shared custom-button callback context (row 747 / customButtons)', () => {
  it('hands a V2-truthful context with execute / ui / doc / insertText and no editor.commands dependency', async () => {
    const bold = vi.fn(() => ({ success: true }));
    const insert = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        // `commands` is null on v2 — the callback must never reach for it.
        commands: null,
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => SELECTION_INFO },
          format: { bold },
          insert,
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    let captured: Record<string, unknown> | null = null;
    ui.commands.register({
      id: 'proof-button',
      execute: (ctx) => {
        captured = ctx as unknown as Record<string, unknown>;
        // Route a real command through the shared controller (not editor.commands).
        // `execute` is the single canonical async path; fire-and-forget here.
        void ctx.execute('bold', true);
        // Insert text through the Document API helper (not editor.commands.insertContent).
        ctx.insertText(' token');
        return true;
      },
    });

    expect(await ui.commands.execute('proof-button')).toBe(true);
    expect(captured).not.toBeNull();
    const ctx = captured as unknown as {
      ui: unknown;
      doc: unknown;
      selection: { quotedText: string };
      documentMode: string;
      execute: unknown;
    };
    expect(ctx.ui).toBe(ui);
    expect(ctx.doc).toBe(superdoc.activeEditor.doc);
    expect(ctx.documentMode).toBe('editing');
    expect(ctx.selection.quotedText).toBe('hello');
    expect(typeof ctx.execute).toBe('function');
    expect(bold).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: true }, { offsetSpace: 'selection' });
    expect(insert).toHaveBeenCalledWith({
      type: 'text',
      value: ' token',
      target: SELECTION_TARGET,
    });
  });

  it('resolves the live async selection when insertText executes and passes that exact target', async () => {
    let resolveSelection!: (value: unknown) => void;
    const selectionResult = new Promise<unknown>((resolve) => {
      resolveSelection = resolve;
    });
    const liveTarget = {
      kind: 'selection',
      start: { kind: 'text', blockId: 'LIVE', offset: 9 },
      end: { kind: 'text', blockId: 'LIVE', offset: 9 },
    };
    const insert = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: vi.fn(() => selectionResult) },
          insert,
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    ui.commands.register({
      id: 'live-selection-insert',
      execute: (ctx) => ctx.insertText('live'),
    });

    const execution = ui.commands.executeAsync('live-selection-insert');
    expect(insert).not.toHaveBeenCalled();
    resolveSelection({ selectionTarget: liveTarget });
    await expect(execution).resolves.toMatchObject({ success: true });
    expect(insert).toHaveBeenCalledWith({
      type: 'text',
      value: 'live',
      target: liveTarget,
    });
  });

  it('fails insertText closed when the live selection has no target', async () => {
    const insert = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => ({ empty: true, target: null }) },
          insert,
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    let receipt: unknown = null;
    ui.commands.register({
      id: 'missing-selection-insert',
      execute: (ctx) => {
        receipt = ctx.insertText('x');
        return receipt;
      },
    });

    await ui.commands.executeAsync('missing-selection-insert');
    expect(receipt).toMatchObject({ success: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it('fails closed on insertText in viewing mode without reaching the document', async () => {
    const insert = vi.fn(() => ({ success: true }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: { current: () => null },
          insert,
        },
      },
      config: { documentMode: 'viewing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });
    let receipt: unknown = null;
    ui.commands.register({
      id: 'ro-insert',
      execute: (ctx) => {
        receipt = ctx.insertText('x');
        return true;
      },
    });
    await ui.commands.execute('ro-insert');
    expect(receipt).toMatchObject({ success: false });
    expect(insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WS4: ui.styles — read-only style catalogue + active paragraph style.
// The slice routes ONLY through the public Document API (`doc.styles.getCatalog`
// and `doc.getNodeById`); no toolbar wiring is exercised here (that is WS5).
// ---------------------------------------------------------------------------
describe('public ui — styles slice (WS4)', () => {
  const item = (over: Record<string, unknown>) => ({
    id: 'Normal',
    name: 'Normal',
    aliases: [],
    type: 'paragraph',
    custom: false,
    builtin: true,
    default: true,
    basedOn: null,
    next: null,
    link: null,
    priority: 0,
    qFormat: true,
    hidden: false,
    semiHidden: false,
    unhideWhenUsed: false,
    locked: false,
    provenance: 'authored',
    visibility: { quickGallery: true, recommended: true, all: true, effectivelyHidden: false },
    ...over,
  });

  const NORMAL = item({ id: 'Normal', name: 'Normal', priority: 0 });
  const HEADING1 = item({ id: 'Heading1', name: 'Heading 1', default: false, priority: 9 });
  const TITLE = item({ id: 'Title', name: 'Title', default: false, priority: 1 });

  const SOURCE_STATUS = {
    styles: 'present',
    settings: 'present',
    usage: 'unsupported',
    preview: 'unsupported',
    view: 'supported',
  };
  const PREVIEW_SOURCE_STATUS = { ...SOURCE_STATUS, preview: 'available' };

  const NORMAL_PREVIEW = {
    ...NORMAL,
    preview: { available: true, css: { fontFamily: 'Arial', fontSize: '11pt' } },
  };
  const HEADING1_PREVIEW = {
    ...HEADING1,
    preview: { available: true, css: { fontFamily: 'Aptos Display', fontSize: '16pt', fontWeight: 'bold' } },
  };
  const TITLE_PREVIEW = {
    ...TITLE,
    preview: { available: true, css: { fontFamily: 'Aptos Display', fontSize: '22pt' } },
  };

  const CATALOG_ALL = {
    version: 'style-catalog/v1',
    revision: 'rev-7',
    view: 'all',
    defaults: { paragraphStyleId: 'Normal', characterStyleId: null, tableStyleId: 'TableNormal' },
    items: [NORMAL, TITLE, HEADING1],
    styles: [NORMAL, TITLE, HEADING1],
    sourceStatus: SOURCE_STATUS,
    diagnostics: [{ severity: 'info', code: 'default-floor-applied', message: 'Default floor applied.' }],
  };
  const CATALOG_QUICK = { ...CATALOG_ALL, view: 'quickGallery', items: [TITLE, HEADING1, NORMAL] };
  const CATALOG_ALL_PREVIEW = {
    ...CATALOG_ALL,
    items: [NORMAL_PREVIEW, TITLE_PREVIEW, HEADING1_PREVIEW],
    styles: [NORMAL_PREVIEW, TITLE_PREVIEW, HEADING1_PREVIEW],
    sourceStatus: PREVIEW_SOURCE_STATUS,
  };
  const CATALOG_QUICK_PREVIEW = {
    ...CATALOG_ALL_PREVIEW,
    view: 'quickGallery',
    items: [TITLE_PREVIEW, HEADING1_PREVIEW, NORMAL_PREVIEW],
  };

  function makeStylesSuperdoc(
    opts: {
      blocks?: Record<string, { kind?: string; styleRef?: string } | null>;
      segments?: Array<{ blockId: string }>;
      catalog?: boolean;
      getNode?: boolean;
      mode?: string;
    } = {},
  ) {
    const blocks = opts.blocks ?? { P1: { styleRef: 'Heading1' } };
    const segments = opts.segments ?? [{ blockId: 'P1', range: { start: 0, end: 4 } }];
    const getCatalog = vi.fn((input?: { view?: string; includePreview?: boolean }) => {
      if (input?.view === 'quickGallery') {
        return input.includePreview ? CATALOG_QUICK_PREVIEW : CATALOG_QUICK;
      }
      return input?.includePreview ? CATALOG_ALL_PREVIEW : CATALOG_ALL;
    });
    const getNodeById = vi.fn((input: { nodeId: string }) => {
      const entry = blocks[input.nodeId];
      if (entry === undefined) return null;
      if (entry === null) return null;
      const kind = entry.kind ?? 'paragraph';
      const payload = entry.styleRef ? { styleRef: entry.styleRef } : {};
      return { node: { kind, [kind]: payload } };
    });
    const doc: Record<string, unknown> = {
      comments: { list: () => ({ items: [] }) },
      trackChanges: { list: () => ({ items: [] }) },
      selection: {
        current: () => ({
          empty: false,
          target: { kind: 'text', segments },
          activeMarks: [],
          activeCommentIds: [],
          activeChangeIds: [],
          text: 'hi',
        }),
      },
    };
    if (opts.catalog !== false) doc.styles = { getCatalog };
    if (opts.getNode !== false) doc.getNodeById = getNodeById;
    const superdoc = {
      activeEditor: { doc },
      config: { documentMode: opts.mode ?? 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    return { superdoc, getCatalog, getNodeById };
  }

  it('exposes the styles handle surface', async () => {
    const { superdoc } = makeStylesSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    expect(typeof ui.styles.getSnapshot).toBe('function');
    expect(typeof ui.styles.subscribe).toBe('function');
    expect(typeof ui.styles.getQuickGallery).toBe('function');
    expect(typeof ui.styles.getActiveParagraphStyle).toBe('function');
  });

  it('projects the catalogue revision, source status, diagnostics, and ordered quick gallery', async () => {
    const { superdoc, getCatalog } = makeStylesSuperdoc();
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.ready).toBe(true);
    expect(snap.catalogRevision).toBe('rev-7');
    expect(snap.sourceStatus).toEqual(PREVIEW_SOURCE_STATUS);
    expect(snap.diagnostics).toContainEqual({
      severity: 'info',
      code: 'default-floor-applied',
      message: 'Default floor applied.',
    });
    // The quick gallery is the authoritative `quickGallery` view ordering.
    expect(snap.quickGallery.map((s) => s.id)).toEqual(['Title', 'Heading1', 'Normal']);
    expect(snap.quickGallery[1].preview?.css).toMatchObject({ fontSize: '16pt', fontWeight: 'bold' });
    expect(ui.styles.getQuickGallery().map((s) => s.id)).toEqual(['Title', 'Heading1', 'Normal']);
    // The snapshot reads all + quickGallery views, and both reads request
    // preview tokens for Word-like style-menu rendering.
    expect(getCatalog).toHaveBeenCalledTimes(2);
    expect(getCatalog).toHaveBeenNthCalledWith(1, { includePreview: true });
    expect(getCatalog).toHaveBeenNthCalledWith(2, { view: 'quickGallery', includePreview: true });
  });

  it('invalidates the cached catalogue and notifies styles subscribers on host document events', async () => {
    const { superdoc } = makeStylesSuperdoc();
    const hostEvents: Array<(event: { type: string }) => void> = [];
    let revision = 'rev-7';
    const getCatalog = vi.fn((input?: { view?: string }) => {
      const all = { ...CATALOG_ALL, revision };
      return input?.view === 'quickGallery'
        ? { ...all, view: 'quickGallery', items: revision === 'rev-8' ? [HEADING1] : [TITLE] }
        : all;
    });
    (superdoc.activeEditor.doc as Record<string, unknown>).styles = { getCatalog };
    (superdoc.activeEditor as Record<string, unknown>).host = {
      events: {
        subscribe: (listener: (event: { type: string }) => void) => {
          hostEvents.push(listener);
          return () => undefined;
        },
      },
    };
    const ui = createSuperDocUI({ superdoc });
    const seen: Array<ReturnType<typeof ui.styles.getSnapshot>> = [];
    ui.styles.observe((slice) => seen.push(slice));
    expect(ui.styles.getSnapshot().catalogRevision).toBe('rev-7');
    expect(ui.styles.getQuickGallery().map((s) => s.id)).toEqual(['Title']);

    revision = 'rev-8';
    hostEvents[0]?.({ type: 'mutation:committed' });

    expect(ui.styles.getSnapshot().catalogRevision).toBe('rev-8');
    expect(ui.styles.getQuickGallery().map((s) => s.id)).toEqual(['Heading1']);
    expect(seen.at(-1)?.catalogRevision).toBe('rev-8');
  });

  it('resolves a uniform active paragraph style with its display name', async () => {
    const { superdoc } = makeStylesSuperdoc({ blocks: { P1: { styleRef: 'Heading1' } } });
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.activeParagraphStyleId).toBe('Heading1');
    expect(snap.activeParagraphStyleName).toBe('Heading 1');
    expect(snap.mixedSelection).toBe(false);
    const active = ui.styles.getActiveParagraphStyle();
    expect(active).toMatchObject({ styleId: 'Heading1', styleName: 'Heading 1', mixed: false });
  });

  it('resolves active paragraph styles per story when block ids collide', async () => {
    const bodyStory = { kind: 'story', storyType: 'body' } as const;
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId6' } as const;
    let activeStory: typeof bodyStory | typeof headerStory = bodyStory;
    let notifySelection = () => undefined;
    const getNodeById = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { styleRef: 'Heading1' } },
    }));
    const getNode = vi.fn(() => ({
      node: { kind: 'paragraph', paragraph: { styleRef: 'Title' } },
    }));
    const superdoc = {
      activeEditor: {
        doc: {
          comments: { list: () => ({ items: [] }) },
          trackChanges: { list: () => ({ items: [] }) },
          selection: {
            current: () => ({
              empty: true,
              target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 0 } }], story: activeStory },
              activeMarks: [],
              activeCommentIds: [],
              activeChangeIds: [],
              text: '',
            }),
          },
          styles: {
            getCatalog: (input?: { view?: string }) => (input?.view === 'quickGallery' ? CATALOG_QUICK : CATALOG_ALL),
          },
          getNodeById,
          getNode,
        },
        host: {
          getHandles: () => ({
            editing: {
              selection: {
                subscribe: (listener: () => void) => {
                  notifySelection = listener;
                  return () => undefined;
                },
              },
            },
          }),
        },
      },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    const ui = createSuperDocUI({ superdoc });

    expect(ui.styles.getSnapshot().activeParagraphStyleId).toBe('Heading1');
    expect(getNodeById).toHaveBeenCalledWith({ nodeId: 'P1', nodeType: 'paragraph' });

    activeStory = headerStory;
    notifySelection();

    expect(ui.styles.getSnapshot().activeParagraphStyleId).toBe('Title');
    expect(getNode).toHaveBeenCalledWith({
      kind: 'block',
      nodeType: 'paragraph',
      nodeId: 'P1',
      story: headerStory,
    });
    expect(getNodeById).toHaveBeenCalledTimes(1);
  });

  it('does not fan out paragraph metadata reads for a document-wide selection', async () => {
    const segments = Array.from({ length: 65 }, (_, index) => ({
      blockId: `P${index}`,
      range: { start: 0, end: 1 },
    }));
    const blocks = Object.fromEntries(segments.map(({ blockId }) => [blockId, { styleRef: 'Heading1' }]));
    const { superdoc, getNodeById } = makeStylesSuperdoc({ blocks, segments });
    const hyperlinksList = vi.fn(() => ({ items: [] }));
    const queryMatch = vi.fn(() => ({ items: [] }));
    (superdoc.activeEditor.doc as Record<string, unknown>).hyperlinks = { list: hyperlinksList };
    (superdoc.activeEditor.doc as Record<string, unknown>).query = { match: queryMatch };

    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();

    expect(getNodeById).not.toHaveBeenCalled();
    expect(hyperlinksList).not.toHaveBeenCalled();
    expect(queryMatch).not.toHaveBeenCalled();
    expect(snap.activeParagraphStyleId).toBeNull();
    expect(snap.diagnostics.some((diagnostic) => diagnostic.code === 'active-style-selection-too-large')).toBe(true);
  });

  it('projects the active paragraph style into linked-style command state for toolbar labels', async () => {
    const { superdoc } = makeStylesSuperdoc({ blocks: { P1: { styleRef: 'Heading1' } } });
    const doc = superdoc.activeEditor.doc as Record<string, unknown>;
    doc.styles = {
      ...(doc.styles as Record<string, unknown>),
      paragraph: { setStyle: vi.fn(() => ({ success: true })) },
    };

    const ui = createSuperDocUI({ superdoc });
    expect(ui.commands.get('linked-style').getState()).toMatchObject({
      enabled: true,
      supported: true,
      value: { styleId: 'Heading1', styleName: 'Heading 1' },
    });
  });

  it('falls back to the document default paragraph style when a block has no explicit style', async () => {
    const { superdoc } = makeStylesSuperdoc({ blocks: { P1: {} } });
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.activeParagraphStyleId).toBe('Normal');
    expect(snap.activeParagraphStyleName).toBe('Normal');
    expect(snap.mixedSelection).toBe(false);
  });

  it('fails closed when the document default style is needed but the catalogue is unavailable', async () => {
    const { superdoc } = makeStylesSuperdoc({ blocks: { P1: {} }, catalog: false });
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.activeParagraphStyleId).toBeNull();
    expect(snap.activeParagraphStyleName).toBeNull();
    expect(snap.mixedSelection).toBe(false);
    expect(snap.diagnostics.some((d) => d.code === 'active-style-default-unavailable')).toBe(true);
  });

  it('reports a mixed selection across paragraphs with differing styles', async () => {
    const { superdoc } = makeStylesSuperdoc({
      blocks: { P1: { styleRef: 'Heading1' }, P2: { styleRef: 'Title' } },
      segments: [
        { blockId: 'P1', range: { start: 0, end: 2 } },
        { blockId: 'P2', range: { start: 0, end: 2 } },
      ],
    });
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.mixedSelection).toBe(true);
    expect(snap.activeParagraphStyleId).toBeNull();
    expect(snap.activeParagraphStyleName).toBeNull();
  });

  it('fails closed with diagnostics when the catalogue surface is unavailable', async () => {
    const { superdoc } = makeStylesSuperdoc({ catalog: false });
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.ready).toBe(true);
    expect(snap.catalogRevision).toBeNull();
    expect(snap.sourceStatus).toBeNull();
    expect(snap.quickGallery).toEqual([]);
    expect(snap.diagnostics.some((d) => d.code === 'catalog-unavailable')).toBe(true);
    // Active style still resolves from block reads even without the catalogue.
    expect(snap.activeParagraphStyleId).toBe('Heading1');
    expect(snap.activeParagraphStyleName).toBeNull();
  });

  it('fails closed when block reads are unavailable', async () => {
    const { superdoc } = makeStylesSuperdoc({ getNode: false });
    const ui = createSuperDocUI({ superdoc });
    const active = ui.styles.getActiveParagraphStyle();
    expect(active.styleId).toBeNull();
    expect(active.mixed).toBe(false);
    expect(active.diagnostics.some((d) => d.code === 'active-style-read-failed')).toBe(true);
  });

  it('fails closed instead of claiming a uniform style when any selected block read is unavailable', async () => {
    const { superdoc } = makeStylesSuperdoc({
      blocks: { P1: { styleRef: 'Heading1' }, P2: null },
      segments: [
        { blockId: 'P1', range: { start: 0, end: 2 } },
        { blockId: 'P2', range: { start: 0, end: 2 } },
      ],
    });
    const ui = createSuperDocUI({ superdoc });
    const snap = ui.styles.getSnapshot();
    expect(snap.activeParagraphStyleId).toBeNull();
    expect(snap.activeParagraphStyleName).toBeNull();
    expect(snap.mixedSelection).toBe(false);
    expect(snap.diagnostics.some((d) => d.code === 'active-style-partial')).toBe(true);
  });

  it('returns an empty, fail-closed slice before an editor is ready', async () => {
    const ui = createSuperDocUI({ superdoc: { on: vi.fn(), off: vi.fn() } });
    const snap = ui.styles.getSnapshot();
    expect(snap.ready).toBe(false);
    expect(snap.quickGallery).toEqual([]);
    expect(snap.activeParagraphStyleId).toBeNull();
    expect(snap.sourceStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Async browser reads: the controller is a sync reactive store over an async
// Document API facade (`forceAsync`). Promise-returning reads must settle into
// the slices via the internal read coordinator instead of collapsing to
// empty/null, with explicit pending/ready/stale readiness and stale-result
// guards.
// ---------------------------------------------------------------------------
describe('public ui — async browser reads (read coordinator)', () => {
  const flush = async () => {
    // Drain the microtask chain (read settle → coalesced recompute → dependent
    // read settle → recompute) plus the queueMicrotask refresh.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  const RANGE_SELECTION = {
    empty: false,
    target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 5 } }] },
    selectionTarget: SELECTION_TARGET,
    activeMarks: [] as string[],
    activeCommentIds: ['c-1'],
    activeChangeIds: ['tc-1'],
    text: 'hello',
  };
  const ASYNC_CONTENT_CONTROL = {
    nodeType: 'sdt',
    kind: 'inline',
    id: 'cc-1',
    controlType: 'text',
    lockMode: 'unlocked',
    properties: {},
    target: { kind: 'inline', nodeType: 'sdt', nodeId: 'cc-1' },
    selectionTarget: SELECTION_TARGET,
  };

  function makeAsyncSuperdoc(
    over: {
      selection?: () => unknown;
      comments?: () => unknown;
      trackChanges?: () => unknown;
      trackChangesGet?: (input: unknown) => unknown;
      trackChangesDecide?: (input: unknown) => unknown;
      contentControls?: { list?: () => unknown; listInRange?: () => unknown };
      query?: () => unknown;
      styles?: { getCatalog?: () => unknown };
      getNodeById?: () => unknown;
      hyperlinks?: () => unknown;
      lists?: () => unknown;
      format?: Record<string, unknown>;
      v2TrackedChanges?: {
        listTrackedChanges?: (...args: unknown[]) => unknown;
        getTrackedChange?: (...args: unknown[]) => unknown;
      };
      hostEvents?: Array<(event: Record<string, unknown>) => void>;
      hostCapabilities?: () => unknown;
      onSelection?: (notify: () => void) => void;
    } = {},
  ) {
    let notifySelection = () => {};
    if (over.onSelection) over.onSelection(() => notifySelection());
    const host = {
      ...(over.hostCapabilities ? { getCapabilities: over.hostCapabilities } : {}),
      getHandles: () => ({
        editing: {
          selection: {
            subscribe: (listener: () => void) => {
              notifySelection = listener;
              return () => {
                notifySelection = () => {};
              };
            },
          },
        },
      }),
    };
    if (over.hostEvents) {
      (host as Record<string, unknown>).events = {
        subscribe: (listener: (event: Record<string, unknown>) => void) => {
          over.hostEvents?.push(listener);
          return () => undefined;
        },
      };
    }
    const doc: Record<string, unknown> = {
      selection: { current: over.selection ?? (() => Promise.resolve(RANGE_SELECTION)) },
      comments: { list: over.comments ?? (() => Promise.resolve({ items: [{ id: 'c-1', text: 'hi' }] })) },
      trackChanges: {
        list: over.trackChanges ?? (() => Promise.resolve({ items: [{ id: 'tc-1', type: 'insert' }] })),
        ...(over.trackChangesGet ? { get: over.trackChangesGet } : {}),
        ...(over.trackChangesDecide ? { decide: over.trackChangesDecide } : {}),
      },
      contentControls: {
        list: over.contentControls?.list ?? (() => Promise.resolve({ items: [ASYNC_CONTENT_CONTROL] })),
        listInRange: over.contentControls?.listInRange ?? (() => Promise.resolve({ items: [ASYNC_CONTENT_CONTROL] })),
      },
      query: { match: over.query ?? (() => Promise.resolve({ items: [] })) },
      format: over.format ?? { bold: () => Promise.resolve({ success: true }) },
    };
    if (over.styles) doc.styles = { getCatalog: over.styles.getCatalog };
    if (over.getNodeById) doc.getNodeById = over.getNodeById;
    if (over.hyperlinks) {
      // Route ops must exist for the command to reach active/value computation.
      doc.hyperlinks = {
        list: over.hyperlinks,
        wrap: () => Promise.resolve({ success: true }),
        patch: () => Promise.resolve({ success: true }),
        remove: () => Promise.resolve({ success: true }),
        insert: () => Promise.resolve({ success: true }),
      };
    }
    if (over.lists) doc.lists = { getState: over.lists, apply: () => Promise.resolve({ success: true }) };
    const superdoc = {
      activeEditor: { host, doc, ...(over.v2TrackedChanges ? { v2TrackedChanges: over.v2TrackedChanges } : {}) },
      config: { documentMode: 'editing' },
      on: vi.fn(),
      off: vi.fn(),
    };
    return { superdoc, notifySelection: () => notifySelection() };
  }

  it('refreshes settled content-control observers for consecutive standalone document mutations', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    let items = [ASYNC_CONTENT_CONTROL];
    const listInRange = vi.fn(async () => ({ items }));
    const { superdoc } = makeAsyncSuperdoc({ hostEvents, contentControls: { listInRange } });
    const ui = createSuperDocUI({ superdoc });
    const observed: string[][] = [];
    const stop = ui.contentControls.observe((snapshot) => observed.push([...snapshot.activeIds]));
    await flush();
    expect(ui.contentControls.getSnapshot().activeIds).toEqual(['cc-1']);

    for (const id of ['cc-2', 'cc-3']) {
      items = [{ ...ASYNC_CONTENT_CONTROL, id }];
      hostEvents.at(-1)?.({ type: 'document:mutated', source: 'facade', hasCommitEvent: false });
      await flush();
      expect(ui.contentControls.getSnapshot().activeIds).toEqual([id]);
      expect(observed.at(-1)).toEqual([id]);
      expect(ui.document.getSnapshot().dirty).toBe(true);
    }
    expect(listInRange).toHaveBeenCalledTimes(3);
    stop();
    ui.destroy();
  });

  it.each(['before', 'after'] as const)(
    'does not refresh twice when document:mutated comes %s its commit event',
    async (order) => {
      const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
      const listInRange = vi.fn(async () => ({ items: [ASYNC_CONTENT_CONTROL] }));
      const { superdoc } = makeAsyncSuperdoc({ hostEvents, contentControls: { listInRange } });
      const ui = createSuperDocUI({ superdoc });
      await flush();
      const emitDocumentMutation = () =>
        hostEvents.at(-1)?.({
          type: 'document:mutated',
          source: 'facade',
          hasCommitEvent: true,
        });
      if (order === 'before') emitDocumentMutation();
      hostEvents.at(-1)?.({ type: 'mutation:committed', receipt: { success: true } });
      if (order === 'after') emitDocumentMutation();
      await flush();
      expect(listInRange).toHaveBeenCalledTimes(2);
      ui.destroy();
    },
  );

  it('settles promise-returning selection/comments/trackChanges/contentControls into slices', async () => {
    const { superdoc } = makeAsyncSuperdoc();
    const ui = createSuperDocUI({ superdoc });

    // Before settle: pending, never collapsed to a fabricated value.
    expect(ui.selection.getSnapshot().status).toBe('pending');
    expect(ui.selection.getSnapshot().empty).toBe(true);
    expect(ui.comments.getSnapshot().status).toBe('pending');
    expect(ui.comments.getSnapshot().total).toBe(0);
    expect(ui.trackChanges.getSnapshot().status).toBe('pending');
    expect(ui.contentControls.getSnapshot().status).toBe('pending');

    await flush();

    expect(ui.selection.getSnapshot().status).toBe('ready');
    expect(ui.selection.getSnapshot().empty).toBe(false);
    expect(ui.selection.getSnapshot().quotedText).toBe('hello');
    expect(ui.comments.getSnapshot().status).toBe('ready');
    expect(ui.comments.getSnapshot().total).toBe(1);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');
    expect(ui.trackChanges.getSnapshot().status).toBe('ready');
    expect(ui.trackChanges.getSnapshot().total).toBe(1);
    expect(ui.contentControls.getSnapshot().status).toBe('ready');
    expect(ui.contentControls.getSnapshot().activeIds).toEqual(['cc-1']);
  });

  it('preserves settled active controls while a new selection range read is pending', async () => {
    const rangeResolvers: Array<(value: unknown) => void> = [];
    const listInRange = vi.fn(
      () =>
        new Promise((resolve) => {
          rangeResolvers.push(resolve);
        }),
    );
    let currentSelection = RANGE_SELECTION;
    const { superdoc, notifySelection } = makeAsyncSuperdoc({
      selection: () => Promise.resolve(currentSelection),
      contentControls: { listInRange },
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(rangeResolvers).toHaveLength(1);
    rangeResolvers[0]?.({ items: [ASYNC_CONTENT_CONTROL] });
    await flush();
    expect(ui.contentControls.getSnapshot().activeIds).toEqual(['cc-1']);
    const activeIdsAfterSettle: string[][] = [];
    const stop = ui.contentControls.observe((snapshot) => activeIdsAfterSettle.push(snapshot.activeIds));

    currentSelection = {
      ...RANGE_SELECTION,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 1, end: 4 } }] },
      selectionTarget: {
        kind: 'selection',
        start: { kind: 'text', blockId: 'P1', offset: 1 },
        end: { kind: 'text', blockId: 'P1', offset: 4 },
      },
      text: 'ell',
    };
    notifySelection();
    await flush();

    expect(rangeResolvers).toHaveLength(2);
    expect(ui.contentControls.getSnapshot()).toMatchObject({
      status: 'stale',
      activeId: 'cc-1',
      activeIds: ['cc-1'],
    });

    rangeResolvers[1]?.({ items: [ASYNC_CONTENT_CONTROL] });
    await flush();
    expect(ui.contentControls.getSnapshot()).toMatchObject({
      status: 'ready',
      activeId: 'cc-1',
      activeIds: ['cc-1'],
    });
    expect(activeIdsAfterSettle).not.toContainEqual([]);
    stop();
  });

  it('keeps snapshots page-bounded and holds complete directories only for explicit domain observers', async () => {
    const commentsList = vi.fn(() => Promise.resolve({ items: [{ id: 'global-comment' }] }));
    const trackChangesList = vi.fn(() =>
      Promise.resolve({
        items: [
          { id: 'global-tc', type: 'delete', deletedText: 'directory deletion' },
          {
            id: 'tc-move::move-to',
            type: 'move',
            subtype: 'move-to',
            trackedChangeCanonicalId: 'tc-move',
          },
          {
            id: 'tc-move::move-from',
            type: 'move',
            subtype: 'move-from',
            trackedChangeCanonicalId: 'tc-move',
          },
        ],
      }),
    );
    const { superdoc } = makeAsyncSuperdoc({ comments: commentsList, trackChanges: trackChangesList });
    let snapshot = {
      status: 'ready',
      routeId: 'window-1',
      commentItems: [{ id: 'comment-visible', text: 'visible' }],
      trackedChangeItems: [
        { id: 'tc-visible', type: 'insert', author: 'Ada' },
        {
          id: 'tc-move',
          type: 'move',
          move: { source: { blockId: 'SOURCE' }, destination: { blockId: 'DESTINATION' } },
        },
      ],
    };
    const listeners = new Set<() => void>();
    Object.assign(superdoc.activeEditor, {
      editorVersion: 2,
      reviewWindow: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();

    expect(commentsList).not.toHaveBeenCalled();
    expect(trackChangesList).not.toHaveBeenCalled();
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['comment-visible']);
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-visible', 'tc-move']);

    const commentsSeen: ReturnType<typeof ui.comments.getSnapshot>[] = [];
    const stopComments = ui.comments.observe((value) => commentsSeen.push(value));
    expect(commentsSeen[commentsSeen.length - 1]?.listStatus).toBe('pending');
    expect(commentsList).toHaveBeenCalledTimes(1);
    expect(trackChangesList).not.toHaveBeenCalled();
    await flush();
    expect(commentsSeen[commentsSeen.length - 1]?.items.map((item) => item.id)).toEqual(['global-comment']);
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['comment-visible']);
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-visible', 'tc-move']);

    const stopCommentsSecond = ui.comments.subscribe(() => undefined);
    const trackChangesSeen: ReturnType<typeof ui.trackChanges.getSnapshot>[] = [];
    const stopTrackChanges = ui.trackChanges.observe((value) => trackChangesSeen.push(value));
    expect(commentsList).toHaveBeenCalledTimes(1);
    expect(trackChangesList).toHaveBeenCalledTimes(1);
    await flush();
    expect(trackChangesSeen[trackChangesSeen.length - 1]?.items.map((item) => item.id)).toEqual([
      'global-tc',
      'tc-move::move-to',
      'tc-move::move-from',
    ]);
    expect(trackChangesSeen[trackChangesSeen.length - 1]?.items[0]?.deletedText).toBe('directory deletion');
    expect(trackChangesSeen[trackChangesSeen.length - 1]?.items.slice(1)).toEqual([
      expect.objectContaining({
        id: 'tc-move::move-to',
        subtype: 'move-to',
        trackedChangeCanonicalId: 'tc-move',
      }),
      expect.objectContaining({
        id: 'tc-move::move-from',
        subtype: 'move-from',
        trackedChangeCanonicalId: 'tc-move',
      }),
    ]);
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-visible', 'tc-move']);
    expect(ui.comments.setActive('global-comment')).toBe(true);
    expect(ui.trackChanges.setActive('global-tc')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('global-comment');
    expect(ui.trackChanges.getSnapshot().activeId).toBe('global-tc');

    snapshot = {
      status: 'ready',
      routeId: 'window-2',
      commentItems: [{ id: 'comment-deep', text: 'deep' }],
      trackedChangeItems: [{ id: 'tc-deep', type: 'delete', author: 'Grace' }],
    };
    for (const listener of listeners) listener();

    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['comment-deep']);
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-deep']);
    expect(commentsSeen[commentsSeen.length - 1]?.items.map((item) => item.id)).toEqual(['global-comment']);
    expect(trackChangesSeen[trackChangesSeen.length - 1]?.items.map((item) => item.id)).toEqual([
      'global-tc',
      'tc-move::move-to',
      'tc-move::move-from',
    ]);
    expect(commentsList).toHaveBeenCalledTimes(1);
    expect(trackChangesList).toHaveBeenCalledTimes(1);

    stopComments();
    await flush();
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['comment-deep']);
    stopCommentsSecond();
    stopTrackChanges();
    await flush();
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['comment-deep']);
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-deep']);
    ui.destroy();
  });

  it('refreshes an incomplete observed tracked-change directory once source loading completes', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    const listTrackedChanges = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        items: [{ id: 'tc-prefix', type: 'insert' }],
        complete: false,
        sourceCoverageComplete: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        items: [
          { id: 'tc-prefix', type: 'insert' },
          { id: 'tc-tail', type: 'delete' },
        ],
        complete: true,
        sourceCoverageComplete: true,
      });
    const { superdoc } = makeAsyncSuperdoc({
      v2TrackedChanges: { listTrackedChanges },
      hostEvents,
    });
    Object.assign(superdoc.activeEditor, {
      editorVersion: 2,
      reviewWindow: {
        getSnapshot: () => ({
          status: 'ready',
          routeId: 'window-1',
          commentItems: [],
          trackedChangeItems: [{ id: 'tc-visible', type: 'insert' }],
        }),
        subscribe: () => () => undefined,
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const seen: ReturnType<typeof ui.trackChanges.getSnapshot>[] = [];
    const stop = ui.trackChanges.observe((value) => seen.push(value));

    await flush();

    expect(listTrackedChanges).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toMatchObject({
      status: 'stale',
      total: 1,
      items: [{ id: 'tc-prefix' }],
    });

    hostEvents[0]?.({ type: 'source:complete' });
    await flush();

    expect(listTrackedChanges).toHaveBeenCalledTimes(2);
    expect(seen[seen.length - 1]).toMatchObject({
      status: 'ready',
      total: 2,
      items: [{ id: 'tc-prefix' }, { id: 'tc-tail' }],
    });

    hostEvents[0]?.({ type: 'source:signals-complete' });
    await flush();
    expect(listTrackedChanges).toHaveBeenCalledTimes(2);

    stop();
    ui.destroy();
  });

  it('refreshes when source completion races an incomplete directory promise settlement', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    let settleIncomplete!: (value: Record<string, unknown>) => void;
    const incomplete = new Promise<Record<string, unknown>>((resolve) => {
      settleIncomplete = resolve;
    });
    const listTrackedChanges = vi
      .fn()
      .mockReturnValueOnce(incomplete)
      .mockResolvedValueOnce({
        ok: true,
        items: [
          { id: 'tc-prefix', type: 'insert' },
          { id: 'tc-tail', type: 'delete' },
        ],
        complete: true,
        sourceCoverageComplete: true,
      });
    const { superdoc } = makeAsyncSuperdoc({
      v2TrackedChanges: { listTrackedChanges },
      hostEvents,
    });
    Object.assign(superdoc.activeEditor, {
      editorVersion: 2,
      reviewWindow: {
        getSnapshot: () => ({
          status: 'ready',
          routeId: 'window-1',
          commentItems: [],
          trackedChangeItems: [{ id: 'tc-visible', type: 'insert' }],
        }),
        subscribe: () => () => undefined,
      },
    });
    const ui = createSuperDocUI({ superdoc });
    const seen: ReturnType<typeof ui.trackChanges.getSnapshot>[] = [];
    const stop = ui.trackChanges.observe((value) => seen.push(value));
    expect(listTrackedChanges).toHaveBeenCalledTimes(1);

    hostEvents[0]?.({ type: 'source:complete' });
    settleIncomplete({
      ok: true,
      items: [{ id: 'tc-prefix', type: 'insert' }],
      complete: false,
      sourceCoverageComplete: false,
    });
    await flush();
    await flush();

    expect(listTrackedChanges).toHaveBeenCalledTimes(2);
    expect(seen[seen.length - 1]).toMatchObject({
      status: 'ready',
      total: 2,
      items: [{ id: 'tc-prefix' }, { id: 'tc-tail' }],
    });

    stop();
    ui.destroy();
  });

  it('uses the v2 tracked-change facade for enriched custom-UI rows when available', async () => {
    const rawTrackChangesList = vi.fn(() =>
      Promise.resolve({
        items: [{ id: 'raw-tc-1', type: 'insert', author: 'Raw Writer' }],
      }),
    );
    const listTrackedChanges = vi.fn(() =>
      Promise.resolve({
        items: [
          {
            id: 'tc-1',
            type: 'structural',
            subtype: 'cell-merge',
            targetKind: 'cell',
            semanticColorKey: 'cell-merge',
            semanticColor: '#d4a72c',
            author: 'Ada',
            authorColor: '#8250df',
          },
        ],
        authors: [{ name: 'Ada', color: '#8250df' }],
      }),
    );
    const { superdoc } = makeAsyncSuperdoc({
      trackChanges: rawTrackChangesList,
      v2TrackedChanges: { listTrackedChanges },
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();

    expect(listTrackedChanges).toHaveBeenCalled();
    expect(
      rawTrackChangesList.mock.calls.every(([input]) => (input as { in?: string } | undefined)?.in === 'all'),
    ).toBe(true);
    expect(ui.trackChanges.getSnapshot().authors).toEqual(['Ada']);
    expect(ui.trackChanges.list()).toMatchObject([
      {
        id: 'tc-1',
        authorColor: '#8250df',
        semanticColorKey: 'cell-merge',
        semanticColor: '#d4a72c',
        targetKind: 'cell',
      },
    ]);
  });

  it('shares and supersedes only its internal paged tracked-change catalog read before a review mutation', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    const rawTrackChangesList = vi.fn(() => Promise.resolve({ items: [] }));
    let capturedSignal: AbortSignal | null = null;
    const listTrackedChanges = vi.fn((options?: { signal?: AbortSignal }) => {
      capturedSignal = options?.signal ?? null;
      return new Promise((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            resolve({ ok: false, reason: 'review-hydration-superseded', items: [] });
          },
          { once: true },
        );
      });
    });
    const { superdoc } = makeAsyncSuperdoc({
      trackChanges: rawTrackChangesList,
      v2TrackedChanges: { listTrackedChanges },
      hostEvents,
    });
    const ui = createSuperDocUI({ superdoc });
    const independentUi = createSuperDocUI({ superdoc });

    // The body slice, passive all-story lookup, and an independent controller
    // over the same host share one bridge transport; none launches the raw,
    // unpaged Document API fallback.
    await flush();
    expect(listTrackedChanges).toHaveBeenCalledTimes(1);
    expect(rawTrackChangesList).not.toHaveBeenCalled();
    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    // One controller does not own the shared request and cannot abort it while
    // another controller over the same host is still alive.
    independentUi.destroy();
    expect(capturedSignal!.aborted).toBe(false);

    hostEvents[0]?.({
      type: 'review-mutation:started',
      reviewMutation: {
        token: 'review-mutation:1:1',
        operation: 'trackChanges.decide',
        decision: 'accept',
        targetKind: 'all',
      },
    });

    expect(capturedSignal!.aborted).toBe(true);
    await flush();
    expect(listTrackedChanges).toHaveBeenCalledTimes(1);
    expect(rawTrackChangesList).not.toHaveBeenCalled();
    ui.destroy();
  });

  it('keeps explicit directory demand available while a committed window read is active', async () => {
    const listTrackedChanges = vi.fn(() => Promise.resolve({ ok: true, items: [] }));
    const rawTrackChangesList = vi.fn(() => Promise.resolve({ items: [] }));
    const { superdoc } = makeAsyncSuperdoc({
      trackChanges: rawTrackChangesList,
      v2TrackedChanges: { listTrackedChanges },
    });
    Object.assign(superdoc.activeEditor, {
      editorVersion: 2,
      reviewWindow: {
        getDiagnostics: () => ({ inFlight: true }),
        getSnapshot: () => ({
          status: 'pending',
          commentItems: [],
          trackedChangeItems: [{ id: 'tc-visible', type: 'insert' }],
        }),
        subscribe: () => () => undefined,
      },
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(listTrackedChanges).not.toHaveBeenCalled();
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-visible']);
    await flush();
    expect(listTrackedChanges).toHaveBeenCalledTimes(1);
    expect(rawTrackChangesList).not.toHaveBeenCalled();
    ui.destroy();
  });

  it('exposes non-body v2 facade rows in the public custom-UI inventory (SD-3722)', async () => {
    const listTrackedChanges = vi.fn(() =>
      Promise.resolve({
        items: [
          {
            id: 'tc-body',
            type: 'insert',
            trackedChangeStory: { kind: 'story', storyType: 'body' },
          },
          {
            id: 'tc-header',
            type: 'insert',
            trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId8' },
          },
        ],
      }),
    );
    const { superdoc } = makeAsyncSuperdoc({ v2TrackedChanges: { listTrackedChanges } });
    const ui = createSuperDocUI({ superdoc });

    await flush();

    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-body', 'tc-header']);
    expect(ui.trackChanges.getSnapshot().total).toBe(2);
  });

  it('prunes decided tracked-change rows without a delayed full-catalog reconcile', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    const story = { storyType: 'headerFooterPart', refId: 'rId-header' };
    const initialList = {
      items: [
        { id: 'tc-1', type: 'insert', author: 'Ada', storyLocator: story },
        { id: 'tc-2', type: 'delete', author: 'Grace', storyLocator: story },
      ],
    };
    const listTrackedChanges = vi.fn(() => Promise.resolve(initialList));
    const rawTrackChangesList = vi.fn(() =>
      Promise.resolve({
        items: [
          { id: 'tc-1', type: 'insert', storyLocator: story },
          { id: 'tc-2', type: 'delete', storyLocator: story },
        ],
      }),
    );
    const { superdoc } = makeAsyncSuperdoc({
      trackChanges: rawTrackChangesList,
      v2TrackedChanges: { listTrackedChanges },
      hostEvents,
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-1', 'tc-2']);
    expect(ui.trackChanges.setActive({ id: 'tc-1', story })).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-1');
    const callsBeforeDecision = listTrackedChanges.mock.calls.length;
    vi.useFakeTimers();

    hostEvents[0]?.({
      type: 'mutation:committed',
      receipt: {
        success: true,
        removed: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'tc-1' }],
      },
    });

    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision);
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-2']);
    expect(ui.trackChanges.getSnapshot().total).toBe(1);
    expect(ui.trackChanges.getSnapshot().activeId).toBeNull();
    expect(ui.trackChanges.setActive({ id: 'tc-1', story })).toBe(false);
    expect(ui.trackChanges.setActive({ id: 'tc-2', story })).toBe(true);
    expect(ui.trackChanges.getSnapshot().activeId).toBe('tc-2');

    await vi.advanceTimersByTimeAsync(3000);
    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision);

    await Promise.resolve();
    await Promise.resolve();

    expect(ui.trackChanges.getSnapshot().status).toBe('ready');
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-2']);
    vi.useRealTimers();
  });

  it('keeps an exact Reject All catalog empty through async command settlement', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    const initialList = {
      items: [
        { id: 'tc-1', type: 'insert', author: 'Ada' },
        { id: 'tc-2', type: 'delete', author: 'Grace' },
      ],
    };
    const listTrackedChanges = vi.fn(() => Promise.resolve(initialList));
    const emitHostEvent = (event: Record<string, unknown>) => {
      for (const listener of [...hostEvents]) listener(event);
    };
    const allResolvedEvent = {
      type: 'mutation:committed',
      origin: 'command',
      reviewMutation: { token: 'review-mutation:reject-all' },
      receipt: { success: true, txId: 'tx-reject-all' },
      trackedChangeAllResolved: {
        schemaVersion: 1,
        targetKind: 'all',
        decision: 'reject',
        catalogRevision: 'catalog-7',
        sourceCoverageRevision: 'coverage-7',
        logicalTargetCount: 2,
        physicalCarrierCount: 2,
        remainingLogicalCount: 0,
        txId: 'tx-reject-all',
        documentEpoch: 'document-1',
        commitSequence: 8,
        packagePreviousRevision: 'package-7',
        packageNextRevision: 'package-8',
      },
    };
    const decide = vi.fn(() => {
      emitHostEvent({
        type: 'review-mutation:started',
        reviewMutation: { token: 'review-mutation:reject-all' },
      });
      emitHostEvent(allResolvedEvent);
      return Promise.resolve(allResolvedEvent.receipt);
    });
    const { superdoc } = makeAsyncSuperdoc({
      v2TrackedChanges: { listTrackedChanges },
      hostEvents,
      trackChangesDecide: decide,
      hostCapabilities: () => ({
        editableSubset: {
          commands: [{ command: 'trackedChanges.rejectAll', status: 'supported' }],
        },
      }),
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-1', 'tc-2']);
    const callsBeforeDecision = listTrackedChanges.mock.calls.length;
    vi.useFakeTimers();

    await expect(ui.commands.executeAsync(BUILT_IN_COMMAND_IDS.rejectAllChanges)).resolves.toMatchObject({
      success: true,
      txId: 'tx-reject-all',
    });
    expect(decide).toHaveBeenCalledWith({ decision: 'reject', target: { kind: 'all' } });

    expect(ui.trackChanges.list()).toEqual([]);
    expect(ui.trackChanges.getSnapshot()).toMatchObject({ total: 0, activeId: null, authors: [] });
    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision);

    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.trackChanges.list()).toEqual([]);
    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision);

    hostEvents[0]?.({
      type: 'mutation:committed',
      origin: 'command',
      receipt: {
        success: true,
        updated: [{ kind: 'entity', entityType: 'comment', entityId: 'comment-1' }],
      },
    });
    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision + 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-1', 'tc-2']);

    ui.destroy();
    vi.useRealTimers();
  });

  it('uses committed review windows for typing, history, and scrolling without passive directory reads', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    const commentsList = vi.fn(() => Promise.resolve({ items: [{ id: 'comment-global' }] }));
    const listTrackedChanges = vi.fn(() => Promise.resolve({ items: [{ id: 'tc-global', type: 'insert' }] }));
    const getTrackedChange = vi.fn(() => Promise.resolve({ ok: true, items: [] }));
    const { superdoc } = makeAsyncSuperdoc({
      comments: commentsList,
      v2TrackedChanges: { listTrackedChanges, getTrackedChange },
      hostEvents,
    });
    let snapshot = {
      status: 'ready',
      routeId: 'window-1',
      commentItems: [{ id: 'comment-visible', text: 'visible' }],
      trackedChangeItems: [{ id: 'tc-visible', type: 'insert' }],
    };
    const windowListeners = new Set<() => void>();
    Object.assign(superdoc.activeEditor, {
      editorVersion: 2,
      reviewWindow: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          windowListeners.add(listener);
          return () => windowListeners.delete(listener);
        },
      },
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-visible']);
    expect(commentsList).not.toHaveBeenCalled();
    expect(listTrackedChanges).not.toHaveBeenCalled();
    expect(getTrackedChange).not.toHaveBeenCalled();

    hostEvents[0]?.({
      type: 'mutation:committed',
      origin: 'command',
      editableCommandKind: 'insert-text',
      receipt: {
        success: true,
        updated: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'tc-visible' }],
      },
    });
    hostEvents[0]?.({
      type: 'mutation:committed',
      origin: 'history',
      direction: 'undo',
      result: {
        updated: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'tc-restored' }],
      },
    });
    await flush();

    expect(commentsList).not.toHaveBeenCalled();
    expect(listTrackedChanges).not.toHaveBeenCalled();
    expect(getTrackedChange).not.toHaveBeenCalled();

    snapshot = {
      status: 'ready',
      routeId: 'window-2',
      commentItems: [{ id: 'comment-deep', text: 'deep' }],
      trackedChangeItems: [{ id: 'tc-restored', type: 'delete' }],
    };
    for (const listener of windowListeners) listener();

    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['comment-deep']);
    expect(ui.trackChanges.getSnapshot().items.map((item) => item.id)).toEqual(['tc-restored']);
    expect(commentsList).not.toHaveBeenCalled();
    expect(listTrackedChanges).not.toHaveBeenCalled();
    expect(getTrackedChange).not.toHaveBeenCalled();
    ui.destroy();
  });

  it('recognizes invalidated tracked-change refs as post-decision prune signals', async () => {
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    let releaseCanonicalPaint: () => void = () => undefined;
    const canonicalPaint = new Promise<void>((resolve) => {
      releaseCanonicalPaint = resolve;
    });
    const whenPainted = vi.fn(() => canonicalPaint);
    const initialList = {
      items: [
        { id: 'tc-1', type: 'insert' },
        { id: 'tc-2', type: 'delete' },
      ],
    };
    const listTrackedChanges = vi.fn(() => Promise.resolve(initialList));
    const { superdoc } = makeAsyncSuperdoc({
      v2TrackedChanges: { listTrackedChanges },
      hostEvents,
    });
    (superdoc.activeEditor as Record<string, unknown>).documentMutationReadiness = { whenPainted };
    const ui = createSuperDocUI({ superdoc });

    await flush();
    const observed: string[][] = [];
    const stopObserving = ui.trackChanges.observe((snapshot) => {
      observed.push(snapshot.items.map((item) => item.id));
    });
    const observationsBeforeDecision = observed.length;
    const callsBeforeDecision = listTrackedChanges.mock.calls.length;
    vi.useFakeTimers();
    hostEvents[0]?.({
      type: 'mutation:committed',
      receipt: {
        success: true,
        txId: 'tx-post-decision-prune',
        invalidatedRefs: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'tc-2' }],
      },
    });

    expect(ui.trackChanges.list().map((item) => item.id)).toEqual(['tc-1']);
    expect(whenPainted).toHaveBeenCalledWith(expect.objectContaining({ txId: 'tx-post-decision-prune' }));
    expect(observed).toHaveLength(observationsBeforeDecision);
    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision);
    releaseCanonicalPaint();
    await vi.advanceTimersByTimeAsync(250);
    expect(observed.at(-1)).toEqual(['tc-1']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(listTrackedChanges).toHaveBeenCalledTimes(callsBeforeDecision);
    stopObserving();
    ui.destroy();
    vi.useRealTimers();
  });

  it('recovers selection-derived command state after the async selection read settles', async () => {
    const bold = vi.fn(() => Promise.resolve({ success: true }));
    const { superdoc } = makeAsyncSuperdoc({ format: { bold } });
    const ui = createSuperDocUI({ superdoc });

    // Pending selection → inline-format command fails closed (no range yet).
    expect(ui.commands.get('bold').getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.rangeSelectionRequired,
    });

    await flush();

    // Settled range selection → command is enabled against the live target.
    expect(ui.commands.get('bold').getState()).toMatchObject({ enabled: true, supported: true });
  });

  it('executeAsync refreshes pending async selection before routing selection-dependent commands', async () => {
    let resolveSelection: (value: unknown) => void = () => undefined;
    const selection = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSelection = resolve;
        }),
    );
    const receipt = { success: true, txId: 'tx-fresh-selection' };
    const bold = vi.fn(() => Promise.resolve(receipt));
    const { superdoc } = makeAsyncSuperdoc({ selection, format: { bold } });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('bold').getState()).toMatchObject({
      enabled: false,
      reason: SUPERDOC_UI_REASONS.rangeSelectionRequired,
    });

    const pending = ui.commands.executeAsync('bold');
    await Promise.resolve();
    expect(bold).not.toHaveBeenCalled();

    resolveSelection(RANGE_SELECTION);

    await expect(pending).resolves.toBe(receipt);
    expect(selection).toHaveBeenCalledWith({ includeText: true });
    expect(bold).toHaveBeenCalledWith({ target: SELECTION_TARGET, value: true }, { offsetSpace: 'selection' });
    expect(ui.commands.get('bold').getState()).toMatchObject({ enabled: true, supported: true });
  });

  it('settles the async styles catalogue and active paragraph style', async () => {
    const catalog = {
      version: 'style-catalog/v1',
      revision: 'rev-async',
      view: 'all',
      defaults: { paragraphStyleId: 'Normal', characterStyleId: null, tableStyleId: null },
      items: [],
      styles: [{ id: 'Heading1', name: 'Heading 1', visibility: { quickGallery: true } }],
      sourceStatus: null,
      diagnostics: [],
    };
    const { superdoc } = makeAsyncSuperdoc({
      styles: { getCatalog: () => Promise.resolve(catalog) },
      getNodeById: () => Promise.resolve({ node: { kind: 'paragraph', paragraph: { styleRef: 'Heading1' } } }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.styles.getSnapshot().status).toBe('pending');
    expect(ui.styles.getSnapshot().catalogRevision).toBeNull();

    await flush();

    const snap = ui.styles.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.catalogRevision).toBe('rev-async');
    expect(snap.activeParagraphStyleId).toBe('Heading1');
  });

  it('settles async query projection into inline-format command values', async () => {
    const match = vi.fn(() =>
      Promise.resolve({
        items: [
          {
            address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
            blocks: [
              {
                blockId: 'P1',
                range: { start: 0, end: 5 },
                runs: [{ range: { start: 0, end: 5 }, styles: { fontFamily: 'Courier New' } }],
              },
            ],
          },
        ],
      }),
    );
    const { superdoc } = makeAsyncSuperdoc({
      query: match,
      format: { fontFamily: () => Promise.resolve({ success: true }) },
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('font-family').getState().value).toBeUndefined();
    await flush();
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');
  });

  it('holds the last settled inline value while a refresh of the SAME selection is pending, then adopts the settled result (SD-3706)', async () => {
    // First read settles uniform Courier New. A mutation invalidates the query
    // read; while the refresh of the same selection is in flight the producer
    // serves the held settled value (no blank flicker mid-edit). The refresh
    // then settles MIXED - the hold never masks a settled mixed state.
    const hostEvents: Array<(event: Record<string, unknown>) => void> = [];
    let resolveSecond: ((value: unknown) => void) | null = null;
    let call = 0;
    const match = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          items: [
            {
              address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
              blocks: [
                {
                  blockId: 'P1',
                  range: { start: 0, end: 5 },
                  runs: [{ range: { start: 0, end: 5 }, styles: { fontFamily: 'Courier New' } }],
                },
              ],
            },
          ],
        });
      }
      return new Promise((resolve) => {
        resolveSecond = resolve;
      });
    });
    const { superdoc } = makeAsyncSuperdoc({
      query: match,
      format: { fontFamily: () => Promise.resolve({ success: true }) },
      hostEvents,
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');

    // A mutation invalidates the read; the SAME selection's refresh is pending.
    hostEvents[0]?.({ type: 'mutation:committed' });
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');

    // The refresh settles mixed: blank immediately, never the held value.
    resolveSecond?.({
      items: [
        {
          address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
          blocks: [
            {
              blockId: 'P1',
              range: { start: 0, end: 5 },
              runs: [
                { range: { start: 0, end: 2 }, styles: { fontFamily: 'Courier New' } },
                { range: { start: 2, end: 5 }, styles: { fontFamily: 'Arial' } },
              ],
            },
          ],
        },
      ],
    });
    await flush();
    expect(ui.commands.get('font-family').getState().value).toBeUndefined();
  });

  it('does not carry a held inline value into a different editor with the same selection coordinates', async () => {
    const first = makeAsyncSuperdoc({
      query: () =>
        Promise.resolve({
          items: [
            {
              address: { kind: 'block', nodeType: 'paragraph', nodeId: 'P1' },
              blocks: [
                {
                  blockId: 'P1',
                  range: { start: 0, end: 5 },
                  runs: [{ range: { start: 0, end: 5 }, styles: { fontFamily: 'Courier New' } }],
                },
              ],
            },
          ],
        }),
      format: { fontFamily: () => Promise.resolve({ success: true }) },
    });
    const ui = createSuperDocUI({ superdoc: first.superdoc });
    await flush();
    expect(ui.commands.get('font-family').getState().value).toBe('Courier New');

    const second = makeAsyncSuperdoc({
      selection: () => Promise.resolve(RANGE_SELECTION),
      query: () => new Promise(() => undefined),
      format: { fontFamily: () => Promise.resolve({ success: true }) },
    });
    first.superdoc.activeEditor = second.superdoc.activeEditor;
    first.notifySelection();
    await flush();

    expect(ui.commands.get('font-family').getState().value).toBeUndefined();
  });

  it('settles async hyperlink and list reads into command active state', async () => {
    const { superdoc } = makeAsyncSuperdoc({
      hyperlinks: () =>
        Promise.resolve({
          items: [
            {
              address: { anchor: { start: { blockId: 'P1', offset: 0 }, end: { blockId: 'P1', offset: 5 } } },
              properties: { href: 'https://example.com' },
            },
          ],
        }),
      lists: () => Promise.resolve({ success: true, isListItem: true, seed: 'bullet' }),
    });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.commands.get('link').getState().active).toBe(false);
    await flush();
    expect(ui.commands.get('link').getState()).toMatchObject({ active: true, value: 'https://example.com' });
    expect(ui.commands.get('bullet-list').getState().active).toBe(true);
  });

  it('discards a stale selection read superseded by a newer selection', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const current = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { superdoc, notifySelection } = makeAsyncSuperdoc({ selection: current });
    const ui = createSuperDocUI({ superdoc });

    // First read is in flight (token s0). A selection event supersedes it (s1),
    // issuing a second read.
    notifySelection();
    await Promise.resolve();
    expect(current.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Resolve the SECOND (current) read first, then the stale FIRST read.
    resolvers[1]?.({ ...RANGE_SELECTION, text: 'NEW' });
    resolvers[0]?.({ ...RANGE_SELECTION, text: 'OLD' });
    await flush();

    // The stale resolution must not overwrite the newer one.
    expect(ui.selection.getSnapshot().quotedText).toBe('NEW');
  });

  it('reports stale (best-known) data while a refresh runs after a mutation', async () => {
    let revision = 1;
    const hostEvents: Array<(event: { type: string }) => void> = [];
    const list = vi.fn(() =>
      Promise.resolve({ items: revision === 1 ? [{ id: 'c-1' }] : [{ id: 'c-1' }, { id: 'c-2' }] }),
    );
    const { superdoc } = makeAsyncSuperdoc({ comments: list });
    const existingHost = (superdoc.activeEditor as Record<string, unknown>).host as Record<string, unknown>;
    (superdoc.activeEditor as Record<string, unknown>).host = {
      ...existingHost,
      events: {
        subscribe: (listener: (event: { type: string }) => void) => {
          hostEvents.push(listener);
          return () => undefined;
        },
      },
    };
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(ui.comments.getSnapshot().status).toBe('ready');
    expect(ui.comments.getSnapshot().total).toBe(1);
    expect(ui.comments.setActive('c-1')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');

    // A mutation invalidates the read; the slice synchronously shows
    // stale-but-best-known data (still 1 item) while the refresh is in flight.
    revision = 2;
    hostEvents[0]?.({ type: 'mutation:committed' });
    expect(ui.comments.getSnapshot().status).toBe('stale');
    expect(ui.comments.getSnapshot().total).toBe(1);
    expect(ui.comments.setActive('c-1')).toBe(false);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');

    await flush();
    expect(ui.comments.getSnapshot().status).toBe('ready');
    expect(ui.comments.getSnapshot().total).toBe(2);
    expect(ui.comments.setActive('c-2')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-2');
  });

  it('keeps comment and track-change slice status aligned with pending/stale selection-derived active ids', async () => {
    const selectionResolvers: Array<(value: unknown) => void> = [];
    const selection = vi.fn(
      () =>
        new Promise((resolve) => {
          selectionResolvers.push(resolve);
        }),
    );
    const { superdoc, notifySelection } = makeAsyncSuperdoc({ selection });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    expect(ui.comments.getSnapshot()).toMatchObject({ status: 'pending', total: 1, activeIds: [] });
    expect(ui.trackChanges.getSnapshot()).toMatchObject({ status: 'pending', total: 1, activeId: null });

    selectionResolvers[0]?.(RANGE_SELECTION);
    await flush();
    expect(ui.comments.getSnapshot()).toMatchObject({ status: 'ready', activeId: 'c-1' });
    expect(ui.trackChanges.getSnapshot()).toMatchObject({ status: 'ready', activeId: 'tc-1' });

    notifySelection();
    await Promise.resolve();
    expect(selectionResolvers.length).toBeGreaterThanOrEqual(2);
    expect(ui.selection.getSnapshot().status).toBe('stale');
    expect(ui.comments.getSnapshot().status).toBe('stale');
    expect(ui.trackChanges.getSnapshot().status).toBe('stale');

    selectionResolvers[selectionResolvers.length - 1]?.({
      ...RANGE_SELECTION,
      activeCommentIds: [],
      activeChangeIds: [],
    });
    for (let index = 0; index < 6 && ui.selection.getSnapshot().status !== 'ready'; index += 1) {
      await flush();
    }
    expect(ui.comments.getSnapshot()).toMatchObject({ status: 'ready', activeId: null, activeIds: [] });
    expect(ui.trackChanges.getSnapshot()).toMatchObject({ status: 'ready', activeId: null });
  });

  it('setActive succeeds on an already-loaded comment while only the selection read is stale', async () => {
    const selectionResolvers: Array<(value: unknown) => void> = [];
    const selection = vi.fn(
      () =>
        new Promise((resolve) => {
          selectionResolvers.push(resolve);
        }),
    );
    const { superdoc, notifySelection } = makeAsyncSuperdoc({ selection });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    selectionResolvers[0]?.(RANGE_SELECTION);
    await flush();
    expect(ui.comments.getSnapshot()).toMatchObject({ status: 'ready', listStatus: 'ready' });

    // A selection re-read (unrelated to the comment list) holds the combined
    // `status` at `stale`, but the comment list itself never re-fetched.
    notifySelection();
    await Promise.resolve();
    expect(ui.comments.getSnapshot().status).toBe('stale');
    expect(ui.comments.getSnapshot().listStatus).toBe('ready');

    // setActive must gate on listStatus, not the selection-combined status,
    // so an already-loaded comment can still be activated here.
    expect(ui.comments.setActive('c-1')).toBe(true);
    expect(ui.comments.getSnapshot().activeId).toBe('c-1');
  });

  it('prunes selection-scoped async cache entries on selection changes', async () => {
    const NativeMap = globalThis.Map;
    const instances: Array<Map<unknown, unknown>> = [];
    class TrackingMap<K, V> extends Map<K, V> {
      constructor(entries?: Iterable<readonly [K, V]> | null) {
        super(entries);
        instances.push(this as unknown as Map<unknown, unknown>);
      }
    }
    globalThis.Map = TrackingMap as unknown as MapConstructor;
    try {
      const SECOND_SELECTION = {
        ...RANGE_SELECTION,
        target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 6, end: 11 } }] },
        selectionTarget: {
          kind: 'selection',
          start: { kind: 'text', blockId: 'P1', offset: 6 },
          end: { kind: 'text', blockId: 'P1', offset: 11 },
        },
        text: 'world',
      };
      let currentSelection = RANGE_SELECTION;
      const { superdoc, notifySelection } = makeAsyncSuperdoc({
        selection: () => Promise.resolve(currentSelection),
        query: () => Promise.resolve({ items: [] }),
        format: {
          bold: () => Promise.resolve({ success: true }),
          readEffectiveInlineUniformity: () =>
            Promise.resolve({
              success: true,
              values: {
                fontFamily: { state: 'uniform', value: 'Cambria' },
                fontSize: { state: 'uniform', value: '14' },
              },
            }),
        },
        contentControls: {
          list: () => Promise.resolve({ items: [{ id: 'cc-1' }] }),
          listInRange: () => Promise.resolve({ items: [{ id: 'cc-1' }] }),
        },
      });
      const ui = createSuperDocUI({ superdoc });
      await flush();
      expect(ui.selection.getSnapshot().status).toBe('ready');

      const asyncReadMap = instances.find((instance) => {
        const keys = [...instance.keys()].filter((key): key is string => typeof key === 'string');
        return keys.includes('selection') && keys.includes('comments') && keys.includes('trackChanges');
      });
      expect(asyncReadMap).toBeDefined();

      const selectionScopedKeys = (): string[] =>
        [...(asyncReadMap?.keys() ?? [])].filter(
          (key): key is string =>
            typeof key === 'string' &&
            (key.startsWith('query:') || key.startsWith('contentControls:inRange:') || key.startsWith('effInline:')),
        );

      expect(selectionScopedKeys()).toHaveLength(3);
      const firstSelectionKeys = selectionScopedKeys();

      currentSelection = SECOND_SELECTION;
      notifySelection();
      await flush();
      // Large effective-inline reads debounce across distinct selections. Once
      // the stable key starts, all three caches belong only to the new target.
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      await flush();

      expect(selectionScopedKeys()).toHaveLength(3);
      expect(selectionScopedKeys().some((key) => firstSelectionKeys.includes(key))).toBe(false);
    } finally {
      globalThis.Map = NativeMap;
    }
  });

  it('keeps effective-inline uniformity cached when source coverage expands the same selection target', async () => {
    const wholeStoryTarget = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'P1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'P65', offset: 1 },
    };
    const firstSelection = {
      ...RANGE_SELECTION,
      target: { kind: 'text', segments: [{ blockId: 'P1', range: { start: 0, end: 1 } }] },
      selectionTarget: wholeStoryTarget,
      text: 'a',
    };
    const expandedSelection = {
      ...firstSelection,
      target: {
        kind: 'text',
        segments: [
          { blockId: 'P1', range: { start: 0, end: 1 } },
          { blockId: 'P2', range: { start: 0, end: 1 } },
        ],
      },
    };
    let currentSelection = firstSelection;
    const readEffectiveInlineUniformity = vi.fn(() =>
      Promise.resolve({
        success: true,
        values: {
          fontFamily: { state: 'uniform', value: 'Cambria' },
          fontSize: { state: 'uniform', value: '14' },
        },
      }),
    );
    const { superdoc, notifySelection } = makeAsyncSuperdoc({
      selection: () => Promise.resolve(currentSelection),
      format: { readEffectiveInlineUniformity },
    });
    const ui = createSuperDocUI({ superdoc });

    await flush();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await flush();
    expect(readEffectiveInlineUniformity).toHaveBeenCalledTimes(1);

    currentSelection = expandedSelection;
    notifySelection();
    await flush();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await flush();

    expect(readEffectiveInlineUniformity).toHaveBeenCalledTimes(1);
  });

  it('continues to expose compatibility helpers backed by the best-known controller state', async () => {
    const catalog = {
      version: 'style-catalog/v1',
      revision: 'rev-compat',
      view: 'all',
      defaults: { paragraphStyleId: 'Normal', characterStyleId: null, tableStyleId: null },
      items: [],
      styles: [{ id: 'Heading1', name: 'Heading 1', visibility: { quickGallery: true } }],
      sourceStatus: null,
      diagnostics: [],
    };
    const { superdoc } = makeAsyncSuperdoc({
      styles: { getCatalog: () => Promise.resolve(catalog) },
      getNodeById: () => Promise.resolve({ node: { kind: 'paragraph', paragraph: { styleRef: 'Heading1' } } }),
    });
    (superdoc.activeEditor.doc as Record<string, unknown>).getText = () => ({ text: 'compat text' });
    const ui = createSuperDocUI({ superdoc });

    expect(ui.selection.current()).toBeNull();
    await flush();

    expect(ui.selection.current()).toMatchObject(RANGE_SELECTION);
    expect(ui.comments.list()).toEqual([{ id: 'c-1', text: 'hi' }]);
    expect(ui.comments.getById('c-1')).toMatchObject({ id: 'c-1', text: 'hi' });
    expect(ui.trackChanges.list()).toMatchObject([{ id: 'tc-1', type: 'insert' }]);
    expect(ui.contentControls.list()).toMatchObject([{ id: 'cc-1' }]);
    expect(ui.contentControls.getById('cc-1')).toMatchObject({ id: 'cc-1' });
    expect(ui.styles.getCatalog({ includePreview: true })?.revision).toBe('rev-compat');
    expect(ui.document.getText()).toBe('compat text');
    expect(typeof ui.commands.executeAsync).toBe('function');
    expect(typeof ui.toolbar.executeAsync).toBe('function');
    expect(typeof ui.commands.get('bold').executeAsync).toBe('function');
  });
});
