<script setup>
import { ref, onMounted, computed } from 'vue';

const props = defineProps({
  // Reserved surface props (injected by SurfaceFloating)
  surfaceId: { type: String, default: '' },
  mode: { type: String, default: 'floating' },
  request: { type: Object, default: () => ({}) },
  resolve: { type: Function, default: () => {} },
  close: { type: Function, default: () => {} },
  // Feature-specific: the find/replace handle
  findReplace: { type: Object, required: true },
});

const findInputRef = ref(null);

// Replace controls are disabled when there are no matches, a replace is in
// flight, or the active session cannot mutate (V2 read-only/viewing mode).
// Optional-chaining keeps older handles (no canReplace/replacePending) working.
const replaceDisabled = computed(() => {
  const fr = props.findReplace;
  if (!fr.hasMatches?.value) return true;
  if (fr.replacePending?.value === true) return true;
  if (fr.canReplace && fr.canReplace.value === false) return true;
  return false;
});
// Replace all is gated separately: a truncated session can replace the active
// match but not every match. Older handles without the ref follow `canReplace`.
const replaceAllDisabled = computed(() => {
  if (replaceDisabled.value) return true;
  const fr = props.findReplace;
  if (fr.canReplaceAll && fr.canReplaceAll.value === false) return true;
  return false;
});

// The V2 driver marks ignore-diacritics unsupported; hide the toggle rather
// than shipping a no-op control. Undefined (V1 / custom handles) shows it.
const showIgnoreDiacritics = computed(() => props.findReplace.ignoreDiacriticsSupported?.value !== false);
// Replace controls are HIDDEN (not just disabled) when the session cannot
// mutate at all (viewing/read-only mode); `replaceEnabled` stays the static
// config gate. Older handles without the ref keep the controls visible.
const showReplaceControls = computed(
  () => props.findReplace.replaceEnabled && props.findReplace.replaceCanMutate?.value !== false,
);
const showRegexToggle = computed(() => props.findReplace.regexSupported?.value === true);
const searchErrorText = computed(() => props.findReplace.searchError?.value ?? null);

function handleFindKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleGoNext();
  } else if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    handleGoPrev();
  }
}

// Single path for advancing a match. Both the Enter key and the next/prev
// buttons must route through here so the focus restore — which preserves the
// goNext / DocumentRendererRuntime.scrollToPosition we just performed — runs in
// every navigation case. Clicking a button without restoring focus lets the
// button keep focus, and the browser scrolls the (off-screen) find bar back
// into view, undoing the navigation scroll on cross-page matches.
function handleGoNext() {
  props.findReplace.goNext();
  focusFindInput();
}

function handleGoPrev() {
  props.findReplace.goPrev();
  focusFindInput();
}

function handleClose() {
  props.findReplace.close('user-closed');
}

function collectScrollableAncestors(element) {
  const result = [];
  let cur = element?.parentElement ?? null;
  while (cur) {
    const style = cur.ownerDocument?.defaultView?.getComputedStyle?.(cur);
    if (style) {
      const overflow = `${style.overflowY} ${style.overflowX}`;
      if (overflow.includes('auto') || overflow.includes('scroll')) {
        result.push(cur);
      }
    }
    cur = cur.parentElement;
  }
  const root = element?.ownerDocument?.scrollingElement;
  if (root && !result.includes(root)) result.push(root);
  return result;
}

function focusFindInput() {
  // The surface lives in the document's normal flow. After goNext, the
  // DocumentRendererRuntime has scrolled the SuperDoc container to the active
  // match — which can be on a different page. Anything that gives focus to a
  // descendant of the (now off-screen) find bar can trigger the browser's
  // "scroll element into view" behaviour and snap that scroll back, hiding
  // the match. `preventScroll: true` covers `.focus()`; we additionally pin
  // every scrollable ancestor's scroll position across the call as a belt
  // for `.focus()` implementations or related side effects that ignore
  // preventScroll (SD-3045 review — match on different page never appeared).
  const input = findInputRef.value;
  if (!input) return;
  const scrollables = collectScrollableAncestors(input);
  const saved = scrollables.map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }));
  input.focus({ preventScroll: true });
  for (const { el, top, left } of saved) {
    if (el.scrollTop !== top) el.scrollTop = top;
    if (el.scrollLeft !== left) el.scrollLeft = left;
  }
}

onMounted(() => {
  // Initial focus is the wrapper's job, not this component's. `SurfaceFloating`
  // focuses the element marked `data-sd-autofocus` — the find input below — and
  // skips it when the surface was opened with `floating.autoFocus: false`.
  // Focusing here as well took that decision away from the consumer: the option
  // suppressed the wrapper's focus and this ran anyway, so the find bar still
  // stole focus from whatever opened it.
  props.findReplace.registerFocusFn(focusFindInput);
});
</script>

<template>
  <div class="sd-find-replace" @keydown.esc.stop="handleClose">
    <!-- Find row -->
    <div class="sd-find-replace__row">
      <button
        v-if="showReplaceControls"
        type="button"
        class="sd-find-replace__btn sd-find-replace__btn--expander"
        :class="{ 'sd-find-replace__btn--expander-open': findReplace.showReplace.value }"
        :title="findReplace.texts.toggleReplaceLabel"
        :aria-label="findReplace.texts.toggleReplaceAriaLabel"
        :aria-expanded="findReplace.showReplace.value ? 'true' : 'false'"
        @click="findReplace.showReplace.value = !findReplace.showReplace.value"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M6 3.5 10.5 8 6 12.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <div class="sd-find-replace__field" :class="{ 'sd-find-replace__field--error': searchErrorText }">
        <svg class="sd-find-replace__search-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            d="M7 1a6 6 0 1 0 3.7 10.7l3.3 3.3 1-1-3.3-3.3A6 6 0 0 0 7 1Zm0 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z"
            fill="currentColor"
          />
        </svg>
        <input
          ref="findInputRef"
          :value="findReplace.findQuery.value"
          @input="findReplace.findQuery.value = $event.target.value"
          type="text"
          class="sd-find-replace__input sd-find-replace__input--search"
          data-sd-autofocus
          :placeholder="findReplace.texts.findPlaceholder"
          :aria-label="findReplace.texts.findAriaLabel"
          @keydown="handleFindKeydown"
        />
        <span v-if="findReplace.findQuery.value && !searchErrorText" class="sd-find-replace__count">{{
          findReplace.matchLabel.value
        }}</span>
        <!-- Query-scoped toggles live inside the field so they read as
             properties of the query, and the popover stays one row tall. -->
        <button
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--toggle"
          :class="{ 'sd-find-replace__btn--active': findReplace.caseSensitive.value }"
          :title="findReplace.texts.matchCaseAriaLabel"
          :aria-label="findReplace.texts.matchCaseAriaLabel"
          :aria-pressed="findReplace.caseSensitive.value ? 'true' : 'false'"
          @mousedown.prevent
          @click="findReplace.caseSensitive.value = !findReplace.caseSensitive.value"
        >
          {{ findReplace.texts.matchCaseLabel }}
        </button>
        <button
          v-if="showIgnoreDiacritics"
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--toggle"
          :class="{ 'sd-find-replace__btn--active': findReplace.ignoreDiacritics.value }"
          :title="findReplace.texts.ignoreDiacriticsAriaLabel"
          :aria-label="findReplace.texts.ignoreDiacriticsAriaLabel"
          :aria-pressed="findReplace.ignoreDiacritics.value ? 'true' : 'false'"
          @mousedown.prevent
          @click="findReplace.ignoreDiacritics.value = !findReplace.ignoreDiacritics.value"
        >
          {{ findReplace.texts.ignoreDiacriticsLabel }}
        </button>
        <button
          v-if="showRegexToggle"
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--toggle"
          :class="{ 'sd-find-replace__btn--active': findReplace.regex.value }"
          :title="findReplace.texts.regexAriaLabel"
          :aria-label="findReplace.texts.regexAriaLabel"
          :aria-pressed="findReplace.regex.value ? 'true' : 'false'"
          @mousedown.prevent
          @click="findReplace.regex.value = !findReplace.regex.value"
        >
          {{ findReplace.texts.regexLabel }}
        </button>
      </div>

      <div class="sd-find-replace__nav">
        <button
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--icon"
          :disabled="!findReplace.hasMatches.value"
          :title="findReplace.texts.previousMatchLabel"
          :aria-label="findReplace.texts.previousMatchAriaLabel"
          @click="handleGoPrev()"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M10 3.5 5.5 8 10 12.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--icon"
          :disabled="!findReplace.hasMatches.value"
          :title="findReplace.texts.nextMatchLabel"
          :aria-label="findReplace.texts.nextMatchAriaLabel"
          @click="handleGoNext()"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M6 3.5 10.5 8 6 12.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span class="sd-find-replace__divider" aria-hidden="true"></span>
        <button
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--icon"
          :title="findReplace.texts.closeLabel"
          :aria-label="findReplace.texts.closeAriaLabel"
          @click="handleClose"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="m4.5 4.5 7 7m0-7-7 7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Replace row -->
    <div v-if="findReplace.showReplace.value && showReplaceControls" class="sd-find-replace__row">
      <span class="sd-find-replace__row-indent" aria-hidden="true"></span>
      <div class="sd-find-replace__field">
        <input
          :value="findReplace.replaceText.value"
          @input="findReplace.replaceText.value = $event.target.value"
          type="text"
          class="sd-find-replace__input"
          :placeholder="findReplace.texts.replacePlaceholder"
          :aria-label="findReplace.texts.replaceAriaLabel"
          @keydown.enter.prevent="findReplace.replaceCurrent()"
        />
      </div>

      <div class="sd-find-replace__nav sd-find-replace__nav--actions">
        <button
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--action"
          :disabled="replaceDisabled"
          :title="findReplace.texts.replaceLabel"
          @click="findReplace.replaceCurrent()"
        >
          {{ findReplace.texts.replaceLabel }}
        </button>
        <button
          type="button"
          class="sd-find-replace__btn sd-find-replace__btn--action"
          :disabled="replaceAllDisabled"
          :title="findReplace.texts.replaceAllLabel"
          @click="findReplace.replaceAll()"
        >
          {{ findReplace.texts.replaceAllLabel }}
        </button>
      </div>
    </div>

    <!-- Inline invalid-pattern error -->
    <div v-if="searchErrorText" class="sd-find-replace__error" role="alert">
      <span v-if="showReplaceControls" class="sd-find-replace__row-indent" aria-hidden="true"></span>
      <span class="sd-find-replace__error-text">{{ searchErrorText }}</span>
    </div>
  </div>
</template>

<style scoped>
.sd-find-replace {
  display: flex;
  flex-direction: column;
  gap: var(--sd-ui-find-replace-gap, 6px);
  /* One-row layout: the field shares its row with the query toggles and nav,
     so it needs room to breathe before the query starts truncating. */
  min-width: var(--sd-ui-find-replace-min-width, 380px);
}

.sd-find-replace__row {
  display: flex;
  align-items: center;
  gap: var(--sd-ui-find-replace-gap, 6px);
}

/* Mirrors the expander's footprint so the replace field and the error line
   align with the find field. */
.sd-find-replace__row-indent {
  flex: 0 0 var(--sd-ui-find-replace-expander-size, 24px);
}

/* The field carries the border; the input inside is naked so the count and
   the query toggles sit visually inside the control. */
.sd-find-replace__field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: var(--sd-ui-find-replace-input-height, 32px);
  padding: 0 4px 0 10px;
  background: var(--sd-ui-find-replace-input-bg, #fff);
  border: 1px solid var(--sd-ui-find-replace-input-border, var(--sd-ui-border));
  border-radius: var(--sd-ui-find-replace-input-radius, 6px);
  box-sizing: border-box;
  transition:
    border-color 0.12s ease-out,
    box-shadow 0.12s ease-out;
}

.sd-find-replace__field:focus-within {
  border-color: var(--sd-ui-find-replace-input-focus-border, var(--sd-ui-action));
  box-shadow: 0 0 0 3px
    var(--sd-ui-find-replace-input-focus-ring, color-mix(in srgb, var(--sd-ui-action) 15%, transparent));
}

.sd-find-replace__field--error,
.sd-find-replace__field--error:focus-within {
  border-color: var(--sd-ui-find-replace-error-color, #b3261e);
}

.sd-find-replace__field--error:focus-within {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sd-ui-find-replace-error-color, #b3261e) 12%, transparent);
}

.sd-find-replace__search-icon {
  color: var(--sd-ui-find-replace-search-icon-color, #9ca3af);
  flex-shrink: 0;
  margin-right: 6px;
}

.sd-find-replace__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  font-size: var(--sd-ui-find-replace-input-font-size, 14px);
  font-family: inherit;
  color: var(--sd-ui-text);
  background: transparent;
  border: none;
  outline: none;
}

.sd-find-replace__count {
  font-size: var(--sd-ui-find-replace-count-font-size, 12px);
  color: var(--sd-ui-find-replace-count-color, #6b7280);
  pointer-events: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  padding: 0 5px 0 4px;
  flex-shrink: 0;
}

.sd-find-replace__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--sd-ui-find-replace-input-border, var(--sd-ui-border));
  flex-shrink: 0;
}

.sd-find-replace__nav {
  display: flex;
  align-items: center;
  gap: var(--sd-ui-find-replace-nav-gap, 2px);
  flex-shrink: 0;
}

.sd-find-replace__nav--actions {
  gap: var(--sd-ui-find-replace-gap, 6px);
}

.sd-find-replace__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--sd-ui-find-replace-btn-color, var(--sd-ui-text));
  transition:
    background-color 0.12s ease-out,
    color 0.12s ease-out,
    border-color 0.12s ease-out,
    transform 90ms ease-out;
}

.sd-find-replace__btn:active:not(:disabled) {
  transform: scale(0.96);
}

.sd-find-replace__btn:focus-visible {
  outline: 2px solid var(--sd-ui-action);
  outline-offset: 1px;
}

.sd-find-replace__btn:disabled {
  opacity: var(--sd-ui-find-replace-btn-disabled-opacity, 0.4);
  cursor: not-allowed;
}

.sd-find-replace__btn--icon {
  width: var(--sd-ui-find-replace-btn-size, 28px);
  height: var(--sd-ui-find-replace-btn-size, 28px);
  border-radius: var(--sd-ui-find-replace-btn-radius, 6px);
  color: var(--sd-ui-find-replace-btn-color, #4b5563);
}

.sd-find-replace__btn--icon:hover:not(:disabled) {
  background: var(--sd-ui-find-replace-btn-hover-bg, color-mix(in srgb, currentColor 8%, transparent));
}

.sd-find-replace__btn--expander {
  width: var(--sd-ui-find-replace-expander-size, 24px);
  height: var(--sd-ui-find-replace-expander-size, 24px);
  border-radius: var(--sd-ui-find-replace-btn-radius, 6px);
  color: var(--sd-ui-find-replace-count-color, #6b7280);
  flex-shrink: 0;
}

.sd-find-replace__btn--expander:hover:not(:disabled) {
  background: var(--sd-ui-find-replace-btn-hover-bg, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--sd-ui-find-replace-btn-color, var(--sd-ui-text));
}

.sd-find-replace__btn--expander svg {
  transition: transform 0.16s ease-out;
}

.sd-find-replace__btn--expander-open svg {
  transform: rotate(90deg);
}

/* Query-scoped toggles inside the field (match case / diacritics / regex).
   Kept compact so they never crowd the query text. */
.sd-find-replace__btn--toggle {
  height: 20px;
  min-width: 20px;
  padding: var(--sd-ui-find-replace-btn-toggle-padding, 0 3px);
  font-size: var(--sd-ui-find-replace-btn-toggle-font-size, 11px);
  letter-spacing: 0.01em;
  border-radius: calc(var(--sd-ui-find-replace-input-radius, 6px) - 2px);
  border: 1px solid transparent;
  color: var(--sd-ui-find-replace-count-color, #6b7280);
  flex-shrink: 0;
}

.sd-find-replace__btn--toggle + .sd-find-replace__btn--toggle {
  margin-left: 1px;
}

.sd-find-replace__btn--toggle:hover:not(:disabled) {
  background: var(--sd-ui-find-replace-btn-hover-bg, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--sd-ui-find-replace-btn-color, var(--sd-ui-text));
}

.sd-find-replace__btn--active,
.sd-find-replace__btn--active:hover:not(:disabled) {
  background: var(--sd-ui-find-replace-toggle-active-bg, color-mix(in srgb, var(--sd-ui-action) 12%, transparent));
  border-color: var(
    --sd-ui-find-replace-toggle-active-border,
    color-mix(in srgb, var(--sd-ui-action) 30%, transparent)
  );
  color: var(--sd-ui-find-replace-toggle-active-color, var(--sd-ui-action));
}

.sd-find-replace__btn--action {
  height: var(--sd-ui-find-replace-btn-size, 28px);
  padding: var(--sd-ui-find-replace-action-btn-padding, 0 12px);
  font-size: var(--sd-ui-find-replace-count-font-size, 13px);
  letter-spacing: 0.01em;
  border-radius: var(--sd-ui-find-replace-btn-radius, 6px);
  background: var(--sd-ui-find-replace-action-btn-bg, var(--sd-ui-action));
  color: var(--sd-ui-find-replace-action-btn-color, #fff);
}

.sd-find-replace__btn--action:hover:not(:disabled) {
  background: var(
    --sd-ui-find-replace-action-btn-hover-bg,
    color-mix(in srgb, var(--sd-ui-find-replace-action-btn-bg, var(--sd-ui-action)) 88%, #000)
  );
}

.sd-find-replace__error {
  display: flex;
  align-items: center;
  gap: var(--sd-ui-find-replace-gap, 6px);
  color: var(--sd-ui-find-replace-error-color, #b3261e);
  font-size: var(--sd-ui-find-replace-error-font-size, 12px);
  letter-spacing: 0.01em;
  padding: var(--sd-ui-find-replace-error-padding, 0 2px);
  animation: sd-find-replace-error-in 0.16s ease-out;
}

.sd-find-replace__error-text {
  padding-left: 4px;
}

@keyframes sd-find-replace-error-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sd-find-replace__field,
  .sd-find-replace__btn,
  .sd-find-replace__btn--expander svg {
    transition: none;
  }

  .sd-find-replace__btn:active:not(:disabled) {
    transform: none;
  }

  .sd-find-replace__error {
    animation: none;
  }
}
</style>
