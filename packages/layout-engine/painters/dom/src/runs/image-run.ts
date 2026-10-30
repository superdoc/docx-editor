import type { ImageBlock, ImageRun, ImageRunVerticalAlign } from '@superdoc/contracts';
import { DOM_CLASS_NAMES } from '../constants.js';
import { applyImageClipPath, readImageClipPathValue } from '../images/image-clip-path.js';
import { createRenderPlaceholder } from '../images/render-placeholder.js';
import type { RunRenderContext, TrackedChangesRenderConfig } from './types.js';
import { applyRunDataAttributes } from './hash.js';
import { sanitizeUrl } from './links.js';
import { isValidImageDataUrl } from '@superdoc/url-validation';
import { calculateRotatedBounds, normalizeRotation } from '@superdoc/geometry-utils';
import { applyImageOutline } from '../images/image-outline.js';

/**
 * Maximum resize multiplier for image metadata.
 * Images can be resized up to 3x their original dimensions.
 */
const MAX_RESIZE_MULTIPLIER = 3;

/**
 * Fallback maximum dimension for image resizing when original size is small.
 * Ensures images can be resized to at least 1000px even if original is smaller.
 */
const FALLBACK_MAX_DIMENSION = 1000;

/**
 * Minimum image dimension in pixels.
 * Ensures images remain visible and interactive during resizing.
 */
const MIN_IMAGE_DIMENSION = 20;

type ImageFilterSource = Pick<ImageBlock, 'grayscale' | 'gain' | 'blacklevel' | 'lum'>;
type ImageOpacitySource = Pick<ImageBlock, 'alphaModFix'>;

/**
 * Resolve the effective CSS `vertical-align` for an inline image run.
 *
 * Single source of truth for every vertical-align write site in this module
 * (raw image, clip wrapper, and legacy clip fallback) so they never drift. The
 * effective alignment is resolved upstream: render-line.ts copies the measured
 * per-line alignment onto the run before this module runs, and an authored
 * `run.verticalAlign` always wins. Absent any value, legacy `'top'` applies.
 */
export const resolveImageVerticalAlign = (run: Pick<ImageRun, 'verticalAlign'>): ImageRunVerticalAlign =>
  run.verticalAlign ?? 'top';

const applyImageTrackedChangeDecorations = (
  elem: HTMLElement,
  run: ImageRun,
  context: RunRenderContext,
  trackedConfig?: TrackedChangesRenderConfig,
): void => {
  if (trackedConfig) {
    context.applyTrackedChangeDecorations(elem, run, trackedConfig);
  }
};

const sanitizeImageObjectUrl = (src: string): string | null => {
  const trimmed = src.trim();
  if (!trimmed.startsWith('blob:')) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'blob:' ? trimmed : null;
  } catch {
    return null;
  }
};

const clampLumUnit = (value: number): number => {
  return Math.max(-100000, Math.min(100000, value));
};

const parseVmlFixedFraction = (value: string | number | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (value.endsWith('f')) {
    const raw = Number.parseInt(value.slice(0, -1), 10);
    return Number.isFinite(raw) ? raw / 65536 : null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildImageFilters = (source: ImageFilterSource): string[] => {
  const filters: string[] = [];

  if (source.grayscale) {
    filters.push('grayscale(100%)');
  }

  if (source.gain != null || source.blacklevel != null) {
    const gain = parseVmlFixedFraction(source.gain);
    const blacklevel = parseVmlFixedFraction(source.blacklevel);

    if (gain != null) {
      const contrast = Math.max(0, gain);
      if (contrast > 0) {
        filters.push(`contrast(${contrast})`);
      }
    }

    if (blacklevel != null) {
      // CSS has no black-point control, so approximate VML blacklevel with a linear
      // brightness shift using the same 0..32767 range Word's watermark UI uses.
      const brightness = Math.max(0, 1 + blacklevel * (65536 / 32767));
      if (brightness > 0) {
        filters.push(`brightness(${brightness})`);
      }
    }
  }

  if (source.lum) {
    // a:lum uses ST_FixedPercentage values expressed in thousandths of a percent.
    // Convert those percentage deltas into CSS filter multipliers.
    const contrastValue = typeof source.lum.contrast === 'number' ? clampLumUnit(source.lum.contrast) : null;
    const brightValue = typeof source.lum.bright === 'number' ? clampLumUnit(source.lum.bright) : null;

    if (contrastValue != null) {
      const contrast = Math.max(0, 1 + contrastValue / 100000);
      if (contrast >= 0) {
        filters.push(`contrast(${contrast})`);
      }
    }

    if (brightValue != null) {
      const brightness = Math.max(0, 1 + brightValue / 100000);
      if (brightness >= 0) {
        filters.push(`brightness(${brightness})`);
      }
    }
  }

  return filters;
};

export const resolveImageOpacity = (source: ImageOpacitySource): string | null => {
  const amt = source.alphaModFix?.amt;
  if (typeof amt !== 'number' || !Number.isFinite(amt)) {
    return null;
  }

  const opacity = Math.max(0, Math.min(100000, amt)) / 100000;
  return opacity === 1 ? null : String(opacity);
};

/**
 * Renders an ImageRun as an inline <img> element.
 *
 * SECURITY NOTES:
 * - Data URLs are validated against an allowlist of image MIME types
 * - Size limit prevents DoS attacks from extremely large images
 * - Only allows safe image MIME types; non-base64 data URLs are limited to SVG
 * - Non-data URLs are sanitized through sanitizeUrl to prevent XSS
 *
 * METADATA ATTRIBUTE:
 * - Adds `data-image-metadata` attribute to enable interactive resizing via ImageResizeOverlay
 * - Metadata includes: originalWidth, originalHeight, aspectRatio, min/max dimensions
 * - Only added when run.width > 0 && run.height > 0 to prevent invalid metadata
 * - Max dimensions: 3x original size or 1000px (whichever is larger)
 * - Min dimensions: 20px to ensure visibility and interactivity
 *
 * @param run - The ImageRun to render containing image source, dimensions, and spacing
 * @returns HTMLElement (img) or null if src is missing or invalid
 */
export const renderImageRun = (
  run: ImageRun,
  context: RunRenderContext,
  trackedConfig?: TrackedChangesRenderConfig,
): HTMLElement | null => {
  if (run.inlineDrawingId) {
    const slot = context.doc.createElement('span');
    slot.classList.add('superdoc-inline-drawing-slot');
    slot.dataset.inlineDrawingId = run.inlineDrawingId;
    slot.setAttribute('data-v2-unpainted-inline-object', 'true');
    slot.dataset.layoutEpoch = String(context.layoutEpoch);
    slot.setAttribute('aria-hidden', 'true');
    slot.style.display = 'inline-block';
    slot.style.width = `${run.width}px`;
    slot.style.height = `${run.height}px`;
    slot.style.verticalAlign = resolveImageVerticalAlign(run);
    if (run.pmStart != null) slot.dataset.pmStart = String(run.pmStart);
    if (run.pmEnd != null) slot.dataset.pmEnd = String(run.pmEnd);
    if (run.distTop) slot.style.marginTop = `${run.distTop}px`;
    if (run.distBottom) slot.style.marginBottom = `${run.distBottom}px`;
    if (run.distLeft) slot.style.marginLeft = `${run.distLeft}px`;
    if (run.distRight) slot.style.marginRight = `${run.distRight}px`;
    context.applySdtDataset(slot, run.sdt);
    if (run.dataAttrs) applyRunDataAttributes(slot, run.dataAttrs);
    applyImageTrackedChangeDecorations(slot, run, context, trackedConfig);
    return slot;
  }
  if (!run.src) {
    if (!run.placeholder) return null;

    const placeholder = createRenderPlaceholder({ doc: context.doc, placeholder: run.placeholder });
    placeholder.classList.add(DOM_CLASS_NAMES.INLINE_IMAGE);
    placeholder.style.display = 'inline-flex';
    placeholder.style.width = `${run.width}px`;
    placeholder.style.height = `${run.height}px`;
    placeholder.style.verticalAlign = resolveImageVerticalAlign(run);
    placeholder.style.position = 'relative';
    placeholder.style.zIndex = '1';
    placeholder.style.maxWidth = '100%';
    if (run.distTop) placeholder.style.marginTop = `${run.distTop}px`;
    if (run.distBottom) placeholder.style.marginBottom = `${run.distBottom}px`;
    if (run.distLeft) placeholder.style.marginLeft = `${run.distLeft}px`;
    if (run.distRight) placeholder.style.marginRight = `${run.distRight}px`;
    if (run.pmStart != null) placeholder.dataset.pmStart = String(run.pmStart);
    if (run.pmEnd != null) placeholder.dataset.pmEnd = String(run.pmEnd);
    if (run.imageId) placeholder.dataset.sdImageId = run.imageId;
    if (run.imageMutationId) placeholder.dataset.sdImageMutationId = run.imageMutationId;
    placeholder.dataset.layoutEpoch = String(context.layoutEpoch);
    context.applySdtDataset(placeholder, run.sdt);
    if (run.dataAttrs) applyRunDataAttributes(placeholder, run.dataAttrs);
    applyImageTrackedChangeDecorations(placeholder, run, context, trackedConfig);
    return context.buildImageHyperlinkAnchor(placeholder, run.hyperlink, 'inline-block');
  }

  const hasClipPath = typeof run.clipPath === 'string' && run.clipPath.trim().length > 0;

  // Create img element
  const img = context.doc.createElement('img');
  img.classList.add(DOM_CLASS_NAMES.INLINE_IMAGE);

  // Set source - validate data URLs with strict format and size checks
  // Note: data: URLs are blocked by sanitizeUrl for hyperlinks (XSS risk),
  // but are safe for <img> elements when properly validated
  const isDataUrl = typeof run.src === 'string' && run.src.startsWith('data:');
  if (isDataUrl) {
    // SECURITY: Validate data URL MIME type, encoding, and size.
    if (!isValidImageDataUrl(run.src)) {
      return null;
    }
    img.src = run.src;
  } else if (run.src.startsWith('blob:')) {
    const sanitized = sanitizeImageObjectUrl(run.src);
    if (!sanitized) {
      return null;
    }
    img.src = sanitized;
  } else {
    const sanitized = sanitizeUrl(run.src);
    if (sanitized) {
      img.src = sanitized;
    } else {
      // Invalid URL - return null
      return null;
    }
  }

  // Set dimensions: when we have clipPath we put img in a wrapper that has the layout size and overflow:hidden; img fills wrapper so cropped portion stays within after resize
  if (!hasClipPath) {
    img.width = run.width;
    img.height = run.height;
    // HTMLImageElement.width/height coerce to integers. Preserve OOXML/VML
    // fractional CSS-pixel geometry (for example 2.5pt = 3.333px) in CSS so
    // thin rules and small glyph images are not quantized at paint time.
    if (!Number.isInteger(run.width)) img.style.width = `${run.width}px`;
    if (!Number.isInteger(run.height)) img.style.height = `${run.height}px`;
  } else {
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      boxSizing: 'border-box',
      minWidth: '0',
      minHeight: '0',
    });
  }
  applyImageClipPath(img, run.clipPath);

  // Add metadata for interactive image resizing (inline images)
  // Only add metadata if dimensions are valid (positive, non-zero values)
  if (run.width > 0 && run.height > 0) {
    // This enables the ImageResizeOverlay to work with inline images
    const aspectRatio = run.width / run.height;
    const inlineImageMetadata = {
      originalWidth: run.width,
      originalHeight: run.height,
      // Max dimensions: MAX_RESIZE_MULTIPLIER x original size or FALLBACK_MAX_DIMENSION, whichever is larger
      // This provides generous constraints while preventing excessive scaling
      maxWidth: Math.max(run.width * MAX_RESIZE_MULTIPLIER, FALLBACK_MAX_DIMENSION),
      maxHeight: Math.max(run.height * MAX_RESIZE_MULTIPLIER, FALLBACK_MAX_DIMENSION),
      aspectRatio,
      // Min dimensions: MIN_IMAGE_DIMENSION to ensure images remain visible and interactive
      minWidth: MIN_IMAGE_DIMENSION,
      minHeight: MIN_IMAGE_DIMENSION,
    };
    img.setAttribute('data-image-metadata', JSON.stringify(inlineImageMetadata));
    // docPr/@id so the resize overlay can target the Document API (images.setSize).
    if (run.imageId) img.setAttribute('data-sd-image-id', run.imageId);
    if (run.imageMutationId) img.setAttribute('data-sd-image-mutation-id', run.imageMutationId);
  }

  // Set alt text (required for accessibility)
  img.alt = run.alt ?? '';

  // Set title if present
  if (run.title) {
    img.title = run.title;
  }

  // Apply inline-block display
  img.style.display = 'inline-block';

  // When we use a wrapper (clipPath + positive dimensions), margins/verticalAlign/position/zIndex go on the wrapper only.
  // When we don't use a wrapper (no clipPath, or clipPath with width/height 0), apply them on the img so layout is correct.
  const useWrapper = hasClipPath && run.width > 0 && run.height > 0;
  if (!useWrapper) {
    img.style.verticalAlign = resolveImageVerticalAlign(run);

    // Apply spacing as CSS margins
    if (run.distTop) {
      img.style.marginTop = `${run.distTop}px`;
    }
    if (run.distBottom) {
      img.style.marginBottom = `${run.distBottom}px`;
    }
    if (run.distLeft) {
      img.style.marginLeft = `${run.distLeft}px`;
    }
    if (run.distRight) {
      img.style.marginRight = `${run.distRight}px`;
    }

    // Position and z-index on the image only (not the line) so resize overlay can stack above.
    img.style.position = 'relative';
    img.style.zIndex = '1';
    img.style.maxWidth = '100%';
  }

  const normalizedRotation = normalizeRotation(run.rotation ?? 0);
  const hasGeometryTransform = normalizedRotation !== 0 || run.flipH === true || run.flipV === true;

  const filters = buildImageFilters(run);
  if (filters.length > 0) {
    img.style.filter = filters.join(' ');
  }
  const opacity = resolveImageOpacity(run);
  if (opacity != null) {
    img.style.opacity = opacity;
  }
  applyImageOutline(img, run.outline);

  // When clipPath is set, scale makes the img paint outside its box;
  // wrap in a clip container so only the cropped portion occupies space in the document.
  // Wrapper size is the only layout box (position calculation uses run.width/run.height).
  // PM position attributes go on the wrapper only so selection highlight and selection rects use the wrapper, not the scaled img.
  // Skip wrapper when width or height is 0 (no layout box); img already has margins/verticalAlign/position/zIndex from above.
  let clipWrapper: HTMLSpanElement | null = null;
  if (useWrapper) {
    const wrapper = context.doc.createElement('span');
    wrapper.classList.add(DOM_CLASS_NAMES.INLINE_IMAGE_CLIP_WRAPPER);
    wrapper.style.display = 'inline-block';
    wrapper.style.width = `${run.width}px`;
    wrapper.style.height = `${run.height}px`;
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.overflow = 'hidden';
    wrapper.style.verticalAlign = resolveImageVerticalAlign(run);
    if (run.distTop) wrapper.style.marginTop = `${run.distTop}px`;
    if (run.distBottom) wrapper.style.marginBottom = `${run.distBottom}px`;
    if (run.distLeft) wrapper.style.marginLeft = `${run.distLeft}px`;
    if (run.distRight) wrapper.style.marginRight = `${run.distRight}px`;
    wrapper.style.position = 'relative';
    wrapper.style.zIndex = '1';
    if (!hasGeometryTransform) {
      if (run.pmStart != null) wrapper.dataset.pmStart = String(run.pmStart);
      if (run.pmEnd != null) wrapper.dataset.pmEnd = String(run.pmEnd);
      wrapper.dataset.layoutEpoch = String(context.layoutEpoch);
      context.applySdtDataset(wrapper, run.sdt);
      if (run.dataAttrs) applyRunDataAttributes(wrapper, run.dataAttrs);
      applyImageTrackedChangeDecorations(wrapper, run, context, trackedConfig);
    }
    wrapper.appendChild(img);
    clipWrapper = wrapper;
  }

  if (hasGeometryTransform) {
    const content = clipWrapper ?? img;
    const visualBounds = calculateRotatedBounds({
      width: run.width,
      height: run.height,
      rotation: normalizedRotation,
      flipH: run.flipH,
      flipV: run.flipV,
    });
    const transforms = ['translate(-50%, -50%)'];
    if (normalizedRotation !== 0) transforms.push(`rotate(${normalizedRotation}deg)`);
    if (run.flipH) transforms.push('scaleX(-1)');
    if (run.flipV) transforms.push('scaleY(-1)');

    // The authored image frame rotates around its center inside an outer box
    // sized to the visual AABB. Keeping transform and crop on separate elements
    // prevents rotation from overwriting srcRect's own image transform.
    content.style.position = 'absolute';
    content.style.left = '50%';
    content.style.top = '50%';
    content.style.width = `${run.width}px`;
    content.style.height = `${run.height}px`;
    content.style.margin = '0';
    content.style.maxWidth = 'none';
    content.style.verticalAlign = '';
    content.style.zIndex = '';
    content.style.transformOrigin = 'center';
    content.style.transform = transforms.join(' ');

    const visualWrapper = context.doc.createElement('span');
    visualWrapper.classList.add('superdoc-inline-image-transform-wrapper');
    visualWrapper.style.display = 'inline-block';
    visualWrapper.style.width = `${visualBounds.width}px`;
    visualWrapper.style.height = `${visualBounds.height}px`;
    visualWrapper.style.verticalAlign = resolveImageVerticalAlign(run);
    visualWrapper.style.position = 'relative';
    visualWrapper.style.zIndex = '1';
    if (run.distTop) visualWrapper.style.marginTop = `${run.distTop}px`;
    if (run.distBottom) visualWrapper.style.marginBottom = `${run.distBottom}px`;
    if (run.distLeft) visualWrapper.style.marginLeft = `${run.distLeft}px`;
    if (run.distRight) visualWrapper.style.marginRight = `${run.distRight}px`;
    if (run.pmStart != null) visualWrapper.dataset.pmStart = String(run.pmStart);
    if (run.pmEnd != null) visualWrapper.dataset.pmEnd = String(run.pmEnd);
    visualWrapper.dataset.layoutEpoch = String(context.layoutEpoch);
    context.applySdtDataset(visualWrapper, run.sdt);
    if (run.dataAttrs) applyRunDataAttributes(visualWrapper, run.dataAttrs);
    applyImageTrackedChangeDecorations(visualWrapper, run, context, trackedConfig);
    visualWrapper.appendChild(content);
    return context.buildImageHyperlinkAnchor(visualWrapper, run.hyperlink, 'inline-block');
  }

  if (clipWrapper) {
    return context.buildImageHyperlinkAnchor(clipWrapper, run.hyperlink, 'inline-block');
  }

  // Apply PM position tracking for cursor placement (only on img when not wrapped)
  if (run.pmStart != null) {
    img.dataset.pmStart = String(run.pmStart);
  }
  if (run.pmEnd != null) {
    img.dataset.pmEnd = String(run.pmEnd);
  }
  img.dataset.layoutEpoch = String(context.layoutEpoch);

  // Apply SDT metadata
  context.applySdtDataset(img, run.sdt);

  // Apply data attributes
  if (run.dataAttrs) {
    applyRunDataAttributes(img, run.dataAttrs);
  }
  applyImageTrackedChangeDecorations(img, run, context, trackedConfig);

  const runClipPath = readImageClipPathValue((run as { clipPath?: unknown }).clipPath);
  if (runClipPath) {
    img.style.clipPath = runClipPath;
    img.style.display = 'block';
    img.style.marginTop = '';
    img.style.marginBottom = '';
    img.style.marginLeft = '';
    img.style.marginRight = '';
    img.style.verticalAlign = '';
    img.style.position = 'static';
    img.style.zIndex = '';

    const wrapper = context.doc.createElement('span');
    wrapper.classList.add('superdoc-inline-image-clip-wrapper');
    wrapper.style.display = 'inline-block';
    wrapper.style.width = `${run.width}px`;
    wrapper.style.height = `${run.height}px`;
    wrapper.style.verticalAlign = resolveImageVerticalAlign(run);
    wrapper.style.position = 'relative';
    wrapper.style.zIndex = '1';
    if (run.distTop) wrapper.style.marginTop = `${run.distTop}px`;
    if (run.distBottom) wrapper.style.marginBottom = `${run.distBottom}px`;
    if (run.distLeft) wrapper.style.marginLeft = `${run.distLeft}px`;
    if (run.distRight) wrapper.style.marginRight = `${run.distRight}px`;

    if (run.pmStart != null) {
      wrapper.dataset.pmStart = String(run.pmStart);
    }
    if (run.pmEnd != null) {
      wrapper.dataset.pmEnd = String(run.pmEnd);
    }
    wrapper.dataset.layoutEpoch = String(context.layoutEpoch);
    context.applySdtDataset(wrapper, run.sdt);
    applyImageTrackedChangeDecorations(wrapper, run, context, trackedConfig);

    wrapper.appendChild(img);
    return context.buildImageHyperlinkAnchor(wrapper, run.hyperlink, 'inline-block');
  }

  return context.buildImageHyperlinkAnchor(img, run.hyperlink, 'inline-block');
};
