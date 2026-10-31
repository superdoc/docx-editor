/**
 * Consumer typecheck: internal-only fields must not appear on the
 * published Config / SuperDocLayoutEngineOptions surface (SD-2886).
 *
 * Two fields in `core/types/index.ts` are explicitly internal:
 *
 *   - Config.socket. "Internal: ... do not pass from outside" (set
 *     automatically when modules.collaboration.providerType === 'hocuspocus').
 *   - SuperDocLayoutEngineOptions.semanticOptions. "Internal-only ...
 *     intentionally not a stable public API in v1."
 *
 * Both are kept off the public surface by removing them from the source
 * `Config` / `SuperDocLayoutEngineOptions` interfaces in
 * `packages/superdoc/src/core/types/index.ts`. Internal callsites that need
 * the augmented shape use the `InternalConfig` extension instead.
 *
 * The fixture pins both the standalone alias surface AND the nested /
 * constructor surface that the reviewer caught leaking past an earlier
 * Omit-at-the-boundary attempt. If a future change reintroduces either
 * field on the public types, an @ts-expect-error directive becomes unused
 * and tsc fails with TS2578 ("Unused @ts-expect-error directive").
 */
import { SuperDoc } from 'superdoc';
import type { Config, SuperDocLayoutEngineOptions } from 'superdoc';

declare const config: Config;
declare const layoutOpts: SuperDocLayoutEngineOptions;

// 1. Top-level Config alias must not expose `socket`.
// @ts-expect-error - `socket` is internal-only and must not appear on the
// published Config surface.
void config.socket;

// 2. Top-level SuperDocLayoutEngineOptions alias must not expose
// `semanticOptions`.
// @ts-expect-error - `semanticOptions` is internal-only and must not appear
// on the published SuperDocLayoutEngineOptions surface.
void layoutOpts.semanticOptions;

// 3. Nested path: `Config.layoutEngineOptions` must reach the
// public-surface SuperDocLayoutEngineOptions, not an internal variant. An
// earlier Omit-at-the-boundary attempt fixed (1) and (2) but left this
// nested reference resolving to the un-stripped source.
// @ts-expect-error - `semanticOptions` must not be reachable through
// `Config.layoutEngineOptions` either.
void config.layoutEngineOptions?.semanticOptions;

// 4. Constructor path: `new SuperDoc({ socket })` must not type-check. The
// constructor signature published in SuperDoc.d.ts must reach the same
// public-surface Config the standalone alias points at.
// @ts-expect-error - `socket` is not part of the public Config and must
// not be assignable through the SuperDoc constructor.
new SuperDoc({ selector: '#x', socket: undefined });
