/**
 * Internal rendered built-in toolbar shell (V2 toolbar parity, phase 3).
 *
 * This is the real `superdoc.toolbar` handle for `new SuperDoc({ toolbar })`. It
 * renders the legacy built-in toolbar DOM (preserving item names and
 * `data-item="btn-*"` selectors) and exposes the documented handle surface
 * (`getToolbarItemByName`, `getToolbarItemByGroup`, `updateToolbarState`,
 * `destroy`, and `on`/`off` for the exception channel).
 *
 * It does NOT own command truth, and it does not own the controller either.
 * Like the v1 toolbar (which consumed a headless controller), this shell
 * subscribes to the SuperDoc-owned controller (`superdoc.ui`) for every
 * command's enable/active/value state and routes every execution through
 * `ui.commands.executeAsync(...)`. SuperDoc creates and destroys that
 * controller, so a toolbar remount never tears down state the link popover,
 * keyboard routing, or application code is still observing. Legacy built-in item names
 * map onto canonical V2 command ids through the one compatibility catalog
 * (`./compatibility-catalog.js`); the shell never re-implements selection,
 * enablement, or command routing, and never reaches into private v1/v2 editor
 * internals (`activeEditor.commands` is `null` on V2).
 *
 * Internal only: nothing here is a public package export and no
 * `headless-toolbar*` subpath is reintroduced.
 */
import { EventEmitter } from 'eventemitter3';
import { executeFirstPartyCommandAsync } from '../../public/ui/create-super-doc-ui.js';
import { createApp, shallowRef } from 'vue';
import type { App, Component, ComponentPublicInstance, Ref } from 'vue';
import { vClickOutside } from '@superdoc/common';
import type {
  Editor,
  SuperDoc,
  SuperDocExceptionToolbarPayload,
  ToolbarCustomButton,
  ToolbarFontOption,
} from '../../core/types/index.js';
import type {
  BorrowedSuperDocUI,
  CommandState,
  CustomCommandRegistrationResult,
  StyleCatalogItem,
  ToolbarSnapshotSlice,
} from '../../public/ui/types.js';

import {
  ALL_BUILT_IN_TOOLBAR_ITEM_NAMES,
  TABLE_ACTION_COMMAND_IDS,
  tableActionCommandId,
  getBuiltInToolbarItem,
  resolveBuiltInItemCommandId,
} from './compatibility-catalog.js';
import { TOOLBAR_ITEM_ALIASES } from './toolbar-item-aliases.js';
import { createImageFilePicker, resolveImageSrc } from './image-upload.js';

import Toolbar from './built-in/Toolbar.vue';
import { makeDefaultItems, withLinkHref } from './built-in/default-items.js';
import { useToolbarItem } from './built-in/use-toolbar-item.js';
import { toolbarIcons } from './built-in/toolbarIcons.js';
import { toolbarTexts } from './built-in/toolbarTexts.js';
import { mapFontFamilyOptionsToToolbar } from './built-in/constants.js';
import { renderColorOptions } from './built-in/color-dropdown-helpers.js';
import { findElementBySelector } from './built-in/general.js';

interface ToolbarItem {
  type: string;
  name: Ref<string>;
  command?: unknown;
  group: Ref<string>;
  attributes: Ref<Record<string, unknown>>;
  disabled: Ref<boolean>;
  active: Ref<boolean>;
  expand: Ref<boolean>;
  nestedOptions: Ref<unknown[]>;
  label: Ref<unknown>;
  defaultLabel: Ref<unknown>;
  icon: Ref<unknown>;
  selectedValue: Ref<unknown>;
  allowWithoutEditor: Ref<boolean | undefined>;
  initiallyDisabled: boolean;
  isCustomToolbarItem?: boolean;
  activate(attributes?: Record<string, unknown>, ...args: unknown[]): void;
  deactivate(): void;
  setDisabled(state: boolean): void;
  resetDisabled(): void;
  onActivate(attributes?: Record<string, unknown>, ...args: unknown[]): unknown;
}

type ToolbarCommandCallback = (context: {
  item: ToolbarItem;
  argument?: unknown;
  option?: unknown;
  [key: string]: unknown;
}) => unknown;

type CustomButtonPayload = { argument?: unknown; option?: unknown };

type ToolbarGroupComposition = Record<string, string[]>;

type ImageFilePicker = ReturnType<typeof createImageFilePicker>;

type ExecuteCommandOptions = {
  firstParty?: boolean;
  reportUnhandled?: boolean;
  onSettled?: () => void;
  onError?: (error: unknown) => void;
};

type BuiltInToolbarConfig = {
  selector: string | HTMLElement | null;
  element?: string | HTMLElement | null;
  toolbarGroups: string[];
  role: string;
  icons: Record<string, unknown>;
  texts: Record<string, unknown>;
  fonts: readonly ToolbarFontOption[] | null;
  hideButtons: boolean;
  responsiveToContainer: boolean;
  mode: string;
  excludeItems: readonly string[];
  toolbarButtonsExclude: readonly string[];
  groups: string[] | ToolbarGroupComposition | null;
  customButtons: readonly ToolbarCustomButton[];
  showFormattingMarksButton: boolean;
  showTableOfContentsButton: boolean;
  showWatermarkButton: boolean;
  showPageNumberButton: boolean;
  uiDisplayFallbackFont?: string;
};

type BuiltInToolbarOptions = {
  superdoc?: SuperDoc | null;
  editor?: Editor | null;
  selector?: string | HTMLElement | null;
  element?: string | HTMLElement | null;
  role?: string;
  isDev?: boolean;
  hideButtons?: boolean;
  responsiveToContainer?: boolean;
  uiDisplayFallbackFont?: string;
  [option: string]: unknown;
};

type DocumentModeUi = { label: unknown; icon: unknown };

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function isToolbarCommandCallback(value: unknown): value is ToolbarCommandCallback {
  return typeof value === 'function';
}

function describeError(error: unknown): string {
  const message =
    (typeof error === 'object' || typeof error === 'function') && error !== null && 'message' in error
      ? error.message
      : undefined;
  return `${message ?? String(error)}`;
}

type ListenerTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

function isListenerTarget(value: unknown): value is ListenerTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    'addEventListener' in value &&
    typeof value.addEventListener === 'function' &&
    'removeEventListener' in value &&
    typeof value.removeEventListener === 'function'
  );
}

function hasClosest(target: EventTarget | null): target is EventTarget & Pick<Element, 'closest'> {
  return target !== null && 'closest' in target && typeof target.closest === 'function';
}

function executeCommand(
  ui: BorrowedSuperDocUI | null,
  commandId: string,
  argument: unknown,
  options: ExecuteCommandOptions = {},
): boolean {
  if (!ui?.commands || !commandId) return false;
  if (typeof ui.commands.has === 'function' && !ui.commands.has(commandId)) return false;
  const execute: ((id: string, payload?: unknown) => unknown) | undefined =
    typeof ui.commands.executeAsync === 'function' ? ui.commands.executeAsync : ui.commands.execute;
  if (typeof execute !== 'function') return false;
  const result = options.firstParty
    ? executeFirstPartyCommandAsync(ui, commandId, argument)
    : argument === undefined
      ? execute.call(ui.commands, commandId)
      : execute.call(ui.commands, commandId, argument);
  const reportFailure = (settled: unknown) => {
    if (!options.reportUnhandled || settled !== false) return;
    options.onError?.(
      new Error(
        `[superdoc toolbar] Command "${commandId}" did not run. Check that it is enabled and has the required input.`,
      ),
    );
  };
  if (isThenable(result)) {
    void Promise.resolve(result).then(
      (settled) => {
        reportFailure(settled);
        options.onSettled?.();
      },
      (error) => {
        options.onError?.(error);
        options.onSettled?.();
      },
    );
  } else {
    reportFailure(result);
    options.onSettled?.();
  }
  return true;
}

const PAGE_NUMBER_COMMAND_IDS = ['page-numbers-apply', 'page-number-insert'];

const V1_ENABLED_ON_SELECTION_REASON = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'highlight',
  'link',
  'clearFormatting',
  'textAlign',
  'list',
  'numberedlist',
  'indentleft',
  'indentright',
  'lineHeight',
  'linkedStyles',
]);
const V1_ENABLED_ON_EMPTY_REASON = new Set(['list', 'numberedlist']);

function shouldKeepEnabledForV1ToolbarParity(name: string, commandState: CommandState | undefined): boolean {
  if (name === 'fontFamily' || name === 'fontSize') return true;
  if (
    V1_ENABLED_ON_EMPTY_REASON.has(name) &&
    commandState?.disabled &&
    commandState?.supported !== false &&
    commandState?.reason == null
  ) {
    return true;
  }
  if (!V1_ENABLED_ON_SELECTION_REASON.has(name)) return false;
  const reason = commandState?.reason;
  return reason === 'range-selection-required' || reason === 'selection-required';
}

function isToolbarSurface(target: EventTarget | null): boolean {
  return Boolean(
    hasClosest(target) &&
    target.closest('[data-editor-ui-surface], .toolbar-dropdown-menu, .sd-toolbar-dropdown-menu, .sd-tooltip-content'),
  );
}

function isSelectionKey(e: KeyboardEvent): boolean {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key);
}

const RESERVED_TOOLBAR_ITEM_NAMES = new Set([
  ...ALL_BUILT_IN_TOOLBAR_ITEM_NAMES,
  ...Object.keys(TOOLBAR_ITEM_ALIASES),
  'ai',
  'overflow',
  'tableOfContents',
]);

/**
 * The rendered built-in toolbar. Shape-compatible with the historical
 * `superdoc.toolbar` (`SuperToolbar`) surface so existing docs, examples, the
 * proof lane, and behavior tests resolve against a real object.
 */
export class BuiltInToolbar extends EventEmitter {
  config: BuiltInToolbarConfig = {
    selector: null,
    toolbarGroups: ['left', 'center', 'right'],
    role: 'editor',
    icons: { ...toolbarIcons },
    texts: { ...toolbarTexts },
    fonts: null,
    hideButtons: true,
    responsiveToContainer: false,
    mode: 'docx',
    excludeItems: [],
    toolbarButtonsExclude: [],
    groups: null,
    customButtons: [],
    showFormattingMarksButton: false,
    showTableOfContentsButton: false,
    showWatermarkButton: false,
    showPageNumberButton: false,
  };

  toolbarItems: ToolbarItem[] = [];
  overflowItems: ToolbarItem[] = [];
  #imagePicker: ImageFilePicker | null = null;
  #groupItems = new Map<string, ToolbarItem[]>();
  #highlightOptions = new WeakMap<ToolbarItem, unknown[]>();
  #painterListenersDetach: (() => void) | null = null;
  isDev = false;
  role = 'editor';
  superdoc: SuperDoc | null | undefined = undefined;
  toolbarContainer: HTMLElement | null = null;
  toolbar: ComponentPublicInstance | null = null;
  _detachFontsChanged: (() => void) | null = null;
  _linkedStyleOptions = shallowRef<readonly StyleCatalogItem[]>([]);
  declare app?: App | null;
  declare activeEditor: Editor | null;
  declare ui: BorrowedSuperDocUI | null;
  declare snapshot: ToolbarSnapshotSlice | null;
  declare _unsubscribeController: (() => void) | null;
  declare _detachFormatPainterModeChange: (() => void) | null;
  declare _customCommandRegs: Map<string, CustomCommandRegistrationResult<CustomButtonPayload>>;
  declare _reportedInvalidCustomItems: Set<string>;
  declare _lastFontOptionsSignature: string;

  constructor(config: BuiltInToolbarOptions = {}) {
    super();

    this.config = { ...this.config, ...config };
    this.toolbarItems = [];
    this.overflowItems = [];
    this.isDev = config.isDev || false;
    this.superdoc = config.superdoc;
    this.role = config.role || 'editor';
    this.toolbarContainer = null;

    this.config.icons = { ...toolbarIcons, ...this.config.icons };
    this.config.texts = { ...toolbarTexts, ...this.config.texts };
    this.config.hideButtons = config.hideButtons ?? true;
    this.config.responsiveToContainer = config.responsiveToContainer ?? false;

    /** Active editor compatibility reference (set by `SuperDoc.setActiveEditor`). */
    this.activeEditor = config.editor ?? this.superdoc?.activeEditor ?? null;

    /** SuperDoc-owned command controller (single command-state truth). */
    this.ui = null;
    /** Latest controller toolbar snapshot. */
    this.snapshot = null;
    /** Controller subscription unsubscribe handle. */
    this._unsubscribeController = null;
    /** Format-painter mode subscription unsubscribe handle. */
    this._detachFormatPainterModeChange = null;
    /** Registered custom-button command unregister handles. */
    this._customCommandRegs = new Map();
    /**
     * Custom entries already reported as unbuildable.
     *
     * `#makeToolbarItems` runs on every throttled resize and on font or
     * active-editor changes, not only at construction, so a single static
     * configuration error would otherwise fire `exception` once per rebuild --
     * unbounded, into consumer telemetry, for a mistake that cannot change
     * without a reconfigure. Keyed by name plus message so a different fault
     * on the same entry still reports once.
     */
    this._reportedInvalidCustomItems = new Set();
    /** Signature of the last-built font options, to skip redundant rebuilds. */
    this._lastFontOptionsSignature = '';

    // Move legacy `element` to `selector`.
    if (!this.config.selector && this.config.element) {
      this.config.selector = this.config.element;
    }

    this.toolbarContainer = findElementBySelector(this.config.selector);
    if (this.toolbarContainer) {
      const uiFontFamily =
        (this.config?.uiDisplayFallbackFont || '').toString().trim() || 'Arial, Helvetica, sans-serif';
      this.toolbarContainer.style.setProperty('--sd-ui-font-family', uiFontFamily);
    }

    // Everything from here binds to `superdoc.ui`, which the instance owns and
    // other consumers share. `SuperDoc.#addToolbar` treats a toolbar failure as
    // non-fatal and drops the handle, so a throw part-way through would leave
    // this object's subscription and its custom-command registrations attached
    // to the canonical controller with nothing able to reach them: later
    // recomputes would drive an abandoned toolbar and its buttons would linger
    // as commands nobody can invoke. Unwind before rethrowing.
    //
    // Before this branch the toolbar owned its controller, so an abandoned one
    // was merely garbage; sharing is what makes the cleanup necessary.
    try {
      this.#initController();
      this.#initToolbarGroups();
      this.#makeToolbarItems();
      this.#bindHostEvents();

      this._lastFontOptionsSignature = this.#fontOptionsSignature();

      // No resolved container means this is a handle-only toolbar. Keep item
      // lookup/command routing usable, but do not allocate or unmount a Vue app.
      if (!this.toolbarContainer) {
        this.updateToolbarState();
        return;
      }

      this.app = createApp(Toolbar as Component);
      this.app.directive('click-outside', vClickOutside);
      this.app.config.globalProperties.$toolbar = this;
      this.toolbar = this.app.mount(this.toolbarContainer);

      this.updateToolbarState();
    } catch (error) {
      // `destroy()` is the same unwind a caller would run, and every step of it
      // is already null-safe, so a partially built toolbar is fine to pass
      // through it. A failure in cleanup must not mask the original error.
      try {
        this.destroy();
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Shared controller wiring
  // ---------------------------------------------------------------------------

  #initController() {
    // Consume, never construct: `superdoc.ui` is the one controller for the
    // instance. A host that does not expose one leaves the toolbar in its
    // handle-only state (item lookup works, command state stays inert)
    // instead of quietly spawning a second source of command truth.
    const ui = this.superdoc?.ui ?? null;
    this.ui = ui;
    if (!ui) return;
    this.snapshot = ui.toolbar.getSnapshot();
    this._unsubscribeController = ui.toolbar.subscribe(() => {
      this.snapshot = ui.toolbar.getSnapshot();
      if (this.getToolbarItemByName('linkedStyles')?.expand.value) {
        this.#refreshLinkedStyleOptions();
      }
      this.updateToolbarState();
    });
    this._detachFormatPainterModeChange = ui.formatPainter.onModeChange((mode) => {
      if (mode === 'armed' || mode === 'persistent') {
        this.#armFormatPainterListeners();
      } else {
        this.#disarmFormatPainterListeners();
      }
    });
  }

  #destroyController() {
    this._unsubscribeController?.();
    this._unsubscribeController = null;
    this._detachFormatPainterModeChange?.();
    this._detachFormatPainterModeChange = null;
    this.#disarmFormatPainterListeners();
    for (const reg of this._customCommandRegs.values()) {
      try {
        reg.unregister?.();
      } catch {
        /* ignore */
      }
    }
    this._customCommandRegs.clear();
    // The controller itself is SuperDoc's to destroy. Dropping the reference
    // is all the toolbar may do; destroying it here would break every other
    // consumer bound to the same instance.
    this.ui = null;
    this.snapshot = null;
  }

  #bindHostEvents() {
    if (!this.superdoc || typeof this.superdoc.on !== 'function' || typeof this.superdoc.off !== 'function') return;
    const handleFontsChanged = () => {
      const signature = this.#fontOptionsSignature();
      if (signature !== this._lastFontOptionsSignature) {
        this._lastFontOptionsSignature = signature;
        this.#rebuildToolbarItems();
      }
      this.updateToolbarState();
    };
    this.superdoc.on('fonts-changed', handleFontsChanged);
    this._detachFontsChanged = () => {
      this.superdoc?.off?.('fonts-changed', handleFontsChanged);
    };
  }

  #destroyHostEvents() {
    this._detachFontsChanged?.();
    this._detachFontsChanged = null;
  }

  // ---------------------------------------------------------------------------
  // Item construction / layout
  // ---------------------------------------------------------------------------

  #initToolbarGroups() {
    // `ui.toolbar.groups` accepts both the historical ordering array and the
    // composition map. The array controls which layout groups render; it is
    // not a list of toolbar item names. Leaving it in `config.groups` makes
    // `#makeToolbarItems` treat "left", "center", and "right" as item names
    // and filter every real button out of the toolbar.
    if (Array.isArray(this.config.groups)) {
      this.config.toolbarGroups = this.config.groups;
      this.config.groups = null;
      return;
    }
    if (this.config.groups && !Array.isArray(this.config.groups) && Object.keys(this.config.groups).length) {
      this.config.toolbarGroups = Object.keys(this.config.groups);
    }
  }

  getAvailableWidth() {
    const documentWidth = document.documentElement.clientWidth;
    const containerWidth = this.toolbarContainer?.offsetWidth ?? 0;
    return this.config.responsiveToContainer ? containerWidth : documentWidth;
  }

  #resolveToolbarFonts(configFonts: readonly ToolbarFontOption[] | null) {
    // A consumer-provided `modules.toolbar.fonts` list owns the dropdown verbatim.
    if (configFonts) return configFonts;
    // Otherwise use the host's activation-aware family list (baseline vs rich pack, curation, and
    // document fonts already merged). Empty => undefined so default-items keeps its TOOLBAR_FONTS fallback.
    const options = this.superdoc?.fonts?.getFontFamilyOptions?.() ?? [];
    return mapFontFamilyOptionsToToolbar(options);
  }

  #makeToolbarItems() {
    const availableWidth = this.getAvailableWidth();
    const selectedCustomOptions = new Map(
      this.#getAllToolbarItems()
        .filter((item) => item.isCustomToolbarItem && item.type === 'dropdown')
        .map((item): [string, unknown] => [item.name.value, item.selectedValue.value]),
    );
    const groups = this.config.groups;
    const groupComposition = groups && !Array.isArray(groups) && Object.keys(groups).length > 0 ? groups : null;
    const configuredItemNames = groupComposition
      ? new Set(Object.values(groupComposition).flatMap((items) => items))
      : null;
    const excludedItemNames = new Set([
      ...(this.config.excludeItems ?? []),
      ...(this.config.toolbarButtonsExclude ?? []),
    ]);

    const customItems = this.config.customButtons || [];
    // `useToolbarItem` throws on a missing name, an unknown type, and a button
    // with no icon and no `defaultLabel`. Nothing caught those, so a single
    // malformed custom entry took the whole toolbar down with it: the throw
    // escaped `#makeToolbarItems`, the toolbar never finished building, and the
    // consumer lost all of the built-in items over one of their own buttons.
    // Skipping just the bad entry keeps that blast radius to the entry itself.
    // A name that repeats, or that matches a built-in item, renders a second
    // control under the same `data-item` and neither one responds -- the
    // toolbar looks configured and is not. The type cannot express uniqueness,
    // so it is checked here alongside the shapes `useToolbarItem` rejects.
    // Built-in names stay reserved even when a focused composition omits them.
    // Reusing one can enter the built-in's name-based command path instead of
    // the custom callback.
    const takenNames = new Set(RESERVED_TOOLBAR_ITEM_NAMES);
    const customToolbarItems = customItems
      .map((item, index) => {
        try {
          if (item?.name && takenNames.has(item.name)) {
            throw new Error(
              `Toolbar item name "${item.name}" is already taken by another item, so this entry is skipped.`,
            );
          }
          const prepared = this.#prepareCustomButton(item);
          if (selectedCustomOptions.has(prepared.name.value)) {
            prepared.selectedValue.value = selectedCustomOptions.get(prepared.name.value);
          }
          takenNames.add(prepared.name?.value);
          return prepared;
        } catch (error) {
          // Position, not just name, for an entry that has none: two distinct
          // nameless entries failing the same way are two separate mistakes,
          // and keying only on `<unnamed>` reported one and hid the rest, so a
          // consumer could not tell how many of their entries were broken.
          // Named entries key on the name so their diagnostic survives a
          // reorder.
          const identity = item?.name ?? `<unnamed@${index}>`;
          const signature = `${identity}::${describeError(error)}`;
          if (!this._reportedInvalidCustomItems.has(signature)) {
            this._reportedInvalidCustomItems.add(signature);
            this.#emitCommandException(error, item?.name ?? null);
          }
          return null;
        }
      })
      .filter((item) => item !== null);
    const configuredGroups = new Set(groupComposition ? Object.keys(groupComposition) : []);
    const layoutCustomItems = groupComposition
      ? customToolbarItems.filter((item) => configuredGroups.has(item.group?.value || 'center'))
      : customToolbarItems;

    let allConfigItems: string[] | null = null;
    if (groupComposition) {
      const groupedItems = Object.values(groupComposition).flatMap((item) => item);
      const groupedCustomItems = customToolbarItems
        .filter((item) => configuredGroups.has(item.group?.value || 'center'))
        .map((item) => item.name.value);
      allConfigItems = [...new Set([...groupedItems, ...groupedCustomItems])];
    }

    const defaultItemsInput = {
      superToolbar: this,
      toolbarIcons: this.config.icons,
      toolbarTexts: this.config.texts,
      toolbarFonts: this.#resolveToolbarFonts(this.config.fonts),
      hideButtons: this.config.hideButtons,
      availableWidth,
      role: this.role,
      isDev: this.isDev,
      configuredItemNames,
      // A composition map is a consumer-authored priority order, not just an
      // allowlist: when width forces a choice, whichever controls the
      // consumer listed first should be the ones that stay visible, not
      // whichever happens to come first in the built-in registry. Without
      // this, `makeDefaultItems` decides visibility/overflow by walking its
      // fixed internal order, so a width that only fits one of three
      // configured controls could keep the "wrong" one visible relative to
      // what the consumer asked for.
      configuredItemOrder: allConfigItems,
      excludedItemNames,
      additionalItems: layoutCustomItems as never[],
    };
    const { defaultItems, overflowItems }: { defaultItems: ToolbarItem[]; overflowItems: ToolbarItem[] } =
      makeDefaultItems(defaultItemsInput);

    if (allConfigItems === null) {
      allConfigItems = [
        ...defaultItems.map((item) => item.name.value),
        ...overflowItems.map((item) => item.name.value),
      ];
    }

    const configuredOverflowItems = overflowItems.filter(
      (item) => allConfigItems.includes(item.name.value) && !excludedItemNames.has(item.name.value),
    );
    const visibleItemNames = configuredOverflowItems.length ? [...allConfigItems, 'overflow'] : allConfigItems;
    const filteredItems = defaultItems
      .filter((item) => visibleItemNames.includes(item.name.value))
      .filter((item) => !excludedItemNames.has(item.name.value));

    // An explicit composition map is a consumer-authored sequence, not just
    // an allowlist: `allConfigItems` already walks the map's arrays in the
    // order the consumer wrote them, so reuse that order here instead of the
    // fixed registry order `filteredItems`/`configuredOverflowItems` came in
    // as. The array-of-group-names selection shape never sets
    // `hasExplicitGroupComposition`, so it keeps the registry order it has
    // always had.
    if (groupComposition) {
      const orderIndex = new Map(allConfigItems.map((name, index) => [name, index]));
      const rank = (item: ToolbarItem) => orderIndex.get(item.name.value) ?? Number.MAX_SAFE_INTEGER;

      // The overflow trigger is never part of `allConfigItems` (consumers
      // must not name it), and `default-items.js` deliberately does not put
      // it last -- it reinserts it next to whatever followed it in the
      // built-in layout. Ranking it last here would relocate it every time a
      // composition-map toolbar overflows, so it is pulled out, the rest are
      // sorted by consumer order, and it is reinserted using the same
      // relative-position rule `default-items.js` uses.
      const overflowTrigger = filteredItems.find((item) => item.name.value === 'overflow');
      const originalIndex = new Map(filteredItems.map((item, index) => [item, index]));
      const reordered = filteredItems.filter((item) => item !== overflowTrigger);
      reordered.sort((a, b) => rank(a) - rank(b));
      if (overflowTrigger) {
        const triggerOriginalIndex = originalIndex.get(overflowTrigger) ?? -1;
        const insertAt = reordered.findIndex((item) => (originalIndex.get(item) ?? -1) > triggerOriginalIndex);
        if (insertAt === -1) reordered.push(overflowTrigger);
        else reordered.splice(insertAt, 0, overflowTrigger);
      }
      filteredItems.splice(0, filteredItems.length, ...reordered);

      configuredOverflowItems.sort((a, b) => rank(a) - rank(b));
    }

    // Apply explicit per-group placement only for the composition-map shape.
    if (groupComposition) {
      for (const [group, names] of Object.entries(groupComposition)) {
        for (const item of filteredItems) {
          if (names.includes(item.name.value)) item.group.value = group;
        }
      }
    }

    this.toolbarItems = filteredItems;
    this.overflowItems = configuredOverflowItems;
  }

  /**
   * Wrap a consumer custom-button config into a reactive toolbar item and, when
   * it carries a `command` callback, register that callback as a custom command
   * on the shared controller so it receives the V2-truthful shared context
   * (`insertText`, `execute`, `doc`, `ui`, ...). The toolbar-specific `option`
   * and `argument` are threaded through the command payload.
   */
  #prepareCustomButton(config: ToolbarCustomButton): ToolbarItem {
    const item: ToolbarItem = useToolbarItem({ ...config });
    item.isCustomToolbarItem = true;
    const callback = config.command;
    if (isToolbarCommandCallback(callback) && this.ui?.commands?.register) {
      const id = `__builtin_toolbar__${config.name}`;
      if (!this._customCommandRegs.has(id)) {
        const reg = this.ui.commands.register<CustomButtonPayload>({
          id,
          execute: (context) => {
            const payload: CustomButtonPayload =
              context?.payload && typeof context.payload === 'object' ? context.payload : {};
            try {
              const result = callback({ ...context, item, argument: payload.argument, option: payload.option });
              if (isThenable(result)) {
                return Promise.resolve(result).catch((error) => {
                  this.#emitCommandException(error, config.name);
                  return false;
                });
              }
              return result;
            } catch (error) {
              this.#emitCommandException(error, config.name);
              return false;
            }
          },
        });
        this._customCommandRegs.set(id, reg);
      }
    }
    return item;
  }

  #rebuildToolbarItems() {
    this.#makeToolbarItems();
    this.emit('toolbar-items-changed');
  }

  #fontOptionsSignature() {
    if (this.config.fonts) return 'custom-fonts';
    // Hash the SAME source the dropdown renders (getFontFamilyOptions), not the document-only
    // options: activation toggles (baseline vs rich pack) and curation change the family list
    // without changing document fonts, and those must still trigger a rebuild.
    const options = this.superdoc?.fonts?.getFontFamilyOptions?.() ?? [];
    return JSON.stringify(options.map((option) => [option.label, option.value, option.previewFamily]));
  }

  // ---------------------------------------------------------------------------
  // Public handle API
  // ---------------------------------------------------------------------------

  getToolbarItemByGroup(groupName: string): ToolbarItem[] {
    const items = this.toolbarItems.filter((item) => (item.group?.value || 'center') === groupName);
    const previous = this.#groupItems.get(groupName);
    if (previous?.length === items.length && previous.every((item, index) => item === items[index])) return previous;
    if (this.#groupItems.size >= 32) this.#groupItems.clear();
    this.#groupItems.set(groupName, items);
    return items;
  }

  getToolbarItemByName(name: string): ToolbarItem | undefined {
    return this.#getAllToolbarItems().find((item) => item.name.value === name);
  }

  #getAllToolbarItems(): ToolbarItem[] {
    return [...this.toolbarItems, ...this.overflowItems];
  }

  /**
   * The available linked-style options for the linked-styles dropdown. Projected
   * from the shared controller's public `superdoc/ui` style catalogue
   * (`ui.styles.getQuickGallery()`), which reads the Document API style catalogue
   * (`styles.getCatalog`) and honors `w:qFormat` with a v1-style alphabetical
   * fallback. Returns normalized `StyleCatalogItem`s (`id`, `name`, optional
   * `preview.css`, visibility), never raw style-model shapes. Empty when the
   * styles surface is unreachable (viewing mode, worker-backed editor, pre-ready
   * editor). Applying a style still routes through the shared `linked-style`
   * command, which targets `styles.paragraph.setStyle`.
   */
  getLinkedStyleOptions(): readonly StyleCatalogItem[] {
    this.#refreshLinkedStyleOptions();
    return this._linkedStyleOptions.value;
  }

  #refreshLinkedStyleOptions() {
    const allStyles = this.ui?.styles?.getCatalog?.({ includePreview: true });
    const catalog = this.ui?.styles?.getCatalog?.({ view: 'quickGallery', includePreview: true });
    const options = catalog?.items ?? this.ui?.styles?.getQuickGallery?.() ?? [];
    const activeStyleId = this.ui?.styles?.getActiveParagraphStyle?.()?.styleId;
    const activeStyle =
      activeStyleId && !options.some((style) => style.id === activeStyleId)
        ? allStyles?.styles?.find(
            (style) => style.id === activeStyleId && (style.type === 'paragraph' || style.type === 'linked'),
          )
        : null;
    const nextOptions = activeStyle ? [activeStyle, ...options] : options;
    const previousOptions = this._linkedStyleOptions.value;
    if (
      nextOptions.length !== previousOptions.length ||
      nextOptions.some((style, index) => style !== previousOptions[index])
    ) {
      this._linkedStyleOptions.value = nextOptions;
    }
  }

  /**
   * The stable style id active across the current selection's paragraph(s), or
   * `null` for a mixed selection / when the styles surface is unreachable. Used
   * to mark the active option in the linked-styles dropdown.
   */
  getActiveLinkedStyleId(): string | null {
    return this.ui?.styles?.getActiveParagraphStyle?.()?.styleId ?? null;
  }

  async updateLinkedStyleToMatchSelection(styleId: string) {
    if (!styleId || typeof this.ui?.styles?.updateToMatchSelection !== 'function') return null;
    try {
      return await this.ui.styles.updateToMatchSelection({ styleId });
    } catch (error) {
      this.#emitCommandException(error, 'linkedStyles');
      return null;
    } finally {
      this.updateToolbarState();
    }
  }

  /**
   * Compatibility hook: `SuperDoc` calls this when the active editor changes.
   * The shared controller already tracks selection/transaction state, so this
   * just refreshes font options (the new document may carry different fonts) and
   * re-projects item state.
   */
  setActiveEditor(editor: Editor | null) {
    this.activeEditor = editor;
    const signature = this.#fontOptionsSignature();
    if (signature !== this._lastFontOptionsSignature) {
      this._lastFontOptionsSignature = signature;
      this.#rebuildToolbarItems();
    }
    if (this.ui) this.snapshot = this.ui.toolbar.getSnapshot();
    this.updateToolbarState();
  }

  onToolbarResize = () => {
    this.#makeToolbarItems();
    this.updateToolbarState();
  };

  // ---------------------------------------------------------------------------
  // State projection (consumes the shared controller snapshot)
  // ---------------------------------------------------------------------------

  #hostRoutedActive(name: string): boolean {
    if (name === 'ruler') return Boolean(this.superdoc?.config?.rulers);
    if (name === 'formattingMarks') {
      return Boolean(this.superdoc?.config?.layoutEngineOptions?.showFormattingMarks);
    }
    return false;
  }

  #canRunHostAction(name: string): boolean {
    if (name === 'watermark') {
      return this.ui?.document?.getSnapshot?.().ready === true && typeof this.ui?.watermark?.open === 'function';
    }
    if (name === 'ruler') return typeof this.superdoc?.toggleRuler === 'function';
    if (name === 'formattingMarks') {
      return (
        typeof this.superdoc?.toggleFormattingMarks === 'function' ||
        typeof this.superdoc?.setShowFormattingMarks === 'function'
      );
    }
    return false;
  }

  #syncDocumentModeUi() {
    const documentModeItem = this.getToolbarItemByName('documentMode');
    if (!documentModeItem) return;

    const snapshotMode = this.snapshot?.commands?.['document-mode']?.value;
    const mode = String(snapshotMode || 'editing').toLowerCase();
    const texts = this.config.texts || {};
    const icons = this.config.icons || {};
    const editing: DocumentModeUi = {
      label: texts.documentEditingMode || 'Editing',
      icon: icons.documentEditingMode || icons.documentMode,
    };
    const map: Readonly<Record<string, DocumentModeUi | undefined>> = {
      editing,
      suggesting: {
        label: texts.documentSuggestingMode || 'Suggesting',
        icon: icons.documentSuggestingMode || icons.documentMode,
      },
      viewing: { label: texts.documentViewingMode || 'Viewing', icon: icons.documentViewingMode || icons.documentMode },
    };

    const next = map[mode] || editing;
    if (documentModeItem.label?.value !== undefined) documentModeItem.label.value = next.label;
    if (documentModeItem.defaultLabel?.value !== undefined) documentModeItem.defaultLabel.value = next.label;
    if (documentModeItem.icon?.value !== undefined && next.icon) documentModeItem.icon.value = next.icon;
  }

  #updateHighlightColors() {
    // V2 has no converter-backed document highlight palette surface; the shared
    // default swatches are used. Document-specific highlight history can be
    // wired through a public surface in a later phase.
    const highlightItem = this.toolbarItems.find((item) => item.name.value === 'highlight');
    if (!highlightItem) return;
    let options = this.#highlightOptions.get(highlightItem);
    if (!options) {
      options = [{ key: 'color', type: 'render', render: () => renderColorOptions(this, highlightItem, [], true) }];
      this.#highlightOptions.set(highlightItem, options);
    }
    highlightItem.nestedOptions.value = options;
  }

  #isFontSizeMixedState(commandState: CommandState | undefined): boolean {
    return Boolean(commandState?.active) && commandState?.value == null;
  }

  // Inline font-family marks never report `active` (the descriptor has no
  // `activeMark`), so a selection spanning multiple families surfaces as an
  // enabled command with no resolved value. Treat that as the mixed state.
  #isFontFamilyMixedState(commandState: CommandState | undefined): boolean {
    return Boolean(commandState) && commandState?.disabled === false && commandState?.value == null;
  }

  isCommandEnabled(commandId: string | undefined): boolean {
    if (!commandId) return false;
    const commandState = this.snapshot?.commands?.[commandId];
    return Boolean(commandState && !commandState.disabled);
  }

  #applyHeadlessState(item: ToolbarItem): boolean {
    const name = item.name.value;

    if (item.isCustomToolbarItem && typeof item.command === 'string') {
      const commandState = this.snapshot?.commands?.[item.command];
      item.setDisabled(item.initiallyDisabled || !this.isCommandEnabled(item.command));
      if (commandState?.active) item.activate();
      else item.deactivate();
      return true;
    }

    if (name === 'tableActions') {
      item.setDisabled(!TABLE_ACTION_COMMAND_IDS.some((commandId) => this.isCommandEnabled(commandId)));
      return true;
    }

    if (name === 'search') {
      item.setDisabled(this.superdoc?.uiConfig?.search?.enabled !== true);
      return true;
    }

    if (name === 'pageNumber') {
      // The popover numbers the caret's section or inserts at a header/footer
      // cursor. It opens whenever either action can run, and while suggesting
      // so it can explain that numbering needs Editing.
      const pageNumberStates = PAGE_NUMBER_COMMAND_IDS.map((commandId) => this.snapshot?.commands?.[commandId]);
      const suggesting = this.ui?.document?.getSnapshot?.()?.mode === 'suggesting';
      item.setDisabled(!suggesting && !pageNumberStates.some((state) => state && !state.disabled));
      return true;
    }

    const entry = getBuiltInToolbarItem(name);
    // Host-routed chrome toggles (ruler, formatting marks).
    if (entry?.disposition === 'host-routed') {
      item.setDisabled(!this.#canRunHostAction(name));
      if (this.#hostRoutedActive(name)) item.activate();
      else item.deactivate();
      return true;
    }

    const commandId = resolveBuiltInItemCommandId(name);
    if (!commandId) return false;

    const commandState = this.snapshot?.commands?.[commandId];
    if (shouldKeepEnabledForV1ToolbarParity(name, commandState)) item.setDisabled(false);
    else item.setDisabled(Boolean(commandState?.disabled));

    const handlers: { default: () => void; [name: string]: (() => void) | undefined } = {
      textAlign: () => {
        if (commandState?.value) item.activate({ textAlign: commandState.value });
        else item.deactivate();
      },
      lineHeight: () => {
        item.selectedValue.value = commandState?.value != null ? commandState.value : '';
      },
      zoom: () => {
        if (commandState?.value != null) {
          const value = typeof commandState.value === 'number' ? `${commandState.value}%` : String(commandState.value);
          item.onActivate({ zoom: value });
        }
      },
      measurementUnit: () => {
        if (commandState?.value != null) {
          item.onActivate({ measurementUnit: String(commandState.value) });
        }
      },
      documentMode: () => {
        this.#syncDocumentModeUi();
      },
      link: () => {
        item.active.value = Boolean(commandState?.active);
        // Write only the href: `attributes` also carries the item's static
        // configuration, `ariaLabel` among it, and this runs on every sync.
        const href = commandState?.value ?? null;
        if (
          href
            ? item.attributes.value?.href !== href
            : Object.prototype.hasOwnProperty.call(item.attributes.value ?? {}, 'href')
        ) {
          item.attributes.value = withLinkHref(item.attributes.value, href);
        }
      },
      fontFamily: () => {
        if (commandState?.value != null) {
          item.activate({ fontFamily: commandState.value });
          return;
        }
        if (this.#isFontFamilyMixedState(commandState)) {
          item.activate({}, true);
          return;
        }
        item.deactivate();
      },
      fontSize: () => {
        if (commandState?.value != null) {
          item.activate({ fontSize: commandState.value });
          return;
        }
        if (this.#isFontSizeMixedState(commandState)) {
          item.activate({}, true);
          return;
        }
        item.deactivate();
      },
      color: () => {
        if (commandState?.value != null) item.activate({ color: commandState.value });
        else item.deactivate();
      },
      highlight: () => {
        if (commandState?.value != null) item.activate({ color: commandState.value });
        else item.deactivate();
      },
      linkedStyles: () => {
        const value = commandState?.value;
        const styleValue = typeof value === 'object' && value !== null ? value : null;
        const styleId =
          typeof value === 'string' ? value : styleValue && 'styleId' in styleValue ? styleValue.styleId : undefined;
        const styleName = styleValue ? ('styleName' in styleValue ? styleValue.styleName : undefined) : null;
        if (styleId) item.activate({ styleId, styleName });
        else item.label.value = this.config.texts?.formatText || 'Format text';
      },
      list: () => {
        if (commandState?.active) {
          item.activate();
          item.selectedValue.value = commandState.value;
        } else {
          item.deactivate();
          item.selectedValue.value = null;
        }
      },
      numberedlist: () => {
        if (commandState?.active) {
          item.activate();
          item.selectedValue.value = commandState.value;
        } else {
          item.deactivate();
          item.selectedValue.value = null;
        }
      },
      default: () => {
        if (commandState?.active) item.activate();
        else item.deactivate();
      },
    };

    (handlers[name] ?? handlers.default)();
    return true;
  }

  updateToolbarState() {
    this.#syncDocumentModeUi();
    this.#updateHighlightColors();

    const snapshotMode = this.snapshot?.commands?.['document-mode']?.value;
    const currentMode = snapshotMode || 'editing';
    const ready = Boolean(this.snapshot) && (this.superdoc?.activeEditor ?? this.activeEditor);

    if (!ready || currentMode === 'viewing') {
      this.#deactivateAll();
      this.#getAllToolbarItems().forEach((item) => {
        const usesDirectCommand = item.isCustomToolbarItem && typeof item.command === 'string';
        if (item.allowWithoutEditor?.value || usesDirectCommand) this.#applyHeadlessState(item);
      });
    } else {
      this.#getAllToolbarItems().forEach((item) => {
        if (!this.#applyHeadlessState(item)) item.resetDisabled();
      });
    }

    const overflow = this.getToolbarItemByName('overflow');
    overflow?.setDisabled(!this.overflowItems.some((item) => item.type !== 'separator' && !item.disabled.value));

    const copyFormatItem = this.getToolbarItemByName('copyFormat');
    if (copyFormatItem) {
      if (this.snapshot?.copyFormatActive) copyFormatItem.activate();
      else copyFormatItem.deactivate();
    }

    this.emit('toolbar-state-change');
  }

  #deactivateAll() {
    this.#getAllToolbarItems().forEach((item) => {
      const { allowWithoutEditor } = item;
      if (allowWithoutEditor?.value) return;
      item.setDisabled(true);
    });
  }

  // ---------------------------------------------------------------------------
  // Command execution (routes through the shared controller)
  // ---------------------------------------------------------------------------

  #runHostAction(name: string, argument: unknown): boolean {
    const superdoc = this.superdoc;
    if (name === 'watermark') {
      if (!this.#canRunHostAction(name) || !this.ui) return false;
      const result = this.ui.watermark.open();
      if (!result.ok) throw new Error(`[superdoc toolbar] Watermark dialog unavailable: ${result.reason}`);
      return true;
    }
    if (name === 'ruler') {
      if (typeof superdoc?.toggleRuler === 'function') {
        superdoc.toggleRuler();
        return true;
      }
      return false;
    }
    if (name === 'formattingMarks') {
      if (typeof argument === 'boolean' && typeof superdoc?.setShowFormattingMarks === 'function') {
        superdoc.setShowFormattingMarks(argument);
        return true;
      }
      if (typeof superdoc?.toggleFormattingMarks === 'function') {
        superdoc.toggleFormattingMarks();
        return true;
      }
    }
    return false;
  }

  /**
   * Execute the controller-backed command for an item through the shared
   * controller. Returns true when handled.
   */
  #executeControllerCommand(item: ToolbarItem, argument: unknown): boolean {
    const name = item?.name?.value;
    if (!name) return false;
    const callbacks: ExecuteCommandOptions = {
      firstParty: true,
      onSettled: () => this.updateToolbarState(),
      onError: (error) => this.#emitCommandException(error, name),
    };

    // The plain image button carries no payload; acquire one interactively.
    // A caller-supplied argument (e.g. `{ src }`) keeps the direct route.
    if (name === 'image' && argument == null) {
      return this.#startImagePick();
    }

    if (name === 'tableActions') {
      const tableAction =
        typeof argument === 'object' && argument !== null && 'command' in argument ? argument.command : undefined;
      const commandId = typeof tableAction === 'string' ? tableActionCommandId(tableAction) : undefined;
      if (!commandId) return false;
      return executeCommand(this.ui, commandId, undefined, callbacks);
    }

    const entry = getBuiltInToolbarItem(name);
    if (entry?.disposition === 'unsupported') {
      // Fail closed for signed-out controls (e.g. copyFormat).
      return true;
    }

    const commandId = resolveBuiltInItemCommandId(name);
    if (!commandId) return false;
    return executeCommand(this.ui, commandId, argument, callbacks);
  }

  /**
   * Open the image file picker and dispatch the picked file through the
   * controller `image` command (`create.image`) as a base64 data-URI payload.
   * Returns true — the picker flow owns the command from here (a cancelled
   * native dialog is a plain no-op).
   */
  #startImagePick(): boolean {
    // Fail closed when the controller reports the command unavailable
    // (viewing mode / no editor); the button is disabled in that state.
    const commandState = this.snapshot?.commands?.['image'];
    if (commandState?.disabled) return true;
    if (!this.#imagePicker) {
      this.#imagePicker = createImageFilePicker({
        ownerDocument: this.toolbarContainer?.ownerDocument ?? document,
        onPick: async (file) => {
          const src = await resolveImageSrc(file, this.superdoc?.config?.handleImageUpload);
          executeCommand(
            this.ui,
            'image',
            { src },
            {
              firstParty: true,
              onSettled: () => this.updateToolbarState(),
              onError: (error) => this.#emitCommandException(error, 'image'),
            },
          );
        },
        onError: (error) => this.#emitCommandException(error, 'image'),
      });
    }
    this.#imagePicker.open();
    return true;
  }

  #armFormatPainterListeners() {
    if (this.#painterListenersDetach) return;
    const editorContainer = this.superdoc?.activeEditor?.container;
    const container: ListenerTarget = isListenerTarget(editorContainer) ? editorContainer : document;

    const onPointerDown = (e: PointerEvent) => {
      if (isToolbarSurface(e.target)) return;
      this.ui?.formatPainter.setPointerSelecting(true);
    };
    const onPointerUp = (e: PointerEvent) => {
      this.ui?.formatPainter.setPointerSelecting(false);
      if (isToolbarSurface(e.target)) return;
      this.ui?.formatPainter.notifyPointerUp();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.ui?.formatPainter.cancel();
        return;
      }
      if (isSelectionKey(e)) this.ui?.formatPainter.setKeyboardSelecting(true);
    };
    const onKeyUp = () => {
      this.ui?.formatPainter.setKeyboardSelecting(false);
      this.ui?.formatPainter.notifyKeyUp();
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('keyup', onKeyUp);

    this.#painterListenersDetach = () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('keyup', onKeyUp);
    };
  }

  #disarmFormatPainterListeners() {
    if (this.#painterListenersDetach) {
      this.#painterListenersDetach();
      this.#painterListenersDetach = null;
    }
  }

  #emitCommandException(originalError: unknown, name: string | null | undefined) {
    const error = originalError instanceof Error ? originalError : new Error(String(originalError));
    const payload: SuperDocExceptionToolbarPayload = {
      error,
      originalError,
      itemName: name ?? null,
      editor: this.superdoc?.activeEditor ?? this.activeEditor ?? null,
    };
    // Snapshotted before the toolbar emit, not at the host emit below. A
    // toolbar listener runs synchronously inside `this.emit`, so a copy taken
    // afterwards would already carry whatever that listener changed -- the
    // isolation this copy exists for has to be established first.
    const hostPayload = { ...payload };
    this.emit('exception', payload);
    // Also forwarded to the host, because item construction happens inside the
    // toolbar constructor: `SuperDoc.#addToolbar` cannot assign the handle
    // until that returns, so nothing can have subscribed to the toolbar yet
    // and a skipped entry would vanish with no way to diagnose it. The host
    // exists before the toolbar is built, so a consumer's `onException` sees
    // this one. Toolbar listeners still get the later, post-construction ones.
    //
    // The host gets its own object: the two channels have different
    // audiences, and a toolbar listener must not change what the host sees.
    // `itemName` is the discriminator the public union documents for this
    // variant.
    this.superdoc?.emit?.('exception', hostPayload);
  }

  /**
   * Main toolbar command entry point used by the rendered components.
   */
  emitCommand({ item, argument, option }: { item: ToolbarItem; argument?: unknown; option?: unknown }) {
    const name = item?.name?.value;
    const { command } = item;

    const hasArgument = argument !== null && argument !== undefined;
    const isDropdownOpen = item?.type === 'dropdown' && !hasArgument;
    const isFontCommand = command === 'setFontFamily' || command === 'setFontSize';
    if (isDropdownOpen && isFontCommand) {
      // Opening/closing a font dropdown is not a command.
      return;
    }

    // Shell-owned search: the toolbar button opens the shared find/replace
    // surface (same one as Cmd/Ctrl+F) via the SuperDoc instance, instead of a
    // bespoke toolbar popover.
    if (name === 'search') {
      this.superdoc?.emit?.('search:open');
      return;
    }

    try {
      const entry = getBuiltInToolbarItem(name);

      // Host-routed chrome toggles (ruler, formatting marks).
      if (entry?.disposition === 'host-routed') {
        this.#runHostAction(name, argument);
        this.updateToolbarState();
        return;
      }

      // Custom buttons carry a function command; route through their registered
      // shared-context command so they get `insertText` / `execute` / `doc`.
      if (isToolbarCommandCallback(command)) {
        const id = `__builtin_toolbar__${name}`;
        if (this._customCommandRegs.has(id) && this.ui?.commands?.execute) {
          this.ui.commands.execute(id, { argument, option });
        } else {
          // Fallback for a command function that was never registered.
          const result = command({ item, argument, option, ui: this.ui, superdoc: this.superdoc });
          if (isThenable(result)) {
            void Promise.resolve(result).catch((error) => this.#emitCommandException(error, name));
          }
        }
        this.updateToolbarState();
        return;
      }

      // Custom buttons may point directly at a canonical V2 command id.
      if (item?.isCustomToolbarItem && typeof command === 'string') {
        const handled = executeCommand(this.ui, command, argument, {
          onSettled: () => this.updateToolbarState(),
          onError: (error) => this.#emitCommandException(error, name),
          reportUnhandled: true,
        });
        if (!handled) throw new Error(`[superdoc toolbar] Command not handled: ${String(command)}`);
        this.updateToolbarState();
        return;
      }

      // Controller-routed built-in commands (the common path).
      const handled = this.#executeControllerCommand(item, argument);
      if (!handled && command) {
        throw new Error(`[superdoc toolbar] Command not handled: ${String(command)}`);
      }
      this.updateToolbarState();
    } catch (originalError) {
      this.#emitCommandException(originalError, name);
    }
  }

  destroy() {
    this.#disarmFormatPainterListeners();
    this.#imagePicker?.destroy();
    this.#imagePicker = null;
    this.#destroyHostEvents();
    this.#destroyController();
    this.app?.unmount();
    this.app = null;
    this.toolbar = null;
  }
}

/**
 * Create the rendered built-in toolbar for a `SuperDoc` instance.
 */
export function createBuiltInToolbar(config: BuiltInToolbarOptions): BuiltInToolbar {
  return new BuiltInToolbar(config);
}
