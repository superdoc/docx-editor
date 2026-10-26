import { describe, expect, it, mock } from 'bun:test';
import {
  executeListsList,
  executeListsGet,
  executeListsCreate,
  executeListsIndent,
  executeListsInsert,
  executeListsAttach,
  executeListsSeparate,
  executeListsJoin,
  executeListsMerge,
  executeListsSplit,
  executeListsSetLevel,
  executeListsSetValue,
  executeListsConvertToText,
  executeListsApplyTemplate,
  executeListsApplyPreset,
  executeListsSetType,
  executeListsRestartAt,
  executeListsGetStyle,
  executeListsApplyStyle,
  executeListsSetLevelIndents,
  executeListsSetLevelNumbering,
  executeListsSetLevelTrailingCharacter,
  executeListsSetLevelLayout,
  executeListsSetLevelAlignment,
  executeListsSetLevelRestart,
  executeListsApply,
  executeListsContinueV2,
  executeListsGetState,
  executeListsRemoveV2,
  executeListsRestartV2,
} from './lists.js';
import { LIST_PRESET_IDS, LIST_PRESET_MARKERS, LIST_CUSTOM_NUMBERING_FORMATS } from './lists.types.js';

const validTarget = { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' };

const stubAdapter = () =>
  ({
    list: mock(() => ({ items: [], total: 0 })),
    get: mock(() => ({ address: validTarget, listId: 'l1' })),
    insert: mock(() => ({ success: true })),
    indent: mock(() => ({ success: true })),
    outdent: mock(() => ({ success: true })),
    create: mock(() => ({ success: true })),
    attach: mock(() => ({ success: true })),
    detach: mock(() => ({ success: true })),
    join: mock(() => ({ success: true })),
    canJoin: mock(() => ({ canJoin: true })),
    separate: mock(() => ({ success: true })),
    merge: mock(() => ({ success: true, listId: 'l1', absorbedCount: 1, removedEmptyBlocks: 0 })),
    split: mock(() => ({ success: true, listId: 'l2', numId: 2, restartedAt: 1 })),
    setLevel: mock(() => ({ success: true })),
    setValue: mock(() => ({ success: true })),
    continuePrevious: mock(() => ({ success: true })),
    canContinuePrevious: mock(() => ({ canContinue: true })),
    setLevelRestart: mock(() => ({ success: true })),
    convertToText: mock(() => ({ success: true })),
    applyTemplate: mock(() => ({ success: true })),
    applyPreset: mock(() => ({ success: true })),
    captureTemplate: mock(() => ({ success: true })),
    setLevelNumbering: mock(() => ({ success: true })),
    setLevelBullet: mock(() => ({ success: true })),
    setLevelPictureBullet: mock(() => ({ success: true })),
    setLevelAlignment: mock(() => ({ success: true })),
    setLevelIndents: mock(() => ({ success: true })),
    setLevelTrailingCharacter: mock(() => ({ success: true })),
    setLevelMarkerFont: mock(() => ({ success: true })),
    clearLevelOverrides: mock(() => ({ success: true })),
    setType: mock(() => ({ success: true })),
    getStyle: mock(() => ({})),
    applyStyle: mock(() => ({ success: true })),
    restartAt: mock(() => ({ success: true })),
    setLevelNumberStyle: mock(() => ({ success: true })),
    setLevelText: mock(() => ({ success: true })),
    setLevelStart: mock(() => ({ success: true })),
    setLevelLayout: mock(() => ({ success: true })),
  }) as any;

describe('custom numbering contract (SD-2513)', () => {
  const customFormat = '0001, 0002, 0003, ...';

  it('forwards a supported format through the existing style and numbering operations', () => {
    for (const customFormat of LIST_CUSTOM_NUMBERING_FORMATS) {
      const adapter = stubAdapter();
      const style = { version: 1 as const, levels: [{ level: 0, numFmt: 'custom', customFormat, lvlText: '[%1]' }] };
      executeListsApplyStyle(adapter, { target: validTarget, style });
      expect(adapter.applyStyle).toHaveBeenCalledWith(
        { target: validTarget, style },
        { changeMode: 'direct', dryRun: false, expectedRevision: undefined },
      );
      const input = { target: validTarget, level: 0, numFmt: 'custom', customFormat, lvlText: '[%1]' };
      executeListsSetLevelNumbering(adapter, input);
      expect(adapter.setLevelNumbering).toHaveBeenCalledWith(input, {
        changeMode: 'direct',
        dryRun: false,
        expectedRevision: undefined,
      });
    }
  });

  it.each(['', 123])('rejects unsupported custom format %j before dispatch', (format) => {
    const adapter = stubAdapter();
    const level = { level: 0, numFmt: 'custom', customFormat: format, lvlText: '[%1]' };
    expect(() =>
      executeListsApplyStyle(adapter, { target: validTarget, style: { version: 1, levels: [level] } } as any),
    ).toThrow(/customFormat/);
    expect(() => executeListsSetLevelNumbering(adapter, { target: validTarget, ...level } as any)).toThrow(
      /customFormat/,
    );
    expect(adapter.applyStyle).not.toHaveBeenCalled();
    expect(adapter.setLevelNumbering).not.toHaveBeenCalled();
  });

  it.each(['0001', '01, 03, 05, ...', '00001, 00002, 00003, ...'])(
    'defers imported custom format %j validation to the document runtime',
    (format) => {
      const adapter = stubAdapter();
      const level = { level: 0, numFmt: 'custom', customFormat: format, lvlText: '[%1]' };
      executeListsApplyStyle(adapter, { target: validTarget, style: { version: 1, levels: [level] } });
      executeListsSetLevelNumbering(adapter, { target: validTarget, ...level });
      expect(adapter.applyStyle).toHaveBeenCalledTimes(1);
      expect(adapter.setLevelNumbering).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a custom format combined with a named number format', () => {
    const adapter = stubAdapter();
    expect(() =>
      executeListsSetLevelNumbering(adapter, {
        target: validTarget,
        level: 0,
        numFmt: 'decimal',
        customFormat,
        lvlText: '%1.',
      }),
    ).toThrow(/customFormat/);
    expect(adapter.setLevelNumbering).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Finding 3: validateListItemTarget is now strict — listItem only
// ---------------------------------------------------------------------------

describe('validateListItemTarget (strict listItem)', () => {
  it('rejects null target', () => {
    expect(() => executeListsIndent(stubAdapter(), { target: null } as any)).toThrow(/requires a target/);
  });

  it('rejects non-object target', () => {
    expect(() => executeListsIndent(stubAdapter(), { target: 'bad' } as any)).toThrow(/must be an object/);
  });

  it('rejects target with wrong kind', () => {
    expect(() =>
      executeListsIndent(stubAdapter(), { target: { kind: 'inline', nodeType: 'listItem', nodeId: 'x' } } as any),
    ).toThrow(/kind must be 'block'/);
  });

  it('rejects target with nodeType paragraph (strict listItem)', () => {
    expect(() =>
      executeListsIndent(stubAdapter(), { target: { kind: 'block', nodeType: 'paragraph', nodeId: 'x' } }),
    ).toThrow(/nodeType must be 'listItem'/);
  });

  it('rejects target with invalid nodeType', () => {
    expect(() =>
      executeListsIndent(stubAdapter(), { target: { kind: 'block', nodeType: 'table', nodeId: 'x' } } as any),
    ).toThrow(/nodeType must be 'listItem'/);
  });

  it('rejects target with empty nodeId', () => {
    expect(() =>
      executeListsIndent(stubAdapter(), { target: { kind: 'block', nodeType: 'listItem', nodeId: '' } }),
    ).toThrow(/nodeId must be a non-empty string/);
  });

  it('accepts valid listItem target', () => {
    const adapter = stubAdapter();
    executeListsIndent(adapter, { target: validTarget });
    expect(adapter.indent).toHaveBeenCalled();
  });
});

describe('v2 list capability fallbacks', () => {
  it('returns CAPABILITY_UNAVAILABLE when legacy adapters omit v2 numbering-aware hooks', () => {
    const adapter = stubAdapter();
    const target = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };

    expect(executeListsGetState(adapter, { target })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(executeListsApply(adapter, { target, seed: 'ordered' })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(executeListsContinueV2(adapter, { target })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(executeListsRestartV2(adapter, { target, startAt: 1 })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(executeListsRemoveV2(adapter, { target })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
  });
});

// ---------------------------------------------------------------------------
// lists.get — validates address as ListItemAddress
// ---------------------------------------------------------------------------

describe('executeListsGet validation', () => {
  it('rejects null input', () => {
    expect(() => executeListsGet(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('rejects missing address', () => {
    expect(() => executeListsGet(stubAdapter(), {} as any)).toThrow(/requires a address/);
  });

  it('rejects address with wrong kind', () => {
    expect(() =>
      executeListsGet(stubAdapter(), { address: { kind: 'inline', nodeType: 'listItem', nodeId: 'x' } } as any),
    ).toThrow(/kind must be 'block'/);
  });

  it('rejects address with wrong nodeType', () => {
    expect(() =>
      executeListsGet(stubAdapter(), { address: { kind: 'block', nodeType: 'paragraph', nodeId: 'x' } }),
    ).toThrow(/nodeType must be 'listItem'/);
  });

  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeListsGet(adapter, { address: validTarget });
    expect(adapter.get).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lists.insert — validates position enum
// ---------------------------------------------------------------------------

describe('executeListsInsert validation', () => {
  it('insert validates inheritFrom and forwards a valid formatting source', () => {
    const adapter = stubAdapter();
    const input = { target: validTarget, position: 'after' as const, inheritFrom: validTarget };
    executeListsInsert(adapter, input);
    expect(adapter.insert).toHaveBeenCalledWith(input, expect.objectContaining({ changeMode: 'direct' }));
    expect(() =>
      executeListsInsert(adapter, {
        ...input,
        inheritFrom: { kind: 'block', nodeType: 'paragraph', nodeId: 'x' },
      } as any),
    ).toThrow(/inheritFrom/);
  });

  it('rejects missing target', () => {
    expect(() => executeListsInsert(stubAdapter(), { position: 'after' } as any)).toThrow(/requires a target/);
  });

  it('rejects invalid position', () => {
    expect(() => executeListsInsert(stubAdapter(), { target: validTarget, position: 'middle' } as any)).toThrow(
      /position must be one of/,
    );
  });

  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeListsInsert(adapter, { target: validTarget, position: 'after' });
    expect(adapter.insert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Finding 1: lists.attach — validates target as BlockAddress|BlockRange, attachTo as ListItemAddress
// ---------------------------------------------------------------------------

describe('executeListsAttach validation', () => {
  it('accepts BlockAddress target', () => {
    const adapter = stubAdapter();
    executeListsAttach(adapter, {
      target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
      attachTo: validTarget,
    });
    expect(adapter.attach).toHaveBeenCalled();
  });

  it('accepts BlockRange target', () => {
    const adapter = stubAdapter();
    executeListsAttach(adapter, {
      target: {
        from: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
        to: { kind: 'block', nodeType: 'paragraph', nodeId: 'p3' },
      },
      attachTo: validTarget,
    } as any);
    expect(adapter.attach).toHaveBeenCalled();
  });

  it('rejects malformed target', () => {
    expect(() =>
      executeListsAttach(stubAdapter(), {
        target: { foo: 'bar' },
        attachTo: validTarget,
      } as any),
    ).toThrow(/kind must be 'block'/);
  });

  it('rejects invalid attachTo (wrong nodeType)', () => {
    expect(() =>
      executeListsAttach(stubAdapter(), {
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
        attachTo: { kind: 'block', nodeType: 'paragraph', nodeId: 'p2' },
      } as any),
    ).toThrow(/attachTo\.nodeType must be 'listItem'/);
  });

  it('rejects null attachTo', () => {
    expect(() =>
      executeListsAttach(stubAdapter(), {
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
        attachTo: null,
      } as any),
    ).toThrow(/requires a attachTo/);
  });
});

// ---------------------------------------------------------------------------
// Finding 2: operation-specific field validation
// ---------------------------------------------------------------------------

describe('executeListsJoin validates direction', () => {
  it('rejects invalid direction', () => {
    expect(() => executeListsJoin(stubAdapter(), { target: validTarget, direction: 'sideways' } as any)).toThrow(
      /direction must be one of/,
    );
  });

  it('accepts valid direction', () => {
    const adapter = stubAdapter();
    executeListsJoin(adapter, { target: validTarget, direction: 'withPrevious' });
    expect(adapter.join).toHaveBeenCalled();
  });
});

describe('executeListsMerge validates direction', () => {
  it('rejects missing target.kind', () => {
    expect(() =>
      executeListsMerge(stubAdapter(), {
        target: { nodeType: 'listItem', nodeId: 'x' },
        direction: 'withPrevious',
      } as any),
    ).toThrow(/target\.kind/);
  });

  it('rejects invalid direction', () => {
    expect(() => executeListsMerge(stubAdapter(), { target: validTarget, direction: 'sideways' } as any)).toThrow(
      /direction must be one of/,
    );
  });

  it('accepts valid withPrevious / withNext', () => {
    const adapter = stubAdapter();
    executeListsMerge(adapter, { target: validTarget, direction: 'withPrevious' });
    executeListsMerge(adapter, { target: validTarget, direction: 'withNext' });
    expect(adapter.merge).toHaveBeenCalledTimes(2);
  });

  it('forwards mutation options to the adapter', () => {
    const adapter = stubAdapter();
    executeListsMerge(adapter, { target: validTarget, direction: 'withPrevious' }, { dryRun: true });
    const [, options] = adapter.merge.mock.calls[0];
    expect(options).toMatchObject({ dryRun: true });
  });
});

describe('executeListsSplit validates restartNumbering', () => {
  it('rejects missing target.kind', () => {
    expect(() => executeListsSplit(stubAdapter(), { target: { nodeType: 'listItem', nodeId: 'x' } } as any)).toThrow(
      /target\.kind/,
    );
  });

  it('rejects non-boolean restartNumbering', () => {
    expect(() => executeListsSplit(stubAdapter(), { target: validTarget, restartNumbering: 'yes' } as any)).toThrow(
      /restartNumbering must be a boolean/,
    );
  });

  it('accepts omitted restartNumbering (defaults to restart-on at the wrapper layer)', () => {
    const adapter = stubAdapter();
    executeListsSplit(adapter, { target: validTarget });
    expect(adapter.split).toHaveBeenCalled();
  });

  it('accepts explicit restartNumbering:true and restartNumbering:false', () => {
    const adapter = stubAdapter();
    executeListsSplit(adapter, { target: validTarget, restartNumbering: true });
    executeListsSplit(adapter, { target: validTarget, restartNumbering: false });
    expect(adapter.split).toHaveBeenCalledTimes(2);
  });
});

describe('executeListsSetLevel validates level', () => {
  it('rejects string level', () => {
    expect(() => executeListsSetLevel(stubAdapter(), { target: validTarget, level: '2' } as any)).toThrow(
      /level must be a non-negative integer/,
    );
  });

  it('accepts valid level', () => {
    const adapter = stubAdapter();
    executeListsSetLevel(adapter, { target: validTarget, level: 0 });
    expect(adapter.setLevel).toHaveBeenCalled();
  });
});

describe('executeListsSetValue validates value', () => {
  it('rejects string value', () => {
    expect(() => executeListsSetValue(stubAdapter(), { target: validTarget, value: '3' } as any)).toThrow(
      /value must be an integer or null/,
    );
  });

  it('accepts null value', () => {
    const adapter = stubAdapter();
    executeListsSetValue(adapter, { target: validTarget, value: null });
    expect(adapter.setValue).toHaveBeenCalled();
  });
});

describe('executeListsApplyPreset validates preset', () => {
  it('rejects invalid preset', () => {
    expect(() => executeListsApplyPreset(stubAdapter(), { target: validTarget, preset: 'bogus' } as any)).toThrow(
      /preset must be one of/,
    );
  });

  it('accepts valid preset', () => {
    const adapter = stubAdapter();
    executeListsApplyPreset(adapter, { target: validTarget, preset: 'decimal' });
    expect(adapter.applyPreset).toHaveBeenCalled();
  });
});

describe('executeListsSetType validates kind and continuity', () => {
  it('rejects invalid kind', () => {
    expect(() => executeListsSetType(stubAdapter(), { target: validTarget, kind: 'bogus' } as any)).toThrow(
      /kind must be one of/,
    );
  });

  it('rejects invalid continuity', () => {
    expect(() =>
      executeListsSetType(stubAdapter(), { target: validTarget, kind: 'ordered', continuity: 'merge' } as any),
    ).toThrow(/continuity must be one of/);
  });

  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeListsSetType(adapter, { target: validTarget, kind: 'bullet' });
    expect(adapter.setType).toHaveBeenCalled();
  });
});

describe('executeListsRestartAt validates startAt', () => {
  it('rejects string startAt', () => {
    expect(() => executeListsRestartAt(stubAdapter(), { target: validTarget, startAt: '3' } as any)).toThrow(
      /startAt must be an integer/,
    );
  });

  it('accepts valid startAt', () => {
    const adapter = stubAdapter();
    executeListsRestartAt(adapter, { target: validTarget, startAt: 5 });
    expect(adapter.restartAt).toHaveBeenCalled();
  });
});

describe('executeListsSetLevelTrailingCharacter validates enum', () => {
  it('rejects invalid trailingCharacter', () => {
    expect(() =>
      executeListsSetLevelTrailingCharacter(stubAdapter(), {
        target: validTarget,
        level: 0,
        trailingCharacter: 'dots',
      } as any),
    ).toThrow(/trailingCharacter must be one of/);
  });

  it('accepts valid trailingCharacter', () => {
    const adapter = stubAdapter();
    executeListsSetLevelTrailingCharacter(adapter, {
      target: validTarget,
      level: 0,
      trailingCharacter: 'tab',
    });
    expect(adapter.setLevelTrailingCharacter).toHaveBeenCalled();
  });
});

describe('executeListsSetLevelAlignment validates enum', () => {
  it('rejects invalid alignment', () => {
    expect(() =>
      executeListsSetLevelAlignment(stubAdapter(), {
        target: validTarget,
        level: 0,
        alignment: 'justify',
      } as any),
    ).toThrow(/alignment must be one of/);
  });
});

describe('executeListsSetLevelLayout validates layout shape', () => {
  it('rejects non-object layout', () => {
    expect(() =>
      executeListsSetLevelLayout(stubAdapter(), { target: validTarget, level: 0, layout: 42 } as any),
    ).toThrow(/layout must be an object/);
  });

  it('rejects invalid layout.alignment', () => {
    expect(() =>
      executeListsSetLevelLayout(stubAdapter(), {
        target: validTarget,
        level: 0,
        layout: { alignment: 'justify' },
      } as any),
    ).toThrow(/layout\.alignment must be one of/);
  });

  it('rejects invalid layout.followCharacter', () => {
    expect(() =>
      executeListsSetLevelLayout(stubAdapter(), {
        target: validTarget,
        level: 0,
        layout: { followCharacter: 'dots' },
      } as any),
    ).toThrow(/layout\.followCharacter must be one of/);
  });

  it('accepts valid layout', () => {
    const adapter = stubAdapter();
    executeListsSetLevelLayout(adapter, {
      target: validTarget,
      level: 0,
      layout: { alignment: 'left', followCharacter: 'tab' },
    });
    expect(adapter.setLevelLayout).toHaveBeenCalled();
  });
});

describe('executeListsSetLevelRestart validates scope enum', () => {
  it('rejects invalid scope', () => {
    expect(() =>
      executeListsSetLevelRestart(stubAdapter(), {
        target: validTarget,
        level: 0,
        restartAfterLevel: null,
        scope: 'bogus',
      } as any),
    ).toThrow(/scope must be one of/);
  });

  it('accepts valid scope', () => {
    const adapter = stubAdapter();
    executeListsSetLevelRestart(adapter, {
      target: validTarget,
      level: 0,
      restartAfterLevel: null,
      scope: 'definition',
    });
    expect(adapter.setLevelRestart).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lists.create validation
// ---------------------------------------------------------------------------

describe('executeListsCreate validation', () => {
  it('rejects null input', () => {
    expect(() => executeListsCreate(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('rejects invalid mode', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'bogus' } as any)).toThrow(
      /must be "empty" or "fromParagraphs"/,
    );
  });

  it('rejects empty mode with malformed at', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'empty', at: { foo: 'bar' } } as any)).toThrow(
      /kind must be 'block'/,
    );
  });

  it('rejects fromParagraphs mode missing target', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'fromParagraphs' } as any)).toThrow(/requires a target/);
  });

  it('rejects fromParagraphs mode with malformed target', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'fromParagraphs', target: { foo: 'bar' } } as any)).toThrow(
      /kind must be 'block'/,
    );
  });

  it('accepts valid empty mode', () => {
    const adapter = stubAdapter();
    executeListsCreate(adapter, {
      mode: 'empty',
      at: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
    } as any);
    expect(adapter.create).toHaveBeenCalled();
  });

  it('accepts valid fromParagraphs mode with BlockRange', () => {
    const adapter = stubAdapter();
    executeListsCreate(adapter, {
      mode: 'fromParagraphs',
      target: {
        from: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
        to: { kind: 'block', nodeType: 'paragraph', nodeId: 'p3' },
      },
    } as any);
    expect(adapter.create).toHaveBeenCalled();
  });

  it('rejects empty mode with non-paragraph at nodeType', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'empty',
        at: { kind: 'block', nodeType: 'table', nodeId: 't1' },
      } as any),
    ).toThrow(/nodeType must be 'paragraph'/);
  });

  it('rejects fromParagraphs mode with non-paragraph target nodeType', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'fromParagraphs',
        target: { kind: 'block', nodeType: 'table', nodeId: 't1' },
      } as any),
    ).toThrow(/nodeType must be 'paragraph'/);
  });
});

// ---------------------------------------------------------------------------
// BlockAddress nodeType enforcement for attach
// ---------------------------------------------------------------------------

describe('lists.attach enforces BlockAddress nodeType paragraph', () => {
  it('rejects non-paragraph target nodeType', () => {
    expect(() =>
      executeListsAttach(stubAdapter(), {
        target: { kind: 'block', nodeType: 'table', nodeId: 't1' },
        attachTo: validTarget,
      } as any),
    ).toThrow(/nodeType must be 'paragraph'/);
  });
});

// ---------------------------------------------------------------------------
// Remaining non-target field validation
// ---------------------------------------------------------------------------

describe('lists.insert validates text type', () => {
  it('rejects non-string text', () => {
    expect(() =>
      executeListsInsert(stubAdapter(), { target: validTarget, position: 'after', text: 123 } as any),
    ).toThrow(/text must be a string/);
  });
});

describe('lists.separate validates copyOverrides', () => {
  it('rejects non-boolean copyOverrides', () => {
    expect(() => executeListsSeparate(stubAdapter(), { target: validTarget, copyOverrides: 'yes' } as any)).toThrow(
      /copyOverrides must be a boolean/,
    );
  });
});

describe('lists.convertToText validates includeMarker', () => {
  it('rejects non-boolean includeMarker', () => {
    expect(() =>
      executeListsConvertToText(stubAdapter(), { target: validTarget, includeMarker: 'yes' } as any),
    ).toThrow(/includeMarker must be a boolean/);
  });
});

describe('lists.getStyle validates levels array', () => {
  it('rejects non-integer items in levels', () => {
    expect(() => executeListsGetStyle(stubAdapter(), { target: validTarget, levels: ['0', 1] } as any)).toThrow(
      /levels\[0\] must be a non-negative integer/,
    );
  });
});

describe('lists.applyTemplate validates template shape deeply', () => {
  it('rejects empty object (missing version)', () => {
    expect(() => executeListsApplyTemplate(stubAdapter(), { target: validTarget, template: {} } as any)).toThrow(
      /version must be 1/,
    );
  });

  it('rejects template with missing levels', () => {
    expect(() =>
      executeListsApplyTemplate(stubAdapter(), { target: validTarget, template: { version: 1 } } as any),
    ).toThrow(/levels must be an array/);
  });

  it('rejects non-object level entry', () => {
    expect(() =>
      executeListsApplyTemplate(stubAdapter(), {
        target: validTarget,
        template: { version: 1, levels: [42] },
      } as any),
    ).toThrow(/levels\[0\] must be an object/);
  });

  it('rejects level entry with non-integer level', () => {
    expect(() =>
      executeListsApplyTemplate(stubAdapter(), {
        target: validTarget,
        template: { version: 1, levels: [{ level: '0' }] },
      } as any),
    ).toThrow(/levels\[0\]\.level must be a non-negative integer/);
  });

  it('rejects level entry with non-number tabStopAt', () => {
    expect(() =>
      executeListsApplyTemplate(stubAdapter(), {
        target: validTarget,
        template: { version: 1, levels: [{ level: 0, tabStopAt: '10' }] },
      } as any),
    ).toThrow(/tabStopAt must be a number/);
  });

  it('accepts level entry with null tabStopAt', () => {
    const adapter = stubAdapter();
    executeListsApplyTemplate(adapter, {
      target: validTarget,
      template: { version: 1, levels: [{ level: 0, tabStopAt: null }] },
    } as any);
    expect(adapter.applyTemplate).toHaveBeenCalled();
  });

  it('accepts valid template with level entries', () => {
    const adapter = stubAdapter();
    executeListsApplyTemplate(adapter, {
      target: validTarget,
      template: { version: 1, levels: [{ level: 0, numFmt: 'decimal', lvlText: '%1.' }] },
    });
    expect(adapter.applyTemplate).toHaveBeenCalled();
  });
});

describe('lists.applyStyle validates style shape deeply', () => {
  it('rejects empty object (missing version)', () => {
    expect(() => executeListsApplyStyle(stubAdapter(), { target: validTarget, style: {} } as any)).toThrow(
      /version must be 1/,
    );
  });

  it('rejects style with non-object level entry', () => {
    expect(() =>
      executeListsApplyStyle(stubAdapter(), {
        target: validTarget,
        style: { version: 1, levels: [42] },
      } as any),
    ).toThrow(/levels\[0\] must be an object/);
  });
});

describe('lists.setLevelIndents validates numeric fields', () => {
  it('rejects non-number left', () => {
    expect(() =>
      executeListsSetLevelIndents(stubAdapter(), { target: validTarget, level: 0, left: '3' } as any),
    ).toThrow(/left must be a number/);
  });
});

describe('lists.setLevelNumbering validates optional start', () => {
  it('rejects non-integer start', () => {
    expect(() =>
      executeListsSetLevelNumbering(stubAdapter(), {
        target: validTarget,
        level: 0,
        numFmt: 'decimal',
        lvlText: '%1.',
        start: '1',
      } as any),
    ).toThrow(/start must be an integer/);
  });

  it('rejects non-boolean isLgl', () => {
    expect(() =>
      executeListsSetLevelNumbering(stubAdapter(), {
        target: validTarget,
        level: 0,
        numFmt: 'decimal',
        lvlText: '%1.',
        isLgl: 'true',
      } as any),
    ).toThrow(/isLgl must be a boolean/);
  });
});

describe('lists.setLevelLayout validates numeric fields', () => {
  it('rejects non-number alignedAt', () => {
    expect(() =>
      executeListsSetLevelLayout(stubAdapter(), {
        target: validTarget,
        level: 0,
        layout: { alignedAt: '3' },
      } as any),
    ).toThrow(/layout\.alignedAt must be a number/);
  });
});

// ---------------------------------------------------------------------------
// lists.create — full union field validation
// ---------------------------------------------------------------------------

describe('lists.create validates union fields', () => {
  const validAt = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };

  it('rejects invalid kind', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'empty', at: validAt, kind: 'bogus' } as any)).toThrow(
      /kind must be one of/,
    );
  });

  it('rejects invalid level', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'empty', at: validAt, level: '2' } as any)).toThrow(
      /level must be a non-negative integer/,
    );
  });

  it('rejects invalid preset', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'empty', at: validAt, preset: 'bogus' } as any)).toThrow(
      /preset must be one of/,
    );
  });

  it('rejects invalid style (not a template)', () => {
    expect(() => executeListsCreate(stubAdapter(), { mode: 'empty', at: validAt, style: 'bad' } as any)).toThrow(
      /style must be an object/,
    );
  });

  it('rejects invalid sequence.mode', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'empty',
        at: validAt,
        sequence: { mode: 'bogus' },
      } as any),
    ).toThrow(/sequence\.mode must be one of/);
  });

  it('rejects non-integer sequence.startAt', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'empty',
        at: validAt,
        sequence: { mode: 'new', startAt: '1' },
      } as any),
    ).toThrow(/sequence\.startAt must be an integer/);
  });

  it('rejects continuePrevious with preset', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'empty',
        at: validAt,
        preset: 'decimal',
        sequence: { mode: 'continuePrevious' },
      } as any),
    ).toThrow(/preset must not be provided/);
  });

  it('rejects continuePrevious with style', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'empty',
        at: validAt,
        style: { version: 1, levels: [] },
        sequence: { mode: 'continuePrevious' },
      } as any),
    ).toThrow(/style must not be provided/);
  });

  it('rejects continuePrevious with startAt', () => {
    expect(() =>
      executeListsCreate(stubAdapter(), {
        mode: 'empty',
        at: validAt,
        sequence: { mode: 'continuePrevious', startAt: 1 },
      } as any),
    ).toThrow(/startAt must not be provided/);
  });

  it('accepts valid continuePrevious without preset/style', () => {
    const adapter = stubAdapter();
    executeListsCreate(adapter, {
      mode: 'empty',
      at: validAt,
      sequence: { mode: 'continuePrevious' },
    } as any);
    expect(adapter.create).toHaveBeenCalled();
  });

  it('accepts valid create with all optional fields', () => {
    const adapter = stubAdapter();
    executeListsCreate(adapter, {
      mode: 'empty',
      at: validAt,
      kind: 'ordered',
      level: 0,
      preset: 'decimal',
      sequence: { mode: 'new', startAt: 1 },
    } as any);
    expect(adapter.create).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lists.list — query validation
// ---------------------------------------------------------------------------

describe('lists.list validates query', () => {
  it('accepts undefined query', () => {
    const adapter = stubAdapter();
    executeListsList(adapter);
    expect(adapter.list).toHaveBeenCalled();
  });

  it('rejects non-object query', () => {
    expect(() => executeListsList(stubAdapter(), 'bad' as any)).toThrow(/must be an object/);
  });

  it('rejects invalid kind', () => {
    expect(() => executeListsList(stubAdapter(), { kind: 'bogus' } as any)).toThrow(/kind must be one of/);
  });

  it('rejects non-integer level', () => {
    expect(() => executeListsList(stubAdapter(), { level: '1' } as any)).toThrow(/level must be an integer/);
  });

  it('rejects within missing nodeType', () => {
    expect(() => executeListsList(stubAdapter(), { within: { kind: 'block', nodeId: 'x' } } as any)).toThrow(
      /within\.nodeType must be a valid BlockNodeType/,
    );
  });

  it('rejects within with non-string nodeType', () => {
    expect(() =>
      executeListsList(stubAdapter(), { within: { kind: 'block', nodeType: 123, nodeId: 'x' } } as any),
    ).toThrow(/within\.nodeType must be a valid BlockNodeType/);
  });

  it('rejects within with invalid nodeType string', () => {
    expect(() =>
      executeListsList(stubAdapter(), { within: { kind: 'block', nodeType: 'bogus', nodeId: 'x' } } as any),
    ).toThrow(/within\.nodeType must be a valid BlockNodeType/);
  });

  it('accepts valid query with within', () => {
    const adapter = stubAdapter();
    executeListsList(adapter, { within: { kind: 'block', nodeType: 'table', nodeId: 't1' } } as any);
    expect(adapter.list).toHaveBeenCalled();
  });

  it('accepts valid query', () => {
    const adapter = stubAdapter();
    executeListsList(adapter, { kind: 'ordered', level: 0 });
    expect(adapter.list).toHaveBeenCalled();
  });
});

describe('LIST_PRESET_MARKERS (canonical preset → OOXML marker map)', () => {
  it('defines a marker for every preset id, with no extras', () => {
    const markerKeys = Object.keys(LIST_PRESET_MARKERS).sort();
    expect(markerKeys).toEqual([...LIST_PRESET_IDS].sort());
  });

  it('maps ordered presets to the expected numFmt/lvlText and start=1', () => {
    expect(LIST_PRESET_MARKERS.decimal).toEqual({ numFmt: 'decimal', lvlText: '%1.', start: 1 });
    // The two paren variants share numFmt but differ from their dot variants by lvlText.
    expect(LIST_PRESET_MARKERS.decimalParenthesis).toEqual({ numFmt: 'decimal', lvlText: '%1)', start: 1 });
    expect(LIST_PRESET_MARKERS.upperLetter).toEqual({ numFmt: 'upperLetter', lvlText: '%1.', start: 1 });
    expect(LIST_PRESET_MARKERS.upperLetterParenthesis).toEqual({ numFmt: 'upperLetter', lvlText: '%1)', start: 1 });
    expect(LIST_PRESET_MARKERS.lowerLetter).toEqual({ numFmt: 'lowerLetter', lvlText: '%1.', start: 1 });
    expect(LIST_PRESET_MARKERS.lowerLetterParenthesis).toEqual({ numFmt: 'lowerLetter', lvlText: '%1)', start: 1 });
    expect(LIST_PRESET_MARKERS.upperRoman).toEqual({ numFmt: 'upperRoman', lvlText: '%1.', start: 1 });
    expect(LIST_PRESET_MARKERS.lowerRoman).toEqual({ numFmt: 'lowerRoman', lvlText: '%1.', start: 1 });
  });

  it('maps bullet presets to numFmt=bullet with a distinct glyph and no start', () => {
    expect(LIST_PRESET_MARKERS.disc).toEqual({ numFmt: 'bullet', lvlText: '•' });
    expect(LIST_PRESET_MARKERS.circle).toEqual({ numFmt: 'bullet', lvlText: 'o' });
    expect(LIST_PRESET_MARKERS.square).toEqual({ numFmt: 'bullet', lvlText: '▪' });
    expect(LIST_PRESET_MARKERS.dash).toEqual({ numFmt: 'bullet', lvlText: '-' });
    for (const bullet of ['disc', 'circle', 'square', 'dash'] as const) {
      expect(LIST_PRESET_MARKERS[bullet].start).toBeUndefined();
    }
  });
});
