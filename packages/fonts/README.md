# @superdoc/fonts

Optional font substitutes for SuperDoc, including Carlito for Calibri, Caladea for Cambria, and Liberation Serif for Times New Roman. The package contains WOFF2 assets and their license texts.

```sh
npm install superdoc @superdoc/fonts
```

```js
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { superdocFonts } from '@superdoc/fonts';

const superdoc = new SuperDoc({
  selector: '#editor',
  document: '/sample.docx',
  fonts: superdocFonts,
});
```

Create an element with `id="editor"` and serve your document at `/sample.docx`. Your bundler resolves the package's font URLs; no manual font copy step is needed. SuperDoc loads the faces needed by the document. Allow their served origin in your Content Security Policy and configure CORS when serving them from another origin.

For plain script integrations, load the version-pinned `dist/superdoc-fonts.min.js` browser build and pass `SuperDocFonts.superdocFonts`. Keep the package's `assets/` directory beside `dist/` when self-hosting it.

The pack supplies substitutes, not proprietary Microsoft font files, and does not cover every family. It does not guarantee identical Word rendering. Inspect `superdoc.fonts.getReport()` and compare line and page breaks for your documents. Use licensed original files through `fonts.families` when needed.

## Migrating from @superdoc-dev/fonts

```sh
npm uninstall @superdoc-dev/fonts
npm install @superdoc/fonts
```

For prereleases, install `@superdoc/fonts@next`.

Change imports from `@superdoc-dev/fonts` to `@superdoc/fonts`. The `superdocFonts`, `createSuperDocFonts`, and `resolveBundledFontAssetUrl` exports retain the same usage. Update CDN or self-hosted paths too, and avoid loading both packages. New stable releases retain the old name as a deprecated compatibility mirror; existing installations keep working.
