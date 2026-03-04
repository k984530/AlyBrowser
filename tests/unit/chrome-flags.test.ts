import { describe, it, expect } from 'vitest';
import { getDefaultFlags } from '../../src/chrome/flags';

describe('getDefaultFlags', () => {
  it('returns an array of strings', () => {
    const flags = getDefaultFlags();
    expect(Array.isArray(flags)).toBe(true);
    expect(flags.length).toBeGreaterThan(10);
    for (const flag of flags) {
      expect(flag).toMatch(/^--/);
    }
  });

  it('includes headless flag by default', () => {
    const flags = getDefaultFlags();
    expect(flags).toContain('--headless=new');
  });

  it('includes headless flag when explicitly true', () => {
    const flags = getDefaultFlags({ headless: true });
    expect(flags).toContain('--headless=new');
  });

  it('excludes headless flag when false', () => {
    const flags = getDefaultFlags({ headless: false });
    expect(flags).not.toContain('--headless=new');
  });

  it('includes essential automation flags', () => {
    const flags = getDefaultFlags();
    expect(flags).toContain('--no-first-run');
    expect(flags).toContain('--disable-extensions');
    expect(flags).toContain('--disable-dev-shm-usage');
  });
});
