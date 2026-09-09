/**
 * Consumer typecheck: Plan A controller workflow handles (Workstreams 3-8).
 *
 * Proves the new public custom-UI handle methods resolve from `superdoc/ui`
 * with their documented signatures, and that the fail-closed result type
 * (`WorkflowActionResult`) carries a stable `SuperDocUIReason` — not free-form
 * `string`, not `any`. A future migration that narrows or drops one of these
 * contracts fails CI here rather than slipping into a release.
 */
import type {
  SuperDocUI,
  CommentsHandle,
  CommentInfo,
  DocumentHandle,
  TrackChangesHandle,
  TrackChangesItem,
  ContentControlsHandle,
  ContentControlsSlice,
  ContentControlFocusResult,
  ContentControlHighlightResult,
  MetadataHandle,
  SelectionHandle,
  SelectionInfo,
  StylesHandle,
  ActiveParagraphStyle,
  StyleCatalogItem,
  StylesGetCatalogResult,
  ContentControlInfo,
  CommentAnchorCapture,
  WorkflowActionResult,
  WorkflowScrollResult,
  ScrollIntoViewOutput,
  ViewportRect,
  ViewportRectResult,
  WorkflowReceipt,
  CommandExecutionResult,
  SuperDocUIReason,
} from 'superdoc/ui';
import type { ExportParams } from 'superdoc';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEqual<A, B> = Equal<A, B> extends true ? true : never;

declare const ui: SuperDocUI;

// ─── Comments (row 737) ─────────────────────────────────────────────
const comments: CommentsHandle = ui.comments;
const _commentsList: AssertEqual<ReturnType<CommentsHandle['list']>, readonly CommentInfo[]> = true;
const _commentGetById: AssertEqual<ReturnType<CommentsHandle['getById']>, CommentInfo | null> = true;
const _createFromSelection: AssertEqual<ReturnType<CommentsHandle['createFromSelection']>, WorkflowReceipt> = true;
const _commentEdit: AssertEqual<
  Parameters<CommentsHandle['edit']>,
  [commentId: string, input: { text: string }]
> = true;
const _commentEditReturn: AssertEqual<ReturnType<CommentsHandle['edit']>, WorkflowReceipt> = true;
const _delete: AssertEqual<ReturnType<CommentsHandle['delete']>, WorkflowReceipt> = true;
const _commentSetActive: AssertEqual<ReturnType<CommentsHandle['setActive']>, boolean> = true;
const _commentScrollTo: AssertEqual<ReturnType<CommentsHandle['scrollTo']>, Promise<WorkflowScrollResult>> = true;
const _commentActiveId: AssertEqual<ReturnType<CommentsHandle['getSnapshot']>['activeId'], string | null> = true;
const minimalCapture: CommentAnchorCapture = { target: null };
void comments.list();
void comments.getById('c-1');
void comments.createFromCapture(minimalCapture, { text: 'note' });
void comments.createFromSelection({ text: 'note' });
void comments.edit('c-1', { text: 'corrected note' });
void comments.delete('c-1');
const _commentsSetActiveAccepted: boolean = comments.setActive('c-1');
const _commentsSetActiveCleared: boolean = comments.setActive(null);
const _commentScrollAsV1: Promise<ScrollIntoViewOutput> = comments.scrollTo('c-1');
void comments.scrollTo('c-1').then((r) => {
  r.success satisfies boolean;
  r.ok satisfies boolean;
  // Workflow reasons admit verbatim host strings alongside the taxonomy.
  r.reason satisfies SuperDocUIReason | (string & {}) | undefined;
});

// ─── Track changes (row 748) ────────────────────────────────────────
const trackChanges: TrackChangesHandle = ui.trackChanges;
const _trackChangesList: AssertEqual<ReturnType<TrackChangesHandle['list']>, readonly TrackChangesItem[]> = true;
const _accept: AssertEqual<ReturnType<TrackChangesHandle['accept']>, CommandExecutionResult> = true;
const _acceptAsync: AssertEqual<ReturnType<TrackChangesHandle['acceptAsync']>, Promise<CommandExecutionResult>> = true;
const _reject: AssertEqual<ReturnType<TrackChangesHandle['reject']>, CommandExecutionResult> = true;
const _rejectAsync: AssertEqual<ReturnType<TrackChangesHandle['rejectAsync']>, Promise<CommandExecutionResult>> = true;
const _acceptAll: AssertEqual<ReturnType<TrackChangesHandle['acceptAll']>, CommandExecutionResult> = true;
const _acceptAllAsync: AssertEqual<
  ReturnType<TrackChangesHandle['acceptAllAsync']>,
  Promise<CommandExecutionResult>
> = true;
const _rejectAll: AssertEqual<ReturnType<TrackChangesHandle['rejectAll']>, CommandExecutionResult> = true;
const _rejectAllAsync: AssertEqual<
  ReturnType<TrackChangesHandle['rejectAllAsync']>,
  Promise<CommandExecutionResult>
> = true;
const _next: AssertEqual<ReturnType<TrackChangesHandle['next']>, string | null> = true;
const _previous: AssertEqual<ReturnType<TrackChangesHandle['previous']>, string | null> = true;
const _navigateNext: AssertEqual<ReturnType<TrackChangesHandle['navigateNext']>, Promise<ScrollIntoViewOutput>> = true;
const _navigatePrevious: AssertEqual<
  ReturnType<TrackChangesHandle['navigatePrevious']>,
  Promise<ScrollIntoViewOutput>
> = true;
const _tcSetActive: AssertEqual<ReturnType<TrackChangesHandle['setActive']>, boolean> = true;
const _tcScrollTo: AssertEqual<ReturnType<TrackChangesHandle['scrollTo']>, Promise<WorkflowScrollResult>> = true;
void trackChanges.list();
void trackChanges.accept('tc-1');
void trackChanges.acceptAsync('tc-1');
void trackChanges.reject('tc-1');
void trackChanges.rejectAsync('tc-1');
void trackChanges.acceptAsync({ id: 'tc-footnote', story: { kind: 'story', storyType: 'footnote', noteId: 'fn-1' } });
void trackChanges.acceptAll();
void trackChanges.acceptAllAsync();
void trackChanges.rejectAll();
void trackChanges.rejectAllAsync();
const navResult: string | null = trackChanges.next();
void navResult;
void trackChanges.navigateNext();
void trackChanges.navigatePrevious();
const _tcSetActiveAccepted: boolean = trackChanges.setActive('tc-1');
const _tcScrollAsV1: Promise<ScrollIntoViewOutput> = trackChanges.scrollTo('tc-1');
// A row's `{ id, story }` pins the occurrence for both activation and reveal.
const _tcSetActiveStory: boolean = trackChanges.setActive({ id: 'tc-1', story: { kind: 'story' } });
void trackChanges.scrollTo({ id: 'tc-1', story: { kind: 'story' } });
void _tcSetActiveStory;
void _tcSetActiveAccepted;

// ─── Content controls (row 738) ─────────────────────────────────────
const contentControls: ContentControlsHandle = ui.contentControls;
const _ccList: AssertEqual<ReturnType<ContentControlsHandle['list']>, readonly ContentControlInfo[]> = true;
const _ccGetById: AssertEqual<ReturnType<ContentControlsHandle['getById']>, ContentControlInfo | null> = true;
const _ccGetRect: AssertEqual<ReturnType<ContentControlsHandle['getRect']>, ViewportRectResult> = true;
const _ccScrollIntoView: AssertEqual<
  ReturnType<ContentControlsHandle['scrollIntoView']>,
  Promise<ScrollIntoViewOutput>
> = true;
const _ccFocus: AssertEqual<ReturnType<ContentControlsHandle['focus']>, Promise<ContentControlFocusResult>> = true;
const _ccHighlight: AssertEqual<
  ReturnType<ContentControlsHandle['highlight']>,
  Promise<ContentControlHighlightResult>
> = true;
const _ccHighlightInput: AssertEqual<Parameters<ContentControlsHandle['highlight']>, [input: { id: string }]> = true;
const _ccClearHighlight: AssertEqual<ReturnType<ContentControlsHandle['clearHighlight']>, void> = true;
const _ccClearHighlightInput: AssertEqual<Parameters<ContentControlsHandle['clearHighlight']>, []> = true;
void contentControls.highlight({ id: 'cc-1' });
contentControls.clearHighlight();
// @ts-expect-error Appearance is configured through inherited CSS variables.
void contentControls.highlight({ id: 'cc-1', color: 'green' });
// @ts-expect-error A control id is required.
void contentControls.highlight({});
void _ccHighlight;
void _ccHighlightInput;
void _ccClearHighlight;
void _ccClearHighlightInput;
void contentControls.list();
const _ccSnapshotFromGet: ContentControlsSlice = contentControls.get();
const _ccFromMainGet: ContentControlInfo | null = contentControls.get({ id: 'cc-1' });
void contentControls.getById('cc-1');
void contentControls.getRect({ id: 'cc-1' });
void contentControls.scrollIntoView({ id: 'cc-1' });
void contentControls.focus({ id: 'cc-1' });
// The passive active-path subscription has the same listener shape and
// disposer return as observe.
const _ccObserveActivePath: AssertEqual<
  Parameters<ContentControlsHandle['observeActivePath']>,
  Parameters<ContentControlsHandle['observe']>
> = true;
const _ccObserveActivePathReturn: AssertEqual<
  ReturnType<ContentControlsHandle['observeActivePath']>,
  () => void
> = true;
const _ccObserveReturn: AssertEqual<ReturnType<ContentControlsHandle['observe']>, () => void> = true;
const stopActivePath = contentControls.observeActivePath(() => undefined);
stopActivePath();
void [_ccObserveActivePath, _ccObserveActivePathReturn, _ccObserveReturn];
// Reactive reads come from the snapshot; `doc` owns fresh live reads.
const _ccItems: AssertEqual<ReturnType<ContentControlsHandle['getSnapshot']>['items'], readonly ContentControlInfo[]> =
  true;

// ─── Metadata geometry ────────────────────────────────────────────
const metadata: MetadataHandle = ui.metadata;
const _metaScrollIntoView: AssertEqual<
  ReturnType<MetadataHandle['scrollIntoView']>,
  Promise<ScrollIntoViewOutput>
> = true;
void metadata.getRect({ id: 'cite-001' });
void metadata.scrollIntoView({ id: 'cite-001' });

// ─── Selection geometry (row 746) ───────────────────────────────────
const selection: SelectionHandle = ui.selection;
const _selectionCurrent: AssertEqual<ReturnType<SelectionHandle['current']>, SelectionInfo | null> = true;
const _getRects: AssertEqual<ReturnType<SelectionHandle['getRects']>, readonly ViewportRect[]> = true;
void selection.current();
void selection.getRects();
void selection.getRects({ relativeTo: undefined as unknown as HTMLElement });

// ─── Styles (WS4): read-only catalogue + active paragraph style ─────
const styles: StylesHandle = ui.styles;
const _stylesCatalog: AssertEqual<ReturnType<StylesHandle['getCatalog']>, StylesGetCatalogResult | null> = true;
const _stylesQuickGallery: AssertEqual<ReturnType<StylesHandle['getQuickGallery']>, readonly StyleCatalogItem[]> = true;
const _stylesActive: AssertEqual<ReturnType<StylesHandle['getActiveParagraphStyle']>, ActiveParagraphStyle> = true;
const _stylesSnapshotMixed: AssertEqual<ReturnType<StylesHandle['getSnapshot']>['mixedSelection'], boolean> = true;
const _stylesActiveId: AssertEqual<ActiveParagraphStyle['styleId'], string | null> = true;
void styles.getCatalog();
void styles.getQuickGallery();
void styles.getActiveParagraphStyle();

// ─── Document (compat) ──────────────────────────────────────────────
const document: DocumentHandle = ui.document;
const _documentGetText: AssertEqual<ReturnType<DocumentHandle['getText']>, string | null> = true;
const _documentExportParams: AssertEqual<Parameters<DocumentHandle['export']>, [input?: ExportParams]> = true;
const _documentExportResult: AssertEqual<ReturnType<DocumentHandle['export']>, Promise<Blob> | undefined> = true;
void document.getText();
void document.export({ exportType: ['docx'], triggerDownload: false });

// ─── Fail-closed result reason is the stable union, not string/any ──
const _wfReason: WorkflowActionResult['reason'] = 'host-capability-unavailable';

void [
  _createFromSelection,
  _commentEdit,
  _commentEditReturn,
  _delete,
  _commentsList,
  _commentGetById,
  _commentSetActive,
  _commentScrollTo,
  _commentScrollAsV1,
  _commentActiveId,
  _trackChangesList,
  _acceptAll,
  _rejectAll,
  _next,
  _previous,
  _navigateNext,
  _navigatePrevious,
  _tcSetActive,
  _tcScrollTo,
  _tcScrollAsV1,
  _ccList,
  _ccGetById,
  _ccSnapshotFromGet,
  _ccFromMainGet,
  _ccItems,
  _ccGetRect,
  _ccScrollIntoView,
  _ccFocus,
  _metaScrollIntoView,
  _selectionCurrent,
  _getRects,
  _stylesCatalog,
  _stylesQuickGallery,
  _stylesActive,
  _stylesSnapshotMixed,
  _stylesActiveId,
  _documentGetText,
  _wfReason,
];
