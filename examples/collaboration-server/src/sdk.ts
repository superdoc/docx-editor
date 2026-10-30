import { createSuperDocClient } from '@superdoc/sdk';

export interface SdkDocument {
  save(params: { out: string; force?: boolean }): Promise<unknown>;
  close(params?: { discard?: boolean }): Promise<unknown>;
}

export interface SdkClient {
  open(
    params: {
      doc?: string;
      collaboration: {
        providerType: 'hocuspocus';
        url: string;
        documentId: string;
        roomMode: 'create' | 'join';
        params?: Record<string, string>;
      };
    },
    options?: { collaborationAuth: { type: 'token'; token: string } },
  ): Promise<SdkDocument>;
  dispose(): Promise<void>;
}

export function createDefaultSdkClient(name: string): SdkClient {
  return createSuperDocClient({
    user: { name, email: `${name.toLowerCase().replaceAll(' ', '-')}@localhost` },
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 300_000,
  });
}

export const withToken = (token: string | undefined) =>
  token === undefined ? undefined : { collaborationAuth: { type: 'token' as const, token } };
