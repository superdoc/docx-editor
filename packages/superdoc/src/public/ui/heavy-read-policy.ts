import type { SliceStatus } from './types.js';

export interface HeavyDocReadPolicyEntry {
  key: string;
  match: 'exact' | 'prefix';
  note: string;
}

export const HEAVY_DOC_READ_POLICY: readonly HeavyDocReadPolicyEntry[] = [
  { key: 'contentControls', match: 'exact', note: 'full-document SDT catalog parse (the measured during-load cliff)' },
  {
    key: 'contentControls:inRange:',
    match: 'prefix',
    note: 'same adapter load() as the catalog, issued per settled selection',
  },
  { key: 'hyperlinks:', match: 'prefix', note: 'per-block hyperlink list over the loading story' },
  { key: 'styles:catalog:', match: 'prefix', note: 'WordStyleModel recompile from package bytes' },
  { key: 'comments', match: 'exact', note: 'audited: full comments list; stale-served during load' },
  {
    key: 'trackChanges',
    match: 'exact',
    note: 'audited: shared all-story tracked-changes catalog; stale-served during load',
  },
  {
    key: 'trackChanges:all',
    match: 'exact',
    note: 'audited: current-token validation over the shared all-story catalog; consumers fail closed on non-ready',
  },
  { key: 'tables', match: 'exact', note: 'reserved: full tables catalog' },
  { key: 'sections', match: 'exact', note: 'reserved: full sections list' },
];

export const COMMENTS_CATALOG_PART_URIS: ReadonlySet<string> = new Set([
  '/word/comments.xml',
  '/word/commentsExtended.xml',
  '/word/commentsIds.xml',
]);

export function isHeavyDocReadKey(key: string): boolean {
  return HEAVY_DOC_READ_POLICY.some((entry) =>
    entry.match === 'exact' ? entry.key === key : key.startsWith(entry.key),
  );
}

export const STATUS_RANK: Record<SliceStatus, number> = { ready: 0, stale: 1, pending: 2 };

export function combineStatus(...statuses: readonly SliceStatus[]): SliceStatus {
  let worst: SliceStatus = 'ready';
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  return worst;
}
