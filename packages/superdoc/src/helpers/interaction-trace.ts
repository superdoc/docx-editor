import { isThenable } from './object-guards.js';

type InteractionSpan = { traceId: string; spanId: string };

type InteractionMeta = Record<string, unknown> | undefined;

type StartSpan = (stage: string, branch: string, meta: InteractionMeta) => InteractionSpan | null;

type EndSpan = (span: InteractionSpan, meta: InteractionMeta) => void;

const isStartSpan = (value: unknown): value is StartSpan => typeof value === 'function';

const isEndSpan = (value: unknown): value is EndSpan => typeof value === 'function';

function safeTraceCollector(): object | null {
  try {
    const collector: unknown = Reflect.get(globalThis, '__superdocInteractionTrace');
    return collector && typeof collector === 'object' ? collector : null;
  } catch {
    return null;
  }
}

export function startInteractionSpan(stage: string, branch: string, meta?: InteractionMeta): InteractionSpan | null {
  try {
    const collector = safeTraceCollector();
    if (!collector || !('startSpan' in collector) || !isStartSpan(collector.startSpan)) return null;
    return collector.startSpan(stage, branch, meta);
  } catch {
    return null;
  }
}

export function endInteractionSpan(span: InteractionSpan | null | undefined, meta?: InteractionMeta): void {
  if (!span) return;
  try {
    const collector = safeTraceCollector();
    if (!collector || !('endSpan' in collector) || !isEndSpan(collector.endSpan)) return;
    collector.endSpan(span, meta);
  } catch {}
}

export function withInteractionSpan<T>(stage: string, branch: string, meta: InteractionMeta, fn: () => T): T;
export function withInteractionSpan(stage: string, branch: string, meta: InteractionMeta, fn: () => unknown): unknown {
  const span = startInteractionSpan(stage, branch, meta);
  if (!span) {
    return fn();
  }
  try {
    const result = fn();
    if (isThenable(result)) {
      return result.then(
        (value) => {
          endInteractionSpan(span);
          return value;
        },
        (error: unknown) => {
          endInteractionSpan(span, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        },
      );
    }
    endInteractionSpan(span);
    return result;
  } catch (error) {
    endInteractionSpan(span, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
