import type { SuperDocDocument } from '@superdoc/sdk';

export type DiffSnapshot = Parameters<SuperDocDocument['diff']['compare']>[0]['targetSnapshot'];
export type DiffResult = Awaited<ReturnType<SuperDocDocument['diff']['compare']>>;
export type DiffApplyReceipt = Awaited<ReturnType<SuperDocDocument['diff']['apply']>>;

export interface VersionDocument {
  save(params: { out: string; force?: boolean }): Promise<unknown>;
  close(params?: { discard?: boolean }): Promise<unknown>;
  diff: {
    capture(params: Record<string, never>): Promise<DiffSnapshot>;
    compare(params: { targetSnapshot: DiffSnapshot }): Promise<DiffResult>;
    apply(params: { diff: DiffResult; changeMode: 'direct' | 'tracked' }): Promise<DiffApplyReceipt>;
  };
}

export interface RoomTarget {
  providerType: 'hocuspocus';
  url: string;
  documentId: string;
  roomMode: 'create' | 'join';
  params?: Record<string, string>;
}

export interface VersionSdkClient {
  open(params: { doc?: string; collaboration?: RoomTarget }): Promise<VersionDocument>;
  dispose(): Promise<void>;
}

export async function createDefaultSdkClient(name: string): Promise<VersionSdkClient> {
  const { createSuperDocClient } = await import('@superdoc/sdk');
  return createSuperDocClient({
    user: { name, email: `${name.toLowerCase().replaceAll(' ', '-')}@localhost` },
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 300_000,
  });
}

export const errorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};
