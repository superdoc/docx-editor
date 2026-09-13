import {
  createSuperDocClient,
  type ReplaceFileOptions,
  type ReplaceFileResult,
  type ReplaceFileSource,
} from '../../../packages/sdk/langs/node/dist/index.js';

declare const bytes: Uint8Array;
declare const buffer: ArrayBuffer;
declare const path: string;

const sources: ReplaceFileSource[] = [path, bytes, buffer];
const options: ReplaceFileOptions = { timeoutMs: 30_000 };
const client = createSuperDocClient();
const document = await client.open({ doc: path });

for (const source of sources) {
  const result: ReplaceFileResult = await document.replaceFile(source, options);
  result.document.byteLength satisfies number;
  result.document.revision satisfies string;
}

// @ts-expect-error replaceFile is unconditional and does not accept revision preconditions.
await document.replaceFile(path, { expectedRevision: 1 });

await document.close();
await client.dispose();
