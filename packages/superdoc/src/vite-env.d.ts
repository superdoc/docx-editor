declare const __APP_VERSION__: string;
declare const __SUPERDOC_BUILD__: string | undefined;

declare module '*?url' {
  const url: string;
  export default url;
}

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
