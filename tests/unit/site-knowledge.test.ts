import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteKnowledge } from '../../src/mcp/site-knowledge';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SiteKnowledge', () => {
  let sk: SiteKnowledge;
  const baseDir = path.join(os.homedir(), '.aly-browser', 'site-knowledge');

  // Clean test domain files before/after
  const testDomain = 'test-sk-example.com';
  const cleanupFile = () => {
    const fp = path.join(baseDir, `${testDomain}.json`);
    try { fs.unlinkSync(fp); } catch {}
  };

  beforeEach(() => {
    cleanupFile();
    sk = new SiteKnowledge();
  });

  afterEach(() => {
    cleanupFile();
  });

  it('adds and queries entries', () => {
    sk.add(`https://${testDomain}/page`, 'click', 'success', 'worked');
    const entries = sk.query(`https://${testDomain}/page`);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('click');
    expect(entries[0].result).toBe('success');
    expect(entries[0].note).toBe('worked');
  });

  it('deduplicates identical entries', () => {
    sk.add(`https://${testDomain}/page`, 'click', 'success', 'worked');
    sk.add(`https://${testDomain}/page`, 'click', 'success', 'worked');
    const entries = sk.query(`https://${testDomain}/page`);
    expect(entries).toHaveLength(1);
  });

  it('allows different actions for same URL', () => {
    sk.add(`https://${testDomain}/page`, 'click', 'success', 'ok');
    sk.add(`https://${testDomain}/page`, 'type', 'fail', 'timeout');
    const entries = sk.query(`https://${testDomain}/page`);
    expect(entries).toHaveLength(2);
  });

  it('matches parent path entries', () => {
    sk.add(`https://${testDomain}/`, 'navigate', 'success', 'root');
    sk.add(`https://${testDomain}/settings`, 'click', 'fail', 'broken');
    // Querying /settings/profile should match both / and /settings
    const entries = sk.query(`https://${testDomain}/settings/profile`);
    expect(entries).toHaveLength(2);
  });

  it('strips www prefix from domain', () => {
    sk.add(`https://www.${testDomain}/page`, 'click', 'success', 'ok');
    const entries = sk.query(`https://${testDomain}/page`);
    expect(entries).toHaveLength(1);
  });

  it('normalizes trailing slashes', () => {
    sk.add(`https://${testDomain}/page/`, 'click', 'success', 'ok');
    const entries = sk.query(`https://${testDomain}/page`);
    expect(entries).toHaveLength(1);
  });

  it('persists to disk', () => {
    sk.add(`https://${testDomain}/page`, 'click', 'success', 'persisted');
    // Create a new instance to test disk persistence
    const sk2 = new SiteKnowledge();
    const entries = sk2.query(`https://${testDomain}/page`);
    expect(entries).toHaveLength(1);
    expect(entries[0].note).toBe('persisted');
  });

  describe('formatForContext', () => {
    it('returns null when no entries', () => {
      expect(sk.formatForContext(`https://${testDomain}/none`)).toBeNull();
    });

    it('returns formatted entries', () => {
      sk.add(`https://${testDomain}/page`, 'click', 'fail', 'button hidden');
      const result = sk.formatForContext(`https://${testDomain}/page`);
      expect(result).toContain('[Site Knowledge]');
      expect(result).toContain(testDomain);
      expect(result).toContain('(fail) click: button hidden');
    });
  });

  describe('formatCompact', () => {
    it('returns null when no entries', () => {
      expect(sk.formatCompact(`https://${testDomain}/none`)).toBeNull();
    });

    it('uses checkmark/cross symbols', () => {
      sk.add(`https://${testDomain}/page`, 'click', 'success', 'ok');
      sk.add(`https://${testDomain}/page`, 'type', 'fail', 'error');
      const result = sk.formatCompact(`https://${testDomain}/page`);
      expect(result).toContain('✓ click: ok');
      expect(result).toContain('✗ type: error');
    });
  });

  describe('corruption recovery', () => {
    it('recovers from corrupted JSON file', () => {
      const fp = path.join(baseDir, `${testDomain}.json`);
      // Write corrupted JSON
      fs.writeFileSync(fp, '{invalid json!!!');
      // New instance should handle corruption gracefully
      const sk2 = new SiteKnowledge();
      const entries = sk2.query(`https://${testDomain}/page`);
      expect(entries).toHaveLength(0);
      // Backup file should have been created
      expect(fs.existsSync(fp + '.bak')).toBe(true);
      // Clean up backup
      try { fs.unlinkSync(fp + '.bak'); } catch {}
    });

    it('can write after recovering from corruption', () => {
      const fp = path.join(baseDir, `${testDomain}.json`);
      fs.writeFileSync(fp, 'CORRUPT');
      const sk2 = new SiteKnowledge();
      // Should be able to add entries after recovery
      sk2.add(`https://${testDomain}/page`, 'click', 'success', 'recovered');
      const entries = sk2.query(`https://${testDomain}/page`);
      expect(entries).toHaveLength(1);
      expect(entries[0].note).toBe('recovered');
      try { fs.unlinkSync(fp + '.bak'); } catch {}
    });
  });

  describe('URL edge cases', () => {
    it('handles URLs without protocol', () => {
      sk.add(`${testDomain}/page`, 'click', 'success', 'no-proto');
      const entries = sk.query(`https://${testDomain}/page`);
      expect(entries).toHaveLength(1);
    });

    it('handles root path entries', () => {
      sk.add(`https://${testDomain}/`, 'navigate', 'success', 'root');
      // Root entry should match any path on the domain
      const entries = sk.query(`https://${testDomain}/any/deep/path`);
      expect(entries).toHaveLength(1);
    });

    it('stores timestamp as YYYY-MM-DD', () => {
      sk.add(`https://${testDomain}/page`, 'click', 'success', 'ts-test');
      const entries = sk.query(`https://${testDomain}/page`);
      expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('formatForContext with many entries', () => {
    it('limits to 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        sk.add(`https://${testDomain}/page`, `action-${i}`, 'success', `note-${i}`);
      }
      const result = sk.formatForContext(`https://${testDomain}/page`)!;
      expect(result).toContain('showing last 20 of 25');
      // Should only contain the last 20 entries (action-5 through action-24)
      expect(result).not.toContain('action-4:');
      expect(result).toContain('action-24');
    });
  });

  describe('formatCompact with many entries', () => {
    it('limits to 5 entries and shows +N more', () => {
      for (let i = 0; i < 8; i++) {
        sk.add(`https://${testDomain}/page`, `action-${i}`, 'success', `note-${i}`);
      }
      const result = sk.formatCompact(`https://${testDomain}/page`)!;
      expect(result).toContain('+3 more');
    });
  });

  describe('hasDomain / hasPath', () => {
    it('hasDomain returns true when entries exist', () => {
      sk.add(`https://${testDomain}/page`, 'click', 'success', 'ok');
      expect(sk.hasDomain(`https://${testDomain}/other`)).toBe(true);
    });

    it('hasDomain returns false for unknown domain', () => {
      expect(sk.hasDomain('https://unknown-domain-xyz.com/')).toBe(false);
    });

    it('hasPath returns true for matching path', () => {
      sk.add(`https://${testDomain}/settings`, 'click', 'success', 'ok');
      expect(sk.hasPath(`https://${testDomain}/settings/profile`)).toBe(true);
    });

    it('hasPath returns false for non-matching path', () => {
      sk.add(`https://${testDomain}/settings`, 'click', 'success', 'ok');
      expect(sk.hasPath(`https://${testDomain}/account`)).toBe(false);
    });
  });
});
