export type LifecycleStageId = 'mount' | 'ready' | 'edit' | 'export' | 'unmount';

export type LifecycleStage = {
  id: LifecycleStageId;
  label: string;
  signal: string;
  title: string;
  description: string;
  code: string;
  appStatus: string;
  appTone: 'neutral' | 'ready' | 'dirty';
  appView: 'loading' | 'document' | 'edited' | 'exported' | 'unmounted';
  actionsEnabled: boolean;
};

export const lifecycleStages: readonly LifecycleStage[] = [
  {
    id: 'mount',
    label: 'Mount',
    signal: 'new SuperDoc()',
    title: 'Show a loading state',
    description: 'Keep document actions disabled while the DOCX opens.',
    code: `const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
});`,
    appStatus: 'Opening…',
    appTone: 'neutral',
    appView: 'loading',
    actionsEnabled: false,
  },
  {
    id: 'ready',
    label: 'Ready',
    signal: 'onReady',
    title: 'Enable document actions',
    description: 'The document is available. Enable Export and run document queries.',
    code: `onReady: () => {
  exportButton.disabled = false;
  setStatus('Ready');
},`,
    appStatus: 'Ready',
    appTone: 'ready',
    appView: 'document',
    actionsEnabled: true,
  },
  {
    id: 'edit',
    label: 'Edit',
    signal: 'onEditorUpdate',
    title: 'Mark the document unsaved',
    description: 'Mark changes to document content as unsaved. Moving the cursor does not count as an edit.',
    code: `onEditorUpdate: () => {
  setStatus('Unsaved changes');
},`,
    appStatus: 'Unsaved changes',
    appTone: 'dirty',
    appView: 'edited',
    actionsEnabled: true,
  },
  {
    id: 'export',
    label: 'Export',
    signal: 'export()',
    title: 'Download a copy',
    description: 'Export downloads a DOCX. Changes remain unsaved in your application until your backend stores them.',
    code: `await superdoc.export({
  exportedName: 'sample-edited',
});`,
    appStatus: 'Unsaved changes',
    appTone: 'dirty',
    appView: 'exported',
    actionsEnabled: true,
  },
  {
    id: 'unmount',
    label: 'Unmount',
    signal: 'destroy()',
    title: 'Release the Editor',
    description: 'Call destroy() when the route or component that owns the Editor unmounts.',
    code: `function cleanup() {
  superdoc.destroy();
}`,
    appStatus: 'Unmounted',
    appTone: 'neutral',
    appView: 'unmounted',
    actionsEnabled: false,
  },
] as const;

export const lifecycleFailure = {
  id: 'failure',
  label: 'Load fails',
  signal: 'onContentError / onException',
  title: 'Show a useful error',
  description: 'Keep document actions disabled. Show a retry path instead of an empty mount point.',
  code: `onContentError: ({ error }) => showLoadError(error),
onException: ({ error }) => showLoadError(error),`,
  appStatus: 'Could not open',
  appTone: 'error',
  appView: 'error',
  actionsEnabled: false,
} as const;

export function renderLifecycleJourneyMarkdown() {
  const stages = lifecycleStages.map(
    (stage, index) => `${index + 1}. **${stage.label} — \`${stage.signal}\`:** ${stage.title}. ${stage.description}`,
  );

  return [
    '> **Interactive model: the Editor lifecycle in your application**',
    '>',
    '> The preview moves `/sample.docx` through the application states that matter to a user.',
    '>',
    ...stages.map((stage) => `> ${stage}`),
    '>',
    `> **${lifecycleFailure.label} — \`${lifecycleFailure.signal}\`:** ${lifecycleFailure.title}. ${lifecycleFailure.description}`,
    '',
  ].join('\n');
}
