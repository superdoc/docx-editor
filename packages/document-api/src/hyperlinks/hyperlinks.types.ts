import type { BlockNodeAddress, InlineNodeAddress, NodeAddress } from '../types/base.js';
import type { TextAddress } from '../types/address.js';
import type { DiscoveryOutput } from '../types/discovery.js';
import type { ReceiptFailure } from '../types/receipt.js';

// ---------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------

/** Narrowed inline address for hyperlink targets. */
export type HyperlinkTarget = InlineNodeAddress & { nodeType: 'hyperlink' };

// ---------------------------------------------------------------------------
// Destination model
// ---------------------------------------------------------------------------

/**
 * Canonical hyperlink destination specification for write operations.
 *
 * Destination mode rules (enforced on write: wrap/insert/patch):
 * - External mode: `href` is set and non-empty
 * - Internal mode: `anchor` is set and non-empty
 * - Mixed mode: both `href` and `anchor` may be set (OOXML allows this -
 *   anchor is used when href target is the same document, href is fallback)
 * - Invalid: neither `href` nor `anchor` is set
 *
 * Read operations (list/get) faithfully report whatever the document contains,
 * including documents where both href and anchor are present.
 */
export interface HyperlinkDestination {
  /** External/mailto/file URL. Sanitized via @superdoc/url-validation on write. */
  href?: string;
  /** OOXML bookmark target name (w:anchor). */
  anchor?: string;
  /** Location within target document (w:docLocation). */
  docLocation?: string;
}

// ---------------------------------------------------------------------------
// Write specs
// ---------------------------------------------------------------------------

/** Full hyperlink specification for write operations (wrap/insert). */
export interface HyperlinkSpec {
  destination: HyperlinkDestination;
  /** Tooltip text (w:tooltip). */
  tooltip?: string;
  /** Link target frame (_blank, _self, etc.). */
  target?: string;
  /** Browser relationship tokens kept for the current editing session; not persisted in DOCX or reviewed by Word. */
  rel?: string;
}

/**
 * Patch payload for hyperlinks.patch: metadata only, no text mutation.
 *
 * Set a field to `null` to explicitly clear it.
 * Omit a field to leave it unchanged.
 */
export interface HyperlinkPatch {
  href?: string | null;
  anchor?: string | null;
  docLocation?: string | null;
  tooltip?: string | null;
  target?: string | null;
  /** Session-only browser relationship tokens. Null or an empty string clears them; omission preserves them. */
  rel?: string | null;
}

// ---------------------------------------------------------------------------
// Read types
// ---------------------------------------------------------------------------

/** Native hyperlink properties and browser metadata for the current editing session. */
export interface HyperlinkReadProperties {
  href?: string;
  anchor?: string;
  docLocation?: string;
  tooltip?: string;
  target?: string;
  /** Browser relationship tokens for this session. A fresh DOCX open does not restore them. */
  rel?: string;
}

/** Domain payload for discovery items in hyperlinks.list. */
export interface HyperlinkDomain {
  address: HyperlinkTarget;
  properties: HyperlinkReadProperties;
  text?: string;
}

/** Full info for a single hyperlink via hyperlinks.get. */
export interface HyperlinkInfo {
  address: HyperlinkTarget;
  properties: HyperlinkReadProperties;
  text?: string;
}

// ---------------------------------------------------------------------------
// Mutation results
// ---------------------------------------------------------------------------

export interface HyperlinkMutationSuccess {
  success: true;
  hyperlink: HyperlinkTarget;
}

export interface HyperlinkMutationFailure {
  success: false;
  failure: ReceiptFailure;
}

export type HyperlinkMutationResult = HyperlinkMutationSuccess | HyperlinkMutationFailure;

// ---------------------------------------------------------------------------
// Discovery result alias
// ---------------------------------------------------------------------------

export type HyperlinksListResult = DiscoveryOutput<HyperlinkDomain>;

// ---------------------------------------------------------------------------
// Operation inputs
// ---------------------------------------------------------------------------

export interface HyperlinksListQuery {
  within?: BlockNodeAddress;
  hrefPattern?: string;
  anchor?: string;
  textPattern?: string;
  limit?: number;
  offset?: number;
}

export interface HyperlinksGetInput {
  target: HyperlinkTarget;
}

export interface HyperlinksWrapInput {
  target: TextAddress;
  link: HyperlinkSpec;
}

export interface HyperlinksInsertInput {
  target?: TextAddress;
  text: string;
  link: HyperlinkSpec;
}

export interface HyperlinksPatchInput {
  target: HyperlinkTarget;
  patch: HyperlinkPatch;
}

export interface HyperlinksRemoveInput {
  target: HyperlinkTarget;
  mode?: 'unwrap' | 'deleteText';
}
