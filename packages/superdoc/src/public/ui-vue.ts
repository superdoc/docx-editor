/**
 * SuperDoc public facade: `superdoc/ui/vue` entry.
 *
 * v2-native Vue bindings for the SuperDoc-owned UI controller
 * (`superdoc.ui`): the provider composable, lifecycle binding composables, the
 * generic slice composable, and the domain composables. This layer consumes the
 * controller; SuperDoc creates and destroys it.
 *
 * v2 NOTE: this is NOT a revival of the removed v1 headless-toolbar Vue
 * subpath. It routes through the local, self-contained v2 Vue layer under
 * `./ui/vue.ts`, which is built on the v2-native controller. No v1 Vue
 * bindings and no private v2 runtime imports.
 *
 * Rules for this file:
 *   - AIDEV-NOTE: Named exports only. No `export *`.
 *   - AIDEV-NOTE: `verify-public-facade-emit.cjs` parses this file and verifies
 *     the emitted declarations expose exactly these named exports.
 */

export {
  provideSuperDocUI,
  useSuperDocUI,
  useSuperDocHost,
  useSetSuperDoc,
  useClearSuperDoc,
  useSuperDocSlice,
  useSuperDocSelection,
  useSuperDocSearch,
  useSuperDocComments,
  useSuperDocContentControls,
  useSuperDocTrackChanges,
  useSuperDocToolbar,
  useSuperDocCommand,
  useSuperDocDocument,
  useSuperDocFontOptions,
  useSuperDocFontSizeOptions,
  useSuperDocZoom,
} from './ui/vue.js';

export type { SuperDocHost, SuperDocUIBinding, UseSuperDocCommandResult } from './ui/vue.js';
