# superdoc

Browser editor for opening, editing, and rendering DOCX files.

## Install

```bash
npm install superdoc
```

## Quick start

```js
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

const editor = new SuperDoc({
  selector: '#editor',
  document: '/document.docx',
});
```

See the [editor quick start](https://docs.superdoc.dev/editor/quickstart) for a complete example and the
[SuperDoc documentation](https://docs.superdoc.dev) for configuration and APIs.

See [package compatibility](https://docs.superdoc.dev/resources/package-compatibility) for the peer dependency policy and current-version inspection commands.

## License

AGPL-3.0. Commercial licenses are available from [SuperDoc](https://www.superdoc.dev).
