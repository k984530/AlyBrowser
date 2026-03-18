/**
 * Minimal JWT HS256 implementation — no external dependencies.
 * Used for WS bridge token authentication to prevent session hijacking.
 */
import * as crypto from 'crypto';

// ── Base64url helpers ───────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlEncode(obj: unknown): string {
  return base64url(Buffer.from(JSON.stringify(obj)));
}

function base64urlDecode(str: string): unknown {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return JSON.parse(Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString());
}

// ── Types ───────────────────────────────────────────────────

export interface TokenPayload {
  /** Session ID */
  sub: string;
  /** Issued at (epoch seconds) */
  iat: number;
  /** Unique token ID */
  jti: string;
  /** Expiration time (epoch seconds). Optional — omit for non-expiring tokens. */
  exp?: number;
}

// ── Public API ──────────────────────────────────────────────

/** Generate a cryptographically secure random secret (64 hex chars). */
export function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Sign a JWT with HS256. */
export function signJwt(payload: TokenPayload, secret: string): string {
  const header = base64urlEncode({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlEncode(payload);
  const signature = base64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

/** Verify a JWT signed with HS256. Returns the decoded payload or throws. */
export function verifyJwt(token: string, secret: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, body, sig] = parts;
  const expectedSig = base64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid token signature');
  }

  const payload = base64urlDecode(body) as TokenPayload;
  if (!payload.sub || !payload.iat || !payload.jti) {
    throw new Error('Invalid token payload: missing required fields');
  }

  // Validate expiration if present
  if (payload.exp !== undefined && payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}
