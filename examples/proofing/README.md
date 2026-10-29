# Proofing

Add local English spell checking to SuperDoc with Typo.js.

## Run it

Requires Node 22.12 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Type a misspelling, then right-click its underline to replace or ignore it. The dictionary runs in the browser and does not send document text over the network.
Checking only finds misspellings; the provider computes replacements in `suggest()` when you open an underline's menu, because Typo.js suggestions are much slower than lookups.

## Verify it

```bash
pnpm typecheck
pnpm build
pnpm browsers
pnpm test
```

The browser test replaces one misspelling, ignores another, and does not flag a valid contraction with a smart apostrophe.

See [Proofing](https://docs.superdoc.dev/editor/platform/proofing) for the provider contract and production guidance.
