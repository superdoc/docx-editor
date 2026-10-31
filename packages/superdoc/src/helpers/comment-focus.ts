type ClientRectSource = { getBoundingClientRect?: () => { top: number } };

type ThreadPositionEntry = { bounds?: { top?: number } | null } | null | undefined;

type ThreadAnchorPresentation = {
  getReachableThreadAnchorClientY: (threadId: string, targetClientY: number) => number | null | undefined;
  scrollThreadAnchorToClientY: (
    threadId: string,
    targetClientY: number,
    options: { behavior: ScrollBehavior },
  ) => boolean | null | undefined;
};

const COMMENT_FOCUS_VIEWPORT_RATIO = 0.38;
const COMMENT_HIGHLIGHT_SELECTOR = '.superdoc-comment-highlight';
const isElementVisibleInViewport = (element: Element) => {
  if (typeof element?.getBoundingClientRect !== 'function') return false;

  const bounds = element.getBoundingClientRect();
  if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom)) {
    return false;
  }

  return bounds.bottom > 0 && bounds.top < window.innerHeight;
};

const parseCommaSeparated = (value: string | null): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseImportedIdMap = (value: string | null): string[] => {
  const ids: string[] = [];
  if (!value) return ids;

  value.split(',').forEach((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) return;

    ids.push(entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1));
  });

  return ids.filter(Boolean);
};

export const getPreferredCommentFocusTargetClientY = (): number => {
  return Math.round(window.innerHeight * COMMENT_FOCUS_VIEWPORT_RATIO);
};

export const getVisibleThreadAnchorClientY = (
  layersElement: ClientRectSource | null | undefined,
  positionEntry: ThreadPositionEntry,
): number | null => {
  const anchorTop = positionEntry?.bounds?.top;
  if (typeof anchorTop !== 'number' || !Number.isFinite(anchorTop)) return null;
  if (typeof layersElement?.getBoundingClientRect !== 'function') return null;

  const anchorClientY = layersElement.getBoundingClientRect().top + anchorTop;
  if (anchorClientY < 0 || anchorClientY >= window.innerHeight) {
    return null;
  }

  return anchorClientY;
};

export const getVisibleThreadHighlightClientY = (
  threadIds: ReadonlyArray<string | number | null | undefined> | null | undefined,
): number | null => {
  if (typeof document === 'undefined') return null;

  const candidateIds = new Set((threadIds ?? []).map((id) => String(id)).filter(Boolean));
  if (candidateIds.size === 0) return null;

  let visibleTop: number | null = null;
  const highlights = document.querySelectorAll(COMMENT_HIGHLIGHT_SELECTOR);

  for (const highlight of Array.from(highlights)) {
    const highlightIds = new Set([
      ...parseCommaSeparated(highlight.getAttribute('data-comment-ids')),
      ...parseImportedIdMap(highlight.getAttribute('data-comment-imported-ids')),
    ]);

    const matchesThread = [...candidateIds].some((id) => highlightIds.has(id));
    if (!matchesThread) continue;
    if (!isElementVisibleInViewport(highlight)) continue;

    const highlightTop = highlight.getBoundingClientRect().top;
    if (!Number.isFinite(highlightTop)) continue;

    visibleTop = visibleTop == null ? highlightTop : Math.min(visibleTop, highlightTop);
  }

  return visibleTop;
};

export const scrollThreadAnchorToFocusTarget = (
  presentation: ThreadAnchorPresentation | null | undefined,
  primaryThreadId: string | null | undefined,
  fallbackThreadId: string | null | undefined,
  targetClientY: number | null | undefined,
): number | null => {
  if (!presentation || typeof targetClientY !== 'number' || !Number.isFinite(targetClientY)) return null;

  const tryThread = (threadId: string | null | undefined): number | null => {
    if (!threadId) return null;

    const reachableClientY = presentation.getReachableThreadAnchorClientY(threadId, targetClientY);
    if (typeof reachableClientY !== 'number' || !Number.isFinite(reachableClientY)) return null;

    const didResolveThread = presentation.scrollThreadAnchorToClientY(threadId, targetClientY, { behavior: 'auto' });
    return didResolveThread ? reachableClientY : null;
  };

  const primaryTargetY = tryThread(primaryThreadId);
  if (primaryTargetY !== null) {
    return primaryTargetY;
  }

  if (!fallbackThreadId || fallbackThreadId === primaryThreadId) {
    return null;
  }

  return tryThread(fallbackThreadId);
};
