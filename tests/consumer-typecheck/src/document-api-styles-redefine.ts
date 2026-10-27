import type { DocumentApi } from 'superdoc';

declare const api: DocumentApi;

const receipt = api.styles.apply(
  {
    target: { scope: 'style', styleId: 'DemoHeading', channel: 'run' },
    patch: { bold: false, italic: null, fontSize: 28, color: { val: 'C00000' }, rtl: true },
  },
  { dryRun: true, expectedRevision: '3' },
);

if (receipt.resolution.scope === 'style') {
  const styleId: string = receipt.resolution.styleId;
  const channel: 'run' = receipt.resolution.channel;
  const xmlPath: 'w:styles/w:style/w:rPr' = receipt.resolution.xmlPath;
  const linkedStyleId: string | undefined = receipt.resolution.linkedStyleId;
  void [styleId, channel, xmlPath, linkedStyleId];
}
if (receipt.success) {
  const changed: boolean = receipt.changed;
  const before = receipt.before['bold'];
  void [changed, before];
} else {
  const code: string = receipt.failure.code;
  void code;
}

api.styles.apply({
  // @ts-expect-error a named style takes only the run channel
  target: { scope: 'style', styleId: 'DemoHeading', channel: 'paragraph' },
  patch: { keepNext: true },
});

// @ts-expect-error null removes only on a named style; docDefaults has nothing to inherit from
api.styles.apply({ target: { scope: 'docDefaults', channel: 'run' }, patch: { bold: null } });
