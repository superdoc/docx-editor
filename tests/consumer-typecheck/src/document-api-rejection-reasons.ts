import {
  getDocumentApiRejectionReason,
  type BrowserDocumentApi,
  type DocumentApiRejectionDetails,
  type DocumentApiRejectionReason,
  type TextRangeRejectionReason,
  type ContentControlCreationRejectionReason,
} from 'superdoc/ui';

type DetailsInput = Parameters<typeof getDocumentApiRejectionReason>[0];
type ReasonResult = ReturnType<typeof getDocumentApiRejectionReason>;
const textReason: TextRangeRejectionReason = 'text-range-in-sdt';
const creationReason: ContentControlCreationRejectionReason = 'content-control-shared-run-boundary';
const details: DocumentApiRejectionDetails = { reason: textReason };
const input: DetailsInput = details;
const reason: ReasonResult = getDocumentApiRejectionReason(input);
const knownOrAbsent: DocumentApiRejectionReason | undefined = reason;
const mergeReason: Exclude<ReasonResult, undefined> = 'paragraph-mark-already-deleted';
const mergeDetails: DocumentApiRejectionDetails = { reason: mergeReason };
const mergeResult: DocumentApiRejectionReason | undefined = getDocumentApiRejectionReason(mergeDetails);
// @ts-expect-error Unrelated failures are not text-range rejection reasons.
const unrelated: DocumentApiRejectionReason = 'NO_PREVIOUS_LIST';

function guidance(details: unknown): string | undefined {
  switch (getDocumentApiRejectionReason(details)) {
    case 'text-range-in-sdt':
      return 'Choose editable content.';
    case 'text-range-in-field':
      return 'Choose content outside the field.';
    case 'text-range-in-unsupported-tracked-wrapper':
      return 'Choose a supported tracked range.';
    case 'content-control-unsupported-inline-structure':
      return 'Choose a supported inline selection.';
    case 'content-control-shared-run-boundary':
      return 'Choose a resolvable run boundary.';
    case 'paragraph-mark-already-deleted':
      return 'Move across the deleted paragraph break.';
    case undefined:
      return undefined;
  }
}

export async function checkAndWrite(
  doc: BrowserDocumentApi,
  checkInput: Parameters<BrowserDocumentApi['capabilities']['check']>[0],
  writeInput: Parameters<BrowserDocumentApi['replace']>[0],
) {
  const check = await doc.capabilities.check(checkInput);
  const checkGuidance = guidance(check.failure?.details);
  const receipt = await doc.replace(writeInput);
  return { checkGuidance, receiptGuidance: guidance(receipt.failure?.details) };
}

export function thrownGuidance(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) return;
  const outer = error.details;
  if (typeof outer !== 'object' || outer === null || !('failure' in outer)) return;
  const failure = outer.failure;
  if (typeof failure !== 'object' || failure === null || !('details' in failure)) return;
  return guidance(failure.details);
}

void [knownOrAbsent, creationReason, unrelated, mergeResult];
