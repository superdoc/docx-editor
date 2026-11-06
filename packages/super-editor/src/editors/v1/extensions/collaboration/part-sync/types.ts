/**
 * Runtime type contracts for the part-sync collaboration module.
 */

import type { PartId } from '../../../core/parts/types.js';

// ---------------------------------------------------------------------------
// Yjs Part Envelope
// ---------------------------------------------------------------------------

/** Per-part envelope stored in the Yjs `parts` map. */
export interface PartEnvelope {
  /** Version counter — incremented on every publish. Starts at 1. */
  v: number;
  /** `ydoc.clientID` of the writer. Identifies which client produced this version. */
  clientId: number;
  /** Full OOXML JSON tree for the part. */
  data: unknown;
  /** Generated comment ID/name projection; absent on raw imported parts. Never serialized to OOXML. */
  generatedCommentAuthors?: [string, string][];
}

// ---------------------------------------------------------------------------
// Migration Metadata
// ---------------------------------------------------------------------------

export interface PartsMigrationMeta {
  status: 'success' | 'failed' | 'in-progress';
  attempts: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  source: string;
}

export interface PartsCapability {
  version: number;
  enabledAt: string;
  clientId: number;
}

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

/** Buffered part event during compound mutations. */
export interface BufferedPartEvent {
  partId: PartId;
  operation: 'mutate' | 'create' | 'delete';
  data: unknown;
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

/** Tracks a failed remote part for retry gating. */
export interface FailedPartEntry {
  v: number;
  clientId: number;
}

// ---------------------------------------------------------------------------
// Telemetry Payloads
// ---------------------------------------------------------------------------

export interface ConcurrentOverwriteTelemetry {
  partId: string;
  localVersion: number;
  remoteVersion: number;
  remoteClientId: number;
  gapMs: number;
}

export interface RemoteApplyErrorTelemetry {
  partId: string;
  error: string;
  remoteVersion: number;
  remoteClientId: number;
}

export interface HydrationCriticalFailureTelemetry {
  partId: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Degraded Mode
// ---------------------------------------------------------------------------

/** Emitted as `parts:degraded` when part-sync cannot activate. */
export interface PartSyncDegradedEvent {
  reason: 'critical-hydration-failure' | 'migration-failure';
  /** Per-part failure descriptions (e.g., "word/styles.xml: entry is not a Y.Map"). */
  failures: string[];
}
