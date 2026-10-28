import type { SuperDocVisualHandle } from 'superdoc';
import type { DecorationPointerEvent, DecorationsHandle, SuperDocUI } from 'superdoc/ui';

declare const ui: SuperDocUI;

const decorations: DecorationsHandle = ui.decorations;
const handle: SuperDocVisualHandle = decorations.highlight('finding-7', { className: 'finding', data: { rule: 'r1' } });
const id: string = handle.id;
handle.replace([{ kind: 'text', blockId: 'paragraph-1', range: { start: 0, end: 5 } }]);
handle.clear();
handle.dispose();

const scope = ui.createScope();
scope.decorations.highlight('scoped').add([{ kind: 'text', blockId: 'paragraph-1', range: { start: 0, end: 1 } }]);
scope.dispose();

const unsubscribe: () => void = decorations.subscribe((event: DecorationPointerEvent) => {
  const kind: 'click' | 'hover-enter' | 'hover-leave' = event.type;
  const findingId: string = event.id;
  void kind;
  void findingId;
});
unsubscribe();

// @ts-expect-error A highlight needs an id.
decorations.highlight();

void id;
