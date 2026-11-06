import { SUPERDOC_UI_REASONS, type SuperDocUIReason } from './reasons.js';
import type {
  CommandExecutionResult,
  CommandState,
  ListPresetId,
  PartialLinkEditReceipt,
  Receipt,
  SelectionSlice,
  SuperDocUIFailureReceipt,
  SuperDocUIReceiptFailureCode,
  ViewportRect,
  ViewportRectResult,
  WorkflowActionResult,
} from './types.js';
import type { AnyFn, LooseRecord } from './loose-record.js';
import {
  BUILT_IN_COMMAND_IDS,
  getCommandDescriptor,
  type CommandDescriptor,
  type TrackDecisionSpec,
  type UiDocRoute,
} from './commands.js';
import { isObjectRecord, isPlainObject, isThenable } from '../../helpers/object-guards.js';

export const SUPERDOC_UI_REASON_VALUES = new Set<string>(Object.values(SUPERDOC_UI_REASONS));

export function coerceSuperDocUIReason(reason: unknown, fallback: SuperDocUIReason): SuperDocUIReason {
  return isSuperDocUIReason(reason) ? reason : fallback;
}

function isSuperDocUIReason(value: unknown): value is SuperDocUIReason {
  return typeof value === 'string' && SUPERDOC_UI_REASON_VALUES.has(value);
}

export function normalizeHostSelectionApplyResult(result: unknown): WorkflowActionResult {
  if (isObjectRecord(result)) {
    const ok = result.ok;
    if (ok === false) {
      const reason = result.reason;
      if (reason === 'host-not-ready' || reason === 'host-disposed' || reason === 'editing-mount-required') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      }
      return {
        ok: false,
        reason: coerceSuperDocUIReason(reason, SUPERDOC_UI_REASONS.targetUnresolved),
      };
    }
  }
  return { ok: true };
}

export const LIST_TOGGLE_KINDS: Record<string, 'bullet' | 'ordered'> = {
  [BUILT_IN_COMMAND_IDS.bulletList]: 'bullet',
  [BUILT_IN_COMMAND_IDS.numberedList]: 'ordered',
};

export function listToggleKind(id: string): 'bullet' | 'ordered' | null {
  return LIST_TOGGLE_KINDS[id] ?? null;
}

export const TOOLBAR_LIST_STYLE_PRESETS: Record<string, ListPresetId> = {
  disc: 'disc',
  circle: 'circle',
  square: 'square',
  decimal: 'decimal',
  'decimal-paren': 'decimalParenthesis',
  'upper-roman': 'upperRoman',
  'lower-roman': 'lowerRoman',
  'upper-alpha': 'upperLetter',
  'upper-alpha-paren': 'upperLetterParenthesis',
  'lower-alpha': 'lowerLetter',
  'lower-alpha-paren': 'lowerLetterParenthesis',
};

export function presetFromToolbarStyleKey(styleKey: string): { preset?: ListPresetId; behavior?: 'toggleStyle' } {
  const preset = TOOLBAR_LIST_STYLE_PRESETS[styleKey];
  return preset ? { preset, behavior: 'toggleStyle' } : {};
}

export function safeCall<T>(fn: (() => T) | undefined, fallback: T): T {
  if (typeof fn !== 'function') return fallback;
  try {
    const result = fn();
    return result === undefined ? fallback : result;
  } catch {
    return fallback;
  }
}

export function hostMethod(target: unknown, name: string): ((...args: unknown[]) => unknown) | null {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) return null;
  const member: unknown = Reflect.get(target, name);
  return typeof member === 'function' ? (...args: unknown[]): unknown => Reflect.apply(member, target, args) : null;
}

export function hasAbortedFlag(value: unknown): value is { readonly aborted: boolean } {
  return isPlainObject(value) && typeof value.aborted === 'boolean';
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isThenable(value);
}

export function resolveDocOperation(doc: LooseRecord | null, path: UiDocRoute): AnyFn | null {
  if (!doc) return null;
  const parts = path.split('.');
  const name = parts.pop() ?? '';
  let owner: unknown = doc;
  for (const part of parts) {
    if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) return null;
    owner = Reflect.get(owner, part);
  }
  return hostMethod(owner, name);
}

export function failedReceipt(
  message: string,
  code: Exclude<SuperDocUIReceiptFailureCode, 'PARTIAL_LINK_EDIT'> = 'CAPABILITY_UNAVAILABLE',
): SuperDocUIFailureReceipt {
  return {
    success: false,
    failure: {
      code,
      message,
    },
  };
}

export function partialLinkEditFailure(
  hyperlinkResult: CommandExecutionResult,
  textResult: CommandExecutionResult,
): PartialLinkEditReceipt {
  return {
    success: false,
    failure: {
      code: 'PARTIAL_LINK_EDIT',
      message: 'Hyperlink target was updated, but display text replacement failed.',
    },
    applied: { href: true, text: false },
    hyperlinkResult,
    textResult,
  };
}

export const MIRRORED_EDIT_COMMAND_IDS = {
  undo: 'history.undo',
  redo: 'history.redo',
} as const;

export function normalizeCommandState(state: Partial<CommandState>, source: CommandState['source']): CommandState {
  const supported = state.supported ?? source !== 'unsupported';
  const enabled = state.enabled ?? (state.disabled !== undefined ? !state.disabled : supported);
  return {
    enabled,
    disabled: !enabled,
    active: state.active ?? false,
    ...(typeof state.pending === 'boolean' ? { pending: state.pending } : {}),
    supported,
    value: state.value,
    source,
    reason: enabled ? undefined : state.reason,
  };
}

export function commandResultFromOperationResult(result: unknown): CommandExecutionResult {
  if (isPromiseLike(result)) return true;
  if (result === false) return false;
  if (result === true || result == null) return true;
  if (isReceiptShaped(result)) return result;
  if (isObjectRecord(result) && result.status === 'rejected') return false;
  return true;
}

export function isSuccessfulReceipt(result: CommandExecutionResult): result is Extract<Receipt, { success: true }> {
  return isObjectRecord(result) && result.success === true;
}

export function commandResultSucceeded(result: CommandExecutionResult): boolean {
  if (result === false) return false;
  if (isObjectRecord(result) && result.success === false) return false;
  return true;
}

export function combineCommandResults(results: readonly CommandExecutionResult[]): CommandExecutionResult {
  let last: CommandExecutionResult = false;
  let firstFailure: CommandExecutionResult | null = null;
  let lastRouted: CommandExecutionResult | null = null;
  let lastReceipt: CommandExecutionResult | null = null;
  for (const result of results) {
    last = result;
    if (!commandResultSucceeded(result) && firstFailure === null) firstFailure = result;
    if (isSuccessfulReceipt(result)) lastReceipt = result;
    if (result !== false) lastRouted = result;
  }
  return firstFailure ?? lastReceipt ?? lastRouted ?? last;
}

export function trackDecisionCommand(id: string): TrackDecisionSpec | null {
  return getCommandDescriptor(id)?.trackDecision ?? null;
}

export function rectResult(rects: readonly ViewportRect[]): ViewportRectResult {
  return { found: rects.length > 0, success: rects.length > 0, rects, rect: rects[0] };
}

export function rectFailure(reason: string): ViewportRectResult {
  return { found: false, success: false, rects: [], reason };
}

export function relativizeRects(result: ViewportRectResult, relativeTo?: HTMLElement): ViewportRectResult {
  if (!relativeTo || typeof relativeTo.getBoundingClientRect !== 'function' || result.rects.length === 0) {
    return result;
  }
  let origin: { left: number; top: number };
  try {
    const box = relativeTo.getBoundingClientRect();
    origin = { left: box.left, top: box.top };
  } catch {
    return result;
  }
  const rects = result.rects.map((rect) => ({
    ...rect,
    left: rect.left - origin.left,
    right: rect.right - origin.left,
    top: rect.top - origin.top,
    bottom: rect.bottom - origin.top,
  }));
  return { ...result, rects, rect: rects[0] };
}

export function commandIsActive(descriptor: CommandDescriptor, selection: SelectionSlice): boolean {
  return descriptor.activeMark ? selection.activeMarks.includes(descriptor.activeMark) : false;
}

function isReceiptShaped(value: unknown): value is Receipt {
  return isObjectRecord(value) && ('success' in value || 'failure' in value || 'effects' in value);
}
