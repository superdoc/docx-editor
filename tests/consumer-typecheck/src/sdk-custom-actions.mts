import {
  defineAction,
  createAgentToolkit,
  type ActionSpec,
  type ActionStep,
  type JSONSchemaObject,
  type AgentToolkit,
  type CreateAgentToolkitInput,
  type BoundDocApi,
} from '../../../packages/sdk/langs/node/dist/index.js';

const input: JSONSchemaObject = { type: 'object', properties: { label: { type: 'string', default: 'CONFIDENTIAL' } } };
const step: ActionStep = { action: 'insert_paragraphs', args: { texts: ['{{label}}'] } };
const stamp: ActionSpec = defineAction({
  name: 'customer.stamp',
  description: 'Stamp a banner.',
  input,
  steps: [step],
});
const native: ActionSpec = defineAction({
  name: 'customer.count',
  description: 'Count blocks.',
  input: { type: 'object', properties: {} },
  async run(doc: BoundDocApi, args: Record<string, unknown>) {
    const result = await doc.blocks.list({});
    result.total satisfies number;
    return { total: result.total, label: args.label };
  },
});
const options: CreateAgentToolkitInput = {
  provider: 'anthropic',
  base: 'core',
  customActions: [stamp],
  includeActions: [],
  cache: true,
};
const toolkit: AgentToolkit = await createAgentToolkit(options);
toolkit.systemPrompt satisfies string;
toolkit.tools satisfies unknown[];
const dispatchResult: Promise<unknown> = toolkit.dispatch({} as BoundDocApi, 'superdoc_perform_action', {
  action: stamp.name,
});
// @ts-expect-error Providers are a closed set.
createAgentToolkit({ provider: 'unsupported', customActions: [stamp] });
void [native, dispatchResult];
