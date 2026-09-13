/**
 * DOM Contract: Data Attributes
 *
 * Named constants for `data-*` attributes stamped on rendered DOM elements.
 * These attributes are read by editor-side DOM observers, click-to-position
 * mapping, and bridge compatibility code.
 *
 * Each constant stores the full attribute name (e.g. `"data-pm-start"`) as it
 * appears in `getAttribute()` / `setAttribute()` calls and CSS selectors.
 *
 * The `DATASET_KEYS` mirror provides the camelCase equivalents used with
 * `element.dataset.*` access.
 *
 * Editor-neutral (prep-001) attributes live alongside the legacy `data-pm-*`
 * attributes; both surfaces are emitted so that v1 consumers continue to work
 * unmodified while future editor-neutral consumers (hit-test / range mapping)
 * can address rendered output without consulting ProseMirror positions.
 */

/**
 * Full attribute names for use with `getAttribute` / `setAttribute` / CSS selectors.
 */
export const DATA_ATTRS = {
  /** ProseMirror start position of the element's content range. */
  PM_START: 'data-pm-start',

  /** ProseMirror end position of the element's content range. */
  PM_END: 'data-pm-end',

  /** Layout epoch stamp — incremented on each layout pass. */
  LAYOUT_EPOCH: 'data-layout-epoch',

  /** JSON-encoded table boundary metadata for resize overlays. */
  TABLE_BOUNDARIES: 'data-table-boundaries',

  /** SDT unique identifier. */
  SDT_ID: 'data-sdt-id',

  /** SDT type (fieldAnnotation, structuredContent, documentSection, etc.). */
  SDT_TYPE: 'data-sdt-type',

  /** Field annotation field identifier. */
  FIELD_ID: 'data-field-id',

  /** Field annotation field type (signer, text, checkbox, etc.). */
  FIELD_TYPE: 'data-field-type',

  /** Marks an element as draggable by the editor. */
  DRAGGABLE: 'data-draggable',

  /** Display label text for drag toast / accessibility. */
  DISPLAY_LABEL: 'data-display-label',

  /** Field annotation variant (text, image, signature, checkbox, html, link). */
  VARIANT: 'data-variant',

  /** Element type discriminator (annotation variant, etc.). */
  TYPE: 'data-type',

  // --- Editor-neutral layout boundary (prep-001) ---
  // Additive only — `pmStart`/`pmEnd` and `data-pm-*` remain the
  // authoritative click-to-position surface for v1. These attributes give
  // future editor-neutral consumers a way to address rendered output without
  // consulting ProseMirror positions.

  /** Schema version for the editor-neutral layout boundary attributes. */
  LAYOUT_BOUNDARY_SCHEMA: 'data-layout-boundary-schema',

  /** Stable opaque id of the rendered fragment (see `LayoutFragmentId`). */
  LAYOUT_FRAGMENT_ID: 'data-layout-fragment-id',

  /** Encoded story locator (e.g. `body`, `header:rId4`, `footer:rId7`). */
  LAYOUT_STORY: 'data-layout-story',

  /** Source block reference (today: producer's `blockId`). */
  LAYOUT_BLOCK_REF: 'data-layout-block-ref',

  /** Zero-based flow-column index that owns the rendered fragment. */
  LAYOUT_COLUMN_INDEX: 'data-layout-column-index',
} as const;

/**
 * CamelCase keys for use with `element.dataset.*` property access.
 *
 * `element.dataset.pmStart` is equivalent to `element.getAttribute('data-pm-start')`.
 */
export const DATASET_KEYS = {
  PM_START: 'pmStart',
  PM_END: 'pmEnd',
  LAYOUT_EPOCH: 'layoutEpoch',
  TABLE_BOUNDARIES: 'tableBoundaries',
  SDT_ID: 'sdtId',
  SDT_TYPE: 'sdtType',
  FIELD_ID: 'fieldId',
  FIELD_TYPE: 'fieldType',
  DRAGGABLE: 'draggable',
  DISPLAY_LABEL: 'displayLabel',
  VARIANT: 'variant',
  TYPE: 'type',

  // Editor-neutral layout boundary (prep-001).
  LAYOUT_BOUNDARY_SCHEMA: 'layoutBoundarySchema',
  LAYOUT_FRAGMENT_ID: 'layoutFragmentId',
  LAYOUT_STORY: 'layoutStory',
  LAYOUT_BLOCK_REF: 'layoutBlockRef',
  LAYOUT_COLUMN_INDEX: 'layoutColumnIndex',
} as const;

/**
 * Encode a `LayoutStoryLocator`-shaped object into its dataset string form.
 *
 * Format is `"body"` for body content and `"<kind>:<id>"` otherwise. The id
 * is passed through verbatim (no escaping is applied) because the producers
 * pass opaque part-relationship ids that do not contain the colon delimiter.
 *
 * Kept here so emitters and readers agree on the wire shape without taking a
 * dependency on the contracts package from dom-contract.
 */
export const encodeLayoutStoryDataset = (story: {
  kind: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox' | 'unknown';
  id?: string;
}): string => (story.kind === 'body' ? 'body' : story.id ? `${story.kind}:${story.id}` : story.kind);

/**
 * Decode the dataset string back into a `LayoutStoryLocator`-shaped object.
 *
 * Used by editor-side DOM observers. Unknown kinds fall back to
 * `{ kind: 'unknown' }` so downstream code can treat the value as a
 * diagnostic, not as a default body.
 */
export const decodeLayoutStoryDataset = (
  raw: string | undefined | null,
): { kind: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox' | 'unknown'; id?: string } => {
  if (!raw) return { kind: 'unknown' };
  if (raw === 'body') return { kind: 'body' };
  const idx = raw.indexOf(':');
  const kind = idx === -1 ? raw : raw.slice(0, idx);
  const id = idx === -1 ? undefined : raw.slice(idx + 1);
  switch (kind) {
    case 'body':
    case 'header':
    case 'footer':
    case 'footnote':
    case 'endnote':
    case 'textbox':
      return id ? { kind, id } : { kind };
    default:
      return { kind: 'unknown' };
  }
};
