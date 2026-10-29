import type { SuperDoc } from 'superdoc';
import type { HistorySlice } from 'superdoc/ui';

declare const superdoc: SuperDoc;
declare const undoButton: HTMLButtonElement;

const { ui } = superdoc;

const stop: () => void = ui.history.observe(({ canUndo, canRedo, undoDepth, redoDepth }: HistorySlice) => {
  undoButton.disabled = !canUndo;
  undoButton.title = `Undo (${undoDepth}), redo (${redoDepth}) ${canRedo}`;
});
stop();

const current: HistorySlice = ui.history.getSnapshot();
const fromState: HistorySlice = ui.state.history;
void current;
void fromState;

// @ts-expect-error history is read-only; undo runs through ui.commands or doc.history
ui.history.undo();
