import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { WhiteboardPage } from './WhiteboardPage.js';

const makeNode = () => {
  const listeners = new Map();
  let _name = '';
  const attrs = { x: 0, y: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, fontSize: 18 };
  return {
    _listeners: listeners,
    on: vi.fn((events, fn) => events.split(' ').forEach((e) => listeners.set(e, fn))),
    off: vi.fn(),
    destroy: vi.fn(),
    name: vi.fn((n) => (n !== undefined ? (_name = n) : _name)),
    x: vi.fn((v) => (v !== undefined ? (attrs.x = v) : attrs.x)),
    y: vi.fn((v) => (v !== undefined ? (attrs.y = v) : attrs.y)),
    width: vi.fn((v) => (v !== undefined ? (attrs.width = v) : attrs.width)),
    height: vi.fn((v) => (v !== undefined ? (attrs.height = v) : attrs.height)),
    scaleX: vi.fn((v) => (v !== undefined ? (attrs.scaleX = v) : attrs.scaleX)),
    scaleY: vi.fn((v) => (v !== undefined ? (attrs.scaleY = v) : attrs.scaleY)),
    scale: vi.fn((v) => Object.assign(attrs, { scaleX: v.x, scaleY: v.y })),
    setAttrs: vi.fn((o) => Object.assign(attrs, o)),
    text: vi.fn((v) => (v !== undefined ? (attrs._text = v) : attrs._text)),
    fontSize: vi.fn((v) => (v !== undefined ? (attrs.fontSize = v) : attrs.fontSize)),
    fontFamily: vi.fn(() => 'Arial'),
    fill: vi.fn(() => '#000'),
    position: vi.fn(() => ({ x: attrs.x, y: attrs.y })),
    points: vi.fn((v) => (v !== undefined ? (attrs.points = v) : attrs.points)),
    draggable: vi.fn((v) => (v !== undefined ? (attrs.draggable = v) : attrs.draggable)),
    getCanvas: vi.fn(() => ({ setPixelRatio: vi.fn() })),
    nodes: vi.fn(),
    enabledAnchors: vi.fn(),
    boundBoxFunc: vi.fn(),
  };
};

const makeLayer = () => {
  const children = [];
  const layer = makeNode();
  layer.add = vi.fn((n) => children.push(n));
  layer.find = vi.fn((sel) => children.filter((c) => c.name() === sel.replace('.', '')));
  layer.destroyChildren = vi.fn(() => {
    children.length = 0;
  });
  layer.batchDraw = vi.fn();
  layer.listening = vi.fn();
  layer._children = children;
  return layer;
};

const makeStage = () => {
  const stageListeners = new Map();
  const layers = [];
  const stage = makeNode();
  stage.on = vi.fn((events, fn) => events.split(' ').forEach((e) => stageListeners.set(e, fn)));
  stage.add = vi.fn((l) => layers.push(l));
  stage.size = vi.fn();
  stage.getPointerPosition = vi.fn(() => ({ x: 10, y: 10 }));
  stage._listeners = stageListeners;
  stage._layers = layers;
  return stage;
};

const makeRenderer = () => {
  const Stage = vi.fn(function (opts) {
    Object.assign(this, makeStage());
    this._opts = opts;
  });
  const Layer = vi.fn(function () {
    Object.assign(this, makeLayer());
  });
  const Line = vi.fn(function (opts) {
    Object.assign(this, makeNode());
    this._opts = opts;
  });
  const Text = vi.fn(function (opts) {
    Object.assign(this, makeNode());
    this._opts = opts;
  });
  const Image = vi.fn(function (opts) {
    Object.assign(this, makeNode());
    this._opts = opts;
  });
  const Transformer = vi.fn(function (opts) {
    Object.assign(this, makeNode());
    this._opts = opts;
  });
  return { Stage, Layer, Line, Text, Image, Transformer };
};

const mountedPages = [];
const mountedContainers = [];

const mountPage = (opts = {}) => {
  const renderer = opts.Renderer ?? makeRenderer();
  const page = new WhiteboardPage({
    pageIndex: 0,
    enabled: true,
    Renderer: renderer,
    onChange: opts.onChange ?? vi.fn(),
    onToolChange: opts.onToolChange ?? vi.fn(),
  });
  page.setSize({ width: 100, height: 100 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  page.mount(container);
  mountedPages.push(page);
  mountedContainers.push(container);
  return { page, renderer, container };
};

describe('WhiteboardPage: image async + transform paths', () => {
  const originalImage = window.Image;
  let loadedImages;

  beforeEach(() => {
    loadedImages = [];
    window.Image = class {
      constructor() {
        this.onload = null;
        this.onerror = null;
        loadedImages.push(this);
      }
      set src(_value) {
        queueMicrotask(() => this.onload && this.onload());
      }
    };
  });

  afterEach(() => {
    while (mountedPages.length) mountedPages.pop().destroy();
    while (mountedContainers.length) mountedContainers.pop().remove();
    window.Image = originalImage;
  });

  it('image onload creates an Image node and adds it to the layer', async () => {
    const { page, renderer } = mountPage();
    page.applyData({
      images: [{ id: 'i1', xN: 0, yN: 0, src: '/x.png', type: 'image' }],
    });
    page.render();
    await Promise.resolve();
    expect(renderer.Image).toHaveBeenCalled();
  });

  it('image onerror clears pending state without creating a node', async () => {
    window.Image = class {
      constructor() {
        this.onload = null;
        this.onerror = null;
      }
      set src(_) {
        queueMicrotask(() => this.onerror && this.onerror());
      }
    };
    const { page, renderer } = mountPage();
    page.applyData({ images: [{ id: 'i1', xN: 0, yN: 0, src: '/x.png' }] });
    page.render();
    await Promise.resolve();
    expect(renderer.Image).not.toHaveBeenCalled();
  });

  it('renderImages reconciles existing nodes by id instead of recreating', async () => {
    const { page, renderer } = mountPage();
    page.applyData({
      images: [{ id: 'i1', xN: 0.1, yN: 0.1, src: '/x.png', widthN: 0.5, heightN: 0.5 }],
    });
    page.render();
    await Promise.resolve();
    const callsBefore = renderer.Image.mock.calls.length;

    page.applyData({
      images: [{ id: 'i1', xN: 0.2, yN: 0.2, src: '/x.png', widthN: 0.5, heightN: 0.5 }],
    });
    page.render();
    await Promise.resolve();
    expect(renderer.Image.mock.calls.length).toBe(callsBefore);
  });

  it('renderImages destroys nodes whose ids are no longer in the list', async () => {
    const { page, renderer } = mountPage();
    page.applyData({
      images: [
        { id: 'i1', xN: 0, yN: 0, src: '/a.png' },
        { id: 'i2', xN: 0, yN: 0, src: '/b.png' },
      ],
    });
    page.render();
    await Promise.resolve();
    const createdNodes = renderer.Image.mock.results.map((r) => r.value);
    const i1Node = createdNodes.find((n) => n._whiteboardId === 'i1');
    expect(i1Node).toBeDefined();

    page.applyData({ images: [{ id: 'i2', xN: 0, yN: 0, src: '/b.png' }] });
    page.render();
    await Promise.resolve();
    expect(i1Node.destroy).toHaveBeenCalled();
    expect(page.images.map((i) => i.id)).toEqual(['i2']);
  });

  it('image node transformend recomputes normalized width/height/position', async () => {
    const onChange = vi.fn();
    const { page, renderer } = mountPage({ onChange });
    page.applyData({ images: [{ id: 'i1', xN: 0, yN: 0, src: '/a.png' }] });
    page.render();
    await Promise.resolve();
    const imageNode = renderer.Image.mock.results.at(-1).value;
    imageNode.scaleX(2);
    imageNode.scaleY(2);
    imageNode.width(50);
    imageNode.height(50);
    imageNode.x(25);
    imageNode.y(25);
    imageNode._listeners.get('transformend')({});
    const item = page.images[0];
    expect(onChange).toHaveBeenCalled();
    expect(item.xN).toBeCloseTo(0.25);
    expect(item.yN).toBeCloseTo(0.25);
  });

  it('image node dragend updates normalized position', async () => {
    const onChange = vi.fn();
    const { page, renderer } = mountPage({ onChange });
    page.applyData({ images: [{ id: 'i1', xN: 0, yN: 0, src: '/a.png' }] });
    page.render();
    await Promise.resolve();
    const imageNode = renderer.Image.mock.results.at(-1).value;
    imageNode.x(50);
    imageNode.y(50);
    imageNode._listeners.get('dragend')({});
    expect(onChange).toHaveBeenCalled();
    expect(page.images[0].xN).toBeCloseTo(0.5);
  });

  it('clicking an image node in select mode attaches a selection overlay', async () => {
    const { page, renderer } = mountPage();
    page.setTool('select');
    page.applyData({ images: [{ id: 'i1', xN: 0, yN: 0, src: '/a.png' }] });
    page.render();
    await Promise.resolve();
    const imageNode = renderer.Image.mock.results.at(-1).value;
    const stage = renderer.Stage.mock.results[0].value;
    const layer = stage._layers[0];
    const childCountBefore = layer._children.length;
    imageNode._listeners.get('click')({});
    expect(layer._children.length).toBe(childCountBefore + 1);
  });

  it('text node transform keeps height fixed (text resize only horizontally)', () => {
    const { page, renderer } = mountPage();
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode.scaleX(2);
    textNode.width(50);
    textNode._listeners.get('transform')({});
    expect(textNode.setAttrs).toHaveBeenCalled();
  });

  it('text node transformend recomputes width and position', () => {
    const onChange = vi.fn();
    const { page, renderer } = mountPage({ onChange });
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode.width(40);
    textNode.scaleX(2);
    textNode.x(10);
    textNode.y(20);
    textNode._listeners.get('transformend')({});
    expect(onChange).toHaveBeenCalled();
    expect(page.text[0].xN).toBeCloseTo(0.1);
  });

  it('double-click on a text node opens an editor in select mode', () => {
    const { page, renderer, container } = mountPage();
    page.setTool('select');
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode._listeners.get('dblclick')({});
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
  });

  it('text editor uses the node fill as its color', () => {
    const { page, renderer, container } = mountPage();
    page.setTool('select');
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode.fill.mockReturnValue('#ff0000');
    textNode._listeners.get('dblclick')({});
    expect(container.querySelector('textarea').style.color).toBe('#ff0000');
  });

  it('text editor falls back to the default color when the fill is a gradient', () => {
    const { page, renderer, container } = mountPage();
    page.setTool('select');
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode.fill.mockReturnValue({ addColorStop: vi.fn() });
    textNode._listeners.get('dblclick')({});
    expect(container.querySelector('textarea').style.color).toBe('#2293fb');
  });

  it('dbl-click ignored when tool is not select', () => {
    const { page, renderer, container } = mountPage();
    page.setTool('draw');
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode._listeners.get('dblclick')({});
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('editTextNode commits new value on Enter', () => {
    const onChange = vi.fn();
    const { page, renderer, container } = mountPage({ onChange });
    page.setTool('select');
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode._listeners.get('dblclick')({});
    const textarea = container.querySelector('textarea');
    textarea.value = 'edited';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onChange).toHaveBeenCalled();
  });

  it('editTextNode closes and removes textarea on Escape', () => {
    const { page, renderer, container } = mountPage();
    page.setTool('select');
    page.applyData({ text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }] });
    page.render();
    const textNode = renderer.Text.mock.results.at(-1).value;
    textNode._listeners.get('dblclick')({});
    const textarea = container.querySelector('textarea');
    textarea.value = '';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(container.querySelector('textarea')).toBeNull();
    expect(page.text[0].content).toBe('hi');
  });

  it('resize updates stage size and applies pixel ratio', () => {
    const { page, renderer } = mountPage();
    const stage = renderer.Stage.mock.results[0].value;
    page.resize(500, 700);
    expect(stage.size).toHaveBeenCalledWith({ width: 500, height: 700 });
  });

  it('Delete key removes selected image node', async () => {
    const onChange = vi.fn();
    const { page, renderer } = mountPage({ onChange });
    page.setTool('select');
    page.applyData({ images: [{ id: 'i1', xN: 0, yN: 0, src: '/a.png' }] });
    page.render();
    await Promise.resolve();
    const imageNode = renderer.Image.mock.results.at(-1).value;
    imageNode._whiteboardId = 'i1';
    imageNode._listeners.get('click')({});
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(page.images.find((i) => i.id === 'i1')).toBeUndefined();
  });
});
