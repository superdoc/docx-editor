<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type {
  WatermarkDialogModel,
  WatermarkDraft,
  WatermarkPageVariant,
} from '../../public/ui/watermark-dialog-state.js';
import { fileToDataUri, IMAGE_PICKER_ACCEPT, isSupportedImageFile } from '../../internal/toolbar/image-upload.js';

const props = withDefaults(
  defineProps<{
    model: WatermarkDialogModel;
    surfaceId?: string;
    mode?: string;
    request?: object;
    resolve?: (value?: unknown) => void;
    close?: (reason?: string) => void;
  }>(),
  { surfaceId: '', close: () => {} },
);

const snapshot = shallowRef(props.model.getSnapshot());
const fileInput = ref<HTMLInputElement | null>(null);
const filePending = ref(false);
const localError = ref('');
let fileGeneration = 0;
let unsubscribe: (() => void) | undefined;
const presets = ['DRAFT', 'CONFIDENTIAL', 'DO NOT COPY'];
const types = [
  { value: 'none', label: 'No watermark' },
  { value: 'text', label: 'Text' },
  { value: 'picture', label: 'Picture' },
] as const;
const busy = computed(() => snapshot.value.phase === 'loading' || snapshot.value.phase === 'applying');
const editable = computed(() => !busy.value && !snapshot.value.readonlyReason);
const canApply = computed(() => snapshot.value.canApply && !busy.value && !filePending.value && !snapshot.value.stale);
const error = computed(() => localError.value || snapshot.value.error);
const status = computed(() => {
  if (filePending.value) return 'Preparing picture…';
  if (snapshot.value.phase === 'loading') return 'Loading watermarks…';
  if (snapshot.value.phase === 'applying') return 'Applying changes; closing will not cancel them.';
  if (snapshot.value.phase === 'previewing') return 'Updating preview…';
  return snapshot.value.dirty ? 'Changes apply when you choose Apply' : 'No changes';
});
const fontOptions = computed(() => {
  const { fonts, draft } = snapshot.value;
  return fonts.some((font) => font.value === draft.fontFamily)
    ? fonts
    : [{ value: draft.fontFamily, label: draft.fontFamily }, ...fonts];
});

function cancelPreparation() {
  fileGeneration += 1;
  filePending.value = false;
}

function patch(patch: Partial<WatermarkDraft>) {
  if (!editable.value) return;
  localError.value = '';
  props.model.patchDraft(patch);
}

function changeScope(event: Event, field: 'section' | 'variant') {
  const value = (event.target as HTMLSelectElement).value;
  cancelPreparation();
  props.model.setScope(
    field === 'section' ? value || null : snapshot.value.sectionId,
    field === 'variant' ? (value as WatermarkPageVariant) : snapshot.value.variant,
  );
}

function selectWatermark(id: string, event: Event) {
  cancelPreparation();
  const selected = new Set(snapshot.value.selectedIds);
  if ((event.target as HTMLInputElement).checked) selected.add(id);
  else selected.delete(id);
  props.model.selectWatermarks([...selected]);
}

async function choosePicture(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !editable.value) return;
  cancelPreparation();
  localError.value = '';
  if (!isSupportedImageFile(file)) {
    localError.value = 'Choose a PNG or JPEG picture.';
    return;
  }
  const generation = fileGeneration;
  filePending.value = true;
  try {
    const src = await fileToDataUri(file);
    if (generation !== fileGeneration) return;
    patch({ src, pictureName: file.name, kind: 'picture' });
  } catch {
    if (generation === fileGeneration) localError.value = 'The picture could not be read. Choose it again.';
  } finally {
    if (generation === fileGeneration) filePending.value = false;
  }
}

async function apply() {
  if (!canApply.value) return;
  try {
    await props.model.apply();
  } catch {
    localError.value = 'The watermark could not be applied. Try again.';
  }
}

async function reload() {
  cancelPreparation();
  localError.value = '';
  try {
    await props.model.reload();
  } catch {
    localError.value = 'Watermarks could not be loaded. Try again.';
  }
}

function close() {
  cancelPreparation();
  props.close('user-cancelled');
}

watch(
  [
    () => snapshot.value.draft.kind,
    () => snapshot.value.sectionId,
    () => snapshot.value.variant,
    () => snapshot.value.selectedIds.join('\0'),
  ],
  cancelPreparation,
);
onMounted(() => {
  unsubscribe = props.model.subscribe((value) => {
    snapshot.value = value;
  });
  snapshot.value = props.model.getSnapshot();
});
onBeforeUnmount(() => {
  cancelPreparation();
  unsubscribe?.();
});
</script>

<template>
  <form class="sd-watermark sd-dialog-content" @submit.prevent="apply">
    <header class="sd-watermark__header sd-dialog-header">
      <h2>Watermark</h2>
      <button type="button" class="sd-dialog-close" aria-label="Close watermark dialog" @click="close">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </header>
    <div class="sd-watermark__body">
      <div class="sd-watermark__settings">
        <fieldset class="sd-watermark__scope" :disabled="busy">
          <legend class="sd-watermark__sr-only">Watermark scope</legend>
          <label class="sd-watermark__field">
            <span>Apply to</span>
            <select aria-label="Apply to" :value="snapshot.sectionId ?? ''" @change="changeScope($event, 'section')">
              <option value="">Entire document</option>
              <option v-for="section in snapshot.sections" :key="section.id" :value="section.id">
                {{ section.label }}
              </option>
            </select>
          </label>
          <label class="sd-watermark__field">
            <span>Page type</span>
            <select aria-label="Page type" :value="snapshot.variant" @change="changeScope($event, 'variant')">
              <option value="all">All applicable</option>
              <option value="default">Default</option>
              <option value="first">First</option>
              <option value="even">Even</option>
            </select>
          </label>
        </fieldset>

        <fieldset v-if="snapshot.items.length > 1" class="sd-watermark__selection" :disabled="busy">
          <legend>Watermarks to edit</legend>
          <div class="sd-watermark__selection-list">
            <label v-for="item in snapshot.items" :key="item.id" class="sd-watermark__check">
              <input
                type="checkbox"
                :value="item.id"
                :checked="snapshot.selectedIds.includes(item.id)"
                @change="selectWatermark(item.id, $event)"
              />
              <span
                >{{ item.label }}<small>{{ item.locations }}</small></span
              >
            </label>
          </div>
          <button type="button" :disabled="!editable" @click="model.selectWatermarks([])">Add watermark</button>
          <p v-if="snapshot.selectedIds.length > 1" class="sd-watermark__notice">
            Applying uses the settings below for all {{ snapshot.selectedIds.length }} selected copies.
          </p>
        </fieldset>

        <p v-if="snapshot.readonlyReason" class="sd-watermark__notice">{{ snapshot.readonlyReason }}</p>
        <fieldset
          class="sd-watermark__draft"
          :class="{ 'sd-watermark__draft--text': snapshot.draft.kind === 'text' }"
          :disabled="!editable"
        >
          <legend class="sd-watermark__sr-only">Watermark settings</legend>
          <fieldset class="sd-watermark__types">
            <legend class="sd-watermark__sr-only">Watermark type</legend>
            <label
              v-for="type in types"
              :key="type.value"
              :class="{ 'is-selected': snapshot.draft.kind === type.value }"
            >
              <input
                type="radio"
                :name="`watermark-type-${surfaceId}`"
                :value="type.value"
                :checked="snapshot.draft.kind === type.value"
                @change="patch({ kind: type.value })"
              />
              <span>{{
                type.value === 'none' && snapshot.items.length > 1 && snapshot.selectedIds.length
                  ? 'Remove selected'
                  : type.label
              }}</span>
            </label>
          </fieldset>

          <template v-if="snapshot.draft.kind === 'text'">
            <label class="sd-watermark__field">
              <span>Text</span>
              <input
                aria-label="Watermark text"
                type="text"
                :value="snapshot.draft.text"
                @input="patch({ text: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <div class="sd-watermark__presets" aria-label="Text presets">
              <button v-for="preset in presets" :key="preset" type="button" @click="patch({ text: preset })">
                {{ preset }}
              </button>
            </div>
            <div class="sd-watermark__font-row">
              <label class="sd-watermark__field">
                <span>Font</span>
                <select
                  aria-label="Font"
                  :value="snapshot.draft.fontFamily"
                  @change="patch({ fontFamily: ($event.target as HTMLSelectElement).value })"
                >
                  <option v-for="font in fontOptions" :key="font.value" :value="font.value">{{ font.label }}</option>
                </select>
              </label>
              <label class="sd-watermark__field sd-watermark__size">
                <span>Size (pt)</span>
                <input
                  aria-label="Font size"
                  :list="`watermark-sizes-${surfaceId}`"
                  :value="snapshot.draft.fontSize === 'auto' ? 'Auto' : snapshot.draft.fontSize"
                  @change="
                    patch({
                      fontSize:
                        ($event.target as HTMLInputElement).value.toLowerCase() === 'auto'
                          ? 'auto'
                          : Number(($event.target as HTMLInputElement).value),
                    })
                  "
                />
                <datalist :id="`watermark-sizes-${surfaceId}`">
                  <option value="Auto" />
                  <option v-for="size in [24, 36, 48, 72, 96]" :key="size" :value="size" />
                </datalist>
              </label>
              <div class="sd-watermark__styles">
                <button
                  type="button"
                  aria-label="Bold"
                  :aria-pressed="snapshot.draft.bold"
                  @click="patch({ bold: !snapshot.draft.bold })"
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  aria-label="Italic"
                  :aria-pressed="snapshot.draft.italic"
                  @click="patch({ italic: !snapshot.draft.italic })"
                >
                  <i>I</i>
                </button>
              </div>
            </div>
            <label class="sd-watermark__field sd-watermark__font-color">
              <span>Font color</span>
              <span class="sd-watermark__color">
                <input
                  type="color"
                  aria-label="Choose font color"
                  :value="snapshot.draft.color"
                  @input="patch({ color: ($event.target as HTMLInputElement).value })"
                />
                <input
                  type="text"
                  aria-label="Font color"
                  :value="snapshot.draft.color"
                  spellcheck="false"
                  @input="patch({ color: ($event.target as HTMLInputElement).value })"
                />
              </span>
            </label>
          </template>

          <template v-if="snapshot.draft.kind === 'picture'">
            <div class="sd-watermark__picture">
              <img v-if="snapshot.draft.src" :src="snapshot.draft.src" alt="Selected picture" />
              <div>
                <strong>{{ snapshot.draft.pictureName || 'No picture selected' }}</strong
                ><small>PNG or JPEG</small>
              </div>
              <button type="button" @click="fileInput?.click()">
                {{ snapshot.draft.pictureName ? 'Replace picture' : 'Choose picture' }}
              </button>
              <input
                ref="fileInput"
                type="file"
                :accept="IMAGE_PICKER_ACCEPT"
                aria-label="Choose watermark picture"
                hidden
                @change="choosePicture"
              />
            </div>
            <label class="sd-watermark__field">
              <span>Scale</span>
              <select
                aria-label="Picture scale"
                :value="snapshot.draft.customSize ? 'custom' : snapshot.draft.scalePercent"
                @change="
                  patch({
                    scalePercent:
                      ($event.target as HTMLSelectElement).value === 'auto'
                        ? 'auto'
                        : (Number(($event.target as HTMLSelectElement).value) as WatermarkDraft['scalePercent']),
                  })
                "
              >
                <option v-if="snapshot.draft.customSize" value="custom" disabled>Custom size retained</option>
                <option value="auto">Auto</option>
                <option v-for="scale in [50, 100, 150, 200, 500]" :key="scale" :value="scale">{{ scale }}%</option>
              </select>
            </label>
            <label class="sd-watermark__check"
              ><input
                type="checkbox"
                :checked="snapshot.draft.lockAspectRatio"
                @change="patch({ lockAspectRatio: ($event.target as HTMLInputElement).checked })"
              /><span>Preserve aspect ratio</span></label
            >
            <label class="sd-watermark__check"
              ><input
                type="checkbox"
                :checked="snapshot.draft.washout"
                @change="patch({ washout: ($event.target as HTMLInputElement).checked })"
              /><span>Washout<small>Lighten the picture's colors.</small></span></label
            >
          </template>

          <div v-if="snapshot.draft.kind !== 'none'" class="sd-watermark__field sd-watermark__transparency">
            <label :for="`watermark-transparency-${surfaceId}`">Transparency</label>
            <div class="sd-watermark__range">
              <input
                :id="`watermark-transparency-${surfaceId}`"
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label="Transparency"
                :value="snapshot.draft.transparency"
                @input="patch({ transparency: Number(($event.target as HTMLInputElement).value) })"
              />
              <label
                ><input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  aria-label="Transparency percentage"
                  :value="snapshot.draft.transparency"
                  @input="patch({ transparency: Number(($event.target as HTMLInputElement).value) })"
                /><span>%</span></label
              >
            </div>
            <small>0% opaque, 100% transparent</small>
          </div>

          <fieldset v-if="snapshot.draft.kind !== 'none'" class="sd-watermark__orientation">
            <legend>Orientation</legend>
            <label v-for="orientation in ['horizontal', 'diagonal'] as const" :key="orientation">
              <input
                type="radio"
                :name="`watermark-orientation-${surfaceId}`"
                :value="orientation"
                :checked="!snapshot.draft.customOrientation && snapshot.draft.orientation === orientation"
                @change="patch({ orientation })"
              />
              <span>{{ orientation === 'horizontal' ? 'Horizontal' : 'Diagonal' }}</span>
            </label>
          </fieldset>
          <p v-if="snapshot.draft.customPlacement" class="sd-watermark__notice">Custom placement retained.</p>
          <p v-if="snapshot.draft.kind === 'none'" class="sd-watermark__notice">
            {{
              snapshot.selectedIds.length
                ? 'The selected watermark will be removed when you apply.'
                : 'Choose Text or Picture to add a watermark.'
            }}
          </p>
        </fieldset>
      </div>

      <aside class="sd-watermark__preview" aria-label="Watermark preview" :aria-busy="snapshot.phase === 'previewing'">
        <h3>Preview</h3>
        <div class="sd-watermark__page">
          <img
            v-if="snapshot.preview"
            :src="snapshot.preview.url"
            :width="snapshot.preview.width"
            :height="snapshot.preview.height"
            alt="Watermark on a sample page"
          />
          <p v-else>
            {{
              snapshot.phase === 'loading' || snapshot.phase === 'previewing'
                ? 'Preparing preview…'
                : snapshot.draft.kind === 'none'
                  ? 'No watermark in this preview'
                  : 'Preview unavailable'
            }}
          </p>
        </div>
        <p class="sd-watermark__caption">Preview at the selected page size</p>
        <p class="sd-watermark__impact">{{ snapshot.impact }}</p>
        <details v-if="snapshot.impactDetails?.length" class="sd-watermark__impact-details">
          <summary>View {{ snapshot.impactDetails.length }} affected locations</summary>
          <ul>
            <li v-for="location in snapshot.impactDetails" :key="location">{{ location }}</li>
          </ul>
        </details>
      </aside>
    </div>

    <div v-if="error || snapshot.stale" class="sd-watermark__error" role="alert">
      <p>{{ error || 'The document changed. Review the latest state before applying.' }}</p>
      <button v-if="snapshot.stale || snapshot.error" type="button" :disabled="busy" @click="reload">
        Review latest state
      </button>
    </div>
    <footer class="sd-watermark__footer sd-dialog-footer">
      <p role="status" aria-live="polite">{{ status }}</p>
      <div class="sd-watermark__actions">
        <button type="button" class="sd-dialog-secondary" @click="close">Cancel</button>
        <button type="submit" class="sd-watermark__apply sd-dialog-primary" :disabled="!canApply">
          {{
            snapshot.phase === 'applying'
              ? 'Applying…'
              : snapshot.draft.kind === 'none'
                ? snapshot.items.length > 1
                  ? 'Remove selected watermark'
                  : 'Remove watermark'
                : 'Apply watermark'
          }}
        </button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.sd-watermark {
  height: 640px;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--sd-ui-text, #212121);
  font: 13px/1.4 var(--sd-ui-font-family, Arial, sans-serif);
  container-type: inline-size;
}
.sd-watermark *,
.sd-watermark *::before,
.sd-watermark *::after {
  box-sizing: border-box;
}
.sd-watermark fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.sd-watermark button,
.sd-watermark input,
.sd-watermark select {
  font: inherit;
  color: inherit;
}
.sd-watermark button,
.sd-watermark select,
.sd-watermark input:not([type='radio'], [type='checkbox'], [type='range'], [type='file']) {
  min-height: 32px;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: 6px;
  background: var(--sd-ui-bg, #fff);
  padding: 5px 8px;
}
.sd-watermark input,
.sd-watermark select {
  min-width: 0;
  max-width: 100%;
  accent-color: var(--sd-ui-action, #1355ff);
}
.sd-watermark button {
  cursor: pointer;
}
.sd-watermark button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--sd-ui-action, #1355ff) 6%, var(--sd-ui-bg, #fff));
}
.sd-watermark :focus-visible {
  outline: 2px solid var(--sd-ui-action, #1355ff);
  outline-offset: 2px;
}
.sd-watermark button:disabled,
.sd-watermark fieldset:disabled {
  opacity: 0.55;
}
.sd-watermark button:disabled {
  cursor: not-allowed;
}
.sd-watermark__body {
  display: grid;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  align-items: start;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  padding: 16px;
}
.sd-watermark__settings {
  display: flex;
  height: 100%;
  overflow: auto;
  flex-direction: column;
  gap: 12px;
  padding: 2px 20px 12px 0;
}
.sd-watermark__settings > * {
  flex-shrink: 0;
}
.sd-watermark__scope {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.sd-watermark__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sd-watermark__field > span:first-child,
.sd-watermark legend,
.sd-watermark__field > label {
  font-size: 12px;
  font-weight: 600;
}
.sd-watermark__draft {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.sd-watermark__draft > * {
  grid-column: 1 / -1;
}
.sd-watermark__draft--text .sd-watermark__font-color,
.sd-watermark__draft--text .sd-watermark__transparency {
  grid-column: auto;
}
.sd-watermark__types {
  display: flex;
  padding: 3px !important;
  border: 1px solid var(--sd-ui-border, #dbdbdb) !important;
  border-radius: 8px;
  background: var(--sd-ui-watermark-canvas, #f5f5f5);
  gap: 3px;
}
.sd-watermark__types label {
  flex: 1;
  position: relative;
  text-align: center;
  padding: 6px 4px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}
.sd-watermark__types input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}
.sd-watermark__types label:has(:focus-visible) {
  outline: 2px solid var(--sd-ui-action, #1355ff);
  outline-offset: 2px;
}
.sd-watermark__types .is-selected {
  color: var(--sd-ui-action, #1355ff);
  background: var(--sd-ui-bg, #fff);
  box-shadow: 0 1px 3px #00000012;
  font-weight: 600;
}
.sd-watermark__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: -6px;
}
.sd-watermark__presets button {
  min-height: 26px;
  font-size: 10px;
  padding: 3px 7px;
}
.sd-watermark__font-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 74px auto;
  gap: 8px;
}
.sd-watermark__styles {
  display: flex;
  gap: 4px;
  align-items: end;
}
.sd-watermark__styles button {
  min-width: 32px;
  padding: 5px;
}
.sd-watermark__styles button[aria-pressed='true'] {
  color: var(--sd-ui-action, #1355ff);
  border-color: var(--sd-ui-action, #1355ff);
}
.sd-watermark__color {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sd-watermark__color input[type='color'] {
  width: 32px;
  flex-shrink: 0;
  padding: 4px;
}
.sd-watermark__color input[type='text'] {
  flex: 1;
}
.sd-watermark__range {
  display: flex;
  gap: 6px;
  align-items: center;
}
.sd-watermark__range > input {
  flex: 1;
  width: 100%;
}
.sd-watermark__range label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sd-watermark__range input[type='number'] {
  width: 60px;
}
.sd-watermark small,
.sd-watermark__caption,
.sd-watermark__notice {
  color: var(--sd-ui-text-muted, #666);
  font-size: 11px;
  font-weight: 400;
}
.sd-watermark small {
  display: block;
}
.sd-watermark__orientation {
  display: flex;
  gap: 12px;
}
.sd-watermark__orientation legend {
  margin-bottom: 6px;
}
.sd-watermark__orientation label {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 1;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: 6px;
  padding: 6px 8px;
}
.sd-watermark__check {
  display: flex;
  gap: 8px;
  align-items: start;
}
.sd-watermark__check input {
  margin-top: 3px;
}
.sd-watermark__selection-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 112px;
  overflow: auto;
}
.sd-watermark__selection legend {
  margin-bottom: 8px;
}
.sd-watermark__selection button {
  margin-top: 8px;
}
.sd-watermark__selection .sd-watermark__notice {
  margin-top: 8px;
}
.sd-watermark__picture {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: 6px;
}
.sd-watermark__picture img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}
.sd-watermark__picture > div {
  flex: 1;
  min-width: 100px;
  overflow-wrap: anywhere;
}
.sd-watermark__picture strong {
  font-size: 12px;
  font-weight: 500;
}
.sd-watermark__picture button {
  font-size: 12px;
}
.sd-watermark__preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 2px 0 12px 20px;
  border-left: 1px solid var(--sd-ui-border, #dbdbdb);
  min-width: 0;
}
.sd-watermark__preview h3 {
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 12px;
}
.sd-watermark__page {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  max-height: 340px;
  /* Keep fractional image edges inside WebKit's integer-rounded overflow clip. */
  padding: 1px;
  background: var(--sd-ui-watermark-canvas, #fafafa);
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  overflow: hidden;
}
.sd-watermark__page img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.sd-watermark__page p {
  padding: 16px;
  color: var(--sd-ui-text-muted, #666);
  font-size: 12px;
}
.sd-watermark__caption {
  text-align: center;
  margin: 8px 0 12px;
}
.sd-watermark__impact {
  font-size: 11px;
  line-height: 1.6;
  margin: 0;
}
.sd-watermark__impact-details {
  flex-shrink: 0;
  margin-top: 6px;
  font-size: 11px;
}
.sd-watermark__impact-details summary {
  cursor: pointer;
}
.sd-watermark__impact-details ul {
  max-height: 4.5em;
  overflow: auto;
  margin: 6px 0 0;
  padding: 0 0 2px 18px;
}
.sd-watermark__notice {
  margin: 0;
}
.sd-watermark__error {
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--sd-ui-border, #dbdbdb);
  color: var(--sd-color-red-500, #ed4337);
  font-size: 13px;
}
.sd-watermark__error p {
  margin: 0 0 8px;
}
.sd-watermark__footer p {
  flex: 1;
  font-size: 12px;
  color: var(--sd-ui-text-muted, #666);
  margin: 0;
}
.sd-watermark__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.sd-watermark .sd-watermark__apply {
  color: var(--sd-ui-action-text, #fff);
  background: var(--sd-ui-action, #1355ff);
  border-color: var(--sd-ui-action, #1355ff);
}
.sd-watermark .sd-watermark__apply:hover:not(:disabled) {
  background: var(--sd-ui-action-hover, #0f44cc);
}
.sd-watermark__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@container (max-width: 560px) {
  .sd-watermark button,
  .sd-watermark select,
  .sd-watermark input:not([type='radio'], [type='checkbox'], [type='range'], [type='file']) {
    min-height: 40px;
  }
  .sd-watermark__types label,
  .sd-watermark__orientation label {
    min-height: 40px;
  }
  .sd-watermark__draft--text .sd-watermark__font-color,
  .sd-watermark__draft--text .sd-watermark__transparency {
    grid-column: 1 / -1;
  }
  .sd-watermark__body {
    overflow: auto;
    align-content: start;
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }
  .sd-watermark__settings {
    height: auto;
    overflow: visible;
    padding-right: 0;
  }
  .sd-watermark__preview {
    display: block;
    height: auto;
    border-left: 0;
    border-top: 1px solid var(--sd-ui-border, #dbdbdb);
    padding: 20px 0;
  }
  .sd-watermark__page {
    max-width: 220px;
    margin: auto;
    min-height: 150px;
  }
  .sd-watermark__page img {
    height: auto;
  }
  .sd-watermark__footer {
    flex-wrap: wrap;
  }
  .sd-watermark__actions {
    margin-left: auto;
  }
}
</style>
