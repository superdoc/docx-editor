/**
 * Consumer typecheck: UI and state-control public APIs on `SuperDoc`.
 *
 * Drains the low-risk UI/state batch from the public-method coverage
 * gate. Each method's parameter or return shape is asserted against
 * the emitted `.d.ts` with strict identity equality, so a future
 * migration that narrows or widens any of these contracts will fail
 * CI on the obligation diff rather than slipping silently into a
 * release.
 *
 * Methods covered here, with returns verified against the emitted
 * `.d.ts` and not inferred from intent:
 *
 *   - `setZoom(percent)` → `void`
 *   - `setHighContrastMode(isHighContrast)` → `void`
 *   - `setShowBookmarks(show?)` → `void`
 *   - `setShowFormattingMarks(show?)` → `void`
 *   - `setDisableContextMenu(disabled?)` → `void`
 *   - `setTrackedChangesPreferences(preferences?)` → `void`
 *   - `toggleFormattingMarks()` → `void`
 *   - `toggleRuler()` → `void`
 *   - `focus(options?)` → `void`
 *   - `destroy()` → `void`
 *   - `element` (getter) → `Element | null`
 *   - `requiredNumberOfEditors` (getter) → `number`
 *
 * Drained obligations (19): 6 method pairs (parameters + returns)
 * for the setters, plus the `focus(options?)` parameter/return pair,
 * 3 zero-param method returns, and 2 getter returns.
 *
 * Not covered here:
 *
 *   - The `state` getter returns `{ documents: RuntimeDocument[]; users: User[] }`.
 *     RuntimeDocument is an internal-only type (declared in
 *     core/types/index.ts with an "Internal use only; not part of any
 *     public typedef" header) and is not re-exported through the
 *     public facade. Asserting the indexed return type against a
 *     consumer-importable shape would require either widening the
 *     source return to use the public Document (lossy for internal
 *     callers) or promoting RuntimeDocument to a public supported-root
 *     type (out of scope here). The corresponding obligation is left
 *     on the debt snapshot until that surface decision is made.
 */
import type { SuperDoc, SuperDocMeasurementUnit } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

declare const sd: SuperDoc;

// ─── setMeasurementUnit ─────────────────────────────────────────────
// Switches the ruler/measurement-field unit. Closed union parameter
// (SuperDocMeasurementUnit); invalid strings must be rejected at compile time.
const _setMeasurementUnitParamsOk: AssertEqual<
  Parameters<SuperDoc['setMeasurementUnit']>,
  [unit: SuperDocMeasurementUnit]
> = true;
const _setMeasurementUnitReturnOk: AssertEqual<ReturnType<SuperDoc['setMeasurementUnit']>, void> = true;
sd.setMeasurementUnit('cm');
sd.setMeasurementUnit('in');
// @ts-expect-error measurement unit is a closed union; only 'in' / 'cm'.
sd.setMeasurementUnit('furlongs');

// ─── setZoom ────────────────────────────────────────────────────────
// Updates the active zoom in the public SuperDoc state.
// Early-returns on non-positive / non-finite input.
const _setZoomParamsOk: AssertEqual<Parameters<SuperDoc['setZoom']>, [percent: number]> = true;
const _setZoomReturnOk: AssertEqual<ReturnType<SuperDoc['setZoom']>, void> = true;
sd.setZoom(150);

// ─── setZoomMode ────────────────────────────────────────────────────
// Switches between manual and fit-width zoom. Closed union parameter;
// invalid strings must be rejected at compile time.
const _setZoomModeParamsOk: AssertEqual<Parameters<SuperDoc['setZoomMode']>, [mode: 'manual' | 'fit-width']> = true;
const _setZoomModeReturnOk: AssertEqual<ReturnType<SuperDoc['setZoomMode']>, void> = true;
sd.setZoomMode('fit-width');
sd.setZoomMode('manual');
// @ts-expect-error zoom mode is a closed union; only manual/fit-width.
sd.setZoomMode('fit-page');

// ─── setHighContrastMode ────────────────────────────────────────────
// Forwards to `activeEditor.setHighContrastMode` and updates this
// instance's high-contrast state. No-op until the active editor exists.
const _setHighContrastParamsOk: AssertEqual<
  Parameters<SuperDoc['setHighContrastMode']>,
  [isHighContrast: boolean]
> = true;
const _setHighContrastReturnOk: AssertEqual<ReturnType<SuperDoc['setHighContrastMode']>, void> = true;
sd.setHighContrastMode(true);

// ─── setShowBookmarks ───────────────────────────────────────────────
// Writes `layoutEngineOptions.showBookmarks`. Parameter has a `= true` default in source, so
// the emitted signature is `(show?: boolean)`.
const _setShowBookmarksParamsOk: AssertEqual<Parameters<SuperDoc['setShowBookmarks']>, [show?: boolean]> = true;
const _setShowBookmarksReturnOk: AssertEqual<ReturnType<SuperDoc['setShowBookmarks']>, void> = true;
sd.setShowBookmarks(true);
sd.setShowBookmarks();

// ─── setShowFormattingMarks ─────────────────────────────────────────
// Same shape as setShowBookmarks. Writes the layout option and emits
// `formatting-marks-change`.
const _setShowFormattingMarksParamsOk: AssertEqual<
  Parameters<SuperDoc['setShowFormattingMarks']>,
  [show?: boolean]
> = true;
const _setShowFormattingMarksReturnOk: AssertEqual<ReturnType<SuperDoc['setShowFormattingMarks']>, void> = true;
sd.setShowFormattingMarks(true);

// ─── setDisableContextMenu ──────────────────────────────────────────
// Writes `config.disableContextMenu`. Same `(disabled?: boolean)` default shape
// as the other toggles.
const _setDisableContextMenuParamsOk: AssertEqual<
  Parameters<SuperDoc['setDisableContextMenu']>,
  [disabled?: boolean]
> = true;
const _setDisableContextMenuReturnOk: AssertEqual<ReturnType<SuperDoc['setDisableContextMenu']>, void> = true;
sd.setDisableContextMenu(true);

// ─── setTrackedChangesPreferences ───────────────────────────────────
// Accepts an inline literal of mode + enabled. The source param is
// optional; an empty object normalizes to `undefined`. Mode is the
// closed union `'review' | 'original' | 'final' | 'off'`.
const _setTrackedChangesParamsOk: AssertEqual<
  Parameters<SuperDoc['setTrackedChangesPreferences']>,
  [preferences?: { mode?: 'review' | 'original' | 'final' | 'off'; enabled?: boolean }]
> = true;
const _setTrackedChangesReturnOk: AssertEqual<ReturnType<SuperDoc['setTrackedChangesPreferences']>, void> = true;
sd.setTrackedChangesPreferences({ mode: 'review', enabled: true });

// ─── toggleFormattingMarks ──────────────────────────────────────────
// Reads current `layoutEngineOptions.showFormattingMarks` and flips
// via `setShowFormattingMarks`. Zero-arg.
const _toggleFormattingMarksReturnOk: AssertEqual<ReturnType<SuperDoc['toggleFormattingMarks']>, void> = true;

// ─── toggleRuler ────────────────────────────────────────────────────
// Flips `config.rulers` and writes through to each RuntimeDocument's
// `rulers` mirror in the Pinia store. Throws (via `#requireSuperdocStore`)
// when called pre-ready.
const _toggleRulerReturnOk: AssertEqual<ReturnType<SuperDoc['toggleRuler']>, void> = true;

// ─── focus ──────────────────────────────────────────────────────────
// Focuses `activeEditor` if present; otherwise walks the document
// list and focuses the first editor found.
const _focusParamsOk: AssertEqual<
  Parameters<SuperDoc['focus']>,
  [options?: { readonly preventScroll?: boolean; readonly restoreSelection?: boolean }]
> = true;
const _focusReturnOk: AssertEqual<ReturnType<SuperDoc['focus']>, void> = true;
sd.focus({ preventScroll: true });
sd.focus({ restoreSelection: false });
sd.focus();

// ─── destroy ────────────────────────────────────────────────────────
// Tears down surfaces, toolbar, Vue app, collaboration, and the
// internal mount wrapper. Idempotent: marks `#destroyed` early so
// in-flight init bails out.
const _destroyReturnOk: AssertEqual<ReturnType<SuperDoc['destroy']>, void> = true;

// ─── element (getter) ───────────────────────────────────────────────
// Resolves `config.selector` to a DOM element. String selectors go
// through `document.querySelector` (`Element | null`); element
// references are returned as-is. Emitted return is `Element | null`.
const _elementOk: AssertEqual<SuperDoc['element'], Element | null> = true;

// ─── requiredNumberOfEditors (getter) ───────────────────────────────
// Count of DOCX documents in the Pinia store. Throws pre-ready.
const _requiredNumberOfEditorsOk: AssertEqual<SuperDoc['requiredNumberOfEditors'], number> = true;

void [
  _setMeasurementUnitParamsOk,
  _setMeasurementUnitReturnOk,
  _setZoomParamsOk,
  _setZoomReturnOk,
  _setHighContrastParamsOk,
  _setHighContrastReturnOk,
  _setShowBookmarksParamsOk,
  _setShowBookmarksReturnOk,
  _setShowFormattingMarksParamsOk,
  _setShowFormattingMarksReturnOk,
  _setDisableContextMenuParamsOk,
  _setDisableContextMenuReturnOk,
  _setTrackedChangesParamsOk,
  _setTrackedChangesReturnOk,
  _toggleFormattingMarksReturnOk,
  _toggleRulerReturnOk,
  _focusParamsOk,
  _focusReturnOk,
  _destroyReturnOk,
  _elementOk,
  _requiredNumberOfEditorsOk,
];
