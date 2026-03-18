import { WebSocketServer, WebSocket } from 'ws';
import { spawn, execSync, type ChildProcess } from 'child_process';
import type { IncomingMessage } from 'http';
import { findChromeForTesting } from '../chrome/finder';
import { generateSecret, signJwt, verifyJwt, type TokenPayload } from '../auth/token';
import { Deferred } from '../utils/deferred';
import { Logger } from '../utils/logger';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const log = new Logger('ext-bridge');
const BASE_DIR = path.join(os.homedir(), '.aly-browser');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
const DEFAULT_PORT = 19222;

/** Find a free port by actually binding a WebSocketServer to it (no TOCTOU gap). */
async function bindWSServer(startPort: number): Promise<{ wss: WebSocketServer; port: number }> {
  for (let port = startPort; port <= 19322; port++) {
    try {
      const wss = await new Promise<WebSocketServer>((resolve, reject) => {
        const server = new WebSocketServer({ port });
        server.on('listening', () => resolve(server));
        server.on('error', reject);
      });
      return { wss, port };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') continue;
      throw err;
    }
  }
  throw new Error('No free port found in range 19222-19322');
}

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private chromeProcess: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, Deferred<unknown>>();
  private _closing = false;
  private _port: number = 0;
  private _sessionId: string;
  private _sessionDir: string;
  private _profileDir: string;
  private _extensionCopyDir: string;
  private _secret: string = '';
  private _token: string = '';
  private _recovering = false;
  private _recoverAttempts = 0;
  private _maxRecoverAttempts = 3;
  private _intentionalClose = false;

  constructor(sessionId: string = 'default') {
    if (!SESSION_ID_RE.test(sessionId)) {
      throw new Error(`Invalid sessionId "${sessionId}". Only alphanumeric, hyphen, and underscore allowed.`);
    }
    this._sessionId = sessionId;
    this._sessionDir = path.join(SESSIONS_DIR, sessionId);
    this._profileDir = path.join(this._sessionDir, 'profile');
    this._extensionCopyDir = path.join(this._sessionDir, 'extension');
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get port(): number {
    return this._port;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** The session's auth token (JWT). External consumers can use this to connect. */
  get token(): string {
    return this._token;
  }

  async launch(options?: { url?: string }): Promise<void> {
    await this.startServer();

    // Strategy 1: Try connecting to an already-installed extension in user's Chrome (5s)
    const quickConnect = await this.waitForExtensionQuick(5000);

    if (!quickConnect) {
      // Strategy 2: Launch Chrome for Testing with --load-extension
      log.debug('No existing extension detected, launching Chrome for Testing...');
      this.prepareSessionExtension();
      this.launchChrome();
      await this.waitForExtension();
    } else {
      log.debug('Connected to existing Chrome extension');
    }

    if (options?.url) {
      await this.send('navigate', { url: options.url });
    }
  }

  /** Quick check: is an extension already connected (e.g. user's Chrome with extension installed)? */
  private waitForExtensionQuick(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.wss!.removeListener('connection', onConnection);
        resolve(value);
      };

      const timeout = setTimeout(() => settle(false), timeoutMs);

      const onConnection = (ws: WebSocket, req: IncomingMessage) => {
        if (!this.validateWsToken(req)) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        this.ws = ws;

        ws.on('message', (data) => {
          let msg: Record<string, unknown>;
          try { msg = JSON.parse(data.toString()); } catch { return; }

          if (msg.type === 'ready') {
            this.setupWsHandlers(ws);
            settle(true);
            return;
          }
        });

        ws.on('close', () => {
          this.ws = null;
          settle(false);
        });
      };

      this.wss!.on('connection', onConnection);
    });
  }

  /** Validate the auth token from a WS upgrade request. Returns true if valid or auth is not enforced. */
  private validateWsToken(req?: IncomingMessage): boolean {
    const requireAuth = process.env.ALY_REQUIRE_AUTH === '1';
    try {
      const url = new URL(req?.url || '', `http://localhost:${this._port}`);
      const token = url.searchParams.get('token');
      if (!token) {
        if (requireAuth) {
          log.warn('WS connection rejected — ALY_REQUIRE_AUTH=1 requires token');
          return false;
        }
        log.warn('WS connection without auth token — set ALY_REQUIRE_AUTH=1 to enforce, or use Chrome for Testing');
        return true;
      }
      verifyJwt(token, this._secret);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`WS auth failed: ${msg}`);
      return false;
    }
  }

  /** Set up message and close handlers for the WS connection */
  private setupWsHandlers(ws: WebSocket): void {
    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()); } catch {
        log.warn('Malformed message from extension:', data.toString().slice(0, 100));
        return;
      }

      if (msg.type === 'ping' || msg.type === 'alarm' || msg.type === 'ready') return;

      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id as number);
        if (p) {
          this.pending.delete(msg.id as number);
          msg.error ? p.reject(new Error(msg.error as string)) : p.resolve(msg.result);
        }
      }
    });

    ws.on('close', () => {
      this._closing = true;
      this.ws = null;
      for (const [, d] of this.pending) {
        d.reject(new Error('Extension disconnected'));
      }
      this.pending.clear();
      this._closing = false;

      // Trigger auto-recovery if not intentionally closing
      if (!this._intentionalClose && this.chromeProcess) {
        this.attemptRecovery();
      }
    });
  }

  private async startServer(): Promise<void> {
    fs.mkdirSync(this._sessionDir, { recursive: true });

    const { wss, port } = await bindWSServer(DEFAULT_PORT);
    this.wss = wss;
    this._port = port;

    // Generate per-session JWT for WS authentication
    this._secret = generateSecret();
    this._token = signJwt(
      {
        sub: this._sessionId,
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomBytes(16).toString('hex'),
      },
      this._secret,
    );

    log.debug(`WS server on port ${this._port} (session: ${this._sessionId})`);
    fs.writeFileSync(path.join(this._sessionDir, 'port'), String(this._port));
    fs.writeFileSync(path.join(this._sessionDir, 'pid'), String(process.pid));
    // Token file readable only by owner (prevents other users from reading it)
    fs.writeFileSync(path.join(this._sessionDir, 'token'), this._token, { mode: 0o600 });
  }

  /** Copy the extension directory and inject the session's WS port into background.js */
  private prepareSessionExtension(): void {
    const sourceDir = this.resolveExtensionDir();
    if (!sourceDir) return;

    fs.mkdirSync(this._extensionCopyDir, { recursive: true });

    // Copy all extension files
    for (const file of fs.readdirSync(sourceDir)) {
      const src = path.join(sourceDir, file);
      const dest = path.join(this._extensionCopyDir, file);
      if (fs.statSync(src).isFile()) {
        if (file === 'background.js') {
          // Inject port and auth token into background.js
          let content = fs.readFileSync(src, 'utf-8');
          const portMarker = /const WS_PORT = \d+;/;
          if (!portMarker.test(content)) {
            log.warn('background.js missing WS_PORT marker — extension may connect to wrong port');
          }
          content = content.replace(portMarker, `const WS_PORT = ${this._port};`);

          const tokenMarker = /const WS_TOKEN = '[^']*';/;
          if (!tokenMarker.test(content)) {
            log.warn('background.js missing WS_TOKEN marker — extension will connect without auth');
          }
          content = content.replace(tokenMarker, `const WS_TOKEN = '${this._token}';`);
          fs.writeFileSync(dest, content);
        } else if (file === 'manifest.json') {
          // Bump version on each launch to force Chrome to reload the service worker
          // (Chrome caches MV3 service workers in the profile — stale cache uses wrong port)
          // Chrome version format: up to 4 dot-separated integers, each 0-65535
          let content = fs.readFileSync(src, 'utf-8');
          const n = Date.now() % 65535;
          const ts = `1.0.${n}.${Math.floor(Math.random() * 65535)}`;
          content = content.replace(/"version":\s*"[^"]*"/, `"version": "${ts}"`);
          fs.writeFileSync(dest, content);
        } else {
          fs.copyFileSync(src, dest);
        }
      }
    }
  }

  private launchChrome(): void {
    const chromePath = findChromeForTesting();
    fs.mkdirSync(this._profileDir, { recursive: true });

    // macOS: remove quarantine/provenance flags that block extension loading
    if (process.platform === 'darwin') {
      try {
        const appBundle = chromePath.replace(/\/Contents\/MacOS\/.*$/, '');
        execSync(`xattr -c "${appBundle}"`, { stdio: 'ignore' });
      } catch {}
    }

    const flags = [
      `--user-data-dir=${this._profileDir}`,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--no-first-run',
      '--disable-popup-blocking',
      '--disable-infobars',
      '--window-size=1280,720',
      '--disable-features=PerfettoSystemTracing',
    ];

    if (fs.existsSync(path.join(this._extensionCopyDir, 'manifest.json'))) {
      flags.push(`--load-extension=${this._extensionCopyDir}`);
    }

    log.debug('Launch:', chromePath, 'session:', this._sessionId, 'port:', this._port);
    this.chromeProcess = spawn(chromePath, flags, {
      // Detach Chrome so it survives parent process exit (MCP server restart, script end)
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Allow Node.js to exit without waiting for Chrome
    this.chromeProcess.unref();

    this.chromeProcess.on('exit', (code) => {
      this.chromeProcess = null;
      // Non-zero exit or signal kill = crash — trigger recovery
      if (code !== 0 && !this._intentionalClose) {
        log.warn(`Chrome exited with code ${code} — attempting recovery`);
        this.attemptRecovery();
      }
    });

    this.chromeProcess.stderr?.on('data', (c: Buffer) =>
      log.debug('chrome:', c.toString().trim()),
    );
    this.chromeProcess.on('error', (e) => log.error('chrome error:', e.message));
  }

  private resolveExtensionDir(): string | null {
    const thisDir = typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(thisDir, '../../extension'),
      path.resolve(thisDir, '../extension'),
      path.join(process.cwd(), 'extension'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'manifest.json'))) {
        return dir;
      }
    }
    return null;
  }

  private waitForExtension(): Promise<void> {
    const deferred = new Deferred<void>();
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      this.wss!.removeListener('connection', onConnection);
      fn();
    };

    const timeout = setTimeout(() => {
      settle(() => deferred.reject(new Error(
        'Extension connect timeout (30s). If using regular Chrome, install the extension manually at chrome://extensions (Developer mode → Load unpacked → select extension/ folder).',
      )));
    }, 30_000);

    const onConnection = (ws: WebSocket, req: IncomingMessage) => {
      if (settled) {
        ws.close();
        return;
      }

      if (!this.validateWsToken(req)) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      log.debug('Extension connected (session:', this._sessionId, ')');
      this.ws = ws;

      // Wait for 'ready' message, then set up handlers
      const readyHandler = (data: Buffer) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        if (msg.type === 'ready') {
          log.debug('Extension ready, tab:', msg.tabId);
          ws.removeListener('message', readyHandler);
          this.setupWsHandlers(ws);
          settle(() => deferred.resolve());
        }
      };
      ws.on('message', readyHandler);

      ws.on('close', () => {
        this.ws = null;
        settle(() => deferred.reject(new Error('Extension disconnected during handshake')));
      });
    };

    this.wss!.on('connection', onConnection);

    return deferred.promise;
  }

  async send(action: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this._closing) {
      throw new Error('Extension is closing');
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Extension not connected');
    }

    const id = this.nextId++;
    const deferred = new Deferred<unknown>();
    this.pending.set(id, deferred);

    try {
      // Capture ws reference to avoid race with close handler nullifying this.ws
      ws.send(JSON.stringify({ id, action, params }));
    } catch (err) {
      this.pending.delete(id);
      throw err;
    }

    const timer = setTimeout(() => {
      this.pending.delete(id);
      deferred.reject(new Error(`Timeout: ${action}`));
    }, 60_000);

    try {
      return await deferred.promise;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Browser Control ─────────────────────────────────────────

  async navigate(url: string, tabId?: number): Promise<void> {
    await this.send('navigate', { url, tabId });
  }

  async snapshot(tabId?: number, frameId?: number): Promise<string> {
    return (await this.send('snapshot', { tabId, frameId })) as string;
  }

  async click(ref: string, tabId?: number, frameId?: number): Promise<void> {
    await this.send('click', { ref, tabId, frameId });
  }

  async type(
    ref: string,
    text: string,
    opts?: { clear?: boolean; tabId?: number; frameId?: number },
  ): Promise<void> {
    await this.send('type', { ref, text, clear: opts?.clear ?? false, tabId: opts?.tabId, frameId: opts?.frameId });
  }

  async selectOption(ref: string, value: string, tabId?: number, frameId?: number): Promise<void> {
    await this.send('select', { ref, value, tabId, frameId });
  }

  async hover(ref: string, tabId?: number, frameId?: number): Promise<void> {
    await this.send('hover', { ref, tabId, frameId });
  }

  async evaluate(expression: string, tabId?: number): Promise<unknown> {
    return await this.send('evaluate', { expression, tabId });
  }

  async waitForSelector(
    selector: string,
    opts?: { timeout?: number; hidden?: boolean; tabId?: number; frameId?: number },
  ): Promise<void> {
    await this.send('waitForSelector', {
      selector, timeout: opts?.timeout, hidden: opts?.hidden, tabId: opts?.tabId, frameId: opts?.frameId,
    });
  }

  async waitForStable(
    opts?: { timeout?: number; stableMs?: number; tabId?: number; frameId?: number },
  ): Promise<void> {
    await this.send('waitForStable', {
      timeout: opts?.timeout, stableMs: opts?.stableMs, tabId: opts?.tabId, frameId: opts?.frameId,
    });
  }

  async scrollBy(opts: { x?: number; y?: number; tabId?: number; frameId?: number }): Promise<void> {
    await this.send('scrollBy', { x: opts.x ?? 0, y: opts.y ?? 0, tabId: opts.tabId, frameId: opts.frameId });
  }

  async goBack(tabId?: number): Promise<void> {
    await this.send('goBack', { tabId });
  }

  async goForward(tabId?: number): Promise<void> {
    await this.send('goForward', { tabId });
  }

  async getHTML(tabId?: number, frameId?: number): Promise<string> {
    return (await this.send('getHTML', { tabId, frameId })) as string;
  }

  // ── File Upload ────────────────────────────────────────────────

  async upload(
    filePath: string,
    opts?: { ref?: string; tabId?: number; frameId?: number },
  ): Promise<unknown> {
    const fileData = fs.readFileSync(filePath);
    const dataBase64 = fileData.toString('base64');
    const fileName = path.basename(filePath);
    const mimeType = this.guessMimeType(fileName);
    return await this.send('upload', {
      ref: opts?.ref,
      fileName,
      mimeType,
      dataBase64,
      tabId: opts?.tabId,
      frameId: opts?.frameId,
    });
  }

  private guessMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
      '.json': 'application/json', '.xml': 'application/xml',
      '.zip': 'application/zip', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  // ── Frame Management ─────────────────────────────────────────

  async frameList(tabId?: number): Promise<unknown> {
    return await this.send('frameList', { tabId });
  }

  // ── Tab Management ──────────────────────────────────────────

  async tabList(): Promise<unknown> {
    return await this.send('tabList');
  }

  async tabNew(url?: string): Promise<unknown> {
    return await this.send('tabNew', { url });
  }

  async tabClose(tabId?: number): Promise<void> {
    await this.send('tabClose', { tabId });
  }

  async tabSwitch(tabId: number): Promise<void> {
    await this.send('tabSwitch', { tabId });
  }

  // ── Cookies ─────────────────────────────────────────────────

  async cookieGet(
    url: string,
    name?: string,
  ): Promise<unknown> {
    return await this.send('cookieGet', { url, name });
  }

  async cookieSet(params: Record<string, unknown>): Promise<unknown> {
    return await this.send('cookieSet', params);
  }

  async cookieDelete(url: string, name: string): Promise<void> {
    await this.send('cookieDelete', { url, name });
  }

  // ── Downloads ───────────────────────────────────────────────

  async download(
    url: string,
    filename?: string,
  ): Promise<unknown> {
    return await this.send('download', { url, filename });
  }

  // ── History ─────────────────────────────────────────────────

  async historySearch(
    query?: string,
    maxResults?: number,
  ): Promise<unknown> {
    return await this.send('historySearch', { query, maxResults });
  }

  // ── Alarms ──────────────────────────────────────────────────

  async alarmCreate(
    name: string,
    opts: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.send('alarmCreate', { name, ...opts });
  }

  async alarmList(): Promise<unknown> {
    return await this.send('alarmList');
  }

  async alarmClear(name?: string): Promise<void> {
    await this.send('alarmClear', { name });
  }

  async alarmEvents(): Promise<unknown> {
    return await this.send('alarmEvents');
  }

  // ── Storage ─────────────────────────────────────────────────

  async storageGet(keys?: string[]): Promise<unknown> {
    return await this.send('storageGet', { keys });
  }

  async storageSet(data: Record<string, unknown>): Promise<void> {
    await this.send('storageSet', { data });
  }

  // ── Notifications ───────────────────────────────────────────

  async notify(title: string, message: string): Promise<unknown> {
    return await this.send('notify', { title, message });
  }

  // ── Bookmarks ───────────────────────────────────────────────

  async bookmarkList(query?: string): Promise<unknown> {
    return await this.send('bookmarkList', { query });
  }

  async bookmarkCreate(
    title: string,
    url: string,
    parentId?: string,
  ): Promise<unknown> {
    return await this.send('bookmarkCreate', { title, url, parentId });
  }

  async bookmarkDelete(id: string): Promise<void> {
    await this.send('bookmarkDelete', { id });
  }

  // ── Top Sites ───────────────────────────────────────────────

  async topSites(): Promise<unknown> {
    return await this.send('topSites');
  }

  // ── Clipboard ───────────────────────────────────────────────

  async clipboardRead(tabId?: number): Promise<unknown> {
    return await this.send('clipboardRead', { tabId });
  }

  async clipboardWrite(text: string, tabId?: number): Promise<void> {
    await this.send('clipboardWrite', { text, tabId });
  }

  // ── Crash Recovery ──────────────────────────────────────────

  private attemptRecovery(): void {
    if (this._recovering || this._intentionalClose) return;
    if (this._recoverAttempts >= this._maxRecoverAttempts) {
      log.error(`Recovery failed after ${this._maxRecoverAttempts} attempts — giving up`);
      return;
    }
    this._recovering = true;
    this._recoverAttempts++;

    const delay = Math.min(1000 * Math.pow(2, this._recoverAttempts - 1), 10_000);
    log.debug(`Recovery attempt ${this._recoverAttempts}/${this._maxRecoverAttempts} in ${delay}ms`);

    setTimeout(() => {
      this.recover().catch((err) => {
        log.error('Recovery failed:', err instanceof Error ? err.message : String(err));
        this._recovering = false;
        // Retry if attempts remain
        this.attemptRecovery();
      });
    }, delay);
  }

  private async recover(): Promise<void> {
    // Save current tab URLs before recovery (if available from last known state)
    log.debug('Recovering session:', this._sessionId);

    // Close stale WS connection
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    // Re-prepare extension with current port + token (reuses existing WS server)
    this.prepareSessionExtension();

    // Re-launch Chrome with the same profile directory (preserves cookies, localStorage)
    this.launchChrome();

    // Wait for extension to reconnect
    await this.waitForExtension();

    this._recovering = false;
    this._recoverAttempts = 0; // Reset on successful recovery
    log.debug('Recovery successful for session:', this._sessionId);
  }

  // ── Cleanup ─────────────────────────────────────────────────

  async close(): Promise<void> {
    this._intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.chromeProcess && !this.chromeProcess.killed) {
      // Kill the detached process group (negative PID kills the entire group)
      try { process.kill(-this.chromeProcess.pid!, 'SIGTERM'); } catch {
        this.chromeProcess.kill('SIGTERM');
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try { process.kill(-this.chromeProcess!.pid!, 'SIGKILL'); } catch {
            this.chromeProcess?.kill('SIGKILL');
          }
          resolve();
        }, 5000);
        this.chromeProcess!.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
      this.chromeProcess = null;
    }

    // Clean up session metadata files (keep profile for persistence)
    try { fs.unlinkSync(path.join(this._sessionDir, 'port')); } catch {}
    try { fs.unlinkSync(path.join(this._sessionDir, 'pid')); } catch {}
    try { fs.unlinkSync(path.join(this._sessionDir, 'token')); } catch {}
    // Clean up extension copy (port-specific, recreated on next launch)
    try { fs.rmSync(this._extensionCopyDir, { recursive: true, force: true }); } catch {}
  }
}
