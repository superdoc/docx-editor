import { createSuperDocClient } from '../../../packages/sdk/langs/node/dist/index.js';

const client = createSuperDocClient({ runtime: 'v2' });
const document = await client.open({
  collaboration: { providerType: 'y-websocket', url: 'wss://collaboration.example', params: { room: 'quick' } },
});
const sdkAuthoredPlan = {
  atomic: true,
  changeMode: 'tracked' as const,
  author: { name: 'AI Reviewer' },
  steps: [],
} satisfies Parameters<typeof document.mutations.apply>[0];
const sdkPlanResult = await document.mutations.apply(sdkAuthoredPlan);
sdkPlanResult.success satisfies boolean;
(await document.mutations.preview(sdkAuthoredPlan)).valid satisfies boolean;
const joinedOpen: typeof document.openResult = {
  active: true,
  contextId: 'synthetic-peer',
  sessionType: 'collab',
  bootstrap: null,
};
joinedOpen.bootstrap satisfies
  | { roomState?: string; bootstrapApplied?: boolean; bootstrapSource?: string }
  | null
  | undefined;
await document.lists.create({
  mode: 'empty',
  at: { kind: 'block', nodeType: 'paragraph', nodeId: 'body' },
  preset: 'decimal',
});
// @ts-expect-error Runtime values come from the supported host contract.
createSuperDocClient({ runtime: 'v1' });
await client.open({
  // @ts-expect-error Collaboration query parameter values must be strings.
  collaboration: { providerType: 'y-websocket', url: 'wss://collaboration.example', params: { room: 42 } },
});
await document.lists.create({
  mode: 'empty',
  at: { kind: 'block', nodeType: 'paragraph', nodeId: 'body' },
  // @ts-expect-error Scalar parameter schemas retain the preset enumeration.
  preset: 'invalid',
});

const xml = await document.selection.extractOoxml({});
xml.fragment.namespaces satisfies Record<string, string>;

const comment = await document.comments.create({
  text: 'Comment receipt metadata',
  target: { kind: 'text', blockId: 'body', range: { start: 0, end: 1 } },
});
comment.id satisfies string;
comment.affectedStories?.[0]?.kind satisfies 'story' | undefined;
comment.txId satisfies string | undefined;

const comments = await document.comments.list({});
comments.items[0]?.commentId satisfies string | undefined;
comments.items[0]?.replyCount satisfies number | undefined;
const changes = await document.trackChanges.list({});
changes.items[0]?.navigationTarget?.role satisfies
  | 'primary'
  | 'move-source'
  | 'move-destination'
  | 'formatting-carrier'
  | 'structural-carrier'
  | undefined;
changes.items[0]?.splitFromId satisfies string | null | undefined;

const change = await document.trackChanges.get({ id: 'synthetic' });
if (change.target?.kind === 'text' || change.target?.kind === 'replacement') {
  change.target.segments?.[0]?.range.start satisfies number | undefined;
  change.target.story?.kind satisfies 'story' | undefined;
  change.target.coordinateSpace satisfies 'visible' | 'tracked' | undefined;
}
