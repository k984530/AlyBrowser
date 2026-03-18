import { describe, it, expect } from 'vitest';
import { snapshotDiff, type DiffResult } from '../../src/utils/snapshot-diff';

describe('snapshotDiff', () => {
  it('detects no changes for identical snapshots', () => {
    const snap = '[RootWebArea] "Test"\n  [button] @e0 "Click"';
    const result = snapshotDiff(snap, snap);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.unchanged).toBe(2);
    expect(result.summary).toContain('No changes detected');
  });

  it('detects added lines', () => {
    const old = '[RootWebArea] "Test"\n  [button] @e0 "Click"';
    const newSnap = '[RootWebArea] "Test"\n  [button] @e0 "Click"\n  [textbox] @e1 "New input"';
    const result = snapshotDiff(old, newSnap);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toContain('New input');
    expect(result.removed).toHaveLength(0);
    expect(result.summary).toContain('1 added');
  });

  it('detects removed lines', () => {
    const old = '[RootWebArea] "Test"\n  [button] @e0 "Click"\n  [textbox] @e1 "Old input"';
    const newSnap = '[RootWebArea] "Test"\n  [button] @e0 "Click"';
    const result = snapshotDiff(old, newSnap);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]).toContain('Old input');
    expect(result.summary).toContain('1 removed');
  });

  it('detects both added and removed', () => {
    const old = '[RootWebArea] "Page A"\n  [link] @e0 "Home"';
    const newSnap = '[RootWebArea] "Page B"\n  [button] @e0 "Submit"';
    const result = snapshotDiff(old, newSnap);
    expect(result.added.length).toBeGreaterThan(0);
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.summary).toContain('added');
    expect(result.summary).toContain('removed');
  });

  it('handles empty old snapshot', () => {
    const result = snapshotDiff('', '[RootWebArea] "New"');
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  it('handles empty new snapshot', () => {
    const result = snapshotDiff('[RootWebArea] "Old"', '');
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
  });

  it('handles both empty', () => {
    const result = snapshotDiff('', '');
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.summary).toContain('No changes');
  });

  it('handles null inputs', () => {
    const result = snapshotDiff(null, null);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('handles undefined inputs', () => {
    const result = snapshotDiff(undefined, 'new content');
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  it('counts unchanged lines correctly', () => {
    const old = 'line1\nline2\nline3\nline4\nline5';
    const newSnap = 'line1\nline2\nline3\nline6\nline7';
    const result = snapshotDiff(old, newSnap);
    expect(result.unchanged).toBe(3); // line1, line2, line3
    expect(result.added).toHaveLength(2); // line6, line7
    expect(result.removed).toHaveLength(2); // line4, line5
  });

  it('summary includes Removed section with - prefix', () => {
    const result = snapshotDiff('old line', 'new line');
    expect(result.summary).toContain('── Removed ──');
    expect(result.summary).toContain('- old line');
  });

  it('summary includes Added section with + prefix', () => {
    const result = snapshotDiff('old line', 'new line');
    expect(result.summary).toContain('── Added ──');
    expect(result.summary).toContain('+ new line');
  });

  it('truncates long removed lists at 20', () => {
    const oldLines = Array.from({ length: 30 }, (_, i) => `removed-${i}`).join('\n');
    const result = snapshotDiff(oldLines, 'single new');
    expect(result.summary).toContain('... and');
    expect(result.summary).toContain('more removed');
  });

  it('truncates long added lists at 30', () => {
    const newLines = Array.from({ length: 40 }, (_, i) => `added-${i}`).join('\n');
    const result = snapshotDiff('single old', newLines);
    expect(result.summary).toContain('... and');
    expect(result.summary).toContain('more added');
  });

  it('handles real-world snapshot format', () => {
    const old = `[RootWebArea] "Login"
  [heading] "Welcome"
  [form]
    [textbox] @e0 "Email" [required]
    [textbox] @e1 [required]
    [button] @e2 "Sign In"`;

    const newSnap = `[RootWebArea] "Dashboard"
  [heading] "Welcome back"
  [navigation]
    [link] @e0 "Home"
    [link] @e1 "Settings"
  [main]
    [heading] "Your Projects"`;

    const result = snapshotDiff(old, newSnap);
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.added.length).toBeGreaterThan(0);
    // Only common line is likely none since page completely changed
    expect(result.summary).toContain('Snapshot Diff');
  });
});
