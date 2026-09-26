// @ts-check
import { nextTick } from 'vue';
import WatermarkSurface from './WatermarkSurface.vue';

/**
 * Keeps Vue rendering and post-dismissal announcements outside the public type graph.
 * @param {(() => HTMLElement | null) | undefined} getContainer
 */
export function createWatermarkSurfaceRuntime(getContainer) {
  /** @type {HTMLDivElement | null} */
  let status = null;
  let disposed = false;
  return {
    component: WatermarkSurface,
    captureFocusReturn() {
      const document = getContainer?.()?.ownerDocument;
      const opener = document?.activeElement;
      const item =
        opener?.closest('[data-sd-part="toolbar-item"]') ?? opener?.querySelector('[data-sd-part="toolbar-item"]');
      const toolbar = item?.closest('[data-sd-part="toolbar"]');
      const container = toolbar?.parentElement;
      const isWatermarkEntry = item?.querySelector('[data-item="btn-watermark"], [data-item="btn-overflow"]');
      /** @param {() => boolean} isCurrent */
      return async (isCurrent) => {
        // Let the dialog shell restore focus before recovering a detached toolbar opener.
        await nextTick();
        if (disposed || !isCurrent() || !isWatermarkEntry || opener?.isConnected || !container?.isConnected) return;
        if (document?.activeElement !== document?.body) return;
        const currentToolbar = container.querySelector('[data-sd-part="toolbar"]');
        for (const name of ['watermark', 'overflow']) {
          const target = currentToolbar
            ?.querySelector(`[data-item="btn-${name}"]`)
            ?.closest('[data-sd-part="toolbar-item"]');
          if (
            target instanceof HTMLElement &&
            target.getClientRects().length &&
            target.getAttribute('aria-disabled') !== 'true'
          ) {
            target.focus({ preventScroll: true });
            return;
          }
        }
      };
    },
    mount() {
      const container = getContainer?.();
      if (disposed || status || !container?.ownerDocument) return;
      status = container.ownerDocument.createElement('div');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      Object.assign(status.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
      });
      container.appendChild(status);
    },
    /** @param {string} message */
    announce(message) {
      if (!disposed && status) status.textContent = message;
    },
    destroy() {
      disposed = true;
      status?.remove();
      status = null;
    },
  };
}
