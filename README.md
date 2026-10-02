<h1 align="center">
  <a href="https://www.superdoc.dev" target="_blank">
    <img alt="" src="apps/docs/public/brand/superdoc-mark.webp" width="58" height="64" align="absmiddle" />
    SuperDoc
  </a>
</h1>

<div align="center">
  <a href="https://www.npmjs.com/package/superdoc" target="_blank"><img src="https://img.shields.io/npm/v/superdoc.svg?color=1355ff" height="22px"></a>
  <a href="https://www.npmjs.com/package/superdoc" target="_blank"><img src="https://img.shields.io/npm/dm/superdoc.svg?color=1355ff" height="22px"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0" target="_blank"><img src="https://img.shields.io/badge/License-AGPL%20v3-1355ff.svg?color=1355ff" height="22px"></a>
  <a href="https://discord.com/invite/b9UuaZRyaB" target="_blank"><img src="https://img.shields.io/badge/discord-join-1355ff" height="22px"></a>
</div>

<p align="center">
  <strong>The document engine for DOCX files.</strong><br>
  Render and edit DOCX files in the browser. Use the same Document API for server-side automation and agent workflows.<br>
  Built directly on OOXML. Edits write back to the XML without an HTML conversion step.
</p>

<div align="center">
  <a href="https://www.superdoc.dev" target="_blank">
   <img width="800px" height="auto" alt="SuperDoc" src="https://github.com/user-attachments/assets/3d74b4a7-b112-4591-a3be-7c965721d22b" />
  </a>
</div>

## Quick start

```bash
npm install superdoc
```

SuperDoc mounts into elements you provide, so the page needs both before it
runs:

```html
<div id="superdoc-toolbar"></div>
<div id="superdoc"></div>
```

```javascript
import 'superdoc/style.css';
import { SuperDoc } from 'superdoc';

const superdoc = new SuperDoc({
  selector: '#superdoc',
  toolbar: '#superdoc-toolbar',
  document: '/sample.docx',
  documentMode: 'editing',
});
```

`document` accepts a URL, a `File`, or a `Blob`. Omit it to start with a blank
DOCX. See the [documentation](https://docs.superdoc.dev) or the
[React quick start](https://docs.superdoc.dev/editor/frameworks/react) for next
steps.

## What SuperDoc does

- **DOCX-native.** Pagination, sections, headers, footers, and tables stay
  document structures. Edits write back to the XML without an HTML conversion
  step.
- **Browser editing.** View, edit, suggest, comment, track changes, and
  collaborate with Yjs. The editor needs no server of its own.
- **One Document API.** Query, target, change, and inspect receipts in the
  browser or through the
  [Node.js SDK](https://www.npmjs.com/package/@superdoc/sdk),
  [Python SDK](https://docs.superdoc.dev/agents/automation/python-sdk/),
  [CLI](https://www.npmjs.com/package/@superdoc/cli), and
  [MCP server](https://www.npmjs.com/package/@superdoc/mcp).
- **Agent-ready operations.** Agents use supported document operations instead
  of manipulating raw XML. The engine handles the underlying OOXML parts and
  relationships.

## Why V2 is DOCX-native

SuperDoc V1 used ProseMirror as its authoritative browser editing model. A DOCX
is a package of related XML parts, relationships, and assets rather than one
editor tree. Server use required a simulated browser DOM, and collaboration
needed a separate synchronization layer for the rest of the package.

V2 uses an OOXML-backed document model. It reads progressively, renders bounded
windows, runs without a browser DOM, and synchronizes document content and
package state through one collaboration model.

## Contributing

Community contributions start with an
[issue](https://github.com/superdoc/docx-editor/issues/new/choose). Bug reports,
feature requests, and technical investigations are welcome. Pull requests are
limited to repository collaborators. Read the
[contributing guide](https://github.com/superdoc/docx-editor/blob/main/CONTRIBUTING.md)
for why and how to help, or join [Discord](https://discord.com/invite/b9UuaZRyaB)
for questions. Report suspected security vulnerabilities privately through
[GitHub Security Advisories](https://github.com/superdoc/docx-editor/security/advisories/new).

## Contributors

Thank you to everyone who has helped us build and improve the SuperDoc editor.

<img src="./assets/contributors.svg" alt="SuperDoc contributors across V1 and V2" />

## License

AGPLv3 for open source use. A
[commercial license](https://www.superdocportal.dev/get-in-touch) is available
for proprietary deployments.

---

Created and maintained by <a href="https://www.superdoc.dev" target="_blank">SuperDoc</a>
