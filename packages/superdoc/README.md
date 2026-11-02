# superdoc

Browser DOCX editor for reviewing, filling, and editing Word documents. Edits
write back to OOXML without an HTML conversion step. Use the built-in UI or
build your own. For headless or agent workflows, use
[`@superdoc/sdk`](https://www.npmjs.com/package/@superdoc/sdk).

[Live demo](https://www.superdoc.dev) · [Documentation](https://docs.superdoc.dev) · [GitHub](https://github.com/superdoc/docx-editor)

## Install

```bash
npm install superdoc
```

The imports below need a bundler such as Vite or webpack.

## Quick start

```html
<div id="toolbar"></div>
<div id="editor" style="height: 100vh"></div>
```

```js
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx', // URL, File, or Blob; omit for a blank document
  documentMode: 'editing', // 'editing' | 'suggesting' | 'viewing'
  user: { name: 'Ada Lovelace', email: 'ada@superdoc.dev' },
  ui: { toolbar: { container: '#toolbar' } },
  onReady: ({ superdoc }) => {
    console.log('Document ready');
  },
});
```

## Common tasks

### Export the edited DOCX

```js
await superdoc.export({ exportedName: 'sample-edited' }); // downloads sample-edited.docx
const docx = await superdoc.export({ triggerDownload: false }); // returns the file instead
```

Exports keep tracked changes and comments by default. See
[export options](https://docs.superdoc.dev/editor/export-options) to accept
changes or remove comments in the exported copy.

### Record edits as tracked changes

Set `documentMode: 'suggesting'` and a `user` so each change has an author.
Switch modes later with:

```js
superdoc.setDocumentMode('suggesting');
```

### Find and replace text

Use the Document API at `superdoc.activeEditor.doc` after `onReady`. Find a
target with `query.match`, then pass that target to the mutation:

```js
onReady: async ({ superdoc }) => {
  const doc = superdoc.activeEditor?.doc;
  if (!doc) throw new Error('The active document is unavailable.');

  const match = await doc.query.match({
    select: { type: 'text', pattern: 'Amazing' },
    require: 'exactlyOne',
  });
  const item = match.items[0];
  if (!item || item.matchKind !== 'text') throw new Error('Text not found.');

  const receipt = await doc.replace(
    { target: item.target, text: 'Northstar' },
    { changeMode: 'tracked', expectedRevision: match.evaluatedRevision },
  );
  if (!receipt.success) throw new Error(receipt.failure?.message ?? 'Replace failed.');
},
```

### Add a comment

Every edit changes the document revision, so query again after an edit instead
of reusing an earlier `match`:

```js
const match = await doc.query.match({
  select: { type: 'text', pattern: 'Confidential Information' },
  require: 'exactlyOne',
});
const item = match.items[0];
if (!item || item.matchKind !== 'text') throw new Error('Text not found.');

const receipt = await doc.comments.create(
  { target: item.target, text: 'Confirm this definition.' },
  { expectedRevision: match.evaluatedRevision },
);
if (!receipt.success) throw new Error(receipt.failure?.message ?? 'Comment failed.');
```

### Navigate to a bookmark

After the document is ready, navigate by an exact bookmark name:

```js
const result = await superdoc.ui.bookmarks.navigateTo('Terms');
if (!result.success) console.log(result.reason);
```

You can also pass a `BookmarkAddress` from `doc.bookmarks.get()` or `.list()`.
Navigation scrolls to the bookmark and selects its range without changing
content or other collaborators' selections. Pass
`{ block: 'start', behavior: 'auto' }` as a second argument to change
alignment or scrolling. Only body bookmarks are supported; other targets
return `{ success: false, reason: 'target-unresolved' }`. The handle and
address types are exported from `superdoc/ui`.

## Common mistakes

| Wrong | Right |
| --- | --- |
| `documentMode: 'edit'`, `'view'`, or `'suggest'` | `'editing'`, `'viewing'`, or `'suggesting'` |
| Importing `SuperDoc` without `superdoc/style.css` | Import both |
| `modules: { collaboration: { ydoc, provider } }` (V1) | `document: { url, collaboration: { providerType, serverUrl, documentId } }` |
| `Editor`, `superdoc/super-editor`, ProseMirror commands, or plugin keys (V1) | The Document API at `superdoc.activeEditor.doc` |
| Calling the Document API before the document loads | Call it inside `onReady` |
| Building edit targets from DOM positions or OOXML IDs | Use the `target` returned by `doc.query.match` |
| Importing `superdoc` in Node.js | Use `@superdoc/sdk` |

`documentMode` controls editor behavior only. Your application still manages
who may open or change a document.

## Related packages

- [`@superdoc/react`](https://www.npmjs.com/package/@superdoc/react) and [`@superdoc/vue`](https://www.npmjs.com/package/@superdoc/vue): framework wrappers for this editor.
- [`@superdoc/sdk`](https://www.npmjs.com/package/@superdoc/sdk): Node.js SDK for headless editing and agent toolkits. Python and Rust SDKs are listed in the [documentation](https://docs.superdoc.dev).
- [`@superdoc/mcp`](https://www.npmjs.com/package/@superdoc/mcp): MCP server for AI agents.

## Documentation

- [Editor quick start](https://docs.superdoc.dev/editor/quickstart)
- [Configuration](https://docs.superdoc.dev/editor/configuration)
- [Document modes](https://docs.superdoc.dev/editor/document-modes)
- [Export options](https://docs.superdoc.dev/editor/export-options)
- [Package compatibility](https://docs.superdoc.dev/resources/package-compatibility): peer dependency policy and version inspection.
- [`llms.txt`](https://docs.superdoc.dev/llms.txt): machine-readable index of the documentation for coding agents.

## License

AGPL-3.0. [Commercial licenses](https://www.superdoc.dev/#pricing) are
available for proprietary deployments.
