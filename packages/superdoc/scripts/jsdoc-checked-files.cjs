/**
 * Shared source of truth for the hand-curated set of `.js` files
 * explicitly gated by `check-jsdoc.cjs`'s per-file `// @ts-check`
 * ratchet.
 *
 * Two consumers:
 *
 *   - `check-jsdoc.cjs` — enforces these files stay clean against tsc.
 *   - `report-js-contract-owners.cjs` — classifies these as
 *     `checked-files` (not `unaccounted`) in its public-surface JS
 *     ownership inventory.
 *
 * Keeping both consumers reading from this single file prevents the
 * audit's classification from drifting silently when the gate's list
 * changes. Adding/removing a file is a one-spot edit.
 *
 * To add a file:
 *   1. Add `// @ts-check` as the first line of the source.
 *   2. Append the repo-relative path to `CHECKED_FILES` below.
 *   3. Run `pnpm --filter superdoc run check:jsdoc` and fix what
 *      surfaces.
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
