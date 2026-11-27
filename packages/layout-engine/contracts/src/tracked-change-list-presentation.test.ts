import { describe, expect, it } from 'vite-plus/test';
import { trackedChangeListPresentation } from './tracked-change-list-presentation.js';

type Side = { hasNumPr: boolean; numId: string | null; ilvl: number | null; styleKind: string | null };
type Member = { kind: string; from?: Side; to?: Side; levelDirection?: string; restartAt?: number };

const unlisted: Side = { hasNumPr: false, numId: null, ilvl: null, styleKind: null };
const numbered: Side = { hasNumPr: true, numId: '1', ilvl: 0, styleKind: 'number' };

function member(kind: string, extra: Omit<Member, 'kind'> = {}): Member {
  return { kind, from: unlisted, to: numbered, ...extra };
}

function style(from: string | null, to: string | null): Member {
  return member('list-style', {
    from: { hasNumPr: true, numId: '1', ilvl: 0, styleKind: from },
    to: { hasNumPr: true, numId: '2', ilvl: 0, styleKind: to },
  });
}

function formatting(members: Member[], excerpt?: string) {
  const counts: Record<string, number> = {};
  for (const { kind } of members) counts[kind] = (counts[kind] ?? 0) + 1;
  const kinds = Object.keys(counts);
  return {
    type: 'formatting',
    subtype: 'list-formatting',
    listDeltas: members,
    listDeltaSummary: { uniformKind: kinds.length === 1 ? kinds[0] : null, counts },
    ...(excerpt === undefined ? {} : { excerpt }),
  };
}

const CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['split inside a list', { type: 'structural', subtype: 'paragraph-mark-insertion', targetIsListItem: true }],
  ['split outside a list', { type: 'structural', subtype: 'paragraph-mark-insertion', targetIsListItem: false }],
  ['split not inspected', { type: 'structural', subtype: 'paragraph-mark-insertion' }],
  [
    'merge as paragraph-mark deletion',
    { type: 'structural', subtype: 'paragraph-mark-deletion', listActionKind: 'merge-items' },
  ],
  ['paragraph-mark deletion without merge', { type: 'structural', subtype: 'paragraph-mark-deletion' }],
  ['merge as text deletion', { type: 'deletion', listActionKind: 'merge-items', deletedText: 'Bravo' }],
  ['merge on a legacy delete', { type: 'delete', listActionKind: 'merge-items' }],
  [
    'merge on a page-break deletion',
    { type: 'deletion', subtype: 'page-break-deletion', listActionKind: 'merge-items' },
  ],
  [
    'merge fact on another structural change',
    { type: 'structural', subtype: 'list-item-deletion', listActionKind: 'merge-items' },
  ],
  ['plain deletion', { type: 'deletion', deletedText: 'Bravo' }],
  ['plain insertion', { type: 'insertion', insertedText: 'Delta' }],
  ['one item added to a list', formatting([member('list-add')])],
  ['three items added to a list', formatting([member('list-add'), member('list-add'), member('list-add')])],
  ['one item removed from a list', formatting([member('list-remove')])],
  ['two items removed from a list', formatting([member('list-remove'), member('list-remove')])],
  ['legacy format type', { ...formatting([member('list-remove')]), type: 'format' }],
  ['one item indented', formatting([member('list-level', { levelDirection: 'indent' })])],
  [
    'two items outdented',
    formatting([
      member('list-level', { levelDirection: 'outdent' }),
      member('list-level', { levelDirection: 'outdent' }),
    ]),
  ],
  [
    'items indented and outdented',
    formatting(
      [member('list-level', { levelDirection: 'indent' }), member('list-level', { levelDirection: 'outdent' })],
      'first item\nsecond item',
    ),
  ],
  ['list level without direction', formatting([member('list-level')], 'only item')],
  ['numbers to bullets', formatting([style('number', 'bullet')])],
  ['letters to roman numerals', formatting([style('letter', 'roman')])],
  ['other list to numbers', formatting([style('other', 'number')])],
  ['numbers to numbers', formatting([style('number', 'number')])],
  ['unresolved from style', formatting([style(null, 'bullet')])],
  ['unresolved to style', formatting([style('number', null)])],
  ['other to other', formatting([style('other', 'other')])],
  ['unknown style kind', formatting([style('unknown', 'bullet')])],
  ['members with different from styles', formatting([style('number', 'bullet'), style('letter', 'bullet')])],
  ['restart at 1', formatting([member('list-restart', { restartAt: 1 })])],
  ['restart at 5', formatting([member('list-restart', { restartAt: 5 })])],
  ['restart without a value', formatting([member('list-restart')])],
  [
    'restarts at different values',
    formatting([member('list-restart', { restartAt: 1 }), member('list-restart', { restartAt: 3 })]),
  ],
  [
    'style change and added item',
    formatting([style('number', 'number'), member('list-add')], 'Second existing item\nNew plain paragraph'),
  ],
  [
    'added item and other formatting, one excerpt',
    formatting([member('list-add'), member('other-format')], 'only first'),
  ],
  ['named style on a detail line', formatting([style('number', 'bullet'), member('list-add')], 'a\nb')],
  [
    'every member verb',
    formatting(
      [
        member('list-add'),
        member('list-remove'),
        member('list-level', { levelDirection: 'indent' }),
        member('list-level', { levelDirection: 'outdent' }),
        member('list-level'),
        style('number', 'bullet'),
        style('other', 'number'),
        member('list-restart', { restartAt: 1 }),
        member('indent'),
        member('other-format'),
        member('mystery'),
      ],
      'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk',
    ),
  ],
  ['one indent', formatting([member('indent')])],
  ['two indents', formatting([member('indent'), member('indent')])],
  ['other formatting', formatting([member('other-format')])],
  ['indent and other formatting', formatting([member('indent'), member('other-format')])],
  ['unknown member kind', formatting([member('list-teleport')])],
  ['formatting without list facts', { type: 'formatting', formattingDeltaSummary: 'Bold' }],
  ['list deltas without a summary', { type: 'formatting', listDeltas: [member('list-add')] }],
  [
    'summary without list deltas',
    { type: 'formatting', listDeltaSummary: { uniformKind: 'list-add', counts: { 'list-add': 1 } } },
  ],
  ['empty list deltas', { type: 'formatting', listDeltas: [], listDeltaSummary: { uniformKind: null, counts: {} } }],
  ['null', null],
  ['array', []],
];

function describeCase([name, change]: readonly [string, unknown]): string {
  const presentation = trackedChangeListPresentation(change);
  const lines = [`## ${name}`, `label: ${presentation?.label ?? '(none)'}`];
  for (const line of presentation?.detailLines ?? []) lines.push(`  "${line.excerpt}" — ${line.label}`);
  return lines.join('\n');
}

describe('trackedChangeListPresentation', () => {
  it('records the review-card label for each list change', async () => {
    await expect(`${CASES.map(describeCase).join('\n\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/tracked-change-list-presentation/labels.txt',
    );
  });

  it('never uses the generic formatting copy for a list change', () => {
    for (const [, change] of CASES) {
      const presentation = trackedChangeListPresentation(change);
      const text = [presentation?.label, ...(presentation?.detailLines ?? []).map((line) => line.label)].join(' ');
      expect(text).not.toMatch(/Formatted:|Format: |numbering change:/i);
    }
  });
});
