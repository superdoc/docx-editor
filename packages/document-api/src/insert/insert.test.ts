import { describe, it, expect, vi } from 'vite-plus/test';
import { executeInsert, type InsertInput } from './insert.js';
import type { SelectionMutationAdapter } from '../selection-mutation.js';
import type { WriteAdapter } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';

// ---------------------------------------------------------------------------
// Stub adapters — validation runs before any adapter method is called, so
// these stubs only need to exist (they should never be invoked in error cases).
// ---------------------------------------------------------------------------

function createStubSelectionAdapter(): SelectionMutationAdapter {
  return { execute: vi.fn() } as unknown as SelectionMutationAdapter;
}

function createStubWriteAdapter(): WriteAdapter {
  return { write: vi.fn(), insertStructured: vi.fn(), replaceStructured: vi.fn() } as unknown as WriteAdapter;
}

function exec(input: unknown): void {
  executeInsert(createStubSelectionAdapter(), createStubWriteAdapter(), input as InsertInput);
}

// ---------------------------------------------------------------------------
// Input shape discrimination
// ---------------------------------------------------------------------------

describe('executeInsert: input shape', () => {
  it('rejects non-object input', () => {
    expect(() => exec(null)).toThrow('non-null object');
    expect(() => exec('hello')).toThrow('non-null object');
    expect(() => exec(42)).toThrow('non-null object');
  });

  it('rejects input with neither value nor content', () => {
    expect(() => exec({})).toThrow('either "value"');
  });

  it('rejects input with both value and content', () => {
    expect(() => exec({ value: 'hello', content: { blocks: [] } })).toThrow('not both');
  });
});

// ---------------------------------------------------------------------------
// Text insert: ref validation
// ---------------------------------------------------------------------------

describe('executeInsert: ref validation', () => {
  it('rejects empty string ref', () => {
    expect(() => exec({ value: 'hello', ref: '' })).toThrow('ref must be a non-empty string');
  });

  it('rejects non-string ref', () => {
    expect(() => exec({ value: 'hello', ref: 42 })).toThrow('ref must be a non-empty string');
  });

  it('does not reject undefined ref (untargeted insert is valid)', () => {
    const writeAdapter = createStubWriteAdapter();
    (writeAdapter.write as ReturnType<typeof vi.fn>).mockReturnValue({ success: true, ref: 'r1' });
    expect(() => executeInsert(createStubSelectionAdapter(), writeAdapter, { value: 'hello' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Text insert: target/ref mutual exclusivity
// ---------------------------------------------------------------------------

describe('executeInsert: target/ref mutual exclusivity', () => {
  it('rejects input with both target and ref', () => {
    const target = {
      kind: 'selection',
      start: { kind: 'text', blockId: 'b1', offset: 0 },
      end: { kind: 'text', blockId: 'b1', offset: 0 },
    };
    expect(() => exec({ value: 'hello', target, ref: 'r1' })).toThrow('either "target" or "ref", not both');
  });
});

// ---------------------------------------------------------------------------
// Text insert: content type validation
// ---------------------------------------------------------------------------

describe('executeInsert: content type validation', () => {
  it('rejects invalid content type', () => {
    expect(() => exec({ value: 'hello', type: 'pdf' })).toThrow('text, markdown, html');
  });

  it('rejects non-string content type', () => {
    expect(() => exec({ value: 'hello', type: 123 })).toThrow('text, markdown, html');
  });

  it('routes rich content with a block target and placement through the structured adapter', () => {
    const selectionAdapter = createStubSelectionAdapter();
    const writeAdapter = createStubWriteAdapter();
    const input = {
      value: '<p>Hello</p>',
      type: 'html' as const,
      target: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
      placement: 'after' as const,
    };

    executeInsert(selectionAdapter, writeAdapter, input, { changeMode: 'tracked' });

    expect(writeAdapter.insertStructured).toHaveBeenCalledWith(input, {
      changeMode: 'tracked',
      dryRun: false,
    });
    expect(selectionAdapter.execute).not.toHaveBeenCalled();
  });

  it('rejects placement on a plain-text insert', () => {
    expect(() => exec({ value: 'hello', type: 'text', placement: 'after' })).toThrow(
      'only valid with structural content input or markdown/html inserts',
    );
  });
});

// ---------------------------------------------------------------------------
// Text insert: value validation
// ---------------------------------------------------------------------------

describe('executeInsert: value validation', () => {
  it('rejects non-string value', () => {
    expect(() => exec({ value: 42 })).toThrow('value must be a string');
  });
});

// ---------------------------------------------------------------------------
// Text insert: unknown fields
// ---------------------------------------------------------------------------

describe('executeInsert: unknown fields', () => {
  it('rejects unknown fields on text input', () => {
    expect(() => exec({ value: 'hello', bogus: true })).toThrow('bogus');
  });

  it.each([
    ['changeMode', 'tracked', 'doc.insert({ value: "text" }, { changeMode: "tracked" })'],
    ['dryRun', true, 'doc.insert({ value: "text" }, { dryRun: true })'],
  ])('guides misplaced %s to the options argument before mutation', (field, value, example) => {
    const selectionAdapter = createStubSelectionAdapter();
    const writeAdapter = createStubWriteAdapter();

    try {
      executeInsert(selectionAdapter, writeAdapter, { value: 'hello', [field]: value } as unknown as InsertInput);
      expect.fail('Expected INVALID_INPUT');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentApiValidationError);
      const validationError = error as DocumentApiValidationError;
      expect(validationError.code).toBe('INVALID_INPUT');
      expect(validationError.message).toContain(`Unknown field "${field}"`);
      expect(validationError.message).toContain('Allowed fields:');
      expect(validationError.message).toContain(example);
    }
    expect(selectionAdapter.execute).not.toHaveBeenCalled();
    expect(writeAdapter.write).not.toHaveBeenCalled();
  });

  it('keeps an unrelated unknown field free of options guidance', () => {
    try {
      exec({ value: 'hello', extra: true });
      expect.fail('Expected INVALID_INPUT');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentApiValidationError);
      const message = (error as DocumentApiValidationError).message;
      expect(message).toContain('Unknown field "extra"');
      expect(message).toContain('Allowed fields:');
      expect(message).not.toContain('doc.insert(');
    }
  });
});

// ---------------------------------------------------------------------------
// Structural insert: validation
// ---------------------------------------------------------------------------

describe('executeInsert: structural input validation', () => {
  it('rejects structural input with text-only "type" field', () => {
    expect(() => exec({ content: { blocks: [] }, type: 'markdown' })).toThrow('"type" field is only valid');
  });

  it('rejects invalid placement value', () => {
    expect(() => exec({ content: { blocks: [] }, placement: 'middle' })).toThrow('before, after');
  });

  it('rejects text-only fields on structural input', () => {
    expect(() => exec({ content: { blocks: [] }, ref: 'r1' })).toThrow();
  });
});
