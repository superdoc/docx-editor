/* global __DOCX_ENGINE_CDN_BASE_URL__, __DOCX_ENGINE_VERSION__ */

// Entry point for the CDN IIFE build (vite.config.cdn.js → superdoc.min.js).
// Exposes the SuperDoc class as `window.SuperDoc` directly (so consumers write
// `new SuperDoc({...})`) while still attaching every named export as a static
// property (`SuperDoc.createTheme`, `SuperDoc.DOCX`, etc.). Pattern borrowed
// from Quill / Chart.js.

import { SuperDoc } from './core/SuperDoc.js';
import * as namespace from './index.js';
import { configureCdnEngineLoader } from './core/v2-integration/cdn-engine-loader.js';

configureCdnEngineLoader({
  engineVersion: typeof __DOCX_ENGINE_VERSION__ === 'string' ? __DOCX_ENGINE_VERSION__ : '',
  buildBaseUrl:
    typeof __DOCX_ENGINE_CDN_BASE_URL__ === 'string' && __DOCX_ENGINE_CDN_BASE_URL__
      ? __DOCX_ENGINE_CDN_BASE_URL__
      : null,
});

// The CDN build ships no substitute pack and does not auto-activate the bundled pack: by default
// the toolbar shows the baseline (one font per CSS generic) and documents render with system fonts.
// The built-in core-symbol face is still requested for the symbol glyphs it covers.
// To load the reviewed substitute pack, add the separate `@superdoc-dev/fonts` script and pass
// its config:
//   <script src="https://cdn.jsdelivr.net/npm/@superdoc-dev/fonts/dist/superdoc-fonts.min.js"></script>
//   new SuperDoc({ ..., fonts: SuperDocFonts.superdocFonts });

for (const [key, value] of Object.entries(namespace)) {
  if (key === 'SuperDoc' || key === 'default') continue;
  if (!Object.prototype.hasOwnProperty.call(SuperDoc, key)) {
    SuperDoc[key] = value;
  }
}

export default SuperDoc;
