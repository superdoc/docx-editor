import {
  createAgentToolkit,
  type AgentInspectResult,
  type BoundDocApi,
} from '../../../packages/sdk/langs/node/dist/index.js';

declare const doc: BoundDocApi;
const toolkit = await createAgentToolkit({ provider: 'openai', preset: 'core' });
const result: unknown = await toolkit.dispatch(doc, 'superdoc_inspect', { includeDomains: ['blocks'] });
void result;
declare const inspection: AgentInspectResult;
for (const textbox of inspection.textboxes) {
  textbox.story.kind satisfies 'story';
  textbox.story.storyType satisfies 'textbox';
  textbox.story.textboxId satisfies string;
  textbox.total satisfies number;
  for (const block of textbox.blocks) {
    block.nodeId satisfies string;
    block.ordinal satisfies number;
    block.text satisfies string;
    block.numbering?.marker satisfies string | null | undefined;
  }
}
