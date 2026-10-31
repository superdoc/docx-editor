import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { reactive, ref } from 'vue';
import { usePasswordPrompt } from './use-password-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a doc object wrapped in reactive() to mimic the Pinia store behaviour.
 * Vue auto-unwraps the nested ref, so `doc.editorMountNonce` is a number on the proxy.
 */
const makeDoc = (id = 'doc-1') =>
  reactive({
    id,
    password: undefined,
    editorMountNonce: ref(0),
  });

/**
 * Minimal SurfaceManager stub whose `open()` returns a controllable handle.
 */
function createManagerStub() {
  let settleHandle;
  const handle = {
    id: 'surface-1',
    mode: 'dialog',
    close: vi.fn(),
    result: new Promise((resolve) => {
      settleHandle = resolve;
    }),
  };

  return {
    open: vi.fn(() => handle),
    handle,
    /** Settle the current handle manually */
    settle: (outcome) => settleHandle(outcome),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePasswordPrompt', () => {
  let manager;
  let passwordPromptConfig;

  /** @type {ReturnType<typeof usePasswordPrompt>} */
  let prompt;

  beforeEach(() => {
    manager = createManagerStub();
    passwordPromptConfig = undefined;
    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });
  });

  // ---- feature gate --------------------------------------------------------

  it('does nothing when passwordPrompt config is explicitly false', () => {
    passwordPromptConfig = false;
    const doc = makeDoc();
    expect(prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED')).toBe(false);
    expect(manager.open).not.toHaveBeenCalled();
  });

  // ---- error code filtering ------------------------------------------------

  it('ignores DOCX_ENCRYPTION_UNSUPPORTED', () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_ENCRYPTION_UNSUPPORTED');
    expect(manager.open).not.toHaveBeenCalled();
  });

  it('ignores DOCX_DECRYPTION_FAILED', () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_DECRYPTION_FAILED');
    expect(manager.open).not.toHaveBeenCalled();
  });

  // ---- basic open ----------------------------------------------------------

  it('opens a surface dialog on DOCX_PASSWORD_REQUIRED', async () => {
    const doc = makeDoc();
    expect(prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED')).toBe(true);

    // Dynamic import is async, so wait a tick
    await vi.dynamicImportSettled();

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(request.mode).toBe('dialog');
    expect(request.closeOnBackdrop).toBe(false);
    expect(request.component).toBeDefined();
    expect(request.props.passwordPrompt).toBeDefined();
  });

  it('opens a surface dialog on DOCX_PASSWORD_INVALID', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_INVALID');
    await vi.dynamicImportSettled();

    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  // ---- queue deduplication -------------------------------------------------

  it('does not queue duplicate entries for the same doc', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    // Only one open call — the second was a no-op (doc already active)
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  // ---- signal: success via handleEditorReady ------------------------------

  it('resolves pending signal on handleEditorReady', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    // Grab the attemptPassword function passed via passwordPrompt handle
    const attemptPassword = manager.open.mock.calls[0][0].props.passwordPrompt.attemptPassword;
    const resultPromise = attemptPassword('secret');

    expect(doc.password).toBe('secret');
    expect(doc.editorMountNonce).toBe(1);

    // Simulate editor ready
    prompt.handleEditorReady(doc);

    const result = await resultPromise;
    expect(result).toEqual({ success: true });
  });

  // ---- signal: failure via handleEncryptionError --------------------------

  it('resolves pending signal with failure on re-entrant encryption error', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const attemptPassword = manager.open.mock.calls[0][0].props.passwordPrompt.attemptPassword;
    const resultPromise = attemptPassword('wrong');

    // Simulate editor re-throwing with INVALID
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_INVALID');

    const result = await resultPromise;
    expect(result).toEqual({ success: false, errorCode: 'DOCX_PASSWORD_INVALID' });

    // Should NOT open a second dialog — the active prompt handles it in-place
    expect(manager.open).toHaveBeenCalledTimes(1);
  });

  // ---- FIFO queue ----------------------------------------------------------

  it('processes queued docs in order after first dialog closes', async () => {
    const doc1 = makeDoc('doc-1');
    const doc2 = makeDoc('doc-2');

    prompt.handleEncryptionError(doc1, 'DOCX_PASSWORD_REQUIRED');
    prompt.handleEncryptionError(doc2, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    // Only the first dialog is open
    expect(manager.open).toHaveBeenCalledTimes(1);

    // Create a new handle for the second dialog
    let settleSecond;
    const secondHandle = {
      id: 'surface-2',
      mode: 'dialog',
      close: vi.fn(),
      result: new Promise((resolve) => {
        settleSecond = resolve;
      }),
    };
    manager.open.mockReturnValueOnce(secondHandle);

    // Settle the first dialog (user cancelled)
    manager.settle({ status: 'closed', reason: 'user-cancelled' });

    // Let the async showPrompt finish and drainQueue start
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    // Second dialog should now be open
    expect(manager.open).toHaveBeenCalledTimes(2);
  });

  // ---- attemptPassword mutates doc ----------------------------------------

  it('attemptPassword sets doc.password and increments nonce', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const attemptPassword = manager.open.mock.calls[0][0].props.passwordPrompt.attemptPassword;
    const promise = attemptPassword('my-pass');

    expect(doc.password).toBe('my-pass');
    expect(doc.editorMountNonce).toBe(1);

    // Resolve the signal so the promise completes
    prompt.handleEditorReady(doc);
    await promise;
  });

  // ---- cancel flow ---------------------------------------------------------

  it('drains queue on cancel (closed outcome)', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    expect(manager.open).toHaveBeenCalledTimes(1);

    // Settle as closed
    manager.settle({ status: 'closed', reason: 'user-cancelled' });

    // Should not throw, and activePrompt should clear
    await new Promise((r) => setTimeout(r, 0));
  });

  // ---- destroy cleanup -----------------------------------------------------

  it('resolves all pending signals and clears queue on destroy', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const attemptPassword = manager.open.mock.calls[0][0].props.passwordPrompt.attemptPassword;
    const resultPromise = attemptPassword('test');

    prompt.destroy();

    const result = await resultPromise;
    expect(result).toEqual({ success: false, errorCode: 'destroyed' });
  });

  // ---- continues draining after error -------------------------------------

  it('continues draining queue after an error in showPrompt', async () => {
    const doc1 = makeDoc('doc-1');
    const doc2 = makeDoc('doc-2');

    // First call throws (consumer resolver bug), second call succeeds
    const resolverError = new TypeError('boom');
    let callCount = 0;
    manager.open.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw resolverError;
      return manager.handle;
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    prompt.handleEncryptionError(doc1, 'DOCX_PASSWORD_REQUIRED');
    prompt.handleEncryptionError(doc2, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    // First doc errored, second doc should still get its dialog
    expect(callCount).toBe(2);

    consoleSpy.mockRestore();
  });

  // ---- config validation ---------------------------------------------------

  it('throws when both component and render are provided', async () => {
    passwordPromptConfig = {
      component: { template: '<div />' },
      render: () => {},
    };

    const doc = makeDoc();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      '[SuperDoc] Password prompt error:',
      expect.objectContaining({
        message: expect.stringContaining('cannot provide both "component" and "render"'),
      }),
    );

    consoleSpy.mockRestore();
  });

  // ---- config resolution ---------------------------------------------------

  it('uses custom titles from config object', async () => {
    passwordPromptConfig = {
      title: 'Unlock',
      invalidTitle: 'Wrong password',
      submitLabel: 'Go',
      cancelLabel: 'Nope',
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const request = manager.open.mock.calls[0][0];
    const pwHandle = request.props.passwordPrompt;
    expect(pwHandle.texts.title).toBe('Unlock');
    expect(pwHandle.texts.invalidTitle).toBe('Wrong password');
    expect(pwHandle.texts.submitLabel).toBe('Go');
    expect(pwHandle.texts.cancelLabel).toBe('Nope');
  });

  it('resolves all 11 text fields with defaults', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const texts = manager.open.mock.calls[0][0].props.passwordPrompt.texts;
    expect(texts.title).toBe('Password Required');
    expect(texts.invalidTitle).toBe('Incorrect Password');
    expect(texts.description).toBe('This document is password protected. Enter the password to open it.');
    expect(texts.placeholder).toBe('Enter password');
    expect(texts.inputAriaLabel).toBe('Document password');
    expect(texts.submitLabel).toBe('Open');
    expect(texts.cancelLabel).toBe('Cancel');
    expect(texts.busyLabel).toBe('Decrypting\u2026');
    expect(texts.invalidMessage).toBe('Incorrect password. Please try again.');
    expect(texts.timeoutMessage).toBe('Timed out while decrypting. Please try again.');
    expect(texts.genericErrorMessage).toBe('Unable to decrypt this document.');
  });

  it('custom text fields override defaults', async () => {
    passwordPromptConfig = {
      description: 'Custom desc',
      busyLabel: 'Working...',
      genericErrorMessage: 'Oops',
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const texts = manager.open.mock.calls[0][0].props.passwordPrompt.texts;
    expect(texts.description).toBe('Custom desc');
    expect(texts.busyLabel).toBe('Working...');
    expect(texts.genericErrorMessage).toBe('Oops');
    // Others still default
    expect(texts.title).toBe('Password Required');
  });

  // ---- passwordPrompt handle shape ----------------------------------------

  it('passwordPrompt handle has correct shape', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const pwHandle = manager.open.mock.calls[0][0].props.passwordPrompt;
    expect(pwHandle.documentId).toBe('doc-1');
    expect(pwHandle.errorCode).toBe('DOCX_PASSWORD_REQUIRED');
    expect(typeof pwHandle.attemptPassword).toBe('function');
    expect(typeof pwHandle.texts).toBe('object');
    expect(pwHandle.texts.title).toBe('Password Required');
  });

  // ---- ariaLabel on dialog request ----------------------------------------

  it('built-in path uses ariaLabelledBy pointing to the component heading', async () => {
    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const request = manager.open.mock.calls[0][0];
    // Built-in uses ariaLabelledBy so the accessible name updates reactively
    expect(request.ariaLabelledBy).toBe(`sd-password-prompt-heading-${request.id}`);
    expect(request.ariaLabel).toBeUndefined();
    // No shell title — content owns its heading
    expect(request.title).toBeUndefined();
  });

  it('custom component path uses ariaLabel (static accessible name)', async () => {
    const CustomComponent = { template: '<div>custom</div>' };
    passwordPromptConfig = { component: CustomComponent };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    const request = manager.open.mock.calls[0][0];
    expect(request.ariaLabel).toBe('Password Required');
    expect(request.ariaLabelledBy).toBeUndefined();
  });

  // ---- resolver: { type: 'none' } suppresses ------------------------------

  it('resolver returning { type: "none" } suppresses the dialog', async () => {
    passwordPromptConfig = {
      resolver: () => ({ type: 'none' }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).not.toHaveBeenCalled();
  });

  // ---- resolver: null falls through to built-in ---------------------------

  it('resolver returning null falls through to built-in', async () => {
    passwordPromptConfig = {
      resolver: () => null,
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    expect(manager.open).toHaveBeenCalledTimes(1);
    // Built-in path uses a component (lazy-imported PasswordPromptSurface)
    expect(manager.open.mock.calls[0][0].component).toBeDefined();
  });

  // ---- resolver: { type: 'default' } falls through -----------------------

  it('resolver returning { type: "default" } falls through to built-in', async () => {
    passwordPromptConfig = {
      resolver: () => ({ type: 'default' }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    expect(manager.open).toHaveBeenCalledTimes(1);
    expect(manager.open.mock.calls[0][0].component).toBeDefined();
  });

  // ---- resolver: { type: 'custom' } mounts component --------------------

  it('resolver returning { type: "custom" } mounts that component', async () => {
    const CustomComponent = { template: '<div>custom</div>' };
    passwordPromptConfig = {
      resolver: () => ({ type: 'custom', component: CustomComponent, props: { extra: true } }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(request.props.extra).toBe(true);
    expect(request.props.passwordPrompt).toBeDefined();
    expect(request.props.passwordPrompt.documentId).toBe('doc-1');
  });

  // ---- resolver: { type: 'external' } uses render function ---------------

  it('resolver returning { type: "external" } uses that render function', async () => {
    const renderFn = vi.fn();
    passwordPromptConfig = {
      resolver: () => ({ type: 'external', render: renderFn }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(typeof request.render).toBe('function');
    expect(request.component).toBeUndefined();

    // Call the wrapper render and verify it enriches context
    const mockCtx = {
      container: document.createElement('div'),
      resolve: vi.fn(),
      close: vi.fn(),
      surfaceId: 'surface-1',
      mode: 'dialog',
    };
    request.render(mockCtx);
    expect(renderFn).toHaveBeenCalledWith(
      expect.objectContaining({
        container: mockCtx.container,
        passwordPrompt: expect.objectContaining({ documentId: 'doc-1' }),
        resolve: mockCtx.resolve,
        close: mockCtx.close,
        surfaceId: 'surface-1',
        mode: 'dialog',
      }),
    );
  });

  // ---- resolver + component coexist: resolver null → falls through -------

  it('resolver null + config.component: falls through to config component', async () => {
    const ConfigComponent = { template: '<div>config</div>' };
    passwordPromptConfig = {
      component: ConfigComponent,
      props: { fromConfig: true },
      resolver: () => null,
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(request.props.fromConfig).toBe(true);
    expect(request.props.passwordPrompt).toBeDefined();
  });

  // ---- resolver + component coexist: resolver { type: 'none' } suppresses -

  it('resolver { type: "none" } suppresses even when config.component is set', async () => {
    passwordPromptConfig = {
      component: { template: '<div />' },
      resolver: () => ({ type: 'none' }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).not.toHaveBeenCalled();
  });

  // ---- resolver { type: 'custom' } does NOT merge with config.props ------

  it('resolver custom props do not merge with config props', async () => {
    const ResolverComponent = { template: '<div>resolver</div>' };
    passwordPromptConfig = {
      component: { template: '<div>config</div>' },
      props: { fromConfig: true, shared: 'config' },
      resolver: () => ({
        type: 'custom',
        component: ResolverComponent,
        props: { fromResolver: true, shared: 'resolver' },
      }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    const request = manager.open.mock.calls[0][0];
    // Resolver props are used, not config props
    expect(request.props.fromResolver).toBe(true);
    expect(request.props.shared).toBe('resolver');
    expect(request.props.fromConfig).toBeUndefined();
    // passwordPrompt is auto-injected and wins
    expect(request.props.passwordPrompt).toBeDefined();
  });

  // ---- config.component mounts directly -----------------------------------

  it('config.component mounts directly when no resolver', async () => {
    const DirectComponent = { template: '<div>direct</div>' };
    passwordPromptConfig = {
      component: DirectComponent,
      props: { myProp: 42 },
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(request.component).toBeDefined();
    expect(request.props.myProp).toBe(42);
    expect(request.props.passwordPrompt).toBeDefined();
  });

  // ---- config.render uses render directly ---------------------------------

  it('config.render uses render directly when no resolver', async () => {
    const renderFn = vi.fn();
    passwordPromptConfig = {
      render: renderFn,
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).toHaveBeenCalledTimes(1);
    const request = manager.open.mock.calls[0][0];
    expect(typeof request.render).toBe('function');
    expect(request.component).toBeUndefined();
    // No props on render path
    expect(request.props).toBeUndefined();
  });

  // ---- auto-injected props win over user props ----------------------------

  it('auto-injected passwordPrompt wins over user props', async () => {
    const CustomComponent = { template: '<div />' };
    passwordPromptConfig = {
      resolver: () => ({
        type: 'custom',
        component: CustomComponent,
        props: { passwordPrompt: 'should-be-overridden' },
      }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    const request = manager.open.mock.calls[0][0];
    // passwordPrompt should be the real handle, not the string
    expect(typeof request.props.passwordPrompt).toBe('object');
    expect(request.props.passwordPrompt.documentId).toBe('doc-1');
  });

  // ---- onUnhandled: { type: 'none' } re-emits ----------------------------

  it('calls onUnhandled with original exception when resolver returns { type: "none" }', async () => {
    const onUnhandled = vi.fn();
    passwordPromptConfig = {
      resolver: () => ({ type: 'none' }),
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
      onUnhandled,
    });

    const doc = makeDoc();
    const originalError = new Error('password required');
    const originalEditor = { id: 'editor-1' };
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED', { error: originalError, editor: originalEditor });
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.open).not.toHaveBeenCalled();
    expect(onUnhandled).toHaveBeenCalledWith(doc, 'DOCX_PASSWORD_REQUIRED', {
      error: originalError,
      editor: originalEditor,
    });
  });

  // ---- onUnhandled: config error re-emits ---------------------------------

  it('calls onUnhandled with original exception when config is invalid (component + render)', async () => {
    const onUnhandled = vi.fn();
    passwordPromptConfig = {
      component: { template: '<div />' },
      render: () => {},
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
      onUnhandled,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = makeDoc();
    const originalError = new Error('password required');

    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED', { error: originalError, editor: null });
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(onUnhandled).toHaveBeenCalledWith(doc, 'DOCX_PASSWORD_REQUIRED', { error: originalError, editor: null });
    consoleSpy.mockRestore();
  });

  // ---- onUnhandled: resolver throw re-emits -------------------------------

  it('calls onUnhandled with original exception when resolver throws', async () => {
    const onUnhandled = vi.fn();
    passwordPromptConfig = {
      resolver: () => {
        throw new Error('resolver bug');
      },
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
      onUnhandled,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = makeDoc();
    const originalError = new Error('password required');

    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED', { error: originalError, editor: null });
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));

    expect(onUnhandled).toHaveBeenCalledWith(doc, 'DOCX_PASSWORD_REQUIRED', { error: originalError, editor: null });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ---- empty strings are preserved ----------------------------------------

  it('preserves empty strings in text fields instead of falling back to defaults', async () => {
    passwordPromptConfig = {
      description: '',
      placeholder: '',
      busyLabel: '',
    };

    prompt = usePasswordPrompt({
      getSurfaceManager: () => manager,
      getPasswordPromptConfig: () => passwordPromptConfig,
    });

    const doc = makeDoc();
    prompt.handleEncryptionError(doc, 'DOCX_PASSWORD_REQUIRED');
    await vi.dynamicImportSettled();

    const texts = manager.open.mock.calls[0][0].props.passwordPrompt.texts;
    expect(texts.description).toBe('');
    expect(texts.placeholder).toBe('');
    expect(texts.busyLabel).toBe('');
    // Non-overridden fields still default
    expect(texts.title).toBe('Password Required');
  });
});
