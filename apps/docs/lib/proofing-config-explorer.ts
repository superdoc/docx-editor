import type { ConfigExplorerData, ConfigField, ConfigFieldExample } from './config-explorer';
import generatedProofingConfig from '@/generated/proofing-config-reference.json';
import type { ProofingConfig } from 'superdoc';

type ProofingFieldName = keyof ProofingConfig;

type ProofingPresentation = {
  group: 'core' | 'behavior' | 'callbacks' | 'reserved';
  kind?: ConfigField['kind'];
  default?: string;
  example?: ConfigFieldExample;
};

// TypeScript owns the API contract. This overlay contains only information a
// type cannot infer: how readers scan the fields, representative examples, and
// which exported fields the current runtime has not implemented yet.
const presentation = {
  enabled: {
    group: 'core',
    kind: 'required-to-run',
    example: { value: 'true', code: 'enabled: true' },
  },
  provider: {
    group: 'core',
    kind: 'required-to-run',
    example: { value: 'myProvider', code: 'provider: myProvider' },
  },
  defaultLanguage: {
    group: 'behavior',
    example: { value: "'en-US'", code: "defaultLanguage: 'en-US'" },
  },
  debounceMs: {
    group: 'behavior',
    example: { value: '300', code: 'debounceMs: 300' },
  },
  maxSuggestions: {
    group: 'behavior',
    example: { value: '5', code: 'maxSuggestions: 5' },
  },
  allowIgnoreWord: {
    group: 'behavior',
    example: { value: 'false', code: 'allowIgnoreWord: false' },
  },
  ignoredWords: {
    group: 'behavior',
    example: { value: "['SuperDoc']", code: "ignoredWords: ['SuperDoc', 'OOXML']" },
  },
  timeoutMs: {
    group: 'behavior',
    example: { value: '4000', code: 'timeoutMs: 4000' },
  },
  onProofingError: {
    group: 'callbacks',
    kind: 'callback',
    example: {
      value: '(error) => { … }',
      code: 'onProofingError: (error) => {\n  console.warn(error.kind, error.message);\n}',
    },
  },
  onStatusChange: {
    group: 'callbacks',
    kind: 'callback',
    example: {
      value: '(status) => { … }',
      code: "onStatusChange: (status) => {\n  spinner.hidden = status !== 'checking';\n}",
    },
  },
  visibleFirst: {
    group: 'reserved',
    kind: 'reserved',
  },
  maxConcurrentRequests: {
    group: 'reserved',
    kind: 'reserved',
  },
  maxSegmentsPerBatch: {
    group: 'reserved',
    kind: 'reserved',
  },
} satisfies Partial<Record<ProofingFieldName, ProofingPresentation>>;

const generated = generatedProofingConfig as ConfigExplorerData;

export const proofingConfigExplorer: ConfigExplorerData = {
  ...generated,
  fields: generated.fields.map((field): ConfigField => {
    const details = presentation[field.name as keyof typeof presentation];
    if (!details) return { ...field, group: 'other' };
    return { ...field, ...details };
  }),
};
