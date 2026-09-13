import { describe, expect, it, mock } from 'bun:test';
import {
  executeContentControlsGet,
  executeContentControlsList,
  executeContentControlsListInRange,
  executeContentControlsSelectByTag,
  executeContentControlsSelectByTitle,
  executeContentControlsListChildren,
  executeContentControlsGetParent,
  executeContentControlsWrap,
  executeContentControlsUnwrap,
  executeContentControlsDelete,
  executeContentControlsCopy,
  executeContentControlsMove,
  executeContentControlsPatch,
  executeContentControlsSetLockMode,
  executeContentControlsSetType,
  executeContentControlsGetContent,
  executeContentControlsReplaceContent,
  executeContentControlsSetBinding,
  executeContentControlsPatchRawProperties,
  executeContentControlsTextSetMultiline,
  executeContentControlsTextSetValue,
  executeContentControlsDateSetDisplayFormat,
  executeContentControlsCheckboxSetState,
  executeContentControlsCheckboxSetSymbolPair,
  executeContentControlsChoiceListSetItems,
  executeContentControlsChoiceListSetSelected,
  executeContentControlsRepeatingSectionInsertItemBefore,
  executeContentControlsRepeatingSectionSetAllowInsertDelete,
  executeContentControlsGroupWrap,
  executeCreateContentControl,
} from './content-controls.js';

const validTarget = { kind: 'block' as const, nodeType: 'sdt' as const, nodeId: 'sdt-1' };

function noop() {
  return { success: true, contentControl: validTarget } as any;
}

const stubAdapter = () =>
  ({
    list: mock(() => ({ items: [], total: 0 })),
    get: mock(() => ({ nodeType: 'sdt', kind: 'block', id: 'sdt-1' })),
    listInRange: mock(() => ({ items: [], total: 0 })),
    selectByTag: mock(() => ({ items: [], total: 0 })),
    selectByTitle: mock(() => ({ items: [], total: 0 })),
    listChildren: mock(() => ({ items: [], total: 0 })),
    getParent: mock(() => null),
    wrap: mock(noop),
    unwrap: mock(noop),
    delete: mock(noop),
    copy: mock(noop),
    move: mock(noop),
    patch: mock(noop),
    setLockMode: mock(noop),
    setType: mock(noop),
    getContent: mock(() => ({ content: '', format: 'text' })),
    replaceContent: mock(noop),
    clearContent: mock(noop),
    appendContent: mock(noop),
    prependContent: mock(noop),
    insertBefore: mock(noop),
    insertAfter: mock(noop),
    getBinding: mock(() => null),
    setBinding: mock(noop),
    clearBinding: mock(noop),
    getRawProperties: mock(() => ({ properties: {} })),
    patchRawProperties: mock(noop),
    validateWordCompatibility: mock(() => ({ compatible: true, diagnostics: [] })),
    normalizeWordCompatibility: mock(noop),
    normalizeTagPayload: mock(noop),
    text: {
      setMultiline: mock(noop),
      setValue: mock(noop),
      clearValue: mock(noop),
    },
    date: {
      setValue: mock(noop),
      clearValue: mock(noop),
      setDisplayFormat: mock(noop),
      setDisplayLocale: mock(noop),
      setStorageFormat: mock(noop),
      setCalendar: mock(noop),
    },
    checkbox: {
      getState: mock(() => ({ checked: false })),
      setState: mock(noop),
      toggle: mock(noop),
      setSymbolPair: mock(noop),
    },
    choiceList: {
      getItems: mock(() => ({ items: [] })),
      setItems: mock(noop),
      setSelected: mock(noop),
    },
    repeatingSection: {
      listItems: mock(() => ({ items: [], total: 0 })),
      insertItemBefore: mock(noop),
      insertItemAfter: mock(noop),
      cloneItem: mock(noop),
      deleteItem: mock(noop),
      setAllowInsertDelete: mock(noop),
    },
    group: {
      wrap: mock(noop),
      ungroup: mock(noop),
    },
  }) as any;

// ---------------------------------------------------------------------------
// Input shape guard — shared across all target-bearing operations
// ---------------------------------------------------------------------------

describe('input shape guard', () => {
  it('contentControls.get rejects null', () => {
    expect(() => executeContentControlsGet(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('contentControls.get rejects undefined', () => {
    expect(() => executeContentControlsGet(stubAdapter(), undefined as any)).toThrow(/non-null object/);
  });
});

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

describe('target validation', () => {
  it('rejects missing target', () => {
    expect(() => executeContentControlsGet(stubAdapter(), {} as any)).toThrow(/requires a valid target/);
  });

  it('rejects target with wrong nodeType', () => {
    expect(() =>
      executeContentControlsGet(stubAdapter(), {
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
      } as any),
    ).toThrow(/nodeType must be 'sdt'/);
  });

  it('rejects target with wrong kind', () => {
    expect(() =>
      executeContentControlsGet(stubAdapter(), {
        target: { kind: 'wrong', nodeType: 'sdt', nodeId: 'sdt-1' },
      } as any),
    ).toThrow(/must be 'block' or 'inline'/);
  });

  it('rejects target with empty nodeId', () => {
    expect(() =>
      executeContentControlsGet(stubAdapter(), {
        target: { kind: 'block', nodeType: 'sdt', nodeId: '' },
      }),
    ).toThrow(/nodeId must be a non-empty string/);
  });

  it('rejects target with non-string nodeId', () => {
    expect(() =>
      executeContentControlsGet(stubAdapter(), {
        target: { kind: 'block', nodeType: 'sdt', nodeId: 42 },
      } as any),
    ).toThrow(/nodeId must be a non-empty string/);
  });

  it('accepts valid block target', () => {
    const adapter = stubAdapter();
    executeContentControlsGet(adapter, { target: validTarget });
    expect(adapter.get).toHaveBeenCalled();
  });

  it('accepts valid inline target', () => {
    const adapter = stubAdapter();
    executeContentControlsGet(adapter, { target: { kind: 'inline', nodeType: 'sdt', nodeId: 'sdt-2' } });
    expect(adapter.get).toHaveBeenCalled();
  });

  it('accepts a story-qualified target', () => {
    const adapter = stubAdapter();
    executeContentControlsGet(adapter, {
      target: {
        ...validTarget,
        story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' },
      },
    });
    expect(adapter.get).toHaveBeenCalled();
  });

  it('rejects a malformed target story', () => {
    expect(() =>
      executeContentControlsGet(stubAdapter(), {
        target: { ...validTarget, story: { kind: 'story', storyType: 'headerFooterPart' } },
      } as any),
    ).toThrow(/target\.story must be a valid StoryLocator/);
  });
});

// ---------------------------------------------------------------------------
// Discovery operations
// ---------------------------------------------------------------------------

describe('discovery operations', () => {
  it('list accepts undefined query', () => {
    const adapter = stubAdapter();
    executeContentControlsList(adapter);
    expect(adapter.list).toHaveBeenCalled();
  });

  it('list rejects non-object query', () => {
    expect(() => executeContentControlsList(stubAdapter(), 'bad' as any)).toThrow(/must be an object/);
  });

  it('listInRange rejects empty startBlockId', () => {
    expect(() => executeContentControlsListInRange(stubAdapter(), { startBlockId: '', endBlockId: 'b2' })).toThrow(
      /non-empty string/,
    );
  });

  it('selectByTag rejects empty tag', () => {
    expect(() => executeContentControlsSelectByTag(stubAdapter(), { tag: '' })).toThrow(/non-empty string/);
  });

  it('selectByTitle rejects empty title', () => {
    expect(() => executeContentControlsSelectByTitle(stubAdapter(), { title: '' })).toThrow(/non-empty string/);
  });
});

// ---------------------------------------------------------------------------
// Operations with extra required fields
// ---------------------------------------------------------------------------

describe('listChildren validates target', () => {
  it('rejects null input', () => {
    expect(() => executeContentControlsListChildren(stubAdapter(), null as any)).toThrow(/non-null object/);
  });
});

describe('getParent validates target', () => {
  it('rejects null input', () => {
    expect(() => executeContentControlsGetParent(stubAdapter(), null as any)).toThrow(/non-null object/);
  });
});

describe('wrap validates kind', () => {
  it('rejects invalid kind', () => {
    expect(() => executeContentControlsWrap(stubAdapter(), { kind: 'bogus' as any, target: validTarget })).toThrow(
      /'block' or 'inline'/,
    );
  });
});

describe('unwrap validates target', () => {
  it('rejects null input', () => {
    expect(() => executeContentControlsUnwrap(stubAdapter(), null as any)).toThrow(/non-null object/);
  });
});

describe('delete validates target', () => {
  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeContentControlsDelete(adapter, { target: validTarget });
    expect(adapter.delete).toHaveBeenCalled();
  });
});

describe('copy validates both target and destination', () => {
  it('rejects invalid destination', () => {
    expect(() =>
      executeContentControlsCopy(stubAdapter(), {
        target: validTarget,
        destination: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
      } as any),
    ).toThrow(/nodeType must be 'sdt'/);
  });
});

describe('move validates both target and destination', () => {
  it('rejects null destination', () => {
    expect(() => executeContentControlsMove(stubAdapter(), { target: validTarget, destination: null } as any)).toThrow(
      /requires a valid destination/,
    );
  });

  it('accepts document boundary destinations', () => {
    const adapter = stubAdapter();
    executeContentControlsMove(adapter, { target: validTarget, destination: { kind: 'documentStart' } });
    executeContentControlsMove(adapter, { target: validTarget, destination: { kind: 'documentEnd' } });
    expect(adapter.move).toHaveBeenCalledTimes(2);
  });

  it('accepts before and after destinations with valid SDT targets', () => {
    const adapter = stubAdapter();
    executeContentControlsMove(adapter, { target: validTarget, destination: { kind: 'before', target: validTarget } });
    executeContentControlsMove(adapter, { target: validTarget, destination: { kind: 'after', target: validTarget } });
    expect(adapter.move).toHaveBeenCalledTimes(2);
  });

  it('rejects before and after destinations without targets', () => {
    expect(() =>
      executeContentControlsMove(stubAdapter(), { target: validTarget, destination: { kind: 'before' } } as any),
    ).toThrow(/requires a valid target/);
    expect(() =>
      executeContentControlsMove(stubAdapter(), { target: validTarget, destination: { kind: 'after' } } as any),
    ).toThrow(/requires a valid target/);
  });

  it('still rejects invalid legacy SDT destinations', () => {
    expect(() =>
      executeContentControlsMove(stubAdapter(), {
        target: validTarget,
        destination: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
      } as any),
    ).toThrow(/nodeType must be 'sdt'/);
  });
});

describe('patch validates appearance enum', () => {
  it('rejects invalid appearance', () => {
    expect(() =>
      executeContentControlsPatch(stubAdapter(), { target: validTarget, appearance: 'glowing' as any }),
    ).toThrow(/appearance must be one of/);
  });

  it('accepts valid appearance', () => {
    const adapter = stubAdapter();
    executeContentControlsPatch(adapter, { target: validTarget, appearance: 'boundingBox' });
    expect(adapter.patch).toHaveBeenCalled();
  });

  it('accepts null appearance (clearing)', () => {
    const adapter = stubAdapter();
    executeContentControlsPatch(adapter, { target: validTarget, appearance: null });
    expect(adapter.patch).toHaveBeenCalled();
  });
});

describe('setLockMode validates enum', () => {
  it('rejects invalid lockMode', () => {
    expect(() =>
      executeContentControlsSetLockMode(stubAdapter(), { target: validTarget, lockMode: 'invalid' as any }),
    ).toThrow(/lockMode must be one of/);
  });

  it('accepts valid lockMode', () => {
    const adapter = stubAdapter();
    executeContentControlsSetLockMode(adapter, { target: validTarget, lockMode: 'contentLocked' });
    expect(adapter.setLockMode).toHaveBeenCalled();
  });
});

describe('setType validates enum', () => {
  it('rejects invalid controlType', () => {
    expect(() =>
      executeContentControlsSetType(stubAdapter(), { target: validTarget, controlType: 'invalid' as any }),
    ).toThrow(/controlType must be one of/);
  });

  it('accepts valid controlType', () => {
    const adapter = stubAdapter();
    executeContentControlsSetType(adapter, { target: validTarget, controlType: 'text' });
    expect(adapter.setType).toHaveBeenCalled();
  });
});

describe('content operations validate content string', () => {
  it('getContent validates target', () => {
    expect(() => executeContentControlsGetContent(stubAdapter(), null as any)).toThrow(/non-null object/);
  });

  it('replaceContent rejects non-string content', () => {
    expect(() =>
      executeContentControlsReplaceContent(stubAdapter(), {
        target: validTarget,
        content: 42,
      } as any),
    ).toThrow(/content must be a string/);
  });

  it('replaceContent rejects invalid format', () => {
    expect(() =>
      executeContentControlsReplaceContent(stubAdapter(), {
        target: validTarget,
        content: 'hello',
        format: 'xml' as any,
      }),
    ).toThrow(/format must be 'text' or 'html'/);
  });
});

describe('setBinding validates strings', () => {
  it('rejects empty storeItemId', () => {
    expect(() =>
      executeContentControlsSetBinding(stubAdapter(), {
        target: validTarget,
        storeItemId: '',
        xpath: '/foo',
      }),
    ).toThrow(/non-empty string/);
  });

  it('rejects empty xpath', () => {
    expect(() =>
      executeContentControlsSetBinding(stubAdapter(), {
        target: validTarget,
        storeItemId: 'store-1',
        xpath: '',
      }),
    ).toThrow(/non-empty string/);
  });
});

describe('patchRawProperties validates patches array', () => {
  it('rejects non-array patches', () => {
    expect(() =>
      executeContentControlsPatchRawProperties(stubAdapter(), {
        target: validTarget,
        patches: 'bad',
      } as any),
    ).toThrow(/patches must be an array/);
  });
});

// ---------------------------------------------------------------------------
// Typed controls
// ---------------------------------------------------------------------------

describe('text.setMultiline validates boolean', () => {
  it('rejects non-boolean', () => {
    expect(() =>
      executeContentControlsTextSetMultiline(stubAdapter(), {
        target: validTarget,
        multiline: 'yes',
      } as any),
    ).toThrow(/must be a boolean/);
  });
});

describe('text.setValue validates string', () => {
  it('rejects non-string value', () => {
    expect(() => executeContentControlsTextSetValue(stubAdapter(), { target: validTarget, value: 42 } as any)).toThrow(
      /value must be a string/,
    );
  });
});

describe('date.setDisplayFormat validates string', () => {
  it('rejects empty format', () => {
    expect(() =>
      executeContentControlsDateSetDisplayFormat(stubAdapter(), {
        target: validTarget,
        format: '',
      }),
    ).toThrow(/non-empty string/);
  });
});

describe('checkbox.setState validates boolean', () => {
  it('rejects non-boolean checked', () => {
    expect(() =>
      executeContentControlsCheckboxSetState(stubAdapter(), {
        target: validTarget,
        checked: 'true',
      } as any),
    ).toThrow(/must be a boolean/);
  });
});

describe('checkbox.setSymbolPair validates symbol objects', () => {
  it('rejects invalid checkedSymbol', () => {
    expect(() =>
      executeContentControlsCheckboxSetSymbolPair(stubAdapter(), {
        target: validTarget,
        checkedSymbol: 'bad',
        uncheckedSymbol: { font: 'Arial', char: '☐' },
      } as any),
    ).toThrow(/checkedSymbol must be/);
  });

  it('rejects invalid uncheckedSymbol', () => {
    expect(() =>
      executeContentControlsCheckboxSetSymbolPair(stubAdapter(), {
        target: validTarget,
        checkedSymbol: { font: 'Arial', char: '☑' },
        uncheckedSymbol: null,
      } as any),
    ).toThrow(/uncheckedSymbol must be/);
  });
});

describe('choiceList.setItems validates array', () => {
  it('rejects non-array items', () => {
    expect(() =>
      executeContentControlsChoiceListSetItems(stubAdapter(), {
        target: validTarget,
        items: 'bad',
      } as any),
    ).toThrow(/items must be an array/);
  });
});

describe('choiceList.setSelected validates string', () => {
  it('rejects non-string value', () => {
    expect(() =>
      executeContentControlsChoiceListSetSelected(stubAdapter(), {
        target: validTarget,
        value: 42,
      } as any),
    ).toThrow(/value must be a string/);
  });
});

describe('repeatingSection.insertItemBefore validates index', () => {
  it('rejects non-integer index', () => {
    expect(() =>
      executeContentControlsRepeatingSectionInsertItemBefore(stubAdapter(), {
        target: validTarget,
        index: 'first',
      } as any),
    ).toThrow(/non-negative integer/);
  });

  it('rejects negative index', () => {
    expect(() =>
      executeContentControlsRepeatingSectionInsertItemBefore(stubAdapter(), {
        target: validTarget,
        index: -1,
      }),
    ).toThrow(/non-negative integer/);
  });
});

describe('repeatingSection.setAllowInsertDelete validates boolean', () => {
  it('rejects non-boolean', () => {
    expect(() =>
      executeContentControlsRepeatingSectionSetAllowInsertDelete(stubAdapter(), {
        target: validTarget,
        allow: 1,
      } as any),
    ).toThrow(/must be a boolean/);
  });
});

describe('group.wrap validates target', () => {
  it('accepts valid input', () => {
    const adapter = stubAdapter();
    executeContentControlsGroupWrap(adapter, { target: validTarget });
    expect(adapter.group.wrap).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// create.contentControl
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Deeper payload validation (round 2)
// ---------------------------------------------------------------------------

describe('patch validates all typed fields', () => {
  it('rejects non-boolean temporary', () => {
    expect(() => executeContentControlsPatch(stubAdapter(), { target: validTarget, temporary: 'yes' } as any)).toThrow(
      /temporary must be a boolean/,
    );
  });

  it('rejects non-integer tabIndex', () => {
    expect(() => executeContentControlsPatch(stubAdapter(), { target: validTarget, tabIndex: '1' } as any)).toThrow(
      /tabIndex must be an integer/,
    );
  });

  it('rejects non-boolean showingPlaceholder', () => {
    expect(() =>
      executeContentControlsPatch(stubAdapter(), { target: validTarget, showingPlaceholder: 'no' } as any),
    ).toThrow(/showingPlaceholder must be a boolean/);
  });

  it('accepts valid tabIndex integer', () => {
    const adapter = stubAdapter();
    executeContentControlsPatch(adapter, { target: validTarget, tabIndex: 5 });
    expect(adapter.patch).toHaveBeenCalled();
  });

  it('accepts null tabIndex (clearing)', () => {
    const adapter = stubAdapter();
    executeContentControlsPatch(adapter, { target: validTarget, tabIndex: null });
    expect(adapter.patch).toHaveBeenCalled();
  });
});

describe('choiceList.setItems validates item shapes', () => {
  it('rejects items with non-string displayText', () => {
    expect(() =>
      executeContentControlsChoiceListSetItems(stubAdapter(), {
        target: validTarget,
        items: [{ displayText: 1, value: 'a' }],
      } as any),
    ).toThrow(/items\[0\] must be/);
  });

  it('rejects items with non-string value', () => {
    expect(() =>
      executeContentControlsChoiceListSetItems(stubAdapter(), {
        target: validTarget,
        items: [{ displayText: 'A', value: null }],
      } as any),
    ).toThrow(/items\[0\] must be/);
  });

  it('accepts valid items', () => {
    const adapter = stubAdapter();
    executeContentControlsChoiceListSetItems(adapter, {
      target: validTarget,
      items: [{ displayText: 'A', value: 'a' }],
    });
    expect(adapter.choiceList.setItems).toHaveBeenCalled();
  });
});

describe('patchRawProperties validates patch op shapes', () => {
  it('rejects non-object patch entry', () => {
    expect(() =>
      executeContentControlsPatchRawProperties(stubAdapter(), {
        target: validTarget,
        patches: ['bad'],
      } as any),
    ).toThrow(/patches\[0\] must be an object/);
  });

  it('rejects invalid op', () => {
    expect(() =>
      executeContentControlsPatchRawProperties(stubAdapter(), {
        target: validTarget,
        patches: [{ op: 'wat', name: 'foo' }],
      } as any),
    ).toThrow(/patches\[0\]\.op must be one of/);
  });

  it('rejects empty name', () => {
    expect(() =>
      executeContentControlsPatchRawProperties(stubAdapter(), {
        target: validTarget,
        patches: [{ op: 'remove', name: '' }],
      } as any),
    ).toThrow(/patches\[0\]\.name must be a non-empty string/);
  });

  it('accepts valid patches', () => {
    const adapter = stubAdapter();
    executeContentControlsPatchRawProperties(adapter, {
      target: validTarget,
      patches: [{ op: 'remove', name: 'w:alias' }],
    });
    expect(adapter.patchRawProperties).toHaveBeenCalled();
  });
});

describe('create.contentControl validation', () => {
  const createAdapter = { create: mock(noop) } as any;
  const validAt = {
    kind: 'selection' as const,
    start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
    end: { kind: 'text' as const, blockId: 'p1', offset: 5 },
  };

  it('rejects null input', () => {
    expect(() => executeCreateContentControl(createAdapter, null as any)).toThrow(/non-null object/);
  });

  it('rejects invalid kind', () => {
    expect(() => executeCreateContentControl(createAdapter, { kind: 'bogus' } as any)).toThrow(/'block' or 'inline'/);
  });

  it('rejects invalid controlType', () => {
    expect(() => executeCreateContentControl(createAdapter, { kind: 'block', controlType: 'invalid' } as any)).toThrow(
      /controlType must be one of/,
    );
  });

  it('rejects invalid lockMode', () => {
    expect(() => executeCreateContentControl(createAdapter, { kind: 'block', lockMode: 'invalid' } as any)).toThrow(
      /lockMode must be one of/,
    );
  });

  it('rejects invalid target (wrong nodeType)', () => {
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'block',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
      } as any),
    ).toThrow(/nodeType must be 'sdt'/);
  });

  it('rejects non-string content', () => {
    expect(() => executeCreateContentControl(createAdapter, { kind: 'block', content: 42 } as any)).toThrow(
      /content must be a string/,
    );
  });

  it('rejects non-string html', () => {
    expect(() => executeCreateContentControl(createAdapter, { kind: 'block', html: 42 } as any)).toThrow(
      /html must be a string/,
    );
  });

  it('rejects multiple preset payload shapes together', () => {
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'block',
        content: 'plain',
        html: '<p>html</p>',
      } as any),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'block',
        content: 'plain',
        json: { type: 'paragraph', content: [{ type: 'text', text: 'json' }] },
      } as any),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'block',
        html: '<p>html</p>',
        json: { type: 'paragraph', content: [{ type: 'text', text: 'json' }] },
      } as any),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects html/json presets for inline content controls', () => {
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'inline',
        html: '<p>Block only</p>',
      } as any),
    ).toThrow(/supported only for block content controls/);
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'inline',
        json: { type: 'paragraph', content: [{ type: 'text', text: 'Block only' }] },
      } as any),
    ).toThrow(/supported only for block content controls/);
  });

  it('accepts valid input with target and content', () => {
    const adapter = { create: mock(noop) } as any;
    executeCreateContentControl(adapter, {
      kind: 'block',
      controlType: 'text',
      target: validTarget,
      content: 'hello',
    });
    expect(adapter.create).toHaveBeenCalled();
  });

  it('accepts structured block presets from html', () => {
    const adapter = { create: mock(noop) } as any;
    executeCreateContentControl(adapter, {
      kind: 'block',
      alias: 'Preset',
      html: '<p>Preset block</p>',
    });
    expect(adapter.create).toHaveBeenCalled();
  });

  it('accepts structured block presets from json', () => {
    const adapter = { create: mock(noop) } as any;
    executeCreateContentControl(adapter, {
      kind: 'block',
      json: { type: 'paragraph', content: [{ type: 'text', text: 'Preset block' }] },
    });
    expect(adapter.create).toHaveBeenCalled();
  });

  it('rejects at and target together', () => {
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'inline',
        target: validTarget,
        at: validAt,
      } as any),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects invalid at (missing start)', () => {
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'inline',
        at: { kind: 'selection', end: { kind: 'text', blockId: 'p1', offset: 5 } },
      } as any),
    ).toThrow(/valid SelectionTarget/);
  });

  it('rejects invalid at (wrong kind)', () => {
    expect(() =>
      executeCreateContentControl(createAdapter, {
        kind: 'inline',
        at: { ...validAt, kind: 'bogus' },
      } as any),
    ).toThrow(/valid SelectionTarget/);
  });

  it('accepts valid at (SelectionTarget)', () => {
    const adapter = { create: mock(noop) } as any;
    executeCreateContentControl(adapter, {
      kind: 'inline',
      at: validAt,
      tag: 'name',
      alias: 'Name',
    });
    expect(adapter.create).toHaveBeenCalled();
  });
});
