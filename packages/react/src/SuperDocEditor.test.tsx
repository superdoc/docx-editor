import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { SuperDocEditor } from './SuperDocEditor';
import type { SuperDocRef } from './types';

const SUPERDOC_READY_WAIT_TIMEOUT = 10000;
const SUPERDOC_READY_TEST_TIMEOUT = 15000;

describe('SuperDocEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('mounting and unmounting', () => {
    it('should render container elements', () => {
      const { container } = render(<SuperDocEditor />);

      expect(container.querySelector('.superdoc-wrapper')).toBeTruthy();
      expect(container.querySelector('.superdoc-editor-container')).toBeTruthy();
      expect(container.querySelector('.superdoc-toolbar-container')).toBeTruthy();
    });

    it('should hide toolbar when hideToolbar={true}', () => {
      const { container } = render(<SuperDocEditor hideToolbar />);

      expect(container.querySelector('.superdoc-toolbar-container')).toBeFalsy();
    });

    it('should apply className and style props', () => {
      const { container } = render(<SuperDocEditor className='custom-class' style={{ backgroundColor: 'red' }} />);

      const wrapper = container.querySelector('.superdoc-wrapper');
      expect(wrapper?.classList.contains('custom-class')).toBe(true);
      expect((wrapper as HTMLElement)?.style.backgroundColor).toBe('red');
    });

    it('should handle unmount without throwing', () => {
      const { unmount } = render(<SuperDocEditor />);

      expect(() => unmount()).not.toThrow();
    });
  });

  describe('ref methods', () => {
    it('should expose getInstance method only', () => {
      const ref = createRef<SuperDocRef>();
      render(<SuperDocEditor ref={ref} />);

      // Ref should be available immediately with getInstance
      expect(ref.current).not.toBeNull();
      expect(typeof ref.current?.getInstance).toBe('function');
    });

    it('should return null from getInstance before ready', () => {
      const ref = createRef<SuperDocRef>();
      render(<SuperDocEditor ref={ref} />);

      // Before async init completes, getInstance returns null
      const instance = ref.current?.getInstance();
      expect(instance).toBeNull();
    });

    it('should safely handle calls through getInstance before ready', () => {
      const ref = createRef<SuperDocRef>();
      render(<SuperDocEditor ref={ref} />);

      // Using optional chaining through getInstance is safe
      expect(() => ref.current?.getInstance()?.focus()).not.toThrow();
      expect(() => ref.current?.getInstance()?.setDocumentMode('viewing')).not.toThrow();
      expect(() => ref.current?.getInstance()?.toggleRuler()).not.toThrow();
    });
  });

  describe('loading state', () => {
    it('should show loading content initially', () => {
      const { container } = render(
        <SuperDocEditor renderLoading={() => <div data-testid='loading'>Loading...</div>} />,
      );

      expect(container.querySelector('[data-testid="loading"]')).toBeTruthy();
    });

    it('keeps the editor container measurable while loading', () => {
      const { container } = render(
        <SuperDocEditor renderLoading={() => <div data-testid='loading'>Loading...</div>} />,
      );

      const editorContainer = container.querySelector('.superdoc-editor-container') as HTMLElement;

      expect(editorContainer.style.display).not.toBe('none');
      expect(editorContainer.style.visibility).toBe('hidden');
      expect(editorContainer.style.pointerEvents).toBe('none');
    });

    it('overlays loading content while contained and loading', () => {
      const { container } = render(
        <SuperDocEditor contained renderLoading={() => <div data-testid='loading'>Loading...</div>} />,
      );

      const wrapper = container.querySelector('.superdoc-wrapper') as HTMLElement;
      const editorContainer = container.querySelector('.superdoc-editor-container') as HTMLElement;
      const loadingContainer = container.querySelector('.superdoc-loading-container') as HTMLElement;

      expect(wrapper.style.position).toBe('relative');
      expect(editorContainer.style.display).not.toBe('none');
      expect(editorContainer.style.visibility).toBe('hidden');
      expect(editorContainer.style.flex).toBe('1 1 0%');
      expect(loadingContainer.style.position).toBe('absolute');
      expect(loadingContainer.style.inset).toBe('0');
      expect(loadingContainer.style.zIndex).toBe('1');
    });
  });

  describe('callbacks', () => {
    it(
      'should call onReady when SuperDoc is ready',
      async () => {
        const onReady = vi.fn();
        render(<SuperDocEditor onReady={onReady} />);

        await waitFor(
          () => {
            expect(onReady).toHaveBeenCalled();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'should call onEditorCreate when editor is created',
      async () => {
        const onEditorCreate = vi.fn();
        render(<SuperDocEditor onEditorCreate={onEditorCreate} />);

        await waitFor(
          () => {
            expect(onEditorCreate).toHaveBeenCalled();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'should route onTransaction through the latest callback after rerender',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const firstOnTransaction = vi.fn();
        const secondOnTransaction = vi.fn();

        const { rerender } = render(<SuperDocEditor ref={ref} onReady={onReady} onTransaction={firstOnTransaction} />);

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });

        const instance = ref.current?.getInstance();
        expect(instance).toBeTruthy();

        const transactionEvent = {
          editor: {},
          sourceEditor: {},
          transaction: { docChanged: true },
          surface: 'body',
        };

        const firstCallCountBeforeManualDispatch = firstOnTransaction.mock.calls.length;
        (instance as any).config.onTransaction(transactionEvent);

        expect(firstOnTransaction).toHaveBeenLastCalledWith(transactionEvent);
        expect(firstOnTransaction).toHaveBeenCalledTimes(firstCallCountBeforeManualDispatch + 1);
        expect(secondOnTransaction).not.toHaveBeenCalled();

        rerender(<SuperDocEditor ref={ref} onReady={onReady} onTransaction={secondOnTransaction} />);

        expect(ref.current?.getInstance()).toBe(instance);

        const firstCallCountBeforeRerenderDispatch = firstOnTransaction.mock.calls.length;
        const secondCallCountBeforeManualDispatch = secondOnTransaction.mock.calls.length;
        (instance as any).config.onTransaction(transactionEvent);

        expect(firstOnTransaction).toHaveBeenCalledTimes(firstCallCountBeforeRerenderDispatch);
        expect(secondOnTransaction).toHaveBeenLastCalledWith(transactionEvent);
        expect(secondOnTransaction).toHaveBeenCalledTimes(secondCallCountBeforeManualDispatch + 1);
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'should call onZoomChange when zoom changes through the core wiring',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onZoomChange = vi.fn();

        render(<SuperDocEditor ref={ref} onReady={onReady} onZoomChange={onZoomChange} />);

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });

        const instance = ref.current?.getInstance();
        expect(instance).toBeTruthy();

        instance?.setZoom(150);

        expect(onZoomChange).toHaveBeenCalledWith({ zoom: 150, mode: 'manual' });
        expect(instance?.getZoom()).toBe(150);
        expect(instance?.getZoomState().mode).toBe('manual');
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'should route onZoomChange through the latest callback after rerender',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const firstOnZoomChange = vi.fn();
        const secondOnZoomChange = vi.fn();

        const { rerender } = render(<SuperDocEditor ref={ref} onReady={onReady} onZoomChange={firstOnZoomChange} />);

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });

        const instance = ref.current?.getInstance();
        expect(instance).toBeTruthy();

        rerender(<SuperDocEditor ref={ref} onReady={onReady} onZoomChange={secondOnZoomChange} />);

        // Same instance (callback identity changes must not rebuild) and the
        // fresh callback receives the event.
        expect(ref.current?.getInstance()).toBe(instance);
        instance?.setZoom(80);

        expect(firstOnZoomChange).not.toHaveBeenCalled();
        expect(secondOnZoomChange).toHaveBeenCalledWith({ zoom: 80, mode: 'manual' });
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'should apply zoom.initial through config passthrough',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();

        render(<SuperDocEditor ref={ref} onReady={onReady} zoom={{ initial: 50 }} />);

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });

        expect(ref.current?.getInstance()?.getZoom()).toBe(50);
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );
  });

  describe('onEditorDestroy', () => {
    it(
      'should call onEditorDestroy when component unmounts',
      async () => {
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();
        const { unmount } = render(<SuperDocEditor onReady={onReady} onEditorDestroy={onEditorDestroy} />);

        await waitFor(
          () => {
            expect(onReady).toHaveBeenCalled();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );

        unmount();

        await waitFor(
          () => {
            expect(onEditorDestroy).toHaveBeenCalled();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );
  });

  describe('error states', () => {
    it(
      'should show error container when initialization fails',
      async () => {
        // Force an error by providing an invalid document
        const onException = vi.fn();
        const { container } = render(
          <SuperDocEditor document={'not-a-valid-doc' as unknown as File} onException={onException} />,
        );

        await waitFor(
          () => {
            const errorContainer = container.querySelector('.superdoc-error-container');
            // If SuperDoc throws on invalid input, error UI shows
            // If SuperDoc handles it gracefully, onException may be called instead
            expect(errorContainer || onException.mock.calls.length > 0).toBeTruthy();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );
  });

  describe('Strict Mode compatibility', () => {
    it('should not throw in Strict Mode', () => {
      expect(() => {
        render(
          <StrictMode>
            <SuperDocEditor />
          </StrictMode>,
        );
      }).not.toThrow();
    });
  });

  describe('prop stability (SD-2635)', () => {
    it(
      'does not destroy/re-init when user prop is a new object literal with identical content',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();

        const { rerender } = render(
          <SuperDocEditor
            ref={ref}
            user={{ name: 'Alex', email: 'alex@example.com' }}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        const instanceBefore = ref.current?.getInstance();
        expect(instanceBefore).toBeTruthy();

        // Re-render with a *new* object literal carrying the same content —
        // this is the idiomatic React pattern that used to trigger a full
        // destroy + re-init loop before SD-2635.
        rerender(
          <SuperDocEditor
            ref={ref}
            user={{ name: 'Alex', email: 'alex@example.com' }}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        // Same underlying instance proves no destroy+rebuild happened.
        expect(ref.current?.getInstance()).toBe(instanceBefore);
        expect(onEditorDestroy).not.toHaveBeenCalled();
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'does not destroy/re-init when users prop is a new array literal with identical content',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();

        const { rerender } = render(
          <SuperDocEditor
            ref={ref}
            users={[{ name: 'Alex', email: 'alex@example.com' }]}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        const instanceBefore = ref.current?.getInstance();

        rerender(
          <SuperDocEditor
            ref={ref}
            users={[{ name: 'Alex', email: 'alex@example.com' }]}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        expect(ref.current?.getInstance()).toBe(instanceBefore);
        expect(onEditorDestroy).not.toHaveBeenCalled();
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'rebuilds and remounts a new instance when user prop value actually changes',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();

        const { rerender } = render(
          <SuperDocEditor
            ref={ref}
            user={{ name: 'Alex', email: 'alex@example.com' }}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        const instanceBefore = ref.current?.getInstance();

        rerender(
          <SuperDocEditor
            ref={ref}
            user={{ name: 'Jamie', email: 'jamie@example.com' }}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        // Old instance torn down, new instance ready.
        await waitFor(() => expect(onEditorDestroy).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        expect(ref.current?.getInstance()).not.toBe(instanceBefore);
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'stays stable under StrictMode double-invocation on rerender',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();

        const { rerender } = render(
          <StrictMode>
            <SuperDocEditor
              ref={ref}
              user={{ name: 'Alex', email: 'alex@example.com' }}
              onReady={onReady}
              onEditorDestroy={onEditorDestroy}
            />
          </StrictMode>,
        );

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        const instanceBefore = ref.current?.getInstance();
        const destroysBefore = onEditorDestroy.mock.calls.length;

        rerender(
          <StrictMode>
            <SuperDocEditor
              ref={ref}
              user={{ name: 'Alex', email: 'alex@example.com' }}
              onReady={onReady}
              onEditorDestroy={onEditorDestroy}
            />
          </StrictMode>,
        );

        expect(ref.current?.getInstance()).toBe(instanceBefore);
        expect(onEditorDestroy.mock.calls.length).toBe(destroysBefore);
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'still rebuilds under StrictMode when user prop value actually changes',
      async () => {
        // The same-content StrictMode test above proves memoization survives
        // double-invocation. This test proves the positive path — a real
        // value change under StrictMode still tears down and remounts.
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();

        const { rerender } = render(
          <StrictMode>
            <SuperDocEditor
              ref={ref}
              user={{ name: 'Alex', email: 'alex@example.com' }}
              onReady={onReady}
              onEditorDestroy={onEditorDestroy}
            />
          </StrictMode>,
        );

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        const instanceBefore = ref.current?.getInstance();

        rerender(
          <StrictMode>
            <SuperDocEditor
              ref={ref}
              user={{ name: 'Jamie', email: 'jamie@example.com' }}
              onReady={onReady}
              onEditorDestroy={onEditorDestroy}
            />
          </StrictMode>,
        );

        await waitFor(() => expect(onEditorDestroy).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        await waitFor(() => expect(ref.current?.getInstance()).not.toBe(instanceBefore), {
          timeout: SUPERDOC_READY_WAIT_TIMEOUT,
        });
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'rebuilds when a new modules object is passed, even if content looks equal',
      async () => {
        // `modules` is intentionally kept on reference identity in the dep
        // array because it can carry functions and live objects that a
        // structural compare would miss. This test pins that contract —
        // if a future refactor wraps `modules` in useStructuralMemo, this
        // test will fail and flag the regression.
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();
        const onEditorDestroy = vi.fn();

        const { rerender } = render(
          <SuperDocEditor
            ref={ref}
            modules={{ comments: { visible: true } }}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        const instanceBefore = ref.current?.getInstance();

        rerender(
          <SuperDocEditor
            ref={ref}
            modules={{ comments: { visible: true } }}
            onReady={onReady}
            onEditorDestroy={onEditorDestroy}
          />,
        );

        await waitFor(() => expect(onEditorDestroy).toHaveBeenCalled(), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2), { timeout: SUPERDOC_READY_WAIT_TIMEOUT });
        expect(ref.current?.getInstance()).not.toBe(instanceBefore);
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );
  });

  describe('unique IDs', () => {
    it('should generate unique container IDs for multiple instances', () => {
      const { container: container1 } = render(<SuperDocEditor />);
      const { container: container2 } = render(<SuperDocEditor />);

      const id1 = container1.querySelector('.superdoc-editor-container')?.id;
      const id2 = container2.querySelector('.superdoc-editor-container')?.id;

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });
  });

  describe('with real superdoc', () => {
    it(
      'should initialize superdoc instance',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();

        render(<SuperDocEditor ref={ref} onReady={onReady} />);

        await waitFor(
          () => {
            expect(onReady).toHaveBeenCalled();
            expect(ref.current?.getInstance()).not.toBeNull();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );

    it(
      'should provide access to superdoc methods after ready',
      async () => {
        const ref = createRef<SuperDocRef>();
        const onReady = vi.fn();

        render(<SuperDocEditor ref={ref} onReady={onReady} />);

        await waitFor(
          () => {
            expect(onReady).toHaveBeenCalled();
          },
          { timeout: SUPERDOC_READY_WAIT_TIMEOUT },
        );

        const instance = ref.current?.getInstance();
        expect(instance).toBeTruthy();
        expect(typeof instance?.destroy).toBe('function');
        expect(typeof instance?.setDocumentMode).toBe('function');
      },
      SUPERDOC_READY_TEST_TIMEOUT,
    );
  });
});
