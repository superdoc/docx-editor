/** The runtime owns its Vue component; consumers only need the surface request value. */
export function createWatermarkSurfaceRuntime(getContainer?: () => HTMLElement | null): {
  component: unknown;
  captureFocusReturn(): (isCurrent: () => boolean) => Promise<void>;
  mount(): void;
  announce(message: string): void;
  destroy(): void;
};
