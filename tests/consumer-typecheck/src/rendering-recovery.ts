import { SuperDoc, type EditorRendering, type RenderHealthSnapshot, type RenderHealthStatus } from 'superdoc';

declare const superdoc: SuperDoc;
const rendering: EditorRendering | null | undefined = superdoc.activeEditor?.rendering;
if (rendering) {
  const snapshot: RenderHealthSnapshot = rendering.getSnapshot();
  const status: RenderHealthStatus = snapshot.status;
  const accepted: boolean = rendering.retry();
  const stop: () => void = rendering.subscribe((next) => {
    const state: RenderHealthStatus = next.status;
    const diagnostic: string | undefined = next.diagnostics[0]?.code;
    void [state, diagnostic];
  });
  void [status, accepted, stop];
}
