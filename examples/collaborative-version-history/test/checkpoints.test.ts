import assert from 'node:assert/strict';
import test from 'node:test';
import { createCheckpointScheduler, type CheckpointPolicy } from '../src/server/checkpoints.ts';
import type { CheckpointTrigger } from '../src/server/version-store.ts';

function scheduler(policy: Partial<CheckpointPolicy>, fail = false) {
  const fired: Array<[string, CheckpointTrigger]> = [];
  const logs: string[] = [];
  const instance = createCheckpointScheduler({
    policy: { idleMs: null, maxIntervalMs: null, whenLastEditorLeaves: false, ...policy },
    checkpoint: async (documentId, trigger) => {
      fired.push([documentId, trigger]);
      if (fail) throw new Error('storage is down');
    },
    log: (message) => logs.push(message),
  });
  return { instance, fired, logs };
}

test('an idle checkpoint waits for edits to stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { instance, fired } = scheduler({ idleMs: 1_000 });
  instance.roomChanged('contract');
  t.mock.timers.tick(900);
  instance.roomChanged('contract');
  t.mock.timers.tick(900);
  assert.deepEqual(fired, []);
  t.mock.timers.tick(100);
  assert.deepEqual(fired, [['contract', 'idle']]);
});

test('continuous editing still checkpoints at the maximum interval', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { instance, fired } = scheduler({ idleMs: 1_000, maxIntervalMs: 5_000 });
  for (let elapsed = 0; elapsed < 5_000; elapsed += 500) {
    instance.roomChanged('contract');
    t.mock.timers.tick(500);
  }
  assert.deepEqual(fired, [['contract', 'interval']]);
});

test('the last editor leaving checkpoints only unsaved edits', () => {
  const { instance, fired } = scheduler({ whenLastEditorLeaves: true });
  instance.roomEmptied('contract');
  assert.deepEqual(fired, []);
  instance.roomChanged('contract');
  instance.roomEmptied('contract');
  instance.roomEmptied('contract');
  assert.deepEqual(fired, [['contract', 'last-editor-left']]);
});

test('a named save resets the automatic schedule', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { instance, fired } = scheduler({ idleMs: 1_000, whenLastEditorLeaves: true });
  instance.roomChanged('contract');
  instance.checkpointed('contract', instance.changeCount('contract'));
  t.mock.timers.tick(2_000);
  instance.roomEmptied('contract');
  assert.deepEqual(fired, []);
});

test('a named save keeps edits made after its snapshot pending', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { instance, fired } = scheduler({ idleMs: 1_000, whenLastEditorLeaves: true });
  instance.roomChanged('contract');
  const inSnapshot = instance.changeCount('contract');
  instance.roomChanged('contract');
  instance.checkpointed('contract', inSnapshot);
  assert.deepEqual(instance.pending(), ['contract']);
  t.mock.timers.tick(1_000);
  assert.deepEqual(fired, [['contract', 'idle']]);
});

test('after a failed checkpoint, continuous editing reaches the maximum interval again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let failures = 1;
  const fired: CheckpointTrigger[] = [];
  const instance = createCheckpointScheduler({
    policy: { idleMs: null, maxIntervalMs: 1_000, whenLastEditorLeaves: false },
    checkpoint: async (_documentId, trigger) => {
      fired.push(trigger);
      if (failures-- > 0) throw new Error('storage is down');
    },
    log: () => {},
  });
  instance.roomChanged('contract');
  t.mock.timers.tick(1_000);
  await new Promise((resolve) => setImmediate(resolve));
  for (let elapsed = 0; elapsed < 1_000; elapsed += 250) {
    instance.roomChanged('contract');
    t.mock.timers.tick(250);
  }
  assert.deepEqual(fired, ['interval', 'interval']);
});

test('a failed checkpoint keeps the room pending for the next trigger', async () => {
  const { instance, fired, logs } = scheduler({ whenLastEditorLeaves: true }, true);
  instance.roomChanged('contract');
  instance.roomEmptied('contract');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(instance.pending(), ['contract']);
  assert.match(logs[0] ?? '', /storage is down/);
  instance.roomEmptied('contract');
  assert.equal(fired.length, 2);
});

test('stopping checkpoints pending rooms once, then ignores changes', async () => {
  const { instance, fired } = scheduler({});
  instance.roomChanged('contract');
  await instance.stop();
  instance.roomChanged('contract');
  instance.roomEmptied('contract');
  assert.deepEqual(fired, [['contract', 'shutdown']]);
});
