/**
 * Tracks document opens for usage-based billing.
 * Sends each event immediately. Delivery failures do not affect the Editor.
 */

declare const __APP_VERSION__: string;

export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  licenseKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BrowserInfo {
  userAgent: string;
  currentUrl: string;
  hostname: string;
  screenSize: {
    width: number;
    height: number;
  };
}

export interface DocumentOpenEvent {
  timestamp: string;
  documentId: string | null;
  documentCreatedAt: string | null;
}

export interface TelemetryPayload {
  superdocVersion: string;
  browserInfo: BrowserInfo;
  metadata?: Record<string, unknown>;
  events: DocumentOpenEvent[];
}

const DEFAULT_ENDPOINT = 'https://ingest.superdoc.dev/v1/collect';

/**
 * Community license key for AGPLv3 / evaluation usage.
 */
export const COMMUNITY_LICENSE_KEY = 'community-and-eval-agplv3';

function getSuperdocVersion(): string {
  try {
    return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
  } catch {
    return 'unknown';
  }
}

export class Telemetry {
  private enabled: boolean;
  private endpoint: string;
  private superdocVersion: string;
  private licenseKey: string;
  private metadata?: Record<string, unknown>;

  constructor(config: TelemetryConfig) {
    this.enabled = config.enabled;
    this.endpoint = config.endpoint || DEFAULT_ENDPOINT;
    this.licenseKey = config.licenseKey || '';
    this.metadata = config.metadata;
    this.superdocVersion = getSuperdocVersion();
  }

  private getBrowserInfo(): BrowserInfo {
    if (typeof window === 'undefined') {
      return {
        userAgent: '',
        currentUrl: '',
        hostname: '',
        screenSize: { width: 0, height: 0 },
      };
    }

    return {
      userAgent: window.navigator.userAgent,
      currentUrl: window.location.origin,
      hostname: window.location.hostname,
      screenSize: {
        width: window.screen.width,
        height: window.screen.height,
      },
    };
  }

  /**
   * Sends a document-open event without waiting for delivery.
   * @param documentId Document identifier, or `null` when unavailable.
   * @param documentCreatedAt Value from `dcterms:created`, or `null` when unavailable.
   */
  trackDocumentOpen(documentId: string | null, documentCreatedAt: string | null = null): void {
    if (!this.enabled) return;

    const event: DocumentOpenEvent = {
      timestamp: new Date().toISOString(),
      documentId,
      documentCreatedAt,
    };

    void this.sendEvent(event);
  }

  private async sendEvent(event: DocumentOpenEvent): Promise<void> {
    const payload: TelemetryPayload = {
      superdocVersion: this.superdocVersion,
      browserInfo: this.getBrowserInfo(),
      ...(this.metadata && { metadata: this.metadata }),
      events: [event],
    };

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-License-Key': this.licenseKey,
        },
        body: JSON.stringify(payload),
        credentials: 'omit',
      });
    } catch {
      // Telemetry delivery must not affect Editor behavior.
    }
  }
}
