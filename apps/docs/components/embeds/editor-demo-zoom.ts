import type { SuperDocInstance } from './superdoc-runtime';

export const EDITOR_DEMO_FIT_WIDTH_PADDING = 2;

type PageMetricsReader = {
  getSnapshot?: () => { pages?: readonly { base?: { widthPx?: number } }[] };
};

export function fitRuntimeEditorToWidth(instance: SuperDocInstance) {
  const pageMetrics = (instance.activeEditor as { pageMetrics?: PageMetricsReader } | null)?.pageMetrics;
  const pageWidths = pageMetrics
    ?.getSnapshot?.()
    .pages?.map((page) => page.base?.widthPx)
    .filter((width): width is number => typeof width === 'number' && Number.isFinite(width) && width > 0);
  const documentWidth = pageWidths?.length ? Math.max(...pageWidths) : null;
  const availableWidth = instance.getViewportMetrics()?.availableWidth;
  if (!documentWidth || !availableWidth || availableWidth <= EDITOR_DEMO_FIT_WIDTH_PADDING) return false;

  const fitZoom = Math.round(((availableWidth - EDITOR_DEMO_FIT_WIDTH_PADDING) / documentWidth) * 100);
  const { max, min } = instance.getZoomState();
  instance.ui.zoom.set(Math.min(max, Math.max(min, fitZoom)));
  instance.ui.zoom.setMode('fit-width');
  return true;
}
