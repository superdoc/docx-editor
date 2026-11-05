/**
 * Debounced Pass Manager
 *
 * Manages debouncing of expensive update passes during document editing to improve
 * typing performance. Allows deferring non-critical operations until typing pauses.
 *
 * Debouncing Strategy:
 * 1. Register expensive passes with delays and priorities
 * 2. Trigger passes during edits (starts/resets debounce timers)
 * 3. Execute passes only after debounce delay expires
 * 4. Cancel pending passes when needed
 *
 * Common Debounced Passes:
 * - Header/footer updates (500ms)
 * - List renumbering (100ms)
 * - Cross-reference updates (2000ms)
 * - Page number updates (500ms)
 * - Footnote layout (200ms)
 *
 * @module debounced-passes
 */

/**
 * Configuration for a debounced pass.
 */
export interface DebouncedPass {
  /** Unique identifier for this pass */
  id: string;
  /** Debounce delay in milliseconds */
  delay: number;
  /** Priority for execution ordering (higher = earlier) */
  priority: number;
  /** Function to execute when debounce expires */
  execute: () => void | Promise<void>;
}

/**
 * DebouncedPassManager coordinates the execution of expensive layout passes
 * by debouncing them during typing bursts.
 *
 * This ensures a responsive typing experience while still updating document
 * features like headers, footers, and cross-references once editing pauses.
 */
export class DebouncedPassManager {
  private passes: Map<string, DebouncedPass> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingExecutions: Map<string, boolean> = new Map();

  /**
   * Register a debounced pass.
   *
   * @param pass - Pass configuration
   */
  register(pass: DebouncedPass): void {
    if (!pass.id || pass.delay < 0) {
      return; // Ignore invalid passes
    }

    this.passes.set(pass.id, pass);
  }

  /**
   * Trigger a pass, starting or resetting its debounce timer.
   *
   * Example debounce delays:
   * - Header/footer updates: 500ms
   * - List renumbering: 100ms
   * - Cross-reference updates: 2000ms
   * - Page number updates: 500ms
   * - Footnote layout: 200ms
   *
   * @param passId - ID of the pass to trigger
   */
  trigger(passId: string): void {
    const pass = this.passes.get(passId);
    if (!pass) {
      return; // Pass not registered
    }

    // Clear existing timer if present
    const existingTimer = this.timers.get(passId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    // Set up new debounce timer
    const timer = setTimeout(() => {
      void this.executePass(passId);
    }, pass.delay);

    this.timers.set(passId, timer);
    this.pendingExecutions.set(passId, true);
  }

  /**
   * Cancel a pending pass execution.
   *
   * @param passId - ID of the pass to cancel
   */
  cancel(passId: string): void {
    const timer = this.timers.get(passId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(passId);
    }

    this.pendingExecutions.delete(passId);
  }

  /**
   * Cancel all pending pass executions.
   */
  cancelAll(): void {
    for (const [passId] of this.timers) {
      this.cancel(passId);
    }
  }

  /**
   * Check if a specific pass is currently pending.
   *
   * @param passId - ID of the pass to check
   * @returns True if the pass is pending execution
   */
  isPending(passId: string): boolean {
    return this.pendingExecutions.get(passId) === true;
  }

  /**
   * Get the number of pending pass executions.
   *
   * @returns Count of passes waiting to execute
   */
  getPendingCount(): number {
    return this.pendingExecutions.size;
  }

  /**
   * Execute a pass immediately.
   * Clears the timer and pending state.
   *
   * @param passId - ID of the pass to execute
   * @private
   */
  private async executePass(passId: string): Promise<void> {
    const pass = this.passes.get(passId);
    if (!pass) {
      return;
    }

    // Clear timer and pending state
    this.timers.delete(passId);
    this.pendingExecutions.delete(passId);

    try {
      await pass.execute();
    } catch (error) {
      // Silently handle errors to prevent cascading failures
      // In production, this would be logged
      if (typeof console !== 'undefined' && console.error) {
        console.error(`Error executing debounced pass "${passId}":`, error);
      }
    }
  }

  /**
   * Unregister a pass.
   *
   * @param passId - ID of the pass to unregister
   */
  unregister(passId: string): void {
    this.cancel(passId);
    this.passes.delete(passId);
  }

  /**
   * Get all registered pass IDs.
   *
   * @returns Array of registered pass IDs
   */
  getRegisteredPasses(): string[] {
    return Array.from(this.passes.keys());
  }

  /**
   * Clear all registrations and timers.
   */
  clear(): void {
    this.cancelAll();
    this.passes.clear();
  }

  /**
   * Get pass configuration for a specific pass.
   *
   * @param passId - ID of the pass
   * @returns Pass configuration if registered, undefined otherwise
   */
  getPass(passId: string): DebouncedPass | undefined {
    return this.passes.get(passId);
  }

  /**
   * Trigger all pending passes immediately without waiting for debounce.
   * Useful when forcing a full update (e.g., before saving).
   */
  async flushAll(): Promise<void> {
    const pendingIds = Array.from(this.pendingExecutions.keys());

    // Sort by priority (higher priority first)
    const sortedIds = pendingIds.sort((a, b) => {
      const passA = this.passes.get(a);
      const passB = this.passes.get(b);
      if (!passA || !passB) return 0;
      return passB.priority - passA.priority;
    });

    for (const passId of sortedIds) {
      this.cancel(passId);
      await this.executePass(passId);
    }
  }

  /**
   * Trigger a specific pass immediately without waiting for debounce.
   *
   * @param passId - ID of the pass to flush
   */
  async flush(passId: string): Promise<void> {
    if (this.isPending(passId)) {
      this.cancel(passId);
      await this.executePass(passId);
    }
  }
}
