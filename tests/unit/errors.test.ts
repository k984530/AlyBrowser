import { describe, it, expect } from 'vitest';
import {
  AlyBrowserError,
  ChromeNotFoundError,
  CDPTimeoutError,
  ElementNotFoundError,
} from '../../src/cdp/errors';

describe('Error classes', () => {
  it('AlyBrowserError has name, message, and hint', () => {
    const err = new AlyBrowserError('test error', 'try this');
    expect(err.name).toBe('AlyBrowserError');
    expect(err.message).toBe('test error');
    expect(err.hint).toBe('try this');
  });

  it('AlyBrowserError is JSON-serializable', () => {
    const err = new AlyBrowserError('test', 'hint');
    const json = JSON.parse(JSON.stringify(err));
    expect(json.name).toBe('AlyBrowserError');
    expect(json.message).toBe('test');
    expect(json.hint).toBe('hint');
  });

  it('ChromeNotFoundError includes searched paths', () => {
    const err = new ChromeNotFoundError(['/path/a', '/path/b']);
    expect(err.name).toBe('ChromeNotFoundError');
    expect(err.message).toContain('/path/a');
    expect(err.message).toContain('/path/b');
    expect(err.hint).toContain('CHROME_PATH');
  });

  it('CDPTimeoutError includes method and timeout', () => {
    const err = new CDPTimeoutError('Page.navigate', 30000);
    expect(err.name).toBe('CDPTimeoutError');
    expect(err.message).toContain('Page.navigate');
    expect(err.message).toContain('30000');
  });

  it('ElementNotFoundError includes ref and hint', () => {
    const err = new ElementNotFoundError('@e5');
    expect(err.name).toBe('ElementNotFoundError');
    expect(err.message).toContain('@e5');
    expect(err.hint).toContain('snapshot()');
  });

  it('all errors extend AlyBrowserError', () => {
    expect(new ChromeNotFoundError([])).toBeInstanceOf(AlyBrowserError);
    expect(new CDPTimeoutError('x', 1)).toBeInstanceOf(AlyBrowserError);
    expect(new ElementNotFoundError('@e1')).toBeInstanceOf(AlyBrowserError);
  });
});
