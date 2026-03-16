import { describe, it, expect } from 'vitest';
import { Deferred } from '../../src/utils/deferred';

describe('Deferred', () => {
  it('resolves with a value', async () => {
    const d = new Deferred<number>();
    d.resolve(42);
    expect(await d.promise).toBe(42);
  });

  it('rejects with an error', async () => {
    const d = new Deferred<string>();
    d.reject(new Error('fail'));
    await expect(d.promise).rejects.toThrow('fail');
  });

  it('resolves only once (first value wins)', async () => {
    const d = new Deferred<number>();
    d.resolve(1);
    d.resolve(2);
    expect(await d.promise).toBe(1);
  });

  it('can be awaited after resolution', async () => {
    const d = new Deferred<string>();
    d.resolve('done');
    // Await multiple times
    expect(await d.promise).toBe('done');
    expect(await d.promise).toBe('done');
  });
});
