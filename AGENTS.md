# SuperDoc

Growing the published API surface needs a fixture under
`tests/consumer-typecheck/src/` that asserts both the parameter and return
shapes, and `pnpm check:public` has to pass.
Each `@ts-expect-error` there pins a misuse the published types reject.
Removing or weakening one loosens the public contract: the PR must name the
misuse it now allows and why, and review treats an unexplained removal as a
regression.

Run `pnpm` scripts from this directory, the one holding `pnpm-workspace.yaml`.
In an Orbit checkout that is `superdoc/public`, not the Orbit root, which does
not define them.

For local `.tgz` work in Orbit, use the root internal pack route in
[SuperDoc build profiles](../../docs/superdoc-build-profiles.md). Its staged
manifest is private; publication must use the canonical release route.

When extending a built-in UI controller, follow the naming, configuration, and
runtime-control conventions in `packages/superdoc/src/public/ui/README.md`.

## Code Review Rules

Report only issues introduced or exposed by this PR that have a concrete failure
mode or material impact. Prioritize correctness bugs, data loss or corruption,
exploitable security or privacy weaknesses, concurrency or state errors,
architectural boundary or contract violations, and developer-facing regressions
that break or materially complicate setup, build, test, release, recovery, or
safe API usage.

Explain the triggering condition and impact. Do not report formatting, naming,
comment wording, documentation polish, minor duplication, speculative
refactors, missing tests without a concrete risk, or findings already enforced
by automated tooling. Omit uncertain or preference-only feedback.
