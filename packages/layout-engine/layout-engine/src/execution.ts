export type LayoutExecutionPhase =
  | 'measure:block'
  | 'layout-document:prepare'
  | 'layout-document:preflight-section'
  | 'layout-document:preflight-footnote'
  | 'layout-document:preflight-anchor'
  | 'layout-document:preflight-keep-next'
  | 'layout-document:block'
  | 'layout-document:table-fragment'
  | 'layout-document:footnote-continuation'
  | 'layout-document:finalize-page'
  | 'layout-document:finalize-section'
  | 'page-token:prepare'
  | 'page-token:page'
  | 'numbering-context:chapter'
  | 'numbering-context:page'
  | 'footnote:phase'
  | 'header-footer:variant'
  | 'header-footer:block'
  | 'header-footer:page';

export type LayoutExecutionCheckpoint = {
  phase: LayoutExecutionPhase;
  index?: number;
  total?: number;
};

/** Phase-agnostic progress emitted by resumable layout helpers. */
export type LayoutWorkCheckpoint = {
  index: number;
  total?: number;
};

export interface LayoutExecutionControl {
  signal?: AbortSignal;
  /** Host-owned task boundary. It may resolve immediately while the current budget remains. */
  yieldToHost?: (checkpoint: LayoutExecutionCheckpoint) => Promise<void>;
  /** Work cadence for document/block loops. Defaults to 16. */
  checkpointEveryBlocks?: number;
}

export function layoutExecutionCheckpointEveryBlocks(execution: LayoutExecutionControl | undefined): number {
  return Math.max(1, Math.floor(execution?.checkpointEveryBlocks ?? 16));
}

export function throwIfLayoutExecutionAborted(execution: LayoutExecutionControl | undefined): void {
  const signal = execution?.signal;
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted();
  }
  const error = new Error('Layout execution was aborted');
  error.name = 'AbortError';
  throw error;
}

export async function checkpointLayoutExecution(
  execution: LayoutExecutionControl | undefined,
  checkpoint: LayoutExecutionCheckpoint,
): Promise<void> {
  throwIfLayoutExecutionAborted(execution);
  await execution?.yieldToHost?.(checkpoint);
  throwIfLayoutExecutionAborted(execution);
}
