/**
 * Consumer typecheck: the resolved-config getters on `SuperDoc`.
 *
 * `uiConfig`, `interactionConfig`, and `surfacesConfig` are how an application
 * asks what SuperDoc decided: which built-in surfaces render, which
 * interactions the Editor allows, and which resolver serves surface requests.
 * A custom UI reads them instead of re-deriving precedence from the raw config,
 * so their shape is part of the public contract rather than an implementation
 * detail.
 *
 * These assertions pin the fields a consumer actually branches on. The getters
 * are typed `ReturnType<typeof normalize*Config>`, so widening or renaming a
 * field inside a normalizer surfaces here rather than silently changing what
 * consumers see.
 *
 * Drained obligations (3):
 *   - uiConfig:returns
 *   - interactionConfig:returns
 *   - surfacesConfig:returns
 */
import type { SuperDoc, SurfaceFloatingPlacement, SurfaceResolver } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

declare const sd: SuperDoc;

// `uiConfig` — the coarse "does SuperDoc own any chrome" answer plus the
// per-surface flags that stay authoritative for rendering.
const _uiConfigOk: SuperDoc['uiConfig'] = sd.uiConfig;
const _uiEnabledOk: AssertEqual<typeof sd.uiConfig.enabled, boolean> = true;
const _uiToolbarEnabledOk: AssertEqual<typeof sd.uiConfig.toolbar.enabled, boolean> = true;
const _uiCommentsEnabledOk: AssertEqual<typeof sd.uiConfig.comments.enabled, boolean> = true;
const _uiCommentsHighlightsOk: AssertEqual<typeof sd.uiConfig.comments.highlights, boolean> = true;

// The ruler and link popover carry `suppressed` alongside `enabled`: the first
// is the consumer forbidding the surface, the second only its starting state.
// Collapsing them would make the runtime toggles unreachable.
const _uiRulerSuppressedOk: AssertEqual<typeof sd.uiConfig.ruler.suppressed, boolean> = true;
const _uiLinkPopoverSuppressedOk: AssertEqual<typeof sd.uiConfig.linkPopover.suppressed, boolean> = true;

// `interactionConfig` — policy, which outlives the built-in comment UI. A
// custom comment surface still has to honor these.
const _interactionConfigOk: SuperDoc['interactionConfig'] = sd.interactionConfig;
const _commentLevelOk: AssertEqual<typeof sd.interactionConfig.comments.level, 'read' | 'write' | 'resolve'> = true;
const _readOnlyOk: AssertEqual<typeof sd.interactionConfig.comments.readOnly, boolean> = true;
const _allowResolveOk: AssertEqual<typeof sd.interactionConfig.comments.allowResolve, boolean> = true;
const _allowDecisionsOk: AssertEqual<typeof sd.interactionConfig.trackedChanges.allowDecisions, boolean> = true;

// `surfacesConfig` — dialog and floating infrastructure, which stays live even
// under `ui: false`. Assert the fields a consumer reads, not just the whole
// object: assignability alone would survive a field being renamed away.
const _surfacesConfigOk: SuperDoc['surfacesConfig'] = sd.surfacesConfig;
// Identity assertions, not just assignability: `any` on either side would
// satisfy an assignment while telling a consumer nothing.
const _resolverOk: AssertEqual<typeof sd.surfacesConfig.resolver, SurfaceResolver | null> = true;
const _dialogCloseOnEscapeOk: AssertEqual<typeof sd.surfacesConfig.dialog.closeOnEscape, boolean | undefined> = true;
const _floatingPlacementOk: AssertEqual<
  typeof sd.surfacesConfig.floating.placement,
  SurfaceFloatingPlacement | undefined
> = true;

void [
  _uiConfigOk,
  _uiEnabledOk,
  _uiToolbarEnabledOk,
  _uiCommentsEnabledOk,
  _uiCommentsHighlightsOk,
  _uiRulerSuppressedOk,
  _uiLinkPopoverSuppressedOk,
  _interactionConfigOk,
  _commentLevelOk,
  _readOnlyOk,
  _allowResolveOk,
  _allowDecisionsOk,
  _surfacesConfigOk,
  _resolverOk,
  _dialogCloseOnEscapeOk,
  _floatingPlacementOk,
];
