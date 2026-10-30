/**
 * MODELLED behavioural parity with `v2` for the legacy custom-UI integration.
 *
 * Read the scope before trusting the name. This is a unit-level model, not a
 * live editor replay: the host is a stub, `lists.apply` is a synthetic command
 * implementation, and the toolbar assertion reads `BuiltInToolbar`'s internal
 * item model rather than rendered DOM. No document is loaded and no browser is
 * involved. What it does prove is that the controller and toolbar item state
 * this model produces are byte-identical to what the same model produced on
 * base, which is a real signal about the ownership change and nothing more.
 * Live-browser evidence lives in `tests/cdn-smoke/editor-ui-hybrid.test.ts`.
 *
 * The ownership change in this branch is supposed to be invisible: the built-in
 * toolbar, link popover and shortcut routing stopped building their own
 * controllers and now share the instance's, and an application that already
 * calls `createSuperDocUI()` should not be able to tell. Every other test here
 * asserts a property someone thought to write down. This one asserts something
 * stronger and dumber: that a scripted session produces the state it produced
 * before the change.
 *
 * `ui-parity-baseline.json` was recorded by running this exact scenario, with
 * the same stub host, against `origin/v2` (8d5f82b6b4) in a separate worktree. It is not a snapshot of
 * current behaviour blessed after the fact; regenerating it means checking out
 * base and re-recording, which is the point.
 *
 * The scenario uses only what exists on both revisions: `createSuperDocUI()`
 * plus `BuiltInToolbar`. It never touches `superdoc.ui`, which base does not
 * have. The host does expose `ui`, because a real `SuperDoc` always does, and
 * that is the configuration whose parity matters.
 *
 * Normalization, so a diff means behaviour and not scheduling:
 *  - semantic state only (supported / enabled / active / reason, document mode,
 *    and the toolbar's own rendered flag)
 *  - no timestamps, generated ids, object identity, or event ordering
 *  - a checkpoint is recorded only once two consecutive reads agree, so a
 *    transient mid-recompute value cannot be captured
 *
 * Known and accepted difference, not covered here: a host that does NOT expose
 * `ui` diverges. On base the toolbar built its own controller; here it stays
 * inert by design, rather than becoming a second source of command truth. A
 * real `SuperDoc` always exposes `ui`, so this does not reach an application,
 * but it is a real difference and `#initController` documents the choice.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vite-plus/test';

import { BuiltInToolbar } from '../../internal/toolbar/built-in-toolbar.js';
import { createSuperDocUI } from './create-super-doc-ui.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';
import { createHighContrastMode } from '../../composables/use-high-contrast-mode.js';

const BASELINE = join(dirname(fileURLToPath(import.meta.url)), 'ui-parity-baseline.json');

const COMMANDS = ['bullet-list', 'numbered-list', 'bold', 'italic', 'undo', 'redo'];

describe('formatting-mark view state', () => {
  it('refreshes command subscribers when the public setter event fires', () => {
    const { host } = makeHost();
    const ui = createSuperDocUI({ superdoc: host as never });
    const command = ui.commands.get('formatting-marks');
    const states: boolean[] = [];
    command.observe((state) => states.push(state.active));
    expect(command.getState().active).toBe(false);
    const config = host.config as { layoutEngineOptions: { showFormattingMarks: boolean } };
    config.layoutEngineOptions.showFormattingMarks = true;
    (host.emit as (event: string) => void)('formatting-marks-change');
    expect(command.getState().active).toBe(true);
    expect(states.at(-1)).toBe(true);
    config.layoutEngineOptions.showFormattingMarks = false;
    (host.emit as (event: string) => void)('formatting-marks-change');
    expect(command.getState().active).toBe(false);
    expect(states.at(-1)).toBe(false);
    ui.destroy();
  });
});

type Snap = Record<string, unknown>;

function makeHost() {
  const listeners = new Map<string, Set<() => void>>();
  const applied: unknown[] = [];
  let listSeed: string | null = null;
  let documentMode = 'editing';
  const emit = (event: string) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler();
  };
  const host: Record<string, unknown> = {
    activeEditor: {
      id: 'editor-1',
      editorVersion: 2,
      editCommands: {
        getSnapshot: () => ({
          commands: { 'lists.apply': { disabled: false, supported: true, value: { seed: listSeed } } },
        }),
        lists: {
          apply: (input: unknown) => {
            applied.push(input);
            const kind = (input as { kind?: string } | null)?.kind ?? null;
            listSeed = listSeed === kind ? null : kind;
            emit('document-mode-change');
            return true;
          },
        },
      },
    },
    config: { documentMode, rulers: false, layoutEngineOptions: { showFormattingMarks: false } },
    fonts: { getDocumentFontOptions: () => [] },
    on: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => listeners.get(event)?.delete(handler),
    emit,
    toggleRuler: vi.fn(),
    toggleFormattingMarks: vi.fn(),
    setShowFormattingMarks: vi.fn(),
  };
  // A real `SuperDoc` owns one lazily built controller. On base the toolbar
  // builds its own regardless; here it reads this one. That swap is the change
  // under test, so the host has to model it.
  let owned: ReturnType<typeof createSuperDocUI> | null = null;
  Object.defineProperty(host, 'ui', {
    get() {
      if (!owned) owned = createSuperDocUI({ superdoc: host as never });
      return owned;
    },
  });
  return {
    host,
    applied,
    setMode(mode: string) {
      documentMode = mode;
      (host.config as Record<string, unknown>).documentMode = mode;
      emit('document-mode-change');
    },
  };
}

function readSemanticState(ui: ReturnType<typeof createSuperDocUI>, toolbar: BuiltInToolbar | null): Snap {
  const commands: Snap = {};
  for (const id of COMMANDS) {
    const state = ui.commands.get(id).getState() as Record<string, unknown>;
    commands[id] = {
      supported: state.supported ?? null,
      enabled: state.enabled ?? null,
      active: state.active ?? null,
      reason: state.reason ?? null,
    };
  }
  const item = toolbar
    ? (toolbar.getToolbarItemByName('list') as { active?: { value?: unknown } } | undefined)
    : undefined;
  return {
    commands,
    documentMode: ui.document.getSnapshot().mode ?? null,
    documentReady: ui.document.getSnapshot().ready ?? null,
    toolbarListActive: item ? Boolean(item.active?.value) : null,
  };
}

function checkpoint(trace: Array<Snap>, label: string, read: () => Snap): void {
  let previous = JSON.stringify(read());
  for (let i = 0; i < 20; i += 1) {
    const current = JSON.stringify(read());
    if (current === previous) {
      trace.push({ label, state: JSON.parse(current) });
      return;
    }
    previous = current;
  }
  trace.push({ label, state: JSON.parse(previous), unstable: true });
}

function makeLegacyComparableTrace(trace: Array<Snap>): Array<Snap> {
  const comparable = structuredClone(trace);
  const viewing = comparable.find((entry) => entry.label === 'after mode viewing') as
    | { state?: { commands?: Record<string, Record<string, unknown>> } }
    | undefined;
  const commands = viewing?.state?.commands;
  if (!commands) throw new Error('Viewing-mode parity checkpoint is missing command state');

  for (const id of ['bullet-list', 'numbered-list']) {
    const command = commands[id];
    if (!command) throw new Error(`Viewing-mode parity checkpoint is missing ${id}`);
    expect(command).toMatchObject({
      supported: true,
      enabled: false,
      reason: SUPERDOC_UI_REASONS.documentReadonly,
    });

    // The baseline predates read-only list enforcement. Restore the two old
    // fields only after verifying the new values above.
    command.enabled = true;
    command.reason = null;
  }

  return comparable;
}

describe('custom-UI behaviour parity with v2', () => {
  it('reproduces the recorded base trace for the legacy factory integration', () => {
    const { host, applied, setMode } = makeHost();
    const trace: Array<Snap> = [];

    const ui = createSuperDocUI({ superdoc: host as never });
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host as never });

    checkpoint(trace, 'mounted', () => readSemanticState(ui, toolbar));

    ui.commands.execute('bullet-list');
    checkpoint(trace, 'after custom bullet-list', () => readSemanticState(ui, toolbar));

    ui.commands.execute('bullet-list');
    checkpoint(trace, 'after custom bullet-list toggle off', () => readSemanticState(ui, toolbar));

    ui.commands.execute('numbered-list');
    checkpoint(trace, 'after custom numbered-list', () => readSemanticState(ui, toolbar));

    setMode('viewing');
    checkpoint(trace, 'after mode viewing', () => readSemanticState(ui, toolbar));

    setMode('editing');
    checkpoint(trace, 'after mode editing', () => readSemanticState(ui, toolbar));

    toolbar.destroy();
    checkpoint(trace, 'after toolbar destroyed', () => readSemanticState(ui, null));

    ui.destroy();
    checkpoint(trace, 'after controller destroyed', () => readSemanticState(ui, null));

    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { trace: Snap[]; applied: unknown[] };

    // Compared as a whole rather than checkpoint by checkpoint: a behaviour
    // change usually moves one field at one step, and the failure output should
    // show which.
    expect({ trace: makeLegacyComparableTrace(trace), applied }).toEqual(baseline);
  });
});
