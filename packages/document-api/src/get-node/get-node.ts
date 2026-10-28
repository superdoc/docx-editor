import type { BlockNodeType, NodeAddress, StoryLocator } from '../types/index.js';
import type { SDNodeResult } from '../types/sd-envelope.js';

/**
 * Input for resolving a block node by its ID without guessing its type.
 * Resolves paragraphs (including table-cell paragraphs) in the body, linked
 * header/footer parts, and supported textboxes, plus top-level body/header/footer tables.
 * Notes, comments, glossary, and nested table containers are outside this resolver.
 */
export interface GetNodeByIdInput {
  nodeId: string;
  nodeType?: BlockNodeType;
  story?: StoryLocator;
}

/**
 * Engine-specific adapter that the getNode API delegates to.
 */
export interface GetNodeAdapter {
  /**
   * Resolve a node address to an SDNodeResult.
   *
   * @param address - The node address to resolve.
   * @returns SDNodeResult with the projected node and its address.
   * @throws When the address cannot be resolved, including AMBIGUOUS_TARGET
   * when its node ID is duplicated within the addressed story.
   */
  getNode(address: NodeAddress): SDNodeResult;
  /**
   * Resolve a block node by its ID.
   *
   * @param input - The node-id input payload.
   * @returns SDNodeResult with the projected node and its address.
   * @throws TARGET_NOT_FOUND for no match, AMBIGUOUS_TARGET for duplicate IDs,
   * or CAPABILITY_UNAVAILABLE for an unsupported story hint.
   */
  getNodeById(input: GetNodeByIdInput): SDNodeResult;
}

/**
 * Execute a getNode operation via the provided adapter.
 *
 * @param adapter - Engine-specific getNode adapter.
 * @param address - The node address to resolve.
 * @returns SDNodeResult with the projected node and its address.
 */
export function executeGetNode(adapter: GetNodeAdapter, address: NodeAddress): SDNodeResult {
  return adapter.getNode(address);
}

/**
 * Execute a getNodeById operation via the provided adapter.
 *
 * @param adapter - Engine-specific getNode adapter.
 * @param input - The node-id input payload.
 * @returns SDNodeResult with the projected node and its address.
 */
export function executeGetNodeById(adapter: GetNodeAdapter, input: GetNodeByIdInput): SDNodeResult {
  return adapter.getNodeById(input);
}
