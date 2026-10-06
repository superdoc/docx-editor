import type { DiffApplyResult, DiffPayload, DocumentApi } from 'superdoc';

declare const api: DocumentApi;
const targetSnapshot = api.diff.capture();

const diff: DiffPayload = api.diff.compare({ targetSnapshot, styleChangeMode: 'direct' });
const result: DiffApplyResult = api.diff.apply({ diff, styleChangeMode: 'direct' }, { changeMode: 'tracked' });
const styles: { changeMode: 'direct'; partUris: string[] } | undefined = result.styleChanges;
void styles;

// @ts-expect-error Style definitions do not support native tracked replay.
api.diff.apply({ diff, styleChangeMode: 'tracked' });
