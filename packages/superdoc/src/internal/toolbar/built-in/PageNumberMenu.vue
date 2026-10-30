<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { PropType } from 'vue';
import type {
  HeaderFooterKind,
  HeaderFooterPageNumberAlignment,
  HeaderFooterPageNumbersInfo,
  SectionPageNumberingFormat,
} from '@superdoc/document-api';
import { useHighContrastMode } from '../../../composables/use-high-contrast-mode';
import { isPlainObject } from '../../../helpers/object-guards.js';
import type { CommandExecutionResult, CommandState } from '../../../public/ui/types.js';

type PagePosition = 'top' | 'bottom';

interface PageNumberChoice {
  position: PagePosition;
  alignment?: HeaderFooterPageNumberAlignment;
  showOnFirstPage?: boolean;
  format?: SectionPageNumberingFormat;
  start?: number | null;
}

interface RememberedChoice {
  position: PagePosition;
  alignment: HeaderFooterPageNumberAlignment | null;
  showOnFirstPage: boolean;
}

type PageNumberMenuOutcome =
  | { action: 'apply'; choice: RememberedChoice }
  | { action: 'remove'; kinds: HeaderFooterKind[] }
  | { action: 'cursor' };

type PageNumberAction = 'apply' | 'remove';

interface PreparedCommit {
  execute: () => Promise<CommandExecutionResult>;
  outcome: PageNumberMenuOutcome;
}

const props = defineProps({
  /** Command state of `page-numbers-apply`, read when the popover opens. */
  pageNumbersState: { type: Object as PropType<CommandState | null>, default: null },
  /** Command state of `page-number-insert` (insert at the header/footer cursor). */
  atCursorState: { type: Object as PropType<CommandState | null>, default: null },
  /** Header/footer structure cannot be suggested, so numbering needs Editing. */
  suggesting: { type: Boolean, default: false },
  /** The selection is in a header or footer, so a disabled cursor insert needs a collapsed caret. */
  inHeaderFooter: { type: Boolean, default: false },
  /** Resolves the caret section's page numbers (`headerFooters.pageNumbers.get`), or null. */
  loadCurrent: {
    type: Function as PropType<() => Promise<HeaderFooterPageNumbersInfo | null>>,
    default: null,
  },
  /** Runs `page-numbers-apply` with `{ position, alignment?, showOnFirstPage?, format?, start? }`. */
  applyPageNumbers: {
    type: Function as PropType<(choice: PageNumberChoice) => Promise<CommandExecutionResult>>,
    required: true,
  },
  /** Runs `page-numbers-remove`. */
  removePageNumbers: { type: Function as PropType<() => Promise<CommandExecutionResult>>, required: true },
  /** Runs `page-number-insert` at the header/footer cursor. */
  insertAtCursor: { type: Function as PropType<() => Promise<CommandExecutionResult>>, required: true },
  /** Closes the popover after a successful action. */
  close: { type: Function as PropType<(outcome: PageNumberMenuOutcome) => void>, required: true },
  /** Last choice made in this session, used when the section has no numbers yet. */
  initialChoice: { type: Object as PropType<RememberedChoice | null>, default: null },
});

const POSITIONS: { value: PagePosition; label: string; kind: HeaderFooterKind }[] = [
  { value: 'top', label: 'Top of page', kind: 'header' },
  { value: 'bottom', label: 'Bottom of page', kind: 'footer' },
];
const ALIGNMENTS: { value: HeaderFooterPageNumberAlignment; label: string }[] = [
  { value: 'left', label: 'left' },
  { value: 'center', label: 'center' },
  { value: 'right', label: 'right' },
];
const TILES = POSITIONS.flatMap((position) =>
  ALIGNMENTS.map((alignment) => ({
    position: position.value,
    alignment: alignment.value,
    label: `${position.label}, ${alignment.label}`,
  })),
);
// Word's Format Page Numbers styles. Hebrew styles are listed only when a document uses them.
const FORMATS: { value: SectionPageNumberingFormat; label: string }[] = [
  { value: 'decimal', label: '1, 2, 3' },
  { value: 'lowerLetter', label: 'a, b, c' },
  { value: 'upperLetter', label: 'A, B, C' },
  { value: 'lowerRoman', label: 'i, ii, iii' },
  { value: 'upperRoman', label: 'I, II, III' },
  { value: 'numberInDash', label: '- 1 -, - 2 -' },
];
const EXTRA_FORMATS: { value: SectionPageNumberingFormat; label: string }[] = [
  { value: 'hebrew1', label: 'א, ב, ג' },
  { value: 'hebrew2', label: 'א, ב, ג (alphabet)' },
];
// Number chip placement inside the 36 x 46 page sketch.
const CHIP_X: Record<HeaderFooterPageNumberAlignment, number> = { left: 6, center: 14, right: 22 };
const CHIP_Y: Record<PagePosition, number> = { top: 4, bottom: 37 };

const { isHighContrastMode } = useHighContrastMode();
const remembered: Partial<RememberedChoice> = props.initialChoice ?? {};
const position = ref<PagePosition>(remembered.position === 'top' ? 'top' : 'bottom');
const alignment = ref<HeaderFooterPageNumberAlignment | null>(
  isAlignment(remembered.alignment) ? remembered.alignment : 'right',
);
const showOnFirstPage = ref(remembered.showOnFirstPage !== false);
const format = ref<SectionPageNumberingFormat>('decimal');
const restart = ref(false);
const startAt = ref(1);
const current = ref<HeaderFooterPageNumbersInfo | null>(null);
const loading = ref(typeof props.loadCurrent === 'function');
let loaded: Promise<void> = Promise.resolve();
const touched = ref(false);
const busy = ref(false);
const message = ref('');
const tileRefs = ref<(HTMLElement | null)[]>([]);

const canApply = computed(() => props.pageNumbersState?.enabled === true);
const canInsertAtCursor = computed(() => props.atCursorState?.enabled === true);
const hasNumbers = computed(() => (current.value?.placements?.length ?? 0) > 0);
const formatOptions = computed(() =>
  EXTRA_FORMATS.some((entry) => entry.value === format.value) ? [...FORMATS, ...EXTRA_FORMATS] : FORMATS,
);
const selectedIndex = computed(() =>
  TILES.findIndex((tile) => tile.position === position.value && tile.alignment === alignment.value),
);
const focusIndex = computed(() => {
  if (selectedIndex.value >= 0) return selectedIndex.value;
  const row = POSITIONS.findIndex((entry) => entry.value === position.value);
  return Math.max(0, row) * ALIGNMENTS.length;
});
const primaryLabel = computed(() => (hasNumbers.value ? 'Apply' : 'Add page numbers'));
const unavailableNote = computed(() => {
  if (canApply.value) return '';
  return props.suggesting
    ? 'Page numbers can’t be changed as a suggestion. Switch to Editing to change them.'
    : 'Page numbers can’t be changed right now.';
});
const atCursorHint = computed(() => {
  if (canInsertAtCursor.value) return 'In the header or footer you’re editing';
  return props.inHeaderFooter ? 'Place the cursor without selecting text' : 'Click into a header or footer first';
});
const shortcutLabel = computed(() => {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad/i.test(platform) ? '⌥⇧⌘P' : 'Ctrl+Alt+Shift+P';
});

type Tile = (typeof TILES)[number];

function isAlignment(value: unknown): value is HeaderFooterPageNumberAlignment {
  return ALIGNMENTS.some((entry) => entry.value === value);
}

function isTileSelected(tile: Tile) {
  return tile.position === position.value && tile.alignment === alignment.value;
}

function markTouched() {
  touched.value = true;
  message.value = '';
}

function selectTile(tile: Tile, { focus = false }: { focus?: boolean } = {}) {
  position.value = tile.position;
  alignment.value = tile.alignment;
  markTouched();
  if (focus) {
    void nextTick(() => tileRefs.value[TILES.indexOf(tile)]?.focus());
  }
}

function moveSelection(event: KeyboardEvent) {
  const index = focusIndex.value;
  const row = Math.floor(index / ALIGNMENTS.length);
  const column = index % ALIGNMENTS.length;
  const moves: Record<string, [number, number] | undefined> = {
    ArrowLeft: [row, Math.max(0, column - 1)],
    ArrowRight: [row, Math.min(ALIGNMENTS.length - 1, column + 1)],
    ArrowUp: [Math.max(0, row - 1), column],
    ArrowDown: [Math.min(POSITIONS.length - 1, row + 1), column],
    Home: [row, 0],
    End: [row, ALIGNMENTS.length - 1],
  };
  const next = moves[event.key];
  if (!next) return false;
  event.preventDefault();
  selectTile(TILES[next[0] * ALIGNMENTS.length + next[1]], { focus: true });
  return true;
}

function onTileKeydown(event: KeyboardEvent) {
  if (moveSelection(event)) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    void applyPageNumbers();
  } else if (event.key === ' ') {
    event.preventDefault();
  }
}

/** Show the section's numbers, unless the user already started choosing. */
function adoptCurrent(info: HeaderFooterPageNumbersInfo | null) {
  current.value = info && Array.isArray(info.placements) ? info : null;
  if (!current.value || touched.value) return;
  const placement =
    current.value.placements.find((entry) => entry.kind === 'footer' && entry.alignment) ??
    current.value.placements.find((entry) => entry.alignment) ??
    current.value.placements[0];
  if (placement) {
    position.value = placement.kind === 'header' ? 'top' : 'bottom';
    alignment.value = placement.alignment ?? null;
    showOnFirstPage.value = current.value.showOnFirstPage !== false;
  }
  format.value = current.value.format ?? 'decimal';
  restart.value = typeof current.value.start === 'number';
  startAt.value = typeof current.value.start === 'number' ? current.value.start : 1;
  void nextTick(() => tileRefs.value[focusIndex.value]?.focus({ preventScroll: true }));
}

/** The apply payload: the position always, other options only when they change something. */
function buildChoice() {
  const info = current.value;
  const kind = position.value === 'top' ? 'header' : 'footer';
  const placement = info?.placements?.find((entry) => entry.kind === kind) ?? null;
  const choice: PageNumberChoice = { position: position.value };
  if (alignment.value && (!placement || placement.alignment !== alignment.value)) choice.alignment = alignment.value;
  if (!hasNumbers.value || showOnFirstPage.value !== (info?.showOnFirstPage !== false)) {
    choice.showOnFirstPage = showOnFirstPage.value;
  }
  if (format.value !== (info?.format ?? 'decimal')) choice.format = format.value;
  const start = restart.value ? normalizedStart() : null;
  if (start !== (info?.start ?? null)) choice.start = start;
  return choice;
}

function normalizedStart() {
  const value = Math.floor(Number(startAt.value));
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function failureDetails(result: CommandExecutionResult | null): Record<string, unknown> | null {
  if (typeof result !== 'object' || result === null || result.success) return null;
  return isPlainObject(result.failure?.details) ? result.failure.details : null;
}

function failureMessage(result: CommandExecutionResult | null, action: PageNumberAction) {
  const details = failureDetails(result);
  if (details?.reason === 'page-number-has-content') {
    return `A page number shares its line with other text. Edit the ${details.kind === 'header' ? 'header' : 'footer'} directly to change it.`;
  }
  if (details?.reason === 'page-number-exists') return 'This section already has page numbers.';
  if (action === 'remove') return 'Page numbers couldn’t be removed. Try again.';
  return hasNumbers.value
    ? 'Page numbers couldn’t be changed. Try again.'
    : 'Page numbers couldn’t be added. Try again.';
}

/**
 * Run an action once the section's numbers are known. A commit made while they
 * load waits for them, so it changes what the section actually has.
 */
async function commit(action: PageNumberAction, prepare: () => PreparedCommit) {
  if (!canApply.value || busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await loaded;
    const { execute, outcome } = prepare();
    const result = await execute();
    if (result === true || (typeof result === 'object' && result !== null && result.success === true)) {
      props.close(outcome);
      return;
    }
    message.value = failureMessage(result, action);
  } catch {
    message.value = failureMessage(null, action);
  } finally {
    busy.value = false;
  }
}

function applyPageNumbers() {
  return commit('apply', () => {
    const choice = buildChoice();
    return {
      execute: () => props.applyPageNumbers(choice),
      outcome: {
        action: 'apply',
        choice: { position: position.value, alignment: alignment.value, showOnFirstPage: showOnFirstPage.value },
      },
    };
  });
}

function removePageNumbers() {
  return commit('remove', () => ({
    execute: () => props.removePageNumbers(),
    outcome: { action: 'remove', kinds: (current.value?.placements ?? []).map((entry) => entry.kind) },
  }));
}

function insertAtCursor() {
  if (!canInsertAtCursor.value || busy.value) return;
  busy.value = true;
  // Start the insert before focus returns to the editor. The field then enters
  // the editor's command queue first, so keys typed right away land after it,
  // as they do with the keyboard shortcut.
  let pending: Promise<CommandExecutionResult> | undefined;
  try {
    pending = props.insertAtCursor();
  } catch {
    pending = undefined;
  }
  props.close({ action: 'cursor' });
  void Promise.resolve(pending).catch(() => undefined);
}

onMounted(() => {
  void nextTick(() => tileRefs.value[focusIndex.value]?.focus({ preventScroll: true }));
  const loadCurrent = props.loadCurrent;
  if (typeof loadCurrent !== 'function') return;
  loaded = Promise.resolve()
    .then(() => loadCurrent())
    .then(adoptCurrent, () => adoptCurrent(null))
    .finally(() => {
      loading.value = false;
    });
});
</script>

<template>
  <div
    class="sd-page-number-menu"
    :class="{ 'high-contrast': isHighContrastMode }"
    role="group"
    aria-labelledby="sd-page-number-menu-title"
    :aria-busy="loading || undefined"
    data-sd-page-number-menu
  >
    <div id="sd-page-number-menu-title" class="sd-page-number-menu__title">Page numbers</div>

    <div
      class="sd-page-number-menu__grid"
      role="radiogroup"
      aria-label="Position"
      :aria-disabled="!canApply || undefined"
    >
      <template v-for="(row, rowIndex) in POSITIONS" :key="row.value">
        <div class="sd-page-number-menu__row-label" aria-hidden="true">{{ row.label }}</div>
        <button
          v-for="tile in TILES.slice(rowIndex * 3, rowIndex * 3 + 3)"
          :key="`${tile.position}-${tile.alignment}`"
          :ref="(element) => (tileRefs[TILES.indexOf(tile)] = element as HTMLElement | null)"
          type="button"
          role="radio"
          class="sd-page-number-menu__tile"
          :class="{ 'is-selected': isTileSelected(tile) }"
          :aria-checked="isTileSelected(tile)"
          :aria-label="tile.label"
          :title="tile.label"
          :tabindex="TILES.indexOf(tile) === focusIndex ? 0 : -1"
          :data-position="tile.position"
          :data-alignment="tile.alignment"
          @click="selectTile(tile)"
          @dblclick="applyPageNumbers"
          @keydown="onTileKeydown"
        >
          <svg class="sd-page-number-menu__page" viewBox="0 0 36 46" aria-hidden="true" focusable="false">
            <rect class="sd-page-number-menu__sheet" x="0.75" y="0.75" width="34.5" height="44.5" rx="2.5" />
            <rect class="sd-page-number-menu__line" x="7" y="14" width="22" height="2" rx="1" />
            <rect class="sd-page-number-menu__line" x="7" y="19" width="18" height="2" rx="1" />
            <rect class="sd-page-number-menu__line" x="7" y="24" width="22" height="2" rx="1" />
            <rect class="sd-page-number-menu__line" x="7" y="29" width="14" height="2" rx="1" />
            <rect
              class="sd-page-number-menu__chip"
              :x="CHIP_X[tile.alignment]"
              :y="CHIP_Y[tile.position]"
              width="8"
              height="5"
              rx="1.5"
            />
          </svg>
        </button>
      </template>
    </div>

    <label class="sd-page-number-menu__check">
      <input
        v-model="showOnFirstPage"
        type="checkbox"
        :disabled="!canApply"
        data-sd-page-number-first-page
        @change="markTouched"
      />
      <span>Show on first page</span>
    </label>

    <div class="sd-page-number-menu__format">
      <label class="sd-page-number-menu__field">
        <span>Format</span>
        <select v-model="format" :disabled="!canApply" data-sd-page-number-format @change="markTouched">
          <option v-for="option in formatOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <div class="sd-page-number-menu__start">
        <label class="sd-page-number-menu__check">
          <input
            v-model="restart"
            type="checkbox"
            :disabled="!canApply"
            data-sd-page-number-restart
            @change="markTouched"
          />
          <span>Start at</span>
        </label>
        <input
          v-model.number="startAt"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          aria-label="First page number"
          :disabled="!canApply || !restart"
          data-sd-page-number-start
          @input="markTouched"
          @keydown.enter.prevent="applyPageNumbers"
        />
      </div>
    </div>

    <p v-if="message" class="sd-page-number-menu__error" role="alert">
      {{ message }}
    </p>
    <p v-else-if="unavailableNote" class="sd-page-number-menu__note" role="status">
      {{ unavailableNote }}
    </p>

    <div class="sd-page-number-menu__actions">
      <button
        v-if="hasNumbers"
        type="button"
        class="sd-page-number-menu__remove"
        :disabled="!canApply || busy"
        aria-label="Remove page numbers"
        data-sd-page-number-remove
        @click="removePageNumbers"
      >
        Remove
      </button>
      <button
        type="button"
        class="sd-page-number-menu__add"
        :disabled="!canApply || busy"
        data-sd-page-number-add
        @click="applyPageNumbers"
      >
        {{ primaryLabel }}
      </button>
    </div>

    <div class="sd-page-number-menu__divider" role="separator"></div>

    <button
      type="button"
      class="sd-page-number-menu__cursor"
      :disabled="!canInsertAtCursor || busy"
      data-sd-page-number-at-cursor
      @click="insertAtCursor"
    >
      <span class="sd-page-number-menu__cursor-text">
        <span>Insert at cursor</span>
        <small>{{ atCursorHint }}</small>
      </span>
      <kbd>{{ shortcutLabel }}</kbd>
    </button>
  </div>
</template>

<style scoped>
.sd-page-number-menu {
  box-sizing: border-box;
  width: 272px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--sd-ui-text, #47484a);
  font-family: var(--sd-ui-font-family, Arial, Helvetica, sans-serif);
  font-size: var(--sd-ui-font-size-300, 13px);
  background: var(--sd-ui-dropdown-bg, #ffffff);
  border-radius: var(--sd-ui-radius, 6px);
}

.sd-page-number-menu__title {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.sd-page-number-menu__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.sd-page-number-menu__grid[aria-disabled='true'] {
  opacity: 0.55;
}

.sd-page-number-menu__row-label {
  grid-column: 1 / -1;
  margin-top: 2px;
  color: var(--sd-ui-text-muted, #666666);
  font-size: var(--sd-ui-font-size-100, 11px);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.sd-page-number-menu__tile {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  padding: 0;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: 6px;
  background: var(--sd-ui-bg, #ffffff);
  color: var(--sd-ui-text-disabled, #9a9a9a);
  cursor: pointer;
  transition:
    background-color 120ms ease-out,
    border-color 120ms ease-out,
    color 120ms ease-out;
}

.sd-page-number-menu__tile:hover {
  background: var(--sd-ui-dropdown-hover-bg, #f0f2f5);
}

.sd-page-number-menu__tile:focus-visible {
  outline: 2px solid var(--sd-ui-action, #1355ff);
  outline-offset: 2px;
}

.sd-page-number-menu__tile.is-selected {
  border-color: var(--sd-ui-action, #1355ff);
  box-shadow: inset 0 0 0 1px var(--sd-ui-action, #1355ff);
  background: color-mix(in srgb, var(--sd-ui-action, #1355ff) 7%, var(--sd-ui-bg, #ffffff));
  color: var(--sd-ui-action, #1355ff);
}

.sd-page-number-menu__page {
  width: 36px;
  height: 46px;
  overflow: visible;
}

.sd-page-number-menu__sheet {
  fill: var(--sd-ui-bg, #ffffff);
  stroke: var(--sd-ui-border, #c9ced6);
  stroke-width: 1.5;
}

.sd-page-number-menu__line {
  fill: var(--sd-ui-border, #dbdbdb);
}

.sd-page-number-menu__chip {
  fill: currentColor;
  transform-box: fill-box;
  transform-origin: center;
}

.sd-page-number-menu__tile.is-selected .sd-page-number-menu__chip {
  animation: sd-page-number-chip-in 160ms ease-out;
}

@keyframes sd-page-number-chip-in {
  from {
    transform: scale(0.4);
    opacity: 0.4;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.sd-page-number-menu__check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.sd-page-number-menu__check input {
  margin: 0;
  accent-color: var(--sd-ui-action, #1355ff);
}

.sd-page-number-menu__format {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--sd-ui-border, #e6e6e6);
}

.sd-page-number-menu__field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sd-page-number-menu__field select,
.sd-page-number-menu__start input[type='number'] {
  box-sizing: border-box;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: var(--sd-ui-dropdown-option-radius, 4px);
  background: var(--sd-ui-bg, #ffffff);
  color: inherit;
  font: inherit;
}

.sd-page-number-menu__field select {
  width: 132px;
  cursor: pointer;
}

.sd-page-number-menu__start {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sd-page-number-menu__start input[type='number'] {
  width: 64px;
  font-variant-numeric: tabular-nums;
}

.sd-page-number-menu__field select:focus-visible,
.sd-page-number-menu__start input[type='number']:focus-visible {
  outline: 2px solid var(--sd-ui-action, #1355ff);
  outline-offset: 1px;
}

.sd-page-number-menu__field select:disabled,
.sd-page-number-menu__start input[type='number']:disabled {
  color: var(--sd-ui-text-disabled, #9a9a9a);
  cursor: not-allowed;
}

.sd-page-number-menu__actions {
  display: flex;
  gap: 8px;
}

.sd-page-number-menu__actions .sd-page-number-menu__add {
  flex: 1;
}

.sd-page-number-menu__remove {
  padding: 8px 12px;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: var(--sd-ui-radius, 6px);
  background: var(--sd-ui-bg, #ffffff);
  color: var(--sd-color-rose-500, #cb0e47);
  font: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background-color 120ms ease-out,
    border-color 120ms ease-out;
}

.sd-page-number-menu__remove:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--sd-color-rose-500, #cb0e47) 40%, var(--sd-ui-border, #dbdbdb));
  background: color-mix(in srgb, var(--sd-color-rose-500, #cb0e47) 6%, var(--sd-ui-bg, #ffffff));
}

.sd-page-number-menu__remove:focus-visible {
  outline: 2px solid var(--sd-ui-action, #1355ff);
  outline-offset: 2px;
}

.sd-page-number-menu__remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sd-page-number-menu__note {
  margin: -4px 0 0;
  color: var(--sd-ui-text-muted, #666666);
  font-size: var(--sd-ui-font-size-200, 12px);
  line-height: 1.4;
}

/* A failed Apply or Remove must read as an error next to the button that caused it. */
.sd-page-number-menu__error {
  margin: -4px 0 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--sd-color-rose-500, #cb0e47) 35%, var(--sd-ui-border, #dbdbdb));
  border-radius: var(--sd-ui-radius, 6px);
  background: color-mix(in srgb, var(--sd-color-rose-500, #cb0e47) 7%, var(--sd-ui-bg, #ffffff));
  color: var(--sd-color-rose-500, #cb0e47);
  font-size: var(--sd-ui-font-size-200, 12px);
  line-height: 1.4;
  letter-spacing: 0.01em;
  animation: sd-page-number-menu-error-in 0.16s ease-out;
}

@keyframes sd-page-number-menu-error-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.sd-page-number-menu__add {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  padding: 8px 12px;
  border: none;
  border-radius: var(--sd-ui-radius, 6px);
  background: var(--sd-ui-action, #1355ff);
  color: var(--sd-ui-action-text, #ffffff);
  font: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color 120ms ease-out;
}

.sd-page-number-menu__add:hover:not(:disabled) {
  background: var(--sd-ui-action-hover, #0f44cc);
}

.sd-page-number-menu__add:focus-visible,
.sd-page-number-menu__cursor:focus-visible {
  outline: 2px solid var(--sd-ui-action, #1355ff);
  outline-offset: 2px;
}

.sd-page-number-menu__add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sd-page-number-menu__divider {
  height: 1px;
  margin: 0 -14px;
  background: var(--sd-ui-border, #e6e6e6);
}

.sd-page-number-menu__cursor {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px -8px -6px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--sd-ui-dropdown-option-radius, 3px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sd-page-number-menu__cursor:hover:not(:disabled) {
  background: var(--sd-ui-dropdown-hover-bg, #f0f2f5);
}

.sd-page-number-menu__cursor:disabled {
  cursor: default;
  color: var(--sd-ui-text-disabled, #9a9a9a);
}

.sd-page-number-menu__cursor-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sd-page-number-menu__cursor small {
  color: var(--sd-ui-text-muted, #666666);
  font-size: var(--sd-ui-font-size-100, 11px);
  letter-spacing: 0.01em;
}

.sd-page-number-menu__cursor:disabled small {
  color: inherit;
}

.sd-page-number-menu__cursor kbd {
  flex-shrink: 0;
  padding: 2px 5px;
  border: 1px solid var(--sd-ui-border, #dbdbdb);
  border-radius: 4px;
  color: var(--sd-ui-text-muted, #666666);
  font-family: inherit;
  font-size: var(--sd-ui-font-size-100, 11px);
  letter-spacing: 0.02em;
}

.high-contrast .sd-page-number-menu__tile,
.high-contrast .sd-page-number-menu__sheet {
  border-color: #000;
  stroke: #000;
}

.high-contrast .sd-page-number-menu__tile.is-selected {
  background: #000;
  color: #fff;
}

.high-contrast .sd-page-number-menu__error {
  border-color: #000;
  background: #fff;
  color: #000;
}

@media (prefers-reduced-motion: reduce) {
  .sd-page-number-menu__tile,
  .sd-page-number-menu__add,
  .sd-page-number-menu__remove {
    transition: none;
  }

  .sd-page-number-menu__tile.is-selected .sd-page-number-menu__chip,
  .sd-page-number-menu__error {
    animation: none;
  }
}
</style>

<style>
/* Post-insert confirmation on painted header/footer regions (see page-number-feedback.js).
   An outline outside the region never paints over the new number. */
.sd-page-number-flash {
  outline: 2px solid transparent;
  outline-offset: 4px;
  border-radius: 2px;
  animation: sd-page-number-flash 1400ms ease-out;
}

@keyframes sd-page-number-flash {
  0%,
  35% {
    outline-color: color-mix(in srgb, var(--sd-ui-action, #1355ff) 55%, transparent);
    background-color: color-mix(in srgb, var(--sd-ui-action, #1355ff) 6%, transparent);
  }
  100% {
    outline-color: transparent;
    background-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sd-page-number-flash {
    animation: none;
    outline-color: color-mix(in srgb, var(--sd-ui-action, #1355ff) 55%, transparent);
  }
}
</style>
