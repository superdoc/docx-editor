import {
  SuperDoc,
  type BlockChange,
  type ChangeActor,
  type ChangeCause,
  type ChangeProvenance,
  type ChangeRecord,
  type ChangesConfig,
  type Config,
  type User,
  type UserClaim,
  type UserClaimContext,
} from 'superdoc';
import type { SuperDocDocumentChange } from 'superdoc/ui';
import type { ChangeRecord as UiChangeRecord } from 'superdoc/ui';

const signClaim = async ({ documentId, clientId }: UserClaimContext): Promise<string> => `${documentId}:${clientId}`;
const syncClaim: UserClaim = (ctx) => `${ctx.documentId}:${ctx.clientId}`;
const staticClaim: UserClaim = 'signed.jwt.value';
const retention: ChangesConfig = { retainRecords: 500, retainBytes: 4 * 1024 * 1024 };

const config = {
  selector: '#editor',
  document: {
    url: '/agreement.docx',
    collaboration: { providerType: 'hocuspocus', documentId: 'agreement', serverUrl: 'wss://collab.example.com' },
  },
  user: { id: 'user-ada', name: 'Ada', email: 'ada@example.com', claim: signClaim },
  changes: retention,
} satisfies Config;

const superdoc = new SuperDoc(config);
const staticUser: User = { id: 'user-ada', name: 'Ada', claim: staticClaim };
const syncUser: User = { id: 'user-ada', claim: syncClaim };
const emptyRetention: Config['changes'] = {};

const badClaimNumber: User = {
  name: 'Ada',
  // @ts-expect-error A claim is a string or a function returning one.
  claim: 42,
};

// @ts-expect-error A claim function must return a string or a promise of one.
const badClaimReturn: UserClaim = () => 42;

// @ts-expect-error The claim context carries documentId and clientId only.
const badClaimContext: UserClaim = (ctx) => ctx.userId;

const badRetentionValue: ChangesConfig = {
  // @ts-expect-error Retention limits are numbers.
  retainRecords: '500',
};

const badRetentionKey: ChangesConfig = {
  // @ts-expect-error Retention has only retainRecords and retainBytes.
  maxRecords: 500,
};

const stop: () => void = superdoc.ui.document.onChange((change: SuperDocDocumentChange) => {
  const records: ChangeRecord[] | undefined = change.records;
  if (change.cause !== 'remote' || !records) return;
  if (change.scope.kind === 'known') void change.scope.stories.length;
  for (const record of records) {
    const sameRecord: UiChangeRecord = record;
    const actor: ChangeActor | null = record.actor;
    const actorId: string | null | undefined = actor?.id;
    const claim: string | undefined = actor?.claim;
    const contributors: ChangeActor[] | undefined = record.contributors;
    const cause: ChangeCause | null = record.cause;
    const provenance: ChangeProvenance = record.provenance;
    const origin: 'local' | 'remote' = record.origin;
    const declaredAt: string | null = record.at.declared;
    const observedAt: string = record.at.observed;
    const clientId: number = record.session.clientId;
    const revision: string = record.revision;
    const update: string | undefined = record.update;
    for (const blockChange of record.changes) {
      const entry: BlockChange = blockChange;
      if (entry.kind === 'text') {
        const inserted: string = entry.inserted;
        const range: [number, number] = [entry.range.start, entry.range.end];
        void [inserted, range];
      } else if (entry.kind === 'sidecar') {
        const ids: string[] = entry.ids;
        void ids;
        // @ts-expect-error Sidecar changes have no story.
        void entry.story;
      }
    }
    void [sameRecord, actorId, claim, contributors, cause, provenance, origin, declaredAt, observedAt, clientId];
    void [revision, update];
  }
});

// @ts-expect-error SuperDoc never reports verified provenance.
const verified: ChangeProvenance = 'verified';

// @ts-expect-error Remote causes are not change record causes.
const remoteCause: ChangeCause = 'remote';

void [staticUser, syncUser, emptyRetention, badClaimNumber, badClaimReturn, badClaimContext];
void [badRetentionValue, badRetentionKey, stop, verified, remoteCause];
