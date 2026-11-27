export type RenderHealthStatus = 'unavailable' | 'rendering' | 'current' | 'recovering' | 'failed';

export interface RenderHealthSnapshot {
  status: RenderHealthStatus;
  diagnostics: ReadonlyArray<{ code: string; message: string; severity: 'info' | 'warn' | 'error' }>;
}

export interface EditorRendering {
  getSnapshot(): RenderHealthSnapshot;
  subscribe(listener: (snapshot: RenderHealthSnapshot) => void): () => void;
  retry(): boolean;
}
