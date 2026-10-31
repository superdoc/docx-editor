/**
 * Generic surface infrastructure, separated from the built-in surfaces that
 * happen to use it.
 *
 * `modules.surfaces` currently holds two unrelated things. `resolver`,
 * `dialog`, and `floating` are the plumbing every surface goes through,
 * including ones the application opens itself via `superdoc.openSurface()`.
 * `findReplace` and `passwordPrompt` were specific built-in surfaces — the
 * first is now `ui.search`, the second is gone.
 *
 * The distinction matters for `ui: false`. Disabling SuperDoc's chrome must
 * not disable the mechanism an application uses to render its own dialogs, so
 * this config stays live even when every built-in surface is off.
 */

import { mergeDefinedFields } from './merge-defined.js';
import { isPlainObject } from '../../helpers/object-guards.js';
import type { Config, SurfaceResolver, SurfacesConfig, SurfacesModuleConfig } from '../types/index.js';

type SurfacesSource = Pick<Config, 'surfaces' | 'modules'>;

type NormalizedSurfacesConfig = {
  resolver: SurfaceResolver | null;
  dialog: NonNullable<SurfacesConfig['dialog']>;
  floating: NonNullable<SurfacesConfig['floating']>;
};

/**
 * Resolve the generic surface infrastructure config.
 *
 * Reads top-level `surfaces` first, then the legacy `modules.surfaces` block,
 * so both spellings work while the migration lands. Built-in surface intents
 * are deliberately not read here; they belong to the UI profile.
 *
 * The resolved shape mirrors the public `SurfacesConfig`, with every member
 * present: the presets are merged objects rather than optional, and `resolver`
 * is a function or `null` once a non-function value has been rejected.
 */
export function normalizeSurfacesConfig(config: SurfacesSource = {}): NormalizedSurfacesConfig {
  const next: SurfacesConfig = isPlainObject(config.surfaces) ? config.surfaces : {};
  const legacy: SurfacesModuleConfig = isPlainObject(config.modules?.surfaces) ? config.modules.surfaces : {};

  // `null` clears, `undefined` falls through. Clearing a resolver inherited
  // from the legacy block is what `surfaces.resolver: null` is for, so plain
  // nullish-coalescing would ignore it. But an object built with a spread or
  // an optional property can carry `resolver: undefined` while meaning
  // nothing by it, so presence alone must not clear either.
  const resolver = next.resolver === undefined ? legacy.resolver : next.resolver;

  return {
    resolver: typeof resolver === 'function' ? resolver : null,
    // Per-key merge rather than whole-object replacement: an application that
    // sets only `dialog.maxWidth` in the new spelling should keep any
    // `closeOnEscape` it set in the old one.
    dialog: mergeDefinedFields(legacy.dialog, next.dialog),
    floating: mergeDefinedFields(legacy.floating, next.floating),
  };
}
