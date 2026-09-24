import type { BlockNodeAddress } from '../types/index.js';
import type { ReceiptInsert } from '../types/receipt.js';
import type { StoryLocator } from '../types/story.types.js';
import type {
  ImageProperties,
  ImageWrapType,
  ImageWrapSide,
  ImageMarginOffset,
  ImageSize,
  ImageCropInfo,
} from '../types/media.types.js';

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

/** Stable address for an image node in the document. */
export interface ImageAddress {
  /** Always 'inline': ProseMirror node kind (all images are PM inline nodes). */
  kind: 'inline';
  nodeType: 'image';
  nodeId: string;
  /** OOXML placement semantics: 'inline' = wp:inline, 'floating' = wp:anchor. */
  placement: 'inline' | 'floating';
}

// ---------------------------------------------------------------------------
// Location (for create / move)
// ---------------------------------------------------------------------------

export type ImageCreateLocation =
  | { kind: 'documentStart' }
  | { kind: 'documentEnd' }
  | { kind: 'before'; target: BlockNodeAddress }
  | { kind: 'after'; target: BlockNodeAddress }
  | { kind: 'inParagraph'; target: BlockNodeAddress; offset?: number };

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ImageSummary {
  sdImageId: string;
  address: ImageAddress;
  properties: ImageProperties;
}

// ---------------------------------------------------------------------------
// Wrap distances
// ---------------------------------------------------------------------------

export interface ImageWrapDistances {
  distTop?: number;
  distBottom?: number;
  distLeft?: number;
  distRight?: number;
}

// ---------------------------------------------------------------------------
// Position input
// ---------------------------------------------------------------------------

export interface ImagePositionInput {
  hRelativeFrom?: string;
  vRelativeFrom?: string;
  alignH?: string;
  alignV?: string;
  marginOffset?: ImageMarginOffset;
}

// ---------------------------------------------------------------------------
// Anchor options input
// ---------------------------------------------------------------------------

export interface ImageAnchorOptionsInput {
  behindDoc?: boolean;
  allowOverlap?: boolean;
  layoutInCell?: boolean;
  lockAnchor?: boolean;
  simplePos?: boolean;
}

// ---------------------------------------------------------------------------
// Z-order input
// ---------------------------------------------------------------------------

export interface ImageZOrderInput {
  /** Raw OOXML relativeHeight unsigned 32-bit integer (0..4294967295). */
  relativeHeight: number;
}

// ---------------------------------------------------------------------------
// Geometry inputs (SD-2100)
// ---------------------------------------------------------------------------

export interface ScaleInput {
  imageId: string;
  /** Scale factor (> 0). E.g., 0.5 = half size, 2.0 = double. */
  factor: number;
}

export interface SetLockAspectRatioInput {
  imageId: string;
  locked: boolean;
}

export interface RotateInput {
  imageId: string;
  /** Absolute rotation in degrees (0–360). */
  angle: number;
}

export interface FlipInput {
  imageId: string;
  /** true = flipped, false = normal, undefined = unchanged. */
  horizontal?: boolean;
  /** true = flipped, false = normal, undefined = unchanged. */
  vertical?: boolean;
}

export interface CropInput {
  imageId: string;
  crop: ImageCropInfo;
}

export interface ResetCropInput {
  imageId: string;
}

// ---------------------------------------------------------------------------
// Content replacement (SD-2100)
// ---------------------------------------------------------------------------

export interface ReplaceSourceInput {
  imageId: string;
  src: string;
  /** If true, recompute size from the new image's intrinsic dimensions (data URIs only). */
  resetSize?: boolean;
}

// ---------------------------------------------------------------------------
// Semantic metadata (SD-2100)
// ---------------------------------------------------------------------------

export interface SetAltTextInput {
  imageId: string;
  /** Accessibility description (maps to wp:docPr/@descr). */
  description: string;
}

export interface SetDecorativeInput {
  imageId: string;
  decorative: boolean;
}

export interface SetNameInput {
  imageId: string;
  /** Object name (maps to wp:docPr/@name). */
  name: string;
}

export interface SetHyperlinkInput {
  imageId: string;
  /** URL to link to, or null to remove hyperlink. */
  url: string | null;
  tooltip?: string;
}

// ---------------------------------------------------------------------------
// Caption lifecycle (SD-2100)
// ---------------------------------------------------------------------------

export interface InsertCaptionInput {
  imageId: string;
  text: string;
}

export interface UpdateCaptionInput {
  imageId: string;
  text: string;
}

export interface RemoveCaptionInput {
  imageId: string;
}

// ---------------------------------------------------------------------------
// Operation inputs
// ---------------------------------------------------------------------------

export interface CreateImageInput {
  /** Target story for the new image. Omit for body (backward compatible). */
  in?: StoryLocator;
  src: string;
  alt?: string;
  title?: string;
  size?: ImageSize;
  at?: ImageCreateLocation;
}

export interface ImagesListInput {
  offset?: number;
  limit?: number;
}

export interface ImagesGetInput {
  imageId: string;
}

export interface ImagesDeleteInput {
  imageId: string;
}

export interface MoveImageInput {
  imageId: string;
  to: ImageCreateLocation;
}

export interface ConvertToInlineInput {
  imageId: string;
}

export interface ConvertToFloatingInput {
  imageId: string;
}

export interface SetWrapTypeInput {
  imageId: string;
  type: ImageWrapType;
}

export interface SetSizeInput {
  imageId: string;
  size: ImageSize;
}

export interface SetWrapSideInput {
  imageId: string;
  side: ImageWrapSide;
}

export interface SetWrapDistancesInput {
  imageId: string;
  distances: ImageWrapDistances;
}

export interface SetPositionInput {
  imageId: string;
  position: ImagePositionInput;
}

export interface SetAnchorOptionsInput {
  imageId: string;
  options: ImageAnchorOptionsInput;
}

export interface SetZOrderInput {
  imageId: string;
  zOrder: ImageZOrderInput;
}

// ---------------------------------------------------------------------------
// Operation outputs
// ---------------------------------------------------------------------------

export interface CreateImageSuccessResult {
  success: true;
  image: ImageAddress;
  trackedChangeRefs?: ReceiptInsert[];
  /** Commit id for the insertion, including its alt text when that was set in the same call. */
  txId?: string;
}

export interface CreateImageFailureResult {
  success: false;
  failure: { code: string; message: string };
}

export type CreateImageResult = CreateImageSuccessResult | CreateImageFailureResult;

export interface ImagesListResult {
  total: number;
  items: ImageSummary[];
}

export interface ImagesMutationSuccessResult {
  success: true;
  image: ImageAddress;
  trackedChangeRefs?: ReceiptInsert[];
}

export interface ImagesMutationFailureResult {
  success: false;
  failure: { code: string; message: string };
}

export type ImagesMutationResult = ImagesMutationSuccessResult | ImagesMutationFailureResult;
