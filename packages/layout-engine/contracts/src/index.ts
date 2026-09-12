import type { TabStop } from './engines/tabs.js';
import type { PageNumberChapterSeparator, PageNumberFieldFormat, PageNumberFormat } from './page-number-formatting.js';
export { computeTabStops, layoutWithTabs, calculateTabWidth } from './engines/tabs.js';

// Re-export TabStop for external consumers
export type { TabStop };

// Direction context types (orthogonal axes for RTL/BIDI).
// See `direction-context.ts` for the spec rationale and axis semantics.
export type {
  BaseDirection,
  WritingMode,
  SectionDirectionContext,
  TableDirectionContext,
  CellDirectionContext,
  ParagraphDirectionContext,
  RunBidiContext,
  RunScriptContext,
} from './direction-context.js';
export { getParagraphInlineDirection, getTableVisualDirection } from './direction-context.js';
import type {
  ParagraphDirectionContext,
  RunBidiContext,
  RunScriptContext,
  TableDirectionContext,
} from './direction-context.js';

// Export table contracts
export {
  OOXML_PCT_DIVISOR,
  resolveTableWidthAttr,
  type TableWidthAttr,
  type TableColumnSpec,
} from './engines/tables.js';

export { effectiveTableCellSpacing } from './table-cell-spacing.js';

export {
  selectHeaderFooterVariantForPage,
  resolveEffectiveHeaderFooterRef,
  type HeaderFooterKind,
  type HeaderFooterVariant,
  type HeaderFooterSectionRefs,
  type HeaderFooterResolutionSection,
  type HeaderFooterVariantSelectionInput,
  type HeaderFooterEffectiveRefInput,
  type HeaderFooterEffectiveRefResult,
} from './header-footer-resolution.js';

// Table column rescaling (moved from layout-engine for cross-stage use)
export { rescaleColumnWidths } from './table-column-rescale.js';

// Cell spacing resolution (moved from measuring-dom for cross-stage use)
export { getCellSpacingPx } from './cell-spacing.js';

// Border band width (single source of truth for painter CSS width + measuring row reservation)
export { getBorderBandWidthPx, getBorderBandProfile, isNativeCssDoubleStyle } from './border-band.js';
export type { BorderBandProfile } from './border-band.js';

// OOXML z-index normalization (moved from pm-adapter for cross-stage use)
export {
  normalizeZIndex,
  coerceRelativeHeight,
  isPlainObject,
  OOXML_Z_INDEX_BASE,
  resolveFloatingZIndex,
  getFragmentZIndex,
} from './ooxml-z-index.js';

export {
  resolveOuterShadowOffset,
  getOuterShadowStdDeviation,
  getOuterShadowPaintExtent,
  type OuterShadowPaintEffect,
  type PaintEffectExtent,
} from './shape-effects.js';

// Export justify utilities
export {
  shouldApplyJustify,
  calculateJustifySpacing,
  getFirstLineIndentOffset,
  adjustAvailableWidthForTextIndent,
  SPACE_CHARS,
  type ShouldApplyJustifyParams,
  type CalculateJustifySpacingParams,
} from './justify-utils.js';

export {
  parseInsetClipPathForScale,
  formatInsetClipPathTransform,
  type InsetClipPathScale,
} from './clip-path-inset.js';
export {
  SUBSCRIPT_SUPERSCRIPT_SCALE,
  normalizeBaselineShift,
  hasExplicitBaselineShift,
  isSuperscriptOrSubscript,
  usesDefaultScriptLayout,
  scaleFontSizeForVerticalText,
  resolveBaseFontSizeForVerticalText,
  type VerticalTextAlign,
} from './vertical-text.js';

export { computeFragmentPmRange, computeLinePmRange, type LinePmRange } from './pm-range.js';

export {
  resolveAnchoredGraphicY,
  resolveAnchoredGraphicX,
  type ColumnLayoutForAnchor,
  type ResolveAnchoredGraphicYInput,
} from './graphic-placement.js';

// Editor-neutral layout identity primitives (prep-001).
// Additive only — `pmStart`/`pmEnd` and PM-shaped fields remain available
// alongside these on every fragment/run.
export {
  LAYOUT_BOUNDARY_SCHEMA,
  bodyStoryLocator,
  namedStoryLocator,
  computeLayoutFragmentId,
  buildLayoutSourceIdentity,
  buildLayoutSourceIdentityForFragment,
} from './layout-identity.js';
export type {
  LayoutBlockRef,
  LayoutFragmentId,
  LayoutPartialRowIdentity,
  LayoutSourceIdentity,
  LayoutStoryKind,
  LayoutStoryLocator,
} from './layout-identity.js';
import type { LayoutSourceIdentity } from './layout-identity.js';
export {
  cloneColumnLayout,
  columnLayoutsEqual,
  columnRenderLayoutsEqual,
  getColumnAtX,
  getColumnGapAfter,
  getColumnGeometry,
  getColumnSeparatorPositions,
  getColumnWidth,
  getColumnX,
  normalizeColumnLayout,
  resolveColumnCount,
  resolveColumnLayout,
  resolveColumnMode,
  widthsEqual,
} from './column-layout.js';
export type { ColumnGeometry, NormalizedColumnLayout } from './column-layout.js';
export {
  authorFromTrackedChangeMeta,
  authorIdentityKey,
  composeAuthorColorResolver,
  fallbackAuthorColor,
  stampTrackedChangeColors,
} from './author-colors.js';
export type { AuthorColorsConfig, TrackChangeAuthorColorResolver } from './author-colors.js';
export {
  getSdtContainerKey,
  getSdtContainerKeyForBlock,
  getSdtContainerMetadata,
  hasExplicitSdtContainerKey,
  isSdtContainerMetadata,
} from './sdt-container.js';
export {
  resolveInheritedHeaderFooterRef,
  resolveInheritedHeaderFooterRefWithType,
  type HeaderFooterRefIdentifier,
  type HeaderFooterRefMap,
  type ResolvedInheritedHeaderFooterRef,
  type ResolveInheritedHeaderFooterRefInput,
} from './header-footer-inheritance.js';
export {
  formatChapterPageNumberText,
  formatIntegerWithNumericPicture,
  formatPageNumber,
  formatPageNumberFieldValue,
  formatSectionPageNumberText,
  type PageNumberFieldFormat,
  type PageNumberChapterSeparator,
  type PageNumberFormat,
} from './page-number-formatting.js';

export { buildPageRefAnchorMap } from './page-ref-anchor.js';
export {
  DRAWING_DIAGNOSTIC_CODES,
  DRAWING_DIAGNOSTIC_CODE_ALIASES,
  DRAWING_SUPPORT_TAXONOMY,
  DRAWING_FAMILIES,
  canonicalDrawingDiagnosticCode,
  getDrawingFamilySpec,
  isSupportedDrawingFamily,
  type DrawingContractTarget,
  type DrawingDiagnosticCode,
  type DrawingFamily,
  type DrawingFamilySpec,
  type DrawingSupportLevel,
  type DrawingTaxonomyDrawingKind,
} from './drawing-taxonomy.js';
/** Inline field annotation metadata extracted from w:sdt nodes. */
export type FieldAnnotationMetadata = {
  type: 'fieldAnnotation';
  variant?: 'text' | 'image' | 'signature' | 'checkbox' | 'html' | 'link';
  fieldId: string;
  fieldType?: string;
  displayLabel?: string;
  defaultDisplayLabel?: string;
  alias?: string;
  fieldColor?: string;
  borderColor?: string;
  highlighted?: boolean;
  fontFamily?: string | null;
  fontSize?: string | number | null;
  textColor?: string | null;
  textHighlight?: string | null;
  linkUrl?: string | null;
  imageSrc?: string | null;
  rawHtml?: unknown;
  size?: {
    width?: number;
    height?: number;
  } | null;
  extras?: Record<string, unknown> | null;
  multipleImage?: boolean;
  hash?: string | null;
  generatorIndex?: number | null;
  sdtId?: string | null;
  hidden?: boolean;
  visibility?: 'visible' | 'hidden';
  isLocked?: boolean;
  formatting?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
  marks?: Record<string, unknown>;
};

export type StructuredContentLockMode = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

/**
 * Visual chrome / labelling behavior of an SDT, mirroring
 * `<w15:appearance w15:val="…">` (ECMA-376 §17.5.2.6 / OOXML 2010+).
 *
 *   - `'boundingBox'` (default): visible chrome around the SDT content.
 *   - `'tags'`: tags-only mode (start/end markers).
 *   - `'hidden'`: no chrome at all; the SDT exists in the document but is
 *     visually transparent. The alias label MUST NOT leak into the rendered
 *     DOM textContent (a11y / copy-paste behavior).
 */
export type StructuredContentAppearance = 'boundingBox' | 'tags' | 'hidden';

export type StructuredContentMetadata = {
  type: 'structuredContent';
  scope: 'inline' | 'block';
  id?: string | null;
  tag?: string | null;
  alias?: string | null;
  lockMode?: StructuredContentLockMode;
  /** Appearance from the SDT's `<w15:appearance>` element, when present. */
  appearance?: StructuredContentAppearance;
  sdtPr?: unknown;
};

export type DocumentSectionMetadata = {
  type: 'documentSection';
  id?: string | null;
  title?: string | null;
  description?: string | null;
  sectionType?: string | null;
  isLocked?: boolean;
  sdBlockId?: string | null;
};

export type DocPartMetadata = {
  type: 'docPartObject';
  gallery?: string | null;
  uniqueId?: string | null;
  alias?: string | null;
  instruction?: string | null;
};

/**
 * Union of all SDT (Structured Document Tag) metadata variants.
 *
 * Word SDTs are flexible containers that can represent:
 * - Field annotations: inline placeholders for user input
 * - Structured content: containers with semantic tags (inline or block-level)
 * - Document sections: locked or conditional regions with titles
 * - Doc parts: special objects like tables of contents
 */
export type SdtMetadata =
  | FieldAnnotationMetadata
  | StructuredContentMetadata
  | DocumentSectionMetadata
  | DocPartMetadata;

export const CONTRACTS_VERSION = '1.1.0';

/** Unique identifier for a block in the document. Format: `${pos}-${type}`. */
export type BlockId = string;

/**
 * Optional DOCX source evidence carried through the render pipeline.
 *
 * Phase 3 keeps this deliberately optional and payload-shaped so existing
 * layout snapshots remain valid while source-linked intelligence consumers can
 * preserve exact DOCX/source-tree anchors where available.
 */
export type SourceAnchor = {
  sourceNodeId?: string;
  occurrenceId?: string;
  rawFactIds?: string[];
  schemaQNames?: Array<{
    qName: string;
    namespaceUri?: string;
    prefix?: string;
    localName?: string;
    ownerElementQName?: string;
  }>;
  featureKey?: string;
  conceptKey?: string;
  sourceRef?: {
    partUri: string;
    xpathLikePath: string;
    rawFactId?: string;
    occurrenceId?: string;
  };
  anchorConfidence?: 'high' | 'medium' | 'low';
  pmNodeId?: string;
  pmRange?: {
    from: number;
    to: number;
  };
  flowBlockId?: string;
  layoutFragmentId?: string;
  paintItemId?: string;
};

/** Tab leader type for filling space before tab stops. */
export type LeaderType = 'dot' | 'heavy' | 'hyphen' | 'middleDot' | 'underscore';

export type TrackedChangeKind = 'insert' | 'delete' | 'format';

export type TrackedChangesMode = 'review' | 'original' | 'final' | 'off';

/**
 * Identity of a tracked-change author, used to resolve a per-author color.
 *
 * Mirrors the author metadata carried on {@link TrackedChangeMeta}
 * (`author` → `name`, `authorEmail` → `email`, `authorImage` → `image`).
 * Hosts configure per-author colors through this shape (see the
 * `modules.trackChanges.authorColors` config on the `superdoc` package).
 */
export type TrackChangeAuthor = {
  name?: string;
  email?: string;
  image?: string;
};

/** Formatting mark for track-format metadata. */
export type RunMark = {
  type: string;
  attrs?: Record<string, unknown> | null;
};

export type TrackedChangeMeta = {
  kind: TrackedChangeKind;
  id: string;
  overlapParentId?: string;
  relationship?: 'parent' | 'child' | 'standalone';
  /**
   * Internal story key identifying which content story owns this tracked
   * change (`'body'`, `'hf:part:…'`, `'fn:…'`, `'en:…'`).
   *
   * Set by the PM adapter during conversion and stamped on the rendered DOM
   * as `data-story-key` so downstream code can distinguish anchors across
   * stories without re-resolving the story runtime.
   */
  storyKey?: string;
  author?: string;
  authorEmail?: string;
  authorImage?: string;
  /**
   * Paint-ready per-author color, resolved upstream (in/around the
   * pm-adapter data-preparation pass) from the author identity. DomPainter
   * reads only this field and stamps the element-scoped tracked-change CSS
   * variables from it — it never invokes resolvers or touches app config.
   * Undefined when per-author colors are disabled or unconfigured, in which
   * case the static default tracked-change palette applies.
   */
  color?: string;
  date?: string;
  before?: RunMark[];
  after?: RunMark[];
};

export type FlowRunLinkTarget = '_blank' | '_self' | '_parent' | '_top';

export type FlowRunLink = {
  version?: 1 | 2;
  href?: string;
  title?: string;
  target?: FlowRunLinkTarget;
  rel?: string;
  tooltip?: string;
  anchor?: string;
  docLocation?: string;
  rId?: string;
  name?: string;
  history?: boolean;
};

export const EMPTY_SDT_PLACEHOLDER_TEXT = 'Click or tap here to enter text';

export type SdtVisualPlaceholder = 'emptyInlineSdt' | 'emptyBlockSdt';
/**
 * Common formatting marks that can be applied to any run type.
 * Used by TextRun, TabRun, and other run types that support inline formatting.
 */
export type RunMarks = {
  /** Bold text styling. */
  bold?: boolean;
  /** Italic text styling. */
  italic?: boolean;
  /** Additional letter spacing in pixels (positive for expanded, negative for condensed). */
  letterSpacing?: number;
  /** Text color as hex string (e.g., "#FF0000"). */
  color?: string;
  /** Underline decoration with optional style and color. */
  underline?: {
    /** Underline style (defaults to 'single'). */
    style?: 'single' | 'double' | 'dotted' | 'dashed' | 'wavy';
    /** Underline color as hex string (defaults to text color). */
    color?: string;
  } | null;
  /** Strikethrough text decoration. */
  strike?: boolean;
  /** Highlight (background) color as hex string. */
  highlight?: string;
  /** Text transformation (case modification). */
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  /** Vertical alignment for superscript/subscript text. */
  vertAlign?: 'superscript' | 'subscript' | 'baseline';
  /**
   * Explicit baseline shift in points (positive = raise, negative = lower).
   * Rendering normalizes a shift of zero to "no explicit shift".
   */
  baselineShift?: number;
};

export type PageReferenceRelativePositionText = 'above' | 'below';

export type FieldResultFormat = 'charformat' | 'mergeformat';

export type NumericPictureFormat = {
  /** Raw argument after the \# switch, without surrounding quotes. */
  picture: string;
};

export interface PageRefLocation {
  physicalPage: number;
  displayNumber: number;
  displayText: string;
  pageFormat?: PageNumberFormat;
  chapterNumberText?: string;
  chapterSeparator?: PageNumberChapterSeparator;
  sectionIndex?: number;
  pmPosition?: number;
}

export type TextRun = RunMarks & {
  kind?: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  /** Comment annotations applied to this run (supports overlapping comments). */
  comments?: Array<{
    commentId: string;
    importedId?: string;
    internal?: boolean;
    trackedChange?: boolean;
  }>;
  /**
   * Custom data attributes propagated from ProseMirror marks (keys must be data-*).
   */
  dataAttrs?: Record<string, string>;
  sdt?: SdtMetadata;
  /** Layout-only placeholder for visual affordances that do not represent document text. */
  visualPlaceholder?: SdtVisualPlaceholder;
  link?: FlowRunLink;
  /** Token annotations for dynamic content (page numbers, etc.). */
  token?: 'pageNumber' | 'totalPageCount' | 'pageReference' | 'sectionPageCount' | 'seq';
  /** Explicit formatting requested by PAGE/NUMPAGES/SECTIONPAGES field switches. */
  pageNumberFieldFormat?: PageNumberFieldFormat;
  /** Absolute ProseMirror position (inclusive) of first character in this run. */
  pmStart?: number;
  /** Absolute ProseMirror position (exclusive) after the last character. */
  pmEnd?: number;
  /** Metadata for page reference tokens (only when token === 'pageReference'). */
  pageRefMetadata?: {
    bookmarkId: string;
    instruction: string;
    /** True when the instruction has \p. */
    relativePosition?: boolean;
    /** General numeric formatting switch for the PAGEREF page value. */
    pageNumberFieldFormat?: PageNumberFieldFormat;
    /** Raw numeric picture from \#. */
    numericPictureFormat?: NumericPictureFormat;
    /** CHARFORMAT / MERGEFORMAT, if present. */
    fieldResultFormat?: FieldResultFormat;
  };
  /** Metadata for SEQ tokens (resolved by super-editor before layout measurement). */
  seqMetadata?: {
    identifier: string;
    instruction?: string;
    fieldArgument?: string;
    sequenceMode?: 'next' | 'current';
    hideResult?: boolean;
    restartNumber?: number | null;
    restartLevel?: number | null;
    format?: string;
    hasGeneralFormat?: boolean;
    pageNumberFieldFormat?: PageNumberFieldFormat | null;
    numericPictureFormat?: NumericPictureFormat | null;
    cachedText?: string;
  };
  /** Tracked-change metadata from ProseMirror marks. */
  trackedChange?: TrackedChangeMeta;
  /** All tracked-change layers on this run, preserving overlap order. */
  trackedChanges?: TrackedChangeMeta[];
  /**
   * Run-level bidi signals preserved from the source DOCX (run rtl flag,
   * embedding/override directions). Direction-only - script formatting lives
   * on `script`. Populated by pm-adapter from raw run properties; not yet
   * rendered (Wave 1c consumes embedding/override).
   */
  bidi?: RunBidiContext;
  /**
   * Run-level script context preserved from the source DOCX (complex-script
   * flag, per-script language metadata). Wave 1b uses `complexScript` to gate
   * the formatting-stack selection (Latin variants vs CS variants).
   */
  script?: RunScriptContext;
};

export type TabRun = RunMarks & {
  kind: 'tab';
  text: '\t';
  /**
   * Font of the tab, inherited from the paragraph's resolved run properties. A tab has
   * no glyphs, but its font drives the line height (so a tab-only line matches a text
   * line) and the underline weight. Optional: not every producer sets it.
   */
  fontFamily?: string;
  fontSize?: number;
  /** Width in pixels (assigned by measurer/resolver). */
  width?: number;
  tabStops?: TabStop[];
  tabIndex?: number;
  leader?: LeaderType | null;
  decimalChar?: string;
  indent?: ParagraphIndent;
  pmStart?: number;
  pmEnd?: number;
  /** SDT metadata if tab is inside a structured document tag. */
  sdt?: SdtMetadata;
  /** Tracked-change metadata from ProseMirror marks. */
  trackedChange?: TrackedChangeMeta;
  /** All tracked-change layers on this run, preserving overlap order. */
  trackedChanges?: TrackedChangeMeta[];
};

export type LineBreakRun = {
  kind: 'lineBreak';
  /**
   * Optional attributes carried through from the source document.
   * Mirrors OOXML <w:br> attributes (type/clear) to preserve fidelity.
   */
  attrs?: {
    lineBreakType?: string;
    clear?: string;
  };
  pmStart?: number;
  pmEnd?: number;
};

export type ImageLuminanceAdjustment = {
  /** OOXML a:lum/@bright in raw units (-100000..100000). */
  bright?: number;
  /** OOXML a:lum/@contrast in raw units (-100000..100000). */
  contrast?: number;
};

export type ImageAlphaModFix = {
  /** OOXML a:alphaModFix/@amt in raw fixed-percentage units (0..100000). */
  amt: number;
};

/** Hyperlink metadata from OOXML a:hlinkClick on a DrawingML image. */
export type ImageHyperlink = { url: string; tooltip?: string };

/** CSS object-fit values supported by SuperDoc image rendering paths. */
export type ObjectFit = 'contain' | 'cover' | 'fill' | 'scale-down';

/**
 * Inline image run for images that flow with text on the same line.
 * Unlike ImageBlock (anchored/floating images), ImageRun is part of the paragraph's run array
 * and participates in line breaking alongside text.
 *
 * Corresponds to Microsoft Word's inline images (<wp:inline> in DOCX).
 *
 * @example
 * // A paragraph with text and inline image:
 * {
 *   kind: 'paragraph',
 *   runs: [
 *     { kind: 'text', text: 'Here is an image: ', ... },
 *     { kind: 'image', src: 'data:...', width: 100, height: 50, ... },
 *     { kind: 'text', text: ' within text.', ... }
 *   ]
 * }
 */
export type ImageRun = {
  kind: 'image';
  /** Image source URL (data URI or external URL). */
  src: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Alternative text for accessibility. */
  alt?: string;
  /** Image title (tooltip). */
  title?: string;
  /** Clip-path value for cropped images. */
  clipPath?: string;
  /** Clip-path value for preset shape masks applied around the image box. */
  shapeClipPath?: string;
  /** CSS object-fit behavior for the painted image inside its layout box. */
  objectFit?: ObjectFit;

  /**
   * Spacing around the image (from DOCX distT/distB/distL/distR attributes).
   * Applied as CSS margins in the DOM painter.
   * All values in pixels.
   */
  distTop?: number;
  distBottom?: number;
  distLeft?: number;
  distRight?: number;

  /**
   * Vertical alignment of image relative to text baseline.
   * 'top' keeps the image box inside the measured line height; 'bottom'
   * preserves legacy baseline alignment for existing callers.
   */
  verticalAlign?: 'top' | 'bottom';

  /** Absolute ProseMirror position (inclusive) of this image run. */
  pmStart?: number;
  /** Absolute ProseMirror position (exclusive) after this image run. */
  pmEnd?: number;

  /** SDT metadata if image is wrapped in a structured document tag. */
  sdt?: SdtMetadata;

  /**
   * Custom data attributes propagated from ProseMirror marks (keys must be data-*).
   */
  dataAttrs?: Record<string, string>;

  // Image transformations from OOXML a:xfrm (applies to inline images)
  rotation?: number; // Rotation angle in degrees
  flipH?: boolean; // Horizontal flip
  flipV?: boolean; // Vertical flip

  // VML image adjustments for watermark effects
  gain?: string | number; // Brightness/washout (VML hex string or number)
  blacklevel?: string | number; // Contrast adjustment (VML hex string or number)
  // OOXML image effects
  grayscale?: boolean; // Apply grayscale filter to image
  lum?: ImageLuminanceAdjustment; // DrawingML luminance adjustment from a:lum
  alphaModFix?: ImageAlphaModFix; // DrawingML fixed alpha adjustment from a:alphaModFix
  /** Image hyperlink from OOXML a:hlinkClick. When set, clicking the image opens the URL. */
  hyperlink?: ImageHyperlink;
};

export type BreakRun = {
  kind: 'break';
  /** Optional break type (e.g., 'line', 'page', 'column') */
  breakType?: 'line' | 'page' | 'column' | string;
  pmStart?: number;
  pmEnd?: number;
  sdt?: SdtMetadata;
  trackedChange?: TrackedChangeMeta;
  trackedChanges?: TrackedChangeMeta[];
};

/**
 * Inline field annotation run for interactive form fields displayed as styled "pills".
 * Renders as a bordered, rounded inline element with displayLabel or type-specific content.
 *
 * Corresponds to super-editor's FieldAnnotation node which renders via FieldAnnotationView.
 *
 * @example
 * // A paragraph with text and field annotation:
 * {
 *   kind: 'paragraph',
 *   runs: [
 *     { kind: 'text', text: 'Enter name: ', ... },
 *     { kind: 'fieldAnnotation', variant: 'text', displayLabel: 'Full Name', fieldColor: '#980043', ... },
 *   ]
 * }
 */
export type FieldAnnotationRun = {
  kind: 'fieldAnnotation';
  /** The variant/type of field annotation. */
  variant: 'text' | 'image' | 'signature' | 'checkbox' | 'html' | 'link';
  /** Display text shown inside the pill (fallback for all types). */
  displayLabel: string;
  /** Unique field identifier. */
  fieldId?: string;
  /** Field type identifier (e.g., 'TEXTINPUT', 'SIGNATURE'). */
  fieldType?: string;
  /** Background color as hex string (e.g., "#980043"). Applied with alpha. */
  fieldColor?: string;
  /** Border color as hex string (e.g., "#b015b3"). */
  borderColor?: string;
  /** Whether to show the pill styling (border, background). Defaults to true. */
  highlighted?: boolean;
  /** Whether the field is hidden (display: none). */
  hidden?: boolean;
  /** CSS visibility value. */
  visibility?: 'visible' | 'hidden';

  // Type-specific content
  /** Image source URL for image/signature variants. */
  imageSrc?: string | null;
  /** Link URL for link variant. */
  linkUrl?: string | null;
  /** Raw HTML content for html variant. */
  rawHtml?: string | null;

  // Sizing
  /** Explicit size for the annotation (used for images). */
  size?: {
    width?: number;
    height?: number;
  } | null;

  // Typography (applied to the displayLabel text)
  /** Font family for the label text. */
  fontFamily?: string | null;
  /** Font size in points or pixels (e.g., "12pt", 14). */
  fontSize?: string | number | null;
  /** Text color as hex string. */
  textColor?: string | null;
  /** Text highlight/background color (overrides fieldColor). */
  textHighlight?: string | null;
  /** Bold text styling. */
  bold?: boolean;
  /** Italic text styling. */
  italic?: boolean;
  /** Underline text styling. */
  underline?: boolean;

  /** Absolute ProseMirror position (inclusive) of this run. */
  pmStart?: number;
  /** Absolute ProseMirror position (exclusive) after this run. */
  pmEnd?: number;

  /** Full SDT metadata if available. */
  sdt?: SdtMetadata;
};

export type MathRun = {
  kind: 'math';
  /** OMML XML as JSON (xml2json format) for the renderer to convert to MathML. */
  ommlJson: unknown;
  /** Plain text content for measurement fallback and accessibility. */
  textContent: string;
  /** Estimated width in pixels. */
  width: number;
  /** Estimated height in pixels. */
  height: number;
  /** Absolute ProseMirror position (inclusive) of this math run. */
  pmStart?: number;
  /** Absolute ProseMirror position (exclusive) after this math run. */
  pmEnd?: number;
  /** SDT metadata if math is wrapped in a structured document tag. */
  sdt?: SdtMetadata;
};

export type Run = TextRun | TabRun | ImageRun | LineBreakRun | BreakRun | FieldAnnotationRun | MathRun;

export type ParagraphBlock = {
  kind: 'paragraph';
  id: BlockId;
  runs: Run[];
  attrs?: ParagraphAttrs;
  sourceAnchor?: SourceAnchor;
};

/** Border style (subset of OOXML ST_Border). */
export type BorderStyle =
  | 'none'
  | 'single'
  | 'double'
  | 'dashed'
  | 'dashSmallGap'
  | 'dotted'
  | 'thick'
  | 'triple'
  | 'dotDash'
  | 'dotDotDash'
  | 'thinThickSmallGap'
  | 'thickThinSmallGap'
  | 'thinThickThinSmallGap'
  | 'thinThickMediumGap'
  | 'thickThinMediumGap'
  | 'thinThickThinMediumGap'
  | 'thinThickLargeGap'
  | 'thickThinLargeGap'
  | 'thinThickThinLargeGap'
  | 'wave'
  | 'doubleWave'
  | 'dashDotStroked'
  | 'threeDEmboss'
  | 'threeDEngrave'
  | 'outset'
  | 'inset';

/** Border specification for table and cell borders. */
export type BorderSpec = {
  style?: BorderStyle;
  width?: number;
  color?: string;
  space?: number;
};

/**
 * Three-state border value for table borders.
 * - `null`: inherit from table style
 * - `{ none: true }`: explicit "no border"
 * - `BorderSpec`: explicit border
 */
export type TableBorderValue = null | { none: true } | BorderSpec;

/** Table-level border configuration (outer + inner borders). */
export type TableBorders = {
  top?: TableBorderValue;
  right?: TableBorderValue;
  bottom?: TableBorderValue;
  left?: TableBorderValue;
  insideH?: TableBorderValue;
  insideV?: TableBorderValue;
};

/** Cell-level border configuration (overrides table-level borders). */
export type CellBorders = {
  top?: BorderSpec;
  right?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
};

export type TableCellAttrs = {
  borders?: CellBorders;
  padding?: BoxSpacing;
  verticalAlign?: 'top' | 'middle' | 'center' | 'bottom';
  background?: string;
  tableCellProperties?: Record<string, unknown>;
};

export type TablePropertiesAttrs = {
  rightToLeft?: boolean;
  [key: string]: unknown;
};

export type TableAttrs = {
  borders?: TableBorders;
  borderCollapse?: 'collapse' | 'separate';
  cellSpacing?: CellSpacing;
  tableProperties?: TablePropertiesAttrs;
  /**
   * Resolved table direction context (SD-3138). Populated by pm-adapter from
   * cascade-resolved table properties via `resolveTableDirection`. Consumers
   * should call `getTableVisualDirection(attrs)` instead of reading
   * `tableProperties.rightToLeft` directly — the helper prefers this field
   * and falls back to the legacy raw read for compatibility.
   *
   * Per ECMA-376 §17.4.1, `w:bidiVisual` affects cell ordering and
   * table-visual properties only; it does NOT propagate to cell paragraphs
   * as inline direction.
   */
  tableDirectionContext?: TableDirectionContext;
  sdt?: SdtMetadata;
  containerSdt?: SdtMetadata;
  [key: string]: unknown;
};

export type TableCell = {
  id: BlockId;
  /** Multi-block cell content (new feature) */
  blocks?: (ParagraphBlock | ImageBlock | DrawingBlock | TableBlock)[];
  /** Single paragraph (backward compatibility) */
  paragraph?: ParagraphBlock;
  rowSpan?: number;
  colSpan?: number;
  attrs?: TableCellAttrs;
  sourceAnchor?: SourceAnchor;
};

export type TableRowProperties = {
  repeatHeader?: boolean;
  cantSplit?: boolean;
  [key: string]: unknown;
};

export type TableRowAttrs = {
  tableRowProperties?: TableRowProperties;
  rowHeight?: {
    value: number;
    rule?: 'auto' | 'atLeast' | 'exact' | string;
  };
  /**
   * Structural tracked change on the whole row (inserted/deleted row), imported
   * from `<w:ins>`/`<w:del>` inside `<w:trPr>`. Reuses the same shared
   * {@link TrackedChangeMeta} shape that inline runs carry, so one painter +
   * color-stamping system handles both inline and structural tracked changes.
   * `kind` is `'insert'` for an inserted row and `'delete'` for a deleted row.
   * `color` is stamped downstream by {@link stampTrackedChangeColors}.
   */
  trackedChange?: TrackedChangeMeta;
  /**
   * Row-level border override from OOXML `w:tblPrEx/w:tblBorders` (§17.4.61).
   * Table property exceptions override the table-level borders for this row
   * only. Rows without a `tblPrEx` border block leave this undefined and fall
   * through to the table's borders. Resolved (eighth-points → px) by the v1
   * layout-adapter; the painter merges it over the table borders per edge.
   */
  borders?: TableBorders;
};

export type TableRow = {
  id: BlockId;
  cells: TableCell[];
  attrs?: TableRowAttrs;
  sourceAnchor?: SourceAnchor;
};

export type TableBlock = {
  kind: 'table';
  id: BlockId;
  rows: TableRow[];
  attrs?: TableAttrs;
  /** Column widths in pixels from OOXML w:tblGrid. */
  columnWidths?: number[];
  /** Anchor positioning for floating tables (from w:tblpPr). */
  anchor?: TableAnchor;
  /** Text wrapping for floating tables (from w:tblpPr distances). */
  wrap?: TableWrap;
  sourceAnchor?: SourceAnchor;
};

export type BoxSpacing = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type PageMargins = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  header?: number;
  footer?: number;
  gutter?: number;
};

export type DocumentBackground = {
  /** Solid page background color as a CSS hex value. */
  color: string;
};

export type ImageBlockAttrs = {
  sdt?: SdtMetadata;
  containerSdt?: SdtMetadata;
  [key: string]: unknown;
};

export type ImageBlock = {
  kind: 'image';
  id: BlockId;
  src: string;
  width?: number;
  height?: number;
  alt?: string;
  title?: string;
  objectFit?: ObjectFit;
  display?: 'inline' | 'block';
  padding?: BoxSpacing;
  margin?: BoxSpacing;
  anchor?: ImageAnchor;
  wrap?: ImageWrap;
  /** Stacking order from OOXML relativeHeight (same formula as editor: Math.max(0, relativeHeight - OOXML_Z_INDEX_BASE)) */
  zIndex?: number;
  attrs?: ImageBlockAttrs;
  // VML image adjustments for watermark effects
  gain?: string | number; // Brightness/washout (VML hex string or number)
  blacklevel?: string | number; // Contrast adjustment (VML hex string or number)
  // OOXML image effects
  grayscale?: boolean; // Apply grayscale filter to image
  lum?: ImageLuminanceAdjustment; // DrawingML luminance adjustment from a:lum
  alphaModFix?: ImageAlphaModFix; // DrawingML fixed alpha adjustment from a:alphaModFix
  // Image transformations from OOXML a:xfrm (applies to both inline and anchored images)
  rotation?: number; // Rotation angle in degrees
  flipH?: boolean; // Horizontal flip
  flipV?: boolean; // Vertical flip
  /** Image hyperlink from OOXML a:hlinkClick. When set, clicking the image opens the URL. */
  hyperlink?: ImageHyperlink;
  sourceAnchor?: SourceAnchor;
};

export type DrawingKind = 'image' | 'vectorShape' | 'textboxShape' | 'shapeGroup' | 'chart';

export type DrawingContentSnapshot = {
  name: string;
  attributes?: Record<string, unknown>;
  elements?: unknown[];
};

export type DrawingGeometry = {
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
};

export type PositionedDrawingGeometry = DrawingGeometry & {
  x?: number;
  y?: number;
};

/** Gradient stop for gradient fills. Defines a color at a specific position along the gradient. */
export type GradientStop = {
  /** Position along the gradient (0-1 range, where 0 is start and 1 is end). */
  position: number;
  /** Hex color code (e.g., "#FF0000"). */
  color: string;
  /** Optional alpha/opacity value (0-1 range). */
  alpha?: number;
};

/** Gradient fill configuration for linear or radial gradients. */
export type GradientFill = {
  type: 'gradient';
  /** Type of gradient: linear (directional) or radial (circular). */
  gradientType: 'linear' | 'radial';
  /** Array of color stops defining the gradient. */
  stops: GradientStop[];
  /** Angle in degrees for linear gradients (0 = left to right, 90 = bottom to top). */
  angle: number;
  /** Path descriptor for radial gradients (e.g., 'circle'). */
  path?: string;
};

/** Solid fill with alpha transparency. */
export type SolidFillWithAlpha = {
  type: 'solidWithAlpha';
  /** Hex color code. */
  color: string;
  /** Alpha/opacity value (0-1 range, where 0 is fully transparent and 1 is fully opaque). */
  alpha: number;
};

/**
 * Fill color for shapes. Can be:
 * - string: Simple hex color (e.g., "#FF0000") for backward compatibility
 * - GradientFill: Linear or radial gradient
 * - SolidFillWithAlpha: Solid color with transparency
 * - null: No fill
 */
export type FillColor = string | GradientFill | SolidFillWithAlpha | null;

/**
 * Stroke color for shapes. Can be:
 * - string: Hex color (e.g., "#000000")
 * - null: Explicitly no border/stroke
 */
export type StrokeColor = string | null;

/** Text formatting options for shape text content. */
export type TextFormatting = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  letterSpacing?: number;
};

/** A single text part with optional formatting. */
export type TextPart = {
  text: string;
  formatting?: TextFormatting;
  /** Optional field token (e.g., PAGE/NUMPAGES/SECTIONPAGES) resolved at render time. */
  fieldType?: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES';
  /** PAGE/SECTIONPAGES field-local value formatting override. */
  pageNumberFormat?: PageNumberFormat;
  /** Indicates this part represents a line break between paragraphs. */
  isLineBreak?: boolean;
  /** Indicates this line break follows an empty paragraph (creates extra spacing). */
  isEmptyParagraph?: boolean;
  /**
   * True only on the line-break part that separates two logical paragraphs.
   * Intra-paragraph <w:br> line breaks do not set this flag.
   */
  isParagraphBoundary?: boolean;
  /**
   * SD-2804: ECMA-376 §20.4.2.38 lets a textbox hold full body-level
   * content, including paragraphs whose runs carry inline w:drawing
   * images. When the importer encounters such a drawing it appends a
   * part with `kind: 'image'` carrying the raw media path; pm-adapter's
   * hydrateImageBlocks resolves it to a data URI alongside ImageRuns so
   * binary (Y.js) and string (zip) media files share the same path
   * candidates and Uint8Array decoding.
   */
  kind?: 'image';
  src?: string;
  extension?: string;
  rId?: string;
  width?: number;
  height?: number;
  alt?: string;
};

export type ShapeTextParagraph = {
  spacing?: {
    /** CSS pixels. */
    before?: number;
    /** CSS pixels. */
    after?: number;
  };
};

/** Text content configuration for shapes. */
export type ShapeTextContent = {
  /** Array of text parts with individual formatting. */
  parts: TextPart[];
  /** Horizontal text alignment within the shape. */
  horizontalAlign?: 'left' | 'center' | 'right';
  /** Paragraph metadata aligned to the logical paragraphs in `parts`. */
  paragraphs?: ShapeTextParagraph[];
};

export type LineEnd = {
  type?: string;
  width?: string;
  length?: string;
};

export type LineEnds = {
  head?: LineEnd;
  tail?: LineEnd;
};

export type EffectExtent = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ShapeOuterShadowEffect = {
  type: 'outerShadow';
  blurRadius: number;
  distance: number;
  direction: number;
  color: string;
  opacity: number;
};

export type ShapeEffects = {
  outerShadow?: ShapeOuterShadowEffect;
};

export type VectorShapeStyle = {
  fillColor?: FillColor;
  strokeColor?: StrokeColor;
  strokeWidth?: number;
  lineEnds?: LineEnds;
  effects?: ShapeEffects;
  textContent?: ShapeTextContent;
  textAlign?: string;
  textVerticalAlign?: 'top' | 'center' | 'bottom';
  textInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type ShapeGroupTransform = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  childX?: number;
  childY?: number;
  childWidth?: number;
  childHeight?: number;
  childOriginXEmu?: number;
  childOriginYEmu?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
};

export type ShapeGroupVectorChild = {
  shapeType: 'vectorShape';
  attrs: PositionedDrawingGeometry &
    VectorShapeStyle & {
      kind?: string;
      customGeometry?: CustomGeometryData;
      shapeId?: string;
      shapeName?: string;
    };
};

export type ShapeGroupImageChild = {
  shapeType: 'image';
  attrs: PositionedDrawingGeometry & {
    src: string;
    alt?: string;
    clipPath?: string;
    alphaModFix?: ImageAlphaModFix;
    shapeClipPath?: string;
    objectFit?: ObjectFit;
    imageId?: string;
    imageName?: string;
  };
};

export type ShapeGroupUnknownChild = {
  shapeType: string;
  attrs: Record<string, unknown>;
};

export type ShapeGroupChild = ShapeGroupVectorChild | ShapeGroupImageChild | ShapeGroupUnknownChild;

export type DrawingBlockBase = {
  kind: 'drawing';
  id: BlockId;
  drawingKind: DrawingKind;
  margin?: BoxSpacing;
  padding?: BoxSpacing;
  anchor?: ImageAnchor;
  wrap?: ImageWrap;
  zIndex?: number;
  drawingContentId?: string;
  drawingContent?: DrawingContentSnapshot;
  attrs?: Record<string, unknown>;
  sourceAnchor?: SourceAnchor;
};

/**
 * Custom geometry path data extracted from a:custGeom/a:pathLst.
 * Each path has an SVG `d` attribute and its own coordinate space (w × h).
 */
export type CustomGeometryData = {
  paths: Array<{
    /** SVG path d attribute (M, L, C, Q, Z commands) */
    d: string;
    /** Coordinate space width for this path */
    w: number;
    /** Coordinate space height for this path */
    h: number;
  }>;
};

export type VectorShapeDrawing = DrawingBlockBase & {
  drawingKind: 'vectorShape';
  geometry: DrawingGeometry;
  shapeKind?: string;
  customGeometry?: CustomGeometryData;
  fillColor?: FillColor;
  strokeColor?: StrokeColor;
  strokeWidth?: number;
  lineEnds?: LineEnds;
  effects?: ShapeEffects;
  effectExtent?: EffectExtent;
  textContent?: ShapeTextContent;
  textAlign?: string;
  textVerticalAlign?: 'top' | 'center' | 'bottom';
  textInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type TextboxDrawing = DrawingBlockBase & {
  drawingKind: 'textboxShape';
  geometry: DrawingGeometry;
  shapeKind?: string;
  customGeometry?: CustomGeometryData;
  fillColor?: FillColor;
  strokeColor?: StrokeColor;
  strokeWidth?: number;
  lineEnds?: LineEnds;
  effects?: ShapeEffects;
  effectExtent?: EffectExtent;
  textContent?: ShapeTextContent;
  textAlign?: string;
  textVerticalAlign?: 'top' | 'center' | 'bottom';
  textInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  contentBlocks: ParagraphBlock[];
  /** Paragraph layout results for table-cell textboxes; populated by the layout bridge, read by the painter. */
  contentMeasures?: ParagraphMeasure[];
};

export type ShapeGroupDrawing = DrawingBlockBase & {
  drawingKind: 'shapeGroup';
  geometry: DrawingGeometry;
  effectExtent?: EffectExtent;
  groupTransform?: ShapeGroupTransform;
  shapes: ShapeGroupChild[];
  size?: {
    width?: number;
    height?: number;
  };
};

export type ImageDrawing = DrawingBlockBase &
  Omit<ImageBlock, 'kind' | 'id' | 'margin' | 'padding' | 'anchor' | 'wrap'> & {
    drawingKind: 'image';
  };

// ============================================================================
// Chart Drawing Types
// ============================================================================

/** A single data series in a chart (e.g., one set of bars in a bar chart). */
export type ChartSeriesData = {
  /** Display name for the series (from c:tx). */
  name: string;
  /** Category labels (from c:cat / c:strCache). */
  categories: string[];
  /** Numeric values (from c:val / c:numCache). */
  values: number[];
  /** Optional X-axis values for XY charts (scatter/bubble). */
  xValues?: number[];
  /** Optional bubble radius/size values for bubble charts. */
  bubbleSizes?: number[];
};

/** Axis configuration extracted from c:catAx / c:valAx. */
export type ChartAxisConfig = {
  title?: string;
  orientation?: 'minMax' | 'maxMin';
};

/** Normalized chart data model parsed from OOXML chart XML. */
export type ChartModel = {
  /** OOXML chart element name (e.g., 'barChart', 'lineChart', 'pieChart'). */
  chartType: string;
  /** Sub-type qualifier (e.g., 'clustered', 'stacked', 'percentStacked'). */
  subType?: string;
  /** Bar direction — 'col' for vertical columns, 'bar' for horizontal bars. */
  barDirection?: 'col' | 'bar';
  /** Data series in the chart. */
  series: ChartSeriesData[];
  /** Category axis config. */
  categoryAxis?: ChartAxisConfig;
  /** Value axis config. */
  valueAxis?: ChartAxisConfig;
  /** Legend position (e.g., 'r', 'b', 't', 'l'). */
  legendPosition?: string;
  /** OOXML chart style ID. */
  styleId?: number;
};

/** Chart drawing block. */
export type ChartDrawing = DrawingBlockBase & {
  drawingKind: 'chart';
  geometry: DrawingGeometry;
  /** Parsed chart data for rendering. */
  chartData: ChartModel;
  /** Relationship ID for the chart part in the docx package. */
  chartRelId?: string;
  /** Path to the chart XML part (e.g., 'word/charts/chart1.xml'). */
  chartPartPath?: string;
};

export type DrawingBlock = VectorShapeDrawing | TextboxDrawing | ShapeGroupDrawing | ImageDrawing | ChartDrawing;

/**
 * Vertical alignment of content within a section/page.
 * Maps to OOXML w:vAlign values in sectPr.
 */
export type SectionVerticalAlign = 'top' | 'center' | 'bottom' | 'both';

export type SectionBreakBlock = {
  kind: 'sectionBreak';
  id: BlockId;
  type?: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage';
  pageSize?: { w: number; h: number };
  orientation?: 'portrait' | 'landscape';
  margins: {
    /** Header margin (distance from top of page to header content) */
    header?: number;
    /** Footer margin (distance from bottom of page to footer content) */
    footer?: number;
    /** Top page margin (distance from top of page to body content) */
    top?: number;
    /** Right page margin */
    right?: number;
    /** Bottom page margin */
    bottom?: number;
    /** Left page margin */
    left?: number;
  };
  numbering?: SectionNumbering;
  headerRefs?: {
    default?: string;
    first?: string;
    even?: string;
    odd?: string;
  };
  footerRefs?: {
    default?: string;
    first?: string;
    even?: string;
    odd?: string;
  };
  columns?: ColumnLayout & {
    equalWidth?: boolean;
  };
  /**
   * Vertical alignment of content within the section's pages.
   * - 'top': Content starts at top margin (default behavior)
   * - 'center': Content is vertically centered between margins
   * - 'bottom': Content is aligned to bottom margin
   * - 'both': Content is vertically justified (distributed)
   */
  vAlign?: SectionVerticalAlign;
  attrs?: {
    source?: string;
    requirePageBoundary?: boolean;
    [key: string]: unknown;
  };
};

export type SectionRefType = 'default' | 'first' | 'even' | 'odd';

export type SectionRefs = {
  headerRefs?: Partial<Record<SectionRefType, string>>;
  footerRefs?: Partial<Record<SectionRefType, string>>;
};

export type SectionNumbering = {
  format?: PageNumberFormat;
  start?: number;
  chapterStyle?: number;
  chapterSeparator?: PageNumberChapterSeparator;
};

export type SectionMetadata = {
  sectionIndex: number;
  headerRefs?: Partial<Record<SectionRefType, string>>;
  footerRefs?: Partial<Record<SectionRefType, string>>;
  numbering?: SectionNumbering;
  /** Whether first page has a different header/footer (w:titlePg in OOXML) */
  titlePg?: boolean;
  /** Vertical alignment of content within this section's pages */
  vAlign?: SectionVerticalAlign;
  /** Section page margins in CSS px */
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    header?: number;
    footer?: number;
  } | null;
  /** Section page size in CSS px */
  pageSize?: { w: number; h: number } | null;
};

export type PageBreakBlock = {
  kind: 'pageBreak';
  id: BlockId;
  attrs?: Record<string, unknown>;
};

export type ColumnBreakBlock = {
  kind: 'columnBreak';
  id: BlockId;
  attrs?: Record<string, unknown>;
};

/** Positioning for anchored images (offsets in CSS px). */
export type ImageAnchor = {
  isAnchored?: boolean;
  hRelativeFrom?: 'column' | 'page' | 'margin';
  vRelativeFrom?: 'paragraph' | 'page' | 'margin';
  alignH?: 'left' | 'center' | 'right';
  alignV?: 'top' | 'center' | 'bottom';
  offsetH?: number;
  offsetV?: number;
  behindDoc?: boolean;
  padding?: BoxSpacing | undefined;
  margin?: BoxSpacing | undefined;
};

/** Text wrapping for floating images (distances in px). */
export type ImageWrap = {
  type: 'None' | 'Square' | 'Tight' | 'Through' | 'TopAndBottom' | 'Inline';
  wrapText?: 'bothSides' | 'left' | 'right' | 'largest';
  distTop?: number;
  distBottom?: number;
  distLeft?: number;
  distRight?: number;
  polygon?: number[][];
  behindDoc?: boolean;
};

/**
 * Positioning for anchored/floating tables (offsets in CSS px).
 * Corresponds to OOXML w:tblpPr attributes.
 */
export type TableAnchor = {
  isAnchored?: boolean;
  /** Horizontal anchor reference: column, page, or margin. Maps from w:horzAnchor. */
  hRelativeFrom?: 'column' | 'page' | 'margin';
  /** Vertical anchor reference: paragraph (text), page, or margin. Maps from w:vertAnchor. */
  vRelativeFrom?: 'paragraph' | 'page' | 'margin';
  /** Horizontal alignment relative to anchor. Maps from w:tblpXSpec. */
  alignH?: 'left' | 'center' | 'right' | 'inside' | 'outside';
  /** Vertical alignment relative to anchor. Maps from w:tblpYSpec. */
  alignV?: 'top' | 'center' | 'bottom' | 'inside' | 'outside' | 'inline';
  /** Absolute horizontal offset in px. Maps from w:tblpX (twips converted to px). */
  offsetH?: number;
  /** Absolute vertical offset in px. Maps from w:tblpY (twips converted to px). */
  offsetV?: number;
};

/**
 * Text wrapping for floating tables (distances in px).
 * Tables only support Square or None wrapping (not Tight/Through like images).
 */
export type TableWrap = {
  /** Wrap type: Square for text wrapping, None for absolute positioning. */
  type: 'Square' | 'None';
  /** Which side(s) text flows on. */
  wrapText?: 'bothSides' | 'left' | 'right' | 'largest';
  /** Distance from text above table (px). Maps from w:topFromText. */
  distTop?: number;
  /** Distance from text below table (px). Maps from w:bottomFromText. */
  distBottom?: number;
  /** Distance from text to left of table (px). Maps from w:leftFromText. */
  distLeft?: number;
  /** Distance from text to right of table (px). Maps from w:rightFromText. */
  distRight?: number;
};

/** Exclusion zone for text wrapping around anchored images. */
export type ExclusionZone = {
  imageBlockId: BlockId;
  pageNumber: number;
  columnIndex: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  distances: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  wrapMode: 'left' | 'right' | 'both' | 'none' | 'largest';
  polygon?: number[][];
};

export type ParagraphSpacing = {
  before?: number;
  after?: number;
  line?: number;
  lineUnit?: 'px' | 'multiplier';
  lineRule?: 'auto' | 'exact' | 'atLeast';
  beforeAutospacing?: boolean;
  afterAutospacing?: boolean;
};

export type ParagraphIndent = {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
};

export type ParagraphBorder = {
  style?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  width?: number;
  color?: string;
  space?: number;
};

export type ParagraphBorders = {
  top?: ParagraphBorder;
  right?: ParagraphBorder;
  bottom?: ParagraphBorder;
  left?: ParagraphBorder;
  between?: ParagraphBorder;
};

export type ParagraphShading = {
  fill?: string;
  color?: string;
  val?: string;
  themeColor?: string;
  themeFill?: string;
  themeFillShade?: string;
  themeFillTint?: string;
  themeShade?: string;
  themeTint?: string;
};

/**
 * Run styling for drop cap letter.
 * Contains the text and font properties of the drop cap character(s).
 */
export type DropCapRun = {
  /** The drop cap text (usually a single capital letter). */
  text: string;
  /** Font family for the drop cap. */
  fontFamily: string;
  /** Font size in pixels (typically much larger than body text, e.g., 117pt). */
  fontSize: number;
  /** Bold styling. */
  bold?: boolean;
  /** Italic styling. */
  italic?: boolean;
  /** Text color. */
  color?: string;
  /** Vertical position offset in pixels (from w:position, e.g., -10). */
  position?: number;
};

/**
 * Structured drop cap descriptor for layout engine.
 *
 * Drop caps are enlarged initial letters that span multiple lines of text.
 * OOXML encodes drop caps via w:framePr with @w:dropCap attribute on a separate
 * paragraph containing just the drop cap letter, followed by the text paragraph.
 *
 * Layout engine merges these into a single paragraph with this descriptor
 * to enable proper measurement and rendering.
 */
export type DropCapDescriptor = {
  /**
   * Drop cap mode:
   * - 'drop': Letter drops into the text area (most common)
   * - 'margin': Letter sits in the left margin
   */
  mode: 'drop' | 'margin';
  /**
   * Number of lines the drop cap spans (from w:lines attribute, typically 2-5).
   * Determines the height of the drop cap box.
   */
  lines: number;
  /**
   * The drop cap run containing text and styling.
   */
  run: DropCapRun;
  /**
   * Text wrapping mode (from w:wrap attribute on framePr).
   * - 'around': Text wraps around the drop cap (default)
   * - 'notBeside': Text does not wrap beside drop cap
   * - 'none': No special wrapping
   * - 'tight': Tight wrapping
   */
  wrap?: 'around' | 'notBeside' | 'none' | 'tight';
  /**
   * Measured width of the drop cap in pixels (populated during measurement).
   */
  measuredWidth?: number;
  /**
   * Measured height of the drop cap in pixels (populated during measurement).
   */
  measuredHeight?: number;
};

/**
 * Marker metadata for word-layout lists.
 * Contains styling and positioning information for list markers.
 */
export type WordLayoutMarker = {
  /** The text content of the marker (e.g., "1.", "a)", "•"). */
  markerText?: string;
  /** Horizontal alignment of the marker within its allocated space. */
  justification?: 'left' | 'right' | 'center';
  /** Spacing between marker text and paragraph content in pixels. */
  gutterWidthPx?: number;
  /** Total width allocated for the marker box in pixels. */
  markerBoxWidthPx?: number;
  /** Type of separator between marker and text (tab, space, or nothing). */
  suffix?: 'tab' | 'space' | 'nothing';
  /** Pre-calculated X position where the marker should be placed (used in firstLineIndentMode). */
  markerX?: number;
  /** Pre-calculated X position where paragraph text should begin after the marker (used in firstLineIndentMode). */
  textStartX?: number;
  /** Style properties for the marker text. */
  run: {
    fontFamily: string;
    fontSize: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    letterSpacing?: number;
    vanish?: boolean;
  };
};

/**
 * Word layout configuration for list items created via input rules.
 *
 * This type represents the structure of wordLayout data produced by @superdoc/word-layout
 * for paragraphs with list markers. It contains metadata about marker positioning and
 * text alignment that differs from standard hanging-indent lists.
 *
 * Two distinct list rendering modes exist:
 * 1. **Standard hanging indent**: Marker sits in hanging indent area, text starts at paraIndentLeft
 * 2. **First-line indent mode**: Marker is at paraIndentLeft + firstLine, text starts at textStartPx
 *
 * This type enables type-safe access to word-layout-specific properties without unsafe casts.
 *
 * @example
 * ```typescript
 * // Standard hanging indent list (marker in hanging indent area)
 * const standardListConfig: WordLayoutConfig = {
 *   marker: {
 *     markerText: "1.",
 *     justification: "right",
 *     gutterWidthPx: 18
 *   }
 * };
 * // Text starts at paraIndentLeft, marker is placed in hanging indent area
 * ```
 *
 * @example
 * ```typescript
 * // First-line indent mode list (input-rule created, e.g., typing "1. ")
 * const firstLineIndentConfig: WordLayoutConfig = {
 *   firstLineIndentMode: true,
 *   textStartPx: 56,  // Pre-calculated: paraIndentLeft + firstLine + markerWidth + tabWidth
 *   marker: {
 *     markerText: "1.",
 *     markerX: 36,      // Position where marker renders
 *     textStartX: 56    // Where text starts after marker
 *   }
 * };
 * // Text starts at textStartPx (56px), marker is at markerX (36px)
 * ```
 *
 * @example
 * ```typescript
 * // Checking for first-line indent mode in layout code
 * const wordLayout = block.attrs?.wordLayout;
 * if (wordLayout?.firstLineIndentMode) {
 *   const textStart = wordLayout.textStartPx ?? 0;
 *   // Use textStart for positioning text on first line
 * } else {
 *   // Use standard hanging indent calculations
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Non-list paragraph (no word layout config)
 * const regularParagraph = {
 *   kind: 'paragraph',
 *   attrs: {
 *     indent: { left: 36, firstLine: 18 }
 *     // No wordLayout property
 *   }
 * };
 * // Text positioning uses standard paragraph indent logic
 * ```
 */
export type WordLayoutConfig = {
  /**
   * Whether this list uses first-line indent mode (true for input-rule-created lists).
   * When true, text positioning uses textStartPx instead of standard hanging indent calculations.
   */
  firstLineIndentMode?: boolean;
  /**
   * Absolute X position in pixels where text content starts on the first line.
   * Includes marker width, tab width, and any additional spacing.
   * Only meaningful when firstLineIndentMode is true.
   */
  textStartPx?: number;
  /**
   * Marker metadata for word-layout lists.
   * Present when the paragraph is part of a list structure.
   */
  marker?: WordLayoutMarker;
  /**
   * Additional word-layout properties may be present but are not yet typed.
   */
  [key: string]: unknown;
};

export type ParagraphAttrs = {
  styleId?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spacing?: ParagraphSpacing;
  /**
   * Indicates which spacing properties were explicitly set on the paragraph.
   * Used to preserve Word behavior for empty paragraphs when spacing only comes
   * from docDefaults or styles.
   */
  spacingExplicit?: {
    before?: boolean;
    after?: boolean;
    line?: boolean;
  };
  contextualSpacing?: boolean;
  indent?: ParagraphIndent;
  /** Word quirk: justified paragraphs ignore first-line indent. Set by pm-adapter. */
  suppressFirstLineIndent?: boolean;
  /**
   * Legacy drop cap flag from w:framePr/@w:dropCap.
   * @deprecated Use dropCapDescriptor for full drop cap support.
   */
  dropCap?: string | number | boolean;
  /**
   * Structured drop cap descriptor with full metadata.
   * When present, layout engine will render the drop cap with proper geometry.
   */
  dropCapDescriptor?: DropCapDescriptor;
  frame?: ParagraphFrame;
  numberingProperties?: { ilvl?: number; numId?: number } | null;
  /** Built-in heading level resolved from style metadata, where 1 means Heading 1. */
  headingLevel?: number;
  /** Current list level ordinal from structured numbering metadata. */
  listLevelOrdinal?: number;
  borders?: ParagraphBorders;
  shading?: ParagraphShading;
  tabs?: TabStop[];
  decimalSeparator?: string;
  tabIntervalTwips?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  trackedChangesMode?: TrackedChangesMode;
  trackedChangesEnabled?: boolean;
  /** Marks an empty paragraph that only exists to carry section properties. */
  sectPrMarker?: boolean;
  /**
   * The paragraph break should not produce a visible line break: the next
   * paragraph's runs fuse into this block during pm-adapter post-processing
   * and the successor's auto-generated list marker disappears with it.
   * Numbering counters on subsequent paragraphs still advance per OOXML
   * paragraph, matching Word.
   *
   * Triggered by `w:vanish` on the paragraph-mark rPr (`w:pPr/w:rPr`).
   * ECMA-376 §17.3.2.36 reads as if `w:specVanish` is the trigger ("a
   * paragraph mark shall never be used to break the end of a paragraph for
   * display"), but Word 16.0 fuses on `w:vanish` and leaves `w:specVanish`
   * standalone as a no-op for the paragraph break (SD-3269 fixture matrix).
   * Matching Word, not the literal spec, is the rendering goal.
   */
  suppressParagraphBreak?: boolean;
  /**
   * Resolved direction context for the paragraph (inline direction + writing mode).
   * Single source of truth for paragraph direction-aware rendering decisions.
   *
   * Read via `getParagraphInlineDirection(attrs)` rather than inspecting this
   * field directly so the helper can normalize `null` vs `undefined` and fall
   * back to `paragraphProperties.rightToLeft` for PM-node / editor paths.
   *
   * See `@superdoc/contracts/direction-context` for axis semantics.
   */
  directionContext?: ParagraphDirectionContext;
  isTocEntry?: boolean;
  tocInstruction?: string;
  /** Stable id shared by every paragraph in the same TOC (docPartObj uniqueId or parent sdBlockId). */
  tocId?: string;
  /** Floating alignment for positioned paragraphs (from w:framePr/@w:xAlign). */
  floatAlignment?: 'left' | 'right' | 'center';
  /**
   * Word paragraph layout output from @superdoc/word-layout.
   * Contains metadata about list marker positioning and text alignment for word-layout lists.
   * Use WordLayoutConfig type for type-safe access to known properties.
   */
  wordLayout?: WordLayoutConfig;
  sdt?: SdtMetadata;
  /** Container SDT for blocks with both primary and container metadata. */
  containerSdt?: SdtMetadata;
};

export type ParagraphFrame = {
  wrap?: string;
  x?: number;
  y?: number;
  xAlign?: 'left' | 'right' | 'center';
  yAlign?: 'top' | 'center' | 'bottom';
  hAnchor?: string;
  vAnchor?: string;
};

export type ListMarker = {
  kind: 'bullet' | 'number';
  text: string;
  level: number;
  order?: number;
  style?: string;
  numId?: string;
  levels?: number[];
  numberingType?: string;
  lvlText?: string;
  customFormat?: string;
  align?: 'left' | 'center' | 'right';
  sourceAnchor?: SourceAnchor;
};

export type ListItem = {
  id: BlockId;
  marker: ListMarker;
  paragraph: ParagraphBlock;
  sourceAnchor?: SourceAnchor;
};

export type ListBlock = {
  kind: 'list';
  id: BlockId;
  listType: 'bullet' | 'number';
  items: ListItem[];
  sourceAnchor?: SourceAnchor;
};

export type FlowBlock =
  | ParagraphBlock
  | ImageBlock
  | DrawingBlock
  | ListBlock
  | TableBlock
  | SectionBreakBlock
  | PageBreakBlock
  | ColumnBreakBlock;

export type ColumnLayout = {
  count: number;
  gap: number;
  withSeparator?: boolean;
  widths?: number[];
  equalWidth?: boolean;
  /**
   * Per-column inter-column gaps in px, length `count - 1`: the gap after each column except the
   * last. Explicit mode (`equalWidth === false`) only, derived from each `<w:col w:space>`; equal
   * mode uses the scalar `gap`. When absent, consumers fall back to the uniform `gap`. (SD-2629)
   */
  gaps?: number[];
};

/**
 * A vertical region of a page that shares a single column configuration.
 *
 * Continuous section breaks can introduce multiple column configurations on the
 * same page (see ECMA-376 §17.6.22 and §17.18.77). A page may therefore carry
 * multiple regions stacked vertically. Consumers (e.g. DomPainter) use
 * `yStart`/`yEnd` to bound any per-region overlays such as column separators.
 */
export type ColumnRegion = {
  /** Inclusive top of the region, in pixels from the page top. */
  yStart: number;
  /** Exclusive bottom of the region, in pixels from the page top. */
  yEnd: number;
  /** Column configuration active within this region. */
  columns: ColumnLayout;
};

/** A measured line within a block, output by the measurer. */
export type Line = {
  fromRun: number;
  fromChar: number;
  toRun: number;
  toChar: number;
  width: number;
  ascent: number;
  descent: number;
  lineHeight: number;
  /** Maximum available width for this line (used during measurement). */
  maxWidth?: number;
  /** Content width before justify compression (used for negative word-spacing calculation). */
  naturalWidth?: number;
  /** Number of spaces in the line (pre-computed for efficiency in justify calculations). */
  spaceCount?: number;
  /** True when this line used author-defined OOXML tab stops, not synthesized default stops. */
  hasExplicitTabStops?: boolean;
  segments?: LineSegment[];
  leaders?: LeaderDecoration[];
  bars?: BarDecoration[];
};

export type LineSegment = {
  runIndex: number;
  fromChar: number;
  toChar: number;
  width: number;
  x?: number;
  /** End x for an immediately preceding tab when it differs from this segment's paint x. */
  precedingTabEndX?: number;
};

export type LeaderDecoration = {
  from: number;
  to: number;
  style: 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';
};

export type BarDecoration = {
  x: number;
};

export type ParagraphMeasure = {
  kind: 'paragraph';
  lines: Line[];
  totalHeight: number;
  marker?: {
    markerWidth: number;
    /**
     * The actual rendered text width of the marker glyphs in pixels (e.g., "1." text width).
     * This represents the precise width of the marker text content, as opposed to markerWidth
     * which includes padding and represents the full marker box width.
     *
     * Used by the renderer for tab positioning calculations to match Word's behavior, where
     * tabs extend from the end of the actual marker text (not the marker box edge) to the
     * next tab stop. This ensures proper alignment between the marker and paragraph content.
     *
     * When undefined or null, the renderer falls back to using markerWidth for compatibility.
     *
     * @see markerWidth - The full marker box width including padding
     * @see ParagraphFragment.markerTextWidth - The corresponding property in layout fragments
     */
    markerTextWidth: number;
    indentLeft: number;
    /**
     * The gutter (spacing) width between the marker text and the paragraph content, in pixels.
     * Used by the renderer for calculating tab stops in word-layout lists.
     * When present, this value comes from Word's gutterWidthPx and is used to match Word's
     * list marker tab alignment behavior.
     */
    gutterWidth?: number;
  };
  /**
   * Measured drop cap information, populated when the paragraph has a drop cap.
   * Used by the renderer to position the drop cap element.
   */
  dropCap?: {
    /** Measured width of the drop cap box (including padding). */
    width: number;
    /** Measured height of the drop cap (based on lines * lineHeight). */
    height: number;
    /** Number of lines the drop cap spans. */
    lines: number;
    /** Drop cap mode: 'drop' inside text area, 'margin' in the margin. */
    mode: 'drop' | 'margin';
  };
};

export type ImageMeasure = {
  kind: 'image';
  width: number;
  height: number;
};

export type DrawingMeasure = {
  kind: 'drawing';
  drawingKind: DrawingKind;
  width: number;
  height: number;
  scale: number;
  naturalWidth: number;
  naturalHeight: number;
  geometry: DrawingGeometry;
  groupTransform?: ShapeGroupTransform;
};

export type TableCellMeasure = {
  /** Multi-block cell measurements (new feature) */
  blocks?: Measure[];
  /** Single paragraph measure (backward compatibility) */
  paragraph?: ParagraphMeasure;
  width: number;
  height: number;
  /** Starting grid column index (0-based) */
  gridColumnStart?: number;
  /** Number of grid columns this cell spans */
  colSpan?: number;
  /** Number of rows this cell spans */
  rowSpan?: number;
};

export type TableRowMeasure = {
  cells: TableCellMeasure[];
  height: number;
};

/** Outer table border widths in pixels (top, right, bottom, left). Used for total dimensions and content offset. */
export type TableBorderWidths = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type TableMeasure = {
  kind: 'table';
  rows: TableRowMeasure[];
  columnWidths: number[];
  totalWidth: number;
  totalHeight: number;
  /**
   * Cell spacing in pixels (border-spacing between cells).
   * Used for total table dimensions and cell x/y positioning when border-collapse is 'separate'.
   */
  cellSpacingPx?: number;
  /**
   * Outer table border widths in pixels. Included in totalWidth/totalHeight; content is offset by (left, top).
   */
  tableBorderWidths?: TableBorderWidths;
};

export type CellSpacing = {
  type: 'dxa' | 'px';
  value: number;
};

export type SectionBreakMeasure = {
  kind: 'sectionBreak';
};

export type PageBreakMeasure = {
  kind: 'pageBreak';
};

export type ColumnBreakMeasure = {
  kind: 'columnBreak';
};

export type ListItemMeasure = {
  itemId: BlockId;
  markerWidth: number;
  markerTextWidth: number;
  indentLeft: number;
  paragraph: ParagraphMeasure;
};

export type ListMeasure = {
  kind: 'list';
  items: ListItemMeasure[];
  totalHeight: number;
};

export type Measure =
  | ParagraphMeasure
  | ImageMeasure
  | DrawingMeasure
  | TableMeasure
  | ListMeasure
  | SectionBreakMeasure
  | PageBreakMeasure
  | ColumnBreakMeasure;

/** A rendered page containing positioned fragments. Page numbers are 1-indexed. */
/**
 * SD-2656: per-page footnote planning ledger.
 *
 * The single source of truth that body pagination, footnote placement, and
 * continuation carry must all agree on. Without it the three subsystems read
 * different numbers (body reserves X, planner paints Y, carry-forward thinks
 * Z) and the resulting drift compounds across the document.
 *
 * Mandatory invariants checked by `tools/sd-2656-footnote-analyzer`:
 *   1. `actualBandHeight <= appliedBodyReserve`  (band fits)
 *   2. `mandatorySlices` always equals `full(non-last) + firstLine(last)` of
 *      the page's anchored cluster (rule).
 *   3. `continuationIn[P]` matches `continuationOut[P-1]` (carry parity).
 *   4. `deadReserve = appliedBodyReserve - actualBandHeight` is small (drift
 *      fuel above ~30 px is a planning bug).
 */
export type FootnoteContinuationEntry = {
  /** Footnote id (OOXML id, not the Word visible number). */
  id: string;
  /** How many ranges remain to render. */
  remainingRangeCount: number;
  /** Total height of the remaining ranges. */
  remainingHeightPx: number;
};

export type FootnotePageLedger = {
  pageIndex: number;
  /** Ordered footnote ids whose body refs are anchored on this page. */
  anchorIds: string[];
  /** Slices required by the rule: full of non-last + firstLine of last. */
  mandatorySliceIds: string[];
  /** Slices for content drained from prior pages. */
  continuationSliceIds: string[];
  /** Slices for last-anchor content beyond firstLine (rendered only if there
   *  is leftover space after mandatory + continuation). */
  extendedSliceIds: string[];
  /** Continuations arriving from page-1. */
  continuationIn: FootnoteContinuationEntry[];
  /** Continuations deferred to page+1. */
  continuationOut: FootnoteContinuationEntry[];
  /** Mandatory-reserve px: mandatorySlices height + overhead. */
  mandatoryReservePx: number;
  /** SD-2656 Phase 7: Word-like "preferred" reserve px. Body slicer is allowed
   *  to reserve this much when doing so does not cause cluster spill or
   *  continuation overflow. = full(non-last) + asMuchAsFits(last) + overhead. */
  preferredReservePx: number;
  /** Total painted band height in px, including separator + gaps. */
  actualBandHeightPx: number;
  /** Body's applied reserve (i.e. `page.footnoteReserved`) for this page. */
  appliedBodyReservePx: number;
  /** appliedBodyReservePx - actualBandHeightPx — wasted body area. */
  deadReservePx: number;
  /** Number of measured lines actually rendered for the LAST anchor on this
   *  page (0 if there is no cluster anchor). Used to flag "mandatory-only"
   *  pages where Word would have rendered more. */
  lastAnchorRenderedLines: number;
};

export type Page = {
  number: number;
  fragments: Fragment[];
  margins?: PageMargins;
  /**
   * Extra bottom space reserved on this page for footnotes (in px).
   * Used by consumers (e.g. editors/painters) to keep footer hit regions and
   * decoration boxes anchored to the real bottom margin while the body shrinks.
   */
  footnoteReserved?: number;
  /**
   * SD-2656: page-level footnote planning ledger. Populated by the layout
   * bridge when footnotes are present. Read by the diagnostic toolkit and
   * (in later phases) by body pagination itself.
   */
  footnoteLedger?: FootnotePageLedger;
  /** Numeric page number after section numbering restart/offset. Used for OOXML odd/even parity. */
  displayNumber?: number;
  numberText?: string;
  /** Numeric page number after section page numbering settings are applied. */
  effectivePageNumber?: number;
  /** Section PAGE number format before any run-local PAGE switch is applied. */
  pageNumberFormat?: PageNumberFormat;
  /** MVP chapter prefix text derived from the nearest numbered Heading N marker. */
  pageNumberChapterText?: string;
  /** Separator between chapter prefix and page number component. */
  pageNumberChapterSeparator?: PageNumberChapterSeparator;
  size?: { w: number; h: number };
  orientation?: 'portrait' | 'landscape';
  sectionRefs?: {
    headerRefs?: { default?: string; first?: string; even?: string; odd?: string };
    footerRefs?: { default?: string; first?: string; even?: string; odd?: string };
  };
  /**
   * Vertical alignment of content within this page.
   * Used for post-layout adjustment of fragment Y positions.
   */
  vAlign?: SectionVerticalAlign;
  /**
   * Base section margins before header/footer inflation.
   * Used for vAlign centering calculations to match Word's behavior
   * where headers/footers don't affect vertical alignment.
   */
  baseMargins?: { top: number; bottom: number };
  /**
   * Index of the section this page belongs to.
   * Used for section-aware page numbering and header/footer selection.
   * Sections are 0-indexed, matching the sectionIndex in SectionMetadata.
   */
  sectionIndex?: number;
  /**
   * Column layout configuration for this page.
   *
   * Reflects the column configuration at page start. For pages with continuous
   * section breaks that change column layout mid-page, use `columnRegions` for
   * accurate per-region information.
   *
   * Used by the renderer to draw column separator lines when `withSeparator`
   * is set to true.
   */
  columns?: ColumnLayout;
  /**
   * Vertical column regions on this page, ordered top to bottom.
   *
   * Populated when continuous section breaks change column layout mid-page. Each
   * region pairs a `{yStart, yEnd}` span with the column config active inside it
   * (see ECMA-376 §17.6.22). Renderers should prefer this field over
   * `columns` when drawing per-region overlays (e.g. column separators).
   *
   * If omitted, the page has a single column region and consumers can fall back
   * to `columns`.
   */
  columnRegions?: ColumnRegion[];
};

/** A paragraph fragment positioned on a page. */
export type ParaFragment = {
  kind: 'para';
  blockId: BlockId;
  fromLine: number;
  toLine: number;
  x: number;
  y: number;
  width: number;
  continuesFromPrev?: boolean;
  continuesOnNext?: boolean;
  /** The marker box width in pixels (includes padding). Used for visual sizing. */
  markerWidth?: number;
  /**
   * The actual rendered text width of the marker glyphs in pixels (e.g., "1." text width).
   * Used for tab width calculation to match Word's behavior where the tab extends from
   * the end of the actual marker text to the next tab stop, not from the box edge.
   */
  markerTextWidth?: number;
  /**
   * The gutter width for word-layout list markers, in pixels.
   * This value is propagated from ParagraphMeasure.marker.gutterWidth and is used by the
   * renderer to calculate tab stop widths for right-justified or centered markers.
   * Only present for word-layout lists with marker.gutterWidth defined.
   */
  markerGutter?: number;
  /**
   * Remeasured lines for this fragment when the paragraph was re-wrapped at a different width.
   * When present, the renderer should use these lines instead of looking up lines from
   * the original measure using fromLine/toLine indices. This occurs when a paragraph
   * measured at one column width is placed in a narrower column (e.g., multi-column layouts).
   */
  lines?: Line[];
  pmStart?: number;
  pmEnd?: number;
  sourceAnchor?: SourceAnchor;
  /**
   * Optional editor-neutral identity for this fragment.
   *
   * Additive (prep-001). PM-facing `pmStart`/`pmEnd` and `blockId` remain
   * authoritative for v1 consumers; this field exists so downstream surfaces
   * can address rendered output without requiring `pmStart`/`pmEnd`. See
   * `layout-identity.ts`.
   */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type TableColumnBoundary = {
  index: number;
  x: number;
  width: number;
  minWidth: number;
  resizable: boolean;
};

export type TableRowBoundary = {
  index: number;
  y: number;
  height: number;
  minHeight: number;
  resizable: boolean;
};

export type TableFragmentMetadata = {
  columnBoundaries: TableColumnBoundary[];
  rowBoundaries?: TableRowBoundary[];
  coordinateSystem: 'fragment';
};

export type ImageFragmentMetadata = {
  originalWidth: number;
  originalHeight: number;
  maxWidth: number;
  maxHeight: number;
  aspectRatio: number;
  minWidth: number;
  minHeight: number;
};

export type PartialRowInfo = {
  rowIndex: number; // Which row is partially split
  fromLineByCell: number[]; // Per-cell line start (inclusive) - 0 for first part
  toLineByCell: number[]; // Per-cell line cutoff (exclusive) - -1 means render to end
  isFirstPart: boolean; // True if this is the first part of a split row
  isLastPart: boolean; // True if this is the last part of a split row
  /** Height of this partial row portion in pixels */
  partialHeight: number;
};

export type TableFragment = {
  kind: 'table';
  blockId: BlockId;
  /** Flow column that owns this fragment, distinct from visual x when overflow crosses margins. */
  columnIndex?: number;
  fromRow: number;
  toRow: number;
  x: number;
  y: number;
  width: number;
  height: number;
  continuesFromPrev?: boolean;
  continuesOnNext?: boolean;
  repeatHeaderCount?: number;
  partialRow?: PartialRowInfo;
  metadata?: TableFragmentMetadata;
  pmStart?: number;
  pmEnd?: number;
  /** Per-fragment column widths, rescaled when table is clamped to section width.
   *  When set, the renderer uses these instead of measure.columnWidths. */
  columnWidths?: number[];
  sourceAnchor?: SourceAnchor;
  /** Optional editor-neutral identity (prep-001). See `ParaFragment.layoutSourceIdentity`. */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type ImageFragment = {
  kind: 'image';
  blockId: BlockId;
  x: number;
  y: number;
  width: number;
  height: number;
  isAnchored?: boolean;
  behindDoc?: boolean;
  zIndex?: number;
  pmStart?: number;
  pmEnd?: number;
  metadata?: ImageFragmentMetadata;
  sourceAnchor?: SourceAnchor;
  /** Optional editor-neutral identity (prep-001). See `ParaFragment.layoutSourceIdentity`. */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type DrawingFragment = {
  kind: 'drawing';
  blockId: BlockId;
  drawingKind: DrawingKind;
  x: number;
  y: number;
  width: number;
  height: number;
  isAnchored?: boolean;
  behindDoc?: boolean;
  zIndex?: number;
  geometry: DrawingGeometry;
  scale: number;
  drawingContentId?: string;
  contentMeasures?: ParagraphMeasure[];
  pmStart?: number;
  pmEnd?: number;
  sourceAnchor?: SourceAnchor;
  /** Optional editor-neutral identity (prep-001). See `ParaFragment.layoutSourceIdentity`. */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type ListItemFragment = {
  kind: 'list-item';
  blockId: BlockId;
  itemId: BlockId;
  fromLine: number;
  toLine: number;
  x: number;
  y: number;
  width: number;
  markerWidth: number;
  continuesFromPrev?: boolean;
  continuesOnNext?: boolean;
  sourceAnchor?: SourceAnchor;
  /** Optional editor-neutral identity (prep-001). See `ParaFragment.layoutSourceIdentity`. */
  layoutSourceIdentity?: LayoutSourceIdentity;
};

export type Fragment = ParaFragment | ImageFragment | DrawingFragment | ListItemFragment | TableFragment;

export type HeaderFooterType = 'default' | 'first' | 'even' | 'odd';

export type HeaderFooterPage = {
  number: number;
  fragments: Fragment[];
  numberText?: string;
  /** Section-aware numeric page value before formatting. */
  displayNumber?: number;
  /** Section PAGE number format before any run-local PAGE switch is applied. */
  pageNumberFormat?: PageNumberFormat;
  /** MVP chapter prefix text derived from the nearest numbered Heading N marker. */
  pageNumberChapterText?: string;
  /** Separator between chapter prefix and page number component. */
  pageNumberChapterSeparator?: PageNumberChapterSeparator;
  /**
   * Optional page-local block clones backing this page's resolved fragments.
   * Present when header/footer tokens were laid out per page or per bucket.
   */
  blocks?: FlowBlock[];
  /**
   * Optional page-local measures aligned with `blocks`.
   * Present when header/footer tokens were laid out per page or per bucket.
   */
  measures?: Measure[];
};

export type HeaderFooterLayout = {
  /** Measurement height for pagination — excludes out-of-band fragments. */
  height: number;
  /** Minimum y of all rendered fragments (including out-of-band). */
  minY?: number;
  /** Maximum y + fragmentHeight of all rendered fragments. */
  maxY?: number;
  /** Full visual extent of all rendered fragments (renderMaxY - renderMinY). */
  renderHeight?: number;
  pages: HeaderFooterPage[];
};

/** Final layout output ready for painting. */
export type Layout = {
  pageSize: { w: number; h: number };
  pages: Page[];
  /** Optional document-level page background from OOXML w:background. */
  documentBackground?: DocumentBackground;
  columns?: ColumnLayout;
  headerFooter?: Partial<Record<HeaderFooterType, HeaderFooterLayout>>;
  /**
   * Gap between pages in pixels. Used by hit testing to correctly calculate
   * which page a click lands on when pages are rendered with spacing between them.
   * Defaults to 0 if not specified (pages assumed to be stacked with no gap).
   */
  pageGap?: number;
  /**
   * Document epoch identifier for the document state used to produce this layout.
   *
   * This value is set by higher-level orchestration (e.g., PresentationEditor) and is
   * stamped into the painted DOM as `data-layout-epoch` to enable deterministic mapping
   * from DOM-derived positions back to the current ProseMirror document state.
   */
  layoutEpoch?: number;
};

export type WrapTextMode = 'bothSides' | 'left' | 'right' | 'largest';

export type WrapExclusion = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  wrapText: WrapTextMode;
};

/**
 * Rendering flow mode.
 * - `paginated`: discrete page surfaces
 * - `semantic`: continuous flow surface
 */
export type FlowMode = 'paginated' | 'semantic';

export const extractHeaderFooterSpace = (
  margins?: PageMargins | null,
): {
  headerSpace: number;
  footerSpace: number;
} => {
  return {
    headerSpace: margins?.header ?? 0,
    footerSpace: margins?.footer ?? 0,
  };
};

// Resolved layout types for the next-generation paint pipeline
export type {
  ResolvedLayout,
  ResolvedPage,
  ResolvedPaintItem,
  ResolvedGroupItem,
  ResolvedFragmentItem,
  ResolvedParagraphContent,
  ResolvedTextLineItem,
  ResolvedDropCapItem,
  ResolvedListMarkerItem,
  ResolvedTableItem,
  ResolvedImageItem,
  ResolvedDrawingItem,
  ResolvedHeaderFooterPage,
  ResolvedHeaderFooterLayout,
} from './resolved-layout.js';
export { isResolvedTableItem, isResolvedImageItem, isResolvedDrawingItem } from './resolved-layout.js';

// Pure transformations on inline-run shapes (used by pm-adapter, layout-bridge,
// and painter-dom). Located in contracts to avoid reverse stage dependencies.
export {
  expandRunsForInlineNewlines,
  isEmptyInlineSdtPlaceholderRun,
  isEmptySdtPlaceholderRun,
  sliceRunsForLine,
} from './run-helpers.js';

export * as Engines from './engines/index.js';
