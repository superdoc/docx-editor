import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import type { SelectionCapture } from 'superdoc/ui';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocSelection, useSuperDocUI } from 'superdoc/ui/react';
import '@superdoc/react/style.css';

type PromptPosition = { left: number; top: number };
type SelectionPromptRequest = Readonly<{ context: string; question: string }>;
type SelectionPromptResponse = Readonly<{ answer: string }>;

const editorUi = { comments: false } satisfies UIConfig;

// Restoration must not outrank a deliberate focus move. Hiding the card unmounts the focused
// control, so the browser parks focus on <body>; anything else holding it means the reader
// moved on, and keeping their place matters more than returning to the prompt.
function focusIsUnclaimed() {
  const active = document.activeElement;
  return active === null || active === document.body;
}

// The card remounts on scroll-back with fresh elements, so the reader's position is recorded
// as a control name rather than a node. Returning them to the textarea when they were on
// Close or Ask would make them navigate back to what they had already reached.
function promptControlName(card: HTMLElement | null): string | null {
  if (!card || !(document.activeElement instanceof HTMLElement)) return null;
  if (!card.contains(document.activeElement)) return null;
  return document.activeElement.closest('[data-prompt-control]')?.getAttribute('data-prompt-control') ?? '';
}

function focusPromptControl(card: HTMLElement | null, name: string | null): boolean {
  if (!card || !name) return false;
  const control = card.querySelector(`[data-prompt-control="${name}"]`);
  if (!(control instanceof HTMLElement)) return false;
  control.focus();
  return true;
}

function readModelResponse(value: unknown): SelectionPromptResponse {
  if (typeof value !== 'object' || value === null || !('answer' in value) || typeof value.answer !== 'string') {
    throw new Error('The model endpoint returned an invalid response.');
  }
  return { answer: value.answer };
}

async function askModel(request: SelectionPromptRequest): Promise<SelectionPromptResponse> {
  const response = await fetch('/api/selection-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`The model request failed with status ${response.status}.`);
  return readModelResponse(await response.json());
}

export default function App() {
  return (
    <SuperDocUIProvider>
      <SelectionPromptEditor />
    </SuperDocUIProvider>
  );
}

function SelectionPromptEditor() {
  const ui = useSuperDocUI();
  const selection = useSuperDocSelection();
  const setSuperDoc = useSetSuperDoc();
  const shellRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const captureKeyRef = useRef('');
  const promptRequestIdRef = useRef(0);
  const restoreActionFocusRef = useRef(false);
  // The composer keeps `isComposerOpen` true across a scroll-away, so visibility alone must
  // not refocus it: only opening it, or having owned focus when it was hidden, may.
  const restoreComposerFocusRef = useRef<string | null>(null);
  const wasComposerOpenRef = useRef(false);
  const [capture, setCapture] = useState<SelectionCapture | null>(null);
  const [position, setPosition] = useState<PromptPosition | null>(null);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [status, setStatus] = useState('Select text in the document.');
  const [geometryStatus, setGeometryStatus] = useState<string | null>(null);

  const positionPrompt = useCallback(() => {
    const shell = shellRef.current;
    const target = capture?.selectionTarget ?? capture?.target;
    if (!ui || !shell || !target) {
      setPosition(null);
      setGeometryStatus(null);
      return;
    }

    const geometry = ui.viewport.getRect({ target, relativeTo: shell });
    if (!geometry.found || !geometry.rect) {
      setPosition(null);
      setGeometryStatus('The selection is not currently painted.');
      return;
    }

    const host = ui.viewport.getHost();
    if (!host) {
      setPosition(null);
      setGeometryStatus('The editor viewport is not currently available.');
      return;
    }

    const shellBounds = shell.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    const visibleTop = hostBounds.top - shellBounds.top;
    const visibleBottom = hostBounds.bottom - shellBounds.top;
    const visibleLeft = hostBounds.left - shellBounds.left;
    const visibleRight = hostBounds.right - shellBounds.left;
    const anchorRect = geometry.rects.find(
      (rect) =>
        rect.bottom >= visibleTop &&
        rect.top <= visibleBottom &&
        rect.right >= visibleLeft &&
        rect.left <= visibleRight,
    );
    if (!anchorRect) {
      setPosition(null);
      setGeometryStatus('Scroll back to the selection to show its prompt.');
      return;
    }

    const edge = 8;
    const gap = 12;
    const promptWidth = promptRef.current?.offsetWidth ?? (isComposerOpen ? 304 : 104);
    const promptHeight = promptRef.current?.offsetHeight ?? (isComposerOpen ? 300 : 40);
    const maxLeft = Math.max(edge, shell.clientWidth - promptWidth - edge);
    const minTop = visibleTop + edge;
    const maxTop = Math.max(minTop, visibleBottom - promptHeight - edge);
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - promptWidth / 2;
    const above = anchorRect.top - promptHeight - gap;
    const below = anchorRect.bottom + gap;
    const belowFits = below + promptHeight <= visibleBottom - edge;
    const preferredTop = isComposerOpen && belowFits ? below : above >= minTop ? above : below;

    setGeometryStatus(null);
    setPosition({
      left: Math.max(edge, Math.min(centeredLeft, maxLeft)),
      top: Math.max(minTop, Math.min(preferredTop, maxTop)),
    });
  }, [capture, isComposerOpen, ui]);

  useEffect(() => {
    if (!ui || selection.status !== 'ready' || selection.empty) return;
    const nextCapture = ui.selection.capture();
    if (!nextCapture) return;

    const nextKey = JSON.stringify([nextCapture.selectionTarget ?? nextCapture.target, nextCapture.quotedText]);
    if (nextKey !== captureKeyRef.current) {
      captureKeyRef.current = nextKey;
      promptRequestIdRef.current += 1;
      setPrompt('');
      setAnswer('');
      setIsAsking(false);
      setIsComposerOpen(false);
    }
    setCapture(nextCapture);
    setStatus('Selection captured. Choose Ask AI.');
  }, [selection, ui]);

  const isPromptVisible = position !== null;
  useLayoutEffect(positionPrompt, [answer, isComposerOpen, isPromptVisible, positionPrompt]);
  useEffect(() => ui?.viewport.observe(positionPrompt), [positionPrompt, ui]);

  // Record whether any prompt control — textarea, Close, Ask, Show selection — owned focus
  // just before the card unmounts, so a scroll-back restores it to the reader who had it
  // rather than pulling it from wherever it moved.
  useLayoutEffect(() => {
    if (!isPromptVisible) return undefined;
    return () => {
      restoreComposerFocusRef.current = promptControlName(promptRef.current);
    };
  }, [isPromptVisible]);

  useEffect(() => {
    // The card unmounts whenever the captured range scrolls out of view. isComposerOpen does
    // not change across that, so visibility has to drive focus restoration too.
    const composerJustOpened = isComposerOpen && !wasComposerOpenRef.current;
    wasComposerOpenRef.current = isComposerOpen;
    if (!isPromptVisible) return;
    const restoreTarget = restoreComposerFocusRef.current;
    if (isComposerOpen) {
      if (!composerJustOpened && restoreTarget === null) return;
      restoreComposerFocusRef.current = null;
      if (composerJustOpened) {
        questionRef.current?.focus();
        return;
      }
      if (focusIsUnclaimed() && !focusPromptControl(promptRef.current, restoreTarget)) {
        questionRef.current?.focus();
      }
      return;
    }
    // The capture is card-wide, so the compact action button's ownership lands in the same
    // record; either signal restores this branch. Closing the composer is deliberate and always
    // lands focus; a scroll-back only reclaims focus that nobody else took.
    const closedComposer = restoreActionFocusRef.current;
    if (!closedComposer && restoreTarget === null) return;
    restoreActionFocusRef.current = false;
    restoreComposerFocusRef.current = null;
    if (closedComposer) {
      actionButtonRef.current?.focus();
      return;
    }
    if (focusIsUnclaimed() && !focusPromptControl(promptRef.current, restoreTarget)) {
      actionButtonRef.current?.focus();
    }
  }, [isComposerOpen, isPromptVisible]);

  useEffect(
    () => () => {
      promptRequestIdRef.current += 1;
    },
    [],
  );

  function showSelection() {
    if (!ui || !capture) return;
    const result = ui.selection.restore(capture);
    setStatus(result.success ? 'Selection shown.' : `Could not show selection: ${result.reason ?? 'unknown'}.`);
  }

  function closeComposer() {
    restoreActionFocusRef.current = true;
    promptRequestIdRef.current += 1;
    setIsAsking(false);
    setPrompt('');
    setAnswer('');
    setIsComposerOpen(false);
    setStatus('Selection captured. Choose Ask AI.');
  }

  function openComposer() {
    restoreActionFocusRef.current = false;
    setIsComposerOpen(true);
    setStatus('The composer kept the captured text as context.');
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentCapture = capture;
    const question = prompt.trim();
    if (!currentCapture || !question || isAsking) return;

    const requestId = (promptRequestIdRef.current += 1);
    setIsAsking(true);
    setAnswer('');
    setStatus('Asking the model about the captured text…');

    try {
      const result = await askModel({ context: currentCapture.quotedText, question });
      if (requestId !== promptRequestIdRef.current) return;
      setAnswer(result.answer);
      setStatus('Response received for the captured text.');
    } catch (error) {
      if (requestId !== promptRequestIdRef.current) return;
      setStatus(error instanceof Error ? error.message : 'The model request failed.');
    } finally {
      if (requestId === promptRequestIdRef.current) setIsAsking(false);
    }
  }

  return (
    <>
      <div ref={shellRef} style={{ position: 'relative' }}>
        <SuperDocEditor
          document='/contract.docx'
          onContentError={({ error }) => {
            setGeometryStatus(null);
            setStatus('The document could not be read.');
            console.error(error);
          }}
          onException={({ error }) => {
            setGeometryStatus(null);
            setStatus('The editor reported a runtime error.');
            console.error(error);
          }}
          onReady={({ superdoc }) => setSuperDoc(superdoc)}
          ui={editorUi}
        />

        {capture && position ? (
          <aside
            aria-label={isComposerOpen ? 'Ask AI about selected text' : 'Actions for selected text'}
            ref={promptRef}
            style={{
              left: position.left,
              position: 'absolute',
              top: position.top,
              width: isComposerOpen ? 'min(19rem, calc(100% - 1rem))' : 'max-content',
            }}
            role={isComposerOpen ? 'dialog' : undefined}
          >
            {isComposerOpen ? (
              <>
                <strong>Ask about this</strong>
                <button aria-label='Close AI prompt' data-prompt-control='close' onClick={closeComposer} type='button'>
                  Close
                </button>
                <p>“{capture.quotedText}”</p>
                <form onSubmit={(event) => void submitPrompt(event)}>
                  <label htmlFor='selection-question'>Ask about this selection</label>
                  <textarea
                    data-prompt-control='question'
                    id='selection-question'
                    onChange={(event) => {
                      promptRequestIdRef.current += 1;
                      setPrompt(event.target.value);
                      setAnswer('');
                      setIsAsking(false);
                      setStatus('The prompt kept its captured document context.');
                    }}
                    placeholder='What does this limit?'
                    ref={questionRef}
                    rows={2}
                    style={{ resize: 'none' }}
                    value={prompt}
                  />
                  <button data-prompt-control='ask' disabled={isAsking || !prompt.trim()} type='submit'>
                    {isAsking ? 'Asking…' : 'Ask'}
                  </button>
                </form>
                {answer ? (
                  <div>
                    <strong>Response</strong>
                    <p>{answer}</p>
                  </div>
                ) : null}
                <button data-prompt-control='show' onClick={showSelection} type='button'>
                  Show selection
                </button>
              </>
            ) : (
              <button
                aria-haspopup='dialog'
                data-prompt-control='action'
                onClick={openComposer}
                ref={actionButtonRef}
                type='button'
              >
                Ask AI
              </button>
            )}
          </aside>
        ) : null}
      </div>
      <output aria-live='polite'>{geometryStatus ?? status}</output>
    </>
  );
}
