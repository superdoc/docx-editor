import { EventEmitter } from '../EventEmitter';
import { WhiteboardPage } from './WhiteboardPage';
import type { WhiteboardPageRenderer, WhiteboardPageSize, WhiteboardStoredPageData } from './WhiteboardPage';

export type { WhiteboardPageSize };

export type WhiteboardPageData = WhiteboardStoredPageData;

export type WhiteboardPageSizeSnapshot = {
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
};

export type WhiteboardDataMeta = { pageSizes: Record<string, WhiteboardPageSizeSnapshot> };

export type WhiteboardData = { pages: Record<string, WhiteboardPageData>; meta: WhiteboardDataMeta; version: 1 };

export type WhiteboardDataInput = {
  pages?: Record<string, WhiteboardPageData>;
  meta?: WhiteboardDataMeta;
  version?: number;
};

export type WhiteboardRegistryItem = { id?: string | number; [key: string]: unknown };

export type WhiteboardEventMap = {
  tool: [string];
  enabled: [boolean];
  opacity: [number];
  setData: [WhiteboardPage[]];
  change: [WhiteboardData];
};

export type WhiteboardInit = {
  Renderer?: WhiteboardPageRenderer;
  enabled?: boolean;
  onChange?: (data: WhiteboardData) => void;
  onSetData?: (pages: WhiteboardPage[]) => void;
  onEnabledChange?: (enabled: boolean) => void;
};

export class Whiteboard extends EventEmitter<WhiteboardEventMap> {
  #Renderer: WhiteboardPageRenderer | undefined;

  #pages = new Map<number, WhiteboardPage>();

  #registry = new Map<string, WhiteboardRegistryItem[]>();

  #currentTool = 'select';

  #enabled = false;

  #opacity = 1;

  #onChange: ((data: WhiteboardData) => void) | undefined;

  #onSetData: ((pages: WhiteboardPage[]) => void) | undefined;

  #onEnabledChange: ((enabled: boolean) => void) | undefined;

  constructor(props: WhiteboardInit = {}) {
    super();
    this.#Renderer = props.Renderer;
    this.#enabled = props.enabled ?? false;

    this.#onChange = props.onChange;
    this.#onSetData = props.onSetData;
    this.#onEnabledChange = props.onEnabledChange;
  }

  register(type: string, items: WhiteboardRegistryItem[]): void {
    this.#registry.set(type, items);
  }

  getType(type: string): WhiteboardRegistryItem[] | undefined {
    return this.#registry.get(type);
  }

  setTool(tool: string): void {
    this.#currentTool = tool;
    this.#pages.forEach((page) => page.setTool(tool));
    this.emit('tool', tool);
  }

  getTool(): string {
    return this.#currentTool;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#pages.forEach((page) => page.setEnabled(enabled));
    this.emit('enabled', enabled);
    if (this.#onEnabledChange) {
      this.#onEnabledChange(enabled);
    }
  }

  isEnabled(): boolean {
    return this.#enabled;
  }

  setOpacity(opacity: number): void {
    const value = opacity;
    this.#opacity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    this.emit('opacity', this.#opacity);
  }

  getOpacity(): number {
    return this.#opacity;
  }

  getPages(): WhiteboardPage[] {
    return Array.from(this.#pages.values());
  }

  rerender(): void {
    this.#pages.forEach((page) => page.render());
  }

  setPageSize(pageIndex: number, size: WhiteboardPageSize): void {
    const page = this.#createPage(pageIndex);
    page.setSize(size);
  }

  #createPage(pageIndex: number): WhiteboardPage {
    const existing = this.#pages.get(pageIndex);
    if (existing) return existing;
    const page = new WhiteboardPage({
      Renderer: this.#Renderer,
      enabled: this.#enabled,
      pageIndex,
      onChange: () => {
        this.#emitChange();
      },
      onToolChange: (tool) => {
        this.setTool(tool);
      },
    });
    page.setTool(this.#currentTool);
    page.setEnabled(this.#enabled);
    this.#pages.set(pageIndex, page);
    return page;
  }

  getPage(pageIndex: number): WhiteboardPage | undefined {
    return this.#pages.get(pageIndex);
  }

  getWhiteboardData(): WhiteboardData {
    const pages: Record<string, WhiteboardPageData> = {};
    const pageSizes: Record<string, WhiteboardPageSizeSnapshot> = {};

    for (const page of this.#pages.values()) {
      pages[page.pageIndex] = page.toJSON();
      if (page.size) {
        pageSizes[page.pageIndex] = {
          width: page.size.width,
          height: page.size.height,
          originalWidth: page.originalSize?.width ?? null,
          originalHeight: page.originalSize?.height ?? null,
        };
      }
    }

    return {
      pages,
      meta: { pageSizes },
      version: 1,
    };
  }

  setWhiteboardData(json: WhiteboardDataInput): void {
    this.#pages.clear();

    const pages = json?.pages || {};
    Object.keys(pages).forEach((key) => {
      const parsedIndex = Number(key);
      if (Number.isNaN(parsedIndex)) return;
      const page = this.#createPage(parsedIndex);
      page.applyData(pages[key]);
    });

    this.emit('setData', this.getPages());
    if (this.#onSetData) {
      this.#onSetData(this.getPages());
    }

    this.#emitChange();
  }

  #emitChange() {
    const data = this.getWhiteboardData();
    this.emit('change', data);
    if (this.#onChange) this.#onChange(data);
  }
}
