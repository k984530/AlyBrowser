import { describe, it, expect } from 'vitest';
import { generateSecret, signJwt, verifyJwt, type TokenPayload } from '../../src/auth/token';

describe('JWT HS256 Token', () => {
  const secret = generateSecret();
  const payload: TokenPayload = {
    sub: 'test-session',
    iat: Math.floor(Date.now() / 1000),
    jti: 'abc123',
  };

  // ── generateSecret ─────────────────────────────────────────

  describe('generateSecret', () => {
    it('returns 64-char hex string', () => {
      const s = generateSecret();
      expect(s).toHaveLength(64);
      expect(s).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique secrets', () => {
      const secrets = new Set(Array.from({ length: 10 }, () => generateSecret()));
      expect(secrets.size).toBe(10);
    });
  });

  // ── signJwt ────────────────────────────────────────────────

  describe('signJwt', () => {
    it('produces a 3-part dot-separated string', () => {
      const token = signJwt(payload, secret);
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('header contains alg and typ', () => {
      const token = signJwt(payload, secret);
      const headerB64 = token.split('.')[0];
      const pad = headerB64.length % 4 === 0 ? '' : '='.repeat(4 - (headerB64.length % 4));
      const header = JSON.parse(Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString());
      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    });

    it('payload contains sub, iat, jti', () => {
      const token = signJwt(payload, secret);
      const bodyB64 = token.split('.')[1];
      const pad = bodyB64.length % 4 === 0 ? '' : '='.repeat(4 - (bodyB64.length % 4));
      const body = JSON.parse(Buffer.from(bodyB64.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString());
      expect(body.sub).toBe('test-session');
      expect(body.jti).toBe('abc123');
      expect(body.iat).toBe(payload.iat);
    });

    it('different secrets produce different signatures', () => {
      const token1 = signJwt(payload, 'secret-one');
      const token2 = signJwt(payload, 'secret-two');
      const sig1 = token1.split('.')[2];
      const sig2 = token2.split('.')[2];
      expect(sig1).not.toBe(sig2);
    });

    it('different payloads produce different tokens', () => {
      const t1 = signJwt({ ...payload, jti: 'id-1' }, secret);
      const t2 = signJwt({ ...payload, jti: 'id-2' }, secret);
      expect(t1).not.toBe(t2);
    });
  });

  // ── verifyJwt ──────────────────────────────────────────────

  describe('verifyJwt', () => {
    it('returns decoded payload for valid token', () => {
      const token = signJwt(payload, secret);
      const decoded = verifyJwt(token, secret);
      expect(decoded.sub).toBe('test-session');
      expect(decoded.iat).toBe(payload.iat);
      expect(decoded.jti).toBe('abc123');
    });

    it('throws on wrong secret', () => {
      const token = signJwt(payload, secret);
      expect(() => verifyJwt(token, 'wrong-secret')).toThrow('Invalid token signature');
    });

    it('throws on tampered payload', () => {
      const token = signJwt(payload, secret);
      const parts = token.split('.');
      // Tamper with the payload
      const tampered = Buffer.from(JSON.stringify({ ...payload, sub: 'hacked' }))
        .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const badToken = `${parts[0]}.${tampered}.${parts[2]}`;
      expect(() => verifyJwt(badToken, secret)).toThrow('Invalid token signature');
    });

    it('throws on tampered signature', () => {
      const token = signJwt(payload, secret);
      const badToken = token.slice(0, -4) + 'XXXX';
      expect(() => verifyJwt(badToken, secret)).toThrow('Invalid token signature');
    });

    it('throws on invalid format (missing parts)', () => {
      expect(() => verifyJwt('only-one-part', secret)).toThrow('Invalid token format');
      expect(() => verifyJwt('two.parts', secret)).toThrow('Invalid token format');
    });

    it('throws on empty token', () => {
      expect(() => verifyJwt('', secret)).toThrow('Invalid token format');
    });

    it('throws on payload missing required fields', () => {
      // Sign a token with incomplete payload
      const incompletePay = { sub: 'x' } as unknown as TokenPayload;
      // We need to construct this manually since signJwt would pass the full payload
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const body = Buffer.from(JSON.stringify(incompletePay))
        .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      const crypto = require('crypto');
      const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
        .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      expect(() => verifyJwt(`${header}.${body}.${sig}`, secret)).toThrow('missing required fields');
    });

    it('roundtrip: sign → verify preserves all fields', () => {
      const original: TokenPayload = {
        sub: 'session-abc',
        iat: 1700000000,
        jti: 'unique-id-xyz',
      };
      const token = signJwt(original, secret);
      const decoded = verifyJwt(token, secret);
      expect(decoded).toEqual(original);
    });

    it('accepts token without exp (non-expiring)', () => {
      const token = signJwt(payload, secret);
      const decoded = verifyJwt(token, secret);
      expect(decoded.exp).toBeUndefined();
    });

    it('accepts token with future exp', () => {
      const futurePayload: TokenPayload = {
        ...payload,
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };
      const token = signJwt(futurePayload, secret);
      const decoded = verifyJwt(token, secret);
      expect(decoded.exp).toBe(futurePayload.exp);
    });

    it('throws on expired token', () => {
      const expiredPayload: TokenPayload = {
        ...payload,
        exp: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
      };
      const token = signJwt(expiredPayload, secret);
      expect(() => verifyJwt(token, secret)).toThrow('Token expired');
    });

    it('throws on token expiring exactly now', () => {
      const nowPayload: TokenPayload = {
        ...payload,
        exp: Math.floor(Date.now() / 1000), // exactly now
      };
      const token = signJwt(nowPayload, secret);
      expect(() => verifyJwt(token, secret)).toThrow('Token expired');
    });
  });
});
