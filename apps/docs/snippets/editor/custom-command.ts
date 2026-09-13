import { SuperDoc } from 'superdoc';
import type { CommandExecutionResult, CustomCommandHandle } from 'superdoc/ui';
import 'superdoc/style.css';

type InsertClausePayload = Readonly<{
  text: string;
  trigger: 'button' | 'shortcut';
}>;

const commandDemo = document.querySelector<HTMLDivElement>('#command-demo');
const insertClause = document.querySelector<HTMLButtonElement>('#insert-clause');
const status = document.querySelector<HTMLOutputElement>('#command-status');

if (!commandDemo || !insertClause || !status) throw new Error('The custom command controls are incomplete.');

const clauseText = ' This agreement is governed by the laws of California.';
let command: CustomCommandHandle<InsertClausePayload> | null = null;
let unregisterCommand: (() => void) | null = null;
let stopCommandState: (() => void) | null = null;
let removeHandlers: (() => void) | null = null;
let pending = false;

const report = (result: CommandExecutionResult, trigger: InsertClausePayload['trigger']) => {
  if (result === false) {
    status.textContent = 'The command could not run.';
  } else if (typeof result === 'object' && !result.success) {
    status.textContent = result.failure?.message ?? 'The clause was not inserted.';
  } else {
    status.textContent = `${trigger === 'button' ? 'Button' : 'Shortcut'} inserted the clause.`;
  }
};

const render = () => {
  const state = command?.getState();
  insertClause.disabled = pending || !state?.enabled;
  insertClause.title = state?.reason ?? 'Insert standard clause';
};

const run = async (trigger: InsertClausePayload['trigger']) => {
  if (!command || pending) return;
  if (!command.getState().enabled) {
    status.textContent = 'Place the caret in the document first.';
    return;
  }

  pending = true;
  render();
  try {
    report(await command.executeAsync({ text: clauseText, trigger }), trigger);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'The clause was not inserted.';
  } finally {
    pending = false;
    render();
  }
};

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  ui: { toolbar: { container: '#toolbar' } },
  onReady: ({ superdoc: readySuperDoc }) => {
    stopCommandState?.();
    removeHandlers?.();
    unregisterCommand?.();
    pending = false;

    const ui = readySuperDoc.ui;
    const registration = ui.commands.register<InsertClausePayload>({
      id: 'application.insertClause',
      shortcut: 'Ctrl-Shift-Y',
      getState: ({ state, selection, documentMode }) => {
        const settled = state.ready && selection.status === 'ready';
        // `status: 'ready'` only means the selection read settled. Before the reader places a
        // caret both targets are null, and `insertText()` then has no insertion point.
        // Insert at a non-collapsed range degrades to a replace, which would delete the
        // reader's selection, so require a collapsed caret rather than any target.
        const hasCaret = Boolean(selection.selectionTarget ?? selection.target) && selection.empty;
        return {
          enabled: settled && hasCaret && documentMode !== 'viewing',
          active: false,
          supported: true,
          reason: !settled
            ? 'not-ready'
            : !hasCaret
              ? 'selection-required'
              : documentMode === 'viewing'
                ? 'document-readonly'
                : undefined,
        };
      },
      execute: ({ payload, insertText }) => (payload?.text ? insertText(payload.text) : false),
    });
    command = registration.handle;

    const preserveSelection = (event: MouseEvent) => event.preventDefault();
    const runButton = () => void run('button');
    const runShortcut = (event: KeyboardEvent) => {
      if (!event.composedPath().includes(commandDemo)) return;
      if (event.repeat) return;
      // Match the advertised character. Alt is excluded, so `event.key` is not an AltGr
      // composition here, and `event.code` would match a US physical position instead.
      // An IME can emit a matching keydown mid-composition; ignore those.
      if (event.isComposing) return;
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'y') return;
      event.preventDefault();
      void run('shortcut');
    };

    render();
    stopCommandState = command.observe(render);
    unregisterCommand = registration.unregister;
    insertClause.addEventListener('mousedown', preserveSelection);
    insertClause.addEventListener('click', runButton);
    window.addEventListener('keydown', runShortcut, true);

    removeHandlers = () => {
      insertClause.removeEventListener('mousedown', preserveSelection);
      insertClause.removeEventListener('click', runButton);
      window.removeEventListener('keydown', runShortcut, true);
    };
  },
});

window.addEventListener('beforeunload', () => {
  stopCommandState?.();
  removeHandlers?.();
  unregisterCommand?.();
  superdoc.destroy();
});
