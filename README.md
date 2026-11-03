<h1 align="center">
  <a href="https://www.superdoc.dev"><img alt="" src="apps/docs/public/brand/superdoc-mark.webp" width="58" height="64" align="absmiddle" /><img alt="SuperDoc" src="assets/superdoc-wordmark.svg" width="234" height="64" align="absmiddle" /></a>
</h1>

<div align="center">
  <a href="https://www.npmjs.com/package/superdoc" target="_blank"><img src="https://img.shields.io/npm/v/superdoc.svg?color=1355ff" alt="SuperDoc npm version" height="22px"></a>
  <a href="https://www.npmjs.com/package/superdoc" target="_blank"><img src="https://img.shields.io/npm/dm/superdoc.svg?color=1355ff" alt="SuperDoc monthly npm downloads" height="22px"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0" target="_blank"><img src="https://img.shields.io/badge/License-AGPL%20v3-1355ff.svg?color=1355ff" alt="License: AGPLv3" height="22px"></a>
  <a href="https://discord.com/invite/b9UuaZRyaB" target="_blank"><img src="https://img.shields.io/badge/discord-join-1355ff" alt="Join the SuperDoc Discord community" height="22px"></a>
</div>

<p align="center">
  <strong>SuperDoc</strong> is the open source DOCX Editor and Agent SDK for reviewing, filling, and editing documents. Word-quality DOCX editing, built for your product.
</p>

Tracked changes, threaded comments, tables, headers, and footers stay DOCX structures, and pages lay out as in Word. Edits write back to OOXML without an HTML conversion step.

- **Open Source.** AGPLv3, with a commercial license for proprietary deployments.
- **Self-hosted.** Runs in the browser, on your servers, or inside your agent workflows (Node.js, Python, Rust, CLI, MCP). It does not require document content to be sent to SuperDoc.
- **Custom UI.** Use the built-in UI or build your own on the same Document API.

<p align="center">
  <a target="_blank" href="https://www.superdoc.dev">Live demo</a> · <a target="_blank" href="https://docs.superdoc.dev">Documentation</a> · <a href="#quick-start-docx-editor">Editor quick start</a> · <a href="#quick-start-docx-agent">Agent quick start</a> · <a target="_blank" href="https://github.com/superdoc/docx-editor/issues/new?template=bug-report.yml">Report a bug</a>
</p>

## Quick start: DOCX editor

<a href="https://www.superdoc.dev" target="_blank"><img src="assets/editor-quickstart.png" width="100%" alt="SuperDoc DOCX Editor and toolbar and sidepanel showing an editable document pages with tracked changes and comments"/></a>

```bash
npm install superdoc
```

SuperDoc mounts into elements you provide:

```html
<div id="toolbar"></div>
<div id="editor"></div>
<button id="export" type="button" disabled>Export DOCX</button>
```

```js
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  documentMode: 'editing',
  ui: { toolbar: { container: '#toolbar' } },
  onReady: () => { document.querySelector('#export').disabled = false; },
});

document.querySelector('#export').addEventListener('click', async () => {
  await superdoc.export({ exportType: ['docx'], exportedName: 'sample-edited' });
});
```

`document` accepts a URL, a `File`, or a `Blob`. Omit it to start with a blank
DOCX. `documentMode` is `'editing'`, `'suggesting'`, or `'viewing'`. The editor
needs no server of its own.

Next, follow the [editor quick start](https://docs.superdoc.dev/editor/quickstart)
for a complete vanilla JavaScript or React project, then
[configure the editor](https://docs.superdoc.dev/editor/configuration).

## Quick start: DOCX agent

<a href="https://www.superdoc.dev" target="_blank"><img src="assets/agent-quickstart.png" width="1200" alt="SuperDoc agent workflow showing an LLM using the SDK to add a risk review comment to a DOCX contract."/></a>

Use a headless SDK to let your own LLM review and edit DOCX files. This example
uses the Node.js SDK with the
[Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) to
change a contract's payment terms as tracked changes.

```bash
npm install @superdoc/sdk ai@6 @ai-sdk/anthropic@3
curl -fL https://raw.githubusercontent.com/superdoc/docx-editor/refs/heads/main/assets/sample-contract.docx -o sample-contract.docx
```

Set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` before running it.

```js
import { SuperDocClient, createAgentToolkit } from '@superdoc/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, jsonSchema, stepCountIs } from 'ai';

const client = new SuperDocClient({
  user: { name: 'Contract assistant', email: 'assistant@example.com' },
});

try {
  await client.connect();
  const doc = await client.open({ doc: './sample-contract.docx' });

  const toolkit = await createAgentToolkit({
    provider: 'vercel', preset: 'core', enforceChangeMode: 'tracked',
  });
  const tools = Object.fromEntries(toolkit.tools.map(tool => [tool.name, {
    description: tool.description,
    inputSchema: jsonSchema(tool.inputSchema),
    execute: args => toolkit.dispatch(doc, tool.name, args),
  }]));

  await generateText({
    model: anthropic(process.env.ANTHROPIC_MODEL),
    system: toolkit.systemPrompt,
    prompt: 'Change payment terms from 60 to 30 days',
    tools,
    stopWhen: stepCountIs(10),
  });

  await doc.save({ out: './sample-contract-reviewed.docx' });
} finally {
  await client.dispose();
}
```

Your LLM chooses which SuperDoc tools to call; SuperDoc runs the document
operations and, with `enforceChangeMode: 'tracked'`, records every edit as a
tracked change. Document content sent to the model is subject to the model
provider's policies.

Before saving in production, check each edit's receipt. See
[Build an agent](https://docs.superdoc.dev/agents/build/build-an-agent) for
the full loop and verification, and
[real-time collaboration](https://docs.superdoc.dev/editor/collaboration/) to
have agents and users edit the same document at once.

## Demos and examples

- [`examples/`](examples): small, runnable projects for common workflows.
- [demos.superdoc.dev](https://demos.superdoc.dev/): full demo applications, including custom UIs.

## How SuperDoc works

SuperDoc reads, renders, edits, and writes DOCX files through their Office Open
XML (OOXML) parts.

1. **Open.** The engine parses content, styles, relationships, media, headers,
   footers, and the other OOXML parts into editable document state.
2. **Render.** The layout engine paginates that state, and the browser paints
   the resolved pages. OOXML remains the document format.
3. **Edit.** Editor input and headless operations update document state through
   the Document API: queries, targets, mutations, and receipts.
4. **Write.** Save and export write changes back into the OOXML package instead
   of rebuilding a DOCX from HTML.

The same engine runs without a browser DOM, so the editor, SDKs, CLI, and MCP
server share one document model.

## Packages

| Package | Purpose |
| --- | --- |
| [`superdoc`](https://www.npmjs.com/package/superdoc) | Browser DOCX editor for JavaScript and TypeScript. |
| [`@superdoc/react`](https://www.npmjs.com/package/@superdoc/react) | React wrapper for the editor. |
| [`@superdoc/vue`](https://www.npmjs.com/package/@superdoc/vue) | Vue wrapper for the editor. |
| [`@superdoc/sdk`](https://www.npmjs.com/package/@superdoc/sdk) | Node.js SDK for headless DOCX editing and agent toolkits. |
| [`@superdoc/cli`](https://www.npmjs.com/package/@superdoc/cli) | `superdoc` command-line interface. |
| [`@superdoc/mcp`](https://www.npmjs.com/package/@superdoc/mcp) | MCP server for AI agents and MCP clients. |
| [`@superdoc/fonts`](https://www.npmjs.com/package/@superdoc/fonts) | Optional metric-compatible font substitutes. |
| [`superdoc-sdk`](https://pypi.org/project/superdoc-sdk/) (PyPI) | Python SDK. See the [Python SDK guide](https://docs.superdoc.dev/agents/automation/python-sdk). |
| [`superdoc-sdk`](https://crates.io/crates/superdoc-sdk) (crates.io) | Rust SDK. See its [README](packages/sdk/langs/rust/README.md). |

Stable releases are published to npm as `latest`. To try fixes and features
from `main` before they reach stable, install the `next` tag, for example
`npm install superdoc@next`. See the
[release notes](https://github.com/superdoc/docx-editor/releases).

## For AI agents

Start with [`llms.txt`](https://docs.superdoc.dev/llms.txt), or copy a
[starter prompt](https://docs.superdoc.dev/#agent-prompts). Agents working in
this repository start with [`AGENTS.md`](AGENTS.md).

<details>
<summary>Documentation, tool discovery, and usage rules</summary>

Machine-readable documentation:

- [`llms.txt`](https://docs.superdoc.dev/llms.txt): index of every documentation page.
- [`llms-full.txt`](https://docs.superdoc.dev/llms-full.txt): all authored guides in one file.
- [`llms-reference.txt`](https://docs.superdoc.dev/llms-reference.txt): the generated Document API reference. Prefer the focused [reference pages](https://docs.superdoc.dev/document-api/reference) when you need only a few operations.
- [Context7](https://context7.com/superdoc/docx-editor): the documentation indexed for retrieval.

Tool discovery:

- The [MCP server](https://docs.superdoc.dev/agents/mcp/connect) serves every tool's JSON Schema, generated from the Document API contract. `getToolCatalog('core')` or `getToolCatalog('legacy')` in `@superdoc/sdk` returns the same data for that preset. Read the advertised schema rather than a copy of it.
- `superdoc discover "<intent>"` and `superdoc describe command <name>` search and explain the CLI contract.
- The [custom-actions skill](https://docs.superdoc.dev/agents/build/skills) teaches Claude Code or Codex to extend the SDK's actions.
- [Agent safety](https://docs.superdoc.dev/agents/operate/safety) covers filesystem boundaries, content sent to model providers, and review.

Usage rules:

- The browser editor needs a browser. Use `@superdoc/sdk` in Node.js API routes.
- The Python SDK installs as `superdoc-sdk` and imports `SuperDocClient` from the `superdoc` module.
- Document modes control editor behavior; your application manages access permissions.
- Record edits as tracked changes with `documentMode: 'suggesting'` in the editor or `changeMode: 'tracked'` for supported headless mutations.
- Find text targets with `query.match` and pass the returned target to the mutation. Do not construct targets from OOXML IDs.
- Inspect mutation receipts and errors before treating an edit as complete.

</details>

## Security

SuperDoc runs inside your infrastructure and does not require document content
to be sent to or stored by SuperDoc. For enterprise reviews, a SOC 2 Type II
report, architecture and data-flow materials, and a software bill of materials
are available. See [Trust & Security](https://docs.superdoc.dev/resources/security).

Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Community and contributing

Ask questions on [Discord](https://discord.com/invite/b9UuaZRyaB), and follow
product updates in the [changelog](https://www.superdoc.dev/changelog).

Community contributions start with an
[issue](https://github.com/superdoc/docx-editor/issues/new/choose). Bug reports,
feature requests, and technical investigations are welcome. Pull requests are
limited to repository collaborators. Read the
[contributing guide](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Contributors

Thank you to everyone who has helped us build and improve the SuperDoc editor.

<img src="./assets/contributors.svg" alt="SuperDoc contributors across V1 and V2" />

## License

AGPLv3 for open source use. A
[commercial license](https://www.superdoc.dev/#pricing) is available for
proprietary deployments. For questions, [contact the SuperDoc team](https://www.superdoc.dev/contact)
or email [q@superdoc.dev](mailto:q@superdoc.dev).
