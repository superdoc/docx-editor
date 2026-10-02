/* eslint-disable @typescript-eslint/no-explicit-any */
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

import { Blob } from './Blob';
import { DIBitmap } from './Bitmap';
import { GDIContext } from './GDIContext';
import { EMFJSError, Helper } from './Helper';
import { PointL, PointS, RectL, SizeL } from './Primitives';
import { Region } from './Region';
import { Brush, ColorRef, Font, Pen } from './Style';

class EmfHeader {
  private size: number;
  private bounds: RectL;
  private frame: RectL;
  private nPalEntries: number;
  private refDevCx: number;
  private refDevCy: number;
  private refDevCxMm: number;
  private refDevCyMm: number;
  private description: string;
  private displayDevCxUm: number;
  private displayDevCyUm: number;

  constructor(reader: Blob, headerSize: number) {
    const recordStart = reader.pos - 8;

    this.size = headerSize;
    this.bounds = new RectL(reader);
    this.frame = new RectL(reader);
    if (reader.readUint32() !== Helper.GDI.FormatSignature.ENHMETA_SIGNATURE) {
      throw new EMFJSError('Invalid header signature');
    }
    reader.skip(4); // version
    reader.skip(4); // bytes (size of metafile)
    reader.skip(4); // number of records
    reader.skip(2); // number of handles
    reader.skip(2); // reserved
    const descriptionLen = reader.readUint32();
    const descriptionOff = reader.readUint32();
    this.nPalEntries = reader.readUint32();
    this.refDevCx = reader.readUint32();
    this.refDevCy = reader.readUint32();
    this.refDevCxMm = reader.readUint32();
    this.refDevCyMm = reader.readUint32();

    let hdrSize = headerSize;
    if (descriptionLen > 0) {
      if (descriptionOff < 88) {
        throw new EMFJSError('Invalid header description offset');
      }

      hdrSize = descriptionOff + descriptionLen * 2;
      if (hdrSize > headerSize) {
        throw new EMFJSError('Invalid header description length');
      }

      const prevPos = reader.pos;
      reader.seek(recordStart + descriptionOff);
      this.description = reader.readFixedSizeUnicodeString(descriptionLen);
      reader.seek(prevPos);
    } else {
      this.description = '';
    }

    if (hdrSize >= 100) {
      // We have a EmfMetafileHeaderExtension1 record
      const pixelFormatSize = reader.readUint32();
      const pixelFormatOff = reader.readUint32();
      const haveOpenGl = reader.readUint32();
      if (haveOpenGl !== 0) {
        throw new EMFJSError('OpenGL records are not yet supported');
      }

      if (pixelFormatOff !== 0) {
        if (pixelFormatOff < 100 || pixelFormatOff < hdrSize) {
          throw new EMFJSError('Invalid pixel format offset');
        }

        hdrSize = pixelFormatOff + pixelFormatSize;
        if (hdrSize > headerSize) {
          throw new EMFJSError('Invalid pixel format size');
        }

        // TODO: read pixel format blob
      }

      if (hdrSize >= 108) {
        // We have a EmfMetafileHeaderExtension2 record
        this.displayDevCxUm = reader.readUint32(); // in micrometers
        this.displayDevCyUm = reader.readUint32(); // in micrometers
      }
    }
  }

  public getBounds(): RectL {
    return this.bounds;
  }

  public toString(): string {
    return (
      '{bounds: ' +
      this.bounds.toString() +
      ', frame: ' +
      this.frame.toString() +
      ', description: ' +
      this.description +
      '}'
    );
  }
}

export class EMFRecords {
  private _records: ((gdi: GDIContext) => void)[];
  private _header: EmfHeader;

  constructor(reader: Blob, first: number, renderUnicodeText = false) {
    this._records = [];

    this._header = new EmfHeader(reader, first);

    let all = false;
    let curpos = first;
    main_loop: while (!all) {
      reader.seek(curpos);
      const type = reader.readUint32();
      const size = reader.readUint32();
      if (size < 8) {
        throw new EMFJSError('Invalid record size');
      }
      switch (type) {
        case Helper.GDI.RecordType.EMR_EOF:
          all = true;
          break main_loop;
        case Helper.GDI.RecordType.EMR_SETMAPMODE: {
          const mapMode = reader.readInt32();
          this._records.push((gdi) => {
            gdi.setMapMode(mapMode);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETWINDOWORGEX: {
          const x = reader.readInt32();
          const y = reader.readInt32();
          this._records.push((gdi) => {
            gdi.setWindowOrgEx(x, y);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETWINDOWEXTEX: {
          const x = reader.readUint32();
          const y = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setWindowExtEx(x, y);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETVIEWPORTORGEX: {
          const x = reader.readInt32();
          const y = reader.readInt32();
          this._records.push((gdi) => {
            gdi.setViewportOrgEx(x, y);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETVIEWPORTEXTEX: {
          const x = reader.readUint32();
          const y = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setViewportExtEx(x, y);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SAVEDC: {
          this._records.push((gdi) => {
            gdi.saveDC();
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_RESTOREDC: {
          const saved = reader.readInt32();
          this._records.push((gdi) => {
            gdi.restoreDC(saved);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETBKMODE: {
          const bkMode = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setBkMode(bkMode);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETBKCOLOR: {
          const bkColor = new ColorRef(reader);
          this._records.push((gdi) => {
            gdi.setBkColor(bkColor);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETTEXTCOLOR: {
          if (!renderUnicodeText) break;
          const color = new ColorRef(reader);
          this._records.push((gdi) => gdi.setTextColor(color));
          break;
        }
        case Helper.GDI.RecordType.EMR_EXTCREATEFONTINDIRECTW: {
          if (!renderUnicodeText) break;
          if (size < 104) throw new EMFJSError('Invalid font record size');
          const index = reader.readUint32();
          const font = new Font(reader, 92);
          this._records.push((gdi) => gdi.createFont(index, font));
          break;
        }
        case Helper.GDI.RecordType.EMR_EXTTEXTOUTW: {
          if (!renderUnicodeText) break;
          if (size < 76) throw new EMFJSError('Invalid Unicode text record size');
          reader.skip(28); // Bounds, graphics mode and scale factors.
          const x = reader.readInt32();
          const y = reader.readInt32();
          const count = reader.readUint32();
          const stringOffset = reader.readUint32();
          const options = reader.readUint32();
          const rectangle = new RectL(reader);
          const dxOffset = reader.readUint32();
          if ((options & ~6) !== 0) throw new EMFJSError('Unsupported Unicode text options');
          if (count === 0) break;
          if (
            stringOffset < 76 ||
            stringOffset + count * 2 > size ||
            (dxOffset !== 0 && (dxOffset < 76 || dxOffset + count * 4 > size))
          ) {
            throw new EMFJSError('Invalid Unicode text record offset');
          }
          reader.seek(curpos + stringOffset);
          let text = '';
          for (let i = 0; i < count; i++) text += String.fromCharCode(reader.readUint16());
          const advances: number[] = [];
          if (dxOffset !== 0) {
            reader.seek(curpos + dxOffset);
            for (let i = 0; i < count; i++) advances.push(reader.readInt32());
          }
          this._records.push((gdi) => gdi.textOut(x, y, text, advances, options, rectangle));
          break;
        }
        case Helper.GDI.RecordType.EMR_CREATEBRUSHINDIRECT: {
          const index = reader.readUint32();
          const brush = new Brush(reader);
          this._records.push((gdi) => {
            gdi.createBrush(index, brush);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_CREATEPEN: {
          const index = reader.readUint32();
          const pen = new Pen(reader, null);
          this._records.push((gdi) => {
            gdi.createPen(index, pen);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_EXTCREATEPEN: {
          const index = reader.readUint32();
          const offBmi = reader.readUint32();
          const cbBmi = reader.readUint32();
          const offBits = reader.readUint32();
          const cbBits = reader.readUint32();
          const pen = new Pen(reader, {
            header: {
              off: curpos + offBmi,
              size: cbBmi,
            },
            data: {
              off: curpos + offBits,
              size: cbBits,
            },
          });
          this._records.push((gdi) => {
            gdi.createPen(index, pen);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SELECTOBJECT: {
          const idx = reader.readUint32();
          this._records.push((gdi) => {
            gdi.selectObject(idx, null);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_DELETEOBJECT: {
          const idx = reader.readUint32();
          this._records.push((gdi) => {
            gdi.deleteObject(idx);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_RECTANGLE: {
          const rect = new RectL(reader);
          this._records.push((gdi) => {
            gdi.rectangle(rect, 0, 0);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_ROUNDRECT: {
          const rect = new RectL(reader);
          const corner = new SizeL(reader);
          this._records.push((gdi) => {
            gdi.rectangle(rect, corner.cx, corner.cy);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_LINETO: {
          const x = reader.readInt32();
          const y = reader.readInt32();
          this._records.push((gdi) => {
            gdi.lineTo(x, y);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_MOVETOEX: {
          const x = reader.readInt32();
          const y = reader.readInt32();
          this._records.push((gdi) => {
            gdi.moveToEx(x, y);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYGON:
        case Helper.GDI.RecordType.EMR_POLYGON16: {
          const isSmall = type === Helper.GDI.RecordType.EMR_POLYGON16;
          const bounds = new RectL(reader);
          let cnt = reader.readUint32();
          const points: PointS[] | PointL[] = [];
          while (cnt > 0) {
            points.push(isSmall ? new PointS(reader) : new PointL(reader));
            cnt--;
          }
          this._records.push((gdi) => {
            gdi.polygon(points, bounds, true);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYPOLYGON:
        case Helper.GDI.RecordType.EMR_POLYPOLYGON16: {
          const isSmall = type === Helper.GDI.RecordType.EMR_POLYPOLYGON16;
          const bounds = new RectL(reader);
          const polyCnt = reader.readUint32();
          reader.skip(4); // count
          const polygonsPtCnts = [];
          for (let i = 0; i < polyCnt; i++) {
            polygonsPtCnts.push(reader.readUint32());
          }

          const polygons: PointS[][] | PointL[][] = [];
          for (let i = 0; i < polyCnt; i++) {
            const ptCnt = polygonsPtCnts[i];

            const p = [];
            for (let ip = 0; ip < ptCnt; ip++) {
              p.push(isSmall ? new PointS(reader) : new PointL(reader));
            }
            polygons.push(p);
          }
          this._records.push((gdi) => {
            gdi.polyPolygon(polygons, bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETPOLYFILLMODE: {
          const polyfillmode = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setPolyFillMode(polyfillmode);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYLINE16:
        case Helper.GDI.RecordType.EMR_POLYLINETO16: {
          const isLineTo = type === Helper.GDI.RecordType.EMR_POLYLINETO16;
          const bounds = new RectL(reader);
          let cnt = reader.readUint32();
          const points: PointS[] = [];
          while (cnt > 0) {
            points.push(new PointS(reader));
            cnt--;
          }
          this._records.push((gdi) => {
            gdi.polyline(isLineTo, points, bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYBEZIER:
        case Helper.GDI.RecordType.EMR_POLYBEZIERTO: {
          const isPolyBezierTo = type === Helper.GDI.RecordType.EMR_POLYBEZIERTO;
          const bounds = new RectL(reader);
          let cnt = reader.readUint32();
          const points: PointL[] = [];
          while (cnt > 0) {
            points.push(new PointL(reader));
            cnt--;
          }
          this._records.push((gdi) => {
            gdi.polybezier(isPolyBezierTo, points, bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYBEZIER16: {
          const bounds = new RectL(reader);
          const start = new PointL(reader);
          let cnt = reader.readUint32();
          const points = [start];
          while (cnt > 0) {
            points.push(new PointS(reader));
            cnt--;
          }
          this._records.push((gdi) => {
            gdi.polybezier(false, points, bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYBEZIERTO16: {
          const bounds = new RectL(reader);
          let cnt = reader.readUint32();
          const points: PointS[] = [];
          while (cnt > 0) {
            points.push(new PointS(reader));
            cnt--;
          }
          this._records.push((gdi) => {
            gdi.polybezier(true, points, bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETTEXTALIGN: {
          const textAlign = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setTextAlign(textAlign);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETSTRETCHBLTMODE: {
          const stretchMode = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setStretchBltMode(stretchMode);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETBRUSHORGEX: {
          const origin = new PointL(reader);
          this._records.push((gdi) => {
            gdi.setBrushOrgEx(origin);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_BEGINPATH: {
          this._records.push((gdi) => {
            gdi.beginPath();
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_ENDPATH: {
          this._records.push((gdi) => {
            gdi.endPath();
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_ABORTPATH: {
          this._records.push((gdi) => {
            gdi.abortPath();
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_CLOSEFIGURE: {
          this._records.push((gdi) => {
            gdi.closeFigure();
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_FILLPATH: {
          const bounds = new RectL(reader);
          this._records.push((gdi) => {
            gdi.fillPath(bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_STROKEPATH: {
          const bounds = new RectL(reader);
          this._records.push((gdi) => {
            gdi.strokePath(bounds);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SELECTCLIPPATH: {
          const rgnMode = reader.readUint32();
          this._records.push((gdi) => {
            gdi.selectClipPath(rgnMode);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_EXTSELECTCLIPRGN: {
          reader.skip(4);
          const rgnMode = reader.readUint32();
          const region = rgnMode !== Helper.GDI.RegionMode.RGN_COPY ? new Region(reader) : null;
          this._records.push((gdi) => {
            gdi.selectClipRgn(rgnMode, region);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_OFFSETCLIPRGN: {
          const offset = new PointL(reader);
          this._records.push((gdi) => {
            gdi.offsetClipRgn(offset);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_SETMITERLIMIT: {
          const miterLimit = reader.readUint32();
          this._records.push((gdi) => {
            gdi.setMiterLimit(miterLimit);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_STRETCHDIBITS: {
          const bounds = new RectL(reader);
          const xDest = reader.readInt32();
          const yDest = reader.readInt32();
          const xSrc = reader.readInt32();
          const ySrc = reader.readInt32();
          const cxSrc = reader.readInt32();
          const cySrc = reader.readInt32();
          const offBmiSrc = reader.readUint32();
          const cbBmiSrc = reader.readUint32();
          const offBitsSrc = reader.readUint32();
          const cbBitsSrc = reader.readUint32();
          const iUsageSrc = reader.readUint32();
          const dwRop = reader.readUint32();
          const cxDest = reader.readInt32();
          const cyDest = reader.readInt32();

          const dib = new DIBitmap(reader, {
            header: {
              off: curpos + offBmiSrc,
              size: cbBmiSrc,
            },
            data: {
              off: curpos + offBitsSrc,
              size: cbBitsSrc,
            },
          });

          this._records.push((gdi) => {
            gdi.stretchDibBits(xSrc, ySrc, cxSrc, cySrc, xDest, yDest, cxDest, cyDest, dwRop, iUsageSrc, dib);
          });
          break;
        }
        case Helper.GDI.RecordType.EMR_POLYLINE:
        case Helper.GDI.RecordType.EMR_POLYLINETO:
        case Helper.GDI.RecordType.EMR_POLYPOLYLINE:
        case Helper.GDI.RecordType.EMR_SETPIXELV:
        case Helper.GDI.RecordType.EMR_SETMAPPERFLAGS:
        case Helper.GDI.RecordType.EMR_SETROP2:
        case Helper.GDI.RecordType.EMR_SETCOLORADJUSTMENT:
        case Helper.GDI.RecordType.EMR_SETMETARGN:
        case Helper.GDI.RecordType.EMR_EXCLUDECLIPRECT:
        case Helper.GDI.RecordType.EMR_INTERSECTCLIPRECT:
        case Helper.GDI.RecordType.EMR_SCALEVIEWPORTEXTEX:
        case Helper.GDI.RecordType.EMR_SCALEWINDOWEXTEX:
        case Helper.GDI.RecordType.EMR_SETWORLDTRANSFORM:
        case Helper.GDI.RecordType.EMR_MODIFYWORLDTRANSFORM:
        case Helper.GDI.RecordType.EMR_ANGLEARC:
        case Helper.GDI.RecordType.EMR_ELLIPSE:
        case Helper.GDI.RecordType.EMR_ARC:
        case Helper.GDI.RecordType.EMR_CHORD:
        case Helper.GDI.RecordType.EMR_PIE:
        case Helper.GDI.RecordType.EMR_SELECTPALETTE:
        case Helper.GDI.RecordType.EMR_CREATEPALETTE:
        case Helper.GDI.RecordType.EMR_SETPALETTEENTRIES:
        case Helper.GDI.RecordType.EMR_RESIZEPALETTE:
        case Helper.GDI.RecordType.EMR_REALIZEPALETTE:
        case Helper.GDI.RecordType.EMR_EXTFLOODFILL:
        case Helper.GDI.RecordType.EMR_ARCTO:
        case Helper.GDI.RecordType.EMR_POLYDRAW:
        case Helper.GDI.RecordType.EMR_SETARCDIRECTION:
        case Helper.GDI.RecordType.EMR_STROKEANDFILLPATH:
        case Helper.GDI.RecordType.EMR_FLATTENPATH:
        case Helper.GDI.RecordType.EMR_WIDENPATH:
        case Helper.GDI.RecordType.EMR_COMMENT:
        case Helper.GDI.RecordType.EMR_FILLRGN:
        case Helper.GDI.RecordType.EMR_FRAMERGN:
        case Helper.GDI.RecordType.EMR_INVERTRGN:
        case Helper.GDI.RecordType.EMR_PAINTRGN:
        case Helper.GDI.RecordType.EMR_BITBLT:
        case Helper.GDI.RecordType.EMR_STRETCHBLT:
        case Helper.GDI.RecordType.EMR_MASKBLT:
        case Helper.GDI.RecordType.EMR_PLGBLT:
        case Helper.GDI.RecordType.EMR_SETDIBITSTODEVICE:
        case Helper.GDI.RecordType.EMR_EXTTEXTOUTA:
        case Helper.GDI.RecordType.EMR_POLYPOLYLINE16:
        case Helper.GDI.RecordType.EMR_POLYDRAW16:
        case Helper.GDI.RecordType.EMR_CREATEMONOBRUSH:
        case Helper.GDI.RecordType.EMR_CREATEDIBPATTERNBRUSHPT:
        case Helper.GDI.RecordType.EMR_POLYTEXTOUTA:
        case Helper.GDI.RecordType.EMR_POLYTEXTOUTW:
        case Helper.GDI.RecordType.EMR_SETICMMODE:
        case Helper.GDI.RecordType.EMR_CREATECOLORSPACE:
        case Helper.GDI.RecordType.EMR_SETCOLORSPACE:
        case Helper.GDI.RecordType.EMR_DELETECOLORSPACE:
        case Helper.GDI.RecordType.EMR_GLSRECORD:
        case Helper.GDI.RecordType.EMR_GLSBOUNDEDRECORD:
        case Helper.GDI.RecordType.EMR_PIXELFORMAT:
        case Helper.GDI.RecordType.EMR_DRAWESCAPE:
        case Helper.GDI.RecordType.EMR_EXTESCAPE:
        case Helper.GDI.RecordType.EMR_SMALLTEXTOUT:
        case Helper.GDI.RecordType.EMR_FORCEUFIMAPPING:
        case Helper.GDI.RecordType.EMR_NAMEDESCAPE:
        case Helper.GDI.RecordType.EMR_COLORCORRECTPALETTE:
        case Helper.GDI.RecordType.EMR_SETICMPROFILEA:
        case Helper.GDI.RecordType.EMR_SETICMPROFILEW:
        case Helper.GDI.RecordType.EMR_ALPHABLEND:
        case Helper.GDI.RecordType.EMR_SETLAYOUT:
        case Helper.GDI.RecordType.EMR_TRANSPARENTBLT:
        case Helper.GDI.RecordType.EMR_GRADIENTFILL:
        case Helper.GDI.RecordType.EMR_SETLINKEDUFIS:
        case Helper.GDI.RecordType.EMR_SETTEXTJUSTIFICATION:
        case Helper.GDI.RecordType.EMR_COLORMATCHTOTARGETW:
        case Helper.GDI.RecordType.EMR_CREATECOLORSPACEW:
        default: {
          let recordName = 'UNKNOWN';
          for (const name in Helper.GDI.RecordType) {
            const recordTypes: any = Helper.GDI.RecordType;
            if (recordTypes[name] === type) {
              recordName = name;
              break;
            }
          }
          Helper.log(
            '[EMF] ' +
              recordName +
              ' record (0x' +
              type.toString(16) +
              ') at offset 0x' +
              curpos.toString(16) +
              ' with ' +
              size +
              ' bytes',
          );
          break;
        }
      }

      curpos += size;
    }

    if (!all) {
      throw new EMFJSError('Could not read all records');
    }
  }

  public getBounds(): RectL {
    return this._header.getBounds();
  }

  public play(gdi: GDIContext): void {
    const len = this._records.length;
    for (let i = 0; i < len; i++) {
      this._records[i](gdi);
    }
  }
}
