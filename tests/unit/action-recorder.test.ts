import { describe, it, expect } from 'vitest';
import { ActionRecorder } from '../../src/mcp/action-recorder';

describe('ActionRecorder', () => {
  it('start creates a recording with navigate action', () => {
    const ar = new ActionRecorder();
    const rec = ar.start('test', 'https://example.com');
    expect(rec.id).toMatch(/^rec-/);
    expect(rec.name).toBe('test');
    expect(rec.actions).toHaveLength(1);
    expect(rec.actions[0].action).toBe('navigate');
  });

  it('record adds actions while recording', () => {
    const ar = new ActionRecorder();
    ar.start('test', 'https://example.com');
    ar.record('click', '@e1');
    ar.record('type', '@e2', 'hello');
    ar.record('snapshot');
    const rec = ar.get(ar.getActiveId()!);
    expect(rec!.actions).toHaveLength(4); // navigate + 3
  });

  it('record ignores when not recording', () => {
    const ar = new ActionRecorder();
    ar.record('click', '@e1');
    expect(ar.list()).toHaveLength(0);
  });

  it('stop ends recording', () => {
    const ar = new ActionRecorder();
    ar.start('test', 'https://example.com');
    expect(ar.isRecording()).toBe(true);
    const rec = ar.stop();
    expect(ar.isRecording()).toBe(false);
    expect(rec!.stoppedAt).toBeDefined();
  });

  it('stop returns null when not recording', () => {
    const ar = new ActionRecorder();
    expect(ar.stop()).toBeNull();
  });

  it('list returns all recordings', () => {
    const ar = new ActionRecorder();
    ar.start('first', 'https://a.com');
    ar.stop();
    ar.start('second', 'https://b.com');
    ar.stop();
    expect(ar.list()).toHaveLength(2);
  });

  it('delete removes a recording', () => {
    const ar = new ActionRecorder();
    const rec = ar.start('test', 'https://example.com');
    ar.stop();
    expect(ar.delete(rec.id)).toBe(true);
    expect(ar.list()).toHaveLength(0);
  });

  it('delete returns false for unknown id', () => {
    const ar = new ActionRecorder();
    expect(ar.delete('nonexistent')).toBe(false);
  });

  it('export returns JSON string', () => {
    const ar = new ActionRecorder();
    const rec = ar.start('test', 'https://example.com');
    ar.record('click', '@e0');
    ar.stop();
    const json = ar.export(rec.id);
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!);
    expect(parsed.name).toBe('test');
    expect(parsed.actions).toHaveLength(2);
  });

  it('export returns null for unknown id', () => {
    const ar = new ActionRecorder();
    expect(ar.export('nope')).toBeNull();
  });

  it('import restores a recording', () => {
    const ar = new ActionRecorder();
    const rec = ar.start('original', 'https://test.com');
    ar.record('type', '@e1', 'data');
    ar.stop();
    const json = ar.export(rec.id)!;

    const ar2 = new ActionRecorder();
    const imported = ar2.import(json);
    expect(imported.name).toBe('original');
    expect(imported.actions).toHaveLength(2);
    expect(ar2.list()).toHaveLength(1);
  });

  it('assigns unique IDs', () => {
    const ar = new ActionRecorder();
    const r1 = ar.start('a', 'https://a.com');
    ar.stop();
    const r2 = ar.start('b', 'https://b.com');
    expect(r1.id).not.toBe(r2.id);
  });

  it('getActiveId returns null when not recording', () => {
    const ar = new ActionRecorder();
    expect(ar.getActiveId()).toBeNull();
  });

  it('get returns undefined for unknown id', () => {
    const ar = new ActionRecorder();
    expect(ar.get('bad')).toBeUndefined();
  });

  it('delete active recording clears activeRecording', () => {
    const ar = new ActionRecorder();
    const rec = ar.start('test', 'https://example.com');
    ar.delete(rec.id);
    expect(ar.isRecording()).toBe(false);
  });
});
