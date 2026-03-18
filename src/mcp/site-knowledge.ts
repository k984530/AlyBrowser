import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Entry {
  url: string;
  action: string;
  result: 'success' | 'fail';
  note: string;
  ts: string;
}

interface SiteData {
  domain: string;
  entries: Entry[];
}

const MAX_ENTRIES_PER_DOMAIN = 200;
const MAX_CONTEXT_ENTRIES = 20;
const MAX_COMPACT_ENTRIES = 5;

// ── Sensitive data filtering ─────────────────────────────────

/** Patterns that indicate sensitive values — matched case-insensitively */
const SENSITIVE_PATTERNS = [
  // Credentials
  /\b(password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /\b(secret|token|api[_-]?key|access[_-]?key|auth[_-]?token)\s*[:=]\s*\S+/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // JWT-like strings (3 base64url parts)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // AWS-style keys
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // Generic long hex/base64 secrets (32+ chars of hex or 24+ chars of base64)
  /\b[0-9a-f]{32,}\b/gi,
  // Email:password combos
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*[:]\s*\S+/g,
  // Credit card numbers (basic 13-19 digit)
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g,
  // Korean resident registration number (주민등록번호: 6digits-7digits)
  /\b\d{6}[\s-]\d{7}\b/g,
  // Korean passport number (여권번호: M or S + 8 digits)
  /\b[MS]\d{8}\b/g,
  // Korean driver license number (운전면허번호: 2digits-2digits-6digits-2digits)
  /\b\d{2}-\d{2}-\d{6}-\d{2}\b/g,
  // Korean bank account number (계좌번호: 10-16 digit sequences with hyphens)
  /\b\d{3,6}-\d{2,6}-\d{2,8}\b/g,
  // Korean phone number (전화번호: 010-XXXX-XXXX or 02-XXX-XXXX)
  /\b0\d{1,2}-\d{3,4}-\d{4}\b/g,
];

/** Replace sensitive patterns with [REDACTED] */
export function redactSensitive(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ── Encryption helpers (AES-256-GCM) ─────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SECRET_FILE = '.encryption-key';

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
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

export class SiteKnowledge {
  private baseDir: string;
  private cache = new Map<string, SiteData>();
  private encryptionKey: Buffer | null = null;

  constructor() {
    this.baseDir = path.join(os.homedir(), '.aly-browser', 'site-knowledge');
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.initEncryptionKey();
  }

  private initEncryptionKey(): void {
    const keyPath = path.join(this.baseDir, SECRET_FILE);
    try {
      if (fs.existsSync(keyPath)) {
        const secret = fs.readFileSync(keyPath, 'utf-8').trim();
        this.encryptionKey = deriveKey(secret);
      } else {
        const secret = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(keyPath, secret, { mode: 0o600 });
        this.encryptionKey = deriveKey(secret);
      }
    } catch (err) {
      // Encryption key setup failed — throw to prevent plaintext storage
      throw new Error(`Site knowledge encryption init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private parseUrl(url: string): { domain: string; pathname: string } {
    try {
      const full = url.startsWith('https://') || url.startsWith('http://')
        ? url
        : `https://${url}`;
      const parsed = new URL(full);
      return {
        domain: parsed.hostname.replace(/^www\./, ''),
        pathname: this.normalizePath(parsed.pathname),
      };
    } catch {
      const idx = url.indexOf('/');
      const rawDomain = (idx >= 0 ? url.slice(0, idx) : url).replace(/^www\./, '');
      // Sanitize domain to prevent path traversal
      const domain = rawDomain.replace(/\.\./g, '').replace(/[/\\]/g, '') || 'unknown';
      return {
        domain,
        pathname: idx >= 0 ? this.normalizePath(url.slice(idx)) : '/',
      };
    }
  }

  private normalizePath(p: string): string {
    return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  }

  private pathMatches(entryPath: string, queryPath: string): boolean {
    if (entryPath === '/') return true;
    return queryPath === entryPath || queryPath.startsWith(entryPath + '/');
  }

  private filePath(domain: string): string {
    return path.join(this.baseDir, `${domain}.json`);
  }

  private load(domain: string): SiteData {
    const cached = this.cache.get(domain);
    if (cached) return cached;

    const fp = this.filePath(domain);
    let data: SiteData = { domain, entries: [] };
    try {
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8');
        // Try decrypting first, fall back to plaintext JSON
        if (this.encryptionKey && !raw.startsWith('{')) {
          try {
            const json = decrypt(raw, this.encryptionKey);
            data = JSON.parse(json);
          } catch {
            // Decryption failed (key changed?) — try as plaintext
            data = JSON.parse(raw);
          }
        } else {
          data = JSON.parse(raw);
        }
      }
    } catch {
      // corrupted — back up and start fresh
      try { fs.renameSync(fp, fp + '.bak'); } catch {}
    }
    this.cache.set(domain, data);
    return data;
  }

  private save(domain: string, data: SiteData): void {
    if (data.entries.length > MAX_ENTRIES_PER_DOMAIN) {
      data.entries = data.entries.slice(-MAX_ENTRIES_PER_DOMAIN);
    }
    this.cache.set(domain, data);
    // Atomic write: temp file + rename to prevent partial writes on concurrent access
    const fp = this.filePath(domain);
    const tmp = fp + '.tmp';
    const json = JSON.stringify(data);
    if (!this.encryptionKey) {
      throw new Error('Cannot save site knowledge: encryption key not initialized');
    }
    const content = encrypt(json, this.encryptionKey);
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, fp);
  }

  add(url: string, action: string, result: 'success' | 'fail', note: string): void {
    // Enforce field length limits to prevent disk/memory abuse
    action = action.slice(0, 1000);
    note = note.slice(0, 1000);

    // Redact sensitive information before storing
    action = redactSensitive(action);
    note = redactSensitive(note);

    const { domain, pathname } = this.parseUrl(url);
    const data = this.load(domain);

    const isDupe = data.entries.some(
      (e) => e.url === pathname && e.action === action && e.result === result && e.note === note,
    );
    if (isDupe) return;

    data.entries.push({
      url: pathname,
      action,
      result,
      note,
      ts: new Date().toISOString().slice(0, 10),
    });
    this.save(domain, data);
  }

  query(url: string): Entry[] {
    const { domain, pathname } = this.parseUrl(url);
    const data = this.load(domain);
    return data.entries.filter((e) => this.pathMatches(e.url, pathname));
  }

  formatForContext(url: string): string | null {
    const { domain, pathname } = this.parseUrl(url);
    const data = this.load(domain);
    const entries = data.entries.filter((e) => this.pathMatches(e.url, pathname));
    if (entries.length === 0) return null;

    const recent = entries.slice(-MAX_CONTEXT_ENTRIES);
    const lines = recent.map(
      (e) => `- (${e.result}) ${e.action}: ${e.note}`,
    );
    const countNote = entries.length > MAX_CONTEXT_ENTRIES
      ? ` (showing last ${MAX_CONTEXT_ENTRIES} of ${entries.length})`
      : '';
    return `[Site Knowledge] ${domain} — ${recent.length} entries${countNote}\n${lines.join('\n')}`;
  }

  formatCompact(url: string): string | null {
    const { domain, pathname } = this.parseUrl(url);
    const data = this.load(domain);
    const entries = data.entries.filter((e) => this.pathMatches(e.url, pathname));
    if (entries.length === 0) return null;

    const recent = entries.slice(-MAX_COMPACT_ENTRIES);
    const lines = recent.map(
      (e) => `${e.result === 'fail' ? '✗' : '✓'} ${e.action}: ${e.note}`,
    );
    const more = entries.length > MAX_COMPACT_ENTRIES
      ? ` (+${entries.length - MAX_COMPACT_ENTRIES} more)`
      : '';
    return `[Knowledge: ${domain}${more}] ${lines.join(' | ')}`;
  }

  hasDomain(url: string): boolean {
    const { domain } = this.parseUrl(url);
    const data = this.load(domain);
    return data.entries.length > 0;
  }

  hasPath(url: string): boolean {
    const { domain, pathname } = this.parseUrl(url);
    const data = this.load(domain);
    return data.entries.some((e) => this.pathMatches(e.url, pathname));
  }
}
