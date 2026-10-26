/**
 * Dirty Tracker
 *
 * Tracks which pages and blocks need to be repainted during incremental layout updates.
 * This enables efficient partial repaints by identifying only the affected regions,
 * avoiding full document reflows during typing and editing operations.
 *
 * Tracking Strategy:
 * 1. Mark dirty regions when edits occur (pages, blocks, or ranges)
 * 2. Query dirty state to determine what needs repainting
 * 3. Clear dirty state after processing
 * 4. Support viewport-based queries for prioritizing visible content
 *
 * @module dirty-tracker
 */

/**
 * Represents a range of dirty content with reason for tracking.
 */
export interface DirtyRange {
  /** Starting page index (inclusive) */
  startPage: number;
  /** Ending page index (inclusive) */
  endPage: number;
  /** Starting block index (inclusive) */
  startBlock: number;
  /** Ending block index (inclusive) */
  endBlock: number;
  /** Reason this range became dirty */
  reason: 'edit' | 'resize' | 'scroll' | 'pagination';
}

/**
 * DirtyTracker manages dirty state for incremental layout updates.
 *
 * This class provides fine-grained tracking of which pages and blocks need
 * repainting, enabling efficient partial updates during typing bursts.
 */
export class DirtyTracker {
  private dirtyPages: Set<number> = new Set();
  private dirtyBlocks: Set<number> = new Set();
  private dirtyRanges: DirtyRange[] = [];
  private maxPageTracked: number = -1;

  /**
   * Mark a specific page as dirty.
   *
   * @param pageIndex - Zero-based page index to mark dirty
   * @param reason - Reason for marking dirty
   */
  markPageDirty(pageIndex: number, reason: DirtyRange['reason']): void {
    if (pageIndex < 0) {
      console.warn(`[DirtyTracker] Invalid page index: ${pageIndex}. Must be non-negative. Ignoring.`);
      return; // Ignore invalid page indices
    }

    this.dirtyPages.add(pageIndex);
    this.maxPageTracked = Math.max(this.maxPageTracked, pageIndex);

    // Add or update dirty range for this page
    this.addOrMergeRange({
      startPage: pageIndex,
      endPage: pageIndex,
      startBlock: -1,
      endBlock: -1,
      reason,
    });
  }

  /**
   * Mark a range of blocks as dirty.
   *
   * @param startBlock - Starting block index (inclusive)
   * @param endBlock - Ending block index (inclusive)
   * @param reason - Reason for marking dirty
   */
  markBlocksDirty(startBlock: number, endBlock: number, reason: DirtyRange['reason']): void {
    if (startBlock < 0 || endBlock < startBlock) {
      console.warn(
        `[DirtyTracker] Invalid block range: [${startBlock}, ${endBlock}]. Start must be non-negative and end must be >= start. Ignoring.`,
      );
      return; // Ignore invalid ranges
    }

    for (let i = startBlock; i <= endBlock; i++) {
      this.dirtyBlocks.add(i);
    }

    // Add or update dirty range for these blocks
    this.addOrMergeRange({
      startPage: -1,
      endPage: -1,
      startBlock,
      endBlock,
      reason,
    });
  }

  /**
   * Mark all pages from a starting point as dirty.
   * Used for pagination changes that affect all subsequent pages.
   *
   * @param startPage - Starting page index (inclusive)
   * @param reason - Reason for marking dirty (typically 'pagination')
   */
  markDirtyFrom(startPage: number, reason: DirtyRange['reason']): void {
    if (startPage < 0) {
      console.warn(`[DirtyTracker] Invalid start page: ${startPage}. Must be non-negative. Ignoring.`);
      return; // Ignore invalid page indices
    }

    // Mark from startPage to a reasonable upper bound
    // We use Number.MAX_SAFE_INTEGER to represent "all remaining pages"
    const endPage = Number.MAX_SAFE_INTEGER;

    this.addOrMergeRange({
      startPage,
      endPage,
      startBlock: -1,
      endBlock: -1,
      reason,
    });

    // Update maxPageTracked
    this.maxPageTracked = Math.max(this.maxPageTracked, startPage);
  }

  /**
   * Get dirty pages that intersect with the viewport range.
   *
   * @param viewportStart - Starting page index of viewport (inclusive)
   * @param viewportEnd - Ending page index of viewport (inclusive)
   * @returns Sorted array of dirty page indices within viewport
   */
  getDirtyPagesInViewport(viewportStart: number, viewportEnd: number): number[] {
    if (viewportStart < 0 || viewportEnd < viewportStart) {
      return [];
    }

    const resultSet = new Set<number>();

    for (const pageIndex of this.dirtyPages) {
      if (pageIndex >= viewportStart && pageIndex <= viewportEnd) {
        resultSet.add(pageIndex);
      }
    }

    for (const range of this.dirtyRanges) {
      if (range.startPage < 0 || range.endPage !== Number.MAX_SAFE_INTEGER) continue;
      for (let i = Math.max(range.startPage, viewportStart); i <= viewportEnd; i++) {
        resultSet.add(i);
      }
    }

    return Array.from(resultSet).sort((a, b) => a - b);
  }

  /**
   * Get all dirty ranges.
   *
   * @returns Array of dirty ranges (copy to prevent external mutation)
   */
  getDirtyRanges(): DirtyRange[] {
    return [...this.dirtyRanges];
  }

  /**
   * Clear dirty state for the specified pages.
   *
   * @param pages - Array of page indices to clear
   */
  clearDirty(pages: number[]): void {
    const pageSet = new Set(pages);

    for (const page of pages) {
      this.dirtyPages.delete(page);
    }

    // Remove or adjust ranges based on cleared pages
    this.dirtyRanges = this.dirtyRanges.filter((range) => {
      if (range.startPage < 0 || range.endPage < 0) {
        return true; // Keep block-only ranges
      }

      // For open-ended ranges (endPage = MAX_SAFE_INTEGER), only remove if start page cleared
      if (range.endPage === Number.MAX_SAFE_INTEGER) {
        return !pageSet.has(range.startPage);
      }

      // Check if any page in the range is still dirty
      for (let i = range.startPage; i <= range.endPage; i++) {
        if (!pageSet.has(i) && this.dirtyPages.has(i)) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Check if any dirty content exists.
   *
   * @returns True if there are any dirty pages, blocks, or ranges
   */
  hasDirty(): boolean {
    return this.dirtyPages.size > 0 || this.dirtyBlocks.size > 0 || this.dirtyRanges.length > 0;
  }

  /**
   * Clear all dirty state.
   */
  clearAll(): void {
    this.dirtyPages.clear();
    this.dirtyBlocks.clear();
    this.dirtyRanges = [];
    this.maxPageTracked = -1;
  }

  /**
   * Add a new range or merge with existing compatible ranges.
   *
   * @param newRange - Range to add
   * @private
   */
  private addOrMergeRange(newRange: DirtyRange): void {
    // Try to merge with existing ranges of the same reason
    let merged = false;

    for (let i = 0; i < this.dirtyRanges.length; i++) {
      const existing = this.dirtyRanges[i];

      if (existing.reason !== newRange.reason) {
        continue;
      }

      // Check if ranges can be merged (pages)
      if (
        existing.startPage >= 0 &&
        newRange.startPage >= 0 &&
        this.rangesOverlap(
          existing.startPage,
          existing.endPage === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : existing.endPage,
          newRange.startPage,
          newRange.endPage === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : newRange.endPage,
        )
      ) {
        existing.startPage = Math.min(existing.startPage, newRange.startPage);
        existing.endPage =
          existing.endPage === Number.MAX_SAFE_INTEGER || newRange.endPage === Number.MAX_SAFE_INTEGER
            ? Number.MAX_SAFE_INTEGER
            : Math.max(existing.endPage, newRange.endPage);
        merged = true;
        break;
      }

      // Check if ranges can be merged (blocks)
      if (
        existing.startBlock >= 0 &&
        newRange.startBlock >= 0 &&
        this.rangesOverlap(existing.startBlock, existing.endBlock, newRange.startBlock, newRange.endBlock)
      ) {
        existing.startBlock = Math.min(existing.startBlock, newRange.startBlock);
        existing.endBlock = Math.max(existing.endBlock, newRange.endBlock);
        merged = true;
        break;
      }
    }

    if (!merged) {
      this.dirtyRanges.push({ ...newRange });
    }
  }

  /**
   * Check if two ranges overlap or are adjacent.
   *
   * This method is used for range merging optimization. Two ranges are considered
   * mergeable if they overlap or are directly adjacent (touching). This prevents
   * fragmentation of the dirty ranges list.
   *
   * Algorithm:
   * - Ranges [a, b] and [c, d] overlap if: a <= d+1 AND c <= b+1
   * - The +1 accounts for adjacent ranges (e.g., [1,3] and [4,6] are adjacent)
   *
   * Examples:
   * - [1, 3] and [2, 5]: overlap (intersect)
   * - [1, 3] and [4, 6]: adjacent (touch at boundary)
   * - [1, 3] and [5, 7]: separate (gap of 1)
   *
   * Complexity: O(1)
   *
   * @param start1 - Start of first range (inclusive)
   * @param end1 - End of first range (inclusive)
   * @param start2 - Start of second range (inclusive)
   * @param end2 - End of second range (inclusive)
   * @returns True if ranges overlap or are adjacent, false otherwise
   * @private
   */
  private rangesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
    // Ranges overlap if they intersect or are adjacent (differ by 1)
    return start1 <= end2 + 1 && start2 <= end1 + 1;
  }
}
