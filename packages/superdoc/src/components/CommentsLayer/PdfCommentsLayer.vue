<script setup lang="ts">
/**
 * PdfCommentsLayer
 *
 * PDF-scoped on-document comment anchor overlay. Renders a persistent,
 * clickable `.sd-comment-anchor.sd-highlight` for every unresolved PDF comment
 * that carries finite selection bounds, so a submitted PDF comment leaves a
 * durable marker the user can click to reopen the thread.
 *
 * Scope boundary (SD-3497): this layer intentionally renders ONLY PDF
 * (`selection.source === 'pdf'`) comments that belong to a currently open PDF
 * document. DOCX v2 comments stay on the v2 geometry / FloatingComments path and
 * must never render here, and this layer never recreates the legacy v1
 * on-document DOCX comment markers.
 */
import { computed } from 'vue';
import type { CSSProperties } from 'vue';
import { storeToRefs } from 'pinia';
import { PDF } from '@superdoc/common';
import type { SuperDoc } from '../../core/SuperDoc.js';
import { useSuperDocInstance } from '../../composables/use-superdoc-instance';
import { useCommentsStore } from '../../stores/comments-store';
import { useSuperdocStore } from '../../stores/superdoc-store';

type BoundValue = number | string | null | undefined;

type PdfSelectionBounds = { top?: BoundValue; left?: BoundValue; right?: BoundValue; bottom?: BoundValue };

type FiniteSelectionBounds = { top: BoundValue; left: BoundValue; right: BoundValue; bottom: BoundValue };

type PdfComment = {
  commentId?: string | null;
  importedId?: string | null;
  fileId?: string | null;
  documentId?: string | null;
  resolvedTime?: number | null;
  isInternal?: boolean;
  selection?: {
    source?: string | null;
    page?: number | null;
    documentId?: string | null;
    selectionBounds?: PdfSelectionBounds | null;
  } | null;
};

type PdfCommentAnchor = {
  commentId: string;
  page: number | null;
  isInternal: boolean;
  bounds: { top: number; left: number; right: number; bottom: number };
};

type PdfCommentsStore = {
  getFloatingComments: PdfComment[] | null | undefined;
  setActiveComment(superdoc: SuperDoc, id: string): void;
};

const PDF_SELECTION_SOURCE = 'pdf';
const INTERNAL_HIGHLIGHT_COLOR = '#078383';
const EXTERNAL_HIGHLIGHT_COLOR = '#B1124B';

const emit = defineEmits(['anchor-activate']);

const piniaCommentsStore = useCommentsStore();
const commentsStore: PdfCommentsStore = piniaCommentsStore;
const superdocStore = useSuperdocStore();
const { activeComment } = storeToRefs(piniaCommentsStore);
const { documents, activeZoom } = storeToRefs(superdocStore);
const { proxy } = useSuperDocInstance();

const isFiniteNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
};

const hasFiniteBounds = (bounds: PdfSelectionBounds | null | undefined): bounds is FiniteSelectionBounds =>
  !!bounds &&
  isFiniteNumber(bounds.top) &&
  isFiniteNumber(bounds.left) &&
  isFiniteNumber(bounds.right) &&
  isFiniteNumber(bounds.bottom);

// Document ids of currently open PDF documents. Anchors are scoped to these so
// the overlay never leaks PDF anchors into a DOCX session.
const openPdfDocumentIds = computed(() => {
  const docs = Array.isArray(documents.value) ? documents.value : [];
  return new Set(docs.filter((doc) => doc?.type === PDF).map((doc) => String(doc.id)));
});

const getCommentDocumentId = (comment: PdfComment) => {
  const id = comment?.fileId ?? comment?.documentId ?? comment?.selection?.documentId;
  return id != null ? String(id) : null;
};

const getAnchorCommentId = (comment: PdfComment) => {
  const id = comment?.commentId ?? comment?.importedId;
  return id != null && String(id) !== '' ? String(id) : null;
};

const belongsToOpenPdfDocument = (comment: PdfComment) => {
  const ids = openPdfDocumentIds.value;
  if (!ids.size) return false;
  const commentDocumentId = getCommentDocumentId(comment);
  if (commentDocumentId) return ids.has(commentDocumentId);
  // Single open PDF fallback: a comment without explicit document metadata
  // belongs to the only open PDF document.
  return ids.size === 1;
};

// Normalize reversed selection bounds (drag up / drag left) so width/height are
// always non-negative.
const normalizeBounds = (bounds: FiniteSelectionBounds) => {
  const top = Math.min(Number(bounds.top), Number(bounds.bottom));
  const bottom = Math.max(Number(bounds.top), Number(bounds.bottom));
  const left = Math.min(Number(bounds.left), Number(bounds.right));
  const right = Math.max(Number(bounds.left), Number(bounds.right));
  return { top, left, right, bottom };
};

const pdfCommentAnchors = computed(() => {
  const parentComments = commentsStore.getFloatingComments;
  if (!Array.isArray(parentComments)) return [];

  return parentComments.flatMap((comment): PdfCommentAnchor[] => {
    if (comment?.selection?.source !== PDF_SELECTION_SOURCE) return [];
    if (comment.resolvedTime) return [];
    const commentId = getAnchorCommentId(comment);
    if (commentId === null) return [];
    const selectionBounds = comment.selection.selectionBounds;
    if (!hasFiniteBounds(selectionBounds)) return [];
    if (!belongsToOpenPdfDocument(comment)) return [];
    return [
      {
        commentId,
        page: comment.selection.page ?? null,
        isInternal: comment.isInternal !== false,
        bounds: normalizeBounds(selectionBounds),
      },
    ];
  });
});

const getAnchorStyle = (anchor: PdfCommentAnchor): CSSProperties => {
  const zoom = (activeZoom.value ?? 100) / 100;
  const { top, left, right, bottom } = anchor.bounds;
  const isActive = activeComment.value === anchor.commentId;
  const fillColor =
    (anchor.isInternal ? INTERNAL_HIGHLIGHT_COLOR : EXTERNAL_HIGHLIGHT_COLOR) + (isActive ? '66' : '33');
  return {
    position: 'absolute',
    top: top * zoom + 'px',
    left: left * zoom + 'px',
    width: (right - left) * zoom + 'px',
    height: (bottom - top) * zoom + 'px',
    backgroundColor: fillColor,
  };
};

// Reopen the real submitted comment through the configured compact/sidebar path.
const activateAnchor = (anchor: PdfCommentAnchor) => {
  commentsStore.setActiveComment(proxy.$superdoc, anchor.commentId);
  emit('anchor-activate', anchor.commentId);
};
</script>

<template>
  <div class="superdoc__pdf-comments-layer pdf-comments-layer" aria-hidden="false">
    <div
      v-for="anchor in pdfCommentAnchors"
      :key="anchor.commentId"
      class="sd-comment-anchor sd-highlight"
      role="button"
      tabindex="0"
      :data-id="anchor.commentId"
      :data-comment-id="anchor.commentId"
      :data-page-number="anchor.page"
      :style="getAnchorStyle(anchor)"
      @click.stop.prevent="activateAnchor(anchor)"
      @keydown.enter.stop.prevent="activateAnchor(anchor)"
      @keydown.space.stop.prevent="activateAnchor(anchor)"
    ></div>
  </div>
</template>

<style scoped>
/* Wrapper is pointer-inert so the PDF surface (text selection, comment drag
   selection) stays usable; only the anchors themselves capture clicks. */
.pdf-comments-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}

.sd-comment-anchor {
  position: absolute;
  cursor: pointer;
  pointer-events: auto;
  border-radius: 4px;
  transition: background-color 250ms ease;
}
</style>
