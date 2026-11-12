import type { DocumentApi, TextAddress } from 'superdoc';

declare const api: DocumentApi;
declare const targetSnapshot: ReturnType<DocumentApi['diff']['capture']>;

const diff = api.diff.compare({ targetSnapshot, includeDisplay: true });
const target: TextAddress | null | undefined = diff.display?.changes[0]?.targetAnchor;
const before: string | undefined = diff.display?.changes[0]?.before?.text;
const families: string[] | undefined = diff.display?.unrenderedFamilies;
void target;
void before;
void families;
