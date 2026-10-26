/**
 * SuperDoc public facade: `superdoc/ui/react` entry.
 *
 * v2-native React bindings for the SuperDoc-owned UI controller
 * (`superdoc.ui`): the provider, the bind hook, the generic slice hook, and
 * the domain hooks. This layer consumes the controller; SuperDoc creates and
 * destroys it.
 *
 * v2 NOTE: this is NOT the v1 re-export. It routes through the local,
 * self-contained v2 React layer under `./ui/react.ts`, which is built on the
 * v2-native controller. No v1 React bindings and no private v2 runtime
 * imports.
 */

export {
  SuperDocUIProvider,
  useSuperDocUI,
  useSuperDocHost,
  useSetSuperDoc,
  useSuperDocSlice,
  useSuperDocSelection,
  useSuperDocSearch,
  useSuperDocComments,
  useSuperDocContentControls,
  useSuperDocTrackChanges,
  useSuperDocToolbar,
  useSuperDocCommand,
  useSuperDocDocument,
  useSuperDocDocumentApi,
  useSuperDocFontOptions,
  useSuperDocFontSizeOptions,
  useSuperDocZoom,
} from './ui/react.js';

export type { SuperDocHost, SuperDocUIProviderProps, UseSuperDocCommandResult } from './ui/react.js';
