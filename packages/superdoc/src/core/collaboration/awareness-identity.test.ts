import { describe, expect, it } from 'vite-plus/test';

import { awarenessStatesToArray } from '@superdoc/common/collaboration/awareness';

const makeContext = () => ({
  userColorMap: new Map(),
  colorIndex: 0,
  config: {
    colors: ['#111111', '#222222', '#333333'],
  },
});

describe('awareness identity dedupe', () => {
  it('keeps same-email different-id actors as separate presence entries', () => {
    const states = new Map([
      [1, { user: { id: 'alice-id', email: 'shared@example.com', name: 'Alice' } }],
      [2, { user: { id: 'bob-id', email: 'shared@example.com', name: 'Bob' } }],
    ]);

    const result = awarenessStatesToArray(makeContext(), states);

    expect(result).toHaveLength(2);
    expect(result.map((user) => user.id)).toEqual(['alice-id', 'bob-id']);
  });

  it('dedupes multiple sessions for the same actor id even when emails differ', () => {
    const states = new Map([
      [1, { user: { id: 'alice-id', email: 'alice@example.com', name: 'Alice' } }],
      [2, { user: { id: 'alice-id', email: 'alias@example.com', name: 'Alice (Laptop)' } }],
    ]);

    const result = awarenessStatesToArray(makeContext(), states);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('alice-id');
  });
});
