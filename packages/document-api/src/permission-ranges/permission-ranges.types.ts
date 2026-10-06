import type { Position } from '../types/base.js';
import type { SelectionTarget } from '../types/address.js';
import type { AdapterMutationFailure } from '../types/adapter-result.js';
import type { DiscoveryOutput } from '../types/discovery.js';
import type { StoryLocator } from '../types/story.types.js';

// ---------------------------------------------------------------------------
// Principal model
// ---------------------------------------------------------------------------

export type PermissionRangePrincipal = { kind: 'everyone' } | { kind: 'editor'; id: string };

// ---------------------------------------------------------------------------
// Range kind
// ---------------------------------------------------------------------------

export type PermissionRangeKind = 'inline' | 'block';

// ---------------------------------------------------------------------------
// Range info (returned by list / get)
// ---------------------------------------------------------------------------

export interface PermissionRangeInfo {
  id: string;
  principal: PermissionRangePrincipal;
  kind: PermissionRangeKind;
  start: Position;
  end: Position;
  /** Story containing this range. Omit for body (backward compatible). */
  story?: StoryLocator;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface PermissionRangesListInput {
  limit?: number;
  offset?: number;
}

export interface PermissionRangesGetInput {
  id: string;
}

export interface PermissionRangesCreateInput {
  /** Target range for the new permission markers. Uses the standard selection target model. */
  target: SelectionTarget;
  principal: PermissionRangePrincipal;
  id?: string;
}

export interface PermissionRangesRemoveInput {
  id: string;
}

export interface PermissionRangesUpdatePrincipalInput {
  id: string;
  principal: PermissionRangePrincipal;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface PermissionRangeMutationSuccess {
  success: true;
  range: PermissionRangeInfo;
}

export interface PermissionRangeRemoveSuccess {
  success: true;
  id: string;
}

export type PermissionRangeMutationResult = PermissionRangeMutationSuccess | AdapterMutationFailure;
export type PermissionRangeRemoveResult = PermissionRangeRemoveSuccess | AdapterMutationFailure;

// ---------------------------------------------------------------------------
// List result
// ---------------------------------------------------------------------------

export type PermissionRangesListResult = DiscoveryOutput<PermissionRangeInfo>;
