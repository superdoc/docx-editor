import type { DocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;

type NodeResult = ReturnType<DocumentApi['getNodeById']>;
type HeadingNode = Extract<NodeResult['node'], { kind: 'heading' }>;
type ReturnedHeadingLevel = HeadingNode['heading']['level'];

const returnedHeadingNine: ReturnedHeadingLevel = 9;
const canonicalHeadingNine: Parameters<DocumentApi['insert']>[0] = {
  content: {
    kind: 'heading',
    heading: {
      level: 9,
      inlines: [{ kind: 'run', run: { text: 'Deep heading' } }],
    },
  },
};

doc.insert(canonicalHeadingNine);

// @ts-expect-error create.heading remains limited to Heading 1-6.
doc.create.heading({ level: 9, text: 'Unsupported create level' });

void returnedHeadingNine;
