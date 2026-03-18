/**
 * Page Watch — monitors pages for changes and triggers notifications.
 * Uses snapshot diff under the hood to detect meaningful changes.
 */
import { snapshotDiff, type DiffResult } from '../utils/snapshot-diff';

export interface WatchTarget {
  /** Unique watch ID */
  id: string;
  /** URL to monitor */
  url: string;
  /** Session ID */
  sessionId: string;
  /** Last snapshot */
  lastSnapshot: string;
  /** Last check timestamp */
  lastCheckedAt: number;
  /** Number of changes detected */
  changeCount: number;
  /** Created at */
  createdAt: number;
}

export interface WatchChange {
  watchId: string;
  url: string;
  diff: DiffResult;
  detectedAt: number;
}

export class PageWatcher {
  private watches = new Map<string, WatchTarget>();
  private changes: WatchChange[] = [];
  private nextId = 1;
  private maxChanges = 100;

  /** Add a URL to watch list */
  addWatch(url: string, sessionId: string, initialSnapshot: string): WatchTarget {
    const id = `watch-${this.nextId++}`;
    const target: WatchTarget = {
      id,
      url,
      sessionId,
      lastSnapshot: initialSnapshot,
      lastCheckedAt: Date.now(),
      changeCount: 0,
      createdAt: Date.now(),
    };
    this.watches.set(id, target);
    return target;
  }

  /** Remove a watch */
  removeWatch(id: string): boolean {
    return this.watches.delete(id);
  }

  /** List all active watches */
  listWatches(): WatchTarget[] {
    return Array.from(this.watches.values());
  }

  /** Check a specific watch for changes */
  checkWatch(id: string, newSnapshot: string): WatchChange | null {
    const target = this.watches.get(id);
    if (!target) return null;

    const diff = snapshotDiff(target.lastSnapshot, newSnapshot);
    target.lastCheckedAt = Date.now();

    if (diff.added.length === 0 && diff.removed.length === 0) {
      return null; // No changes
    }

    target.changeCount++;
    target.lastSnapshot = newSnapshot;

    const change: WatchChange = {
      watchId: id,
      url: target.url,
      diff,
      detectedAt: Date.now(),
    };

    if (this.changes.length >= this.maxChanges) {
      this.changes.shift();
    }
    this.changes.push(change);

    return change;
  }

  /** Get recent changes (drains buffer) */
  getRecentChanges(): WatchChange[] {
    const result = [...this.changes];
    this.changes = [];
    return result;
  }

  /** Get watch by ID */
  getWatch(id: string): WatchTarget | undefined {
    return this.watches.get(id);
  }
}
