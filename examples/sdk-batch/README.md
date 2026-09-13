# Bounded SDK document batches

Process a stream of document paths with one active document per SDK host. Each
worker reuses its host for ten saved and closed documents, then disposes that
empty host before starting another. The default is one worker; a second is an
explicit throughput choice that needs additional memory headroom.

This is application code using the existing Node SDK. Copy this directory and
adapt the work callback and result storage for your service.

```sh
pnpm install
pnpm typecheck
pnpm test
# paths.txt contains one input DOCX path per line. The output directory must be new.
pnpm start paths.txt ./batch-output 1
```

The command reads each document and exports it unchanged. Put sequential,
awaited SDK edits in the callback in `index.ts`. It writes a fresh directory per
job with `document.docx`, plus an append-only `results.jsonl` recording the
outcome and saved path. Input documents and previous job directories are never
overwritten. Results arrive in completion order.

`runBatch` pulls an async source only when a worker is available and has finished
recording its previous result. It holds at most one admitted descriptor per
worker, with no separate queue of documents or buffers. Do not build a large
array of promises or launch unawaited SDK calls inside the work callback. For a
worker-owned document, let the worker perform save, close and client disposal;
the callback performs only its awaited document operations. For a
durable job source, acknowledge jobs only after recording their result; closing
an iterator does not acknowledge unstarted work. Async sources must settle their
pending reads when your service stops.

Cancellation is cooperative. Checkpoints run between completed RPC calls;
SIGINT and SIGTERM request this cancellation. An active document is saved to
`recovery.docx` and closed before its slot becomes available. If cancellation
arrives during the final save, the result identifies the already saved output.
A timeout does not cancel an RPC and does not prove that a mutation failed.

A failed mutation, unconfirmed save/close, uncertain open, or failed host
disposal quarantines that worker. Its client, session ID and any document handle remain
available through `worker.quarantine`, and it continues to count against the
worker limit. Healthy workers can finish other jobs. The summary distinguishes
an exhausted source from a batch that stopped with work still unstarted.

Recovery belongs to the service that owns the job. Keep the worker objects
alive, inspect the failure, and establish that all earlier RPCs have settled and
the transport is healthy before calling:

```ts
const savedTo = await worker.recoverAfterSettled();
// Record this recovery receipt before admitting further work to this worker.
```

That method saves the retained document to `recovery.docx` and confirms close;
it never replays the failed mutation. A second failed save retains the same
handle. An uncertain open without a handle or uncertain close requires explicit
reconciliation of the retained client/handle and saved output; this recipe
cannot infer its outcome. The retained session ID identifies an uncertain open
even when the host's response did not return a document handle. A client
construction error or known `FILE_READ_ERROR` rejects the job before a
document is created and allows reuse. The command reports quarantined jobs and
keeps their clients alive; integrate your recovery controller before using the
command in an unattended service. Never force-dispose quarantined work as an
automatic retry policy.

Optional `collaboration` and `openOptions` fields on a job pass through to the
SDK, including per-open authentication. Keep separate worker sets for different
tenant identities or client configurations. The example's file-list command
uses local documents; the worker supports collaboration jobs supplied by your
application.

The default Node SDK uses its embedded CLI host. An explicitly configured
standalone document host is a different execution surface and needs its own
capacity measurements.

Reuse amortizes host startup; it does not promise a lower busy memory peak or
indefinitely flat memory use. Ten documents is a finite recycling policy, not a
RAM guarantee. Select worker count and batch size using your own document sizes,
transient peaks, caller memory, and any colocated collaboration service. Labs'
SDK memory capacity report provides advisory measurements for this purpose.

`pnpm test` exercises admission, result backpressure, cancellation, recovery,
unknown outcomes, output protection and clean recycling with controlled clients.
The repository's compiled CLI test lane additionally exercises the same worker
against the native SDK host, including real saved documents and save failures.
