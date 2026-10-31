import { describe, expect, it } from 'vite-plus/test';
import { isV2EditableTextMutationEvent } from './v2-typing-mutation-event.js';

describe('isV2EditableTextMutationEvent', () => {
  const typingKinds = [
    'insert-text',
    'replace-text',
    'plain-text-paste',
    'delete-backward',
    'delete-forward',
    'text.insert',
    'text.replace',
    'text.pastePlain',
    'text.deleteBackward',
    'text.deleteForward',
    'structural.enter',
    'structural:enter-split-paragraph',
    'structural:enter-insert-paragraph-before',
    'structural:enter-insert-paragraph-after',
    'structural:shift-enter-line-break',
    'structural:backspace-boundary-merge-with-previous',
    'structural:delete-boundary-merge-with-next',
    'backspace:boundary-merge-with-previous',
    'backspace:list-remove',
    'backspace:list-outdent',
  ];

  it.each(typingKinds)('classifies committed command kind %s as typing-class', (kind) => {
    expect(
      isV2EditableTextMutationEvent({
        type: 'mutation:committed',
        origin: 'command',
        editableCommandKind: kind,
      }),
    ).toBe(true);
  });

  it('rejects committed command mutations without a forwarded kind (programmatic Document API mutations hydrate immediately)', () => {
    expect(
      isV2EditableTextMutationEvent({
        type: 'mutation:committed',
        origin: 'command',
        receipt: { txId: 'tx-1' },
      }),
    ).toBe(false);
  });

  it('rejects non-typing command kinds', () => {
    expect(
      isV2EditableTextMutationEvent({
        type: 'mutation:committed',
        origin: 'command',
        editableCommandKind: 'clipboard-paste',
      }),
    ).toBe(false);
  });

  it('rejects history commits and other event shapes', () => {
    expect(
      isV2EditableTextMutationEvent({
        type: 'mutation:committed',
        origin: 'history',
        editableCommandKind: 'insert-text',
      }),
    ).toBe(false);
    expect(
      isV2EditableTextMutationEvent({
        type: 'reviewTarget:changed',
        origin: 'command',
        editableCommandKind: 'insert-text',
      }),
    ).toBe(false);
    expect(isV2EditableTextMutationEvent(null)).toBe(false);
    expect(isV2EditableTextMutationEvent(undefined)).toBe(false);
  });
});
