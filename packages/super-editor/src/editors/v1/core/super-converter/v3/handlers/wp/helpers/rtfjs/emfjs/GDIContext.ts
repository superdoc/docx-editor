/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/*

The MIT License (MIT)

Copyright (c) 2016 Tom Zoehner
Copyright (c) 2018 Thomas Bluemel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

import { SVG } from '../util';
import { SVGPathBuilder } from '../util/SVG';
import { DIBitmap } from './Bitmap';
import { EMFJSError, Helper } from './Helper';
import { Obj, PointL, PointS, RectL } from './Primitives';
import { CreateSimpleRegion, Region } from './Region';
import { Brush, ColorRef, Font, Pen } from './Style';

interface ISelectedStyle {
  brush?: Brush;
  pen?: Pen;
  font?: Font;
  region?: Region;
  path?: Path;

  [key: string]: Obj | undefined;
}

class Path extends Obj {
  public svgPath: SVGPathBuilder;

  constructor(svgPath: SVGPathBuilder, copy?: Path) {
    super('path');
    if (svgPath != null) {
      this.svgPath = svgPath;
    } else {
      this.svgPath = copy.svgPath;
    }
  }

  public clone(): Path {
    return new Path(null, this);
  }

  public toString(): string {
    return '{[path]}';
  }
}

function createStockObjects(): { [key: string]: Obj } {
  // Create global stock objects
  const createSolidBrush = (r: number, g: number, b: number) => {
    return new Brush(null, {
      style: Helper.GDI.BrushStyle.BS_SOLID,
      color: new ColorRef(null, r, g, b),
    });
  };
  const createSolidPen = (r: number, g: number, b: number) => {
    return new Pen(null, Helper.GDI.PenStyle.PS_SOLID, 1, new ColorRef(null, r, g, b), null);
  };
  const stockObjs: { [key: string]: Obj } = {
    WHITE_BRUSH: createSolidBrush(255, 255, 255),
    LTGRAY_BRUSH: createSolidBrush(212, 208, 200),
    GRAY_BRUSH: createSolidBrush(128, 128, 128),
    DKGRAY_BRUSH: createSolidBrush(64, 64, 64),
    BLACK_BRUSH: createSolidBrush(0, 0, 0),
    NULL_BRUSH: new Brush(null, {
      style: Helper.GDI.BrushStyle.BS_NULL,
    }),
    WHITE_PEN: createSolidPen(255, 255, 255),
    BLACK_PEN: createSolidPen(0, 0, 0),
    NULL_PEN: new Pen(null, Helper.GDI.PenStyle.PS_NULL, 0, null, null),
    OEM_FIXED_FONT: null, // TODO
    ANSI_FIXED_FONT: null, // TODO
    ANSI_VAR_FONT: null, // TODO
    SYSTEM_FONT: null, // TODO
    DEVICE_DEFAULT_FONT: null, // TODO
    DEFAULT_PALETTE: null, // TODO
    SYSTEM_FIXED_FONT: null, // TODO
    DEFAULT_GUI_FONT: null, // TODO
  };

  const objs: { [key: string]: Obj } = {};
  for (const t in stockObjs) {
    const stockObjects: { [key: string]: number } = Helper.GDI.StockObject as { [key: string]: number };
    const idx = stockObjects[t] - 0x80000000;
    objs[idx.toString()] = stockObjs[t];
  }
  return objs;
}

const _StockObjects = createStockObjects();

class GDIContextState {
  public _svggroup: SVGElement;
  public _svgclipChanged: boolean;
  public _svgtextbkfilter: SVGFilterElement;
  public mapmode: number;
  public stretchmode: number;
  public textalign: number;
  public bkmode: number;
  public textcolor: ColorRef;
  public bkcolor: ColorRef;
  public polyfillmode: number;
  public miterlimit: number;
  public wx: number;
  public wy: number;
  public ww: number;
  public wh: number;
  public vx: number;
  public vy: number;
  public vw: number;
  public vh: number;
  public x: number;
  public y: number;
  public nextbrx: number;
  public nextbry: number;
  public brx: number;
  public bry: number;
  public clip: Region;
  public ownclip: boolean;
  public selected: ISelectedStyle;

  constructor(copy: GDIContextState, defObjects?: ISelectedStyle) {
    if (copy != null) {
      this._svggroup = copy._svggroup;
      this._svgclipChanged = copy._svgclipChanged;
      this._svgtextbkfilter = copy._svgtextbkfilter;
      this.mapmode = copy.mapmode;
      this.stretchmode = copy.stretchmode;
      this.textalign = copy.textalign;
      this.bkmode = copy.bkmode;
      this.textcolor = copy.textcolor.clone();
      this.bkcolor = copy.bkcolor.clone();
      this.polyfillmode = copy.polyfillmode;
      this.miterlimit = copy.miterlimit;
      this.wx = copy.wx;
      this.wy = copy.wy;
      this.ww = copy.ww;
      this.wh = copy.wh;
      this.vx = copy.vx;
      this.vy = copy.vy;
      this.vw = copy.vw;
      this.vh = copy.vh;
      this.x = copy.x;
      this.y = copy.y;
      this.nextbrx = copy.nextbrx;
      this.nextbry = copy.nextbry;
      this.brx = copy.brx;
      this.bry = copy.bry;

      this.clip = copy.clip;
      this.ownclip = false;

      this.selected = {};
      for (const type in copy.selected) {
        this.selected[type] = copy.selected[type];
      }
    } else {
      this._svggroup = null;
      this._svgclipChanged = false;
      this._svgtextbkfilter = null;
      this.mapmode = Helper.GDI.MapMode.MM_ANISOTROPIC;
      this.stretchmode = Helper.GDI.StretchMode.COLORONCOLOR;
      this.textalign = 0; // TA_LEFT | TA_TOP | TA_NOUPDATECP
      this.bkmode = Helper.GDI.MixMode.OPAQUE;
      this.textcolor = new ColorRef(null, 0, 0, 0);
      this.bkcolor = new ColorRef(null, 255, 255, 255);
      this.polyfillmode = Helper.GDI.PolygonFillMode.ALTERNATE;
      this.miterlimit = 10;
      this.wx = 0;
      this.wy = 0;
      this.ww = 0;
      this.wh = 0;
      this.vx = 0;
      this.vy = 0;
      this.vw = 0;
      this.vh = 0;
      this.x = 0;
      this.y = 0;
      this.nextbrx = 0;
      this.nextbry = 0;
      this.brx = 0;
      this.bry = 0;

      this.clip = null;
      this.ownclip = false;

      this.selected = {};
      for (const type in defObjects) {
        const defObj = defObjects[type];
        this.selected[type] = defObj != null ? defObj.clone() : null;
      }
    }
  }
}

export class GDIContext {
  private _svg: SVG;
  private _svgdefs: SVGDefsElement;
  private _svgPatterns: { [key: string]: Brush };
  private _svgClipPaths: { [key: string]: Region };
  private _svgPath: SVGPathBuilder;
  private defObjects: ISelectedStyle;
  private state: GDIContextState;
  private statestack: GDIContextState[];
  private objects: { [key: string]: Obj };

  constructor(svg: SVG) {
    this._svg = svg;
    this._svgdefs = null;
    this._svgPatterns = {};
    this._svgClipPaths = {};
    this._svgPath = null;

    this.defObjects = {
      brush: new Brush(null, {
        style: Helper.GDI.BrushStyle.BS_SOLID,
        color: new ColorRef(null, 0, 0, 0),
      }),
      pen: new Pen(null, Helper.GDI.PenStyle.PS_SOLID, 1, new ColorRef(null, 0, 0, 0), null),
      font: new Font(null, null),
      palette: null,
      region: null,
    };

    this.state = new GDIContextState(null, this.defObjects);
    this.statestack = [this.state];
    this.objects = {};
  }

  public setMapMode(mode: number): void {
    Helper.log('[gdi] setMapMode: mode=' + mode);
    this.state.mapmode = mode;
    this.state._svggroup = null;
  }

  public getMapMode(): number {
    return this.state.mapmode;
  }

  public setWindowOrgEx(x: number, y: number): void {
    Helper.log('[gdi] setWindowOrgEx: x=' + x + ' y=' + y);
    this.state.wx = x;
    this.state.wy = y;
    this.state._svggroup = null;
  }

  public setWindowExtEx(x: number, y: number): void {
    Helper.log('[gdi] setWindowExtEx: x=' + x + ' y=' + y);
    this.state.ww = x;
    this.state.wh = y;
    this.state._svggroup = null;
  }

  public setViewportOrgEx(x: number, y: number): void {
    Helper.log('[gdi] setViewportOrgEx: x=' + x + ' y=' + y);
    this.state.vx = x;
    this.state.vy = y;
    this.state._svggroup = null;
  }

  public setViewportExtEx(x: number, y: number): void {
    Helper.log('[gdi] setViewportExtEx: x=' + x + ' y=' + y);
    this.state.vw = x;
    this.state.vh = y;
    this.state._svggroup = null;
  }

  public setBrushOrgEx(origin: PointL): void {
    Helper.log('[gdi] setBrushOrgEx: x=' + origin.x + ' y=' + origin.y);
    this.state.nextbrx = origin.x;
    this.state.nextbry = origin.y;
  }

  public saveDC(): void {
    Helper.log('[gdi] saveDC');
    const prevstate = this.state;
    this.state = new GDIContextState(this.state);
    this.statestack.push(prevstate);
    this.state._svggroup = null;
  }

  public restoreDC(saved: number): void {
    Helper.log('[gdi] restoreDC: saved=' + saved);
    if (this.statestack.length > 1) {
      if (saved === -1) {
        this.state = this.statestack.pop();
      } else if (saved < -1) {
        throw new EMFJSError('restoreDC: relative restore not implemented');
      } else if (saved > 1) {
        throw new EMFJSError('restoreDC: absolute restore not implemented');
      }
    } else {
      throw new EMFJSError('No saved contexts');
    }

    this.state._svggroup = null;
  }

  public setStretchBltMode(stretchMode: number): void {
    Helper.log('[gdi] setStretchBltMode: stretchMode=' + stretchMode);
  }

  public stretchDibBits(
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    dstX: number,
    dstY: number,
    dstW: number,
    dstH: number,
    rasterOp: number,
    colorUsage: number,
    dib: DIBitmap,
  ): void {
    Helper.log(
      '[gdi] stretchDibBits: srcX=' +
        srcX +
        ' srcY=' +
        srcY +
        ' srcW=' +
        srcW +
        ' srcH=' +
        srcH +
        ' dstX=' +
        dstX +
        ' dstY=' +
        dstY +
        ' dstW=' +
        dstW +
        ' dstH=' +
        dstH +
        ' rasterOp=0x' +
        rasterOp.toString(16),
    );
    srcX = this._todevX(srcX);
    srcY = this._todevY(srcY);
    srcW = this._todevW(srcW);
    srcH = this._todevH(srcH);
    dstX = this._todevX(dstX);
    dstY = this._todevY(dstY);
    dstW = this._todevW(dstW);
    dstH = this._todevH(dstH);
    Helper.log(
      '[gdi] stretchDibBits: TRANSLATED:' +
        ' srcX=' +
        srcX +
        ' srcY=' +
        srcY +
        ' srcW=' +
        srcW +
        ' srcH=' +
        srcH +
        ' dstX=' +
        dstX +
        ' dstY=' +
        dstY +
        ' dstW=' +
        dstW +
        ' dstH=' +
        dstH +
        ' rasterOp=0x' +
        rasterOp.toString(16),
    );
    this._pushGroup();
    this._svg.image(this.state._svggroup, dstX, dstY, dstW, dstH, dib.base64ref(), { preserveAspectRatio: 'none' });
  }

  public rectangle(rect: RectL, rw: number, rh: number): void {
    Helper.log(
      '[gdi] rectangle: rect=' +
        rect.toString() +
        ' with pen ' +
        this.state.selected.pen.toString() +
        ' and brush ' +
        this.state.selected.brush.toString(),
    );
    const bottom = this._todevY(rect.bottom);
    const right = this._todevX(rect.right);
    const top = this._todevY(rect.top);
    const left = this._todevX(rect.left);
    rw = this._todevH(rw);
    rh = this._todevH(rh);
    Helper.log(
      '[gdi] rectangle: TRANSLATED: bottom=' +
        bottom +
        ' right=' +
        right +
        ' top=' +
        top +
        ' left=' +
        left +
        ' rh=' +
        rh +
        ' rw=' +
        rw,
    );
    this._pushGroup();

    const opts = this._applyOpts(null, true, true, false);
    this._svg.rect(this.state._svggroup, left, top, right - left, bottom - top, rw / 2, rh / 2, opts);
  }

  public lineTo(x: number, y: number): void {
    Helper.log('[gdi] lineTo: x=' + x + ' y=' + y + ' with pen ' + this.state.selected.pen.toString());
    const toX = this._todevX(x);
    const toY = this._todevY(y);
    const fromX = this._todevX(this.state.x);
    const fromY = this._todevY(this.state.y);

    // Update position
    this.state.x = x;
    this.state.y = y;

    Helper.log('[gdi] lineTo: TRANSLATED: toX=' + toX + ' toY=' + toY + ' fromX=' + fromX + ' fromY=' + fromY);
    this._pushGroup();

    const opts = this._applyOpts(null, true, false, false);
    this._svg.line(this.state._svggroup, fromX, fromY, toX, toY, opts);
  }

  public moveToEx(x: number, y: number): void {
    Helper.log('[gdi] moveToEx: x=' + x + ' y=' + y);
    this.state.x = x;
    this.state.y = y;
    if (this._svgPath != null) {
      this._svgPath.move(this.state.x, this.state.y);
      Helper.log('[gdi] new path: ' + this._svgPath.path());
    }
  }

  public polygon(points: PointS[] | PointL[], bounds: RectL, first: boolean): void {
    Helper.log(
      '[gdi] polygon: points=' +
        points +
        ' with pen ' +
        this.state.selected.pen.toString() +
        ' and brush ' +
        this.state.selected.brush.toString(),
    );
    const pts = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      pts.push([this._todevX(point.x), this._todevY(point.y)]);
    }
    if (first) {
      this._pushGroup();
    }
    const opts = {
      'fill-rule': this.state.polyfillmode === Helper.GDI.PolygonFillMode.ALTERNATE ? 'evenodd' : 'nonzero',
    };
    this._applyOpts(opts, true, true, false);
    this._svg.polygon(this.state._svggroup, pts, opts);
  }

  public polyPolygon(polygons: PointS[][] | PointL[][], bounds: RectL): void {
    Helper.log(
      '[gdi] polyPolygon: polygons.length=' +
        polygons.length +
        ' with pen ' +
        this.state.selected.pen.toString() +
        ' and brush ' +
        this.state.selected.brush.toString(),
    );

    const cnt = polygons.length;
    for (let i = 0; i < cnt; i++) {
      this.polygon(polygons[i], bounds, i === 0);
    }
  }

  public polyline(isLineTo: boolean, points: PointS[], bounds: RectL): void {
    Helper.log(
      '[gdi] polyline: isLineTo=' +
        isLineTo.toString() +
        ', points=' +
        points +
        ', bounds=' +
        bounds.toString() +
        ' with pen ' +
        this.state.selected.pen.toString(),
    );
    const pts: number[][] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      pts.push([this._todevX(point.x), this._todevY(point.y)]);
    }

    if (this._svgPath != null) {
      if (!isLineTo || pts.length === 0) {
        this._svgPath.move(this._todevX(this.state.x), this._todevY(this.state.y));
      } else {
        const firstPts = pts[0];
        this._svgPath.move(firstPts[0], firstPts[1]);
      }
      this._svgPath.line(pts);
      Helper.log('[gdi] new path: ' + this._svgPath.path());
    } else {
      this._pushGroup();
      const opts = this._applyOpts(null, true, false, false);
      if (isLineTo && points.length > 0) {
        const firstPt = points[0];
        if (firstPt.x !== this.state.x || firstPt.y !== this.state.y) {
          pts.unshift([this._todevX(this.state.x), this._todevY(this.state.y)]);
        }
      }
      this._svg.polyline(this.state._svggroup, pts, opts);
    }

    if (points.length > 0) {
      const lastPt = points[points.length - 1];
      this.state.x = lastPt.x;
      this.state.y = lastPt.y;
    }
  }

  public polybezier(isPolyBezierTo: boolean, points: PointS[], bounds: RectL): void {
    Helper.log(
      '[gdi] polybezier: isPolyBezierTo=' +
        isPolyBezierTo.toString() +
        ', points=' +
        points +
        ', bounds=' +
        bounds.toString() +
        ' with pen ' +
        this.state.selected.pen.toString(),
    );
    const pts = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      pts.push({ x: this._todevX(point.x), y: this._todevY(point.y) });
    }

    if (this._svgPath != null) {
      if (isPolyBezierTo && pts.length > 0) {
        const firstPts = pts[0];
        this._svgPath.move(firstPts.x, firstPts.y);
      } else {
        this._svgPath.move(this._todevX(this.state.x), this._todevY(this.state.y));
      }

      if (pts.length < (isPolyBezierTo ? 3 : 4)) {
        throw new EMFJSError('Not enough points to draw bezier');
      }

      for (let i = isPolyBezierTo ? 1 : 0; i + 3 <= pts.length; i += 3) {
        const cp1 = pts[i];
        const cp2 = pts[i + 1];
        const ep = pts[i + 2];
        this._svgPath.curveC(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
      }

      Helper.log('[gdi] new path: ' + this._svgPath.path());
    } else {
      throw new EMFJSError('polybezier not implemented (not a path)');
    }

    if (points.length > 0) {
      const lastPt = points[points.length - 1];
      this.state.x = lastPt.x;
      this.state.y = lastPt.y;
    }
  }

  public selectClipPath(rgnMode: number): void {
    Helper.log('[gdi] selectClipPath: rgnMode=0x' + rgnMode.toString(16));
  }

  public selectClipRgn(rgnMode: number, region: Region): void {
    Helper.log('[gdi] selectClipRgn: rgnMode=0x' + rgnMode.toString(16));
    if (rgnMode === Helper.GDI.RegionMode.RGN_COPY) {
      this.state.selected.region = region;
      this.state.clip = null;
      this.state.ownclip = false;
    } else {
      if (region == null) {
        throw new EMFJSError('No clip region to select');
      }

      throw new EMFJSError('Not implemented: rgnMode=0x' + rgnMode.toString(16));
    }
    this.state._svgclipChanged = true;
  }

  public offsetClipRgn(offset: PointL): void {
    Helper.log('[gdi] offsetClipRgn: offset=' + offset.toString());
    this._getClipRgn().offset(offset.x, offset.y);
  }

  public setTextAlign(textAlignmentMode: number): void {
    Helper.log('[gdi] setTextAlign: textAlignmentMode=0x' + textAlignmentMode.toString(16));
    this.state.textalign = textAlignmentMode;
  }

  public setMiterLimit(miterLimit: number): void {
    Helper.log('[gdi] setMiterLimit: miterLimit=' + miterLimit);
    this.state.miterlimit = miterLimit;
  }

  public setBkMode(bkMode: number): void {
    Helper.log('[gdi] setBkMode: bkMode=0x' + bkMode.toString(16));
    this.state.bkmode = bkMode;
  }

  public setBkColor(bkColor: ColorRef): void {
    Helper.log('[gdi] setBkColor: bkColor=' + bkColor.toString());
    this.state.bkcolor = bkColor;
    this.state._svgtextbkfilter = null;
  }

  public setPolyFillMode(polyFillMode: number): void {
    Helper.log('[gdi] setPolyFillMode: polyFillMode=' + polyFillMode);
    this.state.polyfillmode = polyFillMode;
  }

  public setTextColor(color: ColorRef): void {
    this.state.textcolor = color;
  }

  public createFont(index: number, font: Font): void {
    this._storeObject(font, index);
  }

  public textOut(x: number, y: number, text: string, advances: number[], options: number, rectangle: RectL): void {
    const font = this.state.selected.font;
    // Only horizontal, baseline-left text is qualified here. Do not paint other
    // GDI text modes with silently incorrect placement.
    if (this.state.textalign !== 24 || font.escapement !== 0 || font.orientation !== 0) {
      throw new EMFJSError('Unsupported Unicode text alignment');
    }
    const scaleY = Math.abs(this.state.vh / this.state.wh);
    const glyphScaleX = this.state.vw / this.state.ww / scaleY;
    if (!Number.isFinite(scaleY) || scaleY === 0 || !Number.isFinite(glyphScaleX) || glyphScaleX === 0) {
      throw new EMFJSError('Invalid Unicode text mapping extents');
    }
    this._pushGroup();
    const settings: any = {
      fill: '#' + this.state.textcolor.toHex(),
      'font-family': font.facename,
      'font-size': Math.abs(font.height) * scaleY,
      'font-weight': font.weight || 400,
      'font-style': font.italic ? 'italic' : 'normal',
      'xml:space': 'preserve',
    };
    // Font size accounts for vertical mapping; scale glyph widths independently
    // and compensate device-space positions so recorded origins stay fixed.
    if (glyphScaleX !== 1) settings.transform = `scale(${glyphScaleX},1)`;
    if (font.underline || font.strikeout) {
      settings['text-decoration'] = [font.underline ? 'underline' : '', font.strikeout ? 'line-through' : '']
        .filter(Boolean)
        .join(' ');
    }
    if (advances.length > 0) {
      let current = x;
      settings.x = advances
        .map((advance) => {
          const position = this._todevX(current) / glyphScaleX;
          current += advance;
          return position;
        })
        .join(' ');
    }
    if (options & 6) {
      const left = this._todevX(rectangle.left);
      const top = this._todevY(rectangle.top);
      const width = this._todevX(rectangle.right) - left;
      const height = this._todevY(rectangle.bottom) - top;
      if (options & 2) {
        this._svg.rect(this.state._svggroup, left, top, width, height, { fill: '#' + this.state.bkcolor.toHex() });
      }
      if (options & 4) {
        const id = Helper._makeUniqueId('textclip');
        const clip = this._svg.clipPath(this._getSvgDef(), id, 'userSpaceOnUse');
        this._svg.rect(clip, left / glyphScaleX, top, width / glyphScaleX, height, {});
        settings['clip-path'] = 'url(#' + id + ')';
      }
    }
    this._svg.text(this.state._svggroup, this._todevX(x) / glyphScaleX, this._todevY(y), text, settings);
  }

  public createBrush(index: number, brush: Brush): void {
    const idx = this._storeObject(brush, index);
    Helper.log('[gdi] createBrush: brush=' + brush.toString() + ' with handle ' + idx);
  }

  public createPen(index: number, pen: Pen): void {
    const idx = this._storeObject(pen, index);
    Helper.log('[gdi] createPen: pen=' + pen.toString() + ' width handle ' + idx);
  }

  public createPenEx(index: number, pen: Pen): void {
    const idx = this._storeObject(pen, index);
    Helper.log('[gdi] createPenEx: pen=' + pen.toString() + ' width handle ' + idx);
  }

  public selectObject(objIdx: number, checkType: string): void {
    const obj = this._getObject(objIdx);
    if (obj != null && (checkType == null || obj.type === checkType)) {
      this._selectObject(obj);
      Helper.log(
        '[gdi] selectObject: objIdx=' +
          objIdx +
          (obj ? ' selected ' + obj.type + ': ' + obj.toString() : '[invalid index]'),
      );
    } else {
      Helper.log(
        '[gdi] selectObject: objIdx=' + objIdx + (obj ? ' invalid object type: ' + obj.type : '[invalid index]'),
      );
    }
  }

  public abortPath(): void {
    Helper.log('[gdi] abortPath');
    if (this._svgPath != null) {
      this._svgPath = null;
    }
  }

  public beginPath(): void {
    Helper.log('[gdi] beginPath');

    if (this._svgPath != null) {
      this._svgPath = null;
    }

    this._svgPath = this._svg.createPath();
  }

  public closeFigure(): void {
    Helper.log('[gdi] closeFigure');
    if (this._svgPath == null) {
      throw new EMFJSError('No path bracket: cannot close figure');
    }

    this._svgPath.close();
  }

  public fillPath(bounds: RectL): void {
    Helper.log('[gdi] fillPath');
    if (this.state.selected.path == null) {
      throw new EMFJSError('No path selected');
    }

    const selPath = this.state.selected.path;
    const opts = this._applyOpts(null, true, true, false);
    this._svg.path(this.state._svggroup, selPath.svgPath, opts);

    this._pushGroup();
    this.state.selected.path = null;
  }

  public strokePath(bounds: RectL): void {
    Helper.log('[gdi] strokePath');
    if (this.state.selected.path == null) {
      throw new EMFJSError('No path selected');
    }

    const selPath = this.state.selected.path;
    const opts = this._applyOpts({ fill: 'none' }, true, false, false);
    this._svg.path(this.state._svggroup, selPath.svgPath, opts);

    this._pushGroup();
    this.state.selected.path = null;
  }

  public endPath(): void {
    Helper.log('[gdi] endPath');
    if (this._svgPath == null) {
      throw new EMFJSError('No path bracket: cannot end path');
    }

    this._pushGroup();
    this._selectObject(new Path(this._svgPath));
    this._svgPath = null;
  }

  public deleteObject(objIdx: number): void {
    const ret = this._deleteObject(objIdx);
    Helper.log('[gdi] deleteObject: objIdx=' + objIdx + (ret ? ' deleted object' : '[invalid index]'));
  }

  private _pushGroup(): void {
    if (this.state._svggroup == null || this.state._svgclipChanged) {
      this.state._svgclipChanged = false;
      this.state._svgtextbkfilter = null;

      const settings: any = {
        viewBox: [this.state.vx, this.state.vy, this.state.vw, this.state.vh].join(' '),
        preserveAspectRatio: 'none',
      };
      if (this.state.clip != null) {
        Helper.log(
          '[gdi] new svg x=' +
            this.state.vx +
            ' y=' +
            this.state.vy +
            ' width=' +
            this.state.vw +
            ' height=' +
            this.state.vh +
            ' with clipping',
        );
        settings['clip-path'] = 'url(#' + this._getSvgClipPathForRegion(this.state.clip) + ')';
      } else {
        Helper.log(
          '[gdi] new svg x=' +
            this.state.vx +
            ' y=' +
            this.state.vy +
            ' width=' +
            this.state.vw +
            ' height=' +
            this.state.vh +
            ' without clipping',
        );
      }
      this.state._svggroup = this._svg.svg(
        this.state._svggroup,
        this.state.vx,
        this.state.vy,
        this.state.vw,
        this.state.vh,
        settings,
      );
    }
  }

  private _getStockObject(idx: number) {
    if (idx >= 0x80000000 && idx <= 0x80000011) {
      return _StockObjects[(idx - 0x80000000).toString()];
    } else if (idx === Helper.GDI.StockObject.DC_BRUSH) {
      return this.state.selected.brush;
    } else if (idx === Helper.GDI.StockObject.DC_PEN) {
      return this.state.selected.pen;
    }
    return null;
  }

  private _storeObject(obj: Obj, idx: number) {
    if (!idx) {
      idx = 0;
      while (this.objects[idx.toString()] != null && idx <= 65535) {
        idx++;
      }
      if (idx > 65535) {
        Helper.log('[gdi] Too many objects!');
        return -1;
      }
    }

    this.objects[idx.toString()] = obj;
    return idx;
  }

  private _getObject(objIdx: number) {
    let obj = this.objects[objIdx.toString()];
    if (obj == null) {
      obj = this._getStockObject(objIdx);
      if (obj == null) {
        Helper.log('[gdi] No object with handle ' + objIdx);
      }
    }
    return obj;
  }

  private _getSvgDef() {
    if (this._svgdefs == null) {
      this._svgdefs = this._svg.defs();
    }
    return this._svgdefs;
  }

  private _getSvgClipPathForRegion(region: Region) {
    for (const existingId in this._svgClipPaths) {
      const rgn = this._svgClipPaths[existingId];
      if (rgn === region) {
        return existingId;
      }
    }

    const id = Helper._makeUniqueId('c');
    const sclip = this._svg.clipPath(this._getSvgDef(), id, 'userSpaceOnUse');
    switch (region.complexity) {
      case 1:
        this._svg.rect(
          sclip,
          this._todevX(region.bounds.left),
          this._todevY(region.bounds.top),
          this._todevW(region.bounds.right - region.bounds.left),
          this._todevH(region.bounds.bottom - region.bounds.top),
          { fill: 'black', 'stroke-width': 0 },
        );
        break;
      case 2:
        for (let i = 0; i < region.scans.length; i++) {
          const scan = region.scans[i];
          for (let j = 0; j < scan.scanlines.length; j++) {
            const scanline = scan.scanlines[j];
            this._svg.rect(
              sclip,
              this._todevX(scanline.left),
              this._todevY(scan.top),
              this._todevW(scanline.right - scanline.left),
              this._todevH(scan.bottom - scan.top),
              { fill: 'black', 'stroke-width': 0 },
            );
          }
        }
        break;
    }
    this._svgClipPaths[id] = region;
    return id;
  }

  private _getSvgPatternForBrush(brush: Brush) {
    for (const existingId in this._svgPatterns) {
      const pat = this._svgPatterns[existingId];
      if (pat === brush) {
        return existingId;
      }
    }

    let width;
    let height;
    let img;
    switch (brush.style) {
      case Helper.GDI.BrushStyle.BS_PATTERN:
        width = brush.pattern.getWidth();
        height = brush.pattern.getHeight();
        break;
      case Helper.GDI.BrushStyle.BS_DIBPATTERNPT:
        width = brush.dibpatternpt.getWidth();
        height = brush.dibpatternpt.getHeight();
        img = brush.dibpatternpt.base64ref();
        break;
      default:
        throw new EMFJSError('Invalid brush style');
    }

    const id = Helper._makeUniqueId('p');
    const spat = this._svg.pattern(this._getSvgDef(), id, this.state.brx, this.state.bry, width, height, {
      patternUnits: 'userSpaceOnUse',
    });
    this._svg.image(spat, 0, 0, width, height, img);
    this._svgPatterns[id] = brush;
    return id;
  }

  private _selectObject(obj: Obj) {
    this.state.selected[obj.type] = obj;
    switch (obj.type) {
      case 'region':
        this.state._svgclipChanged = true;
        break;
      case 'brush':
        this.state.brx = this.state.nextbrx;
        this.state.bry = this.state.nextbry;
        break;
    }
  }

  private _deleteObject(objIdx: number) {
    const obj = this.objects[objIdx.toString()];
    if (obj != null) {
      for (let i = 0; i < this.statestack.length; i++) {
        const state = this.statestack[i];
        if (state.selected[obj.type] === obj) {
          state.selected[obj.type] = this.defObjects[obj.type].clone();
        }
      }
      delete this.objects[objIdx.toString()];
      return true;
    }

    Helper.log('[gdi] Cannot delete object with invalid handle ' + objIdx);
    return false;
  }

  private _getClipRgn() {
    if (this.state.clip != null) {
      if (!this.state.ownclip) {
        this.state.clip = this.state.clip.clone();
      }
    } else {
      if (this.state.selected.region != null) {
        this.state.clip = this.state.selected.region.clone();
      } else {
        this.state.clip = CreateSimpleRegion(
          this.state.wx,
          this.state.wy,
          this.state.wx + this.state.ww,
          this.state.wy + this.state.wh,
        );
      }
    }
    this.state.ownclip = true;
    return this.state.clip;
  }

  private _todevX(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor((val - this.state.wx) * (this.state.vw / this.state.ww)) + this.state.vx;
  }

  private _todevY(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor((val - this.state.wy) * (this.state.vh / this.state.wh)) + this.state.vy;
  }

  private _todevW(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor(val * (this.state.vw / this.state.ww)) + this.state.vx;
  }

  private _todevH(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor(val * (this.state.vh / this.state.wh)) + this.state.vy;
  }

  private _tologicalX(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor((val - this.state.vx) / (this.state.vw / this.state.ww)) + this.state.wx;
  }

  private _tologicalY(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor((val - this.state.vy) / (this.state.vh / this.state.wh)) + this.state.wy;
  }

  private _tologicalW(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor(val / (this.state.vw / this.state.ww)) + this.state.wx;
  }

  private _tologicalH(val: number) {
    // http://wvware.sourceforge.net/caolan/mapmode.html
    // logical -> device
    return Math.floor(val / (this.state.vh / this.state.wh)) + this.state.wy;
  }

  private _applyOpts(opts: any, usePen: boolean, useBrush: boolean, useFont: boolean) {
    if (opts == null) {
      opts = {};
    }
    if (usePen) {
      const pen = this.state.selected.pen;
      if (pen.style !== Helper.GDI.PenStyle.PS_NULL) {
        opts.stroke = '#' + pen.color.toHex(); // TODO: pen style
        opts['stroke-width'] = pen.width;

        opts['stroke-miterlimit'] = this.state.miterlimit;

        opts['stroke-linecap'] = 'round';
        const dotWidth = 1;

        opts['stroke-linejoin'] = 'round';

        const dashWidth = opts['stroke-width'] * 4;
        const dotSpacing = opts['stroke-width'] * 2;
        switch (pen.style) {
          case Helper.GDI.PenStyle.PS_DASH:
            opts['stroke-dasharray'] = [dashWidth, dotSpacing].toString();
            break;
          case Helper.GDI.PenStyle.PS_DOT:
            opts['stroke-dasharray'] = [dotWidth, dotSpacing].toString();
            break;
          case Helper.GDI.PenStyle.PS_DASHDOT:
            opts['stroke-dasharray'] = [dashWidth, dotSpacing, dotWidth, dotSpacing].toString();
            break;
          case Helper.GDI.PenStyle.PS_DASHDOTDOT:
            opts['stroke-dasharray'] = [dashWidth, dotSpacing, dotWidth, dotSpacing, dotWidth, dotSpacing].toString();
            break;
        }
      }
    }
    if (useBrush) {
      const brush = this.state.selected.brush;
      switch (brush.style) {
        case Helper.GDI.BrushStyle.BS_SOLID:
          opts.fill = '#' + brush.color.toHex();
          break;
        case Helper.GDI.BrushStyle.BS_PATTERN:
        case Helper.GDI.BrushStyle.BS_DIBPATTERNPT:
          opts.fill = 'url(#' + this._getSvgPatternForBrush(brush) + ')';
          break;
        case Helper.GDI.BrushStyle.BS_NULL:
          opts.fill = 'none';
          break;
        default:
          Helper.log('[gdi] unsupported brush style: ' + brush.style);
          opts.fill = 'none';
          break;
      }
    }
    if (useFont) {
      const font = this.state.selected.font;
      opts['font-family'] = font.facename;
      opts['font-size'] = Math.abs(font.height);
      opts.fill = '#' + this.state.textcolor.toHex();
    }
    return opts;
  }
}
