import { SuperDoc } from 'superdoc';
import type { UIConfig } from 'superdoc';
import type { CommentsSlice, SelectionCapture, SelectionSlice, WorkflowReceipt } from 'superdoc/ui';
import 'superdoc/style.css';

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing comments element: ${selector}`);
  return element;
}

const startComment = getElement<HTMLButtonElement>('#start-comment');
const toolbar = getElement<HTMLDivElement>('#toolbar');
const composer = getElement<HTMLFormElement>('#comment-composer');
const commentText = getElement<HTMLTextAreaElement>('#comment-text');
const addComment = getElement<HTMLButtonElement>('#add-comment');
const cancelComment = getElement<HTMLButtonElement>('#cancel-comment');
const commentCount = getElement<HTMLParagraphElement>('#comment-count');
const commentsStatus = getElement<HTMLParagraphElement>('#comments-status');
const commentList = getElement<HTMLUListElement>('#comment-list');

const editorUi = {
  comments: false,
  toolbar: { container: toolbar, responsiveTo: 'container' },
} satisfies UIConfig;
let capture: SelectionCapture | null = null;
let stopBindings: (() => void) | null = null;

function report(receipt: Awaited<WorkflowReceipt>, success: string): boolean {
  commentsStatus.textContent = receipt.success ? success : receipt.failure.message;
  return receipt.success;
}

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  user: { name: 'Alex Rivera', email: 'alex@example.com' },
  ui: editorUi,
  onReady: ({ superdoc: readySuperDoc }) => {
    stopBindings?.();
    capture = null;
    composer.hidden = true;
    commentText.value = '';
    addComment.disabled = true;
    const { ui } = readySuperDoc;
    let selectionIsEmpty = true;

    let pendingCapture: SelectionCapture | null = null;

    const updateComposer = () => {
      commentText.disabled = pendingCapture !== null;
      addComment.disabled = pendingCapture !== null || !capture || commentText.value.trim().length === 0;
      cancelComment.disabled = pendingCapture !== null;
    };

    const closeComposer = () => {
      capture = null;
      commentText.value = '';
      composer.hidden = true;
      startComment.disabled = selectionIsEmpty;
      updateComposer();
      startComment.focus();
    };

    const renderSelection = (selection: SelectionSlice) => {
      selectionIsEmpty = selection.empty;
      startComment.disabled = selection.empty || !composer.hidden;
    };

    const renderComments = (commentState: CommentsSlice) => {
      const threads = commentState.items.filter((comment) => !comment.parentCommentId);
      commentCount.textContent =
        commentState.listStatus === 'pending' ? 'Loading comments...' : `${threads.length} threads`;
      commentList.replaceChildren();

      for (const thread of threads) {
        const row = document.createElement('li');
        const body = document.createElement('span');
        const show = document.createElement('button');
        const toggleStatus = document.createElement('button');

        body.textContent = thread.text || 'Comment without text';
        show.type = 'button';
        show.textContent = 'Show in document';
        show.addEventListener('click', async () => {
          if (!ui.comments.setActive(thread.id)) {
            commentsStatus.textContent = 'The comment is no longer available.';
            return;
          }
          const result = await ui.comments.scrollTo(thread.id);
          commentsStatus.textContent = result.success
            ? 'Showing the comment in the document.'
            : (result.reason ?? 'The comment could not be shown.');
        });

        toggleStatus.type = 'button';
        toggleStatus.textContent = thread.status === 'resolved' ? 'Reopen' : 'Resolve';
        toggleStatus.addEventListener('click', async () => {
          const receipt =
            thread.status === 'resolved' ? await ui.comments.reopen(thread.id) : await ui.comments.resolve(thread.id);
          report(receipt, thread.status === 'resolved' ? 'Comment reopened.' : 'Comment resolved.');
        });

        row.append(body, show, toggleStatus);
        commentList.append(row);
      }
    };

    const captureSelection = () => {
      capture = ui.selection.capture();
    };

    const openComposer = (event: MouseEvent) => {
      if (event.detail === 0) capture = ui.selection.capture();
      else capture ??= ui.selection.capture();
      if (!capture) {
        commentsStatus.textContent = 'Select text before starting a comment.';
        return;
      }
      composer.hidden = false;
      startComment.disabled = true;
      commentText.focus();
      updateComposer();
    };

    const createComment = async (event: SubmitEvent) => {
      event.preventDefault();
      if (!capture || pendingCapture) return;
      // Lock the composer until the receipt settles so a repeated submit cannot
      // send the same draft twice, and a draft opened later is not closed by
      // this receipt.
      pendingCapture = capture;
      updateComposer();
      const receipt = await ui.comments.createFromCapture(pendingCapture, { text: commentText.value.trim() });
      const stillCurrent = capture === pendingCapture;
      pendingCapture = null;
      if (report(receipt, 'Comment added.') && stillCurrent) closeComposer();
      else updateComposer();
    };

    renderSelection(ui.selection.getSnapshot());
    renderComments(ui.comments.getSnapshot());
    const stopSelection = ui.selection.observe(renderSelection);
    const stopComments = ui.comments.observe(renderComments);

    startComment.addEventListener('mousedown', captureSelection);
    startComment.addEventListener('click', openComposer);
    commentText.addEventListener('input', updateComposer);
    composer.addEventListener('submit', createComment);
    cancelComment.addEventListener('click', closeComposer);

    stopBindings = () => {
      stopSelection();
      stopComments();
      startComment.removeEventListener('mousedown', captureSelection);
      startComment.removeEventListener('click', openComposer);
      commentText.removeEventListener('input', updateComposer);
      composer.removeEventListener('submit', createComment);
      cancelComment.removeEventListener('click', closeComposer);
    };
  },
  onContentError: ({ error }) => {
    commentsStatus.textContent = 'The document could not be opened.';
    console.error(error);
  },
  onException: ({ error }) => {
    commentsStatus.textContent = 'The document could not be opened.';
    console.error(error);
  },
});

window.addEventListener('beforeunload', () => {
  stopBindings?.();
  superdoc.destroy();
});
