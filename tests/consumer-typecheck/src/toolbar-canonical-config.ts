/** Consumer typecheck: canonical toolbar configuration is discoverable and typo-resistant. */
import type {
  Config,
  FontFamilyOption,
  BuiltInCommandId,
  ToolbarCommandId,
  ToolbarConfig,
  ToolbarCustomItem,
  ToolbarCustomButtonConfig,
  ToolbarCustomDropdownConfig,
  ToolbarCustomOption,
  ToolbarCustomButtonCommandId,
  ToolbarCustomDropdownCommandId,
  ToolbarCustomItemSelectContext,
  ToolbarIconId,
  ToolbarItemId,
  ToolbarRegion,
  ToolbarStringId,
} from 'superdoc';

const buttonPriority: ToolbarCustomButtonConfig['overflowPriority'] = 10;
const dropdownPriority: ToolbarCustomDropdownConfig['overflowPriority'] = undefined;
const readablePriority: number | undefined = buttonPriority;
const describedOption: ToolbarCustomOption = {
  id: 'sidebar',
  label: 'Sidebar',
  description: 'Show comments beside the document.',
};
const description: string | undefined = describedOption.description;
// @ts-expect-error Descriptions are plain text.
const invalidDescription: ToolbarCustomOption = { id: 'invalid', label: 'Invalid', description: 2 };
void [description, invalidDescription];

const region: ToolbarRegion = 'center';
const item: ToolbarItemId = 'document-mode';
const icon: ToolbarIconId = 'document-mode-editing';
const string: ToolbarStringId = 'document-mode-editing-description';
const builtInCommand: BuiltInCommandId = 'document-mode';
const applicationCommand: ToolbarCommandId = 'save-document';
const customButtonCommand: ToolbarCustomButtonCommandId = 'bold';
const pageNumberButtonCommand: ToolbarCustomButtonCommandId = 'page-number-insert';
const pageNumbersButtonCommand: ToolbarCustomButtonCommandId = 'page-numbers-apply';
const removePageNumbersButtonCommand: ToolbarCustomButtonCommandId = 'page-numbers-remove';
const customDropdownCommand: ToolbarCustomDropdownCommandId = 'font-family';
const fontOption: FontFamilyOption = { value: 'Inter', label: 'Inter' };
const toolbarFontOption: NonNullable<ToolbarConfig['fontOptions']>[number] = fontOption;

const itemIds = {
  undo: true,
  redo: true,
  'track-changes-accept-selection': true,
  'track-changes-reject-selection': true,
  search: true,
  zoom: true,
  'font-family': true,
  'font-size': true,
  bold: true,
  italic: true,
  underline: true,
  strikethrough: true,
  'text-color': true,
  'highlight-color': true,
  link: true,
  image: true,
  'table-of-contents': true,
  watermark: true,
  'page-number': true,
  table: true,
  'table-actions': true,
  'text-align': true,
  'bullet-list': true,
  'numbered-list': true,
  'indent-decrease': true,
  'indent-increase': true,
  'line-height': true,
  'linked-style': true,
  ruler: true,
  'measurement-unit': true,
  'comments-layout': true,
  'formatting-marks': true,
  'copy-format': true,
  'clear-formatting': true,
  ai: true,
  'document-mode': true,
} as const satisfies Record<ToolbarItemId, true>;

const customItems = [
  {
    type: 'button',
    id: 'save',
    label: 'Save',
    region: 'right',
    size: 'compact',
    overflowPriority: 10,
    onSelect: (context: ToolbarCustomItemSelectContext) => context.documentMode,
  },
  {
    type: 'dropdown',
    id: 'status',
    label: 'Status',
    overflowPriority: 20,
    options: [
      { id: 'draft', label: 'Draft' },
      { id: 'approved', label: 'Approved', value: 2, description: 'Ready to share with reviewers.' },
    ],
    onSelect: ({ value }) => value,
  },
  {
    type: 'button',
    id: 'registered-command',
    label: 'Save',
    onSelect: ({ executeAsync }) => executeAsync('save-document'),
  },
  { type: 'separator', id: 'application-actions', region: 'right' },
] as const satisfies readonly ToolbarCustomItem[];

const toolbar = {
  container: '#toolbar',
  items: {
    left: ['undo', 'redo'],
    center: ['font-family', 'bold', 'italic'],
    right: ['document-mode'],
  },
  includeItems: ['formatting-marks'],
  excludeItems: ['image', 'table'],
  icons: { 'document-mode-editing': '<svg />' },
  strings: { 'document-mode-editing': 'Write' },
  overflow: 'menu',
  responsiveTo: 'container',
  fontOptions: [fontOption],
  customItems,
} as const satisfies ToolbarConfig;

const _config: Config = { selector: '#editor', ui: { toolbar } };

// Page number is opt-in: through includeItems or an explicit items placement.
const pageNumberIncluded = { includeItems: ['page-number'] } as const satisfies ToolbarConfig;
const pageNumberPlaced = {
  items: { center: ['bold', 'page-number'] },
  icons: { 'page-number': '<svg />' },
  strings: { 'page-number': 'Page number' },
} as const satisfies ToolbarConfig;

// @ts-expect-error toolbar regions are left, center, or right
const _badRegion: ToolbarRegion = 'bottom';
// @ts-expect-error item ids are the controls the built-in toolbar exposes
const _badItem: ToolbarItemId = 'bolder';
// @ts-expect-error icon keys name real toolbar icon slots
const _badIcon: ToolbarIconId = 'document-editing';
// @ts-expect-error string keys name real toolbar text slots
const _badString: ToolbarStringId = 'editing-description';
// @ts-expect-error built-in command ids are closed; use ToolbarCommandId for registered application commands
const _badCommand: BuiltInCommandId = 'save-document';
// @ts-expect-error icon-only custom items need an accessible name
const _badIconOnlyItem: ToolbarCustomItem = { type: 'button', id: 'save', icon: '<svg />', onSelect: () => {} };
const _badButtonCommand: ToolbarCustomItem = {
  type: 'button',
  id: 'table',
  label: 'Table',
  // @ts-expect-error table insertion needs an object payload; use onSelect and executeAsync
  command: 'table-insert',
};
const _badDropdownCommand: ToolbarCustomItem = {
  type: 'dropdown',
  id: 'table',
  label: 'Table',
  // @ts-expect-error table insertion needs an object payload; use onSelect and executeAsync
  command: 'table-insert',
  options: [{ id: 'two-by-two', label: '2 × 2', value: 2 }],
};
const _badRegisteredCommand: ToolbarCustomItem = {
  type: 'button',
  id: 'save',
  label: 'Save',
  // @ts-expect-error registered commands use onSelect so their payload and result stay explicit
  command: 'save-document',
};

void [
  buttonPriority,
  dropdownPriority,
  readablePriority,
  _config,
  region,
  item,
  icon,
  string,
  builtInCommand,
  applicationCommand,
  customButtonCommand,
  pageNumberButtonCommand,
  pageNumbersButtonCommand,
  removePageNumbersButtonCommand,
  pageNumberIncluded,
  pageNumberPlaced,
  customDropdownCommand,
  fontOption,
  toolbarFontOption,
  itemIds,
  _badRegion,
  _badItem,
  _badIcon,
  _badString,
  _badCommand,
  _badIconOnlyItem,
  _badButtonCommand,
  _badDropdownCommand,
  _badRegisteredCommand,
];
