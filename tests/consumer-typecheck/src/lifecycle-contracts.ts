import type {
  Config,
  EditorUpdateEvent,
  SuperDoc,
  SuperDocReadyPayload,
  SuperDocExceptionPayload,
  SuperDocZoomPayload,
} from 'superdoc';
import type { DocumentSlice } from 'superdoc/ui';
import type { useSuperDocDocument } from 'superdoc/ui/react';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type ReadyCallback = NonNullable<Config['onReady']>;
type ReadyParameters = Assert<Equal<Parameters<ReadyCallback>, [SuperDocReadyPayload]>>;
type ReadyReturn = Assert<Equal<ReturnType<ReadyCallback>, void>>;
type UpdateParameters = Assert<Equal<Parameters<NonNullable<Config['onEditorUpdate']>>, [EditorUpdateEvent]>>;
type ExceptionParameters = Assert<Equal<Parameters<NonNullable<Config['onException']>>, [SuperDocExceptionPayload]>>;
type DestroyParameters = Assert<Equal<Parameters<SuperDoc['destroy']>, []>>;
type DestroyReturn = Assert<Equal<ReturnType<SuperDoc['destroy']>, void>>;
type DocumentHookParameters = Assert<Equal<Parameters<typeof useSuperDocDocument>, []>>;
type DocumentHookReturn = Assert<Equal<ReturnType<typeof useSuperDocDocument>, DocumentSlice>>;

declare const superdoc: SuperDoc;
const onReady: ReadyCallback = ({ superdoc: readyEditor }) => {
  const instance: SuperDoc = readyEditor;
  void instance;
};
const onZoom = ({ zoom, mode }: SuperDocZoomPayload): void => {
  void [zoom, mode];
};
superdoc.on('ready', onReady);
superdoc.off('ready', onReady);
superdoc.once('zoomChange', onZoom);
superdoc.removeListener('zoomChange', onZoom);
superdoc.on('editor-update', (event) => {
  const exact: Assert<Equal<typeof event, EditorUpdateEvent>> = true;
  void exact;
});
superdoc.on('exception', (event) => {
  const exact: Assert<Equal<typeof event, SuperDocExceptionPayload>> = true;
  void exact;
});
// @ts-expect-error Config callback names are not event names.
superdoc.on('onReady', onReady);
// @ts-expect-error Zoom events do not carry a ready payload.
superdoc.on('zoomChange', onReady);
// @ts-expect-error Cleanup takes no arguments.
superdoc.destroy('editor');

export type LifecycleContracts = [
  ReadyParameters,
  ReadyReturn,
  UpdateParameters,
  ExceptionParameters,
  DestroyParameters,
  DestroyReturn,
  DocumentHookParameters,
  DocumentHookReturn,
];
