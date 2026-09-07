import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DocOpenOptions, DocOpenParams } from '@superdoc/sdk';

export interface BatchJob {
  readonly id: string;
  readonly input: string;
  readonly outputDirectory: string;
  readonly collaboration?: DocOpenParams['collaboration'];
  readonly openOptions?: DocOpenOptions;
}

export interface BatchDocument {
  save(params: { out: string; force: true }): Promise<{ saved: boolean }>;
  close(): Promise<{ closed: boolean }>;
}

export interface BatchClient<Document extends BatchDocument> {
  open(params: DocOpenParams, options?: DocOpenOptions): Promise<Document>;
  dispose(): Promise<void>;
}

export interface JobResult {
  job: BatchJob;
  status: 'saved' | 'cancelled' | 'rejected' | 'quarantined';
  savedTo?: string;
  error?: unknown;
}

type Phase = 'create' | 'open' | 'work' | 'save' | 'close' | 'recycle';

export class DocumentWorker<Document extends BatchDocument> {
  private state: 'idle' | 'running' | 'quarantined' | 'disposed' = 'idle';
  private client?: BatchClient<Document>;
  private document?: Document;
  private sessionId?: string;
  private job?: BatchJob;
  private phase: Phase = 'open';
  private completed = 0;
  private failure?: unknown;

  constructor(
    private readonly createClient: () => BatchClient<Document>,
    private readonly work: (document: Document, job: BatchJob, checkpoint: () => void) => Promise<void>,
    private readonly recycleAfter = 10,
  ) {
    if (!Number.isSafeInteger(recycleAfter) || recycleAfter < 1) throw new Error('recycleAfter must be a positive integer.');
  }

  get available() { return this.state === 'idle'; }

  // Failed calls can have unknown outcomes. Keep both the slot and its handles
  // available to the application; never replace this client to free capacity.
  get quarantine() {
    return this.state === 'quarantined'
      ? { job: this.job, phase: this.phase, error: this.failure, client: this.client, document: this.document, sessionId: this.sessionId }
      : undefined;
  }

  async run(job: BatchJob, signal?: AbortSignal): Promise<JobResult> {
    if (!this.available) throw new Error('Worker is busy, quarantined or disposed.');
    if (signal?.aborted) return { job, status: 'cancelled' };
    this.state = 'running';
    try {
      if (!job.id.trim() || !job.input.trim() || !job.outputDirectory.trim()) throw new Error('Job paths and id are required.');
      this.job = Object.freeze({ ...job, input: path.resolve(job.input), outputDirectory: path.resolve(job.outputDirectory),
        collaboration: structuredClone(job.collaboration), openOptions: structuredClone(job.openOptions) });
      job = this.job;
      // Exclusive directory creation prevents retries or two jobs from
      // overwriting another job's saved or recovery document.
      await mkdir(job.outputDirectory);
    } catch (error) {
      this.job = undefined;
      this.state = 'idle';
      return { job, status: 'rejected', error };
    }

    const cancellation = new Error('Batch cancelled at a completed RPC boundary.');
    const checkpoint = () => { if (signal?.aborted) throw cancellation; };
    let cancelled = false;
    try {
      checkpoint();
      this.phase = 'create';
      this.client ??= this.createClient();
      this.sessionId = randomUUID();
      this.phase = 'open';
      this.document = await this.client.open({ doc: job.input, sessionId: this.sessionId, collaboration: job.collaboration }, job.openOptions);
      this.phase = 'work';
      checkpoint();
      await this.work(this.document, job, checkpoint);
      checkpoint();
    } catch (error) {
      if (error !== cancellation) {
        // FILE_READ_ERROR rejects before a document is created. Every other
        // failed open remains owned until its outcome has been reconciled.
        if (this.phase === 'create' || (this.phase === 'open' && this.client && error && typeof error === 'object' && 'code' in error && error.code === 'FILE_READ_ERROR')) {
          this.job = undefined;
          this.sessionId = undefined;
          this.state = 'idle';
          return { job, status: 'rejected', error };
        }
        return this.quarantineResult(job, error);
      }
      cancelled = true;
    }

    if (!this.document) {
      this.job = undefined;
      this.state = 'idle';
      return { job, status: 'cancelled' };
    }
    const savedTo = path.join(job.outputDirectory, cancelled ? 'recovery.docx' : 'document.docx');
    try {
      await this.saveAndClose(savedTo);
      await this.recycleIfDue();
      this.job = undefined;
      this.state = 'idle';
      return { job, status: cancelled || signal?.aborted ? 'cancelled' : 'saved', savedTo };
    } catch (error) {
      return this.quarantineResult(job, error);
    }
  }

  private quarantineResult(job: BatchJob, error: unknown): JobResult {
    this.state = 'quarantined';
    this.failure = error;
    return { job, status: 'quarantined', error };
  }

  private async saveAndClose(out: string) {
    this.phase = 'save';
    if (!(await this.document!.save({ out, force: true })).saved) throw new Error('Save did not confirm success.');
    this.phase = 'close';
    if (!(await this.document!.close()).closed) throw new Error('Close did not confirm success.');
    this.document = undefined;
    this.sessionId = undefined;
    this.completed++;
  }

  private async recycleIfDue() {
    if (this.completed < this.recycleAfter) return;
    await this.disposeClient();
  }

  private async disposeClient() {
    this.phase = 'recycle';
    await this.client?.dispose();
    this.client = undefined;
    this.completed = 0;
  }

  // Call only after establishing that prior RPCs have settled and transport is
  // healthy. A timeout is not that evidence. No failed mutation is replayed.
  async recoverAfterSettled(): Promise<string | undefined> {
    if (this.state !== 'quarantined') throw new Error('Worker is not quarantined.');
    if (!this.document && this.phase !== 'recycle') throw new Error('Open outcome is unknown; reconcile the retained client before recovery.');
    if (this.phase === 'close') throw new Error('Close outcome is unknown; reconcile the saved output and retained handle first.');
    this.state = 'running';
    const savedTo = this.document ? path.join(this.job!.outputDirectory, 'recovery.docx') : undefined;
    try {
      if (savedTo) {
        await this.saveAndClose(savedTo);
        await this.recycleIfDue();
      } else await this.disposeClient();
      this.job = undefined;
      this.failure = undefined;
      this.state = 'idle';
      return savedTo;
    } catch (error) {
      this.quarantineResult(this.job!, error);
      throw error;
    }
  }

  async dispose() {
    if (this.state === 'disposed') return;
    if (!this.available) throw new Error('Cannot dispose active or quarantined work.');
    this.state = 'running';
    this.phase = 'recycle';
    try {
      await this.disposeClient();
      this.state = 'disposed';
    } catch (error) {
      this.state = 'quarantined';
      this.failure = error;
      throw error;
    }
  }
}

export class ResultDeliveryError extends Error {
  constructor(readonly result: JobResult, cause: unknown) {
    super(`Could not record result for job ${result.job.id}.`, { cause });
  }
}

// The producer is pulled only by an available worker. There is no unbounded
// queue of closures, buffers, results or pending submit promises.
export async function runBatch<Document extends BatchDocument>(
  jobs: AsyncIterable<BatchJob>,
  workers: readonly DocumentWorker<Document>[],
  onResult: (result: JobResult, workerIndex: number) => Promise<void>,
  signal?: AbortSignal,
) {
  if (!workers.length || new Set(workers).size !== workers.length) throw new Error('Provide distinct workers.');
  if (workers.some((worker) => !worker.available)) throw new Error('Every worker must be available at admission.');
  const source = jobs[Symbol.asyncIterator]();
  let exhausted = false;
  let stopping = false;
  let completed = 0;
  const counts = { saved: 0, cancelled: 0, rejected: 0, quarantined: 0 };
  let sourceLock: Promise<unknown> = Promise.resolve();
  const stop = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  const take = () => {
    const next = sourceLock.then(async (): Promise<IteratorResult<BatchJob>> => {
      if (exhausted || stopping || signal?.aborted) return { done: true, value: undefined };
      const entry = await source.next();
      exhausted = entry.done === true;
      return entry;
    });
    sourceLock = next.catch(() => { stopping = true; stop.abort(); });
    return next;
  };
  const outcomes = await Promise.allSettled(workers.map(async (worker, index) => {
    try {
      while (!stopping && !signal?.aborted && worker.available) {
        const entry = await take();
        if (entry.done) return;
        const result = await worker.run(entry.value, activeSignal);
        completed++;
        counts[result.status]++;
        try { await onResult(result, index); }
        catch (error) { throw new ResultDeliveryError(result, error); }
      }
    } catch (error) {
      stopping = true;
      stop.abort();
      throw error;
    }
  }));
  const errors = outcomes.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason] : []);
  try { await source.return?.(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Batch stopped after draining active work.');
  return { completed, exhausted, cancelled: signal?.aborted ?? false, counts, quarantined: workers.filter((worker) => worker.quarantine).length };
}
