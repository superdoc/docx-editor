import { isPlainObject } from './object-guards.js';

const FAILURE_SOURCES: ReadonlySet<unknown> = new Set(['shell', 'receipt']);
const DIAGNOSTIC_CODE = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;
const COMMAND_KIND = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;

export type V2MutationRejectedEvent = Record<string, unknown> & { type: 'mutation:rejected' };

export type V2MutationRejectionCause = {
  failureSource?: string;
  reason?: string;
  inputKind?: string;
  editableCommandKind?: string;
};

export function createV2MutationRejectionCause(event: unknown): V2MutationRejectionCause {
  if (!isPlainObject(event)) return {};
  const failure = isPlainObject(event.failure) ? event.failure : undefined;
  const reason = event.reason ?? (event.failureSource === 'receipt' ? failure?.code : undefined);
  // These are normalized code fields. Receipt messages/details can contain
  // document content and must never be copied into exception diagnostics.
  return {
    ...(typeof event.failureSource === 'string' && FAILURE_SOURCES.has(event.failureSource)
      ? { failureSource: event.failureSource }
      : {}),
    ...(typeof reason === 'string' && DIAGNOSTIC_CODE.test(reason) ? { reason } : {}),
    ...(typeof event.inputKind === 'string' && DIAGNOSTIC_CODE.test(event.inputKind)
      ? { inputKind: event.inputKind }
      : {}),
    ...(typeof event.editableCommandKind === 'string' &&
    event.editableCommandKind.length <= 128 &&
    COMMAND_KIND.test(event.editableCommandKind)
      ? { editableCommandKind: event.editableCommandKind }
      : {}),
  };
}

export function createV2MutationRejectionNotificationGate(
  matches: (event: unknown) => event is V2MutationRejectedEvent,
) {
  const notifiedEventsByScope = new Map<string, WeakSet<object>>();
  const keyFor = (scope: string | null | undefined) =>
    typeof scope === 'string' && scope.length > 0 ? scope : '__default__';
  return {
    shouldNotify(scope: string | null | undefined, event: unknown) {
      if (!matches(event)) return false;
      const key = keyFor(scope);
      let notifiedEvents = notifiedEventsByScope.get(key);
      if (!notifiedEvents) {
        notifiedEvents = new WeakSet();
        notifiedEventsByScope.set(key, notifiedEvents);
      }
      if (notifiedEvents.has(event)) return false;
      notifiedEvents.add(event);
      return true;
    },
    clear(scope: string | null | undefined) {
      notifiedEventsByScope.delete(keyFor(scope));
    },
  };
}
