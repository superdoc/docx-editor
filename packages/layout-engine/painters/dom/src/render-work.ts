export type RenderWork<T> = Generator<void, T, void>;

export function completeRenderWork<T>(work: RenderWork<T>): T {
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}

export function* resolveRenderWork<T>(value: T | RenderWork<T>): RenderWork<T> {
  if (value != null && typeof value === 'object' && 'next' in value) {
    return yield* value as RenderWork<T>;
  }
  yield;
  return value as T;
}
