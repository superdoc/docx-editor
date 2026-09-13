import { bootstrapSuperDocCollaborationWorker as bootstrapEngineCollaborationWorker } from '@superdoc/docx-engine/collaboration-worker';
import type { Doc as YDoc } from 'yjs';

export type SuperDocCollaborationProviderFamily = 'y-websocket' | 'hocuspocus' | 'liveblocks';

export interface SuperDocCollaborationProviderAwareness {
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown> | null): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(
    event: 'change' | 'update',
    listener: (payload: { added: number[]; updated: number[]; removed: number[] }) => void,
  ): void;
  off(
    event: 'change' | 'update',
    listener: (payload: { added: number[]; updated: number[]; removed: number[] }) => void,
  ): void;
}

export interface SuperDocCollaborationProviderAttachInput {
  readonly rootId: string;
  readonly ydoc: YDoc;
  readonly providerRoomName: string;
  onSynced(): void;
  onDegraded(): void;
  onFailed(detail: Record<string, unknown>): void;
  onStateless(message: string): void;
}

export interface SuperDocCollaborationProviderTransport {
  readonly awareness?: SuperDocCollaborationProviderAwareness | null;
  disconnect(): void;
  destroy(): void;
  sendStateless?(message: string): Promise<void> | void;
}

export interface SuperDocCollaborationProviderAdapter {
  readonly providerFamily: SuperDocCollaborationProviderFamily;
  attach(input: SuperDocCollaborationProviderAttachInput): SuperDocCollaborationProviderTransport;
  destroy?(): void;
}

export interface SuperDocCollaborationProviderFactoryInput {
  readonly documentId: string;
  readonly providerOptions: unknown;
  readonly token: string | (() => Promise<string>) | null;
}

export type SuperDocCollaborationProviderFactory = (
  input: SuperDocCollaborationProviderFactoryInput,
) => SuperDocCollaborationProviderAdapter;

export interface SuperDocCollaborationWorkerOptions {
  readonly providerAdapters: Readonly<Record<string, SuperDocCollaborationProviderFactory>>;
}

/** Register provider adapters and start the worker used by `workerUrls.collaboration`. */
export function bootstrapSuperDocCollaborationWorker(options: SuperDocCollaborationWorkerOptions): void {
  // The public facade owns the consumer-facing Yjs peer type. The engine may
  // resolve the same peer range to a different nominal TypeScript identity in
  // this monorepo, while the runtime object crossing this seam is unchanged.
  bootstrapEngineCollaborationWorker(options as unknown as Parameters<typeof bootstrapEngineCollaborationWorker>[0]);
}
