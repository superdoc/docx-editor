/**
 * Internal built-in toolbar compatibility catalog (V2 toolbar parity, phase 1).
 *
 * This module is the SINGLE place the legacy built-in toolbar item names (the
 * ids v1 toolbars, `modules.toolbar.groups`, and the docs use) are mapped onto
 * the V2 world. Later renderers, the toolbar authority, and any proof helper
 * consume this catalog instead of rediscovering the mapping ad hoc.
 *
 * It does NOT re-implement command routing. The V2 command controller catalog
 * in `../../public/ui/commands.ts` stays the single source of truth for how a
 * command is backed; every `controller-routed` entry here points at a canonical
 * command id that must exist there (enforced by `assertCatalogAlignedWithController`).
 *
 * Every documented built-in item is classified into exactly one disposition:
 *
 *   - `controller-routed` → driven by the V2 command controller (a routed
 *     command id in `COMMAND_CATALOG`).
 *   - `host-routed` → driven by a public `SuperDoc`-instance method the built-in
 *     shell owns directly (e.g. formatting-marks toggle), not by the controller
 *     command set.
 *   - `shell-owned` → pure rendered-shell chrome/config the built-in toolbar
 *     owns (custom buttons, layout groups). Has no command and no document
 *     effect of its own.
 *   - `unsupported` → documented built-in item that is explicitly out of V2
 *     functional parity (a signed product decision). The controller command (if
 *     any) fails closed with `command-unsupported`; the docs do not call it
 *     supported.
 *   - `unresolved` → documented today but with no identified public V2 surface
 *     yet. Recorded explicitly so later phases close it deliberately rather than
 *     pretending it already works.
 *
 * Nothing here reintroduces a public `headless-toolbar*` export; the catalog is
 * internal to the `superdoc` package.
 */
import { getCommandDescriptor } from '../../public/ui/commands.js';

/** Layout regions a built-in toolbar item can be placed in. */
export type ToolbarGroup = 'left' | 'center' | 'right';

/** How a documented built-in toolbar item is (or is not) backed on V2. */
export type ToolbarItemDisposition = 'controller-routed' | 'host-routed' | 'shell-owned' | 'unsupported' | 'unresolved';

/** One documented built-in toolbar item and how it maps onto V2. */
export interface BuiltInToolbarItemEntry {
  /** Legacy built-in item name (the id v1 toolbars and the docs use). */
  readonly name: string;
  /**
   * Canonical V2 controller command id this item routes to. Present for
   * `controller-routed` items; `null` for host/shell/unresolved items.
   */
  readonly commandId: string | null;
  /**
   * Public `SuperDoc`-instance method the built-in shell calls to drive this
   * item. Present for `host-routed` items; `null` otherwise.
   */
  readonly instanceMethod: string | null;
  /** Disposition bucket. */
  readonly disposition: ToolbarItemDisposition;
  /** Default layout group for the rendered shell. */
  readonly group: ToolbarGroup;
  /**
   * Member controller command ids for an item that fans out into a family of
   * commands (e.g. `tableActions`). Documentation + later renderer use.
   */
  readonly memberCommandIds?: readonly string[];
  /**
   * Stable explanation. Required for `host-routed`, `shell-owned`, and
   * `unresolved` items so the non-controller disposition is never opaque.
   */
  readonly note?: string;
}

/**
 * Member controller command ids the legacy `tableActions` dropdown fans out
 * into. These are real V2 `tables.*` operations now routed through the shared
 * table-context facade (`ui.tables` / `host.getTableContext()`): each is a
 * `routed` controller command that enables when a table context is resolvable
 * and fails closed with `table-context-unavailable` otherwise. The dropdown
 * itself is shell chrome; its members are controller-routed.
 */
const TABLE_ACTION_COMMAND_IDS = [
  'table-add-row-before',
  'table-add-row-after',
  'table-delete-row',
  'table-add-column-before',
  'table-add-column-after',
  'table-delete-column',
  'table-delete',
  'table-merge-cells',
  'table-split-cell',
  'table-remove-borders',
] as const;

/**
 * The built-in toolbar compatibility catalog. Order groups items the way the
 * docs present them; it is documentation-only.
 *
 * Every documented `Available buttons` entry from
 * the built-in UI documentation appears here exactly once, plus the
 * `customButtons` shell concept.
 */
export const BUILT_IN_TOOLBAR_CATALOG: readonly BuiltInToolbarItemEntry[] = [
  // --- text formatting -----------------------------------------------------
  { name: 'bold', commandId: 'bold', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  { name: 'italic', commandId: 'italic', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  {
    name: 'underline',
    commandId: 'underline',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  // v1 `strike` → v2 `strikethrough`.
  {
    name: 'strike',
    commandId: 'strikethrough',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  {
    name: 'clearFormatting',
    commandId: 'clear-formatting',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  {
    name: 'copyFormat',
    commandId: 'copy-format',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },

  // --- font controls -------------------------------------------------------
  // v1 `fontFamily` → v2 `font-family`.
  {
    name: 'fontFamily',
    commandId: 'font-family',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  { name: 'fontSize', commandId: 'font-size', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  // v1 `color` → v2 `text-color`.
  { name: 'color', commandId: 'text-color', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  // v1 `highlight` → v2 `highlight-color`.
  {
    name: 'highlight',
    commandId: 'highlight-color',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },

  // --- paragraph -----------------------------------------------------------
  // v1 `textAlign` → v2 `text-align`.
  {
    name: 'textAlign',
    commandId: 'text-align',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  // v1 `list` → v2 `bullet-list`.
  { name: 'list', commandId: 'bullet-list', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  // v1 `numberedlist` → v2 `numbered-list`.
  {
    name: 'numberedlist',
    commandId: 'numbered-list',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  // v1 `indentleft` → v2 `indent-decrease`.
  {
    name: 'indentleft',
    commandId: 'indent-decrease',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  // v1 `indentright` → v2 `indent-increase`.
  {
    name: 'indentright',
    commandId: 'indent-increase',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  // v1 `lineHeight` → v2 `line-height`.
  {
    name: 'lineHeight',
    commandId: 'line-height',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },
  // v1 `linkedStyles` → v2 `linked-style`.
  {
    name: 'linkedStyles',
    commandId: 'linked-style',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'center',
  },

  // --- insert --------------------------------------------------------------
  { name: 'link', commandId: 'link', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  { name: 'image', commandId: 'image', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  {
    name: 'watermark',
    commandId: null,
    instanceMethod: 'ui.watermark.open',
    disposition: 'host-routed',
    group: 'center',
    note: 'opens the shared Watermark dialog through superdoc.ui.watermark.open; the workflow owns scope, edit permissions, and apply',
  },
  // v1 `table` → v2 `table-insert`.
  { name: 'table', commandId: 'table-insert', instanceMethod: null, disposition: 'controller-routed', group: 'center' },
  {
    name: 'tableActions',
    commandId: null,
    instanceMethod: null,
    disposition: 'shell-owned',
    group: 'center',
    memberCommandIds: TABLE_ACTION_COMMAND_IDS,
    note: 'table editing dropdown is shell chrome; its member commands are controller-routed through the shared table-context facade (ui.tables / host.getTableContext()) and fail closed with table-context-unavailable when the caret is not in a table',
  },

  // --- tools ---------------------------------------------------------------
  { name: 'undo', commandId: 'undo', instanceMethod: null, disposition: 'controller-routed', group: 'left' },
  { name: 'redo', commandId: 'redo', instanceMethod: null, disposition: 'controller-routed', group: 'left' },
  {
    name: 'search',
    commandId: null,
    instanceMethod: null,
    disposition: 'shell-owned',
    group: 'right',
    note: 'built-in search button; opens the shared find/replace surface (the same one Cmd/Ctrl+F opens) by emitting a `search:open` event on the SuperDoc instance, which the shell handles. The surface reads/drives the controller search surface (ui.search), backed by the single V2 host search session (host.search) which owns query, navigation, reveal, and replace. Find/navigation are always available when the host exposes search; replace/replaceAll mutate through the host session and fail closed (document-readonly) in viewing/read-only mode. If a runtime cannot expose search, the surface fails closed with search-unavailable',
  },
  { name: 'zoom', commandId: 'zoom', instanceMethod: null, disposition: 'controller-routed', group: 'right' },
  {
    name: 'measurementUnit',
    commandId: 'measurement-unit',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'right',
  },
  {
    name: 'ruler',
    commandId: null,
    instanceMethod: 'toggleRuler',
    disposition: 'host-routed',
    group: 'right',
    note: 'built-in shell toggles ruler visibility through the public SuperDoc.toggleRuler() instance method; the controller also routes the ruler command through it so custom UIs drive the same chrome (active state from config.rulers)',
  },
  {
    name: 'formattingMarks',
    commandId: null,
    instanceMethod: 'toggleFormattingMarks',
    disposition: 'host-routed',
    group: 'right',
    note: 'built-in shell toggles nonprinting marks through the public SuperDoc.toggleFormattingMarks()/setShowFormattingMarks() instance methods (not a controller command)',
  },
  // v1 `documentMode` → v2 `document-mode`.
  {
    name: 'documentMode',
    commandId: 'document-mode',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'right',
  },

  // --- track changes -------------------------------------------------------
  {
    name: 'acceptTrackedChangeBySelection',
    commandId: 'track-changes-accept-selection',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'right',
  },
  {
    name: 'rejectTrackedChangeOnSelection',
    commandId: 'track-changes-reject-selection',
    instanceMethod: null,
    disposition: 'controller-routed',
    group: 'right',
  },

  // --- shell-owned chrome --------------------------------------------------
  {
    name: 'customButtons',
    commandId: null,
    instanceMethod: null,
    disposition: 'shell-owned',
    group: 'center',
    note: 'consumer-defined buttons the rendered shell owns; their execution context surface is phase 2',
  },
];

const CATALOG_BY_NAME: ReadonlyMap<string, BuiltInToolbarItemEntry> = new Map(
  BUILT_IN_TOOLBAR_CATALOG.map((entry) => [entry.name, entry]),
);

/** All documented built-in toolbar item names known to the catalog. */
export const ALL_BUILT_IN_TOOLBAR_ITEM_NAMES: readonly string[] = BUILT_IN_TOOLBAR_CATALOG.map((entry) => entry.name);

/** Resolve a built-in toolbar item entry by its legacy name, or `null`. */
export function getBuiltInToolbarItem(name: string): BuiltInToolbarItemEntry | null {
  return CATALOG_BY_NAME.get(name) ?? null;
}

/** All built-in toolbar items declared for a layout group, in catalog order. */
export function listBuiltInToolbarItemsByGroup(group: ToolbarGroup): BuiltInToolbarItemEntry[] {
  return BUILT_IN_TOOLBAR_CATALOG.filter((entry) => entry.group === group);
}

/**
 * Resolve a legacy built-in item name to its canonical V2 controller command
 * id, or `null` when the item is not controller-routed.
 */
export function resolveToolbarCommandId(name: string): string | null {
  const entry = CATALOG_BY_NAME.get(name);
  return entry?.disposition === 'controller-routed' ? entry.commandId : null;
}

/**
 * Cross-check the catalog against the V2 command controller catalog so the two
 * cannot drift. Throws on the first inconsistency. Exercised by the unit tests;
 * kept exported so a future renderer/build guard can reuse it.
 */
export function assertCatalogAlignedWithController(): void {
  const seen = new Set<string>();
  for (const entry of BUILT_IN_TOOLBAR_CATALOG) {
    if (seen.has(entry.name)) {
      throw new Error(`toolbar compatibility catalog: duplicate item name "${entry.name}"`);
    }
    seen.add(entry.name);

    if (entry.disposition === 'controller-routed') {
      if (!entry.commandId) {
        throw new Error(`toolbar compatibility catalog: "${entry.name}" is controller-routed but has no commandId`);
      }
      const descriptor = getCommandDescriptor(entry.commandId);
      if (!descriptor) {
        throw new Error(
          `toolbar compatibility catalog: "${entry.name}" maps to unknown controller command "${entry.commandId}"`,
        );
      }
      if (descriptor.disposition !== 'routed') {
        throw new Error(
          `toolbar compatibility catalog: "${entry.name}" maps to non-routed controller command ` +
            `"${entry.commandId}" (controller disposition "${descriptor.disposition}")`,
        );
      }
      continue;
    }

    if (entry.commandId) {
      throw new Error(
        `toolbar compatibility catalog: "${entry.name}" is ${entry.disposition} and must not carry a commandId`,
      );
    }
    if (entry.disposition === 'host-routed' && !entry.instanceMethod) {
      throw new Error(`toolbar compatibility catalog: host-routed "${entry.name}" needs an instanceMethod`);
    }
    // Controller-routed entries already `continue`d above, so everything that
    // reaches this point needs an explanatory note.
    if (!entry.note) {
      throw new Error(`toolbar compatibility catalog: ${entry.disposition} "${entry.name}" needs an explanatory note`);
    }
    // Any member command ids that are declared must exist in the controller catalog.
    for (const memberId of entry.memberCommandIds ?? []) {
      if (!getCommandDescriptor(memberId)) {
        throw new Error(
          `toolbar compatibility catalog: "${entry.name}" references unknown member command "${memberId}"`,
        );
      }
    }
  }
}
