/**
 * Barrel re-export for styles/ submodules.
 *
 * Public surface only: internal validation/schema helpers are not exposed.
 */

// Registry: types, constants, and property definitions
export type { ValueSchema, StylesChannel, StylesScope, MergeStrategy, PropertyDefinition } from './registry.js';
export {
  PROPERTY_REGISTRY,
  ALLOWED_KEYS_BY_CHANNEL,
  EXCLUDED_KEYS,
  STYLE_EXCLUDED_KEYS,
  EXCLUDED_KEYS_BY_SCOPE,
  SCOPE_LABEL,
  XML_PATH_BY_CHANNEL,
  getPropertyDefinition,
  ST_VERTICAL_ALIGN_RUN,
  ST_EM,
  ST_TEXT_ALIGNMENT,
  ST_TEXT_DIRECTION,
  ST_TEXTBOX_TIGHT_WRAP,
  ST_TEXT_TRANSFORM,
  ST_JUSTIFICATION,
} from './registry.js';

// Schema: JSON Schema builders (consumed by contract/schemas.ts)
export { toJsonSchema, buildPatchSchema, buildStateSchema } from './schema.js';

// Apply: types, interfaces, and execution
export type {
  StylesBooleanState,
  StylesNumberState,
  StylesEnumState,
  StylesObjectState,
  StylesArrayState,
  StylesRunPatch,
  StylesParagraphPatch,
  StylesTargetResolution,
  StylesApplyRunInput,
  StylesApplyParagraphInput,
  StylesApplyStyleRunInput,
  StylesStyleRunPatch,
  StylesDocDefaultsResolution,
  StylesStyleResolution,
  StylesApplyInput,
  StylesApplyOptions,
  StylesStateMap,
  StylesApplyReceiptSuccess,
  StylesApplyReceiptFailure,
  StylesApplyReceipt,
  StylesAdapter,
  NormalizedStylesApplyOptions,
  StylesApi,
} from './apply.js';
export { STYLE_RUN_XML_PATH, executeStylesApply } from './apply.js';

// Create: define or redefine a named style (`styles.create`)
export type {
  StyleRunPatch,
  StyleConflictPolicy,
  StyleChannelState,
  StylesCreateParagraphInput,
  StylesCreateCharacterInput,
  StylesCreateInput,
  StylesCreateOptions,
  NormalizedStylesCreateOptions,
  StylesCreateResolution,
  StylesCreateReceiptSuccess,
  StylesCreateReceiptFailure,
  StylesCreateReceipt,
  StylesCreateAdapter,
  StylesCreateApi,
} from './create.js';
export {
  STYLE_XML_PATH,
  executeStylesCreate,
  validateStylesCreateInput,
  validateStylesCreateOptions,
} from './create.js';

// Catalog: read-only style catalogue projection (`styles.getCatalog`)
export type {
  StyleCatalogView,
  StyleCatalogItemType,
  StyleCatalogFilterType,
  StyleProvenance,
  StyleCatalogDiagnosticSeverity,
  StyleSourcePartStatus,
  StyleCatalogUsageStatus,
  StyleCatalogPreviewStatus,
  StyleCatalogViewStatus,
  StyleCatalogItemVisibility,
  StyleCatalogItemUsage,
  StyleCatalogItemPreview,
  StyleCatalogPreviewFontSource,
  StyleCatalogPreviewColorSource,
  StyleCatalogPreviewSources,
  StyleCatalogItem,
  StyleCatalogDefaults,
  StyleCatalogDiagnostic,
  StyleCatalogSourceStatus,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
  StylesGetCatalogAdapter,
} from './catalog.js';
export {
  STYLE_CATALOG_VIEWS,
  STYLE_CATALOG_FILTER_TYPES,
  executeStylesGetCatalog,
  validateStylesGetCatalogInput,
} from './catalog.js';

// Theme: read-only document theme projection (`styles.getTheme`)
export type {
  StylesGetThemeInput,
  StylesThemeSourceStatus,
  StylesGetThemeResult,
  StylesGetThemeAdapter,
} from './theme.js';
export { executeStylesGetTheme, validateStylesGetThemeInput } from './theme.js';

// Validation: exported for adapter use (excluded-key checking, patch key classification)
export type { PatchKeyClassification } from './validation.js';
export { validateValue, classifyPatchKey, validatePatchObject, validateStylesApplyInput } from './validation.js';
