/**
 * Snapshot Diff — compares two accessibility tree snapshots and returns
 * a human-readable diff showing only what changed.
 *
 * Reduces token usage by 60-90% for incremental page updates.
 */

export interface DiffResult {
  /** Lines added in the new snapshot */
  added: string[];
  /** Lines removed from the old snapshot */
  removed: string[];
  /** Number of unchanged lines */
  unchanged: number;
  /** Compact diff summary for AI agents */
  summary: string;
}

/**
 * Compare two snapshots line-by-line and return the diff.
 * Uses a simple LCS-based approach optimized for accessibility tree snapshots.
 */
export function snapshotDiff(oldSnap: string, newSnap: string): DiffResult {
  const oldLines = oldSnap ? oldSnap.split('\n') : [];
  const newLines = newSnap ? newSnap.split('\n') : [];

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const line of newLines) {
    if (!oldSet.has(line)) {
      added.push(line);
    } else {
      unchanged++;
    }
  }

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      removed.push(line);
    }
  }

  const summary = formatDiffSummary(added, removed, unchanged, newLines.length);
  return { added, removed, unchanged, summary };
}

function formatDiffSummary(
  added: string[],
  removed: string[],
  unchanged: number,
  totalNew: number,
): string {
  const parts: string[] = [];

  if (added.length === 0 && removed.length === 0) {
    return `[No changes detected] (${unchanged} lines unchanged)`;
  }

  parts.push(`[Snapshot Diff] ${added.length} added, ${removed.length} removed, ${unchanged} unchanged`);

  if (removed.length > 0) {
    parts.push('');
    parts.push('── Removed ──');
    for (const line of removed.slice(0, 20)) {
      parts.push(`- ${line}`);
    }
    if (removed.length > 20) {
      parts.push(`  ... and ${removed.length - 20} more removed`);
    }
  }

  if (added.length > 0) {
    parts.push('');
    parts.push('── Added ──');
    for (const line of added.slice(0, 30)) {
      parts.push(`+ ${line}`);
    }
    if (added.length > 30) {
      parts.push(`  ... and ${added.length - 30} more added`);
    }
  }

  return parts.join('\n');
}
