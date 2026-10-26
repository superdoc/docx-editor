export function createImmutableDataProofCache(maxEntriesPerSegment = 131072) {
  const segments = [new WeakSet<object>()];
  let writes = 0;
  return {
    has(value: object): boolean {
      for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index]!.has(value)) return true;
      }
      return false;
    },
    add(value: object): void {
      if (writes === maxEntriesPerSegment) {
        if (segments.length === 8) segments.shift();
        segments.push(new WeakSet<object>());
        writes = 0;
      }
      segments[segments.length - 1]!.add(value);
      writes++;
    },
  };
}
