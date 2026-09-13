# Basic review fixture

One tracked insertion and two short editable paragraphs. Alex Rivera is a
synthetic reviewer. The shared NDA fixture is intentionally unchanged.

```bash
ooxml-fixture build --manifest review-manifest.json --out /tmp/basic-review-output
```

Copy the generated DOCX to `apps/docs/public/fixtures/` and
`examples/document-modes/public/`. Fixture tests keep those bytes identical.

Open XML SDK 3.4.1, Office 2019 validation: no errors.
Tool: ooxml-fixture 1.0.0+b12205e5bf29b194d3c9e5e1c299723e5669214d,
.NET 10.0.7, osx-arm64.
Input SHA-256: `deb34ac67cd68ec452a2d4bfee6a9bcfe4d9ffaecc5efa1c85b340aee26ed8b5`.
DOCX SHA-256: `9a6fff354d10467a206590c36a707b70685962f2c72f39219538f26caf0caece`.
Validation establishes package structure, not Word rendering.
