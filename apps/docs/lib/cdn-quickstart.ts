import { runtimeCdnBaseUrl as packageUrl } from './editor-runtime-url';
import { siteOrigin } from './site-url';

export const cdnQuickstartHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="${packageUrl}/superdoc.min.css" />
    <script src="${packageUrl}/superdoc.min.js"></script>
  </head>
  <body style="margin: 0">
    <div id="editor" style="height: 100vh"></div>
    <script>
      const superdoc = new SuperDoc({
        selector: '#editor',
        document: '${siteOrigin}/fixtures/getting-started.docx',
      });
    </script>
  </body>
</html>`;

export function renderCdnQuickstartMarkdown() {
  return `\`\`\`html title="index.html"\n${cdnQuickstartHtml}\n\`\`\`\n`;
}
