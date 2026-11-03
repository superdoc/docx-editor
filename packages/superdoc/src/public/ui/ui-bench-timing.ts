import { isObjectRecord } from '../../helpers/object-guards.js';

export function uiBenchNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function readUiBenchRuntime(): {
  sink: ((event: Record<string, unknown>) => void) | null;
  workerContext: { commandId: string | null; commandKind: string | null } | null;
} {
  const sink: unknown = Reflect.get(globalThis, '__superdocV2BenchPipelineTiming');
  const context: unknown = Reflect.get(globalThis, '__superdocV2BenchWorkerMessageContext');
  return {
    sink: typeof sink === 'function' ? (event) => Reflect.apply(sink, undefined, [event]) : null,
    workerContext: isObjectRecord(context)
      ? { commandId: readBenchText(context.commandId), commandKind: readBenchText(context.commandKind) }
      : null,
  };
}

export function emitUiBenchTiming(event: Record<string, unknown>): void {
  const { sink } = readUiBenchRuntime();
  if (!sink) return;
  try {
    sink(event);
  } catch {}
}

function readBenchText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
