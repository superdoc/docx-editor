const FONT_SIZE_STEPS: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

export function stepFontSize(value: number, direction: 'grow' | 'shrink'): number | null {
  if (!Number.isFinite(value) || value < 1 || value > 1638) return null;
  let next: number;
  if (direction === 'grow') {
    next =
      value < 8
        ? Math.floor(value) + 1
        : (FONT_SIZE_STEPS.find((size) => size > value) ?? (Math.floor(value / 10) + 1) * 10);
  } else {
    next =
      value <= 8
        ? Math.ceil(value) - 1
        : value > 72
          ? Math.max(72, (Math.ceil(value / 10) - 1) * 10)
          : FONT_SIZE_STEPS.reduce((previous, size) => (size < value ? size : previous), 1);
  }
  next = Math.min(1638, Math.max(1, next));
  return next === value ? null : next;
}
