import type { Config, SuperDocExceptionEditorPayload, SuperDocWorkerFailureDetail } from 'superdoc';

const failure: SuperDocWorkerFailureDetail = {
  beforeHello: true,
  message: 'worker module failed before hello',
  phase: 'worker.module_error',
  reason: 'module-load-failed',
};

const exception: SuperDocExceptionEditorPayload = {
  code: 'worker-init-failed',
  documentId: 'document-1',
  editor: null,
  error: new Error('SuperDoc could not load the document editor.'),
  workerFailure: failure,
};

const config: Config = {
  selector: '#editor',
  onException(payload) {
    if ('code' in payload && payload.workerFailure) {
      const phase: string = payload.workerFailure.phase;
      const elapsedMs: number | undefined = payload.workerFailure.elapsedMs;
      return [phase, elapsedMs];
    }
    return undefined;
  },
};

export { config, exception, failure };
