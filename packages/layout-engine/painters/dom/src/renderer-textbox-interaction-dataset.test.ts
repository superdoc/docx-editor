/**
 * SD-3521 PR3 WS8 — the painter projects canonical textbox interaction metadata
 * (`data-sd-textbox-*`) onto the painted drawing fragment so the host object
 * controller binds by stable identity + capability + OCC revision without
 * measuring the rotated outer AABB. Repeated header/footer instances share the
 * textbox id but get a distinct, page-scoped instance key.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test';
import { createTestPainter as createDomPainter } from './_test-utils.js';
import type { FlowBlock, Measure, Layout, DrawingGeometry } from '@superdoc/contracts';

const geometry: DrawingGeometry = { width: 200, height: 100, rotation: 45, flipH: true, flipV: false };

function textboxBlock(id: string, binding: Record<string, unknown>): FlowBlock {
  return {
    kind: 'drawing',
    id,
    drawingKind: 'textboxShape',
    geometry,
    shapeKind: 'rect',
    contentBlocks: [],
    attrs: { textboxId: binding.textboxId, textboxBinding: binding },
  } as unknown as FlowBlock;
}

function textboxMeasure(): Measure {
  return {
    kind: 'drawing',
    drawingKind: 'textboxShape',
    width: geometry.width,
    height: geometry.height,
    scale: 1,
    naturalWidth: geometry.width,
    naturalHeight: geometry.height,
    geometry,
  } as unknown as Measure;
}

function singlePageLayout(block: FlowBlock): Layout {
  return {
    pageSize: { w: 600, h: 800 },
    pages: [
      {
        number: 1,
        fragments: [
          {
            kind: 'drawing',
            blockId: block.id,
            drawingKind: 'textboxShape',
            x: 50,
            y: 100,
            width: geometry.width,
            height: geometry.height,
            geometry,
            scale: 1,
            isAnchored: false,
            textboxId: (block as unknown as { attrs: { textboxId: string } }).attrs.textboxId,
          },
        ],
      },
    ],
  } as unknown as Layout;
}

describe('painter textbox interaction dataset', () => {
  let mount: HTMLElement;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => mount.remove());

  it('stamps canonical identity, capability, revision, and intrinsic geometry', () => {
    const block = textboxBlock('tb-owner-1', {
      textboxId: 'tb0',
      geometryRevision: 'tbgeo:abc',
      ownerBlockId: 'OWNER123',
      canMove: true,
      canResize: true,
      moveReason: null,
      resizeReason: null,
    });
    const painter = createDomPainter({ blocks: [block], measures: [textboxMeasure()] });
    painter.paint(singlePageLayout(block), mount);

    const el = mount.querySelector('.superdoc-drawing-fragment') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.dataset.sdTextboxId).toBe('tb0');
    expect(el.dataset.sdTextboxRevision).toBe('tbgeo:abc');
    expect(el.dataset.sdTextboxOwnerBlock).toBe('OWNER123');
    expect(el.dataset.sdTextboxCanMove).toBe('true');
    expect(el.dataset.sdTextboxCanResize).toBe('true');
    expect(el.dataset.sdTextboxUnsupportedReason).toBeUndefined();
    // Intrinsic (unrotated) geometry, not the rotated outer AABB.
    expect(el.dataset.sdTextboxWidth).toBe('200');
    expect(el.dataset.sdTextboxHeight).toBe('100');
    expect(el.dataset.sdTextboxRotation).toBe('45');
    expect(el.dataset.sdTextboxFlipH).toBe('true');
    expect(el.dataset.sdTextboxFlipV).toBe('false');
    expect(el.dataset.sdTextboxScaleX).toBe('1');
    expect(el.dataset.sdTextboxScaleY).toBe('1');
    expect(el.dataset.sdTextboxInstanceKey).toContain('tb0');
  });

  it('marks an unsupported case and carries a stable reason, no active capability', () => {
    const block = textboxBlock('tb-owner-2', {
      textboxId: 'tb0',
      geometryRevision: 'tbgeo:locked',
      ownerBlockId: 'OWNER',
      canMove: false,
      canResize: false,
      moveReason: 'geometry-locked',
      resizeReason: 'geometry-locked',
    });
    const painter = createDomPainter({ blocks: [block], measures: [textboxMeasure()] });
    painter.paint(singlePageLayout(block), mount);
    const el = mount.querySelector('.superdoc-drawing-fragment') as HTMLElement;
    expect(el.dataset.sdTextboxCanMove).toBe('false');
    expect(el.dataset.sdTextboxCanResize).toBe('false');
    expect(el.dataset.sdTextboxUnsupportedReason).toBe('geometry-locked');
  });

  it('does not stamp textbox metadata on a non-textbox drawing', () => {
    const block: FlowBlock = {
      kind: 'drawing',
      id: 'plain-shape',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'rect',
      fillColor: '#000',
    } as unknown as FlowBlock;
    const measure = { ...textboxMeasure(), drawingKind: 'vectorShape' } as unknown as Measure;
    const layout = {
      pageSize: { w: 600, h: 800 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'drawing',
              blockId: 'plain-shape',
              drawingKind: 'vectorShape',
              x: 10,
              y: 10,
              width: 200,
              height: 100,
              geometry,
              scale: 1,
              isAnchored: false,
            },
          ],
        },
      ],
    } as unknown as Layout;
    const painter = createDomPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);
    const el = mount.querySelector('.superdoc-drawing-fragment') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.dataset.sdTextboxId).toBeUndefined();
  });

  it('stamps a fail-closed reason when textbox content has no canonical binding', () => {
    const block: FlowBlock = {
      kind: 'drawing',
      id: 'static-textbox-shape',
      drawingKind: 'vectorShape',
      geometry,
      shapeKind: 'rect',
      fillColor: '#000',
      contentBlocks: [],
      attrs: { textboxStaticReason: 'canonical-binding-unavailable' },
    } as unknown as FlowBlock;
    const measure = { ...textboxMeasure(), drawingKind: 'vectorShape' } as unknown as Measure;
    const layout = singlePageLayout(block);
    const painter = createDomPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const el = mount.querySelector('.superdoc-drawing-fragment') as HTMLElement;
    expect(el.dataset.sdTextboxStaticReason).toBe('canonical-binding-unavailable');
    expect(el.dataset.sdTextboxId).toBeUndefined();
  });

  it('stamps textbox interaction metadata on an in-scope shape-group child (SD-5244)', () => {
    const groupGeometry: DrawingGeometry = { width: 200, height: 100, rotation: 0, flipH: false, flipV: false };
    const block: FlowBlock = {
      kind: 'drawing',
      id: 'exhibit-group',
      drawingKind: 'shapeGroup',
      geometry: groupGeometry,
      groupTransform: { width: 200, height: 100, childWidth: 200, childHeight: 100 },
      shapes: [
        {
          shapeType: 'vectorShape',
          attrs: {
            x: 0,
            y: 0,
            width: 80,
            height: 30,
            textboxId: 'tb-exhibit-a',
            textboxBinding: { textboxId: 'tb-exhibit-a', canMove: false, canResize: false, geometryRevision: 'g1' },
          },
        },
      ],
    } as unknown as FlowBlock;
    const measure = {
      kind: 'drawing',
      drawingKind: 'shapeGroup',
      width: groupGeometry.width,
      height: groupGeometry.height,
      scale: 1,
      naturalWidth: groupGeometry.width,
      naturalHeight: groupGeometry.height,
      geometry: groupGeometry,
    } as unknown as Measure;
    const layout = {
      pageSize: { w: 600, h: 800 },
      pages: [
        {
          number: 1,
          fragments: [
            {
              kind: 'drawing',
              blockId: 'exhibit-group',
              drawingKind: 'shapeGroup',
              x: 20,
              y: 20,
              width: groupGeometry.width,
              height: groupGeometry.height,
              geometry: groupGeometry,
              scale: 1,
              isAnchored: false,
            },
          ],
        },
      ],
    } as unknown as Layout;

    const painter = createDomPainter({ blocks: [block], measures: [measure] });
    painter.paint(layout, mount);

    const childEl = mount.querySelector('.superdoc-shape-group__child') as HTMLElement;
    expect(childEl).toBeTruthy();
    expect(childEl.dataset.sdTextboxId).toBe('tb-exhibit-a');
    expect(childEl.dataset.sdTextboxCanMove).toBe('false');
    expect(childEl.dataset.sdTextboxCanResize).toBe('false');
  });
});
