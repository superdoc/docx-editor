# Version history

Save DOCX snapshots in browser memory and restore an earlier version.

The sample is the Quickstart statement of work, copied unchanged from the docs fixture.

This example keeps storage deliberately small: versions last only until the page reloads. A production application can persist the same exported `Blob` objects in its own backend or browser storage.

## Run it

Requires Node 22.12 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Choose **Save version** to keep Version 1. Edit the document and save Version 2.
Restore Version 1: the example creates Version 3 with its contents and keeps Version 2 available.
Export the current DOCX to keep a file after closing the page.

## Verify it

```bash
pnpm typecheck
pnpm build
pnpm browsers
pnpm test
```

The browser test saves a real DOCX, edits it, and restores Version 1 as Version 3.
It checks the exported contents and restores Version 2 again to prove newer work remains available.

This local example has no backend, cross-tab conflict handling, or collaboration room. For durable history, use
server-assigned version IDs and reject saves based on an outdated current version.

See [Add version history](https://docs.superdoc.dev/editor/version-history) for the storage ownership model.
