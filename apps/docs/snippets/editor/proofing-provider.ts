import type { Config } from 'superdoc';

export const proofing = {
  enabled: true,
  provider: {
    id: 'local-example',
    check: async ({ segments, signal }) => {
      signal?.throwIfAborted();
      return {
        issues: segments.flatMap((segment) => {
          return Array.from(
            segment.text.matchAll(/(?<![\p{L}\p{M}\p{N}_])teh(?![\p{L}\p{M}\p{N}_])/gu),
            ({ index }) => ({
              segmentId: segment.id,
              start: index,
              end: index + 3,
              kind: 'spelling' as const,
              replacements: ['the'],
            }),
          );
        }),
      };
    },
  },
} satisfies NonNullable<Config['proofing']>;
