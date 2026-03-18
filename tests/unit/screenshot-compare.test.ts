import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compareScreenshots, screenshotHash } from '../../src/utils/screenshot-compare';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpDir = path.join(os.tmpdir(), 'aly-screenshot-test');

describe('screenshot-compare', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTmp(name: string, content: Buffer): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  describe('compareScreenshots', () => {
    it('returns identical=true for same file content', () => {
      const buf = Buffer.from('PNG-fake-identical-content-here');
      const a = writeTmp('same1.png', buf);
      const b = writeTmp('same2.png', buf);
      const result = compareScreenshots(a, b);
      expect(result.identical).toBe(true);
      expect(result.similarity).toBe(100);
      expect(result.hashA).toBe(result.hashB);
    });

    it('detects different files', () => {
      const a = writeTmp('diff1.png', Buffer.from('AAAA'));
      const b = writeTmp('diff2.png', Buffer.from('BBBB'));
      const result = compareScreenshots(a, b);
      expect(result.identical).toBe(false);
      expect(result.similarity).toBeLessThan(100);
    });

    it('computes byte-level similarity', () => {
      const a = writeTmp('sim1.png', Buffer.from('ABCDEFGH'));
      const b = writeTmp('sim2.png', Buffer.from('ABCDXXXX'));
      const result = compareScreenshots(a, b);
      expect(result.similarity).toBe(50); // 4 of 8 match
    });

    it('handles different sized files', () => {
      const a = writeTmp('size1.png', Buffer.from('SHORT'));
      const b = writeTmp('size2.png', Buffer.from('MUCH LONGER CONTENT'));
      const result = compareScreenshots(a, b);
      expect(result.identical).toBe(false);
      expect(result.sizeA).toBeLessThan(result.sizeB);
    });

    it('throws for missing file A', () => {
      const b = writeTmp('exists.png', Buffer.from('data'));
      expect(() => compareScreenshots('/nonexistent/path.png', b)).toThrow('File not found');
    });

    it('throws for missing file B', () => {
      const a = writeTmp('exists2.png', Buffer.from('data'));
      expect(() => compareScreenshots(a, '/nonexistent/path.png')).toThrow('File not found');
    });

    it('returns correct file sizes', () => {
      const a = writeTmp('sz1.png', Buffer.alloc(100, 'x'));
      const b = writeTmp('sz2.png', Buffer.alloc(200, 'y'));
      const result = compareScreenshots(a, b);
      expect(result.sizeA).toBe(100);
      expect(result.sizeB).toBe(200);
    });
  });

  describe('screenshotHash', () => {
    it('returns consistent hash for same content', () => {
      const p = writeTmp('hash1.png', Buffer.from('test-content'));
      expect(screenshotHash(p)).toBe(screenshotHash(p));
    });

    it('returns different hash for different content', () => {
      const a = writeTmp('hashA.png', Buffer.from('content-A'));
      const b = writeTmp('hashB.png', Buffer.from('content-B'));
      expect(screenshotHash(a)).not.toBe(screenshotHash(b));
    });

    it('returns 16-char hex string', () => {
      const p = writeTmp('hashLen.png', Buffer.from('data'));
      expect(screenshotHash(p)).toMatch(/^[0-9a-f]{16}$/);
    });

    it('throws for missing file', () => {
      expect(() => screenshotHash('/nonexistent.png')).toThrow('File not found');
    });
  });
});
