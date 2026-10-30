import type { DocumentApi } from '@superdoc/document-api';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type SectionResult = Awaited<ReturnType<DocumentApi['sections']['setPageSetup']>>;
type DocumentResult = Awaited<ReturnType<DocumentApi['sections']['setOddEvenHeadersFooters']>>;
type SectionSuccess = Extract<SectionResult, { success: true }>;
type DocumentSuccess = Extract<DocumentResult, { success: true }>;
type _SectionFlag = Assert<Equal<SectionSuccess['dryRun'], boolean | undefined>>;
type _DocumentFlag = Assert<Equal<DocumentSuccess['dryRun'], boolean | undefined>>;
type _RejectsSectionString = Assert<
  { success: true; section: SectionSuccess['section']; dryRun: string } extends SectionSuccess ? false : true
>;
type _RejectsDocumentString = Assert<{ success: true; dryRun: string } extends DocumentSuccess ? false : true>;

const section: SectionSuccess = { success: true, section: { kind: 'section', sectionId: 'section-1' }, dryRun: true };
const document: DocumentSuccess = { success: true, dryRun: true };
declare const doc: DocumentApi;
const sectionInput: Parameters<DocumentApi['sections']['setPageSetup']>[0] = {
  target: section.section,
  orientation: 'landscape',
};
const documentInput: Parameters<DocumentApi['sections']['setOddEvenHeadersFooters']>[0] = { enabled: true };
void doc.sections.setPageSetup(sectionInput);
void doc.sections.setOddEvenHeadersFooters(documentInput);
void document;
