import { isPlainObject } from './ooxml-z-index.js';

type ListDeltaKind =
  | 'list-add'
  | 'list-remove'
  | 'list-level'
  | 'list-style'
  | 'list-restart'
  | 'indent'
  | 'other-format';

type ListDeltaSide = {
  hasNumPr: boolean;
  numId: string | null;
  ilvl: number | null;
  styleKind: string | null;
};

type ListMemberDelta = {
  kind: ListDeltaKind;
  from: ListDeltaSide;
  to: ListDeltaSide;
  levelDirection?: 'indent' | 'outdent';
  restartAt?: number;
};

type ListDeltaSummary = {
  uniformKind: ListDeltaKind | null;
  counts: Partial<Record<ListDeltaKind, number>>;
};

export type ListReviewDetailLine = { excerpt: string; label: string };

export type ListReviewPresentation = { label: string; detailLines: ListReviewDetailLine[] | null };

type ListReviewPresentationInput = {
  listDeltas?: unknown;
  listDeltaSummary?: unknown;
  memberExcerpts?: readonly string[];
};

const MERGED_LIST_ITEMS_LABEL = 'Merged list items';

const SPLIT_LIST_ITEM_LABEL = 'Split list item';

const LIST_SEMANTIC_KINDS: ReadonlySet<string> = new Set([
  'list-add',
  'list-remove',
  'list-level',
  'list-style',
  'list-restart',
]);

const STYLE_KIND_NOUNS: Readonly<Record<string, string>> = Object.freeze({
  bullet: 'bullets',
  number: 'numbers',
  letter: 'letters',
  roman: 'roman numerals',
  other: 'list',
});

function styleKindNoun(styleKind: string | null | undefined): string | null {
  if (typeof styleKind !== 'string') return null;
  return STYLE_KIND_NOUNS[styleKind] ?? null;
}

function listStyleLabel(deltas: readonly ListMemberDelta[]): string {
  const fromKinds = new Set(deltas.map((delta) => delta.from?.styleKind ?? null));
  const toKinds = new Set(deltas.map((delta) => delta.to?.styleKind ?? null));
  if (fromKinds.size !== 1 || toKinds.size !== 1) return 'Changed list style';
  const fromNoun = styleKindNoun(fromKinds.values().next().value);
  const toNoun = styleKindNoun(toKinds.values().next().value);
  if (!fromNoun || !toNoun || fromNoun === toNoun) return 'Changed list style';
  return `Changed list style: ${fromNoun} → ${toNoun}`;
}

function listRestartLabel(deltas: readonly ListMemberDelta[]): string {
  const restartValues = new Set(deltas.map((delta) => (typeof delta.restartAt === 'number' ? delta.restartAt : null)));
  const only = restartValues.size === 1 ? restartValues.values().next().value : null;
  return only === null ? 'Restarted numbering' : `Restarted numbering at ${only}`;
}

function listMemberVerb(delta: ListMemberDelta): string {
  switch (delta?.kind) {
    case 'list-add':
      return 'Added to list';
    case 'list-remove':
      return 'Removed from list';
    case 'list-level':
      if (delta.levelDirection === 'outdent') return 'Outdented item';
      if (delta.levelDirection === 'indent') return 'Indented item';
      return 'Changed list level';
    case 'list-style':
      return listStyleLabel([delta]);
    case 'list-restart':
      return listRestartLabel([delta]);
    case 'indent':
      return 'Changed indent';
    default:
      return 'Changed formatting';
  }
}

function buildListReviewPresentation(
  input: ListReviewPresentationInput | null | undefined,
): ListReviewPresentation | null {
  const safe: ListReviewPresentationInput = isPlainObject(input) ? input : {};
  const deltas: ListMemberDelta[] = Array.isArray(safe.listDeltas)
    ? (safe.listDeltas.filter((delta) => isPlainObject(delta)) as ListMemberDelta[])
    : [];
  const summary = isPlainObject(safe.listDeltaSummary) ? (safe.listDeltaSummary as ListDeltaSummary) : null;
  if (deltas.length === 0 || !summary || !isPlainObject(summary.counts)) return null;

  const hasListSemantics = deltas.some((delta) => LIST_SEMANTIC_KINDS.has(delta.kind));
  if (!hasListSemantics) return null;

  const memberCount = deltas.length;
  const uniformKind =
    typeof summary.uniformKind === 'string' && deltas.every((delta) => delta.kind === summary.uniformKind)
      ? summary.uniformKind
      : null;

  if (uniformKind === 'list-add') {
    return {
      label: memberCount === 1 ? 'Added to list' : `Added ${memberCount} items to a list`,
      detailLines: null,
    };
  }
  if (uniformKind === 'list-remove') {
    return {
      label: memberCount === 1 ? 'Removed from list' : `Removed ${memberCount} items from list`,
      detailLines: null,
    };
  }
  if (uniformKind === 'list-level') {
    const directions = new Set(deltas.map((delta) => delta.levelDirection ?? null));
    const direction = directions.size === 1 ? directions.values().next().value : null;
    if (direction === 'indent' || direction === 'outdent') {
      const verb = direction === 'indent' ? 'Indented' : 'Outdented';
      return {
        label: memberCount === 1 ? `${verb} item` : `${verb} ${memberCount} items`,
        detailLines: null,
      };
    }
    return buildMixedPresentation(deltas, safe.memberExcerpts);
  }
  if (uniformKind === 'list-style') {
    return { label: listStyleLabel(deltas), detailLines: null };
  }
  if (uniformKind === 'list-restart') {
    return { label: listRestartLabel(deltas), detailLines: null };
  }

  return buildMixedPresentation(deltas, safe.memberExcerpts);
}

function buildMixedPresentation(
  deltas: readonly ListMemberDelta[],
  memberExcerpts: readonly string[] | undefined,
): ListReviewPresentation {
  const excerpts = Array.isArray(memberExcerpts) ? memberExcerpts : [];
  return {
    label: `Changed list formatting (${deltas.length} ${deltas.length === 1 ? 'item' : 'items'})`,
    detailLines: deltas.map((delta, index) => ({
      excerpt: typeof excerpts[index] === 'string' ? excerpts[index] : '',
      label: listMemberVerb(delta),
    })),
  };
}

export function trackedChangeListPresentation(change: unknown): ListReviewPresentation | null {
  if (!isPlainObject(change)) return null;
  const { type, subtype } = change;
  const mergesItems = change.listActionKind === 'merge-items';
  if ((type === 'deletion' || type === 'delete') && mergesItems && subtype !== 'page-break-deletion') {
    return { label: MERGED_LIST_ITEMS_LABEL, detailLines: null };
  }
  if (type === 'structural' && subtype === 'paragraph-mark-deletion' && mergesItems) {
    return { label: MERGED_LIST_ITEMS_LABEL, detailLines: null };
  }
  if (type === 'structural' && subtype === 'paragraph-mark-insertion' && change.targetIsListItem === true) {
    return { label: SPLIT_LIST_ITEM_LABEL, detailLines: null };
  }
  if (type === 'formatting' || type === 'format') {
    return buildListReviewPresentation({
      listDeltas: change.listDeltas,
      listDeltaSummary: change.listDeltaSummary,
      memberExcerpts: typeof change.excerpt === 'string' ? change.excerpt.split('\n') : [],
    });
  }
  return null;
}
