import { describe, it, expect } from 'vitest';
import { getDomFilterScript } from '../../src/dom/filter';

describe('getDomFilterScript', () => {
  it('returns a non-empty string', () => {
    const script = getDomFilterScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('contains removal logic for script tags', () => {
    const script = getDomFilterScript();
    expect(script).toContain('script');
    expect(script).toContain('style');
    expect(script).toContain('noscript');
  });

  it('contains aria-hidden removal', () => {
    const script = getDomFilterScript();
    expect(script).toContain('aria-hidden');
  });

  it('returns innerHTML', () => {
    const script = getDomFilterScript();
    expect(script).toContain('document.body.innerHTML');
  });
});
