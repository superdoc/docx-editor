import { buildContractSnapshot } from './contract-snapshot.js';
import { stableStringify, type GeneratedFile } from './generation-utils.js';

const GENERATED_FILE_HEADER = 'GENERATED FILE: DO NOT EDIT. Regenerate via `pnpm run docapi:sync`.\n';

const STABLE_SCHEMA_ROOT = 'packages/document-api/generated/schemas';
const AGENT_ARTIFACT_ROOT = 'packages/document-api/generated/agent';

function buildOperationContractMap() {
  const snapshot = buildContractSnapshot();

  const operations = Object.fromEntries(
    snapshot.operations.map((operation) => [
      operation.operationId,
      {
        memberPath: operation.memberPath,
        metadata: operation.metadata,
        inputSchema: operation.schemas.input,
        outputSchema: operation.schemas.output,
        successSchema: operation.schemas.success,
        failureSchema: operation.schemas.failure,
        ...(operation.skipAsATool ? { skipAsATool: true } : {}),
        ...(operation.intentGroup ? { intentGroup: operation.intentGroup } : {}),
        ...(operation.intentAction ? { intentAction: operation.intentAction } : {}),
      },
    ]),
  );

  return {
    contractVersion: snapshot.contractVersion,
    schemaDialect: snapshot.schemaDialect,
    sourceHash: snapshot.sourceHash,
    ...(snapshot.$defs ? { $defs: snapshot.$defs } : {}),
    operations,
  };
}

export function buildStableSchemaArtifacts(): GeneratedFile[] {
  const contractMap = buildOperationContractMap();

  const artifact = {
    $schema: contractMap.schemaDialect,
    contractVersion: contractMap.contractVersion,
    generatedAt: null,
    sourceCommit: null,
    sourceHash: contractMap.sourceHash,
    operations: contractMap.operations,
  };

  return [
    {
      path: `${STABLE_SCHEMA_ROOT}/document-api-contract.json`,
      content: stableStringify(artifact),
    },
    {
      path: `${STABLE_SCHEMA_ROOT}/README.md`,
      content: `# Generated Document API schemas\n\n${GENERATED_FILE_HEADER}This directory is generated from \`packages/document-api/src/contract/*\`.\n`,
    },
  ];
}

const DEFAULT_REMEDIATION_BY_CODE: Record<string, string> = {
  TARGET_NOT_FOUND: 'Refresh targets via find/get operations and retry with a fresh address or ID.',
  CAPABILITY_UNAVAILABLE: 'Check runtime capabilities and switch to supported mode or operation.',
  INVALID_TARGET: 'Confirm the target shape and operation compatibility, then retry with a valid target.',
  NO_OP: 'Treat as idempotent no-op and avoid retry loops unless inputs change.',
  // SDM/1 structural codes
  INVALID_PAYLOAD: 'Check fragment structure: every node needs a valid kind and required payload fields.',
  CAPABILITY_UNSUPPORTED: 'This node kind or operation is not supported by the current engine. Check capabilities.',
  ADDRESS_STALE: 'The address was obtained before a mutation and is no longer valid. Re-resolve the address.',
  DUPLICATE_ID: 'A node ID in the fragment conflicts with an existing document node. Use unique IDs or omit them.',
  INVALID_CONTEXT:
    'The target context does not allow this content (e.g., inserting block content inside an inline context).',
  RAW_MODE_REQUIRED: 'This node kind requires raw mode opt-in. Set rawMode: true in the operation options.',
  PRESERVE_ONLY_VIOLATION:
    'This node family is preserve-only and cannot be inserted or replaced via the structural API.',
};

export function buildAgentArtifacts(): GeneratedFile[] {
  const contractMap = buildOperationContractMap();

  const remediationEntries = new Map<
    string,
    {
      code: string;
      message: string;
      operations: string[];
      preApplyOperations: string[];
      nonAppliedOperations: string[];
    }
  >();

  for (const [operationId, operation] of Object.entries(contractMap.operations)) {
    for (const code of operation.metadata.throws.preApply) {
      const entry = remediationEntries.get(code) ?? {
        code,
        message: DEFAULT_REMEDIATION_BY_CODE[code] ?? 'Inspect structured error details and operation capabilities.',
        operations: [],
        preApplyOperations: [],
        nonAppliedOperations: [],
      };
      entry.operations.push(operationId);
      entry.preApplyOperations.push(operationId);
      remediationEntries.set(code, entry);
    }

    for (const code of operation.metadata.possibleFailureCodes) {
      const entry = remediationEntries.get(code) ?? {
        code,
        message: DEFAULT_REMEDIATION_BY_CODE[code] ?? 'Inspect structured error details and operation capabilities.',
        operations: [],
        preApplyOperations: [],
        nonAppliedOperations: [],
      };
      entry.operations.push(operationId);
      entry.nonAppliedOperations.push(operationId);
      remediationEntries.set(code, entry);
    }
  }

  const remediationMap = {
    contractVersion: contractMap.contractVersion,
    sourceHash: contractMap.sourceHash,
    entries: Array.from(remediationEntries.values())
      .map((entry) => ({
        ...entry,
        operations: [...new Set(entry.operations)].sort(),
        preApplyOperations: [...new Set(entry.preApplyOperations)].sort(),
        nonAppliedOperations: [...new Set(entry.nonAppliedOperations)].sort(),
      }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  };

  const workflowPlaybooks = {
    contractVersion: contractMap.contractVersion,
    sourceHash: contractMap.sourceHash,
    workflows: [
      {
        id: 'find-mutate',
        title: 'Find + mutate workflow',
        operations: ['find', 'replace'],
      },
      {
        id: 'tracked-insert',
        title: 'Tracked insert workflow',
        operations: ['capabilities.get', 'capabilities.check', 'insert'],
      },
      {
        id: 'comment-thread-lifecycle',
        title: 'Comment lifecycle workflow',
        operations: ['comments.create', 'comments.patch', 'comments.delete'],
      },
      {
        id: 'list-manipulation',
        title: 'List manipulation workflow',
        operations: ['lists.list', 'lists.create', 'lists.insert', 'lists.indent', 'lists.outdent', 'lists.detach'],
      },
      {
        id: 'capabilities-aware-branching',
        title: 'Capabilities-aware branching workflow',
        operations: ['capabilities.get', 'capabilities.check', 'replace', 'insert'],
      },
      {
        id: 'track-change-review',
        title: 'Track-change review workflow',
        operations: ['trackChanges.list', 'trackChanges.decide'],
      },
    ],
  };

  const compatibilityHints = {
    contractVersion: contractMap.contractVersion,
    sourceHash: contractMap.sourceHash,
    operations: Object.fromEntries(
      Object.entries(contractMap.operations).map(([operationId, operation]) => [
        operationId,
        {
          memberPath: operation.memberPath,
          mutates: operation.metadata.mutates,
          trackedSupport: operation.metadata.trackedSupport,
          supportsTrackedMode: operation.metadata.supportsTrackedMode,
          supportsDryRun: operation.metadata.supportsDryRun,
          // SD-3247: async operations resolve a Promise; downstream automation
          // must await the call instead of inferring sync/async from prose.
          returnsPromise: operation.metadata.returnsPromise === true,
          requiresPreflightCapabilitiesCheck: operation.metadata.mutates,
          postApplyThrowForbidden: operation.metadata.throws.postApplyForbidden,
          deterministicTargetResolution: operation.metadata.deterministicTargetResolution,
        },
      ]),
    ),
  };

  return [
    {
      path: `${AGENT_ARTIFACT_ROOT}/remediation-map.json`,
      content: stableStringify(remediationMap),
    },
    {
      path: `${AGENT_ARTIFACT_ROOT}/workflow-playbooks.json`,
      content: stableStringify(workflowPlaybooks),
    },
    {
      path: `${AGENT_ARTIFACT_ROOT}/compatibility-hints.json`,
      content: stableStringify(compatibilityHints),
    },
  ];
}

export function getStableSchemaRoot(): string {
  return STABLE_SCHEMA_ROOT;
}

export function getAgentArtifactRoot(): string {
  return AGENT_ARTIFACT_ROOT;
}
