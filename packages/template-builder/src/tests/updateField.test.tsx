import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import SuperDocTemplateBuilder from '../index';
import type { SuperDocTemplateBuilderHandle } from '../types';

const updateStructuredContentByIdMock = vi.fn(() => false);

vi.mock('superdoc', () => {
  class MockSuperDoc {
    activeEditor: any;
    superdocStore: any;

    constructor(options: { onReady?: () => void }) {
      this.activeEditor = {
        state: {},
        view: {
          coordsAtPos: () => ({ left: 0, top: 0, bottom: 0 }),
        },
        commands: {
          updateStructuredContentById: updateStructuredContentByIdMock,
        },
        helpers: {
          structuredContentCommands: {
            getStructuredContentTags: () => [],
          },
        },
        on: vi.fn(),
      };

      this.superdocStore = {
        documents: [{ getPresentationEditor: () => ({ coordsAtPos: () => ({ left: 0, top: 0, bottom: 0 }) }) }],
      };

      queueMicrotask(() => options.onReady?.());
    }

    destroy() {}

    setDocumentMode() {}
  }

  return { SuperDoc: MockSuperDoc };
});

const renderBuilder = async (props = {}) => {
  const ref = createRef<SuperDocTemplateBuilderHandle>();
  const onReady = vi.fn();

  render(
    <SuperDocTemplateBuilder
      ref={ref}
      document={{ mode: 'editing' }}
      fields={{ available: [] }}
      onReady={onReady}
      {...props}
    />,
  );

  await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(ref.current).not.toBeNull());

  return ref;
};

describe('SuperDocTemplateBuilder updateField', () => {
  beforeEach(() => {
    updateStructuredContentByIdMock.mockReset();
    updateStructuredContentByIdMock.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns false when the editor command does not update a field', async () => {
    const onFieldUpdate = vi.fn();
    const onFieldsChange = vi.fn();
    const ref = await renderBuilder({ onFieldUpdate, onFieldsChange });
    let result = true;

    await act(async () => {
      result = ref.current!.updateField('missing-field-id', { alias: 'New Name' });
    });

    expect(result).toBe(false);
    expect(updateStructuredContentByIdMock).toHaveBeenCalledWith('missing-field-id', {
      attrs: { alias: 'New Name' },
    });
    expect(onFieldUpdate).not.toHaveBeenCalled();
    expect(onFieldsChange).not.toHaveBeenCalled();
  });
});
