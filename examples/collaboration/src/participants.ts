import type { SuperDocAwarenessUpdatePayload } from 'superdoc';

export function renderParticipants({ states }: SuperDocAwarenessUpdatePayload) {
  const list = document.querySelector<HTMLUListElement>('#participants');
  if (!list) return;

  const items = states.map((participant) => {
    const item = document.createElement('li');
    item.textContent = participant.name || 'Guest';
    return item;
  });
  list.replaceChildren(...items);
}
