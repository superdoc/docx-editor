import { describe, it, expect, mock } from 'bun:test';
import { DocumentApiValidationError } from '../errors.js';
import {
  executeAnchoredMetadataAttach,
  executeAnchoredMetadataGet,
  executeAnchoredMetadataList,
  executeAnchoredMetadataRemove,
  executeAnchoredMetadataResolve,
  executeAnchoredMetadataUpdate,
  type AnchoredMetadataAdapter,
} from './anchored-metadata.js';
import type { SelectionTarget, TextTarget } from '../types/address.js';

function makeAdapter(): AnchoredMetadataAdapter {
  return {
    attach: mock().mockReturnValue({
      success: true,
      id: 'm-1',
      namespace: 'urn:test:1',
      partName: 'customXml/item1.xml',
    }),
    list: mock().mockReturnValue({ items: [], total: 0 }),
    get: mock().mockReturnValue(null),
    update: mock().mockReturnValue({ success: true, id: 'm-1' }),
    remove: mock().mockReturnValue({ success: true, id: 'm-1' }),
    resolve: mock().mockReturnValue(null),
  };
}

const VALID_PAYLOAD = { type: 'citation', source: 'Alpha Corp v. SEC', confidence: 0.92 };
const VALID_NAMESPACE = 'urn:test:1';

const TEXT_TARGET: SelectionTarget = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'b-1', offset: 0 },
  end: { kind: 'text', blockId: 'b-1', offset: 10 },
};

const CROSS_BLOCK_TARGET: SelectionTarget = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'b-1', offset: 0 },
  end: { kind: 'text', blockId: 'b-2', offset: 5 },
};

const NODE_EDGE_TARGET: SelectionTarget = {
  kind: 'selection',
  start: { kind: 'nodeEdge', node: { kind: 'block', nodeType: 'paragraph', nodeId: 'b-1' }, edge: 'before' },
  end: { kind: 'nodeEdge', node: { kind: 'block', nodeType: 'paragraph', nodeId: 'b-1' }, edge: 'after' },
};

const MULTI_SEGMENT_TARGET: TextTarget = {
  kind: 'text',
  segments: [
    { blockId: 'b-1', range: { start: 5, end: 10 } },
    { blockId: 'b-2', range: { start: 0, end: 5 } },
  ],
};

// ---------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------

describe('metadata.attach validation', () => {
  it('accepts a same-block text-range target with a JSON payload + namespace', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
      }),
    ).not.toThrow();
    expect(adapter.attach).toHaveBeenCalled();
  });

  it('accepts a caller-supplied id', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
        id: 'consumer-id-1',
      }),
    ).not.toThrow();
  });

  it('accepts JSON primitives, arrays, and nulls as payload', () => {
    const adapter = makeAdapter();
    for (const payload of ['string', 42, true, false, null, [], [1, 2, 3], { nested: { a: 1 } }]) {
      expect(() =>
        executeAnchoredMetadataAttach(adapter, {
          target: TEXT_TARGET,
          namespace: VALID_NAMESPACE,
          payload,
        }),
      ).not.toThrow();
    }
  });

  it('rejects non-SelectionTarget shapes', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: { foo: 'bar' } as unknown as SelectionTarget,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects nodeEdge anchors (v1 is inline SDT only)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: NODE_EDGE_TARGET,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects a cross-paragraph SelectionTarget (must use TextTarget instead)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: CROSS_BLOCK_TARGET,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('accepts a multi-segment TextTarget spanning multiple paragraphs', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: MULTI_SEGMENT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
      }),
    ).not.toThrow();
    expect(adapter.attach).toHaveBeenCalled();
  });

  it('rejects empty namespace', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: '',
        payload: VALID_PAYLOAD,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects payload with a cycle', () => {
    const adapter = makeAdapter();
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic.self = cyclic;
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: cyclic,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects payload that is a bare function (not JSON-serializable)', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: () => 1,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects payload that is undefined at the top', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: undefined,
      }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects empty caller-supplied id', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataAttach(adapter, {
        target: TEXT_TARGET,
        namespace: VALID_NAMESPACE,
        payload: VALID_PAYLOAD,
        id: '',
      }),
    ).toThrow(DocumentApiValidationError);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('metadata.list validation', () => {
  it('accepts no input', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter)).not.toThrow();
    expect(adapter.list).toHaveBeenCalled();
  });

  it('accepts namespace filter', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { namespace: VALID_NAMESPACE })).not.toThrow();
  });

  it('accepts a within filter (text-range, same block)', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { within: TEXT_TARGET })).not.toThrow();
    expect(adapter.list).toHaveBeenCalled();
  });

  it('accepts namespace + within together', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataList(adapter, { namespace: VALID_NAMESPACE, within: TEXT_TARGET }),
    ).not.toThrow();
  });

  it('accepts resolvedOnly filter', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { resolvedOnly: true })).not.toThrow();
  });

  it('rejects non-string namespace', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { namespace: 42 as unknown as string })).toThrow(
      DocumentApiValidationError,
    );
  });

  it('rejects a cross-block SelectionTarget within (must use TextTarget instead)', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { within: CROSS_BLOCK_TARGET })).toThrow(
      DocumentApiValidationError,
    );
  });

  it('accepts a multi-segment TextTarget within filter', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { within: MULTI_SEGMENT_TARGET })).not.toThrow();
  });

  it('rejects nodeEdge within', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { within: NODE_EDGE_TARGET })).toThrow(
      DocumentApiValidationError,
    );
  });

  it('rejects non-SelectionTarget within', () => {
    const adapter = makeAdapter();
    expect(() =>
      executeAnchoredMetadataList(adapter, { within: { foo: 'bar' } as unknown as SelectionTarget }),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects non-boolean resolvedOnly', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataList(adapter, { resolvedOnly: 'yes' as unknown as boolean })).toThrow(
      DocumentApiValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// get / update / remove / resolve: id validation
// ---------------------------------------------------------------------------

describe('metadata.{get,update,remove,resolve} require id', () => {
  it('get accepts a non-empty id', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataGet(adapter, { id: 'm-1' })).not.toThrow();
  });

  it('requires a valid body story for physical control reads and resolves', () => {
    const adapter = makeAdapter();
    const bodyStory = { kind: 'story', storyType: 'body' } as const;
    const headerStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId1' } as const;
    const withoutStory = { id: 'm-1', contentControlId: '4001' } as never;
    const malformedStory = {
      id: 'm-1',
      contentControlId: '4001',
      story: { kind: 'story', storyType: 'headerFooterPart' },
    } as never;

    expect(executeAnchoredMetadataGet(adapter, withoutStory)).toBeNull();
    expect(executeAnchoredMetadataResolve(adapter, withoutStory)).toBeNull();
    expect(executeAnchoredMetadataGet(adapter, { id: 'm-1', contentControlId: '4001', story: headerStory })).toBeNull();
    expect(
      executeAnchoredMetadataResolve(adapter, { id: 'm-1', contentControlId: '4001', story: headerStory }),
    ).toBeNull();
    expect(() => executeAnchoredMetadataGet(adapter, malformedStory)).toThrow(DocumentApiValidationError);
    expect(() => executeAnchoredMetadataResolve(adapter, malformedStory)).toThrow(DocumentApiValidationError);
    expect(adapter.get).not.toHaveBeenCalled();
    expect(adapter.resolve).not.toHaveBeenCalled();
    executeAnchoredMetadataGet(adapter, { id: 'm-1', contentControlId: '4001', story: bodyStory });
    executeAnchoredMetadataResolve(adapter, { id: 'm-1', contentControlId: '4001', story: bodyStory });
    expect(adapter.get).toHaveBeenCalledWith({ id: 'm-1', contentControlId: '4001', story: bodyStory });
    expect(adapter.resolve).toHaveBeenCalledWith({ id: 'm-1', contentControlId: '4001', story: bodyStory });
  });

  it('get rejects empty id', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataGet(adapter, { id: '' })).toThrow(DocumentApiValidationError);
  });

  it('get rejects non-string id', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataGet(adapter, { id: 42 as unknown as string })).toThrow(
      DocumentApiValidationError,
    );
  });

  it('update requires id and JSON-serializable payload', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataUpdate(adapter, { id: 'm-1', payload: VALID_PAYLOAD })).not.toThrow();
    expect(() => executeAnchoredMetadataUpdate(adapter, { id: '', payload: VALID_PAYLOAD })).toThrow(
      DocumentApiValidationError,
    );
    expect(() => executeAnchoredMetadataUpdate(adapter, { id: 'm-1', payload: undefined })).toThrow(
      DocumentApiValidationError,
    );
  });

  it('remove rejects empty id', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataRemove(adapter, { id: '' })).toThrow(DocumentApiValidationError);
  });

  it('resolve rejects empty id', () => {
    const adapter = makeAdapter();
    expect(() => executeAnchoredMetadataResolve(adapter, { id: '' })).toThrow(DocumentApiValidationError);
  });
});
