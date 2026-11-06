type CommentId = string | number;

export type ReviewCoordinate = {
  documentEpoch: string;
  mountId: string;
  commitSequence: number;
  reviewVersion: number;
};

export type ReviewPositionEntry = {
  pageIndex?: number | null;
  bounds?: { top?: number; bottom?: number } | null;
};

export type ReviewInstance = {
  id: string;
  rowId: string;
  threadId: string;
  pageIndex: number | null;
  positionKey: string | null;
  positionEntry: ReviewPositionEntry | null;
  anchorTop: number;
  anchorBottom: number;
  top: number;
  height: number;
  provisional?: boolean;
  isPrimary: boolean;
  isOffscreenReviewCard: boolean;
  mount: boolean;
};

export type DecisionContinuityRequest = ReviewCoordinate & {
  removedInstanceId: string;
  removedRowVersion: number;
  targetInstanceId: string;
  targetRowVersion: number;
  top: number;
};

export type ViewportRange = { top: number; bottom: number };

export type ReviewViewport = ViewportRange & {
  width: number;
  scale: number;
  stageOffsetX: number;
  stageOffsetY: number;
};

export type ReviewContextInput = {
  decisionContinuity: DecisionContinuityRequest | null;
  activeThreadId: string | null;
  activeInstanceId: string | null;
  editingRowId: string | null;
  retainedThreadIds: string[];
  visibility: { comments: boolean; trackedChanges: boolean };
  viewport: ReviewViewport;
  pending: { anchorTop: number | null; height: number } | null;
  measurements: { instanceId: string; rowVersion: number; height: number; fontRevision?: number }[];
};

export type CommittedReviewPresentation = {
  catalogVersion?: number;
  epoch: string;
  baseVersion: number;
  version: number;
  unchanged: boolean;
  fontRevision?: number;
  coordinate: ReviewCoordinate;
  instances: ReviewInstance[];
  rowVersions: Record<string, number | undefined>;
  groupOrder: { open: readonly CommentId[]; resolved: readonly CommentId[] };
  readPaintOrigin?: () => { left: number; top: number } | null;
  readFontRevision?: () => number;
  updateContext: (input: ReviewContextInput, readViewport?: () => ReviewViewport | null) => void;
};
