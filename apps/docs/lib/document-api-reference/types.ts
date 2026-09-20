export type JsonSchema = Record<string, unknown>;

export type ReferenceMetadata = {
  mutates: boolean;
  idempotency: 'idempotent' | 'conditional' | 'non-idempotent';
  supportsDryRun: boolean;
  trackedSupport?: 'always' | 'conditional' | 'never';
  supportsTrackedMode: boolean;
  /**
   * Set when tracked mode is permitted for some targets but cannot be promised
   * statically, so the reference renders it as `conditional` rather than `no`.
   */
  supportsConditionalTrackedMode?: boolean;
  deterministicTargetResolution: boolean;
  returnsPromise?: boolean;
  possibleFailureCodes: string[];
  throws: { preApply: string[]; postApplyForbidden: true };
  remediationHints?: string[];
};

export type ReferenceOperation = {
  operationId: string;
  groupKey: string;
  memberPath: string;
  description: string;
  expectedResult: string;
  path: string;
  metadata: ReferenceMetadata;
  schemas: {
    input: JsonSchema;
    output: JsonSchema;
    success?: JsonSchema;
    failure?: JsonSchema;
  };
};

export type ReferenceGroup = {
  key: string;
  title: string;
  description: string;
  path: string;
  operationIds: string[];
};

export type DocumentApiReferenceModel = {
  contractVersion: string;
  sourceHash: string;
  schemaDialect: string;
  definitions: Record<string, JsonSchema>;
  groups: ReferenceGroup[];
  operations: Record<string, ReferenceOperation>;
  examples: Record<string, ReferenceExample>;
};

export type ReferenceExample = {
  label: string;
  provenance: string;
  sourcePath: string;
  code: string;
};

export type ReferenceOperationSummary = Pick<
  ReferenceOperation,
  'operationId' | 'groupKey' | 'memberPath' | 'description' | 'path' | 'metadata'
>;
