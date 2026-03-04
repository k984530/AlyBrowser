import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Entry {
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

export class SiteKnowledge {
  private baseDir: string;
  private cache = new Map<string, SiteData>();

  constructor() {
    this.baseDir = path.join(os.homedir(), '.aly-browser', 'site-knowledge');
    fs.mkdirSync(this.baseDir, { recursive: true });
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
      return {
        domain: (idx >= 0 ? url.slice(0, idx) : url).replace(/^www\./, ''),
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
        data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
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
    fs.writeFileSync(this.filePath(domain), JSON.stringify(data));
  }

  add(url: string, action: string, result: 'success' | 'fail', note: string): void {
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
}
