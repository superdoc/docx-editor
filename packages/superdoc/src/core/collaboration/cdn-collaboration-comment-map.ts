const RUNTIME_KEY = '__SUPERDOC_V2_BROWSER_RUNTIME__';

export function createCollaborationCommentMap(entries: Iterable<[string, unknown]>): import('yjs').Map<unknown> {
  const runtime: unknown = Reflect.get(globalThis, RUNTIME_KEY);
  const yjs: unknown = runtime && typeof runtime === 'object' ? Reflect.get(runtime, 'yjs') : null;
  const YMap: unknown = yjs && typeof yjs === 'object' ? Reflect.get(yjs, 'Map') : null;
  if (typeof YMap !== 'function') {
    throw new Error('SuperDoc: the shared Yjs runtime is unavailable for collaboration comments.');
  }
  return new (YMap as typeof import('yjs').Map)(entries);
}
