import type {
  HeaderFooterSlotAddress,
  SectionInfo,
  WatermarkInfo,
  WatermarksApplyInput,
  RetainedPictureWatermarkInput,
  WatermarkInput,
} from '@superdoc/document-api';
import type { SurfaceHandle, SurfaceRequest } from '../../core/types/index.js';
import { createWatermarkSurfaceRuntime } from '../../components/surfaces/watermark-surface-runtime.js';
import type { BrowserDocumentApi } from '../browser-document-api.js';
import type { FontFamilyOption, WatermarkHandle, WorkflowActionResult } from './types.js';
import type {
  WatermarkDialogModel,
  WatermarkDialogSnapshot,
  WatermarkPageVariant,
  WatermarkPreview,
} from './watermark-dialog-state.js';
import {
  createWatermarkDraft,
  getWatermarkDraftError,
  patchWatermarkDraft,
  toWatermarkInput,
} from './watermark-draft.js';

interface WatermarkEditor {
  doc: Pick<BrowserDocumentApi, 'watermarks' | 'sections'>;
  host?: {
    watermarkPreview?(input: {
      watermark: WatermarkInput | RetainedPictureWatermarkInput;
      sectionId?: string;
      expectedRevision?: string;
    }): Promise<WatermarkPreview>;
    events?: { subscribe(listener: (event: { type: string }) => void): () => void };
  };
}

interface WatermarkControllerOptions {
  getEditor(): WatermarkEditor | null;
  getMode(): string | null;
  getFonts(): readonly FontFamilyOption[];
  getContainer?(): HTMLElement | null;
  openSurface: ((request: SurfaceRequest) => SurfaceHandle) | null;
  announce?(message: string): void;
}

const PAGE_TYPES = { default: 'Default pages', first: 'First page', even: 'Even pages' };
const STALE_MESSAGE = 'The document changed while this dialog was open. Review the latest watermark before applying.';

function scopeSlots(
  sections: SectionInfo[],
  sectionId: string | null,
  variant: WatermarkPageVariant,
): HeaderFooterSlotAddress[] {
  return sections
    .filter((section) => sectionId == null || section.address.sectionId === sectionId)
    .flatMap((section) => {
      const variants: HeaderFooterSlotAddress['variant'][] =
        variant === 'all'
          ? [
              'default',
              ...(section.titlePage ? ['first' as const] : []),
              ...(section.oddEvenHeadersFooters ? ['even' as const] : []),
            ]
          : [variant];
      return variants.map((variant) => ({
        kind: 'headerFooterSlot' as const,
        section: section.address,
        headerFooterKind: 'header' as const,
        variant,
      }));
    });
}

function slotKey(slot: HeaderFooterSlotAddress): string {
  return `${slot.section.sectionId}:${slot.variant}`;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The watermark could not be updated. Try again.';
}

export function createWatermarkController(options: WatermarkControllerOptions): WatermarkHandle & { destroy(): void } {
  const surface = createWatermarkSurfaceRuntime(options.getContainer);
  const workflowOptions = {
    ...options,
    announce: (message: string) => {
      surface.announce(message);
      options.announce?.(message);
    },
  };
  let active: { handle: SurfaceHandle; dispose(): void } | null = null;
  let destroyed = false;
  let openGeneration = 0;

  function close(): void {
    const previous = active;
    active = null;
    previous?.dispose();
    previous?.handle.close();
  }

  function open(): WorkflowActionResult {
    if (destroyed) return { ok: false, reason: 'not-ready' };
    const editor = options.getEditor();
    if (!editor) return { ok: false, reason: 'not-ready' };
    if (!editor.doc?.watermarks?.list || !editor.doc.sections?.list)
      return { ok: false, reason: 'document-api-unavailable' };
    if (!options.openSurface || !editor.doc.watermarks.apply || !editor.host?.watermarkPreview) {
      return { ok: false, reason: 'operation-unavailable' };
    }
    const generation = ++openGeneration;
    const restoreFocus = surface.captureFocusReturn();
    close();
    surface.mount();
    const workflow = createDialogWorkflow(editor, workflowOptions, () => {
      if (active?.handle === handle) close();
    });
    let handle: SurfaceHandle;
    try {
      handle = options.openSurface({
        mode: 'dialog',
        ariaLabel: 'Watermark',
        component: surface.component,
        props: { model: workflow.model },
        dialog: { maxWidth: 700 },
      });
    } catch {
      workflow.dispose();
      return { ok: false, reason: 'operation-unavailable' };
    }
    active = { handle, dispose: workflow.dispose };
    void handle.result.then((outcome) => {
      workflow.dispose();
      if (active?.handle === handle) active = null;
      if (outcome.status === 'closed' || outcome.status === 'submitted') {
        void restoreFocus(() => !destroyed && generation === openGeneration && active === null);
      }
    });
    void workflow.model.reload();
    return { ok: true };
  }

  return {
    open,
    close,
    destroy() {
      destroyed = true;
      close();
      surface.destroy();
    },
  };
}

function createDialogWorkflow(editor: WatermarkEditor, options: WatermarkControllerOptions, onSuccess: () => void) {
  const listeners = new Set<(snapshot: WatermarkDialogSnapshot) => void>();
  let alive = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let catalog: WatermarkInfo[] = [];
  let sections: SectionInfo[] = [];
  let revision = '';
  let originalDraft = JSON.stringify(createWatermarkDraft());
  let preparedInput: WatermarksApplyInput | null = null;
  let snapshot: WatermarkDialogSnapshot = {
    phase: 'loading',
    draft: createWatermarkDraft(),
    sections: [],
    sectionId: null,
    variant: 'all',
    items: [],
    selectedIds: [],
    fonts: [...options.getFonts()],
    dirty: false,
    canApply: false,
    error: null,
    stale: false,
    readonlyReason: null,
    impact: '',
    impactDetails: [],
    preview: null,
  };

  const current = (token: number) => alive && token === generation && options.getEditor() === editor;
  const editable = () => options.getMode() === 'editing';
  function publish(patch: Partial<WatermarkDialogSnapshot>): void {
    if (!alive) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  }
  function invalidate(): number {
    clearTimeout(timer);
    preparedInput = null;
    return ++generation;
  }
  function location(slot: HeaderFooterSlotAddress): string {
    const section = sections.find((item) => item.address.sectionId === slot.section.sectionId);
    const inactive =
      slot.variant === 'first'
        ? !section?.titlePage
        : slot.variant === 'even'
          ? !section?.oddEvenHeadersFooters
          : false;
    return `Section ${(section?.index ?? 0) + 1}, ${PAGE_TYPES[slot.variant].toLowerCase()}${inactive ? ' (inactive)' : ''}`;
  }
  function scopedItems(): WatermarkInfo[] {
    if (snapshot.sectionId == null && snapshot.variant === 'all') return catalog;
    const keys = new Set(scopeSlots(sections, snapshot.sectionId, snapshot.variant).map(slotKey));
    return catalog.filter((item) => item.effectiveIn.some((slot) => keys.has(slotKey(slot))));
  }
  function publishCatalog(): void {
    publish({
      items: scopedItems().map((item) => ({
        id: item.watermarkId,
        label: item.watermark.kind === 'text' ? item.watermark.text : 'Picture watermark',
        locations: item.effectiveIn.map(location).join('; '),
      })),
    });
  }
  function buildInput(): WatermarksApplyInput {
    const target =
      snapshot.sectionId == null && snapshot.variant === 'all'
        ? { kind: 'document' as const }
        : { kind: 'headerFooterSlots' as const, slots: scopeSlots(sections, snapshot.sectionId, snapshot.variant) };
    if (snapshot.draft.kind === 'none') return { target, action: 'remove', watermarkIds: snapshot.selectedIds };
    const watermark = toWatermarkInput(snapshot.draft);
    if (snapshot.selectedIds.length)
      return { target, action: 'replace', watermarkIds: snapshot.selectedIds, watermark };
    if ('source' in watermark)
      throw new Error('Select the existing picture watermark in this scope, or choose a new picture.');
    return { target, action: 'insert', watermark };
  }
  function rejectReceipt(result: { success: boolean; failure?: { code?: string; message?: string } }): boolean {
    if (result.success) return false;
    const stale = result.failure?.code === 'REVISION_MISMATCH';
    publish({
      stale,
      phase: 'editing',
      canApply: false,
      error: stale ? STALE_MESSAGE : (result.failure?.message ?? 'The watermark could not be updated.'),
    });
    return true;
  }
  async function prepare(token: number): Promise<void> {
    try {
      const error = getWatermarkDraftError(snapshot.draft);
      if (error) {
        publish({ phase: 'editing', error, canApply: false, preview: null });
        return;
      }
      const input = snapshot.draft.kind === 'none' && !snapshot.selectedIds.length ? null : buildInput();
      const preview =
        snapshot.draft.kind === 'none'
          ? null
          : await editor.host!.watermarkPreview!({
              watermark: toWatermarkInput(snapshot.draft),
              sectionId: snapshot.sectionId ?? sections[0]?.address.sectionId,
              expectedRevision: revision,
            });
      if (!current(token)) return;
      if (!input || !snapshot.dirty || !editable()) {
        publish({ phase: 'editing', preview, canApply: false, error: null });
        return;
      }
      const receipt = await editor.doc.watermarks.apply(input, { expectedRevision: revision, dryRun: true });
      if (!current(token)) return;
      if (!receipt.success) {
        rejectReceipt(receipt);
        return;
      }
      preparedInput = input;
      const affected = receipt.affectedSlots.map(location);
      publish({
        phase: 'editing',
        preview,
        error: null,
        canApply: affected.length > 0 && !snapshot.stale && editable(),
        impact: affected.length
          ? `Changes: ${affected.length > 3 ? `${affected.length} page locations` : affected.join('; ')}. Other locations stay as they are.`
          : 'No matching watermark will change.',
        impactDetails: affected.length > 3 ? affected : [],
      });
    } catch (error) {
      if (current(token)) publish({ phase: 'editing', error: failureMessage(error), canApply: false, preview: null });
    }
  }
  function schedulePreview(): void {
    const token = invalidate();
    publish({ phase: 'previewing', canApply: false, error: null, impact: '', impactDetails: [], preview: null });
    timer = setTimeout(() => {
      void prepare(token);
    }, 120);
  }

  const model: WatermarkDialogModel = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    async reload() {
      const token = invalidate();
      publish({ phase: 'loading', canApply: false, stale: false, error: null, impactDetails: [], preview: null });
      try {
        const [marks, sectionList] = await Promise.all([editor.doc.watermarks.list(), editor.doc.sections.list()]);
        if (!current(token)) return;
        if (marks.items.length !== marks.total || sectionList.items.length !== sectionList.total)
          throw new Error('The complete watermark scope could not be loaded.');
        if (sectionList.evaluatedRevision && sectionList.evaluatedRevision !== marks.evaluatedRevision)
          throw new Error(STALE_MESSAGE);
        catalog = marks.items;
        sections = sectionList.items;
        revision = marks.evaluatedRevision;
        const available = scopedItems();
        const selected = available.length === 1 ? available[0] : undefined;
        const draft = createWatermarkDraft(selected);
        originalDraft = JSON.stringify(draft);
        publish({
          draft,
          dirty: false,
          selectedIds: selected ? [selected.watermarkId] : [],
          sections: sections.map((item) => ({ id: item.address.sectionId, label: `Section ${item.index + 1}` })),
          readonlyReason: editable()
            ? null
            : options.getMode() === 'suggesting'
              ? 'Watermarks cannot be changed in Suggesting mode.'
              : 'This document is read-only.',
          impact: available.length > 1 ? 'Select the watermark copies you want to edit, or add a new watermark.' : '',
        });
        publishCatalog();
        await prepare(token);
      } catch (error) {
        if (current(token)) publish({ phase: 'editing', error: failureMessage(error), canApply: false });
      }
    },
    patchDraft(patch) {
      if (!alive || snapshot.phase === 'loading' || snapshot.phase === 'applying' || !editable()) return;
      const draft = patchWatermarkDraft(snapshot.draft, patch);
      publish({ draft, dirty: JSON.stringify(draft) !== originalDraft });
      schedulePreview();
    },
    setScope(sectionId, variant) {
      if (!alive || snapshot.phase === 'loading' || snapshot.phase === 'applying') return;
      if (sectionId != null && !sections.some((item) => item.address.sectionId === sectionId)) return;
      publish({ sectionId, variant });
      publishCatalog();
      const available = scopedItems();
      const visible = new Set(available.map((item) => item.watermarkId));
      let selectedIds = snapshot.selectedIds.filter((id) => visible.has(id));
      if (snapshot.dirty && snapshot.draft.kind === 'none' && !selectedIds.length && available.length === 1) {
        selectedIds = [available[0].watermarkId];
      }
      publish({ selectedIds });
      if (!snapshot.dirty) {
        model.selectWatermarks(available.length === 1 ? [available[0].watermarkId] : []);
      } else schedulePreview();
    },
    selectWatermarks(ids) {
      if (!alive || snapshot.phase === 'loading' || snapshot.phase === 'applying') return;
      const available = scopedItems();
      const selectedIds = [...new Set(ids)].filter((id) => available.some((item) => item.watermarkId === id));
      const draft = createWatermarkDraft(available.find((item) => item.watermarkId === selectedIds[0]));
      originalDraft = JSON.stringify(draft);
      publish({ selectedIds, draft, dirty: false });
      schedulePreview();
    },
    async apply() {
      if (!alive || !snapshot.canApply || !preparedInput || !editable() || options.getEditor() !== editor) return;
      const input = preparedInput;
      const token = invalidate();
      publish({ phase: 'applying', canApply: false, error: null });
      options.announce?.('Applying watermark changes. Closing the dialog will not cancel them.');
      try {
        const receipt = await editor.doc.watermarks.apply(input, { expectedRevision: revision });
        // Closing a submitted operation cannot undo it. Settle its outcome on the original document.
        if (!current(token)) {
          options.announce?.(receipt.success ? 'Watermark updated.' : 'The watermark could not be updated.');
          return;
        }
        if (rejectReceipt(receipt)) return;
        options.announce?.(input.action === 'remove' ? 'Watermark removed.' : 'Watermark updated.');
        onSuccess();
      } catch (error) {
        if (current(token)) publish({ phase: 'editing', error: failureMessage(error), canApply: false });
        else options.announce?.(failureMessage(error));
      }
    },
  };

  const stopEvents = editor.host?.events?.subscribe((event) => {
    if (!alive || snapshot.phase === 'applying') return;
    if (event.type === 'collaboration:document-replaced') {
      invalidate();
      publish({ phase: 'editing', stale: true, canApply: false, error: STALE_MESSAGE });
      return;
    }
    if (!['document:mutated', 'mutation:committed', 'collaboration:remote-changed'].includes(event.type)) return;
    invalidate();
    if (snapshot.dirty) publish({ phase: 'editing', stale: true, canApply: false, error: STALE_MESSAGE });
    else
      timer = setTimeout(() => {
        void model.reload();
      }, 120);
  });
  return {
    model,
    dispose() {
      alive = false;
      invalidate();
      stopEvents?.();
      listeners.clear();
    },
  };
}
