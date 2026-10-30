type SuperDocConfig = {
  document?: unknown;
  documentMode?: string;
  zoom?: { initial?: number };
  onEditorCreate?: (event: { editor: object; superdoc: SuperDoc }) => void;
  onReady?: (event: { superdoc: SuperDoc }) => void;
  onEditorDestroy?: () => void;
  onZoomChange?: (event: { zoom: number; mode: string }) => void;
  [key: string]: unknown;
};

export class SuperDoc {
  static readyGate: Promise<void> | null = null;
  config: SuperDocConfig;
  user: Record<string, unknown> | undefined;
  private zoom: number;
  private zoomMode = 'manual';
  private destroyed = false;

  constructor(config: SuperDocConfig) {
    if (config.document === 'not-a-valid-doc') {
      throw new Error('Invalid document');
    }

    this.config = config;
    this.user = config.user as Record<string, unknown> | undefined;
    this.zoom = typeof config.zoom?.initial === 'number' ? config.zoom.initial : 100;

    const gate = SuperDoc.readyGate ?? Promise.resolve();
    void gate.then(() => {
      if (this.destroyed) return;
      this.config.onEditorCreate?.({ editor: {}, superdoc: this });
      this.config.onReady?.({ superdoc: this });
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.config.onEditorDestroy?.();
  }

  focus() {
    return undefined;
  }

  setDocumentMode(mode: string) {
    this.config.documentMode = mode;
  }

  async setUser(user: Record<string, unknown>) {
    this.user = { ...user };
  }

  setZoom(zoom: number) {
    this.zoom = zoom;
    this.zoomMode = 'manual';
    this.config.onZoomChange?.({ zoom, mode: this.zoomMode });
  }

  getZoom() {
    return this.zoom;
  }

  getZoomState() {
    return { zoom: this.zoom, mode: this.zoomMode };
  }
}
