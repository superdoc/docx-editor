# @superdoc/fonts

Optional font substitutes for the [`superdoc`](https://www.npmjs.com/package/superdoc)
DOCX editor. Documents that use Word fonts your users may not have, such as
Calibri, Cambria, or Times New Roman, lay out closer to Word with
metric-compatible substitutes like Carlito, Caladea, and Liberation Serif. The
package contains WOFF2 assets and their license texts.

[Documentation](https://docs.superdoc.dev/editor/fonts) · [GitHub](https://github.com/superdoc/docx-editor)

## Install

```sh
npm install superdoc @superdoc/fonts
```

## Quick start

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

With React, pass the same value as a prop:
`<SuperDocEditor document="/sample.docx" fonts={superdocFonts} />`.

Your bundler resolves the package's font URLs; no manual copy step is needed.
SuperDoc loads only the faces the document uses. Allow their served origin in
your Content Security Policy, and configure CORS when you serve them from
another origin.

## Common tasks

### Load only some substitutes

Use Word family names. An unknown name throws instead of being ignored.

```js
import { createSuperDocFonts } from '@superdoc/fonts';

const fonts = createSuperDocFonts({ include: ['Calibri', 'Cambria'] });
// or: createSuperDocFonts({ exclude: ['Cooper Black', 'Brush Script MT'] })
```

`BUNDLED_FAMILY_NAMES` lists every family the pack covers.

### Check how fonts resolved

```js
const report = superdoc.fonts.getReport();
```

The report shows which document fonts were substituted or missing. Compare
line and page breaks against Word for the documents you care about.

### Use your own licensed fonts

The pack supplies substitutes, not Microsoft font files. When you need the
originals and their license permits web delivery, register them through
`fonts.families`. See
[host a proprietary font](https://docs.superdoc.dev/editor/fonts).

### Load without a bundler

Load the version-pinned `dist/superdoc-fonts.min.js` browser build and pass
`SuperDocFonts.superdocFonts`. When self-hosting, keep the package's `assets/`
directory beside `dist/` so the relative font URLs resolve.

## Common mistakes

| Wrong | Right |
| --- | --- |
| Expecting identical Word rendering | Substitutes match metrics, not every glyph. Check the font report |
| Copying font files into `public/` by hand | Let your bundler resolve the package's URLs |
| Blocking the font origin in your CSP | Allow the origin that serves the fonts |
| Loading both `@superdoc-dev/fonts` and `@superdoc/fonts` | Use only `@superdoc/fonts` |
| Expecting fonts like Aptos to be covered | The pack does not cover every family. Host licensed files for the rest |

## Migrating from @superdoc-dev/fonts

```sh
npm uninstall @superdoc-dev/fonts
npm install @superdoc/fonts
```

Change imports from `@superdoc-dev/fonts` to `@superdoc/fonts`. The
`superdocFonts`, `createSuperDocFonts`, and `resolveBundledFontAssetUrl`
exports work the same way. Update CDN or self-hosted paths too. New stable
releases keep publishing the old name as a deprecated mirror, so existing
installations keep working.

For prereleases, install `@superdoc/fonts@next`.

## Related packages

- [`superdoc`](https://www.npmjs.com/package/superdoc): the browser DOCX editor these fonts are for.
- [`@superdoc/react`](https://www.npmjs.com/package/@superdoc/react): accepts the same value as its `fonts` prop.
- [`@superdoc/vue`](https://www.npmjs.com/package/@superdoc/vue): pass it in the `config` prop as `{ fonts: superdocFonts }`.

## Documentation

- [Fonts guide](https://docs.superdoc.dev/editor/fonts)
- [Package compatibility](https://docs.superdoc.dev/resources/package-compatibility)
- [`llms.txt`](https://docs.superdoc.dev/llms.txt): machine-readable index of the documentation for coding agents.

## License

See [`assets/LICENSES.md`](https://unpkg.com/@superdoc/fonts/assets/LICENSES.md),
which ships in the package. The bundled fonts keep their own licenses: SIL Open
Font License, Apache 2.0, AGPL 3.0 with a PostScript/PDF font exception, GPL
2.0 with a font exception, and GUST. The license texts sit beside the font
files.

Three families are copyleft: C059 (substitute for Century and Century
Schoolbook) and URW Gothic (Century Gothic) under AGPL 3.0, and Liberation Sans
Narrow (Arial Narrow) under GPL 2.0. Their font exceptions mean documents that
use them are not covered by those licenses. Redistributing the font files
carries the license's source obligations. To leave them out:

```js
createSuperDocFonts({ exclude: ['Century', 'Century Schoolbook', 'Century Gothic', 'Arial Narrow'] });
```
