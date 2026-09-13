# Custom UI

Keep the SuperDoc canvas and replace its built-in toolbar with one application-owned Bold button.

The example intentionally implements one control. Add more commands only when your product needs them.

## Run it

Requires Node 22.12 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Select text, choose **Bold**, and export the DOCX.

## Verify it

```bash
pnpm typecheck
pnpm build
pnpm browsers
pnpm test
```

The browser test selects text through the real editor, runs the application-owned command, exports the DOCX, and verifies the formatting in `word/document.xml`.

See [Build your first custom control](https://docs.superdoc.dev/editor/custom-ui/controller-setup) for the Vanilla and
React setup.
