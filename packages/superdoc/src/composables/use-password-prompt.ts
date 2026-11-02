import { shallowRef } from 'vue';
import { markRawComponent } from '../helpers/mark-raw-component.js';
import type { SurfaceManager } from '../core/surface-manager.js';
import type {
  Editor,
  PasswordPromptAttemptResult,
  PasswordPromptConfig,
  PasswordPromptContext,
  PasswordPromptHandle,
  ResolvedPasswordPromptTexts,
  SurfaceHandle,
} from '../core/types/index.js';

const RECOVERABLE_CODES = ['DOCX_PASSWORD_REQUIRED', 'DOCX_PASSWORD_INVALID'];

const SIGNAL_TIMEOUT_MS = 30_000;

const DEFAULT_TEXTS: ResolvedPasswordPromptTexts = {
  title: 'Password Required',
  invalidTitle: 'Incorrect Password',
  description: 'This document is password protected. Enter the password to open it.',
  placeholder: 'Enter password',
  inputAriaLabel: 'Document password',
  submitLabel: 'Open',
  cancelLabel: 'Cancel',
  busyLabel: 'Decrypting…',
  invalidMessage: 'Incorrect password. Please try again.',
  timeoutMessage: 'Timed out while decrypting. Please try again.',
  genericErrorMessage: 'Unable to decrypt this document.',
};

export interface PasswordPromptDocument {
  id: string;
  password?: string;
  editorMountNonce: number;
}

export interface PasswordPromptException {
  error?: Error;
  editor?: Editor | null;
}

type PasswordPromptRender = NonNullable<PasswordPromptConfig['render']>;

type PasswordPromptResolver = NonNullable<PasswordPromptConfig['resolver']>;

export interface UsePasswordPromptOptions {
  getSurfaceManager: () => Pick<SurfaceManager, 'open'> | null;
  getPasswordPromptConfig: () => boolean | PasswordPromptConfig | undefined;
  /**
   * Called when a queued prompt cannot be shown (resolver returned `none`, config error, or resolver threw).
   * Receives the original exception payload so the host can re-emit it unchanged.
   */
  onUnhandled?: (doc: PasswordPromptDocument, errorCode: string, originalException?: PasswordPromptException) => void;
}

interface QueueEntry {
  doc: PasswordPromptDocument;
  errorCode: string;
  originalException?: PasswordPromptException;
}

interface PendingSignal {
  resolve: (result: PasswordPromptAttemptResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ResolvedPromptConfig {
  enabled: boolean;
  texts: ResolvedPasswordPromptTexts;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: PasswordPromptRender;
  resolver?: PasswordPromptResolver;
}

interface PromptRendering {
  suppressed?: boolean;
  component?: unknown;
  props?: Record<string, unknown>;
  render?: PasswordPromptRender;
  builtin?: boolean;
}

/**
 * Composable that coordinates password-prompt dialogs for encrypted DOCX files.
 *
 * Owns a FIFO queue of pending prompts (one active dialog at a time), and a
 * `pendingSignals` map that bridges the async gap between triggering a remount
 * and observing the result via `onEditorReady` / `onEditorException`.
 */
export function usePasswordPrompt({
  getSurfaceManager,
  getPasswordPromptConfig,
  onUnhandled,
}: UsePasswordPromptOptions) {
  /**
   * Pending password-prompt requests waiting for a free `activePrompt` slot.
   * `originalException` is preserved so `onUnhandled` can re-emit the host's
   * original exception payload verbatim if the prompt cannot render.
   */
  const queue: QueueEntry[] = [];

  const activePrompt = shallowRef<{ doc: PasswordPromptDocument; surfaceHandle: SurfaceHandle | null } | null>(null);

  /**
   * One-shot rendezvous: the coordinator registers a resolve callback before
   * triggering a remount; `handleEditorReady` / `handleEncryptionError` resolves it.
   */
  const pendingSignals = new Map<string, PendingSignal>();

  let destroyed = false;

  /**
   * Called from `onEditorException` in SuperDoc.vue.
   * @param doc  The reactive document object from the store.
   * @param errorCode  e.g. `'DOCX_PASSWORD_REQUIRED'`
   * @param originalException The original exception payload, preserved for re-emission if the prompt cannot render.
   * @returns Whether the error was taken over by the password prompt flow.
   */
  function handleEncryptionError(
    doc: PasswordPromptDocument | null | undefined,
    errorCode: string,
    originalException?: PasswordPromptException,
  ): boolean {
    if (!doc || !RECOVERABLE_CODES.includes(errorCode)) return false;
    if (getPasswordPromptConfig() === false) return false;
    if (!getSurfaceManager()) return false;

    // If a signal is pending for this doc, we're in a retry loop — resolve it
    // so the dialog can update in-place rather than queueing a new entry.
    const pending = pendingSignals.get(doc.id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ success: false, errorCode });
      pendingSignals.delete(doc.id);
      return true;
    }

    const existing = queue.find((e) => e.doc.id === doc.id);
    if (existing) {
      existing.errorCode = errorCode;
      existing.originalException = originalException;
      return true;
    }
    if (activePrompt.value?.doc.id === doc.id) return true;

    queue.push({ doc, errorCode, originalException });
    drainQueue();
    return true;
  }

  /** Called from `onEditorReady` in SuperDoc.vue. */
  function handleEditorReady(doc: PasswordPromptDocument | null | undefined): void {
    if (!doc) return;
    const pending = pendingSignals.get(doc.id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ success: true });
      pendingSignals.delete(doc.id);
    }
  }

  /** Tear down the coordinator, resolving any pending signals and clearing the queue. */
  function destroy(): void {
    destroyed = true;
    for (const [, signal] of pendingSignals) {
      clearTimeout(signal.timer);
      signal.resolve({ success: false, errorCode: 'destroyed' });
    }
    pendingSignals.clear();
    queue.length = 0;
    activePrompt.value = null;
  }

  function drainQueue(): void {
    if (destroyed) return;
    if (activePrompt.value) return;
    if (queue.length === 0) return;

    const entry = queue.shift();
    if (!entry) return;
    showPrompt(entry).catch((err) => {
      // Surface errors (e.g. from a consumer's resolver or invalid config)
      // as console errors rather than letting them become unhandled rejections.
      activePrompt.value = null;
      console.error('[SuperDoc] Password prompt error:', err);
      // The error was initially claimed by handleEncryptionError (returned true),
      // suppressing the public exception event. Now that we can't show a prompt,
      // hand control back to the app so it can handle the encryption error.
      onUnhandled?.(entry.doc, entry.errorCode, entry.originalException);
      drainQueue();
    });
  }

  async function showPrompt({ doc, errorCode, originalException }: QueueEntry): Promise<void> {
    const manager = getSurfaceManager();
    if (!manager || destroyed) return;

    const config = resolveConfig();

    /**
     * Async bridge passed to the dialog component. Sets the password on the doc,
     * increments the mount nonce to trigger a remount, and waits for the outcome.
     */
    const attemptPassword = (password: string): Promise<PasswordPromptAttemptResult> => {
      doc.password = password;
      // editorMountNonce is a ref inside a reactive store — Vue auto-unwraps it,
      // so on the reactive proxy it's already a number, not a Ref.
      doc.editorMountNonce++;

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingSignals.delete(doc.id);
          resolve({ success: false, errorCode: 'timeout' });
        }, SIGNAL_TIMEOUT_MS);

        pendingSignals.set(doc.id, { resolve, timer });
      });
    };

    const passwordPrompt: PasswordPromptHandle = {
      documentId: doc.id,
      errorCode,
      texts: config.texts,
      attemptPassword,
    };

    const resolverCtx: PasswordPromptContext = {
      documentId: doc.id,
      errorCode,
      texts: config.texts,
    };

    const resolution = resolveRendering(config, resolverCtx);

    // Suppressed — skip this document's prompt entirely.
    // Hand control back to the app so it can handle the encryption error
    // (e.g. via the exception event or its own out-of-band flow).
    if (resolution.suppressed) {
      onUnhandled?.(doc, errorCode, originalException);
      drainQueue();
      return;
    }

    // Set early to prevent duplicate queuing during async resolution
    // (e.g. the built-in path lazy-imports the component).
    activePrompt.value = { doc, surfaceHandle: null };

    let handle: SurfaceHandle;

    if (resolution.component) {
      handle = manager.open({
        mode: 'dialog',
        closeOnBackdrop: false,
        ariaLabel: config.texts.title,
        component: markRawComponent(resolution.component),
        props: { ...resolution.props, passwordPrompt },
      });
    } else if (resolution.render) {
      const userRender = resolution.render;
      handle = manager.open({
        mode: 'dialog',
        closeOnBackdrop: false,
        ariaLabel: config.texts.title,
        render: (ctx) =>
          userRender({
            container: ctx.container,
            passwordPrompt,
            resolve: ctx.resolve,
            close: ctx.close,
            surfaceId: ctx.surfaceId,
            mode: ctx.mode,
          }),
      });
    } else {
      // Built-in component — use ariaLabelledBy pointing to the component's
      // reactive heading, so the accessible name updates after a bad password
      // (e.g. "Password Required" → "Incorrect Password").
      const mod = await import('../components/surfaces/PasswordPromptSurface.vue');
      const surfaceId = `password-prompt-${doc.id}`;
      handle = manager.open({
        id: surfaceId,
        mode: 'dialog',
        closeOnBackdrop: false,
        ariaLabelledBy: `sd-password-prompt-heading-${surfaceId}`,
        component: markRawComponent(mod.default),
        props: { passwordPrompt },
      });
    }

    activePrompt.value = { doc, surfaceHandle: handle };

    // Block until the dialog settles (submitted / closed / replaced / destroyed)
    await handle.result;

    activePrompt.value = null;
    drainQueue();
  }

  /**
   * Normalise `getPasswordPromptConfig()` into a full config with defaults.
   * Throws on invalid combinations (component + render).
   */
  function resolveConfig(): ResolvedPromptConfig {
    const raw = getPasswordPromptConfig();

    if (raw === false) {
      return { enabled: false, texts: DEFAULT_TEXTS };
    }

    const cfg: PasswordPromptConfig = typeof raw === 'object' && raw !== null ? raw : {};

    if (cfg.component != null && typeof cfg.render === 'function') {
      throw new Error(
        'modules.surfaces.passwordPrompt cannot provide both "component" and "render". Use one or the other.',
      );
    }

    const texts: ResolvedPasswordPromptTexts = {
      title: cfg.title ?? DEFAULT_TEXTS.title,
      invalidTitle: cfg.invalidTitle ?? DEFAULT_TEXTS.invalidTitle,
      description: cfg.description ?? DEFAULT_TEXTS.description,
      placeholder: cfg.placeholder ?? DEFAULT_TEXTS.placeholder,
      inputAriaLabel: cfg.inputAriaLabel ?? DEFAULT_TEXTS.inputAriaLabel,
      submitLabel: cfg.submitLabel ?? DEFAULT_TEXTS.submitLabel,
      cancelLabel: cfg.cancelLabel ?? DEFAULT_TEXTS.cancelLabel,
      busyLabel: cfg.busyLabel ?? DEFAULT_TEXTS.busyLabel,
      invalidMessage: cfg.invalidMessage ?? DEFAULT_TEXTS.invalidMessage,
      timeoutMessage: cfg.timeoutMessage ?? DEFAULT_TEXTS.timeoutMessage,
      genericErrorMessage: cfg.genericErrorMessage ?? DEFAULT_TEXTS.genericErrorMessage,
    };

    return {
      enabled: true,
      texts,
      component: cfg.component,
      props: cfg.props,
      render: cfg.render,
      resolver: cfg.resolver,
    };
  }

  /**
   * Walk the 3-tier resolution chain:
   * 1. Dedicated passwordPrompt.resolver
   * 2. Direct passwordPrompt.component / passwordPrompt.render
   * 3. Built-in PasswordPromptSurface
   */
  function resolveRendering(config: ResolvedPromptConfig, resolverCtx: PasswordPromptContext): PromptRendering {
    if (typeof config.resolver === 'function') {
      const resolution = config.resolver(resolverCtx);

      if (resolution != null && resolution.type !== 'default') {
        if (resolution.type === 'none') return { suppressed: true };
        if (resolution.type === 'custom') return { component: resolution.component, props: resolution.props };
        if (resolution.type === 'external') return { render: resolution.render };
      }
      // null / undefined / { type: 'default' } → fall through
    }

    if (config.component != null) return { component: config.component, props: config.props };
    if (typeof config.render === 'function') return { render: config.render };

    return { builtin: true };
  }

  return {
    handleEncryptionError,
    handleEditorReady,
    destroy,
  };
}
