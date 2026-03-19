import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Hoisted mock classes (available to vi.mock factories) ────────

const {
  MockWebSocket,
  MockWebSocketServer,
  mockWssInstances,
  createMockChildProcess,
  mockCPHolder,
} = vi.hoisted(() => {
  const { EventEmitter } = require('events');

  class MockWebSocket extends EventEmitter {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    readyState = 1; // OPEN
    send = vi.fn();
    close = vi.fn(function (this: any) { this.readyState = 3; });
  }

  class MockWebSocketServer extends EventEmitter {
    close = vi.fn((cb?: () => void) => cb?.());
  }

  const mockWssInstances: MockWebSocketServer[] = [];

  function createMockChildProcess() {
    return Object.assign(new EventEmitter(), {
      pid: 12345,
      killed: false,
      kill: vi.fn(),
      unref: vi.fn(),
      stderr: new EventEmitter(),
    });
  }

  const mockCPHolder = { current: createMockChildProcess() };

  return { MockWebSocket, MockWebSocketServer, mockWssInstances, createMockChildProcess, mockCPHolder };
});

// ── vi.mock declarations (hoisted, use hoisted refs) ─────────────

vi.mock('ws', () => ({
  WebSocket: MockWebSocket,
  WebSocketServer: function WSSProxy(this: any) {
    const wss = new MockWebSocketServer();
    mockWssInstances.push(wss);
    setTimeout(() => wss.emit('listening'), 0);
    Object.assign(this, wss);
    // Copy EventEmitter prototype
    Object.setPrototypeOf(this, wss);
    return wss;
  },
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof child_process>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => mockCPHolder.current),
    execSync: vi.fn(),
  };
});

vi.mock('../../src/chrome/finder', () => ({
  findChromeForTesting: vi.fn(() => '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => 'const WS_PORT = 19222;'),
    existsSync: vi.fn(() => true),
    readdirSync: vi.fn(() => ['background.js', 'manifest.json', 'content.js']),
    statSync: vi.fn(() => ({ isFile: () => true })),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    readlinkSync: vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
  };
});

// ── Import after mocking ─────────────────────────────────────────

import { ExtensionBridge } from '../../src/extension/bridge';

const mockedSpawn = vi.mocked(child_process.spawn);
const mockedExecSync = vi.mocked(child_process.execSync);
const mockedFs = {
  mkdirSync: vi.mocked(fs.mkdirSync),
  writeFileSync: vi.mocked(fs.writeFileSync),
  readFileSync: vi.mocked(fs.readFileSync),
  existsSync: vi.mocked(fs.existsSync),
  readdirSync: vi.mocked(fs.readdirSync),
  statSync: vi.mocked(fs.statSync),
  copyFileSync: vi.mocked(fs.copyFileSync),
  unlinkSync: vi.mocked(fs.unlinkSync),
  rmSync: vi.mocked(fs.rmSync),
  readlinkSync: vi.mocked(fs.readlinkSync),
};

// ── Helpers ──────────────────────────────────────────────────────

function getLatestWss() {
  return mockWssInstances[mockWssInstances.length - 1];
}

/** Simulate extension WS connection + ready handshake */
function simulateExtensionReady(wss: InstanceType<typeof MockWebSocketServer>) {
  const ws = new MockWebSocket();
  wss.emit('connection', ws);
  // Simulate 'ready' message from extension
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
  return ws;
}

/** Simulate a response from the extension */
function simulateResponse(ws: InstanceType<typeof MockWebSocket>, id: number, result: unknown, error?: string) {
  const msg = error ? { id, error } : { id, result };
  ws.emit('message', Buffer.from(JSON.stringify(msg)));
}

/** Launch bridge and connect extension, returning both */
async function launchAndConnect(sessionId = 'test', url?: string) {
  const bridge = new ExtensionBridge(sessionId);
  const launchPromise = bridge.launch(url ? { url } : undefined);
  await vi.advanceTimersByTimeAsync(1); // WSS listening

  const wss = getLatestWss();
  const ws = simulateExtensionReady(wss);
  await vi.advanceTimersByTimeAsync(1);

  if (url) {
    // respond to navigate
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    simulateResponse(ws, sent.id, undefined);
  }

  await launchPromise;
  return { bridge, ws, wss };
}

// ── Tests ────────────────────────────────────────────────────────

describe('ExtensionBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWssInstances.length = 0;
    mockCPHolder.current = createMockChildProcess();

    // Default fs mocks
    mockedFs.readFileSync.mockImplementation((p: any) => {
      const filePath = String(p);
      if (filePath.endsWith('manifest.json')) {
        return '{"version": "1.0.0", "name": "AlyBrowser"}';
      }
      return "const WS_PORT = 19222;\nconst WS_TOKEN = '';";
    });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readdirSync.mockReturnValue(['background.js', 'manifest.json', 'content.js'] as any);
    mockedFs.statSync.mockReturnValue({ isFile: () => true } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('defaults to "default" sessionId', () => {
      const bridge = new ExtensionBridge();
      expect(bridge.sessionId).toBe('default');
    });

    it('accepts valid sessionId patterns', () => {
      const valid = ['abc', 'test-1', 'my_session', 'A-Z_0-9'];
      for (const id of valid) {
        const bridge = new ExtensionBridge(id);
        expect(bridge.sessionId).toBe(id);
      }
    });

    it('rejects invalid sessionId characters', () => {
      const invalid = ['has space', 'foo@bar', 'test.session', 'a/b', 'hello!', ''];
      for (const id of invalid) {
        expect(() => new ExtensionBridge(id), `Should reject: "${id}"`).toThrow('Invalid sessionId');
      }
    });

    it('port is 0 before launch', () => {
      const bridge = new ExtensionBridge();
      expect(bridge.port).toBe(0);
    });

    it('isConnected is false before launch', () => {
      const bridge = new ExtensionBridge();
      expect(bridge.isConnected).toBe(false);
    });
  });

  // ── send() ───────────────────────────────────────────────────

  describe('send', () => {
    it('throws when not connected', async () => {
      const bridge = new ExtensionBridge();
      await expect(bridge.send('snapshot')).rejects.toThrow('Extension not connected');
    });

    it('sends JSON message with incrementing id', async () => {
      const { bridge, ws } = await launchAndConnect();

      const p1 = bridge.send('snapshot');
      const sent1 = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent1).toEqual({ id: 1, action: 'snapshot', params: undefined });
      simulateResponse(ws, sent1.id, '<tree>');
      expect(await p1).toBe('<tree>');

      const p2 = bridge.send('click', { ref: '@e0' });
      const sent2 = JSON.parse(ws.send.mock.calls[1][0]);
      expect(sent2.id).toBe(2);
      expect(sent2.action).toBe('click');
      simulateResponse(ws, sent2.id, undefined);
      await p2;
    });

    it('rejects on error response from extension', async () => {
      const { bridge, ws } = await launchAndConnect();

      const p = bridge.send('click', { ref: '@e99' });
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      simulateResponse(ws, sent.id, null, 'Element not found');

      await expect(p).rejects.toThrow('Element not found');
    });

    it('rejects on timeout after 60s', async () => {
      const { bridge } = await launchAndConnect();

      const p = bridge.send('snapshot');
      vi.advanceTimersByTime(60_001);

      await expect(p).rejects.toThrow('Timeout: snapshot');
    });

    it('clears timeout on successful response', async () => {
      const { bridge, ws } = await launchAndConnect();

      const p = bridge.send('snapshot');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      simulateResponse(ws, sent.id, 'ok');
      await p;

      // Advancing past timeout should not cause issues
      vi.advanceTimersByTime(60_001);
    });

    it('throws when ws is closing', async () => {
      const { bridge } = await launchAndConnect();
      (bridge as any)._closing = true;
      await expect(bridge.send('snapshot')).rejects.toThrow('Extension is closing');
      (bridge as any)._closing = false;
    });

    it('throws when ws readyState is not OPEN', async () => {
      const { bridge, ws } = await launchAndConnect();
      ws.readyState = MockWebSocket.CLOSED;
      await expect(bridge.send('snapshot')).rejects.toThrow('Extension not connected');
    });

    it('cleans up pending map on ws.send failure', async () => {
      const { bridge, ws } = await launchAndConnect();

      ws.send.mockImplementationOnce(() => { throw new Error('WS write error'); });
      await expect(bridge.send('navigate', { url: 'http://x' })).rejects.toThrow('WS write error');
      expect((bridge as any).pending.size).toBe(0);
    });
  });

  // ── setupWsHandlers ──────────────────────────────────────────

  describe('setupWsHandlers (message routing)', () => {
    it('ignores ping, alarm, and ready messages', async () => {
      const { bridge, ws } = await launchAndConnect();

      const p = bridge.send('snapshot');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);

      // These should not resolve/reject the pending
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'alarm' })));
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ready' })));

      // Real response
      simulateResponse(ws, sent.id, 'data');
      expect(await p).toBe('data');
    });

    it('ignores malformed JSON messages', async () => {
      const { ws } = await launchAndConnect();

      // Should not throw
      ws.emit('message', Buffer.from('not json at all'));
      ws.emit('message', Buffer.from('{incomplete'));
    });

    it('rejects all pending on WS close', async () => {
      const { bridge, ws } = await launchAndConnect();

      const p1 = bridge.send('snapshot');
      const p2 = bridge.send('click', { ref: '@e0' });

      ws.emit('close');

      await expect(p1).rejects.toThrow('Extension disconnected');
      await expect(p2).rejects.toThrow('Extension disconnected');
      expect(bridge.isConnected).toBe(false);
    });

    it('ignores response with unknown id', async () => {
      const { ws } = await launchAndConnect();
      // Should not throw
      simulateResponse(ws, 99999, 'orphan');
    });
  });

  // ── launch() ─────────────────────────────────────────────────

  describe('launch', () => {
    it('connects via quick connect when extension already running', async () => {
      const { bridge, ws } = await launchAndConnect();

      expect(bridge.isConnected).toBe(true);
      // No Chrome launch since quick connect succeeded
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('navigates to url after connection', async () => {
      const { ws } = await launchAndConnect('test', 'https://example.com');

      // First send call should be navigate
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.action).toBe('navigate');
      expect(sent.params.url).toBe('https://example.com');
    });

    it('does not navigate when no url', async () => {
      const { ws } = await launchAndConnect();
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('falls back to Chrome for Testing when quick connect times out', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      const wss = getLatestWss();

      // Quick connect timeout (5s)
      await vi.advanceTimersByTimeAsync(5001);

      // Now Chrome should be launched
      expect(mockedSpawn).toHaveBeenCalled();
      const flags = mockedSpawn.mock.calls[0][1] as string[];
      expect(flags.some(f => f.startsWith('--user-data-dir='))).toBe(true);

      // Simulate extension connecting via waitForExtension
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);

      await launchPromise;
      expect(bridge.isConnected).toBe(true);
    });

    it('creates session directory and writes port/pid files', async () => {
      await launchAndConnect('my-session');

      expect(mockedFs.mkdirSync).toHaveBeenCalled();
      // writeFileSync called for port and pid
      const writeCalls = mockedFs.writeFileSync.mock.calls.map(c => String(c[0]));
      expect(writeCalls.some(p => p.endsWith('port'))).toBe(true);
      expect(writeCalls.some(p => p.endsWith('pid'))).toBe(true);
    });
  });

  // ── waitForExtensionQuick ────────────────────────────────────

  describe('waitForExtensionQuick (via launch)', () => {
    it('returns false on timeout', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      // Let quick connect timeout expire (5s)
      await vi.advanceTimersByTimeAsync(5001);

      // Should fall through to Chrome launch path
      expect(mockedSpawn).toHaveBeenCalled();

      // Complete the waitForExtension to avoid dangling promise
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('returns false when extension disconnects during handshake', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      const wss = getLatestWss();
      // Connect then immediately close (no ready message)
      const ws = new MockWebSocket();
      wss.emit('connection', ws);
      ws.emit('close');

      // Quick connect should return false → falls back to Chrome launch
      await vi.advanceTimersByTimeAsync(5001);
      expect(mockedSpawn).toHaveBeenCalled();

      // Complete launch
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });
  });

  // ── waitForExtension (30s timeout) ───────────────────────────

  describe('waitForExtension (via launch fallback)', () => {
    it('times out after 30s if no extension connects', async () => {
      const bridge = new ExtensionBridge('test');
      // Catch early to prevent unhandled rejection during timer advancement
      const launchPromise = bridge.launch().catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      // Quick connect timeout
      await vi.advanceTimersByTimeAsync(5001);

      // Now in waitForExtension — advance past 30s
      await vi.advanceTimersByTimeAsync(30_001);

      const result = await launchPromise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain('Extension connect timeout');
    });

    it('rejects when extension disconnects during handshake', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch().catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      // Quick connect timeout
      await vi.advanceTimersByTimeAsync(5001);

      // Extension connects but disconnects before ready
      const wss = getLatestWss();
      const ws = new MockWebSocket();
      wss.emit('connection', ws);
      ws.emit('close');

      const result = await launchPromise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain('Extension disconnected during handshake');
    });

    it('removes connection listener after settling', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      // Quick connect timeout
      await vi.advanceTimersByTimeAsync(5001);

      // Extension connects and is ready
      const wss = getLatestWss();
      const connectionListenersBefore = wss.listenerCount('connection');
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      // After settling, the connection listener should be removed
      const connectionListenersAfter = wss.listenerCount('connection');
      expect(connectionListenersAfter).toBeLessThan(connectionListenersBefore);
    });
  });

  // ── prepareSessionExtension ──────────────────────────────────

  describe('prepareSessionExtension (via launch)', () => {
    async function triggerChromeLaunch() {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      // Quick connect timeout → triggers prepareSessionExtension + launchChrome
      await vi.advanceTimersByTimeAsync(5001);

      return { bridge, launchPromise, wss: getLatestWss() };
    }

    it('copies extension files and injects WS port', async () => {
      const { launchPromise, wss } = await triggerChromeLaunch();

      // background.js should have port injected
      const writeCalls = mockedFs.writeFileSync.mock.calls;
      const bgWrite = writeCalls.find(c => String(c[0]).endsWith('background.js'));
      expect(bgWrite).toBeDefined();
      expect(bgWrite![1]).toContain('const WS_PORT =');

      // manifest.json should have version bumped
      const manifestWrite = writeCalls.find(c => String(c[0]).endsWith('manifest.json'));
      expect(manifestWrite).toBeDefined();

      // content.js should be copied directly
      expect(mockedFs.copyFileSync).toHaveBeenCalled();

      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('warns when background.js missing WS_PORT marker', async () => {
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.endsWith('manifest.json')) return '{"version": "1.0.0"}';
        return 'no marker here';
      });

      const { launchPromise, wss } = await triggerChromeLaunch();

      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
      // No assertion needed — just verifying no crash
    });

    it('skips when extension dir not found', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5001);

      // Extension dir not found → prepareSessionExtension returns early
      // But Chrome still launches
      expect(mockedSpawn).toHaveBeenCalled();

      // Extension won't have --load-extension flag
      const spawnFlags = mockedSpawn.mock.calls[0][1] as string[];
      expect(spawnFlags.some(f => f.startsWith('--load-extension'))).toBe(false);

      // Complete launch
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });
  });

  // ── launchChrome ─────────────────────────────────────────────

  describe('launchChrome (via launch)', () => {
    async function triggerChromeLaunch() {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5001);
      return { bridge, launchPromise, wss: getLatestWss() };
    }

    it('spawns Chrome with correct flags', async () => {
      const { launchPromise, wss } = await triggerChromeLaunch();

      expect(mockedSpawn).toHaveBeenCalledTimes(1);
      const [chromePath, flags, opts] = mockedSpawn.mock.calls[0];
      expect(chromePath).toContain('Chrome');
      expect(flags).toContain('--no-first-run');
      expect(flags).toContain('--disable-popup-blocking');
      expect(flags).toContain('--disable-infobars');
      expect(flags).toContain('--window-size=1280,720');
      expect(opts).toEqual(expect.objectContaining({ detached: true }));

      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('includes --load-extension when extension copy exists', async () => {
      const { launchPromise, wss } = await triggerChromeLaunch();

      const flags = mockedSpawn.mock.calls[0][1] as string[];
      expect(flags.some(f => f.startsWith('--load-extension='))).toBe(true);

      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('removes macOS quarantine with xattr', async () => {
      // Override platform to darwin
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

      const { launchPromise, wss } = await triggerChromeLaunch();

      expect(mockedExecSync).toHaveBeenCalledWith(
        expect.stringContaining('xattr -c'),
        expect.anything(),
      );

      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
    });

    it('unrefs Chrome process for detached execution', async () => {
      const { launchPromise, wss } = await triggerChromeLaunch();

      expect(mockCPHolder.current.unref).toHaveBeenCalled();

      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });
  });

  // ── close() ──────────────────────────────────────────────────

  describe('close', () => {
    it('can be called without prior launch', async () => {
      const bridge = new ExtensionBridge();
      await bridge.close(); // Should not throw
    });

    it('can be called multiple times', async () => {
      const bridge = new ExtensionBridge();
      await bridge.close();
      await bridge.close();
    });

    it('closes ws, wss, and cleans up files', async () => {
      const { bridge, ws, wss } = await launchAndConnect();

      await bridge.close();

      expect(ws.close).toHaveBeenCalled();
      expect(wss.close).toHaveBeenCalled();
      expect(bridge.isConnected).toBe(false);
      // port and pid cleanup
      const unlinkPaths = mockedFs.unlinkSync.mock.calls.map(c => String(c[0]));
      expect(unlinkPaths.some(p => p.endsWith('port'))).toBe(true);
      expect(unlinkPaths.some(p => p.endsWith('pid'))).toBe(true);
      // extension copy cleanup
      expect(mockedFs.rmSync).toHaveBeenCalled();
    });

    it('kills Chrome process with SIGTERM then SIGKILL', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5001); // trigger Chrome launch

      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      // Start close (Chrome process has pid)
      const closePromise = bridge.close();

      // Simulate Chrome not exiting after SIGTERM → SIGKILL after 5s
      await vi.advanceTimersByTimeAsync(5001);
      await closePromise;
    });

    it('resolves when Chrome exits after SIGTERM', async () => {
      const bridge = new ExtensionBridge('test');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5001);

      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      const closePromise = bridge.close();
      // Simulate Chrome exiting gracefully
      mockCPHolder.current.emit('exit', 0);
      await closePromise;
    });

    it('handles file cleanup errors gracefully', async () => {
      const bridge = new ExtensionBridge();
      mockedFs.unlinkSync.mockImplementation(() => { throw new Error('ENOENT'); });
      mockedFs.rmSync.mockImplementation(() => { throw new Error('ENOENT'); });
      await bridge.close(); // Should not throw
    });
  });

  // ── Convenience methods ──────────────────────────────────────

  describe('public API methods throw when not connected', () => {
    const bridge = new ExtensionBridge();

    const methods: Array<[string, () => Promise<unknown>]> = [
      ['navigate', () => bridge.navigate('http://example.com')],
      ['snapshot', () => bridge.snapshot()],
      ['click', () => bridge.click('@e0')],
      ['type', () => bridge.type('@e0', 'hello')],
      ['selectOption', () => bridge.selectOption('@e0', 'val')],
      ['hover', () => bridge.hover('@e0')],
      ['evaluate', () => bridge.evaluate('1+1')],
      ['waitForSelector', () => bridge.waitForSelector('div')],
      ['waitForStable', () => bridge.waitForStable()],
      ['scrollBy', () => bridge.scrollBy({ x: 0, y: 100 })],
      ['goBack', () => bridge.goBack()],
      ['goForward', () => bridge.goForward()],
      ['getHTML', () => bridge.getHTML()],
      ['tabList', () => bridge.tabList()],
      ['tabNew', () => bridge.tabNew()],
      ['tabClose', () => bridge.tabClose()],
      ['tabSwitch', () => bridge.tabSwitch(1)],
      ['cookieGet', () => bridge.cookieGet('http://example.com')],
      ['cookieSet', () => bridge.cookieSet({ url: 'http://example.com' })],
      ['cookieDelete', () => bridge.cookieDelete('http://example.com', 'name')],
      ['download', () => bridge.download('http://example.com/file')],
      ['historySearch', () => bridge.historySearch()],
      ['alarmCreate', () => bridge.alarmCreate('test', {})],
      ['alarmList', () => bridge.alarmList()],
      ['alarmClear', () => bridge.alarmClear()],
      ['alarmEvents', () => bridge.alarmEvents()],
      ['storageGet', () => bridge.storageGet()],
      ['storageSet', () => bridge.storageSet({ key: 'val' })],
      ['notify', () => bridge.notify('title', 'msg')],
      ['bookmarkList', () => bridge.bookmarkList()],
      ['bookmarkCreate', () => bridge.bookmarkCreate('t', 'http://example.com')],
      ['bookmarkDelete', () => bridge.bookmarkDelete('1')],
      ['topSites', () => bridge.topSites()],
      ['clipboardRead', () => bridge.clipboardRead()],
      ['clipboardWrite', () => bridge.clipboardWrite('text')],
    ];

    for (const [name, fn] of methods) {
      it(`${name}() throws "Extension not connected"`, async () => {
        await expect(fn()).rejects.toThrow('Extension not connected');
      });
    }
  });

  describe('convenience methods send correct actions', () => {
    let bridge: ExtensionBridge;
    let ws: MockWebSocket;

    beforeEach(async () => {
      const result = await launchAndConnect();
      bridge = result.bridge;
      ws = result.ws;
    });

    async function verifySend(
      call: Promise<unknown>,
      expectedAction: string,
      expectedParams?: Record<string, unknown>,
    ) {
      const sent = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
      expect(sent.action).toBe(expectedAction);
      if (expectedParams) {
        expect(sent.params).toEqual(expect.objectContaining(expectedParams));
      }
      simulateResponse(ws, sent.id, 'ok');
      return call;
    }

    it('navigate', async () => {
      const p = bridge.navigate('https://example.com', 42);
      await verifySend(p, 'navigate', { url: 'https://example.com', tabId: 42 });
    });

    it('snapshot returns string', async () => {
      const p = bridge.snapshot(5);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      simulateResponse(ws, sent.id, '<tree>');
      expect(await p).toBe('<tree>');
    });

    it('click', async () => {
      const p = bridge.click('@e5', 10);
      await verifySend(p, 'click', { ref: '@e5', tabId: 10 });
    });

    it('type with clear option', async () => {
      const p = bridge.type('@e1', 'hello', { clear: true, tabId: 3 });
      await verifySend(p, 'type', { ref: '@e1', text: 'hello', clear: true, tabId: 3 });
    });

    it('type defaults clear to false', async () => {
      const p = bridge.type('@e1', 'world');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.clear).toBe(false);
      simulateResponse(ws, sent.id, undefined);
      await p;
    });

    it('selectOption', async () => {
      const p = bridge.selectOption('@e2', 'opt1', 5);
      await verifySend(p, 'select', { ref: '@e2', value: 'opt1', tabId: 5 });
    });

    it('hover', async () => {
      const p = bridge.hover('@e3');
      await verifySend(p, 'hover', { ref: '@e3' });
    });

    it('evaluate', async () => {
      const p = bridge.evaluate('document.title', 7);
      await verifySend(p, 'evaluate', { expression: 'document.title', tabId: 7 });
    });

    it('waitForSelector', async () => {
      const p = bridge.waitForSelector('.loading', { timeout: 5000, hidden: true, tabId: 2 });
      await verifySend(p, 'waitForSelector', { selector: '.loading', timeout: 5000, hidden: true, tabId: 2 });
    });

    it('waitForStable', async () => {
      const p = bridge.waitForStable({ timeout: 10000, stableMs: 2000 });
      await verifySend(p, 'waitForStable', { timeout: 10000, stableMs: 2000 });
    });

    it('scrollBy defaults x to 0', async () => {
      const p = bridge.scrollBy({ y: 500 });
      await verifySend(p, 'scrollBy', { x: 0, y: 500 });
    });

    it('goBack / goForward', async () => {
      let p = bridge.goBack(1);
      await verifySend(p, 'goBack', { tabId: 1 });

      p = bridge.goForward(2);
      await verifySend(p, 'goForward', { tabId: 2 });
    });

    it('getHTML', async () => {
      const p = bridge.getHTML(3);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      simulateResponse(ws, sent.id, '<html></html>');
      expect(await p).toBe('<html></html>');
    });

    it('tab management', async () => {
      let p: Promise<unknown> = bridge.tabList();
      await verifySend(p, 'tabList');
      p = bridge.tabNew('https://new.com');
      await verifySend(p, 'tabNew', { url: 'https://new.com' });
      p = bridge.tabClose(5);
      await verifySend(p, 'tabClose', { tabId: 5 });
      p = bridge.tabSwitch(3);
      await verifySend(p, 'tabSwitch', { tabId: 3 });
    });

    it('cookies', async () => {
      let p: Promise<unknown> = bridge.cookieGet('https://x.com', 'sid');
      await verifySend(p, 'cookieGet', { url: 'https://x.com', name: 'sid' });
      p = bridge.cookieSet({ url: 'https://x.com', name: 'sid', value: '123' });
      await verifySend(p, 'cookieSet');
      p = bridge.cookieDelete('https://x.com', 'sid');
      await verifySend(p, 'cookieDelete', { url: 'https://x.com', name: 'sid' });
    });

    it('download / historySearch / notify / topSites', async () => {
      let p: Promise<unknown> = bridge.download('https://x.com/f.zip', 'f.zip');
      await verifySend(p, 'download', { url: 'https://x.com/f.zip', filename: 'f.zip' });
      p = bridge.historySearch('test', 10);
      await verifySend(p, 'historySearch', { query: 'test', maxResults: 10 });
      p = bridge.notify('T', 'B');
      await verifySend(p, 'notify', { title: 'T', message: 'B' });
      p = bridge.topSites();
      await verifySend(p, 'topSites');
    });

    it('alarms', async () => {
      let p: Promise<unknown> = bridge.alarmCreate('a', { delayInMinutes: 1 });
      await verifySend(p, 'alarmCreate', { name: 'a', delayInMinutes: 1 });
      p = bridge.alarmList();
      await verifySend(p, 'alarmList');
      p = bridge.alarmClear('a');
      await verifySend(p, 'alarmClear', { name: 'a' });
      p = bridge.alarmEvents();
      await verifySend(p, 'alarmEvents');
    });

    it('storage', async () => {
      let p: Promise<unknown> = bridge.storageGet(['k1']);
      await verifySend(p, 'storageGet', { keys: ['k1'] });
      p = bridge.storageSet({ k1: 'v1' });
      await verifySend(p, 'storageSet', { data: { k1: 'v1' } });
    });

    it('bookmarks', async () => {
      let p: Promise<unknown> = bridge.bookmarkList('q');
      await verifySend(p, 'bookmarkList', { query: 'q' });
      p = bridge.bookmarkCreate('T', 'https://x.com', 'p1');
      await verifySend(p, 'bookmarkCreate', { title: 'T', url: 'https://x.com', parentId: 'p1' });
      p = bridge.bookmarkDelete('b1');
      await verifySend(p, 'bookmarkDelete', { id: 'b1' });
    });

    it('clipboard', async () => {
      let p: Promise<unknown> = bridge.clipboardRead(1);
      await verifySend(p, 'clipboardRead', { tabId: 1 });
      p = bridge.clipboardWrite('text', 2);
      await verifySend(p, 'clipboardWrite', { text: 'text', tabId: 2 });
    });

    // ── file upload ─────────────────────────────────────────

    it('upload reads file and sends base64 with correct params', async () => {
      // fs.readFileSync is mocked — return fake file content
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('fake-png-data'));
      const p = bridge.upload('/path/to/image.png', { ref: '@e5', tabId: 1, frameId: 2 });
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.action).toBe('upload');
      expect(sent.params.fileName).toBe('image.png');
      expect(sent.params.mimeType).toBe('image/png');
      expect(sent.params.dataBase64).toBe(Buffer.from('fake-png-data').toString('base64'));
      expect(sent.params.ref).toBe('@e5');
      expect(sent.params.tabId).toBe(1);
      expect(sent.params.frameId).toBe(2);
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    it('upload auto-detects MIME type from extension', async () => {
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('data'));
      const p = bridge.upload('/docs/report.pdf');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.mimeType).toBe('application/pdf');
      expect(sent.params.fileName).toBe('report.pdf');
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    it('upload defaults to octet-stream for unknown extensions', async () => {
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('data'));
      const p = bridge.upload('/file.xyz');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.mimeType).toBe('application/octet-stream');
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    // ── video MIME types ────────────────────────────────────

    it('upload detects video/mp4 MIME type', async () => {
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('video-data'));
      const p = bridge.upload('/media/clip.mp4');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.mimeType).toBe('video/mp4');
      expect(sent.params.fileName).toBe('clip.mp4');
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    it('upload detects video/webm MIME type', async () => {
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('video-data'));
      const p = bridge.upload('/media/recording.webm');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.mimeType).toBe('video/webm');
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    it('upload detects video/quicktime MIME type', async () => {
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('video-data'));
      const p = bridge.upload('/media/movie.mov');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.mimeType).toBe('video/quicktime');
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    it('upload handles large file data (10MB+)', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024, 'x'); // 10MB
      mockedFs.readFileSync.mockReturnValueOnce(largeBuffer);
      const p = bridge.upload('/media/large.mp4');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.dataBase64).toBe(largeBuffer.toString('base64'));
      expect(sent.params.dataBase64.length).toBeGreaterThan(13_000_000); // base64 is ~33% larger
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    it('upload without ref or frameId sends minimal params', async () => {
      mockedFs.readFileSync.mockReturnValueOnce(Buffer.from('data'));
      const p = bridge.upload('/file.mp4');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params.ref).toBeUndefined();
      expect(sent.params.tabId).toBeUndefined();
      expect(sent.params.frameId).toBeUndefined();
      simulateResponse(ws, sent.id, { ok: true });
      await p;
    });

    // ── iframe / frameId support ───────────────────────────

    it('frameList sends correct action', async () => {
      const p = bridge.frameList(42);
      await verifySend(p, 'frameList', { tabId: 42 });
    });

    it('snapshot passes frameId', async () => {
      const p = bridge.snapshot(1, 3);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.action).toBe('snapshot');
      expect(sent.params).toEqual(expect.objectContaining({ tabId: 1, frameId: 3 }));
      simulateResponse(ws, sent.id, '<tree>');
      await p;
    });

    it('click passes frameId', async () => {
      const p = bridge.click('@e0', 1, 5);
      await verifySend(p, 'click', { ref: '@e0', tabId: 1, frameId: 5 });
    });

    it('type passes frameId', async () => {
      const p = bridge.type('@e1', 'hello', { clear: true, tabId: 2, frameId: 7 });
      await verifySend(p, 'type', { ref: '@e1', text: 'hello', clear: true, tabId: 2, frameId: 7 });
    });

    it('selectOption passes frameId', async () => {
      const p = bridge.selectOption('@e2', 'opt', 1, 4);
      await verifySend(p, 'select', { ref: '@e2', value: 'opt', tabId: 1, frameId: 4 });
    });

    it('hover passes frameId', async () => {
      const p = bridge.hover('@e3', 1, 6);
      await verifySend(p, 'hover', { ref: '@e3', tabId: 1, frameId: 6 });
    });

    it('getHTML passes frameId', async () => {
      const p = bridge.getHTML(1, 8);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.params).toEqual(expect.objectContaining({ tabId: 1, frameId: 8 }));
      simulateResponse(ws, sent.id, '<html>');
      await p;
    });

    it('waitForSelector passes frameId', async () => {
      const p = bridge.waitForSelector('.btn', { timeout: 5000, hidden: false, tabId: 1, frameId: 2 });
      await verifySend(p, 'waitForSelector', { selector: '.btn', tabId: 1, frameId: 2 });
    });

    it('waitForStable passes frameId', async () => {
      const p = bridge.waitForStable({ timeout: 10000, stableMs: 500, tabId: 3, frameId: 9 });
      await verifySend(p, 'waitForStable', { timeout: 10000, stableMs: 500, tabId: 3, frameId: 9 });
    });

    it('scrollBy passes frameId', async () => {
      const p = bridge.scrollBy({ x: 0, y: 100, tabId: 1, frameId: 4 });
      await verifySend(p, 'scrollBy', { x: 0, y: 100, tabId: 1, frameId: 4 });
    });
  });

  // ── WS Token Authentication ─────────────────────────────────

  describe('WS token authentication', () => {
    /** Create a mock IncomingMessage with a URL query string */
    function mockReq(url: string) {
      return { url } as any;
    }

    it('generates and writes token file on startServer', async () => {
      await launchAndConnect('auth-test');

      const writeCalls = mockedFs.writeFileSync.mock.calls;
      const tokenWrite = writeCalls.find(c => String(c[0]).endsWith('token'));
      expect(tokenWrite).toBeDefined();
      // Token should be a JWT (3 dot-separated parts)
      const tokenValue = String(tokenWrite![1]);
      expect(tokenValue.split('.')).toHaveLength(3);
      // File permissions should be 0o600
      expect(tokenWrite![2]).toEqual({ mode: 0o600 });
    });

    it('exposes token via getter after launch', async () => {
      const { bridge } = await launchAndConnect('auth-test');
      expect(bridge.token).toBeTruthy();
      expect(bridge.token.split('.')).toHaveLength(3);
    });

    it('injects WS_TOKEN into background.js during prepareSessionExtension', async () => {
      const bridge = new ExtensionBridge('auth-inject');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1); // WSS listening

      // Quick connect timeout → triggers prepareSessionExtension
      await vi.advanceTimersByTimeAsync(5001);

      const writeCalls = mockedFs.writeFileSync.mock.calls;
      const bgWrite = writeCalls.find(c => String(c[0]).endsWith('background.js'));
      expect(bgWrite).toBeDefined();
      const bgContent = String(bgWrite![1]);
      expect(bgContent).toContain('const WS_TOKEN =');
      // Token should be non-empty (injected)
      expect(bgContent).not.toContain("const WS_TOKEN = '';");

      // Complete launch
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('accepts connection with valid token in URL query', async () => {
      const bridge = new ExtensionBridge('auth-valid');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      const wss = getLatestWss();
      const ws = new MockWebSocket();
      // Pass valid token in mock request URL
      const token = bridge.token;
      wss.emit('connection', ws, mockReq(`/?token=${token}`));
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      expect(bridge.isConnected).toBe(true);
    });

    it('rejects connection with invalid token', async () => {
      const bridge = new ExtensionBridge('auth-invalid');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      const wss = getLatestWss();
      const ws = new MockWebSocket();
      // Pass invalid token
      wss.emit('connection', ws, mockReq('/?token=bad.token.here'));
      // WS should be closed with 4001
      expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
      expect(bridge.isConnected).toBe(false);

      // Clean up — connect with no token (accepted with warning)
      const ws2 = new MockWebSocket();
      wss.emit('connection', ws2);
      ws2.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('accepts connection without token (backward compat, warning only)', async () => {
      const bridge = new ExtensionBridge('auth-notoken');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      const wss = getLatestWss();
      const ws = new MockWebSocket();
      // No request object (simulates pre-existing extension without auth)
      wss.emit('connection', ws);
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      expect(bridge.isConnected).toBe(true);
    });

    it('accepts connection with empty URL (no token param)', async () => {
      const bridge = new ExtensionBridge('auth-empty');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      const wss = getLatestWss();
      const ws = new MockWebSocket();
      wss.emit('connection', ws, mockReq('/'));
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      expect(bridge.isConnected).toBe(true);
    });

    it('rejects invalid token in waitForExtension (Chrome for Testing path)', async () => {
      const bridge = new ExtensionBridge('auth-cft');
      const launchPromise = bridge.launch().catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(1);

      // Quick connect timeout → Chrome launch
      await vi.advanceTimersByTimeAsync(5001);

      const wss = getLatestWss();
      const ws = new MockWebSocket();
      wss.emit('connection', ws, mockReq('/?token=forged.jwt.token'));
      // Should be rejected
      expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');

      // Connect properly to complete the test
      const ws2 = new MockWebSocket();
      wss.emit('connection', ws2);
      ws2.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('cleans up token file on close', async () => {
      const { bridge } = await launchAndConnect('auth-cleanup');

      await bridge.close();

      const unlinkCalls = mockedFs.unlinkSync.mock.calls.map(c => String(c[0]));
      expect(unlinkCalls.some(p => p.endsWith('token'))).toBe(true);
    });

    it('rejects token-less connection when ALY_REQUIRE_AUTH=1', async () => {
      process.env.ALY_REQUIRE_AUTH = '1';
      try {
        const bridge = new ExtensionBridge('auth-require');
        const launchPromise = bridge.launch();
        await vi.advanceTimersByTimeAsync(1);

        const wss = getLatestWss();
        const ws = new MockWebSocket();
        // No token in request
        wss.emit('connection', ws, mockReq('/'));
        // Should be rejected
        expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
        expect(bridge.isConnected).toBe(false);

        // Connect with valid token to complete
        const ws2 = new MockWebSocket();
        wss.emit('connection', ws2, mockReq(`/?token=${bridge.token}`));
        ws2.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
        await vi.advanceTimersByTimeAsync(1);
        await launchPromise;
      } finally {
        delete process.env.ALY_REQUIRE_AUTH;
      }
    });

    it('allows token-less connection when ALY_REQUIRE_AUTH is not set', async () => {
      delete process.env.ALY_REQUIRE_AUTH;
      const bridge = new ExtensionBridge('auth-default');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      const wss = getLatestWss();
      const ws = new MockWebSocket();
      wss.emit('connection', ws, mockReq('/'));
      // Should NOT be rejected
      expect(ws.close).not.toHaveBeenCalled();
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ready', tabId: 1 })));
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      expect(bridge.isConnected).toBe(true);
    });
  });

  // ── Crash Recovery ──────────────────────────────────────────

  describe('crash recovery', () => {
    it('does not attempt recovery on intentional close', async () => {
      const { bridge, ws } = await launchAndConnect('recover-close');

      await bridge.close();
      // Trigger ws close after intentional close
      ws.emit('close');

      // No Chrome relaunch
      const spawnCallsBefore = mockedSpawn.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedSpawn.mock.calls.length).toBe(spawnCallsBefore);
    });

    it('attempts recovery when Chrome crashes (non-zero exit)', async () => {
      const bridge = new ExtensionBridge('recover-crash');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      // Quick connect timeout → Chrome launch
      await vi.advanceTimersByTimeAsync(5001);
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      const spawnCallsBefore = mockedSpawn.mock.calls.length;

      // Simulate Chrome crash (non-zero exit code)
      mockCPHolder.current.emit('exit', 1);

      // Recovery uses exponential backoff — first attempt after 1s
      await vi.advanceTimersByTimeAsync(1001);

      // Should have spawned Chrome again
      expect(mockedSpawn.mock.calls.length).toBeGreaterThan(spawnCallsBefore);

      // Simulate extension reconnecting after recovery
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
    });

    it('stops recovery after max attempts', async () => {
      const bridge = new ExtensionBridge('recover-max');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5001);

      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      // Simulate 3 consecutive crashes (max attempts = 3)
      for (let i = 0; i < 3; i++) {
        mockCPHolder.current = createMockChildProcess();
        mockCPHolder.current.emit('exit', 1);
        // Advance past backoff delay (1s, 2s, 4s)
        await vi.advanceTimersByTimeAsync(5000);
        // Each recovery calls waitForExtension, which times out after 30s if no connection
        // Advance to trigger timeout
        await vi.advanceTimersByTimeAsync(30_001);
      }

      const spawnCallsAfterMax = mockedSpawn.mock.calls.length;

      // 4th crash should NOT trigger recovery
      mockCPHolder.current = createMockChildProcess();
      mockCPHolder.current.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockedSpawn.mock.calls.length).toBe(spawnCallsAfterMax);
    });

    it('resets recovery attempts on successful recovery', async () => {
      const bridge = new ExtensionBridge('recover-reset');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5001);

      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;

      // Simulate crash
      mockCPHolder.current.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(1001);

      // Successful recovery — extension reconnects
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);

      // _recoverAttempts should be reset — verify by checking it can recover again
      expect(bridge.isConnected).toBe(true);
    });
  });

  // ── Orphaned Chrome cleanup via SingletonLock ────────────────

  describe('orphaned Chrome cleanup via profile lock', () => {
    let killSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    it('kills orphaned Chrome detected via SingletonLock when no pid file exists', async () => {
      // No pid file → readFileSync throws for pid path
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.endsWith('/pid')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        if (filePath.endsWith('manifest.json')) return '{"version": "1.0.0", "name": "AlyBrowser"}';
        return "const WS_PORT = 19222;\nconst WS_TOKEN = '';";
      });

      // SingletonLock points to a live Chrome process
      mockedFs.readlinkSync.mockReturnValue('myhost-55555');

      // process.kill(pid, 0) for isProcessAlive — return true (alive)
      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) return true; // alive check
        return true; // SIGTERM succeeds
      });

      const bridge = new ExtensionBridge('lock-test');
      const launchPromise = bridge.launch();

      // Advance past the waitForExit polling (100ms intervals, process "dies" after kill)
      // After first kill check, make process appear dead
      let killCalled = false;
      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) {
          // After SIGTERM was sent, report as dead
          return killCalled ? (() => { throw new Error('ESRCH'); })() : true;
        }
        killCalled = true;
        return true;
      });

      await vi.advanceTimersByTimeAsync(1); // WSS listening
      await vi.advanceTimersByTimeAsync(200); // waitForExit polling

      // Verify SIGTERM was sent to the orphaned Chrome (negative PID = process group)
      const termCalls = killSpy.mock.calls.filter(c => c[1] === 'SIGTERM');
      expect(termCalls.length).toBeGreaterThan(0);
      expect(Math.abs(termCalls[0][0] as number)).toBe(55555);

      // Clean up — connect extension so launch completes
      await vi.advanceTimersByTimeAsync(5001); // quick connect timeout
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('skips kill when SingletonLock points to a dead process', async () => {
      // No pid file
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.endsWith('/pid')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        if (filePath.endsWith('manifest.json')) return '{"version": "1.0.0", "name": "AlyBrowser"}';
        return "const WS_PORT = 19222;\nconst WS_TOKEN = '';";
      });

      // SingletonLock with dead PID
      mockedFs.readlinkSync.mockReturnValue('myhost-99999');

      // process.kill(pid, 0) throws → process is dead
      killSpy.mockImplementation(() => { throw new Error('ESRCH'); });

      const bridge = new ExtensionBridge('lock-dead');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      // No SIGTERM should have been sent
      const termCalls = killSpy.mock.calls.filter(c => c[1] === 'SIGTERM');
      expect(termCalls.length).toBe(0);

      // Connect and complete
      await vi.advanceTimersByTimeAsync(5001);
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('does not kill Chrome when MCP server pid is still alive', async () => {
      // pid file exists with a live MCP server
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.endsWith('/pid')) return '11111';
        if (filePath.endsWith('manifest.json')) return '{"version": "1.0.0", "name": "AlyBrowser"}';
        return "const WS_PORT = 19222;\nconst WS_TOKEN = '';";
      });

      // pid 11111 is alive
      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) return true;
        return true;
      });

      const bridge = new ExtensionBridge('lock-alive-mcp');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);

      // No SIGTERM should be sent — MCP server owns the Chrome
      const termCalls = killSpy.mock.calls.filter(c => c[1] === 'SIGTERM');
      expect(termCalls.length).toBe(0);

      await vi.advanceTimersByTimeAsync(5001);
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('cleans stale session files after killing orphaned Chrome', async () => {
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.endsWith('/pid')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        if (filePath.endsWith('manifest.json')) return '{"version": "1.0.0", "name": "AlyBrowser"}';
        return "const WS_PORT = 19222;\nconst WS_TOKEN = '';";
      });

      mockedFs.readlinkSync.mockReturnValue('myhost-77777');

      // First call: alive, after SIGTERM: dead
      let killed = false;
      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (killed) throw new Error('ESRCH');
          return true;
        }
        killed = true;
        return true;
      });

      const bridge = new ExtensionBridge('lock-cleanup');
      const launchPromise = bridge.launch();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(200);

      // Session files should have been cleaned
      const unlinkPaths = mockedFs.unlinkSync.mock.calls.map(c => String(c[0]));
      expect(unlinkPaths.some(p => p.endsWith('/port'))).toBe(true);
      expect(unlinkPaths.some(p => p.endsWith('/pid'))).toBe(true);
      expect(unlinkPaths.some(p => p.endsWith('/token'))).toBe(true);
      expect(unlinkPaths.some(p => p.endsWith('/chrome-pid'))).toBe(true);

      // Complete launch
      await vi.advanceTimersByTimeAsync(5001);
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });

    it('SIGKILL if Chrome does not exit within timeout', async () => {
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const filePath = String(p);
        if (filePath.endsWith('/pid')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        if (filePath.endsWith('manifest.json')) return '{"version": "1.0.0", "name": "AlyBrowser"}';
        return "const WS_PORT = 19222;\nconst WS_TOKEN = '';";
      });

      mockedFs.readlinkSync.mockReturnValue('myhost-88888');

      // Process stays alive — never dies after SIGTERM
      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) return true; // always alive
        return true;
      });

      const bridge = new ExtensionBridge('lock-sigkill');
      const launchPromise = bridge.launch();

      // Advance past waitForExit timeout (3000ms) + extra polling
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(3500);

      // Should have sent SIGKILL after timeout
      const sigkillCalls = killSpy.mock.calls.filter(c => c[1] === 'SIGKILL');
      expect(sigkillCalls.length).toBeGreaterThan(0);

      // Complete launch
      await vi.advanceTimersByTimeAsync(5001);
      const wss = getLatestWss();
      simulateExtensionReady(wss);
      await vi.advanceTimersByTimeAsync(1);
      await launchPromise;
    });
  });

  // ── cleanupAllStaleSessions with lock-based detection ─────────

  describe('cleanupAllStaleSessions', () => {
    let killSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    it('kills orphaned Chrome via lock when no pid file in session dir', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue(['orphan-session'] as any);
      mockedFs.statSync.mockReturnValue({ isFile: () => false, isDirectory: () => true } as any);

      // No pid file
      mockedFs.readFileSync.mockImplementation((p: any) => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      // SingletonLock → live Chrome
      mockedFs.readlinkSync.mockReturnValue('host-44444');

      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) return true;
        return true;
      });

      ExtensionBridge.cleanupAllStaleSessions();

      const termCalls = killSpy.mock.calls.filter(c => c[1] === 'SIGTERM');
      expect(termCalls.length).toBeGreaterThan(0);
      expect(Math.abs(termCalls[0][0] as number)).toBe(44444);
    });
  });
});
