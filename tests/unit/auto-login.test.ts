import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutoLoginManager, type LoginCredential } from '../../src/mcp/auto-login';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const baseDir = path.join(os.homedir(), '.aly-browser', 'auto-login');

describe('AutoLoginManager', () => {
  let mgr: AutoLoginManager;
  const cleanupFiles = () => {
    try { fs.unlinkSync(path.join(baseDir, 'credentials.enc')); } catch {}
    try { fs.unlinkSync(path.join(baseDir, 'credentials.enc.tmp')); } catch {}
  };

  beforeEach(() => {
    cleanupFiles();
    mgr = new AutoLoginManager();
  });

  afterEach(() => {
    cleanupFiles();
  });

  const sampleCredential: LoginCredential = {
    domain: 'example.com',
    loginUrl: 'https://example.com/login',
    steps: [
      { action: 'navigate', target: 'https://example.com/login' },
      { action: 'type', target: '@e1', value: 'user@test.com' },
      { action: 'type', target: '@e2', value: 'password123' },
      { action: 'click', target: '@e3' },
      { action: 'waitForStable', target: '' },
    ],
    sessionIndicators: ['session_id', 'auth_token'],
  };

  // ── Credential CRUD ──────────────────────────────────────

  describe('credential management', () => {
    it('adds and retrieves credential', () => {
      mgr.addCredential(sampleCredential);
      const cred = mgr.getCredential('example.com');
      expect(cred).toBeDefined();
      expect(cred!.loginUrl).toBe('https://example.com/login');
      expect(cred!.steps).toHaveLength(5);
    });

    it('lists registered domains', () => {
      mgr.addCredential(sampleCredential);
      mgr.addCredential({ ...sampleCredential, domain: 'other.com', loginUrl: 'https://other.com/login' });
      const domains = mgr.listDomains();
      expect(domains).toContain('example.com');
      expect(domains).toContain('other.com');
      expect(domains).toHaveLength(2);
    });

    it('removes credential', () => {
      mgr.addCredential(sampleCredential);
      expect(mgr.removeCredential('example.com')).toBe(true);
      expect(mgr.getCredential('example.com')).toBeUndefined();
    });

    it('removeCredential returns false for unknown domain', () => {
      expect(mgr.removeCredential('unknown.com')).toBe(false);
    });

    it('overwrites credential for same domain', () => {
      mgr.addCredential(sampleCredential);
      mgr.addCredential({ ...sampleCredential, loginUrl: 'https://example.com/signin' });
      const cred = mgr.getCredential('example.com');
      expect(cred!.loginUrl).toBe('https://example.com/signin');
    });
  });

  // ── Persistence ──────────────────────────────────────────

  describe('encrypted persistence', () => {
    it('persists credentials across instances', () => {
      mgr.addCredential(sampleCredential);

      const mgr2 = new AutoLoginManager();
      const cred = mgr2.getCredential('example.com');
      expect(cred).toBeDefined();
      expect(cred!.domain).toBe('example.com');
      expect(cred!.steps).toHaveLength(5);
    });

    it('stores credentials encrypted on disk', () => {
      mgr.addCredential(sampleCredential);
      const fp = path.join(baseDir, 'credentials.enc');
      const raw = fs.readFileSync(fp, 'utf-8');
      // Should NOT be parseable as JSON (encrypted)
      let isPlainJson = false;
      try { JSON.parse(raw); isPlainJson = true; } catch {}
      expect(isPlainJson).toBe(false);
    });
  });

  // ── Login State Cache ────────────────────────────────────

  describe('login state cache', () => {
    it('returns null for uncached domain', () => {
      expect(mgr.getCachedState('example.com')).toBeNull();
    });

    it('caches and retrieves login state', () => {
      mgr.updateState('example.com', true);
      const state = mgr.getCachedState('example.com');
      expect(state).toBeDefined();
      expect(state!.loggedIn).toBe(true);
      expect(state!.domain).toBe('example.com');
    });

    it('updates lastLoginAt on successful login', () => {
      mgr.addCredential(sampleCredential);
      const before = Date.now();
      mgr.updateState('example.com', true);
      const cred = mgr.getCredential('example.com');
      expect(cred!.lastLoginAt).toBeGreaterThanOrEqual(before);
    });

    it('does not set lastLoginAt when loggedIn is false', () => {
      // Use a completely fresh manager to avoid state from prior tests
      const freshMgr = new AutoLoginManager();
      const freshCred: LoginCredential = {
        domain: 'nologin.com',
        loginUrl: 'https://nologin.com/login',
        steps: [],
        sessionIndicators: ['sid'],
      };
      freshMgr.addCredential(freshCred);
      freshMgr.updateState('nologin.com', false);
      const cred = freshMgr.getCredential('nologin.com');
      expect(cred!.lastLoginAt).toBeUndefined();
      // Cleanup
      freshMgr.removeCredential('nologin.com');
    });
  });

  // ── SSO Chain ────────────────────────────────────────────

  describe('SSO chain resolution', () => {
    it('returns single domain when no SSO chain', () => {
      mgr.addCredential(sampleCredential);
      const chain = mgr.resolveLoginChain('example.com');
      expect(chain).toEqual(['example.com']);
    });

    it('resolves SSO chain in dependency order', () => {
      mgr.addCredential({
        domain: 'sso-provider.com',
        loginUrl: 'https://sso-provider.com/login',
        steps: [{ action: 'navigate', target: 'https://sso-provider.com/login' }],
        sessionIndicators: ['sso_token'],
      });
      mgr.addCredential({
        ...sampleCredential,
        ssoChain: 'sso-provider.com',
      });

      const chain = mgr.resolveLoginChain('example.com');
      expect(chain).toEqual(['sso-provider.com', 'example.com']);
    });

    it('handles 3-level SSO chain', () => {
      mgr.addCredential({
        domain: 'root.com',
        loginUrl: 'https://root.com/login',
        steps: [],
        sessionIndicators: ['root_token'],
      });
      mgr.addCredential({
        domain: 'mid.com',
        loginUrl: 'https://mid.com/login',
        steps: [],
        sessionIndicators: ['mid_token'],
        ssoChain: 'root.com',
      });
      mgr.addCredential({
        domain: 'leaf.com',
        loginUrl: 'https://leaf.com/login',
        steps: [],
        sessionIndicators: ['leaf_token'],
        ssoChain: 'mid.com',
      });

      const chain = mgr.resolveLoginChain('leaf.com');
      expect(chain).toEqual(['root.com', 'mid.com', 'leaf.com']);
    });

    it('prevents circular SSO chains', () => {
      mgr.addCredential({
        domain: 'a.com', loginUrl: 'https://a.com', steps: [],
        sessionIndicators: [], ssoChain: 'b.com',
      });
      mgr.addCredential({
        domain: 'b.com', loginUrl: 'https://b.com', steps: [],
        sessionIndicators: [], ssoChain: 'a.com',
      });

      const chain = mgr.resolveLoginChain('a.com');
      // Should stop without infinite loop
      expect(chain.length).toBeLessThanOrEqual(2);
    });
  });

  // ── getLoginSteps ────────────────────────────────────────

  describe('getLoginSteps', () => {
    it('returns steps for single domain', () => {
      mgr.addCredential(sampleCredential);
      const steps = mgr.getLoginSteps('example.com');
      expect(steps).toHaveLength(1);
      expect(steps[0].domain).toBe('example.com');
      expect(steps[0].steps).toHaveLength(5);
    });

    it('returns empty for unknown domain', () => {
      const steps = mgr.getLoginSteps('unknown.com');
      expect(steps).toHaveLength(0);
    });

    it('returns SSO chain steps in order', () => {
      mgr.addCredential({
        domain: 'sso.com',
        loginUrl: 'https://sso.com/login',
        steps: [{ action: 'navigate', target: 'https://sso.com' }],
        sessionIndicators: ['sso'],
      });
      mgr.addCredential({
        ...sampleCredential,
        ssoChain: 'sso.com',
      });

      const steps = mgr.getLoginSteps('example.com');
      expect(steps).toHaveLength(2);
      expect(steps[0].domain).toBe('sso.com');
      expect(steps[1].domain).toBe('example.com');
    });
  });
});
