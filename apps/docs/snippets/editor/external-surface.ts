import { SuperDoc, type SurfaceOutcome } from 'superdoc';
import 'superdoc/style.css';

const actions = document.querySelector<HTMLElement>('#surface-actions');
const openButton = document.querySelector<HTMLButtonElement>('#open-confirmation');
const status = document.querySelector<HTMLElement>('#surface-status');
if (!actions || !openButton || !status) throw new Error('The surface controls are incomplete.');

const reportDocumentError = ({ error }: { error: unknown }) => {
  console.error('Could not open the document.', error);
  if (openButton.disabled) status.textContent = 'Could not open the document. Reload to try again.';
};

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  onContentError: reportDocumentError,
  onException: reportDocumentError,
  onReady: () => {
    openButton.disabled = false;
    status.textContent = '';
  },
});

type ConfirmationResult = Readonly<{ action: 'continue' }>;

export const confirmInEditor = async (message: string): Promise<boolean> => {
  const handle = superdoc.openSurface<ConfirmationResult>({
    mode: 'dialog',
    title: 'Confirm action',
    render: ({ container, close, resolve }) => {
      const text = document.createElement('p');
      text.textContent = message;

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.textContent = 'Continue';

      const cancelAction = () => close('cancel');
      const confirmAction = () => resolve({ action: 'continue' });
      cancel.addEventListener('click', cancelAction);
      confirm.addEventListener('click', confirmAction);
      container.append(text, cancel, confirm);

      return {
        destroy() {
          cancel.removeEventListener('click', cancelAction);
          confirm.removeEventListener('click', confirmAction);
        },
      };
    },
  });

  const outcome: SurfaceOutcome<ConfirmationResult> = await handle.result;
  switch (outcome.status) {
    case 'submitted':
      return outcome.data?.action === 'continue';
    case 'closed':
      return false;
    case 'replaced':
      return false;
    case 'destroyed':
      return false;
  }
};

openButton.addEventListener('click', async () => {
  actions.inert = true;
  try {
    const confirmed = await confirmInEditor('Continue with this action?');
    status.textContent = confirmed ? 'Confirmed.' : 'No action taken.';
  } catch (error) {
    console.error('Could not open the confirmation.', error);
    status.textContent = 'Could not open the confirmation. Try again.';
  } finally {
    actions.inert = false;
    openButton.focus({ preventScroll: true });
  }
});

window.addEventListener('beforeunload', () => superdoc.destroy());
