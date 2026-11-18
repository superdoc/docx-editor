import { describe, expect, it } from 'vite-plus/test';

import { resolveV2ReviewTargetCommentId } from './v2-review-target.js';

const MOVE = 'tc|body|move|pair1';
const FROM = `${MOVE}::move-from`;
const TO = `${MOVE}::move-to`;

type Row = { trackedChange: boolean; commentId: string; trackedChangeCanonicalId?: string };

const rowsById = (rows: Row[]) => (id: string) => rows.find((row) => row.commentId === id) ?? null;

const moveSideRows: Row[] = [
  { trackedChange: true, commentId: FROM, trackedChangeCanonicalId: MOVE },
  { trackedChange: true, commentId: TO, trackedChangeCanonicalId: MOVE },
];

describe('v2 review target move-side activation', () => {
  it('activates the source row when the painted target is the move source', () => {
    expect(
      resolveV2ReviewTargetCommentId(
        { entityType: 'trackedChange', entityId: MOVE, paintedEntityId: FROM },
        rowsById(moveSideRows),
      ),
    ).toBe(FROM);
  });

  it('activates the destination row when the painted target is the move destination', () => {
    expect(
      resolveV2ReviewTargetCommentId(
        { entityType: 'trackedChange', entityId: MOVE, paintedEntityId: TO },
        rowsById(moveSideRows),
      ),
    ).toBe(TO);
  });

  it('keeps the canonical id while the painted side row is not hydrated', () => {
    expect(
      resolveV2ReviewTargetCommentId(
        { entityType: 'trackedChange', entityId: MOVE, paintedEntityId: FROM },
        () => null,
      ),
    ).toBe(MOVE);
  });

  it('ignores a painted row that belongs to a different canonical change', () => {
    const rows: Row[] = [
      { trackedChange: true, commentId: 'member-1', trackedChangeCanonicalId: 'other-group' },
      { trackedChange: true, commentId: 'group-1' },
    ];
    expect(
      resolveV2ReviewTargetCommentId(
        { entityType: 'trackedChange', entityId: 'group-1', paintedEntityId: 'member-1' },
        rowsById(rows),
      ),
    ).toBe('group-1');
  });

  it('ignores a painted id that only resolves through another row alias', () => {
    const aliasRow: Row = { trackedChange: true, commentId: 'row-1', trackedChangeCanonicalId: 'group-1' };
    expect(
      resolveV2ReviewTargetCommentId(
        { entityType: 'trackedChange', entityId: 'group-1', paintedEntityId: 'fragment-1' },
        (id) => (id === 'fragment-1' ? aliasRow : null),
      ),
    ).toBe('group-1');
  });
});
