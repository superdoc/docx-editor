/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vite-plus/test';
import {
  createInteractionHistory,
  closeInteractionHistory,
  recordInteraction,
  isWorkflowRecordingEnabled,
} from './interaction-history.js';

const owners: object[] = [];
afterEach(() => {
  for (const owner of owners.splice(0)) closeInteractionHistory(owner);
  vi.restoreAllMocks();
});

function fixture() {
  const owner = {};
  owners.push(owner);
  const root = document.createElement('div');
  return {
    owner,
    root,
    api: createInteractionHistory(
      owner,
      { diagnostics: { history: { enabled: false }, recording: { enabled: true } } },
      () => 'test',
      root,
    ) as Required<ReturnType<typeof createInteractionHistory>>,
  };
}
it('records exact source addresses independently of disabled rolling history and returns detached data', () => {
  const { owner, api } = fixture();
  expect(api.recording.getSnapshot()).toBeNull();
  api.recording.start();
  expect(() => api.recording.start()).toThrow();
  recordInteraction(owner, 'interaction:intent', () => ({
    phase: 'executing',
    selectionLineageId: 'l1',
    intentSequence: 3,
    timing: { selectionTargetMs: 1, textReplaceMs: 2, postEditSelectionMs: 3, totalMs: 6 },
    selectionBefore: {
      story: { storyType: 'header', refId: 'r1' },
      focus: {
        blockId: 'p1',
        blockOffset: 7,
        position: { anchor: { nativeId: 'p1', partId: 'word/header1.xml' }, offset: { unit: 'body-child', value: 0 } },
      },
    },
  }));
  const stopped = api.recording.stop()!;
  expect(api.recording.active).toBe(false);
  expect(stopped.events[1].data).toMatchObject({
    intentSequence: 3,
    timing: { totalMs: 6, textReplaceMs: 2 },
    selectionBefore: { focus: { blockOffset: 7, position: { anchor: { nativeId: 'p1' }, offset: { value: 0 } } } },
  });
  stopped.events[1].data.intentSequence = 999;
  expect(api.recording.getSnapshot()!.events[1].data.intentSequence).toBe(3);
  expect(api.getSnapshot().events).toEqual([]);
  api.recording.start();
  expect(api.recording.getSnapshot()!.events).toHaveLength(1);
  closeInteractionHistory(owner);
  expect(api.recording.stop()!.status).toBe('incomplete');
  expect(() => api.recording.start()).toThrow('destroyed');
});
it('never evicts or silently truncates a replay session', () => {
  const { owner, api } = fixture();
  api.recording.start({ maxEvents: 2 });
  recordInteraction(owner, 'interaction:commit', () => ({ txId: 'tx1' }));
  recordInteraction(owner, 'interaction:commit', () => ({ txId: 'tx2' }));
  const result = api.recording.stop()!;
  expect(result.status).toBe('incomplete');
  expect(result.replayUnsupportedReasons).toContain('capture-limit');
  expect(result.events[1].data.txId).toBe('tx1');
});
it('does not execute getters or toJSON, and keeps content opt-in', () => {
  const { owner, api } = fixture();
  const getter = vi.fn(() => {
    throw new Error('getter');
  });
  const value = { text: 'private', value: 'secret', offset: { value: 3 }, toJSON: getter };
  Object.defineProperty(value, 'message', { get: getter });
  api.recording.start();
  recordInteraction(owner, 'command:started', () => value);
  expect(JSON.stringify(api.recording.stop())).not.toContain('secret');
  expect(getter).not.toHaveBeenCalled();
  api.recording.start({ captureContent: true });
  recordInteraction(owner, 'command:started', () => value);
  expect(JSON.stringify(api.recording.stop())).toContain('private');
  expect(getter).not.toHaveBeenCalled();
});
it('ignores synthetic inputs and marks projection failure incomplete without throwing into the editor', () => {
  const { owner, root, api } = fixture();
  api.recording.start({ captureContent: true });
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
  expect(api.recording.getSnapshot()!.events).toHaveLength(1);
  recordInteraction(owner, 'interaction:intent', () => {
    throw new Error('capture failed');
  });
  expect(api.recording.stop()!.replayUnsupportedReasons).toContain('capture-failure');
});
it('keeps recording sessions local to each instance', () => {
  const first = fixture();
  const second = fixture();
  first.api.recording.start();
  second.api.recording.start();
  recordInteraction(first.owner, 'interaction:commit', () => ({ txId: 'first-only' }));
  expect(JSON.stringify(second.api.recording.stop())).not.toContain('first-only');
  expect(JSON.stringify(first.api.recording.stop())).toContain('first-only');
  closeInteractionHistory(first.owner);
  closeInteractionHistory(second.owner);
});

it.each([undefined, { enabled: false }, { enabled: 'true' }, { enabled: 1 }])(
  'fully bypasses workflow recording without an exact true config flag: %j',
  (recording) => {
    const owner = {};
    owners.push(owner);
    const root = document.createElement('div');
    const windowAccess = vi.spyOn(root, 'ownerDocument', 'get').mockImplementation(() => {
      throw new Error('disabled recording must not inspect the browser');
    });
    const api = createInteractionHistory(
      owner,
      { diagnostics: { history: { enabled: false }, recording } },
      () => 'test',
      root,
    );
    const read = vi.fn(() => {
      throw new Error('disabled payload');
    });
    recordInteraction(owner, 'interaction:intent', read);
    expect(api).not.toHaveProperty('recording');
    expect(windowAccess).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(api.getSnapshot().captureFailures).toBe(0);
  },
);

it('attaches input listeners only while explicitly recording, including restart, limit and destroy', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const { owner, api } = fixture();
  expect(add).not.toHaveBeenCalled();
  api.recording.start();
  expect(add).toHaveBeenCalledTimes(17);
  api.recording.stop();
  expect(remove).toHaveBeenCalledTimes(17);
  api.recording.start({ maxEvents: 1 });
  recordInteraction(owner, 'interaction:commit', () => ({ txId: 'limit' }));
  expect(api.recording.active).toBe(false);
  expect(remove).toHaveBeenCalledTimes(34);
  api.recording.start();
  closeInteractionHistory(owner);
  expect(remove).toHaveBeenCalledTimes(51);
});

it('cleans up partial listener setup failure and leaves normal history working', () => {
  const original = window.addEventListener;
  let registrations = 0;
  const add = vi.spyOn(window, 'addEventListener').mockImplementation(function (...args) {
    if (++registrations === 3) throw new Error('listener setup failure');
    return original.apply(this, args);
  });
  const remove = vi.spyOn(window, 'removeEventListener');
  const owner = {};
  owners.push(owner);
  const api = createInteractionHistory(
    owner,
    { diagnostics: { recording: { enabled: true } } },
    () => 'test',
    document.createElement('div'),
  );
  expect(add).not.toHaveBeenCalled();
  expect(() => api.recording!.start()).not.toThrow();
  expect(api.recording!.active).toBe(false);
  expect(api.recording!.getSnapshot()!.status).toBe('incomplete');
  expect(remove).toHaveBeenCalledTimes(2);
  recordInteraction(owner, 'mutation:committed', () => ({ txId: 'normal-operation' }));
  expect(api.getSnapshot().events.some((event) => event.data.txId === 'normal-operation')).toBe(true);
});

it('fails closed on broken internal configuration without invoking getters', () => {
  const getter = vi.fn(() => {
    throw new Error('must not call getter');
  });
  const diagnostics = Object.defineProperty({}, 'recording', { get: getter });
  expect(isWorkflowRecordingEnabled({ diagnostics })).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(
    isWorkflowRecordingEnabled({
      diagnostics: {
        recording: new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error('broken internal config');
            },
          },
        ),
      },
    }),
  ).toBe(false);
});
