import type { OperationId } from '../contract/types.js';
import type { OperationTrackedSupport } from '../contract/metadata-types.js';
import type { InlinePropertyStorage, InlinePropertyType, InlineRunPatchKey } from '../format/inline-run-patch.js';
import type { SDHtmlMarkdownSupportCheckInput, SDHtmlMarkdownSupportCheckResult } from './html-markdown-support.js';
import { validateSDHtmlMarkdownSupportCheckInput } from './html-markdown-support.js';
import { DocumentApiValidationError } from '../errors.js';

export const CAPABILITY_REASON_CODES = [
  'COMMAND_UNAVAILABLE',
  'HELPER_UNAVAILABLE',
  'OPERATION_UNAVAILABLE',
  'TRACKED_MODE_UNAVAILABLE',
  'DRY_RUN_UNAVAILABLE',
  'NAMESPACE_UNAVAILABLE',
  'STYLES_PART_MISSING',
  'COLLABORATION_ACTIVE',
  'TARGET_CONTEXT_REQUIRED',
  'TARGET_UNSUPPORTED',
] as const;

export type CapabilityReasonCode = (typeof CAPABILITY_REASON_CODES)[number];

/**
 * A boolean flag indicating whether a capability is active, with optional
 * machine-readable reason codes explaining why it is disabled.
 */
export type CapabilityFlag = {
  enabled: boolean;
  reasons?: CapabilityReasonCode[];
};

/** Per-operation runtime capability describing availability, tracked-mode, and dry-run support. */
export interface OperationRuntimeCapability {
  available: boolean;
  tracked: boolean;
  /**
   * Detailed tracked-mode support. `tracked` remains true only for `always`
   * so existing callers keep a conservative, backward-compatible boolean.
   */
  trackedSupport?: OperationTrackedSupport;
  dryRun: boolean;
  reasons?: CapabilityReasonCode[];
}

export type CapabilitySupportDecision =
  | { kind: 'supported' }
  | { kind: 'unsupported'; code: CapabilityReasonCode; reason: string }
  | { kind: 'requires-input'; code: 'TARGET_CONTEXT_REQUIRED'; reason: string };

export interface OperationCapabilityResolveInput {
  operationId: OperationId;
  input?: unknown;
  options?: unknown;
}

export interface OperationCapabilityResolveResult {
  operationId: OperationId;
  available: CapabilitySupportDecision;
  tracked: CapabilitySupportDecision;
  dryRun: CapabilitySupportDecision;
}

export type OperationCapabilities = Record<OperationId, OperationRuntimeCapability>;

/** Runtime capabilities exposed by the plan engine (mutations.apply / mutations.preview). */
export interface PlanEngineCapabilities {
  /** Step op codes the engine can execute (e.g., 'text.rewrite', 'format.apply'). */
  supportedStepOps: readonly string[];
  /** Non-uniform style resolution strategies available for `onNonUniform`. */
  supportedNonUniformStrategies: readonly string[];
  /** Mark names that `setMarks` can override (e.g., 'bold', 'italic'). */
  supportedSetMarks: readonly string[];
  /** Regex selector limits enforced by the selector engine. Unsafe patterns are rejected. */
  regex: {
    /** Maximum allowed text-selector regex pattern length. */
    maxPatternLength: number;
    maxExecutionMs?: number;
  };
}

/**
 * Complete runtime capability snapshot for a Document API editor instance.
 *
 * `global` contains namespace-level flags (track changes, comments, lists, dry-run).
 * `operations` contains per-operation availability details keyed by {@link OperationId}.
 * `planEngine` describes plan engine capabilities (step ops, style strategies, limits).
 */
/** Per-inline-property runtime capability for `format.apply`. */
export interface InlinePropertyCapability {
  /** Whether this specific property is currently executable. */
  available: boolean;
  /** Whether this property supports tracked mode. */
  tracked: boolean;
  /** API value shape for this property. */
  type: InlinePropertyType;
  /** Runtime storage path used by the editor (mark or runAttribute). */
  storage: InlinePropertyStorage;
}

/** Format capability snapshot: advertises per-property support for `format.apply`. */
export interface FormatCapabilities {
  /** Capability entry per canonical inline patch key. */
  supportedInlineProperties: Record<InlineRunPatchKey, InlinePropertyCapability>;
}

export interface DocumentApiCapabilities {
  global: {
    trackChanges: CapabilityFlag;
    comments: CapabilityFlag;
    lists: CapabilityFlag;
    dryRun: CapabilityFlag;
    history: CapabilityFlag;
  };
  /** Format capability discovery for `format.apply`. */
  format: FormatCapabilities;
  operations: OperationCapabilities;
  planEngine: PlanEngineCapabilities;
}

/** Engine-specific adapter that resolves runtime capabilities for the current editor instance. */
export interface CapabilitiesAdapter {
  get(): DocumentApiCapabilities;
  check?(input: SDHtmlMarkdownSupportCheckInput): Promise<SDHtmlMarkdownSupportCheckResult>;
  resolve?(input: OperationCapabilityResolveInput): OperationCapabilityResolveResult;
}

/**
 * Delegates to the capabilities adapter to retrieve the current capability snapshot.
 *
 * @param adapter - The engine-specific capabilities adapter.
 * @returns The resolved capabilities for this editor instance.
 */
export function executeCapabilities(adapter: CapabilitiesAdapter): DocumentApiCapabilities {
  return adapter.get();
}

export function executeCapabilitiesCheck(
  adapter: CapabilitiesAdapter,
  input: SDHtmlMarkdownSupportCheckInput,
): Promise<SDHtmlMarkdownSupportCheckResult> {
  validateSDHtmlMarkdownSupportCheckInput(input);
  if (!adapter.check) {
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      'capabilities.check is not available. The host engine has not provided an adapter for this capability.',
      { operation: 'capabilities.check' },
    );
  }
  return adapter.check(input);
}

export function executeCapabilitiesResolve(
  adapter: CapabilitiesAdapter,
  input: OperationCapabilityResolveInput,
): OperationCapabilityResolveResult {
  if (!adapter.resolve) {
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      'capabilities.resolve is not available. The host engine has not provided an adapter for this capability.',
      { operation: 'capabilities.resolve', operationId: input.operationId },
    );
  }
  return adapter.resolve(input);
}
