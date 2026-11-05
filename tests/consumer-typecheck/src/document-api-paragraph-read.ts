import type { DocumentApi } from 'superdoc';
import type { BrowserDocumentApi } from 'superdoc/ui';

declare const doc: DocumentApi;
declare const browserDoc: BrowserDocumentApi;

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type NodeResult = Awaited<ReturnType<DocumentApi['getNode']>>;
type BrowserNodeResult = Awaited<ReturnType<BrowserDocumentApi['getNode']>>;
type _BrowserReadParity = Assert<Equal<NodeResult, BrowserNodeResult>>;
type CharacterKey = 'leftChars' | 'rightChars' | 'startChars' | 'endChars' | 'firstLineChars' | 'hangingChars';
type SetterInput = Parameters<DocumentApi['format']['paragraph']['setIndentation']>[0];
type BatchInput = Parameters<DocumentApi['format']['paragraph']['applyBatch']>[0];
type IndentAction = Extract<BatchInput['operations'][number], { operationId: 'format.paragraph.setIndentation' }>;
type _SetterStaysClosed = Assert<Equal<Extract<keyof SetterInput, CharacterKey>, never>>;
type _BatchStaysClosed = Assert<Equal<Extract<keyof IndentAction['input'], CharacterKey>, never>>;

function consume(result: NodeResult) {
  const node = result.node;
  const paragraph = node.kind === 'paragraph' ? node.paragraph : node.kind === 'heading' ? node.heading : undefined;
  const indent = paragraph?.props?.indent;
  const leftHundredthsOfCharacter: number | undefined = indent?.leftChars;
  const rightHundredthsOfCharacter: number | undefined = indent?.rightChars;
  const startHundredthsOfCharacter: number | undefined = indent?.startChars;
  const endHundredthsOfCharacter: number | undefined = indent?.endChars;
  const firstLineHundredthsOfCharacter: number | undefined = indent?.firstLineChars;
  const hangingHundredthsOfCharacter: number | undefined = indent?.hangingChars;
  const leftPoints: number | undefined = indent?.left;
  type _OptionalNumber = Assert<Equal<NonNullable<typeof indent>['firstLineChars'], number | undefined>>;
  return [
    leftHundredthsOfCharacter,
    rightHundredthsOfCharacter,
    startHundredthsOfCharacter,
    endHundredthsOfCharacter,
    firstLineHundredthsOfCharacter,
    hangingHundredthsOfCharacter,
    leftPoints,
  ];
}

async function read() {
  const target = { kind: 'block', nodeType: 'paragraph', nodeId: 'source' } as const;
  consume(await doc.getNode(target));
  consume(await doc.getNodeById({ nodeId: 'source' }));
  consume(await browserDoc.getNode(target));
  consume(await browserDoc.getNodeById({ nodeId: 'source' }));
}
void read;
