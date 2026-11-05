import type { StoryLocator } from '../types/story.types.js';

export type ChangeCause = 'user' | 'api' | 'undo' | 'redo';

export type ChangeProvenance = 'authored' | 'declared' | 'relayed' | 'unknown';

export type ChangeOrigin = 'local' | 'remote';

export type ChangeActorType = 'human' | 'code';

export type ChangesIdentityState = 'configured' | 'missing';

export type ChangeSidecarKind = 'comment' | 'trackedChange' | 'bookmark';

export interface ChangeActor {
  id: string | null;
  name?: string;
  email?: string;
  claim?: string;
}

export interface ChangeTextRange {
  start: number;
  end: number;
}

export interface TextBlockChange {
  kind: 'text';
  story: StoryLocator;
  blockId: string;
  range: ChangeTextRange;
  inserted: string;
  deleted: string;
}

export interface FormatBlockChange {
  kind: 'format';
  story: StoryLocator;
  blockId: string;
  range: ChangeTextRange;
  attributes: Record<string, unknown>;
}

export interface ParagraphBlockChange {
  kind: 'paragraph';
  story: StoryLocator;
  blockId: string;
  properties: Record<string, unknown>;
}

export interface SplitBlockChange {
  kind: 'split';
  story: StoryLocator;
  blockId: string;
  tailBlockId: string;
  offset: number;
}

export interface MergeBlockChange {
  kind: 'merge';
  story: StoryLocator;
  blockId: string;
  mergedBlockId: string;
}

export interface MoveBlockChange {
  kind: 'move';
  story: StoryLocator;
  blockId: string;
  afterBlockId: string | null;
}

export interface CreateBlockChange {
  kind: 'create';
  story: StoryLocator;
  blockId: string;
  text: string;
}

export interface RemoveBlockChange {
  kind: 'remove';
  story: StoryLocator;
  blockId: string;
  text: string;
}

export interface TableBlockChange {
  kind: 'table';
  story: StoryLocator;
  tableId: string;
  detail: Record<string, unknown>;
}

export interface SidecarBlockChange {
  kind: 'sidecar';
  affects: ChangeSidecarKind;
  ids: string[];
}

export type BlockChange =
  | TextBlockChange
  | FormatBlockChange
  | ParagraphBlockChange
  | SplitBlockChange
  | MergeBlockChange
  | MoveBlockChange
  | CreateBlockChange
  | RemoveBlockChange
  | TableBlockChange
  | SidecarBlockChange;

export interface ChangeRecordTimes {
  declared: string | null;
  observed: string;
}

export interface ChangeRecordSession {
  id: string | null;
  clientId: number;
}

export interface ChangeRecord {
  id: string;
  seq: number;
  revision: string;
  origin: ChangeOrigin;
  actor: ChangeActor | null;
  contributors?: ChangeActor[];
  actorType: ChangeActorType | null;
  cause: ChangeCause | null;
  provenance: ChangeProvenance;
  at: ChangeRecordTimes;
  session: ChangeRecordSession;
  changeTag?: string;
  changes: BlockChange[];
  update?: string;
}

export interface ChangesListInput {
  after?: string;
  limit?: number;
  story?: StoryLocator;
  blockId?: string;
  actorId?: string;
  includeUpdate?: boolean;
  waitMs?: number;
}

export interface ChangesListResult {
  items: ChangeRecord[];
  cursor: string | null;
  truncated: boolean;
  identity: ChangesIdentityState;
  collaboration: boolean;
}

export interface ChangesGetInput {
  id: string;
}

export interface ChangesResolveInput {
  blockId: string;
  limit?: number;
}

export interface ChangesResolveResult {
  blockId: string;
  lineage: string[];
  items: ChangeRecord[];
}

export interface ChangesActorBinding {
  clientId: number;
  actorId: string | null;
  name?: string;
  email?: string;
  sessionId: string;
  declaredAt: string;
  claim?: string;
}

export interface ChangesActorsResult {
  items: ChangesActorBinding[];
}

export interface ChangesSnapshotInput {
  includeState?: boolean;
}

export interface ChangesSnapshotResult {
  revision: string;
  cursor: string | null;
  lastChangeId: string | null;
  stateVector: string;
  state?: string;
  at: string;
}
