import type { MutationOptions } from '../types/index.js';
import { DocumentApiValidationError } from '../errors.js';
import { validateStoryConsistency, validateStoryLocator } from '../validation/story-validator.js';
import type {
  CreateImageInput,
  CreateImageResult,
  ImagesListInput,
  ImagesListResult,
  ImagesGetInput,
  ImageSummary,
  ImagesDeleteInput,
  ImagesMutationResult,
  MoveImageInput,
  ConvertToInlineInput,
  ConvertToFloatingInput,
  SetSizeInput,
  SetWrapTypeInput,
  SetWrapSideInput,
  SetWrapDistancesInput,
  SetPositionInput,
  SetAnchorOptionsInput,
  SetZOrderInput,
  ScaleInput,
  SetLockAspectRatioInput,
  RotateInput,
  FlipInput,
  CropInput,
  ResetCropInput,
  ReplaceSourceInput,
  SetAltTextInput,
  SetDecorativeInput,
  SetNameInput,
  SetHyperlinkInput,
  InsertCaptionInput,
  UpdateCaptionInput,
  RemoveCaptionInput,
} from './images.types.js';
import { isUnsignedInt32, Z_ORDER_RELATIVE_HEIGHT_MAX, Z_ORDER_RELATIVE_HEIGHT_MIN } from './z-order.js';

// ---------------------------------------------------------------------------
// Valid value sets
// ---------------------------------------------------------------------------

const VALID_WRAP_TYPES = new Set(['Inline', 'None', 'Square', 'Tight', 'Through', 'TopAndBottom']);
const VALID_WRAP_SIDES = new Set(['bothSides', 'left', 'right', 'largest']);
const VALID_IMAGE_SIZE_UNITS = new Set(['px', 'pt', 'twip']);

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ImagesAdapter {
  list(input?: ImagesListInput): ImagesListResult;
  get(input: ImagesGetInput): ImageSummary;
  delete(input: ImagesDeleteInput, options?: MutationOptions): ImagesMutationResult;
  move(input: MoveImageInput, options?: MutationOptions): ImagesMutationResult;
  convertToInline(input: ConvertToInlineInput, options?: MutationOptions): ImagesMutationResult;
  convertToFloating(input: ConvertToFloatingInput, options?: MutationOptions): ImagesMutationResult;
  setSize(input: SetSizeInput, options?: MutationOptions): ImagesMutationResult;
  setWrapType(input: SetWrapTypeInput, options?: MutationOptions): ImagesMutationResult;
  setWrapSide(input: SetWrapSideInput, options?: MutationOptions): ImagesMutationResult;
  setWrapDistances(input: SetWrapDistancesInput, options?: MutationOptions): ImagesMutationResult;
  setPosition(input: SetPositionInput, options?: MutationOptions): ImagesMutationResult;
  setAnchorOptions(input: SetAnchorOptionsInput, options?: MutationOptions): ImagesMutationResult;
  setZOrder(input: SetZOrderInput, options?: MutationOptions): ImagesMutationResult;
  // SD-2100: Geometry
  scale(input: ScaleInput, options?: MutationOptions): ImagesMutationResult;
  setLockAspectRatio(input: SetLockAspectRatioInput, options?: MutationOptions): ImagesMutationResult;
  rotate(input: RotateInput, options?: MutationOptions): ImagesMutationResult;
  flip(input: FlipInput, options?: MutationOptions): ImagesMutationResult;
  crop(input: CropInput, options?: MutationOptions): ImagesMutationResult;
  resetCrop(input: ResetCropInput, options?: MutationOptions): ImagesMutationResult;
  // SD-2100: Content
  replaceSource(input: ReplaceSourceInput, options?: MutationOptions): ImagesMutationResult;
  // SD-2100: Semantic metadata
  setAltText(input: SetAltTextInput, options?: MutationOptions): ImagesMutationResult;
  setDecorative(input: SetDecorativeInput, options?: MutationOptions): ImagesMutationResult;
  setName(input: SetNameInput, options?: MutationOptions): ImagesMutationResult;
  setHyperlink(input: SetHyperlinkInput, options?: MutationOptions): ImagesMutationResult;
  // SD-2100: Caption lifecycle
  insertCaption(input: InsertCaptionInput, options?: MutationOptions): ImagesMutationResult;
  updateCaption(input: UpdateCaptionInput, options?: MutationOptions): ImagesMutationResult;
  removeCaption(input: RemoveCaptionInput, options?: MutationOptions): ImagesMutationResult;
}

export type ImagesApi = ImagesAdapter;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${field} must be a non-empty string.`, { field });
  }
}

function requireImageId(input: { imageId?: unknown }): void {
  requireString(input?.imageId, 'imageId');
}

function requireFinitePositiveNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${field} must be a finite positive number.`, {
      field,
      value,
    });
  }
}

function requireUnsignedInt32(value: unknown, field: string): asserts value is number {
  if (!isUnsignedInt32(value)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `${field} must be an unsigned 32-bit integer (${Z_ORDER_RELATIVE_HEIGHT_MIN}..${Z_ORDER_RELATIVE_HEIGHT_MAX}).`,
      {
        field,
        value,
        minimum: Z_ORDER_RELATIVE_HEIGHT_MIN,
        maximum: Z_ORDER_RELATIVE_HEIGHT_MAX,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Execute functions
// ---------------------------------------------------------------------------

export function executeImagesList(adapter: ImagesAdapter, input?: ImagesListInput): ImagesListResult {
  return adapter.list(input ?? {});
}

export function executeImagesGet(adapter: ImagesAdapter, input: ImagesGetInput): ImageSummary {
  requireImageId(input);
  return adapter.get(input);
}

export function executeImagesDelete(
  adapter: ImagesAdapter,
  input: ImagesDeleteInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  return adapter.delete(input, options);
}

export function executeImagesMove(
  adapter: ImagesAdapter,
  input: MoveImageInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.to) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.move requires a "to" location.', { field: 'to' });
  }
  return adapter.move(input, options);
}

export function executeImagesConvertToInline(
  adapter: ImagesAdapter,
  input: ConvertToInlineInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  return adapter.convertToInline(input, options);
}

export function executeImagesConvertToFloating(
  adapter: ImagesAdapter,
  input: ConvertToFloatingInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  return adapter.convertToFloating(input, options);
}

export function executeImagesSetSize(
  adapter: ImagesAdapter,
  input: SetSizeInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.size || typeof input.size !== 'object') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setSize requires a "size" object.', {
      field: 'size',
    });
  }

  requireFinitePositiveNumber(input.size.width, 'size.width');
  requireFinitePositiveNumber(input.size.height, 'size.height');

  if (input.size.unit !== undefined && !VALID_IMAGE_SIZE_UNITS.has(input.size.unit)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'size.unit must be one of: px, pt, twip.', {
      field: 'size.unit',
      allowed: [...VALID_IMAGE_SIZE_UNITS],
    });
  }

  return adapter.setSize(input, options);
}

export function executeImagesSetWrapType(
  adapter: ImagesAdapter,
  input: SetWrapTypeInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!VALID_WRAP_TYPES.has(input.type)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `Invalid wrap type: "${input.type}".`, {
      field: 'type',
      allowed: [...VALID_WRAP_TYPES],
    });
  }
  return adapter.setWrapType(input, options);
}

export function executeImagesSetWrapSide(
  adapter: ImagesAdapter,
  input: SetWrapSideInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!VALID_WRAP_SIDES.has(input.side)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `Invalid wrap side: "${input.side}".`, {
      field: 'side',
      allowed: [...VALID_WRAP_SIDES],
    });
  }
  return adapter.setWrapSide(input, options);
}

export function executeImagesSetWrapDistances(
  adapter: ImagesAdapter,
  input: SetWrapDistancesInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.distances || typeof input.distances !== 'object') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setWrapDistances requires a "distances" object.', {
      field: 'distances',
    });
  }
  return adapter.setWrapDistances(input, options);
}

export function executeImagesSetPosition(
  adapter: ImagesAdapter,
  input: SetPositionInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.position || typeof input.position !== 'object') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setPosition requires a "position" object.', {
      field: 'position',
    });
  }
  const offset = input.position.marginOffset;
  for (const [axis, align, field] of [
    ['horizontal', input.position.alignH, offset?.horizontal],
    ['vertical', input.position.alignV, offset?.top],
  ] as const) {
    if (align != null && field != null) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `images.setPosition: the ${axis} axis takes an alignment or an offset, not both.`,
        { field: axis === 'horizontal' ? 'position.alignH' : 'position.alignV' },
      );
    }
  }
  return adapter.setPosition(input, options);
}

export function executeImagesSetAnchorOptions(
  adapter: ImagesAdapter,
  input: SetAnchorOptionsInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.options || typeof input.options !== 'object') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setAnchorOptions requires an "options" object.', {
      field: 'options',
    });
  }
  return adapter.setAnchorOptions(input, options);
}

export function executeImagesSetZOrder(
  adapter: ImagesAdapter,
  input: SetZOrderInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.zOrder || typeof input.zOrder !== 'object') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setZOrder requires a "zOrder" object.', {
      field: 'zOrder',
    });
  }
  requireUnsignedInt32(input.zOrder.relativeHeight, 'zOrder.relativeHeight');
  return adapter.setZOrder(input, options);
}

// ---------------------------------------------------------------------------
// SD-2100: Geometry execute functions
// ---------------------------------------------------------------------------

export function executeImagesScale(
  adapter: ImagesAdapter,
  input: ScaleInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (typeof input.factor !== 'number' || !Number.isFinite(input.factor) || input.factor <= 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.scale requires factor as a finite positive number.', {
      field: 'factor',
      value: input.factor,
    });
  }
  return adapter.scale(input, options);
}

export function executeImagesSetLockAspectRatio(
  adapter: ImagesAdapter,
  input: SetLockAspectRatioInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (typeof input.locked !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setLockAspectRatio requires locked as a boolean.', {
      field: 'locked',
    });
  }
  return adapter.setLockAspectRatio(input, options);
}

export function executeImagesRotate(
  adapter: ImagesAdapter,
  input: RotateInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (typeof input.angle !== 'number' || !Number.isFinite(input.angle) || input.angle < 0 || input.angle > 360) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.rotate requires angle as a number in [0, 360].', {
      field: 'angle',
      value: input.angle,
    });
  }
  return adapter.rotate(input, options);
}

export function executeImagesFlip(
  adapter: ImagesAdapter,
  input: FlipInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (input.horizontal === undefined && input.vertical === undefined) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'images.flip requires at least one of horizontal or vertical.',
      { field: 'horizontal|vertical' },
    );
  }
  if (input.horizontal !== undefined && typeof input.horizontal !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.flip horizontal must be a boolean.', {
      field: 'horizontal',
    });
  }
  if (input.vertical !== undefined && typeof input.vertical !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.flip vertical must be a boolean.', {
      field: 'vertical',
    });
  }
  return adapter.flip(input, options);
}

export function executeImagesCrop(
  adapter: ImagesAdapter,
  input: CropInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (!input.crop || typeof input.crop !== 'object') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.crop requires a crop object.', { field: 'crop' });
  }
  const { left = 0, top = 0, right = 0, bottom = 0 } = input.crop;
  for (const [name, value] of Object.entries({ left, top, right, bottom }) as [string, number][]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new DocumentApiValidationError('INVALID_INPUT', `crop.${name} must be a number in [0, 100].`, {
        field: `crop.${name}`,
        value,
      });
    }
  }
  if (left + right >= 100) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'crop.left + crop.right must be less than 100.', {
      field: 'crop',
    });
  }
  if (top + bottom >= 100) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'crop.top + crop.bottom must be less than 100.', {
      field: 'crop',
    });
  }
  return adapter.crop(input, options);
}

export function executeImagesResetCrop(
  adapter: ImagesAdapter,
  input: ResetCropInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  return adapter.resetCrop(input, options);
}

// ---------------------------------------------------------------------------
// SD-2100: Content replacement execute function
// ---------------------------------------------------------------------------

export function executeImagesReplaceSource(
  adapter: ImagesAdapter,
  input: ReplaceSourceInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  requireString(input.src, 'src');
  return adapter.replaceSource(input, options);
}

// ---------------------------------------------------------------------------
// SD-2100: Semantic metadata execute functions
// ---------------------------------------------------------------------------

export function executeImagesSetAltText(
  adapter: ImagesAdapter,
  input: SetAltTextInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (typeof input.description !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setAltText requires description as a string.', {
      field: 'description',
    });
  }
  return adapter.setAltText(input, options);
}

export function executeImagesSetDecorative(
  adapter: ImagesAdapter,
  input: SetDecorativeInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (typeof input.decorative !== 'boolean') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setDecorative requires decorative as a boolean.', {
      field: 'decorative',
    });
  }
  return adapter.setDecorative(input, options);
}

export function executeImagesSetName(
  adapter: ImagesAdapter,
  input: SetNameInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (typeof input.name !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setName requires name as a string.', {
      field: 'name',
    });
  }
  return adapter.setName(input, options);
}

export function executeImagesSetHyperlink(
  adapter: ImagesAdapter,
  input: SetHyperlinkInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  if (input.url !== null && typeof input.url !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setHyperlink requires url as a string or null.', {
      field: 'url',
    });
  }
  if (input.tooltip !== undefined && typeof input.tooltip !== 'string') {
    throw new DocumentApiValidationError('INVALID_INPUT', 'images.setHyperlink tooltip must be a string.', {
      field: 'tooltip',
    });
  }
  return adapter.setHyperlink(input, options);
}

// ---------------------------------------------------------------------------
// SD-2100: Caption lifecycle execute functions
// ---------------------------------------------------------------------------

export function executeImagesInsertCaption(
  adapter: ImagesAdapter,
  input: InsertCaptionInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  requireString(input.text, 'text');
  return adapter.insertCaption(input, options);
}

export function executeImagesUpdateCaption(
  adapter: ImagesAdapter,
  input: UpdateCaptionInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  requireString(input.text, 'text');
  return adapter.updateCaption(input, options);
}

export function executeImagesRemoveCaption(
  adapter: ImagesAdapter,
  input: RemoveCaptionInput,
  options?: MutationOptions,
): ImagesMutationResult {
  requireImageId(input);
  return adapter.removeCaption(input, options);
}

// ---------------------------------------------------------------------------
// Create image execute (lives here alongside images domain)
// ---------------------------------------------------------------------------

export interface CreateImageAdapter {
  image(input: CreateImageInput, options?: MutationOptions): CreateImageResult;
}

export function executeCreateImage(
  adapter: CreateImageAdapter,
  input: CreateImageInput,
  options?: MutationOptions,
): CreateImageResult {
  requireString(input?.src, 'src');
  validateStoryLocator(input?.in, 'in');
  const targetStory = input.at && 'target' in input.at ? input.at.target.story : undefined;
  validateStoryLocator(targetStory, 'at.target.story');
  if (!isHeaderFooterSlotPartPair(input.in, targetStory)) {
    validateStoryConsistency(input.in, targetStory, undefined);
  }
  return adapter.image(input, options);
}

function isHeaderFooterSlotPartPair(inputStory: CreateImageInput['in'], targetStory: CreateImageInput['in']): boolean {
  if (!inputStory || !targetStory) return false;
  return (
    (inputStory.storyType === 'headerFooterSlot' && targetStory.storyType === 'headerFooterPart') ||
    (inputStory.storyType === 'headerFooterPart' && targetStory.storyType === 'headerFooterSlot')
  );
}
