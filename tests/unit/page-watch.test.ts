import { describe, it, expect } from 'vitest';
import { PageWatcher } from '../../src/mcp/page-watch';

describe('PageWatcher', () => {
  const snap1 = '[RootWebArea] "Page"\n  [button] @e0 "Click"';
  const snap2 = '[RootWebArea] "Page"\n  [button] @e0 "Click"\n  [link] @e1 "New Link"';

  it('addWatch creates a watch target', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://example.com', 'default', snap1);
    expect(watch.id).toMatch(/^watch-/);
    expect(watch.url).toBe('https://example.com');
    expect(watch.changeCount).toBe(0);
  });

  it('listWatches returns all active watches', () => {
    const pw = new PageWatcher();
    pw.addWatch('https://a.com', 'default', snap1);
    pw.addWatch('https://b.com', 'default', snap1);
    expect(pw.listWatches()).toHaveLength(2);
  });

  it('removeWatch deletes a watch', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://a.com', 'default', snap1);
    expect(pw.removeWatch(watch.id)).toBe(true);
    expect(pw.listWatches()).toHaveLength(0);
  });

  it('removeWatch returns false for unknown id', () => {
    const pw = new PageWatcher();
    expect(pw.removeWatch('nonexistent')).toBe(false);
  });

  it('checkWatch detects changes', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://example.com', 'default', snap1);
    const change = pw.checkWatch(watch.id, snap2);
    expect(change).not.toBeNull();
    expect(change!.diff.added.length).toBeGreaterThan(0);
    expect(change!.url).toBe('https://example.com');
  });

  it('checkWatch returns null when no changes', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://example.com', 'default', snap1);
    const change = pw.checkWatch(watch.id, snap1);
    expect(change).toBeNull();
  });

  it('checkWatch increments changeCount', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://example.com', 'default', snap1);
    pw.checkWatch(watch.id, snap2);
    expect(pw.getWatch(watch.id)!.changeCount).toBe(1);
  });

  it('checkWatch updates lastSnapshot', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://example.com', 'default', snap1);
    pw.checkWatch(watch.id, snap2);
    // Second check with same snap2 should show no changes
    const change = pw.checkWatch(watch.id, snap2);
    expect(change).toBeNull();
  });

  it('checkWatch returns null for unknown id', () => {
    const pw = new PageWatcher();
    expect(pw.checkWatch('bad-id', snap1)).toBeNull();
  });

  it('getRecentChanges drains buffer', () => {
    const pw = new PageWatcher();
    const watch = pw.addWatch('https://example.com', 'default', snap1);
    pw.checkWatch(watch.id, snap2);
    const changes = pw.getRecentChanges();
    expect(changes).toHaveLength(1);
    // Second call should be empty
    expect(pw.getRecentChanges()).toHaveLength(0);
  });

  it('getWatch returns undefined for unknown id', () => {
    const pw = new PageWatcher();
    expect(pw.getWatch('nope')).toBeUndefined();
  });

  it('assigns unique IDs', () => {
    const pw = new PageWatcher();
    const w1 = pw.addWatch('https://a.com', 'default', snap1);
    const w2 = pw.addWatch('https://b.com', 'default', snap1);
    expect(w1.id).not.toBe(w2.id);
  });
});
