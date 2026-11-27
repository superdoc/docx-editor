import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_BOUNDARY_SCHEMA, type FlowBlock, type ParagraphBlock } from '@superdoc/contracts';
import { createWebFlowPainter } from './painter.js';
import { ensureWebFlowStyles } from './styles.js';
import type { WebFlowPaintItem } from './types.js';

const mounts: HTMLElement[] = [];

afterEach(() => {
  mounts.splice(0).forEach((mount) => mount.remove());
  vi.restoreAllMocks();
});

function mount(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  mounts.push(element);
  return element;
}

function paragraph(id: string, text: string, extra: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return {
    kind: 'paragraph',
    id,
    runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 16 }],
    ...extra,
  };
}

function item(key: string, text: string, fingerprint = text): WebFlowPaintItem {
  return { stableDomKey: key, renderFingerprint: fingerprint, block: paragraph(`block-${key}`, text) };
}

function identifiedItem(key: string, blockId: string, text: string, fingerprint = text): WebFlowPaintItem {
  return {
    stableDomKey: key,
    renderFingerprint: fingerprint,
    block: paragraph(blockId, text),
    layoutIdentities: [
      {
        schema: LAYOUT_BOUNDARY_SCHEMA,
        fragmentId: blockId,
        blockRef: blockId,
        story: { kind: 'body' },
      },
    ],
  };
}

function commit(painter: ReturnType<typeof createWebFlowPainter>, command: Parameters<typeof painter.prepare>[0]) {
  const transaction = painter.prepare(command);
  const applied = transaction.apply();
  transaction.finalize();
  return applied;
}

describe('WebFlowPainter', () => {
  it('commits formatting glyphs with the content transaction and rolls visibility back', async () => {
    const root = mount();
    const onUnownedMutation = vi.fn();
    const painter = createWebFlowPainter(root, { onUnownedMutation });
    const block = paragraph('marks', 'A  B');
    block.runs.push({ kind: 'tab' }, { kind: 'lineBreak' }, { kind: 'text', text: 'C' });
    const off = { stableDomKey: 'marks', renderFingerprint: 'off', block };
    const on = { ...off, renderFingerprint: 'on', showFormattingMarks: true };
    commit(painter, { kind: 'replace-all', epoch: 1, items: [off] });
    const original = root.firstElementChild;
    const transaction = painter.prepare({ kind: 'replace-all', epoch: 2, items: [on] });
    expect(root.querySelector('.superdoc-formatting-paragraph-mark')).toBeNull();
    transaction.apply();
    expect(root.querySelectorAll('.superdoc-formatting-space-mark')).toHaveLength(2);
    expect(root.querySelector('.superdoc-formatting-line-break')?.textContent).toBe('↵');
    expect(root.querySelector('.superdoc-formatting-paragraph-mark')?.textContent).toBe('¶');
    expect(root.querySelector('.superdoc-web-flow-formatting-tab')).not.toBeNull();
    expect(root.querySelectorAll('[data-web-flow-visual-only="true"][aria-hidden="true"]')).toHaveLength(2);
    transaction.rollback();
    expect(root.firstElementChild).toBe(original);
    expect(root.textContent).toBe('A  B\tC');
    expect(root.querySelector('.superdoc-formatting-paragraph-mark')).toBeNull();
    commit(painter, { kind: 'replace-all', epoch: 3, items: [on] });
    const repaired = painter.restoreCommittedDomAfterUnownedMutation();
    expect(repaired.bindings).toHaveLength(1);
    expect(root.querySelector('.superdoc-formatting-line-break')?.textContent).toBe('↵');
    commit(painter, { kind: 'replace-all', epoch: 4, items: [off] });
    expect(root.querySelector('.superdoc-formatting-space-mark')).toBeNull();
    await Promise.resolve();
    expect(onUnownedMutation).not.toHaveBeenCalled();
  });
  it('applies a nonce to its document stylesheet', () => {
    const doc = document.implementation.createHTMLDocument('web-flow-nonce');

    ensureWebFlowStyles(doc, 'page-nonce');

    expect(doc.head.querySelector<HTMLStyleElement>('style')?.nonce).toBe('page-nonce');
  });

  it('publishes a normal-flow retained root without contenteditable authority', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 1, items: [item('a', 'alpha'), item('b', 'beta')] });

    expect(root.dataset.webFlowOwner).toBe('retained-web-flow');
    expect(root.getAttribute('contenteditable')).toBeNull();
    expect(root.textContent).toContain('alphabeta');
    expect(painter.snapshot().bindings.map((binding) => binding.key)).toEqual(['a', 'b']);
  });

  it('omits layout-only blocks and anchored objects without losing retained splice identity', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const blocks: Array<[string, FlowBlock]> = [
      ['section', { kind: 'sectionBreak', id: 'section', margins: {} }],
      ['carrier', paragraph('carrier', '', { attrs: { sectPrMarker: true }, runs: [] })],
      ['page', { kind: 'pageBreak', id: 'page' }],
      ['column', { kind: 'columnBreak', id: 'column' }],
      [
        'behind-image',
        {
          kind: 'image',
          id: 'behind-image',
          src: '',
          placeholder: { diagnosticIds: ['render.media.unsupported-format'], accessibleName: 'Picture 1' },
          anchor: { isAnchored: true, behindDoc: true, vRelativeFrom: 'insideMargin' },
        },
      ],
      [
        'floating-table',
        {
          kind: 'table',
          id: 'floating-table',
          rows: [{ id: 'row', cells: [{ id: 'cell', paragraph: paragraph('cell-paragraph', 'floating') }] }],
          anchor: { isAnchored: true, vRelativeFrom: 'page' },
        },
      ],
      [
        'anchored-drawing',
        {
          kind: 'drawing',
          id: 'anchored-drawing',
          drawingKind: 'vectorShape',
          geometry: { width: 10, height: 10, rotation: 0, flipH: false, flipV: false },
          shapeKind: 'rect',
          anchor: { isAnchored: true, vRelativeFrom: 'paragraph' },
        },
      ],
      [
        'flow-drawing',
        {
          kind: 'drawing',
          id: 'flow-drawing',
          drawingKind: 'vectorShape',
          geometry: { width: 10, height: 10, rotation: 0, flipH: false, flipV: false },
          shapeKind: 'rect',
        },
      ],
      [
        'flow-image',
        {
          kind: 'image',
          id: 'flow-image',
          src: '',
          placeholder: { diagnosticIds: ['render.media.unsupported-format'], accessibleName: 'Inline image' },
        },
      ],
      ['break-before', paragraph('break-before', 'after', { attrs: { pageBreakBefore: true } })],
      ['paragraph', paragraph('paragraph', 'body')],
    ];
    const items = blocks.map(([stableDomKey, block]) => ({
      stableDomKey,
      renderFingerprint: stableDomKey,
      block,
    }));
    const work = commit(painter, { kind: 'replace-all', epoch: 1, items }).work;

    expect(root.textContent).toBe('Inline imageafterbody');
    expect(root.textContent).not.toContain('Picture 1');
    expect(root.querySelectorAll('.superdoc-web-flow-diagnostic')).toHaveLength(1);
    expect(painter.snapshot().bindings.map((binding) => binding.key)).toEqual([
      'flow-image',
      'break-before',
      'paragraph',
    ]);
    expect(work).toMatchObject({ createdNodes: 3, touchedItems: items.length });

    const noDomWork = commit(painter, {
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['page'],
      expectedLeftKey: 'carrier',
      expectedRightKey: 'column',
      items: [{ stableDomKey: 'page', renderFingerprint: 'page-v2', block: { kind: 'pageBreak', id: 'page' } }],
    }).work;

    expect(root.textContent).toBe('Inline imageafterbody');
    expect(noDomWork).toMatchObject({ createdNodes: 0, removedNodes: 0, touchedItems: 1 });
  });

  it('drops inline page controls and treats inline column breaks as ordinary line breaks', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const block = paragraph('breaks', '', {
      runs: [
        { kind: 'text', text: 'left', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'break', breakType: 'page' },
        { kind: 'text', text: 'middle', fontFamily: 'Arial', fontSize: 16 },
        { kind: 'break', breakType: 'column' },
        { kind: 'text', text: 'right', fontFamily: 'Arial', fontSize: 16 },
      ],
    });

    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [{ stableDomKey: 'breaks', renderFingerprint: 'v1', block }],
    });

    expect(root.textContent).toBe('leftmiddleright');
    expect(root.textContent).not.toMatch(/Page break|Column break/);
    expect(root.querySelectorAll('br')).toHaveLength(1);
    expect(root.querySelector('.superdoc-web-flow-diagnostic')).toBeNull();
  });

  it('rolls DOM transitions between omitted and visible retained items back atomically', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [
        item('left', 'left'),
        { stableDomKey: 'middle', renderFingerprint: 'hidden', block: { kind: 'pageBreak', id: 'middle' } },
        item('right', 'right'),
      ],
    });
    const before = [...root.children];
    const transaction = painter.prepare({
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['middle'],
      expectedLeftKey: 'left',
      expectedRightKey: 'right',
      items: [item('middle', 'visible', 'visible')],
    });

    transaction.apply();
    expect(root.textContent).toBe('leftvisibleright');
    transaction.rollback();

    expect([...root.children]).toEqual(before);
    expect(root.textContent).toBe('leftright');
    expect(painter.snapshot().bindings.map((binding) => binding.key)).toEqual(['left', 'right']);
  });

  it('patches only the certified middle extent and retains unaffected node identity', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [item('a', 'alpha'), item('b', 'beta'), item('c', 'gamma')],
    });
    const [left, oldMiddle, right] = painter.snapshot().bindings.map((binding) => binding.node);

    const work = commit(painter, {
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['b'],
      expectedLeftKey: 'a',
      expectedRightKey: 'c',
      items: [item('b', 'changed', 'changed-v2')],
    }).work;
    const [nextLeft, nextMiddle, nextRight] = painter.snapshot().bindings.map((binding) => binding.node);

    expect(nextLeft).toBe(left);
    expect(nextRight).toBe(right);
    expect(nextMiddle).not.toBe(oldMiddle);
    expect(root.textContent).toContain('alphachangedgamma');
    expect(work).toMatchObject({ kind: 'splice', createdNodes: 1, removedNodes: 1, touchedItems: 1 });
  });

  it('returns bindings for only the changed item', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [item('a', 'alpha'), item('b', 'beta'), item('c', 'gamma')],
    });
    const transaction = painter.prepare({
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['b'],
      expectedLeftKey: 'a',
      expectedRightKey: 'c',
      items: [item('b', 'changed', 'changed-v2')],
    });

    const applied = transaction.apply();
    transaction.finalize();

    expect(applied.touchedBindings).toEqual([expect.objectContaining({ key: 'b', blockId: 'block-b' })]);
    expect(applied.changedBindings).toEqual([expect.objectContaining({ key: 'b', blockId: 'block-b' })]);
  });

  it('preserves retained node order when a wide exact window changes one item', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [item('a', 'alpha'), item('b', 'beta'), item('c', 'gamma')],
    });
    const [a, oldB, c] = painter.snapshot().bindings.map((binding) => binding.node);

    commit(painter, {
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['a', 'b', 'c'],
      expectedLeftKey: null,
      expectedRightKey: null,
      items: [item('a', 'alpha'), item('b', 'changed', 'changed-v2'), item('c', 'gamma')],
    });

    const [nextA, nextB, nextC] = painter.snapshot().bindings.map((binding) => binding.node);
    expect([...root.children]).toEqual([nextA, nextB, nextC]);
    expect(nextA).toBe(a);
    expect(nextB).not.toBe(oldB);
    expect(nextC).toBe(c);
    expect(root.textContent).toContain('alphachangedgamma');
  });

  it('rebases a structural suffix in place and rolls its identity datasets back atomically', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const head = identifiedItem('head', 'n/body/o0', 'alpha', 'head-v1');
    const tail = identifiedItem('tail', 'n/body/o1', 'beta', 'tail-v1');
    commit(painter, { kind: 'replace-all', epoch: 1, items: [head, tail] });
    const tailNode = painter.snapshot().bindings[1]!.node;
    const transaction = painter.prepare({
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['head'],
      expectedLeftKey: null,
      expectedRightKey: 'tail',
      items: [
        identifiedItem('head', 'n/body/o0', 'al', 'head-v2'),
        identifiedItem('split', 'n/body/o1', 'pha', 'split-v1'),
      ],
      retainedRebases: [identifiedItem('tail', 'n/body/o2', 'beta', 'tail-v2')],
    });
    const applied = transaction.apply();

    expect(applied.work.rebasedNodes).toBe(1);
    expect(painter.snapshot().bindings[2]!.node).toBe(tailNode);
    expect(tailNode.dataset.flowBlockId).toBe('n/body/o2');
    expect(tailNode.dataset.layoutBlockRef).toBe('n/body/o2');
    expect(tailNode.dataset.webFlowFingerprint).toBe('tail-v2');

    transaction.rollback();
    expect(painter.snapshot().bindings.map((binding) => binding.key)).toEqual(['head', 'tail']);
    expect(painter.snapshot().bindings[1]!.node).toBe(tailNode);
    expect(tailNode.dataset.flowBlockId).toBe('n/body/o1');
    expect(tailNode.dataset.layoutBlockRef).toBe('n/body/o1');
    expect(tailNode.dataset.webFlowFingerprint).toBe('tail-v1');
  });

  it('rejects stale or mismatched splices before DOM mutation', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 4, items: [item('a', 'alpha'), item('b', 'beta')] });
    const before = [...root.childNodes];

    expect(() =>
      painter.prepare({
        kind: 'splice',
        expectedBaseEpoch: 3,
        epoch: 5,
        storyKey: 'body',
        expectedRemovedKeys: ['b'],
        expectedLeftKey: 'a',
        expectedRightKey: null,
        items: [item('b', 'changed')],
      }),
    ).toThrow('base epoch is stale');
    expect([...root.childNodes]).toEqual(before);

    expect(() =>
      painter.prepare({
        kind: 'splice',
        expectedBaseEpoch: 4,
        epoch: 5,
        storyKey: 'body',
        expectedRemovedKeys: ['b'],
        expectedLeftKey: null,
        expectedRightKey: null,
        items: [item('b', 'changed')],
      }),
    ).toThrow('removed-key sequence does not match');
    expect([...root.childNodes]).toEqual(before);
  });

  it('rolls an applied splice back to the exact previous nodes and epoch', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 1, items: [item('a', 'alpha'), item('b', 'beta')] });
    const before = painter.snapshot();
    const transaction = painter.prepare({
      kind: 'splice',
      expectedBaseEpoch: 1,
      epoch: 2,
      storyKey: 'body',
      expectedRemovedKeys: ['a'],
      expectedLeftKey: null,
      expectedRightKey: 'b',
      items: [item('a', 'changed', 'changed')],
    });
    transaction.apply();
    transaction.rollback();

    const after = painter.snapshot();
    expect(after.epoch).toBe(1);
    expect(after.version).toBe(before.version);
    expect(after.bindings.map((binding) => binding.node)).toEqual(before.bindings.map((binding) => binding.node));
    expect(root.textContent).toContain('alphabeta');
  });

  it('retains matching keyed nodes during broad reconciliation and safely reorders them', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 1, items: [item('a', 'alpha'), item('b', 'beta')] });
    const [a, b] = painter.snapshot().bindings.map((binding) => binding.node);

    const work = commit(painter, {
      kind: 'replace-all',
      epoch: 2,
      items: [item('b', 'beta'), item('a', 'alpha'), item('c', 'gamma')],
    }).work;
    const [nextB, nextA] = painter.snapshot().bindings.map((binding) => binding.node);

    expect(nextA).toBe(a);
    expect(nextB).toBe(b);
    expect(work).toMatchObject({ retainedNodes: 2, createdNodes: 1, removedNodes: 0 });
  });

  it('rebases retained identity datasets during broad structural reconciliation', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const before = identifiedItem('retained', 'n/body/o1', 'beta', 'same-content');
    commit(painter, { kind: 'replace-all', epoch: 1, items: [before] });
    const retainedNode = painter.snapshot().bindings[0]!.node;

    const work = commit(painter, {
      kind: 'replace-all',
      epoch: 2,
      items: [
        identifiedItem('inserted', 'n/body/o1', 'new', 'new-content'),
        identifiedItem('retained', 'n/body/o2', 'beta', 'same-content'),
      ],
    }).work;

    const shifted = painter.snapshot().bindings[1]!.node;
    expect(shifted).toBe(retainedNode);
    expect(shifted.dataset.flowBlockId).toBe('n/body/o2');
    expect(shifted.dataset.layoutBlockRef).toBe('n/body/o2');
    expect(painter.snapshot().bindings[1]!.blockId).toBe('n/body/o2');
    expect(work).toMatchObject({ retainedNodes: 1, createdNodes: 1, rebasedNodes: 1 });
  });

  it('rebases rendered nested table blocks in broad and exact structural paths', () => {
    const table = (ordinal: number): FlowBlock => ({
      kind: 'table',
      id: `n/body/o${ordinal}`,
      rows: [
        {
          id: `n/body/o${ordinal}-row`,
          cells: [
            {
              id: `n/body/o${ordinal}-cell`,
              blocks: [
                {
                  kind: 'image',
                  id: `n/body/o${ordinal}-image`,
                  src: 'data:image/png;base64,iVBORw0KGgo=',
                  width: 10,
                  height: 10,
                },
                { kind: 'pageBreak', id: `n/body/o${ordinal}-break` },
              ],
            },
          ],
        },
      ],
    });
    const tableItem = (ordinal: number): WebFlowPaintItem => ({
      stableDomKey: 'table',
      renderFingerprint: 'same-table-content',
      block: table(ordinal),
    });
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 1, items: [tableItem(1)] });
    const retainedTable = painter.snapshot().bindings[0]!.node;

    commit(painter, { kind: 'replace-all', epoch: 2, items: [tableItem(2)] });
    expect(painter.snapshot().bindings[0]!.node).toBe(retainedTable);
    expect(root.querySelector('[data-flow-block-id="n/body/o2-image"]')).not.toBeNull();
    expect(root.querySelector('[data-flow-block-id="n/body/o2-break"]')).toBeNull();

    commit(painter, {
      kind: 'splice',
      expectedBaseEpoch: 2,
      epoch: 3,
      storyKey: 'body',
      expectedRemovedKeys: [],
      expectedLeftKey: null,
      expectedRightKey: 'table',
      items: [item('head', 'new')],
      retainedRebases: [tableItem(3)],
    });
    expect(painter.snapshot().bindings[1]!.node).toBe(retainedTable);
    expect(root.querySelector('[data-flow-block-id="n/body/o3-image"]')).not.toBeNull();
    expect(root.querySelector('[data-flow-block-id="n/body/o3-break"]')).toBeNull();
  });

  it('uses text nodes and blocks executable link and image sources', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const block: FlowBlock = paragraph('unsafe', '<img src=x onerror=alert(1)>', {
      runs: [
        {
          kind: 'text',
          text: '<img src=x onerror=alert(1)>',
          fontFamily: 'Arial',
          fontSize: 16,
          link: { href: 'javascript:alert(1)' },
        },
        { kind: 'image', src: 'javascript:alert(1)', width: 10, height: 10, alt: 'unsafe' },
      ],
    });
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [{ stableDomKey: 'unsafe', renderFingerprint: 'v1', block }],
    });

    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('rejects unowned descendant text mutations before another transaction', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 1, items: [item('a', 'alpha')] });
    const text = root.querySelector('[data-web-flow-key="a"]')?.firstChild?.firstChild;
    expect(text).toBeInstanceOf(Text);

    (text as Text).data = 'native mutation';

    expect(() => painter.prepare({ kind: 'replace-all', epoch: 2, items: [item('a', 'alpha')] })).toThrow(
      'unowned text mutation detected',
    );
  });

  it('reports unowned text immediately and can restore the last committed derived DOM', async () => {
    const root = mount();
    const detected: Array<'text' | 'dom'> = [];
    let painter: ReturnType<typeof createWebFlowPainter>;
    painter = createWebFlowPainter(root, {
      onUnownedMutation(kind) {
        detected.push(kind);
        painter.restoreCommittedDomAfterUnownedMutation();
      },
    });
    commit(painter, { kind: 'replace-all', epoch: 1, items: [item('a', 'alpha')] });
    const text = root.querySelector('[data-web-flow-key="a"]')?.firstChild?.firstChild;
    expect(text).toBeInstanceOf(Text);

    (text as Text).data = 'native mutation';
    await Promise.resolve();

    expect(detected).toEqual(['text']);
    expect(root.textContent).toBe('alpha');
    expect(() => {
      const transaction = painter.prepare({ kind: 'replace-all', epoch: 2, items: [item('a', 'alpha')] });
      transaction.rollback();
    }).not.toThrow();
  });

  it('rejects unowned keyed identity mutations without scanning every block', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    commit(painter, { kind: 'replace-all', epoch: 1, items: [item('a', 'alpha')] });
    const block = root.querySelector<HTMLElement>('[data-web-flow-key="a"]');
    expect(block).not.toBeNull();

    block!.dataset.webFlowKey = 'unowned';

    expect(() => painter.prepare({ kind: 'replace-all', epoch: 2, items: [item('a', 'alpha')] })).toThrow(
      'unowned DOM mutation detected',
    );
  });

  it('renders table and tracked text carriers in semantic DOM', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const block: FlowBlock = {
      kind: 'table',
      id: 'table',
      columnWidths: [600, 200],
      rows: [
        {
          id: 'row',
          cells: [
            {
              id: 'cell',
              paragraph: paragraph('p', 'tracked', {
                runs: [
                  {
                    kind: 'text',
                    text: 'tracked',
                    fontFamily: 'Arial',
                    fontSize: 16,
                    trackedChange: { kind: 'insert', id: 'change-1', author: 'Ada' },
                  },
                ],
              }),
            },
            {
              id: 'cell-2',
              paragraph: paragraph('p-2', 'second'),
            },
          ],
        },
      ],
    };
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [{ stableDomKey: 'table', renderFingerprint: 'v1', block }],
    });

    expect(root.querySelector('table td')?.textContent).toContain('tracked');
    expect(root.querySelector('[data-track-change-id="change-1"]')).not.toBeNull();
    expect([...root.querySelectorAll('col')].map((column) => column.style.width)).toEqual(['75%', '25%']);
  });

  it('renders authored list markers, restarts, formats, and levels explicitly', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const block: FlowBlock = {
      kind: 'list',
      id: 'legal-list',
      listType: 'number',
      items: [
        {
          id: 'legal-item',
          marker: {
            kind: 'number',
            text: 'Article IV.',
            level: 2,
            order: 4,
            customFormat: 'Article %1.',
          },
          paragraph: paragraph('legal-paragraph', 'Definitions', {
            attrs: { wordLayout: { marker: { markerText: 'wrong-browser-marker' } } },
          }),
        },
      ],
    };

    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [{ stableDomKey: 'legal-list', renderFingerprint: 'v1', block }],
    });

    const listItem = root.querySelector('li');
    expect(listItem?.querySelector('.superdoc-web-flow-list-marker')?.textContent).toBe('Article IV.');
    expect(listItem?.dataset.webFlowListOrder).toBe('4');
    expect(listItem?.dataset.webFlowListLevel).toBe('2');
    expect(listItem?.dataset.webFlowListCustomFormat).toBe('Article %1.');
    expect(listItem?.textContent).not.toContain('wrong-browser-marker');
  });

  it('uses the projected tracked display mode for structural rows and cells', () => {
    const root = mount();
    const painter = createWebFlowPainter(root);
    const block: FlowBlock = {
      kind: 'table',
      id: 'tracked-table',
      rows: [
        {
          id: 'inserted-row',
          attrs: { trackedChange: { kind: 'insert', id: 'row-change' } },
          cells: [
            {
              id: 'row-cell',
              paragraph: paragraph('row-paragraph', 'inserted', {
                attrs: { trackedChangesMode: 'original', trackedChangesEnabled: true },
              }),
            },
          ],
        },
        {
          id: 'cell-row',
          cells: [
            {
              id: 'deleted-cell',
              attrs: { trackedChange: { kind: 'delete', id: 'cell-change' } },
              paragraph: paragraph('cell-paragraph', 'deleted', {
                attrs: { trackedChangesMode: 'final', trackedChangesEnabled: true },
              }),
            },
          ],
        },
        {
          id: 'off-row',
          attrs: { trackedChange: { kind: 'insert', id: 'off-change' } },
          cells: [
            {
              id: 'off-cell',
              paragraph: paragraph('off-paragraph', 'off', {
                attrs: { trackedChangesMode: 'off', trackedChangesEnabled: true },
              }),
            },
          ],
        },
      ],
    };

    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [{ stableDomKey: 'tracked-table', renderFingerprint: 'v1', block }],
    });

    expect(root.querySelector('[data-flow-block-id="row-cell"]')?.classList).toContain('hidden');
    expect(root.querySelector('[data-flow-block-id="deleted-cell"]')?.classList).toContain('hidden');
    expect(root.querySelector('[data-flow-block-id="off-cell"]')?.getAttribute('data-track-change-id')).toBeNull();
  });
  it('binds web-flow structural review to its primary physical row or cell and omits disabled owners', () => {
    const root = mount(),
      painter = createWebFlowPainter(root);
    const meta = { kind: 'insert' as const, id: 'imported:3' };
    const block: FlowBlock = {
      kind: 'table',
      id: 'table',
      rows: [
        {
          id: 'actual-row',
          attrs: { trackedChange: meta },
          cells: [{ id: 'overlapped-cell', attrs: { trackedChange: meta }, paragraph: paragraph('p1', 'both') }],
        },
        {
          id: 'other-row',
          cells: [{ id: 'actual-cell', attrs: { trackedChange: meta }, paragraph: paragraph('p2', 'cell') }],
        },
        {
          id: 'disabled-row',
          attrs: { trackedChange: meta },
          cells: [
            {
              id: 'disabled-cell',
              paragraph: paragraph('p3', 'off', { attrs: { trackedChangesMode: 'off', trackedChangesEnabled: true } }),
            },
          ],
        },
      ],
    };
    commit(painter, {
      kind: 'replace-all',
      epoch: 1,
      items: [{ stableDomKey: 'table', renderFingerprint: 'v1', block }],
    });
    expect(
      root.querySelector('[data-flow-block-id="overlapped-cell"]')?.getAttribute('data-track-change-source-block'),
    ).toBe('actual-row');
    expect(
      root.querySelector('[data-flow-block-id="actual-cell"]')?.getAttribute('data-track-change-source-block'),
    ).toBe('actual-cell');
    expect(
      root.querySelector('[data-flow-block-id="disabled-cell"]')?.getAttribute('data-track-change-source-block'),
    ).toBeNull();
  });
});
