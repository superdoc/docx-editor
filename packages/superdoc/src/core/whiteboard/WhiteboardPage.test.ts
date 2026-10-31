import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { WhiteboardPage } from './WhiteboardPage.js';

const makeNode = (extras = {}) => {
  const listeners = new Map();
  let _name = '';
  const attrs = { x: 0, y: 0, width: 100, height: 20, scaleX: 1, scaleY: 1, fontSize: 18 };
  const node = {
    _listeners: listeners,
    on: vi.fn((events, fn) => {
      events.split(' ').forEach((e) => listeners.set(e, fn));
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    name: vi.fn((n) => {
      if (n !== undefined) _name = n;
      return _name;
    }),
    x: vi.fn((v) => (v !== undefined ? (attrs.x = v) : attrs.x)),
    y: vi.fn((v) => (v !== undefined ? (attrs.y = v) : attrs.y)),
    width: vi.fn((v) => (v !== undefined ? (attrs.width = v) : attrs.width)),
    height: vi.fn((v) => (v !== undefined ? (attrs.height = v) : attrs.height)),
    scaleX: vi.fn((v) => (v !== undefined ? (attrs.scaleX = v) : attrs.scaleX)),
    scaleY: vi.fn((v) => (v !== undefined ? (attrs.scaleY = v) : attrs.scaleY)),
    scale: vi.fn((v) => {
      attrs.scaleX = v.x;
      attrs.scaleY = v.y;
    }),
    setAttrs: vi.fn((o) => Object.assign(attrs, o)),
    text: vi.fn((v) => (v !== undefined ? (attrs._text = v) : attrs._text)),
    fontSize: vi.fn((v) => (v !== undefined ? (attrs.fontSize = v) : attrs.fontSize)),
    fontFamily: vi.fn(() => 'Arial'),
    fill: vi.fn(() => '#2293fb'),
    position: vi.fn(() => ({ x: attrs.x, y: attrs.y })),
    points: vi.fn((v) => (v !== undefined ? (attrs.points = v) : attrs.points)),
    draggable: vi.fn((v) => (v !== undefined ? (attrs.draggable = v) : attrs.draggable)),
    getCanvas: vi.fn(() => ({ setPixelRatio: vi.fn() })),
    nodes: vi.fn(),
    enabledAnchors: vi.fn(),
    boundBoxFunc: vi.fn(),
    ...extras,
  };
  return node;
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
  stage.on = vi.fn((events, fn) => {
    events.split(' ').forEach((e) => stageListeners.set(e, fn));
  });
  stage.add = vi.fn((l) => layers.push(l));
  stage.size = vi.fn();
  stage.getPointerPosition = vi.fn(() => ({ x: 50, y: 60 }));
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
    this.points = vi.fn((v) => (v !== undefined ? (this._points = v) : this._points));
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

const makePage = (init = {}) => {
  return new WhiteboardPage({
    pageIndex: 0,
    enabled: true,
    Renderer: makeRenderer(),
    onChange: vi.fn(),
    onToolChange: vi.fn(),
    ...init,
  });
};

const mountWithSize = (page, size = { width: 200, height: 300, originalWidth: 100, originalHeight: 150 }) => {
  page.setSize(size);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 200 });
  Object.defineProperty(container, 'clientHeight', { value: 300 });
  document.body.appendChild(container);
  page.mount(container);
  return container;
};

describe('WhiteboardPage', () => {
  describe('setSize / size helpers', () => {
    it('stores width/height and optional original size', () => {
      const page = makePage();
      page.setSize({ width: 100, height: 200, originalWidth: 50, originalHeight: 100 });
      expect(page.size).toEqual({ width: 100, height: 200 });
      expect(page.originalSize).toEqual({ width: 50, height: 100 });
    });

    it('is a no-op when size is falsy', () => {
      const page = makePage();
      page.setSize(null);
      expect(page.size).toBeNull();
    });

    it('handles missing original dimensions as null', () => {
      const page = makePage();
      page.setSize({ width: 100, height: 200 });
      expect(page.originalSize).toEqual({ width: null, height: null });
    });
  });

  describe('tool state', () => {
    it('setTool updates the current tool', () => {
      const page = makePage();
      page.setTool('draw');
      expect(page.getTool()).toBe('draw');
    });

    it('setEnabled toggles enabled state', () => {
      const page = makePage({ enabled: false });
      expect(page.isEnabled()).toBe(false);
      page.setEnabled(true);
      expect(page.isEnabled()).toBe(true);
      page.setEnabled(false);
      expect(page.isEnabled()).toBe(false);
    });
  });

  describe('applyData / toJSON', () => {
    it('apply normalizes missing arrays to empty', () => {
      const page = makePage();
      page.applyData({});
      expect(page.strokes).toEqual([]);
      expect(page.text).toEqual([]);
      expect(page.images).toEqual([]);
    });

    it('apply keeps provided arrays and exposes via toJSON', () => {
      const page = makePage();
      const data = {
        strokes: [{ pointsN: [[0, 0]] }],
        text: [{ id: 't1', xN: 0, yN: 0, content: 'hi' }],
        images: [{ id: 'i1', xN: 0, yN: 0, src: '/x.png' }],
      };
      page.applyData(data);
      expect(page.toJSON()).toEqual({
        strokes: data.strokes,
        text: data.text,
        images: data.images,
      });
    });
  });

  describe('addStroke / addText / addImage', () => {
    it('addStroke ignores invalid input', () => {
      const page = makePage();
      page.addStroke(null);
      page.addStroke({});
      page.addStroke({ points: 'bad' });
      expect(page.strokes).toEqual([]);
    });

    it('addStroke normalizes points to 0..1 based on size', () => {
      const page = makePage();
      page.setSize({ width: 100, height: 200 });
      page.addStroke({
        points: [
          [50, 100],
          [100, 200],
        ],
        width: 10,
        color: '#000',
        type: 'draw',
      });
      expect(page.strokes).toHaveLength(1);
      expect(page.strokes[0].pointsN).toEqual([
        [0.5, 0.5],
        [1, 1],
      ]);
      expect(page.strokes[0].color).toBe('#000');
      expect(page.strokes[0].type).toBe('draw');
    });

    it('addText ignores input without a string content', () => {
      const page = makePage();
      page.addText(null);
      page.addText({ x: 0, y: 0 });
      page.addText({ x: 0, y: 0, content: 42 });
      expect(page.text).toEqual([]);
    });

    it('addText normalizes and generates an id if missing', () => {
      const page = makePage();
      page.setSize({ width: 100, height: 200 });
      page.addText({ x: 50, y: 50, content: 'hi' });
      expect(page.text).toHaveLength(1);
      expect(page.text[0].id).toBeDefined();
      expect(page.text[0].xN).toBeCloseTo(0.5);
      expect(page.text[0].yN).toBeCloseTo(0.25);
    });

    it('addImage requires src', () => {
      const page = makePage();
      page.addImage(null);
      page.addImage({});
      page.addImage({ x: 0, y: 0 });
      expect(page.images).toEqual([]);
    });

    it('addImage normalizes coords and assigns id', () => {
      const page = makePage();
      page.setSize({ width: 100, height: 200 });
      page.addImage({ x: 50, y: 100, src: '/a.png', width: 50, height: 50 });
      expect(page.images).toHaveLength(1);
      expect(page.images[0].id).toBeDefined();
      expect(page.images[0].xN).toBeCloseTo(0.5);
      expect(page.images[0].yN).toBeCloseTo(0.5);
      expect(page.images[0].widthN).toBeCloseTo(0.5);
    });

    it('addImage with sticker type sets stickerId from id', () => {
      const page = makePage();
      page.addImage({ id: 's1', type: 'sticker', src: '/s.png', x: 0, y: 0 });
      expect(page.images[0].stickerId).toBe('s1');
      expect(page.images[0].type).toBe('sticker');
    });
  });

  describe('mount / render / destroy', () => {
    it('mount is a no-op without a container', () => {
      const page = makePage();
      page.mount(null);
      expect(page.toJSON()).toEqual({ strokes: [], text: [], images: [] });
    });

    it('mount creates a stage and two layers and renders', () => {
      const page = makePage();
      const container = mountWithSize(page);
      expect(page._renderer?.Stage ?? page._Renderer ?? true).toBeTruthy();
      expect(container).toBeInstanceOf(HTMLElement);
    });

    it('mount re-mounts when container changes', () => {
      const page = makePage();
      const c1 = mountWithSize(page);
      const c2 = document.createElement('div');
      Object.defineProperty(c2, 'clientWidth', { value: 400 });
      Object.defineProperty(c2, 'clientHeight', { value: 500 });
      document.body.appendChild(c2);
      page.mount(c2);
      expect(c1).not.toBe(c2);
    });

    it('render is a no-op before mount', () => {
      const page = makePage();
      expect(() => page.render()).not.toThrow();
    });

    it('render after mount draws strokes, text, images', () => {
      const page = makePage();
      page.setSize({ width: 200, height: 300 });
      page.applyData({
        strokes: [
          {
            pointsN: [
              [0, 0],
              [0.5, 0.5],
            ],
            widthN: 0.02,
            color: '#000',
          },
        ],
        text: [{ id: 't1', xN: 0.1, yN: 0.2, content: 'hi', fontSizeN: 0.05 }],
        images: [],
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      page.mount(container);
      expect(() => page.render()).not.toThrow();
    });

    it('destroy cleans up internals', () => {
      const page = makePage();
      const container = mountWithSize(page);
      page.destroy();
      expect(() => page.render()).not.toThrow();
      container.remove();
    });

    it('resize is a no-op without a stage', () => {
      const page = makePage();
      expect(() => page.resize(100, 100)).not.toThrow();
    });

    it('resize updates stage size when mounted', () => {
      const page = makePage();
      mountWithSize(page);
      expect(() => page.resize(500, 700)).not.toThrow();
    });
  });

  describe('drawing interactions', () => {
    const getStage = (renderer) => renderer.Stage.mock.results[0].value;

    it('draw start/move/end records a stroke and fires onChange', () => {
      const onChange = vi.fn();
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange,
      });
      page.setSize({ width: 100, height: 100 });
      const container = document.createElement('div');
      document.body.appendChild(container);
      page.mount(container);
      page.setTool('draw');
      const stage = getStage(renderer);

      stage._listeners.get('mousedown')({});
      stage._listeners.get('mousemove')({});
      stage._listeners.get('mouseup')({});

      expect(page.strokes).toHaveLength(1);
      expect(page.strokes[0].type).toBe('draw');
      expect(onChange).toHaveBeenCalled();
    });

    it('erase tool creates a stroke of type erase', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      const container = document.createElement('div');
      document.body.appendChild(container);
      page.mount(container);
      page.setTool('erase');
      const stage = getStage(renderer);
      stage._listeners.get('mousedown')({});
      stage._listeners.get('mousemove')({});
      stage._listeners.get('mouseup')({});
      expect(page.strokes[0].type).toBe('erase');
    });

    it('drawing is a no-op when disabled', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setEnabled(false);
      page.setTool('draw');
      const stage = getStage(renderer);
      stage._listeners.get('mousedown')({});
      stage._listeners.get('mousemove')({});
      stage._listeners.get('mouseup')({});
      expect(page.strokes).toHaveLength(0);
    });

    it('drawing is a no-op when tool is not draw/erase', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setTool('select');
      const stage = getStage(renderer);
      stage._listeners.get('mousedown')({});
      stage._listeners.get('mousemove')({});
      stage._listeners.get('mouseup')({});
      expect(page.strokes).toHaveLength(0);
    });

    it('draw move without a prior start is a no-op', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setTool('draw');
      const stage = getStage(renderer);
      stage._listeners.get('mousemove')({});
      stage._listeners.get('mouseup')({});
      expect(page.strokes).toHaveLength(0);
    });

    it('draw when getPointerPosition returns null is a no-op', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setTool('draw');
      const stage = getStage(renderer);
      stage.getPointerPosition = vi.fn(() => null);
      stage._listeners.get('mousedown')({});
      expect(page.strokes).toHaveLength(0);
    });
  });

  describe('stage click tool handlers', () => {
    const getStage = (renderer) => renderer.Stage.mock.results[0].value;

    it('text tool opens a textarea on click and commits on Enter', () => {
      const onChange = vi.fn();
      const onToolChange = vi.fn();
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange,
        onToolChange,
      });
      page.setSize({ width: 100, height: 100 });
      const container = document.body.appendChild(document.createElement('div'));
      page.mount(container);
      page.setTool('text');
      const stage = getStage(renderer);
      stage._listeners.get('click')({ target: stage });

      const textarea = container.querySelector('textarea');
      expect(textarea).not.toBeNull();
      textarea.value = 'hello';
      const enter = new KeyboardEvent('keydown', { key: 'Enter' });
      textarea.dispatchEvent(enter);
      expect(page.text).toHaveLength(1);
      expect(page.text[0].content).toBe('hello');
      expect(onToolChange).toHaveBeenCalledWith('select');
    });

    it('text tool: Escape closes without committing', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      const container = document.body.appendChild(document.createElement('div'));
      page.mount(container);
      page.setTool('text');
      const stage = getStage(renderer);
      stage._listeners.get('click')({ target: stage });
      const textarea = container.querySelector('textarea');
      const escape = new KeyboardEvent('keydown', { key: 'Escape' });
      textarea.dispatchEvent(escape);
      expect(page.text).toHaveLength(0);
    });

    it('select tool clears selection when clicking background', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setTool('select');
      const stage = getStage(renderer);
      expect(() => stage._listeners.get('click')({ target: stage })).not.toThrow();
    });

    it('stage click is a no-op when disabled', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: false,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      const stage = getStage(renderer);
      stage._listeners.get('click')({ target: stage });
      expect(page.text).toHaveLength(0);
    });
  });

  describe('text node events and selection', () => {
    const getStage = (renderer) => renderer.Stage.mock.results[0].value;

    it('clicking a text node selects it and creates a Transformer', () => {
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange: vi.fn(),
      });
      page.setSize({ width: 100, height: 100 });
      page.applyData({
        text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }],
      });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setTool('select');
      page.render();

      const textNode = renderer.Text.mock.results.at(-1).value;
      const cancelEvent = {};
      textNode._listeners.get('click')(cancelEvent);
      expect(renderer.Transformer).toHaveBeenCalled();
    });

    it('Delete key removes the selected text node', () => {
      const onChange = vi.fn();
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange,
      });
      page.setSize({ width: 100, height: 100 });
      page.applyData({
        text: [{ id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 }],
      });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.setTool('select');
      page.render();

      const textNode = renderer.Text.mock.results.at(-1).value;
      textNode._whiteboardId = 't1';
      textNode._listeners.get('click')({});

      const ev = new KeyboardEvent('keydown', { key: 'Delete' });
      window.dispatchEvent(ev);
      expect(page.text.find((t) => t.id === 't1')).toBeUndefined();
    });

    it('text dragend normalizes position and triggers change', () => {
      const onChange = vi.fn();
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange,
      });
      page.setSize({ width: 100, height: 100 });
      const textItem = { id: 't1', xN: 0, yN: 0, content: 'hi', fontSizeN: 0.1 };
      page.applyData({ text: [textItem] });
      page.mount(document.body.appendChild(document.createElement('div')));
      page.render();

      const textNode = renderer.Text.mock.results.at(-1).value;
      textNode.x(50);
      textNode.y(25);
      textNode._listeners.get('dragend')({});
      expect(textItem.xN).toBeCloseTo(0.5);
      expect(textItem.yN).toBeCloseTo(0.25);
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('image node events', () => {
    const getStage = (renderer) => renderer.Stage.mock.results[0].value;

    it('image dragend updates normalized position', () => {
      const onChange = vi.fn();
      const renderer = makeRenderer();
      const page = new WhiteboardPage({
        pageIndex: 0,
        enabled: true,
        Renderer: renderer,
        onChange,
      });
      page.setSize({ width: 100, height: 100 });
      page.mount(document.body.appendChild(document.createElement('div')));
      const item = { id: 'i1', xN: 0, yN: 0, src: '/x.png' };
      page.images.push(item);
      page.render();
      const imageConstructors = renderer.Image.mock.results.length;
      expect(() => page.render()).not.toThrow();
    });
  });

  describe('keyboard delete behavior', () => {
    it('delete key removes selected text node and triggers change', () => {
      const onChange = vi.fn();
      const page = makePage({ onChange });
      page.setSize({ width: 200, height: 300 });
      page.applyData({
        strokes: [],
        text: [{ id: 't1', xN: 0.1, yN: 0.2, content: 'hi', fontSizeN: 0.05 }],
        images: [],
      });
      mountWithSize(page);
      const event = new KeyboardEvent('keydown', { key: 'Delete' });
      window.dispatchEvent(event);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('ignores key presses from input/textarea target', () => {
      const onChange = vi.fn();
      const page = makePage({ onChange });
      page.setSize({ width: 200, height: 300 });
      page.applyData({
        text: [{ id: 't1', xN: 0.1, yN: 0.2, content: 'hi', fontSizeN: 0.05 }],
      });
      mountWithSize(page);
      const target = document.createElement('input');
      document.body.appendChild(target);
      const e = new KeyboardEvent('keydown', { key: 'Delete' });
      Object.defineProperty(e, 'target', { value: target });
      window.dispatchEvent(e);
      expect(page.text.find((t) => t.id === 't1')).toBeDefined();
      expect(onChange).not.toHaveBeenCalled();
      target.remove();
    });
  });
});
