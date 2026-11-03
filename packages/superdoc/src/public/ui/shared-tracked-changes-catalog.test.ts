import { describe, expect, it } from 'vite-plus/test';
import {
  acquireSharedUiTrackedChangesCatalog,
  releaseSharedUiTrackedChangesCatalog,
} from './shared-tracked-changes-catalog.js';

describe('shared tracked-changes catalog', () => {
  it('gives every controller on one host the same transport', () => {
    const host = {};
    const first = acquireSharedUiTrackedChangesCatalog(host);
    const second = acquireSharedUiTrackedChangesCatalog(host);
    expect(second).toBe(first);
    releaseSharedUiTrackedChangesCatalog(host, second);
    expect(first.abortController.signal.aborted).toBe(false);
    releaseSharedUiTrackedChangesCatalog(host, first);
    expect(first.abortController.signal.aborted).toBe(true);
    expect(acquireSharedUiTrackedChangesCatalog(host)).not.toBe(first);
  });
});
