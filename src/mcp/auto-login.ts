/**
 * Auto Login Manager — manages login state detection and credential-based re-authentication.
 * Credentials are encrypted at rest using the same AES-256-GCM infrastructure as site-knowledge.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Types ───────────────────────────────────────────────────

export interface LoginCredential {
  /** Domain (e.g., "instagram.com") */
  domain: string;
  /** Login page URL */
  loginUrl: string;
  /** Steps to execute for login (simplified DSL) */
  steps: LoginStep[];
  /** Cookie name(s) that indicate logged-in state */
  sessionIndicators: string[];
  /** Last successful login timestamp */
  lastLoginAt?: number;
  /** SSO chain — login to this domain first */
  ssoChain?: string;
}

export interface LoginStep {
  action: 'navigate' | 'click' | 'type' | 'wait' | 'waitForStable';
  /** Ref ID, URL, selector, or text depending on action */
  target: string;
  /** Value for type action */
  value?: string;
}

export interface LoginState {
  domain: string;
  loggedIn: boolean;
  checkedAt: number;
  expiresAt?: number;
}

// ── Encryption (reuse pattern from site-knowledge) ──────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(encoded: string, key: Buffer): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf-8');
}

// ── AutoLoginManager ────────────────────────────────────────

const BASE_DIR = path.join(os.homedir(), '.aly-browser', 'auto-login');
const SECRET_FILE = '.encryption-key';
const CREDENTIALS_FILE = 'credentials.enc';
const STATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class AutoLoginManager {
  private credentials = new Map<string, LoginCredential>();
  private stateCache = new Map<string, LoginState>();
  private encryptionKey: Buffer | null = null;

  constructor() {
    fs.mkdirSync(BASE_DIR, { recursive: true });
    this.initEncryptionKey();
    this.loadCredentials();
  }

  private initEncryptionKey(): void {
    const keyPath = path.join(BASE_DIR, SECRET_FILE);
    try {
      if (fs.existsSync(keyPath)) {
        this.encryptionKey = deriveKey(fs.readFileSync(keyPath, 'utf-8').trim());
      } else {
        const secret = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(keyPath, secret, { mode: 0o600 });
        this.encryptionKey = deriveKey(secret);
      }
    } catch {
      this.encryptionKey = null;
    }
  }

  private credentialsPath(): string {
    return path.join(BASE_DIR, CREDENTIALS_FILE);
  }

  private loadCredentials(): void {
    const fp = this.credentialsPath();
    try {
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8');
        const json = this.encryptionKey && !raw.startsWith('[')
          ? decrypt(raw, this.encryptionKey)
          : raw;
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) throw new Error('Credentials file is not an array');
        for (const cred of parsed as LoginCredential[]) {
          if (cred.domain) this.credentials.set(cred.domain, cred);
        }
      }
    } catch (err) {
      // Corrupted or missing — start fresh. Log for debugging.
      if (fs.existsSync(fp)) {
        console.error('[auto-login] Failed to load credentials:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  private saveCredentials(): void {
    const arr = Array.from(this.credentials.values());
    const json = JSON.stringify(arr);
    const content = this.encryptionKey ? encrypt(json, this.encryptionKey) : json;
    const fp = this.credentialsPath();
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, fp);
  }

  /** Register login credentials for a domain */
  addCredential(credential: LoginCredential): void {
    this.credentials.set(credential.domain, credential);
    this.saveCredentials();
  }

  /** Remove credentials for a domain */
  removeCredential(domain: string): boolean {
    const removed = this.credentials.delete(domain);
    if (removed) this.saveCredentials();
    return removed;
  }

  /** Get credentials for a domain */
  getCredential(domain: string): LoginCredential | undefined {
    return this.credentials.get(domain);
  }

  /** List all registered domains */
  listDomains(): string[] {
    return Array.from(this.credentials.keys());
  }

  /** Check if a domain has cached login state (not expired) */
  getCachedState(domain: string): LoginState | null {
    const state = this.stateCache.get(domain);
    if (!state) return null;
    if (Date.now() - state.checkedAt > STATE_CACHE_TTL) {
      this.stateCache.delete(domain);
      return null;
    }
    return state;
  }

  /** Update login state cache */
  updateState(domain: string, loggedIn: boolean): void {
    this.stateCache.set(domain, {
      domain,
      loggedIn,
      checkedAt: Date.now(),
    });
    if (loggedIn) {
      const cred = this.credentials.get(domain);
      if (cred) {
        cred.lastLoginAt = Date.now();
        this.saveCredentials();
      }
    }
  }

  /** Resolve SSO chain: returns domains in order to login (dependencies first) */
  resolveLoginChain(domain: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    let current: string | undefined = domain;

    while (current && !visited.has(current)) {
      visited.add(current);
      chain.unshift(current);
      const cred = this.credentials.get(current);
      current = cred?.ssoChain;
    }

    return chain;
  }

  /** Get login steps for a domain (resolves SSO chain) */
  getLoginSteps(domain: string): { domain: string; steps: LoginStep[] }[] {
    const chain = this.resolveLoginChain(domain);
    return chain
      .map((d) => {
        const cred = this.credentials.get(d);
        return cred ? { domain: d, steps: cred.steps } : null;
      })
      .filter((x): x is { domain: string; steps: LoginStep[] } => x !== null);
  }
}
