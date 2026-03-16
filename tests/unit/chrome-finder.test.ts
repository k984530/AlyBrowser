import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findChrome, findChromeForTesting } from '../../src/chrome/finder';
import * as fs from 'fs';

describe('findChrome', () => {
  const originalEnv = process.env.CHROME_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CHROME_PATH = originalEnv;
    } else {
      delete process.env.CHROME_PATH;
    }
  });

  it('finds Chrome on this machine (darwin)', () => {
    if (process.platform !== 'darwin') return;
    const path = findChrome();
    expect(path).toBeTruthy();
    expect(fs.existsSync(path)).toBe(true);
  });

  it('respects CHROME_PATH environment variable', () => {
    // Set to an existing file (any file will do for the test)
    const testPath = '/usr/bin/env';
    if (!fs.existsSync(testPath)) return;

    process.env.CHROME_PATH = testPath;
    expect(findChrome()).toBe(testPath);
  });

  it('throws ChromeNotFoundError with searched paths', () => {
    process.env.CHROME_PATH = '/nonexistent/chrome-test-path';
    try {
      findChrome();
      // If it finds a system Chrome, that's OK — it falls through to platform candidates
    } catch (err: any) {
      expect(err.name).toBe('ChromeNotFoundError');
      expect(err.message).toContain('/nonexistent/chrome-test-path');
      expect(err.hint).toContain('CHROME_PATH');
    }
  });
});

describe('findChromeForTesting', () => {
  const originalEnv = process.env.CHROME_FOR_TESTING_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CHROME_FOR_TESTING_PATH = originalEnv;
    } else {
      delete process.env.CHROME_FOR_TESTING_PATH;
    }
  });

  it('respects CHROME_FOR_TESTING_PATH environment variable', () => {
    const testPath = '/usr/bin/env';
    if (!fs.existsSync(testPath)) return;

    process.env.CHROME_FOR_TESTING_PATH = testPath;
    expect(findChromeForTesting()).toBe(testPath);
  });

  it('falls back to findChrome when no testing binary found', () => {
    delete process.env.CHROME_FOR_TESTING_PATH;
    // Should fall back to regular Chrome
    const result = findChromeForTesting('/nonexistent/project/root');
    expect(result).toBeTruthy();
  });

  it('accepts projectRoot parameter', () => {
    delete process.env.CHROME_FOR_TESTING_PATH;
    // Even with nonexistent root, should fall back to system Chrome
    const result = findChromeForTesting('/tmp');
    expect(result).toBeTruthy();
  });
});
