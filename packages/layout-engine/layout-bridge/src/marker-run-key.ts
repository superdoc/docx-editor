import type { WordLayoutMarker } from '@superdoc/contracts';

export const markerRunMeasureKey = (run: WordLayoutMarker['run'] | undefined): string =>
  run
    ? JSON.stringify([
        run.fontFamily ?? null,
        run.fontSize ?? null,
        run.bold === true,
        run.italic === true,
        run.letterSpacing ?? 0,
      ])
    : '';
