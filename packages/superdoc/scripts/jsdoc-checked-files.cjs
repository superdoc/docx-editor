/**
 * Hand-curated set of `.js` files explicitly gated by
 * `check-jsdoc.cjs`'s per-file `// @ts-check` ratchet.
 */

module.exports = {
  /**
   * Each entry MUST have `// @ts-check` at the top of the source.
   * Adding a file commits the contributor to keeping it clean against
   * tsc. Kept small on purpose; broader checkJs coverage is gained
   * one file at a time, not in a mass migration.
   */
  CHECKED_FILES: [
  ],

  /**
   * Files kept under the gate even though they are not reached through
   * the public-surface walk. Their typedefs feed exported SuperDoc
   * configuration types but are reached via implementation imports
   * rather than direct public barrel exports. Reachability gate skips
   * these — they're already accounted for explicitly.
   */
  REACHABILITY_EXEMPT_CHECKED_FILES: [
  ],
};
