import { describe, it, expect } from 'vitest';
import { ExtensionBridge } from '../../src/extension/bridge';

describe('ExtensionBridge', () => {
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
      const invalid = ['has space', 'foo@bar', 'test.session', 'a/b', 'hello!'];
      for (const id of invalid) {
        expect(
          () => new ExtensionBridge(id),
          `Should reject: "${id}"`,
        ).toThrow('Invalid sessionId');
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

  describe('send()', () => {
    it('throws when not connected', async () => {
      const bridge = new ExtensionBridge();
      await expect(bridge.send('snapshot')).rejects.toThrow('Extension not connected');
    });
  });

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

  describe('close()', () => {
    it('can be called without prior launch', async () => {
      const bridge = new ExtensionBridge();
      // Should not throw
      await bridge.close();
    });

    it('can be called multiple times', async () => {
      const bridge = new ExtensionBridge();
      await bridge.close();
      await bridge.close();
    });
  });
});
