import type { AdapterMutationFailure } from './adapter-result.js';
import type { SelectionTarget } from './address.js';
import type { ReceiptFailure, ReceiptSuccess, ReviewWarning } from './receipt.js';
import type { SDConversionDiagnostic, SDDiagnostic } from './sd-contract.js';
import type { StoryLocator } from './story.types.js';

export const SUPERDOC_V2_CLIPBOARD_MIME = 'application/x-superdoc-v2-fragment';
export const SUPERDOC_V22_CLIPBOARD_MIME = 'application/x-superdoc-v2-fragment-v2.2';
export const SUPERDOC_V1_CLIPBOARD_MIME = 'application/x-superdoc-slice';
export const SUPERDOC_V2_CLIPBOARD_FRAGMENT_KIND = 'superdoc.clipboard.fragment';
export const SUPERDOC_V2_CLIPBOARD_FRAGMENT_VERSION = 'v2.1';
export const SUPERDOC_V22_CLIPBOARD_FRAGMENT_VERSION = 'v2.2';
export const MAX_V22_ASSET_DECODED_BYTES = 20 * 1024 * 1024;
export const MAX_V22_TOTAL_DECODED_BYTES = 40 * 1024 * 1024;
export const MAX_V22_ASSET_COUNT = 16;
export const MAX_V22_IMAGE_REF_COUNT = 64;
export const MAX_V22_PAYLOAD_BYTES = 56 * 1024 * 1024;

export type ClipboardSourceKind =
  | 'superdoc-v2-fragment'
  | 'superdoc-v1-slice'
  | 'html'
  | 'rtf'
  | 'image'
  | 'file'
  | 'plain-text'
  | 'empty'
  | 'unknown';

export type SDPasteUnsupportedReason =
  | 'paste-empty'
  | 'paste-payload-too-large'
  | 'paste-depth-exceeded'
  | 'paste-source-unsupported'
  | 'paste-fragment-version-unsupported'
  | 'paste-no-faithful-representation'
  | 'paste-structure-unsupported'
  | 'paste-media-unsupported-type'
  | 'paste-media-bad-magic'
  | 'paste-media-too-large'
  | 'paste-tracked-structural-unsupported'
  | 'paste-cross-story-unsupported'
  | 'paste-target-unsupported'
  | 'paste-legacy-slice-unsupported'
  | 'paste-security-rejected';

export interface ClipboardPayloadItem {
  /** MIME type, for example `text/plain`, `text/html`, or `application/x-superdoc-v2-fragment`. */
  type: string;
  kind: 'string' | 'bytes';
  data: string | Uint8Array;
  name?: string;
}

export interface ClipboardPayload {
  source?: ClipboardSourceKind | 'browser' | 'api';
  items: readonly ClipboardPayloadItem[];
}

export type ClipboardFallbackPolicy = 'reject-rich' | 'plain-with-warning';

export interface ClipboardParseOptions {
  fallback?: ClipboardFallbackPolicy;
  maxBytes?: number;
  maxDepth?: number;
}

export interface SDPasteRunMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  highlight?: string;
  fontSizePt?: number;
  fontFamily?: string;
  verticalAlign?: 'baseline' | 'superscript' | 'subscript';
}

export interface SDPasteRun {
  text: string;
  marks?: SDPasteRunMarks;
  /** Transient conversion identity used to map mutation effects back to source nodes. */
  sourcePath?: readonly (string | number)[];
  /**
   * Clipboard-local comment identities overlapping this run. Paste mints
   * fresh destination ids; source comments stay intact.
   */
  commentIds?: readonly string[];
  /** True when this run is a tracked insertion that paste must wrap in a fresh `w:ins`. */
  trackedInsertion?: boolean;
}

export interface SDPasteComment {
  /** Clipboard-local id referenced by {@link SDPasteRun.commentIds}. */
  id: string;
  text: string;
  author?: string;
}

export interface SDPasteParagraphProperties {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: {
    start?: number;
    end?: number;
    left?: number;
    right?: number;
    firstLine?: number;
    hanging?: number;
  };
  spacing?: {
    before?: number;
    after?: number;
    line?: number;
    lineRule?: 'auto' | 'exact' | 'atLeast';
  };
}

export type SDPasteLeafInline =
  | {
      kind: 'text';
      text: string;
      marks?: SDPasteRunMarks;
      sourcePath?: readonly (string | number)[];
      commentIds?: readonly string[];
      trackedInsertion?: boolean;
    }
  | { kind: 'lineBreak'; sourcePath?: readonly (string | number)[] }
  | {
      kind: 'image';
      assetId: string;
      widthPx: number;
      heightPx: number;
      name?: string;
      alt?: string;
      title?: string;
      sourcePath?: readonly (string | number)[];
    };

export type SDPasteInline =
  | SDPasteLeafInline
  | {
      kind: 'hyperlink';
      target: { kind: 'external'; url: string } | { kind: 'anchor'; anchor: string };
      inlines: readonly SDPasteLeafInline[];
      tooltip?: string;
      sourcePath?: readonly (string | number)[];
    };

export interface SDPasteParagraphBlock {
  kind: 'paragraph';
  runs: readonly SDPasteRun[];
  inlines?: readonly SDPasteInline[];
  paragraphProps?: SDPasteParagraphProperties;
  styleRef?: string;
  /** Portable built-in style intent; destination style identity remains local. */
  semanticStyleRole?: 'default-paragraph' | 'title' | 'subtitle' | `heading-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
  numbering?: {
    numId: string;
    ilvl: string;
  };
  /**
   * Portable list membership intent. Without `numbering`, the kernel always
   * materializes a fresh definition. With `numbering`, the existing identity
   * is retained when the destination defines the same list kind; otherwise
   * this intent is the cross-document fallback. `level` is zero-based and
   * bounded to OOXML's nine list levels; omitted means level 0.
   */
  listIntent?: {
    kind: 'bullet' | 'ordered';
    level?: number;
    /** True on the first block of a distinct adjacent portable list. */
    startsNewList?: boolean;
    /** Positive ordinal for an ordered-list restart at `level`. */
    start?: number;
    format?: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';
    text?: string;
  };
  listItemContinuationLevel?: number;
  /**
   * Pre-validated direct `<w:pPr>` properties. Same-document copy carries the
   * source paragraph's materialized properties for fidelity; external HTML
   * paste may synthesize the supported portable subset (for example alignment).
   * When present it wins over styleRef/numbering rendering, which remain
   * derived alongside it for HTML flavors and older receivers. The kernel
   * validates shape strictly and rejects section properties.
   */
  pPrXml?: string;
  /**
   * True when the block represents a COMPLETE source paragraph (the copy
   * covered its paragraph mark). Complete paragraphs never merge into the
   * paste anchor's paragraph, independent of whether they carry formatting.
   */
  complete?: boolean;
  /** Transient conversion identity used to map mutation effects back to source nodes. */
  sourcePath?: readonly (string | number)[];
}

export interface SDPasteHeadingBlock extends Omit<SDPasteParagraphBlock, 'kind' | 'semanticStyleRole'> {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface SDPasteHorizontalRuleBlock {
  kind: 'horizontalRule';
  sourcePath?: readonly (string | number)[];
}

export interface SDPasteTableCell {
  /** Cell content: paragraph blocks rendered through the shared paste renderer. */
  blocks: readonly SDPasteParagraphBlock[];
  /** Horizontal merge span (colspan). */
  gridSpan?: number;
  /** Direct cell shading fill as canonical hex RRGGBB. */
  shadingColor?: string;
  /** Direct cell padding in points. At least one side must be present. */
  padding?: {
    topPt?: number;
    rightPt?: number;
    bottomPt?: number;
    leftPt?: number;
  };
  sourcePath?: readonly (string | number)[];
}

export interface SDPasteTableRow {
  cells: readonly SDPasteTableCell[];
  header?: boolean;
  sourcePath?: readonly (string | number)[];
}

/**
 * Table paste block: rendered as `w:tbl` with V1-parity defaults. Cell
 * content is paragraph blocks only, so nested tables are impossible by
 * construction; tracked-mode table paste rejects typed.
 */
export interface SDPasteTableBlock {
  kind: 'table';
  rows: readonly SDPasteTableRow[];
  sourcePath?: readonly (string | number)[];
}

export type SDPasteBlock = SDPasteParagraphBlock | SDPasteHeadingBlock | SDPasteHorizontalRuleBlock | SDPasteTableBlock;

export interface SDPasteAsset {
  id: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  name?: string;
}

export interface SDPasteAssetWire {
  id: string;
  mimeType: 'image/png' | 'image/jpeg';
  data: string;
}

export interface SDPasteFragment {
  kind: typeof SUPERDOC_V2_CLIPBOARD_FRAGMENT_KIND;
  version: typeof SUPERDOC_V2_CLIPBOARD_FRAGMENT_VERSION | string;
  blocks: readonly SDPasteBlock[];
  assets?: readonly SDPasteAsset[];
  /** Comment bodies keyed by clipboard-local ids on overlapping runs. */
  comments?: readonly SDPasteComment[];
  diagnostics?: readonly ClipboardInsertDiagnostic[];
}

export interface ClipboardInsertDiagnostic extends SDDiagnostic {
  reason: SDPasteUnsupportedReason;
  sourceKind?: ClipboardSourceKind;
  /** Fatal rich-conversion attempt retained when a plain-text fallback is selected. */
  cause?: SDConversionDiagnostic;
}

/** HTML conversion diagnostic with the clipboard negotiation envelope retained. */
export interface ClipboardHtmlConversionDiagnostic extends SDConversionDiagnostic {
  reason: SDPasteUnsupportedReason;
  sourceKind: 'html';
  cause?: SDConversionDiagnostic;
}

export interface ClipboardInsertPlanSummary {
  sourceKind: ClipboardSourceKind;
  blockCount: number;
  assetCount: number;
  imageRefCount: number;
  plainFallback: boolean;
}

export interface ClipboardInsertPlan {
  fragment: SDPasteFragment;
  diagnostics: readonly ClipboardInsertDiagnostic[];
  summary: ClipboardInsertPlanSummary;
}

export type ClipboardTarget =
  | SelectionTarget
  | {
      kind: 'block';
      nodeId: string;
      nodeType?: 'paragraph' | 'heading';
      placement?: 'before' | 'after';
      story?: StoryLocator;
    }
  | {
      kind: 'documentEnd';
      story?: StoryLocator;
    };

export interface ClipboardInsertInput {
  payload?: ClipboardPayload;
  plan?: ClipboardInsertPlan;
  fragment?: SDPasteFragment;
  target?: ClipboardTarget;
  changeMode?: 'direct' | 'tracked';
  /** Preserve source formatting by default; match-destination is used by paste-and-match-style gestures. */
  formattingMode?: 'preserve-source' | 'match-destination';
  fallback?: ClipboardFallbackPolicy;
}

export interface ClipboardSerializeInput {
  target?: ClipboardTarget;
  includeHtml?: boolean;
}

export interface ClipboardInsertSuccess extends ReceiptSuccess {
  plan: ClipboardInsertPlanSummary;
  diagnostics: readonly ClipboardInsertDiagnostic[];
}

export type ClipboardInsertResult = ClipboardInsertSuccess | AdapterMutationFailure;

export interface ClipboardParseFailure {
  success: false;
  failure: ReceiptFailure & {
    details?: {
      unsupportedReason?: SDPasteUnsupportedReason;
      diagnostics?: readonly ClipboardInsertDiagnostic[];
    };
  };
  diagnostics: readonly ClipboardInsertDiagnostic[];
}

export type ClipboardParseResult =
  | {
      success: true;
      plan: ClipboardInsertPlan;
      diagnostics: readonly ClipboardInsertDiagnostic[];
    }
  | ClipboardParseFailure;

export interface ClipboardSerializeResult {
  payload: ClipboardPayload;
  plan: ClipboardInsertPlan;
  warnings?: readonly ReviewWarning[];
}
