import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { DocumentWorker, ResultDeliveryError, runBatch, type BatchJob } from './batch.ts';
import type { DocOpenOptions, DocOpenParams } from '@superdoc/sdk';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { resolve, promise };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-batch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events: string[] = [];
  const sessions: Array<string | undefined> = [];
  let clients = 0;
  let openFailure: unknown;
  let saveFailures = 0;
  let closeFailures = 0;
  let disposeFailures = 0;
  let liveDocuments = 0;
  let maxDocuments = 0;
  const documents: Array<{ text: string }> = [];
  const createClient = () => {
    const id = ++clients;
    events.push(`client:${id}`);
    return {
      async open(params?: DocOpenParams) {
        events.push(`open:${id}`);
        sessions.push(params?.sessionId);
        if (openFailure) throw openFailure;
        maxDocuments = Math.max(maxDocuments, ++liveDocuments);
        const document = {
          text: `document:${documents.length}`,
          async save({ out }: { out: string }) {
            events.push(`save:${id}:${path.basename(out)}`);
            if (saveFailures-- > 0) throw new Error('save failed');
            await writeFile(out, document.text);
            return { saved: true };
          },
          async close() {
            events.push(`close:${id}`);
            if (closeFailures-- > 0) throw new Error('close failed');
            liveDocuments--;
            return { closed: true };
          },
        };
        documents.push(document);
        return document;
      },
      async dispose() {
        events.push(`dispose:${id}`);
        if (disposeFailures-- > 0) throw new Error('dispose failed');
      },
    };
  };
  const job = (id: number): BatchJob => ({ id: String(id), input: path.join(directory, 'input.docx'), outputDirectory: path.join(directory, String(id)) });
  return {
    directory, events, sessions, documents, job, createClient,
    async *jobs(count: number) { for (let i = 0; i < count; i++) yield job(i); },
    failOpen(error: unknown) { openFailure = error; },
    failSaves(count: number) { saveFailures = count; },
    failCloses(count: number) { closeFailures = count; },
    failDisposals(count: number) { disposeFailures = count; },
    counts: () => ({ clients, liveDocuments, maxDocuments }),
  };
}

test('bounds active documents and source pulls, and waits for durable result delivery before the next job', async (t) => {
  const f = await fixture(t);
  const work = deferred(), entered = deferred(), delivery = deferred(), delivering = deferred();
  let pulled = 0, active = 0;
  async function* jobs() { for await (const job of f.jobs(6)) { pulled++; yield job; } }
  const workers = Array.from({ length: 2 }, () => new DocumentWorker(f.createClient, async () => {
    if (++active === 2) entered.resolve();
    await work.promise;
  }));
  const running = runBatch(jobs(), workers, async () => { delivering.resolve(); await delivery.promise; });
  await entered.promise;
  assert.equal(pulled, 2);
  assert.equal(f.counts().maxDocuments, 2);
  work.resolve();
  await delivering.promise;
  assert.equal(pulled, 2);
  delivery.resolve();
  const summary = await running;
  assert.equal(summary.completed, 6);
  assert.equal(summary.exhausted, true);
  assert.equal(f.counts().maxDocuments, 2);
  assert.equal(f.counts().clients, 2);
  await Promise.all(workers.map((worker) => worker.dispose()));
});

test('recycles only after confirmed save and close and leaves no document on the old host', async (t) => {
  const f = await fixture(t);
  const worker = new DocumentWorker(f.createClient, async (document) => { document.text += ':edited'; }, 2);
  await runBatch(f.jobs(5), [worker], async (result) => {
    assert.equal(result.status, 'saved');
    assert.match(await readFile(result.savedTo!, 'utf8'), /:edited$/);
  });
  assert.equal(f.counts().clients, 3);
  assert.equal(f.counts().liveDocuments, 0);
  assert.ok(f.events.indexOf('dispose:1') > f.events.lastIndexOf('close:1'));
  assert.ok(f.events.indexOf('client:2') > f.events.indexOf('dispose:1'));
  await worker.dispose();
  await worker.dispose();
  assert.equal(f.events.filter((event) => event === 'dispose:3').length, 1);
});

test('cancels before admission without opening and saves active edits to recovery at a completed boundary', async (t) => {
  const f = await fixture(t);
  const aborted = AbortSignal.abort();
  const worker = new DocumentWorker(f.createClient, async () => {});
  assert.equal((await worker.run(f.job(0), aborted)).status, 'cancelled');
  assert.equal(f.counts().clients, 0);
  const signal = new AbortController();
  const active = new DocumentWorker(f.createClient, async (document, _job, checkpoint) => {
    document.text = 'retained mutation';
    signal.abort();
    checkpoint();
    assert.fail('work continued after cancellation');
  });
  const result = await active.run(f.job(1), signal.signal);
  assert.equal(result.status, 'cancelled');
  assert.match(result.savedTo!, /recovery.docx$/);
  assert.equal(await readFile(result.savedTo!, 'utf8'), 'retained mutation');
  assert.equal(f.counts().liveDocuments, 0);
  await active.dispose();
});

test('double save failure retains the dirty handle and slot until explicit successful recovery', async (t) => {
  const f = await fixture(t);
  f.failSaves(2);
  const worker = new DocumentWorker(f.createClient, async (document) => { document.text = 'must survive'; });
  assert.equal((await worker.run(f.job(0))).status, 'quarantined');
  await assert.rejects(worker.run(f.job(1)), /quarantined/);
  await assert.rejects(worker.dispose(), /quarantined/);
  await assert.rejects(worker.recoverAfterSettled(), /save failed/);
  assert.equal(f.counts().liveDocuments, 1);
  assert.equal(f.events.some((event) => event.startsWith('close:') || event.startsWith('dispose:')), false);
  assert.equal(worker.quarantine?.document, f.documents[0]);
  const output = await worker.recoverAfterSettled();
  assert.equal(await readFile(output!, 'utf8'), 'must survive');
  assert.equal(worker.available, true);
  await worker.dispose();
});

test('unknown mutation errors are quarantined without automatic save, retry or disposal', async (t) => {
  const f = await fixture(t);
  const worker = new DocumentWorker(f.createClient, async () => { throw new Error('RPC timeout: outcome unknown'); });
  const summary = await runBatch(f.jobs(5), [worker], async (result) => { assert.equal(result.status, 'quarantined'); });
  assert.deepEqual(summary.counts, { saved: 0, cancelled: 0, rejected: 0, quarantined: 1 });
  assert.equal(summary.exhausted, false);
  assert.deepEqual(f.events, ['client:1', 'open:1']);
  await assert.rejects(worker.dispose());
});

test('retains uncertain open and close ownership; a known file rejection can reuse its clean host', async (t) => {
  const f = await fixture(t);
  const worker = new DocumentWorker(f.createClient, async () => {});
  f.failOpen(Object.assign(new Error('missing input'), { code: 'FILE_READ_ERROR' }));
  assert.equal((await worker.run(f.job(0))).status, 'rejected');
  f.failOpen(undefined);
  assert.equal((await worker.run(f.job(1))).status, 'saved');
  assert.equal(f.counts().clients, 1);
  f.failOpen(new Error('RPC timeout'));
  assert.equal((await worker.run(f.job(2))).status, 'quarantined');
  assert.equal(worker.quarantine?.sessionId, f.sessions.at(-1));
  assert.ok(worker.quarantine?.sessionId);
  await assert.rejects(worker.recoverAfterSettled(), /Open outcome/);
  f.failOpen(undefined);
  f.failCloses(1);
  const other = new DocumentWorker(f.createClient, async () => {}, 1);
  assert.equal((await other.run(f.job(3))).status, 'quarantined');
  assert.equal(other.quarantine?.sessionId, f.sessions.at(-1));
  assert.notEqual(other.quarantine?.sessionId, worker.quarantine?.sessionId);
  await assert.rejects(other.recoverAfterSettled(), /Close outcome/);
  assert.equal(f.events.some((event) => event.startsWith('dispose:')), false);
});

test('client construction failure rejects before an RPC and leaves the worker reusable', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  const worker = new DocumentWorker(() => {
    if (++attempts === 1) throw new Error('SDK host configuration is invalid');
    return f.createClient();
  }, async () => {});
  assert.equal((await worker.run(f.job(0))).status, 'rejected');
  assert.equal(worker.available, true);
  assert.equal(worker.quarantine, undefined);
  assert.deepEqual(f.events, []);
  assert.equal((await worker.run(f.job(1))).status, 'saved');
  assert.equal(attempts, 2);
  await worker.dispose();
});

test('failed clean disposal keeps its capacity slot and must succeed before a replacement client', async (t) => {
  const f = await fixture(t);
  const worker = new DocumentWorker(f.createClient, async () => {});
  await worker.run(f.job(0));
  f.failDisposals(1);
  await assert.rejects(worker.dispose(), /dispose failed/);
  assert.equal(worker.quarantine?.phase, 'recycle');
  await assert.rejects(worker.run(f.job(1)));
  await worker.recoverAfterSettled();
  await worker.run(f.job(1));
  assert.equal(f.counts().clients, 2);
  assert.equal(f.events.filter((event) => event === 'dispose:1').length, 2);
  await worker.dispose();
});

test('an existing output directory is rejected before opening and cannot overwrite prior documents', async (t) => {
  const f = await fixture(t);
  const job = f.job(0);
  await mkdir(job.outputDirectory);
  await writeFile(path.join(job.outputDirectory, 'document.docx'), 'previous export');
  const worker = new DocumentWorker(f.createClient, async () => {});
  assert.equal((await worker.run(job)).status, 'rejected');
  assert.equal(f.counts().clients, 0);
  assert.equal(await readFile(path.join(job.outputDirectory, 'document.docx'), 'utf8'), 'previous export');
});

test('result-delivery failures retain the undelivered receipt and drain other active work', async (t) => {
  const f = await fixture(t);
  const workers = Array.from({ length: 2 }, () => new DocumentWorker(f.createClient, async () => {}));
  await assert.rejects(runBatch(f.jobs(100), workers, async () => { throw new Error('receipt store unavailable'); }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.every((failure) => failure instanceof ResultDeliveryError));
    assert.ok(error.errors.every((failure: ResultDeliveryError) => failure.result.job.id));
    return true;
  });
  assert.equal(f.counts().liveDocuments, 0);
  assert.ok(f.documents.length <= 2);
  await Promise.all(workers.map((worker) => worker.dispose()));
});

test('source errors close the iterator after active work drains, and concurrent reuse is rejected', async (t) => {
  const f = await fixture(t);
  let returned = false;
  async function* jobs() { try { yield f.job(0); throw new Error('input source failed'); } finally { returned = true; } }
  const worker = new DocumentWorker(f.createClient, async () => {});
  await assert.rejects(runBatch(jobs(), [worker], async () => {}), /Batch stopped/);
  assert.equal(returned, true);
  const entered = deferred(), release = deferred();
  const concurrent = new DocumentWorker(f.createClient, async () => { entered.resolve(); await release.promise; });
  const running = concurrent.run(f.job(1));
  await entered.promise;
  await assert.rejects(concurrent.run(f.job(2)), /busy/);
  await assert.rejects(concurrent.dispose(), /active/);
  release.resolve();
  await running;
  await concurrent.dispose();
  await worker.dispose();
});

test('snapshots per-open collaboration credentials before asynchronous admission and isolates each job', async (t) => {
  const f = await fixture(t);
  const observed: Array<{ params: DocOpenParams; options?: DocOpenOptions }> = [];
  const client = f.createClient();
  const worker = new DocumentWorker(() => ({
    ...client,
    async open(params: DocOpenParams, options?: DocOpenOptions) { observed.push({ params, options }); return client.open(); },
  }), async () => {});
  const options = { collaborationAuth: { type: 'token' as const, token: 'first-job-token' } };
  const collaboration = { providerType: 'hocuspocus' as const, url: 'ws://first', documentId: 'first' };
  const running = worker.run({ ...f.job(0), collaboration, openOptions: options });
  options.collaborationAuth.token = 'later-token';
  collaboration.documentId = 'later-room';
  await running;
  await worker.run(f.job(1));
  const profile = observed[0].params.collaboration;
  assert.ok(profile && 'documentId' in profile);
  assert.equal(profile.documentId, 'first');
  assert.equal(observed[0].options?.collaborationAuth?.token, 'first-job-token');
  assert.equal(observed[1].params.collaboration, undefined);
  assert.equal(observed[1].options, undefined);
  assert.notEqual(observed[0].params.sessionId, observed[1].params.sessionId);
  await worker.dispose();
});
