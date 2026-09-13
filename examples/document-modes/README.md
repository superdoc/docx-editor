# Document modes

Switch one browser editor between viewing, editing, and suggesting.

This example demonstrates editor behavior, not authorization. Your application still decides who may open a document or change its mode.

## Run it

Requires Node 22.12 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Choose a mode and edit the sample document. Suggesting records edits as tracked changes. Viewing prevents edits.

Choose **Review changes** (or open `?workflow=review`) for the compact review sample. Accept the existing proposal,
make edits in two different paragraphs, reject one, and leave the other undecided. Export and reopen the DOCX in
SuperDoc or Word: the accepted text remains, the rejected edit is gone, and the undecided proposal is still available.
Export downloads a file; it does not save to a server.

## Verify it

```bash
pnpm typecheck
pnpm build
pnpm browsers
pnpm test
```

The browser tests check viewing, suggesting, accept/reject decisions, exported revision XML, and reopening the reviewed
file in SuperDoc. They do not verify Microsoft Word rendering.

See [Document modes](https://docs.superdoc.dev/editor/document-modes) for the mode contract.
