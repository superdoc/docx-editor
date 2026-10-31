export const floor = (val: number, precision?: number): number => {
  const multiplier = 10 ** (precision || 0);
  return Math.floor(val * multiplier) / multiplier;
};
