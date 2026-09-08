# Work with content controls

Use one example to add fields to a DOCX template or fill prepared fields from application data.

## Run it

Requires Node 22.12 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Choose **Add fields** to create inline and block fields from document selections. Choose **Fill fields** to update
repeated text fields and a checkbox in a prepared template. Each workflow loads its own service-agreement fixture.

After filling, select **Lock address after filling** to protect that value, or clear it to allow edits again.
After adding the block field, choose **Use mutual confidentiality clause** to replace its paragraph without removing
the field. Export and reopen to check that the lock or replacement remains.

## Verify it

```bash
pnpm typecheck
pnpm build
pnpm browsers
pnpm test
```

The tests export and reopen both workflows. They verify field structure, metadata, repeated values, occurrence navigation,
and checkbox state.

See [Add fields to a DOCX template](https://docs.superdoc.dev/editor/content-controls/add-fields-to-a-docx-template) or
[Fill a DOCX template](https://docs.superdoc.dev/editor/content-controls/fill-a-docx-template) for a focused walkthrough.
