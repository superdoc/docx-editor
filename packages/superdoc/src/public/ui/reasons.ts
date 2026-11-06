/**
 * Stable public reason taxonomy for the v2-native `superdoc/ui` controller.
 *
 * These strings are the canonical, stable vocabulary the controller uses to
 * explain WHY a command or workflow handle is disabled, unsupported, deferred,
 * or otherwise fails closed. They are part of the public custom-UI contract:
 * consumer toolbars/panels can branch on them and migration docs reference
 * them. Once shipped, a value must not be repurposed — add a new member rather
 * than changing the meaning of an existing one.
 *
 * The reasons distinguish the failure-mode families a custom UI must tell
 * apart (see `plans/v2-custom-ui-toolbar-parity-plan-set.md`, Workstream 2):
 *
 *   - command unsupported by v2            → `command-unsupported`
 *   - reserved recognized/deferred command → `command-deferred`
 *   - editor / Document API not ready yet   → `not-ready`, `document-api-unavailable`
 *   - blocked by viewing / read-only state  → `document-readonly`
 *   - blocked by missing selection/context  → `selection-required`,
 *     `range-selection-required`, `context-unavailable`, `target-unresolved`,
 *     `target-not-visible`, `geometry-unavailable`
 *   - operation / host capability missing   → `operation-unavailable`,
 *     `host-capability-unavailable`, `bulk-decisions-disabled`
 *
 * Geometry results (`viewport.getRect`, `metadata.getRect`) carry a separate,
 * geometry-local `reason` vocabulary (`not-mounted`, `unresolved`,
 * `invalid-target`, `not-ready`, `unavailable`); see `ViewportRectResult`.
 * That vocabulary predates this taxonomy and is intentionally narrower.
 */
export const SUPERDOC_UI_REASONS = {
  /** The active editor is not mounted / ready yet. */
  notReady: 'not-ready',
  /** The editor is ready but its Document API facade is not available or has not been published yet. */
  documentApiUnavailable: 'document-api-unavailable',
  /** The document is in viewing / read-only mode, so mutating commands are blocked. */
  documentReadonly: 'document-readonly',
  /** Tracked-change accept/reject is disabled by the Editor interaction policy. */
  trackedChangeDecisionsDisabled: 'tracked-change-decisions-disabled',
  /** A selection is required and none is active. */
  selectionRequired: 'selection-required',
  /** A non-empty (range) selection is required and the current selection is collapsed/empty. */
  rangeSelectionRequired: 'range-selection-required',
  /** Required pointer / entity / document context could not be resolved. */
  contextUnavailable: 'context-unavailable',
  /** Painted geometry for the target could not be resolved. */
  geometryUnavailable: 'geometry-unavailable',
  /** A navigation / geometry target could not be resolved to a live document address. */
  targetUnresolved: 'target-unresolved',
  /** A navigation target was resolved but could not be brought into the visible viewport. */
  targetNotVisible: 'target-not-visible',
  /** The command is not supported by v2 at all. */
  commandUnsupported: 'command-unsupported',
  /** Reserved migration reason for a recognized command that is intentionally deferred. */
  commandDeferred: 'command-deferred',
  /**
   * The command is a real v2 operation, but its required document context
   * (the current table / row / column / cell) cannot be resolved from any
   * public custom-UI state: `selection.current` exposes only text block ids,
   * and no public operation resolves the table ancestry of a block. This is a
   * precise, named context-facade gap — distinct from `command-deferred` — for
   * the table cell-context command family.
   */
  tableContextUnavailable: 'table-context-unavailable',
  /** The backing Document API / SuperDoc operation is not present on this host. */
  operationUnavailable: 'operation-unavailable',
  /** Bulk accept/reject decisions are disabled unless the host opts in. */
  bulkDecisionsDisabled: 'bulk-decisions-disabled',
  /** A host-owned capability (geometry, hit-test, navigation) is unavailable. */
  hostCapabilityUnavailable: 'host-capability-unavailable',
  /** Undo / redo cannot run because the host history stack has no matching entry. */
  historyEmpty: 'history-empty',
  /**
   * The shared search/find surface is unavailable because the host does not
   * expose a search facade (e.g. a pre-ready editor, a worker-backed v2 host,
   * or a build without the search substrate). Search reads return empty and
   * search actions fail closed rather than fabricating matches.
   */
  searchUnavailable: 'search-unavailable',
  /** The search pattern is an invalid or unsafe regular expression. */
  searchInvalidPattern: 'search-invalid-pattern',
  /** Replace All cannot enumerate the complete match set, so no edits were applied. */
  searchTruncated: 'search-truncated',
  /**
   * Find-and-replace is intentionally out of the first v2 search parity tranche.
   * The shared search surface implements query / navigation only; replace and
   * replace-all fail closed with this reason until replace ships. This is an
   * explicit product posture, not a missing-capability accident.
   */
  replaceUnsupported: 'replace-unsupported',
  /**
   * The selection overlaps a content control (SDT) whose lock mode
   * (`contentLocked` / `sdtContentLocked`) forbids styling its content — Word
   * parity (SD-3274): the toolbar must not leave styling controls clickable
   * when the style change cannot apply. Alignment / paragraph-level commands
   * are never gated by this reason.
   */
  contentControlLocked: 'content-control-locked',
  deletedTextFormattingUnsupported: 'deleted-text-formatting-unsupported',
  /**
   * The current user is not allowed to run this command under the product
   * permissionResolver / role matrix (SD-3845). Distinct from document
   * read-only: the document is writable, this one action is not.
   */
  permissionDenied: 'permission-denied',
} as const;

/**
 * Union of stable public reason strings. Surfaced on {@link CommandState} and
 * other fail-closed handle results so consumers can branch on a stable cause
 * rather than parsing free-form text.
 */
export type SuperDocUIReason = (typeof SUPERDOC_UI_REASONS)[keyof typeof SUPERDOC_UI_REASONS];
