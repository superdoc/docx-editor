import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import type { SelectionCapture, SelectionSlice } from 'superdoc/ui';
import 'superdoc/style.css';

type SelectionPromptRequest = Readonly<{
  context: string;
  question: string;
}>;

type SelectionPromptResponse = Readonly<{
  answer: string;
}>;

const editorShell = document.querySelector<HTMLDivElement>('#editor-shell');
const editor = document.querySelector<HTMLDivElement>('#editor');
const promptCard = document.querySelector<HTMLElement>('#prompt-card');
const selectionActions = document.querySelector<HTMLDivElement>('#selection-actions');
const openPromptButton = document.querySelector<HTMLButtonElement>('#open-selection-prompt');
const composer = document.querySelector<HTMLDivElement>('#selection-composer');
const closePromptButton = document.querySelector<HTMLButtonElement>('#close-selection-prompt');
const preview = document.querySelector<HTMLParagraphElement>('#selection-preview');
const form = document.querySelector<HTMLFormElement>('#selection-prompt');
const question = document.querySelector<HTMLTextAreaElement>('#selection-question');
const askButton = document.querySelector<HTMLButtonElement>('#ask-selection');
const response = document.querySelector<HTMLDivElement>('#prompt-response');
const answer = document.querySelector<HTMLParagraphElement>('#prompt-answer');
const showSelectionButton = document.querySelector<HTMLButtonElement>('#show-selection');
const status = document.querySelector<HTMLOutputElement>('#selection-status');

// Set only when the card is hidden while it owns focus, so unhiding restores focus to the
// reader who had it and never steals it from the Editor on the card's first appearance.
let restorePromptFocus: HTMLElement | null = null;

if (
  !editorShell ||
  !editor ||
  !promptCard ||
  !selectionActions ||
  !openPromptButton ||
  !composer ||
  !closePromptButton ||
  !preview ||
  !form ||
  !question ||
  !askButton ||
  !response ||
  !answer ||
  !showSelectionButton ||
  !status
) {
  throw new Error('The selection prompt UI is incomplete.');
}

let capture: SelectionCapture | null = null;
let capturedTargetKey = '';
let promptRequestId = 0;
let isComposerOpen = false;
let stopSelection: (() => void) | null = null;
let stopViewport: (() => void) | null = null;
let removeHandlers: (() => void) | null = null;
let interactionStatus = 'Select text in the document.';

const reportInteraction = (message: string) => {
  interactionStatus = message;
  status.textContent = message;
};

const setComposerOpen = (open: boolean) => {
  isComposerOpen = open;
  selectionActions.hidden = open;
  composer.hidden = !open;
  promptCard.dataset.mode = open ? 'composer' : 'actions';
  promptCard.setAttribute('aria-label', open ? 'Ask AI about selected text' : 'Actions for selected text');
  openPromptButton.setAttribute('aria-expanded', String(open));
};

const resetComposer = () => {
  promptRequestId += 1;
  question.value = '';
  answer.textContent = '';
  response.hidden = true;
  askButton.disabled = true;
  setComposerOpen(false);
};

const readModelResponse = (value: unknown): SelectionPromptResponse => {
  if (typeof value !== 'object' || value === null || !('answer' in value) || typeof value.answer !== 'string') {
    throw new Error('The model endpoint returned an invalid response.');
  }
  return { answer: value.answer };
};

const askModel = async (request: SelectionPromptRequest): Promise<SelectionPromptResponse> => {
  const modelResponse = await fetch('/api/selection-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!modelResponse.ok) throw new Error(`The model request failed with status ${modelResponse.status}.`);
  return readModelResponse(await modelResponse.json());
};

const editorUi = {
  comments: false,
  toolbar: { container: '#toolbar' },
} satisfies UIConfig;

// Restoration must not outrank a deliberate focus move. Hiding the card unmounts the focused
// control, so the browser parks focus on <body>; anything else holding it means the reader
// moved on, and keeping their place matters more than returning to the prompt.
function focusIsUnclaimed() {
  const active = document.activeElement;
  return active === null || active === document.body;
}

function focusedPromptControl(card: HTMLElement): HTMLElement | null {
  if (!(document.activeElement instanceof HTMLElement)) return null;
  return card.contains(document.activeElement) ? document.activeElement : null;
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/contract.docx',
  ui: editorUi,
  onReady: ({ superdoc: readySuperDoc }) => {
    const ui = readySuperDoc.ui;

    const positionPrompt = () => {
      const target = capture?.selectionTarget ?? capture?.target;
      if (!target) {
        // Capture only on the visible -> hidden transition. A second invalidation while the
        // card is already hidden would otherwise see focus on the body and clear ownership.
        if (!promptCard.hidden) restorePromptFocus = focusedPromptControl(promptCard);
        promptCard.hidden = true;
        return;
      }

      const geometry = ui.viewport.getRect({ target, relativeTo: editorShell });
      if (!geometry.found || !geometry.rect) {
        // Capture only on the visible -> hidden transition. A second invalidation while the
        // card is already hidden would otherwise see focus on the body and clear ownership.
        if (!promptCard.hidden) restorePromptFocus = focusedPromptControl(promptCard);
        promptCard.hidden = true;
        status.textContent = geometry.reason ?? 'The selection is not currently painted.';
        return;
      }

      const shellBounds = editorShell.getBoundingClientRect();
      const editorBounds = editor.getBoundingClientRect();
      const visibleTop = editorBounds.top - shellBounds.top;
      const visibleBottom = editorBounds.bottom - shellBounds.top;
      const visibleLeft = editorBounds.left - shellBounds.left;
      const visibleRight = editorBounds.right - shellBounds.left;
      const anchorRect = geometry.rects.find(
        (rect) =>
          rect.bottom >= visibleTop &&
          rect.top <= visibleBottom &&
          rect.right >= visibleLeft &&
          rect.left <= visibleRight,
      );
      if (!anchorRect) {
        // Capture only on the visible -> hidden transition. A second invalidation while the
        // card is already hidden would otherwise see focus on the body and clear ownership.
        if (!promptCard.hidden) restorePromptFocus = focusedPromptControl(promptCard);
        promptCard.hidden = true;
        status.textContent = 'Scroll back to the selection to show its prompt.';
        return;
      }

      // Hiding the card removes the focused control from the rendered tree, so focus falls to
      // the document body. Restore it when the range scrolls back into view, or a keyboard
      // user has to rediscover the prompt.
      promptCard.hidden = false;
      if (restorePromptFocus) {
        // The card is only hidden, never removed, so the exact control the reader was on is
        // still focusable; returning them to the textarea would undo the navigation they did.
        const control = restorePromptFocus;
        restorePromptFocus = null;
        if (focusIsUnclaimed()) {
          (control.isConnected ? control : composer.hidden ? openPromptButton : question).focus();
        }
      }
      status.textContent = interactionStatus;
      const edge = 8;
      const gap = 12;
      const maxLeft = Math.max(edge, editorShell.clientWidth - promptCard.offsetWidth - edge);
      const minTop = editorBounds.top - shellBounds.top + edge;
      const maxTop = Math.max(minTop, editorBounds.bottom - shellBounds.top - promptCard.offsetHeight - edge);
      const centeredLeft = anchorRect.left + anchorRect.width / 2 - promptCard.offsetWidth / 2;
      const above = anchorRect.top - promptCard.offsetHeight - gap;
      const below = anchorRect.bottom + gap;
      const belowFits = below + promptCard.offsetHeight <= visibleBottom - edge;
      const preferredTop = isComposerOpen && belowFits ? below : above >= minTop ? above : below;
      promptCard.style.left = `${Math.max(edge, Math.min(centeredLeft, maxLeft))}px`;
      promptCard.style.top = `${Math.max(minTop, Math.min(preferredTop, maxTop))}px`;
    };

    const renderSelection = (selection: SelectionSlice) => {
      if (selection.status !== 'ready' || selection.empty) return;

      const nextCapture = ui.selection.capture();
      if (!nextCapture) return;

      const nextTargetKey = JSON.stringify([nextCapture.selectionTarget ?? nextCapture.target, nextCapture.quotedText]);
      capture = nextCapture;
      if (nextTargetKey !== capturedTargetKey) {
        capturedTargetKey = nextTargetKey;
        resetComposer();
      }
      preview.textContent = `“${nextCapture.quotedText}”`;
      reportInteraction('Selection captured. Choose Ask AI.');
      positionPrompt();
    };

    const openComposer = () => {
      if (!capture) return;
      setComposerOpen(true);
      reportInteraction('The composer kept the captured text as context.');
      positionPrompt();
      question.focus();
    };

    const closeComposer = () => {
      resetComposer();
      reportInteraction('Selection captured. Choose Ask AI.');
      positionPrompt();
      openPromptButton.focus();
    };

    const showSelection = () => {
      if (!capture) return;
      const result = ui.selection.restore(capture);
      reportInteraction(
        result.success ? 'Selection shown.' : `Could not show selection: ${result.reason ?? 'unknown'}`,
      );
    };

    const updateQuestion = () => {
      promptRequestId += 1;
      answer.textContent = '';
      response.hidden = true;
      askButton.disabled = question.value.trim().length === 0;
      reportInteraction('The prompt kept its captured document context.');
    };

    const submitPrompt = async (event: SubmitEvent) => {
      event.preventDefault();
      const currentCapture = capture;
      const currentQuestion = question.value.trim();
      if (!currentCapture || !currentQuestion) return;

      const requestId = (promptRequestId += 1);
      askButton.disabled = true;
      response.hidden = true;
      reportInteraction('Asking the model about the captured text…');

      try {
        const result = await askModel({ context: currentCapture.quotedText, question: currentQuestion });
        if (requestId !== promptRequestId) return;
        answer.textContent = result.answer;
        response.hidden = false;
        reportInteraction('Response received for the captured text.');
        positionPrompt();
      } catch (error) {
        if (requestId !== promptRequestId) return;
        reportInteraction(error instanceof Error ? error.message : 'The model request failed.');
      } finally {
        if (requestId === promptRequestId) askButton.disabled = question.value.trim().length === 0;
      }
    };

    renderSelection(ui.selection.getSnapshot());
    stopSelection = ui.selection.observe(renderSelection);
    stopViewport = ui.viewport.observe(positionPrompt);
    openPromptButton.addEventListener('click', openComposer);
    closePromptButton.addEventListener('click', closeComposer);
    showSelectionButton.addEventListener('click', showSelection);
    question.addEventListener('input', updateQuestion);
    form.addEventListener('submit', submitPrompt);
    removeHandlers = () => {
      openPromptButton.removeEventListener('click', openComposer);
      closePromptButton.removeEventListener('click', closeComposer);
      showSelectionButton.removeEventListener('click', showSelection);
      question.removeEventListener('input', updateQuestion);
      form.removeEventListener('submit', submitPrompt);
    };
  },
  onContentError: ({ error }) => {
    reportInteraction('The document could not be read.');
    console.error(error);
  },
  onException: ({ error }) => {
    reportInteraction('The editor reported a runtime error.');
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  promptRequestId += 1;
  stopSelection?.();
  stopViewport?.();
  removeHandlers?.();
  superdoc.destroy();
});
