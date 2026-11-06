import { computed, ref, watch, type Ref } from 'vue';

export function useCommentSidebar({
  documentKey,
  enabled,
  hasContent,
}: {
  documentKey: Readonly<Ref<string>>;
  enabled: Readonly<Ref<boolean>>;
  hasContent: Readonly<Ref<boolean>>;
}) {
  const reserved = ref(false);

  watch(
    documentKey,
    () => {
      reserved.value = false;
    },
    { flush: 'sync' },
  );
  watch(
    () => enabled.value && hasContent.value,
    (visible) => {
      if (visible) reserved.value = true;
    },
    { immediate: true, flush: 'sync' },
  );

  return computed(() => enabled.value && (hasContent.value || reserved.value));
}
