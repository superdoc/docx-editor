# SuperDoc examples

This is the only examples catalog for SuperDoc. Each child directory is a small, complete project that can be copied out of the repository and run on its own.

Every example is typechecked and has a behavior test for the outcome its README promises. Browser examples are also built before their behavior test runs.

## Examples

### Quickstarts

- [Vanilla TypeScript quickstart](https://go.superdoc.dev/examples/vanilla) — open a DOCX, edit it, and export the result.
- [React quickstart](https://go.superdoc.dev/examples/react) — own the editor lifecycle from a React component.

### Focused workflows

- [Bounded SDK batches](./sdk-batch) — limit active documents, reuse hosts for finite batches, and retain failed work for recovery.
- [Document comparison](https://go.superdoc.dev/examples/document-comparison) — compare two DOCX files and apply the result as a reviewable tracked change.
- [Version history](https://go.superdoc.dev/examples/version-history) — save and restore browser-owned DOCX snapshots.
- [Custom UI](https://go.superdoc.dev/examples/custom-ui) — format a document from an application-owned control.
- [Content controls](https://go.superdoc.dev/examples/content-controls) — add fields to a DOCX template or fill them from application data.
- [Document modes](https://go.superdoc.dev/examples/document-modes) — switch between viewing, editing, and suggesting.
- [Search](https://go.superdoc.dev/examples/search) — enable the built-in find surface and navigate matches.
- [Proofing](https://go.superdoc.dev/examples/proofing) — add local spell checking with suggestions and Ignore.
- [Collaboration](https://go.superdoc.dev/examples/collaboration) — synchronize one DOCX between two browser pages.

## Run an example in this repository

Inside this repository, examples use the workspace packages instead of the published ones. Build them before you run `pnpm dev` or `pnpm test` in an example:

```bash
pnpm install
pnpm build:superdoc
pnpm --filter @superdoc/react run build # React example only
```

A copied example installs its `superdoc` version from npm and needs neither build.
