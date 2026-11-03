import type { FlowBlock } from 'superdoc';

type ParagraphRun = Extract<FlowBlock, { kind: 'paragraph' }>['runs'][number];
type TextRun = Extract<ParagraphRun, { kind: 'text' }>;

const textRun: TextRun = { kind: 'text', text: 'Hello', fontFamily: 'Arial', fontSize: 16 };

// @ts-expect-error A text run must declare kind 'text'.
const kindlessRun: TextRun = { text: 'Hello', fontFamily: 'Arial', fontSize: 16 };

const runs: ParagraphRun[] = [textRun, { kind: 'tab', text: '\t' }];
const found = runs.find((run) => run.kind === 'text');
const foundText: string | undefined = found?.kind === 'text' ? found.text : undefined;
const narrowedInFilter: string[] = runs.filter((run): run is TextRun => run.kind === 'text').map((run) => run.text);

void [kindlessRun, foundText, narrowedInFilter];
