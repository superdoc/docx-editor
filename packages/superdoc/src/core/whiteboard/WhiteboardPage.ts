import { flattenPoints } from './helpers/flattenPoints';
import { getRandomId } from './helpers/getRandomId';
import { createTextarea } from './helpers/createTextarea';
import { isFiniteNumber } from '../../helpers/is-finite-number';

const DEFAULT_TEXT_FONT_SIZE = 18;

export type WhiteboardPageSize = { width: number; height: number; originalWidth?: number; originalHeight?: number };

export type Point = { x: number; y: number };

export type WhiteboardItemId = string | number;

export type WhiteboardStrokeType = 'draw' | 'erase';

export type WhiteboardStroke = { points: number[][]; color?: string; width?: number; type?: WhiteboardStrokeType };

export type WhiteboardTextItem = {
  id?: WhiteboardItemId;
  x: number;
  y: number;
  content: string;
  fontSize?: number;
  width?: number;
};

export type WhiteboardImageItem = {
  id?: WhiteboardItemId;
  stickerId?: string;
  x: number;
  y: number;
  src: string;
  width?: number;
  height?: number;
  type?: string;
};

export type WhiteboardStoredStroke = {
  pointsN: number[][];
  widthN?: number;
  color?: string;
  type?: WhiteboardStrokeType;
};

export type WhiteboardStoredTextItem = {
  id: WhiteboardItemId;
  xN: number;
  yN: number;
  content: string;
  fontSizeN?: number;
  widthN?: number | null;
};

export type WhiteboardStoredImageItem = {
  id: WhiteboardItemId;
  stickerId?: WhiteboardItemId | null;
  xN: number;
  yN: number;
  src: string;
  widthN?: number | null;
  heightN?: number | null;
  type?: string;
};

export type WhiteboardStoredPageData = {
  strokes?: WhiteboardStoredStroke[];
  text?: WhiteboardStoredTextItem[];
  images?: WhiteboardStoredImageItem[];
};

export type WhiteboardSerializedPage = {
  strokes: WhiteboardStoredStroke[];
  text: WhiteboardStoredTextItem[];
  images: WhiteboardStoredImageItem[];
};

export type WhiteboardRendererEvent = { target?: unknown; cancelBubble?: boolean };

export interface WhiteboardRendererNode {
  _whiteboardId?: WhiteboardItemId;
  on(events: string, handler: (event: WhiteboardRendererEvent) => void): unknown;
  destroy(): unknown;
  name(): string;
  name(name: string): unknown;
}

export interface WhiteboardShapeNode extends WhiteboardRendererNode {
  x(): number;
  x(value: number): unknown;
  y(): number;
  y(value: number): unknown;
  width(): number;
  width(value: number): unknown;
  height(): number;
  height(value: number): unknown;
  scaleX(): number;
  scaleY(): number;
  scale(scale: Point): unknown;
  draggable(value: boolean): unknown;
  position(): Point;
}

export interface WhiteboardTextNode extends WhiteboardShapeNode {
  scaleY(): number;
  scaleY(value: number): unknown;
  setAttrs(attrs: { width: number; scaleX: number; scaleY?: number }): unknown;
  text(): string;
  text(value: string): unknown;
  fontSize(): number;
  fontFamily(): string;
  fill(): string | CanvasGradient;
}

export interface WhiteboardLineNode extends WhiteboardRendererNode {
  points(points: number[]): unknown;
}

export type WhiteboardBox = { x: number; y: number; width: number; height: number; rotation: number };

export type WhiteboardBoundBoxFunc = (oldBox: WhiteboardBox, newBox: WhiteboardBox) => WhiteboardBox;

export interface WhiteboardTransformerNode {
  destroy(): unknown;
  nodes(nodes: WhiteboardShapeNode[]): unknown;
  enabledAnchors(anchors: string[]): unknown;
  boundBoxFunc(fn: WhiteboardBoundBoxFunc): unknown;
}

export interface WhiteboardLayerNode {
  add(child: WhiteboardRendererNode | WhiteboardTransformerNode): unknown;
  find(selector: string): WhiteboardShapeNode[];
  destroyChildren(): unknown;
  batchDraw(): unknown;
  listening(listening: boolean): unknown;
  getCanvas(): { setPixelRatio(ratio: number): unknown };
}

export interface WhiteboardStageNode {
  on(events: string, handler: (event: WhiteboardRendererEvent) => void): unknown;
  add(layer: WhiteboardLayerNode): unknown;
  size(size: { width: number; height: number }): unknown;
  getPointerPosition(): Point | null;
  destroy(): unknown;
}

export type WhiteboardLineConfig = {
  points: number[];
  stroke: string;
  strokeWidth: number;
  lineCap: 'round';
  lineJoin: 'round';
  globalCompositeOperation: 'destination-out' | 'source-over';
};

export interface WhiteboardPageRenderer {
  Stage: new (config: { container: HTMLDivElement; width: number; height: number }) => WhiteboardStageNode;
  Layer: new () => WhiteboardLayerNode;
  Line: new (config: WhiteboardLineConfig) => WhiteboardLineNode;
  Text: new (config: {
    x: number;
    y: number;
    text: string;
    fontSize: number;
    fontFamily: string;
    fill: string;
    draggable: boolean;
    width: number | undefined;
  }) => WhiteboardTextNode;
  Image: new (config: {
    x: number;
    y: number;
    image: HTMLImageElement;
    width: number;
    height: number;
    draggable: boolean;
  }) => WhiteboardShapeNode;
  Transformer: new (config: {
    enabledAnchors: string[];
    rotateEnabled: boolean;
    keepRatio: boolean;
    boundBoxFunc: WhiteboardBoundBoxFunc;
  }) => WhiteboardTransformerNode;
}

export type WhiteboardPageInit = {
  pageIndex: number;
  enabled: boolean;
  Renderer?: WhiteboardPageRenderer;
  onChange?: () => void;
  onToolChange?: (tool: string) => void;
};

type WhiteboardTextGeometry = { x?: number; y?: number; width?: number | null; fontSize?: number };

type WhiteboardImageGeometry = { x?: number; y?: number; width?: number; height?: number };

export class WhiteboardPage {
  pageIndex: number;

  strokes: WhiteboardStoredStroke[] = [];

  text: WhiteboardStoredTextItem[] = [];

  images: WhiteboardStoredImageItem[] = [];

  size: WhiteboardPageSize | null = null;

  originalSize: { width: number | null; height: number | null } | null = null;

  #Renderer: WhiteboardPageRenderer | undefined;

  #stage: WhiteboardStageNode | null = null;

  #layer: WhiteboardLayerNode | null = null;

  #strokesLayer: WhiteboardLayerNode | null = null;

  #transformer: WhiteboardTransformerNode | null = null;

  #containerEl: HTMLElement | null = null;

  #pendingImageIds = new Set<WhiteboardItemId>();

  #isDrawing = false;

  #currentLine: WhiteboardLineNode | null = null;

  #currentPoints: number[] = [];

  #currentStrokeWidth: number | null = null;

  #currentTool = 'select';

  #enabled = false;

  #selectedNode: WhiteboardShapeNode | null = null;

  #strokeColor = '#2293fb';

  #strokeWidth = 5;

  #onChange: (() => void) | undefined;

  #onToolChange: ((tool: string) => void) | undefined;

  constructor(props: WhiteboardPageInit) {
    this.#Renderer = props.Renderer;
    this.#enabled = props.enabled;
    this.pageIndex = props.pageIndex;

    this.#onChange = props.onChange;
    this.#onToolChange = props.onToolChange;
  }

  #fromNormalizedStroke(stroke: WhiteboardStoredStroke): { points: number[][]; strokeWidth: number } {
    const { width: pageWidth = 1, height: pageHeight = 1 } = this.size || {};
    const pointsN = Array.isArray(stroke.pointsN) ? stroke.pointsN : [];
    const points = pointsN.map((pair) => {
      return [pair[0] * pageWidth, pair[1] * pageHeight];
    });
    const strokeWidth = isFiniteNumber(stroke.widthN)
      ? stroke.widthN * ((pageWidth + pageHeight) / 2)
      : this.#strokeWidth;
    return { points, strokeWidth };
  }

  #toNormalizedStroke(stroke: WhiteboardStroke): { pointsN: number[][]; widthN: number | undefined } {
    const { width: pageWidth = 1, height: pageHeight = 1 } = this.size || {};
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    const pointsN = points.map((pair) => [pair[0] / pageWidth, pair[1] / pageHeight]);
    const widthN = isFiniteNumber(stroke.width) ? stroke.width / ((pageWidth + pageHeight) / 2) : undefined;
    return { pointsN, widthN };
  }

  #fromNormalizedText(item: WhiteboardStoredTextItem): {
    x: number;
    y: number;
    width: number | undefined;
    fontSize: number;
  } {
    const { width: pageWidth = 1, height: pageHeight = 1 } = this.size || {};
    const x = (item.xN ?? 0) * pageWidth;
    const y = (item.yN ?? 0) * pageHeight;
    const width = isFiniteNumber(item.widthN) ? item.widthN * pageWidth : undefined;
    const fontSize = isFiniteNumber(item.fontSizeN) ? item.fontSizeN * pageHeight : DEFAULT_TEXT_FONT_SIZE;
    return { x, y, width, fontSize };
  }

  #toNormalizedText(item: WhiteboardTextGeometry): {
    xN: number;
    yN: number;
    widthN: number | null;
    fontSizeN: number;
  } {
    const { width: pageWidth = 1, height: pageHeight = 1 } = this.size || {};
    const originalHeight = this.originalSize?.height ?? pageHeight;
    const xN = (item.x ?? 0) / pageWidth;
    const yN = (item.y ?? 0) / pageHeight;
    const widthN = isFiniteNumber(item.width) ? item.width / pageWidth : null;
    const fontSizeN = isFiniteNumber(item.fontSize)
      ? item.fontSize / originalHeight
      : DEFAULT_TEXT_FONT_SIZE / originalHeight;
    return { xN, yN, widthN, fontSizeN };
  }

  #fromNormalizedImage(item: WhiteboardStoredImageItem): {
    x: number;
    y: number;
    width: number | undefined;
    height: number | undefined;
  } {
    const { width: pageWidth = 1, height: pageHeight = 1 } = this.size || {};
    const x = (item.xN ?? 0) * pageWidth;
    const y = (item.yN ?? 0) * pageHeight;
    const width = isFiniteNumber(item.widthN) ? item.widthN * pageWidth : undefined;
    const height = isFiniteNumber(item.heightN) ? item.heightN * pageHeight : undefined;
    return { x, y, width, height };
  }

  #toNormalizedImage(item: WhiteboardImageGeometry): {
    xN: number;
    yN: number;
    widthN: number | null;
    heightN: number | null;
  } {
    const { width: pageWidth = 1, height: pageHeight = 1 } = this.size || {};
    const xN = (item.x ?? 0) / pageWidth;
    const yN = (item.y ?? 0) / pageHeight;
    const widthN = isFiniteNumber(item.width) ? item.width / pageWidth : null;
    const heightN = isFiniteNumber(item.height) ? item.height / pageHeight : null;
    return { xN, yN, widthN, heightN };
  }

  #getCurrentScale(): number {
    const current = this.size?.width;
    const original = this.originalSize?.width ?? current;
    if (!isFiniteNumber(current) || !isFiniteNumber(original) || !original) return 1;
    return current / original;
  }

  #attachEventListeners() {
    if (!this.#stage || !this.#layer) {
      return;
    }

    this.#stage.on('mousedown touchstart', () => {
      this.#handleDrawStart();
    });

    this.#stage.on('mousemove touchmove', () => {
      this.#handleDrawMove();
    });

    this.#stage.on('mouseup touchend', () => {
      this.#handleDrawEnd();
    });

    this.#stage.on('click tap', (event) => {
      this.#handleStageClick(event);
    });

    window.addEventListener('keydown', this.#handleKeydown);
  }

  setTool(tool: string): void {
    this.#currentTool = tool;
    this.#updateStrokesLayerListening();
    this.#clearSelection();
    this.render();
  }

  getTool(): string {
    return this.#currentTool;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = Boolean(enabled);
    this.#updateStrokesLayerListening();
    this.#clearSelection();
    this.render();
  }

  isEnabled(): boolean {
    return this.#enabled;
  }

  setSize(size: WhiteboardPageSize): void {
    if (!size) return;
    const { width, height, originalWidth, originalHeight } = size;
    this.size = { width, height };
    this.originalSize = { width: originalWidth ?? null, height: originalHeight ?? null };
  }

  resize(width: number, height: number): void {
    if (!this.#stage) return;
    this.#stage.size({ width, height });
    this.#applyPixelRatio();
    this.render();
  }

  mount(container: HTMLDivElement): void {
    if (!container) {
      return;
    }
    if (this.#stage && this.#containerEl === container) {
      return;
    }

    if (this.#stage) {
      this.destroy();
    }

    const Renderer = this.#Renderer;
    if (!Renderer) {
      throw new Error('WhiteboardPage.mount requires a Renderer');
    }

    const width = this.size?.width || container.clientWidth || 1;
    const height = this.size?.height || container.clientHeight || 1;

    this.#containerEl = container;
    this.#stage = new Renderer.Stage({ container, width, height });
    this.#layer = new Renderer.Layer();
    this.#strokesLayer = new Renderer.Layer();
    this.#stage.add(this.#layer);
    this.#stage.add(this.#strokesLayer);
    this.#applyPixelRatio();

    this.#updateStrokesLayerListening();
    this.#attachEventListeners();

    this.render();
  }

  render(): void {
    const layer = this.#layer;
    const strokesLayer = this.#strokesLayer;
    if (!layer || !strokesLayer) {
      return;
    }

    if (this.#transformer) {
      this.#transformer.destroy();
      this.#transformer = null;
    }

    const texts = layer.find('.wb-text');
    texts.forEach((node) => node.destroy());
    strokesLayer.destroyChildren();

    this.renderStrokes();
    this.renderText();
    this.renderImages();

    layer.batchDraw();
    strokesLayer.batchDraw();
  }

  #applyPixelRatio() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    if (this.#layer?.getCanvas) {
      this.#layer.getCanvas().setPixelRatio(ratio);
    }
    if (this.#strokesLayer?.getCanvas) {
      this.#strokesLayer.getCanvas().setPixelRatio(ratio);
    }
  }

  #updateStrokesLayerListening() {
    if (!this.#strokesLayer) return;
    const isDrawMode = this.#currentTool === 'draw' || this.#currentTool === 'erase';
    const isListening = Boolean(this.#enabled && isDrawMode);
    this.#strokesLayer.listening(isListening);
  }

  renderStrokes(): void {
    const Renderer = this.#Renderer;
    const strokesLayer = this.#strokesLayer;
    if (!Renderer || !strokesLayer) return;
    this.strokes.forEach((stroke) => {
      const { points, strokeWidth } = this.#fromNormalizedStroke(stroke);
      const line = new Renderer.Line({
        points: flattenPoints(points),
        stroke: stroke.color || this.#strokeColor,
        strokeWidth,
        lineCap: 'round',
        lineJoin: 'round',
        globalCompositeOperation: stroke.type === 'erase' ? 'destination-out' : 'source-over',
      });
      line.name('wb-stroke');
      strokesLayer.add(line);
    });
  }

  renderText(): void {
    const Renderer = this.#Renderer;
    const layer = this.#layer;
    if (!Renderer || !layer) return;
    this.text.forEach((item) => {
      const { x, y, width, fontSize } = this.#fromNormalizedText(item);
      const textNode = new Renderer.Text({
        x,
        y,
        text: item.content,
        fontSize,
        fontFamily: 'Arial, sans-serif',
        fill: '#2293fb',
        draggable: this.#currentTool === 'select',
        width,
      });

      textNode.name('wb-text');
      textNode._whiteboardId = item.id;
      this.#attachTextNodeEvents(textNode, item);

      layer.add(textNode);
    });
  }

  #attachTextNodeEvents(textNode: WhiteboardTextNode, item: WhiteboardStoredTextItem) {
    textNode.on('click tap', (event) => {
      if (this.#currentTool !== 'select' || !this.#enabled) return;
      event.cancelBubble = true;
      this.#selectNode(textNode);
    });

    textNode.on('dragend', () => {
      const { xN, yN } = this.#toNormalizedText({
        x: textNode.x(),
        y: textNode.y(),
        fontSize: item.fontSizeN ? item.fontSizeN * (this.size?.height || 1) : DEFAULT_TEXT_FONT_SIZE,
        width: item.widthN ? item.widthN * (this.size?.width || 1) : null,
      });
      item.xN = xN;
      item.yN = yN;
      this.#triggerChanged();
    });

    textNode.on('transform', () => {
      textNode.scaleY(1);
      textNode.setAttrs({
        width: textNode.width() * textNode.scaleX(),
        scaleX: 1,
      });
    });

    textNode.on('transformend', () => {
      textNode.setAttrs({
        width: Math.max(1, textNode.width() * textNode.scaleX()),
        scaleX: 1,
        scaleY: 1,
      });
      const nextWidth = textNode.width();
      const pageWidth = this.size?.width || 1;
      item.widthN = nextWidth / pageWidth;
      item.xN = textNode.x() / pageWidth;
      item.yN = textNode.y() / (this.size?.height || 1);
      this.#triggerChanged();
    });

    textNode.on('dblclick dbltap', (event) => {
      if (this.#currentTool !== 'select' || !this.#enabled) return;
      event.cancelBubble = true;
      this.#editTextNode(textNode, item);
    });
  }

  renderImages(): void {
    const existingNodes = this.#layer?.find('.wb-image') ?? [];
    const existingById = new Map<WhiteboardItemId | undefined, WhiteboardShapeNode>();

    existingNodes.forEach((node) => {
      existingById.set(node._whiteboardId, node);
    });

    const imageIds = new Set<WhiteboardItemId | undefined>(this.images.map((item) => item.id));
    existingNodes.forEach((node) => {
      if (!imageIds.has(node._whiteboardId)) {
        node.destroy();
      }
    });

    const renderImageItem = (item: WhiteboardStoredImageItem, name: string) => {
      const { x, y, width, height } = this.#fromNormalizedImage(item);
      const existing = existingById.get(item.id);

      if (existing) {
        if (Number.isFinite(x)) existing.x(x);
        if (Number.isFinite(y)) existing.y(y);
        if (isFiniteNumber(width)) existing.width(width);
        if (isFiniteNumber(height)) existing.height(height);
        existing.draggable(this.#currentTool === 'select');
        return;
      }

      if (this.#pendingImageIds.has(item.id)) {
        return;
      }

      this.#pendingImageIds.add(item.id);
      const imageObj = new window.Image();
      imageObj.crossOrigin = 'Anonymous';
      imageObj.onload = () => {
        if (existingById.get(item.id)) {
          this.#pendingImageIds.delete(item.id);
          return;
        }
        const layer = this.#layer;
        const Renderer = this.#Renderer;
        if (!layer || !Renderer) {
          this.#pendingImageIds.delete(item.id);
          return;
        }
        const imageNode = new Renderer.Image({
          x,
          y,
          image: imageObj,
          width: width ?? imageObj.width,
          height: height ?? imageObj.height,
          draggable: this.#currentTool === 'select',
        });

        imageNode.name(name);
        imageNode._whiteboardId = item.id;
        this.#attachImageNodeEvents(imageNode, item);

        layer.add(imageNode);
        layer.batchDraw();
        this.#pendingImageIds.delete(item.id);
      };
      imageObj.onerror = () => {
        this.#pendingImageIds.delete(item.id);
      };
      imageObj.src = item.src;
    };

    this.images.forEach((item) => renderImageItem(item, 'wb-image'));
  }

  #attachImageNodeEvents(imageNode: WhiteboardShapeNode, item: WhiteboardStoredImageItem) {
    imageNode.on('click tap', (event) => {
      if (this.#currentTool !== 'select' || !this.#enabled) return;
      event.cancelBubble = true;
      this.#selectNode(imageNode);
    });

    imageNode.on('dragend', () => {
      const pageWidth = this.size?.width || 1;
      const pageHeight = this.size?.height || 1;
      item.xN = imageNode.x() / pageWidth;
      item.yN = imageNode.y() / pageHeight;
      this.#triggerChanged();
    });

    imageNode.on('transformend', () => {
      const scaleX = imageNode.scaleX();
      const scaleY = imageNode.scaleY();
      const nextWidth = Math.max(1, imageNode.width() * scaleX);
      const nextHeight = Math.max(1, imageNode.height() * scaleY);
      imageNode.scale({ x: 1, y: 1 });
      imageNode.width(nextWidth);
      imageNode.height(nextHeight);
      const pageWidth = this.size?.width || 1;
      const pageHeight = this.size?.height || 1;
      item.widthN = nextWidth / pageWidth;
      item.heightN = nextHeight / pageHeight;
      item.xN = imageNode.x() / pageWidth;
      item.yN = imageNode.y() / pageHeight;
      this.#triggerChanged();
    });
  }

  destroy(): void {
    if (this.#stage) {
      this.#stage.destroy();
    }

    this.#stage = null;
    this.#layer = null;
    this.#strokesLayer = null;
    this.#containerEl = null;
    this.#isDrawing = false;
    this.#currentLine = null;
    this.#currentPoints = [];
    this.#selectedNode = null;
    this.#transformer = null;

    window.removeEventListener('keydown', this.#handleKeydown);
  }

  toJSON(): WhiteboardSerializedPage {
    return {
      strokes: this.strokes,
      text: this.text,
      images: this.images,
    };
  }

  applyData(data: WhiteboardStoredPageData = {}): void {
    const strokes = Array.isArray(data.strokes) ? data.strokes : [];
    const text = Array.isArray(data.text) ? data.text : [];
    const images = Array.isArray(data.images) ? data.images : [];

    this.strokes = strokes;
    this.text = text;
    this.images = images;

    this.render();
  }

  #triggerChanged() {
    if (this.#onChange) {
      this.#onChange();
    }
  }

  addStroke(stroke: WhiteboardStroke): void {
    if (!stroke || !Array.isArray(stroke.points)) {
      return;
    }
    const { pointsN, widthN } = this.#toNormalizedStroke(stroke);
    this.strokes.push({
      pointsN,
      widthN,
      color: stroke.color,
      type: stroke.type,
    });
  }

  addText(item: WhiteboardTextItem): void {
    if (!item || typeof item.content !== 'string') {
      return;
    }

    const { xN, yN, widthN, fontSizeN } = this.#toNormalizedText(item);
    this.text.push({
      id: item.id ?? getRandomId('text'),
      xN,
      yN,
      content: item.content,
      fontSizeN,
      widthN,
    });

    this.render();
    this.#triggerChanged();
  }

  addImage(item: WhiteboardImageItem): void {
    if (!item || !item.src) {
      return;
    }

    const { xN, yN, widthN, heightN } = this.#toNormalizedImage(item);
    const imageItem: WhiteboardStoredImageItem = {
      id: item.id ?? getRandomId('image'),
      stickerId: item.stickerId ?? (item.type === 'sticker' ? (item.id ?? null) : null),
      xN,
      yN,
      src: item.src,
      widthN,
      heightN,
      type: item.type ?? 'image',
    };
    this.images.push(imageItem);

    this.render();
    this.#triggerChanged();
  }

  #clearSelection() {
    if (!this.#transformer) return;
    this.#transformer.destroy();
    this.#transformer = null;
    this.#selectedNode = null;
    this.#layer?.batchDraw();
  }

  #selectNode(node: WhiteboardShapeNode) {
    const layer = this.#layer;
    const Renderer = this.#Renderer;
    if (!layer || !Renderer) {
      return;
    }

    this.#selectedNode = node;

    const isText = node.name && node.name() === 'wb-text';
    const textAnchors = ['middle-left', 'middle-right'];
    const imageAnchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    const anchors = isText ? textAnchors : imageAnchors;

    const boundBoxFunc: WhiteboardBoundBoxFunc = (oldBox, newBox) => {
      const min = 20;
      if (newBox.width < min) return oldBox;
      if (isText) {
        return {
          ...newBox,
          height: oldBox.height,
          y: oldBox.y,
        };
      }
      if (newBox.height < min) return oldBox;
      return newBox;
    };

    if (!this.#transformer) {
      this.#transformer = new Renderer.Transformer({
        enabledAnchors: anchors,
        rotateEnabled: false,
        keepRatio: false,
        boundBoxFunc,
      });
      this.#transformer.nodes([node]);
      layer.add(this.#transformer);
    } else {
      this.#transformer.nodes([node]);
      this.#transformer.enabledAnchors(anchors);
      this.#transformer.boundBoxFunc(boundBoxFunc);
    }

    layer.batchDraw();
  }

  #deleteSelectedNode() {
    if (!this.#selectedNode) {
      return;
    }

    const node = this.#selectedNode;
    const name = node.name && node.name();

    const deleteHandlers: Partial<Record<string, () => void>> = {
      'wb-text': () => {
        const id = node._whiteboardId;
        this.text = this.text.filter((item) => item.id !== id);
      },
      'wb-image': () => {
        const id = node._whiteboardId;
        this.images = this.images.filter((item) => item.id !== id);
      },
    };
    const handler = deleteHandlers[name];

    if (handler) handler();
    node.destroy();

    this.#clearSelection();
    this.render();
  }

  #handleKeydown = (event: KeyboardEvent): void => {
    if (!this.#selectedNode || !this.#enabled || this.#currentTool !== 'select') {
      return;
    }

    const target = event.target;
    const targetTag = target && 'tagName' in target ? target.tagName : undefined;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') {
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      this.#deleteSelectedNode();
      this.#triggerChanged();
    }
  };

  #handleStageClick(event: WhiteboardRendererEvent) {
    const stage = this.#stage;
    if (!this.#enabled || !stage) {
      return;
    }

    const handlers: Partial<Record<string, () => void>> = {
      text: () => {
        const pos = stage.getPointerPosition();
        if (!pos) return;
        this.#startTextInput(pos.x, pos.y);
      },
      select: () => {
        if (event?.target === stage) {
          this.#clearSelection();
        }
      },
    };

    const handler = handlers[this.#currentTool];
    if (handler) handler();
  }

  #handleDrawStart() {
    if (!this.#enabled || (this.#currentTool !== 'draw' && this.#currentTool !== 'erase')) {
      return;
    }
    this.#isDrawing = true;
    const stage = this.#stage;
    const strokesLayer = this.#strokesLayer;
    const Renderer = this.#Renderer;
    if (!stage || !strokesLayer || !Renderer) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const isErase = this.#currentTool === 'erase';
    const strokeWidth = this.#strokeWidth * this.#getCurrentScale();
    this.#currentPoints = [pos.x, pos.y];
    this.#currentLine = new Renderer.Line({
      points: this.#currentPoints,
      stroke: this.#strokeColor,
      strokeWidth: isErase ? strokeWidth * 3 : strokeWidth,
      lineCap: 'round',
      lineJoin: 'round',
      globalCompositeOperation: isErase ? 'destination-out' : 'source-over',
    });
    this.#currentStrokeWidth = strokeWidth;
    strokesLayer.add(this.#currentLine);
  }

  #handleDrawMove() {
    if (!this.#enabled || (this.#currentTool !== 'draw' && this.#currentTool !== 'erase')) {
      return;
    }
    if (!this.#isDrawing || !this.#currentLine) {
      return;
    }
    const stage = this.#stage;
    const strokesLayer = this.#strokesLayer;
    if (!stage || !strokesLayer) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    this.#currentPoints.push(pos.x, pos.y);
    this.#currentLine.points(this.#currentPoints);
    strokesLayer.batchDraw();
  }

  #handleDrawEnd() {
    if (!this.#enabled || (this.#currentTool !== 'draw' && this.#currentTool !== 'erase')) {
      return;
    }
    if (!this.#isDrawing || !this.#currentLine) {
      return;
    }
    this.#isDrawing = false;
    const pairs: number[][] = [];
    for (let i = 0; i < this.#currentPoints.length; i += 2) {
      pairs.push([this.#currentPoints[i], this.#currentPoints[i + 1]]);
    }
    const isErase = this.#currentTool === 'erase';
    const baseWidth = this.#currentStrokeWidth ?? this.#strokeWidth;
    this.addStroke({
      points: pairs,
      color: this.#strokeColor,
      width: isErase ? baseWidth * 3 : baseWidth,
      type: isErase ? 'erase' : 'draw',
    });
    this.#triggerChanged();
    this.#currentLine = null;
    this.#currentPoints = [];
    this.#currentStrokeWidth = null;
  }

  #startTextInput(x: number, y: number) {
    const containerEl = this.#containerEl;
    if (!containerEl) {
      return;
    }

    const scale = this.#getCurrentScale();
    const fontSize = DEFAULT_TEXT_FONT_SIZE * scale;
    const textarea = createTextarea({
      left: x,
      top: y,
      height: Math.ceil(fontSize * 1.4),
      background: 'transparent',
      fontSize,
      color: '#2293fb',
    });
    containerEl.append(textarea);

    textarea.focus();
    textarea.select();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const text = textarea.value.trim();
      if (text) {
        this.addText({ x, y, content: text });
        if (this.#currentTool === 'text' && this.#onToolChange) {
          this.#onToolChange('select');
        }
      }
      if (textarea.parentNode === this.#containerEl) {
        containerEl.removeChild(textarea);
      }
    };

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finish();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
    });
    textarea.addEventListener('blur', finish);
  }

  #editTextNode(textNode: WhiteboardTextNode, item: WhiteboardStoredTextItem) {
    if (!this.#containerEl || !this.#stage) {
      return;
    }

    this.#clearSelection();

    const textPosition = textNode.position();
    const textarea = createTextarea({
      value: textNode.text(),
      left: textPosition.x,
      top: textPosition.y,
      width: Math.max(textNode.width(), 120),
      height: Math.max(textNode.height(), 24),
      fontSize: textNode.fontSize(),
      fontFamily: textNode.fontFamily(),
      color: textNode.fill ? textNode.fill() : '#2293fb',
      background: 'white',
      resize: 'both',
    });
    this.#containerEl.appendChild(textarea);

    textarea.focus();
    textarea.select();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const value = textarea.value.trim();
      if (value) {
        textNode.text(value);
        item.content = value;
        this.#layer?.batchDraw();
        this.#triggerChanged();
      }
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea);
      }
    };

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finish();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
    });
    textarea.addEventListener('blur', finish);
  }
}
