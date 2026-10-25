import type { BrowserDocumentApi } from 'superdoc/ui';
import type { useSuperDocDocumentApi } from 'superdoc/ui/react';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type HookParameters = Assert<Equal<Parameters<typeof useSuperDocDocumentApi>, []>>;
type HookReturn = Assert<Equal<ReturnType<typeof useSuperDocDocumentApi>, BrowserDocumentApi | null>>;

declare const doc: NonNullable<ReturnType<typeof useSuperDocDocumentApi>>;
void doc.trackChanges.get({ id: 'change-1' });
void doc.history.undo();

export type { HookParameters, HookReturn };

import type { SuperDoc } from 'superdoc';
import type { SuperDocHost } from 'superdoc/ui/react';
declare const superdoc: SuperDoc;
const bound: SuperDocHost = superdoc;
type SuperDocDocumentApi = Assert<Equal<ReturnType<SuperDoc['getDocumentApi']>, BrowserDocumentApi | null>>;
const partialHost: SuperDocHost = {
  // @ts-expect-error a partial document API is not the complete one
  getDocumentApi: () => ({ trackChanges: {} }),
};
void bound;
void partialHost;
export type { SuperDocDocumentApi };
