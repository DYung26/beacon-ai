/**
 * Session-Level Context History
 * Maintains a bounded in-memory history of page context snapshots.
 * Useful for tracking page state changes over a session.
 */

import type { PageContext } from '@beacon/shared'

/**
 * Manages a bounded history of page context snapshots.
 * Maintains the most recent N snapshots for inspection and debugging.
 */
export class ContextHistory {
  private history: PageContext[] = []
  private maxSize: number

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize
  }

  /**
   * Add a new context snapshot to the history.
   * If history exceeds maxSize, the oldest snapshot is removed.
   */
  add(context: PageContext): void {
    // Create a shallow copy to avoid mutations affecting history
    const snapshot = { ...context }
    this.history.push(snapshot)

    // Maintain bounded size
    if (this.history.length > this.maxSize) {
      this.history.shift()
    }
  }

  /**
   * Get the current history as a list.
   * Returns most recent snapshots first (newest at the end).
   */
  getAll(): PageContext[] {
    return [...this.history]
  }

  /**
   * Get the most recent context snapshot.
   */
  getLatest(): PageContext | undefined {
    return this.history[this.history.length - 1]
  }

  /**
   * Get the context snapshot at a specific index.
   * 0 = oldest, length-1 = newest
   */
  getAt(index: number): PageContext | undefined {
    return this.history[index]
  }

  /**
   * Get the number of snapshots in history.
   */
  getSize(): number {
    return this.history.length
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.history = []
  }

  /**
   * Get snapshots that match a predicate.
   * Useful for finding contexts by URL, time range, etc.
   */
  filter(predicate: (ctx: PageContext) => boolean): PageContext[] {
    return this.history.filter(predicate)
  }

  /**
   * Get contexts where the element count changed significantly.
   * Useful for detecting page structure changes.
   */
  getContextsWithElementCountChange(minChange: number = 5): PageContext[] {
    const results: PageContext[] = []
    for (let i = 1; i < this.history.length; i++) {
      const prev = this.history[i - 1]
      const curr = this.history[i]
      const diff = Math.abs(curr.elements.length - prev.elements.length)
      if (diff >= minChange) {
        results.push(curr)
      }
    }
    return results
  }

  /**
   * Get a summary of the history.
   */
  getSummary(): {
    size: number
    oldest?: { url: string; timestamp: number }
    newest?: { url: string; timestamp: number }
    urls: string[]
  } {
    return {
      size: this.history.length,
      oldest: this.history[0]
        ? { url: this.history[0].url, timestamp: this.history[0].timestamp }
        : undefined,
      newest:
        this.history.length > 0
          ? {
              url: this.history[this.history.length - 1].url,
              timestamp: this.history[this.history.length - 1].timestamp,
            }
          : undefined,
      urls: [...new Set(this.history.map((ctx) => ctx.url))],
    }
  }
}
