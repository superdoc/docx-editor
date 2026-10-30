import type { DocumentApi, TrackChangeType } from '@superdoc/document-api';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Success<T> = Extract<Awaited<T>, { success: true }>;
type StyleResult = Success<ReturnType<DocumentApi['lists']['getStyle']>>;
type StyleLevel = StyleResult['style']['levels'][number];
type SectionBreak = Success<ReturnType<DocumentApi['create']['sectionBreak']>>;
type TableDefault = Success<ReturnType<DocumentApi['tables']['setDefaultStyle']>>;
type Converted = Success<ReturnType<DocumentApi['lists']['convertToText']>>;
type Extracted = ReturnType<DocumentApi['extract']>;
type _Restart = Assert<Equal<StyleLevel['lvlRestart'], number | undefined>>;
type _Changed = Assert<Equal<TableDefault['changed'], boolean | undefined>>;
type _ExtractVocabulary = Assert<Equal<Extracted['trackedChanges'][number]['type'], TrackChangeType>>;
type _NoListItemLeak = Assert<Equal<'item' extends keyof Converted ? true : false, false>>;
type _RejectsRestartString = Assert<{ level: number; lvlRestart: string } extends StyleLevel ? false : true>;

const level: StyleLevel = { level: 1, lvlRestart: 0 };
const sectionBreak: SectionBreak = {
  success: true,
  section: { kind: 'section', sectionId: 'section-1' },
  trackedChangeRefs: [{ kind: 'entity', entityType: 'trackedChange', entityId: 'section-change' }],
};
const tableDefault: TableDefault = { success: true, changed: false };
declare const doc: DocumentApi;
const target = { kind: 'block', nodeType: 'listItem', nodeId: 'list-1' } as const;
void doc.lists.applyStyle({ target, style: { version: 1, levels: [level] } });
void doc.lists.applyTemplate({ target, template: { version: 1, levels: [level] } });
void doc.create.sectionBreak({ at: { kind: 'documentEnd' } });
void doc.tables.setDefaultStyle({ styleId: 'TableNormal' });
void sectionBreak;
void tableDefault;
