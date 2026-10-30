# Collaboration server

A starting point for the server that SuperDoc V2 collaboration connects to. Copy this directory into your own
repository, deploy it on your infrastructure, and point SuperDoc at it with `providerType: 'hocuspocus'`.
The guide [Deploy a collaboration server](https://docs.superdoc.dev/editor/collaboration/deploy-a-server)
explains the decisions behind it.

It is a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server that stores every room, so a room survives a
page refresh, the last person leaving, and a server restart. Without storage, Hocuspocus drops a room as soon
as its last connection closes.

Every connection must carry a token that your access check accepts. The template ships an example check so it
runs securely out of the box. Replace it with a check against your own login system.

It also keeps an up-to-date DOCX of every room. A few seconds after edits stop, and when the last person leaves,
it saves the room as a Word file and hands it to you.

The server only syncs rooms. It does not store or serve your DOCX files. Every editor, including people who
join later, opens the same DOCX from your application together with the room. The creator's file initializes
the room, and a joiner's file is not used for content. Keep the files in your own storage and serve them from
your backend.

## Run it

Requires Node 22.12 or newer and pnpm 11.

pnpm 11 stops before `pnpm start` unless esbuild, which runs the server's TypeScript, may run its install
script. Allow it in your copy's `pnpm-workspace.yaml`, or add the same entry to your existing workspace file:

```bash
printf "allowBuilds:\n  esbuild: true\n" > pnpm-workspace.yaml
pnpm install
export COLLABORATION_AUTH_SECRET="$(openssl rand -hex 32)"
pnpm start
```

The server listens on `ws://127.0.0.1:1234` and stores rooms in `./collaboration-data`.

In a second terminal with the same `COLLABORATION_AUTH_SECRET`, create the document's room from a DOCX, and a
token for a user. The token is valid for an hour:

```bash
pnpm create-room contract-42 ./contract.docx
pnpm token alice contract-42
```

`pnpm token` takes a user ID and the documents the token may open:

```bash
pnpm token alice contract-42,contract-43
pnpm token bob contract-42 --read-only
pnpm token autosave '*'
```

`'*'` opens every document. Use it only for backend services.

Connect SuperDoc to the server with that token:

```ts
new SuperDoc({
  selector: '#editor',
  document: {
    url: '/contract.docx',
    collaboration: {
      providerType: 'hocuspocus',
      serverUrl: 'ws://127.0.0.1:1234',
      documentId: 'contract-42',
      token: () => getTokenFromYourBackend(),
      roomMode: 'join', // after the room exists: see "Create rooms from your backend"
    },
  },
});
```

`token` can be a string or a function. SuperDoc calls the function on every connection, including reconnects,
so it can fetch a fresh token.

## Configure it

| Variable                    | Default                  | Purpose                                                               |
| --------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `PORT`                      | `1234`                   | Port to listen on.                                                    |
| `HOST`                      | `127.0.0.1`              | Address to listen on. Use `0.0.0.0` to accept connections from other machines. |
| `COLLABORATION_STORAGE_DIR` | `./collaboration-data`   | Directory for room files. Must be on a persistent disk.               |
| `COLLABORATION_AUTH_SECRET` | none                     | Signing secret for the example tokens, at least 32 characters. Required unless access checks are off. |
| `COLLABORATION_AUTH`        | `example-token`          | Set to `none` to turn access checks off. Only for a private network: anyone who can reach the server can then open any room. |
| `COLLABORATION_DOCX`        | `autosave`               | Set to `off` to stop saving DOCX files.                               |
| `COLLABORATION_DOCX_DIR`    | `./collaboration-docx`   | Directory for autosaved DOCX files.                                   |
| `COLLABORATION_DOCX_IDLE_MS`| `10000`                  | How long a room must go without edits before it is saved.             |

Room names on the server include SuperDoc's prefix: `documentId: 'contract-42'` arrives as
`sd2/v2.1/contract-42`.

## Control access

On every connection and reconnect, the server calls one function with the token and the room's document ID,
and admits the connection only if it returns a user:

```ts
// src/auth/types.ts
type Authorize = (request: { token: string; roomName: string; documentId: string | null }) =>
  { userId: string; readOnly?: boolean } | null | Promise<{ userId: string; readOnly?: boolean } | null>;
```

Return `null` to refuse, and SuperDoc reports `collaboration-access-denied` to the page. Return `readOnly: true`
to let someone follow the room without editing it. The server drops their edits.

`src/auth/example-token.ts` is a sample. It accepts HS256 tokens signed with `COLLABORATION_AUTH_SECRET` that
list the document IDs they may open, or `'*'` for all of them. Replace it with your own check, for example by
verifying the JWTs your identity provider already issues, and pass your function as `authorize` in `server.ts`.

A client that sends no token at all is never admitted, but it isn't refused either. The Hocuspocus provider
waits, so SuperDoc reports a sync timeout after `syncTimeoutMs` (30 seconds by default) instead of
`collaboration-access-denied`. Always send a token.

`src/room-name.ts` turns `sd2/v2.1/contract-42` into `contract-42`. If SuperDoc's room name format changes, that
is the one place to update.

## How rooms are stored

`src/storage/file.ts` keeps one file of Yjs state per room. The server stores a room shortly after edits stop,
at least every 10 seconds while edits continue, and once more when the last client leaves. It loads the file
the next time someone opens that room.

File storage suits a single server process. To use a database or object storage, implement the `RoomStore`
interface in `src/storage/types.ts` and pass it to `createCollaborationServer` in `server.ts`. It has two
methods: `load` returns the saved bytes for a room, or `null`, and `store` replaces them.

Room state is not a DOCX file. See [Save DOCX files](#save-docx-files) for the Word file.

### Example: Postgres

With [`pg`](https://node-postgres.com) and one table:

```sql
CREATE TABLE collaboration_rooms (
  name       text PRIMARY KEY,
  state      bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

```ts
import pg from 'pg';
import type { RoomStore } from './src/storage/types.ts';

export function createPostgresRoomStore(pool: pg.Pool): RoomStore {
  return {
    async load(roomName) {
      const result = await pool.query('SELECT state FROM collaboration_rooms WHERE name = $1', [roomName]);
      return result.rows[0] ? new Uint8Array(result.rows[0].state) : null;
    },
    async store(roomName, state) {
      await pool.query(
        `INSERT INTO collaboration_rooms (name, state) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [roomName, Buffer.from(state)],
      );
    },
  };
}
```

In `server.ts`, replace the file store:

```ts
roomStore: createPostgresRoomStore(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
```

### Example: S3

With [`@aws-sdk/client-s3`](https://www.npmjs.com/package/@aws-sdk/client-s3), one object per room:

```ts
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { RoomStore } from './src/storage/types.ts';

export function createS3RoomStore(s3: S3Client, bucket: string): RoomStore {
  // Hash the client-supplied room name into a safe, fixed-length key.
  const key = (roomName: string) => `rooms/${createHash('sha256').update(roomName).digest('hex')}.yjs`;

  return {
    async load(roomName) {
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(roomName) }));
        return (await object.Body?.transformToByteArray()) ?? null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async store(roomName, state) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key(roomName), Body: state }));
    },
  };
}
```

In `server.ts`:

```ts
roomStore: createS3RoomStore(new S3Client({}), process.env.ROOMS_BUCKET!),
```

### More than one server process

Each store above replaces a room's whole state. If two server processes hold the same room, one can overwrite
the other's newer edits. Route every connection for a room to the same process, for example by hashing the
room name at your load balancer, or use Hocuspocus's Redis extension so the processes share each room.

## Create rooms from your backend

Create each document's room once, from one place, and have every editor, including the first, use
`roomMode: 'join'`. Browsers then never race to create the same room, and a room is never re-created over
existing edits from an older file.

```bash
pnpm create-room contract-42 ./contract.docx
```

The script opens the DOCX with `roomMode: 'create'`, stays connected until a second, fresh client can open the
complete room, then disconnects. Exit code `0` means the room is ready, `2` means it already exists and nothing
was written, and `1` means another failure. It reads `COLLABORATION_URL` (default `ws://127.0.0.1:1234`) and
uses `COLLABORATION_TOKEN`, or signs a token with `COLLABORATION_AUTH_SECRET`.

In your app, call `createRoom` from `src/create-room.ts` when a document is first shared, then record it:

```ts
if (!document.roomCreated) {
  await createRoom({ serverUrl, documentId: document.id, docxPath: document.localPath, token: serviceToken });
  await db.documents.update(document.id, { roomCreated: true });
}
// Every editor, the creator included, opens the same DOCX with roomMode: 'join'.
```

`createRoom` throws `RoomExistsError` if the room already exists. Treat that as "open it with `join`", never
as a reason to create a new room. If creation fails partway, read
[Recover an interrupted initialization](https://docs.superdoc.dev/editor/collaboration/initialize-a-document#recover-an-interrupted-initialization)
before retrying.

## Save DOCX files

The server saves each room as a DOCX:

- once the room has gone `COLLABORATION_DOCX_IDLE_MS` without edits,
- right away when the last person leaves, if there are unsaved edits,
- before the server shuts down, for every room with unsaved edits.

A Node SDK client that stays in the room, such as an agent, counts as a person. While it is connected the room
never empties, so the save on leave never runs. The idle save still does.

`src/docx/autosave.ts` does this with the [SuperDoc Node SDK](https://docs.superdoc.dev/agents/automation/node-sdk).
It joins the room as a client of this server, saves, and closes. The file matches what an editor would export,
including tracked changes and comments. The autosave does not appear to editors as a participant, and its own
connection never triggers another save.

The default `src/storage/file-docx.ts` keeps the latest file per document as `<documentId>.docx`. To send the
file somewhere else, implement `DocxStore` from `src/storage/types.ts` and pass it as `docxStore` in
`server.ts`. What happens to the file next is up to you: overwrite it, keep versions, upload it, or ignore it.

```ts
const docxStore: DocxStore = {
  async put(documentId, docx) {
    await s3.send(new PutObjectCommand({ Bucket: 'contracts', Key: `${documentId}.docx`, Body: docx }));
  },
};
```

With access checks on, the autosave needs a token your check accepts for every document. `server.ts` signs
one with the example secret. If you replace the access check, change the `token` function there too.

Each save runs a full SuperDoc engine: roughly 200 MB of memory for a short contract, and up to 2 GB for a
very large document. Saves run one at a time, and the engine closes each document as soon as it is saved. Size
the server's memory for your largest document, and raise `COLLABORATION_DOCX_IDLE_MS` if large documents are
edited often. A failed save is retried twice, then again after the room's next change. It never blocks
editing or room storage.

On shutdown, the server refuses new editor connections and freezes edits from existing connections before
the final DOCX exports. The internal autosave client can still join to finish those exports. If a final export
fails after its retries, the server exits with code `1`; acknowledged edits remain in room storage for recovery.

Keep `@superdoc/sdk` close to the `superdoc` version your browsers use. Both derive the room name from
`documentId`, and they must agree. Opening a room makes a small write, so an editor who opens and leaves without
editing still causes one save, with identical content.

## Add a server-side agent

`src/agent/review-agent.ts` joins a room with the Node SDK as a collaborator. Browser editors see its edits live,
as tracked changes under its name, and decide on them. Try it with the room from "Run it" open in a browser:

```bash
pnpm agent contract-42 "thirty days" "forty-five days"
```

The script joins the room, suggests the replacement, prints the receipt, and waits up to ten minutes
(`AGENT_WAIT_MS`) for an editor to accept or reject it. Then it leaves. It reads `COLLABORATION_URL`, and uses
`COLLABORATION_TOKEN` or signs a token with `COLLABORATION_AUTH_SECRET`, like `pnpm create-room`. Exit code `2`
means the text was not found and nothing was changed.

```text
Review Agent joined contract-42.
{"event":"suggested","find":"thirty days","replacement":"forty-five days","trackedChangeIds":["..."],...}
{"event":"decision","decision":"resolved","trackedChangeIds":["..."]}
Review Agent left contract-42.
```

In your own backend, use `joinAsAgent` directly:

```ts
const agent = await joinAsAgent({ serverUrl, documentId: 'contract-42', token: agentToken });
try {
  const suggestion = await agent.suggest('thirty days', 'forty-five days');
  const decision = await agent.waitForDecision(suggestion);
} finally {
  await agent.leave();
}
```

- **Identity.** The agent has two: the `sub` in its token, which your access check sees, and the SDK `user`
  name and email, which editors see as the author of its tracked changes. Give each agent its own token,
  scoped to the documents it works on.
- **Edits.** `suggest` finds the text with `query.match` and replaces it with `changeMode: 'tracked'`, so a
  person decides. It reads the document revision with `info()` before matching and passes it as
  `expectedRevision`, so an editor's change between the match and the replace makes it match again instead of
  replacing other words. Any [Document API](https://docs.superdoc.dev/document-api/mental-model) operation works the
  same way on the open document.
- **Receipts.** Every edit returns a [receipt](https://docs.superdoc.dev/document-api/receipts-and-errors).
  `suggest` keeps the tracked change IDs from it, and `waitForDecision` checks them until they are gone from
  `trackChanges.list`, then reports `resolved`, or `pending` if the wait ends first. A resolved change no longer
  says whether it was accepted or rejected; read the document if the agent needs to know. If no tracked change
  was made, `suggest` throws instead of reporting a suggestion nobody can review.
- **Working without a browser.** The agent's connection does not depend on any editor. It can edit while
  nobody has the document open. The room is stored as usual, and editors who join later see the suggestion.
- **Leaving and rejoining.** An agent can leave and a new one can join the same room later with
  `roomMode: 'join'`. It reads the room's current content, including what editors did while it was away.
- **Cleanup.** `leave` closes the document without saving a local copy, because the room already has every
  edit, then shuts down the SDK's engine process. It is safe to call more than once. Always call it, even after
  an error, or the engine process keeps running.

Each agent runs a full SuperDoc engine, like the DOCX autosave. While an agent is connected the room never
empties, so the save on leave waits for the idle save. The agent does not appear in editors' participant lists,
because the SDK does not publish presence. Editors see it through its tracked changes.

## Check it

```bash
pnpm typecheck
pnpm test
```

The tests start a real server and connect Yjs clients to it. They check that a room keeps its content after its
last client leaves and after the server restarts, that only a valid token for the room's document gets in, and
when DOCX files are saved. The DOCX and agent tests use a stand-in for the Node SDK.
