import { WebSocketServer, WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'child_process';
import { findChrome } from '../chrome/finder';
import { Deferred } from '../utils/deferred';
import { Logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const log = new Logger('ext-bridge');
const WS_PORT = 19222;
const PROFILE_DIR = path.join(os.homedir(), '.aly-browser', 'profile');

export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private chromeProcess: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, Deferred<unknown>>();

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async launch(options?: { url?: string }): Promise<void> {
    await this.startServer();

    // Always attempt to launch Chrome with our dedicated profile.
    // If Chrome is already running with this profile, the spawned process
    // simply delegates to the existing instance and exits immediately.
    this.launchChrome();

    await this.waitForExtension();

    if (options?.url) {
      await this.send('navigate', { url: options.url });
    }
  }

  private async startServer(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.wss = new WebSocketServer({ port: WS_PORT });
          this.wss.on('listening', () => {
            log.debug('WS server on port', WS_PORT);
            resolve();
          });
          this.wss.on('error', reject);
        });
        return;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE' && attempt < 2) {
          log.debug(`Port ${WS_PORT} busy, retrying in 1s... (attempt ${attempt + 1})`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }
  }

  private launchChrome(): void {
    const chromePath = findChrome();
    fs.mkdirSync(PROFILE_DIR, { recursive: true });

    const extensionDir = this.resolveExtensionDir();

    const flags = [
      `--user-data-dir=${PROFILE_DIR}`,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--no-first-run',
      '--disable-popup-blocking',
      '--window-size=1280,720',
    ];

    if (extensionDir) {
      flags.push(`--load-extension=${extensionDir}`);
    }

    log.debug('Launch:', chromePath, 'profile:', PROFILE_DIR);
    this.chromeProcess = spawn(chromePath, flags, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // If Chrome is already running with our profile, the spawned process
    // delegates to the existing instance and exits immediately.
    // Clear the handle so close() won't try to kill it.
    this.chromeProcess.on('exit', () => {
      this.chromeProcess = null;
    });

    this.chromeProcess.stderr?.on('data', (c: Buffer) =>
      log.debug('chrome:', c.toString().trim()),
    );
    this.chromeProcess.on('error', (e) => log.error('chrome error:', e.message));
  }

  private resolveExtensionDir(): string | null {
    // Handle both CJS (__dirname) and ESM (import.meta.url)
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
    const timeout = setTimeout(
      () => deferred.reject(new Error('Extension connect timeout (30s)')),
      30_000,
    );

    this.wss!.on('connection', (ws) => {
      log.debug('Extension connected');
      this.ws = ws;

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'ready') {
          log.debug('Extension ready, tab:', msg.tabId);
          clearTimeout(timeout);
          deferred.resolve();
          return;
        }
        if (msg.type === 'ping' || msg.type === 'alarm') return;

        if (msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
          }
        }
      });

      ws.on('close', () => {
        this.ws = null;
      });
    });

    return deferred.promise;
  }

  async send(action: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Extension not connected');
    }

    const id = this.nextId++;
    const deferred = new Deferred<unknown>();
    this.pending.set(id, deferred);
    this.ws.send(JSON.stringify({ id, action, params }));

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

  async snapshot(tabId?: number): Promise<string> {
    return (await this.send('snapshot', { tabId })) as string;
  }

  async click(ref: string, tabId?: number): Promise<void> {
    await this.send('click', { ref, tabId });
  }

  async type(
    ref: string,
    text: string,
    opts?: { clear?: boolean; tabId?: number },
  ): Promise<void> {
    await this.send('type', { ref, text, clear: opts?.clear ?? false, tabId: opts?.tabId });
  }

  async selectOption(ref: string, value: string, tabId?: number): Promise<void> {
    await this.send('select', { ref, value, tabId });
  }

  async hover(ref: string, tabId?: number): Promise<void> {
    await this.send('hover', { ref, tabId });
  }

  async evaluate(expression: string, tabId?: number): Promise<unknown> {
    return await this.send('evaluate', { expression, tabId });
  }

  async waitForSelector(
    selector: string,
    opts?: { timeout?: number; hidden?: boolean; tabId?: number },
  ): Promise<void> {
    await this.send('waitForSelector', {
      selector, timeout: opts?.timeout, hidden: opts?.hidden, tabId: opts?.tabId,
    });
  }

  async waitForStable(
    opts?: { timeout?: number; stableMs?: number; tabId?: number },
  ): Promise<void> {
    await this.send('waitForStable', {
      timeout: opts?.timeout, stableMs: opts?.stableMs, tabId: opts?.tabId,
    });
  }

  async scrollBy(opts: { x?: number; y?: number; tabId?: number }): Promise<void> {
    await this.send('scrollBy', { x: opts.x ?? 0, y: opts.y ?? 0, tabId: opts.tabId });
  }

  async goBack(tabId?: number): Promise<void> {
    await this.send('goBack', { tabId });
  }

  async goForward(tabId?: number): Promise<void> {
    await this.send('goForward', { tabId });
  }

  async getHTML(tabId?: number): Promise<string> {
    return (await this.send('getHTML', { tabId })) as string;
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

  // ── Cleanup ─────────────────────────────────────────────────

  async close(): Promise<void> {
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
      this.chromeProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          this.chromeProcess?.kill('SIGKILL');
          resolve();
        }, 5000);
        this.chromeProcess!.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
      this.chromeProcess = null;
    }

    // Keep persistent profile — don't delete on close
  }
}
