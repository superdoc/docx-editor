# Documentation collaboration server

Powers the two-editor and presence demos on `docs-staging.superdoc.dev`. This is docs infrastructure, not a supported customer collaboration backend. The local Hocuspocus tutorial and access-control demo do not use it.

## Run locally

From `superdoc/public`, install dependencies, then run:

```sh
pnpm --filter @superdoc/docs-collaboration exec wrangler dev --port 8791 \
  --var ROOM_SECRET:local-test-only --var ALLOWED_ORIGINS:http://localhost:3016
NEXT_PUBLIC_COLLABORATION_ROOM_SERVICE_URL=http://localhost:8791 \
  pnpm --filter @superdoc/docs exec next dev --port 3016
```

Use Node 22. Set `NEXT_PUBLIC_COLLABORATION_ROOM_SERVICE_URL` before building docs; changing a Pages runtime variable cannot change a static bundle.

## Verify

With the local server running, from this directory:

```sh
pnpm typecheck
DEMO_SERVER_URL=http://localhost:8791 DEMO_TEST_SECRET=local-test-only pnpm test
```

The tests use real Yjs clients. `DEMO_TEST_SECRET` allows a test to sign a short-lived room without changing the deployed lifetime. Never set it for remote tests. Admission is limited to six rooms per minute per IP; avoid running browser and server suites concurrently against the same instance.

From `examples/collaboration`, run the existing docs browser checks:

```sh
DOCS_COLLABORATION_TEST_URL=http://localhost:3016/editor/collaboration/connect-two-editors/ \
  pnpm exec playwright test --config playwright.docs.config.ts --grep 'synchronizes, zooms|startup preserves|presence'
```

## Deploy staging

Worker: `superdoc-docs-collaboration-staging` in the SuperDoc Cloudflare account. Its URL is `https://superdoc-docs-collaboration-staging.superdoc.workers.dev`.

Run `pnpm deploy` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for that account. Provision `ROOM_SECRET` once with `wrangler secret put ROOM_SECRET`, using a cryptographically random value. Do not put it in Wrangler vars, Git, or the docs bundle. Without it, admission fails closed. Rotating it invalidates existing room credentials.

The existing docs deploy workflow enables the service for `main` (staging), not `stable` (production). Deploy the Worker before enabling its docs URL. The docs CSP must allow this exact HTTPS/WSS host.

## Monitor and pause

In the SuperDoc Cloudflare account, open **Workers & Pages → superdoc-docs-collaboration-staging → Metrics** for requests and runtime errors. Open its `CollaborationRoom` Durable Object namespace for duration, requests, and storage usage. These built-in metrics do not require enabling request logs. Worker runtime errors do not count rejected HTTP requests such as admission `429` responses.

Configure usage or budget alerts under **Notifications**, with an agreed threshold and recipient. Billing alerts cover account/product usage, not just this demo; they notify but do not stop spending. Keep existing account alerts unchanged.

To pause the demo, open the Worker's **Settings → Domains & Routes** and disable `workers.dev`. This blocks new rooms and new WebSocket connections through that endpoint. Do not rely on it to close existing sockets immediately; rooms still have their 15-minute expiry. Keep the Worker and its signing secret so room cleanup can run.

Also set `workers_dev` to `false` in `wrangler.jsonc` before the next deployment, or Wrangler will re-enable the endpoint. To resume, restore `true` and deploy. Preview URLs are already disabled; revisit this procedure if another route is added.

## Room lifecycle and limits

- `POST /rooms` issues a random document ID and signed capability. The capability permits access only to that room until its fixed 15-minute expiry.
- One Durable Object runs a `y-partyserver` Yjs server per room. SuperDoc connects through its existing `y-websocket` provider, with the capability in `params.token`.
- Binary document state is stored in the object's SQLite database to support reconnect. An alarm removes it at expiry; connection and message handlers also enforce expiry. Storage cleanup can lag if Cloudflare delays the alarm, but expired credentials cannot reconnect.
- Awareness is live presence, not stored document state. Hibernation is disabled for this initial demo.
- Limits: four connections, 1 MiB per frame/document snapshot, 16 MiB cumulative incoming bytes, and 120 messages per second per room. Exceeding a room budget closes it until expiry.
- Cloudflare admission limits are six rooms per minute per IP and 60 per minute per location overall. These are abuse controls, not a global billing cap. Origin checking alone is not authentication.

Only synthetic sample text belongs here. No uploads or request-body logging are provided. This service is not durable document storage; export important work elsewhere.
