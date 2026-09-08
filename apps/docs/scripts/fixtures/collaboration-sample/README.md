# Collaboration sample

Synthetic delivery agreement for the two-editor demo. No customer data or document metadata.

Rebuild into a fresh output directory:

```bash
ooxml-fixture build --manifest manifest.json --out /tmp/collaboration-fixture-output
```

Copy `collaboration-sample.docx` to `apps/docs/public/fixtures/` and to
`examples/collaboration/public/sample.docx`. Fixture tests require identical bytes.

Validated with Open XML SDK 3.4.1, Office 2019 profile: no errors.
Tool: ooxml-fixture 1.0.0+b12205e5bf29b194d3c9e5e1c299723e5669214d, .NET 10.0.7.
DOCX SHA-256: `a532b5e54a285d23507ba031d8781aa9e7447ed82aff785786c30df0946a45e3`.
This validates package structure, not Microsoft Word rendering.
