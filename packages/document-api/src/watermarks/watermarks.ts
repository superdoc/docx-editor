import { DocumentApiValidationError } from '../errors.js';
import { normalizeMutationOptions, type MutationOptions } from '../write/write.js';
import type {
  PictureWatermarkInput,
  RetainedPictureWatermarkInput,
  WatermarksApplyInput,
  WatermarksApplyResult,
  TextWatermark,
  WatermarkAddress,
  WatermarkInput,
  WatermarkMutationResult,
  WatermarkPlacement,
  WatermarkRemoveResult,
  WatermarkTarget,
  WatermarksInsertInput,
  WatermarksListQuery,
  WatermarksListResult,
  WatermarksRemoveInput,
  WatermarksReplaceInput,
} from './watermarks.types.js';

export * from './watermarks.types.js';

export interface WatermarksApi {
  list(query?: WatermarksListQuery): WatermarksListResult;
  apply(input: WatermarksApplyInput, options?: MutationOptions): WatermarksApplyResult;
  insert(input: WatermarksInsertInput, options?: MutationOptions): WatermarkMutationResult;
  replace(input: WatermarksReplaceInput, options?: MutationOptions): WatermarkMutationResult;
  remove(input: WatermarksRemoveInput, options?: MutationOptions): WatermarkRemoveResult;
}

export type WatermarksAdapter = WatermarksApi;

const SCALE_VALUES = new Set<PictureWatermarkInput['scalePercent']>(['auto', 50, 100, 150, 200, 500]);

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new DocumentApiValidationError('INVALID_INPUT', message, details);
}

function assertFinite(value: unknown, field: string, positive = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    invalid(`${field} must be ${positive ? 'a positive' : 'a finite'} number.`, { field, value });
  }
}

function validateTarget(target: unknown, operation: string): asserts target is WatermarkTarget {
  if (!target || typeof target !== 'object') invalid(`${operation}.target is required.`);
  const value = target as Record<string, unknown>;
  if (value.kind === 'document') return;
  if (value.kind !== 'headerFooterSlot') invalid(`${operation}.target must address the document or a header slot.`);
  if (value.headerFooterKind !== 'header') invalid(`${operation}.target must address a header slot.`);
  if (!['default', 'first', 'even'].includes(String(value.variant))) {
    invalid(`${operation}.target.variant must be default, first, or even.`);
  }
  const section = value.section as Record<string, unknown> | undefined;
  if (
    !section ||
    section.kind !== 'section' ||
    typeof section.sectionId !== 'string' ||
    section.sectionId.length === 0
  ) {
    invalid(`${operation}.target.section must be a SectionAddress.`);
  }
}

function validateAddress(target: unknown, operation: string): asserts target is WatermarkAddress {
  const value = target as Record<string, unknown> | null;
  if (!value || value.kind !== 'watermark' || typeof value.watermarkId !== 'string' || value.watermarkId.length === 0) {
    invalid(`${operation}.target must be a WatermarkAddress.`);
  }
}

function validatePlacement(placement: WatermarkPlacement | undefined, operation: string): void {
  if (placement === undefined) return;
  if (!placement || typeof placement !== 'object') invalid(`${operation}.watermark.placement must be an object.`);
  if (placement.widthPt !== undefined)
    assertFinite(placement.widthPt, `${operation}.watermark.placement.widthPt`, true);
  if (placement.heightPt !== undefined)
    assertFinite(placement.heightPt, `${operation}.watermark.placement.heightPt`, true);
  if (placement.rotationDegrees !== undefined) {
    assertFinite(placement.rotationDegrees, `${operation}.watermark.placement.rotationDegrees`);
  }
  for (const axis of ['horizontal', 'vertical'] as const) {
    const value = placement[axis];
    if (!value) continue;
    if (!['page', 'margin'].includes(value.relativeFrom)) {
      invalid(`${operation}.watermark.placement.${axis}.relativeFrom must be page or margin.`);
    }
    const alignments = axis === 'horizontal' ? ['left', 'center', 'right'] : ['top', 'center', 'bottom'];
    if (value.alignment !== undefined && !alignments.includes(value.alignment)) {
      invalid(`${operation}.watermark.placement.${axis}.alignment is invalid.`);
    }
    if (value.offsetPt !== undefined) {
      assertFinite(value.offsetPt, `${operation}.watermark.placement.${axis}.offsetPt`);
    }
  }
}

function validateTextWatermark(value: TextWatermark, operation: string): void {
  if (typeof value.text !== 'string' || value.text.length === 0) invalid(`${operation}.watermark.text is required.`);
  if (value.fontFamily !== undefined && (typeof value.fontFamily !== 'string' || value.fontFamily.length === 0)) {
    invalid(`${operation}.watermark.fontFamily must be a non-empty string.`);
  }
  if (value.fontSizePt !== undefined && value.fontSizePt !== 'auto') {
    assertFinite(value.fontSizePt, `${operation}.watermark.fontSizePt`, true);
  }
  if (value.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(value.color)) {
    invalid(`${operation}.watermark.color must be a six-digit hexadecimal color.`);
  }
  if (value.orientation !== undefined && value.orientation !== 'horizontal' && value.orientation !== 'diagonal') {
    invalid(`${operation}.watermark.orientation must be horizontal or diagonal.`);
  }
}

function validatePictureWatermark(value: PictureWatermarkInput, operation: string): void {
  if (typeof value.src !== 'string' || value.src.length === 0) invalid(`${operation}.watermark.src is required.`);
  if (value.scalePercent !== undefined && !SCALE_VALUES.has(value.scalePercent)) {
    invalid(`${operation}.watermark.scalePercent must be auto, 50, 100, 150, 200, or 500.`);
  }
  if (value.widthPt !== undefined) assertFinite(value.widthPt, `${operation}.watermark.widthPt`, true);
  if (value.heightPt !== undefined) assertFinite(value.heightPt, `${operation}.watermark.heightPt`, true);
}

export function validateWatermarkInput(value: unknown, operation: string): asserts value is WatermarkInput {
  if (!value || typeof value !== 'object') invalid(`${operation}.watermark is required.`);
  const watermark = value as WatermarkInput;
  if (watermark.kind === 'text') validateTextWatermark(watermark, operation);
  else if (watermark.kind === 'picture') validatePictureWatermark(watermark, operation);
  else invalid(`${operation}.watermark.kind must be text or picture.`);
  if (watermark.opacity !== undefined) {
    assertFinite(watermark.opacity, `${operation}.watermark.opacity`);
    if (watermark.opacity < 0 || watermark.opacity > 1)
      invalid(`${operation}.watermark.opacity must be between 0 and 1.`);
  }
  validatePlacement(watermark.placement, operation);
}

export function executeWatermarksList(adapter: WatermarksAdapter, query?: WatermarksListQuery): WatermarksListResult {
  if (query?.target) validateTarget(query.target, 'watermarks.list');
  if (query?.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
    invalid('watermarks.list.limit must be a positive integer.');
  }
  if (query?.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    invalid('watermarks.list.offset must be a non-negative integer.');
  }
  return adapter.list(query);
}

export function executeWatermarksInsert(
  adapter: WatermarksAdapter,
  input: WatermarksInsertInput,
  options?: MutationOptions,
): WatermarkMutationResult {
  validateTarget(input.target, 'watermarks.insert');
  validateWatermarkInput(input.watermark, 'watermarks.insert');
  return adapter.insert(input, normalizeMutationOptions(options));
}

export function executeWatermarksReplace(
  adapter: WatermarksAdapter,
  input: WatermarksReplaceInput,
  options?: MutationOptions,
): WatermarkMutationResult {
  validateAddress(input.target, 'watermarks.replace');
  validateWatermarkInput(input.watermark, 'watermarks.replace');
  return adapter.replace(input, normalizeMutationOptions(options));
}

export function executeWatermarksRemove(
  adapter: WatermarksAdapter,
  input: WatermarksRemoveInput,
  options?: MutationOptions,
): WatermarkRemoveResult {
  validateAddress(input.target, 'watermarks.remove');
  return adapter.remove(input, normalizeMutationOptions(options));
}

export function executeWatermarksApply(
  adapter: WatermarksAdapter,
  input: WatermarksApplyInput,
  options?: MutationOptions,
): WatermarksApplyResult {
  const operation = 'watermarks.apply';
  if (!input || typeof input !== 'object') invalid(`${operation} input is required.`);
  const target = input.target;
  if (target?.kind === 'headerFooterSlots') {
    if (!Array.isArray(target.slots) || target.slots.length === 0) {
      invalid(`${operation}.target.slots must contain at least one header slot.`);
    }
    const keys = new Set<string>();
    for (const slot of target.slots) {
      validateTarget(slot, operation);
      if (slot.kind !== 'headerFooterSlot') invalid(`${operation}.target.slots must contain header slots.`);
      const key = `${slot.section.sectionId}:${slot.variant}`;
      if (keys.has(key)) invalid(`${operation}.target.slots must be unique.`);
      keys.add(key);
    }
  } else {
    validateTarget(target, operation);
    if (target.kind !== 'document') invalid(`${operation}.target must address the document or headerFooterSlots.`);
  }
  if (!['insert', 'replace', 'remove'].includes(input.action)) invalid(`${operation}.action is invalid.`);
  if (input.action !== 'insert') {
    if (
      !Array.isArray(input.watermarkIds) ||
      input.watermarkIds.length === 0 ||
      input.watermarkIds.some((id) => typeof id !== 'string' || id.length === 0) ||
      new Set(input.watermarkIds).size !== input.watermarkIds.length
    ) {
      invalid(`${operation}.watermarkIds must contain unique, non-empty identities.`);
    }
  }
  if (input.action !== 'remove') {
    const watermark = input.watermark;
    if (watermark?.kind === 'picture' && 'source' in watermark) {
      const retained = watermark as RetainedPictureWatermarkInput;
      if (
        input.action !== 'replace' ||
        'src' in retained ||
        retained.source?.kind !== 'existing' ||
        typeof retained.source.watermarkId !== 'string' ||
        retained.source.watermarkId.length === 0
      ) {
        invalid(`${operation}.watermark.source must identify an existing picture for replacement.`);
      }
      validateWatermarkInput({ ...retained, src: 'retained' }, operation);
    } else {
      validateWatermarkInput(watermark, operation);
    }
  }
  return adapter.apply(input, normalizeMutationOptions(options));
}
