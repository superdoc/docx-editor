/**
 * Whether the requested document replaced the mounted content. Read this result,
 * not `onReady`: recovery can make the previous document ready after a failed attempt.
 * A failure does not guarantee that the previous document is still available.
 */
export type DocumentReplacementResult =
  | { ok: true }
  | {
      ok: false;
      /** Runtime refusal or failure code, when provided. */
      reason?: string;
      /** Additional runtime context, when provided. */
      detail?: string;
    };
