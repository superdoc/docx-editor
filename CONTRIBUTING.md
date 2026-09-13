# Contributing to SuperDoc

Community contributions start with an issue. Pull requests are limited to
repository collaborators.

We’ve found that reviewing and integrating external PRs often takes more time
than implementing a fix from a clear report. Even a small change can affect
other editor behavior that requires broader context to verify. We want to
explain this upfront so you don’t spend time on a PR we can’t accept.

## Ways to contribute

Report suspected security vulnerabilities privately through
[GitHub Security Advisories](https://github.com/superdoc/docx-editor/security/advisories/new),
as described in our [security policy](SECURITY.md). Do not include vulnerability
details in public issues.

Bug reports, feature requests, documentation feedback, and technical
investigations are welcome. Search [open issues](https://github.com/superdoc/docx-editor/issues)
first, then [open an issue](https://github.com/superdoc/docx-editor/issues/new/choose)
with what you’re trying to do, what happened, and what you expected.

For bugs, include your SuperDoc version and a small reproduction if possible.
For rendering differences, include a sample `.docx` and screenshots showing
SuperDoc and Microsoft Word. Use synthetic or redacted documents without
confidential information.

Already investigated or written a fix? Include your findings, test results, or
a link to the patch in the issue. That context helps us understand the problem
and develop a solution. You don’t need to write code to contribute.

## Working on the code

The instructions below cover local development and PRs for repository
collaborators. You can also use them to reproduce a problem locally.

Documentation lives in `apps/docs/` and ships to
[docs.superdoc.dev](https://docs.superdoc.dev). Run `pnpm run dev:docs` to
preview it. Runnable examples live in `examples/`.

## Choose a branch

Open contributions against `main` for the current V2 editor. Target `v1` only
for fixes that must also ship in the maintained V1 editor. If you are unsure,
use `main` or ask in the issue before starting implementation.

Maintainers squash-merge contributions to `main`; that reviewed merge is the
approval signal used to synchronize eligible source, test, and documentation
changes into SuperDoc's canonical source history.

## Contributor License Agreement

Before we can merge your first pull request, you need to agree to the SuperDoc
[Contributor License Agreement](CLA.md) (CLA). It applies to every contribution
to a SuperDoc repository, including code, documentation, and examples. You keep
ownership of your work. The CLA gives SuperDoc the rights it needs to include,
maintain, and distribute your contribution under the project's open source and
commercial licenses. You sign once for all future contributions from the same
GitHub account.

An automated CLA assistant comments on your first pull request with a link to
the agreement and an acceptance phrase. Review the agreement, then reply to the
pull request with that phrase. To arrange another way to sign, email
[legal@superdoc.dev](mailto:legal@superdoc.dev).

If your employer may own work you create, make sure you have permission to
contribute or ask your employer to sign a Corporate CLA with us. Contact
[legal@superdoc.dev](mailto:legal@superdoc.dev) to arrange it. See Section 4 of
the [CLA](CLA.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 22, pinned in `.nvmrc`
- [pnpm](https://pnpm.io/) 11, pinned in `package.json#packageManager`
  (`corepack enable` picks it up)

## Set up locally

Fork the repository on GitHub, then:

```bash
git clone https://github.com/<your-username>/docx-editor.git
cd docx-editor
pnpm install
pnpm dev
```

`pnpm dev` gives you a live editor to try your changes in.

## Where to make changes

| What you want to change | Where to look |
|---|---|
| Visual rendering | `packages/layout-engine/painters/dom/` |
| Style resolution (fonts, colors, borders) | `packages/layout-engine/style-engine/` |
| Editing behavior (keyboard, commands) | v2 document runtime commands and adapters |
| DOCX import and export | v2 document runtime import/export code |
| Main entry point | `packages/superdoc/` |
| React wrapper | `packages/react/` |

Design note worth knowing before you touch import: the importer stores raw OOXML
properties and the style engine resolves them at render time. Resolving styles
during import bakes them into node attributes and loses the original document
intent on export.

## Test your change

```bash
pnpm test          # all packages
pnpm test:superdoc # just the superdoc package
pnpm run lint
pnpm run format
```

Unit tests sit next to the source they cover. Test placement, fixture rules, and
DOCX fixture privacy are documented in [`tests/README.md`](tests/README.md).
Read the fixture privacy section before committing a `.docx`: fixtures are
synthetic by default, and `pnpm check:docx-privacy` will fail on a document it
cannot verify.

For rendering changes, run the unit suites and then compare the affected `.docx`
side by side in Microsoft Word and SuperDoc. There is no pixel-diff gate.

Full local CI is a separate, slower step and needs
[Bun](https://bun.sh/) 1.3.13 on your PATH for the checks that parse TypeScript
directly:

```bash
pnpm ci:local
```

## Open a pull request

Keep the PR focused on one fix or feature. Use
[Conventional Commits](https://www.conventionalcommits.org/) for the commit
message, since the release version is derived from it:

| Prefix | Release |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `chore:`, `docs:`, `refactor:`, `test:` | none |

A local Git hook checks the message format before the commit lands.

### Peer dependency changes

Peer dependencies are a compatibility contract with applications that install a published SuperDoc package. Any authored change to that contract requires manual review. CI compares the effective packed ranges, including `catalog:` and `workspace:` resolutions, with the pull request base and leaves a review comment when they differ.

Use a `feat:` title for a backward-compatible expansion such as widening a tested range, adding an optional peer, or making a required peer optional. Use a breaking `!` title for a change that removes accepted versions, adds a required peer, makes an optional peer required, or removes or replaces a peer contract. The protected check fails when the configured release planner would produce less than the required release impact; a breaking peer change cannot merge until the release path can produce the required major release.

The existing exact `superdoc` dependency and peer in `@superdoc/react` are a release-managed exception: the version stamper moves both pins only as part of the coordinated React and SuperDoc release train after protected PR checks. Changing the pin form, optionality, or compatibility policy is still an authored contract change and follows the rules above.

Read the [package compatibility policy](https://docs.superdoc.dev/resources/package-compatibility) before changing `peerDependencies`, `peerDependenciesMeta`, or a catalog entry used by a peer.

Before you open the PR:

- [ ] `pnpm test` passes
- [ ] `pnpm run format:check` and `pnpm run lint` pass
- [ ] Tests added or updated
- [ ] The description says what changed and why, and links the issue
- [ ] Screenshots for visual changes
- [ ] If you grew the public API surface, you added a fixture under
      `tests/consumer-typecheck/src/` asserting both the parameter and return
      shapes, and `pnpm check:public` passes

CI runs on your PR and a maintainer will review it.

## Community and conduct

- [Discord](https://discord.com/invite/b9UuaZRyaB) for questions and discussion
- [Docs](https://docs.superdoc.dev) for the API reference and guides

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). Report
unacceptable behavior to [conduct@superdoc.dev](mailto:conduct@superdoc.dev).
