export interface ReviewGeometryDeliveryPayload extends Readonly<Record<string, unknown>> {
  documentEpoch?: unknown;
  paintEpoch?: unknown;
  commitSequence?: unknown;
  generation?: unknown;
  pageIndices?: unknown;
  zoomScale?: unknown;
  reviewGeometry?: unknown;
}

type Render = { mountContainer: HTMLElement | null; documentId?: string | null; epoch?: number | null };
type Packet = {
  payload: ReviewGeometryDeliveryPayload;
  key: string;
  stage: HTMLElement | null;
  delivered: boolean;
  delivering: boolean;
};

export function createReviewGeometryDelivery<T extends Render>(
  deliver: (value: T, payload: ReviewGeometryDeliveryPayload) => void,
) {
  const packets = new Map<string, Packet>();
  let stageOwners = new WeakMap<HTMLElement, string>();
  let active: { documentId: string; stage: HTMLElement; epoch: number | null | undefined } | null = null;
  const documentOf = (current: T): string | null =>
    current.documentId != null
      ? String(current.documentId)
      : (current.mountContainer?.dataset.superdocV2DocumentId ?? null);
  const matches = (documentId: string, current: T): boolean =>
    current.mountContainer?.dataset.superdocV2DocumentId === documentId &&
    (current.documentId == null || String(current.documentId) === documentId);
  const matchesPaint = (packet: Packet, current: T): boolean =>
    typeof packet.payload.paintEpoch !== 'number' || packet.payload.paintEpoch === current.epoch;
  const observe = (current: T) => {
    const stage = current.mountContainer;
    const documentId = documentOf(current);
    if (!stage || !documentId || !matches(documentId, current)) return;
    const previousOwner = stageOwners.get(stage);
    if (previousOwner && previousOwner !== documentId) packets.delete(previousOwner);
    stageOwners.set(stage, documentId);
    const packet = packets.get(documentId);
    if (packet?.stage && packet.stage !== stage) packets.delete(documentId);
    else if (
      packet &&
      (!active || active.stage !== stage || active.documentId !== documentId || active.epoch !== current.epoch)
    ) {
      packet.delivered = false;
    }
    active = { documentId, stage, epoch: current.epoch };
  };
  const dispatch = (documentId: string, packet: Packet, current: T, replay = false): boolean => {
    if (!current.mountContainer || !matches(documentId, current) || !matchesPaint(packet, current)) return false;
    if ((packet.stage && packet.stage !== current.mountContainer) || packet.delivering || (packet.delivered && !replay))
      return false;
    const wasDelivered = packet.delivered;
    const previousStage = packet.stage;
    packet.stage = current.mountContainer;
    packet.delivered = true;
    packet.delivering = true;
    try {
      deliver(current, packet.payload);
    } catch (error) {
      packet.delivered = wasDelivered;
      packet.stage = previousStage;
      throw error;
    } finally {
      packet.delivering = false;
    }
    return true;
  };
  const notify = (
    documentId: string,
    payload: ReviewGeometryDeliveryPayload,
    current: T | null,
    ready = true,
  ): boolean => {
    if (!payload.reviewGeometry || !Array.isArray(payload.pageIndices)) return false;
    let key: string;
    try {
      key = JSON.stringify([
        documentId,
        payload.documentEpoch,
        payload.paintEpoch,
        payload.commitSequence,
        payload.generation,
        payload.pageIndices,
        payload.zoomScale,
        payload.reviewGeometry,
      ]);
    } catch {
      return false;
    }
    const isCurrent = current != null && matches(documentId, current);
    if (isCurrent) observe(current);
    const previous = packets.get(documentId);
    if (
      previous &&
      previous.payload.documentEpoch === payload.documentEpoch &&
      typeof previous.payload.paintEpoch === 'number' &&
      typeof payload.paintEpoch === 'number' &&
      payload.paintEpoch < previous.payload.paintEpoch
    )
      return false;
    if (
      previous &&
      previous.payload.documentEpoch === payload.documentEpoch &&
      typeof previous.payload.commitSequence === 'number' &&
      typeof payload.commitSequence === 'number' &&
      payload.commitSequence < previous.payload.commitSequence
    )
      return false;
    if (
      previous &&
      previous.payload.documentEpoch === payload.documentEpoch &&
      typeof previous.payload.generation === 'number' &&
      typeof payload.generation === 'number' &&
      payload.generation < previous.payload.generation
    )
      return false;
    if (
      isCurrent &&
      typeof payload.paintEpoch === 'number' &&
      typeof current.epoch === 'number' &&
      payload.paintEpoch < current.epoch
    )
      return false;
    if (previous?.key === key) {
      previous.payload = payload;
      return isCurrent && ready ? dispatch(documentId, previous, current) : false;
    }
    const packet: Packet = {
      payload,
      key,
      stage: isCurrent
        ? current.mountContainer
        : previous && previous.payload.documentEpoch === payload.documentEpoch
          ? previous.stage
          : null,
      delivered: false,
      delivering: false,
    };
    packets.set(documentId, packet);
    if (!isCurrent || !ready) return false;
    try {
      return dispatch(documentId, packet, current);
    } catch (error) {
      if (previous) packets.set(documentId, previous);
      else packets.delete(documentId);
      throw error;
    }
  };
  return {
    notify,
    observe,
    flush(current: T): boolean {
      observe(current);
      const documentId = documentOf(current);
      const packet = documentId == null ? null : packets.get(documentId);
      return documentId && packet ? dispatch(documentId, packet, current) : false;
    },
    replay(current: T): boolean {
      observe(current);
      const documentId = documentOf(current);
      const packet = documentId == null ? null : packets.get(documentId);
      return documentId && packet ? dispatch(documentId, packet, current, true) : false;
    },
    reset() {
      packets.clear();
      stageOwners = new WeakMap();
      active = null;
    },
  };
}
