import type { Config, SuperDoc, SuperDocVisualHandle } from 'superdoc';

const ownPanel: Config['ui'] = { comments: false };
const ownPanelAndHighlights: Config['ui'] = { comments: { panel: false, highlights: false } };

// @ts-expect-error highlights is a boolean.
const invalid: Config['ui'] = { comments: { highlights: 'none' } };

declare const superdoc: SuperDoc;

const { ui } = superdoc;
let highlights: SuperDocVisualHandle[] = [];
const stopObserving: () => void = ui.comments.observe(({ items }) => {
  for (const handle of highlights) handle.dispose();
  highlights = [];
  for (const comment of items) {
    if (!comment.target) continue;
    const handle = ui.decorations.highlight(`comment:${comment.id}`, {
      className: 'my-comment',
      data: { commentId: comment.id },
    });
    handle.replace([comment.target]);
    highlights.push(handle);
  }
});
const stopClicks: () => void = ui.decorations.subscribe((event) => {
  const commentId = event.data?.['commentId'];
  if (event.type === 'click' && typeof commentId === 'string') ui.comments.setActive(commentId);
});

void ownPanel;
void ownPanelAndHighlights;
void invalid;
void stopObserving;
void stopClicks;
