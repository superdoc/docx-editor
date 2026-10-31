export function flattenPoints(points: readonly (readonly number[])[]): number[] {
  return points.flatMap((pair) => [pair[0], pair[1]]);
}
