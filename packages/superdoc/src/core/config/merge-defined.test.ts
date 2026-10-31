import { describe, expect, it } from 'vite-plus/test';
import { mergeDefined, mergeDefinedFields } from './merge-defined.js';

describe('mergeDefined', () => {
  it('lets later sources win and skips explicitly undefined values', () => {
    expect(mergeDefined({ a: 1, b: 2, c: 3 }, { a: undefined, b: 20 }, { c: undefined, d: 4 })).toEqual({
      a: 1,
      b: 20,
      c: 3,
      d: 4,
    });
  });

  it('keeps null, false, zero, and empty strings as deliberate values', () => {
    expect(mergeDefined({ a: 1, b: true, c: 5, d: 'x' }, { a: null, b: false, c: 0, d: '' })).toEqual({
      a: null,
      b: false,
      c: 0,
      d: '',
    });
  });

  it('ignores sources that are not objects', () => {
    expect(mergeDefined(undefined, { a: 1 }, null, 'text', 7, true, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('ignores keys a source only inherits', () => {
    const source = Object.assign(Object.create({ inherited: 'proto' }), { own: 'value' });

    expect(mergeDefined({ inherited: 'base' }, source)).toEqual({ inherited: 'base', own: 'value' });
  });

  it('merges an array source by its index keys', () => {
    expect(mergeDefined({ 0: 'base', extra: true }, ['first', undefined, 'third'])).toEqual({
      0: 'first',
      2: 'third',
      extra: true,
    });
  });

  it('returns a new object without changing its sources', () => {
    const base = { a: 1 };
    const override = { a: 2 };
    const merged = mergeDefined(base, override);

    expect(merged).toEqual({ a: 2 });
    expect(merged).not.toBe(base);
    expect(base).toEqual({ a: 1 });
  });
});

describe('mergeDefinedFields', () => {
  it('merges typed presets per key, skipping undefined and absent sources', () => {
    const legacy: { closeOnEscape?: boolean; maxWidth?: number } = { closeOnEscape: false, maxWidth: 400 };
    const next: { closeOnEscape?: boolean; maxWidth?: number } = { closeOnEscape: undefined, maxWidth: 600 };

    expect(mergeDefinedFields(legacy, undefined, next)).toEqual({ closeOnEscape: false, maxWidth: 600 });
  });

  it('ignores keys a source only inherits', () => {
    const next: { maxWidth?: number; closeOnBackdrop?: boolean } = Object.assign(Object.create({ maxWidth: 999 }), {
      closeOnBackdrop: false,
    });

    expect(mergeDefinedFields({ maxWidth: 400 }, next)).toEqual({ maxWidth: 400, closeOnBackdrop: false });
  });
});
