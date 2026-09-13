import type { Config, FindReplaceConfig, SearchConfig, SearchFloatingConfig, SearchStrings } from 'superdoc';
import type {
  BorrowedSuperDocUI,
  SearchController,
  SearchHandle,
  SearchQueryOptions,
  SearchSlice,
  SearchSnapshot,
  WorkflowActionResult,
} from 'superdoc/ui';

const strings: SearchStrings = {
  findPlaceholder: 'Find in document',
  noResults: 'No matches',
  previousMatchTitle: 'Previous result',
  replaceAll: 'Replace all',
};

const floating: SearchFloatingConfig = {
  placement: 'bottom-right',
  autoFocus: false,
};

const search: SearchConfig = {
  replaceControls: false,
  includeTrackedDeletions: true,
  strings,
  floating,
};

const config: Config = {
  selector: '#editor',
  ui: { search },
};

const legacyUiConfig: Config = {
  selector: '#editor',
  ui: { search: { replaceEnabled: false, includeDeletedText: true } },
};

declare const ui: BorrowedSuperDocUI;
const handle: SearchController = ui.search;
const options: SearchQueryOptions = {
  caseSensitive: true,
  includeTrackedDeletions: true,
  regex: false,
};
const slice: SearchSnapshot = handle.find('Client', options);
const compatibleHandle: SearchHandle = handle;

// Config types come from `superdoc`; controller types come from `superdoc/ui`.
// Previously published spellings remain source-compatible.
const legacyConfig: FindReplaceConfig = {
  replaceEnabled: false,
  includeDeletedText: true,
  noResultsLabel: 'Nothing found',
};
handle.search('Client', { includeDeletedText: true });

const legacySlice: SearchSlice = {
  query: '',
  total: 0,
  activeIndex: -1,
  open: false,
  available: true,
  caseSensitive: false,
  includeDeletedText: false,
  regex: false,
  canReplace: false,
  // A pre-existing SearchSlice literal keeps compiling without the new field.
};
const legacyHandle: SearchHandle = {
  getSnapshot: () => legacySlice,
  get: () => legacySlice,
  subscribe: () => () => {},
  observe: () => () => {},
  open: (): WorkflowActionResult => ({ ok: true }),
  close: () => {},
  search: () => legacySlice,
  next: (): WorkflowActionResult => ({ ok: false, reason: 'operation-unavailable' }),
  previous: (): WorkflowActionResult => ({ ok: false, reason: 'operation-unavailable' }),
  clear: () => {},
  replace: (): WorkflowActionResult => ({ ok: false, reason: 'operation-unavailable' }),
  replaceAll: (): WorkflowActionResult => ({ ok: false, reason: 'operation-unavailable' }),
};

export {
  config,
  compatibleHandle,
  floating,
  handle,
  legacyConfig,
  legacyHandle,
  legacySlice,
  legacyUiConfig,
  options,
  search,
  slice,
  strings,
};
