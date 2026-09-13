import generatedEditorConfig from '@/generated/editor-config-reference.json';
import type { ConfigExplorerData, ConfigField, ConfigFieldExample, ConfigFieldGuide } from './config-explorer';
import type { Config } from 'superdoc';

type ConfigFieldName = Extract<keyof Config, string>;
type ConfigGroupId = 'essentials' | 'document' | 'interface' | 'behavior' | 'integrations' | 'lifecycle' | 'advanced';

type ConfigPresentation = {
  type?: ConfigField['type'];
  kind?: ConfigField['kind'];
  default?: string;
  example?: ConfigFieldExample;
  guide?: ConfigFieldGuide;
  status?: string;
};

const fieldsByGroup = {
  essentials: ['selector', 'document', 'documentMode', 'user'],
  document: [
    'viewing',
    'role',
    'allowSelectionInViewMode',
    'superdocId',
    'password',
    'documents',
    'fieldContext',
    'users',
    'colors',
    'format',
    'title',
    'jsonOverride',
    'html',
    'markdown',
  ],
  interface: [
    'ui',
    'interaction',
    'surfaces',
    'toolbar',
    'toolbarGroups',
    'toolbarIcons',
    'toolbarTexts',
    'uiDisplayFallbackFont',
    'conversations',
    'comments',
    'rulers',
    'rulerContainer',
    'disableContextMenu',
  ],
  behavior: [
    'fieldUpdatePolicy',
    'hyperlinks',
    'trackChanges',
    'isLocked',
    'lockedBy',
    'suppressDefaultDocxStyles',
    'warnOnUnsupportedContent',
    'viewOptions',
    'contained',
    'zoom',
    'measurementUnit',
  ],
  integrations: [
    'modules',
    'permissionResolver',
    'editorExtensions',
    'extensions',
    'handleImageUpload',
    'cspNonce',
    'licenseKey',
    'telemetry',
    'proofing',
    'fonts',
    'workerUrls',
  ],
  lifecycle: [
    'onReady',
    'onContentError',
    'onException',
    'onEditorBeforeCreate',
    'onEditorCreate',
    'onSourceComplete',
    'onSourceSignalsComplete',
    'onTransaction',
    'onEditorDestroy',
    'onCommentsUpdate',
    'onContentControlActiveChange',
    'onContentControlClick',
    'onAwarenessUpdate',
    'onLocked',
    'onPdfDocumentReady',
    'onSidebarToggle',
    'onCollaborationReady',
    'onEditorUpdate',
    'onTrackedChangesBulkDecision',
    'onCommentsListChange',
    'onPaginationUpdate',
    'onListDefinitionsChange',
    'onZoomChange',
    'onViewportChange',
    'onPageMarginsChange',
    'onUnsupportedContent',
    'onFontsResolved',
    'onPageCountKnown',
    'onFontsChanged',
  ],
  advanced: [
    'isDev',
    'disablePiniaDevtools',
    'layoutEngineOptions',
    'experimental',
    'isInternal',
    'isDebug',
    'workerStartupTimeoutMs',
    'useLayoutEngine',
  ],
} satisfies Record<ConfigGroupId, readonly ConfigFieldName[]>;

const summaries = {
  superdocId: 'Set an ID for this Editor instance.',
  selector: 'Choose the element where the Editor mounts.',
  documentMode: 'Start in editing, suggesting, or viewing mode.',
  viewing: 'Choose what comments and tracked changes viewers see.',
  allowSelectionInViewMode: 'Let viewers select text without editing.',
  role: 'Limit which document modes the current user can enter.',
  document: 'Open a document from a URL, File, Blob, or collaboration source.',
  password: 'Open an encrypted DOCX with its password.',
  documents: 'Load documents through the legacy multi-document field.',
  fieldContext: 'Provide V2 field values for one initial document; use Document.fieldContext for multiple documents.',
  fieldUpdatePolicy: 'Refresh supported unlocked V2 fields when opening a local editable document.',
  user: 'Identify the current user for collaboration and tracked changes.',
  users: 'Provide the people available for mentions.',
  colors: 'Provide awareness colors for users.',
  ui: 'Choose which built-in interface parts SuperDoc renders.',
  interaction: 'Set what people can do through Editor interactions.',
  surfaces: 'Configure dialogs and floating overlays.',
  modules: 'Configure document features that do not belong to the built-in interface.',
  permissionResolver: 'Customize client-side permission decisions.',
  toolbar: 'Choose where the built-in toolbar renders.',
  toolbarGroups: 'Choose which toolbar groups appear.',
  toolbarIcons: 'Replace icons in the built-in toolbar.',
  toolbarTexts: 'Replace text in the built-in toolbar.',
  uiDisplayFallbackFont: 'Set the font used by SuperDoc interface elements.',
  isDev: 'Enable development behavior for this instance.',
  disablePiniaDevtools: 'Disable Pinia and Vue devtools for this instance.',
  layoutEngineOptions: 'Override page layout and rendering behavior.',
  experimental: 'Configure experimental Editor features.',
  onEditorBeforeCreate: 'Run code before an editor is created.',
  onEditorCreate: 'Run code after an editor is created.',
  onSourceComplete: 'Run code when the document is ready for diff capture.',
  onSourceSignalsComplete: 'Run code after source signals finish building.',
  onTransaction: 'Observe each editor transaction.',
  onEditorDestroy: 'Run cleanup after an editor is destroyed.',
  onContentError: 'Handle document import and content errors.',
  onReady: 'Enable document actions after the Editor is ready.',
  onCommentsUpdate: 'React when comments change.',
  onContentControlActiveChange: 'React when the active content control changes.',
  onContentControlClick: 'React when a person selects a content control.',
  onAwarenessUpdate: 'React when collaboration awareness changes.',
  onLocked: 'React when the Editor locks or unlocks.',
  onPdfDocumentReady: 'Run code when a PDF document is ready.',
  onSidebarToggle: 'React when the sidebar opens or closes.',
  onCollaborationReady: 'Enable shared-document actions when collaboration is ready.',
  onEditorUpdate: 'React after document content changes.',
  onTrackedChangesBulkDecision: 'React after Accept All or Reject All finishes, including permission-denied counts.',
  onException: 'Handle SuperDoc runtime exceptions.',
  onCommentsListChange: 'React when the comments list is rendered.',
  onPaginationUpdate: 'Read the page count after a layout update.',
  onListDefinitionsChange: 'React when list definitions change.',
  onZoomChange: 'React when the zoom level changes.',
  onViewportChange: 'React when fit-to-width measurements change.',
  onPageMarginsChange: 'React after a ruler drag changes a section margin.',
  format: 'Declare the input document format.',
  editorExtensions: 'Legacy v1 extension field. SuperDoc v2 ignores it.',
  extensions: 'Add extensions created with `defineSuperDocExtension`.',
  isInternal: 'Set whether the current user creates and reviews internal comments.',
  title: 'Set the fallback filename used when exporting.',
  conversations: 'Load conversation data.',
  comments: 'Legacy comment visibility setting.',
  hyperlinks: 'Choose what happens when a person activates a hyperlink.',
  trackChanges: 'Configure replacement review and tracked-change colors.',
  isLocked: 'Set the initial shared lock metadata.',
  handleImageUpload: 'Store images inserted into the document.',
  lockedBy: 'Identify the user who locked the Editor.',
  rulers: 'Show the measurement ruler.',
  rulerContainer: 'Choose where the ruler renders.',
  suppressDefaultDocxStyles: 'Skip SuperDoc default DOCX styles.',
  jsonOverride: 'Replace imported content with JSON.',
  disableContextMenu: 'Disable the built-in slash and context menu.',
  html: 'Initialize the Editor with HTML.',
  markdown: 'Initialize the Editor with Markdown.',
  onUnsupportedContent: 'Handle HTML elements dropped during import.',
  warnOnUnsupportedContent: 'Warn when HTML import drops unsupported elements.',
  isDebug: 'Enable debug behavior.',
  viewOptions: 'Set DOCX-compatible document view options.',
  contained: 'Keep the Editor inside a fixed-height scrolling container.',
  cspNonce: 'Apply a Content Security Policy nonce to SuperDoc runtime styles.',
  licenseKey: 'Set the client-visible license identity sent with document-open telemetry.',
  telemetry: 'Configure telemetry sent when a DOCX becomes ready.',
  proofing: 'Configure spelling and grammar checks.',
  fonts: 'Configure document fonts and font asset loading.',
  workerUrls: 'Load browser workers from same-origin URLs.',
  workerStartupTimeoutMs: 'Set how long the document worker may take to start.',
  useLayoutEngine: 'Pass or omit layout engine options when a DOCX editor opens.',
  zoom: 'Set the initial zoom and fit-to-width behavior.',
  measurementUnit: 'Set the ruler and measurement unit.',
  onFontsResolved: 'Receive the early font-resolution report.',
  onPageCountKnown: 'Read the page count before paint.',
  onFontsChanged: 'Receive final font loading and substitution results.',
} satisfies Record<ConfigFieldName, string>;

const lifecycleGuide = { label: 'Lifecycle and events', href: '/editor/lifecycle-and-events' } as const;

const presentation = {
  selector: {
    kind: 'starter',
    example: { value: "'#editor'", code: "selector: '#editor'" },
  },
  document: {
    kind: 'starter',
    example: { value: "'/sample.docx'", code: "document: '/sample.docx'" },
    guide: { label: 'Load and save documents', href: '/editor/load-and-save-documents' },
  },
  documentMode: {
    kind: 'starter',
    default: "'editing'",
    example: { value: "'suggesting'", code: "documentMode: 'suggesting'" },
    guide: { label: 'Document modes', href: '/editor/document-modes' },
  },
  viewing: {
    default: "{ comments: false, trackedChanges: 'original' }",
    example: {
      value: "{ comments: true, trackedChanges: 'markup' }",
      code: "viewing: {\n  comments: true,\n  trackedChanges: 'markup',\n}",
    },
    guide: { label: 'Document modes', href: '/editor/document-modes' },
  },
  allowSelectionInViewMode: {
    default: 'false',
    guide: { label: 'Document modes', href: '/editor/document-modes' },
  },
  user: {
    kind: 'starter',
    example: {
      value: "{ name: 'Jordan Lee', … }",
      code: "user: {\n  name: 'Jordan Lee',\n  email: 'jordan@example.com',\n}",
    },
  },
  ui: {
    example: {
      value: '{ toolbar: … }',
      code: "ui: { toolbar: { container: '#toolbar' } }",
    },
    guide: { label: 'Choose your interface', href: '/editor/who-renders-the-ui' },
  },
  interaction: {
    type: `{
  comments?: { level?: CommentInteractionLevel; };
  trackedChanges?: { allowDecisions?: boolean; };
}`,
    example: { value: '{ comments: … }', code: "interaction: { comments: { level: 'read' } }" },
    guide: { label: 'Choose your interface', href: '/editor/who-renders-the-ui' },
  },
  surfaces: {
    example: { value: '{ dialog: … }', code: 'surfaces: { dialog: { closeOnEscape: true } }' },
    guide: { label: 'Dialogs and surfaces', href: '/editor/dialogs-and-surfaces' },
  },
  hyperlinks: {
    example: { value: '{ onActivate: … }', code: 'hyperlinks: { onActivate: handleHyperlinkActivation }' },
    guide: { label: 'Hyperlinks', href: '/editor/built-in-ui/hyperlinks' },
  },
  toolbar: {
    example: { value: "'#toolbar'", code: "toolbar: '#toolbar'" },
    guide: { label: 'Configure the toolbar', href: '/editor/built-in-ui/configure-the-toolbar' },
  },
  toolbarGroups: {
    guide: { label: 'Configure the toolbar', href: '/editor/built-in-ui/configure-the-toolbar' },
  },
  toolbarIcons: {
    guide: { label: 'Configure the toolbar', href: '/editor/built-in-ui/configure-the-toolbar' },
  },
  toolbarTexts: {
    guide: { label: 'Configure the toolbar', href: '/editor/built-in-ui/configure-the-toolbar' },
  },
  uiDisplayFallbackFont: {
    example: { value: "'Inter, sans-serif'", code: "uiDisplayFallbackFont: 'Inter, sans-serif'" },
  },
  trackChanges: {
    default: "{ enabled: true, replacementMode: 'grouped' }",
    example: {
      value: "{ replacementMode: 'separate' }",
      code: "trackChanges: { replacementMode: 'separate' }",
    },
    guide: { label: 'Track changes', href: '/editor/track-changes' },
  },
  comments: {
    status: 'Deprecated. Use viewing.comments.',
    guide: { label: 'Document modes', href: '/editor/document-modes' },
  },
  contained: {
    default: 'false',
    example: { value: 'true', code: 'contained: true' },
    guide: { label: 'Responsive layout', href: '/editor/built-in-ui/responsive-layout' },
  },
  zoom: {
    default: "{ initial: 100, mode: 'manual' }",
    example: { value: "{ mode: 'fit-width' }", code: "zoom: { mode: 'fit-width' }" },
    guide: { label: 'Responsive layout', href: '/editor/built-in-ui/responsive-layout' },
  },
  measurementUnit: {
    default: "'in'",
    example: { value: "'cm'", code: "measurementUnit: 'cm'" },
    guide: { label: 'Ruler', href: '/editor/built-in-ui/ruler' },
  },
  onPageMarginsChange: {
    example: {
      value: '({ side, value }) => { … }',
      code: 'onPageMarginsChange: ({ side, value }) => {\n  console.info(side, value);\n}',
    },
    guide: { label: 'Ruler', href: '/editor/built-in-ui/ruler' },
  },
  modules: {
    type: '{\n  trackChanges?: TrackChangesModuleConfig;\n}',
    status: 'The trackChanges module path is deprecated. Use the top-level trackChanges field.',
  },
  editorExtensions: {
    status: 'Ignored by superdoc@2. Use extensions.',
  },
  extensions: {
    example: { value: '[myExtension]', code: 'extensions: [myExtension]' },
  },
  cspNonce: {
    guide: { label: 'Secure integration', href: '/editor/secure-integration' },
  },
  licenseKey: {
    example: { value: 'licenseKey', code: 'licenseKey' },
    guide: { label: 'License', href: '/editor/license' },
  },
  telemetry: {
    type: '{\n  enabled: boolean;\n  endpoint?: string;\n  metadata?: Record<string, unknown>;\n}',
    default: '{ enabled: true }',
    example: { value: '{ enabled: false }', code: 'telemetry: { enabled: false }' },
    guide: { label: 'Telemetry', href: '/editor/telemetry' },
  },
  proofing: {
    example: { value: '{ enabled, provider }', code: 'proofing: { enabled: true, provider }' },
    guide: { label: 'Add proofing', href: '/editor/platform/proofing' },
  },
  fonts: {
    example: { value: '{ assetBaseUrl: … }', code: "fonts: { assetBaseUrl: '/fonts/' }" },
  },
  workerUrls: {
    example: { value: '{ document: … }', code: "workerUrls: { document: '/workers/document.js' }" },
    guide: { label: 'Secure integration', href: '/editor/secure-integration' },
  },
  onReady: {
    kind: 'starter',
    example: {
      value: '() => { … }',
      code: "onReady: () => {\n  console.info('SuperDoc is ready.');\n}",
    },
    guide: lifecycleGuide,
  },
  onContentError: {
    kind: 'starter',
    example: {
      value: '({ error }) => { … }',
      code: 'onContentError: ({ error }) => {\n  console.error(error);\n}',
    },
    guide: lifecycleGuide,
  },
  onException: {
    kind: 'starter',
    example: { value: '({ error }) => { … }', code: 'onException: ({ error }) => {\n  console.error(error);\n}' },
    guide: lifecycleGuide,
  },
  layoutEngineOptions: {
    example: {
      value: '{ virtualization: … }',
      code: 'layoutEngineOptions: {\n  virtualization: { enabled: true, window: 5, overscan: 1 },\n}',
    },
    guide: { label: 'Performance', href: '/editor/performance-and-large-documents' },
  },
  workerStartupTimeoutMs: {
    default: '30000',
    example: { value: '60000', code: 'workerStartupTimeoutMs: 60000' },
    guide: { label: 'Performance', href: '/editor/performance-and-large-documents' },
  },
} satisfies Partial<Record<ConfigFieldName, ConfigPresentation>>;

const configPresentation: Partial<Record<ConfigFieldName, ConfigPresentation>> = presentation;
const generated = generatedEditorConfig as ConfigExplorerData;
const generatedFieldNames = new Set(generated.fields.map((field) => field.name));
const groupByField = new Map<ConfigFieldName, ConfigGroupId>();
const orderByField = new Map<ConfigFieldName, number>();

for (const [group, fields] of Object.entries(fieldsByGroup) as Array<[ConfigGroupId, readonly ConfigFieldName[]]>) {
  for (const field of fields) {
    if (!generatedFieldNames.has(field)) continue;
    if (groupByField.has(field)) throw new Error(`Config field ${field} appears in more than one group.`);
    groupByField.set(field, group);
    orderByField.set(field, orderByField.size);
  }
}

export const editorConfigExplorer: ConfigExplorerData = {
  ...generated,
  fields: generated.fields
    .map((field): ConfigField => {
      const name = field.name as ConfigFieldName;
      const group = groupByField.get(name);
      if (!group) throw new Error(`Generated Config field ${name} needs a presentation group.`);
      const details = configPresentation[name];
      const guide = details?.guide ?? (group === 'lifecycle' ? lifecycleGuide : undefined);
      return { ...field, ...details, summary: summaries[name], group, guide };
    })
    .sort(
      (left, right) =>
        (orderByField.get(left.name as ConfigFieldName) ?? Number.MAX_SAFE_INTEGER) -
        (orderByField.get(right.name as ConfigFieldName) ?? Number.MAX_SAFE_INTEGER),
    ),
};
