# Collaboration

Open one DOCX in two browser tabs and synchronize edits through a local Hocuspocus server.

By default, the server keeps rooms in memory. Set `COLLABORATION_STORAGE_DIR` to try local file persistence without changing the browser configuration. Neither mode includes authentication.

## Run it

Requires Node 22.12 or newer and pnpm 11.

```bash
pnpm install --ignore-scripts
pnpm dev
```

Open `http://localhost:5173/?mode=create&user=Alex` once to create the room. Wait for `Connected.`, then open
`http://localhost:5173/?user=Sam` in another tab. Both tabs use the compact delivery agreement from the docs demo.
Change the delivery date in Alex's editor and confirm that Sam sees it. Type a reply in Sam's editor to check both directions.

To return to a room that is still live or saved with file persistence, use `?user=Alex` or `?user=Sam`.
Do not reuse `mode=create` for an existing room. With the default in-memory server, the room is lost after
the last editor disconnects and the server unloads it, or after a server restart. Create it again with
`?mode=create&user=Alex`, then join as Sam. This starts from the sample document; previous edits are lost.

## Verify it

To try server-side room access checks, run:

```bash
COLLABORATION_DEMO_AUTH=1 VITE_COLLABORATION_DEMO_AUTH=1 pnpm dev
```

Create as `?mode=create&user=Alex`, then join as `?user=Sam`. A join as `?user=Taylor` is rejected. These are public test credentials, not a login system; never use this credential map for private documents.

To keep room state between restarts, stop the development command and run:

```bash
COLLABORATION_STORAGE_DIR=.collaboration-data pnpm dev
```

After editing, wait for `Room state saved.` in the server terminal. Restart with the same directory and reopen with a join address. Files contain binary Yjs state, not DOCX exports. This storage example is for one local server process, not production deployment.

Run the checks:

```bash
pnpm typecheck
pnpm build
pnpm browsers
pnpm test
pnpm test:persistence
pnpm test:storage
pnpm test:access
```

The browser tests cover shared edits, reopening, and DOCX export. The persistence test closes all clients, restarts the server process with its saved files, and checks the restored text and exported DOCX.

See [Connect two editors](https://docs.superdoc.dev/editor/collaboration/connect-two-editors) for the walkthrough and
[Initialize a shared document](https://docs.superdoc.dev/editor/collaboration/initialize-a-document) for create/join ownership.
