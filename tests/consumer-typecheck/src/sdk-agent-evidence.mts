import {
  createSuperDocClient,
  dispatchSuperDocTool,
  type AgentApplyArgs,
  type AgentVerifyArgs,
  type AgentReceipt,
} from '../../../packages/sdk/langs/node/dist/index.js';
const document = await createSuperDocClient().open({ doc: 'document.docx' });
const apply: AgentApplyArgs = {
  evidence: 'full',
  plan: {
    intent: 'Verify',
    steps: [
      { kind: 'apply', operationId: 'doc.create.paragraph', args: { text: 'Hello' } },
      { kind: 'verify', checks: [{ kind: 'revision-changed' }] },
    ],
  },
};
const verify: AgentVerifyArgs = {
  evidence: 'required',
  checks: [{ kind: 'table-shape', nodeId: 'table', rows: 1, columns: 1 }],
};
const applied: AgentReceipt = (await dispatchSuperDocTool(document, 'agent_apply', apply, {
  preset: 'core',
})) as AgentReceipt;
const verified: AgentReceipt = (await dispatchSuperDocTool(document, 'agent_verify', verify, {
  preset: 'core',
})) as AgentReceipt;
applied.preSnapshot?.counts?.blocks satisfies number | undefined;
verified.postSnapshot?.revision satisfies string | undefined;
const blocks = await document.blocks.list({ nodeIds: ['body'], textSearch: { terms: ['Alpha'], match: 'any' } });
blocks.total satisfies number;
const cells = await document.tables.getCells({ nodeId: 'table' });
cells.cells[0]?.firstParagraphNodeId satisfies string | undefined;
// @ts-expect-error Evidence policy is a closed set.
const invalid: AgentVerifyArgs = { ...verify, evidence: 'none' };

const required: AgentApplyArgs = { ...apply, evidence: 'required' };
const defaults: AgentApplyArgs = { plan: required.plan };
defaults.plan.intent satisfies string;
// @ts-expect-error Evidence policies are validated, not arbitrary strings.
const invalidApply: AgentApplyArgs = { ...apply, evidence: 'none' };
void invalidApply;
applied.preSnapshot?.revision satisfies string | undefined;
applied.postSnapshot?.counts?.paragraphs satisfies number | undefined;
applied.executedOperations?.[0]?.operationId satisfies string | undefined;
applied.verification?.[0]?.passed satisfies boolean | undefined;
applied.status satisfies 'ok' | 'partial' | 'failed' | 'aborted';
