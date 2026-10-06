/** Consumer typecheck: document font generics appear in getters and report payloads. */
import type { SuperDoc } from 'superdoc';

type GetOptions = SuperDoc['fonts']['getDocumentFontOptions'];
const getOptionsParameters: Parameters<GetOptions> = [];
declare const options: ReturnType<GetOptions>;
const option: ReturnType<GetOptions>[number] | undefined = options[0];
if (option) {
  const logicalFamily: string = option.logicalFamily;
  const previewFamily: string = option.previewFamily;
  const genericFamily: string | null = option.genericFamily;
  void [logicalFamily, previewFamily, genericFamily];
}

declare const superdoc: SuperDoc;
superdoc.fonts.onReport((payload) => {
  const genericFamily: string | null | undefined = payload.documentFontOptions?.[0]?.genericFamily;
  void genericFamily;
});
void getOptionsParameters;
