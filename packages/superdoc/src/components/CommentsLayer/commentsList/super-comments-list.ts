import { EventEmitter } from 'eventemitter3';
import { setActivePinia } from 'pinia';
import { createApp } from 'vue';
import type { App, Component, ComponentPublicInstance } from 'vue';

import { vClickOutside } from '@superdoc/common';
import { isPlainObject } from '../../../helpers/object-guards.js';
import type { SuperDoc } from '../../../core/types/index.js';
import type { CommentsSlice, ReviewAnalysisProgress, SnapshotSubscribable } from '../../../public/ui/types.js';
import CommentsList from './commentsList.vue';

type DirectoryFamily = 'comments' | 'trackChanges';

type DirectorySlice = Pick<CommentsSlice, 'status' | 'listStatus'> & {
  items: readonly unknown[];
  analysis?: ReviewAnalysisProgress | null;
};

type DirectoryHandle = Pick<SnapshotSubscribable<DirectorySlice>, 'observe' | 'getSnapshot'>;

type DirectoryItems = Record<DirectoryFamily, readonly unknown[] | null>;

type DirectoryReadiness = Record<DirectoryFamily, boolean>;

const reviewAnalysisOf = (snapshot: DirectorySlice | null | undefined): ReviewAnalysisProgress | null => {
  const analysis = snapshot?.analysis;
  return analysis && typeof analysis.done === 'number' && typeof analysis.total === 'number' && analysis.total > 0
    ? analysis
    : null;
};

type ReviewDirectoryStore = {
  isReviewDirectoryActive: boolean;
  isReviewDirectoryLoading: boolean;
  reviewAnalysisProgress: ReviewAnalysisProgress | null;
  setReviewDirectoryFromV2(input: {
    superdoc?: SuperDoc;
    commentItems?: readonly unknown[];
    trackedChangeItems?: readonly unknown[];
  }): unknown;
  clearReviewDirectory(): void;
};

const isReviewDirectoryStore = (value: unknown): value is ReviewDirectoryStore =>
  isPlainObject(value) &&
  typeof value.setReviewDirectoryFromV2 === 'function' &&
  typeof value.clearReviewDirectory === 'function';

const readCommentsStore = (superdoc: SuperDoc): ReviewDirectoryStore | undefined => {
  const store: unknown = superdoc?.['commentsStore'];
  return isReviewDirectoryStore(store) ? store : undefined;
};

type SuperCommentsConfig = {
  comments: unknown[];
  element: Element | string | null | undefined;
  commentsStore: unknown;
  selector?: string;
  [key: string]: unknown;
};

type SuperCommentsOptions = Partial<SuperCommentsConfig>;

/**
 * Comments list renderer (not floating comments)
 *
 * This renders a list of comments into an element, connected to main SuperDoc instance
 */
export class SuperComments extends EventEmitter {
  element: Element | string | null | undefined;

  config: SuperCommentsConfig = {
    comments: [],
    element: null,
    commentsStore: null,
  };

  app: App | null;
  superdoc: SuperDoc;
  container: ComponentPublicInstance | null | undefined;
  stopDirectoryObservers: Array<() => void>;
  directorySnapshots: DirectoryItems;
  directoryItemRefs: DirectoryItems;
  directoryReady: DirectoryReadiness;
  directoryGeneration: number;

  constructor(options: SuperCommentsOptions | undefined, superdoc: SuperDoc) {
    super();
    this.config = { ...this.config, ...options };
    this.element = this.config.element;
    this.app = null;
    this.superdoc = superdoc;
    this.stopDirectoryObservers = [];
    this.directorySnapshots = { comments: null, trackChanges: null };
    this.directoryItemRefs = { comments: null, trackChanges: null };
    this.directoryReady = { comments: false, trackChanges: false };
    this.directoryGeneration = 0;
    this.open();
  }

  syncDirectory() {
    const store = readCommentsStore(this.superdoc);
    if (!store) return;
    const comments = this.directorySnapshots.comments;
    const trackChanges = this.directorySnapshots.trackChanges;
    if (comments == null && trackChanges == null) return;
    store.setReviewDirectoryFromV2({
      superdoc: this.superdoc,
      commentItems: comments ?? [],
      trackedChangeItems: trackChanges ?? [],
    });
  }

  startDirectoryObservers() {
    const generation = ++this.directoryGeneration;
    const isReady = (snapshot: DirectorySlice) => (snapshot?.listStatus ?? snapshot?.status) === 'ready';
    const subscribe = (handle: DirectoryHandle, family: DirectoryFamily) => {
      const showItems = (snapshot: DirectorySlice) => {
        const items = Array.isArray(snapshot.items) ? snapshot.items : [];
        if (this.directoryItemRefs[family] === items) return;
        this.directoryItemRefs[family] = items;
        this.directorySnapshots[family] = items;
        this.syncDirectory();
      };
      const acceptDirectorySnapshot = (snapshot: DirectorySlice) => {
        if (generation !== this.directoryGeneration) return;
        const ready = isReady(snapshot);
        this.directoryReady[family] = ready;
        const store = readCommentsStore(this.superdoc);
        if (store && family === 'trackChanges')
          store.reviewAnalysisProgress = ready ? null : reviewAnalysisOf(snapshot);
        if (ready) showItems(snapshot);
        if (store) store.isReviewDirectoryLoading = !this.directoryReady.comments || !this.directoryReady.trackChanges;
      };
      const showPaintedPagesWhileLoading = () => {
        const snapshot = handle.getSnapshot();
        if (generation === this.directoryGeneration && !this.directoryReady[family] && isReady(snapshot)) {
          showItems(snapshot);
        }
      };
      const stop = handle.observe(acceptDirectorySnapshot);
      if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(showPaintedPagesWhileLoading);
      else void Promise.resolve().then(showPaintedPagesWhileLoading);
      return stop;
    };
    const ui = this.superdoc?.ui;
    if (!ui) return;
    const store = readCommentsStore(this.superdoc);
    if (store) {
      store.isReviewDirectoryActive = true;
      store.isReviewDirectoryLoading = true;
    }
    this.stopDirectoryObservers = [subscribe(ui.comments, 'comments'), subscribe(ui.trackChanges, 'trackChanges')];
  }

  createVueApp() {
    this.app = createApp(CommentsList as Component);
    const parentProvides = this.superdoc?.['app']?._context?.provides;
    if (parentProvides && this.app?._context?.provides) {
      Object.setPrototypeOf(this.app._context.provides, parentProvides);
    }
    if (this.superdoc?.pinia) {
      setActivePinia(this.superdoc.pinia);
      this.app.use(this.superdoc.pinia);
      this.app.config.globalProperties.$pinia = this.superdoc.pinia;
    }
    this.app.directive('click-outside', vClickOutside);
    this.app.config.globalProperties.$superdoc = this.superdoc;

    if (!this.element && this.config.selector) {
      this.element = document.getElementById(this.config.selector);
    }

    this.container = this.app.mount(this.element);
    this.startDirectoryObservers();
  }

  close() {
    this.directoryGeneration += 1;
    for (const stop of this.stopDirectoryObservers.splice(0)) stop?.();
    this.directorySnapshots = { comments: null, trackChanges: null };
    this.directoryItemRefs = { comments: null, trackChanges: null };
    this.directoryReady = { comments: false, trackChanges: false };
    const store = readCommentsStore(this.superdoc);
    if (store) {
      store.clearReviewDirectory();
      store.isReviewDirectoryActive = false;
      store.isReviewDirectoryLoading = false;
      store.reviewAnalysisProgress = null;
    }
    if (this.app) {
      this.app.unmount();
      this.app = null;
      this.container = null;
      this.element = null;
    }
  }

  open() {
    if (!this.app) {
      this.createVueApp();
    }
  }
}
