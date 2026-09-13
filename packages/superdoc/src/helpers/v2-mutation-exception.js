const FAILURE_SOURCES = new Set(['shell', 'receipt']);
const DIAGNOSTIC_CODE = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;
const COMMAND_KIND = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;

export function createV2MutationRejectionCause(event) {
  if (!event || typeof event !== 'object') return {};
  const reason = event.reason ?? (event.failureSource === 'receipt' ? event.failure?.code : undefined);
  // These are normalized code fields. Receipt messages/details can contain
  // document content and must never be copied into exception diagnostics.
  return {
    ...(FAILURE_SOURCES.has(event.failureSource) ? { failureSource: event.failureSource } : {}),
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

export function createV2MutationRejectionNotificationGate(matches) {
  const notifiedEventsByScope = new Map();
  const keyFor = (scope) => (typeof scope === 'string' && scope.length > 0 ? scope : '__default__');
  return {
    shouldNotify(scope, event) {
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
    clear(scope) {
      notifiedEventsByScope.delete(keyFor(scope));
    },
  };
}
