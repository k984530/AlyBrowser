import { describe, it, expect } from 'vitest';
import { AlyBrowserError, ChromeNotFoundError } from '../../src/errors';

describe('AlyBrowserError', () => {
  it('has correct name and message', () => {
    const err = new AlyBrowserError('something broke');
    expect(err.name).toBe('AlyBrowserError');
    expect(err.message).toBe('something broke');
    expect(err.hint).toBeUndefined();
  });

  it('stores hint', () => {
    const err = new AlyBrowserError('oops', 'try this');
    expect(err.hint).toBe('try this');
  });

  it('serializes to JSON', () => {
    const err = new AlyBrowserError('msg', 'hint');
    const json = err.toJSON();
    expect(json.name).toBe('AlyBrowserError');
    expect(json.message).toBe('msg');
    expect(json.hint).toBe('hint');
    expect(json.stack).toBeDefined();
  });

  it('is instanceof Error', () => {
    const err = new AlyBrowserError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ChromeNotFoundError', () => {
  it('lists searched paths in message', () => {
    const err = new ChromeNotFoundError(['/usr/bin/chrome', '/opt/chrome']);
    expect(err.message).toContain('/usr/bin/chrome');
    expect(err.message).toContain('/opt/chrome');
    expect(err.name).toBe('ChromeNotFoundError');
  });

  it('provides hint about CHROME_PATH', () => {
    const err = new ChromeNotFoundError([]);
    expect(err.hint).toContain('CHROME_PATH');
  });

  it('is instanceof AlyBrowserError', () => {
    const err = new ChromeNotFoundError([]);
    expect(err).toBeInstanceOf(AlyBrowserError);
  });
});
