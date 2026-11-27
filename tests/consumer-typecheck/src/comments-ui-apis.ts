/**
 * Consumer typecheck: comments UI helpers on `SuperDoc`.
 *
 * Locks the `addCommentsList`, `removeCommentsList`, and
 * `scrollToComment` contracts against the emitted `.d.ts` with strict
 * identity equality. A future migration that narrows or widens any
 * of these signatures will fail the obligation diff rather than
 * slipping past CI.
 *
 * One JSDoc-level cleanup landed alongside this fixture:
 *
 *   - `addCommentsList`'s JSDoc said `@param {Element}`, while the
 *     TS signature is `HTMLElement` (the narrower, more accurate
 *     type - the runtime stores the element on the comments module
 *     config and the comments UI relies on the HTML element shape).
 *     Updated the JSDoc to `@param {HTMLElement}` so doc and signature
 *     agree. No runtime behavior change.
 *
 * Drained obligations (5):
 *   - addCommentsList:parameters / addCommentsList:returns
 *   - removeCommentsList:returns
 *   - scrollToComment:parameters / scrollToComment:returns
 */
import type { Config, SuperDoc } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

declare const sd: SuperDoc;
declare const hostElement: HTMLElement;

// ─── comments module review policy ──────────────────────────────────
// These named fields must remain boolean rather than falling through the
// module's open pass-through config signature as `unknown`.
type CommentsModuleConfig = Exclude<NonNullable<NonNullable<Config['modules']>['comments']>, false>;
const _readOnlyTypeOk: AssertEqual<CommentsModuleConfig['readOnly'], boolean | undefined> = true;
const _allowResolveTypeOk: AssertEqual<CommentsModuleConfig['allowResolve'], boolean | undefined> = true;
const _readOnlyConfig: Config = {
  selector: '#editor',
  modules: { comments: { readOnly: true, allowResolve: false } },
};

// ─── addCommentsList ────────────────────────────────────────────────
// Mounts the comments side panel into the consumer-provided host
// element. Returns false, mounting nothing, when the comments module is
// disabled or role is `viewer`.
const _addCommentsListParamsOk: AssertEqual<Parameters<SuperDoc['addCommentsList']>, [element: HTMLElement]> = true;
const _addCommentsListReturnOk: AssertEqual<ReturnType<SuperDoc['addCommentsList']>, boolean> = true;
const _mounted: boolean = sd.addCommentsList(hostElement);
void _mounted;

// ─── removeCommentsList ─────────────────────────────────────────────
// Tears down the comments side panel mounted by `addCommentsList`.
// No-op when no list was mounted.
const _removeCommentsListReturnOk: AssertEqual<ReturnType<SuperDoc['removeCommentsList']>, void> = true;

// ─── scrollToComment ────────────────────────────────────────────────
// Scrolls the document to the DOM node carrying the given comment id
// and activates the comment. Returns false on missing module, empty
// id, or no matching element; otherwise true after triggering
// scrollIntoView. Options forward to ScrollIntoViewOptions.
type ScrollOpts = {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
};
const _scrollToCommentParamsOk: AssertEqual<
  Parameters<SuperDoc['scrollToComment']>,
  [commentId: string, options?: ScrollOpts]
> = true;
const _scrollToCommentReturnOk: AssertEqual<ReturnType<SuperDoc['scrollToComment']>, boolean> = true;
const _scrolled: boolean = sd.scrollToComment('comment-1', { behavior: 'smooth', block: 'center' });
void _scrolled;
const _scrolledNoOpts: boolean = sd.scrollToComment('comment-2');
void _scrolledNoOpts;

void [
  _addCommentsListParamsOk,
  _addCommentsListReturnOk,
  _removeCommentsListReturnOk,
  _scrollToCommentParamsOk,
  _scrollToCommentReturnOk,
  _readOnlyTypeOk,
  _allowResolveTypeOk,
  _readOnlyConfig,
];
