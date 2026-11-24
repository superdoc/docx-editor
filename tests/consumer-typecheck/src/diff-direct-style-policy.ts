import type { DiffApplyResult, DiffPayload, DocumentApi } from 'superdoc';

declare const api: DocumentApi;
const targetSnapshot = api.diff.capture();

const diff: DiffPayload = api.diff.compare({
  targetSnapshot,
  styleChangeMode: 'direct',
});
const result: DiffApplyResult = api.diff.apply({ diff, styleChangeMode: 'direct' }, { changeMode: 'tracked' });
const styles: { changeMode: 'direct' | 'tracked'; partUris: string[] } | undefined = result.styleChanges;
void styles;

const trackedDiff: DiffPayload = api.diff.compare({
  targetSnapshot,
  styleChangeMode: 'tracked',
});
const trackedResult: DiffApplyResult = api.diff.apply(
  { diff: trackedDiff, styleChangeMode: 'tracked' },
  { changeMode: 'tracked' },
);
void trackedResult;

// @ts-expect-error Unknown style policies remain invalid.
api.diff.apply({ diff, styleChangeMode: 'unknown' });

const definitionPolicy: Pick<Parameters<typeof api.diff.compare>[0], 'settingsChangeMode' | 'numberingChangeMode'> = {
  settingsChangeMode: 'direct',
  numberingChangeMode: 'direct',
};
const definitions = api.diff.compare({ targetSnapshot, ...definitionPolicy });
const adopted = api.diff.apply({ diff: definitions, ...definitionPolicy }, { changeMode: 'tracked' });
const settings: { changeMode: 'direct'; partUris: string[] } | undefined = adopted.settingsChanges;
const numbering: { changeMode: 'direct'; partUris: string[] } | undefined = adopted.numberingChanges;
void settings;
void numbering;
