import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { warnOnce, createDeprecatedEditorProxy, unwrapEditor } from './deprecation.js';

const RAW_EDITOR = Symbol.for('superdoc:rawEditor');

function createMockEditor() {
  return {
    state: { doc: {} },
    view: { dom: {} },
    schema: { nodes: {} },
    commands: { bold: vi.fn() },
    chain: vi.fn().mockReturnThis(),
    can: vi.fn().mockReturnThis(),
    dispatch: vi.fn(),

    doc: { content: 'hello' },
    on: vi.fn(),

    someMethod() {
      return this;
    },
  };
}

describe('warnOnce', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('should emit console.warn on first call', () => {
    const key = `test:${Math.random()}`;
    warnOnce(key, 'first call');
    expect(console.warn).toHaveBeenCalledWith('first call');
  });

  it('should suppress subsequent calls with the same key', () => {
    const key = `test:${Math.random()}`;
    warnOnce(key, 'msg');
    warnOnce(key, 'msg');
    warnOnce(key, 'msg');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('should warn separately for different keys', () => {
    const keyA = `test:a:${Math.random()}`;
    const keyB = `test:b:${Math.random()}`;
    warnOnce(keyA, 'message A');
    warnOnce(keyB, 'message B');
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe('createDeprecatedEditorProxy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('guard clauses', () => {
    it('should return null when passed null', () => {
      expect(createDeprecatedEditorProxy(null)).toBe(null);
    });

    it('should return undefined when passed undefined', () => {
      expect(createDeprecatedEditorProxy(undefined)).toBe(undefined);
    });

    it('should not double-wrap an already proxied editor', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);
      const doubleProxy = createDeprecatedEditorProxy(proxy);
      expect(doubleProxy).toBe(proxy);
    });
  });

  describe('deprecated property warnings', () => {
    const DEPRECATED_KEYS = ['state', 'view', 'schema', 'commands', 'chain', 'can', 'dispatch'];

    it('should warn once for each deprecated property access', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);

      for (const key of DEPRECATED_KEYS) {
        proxy[key];
      }

      expect(console.warn).toHaveBeenCalledTimes(DEPRECATED_KEYS.length);

      for (const key of DEPRECATED_KEYS) {
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('is deprecated and will be removed'));
      }
    });

    it('should not warn again on repeated access of the same property', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);

      proxy.state;
      const callCount = console.warn.mock.calls.length;
      proxy.state;
      expect(console.warn).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('non-deprecated property access', () => {
    it('should NOT trigger a warning for non-deprecated properties', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);

      proxy.doc;
      proxy.on;

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should return the correct value', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);
      expect(proxy.doc).toEqual(editor.doc);
    });
  });

  describe('function binding', () => {
    it('should bind methods to the target, not the proxy', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);
      const result = proxy.someMethod();
      expect(result).toBe(editor);
    });

    it('should return the same bound reference on repeated access', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);
      expect(proxy.someMethod).toBe(proxy.someMethod);
    });

    it('should bind deprecated methods to the target', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);
      proxy.chain();
      expect(editor.chain).toHaveBeenCalled();
    });
  });

  describe('RAW_EDITOR escape hatch', () => {
    it('should return the raw editor via RAW_EDITOR symbol', () => {
      const editor = createMockEditor();
      const proxy = createDeprecatedEditorProxy(editor);
      expect(proxy[RAW_EDITOR]).toBe(editor);
    });
  });
});

describe('unwrapEditor', () => {
  it('should return the raw editor from a proxy', () => {
    const editor = createMockEditor();
    const proxy = createDeprecatedEditorProxy(editor);
    expect(unwrapEditor(proxy)).toBe(editor);
  });

  it('should return a raw editor unchanged', () => {
    const editor = createMockEditor();
    expect(unwrapEditor(editor)).toBe(editor);
  });

  it('should return null when passed null', () => {
    expect(unwrapEditor(null)).toBe(null);
  });

  it('should return undefined when passed undefined', () => {
    expect(unwrapEditor(undefined)).toBe(undefined);
  });
});
