/**
 * Built-in command catalog for the v2-native UI controller.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the controller's built-in
 * command ids, their aliases, how each one routes (public Document API
 * operation, public SuperDoc-instance method, tracked-change decision, or no
 * supported route yet), whether it mutates the document, how v1-style payloads
 * are normalized, and the stable fail-closed reason a recognized-but-unrouted
 * command reports. `create-super-doc-ui.ts` reads these descriptors; it no
 * longer carries an ad hoc route map.
 *
 * Posture (migration-only): every v1 headless-toolbar command id is present
 * here with an explicit disposition —
 *
 *   - `routed`      → backed by a public surface today (Document API operation,
 *                     SuperDoc-instance method, or tracked-change decision) and
 *                     browser-proven through `ui.commands.execute`;
 *   - `context-gap` → a real v2 operation whose required document context (the
 *                     current table / row / column / cell) cannot be resolved
 *                     from public custom-UI state; reports the precise, named
 *                     `table-context-unavailable` reason and fails closed;
 *   - `unsupported` → no clear public v2 equivalent (product decision) or an
 *                     unknown id; reports `command-unsupported` and fails closed.
 *
 * No routeable v1 toolbar command remains `command-deferred` (that disposition
 * stays in the type for migration scaffolding but is unused by the catalog).
 *
 * No descriptor imports a v1 editor internal or a private v2 runtime package,
 * and no routed command mutates while the document is read-only / viewing.
 *
 */
import { SUPERDOC_UI_REASONS, type SuperDocUIReason } from './reasons.js';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';

/**
 * The original v2-native command ids. These are the historically stable
 * `superdoc/ui` built-ins; the broader catalog below adds v1 headless-toolbar
 * coverage. Kept as a named export because it is part of the public `superdoc/ui`
 * surface (`verify-public-facade-emit.cjs`, consumer typechecks).
 */
export const BUILT_IN_COMMAND_IDS = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strikethrough',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  setFontFamily: 'setFontFamily',
  setFontSize: 'setFontSize',
  undo: 'undo',
  redo: 'redo',
  acceptChange: 'acceptChange',
  rejectChange: 'rejectChange',
  acceptAllChanges: 'acceptAllChanges',
  rejectAllChanges: 'rejectAllChanges',
  // row-862 — list apply/toggle. These keep the familiar v1 toolbar ids while
  // routing through the v2 editor host edit-command path (`editCommands.lists.apply`).
  bulletList: 'bullet-list',
  numberedList: 'numbered-list',
} as const;

/** Every command id built into SuperDoc's UI controller. */
export type BuiltInCommandId = (typeof COMMAND_CATALOG)[number]['id'];

/**
 * How a catalog command is (or is not) backed by a public surface.
 *
 *   - `routed`      → backed by a public surface today.
 *   - `deferred`    → recognized v1 workflow the public Document API can back,
 *                     intentionally not wired (reports `command-deferred`).
 *                     No descriptor uses this in the functional-parity state.
 *   - `context-gap` → a real v2 operation whose required document context
 *                     cannot be resolved from public custom-UI state (the
 *                     table cell-context family). Fails closed with a precise,
 *                     named reason (`table-context-unavailable`), NOT the
 *                     generic `command-deferred`.
 *   - `unsupported` → no public v2 equivalent (product decision) or unknown id.
 */
export type CommandDisposition = 'routed' | 'deferred' | 'context-gap' | 'unsupported';

/** A tracked-change decision a command performs. */
export interface TrackDecisionSpec {
  kind: 'accept' | 'reject';
  scope: 'id' | 'all';
}

/**
 * How an inline-format command builds its public Document API input from the
 * live selection.
 *
 * The v2 public Document API (`activeEditor.doc.format.*`) requires an explicit
 * `target`/`ref` — it does NOT default to the current selection (see
 * `@superdoc/document-api` `format.ts` `validateTargetLocator`). The controller
 * therefore resolves the live selection to a `SelectionTarget` and passes
 * `{ target, value }`. A command with no resolvable range selection fails
 * closed with `range-selection-required` rather than calling the operation with
 * a missing target (which would throw `INVALID_INPUT`).
 */
export interface InlineFormatSpec {
  /** Inline run-property key (`bold`, `color`, `highlight`, `fontFamily`, `fontSize`, ...). */
  key: string;
  /**
   * - `toggle`: boolean mark, value = `!active` so the command flips on/off.
   * - `value-string`: string value (color, font family) taken from the payload.
   * - `value-number`: numeric value (font size) taken from the payload.
   * - `clear`: clear direct inline formatting on the selection via `format.apply`.
   */
  kind: 'toggle' | 'value-string' | 'value-number' | 'clear';
}

/**
 * How a block-level paragraph command builds its `format.paragraph.*` /
 * `styles.paragraph.*` input from the current paragraph block(s).
 *
 * The selection's `blockId` is the same identifier the public block ops accept
 * as `nodeId` (both resolve to the OOXML `paraId` in the private v2 document-api
 * adapter write path). The controller
 * therefore synthesizes a `ParagraphTarget` (`{ kind:'block',
 * nodeType:'paragraph', nodeId }`) for each block the selection covers and
 * routes the operation per block. A command with no resolvable current block
 * fails closed with `selection-required`.
 */
export interface BlockParagraphSpec {
  /**
   * - `alignment`: `format.paragraph.setAlignment({ target, alignment })`.
   * - `spacing-line`: `format.paragraph.setSpacing({ target, line, lineRule:'auto' })`.
   * - `style`: `styles.paragraph.setStyle({ target, styleId })`.
   * - `direction`: `format.paragraph.setDirection({ target, direction })`.
   */
  kind: 'alignment' | 'spacing-line' | 'style' | 'direction';
  /** Fixed value for direction commands (`ltr` / `rtl`). */
  fixedValue?: string;
}

/**
 * How a list command builds its `lists.*` input from the current block. Routes
 * through `lists.apply` (seed a list), `lists.remove` (toggle off when the
 * block is already that list kind), or the hybrid indent family. For
 * `indent` / `outdent`, actual list items use `lists.indent` /
 * `lists.outdent`, while plain paragraphs fall back to
 * `format.paragraph.setIndentation` / `clearIndentation` so the legacy toolbar
 * semantics stay truthful in custom UIs.
 */
export interface ListCommandSpec {
  mode: 'toggle-seed' | 'indent' | 'outdent';
  /** List kind seeded by `lists.apply` for `toggle-seed`. */
  seed?: 'bullet' | 'ordered';
}

/**
 * How a link command routes through `hyperlinks.*`. With a range selection over
 * non-link text and an href → `hyperlinks.wrap`. With a collapsed target and
 * text/href → `hyperlinks.insert`. With an active link and a new href →
 * `hyperlinks.patch`. With an active link and `{ href: null }` →
 * `hyperlinks.remove` (unwrap).
 */
export interface LinkCommandSpec {
  kind: 'link';
}

/**
 * How a create command routes through `create.*`. Insertion location is derived
 * from the current block (`{ kind:'after', nodeId }`) or defaults to
 * `documentEnd` when there is no selection.
 */
export interface CreateCommandSpec {
  kind: 'table' | 'image' | 'toc';
}

/**
 * How a field command routes through `fields.insert`. The field lands at the
 * collapsed caret of the active header or footer story. The target keeps the
 * part the caret is editing, the same scope typing uses, so a section that
 * shares its header or footer with the previous section stays linked. Without
 * such a caret the command fails closed with `context-unavailable`.
 */
export interface FieldCommandSpec {
  /** Field instruction written as the native field code, e.g. `PAGE`. */
  instruction: string;
}

/** Number style of a section's pages, as Word's Format Page Numbers names them. */
export type PageNumberFormat =
  | 'decimal'
  | 'lowerLetter'
  | 'upperLetter'
  | 'lowerRoman'
  | 'upperRoman'
  | 'numberInDash'
  | 'hebrew1'
  | 'hebrew2';

/** Normalized input of the page-numbers-apply command. Omitted options keep the section's settings. */
export interface PageNumbersApplyCommandInput {
  /** 'header' numbers the top of the page, 'footer' the bottom. */
  kind: 'header' | 'footer';
  alignment?: 'left' | 'center' | 'right';
  showOnFirstPage?: boolean;
  format?: PageNumberFormat;
  /** First page number of the section, or null to continue from the previous section. */
  start?: number | null;
}

/** Normalized input of the page-numbers-remove command. */
export interface PageNumbersRemoveCommandInput {
  /** Remove only the header's or the footer's numbers. Omitted removes both. */
  kind?: 'header' | 'footer';
}

/**
 * How a table cell-context command routes through a `tables.*` operation once
 * the current table context is resolved.
 *
 * The whole `table-*` family routes against the live table context projected by
 * the shared V2 table-context facade (`host.getTableContext()`, surfaced as
 * `ui.tables.getContext()`). The controller derives the `TableLocator` inputs
 * (`nodeId`, `rowIndex` / `columnIndex`, cell locator, merge range) from that
 * snapshot — never from private editor internals. A command with no resolvable
 * table context fails closed with `table-context-unavailable`.
 */
export interface TableCommandSpec {
  /** Which table operation this command performs against the current context. */
  action:
    | 'insert-row-before'
    | 'insert-row-after'
    | 'delete-row'
    | 'insert-column-before'
    | 'insert-column-after'
    | 'delete-column'
    | 'delete-table'
    | 'merge-cells'
    | 'split-cell'
    | 'remove-borders';
  /** Document API operation member invoked on `activeEditor.doc.tables`. */
  op: string;
  /** Whether this action needs a resolved cell node (split) rather than table + index. */
  requiresCell?: boolean;
}

/**
 * Declarative descriptor for a built-in command id. Pure data plus pure
 * payload-normalizer functions — it holds no controller closures, so the
 * catalog stays a portable source of truth the controller interprets.
 */
export interface CommandDescriptor {
  /** Stable command id (matches the v1 headless-toolbar id where applicable). */
  id: string;
  /** Command family, for documentation / grouping. */
  family: string;
  /** Disposition: routed today, deferred, or unsupported. */
  disposition: CommandDisposition;
  /** Whether running this command mutates the document (read-only guarded). */
  mutates: boolean;
  /**
   * Canonical id this command is an alias of, when it routes the same public
   * behavior under a different (e.g. v1 kebab) id.
   */
  aliasOf?: string;
  /** Other ids that alias this command (documentation). */
  aliases?: readonly string[];
  /** Dotted path on the public Document API facade (`activeEditor.doc`). */
  docRoute?: string;
  /** Public SuperDoc-instance method this command calls. */
  instanceRoute?: string;
  /** Fixed argument passed to `instanceRoute` instead of the payload. */
  fixedArg?: unknown;
  /** Tracked-change decision this command performs. */
  trackDecision?: TrackDecisionSpec;
  /** Selection mark whose presence marks this command active. */
  activeMark?: string;
  /**
   * Inline-format routing spec. When present, the command routes through an
   * inline `format.*` operation against the live selection target rather than
   * forwarding the raw payload, and requires a non-empty range selection.
   */
  inline?: InlineFormatSpec;
  /**
   * Block-level paragraph routing spec. When present, the command resolves the
   * current paragraph block(s) from the selection and routes a
   * `format.paragraph.*` / `styles.paragraph.*` operation per block.
   */
  blockParagraph?: BlockParagraphSpec;
  /** List routing spec (`lists.apply` / `remove` / `indent` / `outdent`). */
  list?: ListCommandSpec;
  /** Hyperlink routing spec (`hyperlinks.wrap` / `patch` / `remove`). */
  link?: LinkCommandSpec;
  /** Create routing spec (`create.table` / `create.image` / `create.tableOfContents`). */
  create?: CreateCommandSpec;
  /** Header/footer field routing spec (`fields.insert` at the active caret). */
  field?: FieldCommandSpec;
  /**
   * Page numbering for the section under the caret, from anywhere in the
   * document (`headerFooters.pageNumbers.set` or `.remove`). Unavailable while
   * suggesting, because header/footer structure has no tracked-change form.
   */
  pageNumbers?: 'set' | 'remove';
  /** Table cell-context routing spec (`tables.*` against the live table context). */
  table?: TableCommandSpec;
  /** Controller state slice the command's `value` is read from. */
  valueFrom?: 'zoom' | 'documentMode' | 'ruler' | 'formattingMarks' | 'measurementUnit';
  /** Pure normalizer applied to the payload before routing. */
  normalizePayload?: (payload: unknown) => unknown;
  /** Stable reason for deferred / unsupported commands. */
  reason?: SuperDocUIReason;
}

// ---------------------------------------------------------------------------
// Payload normalizers (pure)
// ---------------------------------------------------------------------------

/** Strip a trailing `pt` unit from v1-style font sizes (`"12pt"` → `"12"`). */
export function normalizeFontSizePayload(payload: unknown): unknown {
  const strip = (value: unknown): unknown => (typeof value === 'string' ? value.replace(/\s*pt$/i, '').trim() : value);
  if (typeof payload === 'string') return strip(payload);
  if (payload && typeof payload === 'object' && 'value' in (payload as Record<string, unknown>)) {
    const record = payload as Record<string, unknown>;
    return { ...record, value: strip(record.value) };
  }
  return payload;
}

/**
 * Normalize v1-style zoom payloads to the percentage `SuperDoc.setZoom`
 * expects (`100 === 100%`). Accepts `150`, `"150%"`, `"1.5"`, or `1.5`.
 * Percentages pass through as numbers; legacy fraction-style values in the
 * `0..5` range are converted to percentages (`1.5` → `150`).
 */
export function normalizeZoomPayload(payload: unknown): unknown {
  const normalizeNumber = (value: number, percentLiteral: boolean): number => {
    if (!percentLiteral && value > 0 && value <= 5) return value * 100;
    return value;
  };
  if (typeof payload === 'string') {
    const isPercent = payload.includes('%');
    const parsed = Number.parseFloat(payload.replace('%', '').trim());
    if (!Number.isFinite(parsed)) return payload;
    return normalizeNumber(parsed, isPercent);
  }
  if (isFiniteNumber(payload)) {
    return normalizeNumber(payload, false);
  }
  return payload;
}

/**
 * Normalize a measurement-unit payload to the `'in'` / `'cm'` form
 * `SuperDoc.setMeasurementUnit` expects. Accepts the canonical `'in'` / `'cm'`,
 * a `{ value }` wrapper, or common long forms (`"inches"`, `"centimeters"`).
 * An unrecognized value passes through so the instance method can reject it.
 */
export function normalizeMeasurementUnitPayload(payload: unknown): unknown {
  const raw =
    payload && typeof payload === 'object' && 'value' in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).value
      : payload;
  if (raw === 'in' || raw === 'cm') return raw;
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (token === 'in' || token === 'inch' || token === 'inches') return 'in';
    if (
      token === 'cm' ||
      token === 'centimeter' ||
      token === 'centimeters' ||
      token === 'centimetre' ||
      token === 'centimetres'
    ) {
      return 'cm';
    }
  }
  return raw;
}

/**
 * Normalize a v1-style color payload to the `#RRGGBB` form the inline
 * `format.color` / `format.highlight` operations expect. Accepts `"#RRGGBB"`,
 * `"RRGGBB"`, or `{ value }`. `null` (clear) passes through unchanged; an
 * unrecognized value is returned as-is so the operation can reject it.
 */
export function normalizeColorPayload(payload: unknown): unknown {
  const coerce = (value: unknown): unknown => {
    if (value === null) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '') return value;
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
    return trimmed;
  };
  if (payload && typeof payload === 'object' && 'value' in (payload as Record<string, unknown>)) {
    const record = payload as Record<string, unknown>;
    return { ...record, value: coerce(record.value) };
  }
  return coerce(payload);
}

/** Unwrap a `{ value }` / `{ alignment } ` / `{ styleId }` wrapper to its scalar. */
function unwrapScalar(payload: unknown, keys: readonly string[]): unknown {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      if (key in record) return record[key];
    }
  }
  return payload;
}

/** Normalize a v1 alignment payload (`"left"`, `{ value }`, `"justified"`) to a `ParagraphAlignment`. */
export function normalizeAlignmentPayload(payload: unknown): unknown {
  const raw = unwrapScalar(payload, ['alignment', 'value']);
  if (typeof raw !== 'string') return raw;
  const v = raw.trim().toLowerCase();
  if (v === 'justified' || v === 'both') return 'justify';
  return v;
}

/**
 * Normalize a v1 line-height payload to OOXML auto line spacing (240ths of a
 * line: 240 = single, 360 = 1.5×, 480 = double). A multiplier in the `0..10`
 * range is converted (`1.5` → `360`); a larger raw value passes through.
 */
const PAGE_NUMBER_ALIGNMENTS = new Set(['left', 'center', 'right']);
const PAGE_NUMBER_FORMATS = new Set<string>([
  'decimal',
  'lowerLetter',
  'upperLetter',
  'lowerRoman',
  'upperRoman',
  'numberInDash',
  'hebrew1',
  'hebrew2',
]);

function readPageNumberKind(input: Record<string, unknown>): 'header' | 'footer' | null | undefined {
  if (input.kind !== undefined && input.kind !== 'header' && input.kind !== 'footer') return null;
  const position = input.position ?? (input.kind === 'header' ? 'top' : input.kind === 'footer' ? 'bottom' : undefined);
  if (position === undefined) return undefined;
  if (position !== 'top' && position !== 'bottom') return null;
  return position === 'top' ? 'header' : 'footer';
}

function readPageNumbersRecord(payload: unknown): Record<string, unknown> | null {
  if (payload !== undefined && payload !== null && typeof payload !== 'object') return null;
  return (payload ?? {}) as Record<string, unknown>;
}

/**
 * Normalize a page-numbers-apply payload. `position` takes 'top' or 'bottom';
 * `kind` takes 'header' or 'footer'; without either the numbers go at the bottom
 * of the page, as in Word. Other omitted options keep the section's settings.
 * Returns null for a value it does not recognize, so the command fails closed.
 */
export function normalizePageNumbersApplyPayload(payload: unknown): PageNumbersApplyCommandInput | null {
  const input = readPageNumbersRecord(payload);
  if (!input) return null;
  const kind = readPageNumberKind(input);
  if (kind === null) return null;
  if (input.alignment !== undefined && !PAGE_NUMBER_ALIGNMENTS.has(input.alignment as string)) return null;
  if (input.showOnFirstPage !== undefined && typeof input.showOnFirstPage !== 'boolean') return null;
  if (input.format !== undefined && !PAGE_NUMBER_FORMATS.has(input.format as string)) return null;
  if (
    input.start !== undefined &&
    input.start !== null &&
    (typeof input.start !== 'number' || !Number.isInteger(input.start) || input.start < 0)
  ) {
    return null;
  }
  return {
    kind: kind ?? 'footer',
    ...(input.alignment !== undefined
      ? { alignment: input.alignment as PageNumbersApplyCommandInput['alignment'] }
      : {}),
    ...(input.showOnFirstPage !== undefined ? { showOnFirstPage: input.showOnFirstPage as boolean } : {}),
    ...(input.format !== undefined ? { format: input.format as PageNumberFormat } : {}),
    ...(input.start !== undefined ? { start: input.start as number | null } : {}),
  };
}

/** Normalize a page-numbers-remove payload: an optional `position` or `kind`. */
export function normalizePageNumbersRemovePayload(payload: unknown): PageNumbersRemoveCommandInput | null {
  const input = readPageNumbersRecord(payload);
  if (!input) return null;
  const kind = readPageNumberKind(input);
  if (kind === null) return null;
  return kind ? { kind } : {};
}

export function normalizeLineHeightPayload(payload: unknown): unknown {
  const raw = unwrapScalar(payload, ['line', 'lineHeight', 'value']);
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw.trim()) : NaN;
  if (!Number.isFinite(num) || num <= 0) return raw;
  return num <= 10 ? Math.round(num * 240) : Math.round(num);
}

/** Preserve semantic style intent; normalize legacy linked-style payloads to a concrete ID. */
export function normalizeStyleIdPayload(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'role' in (payload as Record<string, unknown>)) {
    return payload;
  }
  const raw = unwrapScalar(payload, ['styleId', 'value', 'style']);
  return typeof raw === 'string' ? raw.trim() : raw;
}

/** Resolve a document-mode payload (`"viewing"` or `{ mode }`) to the mode string. */
export function normalizeDocumentModePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const mode = (payload as Record<string, unknown>).mode;
    if (typeof mode === 'string') return mode;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const UNSUPPORTED = SUPERDOC_UI_REASONS.commandUnsupported;
const TABLE_CONTEXT = SUPERDOC_UI_REASONS.tableContextUnavailable;

/**
 * The built-in command catalog. Order is documentation-only. Every v1
 * headless-toolbar id appears here with an explicit disposition; the 14
 * canonical v2 ids route today, the kebab track-change selection ids and the
 * zoom / document-mode ids are newly routed in this unit, and the remaining v1
 * workflows are deferred or marked product-unsupported with a stable reason.
 */
export const COMMAND_CATALOG = [
  // --- inline marks (routed; selection-target) -----------------------------
  {
    id: 'bold',
    family: 'inline marks',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.bold',
    activeMark: 'bold',
    inline: { key: 'bold', kind: 'toggle' },
  },
  {
    id: 'italic',
    family: 'inline marks',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.italic',
    activeMark: 'italic',
    inline: { key: 'italic', kind: 'toggle' },
  },
  {
    id: 'underline',
    family: 'inline marks',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.underline',
    activeMark: 'underline',
    inline: { key: 'underline', kind: 'toggle' },
  },
  {
    id: 'strikethrough',
    family: 'inline marks',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.strikethrough',
    activeMark: 'strikethrough',
    inline: { key: 'strike', kind: 'toggle' },
  },

  // --- fonts (routed; selection-target) ------------------------------------
  {
    id: 'font-family',
    family: 'fonts',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.fontFamily',
    aliases: ['setFontFamily'],
    inline: { key: 'fontFamily', kind: 'value-string' },
  },
  {
    id: 'font-size',
    family: 'fonts',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.fontSize',
    aliases: ['setFontSize'],
    normalizePayload: normalizeFontSizePayload,
    inline: { key: 'fontSize', kind: 'value-number' },
  },
  {
    id: 'setFontFamily',
    family: 'fonts',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.fontFamily',
    aliasOf: 'font-family',
    inline: { key: 'fontFamily', kind: 'value-string' },
  },
  {
    id: 'setFontSize',
    family: 'fonts',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.fontSize',
    aliasOf: 'font-size',
    normalizePayload: normalizeFontSizePayload,
    inline: { key: 'fontSize', kind: 'value-number' },
  },

  // --- history (routed) ----------------------------------------------------
  { id: 'undo', family: 'history', disposition: 'routed', mutates: true, docRoute: 'history.undo' },
  { id: 'redo', family: 'history', disposition: 'routed', mutates: true, docRoute: 'history.redo' },

  // --- tracked changes (routed) -------------------------------------------
  {
    id: 'acceptChange',
    family: 'tracked changes',
    disposition: 'routed',
    mutates: true,
    trackDecision: { kind: 'accept', scope: 'id' },
    aliases: ['track-changes-accept-selection'],
  },
  {
    id: 'rejectChange',
    family: 'tracked changes',
    disposition: 'routed',
    mutates: true,
    trackDecision: { kind: 'reject', scope: 'id' },
    aliases: ['track-changes-reject-selection'],
  },
  {
    id: 'acceptAllChanges',
    family: 'tracked changes (bulk)',
    disposition: 'routed',
    mutates: true,
    trackDecision: { kind: 'accept', scope: 'all' },
  },
  {
    id: 'rejectAllChanges',
    family: 'tracked changes (bulk)',
    disposition: 'routed',
    mutates: true,
    trackDecision: { kind: 'reject', scope: 'all' },
  },

  // --- tracked-change selection aliases (v1 kebab ids, newly routed) -------
  {
    id: 'track-changes-accept-selection',
    family: 'tracked changes',
    disposition: 'routed',
    mutates: true,
    trackDecision: { kind: 'accept', scope: 'id' },
    aliasOf: 'acceptChange',
  },
  {
    id: 'track-changes-reject-selection',
    family: 'tracked changes',
    disposition: 'routed',
    mutates: true,
    trackDecision: { kind: 'reject', scope: 'id' },
    aliasOf: 'rejectChange',
  },

  // --- zoom + document mode (routed via public SuperDoc-instance methods) --
  {
    id: 'zoom',
    family: 'zoom',
    disposition: 'routed',
    mutates: false,
    instanceRoute: 'setZoom',
    valueFrom: 'zoom',
    normalizePayload: normalizeZoomPayload,
  },
  {
    id: 'zoom-fit-width',
    family: 'zoom',
    disposition: 'routed',
    mutates: false,
    instanceRoute: 'setZoomMode',
    fixedArg: 'fit-width',
    valueFrom: 'zoom',
  },
  {
    id: 'document-mode',
    family: 'document',
    disposition: 'routed',
    mutates: false,
    instanceRoute: 'setDocumentMode',
    valueFrom: 'documentMode',
    normalizePayload: normalizeDocumentModePayload,
  },
  {
    id: 'measurement-unit',
    family: 'measurement',
    disposition: 'routed',
    mutates: false,
    instanceRoute: 'setMeasurementUnit',
    valueFrom: 'measurementUnit',
    normalizePayload: normalizeMeasurementUnitPayload,
  },

  // --- color (routed; selection-target) -----------------------------------
  {
    id: 'text-color',
    family: 'color',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.color',
    inline: { key: 'color', kind: 'value-string' },
    normalizePayload: normalizeColorPayload,
  },
  {
    id: 'highlight-color',
    family: 'color',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.highlight',
    inline: { key: 'highlight', kind: 'value-string' },
    normalizePayload: normalizeColorPayload,
  },

  // --- links (routed: hyperlinks.wrap/insert/patch/remove against the selection
  //     text-target + current-link state) ------------------------------------
  {
    id: 'link',
    family: 'links',
    disposition: 'routed',
    mutates: true,
    docRoute: 'hyperlinks.wrap',
    activeMark: 'link',
    link: { kind: 'link' },
  },

  // --- paragraph (routed: format.paragraph.* / styles.paragraph.* against the
  //     current paragraph block(s), resolved from the selection block id) -----
  {
    id: 'text-align',
    family: 'paragraph',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.paragraph.setAlignment',
    blockParagraph: { kind: 'alignment' },
    normalizePayload: normalizeAlignmentPayload,
  },
  {
    id: 'line-height',
    family: 'paragraph',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.paragraph.setSpacing',
    blockParagraph: { kind: 'spacing-line' },
    normalizePayload: normalizeLineHeightPayload,
  },
  {
    id: 'linked-style',
    family: 'paragraph',
    disposition: 'routed',
    mutates: true,
    docRoute: 'styles.paragraph.setStyle',
    blockParagraph: { kind: 'style' },
    normalizePayload: normalizeStyleIdPayload,
  },

  // --- lists + indent (lists apply/remove stay list-only; indent/outdent are
  //     hybrid and switch between list-level and paragraph-level indentation
  //     based on the current block context) ----------------------------------
  {
    id: 'bullet-list',
    family: 'lists',
    disposition: 'routed',
    mutates: true,
    docRoute: 'lists.apply',
    list: { mode: 'toggle-seed', seed: 'bullet' },
  },
  {
    id: 'numbered-list',
    family: 'lists',
    disposition: 'routed',
    mutates: true,
    docRoute: 'lists.apply',
    list: { mode: 'toggle-seed', seed: 'ordered' },
  },
  {
    id: 'indent-increase',
    family: 'lists/indent',
    disposition: 'routed',
    mutates: true,
    docRoute: 'lists.indent',
    list: { mode: 'indent' },
  },
  {
    id: 'indent-decrease',
    family: 'lists/indent',
    disposition: 'routed',
    mutates: true,
    docRoute: 'lists.outdent',
    list: { mode: 'outdent' },
  },

  // --- direction (routed: format.paragraph.setDirection on the current block) -
  {
    id: 'direction-ltr',
    family: 'direction',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.paragraph.setDirection',
    blockParagraph: { kind: 'direction', fixedValue: 'ltr' },
  },
  {
    id: 'direction-rtl',
    family: 'direction',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.paragraph.setDirection',
    blockParagraph: { kind: 'direction', fixedValue: 'rtl' },
  },

  // --- formatting (routed; selection-target inline clear) ------------------
  {
    id: 'clear-formatting',
    family: 'formatting',
    disposition: 'routed',
    mutates: true,
    docRoute: 'format.apply',
    inline: { key: '*', kind: 'clear' },
  },

  // --- media / structure (routed: create.* at the current block / doc end) -
  {
    id: 'image',
    family: 'media',
    disposition: 'routed',
    mutates: true,
    docRoute: 'create.image',
    create: { kind: 'image' },
  },
  {
    id: 'table-of-contents-insert',
    family: 'TOC',
    disposition: 'routed',
    mutates: true,
    docRoute: 'create.tableOfContents',
    create: { kind: 'toc' },
  },
  {
    id: 'table-insert',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'create.table',
    create: { kind: 'table' },
  },

  // --- header/footer fields (routed: fields.insert at the active caret) ----
  {
    id: 'page-number-insert',
    family: 'fields',
    disposition: 'routed',
    mutates: true,
    docRoute: 'fields.insert',
    field: { instruction: 'PAGE' },
  },
  // --- page numbering (routed: headerFooters.pageNumbers.* for the caret's section)
  {
    id: 'page-numbers-apply',
    family: 'fields',
    disposition: 'routed',
    mutates: true,
    docRoute: 'headerFooters.pageNumbers.set',
    pageNumbers: 'set',
    normalizePayload: normalizePageNumbersApplyPayload,
  },
  {
    id: 'page-numbers-remove',
    family: 'fields',
    disposition: 'routed',
    mutates: true,
    docRoute: 'headerFooters.pageNumbers.remove',
    pageNumbers: 'remove',
    normalizePayload: normalizePageNumbersRemovePayload,
  },

  // --- table cell-context operations: routed via the shared table-context
  //     facade (phase 2). Each is a real v2 `tables.*` operation that needs a
  //     `TableLocator` (the current table / row / column / cell). The current
  //     table context is now resolved from the shared V2 table-context surface
  //     (`host.getTableContext()`, exposed as `ui.tables.getContext()`) instead
  //     of being a permanent context gap. The controller derives the locator
  //     inputs from that snapshot and routes the operation. With no resolvable
  //     table context they still fail closed with the precise, named
  //     `table-context-unavailable` reason (unit + browser coverage).
  {
    id: 'table-add-row-before',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.insertRow',
    table: { action: 'insert-row-before', op: 'insertRow' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-add-row-after',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.insertRow',
    table: { action: 'insert-row-after', op: 'insertRow' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-delete-row',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.deleteRow',
    table: { action: 'delete-row', op: 'deleteRow' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-add-column-before',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.insertColumn',
    table: { action: 'insert-column-before', op: 'insertColumn' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-add-column-after',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.insertColumn',
    table: { action: 'insert-column-after', op: 'insertColumn' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-delete-column',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.deleteColumn',
    table: { action: 'delete-column', op: 'deleteColumn' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-delete',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.delete',
    table: { action: 'delete-table', op: 'delete' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-merge-cells',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.mergeCells',
    table: { action: 'merge-cells', op: 'mergeCells' },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-split-cell',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.splitCell',
    table: { action: 'split-cell', op: 'splitCell', requiresCell: true },
    reason: TABLE_CONTEXT,
  },
  {
    id: 'table-remove-borders',
    family: 'tables',
    disposition: 'routed',
    mutates: true,
    docRoute: 'tables.setBorders',
    table: { action: 'remove-borders', op: 'setBorders' },
    reason: TABLE_CONTEXT,
  },

  // --- host-owned UI chrome (phase 2 ownership decision) -------------------
  // `ruler` and `formatting-marks` are built-in / host-owned chrome backed by
  // stable public `SuperDoc`-instance methods (`toggleRuler`,
  // `toggleFormattingMarks` / `setShowFormattingMarks`). They are routed
  // through those methods so a custom UI drives the same chrome the built-in
  // toolbar does. They are non-mutating controls (enabled in viewing mode) and
  // expose live active state from the SuperDoc config.
  {
    id: 'ruler',
    family: 'UI chrome',
    disposition: 'routed',
    mutates: false,
    instanceRoute: 'toggleRuler',
    valueFrom: 'ruler',
  },
  {
    id: 'formatting-marks',
    family: 'UI chrome',
    disposition: 'routed',
    mutates: false,
    instanceRoute: 'toggleFormattingMarks',
    valueFrom: 'formattingMarks',
  },

  // `copy-format` is a controller-backed format-painter interaction: it is a
  // routed custom-UI command, but not a single public Document API verb.
  // `table-fix` remains the signed v2 product exception with no public
  // functional-parity surface and therefore fails closed with the stable
  // `command-unsupported` reason.
  { id: 'copy-format', family: 'formatting', disposition: 'routed', mutates: false },
  { id: 'table-fix', family: 'tables', disposition: 'unsupported', mutates: true, reason: UNSUPPORTED },
] as const satisfies readonly CommandDescriptor[];

const CATALOG_BY_ID: ReadonlyMap<string, CommandDescriptor> = new Map(
  COMMAND_CATALOG.map((descriptor) => [descriptor.id, descriptor]),
);

/** All built-in command ids known to the controller (routed + deferred + unsupported). */
export const ALL_BUILT_IN_COMMAND_IDS: readonly BuiltInCommandId[] = COMMAND_CATALOG.map((d) => d.id);

/** Resolve a command descriptor by id, or `null` when the id is unknown. */
export function getCommandDescriptor(id: string): CommandDescriptor | null {
  return CATALOG_BY_ID.get(id) ?? null;
}
