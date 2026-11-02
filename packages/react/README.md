# @superdoc/react

React wrapper for the [`superdoc`](https://www.npmjs.com/package/superdoc)
browser DOCX editor. `SuperDocEditor` creates the editor, rebuilds it when key
props change, and destroys it on unmount.

[Live demo](https://www.superdoc.dev) · [Documentation](https://docs.superdoc.dev/editor/frameworks/react) · [GitHub](https://github.com/superdoc/docx-editor)

## Install

```bash
npm install @superdoc/react superdoc react react-dom
```

`superdoc` is a peer dependency. React 16.8 or later is required.

## Quick start

```tsx
import { SuperDocEditor } from '@superdoc/react';
import '@superdoc/react/style.css';

export function Editor() {
  return (
    <SuperDocEditor
      document="/sample.docx" // URL, File, or Blob; omit for a blank document
      documentMode="editing" // 'editing' | 'suggesting' | 'viewing'
      user={{ name: 'Jordan Lee', email: 'jordan@example.com' }}
      onReady={({ superdoc }) => console.log('Document ready')}
    />
  );
}
```

Every `superdoc` configuration option is also a prop, except `selector`: the
component creates its own container.

## Props

| Prop | When changed | Notes |
| --- | --- | --- |
| `document` | Rebuilds | URL, `File`, or `Blob`. |
| `documentMode` | Updates | Applied without a rebuild. Defaults to `'editing'`. |
| `user` | Updates | Compared by value. |
| `users`, `ui` | Rebuilds | Compared by value, so inline literals are safe. |
| `modules` | Rebuilds | Compared by reference, because it can hold live objects such as a collaboration provider. |
| `role`, `contained` | Rebuilds | `contained` fits and scrolls inside a fixed-height parent. |
| `renderLoading` | Renders | Your own content while the document opens. |
| `id` | Rebuilds | Id of the editor container. The toolbar container gets `<id>-toolbar`. |
| `hideToolbar` | Rebuilds | Older spelling of `ui={{ toolbar: false }}`. |
| `className`, `style` | Renders | Applied to the wrapper element. |
| Other `superdoc` options | Ignored | Read at startup. Change them through the instance. |

Define `modules` outside the render function or with `useMemo`. A new object
rebuilds the editor and can discard unsaved edits.

The component loads `superdoc` after it mounts, so it can render in
server-rendered apps; the editor itself runs only in the browser.

## Common tasks

### Get the SuperDoc instance

Use a ref. `getInstance()` returns `null` until the editor is created, and the
document may still be loading after that. Wait for `onReady` before calling
`export()` or other document methods.

```tsx
import { useRef } from 'react';
import { SuperDocEditor, type SuperDocRef } from '@superdoc/react';
import '@superdoc/react/style.css';

export function Editor() {
  const editorRef = useRef<SuperDocRef>(null);

  async function exportDocx() {
    await editorRef.current?.getInstance()?.export({ exportType: ['docx'], exportedName: 'sample-edited' });
  }

  return (
    <>
      <button onClick={() => void exportDocx()} type="button">Export DOCX</button>
      <SuperDocEditor ref={editorRef} document="/sample.docx" />
    </>
  );
}
```

### Save the DOCX to your server

`export({ triggerDownload: false })` returns the edited DOCX as a `Blob`:

```tsx
const superdoc = editorRef.current?.getInstance();
const docx = await superdoc?.export({ exportType: ['docx'], triggerDownload: false });
if (docx instanceof Blob) {
  await fetch('/api/documents/sample', { method: 'PUT', body: docx });
}
```

To track unsaved changes, see
[load and save documents](https://docs.superdoc.dev/editor/load-and-save-documents).

### Switch document modes

Keep the mode in state. Changing it updates the editor without a rebuild.

```tsx
const [documentMode, setDocumentMode] = useState<DocumentMode>('suggesting');

<SuperDocEditor document="/sample.docx" documentMode={documentMode} user={user} />
```

Set a `user` in `'suggesting'` mode so each tracked change has an author.

### Configure the toolbar

```tsx
import type { ToolbarConfig } from '@superdoc/react';

const toolbar = {
  items: {
    left: ['undo', 'redo'],
    center: ['bold', 'italic'],
    right: ['zoom'],
  },
  responsiveTo: 'container',
} satisfies ToolbarConfig;

<SuperDocEditor document="/sample.docx" ui={{ toolbar }} />
```

Set `ui={{ toolbar: false }}` to hide the toolbar and build your own with the
[custom UI](https://docs.superdoc.dev/editor/custom-ui/overview) APIs.

### Handle errors

If the editor cannot start, the component shows a short failure message. Use
`onContentError` for document import errors and `onException` for runtime
errors.

```tsx
<SuperDocEditor
  document="/sample.docx"
  onContentError={({ error }) => console.error('Could not open the document.', error)}
  onException={({ error }) => console.error('SuperDoc error.', error)}
/>
```

## Common mistakes

| Wrong | Right |
| --- | --- |
| Importing `SuperDocEditor` without `@superdoc/react/style.css` | Import both |
| Passing `selector` | The component creates its own container |
| Creating `modules` inline in JSX | Define it once or wrap it in `useMemo` |
| `documentMode="edit"`, `"view"`, or `"suggest"` | `"editing"`, `"viewing"`, or `"suggesting"` |
| Treating a non-null `getInstance()` as ready | Wait for `onReady`. The instance exists before the document loads |
| Storing the instance in React state | Use the ref's `getInstance()` |

## Related packages

- [`superdoc`](https://www.npmjs.com/package/superdoc): the editor this package wraps. Its README covers the Document API, recipes, and V1 migration mistakes.
- [`@superdoc/vue`](https://www.npmjs.com/package/@superdoc/vue): the same editor for Vue 3.
- [`@superdoc/fonts`](https://www.npmjs.com/package/@superdoc/fonts): optional metric-compatible font substitutes.
- [`@superdoc/sdk`](https://www.npmjs.com/package/@superdoc/sdk): Node.js SDK for headless editing and agent toolkits.

## Documentation

- [React guide](https://docs.superdoc.dev/editor/frameworks/react)
- [Configuration](https://docs.superdoc.dev/editor/configuration)
- [Document modes](https://docs.superdoc.dev/editor/document-modes)
- [Lifecycle and events](https://docs.superdoc.dev/editor/lifecycle-and-events)
- [Package compatibility](https://docs.superdoc.dev/resources/package-compatibility): peer dependency policy and version inspection.
- [`llms.txt`](https://docs.superdoc.dev/llms.txt): machine-readable index of the documentation for coding agents.

## License

AGPL-3.0. [Commercial licenses](https://www.superdoc.dev/#pricing) are
available for proprietary deployments.
