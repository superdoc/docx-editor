import { useEffect, useRef, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { UIConfig } from 'superdoc';
import type { SelectionCapture, WorkflowReceipt } from 'superdoc/ui';
import {
  SuperDocUIProvider,
  useSetSuperDoc,
  useSuperDocComments,
  useSuperDocSelection,
  useSuperDocUI,
} from 'superdoc/ui/react';
import '@superdoc/react/style.css';

const editorUi = { comments: false } satisfies UIConfig;
const currentUser = { name: 'Alex Rivera', email: 'alex@example.com' };

export default function App() {
  return (
    <SuperDocUIProvider>
      <main className='comments-layout'>
        <Editor />
        <CommentsPanel />
      </main>
    </SuperDocUIProvider>
  );
}

function Editor() {
  const setSuperDoc = useSetSuperDoc();

  return (
    <SuperDocEditor
      document='/sample.docx'
      onContentError={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onException={({ error }) => console.error('SuperDoc could not open the document.', error)}
      onReady={({ superdoc }) => setSuperDoc(superdoc)}
      ui={editorUi}
      user={currentUser}
    />
  );
}

function CommentsPanel() {
  const ui = useSuperDocUI();
  const commentState = useSuperDocComments();
  const selection = useSuperDocSelection();
  const startCommentRef = useRef<HTMLButtonElement>(null);
  const pressedCapture = useRef<SelectionCapture | null>(null);
  const restoreFocus = useRef(false);
  const [capture, setCapture] = useState<SelectionCapture | null>(null);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Select text to start a comment.');

  const threads = commentState.items.filter((comment) => !comment.parentCommentId);

  useEffect(() => {
    if (capture || !restoreFocus.current) return;
    restoreFocus.current = false;
    startCommentRef.current?.focus();
  }, [capture]);

  function report(receipt: Awaited<WorkflowReceipt>, success: string): boolean {
    setStatus(receipt.success ? success : receipt.failure.message);
    return receipt.success;
  }

  function captureSelection() {
    pressedCapture.current = ui?.selection.capture() ?? null;
  }

  function openComposer(event: React.MouseEvent<HTMLButtonElement>) {
    const nextCapture =
      event.detail === 0
        ? (ui?.selection.capture() ?? null)
        : (pressedCapture.current ?? ui?.selection.capture() ?? null);
    pressedCapture.current = null;
    if (!nextCapture) {
      setStatus('Select text before starting a comment.');
      return;
    }
    setCapture(nextCapture);
  }

  function closeComposer() {
    restoreFocus.current = true;
    pressedCapture.current = null;
    setCapture(null);
    setText('');
  }

  async function createComment() {
    if (!ui || !capture || pending) return;
    // Lock the composer until the receipt settles so a repeated submit cannot
    // send the same draft twice, and a draft opened later is not closed by
    // this receipt.
    setPending(true);
    const receipt = await ui.comments.createFromCapture(capture, { text: text.trim() });
    setPending(false);
    if (report(receipt, 'Comment added.')) closeComposer();
  }

  async function showThread(commentId: string) {
    if (!ui?.comments.setActive(commentId)) {
      setStatus('The comment is no longer available.');
      return;
    }
    const result = await ui.comments.scrollTo(commentId);
    setStatus(
      result.success ? 'Showing the comment in the document.' : (result.reason ?? 'The comment could not be shown.'),
    );
  }

  if (!ui) return <aside aria-label='Comments'>Opening document...</aside>;

  return (
    <aside aria-labelledby='comments-heading'>
      <h2 id='comments-heading'>Comments</h2>
      <p>{commentState.listStatus === 'pending' ? 'Loading comments...' : `${threads.length} threads`}</p>

      <button
        disabled={selection.empty || capture !== null}
        onClick={openComposer}
        onMouseDown={captureSelection}
        ref={startCommentRef}
        type='button'
      >
        Comment on selection
      </button>

      {capture && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createComment();
          }}
        >
          <label>
            New comment
            <textarea
              autoFocus
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              value={text}
            />
          </label>
          <button disabled={pending || text.trim().length === 0} type='submit'>
            Add comment
          </button>
          <button disabled={pending} onClick={closeComposer} type='button'>
            Cancel
          </button>
        </form>
      )}

      <ul>
        {threads.map((thread) => (
          <li aria-current={thread.id === commentState.activeId ? 'true' : undefined} key={thread.id}>
            <span>{thread.text || 'Comment without text'}</span>
            <button onClick={() => void showThread(thread.id)} type='button'>
              Show in document
            </button>
            <button
              onClick={async () => {
                const receipt =
                  thread.status === 'resolved'
                    ? await ui.comments.reopen(thread.id)
                    : await ui.comments.resolve(thread.id);
                report(receipt, thread.status === 'resolved' ? 'Comment reopened.' : 'Comment resolved.');
              }}
              type='button'
            >
              {thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
            </button>
          </li>
        ))}
      </ul>

      <p aria-live='polite' role='status'>
        {status}
      </p>
    </aside>
  );
}
