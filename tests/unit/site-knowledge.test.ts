import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteKnowledge, redactSensitive } from '../../src/mcp/site-knowledge';
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

  // ── Sensitive Data Filtering ──────────────────────────────────

  describe('sensitive data filtering', () => {
    it('redacts password patterns in note', () => {
      sk.add(`https://${testDomain}/login`, 'type', 'success', 'password: mySecret123');
      const entries = sk.query(`https://${testDomain}/login`);
      expect(entries[0].note).not.toContain('mySecret123');
      expect(entries[0].note).toContain('[REDACTED]');
    });

    it('redacts password patterns in action', () => {
      sk.add(`https://${testDomain}/login`, 'typed pwd=abc123 in field', 'success', 'ok');
      const entries = sk.query(`https://${testDomain}/login`);
      expect(entries[0].action).not.toContain('abc123');
      expect(entries[0].action).toContain('[REDACTED]');
    });

    it('redacts API key patterns', () => {
      sk.add(`https://${testDomain}/api`, 'call', 'fail', 'api_key=sk_live_abc123def456');
      const entries = sk.query(`https://${testDomain}/api`);
      expect(entries[0].note).not.toContain('sk_live_abc123def456');
    });

    it('redacts Bearer tokens', () => {
      sk.add(`https://${testDomain}/api`, 'fetch', 'success', 'used Bearer eyJhbGciOiJIUz.payload.sig');
      const entries = sk.query(`https://${testDomain}/api`);
      expect(entries[0].note).not.toContain('eyJhbGciOiJIUz');
    });

    it('redacts JWT-like strings', () => {
      sk.add(`https://${testDomain}/auth`, 'login', 'success', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
      const entries = sk.query(`https://${testDomain}/auth`);
      expect(entries[0].note).not.toContain('eyJzdWIiOiIxMjM0NTY3ODkwIn0');
    });

    it('redacts long hex strings (potential secrets)', () => {
      sk.add(`https://${testDomain}/config`, 'read', 'success', 'key was a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
      const entries = sk.query(`https://${testDomain}/config`);
      expect(entries[0].note).not.toContain('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    });

    it('preserves non-sensitive text', () => {
      sk.add(`https://${testDomain}/page`, 'click login button', 'success', 'redirected to dashboard');
      const entries = sk.query(`https://${testDomain}/page`);
      expect(entries[0].action).toBe('click login button');
      expect(entries[0].note).toBe('redirected to dashboard');
    });

    it('redacts email:password combos', () => {
      sk.add(`https://${testDomain}/login`, 'type', 'success', 'user@example.com:secretPass');
      const entries = sk.query(`https://${testDomain}/login`);
      expect(entries[0].note).not.toContain('secretPass');
    });
  });

  // ── redactSensitive (unit) ─────────────────────────────────────

  describe('redactSensitive', () => {
    it('redacts password=value', () => {
      expect(redactSensitive('password=hunter2')).toContain('[REDACTED]');
      expect(redactSensitive('password=hunter2')).not.toContain('hunter2');
    });

    it('redacts secret: value', () => {
      expect(redactSensitive('secret: abc123')).toContain('[REDACTED]');
    });

    it('redacts token=value', () => {
      expect(redactSensitive('token=xyzzy')).toContain('[REDACTED]');
    });

    it('redacts Bearer tokens', () => {
      expect(redactSensitive('Authorization: Bearer abc123def')).toContain('[REDACTED]');
      expect(redactSensitive('Authorization: Bearer abc123def')).not.toContain('abc123def');
    });

    it('leaves safe text unchanged', () => {
      expect(redactSensitive('clicked the submit button')).toBe('clicked the submit button');
      expect(redactSensitive('page loaded in 2s')).toBe('page loaded in 2s');
    });

    it('handles empty string', () => {
      expect(redactSensitive('')).toBe('');
    });

    it('redacts multiple patterns in one string', () => {
      const result = redactSensitive('password=abc token=xyz');
      expect(result).not.toContain('abc');
      expect(result).not.toContain('xyz');
    });

    // Korean sensitive data patterns
    it('redacts Korean resident registration number (주민등록번호)', () => {
      const result = redactSensitive('주민번호 950101-1234567 입력');
      expect(result).not.toContain('950101-1234567');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts Korean passport number (여권번호)', () => {
      const result = redactSensitive('여권 M12345678 확인');
      expect(result).not.toContain('M12345678');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts Korean driver license number (운전면허번호)', () => {
      const result = redactSensitive('면허 12-34-567890-12 등록');
      expect(result).not.toContain('12-34-567890-12');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts Korean bank account number (계좌번호)', () => {
      const result = redactSensitive('계좌 110-123-456789 이체');
      expect(result).not.toContain('110-123-456789');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts Korean phone number (전화번호)', () => {
      const result = redactSensitive('연락처 010-1234-5678 입니다');
      expect(result).not.toContain('010-1234-5678');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts Korean landline number', () => {
      const result = redactSensitive('사무실 02-123-4567 전화');
      expect(result).not.toContain('02-123-4567');
      expect(result).toContain('[REDACTED]');
    });
  });

  // ── Encrypted Storage ──────────────────────────────────────────

  describe('encrypted storage', () => {
    it('stores data in encrypted format on disk', () => {
      sk.add(`https://${testDomain}/enc`, 'click', 'success', 'works');
      const fp = path.join(baseDir, `${testDomain}.json`);
      const raw = fs.readFileSync(fp, 'utf-8');
      // Encrypted content should NOT be valid JSON
      let isPlainJson = false;
      try { JSON.parse(raw); isPlainJson = true; } catch {}
      expect(isPlainJson).toBe(false);
    });

    it('loads encrypted data correctly on fresh instance', () => {
      sk.add(`https://${testDomain}/enc`, 'click', 'success', 'encrypted-test');

      // Create a new instance (simulates restart — reads from disk)
      const sk2 = new SiteKnowledge();
      const entries = sk2.query(`https://${testDomain}/enc`);
      expect(entries).toHaveLength(1);
      expect(entries[0].note).toBe('encrypted-test');
    });
  });
});
