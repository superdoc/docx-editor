import { defineSuperDocExtension } from 'superdoc';
import type { SuperDocExtension, SuperDocVisualHandle, SuperDocVisualTarget } from 'superdoc';
import type { BrowserDocumentApi, SelectionCapture, SelectionTarget, TextTarget } from 'superdoc/ui';
import './review-highlights.css';

const FINDING_NAMESPACE = 'urn:example:ai-review-findings:1';

export type ReviewFindingPayload = {
  kind: 'risk';
  question: string;
  quote: string;
  summary: string;
  suggestedText?: string;
  suggestionStatus?: 'pending' | 'created';
};

export type ReviewFinding = {
  anchorStatus: 'orphan' | 'resolved';
  id: string;
  /**
   * The activation that listed this row. Carried on the row itself so an immutable copy
   * (`{ ...finding }`) stays valid, while a row retained across a document swap does not —
   * a replacement DOCX can reuse metadata IDs, so the ID alone is not proof of provenance.
   */
  sourceToken: string;
  /**
   * The document binding that listed this row. `sourceToken` proves the activation, not the
   * document: `refresh()` can bind a different Editor's `doc` within one activation, and two
   * copies of a DOCX share metadata IDs.
   */
  documentEpoch: number;
  payload: ReviewFindingPayload;
  /** A tracked suggestion was created from this finding. */
  suggested: boolean;
};

export type BoundReviewSelection = {
  capture: SelectionCapture;
};

export type ReviewFindingsOptions = {
  /** Called with the current rows whenever an edit forces the findings to re-resolve. */
  onFindingsChanged?: (findings: readonly ReviewFinding[]) => void;
  /** Called when a re-resolve fails and the stale highlights have been cleared. */
  onFindingsError?: (error: unknown) => void;
};

type FindingActionResult = { success: true; id: string } | { success: false; message: string };
type AttachableCapture = SelectionCapture & { target: TextTarget };

/**
 * `ranges.resolve()` truncates its verification preview past this many UTF-16 units and sets
 * `preview.truncated`, which `suggest()` treats as unverifiable. Saving a longer capture would
 * strand a finding that can never be applied.
 */
const MAX_VERIFIABLE_CAPTURE_LENGTH = 200;

const SUPERSEDED_REFRESH = 'ReviewFindingsRefreshSuperseded';

/** A refresh another call or another document already owns. Safe for a caller to ignore. */
function supersededRefresh(message: string): Error {
  const error = new Error(message);
  error.name = SUPERSEDED_REFRESH;
  return error;
}

export function isSupersededRefresh(error: unknown): boolean {
  return error instanceof Error && error.name === SUPERSEDED_REFRESH;
}

const STALE_SELECTION_MESSAGE = 'The document changed after this text was selected. Select the text again.';
const STALE_FINDING_MESSAGE = 'The document changed after this finding was listed. Refresh the findings.';

function isReviewFindingPayload(value: unknown): value is ReviewFindingPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReviewFindingPayload>;
  return (
    candidate.kind === 'risk' &&
    typeof candidate.question === 'string' &&
    typeof candidate.quote === 'string' &&
    typeof candidate.summary === 'string' &&
    (candidate.suggestedText === undefined || typeof candidate.suggestedText === 'string') &&
    (candidate.suggestionStatus === undefined ||
      candidate.suggestionStatus === 'pending' ||
      candidate.suggestionStatus === 'created')
  );
}

function toSelectionTarget(target: SelectionTarget | TextTarget): SelectionTarget | null {
  if (target.kind === 'selection') return target.coordinateSpace === 'tracked' ? null : target;
  if (target.coordinateSpace === 'tracked' || target.segments.length === 0) return null;

  const first = target.segments[0];
  const last = target.segments[target.segments.length - 1];
  if (first.blockId !== last.blockId) return null;

  return {
    kind: 'selection',
    start: { kind: 'text', blockId: first.blockId, offset: first.range.start },
    end: { kind: 'text', blockId: last.blockId, offset: last.range.end },
    ...(target.story ? { story: target.story } : {}),
  };
}

function toVisualTargets(target: SelectionTarget | TextTarget): SuperDocVisualTarget[] {
  if (target.kind === 'text') {
    return target.segments.map((segment) => ({
      kind: 'text',
      blockId: segment.blockId,
      range: { start: segment.range.start, end: segment.range.end },
    }));
  }
  if (target.start.kind !== 'text' || target.end.kind !== 'text') return [];
  if (target.start.blockId !== target.end.blockId) return [];
  return [
    {
      kind: 'text',
      blockId: target.start.blockId,
      range: { start: target.start.offset, end: target.end.offset },
    },
  ];
}

function canAttach(capture: SelectionCapture | null | undefined): capture is AttachableCapture {
  const target = capture?.status === 'ready' ? capture.target : null;
  if (!target || target.coordinateSpace === 'tracked') return false;
  if (target.story !== undefined && target.story.storyType !== 'body') return false;
  if (!target.segments.every((segment) => segment.range.start < segment.range.end)) return false;
  // Save only what `suggest()` can act on. `toSelectionTarget()` rejects a target that
  // spans paragraphs, so accepting one here would persist a finding that can never be
  // suggested. It also rejects an empty segment list.
  if (toSelectionTarget(target) === null) return false;
  const length = target.segments.reduce((total, segment) => total + (segment.range.end - segment.range.start), 0);
  return length <= MAX_VERIFIABLE_CAPTURE_LENGTH;
}

export function createReviewFindings(options: ReviewFindingsOptions = {}) {
  let highlightLayer: SuperDocVisualHandle | null = null;
  const suggestedFindingIds = new Set<string>();
  const visualTargetsByFindingId = new Map<string, readonly SuperDocVisualTarget[]>();
  // A replacement document can reuse block IDs, so each action is bound to the extension activation that produced it
  // and to the document that activation last listed.
  // Disposal invalidates the checks before dispatch, but cannot cancel issued writes.
  // The application must await pending review actions before replacing the document.
  let activeSource: object | null = null;

  const sourceBindings = new WeakMap<object, object>();
  // Per-activation token stamped onto every listed row. Survives immutable copies and, unlike
  // the metadata ID, is not reused by a replacement document.
  let activeSourceToken = '';
  // A bound capture holds frozen block offsets. Any committed edit can move the text under
  // them, and the document identity does not change, so record the edit count at bind time
  // and refuse to attach across it.
  let mutationEpoch = 0;
  const boundMutationEpoch = new WeakMap<BoundReviewSelection, number>();
  // Only the newest refresh may publish. Two overlapping calls both pass the source check,
  // and the older one finishing last would otherwise restore its stale listing.
  let refreshSequence = 0;
  let lastRefreshedDoc: BrowserDocumentApi | null = null;
  // Increments whenever `refresh()` binds a different document. Stamped onto every listed row
  // and bound capture so work from an earlier binding fails its provenance check.
  let documentEpoch = 0;
  const boundDocumentEpoch = new WeakMap<BoundReviewSelection, number>();

  /**
   * One mutation refresh at a time, with at most one queued behind it. A typing burst
   * otherwise starts a listing plus a `get` and `resolve` per finding on every keystroke;
   * the sequence guard stops stale results publishing but cannot cancel the requests.
   */
  let mutationRefreshRunning = false;
  let mutationRefreshQueued = false;

  function runMutationRefresh(): void {
    const doc = lastRefreshedDoc;
    if (!doc) return;
    if (mutationRefreshRunning) {
      refreshSequence += 1;
      mutationRefreshQueued = true;
      return;
    }
    mutationRefreshRunning = true;
    void refresh(doc)
      .then(
        (findings) => options.onFindingsChanged?.(findings),
        (error) => {
          if (isSupersededRefresh(error)) return;
          options.onFindingsError?.(error);
        },
      )
      .finally(() => {
        mutationRefreshRunning = false;
        if (!mutationRefreshQueued) return;
        mutationRefreshQueued = false;
        runMutationRefresh();
      });
  }

  function paintFindings(layer = highlightLayer) {
    layer?.replace(
      [...visualTargetsByFindingId].flatMap(([id, targets]) => (suggestedFindingIds.has(id) ? [] : targets)),
    );
  }

  const extension: SuperDocExtension = defineSuperDocExtension({
    id: 'example.aiReviewFindings',
    activate(ctx) {
      const source = {};
      activeSource = source;
      suggestedFindingIds.clear();
      visualTargetsByFindingId.clear();
      // Unique across controller instances too: two Editors showing copies of the same DOCX
      // share metadata IDs, so a per-controller counter would collide on their first
      // activations.
      activeSourceToken = globalThis.crypto.randomUUID();
      lastRefreshedDoc = null;
      const layer = ctx.visuals.highlight('findings', {
        className: 'review-finding-highlight',
        scope: 'text',
      });
      highlightLayer = layer;
      ctx.disposables.add(layer);

      // Cached visual targets are numeric. An edit moves the durable metadata anchor but not
      // the paint, so re-resolve instead of leaving a highlight over different text.
      ctx.disposables.add(
        ctx.onMutation({ affects: ['text', 'block'] }, () => {
          mutationEpoch += 1;
          if (activeSource !== source) return;
          runMutationRefresh();
        }),
      );

      return {
        dispose() {
          if (activeSource === source) activeSource = null;
          if (highlightLayer === layer) highlightLayer = null;
        },
      };
    },
  });

  function bindSelection(capture: SelectionCapture): BoundReviewSelection | null {
    const source = activeSource;
    if (!source || !canAttach(capture)) return null;
    const selection = { capture } satisfies BoundReviewSelection;
    sourceBindings.set(selection, source);
    boundMutationEpoch.set(selection, mutationEpoch);
    boundDocumentEpoch.set(selection, documentEpoch);
    return selection;
  }

  function sourceIsCurrent(value: BoundReviewSelection | ReviewFinding, doc: BrowserDocumentApi) {
    if (activeSource === null) return false;
    // The application supplies `doc` on every call, so an action can arrive carrying a second
    // Editor's document. Copies of one DOCX reuse block IDs, so that target would resolve and
    // attach this finding to unrelated content. Once a refresh has named this activation's
    // document, refuse every other one; before that there is nothing to contradict.
    if (lastRefreshedDoc !== null && lastRefreshedDoc !== doc) return false;
    if ('sourceToken' in value) {
      return value.sourceToken === activeSourceToken && value.documentEpoch === documentEpoch;
    }
    return sourceBindings.get(value) === activeSource && boundDocumentEpoch.get(value) === documentEpoch;
  }

  function captureIsCurrent(value: BoundReviewSelection, doc: BrowserDocumentApi) {
    return sourceIsCurrent(value, doc) && boundMutationEpoch.get(value) === mutationEpoch;
  }

  async function refresh(doc: BrowserDocumentApi | null | undefined): Promise<readonly ReviewFinding[]> {
    const sequence = (refreshSequence += 1);
    // Rebinding is legitimate — a replacement document, or a swap racing an in-flight refresh —
    // but rows and captures from the previous binding must not survive it. The activation token
    // cannot see this: it is unchanged by a document swap within one activation.
    if ((doc ?? null) !== lastRefreshedDoc) documentEpoch += 1;
    lastRefreshedDoc = doc ?? null;
    if (!doc) {
      visualTargetsByFindingId.clear();
      suggestedFindingIds.clear();
      highlightLayer?.clear();
      return [];
    }

    const expectedSource = activeSource;
    const sourceToken = activeSourceToken;
    const epoch = documentEpoch;
    const layer = highlightLayer;
    try {
      const listed = await doc.metadata.list({ namespace: FINDING_NAMESPACE });
      const rows = await Promise.all(
        listed.items.map(async (item) => {
          const [record, resolved] = await Promise.all([
            doc.metadata.get({ id: item.id }),
            doc.metadata.resolve({ id: item.id }),
          ]);
          if (!record || !isReviewFindingPayload(record.payload)) return null;
          return {
            finding: {
              id: item.id,
              anchorStatus: item.anchorStatus,
              payload: record.payload,
              suggested: record.payload.suggestionStatus === 'created' || suggestedFindingIds.has(item.id),
              sourceToken,
              documentEpoch: epoch,
            } satisfies ReviewFinding,
            visualTargets: resolved ? toVisualTargets(resolved.target) : [],
          };
        }),
      );

      if (expectedSource !== activeSource || layer !== highlightLayer) {
        throw supersededRefresh('The document changed while its findings were loading. Refresh the findings again.');
      }
      if (sequence !== refreshSequence) {
        throw supersededRefresh('A newer refresh replaced this one. Render the newer result instead.');
      }

      visualTargetsByFindingId.clear();
      for (const row of rows) {
        if (row) visualTargetsByFindingId.set(row.finding.id, row.finding.suggested ? [] : row.visualTargets);
      }
      paintFindings(layer);
      return rows.flatMap((row) => {
        if (!row) return [];

        return [row.finding];
      });
    } catch (error) {
      if (isSupersededRefresh(error)) throw error;
      if (expectedSource !== activeSource || layer !== highlightLayer || sequence !== refreshSequence) {
        throw supersededRefresh('A newer document or refresh owns these findings.');
      }
      visualTargetsByFindingId.clear();
      paintFindings(layer);
      throw error;
    }
  }

  async function save(
    doc: BrowserDocumentApi | null | undefined,
    context: BoundReviewSelection | null,
    payload: Omit<ReviewFindingPayload, 'kind' | 'suggestionStatus'>,
  ): Promise<FindingActionResult> {
    const capture = context?.capture;
    if (!doc || !canAttach(capture) || !capture.target) {
      return {
        success: false,
        message: 'Select up to 200 characters inside one paragraph of plain body text before saving the finding.',
      };
    }
    if (!context || !captureIsCurrent(context, doc)) {
      return { success: false, message: STALE_SELECTION_MESSAGE };
    }

    try {
      const overlapping = await doc.metadata.list({ within: capture.target });
      if (!captureIsCurrent(context, doc)) {
        return { success: false, message: STALE_SELECTION_MESSAGE };
      }
      if (overlapping.items.length > 0) {
        return { success: false, message: 'That text already has an attached record.' };
      }

      // The record anchors to `capture.target`, so a quote that disagrees with the captured
      // text makes every later `suggest()` report a changed document and can never be applied.
      // Refuse it here rather than persisting a finding that is dead on arrival.
      if (payload.quote !== capture.quotedText) {
        return {
          success: false,
          message: 'The quote does not match the selected text. Save the finding from the current selection.',
        };
      }

      const receipt = await doc.metadata.attach(
        {
          namespace: FINDING_NAMESPACE,
          target: capture.target,
          payload: {
            kind: 'risk',
            question: payload.question,
            quote: payload.quote,
            summary: payload.summary,
            ...(payload.suggestedText !== undefined ? { suggestedText: payload.suggestedText } : {}),
          } satisfies ReviewFindingPayload,
        },
        { expectedRevision: overlapping.evaluatedRevision },
      );
      if (!receipt.success) return { success: false, message: receipt.failure.message };

      return { success: true, id: receipt.id };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async function suggest(
    doc: BrowserDocumentApi | null | undefined,
    finding: ReviewFinding,
  ): Promise<FindingActionResult> {
    if (!doc) return { success: false, message: 'The document is not ready.' };
    // `''` is a valid suggestion: it proposes deleting the anchored text. Only an absent
    // value means the finding carries no edit, which is how the payload type and `save()`
    // already treat it.
    if (finding.payload.suggestedText === undefined) {
      return { success: false, message: 'This finding does not include a suggested edit.' };
    }
    // A rendered row keeps its suggestedText after the tracked change is created, so a panel
    // that re-renders from `refresh()` would otherwise offer the action a second time.
    if (suggestedFindingIds.has(finding.id)) {
      return { success: false, message: 'This finding already has a tracked suggestion.' };
    }
    if (!sourceIsCurrent(finding, doc)) {
      return { success: false, message: STALE_FINDING_MESSAGE };
    }

    let releaseBeforeReplace: (() => Promise<void>) | undefined;
    try {
      const current = await doc.metadata.list({ namespace: FINDING_NAMESPACE });
      if (!sourceIsCurrent(finding, doc)) {
        return { success: false, message: STALE_FINDING_MESSAGE };
      }
      if (!current.items.some((item) => item.id === finding.id)) {
        return { success: false, message: 'That finding is no longer available.' };
      }

      // The panel row can predate another writer's update. `expectedRevision` accepts the
      // newer revision, so read the stored payload back rather than replacing with the
      // suggestion the panel happens to be holding.
      const [record, resolved] = await Promise.all([
        doc.metadata.get({ id: finding.id }),
        doc.metadata.resolve({ id: finding.id }),
      ]);
      if (!sourceIsCurrent(finding, doc)) {
        return { success: false, message: STALE_FINDING_MESSAGE };
      }
      if (!record || !isReviewFindingPayload(record.payload)) {
        return { success: false, message: 'That finding is no longer available.' };
      }
      if (record.payload.suggestionStatus) {
        return {
          success: false,
          message: 'A suggestion was already requested. Check the document before creating another.',
        };
      }
      const suggestedText = record.payload.suggestedText;
      if (suggestedText === undefined) {
        return { success: false, message: 'This finding no longer includes a suggested edit.' };
      }
      let target = resolved ? toSelectionTarget(resolved.target) : null;
      if (!target) {
        return { success: false, message: 'The finding is not anchored to one editable paragraph.' };
      }

      const releaseReservation = async () => {
        releaseBeforeReplace = undefined;
        if (!sourceIsCurrent(finding, doc)) return;
        const current = await doc.metadata.list({ namespace: FINDING_NAMESPACE });
        const latest = await doc.metadata.get({ id: finding.id });
        if (!sourceIsCurrent(finding, doc)) return;
        if (
          latest &&
          isReviewFindingPayload(latest.payload) &&
          latest.payload.suggestionStatus === 'pending' &&
          latest.payload.suggestedText === suggestedText
        ) {
          const payload = { ...latest.payload };
          delete payload.suggestionStatus;
          const released = await doc.metadata.update(
            { id: finding.id, payload },
            { expectedRevision: current.evaluatedRevision },
          );
          if (!released.success) throw new Error(released.failure.message);
        }
      };

      // Reserve the action durably before editing: an interrupted call must not become a retry after reopening.
      const reserved = await doc.metadata.update(
        { id: finding.id, payload: { ...record.payload, suggestionStatus: 'pending' } },
        { expectedRevision: current.evaluatedRevision },
      );
      if (!reserved.success) return { success: false, message: reserved.failure.message };
      releaseBeforeReplace = releaseReservation;
      if (!sourceIsCurrent(finding, doc)) return { success: false, message: STALE_FINDING_MESSAGE };
      const afterReservation = await doc.metadata.list({ namespace: FINDING_NAMESPACE });
      const pending = await doc.metadata.get({ id: finding.id });
      const currentAnchor = await doc.metadata.resolve({ id: finding.id });
      if (!sourceIsCurrent(finding, doc)) return { success: false, message: STALE_FINDING_MESSAGE };
      // The reservation only pins status. Another writer can still change the quote before
      // these reads, and the verification below compares against the pre-reservation quote,
      // so a mismatch here would apply an edit the stored finding no longer describes.
      if (
        !pending ||
        !isReviewFindingPayload(pending.payload) ||
        pending.payload.suggestionStatus !== 'pending' ||
        pending.payload.suggestedText !== suggestedText ||
        pending.payload.quote !== record.payload.quote
      ) {
        // A quote-only change leaves our reservation in place, so clear it or the finding stays
        // durably pending and its action stays disabled. releaseReservation() no-ops when the
        // pending row is no longer ours.
        await releaseReservation();
        return { success: false, message: 'The finding changed while requesting its suggestion. Check the document.' };
      }
      target = currentAnchor ? toSelectionTarget(currentAnchor.target) : null;
      if (!target) {
        await releaseReservation();
        return { success: false, message: 'The finding is no longer anchored to editable text.' };
      }
      const range = await doc.ranges.resolve({
        start: { kind: 'point', point: target.start },
        end: { kind: 'point', point: target.end },
        expectedRevision: afterReservation.evaluatedRevision,
      });
      if (!sourceIsCurrent(finding, doc)) return { success: false, message: STALE_FINDING_MESSAGE };
      if (range.preview.truncated || range.preview.text !== record.payload.quote) {
        await releaseReservation();
        return {
          success: false,
          message: range.preview.truncated
            ? 'The text is too long to verify. Ask AI about a shorter selection.'
            : 'The text changed since this finding was saved. Ask AI about the current text.',
        };
      }
      releaseBeforeReplace = undefined;
      const receipt = await doc.replace(
        { target, text: suggestedText },
        { changeMode: 'tracked', expectedRevision: afterReservation.evaluatedRevision },
      );
      if (!receipt.success) {
        await releaseReservation();
        return { success: false, message: receipt.failure?.message ?? 'The tracked suggestion could not be added.' };
      }

      if (!sourceIsCurrent(finding, doc)) return { success: false, message: STALE_FINDING_MESSAGE };
      const afterEdit = await doc.metadata.list({ namespace: FINDING_NAMESPACE });
      const latest = await doc.metadata.get({ id: finding.id });
      if (!sourceIsCurrent(finding, doc)) return { success: false, message: STALE_FINDING_MESSAGE };
      if (!latest || !isReviewFindingPayload(latest.payload)) {
        return { success: false, message: 'The edit was added, but its finding is no longer available.' };
      }
      // Promoting to `created` records which quote the tracked replacement came from, so a quote
      // rewritten between `doc.replace()` and this read must not be marked as its source.
      if (
        latest.payload.suggestionStatus !== 'pending' ||
        latest.payload.suggestedText !== suggestedText ||
        latest.payload.quote !== record.payload.quote
      ) {
        return { success: false, message: 'The edit was added, but the finding changed. Check the document.' };
      }
      const recorded = await doc.metadata.update(
        { id: finding.id, payload: { ...latest.payload, suggestionStatus: 'created' } },
        { expectedRevision: afterEdit.evaluatedRevision },
      );
      if (!recorded.success)
        return {
          success: false,
          message: 'The edit was added, but its status could not be saved. Check the document.',
        };
      if (!sourceIsCurrent(finding, doc)) return { success: false, message: STALE_FINDING_MESSAGE };
      suggestedFindingIds.add(finding.id);
      paintFindings();
      return { success: true, id: finding.id };
    } catch (error) {
      try {
        await releaseBeforeReplace?.();
      } catch {
        return {
          success: false,
          message: 'The suggestion was not sent, but its pending status could not be cleared. Check the document.',
        };
      }
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (sourceIsCurrent(finding, doc)) runMutationRefresh();
    }
  }

  async function remove(
    doc: BrowserDocumentApi | null | undefined,
    finding: ReviewFinding,
  ): Promise<FindingActionResult> {
    if (!doc) return { success: false, message: 'The document is not ready.' };
    if (!sourceIsCurrent(finding, doc)) {
      return { success: false, message: STALE_FINDING_MESSAGE };
    }

    try {
      const current = await doc.metadata.list({ namespace: FINDING_NAMESPACE });
      if (!sourceIsCurrent(finding, doc)) {
        return { success: false, message: STALE_FINDING_MESSAGE };
      }
      if (!current.items.some((item) => item.id === finding.id)) {
        return { success: false, message: 'That finding is no longer available.' };
      }

      const receipt = await doc.metadata.remove({ id: finding.id }, { expectedRevision: current.evaluatedRevision });
      if (!receipt.success) return { success: false, message: receipt.failure.message };

      suggestedFindingIds.delete(finding.id);
      visualTargetsByFindingId.delete(finding.id);
      paintFindings();
      return { success: true, id: receipt.id };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return { bindSelection, extension, refresh, remove, save, suggest };
}
