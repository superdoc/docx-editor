import {
  createSuperDocClient,
  type InitialRoomState,
  type ServerReceipt,
  type StorageCommit,
  type WaitForServerReceiptOptions,
} from '../../../packages/sdk/langs/node/dist/index.js';

const client = createSuperDocClient();
const document = await client.open({ doc: 'fixture.docx' });
const options: WaitForServerReceiptOptions = { timeoutMs: 5_000 };
const received: ServerReceipt = await document.collaboration.waitForServerReceipt(options);
const initial: InitialRoomState = await document.collaboration.waitForInitialSync(options);
const committed: StorageCommit = await document.collaboration.waitForStorageCommit(options);
received.received satisfies true;
initial.ready satisfies true;
committed.committed satisfies true;
committed.commitId satisfies string;
await document.close();
await client.dispose();
