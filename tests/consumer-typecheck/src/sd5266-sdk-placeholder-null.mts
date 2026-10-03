import type { SuperDocDocument } from '../../../packages/sdk/langs/node/dist/index.js';

declare const doc: SuperDocDocument;
const target = { kind: 'block', nodeType: 'sdt', nodeId: 'placeholder-target' } as const;

const result = await doc.contentControls.patch({ target, placeholder: null, alias: 'Must remain unchanged' });
result.success satisfies boolean;
