import { Session } from 'node:inspector';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it } from 'vite-plus/test';
import type { FlowBlock, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { computeDirtyRegions } from '../src/diff.js';
import { incrementalLayout, measureCache } from '../src/incrementalLayout.js';

const options = {
  pageSize: { w: 200, h: 300 },
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
};

function blocks(text: string): ParagraphBlock[] {
  return Array.from({ length: 3 }, (_, index) => ({
    kind: 'paragraph',
    id: `paragraph-${index}`,
    runs: [{ text: index === 0 ? text : `Stable ${index}`, fontFamily: 'Arial', fontSize: 12 }],
  }));
}

async function measure(block: FlowBlock): Promise<ParagraphMeasure> {
  if (block.kind !== 'paragraph') throw new Error('Expected paragraph');
  const run = block.runs[0]!;
  return {
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 'text' in run ? run.text.length : 0,
        width: 40,
        ascent: 10,
        descent: 2,
        lineHeight: 12,
      },
    ],
    totalHeight: 12,
  };
}

async function edit(
  previousBlocks: ParagraphBlock[],
  previous: Awaited<ReturnType<typeof incrementalLayout>>,
  text: string,
) {
  const next = blocks(text);
  const index = new Map(next.map((block, ordinal) => [block.id, ordinal]));
  return incrementalLayout(
    previousBlocks,
    previous.layout,
    next,
    options,
    measure,
    undefined,
    previous.measures,
    undefined,
    undefined,
    undefined,
    {
      dependencyProof: {
        profile: 'single-section-local-text',
        blockIdsUnchanged: true,
        blockIdsUnique: true,
        globalDependenciesAbsent: true,
        renderInputsUnchanged: true,
        pageReferencesAbsent: true,
      },
      provedDirtyRegion: computeDirtyRegions(previousBlocks, next),
      previousBlockIndexById: index,
      currentBlockIndexById: index,
    },
  );
}

afterEach(() => measureCache.clear());

it('releases replaced cold and intermediate measurements while the current plane stays live', async () => {
  const retained = await (async () => {
    const original = blocks('Before');
    const cold = await incrementalLayout([], null, original, options, measure);
    const first = await edit(original, cold, 'After');
    const current = await edit(blocks('After'), first, 'Again');
    expect(current.measureReuse?.mode).toBe('proved-dirty-only');
    expect(current.measures[2]).toBe(cold.measures[2]);
    return {
      current,
      cold: new WeakRef(cold.measures[0]!),
      intermediate: new WeakRef(first.measures[0]!),
      collectibleControl: new WeakRef({}),
    };
  })();
  measureCache.clear();
  const session = new Session();
  session.connect();
  try {
    for (let turn = 0; turn < 5; turn += 1) {
      await setImmediate();
      await new Promise<void>((resolve, reject) => {
        session.post('HeapProfiler.collectGarbage', (error) => (error ? reject(error) : resolve()));
      });
    }
    expect(retained.collectibleControl.deref()).toBeUndefined();
    expect(retained.intermediate.deref()).toBeUndefined();
    expect(retained.cold.deref()).toBeUndefined();
    expect(retained.current.measures[0]?.kind).toBe('paragraph');
    expect(retained.current.measures).toHaveLength(3);
  } finally {
    session.disconnect();
  }
});

it('preserves cold writes and dense array operations across immutable successors', async () => {
  const original = blocks('Before');
  const cold = await incrementalLayout([], null, original, options, measure);
  const replacement = { ...cold.measures[1]! };
  cold.measures[1] = replacement;
  const current = await edit(original, cold, 'After');
  expect(current.measureReuse?.mode).toBe('proved-dirty-only');
  expect(current.measures[1]).toBe(replacement);
  expect(Array.isArray(current.measures)).toBe(true);
  expect([...current.measures]).toEqual(current.measures.slice());
  expect(current.measures.map((value) => value.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  expect(Object.keys(current.measures)).toEqual(['0', '1', '2']);
  expect(Object.getOwnPropertyDescriptor(current.measures, '1')?.value).toBe(replacement);
  expect(2 in current.measures).toBe(true);
  expect(3 in current.measures).toBe(false);
  cold.measures[1] = { ...replacement };
  expect(current.measures[1]).toBe(replacement);
  Object.defineProperty(current.measures, '1', { configurable: false, writable: false });
  expect(current.measures[1]).toBe(replacement);
  Object.freeze(current.measures);
  expect(Object.isFrozen(current.measures)).toBe(true);
  expect(current.measures[1]).toBe(replacement);
  const next = await edit(blocks('After'), current, 'Again');
  expect(next.measures[1]).toBe(replacement);
  expect(next.measures[0]).not.toBe(current.measures[0]);
});

it.each(['length', 'accessor', 'frozen'] as const)(
  'captures current cold entries after %s changes',
  async (scenario) => {
    const original = blocks('Before');
    const cold = await incrementalLayout([], null, original, options, measure);
    const replacement = { ...cold.measures[2]! };
    if (scenario === 'length') {
      cold.measures.length = 2;
      cold.measures.push(replacement);
      delete cold.measures[1];
      cold.measures[1] = replacement;
    } else if (scenario === 'accessor') {
      Object.defineProperty(cold.measures, '2', { get: () => replacement });
    } else {
      cold.measures[2] = replacement;
      Object.freeze(cold.measures);
    }
    const current = await edit(original, cold, 'After');
    expect(current.measureReuse?.mode).toBe('proved-dirty-only');
    expect(current.measures).toHaveLength(3);
    expect(current.measures[2]).toBe(replacement);
    expect(current.measures[0]).not.toBe(cold.measures[0]);
  },
);
