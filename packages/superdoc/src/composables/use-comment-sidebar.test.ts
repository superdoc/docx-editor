import { describe, expect, it } from 'vite-plus/test';
import { effectScope, ref } from 'vue';
import { useCommentSidebar } from './use-comment-sidebar.js';

describe('comment sidebar layout', () => {
  it('reserves space across empty review windows without retaining their cards', () => {
    const scope = effectScope();
    try {
      scope.run(() => {
        const documentKey = ref('first');
        const enabled = ref(true);
        const hasContent = ref(false);
        const visible = useCommentSidebar({ documentKey, enabled, hasContent });
        expect(visible.value).toBe(false);
        hasContent.value = true;
        expect(visible.value).toBe(true);
        hasContent.value = false;
        expect(visible.value).toBe(true);
        enabled.value = false;
        expect(visible.value).toBe(false);
        enabled.value = true;
        expect(visible.value).toBe(true);
        documentKey.value = 'second';
        expect(visible.value).toBe(false);
      });
    } finally {
      scope.stop();
    }
  });

  it('does not reserve space for hidden review content', () => {
    const scope = effectScope();
    try {
      scope.run(() => {
        const documentKey = ref('first');
        const enabled = ref(false);
        const hasContent = ref(true);
        const visible = useCommentSidebar({ documentKey, enabled, hasContent });
        expect(visible.value).toBe(false);
        hasContent.value = false;
        enabled.value = true;
        expect(visible.value).toBe(false);
        hasContent.value = true;
        expect(visible.value).toBe(true);
      });
    } finally {
      scope.stop();
    }
  });
});
