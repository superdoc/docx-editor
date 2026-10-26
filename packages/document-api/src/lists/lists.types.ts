import type {
  AffectedRefRemapping,
  BlockNodeType,
  ReceiptFailure,
  ReceiptInsert,
  ReceiptSuccess,
  StoryLocator,
  TextAddress,
  TextRangeShift,
} from '../types/index.js';
import type { DiscoveryOutput } from '../types/discovery.js';
// ---------------------------------------------------------------------------
// Address types
// ---------------------------------------------------------------------------
export type ListItemAddress = {
  kind: 'block';
  nodeType: 'listItem';
  nodeId: string;
};
/** Any block-level paragraph, whether or not it is a list item. */
export type BlockAddress = {
  kind: 'block';
  nodeType: 'paragraph';
  nodeId: string;
};
/** Contiguous range of paragraphs. */
export type BlockRange = {
  from: BlockAddress;
  to: BlockAddress;
};
export type ListWithinAddress = {
  kind: 'block';
  nodeType: BlockNodeType;
  nodeId: string;
};
// ---------------------------------------------------------------------------
// Enums and constants
// ---------------------------------------------------------------------------
export type ListKind = 'ordered' | 'bullet';
export type ListInsertPosition = 'before' | 'after';
export type JoinDirection = 'withPrevious' | 'withNext';
export type MutationScope = 'definition' | 'instance';
export type LevelAlignment = 'left' | 'center' | 'right';
export type TrailingCharacter = 'tab' | 'space' | 'nothing';
export type ListPresetId =
  | 'decimal'
  | 'decimalParenthesis'
  | 'lowerLetter'
  | 'lowerLetterParenthesis'
  | 'upperLetter'
  | 'upperLetterParenthesis'
  | 'lowerRoman'
  | 'upperRoman'
  | 'disc'
  | 'circle'
  | 'square'
  | 'dash';
export const LIST_KINDS = ['ordered', 'bullet'] as const satisfies readonly ListKind[];
export const LIST_INSERT_POSITIONS = ['before', 'after'] as const satisfies readonly ListInsertPosition[];
export const JOIN_DIRECTIONS = ['withPrevious', 'withNext'] as const satisfies readonly JoinDirection[];
export const MUTATION_SCOPES = ['definition', 'instance'] as const satisfies readonly MutationScope[];
export const LEVEL_ALIGNMENTS = ['left', 'center', 'right'] as const satisfies readonly LevelAlignment[];
export const TRAILING_CHARACTERS = ['tab', 'space', 'nothing'] as const satisfies readonly TrailingCharacter[];
export const LIST_PRESET_IDS = [
  'decimal',
  'decimalParenthesis',
  'lowerLetter',
  'lowerLetterParenthesis',
  'upperLetter',
  'upperLetterParenthesis',
  'lowerRoman',
  'upperRoman',
  'disc',
  'circle',
  'square',
  'dash',
] as const satisfies readonly ListPresetId[];
/**
 * Canonical OOXML marker shape for each list preset. This is the single source
 * of truth for what glyph/number-format a preset materializes into, consumed by
 * the v2 adapter (numbering-definition mutation) and the v2 host (variant
 * comparison for style-aware list toggling). Keep this aligned with the toolbar
 * style-key map in the SuperDoc package.
 */
export interface ListPresetMarker {
  /** OOXML `w:numFmt` value (`decimal`, `upperLetter`, `bullet`, ...). */
  numFmt: string;
  /** OOXML `w:lvlText` template (`%1.`, `%1)`, `•`, ...). */
  lvlText: string;
  /** First number for ordered presets; omitted for bullets. */
  start?: number;
}
export const LIST_PRESET_MARKERS: Record<ListPresetId, ListPresetMarker> = {
  decimal: { numFmt: 'decimal', lvlText: '%1.', start: 1 },
  decimalParenthesis: { numFmt: 'decimal', lvlText: '%1)', start: 1 },
  lowerLetter: { numFmt: 'lowerLetter', lvlText: '%1.', start: 1 },
  lowerLetterParenthesis: { numFmt: 'lowerLetter', lvlText: '%1)', start: 1 },
  upperLetter: { numFmt: 'upperLetter', lvlText: '%1.', start: 1 },
  upperLetterParenthesis: { numFmt: 'upperLetter', lvlText: '%1)', start: 1 },
  lowerRoman: { numFmt: 'lowerRoman', lvlText: '%1.', start: 1 },
  upperRoman: { numFmt: 'upperRoman', lvlText: '%1.', start: 1 },
  disc: { numFmt: 'bullet', lvlText: '•' },
  circle: { numFmt: 'bullet', lvlText: 'o' },
  square: { numFmt: 'bullet', lvlText: '▪' },
  dash: { numFmt: 'bullet', lvlText: '-' },
};
// ---------------------------------------------------------------------------
// Failure code enums
// ---------------------------------------------------------------------------
export type ListsFailureCode =
  | 'NO_OP'
  | 'INVALID_TARGET'
  | 'INCOMPATIBLE_DEFINITIONS'
  | 'NO_COMPATIBLE_PREVIOUS'
  | 'ALREADY_CONTINUOUS'
  | 'NO_PREVIOUS_LIST'
  | 'NO_ADJACENT_SEQUENCE'
  | 'ALREADY_SAME_SEQUENCE'
  | 'LEVEL_OUT_OF_RANGE'
  | 'LEVEL_NOT_FOUND'
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_INPUT';
export type CanContinueReason = 'NO_PREVIOUS_LIST' | 'INCOMPATIBLE_DEFINITIONS' | 'ALREADY_CONTINUOUS';
export type CanJoinReason = 'NO_ADJACENT_SEQUENCE' | 'INCOMPATIBLE_DEFINITIONS' | 'ALREADY_SAME_SEQUENCE';
// ---------------------------------------------------------------------------
// Discovery / query types
// ---------------------------------------------------------------------------
export interface ListsListQuery {
  within?: ListWithinAddress;
  limit?: number;
  offset?: number;
  kind?: ListKind;
  level?: number;
  ordinal?: number;
}
export interface ListsGetInput {
  address: ListItemAddress;
}
export interface ListItemInfo {
  address: ListItemAddress;
  listId: string;
  marker?: string;
  ordinal?: number;
  path?: number[];
  level?: number;
  kind?: ListKind;
  text?: string;
}
export interface ListItemDomain {
  address: ListItemAddress;
  listId: string;
  marker?: string;
  ordinal?: number;
  path?: number[];
  level?: number;
  kind?: ListKind;
  text?: string;
}
export type ListsListResult = DiscoveryOutput<ListItemDomain>;
// ---------------------------------------------------------------------------
// Input types: kept operations
// ---------------------------------------------------------------------------
export interface ListInsertInput {
  target: ListItemAddress;
  position: ListInsertPosition;
  text?: string;
  /** Copy paragraph and run formatting from this item; placement and numbering still come from target. Omit to preserve existing paragraph-creation formatting, including next-style handling. */
  inheritFrom?: ListItemAddress;
}
export interface ListTargetInput {
  target: ListItemAddress;
}
// ---------------------------------------------------------------------------
// Input types: new SD-1272 operations
// ---------------------------------------------------------------------------
/**
 * Create a new list from existing paragraphs.
 *
 * When `sequence.mode` is `'continuePrevious'`, `preset` and `style` are
 * not allowed: the new items inherit formatting from the previous sequence.
 */
export type ListsCreateInput =
  | {
      mode: 'empty';
      at: BlockAddress;
      kind?: ListKind;
      level?: number;
      preset?: ListPresetId;
      style?: ListStyle;
      sequence?: { mode: 'new'; startAt?: number };
    }
  | {
      mode: 'empty';
      at: BlockAddress;
      kind?: ListKind;
      level?: number;
      preset?: never;
      style?: never;
      sequence: { mode: 'continuePrevious' };
    }
  | {
      mode: 'fromParagraphs';
      target: BlockAddress | BlockRange;
      kind?: ListKind;
      level?: number;
      preset?: ListPresetId;
      style?: ListStyle;
      sequence?: { mode: 'new'; startAt?: number };
    }
  | {
      mode: 'fromParagraphs';
      target: BlockAddress | BlockRange;
      kind?: ListKind;
      level?: number;
      preset?: never;
      style?: never;
      sequence: { mode: 'continuePrevious' };
    };
export interface ListsAttachInput {
  target: BlockAddress | BlockRange;
  attachTo: ListItemAddress;
  level?: number;
}
export interface ListsDetachInput {
  target: ListItemAddress;
}
/**
 * Delete the entire list that contains the targeted list item — removes ALL
 * sibling list items (same numbered sequence) from the document, including
 * their text content. The target can be ANY item in the list; the list is
 * resolved by walking adjacent list items that share the same numbering.
 */
export interface ListsDeleteInput {
  target: ListItemAddress;
}
export interface ListsJoinInput {
  target: ListItemAddress;
  direction: JoinDirection;
}
export interface ListsCanJoinInput {
  target: ListItemAddress;
  direction: JoinDirection;
}
export interface ListsSeparateInput {
  target: ListItemAddress;
  copyOverrides?: boolean;
}
export interface ListsMergeInput {
  target: ListItemAddress;
  direction: JoinDirection;
}
export interface ListsSplitInput {
  target: ListItemAddress;
  restartNumbering?: boolean;
}
export interface ListsSetLevelInput {
  target: ListItemAddress;
  level: number;
}
export interface ListsSetValueInput {
  target: ListItemAddress;
  value: number | null;
}
export interface ListsContinuePreviousInput {
  target: ListItemAddress;
}
export interface ListsCanContinuePreviousInput {
  target: ListItemAddress;
}
export interface ListsSetLevelRestartInput {
  target: ListItemAddress;
  level: number;
  restartAfterLevel: number | null;
  scope?: MutationScope;
}
export interface ListsConvertToTextInput {
  target: ListItemAddress;
  includeMarker?: boolean;
}
// ---------------------------------------------------------------------------
// SD-1973 template and formatting types
// ---------------------------------------------------------------------------
export const LIST_CUSTOM_NUMBERING_FORMATS = [
  '01, 02, 03, ...',
  '001, 002, 003, ...',
  '0001, 0002, 0003, ...',
] as const;

/** A captured snapshot of one level's formatting properties. */
export interface ListLevelTemplate {
  level: number;
  numFmt?: string;
  customFormat?: string;
  lvlText?: string;
  start?: number;
  alignment?: LevelAlignment;
  indents?: {
    left?: number;
    hanging?: number;
    firstLine?: number;
  };
  trailingCharacter?: TrailingCharacter;
  markerFont?: string;
  pictureBulletId?: number;
  tabStopAt?: number | null;
}
/** A full list template: an array of level snapshots. */
export interface ListTemplate {
  version: 1;
  levels: ListLevelTemplate[];
}
// ---------------------------------------------------------------------------
// SD-2025 user-facing style aliases and new types
// ---------------------------------------------------------------------------
/** Reusable list style object: alias of ListTemplate for user-facing naming. */
export type ListStyle = ListTemplate;
/** Reusable level style: alias of ListLevelTemplate for user-facing naming. */
export type ListLevelStyle = ListLevelTemplate;
/**
 * Dialog-shaped layout input for `lists.setLevelLayout`.
 * All numeric values are in twips.
 *
 * Partial-update semantics:
 *   - undefined (omitted): leave current value unchanged
 *   - null (explicit):      remove/clear the value (only valid for tabStopAt)
 *   - present value:        set it
 */
export interface ListLevelLayout {
  alignment?: LevelAlignment;
  alignedAt?: number;
  textIndentAt?: number;
  followCharacter?: TrailingCharacter;
  tabStopAt?: number | null;
}
// ---------------------------------------------------------------------------
// Input types: SD-1973 formatting operations
// ---------------------------------------------------------------------------
export interface ListsApplyTemplateInput {
  target: ListItemAddress;
  template: ListTemplate;
  levels?: number[];
}
export interface ListsApplyPresetInput {
  target: ListItemAddress;
  preset: ListPresetId;
  levels?: number[];
}
export interface ListsSetTypeInput {
  target: ListItemAddress;
  kind: ListKind;
  /** Controls whether adjacent sequences of the same kind are merged after conversion.
   *  - `'preserve'` (default): merge adjacent compatible sequences to maintain continuous numbering.
   *  - `'none'`: only apply the preset, do not merge sequences. */
  continuity?: 'preserve' | 'none';
}
export interface ListsCaptureTemplateInput {
  target: ListItemAddress;
  levels?: number[];
}
export interface ListsSetLevelNumberingInput {
  target: ListItemAddress;
  level: number;
  numFmt: string;
  customFormat?: string;
  lvlText: string;
  start?: number;
  /** Format numeric placeholders as decimal. False removes legal numbering; omit to preserve it. */
  isLgl?: boolean;
}
export interface ListsSetLevelBulletInput {
  target: ListItemAddress;
  level: number;
  markerText: string;
}
export interface ListsSetLevelPictureBulletInput {
  target: ListItemAddress;
  level: number;
  pictureBulletId: number;
}
export interface ListsSetLevelAlignmentInput {
  target: ListItemAddress;
  level: number;
  alignment: LevelAlignment;
}
export interface ListsSetLevelIndentsInput {
  target: ListItemAddress;
  level: number;
  left?: number;
  hanging?: number;
  firstLine?: number;
}
export interface ListsSetLevelTrailingCharacterInput {
  target: ListItemAddress;
  level: number;
  trailingCharacter: TrailingCharacter;
}
export interface ListsSetLevelMarkerFontInput {
  target: ListItemAddress;
  level: number;
  fontFamily: string;
}
export interface ListsClearLevelOverridesInput {
  target: ListItemAddress;
  level: number;
}
// ---------------------------------------------------------------------------
// Input types: SD-2025 user-facing operations
// ---------------------------------------------------------------------------
export interface ListsGetStyleInput {
  target: ListItemAddress;
  levels?: number[];
}
export interface ListsApplyStyleInput {
  target: ListItemAddress;
  style: ListStyle;
  levels?: number[];
}
export interface ListsRestartAtInput {
  target: ListItemAddress;
  startAt: number;
}
export interface ListsSetLevelNumberStyleInput {
  target: ListItemAddress;
  level: number;
  numberStyle: string;
}
export interface ListsSetLevelTextInput {
  target: ListItemAddress;
  level: number;
  text: string;
}
export interface ListsSetLevelStartInput {
  target: ListItemAddress;
  level: number;
  startAt: number;
}
export interface ListsSetLevelLayoutInput {
  target: ListItemAddress;
  level: number;
  layout: ListLevelLayout;
}
// ---------------------------------------------------------------------------
// Result types: SD-2025
// ---------------------------------------------------------------------------
export interface ListsGetStyleSuccessResult {
  success: true;
  style: ListStyle;
}
export type ListsGetStyleResult = ListsGetStyleSuccessResult | ListsFailureResult;
// ---------------------------------------------------------------------------
// Result types: SD-1973
// ---------------------------------------------------------------------------
export interface ListsCaptureTemplateSuccessResult {
  success: true;
  template: ListTemplate;
}
export type ListsCaptureTemplateResult = ListsCaptureTemplateSuccessResult | ListsFailureResult;
// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface ListsInsertSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  item: ListItemAddress;
  insertionPoint: TextAddress;
  trackedChangeRefs?: ReceiptInsert[];
}
export interface ListsMutateItemSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  item: ListItemAddress;
  /** Tracked changes authored by this mutation when `changeMode` is tracked. */
  trackedChangeRefs?: ReceiptInsert[];
  affectedStories?: StoryLocator[];
  remappedRefs?: AffectedRefRemapping[];
  textRangeShifts?: TextRangeShift[];
  txId?: string;
  changed?: boolean;
}
export interface ListsCreateSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  listId: string;
  item: ListItemAddress;
}
export interface ListsJoinSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  listId: string;
}
export interface ListsSeparateSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  listId: string;
  numId: number;
}
export interface ListsMergeSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  listId: string;
  absorbedCount: number;
  removedEmptyBlocks: number;
}
export interface ListsSplitSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  listId: string;
  numId: number;
  restartedAt: number | null;
}
export interface ListsDetachSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  paragraph: {
    kind: 'block';
    nodeType: 'paragraph';
    nodeId: string;
  };
}
export interface ListsConvertToTextSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  paragraph: {
    kind: 'block';
    nodeType: 'paragraph';
    nodeId: string;
  };
}
export interface ListsCanJoinResult {
  canJoin: boolean;
  reason?: CanJoinReason;
  adjacentListId?: string;
}
export interface ListsCanContinuePreviousResult {
  canContinue: boolean;
  reason?: CanContinueReason;
  previousListId?: string;
}
export interface ListsFailureResult {
  success: false;
  failure: ReceiptFailure;
}
export type ListsInsertResult = ListsInsertSuccessResult | ListsFailureResult;
export type ListsMutateItemResult = ListsMutateItemSuccessResult | ListsFailureResult;
export type ListsCreateResult = ListsCreateSuccessResult | ListsFailureResult;
export type ListsJoinResult = ListsJoinSuccessResult | ListsFailureResult;
export type ListsSeparateResult = ListsSeparateSuccessResult | ListsFailureResult;
export type ListsMergeResult = ListsMergeSuccessResult | ListsFailureResult;
export type ListsSplitResult = ListsSplitSuccessResult | ListsFailureResult;
export type ListsDetachResult = ListsDetachSuccessResult | ListsFailureResult;
export type ListsConvertToTextResult = ListsConvertToTextSuccessResult | ListsFailureResult;
export interface ListsDeleteSuccessResult extends ReceiptSuccess {
  success: true;
  appliedChangeMode?: 'direct' | 'tracked';
  /** Number of list items removed. */
  deletedCount: number;
}
export type ListsDeleteResult = ListsDeleteSuccessResult | ListsFailureResult;
// ---------------------------------------------------------------------------
// v2 numbering-aware list operation surface.
// ---------------------------------------------------------------------------
/**
 * Target shape accepted by the v2 list operations. We accept paragraph
 * blocks (the substrate identifies them by w14:paraId; the public type
 * surfaces them under both `paragraph` and `listItem` node types so callers
 * can pass refs obtained from `blocks.list` or from `lists.get*`).
 */
export type ListsBlockTarget =
  | { kind: 'block'; nodeType: 'paragraph'; nodeId: string }
  | { kind: 'block'; nodeType: 'listItem'; nodeId: string };
export interface ListsGetStateInput {
  target: ListsBlockTarget;
}
export interface ListsGetStateSuccessResult {
  success: true;
  isListItem: boolean;
  /** numId; null when the paragraph is not a list item. */
  numId: string | null;
  /** Level (`ilvl`); 0 when the paragraph is not a list item or has no ilvl. */
  ilvl: number;
  /** abstractNumId from the catalog; null when unknown. */
  abstractNumId: string | null;
  /** Level number format at the resolved level; null when unknown. */
  numFmt: string | null;
  /** Level text template at the resolved level; null when unknown. */
  lvlText: string | null;
  /** Coarse seed classification; null when unknown. */
  seed: 'bullet' | 'ordered' | null;
}
export type ListsGetStateResult = ListsGetStateSuccessResult | ListsFailureResult;
export interface ListsApplyInput {
  target: ListsBlockTarget;
  /** `'bullet'` or `'ordered'`. Used when materializing a new abstract num. */
  seed: ListKind;
  /** Optional existing numId to attach the paragraph to instead of seeding a new one. */
  reuseNumId?: string;
  /** Optional ilvl; defaults to 0. */
  ilvl?: number;
}
export interface ListsContinueV2Input {
  target: ListsBlockTarget;
}
export interface ListsRestartV2Input {
  target: ListsBlockTarget;
  /** First number to restart at; defaults to 1. */
  startAt?: number;
}
export interface ListsRemoveV2Input {
  target: ListsBlockTarget;
}
