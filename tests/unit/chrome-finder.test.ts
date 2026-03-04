import { describe, it, expect } from 'vitest';
import { findChrome } from '../../src/chrome/finder';

describe('findChrome', () => {
  it('finds a Chrome executable on this system', () => {
    // This test assumes Chrome is installed on the test machine
    // If not installed, it will throw ChromeNotFoundError
    try {
      const chromePath = findChrome();
      expect(typeof chromePath).toBe('string');
      expect(chromePath.length).toBeGreaterThan(0);
    } catch (err: any) {
      // Skip if Chrome is not installed
      if (err.name === 'ChromeNotFoundError') {
        console.log('Chrome not found, skipping test');
        return;
      }
      throw err;
    }
  });
});
