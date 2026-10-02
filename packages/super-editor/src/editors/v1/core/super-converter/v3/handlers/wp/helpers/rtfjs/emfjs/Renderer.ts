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
import { Blob } from './Blob';
import { EMFRecords } from './EMFRecords';
import { GDIContext } from './GDIContext';
import { EMFJSError, Helper } from './Helper';

export interface IRendererSettings {
  width: string;
  height: string;
  wExt: number;
  hExt: number;
  xExt: number;
  yExt: number;
  mapMode: number;
}

export class Renderer {
  private _img: EMF;

  constructor(blob: ArrayBuffer, renderUnicodeText = false) {
    this.parse(blob, renderUnicodeText);
    Helper.log('EMFJS.Renderer instantiated');
  }

  public render(info: IRendererSettings): SVGElement {
    const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Get the actual bounds from the EMF file
    const emfBounds = this._img.getBounds();

    const gdi = this._render(
      new SVG(svgElement),
      info.mapMode,
      emfBounds.width,
      emfBounds.height,
      emfBounds.width,
      emfBounds.height,
    );
    svgElement.setAttribute('viewBox', [0, 0, emfBounds.width, emfBounds.height].join(' '));

    // Set preserveAspectRatio based on the final map mode after rendering:
    // - MM_ANISOTROPIC (8): allows independent X/Y scaling (no aspect ratio preservation)
    // - All other modes (including MM_ISOTROPIC): preserve aspect ratio
    const finalMapMode = gdi.getMapMode();
    const preserveAspectRatio = finalMapMode === Helper.GDI.MapMode.MM_ANISOTROPIC ? 'none' : 'xMidYMid meet';
    svgElement.setAttribute('preserveAspectRatio', preserveAspectRatio);

    svgElement.setAttribute('width', info.width);
    svgElement.setAttribute('height', info.height);
    return svgElement;
  }

  private parse(blob: ArrayBuffer, renderUnicodeText: boolean) {
    this._img = null;

    const reader = new Blob(blob);

    const type = reader.readUint32();
    if (type !== 0x00000001) {
      throw new EMFJSError('Not an EMF file');
    }
    const size = reader.readUint32();
    if (size % 4 !== 0) {
      throw new EMFJSError('Not an EMF file');
    }

    this._img = new EMF(reader, size, renderUnicodeText);

    if (this._img == null) {
      throw new EMFJSError('Format not recognized');
    }
  }

  private _render(svg: SVG, mapMode: number, w: number, h: number, xExt: number, yExt: number): GDIContext {
    const gdi = new GDIContext(svg);
    gdi.setWindowExtEx(w, h);
    gdi.setViewportExtEx(xExt, yExt);
    gdi.setMapMode(mapMode);
    Helper.log('[EMF] BEGIN RENDERING --->');
    this._img.render(gdi);
    if (gdi.hasUnsupportedTextMode()) {
      throw new EMFJSError('Unsupported Unicode text alignment', 'unsupported-text-mode');
    }
    Helper.log('[EMF] <--- DONE RENDERING');
    return gdi;
  }
}

class EMF {
  private _hdrsize: number;
  private _records: EMFRecords;

  constructor(reader: Blob, hdrsize: number, renderUnicodeText: boolean) {
    this._hdrsize = hdrsize;
    this._records = new EMFRecords(reader, this._hdrsize, renderUnicodeText);
  }

  public render(gdi: GDIContext): void {
    this._records.play(gdi);
  }

  public getBounds(): { width: number; height: number } {
    const bounds = this._records.getBounds();
    return {
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    };
  }
}
