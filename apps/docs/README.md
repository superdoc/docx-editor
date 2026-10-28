# SuperDoc documentation

This application serves `docs.superdoc.dev`. It is not published as a package.

Documentation published before it is served by a frozen archive at
`docs-v1.superdoc.dev`. Read `V1-ARCHIVE.md` before changing anything under
`config/v1-*`: those files decide where every previously published URL resolves.

## Local development

From `superdoc/public`:

```bash
pnpm install
pnpm --filter @superdoc/docs dev
```

Run the complete validation lane before opening a pull request:

```bash
pnpm --filter @superdoc/docs typecheck
pnpm --filter @superdoc/docs test:content
pnpm --filter @superdoc/docs test:links
pnpm --filter @superdoc/docs test:redirects
pnpm --filter @superdoc/docs build
pnpm --filter @superdoc/docs check:links
pnpm --filter @superdoc/docs check:redirects
pnpm --filter @superdoc/docs test:export
```

`typecheck` also compiles the included Rust examples with the SDK's pinned Rust
toolchain. This checks the examples against workspace types; running them against
the published crate and its native runtime is separate verification.

## Structure

- `content/docs` owns authored pages and page-local media.
- `examples` owns code that is included in pages and validated against the workspace packages.
- `components` owns documentation UI and rich MDX elements.
- `config/redirects.json` owns permanent and temporary route redirects.
- `config/routes.json` records every documentation page route that has shipped.
- `config/v1-manifest.json` is the frozen record of every URL the V1 documentation answered, and `config/v1-dispositions.json` decides where each one resolves now. See `V1-ARCHIVE.md`.
- `lib` owns content, Markdown, and export behavior.
- `scripts` generates the ignored Document API reference and deployment redirects.
- `tests` verifies authored content and the static export.

Generated reference pages, schemas, and models are not committed. Development, build, content-test, and typecheck commands regenerate them before use.

Read `DESIGN.md` before changing the visual system and `V1-ARCHIVE.md` before touching route dispositions.
