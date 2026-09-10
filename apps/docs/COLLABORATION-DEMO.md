# Collaboration demo

The docs own a staging-only Durable Object service in [collaboration-server](./collaboration-server/README.md).
It uses the pinned SuperDoc runtime and Yjs WebSockets. Rooms expire after 15 minutes; only use sample text.
The local Hocuspocus tutorial and access-control demo remain separate. Builds without a server URL show the illustration and local walkthrough.

## Local Hocuspocus server

From `superdoc/public`, start the server:

```bash
VITE_SUPERDOC_EXAMPLE_PORT_OFFSET=100 pnpm --dir examples/collaboration exec tsx server.ts
```

In another terminal, start docs on an available port:

```bash
NEXT_PUBLIC_COLLABORATION_DEMO_URL=ws://127.0.0.1:1334 pnpm --filter @superdoc/docs exec next dev --port 3015
```

Open `/editor/collaboration/connect-two-editors`. The demo connects automatically and starts collapsed. Expand it, edit either pane, and check the other. Alex's cursor is blue; Sam's is green.
Restart asks before discarding edits and creates a new room. Unmount destroys both editor instances.

## Access checks

Start the separate localhost-only access server:

```bash
pnpm --dir examples/collaboration exec tsx docs-access-server.ts
```

Add `NEXT_PUBLIC_COLLABORATION_ACCESS_DEMO_URL=ws://127.0.0.1:1335` to the docs command and restart it.
Open `/editor/collaboration/control-room-access`. Alex opens automatically; Sam may join, Taylor may not.
The credentials are public fixtures, not a login system. Rooms stay in memory.

The pinned runtime reports rejected authentication as a generic connection error. This demo's `/access-result`
endpoint confirms actual server rejections using a random connection-attempt ID, not the selected name.
Results expire after one minute and the server retains at most 256. An unavailable result stays a connection error.
This endpoint is demo infrastructure, not a SuperDoc API or a production authorization pattern.

## Browser checks

Run the focused browser tests against that page:

```bash
DOCS_COLLABORATION_TEST_URL=http://127.0.0.1:3015/editor/collaboration/connect-two-editors VITE_SUPERDOC_EXAMPLE_PORT_OFFSET=200 pnpm --dir examples/collaboration test tests/docs-embed.spec.ts
```

The test harness's own example servers use the offset of 200; the embedded demo connects to 1334.

Before hosting, add server-enforced expiration, room-scoped access, connection and payload limits, and abuse protection.
Do not publish a build containing a localhost URL. No continuous connection-health indicator is claimed: initial readiness
is not ongoing connectivity. After startup errors the sample stays visible; only explicit restart discards edits.
