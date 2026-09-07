import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { SuperDocClient, type SuperDocDocument } from '@superdoc/sdk';
import { DocumentWorker, ResultDeliveryError, runBatch, type BatchJob } from './batch.ts';

const [inputList, outputRoot, count = '1'] = process.argv.slice(2);
const concurrency = Number(count);
if (!inputList || !outputRoot || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 2) {
  throw new Error('Usage: pnpm start <paths.txt> <new-output-directory> [1|2 workers]');
}
await mkdir(outputRoot);
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());

async function* jobs(): AsyncGenerator<BatchJob> {
  const input = createReadStream(inputList);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let failure: Error | undefined;
  input.on('error', (error) => { failure = error; lines.close(); });
  let index = 0;
  try {
    for await (const line of lines) {
      if (abort.signal.aborted) return;
      if (!line.trim()) continue;
      const id = String(++index);
      yield { id, input: path.resolve(line.trim()), outputDirectory: path.join(outputRoot, id) };
    }
    if (failure) throw failure;
  } finally { lines.close(); input.destroy(); }
}

const workers = Array.from({ length: concurrency }, () => new DocumentWorker<SuperDocDocument>(
  () => new SuperDocClient(),
  async (document, _job, checkpoint) => {
    await document.getText();
    checkpoint();
    // Add sequential, awaited SDK edits here. A checkpoint after each completed
    // call lets cancellation save the work completed so far before closing.
  },
  10,
));
let receiptWrite = Promise.resolve();
try {
  const summary = await runBatch(jobs(), workers, async (result, worker) => {
    receiptWrite = receiptWrite.then(() => appendFile(path.join(outputRoot, 'results.jsonl'), JSON.stringify({
      id: result.job.id, worker, status: result.status, savedTo: result.savedTo,
    }) + '\n'));
    await receiptWrite;
  }, abort.signal);
  console.log(JSON.stringify(summary));
  if (!summary.exhausted || summary.quarantined || summary.counts.rejected || summary.counts.cancelled) process.exitCode = 1;
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : 'Batch failed.');
  if (error instanceof AggregateError) {
    for (const failure of error.errors) {
      if (failure instanceof ResultDeliveryError) console.error(JSON.stringify({
        id: failure.result.job.id, status: 'result-delivery-failed', savedTo: failure.result.savedTo,
      }));
    }
  }
} finally {
  const cleanup = await Promise.allSettled(workers.map(async (worker) => {
    if (worker.quarantine) {
      console.error(`Job ${worker.quarantine.job?.id ?? '(none)'} needs recovery after ${worker.quarantine.phase}. The client remains owned by this process.`);
    } else await worker.dispose();
  }));
  const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length) {
    process.exitCode = 1;
    console.error('Clean host disposal failed; retained clients require inspection.');
  }
}
