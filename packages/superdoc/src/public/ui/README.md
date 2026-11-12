# Built-in UI controller conventions

## Names

- Name public types, methods, and events after the concept the developer uses: `ContextMenuConfig`, not
  `V2ContextMenuConfig`.
- Do not expose an implementation or version label unless developers must choose between distinct public contracts.

## Configuration and control

- Put automatic behavior in startup configuration under `ui.<surface>`.
- Put runtime control on `superdoc.ui.<surface>`.
- An openable surface exposes `open()` and `close()`. `open()` returns a fail-closed `WorkflowActionResult`; `close()` is
  safe to call when the surface is already closed or unavailable.
- Application-owned keyboard shortcuts call `open()`. Do not add a configuration option for each shortcut.

Keep each controller on the existing surface state. Do not introduce a second event bus or state store for the public
handle.

Format painter release notifications return a promise that resolves to `true` after
formatting commits and paint readiness is observed, or `false` when no application
succeeds. A paint-observation failure preserves a successful mutation result.
`whenSettled()` waits for the applications already started and returns the latest
accepted application's result; ignored duplicate or inactive notifications do not
replace it. DOM event callers can dispatch a release, then await this
method. Persistent mode stays active across applications, so its active state
does not indicate completion.
