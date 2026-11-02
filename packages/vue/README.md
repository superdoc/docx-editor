# @superdoc/vue

Vue 3 wrapper for the [`superdoc`](https://www.npmjs.com/package/superdoc)
browser DOCX editor. `SuperDocEditor` creates the editor, rebuilds it when key
props change, and destroys it on unmount. Use props and events for common tasks
or a template ref for the core `SuperDoc` instance.

[Live demo](https://www.superdoc.dev) · [Documentation](https://docs.superdoc.dev) · [GitHub](https://github.com/superdoc/docx-editor)

## Install

```sh
npm install @superdoc/vue superdoc@2 vue@^3.5.11
```

`superdoc` is a peer dependency.

## Quick start

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { SuperDocEditor, type DocumentMode } from '@superdoc/vue';
import '@superdoc/vue/style.css';

const file = ref<File | null>(null);
const mode = ref<DocumentMode>('editing');
</script>

<template>
  <SuperDocEditor v-model:document-mode="mode" :document="file">
    <template #loading>Opening document...</template>
    <template #error>Could not open this document.</template>
  </SuperDocEditor>
</template>
```

## Props

| Prop            | When changed | Notes                                                                  |
| --------------- | ------------ | ---------------------------------------------------------------------- |
| `document`      | Rebuilds     | Accepts a URL, `File`, `Blob`, or `null`                               |
| `document-mode` | Updates      | Supports `v-model:document-mode`                                       |
| `role`          | Rebuilds     |                                                                        |
| `user`, `users` | Rebuilds     | Compared by value                                                      |
| `modules`       | Rebuilds     | Compared by reference because it can contain live objects              |
| `ui`            | Rebuilds     | Compared by reference; `{ toolbar: false }` hides the built-in toolbar |
| `ui-binding`    | Updates      | Connects custom UI to the editor lifecycle                             |
| `contained`     | Rebuilds     | Fits and scrolls inside a fixed-height parent                          |
| `config`        | Ignored      | Read at startup; later changes log a warning                           |

Define `modules` and `ui` in `<script setup>` instead of writing object literals in the template. A new object
reference rebuilds the editor and can discard unsaved edits.

Need the core instance? Use a template ref. `getInstance()` returns `null` until the editor is ready.

```vue
<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import { SuperDocEditor, type SuperDocEditorExpose } from '@superdoc/vue';
import '@superdoc/vue/style.css';

const file = ref<File | null>(null);
const editor = useTemplateRef<SuperDocEditorExpose>('editor');

async function exportDocx() {
  return await editor.value?.getInstance()?.export({ triggerDownload: false });
}
</script>

<template>
  <SuperDocEditor ref="editor" :document="file" />
</template>
```

`export({ triggerDownload: false })` returns the edited DOCX as a `Blob` for uploading or storing.
`save()` does not return the DOCX file. Keep the core instance out of deep-reactive state; access it through
`getInstance()` or a Vue `shallowRef`.

## Events and errors

The component emits `@ready`, `@editor-create`, `@editor-destroy`, `@editor-update`, `@transaction`,
`@content-error`, `@exception`, `@zoom-change`, `@viewport-change`, and `@update:document-mode`. Event payload
types come from the core API.

Core does not emit `@transaction` yet. Use `@editor-update` for document changes.

The `#error` slot only handles startup failures. Use `@content-error` for document import errors and
`@exception` for runtime errors.

## Custom UI

To build your own toolbar, set `ui.toolbar` to `false` and use the composables from `superdoc/ui/vue`. Call
`provideSuperDocUI()` in an ancestor of the components that use `useSuperDoc*`, then pass its binding to
`ui-binding`. The editor binds and clears each instance for you.

```vue
<script setup lang="ts">
import { SuperDocEditor } from '@superdoc/vue';
import { provideSuperDocUI } from 'superdoc/ui/vue';
import CustomToolbar from './CustomToolbar.vue';

const uiBinding = provideSuperDocUI();
const ui = { toolbar: false };
</script>

<template>
  <SuperDocEditor :ui="ui" :ui-binding="uiBinding" />
  <CustomToolbar />
</template>
```

```vue
<script setup lang="ts">
import { useSuperDocCommand } from 'superdoc/ui/vue';

const { enabled, active, executeAsync } = useSuperDocCommand('bold');
</script>

<template>
  <button :disabled="!enabled" :aria-pressed="active" @click="executeAsync()">Bold</button>
</template>
```

See the [custom UI guide](https://docs.superdoc.dev/editor/custom-ui/overview) for the controller and command APIs.

## Server-side rendering

The component renders its containers on the server and loads SuperDoc after mounting in the browser. Nuxt
hydration and navigation teardown have not been tested yet, so some apps may still need `ssr: false`.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Importing `SuperDocEditor` without `@superdoc/vue/style.css` | Import both |
| Writing `modules` or `ui` as object literals in the template | Define them once in `<script setup>` |
| Storing the instance in `ref()` or `reactive()` | Use `getInstance()` or a `shallowRef` |
| Calling instance methods before `@ready` | Wait for `@ready`, or check `getInstance()` for `null` |
| Expecting `save()` to return the DOCX | Use `export({ triggerDownload: false })` |
| Listening to `@transaction` for changes | Use `@editor-update` |
| `document-mode="edit"`, `"view"`, or `"suggest"` | `"editing"`, `"viewing"`, or `"suggesting"` |

## Requirements

- Vue `^3.5.11`
- `superdoc` `>=2.0.0-0 <3`

## Related packages

- [`superdoc`](https://www.npmjs.com/package/superdoc): the editor this package wraps. Its README covers the Document API, recipes, and V1 migration mistakes.
- [`@superdoc/react`](https://www.npmjs.com/package/@superdoc/react): the same editor for React.
- [`@superdoc/fonts`](https://www.npmjs.com/package/@superdoc/fonts): optional metric-compatible font substitutes.
- [`@superdoc/sdk`](https://www.npmjs.com/package/@superdoc/sdk): Node.js SDK for headless editing and agent toolkits.

## Documentation

- [Editor quick start](https://docs.superdoc.dev/editor/quickstart)
- [Configuration](https://docs.superdoc.dev/editor/configuration)
- [Document modes](https://docs.superdoc.dev/editor/document-modes)
- [Lifecycle and events](https://docs.superdoc.dev/editor/lifecycle-and-events)
- [Custom UI](https://docs.superdoc.dev/editor/custom-ui/overview)
- [Package compatibility](https://docs.superdoc.dev/resources/package-compatibility): peer dependency policy and version inspection.
- [`llms.txt`](https://docs.superdoc.dev/llms.txt): machine-readable index of the documentation for coding agents.

## License

AGPL-3.0. [Commercial licenses](https://www.superdoc.dev/#pricing) are
available for proprietary deployments.
