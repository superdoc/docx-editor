import { describe, expect, it, vi } from 'vite-plus/test';
import { createDocumentPolicy, normalizeDocumentMode } from './document-policy.js';
import type { LooseRecord } from './loose-record.js';
import { SUPERDOC_UI_REASONS } from './reasons.js';

function policyFor(superdoc: unknown, editor: LooseRecord | null = null) {
  return createDocumentPolicy({ superdoc, getEditor: () => editor });
}

describe('normalizeDocumentMode', () => {
  it('keeps only the three public modes', () => {
    expect(normalizeDocumentMode('editing')).toBe('editing');
    expect(normalizeDocumentMode('suggesting')).toBe('suggesting');
    expect(normalizeDocumentMode('viewing')).toBe('viewing');
    expect(normalizeDocumentMode('Editing')).toBeNull();
    expect(normalizeDocumentMode(undefined)).toBeNull();
    expect(normalizeDocumentMode(null)).toBeNull();
  });
});

describe('readDocumentMode', () => {
  it('prefers the public config mode without reading the runtime snapshot', () => {
    const getActiveRuntime = vi.fn(() => ({ getSnapshot: () => ({ documentMode: 'viewing' }) }));
    const policy = policyFor({ config: { documentMode: 'suggesting' }, getActiveRuntime });
    expect(policy.readDocumentMode()).toBe('suggesting');
    expect(getActiveRuntime).not.toHaveBeenCalled();
  });

  it('falls back to the runtime snapshot, then the editor options', () => {
    const runtime = { getSnapshot: () => ({ documentMode: 'viewing' }) };
    const editor = { options: { documentMode: 'editing' } };
    expect(policyFor({ config: {}, getActiveRuntime: () => runtime }, editor).readDocumentMode()).toBe('viewing');
    expect(policyFor({ config: {}, getActiveRuntime: () => null }, editor).readDocumentMode()).toBe('editing');
    expect(policyFor({ config: null }, { options: null }).readDocumentMode()).toBeNull();
  });

  it('treats a throwing runtime as no runtime mode', () => {
    const editor = { options: { documentMode: 'suggesting' } };
    const superdoc = {
      getActiveRuntime: () => {
        throw new Error('gone');
      },
    };
    expect(policyFor(superdoc, editor).readDocumentMode()).toBe('suggesting');
  });

  it('reads nothing from a missing host', () => {
    expect(policyFor(null).readDocumentMode()).toBeNull();
    expect(policyFor(undefined).documentIsReadOnly()).toBe(false);
  });
});

describe('documentIsReadOnly', () => {
  it('is read-only in viewing mode or after a failed collaboration connection', () => {
    expect(policyFor({ config: { documentMode: 'viewing' } }).documentIsReadOnly()).toBe(true);
    expect(
      policyFor({
        config: { documentMode: 'editing' },
        getCollaborationConnectionState: () => ({ state: 'failed' }),
      }).documentIsReadOnly(),
    ).toBe(true);
    expect(
      policyFor({
        config: { documentMode: 'editing' },
        getCollaborationConnectionState: () => ({ state: 'connected' }),
      }).documentIsReadOnly(),
    ).toBe(false);
  });
});

describe('comment policy', () => {
  it('reads the resolved interaction policy before the legacy comments module', () => {
    const superdoc = {
      interactionConfig: { comments: { readOnly: false, allowResolve: true } },
      config: { modules: { comments: { readOnly: true, allowResolve: false } } },
    };
    const policy = policyFor(superdoc);
    expect(policy.commentsAreReadOnly()).toBe(false);
    expect(policy.resolveIsForbidden()).toBe(false);
  });

  it('keeps the resolved policy when the built-in comments UI is off', () => {
    const superdoc = {
      interactionConfig: { comments: { readOnly: true, allowResolve: false } },
      config: { modules: { comments: false } },
    };
    const policy = policyFor(superdoc);
    expect(policy.commentsAreReadOnly()).toBe(true);
    expect(policy.resolveIsForbidden()).toBe(true);
  });

  it('falls back to the legacy comments module', () => {
    const policy = policyFor({ config: { modules: { comments: { readOnly: true, allowResolve: false } } } });
    expect(policy.commentsAreReadOnly()).toBe(true);
    expect(policy.resolveIsForbidden()).toBe(true);
    expect(policyFor({ config: { modules: { comments: {} } } }).commentsAreReadOnly()).toBe(false);
    expect(policyFor({ config: { modules: { comments: false } } }).resolveIsForbidden()).toBe(false);
  });

  it('ignores a resolved policy field that is not a boolean', () => {
    const superdoc = {
      interactionConfig: { comments: { readOnly: 'yes' } },
      config: { modules: { comments: { readOnly: false } } },
    };
    expect(policyFor(superdoc).commentsAreReadOnly()).toBe(false);
  });

  it('SD-4470: keeps comment writes open in viewing mode when comments are writable', () => {
    const policy = policyFor({
      config: { documentMode: 'viewing' },
      interactionConfig: { comments: { readOnly: false } },
    });
    expect(policy.documentIsReadOnly()).toBe(true);
    expect(policy.commentMutationsAreReadOnly()).toBe(false);
  });
});

describe('tracked-change decisions', () => {
  it('is disabled with the read-only reason while the document is read-only', () => {
    const policy = policyFor({
      config: { documentMode: 'viewing' },
      interactionConfig: { trackedChanges: { allowDecisions: true } },
    });
    expect(policy.trackedChangeDecisionDisabledReason()).toBe(SUPERDOC_UI_REASONS.documentReadonly);
    expect(policy.trackedChangeDecisionsAreDisabled()).toBe(true);
  });

  it('follows the dedicated decision policy over comment read-only', () => {
    const allowed = policyFor({
      config: { documentMode: 'editing' },
      interactionConfig: { comments: { readOnly: true }, trackedChanges: { allowDecisions: true } },
    });
    expect(allowed.trackedChangeDecisionDisabledReason()).toBeUndefined();
    expect(allowed.trackedChangeDecisionsAreDisabled()).toBe(false);

    const denied = policyFor({
      config: { documentMode: 'editing' },
      interactionConfig: { comments: { readOnly: false }, trackedChanges: { allowDecisions: false } },
    });
    expect(denied.trackedChangeDecisionDisabledReason()).toBe(SUPERDOC_UI_REASONS.trackedChangeDecisionsDisabled);
  });

  it('falls back to comment read-only for hosts without a decision policy', () => {
    const policy = policyFor({ config: { documentMode: 'editing', modules: { comments: { readOnly: true } } } });
    expect(policy.trackedChangeDecisionDisabledReason()).toBe(SUPERDOC_UI_REASONS.documentReadonly);
    expect(policyFor({ config: { documentMode: 'editing' } }).trackedChangeDecisionsAreDisabled()).toBe(false);
  });
});

describe('live reads', () => {
  it('sees policy and editor changes made after creation', () => {
    const superdoc: LooseRecord = { config: {} };
    let editor: LooseRecord | null = null;
    const policy = createDocumentPolicy({ superdoc, getEditor: () => editor });
    expect(policy.readDocumentMode()).toBeNull();
    editor = { options: { documentMode: 'suggesting' } };
    expect(policy.readDocumentMode()).toBe('suggesting');
    superdoc.config = { documentMode: 'viewing' };
    expect(policy.readDocumentMode()).toBe('viewing');
    superdoc.interactionConfig = { comments: { readOnly: true } };
    expect(policy.commentsAreReadOnly()).toBe(true);
  });
});
