// Public-contract type definitions for the `superdoc` package.
//
// This module is the canonical home for the shapes consumers see when they
// import from `superdoc` (Config, Modules, the surface and prompt configs,
// etc.). vite-plugin-dts emits these declarations into the published `.d.ts`
// graph, and the consumer-typecheck matrix asserts each export resolves to a
// real interface — not `any` and not missing.
//
// SD-2869 converted this file from JSDoc typedefs to TypeScript so the
// declarations are self-checked by the compiler. Keep the public surface
// stable: each exported name and shape mirrors the previous JSDoc; new fields
// or behavioral changes belong in a follow-up ticket.

import type { Doc as YDoc } from 'yjs';
import type { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Ref, ComputedRef } from 'vue';
import type { ContentControlType, HyperlinkTarget } from '@superdoc/document-api';

import type {
  DocumentFontOption,
  FontAssetUrlResolver,
  FontFamilyOption,
  FontLoadSummary,
  FontResolutionRecord,
} from '@superdoc/font-system';

export type {
  DocumentFontOption,
  FontAssetUrlContext,
  FontAssetUrlResolver,
  FontFaceSlot,
  FontFamilyOption,
  FontLoadResult,
  FontLoadStatus,
  FontLoadSummary,
  FontResolutionReason,
  FontResolutionRecord,
  GlyphException,
  ResolvedFontEvidence,
  SubstitutePolicyAction,
  SubstituteVerdict,
} from '@superdoc/font-system';

import type { SuperDoc as SuperDocClass } from '../SuperDoc.js';
import type { SuperDocActiveEditorExtensions, SuperDocExtension } from '../extensions/index.js';

export type SuperDoc = SuperDocClass;

// Defined in its own leaf module so `superdoc/ui`'s self-contained types can
// share the definition without importing the `SuperDoc` class type from here.
import type { BrowserDocumentApi } from '../../public/browser-document-api.js';
export type { BrowserDocumentApi } from '../../public/browser-document-api.js';

import type { CustomCommandContext, FontFamilyOption as ToolbarFontFamilyOption } from '../../public/ui/types.js';
export type { CommentsType, ExportParams, ExportType } from '../../public/export-types.js';

/**
 * A row in a custom dropdown's option list, and the value handed back to the
 * `command` callback when one is chosen.
 *
 * `label` and `key` are what the toolbar reads: `handleSelect` uses `label` as
 * the command argument (unless `dropdownValueKey` names another member) and
 * `key` as the selection identity (`ButtonGroup.vue:167-169`).
 *
 * Both are optional here rather than required, because a `type: 'render'`
 * entry is a custom-rendered row that the selection path explicitly skips
 * (`ButtonGroup.vue:268`), so it carries neither. The index signature keeps
 * the rest of the row open.
 *
 * @deprecated replaceWith=`ToolbarCustomOption` removeIn=v3.0
 */
export interface ToolbarDropdownOption {
  /** Row text, and the default command argument when the row is chosen. */
  label?: string;
  /**
   * Stable row identity, used for selection state and handed to the command.
   *
   * Numbers included, because the built-in zoom dropdown uses them
   * (`key: 0.5`, `key: 1`) and the runtime passes the value through
   * unchanged. This is what a `command` callback reads as `context.option`,
   * so a string-only declaration here made a numeric key unusable at the far
   * end even once the config side accepted it.
   */
  key?: string | number;
  /** Attributes spread onto the rendered row. */
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The context a custom toolbar button's `command` callback receives.
 *
 * The runtime registers the callback as a custom command and invokes it with
 * the controller's {@link CustomCommandContext} plus three toolbar-specific
 * members (`built-in-toolbar.js:#prepareCustomButton`), so a consumer writing
 * `({ execute, option }) => ...` gets both halves typed.
 *
 * `item` is deliberately `unknown`. It is the live Vue reactive object
 * `useToolbarItem` returns — a bag of `ref`s whose shape is an implementation
 * detail. Typing it would publish that internal and freeze it; see #1098 for
 * the public toolbar-item contract that would replace it.
 *
 * @deprecated replaceWith=`ToolbarCustomItemSelectContext` removeIn=v3.0
 */
export interface ToolbarCustomButtonContext extends CustomCommandContext {
  /** The live toolbar item handle. Internal shape; see #1098. */
  item: unknown;
  /**
   * The selected dropdown row, passed through verbatim, or `undefined` for a
   * plain button that has no selection.
   */
  option?: ToolbarDropdownOption;
  /** Argument threaded through the command payload. */
  argument?: unknown;
}

/**
 * What a custom toolbar entry does when activated.
 *
 * A function is registered as a custom command and invoked with
 * {@link ToolbarCustomButtonContext}; a string is read as a canonical V2
 * command id and routed through the shared controller. An unknown id is
 * accepted at compile time and then reported through the toolbar's
 * `exception` event as "Command not handled" -- so the string form stays
 * unnarrowed, but a typo is diagnosed at runtime rather than ignored.
 *
 * @deprecated replaceWith=`ToolbarCommandId|ToolbarCustomItemSelectHandler` removeIn=v3.0
 */
export type ToolbarCustomButtonCommand = string | ((context: ToolbarCustomButtonContext) => unknown);

/** Members every custom toolbar entry carries, whatever its type. */
interface ToolbarCustomEntryBase {
  /**
   * Unique item name, which also derives the registered command id and the
   * rendered `data-item` attribute.
   *
   * Uniqueness is enforced at construction rather than here: a name that
   * repeats, or that matches a built-in item, used to render a second control
   * under the same `data-item` with neither responding.
   */
  name: string;
  /** Which toolbar group the entry joins. Defaults to `center`. */
  group?: 'left' | 'center' | 'right' | (string & {});
  /** Hover text. */
  tooltip?: string;
  /** Render the entry as unavailable. Honored: a disabled entry does not run. */
  disabled?: boolean;
  /** Extra DOM hooks. Both are read straight onto the rendered control. */
  attributes?: {
    /**
     * Appended to the item's class list. Any value Vue's `class` binding
     * takes: a string, an array, a condition map, or a nesting of those.
     *
     * AIDEV-NOTE: unconstrained for the same reason as `dropdownStyles`, and
     * verified rather than assumed. This lands inside an array binding --
     * `ToolbarButton` renders `:class="['sd-toolbar-item',
     * attributes.className]"` -- so Vue resolves it, and `string` rejected
     * `['compact', { active: isActive }]`, the ordinary way to write a
     * conditional class. There is also nothing to import or mirror:
     * `@vue/shared` types the input as `normalizeClass(value: unknown)`, so
     * Vue does not name this shape either, and any union written here would
     * be narrower than what Vue accepts. A browser test asserts the array and
     * the condition map both resolve, including that a false branch is
     * dropped rather than stringified.
     */
    className?: unknown;
    /** Sets `aria-label`, which is otherwise absent on a custom entry. */
    ariaLabel?: string;
  };
  /** Render the control at reduced width. */
  isNarrow?: boolean;
  /** Render the control at increased width. */
  isWide?: boolean;
  /**
   * `active` and `activeIcon` are rejected by name because both are dead.
   * `useToolbarItem` hard-codes the initial active state to `false` and
   * discards the option, and nothing in the toolbar reads `activeIcon`. Set
   * the state from the command instead, which does work.
   */
  active?: never;
  activeIcon?: never;
  /**
   * Open on purpose. `useToolbarItem` accepts 37 fields and forwards them, and
   * closing this list around the ones I could enumerate rejected seven working
   * configurations in review -- `label`, `hasCaret`, `dropdownValueKey`, row
   * `icon`, `attributes`, `splitButton`, `argument` -- each of which renders or
   * is forwarded by code the enumeration missed.
   *
   * So the guarantees here are structural rather than exhaustive: which `type`
   * values render at all, that a button and a dropdown each have something
   * visible, that a dropdown has rows, and that the two dead fields above are
   * refused. A misspelled rare field still compiles, which is the same
   * trade-off `CommentsConfig` makes for the same reason -- the runtime passes
   * the whole bag through, so a closed type would be wrong more often than a
   * typo is.
   */
  [key: string]: unknown;
}

/**
 * A custom button.
 *
 * `icon` is required, which is stricter than the runtime check and deliberately
 * so. Construction accepts `icon` **or** `defaultLabel`, but only the icon
 * reaches the DOM: a button carrying `defaultLabel` alone builds, mounts, and
 * draws nothing, leaving an empty control in the toolbar. Requiring `icon`
 * keeps this type to shapes that produce something a user can see.
 *
 * `label` is not accepted at all. It is the *live* label a built-in item
 * rewrites as state changes, it does not satisfy the affordance check, and a
 * button carrying only `label` is rejected at construction.
 *
 * AIDEV-NOTE: `defaultLabel` renders nothing for a custom button. The check in
 * `use-toolbar-item.js` treats it as an affordance and `ToolbarButton.vue`
 * never draws it. Widening this type to accept `defaultLabel` alone requires
 * fixing that render first, or it re-admits invisible buttons (#1098).
 *
 * @deprecated replaceWith=`ToolbarCustomButtonConfig` removeIn=v3.0
 */
export interface ToolbarCustomButtonItem extends ToolbarCustomEntryBase {
  type: 'button';
  /** Inline SVG or markup. The only thing a custom button actually renders. */
  icon: string;
  /**
   * Static label kept for the affordance check and for parity with the legacy
   * spelling. It does not render today; pair it with `icon`, never alone.
   */
  defaultLabel?: string;
  /**
   * Visible text drawn beside the icon. Unlike `defaultLabel` this really is
   * rendered, but it does not satisfy the affordance check on its own, so it
   * accompanies `icon` rather than replacing it.
   */
  label?: string;
  /**
   * What the button does. Optional because omitting it renders a control that
   * does nothing rather than failing, which is legal today; an entry meant to
   * be actionable should always carry one.
   */
  command?: ToolbarCustomButtonCommand;
}

/**
 * One selectable row in a custom dropdown.
 *
 * Both members are required: `key` is what reaches the command through
 * {@link ToolbarCustomButtonContext.option}, and `label` is the only text the
 * row renders, so a row missing either draws blank or selects as `undefined`.
 */
interface ToolbarCustomDropdownOptionBase {
  /**
   * Drawn beside the row's label, or a function returning it.
   *
   * Not string-only: `OptionIcon` returns whatever this resolves to straight
   * from a render function, so a Vue VNode works as well as markup.
   *
   * `object` rather than `Record<string, unknown>`, which was the first
   * attempt and admitted only inferred object literals -- a value already
   * typed as Vue's `VNode` has no string index signature and so failed to
   * assign. `object` accepts both without importing Vue's types into the
   * public surface.
   */
  icon?: string | object | ((option: ToolbarCustomDropdownOption) => unknown);
  /** Render the row as unavailable. */
  disabled?: boolean;
  /** Added to the row's class list. */
  class?: unknown;
  /**
   * Spread onto the rendered row as attributes, and its `class` is merged
   * with the one above. Declared here as well as on `ToolbarDropdownOption`,
   * which it mirrors.
   */
  props?: Record<string, unknown>;
  /**
   * Open, like the `ToolbarDropdownOption` it mirrors, because
   * `dropdownValueKey` names a member to read dynamically: a row can carry
   * `{ label, key, value }` and send `value` to the command. Closing this
   * would make that shape uncompilable while it still works.
   */
  [key: string]: unknown;
}

/**
 * One row in a custom dropdown.
 *
 * A selectable row needs both `label` and `key`: `label` is the only text it
 * renders, and `key` is what reaches the command through
 * {@link ToolbarCustomButtonContext.option}.
 *
 * A `type: 'render'` row is the exception and is why this is a union rather
 * than one interface. `ToolbarDropdown` routes those to its `RenderOption`
 * branch and never reads `label` for them, so requiring it would reject rows
 * the runtime supports -- which the first version of this type did.
 *
 * @deprecated replaceWith=`ToolbarCustomOption` removeIn=v3.0
 */
export type ToolbarCustomDropdownOption =
  | (ToolbarCustomDropdownOptionBase & {
      /**
       * Application metadata. A row carrying `{ type: 'action', label, key }`
       * stays selectable and reaches the command verbatim, so this member is
       * open.
       *
       * AIDEV-NOTE: that openness means `{ type: 'render', label, key }` with
       * no renderer still matches this branch, so the render branch's
       * required `render` does not catch it (#1098). `Exclude<string,
       * 'render'>` does not help -- subtracting a literal from the wide
       * `string` type leaves `string` -- and neither does a branded
       * intersection, because a plain string literal remains assignable to
       * both. Closing this needs a literal union of the metadata values the
       * product supports, which is a contract decision rather than a
       * transcription. The runtime treats such a row as render-only and draws
       * a blank, inert row.
       */
      type?: string;
      /** Text rendered for the row. */
      label: string;
      /**
       * Value handed to the command when this row is chosen, and the row's
       * Vue key. Numbers are allowed because the built-in zoom dropdown uses
       * them (`key: 0.5`, `key: 1`), and `ButtonGroup` passes the value
       * through to `selectedValue` unchanged.
       */
      key: string | number;
    })
  | (ToolbarCustomDropdownOptionBase & {
      /** Rendered through `RenderOption` rather than as a selectable row. */
      type: 'render';
      /**
       * Required, because `RenderOption` returns `null` unless this is
       * callable. A render row is also excluded from selection, so one
       * without a renderer is a permanently blank row that cannot be clicked.
       */
      render: () => unknown;
      label?: string;
      key?: string | number;
    });

/**
 * A custom dropdown.
 *
 * `options` is required and must be non-empty: a dropdown with no rows, or an
 * empty array, renders no trigger at all, so the entry silently disappears
 * rather than drawing something inert.
 *
 * The trigger rule is looser than a button's -- `label` works here as well as
 * `icon` -- because the dropdown draws its own trigger rather than going
 * through the button affordance check.
 */
interface ToolbarCustomDropdownBase extends ToolbarCustomEntryBase {
  type: 'dropdown';
  /**
   * Static fallback trigger text. Present for parity with the legacy spelling
   * and does not render, which is why it does not satisfy the trigger
   * requirement below.
   */
  defaultLabel?: string;
  /**
   * The rows the dropdown offers. Empty is accepted, and is not a mistake on
   * its own: `#updateHighlightColors` assigns `nestedOptions` after the item
   * is built, so a dropdown can construct empty and fill in later. An empty
   * one renders no menu rather than breaking -- `ButtonGroup` guards the
   * branch on `nestedOptions.value.length`.
   *
   * AIDEV-NOTE: this was a nonempty tuple until #1188 review. The tuple did
   * reject `options: []`, and it also rejected every array TypeScript cannot
   * see the length of -- `rows.map(...)`, a `Row[]` variable, a function
   * return. Those are how dropdown rows are normally built; `lineHeight` in
   * `default-items.js` builds its own rows with `.map()`. The obvious escape,
   * `readonly T[] & { 0: T }`, rejects all four (measured, not assumed): an
   * array type carries no index-0 property for the intersection to satisfy.
   * So please do not reintroduce a tuple here -- and note there is no runtime
   * check to fall back on either, deliberately, because an empty dropdown is
   * a legitimate intermediate state.
   *
   * `readonly` so an `as const` array is accepted: the runtime only iterates
   * this and copies the elements into `nestedOptions`, never mutating the
   * consumer's array.
   */
  options: readonly ToolbarCustomDropdownOption[];
  /** Draw the dropdown caret beside the trigger. Rendered by `ToolbarButton`. */
  hasCaret?: boolean;
  /**
   * Which member of the selected row becomes the command's `argument`.
   *
   * Defaults to `label`, not `key`: `ButtonGroup.handleSelect` reads
   * `option[dropdownValueKey]` and falls back to `option.label` when this is
   * unset. So a dropdown whose display text differs from its value has to set
   * `'key'` explicitly, or the command receives the text a user sees rather
   * than the value it stands for. Any member name works, not just `key`: a row
   * carrying `{ label, key, value }` can send `value`. `context.option` always
   * carries the whole row either way.
   */
  dropdownValueKey?: string;
  /**
   * Inline styles for the dropdown's own element -- its trigger and wrapper --
   * forwarded unchanged to Vue's `:style` binding.
   *
   * Not the open panel: `ButtonGroup` styles that separately through
   * `menu-props`, which `customButtons` cannot reach. Widths set here size the
   * control in the toolbar, not the menu it opens.
   *
   * AIDEV-NOTE: deliberately unconstrained. Restating Vue's `StyleValue` here
   * was attempted three times and was wrong each time -- string-valued
   * objects rejected `{ padding: 0 }`, object-only rejected
   * `'min-width: 200px'`, and a hand-written union rejected a value already
   * typed as `CSSProperties`, whose index signature a structural restatement
   * does not match. The shape set is Vue's to define and moves with Vue, so
   * mirroring it by hand keeps rejecting working configuration. Importing
   * `StyleValue` would pull a Vue type into the public surface, which this
   * package avoids elsewhere.
   */
  dropdownStyles?: unknown;
  /**
   * `key` of the row to show as selected before the user picks one. Matches
   * the row `key` type, numbers included.
   */
  selectedValue?: string | number;
  /** Invoked with the chosen row on {@link ToolbarCustomButtonContext.option}. */
  command?: ToolbarCustomButtonCommand;
}

/**
 * A dropdown needs a trigger a user can see, and it has three ways to draw
 * one. `ToolbarButton` renders `icon` and `label` in its non-split branch and,
 * beside them, `.sd-dropdown-caret` on `v-if="hasCaret"` alone -- so a compact
 * caret-only dropdown is a real control, not an oversight. It renders with a
 * measurable width and opens its rows; only `defaultLabel` draws nothing.
 *
 * Splitting the variant is what makes at-least-one enforceable rather than
 * advisory. Pair a caret-only trigger with `attributes.ariaLabel`, since
 * there is no text for a screen reader to announce.
 *
 * @deprecated replaceWith=`ToolbarCustomDropdownConfig` removeIn=v3.0
 */
export type ToolbarCustomDropdownItem =
  | (ToolbarCustomDropdownBase & { icon: string; label?: string; hasCaret?: boolean })
  | (ToolbarCustomDropdownBase & { label: string; icon?: string; hasCaret?: boolean })
  | (ToolbarCustomDropdownBase & { hasCaret: true; icon?: string; label?: string });

/**
 * A visual divider. Renders on its own and has nothing to run.
 * @deprecated replaceWith=`ToolbarCustomSeparatorConfig` removeIn=v3.0
 */
export interface ToolbarCustomSeparatorItem extends ToolbarCustomEntryBase {
  type: 'separator';
}

/**
 * A custom entry appended to the built-in toolbar's default item set.
 *
 * What this guarantees is structural, not exhaustive. Each variant fixes the
 * shape of the entry -- which `type` values render at all, that a button and a
 * dropdown each carry something visible, that a dropdown has rows -- while the
 * field list itself stays open, because `useToolbarItem` accepts 37 fields and
 * forwards them. Closing that list rejected eight working configurations
 * during review, and a rejected working config is a worse failure than the
 * autocomplete it buys.
 *
 * Two of the five `useToolbarItem` types are absent because they render
 * nothing: `options` constructs without throwing and `ButtonGroup` has no
 * branch for it, and `overflow` draws only from the separately-built overflow
 * list, which `customButtons` cannot populate.
 *
 * Two fields are refused by name on {@link ToolbarCustomEntryBase} for the
 * same reason: `active` is discarded (`useToolbarItem` hard-codes the initial
 * state to `false`) and `activeIcon` has no toolbar reader at all.
 *
 * Derived from a rendered-behavior survey rather than from the constructor
 * (#1098): construction succeeding proves only that nothing threw, which for
 * this surface was never the same question as whether a control appeared.
 *
 * @deprecated replaceWith=`ToolbarCustomItem` removeIn=v3.0
 */
export type ToolbarCustomButton = ToolbarCustomButtonItem | ToolbarCustomDropdownItem | ToolbarCustomSeparatorItem;

export type V2AuthoringSelectionCollapse = 'start' | 'end' | null;

export type V2AuthoringResult =
  | { ok: true; mode?: 'collapsed' | 'range'; [key: string]: unknown }
  | { ok: false; reason: string; detail?: string };

/**
 * Narrow v2 browser-authoring bridge for shell/proof setup code. This surface
 * does not expose v1 ProseMirror `view` / `state` / `commands`; it resolves
 * public Document API selection targets and asks the v2 host to apply them to
 * the live editable selection.
 */
export interface V2AuthoringFacade {
  setSelectionByText(input: {
    text: string;
    occurrence?: number;
    collapse?: V2AuthoringSelectionCollapse;
    focus?: boolean;
  }): Promise<V2AuthoringResult>;
  setSelectionTarget(input: {
    target: unknown;
    collapse?: V2AuthoringSelectionCollapse;
    focus?: boolean;
  }): Promise<V2AuthoringResult>;
  focusEditable(): unknown;
  readBlocks?(input?: Record<string, unknown>): unknown;
  replaceTextByText?(input: {
    findText: string;
    replacement: string;
    occurrence?: number;
    mode?: 'direct' | 'tracked';
  }): Promise<V2AuthoringResult>;
  replaceSelection?(input: {
    target: unknown;
    replacement?: string;
    mode?: 'direct' | 'tracked';
  }): Promise<V2AuthoringResult>;
  serializeSelectionToClipboard?(input?: { includeHtml?: boolean }): Promise<V2AuthoringResult>;
  pasteClipboardPayload?(input: {
    payload: unknown;
    target?: unknown;
    mode?: 'direct' | 'tracked';
    fallback?: unknown;
  }): Promise<V2AuthoringResult>;
  pastePlainText?(input: { text: string; target?: unknown; mode?: 'direct' | 'tracked' }): Promise<V2AuthoringResult>;
}

/**
 * The current user of this superdoc.
 *
 * Every field is optional on input. `SuperDoc.#init` normalizes a
 * missing or partial `user` by spreading `DEFAULT_USER` over consumer
 * input, so `name` and `email` always have a value at runtime even
 * when the consumer omits them.
 *
 * `User` does NOT carry the collab-awareness `color` field; that is on
 * the internal `AwarenessUser` (see below), assigned by SuperDoc's
 * `#assignUserColor()` after `#init`.
 */
export interface User {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  [key: string]: unknown;
}

/** V2-neutral active editor facade exposed by legacy shell methods. */
export interface EditorCommands {
  search?: (text: string | RegExp, options?: Record<string, unknown>) => SearchMatch[];
  goToSearchResult?: (match: SearchMatch) => unknown;
  [key: string]: unknown;
}

export interface Editor {
  editorVersion?: 2;
  options?: {
    documentId?: string;
    documentMode?: DocumentMode;
    [key: string]: unknown;
  };
  /**
   * The public, read-only-guarded browser Document API facade for the active
   * editor (`superdoc.activeEditor.doc`). It exposes the supported browser
   * Document API surface customers know (`doc.comments.*`,
   * `doc.trackChanges.*`, `doc.history.*`, `doc.selection.current`,
   * `doc.format.*`, `doc.query.*`, etc.), with read-only enforcement and
   * mutation finalization owned by the v2 host facade. In browser mode this
   * surface is async-capable and operations may return promises; SDK/headless
   * document automation stays synchronous on its own surface.
   */
  doc?: BrowserDocumentApi | null;
  authoring?: V2AuthoringFacade | null;
  /**
   * Command bag exposed by v1 editors (`null` on v2-shaped runtimes). Only the
   * commands the shell dispatches directly are typed; everything else stays
   * behind the index signature.
   */
  commands?: EditorCommands | null;
  state?: unknown;
  view?: unknown;
  exportDocx?: (options?: Record<string, unknown>) => Promise<Blob | File | null | undefined>;
  focus?: (options?: { preventScroll?: boolean; restoreSelection?: boolean }) => unknown;
  setOptions?: (options: Record<string, unknown>) => unknown;
  setDocumentMode?: (mode: DocumentMode) => unknown;
  setHighContrastMode?: (isHighContrast: boolean) => unknown;
  on?: (...args: unknown[]) => unknown;
  off?: (...args: unknown[]) => unknown;
  getHTML: (options?: Record<string, unknown>) => unknown;
  getDocumentId?: () => string | null | undefined;
  /**
   * Narrow v2 extension facet for command execution and diagnostics, backed by
   * the active document's extension manager. Present only when one or more
   * `extensions` are registered on the active document; `null`/absent
   * otherwise. Does not expose the raw private extension manager. See
   * {@link SuperDocActiveEditorExtensions}.
   */
  extensions?: SuperDocActiveEditorExtensions | null;
  [key: string]: unknown;
}

/**
 * Presentation-editor capability bag retained for shell compatibility. The
 * methods the shell dispatches to are typed; capabilities stay optional because
 * JS composables assemble this bag incrementally.
 */
export interface DocumentRendererRuntime {
  getLastFontsChangedPayload?: () => FontsChangedPayload | null;
  navigateTo?: (target: NavigableAddress) => unknown;
  scrollToElement?: (elementId: string) => unknown;
  setContextMenuDisabled?: (disabled: boolean) => unknown;
  setShowBookmarks?: (show: boolean) => unknown;
  setShowFormattingMarks?: (show: boolean) => unknown;
  setDocumentMode?: (mode: DocumentMode) => unknown;
  setTrackedChangesOverrides?: (preferences?: {
    mode?: 'review' | 'original' | 'final' | 'off';
    enabled?: boolean;
  }) => unknown;
  setViewingCommentOptions?: (options: Record<string, unknown>) => unknown;
  [key: string]: unknown;
}

export type StoryLocator = string | Record<string, unknown>;
export type BookmarkAddress = string | Record<string, unknown>;
export type BlockNavigationAddress = string | Record<string, unknown>;
export type CommentAddress = string | Record<string, unknown>;
export type TrackedChangeAddress = string | Record<string, unknown>;
export type NavigableAddress =
  | StoryLocator
  | BookmarkAddress
  | BlockNavigationAddress
  | CommentAddress
  | TrackedChangeAddress;

export interface CollaborationProvider {
  awareness?: unknown;
  document?: unknown;
  synced?: boolean;
  isSynced?: boolean;
  on?: (...args: unknown[]) => unknown;
  off?: (...args: unknown[]) => unknown;
  disconnect?: () => unknown;
  destroy?: () => unknown;
  /** Send a provider-specific stateless string payload. */
  sendStateless?: (message: string) => unknown;
  [key: string]: unknown;
}

/**
 * Connection settings for one shared document, used at startup and during an upgrade.
 *
 * This is the public surface for SuperDoc v2's shipped real-time collaboration
 * model. v2 collaboration is always single-doc: one `Y.Doc`, one provider
 * session, and one awareness channel bound to one document/root identity. Set
 * it on a `Document` entry to make that document collaborative under the v2
 * runtime; SuperDoc forwards it into the v2 browser shell, which constructs the
 * single-doc provider internally. One `documentId` maps to exactly one
 * room/provider/root identity.
 *
 * SuperDoc v2 includes y-websocket, Hocuspocus, and Liveblocks adapters and can
 * route a named provider extension through a configured collaboration Worker.
 * The provider is selected with `providerType`; omitting it preserves the
 * original y-websocket-only shape (`{ documentId, serverUrl, params? }`).
 *
 * This is intentionally distinct from the legacy provider-agnostic
 * {@link CollaborationConfig} (`Config.modules.collaboration`): v2 owns the
 * Y.Doc. Provider extensions receive that document inside the collaboration
 * Worker instead of replacing it.
 */
export type DocumentCollaborationConfig =
  | V2YWebsocketCollaborationConfig
  | V2HocuspocusCollaborationConfig
  | V2LiveblocksCollaborationConfig
  | V2ProviderExtensionCollaborationConfig;

/** @deprecated replaceWith=`DocumentCollaborationConfig` compat-indefinitely: existing v2 integrations import this type. */
export type V2CollaborationConfig = DocumentCollaborationConfig;

/**
 * y-websocket single-doc provider config.
 *
 * `providerType` is optional: omitting it (the `{ documentId, serverUrl }`
 * shape) is the backward-compatible default and resolves to y-websocket.
 */
export interface V2YWebsocketCollaborationConfig {
  /** Provider family selector. Optional; defaults to `'y-websocket'`. */
  providerType?: 'y-websocket';
  /**
   * Stable shared document identity. Both actors that pass the same
   * `documentId` join the same room and converge on the same root Y.Doc.
   */
  documentId: string;
  /** WebSocket server URL for the single-doc y-websocket provider. */
  serverUrl?: string;
  /** Alias for {@link serverUrl}; `url` wins when both are present. */
  url?: string;
  /**
   * Optional connection query params forwarded to the provider (for example
   * an auth token). Values are strings.
   */
  params?: Record<string, string> | null;
  /** Explicit room operation. Defaults to `'join'`; `'create'` never joins an existing room. */
  roomMode?: 'join' | 'create';
}

/** Hocuspocus single-doc provider config. */
export interface V2HocuspocusCollaborationConfig {
  providerType: 'hocuspocus';
  /** Stable shared document identity (used as the v2 root/room identity). */
  documentId: string;
  /** Hocuspocus backend websocket URL. */
  serverUrl?: string;
  /** Alias for {@link serverUrl}; `url` wins when both are present. */
  url?: string;
  /** Optional connection params forwarded to the backend. */
  params?: Record<string, string> | null;
  /** Static auth token or resolver invoked for every Hocuspocus connection. */
  token?: string | (() => string | Promise<string>);
  /** Explicit room operation. Defaults to `'join'`; `'create'` never joins an existing room. */
  roomMode?: 'join' | 'create';
}

/**
 * Liveblocks single-doc provider config.
 *
 * Exactly one auth mode is supported: `publicApiKey` (anonymous) or
 * `authEndpoint` (server-side token issuance).
 */
export interface V2LiveblocksCollaborationConfig {
  providerType: 'liveblocks';
  /** Stable shared document/room identity. */
  documentId?: string;
  /** Alias for {@link documentId} (Liveblocks room naming). */
  roomId?: string;
  /** Liveblocks public API key (anonymous auth) — mutually exclusive with {@link authEndpoint}. */
  publicApiKey?: string;
  /**
   * Liveblocks auth endpoint URL (server-side token) — mutually exclusive with
   * {@link publicApiKey}. Browser-relative URLs resolve against the current
   * page; non-browser SDK/CLI callers must use an absolute HTTP(S) URL.
   */
  authEndpoint?: string;
  /** Explicit room operation. Defaults to `'join'`; `'create'` never joins an existing room. */
  roomMode?: 'join' | 'create';
}

/** Named provider adapter implemented by the configured collaboration Worker. */
export interface V2ProviderExtensionCollaborationConfig {
  providerType: 'extension';
  /** Adapter registration key understood by the collaboration Worker. */
  adapterId: string;
  /** Stable shared document identity. */
  documentId: string;
  /** Structured-clone-safe options passed to the registered adapter factory. */
  providerOptions?: unknown;
  /** Optional host-owned credential resolver available to the adapter. */
  token?: string | (() => string | Promise<string>);
  /** Explicit room operation. Defaults to `'join'`; `'create'` never joins an existing room. */
  roomMode?: 'join' | 'create';
}

export interface Comment {
  id?: string;
  commentId?: string;
  text?: string;
  resolved?: boolean;
  [key: string]: unknown;
}

export interface FontFaceConfig {
  source?: string;
  url?: string;
  weight?: string | number;
  style?: string;
  display?: string;
  [key: string]: unknown;
}

export interface FontFamilyConfig {
  family: string;
  faces?: FontFaceConfig[];
  [key: string]: unknown;
}

export type FontConfig = FontFamilyConfig;

/**
 * One row in the toolbar's font-family dropdown.
 *
 * Distinct from {@link FontFamilyConfig}, which describes a family to load and
 * measure. This describes a row to render.
 *
 * `label` and `key` are both required because the toolbar has no fallback for
 * either. `label` is the value applied to the selection
 * (`emitFontCommand(option.label)`) and what active-state matching compares
 * against (`fontOptions.find((i) => i.label === fontFamily)`); `key` is the
 * selection identity and the rendered list key. An entry missing either one
 * produces a blank row or an undefined command value rather than a
 * degraded-but-working option.
 *
 * @deprecated replaceWith=`FontFamilyOption` removeIn=v3.0
 */
export interface ToolbarFontOption {
  /**
   * Logical family name. Rendered as the row's text, written to the selection
   * when chosen, and compared against the current font for active state.
   */
  label: string;
  /** Stable option identity, used for selection state and the list key. */
  key: string;
  /**
   * Attributes spread onto the rendered row, which is the only channel that
   * reaches it: both renderers bind `option.props` and nothing else
   * (`ToolbarComboBox.vue:559`, `ToolbarDropdown.vue:420`).
   *
   * `props.style.fontFamily` is the preview stack the row is drawn in;
   * `normalizeFontOption` falls back to `label` then `key` when it is absent,
   * so a row always previews in something. Weight and any other per-row style
   * go here too — `props: { style: { fontWeight: 700 } }` renders, a top-level
   * `fontWeight` does not.
   */
  props?: {
    style?: { fontFamily?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
}

export interface FontsConfig {
  bundled?: boolean | 'baseline' | 'full' | string[] | Record<string, unknown>;
  families?: FontFamilyConfig[];
  /**
   * Logical DOCX family to registered physical family. The mapping changes
   * measurement and rendering for this document; export preserves the logical name.
   */
  map?: Record<string, string>;
  /**
   * Base URL the bundled substitute pack (and curated faces) are fetched from, e.g. `'/fonts/'`.
   * Canonical self-hosting field. When no pack is configured, SuperDoc fetches no substitute-pack
   * assets; the built-in core-symbol face is still requested for the symbol glyphs it covers, so it
   * does not remove the need for a font allowance in your Content Security Policy.
   */
  assetBaseUrl?: string;
  /**
   * Resolver for per-asset URLs (signed / versioned / CDN), called for each bundled face filename.
   * Takes precedence over {@link assetBaseUrl} when present.
   */
  resolveAssetUrl?: FontAssetUrlResolver;
  /** @deprecated Use {@link assetBaseUrl} (string) or {@link resolveAssetUrl} (function) instead. */
  assetUrl?: string | FontAssetUrlResolver;
  [key: string]: unknown;
}

/** Reason a font report changed. */
export type FontsChangedSource = 'initial' | 'diagnostic-settle' | 'config-change' | 'late-load' | 'render-change';

/** Font report passed to the deprecated `Config.onFontsResolved` callback. */
export interface FontsResolvedPayload {
  source?: FontsChangedSource;
  loadSummary?: FontLoadSummary | null;
  report?: FontResolutionRecord[];
  missingFonts?: string[];
  documentFonts?: string[];
  documentFontOptions?: DocumentFontOption[];
  [key: string]: unknown;
}

/** Current font report passed to `Config.onFontsChanged` and `fonts-changed`. */
export interface FontsChangedPayload extends FontsResolvedPayload {}

export interface ListDefinitionsPayload {
  [key: string]: unknown;
}

export type ProofingIssueKind = 'spelling' | 'grammar' | 'style';

export interface ProofingCapabilities {
  issueKinds: ProofingIssueKind[];
  supportsSuggestions?: boolean;
  supportsMultipleLanguages?: boolean;
  supportsBatching?: boolean;
  requiresNetwork?: boolean;
}

export interface ProofingSegmentMetadata {
  blockId?: string;
  pageIndex?: number;
  surface: 'body' | 'header' | 'footer' | 'table-cell' | 'other';
}

export interface ProofingSegment {
  id: string;
  text: string;
  language?: string | null;
  metadata: ProofingSegmentMetadata;
}

export interface ProofingCheckRequest {
  documentId?: string | null;
  defaultLanguage?: string | null;
  maxSuggestions?: number;
  segments: ProofingSegment[];
  signal?: AbortSignal;
}

export interface ProofingIssue {
  segmentId: string;
  /** Zero-based start offset into the segment text (UTF-16 code units). */
  start: number;
  /** Zero-based end offset into the segment text (UTF-16 code units, exclusive). */
  end: number;
  kind: ProofingIssueKind;
  message?: string;
  replacements?: string[];
  ruleId?: string;
  providerMeta?: Record<string, unknown>;
}

export interface ProofingCheckResult {
  issues: ProofingIssue[];
}

/**
 * Provider-agnostic proofing engine. SuperDoc owns segment extraction,
 * scheduling, and rendering; providers only inspect text and return ranges.
 */
export interface ProofingProvider {
  id: string;
  getCapabilities?: () => Promise<ProofingCapabilities> | ProofingCapabilities;
  check: (request: ProofingCheckRequest) => Promise<ProofingCheckResult>;
  dispose?: () => Promise<void> | void;
}

export interface SelectionInfo {
  [key: string]: unknown;
}

/**
 * Font surface on a SuperDoc instance (`superdoc.fonts`). The substitution- and load-aware
 * answer to "what fonts does this document use and did SuperDoc render them faithfully" -
 * pulled on demand and streamed via the `fonts-changed` event - plus a per-document write
 * surface: {@link map}/{@link unmap} override resolution, {@link add} registers custom faces,
 * {@link preload} loads them. All reflect the ACTIVE editor: reads return empty arrays when no
 * editor is active; writes throw. {@link getReport} and {@link getDocumentFonts} cover the
 * document's DECLARED fonts (font table + theme + defaults), not only fonts visible on screen.
 */
/** Public SuperDoc alias for the canonical font face config. */
export type SuperDocFontFace = FontFaceConfig;

/** Public SuperDoc alias for the canonical font family config. */
export type SuperDocFontFamily = FontFamilyConfig;

export interface SuperDocFontsApi {
  /** Per-font report: requested logical family -> physical render family, reason, load status, export family, missing. */
  getReport(): FontResolutionRecord[];
  /** Declared families with no faithful render font loaded (the substitution-aware truth). */
  getMissingFonts(): string[];
  /** The document's declared logical font families, deduped. */
  getDocumentFonts(): string[];
  /**
   * The document's own fonts as toolbar options: one per logical family the document renders, each with
   * a preview family. Document fonts only - compose with the defaults.
   */
  getDocumentFontOptions(): DocumentFontOption[];
  /**
   * The complete font-family picker list for the active document: the bundled offerings gated on its
   * font activation (baseline when no pack is configured, the curated rich set when it is, honoring
   * include/exclude) unioned with the document's own fonts, sorted alphabetically. Drives the built-in
   * toolbar font dropdown; ready to use, not just document fonts.
   */
  getFontFamilyOptions(): FontFamilyOption[];
  /**
   * Observe the font report: replays the current report immediately if one has already
   * resolved, then invokes `callback` on every future change. Use this rather than
   * `on('fonts-changed')` when you may subscribe after the report resolved. Note: right after
   * a document swap, if the new active editor has not produced a report yet, nothing is
   * delivered until it does (no stale prior-document report). Returns an unsubscribe function.
   */
  onReport(callback: (payload: FontsChangedPayload) => void): () => void;
  /**
   * Map logical families to physical render families for the ACTIVE document, overriding bundled
   * defaults: `map({ Georgia: 'Gelasio', Arial: 'Liberation Sans' })`. Applies all entries, then
   * re-measures and repaints once (a redundant map - a self-map, or a mapping identical to an
   * already-stored override - does neither); observe via {@link onReport} / `fonts-changed` (`source:
   * 'config-change'`). Mapping a family to its bundled clone (`map({ Calibri: 'Carlito' })`) is honored
   * as an explicit PIN - stored so it outranks a registered real face for that family - not treated as
   * a no-op. Each physical family must be loadable - a bundled substitute, or a face added via `add`.
   * Per document: other editors on the page are unaffected. Render-only - export keeps the logical
   * family name.
   * @throws TypeError if called without a mapping object.
   * @throws Error if no editor is active (a write needs a document; this fails loudly, not silently).
   */
  map(mappings: Record<string, string>): void;
  /**
   * Remove runtime mappings for the ACTIVE document; each family reverts to its bundled default
   * (or its logical name). Accepts one family or several. Re-measures and repaints if anything
   * changed.
   * @throws Error if no editor is active.
   */
  unmap(families: string | string[]): void;
  /**
   * Register custom physical font faces (URL sources) for the ACTIVE document so they can be mapped
   * to and loaded - e.g.
   * `add({ family: 'Gelasio', faces: [{ source: '/fonts/Gelasio-Regular.woff2', weight: 400 }] })`.
   * Registering does NOT map; pair with {@link map}. Re-adding the same source for a face is
   * idempotent; a DIFFERENT source for the same family/weight/style throws. Reflows once if a
   * registered face is one the document already uses.
   * @throws Error if no editor is active, or if a conflicting source is registered.
   */
  add(families: SuperDocFontFamily | SuperDocFontFamily[]): void;
  /**
   * Proactively load the physical faces for the given LOGICAL families (resolved through the active
   * document's mappings) so they are ready before use, avoiding a late-load reflow. Awaits the
   * regular (400/normal) face via the registry.
   * @throws Error if no editor is active.
   */
  preload(families: string[]): Promise<void>;
}

/**
 * Internal post-`#init` shape of the active user. Extends the public
 * `User` with the collab-awareness `color` field assigned by
 * `SuperDoc.#assignUserColor()` and read by the presence system. Not
 * part of the consumer-facing surface; consumers continue to pass
 * `User` via `Config.user`, and SuperDoc widens to `AwarenessUser`
 * internally once it has computed the color.
 */
export interface AwarenessUser extends User {
  /**
   * Awareness color for collaborative cursors. Auto-assigned from the
   * configured palette (or a default palette) by `#assignUserColor`,
   * derived from a hash of the user's identity so the assignment is
   * stable across reloads.
   */
  color?: string;
}

/**
 * One entry in the `states` array delivered to
 * {@link Config.onAwarenessUpdate}. In V2, `states` includes the current
 * user and remote participants. Do not append the current user again.
 *
 * Display fields such as `name`, `email`, and `color` are at the top
 * level, not nested under `user`. Fields may be absent; a presence
 * entry is not an authenticated account record.
 *
 * Application-specific fields attached to the awareness state by the
 * provider surface through the `[key: string]: unknown` index
 * signature; consumers narrow before use.
 */
export interface AwarenessState extends User {
  /** Presence identifier. In V2, scoped to this editor instance, not a Yjs transport id. */
  clientId?: number;
  /** Resolved cursor color supplied by the presence system. */
  color?: string;
  /** Application-specific fields spread from the awareness provider. */
  [key: string]: unknown;
}

/** File-like objects exposed by common browser upload components. */
export type DocumentUploadSource = {
  uid?: string | number;
  name?: string;
  originFileObj?: globalThis.File | globalThis.Blob;
  file?: globalThis.File | globalThis.Blob;
  raw?: globalThis.File | globalThis.Blob;
};

/** File, byte, or upload-wrapper data accepted as a document source. */
export type DocumentDataSource = globalThis.File | globalThis.Blob | ArrayBuffer | Uint8Array | DocumentUploadSource;

export interface Document {
  /** The ID of the document. */
  id?: string;
  /** Document type as a MIME type or shorthand such as `docx`. */
  type: string;
  /**
   * File or Blob exposed by `SuperDoc.state` after source normalization.
   * Direct byte sources appear as a Blob in this public view.
   */
  data?: globalThis.File | globalThis.Blob | null;
  /** The name of the document. */
  name?: string;
  /** The URL of the document. */
  url?: string;
  /** Whether the document is a new file. */
  isNewFile?: boolean;
  /** Password for this encrypted DOCX. Overrides top-level `Config.password`. */
  password?: string;
  /** The Yjs document for collaboration. */
  ydoc?: YDoc;
  /**
   * The provider for collaboration. Widened from `HocuspocusProvider` to
   * `CollaborationProvider` to match the runtime, which stores whatever
   * provider the consumer passed via `Config.modules.collaboration.provider`
   * (HocuspocusProvider, LiveblocksYjsProvider, TiptapCollabProvider, etc.).
   * Consumers needing Hocuspocus-specific members must narrow before use.
   */
  provider?: CollaborationProvider;
  /**
   * Connect this document to a shared room. SuperDoc owns the provider and Y.Doc.
   * Takes precedence over `v2Collaboration`; `null` opens a local document.
   */
  collaboration?: DocumentCollaborationConfig | null;
  /** @deprecated replaceWith=`collaboration` compat-indefinitely: existing v2 integrations use this field. */
  v2Collaboration?: V2CollaborationConfig | null;
}

type DocumentSourceOptions = Omit<Document, 'data' | 'type' | 'url'>;

/**
 * A document source with optional metadata. Provide `data` or `url`, but not
 * both. SuperDoc infers the type from file metadata and otherwise uses DOCX.
 */
export type StructuredDocumentSource =
  | (DocumentSourceOptions & { data: DocumentDataSource; type?: string; url?: never })
  | (DocumentSourceOptions & { data?: never; type?: string; url: string });

/** Document input accepted by `Config.document`. */
export type DocumentSource = string | DocumentDataSource | StructuredDocumentSource | Document;

/**
 * Public snapshot shape returned by `SuperDoc#state`. Always reflects
 * the most recent values from the Pinia store; consumers must re-read
 * on change rather than caching.
 *
 * `documents` is typed as the public `Document[]` view. Internally the
 * runtime tracks `RuntimeDocument`, which adds runtime-only fields
 * (editor/renderer accessors, `restoreComments`, etc.) for
 * SuperDoc's own lifecycle plumbing. Those fields are not part of the
 * supported surface; consumers using `state.documents` should treat
 * each entry as `Document` and not rely on the richer runtime shape.
 */
export interface SuperDocState {
  /** Documents tracked by the instance, in consumer-provided order. */
  documents: Document[];
  /** Shared users (drives presence + "@"-mention surfaces). */
  users: User[];
}

/**
 * External collaboration provider interface. Accepts any Yjs-compatible
 * provider (HocuspocusProvider, LiveblocksYjsProvider, TiptapCollabProvider,
 * etc.). The v2 branch exposes a structural provider type so public
 * declarations do not depend on the v1 editor package.
 */

/**
 * Internal augmentation of `Document` for runtime-only fields that the
 * SuperDoc instance attaches to each document during initialization. The
 * public `Document` interface above is what consumers pass in via
 * `Config.documents`; this type adds the fields SuperDoc itself sets and
 * reads internally (per-document `role` propagation, the live editor and
 * renderer accessors that the surface manager and
 * mode-switch helpers walk).
 *
 * Internal use only: not part of any public typedef. Consumers cannot
 * import this through `superdoc` and should not pass any of these fields
 * into `Config.documents` from outside.
 */
export interface RuntimeDocument extends Document {
  /**
   * Per-document role. `useDocument()` reads `params.role` from the input
   * config and exposes it on the smart-doc object; once collaboration
   * setup runs, SuperDoc unconditionally writes `doc.role = config.role`,
   * silently replacing whatever was passed. SD-2872 removed this from
   * the public `Document` interface so consumers stop trying to use it
   * as a stable per-document override; it lives on `RuntimeDocument`
   * only so internal SuperDoc callsites can type the assignment.
   */
  role?: 'editor' | 'viewer' | 'suggester';
  /**
   * Returns the body Editor for this document, when the runtime has
   * created one. Set by the editor-create lifecycle.
   *
   * @deprecated Direct editor access will be removed in a future version.
   * Use the Document API (`editor.doc`) instead. This typedef carries the
   * deprecation marker forward from the source accessor in
   * `packages/superdoc/src/composables/use-document.js`.
   */
  getEditor?: () => Editor | null | undefined;
  /**
   * Returns the DocumentRendererRuntime for this document, when the runtime
   * has created one. Set by the editor-create lifecycle.
   *
   * @deprecated Direct editor access will be removed in a future version.
   * Use the Document API (`editor.doc`) instead.
   */
  getDocumentRuntime?: () => DocumentRendererRuntime | null | undefined;
  /**
   * Runtime-only flag mirrored from `Config.rulers` per document by the
   * Pinia store. SuperDoc writes this on each document during the
   * setShowRulers flow; not part of consumer-supplied `Document`.
   */
  rulers?: boolean;
  /**
   * Runtime-only method attached by the comments composable on each
   * document. Set after the comments store is ready; called during
   * mode switches. Not part of consumer-supplied `Document`.
   */
  restoreComments?: () => void;
  /**
   * Runtime-only method attached by the comments composable on each
   * document. Set after the comments store is ready; called during
   * DOCX export when comments should be stripped. Not part of
   * consumer-supplied `Document`.
   */
  removeComments?: () => void;
}

/** Collaboration module configuration. */
export interface CollaborationConfig {
  /** External Yjs document (provider-agnostic mode). */
  ydoc?: YDoc;
  /** External collaboration provider (provider-agnostic mode). */
  provider?: CollaborationProvider;
  /** Internal provider type (deprecated). */
  providerType?: 'hocuspocus' | 'superdoc';
  /** WebSocket URL for internal provider (deprecated). */
  url?: string;
  /** Authentication token for internal provider (deprecated). */
  token?: string;
  /** Additional params for internal provider (deprecated). */
  params?: object;
}

/**
 * Options for `upgradeToCollaboration()`.
 *
 * Promote a local DOCX into a shared room using `collaboration`.
 * Supports the same providers as {@link DocumentCollaborationConfig}.
 *
 * The legacy `ydoc` / `provider` fields remain accepted for source
 * compatibility with v1-shaped callers, but v2 does **not** drive document
 * content from an arbitrary external `{ ydoc, provider }` pair: a v2 upgrade
 * resolves to a supported v2 target through the shell's collaboration target
 * resolver, or fails closed with a named, redacted diagnostic. The legacy
 * fields are therefore optional and only honored when they resolve to a
 * supported v2 room.
 *
 * @see {@link DocumentCollaborationConfig}
 */
export interface UpgradeToCollaborationOptions {
  /**
   * Create a shared room from the current document. Fails if the room already exists.
   * Takes precedence over `v2Collaboration`.
   */
  collaboration?: DocumentCollaborationConfig;
  /** @deprecated replaceWith=`collaboration` compat-indefinitely: existing v2 integrations use this field. */
  v2Collaboration?: V2CollaborationConfig;
  /**
   * Legacy external Yjs document. Accepted for v1 source compatibility; not a
   * supported v2 content source on its own.
   */
  ydoc?: YDoc;
  /**
   * Legacy external collaboration provider. Accepted for v1 source
   * compatibility; not a supported v2 content source on its own.
   */
  provider?: CollaborationProvider;
}

/** Context passed to a hyperlink activation handler. */
export interface HyperlinkActivationContext {
  /** The editor instance. */
  editor: Editor;
  /** URL or document-anchor reference from the activated link's `href`. */
  href: string;
  /** The link's HTML `target` attribute, such as `_blank`. */
  target: string | null;
  /** The rel attribute of the clicked link. */
  rel: string | null;
  /** The title/tooltip attribute of the clicked link. */
  tooltip: string | null;
  /** The clicked anchor DOM element. */
  element: HTMLAnchorElement;
  /** Horizontal activation coordinate in viewport pixels. */
  clientX: number;
  /** Vertical activation coordinate in viewport pixels. */
  clientY: number;
  /** Whether this is an anchor link (href starts with #). */
  isAnchorLink: boolean;
  /** Current document mode ('editing', 'viewing', 'suggesting'). */
  documentMode: DocumentMode;
  /** What SuperDoc would do if the handler chooses the default behavior. */
  defaultAction: 'edit' | 'navigate';
  /** Suggested position for a custom action, relative to the Editor surface. */
  position: { left: string; top: string };
  /**
   * Resolve the activated hyperlink to its canonical Document API target.
   * Pass this target to `doc.hyperlinks.get()`, `patch()`, or `remove()`.
   * Returns `null` when the link cannot be matched to a Document API hyperlink.
   */
  getDocumentTarget: () => Promise<HyperlinkTarget | null>;
}

/** Context passed to a custom action rendered near a hyperlink. */
export interface HyperlinkRenderContext {
  /** Empty DOM container positioned near the activated hyperlink. */
  container: HTMLElement;
  /** Close the rendered UI. SuperDoc then calls the returned `destroy()` function. */
  close: () => void;
  /** The editor instance. */
  editor: Editor;
  /** URL or document-anchor reference from the activated link's `href`. */
  href: string;
}

/** Result returned by a hyperlink activation handler. */
export type HyperlinkActivationResult =
  | { type: 'default' }
  | { type: 'suppress' }
  | {
      /** @deprecated replaceWith=`type: 'suppress'` removeIn=v3.0 */
      type: 'none';
    }
  | {
      type: 'render';
      render: (context: HyperlinkRenderContext) => { destroy?: () => void } | void;
    };

/**
 * Handles hyperlink activation. Return synchronously; Promises are not
 * supported. Return `undefined`, `null`, or `{ type: 'default' }` to use
 * SuperDoc's default behavior for this activation.
 */
export type HyperlinkActivationHandler = (
  context: HyperlinkActivationContext,
) => HyperlinkActivationResult | null | undefined;

/**
 * Controls what happens when a user activates a hyperlink.
 *
 * This behavior is separate from `ui` because a hyperlink can navigate or be
 * handled by custom UI without SuperDoc rendering a surface.
 */
export interface HyperlinksConfig {
  /**
   * Use SuperDoc's default behavior, suppress this activation, or render a
   * small custom action near the hyperlink.
   */
  onActivate?: HyperlinkActivationHandler;
}

/** @deprecated replaceWith=`HyperlinkActivationContext` removeIn=v3.0 */
export interface LinkPopoverContext extends HyperlinkActivationContext {
  /** Close the popover programmatically. */
  closePopover: () => void;
}

/** @deprecated replaceWith=`HyperlinkRenderContext` removeIn=v3.0 */
export interface ExternalPopoverRenderContext {
  /** Empty DOM container positioned where the popover should appear. */
  container: HTMLElement;
  /** Call to close the popover and clean up. */
  closePopover: () => void;
  /** The editor instance. */
  editor: Editor;
  /** The href of the clicked link. */
  href: string;
}

/** @deprecated replaceWith=`HyperlinkActivationResult` removeIn=v3.0 */
export type LinkPopoverResolution =
  | { type: 'default' }
  | { type: 'none' }
  | { type: 'custom'; component: unknown; props?: Record<string, unknown> }
  | {
      type: 'external';
      render: (context: ExternalPopoverRenderContext) => { destroy?: () => void } | void;
    };

/** @deprecated replaceWith=`HyperlinkActivationHandler` removeIn=v3.0 */
export type LinkPopoverResolver = (context: LinkPopoverContext) => LinkPopoverResolution | null | undefined;

/** Layouts supported by the built-in comments UI. */
export type CommentsLayout = 'auto' | 'sidebar' | 'inline';

/** Width settings used when `ui.comments.layout` is `auto`. */
export interface CommentsResponsiveConfig {
  /**
   * Element whose width controls the layout. Pass an element or a CSS
   * selector. Defaults to the nearest measurable Editor ancestor.
   */
  target?: string | HTMLElement;
  /**
   * Switch from sidebar to inline below this width, in CSS pixels. When
   * omitted, SuperDoc derives the threshold from the document and sidebar.
   */
  breakpoint?: number;
}

/** Startup options for the built-in comments UI rendered by `ui.comments`. */
export interface CommentsConfig {
  /**
   * Where comment threads render (default: `'sidebar'`). `auto` uses the
   * available width to choose between sidebar and inline.
   */
  layout?: CommentsLayout;
  /** Optional width settings for the `auto` layout. */
  responsive?: CommentsResponsiveConfig;
  /**
   * How comments present themselves as the surface narrows.
   * @deprecated replaceWith=`ui.comments.layout` removeIn=v3.0
   */
  displayMode?: CommentsLayout;
  /**
   * CSS selector for the width measurement target in `auto` mode.
   * @deprecated replaceWith=`ui.comments.responsive.target` removeIn=v3.0
   */
  compactMeasurementSelector?: string;
  /**
   * Fixed compact-mode breakpoint in pixels.
   * @deprecated replaceWith=`ui.comments.responsive.breakpoint` removeIn=v3.0
   */
  compactBreakpointPx?: number;
  /**
   * Comment highlight colors (internal/external and active overrides).
   * @deprecated replaceWith=`--sd-comments-highlight-internal*` and `--sd-comments-highlight-external*` CSS custom properties removeIn=v3.0
   */
  highlightColors?: {
    /** Base highlight color for internal comments. */
    internal?: string;
    /** Base highlight color for external comments. */
    external?: string;
    /** Active highlight color override for internal comments. */
    activeInternal?: string;
    /** Active highlight color override for external comments. */
    activeExternal?: string;
  };
  /**
   * Comment highlight opacity, active and inactive.
   * @deprecated replaceWith=alpha values in the `--sd-comments-highlight-internal*` and `--sd-comments-highlight-external*` CSS custom properties removeIn=v3.0
   */
  highlightOpacity?: {
    /** Opacity for the active comment highlight. */
    active?: number;
    /** Opacity for inactive comment highlights. */
    inactive?: number;
  };
  /**
   * Highlight color used while hovering a comment.
   * @deprecated replaceWith=`--sd-comments-highlight-hover` removeIn=v3.0
   */
  highlightHoverColor?: string;
  /**
   * Tracked-change highlight colors.
   * @deprecated replaceWith=`--sd-tracked-changes-*` CSS custom properties removeIn=v3.0
   */
  trackChangeHighlightColors?: TrackChangeHighlightColors;
  /**
   * Active tracked-change highlight colors.
   * @deprecated replaceWith=`--sd-tracked-changes-*` CSS custom properties removeIn=v3.0
   */
  trackChangeActiveHighlightColors?: TrackChangeHighlightColors;
  /**
   * These fields are not presentation settings and have no `ui.comments`
   * spelling.
   *
   * Use `interaction.comments.level` for comment capability and
   * `Config.permissionResolver` for custom permission decisions.
   */
  readOnly?: never;
  allowResolve?: never;
  level?: never;
  permissionResolver?: never;
}

/** Border and background colors for one tracked-change highlight state. */
export interface TrackChangeHighlightColors {
  /** Border color for inserted text. */
  insertBorder?: string;
  /** Background color for inserted text. */
  insertBackground?: string;
  /** Border color for deleted text. */
  deleteBorder?: string;
  /** Background color for deleted text. */
  deleteBackground?: string;
  /** Border color for a format change. */
  formatBorder?: string;
}

/**
 * Previous object form for content-control chrome.
 * @deprecated replaceWith=`boolean ui.contentControls` compat-indefinitely=v2 configuration compatibility
 */
export interface ContentControlsConfig {
  /**
   * Previous spelling for enabling or disabling SuperDoc's content-control chrome.
   * @deprecated replaceWith=`boolean ui.contentControls` compat-indefinitely=v2 configuration compatibility
   */
  chrome?: 'default' | 'none';
}

/**
 * Configuration for the deprecated built-in link popover API.
 * @deprecated replaceWith=`HyperlinksConfig` removeIn=v3.0
 */
export interface LinkPopoverConfig {
  /**
   * Called when a user clicks a link, to decide which popover to show.
   * Returning `null` or `undefined` falls back to the built-in popover.
   * @deprecated replaceWith=`hyperlinks.onActivate` removeIn=v3.0
   */
  popoverResolver?: LinkPopoverResolver;
}

// ---------------------------------------------------------------------------
// Context menu types
// ---------------------------------------------------------------------------

/**
 * Context supplied to the deprecated `action` and `render` callbacks.
 * @deprecated replaceWith=`ContextMenuOpenContext` removeIn=v3.0
 */
export interface ContextMenuContext {
  /** The editor instance. */
  editor: Editor;
  /** Currently selected text (empty string if no selection). */
  selectedText: string;
  /** Whether there is an expanded selection. */
  hasSelection: boolean;
  /** ProseMirror start position of the selection. */
  selectionStart: number;
  /** ProseMirror end position of the selection. */
  selectionEnd: number;
  /** How the menu was opened. */
  trigger: 'click' | 'slash' | 'programmatic';
  /** Whether the cursor is inside a table. */
  isInTable: boolean;
  /** Whether the cursor is inside a list. */
  isInList: boolean;
  /** Whether the cursor is inside a document section. */
  isInSectionNode: boolean;
  /** Whether a table cell selection is active. */
  isCellSelection: boolean;
  /** Kind of table selection (row, column, etc.). */
  tableSelectionKind: string | null;
  /** ProseMirror node type name at the cursor. */
  currentNodeType: string | null;
  /** Names of marks active at the cursor. */
  activeMarks: string[];
  /** Whether the cursor is on a tracked change. */
  isTrackedChange: boolean;
  /** ID of the tracked change at the cursor. */
  trackedChangeId: string | null;
  /** Current document mode (editing, viewing, suggesting). */
  documentMode: string;
  /** Whether undo is available. */
  canUndo: boolean;
  /** Whether redo is available. */
  canRedo: boolean;
  /** Whether the editor is editable. */
  isEditable: boolean;
  /** Screen coordinates of the cursor. */
  cursorPosition: { x: number; y: number } | null;
}

/** Editor state captured whenever the built-in context menu opens or refreshes. */
export interface ContextMenuOpenContext {
  /** Latest selected text; a worker-backed read may initially report an empty string. */
  readonly selectedText: string;
  /** Whether the selection is expanded. */
  readonly hasSelection: boolean;
  /** How the menu was opened. */
  readonly trigger: 'click' | 'slash' | 'programmatic';
  /** Whether the selection is inside a table. */
  readonly isInTable: boolean;
  /** Whether exactly one table cell is selected. */
  readonly isSingleCellSelected: boolean;
  /** Whether a rectangular range of table cells is selected. */
  readonly isMultiCellSelected: boolean;
  /** Whether the selection is inside a list. */
  readonly isInList: boolean;
  /** Whether the pointer targeted a rendered list marker. */
  readonly isOnListMarker: boolean;
  /** Whether the selection is inside a table of contents. */
  readonly isInToc: boolean;
  /** Whether the selection is on a tracked change. */
  readonly isTrackedChange: boolean;
  /** ID of the tracked change at the selection, or `null`. */
  readonly trackedChangeId: string | null;
  /** Whether Accept is available for the tracked change at the selection. */
  readonly canAcceptTrackedChange: boolean;
  /** Whether Reject is available for the tracked change at the selection. */
  readonly canRejectTrackedChange: boolean;
  /** Document mode captured when the menu opened. */
  readonly documentMode: DocumentMode;
  /** Whether Undo is currently available. */
  readonly canUndo: boolean;
  /** Whether Redo is currently available. */
  readonly canRedo: boolean;
  /** Whether the captured document mode is not `viewing`. */
  readonly isEditable: boolean;
}

/** A single item inside a context menu section. */
export interface ContextMenuItem {
  /** Unique identifier for the menu item. */
  readonly id: string;
  /** Display text. */
  readonly label: string;
  /** Icon identifier. */
  readonly icon?: string;
  /**
   * Custom Vue component used only by the retired v1 menu renderer.
   * @deprecated replaceWith=`ui: { contextMenu: false }` removeIn=v3.0
   */
  readonly component?: unknown;
  /**
   * v1 click callback. SuperDoc 2 cannot supply its ProseMirror `Editor`
   * argument, so the item remains inert and logs a warning.
   * @deprecated replaceWith=`onSelect` removeIn=v3.0
   */
  readonly action?: (editor: Editor, context: ContextMenuContext) => void;
  /**
   * Application-owned click handler. Runs after the menu closes.
   */
  readonly onSelect?: (payload: ContextMenuSelectPayload) => void | Promise<void>;
  /** Predicate controlling visibility. */
  readonly showWhen?: (context: ContextMenuOpenContext) => boolean;
  /** Predicate controlling whether a visible item is enabled. */
  readonly enabledWhen?: (context: ContextMenuOpenContext) => boolean;
  /**
   * Custom renderer used only by the retired v1 menu renderer.
   * @deprecated replaceWith=`ui: { contextMenu: false }` removeIn=v3.0
   */
  readonly render?: (context: ContextMenuContext) => HTMLElement;
  /** Keyboard shortcut label displayed beside the item. */
  readonly shortcut?: string;
}

/** The menu context a `ContextMenuItem.onSelect` handler receives. */
export interface ContextMenuSelectContext extends ContextMenuOpenContext {
  /**
   * Resolves the selected text if the worker-backed read was still pending.
   * Awaiting it spends the click's user activation, so use `selectedText` when
   * the handler needs to call a gesture-gated browser API immediately.
   */
  readonly selectedTextSettled: Promise<string>;
}

/** Repaint coordination handed alongside the Document API surface. */
export interface ContextMenuSelectReadiness {
  /** Render epoch of the mounted surface, or null when not mounted. */
  getRenderEpoch(): number | null;
  /** Resolves once a mutation's scheduled repaint has settled. */
  whenPainted(input?: { txId?: string; afterEpoch?: number | null }): Promise<{ renderEpoch: number | null }>;
}

/**
 * What a `ContextMenuItem.onSelect` handler is given.
 *
 * `document` is the async Document API surface, and it is a result rather than
 * a handle: it reports `available: false` with a reason before the document is
 * ready, so a handler has to check before reaching for `doc`. It is not the
 * ProseMirror `Editor` the deprecated `action` callback took, which the v2
 * runtime does not have.
 */
export interface ContextMenuSelectPayload {
  document:
    | { available: true; doc: BrowserDocumentApi; readiness: ContextMenuSelectReadiness }
    | { available: false; reason: string };
  /** The context captured when the menu opened, not the live document state. */
  context: ContextMenuSelectContext | null;
}

/** A section (group) of items in the context menu. */
export interface ContextMenuSection {
  /** Unique identifier for the section. */
  readonly id: string;
  /** Menu items in this section. */
  readonly items: readonly ContextMenuItem[];
}

/** A menu item after SuperDoc has evaluated its visibility and availability. */
export interface ContextMenuResolvedItem extends ContextMenuItem {
  /** Whether the item remains visible but cannot be selected. */
  readonly disabled: boolean;
}

/** A section supplied to `ContextMenuConfig.menuProvider`. */
export interface ContextMenuResolvedSection {
  /** Section identifier from the configured or built-in menu. */
  readonly id: string;
  /** Visible items after SuperDoc evaluates each item's availability. */
  readonly items: readonly ContextMenuResolvedItem[];
}

/** Configuration for the built-in context menu. */
export interface ContextMenuConfig {
  /** Whether typing `/` after whitespace opens the menu (default: true). */
  readonly openOnSlash?: boolean;
  /** Application sections appended to the menu, or merged into a built-in section with the same ID. */
  readonly sections?: readonly ContextMenuSection[];
  /** Whether to include SuperDoc's built-in items (default: true). */
  readonly defaultItems?: boolean;
  /**
   * Custom menu sections appended (or merged by id) to the default menu.
   * @deprecated replaceWith=`sections` removeIn=v3.0
   */
  readonly customItems?: readonly ContextMenuSection[];
  /**
   * Filter or reorder the resolved sections before they render. Return `null`
   * or `undefined` to keep the original list.
   */
  readonly menuProvider?: (
    context: ContextMenuOpenContext,
    sections: readonly ContextMenuResolvedSection[],
  ) => readonly ContextMenuResolvedSection[] | null | undefined;
  /**
   * Whether to include default menu items (default: true).
   * @deprecated replaceWith=`defaultItems` removeIn=v3.0
   */
  readonly includeDefaultItems?: boolean;
}

// ---------------------------------------------------------------------------
// Surface system types
// ---------------------------------------------------------------------------

/** Surface presentation mode. */
export type SurfaceMode = 'dialog' | 'floating';

export type SurfaceFloatingPlacement =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'bottom-center';

/** Per-request floating-mode overrides. */
interface FloatingRequestOptions {
  /** Position preset (default: 'top-right'). Ignored when explicit insets are provided. */
  placement?: SurfaceFloatingPlacement;
  /** Exact top inset (overrides placement). */
  top?: string | number;
  /** Exact right inset (overrides placement). */
  right?: string | number;
  /** Exact bottom inset (overrides placement). */
  bottom?: string | number;
  /** Exact left inset (overrides placement). */
  left?: string | number;
  /** Surface width. */
  width?: string | number;
  /** Max width. */
  maxWidth?: string | number;
  /** Max height. */
  maxHeight?: string | number;
  /** Move focus into first focusable child on open (default: true). */
  autoFocus?: boolean;
  /** Close when pointer down outside the surface (default: false). */
  closeOnOutsidePointerDown?: boolean;
}

/** Intent-based surface request — resolved by the resolver or built-in registry. */
export interface IntentSurfaceRequest {
  /** Optional surface id (auto-generated if omitted). */
  id?: string;
  /** Opaque intent identifier used by the resolver. */
  kind: string;
  /** Presentation mode. */
  mode: SurfaceMode;
  /** Optional title rendered in the surface chrome. */
  title?: string;
  /**
   * Accessible name for the surface when no visible title is provided. Used as
   * aria-label fallback when neither title nor ariaLabelledBy is set.
   */
  ariaLabel?: string;
  /**
   * ID of the element that labels the surface. Takes precedence over
   * ariaLabel. Use this when the content component renders its own heading
   * that should serve as the accessible name.
   */
  ariaLabelledBy?: string;
  /**
   * Whether Escape closes the surface (default: true). Set at the request top
   * level — the runtime does not read `floating.closeOnEscape` on a per-request
   * basis.
   */
  closeOnEscape?: boolean;
  /** Whether backdrop click closes a dialog (default: true). */
  closeOnBackdrop?: boolean;
  /** Dialog-specific overrides. */
  dialog?: { maxWidth?: string | number };
  /** Floating-specific overrides. */
  floating?: FloatingRequestOptions;
  /** Arbitrary data for the resolver or content. */
  payload?: Record<string, unknown>;
}

/** Direct-render surface request — provides its own component or external renderer. */
export interface DirectSurfaceRequest {
  /** Optional surface id (auto-generated if omitted). */
  id?: string;
  /** Presentation mode. */
  mode: SurfaceMode;
  /** Optional title rendered in the surface chrome. */
  title?: string;
  /**
   * Accessible name for the surface when no visible title is provided. Used as
   * aria-label fallback when neither title nor ariaLabelledBy is set.
   */
  ariaLabel?: string;
  /**
   * ID of the element that labels the surface. Takes precedence over
   * ariaLabel. Use this when the content component renders its own heading
   * that should serve as the accessible name.
   */
  ariaLabelledBy?: string;
  /**
   * Whether Escape closes the surface (default: true). Set at the request top
   * level — the runtime does not read `floating.closeOnEscape` on a per-request
   * basis.
   */
  closeOnEscape?: boolean;
  /** Whether backdrop click closes a dialog (default: true). */
  closeOnBackdrop?: boolean;
  /** Dialog-specific overrides. */
  dialog?: { maxWidth?: string | number };
  /** Floating-specific overrides. */
  floating?: FloatingRequestOptions;
  /** Vue component to render as the surface content. */
  component?: unknown;
  /** Extra props passed to the Vue component. */
  props?: Record<string, unknown>;
  /** External (framework-agnostic) renderer function. */
  render?: (ctx: ExternalSurfaceRenderContext) => { destroy?: () => void } | void;
}

/** Combined surface request type (intent-based or direct-render). */
export type SurfaceRequest = IntentSurfaceRequest | DirectSurfaceRequest;

/** Resolution returned by a surface resolver. */
export type SurfaceResolution =
  | { type: 'none' }
  | { type: 'custom'; component: unknown; props?: Record<string, unknown> }
  | {
      type: 'external';
      render: (ctx: ExternalSurfaceRenderContext) => { destroy?: () => void } | void;
    };

/**
 * Resolver function for customizing surface rendering. Must be synchronous;
 * do not return a Promise. Return null/undefined to fall through to built-in
 * handling. Return `{ type: 'none' }` to explicitly suppress the surface.
 */
export type SurfaceResolver = (request: SurfaceRequest) => SurfaceResolution | null | undefined;

/**
 * Outcome of a surface lifecycle. The handle.result promise always resolves
 * with one of these — it never rejects for normal lifecycle events.
 */
export interface SurfaceOutcome<TResult = unknown> {
  status: 'submitted' | 'closed' | 'replaced' | 'destroyed';
  /** Present when status is 'submitted'. */
  data?: TResult;
  /** Present when status is 'closed'. */
  reason?: unknown;
  /** Present when status is 'replaced'. */
  replacedBy?: string;
}

/**
 * Handle returned by openSurface(). Callers use this to await the outcome or
 * close the surface programmatically.
 */
export interface SurfaceHandle<TResult = unknown> {
  /** Resolved surface id. */
  id: string;
  /** Presentation mode. */
  mode: SurfaceMode;
  /** Close this surface programmatically. */
  close: (reason?: unknown) => void;
  /** Resolves when the surface settles. */
  result: Promise<SurfaceOutcome<TResult>>;
}

/**
 * Props passed to a custom Vue component rendered inside a surface shell.
 * Reserved props (surfaceId, mode, request, resolve, close) always win over
 * caller-provided props to prevent accidental lifecycle override.
 */
export interface SurfaceComponentProps {
  /** The surface id. */
  surfaceId: string;
  /** Presentation mode. */
  mode: SurfaceMode;
  /** The original (normalized) request. */
  request: SurfaceRequest;
  /** Resolves the handle with `{ status: 'submitted', data }`. */
  resolve: (data?: unknown) => void;
  /** Resolves the handle with `{ status: 'closed', reason }`. */
  close: (reason?: unknown) => void;
}

/** Context passed to an external (framework-agnostic) surface renderer. */
export interface ExternalSurfaceRenderContext {
  /** Empty DOM container to render into. */
  container: HTMLElement;
  /** The surface id. */
  surfaceId: string;
  /** Presentation mode. */
  mode: SurfaceMode;
  /** The original (normalized) request. */
  request: SurfaceRequest;
  /** Resolves the handle with `{ status: 'submitted', data }`. */
  resolve: (data?: unknown) => void;
  /** Resolves the handle with `{ status: 'closed', reason }`. */
  close: (reason?: unknown) => void;
}

/** Module-level configuration for the surface system. */
export interface SurfacesModuleConfig {
  /**
   * Global surface resolver.
   *
   * `null` is the resolved "no resolver" value the normalizer produces after
   * rejecting a non-function; SurfaceManager guards with `typeof === 'function'`
   * either way.
   */
  resolver?: SurfaceResolver | null;
  /** Default dialog options. */
  dialog?: {
    /** Default escape behavior for dialogs (default: true). */
    closeOnEscape?: boolean;
    /** Default backdrop-click behavior for dialogs (default: true). */
    closeOnBackdrop?: boolean;
    /** Default dialog max-width. */
    maxWidth?: string | number;
  };
  /** Default floating options. */
  floating?: {
    /** Default placement preset (default: 'top-right'). */
    placement?: SurfaceFloatingPlacement;
    /** Default floating width. */
    width?: string | number;
    /** Default floating max-width. */
    maxWidth?: string | number;
    /** Default floating max-height. */
    maxHeight?: string | number;
    /** Default escape behavior for floating surfaces (default: true). */
    closeOnEscape?: boolean;
    /** Default outside-pointer behavior (default: false). */
    closeOnOutsidePointerDown?: boolean;
    /** Default auto-focus behavior (default: true). */
    autoFocus?: boolean;
  };
  /**
   * Older configuration for the built-in Search surface.
   * @deprecated replaceWith=`ui.search` removeIn=v3.0
   */
  findReplace?: boolean | FindReplaceConfig;
  /**
   * Built-in password prompt dialog for encrypted DOCX files. Enabled by
   * default when omitted. Set to `false` to disable. When `true`, uses
   * default titles/labels. When an object, allows custom titles and labels.
   */
  passwordPrompt?: boolean | PasswordPromptConfig;
}

/** All customizable text strings for the password prompt, resolved with defaults. */
export interface ResolvedPasswordPromptTexts {
  /** Dialog title for first attempt. */
  title: string;
  /** Dialog title after wrong password. */
  invalidTitle: string;
  /** Explanatory text shown below the title. */
  description: string;
  /** Input placeholder text. */
  placeholder: string;
  /** Accessible label for the password input. */
  inputAriaLabel: string;
  /** Submit button text. */
  submitLabel: string;
  /** Cancel button text. */
  cancelLabel: string;
  /** Submit button text while decrypting. */
  busyLabel: string;
  /** Error message for wrong password. */
  invalidMessage: string;
  /** Error message for decryption timeout. */
  timeoutMessage: string;
  /** Error message for other failures. */
  genericErrorMessage: string;
}

/** Result of a password attempt via the `attemptPassword` function. */
export interface PasswordPromptAttemptResult {
  /** Whether the password was accepted. */
  success: boolean;
  /** Error code when success is false (e.g. 'DOCX_PASSWORD_INVALID', 'timeout'). */
  errorCode?: string;
}

/**
 * Handle object injected into custom password prompt UIs as the
 * `passwordPrompt` prop/context field. Provides document metadata, resolved
 * texts, and the retry function.
 */
export interface PasswordPromptHandle {
  /** The document ID requiring a password. */
  documentId: string;
  /** The current error code (e.g. 'DOCX_PASSWORD_REQUIRED', 'DOCX_PASSWORD_INVALID'). */
  errorCode: string;
  /** All text strings resolved with defaults. */
  texts: ResolvedPasswordPromptTexts;
  /**
   * Submit a password attempt. Returns the outcome; do not mutate document
   * state directly.
   */
  attemptPassword: (password: string) => Promise<PasswordPromptAttemptResult>;
}

/**
 * Read-only context passed to a password prompt resolver to decide how to
 * render. Does NOT include `attemptPassword` — the resolver decides, it does
 * not act.
 */
export interface PasswordPromptContext {
  /** The document ID requiring a password. */
  documentId: string;
  /** The current error code. */
  errorCode: string;
  /** Resolved text strings. */
  texts: ResolvedPasswordPromptTexts;
}

/** Context passed to an external (framework-agnostic) password prompt renderer. */
export interface PasswordPromptRenderContext {
  /** Empty DOM container to render into. */
  container: HTMLElement;
  /** The password prompt handle. */
  passwordPrompt: PasswordPromptHandle;
  /** Resolves the surface with `{ status: 'submitted', data }`. */
  resolve: (data?: unknown) => void;
  /** Resolves the surface with `{ status: 'closed', reason }`. */
  close: (reason?: unknown) => void;
  /** The surface id. */
  surfaceId: string;
  /** Presentation mode. */
  mode: SurfaceMode;
}

/** Resolution returned by a password prompt resolver. */
export type PasswordPromptResolution =
  | { type: 'default' }
  | { type: 'none' }
  | { type: 'custom'; component: unknown; props?: Record<string, unknown> }
  | {
      type: 'external';
      render: (ctx: PasswordPromptRenderContext) => { destroy?: () => void } | void;
    };

/** Configuration for the password prompt surface. */
export interface PasswordPromptConfig {
  /** Dialog title for first attempt (default: 'Password Required'). */
  title?: string;
  /** Dialog title after wrong password (default: 'Incorrect Password'). */
  invalidTitle?: string;
  /** Explanatory text (default: 'This document is password protected. Enter the password to open it.'). */
  description?: string;
  /** Input placeholder (default: 'Enter password'). */
  placeholder?: string;
  /** Accessible label for the input (default: 'Document password'). */
  inputAriaLabel?: string;
  /** Submit button text (default: 'Open'). */
  submitLabel?: string;
  /** Cancel button text (default: 'Cancel'). */
  cancelLabel?: string;
  /** Submit button text while decrypting (default: 'Decrypting…'). */
  busyLabel?: string;
  /** Error for wrong password (default: 'Incorrect password. Please try again.'). */
  invalidMessage?: string;
  /** Error for timeout (default: 'Timed out while decrypting. Please try again.'). */
  timeoutMessage?: string;
  /** Error for other failures (default: 'Unable to decrypt this document.'). */
  genericErrorMessage?: string;
  /** Vue component to render as custom password prompt content. Mutually exclusive with `render`. */
  component?: unknown;
  /** Extra props passed to the custom Vue component. Component-only; ignored for `render`. */
  props?: Record<string, unknown>;
  /** External (framework-agnostic) renderer. Mutually exclusive with `component`. */
  render?: (ctx: PasswordPromptRenderContext) => { destroy?: () => void } | void;
  /** Conditional resolver for per-document customization. Can coexist with `component`/`render`. */
  resolver?: (ctx: PasswordPromptContext) => PasswordPromptResolution | null | undefined;
}

// ---------------------------------------------------------------------------
// Search surface types
// ---------------------------------------------------------------------------

/** String overrides for the built-in Search surface. */
export interface SearchStrings {
  /** Input placeholder for the find field. */
  findPlaceholder?: string;
  /** Accessible label for the find input. */
  findAriaLabel?: string;
  /** Input placeholder for the replace field. */
  replacePlaceholder?: string;
  /** Accessible label for the replace input. */
  replaceAriaLabel?: string;
  /** Text shown when there are no matches. */
  noResults?: string;
  /** Tooltip for the previous-match button. */
  previousMatchTitle?: string;
  /** Accessible label for previous match button. */
  previousMatchAriaLabel?: string;
  /** Tooltip for the next-match button. */
  nextMatchTitle?: string;
  /** Accessible label for next match button. */
  nextMatchAriaLabel?: string;
  /** Tooltip for the close button. */
  closeTitle?: string;
  /** Accessible label for close button. */
  closeAriaLabel?: string;
  /** Replace button text. */
  replace?: string;
  /** Replace-all button text. */
  replaceAll?: string;
  /** Tooltip for the button that expands or collapses replace controls. */
  toggleReplaceTitle?: string;
  /** Accessible label for toggle replace button. */
  toggleReplaceAriaLabel?: string;
  /** Match case toggle text. */
  matchCase?: string;
  /** Accessible label for match case toggle. */
  matchCaseAriaLabel?: string;
  /** Ignore diacritics toggle text. */
  ignoreDiacritics?: string;
  /** Accessible label for ignore diacritics toggle. */
  ignoreDiacriticsAriaLabel?: string;
  /** Regex toggle text. */
  regex?: string;
  /** Accessible label for the regex toggle. */
  regexAriaLabel?: string;
  /** Inline error shown when the regex pattern is invalid or unsafe. */
  invalidPattern?: string;
}

/**
 * Resolved text for the older custom Search renderer.
 * @deprecated replaceWith=`SearchStrings` for built-in copy or `superdoc.ui.search` for custom UI removeIn=v3.0
 */
export interface ResolvedFindReplaceTexts {
  findPlaceholder: string;
  findAriaLabel: string;
  replacePlaceholder: string;
  replaceAriaLabel: string;
  noResultsLabel: string;
  previousMatchLabel: string;
  previousMatchAriaLabel: string;
  nextMatchLabel: string;
  nextMatchAriaLabel: string;
  closeLabel: string;
  closeAriaLabel: string;
  replaceLabel: string;
  replaceAllLabel: string;
  toggleReplaceLabel: string;
  toggleReplaceAriaLabel: string;
  matchCaseLabel: string;
  matchCaseAriaLabel: string;
  ignoreDiacriticsLabel: string;
  ignoreDiacriticsAriaLabel: string;
  regexLabel: string;
  regexAriaLabel: string;
  invalidPatternLabel: string;
}

/**
 * A document position range, in ProseMirror coordinates.
 *
 * SD-2828: Surfaced on the public type contract so consumers can
 * destructure `SearchMatch.ranges` without falling back to `any`. Mirrors
 * the private `DocRange` typedef in the search extension; keep them in
 * sync. Pure data, no methods.
 */
export interface DocRange {
  /** Start position in the document. */
  from: number;
  /** End position in the document. */
  to: number;
}

/**
 * One match returned by `SuperDoc.search()` (and consumed by
 * `SuperDoc.goToSearchResult()`).
 *
 * SD-2828: Promoted from the private search-extension typedef to a
 * public contract so consumers get real types instead of `any` on the
 * search return value, and so `goToSearchResult` can declare the input
 * shape it expects rather than accepting an opaque `Object`. Match
 * instances are produced by the runtime; consumers should treat them as
 * read-only and pass them back unchanged.
 */
export interface SearchMatch {
  /** Combined match text across all ranges. */
  text: string;
  /** Start position of the first range. */
  from: number;
  /** End position of the last range. */
  to: number;
  /**
   * Stable match identifier. For single-range matches this is the
   * position-tracker id; for multi-range (cross-paragraph) matches it is
   * the first tracker id. Use as the dedupe / equality key when wiring a
   * custom navigator.
   */
  id: string;
  /**
   * Document ranges for the match. Present for multi-range matches
   * (cross-paragraph), and may also be populated for single-range
   * matches by the search runtime; consumers should not assume length 1.
   */
  ranges?: DocRange[];
  /** Position-tracker ids, one per range in `ranges`. */
  trackerIds?: string[];
}

/**
 * Reactive handle injected into the older custom Search renderer.
 * @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0
 */
export interface FindReplaceHandle {
  /** Current search query. */
  findQuery: Ref<string>;
  /** Current replacement text. */
  replaceText: Ref<string>;
  /** Case-sensitive toggle. */
  caseSensitive: Ref<boolean>;
  /** Ignore diacritics toggle. */
  ignoreDiacritics: Ref<boolean>;
  /** Whether replace row is expanded. */
  showReplace: Ref<boolean>;
  /** Total match count (read-only by convention). */
  matchCount: Ref<number>;
  /** Active match index, -1 when none (read-only by convention). */
  activeMatchIndex: Ref<number>;
  /** Formatted match label e.g. "3 of 12" or "No results". */
  matchLabel: ComputedRef<string>;
  /** Whether there are any matches. */
  hasMatches: ComputedRef<boolean>;
  /**
   * Whether the replace controls should be enabled right now: there are
   * matches, no replace is in flight, and the active session permits mutation
   * (V2 read-only/viewing mode disables replace; V1 stays enabled).
   */
  canReplace: ComputedRef<boolean>;
  /**
   * Whether Replace all should be enabled right now: `canReplace` plus the
   * active session enumerating every match. A truncated V2 session keeps the
   * active match replaceable while refusing to replace all of them. Optional
   * so handles built against the previous shape still type-check; surfaces
   * fall back to `canReplace` when it is absent.
   */
  canReplaceAll?: ComputedRef<boolean>;
  /** Whether a replace mutation is currently in flight (re-entrancy guard). */
  replacePending: Ref<boolean>;
  /**
   * Runtime mutability of the active session (false in viewing/read-only
   * mode). Surfaces hide replace controls on this; `canReplace` additionally
   * requires matches and gates the actions.
   */
  replaceCanMutate: Ref<boolean>;
  /**
   * Whether the active driver supports the ignore-diacritics toggle. V1
   * supports it; the V2 Document API query path does not, so the toggle is
   * hidden rather than shipped as a no-op.
   */
  ignoreDiacriticsSupported: Ref<boolean>;
  /**
   * Whether the active driver supports regex search. The V2 (`ui.search`)
   * driver supports it; V1 hides the toggle.
   */
  regexSupported: Ref<boolean>;
  /** Whether the current query is treated as a regular expression. */
  regex: Ref<boolean>;
  /** Inline error label when the regex pattern is invalid/unsafe, else null. */
  searchError: Ref<string | null>;
  /** Whether replace actions are available (false for find-only mode). */
  replaceEnabled: boolean;
  /** All text strings resolved with defaults. */
  texts: ResolvedFindReplaceTexts;
  /** Navigate to the next match. */
  goNext: () => void;
  /** Navigate to the previous match. */
  goPrev: () => void;
  /** Replace the active match. */
  replaceCurrent: () => void;
  /** Replace all matches. */
  replaceAll: () => void;
  /** Register a function the composable calls to refocus the find input. */
  registerFocusFn: (fn: () => void) => void;
  /** Close the find/replace surface. */
  close: (reason?: unknown) => void;
}

/**
 * Read-only context passed to the older custom Search resolver.
 * @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0
 */
export interface FindReplaceContext {
  /** Resolved text strings. */
  texts: ResolvedFindReplaceTexts;
  /** Whether replace is available. */
  replaceEnabled: boolean;
}

/**
 * Context passed to the older framework-independent Search renderer.
 * @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0
 */
export interface FindReplaceRenderContext {
  /** Empty DOM container to render into. */
  container: HTMLElement;
  /** The find/replace handle with getters/setters instead of Vue refs. */
  findReplace: object;
  /** Resolves the surface with `{ status: 'submitted', data }`. */
  resolve: (data?: unknown) => void;
  /** Resolves the surface with `{ status: 'closed', reason }`. */
  close: (reason?: unknown) => void;
  /** The surface id. */
  surfaceId: string;
  /** Presentation mode. */
  mode: SurfaceMode;
}

/**
 * Result returned by the older custom Search resolver.
 * @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0
 */
export type FindReplaceResolution =
  | { type: 'default' }
  | { type: 'none' }
  | { type: 'custom'; component: unknown; props?: Record<string, unknown> }
  | {
      type: 'external';
      render: (ctx: FindReplaceRenderContext) => { destroy?: () => void } | void;
    };

/** Position and focus settings for the built-in Search surface. */
export interface SearchFloatingConfig {
  /** Position preset (default: `'top-right'`). Explicit insets override it. */
  placement?: SurfaceFloatingPlacement;
  /** Top inset in pixels or as a CSS length. */
  top?: number | string;
  /** Right inset in pixels or as a CSS length. */
  right?: number | string;
  /** Bottom inset in pixels or as a CSS length. */
  bottom?: number | string;
  /** Left inset in pixels or as a CSS length. */
  left?: number | string;
  /** Surface width in pixels or as a CSS length. */
  width?: number | string;
  /** Maximum surface width in pixels or as a CSS length. */
  maxWidth?: number | string;
  /** Maximum surface height in pixels or as a CSS length. */
  maxHeight?: number | string;
  /** Focus the find input when the surface opens (default: true). */
  autoFocus?: boolean;
  /** Close the surface when a pointer press occurs outside it (default: false). */
  closeOnOutsidePointerDown?: boolean;
}

/** Startup options for the built-in Search surface rendered by `ui.search`. */
export interface SearchConfig extends SearchLegacyConfig {
  /**
   * Show replace controls (default: true). This changes the built-in UI only;
   * it does not authorize or disable `superdoc.ui.search.replace()`.
   */
  replaceControls?: boolean;
  /** Include text from pending tracked deletions in each search (default: false). */
  includeTrackedDeletions?: boolean;
  /** String overrides for the built-in Search surface. */
  strings?: SearchStrings;
  /** Position and focus settings for the floating Search surface. */
  floating?: SearchFloatingConfig;
}

/** Compatibility fields accepted by `SearchConfig` for the rest of v2. */
interface SearchLegacyConfig {
  /** @deprecated replaceWith=`ui.search.strings.findPlaceholder` removeIn=v3.0 */
  findPlaceholder?: string;
  /** @deprecated replaceWith=`ui.search.strings.findAriaLabel` removeIn=v3.0 */
  findAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.replacePlaceholder` removeIn=v3.0 */
  replacePlaceholder?: string;
  /** @deprecated replaceWith=`ui.search.strings.replaceAriaLabel` removeIn=v3.0 */
  replaceAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.noResults` removeIn=v3.0 */
  noResultsLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.previousMatchTitle` removeIn=v3.0 */
  previousMatchLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.previousMatchAriaLabel` removeIn=v3.0 */
  previousMatchAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.nextMatchTitle` removeIn=v3.0 */
  nextMatchLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.nextMatchAriaLabel` removeIn=v3.0 */
  nextMatchAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.closeTitle` removeIn=v3.0 */
  closeLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.closeAriaLabel` removeIn=v3.0 */
  closeAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.replace` removeIn=v3.0 */
  replaceLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.replaceAll` removeIn=v3.0 */
  replaceAllLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.toggleReplaceTitle` removeIn=v3.0 */
  toggleReplaceLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.toggleReplaceAriaLabel` removeIn=v3.0 */
  toggleReplaceAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.matchCase` removeIn=v3.0 */
  matchCaseLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.matchCaseAriaLabel` removeIn=v3.0 */
  matchCaseAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.ignoreDiacritics` removeIn=v3.0 */
  ignoreDiacriticsLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.ignoreDiacriticsAriaLabel` removeIn=v3.0 */
  ignoreDiacriticsAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.regex` removeIn=v3.0 */
  regexLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.regexAriaLabel` removeIn=v3.0 */
  regexAriaLabel?: string;
  /** @deprecated replaceWith=`ui.search.strings.invalidPattern` removeIn=v3.0 */
  invalidPatternLabel?: string;
  /** @deprecated replaceWith=`ui.search.replaceControls` removeIn=v3.0 */
  replaceEnabled?: boolean;
  /** @deprecated replaceWith=`ui.search.includeTrackedDeletions` removeIn=v3.0 */
  includeDeletedText?: boolean;
  /** @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0 */
  component?: unknown;
  /** @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0 */
  props?: Record<string, unknown>;
  /** @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0 */
  render?: (ctx: FindReplaceRenderContext) => { destroy?: () => void } | void;
  /** @deprecated replaceWith=`superdoc.ui.search` removeIn=v3.0 */
  resolver?: (ctx: FindReplaceContext) => FindReplaceResolution | null | undefined;
}

/** @deprecated replaceWith=`SearchConfig` removeIn=v3.0 */
export type FindReplaceConfig = SearchConfig;

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/** Values passed to a configured {@link PermissionResolver}. */
export interface PermissionResolverParams {
  /** The permission key being checked, such as `'RESOLVE_OWN'`. */
  permission: string;
  /** Role used for this check. Falls back to `Config.role`. */
  role: string | undefined;
  /** Internal-user flag used for this check. Falls back to `Config.isInternal`. */
  isInternal: boolean | undefined;
  /**
   * Built-in decision for this check. Return `undefined` to preserve it, or
   * inspect it when computing an override.
   */
  defaultDecision: boolean;
  /** The comment object being acted on, if any. Shape is consumer-defined. */
  comment: object | null;
  /** The tracked-change payload (as emitted by the editor) being acted on, if any. */
  trackedChange: object | null;
  /** The active user performing the action, resolved from `Config.user`. */
  currentUser: User | null;
  /** The SuperDoc instance the check ran against. */
  superdoc: SuperDoc | null;
}

/**
 * Customizes a client-side permission decision. Return `undefined` to use
 * `defaultDecision`. This callback is not an authorization boundary.
 */
export type PermissionResolver = (params: PermissionResolverParams) => boolean | undefined;

/**
 * Values accepted by `SuperDoc#canPerformPermission`. `role` and `isInternal`
 * fall back to the corresponding `Config` fields. Entity objects are forwarded
 * to the permission resolver.
 */
export interface CanPerformPermissionParams {
  /** Permission key to check, such as `'RESOLVE_OWN'`. Omitting it returns `false`. */
  permission?: string;
  /** Override `Config.role` for this check. */
  role?: string;
  /** Override `Config.isInternal` for this check. */
  isInternal?: boolean;
  /** The comment object being acted on, if any. */
  comment?: (object & Record<string, unknown>) | null;
  /** The tracked-change payload (as emitted by the editor) being acted on, if any. */
  trackedChange?: ({ id?: string; commentId?: string; comment?: unknown } & Record<string, unknown>) | null;
}

/** Modules registered with the SuperDoc instance. */
export interface Modules {
  /**
   * Previous configuration for content-control chrome.
   * @deprecated replaceWith=`ui.contentControls` compat-indefinitely=v2 configuration compatibility
   */
  contentControls?: {
    /**
     * Previous spelling for enabling or disabling SuperDoc's content-control chrome.
     * @deprecated replaceWith=`ui.contentControls` compat-indefinitely=v2 configuration compatibility
     */
    chrome?: 'default' | 'none';
  };
  /**
   * Comments module configuration (false to disable). Retained for v2
   * compatibility; new integrations configure presentation through
   * `ui.comments`, actions through `interaction.comments`, and a custom
   * resolver through top-level `permissionResolver`.
   *
   * @deprecated replaceWith=`ui.comments|interaction.comments|permissionResolver` removeIn=v3.0
   */
  comments?:
    | false
    | ({
        /**
         * Previous comment-scoped permission resolver.
         * @deprecated replaceWith=`Config.permissionResolver` removeIn=v3.0
         */
        permissionResolver?: PermissionResolver;
        /**
         * Block comment mutations. Also block tracked-change accept/reject
         * unless `interaction.trackedChanges.allowDecisions` is set.
         * @deprecated replaceWith=`interaction.comments.level` and `interaction.trackedChanges.allowDecisions` compat-indefinitely=v2 configuration compatibility
         */
        readOnly?: boolean;
        /**
         * Allow comment resolve and reopen actions when comment writes are enabled (default: true).
         * @deprecated replaceWith=`interaction.comments.level` compat-indefinitely=v2 configuration compatibility
         */
        allowResolve?: boolean;
        /**
         * Comment highlight colors (internal/external and active overrides).
         * @deprecated replaceWith=`--sd-comments-highlight-internal*` and `--sd-comments-highlight-external*` CSS custom properties removeIn=v3.0
         */
        highlightColors?: {
          /** Base highlight color for internal comments. */
          internal?: string;
          /** Base highlight color for external comments. */
          external?: string;
          /** Active highlight color override for internal comments. */
          activeInternal?: string;
          /** Active highlight color override for external comments. */
          activeExternal?: string;
        };
        /**
         * Comment highlight opacity values (0-1).
         * @deprecated replaceWith=alpha values in the `--sd-comments-highlight-internal*` and `--sd-comments-highlight-external*` CSS custom properties removeIn=v3.0
         */
        highlightOpacity?: {
          /** Opacity for active comment highlight. */
          active?: number;
          /** Opacity for inactive comment highlight. */
          inactive?: number;
        };
        /**
         * Hover highlight color for comment marks.
         * @deprecated replaceWith=`--sd-comments-highlight-hover` removeIn=v3.0
         */
        highlightHoverColor?: string;
        /**
         * Track change highlight colors.
         * @deprecated replaceWith=`--sd-tracked-changes-*` CSS custom properties removeIn=v3.0
         */
        trackChangeHighlightColors?: {
          /** Border color for inserted text highlight. */
          insertBorder?: string;
          /** Background color for inserted text highlight. */
          insertBackground?: string;
          /** Border color for deleted text highlight. */
          deleteBorder?: string;
          /** Background color for deleted text highlight. */
          deleteBackground?: string;
          /** Border color for format change highlight. */
          formatBorder?: string;
        };
        /**
         * Active track change highlight colors (defaults to trackChangeHighlightColors).
         * @deprecated replaceWith=`--sd-tracked-changes-*` CSS custom properties removeIn=v3.0
         */
        trackChangeActiveHighlightColors?: {
          /** Active border color for inserted text highlight. */
          insertBorder?: string;
          /** Active background color for inserted text highlight. */
          insertBackground?: string;
          /** Active border color for deleted text highlight. */
          deleteBorder?: string;
          /** Active background color for deleted text highlight. */
          deleteBackground?: string;
          /** Active border color for format change highlight. */
          formatBorder?: string;
        };
        /**
         * Comments UI layout.
         * @deprecated replaceWith=`ui.comments.layout` removeIn=v3.0
         */
        displayMode?: 'auto' | 'sidebar' | 'inline';
        /**
         * CSS selector for an explicit width measurement target in auto mode.
         * @deprecated replaceWith=`ui.comments.responsive.target` removeIn=v3.0
         */
        compactMeasurementSelector?: string;
        /**
         * Optional fixed compact-mode breakpoint override in pixels.
         * @deprecated replaceWith=`ui.comments.responsive.breakpoint` removeIn=v3.0
         */
        compactBreakpointPx?: number;
      } & Record<string, unknown>);
  /**
   * Previous built-in AI Writer configuration.
   *
   * @deprecated replaceWith=`ui.toolbar.customItems` with application-owned model requests and `doc.insert` or `doc.replace` removeIn=v3.0
   */
  ai?: {
    /**
     * Harbour API key used by the previous built-in AI Writer.
     * @deprecated replaceWith=`credentials in your application-owned model integration` removeIn=v3.0
     */
    apiKey?: string;
    /**
     * Service endpoint used by the previous built-in AI Writer.
     * @deprecated replaceWith=`endpoint in your application-owned model integration` removeIn=v3.0
     */
    endpoint?: string;
  } & Record<string, unknown>;
  /** PDF module configuration. */
  pdf?: {
    /** Preloaded pdf.js library instance. */
    pdfLib: object;
    /** PDF.js worker source URL (falls back to CDN when omitted). */
    workerSrc?: string;
    /** Whether to auto-configure pdf.js worker. */
    setWorker?: boolean;
    /** Enable text layer rendering (default: false). */
    textLayer?: boolean;
    /** Canvas render scale (quality). */
    outputScale?: number;
  } & Record<string, unknown>;
  /** Collaboration module configuration. */
  collaboration?: CollaborationConfig;
  /**
   * Toolbar module configuration. Pass `true` to configure the toolbar with
   * defaults (equivalent to an empty object).
   *
   * This field configures the toolbar's contents and behavior; it does not by
   * itself provide a place to render it. A toolbar is only rendered once a
   * mount target resolves, from either `selector` here or the top-level
   * `Config.toolbar`. Without one, SuperDoc still creates the
   * `superdoc.toolbar` handle (item lookup and command routing keep working)
   * but renders no toolbar UI.
   *
   * Fallbacks to the top-level aliases are per field: `selector` falls back to
   * `Config.toolbar`, `icons` to `Config.toolbarIcons`, and `texts` to
   * `Config.toolbarTexts`. `Config.toolbarGroups` supplies the group ordering,
   * not `groups`: the two are different settings. `groups` maps group ids to
   * item ids (composition) and has no top-level alias, so omitting it uses the
   * built-in composition. Supplying it also replaces the group ordering with
   * its own keys.
   *
   * @deprecated replaceWith=`ui.toolbar` removeIn=v3.0
   */
  toolbar?:
    | boolean
    | ({
        /**
         * Selector for the DOM element to render the toolbar into: an id
         * selector (`#toolbar`), a class selector (`.toolbar`), or a bare
         * element id (`toolbar`). Must be a string, not an `HTMLElement`
         * reference — pass an element through the top-level `Config.toolbar`.
         * Falls back to `Config.toolbar` if omitted.
         */
        selector?: string;
        /** Toolbar item ids to hide from the default set. */
        excludeItems?: string[];
        /**
         * Object map of group id to item ids
         * (`{ left: [...], center: [...], right: [...] }`) that overrides the
         * default group composition. Default group ids are
         * `'left' | 'center' | 'right'`. To pass an ordered group-id array
         * (`['left', 'center', 'right']`) use the top-level `Config.toolbarGroups`
         * instead — the array form is not accepted here.
         */
        groups?: Record<string, string[]>;
        /** Icon overrides keyed by toolbar item id. Falls back to `Config.toolbarIcons`. */
        icons?: Record<string, unknown>;
        /** Text/label overrides keyed by toolbar item id. Falls back to `Config.toolbarTexts`. */
        texts?: Record<string, string>;
        /**
         * Custom font list rendered in the font-family dropdown.
         *
         * AIDEV-NOTE: legacy-public - accepts {@link FontFamilyConfig} entries
         * alongside dropdown rows. This spelling was typed `FontConfig[]`,
         * whose index signature let `{ family, label, key }` compile and work,
         * so narrowing it to rows alone would break installs mid-2.x.
         * Replaced by `ui.toolbar.fontOptions`, which takes rows only.
         * Earliest removal: v3.0 (#853).
         *
         * The runtime uses the list verbatim and reads `label` and `key` off
         * each entry, so a `family`-only entry renders a blank row either way.
         */
        fonts?: Array<FontConfig | ToolbarFontOption>;
        /** Hide buttons that overflow the available width (default: true). */
        hideButtons?: boolean;
        /** Recompute the visible toolbar item set on container resize (default: false). */
        responsiveToContainer?: boolean;
        /**
         * Custom toolbar buttons appended to the default item set.
         *
         * AIDEV-NOTE: legacy-public - stays an open record. This spelling was
         * typed `Array<Record<string, unknown>>`, so narrowing it now would
         * reject entries that compile and work today. Replaced by
         * `ui.toolbar.customItems`. Earliest removal: v3.0 (#853).
         */
        customButtons?: Array<Record<string, unknown>>;
        /**
         * Show the formatting marks (pilcrow) button in the toolbar. Off by
         * default. Distinct from `layoutEngineOptions.showFormattingMarks`, which
         * controls whether the marks render in the document.
         */
        showFormattingMarksButton?: boolean;
        /**
         * Show the table of contents insert button in the toolbar. Off by default.
         */
        showTableOfContentsButton?: boolean;
      } & Record<string, unknown>);
  /**
   * Link activation configuration.
   * @deprecated replaceWith=`hyperlinks.onActivate` removeIn=v3.0
   */
  links?: {
    /**
     * Custom resolver for the link click popover.
     * @deprecated replaceWith=`hyperlinks.onActivate` removeIn=v3.0
     */
    popoverResolver?: LinkPopoverResolver;
  } & Record<string, unknown>;
  /**
   * Context menu configuration under the previous module namespace.
   * @deprecated replaceWith=`ui.contextMenu` removeIn=v3.0
   */
  contextMenu?: ContextMenuConfig;
  /**
   * Context menu configuration under its previous module name.
   * @deprecated replaceWith=`ui.contextMenu` removeIn=v3.0
   */
  slashMenu?: ContextMenuConfig;
  /** Surface system configuration. */
  surfaces?: SurfacesModuleConfig;
  /** Track changes module configuration. */
  trackChanges?: TrackChangesModuleConfig;
  /**
   * Whiteboard module configuration. Pass `false` to disable the module
   * entirely; pass an object to opt in (with `enabled: true`) or to keep it
   * registered but inert (`enabled: false`, the default when no field is set).
   */
  whiteboard?: false | { enabled?: boolean };
}

/**
 * Identity of a tracked-change author, passed to a per-author color
 * {@link TrackChangesAuthorColorsConfig.resolve | resolver}. Mirrors the
 * author metadata SuperDoc carries on each tracked change.
 */
export interface TrackChangeAuthor {
  /** Author display name (from the OOXML `w:author` attribute). */
  name?: string;
  /** Author email, when available. */
  email?: string;
  /** Author avatar image URL, when available. */
  image?: string;
}

/**
 * Per-author tracked-change color configuration. Lets hosts assign a color
 * per author without injecting CSS `!important` rules against
 * `[data-track-change-author]` or reaching into private editor internals.
 *
 * Resolution order per author: `overrides` by identity (email first, then
 * name; exact match) → `resolve(author)` → a deterministic fallback color
 * derived from the author identity. The fallback guarantees imported /
 * discovered authors the host did not configure ahead of time still receive
 * a stable, distinct color.
 */
export interface TrackChangesAuthorColorsConfig {
  /** When `false`, per-author colors are not applied. Defaults to enabled. */
  enabled?: boolean;
  /**
   * Color overrides keyed by author identity. Both `email` and `name` keys
   * are supported (email is checked first); matching is exact.
   */
  overrides?: Record<string, string>;
  /**
   * Resolver consulted after `overrides`. Return a CSS color string, or
   * `undefined` to fall through to the deterministic fallback.
   */
  resolve?: (author: TrackChangeAuthor) => string | undefined;
}

/**
 * Semantic tracked-change color categories configurable through
 * {@link TrackChangesSemanticColorsConfig}. These color review roles: inserted
 * text, deleted text, moved-from/-to text, table cell insertion/deletion, cell
 * merge, and cell split, not authors. The same author can therefore receive
 * different colors for different review roles, which the author-identity path
 * cannot express.
 *
 * Whole-table, table-row, and table-split changes are NOT part of this config
 * surface: their paint colors are themed via the
 * `--sd-tracked-changes-table-*` CSS variables instead.
 *
 * Declared locally (mirroring the {@link TrackChangeAuthor} pattern) so the
 * published `superdoc` type graph never depends on the private
 * `@superdoc/contracts` specifier. Mirrors the
 * `TrackedChangeConfigurableSemanticColorKey` union in `@superdoc/contracts`.
 */
export type TrackedChangeSemanticColorKey =
  | 'insertion'
  | 'deletion'
  | 'move'
  | 'move-from'
  | 'move-to'
  | 'table-cell-insertion'
  | 'table-cell-deletion'
  | 'cell-merge'
  | 'cell-split';

/**
 * Input passed to a semantic tracked-change color
 * {@link TrackChangesSemanticColorsConfig.resolve | resolver} for a single
 * review role. `key` is always present; the remaining fields describe the
 * change being colored when SuperDoc knows them.
 */
export interface TrackedChangeSemanticColorResolverInput {
  /** Semantic category being colored. */
  key: TrackedChangeSemanticColorKey;
  /** Author identity, when known. Semantic colors are not author-derived. */
  author?: TrackChangeAuthor;
  /** Raw tracked-change type, when known. */
  type?: string;
  /** Logical subtype, when known. */
  subtype?: string;
  /** Target kind (e.g. text/cell/row/table), when known. */
  targetKind?: string;
  /** Scope of the semantic paint anchor, when known. */
  semanticAnchorScope?: string;
}

/**
 * Semantic tracked-change color configuration. The second
 * tracked-change color axis alongside {@link TrackChangesAuthorColorsConfig}:
 * `authorColors` colors by author identity, `semanticColors` colors review
 * roles (inserted text, deleted text, moved text, table cell
 * insertion/deletion, cell merge, cell split).
 *
 * Supported semantic colors are active by default. Word-like defaults apply with
 * no configuration: insertion blue, deletion red, and moved text green.
 * Resolution order per key: `overrides` by semantic key, `overrides.move` for
 * `move-from` / `move-to`, then `resolve(input)`, then the built-in default for
 * that key. Set `enabled: false` to suppress semantic colors and fall back to
 * existing author/broad defaults.
 *
 * Whole-table, table-row, and table-split paint colors are themed through the
 * `--sd-tracked-changes-table-*` CSS variables, not this config.
 *
 * This is separate from `modules.comments.trackChangeHighlightColors`, the
 * older broad insert/delete/format CSS-variable surface.
 */
export interface TrackChangesSemanticColorsConfig {
  /** When `false`, semantic colors are not applied. Defaults to enabled. */
  enabled?: boolean;
  /**
   * Color overrides keyed by semantic category (`'insertion'`, `'deletion'`,
   * `'move'`, `'move-from'`, `'move-to'`, `'table-cell-insertion'`,
   * `'table-cell-deletion'`, `'cell-merge'`, `'cell-split'`). `move` applies
   * to both move sides unless a side-specific override exists.
   */
  overrides?: Partial<Record<TrackedChangeSemanticColorKey, string>>;
  /**
   * Resolver consulted after `overrides`. Return a CSS color string, or
   * `undefined` to fall through to the built-in default for the key.
   */
  resolve?: (input: TrackedChangeSemanticColorResolverInput) => string | undefined;
}

export interface TrackChangesModuleConfig {
  /**
   * Whether tracked-change indicators are shown in viewing mode.
   * @deprecated replaceWith=`viewing.trackedChanges` compat-indefinitely=v2 configuration compatibility
   */
  visible?: boolean;
  /**
   * Rendering mode for tracked changes (see `TrackedChangesMode` in
   * `@superdoc/contracts`).
   * - 'review': show insertions and deletions inline (default for editing/suggesting)
   * - 'original': show the document as it existed before tracked changes (default for viewing when `visible` is false)
   * - 'final': show the document with changes applied
   * - 'off': disable tracked-change rendering
   *
   * @deprecated replaceWith=`viewing.trackedChanges` for viewer projection or `modules.trackChanges.enabled` to disable tracking compat-indefinitely=v2 configuration compatibility
   */
  mode?: 'review' | 'original' | 'final' | 'off';
  /** Whether the layout engine treats tracked changes as active. */
  enabled?: boolean;
  /**
   * How a tracked replacement (adjacent insertion + deletion created by typing
   * over selected text) surfaces in the UI and API.
   * - `'paired'` (default, Google Docs model): the two halves share one id
   *   and resolve together with a single accept/reject click.
   * - `'independent'` (Microsoft Word / ECMA-376 §17.13.5 model): each
   *   insertion and each deletion has its own id, is addressable on its own,
   *   and resolves independently.
   */
  replacements?: 'paired' | 'independent';
  /**
   * Per-author tracked-change colors. When configured, insert/delete/format
   * tracked-change highlights are tinted per author through the
   * `--sd-tracked-changes-*` CSS variable surface, and
   * `ui.trackChanges.getSnapshot()` exposes the resolved author colors.
   */
  authorColors?: TrackChangesAuthorColorsConfig;
  /**
   * Semantic (structural) tracked-change colors. Colors structural change
   * subtypes: moved text, table cell insertion/deletion, cell merge, and cell
   * split, independently of {@link authorColors}. Supported keys are active by
   * default; set `enabled: false` to fall back to existing author/broad
   * defaults. Separate from `modules.comments.trackChangeHighlightColors`.
   */
  semanticColors?: TrackChangesSemanticColorsConfig;
}

export type DocumentMode = 'editing' | 'viewing' | 'suggesting';

/**
 * Document view layout values — mirrors OOXML ST_View (ECMA-376 §17.18.102).
 * - 'print': Print Layout View — displays document as it prints (default)
 * - 'web': Web Page View — content reflows to fit container (mobile/accessibility)
 */
export type ViewLayout = 'print' | 'web';

/**
 * Document view options for controlling how the document is displayed.
 * Mirrors OOXML document view settings.
 */
export interface ViewOptions {
  /**
   * Document view layout (OOXML ST_View compatible). In the browser editor,
   * `'web'` selects the retained semantic DOM surface. Browser normal flow
   * rewraps content as the editor container changes width.
   */
  layout?: ViewLayout;
}

/** Surface where the edit originated. */
export type EditorSurface = 'body' | 'header' | 'footer';

export interface EditorUpdateEvent {
  /**
   * The primary editor associated with the update. For header/footer
   * edits, this is the main body editor. Optional because the runtime
   * payload builder falls back to `sourceEditor` and emits `undefined`
   * when neither is present (defensive in test/stub paths); consumers
   * should narrow before use.
   */
  editor?: Editor;
  /** The editor instance that emitted the update. For body edits, this matches `editor`. */
  sourceEditor?: Editor;
  /** The surface where the edit originated. */
  surface: EditorSurface;
  /**
   * Relationship ID for header/footer edits. Always present (the
   * runtime payload builder defaults to `null`); may be `null` for
   * body edits.
   */
  headerId: string | null;
  /**
   * Header/footer variant (`default`, `first`, `even`, `odd`) when
   * available. Always present (defaults to `null`); may be `null`.
   */
  sectionType: string | null;
}

/**
 * Payload emitted with the `ready` event and passed to `Config.onReady`.
 * Carries the live SuperDoc instance.
 */
export interface SuperDocReadyPayload {
  superdoc: SuperDoc;
}

/**
 * Payload emitted with the `editorCreate` / `editorBeforeCreate` /
 * `collaboration-ready` events and passed to the matching `Config.onX`
 * callbacks. The runtime always wraps the editor in this shape; bare
 * `Editor` references in earlier callback typings were incorrect.
 */
export interface SuperDocEditorPayload {
  editor: Editor;
}

/** Payload emitted when nonprinting formatting marks are shown or hidden. */
export interface SuperDocFormattingMarksChangePayload {
  /** Whether nonprinting formatting marks are visible. */
  showFormattingMarks: boolean;
  /** SuperDoc instance whose view changed. */
  superdoc: SuperDoc;
}

/** Payload emitted after `setDocumentMode()` changes the mode. */
export interface SuperDocDocumentModeChangePayload {
  /** Mode after role restrictions are applied. */
  documentMode: DocumentMode;
}

/** Payload passed when the built-in comments list is rendered or removed. */
export interface SuperDocCommentsListChangePayload {
  /** Whether the built-in comments list is currently rendered. */
  isRendered: boolean;
}

/** Document error passed to `Config.onContentError`. */
export interface SuperDocContentErrorPayload {
  /** Error reported while reading or updating the document. */
  error: unknown;
  /** Editor that reported the error. */
  editor: Editor;
  /** Document associated with the editor. */
  documentId: string;
  /** File or Blob associated with the document, when available. */
  file: globalThis.File | globalThis.Blob | null | undefined;
}

/** Payload passed to `Config.onPaginationUpdate` after a layout pass. */
export interface SuperDocPaginationUpdatePayload {
  /** Current number of pages. */
  totalPages: number;
  /** SuperDoc instance whose layout changed. */
  superdoc: SuperDoc;
}

/** Payload passed to the experimental `Config.onPageCountKnown` callback. */
export interface SuperDocPageCountKnownPayload {
  /** Current number of pages. */
  pageCount: number;
  /** Layout generation that reported the page count. */
  generation: number;
}

/** Result counts from an Accept All or Reject All tracked-change decision. */
export interface SuperDocTrackedChangesBulkDecisionPayload {
  /** Document that received the bulk decision. */
  documentId: string | null;
  /** Operation requested by the user. */
  decision: 'accept' | 'reject';
  /** Unique tracked changes considered by the operation. */
  requestedCount: number;
  /** Changes successfully decided by this operation. */
  successfulCount: number;
  /** Changes left open because the permission resolver denied them. */
  permissionDeniedCount: number;
}

/**
 * Payload emitted with `document-replaced`.
 *
 * `editor` is the editor whose replacement completed, not necessarily the one
 * active when the event is received: a replace is asynchronous, so the active
 * editor can move while it is in flight. A consumer must compare this against
 * the editor it is bound to and ignore anything else.
 *
 * Typed `unknown` rather than `Editor`: the active editor can be a v2 facade
 * that does not satisfy `Editor` (`getHTML` is required there and absent on the
 * facade), so annotating it as `Editor` would promise methods that are not
 * present. It is an identity token to compare, not an object to call.
 */
export interface SuperDocDocumentReplacedPayload {
  editor: unknown;
  /**
   * The host that rendered the replaced document.
   *
   * Carried because `editor` alone cannot be matched in the V2 browser path: a
   * successful replace emits its ready payload before `replaceFile()` resolves,
   * so the shell has already installed a NEW facade by the time this event
   * fires, and the captured facade is one the controller no longer holds. The
   * host survives that swap, so it is the identity that still lines up.
   */
  host: unknown;
}

/**
 * Payload emitted with the `locked` event and passed to
 * `Config.onLocked`. `lockedBy` is non-optional because the runtime
 * always includes the key (`lockSuperdoc` defaults `lockedBy` to
 * `null`); the value may be `User | null` because unlocking and
 * unattributed locks both pass `null`.
 */
export interface SuperDocLockedPayload {
  isLocked: boolean;
  lockedBy: User | null;
}

/**
 * Payload emitted with the `awareness-update` event and passed to
 * `Config.onAwarenessUpdate`. Field set differs from older inline
 * declarations: the runtime emits `superdoc` (not `context`) and
 * includes `added` / `removed` client-id arrays alongside `states`.
 */
export interface SuperDocAwarenessUpdatePayload {
  states: AwarenessState[];
  added: number[];
  removed: number[];
  superdoc: SuperDoc;
}

/**
 * Payload emitted with the `comments-update` event and passed to
 * `Config.onCommentsUpdate`. Field set differs from older inline
 * declarations: the runtime emits `comment?` and `changes?` (never a
 * `data` field).
 */
export interface SuperDocCommentsUpdatePayload {
  /** Update kind (e.g. `'created'`, `'updated'`, `'deleted'`); set by the comments store. */
  type: string;
  /** The comment object the update refers to, when applicable. */
  comment?: Comment;
  /** Per-field change set when the update is a mutation. */
  changes?: Array<{ key: string; commentId: string; fileId?: string | null }>;
  /**
   * The Document API selection snapshot captured at the moment a
   * `'pending'` comment was started, before the pending mark is
   * inserted (which clears the live DOM selection). Present only on the
   * `'pending'` event. When it has a `target`, forward it straight to
   * `ui.comments.createFromCapture(pendingSelection, { text })` to build
   * the comment from a custom composer without tracking the selection
   * yourself ahead of the floating-bubble click.
   *
   * `null` means the pending comment did not start from an addressable
   * SuperDoc editor text selection, or the active editor/selection API was
   * unavailable. PDF and other non-SuperDoc editor selections emit `null`.
   * Empty SuperDoc editor selections can still yield a `SelectionInfo` with
   * `target: null`.
   */
  pendingSelection?: SelectionInfo | null;
}

export interface EditorTransactionLike {
  readonly docChanged?: boolean;
  readonly doc?: {
    readonly content?: { readonly size?: number };
    nodesBetween?: (
      from: number,
      to: number,
      callback: (node: {
        readonly type?: { readonly name?: string };
        readonly attrs?: Record<string, unknown>;
        readonly marks?: ReadonlyArray<{
          readonly type?: { readonly name?: string };
          readonly attrs?: Record<string, unknown>;
        }>;
      }) => false | void | undefined,
    ) => void;
  };
  readonly mapping?: {
    readonly maps?: ReadonlyArray<{
      forEach(callback: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void): void;
    }>;
    slice?(from: number): {
      map(position: number, assoc?: number): number;
    };
  };
  getMeta?(key: unknown): unknown;
}

export interface EditorTransactionEvent {
  /** The primary editor associated with the transaction. For header/footer edits, this is the main body editor. */
  editor: Editor;
  /** The editor instance that emitted the transaction. For body edits, this matches `editor`. */
  sourceEditor: Editor;
  /** The editor transaction emitted by the source editor. */
  transaction: EditorTransactionLike;
  /** Time spent applying the transaction, in milliseconds. */
  duration?: number;
  /** The surface where the transaction originated. */
  surface: EditorSurface;
  /** Relationship ID for header/footer edits. */
  headerId?: string | null;
  /** Header/footer variant (`default`, `first`, `even`, `odd`) when available. */
  sectionType?: string | null;
}

/** A content control reported by an Editor interaction callback. */
export interface ContentControlRef {
  /** Content-control id from the DOCX. */
  id: string;
  /** Content-control tag, when the DOCX defines one. */
  tag?: string;
  /** Display name from the DOCX, when defined. */
  alias?: string;
  /** Content-control type, such as `text`, `checkbox`, or `date`. */
  controlType: ContentControlType;
  /** Whether the control is inline or contains one or more blocks. */
  scope: 'inline' | 'block';
}

/**
 * Previous content-control reference shape.
 * @deprecated replaceWith=`ContentControlRef` compat-indefinitely=v2 event payload compatibility
 */
export interface SdtRef {
  id: string;
  tag?: string;
  alias?: string;
  controlType: string;
  scope: 'inline' | 'block';
}

/** Details reported when the active content-control path changes. */
export interface ContentControlActiveChangePayload {
  /** Innermost active content control, or `null` outside a control. */
  active: ContentControlRef | null;
  /** Previously active innermost content control, or `null`. */
  previous: ContentControlRef | null;
  /**
   * Active content-control stack, innermost first. `active` is
   * `activePath[0]`. Empty when the selection is outside a content control.
   */
  activePath: ContentControlRef[];
  /** Reported source of the selection change. */
  source: 'keyboard' | 'pointer';
}

/** Details reported when someone clicks inside a content control. */
export interface ContentControlClickPayload {
  /** Innermost clicked content control. */
  target: ContentControlRef;
  /** Content-control clicks always originate from a pointer. */
  source: 'pointer';
}

export interface SuperDocLayoutEngineOptions {
  /**
   * Layout engine flow mode.
   * - 'paginated': standard page-first layout (default)
   * - 'semantic': continuous semantic flow without visible pagination boundaries
   */
  flowMode?: 'paginated' | 'semantic';
  /**
   * Optional override for paginated track-changes rendering.
   * @deprecated replaceWith=`viewing.trackedChanges` and `modules.trackChanges.enabled` compat-indefinitely=v2 configuration compatibility
   */
  trackedChanges?: object;
  /**
   * Page virtualization options for paginated layout. Defaults to
   * `{ enabled: true, window: 5, overscan: 1 }` to render only the visible
   * window of pages plus a small overscan buffer.
   */
  virtualization?: {
    /** Whether virtualization is active (default: true). */
    enabled?: boolean;
    /** Number of pages kept rendered around the active page (default: 5). */
    window?: number;
    /** Extra pages rendered outside the active window for smoother scrolling (default: 1). */
    overscan?: number;
  };
  /**
   * Whether bookmark indicators are shown in the rendered layout. Toggleable
   * at runtime via `superdoc.setShowBookmarks()`.
   */
  showBookmarks?: boolean;
  /**
   * Whether nonprinting formatting marks are shown in the rendered layout.
   * Toggleable at runtime via `superdoc.setShowFormattingMarks()`.
   */
  showFormattingMarks?: boolean;
  /**
   * Whether the V2 mounted body paints progressively from an initial window.
   * Defaults to `true`.
   *
   * @experimental Diagnostic posture, not a supported product mode and not a
   * pipeline bypass: both settings route through the same canonical
   * render-pipeline engine. `true` (default) paints an initial window and
   * (the canonical initial-render and incremental engine
   * passes); `false` makes EVERY mounted repaint wait for complete source
   * coverage and materialize the full body before painting — not only the
   * first paint — via the exact-complete engine pass, which can be much
   * slower than progressive streaming on large documents. Failures fail
   * closed: the mount/repaint promise rejects with a named
   * `render.complete-before-first-paint-*` error and the host records a
   * render-readiness diagnostic. The render surface has no independent
   * first-paint timeout; callers and harnesses must provide their own.
   */
  /**
   * P6a: per-paint work-counter HUD (console table +
   * `data-v2-paint-hud-recent`) and the dark reuse-collapse tripwire for the
   * windowed paint owner (since P7, vertical-paginated flow's only paint
   * path — no flag needed).
   *
   * @experimental Dev/verification instrument.
   */
  paintHud?: boolean;
}

/** @deprecated replaceWith=`ViewingOptions` compat-indefinitely=v2 configuration compatibility */
export interface ViewingVisibilityConfig {
  visible?: boolean;
}

export type ViewingTrackedChangesMode = 'original' | 'markup' | 'final';

/** What review information is shown when `documentMode` is `viewing`. */
export interface ViewingOptions {
  /** Show comment anchors and threads. Defaults to `false`. */
  comments?: boolean;
  /** Show the original document, change markup, or the proposed final result. Defaults to `original`. */
  trackedChanges?: ViewingTrackedChangesMode;
}

export interface SuperDocTelemetryConfig {
  /** Whether to send a document-open event each time a DOCX becomes ready. */
  enabled: boolean;
  /** Destination for document-open events. Defaults to SuperDoc's telemetry endpoint. */
  endpoint?: string;
  /** Application-defined metadata serialized with each request. */
  metadata?: Record<string, unknown>;
  /**
   * Previous location for the license key.
   * @deprecated replaceWith=`Config.licenseKey` removeIn=v3.0
   */
  licenseKey?: string;
}

/**
 * Exception payload raised by the SuperDoc store during document
 * initialization (empty entry, init failure, normalization error).
 * Always carries `stage: 'document-init'` and the offending document
 * config (`null`/`undefined` when the entry itself was empty).
 *
 * `error` is `unknown` because the catch path in `initializeDocuments`
 * forwards the raw caught value (`catch (e) { emitException({ error: e,
 * ... }) }`) and thrown values can be anything in JS. The other two
 * emit sites construct `new Error(...)`, but consumers must narrow
 * before reading `.message`.
 */
export interface SuperDocExceptionStorePayload {
  error: unknown;
  stage: 'document-init';
  document: Document | null | undefined;
}

/**
 * Exception payload raised when restoring SuperDoc state from a
 * persisted source fails. Carries the document the runtime tried to
 * restore.
 */
export interface SuperDocExceptionRestorePayload {
  error: unknown;
  document: Document;
}

/**
 * Exception payload raised by the underlying editor lifecycle (load,
 * encryption-prompt, command failures, etc.). `code` is set when the
 * editor maps the failure to a known kind (e.g. `'password-required'`).
 * `editor` is `Editor | null | undefined` because the password-prompt
 * re-emit path forwards `originalException?.editor ?? null`, so
 * consumers may receive `null` (not just `undefined`).
 */
export interface SuperDocWorkerFailureDetail {
  phase: string;
  reason: string;
  beforeHello: boolean;
  message: string;
  elapsedMs?: number;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

export interface SuperDocExceptionEditorPayload {
  error: unknown;
  editor?: Editor | null;
  code?: string;
  documentId?: string | null;
  /** Structured browser-worker failure detail when editor startup failed in its worker transport. */
  workerFailure?: SuperDocWorkerFailureDetail;
}

/** Connection failure while opening a collaboration room, reported through `onException`. */
export interface SuperDocExceptionCollaborationPayload extends SuperDocExceptionEditorPayload {
  error: Error;
  code: 'collaboration-access-denied' | 'collaboration-connection-failed' | 'collaboration-sync-timeout';
  /** Access denial requires an explicit provider rejection; a timeout is not proof of denied access. */
  collaborationReason: 'access-denied' | 'connection-failed' | 'sync-timeout';
  editor: null;
}

/**
 * Exception payload raised by the built-in toolbar.
 *
 * Emitted for a command that failed and for a custom entry the toolbar could
 * not build, in which case `itemName` is the entry that was skipped and the
 * message names the field that would fix it. Reaches the host as well as the
 * toolbar, because entries are built inside the toolbar constructor and
 * nothing can have subscribed to the toolbar yet.
 */
export interface SuperDocExceptionToolbarPayload {
  error: Error;
  /** The value originally thrown, before it was normalized to an `Error`. */
  originalError: unknown;
  /** The toolbar item involved, or `null` when the entry had no usable name. */
  itemName: string | null;
  editor?: Editor | null;
}

/** Exception raised by hyperlink activation or a custom hyperlink renderer. */
export interface SuperDocExceptionHyperlinkPayload {
  error: Error;
  editor?: Editor | null;
  source:
    | 'hyperlinks.onActivate'
    | 'hyperlinks.onActivate.render'
    | 'linkPopoverResolver'
    | 'linkPopoverExternalRender';
}

/**
 * Stable, public diagnostic taxonomy code. Additive: new members may be
 * appended in a minor release, so consumers should not assume this list is
 * exhaustive.
 */
export type SuperDocDiagnosticCode = 'PARSE_ERROR' | 'RENDER_ERROR' | 'UNSUPPORTED_FEATURE' | 'PERFORMANCE_ERROR';

/**
 * Document-processing pipeline stage a diagnostic was raised from. `layout`
 * is reserved for future use; `unzip`, `parse`, `render`, and `export` are
 * emitted today.
 */
export type SuperDocDiagnosticStage = 'unzip' | 'parse' | 'layout' | 'render' | 'export';

/**
 * Exception payload carrying a structured diagnostic translated from an
 * internal v2-kernel diagnostic (package-open, render-readiness, or a boot
 * failure). Emitted in addition to, not instead of, the legacy payload a
 * given failure already produces (e.g. `SuperDocExceptionEditorPayload` for
 * boot failures) — a single incident may raise both.
 *
 * `internalCode` is the raw, ungoverned internal code string (e.g.
 * `'PKG-payload-zip-entries-exceeded'`, `'render.scheduler-degraded'`) kept
 * for debugging; it is not part of the stable taxonomy and may change
 * between versions without notice.
 *
 * The pipeline stage is named `diagnosticStage`, not `stage` --
 * `SuperDocExceptionStorePayload` already uses `stage: 'document-init'` as
 * its narrowing discriminant, and reusing the same property name here (even
 * with a disjoint value type) would make `'stage' in payload` match this
 * member too, silently misclassifying diagnostic payloads as store-init
 * failures for any consumer written before this member existed.
 */
export interface SuperDocExceptionDiagnosticPayload {
  error: unknown;
  diagnosticCode: SuperDocDiagnosticCode;
  diagnosticStage: SuperDocDiagnosticStage;
  severity: 'warn' | 'error';
  internalCode: string;
  documentId?: string | null;
  editor?: Editor | null;
  message: string;
}

/**
 * Union of all `exception` event payloads SuperDoc emits at runtime.
 * Consumers can narrow with `'stage' in payload` (store init),
 * `'code' in payload` (editor lifecycle), `'itemName' in payload`
 * (built-in toolbar), `'source' in payload` (hyperlink activation),
 * `'collaborationReason' in payload` (collaboration connection),
 * or `'diagnosticCode' in payload` (structured diagnostic).
 *
 * The union exists today because multiple independent emit sites pre-date a
 * shared error contract. Normalizing them to a single payload shape is a
 * separate follow-up; consumers can narrow with the `in` checks above in the
 * meantime.
 */
export type SuperDocExceptionPayload =
  | SuperDocExceptionStorePayload
  | SuperDocExceptionRestorePayload
  | SuperDocExceptionEditorPayload
  | SuperDocExceptionCollaborationPayload
  | SuperDocExceptionToolbarPayload
  | SuperDocExceptionHyperlinkPayload
  | SuperDocExceptionDiagnosticPayload;

/**
 * Zoom mode. `manual` holds whatever value was last set; `fit-width`
 * continuously recomputes the zoom that fits the page width into the
 * available container width. Calling `setZoom()` switches to
 * `manual`; `setZoomMode('fit-width')` re-enters fitting.
 */
export type SuperDocZoomMode = 'manual' | 'fit-width';

/**
 * Measurement unit for rulers and measurement fields (Word's "measurement
 * units" preference). `in` = inches, `cm` = centimetres. Set the starting unit
 * with `Config.measurementUnit`; change it at runtime with `setMeasurementUnit()`.
 */
export type SuperDocMeasurementUnit = 'in' | 'cm';

/**
 * Payload emitted with the `measurement-unit-change` event. Fires when
 * `setMeasurementUnit()` changes the document-wide ruler/measurement unit.
 */
export interface SuperDocMeasurementUnitChangePayload {
  /** The measurement unit now in effect. */
  unit: SuperDocMeasurementUnit;
}

/** Details reported after a ruler drag changes a section's page margins. */
export interface SuperDocPageMarginsChangePayload {
  /** Document whose margins changed. */
  documentId: string;
  /** Editor version that applied the change. */
  editorVersion: 2;
  /** Stable ID of the section whose margins changed. */
  sectionId: string;
  /** Zero-based index of the section whose margins changed. */
  sectionIndex: number;
  /** Margin handle that moved. */
  side: 'left' | 'right';
  /** New value of the moved margin, in inches. */
  value: number;
  /** Current page margins for the section, in inches. */
  pageMargins: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

/**
 * Payload emitted with the `zoomChange` event and passed to
 * `Config.onZoomChange`. Fires for every zoom source: `setZoom()`,
 * the toolbar zoom control, and fit-width adjustments.
 */
export interface SuperDocZoomPayload {
  /** The zoom level as a percentage (e.g. 100, 150). */
  zoom: number;
  /** The zoom mode that produced this value. */
  mode: SuperDocZoomMode;
}

/**
 * Payload emitted with the `viewport-change` event and passed to
 * `Config.onViewportChange`. The event fires when the implied fit
 * changes: the rounded `fitZoom` or the rounded base page width.
 * Pixel-level `availableWidth` movement that cannot change any fit
 * decision does not emit; read `getViewportMetrics()` for the
 * always-latest measurements. These are pure measurements:
 * `zoom.fitWidth` policy options (`min`, `max`, `padding`) do not
 * affect them. For the common case, prefer `zoom.mode: 'fit-width'`,
 * which applies a clamped fit automatically.
 */
export interface SuperDocViewportChangePayload {
  /**
   * Width available to the document in pixels: the measured container
   * width minus the comments sidebar when it is visible.
   */
  availableWidth: number;
  /** Widest document page width in pixels at 100% zoom. */
  documentWidth: number;
  /** Zoom percentage that fits the document in the available width (unclamped, padding-free). Clamp before applying. */
  fitZoom: number;
}

/**
 * Latest viewport measurements, readable at any time via
 * `superdoc.getViewportMetrics()`. Same shape as the
 * `viewport-change` payload and refreshed on every measurement
 * (including pixel-level changes the deduped event skips); `null`
 * until the first measurement (editors still mounting).
 */
export type SuperDocViewportMetrics = SuperDocViewportChangePayload;

/**
 * Options for the `fit-width` zoom mode. `min`/`max` clamp the
 * applied zoom percentage; `padding` reserves horizontal space
 * inside the available width before computing the applied fit.
 * These shape the applied policy only, never the reported metrics.
 */
export interface SuperDocFitWidthOptions {
  /** Lower bound for the applied zoom percentage (default: 10). */
  min?: number;
  /**
   * Upper bound for the applied zoom percentage (default: 100, so
   * fitting never enlarges the document past its natural size; raise
   * it to let wide containers scale the page up).
   */
  max?: number;
  /** Horizontal padding in pixels reserved inside the available width before computing the fit (default: 0). */
  padding?: number;
}

/**
 * Snapshot of the current zoom state, readable via
 * `superdoc.getZoomState()`.
 */
export interface SuperDocZoomState {
  /** Current zoom mode. */
  mode: SuperDocZoomMode;
  /** Current zoom value as a percentage. */
  value: number;
  /** Latest computed fit zoom (unclamped), or `null` before the first viewport measurement. */
  fitZoom: number | null;
  /** Effective lower bound the fit policy applies (config or default). */
  min: number;
  /** Effective upper bound the fit policy applies (config or default). */
  max: number;
}

/**
 * Options for `Config.zoom`: the initial zoom level, the starting
 * mode, and the fit-width policy bounds. Runtime control stays on
 * the instance: `setZoom()` (switches to manual), `setZoomMode()`,
 * `getZoomState()`, `getViewportMetrics()`, and the `zoomChange` /
 * `viewport-change` events.
 */
export interface SuperDocZoomConfig {
  /**
   * Initial zoom level as a percentage (default: 100). Applied before
   * the first paint, so the document renders directly at this zoom
   * with no visible jump. In `fit-width` mode this is the paint zoom
   * until the first fit computes. Invalid values (non-finite or <= 0)
   * are ignored with a console warning.
   */
  initial?: number;
  /**
   * Starting zoom mode (default: `'manual'`). In `'fit-width'` the
   * document continuously re-fits to the available container width;
   * the fit is applied through the normal zoom pipeline, so
   * `zoomChange` fires for every adjustment.
   */
  mode?: SuperDocZoomMode;
  /** Bounds and padding for the `fit-width` policy. */
  fitWidth?: SuperDocFitWidthOptions;
}

/** The three regions rendered by the built-in toolbar. */
export type ToolbarRegion = 'left' | 'center' | 'right';

/** Built-in controls accepted by `ui.toolbar.items` and `excludeItems`. */
export type ToolbarItemId =
  | 'undo'
  | 'redo'
  | 'track-changes-accept-selection'
  | 'track-changes-reject-selection'
  | 'search'
  | 'zoom'
  | 'font-family'
  | 'font-size'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'text-color'
  | 'highlight-color'
  | 'link'
  | 'image'
  | 'table-of-contents'
  | 'table'
  | 'table-actions'
  | 'text-align'
  | 'bullet-list'
  | 'numbered-list'
  | 'indent-decrease'
  | 'indent-increase'
  | 'line-height'
  | 'linked-style'
  | 'ruler'
  | 'measurement-unit'
  | 'formatting-marks'
  | 'copy-format'
  | 'clear-formatting'
  | 'ai'
  | 'document-mode';

/** Controls that `includeItems` can add to the default toolbar. */
export type ToolbarOptionalItemId = 'formatting-marks' | 'table-of-contents';

/** Slots whose built-in toolbar icon can be replaced. */
export type ToolbarIconId =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'text-color'
  | 'link'
  | 'image'
  | 'table-of-contents'
  | 'align-left'
  | 'align-right'
  | 'align-center'
  | 'align-justify'
  | 'bullet-list'
  | 'numbered-list'
  | 'indent-decrease'
  | 'indent-increase'
  | 'track-changes-accept-selection'
  | 'track-changes-reject-selection'
  | 'document-mode'
  | 'document-mode-editing'
  | 'document-mode-suggesting'
  | 'document-mode-viewing'
  | 'overflow'
  | 'ruler'
  | 'linked-style'
  | 'highlight-color'
  | 'ai'
  | 'table'
  | 'table-actions'
  | 'split-cell'
  | 'merge-cells'
  | 'insert-row-before'
  | 'insert-row-after'
  | 'insert-column-before'
  | 'insert-column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'
  | 'remove-borders'
  | 'fix-tables'
  | 'line-height'
  | 'search'
  | 'formatting-marks'
  | 'copy-format'
  | 'clear-formatting';

/** Text slots whose built-in label or tooltip can be replaced. */
export type ToolbarStringId =
  | 'bold'
  | 'font-family'
  | 'ai'
  | 'font-size'
  | 'italic'
  | 'underline'
  | 'highlight-color'
  | 'strikethrough'
  | 'text-color'
  | 'search'
  | 'link'
  | 'image'
  | 'table-of-contents'
  | 'table'
  | 'table-actions'
  | 'insert-row-before'
  | 'insert-row-after'
  | 'insert-column-before'
  | 'insert-column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'
  | 'remove-borders'
  | 'merge-cells'
  | 'split-cell'
  | 'fix-tables'
  | 'text-align'
  | 'bullet-list'
  | 'numbered-list'
  | 'indent-decrease'
  | 'indent-increase'
  | 'zoom'
  | 'measurement-unit'
  | 'undo'
  | 'redo'
  | 'track-changes-accept-selection'
  | 'track-changes-reject-selection'
  | 'clear-formatting'
  | 'copy-format'
  | 'line-height'
  | 'linked-style-label'
  | 'ruler'
  | 'formatting-marks'
  | 'linked-style'
  | 'document-mode-editing'
  | 'document-mode-suggesting'
  | 'document-mode-viewing'
  | 'document-mode-editing-description'
  | 'document-mode-suggesting-description'
  | 'document-mode-viewing-description';

/** One selectable option in a custom toolbar dropdown. */
export interface ToolbarCustomOption {
  /** Stable option identity. Also used as the selected value when `value` is omitted. */
  id: string;
  /** Text shown in the dropdown. */
  label: string;
  /** Value passed to the item's action. Defaults to `id`. */
  value?: string | number;
  /** Trusted inline SVG markup shown beside the label. */
  icon?: string;
  /** Prevent this option from being selected. */
  disabled?: boolean;
}

/** Context passed to a custom toolbar item's `onSelect` callback. */
export interface ToolbarCustomItemSelectContext extends Omit<CustomCommandContext, 'payload'> {
  /** The selected dropdown value, or `undefined` for a button. */
  value?: string | number;
  /** The selected dropdown option, or `undefined` for a button. */
  option?: ToolbarCustomOption;
}

/** A callback invoked when a custom toolbar item is selected. */
export type ToolbarCustomItemSelectHandler = (context: ToolbarCustomItemSelectContext) => unknown;

interface ToolbarCustomItemAttributes {
  /** Class added to the rendered control. */
  className?: string;
  /** Accessible name for the rendered control. */
  ariaLabel?: string;
}

interface ToolbarCustomItemBase {
  /** Unique id that must not match a built-in control or another custom item. */
  id: string;
  /** Toolbar region. Defaults to `center`. */
  region?: ToolbarRegion;
  /** Tooltip text. */
  tooltip?: string;
  /** Disable the control. */
  disabled?: boolean;
  /**
   * Width preset used by both rendering and responsive overflow.
   * Defaults to `default`.
   */
  size?: 'compact' | 'default' | 'wide';
  /** DOM hooks for styling and accessible naming. */
  attributes?: ToolbarCustomItemAttributes;
}

/** Built-in commands a custom button can run without a payload. */
export type ToolbarCustomButtonCommandId =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'undo'
  | 'redo'
  | 'acceptChange'
  | 'rejectChange'
  | 'acceptAllChanges'
  | 'rejectAllChanges'
  | 'track-changes-accept-selection'
  | 'track-changes-reject-selection'
  | 'zoom-fit-width'
  | 'bullet-list'
  | 'numbered-list'
  | 'indent-increase'
  | 'indent-decrease'
  | 'direction-ltr'
  | 'direction-rtl'
  | 'clear-formatting'
  | 'table-of-contents-insert'
  | 'table-add-row-before'
  | 'table-add-row-after'
  | 'table-delete-row'
  | 'table-add-column-before'
  | 'table-add-column-after'
  | 'table-delete-column'
  | 'table-delete'
  | 'table-merge-cells'
  | 'table-split-cell'
  | 'table-remove-borders'
  | 'ruler'
  | 'formatting-marks'
  | 'copy-format';

/** Built-in commands a custom dropdown can run with a string or number value. */
export type ToolbarCustomDropdownCommandId =
  | 'font-family'
  | 'font-size'
  | 'zoom'
  | 'document-mode'
  | 'measurement-unit'
  | 'text-color'
  | 'highlight-color'
  | 'link'
  | 'text-align'
  | 'line-height'
  | 'linked-style'
  | 'acceptChange'
  | 'rejectChange'
  | 'track-changes-accept-selection'
  | 'track-changes-reject-selection';

type ToolbarCustomButtonAction =
  | {
      /** Built-in command that needs no payload. */
      command: ToolbarCustomButtonCommandId;
      onSelect?: never;
    }
  | {
      command?: never;
      /** Callback to run when selected. */
      onSelect: ToolbarCustomItemSelectHandler;
    };

type ToolbarCustomDropdownAction =
  | {
      /** Built-in command that accepts the selected string or number value. */
      command: ToolbarCustomDropdownCommandId;
      onSelect?: never;
    }
  | {
      command?: never;
      /** Callback for registered commands and workflows that need a structured payload. */
      onSelect: ToolbarCustomItemSelectHandler;
    };

type ToolbarCustomItemTrigger =
  | {
      /** Text shown in the control. */
      label: string;
      /** Trusted inline SVG markup shown beside the label. */
      icon?: string;
    }
  | {
      label?: never;
      /** Trusted inline SVG markup shown in the control. */
      icon: string;
      /** An icon-only control needs an accessible name. */
      attributes: ToolbarCustomItemAttributes & { ariaLabel: string };
    };

/** A custom action button in the built-in toolbar. */
export type ToolbarCustomButtonConfig = ToolbarCustomItemBase &
  ToolbarCustomItemTrigger &
  ToolbarCustomButtonAction & {
    type: 'button';
  };

/** A custom dropdown in the built-in toolbar. */
export type ToolbarCustomDropdownConfig = ToolbarCustomItemBase &
  ToolbarCustomItemTrigger &
  ToolbarCustomDropdownAction & {
    type: 'dropdown';
    /** Options shown when the dropdown opens. */
    options: readonly ToolbarCustomOption[];
    /** Draw a caret beside the trigger. */
    hasCaret?: boolean;
    /** Initial option value. Uses the option's `id` when its `value` is omitted. */
    selectedValue?: string | number;
  };

/** A visual divider between toolbar controls. */
export interface ToolbarCustomSeparatorConfig extends Pick<ToolbarCustomItemBase, 'id' | 'region'> {
  type: 'separator';
}

/** An application-defined entry rendered in the built-in toolbar. */
export type ToolbarCustomItem = ToolbarCustomButtonConfig | ToolbarCustomDropdownConfig | ToolbarCustomSeparatorConfig;

type ToolbarLegacyItemId =
  | 'fontFamily'
  | 'fontSize'
  | 'strike'
  | 'highlight'
  | 'color'
  | 'tableOfContents'
  | 'tableActions'
  | 'textAlign'
  | 'list'
  | 'numberedlist'
  | 'indentleft'
  | 'indentright'
  | 'lineHeight'
  | 'linkedStyles'
  | 'measurementUnit'
  | 'formattingMarks'
  | 'copyFormat'
  | 'clearFormatting'
  | 'documentMode'
  | 'acceptTrackedChangeBySelection'
  | 'rejectTrackedChangeOnSelection';

/** Startup options for the built-in toolbar rendered by `ui.toolbar`. */
export interface ToolbarConfig {
  /**
   * Where to render the toolbar: an element, an id selector (`#toolbar`), a
   * class selector (`.toolbar`), or a bare element id. Other CSS selector
   * syntax resolves to nothing.
   */
  container?: string | HTMLElement;
  /** Built-in controls to render by region. Controls keep their built-in order. Omit to use the default toolbar. */
  items?: Readonly<Partial<Record<ToolbarRegion, readonly ToolbarItemId[]>>>;
  /**
   * Which groups render, or which items they contain.
   *
   * An array selects groups. The built-in layout still places them in its
   * left, center, and right regions, and always renders the center region.
   *
   * An object maps each group to its toolbar item ids. Its keys choose the
   * regions and its values form a grouped allowlist.
   * @deprecated replaceWith=`ui.toolbar.items` removeIn=v3.0
   */
  groups?: readonly string[] | Readonly<Record<string, readonly string[]>>;
  /** Controls to remove. Also accepts the id of a custom item. */
  excludeItems?: readonly (ToolbarItemId | ToolbarLegacyItemId | (string & {}))[];
  /** Trusted inline SVG overrides keyed by public icon id. */
  icons?: Readonly<Partial<Record<ToolbarIconId, string>> & Record<string, unknown>>;
  /** Text overrides keyed by public string id. */
  strings?: Readonly<Partial<Record<ToolbarStringId, string>>>;
  /**
   * Text overrides keyed by the internal toolbar id.
   * @deprecated replaceWith=`ui.toolbar.strings` removeIn=v3.0
   */
  texts?: Readonly<Record<string, unknown>>;
  /** How the toolbar handles controls that no longer fit (default: `'menu'`). */
  overflow?: 'menu' | 'visible';
  /**
   * Move controls that do not fit into the overflow menu.
   * @deprecated replaceWith=`ui.toolbar.overflow` removeIn=v3.0
   */
  hideButtons?: boolean;
  /** Width source used to lay out the toolbar (default: `'viewport'`). */
  responsiveTo?: 'container' | 'viewport';
  /**
   * Measure available width from the toolbar container instead of the viewport.
   * @deprecated replaceWith=`ui.toolbar.responsiveTo` removeIn=v3.0
   */
  responsiveToContainer?: boolean;
  /** Options shown in the font-family dropdown. Register loadable fonts through `fonts.families`. */
  fontOptions?: readonly ToolbarFontFamilyOption[];
  /**
   * Rows for the font-family dropdown. Register loadable font families through
   * `fonts.families` instead.
   * @deprecated replaceWith=`ui.toolbar.fontOptions` removeIn=v3.0
   */
  fonts?: readonly ToolbarFontOption[];
  /** Application-defined controls and separators to add. */
  customItems?: readonly ToolbarCustomItem[];
  /**
   * Application-defined entries appended to the built-in controls.
   * @deprecated replaceWith=`ui.toolbar.customItems` removeIn=v3.0
   */
  customButtons?: readonly ToolbarCustomButton[];
  /** Additional opt-in controls. With `items`, each uses its built-in region unless already listed. */
  includeItems?: readonly ToolbarOptionalItemId[];
  /**
   * Show the formatting-marks button (default: false). This does not decide
   * whether formatting marks are visible in the document.
   * @deprecated replaceWith=`ui.toolbar.includeItems` removeIn=v3.0
   */
  showFormattingMarksButton?: boolean;
  /**
   * Show the table-of-contents button (default: false).
   * @deprecated replaceWith=`ui.toolbar.includeItems` removeIn=v3.0
   */
  showTableOfContentsButton?: boolean;
}

/**
 * Per-surface built-in UI configuration. Every field is optional; an omitted
 * field keeps that surface's historical default rather than inheriting from
 * its siblings, so a partial config only changes what it names.
 *
 * `false` disables a surface, `true` enables it with defaults, and an options
 * object both enables and configures it.
 *
 * @see {@link Config.ui}
 */
export interface UIConfig {
  /**
   * Built-in toolbar. Enabled by default, but a toolbar only appears once
   * `container` resolves to an element — enabling it without one creates the
   * `superdoc.toolbar` handle and renders nothing.
   */
  toolbar?: boolean | ToolbarConfig;
  /** Built-in comments UI. Enabled by default. */
  comments?: boolean | CommentsConfig;
  /** Built-in right-click and slash context menu. Enabled by default. */
  contextMenu?: boolean | ContextMenuConfig;
  /**
   * Built-in loading overlay shown while a document opens. Enabled by default.
   * Set to `false` to show your own loading UI instead.
   *
   * This only decides whether SuperDoc draws the overlay. It does not change
   * how long a document takes to open, and it does not affect loading UI the
   * host renders (such as `renderLoading` in `@superdoc/react`).
   *
   * The built-in overlay also masks the document while it opens. Turning it
   * off hands that responsibility to your UI: keep yours up until `onReady`,
   * and around a replacement await `superdoc.replaceFile(...)`.
   */
  loading?: boolean;
  /**
   * Built-in Search surface. Disabled by default. Enabling it lets
   * SuperDoc intercept Cmd+F / Ctrl+F; `superdoc.ui.search` stays available to
   * custom UI either way.
   */
  search?: boolean | SearchConfig;
  /**
   * Built-in popover shown when a link is clicked.
   * @deprecated replaceWith=`hyperlinks` removeIn=v3.0
   */
  linkPopover?: boolean | LinkPopoverConfig;
  /** Built-in ruler. Disabled by default. */
  ruler?: boolean | RulerConfig;
  /**
   * Built-in chrome drawn around content controls (default: `true`). Set to
   * `false` to hide the chrome.
   *
   * The previous `{ chrome: 'default' | 'none' }` form remains accepted for
   * v2 compatibility. New integrations should use the boolean form.
   */
  contentControls?: boolean | ContentControlsConfig;
}

/** Built-in ruler configuration. */
export interface RulerConfig {
  /** Element or selector to render the ruler into. Omit to render it above the document. */
  container?: string | HTMLElement;
}

/** Allowed values for `interaction.comments.level`. */
export type CommentInteractionLevel = 'read' | 'write' | 'resolve';

/** Client-side comment actions allowed by this Editor. */
export interface CommentInteractionConfig {
  /**
   * The highest comment interaction level this Editor allows (default: `resolve`).
   *
   * `read` allows reading threads only. `write` also allows create, reply,
   * edit, and delete. `resolve` also allows resolve and reopen.
   */
  level?: CommentInteractionLevel;
  /**
   * Block comment mutations. Also block tracked-change accept/reject unless
   * `interaction.trackedChanges.allowDecisions` is set (default: false).
   * @deprecated replaceWith=`interaction.comments.level` and `interaction.trackedChanges.allowDecisions` compat-indefinitely=v2 configuration compatibility
   */
  readOnly?: boolean;
  /**
   * Allow comment resolve and reopen actions when comment writes are enabled (default: true).
   * @deprecated replaceWith=`interaction.comments.level` compat-indefinitely=v2 configuration compatibility
   */
  allowResolve?: boolean;
}

/**
 * Controls which interactions this Editor allows, independent of what
 * SuperDoc renders.
 *
 * This is client-side behavior, not an authorization boundary. Enforce
 * document access and collaboration permissions in a trusted backend.
 */
export interface InteractionConfig {
  /** Comment interaction policy. */
  comments?: CommentInteractionConfig;
  /** Tracked-change interaction policy. */
  trackedChanges?: {
    /**
     * Allow this Editor to accept or reject tracked changes (default: true).
     * Document mode and command availability can still block these actions.
     */
    allowDecisions?: boolean;
  };
}

/**
 * Shared plumbing for dialogs and floating overlays, including surfaces the
 * application opens itself through `superdoc.openSurface()`.
 *
 * Unaffected by `ui: false`: turning off SuperDoc's own surfaces does not
 * disable the mechanism an application uses to render its own.
 */
export interface SurfacesConfig {
  /**
   * Resolver for intent-based surface requests.
   *
   * `null` explicitly clears a resolver inherited from the legacy
   * `modules.surfaces.resolver`, which omitting the key does not do.
   */
  resolver?: SurfaceResolver | null;
  /** Defaults applied to dialog surfaces. */
  dialog?: {
    /** Close on Escape (default: true). */
    closeOnEscape?: boolean;
    /** Close on backdrop click (default: true). */
    closeOnBackdrop?: boolean;
    /** Default max width. */
    maxWidth?: string | number;
  };
  /** Defaults applied to floating surfaces. */
  floating?: {
    /** Placement preset (default: 'top-right'). */
    placement?: SurfaceFloatingPlacement;
    /** Default width. */
    width?: string | number;
    /** Default max width. */
    maxWidth?: string | number;
    /** Default max height. */
    maxHeight?: string | number;
    /** Close on Escape (default: true). */
    closeOnEscape?: boolean;
    /** Close on outside pointer down (default: false). */
    closeOnOutsidePointerDown?: boolean;
    /** Focus the surface on open (default: true). */
    autoFocus?: boolean;
  };
}

/**
 * Browser worker asset URLs for deployments where application code and built
 * SuperDoc assets are served from different origins. Each URL must resolve to
 * a same-origin module worker served by the embedding application.
 */
interface V2WorkerUrlsConfig {
  /** Main document worker used by non-collaborative v2 documents. */
  document?: string | URL;
  /** Collaboration-capable document worker used by v2 collaboration rooms. */
  collaboration?: string | URL;
  /** Isolated review-index worker used for comments and tracked changes. */
  reviewIndex?: string | URL;
}

export interface Config {
  /** The ID of the SuperDoc. */
  superdocId?: string;
  /** The selector or element to mount the SuperDoc into. */
  selector: string | HTMLElement;
  /** The mode of the document (default: 'editing'). */
  documentMode?: DocumentMode;
  /** What review information is shown when `documentMode` is `viewing`. */
  viewing?: ViewingOptions;
  /**
   * When `documentMode` is `'viewing'`, allow the user to make text
   * selections even though editing is disabled. Defaults to `false`.
   * Forwarded to the underlying editor as `options.allowSelectionInViewMode`.
   */
  allowSelectionInViewMode?: boolean;
  /** The role of the user in this SuperDoc. */
  role?: 'editor' | 'viewer' | 'suggester';
  /**
   * Document to open. Pass a URL, file, byte source, or structured source.
   * Use a structured document carrying `collaboration` for collaboration,
   * or a structured source for other metadata. Omit it to open a blank DOCX.
   */
  document?: DocumentSource | null;
  /** Password for encrypted DOCX files. Forwarded during document load. */
  password?: string;
  /** Documents to load. */
  documents?: Document[];
  /**
   * The current user of this SuperDoc. Typed as `AwarenessUser` (an
   * extension of `User` with the optional `color` field) so consumers
   * can pass an explicit awareness color and have the runtime honor it
   * as an override - `SuperDoc#assignUserColor()` skips its hash-based
   * assignment when `user.color` is already set.
   */
  user?: AwarenessUser;
  /** All users of this SuperDoc (can be used for "@"-mentions). */
  users?: User[];
  /** Colors to use for user awareness. */
  colors?: string[];
  /**
   * Which built-in interface SuperDoc renders.
   *
   * Omit it to keep SuperDoc's historical rendering: comments, the context
   * menu, content-control chrome, and mode-aware hyperlink activation are on;
   * search and the ruler are opt-in; and the toolbar renders once it has
   * somewhere to mount. That profile is not symmetrical, and omitting this
   * field reproduces it exactly.
   *
   * Pass `false` when the application owns the interface. SuperDoc then
   * renders no controls, chrome, dialogs, or popovers, while the document,
   * the Document API, and `superdoc.ui` keep working — so a custom UI drives
   * the same commands the built-in one would have.
   *
   * Pass an object to choose per surface. An omitted key keeps that
   * surface's default rather than following its siblings, so
   * `{ comments: false }` disables comments and changes nothing else.
   *
   * @example
   * // Application owns the interface.
   * new SuperDoc({ selector: '#editor', document: file, ui: false });
   *
   * @example
   * // Built-in toolbar and search, no comments or context menu.
   * new SuperDoc({
   *   selector: '#editor',
   *   document: file,
   *   ui: {
   *     toolbar: { container: '#toolbar' },
   *     search: true,
   *     comments: false,
   *     contextMenu: false,
   *   },
   * });
   */
  ui?: false | UIConfig;
  /**
   * Hyperlink activation behavior. By default, editable links open the built-in
   * hyperlink editor in Editing or Suggesting mode. In Viewing mode, and for
   * links outside editable text, SuperDoc follows the URL or document anchor.
   * Pass `false` to suppress activation in every mode.
   *
   * A configured `onActivate` handler stays active with `ui: false`, allowing
   * a custom interface to handle hyperlinks.
   */
  hyperlinks?: false | HyperlinksConfig;
  /**
   * Client-side interaction policy. Independent of `ui`, so it
   * still applies when the application renders its own UI. This is not an
   * authorization boundary.
   */
  interaction?: InteractionConfig;
  /**
   * Shared configuration for dialogs and floating overlays, including ones
   * opened through `superdoc.openSurface()`. Stays active under `ui: false`.
   */
  surfaces?: SurfacesConfig;
  /** Modules to load. */
  modules?: Modules;
  /**
   * Customize client-side permission decisions.
   * This is not an authorization boundary. When both resolver spellings are
   * present, this field takes precedence over the deprecated
   * `modules.comments.permissionResolver` field.
   */
  permissionResolver?: PermissionResolver;
  /**
   * Where to render the built-in toolbar. Either an `HTMLElement`, or a
   * selector string in one of the supported forms: an id selector (`#toolbar`),
   * a class selector (`.toolbar`), or a bare element id (`toolbar`). Other CSS
   * selector syntax is not supported — an attribute or descendant selector such
   * as `[data-toolbar]` resolves to nothing and leaves the toolbar unrendered.
   *
   * SuperDoc renders into the resolved element but does not manage its
   * placement, and never includes it in the `contained` layout calculation.
   * Where the application puts it therefore decides the space it needs: a
   * sibling of a 400px `contained` Editor adds its own height alongside it,
   * while a toolbar placed inside that host consumes part of the 400px and can
   * overflow it.
   *
   * Omitting this field (and `modules.toolbar.selector`) renders no toolbar.
   * `modules.toolbar: true` on its own does not render one either — it creates
   * the `superdoc.toolbar` handle without a mount target. See
   * {@link Modules.toolbar}.
   *
   * @deprecated replaceWith=`ui.toolbar.container` removeIn=v3.0
   */
  toolbar?: string | HTMLElement;
  /**
   * Toolbar groups to show.
   * @deprecated replaceWith=`ui.toolbar.items` removeIn=v3.0
   */
  toolbarGroups?: string[];
  /**
   * Icons to show in the toolbar.
   * @deprecated replaceWith=`ui.toolbar.icons` removeIn=v3.0
   */
  toolbarIcons?: object;
  /**
   * Texts to override in the toolbar.
   * @deprecated replaceWith=`ui.toolbar.strings` removeIn=v3.0
   */
  toolbarTexts?: object;
  /**
   * The font-family to use for all SuperDoc UI surfaces (toolbar, comments
   * UI, dropdowns, tooltips, etc.). This ensures consistent typography across
   * the entire application and helps match your application's design system.
   * The value should be a valid CSS font-family string.
   *
   * Example (system fonts):
   *   uiDisplayFallbackFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
   *
   * Example (custom font):
   *   uiDisplayFallbackFont: '"Inter", Arial, sans-serif'
   */
  uiDisplayFallbackFont?: string;
  /** Whether the SuperDoc is in development mode. */
  isDev?: boolean;
  /**
   * Disable Pinia/Vue devtools plugin setup for this SuperDoc instance
   * (useful in non-Vue hosts).
   */
  disablePiniaDevtools?: boolean;
  /**
   * Layout engine overrides passed through to DocumentRendererRuntime (page size,
   * margins, virtualization, zoom, debug label, etc.).
   */
  layoutEngineOptions?: SuperDocLayoutEngineOptions;
  /** Experimental v2 behavior. These options can change without a major release. */
  experimental?: {
    /**
     * Previous undo-routing switch. V2 owns history routing.
     * @deprecated replaceWith=`remove this option; SuperDoc 2 owns history routing` removeIn=v3.0
     */
    unifiedHistory?: boolean;
    /**
     * Previous v2 shell rollout switch. SuperDoc 2 always uses the v2 shell.
     * @deprecated replaceWith=`remove this option; SuperDoc 2 always uses the v2 shell` removeIn=v3.0
     */
    v2Host?: boolean;
    /**
     * Temporary V2 web-surface rollout control. The value is snapshotted at
     * mount and changing it requires a remount. This is not a stable renderer API.
     */
    v2WebSurface?: 'dense-control' | 'retained-dom';
    /**
     * Derived-invalidation deferral for direct single-paragraph edits (v2
     * engine only). Field display text settles off the keystroke path under
     * the engine's settlement contract. Defaults to `true`. Set it to `false`
     * only as an emergency kill switch.
     */
    deferDerivedInvalidations?: boolean;
  };
  /**
   * Previous pre-create callback. SuperDoc 2 does not emit this callback.
   * @deprecated replaceWith=`application setup before new SuperDoc()` removeIn=v3.0
   */
  onEditorBeforeCreate?: (params: SuperDocEditorPayload) => void;
  /** Callback after an editor is created. Receives a wrapper carrying the editor. */
  onEditorCreate?: (params: SuperDocEditorPayload) => void;
  /** Callback when the v2 document source reaches source-complete posture and diff.capture is safe to call. */
  onSourceComplete?: () => void;
  /** Callback when v2 source signals finish building (fires after onSourceComplete; diff.capture is synchronously safe). */
  onSourceSignalsComplete?: () => void;
  /**
   * Previous ProseMirror transaction callback. SuperDoc 2 does not emit it.
   * @deprecated replaceWith=`defineSuperDocExtension` with `ctx.onMutation` removeIn=v3.0
   */
  onTransaction?: (params: EditorTransactionEvent) => void;
  /**
   * Previous post-destroy callback. SuperDoc 2 does not emit this callback.
   * @deprecated replaceWith=`application cleanup after superdoc.destroy()` removeIn=v3.0
   */
  onEditorDestroy?: () => void;
  /** Called when the editor cannot read or update document content. */
  onContentError?: (params: SuperDocContentErrorPayload) => void;
  /** Callback when the SuperDoc is ready. Receives a wrapper carrying the live SuperDoc instance. */
  onReady?: (params: SuperDocReadyPayload) => void;
  /** Callback when comments are updated. */
  onCommentsUpdate?: (params: SuperDocCommentsUpdatePayload) => void;
  /**
   * Callback when the selection enters, leaves, or moves between content controls.
   * @deprecated replaceWith=`superdoc.ui.contentControls.observe` compat-indefinitely=v2 event compatibility
   */
  onContentControlActiveChange?: (params: ContentControlActiveChangePayload) => void;
  /** Callback when someone clicks inside a content control. */
  onContentControlClick?: (params: ContentControlClickPayload) => void;
  /** Callback when awareness is updated. */
  onAwarenessUpdate?: (params: SuperDocAwarenessUpdatePayload) => void;
  /** Callback when the SuperDoc is locked or unlocked. */
  onLocked?: (params: SuperDocLockedPayload) => void;
  /** Callback when the PDF document is ready. */
  onPdfDocumentReady?: () => void;
  /** Callback when the sidebar is toggled. */
  onSidebarToggle?: (isOpened: boolean) => void;
  /** Callback when collaboration is ready. Receives a wrapper carrying the editor. */
  onCollaborationReady?: (params: SuperDocEditorPayload) => void;
  /** Callback when document is updated. */
  onEditorUpdate?: (params: EditorUpdateEvent) => void;
  /** Callback after an Accept All or Reject All tracked-change decision. */
  onTrackedChangesBulkDecision?: (params: SuperDocTrackedChangesBulkDecisionPayload) => void;
  /**
   * Callback when SuperDoc emits an `exception` event. The payload is a
   * union of runtime shapes (store init, restore failure, editor lifecycle,
   * built-in toolbar, hyperlink activation, structured diagnostic). Narrow
   * with `'stage' in params` (store init), `'code' in params` (editor),
   * `'itemName' in params` (toolbar), `'source' in params` (hyperlink), or
   * `'diagnosticCode' in params` (structured diagnostic) before reading
   * shape-specific fields.
   *
   * A structured diagnostic (`SuperDocExceptionDiagnosticPayload`,
   * `diagnosticCode` one of `PARSE_ERROR` | `RENDER_ERROR` |
   * `UNSUPPORTED_FEATURE` | `PERFORMANCE_ERROR`) can accompany a legacy
   * exception payload. SuperDoc filters unsupported internal records. For
   * translated package and readiness records, it emits at most one structured
   * diagnostic for each `(documentId, generation, internalCode)` tuple. It
   * also suppresses a generic boot diagnostic when a more specific package
   * diagnostic describes the same failure. A single incident can therefore
   * raise 0..N structured diagnostics. The `unzip`, `parse`, `render`, and
   * `export` stages are populated today; `layout` is reserved for future
   * coverage.
   */
  onException?: (params: SuperDocExceptionPayload) => void;
  /** Called when the built-in comments list is rendered or removed. */
  onCommentsListChange?: (params: SuperDocCommentsListChangePayload) => void;
  /** Called after each pagination layout pass with the current page count. */
  onPaginationUpdate?: (params: SuperDocPaginationUpdatePayload) => void;
  /**
   * Previous list-definition callback. SuperDoc 2 does not emit this callback.
   * @deprecated replaceWith=`onEditorUpdate` and `doc.lists.list` removeIn=v3.0
   */
  onListDefinitionsChange?: (params: ListDefinitionsPayload) => void;
  /**
   * Callback when the zoom level changes. Fires for every zoom source:
   * `setZoom()`, the toolbar zoom control, and fit-width
   * adjustments.
   */
  onZoomChange?: (params: SuperDocZoomPayload) => void;
  /**
   * Callback when the implied fit changes (rounded fit zoom or base
   * page width); pixel-level width jitter does not fire it, and
   * `getViewportMetrics()` always reads latest. Registered before the
   * first emit.
   */
  onViewportChange?: (params: SuperDocViewportChangePayload) => void;
  /** Callback after a ruler drag changes the active section's left or right page margin. */
  onPageMarginsChange?: (params: SuperDocPageMarginsChangePayload) => void;
  /**
   * Previous input-format hint. SuperDoc 2 opens DOCX sources from `document`.
   * @deprecated replaceWith=`document` removeIn=v3.0
   */
  format?: string;
  /**
   * ProseMirror extensions accepted by SuperDoc v1. SuperDoc v2 ignores these
   * objects and logs a warning during construction. Use
   * {@link Config.extensions} with `defineSuperDocExtension` instead; the two
   * extension formats are not interchangeable.
   *
   * @deprecated replaceWith=`extensions` removeIn=v3.0
   */
  editorExtensions?: object[];
  /**
   * SuperDoc v2 extensions created with `defineSuperDocExtension`. These
   * extensions activate without an `editorVersion` or `editorIntegration`
   * selector. Each extension owns isolated storage, named events, commands,
   * anchors, and render-only
   * decorations, and mutates the document exclusively through the guarded
   * Document API (`ctx.doc.*`). This is the v2 replacement for the
   * v1/ProseMirror `editorExtensions` path; the two are not interchangeable.
   * Extension arrays are mount-time config: changing the array reference
   * requires a remount to take effect.
   */
  extensions?: SuperDocExtension[];
  /**
   * Whether the current user is internal. This affects comment visibility,
   * new-comment metadata, and the default permission decision. It is not an
   * authorization boundary.
   */
  isInternal?: boolean;
  /** Fallback filename for `export()` when `exportedName` is omitted. */
  title?: string;
  /**
   * Previous external conversation input. SuperDoc 2 reads comments from the DOCX.
   * @deprecated replaceWith=`doc.comments` removeIn=v3.0
   */
  conversations?: object[];
  /**
   * Toggle comment visibility when `documentMode` is `viewing`.
   * @deprecated replaceWith=`viewing.comments` compat-indefinitely=v2 configuration compatibility
   */
  comments?: ViewingVisibilityConfig;
  /**
   * Toggle tracked-change visibility when `documentMode` is `viewing`.
   * @deprecated replaceWith=`viewing.trackedChanges` compat-indefinitely=v2 configuration compatibility
   */
  trackChanges?: ViewingVisibilityConfig;
  /**
   * Initial shared lock metadata. This value does not make the document read-only.
   * Use `documentMode` or interaction policy to restrict editing in the client.
   */
  isLocked?: boolean;
  /** The function to handle image uploads. */
  handleImageUpload?: (file: globalThis.File) => Promise<string>;
  /** User associated with the initial shared lock metadata. */
  lockedBy?: User;
  /**
   * Whether to show the ruler in the editor.
   * @deprecated replaceWith=`ui.ruler` removeIn=v3.0
   */
  rulers?: boolean;
  /**
   * Element or selector the ruler mounts into. Omit to render it inline above
   * the editor.
   *
   * @deprecated replaceWith=`ui.ruler.container` removeIn=v3.0 — the runtime
   * still honors it, and the canonical value wins when both are set.
   */
  rulerContainer?: string | HTMLElement;
  /**
   * Previous default-style switch. SuperDoc 2 uses the styles stored in the DOCX.
   * @deprecated replaceWith=`styles stored in the DOCX` removeIn=v3.0
   */
  suppressDefaultDocxStyles?: boolean;
  /**
   * Previous imported-content override. SuperDoc 2 ignores this field.
   * @deprecated replaceWith=`document and the Document API` removeIn=v3.0
   */
  jsonOverride?: object;
  /**
   * Whether to disable the built-in context menu.
   * @deprecated replaceWith=`ui.contextMenu` removeIn=v3.0
   */
  disableContextMenu?: boolean;
  /**
   * Previous HTML initialization field.
   * @deprecated replaceWith=`doc.replace({ target: { kind: 'story', storyType: 'body' }, type: 'html', value }) after onReady` removeIn=v3.0
   */
  html?: string;
  /**
   * Previous Markdown initialization field.
   * @deprecated replaceWith=`doc.replace({ target: { kind: 'story', storyType: 'body' }, type: 'markdown', value }) after onReady` removeIn=v3.0
   */
  markdown?: string;
  /**
   * Previous callback for unsupported HTML imported through `html`.
   * @deprecated replaceWith=`doc.htmlToFragment() diagnostics` removeIn=v3.0
   */
  onUnsupportedContent?: ((items: Array<{ tagName: string; outerHTML: string; count: number }>) => void) | null;
  /**
   * Previous console-warning switch for HTML imported through `html`.
   * @deprecated replaceWith=`doc.htmlToFragment() diagnostics` removeIn=v3.0
   */
  warnOnUnsupportedContent?: boolean;
  /** Whether to enable debug mode. */
  isDebug?: boolean;
  /** Document view options (OOXML ST_View compatible). */
  viewOptions?: ViewOptions;
  /**
   * Enable contained mode for fixed-height container embedding.
   *
   * SuperDoc supports two layout modes, and the host element's height
   * requirement differs between them:
   *
   * - Natural (default, `false`): the Editor grows to the document's full
   *   height and the page scrolls. The host needs no height. Setting one does
   *   not constrain the document or enable internal scrolling, because
   *   SuperDoc leaves overflow visible in this mode, though application CSS
   *   on the host can still clip what is drawn.
   * - Contained (`true`): SuperDoc propagates `height: 100%` through its DOM
   *   tree and scrolls the document internally, so multi-page documents stay
   *   inside the host. This mode requires the host to have a definite height
   *   (for example `height: 400px`); without one there is nothing for the
   *   percentage heights to resolve against.
   *
   * A toolbar mounted through `Config.toolbar` or `modules.toolbar.selector` is
   * never part of this calculation. Placed as a sibling of the host, its height
   * adds to the host's: a 400px host with a 40px toolbar occupies 440px in
   * total. Placed inside the host, it consumes part of the 400px instead.
   */
  contained?: boolean;
  /**
   * Content Security Policy nonce for SuperDoc runtime styles. Editors that
   * share a document must use the same nonce.
   */
  cspNonce?: string;
  /** Client-visible license identity sent with document-open telemetry. */
  licenseKey?: string;
  /** Document-open telemetry settings. Enabled by default. */
  telemetry?: SuperDocTelemetryConfig;
  /** Proofing / spellcheck configuration. */
  proofing?: ProofingConfig;
  /**
   * Font system configuration. The reviewed fallback pack ships in the optional
   * `@superdoc-dev/fonts` package: pass `superdocFonts` (bundler) or the `SuperDocFonts`
   * global from its `superdoc-fonts.min.js` browser build (CDN). To self-host, set
   * `fonts.assetBaseUrl` (e.g. `/fonts/` or a CDN URL) or `fonts.resolveAssetUrl` for
   * signed/versioned hosting. Core ships no document families, so with none configured the
   * toolbar shows the baseline and documents render with system fonts. It does ship one
   * built-in face: a core-symbol provider requested whenever the document contains symbol or
   * dingbat glyphs it covers, such as the • bullet, even with no `fonts` configuration.
   */
  fonts?: FontsConfig;
  /**
   * Optional same-origin URLs for v2's browser worker assets. Configure these
   * when the application and SuperDoc bundle are served from different origins.
   * Omitted entries keep SuperDoc's bundled worker URLs.
   */
  workerUrls?: V2WorkerUrlsConfig;
  /**
   * Budget for the document worker to start up, in milliseconds
   * (default: 30000). Measured from worker spawn, so it covers script
   * download, parsing, evaluation, and the worker's first response to
   * SuperDoc. Raise it when a large worker chunk is served
   * over a slow connection or a cold dev-server cache; lower it to fail faster.
   * Worker load errors are reported immediately and do not wait for this
   * budget. Must be a finite positive number no greater than 2147483647, the
   * platform timer ceiling above which a delay would fire immediately.
   */
  workerStartupTimeoutMs?: number;
  /**
   * Whether `layoutEngineOptions` are passed when a DOCX editor opens.
   *
   * Set to `false` to omit `layoutEngineOptions` and use CSS fallback styling for the
   * initial non-default zoom. This does not select a different DOCX renderer.
   * `viewOptions.layout` separately selects print or web layout.
   */
  useLayoutEngine?: boolean;
  // V2 branch: `editorVersion`, `v2Integration`, and `v2` are intentionally NOT
  // customer config. `superdoc@2` always runs the DOCX Engine dependency and
  // exposes a read-only `instance.editorVersion === 2` as runtime evidence
  // only. There is no runtime selection and no v1 fallback, so the historical
  // runtime-selection config holes (`editorVersion?: 1 | 2`,
  // `v2Integration?: unknown`, `v2?: unknown`) are removed from the public type
  // surface. `#init` already ignores any such input at runtime.
  /**
   * Zoom behavior: the initial zoom level and optional fit-width
   * policy. See `SuperDocZoomConfig`.
   */
  zoom?: SuperDocZoomConfig;
  /**
   * Starting measurement unit for rulers and measurement fields (Word's
   * "measurement units" preference). Defaults to `'in'` (Word's en-US default).
   * Change it at runtime with `setMeasurementUnit()`. See `SuperDocMeasurementUnit`.
   */
  measurementUnit?: SuperDocMeasurementUnit;
  /**
   * Previous first-report callback. In SuperDoc 2 it receives the same initial,
   * load-aware report as `onFontsChanged`, but does not receive later updates.
   *
   * @deprecated replaceWith=`onFontsChanged` removeIn=v3.0
   */
  onFontsResolved?: (payload: FontsResolvedPayload) => void;
  /**
   * Experimental callback fired when paginated layout changes the page count.
   * Runs before paint. `generation` identifies the layout pass. Does not fire
   * in web layout.
   */
  onPageCountKnown?: (payload: SuperDocPageCountKnownPayload) => void;
  /**
   * Called after initial font resolution and whenever substitution or font
   * availability changes. The payload includes the current report, missing
   * fonts, load summary, and the reason for the update. Use
   * `superdoc.fonts.onReport()` for the same subscription at runtime.
   */
  onFontsChanged?: (payload: FontsChangedPayload) => void;
}

/**
 * Internal augmentation of `Config` for runtime-only fields and tightened
 * invariants that must not appear on the published consumer surface. The
 * `Config` interface above is the public contract; this type adds the
 * fields SuperDoc sets/reads internally so the implementation can be
 * type-checked without leaking the fields into customer IDE autocomplete.
 *
 * The four overrides below mark fields that `Config` exposes as optional
 * but `SuperDoc.#init` always normalizes to a populated shape. Internal
 * call sites cast `this.config` to this type so they can access these
 * invariants without per-site null guards.
 *
 * Use this from internal SuperDoc callsites that need the augmented
 * shape, e.g. `(this.config as InternalConfig).socket = ...`.
 */
export interface InternalConfig extends Config {
  /**
   * Internal v2 boot gate set when a consumer supplies the removed v1
   * `modules.collaboration` API. The shell surfaces this without ever
   * attaching the supplied Y.Doc/provider.
   */
  v2CollaborationPreflightFailure?: {
    readonly code: 'collaboration-v1-config-unsupported';
    readonly message: string;
  };
  /**
   * The shared websocket instance created by SuperDoc when
   * `modules.collaboration.providerType === 'hocuspocus'`. Set automatically;
   * not part of the public Config surface.
   */
  socket?: HocuspocusProviderWebsocket;
  /**
   * Normalized to `[]` by `#init` if the consumer passes nothing or
   * `undefined`. Narrowed to `RuntimeDocument[]` because once `#init`
   * runs, each entry has been augmented with the runtime-only fields
   * (`role`, editor/renderer accessors, etc.). Consumers
   * still pass `Document[]` via the public `Config` interface; this
   * override only describes the post-init shape internal callsites see.
   */
  documents: RuntimeDocument[];
  /** Normalized to `{}` by `#init` if the consumer passes nothing or `undefined`. */
  modules: Modules;
  /**
   * Spread of `DEFAULT_USER` over consumer input by `#init`; `name`
   * always present. Widened to `AwarenessUser` because `#assignUserColor`
   * runs synchronously during init and writes `color` into this object.
   */
  user: AwarenessUser;
  /** Normalized to `{}` by `#init` if the consumer passes nothing or `undefined`. */
  layoutEngineOptions: SuperDocLayoutEngineOptions;
}

/**
 * Internal augmentation of `SuperDocLayoutEngineOptions` for unstable tuning
 * fields. The public `SuperDocLayoutEngineOptions` interface above is the
 * customer-facing contract; this type adds fields the implementation may
 * read but that are intentionally not part of the v1 stable API.
 */
export interface InternalSuperDocLayoutEngineOptions extends SuperDocLayoutEngineOptions {
  /**
   * Internal-only semantic mode tuning options. Shape may change without
   * notice; not part of the public surface.
   */
  semanticOptions?: object;
}

export type ProofingStatus = 'idle' | 'checking' | 'disabled' | 'degraded';

export interface ProofingError {
  kind: 'provider-error' | 'validation-error' | 'timeout';
  message: string;
  segmentIds?: string[];
  /**
   * Underlying error (genuinely opaque: whatever the proofing provider
   * threw). Use `unknown` per Error-cause convention; consumers narrow
   * with `instanceof` or shape checks before reading fields.
   */
  cause?: unknown;
}

export interface ProofingConfig {
  /**
   * Enables proofing. A provider is also required before SuperDoc runs checks.
   * @defaultValue false
   */
  enabled?: boolean;
  /**
   * Checks the text segments SuperDoc supplies and returns spelling, grammar,
   * or style issues.
   * @defaultValue null
   */
  provider?: ProofingProvider | null;
  /**
   * Fallback language passed to the provider when a text segment has no
   * resolved language.
   * @defaultValue null
   */
  defaultLanguage?: string | null;
  /**
   * Delay in milliseconds between an edit and the next proofing check. Values
   * at or below 0 run without a delay.
   * @defaultValue 500
   */
  debounceMs?: number;
  /** Suggestion limit passed to the provider. The provider decides how to apply it. */
  maxSuggestions?: number;
  /** Prioritize checking visible pages first. */
  visibleFirst?: boolean;
  /**
   * Shows Ignore in the proofing context menu. Ignored words remain suppressed
   * for this editor session.
   * @defaultValue true
   */
  allowIgnoreWord?: boolean;
  /**
   * Words whose proofing issues SuperDoc suppresses. Matching is
   * case-insensitive after Unicode normalization.
   * @defaultValue []
   */
  ignoredWords?: string[];
  /**
   * Maximum provider call time in milliseconds. Non-positive or non-finite
   * values use the default.
   * @defaultValue 10000
   */
  timeoutMs?: number;
  /** Maximum concurrent provider requests. */
  maxConcurrentRequests?: number;
  /** Maximum segments per provider call. */
  maxSegmentsPerBatch?: number;
  /**
   * Runs when a provider check fails or times out.
   * @param error - The failure kind, message, affected segment IDs, and cause.
   */
  onProofingError?: (error: ProofingError) => void;
  /**
   * Runs when the proofing lifecycle status changes.
   * @param status - The current proofing status.
   */
  onStatusChange?: (status: ProofingStatus) => void;
}
