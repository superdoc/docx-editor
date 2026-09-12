import { describe, expect, it } from 'vite-plus/test';

import {
  createV2KeyboardEditRejectionException,
  createV2KeyboardEditRejectionNotificationGate,
  isV2KeyboardEditRejection,
  V2_EDIT_REJECTED_CODE,
  V2_EDIT_REJECTED_MESSAGE,
} from './v2-keyboard-edit-rejection.js';

const shellRejection = (inputKind, editableCommandKind) => ({
  type: 'mutation:rejected',
  origin: 'document-surface',
  failureSource: 'shell',
  reason: 'raw-internal-reason',
  message: 'raw internal detail',
  inputKind,
  editableCommandKind,
});

describe('isV2KeyboardEditRejection', () => {
  it('matches backward and forward deletion from keydown, beforeinput, and Cut', () => {
    for (const inputKind of ['keydown', 'beforeinput', 'cut']) {
      for (const commandKind of ['delete-backward', 'delete-forward']) {
        expect(isV2KeyboardEditRejection(shellRejection(inputKind, commandKind))).toBe(true);
      }
    }
    expect(
      isV2KeyboardEditRejection({
        ...shellRejection('keydown', 'delete-backward'),
        failureSource: 'receipt',
        failure: { code: 'INVALID_CONTEXT', message: 'raw internal detail' },
      }),
    ).toBe(true);
  });

  it.each([
    ['beforeinput', 'insert-text'],
    ['compositionend', 'insert-text'],
    ['keydown', 'structural:enter-split-paragraph'],
    ['paste', 'plain-text-paste'],
    ['paste', 'clipboard-paste'],
    ['programmatic', 'delete-forward'],
    ['pointerup', 'image-move'],
    ['pointerup', 'sdt-move'],
    ['keydown', 'tab:paragraph-insert-tab'],
    ['keydown', 'tab:list-indent-range'],
    ['keydown', 'tab:list-outdent-range'],
    ['keydown', 'tab:table-append-row'],
  ])('matches failed %s / %s editable-input attempts', (inputKind, commandKind) => {
    expect(isV2KeyboardEditRejection(shellRejection(inputKind, commandKind))).toBe(true);
  });

  it('ignores navigation, history, review, and programmatic API failures', () => {
    expect(isV2KeyboardEditRejection(shellRejection('keydown', 'caret-keyboard-navigation'))).toBe(false);
    expect(isV2KeyboardEditRejection(shellRejection('pointerup', 'pointer-selection'))).toBe(false);
    expect(isV2KeyboardEditRejection(shellRejection('keydown', 'tab:table-next-cell'))).toBe(false);
    expect(isV2KeyboardEditRejection(shellRejection('keydown', 'tab:table-previous-cell'))).toBe(false);
    expect(
      isV2KeyboardEditRejection({
        type: 'mutation:rejected',
        origin: 'history',
        failureSource: 'shell',
        inputKind: 'keydown',
        editableCommandKind: 'delete-backward',
      }),
    ).toBe(false);
    expect(
      isV2KeyboardEditRejection({
        type: 'mutation:rejected',
        origin: 'review',
        failureSource: 'shell',
        inputKind: 'keydown',
        editableCommandKind: 'delete-backward',
      }),
    ).toBe(false);
    expect(
      isV2KeyboardEditRejection({
        type: 'mutation:rejected',
        origin: 'command',
        failureSource: 'receipt',
        failure: { code: 'INVALID_CONTEXT', message: 'raw internal detail' },
      }),
    ).toBe(false);
  });

  it.each([
    'enter-insert-paragraph-before',
    'enter-insert-paragraph-after',
    'enter-list-outdent',
    'enter-list-exit',
    'shift-enter-line-break',
    'mod-enter-page-break',
  ])('matches the normalized %s Enter operation', (operation) => {
    expect(isV2KeyboardEditRejection(shellRejection('keydown', `structural:${operation}`))).toBe(true);
  });

  it.each(['beforeinput', 'compositionend', 'paste'])(
    'reports an early %s edit rejection before a command was resolved',
    (inputKind) => {
      expect(isV2KeyboardEditRejection(shellRejection(inputKind, undefined))).toBe(true);
      expect(isV2KeyboardEditRejection(shellRejection(inputKind, 'caret-keyboard-navigation'))).toBe(false);
    },
  );

  it('ignores non-rejection events while accepting Cut without a command kind', () => {
    expect(isV2KeyboardEditRejection(shellRejection('cut', undefined))).toBe(true);
    expect(isV2KeyboardEditRejection({ type: 'mutation:committed' })).toBe(false);
    expect(isV2KeyboardEditRejection(null)).toBe(false);
    expect(isV2KeyboardEditRejection(undefined)).toBe(false);
  });

  it('suppresses duplicate delivery of the same event only within its document session', () => {
    const gate = createV2KeyboardEditRejectionNotificationGate();
    const rejection = shellRejection('keydown', 'delete-backward');
    expect(gate.shouldNotify('doc-a', rejection)).toBe(true);
    expect(gate.shouldNotify('doc-a', rejection)).toBe(false);
    expect(gate.shouldNotify('doc-b', rejection)).toBe(true);
    gate.clear('doc-a');
    expect(gate.shouldNotify('doc-a', rejection)).toBe(true);
    expect(gate.shouldNotify('doc-b', rejection)).toBe(false);
  });

  it('reports independent attempts with the same failure without requiring a successful mutation', () => {
    const gate = createV2KeyboardEditRejectionNotificationGate();
    const first = shellRejection('keydown', 'delete-backward');
    const second = shellRejection('keydown', 'delete-backward');

    expect(gate.shouldNotify('doc-a', first)).toBe(true);
    expect(gate.shouldNotify('doc-a', second)).toBe(true);
    expect(gate.shouldNotify('doc-a', second)).toBe(false);
    expect(gate.shouldNotify('doc-b', second)).toBe(true);
  });

  it.each([null, undefined, {}, { type: 'mutation:rejected' }])(
    'ignores malformed events without consuming the next attempt: %j',
    (event) => {
      const gate = createV2KeyboardEditRejectionNotificationGate();
      expect(isV2KeyboardEditRejection(event)).toBe(false);
      expect(gate.shouldNotify('doc-a', event)).toBe(false);
      expect(gate.shouldNotify('doc-a', shellRejection('keydown', 'delete-backward'))).toBe(true);
    },
  );

  it.each(['shell', 'receipt'])(
    'preserves safe %s diagnostics in Error.cause and the existing exception envelope',
    (failureSource) => {
      const event = {
        ...shellRejection('keydown', 'delete-backward'),
        failureSource,
        reason: failureSource === 'receipt' ? 'INVALID_CONTEXT' : 'input-target-unsupported',
        message: '<w:t>private document text</w:t>',
        failure: {
          code: 'INVALID_CONTEXT',
          message: 'private document text',
          details: { xml: '<w:t>private document text</w:t>' },
        },
        stack: 'private stack',
      };
      const exception = createV2KeyboardEditRejectionException('doc-a', event);

      expect(Object.keys(exception).sort()).toEqual(['code', 'documentId', 'editor', 'error']);
      expect(exception).toMatchObject({ code: 'edit-rejected', documentId: 'doc-a', editor: null });
      expect(exception.error).toBeInstanceOf(Error);
      expect(exception.error.cause).toEqual({
        failureSource,
        reason: event.reason,
        inputKind: 'keydown',
        editableCommandKind: 'delete-backward',
      });
      expect(JSON.stringify(exception.error.cause)).not.toMatch(/private|<w:|stack|message|details/);
    },
  );

  it('omits unavailable operation metadata without inventing an input kind', () => {
    const exception = createV2KeyboardEditRejectionException(undefined, {
      type: 'mutation:rejected',
      origin: 'document-surface',
      failureSource: 'shell',
      reason: 'input-target-unsupported',
      inputKind: 'cut',
    });

    expect(exception).not.toHaveProperty('documentId');
    expect(exception.error.cause).toEqual({
      failureSource: 'shell',
      reason: 'input-target-unsupported',
      inputKind: 'cut',
    });
  });

  it('does not copy malformed diagnostic fields into Error.cause', () => {
    const exception = createV2KeyboardEditRejectionException('doc-a', {
      failureSource: '<w:t>private</w:t>',
      reason: 'private document text',
      inputKind: { text: 'private' },
      editableCommandKind: '<w:t>private</w:t>',
    });
    expect(exception.error.cause).toEqual({});
  });

  it.each([null, undefined, {}])('keeps the exception envelope safe with missing diagnostics: %j', (event) => {
    const exception = createV2KeyboardEditRejectionException('', event);
    expect(exception).toMatchObject({ code: 'edit-rejected', editor: null });
    expect(exception).not.toHaveProperty('documentId');
    expect(exception.error).toBeInstanceOf(Error);
    expect(exception.error.cause ?? {}).toEqual({});
  });

  it('keeps a stable code and content-safe fallback message for exception consumers', () => {
    expect(V2_EDIT_REJECTED_CODE).toBe('edit-rejected');
    expect(V2_EDIT_REJECTED_MESSAGE).not.toMatch(/raw|INVALID_|section|table|tracked|receipt/i);
    expect(createV2KeyboardEditRejectionException('doc-a').error.message).toBe(V2_EDIT_REJECTED_MESSAGE);
  });
});
