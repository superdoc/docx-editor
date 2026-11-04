import { describe, expect, it, vi } from 'vitest';
import { createReviewGeometryDelivery } from './v2-review-geometry-delivery.js';

const stage = (id: string, epoch = 7) => ({
  documentId: id,
  epoch,
  mountContainer: { dataset: { superdocV2DocumentId: id } } as unknown as HTMLElement,
});
const packet = (x = 10, paintEpoch = 7, commitSequence = 1, documentEpoch = 'epoch') => ({
  documentEpoch,
  paintEpoch,
  commitSequence,
  pageIndices: [0],
  zoomScale: 1,
  reviewGeometry: { coordinateSpace: 'paint-wrapper-css-px', complete: true, entries: [{ x }] },
});

describe('review geometry delivery', () => {
  it('deduplicates identical packets and admits changed paint, revision, and geometry', () => {
    const deliver = vi.fn();
    const delivery = createReviewGeometryDelivery(deliver);
    const current = stage('a');
    expect(delivery.notify('a', packet(), current)).toBe(true);
    expect(delivery.notify('a', packet(), current)).toBe(false);
    expect(delivery.notify('a', packet(10, 7, 2), current)).toBe(true);
    expect(delivery.notify('a', packet(11, 7, 2), current)).toBe(true);
    current.epoch = 8;
    expect(delivery.notify('a', packet(11, 8, 2), current)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(4);
  });

  it('replays the latest viewport packet after recollection without accepting synchronous feedback', () => {
    const current = stage('a');
    const value = packet();
    const deliver = vi.fn(() => {
      expect(delivery.notify('a', value, current)).toBe(false);
      expect(delivery.replay(current)).toBe(false);
    });
    const delivery = createReviewGeometryDelivery(deliver);
    expect(delivery.notify('a', value, current)).toBe(true);
    expect(delivery.replay(current)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(delivery.flush(current)).toBe(false);
  });

  it('queues a different document until its first render and restores the previous document on return', () => {
    const deliver = vi.fn();
    const delivery = createReviewGeometryDelivery(deliver);
    const a = stage('a'),
      b = stage('b', 8);
    const bPacket = packet(20, 8, 1, 'document-b');
    expect(delivery.notify('a', packet(), a)).toBe(true);
    expect(delivery.notify('b', bPacket, a, false)).toBe(false);
    delivery.observe(b);
    expect(delivery.flush(b)).toBe(true);
    expect(deliver).toHaveBeenLastCalledWith(b, bPacket);
    delivery.observe(a);
    expect(delivery.flush(a)).toBe(true);
    expect(deliver).toHaveBeenLastCalledWith(a, packet());
  });

  it('waits for the packet paint epoch and never replays an older paint', () => {
    const deliver = vi.fn();
    const delivery = createReviewGeometryDelivery(deliver);
    const current = stage('a');
    expect(delivery.notify('a', packet(), current)).toBe(true);
    const next = packet(20, 8, 2);
    expect(delivery.notify('a', next, current)).toBe(false);
    expect(delivery.replay(current)).toBe(false);
    current.epoch = 8;
    delivery.observe(current);
    expect(delivery.flush(current)).toBe(true);
    expect(deliver).toHaveBeenLastCalledWith(current, next);
    expect(delivery.notify('a', packet(), current)).toBe(false);
    expect(delivery.replay(current)).toBe(true);
    expect(deliver).toHaveBeenLastCalledWith(current, next);
  });

  it('keeps only the latest packet per document and rejects an older generation', () => {
    const deliver = vi.fn();
    const delivery = createReviewGeometryDelivery(deliver);
    const current = stage('a');
    const first = { ...packet(10), generation: 1 };
    const latest = { ...packet(20, 7, 2), generation: 2 };
    const repeated = { ...latest, generation: 3 };
    expect(delivery.notify('a', first, null)).toBe(false);
    expect(delivery.notify('a', latest, null)).toBe(false);
    expect(delivery.notify('a', repeated, null)).toBe(false);
    expect(delivery.notify('a', first, null)).toBe(false);
    expect(delivery.notify('a', { ...packet(30, 7, 2), generation: 2 }, null)).toBe(false);
    expect(delivery.flush(current)).toBe(true);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(current, repeated);
  });

  it('does not carry packets into a replacement stage or after reset', () => {
    const deliver = vi.fn();
    const delivery = createReviewGeometryDelivery(deliver);
    const a = stage('a');
    expect(delivery.notify('a', packet(), a, false)).toBe(false);
    expect(delivery.flush(stage('a'))).toBe(false);
    expect(delivery.notify('a', packet(), a)).toBe(true);
    delivery.reset();
    expect(delivery.replay(a)).toBe(false);
    expect(delivery.notify('a', packet(), a)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('drops a packet if the same stage is reassigned to another document', () => {
    const deliver = vi.fn();
    const delivery = createReviewGeometryDelivery(deliver);
    const current = stage('a');
    expect(delivery.notify('a', packet(), current, false)).toBe(false);
    current.mountContainer.dataset.superdocV2DocumentId = 'b';
    delivery.observe({ ...current, documentId: 'b' });
    current.mountContainer.dataset.superdocV2DocumentId = 'a';
    expect(delivery.flush(current)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('rejects malformed packets and retries after a delivery error', () => {
    const current = stage('a');
    const deliver = vi.fn().mockImplementationOnce(() => {
      throw new Error('failed');
    });
    const delivery = createReviewGeometryDelivery(deliver);
    expect(delivery.notify('a', { pageIndices: [0] }, current)).toBe(false);
    expect(() => delivery.notify('a', packet(), current)).toThrow('failed');
    expect(delivery.notify('a', packet(), current)).toBe(true);
  });
});
