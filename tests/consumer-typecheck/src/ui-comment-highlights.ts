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

const layoutArguments: Parameters<SuperDoc['setCommentsLayout']> = ['inline'];
const currentLayout: ReturnType<SuperDoc['getCommentsLayout']> = superdoc.getCommentsLayout();
type Assert<T extends true> = T;
type RejectsInvalidLayout = Assert<'floating' extends Parameters<SuperDoc['setCommentsLayout']>[0] ? false : true>;
type EffectiveExcludesAuto = Assert<
  'auto' extends ReturnType<SuperDoc['getCommentsLayout']>['effective'] ? false : true
>;
const layoutTypeChecks: [RejectsInvalidLayout, EffectiveExcludesAuto] = [true, true];
superdoc.setCommentsLayout(...layoutArguments);
ui.comments.setLayout('auto');
const observedLayout: typeof currentLayout = ui.comments.getSnapshot().layout;
const stopLayout = ui.comments.observe(({ layout }) => {
  const requested: 'auto' | 'sidebar' | 'inline' = layout.requested;
  const effective: 'sidebar' | 'inline' = layout.effective;
  void [requested, effective];
});
const onLayout = (layout: typeof currentLayout) => void layout;
superdoc.on('comments-layout-change', onLayout);
superdoc.off('comments-layout-change', onLayout);
const layoutToolbar: Config['ui'] = {
  toolbar: { includeItems: ['comments-layout'], items: { right: ['comments-layout'] } },
};
void [observedLayout, stopLayout, layoutToolbar, layoutTypeChecks];
