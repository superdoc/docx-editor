import { createSuperDocClient, type SuperDocDocument } from '@superdoc/sdk';
import { withToken } from '../sdk.ts';

export type ReplaceTarget = NonNullable<NonNullable<Parameters<SuperDocDocument['replace']>[0]>['target']>;

export interface AgentDocument {
  getText(): Promise<string>;
  info(): Promise<{ revision: string }>;
  query: {
    match(params: {
      select: { type: 'text'; pattern: string; mode: 'contains'; caseSensitive: true };
      require: 'first';
    }): Promise<{ items: Array<{ matchKind: string; target?: ReplaceTarget }> }>;
  };
  replace(params: {
    target: ReplaceTarget;
    text: string;
    changeMode: 'tracked';
    expectedRevision: string;
  }): Promise<
    MutationReceipt & { receipt?: MutationReceipt }
  >;
  trackChanges: {
    list(params: { in: 'all'; offset: number; limit: number }): Promise<{ items: TrackedChangeItem[] }>;
  };
  close(params?: { discard?: boolean }): Promise<unknown>;
}

export interface MutationReceipt {
  success?: boolean;
  failure?: { code?: string; message?: string };
  trackedChangeRefs?: Array<{ entityId: string }>;
  inserted?: Array<{ entityType: string; entityId: string }>;
  txId?: string;
}

export interface TrackedChangeItem {
  id: string;
  reviewGroup?: { childChangeIds?: string[] };
}

export interface AgentClient {
  open(
    params: {
      collaboration: { providerType: 'hocuspocus'; url: string; documentId: string; roomMode: 'join' };
    },
    options?: { collaborationAuth: { type: 'token'; token: string } },
  ): Promise<AgentDocument>;
  dispose(): Promise<void>;
}

export interface AgentIdentity {
  name: string;
  email: string;
}

export const REVIEW_AGENT: AgentIdentity = { name: 'Review Agent', email: 'review-agent@localhost' };

export function createDefaultAgentClient(identity: AgentIdentity): AgentClient {
  return createSuperDocClient({
    user: identity,
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 300_000,
  });
}

export interface JoinOptions {
  serverUrl: string;
  documentId: string;
  token?: string;
  identity?: AgentIdentity;
  createClient?: (identity: AgentIdentity) => AgentClient;
}

export interface Suggestion {
  find: string;
  replacement: string;
  trackedChangeIds: string[];
  txId?: string;
}

export type Decision = 'resolved' | 'pending';

export interface ReviewAgent {
  readonly identity: AgentIdentity;
  text(): Promise<string>;
  suggest(find: string, replacement: string): Promise<Suggestion>;
  waitForDecision(suggestion: Suggestion, options?: WaitOptions): Promise<Decision>;
  leave(): Promise<void>;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

export class TextNotFoundError extends Error {
  constructor(find: string) {
    super(`The document has no text matching "${find}". Nothing was changed.`);
    this.name = 'TextNotFoundError';
  }
}

export async function joinAsAgent(options: JoinOptions): Promise<ReviewAgent> {
  const identity = options.identity ?? REVIEW_AGENT;
  const client = (options.createClient ?? createDefaultAgentClient)(identity);

  let document: AgentDocument;
  try {
    document = await client.open(
      {
        collaboration: {
          providerType: 'hocuspocus',
          url: options.serverUrl,
          documentId: options.documentId,
          roomMode: 'join',
        },
      },
      withToken(options.token),
    );
  } catch (error) {
    await client.dispose();
    throw error;
  }

  let leaving: Promise<void> | undefined;

  return {
    identity,
    text: () => document.getText(),

    async suggest(find, replacement) {
      if (find === '' || replacement === '') throw new Error('A suggestion needs the text to find and a non-empty replacement.');

      for (let attempt = 1; attempt <= SUGGEST_ATTEMPTS; attempt += 1) {
        if (!(await document.getText()).includes(find)) throw new TextNotFoundError(find);
        const { revision } = await document.info();
        const match = await document.query.match({
          select: { type: 'text', pattern: find, mode: 'contains', caseSensitive: true },
          require: 'first',
        });
        const target = match.items.find((item) => item.matchKind === 'text')?.target;
        if (target === undefined) throw new TextNotFoundError(find);

        const result = await document
          .replace({ target, text: replacement, changeMode: 'tracked', expectedRevision: revision })
          .catch((error: unknown): MutationReceipt => {
            if (isRevisionMismatch(error)) return { success: false, failure: { code: REVISION_MISMATCH } };
            throw error;
          });
        const receipt: MutationReceipt = 'receipt' in result && result.receipt ? result.receipt : result;
        if (receipt.success === false) {
          if (receipt.failure?.code === REVISION_MISMATCH) continue;
          throw new Error(`Replacing "${find}" failed: ${receipt.failure?.code ?? 'unknown error'}.`);
        }

        const trackedChangeIds = trackedChangeIdsFrom(receipt);
        if (trackedChangeIds.length === 0) {
          throw new Error(`Replacing "${find}" made no tracked change, so there is nothing to review.`);
        }
        return { find, replacement, trackedChangeIds, txId: receipt.txId };
      }
      throw new Error(`The document kept changing while replacing "${find}". Nothing was changed; try again.`);
    },

    async waitForDecision(suggestion, { timeoutMs = 600_000, pollMs = 2_000, signal } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (!signal?.aborted) {
        const open = await openTrackedChangeIds(document);
        if (!suggestion.trackedChangeIds.some((id) => open.has(id))) return 'resolved';
        if (Date.now() >= deadline) return 'pending';
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
      }
      return 'pending';
    },

    leave() {
      leaving ??= (async () => {
        try {
          await document.close({ discard: true });
        } finally {
          await client.dispose();
        }
      })();
      return leaving;
    },
  };
}

const SUGGEST_ATTEMPTS = 3;
const REVISION_MISMATCH = 'REVISION_MISMATCH';

function isRevisionMismatch(error: unknown): boolean {
  return (error as { code?: unknown })?.code === REVISION_MISMATCH;
}

const TRACKED_CHANGE_PAGE_SIZE = 100;

async function openTrackedChangeIds(document: AgentDocument): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += TRACKED_CHANGE_PAGE_SIZE) {
    const { items } = await document.trackChanges.list({ in: 'all', offset, limit: TRACKED_CHANGE_PAGE_SIZE });
    for (const item of items) {
      ids.add(item.id);
      for (const childId of item.reviewGroup?.childChangeIds ?? []) ids.add(childId);
    }
    if (items.length < TRACKED_CHANGE_PAGE_SIZE) return ids;
  }
}

function trackedChangeIdsFrom(receipt: MutationReceipt): string[] {
  if (receipt.trackedChangeRefs?.length) return receipt.trackedChangeRefs.map((ref) => ref.entityId);
  return (receipt.inserted ?? []).filter((ref) => ref.entityType === 'trackedChange').map((ref) => ref.entityId);
}
